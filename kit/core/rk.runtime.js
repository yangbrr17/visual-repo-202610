/*!
 * ReportKit runtime — boots a report page:
 *   load data -> read theme tokens -> mount every [data-rk] block (lazily, on scroll) ->
 *   keep blocks in sync with filters / params / theme -> navigation, toolbar, print.
 *
 * Imperative API (used by the gallery):
 *   var block = RK.mount(el, { component: 'bar', data: 'peers', options: {...} });
 *   block.setOptions({...}); block.destroy();
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});
  var util = RK.util, h = util.h;

  var blocks = [];
  var runtime = RK.runtime = { printing: false, booted: false };

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
    print: '<path d="M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z"/>'
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
            h('button.rk-iconbtn', { type: 'button', 'aria-label': 'Close', html: icon('close'), on: { click: function () { close(); } } })),
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
      if (rows.length > max) wrap.appendChild(h('p.rk-muted', 'Showing first ' + max + ' of ' + rows.length + ' rows.'));
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

  Block.prototype.ctx = function () {
    var self = this;
    var opts = this.options();
    var ds = this.datasetId ? RK.data.get(this.datasetId) : null;
    var viewOpts = { exclude: this.id, ignore: opts.ignoreFilters, filters: opts.filters !== false };
    var rows = ds ? RK.data.view(ds, viewOpts) : [];
    if (ds && opts.where) {
      try { rows = rows.filter(RK.expr.compile(opts.where, { fields: ds.fields }).eval); } catch (e) { console.warn('[RK] bad "where" on', this.id, e.message); }
    }
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
      view: function (id, o) { return RK.data.view(id, util.merge({ exclude: self.id }, o || {})); },
      select: function (field, value) { RK.store.toggleValue(self.id + ':' + field, field, value, self.id); },
      selected: function (field) { var f = RK.store.filter(self.id + ':' + field); return f && f.values ? f.values : []; },
      clearSelection: function () { RK.store.clearFilters(self.id); },
      print: printing,
      motion: RK.motion.enabled && !printing,
      emit: function (type, payload) { RK.bus.emit(type, util.merge({ block: self.id }, payload || {})); }
    };
  };

  Block.prototype.render = function () {
    if (!this.def) return this.fail(new Error('Unknown component "' + this.component + '" — is its script included?'));
    if (this.def.needsData && this.datasetId && !RK.data.get(this.datasetId)) return this.fail(new Error('Dataset "' + this.datasetId + '" not found'));
    var ctx = this.ctx();
    this.clearMessages();
    if (this.def.needsData && this.datasetId && !ctx.rows.length && !this.def.allowEmpty) {
      this.destroyInstance();
      this.message('No data for the current filters', true);
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
    this.rerender();
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
      btn('table', 'View data', function () {
        var ds = RK.data.get(self.datasetId);
        if (!ds) return;
        var c = self.ctx();
        ui.modal(ds.title + ' — ' + c.rows.length + ' rows', ui.table(c.rows, ds.fields), { wide: true });
      });
      btn('download', 'Download CSV', function () {
        var ds = RK.data.get(self.datasetId);
        if (ds) util.download((self.id || ds.id) + '.csv', ds.toCSV(self.ctx().rows), 'text/csv;charset=utf-8');
      });
    }
    btn('image', 'Download PNG', function () {
      if (!self.instance || !self.instance.exportImage) return;
      Promise.resolve(self.instance.exportImage()).then(function (url) {
        if (!url) return;
        var a = document.createElement('a');
        a.href = url; a.download = (self.id || 'chart') + '.png';
        document.body.appendChild(a); a.click(); a.remove();
      });
    });
    btn('expand', 'Expand', function () { self.expand(); });
    var head = this.el.querySelector(':scope > .rk-block__head');
    (head || this.el).appendChild(bar);
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
      b = mount(host, { component: self.component, data: self.datasetId, options: util.merge({}, self.userOptions, { tools: false }), lazy: false });
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
      if (!b.def || !b.def.needsData) {
        if (b.instance && b.instance.onStore) b.instance.onStore(changes);
        return;
      }
      var ids = b.datasetIds();
      var hit = ids.some(function (id) {
        var ds = RK.data.get(id);
        return ds && RK.data.affected(ds, changes);
      });
      // a block whose own selection changed must re-render to update highlighting
      var own = changes.some(function (c) { return c.type === 'filter' && c.key.indexOf(b.id + ':') === 0; });
      var stateHit = changes.some(function (c) { return c.type === 'state' && b.def.listens && b.def.listens.indexOf(c.key) >= 0; });
      if (hit || own || stateHit) b.refresh();
    });
  });

  RK.bus.on('theme:changed', function () {
    blocks.forEach(function (b) { b.rerender(); });
  });
  RK.bus.on('data:changed', util.debounce(function () {
    blocks.forEach(function (b) { if (b.def && b.def.needsData) b.refresh(); });
  }, 30));

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
        h('span.rk-nav__text', p.getAttribute('data-rk-page') || (kicker ? kicker.textContent : 'Page ' + (i + 1))));
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
        RK.theme.list.forEach(function (t) { sel.appendChild(h('option', { value: t }, RK.theme.labels[t] || t)); });
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

  function beforePrint() {
    if (runtime.printing) return;
    runtime.printing = true;
    document.documentElement.classList.add('rk-printing');
    renderAllNow();
    blocks.forEach(function (b) { b.resize(); });
  }
  function afterPrint() {
    runtime.printing = false;
    document.documentElement.classList.remove('rk-printing');
    blocks.forEach(function (b) { b.resize(); });
  }
  global.addEventListener('beforeprint', beforePrint);
  global.addEventListener('afterprint', afterPrint);
  if (global.matchMedia) {
    var mq = global.matchMedia('print');
    var onMq = function (e) { if (e.matches) beforePrint(); else afterPrint(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  RK.boot = function (cfg) {
    cfg = cfg || {};
    if (runtime.booted && !cfg.force) return Promise.resolve(RK);
    runtime.booted = true;
    try {
      var saved = cfg.theme || (global.localStorage && localStorage.getItem('rk:theme'));
      if (saved && RK.theme.list.indexOf(saved) >= 0 && !cfg.ignoreSavedTheme) document.documentElement.setAttribute('data-rk-theme', saved);
    } catch (e) { /* storage unavailable */ }
    RK.theme.init();
    document.documentElement.classList.add('rk-js');
    return RK.data.load(cfg).catch(function (e) {
      console.error(e);
      var msg = h('div.rk-boot-error', h('strong', 'Report data could not be loaded. '), (e && e.message) || String(e));
      document.body.insertBefore(msg, document.body.firstChild);
      return RK.data;
    }).then(function () {
      fillMeta();
      buildNav();
      wireThemeSwitch();
      if (cfg.progress !== false) buildProgress();
      RK.motion.reveal(document);
      util.qsa('[data-rk]', cfg.root || document).forEach(function (el) {
        // pages render controls (filter bars) immediately; charts lazily
        var def = RK.components[el.getAttribute('data-rk')];
        mount(el, { lazy: def ? def.lazy !== false : true });
      });
      RK.bus.emit('report:ready', RK);
      return RK;
    });
  };

  /** Fill [data-rk-meta="title"] etc. from data/manifest.json report meta. */
  function fillMeta() {
    var rep = (RK.data.manifest && RK.data.manifest.report) || {};
    util.qsa('[data-rk-meta]').forEach(function (el) {
      var k = el.getAttribute('data-rk-meta');
      if (rep[k] != null && !el.textContent.trim()) el.textContent = k === 'date' ? RK.format(rep[k], 'dd mmmm yyyy') : rep[k];
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
