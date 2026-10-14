/*!
 * RK component: league-table — ranked adviser / investor / acquirer list: rank, rank change vs
 * prior period (▲ / ▼ / – / New), name, inline bar of the ranking value, market share and deal
 * count. Highlight a name (kept visible below the cut when outside the top-N), click a row to
 * cross-filter, sortable metric headers. Pure DOM: bars grow with a stagger while the values count
 * up; on filter / sort changes bars re-scale and rows glide to their new position (FLIP).
 */
(function () {
  'use strict';
  var util = RK.util, h = util.h;
  // generic field names (link tables, bridges...) cross-filter only this dataset (house rule: scoped selections)
  var GENERIC = /^(type|kind|source|target|step|stage|metric|status|name|label|key|id|category|group|series)$/i;
  var CCY = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };

  /** Unit implied by a value format ('$#,##0.0"bn"' -> 'USD bn'), so the header carries it like the cells. */
  function unitOf(fmt) {
    var c = String((fmt && RK.format.presets[fmt]) || fmt || '');
    var cur = c.replace(/"[^"]*"/g, '').match(/[$€£¥]/), suf = c.match(/"\s*(tn|bn|mm|m|k)\s*"/i);
    if (!cur && !suf) return null;
    return [cur ? CCY[cur[0]] : null, suf ? suf[1] : null].filter(Boolean).join(' ');
  }

  RK.component({
    id: 'league-table',
    deps: [],
    defaults: {
      encode: { rank: 'rank', name: 'bank', value: 'deal_value_bn', share: 'market_share', count: 'deals', prior: 'prior_rank' },
      highlight: null,        // name(s) drawn in the highlight accent (e.g. your bank)
      top: 10,                // top-N rows; null = all
      pinHighlight: true,     // keep highlighted names visible below the top-N cut
      rerank: false,          // true: rank by value instead of the rank field
      format: null,           // value format (defaults to the value field format)
      shareFormat: null,
      countFormat: null,
      sortable: true,         // click Value / Share / Deals headers to re-order
      showChange: true,       // rank change vs prior rank
      titles: {},             // {rank, name, value, share, count, change} header overrides
      crossFilter: true
    },
    render: function (ctx) {
      var cur = ctx, sort = null, first = true, prevVals = new Map();
      ctx.el.classList.add('is-auto');
      var thead = h('thead'), tbody = h('tbody');
      var table = h('table.rk-table.rk-league__table', thead, tbody);
      var root = h('div.rk-league', h('div.rk-league__scroll', table));   // narrow blocks scroll sideways instead of spilling out
      ctx.el.appendChild(root);

      function has(f) { return f && cur.dataset.has(f); }
      function fmtOf(ch, dflt) { return cur.options[ch + 'Format'] || cur.fmtOf(cur.enc[ch]) || dflt; }

      /** Ranked rows: rank (field or by value), top-N, pinned highlights, optional metric sort. */
      function rowsOf() {
        var o = cur.options, enc = cur.enc;
        var marks = o.highlight == null ? [] : [].concat(o.highlight);
        var list = cur.rows.map(function (r) {
          return { r: r, name: r[enc.name], value: r[enc.value], rank: o.rerank || !has(enc.rank) ? null : r[enc.rank], hi: marks.indexOf(r[enc.name]) >= 0 };
        });
        if (o.rerank || !has(enc.rank)) {
          list.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); }).forEach(function (d, i) { d.rank = i + 1; });
        }
        list.sort(function (a, b) { return (a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank); });
        var shown = o.top ? list.slice(0, o.top) : list;
        var pinned = o.top && o.pinHighlight ? list.slice(o.top).filter(function (d) { return d.hi; }) : [];
        if (sort) {
          var f = enc[sort.ch], dir = sort.dir === 'asc' ? 1 : -1;
          shown = shown.slice().sort(function (a, b) {
            var x = a.r[f], y = b.r[f];
            if (x == null) return 1;
            if (y == null) return -1;
            return (x - y) * dir;
          });
        }
        pinned.forEach(function (d) { d.pinned = true; });
        return shown.concat(pinned);
      }

      function changeCell(d) {
        var p = cur.enc.prior ? d.r[cur.enc.prior] : undefined;
        if (p === undefined) return h('td.rk-league__chg');
        if (p == null || !util.isNum(p)) return h('td.rk-league__chg.is-new', 'New');
        var delta = p - d.rank;
        if (!delta) return h('td.rk-league__chg.is-flat', { title: 'Unchanged vs prior rank' }, '–');
        return h('td.rk-league__chg', { class: delta > 0 ? 'is-up' : 'is-down', title: 'Prior rank ' + p },
          h('span.rk-league__arr', { 'aria-hidden': 'true' }, delta > 0 ? '▲' : '▼'), String(Math.abs(delta)));
      }

      function drawHead() {
        var o = cur.options, enc = cur.enc, T = o.titles || {};
        function th(ch, cls, text) {
          var on = sort && sort.ch === ch, sortable = o.sortable !== false && (ch === 'value' || ch === 'share' || ch === 'count');
          // numeric headers sit flush with their figures: the sort glyph goes left of the text and takes no room until sorted
          var num = / is-num|^is-num/.test(cls);
          var glyph = sortable ? h('span.rk-sort', { 'aria-hidden': 'true' }, on ? (sort.dir === 'asc' ? '▲' : '▼') : '') : null;
          return h('th', {
            class: cls + (sortable ? ' is-sortable' : '') + (on ? ' is-sorted' : ''),
            scope: 'col',
            dataset: sortable ? { ch: ch } : null,
            'aria-sort': on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null
          }, num ? glyph : null, String(text == null ? '' : text), num ? null : glyph);
        }
        var vTitle = T.value || cur.title(enc.value), unit = unitOf(o.format || cur.fmtOf(enc.value));
        if (!T.value && unit && !/\(/.test(vTitle)) vTitle += ' (' + unit + ')';
        var showChg = o.showChange !== false && has(enc.prior);
        thead.innerHTML = '';
        thead.appendChild(h('tr',
          h('th.rk-league__rank.is-num', { scope: 'col' }, T.rank || 'Rank'),
          showChg ? h('th.rk-league__chg', { scope: 'col', title: 'Change vs prior rank' }, T.change || '+/–') : null,
          h('th.rk-league__name', { scope: 'col' }, T.name || cur.title(enc.name)),
          th('value', 'rk-league__bar', vTitle),
          has(enc.share) ? th('share', 'is-num rk-league__share', T.share || cur.title(enc.share)) : null,
          has(enc.count) ? th('count', 'is-num rk-league__count', T.count || cur.title(enc.count)) : null));
        root.classList.toggle('no-chg', !showChg);
      }

      function draw(animate) {
        var o = cur.options, enc = cur.enc;
        var list = rowsOf();
        var vf = o.format || cur.fmtOf(enc.value) || '#,##0.0';
        var sf = fmtOf('share', '0.0%'), cf = fmtOf('count', '#,##0');
        var max = Math.max.apply(null, list.map(function (d) { return util.isNum(d.value) ? d.value : 0; }).concat([0])) || 1;
        var sel = cur.selected(enc.name);
        var showChg = o.showChange !== false && has(enc.prior);
        var nCols = 2 + (showChg ? 1 : 0) + 1 + (has(enc.share) ? 1 : 0) + (has(enc.count) ? 1 : 0);
        var next = new Map(), bars = [];
        drawHead();
        root.classList.toggle('has-sel', sel.length > 0);
        if (animate && cur.motion) RK.motion.flip(tbody, paint); else paint();
        function paint() {
          tbody.innerHTML = '';
          list.forEach(function (d, i) {
            // gap marker before a highlight pinned below the cut: "··· ranks 6–10"
            if (d.pinned && (i === 0 || !list[i - 1].pinned)) {
              var prev = i > 0 ? list[i - 1].rank : 0, from = (util.isNum(prev) ? prev : 0) + 1, to = util.isNum(d.rank) ? d.rank - 1 : null;
              if (to == null || to >= from) {
                var gap = h('tr.rk-league__gap', { 'aria-hidden': 'true' },
                  h('td', { colspan: nCols }, h('span.rk-league__dots', '⋯'),
                    to == null ? '' : (to > from ? 'ranks ' + from + '–' + to : 'rank ' + from)));
                gap.dataset.key = 'gap';
                tbody.appendChild(gap);
              }
            }
            row(d, i);
          });
        }
        function row(d, i) {
          var pct = util.isNum(d.value) ? Math.max(0, d.value) / max * 100 : 0;
          var fill = h('i.rk-league__fill');
          var val = h('span.rk-league__val');
          var tr = h('tr', {
            class: [d.hi ? 'is-target' : '', d.pinned ? 'is-pinned' : '', sel.indexOf(d.name) >= 0 ? 'is-selected' : '',
              o.crossFilter !== false ? 'is-clickable' : ''].join(' '),
            tabindex: o.crossFilter !== false ? '0' : null,
            style: { '--rk-i': Math.min(i, 30) }
          },
            h('td.rk-league__rank.is-num', d.rank == null ? '' : String(d.rank)),
            showChg ? changeCell(d) : null,
            h('td.rk-league__name', { title: String(d.name == null ? '' : d.name) }, String(d.name == null ? '' : d.name)),
            h('td.rk-league__bar', h('div.rk-league__track', h('div.rk-league__lane', fill, val))),
            has(enc.share) ? h('td.is-num.rk-league__share', RK.format(d.r[enc.share], sf)) : null,
            has(enc.count) ? h('td.is-num.rk-league__count', RK.format(d.r[enc.count], cf)) : null);
          tr._rkName = d.name;
          tr.dataset.key = String(d.name);
          tbody.appendChild(tr);
          var from = prevVals.get(d.name);
          bars.push({ fill: fill, val: val, pct: pct, v: d.value, from: from == null ? null : from });
          next.set(d.name, { pct: pct, v: d.value });
        }
        // bars: grow from 0 (first paint) or from their previous width; values count along
        function size(b, pct) { b.fill.style.width = pct + '%'; b.val.style.left = 'calc(' + pct + '% + 6px)'; }
        bars.forEach(function (b) {
          if (!cur.motion) { size(b, b.pct); b.val.textContent = RK.format(b.v, vf); return; }
          size(b, b.from ? b.from.pct : 0);
          RK.motion.countUp(b.val, b.v, { format: vf, from: b.from ? b.from.v : 0, duration: first ? 1000 : 600 });
        });
        if (cur.motion) {
          root.classList.toggle('is-first', first);
          void tbody.offsetWidth;
          window.requestAnimationFrame(function () { bars.forEach(function (b) { size(b, b.pct); }); });
        }
        prevVals = next;
        first = false;
      }

      function onHead(e) {
        var th = e.target.closest('th[data-ch]');
        if (!th) return;
        var ch = th.dataset.ch;
        if (!sort || sort.ch !== ch) sort = { ch: ch, dir: 'desc' };
        else if (sort.dir === 'desc') sort.dir = 'asc';
        else sort = null;
        draw(true);
      }
      function pick(tr) {
        if (!tr || cur.options.crossFilter === false || tr._rkName == null) return;
        var f = cur.enc.name;
        cur.select(f, tr._rkName, GENERIC.test(f) && !cur.options.crossFilterScope ? { scope: 'dataset' } : null);
      }
      function onClick(e) { pick(e.target.closest('tr')); }
      function onKey(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tr = e.target.closest('tr');
        if (tr) { e.preventDefault(); pick(tr); }
      }
      thead.addEventListener('click', onHead);
      tbody.addEventListener('click', onClick);
      tbody.addEventListener('keydown', onKey);

      /* selection-only change (same rows): toggle classes so the dimming animates */
      function sameRows(a, b) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      }
      function selKey(c) { return JSON.stringify(c.selected(c.enc.name)); }
      function restyle() {
        var sel = cur.selected(cur.enc.name);
        root.classList.toggle('has-sel', sel.length > 0);
        Array.prototype.forEach.call(tbody.children, function (tr) { tr.classList.toggle('is-selected', sel.indexOf(tr._rkName) >= 0); });
      }

      draw(false);

      return {
        update: function (c) {
          var selOnly = sameRows(cur.rows, c.rows) && selKey(cur) !== selKey(c);
          cur = c;
          if (selOnly) restyle(); else draw(true);
        },
        destroy: function () {
          thead.removeEventListener('click', onHead);
          tbody.removeEventListener('click', onClick);
          tbody.removeEventListener('keydown', onKey);
          root.remove();
          cur.el.classList.remove('is-auto');
        }
      };
    }
  });

})();
