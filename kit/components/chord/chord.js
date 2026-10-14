/*!
 * RK component: chord — bilateral flows inside one set of entities: cross-border M&A by acquirer ->
 * target country, trade corridors, referrals between business units. One row per flow
 * (source, target, value); repeated pairs are summed, long tails grouped into "Other".
 * Uses the ECharts 6 chord series; falls back to a circular graph on older ECharts builds.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /** Canvas text width (margins and wraps are sized from measured labels). */
  var measure = (function () {
    var c2d = null;
    return function (text, font) {
      c2d = c2d || document.createElement('canvas').getContext('2d');
      c2d.font = font;
      // +7%: the canvas may measure with a fallback face before the webfont has loaded
      return c2d.measureText(String(text)).width * 1.07;
    };
  })();

  function tokenColor(t, v) {
    if (!v) return null;
    if (typeof t[v] === 'string' && t[v]) return t[v];
    var m = /^cat(\d+)$/.exec(v);
    if (m) return t.cat[(+m[1] - 1) % t.cat.length];
    return v;
  }
  function safe(s) { return String(s == null ? '' : s).replace(/[{}|]/g, ' '); }

  /** Chord series ships with ECharts 6. */
  function hasChord() {
    var v = window.echarts && window.echarts.version;
    return !!v && parseInt(v, 10) >= 6;
  }

  /** '+x;-x;x' variant of a numeric format code (net flows). */
  function signed(fmt) {
    var code = RK.format.presets[fmt] || fmt;
    if (!code || code === 'auto' || !/[0#]/.test(code)) return fmt;
    var first = code.split(';')[0];
    return '+' + first + ';-' + first + ';' + first;
  }

  /**
   * Toggle a node in this block's selection. A node matches links at either end, so the filter is
   * an expression (`source in [..] or target in [..]`), scoped to this block's dataset unless
   * filterScope = 'global'. `values` is kept on the spec so ctx.selected(enc.source) still works.
   */
  function selectNode(ctx, value) {
    var enc = ctx.enc;
    if (ctx.options.crossFilter === false || value == null || !enc.source || !enc.target) return;
    var key = ctx.id + ':' + enc.source, cur = RK.store.filter(key);
    var vals = cur && cur.values ? cur.values.slice() : [];
    var i = vals.indexOf(value);
    if (i >= 0) vals.splice(i, 1); else vals.push(value);
    if (!vals.length) { RK.store.clearFilter(key); return; }
    var list = '[' + vals.map(function (v) { return JSON.stringify(String(v)); }).join(', ') + ']';
    RK.store.setFilter(key, {
      op: 'expr', field: enc.source, values: vals, source: ctx.id,
      expr: '`' + enc.source + '` in ' + list + ' or `' + enc.target + '` in ' + list,
      datasets: ctx.options.filterScope === 'global' || !ctx.dataset ? undefined : [ctx.dataset.id]
    });
  }


  /** Aggregate rows into nodes (with out / in totals) and links, folding the tail into "Other". */
  function model(ctx) {
    var o = ctx.options, enc = ctx.enc;
    var raw = [], tot = new Map(), order = [];
    function bump(name, k, v, n) {
      if (!tot.has(name)) { tot.set(name, { name: name, out: 0, inn: 0, outN: 0, inN: 0 }); order.push(name); }
      var e = tot.get(name);
      e[k] += v;
      e[k + 'N'] += n;
    }
    ctx.rows.forEach(function (r) {
      var s = r[enc.source], d = r[enc.target], v = r[enc.value];
      if (s == null || d == null || !util.isNum(v) || v <= 0) return;
      if (s === d && !o.includeSelf) return;
      var n = enc.count && util.isNum(r[enc.count]) ? r[enc.count] : 0;
      raw.push({ s: String(s), d: String(d), v: v, n: n });
      bump(String(s), 'out', v, n);
      bump(String(d), 'inn', v, n);
    });
    var all = order.map(function (k) { return tot.get(k); });
    all.forEach(function (e) { e.total = e.out + e.inn; });
    var ranked = all.slice().sort(function (a, b) { return b.total - a.total; });
    var keep = new Set((o.top && ranked.length > o.top + 1 ? ranked.slice(0, o.top) : ranked).map(function (e) { return e.name; }));
    var other = o.otherLabel || 'Other';
    function map(name) { return keep.has(name) ? name : other; }

    var nodes = new Map(), links = new Map();
    raw.forEach(function (x) {
      var s = map(x.s), d = map(x.d);
      if (s === d && !o.includeSelf) return;
      [[s, 'out'], [d, 'inn']].forEach(function (p) {
        if (!nodes.has(p[0])) nodes.set(p[0], { name: p[0], out: 0, inn: 0, outN: 0, inN: 0, isOther: p[0] === other && !keep.has(other), members: [] });
        var e = nodes.get(p[0]);
        e[p[1]] += x.v;
        e[p[1] + 'N'] += x.n;
      });
      var k = s + '\u0001' + d;
      if (!links.has(k)) links.set(k, { source: s, target: d, value: 0, count: 0 });
      var l = links.get(k);
      l.value += x.v;
      l.count += x.n;
    });
    all.forEach(function (e) { if (!keep.has(e.name) && nodes.has(other)) nodes.get(other).members.push(e.name); });
    var list = Array.from(nodes.values());
    list.forEach(function (e) { e.total = e.out + e.inn; });
    if (o.sort === 'desc') list.sort(function (a, b) { return (a.isOther - b.isOther) || (b.total - a.total); });
    else list.sort(function (a, b) { return (a.isOther - b.isOther) || (order.indexOf(a.name) - order.indexOf(b.name)); });
    var grand = list.reduce(function (s, e) { return s + e.total; }, 0);
    return { nodes: list, byName: nodes, links: Array.from(links.values()), grand: grand, other: other };
  }

  RK.component({
    id: 'chord',
    deps: ['echarts'],
    defaults: {
      encode: { source: 'from_country', target: 'to_country', value: 'value', count: 'deals' },
      top: 10,                  // keep the N largest nodes (by two-way total); the rest become "Other"
      otherLabel: 'Other',
      includeSelf: false,       // keep source == target flows (domestic deals)
      sort: 'desc',             // desc (largest first, clockwise from 12 o'clock) | data
      colorBy: 'node',          // node (categorical) | single (accent; highlight still applies)
      nodeColors: {},           // {name: colour or theme token}
      highlight: null,          // node name(s) in accent2 (e.g. the client's home market)
      ribbonColor: 'source',    // source | target | gradient | neutral
      ribbonOpacity: 0.34,
      padAngle: 1.6,            // degrees between arcs
      ringWidth: 10,            // arc thickness (px)
      labels: true,
      labelValues: true,        // two-way total under each name
      minLabelShare: 0.015,     // hide labels of arcs below this share of the total (shown on hover)
      colorKey: true,           // small "Ribbon colour = …" key, top-left
      format: null,
      crossFilter: true,
      filterScope: 'dataset'
    },
    render: C(build, {
      rebuildOnResize: true,     // radius and label room are computed in px from the container
      on: {
        click: function (p, c) {
          if (p.dataType === 'edge' || !p.name || p.name === (c.options.otherLabel || 'Other')) return;
          selectNode(c, p.name);
        }
      }
    })
  });

  function build(ctx) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var cfmt = (enc.count && ctx.fmtOf(enc.count)) || '#,##0';
    var m = model(ctx);
    var hi = o.highlight == null ? [] : [].concat(o.highlight);
    var single = o.colorBy === 'single';
    // translucent ribbons read darker on a dark paper: lift them in dark themes
    o = util.merge({}, o, { ribbonOpacity: Math.min(0.7, o.ribbonOpacity * (t.dark ? 1.45 : 1)) });
    function touchesHi(l) { return hi.indexOf(l.source) >= 0 || hi.indexOf(l.target) >= 0; }

    // palette: theme categorical minus anything close to accent2 (reserved for the highlight), then tints
    var gold = RK.theme.parseColor(t.accent2);
    var base = t.cat.filter(function (c) {
      if (!hi.length) return true;
      var x = RK.theme.parseColor(c);
      return Math.sqrt(Math.pow(x[0] - gold[0], 2) + Math.pow(x[1] - gold[1], 2) + Math.pow(x[2] - gold[2], 2)) > 90;
    });
    if (!base.length) base = t.cat.slice();
    var pal = base.concat(base.map(function (c) { return RK.theme.mix(c, t.paper, 0.45); }));
    var ci = 0;
    var colorOf = {};
    m.nodes.forEach(function (n) {
      var c = tokenColor(t, (o.nodeColors || {})[n.name]);
      if (!c && hi.indexOf(n.name) >= 0) c = t.accent2;
      if (!c && n.isOther) c = t.neutral;
      if (!c) c = single ? t.accent : pal[ci++ % pal.length];
      colorOf[n.name] = c;
    });

    // selection: selected nodes + their partners stay in focus
    var sel = ctx.selected(enc.source), active = null;
    if (sel.length) {
      active = new Set(sel);
      m.links.forEach(function (l) {
        if (sel.indexOf(l.source) >= 0) active.add(l.target);
        if (sel.indexOf(l.target) >= 0) active.add(l.source);
      });
    }

    // geometry: room for labels left / right and above / below the ring
    var W = ctx.el.clientWidth || 600, H = ctx.el.clientHeight || 400;
    var nameFont = '600 11px ' + t.fontSans, valFont = '10.5px ' + t.fontNum;
    function share(n) { return m.grand ? n.total / m.grand : 0; }
    var showLabels = o.labels !== false;
    var labW = 0;
    if (showLabels) {
      m.nodes.forEach(function (n) {
        if (share(n) < o.minLabelShare) return;
        labW = Math.max(labW, measure(n.name, nameFont), o.labelValues ? measure(RK.format(n.total, fmt), valFont) : 0);
      });
    }
    var lineH = o.labelValues ? 27 : 14;
    var keyH = o.colorKey ? 18 : 0;
    var R = Math.max(40, Math.min(H / 2 - (showLabels ? lineH + 12 : 8) - keyH / 2, W / 2 - (showLabels ? labW + 26 : 8)));
    var r0 = Math.max(10, R - o.ringWidth);
    var cx = W / 2, cy = H / 2 + keyH / 2;

    var data = m.nodes.map(function (n) {
      var dim = active && !active.has(n.name);
      return { name: n.name, itemStyle: { color: colorOf[n.name], opacity: dim ? 0.25 : 1 } };
    });
    var links = m.links.map(function (l) {
      var op = o.ribbonOpacity;
      if (single && hi.length) op = touchesHi(l) ? Math.min(0.75, o.ribbonOpacity * 2) : o.ribbonOpacity * 0.4;
      if (active) op = (sel.indexOf(l.source) >= 0 || sel.indexOf(l.target) >= 0) ? Math.min(0.8, o.ribbonOpacity * 1.9) : 0.05;
      return { source: l.source, target: l.target, value: l.value, count: l.count, lineStyle: { opacity: op } };
    });

    var tooltip = {
      trigger: 'item',
      formatter: function (p) {
        if (p.dataType === 'edge') {
          var d = p.data, rows = [{ label: ctx.title(enc.value), value: RK.format(d.value, fmt), bold: true }];
          if (enc.count && ctx.field(enc.count)) rows.push({ label: ctx.title(enc.count), value: RK.format(d.count, cfmt) });
          var back = m.links.filter(function (l) { return l.source === d.target && l.target === d.source; })[0];
          rows.push({ label: 'Reverse flow', value: RK.format(back ? back.value : 0, fmt) });
          return C.tip(d.source + '  \u2192  ' + d.target, rows);
        }
        var n = m.byName.get(p.name);
        if (!n) return '';
        var tr = [
          { color: colorOf[n.name], label: 'Outbound (' + ctx.title(enc.source) + ')', value: RK.format(n.out, fmt) },
          { label: 'Inbound (' + ctx.title(enc.target) + ')', value: RK.format(n.inn, fmt) },
          { label: 'Net outflow', value: RK.format(n.out - n.inn, signed(fmt)) },
          { label: 'Share of two-way total', value: RK.format(share(n), '0.0%'), bold: true }
        ];
        if (enc.count && ctx.field(enc.count)) tr.splice(2, 0, { label: ctx.title(enc.count), value: RK.format(n.outN + n.inN, cfmt) });
        return C.tip(n.name, tr, n.isOther && n.members.length ? n.members.join(', ') : null);
      }
    };

    var graphic = [];
    if (keyH) {
      var keyText = single && hi.length ? 'Highlighted: flows to / from ' + hi.join(', ')
        : 'Ribbon colour = ' + (o.ribbonColor === 'target' ? ctx.title(enc.target) : ctx.title(enc.source)) + (o.ribbonColor === 'gradient' ? ' \u2192 ' + ctx.title(enc.target) : '');
      graphic.push({ type: 'text', id: 'key', left: 0, top: 0, silent: true, style: { text: keyText, fill: t.ink3, font: '10.5px ' + t.fontSans } });
    }

    if (!hasChord()) {
      return fallback(ctx, m, data, links, colorOf, tooltip, graphic, R, cx, cy, fmt);
    }

    if (showLabels) {
      graphic = graphic.concat(radialLabels(ctx, m, {
        cx: cx, cy: cy, R: R, W: W, H: H, top: keyH, lineH: lineH, fmt: fmt, active: active,
        pad: (o.padAngle || 0) * Math.PI / 180
      }));
    }

    return {
      tooltip: tooltip,
      graphic: graphic,
      series: [{
        id: 'chord',
        type: 'chord',
        center: [cx, cy],
        radius: [r0, R],
        clockwise: true,
        startAngle: 90,
        padAngle: o.padAngle,
        minAngle: 0,
        itemStyle: { borderRadius: 0, borderWidth: 0 },
        // ECharts 6.1 only fills ribbons for 'source' | 'target' | 'gradient' (a literal colour is ignored)
        lineStyle: { color: ['source', 'target', 'gradient'].indexOf(o.ribbonColor) >= 0 ? o.ribbonColor : 'source', opacity: o.ribbonOpacity, width: 0 },
        label: { show: false },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: Math.min(0.85, o.ribbonOpacity * 2.2) }, label: { show: false } },
        blur: { itemStyle: { opacity: 0.3 }, lineStyle: { opacity: 0.05 } },
        data: data,
        links: links,
        animationDuration: 900,
        animationEasing: 'cubicOut'
      }]
    };
  }

  /**
   * Outside labels placed like think-cell pie labels: anchored at each arc's mid-angle (same
   * angle maths as the ECharts chord layout), de-overlapped per side, hugging the ring, with a
   * hairline leader when a label had to move.
   */
  function radialLabels(ctx, m, g) {
    var o = ctx.options, t = ctx.theme;
    var nodes = m.nodes.filter(function (n) { return n.total > 0; });
    var pad = g.pad;
    if (pad * nodes.length >= 2 * Math.PI) pad = 0;
    var k = -Math.PI / 2, S = (2 * Math.PI - pad * nodes.length) / (m.grand || 1);
    var items = [];
    nodes.forEach(function (n) {
      var a = S * n.total, mid = k + a / 2;
      k += a + pad;
      if (m.grand && n.total / m.grand < o.minLabelShare) return;
      var cos = Math.cos(mid), sin = Math.sin(mid), rr = g.R + 10;
      items.push({
        n: n, mid: mid, cos: cos, sin: sin, right: cos >= 0,
        ax: g.cx + cos * (g.R + 2), ay: g.cy + sin * (g.R + 2),
        y0: g.cy + sin * rr + sin * g.lineH / 2
      });
    });
    var lo = g.top + g.lineH / 2, hi = g.H - g.lineH / 2;
    [true, false].forEach(function (right) {
      var side = items.filter(function (it) { return it.right === right; }).sort(function (a, b) { return a.y0 - b.y0; });
      side.forEach(function (it, i) { it.y = Math.max(it.y0, lo, i ? side[i - 1].y + g.lineH : -Infinity); });
      for (var i = side.length - 1; i >= 0; i--) {
        var cap = i === side.length - 1 ? hi : side[i + 1].y - g.lineH;
        if (side[i].y > cap) side[i].y = Math.max(lo, cap);
      }
    });
    var out = [];
    items.forEach(function (it) {
      var rr = g.R + 12, dy = it.y - g.cy;
      var dx = Math.abs(dy) < rr ? Math.sqrt(rr * rr - dy * dy) : 0;
      var x = g.cx + (it.right ? 1 : -1) * (dx + 4);
      var dim = g.active && !g.active.has(it.n.name);
      var moved = Math.abs(it.y - it.y0) > 3;
      var name = safe(it.n.name);
      var txt = '{n|' + name + '}' + (o.labelValues ? '\n{v|' + safe(RK.format(it.n.total, g.fmt)) + '}' : '');
      if (moved) {
        out.push({
          type: 'polyline', id: 'lead-' + it.n.name, silent: true, z: 1,
          shape: { points: [[it.ax, it.ay], [x - (it.right ? 3 : -3), it.y]] },
          style: { stroke: t.rule, lineWidth: 1, fill: null, opacity: dim ? 0.4 : 1 }
        });
      }
      out.push({
        type: 'text', id: 'lab-' + it.n.name, x: x, y: it.y, silent: true, z: 2,
        style: {
          text: txt, align: it.right ? 'left' : 'right', verticalAlign: 'middle', opacity: dim ? 0.4 : 1,
          rich: {
            n: { fontWeight: 600, fontSize: 11, fill: t.ink, fontFamily: t.fontSans, lineHeight: 14, align: it.right ? 'left' : 'right' },
            v: { fontSize: 10.5, fill: t.ink3, fontFamily: t.fontNum, lineHeight: 13, align: it.right ? 'left' : 'right' }
          }
        },
        enterFrom: { style: { opacity: 0 } }
      });
    });
    return out;
  }

  /** ECharts < 6: circular graph with curved, value-weighted edges. */
  function fallback(ctx, m, data, links, colorOf, tooltip, graphic, R, cx, cy, fmt) {
    var o = ctx.options, t = ctx.theme;
    var maxT = Math.max.apply(null, m.nodes.map(function (n) { return n.total; }).concat([1]));
    var maxL = Math.max.apply(null, m.links.map(function (l) { return l.value; }).concat([1]));
    return {
      tooltip: tooltip,
      graphic: graphic,
      series: [{
        id: 'chord', type: 'graph', layout: 'circular', circular: { rotateLabel: false },
        center: [cx, cy], radius: R, roam: false,
        data: data.map(function (d, i) {
          var n = m.nodes[i];
          return util.merge(d, { value: n.total, symbolSize: 8 + 22 * Math.sqrt(n.total / maxT) });
        }),
        links: links.map(function (l) {
          return util.merge(l, { lineStyle: { width: 0.6 + 6 * l.value / maxL, curveness: 0.3, color: o.ribbonColor === 'target' ? 'target' : 'source' } });
        }),
        label: {
          show: o.labels !== false, position: 'right', color: t.ink, fontSize: 11,
          formatter: function (p) { return p.name + (o.labelValues ? '  ' + RK.format(p.value, fmt) : ''); }
        },
        lineStyle: { opacity: o.ribbonOpacity },
        emphasis: { focus: 'adjacency' },
        edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 6,
        itemStyle: { borderColor: t.paper, borderWidth: 1 }
      }]
    };
  }
})();
