/*!
 * RK component: flow-map — origin -> destination flows (cross-border M&A, trade, capital) as
 * curved arcs on the offline basemap. Stroke width by value, colour by category, arrowheads at
 * the destination, country nodes sized by total flow, travelling-dot animation (CSS, motion only),
 * hover to isolate a flow or a country's flows, click to cross-filter.
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
    RK.i18n.add('zh-CN', {
      'flowMap.share': '占所示流量比例', 'flowMap.outbound': '流出', 'flowMap.inbound': '流入', 'flowMap.netOut': '净流出',
      'flowMap.valueCount': '数值（{Count}）'
    });
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


  /** Arrowhead SVG (tip at the origin of its box, pointing +x), rotated / pulled back by CSS. */
  function arrowHTML(size, color, angle, back) {
    var s = size, w = s * 0.62;
    return '<svg class="rk-flow__arrow-svg" width="' + (s + 2) + '" height="' + (2 * w + 2) + '" viewBox="' + (-s - 1) + ' ' + (-w - 1) + ' ' + (s + 2) + ' ' + (2 * w + 2) + '"' +
      ' style="transform: translate(' + (-s - 1) + 'px,' + (-w - 1) + 'px) rotate(' + angle.toFixed(1) + 'deg) translate(' + (-back).toFixed(1) + 'px,0); transform-origin:' + (s + 1) + 'px ' + (w + 1) + 'px">' +
      '<path d="M0,0 L' + (-s) + ',' + (-w).toFixed(1) + ' L' + (-s * 0.7).toFixed(1) + ',0 L' + (-s) + ',' + w.toFixed(1) + ' Z" fill="' + color + '"/></svg>';
  }

  RK.component({
    id: 'flow-map',
    deps: ['leaflet', 'topojson-client', 'geo-world'],
    defaults: {
      encode: {
        from: 'from_country', to: 'to_country', fromLat: 'from_lat', fromLon: 'from_lon', toLat: 'to_lat', toLon: 'to_lon',
        value: 'value', count: 'deals', color: 'sector'
      },
      basemap: 'world-110m',
      widthRange: [1, 9],         // stroke width in px for the smallest / largest flow (linear in value)
      curvature: 0.25,            // arc bend (0 = straight); long arcs are flattened so they stay on the map
      opacity: 0.72,              // arc opacity
      arrows: true,               // arrowheads at the destination
      animate: true,              // travelling dots along the hovered flows (only when motion is allowed; arcs are always solid)
      nodes: true,                // origin / destination circles sized by total flow
      nodeSizeRange: [3, 11],
      labels: 8,                  // label the top N countries by total flow (0 = none)
      labelMin: 0.1,              // ...plus every country whose total is at least this share of the largest (when there is room)
      labelRest: true,            // ...and every other country where a label fits right beside its node without covering anything
      flowLabels: 0,              // value labels on the top N flows (0 = none)
      maxFlows: null,             // keep only the N largest flows
      format: null,               // value format; defaults to the value field format
      tooltip: [],                // extra fields listed in the flow tooltip
      fit: 'data',                // data | world | [[s, w], [n, e]] | {center: [lat, lon], zoom}
      legend: true,
      legendPosition: 'bottomleft',
      filterField: null,          // click-to-filter field; defaults to encode.color, else encode.from
      scrollZoom: 'click'         // 'click' (plain-wheel zoom armed by a click) | true | false; Ctrl/Cmd + wheel always zooms
    },
    render: function (ctx) {
      var L = window.L, t = ctx.theme, cur = ctx, el = ctx.el;
      var view = G.view(ctx, { cls: 'rk-flow' }), map = view.map;
      map.createPane('rk-flow-arrows').style.zIndex = 450;
      var layer = L.layerGroup().addTo(map);
      var legend = view.legend();
      /** Callout cost: other nodes the box covers (arcs are thin and may pass under a label). */
      function nodeCost(b, it, centre) {
        if (centre) return 0;
        var cost = 0;
        S.nodes.forEach(function (n) {
          if (n.name === it.name) return;
          var c = map.latLngToContainerPoint(n.ll), r = n.r + 2;
          if (c.x + r > b.x && c.x - r < b.x + b.w && c.y + r > b.y && c.y - r < b.y + b.h) cost += 2;
        });
        return cost;
      }
      var labels = callouts(map, { cost: nodeCost, optionalCost: 0.5 });
      var S = null, timers = [];

      function ff(c) { return c.options.filterField || c.enc.color || c.enc.from; }

      function derive(c) {
        var enc = c.enc, o = c.options, fmt = o.format || c.fmtOf(enc.value) || 'auto';
        // domain (unfiltered) scales keep widths / colours stable under filters
        var dom = G.domainRows(c), maxV = 0;
        var agg = function (rows) {
          var m = new Map();
          rows.forEach(function (r) {
            var a = [num(r[enc.fromLat]), num(r[enc.fromLon])], b = [num(r[enc.toLat]), num(r[enc.toLon])];
            if (a[0] == null || a[1] == null || b[0] == null || b[1] == null || r[enc.from] === r[enc.to]) return;
            var k = [r[enc.from], r[enc.to], enc.color ? r[enc.color] : ''].join('\u0001'), f = m.get(k);
            if (!f) m.set(k, f = { key: k, from: r[enc.from], to: r[enc.to], cat: enc.color ? r[enc.color] : null, a: a, b: b, v: 0, n: 0, row: r, rows: [] });
            f.v += num(r[enc.value]) || 0;
            f.n += enc.count ? num(r[enc.count]) || 0 : 1;
            f.rows.push(r);
          });
          return Array.from(m.values());
        };
        agg(dom).forEach(function (f) { maxV = Math.max(maxV, f.v); });
        var flows = agg(c.rows).sort(function (x, y) { return y.v - x.v; });
        if (o.maxFlows > 0) flows = flows.slice(0, o.maxFlows);
        var total = flows.reduce(function (s, f) { return s + f.v; }, 0);
        var cats = enc.color ? RK.util.unique(dom.map(function (r) { return r[enc.color]; }).filter(function (v) { return v != null && v !== ''; })) : [];
        var cm = catColors(cats);                     // sectors kept apart in hue (thin arcs), clear of the accent-2 target
        var wr = o.widthRange || [1, 9];
        var wOf = function (v) { return wr[0] + (wr[1] - wr[0]) * (maxV ? Math.max(0, v) / maxV : 0); };
        // nodes: totals per country
        var nodes = new Map();
        function node(name, ll) { var n = nodes.get(name); if (!n) nodes.set(name, n = { name: name, ll: ll, out: 0, in: 0, outN: 0, inN: 0 }); return n; }
        flows.forEach(function (f) {
          var s = node(f.from, f.a), d = node(f.to, f.b);
          s.out += f.v; s.outN += f.n; d.in += f.v; d.inN += f.n;
        });
        var nodeList = Array.from(nodes.values()).sort(function (x, y) { return (y.in + y.out) - (x.in + x.out); });
        var rOf = G.radius(nodeList.map(function (n) { return n.in + n.out; }), o.nodeSizeRange || [3, 11]);
        nodeList.forEach(function (n) { n.r = o.nodes === false ? 0 : rOf(n.in + n.out); });
        // arcs: bend capped for long chords; parallel flows between the same pair fan out
        var seen = {};
        flows.forEach(function (f) {
          var pair = f.from + '\u0001' + f.to, k = seen[pair] = (seen[pair] || 0) + 1;
          var chord = Math.sqrt(Math.pow(f.b[1] - f.a[1], 2) + Math.pow(f.b[0] - f.a[0], 2)) || 1;
          var curv = Math.min(o.curvature, 36 / chord) + (k - 1) * 0.07;
          f.pts = G.arc(f.a, f.b, curv, 48);
          f.w = wOf(f.v);
          f.color = enc.color ? cm(f.cat) : t.accent3 || t.cat[1];
          f.share = total ? f.v / total : null;
          f.dest = nodes.get(f.to);
        });
        return { flows: flows, nodes: nodeList, fmt: fmt, cats: cats, cm: cm, maxV: maxV, wOf: wOf, total: total };
      }

      function flowOn(f) { return G.isOn(cur, f.row, [ff(cur)]); }

      function flowTip(f) {
        var c = cur, enc = c.enc, rows = [{ color: f.color, label: c.title(enc.value), value: RK.format(f.v, S.fmt), bold: false }];
        if (enc.count) rows.push({ label: c.title(enc.count), value: RK.format(f.n, c.fmtOf(enc.count) || '#,##0') });
        if (f.share != null) rows.push({ label: tr('flowMap.share', 'Share of shown flows'), value: RK.format(f.share, '0.0%') });
        if (enc.color) rows.push({ label: c.title(enc.color), value: f.cat });
        (c.options.tooltip || []).forEach(function (fld) { rows.push({ label: c.title(fld), value: RK.format(f.row[fld], c.fmtOf(fld)) }); });
        return RK.chart.tip(f.from + '  →  ' + f.to, rows);
      }
      function nodeTip(n) {
        var c = cur, enc = c.enc, cf = c.fmtOf(enc.count) || '#,##0';
        var rows = [
          { label: tr('flowMap.outbound', 'Outbound'), value: RK.format(n.out, S.fmt) + (enc.count ? '  (' + RK.format(n.outN, cf) + ')' : '') },
          { label: tr('flowMap.inbound', 'Inbound'), value: RK.format(n.in, S.fmt) + (enc.count ? '  (' + RK.format(n.inN, cf) + ')' : '') },
          { label: tr('flowMap.netOut', 'Net outbound'), value: RK.format(n.out - n.in, S.fmt), bold: true }
        ];
        return RK.chart.tip(n.name, rows, enc.count ? tr('flowMap.valueCount', 'Value ({count})', { count: c.title(enc.count).toLowerCase(), Count: c.title(enc.count) }) : null);
      }

      /** Hover focus: isolate the given flows (and their end nodes). */
      function focus(list) {
        el.classList.toggle('is-focus', !!list);
        [].forEach.call(el.querySelectorAll('.is-hot'), function (n) { n.classList.remove('is-hot'); });
        (list || []).forEach(function (f) { f.els.forEach(function (e) { if (e) e.classList.add('is-hot'); }); });
      }

      function draw(first) {
        S = derive(cur);
        timers.forEach(clearTimeout); timers = [];
        layer.clearLayers();
        var o = cur.options, sel = cur.selected(ff(cur)).length, motion = cur.motion;
        // legend + fit first: the arc draw-in measures path lengths at the final zoom
        if (o.legend !== false) {
          var secs = [];
          if (cur.enc.color && S.cats.length) {
            secs.push(G.legendSection(cur.title(cur.enc.color), G.legendItems(S.cats, S.cm, {
              selected: cur.selected(cur.enc.color), onClick: o.crossFilter !== false ? function (v) { G.select(cur, cur.enc.color, v); } : null
            })));
          }
          var refs = G.sizeRefs(S.maxV), lf = G.tidyFmt(S.fmt, refs);
          if (refs.length) {
            secs.push(G.legendSection(G.fieldTitle(cur, cur.enc.value), h('div.rk-geo-leg__items', refs.map(function (v) {
              return h('div.rk-geo-leg__item', h('i.rk-flow__wsw', { style: { height: S.wOf(v).toFixed(1) + 'px', background: cur.enc.color ? t.ink3 : t.accent3 || t.cat[1] } }), h('span', RK.format(v, lf)));
            }))));
          }
          legend.set(secs.length ? h('div.rk-geo-leg' + (secs.length > 1 ? '.is-row' : ''), secs) : null);
        } else legend.set(null);
        if (first) {
          var pts = [];
          S.flows.forEach(function (f) { pts.push(f.a, f.b, f.pts[Math.floor(f.pts.length / 2)]); });
          view.fit(G.fitTarget(o.fit, pts), 14, function () { return S.nodes.map(function (n) { return { ll: n.ll, r: n.r + 2 }; }); });
        }
        var dots = motion && o.animate !== false;
        // largest first so thin flows stay visible (and hoverable) on top
        S.flows.forEach(function (f, i) {
          var on = flowOn(f), op = on ? o.opacity : 0.1;
          // solid arcs on a thin paper casing, so crossing flows stay apart; the travelling dots are a hover effect only
          // (a static capture or print never shows dotted / dashed arcs, which are reserved for reference lines)
          var casing = L.polyline(f.pts, { color: t.paper, weight: f.w + 2, opacity: on ? 0.85 : 0, lineCap: 'round', interactive: false, className: 'rk-flow__casing' }).addTo(layer);
          var arc = L.polyline(f.pts, { color: f.color, weight: f.w, opacity: op, lineCap: 'round', interactive: false, className: 'rk-flow__arc' }).addTo(layer);
          var dash = dots ? L.polyline(f.pts, {
            color: t.paper, weight: Math.max(1.2, f.w * 0.42), opacity: 0.9, lineCap: 'round', interactive: false,
            dashArray: '0.1 ' + Math.round(10 + f.w * 2.2), className: 'rk-flow__dots'
          }).addTo(layer) : null;
          var arrow = null;
          if (o.arrows !== false) {
            var p1 = map.project(f.pts[f.pts.length - 2], 0), p2 = map.project(f.pts[f.pts.length - 1], 0);
            var ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI, size = Math.max(6, f.w * 1.5 + 4);
            arrow = L.marker(f.b, {
              pane: 'rk-flow-arrows', interactive: false, keyboard: false,
              icon: L.divIcon({ className: 'rk-flow__arrow', iconSize: null, html: arrowHTML(size, f.color, ang, (f.dest ? f.dest.r : 0) + 1) })
            }).addTo(layer);
            var ae = arrow.getElement();
            if (ae) ae.style.opacity = on ? 0.95 : 0.1;
          }
          var hit = L.polyline(f.pts, { color: f.color, weight: Math.max(10, f.w + 6), opacity: 0, className: 'rk-flow__hit' }).addTo(layer);
          hit.bindTooltip(function () { return flowTip(f); }, { sticky: true, direction: 'top', offset: [0, -8], opacity: 1 });
          f.els = [arc.getElement(), dash && dash.getElement(), arrow && arrow.getElement(), casing.getElement()];
          hit.on('mouseover', function () { focus([f]); });
          hit.on('mouseout', function () { focus(null); });
          hit.on('click', function () { G.select(cur, ff(cur), f.row[ff(cur)]); });
          // entry: arcs draw from origin to destination, staggered by size
          if (motion && first) {
            var pe = arc.getElement(), len = pe && pe.getTotalLength ? pe.getTotalLength() : 0;
            if (len) {
              pe.style.strokeDasharray = len; pe.style.strokeDashoffset = len;
              pe.getBoundingClientRect();
              pe.style.transition = 'stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1) ' + Math.min(i * 45, 700) + 'ms';
              pe.style.strokeDashoffset = '0';
              timers.push(setTimeout(function () { pe.style.strokeDasharray = ''; pe.style.strokeDashoffset = ''; pe.style.transition = ''; }, 1800));
            }
            [f.els[2]].forEach(function (e) { if (e) { e.classList.add('is-enter'); e.style.setProperty('--rk-d', (Math.min(i * 45, 700) + 650) + 'ms'); } });
            var ce = f.els[3], clen = ce && ce.getTotalLength ? ce.getTotalLength() : 0;
            if (clen) {
              ce.style.strokeDasharray = clen; ce.style.strokeDashoffset = clen;
              ce.getBoundingClientRect();
              ce.style.transition = 'stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1) ' + Math.min(i * 45, 700) + 'ms';
              ce.style.strokeDashoffset = '0';
              timers.push(setTimeout(function () { ce.style.strokeDasharray = ''; ce.style.strokeDashoffset = ''; ce.style.transition = ''; }, 1800));
            }
          }
          if (sel && on) f.els.forEach(function (e) { if (e) e.classList.add('is-sel'); });
        });
        if (motion && first) timers.push(setTimeout(function () { [].forEach.call(el.querySelectorAll('.rk-flow .is-enter'), function (n) { n.classList.remove('is-enter'); }); }, 2400));

        if (o.nodes !== false) {
          S.nodes.forEach(function (n) {
            var m = L.circleMarker(n.ll, { radius: n.r, color: t.ink2, weight: 1.1, fillColor: t.paper, fillOpacity: 1, className: 'rk-flow__node' }).addTo(layer);
            m.bindTooltip(function () { return nodeTip(n); }, { direction: 'top', offset: [0, -n.r - 2], opacity: 1 });
            m.on('mouseover', function () { focus(S.flows.filter(function (f) { return f.from === n.name || f.to === n.name; })); m.setStyle({ color: t.ink, weight: 1.8 }); });
            m.on('mouseout', function () { focus(null); m.setStyle({ color: t.ink2, weight: 1.1 }); });
          });
        }

        // labels: countries (by total) first, then flow values at the arc apex
        // country callouts: the top N by total flow plus every country above labelMin x the largest total, beside the
        // node or off it with a leader line; then flow values at the arc apex
        var nl = Math.max(0, o.labels | 0), fl = Math.max(0, o.flowLabels | 0);
        var big = S.nodes.length ? S.nodes[0].in + S.nodes[0].out : 0, lm = o.labelMin > 0 ? o.labelMin * big : Infinity;
        var named = S.nodes.filter(function (n, i) { return nl && (i < nl || n.in + n.out >= lm || o.labelRest !== false); });
        var list = named.map(function (n, i) {
          var opt = !(i < nl || n.in + n.out >= lm);   // the rest: only right beside the node, only when nothing is covered
          return { latlng: n.ll, r: n.r, name: n.name, optional: opt, prio: (opt ? 0 : 1e12) + n.in + n.out, html: '<b>' + RK.util.escapeHTML(n.name) + '</b>' };
        }).concat((fl ? S.flows.slice(0, fl) : []).map(function (f) {
          return { latlng: f.pts[Math.floor(f.pts.length / 2)], r: f.w / 2, prio: f.v, center: true, leader: false, cls: 'rk-flow__vlabel', html: RK.util.escapeHTML(RK.format(f.v, S.fmt)) };
        }));
        labels.set(list);


        if (first) labels.place();
      }

      draw(true);

      return view.instance({
        update: function (c) { cur = c; draw(false); },
        destroy: function () { timers.forEach(clearTimeout); el.classList.remove('is-focus'); }
      });
    }
  });
})();
