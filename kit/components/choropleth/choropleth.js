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
  /** Text colour with the best contrast on a fill (theme ink, paper or white). */
  function textOn(t, fill) {
    var lf = RK.theme.luminance(fill);
    return [t.ink, t.paper, '#ffffff'].map(function (c) {
      var lc = RK.theme.luminance(c);
      return { c: c, r: (Math.max(lf, lc) + 0.05) / (Math.min(lf, lc) + 0.05) };
    }).sort(function (a, b) { return b.r - a.r; })[0].c;
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
  /* ======================================================================================== */

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** ISO 3166-1 alpha-3 -> numeric for every world-110m country, so ISO3 keys join too. */
  var ISO3 = {};
  ('FJI242 TZA834 ESH732 CAN124 USA840 KAZ398 UZB860 PNG598 IDN360 ARG032 CHL152 COD180 SOM706 KEN404 SDN729 TCD148 HTI332 DOM214 RUS643 BHS044 FLK238 NOR578 GRL304 ATF260 TLS626 ZAF710 LSO426 MEX484 URY858 BRA076 BOL068 PER604 COL170 PAN591 CRI188 NIC558 HND340 SLV222 GTM320 BLZ084 VEN862 GUY328 SUR740 FRA250 ECU218 PRI630 JAM388 CUB192 ZWE716 BWA072 NAM516 SEN686 MLI466 MRT478 BEN204 NER562 NGA566 CMR120 TGO768 GHA288 CIV384 GIN324 GNB624 LBR430 SLE694 BFA854 CAF140 COG178 GAB266 GNQ226 ZMB894 MWI454 MOZ508 SWZ748 AGO024 BDI108 ISR376 LBN422 MDG450 PSE275 GMB270 TUN788 DZA012 JOR400 ARE784 QAT634 KWT414 IRQ368 OMN512 VUT548 KHM116 THA764 LAO418 MMR104 VNM704 PRK408 KOR410 MNG496 IND356 BGD050 BTN064 NPL524 PAK586 AFG004 TJK762 KGZ417 TKM795 IRN364 SYR760 ARM051 SWE752 BLR112 UKR804 POL616 AUT040 HUN348 MDA498 ROU642 LTU440 LVA428 EST233 DEU276 BGR100 GRC300 TUR792 ALB008 HRV191 CHE756 LUX442 BEL056 NLD528 PRT620 ESP724 IRL372 NCL540 SLB090 NZL554 AUS036 LKA144 CHN156 TWN158 ITA380 DNK208 GBR826 ISL352 AZE031 GEO268 PHL608 MYS458 BRN096 SVN705 FIN246 SVK703 CZE203 ERI232 JPN392 PRY600 YEM887 SAU682 ATA010 CYP196 MAR504 EGY818 LBY434 ETH231 DJI262 UGA800 RWA646 BIH070 MKD807 SRB688 MNE499 TTO780 SSD728').split(' ').forEach(function (x) { ISO3[x.slice(0, 3)] = x.slice(3); });
  /** Common report spellings -> basemap ids / names. */
  var ALIAS = {
    'united states': '840', 'usa': '840', 'us': '840', 'u.s.': '840', 'uk': '826', 'great britain': '826', 'czech republic': '203',
    'korea': '410', 'republic of korea': '410', 'russian federation': '643', 'uae': '784', 'democratic republic of the congo': '180',
    'dr congo': '180', 'republic of the congo': '178', 'ivory coast': '384', "cote d'ivoire": '384', 'dominican republic': '214',
    'bosnia and herzegovina': '070', 'north macedonia': '807', 'eswatini': '748', 'swaziland': '748', 'central african republic': '140',
    'equatorial guinea': '226', 'solomon islands': '090', 'falkland islands': '238', 'western sahara': '732', 'south sudan': '728',
    'viet nam': '704', 'turkiye': '792', 'türkiye': '792', 'lao pdr': '418', 'iran, islamic republic of': '364', 'xkx': 'kosovo'
  };

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

  /** Colour scale over the domain values + legend body (class counts use the visible values). */
  function buildScale(ctx, vals, shown, fmt) {
    var o = ctx.options, t = ctx.theme, ext = RK.util.extent(vals);
    var seq = seqStops(t);
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
      var count = shown.filter(function (v) { return classOf(v) === j; }).length;
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
      function fid(f) { return f.id != null ? f.id : 'n:' + f.properties.name; }
      var layers = {}, recs = {}, S = null, timer = null;
      var area = L.geoJSON(null, { onEachFeature: wire }).addTo(map);
      var labels = labelLayer(map), legend = legendControl(map, ctx.options.legendPosition);

      function filterField(c) { return c.options.filterField || c.enc.id; }
      /** Key -> feature: ISO numeric, ISO alpha-3, basemap name or a common alias. */
      function lookup(k) {
        if (k == null || k === '') return null;
        k = String(k).trim();
        if (/^\d+$/.test(k)) return byId[k.padStart(3, '0')] || null;
        var lk = k.toLowerCase(), al = ALIAS[lk];
        if (/^[a-z]{3}$/i.test(k) && ISO3[k.toUpperCase()]) return byId[ISO3[k.toUpperCase()]] || null;
        return byName[lk] || (al ? byId[al] || byName[al] : null) || null;
      }
      function featureOf(r, enc) { return lookup(r[enc.id]) || (enc.label ? lookup(r[enc.label]) : null); }

      function derive(c) {
        var enc = c.enc, o = c.options, out = {}, list = [];
        c.rows.forEach(function (r) {
          var f = featureOf(r, enc);
          if (!f || out[fid(f)]) return;                  // one row per country: first wins
          list.push(out[fid(f)] = { f: f, id: fid(f), row: r, v: num(r[enc.value]) });
        });
        var fmt = o.format || c.fmtOf(enc.value) || 'auto';
        var shown = list.map(function (x) { return x.v; }).filter(function (v) { return v != null; });
        var vals = domainRows(c).filter(function (r) { return featureOf(r, enc); }).map(function (r) { return num(r[enc.value]); }).filter(function (v) { return v != null; });
        var ranked = list.filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; });
        ranked.forEach(function (x, i) { x.rank = i + 1; });
        return { recs: out, list: list, ranked: ranked, fmt: fmt, scale: buildScale(c, vals.length ? vals : shown, shown, fmt), n: ranked.length };
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
        var id = fid(f);
        layers[id] = layer;
        layer.bindTooltip(function () { return recs[id] ? tipOf(recs[id]) : ''; }, { sticky: true, direction: 'top', offset: [0, -10], opacity: 1 });
        layer.on('mouseover', function () {
          layer.setStyle({ weight: 1.6, color: t.ink });
          layer.bringToFront();
        });
        layer.on('mouseout', function () { if (recs[id]) layer.setStyle(styleOf(recs[id])); });
        layer.on('click', function () {
          var rec = recs[id], ff = filterField(cur);
          if (rec && cur.options.crossFilter !== false && rec.row[ff] != null) cur.select(ff, rec.row[ff]);
        });
      }

      function draw(first) {
        S = derive(cur);
        recs = S.recs;
        // remove countries that left the data, add newcomers, restyle the rest (CSS transitions the fill)
        Object.keys(layers).forEach(function (id) { if (!recs[id]) { area.removeLayer(layers[id]); delete layers[id]; } });
        S.list.forEach(function (rec, i) {
          if (!layers[rec.id]) {
            area.addData(rec.f);
            var el = layers[rec.id].getElement();
            if (el) {
              el.classList.add('rk-choro__area');
              if (cur.motion) { el.classList.add('is-enter'); el.style.setProperty('--rk-d', Math.min((rec.rank || i) * 16, 600) + 'ms'); }
            }
          }
          layers[rec.id].setStyle(styleOf(rec));
        });
        if (cur.motion) {
          clearTimeout(timer);
          // strip the entry animation so bringToFront() (re-append) on hover does not replay it
          timer = setTimeout(function () { [].forEach.call(ctx.el.querySelectorAll('.rk-choro__area.is-enter'), function (n) { n.classList.remove('is-enter'); }); }, 1300);
        }
        // value labels: top N, pill at the main-polygon centroid
        var o = cur.options, enc = cur.enc, mid = o.scale === 'diverging' ? +o.mid || 0 : 0;
        var n = Math.max(0, o.labels | 0);
        labels.set((n ? S.ranked : []).map(function (rec) {
          var name = (enc.label && rec.row[enc.label]) || rec.f.properties.name;
          return {
            latlng: RK.geo.centroid(rec.f) || [0, 0], prio: Math.abs(rec.v - mid), pos: ['c'], cls: 'rk-choro__label',
            html: '<b>' + RK.util.escapeHTML(name) + '</b><span>' + RK.util.escapeHTML(RK.format(rec.v, S.fmt)) + '</span>'
          };
        }), n);
        if (o.legend !== false) {
          var hasNull = S.list.some(function (x) { return x.v == null; });
          legend.set(h('div.rk-geo-leg',
            legSec(o.legendTitle || fieldTitle(cur, enc.value), S.scale.legend),
            h('div.rk-geo-leg__item.rk-geo-leg__nodata', h('i.rk-geo-leg__sw.is-square', { style: { background: t.mapLand || t.surface2 } }), h('span', hasNull ? 'No data / n.a.' : 'No data'))));
        } else legend.set(null);
        if (first) {
          var pts = [];
          S.list.forEach(function (x) { pts = pts.concat(mainBounds(x.f)); });
          view.fit(fitTarget(o.fit, pts), 12, function () { return S.list.map(function (x) { return { ll: RK.geo.centroid(x.f) || [0, 0], r: 6 }; }); });
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
