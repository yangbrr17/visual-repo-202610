/*!
 * RK component: comps-table — pitchbook trading / transaction comparables table.
 * Multi-level column headers, section rows (groupBy), mean / median / high / low rows (overall
 * and / or per section, target excluded), target highlight, heat-mapped columns, n.m. ranges,
 * sortable headers (rows sort within their section), sticky header + first column, footnote
 * markers, click a row to cross-filter. Pure DOM on the shared .rk-table styles; rows reveal
 * with a short stagger and glide to their new position (FLIP) on sort / filter.
 */
(function () {
  'use strict';
  var util = RK.util, h = util.h;

  var STATS = {
    mean: { fn: 'avg', label: 'Mean' },
    median: { fn: 'median', label: 'Median' },
    high: { fn: 'max', label: 'High' },
    low: { fn: 'min', label: 'Low' }
  };
  STATS.average = STATS.mean; STATS.max = STATS.high; STATS.min = STATS.low;

  function truthy(v) { return v === true || v === 1 || v === 'true' || v === 'Y' || v === 'yes'; }
  // generic field names (link tables, bridges...) cross-filter only this dataset (house rule: scoped selections)
  var GENERIC = /^(type|kind|source|target|step|stage|metric|status|name|label|key|id|category|group|series)$/i;

  /** Value outside the column's meaningful range (e.g. P/E < 0x or > 50x) -> "n.m.". */
  function isNM(c, v) {
    return !!c.nm && util.isNum(v) && ((c.nm[0] != null && v < c.nm[0]) || (c.nm[1] != null && v > c.nm[1]));
  }
  function cellText(c, v) {
    if (typeof v === 'number' && !isFinite(v)) return RK.format.config.nm;
    return isNM(c, v) ? RK.format.config.nm : RK.format(v, c.format);
  }
  function numbersOf(rows, c) {
    var out = [];
    rows.forEach(function (r) { var v = r[c.field]; if (util.isNum(v) && !isNM(c, v)) out.push(v); });
    return out;
  }

  /** options.columns -> normalised column specs; the label column is prepended unless listed. */
  function columnsOf(ctx) {
    var o = ctx.options, enc = ctx.enc;
    var list = o.columns && o.columns.length ? o.columns : null;
    if (!list) {
      var skip = [enc.label, enc.highlight, enc.note, o.groupBy];
      list = ctx.dataset.fields.filter(function (f) { return f.type === 'number' && skip.indexOf(f.name) < 0; })
        .map(function (f) { return f.name; });
    }
    var cols = list.map(function (c) {
      c = typeof c === 'string' ? { field: c } : util.merge({}, c);
      var f = ctx.field(c.field) || { name: c.field, type: 'number' };
      c.type = c.type || f.type;
      c.num = c.type === 'number';
      c.isLabel = c.field === enc.label;
      if (c.expr) {
        // derived column, e.g. {field: 'pct_high', expr: 'share_price / price_52w_high', format: '0%'}
        c.compiled = RK.expr.compile(c.expr, { fields: ctx.dataset.fields });
        c.type = c.type || 'number';
      }
      if (c.title == null) c.title = c.isLabel && o.labelTitle != null ? o.labelTitle : (c.expr && !ctx.field(c.field) ? c.field : ctx.title(c.field));
      c.format = c.format || f.format || (c.num ? '#,##0.0' : null);
      c.align = c.align || (c.num ? 'right' : 'left');
      if (c.isLabel && c.width == null) c.width = o.labelWidth;
      return c;
    });
    if (!cols.some(function (c) { return c.isLabel; })) {
      cols.unshift({
        field: enc.label, type: 'string', num: false, isLabel: true, align: 'left', width: o.labelWidth,
        title: o.labelTitle != null ? o.labelTitle : ctx.title(enc.label)
      });
    }
    cols[0].sticky = true;
    return cols;
  }

  /** Rows with derived (expr) columns materialised; source rows are left untouched. */
  function rowsOf(ctx, cols) {
    var derived = cols.filter(function (c) { return c.compiled; });
    if (!derived.length) return ctx.rows;
    var env = { params: RK.store.params() };
    return ctx.rows.map(function (r) {
      var o = util.merge({}, r);
      derived.forEach(function (c) {
        var v;
        try { v = c.compiled.eval(r, env); } catch (e) { v = null; }
        o[c.field] = v;
      });
      return o;
    });
  }

  /** Heat colour function for a column: light tints of the theme ramp + readable text colour. */
  function heatOf(ctx, c, rows) {
    if (!c.heat || !c.num) return null;
    var vals = numbersOf(rows, c);
    if (vals.length < 2) return null;
    var t = ctx.theme, ext = util.extent(vals);
    var stops = (c.heat === 'div' ? t.div : t.seq).slice();
    if (c.reverse) stops.reverse();
    var scale = c.heat === 'div'
      ? RK.theme.diverging(ext, c.mid != null ? c.mid : RK.expr.agg.median(vals), stops)
      : RK.theme.sequential(ext, stops);
    var k = ctx.options.heatIntensity;
    return function (v) {
      if (!util.isNum(v) || isNM(c, v)) return null;
      var fill = RK.theme.mix(t.paper, scale(v), k);
      return { bg: fill, fg: RK.theme.textOn(fill) };
    };
  }

  function sortRows(rows, sort, cols) {
    if (!sort || !sort.field) return rows;
    var c = cols.filter(function (x) { return x.field === sort.field; })[0] || { field: sort.field };
    var dir = sort.dir === 'asc' ? 1 : -1;
    function missing(v) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) || isNM(c, v); }
    return rows.slice().sort(function (a, b) {
      var x = a[sort.field], y = b[sort.field];
      if (missing(x) || missing(y)) return missing(x) === missing(y) ? 0 : (missing(x) ? 1 : -1); // n.a. always last
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  }

  /**
   * Flatten rows into the display sequence:
   *   [pinned target] [section, data..., section stats]... [overall stats] [pinned target]
   */
  function layout(ctx, rows, cols, sort) {
    var o = ctx.options, enc = ctx.enc;
    var marks = o.highlight == null ? [] : [].concat(o.highlight);
    var hasFlag = enc.highlight && ctx.dataset.has(enc.highlight);
    function isTarget(r) { return (hasFlag && truthy(r[enc.highlight])) || marks.indexOf(r[enc.label]) >= 0; }
    function statPool(list) { return o.statsExcludeTarget ? list.filter(function (r) { return !isTarget(r); }) : list; }
    function dataSpec(r) { return { kind: 'data', key: 'r:' + r[enc.label], row: r, target: isTarget(r) }; }

    var out = [];
    var pinned = o.pinTarget ? rows.filter(isTarget) : [];
    var rest = o.pinTarget ? rows.filter(function (r) { return !isTarget(r); }) : rows;
    var scope = o.groupBy ? o.statsScope : 'overall';
    var stats = (o.stats || []).filter(function (s) { return STATS[s]; });
    var gStats = (o.groupStats || o.stats || []).filter(function (s) { return STATS[s]; });

    if (o.pinTarget === 'top') pinned.forEach(function (r) { out.push(dataSpec(r)); });
    if (o.groupBy) {
      util.groupBy(rest, function (r) { return r[o.groupBy]; }).forEach(function (g, name) {
        out.push({ kind: 'section', key: 's:' + name, label: name == null || name === '' ? 'Other' : name });
        sortRows(g, sort, cols).forEach(function (r) { out.push(dataSpec(r)); });
        if (scope === 'group' || scope === 'both') {
          var pool = statPool(g);
          gStats.forEach(function (s, i) {
            out.push({ kind: 'stat', key: 'g:' + name + ':' + s, stat: s, rows: pool, sub: true, first: i === 0, label: STATS[s].label });
          });
        }
      });
    } else {
      sortRows(rest, sort, cols).forEach(function (r) { out.push(dataSpec(r)); });
    }
    if (scope === 'overall' || scope === 'both') {
      var all = statPool(rows);
      stats.forEach(function (s, i) {
        var lab = STATS[s].label;
        out.push({ kind: 'stat', key: 'o:' + s, stat: s, rows: all, first: i === 0, foot: true, label: scope === 'both' ? 'Overall ' + lab.toLowerCase() : lab });
      });
    }
    if (o.pinTarget === 'bottom') pinned.forEach(function (r) { var d = dataSpec(r); d.pinnedBottom = d.foot = true; out.push(d); });
    return out;
  }

  RK.component({
    id: 'comps-table',
    deps: [],
    defaults: {
      encode: { label: 'company', highlight: 'is_target', note: null },
      columns: null,              // [{field, expr, title, format, group, heat, mid, reverse, nm, sign, stats, align, width, note}]
      groupBy: null,              // field -> section header rows (e.g. sector)
      stats: ['mean', 'median'],  // mean | median | high | low
      statsScope: 'overall',      // overall | group | both (group / both need groupBy)
      groupStats: null,           // stats shown per section (defaults to stats)
      statsExcludeTarget: true,
      highlight: null,            // label value(s) to highlight, in addition to encode.highlight
      pinTarget: false,           // false | 'top' | 'bottom' — lift the target out of its section
      labelTitle: null,
      labelWidth: null,
      notes: {},                  // {"<label value>": "(1)"} footnote markers after row labels
      sort: null,                 // {field, dir: 'asc' | 'desc'} initial sort (within sections)
      sortable: true,
      heatIntensity: 0.5,         // 0..1 strength of heat tints
      scroll: true,               // true: fixed block height, sticky header; false: grow to content
      dense: false,
      stagger: true,
      crossFilter: true
    },
    render: function (ctx) {
      var cur = ctx, first = true;
      var sort = ctx.options.sort ? util.merge({}, ctx.options.sort) : null;
      var auto = !ctx.options.scroll || ctx.print;
      if (auto) ctx.el.classList.add('is-auto');

      // overall statistics live in <tfoot>, which stays pinned to the bottom while the body scrolls
      var thead = h('thead'), tbody = h('tbody'), tfoot = h('tfoot');
      var table = h('table.rk-table', thead, tbody, tfoot);
      var root = h('div.rk-comps', { class: (ctx.options.dense ? 'rk-comps--dense ' : '') + (auto ? 'is-auto' : '') },
        h('div.rk-comps__scroll', table));
      ctx.el.appendChild(root);

      /* ---------------- header ---------------- */
      function drawHead(cols) {
        var o = cur.options;
        var grouped = cols.some(function (c) { return c.group; });
        var top = h('tr.rk-table__group'), bottom = h('tr');
        thead.innerHTML = '';
        function titleCell(c, span) {
          var sortable = o.sortable !== false && c.sortable !== false;
          var on = sort && sort.field === c.field;
          var ind = h('span.rk-sort', { 'aria-hidden': 'true' }, on ? (sort.dir === 'asc' ? '▲' : '▼') : '');
          var th = h('th', {
            class: [c.num ? 'is-num' : '', c.isLabel ? 'rk-comps__label' : '', c.sticky ? 'is-sticky' : '', sortable ? 'is-sortable' : '', on ? 'is-sorted' : ''].join(' '),
            rowspan: span > 1 ? span : null,
            scope: 'col',
            'aria-sort': on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null,
            style: util.merge(c.width ? { width: typeof c.width === 'number' ? c.width + 'px' : c.width } : {}, { 'text-align': c.align }),
            dataset: sortable ? { field: c.field } : null
          }, c.align === 'right' ? ind : null, c.title,
            c.note ? h('sup.rk-comps__fn', c.note) : null,
            c.align !== 'right' ? ind : null);
          return th;
        }
        if (!grouped) {
          cols.forEach(function (c) { bottom.appendChild(titleCell(c, 1)); });
          thead.appendChild(bottom);
          return;
        }
        // contiguous columns sharing a group label share one spanning header cell
        for (var i = 0; i < cols.length; i++) {
          var c = cols[i];
          if (!c.group) { top.appendChild(titleCell(c, 2)); continue; }
          var n = 1;
          while (i + n < cols.length && cols[i + n].group === c.group) n++;
          top.appendChild(h('th.rk-comps__grp', { colspan: n, scope: 'colgroup' }, h('span', c.group)));
          for (var j = 0; j < n; j++) bottom.appendChild(titleCell(cols[i + j], 1));
          i += n - 1;
        }
        thead.appendChild(top);
        thead.appendChild(bottom);
      }

      /* ---------------- body ---------------- */
      function drawBody(cols, animate) {
        var c0 = cur, o = c0.options, enc = c0.enc;
        var rows = rowsOf(c0, cols);
        var seq = layout(c0, rows, cols, sort);
        var heats = {};
        cols.forEach(function (c) { heats[c.field] = heatOf(c0, c, rows); });
        var sel = c0.selected(enc.label);
        var clickable = o.crossFilter !== false;
        root.classList.toggle('has-sel', sel.length > 0);
        if (animate) RK.motion.flip([tbody, tfoot], paint); else paint();

        function paint() {
          tbody.innerHTML = '';
          tfoot.innerHTML = '';
          seq.forEach(row);
        }
        function row(s, idx) {
          var tr;
          if (s.kind === 'section') {
            tr = h('tr.is-section', h('td', { colspan: cols.length }, h('span.rk-comps__sec', s.label)));
          } else if (s.kind === 'stat') {
            // the statistic label spans the leading text columns (date / target / acquirer ...)
            var lead = 0;
            while (lead < cols.length && !(cols[lead].num && cols[lead].stats !== false && !cols[lead].isLabel)) lead++;
            lead = Math.max(1, lead);
            tr = h('tr.is-stat', { class: (s.sub ? 'is-substat ' : '') + (s.first ? 'is-stat-first' : '') },
              h('td.rk-comps__label', { colspan: lead > 1 ? lead : null, class: lead === 1 ? 'is-sticky' : null }, s.label),
              cols.slice(lead).map(function (c) {
                if (!c.num || c.stats === false) return h('td', { class: c.num ? 'is-num' : null });
                var vals = numbersOf(s.rows, c);
                var v = vals.length ? RK.expr.agg[STATS[s.stat].fn](vals) : null;
                return h('td.is-num', { style: { 'text-align': c.align } }, RK.format(v, c.format));
              }));
          } else {
            var r = s.row, label = r[enc.label];
            var mark = (o.notes && o.notes[label]) || (enc.note ? r[enc.note] : null);
            var on = sel.indexOf(label) >= 0;
            tr = h('tr.is-data', {
              class: (s.target ? 'is-target ' : '') + (on ? 'is-selected ' : '') + (s.pinnedBottom ? 'is-pinned-bottom' : ''),
              tabindex: clickable ? '0' : null,
              'aria-selected': clickable ? String(on) : null
            }, cols.map(function (c) {
              var v = r[c.field];
              if (c.isLabel) {
                return h('td.rk-comps__label', { class: c.sticky ? 'is-sticky' : null, title: String(label == null ? '' : label) },
                  h('span.rk-comps__name', cellText(c, v)), mark ? h('sup.rk-comps__fn', String(mark)) : null);
              }
              var heat = heats[c.field] && heats[c.field](v);
              var cls = [c.num ? 'is-num' : '', c.sticky ? 'is-sticky' : ''];
              if (c.sign && util.isNum(v) && !isNM(c, v)) cls.push(v < 0 ? 'is-neg' : v > 0 ? 'is-pos' : '');
              if (heat) cls.push('is-heat');
              return h('td', {
                class: cls.join(' '),
                style: util.merge({ 'text-align': c.align }, heat ? { 'background-color': heat.bg, color: heat.fg } : {})
              }, cellText(c, v));
            }));
            tr._rkValue = label;
          }
          tr.dataset.key = s.key;
          if (first && c0.motion && o.stagger) {
            tr.classList.add('is-in');
            tr.style.setProperty('--rk-i', Math.min(idx, 40));
          }
          (s.foot ? tfoot : tbody).appendChild(tr);
        }
      }
      function bodyRows() { return Array.prototype.slice.call(tbody.children).concat(Array.prototype.slice.call(tfoot.children)); }

      function draw(animate) {
        var cols = columnsOf(cur);
        drawHead(cols);
        drawBody(cols, animate && cur.motion);
        first = false;
      }

      /* ---------------- interactions ---------------- */
      function onHeadClick(e) {
        var th = e.target.closest('th[data-field]');
        if (!th) return;
        var f = th.dataset.field, c = (columnsOf(cur).filter(function (x) { return x.field === f; })[0]) || {};
        // numbers start descending (largest first), text ascending; third click restores data order
        var firstDir = c.num ? 'desc' : 'asc', other = firstDir === 'asc' ? 'desc' : 'asc';
        if (!sort || sort.field !== f) sort = { field: f, dir: firstDir };
        else if (sort.dir === firstDir) sort.dir = other;
        else sort = null;
        draw(true);
      }
      function pick(tr) {
        if (!tr || cur.options.crossFilter === false || !tr.classList.contains('is-data')) return;
        var f = cur.enc.label;
        cur.select(f, tr._rkValue, GENERIC.test(f) && !cur.options.crossFilterScope ? { scope: 'dataset' } : null);
      }
      function onBodyClick(e) { pick(e.target.closest('tr')); }
      var bodies = [tbody, tfoot];
      function onKey(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tr = e.target.closest('tr');
        if (tr && tr.classList.contains('is-data')) { e.preventDefault(); pick(tr); }
      }
      thead.addEventListener('click', onHeadClick);
      bodies.forEach(function (b) { b.addEventListener('click', onBodyClick); b.addEventListener('keydown', onKey); });

      /* selection-only change (same rows): toggle classes so the dimming animates */
      function sameRows(a, b) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      }
      function selKey(c) { return JSON.stringify(c.selected(c.enc.label)); }
      function restyle() {
        var sel = cur.selected(cur.enc.label);
        root.classList.toggle('has-sel', sel.length > 0);
        bodyRows().forEach(function (tr) {
          if (!tr.classList.contains('is-data')) return;
          var on = sel.indexOf(tr._rkValue) >= 0;
          tr.classList.toggle('is-selected', on);
          if (tr.hasAttribute('aria-selected')) tr.setAttribute('aria-selected', String(on));
        });
      }

      draw(false);

      return {
        update: function (c) {
          var selOnly = sameRows(cur.rows, c.rows) && selKey(cur) !== selKey(c);
          cur = c;
          if (selOnly) restyle(); else draw(true);
        },
        destroy: function () {
          thead.removeEventListener('click', onHeadClick);
          bodies.forEach(function (b) { b.removeEventListener('click', onBodyClick); b.removeEventListener('keydown', onKey); });
          root.remove();
          if (auto) cur.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
