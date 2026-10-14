/*!
 * RK component: sankey — flows between stages: P&L walk (segments -> revenue -> gross profit ->
 * EBITDA -> net income), revenue by segment -> region, sources & uses. One row per link
 * (source, target, value); node totals, stages and label placement are derived here.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /** Label width via the shared canvas measure; +7% because the canvas may still measure a fallback face. */
  function measure(text, font) { return C.measure(text, font) * 1.07; }

  /** Theme token name ('accent2', 'neg', 'cat3' ...) or literal CSS colour -> colour. */
  function tokenColor(t, v) {
    if (!v) return null;
    if (typeof t[v] === 'string' && t[v]) return t[v];
    var m = /^cat(\d+)$/.exec(v);
    if (m) return t.cat[(+m[1] - 1) % t.cat.length];
    return v;
  }

  /** Rich-text safe label (ECharts treats {…|…} as style markup). */
  function safe(s) { return String(s == null ? '' : s).replace(/[{}|]/g, ' '); }

  /**
   * Nodes in first-seen order with in/out totals and a stage (column) index that mirrors
   * ECharts' nodeAlign: longest path from a source ('left'), to a sink ('right'), or sinks
   * pushed to the last column ('justify').
   */
  function graphOf(links, align) {
    var nodes = new Map();
    function node(name) {
      if (!nodes.has(name)) nodes.set(name, { name: name, inV: 0, outV: 0, outs: [], ins: [], depth: 0, height: 0 });
      return nodes.get(name);
    }
    links.forEach(function (l) {
      var s = node(l.source), d = node(l.target);
      s.outV += l.value; d.inV += l.value;
      s.outs.push(d); d.ins.push(s);
    });
    var list = Array.from(nodes.values()), n = list.length;
    // longest path relaxation, bounded by n passes (guards against cycles)
    for (var pass = 0; pass < n; pass++) {
      var changed = false;
      list.forEach(function (a) {
        a.outs.forEach(function (b) { if (b.depth < a.depth + 1 && a.depth + 1 < n) { b.depth = a.depth + 1; changed = true; } });
        a.ins.forEach(function (b) { if (b.height < a.height + 1 && a.height + 1 < n) { b.height = a.height + 1; changed = true; } });
      });
      if (!changed) break;
    }
    var maxDepth = list.reduce(function (m, a) { return Math.max(m, a.depth); }, 0);
    list.forEach(function (a) {
      a.value = Math.max(a.inV, a.outV);
      if (align === 'right') a.depth = maxDepth - a.height;
      else if (align === 'justify' && !a.outs.length) a.depth = maxDepth;
    });
    return { list: list, byName: nodes, maxDepth: maxDepth };
  }

  /**
   * Toggle a node in this block's selection. A node matches links at either end (source OR target);
   * the selection is scoped by crossFilterScope (default 'dataset': 'source' / 'target' are generic names).
   */
  function selectNode(ctx, value) {
    var enc = ctx.enc;
    if (ctx.options.crossFilter === false || value == null || !enc.source || !enc.target) return;
    ctx.select(enc.source, value, { either: enc.target, scope: ctx.options.filterScope || undefined });
  }

  RK.component({
    id: 'sankey',
    deps: ['echarts'],
    defaults: {
      encode: { source: 'source', target: 'target', value: 'value' },
      orient: 'horizontal',     // horizontal | vertical
      nodeAlign: 'left',        // left | right | justify (ECharts nodeAlign)
      nodeOrder: 'data',        // data (keep row order, profit above cost) | auto (minimise crossings)
      colorBy: 'stage',         // stage (ordinal ramp by column) | node (categorical)
      nodeColors: {},           // {nodeName: colour or theme token, e.g. 'accent2' | 'neg' | '#8c3b4a'}
      costNodes: [],            // node names drawn as costs / leakage (theme 'neg')
      highlight: null,          // node name(s) drawn in accent2 (e.g. 'Net income')
      linkColor: 'source',      // source | target | gradient | neutral
      linkOpacity: 0.3,
      nodeWidth: 12,
      nodeGap: 14,
      labels: true,
      labelValues: true,        // formatted value under each node name
      percentOf: null,          // null | 'max' | node name -> "% of" (e.g. margin vs. 'Revenue')
      focus: 'adjacency',       // hover emphasis: adjacency | trajectory | none
      draggable: false,
      format: null,
      crossFilter: true,
      crossFilterScope: 'dataset',  // dataset | global — reach of the click-to-filter selection
      filterScope: null         // deprecated alias of crossFilterScope
    },
    render: C(function (ctx) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var vert = o.orient === 'vertical';
      // translucent links read darker on a dark paper: lift them in dark themes
      if (t.dark) o = util.merge({}, o, { linkOpacity: Math.min(0.6, o.linkOpacity * 1.3) });
      var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';

      // aggregate duplicate source -> target rows, drop self-loops / empty flows (ECharts rejects cycles)
      var agg = new Map();
      ctx.rows.forEach(function (r) {
        var s = r[enc.source], d = r[enc.target], v = r[enc.value];
        if (s == null || d == null || s === d || !util.isNum(v) || v <= 0) return;
        var k = s + '\u0001' + d;
        if (!agg.has(k)) agg.set(k, { source: String(s), target: String(d), value: 0 });
        agg.get(k).value += v;
      });
      var links = Array.from(agg.values());
      var g = graphOf(links, o.nodeAlign);
      var costs = [].concat(o.costNodes || []), hi = o.highlight == null ? [] : [].concat(o.highlight);
      var isCost = function (n) { return costs.indexOf(n) >= 0; };

      // column order: keep first-seen order but push costs below profit lines
      var nodes = g.list.slice();
      if (o.nodeOrder !== 'auto') {
        nodes = nodes.map(function (n, i) { return { n: n, i: i }; })
          .sort(function (a, b) { return (isCost(a.n.name) - isCost(b.n.name)) || (a.i - b.i); })
          .map(function (x) { return x.n; });
      }

      // reference for "% of": largest node or a named node
      var refNode = null;
      if (o.percentOf === 'max') refNode = g.list.reduce(function (m, n) { return !m || n.value > m.value ? n : m; }, null);
      else if (o.percentOf) refNode = g.byName.get(o.percentOf) || null;

      // colours
      var stageRamp = RK.theme.ramp(t.ord.slice(0, 4));   // ordinal ramp (dark -> light) by column
      // colorBy 'node': categorical colours kept clear of the highlight, the cost colour and explicit node colours
      var custom = {}, free = [];
      nodes.forEach(function (n) {
        var c = tokenColor(t, (o.nodeColors || {})[n.name]);
        if (c) custom[n.name] = c;
        else if (hi.indexOf(n.name) < 0 && !isCost(n.name)) free.push(n.name);
      });
      var pal = RK.theme.palette({ n: free.length, exclude: [t.accent2, costs.length ? t.neg : null].concat(Object.keys(custom).map(function (k) { return custom[k]; })) });
      function nodeColor(n) {
        if (custom[n.name]) return custom[n.name];
        if (hi.indexOf(n.name) >= 0) return t.accent2;
        if (isCost(n.name)) return t.neg;
        if (o.colorBy === 'node') return pal[free.indexOf(n.name)];
        return stageRamp(g.maxDepth ? n.depth / g.maxDepth : 0);
      }

      // selection (click-to-filter): keep selected nodes and their neighbours in focus
      var sel = ctx.selected(enc.source);
      var active = null;
      if (sel.length) {
        active = new Set();
        sel.forEach(function (name) {
          var n = g.byName.get(name);
          if (!n) return;
          active.add(n.name);
          n.outs.concat(n.ins).forEach(function (m) { active.add(m.name); });
        });
      }

      // label metrics: first column labels sit outside-left, everything else to the right
      var showLabels = o.labels !== false;
      var nameFont = '600 11px ' + t.fontSans, valFont = '10.5px ' + t.fontNum;
      var top = vert ? (showLabels ? 34 : 6) : 10, bottom = vert ? (showLabels ? 34 : 6) : 10;
      function valueText(n) {
        var s = RK.format(n.value, fmt);
        if (refNode && refNode.value && refNode !== n) s += '  ' + RK.format(n.value / refNode.value, '0.0%');
        return s;
      }

      // Estimate the node layout (same ky rule as ECharts) to find columns where two-line labels
      // would collide; those nodes get a single-line "Name  value" label instead.
      var inline = new Set();
      if (showLabels && o.labelValues && !vert) {
        var avail = Math.max(60, (ctx.el.clientHeight || 320) - top - bottom);
        var cols = util.groupBy(nodes, function (n) { return n.depth; });
        var ky = Infinity;
        cols.forEach(function (col) {
          var sum = col.reduce(function (s, n) { return s + n.value; }, 0);
          if (sum > 0) ky = Math.min(ky, (avail - (col.length - 1) * o.nodeGap) / sum);
        });
        if (isFinite(ky)) {
          cols.forEach(function (col) {
            var y = 0, centres = col.map(function (n) { var hgt = Math.max(1, n.value * ky), c = y + hgt / 2; y += hgt + o.nodeGap; return c; });
            col.forEach(function (n, i) {
              var near = Math.min(i > 0 ? centres[i] - centres[i - 1] : Infinity, i < col.length - 1 ? centres[i + 1] - centres[i] : Infinity);
              if (near < 30) inline.add(n.name);
            });
          });
        }
      }
      function labelWidth(n) {
        var w = measure(n.name, nameFont);
        if (o.labelValues) w = inline.has(n.name) ? w + 8 + measure(valueText(n), valFont) : Math.max(w, measure(valueText(n), valFont));
        return Math.ceil(w);
      }
      var firstW = 0, lastW = 0;
      if (showLabels) {
        nodes.forEach(function (n) {
          if (n.depth === 0) firstW = Math.max(firstW, labelWidth(n));
          if (n.depth === g.maxDepth || (!n.outs.length && o.nodeAlign !== 'left')) lastW = Math.max(lastW, labelWidth(n));
        });
        // left-aligned sinks in the last column also need room
        nodes.forEach(function (n) { if (n.depth === g.maxDepth) lastW = Math.max(lastW, labelWidth(n)); });
      }
      var labelPad = 8;

      var data = nodes.map(function (n) {
        var c = nodeColor(n);
        var dim = active && !active.has(n.name);
        var first = n.depth === 0 && g.maxDepth > 0;
        return {
          name: n.name,
          depth: n.depth,
          value: n.value,
          itemStyle: { color: c, borderWidth: 0, opacity: dim ? 0.25 : 1 },
          label: {
            show: showLabels,
            position: vert ? (first ? 'top' : 'bottom') : (first ? 'left' : 'right'),
            opacity: dim ? 0.45 : 1
          }
        };
      });

      var linkData = links.map(function (l) {
        var on = !active || sel.indexOf(l.source) >= 0 || sel.indexOf(l.target) >= 0;
        var ls = { opacity: active ? (on ? Math.min(0.75, o.linkOpacity * 1.9) : o.linkOpacity * 0.3) : o.linkOpacity };
        return { source: l.source, target: l.target, value: l.value, lineStyle: ls };
      });

      var linkColor = o.linkColor === 'neutral' ? t.neutral : (o.linkColor || 'source');

      return {
        tooltip: {
          trigger: 'item',
          formatter: function (p) {
            if (p.dataType === 'edge') {
              var d = p.data, src = g.byName.get(d.source);
              return C.tip(d.source + '  →  ' + d.target, [
                { label: ctx.title(enc.value), value: RK.format(d.value, fmt), bold: true },
                { label: '% of ' + d.source, value: src && src.outV ? RK.format(d.value / src.outV, '0.0%') : RK.format(null) },
                { label: '% of ' + d.target, value: RK.format(d.value / (g.byName.get(d.target).inV || NaN), '0.0%') }
              ]);
            }
            var n = g.byName.get(p.name);
            if (!n) return '';
            var rows = [];
            if (n.ins.length) rows.push({ label: 'Inflow', value: RK.format(n.inV, fmt) });
            if (n.outs.length) rows.push({ label: 'Outflow', value: RK.format(n.outV, fmt) });
            if (!n.ins.length || !n.outs.length) rows.push({ label: ctx.title(enc.value), value: RK.format(n.value, fmt), bold: true });
            if (refNode && refNode !== n) rows.push({ label: '% of ' + refNode.name, value: RK.format(n.value / refNode.value, '0.0%') });
            return C.tip(n.name, rows, isCost(n.name) ? 'Cost / deduction' : null);
          }
        },
        series: [{
          id: 'sankey',
          type: 'sankey',
          orient: vert ? 'vertical' : 'horizontal',
          left: vert ? 8 : (showLabels ? firstW + labelPad + 4 : 4),
          right: vert ? 8 : (showLabels ? lastW + labelPad + 4 : 4),
          top: top,
          bottom: bottom,
          nodeWidth: o.nodeWidth,
          nodeGap: o.nodeGap,
          nodeAlign: o.nodeAlign,
          layoutIterations: o.nodeOrder === 'auto' ? 32 : 0,
          draggable: !!o.draggable,
          data: data,
          links: linkData,
          lineStyle: { color: linkColor, curveness: 0.5, opacity: o.linkOpacity },
          label: {
            distance: labelPad - 2,
            color: t.ink,
            fontSize: 11,
            lineHeight: 14,
            fontFamily: t.fontSans,
            formatter: function (p) {
              var n = g.byName.get(p.name);
              if (!n) return '';
              if (!o.labelValues) return '{n|' + safe(n.name) + '}';
              return '{n|' + safe(n.name) + '}' + (inline.has(n.name) ? '  ' : '\n') + '{v|' + safe(valueText(n)) + '}';
            },
            rich: {
              n: { fontWeight: 600, fontSize: 11, color: t.ink, fontFamily: t.fontSans, lineHeight: 14, textBorderColor: t.paper, textBorderWidth: 3 },
              v: { fontSize: 10.5, color: t.ink2, fontFamily: t.fontNum, lineHeight: 13, textBorderColor: t.paper, textBorderWidth: 3 }
            }
          },
          emphasis: {
            focus: o.focus === 'none' ? 'none' : (o.focus || 'adjacency'),
            lineStyle: { opacity: Math.min(0.8, o.linkOpacity * 2.2) },
            label: { show: showLabels }
          },
          blur: { itemStyle: { opacity: 0.25 }, lineStyle: { opacity: 0.06 }, label: { opacity: 0.5 } },
          animationDuration: 900,
          animationEasing: 'cubicOut'
        }]
      };
    }, {
      rebuildOnResize: true,     // label crowding is estimated from the container height
      on: {
        click: function (p, ctx) {
          if (p.dataType === 'node') selectNode(ctx, p.name);
        }
      }
    })
  });
})();
