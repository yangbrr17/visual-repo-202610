/*!
 * RK component: tree — legal-entity / group structure chart from an (id, parent) table: entity
 * boxes (name, country) coloured by entity type, orthogonal connectors with the direct ownership %
 * on each drop, click a box to collapse / expand its subsidiaries, Ctrl/Cmd + wheel (or pinch) zoom + pan.
 * Layouts: top-down (TB), left-to-right (LR) or radial.
 *
 * Drawn as an ECharts graph with layout 'none': positions come from a tidy-tree layout computed
 * here in px (1:1 view), connectors are routed through invisible elbow nodes so they stay
 * orthogonal, and the ownership pills / "+n" badges are label-only nodes.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /** Label width via the shared canvas measure; +7% because the canvas may still measure a fallback face. */
  function measure(text, font) { return C.measure(text, font) * 1.07; }

  function tokenColor(t, v) {
    if (!v) return null;
    if (typeof t[v] === 'string' && t[v]) return t[v];
    var m = /^cat(\d+)$/.exec(v);
    if (m) return t.cat[(+m[1] - 1) % t.cat.length];
    return v;
  }

  /** Greedy word wrap into at most maxLines lines (last line ellipsised). */
  function wrap(text, font, maxW, maxLines) {
    var words = String(text == null ? '' : text).split(/\s+/).filter(Boolean), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var tryLine = cur ? cur + ' ' + words[i] : words[i];
      if (measure(tryLine, font) <= maxW || !cur) { cur = tryLine; continue; }
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines - 1) { cur = words.slice(i).join(' '); break; }
    }
    if (cur) lines.push(cur);
    lines = lines.slice(0, maxLines);
    var last = lines.length - 1;
    if (last >= 0 && measure(lines[last], font) > maxW) {
      var s = lines[last];
      while (s.length > 1 && measure(s + '…', font) > maxW) s = s.slice(0, -1);
      lines[last] = s.replace(/[\s,.;-]+$/, '') + '…';
    }
    return lines;
  }

  /** (id, parent) rows -> nodes with children, depth and effective ownership; cycles are cut. */
  function hierarchy(ctx) {
    var enc = ctx.enc, byId = new Map(), order = [];
    ctx.rows.forEach(function (r) {
      var id = r[enc.id];
      if (id == null || id === '' || byId.has(String(id))) return;
      var pct = enc.pct && util.isNum(r[enc.pct]) ? r[enc.pct] : null;
      var n = {
        id: String(id), parentId: r[enc.parent] == null || r[enc.parent] === '' ? null : String(r[enc.parent]),
        name: r[enc.name] != null ? String(r[enc.name]) : String(id),
        country: enc.country ? r[enc.country] : null,
        pct: pct, cat: enc.category && r[enc.category] != null ? String(r[enc.category]) : null,
        row: r, children: [], parent: null
      };
      byId.set(n.id, n);
      order.push(n);
    });
    var roots = [];
    order.forEach(function (n) {
      var p = n.parentId != null ? byId.get(n.parentId) : null;
      // guard against cycles: walking up from p must not reach n
      for (var q = p; q; q = q.parent) if (q === n) { p = null; break; }
      if (p) { n.parent = p; p.children.push(n); } else roots.push(n);
    });
    (function walk(list, depth, eff) {
      list.forEach(function (n) {
        n.depth = depth;
        n.eff = depth === 0 ? 1 : (eff == null || n.pct == null ? null : eff * n.pct);
        n.descendants = 0;
        walk(n.children, depth + 1, n.eff);
        n.children.forEach(function (c) { n.descendants += 1 + c.descendants; });
      });
    })(roots, 0, 1);
    return { roots: roots, byId: byId, list: order };
  }

  /**
   * Tidy tree (contour merging, Reingold–Tilford style): sibling subtrees are packed as close as
   * their contours allow at every depth, parents centred over their first / last child.
   * Writes n._x in "slot" units (box = 1, centre distance >= sep). shapeOf(n) may return a fixed
   * contour {l:[], r:[]} for a node whose children are drawn as a list block (not placed here).
   */
  function tidy(roots, kidsOf, sep, shapeOf) {
    var top = {};
    function children(n) { return n === top ? roots : kidsOf(n); }
    function rec(n) {
      var custom = n !== top && shapeOf ? shapeOf(n) : null;
      if (custom) return custom;
      var kids = children(n);
      if (!kids.length) return { l: [0], r: [0] };
      var shapes = kids.map(rec), offs = [0], L = shapes[0].l.slice(), R = shapes[0].r.slice();
      for (var i = 1; i < kids.length; i++) {
        var sh = shapes[i], need = -Infinity, d;
        for (d = 0; d < Math.min(R.length, sh.l.length); d++) need = Math.max(need, R[d] - sh.l[d] + sep);
        offs[i] = need;
        for (d = 0; d < sh.r.length; d++) {
          if (d < R.length) R[d] = sh.r[d] + need;
          else { R.push(sh.r[d] + need); L.push(sh.l[d] + need); }
        }
      }
      var mid = (offs[0] + offs[kids.length - 1]) / 2;
      kids.forEach(function (k, j) { k._rel = offs[j] - mid; });
      return { l: [0].concat(L.map(function (v) { return v - mid; })), r: [0].concat(R.map(function (v) { return v - mid; })) };
    }
    rec(top);
    (function place(list, x) {
      list.forEach(function (n) { n._x = x + n._rel; if (!(shapeOf && shapeOf(n))) place(kidsOf(n), n._x); });
    })(roots, 0);
  }

  /** Leaf-slot layout (no contour packing): every leaf owns a slot, parents sit mid-way. Radial uses it. */
  function leafSlots(roots, kidsOf) {
    var i = 0;
    (function rec(list) {
      list.forEach(function (n) {
        var ks = kidsOf(n);
        if (!ks.length) { n._x = i++; return; }
        rec(ks);
        n._x = (ks[0]._x + ks[ks.length - 1]._x) / 2;
      });
    })(roots);
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
        } }, (/Mac|iP/.test(navigator.platform) ? '\u2318' : 'Ctrl') + ' + scroll to zoom \u00b7 drag to pan');
        root.appendChild(hint);
      }
      hint.style.opacity = '1';
      clearTimeout(timer);
      timer = setTimeout(function () { hint.style.opacity = '0'; }, 1400);
    }
    root.addEventListener('wheel', onWheel, true);
    root.addEventListener('mousewheel', onWheel, true);
  }

  RK.component({
    id: 'tree',
    deps: ['echarts'],
    defaults: {
      encode: { id: 'id', parent: 'parent', name: 'name', country: 'country', pct: 'ownership_pct', category: 'entity_type' },
      layout: 'orthogonal',     // orthogonal | radial
      orient: 'TB',             // TB (top-down) | LR (left-to-right) — orthogonal layout only
      pctLabels: 'all',         // all | partial (only < 100%) | false
      dashMinority: true,       // dashed connector below 50% ownership
      initialDepth: null,       // collapse entities at this depth and deeper on first render (null = all open)
      collapsible: true,
      highlight: null,          // entity id(s) or name(s) ringed in accent2 (box keeps its category colour; legend 'Highlighted')
      balance: true,            // centre subtrees with children among their siblings (parents sit over the middle)
      categoryColors: {},       // {entity type: colour or theme token}
      rootFilled: true,         // ultimate parent(s) drawn as a solid box
      boxWidth: null,           // px; null = fit to the container (96–196, names wrap to 2–3 lines at 11px, never below 96)
      roam: true,
      wheelZoom: null,          // true: plain wheel zooms (default: Ctrl/Cmd + wheel or pinch; plain wheel scrolls the page)
      legend: true,
      format: null              // ownership format; defaults to the pct field format
    },
    render: function (ctx) {
      var state = { collapsed: null }, current = ctx;
      var api = C(function (c, inst) { return build(c, inst, state); }, {
        rebuildOnResize: true,     // layout is computed in px from the container size
        init: wheelGuard,
        on: {
          click: function (p, c) {
            var id = p.data && p.data.rkFor;
            if (id == null || c.options.collapsible === false) return;
            var n = state.model && state.model.byId.get(id);
            if (!n || !n.children.length) return;
            if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
            up(current);
          }
        }
      })(ctx);
      // collapse / expand re-applies the latest ctx (filters may have changed since mount)
      var up = api.update;
      api.update = function (c) { current = c; up(c); };
      return api;
    }
  });

  /* ---- label placement (radial view): first free position around a dot ---- */
  var LABEL_DIST = 5;
  function labelBox(key, x, y, r, w, h) {
    var d = LABEL_DIST, q = r * 0.72 + 2;
    switch (key) {
      case 'right': return { x0: x + r + d, y0: y - h / 2, x1: x + r + d + w, y1: y + h / 2 };
      case 'left': return { x0: x - r - d - w, y0: y - h / 2, x1: x - r - d, y1: y + h / 2 };
      case 'top': return { x0: x - w / 2, y0: y - r - d - h, x1: x + w / 2, y1: y - r - d };
      case 'bottom': return { x0: x - w / 2, y0: y + r + d, x1: x + w / 2, y1: y + r + d + h };
      case 'tr': return { x0: x + q, y0: y - q - h, x1: x + q + w, y1: y - q };
      case 'br': return { x0: x + q, y0: y + q, x1: x + q + w, y1: y + q + h };
      case 'tl': return { x0: x - q - w, y0: y - q - h, x1: x - q, y1: y - q };
      default: return { x0: x - q - w, y0: y + q, x1: x - q, y1: y + q + h };   // bl
    }
  }
  function labelPos(key, r) {
    if (key === 'right' || key === 'left' || key === 'top' || key === 'bottom') return { position: key, distance: LABEL_DIST };
    var q = r * 0.72 + 2, right = key === 'tr' || key === 'br', topSide = key === 'tr' || key === 'tl';
    return { position: [r + (right ? q : -q), r + (topSide ? -q : q)], align: right ? 'left' : 'right', verticalAlign: topSide ? 'bottom' : 'top' };
  }
  function overlap(a, b, pad) { return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad; }

  /** Greedy wrap without ellipsis; null when a line would still be wider than maxW or more than maxLines are needed. */
  function wrapFit(text, font, maxW, maxLines) {
    var words = String(text == null ? '' : text).split(/\s+/).filter(Boolean), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var next = cur ? cur + ' ' + words[i] : words[i];
      if (measure(next, font) <= maxW || !cur) cur = next;
      else { lines.push(cur); cur = words[i]; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines || lines.some(function (l) { return measure(l, font) > maxW; })) return null;
    return lines;
  }

  function build(ctx, inst, state) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var model = state.model = hierarchy(ctx);
    if (!state.collapsed) {
      state.collapsed = new Set();
      if (o.initialDepth != null) model.list.forEach(function (n) { if (n.depth >= o.initialDepth && n.children.length) state.collapsed.add(n.id); });
    }
    var collapsed = state.collapsed;
    var pfmt = o.format || ctx.fmtOf(enc.pct) || '0%';
    var hi = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    function isHi(n) { return hi.indexOf(n.id) >= 0 || hi.indexOf(n.name) >= 0; }

    // categories -> colours (legend is a key only: hiding a type would orphan connectors). The highlight
    // is an accent2 ring around the entity, so its box keeps its category colour (legend stays true)
    var cats = util.unique(model.list.map(function (n) { return n.cat || 'Entity'; }));
    var pal = RK.theme.palette({ n: cats.length }), catColor = {};   // categorical, kept clear of accent2 (the highlight)
    cats.forEach(function (c, i) { catColor[c] = tokenColor(t, (o.categoryColors || {})[c]) || pal[i]; });
    /** Box outline in the category colour, lifted towards ink where it would fade into the paper (dark themes). */
    function strokeOf(c) {
      var s = c;
      for (var k = 0.2; k <= 0.81 && RK.theme.contrast(s, t.paper) < 3; k += 0.15) s = RK.theme.mix(c, t.ink, k);
      return s;
    }

    // balanced sibling order (options.balance): subtrees with visible children go to the middle of their
    // siblings, leaves keep their data order around them, so parents sit over the centre of the drawing
    function visKids(n) { return collapsed.has(n.id) ? [] : n.children; }
    var flips = new Set(), order = new Map();
    function arrange(n) {
      var ks = visKids(n);
      if (o.balance === false || ks.length < 2) return ks;
      var heavy = ks.filter(function (k) { return visKids(k).length; });
      if (!heavy.length || heavy.length === ks.length) return ks;
      heavy.sort(function (a, b) { return (b.descendants - a.descendants) || (ks.indexOf(a) - ks.indexOf(b)); });
      var m = ks.length, c0 = flips.has(n.id) ? Math.ceil((m - 1) / 2) : Math.floor((m - 1) / 2), seq = [c0];
      for (var step = 1; seq.length < m; step++) {
        if (c0 + step < m) seq.push(c0 + step);
        if (c0 - step >= 0 && seq.length < m) seq.push(c0 - step);
      }
      var out = new Array(m);
      heavy.forEach(function (k, i) { out[seq[i]] = k; });
      var light = ks.filter(function (k) { return heavy.indexOf(k) < 0; }), li = 0;
      for (var j = 0; j < m; j++) if (!out[j]) out[j] = light[li++];
      return out;
    }
    function kids(n) { var a = order.get(n.id); if (!a) { a = arrange(n); order.set(n.id, a); } return a; }

    var visible = [];
    (function walk(list) { list.forEach(function (n) { visible.push(n); walk(visKids(n)); }); })(model.roots);
    var maxDepth = visible.reduce(function (m, n) { return Math.max(m, n.depth); }, 0);

    var W = ctx.el.clientWidth || 900, H = ctx.el.clientHeight || 420;
    var hasHi = visible.some(isHi);
    var legendCats = cats.concat(hasHi ? ['Highlighted'] : []);
    var showLegend = o.legend !== false && (cats.length > 1 || hasHi);
    // plain legend wraps onto more rows instead of paging: reserve the rows it needs
    var legRows = 1, legX = 0;
    if (showLegend) legendCats.forEach(function (c) {
      var iw = 10 + 5 + measure(c, '11px ' + t.fontSans) + 14;
      if (legX && legX + iw > W - 10) { legRows++; legX = 0; }
      legX += iw;
    });
    var legendH = showLegend ? 30 + (legRows - 1) * 20 : 4;
    var radial = o.layout === 'radial', lr = !radial && o.orient === 'LR';
    var FS = 11, LH = 14, nameFont = '600 ' + FS + 'px ' + t.fontSans, pillFont = '500 10px ' + t.fontNum;
    var nodes = [], links = [], pad = 10;
    function pctText(n) {
      if (o.pctLabels === false || n.pct == null || n.depth === 0) return null;
      if (o.pctLabels === 'partial' && n.pct >= 0.9999) return null;
      return RK.format(n.pct, pfmt);
    }
    function pill(id, x, y, text, forId, strong) {
      nodes.push({
        id: id, name: id, x: x, y: y, symbolSize: 0, rkFor: forId, rkDummy: true,
        label: {
          show: true, position: 'inside', formatter: C.richSafe(text), fontSize: 10, fontFamily: t.fontNum, fontWeight: strong ? 600 : 500,
          color: strong ? t.ink : t.ink2, backgroundColor: t.paper, borderColor: strong ? t.rule : 'transparent', borderWidth: strong ? 1 : 0,
          borderRadius: 7, padding: [1, 4]
        },
        emphasis: { disabled: true }, tooltip: { show: false }
      });
    }
    function pillW(text) { return measure(text, '600 10px ' + t.fontNum) + 10; }
    function point(id) { nodes.push({ id: id, name: id, x: 0, y: 0, symbolSize: 0, rkDummy: true, label: { show: false }, emphasis: { disabled: true }, tooltip: { show: false } }); return nodes[nodes.length - 1]; }
    function link(a, b, n, dashed) {
      links.push({ source: a, target: b, lineStyle: { color: t.axis, width: 1, curveness: 0, type: dashed ? [4, 3] : 'solid' }, emphasis: { disabled: true } });
    }
    /** Filled layer under a box / dot: outlines are drawn as stacked fills because ECharts scales the
     *  stroke of a non-square 'rect' symbol unevenly (thick sides, thin top / bottom). */
    function layer(id, x, y, symbol, size, color, cat) {
      nodes.push({
        id: id, name: id, x: x, y: y, symbol: symbol, symbolSize: size, rkDummy: true, rkLayer: true,
        category: cat, itemStyle: { color: color, borderWidth: 0 },
        label: { show: false }, emphasis: { disabled: true }, tooltip: { show: false }, silent: true
      });
    }
    /** accent2 ring just outside a highlighted entity: the box keeps its category fill and outline. */
    function halo(n, x, y, size, symbol) {
      var grow = function (d) { return Array.isArray(size) ? [size[0] + d, size[1] + d] : size + d; };
      layer('hi:' + n.id, x, y, symbol, grow(10), t.accent2, legendCats.indexOf('Highlighted'));
      layer('hi2:' + n.id, x, y, symbol, grow(5), t.paper);
    }
    function boxStyle(n) {
      var c = catColor[n.cat || 'Entity'], filled = o.rootFilled && n.depth === 0;
      var fill = filled ? c : RK.theme.mix(c, t.paper, 0.9);
      var on = filled ? RK.theme.textOn(fill) : t.ink;   // readable on the fill in light and dark themes
      return { fill: fill, text: on, sub: filled ? RK.theme.alpha(on, 0.78) : t.ink3, border: filled ? c : strokeOf(c), bw: filled ? 0 : 1.2 };
    }
    var hasCountry = enc.country && visible.some(function (n) { return n.country != null && n.country !== ''; });
    /** Width that fits a name on `lines` lines without an ellipsis. */
    var needCache = new Map();
    function needW(name, lines) {
      var k = name + '\u0001' + lines;
      if (!needCache.has(k)) {
        var w = 60;
        while (w < 260 && !wrapFit(name, nameFont, w, lines)) w += 4;
        needCache.set(k, w);
      }
      return needCache.get(k);
    }

    var best = null;
    if (!radial) {
      // ---- orthogonal (TB / LR) ------------------------------------------------------------
      // Every candidate arrangement is laid out in px and the one that needs the least shrinking wins:
      // TB plain; TB with wide leaf groups drawn as a compact list (k columns, spine + stubs, ownership on
      // the country line) when the block is too narrow for a single row of boxes; LR plain.
      var sep = lr ? 1.28 : 1.14;
      var availW = W - 2 * pad, availH = H - legendH - 2 * pad;
      var wantW = Math.min(196, visible.reduce(function (m, n) { return Math.max(m, needW(n.name, 2)); }, 60) + 16);
      var leafGroups = visible.filter(function (n) {
        var ks = visKids(n);
        return ks.length >= 3 && ks.every(function (k) { return !visKids(k).length; });
      });
      var candidates = lr ? [0] : [0, 4, 3, 2].filter(function (k) { return !k || leafGroups.some(function (g) { return visKids(g).length > k; }); });
      // balance search: try flipping the centre slot of nodes with an even number of children
      var flipNodes = visible.filter(function (n) { var ks = visKids(n); return ks.length >= 2 && ks.length % 2 === 0 && ks.some(function (k) { return visKids(k).length; }); }).slice(0, 5);

      var attempt = function (listK) {
        nodes = []; links = [];
        var listOf = new Map();
        if (listK) leafGroups.forEach(function (g) { if (visKids(g).length > listK) listOf.set(g.id, listK); });
        // list children are positioned from their parent (not by the tidy layout)
        visible.forEach(function (n) { n._inList = !!(n.parent && listOf.has(n.parent.id)); });
        var STUB = 14, CG = 12, LG = 8, BUS = 14;
        var boxW = o.boxWidth || wantW, boxH, rowStep, gap, lines = new Map();
        var shapeOf = function (n) {
          var k = listOf.get(n.id);
          if (!k) return null;
          var m = visKids(n).length, rowsK = Math.ceil(m / k), totalW = k * (STUB + boxW) + (k - 1) * CG;
          var extra = Math.max(1, Math.ceil(((rowsK - 1) * (boxH + LG) + boxH) / rowStep));
          var l = [0], r = [0];
          for (var d = 0; d < extra; d++) { l.push(-totalW / 2 / boxW + 0.5); r.push(totalW / 2 / boxW - 0.5); }
          return { l: l, r: r };
        };
        var layoutOnce = function () {
          var ml = 1;
          visible.forEach(function (n) {
            var ls = wrapFit(n.name, nameFont, boxW - 14, 2) || wrapFit(n.name, nameFont, boxW - 14, 3) || wrap(n.name, nameFont, boxW - 14, 3);
            lines.set(n.id, ls);
            ml = Math.max(ml, ls.length);
          });
          var sub = hasCountry || (listOf.size && o.pctLabels !== false);
          boxH = 10 + ml * LH + (sub ? 13 : 0) + 8;
          rowStep = boxH + 40;
          order.clear();
          tidy(model.roots, kids, sep, lr ? null : shapeOf);
        };
        var bestFlip = null;
        var combos = Math.pow(2, flipNodes.length);
        // widths depend on the arrangement: settle boxW over a few passes
        for (var pass = 0; pass < 3; pass++) {
          bestFlip = null;
          for (var cmb = 0; cmb < combos; cmb++) {
            flips.clear();
            flipNodes.forEach(function (n, i) { if (cmb & (1 << i)) flips.add(n.id); });
            layoutOnce();
            var xs0 = util.extent(visible.filter(function (n) { return !n._inList; }).map(function (n) { return n._x; }));
            var ext0 = [xs0[0], xs0[1]];
            listOf.forEach(function (k, id) {
              var g = model.byId.get(id), sh = shapeOf(g);
              ext0[0] = Math.min(ext0[0], g._x + sh.l[1]); ext0[1] = Math.max(ext0[1], g._x + sh.r[1]);
            });
            var root = model.roots[0], off = root ? Math.abs(root._x - (ext0[0] + ext0[1]) / 2) : 0;
            if (!bestFlip || off < bestFlip.off - 1e-6) bestFlip = { cmb: cmb, off: off, span: ext0[1] - ext0[0] + 1 };
          }
          flips.clear();
          flipNodes.forEach(function (n, i) { if (bestFlip.cmb & (1 << i)) flips.add(n.id); });
          if (o.boxWidth || lr) break;
          var fitW = util.clamp(availW / bestFlip.span, 96, wantW);
          if (Math.abs(fitW - boxW) < 2) break;
          boxW = fitW;
        }
        if (lr && !o.boxWidth) boxW = util.clamp((availW - 28 - maxDepth * 56) / (maxDepth + 1), 120, 200);
        layoutOnce();

        var xs = util.extent(visible.filter(function (n) { return !n._inList; }).map(function (n) { return n._x; }));
        var rows = maxDepth + 1, slotPx, x0, y0;
        var half;
        if (!lr) {
          slotPx = boxW;
          // gap between depth rows: as roomy as the height allows (34-72px), list blocks included
          var listDepth = function (g) { var rk = Math.ceil(visKids(g).length / listOf.get(g.id)); return { d: g.depth, extra: boxH + BUS + 10 + (rk - 1) * (boxH + LG) }; };
          var heightFor = function (gp) {
            var hgt = (visible.reduce(function (m, n) { return n._inList ? m : Math.max(m, n.depth); }, 0)) * (boxH + gp) + boxH;
            listOf.forEach(function (k, id) { var ld = listDepth(model.byId.get(id)); hgt = Math.max(hgt, ld.d * (boxH + gp) + boxH + ld.extra); });
            return hgt;
          };
          gap = 72;
          while (gap > 30 && heightFor(gap) > availH) gap -= 2;
          rowStep = boxH + gap;
          x0 = (W - (xs[1] - xs[0] + 1) * slotPx) / 2 + slotPx / 2 - xs[0] * slotPx;
          y0 = legendH + pad + boxH / 2;
          half = boxH / 2;
        } else {
          slotPx = boxH;
          var badge = collapsed.size ? 34 : 0;
          gap = util.clamp((W - 2 * pad - badge - rows * boxW) / Math.max(1, rows - 1), 40, 96);
          rowStep = boxW + gap;
          x0 = Math.max(pad, (W - badge - rows * boxW - (rows - 1) * gap) / 2) + boxW / 2;
          y0 = legendH + Math.max(pad, (H - legendH - (xs[1] - xs[0] + 1) * slotPx) / 2) + slotPx / 2 - xs[0] * slotPx;
          half = boxW / 2;
        }
        var pos = function (n) {
          var cross = n._x * slotPx, main = n.depth * rowStep;
          return lr ? [x0 + main, y0 + cross] : [x0 + cross, y0 + main];
        };
        visible.forEach(function (n) { if (!n._inList) n._p = pos(n); });
        // list blocks: k columns, row-major; each column hangs off its own spine
        listOf.forEach(function (k, id) {
          var g = model.byId.get(id), ks = visKids(g), totalW = k * (STUB + boxW) + (k - 1) * CG;
          var left = g._p[0] - totalW / 2, busY = g._p[1] + boxH / 2 + BUS;
          ks.forEach(function (c, i) {
            var col = i % k, row = Math.floor(i / k);
            var spineX = left + col * (STUB + boxW + CG);
            c._p = [spineX + STUB + boxW / 2, busY + 10 + boxH / 2 + row * (boxH + LG)];
            c._spine = spineX;
          });
        });

        visible.forEach(function (n) {
          var p = n._p, st = boxStyle(n), ls = lines.get(n.id);
          var subTxt = hasCountry && n.country ? String(n.country) : '';
          if (n._inList) { var pt = pctText(n); if (pt) subTxt = subTxt ? subTxt + '  ·  ' + pt : pt; }
          if (isHi(n)) halo(n, p[0], p[1], [boxW, boxH], 'rect');
          if (st.bw) layer('bd:' + n.id, p[0], p[1], 'rect', [boxW, boxH], st.border);
          nodes.push({
            id: 'n:' + n.id, name: n.name, rkFor: n.id, x: p[0], y: p[1],
            symbol: 'rect', symbolSize: [boxW - 2 * st.bw, boxH - 2 * st.bw], category: cats.indexOf(n.cat || 'Entity'),
            itemStyle: { color: st.fill, borderWidth: 0 },
            label: {
              show: true, position: 'inside', align: 'center', verticalAlign: 'middle',
              formatter: ls.map(function (l) { return '{n|' + C.richSafe(l) + '}'; }).join('\n') + (subTxt ? '\n{c|' + C.richSafe(subTxt) + '}' : ''),
              rich: {
                n: { fontSize: FS, fontWeight: 600, color: st.text, lineHeight: LH, fontFamily: t.fontSans, align: 'center' },
                c: { fontSize: 10, color: st.sub, lineHeight: 13, fontFamily: t.fontSans, align: 'center' }
              }
            },
            cursor: n.children.length && o.collapsible !== false ? 'pointer' : 'default'
          });
        });
        // connectors: parent -> bus point -> knee above / left of each child -> child
        visible.forEach(function (n) {
          var ks = kids(n);
          if (ks.length && listOf.has(n.id) && !lr) {
            var bY = n._p[1] + boxH / 2 + BUS, busC = point('bus:' + n.id);
            busC.x = n._p[0]; busC.y = bY;
            link('n:' + n.id, busC.id, n, false);
            var cols = new Map();
            visKids(n).forEach(function (c) { if (!cols.has(c._spine)) cols.set(c._spine, []); cols.get(c._spine).push(c); });
            var ci = 0;
            cols.forEach(function (list, sx) {
              var top = point('spine:' + n.id + ':' + ci);
              top.x = sx; top.y = bY;
              link(busC.id, top.id, n, false);
              var prev = top.id;
              list.forEach(function (c) {
                var knee = point('knee:' + c.id);
                knee.x = sx; knee.y = c._p[1];
                link(prev, knee.id, c, false);
                link(knee.id, 'n:' + c.id, c, o.dashMinority && c.pct != null && c.pct < 0.5);
                prev = knee.id;
              });
              ci++;
            });
          } else if (ks.length) {
            var busMain = (lr ? n._p[0] : n._p[1]) + half + gap * 0.42;
            var bus = point('bus:' + n.id);
            bus.x = lr ? busMain : n._p[0];
            bus.y = lr ? n._p[1] : busMain;
            link('n:' + n.id, bus.id, n, false);
            ks.forEach(function (k) {
              var knee = point('knee:' + k.id);
              knee.x = lr ? busMain : k._p[0];
              knee.y = lr ? k._p[1] : busMain;
              var dashed = o.dashMinority && k.pct != null && k.pct < 0.5;
              link(bus.id, knee.id, k, false);
              link(knee.id, 'n:' + k.id, k, dashed);
              var txt = pctText(k);
              if (txt) {
                var childEdge = (lr ? k._p[0] : k._p[1]) - half;
                var mid = (busMain + childEdge) / 2;
                pill('pct:' + k.id, lr ? mid : k._p[0], lr ? k._p[1] : mid, txt, null, false);
              }
            });
          }
          if (collapsed.has(n.id) && n.children.length) {
            // "+n" badge just outside the box edge (never on the border)
            var bt = '+' + n.descendants, off = half + 5 + pillW(bt) / 2 + (isHi(n) ? 5 : 0);
            if (!lr) off = half + 5 + 8 + (isHi(n) ? 5 : 0);
            pill('more:' + n.id, lr ? n._p[0] + off : n._p[0], lr ? n._p[1] : n._p[1] + off, bt, n.id, true);
          }
        });
        // extents (boxes, pills) -> how much this candidate must shrink to fit the block
        var ext = [Infinity, Infinity, -Infinity, -Infinity];
        nodes.forEach(function (d) {
          var sz = Array.isArray(d.symbolSize) ? d.symbolSize : [d.symbolSize || 0, d.symbolSize || 0];
          var lw = d.label && d.label.show && d.rkDummy ? 18 : 0;
          ext[0] = Math.min(ext[0], d.x - sz[0] / 2 - lw); ext[1] = Math.min(ext[1], d.y - sz[1] / 2 - 8);
          ext[2] = Math.max(ext[2], d.x + sz[0] / 2 + lw); ext[3] = Math.max(ext[3], d.y + sz[1] / 2 + 8);
        });
        var fit = Math.min(1, availW / Math.max(1, ext[2] - ext[0]), (H - legendH - pad) / Math.max(1, ext[3] - ext[1]));
        return { nodes: nodes, links: links, ext: ext, fit: fit, listK: listK };
      };
      candidates.forEach(function (k) {
        var a = attempt(k);
        // plain layout wins ties; a list layout must read clearly larger to be chosen
        if (a && (!best || a.fit > best.fit + 0.06)) best = a;
      });
      nodes = best.nodes; links = best.links;
    } else {
      // ---- radial ----------------------------------------------------------------------------
      // Leaves on the outer ring (one slot each; steps halfway between equal angles and equal heights so
      // labels near the poles get room), internal entities on inner rings, the root in the centre.
      // Links are dendrogram elbows (radial -> arc on a ring just outside the parent -> radial): a
      // subtree owns a contiguous sector, so links never sweep across other branches.
      leafSlots(model.roots, visKids);
      var leafSpan = util.extent(visible.map(function (n) { return n._x; }));
      var span = leafSpan[1] - leafSpan[0] + 1;
      var labFont = '500 ' + FS + 'px ' + t.fontSans, boldFont = '700 ' + FS + 'px ' + t.fontSans;
      var labCap = util.clamp(W * 0.2, 96, 230);   // one line when there is room, two lines (never cut) when narrow
      var labLines = new Map(), labW = 0;
      visible.forEach(function (n) {
        var f = n.depth === 0 || isHi(n) ? boldFont : labFont;
        var ls = wrapFit(n.name, f, labCap, 1) || wrapFit(n.name, f, labCap, 2) || wrap(n.name, f, labCap, 2);
        labLines.set(n.id, ls);
        if (!visKids(n).length) labW = Math.max(labW, ls.reduce(function (m, l) { return Math.max(m, measure(l, f)); }, 0));
      });
      var cxr = W / 2, cyr = legendH + (H - legendH) / 2;
      var ry = Math.max(50, (H - legendH) / 2 - 24), rx = Math.max(60, Math.min(W / 2 - labW - 16, ry * 1.6));
      var single = model.roots.length === 1 && !collapsed.has(model.roots[0].id);
      var levels = single ? Math.max(1, maxDepth) : maxDepth + 1;
      var angleOf = function (u) {        // u: 0..1 clockwise from 12 o'clock
        var right = u < 0.5, tt = right ? u * 2 : (u - 0.5) * 2;
        var yy = (-Math.cos(Math.PI * tt) + (2 * tt - 1)) / 2;
        return (right ? 0 : Math.PI) + Math.acos(util.clamp(-yy, -1, 1));
      };
      var polar = function (a, f) { return [cxr + Math.sin(a) * rx * f, cyr - Math.cos(a) * ry * f]; };
      // angles: leaves from their slot, parents at the middle of their children
      (function setAngles(list) {
        list.forEach(function (n) {
          var ks = visKids(n);
          setAngles(ks);
          if (!ks.length) n._a = angleOf((n._x - leafSpan[0] + 0.5) / span);
          else n._a = (ks[0]._a + ks[ks.length - 1]._a) / 2;
        });
      })(model.roots);
      visible.forEach(function (n) {
        var f = visKids(n).length || (single && n.depth === 0) ? (single ? n.depth : n.depth + 1) / levels : 1;
        n._f = f;
        n._p = polar(n._a, f);
      });
      var dots = [], labelled = [];
      visible.forEach(function (n) {
        var c = catColor[n.cat || 'Entity'], center = n.depth === 0 && single;
        var size = center ? 18 : (n.children.length ? 12 : 9);
        if (isHi(n)) halo(n, n._p[0], n._p[1], size, 'circle');
        nodes.push({
          id: 'n:' + n.id, name: n.name, rkFor: n.id, x: n._p[0], y: n._p[1],
          symbol: 'circle', symbolSize: size, category: cats.indexOf(n.cat || 'Entity'),
          itemStyle: { color: c, borderColor: t.paper, borderWidth: 1 },
          label: { show: true },
          cursor: n.children.length && o.collapsible !== false ? 'pointer' : 'default'
        });
        dots.push({ n: n, d: nodes[nodes.length - 1], r: size / 2 + (isHi(n) ? 5 : 0) });
        // elbow link: parent -> its bus ring -> along the ring to the child's angle -> child
        if (n.parent && !collapsed.has(n.parent.id)) {
          var pr = n.parent, fb = pr._f + (single || pr.depth > 0 ? 0.5 / levels : 0.5 / levels);
          if (fb > n._f) fb = (pr._f + n._f) / 2;
          var dashed = o.dashMinority && n.pct != null && n.pct < 0.5;
          var prevId = 'n:' + pr.id, seq = 0;
          var hop = function (p) { var d = point('rc:' + n.id + ':' + (seq++)); d.x = p[0]; d.y = p[1]; link(prevId, d.id, null, false); prevId = d.id; };
          hop(polar(pr._a, fb));
          var da = n._a - pr._a, steps = Math.max(1, Math.ceil(Math.abs(da) / 0.06));
          for (var si = 1; si <= steps; si++) hop(polar(pr._a + da * si / steps, fb));
          link(prevId, 'n:' + n.id, null, dashed);
          var txt = pctText(n);
          if (txt) { var pp = polar(n._a, (fb + n._f) / 2); pill('pct:' + n.id, pp[0], pp[1], txt, null, false); }
        }
        if (collapsed.has(n.id) && n.children.length) {
          var bp = polar(n._a, n._f + 0.14);
          pill('more:' + n.id, bp[0], bp[1], '+' + n.descendants, n.id, true);
        }
      });
      // labels: leaves outward (left / right of the dot), internal entities and the root on a paper chip
      // at the first free position; placed in order root -> internal -> leaves
      var obstacles = dots.map(function (x) { return { x0: x.n._p[0] - x.r, x1: x.n._p[0] + x.r, y0: x.n._p[1] - x.r, y1: x.n._p[1] + x.r, id: x.n.id }; });
      nodes.forEach(function (d) { if (d.rkDummy && d.label && d.label.show) obstacles.push({ x0: d.x - 14, x1: d.x + 14, y0: d.y - 8, y1: d.y + 8, id: d.id }); });
      var placed = [];
      dots.slice().sort(function (a, b) { return (a.n.depth - b.n.depth) || (visKids(b.n).length - visKids(a.n).length); }).forEach(function (x) {
        var n = x.n, ls = labLines.get(n.id), f = n.depth === 0 || isHi(n) ? boldFont : labFont, leaf = !visKids(n).length;
        var w = ls.reduce(function (m, l) { return Math.max(m, measure(l, f)); }, 0) + (leaf ? 0 : 6), hgt = ls.length * LH + (leaf ? 0 : 2);
        var right = Math.sin(n._a) >= -1e-6, up = Math.cos(n._a) > 0;
        var keys = n.depth === 0 && single ? ['bottom', 'top', 'right', 'left', 'br', 'bl']
          : leaf ? (right ? ['right', up ? 'tr' : 'br', up ? 'top' : 'bottom'] : ['left', up ? 'tl' : 'bl', up ? 'top' : 'bottom'])
          : ['bottom', 'top', right ? 'right' : 'left', right ? 'br' : 'bl', right ? 'tr' : 'tl', right ? 'left' : 'right'];
        var pick = null;
        for (var i = 0; i < keys.length && !pick; i++) {
          var b = labelBox(keys[i], n._p[0], n._p[1], x.r, w, hgt);
          if (b.x0 < 1 || b.x1 > W - 1 || b.y0 < legendH - 4 || b.y1 > H - 1) continue;
          if (obstacles.some(function (ob) { return ob.id !== n.id && overlap(b, ob, 2); })) continue;
          if (placed.some(function (pb) { return overlap(b, pb, 2); })) continue;
          pick = keys[i]; placed.push(b);
        }
        if (!pick) { pick = keys[0]; placed.push(labelBox(pick, n._p[0], n._p[1], x.r, w, hgt)); }   // never hide an entity name
        x.d.label = util.merge({
          show: true,
          formatter: ls.map(function (l) { return C.richSafe(l); }).join('\n'),
          fontSize: FS, lineHeight: LH, fontFamily: t.fontSans, fontWeight: n.depth === 0 || isHi(n) ? 700 : (leaf ? 500 : 600),
          color: leaf ? t.ink2 : t.ink,
          align: undefined
        }, labelPos(pick, x.r), leaf ? { textBorderColor: t.paper, textBorderWidth: 2 } : { backgroundColor: RK.theme.alpha(t.paper, 0.9), padding: [1, 3], borderRadius: 2 });
        if (leaf && (pick === 'left' || pick === 'right')) x.d.label.align = pick === 'left' ? 'right' : 'left';
      });
    }

    // zoom-to-fit: when the drawing (incl. box extents) is larger than the block, scale positions,
    // boxes and fonts together (floor 55%; beyond that the user pans / zooms)
    if (!radial && best && best.fit < 0.999) {
      var ext = best.ext, fit = Math.max(0.55, best.fit);
      var aW = W - 2 * pad, aH = H - legendH - pad;
      var ox = pad + Math.max(0, (aW - (ext[2] - ext[0]) * fit) / 2), oy = legendH + Math.max(0, (aH - (ext[3] - ext[1]) * fit) / 2);
      var scaleRich = function (r) {
        Object.keys(r || {}).forEach(function (k) { if (r[k].fontSize) r[k].fontSize *= fit; if (r[k].lineHeight) r[k].lineHeight *= fit; });
      };
      nodes.forEach(function (d) {
        d.x = ox + (d.x - ext[0]) * fit;
        d.y = oy + (d.y - ext[1]) * fit;
        if (Array.isArray(d.symbolSize)) d.symbolSize = [d.symbolSize[0] * fit, d.symbolSize[1] * fit];
        else if (d.symbolSize) d.symbolSize *= fit;
        if (d.label) {
          if (d.label.fontSize) d.label.fontSize = Math.max(7.5, d.label.fontSize * fit);
          scaleRich(d.label.rich);
        }
      });
    }

    // 1:1 view: series box = bounding box of the (px) node positions
    var bx = util.extent(nodes.map(function (d) { return d.x; })), by = util.extent(nodes.map(function (d) { return d.y; }));
    var box = { left: bx[0], top: by[0], width: Math.max(1, bx[1] - bx[0]), height: Math.max(1, by[1] - by[0]) };
    var catList = legendCats.map(function (c) {
      return c === 'Highlighted' && hasHi
        ? { name: c, itemStyle: { color: RK.theme.alpha(t.accent2, 0.12), borderColor: t.accent2, borderWidth: 2 } }
        : { name: c, itemStyle: { color: catColor[c] } };
    });

    return {
      legend: C.legend(ctx, {
        show: showLegend, selectedMode: false, type: 'plain',
        data: legendCats.map(function (c) {
          return c === 'Highlighted' ? { name: c, itemStyle: { color: RK.theme.alpha(t.accent2, 0.12), borderColor: t.accent2, borderWidth: 2 } } : c;
        })
      }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          if (p.dataType !== 'node' || !p.data) return '';
          var n = model.byId.get(p.data.rkFor);
          if (!n) return '';
          if (p.data.rkDummy) return C.tip(n.name, [{ label: 'Hidden subsidiaries', value: RK.format(n.descendants, '#,##0') }], 'Click to expand');
          var rows = [];
          if (n.country) rows.push({ label: ctx.title(enc.country), value: n.country });
          if (n.cat) rows.push({ color: catColor[n.cat], label: ctx.title(enc.category), value: n.cat });
          if (n.parent) rows.push({ label: 'Parent', value: n.parent.name });
          if (n.depth > 0) rows.push({ label: 'Direct ' + String(ctx.title(enc.pct)).toLowerCase(), value: RK.format(n.pct, pfmt) });
          if (n.depth > 0) rows.push({ label: 'Effective ' + String(ctx.title(enc.pct)).toLowerCase(), value: RK.format(n.eff, pfmt), bold: true });
          if (n.children.length) rows.push({ label: 'Subsidiaries', value: RK.format(n.descendants, '#,##0') });
          var foot = n.children.length && o.collapsible !== false ? (collapsed.has(n.id) ? 'Click to expand' : 'Click to collapse') : null;
          return C.tip(n.name, rows, foot);
        }
      },
      series: [{
        id: 'tree',
        type: 'graph',
        layout: 'none',
        left: box.left, top: box.top, width: box.width, height: box.height,
        preserveAspect: 'contain',
        roam: o.roam !== false,
        scaleLimit: { min: 0.3, max: 4 },
        nodeScaleRatio: 1,
        draggable: false,
        categories: catList,
        data: nodes,
        links: links,
        lineStyle: { color: t.axis, width: 1, opacity: 1 },
        emphasis: { focus: 'none', scale: false, itemStyle: { borderColor: t.accent2, borderWidth: 2 } },
        animationDuration: 700,
        animationDurationUpdate: 500,
        animationEasing: 'cubicOut',
        animationEasingUpdate: 'cubicInOut'
      }]
    };
  }
})();
