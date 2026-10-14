/*!
 * RK component: network — relationship map (customers / suppliers / competitors / partners around
 * a target, board interlocks, investor networks). Edges come from the bound dataset (source,
 * target, value, type); nodes from options.nodesData (id, name, category, size) or, when absent,
 * are derived from the edges. Deterministic force or circular layout drawn 1:1 in px (roam + drag),
 * or live ECharts physics.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'network.hint': '{key} + 滚轮或双指缩放 · 拖动平移', 'network.size': '规模', 'network.lineWidth': '线宽：{field}', 'network.category': '类别',
      'network.connections': '连接数', 'network.linked': '关联{Field}'
    });
  }
  /** Category of nodes without one. */
  function otherCat() { return tr('other', 'Other'); }

  /** Label width via the shared canvas measure; +7% because the canvas may still measure a fallback face. */
  function measure(text, font) { return C.measure(text, font) * 1.07; }

  function tokenColor(t, v) {
    if (!v) return null;
    if (typeof t[v] === 'string' && t[v]) return t[v];
    var m = /^cat(\d+)$/.exec(v);
    if (m) return t.cat[(+m[1] - 1) % t.cat.length];
    return v;
  }

  /**
   * Toggle a node in this block's selection. A node matches edges at either end (source OR target);
   * the selection is scoped by crossFilterScope (default 'dataset': 'source' / 'target' are generic names).
   */
  function selectNode(ctx, value) {
    var enc = ctx.enc;
    if (ctx.options.crossFilter === false || value == null || !enc.source || !enc.target) return;
    ctx.select(enc.source, value, { either: enc.target, scope: ctx.options.filterScope || undefined });
  }

  /**
   * Wheel rule (as RK.chart.zoom): a plain wheel scrolls the report, Ctrl/Cmd + wheel or a trackpad
   * pinch zooms. Installed on the ECharts viewport (disposed with the chart): plain wheels are stopped
   * before the ECharts roam controller swallows them, and a short hint keeps the zoom discoverable.
   * options.wheelZoom === true restores plain-wheel zoom.
   */
  function wheelGuard(inst, ctx) {
    var root = inst.getZr().painter.getViewportRoot(), hint = null, timer = null;
    function onWheel(e) {
      if (e.ctrlKey || e.metaKey || ctx.options.wheelZoom === true || ctx.options.roam === false) return;
      e.stopPropagation();
      if (!hint) {
        hint = RK.util.h('div.rk-noprint', { 'aria-hidden': 'true', style: {
          position: 'absolute', right: '8px', bottom: '8px', padding: '3px 8px', 'pointer-events': 'none',
          font: '11px ' + ctx.theme.fontSans, color: 'var(--rk-ink-2)', background: 'var(--rk-tooltip-bg)',
          border: '1px solid var(--rk-rule)', 'border-radius': '4px', opacity: '0', transition: 'opacity 160ms'
        } }, tr('network.hint', '{key} + wheel or pinch to zoom \u00b7 drag to pan', { key: /Mac|iP/.test(navigator.platform) ? '\u2318' : 'Ctrl' }));
        root.appendChild(hint);
      }
      hint.style.opacity = '1';
      clearTimeout(timer);
      timer = setTimeout(function () { hint.style.opacity = '0'; }, 1400);
    }
    root.addEventListener('wheel', onWheel, true);
    root.addEventListener('mousewheel', onWheel, true);
  }

  /** Nodes + edges with degree / weighted degree; nodes missing from nodesData are derived. */
  function model(ctx) {
    var o = ctx.options, enc = ctx.enc;
    var nodeDs = o.nodesData ? RK.data.get(o.nodesData) : null;
    var nodeRows = nodeDs ? ctx.view(o.nodesData) : [];
    var nodes = new Map();
    nodeRows.forEach(function (r) {
      var id = r[enc.id];
      if (id == null || nodes.has(String(id))) return;
      nodes.set(String(id), {
        id: String(id), name: r[enc.name] != null ? String(r[enc.name]) : String(id),
        category: enc.category && r[enc.category] != null ? String(r[enc.category]) : null,
        size: enc.size && util.isNum(r[enc.size]) ? r[enc.size] : null,
        row: r, degree: 0, weight: 0
      });
    });
    var restricted = !!nodeDs;   // with a node table, edges to unknown / filtered-out nodes are dropped
    var edges = [];
    ctx.rows.forEach(function (r) {
      var s = r[enc.source], d = r[enc.target];
      if (s == null || d == null || s === d) return;
      s = String(s); d = String(d);
      [s, d].forEach(function (id) {
        if (!nodes.has(id) && !restricted) nodes.set(id, { id: id, name: id, category: null, size: null, derived: true, degree: 0, weight: 0 });
      });
      if (!nodes.has(s) || !nodes.has(d)) return;
      var v = util.isNum(r[enc.value]) ? r[enc.value] : null;
      edges.push({ source: s, target: d, value: v, type: enc.edgeType ? r[enc.edgeType] : null, row: r });
      [s, d].forEach(function (id) { var n = nodes.get(id); n.degree++; n.weight += v || 0; });
    });
    var list = Array.from(nodes.values());
    if (restricted && o.hideIsolated !== false) list = list.filter(function (n) { return n.degree > 0; });
    list.forEach(function (n) { if (n.size == null) n.size = n.weight || n.degree || 1; });
    return { nodes: list, byId: new Map(list.map(function (n) { return [n.id, n]; })), edges: edges, nodeDs: nodeDs };
  }

  /**
   * Deterministic spring-electrical layout (Fruchterman–Reingold) in a unit square, seeded on a
   * circle grouped by category. Heavier edges pull harder; one dominant highlighted hub is pinned
   * to the centre. Returns [x, y] in [-1, 1].
   */
  function springLayout(nodes, edges, hubIndex) {
    var n = nodes.length, pos = [], i, j;
    if (!n) return pos;
    for (i = 0; i < n; i++) {
      var a = -Math.PI / 2 + 2 * Math.PI * i / n;
      pos.push(i === hubIndex ? [0, 0] : [Math.cos(a) * 0.85, Math.sin(a) * 0.85]);
    }
    if (n === 1) return [[0, 0]];
    var k = Math.sqrt(4 / n) * 0.62, temp = 0.18;
    var ws = edges.map(function (e) { return e.w; }), wx = util.extent(ws);
    for (var it = 0; it < 320; it++) {
      var disp = pos.map(function () { return [0, 0]; });
      for (i = 0; i < n; i++) {
        for (j = i + 1; j < n; j++) {
          var dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1];
          var d2 = dx * dx + dy * dy;
          if (d2 < 1e-9) { dx = 1e-3 * (i - j); dy = 1e-3; d2 = dx * dx + dy * dy; }
          var d = Math.sqrt(d2), f = (k * k / d) * (1 + nodes[i].r + nodes[j].r);
          disp[i][0] += dx / d * f; disp[i][1] += dy / d * f;
          disp[j][0] -= dx / d * f; disp[j][1] -= dy / d * f;
        }
      }
      edges.forEach(function (e) {
        var dx = pos[e.s][0] - pos[e.t][0], dy = pos[e.s][1] - pos[e.t][1];
        var d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        var w = wx[1] > wx[0] ? 0.7 + 0.6 * (e.w - wx[0]) / (wx[1] - wx[0]) : 1;
        var f = d * d / k * w;
        disp[e.s][0] -= dx / d * f; disp[e.s][1] -= dy / d * f;
        disp[e.t][0] += dx / d * f; disp[e.t][1] += dy / d * f;
      });
      for (i = 0; i < n; i++) {
        if (i === hubIndex) continue;
        disp[i][0] -= pos[i][0] * k * 1.2; disp[i][1] -= pos[i][1] * k * 1.2;   // gravity
        var len = Math.sqrt(disp[i][0] * disp[i][0] + disp[i][1] * disp[i][1]) || 1e-9;
        var step = Math.min(len, temp);
        pos[i][0] = util.clamp(pos[i][0] + disp[i][0] / len * step, -1.2, 1.2);
        pos[i][1] = util.clamp(pos[i][1] + disp[i][1] / len * step, -1.2, 1.2);
      }
      temp = Math.max(0.002, temp * 0.985);
    }
    return pos;
  }

  /** Fit unit-space positions into a px rect (independent x / y scale), then push overlapping symbols apart. */
  function fitToRect(pos, radii, rect) {
    var xs = util.extent(pos.map(function (p) { return p[0]; })), ys = util.extent(pos.map(function (p) { return p[1]; }));
    var out = pos.map(function (p) {
      return [
        rect.x + (xs[1] > xs[0] ? (p[0] - xs[0]) / (xs[1] - xs[0]) : 0.5) * rect.w,
        rect.y + (ys[1] > ys[0] ? (p[1] - ys[0]) / (ys[1] - ys[0]) : 0.5) * rect.h
      ];
    });
    for (var pass = 0; pass < 60; pass++) {
      var moved = false;
      for (var i = 0; i < out.length; i++) {
        for (var j = i + 1; j < out.length; j++) {
          var dx = out[j][0] - out[i][0], dy = out[j][1] - out[i][1];
          var d = Math.sqrt(dx * dx + dy * dy) || 1e-6, min = radii[i] + radii[j] + 8;
          if (d >= min) continue;
          var push = (min - d) / 2;
          out[i][0] -= dx / d * push; out[i][1] -= dy / d * push;
          out[j][0] += dx / d * push; out[j][1] += dy / d * push;
          moved = true;
        }
      }
      out.forEach(function (p, idx) {
        p[0] = util.clamp(p[0], rect.x + radii[idx] * 0.5, rect.x + rect.w - radii[idx] * 0.5);
        p[1] = util.clamp(p[1], rect.y + radii[idx] * 0.5, rect.y + rect.h - radii[idx] * 0.5);
      });
      if (!moved) break;
    }
    return out;
  }

  /* ---- label placement ------------------------------------------------------------------ *
   * Candidate label positions around a symbol of radius r. dir: unit vector the position points to
   * (used to prefer the side facing away from the hub). ECharts position: string or [dx, dy] from the
   * symbol's top-left corner with explicit align / verticalAlign.
   */
  var LABEL_DIST = 4;
  var POSITIONS = [
    { key: 'right', dir: [1, 0] }, { key: 'left', dir: [-1, 0] }, { key: 'top', dir: [0, -1] }, { key: 'bottom', dir: [0, 1] },
    { key: 'tr', dir: [0.71, -0.71] }, { key: 'br', dir: [0.71, 0.71] }, { key: 'tl', dir: [-0.71, -0.71] }, { key: 'bl', dir: [-0.71, 0.71] },
    { key: 'tR', dir: [0.38, -0.92] }, { key: 'bR', dir: [0.38, 0.92] }, { key: 'tL', dir: [-0.38, -0.92] }, { key: 'bL', dir: [-0.38, 0.92] }
  ];
  function labelBox(key, x, y, r, w, h) {
    var d = LABEL_DIST, q = r * 0.72 + 1;
    switch (key) {
      case 'right': return { x0: x + r + d, y0: y - h / 2, x1: x + r + d + w, y1: y + h / 2 };
      case 'left': return { x0: x - r - d - w, y0: y - h / 2, x1: x - r - d, y1: y + h / 2 };
      case 'top': return { x0: x - w / 2, y0: y - r - d - h, x1: x + w / 2, y1: y - r - d };
      case 'bottom': return { x0: x - w / 2, y0: y + r + d, x1: x + w / 2, y1: y + r + d + h };
      case 'tr': return { x0: x + q, y0: y - q - h, x1: x + q + w, y1: y - q };
      case 'br': return { x0: x + q, y0: y + q, x1: x + q + w, y1: y + q + h };
      case 'tl': return { x0: x - q - w, y0: y - q - h, x1: x - q, y1: y - q };
      case 'bl': return { x0: x - q - w, y0: y + q, x1: x - q, y1: y + q + h };
      // above / below, starting at the symbol's left edge (R) or ending at its right edge (L)
      case 'tR': return { x0: x - r, y0: y - r - d - h, x1: x - r + w, y1: y - r - d };
      case 'bR': return { x0: x - r, y0: y + r + d, x1: x - r + w, y1: y + r + d + h };
      case 'tL': return { x0: x + r - w, y0: y - r - d - h, x1: x + r, y1: y - r - d };
      default: return { x0: x + r - w, y0: y + r + d, x1: x + r, y1: y + r + d + h };   // bL
    }
  }
  /** ECharts label props for a planned position (diagonals use px offsets from the symbol's box). */
  function labelPos(key, r) {
    if (key === 'right' || key === 'left' || key === 'top' || key === 'bottom') return { position: key, distance: LABEL_DIST };
    if (/^[tb][RL]$/.test(key)) {
      var up = key[0] === 't';
      return { position: [key[1] === 'R' ? 0 : 2 * r, up ? -LABEL_DIST : 2 * r + LABEL_DIST], align: key[1] === 'R' ? 'left' : 'right', verticalAlign: up ? 'bottom' : 'top' };
    }
    var q = r * 0.72 + 1, right = key === 'tr' || key === 'br', topSide = key === 'tr' || key === 'tl';
    return {
      position: [r + (right ? q : -q), r + (topSide ? -q : q)],
      align: right ? 'left' : 'right', verticalAlign: topSide ? 'bottom' : 'top'
    };
  }
  function overlap(a, b, pad) {
    return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
  }
  /** Preferred position order for a node: the side facing away from the hub / centre first. */
  function sideOrder(x, y, cx, cy, isHub) {
    if (isHub) return ['bottom', 'top', 'right', 'left', 'br', 'bl', 'tr', 'tl'];
    var dx = x - cx, dy = y - cy, len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    // horizontal labels read best: bias left / right over top / bottom and diagonals
    return POSITIONS.map(function (p) {
      var score = p.dir[0] * dx + p.dir[1] * dy + (p.key === 'right' || p.key === 'left' ? 0.45 : /^[tb][RL]$/.test(p.key) ? -0.05 : p.key.length === 2 ? 0.1 : 0);
      return { key: p.key, s: score };
    }).sort(function (a, b) { return b.s - a.s; }).map(function (p) { return p.key; });
  }

  /**
   * Nudge symbols so the preferred (outward, horizontal) label of every labelled node clears the
   * other symbols and labels. Moves are mostly vertical (labels are wide and short).
   */
  function relaxForLabels(px, radii, labels, rect, cx, cy, iterations) {
    var n = px.length;
    for (var it = 0; it < iterations; it++) {
      var moved = false;
      var boxes = px.map(function (p, i) {
        var L = labels[i];
        if (!L) return null;
        return labelBox(i === L.hubIndex ? 'bottom' : (p[0] >= cx ? 'right' : 'left'), p[0], p[1], radii[i], L.w, L.h);
      });
      for (var i = 0; i < n; i++) {
        var b = boxes[i];
        if (!b) continue;
        for (var j = 0; j < n; j++) {
          if (j === i) continue;
          var r = radii[j], nb = { x0: px[j][0] - r, x1: px[j][0] + r, y0: px[j][1] - r, y1: px[j][1] + r };
          var hitNode = overlap(b, nb, 3), hitLab = boxes[j] && j > i && overlap(b, boxes[j], 2);
          if (!hitNode && !hitLab) continue;
          var other = hitNode ? nb : boxes[j];
          var bc = (b.y0 + b.y1) / 2, oc = (other.y0 + other.y1) / 2;
          var need = hitNode ? ((b.y1 - b.y0) / 2 + r + 3) - Math.abs(oc - bc) : ((b.y1 - b.y0) / 2 + (other.y1 - other.y0) / 2 + 2) - Math.abs(oc - bc);
          if (need <= 0) continue;
          var sgn = oc >= bc ? 1 : -1, mv = Math.min(6, need / 2 + 0.5);
          px[j][1] += sgn * mv; px[i][1] -= sgn * mv;
          moved = true;
        }
      }
      // keep symbols apart and inside the rect
      for (var a = 0; a < n; a++) {
        for (var c = a + 1; c < n; c++) {
          var dx = px[c][0] - px[a][0], dy = px[c][1] - px[a][1], d = Math.sqrt(dx * dx + dy * dy) || 1e-6, min = radii[a] + radii[c] + 6;
          if (d >= min) continue;
          var push = (min - d) / 2;
          px[a][0] -= dx / d * push; px[a][1] -= dy / d * push; px[c][0] += dx / d * push; px[c][1] += dy / d * push;
        }
      }
      px.forEach(function (p, k) {
        if (labels[k] && labels[k].pinned) { p[0] = labels[k].pinned[0]; p[1] = labels[k].pinned[1]; return; }
        p[0] = util.clamp(p[0], rect.x + radii[k] * 0.5, rect.x + rect.w - radii[k] * 0.5);
        p[1] = util.clamp(p[1], rect.y + radii[k] * 0.5, rect.y + rect.h - radii[k] * 0.5);
      });
      if (!moved) break;
    }
  }

  /**
   * Final placement: in priority order, each label takes the first candidate position that stays in
   * the chart and clears every symbol and every placed label; labels that fit nowhere are hidden
   * (they still show on hover). Returns [{key, box} | null] by node index.
   */
  function planLabels(px, radii, order, labels, bounds, cx, cy, hubIndex) {
    var placed = [], out = px.map(function () { return null; });
    var nodeBoxes = px.map(function (p, i) { return { x0: p[0] - radii[i], x1: p[0] + radii[i], y0: p[1] - radii[i], y1: p[1] + radii[i] }; });
    order.forEach(function (i) {
      var L = labels[i];
      if (!L) return;
      var keys = sideOrder(px[i][0], px[i][1], cx, cy, i === hubIndex);
      for (var k = 0; k < keys.length; k++) {
        var b = labelBox(keys[k], px[i][0], px[i][1], radii[i], L.w, L.h);
        if (b.x0 < bounds.x0 || b.x1 > bounds.x1 || b.y0 < bounds.y0 || b.y1 > bounds.y1) continue;
        if (nodeBoxes.some(function (nb, j) { return j !== i && overlap(b, nb, 2); })) continue;
        if (placed.some(function (pb) { return overlap(b, pb, 2); })) continue;
        placed.push(b);
        out[i] = { key: keys[k], box: b };
        return;
      }
    });
    return out;
  }

  RK.component({
    id: 'network',
    deps: ['echarts'],
    defaults: {
      encode: { source: 'source', target: 'target', value: 'value', edgeType: 'type', id: 'id', name: 'name', category: 'type', size: 'size' },
      nodesData: null,          // dataset id of the node table (one row per node); derived from edges when null
      layout: 'force',          // force (deterministic, solved before paint) | circular (hub centred) | physics (live ECharts force)
      highlight: null,          // node id(s) or name(s) drawn in accent2 (e.g. the target company)
      categoryColors: {},       // {category: colour or theme token}
      labels: 'auto',           // auto (largest nodes) | true | false — placed clear of symbols, hidden (hover) when no room
      labelTop: 10,             // with labels 'auto': label the N largest nodes (+ highlighted)
      nodeSize: [10, 46],       // symbol diameter range (sqrt scale on size)
      edgeWidth: [0.8, 5],      // edge width range (linear on value)
      edgeColor: 'auto',        // auto (colour of the non-highlighted end) | source | target | neutral
      edgeOpacity: 0.45,
      edgeCurve: 0.08,
      dashedTypes: [],          // edge types drawn dashed (listed in the edge key; dashes are otherwise reserved for reference lines)
      edgeKey: true,            // edge key beside the legend: line-width scale (+ dashed edge types)
      arrows: false,            // arrowheads at the target end
      force: {},                // layout 'physics' overrides: {repulsion, edgeLength, gravity, friction}
      roam: true,
      draggable: true,
      hideIsolated: true,       // with nodesData: drop nodes without edges under the current filters
      legend: true,
      format: null,             // edge value format (defaults to the value field's format)
      wheelZoom: null,          // true: plain wheel zooms (default: Ctrl/Cmd + wheel or pinch; plain wheel scrolls the page)
      crossFilter: true,
      crossFilterScope: 'dataset',  // dataset | global — reach of the click-to-filter selection
      filterScope: null         // deprecated alias of crossFilterScope
    },
    render: C(build, {
      rebuildOnResize: true,     // positions are solved in px for the container size
      init: wheelGuard,
      on: {
        click: function (p, c) {
          if (p.dataType === 'node' && p.data && p.data.rkId != null) selectNode(c, p.data.rkId);
        }
      }
    })
  });

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var m = model(ctx);
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var sizeFmt = (m.nodeDs && enc.size && m.nodeDs.field(enc.size) && m.nodeDs.field(enc.size).format) || fmt;
    var sizeTitle = (m.nodeDs && enc.size && m.nodeDs.field(enc.size) && m.nodeDs.field(enc.size).title) || tr('network.size', 'Size');
    var hi = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    function isHi(n) { return hi.indexOf(n.id) >= 0 || hi.indexOf(n.name) >= 0; }

    // categories (legend) — a category made only of highlighted nodes takes accent2
    var cats = util.unique(m.nodes.map(function (n) { return n.category || otherCat(); }));
    var pal = RK.theme.palette({ n: cats.length });   // categorical, kept clear of accent2 (the highlight)
    var pi = 0, catColor = {};
    cats.forEach(function (c) {
      var members = m.nodes.filter(function (n) { return (n.category || otherCat()) === c; });
      var custom = tokenColor(t, (o.categoryColors || {})[c]);
      if (custom) catColor[c] = custom;
      else if (hi.length && members.length && members.every(isHi)) catColor[c] = t.accent2;
      else catColor[c] = pal[pi++];
    });
    function colorOf(n) { return isHi(n) ? t.accent2 : catColor[n.category || otherCat()]; }

    // scales
    var sizes = m.nodes.map(function (n) { return n.size; });
    var sx = util.extent(sizes), smax = Math.sqrt(Math.max(sx[1], 1e-9)), smin = Math.sqrt(Math.max(sx[0], 0));
    function symSize(n) {
      if (smax === smin) return (o.nodeSize[0] + o.nodeSize[1]) / 2;
      return o.nodeSize[0] + (o.nodeSize[1] - o.nodeSize[0]) * (Math.sqrt(Math.max(n.size, 0)) - smin) / (smax - smin);
    }
    var vx = util.extent(m.edges.map(function (e) { return e.value; }));
    function edgeW(e) {
      if (e.value == null || vx[1] === vx[0]) return (o.edgeWidth[0] + o.edgeWidth[1]) / 2;
      return o.edgeWidth[0] + (o.edgeWidth[1] - o.edgeWidth[0]) * (e.value - vx[0]) / (vx[1] - vx[0]);
    }

    // labels: largest nodes (+ highlighted) unless told otherwise
    var labelled = new Set();
    if (o.labels === true) m.nodes.forEach(function (n) { labelled.add(n.id); });
    else if (o.labels !== false) {
      m.nodes.slice().sort(function (a, b) { return b.size - a.size; }).slice(0, o.labelTop).forEach(function (n) { labelled.add(n.id); });
      m.nodes.forEach(function (n) { if (isHi(n)) labelled.add(n.id); });
    }

    // selection: selected nodes + neighbours stay in focus
    var sel = ctx.selected(enc.source), active = null;
    if (sel.length) {
      active = new Set(sel);
      m.edges.forEach(function (e) {
        if (sel.indexOf(e.source) >= 0) active.add(e.target);
        if (sel.indexOf(e.target) >= 0) active.add(e.source);
      });
    }

    // ---- layout -------------------------------------------------------------------------
    // force: deterministic spring layout solved here (calm, print-identical), drawn 1:1 in px;
    // circular: equal angular steps around the hub, categories contiguous; physics: live ECharts force.
    var mode = o.layout === 'circular' ? 'circular' : (o.layout === 'physics' ? 'physics' : 'force');
    var W = ctx.el.clientWidth || 800, H = ctx.el.clientHeight || 420;
    var ordered = m.nodes.slice().sort(function (a, b) {
      return (cats.indexOf(a.category || otherCat()) - cats.indexOf(b.category || otherCat())) || (b.size - a.size);
    });
    var idx = new Map(ordered.map(function (n, i) { return [n.id, i]; }));
    var his = ordered.filter(isHi);
    var hub = his.length === 1 && his[0].degree >= ordered.length / 3 ? idx.get(his[0].id) : -1;

    // legend row: categories top-left, then the edge key (width scale, dashed types) on the same row when it fits
    var showLegend = o.legend !== false && cats.length > 1;
    var legFont = '11px ' + t.fontSans, dash = [].concat(o.dashedTypes || []);
    // the plain legend wraps onto more rows when the categories do not fit one line
    var legRows = showLegend ? 1 : 0, legendW = 0;
    if (showLegend) cats.forEach(function (c) {
      var iw = 10 + 5 + measure(c, legFont) + 14;
      if (legendW && legendW + iw > W - 10) { legRows++; legendW = 0; }
      legendW += iw;
    });
    var keyItems = [];
    if (o.edgeKey !== false && m.edges.length) {
      var usedTypes = util.unique(m.edges.map(function (e) { return e.type; }));
      dash.forEach(function (ty) { if (usedTypes.indexOf(ty) >= 0) keyItems.push({ kind: 'dash', label: String(ty) }); });
      var vf = ctx.field(enc.value) || {};
      if (vx[1] > vx[0]) keyItems.push({ kind: 'width', label: tr('network.lineWidth', 'Line width: {field}', { field: ctx.title(enc.value) + (vf.unit ? ' (' + vf.unit + ')' : '') }), lo: RK.format(vx[0], fmt), hi: RK.format(vx[1], fmt) });
    }
    var keyW = keyItems.reduce(function (sw, it) {
      return sw + (it.kind === 'dash' ? 22 + measure(it.label, legFont) : measure(it.label, legFont) + 8 + 18 + 4 + measure(it.lo, legFont) + 10 + 18 + 4 + measure(it.hi, legFont)) + 16;
    }, 0);
    // key on the legend's last row when it fits, else on a row of its own
    var keyRow = keyItems.length ? (legendW && legendW + 12 + keyW > W ? 1 : 0) : -1;
    var legendH = (showLegend || keyItems.length ? 22 + Math.max(0, legRows - 1) * 24 : 0) + (keyRow === 1 ? 20 : 0) + 8;

    var sizesPx = ordered.map(symSize);
    var labFont = '500 11px ' + t.fontSans, LAB_H = 15, labW = 0;
    var labels = ordered.map(function (n, i) {
      if (!labelled.has(n.id)) return null;
      var w = Math.ceil(measure(n.name, isHi(n) ? '700 11px ' + t.fontSans : labFont)) + 6;   // + chip padding
      labW = Math.max(labW, w);
      return { w: w, h: LAB_H, hubIndex: hub };
    });
    // side margins hold the outermost labels; capped so narrow blocks keep room for the graph
    // (outer labels that do not fit go above / below / inward instead)
    var padX = 6 + (labW ? Math.min(labW + LABEL_DIST, Math.max(56, W * (mode === 'circular' ? 0.2 : 0.13))) : 0);
    if (mode === 'circular') {
      var ringN = Math.max(1, ordered.length - (hub >= 0 ? 1 : 0));
      // symbols smaller than the arc step
      var rr0 = Math.min(W / 2 - padX, (H - legendH - 2 * LAB_H - 16) / 2);
      var stepPx = 2 * Math.PI * Math.max(30, rr0) / ringN;
      sizesPx = sizesPx.map(function (d, i) { return i === hub ? d : Math.min(d, Math.max(8, stepPx * 0.55)); });
    }
    var radii = sizesPx.map(function (d) { return d / 2; });
    var rMax = Math.max.apply(null, sizesPx.concat([10])) / 2;
    var rect = { x: padX, y: legendH + rMax + 4, w: Math.max(40, W - 2 * padX), h: Math.max(40, H - legendH - 2 * rMax - 10) };
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var px = null;
    if (mode === 'force') {
      var lay = springLayout(
        ordered.map(function (n, i) { return { r: (sizesPx[i] - o.nodeSize[0]) / Math.max(1, o.nodeSize[1]) * 0.8 }; }),
        m.edges.map(function (e) { return { s: idx.get(e.source), t: idx.get(e.target), w: e.value == null ? 1 : e.value }; }),
        hub);
      px = fitToRect(lay, radii, rect);
      if (hub >= 0) labels[hub] = labels[hub] ? util.merge({}, labels[hub], { pinned: px[hub].slice() }) : { w: 0, h: 0, pinned: px[hub].slice(), hubIndex: hub };
      relaxForLabels(px, radii, labels, rect, cx, cy, 80);
      if (hub >= 0 && labels[hub] && !labels[hub].w) labels[hub] = null;
    } else if (mode === 'circular') {
      // nodes on a circle (an ellipse when the block is much wider than tall) around the hub, clockwise from
      // 12 o'clock with categories contiguous. Steps are halfway between equal angles and equal heights:
      // a true ring, with a little more room at the poles where horizontal labels would otherwise stack.
      var ring = ordered.filter(function (n, i) { return i !== hub; });
      var ry = Math.max(30, rect.h / 2 - LAB_H / 2), rx = Math.max(30, Math.min(rect.w / 2, ry * 1.45));
      var nr = Math.ceil(ring.length / 2), nl = ring.length - nr;
      px = ordered.map(function () { return [cx, cy]; });
      ring.forEach(function (n, k) {
        var right = k < nr, tt = ((right ? k : k - nr) + 0.5) / (right ? nr : nl);
        var yy = (-Math.cos(Math.PI * tt) + (2 * tt - 1)) / 2;      // right half: top -> bottom
        if (!right) yy = -yy;                                       // left half: bottom -> top
        var xx = Math.sqrt(Math.max(0, 1 - yy * yy)) * (right ? 1 : -1);
        px[idx.get(n.id)] = [cx + xx * rx, cy + yy * ry];
      });
    }
    var box = null, plan = null;
    if (px) {
      var bx = util.extent(px.map(function (p) { return p[0]; })), by = util.extent(px.map(function (p) { return p[1]; }));
      box = { left: bx[0], top: by[0], width: Math.max(1, bx[1] - bx[0]), height: Math.max(1, by[1] - by[0]) };
      // labels: highlighted first, then by size; each takes the first free position (outward side first)
      var prio = ordered.map(function (n, i) { return i; }).filter(function (i) { return labels[i]; })
        .sort(function (a, b) { return (isHi(ordered[b]) - isHi(ordered[a])) || (ordered[b].size - ordered[a].size); });
      plan = planLabels(px, radii, prio, labels, { x0: 1, x1: W - 1, y0: legendH - 2, y1: H - 1 }, cx, cy, hub);
    }

    var data = ordered.map(function (n, i) {
      var c = colorOf(n), dim = active && !active.has(n.id), big = labelled.has(n.id);
      var right = !px || px[i][0] >= cx - 1;
      var pl = plan ? plan[i] : null;
      var lab = {
        show: plan ? !!pl : big,
        fontWeight: isHi(n) ? 700 : 500,
        color: isHi(n) ? t.ink : t.ink2,
        opacity: dim ? 0.35 : 1
      };
      if (pl) util.merge(lab, labelPos(pl.key, radii[i]));
      else lab.position = i === hub ? 'bottom' : (right ? 'right' : 'left');
      var d = {
        id: n.id, name: n.name, rkId: n.id,
        category: cats.indexOf(n.category || otherCat()),
        value: n.size,
        symbolSize: sizesPx[i],
        itemStyle: { color: c, borderColor: t.paper, borderWidth: 1.2, opacity: dim ? 0.2 : 1 },
        label: lab
      };
      if (px) { d.x = px[i][0]; d.y = px[i][1]; }
      return d;
    });

    // edge key drawn as graphics next to (or under) the category legend
    var graphic = [];
    if (keyItems.length) {
      // the group is placed by its bounding box: top 5 lines its text up with the legend (5px padding + 7px half row)
      var lastRowTop = Math.max(0, legRows - 1) * 24;
      var gx = keyRow === 0 && legendW ? legendW + 12 : 0, gy = lastRowTop + (keyRow === 1 ? 26 : 5), kids = [], kxp = 0, KY = 7;
      var txt = function (x, str) { return { type: 'text', x: x, y: KY, style: { text: str, fill: t.ink2, fontSize: 11, fontFamily: t.fontSans, verticalAlign: 'middle' } }; };
      keyItems.forEach(function (it) {
        if (it.kind === 'dash') {
          kids.push({ type: 'line', shape: { x1: kxp, y1: KY, x2: kxp + 18, y2: KY }, style: { stroke: t.ink3, lineWidth: 1.6, lineDash: [4, 3] } });
          kids.push(txt(kxp + 22, it.label));
          kxp += 22 + measure(it.label, legFont) + 16;
        } else {
          kids.push(txt(kxp, it.label));
          kxp += measure(it.label, legFont) + 8;
          kids.push({ type: 'line', shape: { x1: kxp, y1: KY, x2: kxp + 18, y2: KY }, style: { stroke: t.ink3, lineWidth: o.edgeWidth[0] } });
          kids.push(txt(kxp + 22, it.lo));
          kxp += 22 + measure(it.lo, legFont) + 10;
          kids.push({ type: 'line', shape: { x1: kxp, y1: KY, x2: kxp + 18, y2: KY }, style: { stroke: t.ink3, lineWidth: o.edgeWidth[1] } });
          kids.push(txt(kxp + 22, it.hi));
          kxp += 22 + measure(it.hi, legFont) + 16;
        }
      });
      graphic.push({ type: 'group', id: 'rk-edge-key', left: gx, top: gy, silent: true, children: kids });
    }

    var links = m.edges.map(function (e) {
      var on = !active || sel.indexOf(e.source) >= 0 || sel.indexOf(e.target) >= 0;
      var a = m.byId.get(e.source), b = m.byId.get(e.target), col;
      if (o.edgeColor === 'neutral') col = t.neutral;
      else if (o.edgeColor === 'source') col = colorOf(a);
      else if (o.edgeColor === 'target') col = colorOf(b);
      else col = isHi(a) && !isHi(b) ? colorOf(b) : colorOf(a);   // auto: colour of the non-highlighted end
      var curve = o.edgeCurve;
      if (mode === 'circular' && px) {
        // bend chords towards the centre: sign from the side the control point falls on
        var p1 = px[idx.get(e.source)], p2 = px[idx.get(e.target)];
        var dx = p2[0] - p1[0], dy = p2[1] - p1[1], mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
        curve = idx.get(e.source) === hub || idx.get(e.target) === hub ? 0 : ((dy * (cx - mx) - dx * (cy - my)) >= 0 ? 0.22 : -0.22);
      }
      return {
        source: e.source, target: e.target, value: e.value, rkType: e.type,
        lineStyle: {
          width: edgeW(e), color: col, curveness: curve,
          type: dash.indexOf(e.type) >= 0 ? [Math.max(4, edgeW(e) * 2.2), Math.max(3, edgeW(e) * 1.6)] : 'solid',
          opacity: active ? (on ? Math.min(0.9, o.edgeOpacity * 1.8) : 0.06) : o.edgeOpacity
        }
      };
    });

    var n = Math.max(1, m.nodes.length), spacing = Math.sqrt(Math.max(1, rect.w * rect.h) / n);
    var force = util.merge({
      initLayout: 'circular',
      repulsion: Math.round(Math.max(40, Math.min(600, spacing * 1.6))),
      edgeLength: [Math.round(spacing * 0.35), Math.round(spacing * 0.9)],
      gravity: 0.1,
      friction: 0.6,
      layoutAnimation: !!ctx.motion
    }, o.force || {});

    return {
      legend: C.legend(ctx, { show: showLegend, data: cats, selectedMode: true, type: 'plain' }),
      graphic: graphic,
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          if (p.dataType === 'edge') {
            var d = p.data, a = m.byId.get(d.source), b = m.byId.get(d.target);
            var rows = [];
            if (d.rkType != null) rows.push({ label: ctx.title(enc.edgeType), value: d.rkType });
            rows.push({ label: ctx.title(enc.value), value: RK.format(d.value, fmt), bold: true });
            return C.tip((a ? a.name : d.source) + '  →  ' + (b ? b.name : d.target), rows);
          }
          var nd = m.byId.get(p.data && p.data.rkId);
          if (!nd) return '';
          var tipRows = [];
          if (nd.category) tipRows.push({ color: colorOf(nd), label: (m.nodeDs && m.nodeDs.field(enc.category) && m.nodeDs.field(enc.category).title) || tr('network.category', 'Category'), value: nd.category });
          tipRows.push({ label: sizeTitle, value: RK.format(nd.size, sizeFmt), bold: true });
          tipRows.push({ label: tr('network.connections', 'Connections'), value: RK.format(nd.degree, '#,##0') });
          if (nd.weight) tipRows.push({ label: tr('network.linked', 'Linked {field}', { field: String(ctx.title(enc.value)).toLowerCase(), Field: String(ctx.title(enc.value)) }), value: RK.format(nd.weight, fmt) });
          return C.tip(nd.name, tipRows);
        }
      },
      series: [{
        id: 'network',
        type: 'graph',
        layout: mode === 'physics' ? 'force' : 'none',
        force: mode === 'physics' ? force : undefined,
        // positions are px; a box equal to their bounding box keeps the view at 1:1 scale
        left: box ? box.left : padX, top: box ? box.top : legendH, width: box ? box.width : null, height: box ? box.height : null,
        right: box ? null : padX, bottom: box ? null : 8,
        preserveAspect: 'contain',
        roam: o.roam !== false,
        scaleLimit: { min: 0.4, max: 5 },
        draggable: o.draggable !== false,
        categories: cats.map(function (c) { return { name: c, itemStyle: { color: catColor[c] } }; }),
        data: data,
        links: links,
        edgeSymbol: o.arrows ? ['none', 'arrow'] : ['none', 'none'],
        edgeSymbolSize: [0, 7],
        // paper chip behind each label: edges never cut through the text (labels are planned to clear symbols)
        label: {
          position: 'right', distance: LABEL_DIST, fontSize: 11, lineHeight: 13, fontFamily: t.fontSans, color: t.ink2,
          backgroundColor: RK.theme.alpha(t.paper, 0.86), padding: [1, 3], borderRadius: 2
        },
        labelLayout: mode === 'physics' ? { hideOverlap: true } : undefined,
        lineStyle: { opacity: o.edgeOpacity },
        emphasis: {
          focus: 'adjacency',
          scale: 1.08,
          label: { show: true, color: t.ink, fontWeight: 600 },
          lineStyle: { opacity: 0.9 }
        },
        blur: { itemStyle: { opacity: 0.18 }, lineStyle: { opacity: 0.05 }, label: { opacity: 0.3 } },
        animationDuration: 800,
        animationEasing: 'cubicOut'
      }]
    };
  }
})();
