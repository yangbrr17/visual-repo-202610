/*!
 * RK component: diverging-bar — positive / negative bars around zero (or around a baseline such as the
 * peer median): beat / miss vs. consensus, TSR, variance to budget. Bars in --rk-pos / --rk-neg,
 * signed labels just outside the bar ends, sorted, target in accent-2. zeroLabels puts the category
 * names next to the zero line on the side opposite each bar (the compact "tornado" ranking style).
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;
  var MINUS = '−';

  var isNum = util.isNum;
  /** Signed label: formats that already carry a '+' are used as-is, otherwise +/− is prefixed. */
  function signed(v, fmt) {
    var code = RK.format.presets[fmt] || fmt;
    if (!isNum(v) || (typeof code === 'string' && /\+/.test(code.split(';')[0].replace(/"[^"]*"/g, '')))) return RK.format(v, fmt).replace(/^-/, MINUS);
    var s = RK.format(Math.abs(v), fmt);
    return v > 0 ? '+' + s : v < 0 && /[1-9]/.test(s) ? MINUS + s : s;
  }
  /** Axis tick format: the value format with no more decimals than the tick step needs (10% not 10.0%). */
  function tickFmt(fmt, step) {
    var code = RK.format.presets[fmt] || fmt;
    if (typeof code !== 'string' || !step || !/[0#]/.test(code) || RK.format.isDateCode(code)) return fmt;
    var sec = code.split(';')[0].replace(/"[^"]*"/g, ''), scale = Math.pow(1000, ((sec.match(/[0#](,+)[^0#]*$/) || [])[1] || '').length);
    var v = Math.abs(step) * (/%/.test(sec) ? 100 : 1) / scale, dec = 0;
    while (dec < 4 && Math.abs(Math.round(v * Math.pow(10, dec)) - v * Math.pow(10, dec)) > 1e-6) dec++;
    return code.replace(/([0#])\.([0#]+)/g, function (m, a, d) { var n = Math.min(dec, d.length); return a + (n ? '.' + d.slice(0, n) : ''); });
  }

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var horiz = o.orientation !== 'vertical';
    var zeroLab = horiz && !!o.zeroLabels;
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var up = o.goodDirection !== 'down';
    var hf = enc.highlight && ctx.dataset && ctx.dataset.has(enc.highlight) ? enc.highlight : null;
    var hlist = o.highlight == null ? [] : [].concat(o.highlight);

    var items = ctx.rows.map(function (r) {
      return {
        row: r, label: r[enc.label], raw: isNum(r[enc.value]) ? r[enc.value] : null,
        hi: (hf && !!r[hf] && r[hf] !== 'false') || hlist.indexOf(r[enc.label]) >= 0
      };
    });

    // ---- baseline: bars show value − baseline ----
    var statVals = items.filter(function (d) { return !(o.baselineExcludeHighlight && d.hi); }).map(function (d) { return d.raw; });
    var base = o.baseline === 'median' || o.baseline === 'mean' ? RK.expr.agg[o.baseline](statVals.filter(isNum)) : isNum(o.baseline) ? o.baseline : 0;
    if (base == null) base = 0;
    items.forEach(function (d) { d.v = d.raw == null ? null : d.raw - base; });

    if (o.sort === 'asc' || o.sort === 'desc') {
      var dir = o.sort === 'asc' ? 1 : -1;
      items.sort(function (a, b) {
        if (a.v == null) return b.v == null ? 0 : 1;
        if (b.v == null) return -1;
        return (a.v - b.v) * dir;
      });
    }
    var labels = items.map(function (d) { return d.label; });
    function colorOf(d) {
      if (d.hi) return t.accent2;
      if (o.colorBy === 'single') return t.accent;
      if (!d.v) return t.neutral;
      return (d.v > 0) === up ? t.pos : t.neg;
    }

    // ---- bounds: leave room (in px) for value labels and zero-line category labels ----
    var numFont = '11px ' + t.fontNum, catFont = '600 11px ' + t.fontSans;
    var vlW = 0, catW = 0;
    items.forEach(function (d) {
      vlW = Math.max(vlW, C.measure(signed(d.v, fmt), numFont));
      if (zeroLab) catW = Math.max(catW, C.measure(d.label, catFont));
    });
    var vals = items.map(function (d) { return d.v; }).filter(isNum);
    var ext = util.extent(vals.concat([0]));
    var anyPos = vals.some(function (v) { return v > 0; }), anyNeg = vals.some(function (v) { return v < 0; });
    var P = Math.max(160, horiz ? inst.getWidth() - (zeroLab ? 24 : 170) : inst.getHeight() - 70);
    var labPx = o.labels === false ? 4 : (horiz ? vlW + 8 : 18);
    var lo = ext[0], hi = ext[1];
    for (var it = 0; it < 6; it++) {
      var unit = ((hi - lo) || 1) / P;
      lo = Math.min(ext[0] < 0 ? ext[0] - labPx * unit : 0, zeroLab && anyPos ? -(catW + 10) * unit : 0);
      hi = Math.max(ext[1] > 0 ? ext[1] + labPx * unit : 0, zeroLab && anyNeg ? (catW + 10) * unit : 0);
    }
    if (lo === 0 && hi === 0) hi = 1;
    var step = util.niceStep(hi - lo, 5);
    var showVal = !!o.valueAxis && !zeroLab;
    if (showVal) { lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step; }

    var stagger = Math.min(50, 700 / Math.max(1, items.length));
    var series = [];

    // tinted row / column behind highlighted categories
    var hiIdx = [];
    items.forEach(function (d, i) { if (d.hi) hiIdx.push(i); });
    if (hiIdx.length && o.highlightBand !== false) {
      series.push({
        id: 'hl', type: 'custom', silent: true, z: 0, tooltip: { show: false }, animation: false,
        renderItem: function (params, api) {
          var cs = params.coordSys, p = api.coord(horiz ? [0, api.value(0)] : [api.value(0), 0]);
          var bw = horiz ? api.size([0, 1])[1] : api.size([1, 0])[0];
          var shape = horiz ? { x: 0, y: p[1] - bw / 2, width: api.getWidth(), height: bw }
            : { x: p[0] - bw / 2, y: cs.y, width: bw, height: api.getHeight() - cs.y };
          return { type: 'rect', shape: shape, style: { fill: RK.theme.alpha(t.accent2, t.dark ? 0.16 : 0.11) } };
        },
        data: hiIdx.map(function (i) { return [i]; })
      });
    }

    var zeroLine = {
      silent: true, symbol: ['none', 'none'], animation: false,
      lineStyle: { color: t.axis, type: 'solid', width: 1 },
      label: base !== 0 || o.baselineLabel ? {
        show: true, position: horiz ? 'start' : 'insideStartTop', color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum,
        formatter: (o.baselineLabel || (o.baseline === 'median' ? 'Median' : o.baseline === 'mean' ? 'Mean' : 'Baseline')) + (base !== 0 ? ' ' + RK.format(base, fmt) : '')
      } : { show: false },
      data: [horiz ? { xAxis: 0 } : { yAxis: 0 }].concat((o.refLines || []).map(function (r) {
        // reference lines (offer / target): dashed --rk-ref, label in the line colour
        var c = r.color || t.ref;
        var d = { lineStyle: { color: c, type: [4, 3], width: 1.2 },
          label: { show: true, position: horiz ? 'start' : 'insideEndTop', color: c, fontSize: 10.5, fontFamily: t.fontNum, formatter: r.label || RK.format(r.value, fmt) } };
        d[horiz ? 'xAxis' : 'yAxis'] = r.value - base;
        return d;
      }))
    };

    series.push({
      id: 'bars', name: ctx.title(enc.value), type: 'bar', z: 2,
      barWidth: horiz ? '62%' : '56%',
      animationDelay: function (i) { return i * stagger; },
      emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
      label: o.labels === false ? { show: false } : {
        show: true, distance: 5, fontSize: 11, fontFamily: t.fontNum, color: t.ink2,
        formatter: function (p) { var d = items[p.dataIndex]; return d ? signed(d.v, fmt) : ''; }
      },
      data: items.map(function (d) {
        var neg = d.v != null && d.v < 0;
        return {
          name: d.label, value: d.v,
          itemStyle: { color: C.dim(ctx, enc.label, d.label, colorOf(d)) },
          label: { position: horiz ? (neg ? 'left' : 'right') : (neg ? 'bottom' : 'top'), color: d.hi ? t.ink : t.ink2, fontWeight: d.hi ? 600 : 400 }
        };
      }),
      markLine: zeroLine
    });

    // category names at the zero line, on the side opposite each bar
    if (zeroLab) {
      series.push({
        id: 'zl', type: 'scatter', symbolSize: 0, silent: true, z: 3, tooltip: { show: false },
        animationDelay: function (i) { return i * stagger; },
        data: items.map(function (d, i) {
          var neg = d.v != null && d.v < 0;
          return {
            value: [0, i],
            label: { show: true, position: neg ? 'right' : 'left', distance: 6, fontSize: 11,
              color: d.hi ? t.ink : t.ink2, fontWeight: d.hi ? 600 : 400, formatter: String(d.label) }
          };
        })
      });
    }

    var catAxis = {
      type: 'category', data: labels, inverse: horiz,
      axisLine: { show: false, onZero: false }, axisTick: { show: false },
      axisLabel: {
        show: !zeroLab, interval: 0, color: t.ink2, fontSize: 11,
        width: horiz ? 150 : Math.max(44, (inst.getWidth() - 40) / Math.max(1, labels.length) - 4), overflow: horiz ? 'truncate' : 'break',
        formatter: function (v, i) { return items[i] && items[i].hi ? '{h|' + v + '}' : v; },
        rich: { h: { color: t.ink, fontWeight: 600, fontSize: 11 } }
      }
    };
    var valAxis = {
      type: 'value', min: lo, max: hi, show: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { show: showVal, formatter: C.axisFmt(tickFmt(fmt, step)), hideOverlap: true },
      splitLine: { show: showVal, lineStyle: { color: t.grid } },
      interval: showVal ? step : undefined
    };
    var topRoom = horiz && (base !== 0 || o.baselineLabel || (o.refLines || []).length) ? 18 : 6;

    return {
      legend: { show: false },
      grid: C.grid(ctx, { top: topRoom, left: zeroLab ? 0 : 4, right: zeroLab ? 0 : (showVal ? 18 : 8), bottom: 4 }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var d = items[p.dataIndex];
          if (!d || p.seriesId !== 'bars') return '';
          var tr = [{ color: colorOf(d), label: ctx.title(enc.value), value: RK.format(d.raw, fmt), bold: base === 0 }];
          if (base !== 0) {
            tr.push({ label: o.baselineLabel || (o.baseline === 'median' ? 'Median' : o.baseline === 'mean' ? 'Mean' : 'Baseline'), value: RK.format(base, fmt) });
            tr.push({ label: 'Difference', value: signed(d.v, fmt), bold: true });
          }
          return C.tip(d.label, tr);
        }
      },
      xAxis: horiz ? valAxis : catAxis,
      yAxis: horiz ? catAxis : valAxis,
      series: series
    };
  }

  RK.component({
    id: 'diverging-bar',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'label', value: 'value', highlight: 'is_target' },
      orientation: 'horizontal',      // horizontal (ranked rows) | vertical (columns, e.g. quarters)
      sort: 'desc',                   // 'desc' | 'asc' | null (data order)
      baseline: 0,                    // number | 'median' | 'mean' — bars show value − baseline
      baselineExcludeHighlight: true, // median / mean baseline without the highlighted (target) rows
      baselineLabel: null,            // label on the zero line (default 'Median' / 'Mean' + value)
      colorBy: 'sign',                // sign (pos / neg) | single
      goodDirection: 'up',            // 'up' | 'down' — which sign is favourable
      zeroLabels: false,              // horizontal: category names at the zero line, opposite the bar
      labels: true,                   // signed value labels outside the bar ends
      valueAxis: false,               // show the value axis + gridlines
      refLines: [],                   // [{value, label, color}] in value units (before baseline shift)
      highlight: null,                // label value(s) to emphasise in addition to encode.highlight
      highlightBand: true,
      format: null
    },
    render: C(build, {
      rebuildOnResize: true,          // label room is measured in px
      select: function (p, ctx) { return p.seriesId === 'bars' ? { field: ctx.enc.label, value: p.name } : null; }
    })
  });
})();
