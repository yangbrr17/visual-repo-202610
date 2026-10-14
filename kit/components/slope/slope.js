/*!
 * RK component: slope — two-period slope chart (e.g. EV/EBITDA 2025E -> 2026E by company).
 * Wide data (encode.from / encode.to fields) or long data (encode.period + encode.value, two periods).
 * Labels on both sides are de-overlapped in pixel space with leader lines; the target is highlighted.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;
  var MAX_SLOPE_W = 460;   // the slope area is capped and centred: steep angles read better than flat ones

  RK.component({
    id: 'slope',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'company', from: 'ev_ebitda_25e', to: 'ev_ebitda_26e', period: null, value: null, highlight: 'is_target', group: null },
      periods: null,          // long data: [fromPeriod, toPeriod] (default: first and last distinct period)
      headers: null,          // [left, right] column headers (default: period values / field titles minus common words)
      colorBy: 'direction',   // direction (up / down) | neutral (grey, target in accent) | category (by group or label)
      good: 'up',             // direction mode: 'up' | 'down' — which direction is coloured positive
      highlight: null,        // label value(s) to emphasise, in addition to rows flagged by encode.highlight
      median: false,          // dashed median line across both periods
      change: false,          // append the % change to the right-hand labels
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
      var catColor = RK.theme.categorical(U.unique(items.map(function (it) { return it.group != null ? it.group : it.label; })));

      if (o.median) {
        items = items.concat([{ label: 'Median', a: median(items.map(function (it) { return it.a; })), b: median(items.map(function (it) { return it.b; })), median: true }]);
      }
      items.forEach(function (it) {
        it.ta = RK.format(it.a, fmt);
        it.tb = RK.format(it.b, fmt);
        if (o.change && U.isNum(it.a) && U.isNum(it.b) && it.a) it.tb += '  ' + RK.format(it.b / it.a - 1, '(+0%);(−0%);(0%)');
        it.dim = sel.length > 0 && !it.median && sel.indexOf(it.label) < 0;
        it.color = colorOf(it);
      });

      /* ---------------- horizontal layout: label columns + centred slope area ---------------- */
      var fName = '11px ' + t.fontSans, fNameB = '600 11px ' + t.fontSans, fVal = '600 11px ' + t.fontNum;
      var W = inst.getWidth();
      var maxName = Math.min(o.labelWidth || 170, Math.max(60, (W - 220) / 2 - 60));
      items.forEach(function (it) { it.name = truncate(String(it.label), it.hl || it.median ? fNameB : fName, maxName); });
      var nameW = o.labels === 'values' ? 0 : Math.max.apply(null, items.map(function (it) { return measure(it.name, it.hl || it.median ? fNameB : fName); }).concat([0]));
      var valAW = Math.max.apply(null, items.map(function (it) { return measure(it.ta, fVal); }).concat([0]));
      var valBW = Math.max.apply(null, items.map(function (it) { return measure(it.tb, fVal); }).concat([0]));
      var leftW = 12 + valAW + (o.labels === 'both' ? 8 + nameW : 0);
      var rightW = 12 + valBW + (o.labels !== 'values' ? 8 + nameW : 0);
      var slopeW = Math.max(120, Math.min(MAX_SLOPE_W, W - leftW - rightW - 8));
      var extra = Math.max(0, W - leftW - rightW - slopeW);
      var gridLeft = leftW + extra / 2, gridRight = rightW + extra / 2;

      var vals = [];
      items.forEach(function (it) { vals.push(it.a, it.b); });
      var ext = U.extent(vals), pad = (ext[1] - ext[0]) * 0.04 || Math.abs(ext[1]) * 0.05 || 1;

      var lay = null;
      function layout(api, cs) {
        var top = cs.y - 2, bottom = cs.y + cs.height + 2;
        function side(key, x) {
          var idx = [], ys = [];
          items.forEach(function (it, i) { if (U.isNum(it[key])) { idx.push(i); ys.push(api.coord([x, it[key]])[1]); } });
          var out = spread(ys, 14, top, bottom), res = {};
          idx.forEach(function (i, n) { res[i] = out[n]; });
          return res;
        }
        return { a: side('a', 0), b: side('b', 1) };
      }

      function colorOf(it) {
        if (it.median) return t.ink;
        if (it.hl) return t.accent2;
        if (o.colorBy === 'category') return catColor(it.group != null ? it.group : it.label);
        if (o.colorBy === 'neutral') return t.dark ? t.ink3 : RK.theme.mix(t.ink3, t.paper, 0.15);
        if (!U.isNum(it.a) || !U.isNum(it.b) || it.a === it.b) return t.neutral;
        var up = it.b > it.a;
        return (o.good === 'down' ? !up : up) ? t.pos : t.neg;
      }

      function labelText(it, side) {
        var v = side === 'a' ? it.ta : it.tb;
        var named = o.labels === 'both' || (o.labels === 'right' && side === 'b');
        var key = it.hl ? 'h' : it.median ? 'm' : '';
        if (!named) return '{v' + key + '|' + esc(v) + '}';
        return side === 'a' ? '{n' + key + '|' + esc(it.name) + '}  {v' + key + '|' + esc(v) + '}'
          : '{v' + key + '|' + esc(v) + '}  {n' + key + '|' + esc(it.name) + '}';
      }
      var hlInk = t.dark ? t.accent2 : RK.theme.mix(t.accent2, t.ink, 0.35);
      var rich = {
        n: { font: fName, fill: t.ink2 }, v: { font: fVal, fill: t.ink },
        nh: { font: fNameB, fill: hlInk }, vh: { font: fVal, fill: hlInk },
        nm: { font: fNameB, fill: t.ink }, vm: { font: fVal, fill: t.ink }
      };

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
          var col = it.color, op = it.dim ? 0.2 : 1;
          var lw = it.hl ? 2.6 : it.median ? 1.6 : 1.4;
          var kids = [];
          var hasA = U.isNum(it.a), hasB = U.isNum(it.b);
          var pa = hasA ? api.coord([0, it.a]) : null, pb = hasB ? api.coord([1, it.b]) : null;
          if (hasA && hasB) {
            kids.push({
              type: 'line', z2: it.hl ? 20 : it.median ? 15 : 1,
              shape: { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] },
              style: { stroke: col, lineWidth: lw, opacity: op * (it.hl || it.median ? 1 : 0.85), lineDash: it.median ? [5, 3] : null },
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
                style: { fill: col, stroke: t.paper, lineWidth: 1, opacity: op }, blur: { style: { opacity: 0.15 } },
                enterFrom: key === 'b' ? { style: { opacity: 0 } } : undefined });
            }
            var ly = lay[key][i], x = p[0] + dir * 10;
            if (Math.abs(ly - p[1]) > 1.5) {
              kids.push({ type: 'polyline', z2: 1, shape: { points: [[p[0] + dir * 4, p[1]], [x - dir * 2, ly]] },
                style: { stroke: t.rule, lineWidth: 1, fill: null, opacity: op } });
            }
            kids.push({
              type: 'text', z2: it.hl ? 22 : 3, x: x, y: ly,
              style: { text: labelText(it, key), rich: rich, align: dir < 0 ? 'right' : 'left', verticalAlign: 'middle', opacity: it.dim ? 0.35 : 1 },
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
              rows.push({ label: 'Change', value: RK.format(it.b - it.a, signed(fmt)), bold: true });
              if (it.a) rows.push({ label: '% change', value: RK.format(it.b / it.a - 1, '+0.0%;−0.0%;0.0%') });
            }
            return C.tip(it.label, rows, it.median ? 'Median of the ' + (items.length - 1) + ' items shown' : (it.group != null ? String(it.group) : null));
          }
        },
        xAxis: {
          type: 'category', data: heads.map(String), boundaryGap: false, position: 'top',
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: t.ink, fontWeight: 600, fontSize: 11.5, margin: 12 },
          splitLine: { show: true, lineStyle: { color: t.rule, width: 1 } }
        },
        yAxis: { type: 'value', show: false, inverse: !!o.inverse, min: ext[0] - pad, max: ext[1] + pad },
        series: series
      };
    }, {
      select: function (p, ctx) {
        return p.seriesId === 'slope' && p.name && p.name !== 'Median' ? { field: ctx.enc.label, value: p.name } : null;
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

  /** Overlapping labels merge into clusters centred on their original mean, kept inside [lo, hi]. */
  function spread(ys, gap, lo, hi) {
    var items = ys.map(function (y, i) { return { i: i, y: y }; }).sort(function (p, q) { return p.y - q.y; });
    var cl = items.map(function (it) { return { items: [it] }; });
    function place(c) {
      var n = c.items.length, size = (n - 1) * gap;
      var mean = c.items.reduce(function (s, it) { return s + it.y; }, 0) / n;
      c.top = Math.max(lo, Math.min(hi - size, mean - size / 2));
      c.size = size;
    }
    cl.forEach(place);
    for (var guard = 0; guard < 400; guard++) {
      var merged = false;
      for (var j = 1; j < cl.length; j++) {
        if (cl[j].top < cl[j - 1].top + cl[j - 1].size + gap - 0.01) {
          cl[j - 1].items = cl[j - 1].items.concat(cl[j].items);
          cl.splice(j, 1);
          place(cl[j - 1]);
          merged = true;
          break;
        }
      }
      if (!merged) break;
    }
    var out = ys.slice();
    cl.forEach(function (c) { c.items.forEach(function (it, k) { out[it.i] = c.top + k * gap; }); });
    return out;
  }

  var canvas = null;
  function measure(text, font) {
    try {
      canvas = canvas || document.createElement('canvas');
      var g = canvas.getContext('2d');
      g.font = font;
      return Math.ceil(g.measureText(String(text)).width);
    } catch (e) { return String(text).length * 6.2; }
  }

  function truncate(text, font, max) {
    if (measure(text, font) <= max) return text;
    var s = text;
    while (s.length > 1 && measure(s + '…', font) > max) s = s.slice(0, -1);
    return s.replace(/\s+$/, '') + '…';
  }

  /** Rich-text markup characters must not leak from data into ECharts' "{style|text}" syntax. */
  function esc(s) { return String(s).replace(/[{}|]/g, ' '); }

  function signed(code) {
    code = RK.format.presets[code] || code || 'auto';
    if (code === 'auto' || String(code).indexOf(';') >= 0) return code;
    return '+' + code + ';−' + code + ';' + code;
  }
})();
