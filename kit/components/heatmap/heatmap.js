/*!
 * RK component: heatmap — categorical x × y matrix (correlations, monthly returns, peer scores)
 * with formatted cell labels on a sequential or diverging scale, colour legend, optional
 * lower / upper triangle for symmetric matrices, sortable axes, a summary column per row
 * (total / average / compounded return) and click-to-cross-filter on a row or column.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  var SUMMARY = {
    sum: { label: 'Total', fn: function (a) { return a.reduce(function (s, v) { return s + v; }, 0); } },
    mean: { label: 'Average', fn: mean },
    compound: { label: 'Year', fn: function (a) { return a.reduce(function (s, v) { return s * (1 + v); }, 1) - 1; } }
  };
  function textW(s, px) { return String(s).length * (px || 11) * 0.6; }

  /** Category label mapping: 'months' (1-12 -> Jan..Dec) or a {value: label} object. */
  function labeller(spec, fmt) {
    if (spec === 'months') return function (v) { var n = +v; return n >= 1 && n <= 12 ? RK.format.config.months[n - 1] : String(v); };
    if (util.isObj(spec)) return function (v) { return spec[v] != null ? spec[v] : String(v); };
    return function (v) { return typeof v === 'number' && fmt ? RK.format(v, fmt) : String(v); };
  }

  /** Category order: data order, asc / desc, by mean value ('value'), or an explicit list. */
  function order(cats, spec, meanOf) {
    if (Array.isArray(spec)) {
      var keys = spec.map(String);
      return keys.filter(function (k) { return cats.indexOf(k) >= 0; }).concat(cats.filter(function (k) { return keys.indexOf(k) < 0; }));
    }
    var out = cats.slice();
    var num = out.every(function (k) { return k !== '' && !isNaN(+k); });
    var cmp = function (a, b) { return num ? +a - +b : a.localeCompare(b); };
    if (spec === 'asc') out.sort(cmp);
    else if (spec === 'desc') out.sort(function (a, b) { return cmp(b, a); });
    else if (spec === 'value') out.sort(function (a, b) { return (meanOf(b) || 0) - (meanOf(a) || 0); });
    return out;
  }

  RK.component({
    id: 'heatmap',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'x', y: 'y', value: 'value' },
      scale: 'auto',          // 'auto' | 'sequential' | 'diverging' (auto: diverging when values straddle mid)
      mid: 0,                 // diverging midpoint
      min: null,              // colour domain overrides (default: data extent; diverging is symmetric around mid)
      max: null,
      triangle: false,        // false | 'lower' | 'upper' — hide the mirrored half of a symmetric matrix
      diagonal: true,         // show x == y cells (correlation = 1)
      sortX: null,            // null (data order) | 'asc' | 'desc' | 'value' (by mean) | [explicit order]
      sortY: null,
      xLabels: null,          // null | 'months' | {value: label}
      yLabels: null,
      labels: 'auto',         // cell value labels: true | false | 'auto' (when cells are wide enough)
      format: null,           // value format (default: value field format)
      summary: null,          // null | 'sum' | 'mean' | 'compound' — extra column summarising each row
      summaryLabel: null,     // summary column header (default: Total / Average / Year)
      xPosition: 'bottom',    // 'bottom' | 'top'
      highlight: null,        // category value(s) to emphasise on both axes (e.g. the target ticker)
      select: null,           // null | 'x' | 'y' — click a cell to cross-filter on that dimension
      cellGap: 2,             // white rule between cells (px)
      legend: true            // colour legend (top-left)
    },
    render: C(function (ctx) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
      var xKey = function (r) { return String(r[enc.x]); }, yKey = function (r) { return String(r[enc.y]); };
      var rows = ctx.rows.filter(function (r) { return r[enc.x] != null && r[enc.y] != null; });

      /* cells (duplicates averaged) */
      var cell = new Map(), byX = new Map(), byY = new Map();
      rows.forEach(function (r) {
        var k = xKey(r) + '\u0001' + yKey(r), v = r[enc.value];
        if (!cell.has(k)) cell.set(k, []);
        if (util.isNum(v)) cell.get(k).push(v);
      });
      cell.forEach(function (vals, k) {
        var parts = k.split('\u0001'), v = vals.length ? mean(vals) : null;
        cell.set(k, v);
        if (v == null) return;
        (byX.get(parts[0]) || byX.set(parts[0], []).get(parts[0])).push(v);
        (byY.get(parts[1]) || byY.set(parts[1], []).get(parts[1])).push(v);
      });
      var xs0 = util.unique(rows.map(xKey)), ys0 = util.unique(rows.map(yKey));
      var rawX = {}, rawY = {};   // category key -> original field value (numbers stay numbers for cross-filter)
      rows.forEach(function (r) { if (!(xKey(r) in rawX)) rawX[xKey(r)] = r[enc.x]; if (!(yKey(r) in rawY)) rawY[yKey(r)] = r[enc.y]; });
      var sameSet = xs0.length === ys0.length && xs0.every(function (k) { return ys0.indexOf(k) >= 0; });
      var meanX = function (k) { return mean(byX.get(k) || []); }, meanY = function (k) { return mean(byY.get(k) || []); };
      var xs = order(xs0, o.sortX, meanX);
      var ys = order(ys0, o.sortY, meanY);
      // a symmetric matrix keeps both axes in the same order so the triangle is meaningful
      var tri = sameSet && (o.triangle === 'lower' || o.triangle === 'upper') ? o.triangle : null;
      if (tri) ys = xs.slice();
      var pos = {};                     // position in the shared order (triangle test)
      xs.forEach(function (k, i) { pos[k] = i; });
      if (tri && !o.diagonal) {
        // without the diagonal the first row and last column of a lower triangle are empty: drop them
        if (tri === 'lower') { ys = ys.slice(1); xs = xs.slice(0, -1); } else { ys = ys.slice(0, -1); xs = xs.slice(1); }
      }

      /* colour scale (identical ramp to the visualMap so label contrast can be computed) */
      var vals = [];
      cell.forEach(function (v) { if (v != null) vals.push(v); });
      var ext = util.extent(vals);
      var type = o.scale === 'auto' ? (ext[0] < o.mid && ext[1] > o.mid ? 'diverging' : 'sequential') : o.scale;
      var dom = [o.min != null ? o.min : ext[0], o.max != null ? o.max : ext[1]];
      if (type === 'diverging' && o.min == null && o.max == null) {
        var m = Math.max(Math.abs(dom[0] - o.mid), Math.abs(dom[1] - o.mid)) || 1;
        dom = [o.mid - m, o.mid + m];
      }
      if (dom[0] === dom[1]) dom = [dom[0] - 1, dom[1] + 1];
      var stops = type === 'diverging' ? t.div : t.seq;
      var colorOf = RK.theme.sequential(dom, stops);

      /* summary column */
      var sm = o.summary && SUMMARY[o.summary] ? SUMMARY[o.summary] : null;
      var smKey = sm ? (o.summaryLabel || sm.label) : null;
      var xCats = sm ? xs.concat([smKey]) : xs;

      /* labels on/off + size from the available cell size */
      var w = ctx.el.clientWidth || 600, hgt = ctx.el.clientHeight || 300;
      var cw = (w - 70) / xCats.length, ch = (hgt - 60) / ys.length;
      var sample = RK.format(ext[1], fmt), sample2 = RK.format(ext[0], fmt);
      var need = Math.max(textW(sample, 10.5), textW(sample2, 10.5)) + 6;
      var showLabels = o.labels === 'auto' ? cw >= need && ch >= 14 : !!o.labels;
      var fs = cw >= need + 14 && ch >= 22 ? 11 : 10;

      var selField = o.select === 'x' ? enc.x : o.select === 'y' ? enc.y : null;
      var sel = selField ? ctx.selected(selField).map(String) : [];
      var hl = o.highlight == null ? [] : [].concat(o.highlight).map(String);

      var data = [];
      ys.forEach(function (yk, iy) {
        xs.forEach(function (xk, ix) {
          if (tri === 'lower' && pos[yk] < pos[xk]) return;
          if (tri === 'upper' && pos[yk] > pos[xk]) return;
          if (!o.diagonal && xk === yk) return;
          var v = cell.get(xk + '\u0001' + yk);
          if (v === undefined) return;
          var dim = sel.length && sel.indexOf(o.select === 'x' ? xk : yk) < 0;
          var fill = colorOf(v);
          data.push({
            value: [ix, iy, v],
            raw: [rawX[xk], rawY[yk]],
            itemStyle: dim ? { opacity: 0.22 } : undefined,
            label: { color: v == null ? t.ink3 : RK.theme.onColor(fill, t.dark ? t.paper : t.ink, t.dark ? t.ink : '#ffffff') }
          });
        });
      });

      var smData = [];
      if (sm) {
        ys.forEach(function (yk, iy) {
          var rowVals = xs.map(function (xk) { return cell.get(xk + '\u0001' + yk); }).filter(util.isNum);
          if (!rowVals.length) return;
          var v = sm.fn(rowVals);
          smData.push({ value: [xs.length, iy, v], label: { color: v < 0 && o.summary !== 'mean' ? t.neg : t.ink } });
        });
      }

      var xLab = labeller(o.xLabels, ctx.fmtOf(enc.x)), yLab = labeller(o.yLabels, ctx.fmtOf(enc.y));
      var rich = { hl: { fontWeight: 700, color: t.ink }, sm: { fontWeight: 700, color: t.ink } };
      function catFmt(lab, isX) {
        return function (k) {
          if (isX && sm && k === smKey) return '{sm|' + k + '}';
          var s = lab(k);
          return hl.indexOf(k) >= 0 ? '{hl|' + s + '}' : s;
        };
      }
      var labelCfg = { show: showLabels, fontSize: fs, fontFamily: t.fontNum, formatter: function (p) { return RK.format(p.value[2], fmt); } };
      var gap = o.cellGap;
      var legendOn = o.legend !== false;
      var top = o.xPosition === 'top';

      return {
        legend: { show: false },
        // containLabel:false + outerBounds: ECharts 6 keeps top-positioned column labels below the colour legend
        grid: C.grid(ctx, { top: (legendOn ? 30 : 6) + (top ? 4 : 0), left: 2, right: 6, bottom: 2, containLabel: false,
          outerBounds: { left: 0, right: 0, bottom: 0, top: legendOn ? (top ? 32 : 26) : 0 } }),
        tooltip: {
          trigger: 'item',
          formatter: function (p) {
            if (!p.value) return '';
            var xk = xCats[p.value[0]], yk = ys[p.value[1]];
            var isSm = p.seriesId === 'summary';
            return C.tip(yLab(yk) + '  ·  ' + (isSm ? smKey : xLab(xk)), [
              { color: isSm ? null : colorOf(p.value[2]), label: isSm ? smKey : ctx.title(enc.value), value: RK.format(p.value[2], fmt) }
            ]);
          }
        },
        visualMap: [{
          type: 'continuous', show: legendOn, seriesIndex: 0, dimension: 2, min: dom[0], max: dom[1],
          orient: 'horizontal', left: 0, top: 0, itemWidth: 9, itemHeight: 140, calculable: false, hoverLink: true,
          text: [RK.format(dom[1], fmt), RK.format(dom[0], fmt)], textGap: 6, textStyle: { color: t.ink3, fontSize: 10 },
          inRange: { color: stops }, outOfRange: { color: t.grid }
        }],
        xAxis: {
          type: 'category', data: xCats, position: top ? 'top' : 'bottom', splitArea: { show: false },
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: t.ink2, fontSize: 11, interval: 0, hideOverlap: true, formatter: catFmt(xLab, true), rich: rich, margin: 8 }
        },
        yAxis: {
          type: 'category', data: ys, inverse: true, splitArea: { show: false },
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: t.ink2, fontSize: 11, interval: 0, formatter: catFmt(yLab, false), rich: rich, margin: 8 }
        },
        series: [{
          id: 'cells', type: 'heatmap', data: data, label: labelCfg,
          itemStyle: { borderColor: t.paper, borderWidth: gap },
          emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } },
          animationDuration: 500
        }, {
          id: 'summary', type: 'heatmap', data: smData,
          label: util.merge({}, labelCfg, { fontWeight: 700 }),
          itemStyle: { color: t.surface2 || t.surface, borderColor: t.paper, borderWidth: gap },
          emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } }
        }]
      };
    }, {
      select: function (p, ctx) {
        var o = ctx.options;
        if (!o.select || p.seriesId !== 'cells' || !p.data || !p.data.raw) return null;
        return o.select === 'x' ? { field: ctx.enc.x, value: p.data.raw[0] } : { field: ctx.enc.y, value: p.data.raw[1] };
      }
    })
  });
})();
