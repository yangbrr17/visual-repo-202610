/*!
 * RK component: choropleth — countries shaded by a value on the offline Natural Earth basemap.
 * Rows join to world-110m features by ISO 3166-1 numeric id (encode.id, e.g. "840"), falling
 * back to the country name. Sequential or diverging colour, continuous or classed (nice-rounded
 * quantile / equal-interval breaks), value labels on the top N countries, click to cross-filter.
 */
(function () {
  'use strict';
  var h = RK.util.h;

  /* ======================================================================================== *
   * geo kit — identical copy in every RK geo component (choropleth, bubble-map, flow-map,
   * cluster-map, geo-heat) so each file stays standalone. Candidate for rk.geo.js.
   * ======================================================================================== */
  var WORLD = [[-56, -170], [78, 180]];

  /** Themed Leaflet map (RK.geo.leaflet) + fit / refit-on-resize bookkeeping + clean teardown. */
  function geoView(ctx, o, cls) {
    var L = window.L, el = ctx.el;
    var v = RK.geo.leaflet(ctx, { basemap: o.basemap || 'world-110m', minZoom: 0, maxZoom: o.maxZoom || 8 });
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
    if (fit === 'data' && latlngs && latlngs.length) return L.latLngBounds(latlngs);
    return L.latLngBounds(WORLD);
  }

  /** Collision-aware HTML labels in the 'rk-labels' pane; lower-priority labels hide when crowded. */
  function labelLayer(map) {
    var L = window.L, group = L.layerGroup().addTo(map), items = [];
    function overlap(a, b) { return a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y; }
    function place() {
      var size = map.getSize(), box0 = map.getContainer().getBoundingClientRect();
      // controls (zoom, legend, toggles) are obstacles
      var placed = [].map.call(map.getContainer().querySelectorAll('.leaflet-control'), function (c) {
        var r = c.getBoundingClientRect();
        return { x: r.left - box0.left, y: r.top - box0.top, w: r.width, h: r.height };
      });
      items.slice().sort(function (a, b) { return b.it.prio - a.it.prio; }).forEach(function (x) {
        var icon = x.m.getElement();
        if (!icon) return;
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
      });
    }
    map.on('zoomend moveend resize', place);
    return {
      /** list: [{latlng, html, r, prio, pos, cls}] */
      set: function (list) {
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

  /** Polygons covering >= 20% of a feature's largest polygon (drops far-flung islands / the antimeridian sliver). */
  function mainBounds(f) {
    var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    var areas = polys.map(function (p) {
      var r = p[0], a = 0;
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
      return Math.abs(a / 2);
    });
    var max = Math.max.apply(null, areas.concat([0])), pts = [];
    polys.forEach(function (p, i) { if (areas[i] >= max * 0.2) p[0].forEach(function (c) { pts.push([c[1], c[0]]); }); });
    return pts;
  }

  /** Class breaks: explicit, nice-rounded quantiles, or nice equal intervals. */
  function classBreaks(o, vals, ext) {
    if (Array.isArray(o.breaks) && o.breaks.length) return o.breaks.slice().sort(function (a, b) { return a - b; });
    var n = Math.max(2, o.bins | 0), out = [];
    if (o.classify === 'equal') {
      var step = RK.util.niceStep(ext[1] - ext[0], n);
      for (var x = Math.ceil(ext[0] / step) * step; x < ext[1]; x += step) if (x > ext[0]) out.push(+x.toPrecision(10));
    } else {
      var s = vals.slice().sort(function (a, b) { return a - b; });
      for (var i = 1; i < n; i++) {
        var q = (s.length - 1) * i / n, lo = Math.floor(q);
        out.push(niceRound(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (q - lo)));
      }
    }
    return RK.util.unique(out).filter(function (b) { return b > ext[0] && b < ext[1]; });
  }

  /** Colour scale + legend body for the current values. */
  function buildScale(ctx, vals, fmt) {
    var o = ctx.options, t = ctx.theme, ext = RK.util.extent(vals);
    var seq = t.seq.length >= 6 ? t.seq.slice(2) : t.seq;
    var div = o.scale === 'diverging', mid = +o.mid || 0;
    var classed = (o.bins > 0 || (Array.isArray(o.breaks) && o.breaks.length)) && vals.length > 1;
    if (!classed) {
      if (div) {
        var dev = Math.max(Math.abs(ext[0] - mid), Math.abs(ext[1] - mid)) || 1;
        var dc = RK.theme.diverging([mid - dev, mid + dev], mid);
        return { color: dc, legend: rampEl(t.div, [RK.format(mid - dev, fmt), RK.format(mid, fmt), RK.format(mid + dev, fmt)]) };
      }
      var sc = RK.theme.sequential(ext, seq);
      return { color: sc, legend: rampEl(seq, [RK.format(ext[0], fmt), RK.format(ext[1], fmt)]) };
    }
    var breaks;
    if (div && !(Array.isArray(o.breaks) && o.breaks.length)) {
      // symmetric equal steps around the midpoint, k classes per side
      var k = Math.max(1, Math.round(o.bins / 2));
      var dv = Math.max(Math.abs(ext[0] - mid), Math.abs(ext[1] - mid)) || 1;
      var st = RK.util.niceStep(dv, k);
      if (st * k < dv) st = RK.util.niceStep(dv * 1.5, k);
      breaks = [];
      for (var i = -k + 1; i < k; i++) breaks.push(+(mid + i * st).toPrecision(10));
    } else breaks = classBreaks(o, vals, ext);
    var nCls = breaks.length + 1, colors;
    if (div) {
      var ramp = RK.theme.ramp(t.div);
      var nNeg = breaks.filter(function (b) { return b <= mid; }).length, m = Math.max(nNeg, nCls - nNeg) || 1;
      colors = breaks.concat([null]).map(function (_, j) { return ramp(j < nNeg ? 0.5 - 0.5 * (nNeg - j) / m : 0.5 + 0.5 * (j - nNeg + 1) / m); });
    } else {
      var r = RK.theme.ramp(seq);
      colors = breaks.concat([null]).map(function (_, j) { return r(nCls > 1 ? j / (nCls - 1) : 1); });
    }
    function classOf(v) { var j = 0; while (j < breaks.length && v >= breaks[j]) j++; return j; }
    var lf = tidyFmt(fmt, breaks);
    var items = colors.map(function (c, j) {
      var lab = j === 0 ? '< ' + RK.format(breaks[0], lf) : j === nCls - 1 ? '≥ ' + RK.format(breaks[j - 1], lf)
        : RK.format(breaks[j - 1], lf) + ' – ' + RK.format(breaks[j], lf);
      var count = vals.filter(function (v) { return classOf(v) === j; }).length;
      return h('div.rk-geo-leg__item', h('i.rk-geo-leg__sw.is-square', { style: { background: c } }), h('span', lab), h('span.rk-geo-leg__n', String(count)));
    }).reverse();
    return {
      color: function (v) { return v == null ? null : colors[classOf(v)]; },
      legend: h('div.rk-geo-leg__items', items)
    };
  }

  RK.component({
    id: 'choropleth',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { id: 'iso_num', value: 'value', label: 'country' },
      basemap: 'world-110m',
      scale: 'sequential',        // sequential | diverging
      mid: 0,                     // diverging midpoint (e.g. 0 for growth, or a peer average)
      bins: 5,                    // number of classes; 0 / null = continuous ramp (diverging rounds to an even count)
      classify: 'quantile',       // quantile | equal — how class breaks are found (then rounded to nice numbers)
      breaks: null,               // explicit class breaks, e.g. [50, 100, 250, 500]
      format: null,               // value format; defaults to the value field format
      labels: 5,                  // value labels on the top N countries (0 = none)
      tooltip: [],                // extra fields listed in the tooltip
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      legendTitle: null,          // defaults to the value field title
      legendPosition: 'bottomleft',
      filterField: null,          // click-to-filter field; defaults to encode.id
      scrollZoom: 'click'         // true | false | 'click' (wheel zoom armed by a click on the map)
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx;
      var view = geoView(ctx, ctx.options, 'rk-choro'), map = view.map;
      var fc = RK.geo.features(ctx.options.basemap || 'world-110m');
      var byId = {}, byName = {};
      fc.features.forEach(function (f) {
        if (f.id != null) byId[f.id] = f;
        if (f.properties.name) byName[String(f.properties.name).toLowerCase()] = f;
      });
      var layers = {}, recs = {}, S = null, timer = null;
      var area = L.geoJSON(null, { onEachFeature: wire }).addTo(map);
      var labels = labelLayer(map), legend = legendControl(map, ctx.options.legendPosition);

      function filterField(c) { return c.options.filterField || c.enc.id; }
      function featureOf(r, enc) {
        var k = r[enc.id];
        if (k != null && k !== '') {
          k = String(k);
          if (/^\d+$/.test(k)) k = k.padStart(3, '0');
          if (byId[k]) return byId[k];
          if (byName[k.toLowerCase()]) return byName[k.toLowerCase()];
        }
        return enc.label && r[enc.label] ? byName[String(r[enc.label]).toLowerCase()] || null : null;
      }

      function derive(c) {
        var enc = c.enc, o = c.options, out = {}, list = [];
        c.rows.forEach(function (r) {
          var f = featureOf(r, enc);
          if (!f || out[f.id]) return;                    // one row per country: first wins
          out[f.id] = { f: f, row: r, v: num(r[enc.value]) };
          list.push(out[f.id]);
        });
        var fmt = o.format || c.fmtOf(enc.value) || 'auto';
        var vals = list.map(function (x) { return x.v; }).filter(function (v) { return v != null; });
        var ranked = list.filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; });
        ranked.forEach(function (x, i) { x.rank = i + 1; });
        return { recs: out, list: list, ranked: ranked, fmt: fmt, scale: buildScale(c, vals, fmt), n: ranked.length };
      }

      function styleOf(rec) {
        var ff = filterField(cur), sel = cur.selected(ff), on = !sel.length || sel.indexOf(rec.row[ff]) >= 0;
        var fill = rec.v == null ? (t.mapLand || t.surface2) : S.scale.color(rec.v);
        return {
          fillColor: fill, fillOpacity: on ? 1 : 0.22,
          color: sel.length && on ? t.ink : (t.mapBorder || t.paper), weight: sel.length && on ? 1.2 : 0.6, opacity: 1
        };
      }

      function tipOf(rec) {
        var c = cur, enc = c.enc, r = rec.row;
        var rows = [{ color: rec.v == null ? null : S.scale.color(rec.v), label: c.title(enc.value), value: RK.format(rec.v, S.fmt) }];
        if (rec.v != null) rows.push({ label: 'Rank', value: rec.rank + ' of ' + S.n });
        (c.options.tooltip || []).forEach(function (f) { rows.push({ label: c.title(f), value: RK.format(r[f], c.fmtOf(f)) }); });
        return RK.chart.tip((enc.label && r[enc.label]) || rec.f.properties.name, rows);
      }

      function wire(f, layer) {
        layers[f.id] = layer;
        layer.bindTooltip(function () { return recs[f.id] ? tipOf(recs[f.id]) : ''; }, { sticky: true, direction: 'top', offset: [0, -10], opacity: 1 });
        layer.on('mouseover', function () {
          layer.setStyle({ weight: 1.6, color: t.ink });
          layer.bringToFront();
        });
        layer.on('mouseout', function () { if (recs[f.id]) layer.setStyle(styleOf(recs[f.id])); });
        layer.on('click', function () {
          var rec = recs[f.id], ff = filterField(cur);
          if (rec && cur.options.crossFilter !== false && rec.row[ff] != null) cur.select(ff, rec.row[ff]);
        });
      }

      function draw(first) {
        S = derive(cur);
        recs = S.recs;
        // remove countries that left the data, add newcomers, restyle the rest (CSS transitions the fill)
        Object.keys(layers).forEach(function (id) { if (!recs[id]) { area.removeLayer(layers[id]); delete layers[id]; } });
        S.list.forEach(function (rec, i) {
          if (!layers[rec.f.id]) {
            area.addData(rec.f);
            var el = layers[rec.f.id].getElement();
            if (el) {
              el.classList.add('rk-choro__area');
              if (cur.motion) { el.classList.add('is-enter'); el.style.setProperty('--rk-d', Math.min((rec.rank || i) * 16, 600) + 'ms'); }
            }
          }
          layers[rec.f.id].setStyle(styleOf(rec));
        });
        if (cur.motion) {
          clearTimeout(timer);
          // strip the entry animation so bringToFront() (re-append) on hover does not replay it
          timer = setTimeout(function () { [].forEach.call(ctx.el.querySelectorAll('.rk-choro__area.is-enter'), function (n) { n.classList.remove('is-enter'); }); }, 1300);
        }
        // value labels: top N, pill at the main-polygon centroid
        var o = cur.options, enc = cur.enc, top = o.labels > 0 ? S.ranked.slice(0, o.labels) : [];
        if (o.scale === 'diverging') top = S.ranked.slice().sort(function (a, b) { return Math.abs(b.v - o.mid) - Math.abs(a.v - o.mid); }).slice(0, Math.max(0, o.labels | 0));
        labels.set(top.map(function (rec) {
          var name = (enc.label && rec.row[enc.label]) || rec.f.properties.name;
          return {
            latlng: RK.geo.centroid(rec.f) || [0, 0], prio: Math.abs(rec.v), pos: ['c'], cls: 'rk-choro__label',
            html: '<b>' + RK.util.escapeHTML(name) + '</b><span>' + RK.util.escapeHTML(RK.format(rec.v, S.fmt)) + '</span>'
          };
        }));
        if (o.legend !== false) {
          var hasNull = S.list.some(function (x) { return x.v == null; });
          legend.set(h('div.rk-geo-leg',
            legSec(o.legendTitle || cur.title(enc.value), S.scale.legend),
            h('div.rk-geo-leg__item.rk-geo-leg__nodata', h('i.rk-geo-leg__sw.is-square', { style: { background: t.mapLand || t.surface2 } }), h('span', hasNull ? 'No data / n.a.' : 'No data'))));
        } else legend.set(null);
        if (first) {
          var pts = [];
          S.list.forEach(function (x) { pts = pts.concat(mainBounds(x.f)); });
          view.fit(fitTarget(o.fit, pts), 12);
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
