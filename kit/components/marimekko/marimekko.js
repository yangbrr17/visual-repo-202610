/*!
 * RK component: marimekko — variable-width 100% stacked columns (market map). Column width = segment
 * size (share of the total market), stack = each player's share of that segment. Cells are labelled
 * with player + share where they fit; segment names and totals sit above the columns.
 * Built on an ECharts custom series (one per player, so the legend and hover focus work natively).
 */
(function () {
  'use strict';
  var C = RK.chart;
  var OTHERS = /^(others?|other .+|rest of .+|all other.*)$/i;

  /** Generic fields ('type', 'category' …) cross-filter only this block's dataset; business dimensions stay global. */
  var GENERIC = /^(type|kind|source|target|step|stage|metric|measure|category|group|series|label|name|id|parent|key|value|x|y)$/i;

  /** Segments (columns) and players (stacks) with cumulative geometry in [0, 1] x [0, 1]. */
  function model(ctx) {
    var o = ctx.options, enc = ctx.enc;
    var othersName = o.othersLabel;
    function num(v) { return v == null || v === '' || !isFinite(v) ? null : +v; }
    function collect(rows) {
      var segs = new Map(), totals = new Map();
      rows.forEach(function (r) {
        var x = r[enc.x], s = r[enc.series], v = num(r[enc.value]);
        if (x == null || x === '' || s == null || v == null || v <= 0) return;
        x = String(x); s = OTHERS.test(String(s)) ? othersName : String(s);
        if (!segs.has(x)) segs.set(x, new Map());
        var m = segs.get(x);
        m.set(s, (m.get(s) || 0) + v);
        totals.set(s, (totals.get(s) || 0) + v);
      });
      return { segs: segs, totals: totals };
    }
    var all = collect(ctx.allRows), cur = collect(ctx.rows);

    // players: overall rank on the unfiltered data (stable colours / order); tail beyond maxSeries -> Others
    var ranked = Array.from(all.totals.keys()).filter(function (p) { return p !== othersName; })
      .sort(function (a, b) { return all.totals.get(b) - all.totals.get(a); });
    var keep = o.maxSeries ? ranked.slice(0, o.maxSeries) : ranked;
    var players = keep.slice();
    var hasOthers = all.totals.has(othersName) || ranked.length > keep.length;
    if (hasOthers) players.push(othersName);
    function bucket(p) { return keep.indexOf(p) >= 0 ? p : othersName; }

    var segNames = Array.from(cur.segs.keys());
    var segs = segNames.map(function (x) {
      var vals = new Map();
      cur.segs.get(x).forEach(function (v, p) { var b = bucket(p); vals.set(b, (vals.get(b) || 0) + v); });
      var total = 0; vals.forEach(function (v) { total += v; });
      return { name: x, vals: vals, total: total };
    });
    if (o.sort === 'desc') segs.sort(function (a, b) { return b.total - a.total; });
    else if (o.sort === 'asc') segs.sort(function (a, b) { return a.total - b.total; });
    var grand = segs.reduce(function (s, d) { return s + d.total; }, 0);

    // stack order inside a column: players in overall rank (largest at the bottom), Others on top
    var x0 = 0;
    segs.forEach(function (sg, i) {
      sg.index = i;
      sg.share = grand ? sg.total / grand : 0;
      sg.x0 = x0; sg.x1 = x0 + sg.share; x0 = sg.x1;
      var y0 = 0;
      sg.cells = players.map(function (p) {
        var v = sg.vals.get(p) || 0, sh = sg.total ? v / sg.total : 0;
        var c = { player: p, value: v, share: sh, y0: y0, y1: y0 + sh };
        y0 += sh;
        return c;
      });
    });
    return { segs: segs, players: players, grand: grand, othersName: othersName };
  }

  RK.component({
    id: 'marimekko',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'segment', series: 'player', value: 'value' },
      sort: 'desc',            // column order by segment size: desc | asc | null (data order)
      maxSeries: 8,            // players beyond this (by overall size) are grouped into othersLabel
      othersLabel: 'Others',   // rows named Others / Other … are merged into this bucket (drawn grey, stacked on top)
      highlight: null,         // player(s) drawn in the accent colour (e.g. the client)
      labels: 'auto',          // auto (player + share where it fits) | share | none
      showTotals: true,        // segment name + total + share of market above each column
      selectBy: 'x',           // click a cell to cross-filter by the column (x) or the player (series)
      gap: 2,                  // px gutter between columns
      format: null,            // segment total format; defaults to the value field format
      shareFormat: '0%',
      legend: true,
      axes: true               // 0–100% axes (left: share of segment, bottom: cumulative share of market)
    },
    render: function (ctx) {
      var state = { m: null };
      return C(function (c, inst) { return build(c, inst, state); }, {
        rebuildOnResize: true,   // header placement and cell labels are computed in pixels
        on: {
          // click a cell -> cross-filter by its column (selectBy 'x') or player ('series'); a header -> by column
          click: function (p, c) {
            var bySeries = p.seriesId !== 'hdr' && c.options.selectBy === 'series';
            if (c.options.crossFilter === false || (p.seriesId !== 'hdr' && !/^p-/.test(p.seriesId || ''))) return;
            if (bySeries && p.seriesName === state.m.othersName) return;
            var f = bySeries ? c.enc.series : c.enc.x;
            c.select(f, bySeries ? p.seriesName : p.name, GENERIC.test(f) ? { scope: c.options.crossFilterScope || 'dataset' } : null);
          }
        }
      })(ctx);
    }
  });

  function build(ctx, inst, state) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var m = state.m = model(ctx);
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var sfmt = o.shareFormat || '0%';
    var hl = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    // players are nominal: categorical colours; with a highlight none may read like the accent2 target
    var pal = RK.theme.palette(hl.length ? { n: m.players.length } : { exclude: [], n: m.players.length });
    var colorOf = {};
    var k = 0;
    m.players.forEach(function (p) {
      colorOf[p] = p === m.othersName ? RK.theme.mix(t.neutral, t.paper, 0.15) : hl.indexOf(p) >= 0 ? t.accent2 : pal[k++ % pal.length];
    });

    // selection → fade cells that are not selected
    var selX = ctx.selected(enc.x), selS = ctx.selected(enc.series);
    function faded(seg, player) {
      if (o.selectBy === 'series') return selS.length > 0 && selS.indexOf(player) < 0;
      return selX.length > 0 && selX.indexOf(seg) < 0;
    }

    var W = inst.getWidth();
    var showLegend = o.legend !== false && m.players.length > 1;
    var legendH = showLegend ? 26 : 0, headH = o.showTotals ? 36 : 6;
    var grid = { left: o.axes ? 38 : 2, right: 6, top: legendH + headH, bottom: o.axes ? 24 : 2, containLabel: false };
    var anim = ctx.motion;
    var gap = Math.max(0, o.gap || 0);

    // header layout: a label wider than its column may borrow the free space of its neighbours' headers
    var nameFont = '600 11px ' + t.fontSans, numFont = '10.5px ' + t.fontNum;
    var plotL = grid.left, plotW = Math.max(1, W - grid.left - grid.right);
    m.segs.forEach(function (sg, i) {
      sg.px0 = plotL + sg.x0 * plotW + (i ? gap / 2 : 0);
      sg.px1 = plotL + sg.x1 * plotW - (i < m.segs.length - 1 ? gap / 2 : 0);
      sg.totLine = RK.format(sg.total, fmt) + '  ·  ' + RK.format(sg.share, sfmt);
      sg.tw = Math.max(C.measure(sg.name, nameFont), C.measure(sg.totLine, numFont)) + 4;
    });
    m.segs.forEach(function (sg, i) {
      var prev = m.segs[i - 1], next = m.segs[i + 1];
      var freeL = prev ? Math.max(0, (prev.px1 - prev.px0 - prev.tw) / 2) : 0;
      var freeR = next ? Math.max(0, (next.px1 - next.px0 - next.tw) / 2) : Math.max(0, W - 2 - sg.px1);
      var lo = sg.px0 - freeL, hi = sg.px1 + freeR;
      sg.hw = Math.max(10, Math.min(sg.tw, hi - lo));
      sg.hx = Math.max(lo + sg.hw / 2, Math.min(hi - sg.hw / 2, (sg.px0 + sg.px1) / 2));
    });

    function cellLabel(cell, seg, w, hpx, fill) {
      if (o.labels === 'none') return null;
      var share = RK.format(cell.share, sfmt);
      var name = cell.player;
      var font = '600 11px ' + t.fontSans;
      var lines = null;
      var nw = C.measure(name, font);
      // two lines (player + share) only when the name fits, or can be truncated to something readable
      if (o.labels !== 'share' && hpx >= 36 && (nw <= w - 10 || w - 10 >= 64)) {
        if (nw > w - 10) {
          var ef = window.echarts && window.echarts.format;
          name = ef && ef.truncateText ? ef.truncateText(name, w - 10, font, '…') : name;
        }
        lines = '{n|' + name + '}\n{v|' + share + '}';
      } else if (w >= 28 && hpx >= 17) lines = '{v|' + share + '}';
      if (!lines) return null;
      var ink = RK.theme.textOn(fill);
      return {
        style: {
          text: lines, fill: ink,
          rich: {
            n: { fontSize: 11, fontWeight: 600, fontFamily: t.fontSans, lineHeight: 14, fill: ink },
            v: { fontSize: 11, fontFamily: t.fontNum, lineHeight: 14, fill: ink, opacity: 0.9 }
          }
        }
      };
    }

    var series = m.players.map(function (p, pi) {
      return {
        id: 'p-' + pi, name: p, type: 'custom',
        itemStyle: { color: colorOf[p] },          // legend swatch
        coordinateSystem: 'cartesian2d',
        encode: { x: [0, 1], y: [2, 3], tooltip: 4 },
        emphasis: { focus: 'series' },
        blur: { itemStyle: { opacity: 0.3 } },
        data: m.segs.map(function (sg) {
          var c = sg.cells[pi];
          return { name: sg.name, value: [sg.x0, sg.x1, c.y0, c.y1, c.value, c.share, sg.index] };
        }),
        renderItem: function (params, api) {
          var sg = m.segs[api.value(6)], cell = sg.cells[pi];
          if (!cell.value) return null;
          var a = api.coord([sg.x0, cell.y0]), b = api.coord([sg.x1, cell.y1]);
          var x = a[0] + (sg.index ? gap / 2 : 0), x2 = b[0] - (sg.index < m.segs.length - 1 ? gap / 2 : 0);
          var w = Math.max(0, x2 - x), hpx = Math.max(0, a[1] - b[1]);
          var base = colorOf[p];
          var fill = faded(sg.name, p) ? RK.theme.mix(base, t.paper, 0.72) : base;
          var bottom = api.coord([0, 0])[1];
          var el = {
            type: 'rect',
            shape: { x: x, y: b[1], width: w, height: hpx },
            style: { fill: fill, stroke: t.paper, lineWidth: 1 },
            originX: x, originY: bottom,
            transition: ['shape', 'style'],
            emphasis: { style: { stroke: t.ink, lineWidth: 1.2 } },
            blur: { style: { opacity: 0.3 } }
          };
          var lab = cellLabel(cell, sg, w, hpx, fill);
          if (lab) {
            el.textContent = lab;
            el.textConfig = { position: 'insideTopLeft', distance: 5, inside: true };
          }
          if (anim) {
            el.enterFrom = { scaleY: 0 };
            el.enterAnimation = { duration: 700, delay: 120 + sg.index * 90, easing: 'cubicOut' };
          }
          return el;
        }
      };
    });

    // segment headers: name (bold) + total · share of market, above each column
    if (o.showTotals) {
      series.push({
        id: 'hdr', type: 'custom', name: '__hdr', coordinateSystem: 'cartesian2d', silent: false,
        encode: { x: [0, 1], y: 2 }, tooltip: { show: false }, legendHoverLink: false,
        data: m.segs.map(function (sg) { return { name: sg.name, value: [sg.x0, sg.x1, 1, sg.index] }; }),
        renderItem: function (params, api) {
          var sg = m.segs[api.value(3)];
          var a = api.coord([sg.x0, 1]), b = api.coord([sg.x1, 1]);
          var w = sg.hw, cx = sg.hx, y = a[1] - 5;
          var dim = faded(sg.name, null) && o.selectBy !== 'series';
          var ef = window.echarts && window.echarts.format;
          var trunc = function (s, f) { return ef && ef.truncateText ? ef.truncateText(String(s), w, f, '…') : String(s); };
          var el = {
            type: 'group',
            children: [
              { type: 'text', style: { text: trunc(sg.name, nameFont), x: cx, y: y - 14, textAlign: 'center', textVerticalAlign: 'bottom', fill: dim ? t.ink3 : t.ink, font: nameFont } },
              { type: 'text', style: { text: trunc(sg.totLine, numFont), x: cx, y: y, textAlign: 'center', textVerticalAlign: 'bottom', fill: t.ink3, font: numFont } },
              // invisible hit area so the header is clickable (cross-filter by column)
              { type: 'rect', shape: { x: a[0], y: y - 28, width: b[0] - a[0], height: 28 }, style: { fill: 'rgba(0,0,0,0)' } }
            ]
          };
          if (anim) { el.enterFrom = { style: { opacity: 0 } }; el.enterAnimation = { duration: 500, delay: 200 + sg.index * 90 }; }
          return el;
        }
      });
    }

    var axisLabel = { formatter: function (v) { return RK.format(v, '0%'); }, color: t.ink3, fontSize: 11, fontFamily: t.fontNum };
    return {
      legend: C.legend(ctx, {
        show: showLegend, selectedMode: false,
        data: m.players.map(function (p) { return { name: p, itemStyle: { color: colorOf[p] } }; })
      }),
      grid: grid,
      tooltip: {
        trigger: 'item', confine: true,
        formatter: function (p) {
          if (!/^p-/.test(p.seriesId || '')) return '';
          var v = p.value, sg = m.segs[v[6]];
          return C.tip(p.seriesName + '  —  ' + sg.name, [
            { color: colorOf[p.seriesName], label: ctx.title(enc.value), value: RK.format(v[4], fmt), bold: true },
            { label: '% of ' + sg.name, value: RK.format(v[5], '0.0%') },
            { label: '% of total market', value: RK.format(m.grand ? v[4] / m.grand : null, '0.0%') },
            { label: sg.name + ' total', value: RK.format(sg.total, fmt) + '  (' + RK.format(sg.share, '0.0%') + ' of market)' }
          ]);
        }
      },
      xAxis: {
        type: 'value', min: 0, max: 1, interval: 0.2, show: !!o.axes,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: axisLabel
      },
      yAxis: {
        type: 'value', min: 0, max: 1, interval: 0.25, show: !!o.axes,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: axisLabel
      },
      series: series
    };
  }
})();
