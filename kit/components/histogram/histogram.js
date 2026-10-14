/*!
 * RK component: histogram — binned distribution of one metric (bins by count, width or automatic
 * Freedman–Diaconis rounded to a nice width), optional Gaussian KDE curve, median / mean lines,
 * the bin holding the target highlighted with a marker at its exact value, a rug of the raw
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
  function axisFmt(fmt) {
    return function (v) { var s = RK.format(v, fmt); return Math.round(v) === v && Math.abs(v) >= 100 ? s.replace(/\.0+(?=\D*$)/, '') : s; };
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
      targetValue: null,       // explicit value to mark (e.g. offer premium); default: the target row's value
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
      var tBin = util.isNum(tVal) ? Math.min(k - 1, Math.max(0, Math.floor((tVal - start) / w + 1e-9))) : -1;
      if (util.isNum(tVal) && (tVal < start || tVal > start + k * w)) tBin = -1;

      /* own cross-filter selection (a between filter on the value field) */
      var f = RK.store.filter(filterKey(ctx));
      var selBin = f && f.op === 'between' ? bins.filter(function (b) { return Math.abs(b.x0 - f.min) < w * 1e-6; })[0] : null;

      var base = t.accent3 || t.cat[1];
      var data = bins.map(function (b) {
        return { value: [b.x0, b.x1, yOf(b.rows.length), b.rows.length, b.i], bin: b };
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
        if (o.labels && b.rows.length) {
          kids.push({ type: 'text', silent: true, transition: ['x', 'y'], x: x + wd / 2, y: y - 3,
            style: { text: RK.format(api.value(2), yFmt), fill: isT ? t.ink : t.ink2, font: (isT ? '700 ' : '') + '10.5px ' + t.fontNum, align: 'center', verticalAlign: 'bottom', opacity: dim ? 0.4 : 1 },
            enterFrom: { y: p1[1], style: { opacity: 0 } } });
        }
        return { type: 'group', children: kids };
      }

      /* reference lines: stats in the lower label row (alternating sides), target in the upper row */
      var statLines = (o.stats || []).filter(function (s) { return STAT[s]; }).map(function (s) {
        return { key: s, label: STAT[s].label, v: STAT[s].fn(sorted) };
      }).sort(function (a, b) { return a.v - b.v; });
      var lines = statLines.map(function (s, j) {
        var align = statLines.length === 1 ? 'center' : (j === 0 ? 'right' : 'left');
        return {
          xAxis: s.v, lineStyle: { color: t.ink3, type: [4, 3], width: 1 },
          label: { show: true, position: 'end', distance: 4, color: t.ink2, fontSize: 10, align: align, padding: align === 'right' ? [0, 2, 0, 0] : align === 'left' ? [0, 0, 0, 2] : 0,
            formatter: s.label + ' ' + RK.format(s.v, fmt) }
        };
      });
      if (util.isNum(tVal)) {
        lines.push({
          xAxis: tVal, lineStyle: { color: t.accent2, type: 'solid', width: 1.5 },
          label: { show: true, position: 'end', distance: 18, color: t.ink, fontWeight: 700, fontSize: 10.5, formatter: tText }
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
      var tickEvery = Math.max(1, Math.ceil(k / 10));
      var graphic = [];
      if (o.showN) {
        graphic.push({ type: 'text', right: 4, top: 0, silent: true,
          style: { text: 'n = ' + n + (missing ? '  (' + missing + ' n.a. excluded)' : ''), fill: t.ink3, font: '10.5px ' + t.fontNum, align: 'right' } });
      }

      return {
        legend: { show: false },
        grid: C.grid(ctx, { top: 34 + (util.isNum(tVal) ? 14 : 0), left: 2, right: 12, bottom: 2, containLabel: false }),
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
          axisTick: { show: true, length: 3, lineStyle: { color: t.axis } },
          axisLabel: { formatter: axisFmt(fmt), margin: o.rug ? 14 : 8, hideOverlap: true },
          splitLine: { show: false }
        },
        yAxis: {
          type: 'value', min: 0, max: function (e) { return Math.max(e.max, maxY) * 1.12; }, minInterval: pct ? null : 1,
          name: pct ? 'Share of observations' : 'Number of observations', nameLocation: 'middle', nameGap: 34,
          axisLabel: { formatter: function (v) { return RK.format(v, yFmt); }, showMaxLabel: false },
          splitLine: { show: true, lineStyle: { color: t.grid } }
        },
        series: [
          {
            id: 'bins', type: 'custom', renderItem: renderItem, data: data, encode: { x: [0, 1], y: 2 }, z: 2,
            markLine: lines.length ? { silent: true, symbol: ['none', 'none'], animationDuration: 600, data: lines } : undefined
          },
          {
            id: 'kde', type: 'line', data: curve, smooth: true, symbol: 'none', silent: true, z: 3,
            lineStyle: { color: t.ink2, width: 1.5 }, tooltip: { show: false }, animationDuration: 900
          },
          {
            id: 'rug', type: 'scatter', data: rug, symbol: 'rect', symbolOffset: [0, 7], clip: false, z: 4,
            emphasis: { scale: 1.6 }, animationDelay: function (i) { return 200 + i * 10; }
          }
        ]
      };
    }, {
      on: {
        click: function (p, ctx) {
          if (p.seriesId !== 'bins' || ctx.options.crossFilter === false) return;
          var b = p.data && p.data.bin, key = filterKey(ctx), cur = RK.store.filter(key);
          if (!b) return;
          if (cur && cur.op === 'between' && cur.min === b.x0) { RK.store.clearFilter(key); return; }
          // [x0, x1): nudge the inclusive "between" max just below the next edge (last bin stays closed)
          var max = p.data.value[4] === p.data.value.length ? b.x1 : b.x1 - Math.abs(b.x1 - b.x0) * 1e-9;
          RK.store.setFilter(key, { field: ctx.enc.value, op: 'between', min: b.x0, max: max, source: ctx.id });
        }
      }
    })
  });
})();
