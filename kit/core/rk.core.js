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
