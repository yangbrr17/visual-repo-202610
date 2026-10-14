/*!
 * RK component: geo-heat — kernel density surface (Leaflet.heat) on the offline basemap,
 * optionally weighted by a value field. Gradient comes from the theme's sequential ramp,
 * radius / blur are tunable, and a toggle reveals the underlying points (tooltips, click
 * to cross-filter).
 */
(function () {
  'use strict';
  var h = RK.util.h;

  /* ======================================================================================== *
   * geo kit
  /* ======================================================================================== */

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  RK.component({
    id: 'geo-heat',
    deps: ['leaflet', 'leaflet-heat', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { lat: 'lat', lon: 'lon', weight: null, label: 'name' },
      basemap: 'world-110m',
      radius: 26,                 // kernel radius in px
      blur: 20,                   // blur in px
      intensity: 0.85,            // weight of the heaviest single point (0-1); overlapping points add up
      minOpacity: 0.12,           // floor opacity of the faintest density
      gradient: null,             // custom {stop: colour} map; defaults to the theme sequential ramp
      points: false,              // show the points overlay initially
      pointsToggle: true,         // on-map button to show / hide the points
      tooltip: [],                // extra fields in point tooltips
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      legendPosition: 'bottomleft',
      filterField: null,          // point click-to-filter field; defaults to encode.label
      scrollZoom: 'click'         // true | false | 'click'
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx, o0 = ctx.options;
      if (!L.heatLayer) throw new Error('Leaflet.heat is not loaded (add "leaflet-heat" to deps)');
      var view = geoView(ctx, o0, 'rk-heat'), map = view.map;
      var legend = legendControl(map, o0.legendPosition);
      var showPts = !!o0.points, S = null, toggle = null;

      // theme gradient: drop the palest steps (invisible on land), spread the rest over 0.2..1
      var seq = seqStops(t), grad = o0.gradient;
      if (!grad) {
        grad = {};
        seq.forEach(function (c, i) { grad[(0.2 + 0.8 * i / Math.max(1, seq.length - 1)).toFixed(3)] = c; });
      }
      var heat = L.heatLayer([], { radius: o0.radius, blur: o0.blur, minOpacity: o0.minOpacity, max: 1, gradient: grad }).addTo(map);
      var pts = L.layerGroup();

      function ff(c) { return c.options.filterField || c.enc.label; }

      function derive(c) {
        var enc = c.enc, o = c.options, maxW = 0;
        if (enc.weight) domainRows(c).forEach(function (r) { var w = num(r[enc.weight]); if (w != null) maxW = Math.max(maxW, Math.abs(w)); });
        var items = c.rows.filter(function (r) { return num(r[enc.lat]) != null && num(r[enc.lon]) != null; }).map(function (r) {
          var w = enc.weight ? num(r[enc.weight]) : null;
          return { row: r, ll: [r[enc.lat], r[enc.lon]], w: w, k: (enc.weight ? (maxW ? Math.max(0, w || 0) / maxW : 0) : 0.5) * o.intensity };
        });
        return { items: items, fmt: enc.weight ? c.fmtOf(enc.weight) || 'auto' : null };
      }

      function tipOf(it) {
        var c = cur, enc = c.enc, r = it.row, rows = [];
        if (enc.weight) rows.push({ label: c.title(enc.weight), value: RK.format(it.w, S.fmt) });
        (c.options.tooltip || []).forEach(function (f) { rows.push({ label: c.title(f), value: RK.format(r[f], c.fmtOf(f)) }); });
        return RK.chart.tip(r[enc.label], rows);
      }

      function drawPoints() {
        pts.clearLayers();
        var field = ff(cur), anySel = cur.selected(field).length;
        S.items.forEach(function (it) {
          var on = isOn(cur, it.row, [field]);
          var m = L.circleMarker(it.ll, {
            radius: on && anySel ? 4.5 : 3.2, color: t.paper, weight: 1, fillColor: on && anySel ? t.accent2 : t.ink2,
            fillOpacity: on ? 0.95 : 0.3, opacity: on ? 1 : 0.4, className: 'rk-heat__pt'
          });
          m.bindTooltip(function () { return tipOf(it); }, { direction: 'top', offset: [0, -5], opacity: 1 });
          m.on('click', function () {
            var v = it.row[field];
            if (cur.options.crossFilter !== false && v != null) cur.select(field, v);
          });
          pts.addLayer(m);
        });
        if (showPts && !map.hasLayer(pts)) pts.addTo(map);
        if (!showPts && map.hasLayer(pts)) map.removeLayer(pts);
        if (toggle) toggle.classList.toggle('is-on', showPts);
      }

      if (o0.pointsToggle !== false) {
        var ctl = L.control({ position: 'topright' });
        ctl.onAdd = function () {
          var noun = cur.title(cur.enc.label) || 'points';
          toggle = h('button.rk-geo-toggle' + (showPts ? '.is-on' : ''), { type: 'button', 'aria-pressed': String(showPts), title: 'Show / hide the underlying points',
            on: { click: function () { showPts = !showPts; toggle.setAttribute('aria-pressed', String(showPts)); drawPoints(); } } },
          h('i.rk-geo-toggle__box'), h('span', 'Show ' + String(noun).toLowerCase() + 's'));
          L.DomEvent.disableClickPropagation(toggle);
          return toggle;
        };
        ctl.addTo(map);
      }

      function draw(first) {
        S = derive(cur);
        heat.setLatLngs(S.items.map(function (it) { return [it.ll[0], it.ll[1], it.k]; }));
        drawPoints();
        var o = cur.options;
        if (o.legend !== false) {
          var title = cur.enc.weight ? 'Density, weighted by ' + fieldTitle(cur, cur.enc.weight).replace(/^./, function (c) { return c.toLowerCase(); }) : 'Point density';
          var stops = Object.keys(grad).sort(function (a, b) { return a - b; }).map(function (k) { return grad[k]; });
          legend.set(h('div.rk-geo-leg', legSec(title, rampEl(stops, ['Lower', 'Higher'])),
            h('div.rk-geo-leg__note', S.items.length + ' ' + (S.items.length === 1 ? 'location' : 'locations') + (cur.enc.weight ? ' · total ' + RK.format(S.items.reduce(function (s, it) { return s + (it.w || 0); }, 0), tidyFmt(S.fmt, [0])) : ''))));
        } else legend.set(null);
        if (first) {
          view.fit(fitTarget(o.fit, S.items.map(function (it) { return it.ll; })), Math.max(16, o.radius), function () { return S.items.map(function (it) { return { ll: it.ll, r: o.radius * 0.6 }; }); });
          // Leaflet.heat fades points below its maxZoom: full strength at the fitted zoom
          heat.setOptions({ maxZoom: Math.max(1, Math.round(map.getZoom())) });
        }
      }

      draw(true);

      return {
        update: function (c) { cur = c; draw(false); },
        resize: function () { view.resize(); },
        destroy: function () { view.destroy(); },
        exportImage: function () { return snapshot(cur, map); }
      };
    }
  });
})();
