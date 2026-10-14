/*!
 * RK component: data-grid — interactive Tabulator 6 grid themed to the pitchbook look.
 * Columns come from the dataset schema (titles, RK formats, numbers right-aligned) or options.columns;
 * header filters (text "contains", numbers ">10", "<=2.5", "5-10", "30%"), global search box, sorting,
 * paging or virtual scroll inside the block height, frozen leading columns, grouped headers, CSV
 * download, row click -> cross-filter, live update with global filters (replaceData keeps sort / filters).
 * Print (ctx.print, i.e. between the runtime's beforeprint and afterprint): the virtual grid is swapped for a
 * static pitchbook <table class="rk-table"> with the same columns, titles, formats and row order (the grid's
 * current sort, search and header filters), as many rows as fit the block + "… n more rows"; the grid
 * comes back unchanged afterwards.
 */
(function () {
  'use strict';
  var util = RK.util, h = util.h;

  var SEARCH_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></svg>';

  function truthy(v) { return v === true || v === 1 || v === 'true' || v === 'Y' || v === 'yes'; }

  /** Accounting negatives (house rule): '$#,##0' -> '$#,##0;($#,##0)'; an explicit '-' section -> parentheses. */
  function acct(code) {
    var c = code && (RK.format.presets[code] || code);
    if (typeof c !== 'string' || !/[0#?]/.test(c.replace(/"[^"]*"/g, '')) || RK.format.isDateCode(c)) return code;
    var s = [], cur = '', q = false;
    for (var i = 0; i < c.length; i++) {
      var ch = c[i];
      if (ch === '"') q = !q;
      if (ch === ';' && !q) { s.push(cur); cur = ''; } else cur += ch;
    }
    s.push(cur);
    if (s.length === 1) return c + ';(' + c.replace(/^\+/, '') + ')';
    if (/^-/.test(s[1])) s[1] = '(' + s[1].slice(1) + ')';
    return s.join(';');
  }

  /**
   * Header / group titles and cell tooltips as DOM text nodes: Tabulator writes string titles and string
   * tooltips with innerHTML, so data-derived text (schema titles, company names) must never reach it as a string.
   */
  function textTitle(title) {
    return function () { var el = document.createElement('span'); el.textContent = title == null ? '' : String(title); return el; };
  }
  function textTip(fmt) {
    return function (e, cell) {
      var v = cell.getValue();
      if (v == null || v === '') return '';
      var el = document.createElement('div');
      el.textContent = RK.format(v, fmt);
      return el;
    };
  }
  // generic field names (link tables, bridges...) cross-filter only this dataset (house rule: scoped selections)
  var GENERIC = /^(type|kind|source|target|step|stage|metric|status|name|label|key|id|category|group|series)$/i;

  /**
   * Numeric header filter: "> 10", "<=2.5", "=7", "5-10", "5..10", "30%" (percent columns also accept "30").
   * Bare numbers match on the formatted text so "9.8" finds 9.8x.
   */
  function numFilter(isPct, fmt) {
    function num(s, pct) {
      var v = parseFloat(String(s).replace(/[,$€£x\s]/gi, ''));
      if (isNaN(v)) return null;
      return pct || (isPct && Math.abs(v) >= 1) ? v / 100 : v;
    }
    return function (q, v) {
      q = String(q == null ? '' : q).trim();
      if (!q) return true;
      if (!util.isNum(v)) return false;
      var m = q.match(/^(-?[\d.,$€£]+)(%?)\s*(?:-|–|\.\.)\s*(-?[\d.,$€£]+)(%?)$/);
      if (m) {
        var lo = num(m[1], m[2]), hi = num(m[3], m[4]);
        return lo != null && hi != null && v >= Math.min(lo, hi) && v <= Math.max(lo, hi);
      }
      m = q.match(/^(>=|<=|>|<|=|≥|≤)\s*(-?[\d.,$€£x]+)(%?)$/i);
      if (m) {
        var x = num(m[2], m[3]);
        if (x == null) return true;
        switch (m[1]) {
          case '>': return v > x;
          case '<': return v < x;
          case '>=': case '≥': return v >= x;
          case '<=': case '≤': return v <= x;
          default: return Math.abs(v - x) < 1e-9;
        }
      }
      return RK.format(v, fmt).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    };
  }

  /** Field specs from options.columns (names or objects) or every schema field. */
  function specsOf(ctx) {
    var o = ctx.options;
    var list = o.columns && o.columns.length ? o.columns
      : ctx.dataset.fields.map(function (f) { return f.name; }).filter(function (n) { return (o.hidden || []).indexOf(n) < 0; });
    return list.map(function (c) {
      c = typeof c === 'string' ? { field: c } : util.merge({}, c);
      var f = ctx.field(c.field) || { name: c.field, type: 'string' };
      c.type = c.type || f.type;
      c.title = c.title != null ? c.title : ctx.title(c.field);
      c.format = c.format || f.format || (c.type === 'number' ? '#,##0.##' : c.type === 'date' ? 'dd mmm yyyy' : null);
      c.num = c.type === 'number';
      if (c.num && !c.sign) c.format = acct(c.format);   // negatives in parentheses; signed change columns keep '+' / '-'
      return c;
    });
  }

  function keyField(ctx) {
    if (ctx.enc.key) return ctx.enc.key;
    var s = ctx.dataset.fields.filter(function (f) { return f.type === 'string'; })[0];
    return s ? s.name : ctx.dataset.fields[0].name;
  }

  /** Tabulator column definitions (grouped when specs carry a group label). */
  function columnDefs(ctx, specs) {
    var o = ctx.options;
    var frozenN = o.frozen === true ? 1 : (+o.frozen || 0);
    var defs = specs.map(function (c, i) {
      var fmt = c.format;
      var d = {
        title: c.title,              // raw text: only read by Tabulator itself (never rendered: titleFormatter below)
        titleFormatter: textTitle(c.title),
        field: c.field,
        hozAlign: c.align || (c.num ? 'right' : 'left'),
        headerHozAlign: c.align || (c.num ? 'right' : 'left'),
        vertAlign: 'middle',
        formatter: function (cell) {
          var v = cell.getValue();
          var txt = util.escapeHTML(RK.format(v, fmt));
          if (c.num && util.isNum(v) && c.sign) return '<span class="' + (v < 0 ? 'is-neg' : v > 0 ? 'is-pos' : '') + '">' + txt + '</span>';
          return v == null || v === '' ? '<span class="rk-dgrid__na">' + txt + '</span>' : txt;
        },
        sorter: c.num ? 'number' : (c.type === 'boolean' ? 'boolean' : 'string'),
        sorterParams: { alignEmptyValues: 'bottom' },
        headerSortStartingDir: c.num ? 'desc' : 'asc',
        cssClass: c.num ? 'is-num' : null,
        resizable: true,
        minWidth: c.minWidth || (c.num ? 76 : 90)
      };
      if (c.width) d.width = c.width;
      if (!c.num && c.type !== 'boolean') d.tooltip = textTip(fmt);
      if (o.headerFilters !== false && c.headerFilter !== false) {
        d.headerFilter = 'input';
        d.headerFilterPlaceholder = 'Filter';
        d.headerFilterParams = { elementAttributes: { title: c.num ? 'Number filter: >10, <=2.5, =7, 5-10' + (/%/.test(String(fmt)) ? ', 30%' : '') : 'Contains text' } };
        d.headerFilterFunc = c.num ? numFilter(/%/.test(String(fmt)), fmt) : 'like';
      }
      if (i < frozenN && !c.group) d.frozen = true;
      return d;
    });
    if (o.columnGroups === false || !specs.some(function (c) { return c.group; })) return defs;
    var out = [];
    for (var i = 0; i < specs.length; i++) {
      if (!specs[i].group) { out.push(defs[i]); continue; }
      var g = { title: specs[i].group, titleFormatter: textTitle(specs[i].group), headerHozAlign: 'center', columns: [] };
      while (i < specs.length && specs[i].group === g.title) { g.columns.push(defs[i]); i++; }
      i--;
      out.push(g);
    }
    return out;
  }

  /** UI string via RK.i18n ({name} placeholders). */
  function tr(key, fb, vars) {
    if (RK.i18n && typeof RK.i18n.t === 'function') return RK.i18n.t(key, fb, vars || null);
    return String(fb).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; });
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('en', {
      'dataGrid.moreRows': '\u2026 {n} more rows',
      'dataGrid.moreRow': '\u2026 1 more row',
      'dataGrid.sortedBy': 'sorted by {field} {dir}',
      'dataGrid.tableFilters': 'table search / column filters applied ({n} of {total} rows)'
    });
    RK.i18n.add('zh-CN', {
      'dataGrid.moreRows': '\u2026 另有 {n} 行未显示',
      'dataGrid.moreRow': '\u2026 另有 1 行未显示',
      'dataGrid.sortedBy': '按{field}{dir}排序',
      'dataGrid.tableFilters': '已应用表内搜索 / 列筛选（{n} / {total} 行）'
    });
  }

  /** Same row objects in the same order (RK.data.view returns references to the dataset rows). */
  function sameRows(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * Stable multi-key sort like the grid's sorters: [{field, dir}] in priority order, numbers numerically,
   * text with localeCompare, empty values at the bottom in either direction (alignEmptyValues: 'bottom').
   */
  function sortRows(rows, sorters, specs) {
    if (!sorters.length) return rows.slice();
    var num = {};
    specs.forEach(function (c) { num[c.field] = c.num; });
    function empty(v) { return v == null || v === '' || (typeof v === 'number' && isNaN(v)); }
    return rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      for (var k = 0; k < sorters.length; k++) {
        var f = sorters[k].field, d = sorters[k].dir === 'desc' ? -1 : 1, x = a.r[f], y = b.r[f];
        var ex = empty(x), ey = empty(y);
        if (ex || ey) { if (ex && ey) continue; return ex ? 1 : -1; }
        var c = num[f] ? (+x) - (+y) : typeof x === 'boolean' ? (x === y ? 0 : x ? 1 : -1) : String(x).localeCompare(String(y));
        if (c) return c * d;
      }
      return a.i - b.i;
    }).map(function (x) { return x.r; });
  }

  RK.component({
    id: 'data-grid',
    deps: ['tabulator'],
    defaults: {
      encode: { key: null, highlight: null },   // key: cross-filter field (default: first text field)
      columns: null,         // null = every schema field; [{field, title, format, group, width, minWidth, align, sign, headerFilter}]
      hidden: [],            // fields to leave out when columns is null
      columnGroups: true,    // group headers from columns[].group
      frozen: 1,             // leading columns frozen while scrolling horizontally
      headerFilters: true,
      search: true,          // global search box
      searchFilters: false,  // also publish the search text as a global filter on this dataset
      download: true,        // CSV download button
      pagination: false,     // false = virtual scroll in the block height; number = rows per page
      sort: null,            // {field, dir} or [{field, dir}]
      highlight: null,       // key value(s) to highlight, in addition to encode.highlight
      layout: 'fitDataStretch',
      crossFilter: true
    },
    render: function (ctx) {
      if (!window.Tabulator) throw new Error('Tabulator is not loaded (vendor/tabulator/tabulator.min.js)');
      var cur = ctx, o = ctx.options, built = false, pending = null, query = '';
      var key = keyField(ctx), specs = specsOf(ctx);
      var table = null, gridRows = null;          // the grid is created on the first screen render (never for print)
      var printEl = null, printSize = '';          // static print table while ctx.print

      var root = h('div.rk-dgrid');
      var bar = h('div.rk-dgrid__bar');
      var search = null, count = h('span.rk-dgrid__count'), dl = null;
      if (o.search !== false) {
        search = h('input.rk-input.rk-dgrid__search', { type: 'search', placeholder: 'Search all columns…', 'aria-label': 'Search rows' });
        bar.appendChild(h('label.rk-dgrid__find', { html: SEARCH_ICON }, search));
      }
      bar.appendChild(h('span.rk-dgrid__spacer'));
      bar.appendChild(count);
      if (o.download !== false) {
        dl = h('button.rk-btn.rk-dgrid__dl', { type: 'button', title: 'Download the filtered rows as CSV', html: RK.ui.icon('download') + '<span>CSV</span>' });
        bar.appendChild(dl);
      }
      var holder = h('div.rk-dgrid__table', { class: o.pagination ? 'is-paged' : null });
      var frame = h('div.rk-dgrid__frame', { class: o.pagination ? 'is-paged' : null }, holder);   // carries the scroll-edge fade
      root.appendChild(bar);
      root.appendChild(frame);
      ctx.el.appendChild(root);

      function marks() { return cur.options.highlight == null ? [] : [].concat(cur.options.highlight); }
      function isTarget(d) {
        var hf = cur.enc.highlight;
        return (hf && truthy(d[hf])) || marks().indexOf(d[key]) >= 0;
      }
      function rowsCopy(c) { return c.rows.map(function (r) { return util.merge({}, r); }); }
      function tableHeight() { return Math.max(160, Math.floor(ctx.el.clientHeight - bar.offsetHeight - 8)); }

      var sorts = o.sort ? [].concat(o.sort).map(function (s) { return { column: s.field, dir: s.dir || 'asc' }; }) : [];

      /* ---------------- horizontal scroll cue + whole-row viewport ---------------- */
      var tholder = null;
      function edges() {
        if (!tholder) return;
        var more = tholder.scrollWidth - tholder.clientWidth - tholder.scrollLeft > 1;
        frame.classList.toggle('is-more-r', more);
        frame.classList.toggle('is-scrolled-x', tholder.scrollLeft > 1);
        var foot = holder.querySelector('.tabulator-footer');
        frame.style.setProperty('--rk-dgrid-foot', (foot ? foot.offsetHeight : 0) + 'px');
      }
      /** Virtual-scroll grids: header + a whole number of rows, so the last visible row is never sliced. */
      function fitRows() {
        if (!built || cur.options.pagination || !tholder) return;
        var row = tholder.querySelector('.tabulator-row');
        var avail = tableHeight();
        if (!row) { table.setHeight(avail); return; }
        var rowH = row.offsetHeight, el = table.element;
        var chrome = el.offsetHeight - tholder.clientHeight;      // header + horizontal scrollbar + borders
        var content = tholder.scrollHeight;
        if (content <= avail - chrome) { if (el.offsetHeight !== Math.ceil(chrome + content)) table.setHeight(Math.ceil(chrome + content)); return; }
        var n = Math.max(3, Math.floor((avail - chrome) / rowH));
        var want = Math.min(avail, chrome + n * rowH);
        if (Math.abs(el.offsetHeight - want) > 0.5) table.setHeight(want);
      }

      function setCount() {
        if (!built) return;
        var shown = table.getDataCount('active'), total = cur.rows.length;
        count.textContent = shown === total ? RK.format(total, '#,##0') + ' rows' : RK.format(shown, '#,##0') + ' of ' + RK.format(total, '#,##0') + ' rows';
      }
      function restyle() {
        if (!built) return;
        root.classList.toggle('has-sel', cur.selected(key).length > 0);
        table.getRows().forEach(function (r) { r.reformat(); });
      }

      /** Create the Tabulator grid for the current rows (first screen render). */
      function buildGrid() {
        gridRows = cur.rows;
        var config = {
          data: rowsCopy(cur),
          columns: columnDefs(cur, specs),
          layout: o.layout,
          renderVertical: 'virtual',
          headerFilterLiveFilterDelay: 200,
          printAsHtml: false,         // print: this component swaps in its own static table (ctx.print)
          initialSort: sorts,
          placeholder: 'No matching rows',
          headerSortClickElement: 'header',
          columnHeaderVertAlign: 'bottom',
          index: key,
          rowFormatter: function (row) {
            var d = row.getData(), el = row.getElement(), sel = cur.selected(key);
            el.classList.toggle('is-target', isTarget(d));
            el.classList.toggle('is-selected', sel.indexOf(d[key]) >= 0);
            el.classList.toggle('is-dim', sel.length > 0 && sel.indexOf(d[key]) < 0);
            el.classList.toggle('is-clickable', cur.options.crossFilter !== false);
          }
        };
        if (o.pagination) {
          // paged grids shrink to their rows; virtual-scroll grids fill the block height
          config.pagination = true;
          config.paginationSize = +o.pagination || 10;
          config.paginationCounter = 'rows';
          config.maxHeight = tableHeight();
        } else {
          config.height = tableHeight();
        }
        table = new window.Tabulator(holder, config);
        table.on('tableBuilt', function () {
          built = true;
          tholder = holder.querySelector('.tabulator-tableholder');
          if (tholder) tholder.addEventListener('scroll', edges, { passive: true });
          if (cur.motion) root.classList.add('is-in');
          fitRows();
          edges();
          setCount();
          if (pending) { var p = pending; pending = null; apply(p); }
        });
        table.on('dataFiltered', function () { setTimeout(function () { setCount(); edges(); }, 0); });
        table.on('renderComplete', function () { edges(); });
        table.on('rowClick', function (e, row) {
          if (cur.options.crossFilter === false) return;
          cur.select(key, row.getData()[key], GENERIC.test(key) && !cur.options.crossFilterScope ? { scope: 'dataset' } : null);
        });
      }

      /* ---------------- search ---------------- */
      function matches(d) {
        if (!query) return true;
        for (var i = 0; i < specs.length; i++) {
          var c = specs[i], v = d[c.field];
          if (v == null) continue;
          if (String(v).toLowerCase().indexOf(query) >= 0 || RK.format(v, c.format).toLowerCase().indexOf(query) >= 0) return true;
        }
        return false;
      }
      var onSearch = util.debounce(function () {
        query = String(search.value || '').trim().toLowerCase();
        if (!built) return;
        if (query) table.setFilter(matches); else table.clearFilter();
        if (cur.options.searchFilters) {
          RK.store.setFilter(cur.id + ':search', query ? { op: 'search', text: query, source: cur.id, datasets: [cur.dataset.id] } : null);
        }
        setCount();
      }, 160);
      if (search) search.addEventListener('input', onSearch);

      /**
       * CSV of the filtered rows in the current sort order, through RK.Dataset.toCSV (quotes values and
       * neutralises spreadsheet formulas: a text cell starting with = + - @ is written as text).
       */
      function onDownload() {
        if (!built) return;
        var name = (cur.dataset.id || 'data') + '.csv';
        var fields = specs.map(function (c) { return { name: c.field, title: c.title == null ? c.field : String(c.title), type: c.type }; });
        var csv = RK.Dataset.prototype.toCSV.call(cur.dataset, table.getData('active'), fields);
        util.download(name, csv, 'text/csv;charset=utf-8');
      }
      if (dl) dl.addEventListener('click', onDownload);

      /* ---------------- print: static pitchbook table instead of the virtual grid ---------------- */
      var PRINT_CAP = 400;      // rows laid out before trimming to the block height
      var PRINT_CAP_AUTO = 30;  // height "auto" blocks have no height to fit: a page's worth of rows

      /** Rows as the grid shows them: its own active view (sort, search, header filters) when it holds these rows. */
      function printRows() {
        var srt = built ? table.getSorters().map(function (s) { return { field: s.field, dir: s.dir }; })
          : sorts.map(function (s) { return { field: s.column, dir: s.dir }; });
        if (built && sameRows(cur.rows, gridRows)) {
          var hf = table.getHeaderFilters ? table.getHeaderFilters().filter(function (f) { return f.value != null && f.value !== ''; }) : [];
          return { rows: table.getData('active'), local: !!query || hf.length > 0, sorters: srt };
        }
        return { rows: sortRows(query ? cur.rows.filter(matches) : cur.rows, srt, specs), local: !!query, sorters: srt };
      }
      function printCell(s, d) {
        var v = d[s.field], txt = RK.format(v, s.format);
        var td = h('td', { class: s.num ? 'is-num' : null, style: s.align ? { 'text-align': s.align } : null });
        if (v == null || v === '') td.appendChild(h('span.rk-dgrid__na', txt));
        else if (s.num && s.sign && util.isNum(v)) td.appendChild(h('span', { class: v < 0 ? 'is-neg' : v > 0 ? 'is-pos' : null }, txt));
        else if (!s.num) td.appendChild(h('span.rk-dgrid-print__t', txt));      // ellipsis box when columns must be narrowed
        else td.appendChild(document.createTextNode(txt));
        return td;
      }
      function printHead() {
        var thead = h('thead');
        function th(s, span) {
          return h('th', { class: s.num ? 'is-num' : null, scope: 'col', rowspan: span > 1 ? String(span) : null, style: s.align ? { 'text-align': s.align } : null },
            s.title == null ? '' : String(s.title));
        }
        if (cur.options.columnGroups === false || !specs.some(function (s) { return s.group; })) {
          thead.appendChild(h('tr', specs.map(function (s) { return th(s, 1); })));
          return thead;
        }
        // contiguous columns sharing a group label share one spanning cell (as in the grid)
        var top = h('tr.rk-table__group'), bottom = h('tr');
        for (var i = 0; i < specs.length; i++) {
          var s = specs[i];
          if (!s.group) { top.appendChild(th(s, 2)); continue; }
          var n = 1;
          while (i + n < specs.length && specs[i + n].group === s.group) n++;
          top.appendChild(h('th.rk-dgrid-print__grp', { colspan: String(n), scope: 'colgroup' }, h('span', String(s.group))));
          for (var j = 0; j < n; j++) bottom.appendChild(th(specs[i + j], 1));
          i += n - 1;
        }
        thead.appendChild(top);
        thead.appendChild(bottom);
        return thead;
      }
      function outerH(el) {
        var cs = getComputedStyle(el);
        return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      }
      /** Narrow the text columns (ellipsis) in proportion to their width until the table fits availW. */
      function squeeze(tbl, tbody, availW) {
        var first = tbody.rows[0];
        if (!first) return;
        var cols = [];
        specs.forEach(function (s, i) {
          var td = first.cells[i], sp = td && td.firstChild;
          if (!s.num && sp && sp.classList && sp.classList.contains('rk-dgrid-print__t')) cols.push({ i: i, pad: td.offsetWidth - sp.offsetWidth });
        });
        for (var pass = 0; pass < 4 && cols.length && tbl.offsetWidth > availW + 0.5; pass++) {
          var over = tbl.offsetWidth - availW, tot = 0;
          cols.forEach(function (c) { c.w = first.cells[c.i].offsetWidth; tot += c.w; });
          if (!tot) return;
          cols.forEach(function (c) {
            var max = Math.max(48, Math.floor(c.w - Math.ceil(over * c.w / tot) - c.pad)) + 'px';
            [].forEach.call(tbody.rows, function (r) {
              var sp = r.cells[c.i] && r.cells[c.i].firstChild;
              if (sp && sp.classList && sp.classList.contains('rk-dgrid-print__t')) sp.style.maxWidth = max;
            });
          });
        }
      }
      function buildPrint() {
        var v = printRows(), rows = v.rows, total = rows.length, sel = cur.selected(key);
        var body = cur.el, auto = body.classList.contains('is-auto') || cur.block.classList.contains('rk-block--auto');
        var tbody = h('tbody', rows.slice(0, auto ? PRINT_CAP_AUTO : PRINT_CAP).map(function (d) {
          var cls = (isTarget(d) ? 'is-target ' : '') + (sel.length && sel.indexOf(d[key]) >= 0 ? 'is-selected' : '');
          return h('tr', { class: cls.trim() || null }, specs.map(function (s) { return printCell(s, d); }));
        }));
        var tbl = h('table.rk-table.rk-dgrid-print__table', printHead(), tbody);
        var note = h('p.rk-dgrid-print__more');
        var wrap = h('div.rk-dgrid-print', { style: { position: 'relative' } }, tbl, note);
        if (printEl) printEl.remove();
        printEl = wrap;
        cur.el.appendChild(wrap);

        function fmtN(n) { return RK.format(n, '#,##0'); }
        function setNote(k) {
          var hidden = total - k, parts = [];
          if (hidden > 0) {
            parts.push(hidden === 1 ? tr('dataGrid.moreRow', '… 1 more row') : tr('dataGrid.moreRows', '… {n} more rows', { n: fmtN(hidden) }));
            var s0 = v.sorters[0];
            if (s0) {
              var spec0 = specs.filter(function (s) { return s.field === s0.field; })[0];
              var name = spec0 && spec0.title != null ? String(spec0.title) : cur.title(s0.field);
              parts.push(tr('dataGrid.sortedBy', 'sorted by {field} {dir}', { field: name, dir: s0.dir === 'desc' ? '↓' : '↑' }));
            }
          }
          if (v.local) parts.push(tr('dataGrid.tableFilters', 'table search / column filters applied ({n} of {total} rows)', { n: fmtN(total), total: fmtN(cur.rows.length) }));
          note.textContent = parts.join(' · ');
          note.hidden = !parts.length;
        }

        // width: compact type first, then narrow the text columns
        var availW = wrap.clientWidth;
        if (tbl.offsetWidth > availW + 0.5) wrap.classList.add('is-compact');
        if (tbl.offsetWidth > availW + 0.5) squeeze(tbl, tbody, availW);
        // height: the rows whose bottom edge fits above the footnote line
        var avail = auto ? Infinity : body.clientHeight, trs = tbody.rows;
        setNote(trs.length);
        if (avail > 0 && wrap.offsetHeight > avail + 0.5 && trs.length > 1) {
          setNote(trs.length - 1);
          var noteH = outerH(note), top = tbl.offsetTop, k = trs.length;
          while (k > 1 && top + trs[k - 1].offsetTop + trs[k - 1].offsetHeight + noteH > avail) k--;
          while (trs.length > k) tbody.removeChild(tbody.lastChild);
          setNote(k);
          while (wrap.offsetHeight > avail + 0.5 && trs.length > 1) { tbody.removeChild(tbody.lastChild); setNote(trs.length); }
        }
        printSize = body.clientWidth + 'x' + body.clientHeight;
      }
      function showPrint() {
        root.style.setProperty('display', 'none');
        buildPrint();
      }
      function hidePrint() {
        if (printEl) { printEl.remove(); printEl = null; printSize = ''; }
        root.style.removeProperty('display');
        if (!built) return;
        if (!cur.options.pagination) table.setHeight(tableHeight());
        table.redraw(true);
        fitRows();
        edges();
      }

      /* ---------------- updates ---------------- */
      function apply(c) {
        cur = c;
        if (c.print) { showPrint(); return; }    // the grid keeps its state (sort, filters, search) while hidden
        if (printEl) hidePrint();
        if (!table) { buildGrid(); return; }
        if (!built) { pending = c; return; }
        gridRows = c.rows;
        table.replaceData(rowsCopy(c)).then(function () { restyle(); setCount(); fitRows(); edges(); });
      }
      if (ctx.print) showPrint(); else buildGrid();

      return {
        update: apply,
        resize: function () {
          if (printEl) { if (cur.el.clientWidth + 'x' + cur.el.clientHeight !== printSize) buildPrint(); return; }
          if (!built) return;
          if (!cur.options.pagination) table.setHeight(tableHeight());
          table.redraw();
          fitRows();
          edges();
        },
        destroy: function () {
          if (tholder) tholder.removeEventListener('scroll', edges);
          if (search) search.removeEventListener('input', onSearch);
          if (dl) dl.removeEventListener('click', onDownload);
          if (cur.options.searchFilters) RK.store.clearFilter(cur.id + ':search');
          if (table) { try { table.destroy(); } catch (e) { /* not yet built */ } }
          if (printEl) printEl.remove();
          root.remove();
        }
      };
    }
  });

})();
