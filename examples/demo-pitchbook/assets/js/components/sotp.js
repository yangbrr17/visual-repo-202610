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

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'sotp.netDebtLabel': '减：净债务', 'sotp.evLabel': '企业价值', 'sotp.equityLabel': '股权价值', 'sotp.lowLabel': '低倍数',
      'sotp.highLabel': '至高倍数区间', 'sotp.perShareTitle': '每股价值', 'sotp.current': '现价', 'sotp.selectedOnly': '仅含所选分部（{n} / {total}）',
      'sotp.impliedBasis': '隐含{metric} {range}', 'sotp.implied': '隐含 {range}', 'sotp.shares': '完全稀释股数 {shares} 百万股',
      'sotp.low': '{mult}（低）', 'sotp.high': '{mult}（高）', 'sotp.shareOfEv': '占企业价值比例', 'sotp.perShare': '每股价值', 'sotp.lowV': '低值',
      'sotp.highV': '高值', 'sotp.mid': '中值', 'sotp.impliedMetric': '隐含{metric}', 'sotp.multiple': '倍数', 'sotp.vsCurrent': '较现价 {price}'
    });
  }
  // default labels (options left at their English defaults follow the report locale; custom labels are kept)
  var LABELS = {
    netDebtLabel: 'Less: net debt', evLabel: 'Enterprise value', equityLabel: 'Equity value', lowLabel: 'Low multiple',
    highLabel: 'Range to high multiple', perShareTitle: 'Per share'
  };
  /** Option label o[k], translated when it is the English default. */
  function lab(o, k) { var v = o[k]; return v === LABELS[k] ? tr('sotp.' + k, v) : v; }
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
  /**
   * Segment colours from the ordinal ramp: shades too close to the accent (the totals), the paper or the text ink are
   * dropped; n colours are then picked evenly along what is left (interpolated when fewer shades remain), so the
   * segments always read as one ordered family and never borrow a categorical hue.
   */
  function hueSat(c) {
    var x = RK.theme.parseColor(c).slice(0, 3).map(function (v) { return v / 255; });
    var mx = Math.max.apply(null, x), mn = Math.min.apply(null, x), d = mx - mn, l = (mx + mn) / 2, hh = 0;
    if (d) hh = mx === x[0] ? ((x[1] - x[2]) / d + 6) % 6 : mx === x[1] ? (x[2] - x[0]) / d + 2 : (x[0] - x[1]) / d + 4;
    return [hh * 60, d ? d / (1 - Math.abs(2 * l - 1)) : 0];
  }
  function segmentPalette(t, n) {
    var D = RK.theme.distance;
    // a theme that defines fewer ramp shades inherits the default theme's from :root (another hue): drop off-hue shades
    var ref = hueSat(t.ord[Math.min(1, t.ord.length - 1)] || t.accent);
    var ord = t.ord.filter(function (c) {
      var hs = hueSat(c), dh = Math.abs(hs[0] - ref[0]);
      return hs[1] < 0.12 || ref[1] < 0.12 || Math.min(dh, 360 - dh) <= 50;
    });
    var ok = ord.filter(function (c) { return D(c, t.accent) >= 70 && D(c, t.paper) >= 90 && D(c, t.ink) >= 80; });
    if (ok.length < 2) ok = ord.filter(function (c) { return D(c, t.paper) >= 60; });
    if (!ok.length) ok = [t.accent3 || t.accent];
    if (n <= 1 || ok.length === 1) return Array.apply(null, Array(Math.max(n, 1))).map(function () { return ok[0]; });
    var r = RK.theme.ramp(ok), out = [];
    for (var i = 0; i < n; i++) out.push(ok.length >= n ? ok[Math.round(i * (ok.length - 1) / (n - 1))] : r(i / (n - 1)));
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
    var ev = { kind: 'total', key: 'ev', label: lab(o, 'evLabel'), lo: evLo, hi: evHi, start: 0, end: evLo, hiEnd: evHi, color: t.accent };
    var dedColor = RK.theme.mix(t.neutral, t.ink3, 0.45);   // deductions: a darker grey than the range tints
    steps.push(ev);
    var deds = [];
    var nd = val(o.netDebt);
    if (nd != null) deds.push({ label: lab(o, 'netDebtLabel'), value: nd, note: o.netDebtNote });
    (o.deductions || []).forEach(function (d) { if (d) deds.push({ label: d.label, value: val(d.value), note: d.note }); });
    var eqLo = evLo, eqHi = evHi;
    deds.forEach(function (d) {
      var v = isNum(d.value) ? d.value : null;
      steps.push({ kind: 'deduct', label: d.label, note: d.note, value: v, lo: v == null ? null : -v, hi: v == null ? null : -v,
        start: run, end: run - (v || 0), hiEnd: run - (v || 0), color: dedColor });
      if (v != null) { run -= v; eqLo -= v; eqHi -= v; }
    });
    if (deds.length) steps.push({ kind: 'total', key: 'equity', label: lab(o, 'equityLabel'), lo: eqLo, hi: eqHi, start: 0, end: eqLo, hiEnd: eqHi, color: t.accent });
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
    // one optional extra decimal so 3.25x is not shown as 3.3x ('0.0x' -> '0.0#x')
    var mFmtCalc = o.multipleFormat || ctx.fmtOf(enc.low) || '0.0x';
    var mFmt = o.multipleFormat || String(RK.format.presets[mFmtCalc] || mFmtCalc).replace(/(\.0+)(?![0#])/, '$1#');
    var metFmt = o.metricFormat || ctx.fmtOf(enc.metric) || '#,##0.0;(#,##0.0)';
    var showPS = o.perShare !== false && M.shares != null;
    var partial = ctx.rows.length < ctx.allRows.length;

    function range(lo, hi, f) {
      if (!isNum(lo) && !isNum(hi)) return RK.format(null, f);
      if (!isNum(hi) || Math.abs(hi - lo) < 1e-9) return RK.format(lo, f);
      return RK.format(lo, f) + ' ' + EN + ' ' + RK.format(hi, f);
    }
    function perShare(s) {
      if (!showPS) return '';
      return range(isNum(s.lo) ? s.lo / M.shares : null, isNum(s.hi) ? s.hi / M.shares : null, psFmt);
    }
    // totals: the light range part is a tint of accent3 (a tint of the dark accent itself turns grey, like the deductions)
    var totalLight = RK.theme.mix(t.accent3 || t.accent, t.paper, 0.45);
    function colorOf(s, light) {
      if (s.kind === 'total') return light ? totalLight : s.color;
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
      // a cross-filter elsewhere narrowed the segments: the totals are partial, the group multiple does not apply
      if (s.key === 'ev' && partial) return tr('sotp.selectedOnly', 'Selected segments only ({n} of {total})', { n: ctx.rows.length, total: ctx.allRows.length });
      if (s.key === 'ev' && M.evMetric && isNum(M.evMetric.value) && M.evMetric.value > 0) {
        return tr('sotp.impliedBasis', 'Implied {range} {metric}', { range: range(s.lo / M.evMetric.value, s.hi / M.evMetric.value, mFmtCalc), metric: M.evMetric.label || '' }).trim();
      }
      if (s.key === 'equity') {
        if (o.equityNote != null) return o.equityNote;
        return M.shares != null ? tr('sotp.shares', '{shares}m diluted shares', { shares: RK.format(M.shares, '#,##0.0') }) : '';
      }
      if (s.kind === 'deduct') return s.note || '';
      return '';
    }
    /**
     * Basis line variants, longest first: a basis that does not fit the label column is shortened at a clause or term
     * boundary (metric name dropped, trailing clauses cut), never mid-number; '' (no line) when nothing fits.
     */
    function basisVariants(s) {
      var full = basisOf(s);
      if (!full) return [''];
      var out = [full];
      if (s.kind === 'part') {
        var r = s.row, mult = isNum(r[enc.low]) && isNum(r[enc.high]) && r[enc.low] !== r[enc.high]
          ? RK.format(r[enc.low], mFmt) + EN + RK.format(r[enc.high], mFmt) : RK.format(isNum(r[enc.low]) ? r[enc.low] : r[enc.high], mFmt);
        out.push(RK.format(r[enc.metric], metFmt) + ' × ' + mult, mult);
      } else if (s.key === 'ev' && !partial && M.evMetric && isNum(M.evMetric.value) && M.evMetric.value > 0) {
        out.push(tr('sotp.implied', 'Implied {range}', { range: range(s.lo / M.evMetric.value, s.hi / M.evMetric.value, mFmtCalc) }));
      } else {
        var parts = full.split(/(?:,|;)\s+/);
        for (var k = parts.length - 1; k > 0; k--) out.push(parts.slice(0, k).join(', ') + ' …');
      }
      out.push('');
      return out;
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
    leftW = Math.ceil(Math.min(leftW, Math.max(150, W * 0.34)));
    // the basis line that fits the column (figures are never truncated: shorter wording, else no basis line)
    var basisText = steps.map(function (s) {
      if (o.showBasis === false) return '';
      var vs = basisVariants(s);
      for (var k = 0; k < vs.length; k++) if (C.measure(vs[k], fontS) <= leftW) return vs[k];
      return '';
    });
    var rightW = 0;
    if (showPS) steps.forEach(function (s) { rightW = Math.max(rightW, C.measure(perShare(s), s.kind === 'total' ? '600 11px ' + t.fontNum : fontV)); });
    rightW = Math.max(rightW, showPS ? C.measure(lab(o, 'perShareTitle') || '', '600 10px ' + t.fontSans) : 0);
    rightW = Math.ceil(rightW);
    // explicit layout (containLabel ignores the right-aligned per-share column): label column | plot | per-share column
    var gridL = 4 + leftW + 10, gridR = showPS ? rightW + 18 : 16;
    var plotW = Math.max(160, W - gridL - gridR);
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
    var refFont = '600 11px ' + t.fontSans, x0 = gridL;
    var refTexts = M.refs.map(function (r) { return r.label || (o.refLabel || tr('sotp.current', 'Current')) + ' ' + RK.format(r.price, psFmt); });
    var gap = Math.max.apply(null, refTexts.map(function (s) { return C.measure(s, refFont); }).concat([0])) + 12;
    var rxs = M.refs.map(function (r) { return x0 + (r.value - axMin) / (axMax - axMin) * plotW; });
    var spread = C.spreadLabels(rxs, gap, gap / 2, W - gap / 2);
    var marks = M.refs.map(function (r, k) {
      var col = r.color || t.ref;
      return {
        xAxis: r.value,
        lineStyle: { color: col, type: 'dashed', width: 1.25 },
        // a function, not a template string: '{b}' / '{c}' in a caption is never substituted, braces never start a style run
        label: { show: true, position: 'start', distance: 4, offset: [spread[k] - rxs[k], 0], formatter: function () { return C.richSafe(refTexts[k]); },
          color: col, fontWeight: 600, fontSize: 11, fontFamily: t.fontSans }
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
        markLine: marks.length ? { silent: true, symbol: ['none', 'none'], data: marks, animation: false } : undefined },
      { id: 'p1', name: 'p1', type: 'bar', stack: 'sotp', stackStrategy: 'all', barWidth: (BAR * 100) + '%', barMaxWidth: BAR_MAX,
        emphasis: { focus: 'none', itemStyle: { opacity: 0.88 } }, animationDelay: delay, data: pieceData('left') },
      { id: 'p2', name: 'p2', type: 'bar', stack: 'sotp', stackStrategy: 'all', barWidth: (BAR * 100) + '%', barMaxWidth: BAR_MAX,
        emphasis: { focus: 'none', itemStyle: { opacity: 0.88 } }, animationDelay: function (i) { return delay(i) + 140; }, data: pieceData('right') }
    ];

    // value labels on a ghost series: right of rows that build up, left of deductions / costs
    if (o.labels !== false) {
      series.push({
        id: 'vals', type: 'scatter', silent: true, symbolSize: 0, z: 10, tooltip: { show: false }, itemStyle: { opacity: 1 },
        animationDelay: function (i) { return delay(i) + 260; },
        data: steps.map(function (s, i) {
          var tot = s.kind === 'total';
          return { value: [labs[i].x, i], label: { position: labs[i].dir < 0 ? 'left' : 'right', fontWeight: tot ? 600 : 400, color: tot ? t.ink : t.ink2 } };
        }),
        // paper backing: a reference line crossing a label never runs through the figures
        label: { show: true, distance: 3, padding: [1, 2], backgroundColor: t.paper, fontSize: 11, fontFamily: t.fontNum,
          formatter: function (p) { return valueText(steps[p.dataIndex]); } }
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
    var keyLow = lab(o, 'lowLabel'), keyHigh = lab(o, 'highLabel');
    if (showLegend) {
      series.push({ id: 'key-lo', name: keyLow, type: 'bar', data: [], itemStyle: { color: t.accent } });
      series.push({ id: 'key-hi', name: keyHigh, type: 'bar', data: [], itemStyle: { color: totalLight } });
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
        interval: 0, margin: 10, rich: rich, width: leftW, overflow: 'truncate',
        formatter: function (v, i) {
          var s = steps[i];
          if (!s) return v;
          var b = basisText[i];   // data strings go into the rich template brace-safe
          return '{' + (s.kind === 'total' ? 't' : 'n') + '|' + C.richSafe(v) + '}' + (b ? '\n{b|' + C.richSafe(b) + '}' : '');
        }
      }
    }];
    if (showPS) {
      yAxes.push({
        type: 'category', data: labels, inverse: true, position: 'right',
        axisLine: { show: false }, axisTick: { show: false },
        // right-aligned like a table column: the margin spans the widest label
        axisLabel: {
          interval: 0, margin: rightW + 14, align: 'right', rich: rich,
          formatter: function (v, i) { var s = steps[i]; return s ? '{' + (s.kind === 'total' ? 'V' : 'v') + '|' + C.richSafe(perShare(s)) + '}' : ''; }
        }
      });
    }

    return {
      legend: C.legend(ctx, { show: showLegend, data: showLegend ? [keyLow, keyHigh] : [], selectedMode: false }),
      // per-share column heading, right-aligned over the column (level with the reference-line captions)
      graphic: showPS && o.perShareTitle ? [{ type: 'text', id: 'ps-title', right: 4, top: top - 18, silent: true,
        style: { text: lab(o, 'perShareTitle'), fill: t.ink3, font: '600 10px ' + t.fontSans, textAlign: 'right' } }] : [],
      grid: { left: gridL, right: gridR, top: top, bottom: o.valueAxis ? 24 : 4, containLabel: false },
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
        rows.push({ label: '× ' + tr('sotp.low', '{mult} (low)', { mult: RK.format(r[enc.low], mFmt) }), value: RK.format(s.lo, fmt) });
        rows.push({ label: '× ' + tr('sotp.high', '{mult} (high)', { mult: RK.format(r[enc.high], mFmt) }), value: RK.format(s.hi, fmt) });
        if (isNum(s.lo) && M.ev.lo && M.ev.hi) {
          rows.push({ label: tr('sotp.shareOfEv', 'Share of EV'), value: RK.format(((s.lo / M.ev.lo) + (s.hi / M.ev.hi)) / 2, '0.0%') });
        }
        if (showPS) rows.push({ label: tr('sotp.perShare', 'Per share'), value: perShare(s), bold: true });
        foot = [enc.method ? r[enc.method] : null, enc.note ? r[enc.note] : null].filter(Boolean).join(' · ') || null;
      } else if (s.kind === 'deduct') {
        rows.push({ color: s.color, label: s.label, value: RK.format(s.lo, fmt), bold: true });
        if (showPS) rows.push({ label: tr('sotp.perShare', 'Per share'), value: perShare(s) });
        foot = s.note || null;
      } else {
        rows.push({ color: t.accent, label: tr('sotp.lowV', 'Low'), value: RK.format(s.lo, fmt) });
        rows.push({ color: totalLight, label: tr('sotp.highV', 'High'), value: RK.format(s.hi, fmt) });
        rows.push({ label: tr('sotp.mid', 'Midpoint'), value: RK.format((s.lo + s.hi) / 2, fmt) });
        if (s.key === 'ev' && !partial && M.evMetric && isNum(M.evMetric.value) && M.evMetric.value > 0) {
          rows.push({ label: tr('sotp.impliedMetric', 'Implied {metric}', { metric: M.evMetric.label || tr('sotp.multiple', 'multiple') }), value: range(s.lo / M.evMetric.value, s.hi / M.evMetric.value, mFmtCalc) });
        }
        if (showPS) rows.push({ label: tr('sotp.perShare', 'Per share'), value: perShare(s), bold: true });
        if (s.key === 'equity' && showPS && M.refPrice) {
          rows.push({ label: tr('sotp.vsCurrent', 'vs. current {price}', { price: RK.format(M.refPrice, psFmt) }), value: range(s.lo / M.shares / M.refPrice - 1, s.hi / M.shares / M.refPrice - 1, '+0.0%;(0.0%);0.0%') });
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
      refLines: [],              // [{price, label, color}] further per-share reference lines (e.g. the offer price); default colour: theme ref
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
