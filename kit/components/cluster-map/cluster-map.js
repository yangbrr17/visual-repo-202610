/*!
 * RK component: cluster-map — dense point layers grouped with Leaflet.markercluster.
 * Themed cluster bubbles (accent disc with the count or a summed value, outer ring split by
 * category share), coverage polygon on hover, spiderfy at max zoom, rich tooltips for both
 * clusters (breakdown by category) and points, click a point / legend entry to cross-filter.
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

  /** Font size of the cluster figure for a badge size. */
  function badgeFont(size) { return size < 36 ? 10.5 : size < 48 ? 11.5 : 12.5; }
  /** Smallest badge whose inner disc fits the text plus 4px padding each side (ring 4px + 1px gap on each side). */
  function badgeFor(text, size) {
    var t = RK.theme.tokens(), w = RK.chart.measure(text, '600 ' + badgeFont(size) + 'px ' + t.fontNum);
    return Math.ceil(w + 8 + 12 + 5);
  }

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
    var base = badgeFont(size), room = 2 * (rr - 3.5) - 5, w = text ? RK.chart.measure(text, '600 ' + base + 'px ' + t.fontNum) : 0;
    var fs = w > room ? Math.max(7, +(base * room / w).toFixed(1)) : base;   // shrink long sums to fit the disc
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + ring +
      '<circle cx="' + c + '" cy="' + c + '" r="' + (rr - 3.5).toFixed(2) + '" fill="' + t.accent + '" stroke="' + t.paper + '" stroke-width="1"/>' +
      '<text x="' + c + '" y="' + (c + fs * 0.36).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '" fill="' + RK.theme.textOn(t.accent) + '">' +
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
      scrollZoom: 'click'         // 'click' (plain-wheel zoom armed by a click) | true | false; Ctrl/Cmd + wheel always zooms
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx;
      if (!L.markerClusterGroup) throw new Error('leaflet.markercluster is not loaded (add "leaflet-markercluster" to deps)');
      var o0 = ctx.options;
      var view = G.view(ctx, { cls: 'rk-cluster' }), map = view.map;
      var legend = view.legend(), S = null;

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
      /** Short cluster figure: the field format without decimals, compact ("50.4k") when that is too long for the disc. */
      function sumFmt(v) {
        var f = S.fmt && typeof S.fmt === 'string' ? S.fmt.replace(/0\.0+/g, '0') : '#,##0', out = RK.format(v, f);
        return out.length > 5 ? RK.format(v, 'auto') : out;
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
          var text = useSum ? sumFmt(sum) : String(n);
          size = Math.max(size, badgeFor(text, badgeFor(text, size)));   // the disc always holds its figure with >= 4px either side
          return L.divIcon({ className: 'rk-cluster__icon', iconSize: [size, size], html: clusterSVG(size, parts, n, text, t) });
        }
      }).addTo(map);

      group.on('clustermouseover', function (e) {
        var ms = e.layer.getAllChildMarkers(), parts = partsOf(ms), c = cur, enc = c.enc;
        var rows = parts.map(function (p) {
          return { color: p.color, label: enc.color ? String(p.key) : 'Points', value: String(p.n) + (enc.value ? '  ·  ' + RK.format(p.v, S.fmt) : '') };
        });
        if (enc.value) rows.push({ label: 'Total ' + c.title(enc.value).replace(/^[A-Z](?=[a-z])/, function (ch) { return ch.toLowerCase(); }), value: RK.format(parts.reduce(function (s, p) { return s + p.v; }, 0), S.fmt), bold: true });
        var sz = e.layer.options.icon && e.layer.options.icon.options.iconSize ? e.layer.options.icon.options.iconSize[1] : 30;
        e.layer.bindTooltip(RK.chart.tip(ms.length + ' ' + (S.noun || 'points'), rows, 'Click to zoom in'), { direction: 'top', offset: [0, -sz / 2], opacity: 1 }).openTooltip();
      });
      group.on('clustermouseout', function (e) { e.layer.unbindTooltip(); });

      function derive(c) {
        var enc = c.enc, o = c.options, dom = G.domainRows(c);
        var cats = enc.color ? RK.util.unique(dom.map(function (r) { return r[enc.color]; }).filter(function (v) { return v != null && v !== ''; })) : [];
        var colorOf = enc.color ? catColors(cats) : function () { return t.accent3 || t.cat[1]; };   // neighbouring hues kept apart
        var total = enc.value ? dom.reduce(function (s, r) { return s + (num(r[enc.value]) || 0); }, 0) : 0;
        var items = c.rows.filter(function (r) { return num(r[enc.lat]) != null && num(r[enc.lon]) != null; }).map(function (r) {
          return { row: r, ll: [r[enc.lat], r[enc.lon]], v: enc.value ? num(r[enc.value]) : null, color: colorOf(enc.color ? r[enc.color] : null) };
        });
        return { items: items, cats: cats, colorOf: colorOf, total: total, fmt: o.format || (enc.value ? c.fmtOf(enc.value) : null) || 'auto', noun: G.noun(c, enc.label) };
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
          var on = G.isOn(cur, it.row, [field, cur.enc.color]);
          var m = L.marker(it.ll, {
            icon: L.divIcon({ className: 'rk-cluster__pt-icon', iconSize: [sz, sz], html: '<span class="rk-cluster__pt" style="background:' + it.color + '"></span>' }),
            opacity: on ? 1 : 0.28, riseOnHover: true, keyboard: false
          });
          m.it = it;
          m.bindTooltip(function () { return tipOf(it); }, { direction: 'top', offset: [0, -sz / 2 - 2], opacity: 1 });
          m.on('click', function () { G.select(cur, field, it.row[field]); });
          return m;
        });
        group.clearLayers();
        group.addLayers(markers);

        if (o.legend !== false) {
          var secs = [];
          if (cur.enc.color && S.cats.length) {
            secs.push(G.legendSection(cur.title(cur.enc.color), G.legendItems(S.cats, S.colorOf, {
              selected: cur.selected(cur.enc.color), onClick: o.crossFilter !== false ? function (v) { G.select(cur, cur.enc.color, v); } : null
            })));
          }
          var key = o.clusterValue === 'sum' && cur.enc.value ? 'Cluster: total ' + G.fieldTitle(cur, cur.enc.value).replace(/^[A-Z](?=[a-z])/, function (ch) { return ch.toLowerCase(); }) : 'Cluster: number of ' + S.noun;
          secs.push(h('div.rk-geo-leg__sec', h('div.rk-geo-leg__item', h('i.rk-cluster__key', { html: clusterSVG(20, [], 1, '', t) }), h('span', key))));
          legend.set(h('div.rk-geo-leg', secs));
        } else legend.set(null);

        if (first) view.fit(G.fitTarget(o.fit, S.items.map(function (it) { return it.ll; })), 28, function () { return S.items.map(function (it) { return { ll: it.ll, r: 14 }; }); });
      }

      draw(true);

      return view.instance({
        update: function (c) { cur = c; draw(false); },
        destroy: function () { group.off(); }
      });
    }
  });
})();
