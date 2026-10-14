/*!
 * RK component: choropleth — countries shaded by a value on the offline Natural Earth basemap.
 * Rows join to world-110m (or options.basemap 'world-50m') features by ISO 3166-1 numeric id (encode.id,
 * e.g. "840"), ISO alpha-3 or the country name. Sequential or diverging colour, continuous or classed
 * (nice-rounded quantile / equal-interval breaks), value labels on the top N countries, click to cross-filter.
 * Rows with no polygon in the basemap (Singapore, Hong Kong, Monaco ... on world-110m) but with lat / lon
 * (encode.lat / encode.lon) are drawn as small circles in the same colour scale, noted in the legend.
 */
(function () {
  'use strict';
  var h = RK.util.h, G = RK.geo;

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', { 'choropleth.points': '以圆点表示', 'choropleth.noData': '无数据', 'choropleth.noValue': 'n.a.（无数值）', 'choropleth.rank': '排名', 'choropleth.rankOf': '第 {rank} / {n}', 'choropleth.records': '记录数' });
  }

  /* ---------------- basemap on demand (same block in choropleth and bubble-map) ----------------
   * A report ships the basemap a block asks for (manifest optionDeps: basemap 'world-50m' -> vendor geo-world-50m).
   * Hosts that load only the manifest deps (dev harness, an older build) get it on demand: the script sits next to
   * world-110m.js (vendor/geo-world/world-110m.js -> vendor/geo-world-50m/world-50m.js). Until it arrives, or when
   * it cannot be found, the block draws on world-110m and says so in the console.
   */
  var GEO_LOADS = window.__RK_GEO_LOADS || (window.__RK_GEO_LOADS = {});
  function loadBasemap(name) {
    if (GEO_LOADS[name]) return GEO_LOADS[name];
    var base = [].filter.call(document.scripts, function (sc) { return /(^|\/)geo-world\/world-110m\.js(\?|#|$)/.test(sc.getAttribute('src') || ''); })[0];
    if (!base || !/^world-[\w-]+$/.test(name)) return (GEO_LOADS[name] = Promise.reject(new Error('no script location for basemap "' + name + '"')));
    var src = base.getAttribute('src').replace(/geo-world\/world-110m\.js.*$/, 'geo-' + name + '/' + name + '.js');
    return (GEO_LOADS[name] = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = src;
      sc.onload = function () { if (G.has(name)) resolve(name); else reject(new Error(src + ' did not register "' + name + '"')); };
      sc.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(sc);
    }));
  }
  /** Basemap to draw now: the requested one when registered, else world-110m while (or instead of) loading it. */
  function basemapFor(ctx) {
    var want = ctx.options.basemap || 'world-110m';
    if (G.has(want)) return want;
    var blk = ctx.block && ctx.block.rkBlock;
    loadBasemap(want).then(function () {
      if (blk && blk.state === 'rendered') blk.rerender();
    }, function (e) {
      if (!GEO_LOADS[want].warned) { GEO_LOADS[want].warned = true; console.warn('[RK] ' + ctx.component + ': basemap "' + want + '" is not loaded (' + e.message + '); drawing world-110m. Add vendor "geo-' + want + '" to the report.'); }
    });
    return 'world-110m';
  }

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

  /** Roundest number x with lo < x <= hi (coarsest step first): a class break inside the gap between two values. */
  function roundIn(lo, hi) {
    if (!(hi > lo)) return hi;
    var p = Math.pow(10, Math.ceil(Math.log10(Math.max(Math.abs(lo), Math.abs(hi)) || 1)) + 1);
    for (; p > (hi - lo) / 1e6; p /= 10) {
      for (var k = 0, M = [10, 5, 2.5, 2, 1]; k < M.length; k++) {
        var st = p * M[k] / 10, x = Math.floor(lo / st) * st + st;
        if (x <= hi + 1e-12) return +x.toPrecision(12);
      }
    }
    return hi;
  }
  /** Fisher-Jenks natural breaks on sorted values: start index of classes 2..k (minimum within-class variance). */
  function jenks(s, k) {
    var n = s.length, p1 = [0], p2 = [0], D = [], B = [], i, j, m;
    for (i = 0; i < n; i++) { p1.push(p1[i] + s[i]); p2.push(p2[i] + s[i] * s[i]); }
    function ssd(a, b) { var c = b - a + 1, sm = p1[b + 1] - p1[a]; return p2[b + 1] - p2[a] - sm * sm / c; }
    for (j = 0; j < k; j++) { D.push([]); B.push([]); for (i = 0; i < n; i++) { D[j].push(Infinity); B[j].push(0); } }
    for (i = 0; i < n; i++) D[0][i] = ssd(0, i);
    for (j = 1; j < k; j++) {
      for (i = j; i < n; i++) {
        for (m = j; m <= i; m++) { var c = D[j - 1][m - 1] + ssd(m, i); if (c < D[j][i]) { D[j][i] = c; B[j][i] = m; } }
      }
    }
    var out = [];
    for (j = k - 1, i = n - 1; j > 0; j--) { m = B[j][i]; out.unshift(m); i = m - 1; }
    return out;
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


  /** ISO 3166-1 alpha-3 -> numeric for every world-110m country, so ISO3 keys join too. */
  var ISO3 = {};
  ('FJI242 TZA834 ESH732 CAN124 USA840 KAZ398 UZB860 PNG598 IDN360 ARG032 CHL152 COD180 SOM706 KEN404 SDN729 TCD148 HTI332 DOM214 RUS643 BHS044 FLK238 NOR578 GRL304 ATF260 TLS626 ZAF710 LSO426 MEX484 URY858 BRA076 BOL068 PER604 COL170 PAN591 CRI188 NIC558 HND340 SLV222 GTM320 BLZ084 VEN862 GUY328 SUR740 FRA250 ECU218 PRI630 JAM388 CUB192 ZWE716 BWA072 NAM516 SEN686 MLI466 MRT478 BEN204 NER562 NGA566 CMR120 TGO768 GHA288 CIV384 GIN324 GNB624 LBR430 SLE694 BFA854 CAF140 COG178 GAB266 GNQ226 ZMB894 MWI454 MOZ508 SWZ748 AGO024 BDI108 ISR376 LBN422 MDG450 PSE275 GMB270 TUN788 DZA012 JOR400 ARE784 QAT634 KWT414 IRQ368 OMN512 VUT548 KHM116 THA764 LAO418 MMR104 VNM704 PRK408 KOR410 MNG496 IND356 BGD050 BTN064 NPL524 PAK586 AFG004 TJK762 KGZ417 TKM795 IRN364 SYR760 ARM051 SWE752 BLR112 UKR804 POL616 AUT040 HUN348 MDA498 ROU642 LTU440 LVA428 EST233 DEU276 BGR100 GRC300 TUR792 ALB008 HRV191 CHE756 LUX442 BEL056 NLD528 PRT620 ESP724 IRL372 NCL540 SLB090 NZL554 AUS036 LKA144 CHN156 TWN158 ITA380 DNK208 GBR826 ISL352 AZE031 GEO268 PHL608 MYS458 BRN096 SVN705 FIN246 SVK703 CZE203 ERI232 JPN392 PRY600 YEM887 SAU682 ATA010 CYP196 MAR504 EGY818 LBY434 ETH231 DJI262 UGA800 RWA646 BIH070 MKD807 SRB688 MNE499 TTO780 SSD728').split(' ').forEach(function (x) { ISO3[x.slice(0, 3)] = x.slice(3); });
  // territories and micro-states that only world-50m draws (on world-110m they fall back to points)
  ('SGP702 HKG344 MAC446 BHR048 MLT470 MCO492 LIE438 AND020 SMR674 VAT336 MUS480 MDV462 BRB052 BMU060 CYM136 VGB092 TCA796 MSR500 ' +
   'JEY832 GGY831 IMN833 TON776 SYC690 STP678 WSM882 VCT670 LCA662 KNA659 PLW585 NIU570 COK184 ABW533 CUW531 NRU520 KIR296 GRD308 ' +
   'SPM666 WLF876 MAF663 BLM652 PYF258 ALA248 DMA212 FRO234 COM174 CPV132 HMD334 NFK574 ATG028 SXM534 FSM583 MHL584 MNP580 VIR850 ' +
   'GUM316 ASM016 SGS239 IOT086 SHN654 PCN612 AIA660 GIB292 MYT175 REU638 GLP312 MTQ474 GUF254').split(' ').forEach(function (x) { ISO3[x.slice(0, 3)] = x.slice(3); });
  /** Common report spellings -> basemap ids / names. */
  var ALIAS = {
    'united states': '840', 'usa': '840', 'us': '840', 'u.s.': '840', 'uk': '826', 'great britain': '826', 'czech republic': '203',
    'korea': '410', 'republic of korea': '410', 'russian federation': '643', 'uae': '784', 'democratic republic of the congo': '180',
    'dr congo': '180', 'republic of the congo': '178', 'ivory coast': '384', "cote d'ivoire": '384', 'dominican republic': '214',
    'bosnia and herzegovina': '070', 'north macedonia': '807', 'eswatini': '748', 'swaziland': '748', 'central african republic': '140',
    'equatorial guinea': '226', 'solomon islands': '090', 'falkland islands': '238', 'western sahara': '732', 'south sudan': '728',
    'viet nam': '704', 'turkiye': '792', 'türkiye': '792', 'lao pdr': '418', 'iran, islamic republic of': '364', 'xkx': 'kosovo',
    'hong kong sar': '344', 'hong kong, china': '344', 'macau': '446', 'macao sar': '446', 'cape verde': '132', 'vatican city': '336',
    'holy see': '336', 'sao tome and principe': '678', 'são tomé and príncipe': '678', 'micronesia': '583', 'curacao': '531',
    'united states of america': '840', 'south korea': '410', 'north korea': '408', 'taiwan': '158', 'russia': '643'
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

  /** Class breaks: explicit, natural breaks (Jenks), nice-rounded quantiles, or nice equal intervals. */
  function classBreaks(o, vals, ext) {
    if (Array.isArray(o.breaks) && o.breaks.length) return o.breaks.slice().sort(function (a, b) { return a - b; });
    var n = Math.max(2, o.bins | 0), out = [];
    if (o.classify === 'jenks') {
      // each break is the roundest number between the last value of one class and the first of the next
      var sv = vals.slice().sort(function (a, b) { return a - b; }), uniq = RK.util.unique(sv);
      if (uniq.length <= n) { for (var u = 1; u < uniq.length; u++) out.push(roundIn(uniq[u - 1], uniq[u])); }
      else jenks(sv, n).forEach(function (m) { if (sv[m] > sv[m - 1]) out.push(roundIn(sv[m - 1], sv[m])); });
      return RK.util.unique(out).filter(function (b) { return b > ext[0] && b <= ext[1]; });
    }
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
    // every class stays clearly apart from the no-data land and the sea / paper (palest class, dark-theme midpoints)
    var bgs = [t.mapLand || t.surface2, t.mapWater || t.paper];
    function lift(c, hi) { return c == null ? c : separate(c, bgs, 15, hi ? (div ? t.div[t.div.length - 1] : seq[seq.length - 1]) : t.div[0]); }
    var classed = (o.bins > 0 || (Array.isArray(o.breaks) && o.breaks.length)) && vals.length > 1;
    if (!classed) {
      if (div) {
        var dev = Math.max(Math.abs(ext[0] - mid), Math.abs(ext[1] - mid)) || 1;
        var dc0 = RK.theme.diverging([mid - dev, mid + dev], mid), dc = function (v) { return lift(dc0(v), v >= mid); };
        return { color: dc, legend: G.legendRamp(t.div.map(function (c, i, a) { return lift(c, i >= (a.length - 1) / 2); }), [RK.format(mid - dev, fmt), RK.format(mid, fmt), RK.format(mid + dev, fmt)]) };
      }
      var sc0 = RK.theme.sequential(ext, seq), sc = function (v) { return lift(sc0(v), true); };
      return { color: sc, legend: G.legendRamp(seq.map(function (c) { return lift(c, true); }), [RK.format(ext[0], fmt), RK.format(ext[1], fmt)]) };
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
      colors = breaks.concat([null]).map(function (_, j) { return lift(ramp(j < nNeg ? 0.5 - 0.5 * (nNeg - j) / m : 0.5 + 0.5 * (j - nNeg + 1) / m), j >= nNeg); });
    } else {
      var r = RK.theme.ramp(seq);
      colors = breaks.concat([null]).map(function (_, j) { return lift(r(nCls > 1 ? j / (nCls - 1) : 1), true); });
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

  var hatchSeq = 0;

  /** Data bounds with the polar extremes clamped (Canadian Arctic, Antarctic islands), wider than RK.geo's world clamp. */
  function clampFit(pts) {
    var b = window.L.latLngBounds(pts);
    return window.L.latLngBounds([[Math.max(b.getSouth(), -56), b.getWest()], [Math.min(b.getNorth(), 74), b.getEast()]]);
  }

  RK.component({
    id: 'choropleth',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: { id: 'iso_num', value: 'value', label: 'country', lat: 'lat', lon: 'lon' },
      basemap: 'world-110m',      // world-110m | world-50m (finer coastlines, micro-states; the report ships vendor geo-world-50m)
      points: true,               // rows with no polygon in the basemap but with lat / lon: small circles in the same colour scale
      aggregate: null,            // several rows per country: null = first row wins | sum | avg | median | min | max | count
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
      scrollZoom: 'click'         // 'click' (plain-wheel zoom armed by a click) | true | false; Ctrl/Cmd + wheel always zooms
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx;
      var basemap = basemapFor(ctx);
      var view = G.view(ctx, { cls: 'rk-choro', basemap: basemap }), map = view.map;
      var fc = G.features(basemap);
      var byId = {}, byName = {};
      /** Rough size (bbox area of the outer rings): two features can share an id (world-50m: Australia and Ashmore and Cartier Is. are both "036") — the larger wins. */
      function sizeOf(f) {
        var g = f.geometry, polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        var bb = [180, 90, -180, -90];
        polys.forEach(function (pl) { pl[0].forEach(function (c) { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }); });
        return bb[2] > bb[0] ? (bb[2] - bb[0]) * (bb[3] - bb[1]) : 0;
      }
      fc.features.forEach(function (f) {
        if (f.id != null && (!byId[f.id] || sizeOf(f) > sizeOf(byId[f.id]))) byId[f.id] = f;
        if (f.properties.name) byName[String(f.properties.name).toLowerCase()] = f;
      });
      function fid(f) { return f.id != null ? f.id : 'n:' + f.properties.name; }
      var layers = {}, marks = {}, recs = {}, S = null, timer = null;
      map.options.zoomSnap = 0;   // fit the data exactly (a 0.25 zoom snap leaves up to a fifth of the block empty)
      var area = L.geoJSON(null, { onEachFeature: wire }).addTo(map);
      // territories without a polygon: circles in their own pane, above the countries (hover bringToFront never covers them)
      if (!map.getPane('rk-choro-pts')) map.createPane('rk-choro-pts').style.zIndex = 450;
      var dots = L.layerGroup().addTo(map);
      var legend = view.legend();
      var hatch = hatchPattern();

      /* point -> country (outer rings, bbox first): what a callout box would cover */
      var shapes = fc.features.filter(function (f) { return f.id !== '010'; }).map(function (f) {
        var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        var rings = polys.map(function (pl) { return pl[0]; }), bb = [180, 90, -180, -90];
        rings.forEach(function (r) { r.forEach(function (c) { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }); });
        return { id: fid(f), rings: rings, bb: bb };
      });
      function inRing(x, y, r) {
        var inside = false;
        for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
          if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
        }
        return inside;
      }
      function countryAt(lon, lat) {
        for (var i = 0; i < shapes.length; i++) {
          var q = shapes[i];
          if (lon < q.bb[0] || lon > q.bb[2] || lat < q.bb[1] || lat > q.bb[3]) continue;
          if (q.rings.some(function (r) { return inRing(lon, lat, r); })) return q.id;
        }
        return null;
      }
      /** Callout cost: share of the box over other data countries (worst), its own country, other land (sea is free). */
      function coverCost(b, it, centre) {
        var own = 0, other = 0, land = 0, n = 0;
        for (var i = 0; i < 5; i++) {
          for (var j = 0; j < 3; j++) {
            var ll = map.containerPointToLatLng([b.x + b.w * (i + 0.5) / 5, b.y + b.h * (j + 0.5) / 3]), id = countryAt(ll.lng, ll.lat);
            n++;
            if (id == null) continue;
            if (id === it.id) own++; else if (recs[id] && recs[id].v != null) other++; else land++;
          }
        }
        if (centre) return own >= n * 0.85 && !other ? 0 : 99;   // inside a large country: label sits on it
        return (10 * other + 4 * own + 0.6 * land) / n;
      }
      var labels = callouts(map, { cost: coverCost, maxCost: 5 });

      /** Hatch for countries in the data without a value (SVG pattern in the map's own renderer). */
      function hatchPattern() {
        var svg = map.getPanes().overlayPane.querySelector('svg'), NS = 'http://www.w3.org/2000/svg';
        if (!svg) return t.mapLand || t.surface2;
        var id = 'rk-choro-hatch-' + (++hatchSeq), defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(NS, 'defs'), svg.firstChild);
        var bg = t.mapLand || t.surface2, ln = RK.theme.mix(bg, t.ink, t.dark ? 0.24 : 0.2);
        var pat = document.createElementNS(NS, 'pattern');
        pat.setAttribute('id', id); pat.setAttribute('width', '6'); pat.setAttribute('height', '6'); pat.setAttribute('patternUnits', 'userSpaceOnUse');
        pat.innerHTML = '<rect width="6" height="6" fill="' + bg + '"/><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="' + ln + '" stroke-width="1"/>';
        defs.appendChild(pat);
        return 'url(#' + id + ')';
      }

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
      /** [lat, lon] of a row the basemap has no polygon for (micro-states, territories), else null. */
      function pointOf(r, c) {
        if (c.options.points === false) return null;
        var lat = num(r[c.enc.lat || 'lat']), lon = num(r[c.enc.lon || 'lon']);
        return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
      }
      function nameOf(rec) { return (cur.enc.label && rec.row[cur.enc.label]) || (rec.f ? rec.f.properties.name : rec.row[cur.enc.id]); }

      function aggOf(c) { var a = c.options.aggregate; return a && RK.expr.agg[a] ? RK.expr.agg[a] : null; }
      /** Rows -> one record per country (polygon) or territory (point): the first row, or options.aggregate over them. */
      function collect(rows, c) {
        var enc = c.enc, out = {}, list = [], agg = aggOf(c);
        rows.forEach(function (r) {
          var f = featureOf(r, enc), key, ll = null;
          if (f) key = fid(f);
          else {
            ll = pointOf(r, c);
            if (!ll) return;
            key = 'p:' + String(r[enc.id] != null && r[enc.id] !== '' ? r[enc.id] : r[enc.label]).toLowerCase();
          }
          var rec = out[key];
          if (!rec) list.push(rec = out[key] = { f: f, id: key, row: r, rows: [], ll: ll, point: !f });
          rec.rows.push(r);
        });
        list.forEach(function (rec) { rec.v = agg ? num(agg(rec.rows.map(function (r) { return r[enc.value]; }))) : num(rec.row[enc.value]); });
        return { out: out, list: list };
      }

      function derive(c) {
        var enc = c.enc, o = c.options, got = collect(c.rows, c), out = got.out, list = got.list;
        var fmt = o.format || c.fmtOf(enc.value) || 'auto';
        var shown = list.map(function (x) { return x.v; }).filter(function (v) { return v != null; });
        // colour domain over the unfiltered rows: classes stay put while filters change
        var vals = collect(G.domainRows(c), c).list.map(function (x) { return x.v; }).filter(function (v) { return v != null; });
        var ranked = list.filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; });
        ranked.forEach(function (x, i) { x.rank = i + 1; });
        return { recs: out, list: list, ranked: ranked, fmt: fmt, scale: buildScale(c, vals.length ? vals : shown, shown, fmt), n: ranked.length };
      }

      function styleOf(rec) {
        var ff = filterField(cur), sel = cur.selected(ff), on = !sel.length || sel.indexOf(rec.row[ff]) >= 0;
        var fill = rec.v == null ? hatch : S.scale.color(rec.v);
        return {
          fillColor: fill, fillOpacity: on ? 1 : 0.22,
          color: sel.length && on ? t.ink : (t.mapBorder || t.paper), weight: sel.length && on ? 1.2 : 0.6, opacity: 1
        };
      }

      function tipOf(rec) {
        var c = cur, enc = c.enc, r = rec.row;
        var rows = [{ color: rec.v == null ? null : S.scale.color(rec.v), label: c.title(enc.value), value: RK.format(rec.v, S.fmt) }];
        if (rec.v != null) rows.push({ label: tr('choropleth.rank', 'Rank'), value: tr('choropleth.rankOf', '{rank} of {n}', { rank: rec.rank, n: S.n }) });
        var agg = aggOf(c), many = agg && rec.rows.length > 1;
        if (many) rows.push({ label: tr('choropleth.records', 'Records'), value: String(rec.rows.length) });
        (c.options.tooltip || []).forEach(function (f) {
          // aggregated: numbers use the same aggregate, text lists its distinct values
          var v = r[f];
          if (many) {
            var all = rec.rows.map(function (x) { return x[f]; });
            v = all.some(function (x) { return typeof x === 'number'; }) ? agg(all) : RK.util.unique(all.filter(function (x) { return x != null && x !== ''; }));
            if (Array.isArray(v)) v = v.length > 3 ? v.slice(0, 3).join(', ') + ' +' + (v.length - 3) : v.join(', ');
          }
          rows.push({ label: c.title(f), value: RK.format(v, c.fmtOf(f)) });
        });
        return RK.chart.tip(nameOf(rec), rows);
      }

      /* ---------------- territories as points ---------------- */
      function dotRadius() { return Math.max(4.5, Math.min(6.5, map.getSize().x / 150)); }
      function dotStyle(rec) {
        var ff = filterField(cur), sel = cur.selected(ff), on = !sel.length || sel.indexOf(rec.row[ff]) >= 0;
        var fill = rec.v == null ? (t.mapLand || t.surface2) : S.scale.color(rec.v);
        return {
          radius: dotRadius(), fillColor: fill, fillOpacity: on ? 1 : 0.22,
          // a darker rim of its own colour keeps even the palest class legible as a dot on land or sea; selection ring = ink
          color: sel.length && on ? t.ink : RK.theme.mix(fill, t.ink, t.dark ? 0.25 : 0.45),
          weight: sel.length && on ? 1.6 : 1, opacity: on ? 1 : 0.4
        };
      }
      map.on('resize', function () { var r = dotRadius(); Object.keys(marks).forEach(function (id) { marks[id].setRadius(r); }); });
      function addDot(rec) {
        var m = L.circleMarker(rec.ll, L.Util.extend({ pane: 'rk-choro-pts', className: 'rk-choro__pt' }, dotStyle(rec)));
        m.bindTooltip(function () { return recs[rec.id] ? tipOf(recs[rec.id]) : ''; }, { direction: 'top', offset: [0, -6], opacity: 1 });
        m.on('mouseover', function () { m.setStyle({ weight: 2, color: t.ink }); });
        m.on('mouseout', function () { if (recs[rec.id]) m.setStyle(dotStyle(recs[rec.id])); });
        m.on('click', function () { var ff = filterField(cur); if (recs[rec.id]) G.select(cur, ff, recs[rec.id].row[ff]); });
        dots.addLayer(m);
        return m;
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
        Object.keys(marks).forEach(function (id) { if (!recs[id]) { dots.removeLayer(marks[id]); delete marks[id]; } });
        S.list.forEach(function (rec, i) {
          if (rec.point) {
            if (!marks[rec.id]) marks[rec.id] = addDot(rec);
            else { marks[rec.id].setLatLng(rec.ll); marks[rec.id].setStyle(dotStyle(rec)); }
            return;
          }
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
        // value callouts on the top N: on the country when it is large enough, else beside it with a leader line,
        // where they cover the fewest other data countries
        labels.set((n ? S.ranked : []).map(function (rec) {
          var name = nameOf(rec);
          return {
            latlng: rec.point ? rec.ll : G.centroid(rec.f) || [0, 0], id: rec.id, prio: Math.abs(rec.v - mid), center: !rec.point, r: rec.point ? dotRadius() + 1 : 0,
            cls: 'rk-choro__label',
            html: '<b>' + RK.util.escapeHTML(name) + '</b><span>' + RK.util.escapeHTML(RK.format(rec.v, S.fmt)) + '</span>'
          };
        }), n);
        if (o.legend !== false) {
          var hasNull = S.list.some(function (x) { return x.v == null; });
          var asPts = S.list.filter(function (x) { return x.point; });
          legend.set(h('div.rk-geo-leg',
            G.legendSection(o.legendTitle || G.fieldTitle(cur, enc.value), S.scale.legend),
            h('div.rk-geo-leg__item.rk-geo-leg__nodata', h('i.rk-geo-leg__sw', { style: { background: t.mapLand || t.surface2, 'box-shadow': 'inset 0 0 0 0.5px ' + RK.theme.mix(t.mapLand || t.surface2, t.ink, 0.25) } }), h('span', tr('choropleth.noData', 'No data'))),
            hasNull ? h('div.rk-geo-leg__item.rk-geo-leg__nodata', h('i.rk-geo-leg__sw.rk-choro__hatch'), h('span', tr('choropleth.noValue', 'n.a. (no value)'))) : null,
            // micro-states / territories the basemap has no polygon for
            asPts.length ? h('div.rk-geo-leg__item.rk-geo-leg__nodata.rk-choro__ptnote', { title: asPts.map(nameOf).join(', ') },
              h('i.rk-choro__ptsw', { 'aria-hidden': 'true' }), h('span', tr('choropleth.points', 'shown as points'))) : null));
        } else legend.set(null);
        if (first) {
          var pts = [];
          S.list.forEach(function (x) { pts = pts.concat(x.point ? [x.ll] : mainBounds(x.f)); });
          // the legend must not cover any data country: test its outline vertices, not just the centroids
          var edge = pts.filter(function (p, i) { return i % 3 === 0; }).map(function (p) { return { ll: p, r: 0 }; })
            .concat(S.list.filter(function (x) { return x.point; }).map(function (x) { return { ll: x.ll, r: dotRadius() + 2 }; }));
          // 'data': every data country whole (Tierra del Fuego, northern Scandinavia), polar extremes still clamped
          var tgt = o.fit === 'data' && pts.length ? clampFit(pts) : G.fitTarget(o.fit, pts);
          view.fit(tgt, 12, function () { return edge; });
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
