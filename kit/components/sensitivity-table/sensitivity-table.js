/*!
 * RK component: sensitivity-table — two-way sensitivity grid (DCF value vs WACC × terminal growth,
 * LBO IRR vs entry × exit multiple ...) built from long data {row, col, value}.
 * Diverging heat vs the base case (or a hurdle via options.mid), base cell boxed, axis titles,
 * row + column crosshair on hover, tooltip with the change vs base, Value / Δ / % toggle, click a
 * cell to re-base (sets the @params when the base is bound to them). Pure DOM.
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
      'sensitivityTable.value': '数值', 'sensitivityTable.delta': 'Δ 较基准', 'sensitivityTable.pct': '% 较基准',
      'sensitivityTable.mode': '显示方式', 'sensitivityTable.vsBase': '较基准', 'sensitivityTable.pctVsBase': '较基准 %',
      'sensitivityTable.baseCase': '基准情形', 'sensitivityTable.setBase': '点击设为基准情形',
      'sensitivityTable.caption': '基准情形：{row}，{col} = {value}'
    });
  }

  var MODES = [['value', 'Value'], ['delta', 'Δ vs base'], ['pct', '% vs base']];

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
  /** Accounting negatives (house rule): '$#,##0.00' -> '$#,##0.00;($#,##0.00)'; an explicit '-' section -> parentheses. */
  function acct(code) {
    var c = numericCode(code);
    if (!c) return code;
    var s = sections(c);
    if (s.length === 1) return c + ';(' + c.replace(/^\+/, '') + ')';
    if (/^-/.test(s[1])) s[1] = '(' + s[1].slice(1) + ')';
    return s.join(';');
  }
  /** '+fmt;(fmt);fmt' from a value format, so deltas read "+$2.15" / "($1.40)". */
  function deltaFormat(fmt) {
    var f = sections(String(numericCode(fmt) || '#,##0.0'))[0].replace(/^\+/, '');
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
   * Heat scale on the theme ramp clamped to its inner stops (div-2..div-6 / seq-2..seq-6 at the default
   * intensity): the midpoint is the theme's visible neutral (never a paper-coloured hole, also in ink), the
   * ends stay chromatic, and the text keeps 4.5:1.
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

  function nearestIndex(list, v) {
    if (!util.isNum(v)) return -1;
    var best = -1, d = Infinity;
    list.forEach(function (x, i) { var e = Math.abs(x - v); if (e < d) { d = e; best = i; } });
    return best;
  }

  function cmp(a, b) { return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)); }

  /** Long rows -> {rows:[...], cols:[...], cell(i, j) -> value}. */
  function grid(ctx) {
    var enc = ctx.enc, o = ctx.options;
    var rv = util.unique(ctx.rows.map(function (r) { return r[enc.row]; })).filter(function (v) { return v != null; }).sort(cmp);
    var cv = util.unique(ctx.rows.map(function (r) { return r[enc.col]; })).filter(function (v) { return v != null; }).sort(cmp);
    if (o.rowOrder === 'desc') rv.reverse();
    if (o.colOrder === 'desc') cv.reverse();
    var m = new Map();
    ctx.rows.forEach(function (r) { m.set(r[enc.row] + '\u0001' + r[enc.col], r[enc.value]); });
    return { rows: rv, cols: cv, cell: function (i, j) { var v = m.get(rv[i] + '\u0001' + cv[j]); return v == null ? null : v; } };
  }

  RK.component({
    id: 'sensitivity-table',
    deps: [],
    defaults: {
      encode: { row: 'wacc', col: 'tgr', value: 'value' },
      base: null,              // {row, col} base-case values, or '@param' names; null = middle cell
      rowTitle: null,          // defaults to the row field title (e.g. "WACC")
      colTitle: null,          // defaults to the col field title (e.g. "Terminal growth")
      rowFormat: null,         // header formats default to the field formats
      colFormat: null,
      format: null,            // cell format (defaults to the value field format)
      deltaFormat: null,       // defaults to '+fmt;-fmt;fmt'
      heat: 'div',             // div | seq | false
      mid: null,               // midpoint of the diverging scale (default: base value), e.g. 0.20 IRR hurdle
      reverse: false,          // true when lower is better
      heatIntensity: 0.55,
      mode: 'value',           // value | delta | pct
      toggle: true,            // Value / Δ vs base / % vs base switch
      caption: true,           // "Base case ..." line above the grid
      crosshair: true,
      tooltip: true,
      rebase: true,            // click a cell to make it the base case
      rowOrder: 'asc',
      colOrder: 'asc'
    },
    render: function (ctx) {
      var cur = ctx, mode = ctx.options.mode, override = null, cells = [], rowHeads = [], colHeads = [];
      var lastVals = null;
      ctx.el.classList.add('is-auto');

      var root = h('div.rk-sens');
      var bar = h('div.rk-sens__bar');
      var caption = h('div.rk-sens__caption');
      var seg = h('div.rk-seg.rk-sens__seg.rk-noprint', { role: 'group', 'aria-label': tr('sensitivityTable.mode', 'Display mode') });
      var table = h('table.rk-table.rk-sens__table');
      var tip = RK.ui.tip();
      bar.appendChild(caption);
      bar.appendChild(seg);
      root.appendChild(bar);
      root.appendChild(h('div.rk-sens__wrap', table));
      ctx.el.appendChild(root);

      MODES.forEach(function (m) {
        seg.appendChild(h('button', { type: 'button', dataset: { mode: m[0] }, 'aria-pressed': 'false' }, tr('sensitivityTable.' + m[0], m[1])));
      });

      /* ---------------- base case ---------------- */
      function paramName(v) { return typeof v === 'string' && v.charAt(0) === '@' ? v.slice(1) : null; }
      function baseIndex(g) {
        var b = cur.options.base || {};
        var br = override ? override.row : (paramName(b.row) ? RK.store.param(paramName(b.row)) : b.row);
        var bc = override ? override.col : (paramName(b.col) ? RK.store.param(paramName(b.col)) : b.col);
        var i = br == null ? -1 : (typeof g.rows[0] === 'number' ? nearestIndex(g.rows, br) : g.rows.indexOf(br));
        var j = bc == null ? -1 : (typeof g.cols[0] === 'number' ? nearestIndex(g.cols, bc) : g.cols.indexOf(bc));
        if (i < 0) i = Math.floor((g.rows.length - 1) / 2);
        if (j < 0) j = Math.floor((g.cols.length - 1) / 2);
        return { i: i, j: j };
      }

      function formats() {
        var o = cur.options, enc = cur.enc;
        var vf = acct(o.format || cur.fmtOf(enc.value) || '#,##0.00');
        return {
          value: vf,
          delta: o.deltaFormat ? acct(o.deltaFormat) : deltaFormat(vf),
          pct: '+0.0%;(0.0%);0.0%',
          row: o.rowFormat || cur.fmtOf(enc.row),
          col: o.colFormat || cur.fmtOf(enc.col)
        };
      }

      /** Displayed number for a cell in the current mode (the base cell always shows its value). */
      function shown(v, bv, isBase) {
        if (!util.isNum(v)) return null;
        if (mode === 'value' || isBase) return v;
        if (!util.isNum(bv)) return null;
        if (mode === 'delta') return v - bv;
        return bv === 0 ? NaN : v / bv - 1;
      }

      /* ---------------- build ---------------- */
      function draw(how) {
        var o = cur.options, enc = cur.enc, t = cur.theme;
        var g = grid(cur), F = formats(), b = baseIndex(g);
        var bv = g.cell(b.i, b.j);
        var vals = [];
        for (var i = 0; i < g.rows.length; i++) for (var j = 0; j < g.cols.length; j++) vals.push(g.cell(i, j));
        var nums = vals.filter(util.isNum);
        var ext = util.extent(nums);
        var mid = o.mid != null ? o.mid : (util.isNum(bv) ? bv : RK.expr.agg.median(nums));
        var scale = !o.heat ? null : heatScale(t, o.heat === 'seq' ? 'seq' : 'div', ext, mid, o.heatIntensity, o.reverse);
        var sameShape = cells.length === g.rows.length && cells[0] && cells[0].length === g.cols.length && how !== 'rebuild';

        root.classList.toggle('has-heat', !!scale);
        if (!sameShape) build(g, F);
        // header labels can change (e.g. a filter narrowed the grid) — refresh in place
        g.rows.forEach(function (rv, i) { rowHeads[i].textContent = RK.format(rv, F.row); rowHeads[i].classList.toggle('is-base', i === b.i); });
        g.cols.forEach(function (cv, j) { colHeads[j].textContent = RK.format(cv, F.col); colHeads[j].classList.toggle('is-base', j === b.j); });

        var fmt = mode === 'value' ? F.value : F[mode];
        var next = [];
        for (i = 0; i < g.rows.length; i++) {
          next.push([]);
          for (j = 0; j < g.cols.length; j++) {
            var td = cells[i][j], v = g.cell(i, j), isBase = i === b.i && j === b.j;
            var fill = scale && util.isNum(v) ? scale(v) : null;
            td.style.backgroundColor = fill ? fill.bg : '';
            td.style.color = fill ? fill.fg : '';
            td.classList.toggle('is-base', isBase);
            td.classList.toggle('is-na', !util.isNum(v));
            td._rk = { i: i, j: j, v: v, row: g.rows[i], col: g.cols[j] };
            next[i].push(shown(v, bv, isBase));
          }
        }
        var prev = lastVals;
        lastVals = next;
        state.g = g; state.b = b; state.bv = bv; state.F = F;
        caption.textContent = o.caption === false ? '' : tr('sensitivityTable.caption', 'Base case: {row}, {col} = {value}', {
          row: (o.rowTitle || cur.title(enc.row)) + ' ' + RK.format(g.rows[b.i], F.row),
          col: (o.colTitle || cur.title(enc.col)) + ' ' + RK.format(g.cols[b.j], F.col), value: RK.format(bv, F.value) });
        Array.prototype.forEach.call(seg.children, function (btn) {
          var on = btn.dataset.mode === mode;
          btn.classList.toggle('is-on', on);
          btn.setAttribute('aria-pressed', String(on));
        });
        bar.style.display = o.toggle === false && o.caption === false ? 'none' : '';
        seg.style.display = o.toggle === false ? 'none' : '';

        function paint(k) {
          for (var a = 0; a < next.length; a++) for (var c = 0; c < next[a].length; c++) {
            var to = next[a][c], from = prev && prev[a] && prev[a][c];
            var x = k >= 1 || !util.isNum(to) || !util.isNum(from) ? to : from + (to - from) * k;
            var isB = a === b.i && c === b.j;
            cells[a][c].textContent = RK.format(x, isB ? F.value : fmt);
            // without heat, negative changes read in the negative colour
            cells[a][c].classList.toggle('is-neg', !scale && !isB && mode !== 'value' && util.isNum(to) && to < 0);
          }
        }
        if (how === 'tween' && prev && cur.motion) RK.motion.tween(420, paint, 'outCubic');
        else if (how === 'fade' && cur.motion) {
          table.classList.add('is-swapping');
          setTimeout(function () { paint(1); table.classList.remove('is-swapping'); }, 130);
        } else paint(1);
      }

      var state = {};

      function build(g, F) {
        var o = cur.options, enc = cur.enc;
        var n = g.cols.length;
        cells = []; rowHeads = []; colHeads = [];
        table.innerHTML = '';
        var colgroup = h('colgroup', h('col.rk-sens__c-title'), h('col.rk-sens__c-head'));
        for (var j = 0; j < n; j++) colgroup.appendChild(h('col'));
        var thead = h('thead',
          h('tr',
            h('th.rk-sens__corner', { colspan: 2, rowspan: 2 }, h('span', cur.title(enc.value))),
            h('th.rk-sens__coltitle', { colspan: n, scope: 'colgroup' }, h('span', o.colTitle || cur.title(enc.col)))),
          h('tr', g.cols.map(function () {
            var th = h('th.rk-sens__ch.is-num', { scope: 'col' });
            colHeads.push(th);
            return th;
          })));
        var tbody = h('tbody');
        g.rows.forEach(function (rv, i) {
          var tr = h('tr');
          if (i === 0) {
            tr.appendChild(h('th.rk-sens__rowtitle', { rowspan: g.rows.length, scope: 'rowgroup' },
              h('span', o.rowTitle || cur.title(enc.row))));
          }
          var rh = h('th.rk-sens__rh.is-num', { scope: 'row' });
          rowHeads.push(rh);
          tr.appendChild(rh);
          cells.push([]);
          g.cols.forEach(function () {
            var td = h('td.rk-sens__cell.is-num');
            cells[i].push(td);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(colgroup);
        table.appendChild(thead);
        table.appendChild(tbody);
        lastVals = null;
        if (cur.motion) {
          root.classList.remove('is-in');
          void root.offsetWidth;
          root.classList.add('is-in');
        }
      }

      /* ---------------- interactions ---------------- */
      var hot = null;
      function cross(td) {
        if (hot === td) return;
        clear();
        hot = td;
        if (!td || !td._rk || cur.options.crosshair === false) return;
        var p = td._rk;
        cells[p.i].forEach(function (c) { c.classList.add('is-xrow'); });
        cells.forEach(function (row) { row[p.j].classList.add('is-xcol'); });
        rowHeads[p.i].classList.add('is-hot');
        colHeads[p.j].classList.add('is-hot');
        td.classList.add('is-hot');
      }
      function clear() {
        if (!hot) return;
        root.querySelectorAll('.is-xrow, .is-xcol, .is-hot').forEach(function (el) { el.classList.remove('is-xrow', 'is-xcol', 'is-hot'); });
        hot = null;
      }
      function showTip(td) {
        if (cur.options.tooltip === false || !td || !td._rk) { tip.hide(); return; }
        var o = cur.options, enc = cur.enc, p = td._rk, F = state.F, bv = state.bv;
        var isBase = p.i === state.b.i && p.j === state.b.j;
        var rows = [{ label: cur.title(enc.value), value: RK.format(p.v, F.value), bold: true }];
        if (!isBase && util.isNum(p.v) && util.isNum(bv)) {
          rows.push({ label: tr('sensitivityTable.vsBase', 'vs base'), value: RK.format(p.v - bv, F.delta) });
          rows.push({ label: tr('sensitivityTable.pctVsBase', '% vs base'), value: RK.format(bv ? p.v / bv - 1 : NaN, F.pct) });
        }
        tip.show(RK.chart.tip((o.rowTitle || cur.title(enc.row)) + ' ' + RK.format(p.row, F.row) + '  ·  ' +
          (o.colTitle || cur.title(enc.col)) + ' ' + RK.format(p.col, F.col), rows,
          isBase ? tr('sensitivityTable.baseCase', 'Base case') : (o.rebase !== false ? tr('sensitivityTable.setBase', 'Click to set as base case') : null)), td);
      }
      function onOver(e) {
        var td = e.target.closest('td.rk-sens__cell');
        cross(td);
        showTip(td);
      }
      function onLeave() { clear(); tip.hide(); }
      function onClick(e) {
        var td = e.target.closest('td.rk-sens__cell');
        if (!td || !td._rk || cur.options.rebase === false) return;
        var b = cur.options.base || {}, p = td._rk;
        var pr = paramName(b.row), pc = paramName(b.col);
        if (pr || pc) {
          // base bound to @params: move the params, every dependent block follows
          if (pr) RK.store.setParam(pr, p.row);
          if (pc) RK.store.setParam(pc, p.col);
          override = null;
        } else {
          override = { row: p.row, col: p.col };
        }
        draw('tween');
        showTip(td);
      }
      function onSeg(e) {
        var btn = e.target.closest('button[data-mode]');
        if (!btn || btn.dataset.mode === mode) return;
        mode = btn.dataset.mode;
        draw('fade');
      }
      table.addEventListener('mouseover', onOver);
      table.addEventListener('mouseleave', onLeave);
      table.addEventListener('click', onClick);
      seg.addEventListener('click', onSeg);

      // a base bound to @params follows param changes (e.g. a WACC slider elsewhere on the page)
      var unsub = RK.store.subscribe(function (changes) {
        var b = cur.options.base || {};
        var names = [paramName(b.row), paramName(b.col)].filter(Boolean);
        if (!names.length) return;
        if (changes.some(function (c) { return c.type === 'param' && names.indexOf(c.key) >= 0; })) draw('tween');
      });

      draw('rebuild');

      return {
        update: function (c) { cur = c; draw('tween'); },
        destroy: function () {
          unsub();
          table.removeEventListener('mouseover', onOver);
          table.removeEventListener('mouseleave', onLeave);
          table.removeEventListener('click', onClick);
          seg.removeEventListener('click', onSeg);
          root.remove();
          tip.destroy();
          cur.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
