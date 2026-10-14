/*!
 * RK component: waterfall — bridge chart (EBITDA bridge, EV-to-equity bridge, variance walk).
 * Rows are the steps in walk order. kind 'total' / 'subtotal' bars start at zero; 'delta' bars float
 * from the running total. Positive deltas in --rk-pos, negative in --rk-neg, totals in the accent.
 * Floating bars = transparent base + visible bar on one stack with stackStrategy 'all', so a walk may
 * cross zero. Connectors are a light custom series drawn between bar edges (think-cell style).
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;
  var MINUS = '−';

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'waterfall.change': '变动', 'waterfall.pctOf': '占{name}比例', 'waterfall.running': '累计值', 'waterfall.unreconciled': '与桥接累计值的差额',
      'waterfall.computed': '由桥接计算得出'
    });
  }
  var BAR = 0.62;          // bar width as share of the category band (connectors use the same value)

  var isNum = util.isNum;

  /** Axis tick format: the value format with no more decimals than the tick step needs (1,200 not 1,200.0). */
  function tickFmt(fmt, step) {
    var code = RK.format.presets[fmt] || fmt;
    if (typeof code !== 'string' || !step || !/[0#]/.test(code) || RK.format.isDateCode(code)) return fmt;
    var sec = code.split(';')[0].replace(/"[^"]*"/g, ''), scale = Math.pow(1000, ((sec.match(/[0#](,+)[^0#]*$/) || [])[1] || '').length);
    var v = Math.abs(step) * (/%/.test(sec) ? 100 : 1) / scale, dec = 0;
    while (dec < 4 && Math.abs(Math.round(v * Math.pow(10, dec)) - v * Math.pow(10, dec)) > 1e-6) dec++;
    return code.replace(/([0#])\.([0#]+)/g, function (m, a, d) { var n = Math.min(dec, d.length); return a + (n ? '.' + d.slice(0, n) : ''); });
  }

  /** Value text with a true minus sign (matches the signed delta labels). */
  function num(v, f) { return RK.format(v, f).replace(/^-/, MINUS); }

  /** Words of a label, breakable after spaces, hyphens and slashes; '&' / '+' stay with the following word. */
  function words(text) {
    var raw = String(text == null ? '' : text).match(/[^\s\-\/]+[\s\-\/]*|[\s\-\/]+/g) || [], out = [];
    for (var i = 0; i < raw.length; i++) {
      if (/^[&+]\s*$/.test(raw[i]) && i + 1 < raw.length) { raw[i + 1] = raw[i] + raw[i + 1]; continue; }
      out.push(raw[i]);
    }
    return out;
  }
  /** Greedy word wrap that may also break after hyphens / slashes (ECharts 'break' splits words mid-way). */
  function wrap(text, width, font) {
    var lines = [], cur = '';
    words(text).forEach(function (w) {
      var next = cur + w;
      if (cur && C.measure(next.trim(), font) > width) { lines.push(cur.trim()); cur = w; } else cur = next;
    });
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }
  /** Can every label be wrapped into the band (no word wider than the band, at most 3 lines)? */
  function fits(steps, width, size, sans) {
    return steps.every(function (s) {
      var font = (s.kind !== 'delta' ? '600 ' : '') + size + 'px ' + sans;
      return words(s.label).every(function (w) { return C.measure(w.trim(), font) <= width; }) && wrap(s.label, width, font).length <= 3;
    });
  }

  /**
   * Driver colours for colorBy 'category'. Red / green hues mean decrease / increase in a bridge, so they are
   * never used for a category, nor are greys (read as n.a.) or the totals' own colour family; every colour keeps
   * >= 3:1 against the paper (and is not near-white on dark paper). Falls back to tints / shades of the safe ones.
   */
  function driverPalette(t, n, sub) {
    var th = RK.theme, dark = t.dark, reserved = [t.accent, sub, t.paper, t.ink, t.neutral];
    function hsl(c) {
      var p = th.parseColor(c), r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, sat = 0, d = mx - mn;
      if (d) {
        sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        h = 60 * (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
      }
      return { h: h, s: sat };
    }
    function hueDiff(a, b) { var x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; }
    var posH = hsl(t.pos).h, negH = hsl(t.neg).h, acc = hsl(t.accent);
    function ok(c, out, strict) {
      var h = hsl(c), cr = th.contrast(c, t.paper);
      if (h.s < (strict ? 0.25 : 0.18) || cr < 3 || cr > (dark ? 9.5 : 12)) return false;
      if (hueDiff(h.h, negH) < (strict ? 28 : 15) || th.distance(c, t.neg) < (strict ? 100 : 80)) return false;
      if (hueDiff(h.h, posH) < (strict ? 30 : 20) || th.distance(c, t.pos) < (strict ? 100 : 80) || (h.h >= 80 && h.h <= 160)) return false;
      if (acc.s >= 0.25 && hueDiff(h.h, acc.h) < 15 && th.distance(c, t.accent) < 160) return false;
      if (reserved.some(function (r) { return r && th.distance(c, r) < 90; })) return false;
      return !out.some(function (o) { return th.distance(c, o) < 60; });
    }
    var cands = t.cat.concat([t.accent2, t.accent3]).filter(Boolean), out = [];
    function add(list, strict) { list.forEach(function (c) { if (out.length < n && out.indexOf(c) < 0 && ok(c, out, strict)) out.push(c); }); }
    function variants(list, k) { var v = []; list.forEach(function (c) { v.push(th.mix(c, t.ink, k), th.mix(c, t.paper, k)); }); return v; }
    add(cands, true);
    var base = out.slice();
    add(variants(base, 0.3), true); add(variants(base, 0.45), true);
    add(cands, false);
    add(variants(out.slice(), 0.3), false); add(variants(out.slice(), 0.45), false);
    if (out.length < n) out = out.concat(th.palette({ exclude: [t.accent, t.pos, t.neg], n: n }).slice(out.length));   // never undefined
    return out;
  }

  /** Normalise free-text kinds: start/end/total -> total, sub* -> subtotal, anything else -> delta. */
  function normKind(k) {
    if (k == null || k === '') return null;
    k = String(k).toLowerCase();
    if (/^sub/.test(k)) return 'subtotal';
    if (k === 'total' || k === 'start' || k === 'end' || k === 'absolute') return 'total';
    return 'delta';
  }

  /** Steps with start / end levels of the running total. Missing total values are computed. */
  function walk(ctx) {
    var o = ctx.options, enc = ctx.enc, rows = ctx.rows, n = rows.length;
    var hasKind = !!(enc.kind && ctx.dataset && ctx.dataset.has(enc.kind));
    var infer = o.inferTotals === 'auto' ? (hasKind ? false : 'both') : o.inferTotals;
    var run = 0, steps = [];
    rows.forEach(function (r, i) {
      var kind = hasKind ? normKind(r[enc.kind]) : null;
      if (!kind) {
        var first = i === 0 && (infer === 'first' || infer === 'both');
        var last = i === n - 1 && n > 1 && (infer === 'last' || infer === 'both');
        kind = first || last ? 'total' : 'delta';
      }
      var v = r[enc.value];
      var s = { i: steps.length, label: r[enc.label], kind: kind, row: r, category: enc.category ? r[enc.category] : null };
      if (kind === 'delta') {
        s.value = isNum(v) ? v : null;
        s.start = run; s.end = run + (s.value || 0);
      } else {
        s.computed = !isNum(v);
        s.value = isNum(v) ? v : run;
        s.diff = isNum(v) && i > 0 ? v - run : 0;     // unreconciled difference vs. the walk
        s.start = 0; s.end = s.value;
      }
      run = s.end;
      steps.push(s);
    });
    if (o.endTotal && steps.length) steps.push({ i: steps.length, label: o.endTotal, kind: 'total', value: run, start: 0, end: run, computed: true, diff: 0 });
    return steps;
  }

  /** Break the value axis between zero and the walk when deltas are small relative to the totals. */
  function autoBreak(steps, hi) {
    var floats = [];
    steps.forEach(function (s) { if (s.kind === 'delta') floats.push(s.start, s.end); });
    if (!floats.length || steps.some(function (s) { return Math.min(s.start, s.end) < 0; })) return null;
    var lo = Math.min.apply(null, floats), span = hi - lo;
    if (lo <= 0 || span / hi > 0.45) return null;
    var step = util.niceStep(span, 4);
    var end = Math.floor((lo - span * 0.35) / step) * step;
    var start = util.niceStep((hi - end) * 0.16, 1);
    return start < end * 0.8 ? { start: start, end: end } : null;
  }

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var steps = walk(ctx);
    var fmt = o.format || ctx.fmtOf(enc.value) || '#,##0.0';
    var pos = o.invert ? t.neg : t.pos, neg = o.invert ? t.pos : t.neg;
    var sub = t.accent3 || RK.theme.mix(t.accent, t.paper, 0.4);
    var hasSub = steps.some(function (s) { return s.kind === 'subtotal'; });
    var cats = util.unique(steps.filter(function (s) { return s.kind === 'delta' && s.category != null; }).map(function (s) { return s.category; }));
    var byCat = o.colorBy === 'category' && cats.length > 0;
    var catPal = byCat ? driverPalette(t, cats.length, hasSub ? sub : null) : [];   // never red / green, never like the totals
    function catColor(c) { var k = cats.indexOf(c); return k < 0 ? t.neutral : catPal[k]; }

    // ---- orientation: a vertical bridge whose step names cannot wrap into their bands turns horizontal ----
    var W = inst.getWidth() || ctx.el.clientWidth || 800;
    var bandPx = (W - 8 - (o.valueAxis ? 48 : 0)) / Math.max(1, steps.length);
    var catFont = 11;
    var horiz = o.orientation === 'horizontal';
    if (!horiz) {
      if (!fits(steps, bandPx - 6, 11, t.fontSans)) catFont = 10;
      if (catFont === 10 && !fits(steps, bandPx - 6, 10, t.fontSans)) { horiz = true; catFont = 11; }
    }

    function colorOf(s) {
      if (s.kind === 'total') return t.accent;
      if (s.kind === 'subtotal') return sub;
      if (byCat) return catColor(s.category);
      if (!s.value) return t.neutral;
      return s.value > 0 ? pos : neg;
    }
    function signed(v) {
      if (o.deltaFormat) return num(v, o.deltaFormat);
      if (!isNum(v)) return RK.format(v, fmt);
      var s = RK.format(Math.abs(v), fmt);
      return v > 0 ? '+' + s : v < 0 && /[1-9]/.test(s) ? MINUS + s : s;
    }
    function labelOf(s) { return C.richSafe(s.kind === 'delta' ? signed(s.value) : num(s.value, fmt)); }

    // ---- value axis bounds (labels sit inside the plot, so pad both ends) ----
    var levels = [0];
    steps.forEach(function (s) { levels.push(s.start, s.end); });
    var ext = util.extent(levels), span = (ext[1] - ext[0]) || 1;
    var brk = o.axisBreak === 'auto' ? autoBreak(steps, ext[1]) : (o.axisBreak && isNum(o.axisBreak.start) ? o.axisBreak : null);
    var visSpan = brk ? ext[1] - brk.end + brk.start : span;
    var pad = visSpan * (horiz ? 0.1 : 0.09);
    var axMax = ext[1] > 0 ? ext[1] + pad : 0;
    var axMin = ext[0] < 0 ? ext[0] - pad : 0;
    var interval;
    if (o.valueAxis) {
      interval = util.niceStep(visSpan, 5);
      axMax = Math.ceil(axMax / interval) * interval;
      axMin = Math.floor(axMin / interval) * interval;
    }

    // ---- category labels: wrap to the band width (re-laid out on resize) ----
    var labelW = horiz ? Math.min(200, Math.max(110, W * 0.22)) : bandPx - 6;
    var bold = { fontWeight: 600, color: t.ink, lineHeight: 13, fontSize: catFont };
    var catAxis = {
      type: 'category',
      data: steps.map(function (s) { return s.label; }),
      inverse: horiz,
      axisLine: { show: true, onZero: ext[0] >= 0, lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: {
        interval: 0, color: t.ink2, fontSize: catFont, lineHeight: 13,
        formatter: function (v, i) {
          var s = steps[i], tot = s && s.kind !== 'delta';
          var lines = wrap(v, labelW, (tot ? '600 ' : '') + catFont + 'px ' + t.fontSans).map(C.richSafe);
          return tot ? lines.map(function (l) { return '{b|' + l + '}'; }).join('\n') : lines.join('\n');
        },
        rich: { b: bold }
      }
    };
    var valAxis = {
      type: 'value', min: axMin, max: axMax, interval: interval,
      // kept "shown" with invisible parts: the axis must exist for the break zigzag to be drawn
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { show: !!o.valueAxis, formatter: function (v) { return num(v, tickFmt(fmt, interval)); } },
      splitLine: { show: !!o.valueAxis }
    };
    if (brk) {
      valAxis.breaks = [{ start: brk.start, end: brk.end, gap: brk.gap || (horiz ? '3%' : '4%') }];
      valAxis.breakArea = {
        show: true, expandOnClick: false, zigzagAmplitude: 3, zigzagMinSpan: 3, zigzagMaxSpan: 9,
        itemStyle: { color: t.paper, borderColor: t.paper, borderWidth: 0, opacity: 1 }   // a clean zigzag cut through the bars
      };
      valAxis.breakLabelLayout = { moveOverlap: 'auto' };
    }

    // ---- series ----
    var stagger = Math.min(90, 900 / Math.max(1, steps.length));
    var delay = function (i) { return i * stagger; };
    var series = [
      {
        id: 'base', type: 'bar', stack: 'wf', stackStrategy: 'all', silent: true, barWidth: (BAR * 100) + '%',
        itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false },
        animationDelay: delay,
        data: steps.map(function (s) { return s.kind === 'delta' ? Math.min(s.start, s.end) : 0; })
      },
      {
        id: 'bars', name: ctx.title(enc.value), type: 'bar', stack: 'wf', stackStrategy: 'all', barWidth: (BAR * 100) + '%',
        barMinHeight: 2,   // small steps against a large total stay visible as a sliver, never vanish
        animationDelay: delay,
        emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
        label: {
          show: o.labels !== false, distance: 5, fontSize: 11, fontFamily: t.fontNum, color: t.ink2,
          formatter: function (p) { var s = steps[p.dataIndex]; return s ? labelOf(s) : ''; }
        },
        data: steps.map(function (s) {
          var up = s.kind === 'delta' ? (s.value || 0) >= 0 : s.value >= 0;
          var c = C.dim(ctx, enc.label, s.label, colorOf(s));
          return {
            name: s.label,
            value: s.kind === 'delta' ? Math.abs(s.end - s.start) : s.value,
            itemStyle: { color: c },
            label: s.kind === 'delta'
              ? { position: horiz ? (up ? 'right' : 'left') : (up ? 'top' : 'bottom') }
              : { position: horiz ? (up ? 'right' : 'left') : (up ? 'top' : 'bottom'), color: t.ink, fontWeight: 600 }
          };
        }),
        markLine: ext[0] < 0 ? {
          silent: true, symbol: ['none', 'none'], label: { show: false }, precision: 10,
          lineStyle: { color: t.axis, type: 'solid', width: 1 },
          data: [horiz ? { xAxis: 0 } : { yAxis: 0 }]
        } : undefined
      }
    ];

    if (o.connectors !== false && steps.length > 1) {
      series.push({
        id: 'conn', type: 'custom', silent: true, z: 1, tooltip: { show: false },
        animationDelay: function (i) { return (i + 1) * stagger + 260; },
        renderItem: function (params, api) {
          var i = api.value(0), lvl = api.value(1);
          var a = api.coord(horiz ? [lvl, i] : [i, lvl]), b = api.coord(horiz ? [lvl, i + 1] : [i + 1, lvl]);
          var half = (horiz ? api.size([0, 1])[1] : api.size([1, 0])[0]) * BAR / 2;
          var shape = horiz
            ? { x1: a[0], y1: a[1] + half, x2: b[0], y2: b[1] - half }
            : { x1: a[0] + half, y1: a[1], x2: b[0] - half, y2: b[1] };
          return {
            type: 'line', shape: shape,
            style: { stroke: t.axis, lineWidth: 1, lineDash: o.connectors === 'dashed' ? [3, 2] : null },
            enterFrom: { style: { opacity: 0 } }
          };
        },
        data: steps.slice(0, -1).map(function (s, i) { return [i, s.end]; })
      });
    }

    // legend entries for category colouring (empty series carry the swatch)
    if (byCat) {
      cats.forEach(function (c) {
        series.push({ id: 'lg-' + c, name: c, type: 'bar', stack: 'lg', data: [], itemStyle: { color: catColor(c) } });
      });
    }

    var first = steps.filter(function (s) { return s.kind === 'total'; })[0];
    var showLegend = byCat && o.legend !== false;

    return {
      legend: C.legend(ctx, { show: showLegend, data: showLegend ? cats : [], selectedMode: false }),
      grid: C.grid(ctx, { top: showLegend ? 32 : 8, left: 4, right: horiz ? 16 : 4, bottom: 4 }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var s = steps[p.dataIndex];
          if (!s || p.seriesId !== 'bars') return '';
          var rows = [];
          if (s.kind === 'delta') {
            rows.push({ color: colorOf(s), label: tr('waterfall.change', 'Change'), value: signed(s.value) });
            if (o.pctOfStart && first && first.value && s.i > first.i) rows.push({ label: tr('waterfall.pctOf', '% of {name}', { name: first.label }), value: RK.format(s.value == null ? null : s.value / Math.abs(first.value), '+0.0%;' + MINUS + '0.0%;0.0%') });
            rows.push({ label: tr('waterfall.running', 'Running total'), value: num(s.end, fmt), bold: true });
          } else {
            rows.push({ color: colorOf(s), label: s.kind === 'subtotal' ? tr('subtotal', 'Subtotal') : tr('total', 'Total'), value: num(s.value, fmt), bold: true });
            if (s.diff && Math.abs(s.diff) > Math.abs(s.value) * 1e-6) rows.push({ label: tr('waterfall.unreconciled', 'Unreconciled vs. walk'), value: signed(s.diff) });
          }
          if (s.category != null && s.kind === 'delta') rows.unshift({ label: ctx.title(enc.category), value: s.category });
          return C.tip(s.label, rows, s.computed ? tr('waterfall.computed', 'Computed from the walk') : null);
        }
      },
      xAxis: horiz ? valAxis : catAxis,
      yAxis: horiz ? catAxis : valAxis,
      series: series
    };
  }

  RK.component({
    id: 'waterfall',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'step', value: 'value', kind: 'kind', category: null },
      orientation: 'vertical',   // vertical | horizontal (a vertical bridge turns horizontal when its step names cannot fit the bands)
      inferTotals: 'auto',       // 'auto' (first + last are totals when there is no kind field) | 'first' | 'last' | 'both' | false
      endTotal: null,            // label of a computed closing total appended after the last row
      colorBy: 'sign',           // sign | category (deltas coloured by encode.category, with legend)
      invert: false,             // true = increases are unfavourable (cost walks): swap pos / neg colours
      connectors: true,          // true | 'dashed' | false
      labels: true,
      deltaFormat: null,         // delta label format; default = value format with explicit +/− sign
      format: null,              // value format; defaults to the value field's format
      valueAxis: false,          // pitchbook default: no value axis, labels carry the numbers
      axisBreak: false,          // false | 'auto' | {start, end, gap} — break the axis between zero and the walk
      pctOfStart: true,          // tooltip: delta as % of the opening total
      legend: true,
      crossFilter: false,        // true = click a step to cross-filter on the label field
      crossFilterScope: 'dataset' // step names are not a shared business dimension: filter this dataset only
    },
    render: C(build, {
      rebuildOnResize: true,     // category labels are wrapped to the measured band width
      select: function (p, c) { return p.seriesId === 'bars' ? { field: c.enc.label, value: p.name } : null; }
    })
  });
})();
