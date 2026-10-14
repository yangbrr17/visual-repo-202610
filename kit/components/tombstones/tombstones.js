/*!
 * RK component: tombstones — deal credentials grid, the pitchbook "tombstone" page. One card per
 * transaction: deal-type kicker, monogram tiles built from the parties' initials (no external images),
 * "has been acquired by" / "has acquired" wording driven by the deal type, deal value, date and the
 * bank's role. Equal-height cards in a responsive grid (options.columns caps the count and wraps on
 * narrow screens), highlighted deals in accent2, facet chips that cross-filter on sector / region
 * (non-matching cards dim), hover lift with a detail tooltip, and a 2-D FLIP re-flow when global
 * filters add or remove deals. Pure DOM; print-safe (no chips, no motion, cards never split).
 */
(function () {
  'use strict';
  var util = RK.util, h = util.h;

  /**
   * Deal type -> which party leads the card and the phrase that joins it to the other one
   * (first match wins; options.wording[type] overrides). solo: phrase when there is no counterparty.
   */
  var WORDING = [
    { test: /\bipo\b|initial public|listing/i, lead: 'target', verb: null, party: null, solo: 'Initial public offering' },
    { test: /offering|placement|follow|rights issue|block trade|\becm\b/i, lead: 'target', verb: null, party: null, solo: null },
    { test: /financ|loan|facilit|bond|notes|debt|\bdcm\b|lever/i, lead: 'acquirer', verb: 'financing for its acquisition of', party: 'target', solo: null },
    { test: /merger|merge/i, lead: 'target', verb: 'has merged with', party: 'acquirer', solo: null },
    { test: /sell|divest|carve|disposal|sale|spin/i, lead: 'target', verb: 'has been acquired by', party: 'acquirer', solo: null },
    { test: /buy|acqui|purchase|take.?private|tender/i, lead: 'acquirer', verb: 'has acquired', party: 'target', solo: null }
  ];
  var DEFAULT_WORDING = WORDING[4];

  // words that never make a monogram letter ("Ashcombe & Co." -> "AS", "Bluefield Capital Partners" -> "BC")
  var STOP = /^(&|\+|and|of|the|de|la|le|du|und|et|y|co\.?|inc\.?|corp\.?|ltd\.?|llc|plc|ag|sa|se|nv|bv|spa|s\.?p\.?a\.?|gmbh|kk|holdings?|group)$/i;

  /** Two-letter monogram: initials of the first two significant words, or the first two letters of one word. */
  function initials(name) {
    var words = String(name == null ? '' : name).replace(/\([^)]*\)/g, ' ').split(/[\s\/–—-]+/)
      .filter(function (w) { return w && !STOP.test(w) && /[0-9A-Za-zÀ-￿]/.test(w); });
    if (!words.length) return '';
    var a = Array.from(words[0]);
    if (words.length === 1) return (a[0] + (a[1] || '')).toUpperCase();
    return (a[0] + Array.from(words[1])[0]).toUpperCase();
  }

  /** Stable small hash so a company keeps its tile colour across renders and filters. */
  function hash(s) {
    var x = 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(x);
  }

  function wordingFor(type, o) {
    var custom = o.wording && type != null && Object.prototype.hasOwnProperty.call(o.wording, type) ? o.wording[type] : null;
    var base = DEFAULT_WORDING;
    for (var i = 0; i < WORDING.length; i++) if (WORDING[i].test.test(String(type || ''))) { base = WORDING[i]; break; }
    return custom ? util.merge({}, base, custom) : base;
  }

  /**
   * One card's content: lead / party names in pitchbook wording. Missing lead falls back to the other
   * party; a missing counterparty drops the joining phrase (and shows the solo phrase instead).
   */
  function describe(r, c) {
    var enc = c.enc, w = wordingFor(r[enc.type], c.options);
    var lead = w.lead ? r[enc[w.lead]] : null, party = w.party ? r[enc[w.party]] : null;
    if (lead == null || lead === '') { lead = party; party = null; }
    if (lead == null || lead === '') lead = r[enc.target] || r[enc.acquirer] || '';
    return { lead: String(lead), party: party == null || party === '' ? null : String(party), verb: party ? w.verb : null, solo: party ? null : w.solo };
  }

  RK.component({
    id: 'tombstones',
    deps: [],
    defaults: {
      encode: {
        date: 'date', target: 'target', acquirer: 'acquirer', value: 'deal_value_bn', type: 'deal_type',
        role: 'role', sector: 'sector', region: 'region', description: 'description'
      },
      columns: null,            // max cards per row (wraps to fewer below minCardWidth); null = auto-fill
      minCardWidth: 180,        // px
      variant: 'classic',       // classic (framed, centred) | minimal (top rule, left-aligned)
      sort: 'newest',           // newest | oldest | value | null (data order)
      max: null,                // show the first N cards (after sorting)
      highlight: null,          // company name(s): cards where either party matches get the accent2 treatment
      facets: ['sector', 'region'],   // chip rows that cross-filter (channel or field names); [] = none
      selectionMode: 'dim',     // dim | hide — cards outside the chip selection
      monogram: 'accent',       // accent | palette | false — initials tiles in place of logos
      showDescription: false,   // description line on the card (always in the tooltip)
      showRole: true,
      format: null,             // value format (defaults to the value field format)
      dateFormat: null,         // defaults to the date field format, else 'mmmm yyyy'
      missingValue: null,       // text for a missing value, e.g. 'Undisclosed' (default n.a.)
      wording: {},              // {'<deal type>': {lead: 'target'|'acquirer', verb, party, solo}} overrides
      tooltip: true,
      crossFilterScope: 'global'   // global: chips filter every dataset with a sector / region field | dataset
    },
    render: function (ctx) {
      var cur = ctx, first = true, tip = null, facetEls = [];
      ctx.el.classList.add('is-auto');
      var facetsBar = h('div.rk-tomb__facets.rk-noprint', { role: 'toolbar', 'aria-label': 'Filter credentials' });
      var grid = h('div.rk-tomb__grid', { role: 'list' });
      var root = h('div.rk-tomb', facetsBar, grid);
      ctx.el.appendChild(root);

      function facetFields(c) {
        return [].concat(c.options.facets || []).map(function (f) { return c.enc[f] || f; })
          .filter(function (f, i, a) { return f && c.dataset.has(f) && a.indexOf(f) === i; });
      }
      function highlights(c) { return (c.options.highlight == null ? [] : [].concat(c.options.highlight)).map(function (s) { return String(s).toLowerCase(); }); }

      /** Is a row inside the chip selection (every facet with a selection must match)? */
      function inSelection(r, c) {
        return facetFields(c).every(function (f) {
          var sel = c.selected(f);
          return !sel.length || sel.indexOf(r[f]) >= 0;
        });
      }

      function sortedRows(c) {
        var o = c.options, enc = c.enc, list = c.rows.slice();
        if (o.selectionMode === 'hide') list = list.filter(function (r) { return inSelection(r, c); });
        function d(r) { var x = RK.format.toDate(r[enc.date]); return x ? x.getTime() : -Infinity; }
        if (o.sort === 'newest' || o.sort === 'oldest') {
          var dir = o.sort === 'newest' ? -1 : 1;
          list.sort(function (a, b) { return (d(a) - d(b)) * dir || 0; });
        } else if (o.sort === 'value') {
          list.sort(function (a, b) {
            var x = a[enc.value], y = b[enc.value];
            if (!util.isNum(x)) return util.isNum(y) ? 1 : 0;
            if (!util.isNum(y)) return -1;
            return y - x;
          });
        }
        return o.max ? list.slice(0, o.max) : list;
      }

      function keyOf(r, c) {
        var e = c.enc;
        return [r[e.date], r[e.target], r[e.acquirer], r[e.type]].join('|');
      }

      /** Monogram tile; palette mode hashes the name onto the theme palette (accent2 stays reserved). */
      function tile(name, isLead, isHl, c) {
        var mode = c.options.monogram;
        if (!mode || !name) return null;
        var text = initials(name), style = null;
        if (mode === 'palette') {
          var pal = RK.theme.palette({ n: 8 }), bg = isHl ? c.theme.accent2 : pal[hash(name) % pal.length];
          style = { background: bg, color: RK.theme.textOn(bg), 'border-color': bg };
        } else if (isHl) {
          style = { background: c.theme.accent2, color: RK.theme.textOn(c.theme.accent2), 'border-color': c.theme.accent2 };
        }
        return h('span.rk-tomb__mono', { class: (isLead ? 'is-lead' : 'is-party') + (style ? ' is-filled' : ''), style: style, 'aria-hidden': 'true' }, text);
      }

      function card(r, i, c) {
        var o = c.options, enc = c.enc, d = describe(r, c);
        var hl = highlights(c);
        function isHl(n) { return n != null && hl.indexOf(String(n).toLowerCase()) >= 0; }
        var hot = isHl(d.lead) || isHl(d.party);
        var vf = o.format || c.fmtOf(enc.value) || '$#,##0.0"bn"';
        var df = o.dateFormat || c.fmtOf(enc.date) || 'mmmm yyyy';
        var value = r[enc.value];
        var valueText = (value == null || value === '') && o.missingValue != null ? o.missingValue : RK.format(value, vf);
        var dateText = r[enc.date] == null ? RK.format(null) : RK.format(r[enc.date], RK.format.isDateCode(df) ? df : 'mmmm yyyy');
        var logos = o.monogram ? h('div.rk-tomb__logos', tile(d.lead, true, isHl(d.lead), c), d.party ? tile(d.party, false, isHl(d.party), c) : null) : null;
        var desc = enc.description ? r[enc.description] : null;
        var el = h('article.rk-tomb__card', {
          role: 'listitem',
          tabindex: '0',
          class: (hot ? 'is-hl' : '') + (inSelection(r, c) ? '' : ' is-dim'),
          style: { '--rk-i': Math.min(i, 24) },
          'aria-label': [r[enc.type], d.lead, d.verb || d.solo, d.party, valueText, dateText, r[enc.role]].filter(Boolean).join(', ')
        },
          h('div.rk-tomb__kicker', { title: r[enc.type] || '' }, r[enc.type] || ''),
          logos,
          h('div.rk-tomb__names',
            h('div.rk-tomb__lead', { title: d.lead }, d.lead),
            d.verb ? h('div.rk-tomb__verb', d.verb) : d.solo ? h('div.rk-tomb__verb', d.solo) : null,
            d.party ? h('div.rk-tomb__party', { title: d.party }, d.party) : null,
            o.showDescription && desc ? h('div.rk-tomb__desc', desc) : null),
          h('div.rk-tomb__value.rk-num', valueText),
          h('div.rk-tomb__date.rk-num', dateText),
          o.showRole !== false && enc.role && r[enc.role] ? h('div.rk-tomb__role', { title: r[enc.role] }, r[enc.role]) : null);
        el.dataset.key = keyOf(r, c);
        el._rkRow = r;
        return el;
      }

      /* ---------- facet chips (cross-filter) ---------- */
      function drawFacets(c) {
        var fields = facetFields(c);
        facetsBar.innerHTML = '';
        facetEls = [];
        facetsBar.hidden = !fields.length || c.print;
        if (facetsBar.hidden) return;
        fields.forEach(function (f) {
          var values = c.dataset.distinct(f).slice().sort(function (a, b) { return String(a).localeCompare(String(b)); });
          var chips = values.map(function (v) {
            var n = h('span.rk-tomb__n.rk-num');
            var b = h('button.rk-tomb__chip', { type: 'button', 'aria-pressed': 'false' }, h('span', String(v)), n);
            b._rkField = f; b._rkValue = v; b._rkN = n;
            return b;
          });
          facetEls = facetEls.concat(chips);
          facetsBar.appendChild(h('div.rk-tomb__facet', h('span.rk-tomb__flabel', c.title(f)), chips));
        });
        var clear = h('button.rk-tomb__clear', { type: 'button', hidden: true }, 'Clear');
        clear._rkClear = true;
        facetsBar.appendChild(clear);
        styleFacets(c);
      }
      function styleFacets(c) {
        var any = false;
        facetEls.forEach(function (b) {
          var sel = c.selected(b._rkField), on = sel.indexOf(b._rkValue) >= 0;
          var n = c.rows.filter(function (r) { return r[b._rkField] === b._rkValue; }).length;
          if (sel.length) any = true;
          b.classList.toggle('is-on', on);
          b.classList.toggle('is-empty', !n && !on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          b._rkN.textContent = RK.format(n, '#,##0');
        });
        var clear = facetsBar.querySelector('.rk-tomb__clear');
        if (clear) clear.hidden = !any;
      }
      function onFacet(e) {
        var b = e.target.closest('button');
        if (!b) return;
        var scope = cur.options.crossFilterScope === 'dataset' ? { scope: 'dataset' } : { scope: 'global' };
        if (b._rkClear) { cur.clearSelection(); return; }
        if (b._rkField) cur.select(b._rkField, b._rkValue, scope);
      }
      facetsBar.addEventListener('click', onFacet);

      /* ---------- grid ---------- */
      function layoutGrid(c) {
        var o = c.options;
        root.className = 'rk-tomb rk-tomb--' + (o.variant === 'minimal' ? 'minimal' : 'classic') + (c.motion ? ' is-motion' : '') + (first && c.motion ? ' is-first' : '');
        grid.style.setProperty('--rk-tomb-min', Math.max(120, +o.minCardWidth || 180) + 'px');
        if (o.columns) { grid.classList.add('has-cols'); grid.style.setProperty('--rk-tomb-cols', Math.max(1, Math.round(o.columns))); }
        else { grid.classList.remove('has-cols'); grid.style.removeProperty('--rk-tomb-cols'); }
      }

      /** Rebuild the cards; keyed cards glide from their old cell (2-D FLIP), new ones fade in. */
      function draw(c, animate) {
        var list = sortedRows(c);
        function rebuild() {
          grid.innerHTML = '';
          list.forEach(function (r, i) { grid.appendChild(card(r, i, c)); });
        }
        if (!animate || !c.motion) { rebuild(); return; }
        var before = new Map();
        Array.prototype.forEach.call(grid.children, function (el) { before.set(el.dataset.key, el.getBoundingClientRect()); });
        rebuild();
        var moved = [];
        Array.prototype.forEach.call(grid.children, function (el) {
          var b = before.get(el.dataset.key);
          if (!b) { el.classList.add('is-enter'); return; }
          var r = el.getBoundingClientRect(), dx = b.left - r.left, dy = b.top - r.top;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
          el.style.transition = 'none';
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
          moved.push(el);
        });
        if (!moved.length) return;
        void grid.offsetWidth;   // commit the inverted positions before releasing them
        moved.forEach(function (el) { el.style.transition = ''; el.style.transform = ''; });
      }

      /** Selection-only change: toggle dimming in place so it animates (and keeps keyboard focus). */
      function restyle(c) {
        Array.prototype.forEach.call(grid.children, function (el) { el.classList.toggle('is-dim', !inSelection(el._rkRow, c)); });
        styleFacets(c);
      }

      /* ---------- tooltip ---------- */
      function tipHTML(el) {
        var r = el._rkRow, c = cur, enc = c.enc, d = describe(r, c);
        var vf = c.options.format || c.fmtOf(enc.value) || '$#,##0.0"bn"';
        var rows = [
          { label: c.title(enc.type), value: r[enc.type] || RK.format(null) },
          { label: c.title(enc.value), value: (r[enc.value] == null && c.options.missingValue != null) ? c.options.missingValue : RK.format(r[enc.value], vf) },
          { label: c.title(enc.date), value: RK.format(r[enc.date], 'dd mmm yyyy') }
        ];
        [enc.sector, enc.region, enc.role].forEach(function (f) { if (f && c.dataset.has(f) && r[f] != null) rows.push({ label: c.title(f), value: r[f] }); });
        var title = d.party ? d.lead + ' / ' + d.party : d.lead;
        return RK.chart.tip(title, rows, enc.description ? r[enc.description] : null);
      }
      function onOver(e) {
        if (cur.options.tooltip === false || cur.print) return;
        var el = e.target.closest('.rk-tomb__card');
        if (!el || el._rkTip) return;
        Array.prototype.forEach.call(grid.children, function (x) { x._rkTip = false; });
        el._rkTip = true;
        if (!tip) {
          tip = RK.ui.tip();
          tip.el.style.whiteSpace = 'normal';       // descriptions wrap
          tip.el.style.maxWidth = '320px';
        }
        tip.show(tipHTML(el), el);
      }
      function onOut(e) {
        var el = e.target.closest('.rk-tomb__card');
        if (el && e.relatedTarget && el.contains(e.relatedTarget)) return;
        if (el) el._rkTip = false;
        if (tip) tip.hide();
      }
      grid.addEventListener('mouseover', onOver);
      grid.addEventListener('mouseout', onOut);
      grid.addEventListener('focusin', onOver);
      grid.addEventListener('focusout', onOut);

      function sameRows(a, b) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      }

      layoutGrid(ctx);
      drawFacets(ctx);
      draw(ctx, false);
      first = false;

      return {
        update: function (c) {
          var selOnly = sameRows(cur.rows, c.rows) && c.options.selectionMode !== 'hide';
          cur = c;
          if (tip) tip.hide();
          layoutGrid(c);
          if (selOnly) restyle(c);
          else { draw(c, true); styleFacets(c); }
        },
        destroy: function () {
          facetsBar.removeEventListener('click', onFacet);
          grid.removeEventListener('mouseover', onOver);
          grid.removeEventListener('mouseout', onOut);
          grid.removeEventListener('focusin', onOver);
          grid.removeEventListener('focusout', onOut);
          if (tip) tip.destroy();
          root.remove();
          cur.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
