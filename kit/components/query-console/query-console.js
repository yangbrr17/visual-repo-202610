/*!
 * RK component: query-console — the client self-service analysis console.
 *
 *   Builder tab  pivot-style form (Values = aggregation x field, Rows = group-by fields, Filter,
 *                Sort, Top N) that writes RK.query text and runs it as you change it.
 *   Query tab    editor for the RK.query grammar
 *                  <items> [from ds] [by fields] [where expr] [sort col desc] [top n]
 *                  items := expr [as "Label"] [format "0.0x"], ...
 *                with syntax highlighting, debounced live validation (message + line / column + wavy
 *                underline at the error), autocomplete (fields, functions, keywords, @params,
 *                datasets), Ctrl/Cmd+Enter to run, clickable examples.
 *   Reference    fields (title, name, type, format), @parameters, functions and syntax — click to
 *                insert at the caret.
 *   Results      formatted table (column formats, sortable headers, target highlight) + an automatic
 *                ECharts chart in a split view (bar for one category column, line when the category
 *                looks like a year / date, dual axis for mixed units, KPI read-out for a single row),
 *                CSV export, "Add as metric" (Dataset.addComputed) for row-level formulas, history
 *                (localStorage, guarded). Results respect the global filters and re-run when they change.
 */
(function () {
  'use strict';
  var h = RK.util.h, isNum = RK.util.isNum;
  var memo = {};                                   // blockId -> UI state (survives theme re-render)
  var HKEY = 'rk:query-console:history';
  var MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);

  var AGGS = [
    { id: 'none', label: 'Value', sub: 'No aggregation — one row per record' },
    { id: 'sum', label: 'Sum' }, { id: 'avg', label: 'Average' }, { id: 'median', label: 'Median' },
    { id: 'min', label: 'Min' }, { id: 'max', label: 'Max' }, { id: 'count', label: 'Count' },
    { id: 'countd', label: 'Distinct count' }, { id: 'stdev', label: 'Std. dev.' }
  ];
  var AGG_LABEL = { average: 'Average', mean: 'Average', stddev: 'Std. dev.', first: 'First', last: 'Last', pctl: 'Percentile', percentile: 'Percentile', wavg: 'Weighted avg.' };
  AGGS.forEach(function (a) { AGG_LABEL[a.id] = a.label; });

  var FN_DOC = {
    sum: 'sum(x) — total', avg: 'avg(x) — mean', average: 'average(x) — mean', mean: 'mean(x) — mean', median: 'median(x)',
    min: 'min(x) — smallest (or min(a, b) per row)', max: 'max(x) — largest (or max(a, b) per row)',
    count: 'count() rows, count(x) non-empty', countd: 'countd(x) — distinct values', stdev: 'stdev(x) — sample std. dev.', stddev: 'stddev(x)',
    first: 'first(x) — first non-empty', last: 'last(x) — last non-empty', pctl: 'pctl(x, 0.75) — percentile', percentile: 'percentile(x, 0.25)',
    wavg: 'wavg(x, weight) — weighted average',
    abs: 'abs(x)', round: 'round(x, 1)', floor: 'floor(x)', ceil: 'ceil(x)', sqrt: 'sqrt(x)', pow: 'pow(x, y)', exp: 'exp(x)', ln: 'ln(x)',
    log: 'log(x [, base])', log10: 'log10(x)', sign: 'sign(x)', clamp: 'clamp(x, lo, hi)', div: 'div(a, b) — null-safe divide',
    pct_change: 'pct_change(new, old) — growth', cagr: 'cagr(end, start, years)', coalesce: 'coalesce(a, b, …) — first non-empty',
    isnull: 'isnull(x)', between: 'between(x, lo, hi)', number: 'number(x)', text: 'text(x, "0.0x") — formatted text',
    len: 'len(s)', lower: 'lower(s)', upper: 'upper(s)', concat: 'concat(a, b, …)', contains: 'contains(s, "sub")',
    startswith: 'startswith(s, "p")', endswith: 'endswith(s, "p")', year: 'year(date)', month: 'month(date)', quarter: 'quarter(date)',
    if: 'if(condition, then, else)'
  };
  var CLAUSE_KW = { select: 1, show: 1, from: 1, by: 1, group: 1, order: 1, where: 1, sort: 1, top: 1, limit: 1, as: 1, format: 1, asc: 1, desc: 1 };
  var LOGIC_KW = { and: 1, or: 1, not: 1, in: 1, true: 1, false: 1, null: 1 };
  var AC_KEYWORDS = ['from', 'by', 'where', 'sort', 'top', 'as', 'format', 'desc', 'asc', 'and', 'or', 'not', 'in'];
  var SYNTAX = [
    ['items', 'expr [as "Label"] [format "0.0x"], …'],
    ['from', 'from peers'],
    ['by', 'by sector, region'],
    ['where', 'where region == "Europe" and mkt_cap > 5000'],
    ['sort', 'sort 2 desc  ·  sort "Label" asc'],
    ['top', 'top 10']
  ];

  var ICONS = {
    play: '<path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
    book: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17.2v.1"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    metric: '<path d="M17 5H7l6 7-6 7h10"/>',
    caret: '<path d="m7 10 5 5 5-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>'
  };
  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 14) + '" height="' + (size || 14) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function norm(s) { return String(s).toLowerCase().replace(/[\s_]+/g, ' ').trim(); }
  function quoteName(n) {
    var low = String(n).toLowerCase();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !CLAUSE_KW[low] && !LOGIC_KW[low] ? n : '`' + n + '`';
  }
  function slug(s) {
    var out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return /^\d/.test(out) ? 'm_' + out : (out || 'metric');
  }
  function lineCol(text, pos) { var pre = text.slice(0, pos).split('\n'); return { line: pre.length, col: pre[pre.length - 1].length + 1 }; }
  function typeTag(t) { return t === 'number' ? '#' : t === 'date' ? 'dt' : t === 'boolean' ? 'y/n' : 'abc'; }
  function isTimeLike(v) {
    if (typeof v === 'number') return v >= 1900 && v <= 2100 && Math.round(v) === v;
    return typeof v === 'string' && /^(\d{4}[AEFPB]?|\d{4}-\d{2}(-\d{2})?|[QH][1-4][ -]?'?\d{2,4}|\d{4}[ -]?[QH][1-4]|FY\d{2,4}[AE]?)$/i.test(v.trim());
  }
  function fmtKind(f) { f = String(RK.format.presets[f] || f || ''); return /%/.test(f) ? 'pct' : /x"?\s*$/.test(f) ? 'mult' : 'num'; }
  function relTime(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago';
  }
  function loadHistory() {
    try { var v = JSON.parse(window.localStorage.getItem(HKEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { window.localStorage.setItem(HKEY, JSON.stringify(list)); } catch (e) { /* storage unavailable (file://, private mode) */ }
  }

  function editDistance(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /** Better "did you mean" for unknown fields: prefix, then substring, then small edit distance. */
  function suggest(name, ds) {
    var n = norm(name);
    var scored = ds.fields.map(function (f) {
      var a = norm(f.name), b = norm(f.title || '');
      if (a.indexOf(n) === 0 || b.indexOf(n) === 0) return [f.name, 0];
      if (a.indexOf(n) >= 0 || b.indexOf(n) >= 0) return [f.name, 1];
      var d = Math.min(editDistance(n, a), editDistance(n, b));
      return [f.name, d <= Math.max(2, Math.floor(n.length / 4)) ? 2 + d : 99];
    }).filter(function (x) { return x[1] < 99; }).sort(function (x, y) { return x[1] - y[1]; });
    return scored.slice(0, 3).map(function (x) { return x[0]; });
  }
  function friendlyError(msg, ds) {
    var m = /^Unknown field "([^"]+)"/.exec(msg || '');
    if (m && ds) {
      var s = suggest(m[1], ds);
      return 'Unknown field "' + m[1] + '"' + (s.length ? ' — did you mean ' + s.join(', ') + '?' : ' — see the field list');
    }
    return msg;
  }
  /** "avg(ebitda_margin_25e)" -> "Average EBITDA margin 2025E" for unlabeled aggregate columns. */
  function prettyTitle(col, ds) {
    var m = /^\s*(\w+)\(\s*`?([^`()]*?)`?\s*\)\s*$/.exec(col.title || '');
    if (!m || !AGG_LABEL[m[1].toLowerCase()]) return col.title;
    var f = m[2] && ds.field(m[2]);
    if (!m[2]) return AGG_LABEL[m[1].toLowerCase()];
    return AGG_LABEL[m[1].toLowerCase()] + ' ' + (f ? f.title : m[2]);
  }

  /* ------------------------------------------------------------------ *
   * Popover attached to <body> (never clipped by the page / console)
   * ------------------------------------------------------------------ */
  function popover(anchor, content, opts) {
    opts = opts || {};
    var el = h('div.rk-qc-pop', { class: opts.cls || null }, content);
    document.body.appendChild(el);
    var closed = false;
    function place() {
      var r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      if (opts.minWidth !== false) el.style.minWidth = Math.max(opts.minWidth || 0, r.width) + 'px';
      var w = el.offsetWidth, ht = el.offsetHeight;
      var left = opts.align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      var top = r.bottom + 6, above = false;
      if (top + ht > vh - 8 && r.top - ht - 6 > 8) { top = r.top - ht - 6; above = true; }
      el.classList.toggle('is-above', above);
      el.style.left = left + 'px';
      el.style.top = Math.max(8, top) + 'px';
    }
    function onDown(e) { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); if (anchor.focus) anchor.focus(); } }
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
    return { el: el, close: close, place: place };
  }

  /** Searchable listbox picker: items [{value, label, sub, tag, group}] -> opts.onPick(value). */
  function picker(anchor, items, opts) {
    var q = '', act = 0, rows = [];
    var listId = RK.util.uid('rk-qc-pk');
    var list = h('div.rk-qc-pk__list', { id: listId, role: 'listbox', tabindex: '-1', 'aria-label': opts.label || 'Options', on: { keydown: onKey } });
    var search = items.length > 10 ? h('input.rk-qc-pk__q', {
      type: 'text', placeholder: opts.placeholder || 'Search…', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId, autocomplete: 'off', spellcheck: 'false',
      on: { input: function () { q = search.value; act = 0; render(); }, keydown: onKey }
    }) : null;
    function render() {
      list.innerHTML = '';
      rows = [];
      var t = q.toLowerCase(), lastGroup = null;
      items.forEach(function (it) {
        if (t && (it.label + ' ' + (it.sub || '') + ' ' + it.value).toLowerCase().indexOf(t) < 0) return;
        if (it.group && it.group !== lastGroup) { list.appendChild(h('div.rk-qc-pk__group', it.group)); lastGroup = it.group; }
        var on = opts.value != null && it.value === opts.value;
        var el = h('div.rk-qc-pk__opt', {
          id: listId + '-' + rows.length, role: 'option', 'aria-selected': on ? 'true' : 'false', class: on ? 'is-on' : null,
          on: { click: function () { pick(it); }, mousemove: function () { var i = rows.indexOf(rec); if (i !== act) { act = i; paint(false); } } }
        }, it.tag != null ? h('span.rk-qc-tag', it.tag) : null, h('span.rk-qc-pk__t', it.label), it.sub ? h('span.rk-qc-pk__s', it.sub) : null);
        var rec = { el: el, it: it };
        list.appendChild(el);
        rows.push(rec);
      });
      if (!rows.length) list.appendChild(h('div.rk-qc-pk__empty', 'No matches'));
      act = Math.max(0, Math.min(act, rows.length - 1));
      paint(false);
    }
    function paint(scroll) {
      rows.forEach(function (r, i) { r.el.classList.toggle('is-act', i === act); });
      var owner = search || list, a = rows[act];
      if (a) owner.setAttribute('aria-activedescendant', a.el.id);
      if (a && scroll !== false) a.el.scrollIntoView({ block: 'nearest' });
    }
    function onKey(e) {
      if (e.key === 'ArrowDown') { act = Math.min(rows.length - 1, act + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (rows[act]) { e.preventDefault(); pick(rows[act].it); } }
      else if (e.key === 'Tab') p.close();
    }
    function pick(it) { p.close(); if (anchor.focus) anchor.focus(); opts.onPick(it.value, it); }
    var p = popover(anchor, h('div.rk-qc-pk', search ? h('div.rk-qc-pk__search', h('span', { html: icon('filter', 12) }), search) : null, list), {
      minWidth: opts.minWidth || 220, onClose: opts.onClose
    });
    items.forEach(function (it, i) { if (it.value === opts.value) act = i; });
    render();
    paint();
    p.place();
    (search || list).focus();
    return p;
  }

  /* ------------------------------------------------------------------ *
   * Syntax highlighting (display only — the engine is RK.query / RK.expr)
   * ------------------------------------------------------------------ */
  var TOKEN_RE = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`[^`]*`?|@[A-Za-z_]\w*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?%?|\.\d+%?|[A-Za-z_À-￿][A-Za-z0-9_À-￿]*|\s+|[\s\S]/g;

  function highlight(text, ds, err, caret) {
    var n = text.length, cls = new Array(n), keys = Object.create(null), dsIds = Object.create(null);
    if (ds) ds.fields.forEach(function (f) { keys[norm(f.name)] = 1; keys[norm(f.title || '')] = 1; });
    RK.data.ids().forEach(function (id) { dsIds[id.toLowerCase()] = 1; });
    var m, prev = '';
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      var tk = m[0], s = m.index, c = '', ch = tk[0];
      if (ch === '"' || ch === "'") { c = 't-str'; prev = ''; }
      else if (ch === '`') { c = keys[norm(tk.replace(/`/g, ''))] ? 't-fld' : 't-id'; prev = ''; }
      else if (ch === '@') { c = 't-par'; prev = ''; }
      else if (/\d/.test(ch) || (ch === '.' && /\d/.test(tk))) { c = 't-num'; prev = ''; }
      else if (/[A-Za-z_À-￿]/.test(ch)) {
        var low = tk.toLowerCase();
        if (prev === 'from') c = dsIds[low] ? 't-ds' : 't-id';
        else if (CLAUSE_KW[low]) c = 't-kw';
        else if (LOGIC_KW[low]) c = 't-op';
        else if (/^\s*\(/.test(text.slice(s + tk.length))) c = FN_DOC[low] ? 't-fn' : 't-id';
        else if (keys[norm(tk)]) c = 't-fld';
        else c = 't-id';
        prev = low;
      } else if (/\s/.test(ch)) c = '';
      else { c = 't-pun'; prev = ''; }
      for (var i = s; i < s + tk.length; i++) cls[i] = c;
    }
    var eof = false;
    if (err && err.pos >= 0) {
      if (err.pos >= n) eof = true;
      for (var j = err.pos; j < Math.min(n, err.end); j++) cls[j] = (cls[j] || '') + ' is-err';
    }
    var out = '', run = '', runCls = null;
    function flush() {
      if (!run) return;
      out += runCls ? '<span class="' + runCls + '">' + RK.util.escapeHTML(run) + '</span>' : RK.util.escapeHTML(run);
      run = '';
    }
    for (var k = 0; k <= n; k++) {
      if (k === caret) { flush(); out += '<span class="rk-qc-ed__caret"></span>'; }
      if (k === n) break;
      var c2 = cls[k] || '';
      if (c2 !== runCls) { flush(); runCls = c2; }
      run += text[k];
    }
    flush();
    if (eof) out += '<span class="is-err is-eof">&nbsp;</span>';
    if (/\n$/.test(text) || !text) out += ' ';
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Validation with positions (RK.expr errors are relative to one expression)
   * ------------------------------------------------------------------ */
  function tokenEnd(text, pos) {
    var e = pos;
    while (e < text.length && /[A-Za-z0-9_@.À-￿]/.test(text[e])) e++;
    return Math.max(e, pos + 1);
  }
  function clausePos(text, kw) {
    var re = new RegExp('(^|\\s)' + kw + '\\s', 'i'), m = re.exec(text);
    return m ? m.index + m[1].length : -1;
  }
  function validate(text, dsId, self) {
    if (!String(text).trim()) return { empty: true };
    var spec = RK.query.parse(text);
    var ds = RK.data.get(spec.from || dsId);
    if (!ds) {
      var fp = clausePos(text, 'from');
      var at = fp >= 0 ? text.indexOf(spec.from, fp) : 0;
      return { error: 'Unknown dataset "' + (spec.from || dsId) + '" — available: ' + RK.data.ids().join(', '), pos: at, end: at + String(spec.from || '').length };
    }
    var cursor = 0, i, chk, at2;
    for (i = 0; i < spec.select.length; i++) {
      var it = spec.select[i];
      if (it.expr === '*') continue;
      at2 = text.indexOf(it.expr, cursor);
      if (at2 >= 0) cursor = at2 + it.expr.length;
      chk = RK.expr.check(it.expr, { fields: ds.fields });
      if (!chk.ok) {
        var p = Math.max(0, at2) + Math.max(0, chk.pos);
        return { error: friendlyError(chk.error, ds), pos: p, end: chk.pos >= it.expr.length ? p : tokenEnd(text, p) };
      }
    }
    var bp = clausePos(text, 'by');
    for (i = 0; i < spec.by.length; i++) {
      chk = RK.expr.check(spec.by[i], { fields: ds.fields });
      at2 = text.indexOf(spec.by[i], Math.max(0, bp));
      if (!chk.ok) return { error: friendlyError(chk.error, ds), pos: Math.max(0, at2), end: Math.max(0, at2) + spec.by[i].length };
    }
    if (spec.where) {
      chk = RK.expr.check(spec.where, { fields: ds.fields });
      var wp = text.indexOf(spec.where, Math.max(0, clausePos(text, 'where')));
      if (!chk.ok) {
        var pw = Math.max(0, wp) + Math.max(0, chk.pos);
        return { error: friendlyError(chk.error, ds), pos: pw, end: chk.pos >= spec.where.length ? pw : tokenEnd(text, pw) };
      }
      if (chk.aggregate) return { error: '"where" filters rows — aggregates such as sum() or median() are not allowed there', pos: wp, end: wp + spec.where.length };
    }
    try {
      var res = RK.query(text, { dataset: dsId, exclude: self });
      return { ok: true, res: res, spec: spec, ds: ds };
    } catch (e) {
      var sp = /sort/i.test(e.message) ? clausePos(text, 'sort') : -1;
      return { error: friendlyError(e.message, ds), pos: sp, end: sp >= 0 ? text.length : -1 };
    }
  }

  /* ------------------------------------------------------------------ *
   * Component
   * ------------------------------------------------------------------ */
  RK.component({
    id: 'query-console',
    deps: ['echarts'],
    needsData: false,
    lazy: false,
    defaults: {
      datasets: null,       // dataset ids offered in the picker (null = every loaded dataset)
      dataset: null,        // initial dataset (default: the block's dataset, else the first)
      query: null,          // initial query text (shown in the Query tab and run on mount)
      builder: null,        // initial builder state {values:[{agg, field}], rows:[...], where, sort:{col, dir}, top}
      examples: [],         // [{label, query}] or query strings — clickable chips
      tab: 'builder',       // builder | query
      view: 'split',        // split | table | chart
      chart: 'auto',        // auto | bar | line | none
      reference: true,      // side reference panel (fields / parameters / functions / syntax)
      history: true,        // remember recent queries (localStorage)
      historySize: 20,
      addMetric: true,      // "Add as metric" for row-level formula columns
      highlight: null,      // value(s) whose result rows / bars are highlighted (e.g. the target company)
      maxRows: 500,         // rows rendered in the table (CSV always exports all)
      wheelZoom: null,      // long line charts: null = Ctrl/Cmd + wheel or pinch zooms (plain wheel scrolls the page); true = plain wheel
      tools: false
    },
    render: function (ctx) {
      var o = ctx.options;
      var t = ctx.theme;
      var highlights = (o.highlight == null ? [] : [].concat(o.highlight)).map(function (v) { return String(v).toLowerCase(); });
      function available() { return (o.datasets || RK.data.ids()).filter(function (id) { return RK.data.get(id); }); }
      function DS() { return RK.data.get(st.ds); }

      var st = memo[ctx.id];
      if (!st) {
        var ids0 = available();
        var ds0 = (o.query && RK.query.parse(o.query).from) || o.dataset || (ctx.dataset && ctx.dataset.id) || ids0[0] || null;
        st = memo[ctx.id] = {
          tab: o.query && !o.builder && o.tab === 'builder' ? 'query' : o.tab, ds: ds0, text: o.query || '',
          view: o.view, builder: null, last: null, tsort: null, refOpen: false
        };
        st.builder = defaultBuilder(ds0, o.builder);
        if (!st.text && st.builder) st.text = genQuery(st.builder, ds0);
      }

      var alive = true, pops = [], chart = null, chartKey = null, ro = null, result = null, ac = null;
      var lastEditor = null, valTimer = null, autoTimer = null, err = null;
      function track(p) { pops.push(p); return p; }

      /* ---------------- skeleton ---------------- */
      ctx.el.classList.add('rk-qc-host');
      var root = h('div.rk-qc', { class: (ctx.motion ? '' : 'is-static') + (o.reference ? ' has-ref' : '') });
      var tabsEl = h('div.rk-qc-tabs', { role: 'tablist', 'aria-label': 'Console mode' });
      var tabBtn = {};
      [['builder', 'Builder'], ['query', 'Query']].forEach(function (p) {
        tabBtn[p[0]] = h('button.rk-qc-tab', {
          type: 'button', role: 'tab', id: ctx.id + '-tab-' + p[0], 'aria-controls': ctx.id + '-pane-' + p[0],
          on: { click: function () { setTab(p[0]); }, keydown: function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(p[0] === 'builder' ? 'query' : 'builder'); tabBtn[st.tab].focus(); } } }
        }, p[1]);
        tabsEl.appendChild(tabBtn[p[0]]);
      });
      var dsName = h('span.rk-qc-ds__v'), dsRows = h('span.rk-qc-ds__n.rk-num');
      var dsBtn = h('button.rk-qc-ds', { type: 'button', 'aria-haspopup': 'listbox', on: { click: openDatasets } },
        h('span.rk-qc-ds__k', 'Dataset'), dsName, dsRows, h('span.rk-qc-caret', { html: icon('caret', 12) }));
      var histBtn = o.history ? h('button.rk-iconbtn.rk-qc-hbtn', { type: 'button', title: 'Query history', 'aria-label': 'Query history', html: icon('history', 15), on: { click: openHistory } }) : null;
      var refBtn = o.reference ? h('button.rk-iconbtn.rk-qc-refbtn', { type: 'button', title: 'Fields & functions', 'aria-label': 'Fields and functions reference', 'aria-expanded': 'false', html: icon('book', 15), on: { click: function () { setRef(!st.refOpen); } } }) : null;
      var runBtn = h('button.rk-btn.rk-btn--primary.rk-qc-run', { type: 'button', on: { click: runCurrent } },
        h('span', { html: icon('play', 12) }), 'Run', h('kbd.rk-qc-kbd', MAC ? '⌘↵' : 'Ctrl ↵'));
      var head = h('div.rk-qc__head', tabsEl, dsBtn, h('span.rk-qc__spacer'), histBtn, refBtn, runBtn);

      // query pane
      var mirror = h('div.rk-qc-ed__mirror', { 'aria-hidden': 'true' });
      var ta = h('textarea.rk-qc-ed__input', {
        spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Query', rows: '3',
        placeholder: 'e.g. median(ev_ebitda_25e) by sector where region != "Latin America" sort 2 desc'
      });
      var ed = h('div.rk-qc-ed', mirror, ta);
      var exEl = h('div.rk-qc-ex');
      var queryPane = h('div.rk-qc-pane', { id: ctx.id + '-pane-query', role: 'tabpanel', 'aria-labelledby': ctx.id + '-tab-query' }, ed, exEl);

      // builder pane
      var builderPane = h('div.rk-qc-pane.rk-qc-b', { id: ctx.id + '-pane-builder', role: 'tabpanel', 'aria-labelledby': ctx.id + '-tab-builder' });
      var statusEl = h('div.rk-qc-status', { 'aria-live': 'polite' });
      var editor = h('div.rk-qc__editor', builderPane, queryPane, statusEl);

      var refEl = o.reference ? h('aside.rk-qc__ref', { 'aria-label': 'Fields and functions' }) : null;
      var resHead = h('div.rk-qc-rh');
      var tableWrap = h('div.rk-qc-table');
      var chartHost = h('div.rk-qc-chart__host');
      var chartMsg = h('div.rk-qc-chart__msg');
      var chartWrap = h('div.rk-qc-chart', chartHost, chartMsg);
      var resBody = h('div.rk-qc-rb', tableWrap, chartWrap);
      var results = h('div.rk-qc__results', resHead, resBody);
      root.appendChild(h('div.rk-qc__grid', head, editor, refEl, results));
      ctx.el.appendChild(root);

      /* ---------------- dataset ---------------- */
      function paintDataset() {
        var ds = DS();
        dsName.textContent = ds ? ds.title : 'Choose a dataset';
        dsRows.textContent = ds ? RK.format(ds.rows.length, '#,##0') + ' rows' : '';
        dsBtn.title = ds ? ds.id : '';
      }
      function openDatasets() {
        track(picker(dsBtn, available().map(function (id) {
          var d = RK.data.get(id);
          return { value: id, label: d.title, sub: id + ' · ' + d.rows.length + ' rows' };
        }), {
          value: st.ds, label: 'Datasets', placeholder: 'Search datasets…', minWidth: 300,
          onPick: function (id) {
            if (id === st.ds) return;
            st.ds = id;
            st.builder = defaultBuilder(id, null);
            // keep the query text but point it at the new dataset
            var spec = RK.query.parse(st.text || '');
            if (spec.from) st.text = st.text.replace(new RegExp('(\\bfrom\\s+)[`"\']?' + spec.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[`"\']?', 'i'), '$1' + id);
            else st.text = genQuery(st.builder, id);
            ta.value = st.text;
            paintDataset(); paintBuilder(); paintRef(); onEdit(true);
            if (st.tab === 'builder') autoRun(); else runCurrent();
          }
        }));
      }

      /* ---------------- builder ---------------- */
      function numericFields(ds) { return ds ? ds.fields.filter(function (f) { return f.type === 'number'; }) : []; }
      function dimFields(ds) { return ds ? ds.fields.filter(function (f) { return f.type !== 'number'; }) : []; }
      function defaultBuilder(dsId, given) {
        var ds = RK.data.get(dsId);
        var b = { values: [], rows: [], where: '', sort: { col: null, dir: 'desc' }, top: null };
        if (given) return RK.util.merge(b, JSON.parse(JSON.stringify(given)));   // options must not be mutated
        if (!ds) return b;
        var nums = numericFields(ds).filter(function (f) { return !/^(lat|lon|lng|latitude|longitude|year|fiscal_year|order|rank|id)$/i.test(f.name); });
        var pref = nums.filter(function (f) { return fmtKind(f.format) === 'mult'; })[0] || nums.filter(function (f) { return /\$|€|£/.test(f.format || ''); })[0] || nums[0];
        var dims = dimFields(ds).filter(function (f) {
          var n = ds.distinct(f.name).length;
          return f.type === 'string' && n > 1 && n <= 12 && n < ds.rows.length;
        });
        if (pref) b.values.push({ agg: dims.length ? 'median' : 'none', field: pref.name });
        if (dims.length) b.rows.push(dims[0].name);
        else { var lab = dimFields(ds)[0]; if (lab) b.rows.push(lab.name); }
        if (pref) b.sort = { col: 'v0', dir: 'desc' };
        return b;
      }
      function aggregated(b) { return b.values.some(function (v) { return v.agg !== 'none'; }); }
      function genQuery(b, dsId) {
        var ds = RK.data.get(dsId);
        if (!ds || !b) return '';
        var agg = aggregated(b);
        var items = agg ? [] : b.rows.map(quoteName);
        b.values.forEach(function (v) {
          var f = ds.field(v.field);
          if (!f) return;
          if (v.agg === 'none') items.push(quoteName(f.name));
          else items.push(v.agg + '(' + quoteName(f.name) + ') as "' + (AGG_LABEL[v.agg] + ' ' + f.title).replace(/"/g, "'") + '"');
        });
        if (!items.length) items = ['*'];
        var s = items.join(', ') + ' from ' + dsId;
        if (agg && b.rows.length) s += ' by ' + b.rows.map(quoteName).join(', ');
        if (b.where && b.where.trim()) s += ' where ' + b.where.trim();
        var pos = sortPosition(b);
        if (pos) s += ' sort ' + pos + ' ' + (b.sort.dir === 'asc' ? 'asc' : 'desc');
        if (b.top) s += ' top ' + b.top;
        return s;
      }
      function sortPosition(b) {
        var c = b.sort && b.sort.col;
        if (!c) return null;
        if (c.indexOf('r:') === 0) { var i = b.rows.indexOf(c.slice(2)); return i >= 0 ? i + 1 : null; }
        var vi = parseInt(c.slice(1), 10);
        if (!(vi < b.values.length)) return null;
        return b.rows.length + vi + 1;
      }
      function outputColumns(b) {
        var ds = DS(), out = [];
        if (!ds) return out;
        b.rows.forEach(function (r) { var f = ds.field(r); if (f) out.push({ value: 'r:' + r, label: f.title }); });
        b.values.forEach(function (v, i) {
          var f = ds.field(v.field);
          if (f) out.push({ value: 'v' + i, label: v.agg === 'none' ? f.title : AGG_LABEL[v.agg] + ' ' + f.title });
        });
        return out;
      }
      function fieldItems(prefer) {
        var ds = DS();
        if (!ds) return [];
        var list = ds.fields.slice().sort(function (a, b) {
          var pa = prefer === 'number' ? (a.type === 'number' ? 0 : 1) : (a.type === 'number' ? 1 : 0);
          var pb = prefer === 'number' ? (b.type === 'number' ? 0 : 1) : (b.type === 'number' ? 1 : 0);
          return pa - pb;
        });
        return list.map(function (f) {
          return { value: f.name, label: f.title, sub: f.name + (f.format ? ' · ' + f.format : ''), tag: (f.computed ? 'ƒ ' : '') + typeTag(f.type), group: f.type === 'number' ? 'Numbers' : 'Text & dates' };
        });
      }
      function bChanged() { st.text = genQuery(st.builder, st.ds); paintBuilder(); autoRun(); }

      function paintBuilder() {
        var b = st.builder, ds = DS();
        builderPane.innerHTML = '';
        if (!ds || !b) { builderPane.appendChild(h('p.rk-muted', 'Choose a dataset to start.')); return; }
        // values
        var vals = h('div.rk-qc-b__items');
        b.values.forEach(function (v, i) {
          var f = ds.field(v.field);
          var aggBtn = h('button.rk-qc-pill__agg', { type: 'button', title: 'Aggregation', on: { click: function () {
            var numeric = f && f.type === 'number';
            track(picker(aggBtn, AGGS.filter(function (a) { return numeric || a.id === 'none' || a.id === 'count' || a.id === 'countd'; })
              .map(function (a) { return { value: a.id, label: a.label, sub: a.sub }; }), {
              value: v.agg, label: 'Aggregation', minWidth: 200,
              onPick: function (id) { v.agg = id; bChanged(); }
            }));
          } } }, AGG_LABEL[v.agg] || v.agg);
          var fBtn = h('button.rk-qc-pill__f', { type: 'button', title: 'Field', on: { click: function () {
            track(picker(fBtn, fieldItems('number'), { value: v.field, label: 'Fields', placeholder: 'Search fields…', minWidth: 300, onPick: function (name) {
              v.field = name;
              var nf = ds.field(name);
              if (nf && nf.type !== 'number' && ['none', 'count', 'countd'].indexOf(v.agg) < 0) v.agg = 'countd';
              bChanged();
            } }));
          } } }, f ? f.title : v.field);
          var rm = h('button.rk-qc-pill__x', { type: 'button', 'aria-label': 'Remove value', html: icon('x', 11), on: { click: function () {
            b.values.splice(i, 1);
            if (b.sort.col && b.sort.col[0] === 'v') b.sort.col = null;
            bChanged();
          } } });
          vals.appendChild(h('span.rk-qc-pill', aggBtn, h('span.rk-qc-pill__of', 'of'), fBtn, rm));
        });
        var addV = h('button.rk-qc-add', { type: 'button', on: { click: function () {
          track(picker(addV, fieldItems('number'), { label: 'Fields', placeholder: 'Search fields…', minWidth: 300, onPick: function (name) {
            var nf = ds.field(name);
            b.values.push({ agg: nf && nf.type === 'number' ? (b.rows.length && aggregated(b) ? 'median' : (aggregated(b) ? 'median' : 'none')) : 'countd', field: name });
            bChanged();
          } }));
        } } }, h('span', { html: icon('plus', 12) }), 'Add value');
        vals.appendChild(addV);

        // rows (group by / label columns)
        var rws = h('div.rk-qc-b__items');
        b.rows.forEach(function (r, i) {
          var f = ds.field(r);
          rws.appendChild(h('span.rk-qc-pill.rk-qc-pill--dim', h('span.rk-qc-pill__f.is-static', f ? f.title : r),
            h('button.rk-qc-pill__x', { type: 'button', 'aria-label': 'Remove ' + (f ? f.title : r), html: icon('x', 11), on: { click: function () {
              b.rows.splice(i, 1);
              if (b.sort.col === 'r:' + r) b.sort.col = null;
              bChanged();
            } } })));
        });
        var addR = h('button.rk-qc-add', { type: 'button', on: { click: function () {
          track(picker(addR, fieldItems('dim').filter(function (it) { return b.rows.indexOf(it.value) < 0; }), { label: 'Fields', placeholder: 'Search fields…', minWidth: 300, onPick: function (name) { b.rows.push(name); bChanged(); } }));
        } } }, h('span', { html: icon('plus', 12) }), aggregated(b) ? 'Group by' : 'Add column');

        // filter
        var where = h('input.rk-input.rk-qc-b__where', {
          type: 'text', value: b.where || '', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Filter expression',
          placeholder: 'e.g. region == "Europe" and mkt_cap > 5000',
          on: {
            input: function () { b.where = where.value; checkWhere(); clearTimeout(autoTimer); autoTimer = setTimeout(function () { if (!whereBad) { st.text = genQuery(b, st.ds); paintGen(); runText(st.text, { silent: true }); } }, 380); },
            focus: function () { lastEditor = where; },
            keydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); runCurrent(); } }
          }
        });
        var whereMark = h('span.rk-qc-b__mark');
        var whereBad = false;
        function checkWhere() {
          var v = where.value.trim();
          var c = v ? RK.expr.check(v, { fields: ds.fields }) : { ok: true };
          if (c.ok && c.aggregate) c = { ok: false, error: 'Aggregates are not allowed in a row filter' };
          whereBad = !c.ok;
          where.classList.toggle('is-bad', whereBad);
          whereMark.innerHTML = v ? icon(c.ok ? 'check' : 'warn', 13) : '';
          whereMark.className = 'rk-qc-b__mark ' + (v ? (c.ok ? 'is-ok' : 'is-bad') : '');
          whereMark.title = c.ok ? 'Valid filter' : friendlyError(c.error, ds);
          if (!c.ok) setStatus('error', friendlyError(c.error, ds));
        }

        // sort + top
        var cols = outputColumns(b);
        var cur = cols.filter(function (c) { return c.value === b.sort.col; })[0];
        var sortBtn = h('button.rk-qc-sel', { type: 'button', on: { click: function () {
          track(picker(sortBtn, [{ value: null, label: 'No sorting' }].concat(cols), { value: b.sort.col, label: 'Sort by', minWidth: 220, onPick: function (v) { b.sort.col = v; bChanged(); } }));
        } } }, h('span', cur ? cur.label : 'No sorting'), h('span.rk-qc-caret', { html: icon('caret', 12) }));
        var dirSeg = h('div.rk-seg.rk-qc-seg', [['desc', 'High → low'], ['asc', 'Low → high']].map(function (d) {
          return h('button', { type: 'button', class: b.sort.dir === d[0] ? 'is-on' : null, 'aria-pressed': b.sort.dir === d[0] ? 'true' : 'false', disabled: !b.sort.col, on: { click: function () { b.sort.dir = d[0]; bChanged(); } } }, d[1]);
        }));
        var top = h('input.rk-input.rk-qc-b__top.rk-num', {
          type: 'number', min: '1', step: '1', value: b.top || '', placeholder: 'All', 'aria-label': 'Top N rows',
          on: { change: function () { var n = parseInt(top.value, 10); b.top = n > 0 ? n : null; bChanged(); } }
        });

        var gen = h('code.rk-qc-gen');
        function paintGen() { gen.innerHTML = highlight(st.text || genQuery(b, st.ds), ds, null, -1); }
        var editAs = h('button.rk-qc-link', { type: 'button', on: { click: function () { st.text = genQuery(b, st.ds); ta.value = st.text; setTab('query'); ta.focus(); } } }, 'Edit as query', h('span', { html: icon('arrow', 12) }));

        function row(label, body, hint) {
          return h('div.rk-qc-b__row', h('div.rk-qc-b__k', label, hint ? h('span.rk-qc-b__hint', hint) : null), h('div.rk-qc-b__v', body));
        }
        builderPane.appendChild(row('Values', vals));
        builderPane.appendChild(row(aggregated(b) ? 'Group by' : 'Columns', h('div.rk-qc-b__items', rws.childNodes.length ? Array.prototype.slice.call(rws.childNodes) : null, addR)));
        builderPane.appendChild(row('Filter', h('div.rk-qc-b__wherewrap', where, whereMark)));
        builderPane.appendChild(row('Sort', h('div.rk-qc-b__inline', sortBtn, dirSeg, h('span.rk-qc-b__k2', 'Top'), top)));
        builderPane.appendChild(row('Query', h('div.rk-qc-b__inline.rk-qc-b__genrow', gen, editAs)));
        paintGen();
        if (b.where) checkWhere();
      }
      function autoRun() {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(function () { runText(st.text, { silent: true }); }, 120);
      }

      /* ---------------- query editor ---------------- */
      function paintMirror() {
        mirror.innerHTML = highlight(ta.value, RK.data.get(RK.query.parse(ta.value).from || st.ds) || DS(), err, ta.selectionStart);
        mirror.scrollTop = ta.scrollTop;
      }
      function autosize() {
        ta.style.height = 'auto';
        var hgt = Math.max(62, Math.min(184, ta.scrollHeight + 2));
        ta.style.height = hgt + 'px';
        mirror.style.height = hgt + 'px';
      }
      function onEdit(skipAc) {
        st.text = ta.value;
        err = null;
        autosize();
        paintMirror();
        clearTimeout(valTimer);
        valTimer = setTimeout(runValidation, 220);
        if (!skipAc) autocomplete();
      }
      function runValidation() {
        if (!alive) return;
        var v = validate(ta.value, st.ds, ctx.id);
        if (v.empty) { err = null; setStatus('idle', 'Type a query, pick an example or use the reference panel →'); }
        else if (v.error) {
          err = v.pos >= 0 ? { pos: v.pos, end: v.end } : null;
          var lc = v.pos >= 0 ? lineCol(ta.value, v.pos) : null;
          setStatus('error', v.error, lc ? 'Ln ' + lc.line + ', Col ' + lc.col : null);
        } else {
          err = null;
          var r = v.res, by = v.spec.by.length ? ' · grouped by ' + v.spec.by.join(', ') : (r.aggregate ? ' · summary' : '');
          setStatus('ok', 'Valid — ' + r.rows.length + ' row' + (r.rows.length === 1 ? '' : 's') + ' × ' + r.columns.length + ' column' + (r.columns.length === 1 ? '' : 's') + by, (MAC ? '⌘' : 'Ctrl') + ' + Enter to run');
        }
        paintMirror();
      }
      function setStatus(kind, msg, aside) {
        statusEl.className = 'rk-qc-status is-' + kind;
        statusEl.innerHTML = '';
        statusEl.appendChild(h('span.rk-qc-status__i', { html: kind === 'error' ? icon('warn', 13) : kind === 'ok' ? icon('check', 13) : '' }));
        statusEl.appendChild(h('span.rk-qc-status__m', msg));
        if (aside) statusEl.appendChild(h('span.rk-qc-status__a', aside));
      }

      ta.value = st.text || '';
      ta.addEventListener('input', function () { onEdit(false); });
      ta.addEventListener('scroll', function () { mirror.scrollTop = ta.scrollTop; });
      ta.addEventListener('focus', function () { lastEditor = ta; });
      ta.addEventListener('blur', function () { setTimeout(closeAc, 120); });
      ta.addEventListener('click', function () { closeAc(); paintMirror(); });
      ta.addEventListener('keyup', function (e) { if (/^(Arrow|Home|End|Page)/.test(e.key) && !ac) paintMirror(); });
      ta.addEventListener('keydown', function (e) {
        if (ac) {
          if (e.key === 'ArrowDown') { e.preventDefault(); ac.move(1); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); ac.move(-1); return; }
          if ((e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) || e.key === 'Tab') { e.preventDefault(); ac.accept(); return; }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAc(); return; }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') closeAc();
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCurrent(); }
      });

      /* ---------------- autocomplete ---------------- */
      function closeAc() { if (ac) { ac.el.remove(); ac = null; ta.removeAttribute('aria-activedescendant'); } }
      function autocomplete() {
        var caret = ta.selectionStart, before = ta.value.slice(0, caret);
        var m = /(@?[A-Za-z_À-￿][A-Za-z0-9_À-￿]*|@)$/.exec(before);
        var quotes = (before.match(/"/g) || []).length % 2 || (before.match(/`/g) || []).length % 2;
        if (!m || quotes || ta.selectionEnd !== caret) { closeAc(); return; }
        var prefix = m[1], low = prefix.toLowerCase(), cands = [];
        var ds = RK.data.get(RK.query.parse(ta.value).from || st.ds) || DS();
        if (prefix[0] === '@') {
          var ps = RK.store.params();
          Object.keys(ps).forEach(function (k) { cands.push({ ins: '@' + k, label: '@' + k, sub: RK.format(ps[k], Math.abs(ps[k]) < 1 ? '0.00%' : 'auto'), kind: 'param' }); });
        } else if (/\bfrom\s+[A-Za-z_]*$/i.test(before)) {
          available().forEach(function (id) { cands.push({ ins: id, label: id, sub: RK.data.get(id).title, kind: 'ds' }); });
        } else {
          if (ds) ds.fields.forEach(function (f) { cands.push({ ins: quoteName(f.name), label: f.name, sub: f.title, kind: f.type === 'number' ? '#' : typeTag(f.type), title: f.title }); });
          RK.expr.functions.aggregate.concat(RK.expr.functions.scalar).forEach(function (fn) {
            if (!cands.some(function (c) { return c.label === fn + '()'; })) cands.push({ ins: fn + '(', label: fn + '()', sub: FN_DOC[fn] || '', kind: 'ƒ' });
          });
          AC_KEYWORDS.forEach(function (k) { cands.push({ ins: k + ' ', label: k, sub: 'keyword', kind: 'kw' }); });
        }
        var starts = [], contains = [];
        cands.forEach(function (c) {
          var l = c.label.toLowerCase(), tl = (c.title || '').toLowerCase();
          if (l === low || l === low + '()') return;
          if (l.indexOf(low) === 0 || (low[0] === '@' && l.indexOf(low) === 0)) starts.push(c);
          else if (low.length >= 2 && (l.indexOf(low) > 0 || tl.indexOf(low) >= 0)) contains.push(c);
        });
        var list = starts.concat(contains).slice(0, 8);
        if (!list.length || (prefix.length < 1)) { closeAc(); return; }
        paintMirror();
        var mark = mirror.querySelector('.rk-qc-ed__caret');
        if (!mark) { closeAc(); return; }
        var r = mark.getBoundingClientRect();
        if (!ac) {
          var el = h('div.rk-qc-ac', { role: 'listbox', id: ctx.id + '-ac' });
          document.body.appendChild(el);
          ac = { el: el, act: 0, list: [] };
          ac.move = function (d) { ac.act = (ac.act + d + ac.list.length) % ac.list.length; paintAc(); };
          ac.accept = function () { var c = ac.list[ac.act]; if (c) insertCompletion(c, ac.prefix); };
          ta.setAttribute('aria-controls', el.id);
        }
        ac.list = list; ac.prefix = prefix; ac.act = Math.min(ac.act, list.length - 1);
        paintAc();
        var top = r.bottom + 4, left = r.left - 8;
        var ht = ac.el.offsetHeight, w = ac.el.offsetWidth;
        if (top + ht > window.innerHeight - 8) top = r.top - ht - 4;
        ac.el.style.top = top + 'px';
        ac.el.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + 'px';
      }
      function paintAc() {
        ac.el.innerHTML = '';
        ac.list.forEach(function (c, i) {
          var row = h('div.rk-qc-ac__opt', { role: 'option', id: ctx.id + '-ac-' + i, class: i === ac.act ? 'is-act' : null, 'aria-selected': i === ac.act ? 'true' : 'false',
            on: { pointerdown: function (e) { e.preventDefault(); insertCompletion(c, ac.prefix); } } },
          h('span.rk-qc-tag', c.kind === 'param' ? '@' : c.kind === 'ds' ? 'ds' : c.kind), h('span.rk-qc-ac__l', c.label), h('span.rk-qc-ac__s', c.sub));
          ac.el.appendChild(row);
        });
        ta.setAttribute('aria-activedescendant', ctx.id + '-ac-' + ac.act);
      }
      function insertCompletion(c, prefix) {
        var caret = ta.selectionStart, start = caret - prefix.length;
        ta.setRangeText(c.ins, start, caret, 'end');
        closeAc();
        onEdit(true);
        ta.focus();
      }

      /** Insert text at the caret of the last focused editor (reference panel clicks). */
      function insert(text) {
        var target = st.tab === 'builder' ? builderPane.querySelector('.rk-qc-b__where') : ta;
        if (!target) return;
        if (target === ta && st.tab !== 'query') setTab('query');
        var s = target.selectionStart != null ? target.selectionStart : target.value.length, e = target.selectionEnd != null ? target.selectionEnd : s;
        if (document.activeElement !== target && lastEditor !== target) { s = e = target.value.length; }
        var pre = target.value.slice(0, s);
        var pad = pre && !/[\s(,\[]$/.test(pre) && !/^[),\]]/.test(text) ? ' ' : '';
        target.setRangeText(pad + text, s, e, 'end');
        target.focus();
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }

      /* ---------------- reference panel ---------------- */
      var refQ = '';
      function paintRef() {
        if (!refEl) return;
        var ds = DS();
        var keepFocus = document.activeElement && document.activeElement.classList.contains('rk-qc-ref__q');
        refEl.innerHTML = '';
        var q = h('input.rk-qc-ref__q', { type: 'text', placeholder: 'Filter fields & functions…', value: refQ, 'aria-label': 'Filter reference', spellcheck: 'false',
          on: { input: function () { refQ = q.value; paintRef(); } } });
        refEl.appendChild(h('div.rk-qc-ref__top', q, h('p.rk-qc-ref__tip', 'Click an item to insert it at the cursor')));
        var t = refQ.toLowerCase();
        function match(s) { return !t || String(s).toLowerCase().indexOf(t) >= 0; }
        if (ds) {
          var fl = h('div.rk-qc-ref__list');
          ds.fields.forEach(function (f) {
            if (!match(f.name + ' ' + f.title)) return;
            var item = h('button.rk-qc-ref__item', { type: 'button', title: (f.formula ? f.formula : f.title) + (f.format ? '  ·  ' + f.format : ''), on: { click: function () { insert(quoteName(f.name)); } } },
              h('span.rk-qc-tag', (f.computed ? 'ƒ' : '') + typeTag(f.type)),
              h('span.rk-qc-ref__main', h('span.rk-qc-ref__t', f.title), h('span.rk-qc-ref__n', f.name)),
              f.format ? h('span.rk-qc-ref__f', f.format) : null);
            fl.appendChild(item);
          });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', 'Fields', h('span.rk-num', String(ds.fields.length))), fl));
        }
        var ps = RK.store.params(), pk = Object.keys(ps).filter(function (k) { return match('@' + k); });
        if (pk.length) {
          var pl = h('div.rk-qc-ref__list');
          pk.forEach(function (k) {
            var v = ps[k];
            pl.appendChild(h('button.rk-qc-ref__item', { type: 'button', on: { click: function () { insert('@' + k); } } },
              h('span.rk-qc-tag', '@'), h('span.rk-qc-ref__main', h('span.rk-qc-ref__t.rk-qc-mono', '@' + k)),
              h('span.rk-qc-ref__f', isNum(v) ? RK.format(v, Math.abs(v) < 1 ? '0.00%' : 'auto') : String(v))));
          });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', 'Parameters'), pl));
        }
        [['Aggregate functions', RK.expr.functions.aggregate], ['Row functions', RK.expr.functions.scalar]].forEach(function (grp) {
          var names = grp[1].filter(function (n) { return match(n + ' ' + (FN_DOC[n] || '')); });
          if (!names.length) return;
          var gl = h('div.rk-qc-ref__fns');
          names.forEach(function (n) {
            gl.appendChild(h('button.rk-qc-fn', { type: 'button', title: FN_DOC[n] || n + '()', on: { click: function () { insert(n + '('); } } }, n));
          });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', grp[0]), gl));
        });
        if (!t) {
          var sl = h('dl.rk-qc-ref__syntax');
          SYNTAX.forEach(function (s) { sl.appendChild(h('dt', s[0])); sl.appendChild(h('dd', s[1])); });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', 'Syntax'), sl));
        }
        if (keepFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }
      function setRef(open) {
        st.refOpen = open;
        root.classList.toggle('is-ref-open', open);
        if (refBtn) refBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }

      /* ---------------- examples ---------------- */
      function paintExamples() {
        exEl.innerHTML = '';
        var ex = (o.examples || []).map(function (e) { return typeof e === 'string' ? { label: e, query: e } : e; });
        if (!ex.length) return;
        exEl.appendChild(h('span.rk-qc-ex__k', 'Examples'));
        ex.forEach(function (e) {
          exEl.appendChild(h('button.rk-qc-chip', { type: 'button', title: e.query, on: { click: function () {
            ta.value = e.query;
            onEdit(true);
            runCurrent();
          } } }, e.label));
        });
      }

      /* ---------------- history ---------------- */
      function pushHistory(text, dsId) {
        if (!o.history) return;
        var list = loadHistory().filter(function (x) { return !(x.q === text && x.ds === dsId); });
        list.unshift({ q: text, ds: dsId, t: Date.now() });
        saveHistory(list.slice(0, o.historySize || 20));
      }
      function openHistory() {
        var list = loadHistory();
        var body = h('div.rk-qc-hist');
        if (!list.length) body.appendChild(h('p.rk-qc-hist__empty', 'Queries you run appear here.'));
        list.forEach(function (x) {
          body.appendChild(h('button.rk-qc-hist__item', { type: 'button', on: { click: function () {
            p.close();
            if (x.ds && RK.data.get(x.ds) && x.ds !== st.ds) { st.ds = x.ds; st.builder = defaultBuilder(x.ds, null); paintDataset(); paintBuilder(); paintRef(); }
            ta.value = x.q;
            setTab('query');
            onEdit(true);
            runCurrent();
          } } }, h('code.rk-qc-hist__q', { html: highlight(x.q, RK.data.get(x.ds), null, -1) }), h('span.rk-qc-hist__meta', (x.ds || '') + ' · ' + relTime(x.t))));
        });
        var foot = h('div.rk-qc-hist__foot', h('span', list.length + ' recent quer' + (list.length === 1 ? 'y' : 'ies')),
          list.length ? h('button.rk-qc-link', { type: 'button', on: { click: function () { saveHistory([]); p.close(); } } }, 'Clear history') : null);
        var p = track(popover(histBtn, h('div', body, foot), { minWidth: 380, align: 'right', cls: 'rk-qc-pop--hist' }));
      }

      /* ---------------- tabs ---------------- */
      function setTab(tab) {
        st.tab = tab;
        ['builder', 'query'].forEach(function (k) {
          var on = k === tab;
          tabBtn[k].classList.toggle('is-on', on);
          tabBtn[k].setAttribute('aria-selected', on ? 'true' : 'false');
          tabBtn[k].tabIndex = on ? 0 : -1;
        });
        builderPane.hidden = tab !== 'builder';
        queryPane.hidden = tab !== 'query';
        closeAc();
        if (tab === 'query') { autosize(); paintMirror(); runValidation(); }
        else setStatus('idle', 'Builder writes the query for you — results update as you change it');
      }

      /* ---------------- running ---------------- */
      function runCurrent() {
        if (st.tab === 'builder') { st.text = genQuery(st.builder, st.ds); runText(st.text, {}); }
        else runText(ta.value, {});
      }
      function runText(text, opts) {
        opts = opts || {};
        if (!text || !text.trim()) return;
        var t0 = (window.performance || Date).now();
        var res;
        try { res = RK.query(text, { dataset: st.ds, exclude: ctx.id }); }
        catch (e) {
          if (st.tab === 'query') runValidation();
          else setStatus('error', friendlyError(e.message, DS()));
          return;
        }
        res.ms = (window.performance || Date).now() - t0;
        if (res.dataset !== st.ds) {
          st.ds = res.dataset;
          st.builder = defaultBuilder(st.ds, null);
          paintDataset(); paintRef();
          if (st.tab !== 'builder') paintBuilder();
        }
        if (!opts.keepSort) st.tsort = null;
        st.last = { text: text, ds: res.dataset };
        if (!opts.silent) pushHistory(text, res.dataset);
        if (!opts.rerun && st.tab === 'builder') setStatus('ok', res.rows.length + ' row' + (res.rows.length === 1 ? '' : 's') + ' — results update as you edit', 'Run saves to history');
        if (!opts.rerun && st.tab === 'query' && !opts.silent) setStatus('ok', 'Ran — ' + res.rows.length + ' row' + (res.rows.length === 1 ? '' : 's') + ' in ' + res.ms.toFixed(1) + ' ms');
        result = res;
        paintResults(opts.rerun);
        if (!opts.silent && !opts.rerun) {
          runBtn.classList.remove('is-pulse');
          void runBtn.offsetWidth;
          if (ctx.motion) runBtn.classList.add('is-pulse');
        }
      }

      /* ---------------- results ---------------- */
      function sortedRows() {
        var rows = result.rows.slice();
        if (st.tsort) {
          var k = st.tsort.col, dir = st.tsort.dir === 'asc' ? 1 : -1;
          rows.sort(function (a, b) {
            var x = a[k], y = b[k];
            if (x == null || (typeof x === 'number' && isNaN(x))) return 1;
            if (y == null || (typeof y === 'number' && isNaN(y))) return -1;
            return (typeof x === 'string' ? x.localeCompare(String(y)) : x - y) * dir;
          });
        }
        return rows;
      }
      function isHi(r) {
        if (!highlights.length) return false;
        for (var k in r) if (typeof r[k] === 'string' && highlights.indexOf(r[k].toLowerCase()) >= 0) return true;
        return false;
      }
      function metricCandidates() {
        if (!o.addMetric || !result || result.aggregate) return [];
        var ds = RK.data.get(result.dataset);
        return (result.spec.select || []).filter(function (it) {
          if (!it.expr || it.expr === '*') return false;
          try {
            var c = RK.expr.compile(it.expr, { fields: ds.fields });
            return !c.aggregate && c.ast.type !== 'field' && c.ast.type !== 'lit' && c.fields.length > 0;
          } catch (e) { return false; }
        });
      }
      function activeFilters() {
        var ds = RK.data.get(result.dataset), fs = RK.store.filters();
        return Object.keys(fs).filter(function (k) { return fs[k].source !== ctx.id && RK.data.applies(fs[k], ds); });
      }

      function paintResults(rerun) {
        var ds = RK.data.get(result.dataset);
        result.columns.forEach(function (c) { c.title = prettyTitle(c, ds); });
        var rows = sortedRows();
        // header
        resHead.innerHTML = '';
        var nf = activeFilters();
        resHead.appendChild(h('div.rk-qc-rh__meta',
          h('strong.rk-num', RK.format(result.rows.length, '#,##0')), ' row' + (result.rows.length === 1 ? '' : 's'),
          h('span.rk-qc-dot', '·'), result.columns.length + ' col' + (result.columns.length === 1 ? '' : 's'),
          h('span.rk-qc-dot', '·'), h('span.rk-num', (result.ms || 0).toFixed(1) + ' ms'),
          nf.length ? h('span.rk-qc-badge', { title: 'Results respect the report filters: ' + nf.join(', ') }, h('span', { html: icon('filter', 11) }), nf.length + ' global filter' + (nf.length > 1 ? 's' : '')) : null,
          h('span.rk-qc-rh__note')));
        resHead.appendChild(h('span.rk-qc__spacer'));
        var viewSeg = h('div.rk-seg.rk-qc-seg', { role: 'group', 'aria-label': 'Result view' }, [['split', 'Split'], ['table', 'Table'], ['chart', 'Chart']].map(function (v) {
          return h('button', { type: 'button', class: st.view === v[0] ? 'is-on' : null, 'aria-pressed': st.view === v[0] ? 'true' : 'false', on: { click: function () { st.view = v[0]; paintResults(true); } } }, v[1]);
        }));
        resHead.appendChild(viewSeg);
        var cands = metricCandidates();
        if (cands.length) {
          var addBtn = h('button.rk-btn.rk-qc-mbtn', { type: 'button', title: 'Save a formula column as a new field of ' + ds.title, on: { click: function () { openAddMetric(addBtn, cands); } } },
            h('span', { html: icon('metric', 13) }), 'Add as metric');
          resHead.appendChild(addBtn);
        }
        resHead.appendChild(h('button.rk-btn.rk-qc-csv', { type: 'button', title: 'Download all result rows as CSV', on: { click: exportCSV } }, h('span', { html: icon('download', 13) }), 'CSV'));

        resBody.className = 'rk-qc-rb is-' + st.view;
        paintTable(rows);
        if (st.view !== 'table' && o.chart !== 'none') paintChart(rows, rerun);
        else if (chart) chart.resize();
      }

      function paintTable(rows) {
        var cols = result.columns;
        var max = o.maxRows || 500;
        var thead = h('thead', h('tr', cols.map(function (c) {
          var num = c.type === 'number';
          var on = st.tsort && st.tsort.col === c.name;
          return h('th', {
            class: (num ? 'is-num ' : '') + 'is-sortable' + (on ? ' is-sorted' : ''), scope: 'col', tabindex: '0',
            'aria-sort': on ? (st.tsort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
            on: {
              click: function () { sortBy(c); },
              keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c); } }
            }
          }, h('span', c.title), h('span.rk-sort', on ? (st.tsort.dir === 'asc' ? '▲' : '▼') : ''));
        })));
        var tbody = h('tbody', rows.slice(0, max).map(function (r) {
          return h('tr', { class: isHi(r) ? 'is-target' : null }, cols.map(function (c) {
            var v = r[c.name], num = typeof v === 'number';
            return h('td', { class: (c.type === 'number' || num ? 'is-num' : '') + (num && v < 0 ? ' is-neg' : '') }, Array.isArray(v) ? v.join(', ') : RK.format(v, c.format));
          }));
        }));
        tableWrap.innerHTML = '';
        if (!rows.length) { tableWrap.appendChild(h('div.rk-qc-empty', 'No rows match — check the "where" clause or the report filters.')); return; }
        tableWrap.appendChild(h('table.rk-table.rk-qc-tbl', thead, tbody));
        if (rows.length > max) tableWrap.appendChild(h('p.rk-qc-more', 'Showing first ' + max + ' of ' + rows.length + ' rows — CSV exports all.'));
      }
      function sortBy(c) {
        var cur = st.tsort && st.tsort.col === c.name ? st.tsort.dir : null;
        st.tsort = cur === 'desc' ? { col: c.name, dir: 'asc' } : cur === 'asc' ? null : { col: c.name, dir: c.type === 'number' ? 'desc' : 'asc' };
        if (cur === null && c.type !== 'number') st.tsort.dir = 'asc';
        paintResults(true);
      }

      /* ---------------- auto chart ---------------- */
      // bar  : one category column (horizontal ranking when labels are long / many; side-by-side
      //        panels when the measures have different units — the pitchbook "comps bar" layout)
      // line : category looks like a year / date; short annual series with mixed units become the
      //        classic columns + line combo (e.g. revenue bars + margin line on the right axis)
      var lastRows = null, panelMode = false;
      /** Axis ticks in the column format, without decimals on whole ticks ($#,##0.0 -> $4,000; 0.0x -> 10x; 2.5x stays). */
      function axisFmt(fmt) {
        var code = String(RK.format.presets[fmt] || fmt || 'auto');
        var whole = RK.format.decimals(code) ? code.replace(/\.[0#]+/g, '') : null;
        var zeros = new RegExp('\\' + RK.format.config.decimal + '0+(?!\\d)');
        return function (v) {
          var full = RK.format(v, code);
          return whole && zeros.test(full) ? RK.format(v, whole) : full;
        };
      }
      function isEstimate(c) { return typeof c === 'string' && /\d{2}\s?[EFPB]$/i.test(c.trim()); }
      function paintChart(rows, rerun) {
        lastRows = rows;
        var cols = result.columns;
        var dims = cols.filter(function (c) { return rows.some(function (r) { return r[c.name] != null && typeof r[c.name] !== 'number'; }) || (c.type !== 'number' && c.type !== undefined && !rows.some(function (r) { return isNum(r[c.name]); })); });
        var meas = cols.filter(function (c) { return dims.indexOf(c) < 0 && rows.some(function (r) { return isNum(r[c.name]); }); });
        // a numeric year column (fiscal_year) is a category, not a measure, when it is the first column
        if (!dims.length && meas.length > 1 && rows.every(function (r) { return isTimeLike(r[meas[0].name]); })) dims = [meas.shift()];
        chartMsg.innerHTML = '';
        chartWrap.classList.remove('has-msg', 'has-kpi');
        panelMode = false;
        st.chartNote = '';
        if (!rows.length || !meas.length) return chartMessage(!rows.length ? 'Nothing to chart' : 'No numeric column to chart');
        if (!dims.length) {
          if (rows.length === 1) return chartKpi(rows[0], meas);
          var lab = dimFields(DS())[0];
          return chartMessage('Add a label column (e.g. ' + (lab ? lab.name : 'company') + ') to chart these values');
        }
        var x = dims[0];
        var sdim = dims.length > 1 && meas.length === 1 ? dims[1] : null;
        var cats = RK.util.unique(rows.map(function (r) { return r[x.name]; }));
        var timeLike = cats.length > 1 && cats.every(isTimeLike);
        var kinds = RK.util.unique(meas.map(function (m) { return fmtKind(m.format); }));
        var combo = timeLike && !sdim && kinds.length > 1 && cats.length <= 15 && o.chart !== 'line';
        var kind = o.chart === 'bar' || o.chart === 'line' ? o.chart : (timeLike && !combo ? 'line' : 'bar');
        if (timeLike && !st.tsort) cats.sort(function (a, b) { return String(a).localeCompare(String(b)); });
        var catLabels = cats.map(function (c) { return c == null ? 'n.a.' : String(RK.format(c, x.format)); });
        var labelLen = Math.max.apply(null, catLabels.map(function (c) { return c.length; }));
        var horiz = kind === 'bar' && !timeLike && (cats.length > 7 || labelLen > 11);
        function byCat(list, field) {
          var mp = new Map();
          list.forEach(function (r) { if (!mp.has(r[x.name])) mp.set(r[x.name], r[field]); });
          return cats.map(function (c) { return mp.has(c) ? mp.get(c) : null; });
        }
        function valueOf(p) { return p && typeof p === 'object' && 'value' in p ? p.value : p; }
        function barData(values, color, single) {
          return values.map(function (v, i) {
            var c = color;
            if (single && highlights.indexOf(String(cats[i]).toLowerCase()) >= 0) c = t.accent2;
            if (isEstimate(cats[i])) c = RK.theme.mix(c, t.paper, 0.42);    // projected periods in a lighter shade
            return { value: v, itemStyle: { color: c } };
          });
        }
        function labelCfg(fmt, pos) {
          return { show: true, position: pos, distance: 4, color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum, formatter: function (p) { return RK.format(valueOf(p.value), fmt); } };
        }
        var opt, dropped = 0;
        var pal = RK.theme.palette({ n: 8 });   // series colours kept clear of accent-2 (reserved for the highlighted target)

        if (horiz && !sdim) {
          // ---- side-by-side horizontal panels sharing the category axis ----
          var panels = meas.slice(0, 3);
          dropped = meas.length - panels.length;
          // "Median EV/EBITDA 2025E" + "Median EBITDA margin" -> drop the shared aggregation word in panel titles
          var first = panels.map(function (p) { return String(p.title).split(' ')[0]; });
          var strip = panels.length > 1 && first.every(function (w) { return w === first[0]; }) && AGG_LABEL[first[0].toLowerCase()] != null;
          function panelTitle(p) { return strip ? String(p.title).slice(first[0].length + 1) : p.title; }
          var W = chartHost.clientWidth || 420;
          var labelW = Math.min(170, Math.max(70, labelLen * 6.3 + 14));
          var valPad = cats.length <= 24 ? 40 : 10, gap = 14, MINW = 60;
          // fit: shrink the label column first (labels truncate), then drop panels that still do not fit
          var fits = function (k, lw) { return (W - lw - k * valPad - (k - 1) * gap) / k >= MINW; };
          while (panels.length > 1 && !fits(panels.length, 90)) { panels.pop(); dropped++; }
          if (!fits(panels.length, labelW)) labelW = Math.max(90, W - panels.length * (MINW + valPad) - (panels.length - 1) * gap);
          var n = panels.length;
          panelMode = n > 1;
          var pw = Math.max(40, (W - labelW - n * valPad - (n - 1) * gap) / n);
          var top = n > 1 ? 24 : 8;
          var showVals = cats.length <= 24;
          opt = {
            animation: ctx.motion, color: pal,
            title: n > 1 ? panels.map(function (p, i) {
              return { text: panelTitle(p), left: labelW + i * (pw + valPad + gap), top: 2, textStyle: { fontSize: 11, fontWeight: 600, color: t.ink2, fontFamily: t.fontSans, width: pw + valPad - 8, overflow: 'truncate' } };
            }) : [],
            grid: panels.map(function (p, i) { return { left: labelW + i * (pw + valPad + gap), width: pw, top: top, bottom: n > 1 && showVals ? 6 : 22, containLabel: false }; }),
            tooltip: {
              trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
              formatter: function (ps) {
                if (!ps.length) return '';
                var i = ps[0].dataIndex, r = rows.filter(function (row) { return row[x.name] === cats[i]; })[0] || {};
                return RK.chart.tip(catLabels[i], panels.map(function (p, k) { return { color: k === 0 ? undefined : null, label: p.title, value: RK.format(r[p.name], p.format) }; }));
              }
            },
            xAxis: panels.map(function (p, i) {
              // labelled panels need no value axis (think-cell style); a single ranking keeps it
              var bare = n > 1 && showVals;
              return { type: 'value', gridIndex: i, splitNumber: n > 1 ? 3 : 5, axisLabel: { show: !bare, formatter: axisFmt(p.format), hideOverlap: true }, splitLine: { show: !bare, lineStyle: { color: t.grid } } };
            }),
            yAxis: panels.map(function (p, i) {
              return { type: 'category', gridIndex: i, data: catLabels, inverse: true, axisTick: { show: false },
                axisLabel: { show: i === 0, interval: 0, width: labelW - 12, overflow: 'truncate', color: t.ink2 } };
            }),
            series: panels.map(function (p, i) {
              return {
                name: p.title, type: 'bar', xAxisIndex: i, yAxisIndex: i, barMaxWidth: 26, barCategoryGap: '32%',
                data: barData(byCat(rows, p.name), pal[0], true),     // one colour: panels are labelled, accent-2 stays for the target
                label: showVals ? labelCfg(p.format || 'auto', 'right') : { show: false },
                emphasis: { focus: 'none' }
              };
            })
          };
        } else {
          // ---- vertical bars / lines / combo, optional right axis for a second unit ----
          var primaryKind = fmtKind(meas[0].format), secondary = null, plotted = [];
          meas.forEach(function (m) {
            var k = fmtKind(m.format);
            if (k === primaryKind && plotted.length < 4) plotted.push({ col: m, axis: 0 });
            else if (!horiz && !sdim && (!secondary || secondary === k) && plotted.length < 4) { secondary = k; plotted.push({ col: m, axis: 1 }); }
            else dropped++;
          });
          var series = [], legend = [];
          var single = !sdim && plotted.length === 1;
          var nBars = sdim ? 1 : plotted.filter(function (p) { return kind === 'bar' && p.axis === 0; }).length;
          var hasRight = plotted.some(function (p) { return p.axis === 1; });
          var barLabels = kind === 'bar' && cats.length <= 24 && (nBars === 1 || (!hasRight && nBars <= 2 && cats.length <= 8));
          var lineLabels = cats.length <= 15 && (kind === 'bar' ? hasRight : plotted.length <= 2);
          var showLabels = barLabels || lineLabels;
          if (sdim) {
            var groups = RK.util.groupBy(rows, function (r) { return r[sdim.name]; }), gi = 0;
            var gpal = RK.theme.palette({ n: groups.size });   // extended with tints instead of repeating
            groups.forEach(function (list, name) {
              legend.push(String(name));
              series.push(mk(String(name), byCat(list, meas[0].name), meas[0], 0, gpal[gi++], kind, false));
            });
          } else {
            plotted.forEach(function (p, i) {
              var asLine = kind === 'line' || p.axis === 1;
              var color = pal[i % pal.length];
              legend.push(p.col.title);
              series.push(mk(p.col.title, byCat(rows, p.col.name), p.col, p.axis, color, asLine ? 'line' : 'bar', single));
            });
          }
          function mk(name, values, col, axis, color, type, isSingle) {
            var fmt = col.format || 'auto';
            var se = {
              name: name, type: type, yAxisIndex: horiz ? 0 : axis,
              data: type === 'bar' ? barData(values, color, isSingle) : values,
              itemStyle: { color: color }, lineStyle: { color: color, width: 2 }, emphasis: { focus: 'series' },
              label: (type === 'bar' ? barLabels : lineLabels) ? labelCfg(fmt, type === 'bar' ? (horiz ? 'right' : 'top') : 'top') : { show: false }
            };
            if (type === 'bar') { se.barMaxWidth = 34; se.barGap = '12%'; se.barCategoryGap = isSingle ? '36%' : '28%'; }
            else { se.symbol = 'circle'; se.symbolSize = cats.length > 30 ? 0 : 6; se.showSymbol = cats.length <= 30; se.z = 3; }
            return se;
          }
          var p1 = plotted.filter(function (p) { return p.axis === 1; })[0];
          var catAxis = { type: 'category', data: catLabels, inverse: horiz, boundaryGap: kind === 'bar',
            axisLabel: horiz ? { interval: 0, hideOverlap: true, width: 150, overflow: 'truncate' } : { interval: cats.length <= 16 ? 0 : 'auto', hideOverlap: true } };
          // narrow charts: "2019A" -> "19A" so every period keeps its label (tooltips show the full label)
          var slot = ((chartHost.clientWidth || 400) - 90) / Math.max(1, cats.length);
          if (!horiz && slot < labelLen * 6.4 + 8 && catLabels.every(function (c) { return /^(FY)?\d{4}[A-Z]?$/.test(c); })) {
            catAxis.axisLabel.formatter = function (v) { return String(v).replace(/^(FY)?\d{2}(\d{2})/, '$2'); };
          }
          var valAxis = [{ type: 'value', scale: kind === 'line' && primaryKind !== 'num', axisLabel: { formatter: axisFmt(plotted[0] ? plotted[0].col.format : meas[0].format) }, splitLine: { lineStyle: { color: t.grid } } }];
          if (p1 && kind === 'bar') {
            // combo: bars in the lower ~60% of the plot, the second-unit line labelled above them (right axis hidden)
            var barMax = 0, lo = Infinity, hi = -Infinity;
            plotted.forEach(function (p) {
              byCat(rows, p.col.name).forEach(function (v) {
                if (!isNum(v)) return;
                if (p.axis === 0) barMax = Math.max(barMax, v); else { lo = Math.min(lo, v); hi = Math.max(hi, v); }
              });
            });
            var span = (hi - lo) || Math.abs(hi) || 1;
            if (barMax > 0) valAxis[0].max = function (e) { return RK.util.niceStep(e.max * 1.65, 1) * Math.ceil(e.max * 1.65 / RK.util.niceStep(e.max * 1.65, 1)); };
            valAxis.push({ type: 'value', position: 'right', min: lo - span * 1.9, max: hi + span * 0.35, axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } });
          } else if (p1) valAxis.push({ type: 'value', scale: true, position: 'right', axisLabel: { formatter: axisFmt(p1.col.format) }, splitLine: { show: false } });
          // long series: Ctrl/Cmd + wheel or pinch zooms (plain wheel scrolls the report), slider on screen only
          var zoom = kind === 'line' && cats.length > 40 ? RK.chart.zoom(ctx, 'x', { height: 16 }) : [];
          var slider = zoom.some(function (z) { return z.type === 'slider'; });
          var showLegend = legend.length > 1;
          opt = {
            animation: ctx.motion, color: pal,
            legend: RK.chart.legend(ctx, { show: showLegend, data: legend }),
            grid: { left: 4, right: p1 && kind !== 'bar' ? 8 : (horiz && showLabels ? 36 : 16), top: showLegend ? 34 : 14, bottom: slider ? 28 : 4, containLabel: true },
            tooltip: {
              trigger: 'axis', axisPointer: { type: kind === 'bar' ? 'shadow' : 'line' }, confine: true,
              formatter: function (ps) {
                if (!ps.length) return '';
                var i = ps[0].dataIndex;
                return RK.chart.tip(catLabels[i], ps.map(function (p) {
                  var col = sdim ? meas[0] : (plotted[p.seriesIndex] || plotted[0]).col;
                  return { color: p.color, label: p.seriesName, value: RK.format(valueOf(p.value), col.format) };
                }), isEstimate(cats[i]) ? 'Estimate' : null);
              }
            },
            xAxis: horiz ? valAxis[0] : catAxis,
            yAxis: horiz ? catAxis : valAxis,
            dataZoom: zoom,
            series: series
          };
        }
        var key = (opt.grid.length || 1) + '|' + horiz + '|' + kind + '|' + (opt.yAxis.length || 1) + '|' + opt.series.length;
        if (!chart) {
          chart = window.echarts.init(chartHost, 'rk', { renderer: 'svg' });
          ro = 'ResizeObserver' in window ? new ResizeObserver(RK.util.rafThrottle(function () {
            if (!chart) return;
            if (panelMode && lastRows) paintChart(lastRows, true); else chart.resize();
          })) : null;
          if (ro) ro.observe(chartHost);
        }
        chart.resize();
        if (key !== chartKey) chart.setOption(opt, { notMerge: true });
        else chart.setOption(opt, { replaceMerge: ['series', 'xAxis', 'yAxis', 'legend', 'dataZoom', 'grid', 'title'] });
        chartKey = key;
        if (dropped) st.chartNote = dropped + ' column' + (dropped > 1 ? 's' : '') + ' not charted (other units)';
        var note = resHead.querySelector('.rk-qc-rh__note');
        if (note) note.textContent = st.chartNote ? '· ' + st.chartNote : '';
      }
      function chartMessage(text) {
        if (chart) { chart.clear(); chartKey = null; }
        chartWrap.classList.add('has-msg');
        chartMsg.appendChild(h('div.rk-qc-chart__empty', text));
      }
      function chartKpi(row, meas) {
        if (chart) { chart.clear(); chartKey = null; }
        chartWrap.classList.add('has-kpi');
        var grid = h('div.rk-qc-kpis');
        meas.forEach(function (m) {
          var val = h('div.rk-qc-kpi__v.rk-num');
          grid.appendChild(h('div.rk-qc-kpi', h('div.rk-qc-kpi__k', m.title), val));
          RK.motion.countUp(val, row[m.name], { format: m.format || 'auto', animate: ctx.motion, duration: 700 });
        });
        chartMsg.appendChild(grid);
      }

      /* ---------------- CSV / add metric ---------------- */
      function exportCSV() {
        if (!result) return;
        var csv = RK.Dataset.prototype.toCSV.call({}, sortedRows(), result.columns);
        RK.util.download((result.dataset || 'query') + '-query.csv', csv, 'text/csv;charset=utf-8');
      }
      function openAddMetric(anchor, cands) {
        var ds = RK.data.get(result.dataset);
        var chosen = cands[0];
        var nameIn = h('input.rk-input.rk-qc-mono', { type: 'text', spellcheck: 'false', 'aria-label': 'Field name' });
        var titleIn = h('input.rk-input', { type: 'text', 'aria-label': 'Title' });
        var fmtIn = h('input.rk-input.rk-qc-mono', { type: 'text', spellcheck: 'false', placeholder: '0.0x', 'aria-label': 'Format' });
        var preview = h('div.rk-qc-am__preview.rk-num');
        var msg = h('div.rk-qc-am__msg');
        function fill(it) {
          chosen = it;
          var title = it.as || it.expr;
          titleIn.value = title;
          var base = slug(it.as || it.expr), name = base, n = 2;
          while (ds.field(name) && !ds.field(name).computed) name = base + '_' + (n++);
          nameIn.value = name;
          fmtIn.value = it.format || guessFormat(it.expr) || '';
          paintPreview();
        }
        function guessFormat(expr) {
          try {
            var c = RK.expr.compile(expr, { fields: ds.fields });
            var fs = c.fields.map(function (f) { return ds.field(f) && ds.field(f).format; });
            if (/\//.test(expr) && fs.length >= 2 && fs[0] && fs[0] === fs[1]) return fmtKind(fs[0]) === 'num' ? '0.0x' : null;
            return fs[0] || null;
          } catch (e) { return null; }
        }
        function paintPreview() {
          var vals;
          try {
            var c = RK.expr.compile(chosen.expr, { fields: ds.fields });
            vals = ds.rows.slice(0, 4).map(function (r) { return RK.format(c.eval(r, { params: RK.store.params() }), fmtIn.value || 'auto'); });
          } catch (e) { vals = []; }
          preview.textContent = vals.length ? 'Preview: ' + vals.join('  ·  ') + '  …' : '';
        }
        fmtIn.addEventListener('input', paintPreview);
        var choice = cands.length > 1 ? h('div.rk-qc-am__choice', cands.map(function (it, i) {
          var id = ctx.id + '-am-' + i;
          var radio = h('input', { type: 'radio', name: ctx.id + '-am', id: id, checked: i === 0, on: { change: function () { fill(it); } } });
          return h('label.rk-qc-am__opt', { for: id }, radio, h('code', it.expr), it.as ? h('span', it.as) : null);
        })) : h('code.rk-qc-am__expr', chosen.expr);
        var addBtn = h('button.rk-btn.rk-btn--primary', { type: 'button', on: { click: function () {
          var name = nameIn.value.trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { msg.textContent = 'Name must start with a letter and use letters, digits or _'; return; }
          if (ds.field(name) && !ds.field(name).computed) { msg.textContent = '"' + name + '" is already a source field of ' + ds.id; return; }
          try {
            ds.addComputed({ name: name, formula: chosen.expr, title: titleIn.value.trim() || name, format: fmtIn.value.trim() || null });
          } catch (e) { msg.textContent = e.message; return; }
          p.close();
          setStatus('ok', 'Added “' + (titleIn.value.trim() || name) + '” as field ' + name + ' to ' + ds.title + ' — every block using ' + ds.id + ' can now use it');
        } } }, 'Add to ' + ds.id);
        var form = h('div.rk-qc-am',
          h('div.rk-qc-am__title', 'Add formula as a dataset field'),
          choice,
          h('div.rk-qc-am__grid',
            h('label', h('span', 'Title'), titleIn),
            h('label', h('span', 'Field name'), nameIn),
            h('label', h('span', 'Format'), fmtIn)),
          preview, msg,
          h('div.rk-qc-am__foot', h('span.rk-muted', 'Recalculates live (incl. @parameters)'), addBtn));
        var p = track(popover(anchor, form, { minWidth: 360, align: 'right' }));
        fill(chosen);
        titleIn.focus();
        titleIn.select();
      }

      /* ---------------- wiring / first paint ---------------- */
      var onData = RK.util.debounce(function (e) {
        if (!alive) return;
        paintRef();
        paintDataset();
        if (st.tab === 'builder') paintBuilder();
        if (result && (!e || !e.dataset || e.dataset === result.dataset)) runText(st.last.text, { silent: true, rerun: true, keepSort: true });
      }, 40);
      var offData = RK.bus.on('data:changed', onData);

      paintDataset();
      paintBuilder();
      paintRef();
      paintExamples();
      setTab(st.tab);
      setRef(st.refOpen);
      autosize();
      paintMirror();
      if (st.last) runText(st.last.text, { silent: true, rerun: true, keepSort: true });
      else if (st.tab === 'builder' || !st.text) runText(genQuery(st.builder, st.ds), { silent: true });
      else runText(st.text, { silent: true });
      if (st.tab === 'query') runValidation();

      return {
        update: function (c) { ctx = c; },
        onStore: function (changes) {
          if (!alive) return;
          var params = changes.some(function (ch) { return ch.type === 'param'; });
          if (params) paintRef();
          if (!result) return;
          var ds = RK.data.get(result.dataset);
          // re-run when a global filter touches the dataset, or a parameter used by the query / its fields changes
          if ((ds && RK.data.affected(ds, changes)) || (params && /@/.test(st.last.text))) runText(st.last.text, { silent: true, rerun: true, keepSort: true });
        },
        resize: function () { if (chart) chart.resize(); },
        exportImage: function () {
          if (!chart || st.view === 'table') return null;
          return chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: t.paper });
        },
        destroy: function () {
          alive = false;
          clearTimeout(valTimer); clearTimeout(autoTimer);
          offData();
          closeAc();
          pops.forEach(function (p) { p.close(); });
          if (ro) ro.disconnect();
          if (chart) { chart.dispose(); chart = null; }
          root.remove();
        }
      };
    }
  });
})();
