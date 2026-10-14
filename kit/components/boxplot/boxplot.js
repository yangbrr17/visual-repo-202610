/*!
 * RK component: boxplot — distribution of a metric by group, computed from raw rows: box (Q1–Q3),
 * median, mean marker, whiskers (1.5 × IQR Tukey or min / max), outliers, the raw observations as a
 * beeswarm-jittered overlay (ECharts 6 axis jitter) with labels on hover, and the target marked
 * across its box. Typical use: EV / EBITDA by sector for a trading-comps page.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /* ---------------- stats ---------------- */
  /** Quantile with linear interpolation between closest ranks (Excel QUARTILE.INC / type 7). */
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    var h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }
  function stats(vals, mode) {
    var s = vals.slice().sort(function (a, b) { return a - b; });
    var q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
    var lo = s[0], hi = s[s.length - 1];
    if (mode !== 'minmax') {
      var fenceLo = q1 - 1.5 * iqr, fenceHi = q3 + 1.5 * iqr;
      lo = s.filter(function (v) { return v >= fenceLo; })[0];
      hi = s.filter(function (v) { return v <= fenceHi; }).pop();
    }
    return {
      n: s.length, min: s[0], max: s[s.length - 1], q1: q1, median: quantile(s, 0.5), q3: q3, iqr: iqr,
      low: lo, high: hi, mean: s.reduce(function (a, v) { return a + v; }, 0) / s.length
    };
  }
  function niceExtent(vals, pad, count) {
    var ext = util.extent(vals), span = ext[1] - ext[0] || Math.abs(ext[0]) || 1;
    var step = util.niceStep(span * (1 + 2 * pad), count || 5);
    var lo = Math.floor((ext[0] - span * pad) / step) * step, hi = Math.ceil((ext[1] + span * pad) / step) * step;
    if (ext[0] >= 0 && lo < 0) lo = 0;
    return { min: +lo.toPrecision(12), max: +hi.toPrecision(12), step: step };
  }
  /** Tick labels in the field format, without decimals while the tick step is whole ("18x", not "18.0x"). */
  function ticks(fmt, step) {
    return function (v) {
      var s = RK.format(v, fmt), st = typeof step === 'function' ? step() : step;
      return st && !/\.\d*[1-9]/.test(RK.format(st, fmt)) ? s.replace(/\.0+(?=\D*$)/, '') : s;
    };
  }

  RK.component({
    id: 'boxplot',
    deps: ['echarts'],
    defaults: {
      encode: { group: 'group', value: 'value', label: 'label', name: null, target: 'is_target' },
      orientation: 'vertical',   // 'vertical' (groups along x) | 'horizontal' (groups along y — long names)
      whiskers: 'tukey',         // 'tukey' (1.5 × IQR, beyond = outliers) | 'minmax'
      points: true,              // raw observations, beeswarm-jittered inside the box width
      mean: true,                // mean marker (small diamond)
      valueLabels: 'median',     // 'median' | 'all' (median, quartiles, whiskers) | false
      showN: true,               // "n = 6" under each group label
      overall: 'median',         // 'median' | 'mean' | false — dashed line across all groups (target excluded)
      sort: null,                // null (data order) | 'median' (high -> low) | 'asc' | 'desc' (by name)
      groupColors: false,        // colour boxes by group (default: one calm colour)
      boxWidth: 0.42,            // box width as a share of the category band
      highlight: null,           // label / name value(s) treated as the target; default: encode.target field
      format: null,              // value format (default: value field format)
      title: null                // value axis title (default: value field title)
    },
    render: C(function (ctx, inst) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc, ds = ctx.dataset;
      var has = function (f) { return !!(f && ds && ds.has(f)); };
      var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
      var vert = o.orientation !== 'horizontal';
      var labelF = has(enc.label) ? enc.label : null, nameF = has(enc.name) ? enc.name : labelF;
      var highlights = o.highlight == null ? null : [].concat(o.highlight);
      function isTarget(r) {
        if (highlights) return highlights.indexOf(r[labelF]) >= 0 || highlights.indexOf(r[nameF]) >= 0;
        return has(enc.target) && !!r[enc.target];
      }
      var rows = ctx.rows.filter(function (r) { return util.isNum(r[enc.value]) && r[enc.group] != null; });

      /* groups + stats */
      var byG = util.groupBy(rows, function (r) { return r[enc.group]; });
      var groups = [];
      byG.forEach(function (list, g) { groups.push({ key: g, rows: list, s: stats(list.map(function (r) { return r[enc.value]; }), o.whiskers) }); });
      if (o.sort === 'median') groups.sort(function (a, b) { return b.s.median - a.s.median; });
      else if (o.sort === 'asc' || o.sort === 'desc') groups.sort(function (a, b) { var c = String(a.key).localeCompare(String(b.key)); return o.sort === 'asc' ? c : -c; });
      var cats = groups.map(function (g) { return String(g.key); });
      var palette = RK.theme.categoricalSafe(util.unique(ctx.allRows.map(function (r) { return r[enc.group]; })));   // never like the accent2 target
      var base = t.accent;   // undifferentiated peers: the same accent as lollipop / bullet / scatter
      var colorOf = function (g) { return o.groupColors ? palette(g) : base; };
      var selG = ctx.selected(enc.group);

      /* geometry: band / box / jitter widths from the container (custom series reads the real band) */
      var plotLen = (vert ? (ctx.el.clientWidth || 600) - 80 : (ctx.el.clientHeight || 320) - 60);
      var band = plotLen / Math.max(1, cats.length);
      var bw = Math.min(band * o.boxWidth, vert ? 72 : 40);

      /* value axis */
      var allVals = rows.map(function (r) { return r[enc.value]; });
      var ve = niceExtent(allVals, 0.08, 5);
      var peerVals = rows.filter(function (r) { return !isTarget(r); }).map(function (r) { return r[enc.value]; });
      var overall = null;
      if (o.overall && peerVals.length) {
        overall = o.overall === 'mean' ? peerVals.reduce(function (a, v) { return a + v; }, 0) / peerVals.length
          : stats(peerVals, 'minmax').median;
      }

      /* custom box series data: [catIndex, low, q1, median, q3, high, mean, targetValue] */
      var boxData = groups.map(function (g, i) {
        var tr = g.rows.filter(isTarget)[0];
        return {
          value: [i, g.s.low, g.s.q1, g.s.median, g.s.q3, g.s.high, g.s.mean, tr ? tr[enc.value] : null],
          stats: g.s, key: g.key, target: tr || null,
          dim: selG.length && selG.indexOf(g.key) < 0
        };
      });
      var showLab = o.valueLabels, labFont = '10.5px ' + t.fontNum;

      function renderItem(params, api) {
        var d = boxData[params.dataIndex];
        if (!d) return null;
        var ci = api.value(0), col = colorOf(d.key);
        var P = function (v) { return vert ? api.coord([ci, v]) : api.coord([v, ci]); };
        var bandPx = vert ? api.size([1, 0])[0] : api.size([0, 1])[1];
        var w = Math.min(bandPx * o.boxWidth, vert ? 72 : 40), hw = w / 2;
        var pLow = P(api.value(1)), pQ1 = P(api.value(2)), pMed = P(api.value(3)), pQ3 = P(api.value(4)), pHigh = P(api.value(5));
        var c = vert ? pMed[0] : pMed[1];
        var op = d.dim ? 0.3 : 1;
        var stroke = { stroke: col, lineWidth: 1.2, opacity: op };
        var kids = [];
        function seg(a, b, style, name) {
          // a / b are positions along the value axis; draw across the category at offset
          kids.push({ type: 'line', name: name, shape: vert ? { x1: c + a[1], y1: a[0], x2: c + b[1], y2: b[0] } : { x1: a[0], y1: c + a[1], x2: b[0], y2: c + b[1] }, style: style, transition: ['shape'] });
        }
        var v = function (p) { return vert ? p[1] : p[0]; };
        // whiskers + caps
        seg([v(pLow), 0], [v(pQ1), 0], util.merge({}, stroke, { lineWidth: 1 }), 'wl');
        seg([v(pQ3), 0], [v(pHigh), 0], util.merge({}, stroke, { lineWidth: 1 }), 'wh');
        seg([v(pLow), -hw * 0.45], [v(pLow), hw * 0.45], util.merge({}, stroke, { lineWidth: 1 }), 'cl');
        seg([v(pHigh), -hw * 0.45], [v(pHigh), hw * 0.45], util.merge({}, stroke, { lineWidth: 1 }), 'ch');
        // box
        var a = Math.min(v(pQ1), v(pQ3)), len = Math.abs(v(pQ3) - v(pQ1));
        kids.push({
          type: 'rect', name: 'box', transition: ['shape'],
          shape: vert ? { x: c - hw, y: a, width: w, height: Math.max(len, 1) } : { x: a, y: c - hw, width: Math.max(len, 1), height: w },
          style: { fill: RK.theme.alpha(col, 0.14 * op), stroke: col, lineWidth: 1.2, opacity: op },
          emphasis: { style: { fill: RK.theme.alpha(col, 0.24), stroke: t.ink } }
        });
        // median
        seg([v(pMed), -hw], [v(pMed), hw], { stroke: col, lineWidth: 2.6, opacity: op }, 'med');
        // mean marker
        if (o.mean) {
          var pm = P(api.value(6)), mx = vert ? c : pm[0], my = vert ? pm[1] : c, r = 3.6;
          kids.push({ type: 'polygon', name: 'mean', transition: ['shape'], shape: { points: [[mx, my - r], [mx + r, my], [mx, my + r], [mx - r, my]] },
            style: { fill: t.paper, stroke: col, lineWidth: 1.2, opacity: op } });
        }
        // target: accent2 tick across the box + label outside it
        var tv = api.value(7);
        if (d.target && util.isNum(tv)) {
          var pt = P(tv), tp = v(pt), ext = hw + 6;
          seg([tp, -ext], [tp, ext], { stroke: t.accent2, lineWidth: 2, opacity: 1 }, 'tgt');
          var tl = (labelF ? d.target[labelF] + ' ' : '') + RK.format(tv, fmt);
          kids.push({ type: 'text', name: 'tgtl', silent: true,
            style: vert ? { x: c - ext - 3, y: tp, text: tl, fill: t.ink, font: '700 10.5px ' + t.fontSans, align: 'right', verticalAlign: 'middle', stroke: t.paper, lineWidth: 3 }
              : { x: tp, y: c + ext + 3, text: tl, fill: t.ink, font: '700 10.5px ' + t.fontSans, align: 'center', verticalAlign: 'top', stroke: t.paper, lineWidth: 3 } });
        }
        // value labels
        // paper halo: the overall line (drawn below) never strikes through a value
        function lab(p, txt, strong) {
          var halo = { stroke: t.paper, lineWidth: 3 };
          kids.push({ type: 'text', silent: true,
            style: util.merge(vert ? { x: c + hw + 5, y: v(p), text: txt, fill: strong ? t.ink : t.ink2, font: (strong ? '600 ' : '') + labFont, align: 'left', verticalAlign: 'middle', opacity: op }
              : { x: v(p), y: c - hw - 3, text: txt, fill: strong ? t.ink : t.ink2, font: (strong ? '600 ' : '') + labFont, align: 'center', verticalAlign: 'bottom', opacity: op }, halo) });
        }
        if (showLab) lab(pMed, RK.format(api.value(3), fmt), true);
        if (params.dataIndex === 0 && overall != null && vert) {
          var ol = overallLabel(api);
          if (ol) kids.push(ol);
        }
        if (showLab === 'all') {
          var gapOK = function (p1, p2) { return Math.abs(v(p1) - v(p2)) >= (vert ? 12 : 34); };
          if (gapOK(pQ3, pMed)) lab(pQ3, RK.format(api.value(4), fmt));
          if (gapOK(pQ1, pMed)) lab(pQ1, RK.format(api.value(2), fmt));
          if (gapOK(pHigh, pQ3)) lab(pHigh, RK.format(api.value(5), fmt));
          if (gapOK(pLow, pQ1)) lab(pLow, RK.format(api.value(1), fmt));
        }
        return { type: 'group', children: kids };
      }

      /**
       * Vertical layout: the overall line's label goes to the first free spot along the line — right end,
       * left end, then the gaps between boxes (above, then below the line) — clear of every box, whisker,
       * point column, value label and target label. Drawn by the box series above the line, with a halo.
       */
      var olText = overall != null ? 'Overall ' + o.overall + ' ' + RK.format(overall, fmt) : '';
      var olFont = 'italic 400 10.5px ' + t.fontSans;
      function overallLabel(api) {
        var y = api.coord([0, overall])[1], bandPx = api.size([1, 0])[0];
        var w = Math.min(bandPx * o.boxWidth, 72), hw = w / 2, tw = C.measure(olText, olFont) + 4, th = 14;
        var c0 = api.coord([0, ve.min])[0], left = c0 - bandPx / 2, right = left + bandPx * boxData.length;
        var top = api.coord([0, ve.max])[1], bottom = api.coord([0, ve.min])[1];
        var obs = [];
        boxData.forEach(function (d, i) {
          var c = api.coord([i, ve.min])[0], s = d.stats, py = function (val) { return api.coord([i, val])[1]; };
          var hi = Math.max(s.max, d.target ? d.target[enc.value] : -Infinity), lo = Math.min(s.min, d.target ? d.target[enc.value] : Infinity);
          obs.push({ x: c - Math.max(hw, bw * 0.5) - 3, y: py(hi) - 6, w: Math.max(w, bw) + 6, h: py(lo) - py(hi) + 12 });
          var labs = [s.median].concat(showLab === 'all' ? [s.q1, s.q3, s.low, s.high] : []);
          labs.forEach(function (val) {
            obs.push({ x: c + hw + 3, y: py(val) - 8, w: C.measure(RK.format(val, fmt), '600 ' + labFont) + 6, h: 16 });
          });
          if (d.target) {
            var tl = (labelF ? d.target[labelF] + ' ' : '') + RK.format(d.target[enc.value], fmt), tlw = C.measure(tl, '700 ' + labFont) + 6;
            obs.push({ x: c - hw - 9 - tlw, y: py(d.target[enc.value]) - 8, w: tlw, h: 16 });
          }
        });
        var cands = [[right - tw - 2, y - th - 1], [right - tw - 2, y + 2], [left + 4, y - th - 1], [left + 4, y + 2]];
        for (var k = 1; k < boxData.length; k++) {
          var bx = left + k * bandPx;
          cands.push([bx - tw / 2, y - th - 1], [bx - tw / 2, y + 2]);
        }
        var hit = function (b) {
          if (b.x < left || b.x + b.w > right + 50 || b.y < top - 2 || b.y + b.h > bottom) return true;
          return obs.some(function (q) { return b.x < q.x + q.w && b.x + b.w > q.x && b.y < q.y + q.h && b.y + b.h > q.y; });
        };
        var style = { fill: t.ink3, font: olFont, align: 'left', verticalAlign: 'top', stroke: t.paper, lineWidth: 3, lineHeight: 13 };
        for (var j = 0; j < cands.length; j++) {
          if (!hit({ x: cands[j][0], y: cands[j][1], w: tw, h: th })) return { type: 'text', name: 'overall', silent: true, style: util.merge(style, { x: cands[j][0] + 2, y: cands[j][1], text: olText }) };
        }
        // no room along the line (every gap holds a box): stack the label in the right gutter at the line's end
        var stacked = ['Overall', o.overall, RK.format(overall, fmt)].join('\n');
        return { type: 'text', name: 'overall', silent: true, style: util.merge(style, { x: right + 4, y: y - 19.5, text: stacked }) };
      }

      /* raw observations (jittered by the category axis), outliers hollow, target as a diamond */
      var pts = [], outs = [], tgts = [];
      groups.forEach(function (g, i) {
        g.rows.forEach(function (r) {
          var val = r[enc.value], isOut = val < g.s.low || val > g.s.high;
          var dim = selG.length && selG.indexOf(g.key) < 0;
          var it = { value: vert ? [i, val] : [val, i], name: labelF ? String(r[labelF]) : '', row: r, group: g.key, outlier: isOut };
          if (isTarget(r)) { tgts.push(util.merge(it, { itemStyle: { opacity: dim ? 0.3 : 1 } })); return; }
          if (isOut) outs.push(util.merge(it, { itemStyle: { opacity: dim ? 0.3 : 1 } }));
          else if (o.points) pts.push(util.merge(it, { itemStyle: { opacity: dim ? 0.2 : 0.75 } }));
        });
      });
      var hoverLabel = {
        show: true, position: vert ? 'right' : 'top', distance: 4, fontSize: 10.5, color: t.ink, fontWeight: 600,
        textBorderColor: t.paper, textBorderWidth: 2.5,
        formatter: function (p) { return (p.name ? p.name + '  ' : '') + RK.format(vert ? p.value[1] : p.value[0], fmt); }
      };
      var ptSeries = function (id, data, style, size, symbol, z) {
        return {
          id: id, type: 'scatter', data: data, symbol: symbol || 'circle', symbolSize: size, z: z || 4,
          itemStyle: style, label: { show: false }, emphasis: { scale: 1.5, label: hoverLabel },
          animationDelay: function (i) { return 300 + i * 12; }
        };
      };

      // overall statistic: ink-3 [4, 3] dashed line below the boxes; label 10.5px italic (vertical: placed by the box series)
      var lines = [];
      if (overall != null) {
        lines.push(util.merge({
          lineStyle: { color: t.ink3, type: [4, 3], width: 1 },
          label: { show: !vert, position: 'start', color: t.ink3, fontSize: 10.5, fontStyle: 'italic', distance: 3,
            formatter: function () { return olText; } }
        }, vert ? { yAxis: overall } : { xAxis: overall }));
      }

      var nOf = {}, catFont = '11px ' + t.fontSans;
      groups.forEach(function (g) { nOf[String(g.key)] = g.s.n; });
      var catAxis = {
        type: 'category', data: cats, inverse: !vert,
        axisLine: { show: true, lineStyle: { color: t.axis } }, axisTick: { show: false },
        // ECharts 6 beeswarm jitter: points spread inside the box width without overlapping
        jitter: Math.max(0, Math.round(bw * 0.9)), jitterOverlap: true, jitterMargin: 1,
        axisLabel: {
          interval: 0, color: t.ink2, fontSize: 11, lineHeight: 14, align: vert ? 'center' : 'right',
          formatter: function (k) {
            // wrap long names manually (rich text + overflow:'break' do not mix), n on its own line
            var maxW = Math.max(62, vert ? band - 10 : 150), words = String(k).split(' '), lines = [''];
            words.forEach(function (wd) {
              var cur = lines[lines.length - 1];
              if (cur && C.measure(cur + ' ' + wd, catFont) > maxW) lines.push(wd); else lines[lines.length - 1] = cur ? cur + ' ' + wd : wd;
            });
            var out = lines.map(function (l) { return '{g|' + C.richSafe(l) + '}'; }).join('\n');   // braces in data never open a style run
            return o.showN ? out + '\n{n|n = ' + (nOf[k] || 0) + '}' : out;
          },
          rich: { g: { color: t.ink2, fontSize: 11, lineHeight: 14 }, n: { color: t.ink3, fontSize: 10, lineHeight: 14, fontFamily: t.fontNum } }
        }
      };
      var tickFont = '11px ' + t.fontNum, tick0 = ticks(fmt, ve.step);
      var liveStep = function () { try { return inst.getModel().getComponent(vert ? 'yAxis' : 'xAxis', 0).axis.scale.getInterval(); } catch (e) { return ve.step; } };
      var valAxis = {
        type: 'value', min: ve.min, max: ve.max, splitNumber: Math.round((ve.max - ve.min) / ve.step),
        name: o.title || ctx.title(enc.value), nameLocation: 'middle',
        nameGap: vert ? Math.round(Math.max(C.measure(tick0(ve.min), tickFont), C.measure(tick0(ve.max), tickFont)) + 14) : 26,
        axisLabel: { formatter: ticks(fmt, liveStep) },
        splitLine: { show: true, lineStyle: { color: t.grid } }
      };

      return {
        legend: { show: false },
        grid: C.grid(ctx, { top: overall != null && !vert ? 22 : 12, left: 2, right: vert ? 54 : 16, bottom: 2, containLabel: false }),
        tooltip: {
          trigger: 'item',
          formatter: function (p) {
            if (p.seriesId === 'box') {
              var d = boxData[p.dataIndex], s = d.stats, f = function (x) { return RK.format(x, fmt); };
              var tr = [
                { label: 'Observations', value: String(s.n) },
                { label: o.whiskers === 'minmax' ? 'Maximum' : 'Upper whisker', value: f(s.high) },
                { label: 'Upper quartile', value: f(s.q3) },
                { label: 'Median', value: f(s.median), bold: true },
                { label: 'Lower quartile', value: f(s.q1) },
                { label: o.whiskers === 'minmax' ? 'Minimum' : 'Lower whisker', value: f(s.low) },
                { label: 'Mean', value: f(s.mean) }
              ];
              if (d.target) tr.push({ color: t.accent2, label: String(d.target[nameF] || 'Target'), value: f(d.target[enc.value]) });
              return C.tip(String(d.key), tr, o.whiskers === 'minmax' ? null : 'Whiskers at 1.5 × IQR (' + f(s.iqr) + ')');
            }
            var r = p.data && p.data.row;
            if (!r) return '';
            var title = r[nameF] == null ? '' : String(r[nameF]);
            if (labelF && nameF !== labelF) title += ' (' + r[labelF] + ')';
            return C.tip(title, [
              { label: ctx.title(enc.group), value: String(r[enc.group]) },
              { label: ctx.title(enc.value), value: RK.format(r[enc.value], fmt), bold: true }
            ], isTarget(r) ? 'Target' : (p.data.outlier ? 'Outlier (beyond whiskers)' : null));
          }
        },
        xAxis: vert ? catAxis : valAxis,
        yAxis: vert ? valAxis : catAxis,
        series: [
          {
            // reference layer below the boxes; precision: ECharts would round the value to 2 decimals
            id: 'ref', type: 'scatter', data: [], silent: true, tooltip: { show: false }, z: 1,
            markLine: lines.length ? { silent: true, symbol: ['none', 'none'], precision: 10, data: lines } : undefined
          },
          {
            id: 'box', type: 'custom', renderItem: renderItem, data: boxData, z: 2,
            encode: vert ? { x: 0, y: [1, 2, 3, 4, 5] } : { y: 0, x: [1, 2, 3, 4, 5] },
            animationDuration: 700
          },
          ptSeries('pts', pts, { color: t.ink3, borderColor: t.paper, borderWidth: 0.6 }, 6),
          ptSeries('out', outs, { color: t.paper, borderColor: t.ink2, borderWidth: 1.2 }, 7),
          ptSeries('target', tgts, { color: t.accent2, borderColor: t.paper, borderWidth: 1 }, 11, 'diamond', 6)
        ]
      };
    }, {
      rebuildOnResize: true,   // box width, beeswarm jitter and label wrapping follow the band width
      select: function (p, ctx) {
        if (p.seriesId === 'box') return { field: ctx.enc.group, value: p.data && p.data.key };
        if (p.data && p.data.row) return { field: ctx.enc.group, value: p.data.group };
        return null;
      }
    })
  });
})();
