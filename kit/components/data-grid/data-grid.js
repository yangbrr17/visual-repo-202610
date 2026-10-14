/*!
 * RK component: data-grid — interactive Tabulator 6 grid themed to the pitchbook look.
 * Columns come from the dataset schema (titles, RK formats, numbers right-aligned) or options.columns;
 * header filters (text "contains", numbers ">10", "<=2.5", "5-10", "30%"), global search box, sorting,
 * paging or virtual scroll inside the block height, frozen leading columns, grouped headers, CSV
 * download, row click -> cross-filter, live update with global filters (replaceData keeps sort / filters).
 */
(function () {
  'use strict';
  var util = RK.util, h = util.h;

  var SEARCH_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></svg>';

  function truthy(v) { return v === true || v === 1 || v === 'true' || v === 'Y' || v === 'yes'; }

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
        title: c.title,
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
        minWidth: c.minWidth || (c.num ? 64 : 90)
      };
      if (c.width) d.width = c.width;
      if (!c.num && c.type !== 'boolean') d.tooltip = true;
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
      var g = { title: specs[i].group, headerHozAlign: 'center', columns: [] };
      while (i < specs.length && specs[i].group === g.title) { g.columns.push(defs[i]); i++; }
      i--;
      out.push(g);
    }
    return out;
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
      root.appendChild(bar);
      root.appendChild(holder);
      ctx.el.appendChild(root);

      function marks() { return cur.options.highlight == null ? [] : [].concat(cur.options.highlight); }
      function isTarget(d) {
        var hf = cur.enc.highlight;
        return (hf && truthy(d[hf])) || marks().indexOf(d[key]) >= 0;
      }
      function rowsCopy(c) { return c.rows.map(function (r) { return util.merge({}, r); }); }
      function tableHeight() { return Math.max(160, Math.floor(ctx.el.clientHeight - bar.offsetHeight - 8)); }

      var sorts = o.sort ? [].concat(o.sort).map(function (s) { return { column: s.field, dir: s.dir || 'asc' }; }) : [];
      var config = {
        data: rowsCopy(ctx),
        columns: columnDefs(ctx, specs),
        layout: o.layout,
        renderVertical: 'virtual',
        headerFilterLiveFilterDelay: 200,
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
      var table = new window.Tabulator(holder, config);

      function setCount() {
        if (!built) return;
        var shown = table.getDataCount('active'), total = cur.rows.length;
        count.textContent = shown === total ? RK.format(total, '#,##0') + ' rows' : RK.format(shown, '#,##0') + ' of ' + RK.format(total, '#,##0') + ' rows';
      }
      function restyle() {
        root.classList.toggle('has-sel', cur.selected(key).length > 0);
        table.getRows().forEach(function (r) { r.reformat(); });
      }

      table.on('tableBuilt', function () {
        built = true;
        if (cur.motion) root.classList.add('is-in');
        setCount();
        if (pending) { var p = pending; pending = null; apply(p); }
      });
      table.on('dataFiltered', function () { setTimeout(setCount, 0); });
      table.on('rowClick', function (e, row) {
        if (cur.options.crossFilter === false) return;
        cur.select(key, row.getData()[key]);
      });

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

      function onDownload() {
        if (!built) return;
        var name = (cur.dataset.id || 'data') + '.csv';
        table.download('csv', name, { bom: true }, 'active');
      }
      if (dl) dl.addEventListener('click', onDownload);

      /* ---------------- updates ---------------- */
      function apply(c) {
        cur = c;
        if (!built) { pending = c; return; }
        table.replaceData(rowsCopy(c)).then(function () { restyle(); setCount(); });
      }

      return {
        update: apply,
        resize: function () {
          if (!built) return;
          if (!cur.options.pagination) table.setHeight(tableHeight());
          table.redraw();
        },
        destroy: function () {
          if (search) search.removeEventListener('input', onSearch);
          if (dl) dl.removeEventListener('click', onDownload);
          if (cur.options.searchFilters) RK.store.clearFilter(cur.id + ':search');
          try { table.destroy(); } catch (e) { /* not yet built */ }
          root.remove();
        }
      };
    }
  });

})();
