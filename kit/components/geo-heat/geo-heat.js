/*!
 * RK component: geo-heat — kernel density surface on the offline basemap, optionally weighted by a value field.
 * The surface is a quartic kernel of a fixed geographic radius (set in px for the initial view and scaled with the
 * map width), so a colour means a number: the legend shows the distance-weighted total within that radius. The ramp
 * is the theme's sequential scale (capped below near-white in dark themes, no glow); a toggle reveals the
 * underlying points with callouts on the largest (tooltips, click to cross-filter).
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

  /** Smallest "nice" number >= v (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^k). */
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    var m = Math.pow(10, Math.floor(Math.log10(v))), k = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < k.length; i++) if (k[i] * m >= v * 0.999) return +(k[i] * m).toPrecision(6);
    return 10 * m;
  }
  /** Rounded distance for the legend: 50 / 100 / 150 / 200 / 250 / 300 / 400 / 500 / 750 / 1,000 km ... */
  function niceKm(km) {
    var steps = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000];
    var best = steps[0];
    steps.forEach(function (s) { if (Math.abs(s - km) < Math.abs(best - km)) best = s; });
    return best;
  }
  function quartic(d2) { var k = 1 - d2; return k > 0 ? k * k : 0; }

  /**
   * Density canvas in the overlay pane (redrawn on move / zoom / resize, hidden while a zoom animates).
   * setData(points [{ll, w}], R0 (radius in zoom-0 px), dmax (value of the top colour), color(u) -> [r, g, b, a]).
   */
  function densityLayer() {
    var L = window.L;
    var Layer = L.Layer.extend({
      onAdd: function (map) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'rk-heat__surface leaflet-zoom-hide');
        map.getPanes().overlayPane.appendChild(this._canvas);
        map.on('moveend zoomend resize viewreset', this._draw, this);
        this._draw();
      },
      onRemove: function (map) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend zoomend resize viewreset', this._draw, this);
      },
      setData: function (pts, R0, dmax, color) {
        this._pts = pts; this._R0 = R0; this._dmax = dmax; this._color = color;
        if (this._map) this._draw();
        return this;
      },
      _draw: function () {
        var map = this._map, c = this._canvas, size = map && map.getSize();
        if (!c || !size || !size.x || !size.y || !this._R0 || !this._pts) return;
        L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
        // a 2px grid, drawn scaled up: the browser's smoothing keeps the surface soft without any blur pass
        var cell = 2, gw = Math.ceil(size.x / cell), gh = Math.ceil(size.y / cell), grid = new Float32Array(gw * gh);
        var Rc = this._R0 * Math.pow(2, map.getZoom()) / cell, R2 = Rc * Rc;
        this._pts.forEach(function (p) {
          var cp = map.latLngToContainerPoint(p.ll), cx = cp.x / cell, cy = cp.y / cell;
          var x0 = Math.max(0, Math.floor(cx - Rc)), x1 = Math.min(gw - 1, Math.ceil(cx + Rc));
          var y0 = Math.max(0, Math.floor(cy - Rc)), y1 = Math.min(gh - 1, Math.ceil(cy + Rc));
          for (var y = y0; y <= y1; y++) {
            var dy = y + 0.5 - cy, row = y * gw;
            for (var x = x0; x <= x1; x++) {
              var dx = x + 0.5 - cx, d2 = (dx * dx + dy * dy) / R2;
              if (d2 < 1) grid[row + x] += p.w * quartic(d2);
            }
          }
        });
        c.width = gw; c.height = gh;
        c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
        var g = c.getContext('2d'), img = g.createImageData(gw, gh), d = img.data, dmax = this._dmax, col = this._color;
        for (var i = 0; i < grid.length; i++) {
          if (!(grid[i] > 0)) continue;
          var rgba = col(Math.min(1, grid[i] / dmax)), j = i * 4;
          d[j] = rgba[0]; d[j + 1] = rgba[1]; d[j + 2] = rgba[2]; d[j + 3] = rgba[3];
        }
        g.putImageData(img, 0, 0);
      }
    });
    return new Layer();
  }

  RK.component({
    id: 'geo-heat',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { lat: 'lat', lon: 'lon', weight: null, label: 'name' },
      basemap: 'world-110m',
      radius: 26,                 // kernel radius in px on a 1000px-wide map at the initial view (scales with the map width)
      intensity: 1,               // colour domain = the densest spot / intensity (> 1 saturates the peaks sooner)
      minOpacity: 0.12,           // opacity of the faintest visible density
      gradient: null,             // custom {stop: colour} map; defaults to the theme sequential ramp
      points: false,              // show the points overlay initially
      pointsToggle: true,         // on-map button to show / hide the points
      labels: 5,                  // callouts on the N largest points while the points overlay is shown (0 = none)
      tooltip: [],                // extra fields in point tooltips
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      legendPosition: 'bottomleft',
      filterField: null,          // point click-to-filter field; defaults to encode.label
      scrollZoom: 'click'         // 'click' (plain-wheel zoom armed by a click) | true | false; Ctrl/Cmd + wheel always zooms
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx, o0 = ctx.options;
      var view = G.view(ctx, { cls: 'rk-heat' }), map = view.map;
      map.options.zoomSnap = 0;   // fit the data exactly
      var legend = view.legend();
      var showPts = !!o0.points, S = null, toggle = null, K = null;

      /* colour: theme ramp (dark themes stop before near-white: no glow), alpha rising from the faint fringe */
      var land = t.mapLand || t.surface2, stops;
      if (o0.gradient && typeof o0.gradient === 'object') {
        stops = Object.keys(o0.gradient).sort(function (a, b) { return a - b; }).map(function (k) { return RK.theme.resolve(o0.gradient[k]); });
      } else {
        stops = G.seqStops(t);
        if (t.dark && stops.length > 3) stops = stops.slice(0, -1);
        stops = stops.map(function (c, i) { return i ? c : separate(c, [land], 12, stops[stops.length - 1]); });
      }
      var ramp = RK.theme.ramp(stops), minOp = o0.minOpacity == null ? 0.12 : +o0.minOpacity;
      function alphaOf(u) { return u < 0.03 ? minOp * u / 0.03 : Math.max(minOp, 0.9 * Math.min(1, u / 0.2)); }
      var LUT = [];
      for (var q = 0; q <= 255; q++) { var cc = RK.theme.parseColor(ramp(q / 255)); LUT.push([cc[0], cc[1], cc[2], Math.round(255 * alphaOf(q / 255))]); }
      function colorOf(u) { return LUT[Math.round(u * 255)]; }
      /** What a density looks like on the land (for the legend bar). */
      function onLand(u) { return RK.theme.mix(land, ramp(u), alphaOf(u)); }

      var heat = densityLayer().addTo(map);
      // points get their own svg renderer in a pane above the density canvas
      map.createPane('rk-heat-points').style.zIndex = 450;
      var ptsRenderer = L.svg({ pane: 'rk-heat-points' }), pts = L.layerGroup();
      var labels = callouts(map, { cost: pointCost, maxCost: 4 });

      function ff(c) { return c.options.filterField || c.enc.label; }
      /** Callout cost: other points the box covers. */
      function pointCost(b, it) {
        var cost = 0;
        S.items.forEach(function (x) {
          if (x === it.item) return;
          var c = map.latLngToContainerPoint(x.ll);
          if (c.x + 4 > b.x && c.x - 4 < b.x + b.w && c.y + 4 > b.y && c.y - 4 < b.y + b.h) cost += 1;
        });
        return cost;
      }

      function derive(c) {
        var enc = c.enc;
        var items = c.rows.filter(function (r) { return num(r[enc.lat]) != null && num(r[enc.lon]) != null; }).map(function (r) {
          var w = enc.weight ? num(r[enc.weight]) : null;
          return { row: r, ll: [r[enc.lat], r[enc.lon]], w: w, k: enc.weight ? Math.max(0, w || 0) : 1 };
        });
        return { items: items, fmt: enc.weight ? c.fmtOf(enc.weight) || 'auto' : '#,##0' };
      }

      /**
       * Kernel set once, at the fitted view: radius (px at a 1000px-wide map, scaled with the map width) -> zoom-0 px, and
       * the colour domain from the densest spot of the unfiltered data, so colours and legend stay put under filters.
       */
      function kernel(c) {
        var enc = c.enc, o = c.options, W = ctx.el.clientWidth || 1000;
        var Rpx = (+o.radius || 26) * RK.util.clamp(W / 1000, 0.55, 1.25), R0 = Rpx / Math.pow(2, map.getZoom());
        var dom = G.domainRows(c).filter(function (r) { return num(r[enc.lat]) != null && num(r[enc.lon]) != null; }).map(function (r) {
          return { p: map.project([r[enc.lat], r[enc.lon]], 0), w: enc.weight ? Math.max(0, num(r[enc.weight]) || 0) : 1, lat: r[enc.lat] };
        });
        var peak = 0, lat = 0, sw = 0;
        dom.forEach(function (a) {
          var s = 0;
          dom.forEach(function (b) { var dx = a.p.x - b.p.x, dy = a.p.y - b.p.y; s += b.w * quartic((dx * dx + dy * dy) / (R0 * R0)); });
          peak = Math.max(peak, s);
          lat += a.lat * (a.w || 0); sw += a.w || 0;
        });
        var top = niceCeil(peak / Math.max(0.2, +o.intensity || 1));
        var km = R0 * 40075 / 256 * Math.cos((sw ? lat / sw : 0) * Math.PI / 180);
        return { R0: R0, top: top, km: niceKm(km) };
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
          var on = G.isOn(cur, it.row, [field]);
          var m = L.circleMarker(it.ll, {
            radius: on && anySel ? 4.5 : 3.2, color: t.paper, weight: 1, fillColor: on && anySel ? t.ink : t.ink2,   // accent-2 is reserved for the target
            fillOpacity: on ? 0.95 : 0.3, opacity: on ? 1 : 0.4, className: 'rk-heat__pt', renderer: ptsRenderer, pane: 'rk-heat-points'
          });
          m.bindTooltip(function () { return tipOf(it); }, { direction: 'top', offset: [0, -5], opacity: 1 });
          m.on('click', function () { G.select(cur, field, it.row[field]); });
          pts.addLayer(m);
        });
        if (showPts && !map.hasLayer(pts)) pts.addTo(map);
        if (!showPts && map.hasLayer(pts)) map.removeLayer(pts);
        if (toggle) toggle.classList.toggle('is-on', showPts);
        // callouts on the largest points while they are shown
        var n = Math.max(0, cur.options.labels | 0), enc = cur.enc;
        var top = showPts && n ? S.items.slice().sort(function (a, b) { return (b.w || 0) - (a.w || 0); }) : [];
        labels.set(top.map(function (it) {
          var name = RK.util.escapeHTML(it.row[enc.label] == null ? '' : it.row[enc.label]);
          return { latlng: it.ll, r: 4, item: it, prio: it.w || 0,
            html: '<b>' + name + '</b>' + (enc.weight ? ' <span>' + RK.util.escapeHTML(RK.format(it.w, S.fmt)) + '</span>' : '') };
        }), n);
      }

      if (o0.pointsToggle !== false && !ctx.print) {   // print: no buttons
        var ctl = L.control({ position: 'topright' });
        ctl.onAdd = function () {
          var nouns = G.noun(cur, cur.enc.label);
          toggle = h('button.rk-geo-toggle' + (showPts ? '.is-on' : ''), { type: 'button', 'aria-pressed': String(showPts), title: 'Show / hide the underlying points',
            on: { click: function () { showPts = !showPts; toggle.setAttribute('aria-pressed', String(showPts)); drawPoints(); } } },
          h('i.rk-geo-toggle__box'), h('span', 'Show ' + nouns));
          L.DomEvent.disableClickPropagation(toggle);
          return toggle;
        };
        ctl.addTo(map);
      }

      function setLegend() {
        var o = cur.options, enc = cur.enc;
        if (o.legend === false || !K) { legend.set(null); return; }
        var what = enc.weight ? G.fieldTitle(cur, enc.weight) : 'Number of ' + G.noun(cur, enc.label);
        var lf = G.tidyFmt(S.fmt, [0, K.top / 2, K.top]);
        var bar = [0, 0.25, 0.5, 0.75, 1].map(onLand);
        legend.set(h('div.rk-geo-leg', G.legendSection(what + ' within ~' + RK.format(K.km, '#,##0') + ' km',
          G.legendRamp(bar, [0, K.top / 2, K.top].map(function (v) { return RK.format(v, lf); }))),
          h('div.rk-geo-leg__note', S.items.length + ' ' + (S.items.length === 1 ? 'location' : 'locations') +
            (enc.weight ? ' · total ' + RK.format(S.items.reduce(function (s, it) { return s + (it.w || 0); }, 0), G.tidyFmt(S.fmt, [0])) : '') +
            ' · distance-weighted')));
      }

      function draw(first) {
        S = derive(cur);
        var o = cur.options;
        if (first) {
          // provisional legend (sizes the corner the fit keeps clear), then the kernel at the fitted zoom
          K = { R0: 1, top: 1, km: 100 };
          setLegend();
          view.fit(G.fitTarget(o.fit, S.items.map(function (it) { return it.ll; })), Math.max(16, o.radius), function () { return S.items.map(function (it) { return { ll: it.ll, r: o.radius * 0.6 }; }); });
          K = kernel(cur);
        }
        setLegend();
        heat.setData(S.items.map(function (it) { return { ll: it.ll, w: it.k }; }), K.R0, K.top, colorOf);
        drawPoints();
      }

      draw(true);

      var inst = view.instance({ update: function (c) { cur = c; draw(false); } }), resize0 = inst.resize;
      // first render in a hidden (0 x 0) block: size the kernel once the block has a size
      K.w0 = map.getSize().x;
      inst.resize = function () {
        resize0();
        if (!K.w0 && map.getSize().x) { K = kernel(cur); K.w0 = map.getSize().x; draw(false); }
      };
      return inst;
    }
  });
})();
