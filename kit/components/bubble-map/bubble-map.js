/*!
 * RK component: bubble-map — proportional symbols at lat / lon on the offline basemap.
 * Area-true (sqrt) radius by a value, colour by a category (clickable legend) or by a numeric
 * field (sequential / diverging ramp), nested size legend, collision-aware labels for the top N,
 * grow-in on render, target highlight in accent-2, click to cross-filter.
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
    function fit(target, pad) {
      if (target !== undefined) { st.target = target; st.pad = pad == null ? 16 : pad; }
      var b = st.target;
      if (!b) return;
      st.fitting = true;
      try {
        if (b.center) map.setView(b.center, b.zoom != null ? b.zoom : 2, { animate: false });
        else map.fitBounds(b, { padding: [st.pad, st.pad], maxZoom: o.fitMaxZoom || 6, animate: false });
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

  /** Collision-aware HTML labels in the 'rk-labels' pane: the top `max` visible items by priority that fit. */
  function labelLayer(map) {
    var L = window.L, group = L.layerGroup().addTo(map), items = [], max = Infinity;
    function overlap(a, b) { return a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y; }
    function place() {
      var size = map.getSize(), box0 = map.getContainer().getBoundingClientRect();
      // controls (zoom, legend, toggles) are obstacles
      var placed = [].map.call(map.getContainer().querySelectorAll('.leaflet-control'), function (c) {
        var r = c.getBoundingClientRect();
        return { x: r.left - box0.left, y: r.top - box0.top, w: r.width, h: r.height };
      });
      var shown = 0;
      items.slice().sort(function (a, b) { return b.it.prio - a.it.prio; }).forEach(function (x) {
        var icon = x.m.getElement();
        if (!icon) return;
        if (shown >= max) { icon.firstChild.classList.add('is-hidden'); return; }
        var span = icon.firstChild, w = span.offsetWidth, ht = span.offsetHeight, r = x.it.r || 0, g = 3;
        var p = map.latLngToContainerPoint(x.it.latlng), hit = null;
        (x.it.pos || ['r', 'l', 't', 'b']).some(function (k) {
          var d = k === 'c' ? [-w / 2, -ht / 2] : k === 'r' ? [r + g, -ht / 2] : k === 'l' ? [-r - g - w, -ht / 2] : k === 't' ? [-w / 2, -r - g - ht] : [-w / 2, r + g];
          var b = { x: p.x + d[0], y: p.y + d[1], w: w, h: ht };
          if (b.x < 2 || b.y < 2 || b.x + w > size.x - 2 || b.y + ht > size.y - 2) return false;
          if (placed.some(function (q) { return overlap(b, q); })) return false;
          placed.push(b); hit = d;
          return true;
        });
        span.style.transform = hit ? 'translate(' + Math.round(hit[0]) + 'px,' + Math.round(hit[1]) + 'px)' : '';
        span.classList.toggle('is-hidden', !hit);
        if (hit) shown++;
      });
    }
    map.on('zoomend moveend resize', place);
    return {
      /** list: [{latlng, html, r, prio, pos, cls}]; n: max labels shown at once */
      set: function (list, n) {
        max = n == null ? Infinity : n;
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
    vs.forEach(function (v) { var last = kept[kept.length - 1]; if (!last || 2 * (rOf(last) - rOf(v)) >= 11) kept.push(v); });
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
    return RK.util.unique([top, niceRound(top / 3), niceRound(top / 10)]);
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

  RK.component({
    id: 'bubble-map',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { lat: 'lat', lon: 'lon', size: 'value', color: null, label: 'name' },
      basemap: 'world-110m',
      sizeRange: [4, 26],         // min / max radius in px (sqrt scale, so area tracks the value)
      colorScale: 'auto',         // auto (categorical for text, sequential for numbers) | categorical | sequential | diverging
      mid: 0,                     // diverging midpoint
      opacity: 0.78,              // bubble fill opacity
      labels: 5,                  // labels for the top N bubbles by size (0 = none); crowded labels hide
      labelValue: true,           // append the size value to labels
      highlight: null,            // label value(s) drawn in accent-2 and always labelled (e.g. the target)
      format: null,               // size format; defaults to the size field format
      tooltip: [],                // extra fields listed in the tooltip
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      sizeLegend: true,
      legendPosition: 'bottomleft',
      filterField: null,          // click-to-filter field; defaults to encode.label
      scrollZoom: 'click'         // true | false | 'click'
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx;
      var view = geoView(ctx, ctx.options, 'rk-bubble'), map = view.map;
      var group = L.featureGroup().addTo(map);
      var labels = labelLayer(map), legend = legendControl(map, ctx.options.legendPosition);
      var marks = {}, S = null, timer = null;

      function ff(c) { return c.options.filterField || c.enc.label; }
      function keyOf(r, enc) { return [r[enc.label], r[enc.lat], r[enc.lon]].join('|'); }

      function derive(c) {
        var enc = c.enc, o = c.options;
        var dom = domainRows(c), fmt = o.format || c.fmtOf(enc.size) || 'auto';
        var sizes = dom.map(function (r) { return num(r[enc.size]); });
        var rOf = RK.geo.radius(sizes, o.sizeRange || [4, 26]);
        var hl = o.highlight == null ? [] : [].concat(o.highlight);
        var cf = enc.color, fld = cf ? c.field(cf) : null;
        var mode = !cf ? 'none' : o.colorScale !== 'auto' ? o.colorScale : (fld && fld.type === 'number' ? 'sequential' : 'categorical');
        var colorOf, cats = [], cfmt = cf ? c.fmtOf(cf) || 'auto' : null, ext = null;
        if (mode === 'categorical') {
          cats = RK.util.unique(dom.map(function (r) { return r[cf]; }).filter(function (v) { return v != null && v !== ''; }));
          var cm = RK.theme.categorical(cats);
          colorOf = function (r) { return cm(r[cf]); };
        } else if (mode === 'sequential' || mode === 'diverging') {
          ext = RK.util.extent(dom.map(function (r) { return num(r[cf]); }));
          var sc;
          if (mode === 'diverging') {
            var dev = Math.max(Math.abs(ext[0] - o.mid), Math.abs(ext[1] - o.mid)) || 1;
            ext = [o.mid - dev, o.mid + dev];
            sc = RK.theme.diverging(ext, o.mid);
          } else sc = RK.theme.sequential(ext, seqStops(t));
          colorOf = function (r) { return num(r[cf]) == null ? t.neutral : sc(r[cf]); };
        } else colorOf = function () { return t.accent3 || t.cat[1]; };
        var items = c.rows.filter(function (r) { return num(r[enc.lat]) != null && num(r[enc.lon]) != null; }).map(function (r) {
          var v = num(r[enc.size]), isHl = hl.indexOf(r[enc.label]) >= 0;
          return { key: keyOf(r, enc), row: r, v: v, r: rOf(v), color: isHl ? t.accent2 : colorOf(r), hl: isHl, ll: [r[enc.lat], r[enc.lon]] };
        });
        items.sort(function (a, b) { return (b.v || 0) - (a.v || 0); });   // big first so small bubbles stay clickable on top
        return { items: items, rOf: rOf, fmt: fmt, mode: mode, cats: cats, colorOf: colorOf, cfmt: cfmt, ext: ext, maxV: RK.util.extent(sizes)[1] };
      }

      function styleOf(it) {
        var on = isOn(cur, it.row, [ff(cur), cur.enc.color]), anySel = cur.selected(ff(cur)).length;
        return {
          radius: it.r, fillColor: it.color, fillOpacity: on ? (it.hl ? 0.95 : cur.options.opacity) : 0.12,
          color: it.hl ? t.ink : (on && anySel ? t.ink : t.paper), weight: it.hl || (on && anySel) ? 1.4 : 0.8, opacity: on ? 1 : 0.4
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
        m.on('mouseout', function () { m.setStyle(styleOf(m.it)); });
        m.on('click', function () {
          var f = ff(cur), v = m.it.row[f];
          if (cur.options.crossFilter !== false && v != null) cur.select(f, v);
        });
        m.it = it;
        group.addLayer(m);
        var el = m.getElement();
        if (el && cur.motion) { el.classList.add('is-enter'); el.style.setProperty('--rk-d', Math.min(rank * 14, 560) + 'ms'); }
        return m;
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
        // keep paint order = size order (largest underneath)
        S.items.slice().reverse().forEach(function (it) { if (it.hl) marks[it.key].bringToFront(); });
        if (grow.length) RK.motion.tween(cur.motion ? 450 : 0, function (k) {
          grow.forEach(function (g) { g[0].setRadius(g[1] + (g[2] - g[1]) * k); });
        });
        if (cur.motion) {
          clearTimeout(timer);
          timer = setTimeout(function () { [].forEach.call(ctx.el.querySelectorAll('.rk-bubble__dot.is-enter'), function (n) { n.classList.remove('is-enter'); }); }, 1400);
        }

        var n = Math.max(0, o.labels | 0);
        labels.set(S.items.filter(function (it) { return n || it.hl; }).map(function (it, i) {
          var name = RK.util.escapeHTML(it.row[enc.label] == null ? '' : it.row[enc.label]);
          return {
            latlng: it.ll, r: it.r, prio: it.hl ? Infinity : (it.v || 0), cls: it.hl ? 'is-hl' : '',
            html: '<b>' + name + '</b>' + (o.labelValue ? ' <span>' + RK.util.escapeHTML(RK.format(it.v, S.fmt)) + '</span>' : '')
          };
        }), n + S.items.filter(function (it) { return it.hl; }).length);

        if (o.legend !== false) {
          var secs = [];
          if (S.mode === 'categorical') {
            secs.push(legSec(cur.title(enc.color), catItems(S.cats, function (v) { return RK.theme.categorical(S.cats)(v); }, cur.selected(enc.color),
              cur.options.crossFilter !== false ? function (v) { cur.select(enc.color, v); } : null)));
          } else if (S.mode === 'sequential' || S.mode === 'diverging') {
            var stops = S.mode === 'diverging' ? t.div : seqStops(t);
            var ticks = S.mode === 'diverging' ? [S.ext[0], o.mid, S.ext[1]] : S.ext;
            secs.push(legSec(fieldTitle(cur, enc.color), rampEl(stops, ticks.map(function (v) { return RK.format(v, S.cfmt); }))));
          }
          if (o.sizeLegend !== false) {
            var refs = sizeRefs(S.maxV);
            var sl = sizeLegendEl(refs, S.rOf, tidyFmt(S.fmt, refs), t.ink3);
            if (sl) secs.push(legSec(fieldTitle(cur, enc.size), sl));
          }
          if (S.items.some(function (it) { return it.hl; })) {
            secs.push(h('div.rk-geo-leg__sec', catItems([].concat(o.highlight), function () { return t.accent2; }, null, null)));
          }
          legend.set(secs.length ? h('div.rk-geo-leg', secs) : null);
        } else legend.set(null);

        if (first) {
          var pad = (o.sizeRange ? o.sizeRange[1] : 26) * 0.6 + 10;
          view.fit(fitTarget(o.fit, S.items.map(function (it) { return it.ll; })), pad);
          labels.place();
        }
      }

      draw(true);

      return {
        update: function (c) { cur = c; draw(false); },
        resize: function () { view.resize(); labels.place(); },
        destroy: function () { clearTimeout(timer); view.destroy(); },
        exportImage: function () { return snapshot(cur, map); }
      };
    }
  });
})();
