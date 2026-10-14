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

  RK.component({
    id: 'bubble-map',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { lat: 'lat', lon: 'lon', size: 'value', color: null, label: 'name', target: 'is_target' },
      basemap: 'world-110m',
      sizeRange: [4, 26],         // min / max radius in px (sqrt scale, so area tracks the value)
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
      var labels = view.labels(), legend = view.legend();
      var marks = {}, S = null, timer = null;

      function ff(c) { return c.options.filterField || c.enc.label; }
      function keyOf(r, enc) { return [r[enc.label], r[enc.lat], r[enc.lon]].join('|'); }

      function derive(c) {
        var enc = c.enc, o = c.options;
        var dom = G.domainRows(c), fmt = o.format || c.fmtOf(enc.size) || 'auto';
        var sizes = dom.map(function (r) { return num(r[enc.size]); });
        var rOf = G.radius(sizes, o.sizeRange || [4, 26]);
        var hl = o.highlight == null ? [] : [].concat(o.highlight), tf = enc.target && c.field(enc.target) ? enc.target : null;
        var cf = enc.color, fld = cf ? c.field(cf) : null, cm;
        var mode = !cf ? 'none' : o.colorScale !== 'auto' ? o.colorScale : (fld && fld.type === 'number' ? 'sequential' : 'categorical');
        var colorOf, cats = [], cfmt = cf ? c.fmtOf(cf) || 'auto' : null, ext = null;
        if (mode === 'categorical') {
          cats = RK.util.unique(dom.map(function (r) { return r[cf]; }).filter(function (v) { return v != null && v !== ''; }));
          cm = RK.theme.categoricalSafe(cats);          // peers never resemble the accent-2 target
          colorOf = function (r) { return cm(r[cf]); };
        } else if (mode === 'sequential' || mode === 'diverging') {
          ext = RK.util.extent(dom.map(function (r) { return num(r[cf]); }));
          var sc;
          if (mode === 'diverging') {
            var dev = Math.max(Math.abs(ext[0] - o.mid), Math.abs(ext[1] - o.mid)) || 1;
            ext = [o.mid - dev, o.mid + dev];
            sc = RK.theme.diverging(ext, o.mid);
          } else sc = RK.theme.sequential(ext, G.seqStops(t));
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
        m.on('click', function () { G.select(cur, ff(cur), m.it.row[ff(cur)]); });
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
        }), n + S.items.filter(function (it) { return it.hl; }).length, S.items.map(function (it) { return { ll: it.ll, r: it.r }; }));

        if (o.legend !== false) {
          var secs = [], hlNames = RK.util.unique(S.items.filter(function (it) { return it.hl; }).map(function (it) { return it.row[enc.label]; }));
          var hlEl = hlNames.length ? G.legendItems(hlNames, function () { return t.accent2; }) : null;
          if (S.mode === 'categorical') {
            secs.push(G.legendSection(cur.title(enc.color), [G.legendItems(S.cats, S.catColor, {
              selected: cur.selected(enc.color), onClick: o.crossFilter !== false ? function (v) { G.select(cur, enc.color, v); } : null
            }), hlEl]));
          } else {
            if (S.mode === 'sequential' || S.mode === 'diverging') {
              var stops = S.mode === 'diverging' ? t.div : G.seqStops(t);
              var ticks = S.mode === 'diverging' ? [S.ext[0], o.mid, S.ext[1]] : S.ext;
              secs.push(G.legendSection(G.fieldTitle(cur, enc.color), G.legendRamp(stops, ticks.map(function (v) { return RK.format(v, S.cfmt); }))));
            }
            if (hlEl) secs.push(G.legendSection(null, hlEl));
          }
          if (o.sizeLegend !== false) {
            var refs = G.sizeRefs(S.maxV);
            var sl = G.sizeLegend(refs, S.rOf, G.tidyFmt(S.fmt, refs));
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
