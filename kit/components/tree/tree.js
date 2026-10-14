/*!
 * RK component: tree — legal-entity / group structure chart from an (id, parent) table: entity
 * boxes (name, country) coloured by entity type, orthogonal connectors with the direct ownership %
 * on each drop, click a box to collapse / expand its subsidiaries, wheel zoom + pan.
 * Layouts: top-down (TB), left-to-right (LR) or radial.
 *
 * Drawn as an ECharts graph with layout 'none': positions come from a tidy-tree layout computed
 * here in px (1:1 view), connectors are routed through invisible elbow nodes so they stay
 * orthogonal, and the ownership pills / "+n" badges are label-only nodes.
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
  function safe(s) { return String(s == null ? '' : s).replace(/[{}|]/g, ' '); }

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
  /** Theme categorical colours, skipping the highlight's hue family and near-duplicates. */
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
   * Writes n._x in "slot" units (box = 1, centre distance >= sep).
   */
  function tidy(roots, kidsOf, sep) {
    var top = {};
    function children(n) { return n === top ? roots : kidsOf(n); }
    function rec(n) {
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
      list.forEach(function (n) { n._x = x + n._rel; place(kidsOf(n), n._x); });
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
      highlight: null,          // entity id(s) or name(s) outlined in accent2
      categoryColors: {},       // {entity type: colour or theme token}
      rootFilled: true,         // ultimate parent(s) drawn as a solid box
      boxWidth: null,           // px; null = fit to the container (96–176)
      roam: true,
      legend: true,
      format: null              // ownership format; defaults to the pct field format
    },
    render: function (ctx) {
      var state = { collapsed: null }, current = ctx;
      var api = C(function (c, inst) { return build(c, inst, state); }, {
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
      // layout depends on the container size and the collapse state -> rebuild on both
      var up = api.update;
      api.update = function (c) { current = c; up(c); };
      api.resize = function () { api.chart.resize(); up(current); };
      return api;
    }
  });

  function build(ctx, inst, state) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var model = state.model = hierarchy(ctx);
    if (!state.collapsed) {
      state.collapsed = new Set();
      if (o.initialDepth != null) model.list.forEach(function (n) { if (n.depth >= o.initialDepth && n.children.length) state.collapsed.add(n.id); });
    }
    var collapsed = state.collapsed;
    function kids(n) { return collapsed.has(n.id) ? [] : n.children; }
    var pfmt = o.format || ctx.fmtOf(enc.pct) || '0%';
    var hi = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    function isHi(n) { return hi.indexOf(n.id) >= 0 || hi.indexOf(n.name) >= 0; }

    // categories -> colours (legend is a key only: hiding a type would orphan connectors)
    var cats = util.unique(model.list.map(function (n) { return n.cat || 'Entity'; }));
    var pal = distinctPalette(t.cat, hi.length ? t.accent2 : null), catColor = {};
    cats.forEach(function (c, i) { catColor[c] = tokenColor(t, (o.categoryColors || {})[c]) || pal[i % pal.length]; });

    var visible = [];
    (function walk(list) { list.forEach(function (n) { visible.push(n); walk(kids(n)); }); })(model.roots);
    var maxDepth = visible.reduce(function (m, n) { return Math.max(m, n.depth); }, 0);

    var W = ctx.el.clientWidth || 900, H = ctx.el.clientHeight || 420;
    var legendH = o.legend !== false && cats.length > 1 ? 30 : 4;
    var radial = o.layout === 'radial', lr = !radial && o.orient === 'LR';
    var nameFont = '600 10.5px ' + t.fontSans;
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
          show: true, position: 'inside', formatter: text, fontSize: 9.5, fontFamily: t.fontNum, fontWeight: strong ? 600 : 500,
          color: strong ? t.ink : t.ink2, backgroundColor: t.paper, borderColor: strong ? t.rule : 'transparent', borderWidth: strong ? 1 : 0,
          borderRadius: 7, padding: [1, 4]
        },
        emphasis: { disabled: true }, tooltip: { show: false }
      });
    }
    function point(id) { nodes.push({ id: id, name: id, x: 0, y: 0, symbolSize: 0, rkDummy: true, label: { show: false }, emphasis: { disabled: true }, tooltip: { show: false } }); return nodes[nodes.length - 1]; }
    function link(a, b, n, dashed) {
      links.push({ source: a, target: b, lineStyle: { color: t.axis, width: 1, curveness: 0, type: dashed ? [4, 3] : 'solid' }, emphasis: { disabled: true } });
    }
    function boxStyle(n) {
      var c = catColor[n.cat || 'Entity'], filled = o.rootFilled && n.depth === 0;
      var fill = filled ? c : RK.theme.mix(c, t.paper, 0.9);
      return {
        fill: fill,
        text: filled ? RK.theme.onColor(fill, t.ink, '#fff') : t.ink,
        sub: filled ? RK.theme.alpha(RK.theme.onColor(fill, t.ink, '#fff'), 0.78) : t.ink3,
        border: isHi(n) ? t.accent2 : c,
        bw: isHi(n) ? 2.2 : (filled ? 0 : 1.1)
      };
    }

    if (!radial) {
      // ---- orthogonal (TB / LR) ------------------------------------------------------------
      var sep = lr ? 1.28 : 1.14;
      tidy(model.roots, kids, sep);
      var xs = util.extent(visible.map(function (n) { return n._x; }));
      var slots = xs[1] - xs[0] + 1;
      var rows = maxDepth + 1;
      var boxW, boxH, nameLines = 2, rowStep, slotPx;
      if (!lr) {
        boxW = o.boxWidth || util.clamp((W - 2 * pad) / slots, 96, 176);
        slotPx = boxW;
      } else {
        boxW = o.boxWidth || util.clamp((W - 2 * pad - 28 - maxDepth * 56) / rows, 120, 200);
      }
      var wrapped = new Map();
      visible.forEach(function (n) { wrapped.set(n.id, wrap(n.name, nameFont, boxW - 14, nameLines)); });
      var maxLines = visible.reduce(function (m, n) { return Math.max(m, wrapped.get(n.id).length); }, 1);
      var hasCountry = enc.country && visible.some(function (n) { return n.country != null && n.country !== ''; });
      boxH = 10 + maxLines * 13 + (hasCountry ? 13 : 0) + 8;
      var gap, x0, y0;
      if (!lr) {
        gap = util.clamp((H - legendH - 2 * pad - rows * boxH) / Math.max(1, rows - 1), 34, 72);
        rowStep = boxH + gap;
        x0 = (W - slots * slotPx) / 2 + slotPx / 2 - xs[0] * slotPx;
        y0 = legendH + pad + boxH / 2;
      } else {
        slotPx = boxH;
        var badge = collapsed.size ? 28 : 0;
        gap = util.clamp((W - 2 * pad - badge - rows * boxW) / Math.max(1, rows - 1), 40, 96);
        rowStep = boxW + gap;
        x0 = Math.max(pad, (W - badge - rows * boxW - (rows - 1) * gap) / 2) + boxW / 2;
        y0 = legendH + Math.max(pad, (H - legendH - slots * slotPx) / 2) + slotPx / 2 - xs[0] * slotPx;
      }
      // main = along the depth axis, cross = along the sibling axis
      var pos = function (n) {
        var cross = n._x * slotPx, main = n.depth * rowStep;
        return lr ? [x0 + main, y0 + cross] : [x0 + cross, y0 + main];
      };
      var half = lr ? boxW / 2 : boxH / 2;

      visible.forEach(function (n) {
        var p = pos(n), st = boxStyle(n), lines = wrapped.get(n.id);
        n._p = p;
        nodes.push({
          id: 'n:' + n.id, name: n.name, rkFor: n.id, x: p[0], y: p[1],
          symbol: 'rect', symbolSize: [boxW, boxH], category: cats.indexOf(n.cat || 'Entity'),
          itemStyle: { color: st.fill, borderColor: st.border, borderWidth: st.bw },
          label: {
            show: true, position: 'inside', align: 'center', verticalAlign: 'middle',
            formatter: lines.map(function (l) { return '{n|' + safe(l) + '}'; }).join('\n') + (hasCountry && n.country ? '\n{c|' + safe(n.country) + '}' : ''),
            rich: {
              n: { fontSize: 10.5, fontWeight: 600, color: st.text, lineHeight: 13, fontFamily: t.fontSans, align: 'center' },
              c: { fontSize: 9.5, color: st.sub, lineHeight: 13, fontFamily: t.fontSans, align: 'center' }
            }
          },
          cursor: n.children.length && o.collapsible !== false ? 'pointer' : 'default'
        });
      });
      // connectors: parent -> bus point -> knee above / left of each child -> child
      visible.forEach(function (n) {
        var ks = kids(n);
        if (ks.length) {
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
          var off = half + 11;
          pill('more:' + n.id, lr ? n._p[0] + off : n._p[0], lr ? n._p[1] : n._p[1] + off, '+' + n.descendants, n.id, true);
        }
      });
    } else {
      // ---- radial ----------------------------------------------------------------------------
      // leaves share the full turn (one slot each), internal nodes sit on depth rings, leaves on the
      // outer ring; rings are stretched into an ellipse to use a wide block, labels sit horizontally
      // on the outer side
      leafSlots(model.roots, kids);
      var leafSpan = util.extent(visible.map(function (n) { return n._x; }));
      var span = leafSpan[1] - leafSpan[0] + 1;
      var labFont = '500 10.5px ' + t.fontSans;
      var labW = Math.min(150, visible.reduce(function (m, n) { return Math.max(m, measure(n.name, labFont)); }, 0));
      var cxr = W / 2, cyr = legendH + (H - legendH) / 2;
      var rx = Math.max(60, W / 2 - labW - 22), ry = Math.max(50, (H - legendH) / 2 - 18);
      var single = model.roots.length === 1 && !collapsed.has(model.roots[0].id);
      var levels = single ? Math.max(1, maxDepth) : maxDepth + 1;
      visible.forEach(function (n) {
        var a = -Math.PI / 2 + 2 * Math.PI * (n._x - leafSpan[0] + 0.5) / span;
        // cluster style: leaves on the outer ring, so every leaf label sits on the perimeter
        var f = kids(n).length || (single && n.depth === 0) ? (single ? n.depth : n.depth + 1) / levels : 1;
        n._a = a;
        n._f = f;
        n._p = [cxr + Math.cos(a) * rx * f, cyr + Math.sin(a) * ry * f];
      });
      function polar(a, f) { return [cxr + Math.cos(a) * rx * f, cyr + Math.sin(a) * ry * f]; }
      visible.forEach(function (n) {
        var c = catColor[n.cat || 'Entity'], right = Math.cos(n._a) >= -1e-6, center = n.depth === 0 && single;
        nodes.push({
          id: 'n:' + n.id, name: n.name, rkFor: n.id, x: n._p[0], y: n._p[1],
          symbol: 'circle', symbolSize: center ? 18 : (n.children.length ? 12 : 9), category: cats.indexOf(n.cat || 'Entity'),
          itemStyle: { color: c, borderColor: isHi(n) ? t.accent2 : t.paper, borderWidth: isHi(n) ? 2.5 : 1 },
          label: {
            show: true, position: center ? 'bottom' : (right ? 'right' : 'left'), distance: 5,
            formatter: safe(n.name), fontSize: 10.5, fontWeight: n.depth === 0 || isHi(n) ? 700 : 500,
            color: n.children.length ? t.ink : t.ink2, textBorderColor: t.paper, textBorderWidth: 3,
            width: labW, overflow: 'truncate'
          },
          cursor: n.children.length && o.collapsible !== false ? 'pointer' : 'default'
        });
        // polar elbow connectors: spoke out to a bus ring half a level beyond the parent, arc along
        // the ring across the children's angles, spoke out to each child
        var ks = kids(n);
        if (ks.length) {
          var fb = n._f + 0.5 / levels;
          var pts = [{ a: n._a, id: 'rp:' + n.id }];
          ks.forEach(function (k) { pts.push({ a: k._a, id: 'rk:' + k.id, child: k }); });
          var lo = Math.min.apply(null, pts.map(function (q) { return q.a; })), hi2 = Math.max.apply(null, pts.map(function (q) { return q.a; }));
          for (var a = lo + 0.08; a < hi2 - 0.04; a += 0.08) pts.push({ a: a, id: 'ra:' + n.id + ':' + pts.length });
          pts.sort(function (p1, p2) { return p1.a - p2.a; });
          pts.forEach(function (q) { var d = point(q.id), xy = polar(q.a, fb); d.x = xy[0]; d.y = xy[1]; });
          for (var i = 1; i < pts.length; i++) link(pts[i - 1].id, pts[i].id, null, false);
          link('n:' + n.id, 'rp:' + n.id, null, false);
          ks.forEach(function (k) {
            link('rk:' + k.id, 'n:' + k.id, null, o.dashMinority && k.pct != null && k.pct < 0.5);
            var txt = pctText(k);
            if (txt) { var mxy = polar(k._a, (fb + k._f) / 2); pill('pct:' + k.id, mxy[0], mxy[1], txt, null, false); }
          });
        }
        if (collapsed.has(n.id) && n.children.length) {
          pill('more:' + n.id, n._p[0] + Math.cos(n._a) * 16, n._p[1] + Math.sin(n._a) * 16 + 12, '+' + n.descendants, n.id, true);
        }
      });
    }

    // 1:1 view: series box = bounding box of the (px) node positions
    var bx = util.extent(nodes.map(function (d) { return d.x; })), by = util.extent(nodes.map(function (d) { return d.y; }));
    var box = { left: bx[0], top: by[0], width: Math.max(1, bx[1] - bx[0]), height: Math.max(1, by[1] - by[0]) };

    return {
      legend: C.legend(ctx, { show: o.legend !== false && cats.length > 1, data: cats, selectedMode: false }),
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
        categories: cats.map(function (c) { return { name: c, itemStyle: { color: catColor[c] } }; }),
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
