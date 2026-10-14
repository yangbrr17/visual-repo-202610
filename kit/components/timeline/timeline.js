/*!
 * RK component: timeline — dated milestones / corporate events on a time axis.
 * Horizontal: events on a proportional time axis, labels alternate above / below with leader lines
 * and are stacked into lanes so that no label overlaps another label or crosses another leader.
 * Vertical (narrow blocks): date column | axis | label + detail, evenly spaced with year markers, or
 * proportional with dodged labels and elbow leaders. Kind-based marker shapes and colours, legend,
 * HTML tooltip (RK.chart.tip), click-to-filter, staggered reveal and animated re-layout on update.
 * Pure DOM + inline SVG (no chart engine).
 */
(function () {
  'use strict';
  var h = RK.util.h;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var DAY = 864e5;
  var SHAPES = ['circle', 'diamond', 'square', 'triangle', 'hexagon'];
  var GAP = 10;           // min horizontal gap between labels in a lane
  var STEM = 16;          // leader length from the axis to lane 0
  var LANE_GAP = 8;       // vertical gap between lanes
  var AXIS_ROW = 22;      // period labels under the plot (horizontal)

  function ts(v) { var d = RK.format.toDate(v); return d && !isNaN(d) ? d.getTime() : null; }
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    return el;
  }
  function addMonths(t, n) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); }
  function periodStart(t, months) { var d = new Date(t); return new Date(d.getFullYear(), Math.floor(d.getMonth() / months) * months, 1).getTime(); }

  /** SVG path for a marker shape of radius r centred on (0, 0). */
  function shapePath(shape, r) {
    switch (shape) {
      case 'diamond': var d = r * 1.22; return 'M0 ' + (-d) + 'L' + d + ' 0L0 ' + d + 'L' + (-d) + ' 0Z';
      case 'square': var s = r * 0.9; return 'M' + (-s) + ' ' + (-s) + 'H' + s + 'V' + s + 'H' + (-s) + 'Z';
      case 'triangle': return 'M0 ' + (-r * 1.18) + 'L' + (r * 1.12) + ' ' + (r * 0.78) + 'H' + (-r * 1.12) + 'Z';
      case 'hexagon':
        var p = [];
        for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i - Math.PI / 2; p.push((r * 1.08 * Math.cos(a)).toFixed(2) + ' ' + (r * 1.08 * Math.sin(a)).toFixed(2)); }
        return 'M' + p.join('L') + 'Z';
      default: return 'M' + (-r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0Z';
    }
  }
  function shapeSVG(shape, r, fill, ring) {
    var s = Math.ceil(r * 2.6 + 4);
    return '<svg viewBox="' + (-s / 2) + ' ' + (-s / 2) + ' ' + s + ' ' + s + '" width="' + s + '" height="' + s + '" style="margin:' + (-s / 2) + 'px 0 0 ' + (-s / 2) + 'px" aria-hidden="true">' +
      '<path d="' + shapePath(shape, r) + '" fill="' + fill + '" stroke="' + ring + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  /** Colour for a kind: options.kindColors value may be a theme token name, 'cat3' or an index. */
  function tokenColor(t, v) {
    if (v == null) return null;
    if (typeof v === 'number') return t.cat[((v % t.cat.length) + t.cat.length) % t.cat.length];
    var m = String(v).match(/^cat-?(\d+)$/);
    if (m) return t.cat[(+m[1] - 1) % t.cat.length];
    var key = String(v).replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); });
    return t[key] || null;
  }

  /** Period axis for [lo, hi] at pxPerDay: months, quarters or years. */
  function periods(lo, hi, pxPerDay) {
    var monthPx = pxPerDay * 30.4, months, fmt;
    if (monthPx >= 64) { months = 1; fmt = function (d) { return RK.format(d, 'mmm yy'); }; }
    else if (monthPx * 3 >= 46) { months = 3; fmt = function (d) { return 'Q' + RK.format(d, 'q yy'); }; }
    else { months = 12; fmt = function (d) { return RK.format(d, 'yyyy'); }; }
    var out = [];
    for (var t = periodStart(lo, months); t < hi; t = addMonths(t, months)) {
      out.push({ s: t, e: addMonths(t, months), text: fmt(new Date(t)), major: new Date(t).getMonth() === 0 });
    }
    return out;
  }

  RK.component({
    id: 'timeline',
    deps: [],
    defaults: {
      encode: { date: 'date', label: 'label', kind: 'kind', detail: 'detail' },
      orientation: 'auto',    // auto | horizontal | vertical (auto -> vertical when narrower than 560px)
      side: 'both',           // horizontal labels: both (alternate above / below) | above | below
      labelStyle: 'flag',     // flag (text beside the leader) | center (text centred on the leader)
      labelWidth: 160,        // max label width in px (horizontal)
      marker: 'shape',        // shape (kind-based shapes) | number (numbered discs, by date) | dot
      kindColors: null,       // {kind: token | 'cat3' | index}, e.g. {"m&a": "accent2"}
      kindShapes: null,       // {kind: circle | diamond | square | triangle | hexagon}
      kindLabels: null,       // {kind: 'Display name'} for legend / tooltip
      showDetail: 'auto',     // detail line under the label: true | false | 'auto' (vertical only)
      dateFormat: 'd mmm yy', // date shown on each label
      spacing: 'even',        // vertical: even (rows + year markers) | time (proportional, dodged)
      domain: null,           // [start, end] fixed time window (horizontal)
      today: null,            // 'YYYY-MM-DD' | 'now' | null — dashed "today" marker
      todayLabel: 'Today',
      highlight: null,        // label value(s) to emphasise (accent-2 label, larger marker)
      selectBy: 'kind',       // click-to-filter channel: kind | label | null
      legend: true
    },
    render: function (ctx) {
      var el = ctx.el;
      var root = h('div.rk-tl');
      var legendEl = h('div.rk-legend.rk-tl__legend');
      var stage = h('div.rk-tl__stage');
      var gridLayer = h('div.rk-tl__grid');
      var svg = svgEl('svg', { class: 'rk-tl__svg', 'aria-hidden': 'true' });
      var axisEl = h('div.rk-tl__axis');
      var labelLayer = h('div.rk-tl__labels');
      var markerLayer = h('div.rk-tl__markers');
      var tip = h('div.rk-tl__tip', { role: 'tooltip' });
      stage.appendChild(gridLayer); stage.appendChild(svg); stage.appendChild(axisEl);
      stage.appendChild(labelLayer); stage.appendChild(markerLayer); stage.appendChild(tip);
      root.appendChild(legendEl); root.appendChild(stage);
      el.appendChild(root);
      var origHeight = el.style.height;
      var items = new Map();       // key -> {ev, label, marker, leader}
      var current = ctx, first = true, hideTimer = null;

      /* ---------- model ---------- */
      function model(c) {
        var o = c.options, enc = c.enc, t = c.theme;
        var evs = [];
        c.rows.forEach(function (r, i) {
          var d = ts(r[enc.date]);
          if (d == null) return;
          evs.push({ row: r, t: d, label: r[enc.label] == null ? '' : String(r[enc.label]), kind: enc.kind && r[enc.kind] != null ? String(r[enc.kind]) : null,
            detail: enc.detail && r[enc.detail] != null ? String(r[enc.detail]) : null, i: i });
        });
        evs.sort(function (a, b) { return (a.t - b.t) || (a.i - b.i); });
        var dup = {};
        evs.forEach(function (ev) {
          var k = ev.t + '|' + ev.label;
          dup[k] = (dup[k] || 0) + 1;
          ev.key = k + (dup[k] > 1 ? '#' + dup[k] : '');
        });
        // marker numbers follow the unfiltered (but 'where'-restricted) event list, so they stay put when filtering
        var base = c.allRows;
        if (o.where && c.dataset) { try { var wc = RK.expr.compile(o.where, { fields: c.dataset.fields }); base = base.filter(function (r) { return wc.eval(r, { params: RK.store.params() }); }); } catch (e) { base = c.rows; } }
        var order = base.map(function (r) { return [ts(r[enc.date]), r[enc.label] == null ? '' : String(r[enc.label])]; })
          .filter(function (p) { return p[0] != null; }).sort(function (a, b) { return a[0] - b[0]; })
          .map(function (p) { return p[0] + '|' + p[1]; });
        evs.forEach(function (ev, i) { var j = order.indexOf(ev.t + '|' + ev.label); ev.n = j >= 0 ? j + 1 : i + 1; });
        // kinds: stable order from all rows so colours do not shift when filtering
        var kinds = RK.util.unique(c.allRows.map(function (r) { return enc.kind && r[enc.kind] != null ? String(r[enc.kind]) : null; }).filter(function (k) { return k != null; }));
        var kc = o.kindColors || {}, ks = o.kindShapes || {};
        // automatic colours skip any colour already claimed by a kindColors override (e.g. accent2 == cat-2 in some themes)
        var taken = Object.keys(kc).map(function (k) { return String(tokenColor(t, kc[k]) || '').toLowerCase(); });
        var pal = t.cat.filter(function (col) { return taken.indexOf(col.toLowerCase()) < 0; });
        if (!pal.length) pal = t.cat;
        var auto = {};
        kinds.filter(function (k) { return !tokenColor(t, kc[k]); }).forEach(function (k, i) { auto[k] = pal[i % pal.length]; });
        var colorOf = function (k) { return k == null ? t.accent : (tokenColor(t, kc[k]) || auto[k] || t.neutral); };
        var shapeOf = function (k) { return o.marker === 'dot' ? 'circle' : (ks[k] || SHAPES[Math.max(0, kinds.indexOf(k)) % SHAPES.length]); };
        var selField = o.selectBy ? enc[o.selectBy] : null;
        var sel = selField ? c.selected(selField) : [];
        var hi = o.highlight == null ? [] : [].concat(o.highlight);
        evs.forEach(function (ev) {
          ev.color = colorOf(ev.kind);
          ev.shape = shapeOf(ev.kind);
          ev.selValue = selField ? ev.row[selField] : null;
          ev.dim = sel.length > 0 && sel.indexOf(ev.selValue) < 0;
          ev.hl = hi.indexOf(ev.label) >= 0;
        });
        var present = {};
        evs.forEach(function (ev) { if (ev.kind != null) present[ev.kind] = 1; });
        return { evs: evs, kinds: kinds.filter(function (k) { return present[k] || sel.indexOf(k) >= 0; }), colorOf: colorOf, shapeOf: shapeOf, selField: selField, sel: sel };
      }

      function kindName(c, k) { var m = c.options.kindLabels; return m && m[k] ? m[k] : (k ? k.charAt(0).toUpperCase() + k.slice(1) : ''); }

      /* ---------- legend ---------- */
      function drawLegend(c, M) {
        legendEl.innerHTML = '';
        var o = c.options;
        if (o.legend === false || !M.kinds.length || !c.enc.kind) { legendEl.style.display = 'none'; return; }
        legendEl.style.display = '';
        var t = c.theme;
        M.kinds.forEach(function (k) {
          var active = !M.sel.length || o.selectBy !== 'kind' || M.sel.indexOf(k) >= 0;
          var item = h('button.rk-legend__item.rk-tl__lg', { type: 'button', class: active ? null : 'is-off', title: o.selectBy === 'kind' ? 'Filter by ' + kindName(c, k) : null,
            html: (o.marker === 'number' ? '<i class="rk-legend__swatch" style="background:' + M.colorOf(k) + ';border-radius:50%"></i>' : shapeSVG(M.shapeOf(k), 4.2, M.colorOf(k), t.paper)) + '<span>' + RK.util.escapeHTML(kindName(c, k)) + '</span>' });
          if (o.selectBy === 'kind' && o.crossFilter !== false) item.addEventListener('click', function () { current.select(c.enc.kind, k); });
          else item.disabled = true;
          legendEl.appendChild(item);
        });
      }

      /* ---------- DOM sync (keyed, so updates animate) ---------- */
      function sync(c, M) {
        var o = c.options, t = c.theme, seen = {};
        var vertical = root.classList.contains('rk-tl--v');
        var showDetail = o.showDetail === 'auto' ? vertical && !M.noDetail : !!o.showDetail;
        M.evs.forEach(function (ev) {
          seen[ev.key] = 1;
          var it = items.get(ev.key);
          if (!it) {
            it = { label: h('div.rk-tl__label', { tabindex: '0' }), marker: h('div.rk-tl__marker'), leader: svgEl('path', { class: 'rk-tl__leader', pathLength: '1' }), isNew: true };
            [it.label, it.marker, it.leader].forEach(function (n) { n.addEventListener('animationend', function (e) { if (e.target === n || n === it.marker) n.classList.remove('is-enter'); }); });
            it.label.addEventListener('mouseenter', function () { show(it); });
            it.label.addEventListener('mouseleave', hide);
            it.label.addEventListener('focus', function () { show(it); });
            it.label.addEventListener('blur', hide);
            it.marker.addEventListener('mouseenter', function () { show(it); });
            it.marker.addEventListener('mouseleave', hide);
            var click = function () { if (it.ev.selValue != null && current.options.crossFilter !== false && M.selField) current.select(M.selField, it.ev.selValue); };
            it.label.addEventListener('click', click);
            it.marker.addEventListener('click', click);
            it.label.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } });
            labelLayer.appendChild(it.label); markerLayer.appendChild(it.marker); svg.appendChild(it.leader);
            items.set(ev.key, it);
          } else it.isNew = false;
          it.ev = ev;
          // content
          it.label.innerHTML = '';
          it.label.appendChild(h('div.rk-tl__date.rk-num', RK.format(new Date(ev.t), o.dateFormat || 'd mmm yy')));
          it.label.appendChild(h('div.rk-tl__text', ev.label));
          if (showDetail && ev.detail) it.label.appendChild(h('div.rk-tl__detail', ev.detail));
          it.label.setAttribute('aria-label', RK.format(new Date(ev.t), 'd mmmm yyyy') + ': ' + ev.label + (ev.kind ? ' (' + kindName(c, ev.kind) + ')' : ''));
          it.label.classList.toggle('is-dim', ev.dim);
          it.label.classList.toggle('is-hl', ev.hl);
          it.marker.classList.toggle('is-dim', ev.dim);
          it.marker.classList.toggle('is-hl', ev.hl);
          it.leader.classList.toggle('is-dim', ev.dim);
          it.marker.innerHTML = o.marker === 'number'
            ? '<span class="rk-tl__num" style="background:' + ev.color + ';color:' + RK.theme.onColor(ev.color, t.ink, '#fff') + '">' + ev.n + '</span>'
            : shapeSVG(ev.shape, o.marker === 'dot' ? 4.5 : (ev.hl ? 6.5 : 5.5), ev.color, t.paper);
          it.r = o.marker === 'number' ? 9 : (ev.hl ? 7.5 : 6.5);
        });
        items.forEach(function (it, key) {
          if (seen[key]) return;
          items.delete(key);
          [it.label, it.marker, it.leader].forEach(function (n) { n.classList.add('is-leaving'); });
          setTimeout(function () { it.label.remove(); it.marker.remove(); it.leader.remove(); }, current.motion ? 320 : 0);
        });
      }

      /* ---------- layouts ---------- */
      function pos(it, x, y, lx, ly) {
        it.mx = x; it.my = y;
        it.marker.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        it.label.style.transform = 'translate(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px)';
      }
      function leader(it, d) {
        it.leader.setAttribute('d', d);
        it.leader.style.d = 'path("' + d + '")';
      }

      function layoutHorizontal(c, M, W, availH) {
        var o = c.options, list = M.evs.map(function (ev) { return items.get(ev.key); });
        var flag = o.labelStyle !== 'center';
        var t0 = list.length ? M.evs[0].t : Date.now(), t1 = list.length ? M.evs[M.evs.length - 1].t : t0 + DAY;
        var todayTs = o.today === 'now' ? new Date().setHours(0, 0, 0, 0) : (o.today ? ts(o.today) : null);
        var lo, hi;
        if (Array.isArray(o.domain) && o.domain.length === 2) { lo = ts(o.domain[0]); hi = ts(o.domain[1]); }
        if (lo == null || hi == null) {
          if (todayTs != null) { t0 = Math.min(t0, todayTs); t1 = Math.max(t1, todayTs); }
          var pad = Math.max(10 * DAY, (t1 - t0) * 0.035);
          lo = t0 - pad; hi = t1 + pad;
        }
        var padX = 10, plotW = Math.max(60, W - padX * 2);
        var X = function (v) { return padX + (v - lo) / Math.max(DAY, hi - lo) * plotW; };

        function attempt(lw) {
          list.forEach(function (it) {
            it.label.style.maxWidth = lw + 'px';
            it.w = it.label.offsetWidth; it.h = it.label.offsetHeight;
            it.x = X(it.ev.t);
            var bw = it.w + (flag ? 6 : 0);
            if (flag) {
              it.flip = it.x + bw > W - 2;
              it.l = it.flip ? it.x - bw : it.x; it.rr = it.flip ? it.x : it.x + bw;
            } else {
              it.l = Math.max(0, Math.min(W - bw, it.x - bw / 2)); it.rr = it.l + bw;
            }
          });
          var placed = [], order = flag ? list.slice().reverse() : list.slice();
          var sides = o.side === 'above' ? ['above'] : o.side === 'below' ? ['below'] : null;
          var pref = 'above';
          function valid(it, side, k) {
            for (var i = 0; i < placed.length; i++) {
              var p = placed[i];
              if (p.side !== side) continue;
              if (p.lane === k) { if (!(it.l >= p.rr + GAP || it.rr <= p.l - GAP)) return false; }
              else if (p.lane > k) { if (p.x >= it.l - 4 && p.x <= it.rr + 4) return false; }
              else if (it.x >= p.l - 4 && it.x <= p.rr + 4) return false;
            }
            return true;
          }
          order.forEach(function (it) {
            var cands = sides || (pref === 'above' ? ['above', 'below'] : ['below', 'above']);
            it.side = null;
            for (var k = 0; k < 12 && !it.side; k++) {
              for (var s = 0; s < cands.length; s++) if (valid(it, cands[s], k)) { it.side = cands[s]; it.lane = k; break; }
            }
            if (!it.side) { it.side = cands[0]; it.lane = 11; }
            placed.push(it);
            pref = it.side === 'above' ? 'below' : 'above';
          });
          var A = 0, B = 0, hA = 0, hB = 0;
          list.forEach(function (it) {
            if (it.side === 'above') { A = Math.max(A, it.lane + 1); hA = Math.max(hA, it.h); }
            else { B = Math.max(B, it.lane + 1); hB = Math.max(hB, it.h); }
          });
          var pA = hA + LANE_GAP, pB = hB + LANE_GAP;
          var aboveH = A ? STEM + A * pA - LANE_GAP : 10, belowH = B ? STEM + B * pB - LANE_GAP : 10;
          return { A: A, B: B, pA: pA, pB: pB, aboveH: aboveH, belowH: belowH, need: aboveH + belowH + AXIS_ROW + 8 };
        }

        var lw = +o.labelWidth || 160, L = attempt(lw);
        for (var tries = 0; tries < 3 && L.need > availH && lw > 104; tries++) { lw = Math.max(100, Math.round(lw * 0.84)); L = attempt(lw); }
        var H = Math.max(availH, L.need);
        var extra = H - L.need;
        var axisY = 4 + L.aboveH + extra * (L.aboveH / Math.max(1, L.aboveH + L.belowH));
        var plotBottom = H - AXIS_ROW;

        list.forEach(function (it) {
          var ly, d, x = it.x, r = it.r;
          if (it.side === 'above') {
            var bottom = axisY - STEM - it.lane * L.pA;
            ly = bottom - it.h;
            d = 'M' + x + ' ' + (axisY - r - 1) + 'V' + (flag ? ly + 1 : bottom + 2);
          } else {
            ly = axisY + STEM + it.lane * L.pB;
            d = 'M' + x + ' ' + (axisY + r + 1) + 'V' + (flag ? ly + it.h - 1 : ly - 2);
          }
          var lx = flag ? (it.flip ? it.l : it.x + 6) : it.l;
          it.label.classList.toggle('is-flip', !!(flag && it.flip));
          it.label.classList.toggle('is-below', it.side === 'below');
          pos(it, x, axisY, lx, ly);
          leader(it, d);
        });

        // axis line, period grid + labels, today marker
        axisEl.style.cssText = 'left:' + padX + 'px;top:' + (axisY - 1) + 'px;width:' + plotW + 'px;height:2px;';
        gridLayer.innerHTML = '';
        var ps = periods(lo, hi, plotW / Math.max(DAY, hi - lo) * DAY);
        var todayX = todayTs != null ? X(todayTs) : null;
        gridLayer.appendChild(h('div.rk-tl__ruler', { style: { left: padX + 'px', top: plotBottom + 'px', width: plotW + 'px' } }));
        ps.forEach(function (p) {
          var x0 = X(p.s), x1 = X(p.e), cx0 = Math.max(padX, x0), cx1 = Math.min(padX + plotW, x1);
          if (cx1 - cx0 < 2) return;
          if (x0 > padX + 1) {
            // period boundary: small tick across the event axis + tick on the ruler below
            gridLayer.appendChild(h('div.rk-tl__tick', { style: { left: x0 + 'px', top: (axisY - 4.5) + 'px' } }));
            gridLayer.appendChild(h('div.rk-tl__rtick', { class: p.major ? 'is-major' : null, style: { left: x0 + 'px', top: plotBottom + 'px' } }));
          }
          var cx = (cx0 + cx1) / 2, tw = p.text.length * 6.2;
          if (tw + 8 > cx1 - cx0) return;
          if (todayX != null && Math.abs(todayX - cx) < tw / 2 + 34) return;
          gridLayer.appendChild(h('div.rk-tl__period', { style: { left: cx + 'px', top: (plotBottom + 3) + 'px' } }, p.text));
        });
        if (todayX != null && todayX >= padX && todayX <= padX + plotW) {
          gridLayer.appendChild(h('div.rk-tl__today', { style: { left: todayX + 'px', top: '0px', height: (plotBottom + 2) + 'px' } }));
          gridLayer.appendChild(h('div.rk-tl__todaylab', { style: { left: todayX + 'px', top: (plotBottom + 3) + 'px' } },
            (o.todayLabel ? o.todayLabel + ' ' : '') + RK.format(new Date(todayTs), 'd mmm')));
        }
        return H;
      }

      function layoutVertical(c, M, W, availH) {
        var o = c.options, list = M.evs.map(function (ev) { return items.get(ev.key); });
        var dateW = 0;
        list.forEach(function (it) { var d = it.label.querySelector('.rk-tl__date'); if (d) dateW = Math.max(dateW, d.scrollWidth); });
        dateW = Math.min(Math.max(dateW, 40), 110);
        var axisX = dateW + 18, contentX = axisX + 18, cw = Math.max(80, W - contentX - 4);
        root.style.setProperty('--rk-tl-date-w', dateW + 'px');
        root.style.setProperty('--rk-tl-date-gap', (contentX - dateW) + 'px');
        list.forEach(function (it) {
          it.label.style.maxWidth = cw + 'px';
          it.label.style.width = cw + 'px';
          it.h = it.label.offsetHeight;
        });
        gridLayer.innerHTML = '';
        var yearPills = [], H, firstY = null, lastY = null;
        var LINE = 9;   // marker centre: middle of the first text line

        if (o.spacing === 'time' && list.length > 1) {
          var top = 8, total = list.reduce(function (s, it) { return s + it.h + 8; }, 0);
          H = Math.max(availH, Math.min(total * 1.6, total + 120));
          var t0 = M.evs[0].t, t1 = M.evs[M.evs.length - 1].t, span = Math.max(DAY, t1 - t0);
          var Y = function (v) { return top + LINE + (v - t0) / span * (H - top - 16 - list[list.length - 1].h); };
          var prevBottom = -Infinity;
          list.forEach(function (it) { it.my = Y(it.ev.t); it.ly = Math.max(it.my - LINE, prevBottom + 8); prevBottom = it.ly + it.h; });
          var maxBottom = H - 4;
          for (var i = list.length - 1; i >= 0; i--) {
            var it = list[i];
            if (it.ly + it.h > maxBottom) it.ly = maxBottom - it.h;
            maxBottom = it.ly - 8;
          }
          list.forEach(function (it) {
            var ly = it.ly + LINE;
            // every row gets a leader so that displaced (elbowed) rows read as intentional
            var d = Math.abs(ly - it.my) < 1 ? 'M' + (axisX + it.r + 2) + ' ' + it.my + 'H' + (contentX - 5)
              : 'M' + (axisX + it.r + 2) + ' ' + it.my + 'H' + (axisX + 9) + 'L' + (contentX - 9) + ' ' + ly + 'H' + (contentX - 5);
            pos(it, axisX, it.my, contentX, it.ly);
            leader(it, d);
          });
          var y0 = new Date(t0).getFullYear() + 1, y1 = new Date(t1).getFullYear();
          for (var yr = y0; yr <= y1; yr++) yearPills.push({ y: Y(new Date(yr, 0, 1).getTime()), text: String(yr) });
          firstY = list[0].my; lastY = list[list.length - 1].my;
        } else {
          var y = 4, prevYear = null;
          var rowGap = 14, totalH = 0;
          list.forEach(function (it) { totalH += it.h + rowGap; });
          var years = RK.util.unique(M.evs.map(function (ev) { return new Date(ev.t).getFullYear(); }));
          totalH += (years.length - 1) * 28;
          var stretch = list.length > 1 ? Math.min(rowGap * 1.4, Math.max(0, (availH - totalH - 8) / list.length)) : 0;
          list.forEach(function (it) {
            var yr = new Date(it.ev.t).getFullYear();
            if (prevYear != null && yr !== prevYear) { yearPills.push({ y: y + 4, text: String(yr) }); y += 28; }
            prevYear = yr;
            pos(it, axisX, y + LINE, contentX, y);
            leader(it, 'M' + axisX + ' ' + (y + LINE) + 'H' + axisX);
            if (firstY == null) firstY = y + LINE;
            lastY = y + LINE;
            y += it.h + rowGap + stretch;
          });
          H = Math.max(availH, y);
        }
        axisEl.style.cssText = 'left:' + (axisX - 1) + 'px;top:' + ((firstY || 0) - 12) + 'px;width:2px;height:' + Math.max(0, (lastY || 0) - (firstY || 0) + 24) + 'px;';
        yearPills.forEach(function (p) { gridLayer.appendChild(h('div.rk-tl__year', { style: { left: axisX + 'px', top: p.y + 'px' } }, p.text)); });
        return H;
      }

      /* ---------- tooltip ---------- */
      function show(it) {
        clearTimeout(hideTimer);
        var c = current, ev = it.ev, enc = c.enc;
        var rows = [{ label: c.title(enc.date), value: RK.format(new Date(ev.t), c.fmtOf(enc.date) || 'dd mmm yyyy') }];
        if (ev.kind) rows.push({ color: ev.color, label: c.title(enc.kind), value: kindName(c, ev.kind) });
        tip.innerHTML = RK.chart.tip(ev.label, rows, ev.detail);
        tip.classList.add('is-on');
        // place the tip on the side opposite to the label so it never hides what is being read
        var sw = stage.clientWidth, sh = stage.clientHeight, tw = tip.offsetWidth, th = tip.offsetHeight, x, y;
        if (root.classList.contains('rk-tl--v')) {
          x = Math.max(4, Math.min(sw - tw - 4, it.mx + 24));
          y = it.my + it.label.offsetHeight + 4;
          if (y + th > sh) y = it.my - th - 14;
        } else {
          x = Math.max(4, Math.min(sw - tw - 4, it.mx - tw / 2));
          var below = !it.label.classList.contains('is-below');
          y = below ? it.my + 16 : it.my - th - 16;
          if (below && y + th > sh) y = it.my - th - 16;
          if (!below && y < 0) y = it.my + 16;
        }
        y = Math.max(0, y);
        tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        it.label.classList.add('is-hover'); it.marker.classList.add('is-hover'); it.leader.classList.add('is-hover');
        it.leader.style.stroke = ev.color;
      }
      function hide() {
        hideTimer = setTimeout(function () { tip.classList.remove('is-on'); }, 60);
        items.forEach(function (it) { it.label.classList.remove('is-hover'); it.marker.classList.remove('is-hover'); it.leader.classList.remove('is-hover'); it.leader.style.stroke = ''; });
      }

      /* ---------- draw ---------- */
      function draw(c, animate) {
        current = c;
        var o = c.options, M = model(c);
        var entering = c.motion && animate;
        el.style.height = origHeight;
        if (first || !entering) root.classList.add('is-static');      // place everything without transitions
        root.classList.toggle('rk-tl--num', o.marker === 'number');
        drawLegend(c, M);
        var W = el.clientWidth || 600;
        var vertical = o.orientation === 'vertical' || (o.orientation !== 'horizontal' && W < 560);
        root.classList.toggle('rk-tl--v', vertical);
        root.classList.toggle('rk-tl--h', !vertical);
        root.classList.toggle('rk-tl--center', !vertical && o.labelStyle === 'center');
        sync(c, M);
        var availH = Math.max(80, el.clientHeight - legendEl.offsetHeight - (legendEl.offsetHeight ? 8 : 0));
        var H = vertical ? layoutVertical(c, M, W, availH) : layoutHorizontal(c, M, W, availH);
        if (vertical && o.showDetail === 'auto' && H > availH + 1 && M.evs.some(function (ev) { return ev.detail; })) {
          M.noDetail = true;              // details do not fit: keep them in the tooltip only
          sync(c, M);
          H = layoutVertical(c, M, W, availH);
        }
        stage.style.height = H + 'px';
        svg.setAttribute('width', W); svg.setAttribute('height', H);
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        if (H > availH + 1) el.style.height = (H + legendEl.offsetHeight + (legendEl.offsetHeight ? 8 : 0)) + 'px';   // grow rather than overlap

        // entry: new items are placed without transition, then animate in (staggered by date on first draw)
        root.style.setProperty('--rk-stagger', first ? '1' : '0.35');
        M.evs.forEach(function (ev, i) {
          var it = items.get(ev.key), nodes = [it.label, it.marker, it.leader];
          nodes.forEach(function (n) { n.style.setProperty('--rk-i', i); });
          if (!it.isNew) return;
          nodes.forEach(function (n) { n.classList.add('no-tr'); });
          if (entering) nodes.forEach(function (n) { n.classList.remove('is-enter'); n.getBoundingClientRect(); n.classList.add('is-enter'); });
        });
        if (first && entering) { axisEl.classList.add('is-enter'); gridLayer.classList.add('is-enter'); }
        requestAnimationFrame(function () {
          if (current.motion) root.classList.remove('is-static');
          items.forEach(function (it) { [it.label, it.marker, it.leader].forEach(function (n) { n.classList.remove('no-tr'); }); });
        });
        first = false;
      }

      draw(ctx, true);

      return {
        update: function (c) { draw(c, true); },
        resize: function () { draw(current, false); },
        destroy: function () {
          clearTimeout(hideTimer);
          root.remove();
          el.style.height = origHeight;
          items.clear();
        }
      };
    }
  });
})();
