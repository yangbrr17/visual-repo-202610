/*!
 * RK component: network — relationship map (customers / suppliers / competitors / partners around
 * a target, board interlocks, investor networks). Edges come from the bound dataset (source,
 * target, value, type); nodes from options.nodesData (id, name, category, size) or, when absent,
 * are derived from the edges. Force (deterministic seed) or circular layout, roam + drag.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  function tokenColor(t, v) {
    if (!v) return null;
    if (typeof t[v] === 'string' && t[v]) return t[v];
    var m = /^cat(\d+)$/.exec(v);
    if (m) return t.cat[(+m[1] - 1) % t.cat.length];
    return v;
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

  RK.component({
    id: 'network',
    deps: ['echarts'],
    defaults: {
      encode: { source: 'source', target: 'target', value: 'value', edgeType: 'type', id: 'id', name: 'name', category: 'type', size: 'size' },
      nodesData: null,          // dataset id of the node table (one row per node); derived from edges when null
      layout: 'force',          // force | circular
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
      force: {},                // overrides: {repulsion, edgeLength, gravity, friction}
      animateLayout: false,     // animate the force simulation (otherwise solved before first paint)
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
    var gold = RK.theme.parseColor(t.accent2);
    var pal = t.cat.filter(function (c) {
      var x = RK.theme.parseColor(c);
      return Math.sqrt(Math.pow(x[0] - gold[0], 2) + Math.pow(x[1] - gold[1], 2) + Math.pow(x[2] - gold[2], 2)) > 90;
    });
    if (!pal.length) pal = t.cat.slice();
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

    // deterministic seed: nodes on a circle grouped by category (largest first) -> stable force result
    var W = ctx.el.clientWidth || 800, H = ctx.el.clientHeight || 420;
    var legendH = o.legend !== false && cats.length > 1 ? 30 : 6;
    var ordered = m.nodes.slice().sort(function (a, b) {
      return (cats.indexOf(a.category || 'Other') - cats.indexOf(b.category || 'Other')) || (b.size - a.size);
    });
    var prev = {};
    try {
      var sm = inst && inst.getModel && inst.getModel() && inst.getModel().getSeriesByIndex(0);
      if (sm && sm.getGraph) sm.getGraph().eachNode(function (gn) { var l = gn.getLayout(); if (l) prev[gn.id] = l; });
    } catch (e) { /* first render */ }
    var rx = Math.min(W, H) * 0.32;
    var seed = {};
    ordered.forEach(function (n, i) {
      var a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, ordered.length);
      seed[n.id] = isHi(n) && hi.length === 1 ? [W / 2, (H + legendH) / 2] : [W / 2 + Math.cos(a) * rx * 1.4, (H + legendH) / 2 + Math.sin(a) * rx];
    });

    var dash = [].concat(o.dashedTypes || []);
    var data = ordered.map(function (n) {
      var c = colorOf(n), dim = active && !active.has(n.id), big = labelled.has(n.id);
      var p = prev[n.id] || seed[n.id];
      return {
        id: n.id, name: n.name, rkId: n.id,
        category: cats.indexOf(n.category || 'Other'),
        value: n.size,
        x: p[0], y: p[1],
        symbolSize: symSize(n),
        itemStyle: { color: c, borderColor: t.paper, borderWidth: 1.2, opacity: dim ? 0.2 : 1 },
        label: {
          show: big,
          fontWeight: isHi(n) ? 700 : 500,
          color: isHi(n) ? t.ink : t.ink2,
          opacity: dim ? 0.35 : 1
        }
      };
    });
    var links = m.edges.map(function (e) {
      var on = !active || sel.indexOf(e.source) >= 0 || sel.indexOf(e.target) >= 0;
      var a = m.byId.get(e.source), b = m.byId.get(e.target), col;
      if (o.edgeColor === 'neutral') col = t.neutral;
      else if (o.edgeColor === 'source') col = colorOf(a);
      else if (o.edgeColor === 'target') col = colorOf(b);
      else col = isHi(a) && !isHi(b) ? colorOf(b) : colorOf(a);   // auto: colour of the non-highlighted end
      return {
        source: e.source, target: e.target, value: e.value, rkType: e.type,
        lineStyle: {
          width: edgeW(e), color: col, curveness: o.layout === 'circular' ? 0.25 : o.edgeCurve,
          type: dash.indexOf(e.type) >= 0 ? [4, 3] : 'solid',
          opacity: active ? (on ? Math.min(0.9, o.edgeOpacity * 1.8) : 0.06) : o.edgeOpacity
        }
      };
    });

    var n = Math.max(1, m.nodes.length), area = Math.max(1, (W - 40) * (H - legendH - 20));
    var spacing = Math.sqrt(area / n);
    var force = util.merge({
      repulsion: Math.round(Math.max(60, Math.min(900, spacing * 4.2))),
      edgeLength: [Math.round(spacing * 0.5), Math.round(spacing * 1.25)],
      gravity: 0.08,
      friction: 0.6,
      layoutAnimation: !!(o.animateLayout && ctx.motion)
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
        layout: o.layout === 'circular' ? 'circular' : 'force',
        circular: { rotateLabel: true },
        force: force,
        top: legendH, left: 8, right: 8, bottom: 8,
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
