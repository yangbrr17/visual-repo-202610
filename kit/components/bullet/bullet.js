/*!
 * RK component: bullet — actual vs. target per row with qualitative bands (Stephen Few bullet graph):
 * grey bands (poor / satisfactory / good) behind a thin actual bar and a target tick, plus a
 * right-hand "actual | variance" column. Bands come from per-row fields (encode.bands) or from
 * options.bands thresholds, relative to each row's target or absolute. scale:'row' scales every row
 * to its own maximum so metrics in different units can share one compact scorecard.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;
  var MINUS = '−';

  var isNum = util.isNum;
  function signed(v, fmt) {
    if (!isNum(v)) return RK.format(v, fmt);
    var s = RK.format(Math.abs(v), fmt);
    return v > 0 ? '+' + s : v < 0 && /[1-9]/.test(s) ? MINUS + s : s;
  }
  /** Axis tick format: the value format with no more decimals than the tick step needs. */
  function tickFmt(fmt, step) {
    var code = RK.format.presets[fmt] || fmt;
    if (typeof code !== 'string' || !step || !/[0#]/.test(code) || RK.format.isDateCode(code)) return fmt;
    var sec = code.split(';')[0].replace(/"[^"]*"/g, ''), scale = Math.pow(1000, ((sec.match(/[0#](,+)[^0#]*$/) || [])[1] || '').length);
    var v = Math.abs(step) * (/%/.test(sec) ? 100 : 1) / scale, dec = 0;
    while (dec < 4 && Math.abs(Math.round(v * Math.pow(10, dec)) - v * Math.pow(10, dec)) > 1e-6) dec++;
    return code.replace(/([0#])\.([0#]+)/g, function (m, a, d) { var n = Math.min(dec, d.length); return a + (n ? '.' + d.slice(0, n) : ''); });
  }

  /** Tinted full-width row band behind highlighted categories (like .rk-table tr.is-target). */
  function rowBand(ctx, idx) {
    var t = ctx.theme;
    return {
      id: 'hl', type: 'custom', silent: true, z: 0, tooltip: { show: false }, animation: false,
      renderItem: function (params, api) {
        var p = api.coord([0, api.value(0)]), bw = api.size([0, 1])[1];
        return { type: 'rect', shape: { x: 0, y: p[1] - bw / 2, width: api.getWidth(), height: bw }, style: { fill: RK.theme.alpha(t.accent2, t.dark ? 0.16 : 0.11) } };
      },
      data: idx.map(function (i) { return [i]; })
    };
  }

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var rowScale = o.scale === 'row';
    var baseFmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var hasTarget = !!(enc.target && ctx.dataset && ctx.dataset.has(enc.target));
    var hf = enc.highlight && ctx.dataset && ctx.dataset.has(enc.highlight) ? enc.highlight : null;
    var hlist = o.highlight == null ? [] : [].concat(o.highlight);
    var bandFields = Array.isArray(enc.bands) ? enc.bands.filter(function (f) { return ctx.dataset && ctx.dataset.has(f); }) : [];
    var up = o.goodDirection !== 'down';

    // constant target (number / median / mean of the values) when there is no target field
    var constTarget = null;
    var isHi = function (r) { return (hf && !!r[hf] && r[hf] !== 'false') || hlist.indexOf(r[enc.label]) >= 0; };
    if (!hasTarget) {
      var all = ctx.rows.filter(function (r) { return !(o.targetExcludeHighlight && isHi(r)); }).map(function (r) { return r[enc.value]; });
      constTarget = o.target === 'median' || o.target === 'mean' ? RK.expr.agg[o.target](all.filter(isNum)) : isNum(o.target) ? o.target : null;
    }

    var items = ctx.rows.map(function (r) {
      var v = isNum(r[enc.value]) ? r[enc.value] : null;
      var tg = hasTarget ? (isNum(r[enc.target]) ? r[enc.target] : null) : constTarget;
      var thr;
      if (bandFields.length) thr = bandFields.map(function (f) { return r[f]; });
      else thr = (o.bands || []).map(function (b) { return o.bandMode === 'absolute' ? b : (tg == null ? null : b * tg); });
      thr = thr.filter(isNum).sort(function (a, b) { return a - b; });
      return {
        row: r, label: r[enc.label], value: v, target: tg, thr: thr,
        fmt: (enc.format && r[enc.format]) || baseFmt,
        varAbs: v != null && tg != null ? v - tg : null,
        varPct: v != null && tg != null ? (tg ? v / tg - 1 : NaN) : null,
        hi: isHi(r)
      };
    });
    if (o.sort) {
      var dir = o.sort === 'asc' ? 1 : -1;
      var key = o.sort === 'variance' ? 'varPct' : 'value';
      items.sort(function (a, b) {
        var x = a[key], y = b[key];
        if (!isNum(x)) return isNum(y) ? 1 : 0;
        if (!isNum(y)) return -1;
        return (x - y) * (o.sort === 'variance' ? -1 : dir);
      });
    }
    var labels = items.map(function (d) { return d.label; });
    var nBands = Math.max.apply(null, items.map(function (d) { return d.thr.length; }).concat([0])) + 1;

    // ---- scale: shared axis, or every row to its own max (axis hidden) ----
    var gmax = 0, gmin = 0;
    items.forEach(function (d) {
      d.max = Math.max.apply(null, [d.value, d.target].concat(d.thr).filter(isNum).concat([0])) * 1.08 || 1;
      gmax = Math.max(gmax, d.max);
      if (!rowScale && d.value != null && d.value < 0) gmin = Math.min(gmin, d.value * 1.08);
    });
    var step = util.niceStep(gmax - gmin, 5), axMax = rowScale ? 1 : Math.ceil(gmax / step) * step;
    var axMin = rowScale ? 0 : Math.floor(gmin / step) * step;   // negative actuals (e.g. net cash) extend the first band
    items.forEach(function (d) {
      var k = rowScale ? 1 / d.max : 1, end = rowScale ? 1 : axMax;
      d.s = function (v) { return v == null ? null : v * k; };
      d.end = end;
    });

    // ---- colours ----
    var shades = [];
    for (var k = 0; k < nBands; k++) shades.push(RK.theme.mix(t.ink3, t.paper, 0.42 + 0.42 * (nBands > 1 ? k / (nBands - 1) : 1)));
    if (!up) shades.reverse();
    function barColor(d) {
      if (d.hi) return t.accent2;
      if (o.colorByTarget && isNum(d.varAbs)) return (d.varAbs >= 0) === up ? t.pos : t.neg;
      return t.accent;
    }

    // ---- band legend names ----
    var bandNames = (o.bandLabels && o.bandLabels.length === nBands) ? o.bandLabels.slice() : (function () {
      var th = bandFields.length ? bandFields.map(function (f) { return ctx.title(f); }) : (o.bands || []).slice().sort(function (a, b) { return a - b; });
      var f = function (v) { return typeof v === 'string' ? v : o.bandMode === 'absolute' ? RK.format(v, baseFmt) : RK.format(v, '0%'); };
      var suffix = !bandFields.length && o.bandMode !== 'absolute' ? ' of target' : '';
      if (th.length + 1 !== nBands) return shades.map(function (_, i) { return 'Band ' + (i + 1); });
      return shades.map(function (_, i) {
        if (i === 0) return '< ' + f(th[0]) + suffix;
        if (i === th.length) return '> ' + f(th[i - 1]) + suffix;
        return f(th[i - 1]) + '–' + f(th[i]) + suffix;
      });
    })();

    var stagger = Math.min(50, 700 / Math.max(1, items.length));
    var series = [];
    var hiIdx = [];
    items.forEach(function (d, i) { if (d.hi) hiIdx.push(i); });
    if (hiIdx.length && o.highlightBand !== false) series.push(rowBand(ctx, hiIdx));

    // qualitative bands: stacked segments, the last one runs to the end of the scale
    if (axMin < 0) {
      series.push({ id: 'band-base', type: 'bar', stack: 'bands', stackStrategy: 'all', yAxisIndex: 0, barWidth: '62%', silent: true,
        itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false }, data: items.map(function () { return axMin; }) });
    }
    for (var b = 0; b < nBands; b++) {
      series.push({
        id: 'band-' + b, name: bandNames[b], type: 'bar', stack: 'bands', stackStrategy: 'all', yAxisIndex: 0, barWidth: '62%', z: 1,
        silent: true, emphasis: { disabled: true }, tooltip: { show: false },
        itemStyle: { color: shades[b] },
        animationDelay: function (i) { return i * stagger * 0.5; },
        data: items.map((function (bi) {
          return function (d) {
            var lo = bi === 0 ? axMin : d.thr[bi - 1], hi = bi < d.thr.length ? d.thr[bi] : (bi === d.thr.length ? (rowScale ? d.max : axMax) : null);
            if (lo == null || hi == null) return 0;
            lo = Math.min(d.s(lo), d.end); hi = Math.min(d.s(hi), d.end);
            return Math.max(0, hi - lo);
          };
        })(b))
      });
    }

    // actual bar (own category axis so it can be thinner and centred over the bands)
    var actualName = o.valueLabel || ctx.title(enc.value);
    series.push({
      id: 'actual', name: actualName, type: 'bar', yAxisIndex: 1, barWidth: '24%', z: 3,
      itemStyle: { color: t.accent },
      emphasis: { itemStyle: { opacity: 0.85 } },
      animationDelay: function (i) { return i * stagger + 150; },
      data: items.map(function (d) {
        return { name: d.label, value: d.s(d.value), itemStyle: { color: C.dim(ctx, enc.label, d.label, barColor(d)) } };
      })
    });

    // target tick
    var targetName = o.targetLabel || (hasTarget ? ctx.title(enc.target) : (o.target === 'median' ? 'Median' : o.target === 'mean' ? 'Mean' : 'Target'));
    series.push({
      id: 'target', name: targetName, type: 'custom', yAxisIndex: 0, z: 4,
      itemStyle: { color: t.ink },
      animationDelay: function (i) { return i * stagger + 380; },
      renderItem: function (params, api) {
        if (isNaN(api.value(1))) return null;
        var p = api.coord([api.value(1), api.value(0)]), h = api.size([0, 1])[1] * 0.3;
        return {
          type: 'rect', shape: { x: p[0] - 1.25, y: p[1] - h, width: 2.5, height: 2 * h },
          style: { fill: t.ink }, enterFrom: { style: { opacity: 0 } }
        };
      },
      data: items.map(function (d, i) { return { name: d.label, value: [i, d.target == null ? NaN : d.s(d.target)] }; })
    });

    // ---- right-hand columns: actual | variance ----
    var showVal = o.labels !== false, showVar = !!o.variance && items.some(function (d) { return d.target != null; });
    var vText = function (d) { return RK.format(d.value, d.fmt); };
    var dText = function (d) { return o.variance === 'abs' ? signed(d.varAbs, d.fmt) : signed(d.varPct, '0.0%'); };
    var numFont = '11px ' + t.fontNum, headFont = '10.5px ' + t.fontSans;
    var vHead = o.valueTitle || 'Actual', dHead = o.varianceTitle || ('vs. ' + targetName.toLowerCase());
    var vW = 0, dW = 0;
    items.forEach(function (d) { vW = Math.max(vW, C.measure(vText(d), numFont)); dW = Math.max(dW, C.measure(dText(d), '600 ' + numFont)); });
    vW = Math.ceil(Math.max(vW, C.measure(vHead, headFont))) + 4;
    dW = Math.ceil(Math.max(dW, C.measure(dHead, headFont))) + 4;
    var colGap = 14;
    var rich = {
      v: { width: showVal ? vW : 0, align: 'right', color: t.ink, fontFamily: t.fontNum, fontSize: 11 },
      g: { width: colGap },
      p: { width: dW, align: 'right', color: t.pos, fontFamily: t.fontNum, fontSize: 11, fontWeight: 600 },
      m: { width: dW, align: 'right', color: t.neg, fontFamily: t.fontNum, fontSize: 11, fontWeight: 600 },
      n: { width: dW, align: 'right', color: t.ink2, fontFamily: t.fontNum, fontSize: 11 },
      hv: { width: showVal ? vW : 0, align: 'right', color: t.ink3, fontSize: 10.5 },
      hd: { width: dW, align: 'right', color: t.ink3, fontSize: 10.5 }
    };
    var colAxis = {
      type: 'category', data: labels, inverse: true, position: 'right',
      show: showVal || showVar, axisLine: { show: false }, axisTick: { show: false },
      name: (showVal ? '{hv|' + vHead + '}' : '') + (showVar ? '{g|}{hd|' + dHead + '}' : ''),
      nameLocation: 'start', nameGap: 8, nameTextStyle: { align: 'left', verticalAlign: 'bottom', padding: [0, 0, 0, 12], rich: rich },
      axisLabel: {
        interval: 0, margin: 12, align: 'left',
        formatter: function (v, i) {
          var d = items[i];
          if (!d) return '';
          var s = showVal ? '{v|' + vText(d) + '}' : '';
          if (showVar) {
            var x = o.variance === 'abs' ? d.varAbs : d.varPct;
            var cls = !isNum(x) || x === 0 ? 'n' : ((x > 0) === up ? 'p' : 'm');
            s += '{g|}{' + cls + '|' + dText(d) + '}';
          }
          return s;
        },
        rich: rich
      }
    };

    var catAxis = {
      type: 'category', data: labels, inverse: true,
      axisLine: { show: true, lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: {
        interval: 0, color: t.ink2, fontSize: 11, width: 150, overflow: 'truncate',
        formatter: function (v, i) { return items[i] && items[i].hi ? '{h|' + v + '}' : v; },
        rich: { h: { color: t.ink, fontWeight: 600, fontSize: 11 } }
      }
    };
    var valAxis = {
      type: 'value', min: axMin, max: axMax, interval: rowScale ? undefined : step, show: !rowScale,
      axisLabel: { formatter: C.axisFmt(tickFmt(baseFmt, step)), hideOverlap: true },
      splitLine: { show: false }
    };

    var legendData = bandNames.map(function (n, i) { return { name: n, itemStyle: { color: shades[i] } }; });
    if (o.colorByTarget) {
      // two swatches explain the pos / neg bar colours; they map to empty series
      var okName = o.metLabel || 'Meets target', koName = o.missLabel || 'Misses target';
      series.push({ id: 'lg-ok', name: okName, type: 'bar', data: [], itemStyle: { color: t.pos } },
        { id: 'lg-ko', name: koName, type: 'bar', data: [], itemStyle: { color: t.neg } });
      legendData.push({ name: okName, itemStyle: { color: t.pos } }, { name: koName, itemStyle: { color: t.neg } });
    } else legendData.push({ name: actualName, itemStyle: { color: t.accent } });
    if (items.some(function (d) { return d.target != null; })) legendData.push({ name: targetName, icon: 'path://M0,0 h3 v14 h-3 z', itemStyle: { color: t.ink } });
    var showLegend = o.legend !== false;

    return {
      legend: C.legend(ctx, { show: showLegend, data: legendData, selectedMode: false }),
      grid: C.grid(ctx, { top: (showLegend ? 30 : 6) + (showVal || showVar ? 16 : 0), left: 4, right: 8, bottom: rowScale ? 2 : 4 }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var d = items[p.dataIndex];
          if (!d || (p.seriesId !== 'actual' && p.seriesId !== 'target')) return '';
          var band = null;
          if (d.value != null) { var bi = 0; while (bi < d.thr.length && d.value >= d.thr[bi]) bi++; band = bandNames[bi]; }
          var tr = [
            { color: barColor(d), label: actualName, value: RK.format(d.value, d.fmt), bold: true },
            { color: t.ink, label: targetName, value: RK.format(d.target, d.fmt) }
          ];
          if (d.target != null) {
            tr.push({ label: 'Variance', value: signed(d.varAbs, d.fmt) });
            tr.push({ label: 'Variance %', value: signed(d.varPct, '0.0%') });
          }
          return C.tip(d.label, tr, band ? 'Band: ' + band : null);
        }
      },
      xAxis: valAxis,
      yAxis: [catAxis, colAxis],
      series: series
    };
  }

  RK.component({
    id: 'bullet',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'label', value: 'value', target: 'target', bands: null, highlight: 'is_target', format: null },
      bands: [0.9, 1],            // band thresholds (ascending): x target ('relative') or values ('absolute')
      bandMode: 'relative',       // relative | absolute
      bandLabels: null,           // legend names, one per band (default derived from thresholds)
      goodDirection: 'up',        // 'up' | 'down' — which end of the scale is good (lightest band)
      target: null,               // constant target without a target field: number | 'median' | 'mean'
      targetExcludeHighlight: true, // a median / mean target is computed without the highlighted (target) rows
      targetLabel: null,          // legend / tooltip name of the target tick
      valueLabel: null,           // legend / tooltip name of the actual bar
      scale: 'shared',            // shared (one value axis) | row (each row scaled to its own max)
      sort: null,                 // null | 'desc' | 'asc' | 'variance'
      labels: true,               // actual value column on the right
      variance: 'pct',            // variance column: 'pct' | 'abs' | null
      valueTitle: null,           // column headers
      varianceTitle: null,
      colorByTarget: false,       // actual bar in pos / neg depending on meeting the target
      metLabel: null,             // legend names with colorByTarget (default 'Meets target' / 'Misses target')
      missLabel: null,
      highlight: null,
      highlightBand: true,
      format: null,
      legend: true
    },
    render: C(build, {
      rebuildOnResize: true,      // the actual | variance columns are measured in px
      select: function (p, ctx) { return p.seriesId === 'actual' || p.seriesId === 'target' ? { field: ctx.enc.label, value: p.name } : null; }
    })
  });
})();
