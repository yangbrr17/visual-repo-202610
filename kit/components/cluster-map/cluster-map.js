/*!
 * RK component: cluster-map — dense point layers grouped with Leaflet.markercluster.
 * Themed cluster bubbles (accent disc with the count or a summed value, outer ring split by
 * category share), coverage polygon on hover, spiderfy at max zoom, rich tooltips for both
 * clusters (breakdown by category) and points, click a point / legend entry to cross-filter.
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

  /** Cluster bubble SVG: accent disc + ring segments by category share. */
  function clusterSVG(size, parts, total, text, t) {
    var c = size / 2, rr = c - 2.5, circ = 2 * Math.PI * rr, off = 0, ring = '';
    if (parts.length > 1 || (parts.length === 1 && parts[0].color)) {
      parts.forEach(function (p) {
        var len = circ * p.n / total;
        ring += '<circle cx="' + c + '" cy="' + c + '" r="' + rr.toFixed(2) + '" fill="none" stroke="' + p.color + '" stroke-width="4"' +
          ' stroke-dasharray="' + Math.max(0, len - (parts.length > 1 ? 1.2 : 0)).toFixed(2) + ' ' + circ.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"' +
          ' transform="rotate(-90 ' + c + ' ' + c + ')"/>';
        off += len;
      });
    } else ring = '<circle cx="' + c + '" cy="' + c + '" r="' + rr.toFixed(2) + '" fill="none" stroke="' + RK.theme.alpha(t.accent, 0.28) + '" stroke-width="4"/>';
    var fs = size < 36 ? 10.5 : size < 48 ? 11.5 : 12.5;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + ring +
      '<circle cx="' + c + '" cy="' + c + '" r="' + (rr - 3.5).toFixed(2) + '" fill="' + t.accent + '" stroke="' + t.paper + '" stroke-width="1"/>' +
      '<text x="' + c + '" y="' + (c + fs * 0.36).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '" fill="' + RK.theme.onColor(t.accent, t.ink, '#fff') + '">' +
      RK.util.escapeHTML(text) + '</text></svg>';
  }

  RK.component({
    id: 'cluster-map',
    deps: ['leaflet', 'leaflet-markercluster', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { lat: 'lat', lon: 'lon', label: 'name', color: null, value: null },
      basemap: 'world-110m',
      clusterRadius: 50,          // px radius within which points merge (markercluster maxClusterRadius)
      clusterValue: 'count',      // count | sum — number shown in a cluster (sum of encode.value)
      disableAt: null,            // zoom level from which points are never clustered
      coverage: true,             // outline the area a cluster covers on hover
      spiderfy: true,             // fan out overlapping points at max zoom
      pointSize: 11,              // point diameter in px
      format: null,               // value format; defaults to the value field format
      tooltip: [],                // extra fields listed in point tooltips
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      legendPosition: 'bottomleft',
      filterField: null,          // click-to-filter field; defaults to encode.label
      scrollZoom: 'click'         // true | false | 'click'
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx;
      if (!L.markerClusterGroup) throw new Error('leaflet.markercluster is not loaded (add "leaflet-markercluster" to deps)');
      var o0 = ctx.options;
      var view = geoView(ctx, o0, 'rk-cluster'), map = view.map;
      var legend = legendControl(map, o0.legendPosition), S = null;

      function ff(c) { return c.options.filterField || c.enc.label; }
      function partsOf(markers) {
        var enc = cur.enc, m = new Map();
        markers.forEach(function (mk) {
          var k = enc.color ? mk.it.row[enc.color] : '', p = m.get(k);
          if (!p) m.set(k, p = { key: k, n: 0, v: 0, color: enc.color ? S.colorOf(k) : null });
          p.n++; p.v += mk.it.v || 0;
        });
        return Array.from(m.values()).sort(function (a, b) { return enc.color ? S.cats.indexOf(a.key) - S.cats.indexOf(b.key) : 0; });
      }
      function sumFmt(v) {
        var f = S.fmt && typeof S.fmt === 'string' ? S.fmt.replace(/0\.0+/g, '0') : '#,##0';
        return Math.abs(v) >= 1e5 ? RK.format(v, 'auto') : RK.format(v, f);
      }

      var group = L.markerClusterGroup({
        maxClusterRadius: o0.clusterRadius,
        disableClusteringAtZoom: o0.disableAt,
        showCoverageOnHover: o0.coverage !== false,
        spiderfyOnMaxZoom: o0.spiderfy !== false,
        zoomToBoundsOnClick: true,
        animate: ctx.motion,
        polygonOptions: { color: t.accent, weight: 1, opacity: 0.7, dashArray: '3 3', fillColor: t.accent, fillOpacity: 0.06, interactive: false },
        spiderLegPolylineOptions: { weight: 1, color: t.ink3, opacity: 0.7 },
        iconCreateFunction: function (cl) {
          var ms = cl.getAllChildMarkers(), n = ms.length, parts = partsOf(ms);
          var sum = parts.reduce(function (s, p) { return s + p.v; }, 0), useSum = cur.options.clusterValue === 'sum' && cur.enc.value;
          var size = useSum && S.total ? Math.round(30 + 30 * Math.sqrt(sum / S.total)) : Math.round(Math.min(60, 28 + 7 * Math.log2(n)));
          return L.divIcon({ className: 'rk-cluster__icon', iconSize: [size, size], html: clusterSVG(size, parts, n, useSum ? sumFmt(sum) : String(n), t) });
        }
      }).addTo(map);

      group.on('clustermouseover', function (e) {
        var ms = e.layer.getAllChildMarkers(), parts = partsOf(ms), c = cur, enc = c.enc;
        var rows = parts.map(function (p) {
          return { color: p.color, label: enc.color ? String(p.key) : 'Points', value: String(p.n) + (enc.value ? '  ·  ' + RK.format(p.v, S.fmt) : '') };
        });
        if (enc.value) rows.push({ label: 'Total ' + c.title(enc.value).toLowerCase(), value: RK.format(parts.reduce(function (s, p) { return s + p.v; }, 0), S.fmt), bold: true });
        var sz = e.layer.options.icon && e.layer.options.icon.options.iconSize ? e.layer.options.icon.options.iconSize[1] : 30;
        e.layer.bindTooltip(RK.chart.tip(ms.length + ' ' + (S.noun || 'points'), rows, 'Click to zoom in'), { direction: 'top', offset: [0, -sz / 2], opacity: 1 }).openTooltip();
      });
      group.on('clustermouseout', function (e) { e.layer.unbindTooltip(); });

      function derive(c) {
        var enc = c.enc, o = c.options, dom = domainRows(c);
        var cats = enc.color ? RK.util.unique(dom.map(function (r) { return r[enc.color]; }).filter(function (v) { return v != null && v !== ''; })) : [];
        var colorOf = enc.color ? catScale(cats, palette(t, false), t) : function () { return t.accent3 || t.cat[1]; };
        var total = enc.value ? dom.reduce(function (s, r) { return s + (num(r[enc.value]) || 0); }, 0) : 0;
        var items = c.rows.filter(function (r) { return num(r[enc.lat]) != null && num(r[enc.lon]) != null; }).map(function (r) {
          return { row: r, ll: [r[enc.lat], r[enc.lon]], v: enc.value ? num(r[enc.value]) : null, color: colorOf(enc.color ? r[enc.color] : null) };
        });
        var noun = c.dataset && /site|asset|location|plant/i.test((c.dataset.title || '') + ' ' + (c.title(enc.label) || '')) ? 'sites' : 'points';
        return { items: items, cats: cats, colorOf: colorOf, total: total, fmt: o.format || (enc.value ? c.fmtOf(enc.value) : null) || 'auto', noun: noun };
      }

      function tipOf(it) {
        var c = cur, enc = c.enc, r = it.row, rows = [];
        if (enc.color) rows.push({ color: it.color, label: c.title(enc.color), value: RK.format(r[enc.color]) });
        if (enc.value) rows.push({ label: c.title(enc.value), value: RK.format(it.v, S.fmt) });
        (c.options.tooltip || []).forEach(function (f) { rows.push({ label: c.title(f), value: RK.format(r[f], c.fmtOf(f)) }); });
        return RK.chart.tip(r[enc.label], rows);
      }

      function draw(first) {
        S = derive(cur);
        var o = cur.options, sz = o.pointSize || 11, field = ff(cur);
        var markers = S.items.map(function (it) {
          var on = isOn(cur, it.row, [field, cur.enc.color]);
          var m = L.marker(it.ll, {
            icon: L.divIcon({ className: 'rk-cluster__pt-icon', iconSize: [sz, sz], html: '<span class="rk-cluster__pt" style="background:' + it.color + '"></span>' }),
            opacity: on ? 1 : 0.28, riseOnHover: true, keyboard: false
          });
          m.it = it;
          m.bindTooltip(function () { return tipOf(it); }, { direction: 'top', offset: [0, -sz / 2 - 2], opacity: 1 });
          m.on('click', function () {
            var v = it.row[field];
            if (cur.options.crossFilter !== false && v != null) cur.select(field, v);
          });
          return m;
        });
        group.clearLayers();
        group.addLayers(markers);

        if (o.legend !== false) {
          var secs = [];
          if (cur.enc.color && S.cats.length) {
            secs.push(legSec(cur.title(cur.enc.color), catItems(S.cats, S.colorOf, cur.selected(cur.enc.color),
              o.crossFilter !== false ? function (v) { cur.select(cur.enc.color, v); } : null)));
          }
          var key = o.clusterValue === 'sum' && cur.enc.value ? 'Cluster: total ' + cur.title(cur.enc.value).toLowerCase() : 'Cluster: number of ' + S.noun;
          secs.push(h('div.rk-geo-leg__sec', h('div.rk-geo-leg__item', h('i.rk-cluster__key', { html: clusterSVG(20, [], 1, '', t) }), h('span', key))));
          legend.set(h('div.rk-geo-leg', secs));
        } else legend.set(null);

        if (first) view.fit(fitTarget(o.fit, S.items.map(function (it) { return it.ll; })), 28, function () { return S.items.map(function (it) { return { ll: it.ll, r: 14 }; }); });
      }

      draw(true);

      return {
        update: function (c) { cur = c; draw(false); },
        resize: function () { view.resize(); },
        destroy: function () { group.off(); view.destroy(); },
        exportImage: function () { return snapshot(cur, map); }
      };
    }
  });
})();
