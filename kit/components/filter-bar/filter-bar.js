/*!
 * RK component: filter-bar — global filter bar driving RK.store filters for the whole report.
 *
 *   options.filters = [
 *     {field: 'sector',  type: 'multi'},                         // searchable checkbox dropdown + select all
 *     {field: 'region',  type: 'select'},                        // single-choice dropdown
 *     {field: 'mkt_cap', type: 'range', format: '$#,##0"m"'},    // dual-thumb slider (+ distribution strip)
 *     {field: 'company', type: 'search'},                        // contains-text search (op 'search')
 *     {key: 'ex-target', type: 'toggle', label: 'Exclude target', expr: 'not is_target'}
 *   ]
 *
 * Each filter reads its values / extent from `data` (dataset id, default: the block's dataset) and
 * writes RK.store.setFilter(key, spec) with key = field by default, so two bars on the same field stay
 * in sync; spec.label carries the control's label (or the field title) so the page's "Filtered view"
 * stamp and the block badges read "Region = Europe" rather than the raw field name. The chips row lists
 * the bar's own filters AND chart cross-filter selections (store filters with a `source`), each
 * removable, plus "Reset all". Facet counts and the range histogram respect the
 * other active filters. Dropdowns are custom popovers attached to <body> (never clipped by a page),
 * fully keyboard operable (listbox / slider / switch ARIA patterns). Inline layout inside .rk-topbar:
 * the controls show their own state, chart selections become removable chips on the same line, and the
 * chips that do not fit collapse into a "+N" popover so the bar stays one line high.
 */
(function () {
  'use strict';
  var h = RK.util.h, isNum = RK.util.isNum;
  var applied = {};                       // "blockId|key" -> default applied once (survives re-render)

  var SVG = {
    caret: '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.4 10.4 3.1 3.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.6 6.3 5 8.6 9.6 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dash: '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 6h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chart: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2 10.5h8.5M3.5 9V6M6 9V3M8.5 9V5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    x: '<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };

  /* ------------------------------------------------------------------ *
   * Popover attached to <body>: position:fixed under its anchor, flips above when
   * there is no room, follows scroll / resize, closes on outside press or Escape.
   * ------------------------------------------------------------------ */
  function popover(anchor, content, opts) {
    opts = opts || {};
    var el = h('div.rk-fb-pop', { class: opts.cls || null }, content);
    document.body.appendChild(el);
    var closed = false;
    function place() {
      var r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      el.style.minWidth = Math.max(opts.minWidth || 0, r.width) + 'px';
      var w = el.offsetWidth, ht = el.offsetHeight;
      var left = Math.max(8, Math.min(r.left, vw - w - 8));
      var top = r.bottom + 6, above = false;
      if (top + ht > vh - 8 && r.top - ht - 6 > 8) { top = r.top - ht - 6; above = true; }
      el.classList.toggle('is-above', above);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    }
    function onDown(e) { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); } }
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      el.classList.remove('is-open');
      setTimeout(function () { el.remove(); }, 160);
      if (opts.onClose) opts.onClose();
    }
    document.addEventListener('pointerdown', onDown, true);
    el.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    place();
    (window.requestAnimationFrame || setTimeout)(function () { if (!closed) el.classList.add('is-open'); });
    return { el: el, close: close, place: place, isOpen: function () { return !closed; } };
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  /** UI string via RK.i18n when the report has a locale pack ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'filterBar.selections': '图表选择',
      'filterBar.moreSelections': '另有 {n} 项图表选择',
      'filterBar.selectionHint': '在图表中点击产生的选择 — 点击 × 清除',
      'filterBar.clearSelections': '清除图表选择',
      'filterBar.noFilters': '未应用筛选',
      'filterBar.selectAll': '全选',
      'filterBar.selectAllResults': '全选搜索结果',
      'filterBar.only': '仅此项',
      'filterBar.selectOnly': '仅选择 {value}',
      'filterBar.noMatches': '无匹配项',
      'filterBar.searchIn': '搜索{label}…',
      'filterBar.searchAll': '搜索全部文本…',
      'filterBar.selectedOf': '已选 {n} / {total}',
      'filterBar.selected': '已选 {n} 项',
      'filterBar.nOf': '{n} / {total}',
      'filterBar.any': '不限',
      'filterBar.dragHint': '拖动或使用方向键',
      'filterBar.on': '开',
      'filterBar.countOf': '{n} / {total} {noun}',
      'filterBar.rows': '行'
    });
  }

  /** Lower-case a label for running text in languages with case ("Sector" -> "sector"); CJK text is unchanged. */
  function lower(s) { return /^[A-Z][a-z]/.test(String(s)) ? String(s).charAt(0).toLowerCase() + String(s).slice(1) : String(s); }

  function same(a, b) { return typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b; }
  function indexOfCI(list, v) { for (var i = 0; i < list.length; i++) if (same(list[i], v)) return i; return -1; }
  function fmtVal(v, fmt) { return typeof v === 'string' && !RK.format.isDateCode(fmt) ? v : RK.format(v, fmt); }

  /** Field title / format from the selection's own dataset(s), else whichever dataset defines it (cross-filter chips). */
  function fieldInfo(name, datasets) {
    var ids = (datasets || []).concat(RK.data.ids()).filter(function (id) { return RK.data.get(id); });
    for (var i = 0; i < ids.length; i++) {
      var f = RK.data.get(ids[i]).field(name);
      if (f) return f;
    }
    return { name: name, title: name };
  }

  function summarise(values, fmt, max) {
    max = max || 2;
    var parts = values.slice(0, max).map(function (v) { return fmtVal(v, fmt); });
    return parts.join(', ') + (values.length > max ? ' +' + (values.length - max) : '');
  }

  function normalize(f, ctx) {
    var ds = (f.data && RK.data.get(f.data)) || ctx.dataset || null;
    var fld = ds && f.field ? ds.field(f.field) : null;
    var type = f.type || (fld ? (fld.type === 'number' || fld.type === 'date' ? 'range' : fld.type === 'boolean' ? 'toggle' : 'multi') : 'search');
    return {
      raw: f, ds: ds, field: f.field || null, type: type,
      key: f.key || f.field || (type + ':' + (f.label || 'filter')),
      label: f.label || (fld && fld.title) || f.field || tr('search', 'Search'),
      // human name written into every spec (spec.label): the "Filtered view" stamp and block badges read
      // "Region = Europe", not the raw field name, even on datasets that title the field differently
      specLabel: f.label || (fld && fld.title) || null,
      format: f.format || (fld && fld.format) || null,
      fieldType: fld ? fld.type : null
    };
  }

  /** Write a filter spec for control c (null clears it); spec.label = the control's human label. */
  function put(c, spec) {
    if (spec) {
      if (!spec.field && c.field && spec.op !== 'expr') spec.field = c.field;
      if (c.raw.datasets) spec.datasets = c.raw.datasets;
      if (c.specLabel && spec.label == null) spec.label = String(c.specLabel);
    }
    RK.store.setFilter(c.key, spec);
  }

  /* ------------------------------------------------------------------ *
   * select / multi: custom listbox dropdown
   * ------------------------------------------------------------------ */
  function listControl(c, env) {
    var multi = c.type === 'multi';
    var values = c.raw.values ? c.raw.values.slice() : (c.ds && c.field ? c.ds.distinct(c.field) : []);
    if (!c.raw.values && c.raw.sort !== false) values.sort(function (a, b) { return typeof a === 'number' ? a - b : String(a).localeCompare(String(b)); });
    var allLabel = c.raw.allLabel || tr('all', 'All');
    var listId = RK.util.uid('rk-fb-list');
    var valueEl = h('span.rk-fb-trigger__v');
    var trigger = h('button.rk-fb-trigger', {
      type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': c.label,
      on: { click: function () { if (pop) pop.close(); else open(); }, keydown: function (e) { if (e.key === 'ArrowDown' && !pop) { e.preventDefault(); open(); } } }
    }, env.inline ? h('span.rk-fb-trigger__k', c.label) : null, valueEl, h('span.rk-fb-trigger__caret', { html: SVG.caret }));
    var pop = null, q = '', act = 0, rowsEls = [], listEl = null, searchEl = null, footEl = null;

    function sel() {
      var f = RK.store.filter(c.key);
      if (!f || f.op !== 'in' || !f.values) return null; // null = everything, [] = nothing ticked
      return f.values.slice();
    }
    function isOn(v, s) { return s === null ? multi : indexOfCI(s, v) >= 0; }
    function commit(arr) {
      if (!multi) { put(c, arr && arr.length ? { op: 'in', values: [arr[0]] } : null); return; }
      var ordered = values.filter(function (v) { return indexOfCI(arr, v) >= 0; });
      if (ordered.length >= values.length) put(c, null);
      else put(c, { op: 'in', values: ordered, allowEmpty: true });   // nothing ticked matches no row
    }
    function visible() {
      var t = q.toLowerCase();
      return values.filter(function (v) { return !t || String(fmtVal(v, c.format)).toLowerCase().indexOf(t) >= 0; });
    }
    function toggleValue(v) {
      if (!multi) { commit(v == null ? [] : [v]); if (pop) { pop.close(); trigger.focus(); } return; }
      var s = sel(), cur = s === null ? values.slice() : s;
      var i = indexOfCI(cur, v);
      if (i >= 0) cur.splice(i, 1); else cur.push(v);
      commit(cur);
    }
    function toggleAll() {
      var vis = visible(), s = sel(), cur = s === null ? values.slice() : s;
      var allOn = vis.every(function (v) { return indexOfCI(cur, v) >= 0; });
      if (allOn) cur = cur.filter(function (v) { return indexOfCI(vis, v) < 0; });
      else vis.forEach(function (v) { if (indexOfCI(cur, v) < 0) cur.push(v); });
      commit(cur);
    }

    function paintTrigger() {
      var s = sel();
      var text = s === null ? allLabel : !s.length ? tr('none', 'None') : s.length === 1 ? fmtVal(s[0], c.format)
        : (s.length === 2 && summarise(s, c.format).length <= 26 ? summarise(s, c.format) : tr('filterBar.nOf', '{n} of {total}', { n: s.length, total: values.length }));
      valueEl.textContent = text;
      trigger.classList.toggle('is-active', s !== null);
      trigger.title = s && s.length ? c.label + ': ' + summarise(s, c.format, 6) : c.label + ': ' + allLabel;
    }

    function counts() {
      var m = new Map();
      if (!c.ds || !c.field) return m;
      RK.data.view(c.ds, { ignore: [c.key] }).forEach(function (r) {
        var v = r[c.field], k = typeof v === 'string' ? v.toLowerCase() : v;
        m.set(k, (m.get(k) || 0) + 1);
      });
      return m;
    }

    function renderRows() {
      if (!listEl) return;
      var s = sel(), vis = visible(), cnt = counts();
      listEl.innerHTML = '';
      rowsEls = [];
      var showAll = multi ? vis.length > 1 : !q;
      if (showAll) {
        var nOn = vis.filter(function (v) { return isOn(v, s); }).length;
        var state = multi ? (nOn === vis.length ? 'on' : nOn ? 'mixed' : 'off') : (s === null ? 'on' : 'off');
        var allRow = h('div.rk-fb-opt.rk-fb-opt--all', {
          id: listId + '-all', role: 'option', 'aria-selected': state === 'on' ? 'true' : 'false', 'aria-checked': multi ? (state === 'mixed' ? 'mixed' : String(state === 'on')) : null,
          class: 'is-' + state, on: { click: function () { if (multi) toggleAll(); else toggleValue(null); } }
        }, multi ? h('span.rk-fb-check', { html: state === 'mixed' ? SVG.dash : SVG.check }) : h('span.rk-fb-radio'),
          h('span.rk-fb-opt__t', multi ? (q ? tr('filterBar.selectAllResults', 'Select all results') : tr('filterBar.selectAll', 'Select all')) : allLabel),
          h('span.rk-fb-opt__n.rk-num', String(c.ds ? RK.data.view(c.ds, { ignore: [c.key] }).length : '')));
        listEl.appendChild(allRow);
        rowsEls.push({ el: allRow, all: true });
      }
      vis.forEach(function (v, i) {
        var on = isOn(v, s), n = cnt.get(typeof v === 'string' ? v.toLowerCase() : v) || 0;
        var row = h('div.rk-fb-opt', {
          id: listId + '-' + i, role: 'option', 'aria-selected': on ? 'true' : 'false', class: (on ? 'is-on' : 'is-off') + (n ? '' : ' is-empty'),
          on: { click: function () { toggleValue(v); } }
        }, multi ? h('span.rk-fb-check', { html: SVG.check }) : h('span.rk-fb-radio'),
          h('span.rk-fb-opt__t', fmtVal(v, c.format)),
          h('span.rk-fb-opt__n.rk-num', c.ds ? String(n) : ''),
          multi ? h('button.rk-fb-only', { type: 'button', tabindex: '-1', title: tr('filterBar.selectOnly', 'Select only {value}', { value: fmtVal(v, c.format) }), on: { click: function (e) { e.stopPropagation(); commit([v]); } } }, tr('filterBar.only', 'only')) : null);
        listEl.appendChild(row);
        rowsEls.push({ el: row, v: v });
      });
      if (!vis.length) listEl.appendChild(h('div.rk-fb-empty', tr('filterBar.noMatches', 'No matches')));
      act = Math.max(0, Math.min(act, rowsEls.length - 1));
      paintActive(false);
      if (footEl) {
        var cur = s === null ? values.length : s.length;
        footEl.firstChild.textContent = multi ? tr('filterBar.selectedOf', '{n} of {total} selected', { n: cur, total: values.length }) : (s === null ? allLabel : tr('filterBar.selected', '{n} selected', { n: s.length }));
      }
    }
    function paintActive(scroll) {
      rowsEls.forEach(function (r, i) { r.el.classList.toggle('is-act', i === act); });
      var a = rowsEls[act];
      var owner = searchEl || listEl;
      if (a) owner.setAttribute('aria-activedescendant', a.el.id); else owner.removeAttribute('aria-activedescendant');
      if (a && scroll !== false) a.el.scrollIntoView({ block: 'nearest' });
    }
    function onKey(e) {
      var n = rowsEls.length;
      if (e.key === 'ArrowDown') { act = Math.min(n - 1, act + 1); paintActive(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); paintActive(); e.preventDefault(); }
      else if (e.key === 'Home' && e.target === listEl) { act = 0; paintActive(); e.preventDefault(); }
      else if (e.key === 'End' && e.target === listEl) { act = n - 1; paintActive(); e.preventDefault(); }
      else if (e.key === 'Enter' || (e.key === ' ' && e.target === listEl)) {
        var r = rowsEls[act];
        if (!r) return;
        e.preventDefault();
        if (r.all) { if (multi) toggleAll(); else toggleValue(null); } else toggleValue(r.v);
      } else if (e.key === 'Tab') { if (pop) pop.close(); }
    }

    function open() {
      q = ''; act = 0;
      listEl = h('div.rk-fb-list__opts', { id: listId, role: 'listbox', tabindex: '-1', 'aria-label': c.label, 'aria-multiselectable': multi ? 'true' : null, on: { keydown: onKey } });
      listEl.addEventListener('mousemove', function (e) {
        var row = e.target.closest('.rk-fb-opt');
        if (!row) return;
        for (var i = 0; i < rowsEls.length; i++) if (rowsEls[i].el === row && act !== i) { act = i; paintActive(false); }
      });
      searchEl = values.length > 6 || c.raw.searchable ? h('input.rk-fb-list__q', {
        type: 'text', placeholder: tr('filterBar.searchIn', 'Search {label}…', { label: lower(c.label) }), 'aria-label': tr('search', 'Search') + ' ' + c.label, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId, autocomplete: 'off',
        on: { input: function () { q = searchEl.value; act = 0; renderRows(); }, keydown: onKey }
      }) : null;
      footEl = h('div.rk-fb-list__foot', h('span'), h('button.rk-fb-link', { type: 'button', on: { click: function () { put(c, null); } } }, tr('reset', 'Reset')));
      var body = h('div.rk-fb-list', searchEl ? h('div.rk-fb-list__search', h('span.rk-fb-list__icon', { html: SVG.search }), searchEl) : null, listEl, footEl);
      pop = popover(trigger, body, {
        minWidth: 220,
        onClose: function () { pop = null; listEl = null; searchEl = null; trigger.setAttribute('aria-expanded', 'false'); trigger.classList.remove('is-open'); }
      });
      trigger.setAttribute('aria-expanded', 'true');
      trigger.classList.add('is-open');
      renderRows();
      pop.place();
      (searchEl || listEl).focus();
    }

    paintTrigger();
    return {
      c: c, el: trigger,
      sync: function () { paintTrigger(); if (pop) renderRows(); },
      chip: function () { var s = sel(); return s === null ? null : (s.length ? summarise(s, c.format, 3) : tr('none', 'None')); },
      applyDefault: function (d) { commit([].concat(d)); },
      destroy: function () { if (pop) pop.close(); }
    };
  }

  /* ------------------------------------------------------------------ *
   * range: dual-thumb slider with formatted bounds and a distribution strip
   * ------------------------------------------------------------------ */
  var DAY = 864e5;
  function toTime(v) { var d = RK.format.toDate(v); return d ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) : null; }
  function toISO(t) { return new Date(t).toISOString().slice(0, 10); }

  function rangeControl(c, env) {
    // dates slide on day timestamps and are written back as ISO strings (the store compares them as text)
    var isDate = c.fieldType === 'date';
    var num = isDate ? function (v) { return v == null || v === '' ? null : toTime(v); } : function (v) { return isNum(v) ? v : null; };
    var nums = c.ds && c.field ? c.ds.values(c.field).map(num).filter(isNum) : [];
    var ext = RK.util.extent(nums);
    var rmin = c.raw.min != null ? num(c.raw.min) : null, rmax = c.raw.max != null ? num(c.raw.max) : null;
    if (isNum(rmin)) ext[0] = rmin;
    if (isNum(rmax)) ext[1] = rmax;
    var step = c.raw.step || (isDate ? DAY : RK.util.niceStep((ext[1] - ext[0]) || 1, 100));
    var kstep = isDate ? Math.max(1, Math.round((ext[1] - ext[0]) / DAY / 60)) * DAY : step;   // keyboard step
    var d0 = isNum(rmin) || isDate ? ext[0] : Math.floor(ext[0] / step) * step;
    var d1 = isNum(rmax) || isDate ? ext[1] : Math.ceil(ext[1] / step) * step;
    if (d1 <= d0) d1 = d0 + step;
    var fmt = isDate ? (c.raw.format || 'mmm yyyy') : (c.format || 'auto');
    function show(v) { return isDate ? RK.format(toISO(v), fmt) : RK.format(v, fmt); }
    function out(v) { return isDate ? toISO(v) : v; }
    var lo = d0, hi = d1, dragging = null, timer = null;
    var BINS = Math.max(10, Math.min(28, Math.round(Math.sqrt(nums.length) * 4)));

    function snap(v) { return +RK.util.clamp(Math.round((v - d0) / step) * step + d0, d0, d1).toFixed(10); }
    function pct(v) { return (v - d0) / (d1 - d0) * 100; }

    var loText = h('span.rk-num'), hiText = h('span.rk-num');
    var vals = h('span.rk-fb-range__vals', loText, h('span.rk-fb-range__sep', '–'), hiText);
    var hist = env.hist || env.inline ? h('div.rk-fb-range__hist', { 'aria-hidden': 'true' }) : null;   // inline: shown in the popover
    var fill = h('div.rk-fb-range__fill');
    function thumb(which) {
      return h('div.rk-fb-range__thumb', {
        role: 'slider', tabindex: '0', 'aria-label': c.label + (which ? ' maximum' : ' minimum'), 'aria-valuemin': d0, 'aria-valuemax': d1,
        on: { keydown: function (e) { onKey(e, which); } }
      });
    }
    var thumbs = [thumb(0), thumb(1)];
    var track = h('div.rk-fb-range__track', h('div.rk-fb-range__rail'), fill, thumbs[0], thumbs[1]);
    var body = h('div.rk-fb-range', hist, track);

    function valueAt(x) {
      var r = track.getBoundingClientRect();
      return snap(d0 + RK.util.clamp((x - r.left) / (r.width || 1), 0, 1) * (d1 - d0));
    }
    function setVal(which, v, live) {
      v = snap(v);
      if (which === 0) lo = Math.min(v, hi); else hi = Math.max(v, lo);
      paint();
      clearTimeout(timer);
      timer = setTimeout(commit, live ? 140 : 60);
    }
    function commit() {
      clearTimeout(timer); timer = null;
      if (lo <= d0 && hi >= d1) put(c, null);
      else put(c, { op: 'between', min: lo > d0 ? out(lo) : null, max: hi < d1 ? out(hi) : null });
    }
    track.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var v = valueAt(e.clientX);
      dragging = lo === hi ? (v < lo ? 0 : 1) : (Math.abs(v - lo) <= Math.abs(v - hi) ? 0 : 1);
      thumbs[dragging].focus();
      track.classList.add('is-dragging');
      track.setPointerCapture(e.pointerId);
      setVal(dragging, v, true);
    });
    track.addEventListener('pointermove', function (e) { if (dragging != null) setVal(dragging, valueAt(e.clientX), true); });
    function endDrag() { if (dragging == null) return; dragging = null; track.classList.remove('is-dragging'); commit(); }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('lostpointercapture', endDrag);
    function onKey(e, which) {
      var cur = which ? hi : lo, big = kstep * 10, v = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = cur + kstep;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = cur - kstep;
      else if (e.key === 'PageUp') v = cur + big;
      else if (e.key === 'PageDown') v = cur - big;
      else if (e.key === 'Home') v = d0;
      else if (e.key === 'End') v = d1;
      if (v == null) return;
      e.preventDefault();
      setVal(which, v, false);
    }

    function paint() {
      var a = pct(lo), b = pct(hi);
      thumbs[0].style.left = a + '%';
      thumbs[1].style.left = b + '%';
      fill.style.left = a + '%';
      fill.style.right = (100 - b) + '%';
      thumbs[0].setAttribute('aria-valuenow', lo); thumbs[0].setAttribute('aria-valuetext', show(lo));
      thumbs[1].setAttribute('aria-valuenow', hi); thumbs[1].setAttribute('aria-valuetext', show(hi));
      // keep the upper thumb reachable when both sit at the top end
      thumbs[0].style.zIndex = lo >= d1 - step / 2 ? 3 : 2;
      loText.textContent = show(lo);
      hiText.textContent = show(hi);
      var active = lo > d0 || hi < d1;
      body.classList.toggle('is-active', active);
      vals.classList.toggle('is-active', active);
      if (trigVal) trigVal.textContent = active ? show(lo) + ' – ' + show(hi) : tr('filterBar.any', 'Any');
      if (trigger) trigger.classList.toggle('is-active', active);
      if (hist) Array.prototype.forEach.call(hist.children, function (bar, i) {
        var mid = d0 + (i + 0.5) * (d1 - d0) / BINS;
        bar.classList.toggle('is-in', mid >= lo && mid <= hi);
      });
    }
    function paintHist() {
      if (!hist) return;
      var counts = new Array(BINS).fill(0);
      var rows = c.ds ? RK.data.view(c.ds, { ignore: [c.key] }) : [];
      rows.forEach(function (r) {
        var v = num(r[c.field]);
        if (!isNum(v)) return;
        counts[Math.min(BINS - 1, Math.max(0, Math.floor((v - d0) / (d1 - d0) * BINS)))]++;
      });
      var max = Math.max.apply(null, counts) || 1;
      hist.innerHTML = '';
      counts.forEach(function (n) {
        // square-root heights with a floor: one-off bins stay visible without a ragged skyline
        hist.appendChild(h('i', { style: { height: (n ? 30 + 70 * Math.sqrt(n / max) : 0) + '%' }, title: n ? n + ' row' + (n > 1 ? 's' : '') : null }));
      });
    }
    function sync() {
      if (dragging != null || timer) return;
      var f = RK.store.filter(c.key);
      lo = f && f.op === 'between' && f.min != null ? Math.max(d0, num(f.min)) : d0;
      hi = f && f.op === 'between' && f.max != null ? Math.min(d1, num(f.max)) : d1;
      paintHist();
      paint();
    }

    // stacked: inline slider; inline (top bar): trigger + popover holding the slider
    var trigger = null, trigVal = null, pop = null, el;
    if (env.inline) {
      trigVal = h('span.rk-fb-trigger__v');
      trigger = h('button.rk-fb-trigger', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', on: { click: toggle } },
        h('span.rk-fb-trigger__k', c.label), trigVal, h('span.rk-fb-trigger__caret', { html: SVG.caret }));
      el = trigger;
    } else {
      el = body;
    }
    function toggle() {
      if (pop) { pop.close(); return; }
      var panel = h('div.rk-fb-rangepop',
        h('div.rk-fb-rangepop__head', h('span.rk-fb-rangepop__k', c.label), vals),
        body,
        h('div.rk-fb-list__foot', h('span', tr('filterBar.dragHint', 'Drag or use arrow keys')), h('button.rk-fb-link', { type: 'button', on: { click: function () { put(c, null); } } }, tr('reset', 'Reset'))));
      pop = popover(trigger, panel, { minWidth: 280, onClose: function () { pop = null; trigger.setAttribute('aria-expanded', 'false'); trigger.classList.remove('is-open'); } });
      trigger.setAttribute('aria-expanded', 'true');
      trigger.classList.add('is-open');
      paintHist(); paint();
      thumbs[0].focus();
    }

    sync();
    return {
      c: c, el: el, vals: env.inline ? null : vals,
      sync: sync,
      chip: function () {
        var f = RK.store.filter(c.key);
        if (!f || f.op !== 'between') return null;
        if (f.min != null && f.max != null) return show(num(f.min)) + ' – ' + show(num(f.max));
        return f.min != null ? '≥ ' + show(num(f.min)) : '≤ ' + show(num(f.max));
      },
      applyDefault: function (d) { put(c, { op: 'between', min: d[0], max: d[1] }); },
      destroy: function () { clearTimeout(timer); if (pop) pop.close(); }
    };
  }

  /* ------------------------------------------------------------------ *
   * search: contains-text (op 'search'), debounced
   * ------------------------------------------------------------------ */
  function searchControl(c, env) {
    var timer = null;
    var input = h('input.rk-fb-search__input', {
      type: 'text', role: 'searchbox', autocomplete: 'off', spellcheck: 'false',
      placeholder: c.raw.placeholder || (c.field ? tr('filterBar.searchIn', 'Search {label}…', { label: lower(c.label) }) : tr('filterBar.searchAll', 'Search all text…')), 'aria-label': c.label,
      on: {
        input: function () { paint(); clearTimeout(timer); timer = setTimeout(commit, 200); },
        keydown: function (e) { if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; paint(); commit(); } else if (e.key === 'Enter') commit(); }
      }
    });
    var clear = h('button.rk-fb-search__clear', { type: 'button', 'aria-label': 'Clear search', html: SVG.x, on: { click: function () { input.value = ''; paint(); commit(); input.focus(); } } });
    var el = h('div.rk-fb-search', h('span.rk-fb-search__icon', { html: SVG.search }), input, clear);
    function commit() {
      clearTimeout(timer); timer = null;
      var t = input.value.trim();
      put(c, t ? { op: 'search', field: c.field || undefined, text: t } : null);
    }
    function paint() { el.classList.toggle('has-text', !!input.value); }
    return {
      c: c, el: el,
      sync: function () {
        if (document.activeElement === input || timer) return;
        var f = RK.store.filter(c.key);
        input.value = f && f.op === 'search' ? f.text : '';
        paint();
      },
      chip: function () { var f = RK.store.filter(c.key); return f && f.op === 'search' ? '“' + f.text + '”' : null; },
      applyDefault: function (d) { put(c, { op: 'search', field: c.field || undefined, text: String(d) }); },
      destroy: function () { clearTimeout(timer); }
    };
  }

  /* ------------------------------------------------------------------ *
   * toggle: switch that applies {field in [value]} or an expression filter
   * ------------------------------------------------------------------ */
  function toggleControl(c) {
    var btn = h('button.rk-fb-switch', {
      type: 'button', role: 'switch', 'aria-checked': 'false',
      on: { click: function () { set(btn.getAttribute('aria-checked') !== 'true'); } }
    }, h('span.rk-fb-switch__track', h('span.rk-fb-switch__knob')), h('span.rk-fb-switch__t', c.label));
    function set(on) {
      if (!on) put(c, null);
      else if (c.raw.expr) put(c, { op: 'expr', expr: c.raw.expr });
      else put(c, { op: 'in', values: [c.raw.value != null ? c.raw.value : true] });
    }
    function sync() { btn.setAttribute('aria-checked', RK.store.filter(c.key) ? 'true' : 'false'); }
    sync();
    return {
      c: c, el: btn, sync: sync,
      chip: function () { return RK.store.filter(c.key) ? tr('filterBar.on', 'On') : null; },
      applyDefault: function (d) { if (d) set(true); },
      destroy: function () {}
    };
  }

  /* ------------------------------------------------------------------ *
   * Component
   * ------------------------------------------------------------------ */
  RK.component({
    id: 'filter-bar',
    deps: [],
    needsData: false,
    lazy: false,
    defaults: {
      filters: [],          // [{field, type, label, data, values, default, format, key, datasets, step, min, max, placeholder, value, expr}]
      layout: 'auto',       // auto | stacked | inline   (auto = inline inside .rk-topbar)
      chips: true,          // active-filter chips row (own filters + chart cross-filters)
      crossFilters: true,   // include chart selections (store filters with a source) in the chips
      count: true,          // "12 of 18 companies" readout for the bound dataset
      countLabel: null,     // noun for the readout (default 'rows')
      histogram: true,      // distribution strip above range sliders (stacked layout)
      tools: false
    },
    render: function (ctx) {
      var o = ctx.options;
      var inline = o.layout === 'inline' || (o.layout === 'auto' && !!ctx.block.closest('.rk-topbar'));
      var env = { inline: inline, hist: o.histogram && !inline };
      ctx.el.classList.add('is-auto');

      var controls = (o.filters || []).map(function (f) {
        var c = normalize(f, ctx);
        if (c.type === 'range') return rangeControl(c, env);
        if (c.type === 'search') return searchControl(c, env);
        if (c.type === 'toggle') return toggleControl(c, env);
        return listControl(c, env);
      });
      var ownKeys = controls.map(function (k) { return k.c.key; });

      var root = h('div.rk-fb', { class: (inline ? 'rk-fb--inline' : 'rk-fb--stacked') + (ctx.motion ? '' : ' is-static'), role: 'group', 'aria-label': tr('filters', 'Filters') });
      var row = h('div.rk-fb__controls');
      controls.forEach(function (k) {
        var c = k.c;
        if (inline || c.type === 'toggle') { row.appendChild(h('div.rk-fb__ctl', { class: 'rk-fb__ctl--' + c.type }, k.el)); return; }
        var head = h('div.rk-fb__label', h('span', c.label), k.vals || null);
        row.appendChild(h('div.rk-fb__ctl', { class: 'rk-fb__ctl--' + c.type }, head, k.el));
      });
      var countEl = o.count && ctx.dataset ? h('div.rk-fb__count', { 'aria-live': 'polite' }) : null;
      var resetInline = inline ? h('button.rk-fb-link.rk-fb__reset', { type: 'button', on: { click: resetAll } }, tr('reset', 'Reset')) : null;
      // inline: chart selections as chips on the same line; those that do not fit go into a "+N" popover
      var xsel = null;
      if (inline && o.chips !== false && o.crossFilters) {
        xsel = { strip: h('div.rk-fb__xchips', { role: 'list', 'aria-label': tr('filterBar.selections', 'Chart selections') }), map: {}, hidden: [], pop: null };
        xsel.more = h('button.rk-fb-more', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', on: { click: toggleMore } });
        xsel.el = h('div.rk-fb__xsel.is-empty', xsel.strip, xsel.more);
        row.appendChild(xsel.el);
        ctx.block.classList.add('rk-fb-host');   // lets the bar take the top bar's free width (and shrink the chips first)
      }
      if (countEl || resetInline) row.appendChild(h('div.rk-fb__aside', countEl, resetInline));
      root.appendChild(row);

      var chipsEl = null, chipMap = {};
      if (o.chips && !inline) {
        chipsEl = h('div.rk-fb__chips', { 'aria-label': tr('activeFilters', 'Active filters') });
        root.appendChild(chipsEl);
      }
      ctx.el.appendChild(root);

      function resetAll() {
        var fs = RK.store.filters();
        Object.keys(fs).forEach(function (k) {
          if (ownKeys.indexOf(k) >= 0 || (o.crossFilters && fs[k].source)) RK.store.clearFilter(k);
        });
      }

      function activeList() {
        var list = [];
        controls.forEach(function (k) {
          var t = k.chip();
          if (t) list.push({ key: k.c.key, label: k.c.label, text: t });
        });
        if (o.crossFilters) {
          var fs = RK.store.filters();
          Object.keys(fs).forEach(function (key) {
            var s = fs[key];
            if (!s.source || ownKeys.indexOf(key) >= 0 || s.source === ctx.id) return;
            var info = fieldInfo(s.field, s.datasets);
            // 'in' lists and either-end link selections (op 'expr' carrying values) read as values
            var text = s.values ? (s.values.length ? summarise(s.values, info.format, 3) : tr('none', 'None'))
              : s.op === 'between' ? RK.format(s.min, info.format) + ' – ' + RK.format(s.max, info.format)
              : s.op === 'search' ? '“' + s.text + '”' : (s.expr || '');
            list.push({ key: key, label: info.title || s.field || tr('selection', 'Selection'), text: text, cross: true });
          });
        }
        return list;
      }

      /** One removable chip (own filter or chart selection); v = the value span updated in place. */
      function chipOf(it) {
        var v = h('span.rk-fb-chip__v');
        return {
          v: v,
          el: h('span.rk-chip.rk-fb-chip', { class: it.cross ? 'is-cross' : null, role: xsel && it.cross ? 'listitem' : null,
            title: it.cross ? tr('filterBar.selectionHint', 'Selection made in a chart — click × to clear') : null },
            it.cross ? h('span.rk-fb-chip__icon', { html: SVG.chart }) : null,
            h('span.rk-fb-chip__k', it.label), v,
            h('button', { type: 'button', 'aria-label': tr('removeFilter', 'Remove filter {label}', { label: it.label }), html: SVG.x, on: { click: function () { RK.store.clearFilter(it.key); } } }))
        };
      }
      /** Keyed chip list: create new chips, update values, drop stale ones, keep the order stable. */
      function syncChips(host, map, list) {
        var seen = {};
        list.forEach(function (it) {
          seen[it.key] = true;
          var ch = map[it.key] || (map[it.key] = chipOf(it));
          ch.v.textContent = it.text;
          ch.v.title = it.text;
          host.appendChild(ch.el); // (re)append keeps the order stable
        });
        Object.keys(map).forEach(function (k) { if (!seen[k]) { map[k].el.remove(); delete map[k]; } });
      }

      function paintChips() {
        var list = activeList();
        if (resetInline) resetInline.classList.toggle('is-shown', list.length > 0);
        if (xsel) paintSelections(list.filter(function (it) { return it.cross; }));
        if (!chipsEl) return;
        syncChips(chipsEl, chipMap, list);
        var empty = chipsEl.querySelector('.rk-fb__none');
        var reset = chipsEl.querySelector('.rk-fb__reset');
        if (!list.length) {
          if (!empty) chipsEl.insertBefore(h('span.rk-fb__none', tr('filterBar.noFilters', 'No filters applied')), chipsEl.firstChild);
          if (reset) reset.remove();
        } else {
          if (empty) empty.remove();
          chipsEl.appendChild(reset || h('button.rk-fb-link.rk-fb__reset', { type: 'button', on: { click: resetAll } }, tr('resetAll', 'Reset all')));
        }
      }

      /* ---------- inline: chart-selection chips + "+N" overflow ---------- */
      var xlist = [];
      function paintSelections(list) {
        xlist = list;
        syncChips(xsel.strip, xsel.map, list);
        xsel.el.classList.toggle('is-empty', !list.length);
        fitSelections();
      }
      /** Hide chips from the end until the strip fits its (shrunk) width; the hidden ones are listed under "+N". */
      function fitSelections() {
        if (!xsel) return;
        var els = xlist.map(function (it) { return xsel.map[it.key].el; });
        els.forEach(function (el) { el.classList.remove('is-over'); });
        xsel.hidden = [];
        xsel.el.classList.remove('has-more');
        if (els.length && over()) {
          xsel.el.classList.add('has-more');
          for (var i = els.length - 1; i >= 0; i--) {
            els[i].classList.add('is-over');
            xsel.hidden.unshift(xlist[i]);
            paintMore(i);
            if (!over()) break;
          }
        }
        paintMore(els.length - xsel.hidden.length);
        xsel.el.classList.toggle('has-shown', els.length > xsel.hidden.length);
        if (xsel.pop) { if (xsel.hidden.length) paintMorePop(); else xsel.pop.close(); }
      }
      function over() { return xsel.strip.scrollWidth > xsel.strip.clientWidth + 1; }
      function paintMore(shown) {
        var n = xsel.hidden.length;
        xsel.more.innerHTML = '';
        if (!n) return;
        // nothing fits: the button alone stands for every selection (chart icon + count)
        if (!shown) xsel.more.appendChild(h('span.rk-fb-chip__icon', { html: SVG.chart }));
        xsel.more.appendChild(document.createTextNode(shown ? '+' + n : String(n)));
        var label = tr('filterBar.moreSelections', '{n} more chart selection' + (n > 1 ? 's' : ''), { n: n });
        xsel.more.title = label + ': ' + xsel.hidden.map(function (it) { return it.label + ' = ' + it.text; }).join(' · ');
        xsel.more.setAttribute('aria-label', label);
      }
      function paintMorePop() {
        var body = xsel.popBody, map = xsel.popMap || (xsel.popMap = {});
        syncChips(body, map, xsel.hidden);
        if (xsel.pop) xsel.pop.place();
      }
      function toggleMore() {
        if (xsel.pop) { xsel.pop.close(); return; }
        xsel.popBody = h('div.rk-fb-morepop__list', { role: 'list' });
        xsel.popMap = {};
        var panel = h('div.rk-fb-morepop',
          h('div.rk-fb-rangepop__head', h('span.rk-fb-rangepop__k', tr('filterBar.selections', 'Chart selections'))),
          xsel.popBody,
          h('div.rk-fb-list__foot', h('span'), h('button.rk-fb-link', { type: 'button', on: { click: clearSelections } }, tr('filterBar.clearSelections', 'Clear chart selections'))));
        xsel.pop = popover(xsel.more, panel, { minWidth: 240, onClose: function () { xsel.pop = null; xsel.more.setAttribute('aria-expanded', 'false'); xsel.more.classList.remove('is-open'); } });
        xsel.more.setAttribute('aria-expanded', 'true');
        xsel.more.classList.add('is-open');
        paintMorePop();
        var first = xsel.popBody.querySelector('button');
        if (first) first.focus();
      }
      function clearSelections() {
        var fs = RK.store.filters();
        Object.keys(fs).forEach(function (k) { if (fs[k].source && ownKeys.indexOf(k) < 0 && fs[k].source !== ctx.id) RK.store.clearFilter(k); });
      }

      function paintCount() {
        if (!countEl) return;
        var n = RK.data.view(ctx.dataset).length, N = ctx.dataset.rows.length;
        countEl.innerHTML = '';
        // "<b>12</b> of 18 companies" — the template decides where the bold count sits (other languages order it differently)
        var vars = { total: RK.format(N, '#,##0'), noun: o.countLabel || tr('filterBar.rows', 'rows') };
        tr('filterBar.countOf', '{n} of {total} {noun}').split('{n}').forEach(function (part, i) {
          if (i) countEl.appendChild(h('b.rk-num', RK.format(n, '#,##0')));
          part = part.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
          if (part) countEl.appendChild(document.createTextNode(part));
        });
        countEl.classList.toggle('is-filtered', n < N);
      }

      function syncAll() {
        controls.forEach(function (k) { k.sync(); });
        paintChips();
        paintCount();
      }

      // defaults: applied once per block (a re-render after a theme switch must not re-apply them)
      controls.forEach(function (k) {
        var d = k.c.raw.default, id = ctx.id + '|' + k.c.key;
        if (d == null || applied[id]) return;
        applied[id] = true;
        if (!RK.store.filter(k.c.key)) k.applyDefault(d);
      });
      syncAll();

      // the strip's width depends on fonts and on the top bar's other items: re-fit once layout settles
      var fitLater = xsel ? RK.util.rafThrottle(fitSelections) : null;
      if (fitLater) { fitLater(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitLater(); }); }

      return {
        update: function (c) { ctx = c; syncAll(); },
        onStore: function () { syncAll(); },
        resize: function () { if (fitLater) fitLater(); },
        destroy: function () {
          controls.forEach(function (k) { k.destroy(); });
          if (xsel) { if (xsel.pop) xsel.pop.close(); ctx.block.classList.remove('rk-fb-host'); }
          root.remove();
        }
      };
    }
  });
})();
