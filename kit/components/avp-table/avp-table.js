/*!
 * RK component: avp-table — "Analysis at Various Prices" (AVP), the cornerstone M&A pitchbook table.
 * Columns = offer price levels (options.prices list or {from, to, step} range, or the bound dataset's price
 * field with column labels such as "Initial proposal"); rows = premium / (discount) to reference prices
 * (current, 30-day VWAP, 52-week high, unaffected), implied equity value (price × diluted shares), net debt,
 * implied EV, and implied multiples from options.metrics (EV / EBITDA, P/E ...). Every figure is computed
 * here, so options bound to '@params' (offer: '@offer') recompute and tween when a slider moves.
 * The current-price column and the proposed offer column are highlighted; an offer stepper and
 * click-a-price-header move the offer (setting the bound @param). Pure DOM on the shared .rk-table styles.
 */
(function () {
  'use strict';
  var util = RK.util, h = util.h, isNum = util.isNum;
  var EPS = 1e-6;

  /* ---------------- @param binding ---------------- */
  function paramName(v) { return typeof v === 'string' && /^@[A-Za-z_]\w*$/.test(v) ? v.slice(1) : null; }

  /** '@name' option values -> current param value (store, then report manifest params, then options.paramDefaults). */
  function resolver(o) {
    var man = (RK.data.manifest && RK.data.manifest.params) || {};
    return function (v) {
      var p = paramName(v);
      if (!p) return v;
      var x = RK.store.param(p);
      if (x === undefined && Object.prototype.hasOwnProperty.call(man, p)) x = util.isObj(man[p]) ? man[p].value : man[p];
      if (x === undefined && o.paramDefaults && Object.prototype.hasOwnProperty.call(o.paramDefaults, p)) x = o.paramDefaults[p];
      return x === undefined ? null : x;
    };
  }

  /** Every '@param' referenced in the options (encode excluded). */
  function paramRefs(o) {
    var out = [];
    (function walk(v, key) {
      if (key === 'encode') return;
      var p = paramName(v);
      if (p) { if (out.indexOf(p) < 0) out.push(p); return; }
      if (Array.isArray(v)) v.forEach(function (x) { walk(x); });
      else if (util.isObj(v)) Object.keys(v).forEach(function (k) { walk(v[k], k); });
    })(o);
    return out;
  }

  function near(a, b) { return isNum(a) && isNum(b) && Math.abs(a - b) < EPS; }
  function decimals(x) { var s = String(+(+x).toFixed(10)); return s.indexOf('.') < 0 ? 0 : s.length - s.indexOf('.') - 1; }

  /* ---------------- model ---------------- */
  /**
   * Columns (ascending price) and rows for one render.
   *   column: {key, price, tag, isCurrent, isOffer, kind}
   *   row:    {type: 'section' | 'premium' | 'value' | 'multiple', key, label, basis, fn(price) -> value, fmt, ...}
   */
  function model(ctx, override) {
    var o = ctx.options, enc = ctx.enc, val = resolver(o);
    var cols = [];
    var p = o.prices;
    if (Array.isArray(p) && p.length) {
      p.forEach(function (x) { x = val(x); if (isNum(x)) cols.push({ price: x }); });
    } else if (util.isObj(p)) {
      var from = val(p.from), to = val(p.to), step = val(p.step), d = Math.max(decimals(from), decimals(step));
      if (isNum(from) && isNum(to) && isNum(step) && step > 0) {
        for (var k = 0; k <= 60 && from + k * step <= to + EPS; k++) cols.push({ price: +(from + k * step).toFixed(d) });
      }
    } else if (ctx.dataset && enc.price && ctx.dataset.has(enc.price)) {
      ctx.rows.forEach(function (r) {
        if (isNum(r[enc.price])) cols.push({ price: r[enc.price], tag: enc.label ? r[enc.label] : null, kind: enc.kind ? r[enc.kind] : null });
      });
    }
    function byKind(kind) { var c = cols.filter(function (x) { return x.kind === kind; })[0]; return c ? c.price : null; }
    var current = val(o.current);
    if (!isNum(current)) current = byKind('current');
    var offer = override && override.offer != null ? override.offer : val(o.offer);
    if (!isNum(offer)) offer = byKind('offer');
    if (!cols.length && isNum(current)) {          // nothing configured: six $2.50 steps from the current price
      for (var j = 0; j < 6; j++) cols.push({ price: Math.ceil(current / 2.5 - EPS) * 2.5 + j * 2.5 });
    }
    if (isNum(current) && !cols.some(function (c) { return near(c.price, current); })) cols.push({ price: current, inserted: true });
    if (isNum(offer) && !cols.some(function (c) { return near(c.price, offer); })) cols.push({ price: offer, inserted: true });
    cols.sort(function (a, b) { return a.price - b.price; });
    var merged = [];
    cols.forEach(function (c) {
      var last = merged[merged.length - 1];
      if (last && near(last.price, c.price)) { last.tag = last.tag || c.tag; last.kind = last.kind || c.kind; last.inserted = last.inserted && c.inserted; } else merged.push(c);
    });
    cols = merged.slice(0, 40);
    cols.forEach(function (c) {
      c.isCurrent = near(c.price, current);
      c.isOffer = near(c.price, offer);
      if (!c.tag) c.tag = c.isOffer ? o.offerLabel : c.isCurrent ? o.currentLabel : null;
      // a moving offer that is not one of the levels keeps one identity, so its figures tween instead of rebuilding
      c.key = c.isOffer && c.inserted ? 'offer' : 'p' + c.price.toFixed(4);
    });

    var shares = val(o.shares), netDebt = val(o.netDebt);
    if (!isNum(netDebt)) netDebt = 0;
    var pf = o.priceFormat, vf = o.valueFormat, notes = [];
    function noteRef(text) {
      if (!text) return null;
      var i = notes.indexOf(text);
      if (i < 0) { notes.push(text); i = notes.length - 1; }
      return i + 1;
    }
    var rows = [], sections = o.sections || ['premiums', 'value', 'metrics'];
    function equity(px) { return isNum(shares) ? px * shares : null; }
    function ev(px) { var e = equity(px); return e == null ? null : e + netDebt; }

    sections.forEach(function (sec) {
      if (sec === 'premiums') {
        var refs = o.references && o.references.length ? o.references : (isNum(current) ? [{ label: o.currentLabel, value: current }] : []);
        if (!refs.length) return;
        rows.push({ type: 'section', key: 'sec:prem', label: o.premiumTitle });
        refs.forEach(function (r, i) {
          var rv = val(r.value);
          rows.push({ type: 'premium', key: 'prem:' + i, label: r.label, indent: true, basis: rv, basisFmt: pf, fmt: o.premiumFormat, sign: true,
            note: noteRef(r.note), ref: rv,
            fn: function (px) { return isNum(rv) ? (rv > 0 ? px / rv - 1 : NaN) : null; } });
        });
      } else if (sec === 'value') {
        if (!isNum(shares)) return;
        rows.push({ type: 'value', key: 'equity', label: o.equityLabel, fmt: vf, strong: true, sep: rows.length > 0, fn: equity });
        if (o.showBridge !== false) {
          rows.push({ type: 'value', key: 'netdebt', label: netDebt < 0 ? o.netCashLabel : o.netDebtLabel, fmt: vf, muted: true, indent: true,
            fn: function () { return netDebt < 0 ? -netDebt : netDebt; } });
          rows.push({ type: 'value', key: 'ev', label: o.evLabel, fmt: vf, total: true, fn: ev });
        }
      } else if (sec === 'metrics') {
        var group = null;
        (o.metrics || []).forEach(function (m, i) {
          if (!m) return;
          var mv = val(m.value), kind = m.kind || 'ev';
          if (m.group && m.group !== group) rows.push({ type: 'section', key: 'sec:' + m.group + ':' + i, label: m.group });
          group = m.group || null;
          var base = kind === 'equity' ? equity : kind === 'price' ? function (px) { return px; } : ev;
          rows.push({ type: 'multiple', key: 'm:' + i, label: m.label, indent: !!m.group, basis: mv,
            basisFmt: m.metricFormat || (kind === 'price' ? pf : o.metricFormat || vf), fmt: m.format || o.multipleFormat,
            note: noteRef(m.note), kind: kind, metric: m,
            fn: function (px) { var b = base(px); return b == null || !isNum(mv) ? null : mv > 0 && b > 0 ? b / mv : NaN; } });
        });
      }
    });
    return { cols: cols, rows: rows, current: current, offer: offer, shares: shares, netDebt: netDebt, notes: notes };
  }

  RK.component({
    id: 'avp-table',
    deps: [],
    needsData: false,
    defaults: {
      encode: { price: 'price', label: 'label', kind: 'kind' },
      prices: null,              // [42.5, 45, ...] | {from, to, step} | null = the bound dataset's price field (or 6 levels from current)
      current: null,             // current share price | '@param' (default: the dataset row with kind 'current')
      offer: null,               // proposed offer price | '@param' (default: the dataset row with kind 'offer'); inserted if not a level
      shares: null,              // diluted shares (m) | '@param'
      netDebt: 0,                // net debt (USD m) | '@param'; negative = net cash
      references: [],            // [{label, value, note}] premium rows (current, 30-day VWAP, 52-week high, unaffected); [] = current only
      metrics: [],               // [{label, value, kind: 'ev' | 'equity' | 'price', group, format, metricFormat, note}]
      sections: ['premiums', 'value', 'metrics'],
      showBridge: true,          // net debt and implied EV rows under the equity value
      premiumTitle: 'Premium / (discount) to:',
      priceLabel: 'Price per share',
      equityLabel: 'Implied equity value',
      netDebtLabel: 'Plus: net debt',
      netCashLabel: 'Less: net cash',
      evLabel: 'Implied enterprise value',
      currentLabel: 'Current',
      offerLabel: 'Offer',
      units: 'USD m, except per-share data',
      priceFormat: '$#,##0.00',
      valueFormat: '$#,##0',
      premiumFormat: '0.0%;(0.0%)',
      multipleFormat: '0.0x',
      metricFormat: null,        // basis column format of ev / equity metrics (default: valueFormat)
      signColors: true,          // true (premiums green / discounts red) | 'neg' (discounts only) | false
      footnotes: [],             // extra footnote lines
      autoNotes: true,           // share count / net debt note under the table
      stepper: true,             // offer stepper above the table (when an offer is set)
      offerStep: 0.25,
      clickToOffer: true,        // click a price header to make it the offer (sets the bound @param)
      crosshair: true,
      tooltip: true,
      paramDefaults: {}          // fallback values for '@param' options the report does not define
    },
    render: function (ctx) {
      var cur = ctx, override = null, last = null, names = [];
      ctx.el.classList.add('is-auto');

      // '@param' options the report does not define start at options.paramDefaults (shared with sliders)
      function defineMissing(c) {
        var val = resolver(c.options), undef = {};
        names = paramRefs(c.options);
        names.forEach(function (p) { if (RK.store.param(p) === undefined) { var v = val('@' + p); if (v != null) undef[p] = v; } });
        RK.store.defineParams(undef);
      }
      defineMissing(ctx);

      var root = h('div.rk-avp' + (ctx.motion ? '' : '.is-static'));
      var bar = h('div.rk-avp__bar.rk-noprint');
      var table = h('table.rk-table.rk-avp__table');
      var wrap = h('div.rk-avp__wrap', table);
      var notesEl = h('div.rk-avp__notes');
      var tip = RK.ui.tip();
      // the frame carries the horizontal scroll cue (edge fade) for narrow blocks
      var frame = h('div.rk-avp__frame', wrap);
      root.appendChild(bar);
      root.appendChild(frame);
      root.appendChild(notesEl);
      ctx.el.appendChild(root);
      function edges() {
        frame.classList.toggle('is-more-r', wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 1);
        frame.classList.toggle('is-scrolled-x', wrap.scrollLeft > 1);
      }
      wrap.addEventListener('scroll', edges, { passive: true });

      // offer stepper
      var stepVal = h('span.rk-avp__stepval.rk-num');
      var stepPrem = h('span.rk-avp__steprem.rk-num');
      var minus = h('button.rk-btn.rk-avp__stepbtn', { type: 'button', 'aria-label': 'Lower offer price', text: '−' });
      var plus = h('button.rk-btn.rk-avp__stepbtn', { type: 'button', 'aria-label': 'Raise offer price', text: '+' });
      bar.appendChild(stepPrem);
      bar.appendChild(h('div.rk-avp__stepper', h('span.rk-ctl__label', 'Offer price'), minus, stepVal, plus));

      /* ---------------- offer changes ---------------- */
      function offerParam() { return paramName(cur.options.offer); }
      function setOffer(px) {
        if (!isNum(px)) return;
        px = +px.toFixed(4);
        var pn = offerParam();
        if (pn) { override = null; RK.store.setParam(pn, px); }   // the store notifies -> draw()
        else { override = { offer: px }; draw(); }
      }
      function nudge(dir) {
        var o = cur.options, s = isNum(o.offerStep) && o.offerStep > 0 ? o.offerStep : 0.25;
        var px = last && isNum(last.offer) ? last.offer : last && isNum(last.current) ? last.current : null;
        if (px == null) return;
        setOffer(Math.max(s, Math.round((px + dir * s) / s) * s));
      }
      minus.addEventListener('click', function () { nudge(-1); });
      plus.addEventListener('click', function () { nudge(1); });

      /* ---------------- draw ---------------- */
      var cells = {};           // rowKey|colKey -> {td, v}
      var heads = [];           // price header cells by column index
      function structKey(m) {
        // highlight flags are part of the shape: moving the offer onto another level re-tints the columns
        return m.cols.map(function (c) { return c.key + (c.isOffer ? '*' : '') + (c.isCurrent ? '^' : '') + (c.tag || ''); }).join(',') +
          '|' + m.rows.map(function (r) { return r.key + ':' + r.label; }).join(',');
      }

      function draw() {
        var o = cur.options, m = model(cur, override), prev = last;
        var same = prev && structKey(prev) === structKey(m);
        last = m;
        if (!same) build(m, prev);
        paint(m, same && prev ? prev : null);
        // stepper + notes
        var showStep = o.stepper !== false && isNum(m.offer);
        bar.style.display = showStep ? '' : 'none';
        if (showStep) {
          stepVal.textContent = RK.format(m.offer, o.priceFormat);
          var pc = isNum(m.current) && m.current > 0 ? m.offer / m.current - 1 : null;
          stepPrem.textContent = pc == null ? '' : RK.format(Math.abs(pc), '0.0%') + (pc < 0 ? ' discount' : ' premium') + ' to ' +
            String(o.currentLabel || 'current').toLowerCase() + ' (' + RK.format(m.current, o.priceFormat) + ')';
        }
        notesEl.innerHTML = '';
        var lines = [];
        if (o.autoNotes !== false && isNum(m.shares)) {
          lines.push(o.equityLabel + ' based on ' + RK.format(m.shares, '#,##0.0') + 'm diluted shares' +
            (o.showBridge !== false ? '; ' + o.evLabel.charAt(0).toLowerCase() + o.evLabel.slice(1) + ' includes ' +
              (m.netDebt < 0 ? 'net cash of ' : 'net debt of ') + RK.format(Math.abs(m.netDebt), o.valueFormat) + 'm' : '') + '.');
        }
        m.notes.forEach(function (n, i) { lines.push('(' + (i + 1) + ') ' + n); });
        (o.footnotes || []).forEach(function (n) { if (n) lines.push(n); });
        lines.forEach(function (l, i) { notesEl.appendChild(h('p', (i === 0 && o.autoNotes !== false && isNum(m.shares) ? 'Note: ' : '') + l)); });
        notesEl.style.display = lines.length ? '' : 'none';
        edges();
      }

      function colClass(c) { return (c.isCurrent ? ' is-current' : '') + (c.isOffer ? ' is-offer' : ''); }

      function build(m, prev) {
        var o = cur.options, n = m.cols.length;
        cells = {};
        heads = [];
        table.innerHTML = '';
        table.style.minWidth = (260 + n * 74) + 'px';
        var cg = h('colgroup', h('col.rk-avp__c-label'), h('col.rk-avp__c-basis'));
        m.cols.forEach(function () { cg.appendChild(h('col')); });
        var tags = h('tr.rk-avp__tags', h('th.rk-avp__units', { colspan: 2, scope: 'col' }, o.units || ''));
        var prices = h('tr.rk-avp__prices', h('th.rk-avp__pxlabel', { colspan: 2, scope: 'row' }, o.priceLabel));
        var enter = prev && prev.cols.map(function (c) { return c.key; });
        m.cols.forEach(function (c, j) {
          var isNew = enter && enter.indexOf(c.key) < 0;
          var cls = colClass(c) + (isNew ? ' is-enter' : '');
          tags.appendChild(h('th.rk-avp__tag.is-num', { class: cls.trim() || null, scope: 'col' },
            c.tag ? h('span.rk-avp__pill', { class: 'rk-avp__pill--' + (c.isOffer ? 'offer' : c.isCurrent ? 'current' : c.kind === 'offer' ? 'proposal' : c.kind || 'level') }, c.tag) : null));
          var th = h('th.rk-avp__px.is-num', { class: cls.trim() || null, scope: 'col', dataset: { col: j } }, RK.format(c.price, o.priceFormat));
          if (o.clickToOffer !== false) { th.classList.add('is-click'); th.setAttribute('title', 'Set ' + RK.format(c.price, o.priceFormat) + ' as the offer price'); th.tabIndex = 0; }
          heads.push(th);
          prices.appendChild(th);
        });
        var thead = h('thead', tags, prices), tbody = h('tbody');
        m.rows.forEach(function (r, i) {
          var tr = h('tr', { class: 'rk-avp__row is-' + r.type + (r.total ? ' is-total' : '') + (r.strong ? ' is-strong' : '') + (r.sep ? ' is-sep' : '') + (r.muted ? ' is-muted' : ''), style: { '--rk-i': i } });
          var label = h('td.rk-avp__label', { class: r.indent ? 'is-indent' : null }, r.label, r.note ? h('sup.rk-avp__fn', '(' + r.note + ')') : null);
          if (r.type === 'section') {
            label.setAttribute('colspan', 2);
            tr.appendChild(label);
          } else {
            tr.appendChild(label);
            tr.appendChild(h('td.rk-avp__basis.is-num', r.basis != null ? RK.format(r.basis, r.basisFmt) : ''));
          }
          m.cols.forEach(function (c, j) {
            var isNew = enter && enter.indexOf(c.key) < 0;
            var td = h('td.is-num', { class: (colClass(c) + (isNew ? ' is-enter' : '')).trim() || null, dataset: { col: j, row: i } });
            tr.appendChild(td);
            if (r.type !== 'section') cells[r.key + '|' + c.key] = { td: td, v: null };
          });
          tbody.appendChild(tr);
        });
        table.appendChild(cg);
        table.appendChild(thead);
        table.appendChild(tbody);
        if (cur.motion && !prev) {
          root.classList.remove('is-in');
          void root.offsetWidth;
          root.classList.add('is-in');
        }
      }

      /** Write every figure; with a previous model of the same shape the numbers tween from their old values. */
      function paint(m, prev) {
        var o = cur.options, jobs = [];
        // price headers: a moving offer column keeps its place and its price tweens with the figures
        m.cols.forEach(function (c, j) {
          var th = heads[j];
          if (!th) return;
          var from = prev && prev.cols[j] ? prev.cols[j].price : null;
          if (o.clickToOffer !== false) th.setAttribute('title', 'Set ' + RK.format(c.price, o.priceFormat) + ' as the offer price');
          jobs.push({ td: th, from: from, to: c.price, fmt: o.priceFormat });
        });
        m.rows.forEach(function (r, i) {
          if (r.type === 'section') return;
          var label = table.tBodies[0].rows[i];
          if (label && r.basis != null) label.cells[1].textContent = RK.format(r.basis, r.basisFmt);
          m.cols.forEach(function (c) {
            var cell = cells[r.key + '|' + c.key];
            if (!cell) return;
            var v = r.fn(c.price), from = cell.v;
            cell.v = v;
            cell.row = r; cell.col = c;
            var signed = r.sign && o.signColors && isNum(v) && Math.abs(v) >= 0.0005;
            cell.td.classList.toggle('is-neg', !!signed && v < 0);
            cell.td.classList.toggle('is-pos', !!signed && v > 0 && o.signColors !== 'neg');
            jobs.push({ td: cell.td, from: prev && isNum(from) ? from : null, to: v, fmt: r.fmt });
          });
        });
        function frame(k) {
          jobs.forEach(function (j) {
            var x = k >= 1 || j.from == null || !isNum(j.to) ? j.to : j.from + (j.to - j.from) * k;
            j.td.textContent = RK.format(x, j.fmt);
          });
        }
        if (prev && cur.motion && jobs.some(function (j) { return j.from != null && j.from !== j.to; })) RK.motion.tween(420, frame, 'outCubic');
        else frame(1);
      }

      /* ---------------- interactions ---------------- */
      var hotCol = null;
      function cross(j) {
        if (hotCol === j) return;
        root.querySelectorAll('.is-hot').forEach(function (el) { el.classList.remove('is-hot'); });
        hotCol = j;
        if (j == null || cur.options.crosshair === false) return;
        root.querySelectorAll('[data-col="' + j + '"]').forEach(function (el) { el.classList.add('is-hot'); });
      }
      function tipFor(td) {
        var o = cur.options, m = last, key = null;
        if (!m || !td || td.dataset.row == null) return null;
        var r = m.rows[+td.dataset.row], c = m.cols[+td.dataset.col];
        if (!r || !c || r.type === 'section') return null;
        key = cells[r.key + '|' + c.key];
        var v = key ? key.v : null, pf = o.priceFormat, vf = o.valueFormat;
        var px = RK.format(c.price, pf), rows = [];
        var eq = isNum(m.shares) ? c.price * m.shares : null;
        if (r.type === 'premium') {
          rows.push({ label: 'Offer price', value: px });
          rows.push({ label: r.label, value: RK.format(r.ref, pf) });
          rows.push({ label: v != null && v < 0 ? 'Discount' : 'Premium', value: RK.format(v, r.fmt), bold: true });
        } else if (r.key === 'equity') {
          rows.push({ label: 'Offer price', value: px });
          rows.push({ label: '× Diluted shares (m)', value: RK.format(m.shares, '#,##0.0') });
          rows.push({ label: '= ' + o.equityLabel, value: RK.format(v, vf), bold: true });
        } else if (r.key === 'ev') {
          rows.push({ label: o.equityLabel, value: RK.format(eq, vf) });
          rows.push({ label: m.netDebt < 0 ? '− Net cash' : '+ Net debt', value: RK.format(Math.abs(m.netDebt), vf) });
          rows.push({ label: '= ' + o.evLabel, value: RK.format(v, vf), bold: true });
        } else if (r.key === 'netdebt') {
          rows.push({ label: r.label, value: RK.format(v, vf), bold: true });
        } else if (r.type === 'multiple') {
          var num = r.kind === 'equity' ? eq : r.kind === 'price' ? c.price : (eq == null ? null : eq + m.netDebt);
          var numLabel = r.kind === 'equity' ? o.equityLabel : r.kind === 'price' ? 'Offer price' : o.evLabel;
          rows.push({ label: numLabel, value: RK.format(num, r.kind === 'price' ? pf : vf) });
          rows.push({ label: '÷ ' + ((r.metric && r.metric.name) || r.label), value: RK.format(r.basis, r.basisFmt) });
          rows.push({ label: '= Multiple', value: RK.format(v, r.fmt), bold: true });
        }
        var title = px + (c.tag ? ' · ' + c.tag : '');
        return RK.chart.tip(title, rows, c.isOffer && !c.isCurrent ? null : (o.clickToOffer !== false ? 'Click the price to make it the offer' : null));
      }
      function onOver(e) {
        var td = e.target.closest('td[data-col], th[data-col]');
        cross(td ? +td.dataset.col : null);
        if (cur.options.tooltip === false || !td || td.tagName !== 'TD') { tip.hide(); return; }
        var html = tipFor(td);
        if (html) tip.show(html, td); else tip.hide();
      }
      function onLeave() { cross(null); tip.hide(); }
      function onClick(e) {
        var th = e.target.closest('th.rk-avp__px');
        if (!th || cur.options.clickToOffer === false || !last) return;
        var c = last.cols[+th.dataset.col];
        if (c) setOffer(c.price);
      }
      function onKey(e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('th.rk-avp__px')) { e.preventDefault(); onClick(e); }
      }
      table.addEventListener('mouseover', onOver);
      table.addEventListener('mouseleave', onLeave);
      table.addEventListener('click', onClick);
      table.addEventListener('keydown', onKey);

      // options bound to @params recompute when a slider (or another block) moves them
      var unsub = RK.store.subscribe(function (changes) {
        if (names.length && changes.some(function (c) { return c.type === 'param' && names.indexOf(c.key) >= 0; })) draw();
      });

      draw();

      return {
        update: function (c) { cur = c; defineMissing(c); draw(); },
        resize: edges,
        destroy: function () {
          unsub();
          wrap.removeEventListener('scroll', edges);
          table.removeEventListener('mouseover', onOver);
          table.removeEventListener('mouseleave', onLeave);
          table.removeEventListener('click', onClick);
          table.removeEventListener('keydown', onKey);
          tip.destroy();
          root.remove();
          cur.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
