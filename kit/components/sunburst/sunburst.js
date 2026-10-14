/*!
 * RK component: sunburst — radial hierarchy (inner ring = top level, outer rings = children) with a
 * centre readout. Colour by top-level group (children in tints) or by a metric (diverging).
 * Hierarchy from id / parent fields or from path fields on flat data (encode.path).
 * Click a group to drill in, click the centre to go back up; click a leaf to cross-filter.
 */
(function () {
  'use strict';
  var C = RK.chart;
  var OTHERS = /^(others?|other .+|rest of .+|all other.*)$/i;

  /**
   * Build a tree: [{id, name, value, metric, field, depth, children[]}] + the single root's name.
   * Parent values are always the sum of their children so the angles add up exactly.
   * (Same contract as the treemap component.)
   */
  function hierarchy(ctx) {
    var enc = ctx.enc, rows = ctx.rows, mf = enc.color;
    var roots = [], rootName = null;
    function num(v) { return v == null || v === '' || !isFinite(v) ? null : +v; }
    if (Array.isArray(enc.path) && enc.path.length) {
      var top = { children: [], index: new Map() };
      rows.forEach(function (r) {
        var v = num(r[enc.value]);
        if (v == null || v <= 0) return;
        var node = top, key = '';
        enc.path.forEach(function (f, d) {
          var name = r[f] == null || r[f] === '' ? 'n.a.' : String(r[f]);
          key += '\u0001' + name;
          var next = node.index.get(name);
          if (!next) {
            next = { id: key, name: name, field: f, depth: d + 1, children: [], index: new Map(), own: 0, wm: 0, w: 0 };
            node.index.set(name, next);
            node.children.push(next);
          }
          node = next;
        });
        node.own += v;
        var m = mf ? num(r[mf]) : null;
        if (m != null) { node.wm += m * v; node.w += v; }
      });
      roots = top.children;
      (function fin(list) {
        list.forEach(function (n) {
          delete n.index;
          if (!n.children.length) { n.value = n.own; n.metric = n.w ? n.wm / n.w : null; }
          fin(n.children);
        });
      })(roots);
    } else {
      var byId = new Map();
      rows.forEach(function (r) {
        var id = r[enc.id];
        if (id == null || id === '') return;
        byId.set(String(id), { id: String(id), name: r[enc.name] != null ? String(r[enc.name]) : String(id), field: enc.name, raw: r, own: num(r[enc.value]), rawMetric: mf ? num(r[mf]) : null, children: [] });
      });
      byId.forEach(function (n) {
        var p = n.raw[enc.parent];
        if (p != null && p !== '' && byId.has(String(p)) && String(p) !== n.id) byId.get(String(p)).children.push(n);
        else roots.push(n);
      });
      if (roots.length === 1 && roots[0].children.length) { rootName = roots[0].name; roots = roots[0].children; }
      (function depth(list, d) { list.forEach(function (n) { n.depth = d; delete n.raw; depth(n.children, d + 1); }); })(roots, 1);
      (function fin(list) {
        list.forEach(function (n) {
          fin(n.children);
          if (!n.children.length) { n.value = n.own; n.metric = n.rawMetric; }
        });
      })(roots);
    }
    (function roll(list) {
      list.forEach(function (n) {
        if (n.children.length) {
          roll(n.children);
          n.children = n.children.filter(function (c) { return c.value > 0; });
          n.value = n.children.reduce(function (s, c) { return s + c.value; }, 0);
          var w = 0, wm = 0;
          n.children.forEach(function (c) { if (c.metric != null) { wm += c.metric * c.value; w += c.value; } });
          n.metric = n.rawMetric != null ? n.rawMetric : (w ? wm / w : null);
        }
      });
    })(roots);
    roots = roots.filter(function (n) { return n.value > 0; });
    var total = roots.reduce(function (s, n) { return s + n.value; }, 0);
    return { roots: roots, total: total, rootName: rootName };
  }

  function longestWord(s, font) {
    return Math.max.apply(null, String(s).split(/\s+/).map(function (w) { return C.measure(w, font); }));
  }
  /** Generic node fields ('name', 'category' …) cross-filter only this block's dataset; business dimensions stay global. */
  var GENERIC = /^(type|kind|source|target|step|stage|metric|measure|category|group|series|label|name|id|parent|key|value|x|y)$/i;

  function chainOf(list, id) {
    var out = [];
    (function walk(ls, trail) {
      ls.forEach(function (n) {
        if (out.length) return;
        var t = trail.concat([n]);
        if (n.id === id) out = t; else walk(n.children, t);
      });
    })(list, []);
    return out;
  }

  RK.component({
    id: 'sunburst',
    deps: ['echarts'],
    defaults: {
      encode: { id: 'id', parent: 'parent', name: 'name', value: 'value', color: null, path: null },
      colorBy: 'auto',         // auto | group | metric — auto = metric when encode.color is set
      colorMid: 0,             // metric midpoint: a number or 'avg' (value-weighted average)
      sort: 'desc',            // desc | asc | null (data order), clockwise from 12 o'clock
      innerRadius: 0.3,        // centre hole as a share of the outer radius
      labels: 'auto',          // auto (inner ring: name + share, outer: name) | name | none
      minLabelAngle: 7,        // degrees; thinner slices are labelled in the tooltip only
      center: true,            // total (or the drilled node) in the centre
      rootName: null,          // centre caption (defaults to the single root node, else 'Total')
      drill: true,             // click a group to drill in; centre to go back
      highlight: null,         // node name(s) drawn in the accent colour (e.g. the client)
      format: null,            // value format; defaults to the value field format
      metricFormat: null,
      legend: true             // colour-scale legend (metric mode)
    },
    render: function (ctx) {
      var h = RK.util.h;
      var state = { ctx: ctx, tree: null, view: [], inst: null, L: null };
      var cName = h('div.rk-sunburst__name'), cVal = h('div.rk-sunburst__value.rk-num'), cSub = h('div.rk-sunburst__sub');
      var centre = h('div.rk-sunburst__centre', { 'aria-live': 'polite' }, cName, cVal, cSub);
      state.paintCentre = function (hover) {
        var L = state.L, c = state.ctx, o = c.options;
        if (!o.center || !L || L.r0 < 34) { centre.style.display = 'none'; return; }
        var chain = state.view.length ? chainOf(state.tree.roots, state.view[state.view.length - 1]) : [];
        var node = hover || chain[chain.length - 1] || null;
        var total = state.tree.total, value = node ? node.value : total;
        var size = Math.floor(L.r0 * 1.84);
        centre.style.cssText = 'left:' + L.cx + 'px;top:' + L.cy + 'px;width:' + size + 'px;height:' + size + 'px;--rk-sb-v:' + Math.round(Math.max(13, Math.min(22, L.r0 * 0.26))) + 'px';
        centre.classList.toggle('is-drilled', !!chain.length && !hover);
        centre.classList.toggle('is-hover', !!hover);
        cName.textContent = node ? node.name : (o.rootName || state.tree.rootName || 'Total');
        cVal.textContent = RK.format(value, L.fmt);
        cSub.textContent = node ? RK.format(total ? value / total : null, '0.0%') + ' of total' + (!hover && chain.length ? ' · click to go up' : '') : (state.tree.roots.some(function (n) { return n.children.length; }) && o.drill !== false ? 'Click to drill in' : '');
      };
      var base = C(function (c, inst) {
        state.ctx = c; state.inst = inst;
        var opt = build(c, inst, state);
        state.paintCentre(null);
        return opt;
      }, {
        rebuildOnResize: true,   // rings and the centre readout are laid out in pixels
        on: {
          click: function (p) { click(p, state); },
          mouseover: function (p) { if (p.seriesId === 'sb' && p.data && p.data.id) { var ch = chainOf(state.tree.roots, p.data.id); state.paintCentre(ch[ch.length - 1]); } },
          mouseout: function () { state.paintCentre(null); },
          globalout: function () { state.paintCentre(null); }
        }
      })(ctx);
      // drilling re-renders the series with the chosen subtree (stable ids → ECharts morphs the rings)
      state.rebuild = function () { base.update(state.ctx); };
      ctx.el.appendChild(centre);
      // the centre is a button when drilled: back up one level
      centre.addEventListener('click', function () { if (state.view.length) zoom(state, state.view[state.view.length - 2] || null); });

      var destroy = base.destroy;
      base.destroy = function () { centre.remove(); destroy(); };
      return base;
    }
  });

  /** Drill to a node id (null = top level). */
  function zoom(state, id) {
    state.view = id ? chainOf(state.tree.roots, id).map(function (n) { return n.id; }) : [];
    state.rebuild();
  }

  function click(p, state) {
    var ctx = state.ctx;
    if (p.seriesId !== 'sb' || !p.data || p.data.id == null) return;
    var node = p.data;
    if (ctx.options.drill !== false && node.children && node.children.length) { zoom(state, node.id); return; }
    if (ctx.options.crossFilter !== false && node.field) {
      ctx.select(node.field, node.name, GENERIC.test(node.field) ? { scope: ctx.options.crossFilterScope || 'dataset' } : null);
    }
  }

  function build(ctx, inst, state) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var tree = state.tree = hierarchy(ctx);
    // current drill level (reset when filters removed the node)
    var viewChain = state.view.length ? chainOf(tree.roots, state.view[state.view.length - 1]) : [];
    if (state.view.length && !viewChain.length) state.view = [];
    var viewNode = viewChain[viewChain.length - 1] || null;
    var list = viewNode ? viewNode.children : tree.roots;
    var baseDepth = viewNode ? viewNode.depth : 0;
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var mfmt = o.metricFormat || (enc.color && ctx.fmtOf(enc.color)) || '0.0%';
    var byMetric = o.colorBy === 'metric' || (o.colorBy === 'auto' && !!enc.color);
    var hl = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    var maxDepth = 0;   // rings in the current view
    (function md(ls) { ls.forEach(function (n) { maxDepth = Math.max(maxDepth, n.depth - baseDepth); md(n.children); }); })(list);

    var W = inst.getWidth(), H = inst.getHeight();
    var showLegend = byMetric && o.legend !== false;
    var R = Math.max(40, Math.min(H / 2 - 4 - (showLegend ? 10 : 0), W / 2 - 4));
    var L = state.L = { W: W, H: H, cx: W / 2, cy: H / 2 + (showLegend ? 10 : 0), R: R, r0: R * Math.max(0, Math.min(0.8, o.innerRadius)), fmt: fmt };

    // metric colour scale
    var leafList = [];
    (function lf(ls) { ls.forEach(function (n) { if (n.children.length) lf(n.children); else leafList.push(n); }); })(tree.roots);
    var mid = o.colorMid === 'avg'
      ? (function () { var w = 0, s = 0; leafList.forEach(function (n) { if (n.metric != null) { s += n.metric * n.value; w += n.value; } }); return w ? s / w : 0; })()
      : (+o.colorMid || 0);
    var dev = leafList.concat(tree.roots).reduce(function (m, n) { return n.metric == null ? m : Math.max(m, Math.abs(n.metric - mid)); }, 0) || 1;
    var scale = RK.theme.diverging([mid - dev, mid + dev], mid);

    var total = tree.total;
    var viewTotal = viewNode ? viewNode.value : total;     // ring shares are of the current view
    function isDim(n) {
      var sel = n.field ? ctx.selected(n.field) : [];
      return sel.length > 0 && sel.indexOf(n.name) < 0;
    }
    function sorted(list) {
      if (!o.sort) return list.slice();
      return list.slice().sort(function (a, b) { return o.sort === 'asc' ? a.value - b.value : b.value - a.value; });
    }
    // ring geometry: the outermost ring is widest (radial labels need length), inner rings share the rest
    var bounds = [L.r0];
    if (maxDepth <= 1) bounds.push(L.R);
    else {
      var outer = (L.R - L.r0) * (maxDepth === 2 ? 0.56 : 0.4);
      var step = (L.R - L.r0 - outer) / (maxDepth - 1);
      for (var k = 1; k < maxDepth; k++) bounds.push(L.r0 + step * k);
      bounds.push(L.R);
    }
    var levels = [{}];
    for (var d = 1; d <= maxDepth; d++) {
      var tangential = d < maxDepth;
      levels.push({
        r0: bounds[d - 1], r: bounds[d],
        itemStyle: { borderColor: t.paper, borderWidth: d === 1 ? 2 : 1 },
        label: o.labels === 'none' ? { show: false } : {
          show: true,
          rotate: tangential ? 'tangential' : 'radial',
          align: tangential ? 'center' : 'left',
          padding: tangential ? 0 : [0, 0, 0, 4],
          overflow: 'truncate', ellipsis: '…', lineOverflow: 'truncate',
          minAngle: o.minLabelAngle,
          fontSize: d === 1 ? 11 : 10.5,
          fontWeight: d === 1 ? 600 : 400,
          fontFamily: t.fontSans,
          lineHeight: 13,
          formatter: d === 1 && maxDepth > 1 && o.labels !== 'name'
            ? function (p) { return p.name + '\n' + RK.format(viewTotal ? p.value / viewTotal : null, '0%'); }
            : '{b}'
        }
      });
    }

    /**
     * Per-slice label box from its arc: tangential labels wrap within the arc length and the ring
     * thickness; radial labels run along the ring and wrap only when the slice is wide enough.
     */
    function labelBox(n, depth) {
      var r0 = bounds[depth - 1], r1 = bounds[depth], thick = r1 - r0, rMid = (r0 + r1) / 2;
      var arc = (viewTotal ? n.value / viewTotal : 0) * Math.PI * 2 * rMid;
      var font = (depth === 1 ? '600 11px ' : '10.5px ') + t.fontSans;
      var box = depth < maxDepth
        ? { width: Math.max(16, Math.min(arc - 10, rMid * 1.6)), height: Math.max(12, thick - 8), overflow: arc > 50 ? 'break' : 'truncate' }
        : { width: Math.max(16, thick - 12), height: Math.max(12, Math.min(arc - 4, 42)), overflow: arc > 30 ? 'break' : 'truncate' };
      // never split inside a word: try a slightly smaller size, else fall back to one truncated line
      // (generous margin: the web font may not be loaded yet when we measure)
      var fits = function (f) { return longestWord(n.name, f) * 1.15 + 8 <= box.width; };
      if (box.overflow === 'break' && !fits(font)) {
        var sizes = depth === 1 ? [10, 9.5] : [9.5, 9], ok = false;
        for (var si = 0; si < sizes.length && !ok; si++) {
          if (fits((depth === 1 ? '600 ' : '') + sizes[si] + 'px ' + t.fontSans)) { box.fontSize = sizes[si]; box.lineHeight = 12; ok = true; }
        }
        if (!ok) box.overflow = 'truncate';
      }
      return box;
    }

    // colours are assigned on the full tree, so a slice keeps its colour when drilled into; with a highlight
    // no group may read like the accent2 target (tints extend the palette instead of repeating it)
    var pal = RK.theme.palette(hl.length ? { n: tree.roots.length } : { exclude: [], n: tree.roots.length });
    var colors = new Map();
    (function paint(ls, parentColor, depth) {
      sorted(ls).forEach(function (n, i) {
        var c;
        if (byMetric) c = scale(n.metric);
        else if (hl.indexOf(n.name) >= 0) c = t.accent2;
        else if (depth === 1) c = pal[tree.roots.indexOf(n) % pal.length];
        else if (OTHERS.test(n.name)) c = RK.theme.mix(t.neutral, t.paper, 0.2);
        else c = RK.theme.mix(parentColor, t.paper, 0.18 + 0.14 * (i % 4));
        colors.set(n.id, c);
        paint(n.children, c, depth + 1);
      });
    })(tree.roots, null, 1);

    function toData(ls, depth) {
      return sorted(ls).map(function (n) {
        var kids = n.children.length > 0, color = colors.get(n.id);
        var fill = isDim(n) && !kids ? RK.theme.mix(color, t.paper, 0.72) : color;
        var item = {
          id: n.id, name: n.name, value: n.value, metric: n.metric, field: n.field,
          itemStyle: { color: fill },
          label: RK.util.merge({ color: RK.theme.textOn(fill) }, labelBox(n, depth))
        };
        if (kids) item.children = toData(n.children, depth + 1);
        return item;
      });
    }
    var data = toData(list, 1);

    var graphic = [];
    if (showLegend) {
      var lw = Math.min(140, W * 0.24), lx = W - lw - 2;
      var stops = (t.div || []).map(function (c, i, a) { return { offset: i / (a.length - 1), color: c }; });
      var tick = function (x, v, align) {
        return { type: 'text', x: x, y: 12, silent: true, style: { text: RK.format(v, mfmt), fill: t.ink3, font: '10px ' + t.fontNum, textAlign: align, textVerticalAlign: 'top' } };
      };
      graphic = [
        { type: 'text', x: lx - 8, y: 6, silent: true, style: { text: ctx.title(enc.color) + (o.colorMid === 'avg' ? ' vs. weighted avg.' : ''), fill: t.ink2, font: '11px ' + t.fontSans, textAlign: 'right', textVerticalAlign: 'middle' } },
        { type: 'rect', x: lx, y: 2, silent: true, shape: { width: lw, height: 8 }, style: { fill: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: stops } } },
        tick(lx, mid - dev, 'left'), tick(lx + lw / 2, mid, 'center'), tick(lx + lw, mid + dev, 'right')
      ];
    }

    return {
      tooltip: {
        trigger: 'item', confine: true,
        formatter: function (p) {
          var dt = p.data;
          if (!dt || p.seriesId !== 'sb' || dt.id == null) return '';
          var chain = chainOf(tree.roots, dt.id);
          var trail = chain.map(function (x) { return x.name; });
          var parentVal = chain.length > 1 ? chain[chain.length - 2].value : total;
          var rows = [
            { color: dt.itemStyle && dt.itemStyle.color, label: ctx.title(enc.value), value: RK.format(dt.value, fmt), bold: true },
            { label: '% of total', value: RK.format(total ? dt.value / total : null, '0.0%') }
          ];
          if (trail.length > 1) rows.push({ label: '% of ' + trail[trail.length - 2], value: RK.format(parentVal ? dt.value / parentVal : null, '0.0%') });
          if (enc.color && dt.metric != null) rows.push({ label: ctx.title(enc.color), value: RK.format(dt.metric, mfmt) });
          return C.tip(trail.join(' › ') || dt.name, rows, dt.children && dt.children.length && o.drill !== false ? 'Click to drill in' : null);
        }
      },
      graphic: graphic,
      series: [{
        id: 'sb', type: 'sunburst',
        center: [L.cx, L.cy], radius: [L.r0, L.R],
        startAngle: 90, clockwise: true,
        sort: null,              // data is pre-sorted (options.sort)
        nodeClick: false,
        emphasis: { focus: 'ancestor' },
        blur: { itemStyle: { opacity: 0.35 }, label: { opacity: 0.5 } },
        itemStyle: { borderColor: t.paper, borderWidth: 1 },
        label: { show: o.labels !== 'none', fontFamily: t.fontSans },
        levels: levels,
        animationDuration: 900, animationDurationUpdate: 600,
        data: data
      }]
    };
  }
})();
