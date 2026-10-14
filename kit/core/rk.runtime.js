/*!
 * ReportKit runtime — boots a report page:
 *   load data -> read theme tokens -> mount every [data-rk] block (lazily, on scroll) ->
 *   keep blocks in sync with filters / params / theme -> navigation, toolbar, print.
 *
 * Imperative API (used by the gallery):
 *   var block = RK.mount(el, { component: 'bar', data: 'peers', options: {...} });
 *   block.setOptions({...}); block.destroy();
 *
 * Report chrome kept in sync with the store (boot + every filter / param / data change):
 *   [data-rk-template]          title templates ("{{peers: median(ev_ebitda_25e) | 0.0x}}", see RK.template)
 *   .rk-page__filtered          "Filtered view: Region = Europe · …" stamp in a page foot (printed)
 *   .rk-block__status           "Filtered" badge (+ clear) / "Selection not in this view" in a block head
 *   .rk-block__choices          metric / dimension pickers from options.choices
 *   <section data-rk-filters="off">   page whose blocks ignore global filters and chart selections
 * Print: RK.runtime.printFit() scales overflowing block content to fit (CSS zoom, min 0.55); printUnfit() restores.
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});
  var util = RK.util, h = util.h;

  var blocks = [];
  var runtime = RK.runtime = { printing: false, booted: false };
  function t(key, fallback, vars) { return RK.i18n ? RK.i18n.t(key, fallback, vars) : String(fallback); }

  /** Page (section) of an element and whether it opted out of global filters (data-rk-filters="off"). */
  function pageOf(el) { return el && el.closest ? el.closest('.rk-page, [data-rk-page]') : null; }
  function pageFiltersOff(el) {
    var p = el && el.closest ? el.closest('[data-rk-filters]') : null;
    return !!p && String(p.getAttribute('data-rk-filters')).toLowerCase() === 'off';
  }

  /* ------------------------------------------------------------------ *
   * Small UI helpers (modal, icons) shared with components
   * ------------------------------------------------------------------ */
  var ICONS = {
    table: '<path d="M3 5h18v14H3zM3 10h18M3 15h18M9 5v14"/>',
    image: '<path d="M4 5h16v14H4z"/><path d="m4 16 4.5-4.5 3.5 3.5 2.5-2.5L20 18"/><circle cx="9" cy="9" r="1.5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5"/>',
    print: '<path d="M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z"/>',
    filter: '<path d="M4 5h16l-6.2 7.4V18l-3.6 1.8v-7.4z"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  var ui = RK.ui = {
    icon: icon,
    modal: function (title, content, opts) {
      opts = opts || {};
      var close;
      var overlay = h('div.rk-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div.rk-modal__panel' + (opts.wide ? '.is-wide' : ''),
          h('div.rk-modal__head',
            h('h3.rk-modal__title', title),
            h('button.rk-iconbtn', { type: 'button', 'aria-label': t('close', 'Close'), html: icon('close'), on: { click: function () { close(); } } })),
          h('div.rk-modal__body', content)));
      function onKey(e) { if (e.key === 'Escape') close(); }
      close = function () {
        overlay.classList.remove('is-open');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () { overlay.remove(); if (opts.onClose) opts.onClose(); }, 200);
      };
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      global.requestAnimationFrame(function () { overlay.classList.add('is-open'); });
      return { el: overlay, close: close };
    },

    /**
     * Body-level hover tooltip for DOM components (tables): position:fixed on <body>, so scroll
     * containers never clip it; styled like the ECharts tooltips; hides on any scroll; never printed.
     *   var tip = RK.ui.tip();
     *   tip.show(RK.chart.tip(title, rows, foot), cellEl);   // centred above the anchor (below if no room)
     *   tip.hide(); tip.destroy();
     */
    tip: function (topts) {
      topts = topts || {};
      var el = h('div.rk-uitip.rk-noprint', {
        'aria-hidden': 'true',
        style: {
          position: 'fixed', left: '0', top: '0', 'z-index': '90', 'pointer-events': 'none', opacity: '0',
          padding: '8px 10px', border: '1px solid var(--rk-rule)', 'border-radius': '6px',
          'white-space': topts.wrap ? 'normal' : 'nowrap', 'max-width': topts.wrap ? (topts.maxWidth || 320) + 'px' : 'none',
          background: 'var(--rk-tooltip-bg)', color: 'var(--rk-tooltip-ink)', 'font-family': 'var(--rk-font-sans)',
          'box-shadow': '0 8px 24px rgba(15, 23, 42, .14)', transition: 'opacity 120ms, transform 160ms var(--rk-ease)'
        }
      });
      document.body.appendChild(el);
      function hide() { el.style.opacity = '0'; }
      global.addEventListener('scroll', hide, { passive: true, capture: true });
      return {
        el: el,
        show: function (html, anchor) {
          el.innerHTML = html;
          el.style.opacity = '1';
          var r = anchor.getBoundingClientRect(), tw = el.offsetWidth, th = el.offsetHeight;
          var x = util.clamp(r.left + r.width / 2 - tw / 2, 6, Math.max(6, global.innerWidth - tw - 6));
          var y = r.top - th - 8;
          if (y < 6) y = r.bottom + 8;
          el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
        },
        hide: hide,
        destroy: function () { global.removeEventListener('scroll', hide, { capture: true }); el.remove(); }
      };
    },

    /**
     * Rasterise a DOM subtree to a PNG data URL (SVG foreignObject + inlined computed styles).
     * Used for DOM components without their own exportImage. Web fonts fall back to system fonts.
     */
    exportDOM: function (el, opts) {
      opts = opts || {};
      var scale = opts.scale || 2, rect = el.getBoundingClientRect();
      var w = Math.ceil(el.scrollWidth || rect.width), hgt = Math.ceil(el.scrollHeight || rect.height);
      var clone = el.cloneNode(true);
      var src = [el].concat([].slice.call(el.querySelectorAll('*')));
      var dst = [clone].concat([].slice.call(clone.querySelectorAll('*')));
      src.forEach(function (s, i) {
        var cs = getComputedStyle(s), d = dst[i], css = '';
        for (var k = 0; k < cs.length; k++) { var p = cs[k]; css += p + ':' + cs.getPropertyValue(p) + ';'; }
        css = css.replace(/font-family:[^;]*;/, 'font-family:Helvetica,Arial,sans-serif;');
        // export the whole content, not the scrolled viewport: unroll scroll containers, drop sticky offsets
        if (/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY) && (s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1)) {
          w = Math.max(w, Math.ceil(s.scrollWidth + (s.getBoundingClientRect().left - rect.left)));
          hgt += Math.max(0, s.scrollHeight - s.clientHeight);
          css += 'overflow:visible;max-height:none;height:auto;width:' + s.scrollWidth + 'px;';
        }
        if (cs.position === 'sticky') css += 'position:static;';
        d.setAttribute('style', css);
      });
      [].slice.call(clone.querySelectorAll('canvas,script')).forEach(function (n) { n.remove(); });
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      var bg = RK.theme.tokens().paper || '#ffffff';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + hgt + '"><foreignObject x="0" y="0" width="100%" height="100%">' +
        new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>';
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var c = document.createElement('canvas');
          c.width = w * scale; c.height = hgt * scale;
          var g = c.getContext('2d');
          g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
          g.scale(scale, scale); g.drawImage(img, 0, 0);
          try { resolve(c.toDataURL('image/png')); } catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    },

    /** Plain formatted HTML table for a set of rows/fields (used by "view data"). */
    table: function (rows, fields, opts) {
      opts = opts || {};
      var max = opts.max || 500;
      var thead = h('thead', h('tr', fields.map(function (f) {
        return h('th', { class: f.type === 'number' ? 'is-num' : null }, f.title || f.name);
      })));
      var tbody = h('tbody', rows.slice(0, max).map(function (r) {
        return h('tr', fields.map(function (f) {
          var v = r[f.name];
          return h('td', { class: f.type === 'number' ? 'is-num' : null }, Array.isArray(v) ? v.join(', ') : RK.format(v, f.format));
        }));
      }));
      var wrap = h('div.rk-datatable', h('table', thead, tbody));
      if (rows.length > max) wrap.appendChild(h('p.rk-muted', t('showingFirst', 'Showing first {max} of {n} rows.', { max: max, n: rows.length })));
      return wrap;
    }
  };

  /* ------------------------------------------------------------------ *
   * Block
   * ------------------------------------------------------------------ */
  function Block(el, spec) {
    this.el = el;
    this.id = el.id || (el.id = util.uid('rk-block'));
    this.component = spec.component || el.getAttribute('data-rk');
    this.datasetId = spec.data !== undefined ? spec.data : el.getAttribute('data-rk-data');
    this.userOptions = spec.options || util.readOptions(el);
    this.def = RK.components[this.component];
    this.body = el.querySelector(':scope > .rk-block__body') || (el.classList.contains('rk-block') ? el.appendChild(h('div.rk-block__body')) : el);
    this.instance = null;
    this.state = 'idle';
    this._errorEl = null;
    this.el.rkBlock = this;
  }

  Block.prototype.options = function () {
    return util.merge({}, (this.def && this.def.defaults) || {}, this.userOptions || {});
  };

  /** Dataset ids this block depends on: primary + any option ending in "Data" (e.g. eventsData). */
  Block.prototype.datasetIds = function (opts) {
    opts = opts || this.options();
    var ids = this.datasetId ? [this.datasetId] : [];
    Object.keys(opts).forEach(function (k) {
      if (/Data$/.test(k) && typeof opts[k] === 'string') ids.push(opts[k]);
    });
    return ids;
  };

  /** Page opted out (data-rk-filters="off") or options.filters === false: no global filters, no selections. */
  Block.prototype.filtersOff = function (opts) {
    return (opts || this.options()).filters === false || pageFiltersOff(this.el);
  };

  /**
   * Rows this block shows -> {rows, applied: [{key, spec}], ignored: [{key, spec}]}.
   * Global filters + other blocks' selections (never its own), options.ignoreFilters / where. Cross-filter safety:
   * when the rows are empty only because of selections made in OTHER blocks (filters with a source), those
   * selections are ignored for this block (listed in `ignored`; the head shows "Selection not in this view").
   * options.selectionFallback: false keeps the empty view.
   */
  Block.prototype.view = function (opts) {
    opts = opts || this.options();
    var self = this, ds = this.datasetId ? RK.data.get(this.datasetId) : null;
    var out = { rows: [], applied: [], ignored: [] };
    if (!ds) return out;
    var ig = opts.ignoreFilters, off = this.filtersOff(opts);
    var ignore = Array.isArray(ig) ? ig : typeof ig === 'string' && ig ? [ig] : [];
    var where = null;
    // view() also runs for title templates and page stamps: warn about a bad "where" once per formula
    function warn(e) { if (self._whereWarned !== opts.where) { self._whereWarned = opts.where; console.warn('[RK] bad "where" on', self.id, e.message); } }
    if (opts.where) {
      try { where = RK.expr.compile(opts.where, { fields: ds.fields }); } catch (e) { warn(e); }
    }
    function run(vo) {
      var rows = RK.data.view(ds, vo);
      if (where) {
        var env = { params: RK.store.params() };
        try { rows = rows.filter(function (r) { return !!where.eval(r, env); }); } catch (e) { warn(e); }
      }
      return rows;
    }
    var vo = { exclude: this.id, ignore: ignore, filters: !off };
    out.rows = run(vo);
    out.applied = off ? [] : RK.data.applied(ds, vo);
    if (!out.rows.length && ds.rows.length && !off && opts.selectionFallback !== false) {
      var sel = out.applied.filter(function (x) { return x.spec.source && x.spec.source !== self.id; });
      if (sel.length) {
        var keys = sel.map(function (x) { return x.key; });
        var alt = run({ exclude: this.id, ignore: ignore.concat(keys), filters: true });
        if (alt.length) {
          out.rows = alt;
          out.ignored = sel;
          out.applied = out.applied.filter(function (x) { return keys.indexOf(x.key) < 0; });
        }
      }
    }
    return out;
  };

  Block.prototype.ctx = function () {
    var self = this;
    var opts = this.options();
    var ds = this.datasetId ? RK.data.get(this.datasetId) : null;
    var off = this.filtersOff(opts);
    function selExtra(opt, field) {
      opt = opt || {};
      // generic column names (type, source, step...) mean different things in different datasets:
      // their selections stay within this block's dataset unless a scope is given explicitly
      var scope = opt.scope || opts.crossFilterScope || (RK.data.isGenericField(field) ? 'dataset' : 'global');
      var extra = { either: opt.either, allowEmpty: opt.allowEmpty };
      if (opt.datasets) extra.datasets = opt.datasets;
      else if (scope === 'dataset' && ds) extra.datasets = [ds.id];
      return extra;
    }
    var v = this._view = this.view(opts);
    var rows = v.rows;
    function fieldOf(name) { return ds ? ds.field(name) : null; }
    var printing = runtime.printing;
    return {
      id: this.id,
      el: this.body,
      block: this.el,
      component: this.component,
      options: opts,
      enc: opts.encode || {},
      dataset: ds,
      rows: rows,
      allRows: ds ? ds.rows : [],
      field: fieldOf,
      title: function (name) { var f = fieldOf(name); return (f && f.title) || name; },
      fmtOf: function (name) { var f = fieldOf(name); return f ? f.format : null; },
      format: RK.format,
      theme: RK.theme.tokens(),
      store: RK.store,
      data: function (id) { return RK.data.get(id); },
      view: function (id, o) { return RK.data.view(id, util.merge({ exclude: self.id }, off ? { filters: false } : {}, o || {})); },
      /** Other blocks' selections ignored because they left this block empty (cross-filter safety). */
      ignoredSelections: v.ignored.map(function (x) { return x.key; }),
      /**
       * Cross-filter: toggle one value of this block's selection on `field`.
       * opt.scope: 'global' (default; every dataset with that field) | 'dataset' (only this block's dataset)
       * opt.either: second field for link tables (select a node on either end, e.g. source/target)
       * Block option crossFilterScope sets the default scope.
       */
      select: function (field, value, opt) {
        RK.store.toggleValue(self.id + ':' + field, field, value, self.id, selExtra(opt, field));
      },
      /** Replace the whole selection on `field` (brush / lasso). Empty array clears it unless opt.allowEmpty. */
      setSelection: function (field, values, opt) {
        RK.store.setValues(self.id + ':' + field, field, values, self.id, selExtra(opt, field));
      },
      selected: function (field) { var f = RK.store.filter(self.id + ':' + field); return f && f.values ? f.values : []; },
      clearSelection: function () { RK.store.clearFilters(self.id); },
      print: printing,
      motion: RK.motion.enabled && !printing,
      emit: function (type, payload) { RK.bus.emit(type, util.merge({ block: self.id }, payload || {})); }
    };
  };

  Block.prototype.render = function () {
    if (!this.def) return this.fail(new Error(t('unknownComponent', 'Unknown component "{id}" — is its script included?', { id: this.component })));
    if (this.def.needsData && this.datasetId && !RK.data.get(this.datasetId)) return this.fail(new Error(t('datasetNotFound', 'Dataset "{id}" not found', { id: this.datasetId })));
    var ctx = this.ctx();
    this.clearMessages();
    this.updateStatus();
    if (this.def.needsData && this.datasetId && !ctx.rows.length && !this.def.allowEmpty) {
      this.destroyInstance();
      this.message(t('noData', 'No data for the current filters'), true);
      this.state = 'empty';
      return;
    }
    try {
      if (this.instance && this.instance.update && this.state === 'rendered') this.instance.update(ctx);
      else {
        this.destroyInstance();
        this.instance = this.def.render(ctx) || {};
      }
      this.state = 'rendered';
      this.el.classList.add('is-rendered');
      keepFitLast();   // after any 'beforeprint' listener the component just added
    } catch (e) {
      this.fail(e);
    }
  };

  Block.prototype.refresh = function () { if (this.state !== 'idle') this.render(); };

  Block.prototype.rerender = function () {
    if (this.state === 'idle') return;
    this.destroyInstance();
    this.state = 'stale';
    this.render();
  };

  Block.prototype.setOptions = function (opts, replace) {
    this.userOptions = replace ? opts : util.merge({}, this.userOptions, opts);
    this._optsJson = null;
    this.addChoices();
    this.rerender();
    scheduleChrome();
  };

  Block.prototype.resize = function () {
    if (this.instance && this.instance.resize) { try { this.instance.resize(); } catch (e) { /* ignore */ } }
  };

  Block.prototype.destroyInstance = function () {
    if (this.instance && this.instance.destroy) { try { this.instance.destroy(); } catch (e) { /* ignore */ } }
    this.instance = null;
    if (this.body !== this.el || !this.el.classList.contains('rk-block')) {
      // clear residual DOM left by components that do not clean up after themselves
      while (this.body.firstChild) this.body.removeChild(this.body.firstChild);
    }
  };

  Block.prototype.destroy = function () {
    this.destroyInstance();
    if (this._statusEl) { this._statusEl.remove(); this._statusEl = null; }
    if (this._choicesEl) { this._choicesEl.remove(); this._choicesEl = null; }
    if (this._ro) this._ro.disconnect();
    if (this._unvis) this._unvis();
    var i = blocks.indexOf(this);
    if (i >= 0) blocks.splice(i, 1);
    this.state = 'destroyed';
  };

  Block.prototype.message = function (text, soft) {
    this._errorEl = h('div.rk-block__msg' + (soft ? '.is-soft' : '.is-error'), text);
    this.body.appendChild(this._errorEl);
  };
  Block.prototype.clearMessages = function () {
    if (this._errorEl) { this._errorEl.remove(); this._errorEl = null; }
  };
  Block.prototype.fail = function (e) {
    console.error('[RK] block "' + this.id + '" (' + this.component + ') failed:', e);
    this.destroyInstance();
    this.message((e && e.message) || String(e));
    this.state = 'error';
  };

  /** Toolbar: view data, export PNG/CSV, expand. */
  Block.prototype.addTools = function () {
    var self = this, opts = this.options();
    if (opts.tools === false || !this.el.classList.contains('rk-block') || this.el.querySelector('.rk-block__tools')) return;
    var bar = h('div.rk-block__tools');
    function btn(name, label, fn) {
      bar.appendChild(h('button.rk-iconbtn', { type: 'button', title: label, 'aria-label': label, html: icon(name), on: { click: fn } }));
    }
    if (this.datasetId && this.def && this.def.needsData) {
      btn('table', t('viewData', 'View data'), function () {
        var ds = RK.data.get(self.datasetId);
        if (!ds) return;
        var c = self.ctx();
        ui.modal(t('dataTitle', '{title} — {n} rows', { title: ds.title, n: c.rows.length }), ui.table(c.rows, ds.fields), { wide: true });
      });
      btn('download', t('downloadCSV', 'Download CSV'), function () {
        var ds = RK.data.get(self.datasetId);
        if (ds) util.download((self.id || ds.id) + '.csv', ds.toCSV(self.ctx().rows), 'text/csv;charset=utf-8');
      });
    }
    btn('image', t('downloadPNG', 'Download PNG'), function () {
      if (!self.instance) return;
      // charts export themselves; DOM components (tables, cards, KPI tiles) are rasterised via SVG foreignObject
      var job = self.instance.exportImage ? self.instance.exportImage() : ui.exportDOM(self.body);
      Promise.resolve(job).then(function (url) {
        if (!url) return;
        var a = document.createElement('a');
        a.href = url; a.download = (self.id || 'chart') + '.png';
        document.body.appendChild(a); a.click(); a.remove();
      }).catch(function (e) { console.warn('[RK] PNG export failed for', self.id, e); });
    });
    btn('expand', t('expand', 'Expand'), function () { self.expand(); });
    var head = this.el.querySelector(':scope > .rk-block__head');
    (head || this.el).appendChild(bar);
  };

  /** Insert el into the block head right after the title (and after `after` when given). */
  function placeInHead(head, el, after) {
    var ref = after && after.parentNode === head ? after : head.querySelector(':scope > .rk-block__title');
    head.insertBefore(el, ref ? ref.nextSibling : head.firstChild);
  }

  /**
   * Head badges: "Filtered" (filters that affect this block; hover lists them, × clears them) and the soft
   * "Selection not in this view" when other blocks' selections were ignored (see Block.view). options.badges: false hides both.
   */
  Block.prototype.updateStatus = function () {
    var head = this.el.querySelector(':scope > .rk-block__head');
    var v = this._view, ds = this.datasetId ? RK.data.get(this.datasetId) : null;
    var show = head && ds && this.def && this.def.needsData && this.options().badges !== false && v && (v.applied.length || v.ignored.length);
    if (!show) {
      if (this._statusEl) { this._statusEl.remove(); this._statusEl = null; this._statusSig = null; }
      return;
    }
    var applied = v.applied.map(function (x) { return { key: x.key, text: RK.data.describeFilter(x.spec, ds) }; });
    var ignored = v.ignored.map(function (x) { return { key: x.key, text: RK.data.describeFilter(x.spec, ds) }; });
    var sig = JSON.stringify([applied, ignored, RK.i18n && RK.i18n.locale]);
    if (this._statusEl && this._statusSig === sig && this._statusEl.parentNode === head) return;
    this._statusSig = sig;
    var wrap = this._statusEl || (this._statusEl = h('span.rk-block__status'));
    while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    if (applied.length) {
      var list = applied.map(function (x) { return x.text; });
      var keys = applied.map(function (x) { return x.key; });
      var tip = t('filteredBy', 'Filtered by') + t('colon', ': ').trim() + '\n' + list.join('\n');
      wrap.appendChild(h('span.rk-badge.rk-badge--filtered', { title: tip },
        h('span.rk-badge__icon', { 'aria-hidden': 'true', html: icon('filter') }),
        h('span.rk-badge__text', t('filtered', 'Filtered')),
        h('span.rk-sr-only', t('colon', ': ') + list.join('; ')),
        h('button.rk-badge__clear.rk-noprint', {
          type: 'button', title: t('clearFilters', 'Clear filters'), 'aria-label': t('clearFilters', 'Clear filters') + t('colon', ': ') + list.join('; '),
          on: { click: function (e) { e.stopPropagation(); keys.forEach(function (k) { RK.store.clearFilter(k); }); } }
        }, '\u00d7')));
    }
    if (ignored.length) {
      var il = ignored.map(function (x) { return x.text; }).join('; ');
      wrap.appendChild(h('span.rk-badge.rk-badge--soft', { title: t('selectionIgnored', 'Selections made in other charts ({list}) leave no data here, so this chart ignores them', { list: il }) },
        t('selectionNotInView', 'Selection not in this view')));
    }
    if (wrap.parentNode !== head) placeInHead(head, wrap);
  };

  /** Fields offered for one channel of options.choices ("*computed" = the dataset's computed / user metrics). */
  Block.prototype.choiceFields = function (list, ds) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (n) {
      if (n === '*computed') {
        if (ds) ds.fields.forEach(function (f) { if (f.computed && out.indexOf(f.name) < 0) out.push(f.name); });
      } else if (typeof n === 'string' && out.indexOf(n) < 0 && (!ds || ds.has(n))) out.push(n);
    });
    return out;
  };

  /**
   * Metric / dimension pickers: options.choices = {y: ['revenue', 'ebitda', '*computed'], x: [...]} renders one
   * compact select per channel in the head; picking a field sets options.encode[channel] (kept by this block across
   * filter changes) and re-renders. options.choiceLabels = {y: 'Metric'} adds a visible label.
   */
  Block.prototype.addChoices = function () {
    var self = this, opts = this.options(), choices = opts.choices;
    var head = this.el.querySelector(':scope > .rk-block__head');
    if (this._choicesEl) { this._choicesEl.remove(); this._choicesEl = null; }
    if (!head || !util.isObj(choices)) return;
    var ds = this.datasetId ? RK.data.get(this.datasetId) : null;
    var enc = opts.encode || {}, labels = util.isObj(opts.choiceLabels) ? opts.choiceLabels : {};
    var wrap = h('span.rk-block__choices');
    Object.keys(choices).forEach(function (channel) {
      var names = self.choiceFields(choices[channel], ds);
      var cur = Array.isArray(enc[channel]) ? enc[channel][0] : enc[channel];
      if (cur != null && names.indexOf(cur) < 0 && (!ds || ds.has(cur))) names.unshift(cur);
      if (names.length < 2) return;   // nothing to choose (yet: user metrics may add options later)
      var label = typeof labels[channel] === 'string' ? labels[channel] : null;
      var sel = h('select.rk-select.rk-select--sm.rk-block__choice', {
        'aria-label': label || t('choose', 'Choose {channel}', { channel: channel }), 'data-channel': channel
      }, names.map(function (n) {
        var f = ds && ds.field(n);
        return h('option', { value: n }, (f && f.title) || n);
      }));
      sel.value = cur != null && names.indexOf(cur) >= 0 ? cur : names[0];
      sel.addEventListener('change', function () { self.choose(channel, sel.value); });
      wrap.appendChild(label ? h('label.rk-block__choice-wrap', h('span.rk-block__choice-label', label), sel) : sel);
    });
    if (!wrap.childNodes.length) return;
    this._choicesEl = wrap;
    placeInHead(head, wrap, this._statusEl);
  };

  /** Show `field` on `channel` (what the picker does). Clears this block's own selection, which was on the old field. */
  Block.prototype.choose = function (channel, field) {
    var opts = this.options(), cur = (opts.encode || {})[channel];
    if (cur === field) return;
    RK.store.clearFilters(this.id);
    var enc = {};
    enc[channel] = field;
    this.setOptions({ encode: enc });
    RK.bus.emit('block:choice', { block: this.id, channel: channel, field: field });
  };

  /** Re-mount the same component full-screen in a modal. */
  Block.prototype.expand = function () {
    var self = this;
    var host = h('div.rk-block.rk-block--expanded', h('div.rk-block__body', { style: { '--rk-h': '70vh' } }));
    var titleEl = this.el.querySelector('.rk-block__title');
    var m = ui.modal(titleEl ? titleEl.textContent : this.component, host, {
      wide: true,
      onClose: function () { if (b) b.destroy(); }
    });
    var b = null;
    setTimeout(function () {
      b = mount(host, { component: self.component, data: self.datasetId, options: util.merge({}, self.userOptions, { tools: false }, self.filtersOff() ? { filters: false } : {}), lazy: false });
    }, 60);
    return m;
  };

  /* ------------------------------------------------------------------ *
   * Mounting
   * ------------------------------------------------------------------ */
  function mount(el, spec) {
    spec = spec || {};
    if (el.rkBlock && el.rkBlock.state !== 'destroyed') el.rkBlock.destroy();
    var b = new Block(el, spec);
    blocks.push(b);
    b.addTools();
    b.addChoices();
    if (runtime.booted) scheduleChrome();
    var lazy = spec.lazy !== false && !runtime.printing && (b.def ? b.def.lazy !== false : true);
    if (lazy) b._unvis = util.onVisible(el, function () { b.render(); }, '0px 0px -4% 0px');
    else b.render();
    if ('ResizeObserver' in global) {
      var lastW = 0, lastH = 0;
      b._ro = new ResizeObserver(util.rafThrottle(function () {
        var r = b.body.getBoundingClientRect();
        if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
        lastW = r.width; lastH = r.height;
        b.resize();
      }));
      b._ro.observe(b.body);
    }
    return b;
  }
  RK.mount = mount;
  RK.blocks = function () { return blocks.slice(); };
  RK.block = function (id) { for (var i = 0; i < blocks.length; i++) if (blocks[i].id === id) return blocks[i]; return null; };

  function renderAllNow() {
    blocks.forEach(function (b) {
      if (b.state === 'idle') { if (b._unvis) b._unvis(); b.render(); }
    });
  }
  runtime.renderAll = renderAllNow;

  /* ------------------------------------------------------------------ *
   * Store / theme wiring
   * ------------------------------------------------------------------ */
  RK.store.subscribe(function (changes) {
    blocks.forEach(function (b) {
      if (b.state === 'idle' || b.state === 'destroyed') return;
      // pure UI blocks (no dataset) get the raw change list; bound blocks refresh like data blocks
      if (!b.def || (!b.def.needsData && !b.datasetId)) {
        if (b.instance && b.instance.onStore) b.instance.onStore(changes);
        return;
      }
      if (b.instance && b.instance.onStore && !b.def.needsData) { b.instance.onStore(changes); return; }
      var ids = b.datasetIds();
      // a block that ignores filters (page data-rk-filters="off", options.filters false) only follows params / data
      var relevant = b.filtersOff() ? changes.filter(function (c) { return c.type !== 'filter'; }) : changes;
      var hit = relevant.length > 0 && ids.some(function (id) {
        var ds = RK.data.get(id);
        return ds && RK.data.affected(ds, relevant);
      });
      // a block whose own selection changed must re-render to update highlighting
      var own = changes.some(function (c) { return c.type === 'filter' && c.key.indexOf(b.id + ':') === 0; });
      // options that reference a parameter ("@wacc") follow it
      var optsJson = b._optsJson || (b._optsJson = JSON.stringify(b.userOptions || {}));
      var paramHit = changes.some(function (c) { return c.type === 'param' && optsJson.indexOf('"@' + c.key + '"') >= 0; });
      var stateHit = changes.some(function (c) { return c.type === 'state' && b.def.listens && b.def.listens.indexOf(c.key) >= 0; });
      if (hit || own || stateHit || paramHit) b.refresh();
    });
    updateChrome();
  });

  RK.bus.on('theme:changed', function () {
    blocks.forEach(function (b) { b.rerender(); });
  });
  RK.bus.on('data:changed', util.debounce(function () {
    blocks.forEach(function (b) {
      if (b.state === 'destroyed') return;
      if (b._choicesEl || b.options().choices) b.addChoices();   // "*computed" follows new / removed metrics
      if (b.def && (b.def.needsData || b.datasetId) && !(b.instance && b.instance.onStore && !b.def.needsData)) b.refresh();
    });
    updateChrome();
  }, 30));

  /* ------------------------------------------------------------------ *
   * Report chrome that follows the data: title templates, "Filtered view" stamps
   * ------------------------------------------------------------------ */
  var warnedTpl = Object.create(null);

  /** Dataset a page-level template without "<dataset>:" uses: the first bound block on its page. */
  function pageDataset(el) {
    var page = pageOf(el), b = page && page.querySelector('[data-rk-data]');
    return b ? b.getAttribute('data-rk-data') : null;
  }

  /**
   * Fill every [data-rk-template] element (textContent only) from the currently filtered data. Inside a block the
   * block's own dataset is the default and its rows are what the block shows; elsewhere the page's filter setting applies.
   */
  function refreshTemplates(root) {
    if (!RK.template || !RK.data._ready) return;
    util.qsa('[data-rk-template]', root || document).forEach(function (el) {
      var tpl = el.getAttribute('data-rk-template');
      if (!tpl) return;
      var be = el.closest('.rk-block'), b = be && be.rkBlock && be.rkBlock.state !== 'destroyed' ? be.rkBlock : null;
      var off = pageFiltersOff(el);
      var text = RK.template.render(tpl, {
        dataset: b ? b.datasetId : be && be.getAttribute('data-rk-data') ? be.getAttribute('data-rk-data') : pageDataset(el),
        filters: !off,
        rows: function (ds) { return b && ds.id === b.datasetId ? b.view().rows : RK.data.view(ds, { filters: !off }); },
        onError: function (e, ph) {
          var k = tpl + '\u0001' + ph.src;
          if (!warnedTpl[k]) { warnedTpl[k] = 1; console.warn('[RK] title template {{' + ph.src + '}}:', e.message); }
        }
      });
      if (el.textContent !== text) el.textContent = text;
    });
  }

  /** Filters applied to the data blocks of a page -> unique [{key, text}] (empty for data-rk-filters="off"). */
  function pageFilters(page) {
    var out = [], seen = Object.create(null);
    if (pageFiltersOff(page)) return out;
    blocks.forEach(function (b) {
      if (b.state === 'destroyed' || !b.def || !b.def.needsData || !b.datasetId || !page.contains(b.el)) return;
      var ds = RK.data.get(b.datasetId);
      if (!ds) return;
      var opts = b.options();
      if (b.filtersOff(opts)) return;
      // a rendered block's last view is current (blocks re-render before the chrome updates); others are computed
      var v = (b.state === 'rendered' || b.state === 'empty') && b._view ? b._view : b.view(opts);
      v.applied.forEach(function (x) {
        if (seen[x.key]) return;
        seen[x.key] = 1;
        out.push({ key: x.key, text: RK.data.describeFilter(x.spec, ds) });
      });
    });
    return out;
  }

  /** "Filtered view: Region = Europe · Sector = Automation" in the foot of every page whose blocks are filtered. */
  function refreshStamps() {
    util.qsa('.rk-page').forEach(function (page) {
      var foot = page.querySelector(':scope > .rk-page__foot');
      var stamp = foot ? foot.querySelector(':scope > .rk-page__filtered') : null;
      var list = foot ? pageFilters(page) : [];
      page.classList.toggle('is-filtered', list.length > 0);
      if (!list.length) { if (stamp) stamp.remove(); return; }
      if (!stamp) {
        stamp = h('span.rk-page__filtered', { role: 'status' });
        foot.insertBefore(stamp, foot.querySelector(':scope > .rk-page__conf, :scope > .rk-page__num'));
      }
      var text = t('filteredView', 'Filtered view') + t('colon', ': ') + list.map(function (x) { return x.text; }).join(' \u00b7 ');
      if (stamp.textContent !== text) { stamp.textContent = text; stamp.title = text; }
    });
  }

  function updateChrome() {
    if (!runtime.booted || !RK.data._ready) return;
    try { refreshTemplates(); } catch (e) { console.error('[RK] title templates failed', e); }
    try { refreshStamps(); } catch (e2) { console.error('[RK] filtered-view stamps failed', e2); }
  }
  var chromeQueued = false;
  function scheduleChrome() {
    if (chromeQueued) return;
    chromeQueued = true;
    Promise.resolve().then(function () { chromeQueued = false; updateChrome(); });
  }
  runtime.updateChrome = updateChrome;
  runtime.refreshTemplates = refreshTemplates;
  runtime.refreshStamps = refreshStamps;
  runtime.pageFilters = pageFilters;

  /* ------------------------------------------------------------------ *
   * Page chrome: nav, progress, page numbers, theme switch, print
   * ------------------------------------------------------------------ */
  function buildNav() {
    var nav = util.qs('[data-rk-nav]');
    var pages = util.qsa('[data-rk-page]');
    pages.forEach(function (p, i) {
      var num = p.querySelector('.rk-page__num');
      if (num && !num.textContent) num.textContent = String(i + 1);
    });
    if (!nav || !pages.length) return;
    var list = h('ol.rk-nav__list');
    var links = pages.map(function (p, i) {
      if (!p.id) p.id = 'page-' + (i + 1);
      var kicker = p.querySelector('.rk-page__kicker');
      var a = h('a.rk-nav__link', { href: '#' + p.id },
        h('span.rk-nav__num', String(i + 1).padStart(2, '0')),
        h('span.rk-nav__text', p.getAttribute('data-rk-page') || (kicker && kicker.textContent.trim() ? kicker.textContent : t('page', 'Page {n}', { n: i + 1 }))));
      list.appendChild(h('li', a));
      return a;
    });
    nav.appendChild(list);
    if ('IntersectionObserver' in global) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var i = pages.indexOf(e.target);
          links.forEach(function (l, j) { l.classList.toggle('is-active', i === j); });
        });
      }, { rootMargin: '-40% 0px -55% 0px' });
      pages.forEach(function (p) { io.observe(p); });
    }
  }

  function buildProgress() {
    if (util.qs('.rk-progress')) return;
    var bar = h('div.rk-progress', h('div.rk-progress__bar'));
    document.body.appendChild(bar);
    var fill = bar.firstChild;
    var update = util.rafThrottle(function () {
      var max = document.documentElement.scrollHeight - global.innerHeight;
      fill.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, global.scrollY / max) : 0) + ')';
    });
    global.addEventListener('scroll', update, { passive: true });
    update();
  }

  function wireThemeSwitch() {
    util.qsa('[data-rk-theme-switch]').forEach(function (sel) {
      if (sel.tagName === 'SELECT' && !sel.options.length) {
        RK.theme.list.forEach(function (name) { sel.appendChild(h('option', { value: name }, RK.theme.label ? RK.theme.label(name) : (RK.theme.labels[name] || name))); });
      }
      sel.value = document.documentElement.getAttribute('data-rk-theme') || RK.theme.list[0];
      sel.addEventListener('change', function () { RK.theme.set(sel.value); });
    });
    util.qsa('[data-rk-print]').forEach(function (b) {
      b.addEventListener('click', function () { global.print(); });
    });
    util.qsa('[data-rk-nav-toggle]').forEach(function (b) {
      b.addEventListener('click', function () { document.body.classList.toggle('rk-nav-open'); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Print fit: block content that overflows its body (a wide comps table, a tall grid, a Tabulator holder) is
   * scaled down with CSS zoom so the printed page shows all of it, instead of a clipped scroll viewport.
   * ------------------------------------------------------------------ */
  var PRINT_MIN_ZOOM = 0.55;
  var fitted = [];

  function overflows(el) { return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1; }
  function isScroller(el) {
    var cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX + ' ' + cs.overflowY + ' ' + cs.overflow);
  }
  /** Fit one block body -> {block, zoom, clipped, ...} or null when nothing overflows. */
  function fitBody(b) {
    var body = b.body;
    if (!body || body === b.el || !body.isConnected || !body.firstElementChild) return null;
    // maps fit their own bounds; Leaflet's overlay panes extend past the (clipping) container by design
    if (body.classList.contains('leaflet-container') || body.querySelector('.leaflet-container')) return null;
    var bw = body.clientWidth, bh = body.clientHeight;
    if (!bw || !bh) return null;
    // nested scroll containers (table wrappers, Tabulator holders) that hide part of their content
    var nested = [].filter.call(body.querySelectorAll('*'), function (el) {
      return !(el instanceof SVGElement) && overflows(el) && isScroller(el);
    });
    if (!overflows(body) && !nested.length) return null;
    var rec = { block: b, unclamped: [], zoomed: [], body: null, zoom: 1, clipped: false, box: [bw, bh], content: null };
    // unclamp them (and the boxes between them and the body) so the content takes its natural size. A class with
    // !important rules (components.css), not inline styles: a component that re-lays out during print (Tabulator
    // sets holder heights inline on resize) cannot clamp them again.
    nested.forEach(function (el) {
      for (var n = el; n && n !== body; n = n.parentElement) {
        if (rec.unclamped.indexOf(n) < 0) { n.classList.add('rk-pf-unclamp'); rec.unclamped.push(n); }
      }
    });
    // ... then scale the body's content to the box it had on the page (scroll sizes: the same, unzoomed, units as client sizes)
    var w = Math.max(body.scrollWidth, bw), hgt = Math.max(body.scrollHeight, bh);
    var z = Math.min(1, bw / w, bh / hgt);
    rec.content = [w, hgt];
    if (z > 0.995) { restore(rec); return null; }
    if (z < PRINT_MIN_ZOOM) { z = PRINT_MIN_ZOOM; rec.clipped = true; }
    z = Math.floor(z * 1000) / 1000;
    [].forEach.call(body.children, function (c) {
      if (c.classList.contains('rk-block__msg')) return;
      rec.zoomed.push({ el: c, prev: c.style.getPropertyValue('zoom'), prio: c.style.getPropertyPriority('zoom') });
      c.style.setProperty('zoom', String(z), 'important');
    });
    if (rec.clipped) { rec.body = { el: body, prev: body.style.getPropertyValue('overflow') }; body.style.setProperty('overflow', 'hidden'); }
    rec.zoom = z;
    b.el.classList.add('is-print-fit');
    return rec;
  }
  function restore(rec) {
    rec.unclamped.forEach(function (n) { n.classList.remove('rk-pf-unclamp'); });
    rec.zoomed.forEach(function (x) { if (x.prev) x.el.style.setProperty('zoom', x.prev, x.prio); else x.el.style.removeProperty('zoom'); });
    if (rec.body) { if (rec.body.prev) rec.body.el.style.setProperty('overflow', rec.body.prev); else rec.body.el.style.removeProperty('overflow'); }
    rec.block.el.classList.remove('is-print-fit');
  }

  /**
   * Scale every overflowing block's content to fit its body (CSS zoom on the body's children, min 0.55; content that
   * still does not fit is clipped at the body). Idempotent; runs on beforeprint / print media and can be called after
   * emulating print media. Returns [{id, zoom, clipped, box: [w, h], content: [w, h]}] (CSS px, before zoom).
   */
  function printFit() {
    printUnfit();
    blocks.forEach(function (b) {
      if (b.state !== 'rendered' || !b.el.isConnected || b.el.closest('.rk-modal')) return;
      if (b.options().printFit === false) return;
      try { var rec = fitBody(b); if (rec) fitted.push(rec); } catch (e) { console.warn('[RK] print fit failed for', b.id, e); }
    });
    return fitted.map(function (r) { return { id: r.block.id, zoom: Math.round(r.zoom * 1000) / 1000, clipped: r.clipped, box: r.box, content: r.content }; });
  }
  function printUnfit() {
    fitted.forEach(restore);
    fitted = [];
  }
  runtime.printFit = printFit;
  runtime.printUnfit = printUnfit;

  /*
   * Print sequence (Chrome): 'beforeprint' (styles are still screen styles) -> matchMedia('print') change -> snapshot ->
   * 'afterprint'. DOM changes made in either handler reach the paper; measurements see the screen layout, which
   * html.rk-printing lays out at the print page width (print.css). Components add their own 'beforeprint' handlers
   * (Tabulator swaps in its print table), so the fit runs in a listener kept LAST on window, and again on the media change.
   */
  function enterPrint() {
    if (runtime.printing) return;
    runtime.printing = true;
    document.documentElement.classList.add('rk-printing');
    renderAllNow();
    // rebuild already-rendered blocks so they see ctx.print (no zoom sliders, no animation)
    blocks.forEach(function (b) { if (b.state === 'rendered') b.refresh(); b.resize(); });
  }
  var printDispatch = false;   // inside the 'beforeprint' dispatch: a listener removed now would not run for it
  function beforePrint() {
    printDispatch = true;
    setTimeout(function () { printDispatch = false; }, 0);
    enterPrint();
  }
  function fitLast() { printDispatch = false; if (runtime.printing) printFit(); }
  /** Move the print-fit listener behind every 'beforeprint' listener added so far (blocks call it after rendering). */
  function keepFitLast() {
    if (printDispatch) return;
    global.removeEventListener('beforeprint', fitLast);
    global.addEventListener('beforeprint', fitLast);
  }
  function afterPrint() {
    if (!runtime.printing) return;
    printUnfit();
    runtime.printing = false;
    document.documentElement.classList.remove('rk-printing');
    blocks.forEach(function (b) { if (b.state === 'rendered') b.refresh(); b.resize(); });
  }
  global.addEventListener('beforeprint', beforePrint);
  keepFitLast();
  global.addEventListener('afterprint', afterPrint);
  if (global.matchMedia) {
    var mq = global.matchMedia('print');
    var onMq = function (e) { if (e.matches) { enterPrint(); printFit(); } else afterPrint(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  RK.boot = function (cfg) {
    cfg = cfg || {};
    if (runtime.booted && !cfg.force) return Promise.resolve(RK);
    runtime.booted = true;
    if (RK.i18n) RK.i18n.detect();
    // theme preference of THIS report (key namespaced by RK.data.reportKey(); file:// reports may share storage)
    function applySavedTheme() {
      if (cfg.ignoreSavedTheme) return false;
      var saved = cfg.theme || RK.theme.saved();
      var root = document.documentElement;
      if (!saved || RK.theme.list.indexOf(saved) < 0 || root.getAttribute('data-rk-theme') === saved) return false;
      root.setAttribute('data-rk-theme', saved);
      return true;
    }
    RK.theme.init();
    if (applySavedTheme()) RK.theme.refresh();
    document.documentElement.classList.add('rk-js');
    return RK.data.load(cfg).catch(function (e) {
      console.error(e);
      var msg = h('div.rk-boot-error', h('strong', t('dataLoadError', 'Report data could not be loaded.') + ' '), (e && e.message) || String(e));
      document.body.insertBefore(msg, document.body.firstChild);
      return RK.data;
    }).then(function () {
      if (applySavedTheme()) RK.theme.refresh();   // the report key is complete once the manifest is loaded
      fillMeta();
      try { refreshTemplates(); } catch (e) { console.error('[RK] title templates failed', e); }   // before the nav reads kickers
      buildNav();
      wireThemeSwitch();
      if (cfg.progress !== false) buildProgress();
      RK.motion.reveal(document);
      util.qsa('[data-rk]', cfg.root || document).forEach(function (el) {
        // pages render controls (filter bars) immediately; charts lazily
        var def = RK.components[el.getAttribute('data-rk')];
        mount(el, { lazy: def ? def.lazy !== false : true });
      });
      // labels are measured with canvas text metrics: once web fonts arrive, re-lay out what was drawn before
      if (document.fonts && document.fonts.status !== 'loaded' && document.fonts.ready) {
        document.fonts.ready.then(function () {
          blocks.forEach(function (b) { if (b.state === 'rendered') { b.resize(); if (b.def && b.def.relayoutOnFonts !== false) b.refresh(); } });
        });
      }
      updateChrome();
      RK.bus.emit('report:ready', RK);
      return RK;
    });
  };

  /** Fill [data-rk-meta="title"] etc. from data/manifest.json report meta. */
  function fillMeta() {
    var rep = (RK.data.manifest && RK.data.manifest.report) || {};
    util.qsa('[data-rk-meta]').forEach(function (el) {
      var k = el.getAttribute('data-rk-meta');
      var dateFmt = RK.i18n && RK.i18n.lang() === 'zh' ? 'yyyy"\u5e74"m"\u6708"d"\u65e5"' : 'dd mmmm yyyy';
      if (rep[k] != null && !el.textContent.trim()) el.textContent = k === 'date' ? RK.format(rep[k], dateFmt) : rep[k];
    });
  }

  function autoboot() {
    var flag = document.documentElement.getAttribute('data-rk-autoboot') || (document.body && document.body.getAttribute('data-rk-autoboot'));
    if (flag === 'false') return;
    RK.boot();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoboot);
    else setTimeout(autoboot, 0);
  }
})(typeof window !== 'undefined' ? window : this);
