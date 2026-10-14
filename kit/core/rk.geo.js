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
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});

  var raw = Object.create(null), cache = Object.create(null);

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

  var geo = RK.geo = {
    register: function (name, data) { raw[name] = data; delete cache[name]; },
    has: function (name) { return !!(raw[name] || (global.__RK_GEO && global.__RK_GEO[name])); },
    features: toFeatures,
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
     * opts: {basemap:'world-110m', tiles:{url, attribution}, center:[lat,lon], zoom, bounds:[[s,w],[n,e]], minZoom, maxZoom}
     * Returns {map, land, fit(boundsOrLatLngs)}. Caller is responsible for map.remove() in destroy().
     */
    leaflet: function (ctx, opts) {
      if (!global.L) throw new Error('Leaflet is not loaded (vendor/leaflet)');
      opts = opts || {};
      var t = ctx.theme, L = global.L;
      ctx.el.classList.add('rk-map');
      var map = L.map(ctx.el, {
        zoomControl: true,
        attributionControl: true,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
        scrollWheelZoom: opts.scrollWheelZoom != null ? opts.scrollWheelZoom : 'center',
        worldCopyJump: false,
        minZoom: opts.minZoom != null ? opts.minZoom : 1,
        maxZoom: opts.maxZoom != null ? opts.maxZoom : 8,
        zoomAnimation: ctx.motion,
        fadeAnimation: ctx.motion,
        markerZoomAnimation: ctx.motion,
        preferCanvas: !!opts.preferCanvas
      });
      map.attributionControl.setPrefix(false);
      ctx.el.style.background = t.mapWater || t.surface;
      var land = null;
      if (opts.tiles && opts.tiles.url) {
        L.tileLayer(opts.tiles.url, { attribution: opts.tiles.attribution || '', maxZoom: 18 }).addTo(map);
      } else if (opts.basemap !== false) {
        var name = opts.basemap || 'world-110m';
        land = L.geoJSON(toFeatures(name), {
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

  // pick up basemaps loaded before this script
  if (global.__RK_GEO) Object.keys(global.__RK_GEO).forEach(function (k) { raw[k] = global.__RK_GEO[k]; });
})(typeof window !== 'undefined' ? window : this);
