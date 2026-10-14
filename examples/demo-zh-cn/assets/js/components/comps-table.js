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

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'compsTable.high': '最高值', 'compsTable.low': '最低值', 'compsTable.overall': '整体{stat}'
    });
  }

  var STATS = {
    mean: { fn: 'avg', label: 'Mean' },
    median: { fn: 'median', label: 'Median' },
    high: { fn: 'max', label: 'High' },
    low: { fn: 'min', label: 'Low' }
  };
  STATS.average = STATS.mean; STATS.max = STATS.high; STATS.min = STATS.low;
  /** Statistic row label in the report locale. */
  function statLabel(s) {
    var fn = STATS[s].fn;
    return fn === 'avg' ? tr('mean', 'Mean') : fn === 'median' ? tr('median', 'Median') : fn === 'max' ? tr('compsTable.high', 'High') : tr('compsTable.low', 'Low');
  }

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

  /** Format sections of a code (split on ';' outside quotes). */
  function sections(code) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < code.length; i++) {
      var ch = code[i];
      if (ch === '"') q = !q;
      if (ch === ';' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function numericCode(code) {
    var c = code && (RK.format.presets[code] || code);
    return typeof c === 'string' && /[0#?]/.test(c.replace(/"[^"]*"/g, '')) && !RK.format.isDateCode(c) ? c : null;
  }
  /** Accounting negatives (house rule): '$#,##0' -> '$#,##0;($#,##0)'; an explicit '-' section -> parentheses. */
  function acct(code) {
    var c = numericCode(code);
    if (!c) return code;
    var s = sections(c);
    if (s.length === 1) return c + ';(' + c.replace(/^\+/, '') + ')';
    if (/^-/.test(s[1])) s[1] = '(' + s[1].slice(1) + ')';
    return s.join(';');
  }
  /** Signed change format: '+0.0%;(0.0%);0.0%' from a value format. */
  function signed(code) {
    var c = numericCode(code);
    if (!c) return code;
    var f = sections(c)[0].replace(/^\+/, '');
    return '+' + f + ';(' + f + ');' + f;
  }

  /** Readable text on a heat fill: the fill is nudged (away from the text colour) until contrast >= 4.5:1. */
  function readable(bg, t) {
    var T = RK.theme, dk = t.dark ? t.paper : t.ink, lt = t.dark ? t.ink : '#ffffff';
    for (var i = 0; i < 14; i++) {
      var cd = T.contrast(bg, dk), cl = T.contrast(bg, lt);
      if (Math.max(cd, cl) >= 4.5) return { bg: bg, fg: cd >= cl ? dk : lt };
      bg = T.mix(bg, cd >= cl ? lt : dk, 0.06);
    }
    return { bg: bg, fg: T.contrast(bg, dk) >= T.contrast(bg, lt) ? dk : lt };
  }
  /**
   * Heat scale on the theme ramp clamped to its inner stops (seq-2..seq-6 / div-2..div-6 at intensity 0.5):
   * the top bin stays chromatic (no mixing toward paper / grey) and the text keeps 4.5:1.
   */
  function heatScale(t, kind, domain, mid, intensity, reverse) {
    var all = (kind === 'div' ? t.div : t.seq).slice(), k = util.isNum(intensity) ? intensity : 0.5, stops;
    if (kind === 'div') {
      var c = Math.floor((all.length - 1) / 2), r = Math.max(1, Math.min(c, Math.round(k * 4)));
      stops = all.slice(c - r, c + r + 1);
    } else {
      stops = all.slice(1, Math.max(3, Math.min(all.length, Math.round(k * 10) + 1)));
    }
    if (reverse) stops.reverse();
    var sc = kind === 'div' ? RK.theme.diverging(domain, mid, stops) : RK.theme.sequential(domain, stops);
    return function (v) { return util.isNum(v) ? readable(sc(v), t) : null; };
  }

  /** Header text split into two balanced lines (at most two lines, never one word per line). */
  function balancedHalves(text) {
    var s = String(text == null ? '' : text), best = -1, mid = s.length / 2;
    if (s.length <= 12) return [s];
    for (var i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
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
      // negatives in parentheses; signed (change) columns carry an explicit '+'
      if (c.type === 'number') c.format = c.sign ? signed(c.format) : acct(c.format);
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
    var ext = util.extent(vals), kind = c.heat === 'div' ? 'div' : 'seq';
    var scale = heatScale(ctx.theme, kind, ext, c.mid != null ? c.mid : RK.expr.agg.median(vals), ctx.options.heatIntensity, c.reverse);
    return function (v) { return !util.isNum(v) || isNM(c, v) ? null : scale(v); };
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
        out.push({ kind: 'section', key: 's:' + name, label: name == null || name === '' ? tr('other', 'Other') : name });
        sortRows(g, sort, cols).forEach(function (r) { out.push(dataSpec(r)); });
        if (scope === 'group' || scope === 'both') {
          var pool = statPool(g);
          gStats.forEach(function (s, i) {
            out.push({ kind: 'stat', key: 'g:' + name + ':' + s, stat: s, rows: pool, sub: true, first: i === 0, label: statLabel(s) });
          });
        }
      });
    } else {
      sortRows(rest, sort, cols).forEach(function (r) { out.push(dataSpec(r)); });
    }
    if (scope === 'overall' || scope === 'both') {
      var all = statPool(rows);
      stats.forEach(function (s, i) {
        var lab = statLabel(s);
        out.push({ kind: 'stat', key: 'o:' + s, stat: s, rows: all, first: i === 0, foot: true, label: scope === 'both' ? tr('compsTable.overall', 'Overall {stat}', { stat: lab.toLowerCase() }) : lab });
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
      footnotes: {},              // {"(1)": "Pending completion"} note text, written to the block footer
      sort: null,                 // {field, dir: 'asc' | 'desc'} initial sort (within sections)
      sortable: true,
      heatIntensity: 0.5,         // 0..1 span of the theme ramp used by heat columns (0.5 = seq-2..seq-6)
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
      var scroller = h('div.rk-comps__scroll', table);
      var root = h('div.rk-comps', { class: (ctx.options.dense ? 'rk-comps--dense ' : '') + (auto ? 'is-auto' : '') }, scroller);
      ctx.el.appendChild(root);

      /* ---------------- horizontal scroll cue: edge fade + sticky-column shadow ---------------- */
      function edges() {
        var more = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 1;
        root.classList.toggle('is-more-r', more);
        root.classList.toggle('is-scrolled-x', scroller.scrollLeft > 1);
      }
      scroller.addEventListener('scroll', edges, { passive: true });

      /* ---------------- whole-row scroll window: no row is cut by the sticky statistics footer ---------------- */
      function snap() {
        scroller.style.height = '';
        if (auto) return;
        var avail = scroller.clientHeight, foot = tfoot.offsetHeight;
        if (table.offsetHeight <= avail + 1) return;
        var limit = avail - foot, best = 0, rows = tbody.children;
        for (var i = 0; i < rows.length; i++) {
          var b = rows[i].offsetTop + rows[i].offsetHeight;
          if (b > limit + 0.5) break;
          // never end the window on a section header (it would sit alone above the footer)
          if (!rows[i].classList.contains('is-section')) best = b;
        }
        if (best > 0) scroller.style.height = (best + foot + (scroller.offsetHeight - scroller.clientHeight)) + 'px';
      }

      /* ---------------- footnote text in the block footer ---------------- */
      var notesEl = null, madeFoot = null;
      function drawNotes() {
        var fn = cur.options.footnotes || {};
        var keys = Object.keys(fn).filter(function (k) { return fn[k] != null && fn[k] !== ''; });
        if (!keys.length) { if (notesEl) notesEl.remove(); notesEl = null; return; }
        if (!notesEl) {
          notesEl = h('p.rk-comps__notes');
          var blk = cur.block, foot = blk && blk !== cur.el ? blk.querySelector(':scope > .rk-block__foot') : null;
          if (!foot && blk && blk !== cur.el && blk.classList.contains('rk-block')) foot = madeFoot = blk.appendChild(h('footer.rk-block__foot'));
          if (foot) foot.insertBefore(notesEl, foot.firstChild); else root.appendChild(notesEl);
        }
        notesEl.textContent = keys.map(function (k) { return k + ' ' + String(fn[k]); }).join('   ');
      }

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
            dataset: util.merge(sortable ? { field: c.field } : {}, { title: String(c.title == null ? '' : c.title) })
          }, c.align === 'right' ? ind : null, String(c.title == null ? '' : c.title),
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

      /**
       * Header cells wrap to at most two balanced lines: the cell's min-width is the wider half of the
       * title (plus the inline sort glyph), so narrow layouts scroll sideways instead of stacking words.
       */
      function fitHead() {
        Array.prototype.forEach.call(thead.querySelectorAll('th[data-title]'), function (th) {
          var cs = getComputedStyle(th);
          var font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
          var halves = balancedHalves(th.dataset.title);
          var w = Math.max.apply(null, halves.map(function (x) { return RK.chart.measure(x, font); }));
          var pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
          th.style.minWidth = Math.ceil(w + pad + (th.classList.contains('is-sortable') ? 13 : 0) + 1) + 'px';
        });
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
            tr = h('tr.is-section', h('td', { colspan: cols.length }, h('span.rk-comps__sec', String(s.label))));
          } else if (s.kind === 'stat') {
            // the statistic label spans the leading text columns (date / target / acquirer ...)
            var lead = 0;
            while (lead < cols.length && !(cols[lead].num && cols[lead].stats !== false && !cols[lead].isLabel)) lead++;
            lead = Math.max(1, lead);
            tr = h('tr.is-stat', { class: (s.sub ? 'is-substat ' : '') + (s.first ? 'is-stat-first' : '') },
              // the label sits in the sticky first column (an empty cell spans the rest of the lead) so it stays
              // in view when the table scrolls sideways
              h('td.rk-comps__label.is-sticky', s.label),
              lead > 1 ? h('td', { colspan: lead > 2 ? lead - 1 : null }) : null,
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
              // change columns: text stays ink ('+4.5%' / '(4.9%)'); only the small arrow carries the colour
              var arrow = c.sign && util.isNum(v) && !isNM(c, v) && v !== 0
                ? h('span.rk-comps__chg', { class: v > 0 ? 'is-up' : 'is-down', 'aria-hidden': 'true' }, v > 0 ? '▲' : '▼') : null;
              if (heat) cls.push('is-heat');
              return h('td', {
                class: cls.join(' '),
                style: util.merge({ 'text-align': c.align }, heat ? { 'background-color': heat.bg, color: heat.fg } : {})
              }, arrow, cellText(c, v));
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
        fitHead();
        drawBody(cols, animate && cur.motion);
        drawNotes();
        snap();
        edges();
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
      // web fonts change header widths and row heights: measure again once they are in
      var alive = true;
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (alive) { fitHead(); snap(); edges(); } });

      return {
        update: function (c) {
          var selOnly = sameRows(cur.rows, c.rows) && selKey(cur) !== selKey(c);
          cur = c;
          if (selOnly) restyle(); else draw(true);
        },
        resize: function () { snap(); edges(); },
        destroy: function () {
          alive = false;
          scroller.removeEventListener('scroll', edges);
          if (notesEl) notesEl.remove();
          if (madeFoot) madeFoot.remove();
          thead.removeEventListener('click', onHeadClick);
          bodies.forEach(function (b) { b.removeEventListener('click', onBodyClick); b.removeEventListener('keydown', onKey); });
          root.remove();
          if (auto) cur.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
