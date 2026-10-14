/*!
 * RK component: waffle — 10 × 10 unit grid for part-to-whole (1 cell = 1%). One stacked waffle with a
 * legend table, several stacked waffles faceted by a field, or small multiples with one waffle per
 * category (its share filled, the rest grey). Pure SVG (crisp in print, exportable), cells fill in
 * sequence when the block is revealed; hover focuses a category, click cross-filters.
 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var h = RK.util.h;

  function svgEl(tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  /** Generic label fields ('type', 'category' …) cross-filter only this block's dataset; business dimensions stay global. */
  var GENERIC = /^(type|kind|source|target|step|stage|metric|measure|category|group|series|label|name|id|parent|key|value|x|y)$/i;

  /** Largest-remainder rounding: integer cell counts that add up exactly to `cells`. */
  function allocate(values, cells) {
    var sum = values.reduce(function (s, v) { return s + v; }, 0);
    if (!sum) return values.map(function () { return 0; });
    var raw = values.map(function (v) { return v / sum * cells; });
    var out = raw.map(Math.floor);
    var left = cells - out.reduce(function (s, v) { return s + v; }, 0);
    raw.map(function (r, i) { return { i: i, f: r - Math.floor(r) }; })
      .sort(function (a, b) { return b.f - a.f; })
      .slice(0, left).forEach(function (x) { out[x.i]++; });
    return out;
  }

  /** Categories (sorted, tail grouped), optional facets, cell counts per waffle. */
  function model(ctx) {
    var o = ctx.options, enc = ctx.enc, t = ctx.theme;
    var aggFn = RK.expr.agg[o.agg] || RK.expr.agg.sum;
    var N = Math.max(2, Math.min(20, o.grid | 0 || 10)), cells = N * N;
    function num(v) { return v == null || v === '' || !isFinite(v) ? null : +v; }
    function sums(rows) {
      var m = new Map();
      RK.util.groupBy(rows, function (r) { return r[enc.label]; }).forEach(function (g, k) {
        if (k == null || k === '') return;
        var v = aggFn(g.map(function (r) { return num(r[enc.value]); }));
        if (v != null && v > 0) m.set(String(k), v);
      });
      return m;
    }
    // category order + colours from the unfiltered data (stable while filtering)
    var allSums = sums(ctx.allRows);
    var ranked = Array.from(allSums.keys()).sort(function (a, b) { return allSums.get(b) - allSums.get(a); });
    if (o.sort === 'asc') ranked.reverse();
    else if (!o.sort) ranked = Array.from(allSums.keys());
    var bySize = Array.from(allSums.keys()).sort(function (a, b) { return allSums.get(b) - allSums.get(a); });
    var max = o.maxCategories;
    var keep = max && bySize.length > max ? new Set(bySize.slice(0, max - 1)) : new Set(bySize);
    var cats = ranked.filter(function (c) { return keep.has(c); });
    var members = ranked.filter(function (c) { return !keep.has(c); });
    if (members.length) cats.push(o.othersLabel);
    function bucket(c) { return keep.has(c) ? c : o.othersLabel; }

    var hl = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    // nominal categories: categorical colours; with a highlight none may read like the accent2 target
    var pal = RK.theme.palette(hl.length ? { n: cats.length } : { exclude: [], n: cats.length });
    var color = {}, k = 0;
    cats.forEach(function (c) {
      color[c] = c === o.othersLabel && members.length ? t.neutral : hl.indexOf(c) >= 0 ? t.accent2 : pal[k++ % pal.length];
    });

    // waffles: one (stacked), one per facet value (stacked), or one per category (facet mode)
    function frame(rows, title) {
      var s = sums(rows), vals = new Map();
      s.forEach(function (v, c) { var b = bucket(c); vals.set(b, (vals.get(b) || 0) + v); });
      var total = 0; vals.forEach(function (v) { total += v; });
      return { title: title, vals: vals, total: total };
    }
    var frames = [];
    if (enc.facet) {
      var fvals = RK.util.unique(ctx.rows.map(function (r) { return r[enc.facet]; })).filter(function (v) { return v != null && v !== ''; });
      fvals.forEach(function (fv) { frames.push(frame(ctx.rows.filter(function (r) { return r[enc.facet] === fv; }), String(fv))); });
    } else frames.push(frame(ctx.rows, null));

    // auto: values already expressed as fractions of a whole (a % field summing to <= 100%) are drawn
    // as-is, so a filtered subset leaves squares empty instead of being re-normalised to 100
    var fmt0 = o.format || ctx.fmtOf(enc.value) || 'auto';
    var pct0 = /%/.test(RK.format.presets[fmt0] || fmt0);
    var maxTotal = Math.max.apply(null, frames.map(function (f) { return f.total; }).concat([0]));
    var abs = o.scale === 'absolute' || (o.scale === 'auto' && pct0 && maxTotal <= 1.0001);
    var waffles = [];
    if (o.mode === 'facet') {
      var f0 = frames[0];
      cats.forEach(function (c) {
        var v = f0.vals.get(c) || 0, share = abs ? v : (f0.total ? v / f0.total : 0);
        var n = Math.max(0, Math.min(cells, Math.round(share * cells)));
        waffles.push({ title: c, cat: c, share: share, value: v, total: f0.total, counts: [{ cat: c, n: n, value: v, share: share }] });
      });
    } else {
      frames.forEach(function (f) {
        var present = cats.filter(function (c) { return f.vals.get(c); });
        var values = present.map(function (c) { return f.vals.get(c); });
        var filled = abs ? Math.min(cells, Math.round(values.reduce(function (s, v) { return s + v; }, 0) * cells)) : cells;
        var counts = allocate(values, filled).map(function (n, i) {
          var v = values[i];
          return { cat: present[i], n: n, value: v, share: abs ? v : (f.total ? v / f.total : 0) };
        });
        waffles.push({ title: f.title, counts: counts, total: f.total });
      });
    }
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var pctLike = /%/.test(RK.format.presets[fmt] || fmt);
    // short units (m, bn, k) read naturally after a number: "79.5m"
    var fd = ctx.field(enc.value), unit = fd && fd.unit && /^(k|m|mm|bn|tn)$/i.test(fd.unit) ? fd.unit : '';
    return { N: N, cells: cells, cats: cats, members: members, color: color, hl: hl, waffles: waffles, fmt: fmt, pctLike: pctLike, abs: abs, unit: unit };
  }

  RK.component({
    id: 'waffle',
    deps: [],
    defaults: {
      encode: { label: 'label', value: 'value', facet: null },
      mode: 'stacked',         // stacked (one waffle, or one per encode.facet value) | facet (one waffle per category)
      grid: 10,                // cells per side (10 → 1 cell = 1%)
      scale: 'auto',           // auto | share (normalise to the total) | absolute (values are fractions 0–1 of a whole)
      maxCategories: 6,        // categories beyond this are grouped into othersLabel
      othersLabel: 'Others',
      sort: 'desc',            // desc | asc | null (data order)
      agg: 'sum',              // how rows sharing a label are combined
      fillOrder: 'row',        // row (left→right, top→bottom) | column (bottom→top, left→right)
      shape: 'square',         // square | circle
      highlight: null,         // category drawn in the accent colour
      legend: true,            // legend table (single waffle) or inline legend (several)
      format: null,            // value format; defaults to the value field format
      pctFormat: '0.0%',
      maxSize: 280             // max waffle side (px)
    },
    render: function (ctx) {
      var wrap = h('div.rk-waffle');
      var tip = h('div.rk-waffle__tip', { role: 'tooltip' });
      ctx.el.appendChild(wrap);
      ctx.el.appendChild(tip);
      var state = { ctx: ctx, m: null, svg: null, key: null, w: 0, h: 0, first: true, cells: [] };

      function draw(c, animate) {
        state.ctx = c;
        var m = state.m = model(c);
        var W = Math.max(120, ctx.el.clientWidth), H = Math.max(80, ctx.el.clientHeight);
        state.w = W; state.h = H;
        var L = layout(c, m, W, H);
        var key = [W, H, m.waffles.length, m.N, c.options.mode, c.options.shape, c.options.fillOrder, c.theme.name].join('|');
        if (state.svg && key === state.key && !animate) { recolor(c, m, L); return; }
        state.key = key;
        wrap.innerHTML = '';
        state.svg = paint(c, m, L, wrap, animate && c.motion, state);
      }

      function recolor(c, m, L) {
        // same geometry: update fills / texts in place so CSS transitions animate the change
        var t = c.theme, empty = emptyColor(t);
        m.waffles.forEach(function (wf, wi) {
          var seq = sequence(wf, m);
          var rects = state.cells[wi] || [];
          rects.forEach(function (el, i) {
            var cat = seq[i];
            el.setAttribute('fill', cat ? fillFor(c, m, cat) : empty);
            el.setAttribute('data-cat', cat || '');
          });
        });
        state.svg.querySelectorAll('[data-rk-val]').forEach(function (el) {
          var wf = m.waffles[+el.getAttribute('data-rk-val')];
          if (wf) RK.motion.countUp(el, wf.share, { format: c.options.pctFormat, animate: c.motion, from: +el.getAttribute('data-v') || 0, duration: 600 });
          if (wf) el.setAttribute('data-v', wf.share);
        });
        legendText(c, m, L, state.svg);
      }

      draw(ctx, true);

      // hover focus + tooltip, click → cross-filter (event delegation on the svg root)
      function catAt(e) { var tEl = e.target.closest && e.target.closest('[data-cat]'); return tEl ? tEl.getAttribute('data-cat') : null; }
      function onMove(e) {
        var cat = catAt(e);
        var svg = state.svg;
        if (!svg) return;
        svg.querySelectorAll('.is-hot').forEach(function (el) { el.classList.remove('is-hot'); });
        if (!cat) { svg.classList.remove('is-focus'); tip.classList.remove('is-on'); return; }
        svg.classList.add('is-focus');
        svg.querySelectorAll('[data-cat="' + cssEsc(cat) + '"]').forEach(function (el) { el.classList.add('is-hot'); });
        var wi = e.target.closest('[data-wf]') ? +e.target.closest('[data-wf]').getAttribute('data-wf') : 0;
        tip.innerHTML = tipHTML(state.ctx, state.m, cat, wi);
        var r = ctx.el.getBoundingClientRect();
        var x = e.clientX - r.left + 14, y = e.clientY - r.top + 12;
        tip.classList.add('is-on');
        var tw = tip.offsetWidth, th = tip.offsetHeight;
        if (x + tw > r.width) x = e.clientX - r.left - tw - 12;
        if (y + th > r.height) y = Math.max(0, r.height - th);
        tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }
      function onLeave() {
        if (state.svg) { state.svg.classList.remove('is-focus'); state.svg.querySelectorAll('.is-hot').forEach(function (el) { el.classList.remove('is-hot'); }); }
        tip.classList.remove('is-on');
      }
      function onClick(e) {
        var cat = catAt(e), c = state.ctx;
        if (!cat || c.options.crossFilter === false) return;
        var f = c.enc.label, sc = GENERIC.test(f) ? { scope: c.options.crossFilterScope || 'dataset' } : null;
        if (cat !== c.options.othersLabel || !state.m.members.length) { c.select(f, cat, sc); return; }
        // "Others": all members selected -> drop them, else add the missing ones (one store write)
        var sel = c.selected(f), mem = state.m.members;
        var all = mem.every(function (x) { return sel.indexOf(x) >= 0; });
        c.setSelection(f, all ? sel.filter(function (x) { return mem.indexOf(x) < 0; }) : sel.concat(mem.filter(function (x) { return sel.indexOf(x) < 0; })), sc);
      }
      wrap.addEventListener('mousemove', onMove);
      wrap.addEventListener('mouseleave', onLeave);
      wrap.addEventListener('click', onClick);

      return {
        update: function (c) { draw(c, false); },
        resize: function () {
          var W = ctx.el.clientWidth, H = ctx.el.clientHeight;
          if (Math.abs(W - state.w) > 1 || Math.abs(H - state.h) > 1) { state.key = null; draw(state.ctx, false); }
        },
        destroy: function () {
          wrap.removeEventListener('mousemove', onMove);
          wrap.removeEventListener('mouseleave', onLeave);
          wrap.removeEventListener('click', onClick);
          wrap.remove(); tip.remove();
        },
        exportSVG: function () { return state.svg ? serialize(state.svg, state.ctx.theme) : null; },
        exportImage: function () { return state.svg ? toPNG(state.svg, state.ctx.theme) : Promise.resolve(null); }
      };
    }
  });

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function emptyColor(t) { return RK.theme.mix(t.rule, t.paper, 0.5); }

  function fillFor(ctx, m, cat) {
    var base = m.color[cat] || ctx.theme.neutral;
    var sel = ctx.selected(ctx.enc.label);
    if (!sel.length) return base;
    var on = cat === ctx.options.othersLabel && m.members.length
      ? m.members.some(function (x) { return sel.indexOf(x) >= 0; })
      : sel.indexOf(cat) >= 0;
    return on ? base : RK.theme.mix(base, ctx.theme.paper, 0.75);
  }

  /** Category of each cell index in fill order (null = empty). */
  function sequence(wf, m) {
    var seq = [];
    wf.counts.forEach(function (c) { for (var i = 0; i < c.n; i++) seq.push(c.cat); });
    while (seq.length < m.cells) seq.push(null);
    return seq;
  }

  /** Waffle sizes and positions; single stacked waffle gets a side legend table. */
  function layout(ctx, m, W, H) {
    var o = ctx.options, t = ctx.theme;
    var n = m.waffles.length;
    var facet = o.mode === 'facet';
    var L = { W: W, H: H, items: [] };
    var fontName = '11.5px ' + t.fontSans;
    var tableFits = W - (18 + 60 + (m.pctLike ? 0 : 64) + 56) - 40 >= 110;
    if (n === 1 && !facet && o.legend !== false && tableFits) {
      // [waffle] [legend table]
      var nameW = Math.min(200, Math.max.apply(null, m.cats.map(function (c) { return RK.chart.measure(c, fontName); }).concat([40])) + 8);
      var valW = m.pctLike ? 0 : 64;
      // a % field has no separate value column: its title heads the % column, so give it room
      var pctW = m.pctLike ? Math.min(170, Math.max(56, RK.chart.measure(ctx.title(ctx.enc.value), '600 10px ' + t.fontSans) + 4)) : 56;
      var tableW = 18 + nameW + valW + pctW;
      var S = Math.max(60, Math.min(H - 8, W - tableW - 40, o.maxSize));
      var gap = Math.min(48, Math.max(24, W * 0.04));
      var x0 = Math.max(0, (W - (S + gap + tableW)) / 2);
      L.items.push({ x: x0, y: (H - S) / 2, S: S });
      var rows = m.cats.length, rowH = Math.max(18, Math.min(24, (H - 52) / Math.max(1, rows)));
      L.table = { x: x0 + S + gap, w: tableW, nameW: nameW, valW: valW, pctW: pctW, rowH: rowH };
      L.table.y = Math.max(0, (H - (22 + rows * rowH + 26)) / 2);
      return L;
    }
    // inline legend: simulate the wrap to reserve its height
    var legendH = 0;
    if (!facet && o.legend !== false) {
      var lx = 0, lines = 1;
      m.cats.forEach(function (c) { var w = RK.chart.measure(c, '11px ' + t.fontSans); if (lx + w + 30 > W && lx > 0) { lx = 0; lines++; } lx += w + 34; });
      legendH = 8 + lines * 18;
    }
    var headH = (facet || m.waffles[0].title) ? 20 : 0, footH = facet ? 30 : 0;
    var gx = 28, gy = 18, best = null;
    for (var cols = 1; cols <= n; cols++) {
      var rws = Math.ceil(n / cols);
      var s = Math.min((W - (cols - 1) * gx) / cols, (H - legendH - rws * (headH + footH) - (rws - 1) * gy) / rws, o.maxSize);
      if (!best || s > best.s + 0.5) best = { s: s, cols: cols, rows: rws };
    }
    var S2 = Math.max(30, Math.floor(best.s));
    var gridW = best.cols * S2 + (best.cols - 1) * gx;
    // spread waffles across the width when there is spare room (calmer than a tight cluster)
    var gxx = best.cols > 1 ? Math.min(gx * 3, (W - best.cols * S2) / (best.cols - 1)) : 0;
    gridW = best.cols * S2 + (best.cols - 1) * gxx;
    var left = Math.max(0, (W - gridW) / 2);
    var blockH = best.rows * (headH + S2 + footH) + (best.rows - 1) * gy;
    var top = legendH + Math.max(0, (H - legendH - blockH) / 2);
    m.waffles.forEach(function (wf, i) {
      var col = i % best.cols, row = Math.floor(i / best.cols);
      L.items.push({ x: left + col * (S2 + gxx), y: top + row * (headH + S2 + footH + gy) + headH, S: S2, headH: headH, footH: footH });
    });
    L.legendH = legendH;
    return L;
  }

  function paint(ctx, m, L, wrap, animate, state) {
    var o = ctx.options, t = ctx.theme, N = m.N;
    var svg = svgEl('svg', { width: L.W, height: L.H, viewBox: '0 0 ' + L.W + ' ' + L.H, class: 'rk-waffle__svg' + (animate ? ' is-animated' : ''), role: 'img', 'aria-label': 'Waffle chart' });
    wrap.appendChild(svg);
    var empty = emptyColor(t);
    var font = function (size, weight, num) {
      return { 'font-family': num ? t.fontNum : t.fontSans, 'font-size': size, 'font-weight': weight || 400, style: num ? 'font-variant-numeric:tabular-nums' : null };
    };
    state.cells = [];

    m.waffles.forEach(function (wf, wi) {
      var it = L.items[wi];
      var g = svgEl('g', { 'data-wf': wi, transform: 'translate(' + it.x.toFixed(1) + ',' + it.y.toFixed(1) + ')' }, svg);
      var pitch = it.S / N, gap = Math.max(1, Math.min(3, pitch * 0.14)), cs = pitch - gap;
      var seq = sequence(wf, m), rects = [];
      for (var i = 0; i < m.cells; i++) {
        var r, c;
        if (o.fillOrder === 'column') { c = Math.floor(i / N); r = N - 1 - (i % N); } else { r = Math.floor(i / N); c = i % N; }
        var cat = seq[i];
        var attrs = { x: (c * pitch + gap / 2).toFixed(2), y: (r * pitch + gap / 2).toFixed(2), width: cs.toFixed(2), height: cs.toFixed(2),
          fill: cat ? fillFor(ctx, m, cat) : empty, 'data-cat': cat || '', class: 'rk-waffle__cell', style: '--i:' + i + ';--w:' + wi };
        if (o.shape === 'circle') attrs.rx = attrs.ry = (cs / 2).toFixed(2);
        else attrs.rx = attrs.ry = Math.min(2, cs * 0.12).toFixed(2);
        rects.push(svgEl('rect', attrs, g));
      }
      state.cells.push(rects);
      // titles (facets) and the big share figure under each small multiple
      if (wf.title && it.headH) {
        var tt = svgEl('text', RK.util.merge({ x: 0, y: -7, fill: t.ink }, font(11.5, 600)), g);
        tt.textContent = truncate(wf.title, it.S, '600 11.5px ' + t.fontSans);
      }
      if (o.mode === 'facet') {
        var vv = svgEl('text', RK.util.merge({ x: 0, y: it.S + 22, fill: wf.cat && m.hl.indexOf(wf.cat) >= 0 ? t.accent2 : t.ink, 'data-rk-val': wi, 'data-v': wf.share }, font(18, 600, true)), g);
        vv.classList.add('rk-num');
        RK.motion.countUp(vv, wf.share, { format: o.pctFormat, animate: animate });
        if (!m.pctLike) {
          var sub = svgEl('text', RK.util.merge({ x: it.S, y: it.S + 22, fill: t.ink3, 'text-anchor': 'end' }, font(10.5, 400, true)), g);
          sub.textContent = RK.format(wf.value, m.fmt) + m.unit;
        }
      }
    });

    // legend: table beside a single waffle, inline row above several
    if (o.legend !== false && o.mode !== 'facet') {
      if (L.table) legendTable(ctx, m, L, svg, font);
      else legendInline(ctx, m, L, svg, font);
    }
    return svg;
  }

  function truncate(s, w, f) {
    var ef = window.echarts && window.echarts.format;
    if (ef && ef.truncateText) return ef.truncateText(String(s), w, f, '…');
    s = String(s);
    while (s.length > 3 && RK.chart.measure(s, f) > w) s = s.slice(0, -2) + '…';
    return s;
  }

  function legendTable(ctx, m, L, svg, font) {
    var t = ctx.theme, T = L.table, wf = m.waffles[0];
    var g = svgEl('g', { class: 'rk-waffle__legend', transform: 'translate(' + T.x.toFixed(1) + ',' + T.y.toFixed(1) + ')' }, svg);
    var xVal = 16 + T.nameW + T.valW, xPct = T.w;
    function text(x, y, s, attrs) { var el = svgEl('text', RK.util.merge({ x: x, y: y }, attrs), g); el.textContent = s; return el; }
    text(0, 10, ctx.title(ctx.enc.label), RK.util.merge({ fill: t.ink3 }, font(10, 600)));
    if (T.valW) text(xVal, 10, truncate(ctx.title(ctx.enc.value), T.valW + T.nameW / 2, '600 10px ' + t.fontSans), RK.util.merge({ fill: t.ink3, 'text-anchor': 'end' }, font(10, 600)));
    text(xPct, 10, m.pctLike ? truncate(ctx.title(ctx.enc.value), T.pctW, '600 10px ' + t.fontSans) : '% of total', RK.util.merge({ fill: t.ink3, 'text-anchor': 'end' }, font(10, 600)));
    svgEl('line', { x1: 0, x2: T.w, y1: 17.5, y2: 17.5, stroke: t.ink3, 'stroke-width': 1 }, g);
    var y = 22;
    m.cats.forEach(function (cat, i) {
      var c = wf.counts.filter(function (x) { return x.cat === cat; })[0] || { value: 0, share: 0 };
      var cy = y + T.rowH * (i + 0.5);
      var row = svgEl('g', { 'data-cat': cat, class: 'rk-waffle__row' }, g);
      svgEl('rect', { x: -4, y: (cy - T.rowH / 2).toFixed(1), width: T.w + 8, height: T.rowH, fill: 'transparent' }, row);
      svgEl('rect', { x: 0, y: (cy - 5).toFixed(1), width: 10, height: 10, rx: ctx.options.shape === 'circle' ? 5 : 2, fill: fillFor(ctx, m, cat), class: 'rk-waffle__sw', 'data-sw': cat }, row);
      var strong = m.hl.indexOf(cat) >= 0;
      var nm = svgEl('text', RK.util.merge({ x: 16, y: cy, 'dominant-baseline': 'central', fill: strong ? t.ink : t.ink2 }, font(11.5, strong ? 600 : 400)), row);
      nm.textContent = truncate(cat, T.nameW - 4, (strong ? '600 ' : '') + '11.5px ' + t.fontSans);
      if (T.valW) {
        var vEl = svgEl('text', RK.util.merge({ x: xVal, y: cy, 'dominant-baseline': 'central', 'text-anchor': 'end', fill: t.ink, 'data-lv': cat }, font(11.5, strong ? 600 : 400, true)), row);
        vEl.textContent = c.value ? RK.format(c.value, m.fmt) : '–';
      }
      var pEl = svgEl('text', RK.util.merge({ x: xPct, y: cy, 'dominant-baseline': 'central', 'text-anchor': 'end', fill: m.pctLike ? t.ink : t.ink3, 'data-lp': cat }, font(11.5, strong ? 600 : 400, true)), row);
      pEl.textContent = c.value ? RK.format(m.pctLike ? c.value : c.share, ctx.options.pctFormat) : '–';
    });
    var fy = y + T.rowH * m.cats.length + 4;
    svgEl('line', { x1: 0, x2: T.w, y1: fy + 0.5, y2: fy + 0.5, stroke: t.rule, 'stroke-width': 1 }, g);
    var tot = svgEl('text', RK.util.merge({ x: 16, y: fy + 13, 'dominant-baseline': 'central', fill: t.ink }, font(11.5, 600)), g);
    tot.textContent = 'Total';
    if (T.valW) {
      var tv = svgEl('text', RK.util.merge({ x: xVal, y: fy + 13, 'dominant-baseline': 'central', 'text-anchor': 'end', fill: t.ink, 'data-lt': 1 }, font(11.5, 600, true)), g);
      tv.textContent = RK.format(wf.total, m.fmt);
    }
    var tp = svgEl('text', RK.util.merge({ x: xPct, y: fy + 13, 'dominant-baseline': 'central', 'text-anchor': 'end', fill: t.ink, 'data-ltp': 1 }, font(11.5, 600, true)), g);
    tp.textContent = RK.format(m.pctLike || m.abs ? wf.total : 1, ctx.options.pctFormat);
    var note = svgEl('text', RK.util.merge({ x: 0, y: fy + 34, fill: t.ink3 }, font(10, 400)), g);
    note.textContent = '1 square = ' + RK.format(1 / m.cells, m.cells === 100 ? '0%' : '0.0%');
  }

  /** Update legend numbers in place (filters changed, same geometry). */
  function legendText(ctx, m, L, svg) {
    var wf = m.waffles[0];
    if (!wf) return;
    m.cats.forEach(function (cat) {
      var c = wf.counts.filter(function (x) { return x.cat === cat; })[0] || { value: 0, share: 0 };
      var v = svg.querySelector('[data-lv="' + cssEsc(cat) + '"]'), p = svg.querySelector('[data-lp="' + cssEsc(cat) + '"]'), sw = svg.querySelector('[data-sw="' + cssEsc(cat) + '"]');
      if (v) v.textContent = c.value ? RK.format(c.value, m.fmt) : '–';     // nil in the current filter
      if (p) p.textContent = c.value ? RK.format(m.pctLike ? c.value : c.share, ctx.options.pctFormat) : '–';
      if (sw) sw.setAttribute('fill', fillFor(ctx, m, cat));
    });
    var lt = svg.querySelector('[data-lt]'), ltp = svg.querySelector('[data-ltp]');
    if (lt) lt.textContent = RK.format(wf.total, m.fmt);
    if (ltp) ltp.textContent = RK.format(m.pctLike || m.abs ? wf.total : 1, ctx.options.pctFormat);
  }

  function legendInline(ctx, m, L, svg, font) {
    var t = ctx.theme, x = 0, y = 9;
    var g = svgEl('g', { class: 'rk-waffle__legend' }, svg);
    m.cats.forEach(function (cat) {
      var w = RK.chart.measure(cat, '11px ' + t.fontSans);
      if (x + w + 30 > L.W && x > 0) { x = 0; y += 18; }
      var row = svgEl('g', { 'data-cat': cat, class: 'rk-waffle__row' }, g);
      svgEl('rect', { x: x - 2, y: y - 8, width: w + 22, height: 16, fill: 'transparent' }, row);
      svgEl('rect', { x: x, y: y - 5, width: 10, height: 10, rx: ctx.options.shape === 'circle' ? 5 : 2, fill: fillFor(ctx, m, cat), class: 'rk-waffle__sw', 'data-sw': cat }, row);
      var tx = svgEl('text', RK.util.merge({ x: x + 15, y: y, 'dominant-baseline': 'central', fill: t.ink2 }, font(11, m.hl.indexOf(cat) >= 0 ? 600 : 400)), row);
      tx.textContent = cat;
      x += w + 34;
    });
  }

  function tipHTML(ctx, m, cat, wi) {
    var wf = m.waffles[wi] || m.waffles[0];
    var c = wf.counts.filter(function (x) { return x.cat === cat; })[0];
    if (!c) return '';
    var rows = [
      { color: m.color[cat], label: ctx.title(ctx.enc.value), value: RK.format(c.value, m.fmt) },
      m.pctLike && m.abs ? null : { label: m.abs ? 'Share' : '% of total', value: RK.format(c.share, ctx.options.pctFormat) },
      { label: 'Squares', value: c.n + ' of ' + m.cells }
    ];
    var foot = null;
    if (cat === ctx.options.othersLabel && m.members.length) foot = m.members.length + ' items: ' + m.members.slice(0, 5).join(', ') + (m.members.length > 5 ? ', …' : '');
    return RK.chart.tip((wf.title && wf.title !== cat ? wf.title + ' · ' : '') + cat, rows, foot);
  }

  /* ---------------- export ---------------- */
  function serialize(svg, t) {
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', NS);
    clone.classList.remove('is-animated', 'is-focus');
    var bg = svgEl('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: t.paper });
    clone.insertBefore(bg, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }
  function toPNG(svg, t) {
    var str = serialize(svg, t), w = +svg.getAttribute('width'), ht = +svg.getAttribute('height');
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = w * 2; c.height = ht * 2;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
    });
  }
})();
