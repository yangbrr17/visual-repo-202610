/*!
 * ReportKit core — namespace, component registry, event bus, DOM utilities.
 * Classic script (no ES modules) so reports open from file:// without a server.
 */
(function (global) {
  'use strict';

  var RK = global.RK || (global.RK = {});
  RK.version = '0.1.0';

  /* ------------------------------------------------------------------ *
   * Event emitter
   * ------------------------------------------------------------------ */
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (type, fn) {
    (this._h[type] || (this._h[type] = [])).push(fn);
    var self = this;
    return function off() { self.off(type, fn); };
  };
  Emitter.prototype.off = function (type, fn) {
    var list = this._h[type];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  Emitter.prototype.emit = function (type, payload) {
    var list = (this._h[type] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error('[RK] listener error on "' + type + '"', e); }
    }
  };
  RK.Emitter = Emitter;
  RK.bus = new Emitter();

  /* ------------------------------------------------------------------ *
   * Utilities
   * ------------------------------------------------------------------ */
  var util = RK.util = {};

  util.isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  util.isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  util.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  util.uid = (function () { var n = 0; return function (p) { return (p || 'rk') + '-' + (++n).toString(36); }; })();

  /** Deep merge plain objects (arrays are replaced, not merged). */
  util.merge = function merge(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!util.isObj(src)) continue;
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var sv = src[k];
        if (util.isObj(sv) && util.isObj(target[k])) target[k] = merge({}, target[k], sv);
        else if (util.isObj(sv)) target[k] = merge({}, sv);
        else target[k] = sv;
      }
    }
    return target;
  };

  util.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  };

  util.rafThrottle = function (fn) {
    var queued = false, lastArgs;
    return function () {
      lastArgs = arguments;
      if (queued) return;
      queued = true;
      (global.requestAnimationFrame || setTimeout)(function () { queued = false; fn.apply(null, lastArgs); });
    };
  };

  util.escapeHTML = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  util.qs = function (sel, root) { return (root || document).querySelector(sel); };
  util.qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /**
   * Tiny hyperscript: h('div.rk-x#id', {attrs, on:{click}}, children...)
   * Children may be strings, nodes, arrays, null.
   */
  util.h = function (tag, props) {
    var m = String(tag).match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i) || [];
    var el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, function (_, t, v) {
      if (t === '.') el.classList.add(v); else el.id = v;
    });
    var kids = Array.prototype.slice.call(arguments, 2);
    // second argument is a props bag only when it is a plain object; data values must be passed as children
    // (dataset cells are normalised to scalars by RK.Dataset, so a data cell can never become props)
    if (props && (typeof props !== 'object' || props.nodeType || Array.isArray(props) || Object.getPrototypeOf(props) !== Object.prototype)) { kids.unshift(props); props = null; }
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v == null || v === false) continue;
        if (k === 'on') { for (var ev in v) el.addEventListener(ev, v[ev]); }
        else if (k === 'style' && typeof v === 'object') { for (var s in v) el.style.setProperty(s, v[s]); }
        else if (k === 'class' || k === 'className') { String(v).split(/\s+/).filter(Boolean).forEach(function (c) { el.classList.add(c); }); }
        else if (k === 'html') { el.innerHTML = v; }
        else if (k === 'text') { el.textContent = v; }
        else if (k === 'dataset') { for (var d in v) el.dataset[d] = v[d]; }
        else if (v === true) { el.setAttribute(k, ''); }
        else { el.setAttribute(k, v); }
      }
    }
    (function add(list) {
      list.forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) add(c);
        else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return el;
  };

  /** Read JSON options from data-rk-options="..." or a child <script type="application/json" data-rk-options>. */
  util.readOptions = function (el) {
    var out = {};
    var attr = el.getAttribute('data-rk-options');
    if (attr) {
      try { out = JSON.parse(attr); } catch (e) { console.error('[RK] bad data-rk-options JSON on', el, e); }
    }
    var script = el.querySelector(':scope > script[type="application/json"][data-rk-options]');
    if (script) {
      try { util.merge(out, JSON.parse(script.textContent)); } catch (e2) { console.error('[RK] bad options <script> JSON in', el, e2); }
    }
    return out;
  };

  /** Run cb once when el first becomes visible (or immediately when IO is unavailable). */
  util.onVisible = function (el, cb, rootMargin) {
    if (!('IntersectionObserver' in global)) { cb(); return function () {}; }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); cb(); return; }
      }
    }, { rootMargin: rootMargin || '0px 0px -8% 0px' });
    io.observe(el);
    return function () { io.disconnect(); };
  };

  /** Group rows by key fn → Map(key → rows[]) preserving first-seen order. */
  util.groupBy = function (rows, keyFn) {
    var map = new Map();
    for (var i = 0; i < rows.length; i++) {
      var k = keyFn(rows[i]);
      var g = map.get(k);
      if (!g) map.set(k, g = []);
      g.push(rows[i]);
    }
    return map;
  };

  /** Balanced grid columns: as many as fit at minW, with rows evened out (6 -> 3x2 rather than 4+2). */
  util.balancedCols = function (n, width, minW) {
    if (!n) return 1;
    var fit = Math.max(1, Math.min(n, Math.floor(width / (minW || 160))));
    var rows = Math.ceil(n / fit);
    return Math.ceil(n / rows);
  };

  util.unique = function (arr) {
    var seen = new Set(), out = [];
    for (var i = 0; i < arr.length; i++) if (!seen.has(arr[i])) { seen.add(arr[i]); out.push(arr[i]); }
    return out;
  };

  util.extent = function (arr) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v == null || !isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return lo === Infinity ? [0, 0] : [lo, hi];
  };

  /** "nice" rounding for axis bounds. */
  util.niceStep = function (span, count) {
    var raw = span / Math.max(1, count || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  };

  /** Download a Blob / text as a file (used by export tools). */
  util.download = function (filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ------------------------------------------------------------------ *
   * i18n — runtime / UI strings
   * ------------------------------------------------------------------ *
   *   RK.i18n.locale                       'en' | 'zh-CN' | ... (from <meta name="rk:locale">, else <html lang>)
   *   RK.i18n.t('viewData', 'View data')   string for the current locale; {name} placeholders filled from vars:
   *   RK.i18n.t('showingFirst', 'Showing first {max} of {n} rows.', {max: 500, n: 812})
   *   RK.i18n.add('zh-CN', {myKey: '…'})   components register their own strings (merged into the pack)
   *   RK.i18n.set('zh-CN')                 switch at runtime (emits 'i18n:changed'; RK.format follows)
   * Lookup order: exact locale pack ('zh-CN'), the language's pack ('zh' -> 'zh-CN'), 'en', the fallback, the key —
 * so a component's own key (with its English text as the fallback) works in English before any pack lists it.
   * Strings are plain text: callers put them in textContent / attributes, never innerHTML.
   */
  var PACKS = Object.create(null);
  PACKS.en = {
    close: 'Close', viewData: 'View data', downloadCSV: 'Download CSV', downloadPNG: 'Download PNG', downloadSVG: 'Download SVG',
    expand: 'Expand', noData: 'No data for the current filters', reset: 'Reset', resetAll: 'Reset all', resetZoom: 'Reset zoom',
    resetView: 'Reset view', clear: 'Clear', clearFilters: 'Clear filters', clearSelection: 'Clear selection',
    filtered: 'Filtered', filteredView: 'Filtered view', filteredBy: 'Filtered by', filters: 'Filters', activeFilters: 'Active filters',
    removeFilter: 'Remove filter {label}', selection: 'Selection', selectionNotInView: 'Selection not in this view',
    selectionIgnored: 'Selections made in other charts ({list}) leave no data here, so this chart ignores them',
    dataTitle: '{title} — {n} rows', rowsCount: '{n} rows', showingFirst: 'Showing first {max} of {n} rows.',
    dataLoadError: 'Report data could not be loaded.', page: 'Page {n}', contents: 'Contents', print: 'Print', theme: 'Theme',
    'theme.navy': 'Navy classic', 'theme.bronze': 'Bronze & ivory', 'theme.slate': 'Slate modern', 'theme.ink': 'Ink (dark)',
    colon: ': ', listSep: ', ', choose: 'Choose {channel}', metric: 'Metric', dimension: 'Dimension', field: 'Field', value: 'Value', dataset: 'Dataset',
    yes: 'Yes', no: 'No', none: 'None', all: 'All', other: 'Other', others: 'Others', total: 'Total', subtotal: 'Subtotal',
    average: 'Average', mean: 'Mean', median: 'Median', min: 'Min', max: 'Max', sum: 'Sum', count: 'Count',
    high: 'High', low: 'Low', current: 'Current', search: 'Search', searchFor: 'Search {label}…', loading: 'Loading…',
    apply: 'Apply', cancel: 'Cancel', add: 'Add', remove: 'Remove', run: 'Run', copy: 'Copy', copied: 'Copied', export: 'Export',
    query: 'Query', builder: 'Builder', examples: 'Examples', history: 'History', results: 'Results', columns: 'Columns', rows: 'Rows',
    addAsMetric: 'Add as metric', myMetrics: 'My metrics', removeMetric: 'Remove metric {name}', noMetrics: 'No saved metrics',
    metricAdded: 'Metric "{name}" added', sortAsc: 'Sort ascending', sortDesc: 'Sort descending', previous: 'Previous', next: 'Next',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', source: 'Source', notes: 'Notes', scenario: 'Scenario', points: 'points',
    unknownComponent: 'Unknown component "{id}" — is its script included?', datasetNotFound: 'Dataset "{id}" not found'
  };
  PACKS['zh-CN'] = {
    close: '关闭', viewData: '查看数据', downloadCSV: '下载 CSV', downloadPNG: '下载 PNG', downloadSVG: '下载 SVG',
    expand: '放大查看', noData: '当前筛选条件下无数据', reset: '重置', resetAll: '全部重置', resetZoom: '重置缩放',
    resetView: '重置视图', clear: '清除', clearFilters: '清除筛选', clearSelection: '清除选择',
    filtered: '已筛选', filteredView: '筛选视图', filteredBy: '筛选条件', filters: '筛选', activeFilters: '当前筛选',
    removeFilter: '移除筛选：{label}', selection: '选择', selectionNotInView: '所选项不在本视图中',
    selectionIgnored: '其他图表中的选择（{list}）在此没有对应数据，本图表已忽略这些选择',
    dataTitle: '{title} — {n} 行', rowsCount: '{n} 行', showingFirst: '显示前 {max} 行，共 {n} 行。',
    dataLoadError: '报告数据无法加载。', page: '第 {n} 页', contents: '目录', print: '打印', theme: '主题',
    'theme.navy': '经典海军蓝', 'theme.bronze': '古铜象牙', 'theme.slate': '现代石板灰', 'theme.ink': '墨色（深色）',
    colon: '：', listSep: '、', choose: '选择{channel}', metric: '指标', dimension: '维度', field: '字段', value: '数值', dataset: '数据集',
    yes: '是', no: '否', none: '无', all: '全部', other: '其他', others: '其他', total: '合计', subtotal: '小计',
    average: '平均值', mean: '均值', median: '中位数', min: '最小值', max: '最大值', sum: '合计', count: '计数',
    high: '高', low: '低', current: '当前', search: '搜索', searchFor: '搜索{label}…', loading: '加载中…',
    apply: '应用', cancel: '取消', add: '添加', remove: '删除', run: '运行', copy: '复制', copied: '已复制', export: '导出',
    query: '查询', builder: '构建器', examples: '示例', history: '历史记录', results: '结果', columns: '列', rows: '行',
    addAsMetric: '添加为指标', myMetrics: '我的指标', removeMetric: '删除指标 {name}', noMetrics: '暂无已保存的指标',
    metricAdded: '已添加指标“{name}”', sortAsc: '升序', sortDesc: '降序', previous: '上一页', next: '下一页',
    zoomIn: '放大', zoomOut: '缩小', source: '资料来源', notes: '注', scenario: '情景', points: '个点',
    unknownComponent: '未知组件“{id}”——是否已引入其脚本？', datasetNotFound: '未找到数据集“{id}”'
  };
  // a language without its own pack uses this one ('zh', 'zh-Hans', 'zh-SG' -> 'zh-CN')
  var LANG_PACK = { zh: 'zh-CN', en: 'en' };

  function hasOwn(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }

  /** Normalise a BCP-47 tag: 'zh_cn' -> 'zh-CN', 'EN-us' -> 'en-US'. */
  function normLocale(tag) {
    var parts = String(tag || '').trim().replace(/_/g, '-').split('-').filter(Boolean);
    if (!parts.length) return 'en';
    return parts.map(function (p, i) { return i === 0 ? p.toLowerCase() : p.length === 2 ? p.toUpperCase() : p; }).join('-');
  }

  function detectLocale() {
    if (typeof document === 'undefined' || !document) return 'en';
    var m = document.querySelector && document.querySelector('meta[name="rk:locale"]');
    var v = m && m.getAttribute('content');
    if (!v && document.documentElement && document.documentElement.getAttribute) v = document.documentElement.getAttribute('lang');
    return normLocale(v || 'en');
  }

  /** Packs to search for a locale, most specific first. */
  function chain(locale) {
    var out = [], lang = locale.split('-')[0];
    function push(k) { if (k && hasOwn(PACKS, k) && out.indexOf(k) < 0) out.push(k); }
    push(locale);
    push(hasOwn(LANG_PACK, lang) ? LANG_PACK[lang] : null);
    Object.keys(PACKS).forEach(function (k) { if (k.split('-')[0] === lang) push(k); });
    push('en');
    return out;
  }

  var i18n = RK.i18n = {
    locale: detectLocale(),
    packs: PACKS,
    _explicit: false,
    /** t(key, fallback?, vars?) — fallback may be omitted: t(key, vars). */
    t: function (key, fallback, vars) {
      if (fallback && typeof fallback === 'object') { vars = fallback; fallback = null; }
      var list = chain(i18n.locale), s = null;
      for (var i = 0; i < list.length && s == null; i++) if (hasOwn(PACKS[list[i]], key)) s = PACKS[list[i]][key];
      if (s == null) s = fallback != null ? fallback : key;
      s = String(s);
      if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return hasOwn(vars, k) && vars[k] != null ? String(vars[k]) : m; });
      return s;
    },
    /** Merge strings into a locale pack (creates it). */
    add: function (locale, dict) {
      var key = locale === 'en' ? 'en' : normLocale(locale);
      var p = hasOwn(PACKS, key) ? PACKS[key] : (PACKS[key] = {});
      for (var k in dict) if (hasOwn(dict, k)) p[k] = dict[k];
      return p;
    },
    has: function (key, locale) {
      return chain(locale ? normLocale(locale) : i18n.locale).some(function (l) { return hasOwn(PACKS[l], key); });
    },
    /** Primary language subtag: 'zh-CN' -> 'zh'. */
    lang: function () { return i18n.locale.split('-')[0]; },
    /** Switch locale at runtime. Blocks / toolbars built earlier keep their text until re-rendered. */
    set: function (locale) {
      i18n.locale = normLocale(locale);
      i18n._explicit = true;
      RK.bus.emit('i18n:changed', i18n.locale);
      return i18n.locale;
    },
    /** Re-read <meta name="rk:locale"> / <html lang> (RK.boot calls it) unless set() chose a locale. */
    detect: function () {
      if (i18n._explicit) return i18n.locale;
      var l = detectLocale();
      if (l !== i18n.locale) { i18n.locale = l; RK.bus.emit('i18n:changed', l); }
      return l;
    },
    normalize: normLocale
  };

  /* ------------------------------------------------------------------ *
   * Component registry
   * ------------------------------------------------------------------ *
   * RK.component({
   *   id: 'bar',                 // unique id, matches kit/components/<id>/
   *   deps: ['echarts'],         // vendor ids (see vendor/vendor.json)
   *   needsData: true,           // false for pure UI components (cover, text, filter bar)
   *   defaults: {...},           // default options (deep-merged with block options)
   *   render: function (ctx) { return { update(ctx), resize(), destroy() } }
   * })
   */
  RK.components = RK.components || {};
  RK.component = function (def) {
    if (!def || !def.id || typeof def.render !== 'function') {
      throw new Error('[RK] component definition requires id and render()');
    }
    if (def.needsData === undefined) def.needsData = true;
    RK.components[def.id] = def;
    RK.bus.emit('component:registered', def);
    return def;
  };

  RK.log = function () {
    if (RK.debug) console.log.apply(console, ['[RK]'].concat([].slice.call(arguments)));
  };
})(typeof window !== 'undefined' ? window : this);
