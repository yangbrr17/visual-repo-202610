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

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'sunburst.ofTotal': '占合计 {pct}', 'sunburst.goUp': '点击返回上一级', 'sunburst.drill': '点击下钻', 'sunburst.vsAvg': '{field}（较加权平均）',
      'sunburst.pctTotal': '占合计比例', 'sunburst.pctOf': '占{name}比例'
    });
  }

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
      labels: 'auto',          // auto (name + share on every ring; labels that do not fit are hidden, never cut) | name | none
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
        cName.textContent = node ? node.name : (o.rootName || state.tree.rootName || tr('total', 'Total'));
        cVal.textContent = RK.format(value, L.fmt);
        cSub.textContent = node ? tr('sunburst.ofTotal', '{pct} of total', { pct: RK.format(total ? value / total : null, '0.0%') }) + (!hover && chain.length ? ' · ' + tr('sunburst.goUp', 'click to go up') : '')
          : (state.tree.roots.some(function (n) { return n.children.length; }) && o.drill !== false ? tr('sunburst.drill', 'Click to drill in') : '');
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

      // labels are fitted by measuring text: measure again once the web fonts have loaded
      var alive = true;
      if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(function () { if (alive) base.update(state.ctx); });
      var destroy = base.destroy;
      base.destroy = function () { alive = false; centre.remove(); destroy(); };
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
    if (ctx.options.crossFilter !== false && node.field) ctx.select(node.field, node.name);   // 'name' etc. stay in this dataset (core)
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
    var legendH = showLegend ? 22 : 0;

    // metric colour scale
    var leafList = [];
    (function lf(ls) { ls.forEach(function (n) { if (n.children.length) lf(n.children); else leafList.push(n); }); })(tree.roots);
    var mid = o.colorMid === 'avg'
      ? (function () { var w = 0, s = 0; leafList.forEach(function (n) { if (n.metric != null) { s += n.metric * n.value; w += n.value; } }); return w ? s / w : 0; })()
      : (+o.colorMid || 0);
    var dev = leafList.concat(tree.roots).reduce(function (m, n) { return n.metric == null ? m : Math.max(m, Math.abs(n.metric - mid)); }, 0) || 1;
    var scale = RK.theme.diverging([mid - dev, mid + dev], mid);
    var ring = (t.div || []).some(function (c) { return RK.theme.distance(c, t.accent2) < 70; }) ? t.ink : t.accent2;   // target outline

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
    function shareText(v) { var f = viewTotal ? v / viewTotal : null; return RK.format(f, f != null && f < 0.005 ? '0.0%' : '0%'); }   // never a bare "0%"

    /* ---- labels: 11px, never truncated, never shrunk — a label either fits its slice (name + share) or is
     * left to the tooltip / centre readout; the highlighted node gets an outside callout instead ---- */
    var FONT1 = '600 11px ' + t.fontSans, FONT2 = '11px ' + t.fontSans, LH = 13;
    function tw(s, f) { return C.measure(s, f) * 1.05 + 3; }   // margin: the web font may still be loading
    /** Word-wrap `name` into lines of at most `w` px (null when a single word is wider). */
    function wrapWords(name, w, f) {
      var words = String(name).split(/\s+/), lines = [''];
      for (var i = 0; i < words.length; i++) {
        if (tw(words[i], f) > w) return null;
        var cur = lines[lines.length - 1], tryL = cur ? cur + ' ' + words[i] : words[i];
        if (cur && tw(tryL, f) > w) lines.push(words[i]); else lines[lines.length - 1] = tryL;
      }
      return lines;
    }
    function geometry(R) {
      var r0 = R * Math.max(0, Math.min(0.8, o.innerRadius)), b = [r0];
      if (maxDepth <= 1) b.push(R);
      else {
        var outer = (R - r0) * (maxDepth === 2 ? 0.56 : 0.4), step = (R - r0 - outer) / (maxDepth - 1);
        for (var k = 1; k < maxDepth; k++) b.push(r0 + step * k);
        b.push(R);
      }
      return { R: R, r0: r0, bounds: b };
    }
    /** Inside label text for a slice of angular span `deg`, or null when it does not fit. */
    function inside(n, depth, deg, G) {
      if (o.labels === 'none' || deg < o.minLabelAngle) return null;
      var r0 = G.bounds[depth - 1], r1 = G.bounds[depth], thick = r1 - r0, rMid = (r0 + r1) / 2;
      var arc = deg / 360 * Math.PI * 2 * rMid, f = depth === 1 ? FONT1 : FONT2;
      var tang = depth < maxDepth;
      // tangential (inner rings): lines run along the arc; radial (outer ring): lines run outward
      var along = tang ? Math.min(arc - 4, rMid * 1.6) : thick - 10, across = tang ? thick - 6 : arc - 3;
      var share = o.labels === 'name' ? null : shareText(n.value);
      var lines = wrapWords(n.name, along, f);
      if (!lines) return null;
      if (share && (lines.length + 1) * LH <= across) return lines.concat(share).join('\n');
      return lines.length * LH <= across ? lines.join('\n') : null;
    }
    // angular extent of every node in the view (data is pre-sorted; startAngle 90, clockwise)
    var span = new Map();
    (function walk(ls, a0, scaleDeg, depth) {
      sorted(ls).forEach(function (n) {
        var deg = n.value * scaleDeg;
        span.set(n.id, { a0: a0, deg: deg, depth: depth, n: n });
        if (n.children.length) walk(n.children, a0, n.value ? deg / n.value : 0, depth + 1);
        a0 += deg;
      });
    })(list, 0, viewTotal ? 360 / viewTotal : 0, 1);
    function plan(G) {
      var labels = new Map(), calls = [];
      span.forEach(function (sp, id) {
        var n = sp.n;
        var txt = inside(n, sp.depth, sp.deg, G);
        if (txt) labels.set(id, txt);
        else if (hl.indexOf(n.name) >= 0 && o.labels !== 'none') calls.push({ n: n, sp: sp, text: n.name + '  ' + shareText(n.value) });
      });
      return { labels: labels, calls: calls };
    }
    var Rmax = Math.max(40, Math.min(H / 2 - 4 - legendH / 2, W / 2 - 4));
    var G = geometry(Rmax), P = plan(G);
    if (P.calls.length) {   // room for callouts beside the ring
      var cw = Math.max.apply(null, P.calls.map(function (c) { return tw(c.text, FONT1); })) + 26;
      var R2 = Math.max(40, Math.min(Rmax, W / 2 - 4 - cw));
      if (R2 < Rmax) { G = geometry(R2); P = plan(G); }
    }
    var R = G.R, bounds = G.bounds;
    var L = state.L = { W: W, H: H, cx: W / 2, cy: H / 2 + legendH / 2, R: R, r0: G.r0, fmt: fmt };

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
          padding: tangential ? 0 : [0, 0, 0, 5],
          overflow: 'none', minAngle: 0,
          fontSize: 11, fontWeight: d === 1 ? 600 : 400, fontFamily: t.fontSans, lineHeight: LH,
          formatter: function (p) { return p.data && p.data.lt ? p.data.lt : ''; }   // fitted text from plan()
        }
      });
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
        var lt = P.labels.get(n.id) || '';
        var item = {
          id: n.id, name: n.name, value: n.value, metric: n.metric, field: n.field, lt: lt,
          itemStyle: { color: fill, borderColor: byMetric && hl.indexOf(n.name) >= 0 ? ring : undefined, borderWidth: byMetric && hl.indexOf(n.name) >= 0 ? 2 : undefined },
          label: { show: !!lt, color: RK.theme.textOn(fill), fontWeight: hl.indexOf(n.name) >= 0 ? 700 : undefined }
        };
        if (kids) item.children = toData(n.children, depth + 1);
        return item;
      });
    }
    var data = toData(list, 1);

    var graphic = [];
    // callouts for highlighted slices too thin for an inside label: leader to the side, spread vertically
    var sides = { l: [], r: [] };
    P.calls.forEach(function (c) {
      var ang = (90 - (c.sp.a0 + c.sp.deg / 2)) * Math.PI / 180, rOut = bounds[c.sp.depth];
      var ax = L.cx + rOut * Math.cos(ang), ay = L.cy - rOut * Math.sin(ang);
      var ex = L.cx + (rOut + 8) * Math.cos(ang), ey = L.cy - (rOut + 8) * Math.sin(ang);
      sides[ax >= L.cx ? 'r' : 'l'].push({ c: c, ax: ax, ay: ay, ex: ex, ey: ey });
    });
    ['l', 'r'].forEach(function (k) {
      var arr = sides[k];
      if (!arr.length) return;
      var ys = C.spreadLabels(arr.map(function (a) { return a.ey; }), 15, 8, H - 8);
      arr.forEach(function (a, i) {
        var right = k === 'r', x2 = L.cx + (right ? 1 : -1) * (R + 12);
        graphic.push({ type: 'polyline', silent: true, shape: { points: [[a.ax, a.ay], [a.ex, a.ey], [x2, ys[i]]] }, style: { stroke: t.ink3, lineWidth: 1, fill: 'none' } });
        graphic.push({ type: 'text', silent: true, x: x2 + (right ? 4 : -4), y: ys[i],
          style: { text: a.c.text, fill: t.ink, font: FONT1, textAlign: right ? 'left' : 'right', textVerticalAlign: 'middle' } });
      });
    });
    if (showLegend) {
      // colour legend top-left (house style): title, ramp, low / mid / high ticks
      var lab = o.colorMid === 'avg' ? tr('sunburst.vsAvg', '{field} vs. weighted avg.', { field: ctx.title(enc.color) }) : ctx.title(enc.color);
      var lw = Math.min(140, W * 0.24), lx = Math.ceil(C.measure(lab, '11px ' + t.fontSans) + 10);
      var stops = (t.div || []).map(function (c, i, a) { return { offset: i / (a.length - 1), color: c }; });
      var tick = function (x, v, align) {
        return { type: 'text', x: x, y: 12, silent: true, style: { text: RK.format(v, mfmt), fill: t.ink3, font: '10px ' + t.fontNum, textAlign: align, textVerticalAlign: 'top' } };
      };
      graphic.push(
        { type: 'text', x: 0, y: 6, silent: true, style: { text: lab, fill: t.ink2, font: '11px ' + t.fontSans, textAlign: 'left', textVerticalAlign: 'middle' } },
        { type: 'rect', x: lx, y: 2, silent: true, shape: { width: lw, height: 8, r: 1 }, style: { fill: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: stops } } },
        tick(lx, mid - dev, 'left'), tick(lx + lw / 2, mid, 'center'), tick(lx + lw, mid + dev, 'right'));
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
            { label: tr('sunburst.pctTotal', '% of total'), value: RK.format(total ? dt.value / total : null, '0.0%') }
          ];
          if (trail.length > 1) rows.push({ label: tr('sunburst.pctOf', '% of {name}', { name: trail[trail.length - 2] }), value: RK.format(parentVal ? dt.value / parentVal : null, '0.0%') });
          if (enc.color && dt.metric != null) rows.push({ label: ctx.title(enc.color), value: RK.format(dt.metric, mfmt) });
          return C.tip(trail.join(' › ') || dt.name, rows, dt.children && dt.children.length && o.drill !== false ? tr('sunburst.drill', 'Click to drill in') : null);
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
