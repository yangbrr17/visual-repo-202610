/*!
 * RK component: histogram — binned distribution of one metric (bins by count, width or automatic
 * Freedman–Diaconis rounded to a nice width), optional Gaussian KDE curve, median / mean lines,
 * the bin holding the target highlighted with a marker at its exact value (or a dashed reference
 * line for an explicit value such as an offer premium), a rug of the raw
 * observations, and click-a-bin cross-filtering (a "between" filter on the value field).
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /* ---------------- stats ---------------- */
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    var h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }
  function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
  function sd(a) { var m = mean(a); return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / Math.max(1, a.length - 1)); }
  /** Round a raw bin width to 1 / 2 / 2.5 / 5 × 10^k (the nearest on a log scale). */
  function niceWidth(raw) {
    if (!(raw > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    var best = [1, 2, 2.5, 5, 10].reduce(function (b, c) { return Math.abs(Math.log(c / n)) < Math.abs(Math.log(b / n)) ? c : b; }, 1);
    return best * mag;
  }
  /** Bin width: explicit width > bin count > Freedman–Diaconis (Sturges when IQR is 0). */
  function binWidth(sorted, o) {
    var lo = sorted[0], hi = sorted[sorted.length - 1], span = hi - lo || Math.abs(hi) || 1;
    if (o.binWidth > 0) return o.binWidth;
    if (o.bins > 0) return niceWidth(span / o.bins);
    var iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    var fd = iqr > 0 ? 2 * iqr * Math.pow(sorted.length, -1 / 3) : span / Math.ceil(Math.log2(sorted.length) + 1);
    return niceWidth(Math.max(fd, span / 40));
  }
  /** Gaussian kernel density estimate (Silverman's rule-of-thumb bandwidth unless given). */
  function kde(vals, bw) {
    var n = vals.length, s = vals.slice().sort(function (a, b) { return a - b; });
    var h = bw || 0.9 * Math.min(sd(vals), (quantile(s, 0.75) - quantile(s, 0.25)) / 1.34 || sd(vals)) * Math.pow(n, -0.2);
    if (!(h > 0)) h = 1;
    var k = 1 / (n * h * Math.sqrt(2 * Math.PI));
    return function (x) { var sum = 0; for (var i = 0; i < n; i++) { var u = (x - vals[i]) / h; sum += Math.exp(-0.5 * u * u); } return k * sum; };
  }
  /** Tick labels in the field format, without decimals while the tick step is whole ("12x", "35%" — not "12.0x"). */
  function ticks(fmt, step) {
    var whole = !/\.\d*[1-9]/.test(RK.format(step, fmt));
    return function (v) { var s = RK.format(v, fmt); return whole ? s.replace(/\.0+(?=\D*$)/, '') : s; };
  }
  /** The format with one more decimal when it has none ('0%' -> '0.0%'): statistics must not round together. */
  function oneDecimal(code) {
    code = String(RK.format.presets[code] || code || 'auto');
    if (code === 'auto' || /\.[0#]/.test(code)) return code;
    return code.split(';').map(function (sec) { return sec.replace(/([#0,]*0)/, '$1.0'); }).join(';');
  }
  var STAT = {
    median: { label: 'Median', fn: function (s) { return quantile(s, 0.5); } },
    mean: { label: 'Mean', fn: function (s) { return mean(s); } },
    p25: { label: '25th pct.', fn: function (s) { return quantile(s, 0.25); } },
    p75: { label: '75th pct.', fn: function (s) { return quantile(s, 0.75); } }
  };

  function filterKey(ctx) { return ctx.id + ':' + ctx.enc.value; }

  RK.component({
    id: 'histogram',
    deps: ['echarts'],
    defaults: {
      encode: { value: 'value', label: 'label', name: null, target: 'is_target' },
      bins: null,              // number of bins (rounded to a nice width); null = automatic (Freedman–Diaconis)
      binWidth: null,          // explicit bin width — overrides bins
      binStart: null,          // first bin edge (default: the bin width multiple just below the minimum)
      yScale: 'count',         // 'count' | 'percent'
      density: false,          // Gaussian KDE curve scaled to the bars
      bandwidth: null,         // KDE bandwidth (default: Silverman's rule)
      stats: ['median', 'mean'], // dashed reference lines: 'median' | 'mean' | 'p25' | 'p75'
      targetValue: null,       // explicit reference value (e.g. offer premium): dashed t.ref line; default: the target row's value
      targetLabel: null,       // label for that marker (default: target label + value)
      highlight: null,         // label / name value(s) treated as the target; default: encode.target field
      labels: true,            // count / % above each bar
      rug: true,               // one tick per observation under the axis (hover for the name)
      showN: true,             // "n = 14 (7 n.a.)" note, top-right
      format: null,            // value format (default: value field format)
      title: null              // x axis title (default: value field title)
    },
    render: C(function (ctx) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc, ds = ctx.dataset;
      var has = function (f) { return !!(f && ds && ds.has(f)); };
      var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
      var labelF = has(enc.label) ? enc.label : null, nameF = has(enc.name) ? enc.name : labelF;
      var highlights = o.highlight == null ? null : [].concat(o.highlight);
      function isTarget(r) {
        if (highlights) return highlights.indexOf(r[labelF]) >= 0 || highlights.indexOf(r[nameF]) >= 0;
        return has(enc.target) && !!r[enc.target];
      }
      var rows = ctx.rows.filter(function (r) { return util.isNum(r[enc.value]); });
      var missing = ctx.rows.length - rows.length;
      var vals = rows.map(function (r) { return r[enc.value]; });
      var sorted = vals.slice().sort(function (a, b) { return a - b; });
      var n = vals.length;
      if (!n) return { series: [] };

      /* bins: [x0, x1) except the last, which is closed */
      var w = binWidth(sorted, o);
      var start = o.binStart != null ? o.binStart : Math.floor(sorted[0] / w + 1e-9) * w;
      var k = Math.max(1, Math.ceil((sorted[n - 1] - start) / w - 1e-9));
      if (start + k * w <= sorted[n - 1] - 1e-9) k++;
      k = Math.min(k, 80);
      var bins = [];
      for (var i = 0; i < k; i++) bins.push({ i: i, x0: +(start + i * w).toPrecision(12), x1: +(start + (i + 1) * w).toPrecision(12), rows: [] });
      rows.forEach(function (r) {
        var b = Math.min(k - 1, Math.max(0, Math.floor((r[enc.value] - start) / w + 1e-9)));
        bins[b].rows.push(r);
      });
      var pct = o.yScale === 'percent';
      var yOf = function (c) { return pct ? c / n : c; };
      var yFmt = pct ? '0%' : '#,##0';

      /* target */
      var tRow = rows.filter(isTarget)[0] || null;
      var tVal = o.targetValue != null ? o.targetValue : (tRow ? tRow[enc.value] : null);
      var tText = o.targetLabel || ((tRow && labelF && o.targetValue == null ? tRow[labelF] + ' ' : 'Target ') + RK.format(tVal, fmt));
      var isRef = o.targetValue != null;   // an explicit value (offer, price) is a reference line, not the subject
      var tBin = util.isNum(tVal) && !isRef ? Math.min(k - 1, Math.max(0, Math.floor((tVal - start) / w + 1e-9))) : -1;
      if (util.isNum(tVal) && (tVal < start || tVal > start + k * w)) tBin = -1;

      /* own cross-filter selection (a between filter on the value field) */
      var f = RK.store.filter(filterKey(ctx));
      var selBin = f && f.op === 'between' ? bins.filter(function (b) { return Math.abs(b.x0 - f.min) < w * 1e-6; })[0] : null;

      var base = t.accent;   // undifferentiated peers: the same accent as lollipop / bullet / scatter
      var data = bins.map(function (b) {
        return { value: [b.x0, b.x1, yOf(b.rows.length), b.rows.length, b.i], bin: b, last: b.i === k - 1 };
      });

      function renderItem(params, api) {
        var b = bins[params.dataIndex];
        var p0 = api.coord([api.value(0), api.value(2)]), p1 = api.coord([api.value(1), 0]);
        var gap = Math.min(1.5, (p1[0] - p0[0]) * 0.08);
        var x = p0[0] + gap, wd = Math.max(1, p1[0] - p0[0] - 2 * gap), y = p0[1], h = p1[1] - p0[1];
        var isT = b.i === tBin, dim = selBin && selBin !== b;
        var fill = isT ? t.accent2 : base;
        var kids = [{
          type: 'rect', shape: { x: x, y: y, width: wd, height: Math.max(0, h) }, transition: ['shape'],
          style: { fill: fill, opacity: dim ? 0.3 : 1 },
          emphasis: { style: { fill: RK.theme.mix(fill, t.ink, 0.2) } },
          enterFrom: { shape: { y: p1[1], height: 0 } }
        }];
        return { type: 'group', children: kids };
      }
      /* bar value labels: their own series above the KDE and the reference lines, on a paper knock-out box */
      function renderLabel(params, api) {
        var b = bins[params.dataIndex];
        if (!o.labels || !b.rows.length) return null;
        var p0 = api.coord([api.value(0), api.value(2)]), p1 = api.coord([api.value(1), 0]);
        var isT = b.i === tBin, dim = selBin && selBin !== b;
        return { type: 'text', silent: true, transition: ['x', 'y'], x: (p0[0] + p1[0]) / 2, y: p0[1] - 3,
          style: { text: RK.format(api.value(2), yFmt), fill: isT ? t.ink : t.ink2, font: (isT ? '700 ' : '') + '10.5px ' + t.fontNum, align: 'center', verticalAlign: 'bottom',
            opacity: dim ? 0.4 : 1, backgroundColor: t.paper, padding: [1, 2, 0, 2], borderRadius: 2 },   // knock-out box: lines pass behind
          enterFrom: { y: p1[1], style: { opacity: 0 } } };
      }

      /* reference lines: stats in the lower label row (alternating sides), target in the upper row */
      var statLines = (o.stats || []).filter(function (s) { return STAT[s]; }).map(function (s) {
        return { key: s, label: STAT[s].label, v: STAT[s].fn(sorted) };
      }).sort(function (a, b) { return a.v - b.v; });
      // statistics: ink-3 [4, 3] 1px, 10.5px italic labels, one decimal more than the axis format so a median
      // and a mean never print as the same number; labels alternate sides of their line (first one ends at it)
      var sFmt = oneDecimal(fmt);
      var plotW = Math.max(120, (ctx.el.clientWidth || 600) - 80), pxPer = plotW / (k * w);
      var statFont = 'italic 10.5px ' + t.fontSans, prevEnd = -Infinity, row2 = false;
      var lines = statLines.map(function (s, j) {
        var txt = s.label + ' ' + RK.format(s.v, sFmt), tw = C.measure(txt, statFont) + 4;
        var align = statLines.length === 1 ? 'center' : (j === 0 ? 'right' : 'left');
        var px = (s.v - start) * pxPer, x0 = align === 'right' ? px - tw : align === 'left' ? px : px - tw / 2;
        var lift = x0 < prevEnd + 6;   // would touch the previous label: lift it one row (above the plot)
        if (lift) row2 = true; else prevEnd = x0 + tw;
        return {
          xAxis: s.v, lineStyle: { color: t.ink3, type: [4, 3], width: 1 },
          label: { show: true, position: 'end', distance: lift ? 18 : 4, color: t.ink3, fontSize: 10.5, fontStyle: 'italic', align: align,
            padding: align === 'right' ? [0, 2, 0, 0] : align === 'left' ? [0, 0, 0, 2] : 0,
            textBorderColor: t.paper, textBorderWidth: 3, formatter: function () { return txt; } }
        };
      });
      if (util.isNum(tVal)) {
        // offer / price: reference line (t.ref, [4, 3], 1.2px, italic 600); the subject: accent-2 solid, bold ink label
        lines.push({
          xAxis: tVal, lineStyle: isRef ? { color: t.ref, type: [4, 3], width: 1.2 } : { color: t.accent2, type: 'solid', width: 1.5 },
          label: { show: true, position: 'end', distance: row2 ? 32 : 18, color: isRef ? t.ref : t.ink, fontWeight: isRef ? 600 : 700, fontStyle: isRef ? 'italic' : 'normal',
            fontSize: 10.5, textBorderColor: t.paper, textBorderWidth: 3, formatter: function () { return tText; } }
        });
      }

      /* KDE curve, in bar units (count or share per bin) */
      var curve = [];
      if (o.density && n > 2) {
        var dens = kde(vals, o.bandwidth), x0 = start, x1 = start + k * w, steps = 120;
        for (var s = 0; s <= steps; s++) {
          var xv = x0 + (x1 - x0) * s / steps;
          curve.push([xv, dens(xv) * w * (pct ? 1 : n)]);
        }
      }

      /* rug under the axis */
      var rug = o.rug ? rows.map(function (r) {
        var isT = isTarget(r);
        return { value: [r[enc.value], 0], name: labelF ? String(r[labelF]) : '', row: r,
          itemStyle: { color: isT ? t.accent2 : RK.theme.alpha(t.ink2, 0.55) }, symbolSize: isT ? [2.5, 10] : [1.4, 7] };
      }) : [];

      var maxY = Math.max.apply(null, data.map(function (d) { return d.value[2]; }).concat(curve.map(function (c) { return c[1]; })));
      // one tick per bin edge while labels fit (~56px each), else every 2nd / 5th ... edge
      var maxTicks = Math.max(4, Math.floor(((ctx.el.clientWidth || 600) - 80) / 56));   // re-evaluated on resize
      var tickEvery = Math.max(1, Math.ceil(k / maxTicks));
      var graphic = [];
      if (o.showN) {
        graphic.push({ type: 'text', right: 4, top: 0, silent: true,
          style: { text: 'n = ' + n + (missing ? '  (' + missing + ' n.a. excluded)' : ''), fill: t.ink3, font: '10.5px ' + t.fontNum, align: 'right' } });
      }

      return {
        legend: { show: false },
        grid: C.grid(ctx, { top: 34 + (util.isNum(tVal) ? 14 : 0) + (row2 ? 14 : 0), left: 2, right: 12, bottom: 2, containLabel: false }),
        graphic: graphic,
        tooltip: {
          trigger: 'item',
          formatter: function (p) {
            if (p.seriesId === 'rug') {
              var r = p.data.row, title = r[nameF] == null ? '' : String(r[nameF]);
              if (labelF && nameF !== labelF) title += ' (' + r[labelF] + ')';
              return C.tip(title, [{ label: ctx.title(enc.value), value: RK.format(r[enc.value], fmt), bold: true }], isTarget(r) ? 'Target' : null);
            }
            if (p.seriesId !== 'bins') return '';
            var b = bins[p.dataIndex], names = b.rows.map(function (r) { return labelF ? r[labelF] : null; }).filter(Boolean);
            var last = b.i === k - 1;
            return C.tip(RK.format(b.x0, fmt) + ' – ' + (last ? '' : '<') + RK.format(b.x1, fmt), [
              { label: 'Count', value: String(b.rows.length), bold: true },
              { label: 'Share of total', value: RK.format(b.rows.length / n, '0.0%') }
            ], names.length ? names.slice(0, 10).join(', ') + (names.length > 10 ? ' …' : '') : null);
          }
        },
        xAxis: {
          type: 'value', min: start, max: +(start + k * w).toPrecision(12), interval: w * tickEvery,
          name: o.title || ctx.title(enc.value), nameLocation: 'middle', nameGap: o.rug ? 34 : 26,
          axisLine: { show: true, onZero: false, lineStyle: { color: t.axis } },
          axisTick: { show: !o.rug, length: 3, lineStyle: { color: t.axis } },   // the rug already marks the axis
          axisLabel: { formatter: ticks(fmt, w * tickEvery), margin: o.rug ? 14 : 8, hideOverlap: true, showMaxLabel: k % tickEvery === 0 },
          splitLine: { show: false }
        },
        yAxis: {
          type: 'value', min: 0, max: function (e) { return Math.max(e.max, maxY) * 1.12; }, minInterval: pct ? null : 1,
          name: pct ? 'Share of observations' : 'Number of observations', nameLocation: 'middle', nameGap: 34,
          axisLabel: { formatter: function (v) { return RK.format(v, yFmt); }, showMaxLabel: false },
          splitLine: { show: true, lineStyle: { color: t.grid } }
        },
        series: [
          { id: 'bins', type: 'custom', renderItem: renderItem, data: data, encode: { x: [0, 1], y: 2 }, z: 2 },
          // KDE on a paper casing so it separates from the bars (dark themes included)
          {
            id: 'kde-case', type: 'line', data: curve, smooth: true, symbol: 'none', silent: true, z: 3,
            lineStyle: { color: t.paper, width: 3.5, opacity: 0.9 }, tooltip: { show: false }, animationDuration: 900
          },
          {
            id: 'kde', type: 'line', data: curve, smooth: true, symbol: 'none', silent: true, z: 3.1,
            lineStyle: { color: t.ink2, width: 1.5 }, tooltip: { show: false }, animationDuration: 900
          },
          {
            // reference lines above bars and curve; precision: ECharts would round 0.3666 to 0.37
            id: 'ref', type: 'scatter', data: [], silent: true, tooltip: { show: false }, z: 3.5,
            markLine: lines.length ? { silent: true, symbol: ['none', 'none'], precision: 10, animationDuration: 600, data: lines } : undefined
          },
          { id: 'labels', type: 'custom', renderItem: renderLabel, data: data, encode: { x: [0, 1], y: 2 }, z: 5, silent: true, tooltip: { show: false } },
          {
            id: 'rug', type: 'scatter', data: rug, symbol: 'rect', symbolOffset: [0, 7], clip: false, z: 4,
            emphasis: { scale: 1.6 }, animationDelay: function (i) { return 200 + i * 10; }
          }
        ]
      };
    }, {
      rebuildOnResize: true,   // tick density follows the width
      on: {
        // click a bin -> range ("between") cross-filter on the value field; click it again to clear
        click: function (p, ctx) {
          if (p.seriesId !== 'bins' || ctx.options.crossFilter === false) return;
          var b = p.data && p.data.bin, key = filterKey(ctx), cur = RK.store.filter(key), f = ctx.enc.value;
          if (!b) return;
          if (cur && cur.op === 'between' && cur.min === b.x0) { RK.store.clearFilter(key); return; }
          // [x0, x1): nudge the inclusive "between" max just below the next edge (last bin stays closed)
          var max = p.data.last ? b.x1 : b.x1 - Math.abs(b.x1 - b.x0) * 1e-9;
          var spec = { field: f, op: 'between', min: b.x0, max: max, source: ctx.id };
          var scope = ctx.options.crossFilterScope || (RK.data.isGenericField(f) ? 'dataset' : 'global');   // as ctx.select
          if (scope === 'dataset' && ctx.dataset) spec.datasets = [ctx.dataset.id];
          RK.store.setFilter(key, spec);   // ctx.select covers 'in' lists only; ranges go to the store directly
        }
      }
    })
  });
})();
