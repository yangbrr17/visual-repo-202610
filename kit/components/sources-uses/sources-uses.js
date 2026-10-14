/*!
 * RK component: sources-uses — Sources & Uses of funds for an LBO / acquisition financing: two
 * side-by-side pitchbook tables (amount, % of total, x EBITDA) whose totals must balance (a warning
 * chip names the gap when they do not), an ordinal-ramp mini stacked bar per side showing the mix
 * (swatches double as its key), row footnotes collected under the panels, currency symbol on the
 * first row and totals only. mode: 'capitalization' turns one dataset of tranches into a pro forma
 * capitalisation table (rate, maturity, cumulative leverage, subtotals) with a leverage ladder.
 * Pure DOM; hover links rows and bar segments; optional click-to-cross-filter on rows (others dim).
 */
(function () {
  'use strict';
  var util = RK.util, h = util.h;

  /** Format code without currency symbols outside quoted literals: '$#,##0.0' -> '#,##0.0'. */
  function bare(code) {
    code = String(RK.format.presets[code] || code || '');
    return code.replace(/("[^"]*")|\[\$[^\]]*\]|[$€£¥]/g, function (m, q) { return q || ''; });
  }

  /** n colours along the theme's ordinal ramp (strongest first): parts of a whole. */
  function ordinal(t, n) {
    if (n <= 1) return [t.ord[0]];
    var r = RK.theme.ramp(t.ord), out = [];
    for (var i = 0; i < n; i++) out.push(r(i / (n - 1)));
    return out;
  }

  function sum(list) { return list.reduce(function (s, v) { return s + (util.isNum(v) ? v : 0); }, 0); }

  RK.component({
    id: 'sources-uses',
    deps: [],
    defaults: {
      encode: { side: 'side', item: 'item', amount: 'amount', multiple: 'multiple_of_ebitda', pct: null, notes: 'notes', rate: 'rate', maturity: 'maturity' },
      mode: 'sources-uses',      // sources-uses | capitalization
      sides: ['Sources', 'Uses'],   // side values in panel order (left -> right); other values follow
      sideTitles: {},            // {'Sources': 'Sources of funds'} display names
      totalLabels: {},           // {'Sources': 'Total sources'}; capitalization: {'total': 'Total capitalisation'}
      titles: {},                // {item, amount, pct, multiple, rate, maturity} column header overrides
      columns: ['amount', 'pct', 'multiple'],   // numeric columns (capitalization adds rate / maturity automatically)
      format: null,              // amount format (defaults to the amount field format)
      pctFormat: null,           // defaults to the pct field format, else 0.0%
      multipleFormat: null,      // defaults to the multiple field format, else 0.0x
      ebitda: null,              // EBITDA for x EBITDA = amount / ebitda (overrides the multiple field, e.g. to switch to LTM)
      currency: 'first',         // first: currency symbol on the first row and totals only (pitchbook style) | all
      mixBar: true,              // mini stacked bar per side (capitalization: leverage ladder)
      alignTotals: true,         // pad the shorter side so both total rows sit on one line
      tolerance: 0.5,            // |sources - uses| above this shows the out-of-balance chip (amount units)
      highlight: null,           // item(s) drawn in accent2 (e.g. 'Sponsor equity')
      subtotals: [],             // capitalization: [{after: '<item>', label: 'Total debt'}]
      footnotes: [],             // extra footnotes (strings) after the row notes
      crossFilter: false,        // click a row to cross-filter (off by default: filtering a balancing table rarely makes sense)
      crossFilterScope: 'dataset'   // 'item' is a field of this table only
    },
    render: function (ctx) {
      var cur = ctx, curModel = null, first = true, tip = null, prevW = new Map(), ladders = [];
      ctx.el.classList.add('is-auto');
      var root = h('div.rk-su');
      ctx.el.appendChild(root);

      /* ---------------- model ---------------- */
      function model(c) {
        var o = c.options, enc = c.enc, ds = c.dataset, cap = o.mode === 'capitalization';
        function pick(list) { for (var i = 0; i < list.length; i++) if (list[i] && ds.has(list[i])) return list[i]; return null; }
        var F = {
          side: pick([enc.side]),
          item: pick([enc.item, 'instrument', 'item']),
          amount: pick([enc.amount, 'amount']),
          multiple: pick(cap ? [enc.multiple, 'multiple_cum'] : [enc.multiple]),
          pct: pick([enc.pct]),
          notes: pick([enc.notes]),
          rate: pick([enc.rate]),
          maturity: pick([enc.maturity])
        };
        if (!F.item || !F.amount) throw new Error('sources-uses: dataset needs an item and an amount field (encode.item / encode.amount)');
        if (!cap && !F.side) throw new Error('sources-uses: no "' + enc.side + '" field — set encode.side, or mode: "capitalization" for a single list');
        var hl = (o.highlight == null ? [] : [].concat(o.highlight)).map(String);
        var amountFmt = o.format || c.fmtOf(F.amount) || '#,##0.0';
        var m = {
          cap: cap, F: F,
          af: amountFmt,
          afBare: o.currency === 'all' ? amountFmt : bare(amountFmt),
          pf: o.pctFormat || (F.pct && c.fmtOf(F.pct)) || '0.0%',
          mf: o.multipleFormat || (F.multiple && c.fmtOf(F.multiple)) || '0.0x',
          cumulative: cap && !o.ebitda && !!F.multiple && /cum/i.test(F.multiple),
          panels: []
        };
        m.hasMultiple = !!(F.multiple || o.ebitda);
        // one EBITDA for every side: options.ebitda, else implied by the multiple column (sum of amounts / sum of
        // multiples, so rounding errors average out) -> balanced sides always show the same total multiple
        m.ebitda = o.ebitda || null;
        if (!m.ebitda && F.multiple && !m.cumulative) {
          var num = 0, den = 0;
          c.rows.forEach(function (r) { if (util.isNum(r[F.amount]) && util.isNum(r[F.multiple])) { num += r[F.amount]; den += r[F.multiple]; } });
          m.ebitda = den > 0 && num > 0 ? num / den : null;
        }

        /**
         * Rows: multiple from options.ebitda or the field; capitalization shows them cumulatively (a cumulative
         * field as is, a per-tranche one as a running sum). Totals: total amount / EBITDA (else the column sum).
         */
        function itemsOf(rows) {
          var total = sum(rows.map(function (r) { return r[F.amount]; })), run = 0, runMult = 0, anyMult = false;
          var items = rows.map(function (r) {
            var a = r[F.amount];
            run += util.isNum(a) ? a : 0;
            var mult = o.ebitda ? (util.isNum(a) ? a / o.ebitda : null) : F.multiple ? r[F.multiple] : null;
            if (util.isNum(mult)) { anyMult = true; if (!m.cumulative) runMult += mult; }
            if (cap && !m.cumulative) mult = util.isNum(mult) || runMult ? runMult : null;
            return {
              r: r, key: String(r[F.item]), name: r[F.item] == null ? RK.format(null) : String(r[F.item]), amount: a, run: run,
              pct: F.pct ? r[F.pct] : (util.isNum(a) ? a / total : null),
              runPct: run / total,
              mult: mult,
              note: F.notes && r[F.notes] ? String(r[F.notes]) : null,
              hl: hl.indexOf(String(r[F.item])) >= 0
            };
          });
          var colors = ordinal(c.theme, items.length);
          items.forEach(function (it, i) { it.color = it.hl ? c.theme.accent2 : colors[i]; });
          var last = items.length ? items[items.length - 1].mult : null;
          return { items: items, total: total, mult: !anyMult ? null : cap ? last : m.ebitda ? total / m.ebitda : runMult };
        }

        if (cap) {
          var p = itemsOf(c.rows);
          p.side = 'capitalization';
          p.title = o.sideTitles.capitalization || c.title(F.item);
          p.totalLabel = o.totalLabels.total || 'Total capitalisation';
          m.panels.push(p);
        } else {
          var groups = util.groupBy(c.rows, function (r) { return String(r[F.side]); });
          var order = [];
          [].concat(o.sides || []).forEach(function (s) {
            groups.forEach(function (_, k) { if (order.indexOf(k) < 0 && k.toLowerCase() === String(s).toLowerCase()) order.push(k); });
          });
          groups.forEach(function (_, k) { if (order.indexOf(k) < 0) order.push(k); });
          order.forEach(function (k) {
            var p = itemsOf(groups.get(k));
            p.side = k;
            p.title = o.sideTitles[k] || k;
            p.totalLabel = o.totalLabels[k] || 'Total ' + p.title.toLowerCase();
            m.panels.push(p);
          });
        }
        // footnotes numbered in reading order (identical notes share a number), listed under the panel that
        // first cites them; options.footnotes follow under the panels
        var notes = [];
        m.panels.forEach(function (p) {
          p.notes = [];
          p.items.forEach(function (it) {
            if (!it.note) return;
            var i = notes.indexOf(it.note);
            if (i < 0) { notes.push(it.note); i = notes.length - 1; p.notes.push({ n: i + 1, text: it.note }); }
            it.fn = i + 1;
          });
        });
        m.extraNotes = [];
        [].concat(o.footnotes || []).forEach(function (n) {
          if (n && notes.indexOf(String(n)) < 0) { notes.push(String(n)); m.extraNotes.push({ n: notes.length, text: String(n) }); }
        });
        // balance check: first two panels (sources vs uses)
        if (!cap && m.panels.length >= 2) {
          var a = m.panels[0], b = m.panels[1], diff = a.total - b.total;
          m.balance = { diff: diff, ok: Math.abs(diff) <= (util.isNum(o.tolerance) ? o.tolerance : 0.5), a: a, b: b };
        }
        return m;
      }

      /* ---------------- rendering ---------------- */
      function columnsOf(c, m) {
        var o = c.options, T = o.titles || {}, F = m.F, f = F.amount ? c.field(F.amount) : null;
        var want = [].concat(o.columns || []);
        var cols = [];
        var amountTitle = T.amount || (f && f.unit) || c.title(F.amount);
        if (want.indexOf('amount') >= 0) cols.push({ key: 'amount', title: amountTitle });
        if (m.cap && F.rate) cols.push({ key: 'rate', title: T.rate || c.title(F.rate) });
        if (m.cap && F.maturity) cols.push({ key: 'maturity', title: T.maturity || c.title(F.maturity) });
        if (want.indexOf('multiple') >= 0 && m.hasMultiple && m.cap) cols.push({ key: 'multiple', title: T.multiple || (F.multiple ? c.title(F.multiple) : 'Cumulative x EBITDA') });
        if (want.indexOf('pct') >= 0) cols.push({ key: 'pct', title: T.pct || (m.cap ? '% of total' : (F.pct ? c.title(F.pct) : '% of total')) });
        if (want.indexOf('multiple') >= 0 && m.hasMultiple && !m.cap) cols.push({ key: 'multiple', title: T.multiple || (F.multiple ? c.title(F.multiple) : 'x EBITDA') });
        return cols;
      }

      function cell(col, it, m, c, firstRow) {
        var F = m.F;
        switch (col.key) {
          case 'amount': return h('td.is-num.rk-su__amt', RK.format(it.amount, firstRow ? m.af : m.afBare));
          case 'pct': return h('td.is-num', RK.format(it.pct, m.pf));
          case 'multiple': return h('td.is-num', RK.format(it.mult, m.mf));
          case 'rate': return h('td.is-num', RK.format(it.r[F.rate], c.fmtOf(F.rate) || '0.00%'));
          case 'maturity': {
            var mf = c.fmtOf(F.maturity);
            return h('td.is-num', RK.format(it.r[F.maturity], mf && RK.format.isDateCode(mf) ? mf : (c.field(F.maturity) && c.field(F.maturity).type === 'date' ? 'mmm yyyy' : mf)));
          }
        }
        return h('td');
      }

      function itemRow(it, i, p, m, c, cols) {
        var sel = c.selected(m.F.item), dim = sel.length && sel.indexOf(it.r[m.F.item]) < 0;
        var tr = h('tr.rk-su__row', {
          class: (it.hl ? 'is-target' : '') + (dim ? ' is-dim' : '') + (c.options.crossFilter ? ' is-clickable' : ''),
          tabindex: c.options.crossFilter ? '0' : null,
          style: { '--rk-i': Math.min(i, 20) }
        },
          h('td.rk-su__item', { title: it.name + (it.note ? ' — ' + it.note : '') },
            c.options.mixBar !== false ? h('i.rk-su__sw', { style: { background: it.color }, 'aria-hidden': 'true' }) : null,
            h('span.rk-su__name', it.name),
            it.fn ? h('sup.rk-su__fn', '(' + it.fn + ')') : null),
          cols.map(function (col) { return cell(col, it, m, c, i === 0); }));
        tr.dataset.key = p.side + '|' + it.key;
        tr._rk = { it: it, p: p };
        return tr;
      }

      function mixBar(p, m, c, cols) {
        var bar = h('div.rk-su__mix', { 'aria-hidden': 'true' });
        p.items.forEach(function (it) {
          var w = util.isNum(it.amount) && p.total > 0 ? Math.max(0, it.amount) / p.total * 100 : 0;
          var key = p.side + '|' + it.key;
          var seg = h('i.rk-su__seg', { style: { background: it.color } });
          seg.dataset.key = key;
          seg._rk = { it: it, p: p };
          seg._w = w;
          var from = prevW.has(key) ? prevW.get(key) : (first ? 0 : w);
          seg.style.width = (c.motion ? from : w) + '%';
          bar.appendChild(seg);
        });
        var td = h('td.rk-su__mixcell', { colspan: String(cols.length + 1) }, bar);
        if (m.cap) {
          var lad = h('div.rk-su__ladder');
          td.appendChild(lad);
          ladders.push({ el: lad, p: p, m: m });
        }
        return h('tr.rk-su__mixrow', td);
      }

      /** Cumulative-leverage labels under the capitalisation bar, spread apart so they never collide. */
      function placeLadder(L) {
        var W = L.el.clientWidth;
        L.el.innerHTML = '';
        if (!W) return;
        var font = '600 10.5px ' + cur.theme.fontNum;
        var marks = L.p.items.filter(function (it) { return util.isNum(it.amount) && it.amount > 0 && util.isNum(it.mult); });
        var texts = marks.map(function (it) { return RK.format(it.mult, L.m.mf); });
        var widths = texts.map(function (s) { return RK.chart.measure(s, font); });
        var gap = Math.max.apply(null, widths.concat([0])) + 10;
        var xs = marks.map(function (it) { return it.runPct * W; });
        var pos = RK.chart.spreadLabels(xs, gap, gap / 2, W - gap / 2);
        // caption at the left end when the first label leaves room for it
        var caption = (cur.options.titles || {}).ladder || 'Cumulative leverage';
        var capW = RK.chart.measure(caption, '10px ' + cur.theme.fontSans);
        if (pos.length && pos[0] - widths[0] / 2 > capW + 14) L.el.appendChild(h('span.rk-su__lcap', caption));
        marks.forEach(function (it, i) {
          L.el.appendChild(h('span.rk-su__tick', { style: { left: (xs[i] / W * 100) + '%' } }));
          L.el.appendChild(h('span.rk-su__lev.rk-num', { style: { left: pos[i] + 'px' } }, texts[i]));
        });
      }

      function panel(p, m, c, pad) {
        var cols = columnsOf(c, m), T = c.options.titles || {};
        var head = h('tr.rk-su__head',
          h('th.rk-su__side', { scope: 'col' }, m.cap ? (T.item || p.title) : p.title),
          cols.map(function (col) { return h('th.is-num', { scope: 'col', class: 'rk-su__c-' + col.key }, col.title); }));
        var thead = h('thead', head, c.options.mixBar !== false && p.items.length ? mixBar(p, m, c, cols) : null);
        var tbody = h('tbody');
        var subs = m.cap ? [].concat(c.options.subtotals || []) : [];
        p.items.forEach(function (it, i) {
          tbody.appendChild(itemRow(it, i, p, m, c, cols));
          subs.filter(function (s) { return s && String(s.after) === it.key; }).forEach(function (s) {
            var sub = { amount: it.run, pct: it.runPct, mult: it.mult, r: {} };
            tbody.appendChild(h('tr.rk-su__sub', h('td', s.label || 'Subtotal'), cols.map(function (col) {
              if (col.key === 'rate' || col.key === 'maturity') return h('td');
              return cell(col, sub, m, c, true);
            })));
          });
        });
        for (var k = 0; k < pad; k++) tbody.appendChild(h('tr.rk-su__pad', { 'aria-hidden': 'true' }, h('td', { colspan: String(cols.length + 1) }, ' ')));
        var off = m.balance && !m.balance.ok && (p === m.balance.a || p === m.balance.b);
        var tot = { amount: p.total, pct: 1, mult: p.mult, r: {} };
        var tfoot = h('tfoot', h('tr.rk-su__total', { class: off ? 'is-off' : '' },
          h('td', p.totalLabel),
          cols.map(function (col) {
            if (col.key === 'rate' || col.key === 'maturity') return h('td');
            return cell(col, tot, m, c, true);
          })));
        return h('section.rk-su__panel', { 'aria-label': p.title },
          h('table.rk-table.rk-su__table', h('caption.rk-sr-only', p.title), thead, tbody, tfoot),
          notesList(p.notes));
      }

      function notesList(list) {
        if (!list || !list.length) return null;
        return h('ol.rk-su__notes', list.map(function (n) { return h('li', h('span.rk-su__fnum', '(' + n.n + ')'), n.text); }));
      }

      function draw(c) {
        var m = curModel = model(c), o = c.options;
        var next = new Map();
        ladders = [];
        root.className = 'rk-su' + (m.cap ? ' is-cap' : '') + (c.motion ? ' is-motion' : '') + (first && c.motion ? ' is-first' : '') +
          (c.selected(m.F.item).length ? ' has-sel' : '');
        root.innerHTML = '';
        // out-of-balance chip
        if (m.balance && !m.balance.ok) {
          var b = m.balance, big = b.diff > 0 ? b.a : b.b, small = b.diff > 0 ? b.b : b.a;
          root.appendChild(h('div.rk-su__status', h('span.rk-su__warn', { role: 'status' },
            h('span.rk-su__warnicon', { 'aria-hidden': 'true' }, '!'),
            'Out of balance: ' + big.title.toLowerCase() + ' exceed ' + small.title.toLowerCase() + ' by ' + RK.format(Math.abs(b.diff), m.af))));
        }
        var maxRows = Math.max.apply(null, m.panels.map(function (p) { return p.items.length; }).concat([0]));
        var wrap = h('div.rk-su__panels', { class: m.panels.length > 1 ? 'is-multi' : '' });
        m.panels.forEach(function (p) {
          wrap.appendChild(panel(p, m, c, o.alignTotals !== false && !m.cap ? maxRows - p.items.length : 0));
        });
        root.appendChild(wrap);
        var extra = notesList(m.extraNotes);
        if (extra) root.appendChild(extra);
        // bars: grow from 0 on first paint, glide from their previous width on updates
        var segs = root.querySelectorAll('.rk-su__seg');
        Array.prototype.forEach.call(segs, function (s) { next.set(s.dataset.key, s._w); });
        if (c.motion) {
          void root.offsetWidth;
          window.requestAnimationFrame(function () { Array.prototype.forEach.call(segs, function (s) { s.style.width = s._w + '%'; }); });
        }
        ladders.forEach(placeLadder);
        prevW = next;
        first = false;
      }

      /* ---------------- interaction ---------------- */
      function link(key, on) {
        Array.prototype.forEach.call(root.querySelectorAll('[data-key]'), function (el) {
          if (el.dataset.key === key) el.classList.toggle('is-hot', on);
        });
        root.classList.toggle('has-hot', on);
      }
      function tipFor(d) {
        var m = d.m, it = d.it, rows = [{ color: it.color, label: 'Amount', value: RK.format(it.amount, m.af) },
          { label: m.cap ? '% of total' : '% of ' + d.p.title.toLowerCase(), value: RK.format(it.pct, m.pf) }];
        if (m.hasMultiple) rows.push({ label: m.cap ? 'Cumulative leverage' : 'x EBITDA', value: RK.format(it.mult, m.mf) });
        return RK.chart.tip(it.name, rows, it.note);
      }
      var hotKey = null;
      function onOver(e) {
        var el = e.target.closest('[data-key]');
        var key = el ? el.dataset.key : null;
        if (key === hotKey) return;
        if (hotKey) link(hotKey, false);
        hotKey = key;
        if (!key) { if (tip) tip.hide(); return; }
        link(key, true);
        if (el.classList.contains('rk-su__seg') && !cur.print) {
          if (!tip) tip = RK.ui.tip();
          tip.show(tipFor({ it: el._rk.it, p: el._rk.p, m: curModel }), el);
        } else if (tip) tip.hide();
      }
      function onLeave() {
        if (hotKey) link(hotKey, false);
        hotKey = null;
        if (tip) tip.hide();
      }
      function pick(tr) {
        if (!tr || !tr._rk || !cur.options.crossFilter) return;
        var f = curModel.F.item;
        cur.select(f, tr._rk.it.r[f], { scope: cur.options.crossFilterScope === 'global' ? 'global' : 'dataset' });
      }
      function onClick(e) { pick(e.target.closest('tr.rk-su__row')); }
      function onKey(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tr = e.target.closest('tr.rk-su__row');
        if (tr) { e.preventDefault(); pick(tr); }
      }
      root.addEventListener('mouseover', onOver);
      root.addEventListener('mouseleave', onLeave);
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', onKey);

      draw(ctx);

      return {
        update: function (c) { cur = c; if (tip) tip.hide(); hotKey = null; draw(c); },
        resize: function () { ladders.forEach(placeLadder); },
        destroy: function () {
          root.removeEventListener('mouseover', onOver);
          root.removeEventListener('mouseleave', onLeave);
          root.removeEventListener('click', onClick);
          root.removeEventListener('keydown', onKey);
          if (tip) tip.destroy();
          root.remove();
          cur.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
