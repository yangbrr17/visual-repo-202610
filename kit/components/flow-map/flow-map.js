/*!
 * RK component: flow-map — origin -> destination flows (cross-border M&A, trade, capital) as
 * curved arcs on the offline basemap. Stroke width by value, colour by category, arrowheads at
 * the destination, country nodes sized by total flow, travelling-dot animation (CSS, motion only),
 * hover to isolate a flow or a country's flows, click to cross-filter.
 */
(function () {
  'use strict';
  var h = RK.util.h;

  /* ======================================================================================== *
   * geo kit — identical copy in every RK geo component (choropleth, bubble-map, flow-map,
   * cluster-map, geo-heat) so each file stays standalone. Candidate for rk.geo.js.
   * ======================================================================================== */
  var WORLD = [[-48, -168], [72, 180]];

  /** Latitude where a ring edge a -> b crosses the antimeridian. */
  function crossLat(a, b) {
    var bx = b[0] + (a[0] > 0 ? 360 : -360), e = a[0] > 0 ? 180 : -180;
    return a[1] + (b[1] - a[1]) * (e - a[0]) / ((bx - a[0]) || 1);
  }
  /** Split a ring that jumps across +/-180 (Russia, Fiji) into planar pieces; close polar rings (Antarctica). */
  function splitRing(ring) {
    var j = [];
    for (var i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) j.push(i);
    if (j.length === 1) {
      var a = ring[j[0] - 1], b = ring[j[0]], la = crossLat(a, b), pole = a[1] < 0 ? -90 : 90, ea = a[0] > 0 ? 180 : -180;
      return [ring.slice(0, j[0]).concat([[ea, la], [ea, pole], [-ea, pole], [-ea, la]], ring.slice(j[0]))];
    }
    if (j.length !== 2) return [ring];
    var p = ring[j[0] - 1], q = ring[j[0]], r = ring[j[1] - 1], s = ring[j[1]], l1 = crossLat(p, q), l2 = crossLat(r, s);
    var side = function (pt) { return pt[0] > 0 ? 180 : -180; };
    return [
      [[side(s), l2]].concat(ring.slice(j[1]), ring.slice(0, j[0]), [[side(p), l1]]),
      [[side(q), l1]].concat(ring.slice(j[0], j[1]), [[side(r), l2]])
    ];
  }
  /** world-atlas is built for spherical renderers; make it planar-safe for Leaflet (once per basemap, in place). */
  function planar(fc) {
    if (fc.__rkPlanar) return fc;
    fc.features.forEach(function (f) {
      var g = f.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return;
      var out = [], hit = false;
      (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach(function (poly) {
        var parts = splitRing(poly[0]);
        if (parts.length > 1 || parts[0] !== poly[0]) { hit = true; parts.forEach(function (pt) { out.push([pt]); }); } else out.push(poly);
      });
      if (hit) f.geometry = { type: 'MultiPolygon', coordinates: out };
    });
    fc.__rkPlanar = true;
    return fc;
  }

  /** Themed Leaflet map (RK.geo.leaflet) + fit / refit-on-resize bookkeeping + clean teardown. */
  function geoView(ctx, o, cls) {
    var L = window.L, el = ctx.el, name = o.basemap || 'world-110m';
    planar(RK.geo.features(name));     // before RK.geo.leaflet draws the land layer from the same cached features
    var v = RK.geo.leaflet(ctx, { basemap: name, minZoom: 0, maxZoom: o.maxZoom || 8 });
    var map = v.map, st = { moved: false, fitting: false, target: null, pad: 16 };
    el.classList.add('rk-geo', cls);
    if (ctx.motion) el.classList.add('is-motion');
    // Antarctica only eats vertical space on a Mercator world map
    if (v.land) v.land.eachLayer(function (l) { if (l.feature && l.feature.id === '010') v.land.removeLayer(l); });
    map.createPane('rk-labels').style.zIndex = 640;
    map.on('dragstart', function () { st.moved = true; });
    map.on('zoomstart', function () { if (!st.fitting) st.moved = true; });
    // wheel zoom would hijack page scrolling in a long report: off, or armed by a click on the map
    if (o.scrollZoom !== true) {
      map.scrollWheelZoom.disable();
      if (o.scrollZoom === 'click') {
        map.on('click', function () { map.scrollWheelZoom.enable(); });
        map.on('mouseout', function () { map.scrollWheelZoom.disable(); });
      }
    }
    /** Legend box in container px, with the corner it sits in. */
    function legendBox() {
      var lg = el.querySelector('.leaflet-control-container .rk-map-legend');
      if (!lg) return null;
      var r = lg.getBoundingClientRect(), c = el.getBoundingClientRect(), x = r.left - c.left, y = r.top - c.top;
      return { x: x, y: y, w: r.width, h: r.height, left: x + r.width / 2 < c.width / 2, top: y + r.height / 2 < c.height / 2 };
    }
    /** Fit bounds; if the legend would cover data (avoid() -> [{ll, r}]), reserve a column or band for it — whichever zooms less. */
    function fit(target, pad, avoid) {
      if (target !== undefined) { st.target = target; st.pad = pad == null ? 16 : pad; st.avoid = avoid || null; }
      var b = st.target, p = st.pad, mz = o.fitMaxZoom || 6;
      if (!b) return;
      st.fitting = true;
      try {
        if (b.center) map.setView(b.center, b.zoom != null ? b.zoom : 2, { animate: false });
        else {
          map.fitBounds(b, { padding: [p, p], maxZoom: mz, animate: false });
          var lg = st.avoid && legendBox();
          var hit = lg && st.avoid().some(function (q) {
            var c = map.latLngToContainerPoint(q.ll), r = (q.r || 0) + 4;
            return c.x + r > lg.x && c.x - r < lg.x + lg.w && c.y + r > lg.y && c.y - r < lg.y + lg.h;
          });
          if (hit) {
            var gx = lg.w + 14, gy = lg.h + 14;
            var A = [L.point(lg.left ? gx : p, p), L.point(lg.left ? p : gx, p)], B = [L.point(p, lg.top ? gy : p), L.point(p, lg.top ? p : gy)];
            var zA = map.getBoundsZoom(b, false, A[0].add(A[1])), zB = map.getBoundsZoom(b, false, B[0].add(B[1])), best = zA >= zB ? A : B;
            map.fitBounds(b, { paddingTopLeft: best[0], paddingBottomRight: best[1], maxZoom: mz, animate: false });
          }
        }
      } catch (e) { /* zero-sized container: refit on the next resize */ }
      st.fitting = false;
    }
    return {
      map: map,
      land: v.land,
      fit: fit,
      resize: function () { map.invalidateSize({ animate: false, pan: false }); if (!st.moved) fit(); },
      destroy: function () {
        map.remove();
        [].slice.call(el.classList).forEach(function (c) { if (/^leaflet-/.test(c)) el.classList.remove(c); });
        el.classList.remove('rk-map', 'rk-geo', cls, 'is-motion');
        el.style.background = '';
      }
    };
  }

  /** options.fit -> Leaflet bounds or {center, zoom}: 'data' | 'world' | [[s, w], [n, e]] | {center, zoom}. */
  function fitTarget(fit, latlngs) {
    var L = window.L;
    if (fit && typeof fit === 'object' && !Array.isArray(fit)) return fit;
    if (Array.isArray(fit)) return L.latLngBounds(fit);
    if (fit === 'data' && latlngs && latlngs.length) {
      // polar extremes (Tierra del Fuego, the Canadian Arctic) would shrink a world view: clamp what we fit to
      var b = L.latLngBounds(latlngs);
      return L.latLngBounds([[Math.max(b.getSouth(), WORLD[0][0]), b.getWest()], [Math.min(b.getNorth(), WORLD[1][0]), b.getEast()]]);
    }
    return L.latLngBounds(WORLD);
  }

  /** Collision-aware HTML labels in the 'rk-labels' pane: per group, the top `max` visible items by priority that fit. */
  function labelLayer(map) {
    var L = window.L, group = L.layerGroup().addTo(map), items = [], max = {}, circles = [];
    function overlap(a, b) { return a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y; }
    function place() {
      var size = map.getSize(), box0 = map.getContainer().getBoundingClientRect();
      // controls (zoom, legend, toggles) are obstacles
      var placed = [].map.call(map.getContainer().querySelectorAll('.leaflet-control'), function (c) {
        var r = c.getBoundingClientRect();
        return { x: r.left - box0.left, y: r.top - box0.top, w: r.width, h: r.height };
      });
      // bubbles are soft obstacles: a label prefers the side that covers the fewest of them
      var soft = circles.map(function (q) { var c = map.latLngToContainerPoint(q.ll), r = q.r || 0; return { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }; });
      var shown = {};
      items.slice().sort(function (a, b) { return b.it.prio - a.it.prio; }).forEach(function (x) {
        var icon = x.m.getElement(), gk = x.it.group || '_', cap = max[gk] == null ? Infinity : max[gk];
        if (!icon) return;
        if ((shown[gk] || 0) >= cap) { icon.firstChild.classList.add('is-hidden'); return; }
        var span = icon.firstChild, w = span.offsetWidth, ht = span.offsetHeight, r = x.it.r || 0, g = 3;
        var p = map.latLngToContainerPoint(x.it.latlng), hit = null, hitBox = null, best = Infinity;
        (x.it.pos || ['r', 'l', 't', 'b']).forEach(function (k) {
          var d = k === 'c' ? [-w / 2, -ht / 2] : k === 'r' ? [r + g, -ht / 2] : k === 'l' ? [-r - g - w, -ht / 2] : k === 't' ? [-w / 2, -r - g - ht] : [-w / 2, r + g];
          var b = { x: p.x + d[0], y: p.y + d[1], w: w, h: ht };
          if (b.x < 2 || b.y < 2 || b.x + w > size.x - 2 || b.y + ht > size.y - 2) return;
          if (placed.some(function (q) { return overlap(b, q); })) return;
          var score = soft.filter(function (q) { return overlap(b, q); }).length;
          if (score < best) { best = score; hit = d; hitBox = b; }
        });
        if (hitBox) placed.push(hitBox);
        span.style.transform = hit ? 'translate(' + Math.round(hit[0]) + 'px,' + Math.round(hit[1]) + 'px)' : '';
        span.classList.toggle('is-hidden', !hit);
        if (hit) shown[gk] = (shown[gk] || 0) + 1;
      });
    }
    map.on('zoomend moveend resize', place);
    return {
      /** list: [{latlng, html, r, prio, pos, cls, group}]; n: max shown (number, or {group: max}); soft: [{ll, r}] marks to avoid covering */
      set: function (list, n, soft) {
        max = n == null ? {} : typeof n === 'number' ? { _: n } : n;
        circles = soft || [];
        group.clearLayers();
        items = list.map(function (it) {
          var m = L.marker(it.latlng, {
            pane: 'rk-labels', interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'rk-geo-label-anchor', iconSize: null, html: '<span class="rk-geo-label ' + (it.cls || '') + '">' + it.html + '</span>' })
          });
          group.addLayer(m);
          return { m: m, it: it };
        });
        place();
      },
      place: place
    };
  }

  /** Legend control whose content can be swapped on update. */
  function legendControl(map, position) {
    var ctl = null;
    return {
      set: function (el) {
        if (!el) { if (ctl) { ctl.remove(); ctl = null; } return; }
        if (!ctl) ctl = RK.geo.legend(map, el, position || 'bottomleft');
        else { var c = ctl.getContainer(); c.innerHTML = ''; c.appendChild(el); }
      }
    };
  }
  function legSec(title, body) { return h('div.rk-geo-leg__sec', title ? h('div.rk-map-legend__title', title) : null, body); }
  function rampEl(stops, ticks) {
    return h('div.rk-geo-leg__ramp',
      h('div.rk-legend__ramp', { style: { background: 'linear-gradient(90deg,' + stops.join(',') + ')' } }),
      h('div.rk-map-legend__ticks', ticks.map(function (x) { return h('span', x); })));
  }

  /** Categorical legend rows; clickable (cross-filter) when onClick is given, dimmed when deselected. */
  function catItems(values, colorOf, sel, onClick, shape) {
    return h('div.rk-geo-leg__items', values.map(function (v) {
      var off = sel && sel.length && sel.indexOf(v) < 0;
      return h('div.rk-geo-leg__item' + (off ? '.is-off' : '') + (onClick ? '.is-click' : ''), { on: onClick ? { click: function () { onClick(v); } } : null },
        h('i.rk-geo-leg__sw' + (shape ? '.is-' + shape : ''), { style: { background: colorOf(v) } }), h('span', String(v)));
    }));
  }
  /** Nested reference circles (bottom-aligned, leader lines) for a sqrt size scale. */
  function sizeLegendEl(values, rOf, fmt, ink) {
    var vs = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return b - a; }), kept = [];
    vs.forEach(function (v) { var last = kept[kept.length - 1]; if (!last || 2 * (rOf(last) - rOf(v)) >= 12) kept.push(v); });
    if (!kept.length) return null;
    var R = rOf(kept[0]), H = Math.ceil(2 * R + 4), W = Math.ceil(2 * R + 64), e = RK.util.escapeHTML, out = '';
    kept.forEach(function (v) {
      var r = rOf(v), cy = H - 2 - r, ty = cy - r;
      out += '<circle cx="' + (R + 1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + ink + '" stroke-width="0.9"/>' +
        '<line x1="' + (R + 1) + '" x2="' + (2 * R + 8) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '" stroke="' + ink + '" stroke-width="0.6" stroke-dasharray="2 2"/>' +
        '<text x="' + (2 * R + 11) + '" y="' + (ty + 3.5).toFixed(1) + '">' + e(RK.format(v, fmt)) + '</text>';
    });
    return h('div.rk-geo-leg__size', { html: '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + out + '</svg>' });
  }
  /** Reference values for a size legend: a nice value below the max, then ~1/3 and ~1/10 of it. */
  function sizeRefs(max) {
    if (!(max > 0)) return [];
    var m = Math.pow(10, Math.floor(Math.log10(max))), top = m;
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8].forEach(function (k) { if (k * m <= max) top = k * m; });
    return RK.util.unique([top, niceRound(top / 2.5), niceRound(top / 10)]);
  }
  /** Field title with its unit, e.g. "Revenue 2025A (USD m)". */
  function fieldTitle(ctx, f) {
    var d = ctx.field(f), t = (d && d.title) || f;
    return d && d.unit && t.indexOf(d.unit) < 0 ? t + ' (' + d.unit + ')' : t;
  }
  /** Rows that define scale domains: all rows (after options.where) so colours / sizes stay put when filters change. */
  function domainRows(ctx) {
    var rows = ctx.allRows;
    if (ctx.options.where && ctx.dataset) {
      try { var c = RK.expr.compile(ctx.options.where, { fields: ctx.dataset.fields }); rows = rows.filter(function (r) { return c.eval(r, { params: RK.store.params() }); }); } catch (e) { rows = ctx.rows; }
    }
    return rows;
  }
  /** Is a row inside every active self-selection on the given fields? (false -> draw dimmed) */
  function isOn(ctx, row, fields) {
    return fields.every(function (f) { if (!f) return true; var s = ctx.selected(f); return !s.length || s.indexOf(row[f]) >= 0; });
  }
  /** Categorical palette; with a highlight in play, drop colours too close to accent-2 so the target stays unique. */
  function palette(t, avoidAccent2) {
    if (!avoidAccent2) return t.cat;
    var a = RK.theme.parseColor(t.accent2);
    var out = t.cat.filter(function (c) { var x = RK.theme.parseColor(c); return Math.sqrt(Math.pow(x[0] - a[0], 2) + Math.pow(x[1] - a[1], 2) + Math.pow(x[2] - a[2], 2)) > 70; });
    return out.length >= 3 ? out : t.cat;
  }
  /** Stable category -> colour map over a palette. */
  function catScale(values, pal, t) {
    var m = {};
    values.forEach(function (v, i) { m[v] = pal[i % pal.length]; });
    return function (v) { return m[v] || t.neutral; };
  }
  /** Sequential stops without the palest steps (they vanish against the land colour). */
  function seqStops(t) { return t.seq.length >= 6 ? t.seq.slice(2) : t.seq; }

  /** Drop decimals from a format code when every value prints with zero decimals ("$#,##0.0" -> "$#,##0"). */
  function tidyFmt(fmt, values) {
    if (typeof fmt !== 'string' || !/0\.0/.test(fmt)) return fmt;
    var ok = values.every(function (v) { return !/\.\d*[1-9]/.test(RK.format(v, fmt)); });
    return ok ? fmt.replace(/0\.0+/g, '0') : fmt;
  }

  /** Round to the nearest "nice" number (1, 1.5, 2, 2.5, 3, 4, 5, 7.5 x 10^k). */
  function niceRound(v) {
    if (!v) return 0;
    var s = v < 0 ? -1 : 1, a = Math.abs(v), m = Math.pow(10, Math.floor(Math.log10(a))), best = m, d = Infinity;
    [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].forEach(function (k) { var c = k * m; if (Math.abs(c - a) < d) { d = Math.abs(c - a); best = c; } });
    return s * +best.toPrecision(6);
  }

  /** PNG snapshot of the map container (SVG foreignObject + inlined computed styles). */
  var SNAP = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'display', 'transform', 'transform-origin', 'z-index', 'overflow',
    'opacity', 'visibility', 'margin-left', 'margin-top', 'padding', 'box-sizing', 'background-color', 'background-image', 'border', 'border-radius',
    'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'white-space', 'text-align', 'text-shadow',
    'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin'];
  function snapshot(ctx, map) {
    var src = map.getContainer(), w = src.clientWidth, ht = src.clientHeight, t = ctx.theme;
    var clone = src.cloneNode(true);
    var a = [src].concat([].slice.call(src.querySelectorAll('*'))), b = [clone].concat([].slice.call(clone.querySelectorAll('*')));
    a.forEach(function (n, i) {
      var cs = getComputedStyle(n), css = '';
      SNAP.forEach(function (p) { css += p + ':' + cs.getPropertyValue(p) + ';'; });
      b[i].setAttribute('style', css + 'animation:none;transition:none;');
      if (n.tagName === 'CANVAS' && b[i].parentNode) {
        try { var img = document.createElement('img'); img.setAttribute('src', n.toDataURL()); img.setAttribute('style', b[i].getAttribute('style')); b[i].parentNode.replaceChild(img, b[i]); } catch (e) { /* tainted */ }
      }
    });
    [].forEach.call(clone.querySelectorAll('.leaflet-control-zoom, .rk-geo-toggle, .leaflet-tooltip-pane > *, .leaflet-popup-pane > *'), function (n) { n.remove(); });
    clone.style.margin = '0';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + ht + '"><foreignObject x="0" y="0" width="100%" height="100%">' +
      new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>';
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = w * 2; c.height = ht * 2;
        var g = c.getContext('2d');
        g.fillStyle = t.mapWater || t.paper; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL('image/png')); } catch (e) { console.warn('[RK] map export failed', e); resolve(null); }
      };
      img.onerror = function () { console.warn('[RK] map export failed'); resolve(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  /* ======================================================================================== */

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** Arrowhead SVG (tip at the origin of its box, pointing +x), rotated / pulled back by CSS. */
  function arrowHTML(size, color, angle, back) {
    var s = size, w = s * 0.62;
    return '<svg class="rk-flow__arrow-svg" width="' + (s + 2) + '" height="' + (2 * w + 2) + '" viewBox="' + (-s - 1) + ' ' + (-w - 1) + ' ' + (s + 2) + ' ' + (2 * w + 2) + '"' +
      ' style="transform: translate(' + (-s - 1) + 'px,' + (-w - 1) + 'px) rotate(' + angle.toFixed(1) + 'deg) translate(' + (-back).toFixed(1) + 'px,0); transform-origin:' + (s + 1) + 'px ' + (w + 1) + 'px">' +
      '<path d="M0,0 L' + (-s) + ',' + (-w).toFixed(1) + ' L' + (-s * 0.7).toFixed(1) + ',0 L' + (-s) + ',' + w.toFixed(1) + ' Z" fill="' + color + '"/></svg>';
  }

  RK.component({
    id: 'flow-map',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: {
        from: 'from_country', to: 'to_country', fromLat: 'from_lat', fromLon: 'from_lon', toLat: 'to_lat', toLon: 'to_lon',
        value: 'value', count: 'deals', color: 'sector'
      },
      basemap: 'world-110m',
      widthRange: [1, 9],         // stroke width in px for the smallest / largest flow (linear in value)
      curvature: 0.25,            // arc bend (0 = straight); long arcs are flattened so they stay on the map
      opacity: 0.72,              // arc opacity
      arrows: true,               // arrowheads at the destination
      animate: true,              // travelling dots along each arc (only when motion is allowed)
      nodes: true,                // origin / destination circles sized by total flow
      nodeSizeRange: [3, 11],
      labels: 6,                  // label the top N countries by total flow (0 = none)
      flowLabels: 0,              // value labels on the top N flows (0 = none)
      maxFlows: null,             // keep only the N largest flows
      format: null,               // value format; defaults to the value field format
      tooltip: [],                // extra fields listed in the flow tooltip
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      legendPosition: 'bottomleft',
      filterField: null,          // click-to-filter field; defaults to encode.color, else encode.from
      scrollZoom: 'click'         // true | false | 'click'
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx, el = ctx.el;
      var view = geoView(ctx, ctx.options, 'rk-flow'), map = view.map;
      map.createPane('rk-flow-arrows').style.zIndex = 450;
      var layer = L.layerGroup().addTo(map);
      var labels = labelLayer(map), legend = legendControl(map, ctx.options.legendPosition);
      var S = null, timers = [];

      function ff(c) { return c.options.filterField || c.enc.color || c.enc.from; }

      function derive(c) {
        var enc = c.enc, o = c.options, fmt = o.format || c.fmtOf(enc.value) || 'auto';
        // domain (unfiltered) scales keep widths / colours stable under filters
        var dom = domainRows(c), maxV = 0;
        var agg = function (rows) {
          var m = new Map();
          rows.forEach(function (r) {
            var a = [num(r[enc.fromLat]), num(r[enc.fromLon])], b = [num(r[enc.toLat]), num(r[enc.toLon])];
            if (a[0] == null || a[1] == null || b[0] == null || b[1] == null || r[enc.from] === r[enc.to]) return;
            var k = [r[enc.from], r[enc.to], enc.color ? r[enc.color] : ''].join('\u0001'), f = m.get(k);
            if (!f) m.set(k, f = { key: k, from: r[enc.from], to: r[enc.to], cat: enc.color ? r[enc.color] : null, a: a, b: b, v: 0, n: 0, row: r, rows: [] });
            f.v += num(r[enc.value]) || 0;
            f.n += enc.count ? num(r[enc.count]) || 0 : 1;
            f.rows.push(r);
          });
          return Array.from(m.values());
        };
        agg(dom).forEach(function (f) { maxV = Math.max(maxV, f.v); });
        var flows = agg(c.rows).sort(function (x, y) { return y.v - x.v; });
        if (o.maxFlows > 0) flows = flows.slice(0, o.maxFlows);
        var total = flows.reduce(function (s, f) { return s + f.v; }, 0);
        var cats = enc.color ? RK.util.unique(dom.map(function (r) { return r[enc.color]; }).filter(function (v) { return v != null && v !== ''; })) : [];
        var cm = catScale(cats, palette(t, false), t);
        var wr = o.widthRange || [1, 9];
        var wOf = function (v) { return wr[0] + (wr[1] - wr[0]) * (maxV ? Math.max(0, v) / maxV : 0); };
        // nodes: totals per country
        var nodes = new Map();
        function node(name, ll) { var n = nodes.get(name); if (!n) nodes.set(name, n = { name: name, ll: ll, out: 0, in: 0, outN: 0, inN: 0 }); return n; }
        flows.forEach(function (f) {
          var s = node(f.from, f.a), d = node(f.to, f.b);
          s.out += f.v; s.outN += f.n; d.in += f.v; d.inN += f.n;
        });
        var nodeList = Array.from(nodes.values()).sort(function (x, y) { return (y.in + y.out) - (x.in + x.out); });
        var rOf = RK.geo.radius(nodeList.map(function (n) { return n.in + n.out; }), o.nodeSizeRange || [3, 11]);
        nodeList.forEach(function (n) { n.r = o.nodes === false ? 0 : rOf(n.in + n.out); });
        // arcs: bend capped for long chords; parallel flows between the same pair fan out
        var seen = {};
        flows.forEach(function (f) {
          var pair = f.from + '\u0001' + f.to, k = seen[pair] = (seen[pair] || 0) + 1;
          var chord = Math.sqrt(Math.pow(f.b[1] - f.a[1], 2) + Math.pow(f.b[0] - f.a[0], 2)) || 1;
          var curv = Math.min(o.curvature, 36 / chord) + (k - 1) * 0.07;
          f.pts = RK.geo.arc(f.a, f.b, curv, 48);
          f.w = wOf(f.v);
          f.color = enc.color ? cm(f.cat) : t.accent3 || t.cat[1];
          f.share = total ? f.v / total : null;
          f.dest = nodes.get(f.to);
        });
        return { flows: flows, nodes: nodeList, fmt: fmt, cats: cats, cm: cm, maxV: maxV, wOf: wOf, total: total };
      }

      function flowOn(f) { return isOn(cur, f.row, [ff(cur)]); }

      function flowTip(f) {
        var c = cur, enc = c.enc, rows = [{ color: f.color, label: c.title(enc.value), value: RK.format(f.v, S.fmt), bold: false }];
        if (enc.count) rows.push({ label: c.title(enc.count), value: RK.format(f.n, c.fmtOf(enc.count) || '#,##0') });
        if (f.share != null) rows.push({ label: 'Share of shown flows', value: RK.format(f.share, '0.0%') });
        if (enc.color) rows.push({ label: c.title(enc.color), value: f.cat });
        (c.options.tooltip || []).forEach(function (fld) { rows.push({ label: c.title(fld), value: RK.format(f.row[fld], c.fmtOf(fld)) }); });
        return RK.chart.tip(f.from + '  →  ' + f.to, rows);
      }
      function nodeTip(n) {
        var c = cur, enc = c.enc, cf = c.fmtOf(enc.count) || '#,##0';
        var rows = [
          { label: 'Outbound', value: RK.format(n.out, S.fmt) + (enc.count ? '  (' + RK.format(n.outN, cf) + ')' : '') },
          { label: 'Inbound', value: RK.format(n.in, S.fmt) + (enc.count ? '  (' + RK.format(n.inN, cf) + ')' : '') },
          { label: 'Net outbound', value: RK.format(n.out - n.in, S.fmt), bold: true }
        ];
        return RK.chart.tip(n.name, rows, enc.count ? 'Value (' + c.title(enc.count).toLowerCase() + ')' : null);
      }

      /** Hover focus: isolate the given flows (and their end nodes). */
      function focus(list) {
        el.classList.toggle('is-focus', !!list);
        [].forEach.call(el.querySelectorAll('.is-hot'), function (n) { n.classList.remove('is-hot'); });
        (list || []).forEach(function (f) { f.els.forEach(function (e) { if (e) e.classList.add('is-hot'); }); });
      }

      function draw(first) {
        S = derive(cur);
        timers.forEach(clearTimeout); timers = [];
        layer.clearLayers();
        var o = cur.options, sel = cur.selected(ff(cur)).length, motion = cur.motion;
        var dots = motion && o.animate !== false;
        // largest first so thin flows stay visible (and hoverable) on top
        S.flows.forEach(function (f, i) {
          var on = flowOn(f), op = on ? o.opacity : 0.1;
          var arc = L.polyline(f.pts, { color: f.color, weight: f.w, opacity: op, lineCap: 'round', interactive: false, className: 'rk-flow__arc' }).addTo(layer);
          var dash = dots ? L.polyline(f.pts, {
            color: t.paper, weight: Math.max(1.2, f.w * 0.42), opacity: on ? 0.9 : 0, lineCap: 'round', interactive: false,
            dashArray: '0.1 ' + Math.round(10 + f.w * 2.2), className: 'rk-flow__dots'
          }).addTo(layer) : null;
          var arrow = null;
          if (o.arrows !== false) {
            var p1 = map.project(f.pts[f.pts.length - 2], 0), p2 = map.project(f.pts[f.pts.length - 1], 0);
            var ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI, size = Math.max(6, f.w * 1.5 + 4);
            arrow = L.marker(f.b, {
              pane: 'rk-flow-arrows', interactive: false, keyboard: false,
              icon: L.divIcon({ className: 'rk-flow__arrow', iconSize: null, html: arrowHTML(size, f.color, ang, (f.dest ? f.dest.r : 0) + 1) })
            }).addTo(layer);
            var ae = arrow.getElement();
            if (ae) ae.style.opacity = on ? 0.95 : 0.1;
          }
          var hit = L.polyline(f.pts, { color: f.color, weight: Math.max(10, f.w + 6), opacity: 0, className: 'rk-flow__hit' }).addTo(layer);
          hit.bindTooltip(function () { return flowTip(f); }, { sticky: true, direction: 'top', offset: [0, -8], opacity: 1 });
          f.els = [arc.getElement(), dash && dash.getElement(), arrow && arrow.getElement()];
          hit.on('mouseover', function () { focus([f]); });
          hit.on('mouseout', function () { focus(null); });
          hit.on('click', function () {
            var fld = ff(cur), v = f.row[fld];
            if (cur.options.crossFilter !== false && v != null) cur.select(fld, v);
          });
          // entry: arcs draw from origin to destination, staggered by size
          if (motion && first) {
            var pe = arc.getElement(), len = pe && pe.getTotalLength ? pe.getTotalLength() : 0;
            if (len) {
              pe.style.strokeDasharray = len; pe.style.strokeDashoffset = len;
              pe.getBoundingClientRect();
              pe.style.transition = 'stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1) ' + Math.min(i * 45, 700) + 'ms';
              pe.style.strokeDashoffset = '0';
              timers.push(setTimeout(function () { pe.style.strokeDasharray = ''; pe.style.strokeDashoffset = ''; pe.style.transition = ''; }, 1800));
            }
            f.els.slice(1).forEach(function (e) { if (e) { e.classList.add('is-enter'); e.style.setProperty('--rk-d', (Math.min(i * 45, 700) + 650) + 'ms'); } });
          }
          if (sel && on) f.els.forEach(function (e) { if (e) e.classList.add('is-sel'); });
        });
        if (motion && first) timers.push(setTimeout(function () { [].forEach.call(el.querySelectorAll('.rk-flow .is-enter'), function (n) { n.classList.remove('is-enter'); }); }, 2400));

        if (o.nodes !== false) {
          S.nodes.forEach(function (n) {
            var m = L.circleMarker(n.ll, { radius: n.r, color: t.ink2, weight: 1.1, fillColor: t.paper, fillOpacity: 1, className: 'rk-flow__node' }).addTo(layer);
            m.bindTooltip(function () { return nodeTip(n); }, { direction: 'top', offset: [0, -n.r - 2], opacity: 1 });
            m.on('mouseover', function () { focus(S.flows.filter(function (f) { return f.from === n.name || f.to === n.name; })); m.setStyle({ color: t.ink, weight: 1.8 }); });
            m.on('mouseout', function () { focus(null); m.setStyle({ color: t.ink2, weight: 1.1 }); });
          });
        }

        // labels: countries (by total) first, then flow values at the arc apex
        var nl = Math.max(0, o.labels | 0), fl = Math.max(0, o.flowLabels | 0);
        var list = (nl ? S.nodes : []).map(function (n) {
          return { latlng: n.ll, r: n.r, prio: 1e12 + n.in + n.out, group: 'node', html: '<b>' + RK.util.escapeHTML(n.name) + '</b>' };
        }).concat((fl ? S.flows : []).map(function (f) {
          return { latlng: f.pts[Math.floor(f.pts.length / 2)], r: f.w / 2, prio: f.v, group: 'flow', pos: ['c', 't', 'b'], cls: 'rk-flow__vlabel', html: RK.util.escapeHTML(RK.format(f.v, S.fmt)) };
        }));
        labels.set(list, { node: nl, flow: fl }, S.nodes.map(function (n) { return { ll: n.ll, r: n.r }; }));

        if (o.legend !== false) {
          var secs = [];
          if (cur.enc.color && S.cats.length) {
            secs.push(legSec(cur.title(cur.enc.color), catItems(S.cats, S.cm, cur.selected(cur.enc.color),
              o.crossFilter !== false ? function (v) { cur.select(cur.enc.color, v); } : null, 'line')));
          }
          var refs = sizeRefs(S.maxV).slice(0, 3), lf = tidyFmt(S.fmt, refs);
          if (refs.length) {
            secs.push(legSec(fieldTitle(cur, cur.enc.value), h('div.rk-geo-leg__items', refs.map(function (v) {
              return h('div.rk-geo-leg__item', h('i.rk-flow__wsw', { style: { height: S.wOf(v).toFixed(1) + 'px', background: cur.enc.color ? t.ink3 : t.accent3 || t.cat[1] } }), h('span', RK.format(v, lf)));
            }))));
          }
          legend.set(secs.length ? h('div.rk-geo-leg' + (secs.length > 1 ? '.is-row' : ''), secs) : null);
        } else legend.set(null);

        if (first) {
          var pts = [];
          S.flows.forEach(function (f) { pts.push(f.a, f.b, f.pts[Math.floor(f.pts.length / 2)]); });
          view.fit(fitTarget(o.fit, pts), 14, function () { return S.nodes.map(function (n) { return { ll: n.ll, r: n.r + 2 }; }); });
          labels.place();
        }
      }

      draw(true);

      return {
        update: function (c) { cur = c; draw(false); },
        resize: function () { view.resize(); labels.place(); },
        destroy: function () { timers.forEach(clearTimeout); el.classList.remove('is-focus'); view.destroy(); },
        exportImage: function () { return snapshot(cur, map); }
      };
    }
  });
})();
