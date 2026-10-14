/*!
 * RK component: bubble-map — proportional symbols at lat / lon on the offline basemap.
 * Area-true (sqrt) radius by a value, colour by a category (clickable legend) or by a numeric
 * field (sequential / diverging ramp), nested size legend, collision-aware labels for the top N,
 * grow-in on render, target highlight in accent-2, click to cross-filter.
 */
(function () {
  'use strict';
  var h = RK.util.h, G = RK.geo;

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /* ---------------- colour guards (same block in the map components) ---------------- */
  /** CIELAB (D65) of a colour. */
  function lab(c) {
    var p = RK.theme.parseColor(c).slice(0, 3).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var x = (p[0] * 0.4124 + p[1] * 0.3576 + p[2] * 0.1805) / 0.95047, y = p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722,
      z = (p[0] * 0.0193 + p[1] * 0.1192 + p[2] * 0.9505) / 1.08883;
    function f(v) { return v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116; }
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  /** CIE76 colour difference; kL < 1 weighs lightness less (hue tells thin marks apart better than lightness). */
  function dE(a, b, kL) {
    var p = lab(a), q = lab(b);
    return Math.sqrt(Math.pow((p[0] - q[0]) * (kL || 1), 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2));
  }
  /** Mix a fill toward `to` until it is at least ΔE `min` from every background it sits on (land, paper). */
  function separate(c, bgs, min, to) {
    for (var k = 0; k <= 10; k++) {
      var x = k ? RK.theme.mix(c, to, k * 0.08) : c;
      if (bgs.every(function (b) { return !b || dE(x, b) >= min; })) return x;
    }
    return RK.theme.mix(c, to, 0.8);
  }
  /**
   * Category -> colour from the theme palette (kept clear of the accent-2 target colour), skipping hues too close to one
   * already used (navy next to light blue, orange next to olive). Grey is reserved for an 'Other(s)' bucket.
   */
  function catColors(values) {
    var t = RK.theme.tokens(), grey = t.cat[t.cat.length - 1], pal = RK.theme.palette().filter(function (c) { return c !== grey; });
    var pick = [];
    pal.forEach(function (c) { if (pick.every(function (q) { return dE(c, q, 0.5) >= 28; })) pick.push(c); });
    pal.forEach(function (c) { if (pick.indexOf(c) < 0) pick.push(c); });
    var more = RK.theme.palette({ n: values.length + 12 }).slice(RK.theme.palette().length), map = {}, i = 0;   // tints / shades
    values.forEach(function (v) {
      if (/^(others?|other .*|rest of .*|misc.*)$/i.test(String(v))) { map[v] = grey; return; }
      map[v] = i < pick.length ? pick[i] : more[(i - pick.length) % Math.max(1, more.length)] || pick[i % pick.length];
      i++;
    });
    return function (v) { return map[v] || t.neutral; };
  }

  /**
   * Nested reference circles (bottom-aligned) for the sqrt size scale; value labels are spread at least 12px apart and
   * joined to the top of their circle by an elbow leader, so close reference values never crowd each other.
   */
  function sizeLegend(values, rOf, fmt, t) {
    var e = RK.util.escapeHTML, ink = t.ink3;
    var vs = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return b - a; }), kept = [];
    vs.forEach(function (v) { var last = kept[kept.length - 1]; if (!last || rOf(last) - rOf(v) >= 3) kept.push(v); });
    if (!kept.length) return null;
    var R = rOf(kept[0]), H = Math.ceil(2 * R + 4), tops = kept.map(function (v) { return H - 2 - 2 * rOf(v); });
    var ys = RK.chart.spreadLabels(tops, 13, 5, null), W = 0, out = '';
    var H2 = Math.ceil(Math.max(H, ys[ys.length - 1] + 6));
    kept.forEach(function (v, i) {
      var r = rOf(v), cy = H - 2 - r, ty = tops[i], ly = ys[i], txt = RK.format(v, fmt), x0 = R + 1, x1 = 2 * R + 6, x2 = 2 * R + 11;
      W = Math.max(W, x2 + 4 + RK.chart.measure(txt, '10px ' + t.fontNum));
      out += '<circle cx="' + x0 + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + ink + '" stroke-width="0.9"/>' +
        '<polyline points="' + x0 + ',' + ty.toFixed(1) + ' ' + x1 + ',' + ty.toFixed(1) + ' ' + (x2 - 2) + ',' + ly.toFixed(1) + '" fill="none" stroke="' + ink + '" stroke-width="0.6" stroke-dasharray="2 2"/>' +
        '<text x="' + x2 + '" y="' + (ly + 3.5).toFixed(1) + '">' + e(txt) + '</text>';
    });
    W = Math.ceil(W);
    return h('div.rk-geo-leg__size', { html: '<svg width="' + W + '" height="' + H2 + '" viewBox="0 0 ' + W + ' ' + H2 + '">' + out + '</svg>' });
  }

  /* ---------------- callout labels (same block in choropleth, bubble-map, flow-map, geo-heat) ----------------
   * Labels for the top marks, each on the best of a ring of candidate boxes around its mark (8 directions x 4
   * distances, plus the centre when it.center), never over a map control or another label. opts.cost(box, item, centre)
   * scores what a box covers (other marks, data areas); a leader line joins a label that sits off its mark. Optional
   * items (it.optional) are only placed right beside their mark at a cost <= opts.optionalCost (default 0.5).
   *   var co = callouts(map, {cost: fn, maxCost: 5});
   *   co.set([{latlng, html, cls, prio, r, center, leader, optional}], maxShown);
   */
  function callouts(map, opts) {
    opts = opts || {};
    var L = window.L, group = L.layerGroup().addTo(map), items = [], cap = Infinity;
    if (!map.getPane('rk-labels')) map.createPane('rk-labels').style.zIndex = 640;
    // [dx, dy, preference]: right first, then left, above, below, the diagonals
    var DIRS = [[1, 0, 0], [-1, 0, 0.15], [0, -1, 0.25], [0, 1, 0.3], [0.8, -0.7, 0.35], [-0.8, -0.7, 0.45], [0.8, 0.7, 0.45], [-0.8, 0.7, 0.5]];
    var GAPS = [3, 14, 28, 46, 70];
    function hit(a, b, pad) { return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y; }
    function place() {
      var size = map.getSize(), c0 = map.getContainer().getBoundingClientRect(), placed = [], shown = 0;
      var hard = [].map.call(map.getContainer().querySelectorAll('.leaflet-control'), function (c) {
        var r = c.getBoundingClientRect();
        return { x: r.left - c0.left, y: r.top - c0.top, w: r.width, h: r.height };
      });
      items.slice().sort(function (a, b) { return b.it.prio - a.it.prio; }).forEach(function (x) {
        var icon = x.m.getElement();
        if (!icon) return;
        var span = icon.querySelector('.rk-geo-label'), lead = icon.querySelector('.rk-geo-leader');
        var p = map.latLngToContainerPoint(x.it.latlng), r = x.it.r || 0, w = span.offsetWidth, h = span.offsetHeight, best = null;
        function consider(dx, dy, k, centre) {
          var b = { x: p.x + dx, y: p.y + dy, w: w, h: h };
          if (b.x < 2 || b.y < 2 || b.x + w > size.x - 2 || b.y + h > size.y - 2) return;
          if (hard.some(function (q) { return hit(b, q, 2); }) || placed.some(function (q) { return hit(b, q, 3); })) return;
          var cost = k + (opts.cost ? opts.cost(b, x.it, centre) : 0);
          if (!best || cost < best.cost) best = { dx: dx, dy: dy, b: b, cost: cost };
        }
        if (shown < cap && w) {
          if (x.it.center) consider(-w / 2, -h / 2, 0, true);
          DIRS.forEach(function (d) {
            (x.it.optional ? GAPS.slice(0, 1) : GAPS).forEach(function (g, gi) {
              var e = r + g;
              consider(d[0] > 0 ? d[0] * e : d[0] < 0 ? d[0] * e - w : -w / 2, d[1] > 0 ? d[1] * e : d[1] < 0 ? d[1] * e - h : -h / 2, d[2] + gi * 0.55, false);
            });
          });
        }
        var lim = x.it.optional ? (opts.optionalCost != null ? opts.optionalCost : 0.5) : opts.maxCost;
        var ok = !!best && !(lim != null && best.cost > lim);
        span.classList.toggle('is-hidden', !ok);
        if (lead) lead.style.display = 'none';
        if (!ok) return;
        shown++;
        placed.push(best.b);
        span.style.transform = 'translate(' + Math.round(best.dx) + 'px,' + Math.round(best.dy) + 'px)';
        // leader: from the mark's edge to the nearest point of the label box
        var nx = Math.max(best.b.x, Math.min(p.x, best.b.x + w)) - p.x, ny = Math.max(best.b.y, Math.min(p.y, best.b.y + h)) - p.y;
        var D = Math.sqrt(nx * nx + ny * ny);
        if (lead && x.it.leader !== false && D - r > 6) {
          var ln = lead.querySelector('line'), k = r ? (r + 1) / D : 0;
          ln.setAttribute('x1', (nx * k).toFixed(1)); ln.setAttribute('y1', (ny * k).toFixed(1));
          ln.setAttribute('x2', nx.toFixed(1)); ln.setAttribute('y2', ny.toFixed(1));
          lead.style.display = '';
        }
      });
    }
    map.on('zoomend moveend resize', place);
    return {
      set: function (list, n) {
        var ink = RK.theme.tokens().ink3;
        cap = n == null ? Infinity : n;
        group.clearLayers();
        items = list.map(function (it) {
          var svg = '<svg class="rk-geo-leader" width="1" height="1" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none;display:none">' +
            '<line stroke="' + ink + '" stroke-width="0.8"/>' + (it.r ? '' : '<circle r="1.8" fill="' + ink + '"/>') + '</svg>';
          var m = L.marker(it.latlng, {
            pane: 'rk-labels', interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'rk-geo-label-anchor', iconSize: null, html: svg + '<span class="rk-geo-label ' + (it.cls || '') + '">' + it.html + '</span>' })
          });
          group.addLayer(m);
          return { m: m, it: it };
        });
        place();
      },
      place: place
    };
  }
  /* ---------------- end callouts ---------------- */


  RK.component({
    id: 'bubble-map',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { lat: 'lat', lon: 'lon', size: 'value', color: null, label: 'name', target: 'is_target' },
      basemap: 'world-110m',
      sizeRange: [4, 26],         // min / max radius in px on a >= 1000px-wide map (sqrt scale); narrower maps scale it down
      colorScale: 'auto',         // auto (categorical for text, sequential for numbers) | categorical | sequential | diverging
      mid: 0,                     // diverging midpoint
      opacity: 0.78,              // bubble fill opacity
      labels: 5,                  // labels for the top N bubbles by size (0 = none); crowded labels hide
      labelValue: true,           // append the size value to labels
      highlight: null,            // label value(s) drawn in accent-2 and always labelled; rows flagged by encode.target are too
      format: null,               // size format; defaults to the size field format
      tooltip: [],                // extra fields listed in the tooltip
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      sizeLegend: true,
      legendPosition: 'bottomleft',
      filterField: null,          // click-to-filter field; defaults to encode.label
      scrollZoom: 'click'         // 'click' (plain-wheel zoom armed by a click) | true | false; Ctrl/Cmd + wheel always zooms
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx;
      var view = G.view(ctx, { cls: 'rk-bubble' }), map = view.map;
      var group = L.featureGroup().addTo(map);
      var legend = view.legend();
      /** Callout cost: how much of the box covers other bubbles (each counted by the covered share of the box). */
      function bubbleCost(b, it) {
        var cost = 0, A = b.w * b.h;
        S.items.forEach(function (o) {
          if (o.key === it.key) return;
          var c = map.latLngToContainerPoint(o.ll), r = o.r * 0.9;
          var ox = Math.max(0, Math.min(b.x + b.w, c.x + r) - Math.max(b.x, c.x - r)), oy = Math.max(0, Math.min(b.y + b.h, c.y + r) - Math.max(b.y, c.y - r));
          if (ox && oy) cost += 0.4 + 3 * ox * oy / A;
        });
        return cost;
      }
      var labels = callouts(map, { cost: bubbleCost, maxCost: 6 });
      var marks = {}, S = null, timer = null;

      function ff(c) { return c.options.filterField || c.enc.label; }
      /**
       * Colour-ramp stops for bubbles: one step darker than the area ramp (marks are small), and every stop, as drawn at
       * the bubble opacity over the land, at least ΔE 20 from the land so low values never vanish into the basemap.
       */
      function rampStops(mode) {
        var land = t.mapLand || t.surface2, op = cur.options.opacity == null ? 0.85 : cur.options.opacity;
        var base = mode === 'diverging' ? t.div : (t.seq.length >= 7 ? t.seq.slice(3) : G.seqStops(t));
        return base.map(function (c, i) {
          var to = mode === 'diverging' ? (i < base.length / 2 ? base[0] : base[base.length - 1]) : base[base.length - 1];
          for (var j = 0; j <= 10; j++) {
            var x = j ? RK.theme.mix(c, to, j * 0.08) : c;
            if (dE(RK.theme.mix(land, x, op), land) >= 20) return x;
          }
          return to;
        });
      }
      function keyOf(r, enc) { return [r[enc.label], r[enc.lat], r[enc.lon]].join('|'); }

      function derive(c) {
        var enc = c.enc, o = c.options;
        var dom = G.domainRows(c), fmt = o.format || c.fmtOf(enc.size) || 'auto';
        var sizes = dom.map(function (r) { return num(r[enc.size]); });
        // narrow maps (a 760px page, a half-width block) get proportionally smaller bubbles: less overplotting
        var sr = o.sizeRange || [4, 26], k = RK.util.clamp((ctx.el.clientWidth || 1000) / 1000, 0.62, 1);
        var rOf = G.radius(sizes, [Math.max(2.5, sr[0] * Math.sqrt(k)), Math.max(sr[0] + 4, sr[1] * k)]);
        var hl = o.highlight == null ? [] : [].concat(o.highlight), tf = enc.target && c.field(enc.target) ? enc.target : null;
        var cf = enc.color, fld = cf ? c.field(cf) : null, cm;
        var mode = !cf ? 'none' : o.colorScale !== 'auto' ? o.colorScale : (fld && fld.type === 'number' ? 'sequential' : 'categorical');
        var colorOf, cats = [], cfmt = cf ? c.fmtOf(cf) || 'auto' : null, ext = null;
        if (mode === 'categorical') {
          cats = RK.util.unique(dom.map(function (r) { return r[cf]; }).filter(function (v) { return v != null && v !== ''; }));
          cm = catColors(cats);                         // peers never resemble the accent-2 target or each other
          colorOf = function (r) { return cm(r[cf]); };
        } else if (mode === 'sequential' || mode === 'diverging') {
          ext = RK.util.extent(dom.map(function (r) { return num(r[cf]); }));
          var sc, stops = rampStops(mode);
          if (mode === 'diverging') {
            var dev = Math.max(Math.abs(ext[0] - o.mid), Math.abs(ext[1] - o.mid)) || 1;
            ext = [o.mid - dev, o.mid + dev];
            sc = RK.theme.diverging(ext, o.mid, stops);
          } else sc = RK.theme.sequential(ext, stops);
          colorOf = function (r) { return num(r[cf]) == null ? t.neutral : sc(r[cf]); };
        } else colorOf = function () { return t.accent3 || t.cat[1]; };
        var items = c.rows.filter(function (r) { return num(r[enc.lat]) != null && num(r[enc.lon]) != null; }).map(function (r) {
          var v = num(r[enc.size]), isHl = hl.indexOf(r[enc.label]) >= 0 || !!(tf && r[tf]);
          return { key: keyOf(r, enc), row: r, v: v, r: rOf(v), color: isHl ? t.accent2 : colorOf(r), hl: isHl, ll: [r[enc.lat], r[enc.lon]] };
        });
        items.sort(function (a, b) { return (b.v || 0) - (a.v || 0); });   // big first so small bubbles stay clickable on top
        return { items: items, rOf: rOf, fmt: fmt, mode: mode, cats: cats, catColor: cm || null, cfmt: cfmt, ext: ext, maxV: RK.util.extent(sizes)[1] };
      }

      function styleOf(it) {
        var on = G.isOn(cur, it.row, [ff(cur), cur.enc.color]), anySel = cur.selected(ff(cur)).length;
        return {
          radius: it.r, fillColor: it.color, fillOpacity: on ? (it.hl ? 0.95 : cur.options.opacity) : 0.12,
          color: it.hl ? t.ink : (on && anySel ? t.ink : t.paper), weight: it.hl || (on && anySel) ? 1.4 : 1, opacity: on ? 1 : 0.4
        };
      }

      function tipOf(it) {
        var c = cur, enc = c.enc, r = it.row, rows = [{ color: it.color, label: c.title(enc.size), value: RK.format(it.v, S.fmt) }];
        if (enc.color && enc.color !== enc.size) rows.push({ label: c.title(enc.color), value: RK.format(r[enc.color], S.cfmt) });
        (c.options.tooltip || []).forEach(function (f) { rows.push({ label: c.title(f), value: RK.format(r[f], c.fmtOf(f)) }); });
        return RK.chart.tip(r[enc.label], rows);
      }

      function add(it, rank) {
        var m = L.circleMarker(it.ll, L.extend(styleOf(it), { className: 'rk-bubble__dot' }));
        m.bindTooltip(function () { return tipOf(m.it); }, { direction: 'top', offset: [0, -Math.max(4, it.r * 0.7)], opacity: 1 });
        m.on('mouseover', function () { m.setStyle({ color: t.ink, weight: 1.6, opacity: 1 }); m.bringToFront(); });
        m.on('mouseout', function () { m.setStyle(styleOf(m.it)); restack(); });
        m.on('click', function () { G.select(cur, ff(cur), m.it.row[ff(cur)]); });
        m.it = it;
        group.addLayer(m);
        var el = m.getElement();
        if (el && cur.motion) { el.classList.add('is-enter'); el.style.setProperty('--rk-d', Math.min(rank * 14, 560) + 'ms'); }
        return m;
      }

      /** Paint order = size order (largest underneath, small bubbles stay visible and clickable), the target on top. */
      function restack() {
        S.items.forEach(function (it) { if (marks[it.key]) marks[it.key].bringToFront(); });
        S.items.forEach(function (it) { if (it.hl && marks[it.key]) marks[it.key].bringToFront(); });
      }

      function draw(first) {
        S = derive(cur);
        var o = cur.options, enc = cur.enc, next = {}, grow = [];
        S.items.forEach(function (it, i) {
          var m = marks[it.key];
          if (m) { grow.push([m, m.getRadius(), it.r]); m.it = it; m.setStyle(L.extend(styleOf(it), { radius: m.getRadius() })); }
          else m = add(it, i);
          next[it.key] = m;
        });
        Object.keys(marks).forEach(function (k) { if (!next[k]) group.removeLayer(marks[k]); });
        marks = next;
        restack();
        if (grow.length) RK.motion.tween(cur.motion ? 450 : 0, function (k) {
          grow.forEach(function (g) { g[0].setRadius(g[1] + (g[2] - g[1]) * k); });
        });
        if (cur.motion) {
          clearTimeout(timer);
          timer = setTimeout(function () { [].forEach.call(ctx.el.querySelectorAll('.rk-bubble__dot.is-enter'), function (n) { n.classList.remove('is-enter'); }); }, 1400);
        }

        var n = Math.max(0, o.labels | 0);
        // top N by size (+ the highlighted target): next to the bubble, or off it with a leader line, avoiding other bubbles
        labels.set(S.items.filter(function (it) { return n || it.hl; }).map(function (it) {
          var name = RK.util.escapeHTML(it.row[enc.label] == null ? '' : it.row[enc.label]);
          return {
            latlng: it.ll, r: it.r, key: it.key, prio: it.hl ? Infinity : (it.v || 0), cls: it.hl ? 'is-hl' : '',
            html: '<b>' + name + '</b>' + (o.labelValue ? ' <span>' + RK.util.escapeHTML(RK.format(it.v, S.fmt)) + '</span>' : '')
          };
        }), n + S.items.filter(function (it) { return it.hl; }).length);

        if (o.legend !== false) {
          var secs = [], hlNames = RK.util.unique(S.items.filter(function (it) { return it.hl; }).map(function (it) { return it.row[enc.label]; }));
          var hlEl = hlNames.length ? G.legendItems(hlNames, function () { return t.accent2; }) : null;
          if (S.mode === 'categorical') {
            secs.push(G.legendSection(cur.title(enc.color), [G.legendItems(S.cats, S.catColor, {
              selected: cur.selected(enc.color), onClick: o.crossFilter !== false ? function (v) { G.select(cur, enc.color, v); } : null
            }), hlEl]));
          } else {
            if (S.mode === 'sequential' || S.mode === 'diverging') {
              var stops = rampStops(S.mode);
              var ticks = S.mode === 'diverging' ? [S.ext[0], o.mid, S.ext[1]] : S.ext;
              secs.push(G.legendSection(G.fieldTitle(cur, enc.color), G.legendRamp(stops, ticks.map(function (v) { return RK.format(v, S.cfmt); }))));
            }
            if (hlEl) secs.push(G.legendSection(null, hlEl));
          }
          if (o.sizeLegend !== false) {
            var refs = G.sizeRefs(S.maxV);
            var sl = sizeLegend(refs, S.rOf, G.tidyFmt(S.fmt, refs), t);
            if (sl) secs.push(G.legendSection(G.fieldTitle(cur, enc.size), sl));
          }
          legend.set(secs.length ? h('div.rk-geo-leg' + (secs.length > 1 ? '.is-row' : ''), secs) : null);
        } else legend.set(null);

        if (first) {
          var pad = (o.sizeRange ? o.sizeRange[1] : 26) * 0.6 + 10;
          view.fit(G.fitTarget(o.fit, S.items.map(function (it) { return it.ll; })), pad, function () { return S.items.map(function (it) { return { ll: it.ll, r: it.r }; }); });
          labels.place();
        }
      }

      draw(true);

      return view.instance({
        update: function (c) { cur = c; draw(false); },
        destroy: function () { clearTimeout(timer); }
      });
    }
  });
})();
