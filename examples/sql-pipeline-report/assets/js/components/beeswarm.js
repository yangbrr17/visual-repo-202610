/*!
 * RK component: beeswarm — 1-D distribution of individual observations by group (one row of
 * dots per sector / consideration type ...). Dots never overlap: a deterministic swarm layout is
 * computed in pixel space inside an ECharts custom series (so it re-flows on resize / zoom), with
 * an interquartile band + median tick per group, the target highlighted and labelled directly.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /* ---------- helpers ---------- */
  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  /** Axis tick format: the value format with no more decimals than the tick step needs (10x not 10.0x). */
  function tickFmt(fmt, step) {
    var code = RK.format.presets[fmt] || fmt;
    if (typeof code !== 'string' || !step || !/[0#]/.test(code) || RK.format.isDateCode(code)) return fmt;
    var sec = code.split(';')[0].replace(/"[^"]*"/g, ''), scale = Math.pow(1000, ((sec.match(/[0#](,+)[^0#]*$/) || [])[1] || '').length);
    var v = Math.abs(step) * (/%/.test(sec) ? 100 : 1) / scale, dec = 0;
    while (dec < 4 && Math.abs(Math.round(v * Math.pow(10, dec)) - v * Math.pow(10, dec)) > 1e-6) dec++;
    return code.replace(/([0#])\.([0#]+)/g, function (m, a, d) { var n = Math.min(dec, d.length); return a + (n ? '.' + d.slice(0, n) : ''); });
  }

  /** Value text with a true minus sign. */
  function num(v, f) { return RK.format(v, f).replace(/^-/, '\u2212'); }
  /** Largest 1 / 2 / 2.5 / 5 x 10^k at or below v (size-key values). */
  function niceBelow(v) {
    if (!(v > 0)) return 0;
    var mag = Math.pow(10, Math.floor(Math.log10(v))), n = v / mag;
    return (n >= 5 ? 5 : n >= 2.5 ? 2.5 : n >= 2 ? 2 : 1) * mag;
  }
  /** Rows a wrapping (type 'plain') ECharts legend needs within `avail` px — mirrors ECharts' box layout. */
  function legendRows(names, avail, font) {
    var rows = 1, x = 0;
    names.forEach(function (n) {
      var w = 15 + C.measure(n, font);
      if (x > 0 && x + w > avail) { rows++; x = 0; }
      x += w + 14;
    });
    return rows;
  }

  /** Summary stats of a numeric array (sorted copy, quartiles by linear interpolation). */
  function stats(vals) {
    var a = vals.slice().sort(function (x, y) { return x - y; }), q = RK.expr.quantile;
    if (!a.length) return null;
    return { n: a.length, min: a[0], q1: q(a, 0.25), median: q(a, 0.5), q3: q(a, 0.75), max: a[a.length - 1],
      mean: a.reduce(function (s, v) { return s + v; }, 0) / a.length };
  }

  /**
   * Deterministic beeswarm for one group. pts = [{v: px along the value axis, r: radius}].
   * Each dot (in value order) takes the smallest perpendicular offset that clears every dot
   * already placed; the preferred side alternates so the swarm stays balanced. Sets p.o (px).
   */
  function swarm(pts, gap) {
    var order = pts.map(function (_, i) { return i; }).sort(function (a, b) { return pts[a].v - pts[b].v; });
    var placed = [];
    order.forEach(function (i, k) {
      var p = pts[i], cands = [0], near = [];
      for (var j = 0; j < placed.length; j++) {
        var q = placed[j], d = p.r + q.r + gap, dx = p.v - q.v;
        if (Math.abs(dx) < d) {
          var dy = Math.sqrt(d * d - dx * dx);
          near.push(q);
          cands.push(q.o + dy, q.o - dy);
        }
      }
      var sideFirst = k % 2 ? 1 : -1;
      cands.sort(function (a, b) { return (Math.abs(a) - Math.abs(b)) || (a - b) * sideFirst; });
      p.o = 0;
      for (var c = 0; c < cands.length; c++) {
        var ok = true;
        for (var n = 0; n < near.length && ok; n++) {
          var q2 = near[n], dd = p.r + q2.r + gap, ex = p.v - q2.v, ey = cands[c] - q2.o;
          if (ex * ex + ey * ey < dd * dd - 0.01) ok = false;
        }
        if (ok) { p.o = cands[c]; break; }
      }
      placed.push(p);
    });
  }

  RK.component({
    id: 'beeswarm',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'label', value: 'value', group: 'group', size: null, target: 'is_target' },
      orientation: 'horizontal',  // horizontal (one row per group) | vertical (one column per group)
      highlight: null,            // label value(s) drawn in accent-2 and labelled (adds to encode.target)
      labels: 'highlight',        // 'highlight' | 'extremes' (+ min / max per group) | 'all' | 'none'
      median: true,               // median tick per group + "n · median" under the group name
      band: 'iqr',                // shaded band per group: 'iqr' (25th–75th pct) | 'range' (min–max) | false
      overall: false,             // dashed line at the median of all observations
      refLines: [],               // [{value, label, color}] e.g. offer premium, sector average
      colorBy: 'single',          // 'single' | 'group' | <field name> (categorical + legend)
      symbolSize: 10,             // dot diameter (px)
      sizeRange: [7, 24],         // diameter range when encode.size is set (sqrt scale); >= 7px so the smallest dot never reads as a speck
      sizeLegend: true,           // size key (nested-circle scale, top right) when encode.size is set
      sortGroups: null,           // null (data order) | 'desc' | 'asc' (by median) | 'alpha'
      format: null,               // value format; defaults to the value field format
      zoom: false,                // dataZoom along the value axis
      wheelZoom: null,            // zoom: null = Ctrl/Cmd + wheel or pinch (plain wheel scrolls the report) | true = plain wheel
      legend: true                // legend (only shown when colorBy is a field)
    },
    render: C(function (ctx, inst) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var horiz = o.orientation !== 'vertical';
      var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
      var vf = enc.value, lf = enc.label, gf = enc.group;
      var groupOf = function (r) { return gf ? (r[gf] == null || r[gf] === '' ? 'n.a.' : r[gf]) : ctx.title(vf); };

      // observations with a value can be placed; the rest are counted per group ("n.a.")
      var all = ctx.rows, rows = all.filter(function (r) { return util.isNum(r[vf]); });
      var groups = util.unique(all.map(groupOf));
      var gStats = {}, gMissing = {};
      groups.forEach(function (g) {
        var members = all.filter(function (r) { return groupOf(r) === g; });
        gStats[g] = stats(members.map(function (r) { return r[vf]; }).filter(util.isNum));
        gMissing[g] = members.length - members.filter(function (r) { return util.isNum(r[vf]); }).length;
      });
      groups = groups.filter(function (g) { return gStats[g]; });
      if (o.sortGroups === 'alpha') groups.sort(function (a, b) { return String(a).localeCompare(String(b)); });
      else if (o.sortGroups === 'desc' || o.sortGroups === 'asc') {
        var dir = o.sortGroups === 'desc' ? -1 : 1;
        groups.sort(function (a, b) { return (gStats[a].median - gStats[b].median) * dir; });
      }
      // horizontal: first group on top without an inverse axis (keeps markLine label ends at the top)
      var gIndex = {}, axisGroups = [];
      groups.forEach(function (g, i) { var k = horiz ? groups.length - 1 - i : i; gIndex[g] = k; axisGroups[k] = g; });
      var overall = stats(rows.map(function (r) { return r[vf]; }));

      // highlight set: explicit labels + rows flagged by the target channel (e.g. is_target)
      var hl = o.highlight == null ? [] : [].concat(o.highlight);
      var isHL = function (r) { return (enc.target && r[enc.target] === true) || hl.some(function (h) { return same(h, r[lf]); }); };

      // colours: categorical palettes skip accent-2 (reserved for the target); one peer colour across the kit
      var peerColor = t.peer || t.accent;
      var colorField = o.colorBy && o.colorBy !== 'single' && o.colorBy !== 'group' && ctx.dataset && ctx.dataset.has(o.colorBy) ? o.colorBy : null;
      // colour order from the unfiltered rows so colours stay put while cross-filters change
      var cats = colorField ? util.unique(ctx.allRows.map(function (r) { return r[colorField]; })) : [];
      var groupOrder = util.unique(ctx.allRows.map(groupOf));
      var pal = RK.theme.palette({ n: Math.max(cats.length, groupOrder.length) });
      var colorOf = function (r) {
        if (colorField) return pal[cats.indexOf(r[colorField])];
        if (o.colorBy === 'group') return pal[groupOrder.indexOf(groupOf(r))];
        return peerColor;
      };

      // dot radius: fixed, or sqrt-scaled by encode.size
      var sizeExt = enc.size ? util.extent(rows.map(function (r) { return r[enc.size]; })) : null;
      var radiusOf = function (r, val) {
        if (!sizeExt) return (o.symbolSize || 10) / 2;
        var v = r ? r[enc.size] : val, lo = Math.sqrt(Math.max(0, sizeExt[0])), hi = Math.sqrt(Math.max(0, sizeExt[1]));
        if (!util.isNum(v)) return o.sizeRange[0] / 2;
        var tt = hi > lo ? (Math.sqrt(Math.max(0, v)) - lo) / (hi - lo) : 0.5;
        return (o.sizeRange[0] + tt * (o.sizeRange[1] - o.sizeRange[0])) / 2;
      };

      // label set by priority: 0 target / highlight, 1 extremes, 2 everything else
      var labelPri = function (r) {
        if (o.labels === 'none') return -1;
        if (isHL(r)) return 0;
        if (o.labels === 'all') return 2;
        if (o.labels === 'extremes') {
          var s = gStats[groupOf(r)];
          if (r[vf] === s.min || r[vf] === s.max) return 1;
        }
        return -1;
      };

      var selLabels = ctx.selected(lf), selGroups = gf ? ctx.selected(gf) : [];
      var dimmed = function (r) {
        if (selLabels.length && selLabels.indexOf(r[lf]) < 0) return true;
        if (selGroups.length && selGroups.indexOf(groupOf(r)) < 0) return true;
        return false;
      };

      // value axis bounds: nice, padded so edge dots are never clipped
      var ext = util.extent(rows.map(function (r) { return r[vf]; }).concat((o.refLines || []).map(function (r) { return r.value; })));
      var span = (ext[1] - ext[0]) || Math.abs(ext[1]) || 1;
      var step = util.niceStep(span * 1.1, horiz ? 6 : 5);
      var axMin = Math.floor((ext[0] - span * 0.05) / step) * step, axMax = Math.ceil((ext[1] + span * 0.05) / step) * step;

      // reference lines: zero line, overall median (statistic: ink-3 dashed 1px), user lines (--rk-ref dashed 1.2px)
      var lines = [];
      if (axMin < 0 && axMax > 0) lines.push({ v: 0, label: '', color: t.axis, type: 'solid', width: 1 });
      if (o.overall && overall) lines.push({ v: overall.median, label: 'Overall median ' + num(overall.median, fmt), color: t.ink3, type: [4, 3], width: 1 });
      (o.refLines || []).forEach(function (r) { lines.push({ v: r.value, label: r.label || num(r.value, fmt), color: r.color || t.ref, type: r.type || [4, 3], width: 1.2, ref: true }); });

      /* ---------- swarm layout (pixel space, cached per coordinate system state) ---------- */
      var L = { key: null, pos: [] };
      function layout(params, api) {
        var cs = params.coordSys;
        var a0 = api.coord(horiz ? [axMin, 0] : [0, axMin]), a1 = api.coord(horiz ? [axMax, 0] : [0, axMax]);
        var key = [cs.x, cs.y, cs.width, cs.height, a0.join(','), a1.join(',')].join('|');
        if (L.key === key) return L;
        L.key = key;
        L.pos = [];
        var bandPx = horiz ? api.size([0, 1])[1] : api.size([1, 0])[0];
        var half = Math.max(4, bandPx * 0.42), widest = 0;
        L.labels = [];
        var byGroup = {};
        rows.forEach(function (r, i) {
          var g = gIndex[groupOf(r)], c = api.coord(horiz ? [r[vf], g] : [g, r[vf]]);
          var p = { i: i, v: horiz ? c[0] : c[1], center: horiz ? c[1] : c[0], r: radiusOf(r) + (isHL(r) ? 1 : 0) };
          (byGroup[g] || (byGroup[g] = [])).push(p);
          L.pos[i] = p;
        });
        Object.keys(byGroup).forEach(function (g) {
          var pts = byGroup[g];
          swarm(pts, 1.2);
          // compress (allowing overlap) when the swarm is taller than its band
          var need = 0;
          pts.forEach(function (p) { need = Math.max(need, Math.abs(p.o) + p.r); });
          var k = need > half ? Math.max(0.15, (half - 3) / Math.max(1, need - 3)) : 1;
          widest = Math.max(widest, need * k);
          pts.forEach(function (p) {
            p.o *= k;
            p.x = horiz ? p.v : p.center + p.o;
            p.y = horiz ? p.center + p.o : p.v;
          });
        });
        // bands / median ticks hug the widest swarm (same thickness for every group), box-plot style
        L.half = Math.min(half, Math.max(12, widest + 7));
        // obstacles for the labels: median ticks and the reference / overall-median lines ([x1, y1, x2, y2])
        var segs = [], hb = L.half + 2;
        if (o.median) groups.forEach(function (g) {
          var pm = api.coord(horiz ? [gStats[g].median, gIndex[g]] : [gIndex[g], gStats[g].median]);
          segs.push(horiz ? [pm[0], pm[1] - hb, pm[0], pm[1] + hb] : [pm[0] - hb, pm[1], pm[0] + hb, pm[1]]);
        });
        lines.forEach(function (l) {
          var q = api.coord(horiz ? [l.v, 0] : [0, l.v]);
          segs.push(horiz ? [q[0], cs.y, q[0], cs.y + cs.height] : [cs.x, q[1], cs.x + cs.width, q[1]]);
        });
        placeLabels(cs, segs);
        return L;
      }

      /**
       * Direct labels: candidate spots around the dot (centred above / below, beside, then above / below shifted so
       * the label ends at the dot). A spot must stay inside the plot (never over the group names) and must not hit a
       * label already placed; among those, the one crossing the fewest median ticks / reference lines, then covering
       * the fewest dots, wins (ties keep the preference order).
       */
      function placeLabels(cs, segs) {
        var boxes = [];
        var cand = rows.map(function (r, i) { return { r: r, i: i, pri: labelPri(r) }; })
          .filter(function (c) { return c.pri >= 0; })
          .sort(function (a, b) { return a.pri - b.pri || b.r[vf] - a.r[vf]; });
        var lo = horiz ? [cs.x - 1, cs.y - 6] : [cs.x + 2, cs.y - 10], hi = horiz ? [cs.x + cs.width + 16, cs.y + cs.height + 4] : [cs.x + cs.width + 6, cs.y + cs.height - 1];
        cand.forEach(function (c) {
          var p = L.pos[c.i], strong = c.pri === 0;
          var font = (strong ? '600 ' : '') + '11px ' + t.fontSans;
          var w = C.measure(c.r[lf], font) + 2, h = 13, gap = p.r + 3, sh = Math.min(6, p.r + 2);
          var above = ['top', 0, -gap, 'center', 'bottom'], below = ['bottom', 0, gap, 'center', 'top'];
          var right = ['right', gap + 1, 0, 'left', 'middle'], left = ['left', -gap - 1, 0, 'right', 'middle'];
          var aboveL = ['tl', sh, -gap, 'right', 'bottom'], aboveR = ['tr', -sh, -gap, 'left', 'bottom'];
          var belowL = ['bl', sh, gap, 'right', 'top'], belowR = ['br', -sh, gap, 'left', 'top'];
          var opts = horiz ? [above, below, right, left, aboveL, aboveR, belowL, belowR] : [right, left, above, below, aboveL, aboveR, belowL, belowR];
          if (horiz && p.o > 0.5) opts = [below, above, right, left, belowL, belowR, aboveL, aboveR];   // dot sits low → label below
          if (!horiz && p.o < -0.5) opts = [left, right, above, below, aboveL, aboveR, belowL, belowR]; // dot sits left → label left
          var chosen = null, best = Infinity, fallback = null, fbScore = Infinity;
          for (var k = 0; k < opts.length; k++) {
            var op = opts[k], x = p.x + op[1], y = p.y + op[2];
            var bx = op[3] === 'center' ? x - w / 2 : op[3] === 'right' ? x - w : x;
            var by = op[4] === 'middle' ? y - h / 2 : op[4] === 'bottom' ? y - h : y;
            var box = [bx, by, bx + w, by + h];
            if (box[0] < lo[0] || box[2] > hi[0] || box[1] < lo[1] || box[3] > hi[1]) continue;
            var lines = 0;
            segs.forEach(function (sg) {
              if (sg[0] === sg[2] ? (sg[0] > box[0] - 3 && sg[0] < box[2] + 3 && sg[1] < box[3] && sg[3] > box[1])
                : (sg[1] > box[1] - 3 && sg[1] < box[3] + 3 && sg[0] < box[2] && sg[2] > box[0])) lines++;
            });
            var cover = 0;
            L.pos.forEach(function (q) {
              if (!q || q === p) return;
              var nx = Math.max(box[0], Math.min(q.x, box[2])), ny = Math.max(box[1], Math.min(q.y, box[3]));
              if ((nx - q.x) * (nx - q.x) + (ny - q.y) * (ny - q.y) < q.r * q.r) cover++;
            });
            var score = lines * 100 + cover;
            var spot = { dx: op[1], dy: op[2], align: op[3], va: op[4], box: box };
            if (score < fbScore) { fbScore = score; fallback = spot; }
            if (boxes.some(function (b) { return box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]; })) continue;
            if (score < best) { best = score; chosen = spot; }
            if (!score) break;
          }
          if (!chosen && strong) chosen = fallback || { dx: opts[0][1], dy: opts[0][2], align: opts[0][3], va: opts[0][4] };
          if (chosen) { if (chosen.box) boxes.push(chosen.box); L.labels[c.i] = { dx: chosen.dx, dy: chosen.dy, align: chosen.align, va: chosen.va, font: font, strong: strong }; }
        });
      }

      /* ---------- series ---------- */
      var bandSeries = {
        id: 'band', name: 'Distribution', type: 'custom', z: 1, clip: true,
        encode: { x: 0, y: 1 },
        data: groups.map(function (g) { var s = gStats[g], gi = gIndex[g]; return { name: String(g), value: horiz ? [s.median, gi] : [gi, s.median] }; }),
        renderItem: function (params, api) {
          var lay = layout(params, api), g = groups[params.dataIndex], s = gStats[g], gi = gIndex[g];
          var lo = o.band === 'range' ? s.min : s.q1, hi = o.band === 'range' ? s.max : s.q3;
          var p0 = api.coord(horiz ? [lo, gi] : [gi, lo]), p1 = api.coord(horiz ? [hi, gi] : [gi, hi]);
          var pm = api.coord(horiz ? [s.median, gi] : [gi, s.median]);
          var hb = lay.half + 2;
          var dim = selGroups.length && selGroups.indexOf(g) < 0;
          var kids = [];
          if (o.band) {
            kids.push({
              type: 'rect',
              shape: horiz ? { x: Math.min(p0[0], p1[0]), y: pm[1] - hb, width: Math.max(1, Math.abs(p1[0] - p0[0])), height: hb * 2, r: 2 }
                : { x: pm[0] - hb, y: Math.min(p0[1], p1[1]), width: hb * 2, height: Math.max(1, Math.abs(p1[1] - p0[1])), r: 2 },
              style: { fill: RK.theme.alpha(t.accent3 || t.accent, dim ? 0.03 : 0.09) },
              enterFrom: { style: { opacity: 0 } }
            });
          }
          // full-band hit area so the whole row is hoverable / clickable
          kids.push({
            type: 'rect', invisible: false,
            shape: horiz ? { x: params.coordSys.x, y: pm[1] - hb, width: params.coordSys.width, height: hb * 2 }
              : { x: pm[0] - hb, y: params.coordSys.y, width: hb * 2, height: params.coordSys.height },
            style: { fill: 'rgba(0,0,0,0)' }
          });
          return { type: 'group', children: kids };
        }
      };

      var medianSeries = o.median ? {
        id: 'median', name: 'Median', type: 'custom', z: 2, silent: true, clip: true,
        encode: { x: 0, y: 1 }, tooltip: { show: false },
        data: groups.map(function (g) { var s = gStats[g], gi = gIndex[g]; return horiz ? [s.median, gi] : [gi, s.median]; }),
        renderItem: function (params, api) {
          var lay = layout(params, api), pm = api.coord([api.value(0), api.value(1)]), hb = lay.half + 2;
          var g = groups[params.dataIndex], dim = selGroups.length && selGroups.indexOf(g) < 0;
          return {
            type: 'line',
            shape: horiz ? { x1: pm[0], y1: pm[1] - hb, x2: pm[0], y2: pm[1] + hb } : { x1: pm[0] - hb, y1: pm[1], x2: pm[0] + hb, y2: pm[1] },
            style: { stroke: dim ? RK.theme.alpha(t.ink, 0.25) : t.ink, lineWidth: 2, lineCap: 'butt' },
            enterFrom: { style: { opacity: 0 } }
          };
        }
      } : null;

      // one points series per colour category (so the legend can toggle them); layout is shared
      // with a colour legend the target gets its own accent-2 entry (and series), like scatter
      var present = colorField ? cats.filter(function (c) { return rows.some(function (r) { return r[colorField] === c && !isHL(r); }); }) : [];
      var hlNames = colorField ? util.unique(rows.filter(isHL).map(function (r) { return String(r[lf]); })) : [];
      var buckets = colorField ? present.map(function (c) { return { name: String(c), color: pal[cats.indexOf(c)], test: function (r) { return r[colorField] === c && !isHL(r); } }; })
        : [{ name: ctx.title(vf), test: function () { return true; } }];
      if (hlNames.length) buckets.push({ name: hlNames.join(' / '), color: t.accent2, test: isHL });
      var pointSeries = buckets.map(function (b, bi) {
        var idx = [];
        rows.forEach(function (r, i) { if (b.test(r)) idx.push(i); });
        // target last so it paints on top
        idx.sort(function (a, c) { return (isHL(rows[a]) ? 1 : 0) - (isHL(rows[c]) ? 1 : 0); });
        return {
          id: 'pts-' + bi, name: b.name, type: 'custom', z: 3, clip: false,
          encode: { x: 0, y: 1 },
          itemStyle: { color: b.color || peerColor },
          data: idx.map(function (i) {
            var r = rows[i], g = gIndex[groupOf(r)];
            return { name: String(r[lf]) + '\u0001' + i, value: horiz ? [r[vf], g, i] : [g, r[vf], i] };
          }),
          renderItem: function (params, api) {
            var lay = layout(params, api), i = api.value(2), p = lay.pos[i], r = rows[i];
            if (!p) return null;
            var hlt = isHL(r), dim = dimmed(r);
            var fill = hlt ? t.accent2 : colorOf(r);
            if (dim) fill = RK.theme.alpha(fill, 0.22);
            var s = gStats[groupOf(r)], med = api.coord(horiz ? [s.median, 0] : [0, s.median]);
            var kids = [{
              type: 'circle',
              shape: { cx: 0, cy: 0, r: p.r },
              style: { fill: fill, stroke: hlt ? t.paper : RK.theme.alpha(t.paper, 0.9), lineWidth: hlt ? 1.5 : 1, opacity: sizeExt && !hlt ? 0.85 : 1 },
              emphasis: { style: { stroke: t.ink, lineWidth: 1.5 } }
            }];
            var lab = lay.labels[i];
            if (lab) {
              kids.push({
                type: 'text', silent: true, x: lab.dx, y: lab.dy,
                style: {
                  text: C.richSafe(r[lf]), font: lab.font, fill: dim ? RK.theme.alpha(t.ink, 0.35) : (lab.strong ? t.ink : t.ink2),
                  align: lab.align, verticalAlign: lab.va, stroke: t.paper, lineWidth: 3, lineJoin: 'round'
                },
                enterFrom: { style: { opacity: 0 } }
              });
            }
            return {
              type: 'group', x: p.x, y: p.y, children: kids,
              // dots fan out from their group median
              enterFrom: horiz ? { x: med[0], style: { opacity: 0 } } : { y: med[1], style: { opacity: 0 } }
            };
          }
        };
      });

      var hasLineLabels = lines.some(function (l) { return l.label; });
      if (lines.length) {
        bandSeries.markLine = {
          // precision 10: lines sit at the exact value; z 2 keeps them under the dots and their (haloed) labels
          silent: true, symbol: ['none', 'none'], animation: false, precision: 10, z: 2,
          data: lines.map(function (l) {
            var text = C.richSafe(l.label);
            var d = { lineStyle: { color: l.color, type: l.type, width: l.width },
              label: { show: !!l.label, formatter: function () { return text; }, color: l.ref ? l.color : t.ink2, fontSize: 10.5,
                fontStyle: 'italic', fontWeight: l.ref ? 600 : 400, position: horiz ? 'end' : 'insideEndTop', distance: 4 } };
            d[horiz ? 'xAxis' : 'yAxis'] = l.v;
            return d;
          })
        };
      }

      // group axis labels: name + "n · median"
      var catLabel = {
        interval: 0, margin: 12,
        formatter: function (val, i) {
          var g = axisGroups[i], s = gStats[g];
          if (!s) return '';
          var sub = 'n = ' + s.n + (gMissing[g] ? ' (+' + gMissing[g] + ' n.a.)' : '') + (o.median ? '  ·  Med. ' + RK.format(s.median, fmt) : '');
          return '{n|' + C.richSafe(g) + '}\n{s|' + C.richSafe(sub) + '}';
        },
        rich: {
          n: { color: t.ink, fontSize: 11.5, fontWeight: 600, lineHeight: 16, fontFamily: t.fontSans, align: horiz ? 'right' : 'center' },
          s: { color: t.ink3, fontSize: 10, lineHeight: 13, fontFamily: t.fontNum, align: horiz ? 'right' : 'center' }
        }
      };
      var catAxis = {
        type: 'category', data: axisGroups.map(String),
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: true, interval: 0, lineStyle: { color: t.grid } },
        axisLabel: catLabel
      };
      var valAxis = {
        type: 'value', min: axMin, max: axMax, interval: step,
        axisLine: { show: !horiz, lineStyle: { color: t.axis } },
        splitLine: { show: true, lineStyle: { color: t.grid } },
        axisLabel: { formatter: function (v) { return num(v, tickFmt(fmt, step)); }, hideOverlap: true }
      };

      /* ---------- size key (top right): circles at nice values on the same sqrt scale as the dots ---------- */
      var W = (inst && inst.getWidth()) || ctx.el.clientWidth || 800, graphic = [], keyW = 0, keyH = 0;
      if (sizeExt && o.sizeLegend !== false && sizeExt[1] > 0) {
        var sFmt = ctx.fmtOf(enc.size) || 'auto';
        var keyVals = util.unique([niceBelow(sizeExt[1]), niceBelow(sizeExt[1] / 4), niceBelow(sizeExt[1] / 16)])
          .filter(function (v) { return v >= sizeExt[0]; }).sort(function (a, b) { return a - b; });
        if (keyVals.length) {
          var kf = C.tickFmt(sFmt, keyVals), keyFont = '10px ' + t.fontNum, titleFont = '600 10px ' + t.fontSans;
          var sTitle = ctx.title(enc.size), x = C.measure(sTitle, titleFont) + 8, dMax = 2 * radiusOf(null, keyVals[keyVals.length - 1]);
          keyH = Math.max(14, dMax);
          var kids = [{ type: 'text', x: 0, y: keyH / 2, style: { text: C.richSafe(sTitle), fill: t.ink3, font: titleFont, verticalAlign: 'middle' } }];
          keyVals.forEach(function (v) {
            var r = radiusOf(null, v);
            kids.push({ type: 'circle', shape: { cx: x + r, cy: keyH / 2, r: r }, style: { fill: 'none', stroke: t.ink3, lineWidth: 0.8 } });
            x += 2 * r + 4;
            var lab = C.richSafe(kf(v));
            kids.push({ type: 'text', x: x, y: keyH / 2, style: { text: lab, fill: t.ink2, font: keyFont, verticalAlign: 'middle' } });
            x += C.measure(lab, keyFont) + 10;
          });
          keyW = x;
          graphic.push({ type: 'group', id: 'rk-size', right: 4, top: 0, silent: true, children: kids });
        }
      }

      var showLegend = !!colorField && o.legend !== false;
      var legendNames = buckets.map(function (b) { return b.name; });
      var lRows = showLegend ? legendRows(legendNames, W - (keyW ? keyW + 24 : 0), '11px ' + t.fontSans) : 0;
      var top = Math.max(showLegend ? 25 * lRows + 5 : 6, keyH ? keyH + 10 : 0) + (hasLineLabels ? 18 : 0);
      var series = [bandSeries].concat(pointSeries);
      if (medianSeries) series.push(medianSeries);

      return {
        legend: C.legend(ctx, { show: showLegend, type: 'plain', data: legendNames, width: W - (keyW ? keyW + 24 : 0) }),   // wraps clear of the size key
        graphic: graphic,
        grid: { left: 4, right: horiz ? 18 : 8, top: top, bottom: o.zoom ? 34 : 6, containLabel: true },
        tooltip: {
          trigger: 'item', confine: true,
          formatter: function (p) {
            if (p.seriesId === 'band') {
              var g = groups[p.dataIndex], s = gStats[g];
              return C.tip(String(g), [
                { label: 'Observations', value: String(s.n) + (gMissing[g] ? ' (+' + gMissing[g] + ' n.a.)' : '') },
                { label: 'Maximum', value: RK.format(s.max, fmt) },
                { label: '75th percentile', value: RK.format(s.q3, fmt) },
                { label: 'Median', value: RK.format(s.median, fmt), bold: true },
                { label: '25th percentile', value: RK.format(s.q1, fmt) },
                { label: 'Minimum', value: RK.format(s.min, fmt) },
                { label: 'Mean', value: RK.format(s.mean, fmt) }
              ]);
            }
            var i = p.value && p.value[2], r = rows[i];
            if (!r) return '';
            var g2 = groupOf(r), s2 = gStats[g2];
            var peersIn = rows.filter(function (x) { return groupOf(x) === g2; }).map(function (x) { return x[vf]; }).sort(function (a, b) { return b - a; });
            var diff = r[vf] - s2.median;
            var tr = [
              gf ? { label: ctx.title(gf), value: String(g2) } : null,
              { color: isHL(r) ? t.accent2 : colorOf(r), label: ctx.title(vf), value: RK.format(r[vf], fmt), bold: true },
              { label: 'vs. group median', value: (diff > 0 ? '+' : diff < 0 ? '-' : '') + RK.format(Math.abs(diff), fmt) },
              { label: 'Rank in group', value: (peersIn.indexOf(r[vf]) + 1) + ' of ' + peersIn.length }
            ];
            if (enc.size) tr.push({ label: ctx.title(enc.size), value: RK.format(r[enc.size], ctx.fmtOf(enc.size) || 'auto') });
            if (colorField) tr.splice(1, 0, { label: ctx.title(colorField), value: String(r[colorField]) });
            return C.tip(String(r[lf]), tr);
          }
        },
        xAxis: horiz ? valAxis : catAxis,
        yAxis: horiz ? catAxis : valAxis,
        dataZoom: o.zoom ? C.zoom(ctx, horiz ? 'x' : 'y', horiz ? {} : { orient: 'vertical', right: 0, bottom: 10, width: 14, height: null }) : [],
        series: series
      };
    }, {
      rebuildOnResize: true,      // legend rows and the size key are laid out in px
      // generic column names (e.g. a deal's 'target') stay within this dataset: ctx.select scopes them (RK.data.isGenericField)
      select: function (p, ctx) {
        if (p.seriesId === 'band') return ctx.enc.group ? { field: ctx.enc.group, value: String(p.name) } : null;
        if (/^pts-/.test(p.seriesId)) return { field: ctx.enc.label, value: String(p.name).split('\u0001')[0] };
        return null;
      }
    })
  });
})();
