/*!
 * RK component: sotp — sum-of-the-parts valuation build-up (horizontal, think-cell style).
 * One row per business: EV contribution = metric × multiple range. Each bar floats on the running
 * low-case total — solid = value at the low multiple, light extension = additional value at the high
 * multiple — then corporate costs (negative metric rows), net debt and other deductions walk down to the
 * implied equity value range. Segments use the ordinal ramp (kept clear of the accent), totals the accent;
 * the left column shows the metric × multiple basis, the right column the value per share, and the current
 * share price is a reference line at price × diluted shares on the same USD m scale. Numeric options take
 * '@param' names (netDebt: '@net_debt'), so what-if sliders re-run the build live.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util, isNum = util.isNum;
  var BAR = 0.56;            // bar thickness as share of the row band (connectors and rules use the same value)
  var BAR_MAX = 30;          // px cap on bar thickness
  var LIGHT = 0.6;           // tint of the low -> high range extension (mix with paper)
  var EN = '–';

  /* ---------------- @param binding ---------------- */
  function paramName(v) { return typeof v === 'string' && /^@[A-Za-z_]\w*$/.test(v) ? v.slice(1) : null; }

  /** '@name' option values -> current param value (store, then report manifest params, then options.paramDefaults). */
  function resolver(o) {
    var man = (RK.data.manifest && RK.data.manifest.params) || {};
    return function (v) {
      var p = paramName(v);
      if (!p) return v;
      var x = RK.store.param(p);
      if (x === undefined && Object.prototype.hasOwnProperty.call(man, p)) x = util.isObj(man[p]) ? man[p].value : man[p];
      if (x === undefined && o.paramDefaults && Object.prototype.hasOwnProperty.call(o.paramDefaults, p)) x = o.paramDefaults[p];
      return x === undefined ? null : x;
    };
  }

  /** Every '@param' referenced in the options (encode excluded). */
  function paramRefs(o) {
    var out = [];
    (function walk(v, key) {
      if (key === 'encode') return;
      var p = paramName(v);
      if (p) { if (out.indexOf(p) < 0) out.push(p); return; }
      if (Array.isArray(v)) v.forEach(function (x) { walk(x); });
      else if (util.isObj(v)) Object.keys(v).forEach(function (k) { walk(v[k], k); });
    })(o);
    return out;
  }

  /* ---------------- model ---------------- */
  /** Segment colours: the ordinal ramp minus shades too close to the accent (the totals). */
  function segmentPalette(t, n) {
    var ok = t.ord.filter(function (c) { return RK.theme.distance(c, t.accent) >= 70 && RK.theme.distance(c, t.paper) >= 90; });
    if (ok.length < Math.min(n, 3)) ok = RK.theme.palette({ exclude: [t.accent, t.accent2], n: Math.max(n, 1) });
    var out = ok.slice(), k = 0;
    while (out.length < n) { out.push(RK.theme.mix(ok[k % ok.length], t.paper, 0.35)); k++; }
    return out;
  }

  /**
   * Steps of the build in display order. Every step has a low-case path (start -> end) and a high-case end:
   *   part   start = running low total, end = start + metric × low multiple, hiEnd = start + metric × high multiple
   *   total  0 -> low, hiEnd = high      deduct  start -> start - value (same in both cases)
   */
  function model(ctx) {
    var o = ctx.options, enc = ctx.enc, t = ctx.theme, val = resolver(o);
    var rows = ctx.rows.slice();
    function contrib(r, f) { var m = r[enc.metric], x = r[f]; return isNum(m) && isNum(x) ? m * x : null; }
    if (o.sort === 'desc' || o.sort === 'asc') {
      var mid = function (r) { var a = contrib(r, enc.low), b = contrib(r, enc.high); return ((a || 0) + (b == null ? a || 0 : b)) / 2; };
      rows.sort(function (a, b) { return o.sort === 'asc' ? mid(a) - mid(b) : mid(b) - mid(a); });
    }
    var posRows = rows.filter(function (r) { return !(isNum(r[enc.metric]) && r[enc.metric] < 0); });
    var pal = segmentPalette(t, posRows.length);
    var steps = [], run = 0, evLo = 0, evHi = 0;
    rows.forEach(function (r) {
      var lo = contrib(r, enc.low), hi = contrib(r, enc.high);
      if (lo == null) lo = hi;
      if (hi == null) hi = lo;
      var neg = isNum(r[enc.metric]) && r[enc.metric] < 0;
      var s = { kind: 'part', label: r[enc.label], row: r, lo: lo, hi: hi, start: run, neg: neg,
        color: neg ? t.neutral : pal[posRows.indexOf(r)] };
      if (isNum(lo)) { run += lo; evLo += lo; evHi += hi; }
      s.end = run; s.hiEnd = s.start + (isNum(hi) ? hi : 0);
      steps.push(s);
    });
    var ev = { kind: 'total', key: 'ev', label: o.evLabel, lo: evLo, hi: evHi, start: 0, end: evLo, hiEnd: evHi, color: t.accent };
    steps.push(ev);
    var deds = [];
    var nd = val(o.netDebt);
    if (nd != null) deds.push({ label: o.netDebtLabel, value: nd, note: o.netDebtNote });
    (o.deductions || []).forEach(function (d) { if (d) deds.push({ label: d.label, value: val(d.value), note: d.note }); });
    var eqLo = evLo, eqHi = evHi;
    deds.forEach(function (d) {
      var v = isNum(d.value) ? d.value : null;
      steps.push({ kind: 'deduct', label: d.label, note: d.note, value: v, lo: v == null ? null : -v, hi: v == null ? null : -v,
        start: run, end: run - (v || 0), hiEnd: run - (v || 0), color: t.neutral });
      if (v != null) { run -= v; eqLo -= v; eqHi -= v; }
    });
    if (deds.length) steps.push({ kind: 'total', key: 'equity', label: o.equityLabel, lo: eqLo, hi: eqHi, start: 0, end: eqLo, hiEnd: eqHi, color: t.accent });
    steps.forEach(function (s, i) { s.i = i; s.pieces = pieces(s); });

    var shares = val(o.shares);
    var refs = [];
    var price = val(o.refPrice);
    if (isNum(price) && isNum(shares)) refs.push({ price: price, label: o.refLabel, color: null });
    (o.refLines || []).forEach(function (r) {
      var p = r ? val(r.price) : null;
      if (isNum(p) && isNum(shares)) refs.push({ price: p, label: r.label, color: r.color ? RK.theme.resolve(r.color) : null });
    });
    refs.forEach(function (r) { r.value = r.price * shares; });
    var evm = o.evMetric ? { label: o.evMetric.label, value: val(o.evMetric.value) } : null;
    return { steps: steps, ev: ev, equity: deds.length ? steps[steps.length - 1] : null, shares: isNum(shares) ? shares : null,
      refs: refs, refPrice: isNum(price) ? price : null, evMetric: evm };
  }

  /**
   * The two adjacent pieces of a step, left to right: solid = low case, light = low -> high extension.
   * When the high case adds less than the low case (a range that shrinks) the light piece is the low-only part.
   */
  function pieces(s) {
    var x0 = s.start, x1 = s.end, x2 = s.hiEnd;
    var d1 = Math.sign(x1 - x0), d2 = Math.sign(x2 - x1);
    var solid, light;
    if (!d2 || !d1 || d1 === d2) { solid = [x0, x1]; light = [x1, x2]; } else { solid = [x0, x2]; light = [x2, x1]; }
    var a = { from: Math.min(solid[0], solid[1]), to: Math.max(solid[0], solid[1]), light: false };
    var b = { from: Math.min(light[0], light[1]), to: Math.max(light[0], light[1]), light: true };
    var left = a.from <= b.from ? a : b, right = left === a ? b : a;
    if (left.to - left.from < 1e-9 && right === a) { left = a; right = b; }   // empty pieces keep a stable order
    return { left: left, right: right, min: Math.min(a.from, b.from), max: Math.max(a.to, b.to),
      dir: s.kind === 'deduct' || (s.kind === 'part' && (s.lo || 0) < 0) ? -1 : 1 };
  }

  /* ---------------- chart ---------------- */
  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var M = model(ctx), steps = M.steps, n = steps.length;
    var fmt = o.format || '#,##0;(#,##0)';
    var psFmt = o.perShareFormat || '$#,##0.00;($#,##0.00)';
    var mFmt = o.multipleFormat || ctx.fmtOf(enc.low) || '0.0x';
    var metFmt = o.metricFormat || ctx.fmtOf(enc.metric) || '#,##0.0;(#,##0.0)';
    var showPS = o.perShare !== false && M.shares != null;

    function range(lo, hi, f) {
      if (!isNum(lo) && !isNum(hi)) return RK.format(null, f);
      if (!isNum(hi) || Math.abs(hi - lo) < 1e-9) return RK.format(lo, f);
      return RK.format(lo, f) + ' ' + EN + ' ' + RK.format(hi, f);
    }
    function perShare(s) {
      if (!showPS) return '';
      return range(isNum(s.lo) ? s.lo / M.shares : null, isNum(s.hi) ? s.hi / M.shares : null, psFmt);
    }
    function colorOf(s, light) {
      var c = s.kind === 'part' && s.row ? C.dim(ctx, enc.label, s.label, s.color) : s.color;
      return light ? RK.theme.mix(c, t.paper, LIGHT) : c;
    }
    function basisOf(s) {
      if (s.kind === 'part') {
        var r = s.row, name = enc.metricName ? r[enc.metricName] : null;
        var mult = isNum(r[enc.low]) && isNum(r[enc.high]) && r[enc.low] !== r[enc.high]
          ? RK.format(r[enc.low], mFmt) + EN + RK.format(r[enc.high], mFmt) : RK.format(isNum(r[enc.low]) ? r[enc.low] : r[enc.high], mFmt);
        return (name ? name + ' ' : '') + RK.format(r[enc.metric], metFmt) + ' × ' + mult;
      }
      if (s.key === 'ev' && M.evMetric && isNum(M.evMetric.value) && M.evMetric.value > 0) {
        return 'Implied ' + range(s.lo / M.evMetric.value, s.hi / M.evMetric.value, mFmt) + ' ' + (M.evMetric.label || '');
      }
      if (s.key === 'equity') {
        if (o.equityNote != null) return o.equityNote;
        return M.shares != null ? RK.format(M.shares, '#,##0.0') + 'm diluted shares' : '';
      }
      if (s.kind === 'deduct') return s.note || '';
      return '';
    }
    function valueText(s) {
      if (s.kind === 'deduct') return RK.format(s.lo, fmt);
      return range(s.lo, s.hi, fmt);
    }

    // ---- geometry: label columns (px) -> plot width -> axis range with room for the value labels ----
    var W = inst.getWidth() || ctx.el.clientWidth || 800;
    var fontN = '11px ' + t.fontSans, fontB = '600 11px ' + t.fontSans, fontS = '10px ' + t.fontSans, fontV = '11px ' + t.fontNum;
    var leftW = 0;
    steps.forEach(function (s) {
      leftW = Math.max(leftW, C.measure(s.label, s.kind === 'total' ? fontB : fontN), o.showBasis !== false ? C.measure(basisOf(s), fontS) : 0);
    });
    leftW = Math.min(leftW, Math.max(150, W * 0.3));
    var rightW = 0;
    if (showPS) steps.forEach(function (s) { rightW = Math.max(rightW, C.measure(perShare(s), s.kind === 'total' ? '600 11px ' + t.fontNum : fontV)); });
    rightW = Math.max(rightW, showPS ? C.measure(o.perShareTitle || '', '600 10px ' + t.fontSans) : 0);
    var plotW = Math.max(160, W - leftW - (showPS ? rightW + 28 : 0) - 24);
    var xs = [0];
    steps.forEach(function (s) { xs.push(s.pieces.min, s.pieces.max); });
    M.refs.forEach(function (r) { xs.push(r.value); });
    var ext = util.extent(xs), axMin = Math.min(0, ext[0]), axMax = ext[1];
    var labs = o.labels === false ? [] : steps.map(function (s) {
      var w = C.measure(valueText(s), (s.kind === 'total' ? '600 ' : '') + fontV) + 10;
      return { x: s.pieces.dir < 0 ? s.pieces.min : s.pieces.max, w: w, dir: s.pieces.dir };
    });
    for (var it = 0; it < 4; it++) {           // value per px depends on the range it extends: iterate to a fixed point
      var per = (axMax - axMin) / plotW;
      labs.forEach(function (l) {
        if (l.dir > 0) axMax = Math.max(axMax, l.x + l.w * per);
        else axMin = Math.min(axMin, l.x - l.w * per);
      });
    }
    axMax += (axMax - axMin) * 0.01;
    var interval = null;
    if (o.valueAxis) {
      interval = util.niceStep(axMax - axMin, Math.max(2, Math.min(7, Math.floor(plotW / 80))));
      axMax = Math.ceil(axMax / interval) * interval;
      axMin = Math.floor(axMin / interval) * interval;
    }

    // ---- reference lines (current price x shares) with labels above the plot, spread apart ----
    var refFont = '600 11px ' + t.fontSans, x0 = W - plotW - (showPS ? rightW + 28 : 0) - 8;
    var refTexts = M.refs.map(function (r) { return r.label || (o.refLabel || 'Current') + ' ' + RK.format(r.price, psFmt); });
    var gap = Math.max.apply(null, refTexts.map(function (s) { return C.measure(s, refFont); }).concat([0])) + 12;
    var rxs = M.refs.map(function (r) { return x0 + (r.value - axMin) / (axMax - axMin) * plotW; });
    var spread = C.spreadLabels(rxs, gap, gap / 2, W - gap / 2);
    var marks = M.refs.map(function (r, k) {
      var col = r.color || t.ref;
      return {
        xAxis: r.value,
        lineStyle: { color: col, type: 'dashed', width: 1.25 },
        label: { show: true, position: 'start', distance: 4, offset: [spread[k] - rxs[k], 0], formatter: refTexts[k], color: col, fontWeight: 600, fontSize: 11, fontFamily: t.fontSans }
      };
    });

    var showLegend = o.legend !== false;
    var top = (showLegend ? 26 : 4) + (marks.length ? 22 : (showPS ? 16 : 6));
    var stagger = Math.min(80, 720 / Math.max(1, n));
    var delay = function (i) { return i * stagger; };

    function pieceData(side) {
      return steps.map(function (s) {
        var p = s.pieces[side];
        return { name: s.label, value: p.to - p.from, itemStyle: { color: colorOf(s, p.light) } };
      });
    }
    var series = [
      { id: 'base', type: 'bar', stack: 'sotp', stackStrategy: 'all', silent: true, barWidth: (BAR * 100) + '%', barMaxWidth: BAR_MAX,
        itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false }, animationDelay: delay,
        data: steps.map(function (s) { return s.pieces.left.from; }),
        markLine: marks.length ? { silent: true, symbol: ['none', 'none'], z: 8, data: marks, animation: false } : undefined },
      { id: 'p1', name: 'p1', type: 'bar', stack: 'sotp', stackStrategy: 'all', barWidth: (BAR * 100) + '%', barMaxWidth: BAR_MAX,
        emphasis: { focus: 'none', itemStyle: { opacity: 0.88 } }, animationDelay: delay, data: pieceData('left') },
      { id: 'p2', name: 'p2', type: 'bar', stack: 'sotp', stackStrategy: 'all', barWidth: (BAR * 100) + '%', barMaxWidth: BAR_MAX,
        emphasis: { focus: 'none', itemStyle: { opacity: 0.88 } }, animationDelay: function (i) { return delay(i) + 140; }, data: pieceData('right') }
    ];

    // value labels on a ghost series: right of rows that build up, left of deductions / costs
    if (o.labels !== false) {
      series.push({
        id: 'vals', type: 'scatter', silent: true, symbolSize: 0, z: 6, tooltip: { show: false },
        animationDelay: function (i) { return delay(i) + 260; },
        data: steps.map(function (s, i) {
          var tot = s.kind === 'total';
          return { value: [labs[i].x, i], label: { position: labs[i].dir < 0 ? 'left' : 'right', fontWeight: tot ? 600 : 400, color: tot ? t.ink : t.ink2 } };
        }),
        label: { show: true, distance: 5, fontSize: 11, fontFamily: t.fontNum, formatter: function (p) { return valueText(steps[p.dataIndex]); } }
      });
    }

    // think-cell connectors along the low-case running total + a rule above each total row
    function band(api) { return api.size([0, 1])[1]; }
    if (o.connectors !== false && n > 1) {
      series.push({
        id: 'conn', type: 'custom', silent: true, z: 1, tooltip: { show: false },
        animationDelay: function (i) { return (i + 1) * stagger + 300; },
        renderItem: function (params, api) {
          var i = api.value(0), lvl = api.value(1);
          var a = api.coord([lvl, i]), b = api.coord([lvl, i + 1]), half = Math.min(band(api) * BAR, BAR_MAX) / 2;
          return { type: 'line', shape: { x1: a[0], y1: a[1] + half, x2: b[0], y2: b[1] - half },
            style: { stroke: t.axis, lineWidth: 1, lineDash: [3, 2] }, enterFrom: { style: { opacity: 0 } } };
        },
        data: steps.slice(0, -1).map(function (s, i) { return [i, s.end]; })
      });
    }
    series.push({
      id: 'rules', type: 'custom', silent: true, z: 0, tooltip: { show: false },
      renderItem: function (params, api) {
        var i = api.value(0), y = Math.round(api.coord([0, i])[1] - band(api) / 2) + 0.5;
        return { type: 'line', shape: { x1: 4, y1: y, x2: api.getWidth() - 4, y2: y }, style: { stroke: t.rule, lineWidth: 1 } };
      },
      data: steps.filter(function (s) { return s.kind === 'total'; }).map(function (s) { return [s.i]; })
    });

    // legend: what solid vs. light means (empty series carry the swatches)
    var keyLow = o.lowLabel, keyHigh = o.highLabel;
    if (showLegend) {
      series.push({ id: 'key-lo', name: keyLow, type: 'bar', data: [], itemStyle: { color: t.accent } });
      series.push({ id: 'key-hi', name: keyHigh, type: 'bar', data: [], itemStyle: { color: RK.theme.mix(t.accent, t.paper, LIGHT) } });
    }

    var labels = steps.map(function (s) { return s.label; });
    var rich = {
      n: { color: t.ink2, fontSize: 11, lineHeight: 14, fontFamily: t.fontSans },
      t: { color: t.ink, fontSize: 11, lineHeight: 14, fontWeight: 600, fontFamily: t.fontSans },
      b: { color: t.ink3, fontSize: 10, lineHeight: 13, fontFamily: t.fontSans },
      v: { color: t.ink2, fontSize: 11, fontFamily: t.fontNum },
      V: { color: t.ink, fontSize: 11, fontWeight: 600, fontFamily: t.fontNum }
    };
    var yAxes = [{
      type: 'category', data: labels, inverse: true,
      axisLine: { show: true, lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: {
        interval: 0, margin: 10, rich: rich,
        formatter: function (v, i) {
          var s = steps[i];
          if (!s) return v;
          var b = o.showBasis !== false ? basisOf(s) : '';
          return '{' + (s.kind === 'total' ? 't' : 'n') + '|' + v + '}' + (b ? '\n{b|' + b + '}' : '');
        }
      }
    }];
    if (showPS) {
      yAxes.push({
        type: 'category', data: labels, inverse: true, position: 'right',
        axisLine: { show: false }, axisTick: { show: false },
        name: o.perShareTitle, nameLocation: 'start', nameGap: 8,
        nameTextStyle: { color: t.ink3, fontSize: 10, fontWeight: 600, align: 'left', padding: [0, 0, 0, 10] },
        axisLabel: {
          interval: 0, margin: 10, rich: rich,
          formatter: function (v, i) { var s = steps[i]; return s ? '{' + (s.kind === 'total' ? 'V' : 'v') + '|' + perShare(s) + '}' : ''; }
        }
      });
    }

    return {
      legend: C.legend(ctx, { show: showLegend, data: showLegend ? [keyLow, keyHigh] : [], selectedMode: false }),
      grid: { left: 4, right: 4, top: top, bottom: o.valueAxis ? 4 : 2, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          if (p.seriesId !== 'p1' && p.seriesId !== 'p2') return '';
          return tipFor(steps[p.dataIndex]);
        }
      },
      xAxis: {
        type: 'value', min: axMin, max: axMax, interval: interval || undefined,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: !!o.valueAxis, formatter: C.tickFmt(fmt, interval) },
        splitLine: { show: !!o.valueAxis }
      },
      yAxis: yAxes,
      series: series
    };

    /* ---- tooltip: the metric x multiple math ---- */
    function tipFor(s) {
      if (!s) return '';
      var rows = [], foot = null;
      if (s.kind === 'part') {
        var r = s.row, name = (enc.metricName && r[enc.metricName]) || ctx.title(enc.metric);
        rows.push({ color: s.color, label: name, value: RK.format(r[enc.metric], metFmt) });
        rows.push({ label: '× ' + RK.format(r[enc.low], mFmt) + ' (low)', value: RK.format(s.lo, fmt) });
        rows.push({ label: '× ' + RK.format(r[enc.high], mFmt) + ' (high)', value: RK.format(s.hi, fmt) });
        if (isNum(s.lo) && M.ev.lo && M.ev.hi) {
          rows.push({ label: 'Share of EV', value: RK.format(((s.lo / M.ev.lo) + (s.hi / M.ev.hi)) / 2, '0.0%') });
        }
        if (showPS) rows.push({ label: 'Per share', value: perShare(s), bold: true });
        foot = [enc.method ? r[enc.method] : null, enc.note ? r[enc.note] : null].filter(Boolean).join(' · ') || null;
      } else if (s.kind === 'deduct') {
        rows.push({ color: s.color, label: s.label, value: RK.format(s.lo, fmt), bold: true });
        if (showPS) rows.push({ label: 'Per share', value: perShare(s) });
        foot = s.note || null;
      } else {
        rows.push({ color: t.accent, label: 'Low', value: RK.format(s.lo, fmt) });
        rows.push({ color: RK.theme.mix(t.accent, t.paper, LIGHT), label: 'High', value: RK.format(s.hi, fmt) });
        rows.push({ label: 'Midpoint', value: RK.format((s.lo + s.hi) / 2, fmt) });
        if (s.key === 'ev' && M.evMetric && isNum(M.evMetric.value) && M.evMetric.value > 0) {
          rows.push({ label: 'Implied ' + (M.evMetric.label || 'multiple'), value: range(s.lo / M.evMetric.value, s.hi / M.evMetric.value, mFmt) });
        }
        if (showPS) rows.push({ label: 'Per share', value: perShare(s), bold: true });
        if (s.key === 'equity' && showPS && M.refPrice) {
          rows.push({ label: 'vs. current ' + RK.format(M.refPrice, psFmt), value: range(s.lo / M.shares / M.refPrice - 1, s.hi / M.shares / M.refPrice - 1, '+0.0%;(0.0%);0.0%') });
        }
      }
      return C.tip(s.label, rows, foot);
    }
  }

  var chartRender = C(build, {
    rebuildOnResize: true,      // label columns and the room for value labels depend on the width
    select: function (p, ctx, inst) {
      if (p.seriesId !== 'p1' && p.seriesId !== 'p2') return null;
      var cats = ((inst.getOption().yAxis || [])[0] || {}).data || [];
      var rows = ctx.rows.filter(function (r) { return r[ctx.enc.label] === cats[p.dataIndex]; });
      return rows.length ? { field: ctx.enc.label, value: cats[p.dataIndex] } : null;
    }
  });

  RK.component({
    id: 'sotp',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'segment', metric: 'metric_value', metricName: 'metric_name', low: 'multiple_low', high: 'multiple_high', method: 'method', note: null },
      netDebt: null,             // number | '@param' — deducted from the EV build (USD m)
      netDebtLabel: 'Less: net debt',
      netDebtNote: null,         // second line under the net debt label (e.g. 'As of 30-Jun-2026')
      deductions: [],            // [{label, value, note}] further EV -> equity items; positive value = deduction, negative = addition
      shares: null,              // diluted shares (m) | '@param' — per-share column and reference lines
      refPrice: null,            // current share price | '@param' — dashed reference line at price × shares (theme ref colour)
      refLabel: null,            // reference-line caption prefix (default 'Current')
      refLines: [],              // [{price, label, color}] further per-share reference lines (e.g. offer price in 'accent2')
      evMetric: null,            // {label, value} — implied multiple under the EV total (e.g. {label: 'EV / EBITDA 2026E', value: 996.5})
      evLabel: 'Enterprise value',
      equityLabel: 'Equity value',
      equityNote: null,          // second line under the equity total (default: '158.0m diluted shares')
      lowLabel: 'Low multiple',  // legend: solid part of each bar
      highLabel: 'Range to high multiple',
      perShare: true,            // right-hand value-per-share column (needs shares)
      perShareTitle: 'Per share',
      showBasis: true,           // metric × multiple line under each segment name
      sort: null,                // null (data order) | 'desc' | 'asc' by midpoint contribution
      format: null,              // value format (USD m); default '#,##0;(#,##0)'
      perShareFormat: null,      // default '$#,##0.00;($#,##0.00)'
      multipleFormat: null,      // default: the multiple_low field format ('0.0x')
      metricFormat: null,        // default: the metric field format
      labels: true,              // low – high value labels at the bar ends
      connectors: true,          // dashed connectors along the low-case running total
      valueAxis: false,          // value axis with gridlines (labels carry the numbers by default)
      legend: true,
      paramDefaults: {},         // fallback values for '@param' options the report does not define
      crossFilter: true
    },
    render: function (ctx) {
      // '@param' options the report does not define start at options.paramDefaults (shared with sliders)
      var val = resolver(ctx.options), undef = {};
      paramRefs(ctx.options).forEach(function (p) { if (RK.store.param(p) === undefined) { var v = val('@' + p); if (v != null) undef[p] = v; } });
      RK.store.defineParams(undef);

      var api = chartRender(ctx), cur = ctx, names = paramRefs(ctx.options);
      var unsub = RK.store.subscribe(function (changes) {
        if (names.length && changes.some(function (c) { return c.type === 'param' && names.indexOf(c.key) >= 0; })) api.update(cur);
      });
      return {
        chart: api.chart,
        update: function (c) { cur = c; names = paramRefs(c.options); api.update(c); },
        resize: api.resize,
        destroy: function () { unsub(); api.destroy(); },
        exportImage: api.exportImage,
        exportSVG: api.exportSVG
      };
    }
  });
})();
