/*!
 * RK component: choropleth — countries shaded by a value on the offline Natural Earth basemap.
 * Rows join to world-110m features by ISO 3166-1 numeric id (encode.id, e.g. "840"), falling
 * back to the country name. Sequential or diverging colour, continuous or classed (nice-rounded
 * quantile / equal-interval breaks), value labels on the top N countries, click to cross-filter.
 */
(function () {
  'use strict';
  var h = RK.util.h, G = RK.geo;

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
        out.push(G.nice(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (q - lo)));
      }
    }
    return RK.util.unique(out).filter(function (b) { return b > ext[0] && b < ext[1]; });
  }

  /** Colour scale over the domain values + legend body (class counts use the visible values). */
  function buildScale(ctx, vals, shown, fmt) {
    var o = ctx.options, t = ctx.theme, ext = RK.util.extent(vals);
    var seq = G.seqStops(t);
    var div = o.scale === 'diverging', mid = +o.mid || 0;
    var classed = (o.bins > 0 || (Array.isArray(o.breaks) && o.breaks.length)) && vals.length > 1;
    if (!classed) {
      if (div) {
        var dev = Math.max(Math.abs(ext[0] - mid), Math.abs(ext[1] - mid)) || 1;
        var dc = RK.theme.diverging([mid - dev, mid + dev], mid);
        return { color: dc, legend: G.legendRamp(t.div, [RK.format(mid - dev, fmt), RK.format(mid, fmt), RK.format(mid + dev, fmt)]) };
      }
      var sc = RK.theme.sequential(ext, seq);
      return { color: sc, legend: G.legendRamp(seq, [RK.format(ext[0], fmt), RK.format(ext[1], fmt)]) };
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
    var lf = G.tidyFmt(fmt, breaks), top = colors.map(function (c, j) { return j; }).reverse();   // highest class first
    return {
      color: function (v) { return v == null ? null : colors[classOf(v)]; },
      legend: G.legendItems(top, function (j) { return colors[j]; }, {
        label: function (j) {
          return j === 0 ? '< ' + RK.format(breaks[0], lf) : j === nCls - 1 ? '≥ ' + RK.format(breaks[j - 1], lf)
            : RK.format(breaks[j - 1], lf) + ' – ' + RK.format(breaks[j], lf);
        },
        note: function (j) { return String(shown.filter(function (v) { return classOf(v) === j; }).length); }   // countries per class
      })
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
      var view = G.view(ctx, { cls: 'rk-choro' }), map = view.map;
      var fc = RK.geo.features(ctx.options.basemap || 'world-110m');
      var byId = {}, byName = {};
      fc.features.forEach(function (f) {
        if (f.id != null) byId[f.id] = f;
        if (f.properties.name) byName[String(f.properties.name).toLowerCase()] = f;
      });
      function fid(f) { return f.id != null ? f.id : 'n:' + f.properties.name; }
      var layers = {}, recs = {}, S = null, timer = null;
      var area = L.geoJSON(null, { onEachFeature: wire }).addTo(map);
      var labels = view.labels(), legend = view.legend();

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
        var vals = G.domainRows(c).filter(function (r) { return featureOf(r, enc); }).map(function (r) { return num(r[enc.value]); }).filter(function (v) { return v != null; });
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
        layer.on('click', function () { var ff = filterField(cur); if (recs[id]) G.select(cur, ff, recs[id].row[ff]); });
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
            G.legendSection(o.legendTitle || G.fieldTitle(cur, enc.value), S.scale.legend),
            h('div.rk-geo-leg__item.rk-geo-leg__nodata', h('i.rk-geo-leg__sw', { style: { background: t.mapLand || t.surface2 } }), h('span', hasNull ? 'No data / n.a.' : 'No data'))));
        } else legend.set(null);
        if (first) {
          var pts = [];
          S.list.forEach(function (x) { pts = pts.concat(mainBounds(x.f)); });
          view.fit(G.fitTarget(o.fit, pts), 12, function () { return S.list.map(function (x) { return { ll: RK.geo.centroid(x.f) || [0, 0], r: 6 }; }); });
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
