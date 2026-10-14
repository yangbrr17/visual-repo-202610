/*!
 * RK component: treemap — squarified treemap of a hierarchy, sized by value and coloured by top-level
 * group or by a metric (e.g. growth, diverging around 0 or the weighted average).
 * Hierarchy from id / parent fields (one row per node) or from path fields on flat data
 * (encode.path = ['segment', 'player']). Click a group to drill in (breadcrumb to go back up);
 * click a leaf inside the current view to cross-filter.
 */
(function () {
  'use strict';
  var C = RK.chart;

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'treemap.level': '矩形树图层级', 'treemap.goUp': '点击标题返回上一级', 'treemap.zoomIn': '点击分组放大', 'treemap.drill': '点击下钻',
      'treemap.vsAvg': '{field}（较加权平均）', 'treemap.pctTotal': '占合计比例', 'treemap.pctOf': '占{name}比例'
    });
  }

  /**
   * Build a tree: [{id, name, value, metric, field, children[]}] + the single root's name (if any).
   * Parent values are always the sum of their children so the areas add up exactly.
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
      // a single root (e.g. the group) becomes the breadcrumb root; its children are the top level
      if (roots.length === 1 && roots[0].children.length) { rootName = roots[0].name; roots = roots[0].children; }
      (function depth(list, d) { list.forEach(function (n) { n.depth = d; delete n.raw; depth(n.children, d + 1); }); })(roots, 1);
      (function fin(list) {
        list.forEach(function (n) {
          fin(n.children);
          if (!n.children.length) { n.value = n.own; n.metric = n.rawMetric; }
        });
      })(roots);
    }
    // roll values up; metric of a parent = its own metric if given, else value-weighted average of children
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

  var OTHERS = /^(others?|other .+|rest of .+|all other.*)$/i;

  function leaves(list, out) {
    out = out || [];
    list.forEach(function (n) { if (n.children.length) leaves(n.children, out); else out.push(n); });
    return out;
  }

  RK.component({
    id: 'treemap',
    deps: ['echarts'],
    defaults: {
      encode: { id: 'id', parent: 'parent', name: 'name', value: 'value', color: null, path: null },
      colorBy: 'auto',         // auto | group | metric — auto = metric when encode.color is set
      colorMid: 0,             // metric midpoint: a number or 'avg' (value-weighted average)
      sort: 'desc',            // desc | asc — squarify order
      labels: 'auto',          // auto | name | value | none — auto = name + value (+ metric)
      showShare: false,        // add the % of total to leaf labels
      drill: true,             // click a group to zoom in; breadcrumb to go back
      rootName: null,          // breadcrumb root (defaults to the single root node or 'Total')
      highlight: null,         // leaf name(s) in the accent colour: filled (group colours) or outlined (metric colours)
      format: null,            // value format; defaults to the value field format
      metricFormat: null,      // metric format; defaults to the color field format
      legend: true             // colour scale legend (metric mode)
    },
    render: function (ctx) {
      var state = { ctx: ctx, tree: null, view: [], inst: null, nav: RK.util.h('nav.rk-treemap__crumbs', { 'aria-label': tr('treemap.level', 'Treemap level') }) };
      var base = C(function (c, inst) { state.ctx = c; state.inst = inst; return build(c, inst, state); }, {
        on: { click: function (p) { click(p, state); } }
      })(ctx);
      ctx.el.appendChild(state.nav);
      paintCrumbs(state);
      // keep the drill level across updates (cross-filter / global filters re-set the series)
      var update = base.update, destroy = base.destroy;
      base.update = function (c) {
        update(c);
        var id = state.view[state.view.length - 1];
        if (id && !chainOf(state.tree.roots, id).length) state.view = [];
        else if (id) zoom(state, id, true);
        paintCrumbs(state);
      };
      var alive = true;
      base.destroy = function () { alive = false; state.nav.remove(); destroy(); };
      // labels are fitted by measuring text: measure again once the web fonts have loaded
      if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(function () { if (alive) base.update(state.ctx); });
      // the colour legend is placed in pixels: re-layout when the block is resized
      var resize = base.resize, size = [base.chart.getWidth(), base.chart.getHeight()];
      base.resize = function () {
        resize();
        var w = base.chart.getWidth(), ht = base.chart.getHeight();
        if (Math.abs(w - size[0]) > 1 || Math.abs(ht - size[1]) > 1) { size = [w, ht]; base.update(state.ctx); }
      };
      return base;
    }
  });


  /* ---------------- drill-down + breadcrumb ---------------- */

  /** Nodes from the top level down to `id` ([] when not found). */
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

  /** Drill to a node id (null = back to the top) and redraw the breadcrumb. */
  function zoom(state, id, quiet) {
    var inst = state.inst;
    state.view = id ? chainOf(state.tree.roots, id).map(function (n) { return n.id; }) : [];
    if (id) inst.dispatchAction({ type: 'treemapRootToNode', seriesId: 'tm', targetNodeId: id });
    else {
      var root = null;
      try { root = inst.getModel().getSeriesByIndex(0).getData().tree.root; } catch (e) { /* ignore */ }
      if (root) inst.dispatchAction({ type: 'treemapRootToNode', seriesId: 'tm', targetNode: root });
    }
    if (!quiet) paintCrumbs(state);
  }

  /**
   * Breadcrumb: Root › Segment › … as HTML buttons (keyboard accessible). Kept out of the ECharts
   * option on purpose: any setOption — even graphic-only — resets the treemap's drill level.
   */
  function paintCrumbs(state) {
    var ctx = state.ctx, o = ctx.options, nav = state.nav, h = RK.util.h;
    nav.innerHTML = '';
    if (o.drill === false) return;
    var items = [{ id: null, name: o.rootName || state.tree.rootName || tr('total', 'Total') }].concat(state.view.map(function (id) {
      var ch = chainOf(state.tree.roots, id);
      return { id: id, name: ch.length ? ch[ch.length - 1].name : id };
    }));
    items.forEach(function (it, i) {
      var last = i === items.length - 1;
      if (i) nav.appendChild(h('span.rk-treemap__sep', { 'aria-hidden': 'true' }, '›'));
      nav.appendChild(last
        ? h('span.rk-treemap__crumb.is-current', { 'aria-current': 'location' }, it.name)
        : h('button.rk-treemap__crumb', { type: 'button', on: { click: function () { zoom(state, it.id); } } }, it.name));
    });
    var deep = state.tree.roots.some(function (n) { return n.children.length; });
    var hint = items.length > 1 ? tr('treemap.goUp', 'Click the header to go up') : (deep ? tr('treemap.zoomIn', 'Click a group to zoom in') : '');
    // the hint is optional: only when it fits next to the crumbs (they share the row with the colour legend)
    var room = parseFloat(nav.style.maxWidth) || Infinity, used = 0;
    items.forEach(function (it, i) { used += C.measure(it.name, '600 11px ' + ctx.theme.fontSans) + (i ? 20 : 0); });
    if (hint && used + 14 + C.measure(hint, '10px ' + ctx.theme.fontSans) <= room) nav.appendChild(h('span.rk-treemap__hint', hint));
  }

  function click(p, state) {
    var ctx = state.ctx;
    if (p.seriesId !== 'tm' || !p.data) return;
    var node = p.data, path = p.treePathInfo || [];
    var depth = path.length - 1, viewDepth = state.view.length;
    var drill = ctx.options.drill !== false;
    if (drill && node.id === state.view[viewDepth - 1]) { zoom(state, state.view[viewDepth - 2] || null); return; }   // header of the current view: up
    if (drill && node.children && node.children.length) { zoom(state, node.id); return; }
    // a leaf of another group: zoom to its ancestor just below the current view first
    if (drill && depth > viewDepth + 1) {
      var ch = chainOf(state.tree.roots, node.id);
      if (ch[viewDepth]) { zoom(state, ch[viewDepth].id); return; }
    }
    if (ctx.options.crossFilter !== false && node.field) ctx.select(node.field, node.name);   // 'name' etc. stay in this dataset (core)
  }

  function build(ctx, inst, state) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var tree = state.tree = hierarchy(ctx);
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var mfmt = o.metricFormat || (enc.color && ctx.fmtOf(enc.color)) || '0.0%';
    var byMetric = o.colorBy === 'metric' || (o.colorBy === 'auto' && !!enc.color);
    // growth-like metrics read as changes: show an explicit sign in cell labels
    var mcode = RK.format.presets[mfmt] || mfmt;
    var signed = typeof mcode === 'string' && mcode.indexOf(';') < 0 && /%$/.test(mcode) ? '+' + mcode + ';-' + mcode + ';' + mcode : mfmt;
    var hl = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    var maxDepth = 0;
    (function md(ls) { ls.forEach(function (n) { maxDepth = Math.max(maxDepth, n.depth); md(n.children); }); })(tree.roots);

    // colour scale for the metric
    var leafList = leaves(tree.roots);
    var mid = o.colorMid === 'avg'
      ? (function () { var w = 0, s = 0; leafList.forEach(function (n) { if (n.metric != null) { s += n.metric * n.value; w += n.value; } }); return w ? s / w : 0; })()
      : (+o.colorMid || 0);
    var dev = leafList.reduce(function (m, n) { return n.metric == null ? m : Math.max(m, Math.abs(n.metric - mid)); }, 0) || 1;
    var scale = RK.theme.diverging([mid - dev, mid + dev], mid);
    // metric mode outlines the target: accent-2, or ink when the diverging ramp runs close to accent-2
    var ring = (t.div || []).some(function (c) { return RK.theme.distance(c, t.accent2) < 70; }) ? t.ink : t.accent2;

    // selection (cross-filter) → dim leaves that are not selected
    function isDim(n) {
      var sel = n.field ? ctx.selected(n.field) : [];
      return sel.length > 0 && sel.indexOf(n.name) < 0;
    }
    // group colours; with a highlight no group may read like the accent2 target (tints extend instead of repeating)
    var pal = RK.theme.palette(hl.length ? { n: tree.roots.length } : { exclude: [], n: tree.roots.length });

    function toData(list, parentColor, depth) {
      return list.slice().sort(function (a, b) { return o.sort === 'asc' ? a.value - b.value : b.value - a.value; }).map(function (n, i) {
        var kids = n.children.length > 0;
        var color, isHl = hl.indexOf(n.name) >= 0;
        if (byMetric) color = kids ? (t.surface2 || t.surface) : scale(n.metric);
        else if (depth === 1) color = pal[tree.roots.indexOf(n) % pal.length];
        else if (isHl && !kids) color = t.accent2;                                  // the client stands out across groups
        else if (OTHERS.test(n.name)) color = RK.theme.mix(t.neutral, t.paper, 0.2); // residual buckets recede
        else color = RK.theme.mix(parentColor, t.paper, [0.0, 0.16, 0.3, 0.42][i % 4]);
        var fill = !kids && isDim(n) ? RK.theme.mix(color, t.paper, 0.72) : color;
        var item = {
          id: n.id, name: n.name, value: n.value, metric: n.metric, field: n.field,
          itemStyle: { color: fill, borderColor: isHl && byMetric ? ring : undefined, borderWidth: isHl && byMetric ? 2 : undefined },
          label: { color: RK.theme.textOn(fill) }   // readable on the fill in light and dark themes
        };
        if (kids) item.children = toData(n.children, color, depth + 1);
        return item;
      });
    }
    var data = toData(tree.roots, null, 1);
    var total = tree.total;

    /** Laid-out rect of a node (the formatter runs after the treemap layout): {width, height} or null. */
    function rectOf(p) {
      try { return inst.getModel().getSeriesByIndex(0).getData().getItemLayout(p.dataIndex); } catch (e) { return null; }
    }
    var F = { n: '600 11.5px ' + t.fontSans, v: '11px ' + t.fontNum, m: '10.5px ' + t.fontNum, up: '600 11px ' + t.fontSans };
    var ef = window.echarts && window.echarts.format;
    function ellipsize(s, w, font) { return ef && ef.truncateText ? ef.truncateText(String(s), w, font, '…') : String(s); }
    /** Name in <= 2 lines of width w (word wrap); null when a word does not fit. */
    function wrap2(name, w) {
      var words = String(name).split(' '), a = '', b = '';
      for (var i = 0; i < words.length; i++) {
        var tryA = a ? a + ' ' + words[i] : words[i];
        if (!b && C.measure(tryA, F.n) <= w) { a = tryA; continue; }
        b = b ? b + ' ' + words[i] : words[i];
      }
      return a && (!b || C.measure(b, F.n) <= w) ? (b ? [a, b] : [a]) : null;
    }
    /**
     * Leaf label fitted to its tile: figures are never cut — the share goes first, then the value, then the
     * whole label (the tooltip keeps the numbers); only the name may wrap / ellipsize. The highlighted
     * target keeps its full name whenever two lines allow it.
     */
    function leafLabel(p) {
      var d = p.data, r = rectOf(p), isHl = hl.indexOf(p.name) >= 0;
      var w = r ? r.width - 14 : Infinity, hgt = r ? r.height - 8 : Infinity;
      if (w < 24 || hgt < 13) return '';
      var vals = [];
      if (o.labels !== 'name') {
        var v0 = RK.format(d.value, fmt);
        var opts = o.showShare ? [v0 + '  ' + RK.format(total ? d.value / total : null, '0.0%'), v0] : [v0];
        var val = opts.filter(function (x) { return C.measure(x, F.v) <= w; })[0];
        if (val == null) return '';                                     // no room for the figure: no label
        vals.push('{v|' + C.richSafe(val) + '}');
        if (byMetric && d.metric != null && o.labels !== 'value') {
          var mt = RK.format(d.metric, signed);
          if (C.measure(mt, F.m) <= w) vals.push('{m|' + C.richSafe(mt) + '}');
        }
      }
      var nameLines = C.measure(p.name, F.n) <= w ? [p.name] : null;
      var room = Math.floor((hgt - 14 * vals.length) / 15);              // name lines that fit above the figures
      if (!nameLines && room >= 2) nameLines = wrap2(p.name, w);
      if (!nameLines && isHl && Math.floor(hgt / 15) >= 2 && wrap2(p.name, w)) {
        nameLines = wrap2(p.name, w);                                   // the target's full name beats its figure
        while (vals.length && Math.floor((hgt - 14 * vals.length) / 15) < nameLines.length) vals.pop();
        room = Math.floor((hgt - 14 * vals.length) / 15);
      }
      if (!nameLines) nameLines = [ellipsize(p.name, w, F.n)];
      if (room < nameLines.length) {
        if (vals.length > 1) { vals.pop(); room = Math.floor((hgt - 14 * vals.length) / 15); }
        if (room < nameLines.length) nameLines = room >= 1 ? [ellipsize(p.name, w, F.n)] : [];
        // a flat tile: the target keeps its name (the figure is in the tooltip); a bare figure would be
        // anonymous, so a peer shows nothing (hover still has it)
        if (!nameLines.length) return isHl ? '{n|' + C.richSafe(ellipsize(p.name, w, F.n)) + '}' : '';
      }
      return nameLines.map(function (l) { return '{n|' + C.richSafe(l) + '}'; }).concat(vals).join('\n');
    }
    /** Group header: name + value + share; drops the share, then the value; only the name may ellipsize. */
    function upperText(p) {
      var r = rectOf(p), w = r ? r.width - 10 : Infinity;
      var v = RK.format(p.value, fmt), sh = total ? RK.format(p.value / total, '0%') : null;
      var opts = [p.name + '   ' + v + (sh ? '  ·  ' + sh : ''), p.name + '   ' + v, p.name];
      for (var i = 0; i < opts.length; i++) if (C.measure(opts[i], F.up) <= w) return opts[i];
      return w > 24 ? ellipsize(p.name, w, F.up) : '';
    }
    var rich = {
      n: { fontSize: 11.5, fontWeight: 600, lineHeight: 15, fontFamily: t.fontSans },
      v: { fontSize: 11, lineHeight: 14, fontFamily: t.fontNum, opacity: 0.85 },
      m: { fontSize: 10.5, lineHeight: 14, fontFamily: t.fontNum, opacity: 0.85 }
    };

    var showLegend = byMetric && o.legend !== false;
    var top = 28;
    var levels = [
      { itemStyle: { borderWidth: 0, gapWidth: 3, borderColor: t.paper } },
      { itemStyle: { borderWidth: maxDepth > 1 ? 2 : 0, gapWidth: 1.5, borderColor: t.paper },
        upperLabel: { show: maxDepth > 1, height: 22 } }
    ];
    for (var d = 2; d <= maxDepth; d++) levels.push({ itemStyle: { borderWidth: d < maxDepth ? 1 : 0, gapWidth: 1, borderColor: t.paper }, upperLabel: { show: d < maxDepth, height: 18 } });

    var series = {
      id: 'tm', type: 'treemap', name: o.rootName || tree.rootName || tr('total', 'Total'),
      left: 0, right: 0, top: top, bottom: 0,
      roam: false, nodeClick: false, squareRatio: 0.5 * (1 + Math.sqrt(5)),
      leafDepth: null, visibleMin: 0, childrenVisibleMin: 0,
      sort: o.sort === 'asc' ? 'asc' : 'desc',
      animationDurationUpdate: 650, animationEasing: 'cubicOut',
      breadcrumb: {
        show: false          // ECharts' crumb tracks the node under the chart centre; ours tracks the drill path
      },
      label: {
        // fitted by leafLabel(): ECharts' own truncation would cut figures mid-number
        show: o.labels !== 'none', position: 'insideTopLeft', padding: [4, 6], overflow: 'none',
        formatter: leafLabel, rich: rich, fontFamily: t.fontSans
      },
      // cells too small for a legible label stay clean (the tooltip still has the numbers)
      labelLayout: function (p) {
        var r = p.rect;
        if (r && (r.width < 38 || r.height < 22)) return { x: -9999, y: -9999 };
        return {};
      },
      upperLabel: {
        show: false, height: 22, padding: [0, 4], color: t.ink, fontSize: 11, fontWeight: 600, fontFamily: t.fontSans, overflow: 'none',
        formatter: upperText
      },
      itemStyle: { borderColor: t.paper, borderWidth: 0, gapWidth: 1 },
      emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 }, upperLabel: { show: true }, label: { show: o.labels !== 'none' } },
      levels: levels,
      data: data
    };

    // colour legend (metric mode): top-left (house style) — title, ramp, low / mid / high ticks; the drill
    // breadcrumb follows it on the same row
    var graphic = [];
    var W = inst.getWidth(), navLeft = 0;
    if (showLegend) {
      var lab = o.colorMid === 'avg' ? tr('treemap.vsAvg', '{field} vs. weighted avg.', { field: ctx.title(enc.color) }) : ctx.title(enc.color);
      var labW = C.measure(lab, '11px ' + t.fontSans), lw = Math.min(150, W * 0.22), lx = Math.ceil(labW + 10);
      var stops = (t.div || []).map(function (c, i, a) { return { offset: i / (a.length - 1), color: c }; });
      var tick = function (x, v, align) {
        return { type: 'text', x: x, y: 12, silent: true, style: { text: RK.format(v, mfmt), fill: t.ink3, font: '10px ' + t.fontNum, textAlign: align, textVerticalAlign: 'top' } };
      };
      graphic = [
        { type: 'text', x: 0, y: 6, silent: true, style: { text: lab, fill: t.ink2, font: '11px ' + t.fontSans, textAlign: 'left', textVerticalAlign: 'middle' } },
        { type: 'rect', x: lx, y: 2, silent: true, shape: { width: lw, height: 8, r: 1 }, style: { fill: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: stops } } },
        tick(lx, mid - dev, 'left'), tick(lx + lw / 2, mid, 'center'), tick(lx + lw, mid + dev, 'right')
      ];
      navLeft = lx + lw + 28;
    }
    if (state.nav) { state.nav.style.left = navLeft + 'px'; state.nav.style.maxWidth = Math.max(80, W - navLeft - 4) + 'px'; }

    return {
      tooltip: {
        trigger: 'item', confine: true,
        formatter: function (p) {
          var d = p.data;
          if (!d || p.seriesId !== 'tm') return '';
          var trail = (p.treePathInfo || []).slice(1).map(function (x) { return x.name; });
          var parentVal = p.treePathInfo && p.treePathInfo.length > 2 ? p.treePathInfo[p.treePathInfo.length - 2].value : total;
          var rows = [
            { color: d.itemStyle && d.itemStyle.color, label: ctx.title(enc.value), value: RK.format(d.value, fmt), bold: true },
            { label: tr('treemap.pctTotal', '% of total'), value: RK.format(total ? d.value / total : null, '0.0%') }
          ];
          if (trail.length > 1) rows.push({ label: tr('treemap.pctOf', '% of {name}', { name: trail[trail.length - 2] }), value: RK.format(parentVal ? d.value / parentVal : null, '0.0%') });
          if (enc.color && d.metric != null) rows.push({ label: ctx.title(enc.color), value: RK.format(d.metric, mfmt) });
          return C.tip(trail.join(' › ') || d.name, rows, d.children && d.children.length && o.drill ? tr('treemap.drill', 'Click to drill down') : null);
        }
      },
      graphic: graphic,
      series: [series]
    };
  }
})();
