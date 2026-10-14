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

  var measure = (function () {
    var c2d = null;
    return function (text, font) {
      c2d = c2d || document.createElement('canvas').getContext('2d');
      c2d.font = font;
      return c2d.measureText(String(text)).width;
    };
  })();

  function tokenColor(t, v) {
    if (!v) return null;
    if (typeof t[v] === 'string' && t[v]) return t[v];
    var m = /^cat(\d+)$/.exec(v);
    if (m) return t.cat[(+m[1] - 1) % t.cat.length];
    return v;
  }

  function hsl(c) {
    var x = RK.theme.parseColor(c), r = x[0] / 255, g = x[1] / 255, b = x[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [h, s, l, x];
  }
  function rgbDist(a, b) { return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2)); }

  /**
   * Theme categorical colours in order, skipping any that read like the reserved highlight
   * (same hue family as accent2) or that are too close to a colour already picked.
   */
  function distinctPalette(cat, reserved) {
    var res = reserved ? hsl(reserved) : null, picked = [];
    cat.forEach(function (c) {
      var x = hsl(c);
      if (res && (rgbDist(x[3], res[3]) < 50 || (Math.min(Math.abs(x[0] - res[0]), 360 - Math.abs(x[0] - res[0])) < 22 && x[1] > 0.25 && res[1] > 0.25))) return;
      if (picked.some(function (p) { return rgbDist(hsl(p)[3], x[3]) < 60; })) return;
      picked.push(c);
    });
    // near-duplicates come back at the end (most distinct first), the reserved hue family only if needed
    var rest = cat.filter(function (c) {
      if (picked.indexOf(c) >= 0) return false;
      var x = hsl(c);
      return !(res && picked.length >= 3 && (rgbDist(x[3], res[3]) < 50 || (Math.min(Math.abs(x[0] - res[0]), 360 - Math.abs(x[0] - res[0])) < 22 && x[1] > 0.25 && res[1] > 0.25)));
    });
    function gapTo(c) { var x = hsl(c)[3]; return Math.min.apply(null, picked.map(function (p) { return rgbDist(hsl(p)[3], x); }).concat([999])); }
    rest.sort(function (a, b) { return gapTo(b) - gapTo(a); });
    return picked.concat(rest);
  }

  function selectScoped(ctx, field, value) {
    if (ctx.options.crossFilter === false || field == null) return;
    if (ctx.options.filterScope === 'global' || !ctx.dataset) { ctx.select(field, value); return; }
    var key = ctx.id + ':' + field, cur = RK.store.filter(key);
    var vals = cur && cur.op === 'in' ? cur.values.slice() : [];
    var i = vals.indexOf(value);
    if (i >= 0) vals.splice(i, 1); else vals.push(value);
    RK.store.setFilter(key, { field: field, op: 'in', values: vals, source: ctx.id, datasets: [ctx.dataset.id] });
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

  RK.component({
    id: 'network',
    deps: ['echarts'],
    defaults: {
      encode: { source: 'source', target: 'target', value: 'value', edgeType: 'type', id: 'id', name: 'name', category: 'type', size: 'size' },
      nodesData: null,          // dataset id of the node table (one row per node); derived from edges when null
      layout: 'force',          // force (deterministic, solved before paint) | circular (hub centred) | physics (live ECharts force)
      highlight: null,          // node id(s) or name(s) drawn in accent2 (e.g. the target company)
      categoryColors: {},       // {category: colour or theme token}
      labels: 'auto',           // auto (largest nodes) | true | false
      labelTop: 10,             // with labels 'auto': label the N largest nodes (+ highlighted)
      nodeSize: [10, 46],       // symbol diameter range (sqrt scale on size)
      edgeWidth: [0.8, 5],      // edge width range (linear on value)
      edgeColor: 'auto',        // auto (colour of the non-highlighted end) | source | target | neutral
      edgeOpacity: 0.45,
      edgeCurve: 0.08,
      dashedTypes: [],          // edge types drawn dashed (e.g. ['Competition'])
      arrows: false,            // arrowheads at the target end
      force: {},                // layout 'physics' overrides: {repulsion, edgeLength, gravity, friction}
      roam: true,
      draggable: true,
      hideIsolated: true,       // with nodesData: drop nodes without edges under the current filters
      legend: true,
      format: null,             // edge value format (defaults to the value field's format)
      crossFilter: true,
      filterScope: 'dataset'
    },
    render: function (ctx) {
      var api = C(build, {
        on: {
          click: function (p, c) {
            if (p.dataType === 'node' && p.data && p.data.rkId != null) selectScoped(c, c.enc.source, p.data.rkId);
          }
        }
      })(ctx);
      return api;
    }
  });

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var m = model(ctx);
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var sizeFmt = (m.nodeDs && enc.size && m.nodeDs.field(enc.size) && m.nodeDs.field(enc.size).format) || fmt;
    var sizeTitle = (m.nodeDs && enc.size && m.nodeDs.field(enc.size) && m.nodeDs.field(enc.size).title) || 'Size';
    var hi = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    function isHi(n) { return hi.indexOf(n.id) >= 0 || hi.indexOf(n.name) >= 0; }

    // categories (legend) — a category made only of highlighted nodes takes accent2
    var cats = util.unique(m.nodes.map(function (n) { return n.category || 'Other'; }));
    var pal = distinctPalette(t.cat, hi.length ? t.accent2 : null);
    var pi = 0, catColor = {};
    cats.forEach(function (c) {
      var members = m.nodes.filter(function (n) { return (n.category || 'Other') === c; });
      var custom = tokenColor(t, (o.categoryColors || {})[c]);
      if (custom) catColor[c] = custom;
      else if (hi.length && members.length && members.every(isHi)) catColor[c] = t.accent2;
      else catColor[c] = pal[pi++ % pal.length];
    });
    function colorOf(n) { return isHi(n) ? t.accent2 : catColor[n.category || 'Other']; }

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
    // circular: categories around an ellipse, hub in the centre; physics: live ECharts force.
    var mode = o.layout === 'circular' ? 'circular' : (o.layout === 'physics' ? 'physics' : 'force');
    var W = ctx.el.clientWidth || 800, H = ctx.el.clientHeight || 420;
    var legendH = o.legend !== false && cats.length > 1 ? 30 : 6;
    var ordered = m.nodes.slice().sort(function (a, b) {
      return (cats.indexOf(a.category || 'Other') - cats.indexOf(b.category || 'Other')) || (b.size - a.size);
    });
    var idx = new Map(ordered.map(function (n, i) { return [n.id, i]; }));
    var his = ordered.filter(isHi);
    var hub = his.length === 1 && his[0].degree >= ordered.length / 3 ? idx.get(his[0].id) : -1;
    var sizesPx = ordered.map(symSize);
    if (mode === 'circular') {
      // ring slots are ~equal vertical steps: keep symbols smaller than a step
      var step = (H - legendH - 20) * 0.92 / Math.max(1, Math.ceil((ordered.length - (hub >= 0 ? 1 : 0)) / 2));
      sizesPx = sizesPx.map(function (d, i) { return i === hub ? d : Math.min(d, Math.max(8, step - 4)); });
    }
    var rMax = Math.max.apply(null, sizesPx.concat([10])) / 2;
    var labFont = '500 10.5px ' + t.fontSans, labW = 0;
    ordered.forEach(function (n) { if (labelled.has(n.id)) labW = Math.max(labW, Math.min(170, measure(n.name, labFont))); });
    var padX = 6 + (labW ? labW + 8 : 0);
    var rect = { x: padX, y: legendH + rMax + 4, w: Math.max(40, W - 2 * padX), h: Math.max(40, H - legendH - 2 * rMax - 10) };
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var px = null;
    if (mode === 'force') {
      var lay = springLayout(
        ordered.map(function (n, i) { return { r: (sizesPx[i] - o.nodeSize[0]) / Math.max(1, o.nodeSize[1]) * 0.8 }; }),
        m.edges.map(function (e) { return { s: idx.get(e.source), t: idx.get(e.target), w: e.value == null ? 1 : e.value }; }),
        hub);
      px = fitToRect(lay, sizesPx.map(function (d) { return d / 2; }), rect);
    } else if (mode === 'circular') {
      var ring = ordered.filter(function (n, i) { return i !== hub; });
      px = ordered.map(function () { return [cx, cy]; });
      // two arcs with equal vertical spacing (clockwise: right side top -> bottom, left side bottom -> top)
      // so horizontal labels never stack at the poles
      var nr = Math.ceil(ring.length / 2), nl = ring.length - nr;
      ring.forEach(function (n, k) {
        var right = k < nr, cnt = right ? nr : nl, j = right ? k : k - nr;
        var tt = right ? -0.92 + 1.84 * (j + 0.5) / cnt : 0.92 - 1.84 * (j + 0.5) / cnt;
        var xx = Math.sqrt(Math.max(0, 1 - tt * tt));
        px[idx.get(n.id)] = [cx + (right ? 1 : -1) * xx * rect.w / 2, cy + tt * rect.h / 2];
      });
    }
    var box = null;
    if (px) {
      var bx = util.extent(px.map(function (p) { return p[0]; })), by = util.extent(px.map(function (p) { return p[1]; }));
      box = { left: bx[0], top: by[0], width: Math.max(1, bx[1] - bx[0]), height: Math.max(1, by[1] - by[0]) };
    }

    var dash = [].concat(o.dashedTypes || []);
    var data = ordered.map(function (n, i) {
      var c = colorOf(n), dim = active && !active.has(n.id), big = labelled.has(n.id);
      var right = !px || px[i][0] >= cx - 1;
      var d = {
        id: n.id, name: n.name, rkId: n.id,
        category: cats.indexOf(n.category || 'Other'),
        value: n.size,
        symbolSize: sizesPx[i],
        itemStyle: { color: c, borderColor: t.paper, borderWidth: 1.2, opacity: dim ? 0.2 : 1 },
        label: {
          show: big,
          position: i === hub ? 'bottom' : (right ? 'right' : 'left'),
          fontWeight: isHi(n) ? 700 : 500,
          color: isHi(n) ? t.ink : t.ink2,
          opacity: dim ? 0.35 : 1
        }
      };
      if (px) { d.x = px[i][0]; d.y = px[i][1]; }
      return d;
    });
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
        curve = (dy * (cx - mx) - dx * (cy - my)) >= 0 ? 0.22 : -0.22;
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
      legend: C.legend(ctx, { show: o.legend !== false && cats.length > 1, data: cats, selectedMode: true }),
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
          var tr = [];
          if (nd.category) tr.push({ color: colorOf(nd), label: (m.nodeDs && m.nodeDs.field(enc.category) && m.nodeDs.field(enc.category).title) || 'Category', value: nd.category });
          tr.push({ label: sizeTitle, value: RK.format(nd.size, sizeFmt), bold: true });
          tr.push({ label: 'Connections', value: RK.format(nd.degree, '#,##0') });
          if (nd.weight) tr.push({ label: 'Linked ' + String(ctx.title(enc.value)).toLowerCase(), value: RK.format(nd.weight, fmt) });
          return C.tip(nd.name, tr);
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
        label: {
          position: 'right', distance: 4, fontSize: 10.5, fontFamily: t.fontSans, color: t.ink2,
          textBorderColor: t.paper, textBorderWidth: 2.5
        },
        labelLayout: { hideOverlap: true },
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
