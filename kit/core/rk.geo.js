/*!
 * ReportKit geo — offline-first geographic helpers shared by map components.
 *
 * Basemaps ship as classic scripts (vendor/geo-world/world-110m.js) because file:// cannot
 * fetch JSON; they call RK.geo.register(name, topojsonOrGeojson). No tile server is needed:
 * the land layer is drawn from Natural Earth polygons in theme colours. An online tile layer
 * can still be added per block with options.tiles = {url, attribution}.
 *
 *   var m = RK.geo.leaflet(ctx, {basemap: 'world-110m'});   // themed Leaflet map, no tiles
 *   var fc = RK.geo.features('world-110m');                  // GeoJSON FeatureCollection
 *   RK.geo.echartsMap('world-110m');                          // registers 'world-110m' for ECharts geo
 *   var r = RK.geo.radius(values, [4, 28]);                    // sqrt area scale for bubbles
 *   var pts = RK.geo.arc([lat1, lon1], [lat2, lon2], 0.25);    // curved flow line
 *
 * Map components (choropleth, bubble-map, flow-map, cluster-map, geo-heat) share a small kit:
 *
 *   var view = RK.geo.view(ctx, {cls: 'rk-bubble'});     // themed map, fit / refit-on-resize, wheel rule, teardown
 *   view.fit(RK.geo.fitTarget(o.fit, latlngs), pad, avoid); // avoid() -> [{ll, r}]: marks the legend must not cover
 *   var labels = view.labels();                             // collision-aware HTML labels (RK.geo.labels)
 *   var legend = view.legend();                             // swappable legend control (RK.geo.legendControl)
 *   legend.set(RK.geo.legendSection(title, RK.geo.legendItems(cats, colorOf, {selected, onClick})));
 *   RK.geo.select(ctx, field, value);                       // cross-filter, scoped (shared dimension -> global)
 *   return view.instance({update: fn, destroy: fn});        // {update, resize, destroy, exportImage}
 *
 * Wheel rule (as in every RK chart): a plain wheel scrolls the report; Ctrl/Cmd + wheel or a trackpad
 * pinch zooms the map; options.scrollZoom 'click' arms plain-wheel zoom after a click on the map,
 * true (or options.wheelZoom: true) always zooms on the wheel. Zoom buttons are hidden in print.
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});

  var raw = Object.create(null), cache = Object.create(null);

  /* world-atlas targets spherical renderers; rings that jump across +/-180 (Russia, Fiji) draw a
     stripe across planar maps (Leaflet, ECharts geo). Split them into planar pieces once, on load. */
  function crossLat(a, b) {
    var bx = b[0] + (a[0] > 0 ? 360 : -360), e = a[0] > 0 ? 180 : -180;
    return a[1] + (b[1] - a[1]) * (e - a[0]) / ((bx - a[0]) || 1);
  }
  function splitRing(ring) {
    var j = [];
    for (var i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) j.push(i);
    if (j.length === 1) {   // polar ring (Antarctica): close it along the pole
      var a = ring[j[0] - 1], b = ring[j[0]], la = crossLat(a, b), pole = a[1] < 0 ? -90 : 90, ea = a[0] > 0 ? 180 : -180;
      return [ring.slice(0, j[0]).concat([[ea, la], [ea, pole], [-ea, pole], [-ea, la]], ring.slice(j[0]))];
    }
    if (j.length !== 2) return [ring];
    var p = ring[j[0] - 1], q = ring[j[0]], r = ring[j[1] - 1], s2 = ring[j[1]], l1 = crossLat(p, q), l2 = crossLat(r, s2);
    var side = function (pt) { return pt[0] > 0 ? 180 : -180; };
    return [
      [[side(s2), l2]].concat(ring.slice(j[1]), ring.slice(0, j[0]), [[side(p), l1]]),
      [[side(q), l1]].concat(ring.slice(j[0], j[1]), [[side(r), l2]])
    ];
  }
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

  function toFeatures(name) {
    if (cache[name]) return cache[name];
    var d = raw[name];
    if (!d && global.__RK_GEO && global.__RK_GEO[name]) d = raw[name] = global.__RK_GEO[name];
    if (!d) throw new Error('Basemap "' + name + '" is not loaded (include vendor/geo-world/' + name + '.js and add "geo-world" to the component deps)');
    var fc;
    if (d.type === 'Topology') {
      if (!global.topojson) throw new Error('topojson-client is required to read TopoJSON basemap "' + name + '"');
      var key = Object.keys(d.objects)[0];
      if (d.objects.countries) key = 'countries';
      fc = global.topojson.feature(d, d.objects[key]);
    } else fc = d.type === 'FeatureCollection' ? d : { type: 'FeatureCollection', features: [d] };
    // normalise ids: ISO numeric as zero-padded strings
    fc.features.forEach(function (f) {
      if (f.id != null && /^\d+$/.test(String(f.id))) f.id = String(f.id).padStart(3, '0');
      f.properties = f.properties || {};
    });
    planar(fc);
    cache[name] = fc;
    return fc;
  }

  /** Largest-ring centroid (good enough for label / bubble placement). */
  function centroid(feature) {
    var g = feature.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    var best = null, bestA = -1;
    polys.forEach(function (poly) {
      var ring = poly[0], a = 0, cx = 0, cy = 0;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
      }
      if (Math.abs(a) > bestA && a !== 0) { bestA = Math.abs(a); best = [cy / (3 * a), cx / (3 * a)]; }
    });
    return best; // [lat, lon]
  }

  /** Ctrl/Cmd + wheel and trackpad pinch (a ctrl-wheel in browsers) zoom the map around the pointer, like
      ECharts' zoomOnMouseWheel: 'ctrl'; a plain wheel is left to the page unless wheel zoom is enabled. */
  function modifierZoom(map) {
    var L = global.L, el = map.getContainer(), acc = 0, at = null, raf = 0;
    function step() {
      raf = 0;
      var z = map.getZoom(), snap = map.options.zoomSnap || 0.25, lo = map.getMinZoom(), hi = map.getMaxZoom();
      var raw = z + acc / (map.options.wheelPxPerZoomLevel || 120), next = Math.max(lo, Math.min(hi, Math.round(raw / snap) * snap));
      if (next !== z) { acc = 0; map.setZoomAround(at, next, { animate: false }); } else if (raw <= lo || raw >= hi) acc = 0;
    }
    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey) || map.scrollWheelZoom.enabled()) return;
      L.DomEvent.stop(e);                          // also stops the browser's page zoom on pinch
      acc += L.DomEvent.getWheelDelta(e);
      at = map.mouseEventToContainerPoint(e);
      if (!raf) raf = global.requestAnimationFrame(step);
    }
    L.DomEvent.on(el, 'wheel', onWheel);
    map.on('unload', function () { L.DomEvent.off(el, 'wheel', onWheel); if (raf) global.cancelAnimationFrame(raf); });
  }

  var geo = RK.geo = {
    register: function (name, data) { raw[name] = data; delete cache[name]; },
    has: function (name) { return !!(raw[name] || (global.__RK_GEO && global.__RK_GEO[name])); },
    features: toFeatures,
    planar: planar,
    centroid: centroid,

    /** Register a basemap with ECharts (echarts.registerMap) and return its name. */
    echartsMap: function (name) {
      if (!global.echarts) throw new Error('ECharts not loaded');
      if (!global.echarts.getMap(name)) global.echarts.registerMap(name, toFeatures(name));
      return name;
    },

    /** sqrt (area-true) radius scale. */
    radius: function (values, range) {
      range = range || [4, 28];
      var max = 0;
      values.forEach(function (v) { if (v != null && isFinite(v)) max = Math.max(max, Math.abs(v)); });
      return function (v) {
        if (v == null || !isFinite(v) || !max) return range[0];
        return range[0] + (range[1] - range[0]) * Math.sqrt(Math.abs(v) / max);
      };
    },

    /** Quadratic Bezier arc between two [lat, lon] points, returned as a list of [lat, lon]. */
    arc: function (a, b, curvature, steps) {
      curvature = curvature == null ? 0.22 : curvature;
      steps = steps || 32;
      var dx = b[1] - a[1], dy = b[0] - a[0];
      // control point: midpoint offset perpendicular to the chord
      var mx = (a[1] + b[1]) / 2 - dy * curvature, my = (a[0] + b[0]) / 2 + dx * curvature;
      var out = [];
      for (var i = 0; i <= steps; i++) {
        var t = i / steps, u = 1 - t;
        out.push([u * u * a[0] + 2 * u * t * my + t * t * b[0], u * u * a[1] + 2 * u * t * mx + t * t * b[1]]);
      }
      return out;
    },

    /**
     * Themed Leaflet map with an offline land basemap (no tiles).
     * opts: {basemap:'world-110m', tiles:{url, attribution}, center:[lat,lon], zoom, bounds:[[s,w],[n,e]], minZoom, maxZoom,
     *        scrollWheelZoom (default false; Ctrl/Cmd + wheel and pinch always zoom), antarctica (default false),
     *        zoomControl (default: not in print)}
     * Returns {map, land, fit(boundsOrLatLngs)}. Caller is responsible for map.remove() in destroy().
     */
    leaflet: function (ctx, opts) {
      if (!global.L) throw new Error('Leaflet is not loaded (vendor/leaflet)');
      opts = opts || {};
      var t = ctx.theme, L = global.L;
      ctx.el.classList.add('rk-map');
      var map = L.map(ctx.el, {
        zoomControl: opts.zoomControl != null ? opts.zoomControl : !ctx.print,   // print: no buttons
        attributionControl: true,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
        // a plain wheel would hijack page scrolling in a long report: off unless asked (Ctrl/Cmd + wheel, pinch, buttons, dblclick zoom)
        scrollWheelZoom: opts.scrollWheelZoom != null ? opts.scrollWheelZoom : false,
        worldCopyJump: false,
        minZoom: opts.minZoom != null ? opts.minZoom : 1,
        maxZoom: opts.maxZoom != null ? opts.maxZoom : 8,
        zoomAnimation: ctx.motion,
        fadeAnimation: ctx.motion,
        markerZoomAnimation: ctx.motion,
        preferCanvas: !!opts.preferCanvas
      });
      map.attributionControl.setPrefix(false);
      modifierZoom(map);
      ctx.el.style.background = t.mapWater || t.surface;
      var land = null;
      if (opts.tiles && opts.tiles.url) {
        L.tileLayer(opts.tiles.url, { attribution: opts.tiles.attribution || '', maxZoom: 18 }).addTo(map);
      } else if (opts.basemap !== false) {
        var name = opts.basemap || 'world-110m';
        var landFc = toFeatures(name);
        if (opts.antarctica !== true) landFc = { type: 'FeatureCollection', features: landFc.features.filter(function (f) { return f.id !== '010'; }) };
        land = L.geoJSON(landFc, {
          interactive: false,
          style: function () { return { color: t.mapBorder || t.paper, weight: 0.6, fillColor: t.mapLand || t.surface2, fillOpacity: 1 }; }
        }).addTo(map);
        map.attributionControl.addAttribution('Natural Earth');
      }
      if (opts.bounds) map.fitBounds(opts.bounds, { padding: [8, 8] });
      else map.setView(opts.center || [25, 10], opts.zoom != null ? opts.zoom : 1.5);
      return {
        map: map,
        land: land,
        fit: function (latlngs, pad) {
          if (!latlngs || !latlngs.length) return;
          try { map.fitBounds(L.latLngBounds(latlngs), { padding: [pad || 24, pad || 24], maxZoom: opts.fitMaxZoom || 5, animate: false }); } catch (e) { /* ignore */ }
        }
      };
    },

    /** HTML legend control for Leaflet maps: items [{color, label}] or ramp {stops, min, max, format}. */
    legend: function (map, html, position) {
      var L = global.L;
      var ctl = L.control({ position: position || 'bottomleft' });
      ctl.onAdd = function () {
        var div = L.DomUtil.create('div', 'rk-map-legend');
        if (typeof html === 'string') div.innerHTML = html; else div.appendChild(html);
        L.DomEvent.disableClickPropagation(div);
        return div;
      };
      ctl.addTo(map);
      return ctl;
    },

    /** Build a gradient legend element. */
    rampLegend: function (title, stops, min, max, fmt) {
      var h = RK.util.h;
      return h('div.rk-map-legend__ramp',
        title ? h('div.rk-map-legend__title', title) : null,
        h('div.rk-legend__ramp', { style: { background: 'linear-gradient(90deg,' + stops.join(',') + ')', width: '140px' } }),
        h('div.rk-map-legend__ticks', h('span', RK.format(min, fmt)), h('span', RK.format(max, fmt))));
    }
  };

  /* ------------------------------------------------------------------ *
   * Map component kit (choropleth, bubble-map, flow-map, cluster-map, geo-heat)
   * ------------------------------------------------------------------ */
  var WORLD = [[-48, -168], [72, 180]];   // what a 'world' / clamped 'data' fit shows (no polar extremes)

  /**
   * Map view for a component: RK.geo.leaflet + fit / refit-on-resize bookkeeping + clean teardown.
   * opts: {cls} plus overrides of the block options it reads: basemap, maxZoom, fitMaxZoom (6),
   * scrollZoom ('click' | true | false; options.wheelZoom: true forces true), legendPosition.
   * Returns {map, land, fit(target, pad, avoid), resize(), destroy(), labels(), legend(position), instance(hooks)}.
   */
  function view(ctx, opts) {
    opts = opts || {};
    var L = global.L, el = ctx.el, o = ctx.options, cls = opts.cls;
    function opt(k) { return opts[k] !== undefined ? opts[k] : o[k]; }
    var wheel = o.wheelZoom === true ? true : opt('scrollZoom');
    var v = geo.leaflet(ctx, { basemap: opt('basemap') || 'world-110m', minZoom: 0, maxZoom: opt('maxZoom') || 8, scrollWheelZoom: wheel === true });
    var map = v.map, st = { moved: false, fitting: false, target: null, pad: 16, avoid: null }, layers = [];
    el.classList.add('rk-geo');
    if (cls) el.classList.add(cls);
    if (ctx.motion) el.classList.add('is-motion');
    map.createPane('rk-labels').style.zIndex = 640;
    map.on('dragstart', function () { st.moved = true; });
    map.on('zoomstart', function () { if (!st.fitting) st.moved = true; });
    if (wheel === 'click') {   // plain-wheel zoom armed by a click on the map, disarmed when the pointer leaves
      map.on('click', function () { map.scrollWheelZoom.enable(); });
      map.on('mouseout', function () { map.scrollWheelZoom.disable(); });
    }
    /** Legend box in container px, with the corner it sits in. */
    function legendBox() {
      var lg = el.querySelector('.leaflet-control-container .rk-map-legend');
      if (!lg) return null;
      var r = lg.getBoundingClientRect(), c = el.getBoundingClientRect(), x = r.left - c.left, y = r.top - c.top;
      return { x: x, y: y, w: r.width, h: r.height, left: x + r.width / 2 < c.width / 2, top: y + r.height / 2 < c.height / 2 };
    }
    /** Fit bounds (or {center, zoom}); if the legend would cover data (avoid() -> [{ll, r}]), reserve a column or band for it — whichever zooms less. */
    function fit(target, pad, avoid) {
      if (target !== undefined) { st.target = target; st.pad = pad == null ? 16 : pad; st.avoid = avoid || null; }
      var b = st.target, p = st.pad, mz = opt('fitMaxZoom') || 6;
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
    var self = {
      map: map,
      land: v.land,
      fit: fit,
      /** Container resized: refit unless the reader has panned / zoomed, then re-place labels. */
      resize: function () {
        map.invalidateSize({ animate: false, pan: false });
        if (!st.moved) fit();
        layers.forEach(function (l) { l.place(); });
      },
      destroy: function () {
        map.remove();
        [].slice.call(el.classList).forEach(function (c) { if (/^leaflet-/.test(c)) el.classList.remove(c); });
        el.classList.remove('rk-map', 'rk-geo', 'is-motion');
        if (cls) el.classList.remove(cls);
        el.style.background = '';
      },
      /** Label layer that re-places itself on resize (see RK.geo.labels). */
      labels: function () { var l = labels(map); layers.push(l); return l; },
      legend: function (position) { return legendControl(map, position || opt('legendPosition')); },
      /** Component instance: {update, resize, destroy (hooks.destroy first), exportImage (PNG)}. */
      instance: function (hooks) {
        return {
          update: hooks.update,
          resize: self.resize,
          destroy: function () { if (hooks.destroy) hooks.destroy(); self.destroy(); },
          exportImage: function () { return snapshot(ctx, map); }
        };
      }
    };
    return self;
  }

  /** options.fit -> Leaflet bounds or {center, zoom}: 'data' (latlngs, polar extremes clamped) | 'world' | [[s, w], [n, e]] | {center, zoom}. */
  function fitTarget(fit, latlngs) {
    var L = global.L;
    if (fit && typeof fit === 'object' && !Array.isArray(fit)) return fit;
    if (Array.isArray(fit)) return L.latLngBounds(fit);
    if (fit === 'data' && latlngs && latlngs.length) {
      // Tierra del Fuego or the Canadian Arctic would shrink a world view: clamp what we fit to
      var b = L.latLngBounds(latlngs);
      return L.latLngBounds([[Math.max(b.getSouth(), WORLD[0][0]), b.getWest()], [Math.min(b.getNorth(), WORLD[1][0]), b.getEast()]]);
    }
    return L.latLngBounds(WORLD);
  }

  /**
   * Collision-aware HTML labels in the 'rk-labels' pane (created by RK.geo.view): per group, the top `max`
   * items by priority that fit next to their mark without overlapping controls or each other.
   *   var lab = RK.geo.labels(map);
   *   lab.set([{latlng, html, r, prio, pos: ['r','l','t','b','c'], cls, group}], maxOrPerGroup, soft);   // soft: [{ll, r}] marks to avoid covering
   *   lab.place();                                                                                       // re-run placement
   */
  function labels(map) {
    var L = global.L, group = L.layerGroup().addTo(map), items = [], max = {}, circles = [];
    if (!map.getPane('rk-labels')) map.createPane('rk-labels').style.zIndex = 640;
    function overlap(a, b) { return a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y; }
    function place() {
      var size = map.getSize(), box0 = map.getContainer().getBoundingClientRect();
      // controls (zoom, legend, toggles) are hard obstacles
      var placed = [].map.call(map.getContainer().querySelectorAll('.leaflet-control'), function (c) {
        var r = c.getBoundingClientRect();
        return { x: r.left - box0.left, y: r.top - box0.top, w: r.width, h: r.height };
      });
      // marks are soft obstacles: a label prefers the side that covers the fewest of them
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

  /** Legend control whose content can be swapped on update: ctl.set(element) / ctl.set(null) removes it. */
  function legendControl(map, position) {
    var ctl = null;
    return {
      set: function (el) {
        if (!el) { if (ctl) { ctl.remove(); ctl = null; } return; }
        if (!ctl) ctl = geo.legend(map, el, position || 'bottomleft');
        else { var c = ctl.getContainer(); c.innerHTML = ''; c.appendChild(el); }
      }
    };
  }

  /** Legend section: optional title + body (element or array). */
  function legendSection(title, body) {
    var h = RK.util.h;
    return h('div.rk-geo-leg__sec', title ? h('div.rk-map-legend__title', title) : null, body);
  }
  /** Gradient bar with tick labels spread under it. */
  function legendRamp(stops, ticks) {
    var h = RK.util.h;
    return h('div.rk-geo-leg__ramp',
      h('div.rk-legend__ramp', { style: { background: 'linear-gradient(90deg,' + stops.join(',') + ')' } }),
      h('div.rk-map-legend__ticks', ticks.map(function (x) { return h('span', x); })));
  }
  /**
   * Legend rows with 10px roundRect swatches (kit legend style).
   * opts: {selected: [values] (others dimmed), onClick(v) (row toggles a cross-filter), note(v) (right-aligned count)}
   */
  function legendItems(values, colorOf, opts) {
    var h = RK.util.h;
    opts = opts || {};
    var sel = opts.selected || [], click = opts.onClick;
    return h('div.rk-geo-leg__items', values.map(function (v) {
      var off = sel.length && sel.indexOf(v) < 0;
      var act = click ? function (e) { if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(v); } } : null;
      return h('div.rk-geo-leg__item' + (off ? '.is-off' : '') + (click ? '.is-click' : ''),
        click ? { role: 'button', tabindex: '0', 'aria-pressed': String(!!sel.length && !off), on: { click: act, keydown: act } } : null,
        h('i.rk-geo-leg__sw', { style: { background: colorOf(v) } }), h('span', opts.label ? opts.label(v) : String(v)),
        opts.note ? h('span.rk-geo-leg__n', opts.note(v)) : null);
    }));
  }
  /** Nested reference circles (bottom-aligned, leader lines) for a sqrt size scale. */
  function sizeLegend(values, rOf, fmt) {
    var ink = RK.theme.tokens().ink3, e = RK.util.escapeHTML;
    var vs = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return b - a; }), kept = [];
    vs.forEach(function (v) { var last = kept[kept.length - 1]; if (!last || 2 * (rOf(last) - rOf(v)) >= 12) kept.push(v); });
    if (!kept.length) return null;
    var R = rOf(kept[0]), H = Math.ceil(2 * R + 4), W = Math.ceil(2 * R + 64), out = '';
    kept.forEach(function (v) {
      var r = rOf(v), cy = H - 2 - r, ty = cy - r;
      out += '<circle cx="' + (R + 1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + ink + '" stroke-width="0.9"/>' +
        '<line x1="' + (R + 1) + '" x2="' + (2 * R + 8) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '" stroke="' + ink + '" stroke-width="0.6" stroke-dasharray="2 2"/>' +
        '<text x="' + (2 * R + 11) + '" y="' + (ty + 3.5).toFixed(1) + '">' + e(RK.format(v, fmt)) + '</text>';
    });
    return RK.util.h('div.rk-geo-leg__size', { html: '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + out + '</svg>' });
  }
  /** Reference values for a size legend: a nice value at or below the max, then ~2/5 and ~1/10 of it. */
  function sizeRefs(max) {
    if (!(max > 0)) return [];
    var m = Math.pow(10, Math.floor(Math.log10(max))), top = m;
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8].forEach(function (k) { if (k * m <= max) top = k * m; });
    return RK.util.unique([top, nice(top / 2.5), nice(top / 10)]);
  }
  /** Round to the nearest "nice" number (1, 1.5, 2, 2.5, 3, 4, 5, 7.5 x 10^k). */
  function nice(v) {
    if (!v) return 0;
    var s = v < 0 ? -1 : 1, a = Math.abs(v), m = Math.pow(10, Math.floor(Math.log10(a))), best = m, d = Infinity;
    [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].forEach(function (k) { var c = k * m; if (Math.abs(c - a) < d) { d = Math.abs(c - a); best = c; } });
    return s * +best.toPrecision(6);
  }
  /** Drop decimals from a format code when every value prints whole ("$#,##0.0" -> "$#,##0") — no ".0" on round legend ticks. */
  function tidyFmt(fmt, values) {
    if (typeof fmt !== 'string' || !/0\.0/.test(fmt)) return fmt;
    var ok = values.every(function (v) { return !/\.\d*[1-9]/.test(RK.format(v, fmt)); });
    return ok ? fmt.replace(/0\.0+/g, '0') : fmt;
  }
  /** Sequential stops without the steps closest to the land colour (they vanish on the basemap). */
  function seqStops(t) { return t.seq.length >= 6 ? t.seq.slice(2) : t.seq; }
  /** Field title with its unit, e.g. "Revenue 2025A (USD m)". */
  function fieldTitle(ctx, f) {
    var d = ctx.field(f), t = (d && d.title) || f;
    return d && d.unit && t.indexOf(d.unit) < 0 ? t + ' (' + d.unit + ')' : t;
  }
  /** Rows that define scale domains: every row after options.where (no filters), so colours / sizes stay put when filters change. */
  function domainRows(ctx) {
    if (!ctx.dataset) return ctx.rows;
    try { return RK.data.view(ctx.dataset, { filters: false, where: ctx.options.where || null }); } catch (e) { return ctx.rows; }
  }
  /** Is a row inside every active self-selection on the given fields? (false -> draw dimmed) */
  function isOn(ctx, row, fields) {
    return fields.every(function (f) { if (!f) return true; var s = ctx.selected(f); return !s.length || s.indexOf(row[f]) >= 0; });
  }

  /* Cross-filter scope: business dimensions shared across datasets filter report-wide; generic or dataset-local
     fields (name, type, from / to, kind, status ...) only filter this block's dataset. options.crossFilterScope wins. */
  var SHARED = /^(compan(y|ies)|issuer|ticker|sector|sub_?sector|industry|sub_?industry|region|sub_?region|country|country_name|iso(_?(num|n3|a2|a3|2|3))?|state|province|city|segment|business|division|year|fy|fiscal_year|currency)$/i;
  function scopeOf(ctx, field) { return ctx.options.crossFilterScope || (SHARED.test(field) ? 'global' : 'dataset'); }
  /** Click-to-filter: toggle `value` of `field` in this block's selection (no-op when crossFilter is off or the value is empty). */
  function select(ctx, field, value) {
    if (ctx.options.crossFilter === false || field == null || value == null || value === '') return false;
    ctx.select(field, value, { scope: scopeOf(ctx, field) });
    return true;
  }

  /** PNG snapshot of a Leaflet map container (SVG foreignObject + inlined computed styles; buttons left out). */
  var SNAP = ['position', 'left', 'top', 'right', 'bottom', 'display', 'float', 'clear', 'transform', 'transform-origin', 'z-index', 'overflow',
    'opacity', 'visibility', 'margin-left', 'margin-top', 'padding', 'box-sizing', 'background-color', 'background-image', 'border', 'border-radius',
    'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'white-space', 'text-align', 'text-shadow',
    'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin'];
  function snapshot(ctx, map) {
    var src = map.getContainer(), w = src.clientWidth, ht = src.clientHeight, t = ctx.theme;
    var clone = src.cloneNode(true);
    var a = [src].concat([].slice.call(src.querySelectorAll('*'))), b = [clone].concat([].slice.call(clone.querySelectorAll('*')));
    a.forEach(function (n, i) {
      var cs = getComputedStyle(n), css = '';
      SNAP.forEach(function (p) { css += p + ':' + cs.getPropertyValue(p) + ';'; });
      // legend text boxes keep auto size: the export falls back to a system font of another width
      var flow = n.childNodes.length && !(n instanceof SVGElement) && n.closest && n.closest('.leaflet-control-container');
      if (!flow) css += 'width:' + cs.width + ';height:' + cs.height + ';';
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

  geo.view = view;
  geo.fitTarget = fitTarget;
  geo.labels = labels;
  geo.legendControl = legendControl;
  geo.legendSection = legendSection;
  geo.legendRamp = legendRamp;
  geo.legendItems = legendItems;
  geo.sizeLegend = sizeLegend;
  geo.sizeRefs = sizeRefs;
  geo.nice = nice;
  geo.tidyFmt = tidyFmt;
  geo.seqStops = seqStops;
  geo.fieldTitle = fieldTitle;
  geo.domainRows = domainRows;
  geo.isOn = isOn;
  geo.scopeOf = scopeOf;
  geo.select = select;
  geo.snapshot = snapshot;

  // pick up basemaps loaded before this script
  if (global.__RK_GEO) Object.keys(global.__RK_GEO).forEach(function (k) { raw[k] = global.__RK_GEO[k]; });
})(typeof window !== 'undefined' ? window : this);
