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
      var pal = RK.theme.palette({ n: free.length, exclude: [t.accent2, costs.length ? t.neg : null, costs.length ? t.ref : null].concat(Object.keys(custom).map(function (k) { return custom[k]; })) });
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

      // ---- labels: plan every label against the real node layout (ECharts' own rules) so names and
      // values never run into the next column. Each node tries progressively more compact variants
      // (name / value  % -> name / value / % -> name / value -> wrapped name / value -> name) and is
      // hidden (tooltip only) when nothing fits.
      var showLabels = o.labels !== false;
      var nameFont = '600 11px ' + t.fontSans, valFont = '10.5px ' + t.fontNum;
      var top = vert ? (showLabels ? 34 : 6) : 10, bottom = vert ? (showLabels ? 34 : 6) : 10;
      var labelPad = 8, labelDist = labelPad - 2, LH = 14;
      function valueStr(n) { return RK.format(n.value, fmt); }
      function pctStr(n) { return refNode && refNode.value && refNode !== n ? RK.format(n.value / refNode.value, '0.0%') : null; }
      function valueText(n) { var p = pctStr(n); return valueStr(n) + (p ? '  ' + p : ''); }
      function segW(seg) { return measure(seg[1], seg[0] === 'n' ? nameFont : valFont); }
      function variant(lines) {
        var w = 0;
        lines.forEach(function (ln) { var lw = 0; ln.forEach(function (sg, i) { lw += segW(sg) + (i ? measure('  ', valFont) : 0); }); w = Math.max(w, lw); });
        return { lines: lines, w: Math.ceil(w), h: lines.length * LH };
      }
      /** Greedy word wrap of a node name into at most maxLines lines no wider than maxW (null if a word does not fit). */
      function wrapName(name, maxW, maxLines) {
        var words = String(name).split(/\s+/), lines = [], cur = '';
        for (var i = 0; i < words.length; i++) {
          var next = cur ? cur + ' ' + words[i] : words[i];
          if (measure(next, nameFont) <= maxW || !cur) cur = next;
          else { lines.push(cur); cur = words[i]; }
        }
        if (cur) lines.push(cur);
        if (lines.length > maxLines || lines.some(function (l) { return measure(l, nameFont) > maxW + 0.5; })) return null;
        return lines;
      }
      /** Candidate label variants, most informative first. crowded: neighbours too close for two lines. */
      function variants(n, maxW, crowded) {
        var name = n.name, out = [];
        if (!o.labelValues) {
          out.push(variant([[['n', name]]]));
        } else {
          var v = valueStr(n), p = pctStr(n);
          var full = p ? v + '  ' + p : v;
          var stacked = variant([[['n', name]], [['v', full]]]), inl = variant([[['n', name], ['v', full]]]);
          if (crowded) out.push(inl, stacked); else out.push(stacked, inl);
          var wv = maxW ? wrapName(name, maxW, 2) : null, wl = wv && wv.length > 1 ? wv.map(function (l) { return [['n', l]]; }) : null;
          if (p) {
            out.push(variant([[['n', name]], [['v', v]], [['v', p]]]));
            if (wl) out.push(variant(wl.concat([[['v', full]]])), variant(wl.concat([[['v', v]], [['v', p]]])));
            var inlV = variant([[['n', name], ['v', v]]]), stV = variant([[['n', name]], [['v', v]]]);
            if (crowded) out.push(inlV, stV); else out.push(stV, inlV);
          }
          if (wl) out.push(variant(wl.concat([[['v', v]]])));
        }
        if (maxW) {
          var wn = wrapName(name, maxW, 2);
          if (wn && wn.length > 1) out.push(variant(wn.map(function (l) { return [['n', l]]; })));
        }
        if (o.labelValues) out.push(variant([[['n', name]]]));
        return out;
      }

      var plan = new Map(), firstW = 0, lastW = 0;
      if (showLabels && !vert) {
        var W = ctx.el.clientWidth || 600, Hh = ctx.el.clientHeight || 320;
        var availH = Math.max(60, Hh - top - bottom);
        // node heights / y positions: same rule as ECharts (min ky over columns, stacked from the top, pushed up at the bottom)
        var cols = util.groupBy(nodes, function (n) { return n.depth; });
        var ky = Infinity;
        cols.forEach(function (col) {
          var sum = col.reduce(function (s, n) { return s + n.value; }, 0);
          if (sum > 0) ky = Math.min(ky, (availH - (col.length - 1) * o.nodeGap) / sum);
        });
        if (!isFinite(ky)) ky = 0;
        var geo = new Map();
        cols.forEach(function (col) {
          var y = 0;
          col.forEach(function (n) { var hgt = n.value * ky; geo.set(n.name, { y: y, h: hgt }); y += hgt + o.nodeGap; });
          var over = y - o.nodeGap - availH;
          if (over > 0) {      // ECharts pushes overflowing columns back up from the bottom edge
            var lim = availH;
            for (var ci = col.length - 1; ci >= 0; ci--) {
              var gg = geo.get(col[ci].name);
              if (gg.y + gg.h > lim) gg.y = lim - gg.h;
              lim = gg.y - o.nodeGap;
            }
          }
          col.forEach(function (n, i) {
            var gg = geo.get(n.name), c = gg.y + gg.h / 2;
            var prev = i > 0 ? geo.get(col[i - 1].name) : null, nxt = i < col.length - 1 ? geo.get(col[i + 1].name) : null;
            gg.cy = top + c;
            gg.near = Math.min(prev ? c - (prev.y + prev.h / 2) : Infinity, nxt ? (nxt.y + nxt.h / 2) - c : Infinity);
          });
        });
        var placed = [];
        function hits(b) {
          return placed.some(function (p) { return b.x0 < p.x1 + 3 && b.x1 > p.x0 - 3 && b.y0 < p.y1 + 1 && b.y1 > p.y0 - 1; });
        }
        // outer columns first: their widths fix the plot box (left / right margins); cap them so the
        // middle keeps room (long first-column names wrap onto two lines instead)
        var sideCap = Math.max(90, Math.round(W * (W < 900 ? 0.19 : 0.24)));
        function pickSide(n, left) {
          var gg = geo.get(n.name), list = variants(n, sideCap, gg.near < 30), pick = null;
          for (var i = 0; i < list.length && !pick; i++) {
            var vt = list[i], b = { x0: 0, x1: 1, y0: gg.cy - vt.h / 2, y1: gg.cy + vt.h / 2 };
            if (vt.w <= sideCap && !hits(b)) pick = vt;
          }
          if (!pick) {          // nothing fits the cap: narrowest variant that does not collide
            list.slice().sort(function (a, b2) { return a.w - b2.w; }).some(function (vt) {
              var b = { x0: 0, x1: 1, y0: gg.cy - vt.h / 2, y1: gg.cy + vt.h / 2 };
              if (!hits(b)) { pick = vt; return true; }
              return false;
            });
          }
          if (pick) { plan.set(n.name, pick); placed.push({ x0: 0, x1: 1, y0: gg.cy - pick.h / 2, y1: gg.cy + pick.h / 2, side: left ? 'L' : 'R' }); }
          else plan.set(n.name, null);
          return pick ? pick.w : 0;
        }
        var lastCol = g.maxDepth > 0 ? (cols.get(g.maxDepth) || []) : [];
        (g.maxDepth > 0 ? (cols.get(0) || []) : []).forEach(function (n) { firstW = Math.max(firstW, pickSide(n, true)); });
        placed = [];
        lastCol.forEach(function (n) { lastW = Math.max(lastW, pickSide(n, false)); });
        if (!g.maxDepth) nodes.forEach(function (n) { lastW = Math.max(lastW, pickSide(n, false)); });
        // now the plot box is known: x positions as ECharts computes them
        var left = firstW + labelPad + 4, right = lastW + labelPad + 4;
        var kx = g.maxDepth ? (W - left - right - o.nodeWidth) / g.maxDepth : 0;
        nodes.forEach(function (n) { var gg = geo.get(n.name); gg.x = left + n.depth * kx; });
        // real label boxes for the outer columns
        placed = [];
        nodes.forEach(function (n) {
          var vt = plan.get(n.name), gg = geo.get(n.name);
          if (!vt || (n.depth !== 0 && n.depth !== g.maxDepth) || (n.depth === 0 && !g.maxDepth)) return;
          var x0 = n.depth === 0 && g.maxDepth ? gg.x - labelDist - vt.w : gg.x + o.nodeWidth + labelDist;
          placed.push({ x0: x0, x1: x0 + vt.w, y0: gg.cy - vt.h / 2, y1: gg.cy + vt.h / 2 });
        });
        nodes.forEach(function (n) {
          var gg = geo.get(n.name);
          placed.push({ x0: gg.x, x1: gg.x + o.nodeWidth, y0: top + gg.y, y1: top + gg.y + Math.max(1, gg.h), node: n.name });
        });
        // interior columns, right to left: each label must clear every later node and every placed label
        for (var d = g.maxDepth - 1; d >= 1; d--) {
          (cols.get(d) || []).forEach(function (n) {
            var gg = geo.get(n.name), x0 = gg.x + o.nodeWidth + labelDist;
            // room to the next obstacle on this label's rows sets the wrap width
            var room = W - 2 - x0;
            placed.forEach(function (p) {
              if (p.node === n.name || p.x0 < x0) return;
              if (p.y0 < gg.cy + LH && p.y1 > gg.cy - LH) room = Math.min(room, p.x0 - 3 - x0);
            });
            var list = variants(n, Math.max(24, room), gg.near < 30), pick = null;
            for (var i = 0; i < list.length && !pick; i++) {
              var vt = list[i], b = { x0: x0, x1: x0 + vt.w, y0: gg.cy - vt.h / 2, y1: gg.cy + vt.h / 2 };
              if (b.x1 <= W - 2 && !placed.some(function (p) { return p.node !== n.name && b.x0 < p.x1 + 3 && b.x1 > p.x0 - 3 && b.y0 < p.y1 + 1 && b.y1 > p.y0 - 1; })) pick = vt;
            }
            plan.set(n.name, pick);
            if (pick) placed.push({ x0: x0, x1: x0 + pick.w, y0: gg.cy - pick.h / 2, y1: gg.cy + pick.h / 2 });
          });
        }
      } else if (showLabels) {
        nodes.forEach(function (n) {
          plan.set(n.name, variant(o.labelValues ? [[['n', n.name]], [['v', valueText(n)]]] : [[['n', n.name]]]));
        });
      }
      function labelText(n) {
        var vt = plan.get(n.name);
        if (!vt) return '';
        return vt.lines.map(function (ln) {
          return ln.map(function (sg) { return '{' + sg[0] + '|' + C.richSafe(sg[1]) + '}'; }).join('  ');
        }).join('\n');
      }

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
            show: showLabels && !!plan.get(n.name),
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
            distance: labelDist,
            color: t.ink,
            fontSize: 11,
            lineHeight: 14,
            fontFamily: t.fontSans,
            formatter: function (p) {
              var n = g.byName.get(p.name);
              return n ? labelText(n) : '';
            },
            rich: {
              n: { fontWeight: 600, fontSize: 11, color: t.ink, fontFamily: t.fontSans, lineHeight: LH, textBorderColor: t.paper, textBorderWidth: 2 },
              v: { fontSize: 10.5, color: t.ink2, fontFamily: t.fontNum, lineHeight: LH, textBorderColor: t.paper, textBorderWidth: 2 }
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
      rebuildOnResize: true,     // labels are planned against the layout of the current container size
      on: {
        click: function (p, ctx) {
          if (p.dataType === 'node') selectNode(ctx, p.name);
        }
      }
    })
  });
})();
