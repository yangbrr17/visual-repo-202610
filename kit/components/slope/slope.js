/*!
 * RK component: slope — two-period slope chart (e.g. EV/EBITDA 2025E -> 2026E by company).
 * Wide data (encode.from / encode.to fields) or long data (encode.period + encode.value, two periods).
 * Labels on both sides are de-overlapped in pixel space with leader lines; the target is highlighted.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'slope.change': '变动', 'slope.changePct': '变动 %', 'slope.medianOf': '所示 {n} 项的中位数'
    });
  }
  var MAX_SLOPE_W = 460;   // the slope area is capped and centred: steep angles read better than flat ones

  RK.component({
    id: 'slope',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'company', from: 'ev_ebitda_25e', to: 'ev_ebitda_26e', period: null, value: null, highlight: 'is_target', group: null },
      periods: null,          // long data: [fromPeriod, toPeriod] (default: first and last distinct period)
      headers: null,          // [left, right] column headers (default: period values / field titles minus common words)
      colorBy: 'direction',   // direction (up / down) | neutral (grey, target in accent2) | category (by group or label)
      good: 'up',             // direction mode: 'up' | 'down' — which direction is coloured positive
      highlight: null,        // label value(s) to emphasise, in addition to rows flagged by encode.highlight
      median: false,          // dashed median line across both periods (ink-3)
      change: false,          // append the % change to the right-hand labels
      delta: 'auto',          // ▲ / ▼ change token after the right-hand labels: 'auto' (direction colours without change) | true | false
      labels: 'both',         // both (names both sides) | right (names on the right only) | values (no names)
      inverse: false,         // reverse the value axis (ranks: 1 at the top)
      format: null,           // value format (defaults to the from / value field format)
      labelWidth: 170         // max px for a name before it is truncated with an ellipsis
    },
    render: C(function (ctx, inst) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var d = collect(ctx);
      var items = d.items;
      var fmt = o.format || ctx.fmtOf(d.long ? enc.value : enc.from) || 'auto';
      var heads = o.headers || d.headers;
      var sel = ctx.selected(enc.label);
      // category colours stay clear of the accent2 target highlight
      var catColor = RK.theme.categoricalSafe(U.unique(items.map(function (it) { return it.group != null ? it.group : it.label; })));

      if (o.median) {
        items = items.concat([{ label: tr('median', 'Median'), a: median(items.map(function (it) { return it.a; })), b: median(items.map(function (it) { return it.b; })), median: true }]);
      }
      // red / green direction colours always come with a sign: a ▲ / ▼ token with the size of the move
      var showDelta = o.delta === true || (o.delta === 'auto' && o.colorBy === 'direction' && !o.change);
      var dfmt = unsigned(fmt);
      items.forEach(function (it) {
        it.ta = RK.format(it.a, fmt);
        it.tb = RK.format(it.b, fmt);
        if (o.change && U.isNum(it.a) && U.isNum(it.b) && it.a) it.tb += '  ' + RK.format(it.b / it.a - 1, '(+0%);(−0%);(0%)');
        it.dim = sel.length > 0 && !it.median && sel.indexOf(it.label) < 0;
        it.sel = sel.length > 0 && sel.indexOf(it.label) >= 0;
        it.color = colorOf(it);
        it.td = '';
        if (showDelta && !it.median && U.isNum(it.a) && U.isNum(it.b)) {
          var mag = RK.format(Math.abs(it.b - it.a), dfmt);
          var visUp = o.inverse ? it.b < it.a : it.b > it.a;
          it.td = it.a === it.b || mag === RK.format(0, dfmt) ? '=' : (visUp ? '▲' : '▼') + mag;
          var good = o.good === 'down' ? it.b < it.a : it.b > it.a;
          it.dk = it.a === it.b || o.colorBy !== 'direction' ? '0' : good ? 'p' : 'n';    // also for the highlighted row
        }
      });

      /* ---------------- horizontal layout: label columns + centred slope area ---------------- */
      var fName = '11px ' + t.fontSans, fNameB = '600 11px ' + t.fontSans, fVal = '600 11px ' + t.fontNum;
      var W = inst.getWidth(), MIN_SLOPE = 180;
      function nameFont(it) { return it.hl || it.median || it.sel ? fNameB : fName; }
      var valAW = Math.max.apply(null, items.map(function (it) { return measure(it.ta, fVal); }).concat([0]));
      var valBW = Math.max.apply(null, items.map(function (it) { return measure(it.tb, fVal); }).concat([0]));
      var deltaW = Math.max.apply(null, items.map(function (it) { return it.td ? measure(it.td, fVal) + 8 : 0; }).concat([0]));
      var fullW = Math.min(o.labelWidth || 170, Math.max.apply(null, items.map(function (it) { return measure(String(it.label), nameFont(it)); }).concat([0])));
      // names on both sides only when they fit; otherwise fall back to names on the right
      var mode = o.labels === 'values' ? 'values' : o.labels === 'right' ? 'right' : 'both';
      if (mode === 'both' && 24 + valAW + valBW + deltaW + MIN_SLOPE + 2 * (fullW + 8) > W) mode = 'right';
      var sides = mode === 'both' ? 2 : mode === 'right' ? 1 : 0;
      var maxName = sides ? Math.max(48, Math.min(fullW, (W - 24 - valAW - valBW - deltaW - MIN_SLOPE - sides * 8) / sides)) : 0;
      items.forEach(function (it) { it.name = truncate(String(it.label), nameFont(it), maxName); });
      var nameW = sides ? Math.max.apply(null, items.map(function (it) { return measure(it.name, nameFont(it)); }).concat([0])) : 0;
      var leftW = 12 + valAW + (mode === 'both' ? 8 + nameW : 0);
      var rightW = 12 + valBW + (mode !== 'values' ? 8 + nameW : 0) + deltaW;
      var slopeW = Math.max(120, Math.min(MAX_SLOPE_W, W - leftW - rightW - 8));
      var extra = Math.max(0, W - leftW - rightW - slopeW);
      var gridLeft = leftW + extra / 2, gridRight = rightW + extra / 2;

      var vals = [];
      items.forEach(function (it) { vals.push(it.a, it.b); });
      var ext = U.extent(vals), pad = (ext[1] - ext[0]) * 0.04 || Math.abs(ext[1]) * 0.05 || 1;

      /*
       * Label layout per side: the target, the median and selected rows are pinned at their true height; the
       * other labels are placed around them, least crowded first, and a label is only kept while every kept
       * label stays within about one row of its own point. In a dense band the rest go unlabelled (dot +
       * tooltip) rather than being pushed rows away, where a reader would match a value to the wrong company.
       */
      var GAP = 14, CAP = 16;
      var lay = null;
      function layout(api, cs) {
        var top = cs.y - 2, bottom = cs.y + cs.height + 2;
        function side(key, x) {
          var idx = [], y0 = {};
          items.forEach(function (it, i) { if (U.isNum(it[key])) { idx.push(i); y0[i] = api.coord([x, it[key]])[1]; } });
          var pinned = idx.filter(function (i) { return items[i].hl || items[i].median || items[i].sel; })
            .sort(function (a, b) { return y0[a] - y0[b]; });
          var pinY = C.spreadLabels(pinned.map(function (i) { return y0[i]; }), GAP, top, bottom);
          var res = {};
          pinned.forEach(function (i, n) { res[i] = pinY[n]; });
          // free labels go into the gaps between pinned ones
          function place(free) {
            var segs = [];
            for (var s2 = 0; s2 <= pinned.length; s2++) segs.push([]);
            free.forEach(function (i) {
              var s3 = 0;
              while (s3 < pinned.length && y0[i] > res[pinned[s3]]) s3++;
              segs[s3].push(i);
            });
            var out = {};
            for (var g = 0; g < segs.length; g++) {
              if (!segs[g].length) continue;
              var lo = g === 0 ? top : res[pinned[g - 1]] + GAP, hi = g === pinned.length ? bottom : res[pinned[g]] - GAP;
              if ((segs[g].length - 1) * GAP > hi - lo + 1e-6) return null;
              var ys = C.spreadLabels(segs[g].map(function (i) { return y0[i]; }), GAP, lo, hi);
              segs[g].forEach(function (i, n) { out[i] = ys[n]; });
            }
            return out;
          }
          function fits(pos) {
            return pos && Object.keys(pos).every(function (i) { return Math.abs(pos[i] - y0[i]) <= CAP; });
          }
          var rest = idx.filter(function (i) { return pinned.indexOf(i) < 0; });
          var iso = {};
          rest.forEach(function (i) {
            iso[i] = Math.min.apply(null, idx.filter(function (j) { return j !== i; }).map(function (j) { return Math.abs(y0[i] - y0[j]); }).concat([1e9]));
          });
          rest.sort(function (a, b) { return iso[b] - iso[a] || y0[a] - y0[b]; });
          var kept = [];
          rest.forEach(function (i) {
            var trial = kept.concat([i]);
            if (fits(place(trial))) kept = trial;
          });
          var pos = place(kept) || {};
          Object.keys(pos).forEach(function (i) { res[i] = pos[i]; });
          return res;
        }
        return { a: side('a', 0), b: side('b', 1) };
      }

      function colorOf(it) {
        if (it.median) return t.ink3;
        if (it.hl) return t.accent2;
        if (o.colorBy === 'category') return catColor(it.group != null ? it.group : it.label);
        if (o.colorBy === 'neutral') return it.sel ? t.accent : RK.theme.mix(t.ink3, t.paper, 0.2);
        if (!U.isNum(it.a) || !U.isNum(it.b) || it.a === it.b) return t.neutral;
        var up = it.b > it.a;
        return (o.good === 'down' ? !up : up) ? t.pos : t.neg;
      }

      // values sit in fixed-width columns (right-aligned on the left side) so names line up
      // data strings are made safe for the rich-text markup ("{v|...}" in a name would restyle it)
      function labelText(it, side) {
        var v = side === 'a' ? it.ta : it.tb;
        var named = mode === 'both' || (mode === 'right' && side === 'b');
        var key = it.dim ? 'd' : it.hl ? 'h' : it.median || it.sel ? 'm' : '';
        var val = '{v' + key + side + '|' + C.richSafe(v) + '}';
        var txt = !named ? val : side === 'a' ? '{n' + key + '|' + C.richSafe(it.name) + '}  ' + val : val + '  {n' + key + '|' + C.richSafe(it.name) + '}';
        if (side === 'b' && it.td) txt += '  {d' + (it.dim ? 'd' : it.dk) + '|' + C.richSafe(it.td) + '}';
        return txt;
      }
      // target text uses the text-safe accent (accent2 itself is for marks)
      var hlInk = t.accent2Ink;
      var rich = {
        n: { font: fName, fill: t.ink2 }, nh: { font: fNameB, fill: hlInk }, nm: { font: fNameB, fill: t.ink },
        nd: { font: fName, fill: RK.theme.alpha(t.ink3, 0.55) },
        dp: { font: fVal, fill: t.pos }, dn: { font: fVal, fill: t.neg }, d0: { font: fVal, fill: t.ink3 },
        dd: { font: fVal, fill: RK.theme.alpha(t.ink3, 0.55) }
      };
      [['', t.ink], ['h', hlInk], ['m', t.ink], ['d', RK.theme.alpha(t.ink3, 0.55)]].forEach(function (k) {
        rich['v' + k[0] + 'a'] = { font: fVal, fill: k[1], width: valAW, align: 'right' };
        rich['v' + k[0] + 'b'] = { font: fVal, fill: k[1], width: valBW, align: 'left' };
      });

      var series = [{
        id: 'slope', type: 'custom', clip: false,
        emphasis: { focus: 'self' },
        encode: { x: [0, 2], y: [1, 3] },
        data: items.map(function (it, i) { return { name: it.label, value: [0, it.a, 1, it.b, i] }; }),
        renderItem: function (params, api) {
          var cs = params.coordSys;
          if (params.dataIndex === 0 || !lay) lay = layout(api, cs);
          var i = params.dataIndex, it = items[i];
          if (!it) return null;
          // dimming is carried by colour alpha, not style.opacity, so it never fights an enter fade
          var a = it.dim ? 0.2 : 1, col = RK.theme.alpha(it.color, a * (it.hl || it.median || it.sel ? 1 : 0.85));
          var dotCol = RK.theme.alpha(it.color, a);
          var lw = it.hl ? 2.6 : it.sel ? 2.2 : it.median ? 1.5 : 1.4;
          var kids = [];
          var hasA = U.isNum(it.a), hasB = U.isNum(it.b);
          var pa = hasA ? api.coord([0, it.a]) : null, pb = hasB ? api.coord([1, it.b]) : null;
          if (hasA && hasB) {
            // the dashed median sits on a paper halo so lines beneath do not fill its gaps
            if (it.median) kids.push({ type: 'line', z2: 14, silent: true, shape: { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] },
              style: { stroke: t.paper, lineWidth: lw + 2.5 }, blur: { style: { opacity: 0.15 } }, enterFrom: { shape: { x2: pa[0], y2: pa[1] } } });
            kids.push({
              type: 'line', z2: it.hl ? 20 : it.median ? 15 : 1,
              shape: { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] },
              style: { stroke: col, lineWidth: lw, lineDash: it.median ? [5, 3] : null },
              emphasis: { style: { lineWidth: lw + 1 } },
              blur: { style: { opacity: 0.15 } },
              enterFrom: { shape: { x2: pa[0], y2: pa[1] } }
            });
          }
          [['a', pa, -1], ['b', pb, 1]].forEach(function (sd) {
            var key = sd[0], p = sd[1], dir = sd[2];
            if (!p) return;
            if (!it.median) {
              kids.push({ type: 'circle', z2: it.hl ? 21 : 2, shape: { cx: p[0], cy: p[1], r: it.hl ? 4 : 3 },
                style: { fill: dotCol, stroke: t.paper, lineWidth: 1 }, blur: { style: { opacity: 0.15 } },
                enterFrom: key === 'b' ? { style: { opacity: 0 } } : undefined });
            }
            var ly = lay[key][i], x = p[0] + dir * 10;
            if (ly == null) return;                                // unlabelled in a dense band: dot + tooltip
            if (Math.abs(ly - p[1]) > 1.5) {
              kids.push({ type: 'polyline', z2: 1, shape: { points: [[p[0] + dir * 4, p[1]], [x - dir * 2, ly]] },
                style: { stroke: RK.theme.alpha(t.rule, a), lineWidth: 1, fill: null } });
            }
            kids.push({
              type: 'text', z2: it.hl ? 22 : 3, x: x, y: ly,
              style: { text: labelText(it, key), rich: rich, align: dir < 0 ? 'right' : 'left', verticalAlign: 'middle' },
              blur: { style: { opacity: 0.25 } },
              enterFrom: { style: { opacity: 0 } }
            });
          });
          return { type: 'group', children: kids };
        }
      }];

      return {
        grid: { left: gridLeft, right: gridRight, top: 30, bottom: 6, containLabel: false },
        tooltip: {
          trigger: 'item',
          formatter: function (p) {
            var it = items[p.dataIndex];
            if (!it) return '';
            var rows = [
              { label: String(heads[0]), value: it.ta },
              { label: String(heads[1]), value: RK.format(it.b, fmt) }
            ];
            if (U.isNum(it.a) && U.isNum(it.b)) {
              rows.push({ label: tr('slope.change', 'Change'), value: RK.format(it.b - it.a, signed(fmt)), bold: true });
              if (it.a && !o.inverse) rows.push({ label: tr('slope.changePct', '% change'), value: RK.format(it.b / it.a - 1, '+0.0%;−0.0%;0.0%') });
            }
            return C.tip(it.label, rows, it.median ? tr('slope.medianOf', 'Median of the {n} items shown', { n: items.length - 1 }) : (it.group != null ? String(it.group) : null));
          }
        },
        xAxis: {
          type: 'category', data: heads.map(String), boundaryGap: false, position: 'top',
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: t.ink, fontWeight: 600, fontSize: 11, margin: 12 },
          splitLine: { show: true, lineStyle: { color: t.rule, width: 1 } }
        },
        yAxis: { type: 'value', show: false, inverse: !!o.inverse, min: ext[0] - pad, max: ext[1] + pad },
        series: series
      };
    }, {
      rebuildOnResize: true,     // label columns and truncation depend on the width
      select: function (p, ctx) {
        return p.seriesId === 'slope' && p.name && p.name !== tr('median', 'Median') ? { field: ctx.enc.label, value: p.name } : null;
      }
    })
  });

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  /** Rows -> [{label, a, b, hl, group}] for wide or long data, plus default headers. */
  function collect(ctx) {
    var o = ctx.options, enc = ctx.enc, ds = ctx.dataset, rows = ctx.rows;
    var hlSet = o.highlight == null ? [] : [].concat(o.highlight);
    var hlField = enc.highlight && ds && ds.has(enc.highlight) ? enc.highlight : null;
    var long = !!(enc.period && enc.value && ds && ds.has(enc.period) && ds.has(enc.value));
    var items = [], headers;
    function isHl(r) { return hlSet.indexOf(r[enc.label]) >= 0 || (hlField && !!r[hlField] && r[hlField] !== 'false'); }
    if (long) {
      var periods = o.periods || (function () {
        var ps = U.unique(rows.map(function (r) { return r[enc.period]; }).filter(function (v) { return v != null; }));
        return [ps[0], ps[ps.length - 1]];
      })();
      headers = periods.slice(0, 2);
      U.groupBy(rows, function (r) { return r[enc.label]; }).forEach(function (g, label) {
        function sum(p) {
          var v = g.filter(function (r) { return String(r[enc.period]) === String(p); }).map(function (r) { return r[enc.value]; }).filter(U.isNum);
          return v.length ? v.reduce(function (s, x) { return s + x; }, 0) : null;
        }
        items.push({ label: label, a: sum(periods[0]), b: sum(periods[1]), hl: g.some(isHl), group: enc.group ? g[0][enc.group] : null });
      });
    } else {
      headers = stripCommon(ctx.title(enc.from), ctx.title(enc.to));
      rows.forEach(function (r) {
        items.push({ label: r[enc.label], a: U.isNum(r[enc.from]) ? r[enc.from] : null, b: U.isNum(r[enc.to]) ? r[enc.to] : null,
          hl: isHl(r), group: enc.group ? r[enc.group] : null });
      });
    }
    return { items: items, headers: headers, long: long };
  }

  /** "EV/EBITDA 2025E" + "EV/EBITDA 2026E" -> ["2025E", "2026E"]; unrelated titles are kept whole. */
  function stripCommon(a, b) {
    var x = String(a).split(' '), y = String(b).split(' '), n = 0;
    while (n < x.length - 1 && n < y.length - 1 && x[n] === y[n]) n++;
    return n ? [x.slice(n).join(' '), y.slice(n).join(' ')] : [String(a), String(b)];
  }

  function median(list) {
    var v = list.filter(U.isNum).sort(function (p, q) { return p - q; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function measure(text, font) { return Math.ceil(C.measure(text, font)); }

  function truncate(text, font, max) {
    if (measure(text, font) <= max) return text;
    var s = text;
    while (s.length > 1 && measure(s + '…', font) > max) s = s.slice(0, -1);
    return s.replace(/\s+$/, '') + '…';
  }

  /** Unsigned magnitude format for the ▲ / ▼ token: a leading literal ("#" for ranks) is dropped. */
  function unsigned(code) {
    code = String(RK.format.presets[code] || code || 'auto').replace(/^"[^"]*"/, '');
    return code.split(';')[0] || 'auto';
  }

  /** Signed variant of a format for differences; a leading literal ("#" for ranks) is dropped. */
  function signed(code) {
    code = String(RK.format.presets[code] || code || 'auto').replace(/^"[^"]*"/, '');
    if (code === 'auto' || code.indexOf(';') >= 0) return code;
    return '+' + code + ';−' + code + ';' + code;
  }
})();
