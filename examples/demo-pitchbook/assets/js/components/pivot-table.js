/*!
 * RK component: pivot-table — lightweight pivot (no dependency): nested row groups × one column
 * dimension, any RK.expr aggregate (sum / avg / median / count / ...), dimensions may be fields or
 * RK formulas (e.g. "year(date)"). Compact layout: group rows carry their subtotals and collapse /
 * expand; totals row (sticky footer) and totals column; CAGR column; % of row / column / total;
 * heat colouring; sort by total; click a label or column header to cross-filter; numbers tween on
 * update. Pure DOM on the shared .rk-table styles.
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
      'pivotTable.pctRow': '占行合计比例', 'pivotTable.pctCol': '占列合计比例', 'pivotTable.pctTotal': '占总计比例', 'pivotTable.agg.avg': '平均值',
      'pivotTable.agg.median': '中位数', 'pivotTable.agg.min': '最小值', 'pivotTable.agg.max': '最大值', 'pivotTable.agg.count': '计数',
      'pivotTable.agg.countd': '去重计数', 'pivotTable.agg.stdev': '标准差', 'pivotTable.agg.first': '首个值', 'pivotTable.agg.last': '末个值',
      'pivotTable.numRecords': '记录数', 'pivotTable.countOf': '{field}{agg}', 'pivotTable.aggOf': '{field}{agg}',
      'pivotTable.cagr': '年复合增长率', 'pivotTable.value': '数值', 'pivotTable.collapse': '收起 {label}', 'pivotTable.expand': '展开 {label}',
      'pivotTable.records': '记录', 'pivotTable.pctOf': '占{name}比例', 'pivotTable.pctOfTotal': '占合计比例', 'pivotTable.pctOfRow': '占行比例',
      'pivotTable.nRecord': '{n} 条记录', 'pivotTable.nRecords': '{n} 条记录'
    });
  }
  // generic field names (link tables, bridges...) cross-filter only this dataset (house rule: scoped selections)
  var GENERIC = /^(type|kind|source|target|step|stage|metric|status|name|label|key|id|category|group|series)$/i;

  var SHOW = {
    value: null,
    pctRow: '% of row total',
    pctCol: '% of column total',
    pctTotal: '% of grand total'
  };
  var AGG_LABEL = { sum: '', avg: 'Average', mean: 'Average', average: 'Average', median: 'Median', min: 'Minimum', max: 'Maximum', count: 'Count', countd: 'Distinct count', stdev: 'Std. dev.', first: 'First', last: 'Last' };
  var AGG_KEY = { avg: 'avg', mean: 'avg', average: 'avg', median: 'median', min: 'min', max: 'max', count: 'count', countd: 'countd', stdev: 'stdev', first: 'first', last: 'last' };
  /** Aggregate name in the report locale ('' for sum; unknown aggregates are shown as given). */
  function aggLabel(agg) {
    if (AGG_LABEL[agg] == null) return agg;
    return AGG_KEY[agg] ? tr('pivotTable.agg.' + AGG_KEY[agg], AGG_LABEL[agg]) : AGG_LABEL[agg];
  }
  /** '% of row total' ... in the report locale. */
  function showLabel(k) { return tr('pivotTable.' + k, SHOW[k]); }

  function cmp(a, b) {
    if (a == null) return 1;
    if (b == null) return -1;
    return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  /** A dimension / measure: plain field or RK formula evaluated per row. */
  function accessor(ctx, spec) {
    var o = ctx.options, titles = o.titles || {};
    if (spec == null) return null;
    if (ctx.dataset.has(spec)) {
      var f = ctx.field(spec);
      return { spec: spec, field: spec, title: titles[spec] || f.title, format: f.format, type: f.type, get: function (r) { return r[spec]; } };
    }
    var c = RK.expr.compile(spec, { fields: ctx.dataset.fields });
    var env = { params: RK.store.params() };
    return {
      spec: spec, field: null, title: titles[spec] || spec, format: null, type: 'number',
      get: function (r) { try { return c.eval(r, env); } catch (e) { return null; } }
    };
  }

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
  function heatScale(t, kind, domain, mid, intensity) {
    var all = (kind === 'div' ? t.div : t.seq).slice(), k = util.isNum(intensity) ? intensity : 0.5, stops;
    if (kind === 'div') {
      var c = Math.floor((all.length - 1) / 2), r = Math.max(1, Math.min(c, Math.round(k * 4)));
      stops = all.slice(c - r, c + r + 1);
    } else {
      stops = all.slice(1, Math.max(3, Math.min(all.length, Math.round(k * 10) + 1)));
    }
    var sc = kind === 'div' ? RK.theme.diverging(domain, mid, stops) : RK.theme.sequential(domain, stops);
    return function (v) { return util.isNum(v) ? readable(sc(v), t) : null; };
  }

  function label(dim, v) {
    if (v == null || v === '') return RK.format.config.na;
    if (typeof v === 'number' && !dim.format) return String(v);
    return RK.format(v, dim.format);
  }

  /** rows -> tree of nodes; every node keeps the measure values per column key and overall. */
  function buildTree(rows, dims, col, val) {
    function node(parent, value, dim, level) {
      return { key: parent ? parent.key + '\u0001' + value : 'root', value: value, dim: dim, level: level, parent: parent, kids: [], map: new Map(), cells: new Map(), all: [], n: 0 };
    }
    function add(n, ck, v) {
      n.n++;
      n.all.push(v);
      var a = n.cells.get(ck);
      if (!a) n.cells.set(ck, a = []);
      a.push(v);
    }
    var root = node(null, null, null, -1);
    rows.forEach(function (r) {
      var v = val ? val.get(r) : 1, ck = col ? col.get(r) : '\u0000';
      var n = root;
      add(n, ck, v);
      dims.forEach(function (d, li) {
        var k = d.get(r);
        var c = n.map.get(k);
        if (!c) { c = node(n, k, d, li); n.map.set(k, c); n.kids.push(c); }
        n = c;
        add(n, ck, v);
      });
    });
    return root;
  }

  RK.component({
    id: 'pivot-table',
    deps: [],
    defaults: {
      rows: ['segment'],     // row dimensions, outer -> inner (fields or RK formulas)
      cols: 'year',          // column dimension (field or formula); null = one value column
      value: 'revenue',      // measure (field or formula); null with agg 'count' counts rows
      agg: 'sum',            // sum | avg | median | min | max | count | countd | stdev | first | last
      format: null,          // defaults to the measure format ('#,##0' for counts)
      show: 'value',         // value | pctRow | pctCol | pctTotal
      totalRow: true,        // bottom row: totals per column (sticky footer)
      totalCol: false,       // right column: totals per row
      cagr: false,           // CAGR column from the first to the last column
      collapsible: true,
      collapsed: false,      // start with outer row groups collapsed
      sort: null,            // null (data order) | 'label' | 'total-desc' | 'total-asc'
      colSort: 'asc',        // asc | desc | null (data order)
      heat: false,           // false | 'seq' | 'div' — colour leaf cells
      heatIntensity: 0.5,
      heatMinN: 1,           // cells aggregating fewer records stay uncoloured (e.g. 2: a single deal is not a "high")
      titles: {},            // {"<field or formula>": "Display title"}
      valueTitle: null,      // measure label in the corner (default e.g. "Median EV/LTM EBITDA")
      scroll: true,          // fixed block height with sticky header / totals; false = grow to content
      tooltip: true,
      crossFilter: true
    },
    render: function (ctx) {
      var cur = ctx, collapsed = null, prevVals = new Map(), first = true;
      var auto = !ctx.options.scroll || ctx.print;
      if (auto) ctx.el.classList.add('is-auto');

      var thead = h('thead'), tbody = h('tbody'), tfoot = h('tfoot');
      var table = h('table.rk-table.rk-pivot__table', thead, tbody, tfoot);
      var tip = RK.ui.tip();
      var scroller = h('div.rk-pivot__scroll', table);
      var root = h('div.rk-pivot', { class: auto ? 'is-auto' : null }, scroller);
      ctx.el.appendChild(root);
      // horizontal scroll cue: edge fade while columns sit off to the right, shadow on the sticky row headers
      function edges() {
        root.classList.toggle('is-more-r', scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 1);
        root.classList.toggle('is-scrolled-x', scroller.scrollLeft > 1);
      }
      scroller.addEventListener('scroll', edges, { passive: true });
      var model = null;

      /* ---------------- model ---------------- */
      function compute(c) {
        var o = c.options;
        var dims = [].concat(o.rows || []).filter(Boolean).map(function (d) { return accessor(c, d); });
        var col = accessor(c, o.cols);
        var val = o.value ? accessor(c, o.value) : null;
        var fn = RK.expr.agg[o.agg] || RK.expr.agg.sum;
        var tree = buildTree(c.rows, dims, col, val);
        var ckeys = Array.from(tree.cells.keys());
        if (col && o.colSort) { ckeys.sort(cmp); if (o.colSort === 'desc') ckeys.reverse(); }

        var counting = o.agg === 'count' || o.agg === 'countd';
        function agg(list) { return list && list.length ? fn(list) : (counting ? 0 : null); }
        // memoised per node (the tree is rebuilt on every compute)
        function cell(n, ck) {
          var memo = n.memo || (n.memo = new Map());
          if (!memo.has(ck)) memo.set(ck, agg(n.cells.get(ck)));
          return memo.get(ck);
        }
        function total(n) { if (!('tot' in n)) n.tot = agg(n.all); return n.tot; }
        // sort siblings at every level
        (function sortKids(n) {
          if (o.sort === 'label') n.kids.sort(function (a, b) { return cmp(a.value, b.value); });
          else if (o.sort === 'total-desc' || o.sort === 'total-asc') {
            var s = o.sort === 'total-asc' ? 1 : -1;
            n.kids.sort(function (a, b) { var x = total(a), y = total(b); return x == null ? 1 : y == null ? -1 : (x - y) * s; });
          }
          n.kids.forEach(sortKids);
        })(tree);

        var colTotals = {};
        ckeys.forEach(function (k) { colTotals[k] = cell(tree, k); });
        var grand = total(tree);
        // counts show empty cells as an en dash; other measures as n.a.
        var vfmt = acct(o.format || (counting ? '#,##0;-#,##0;"–"' : (val && val.format) || '#,##0.0'));
        var pct = o.show && o.show !== 'value' && SHOW[o.show] !== undefined;
        function shown(n, ck) {
          var v = ck === '\u0002' ? total(n) : cell(n, ck);
          if (!pct || !util.isNum(v)) return v;
          var base = o.show === 'pctRow' ? total(n) : o.show === 'pctCol' ? (ck === '\u0002' ? grand : colTotals[ck]) : grand;
          return base ? v / base : NaN;
        }
        function cagr(n) {
          if (ckeys.length < 2) return null;
          var a = cell(n, ckeys[0]), b = cell(n, ckeys[ckeys.length - 1]);
          if (!util.isNum(a) || !util.isNum(b)) return null;
          if (a <= 0 || b < 0) return NaN;
          return Math.pow(b / a, 1 / (ckeys.length - 1)) - 1;
        }
        return { o: o, dims: dims, col: col, val: val, tree: tree, ckeys: ckeys, cell: cell, total: total, shown: shown, cagr: cagr, fmt: pct ? '0.0%;(0.0%)' : vfmt, vfmt: vfmt, pct: pct };
      }

      function measureLabel(m) {
        var o = m.o, a = aggLabel(o.agg), s;
        if (o.valueTitle) s = o.valueTitle;
        else if (!m.val) s = tr('pivotTable.numRecords', 'Number of records');
        else if (o.agg === 'count' || o.agg === 'countd') s = tr('pivotTable.countOf', '{agg} of {field}', { agg: a, field: m.val.title });
        else s = a ? tr('pivotTable.aggOf', '{agg} {field}', { agg: a, field: m.val.title }) : m.val.title;
        return m.pct ? s + ' — ' + showLabel(o.show) : s;
      }

      /* ---------------- header ---------------- */
      function drawHead(m) {
        var o = m.o, hasCols = !!m.col;
        var corner = h('th.rk-pivot__corner.is-sticky', { rowspan: hasCols ? 2 : null, scope: 'col' },
          h('span.rk-pivot__measure', measureLabel(m)),
          h('span.rk-pivot__dims', m.dims.map(function (d) { return d.title; }).join(' / ')));
        var extra = [];
        if (o.totalCol) extra.push(h('th.is-num.rk-pivot__tot', { rowspan: hasCols ? 2 : null, scope: 'col' }, totalLabel(o)));
        if (o.cagr && hasCols && m.ckeys.length > 1) {
          extra.push(h('th.is-num.rk-pivot__cagr', { rowspan: 2, scope: 'col' }, tr('pivotTable.cagr', 'CAGR'), h('span.rk-pivot__sub',
            label(m.col, m.ckeys[0]) + '–' + label(m.col, m.ckeys[m.ckeys.length - 1]))));
        }
        thead.innerHTML = '';
        var sel = m.col && m.col.field ? cur.selected(m.col.field) : [];
        var colCells = m.ckeys.map(function (k) {
          var th = h('th.is-num.rk-pivot__ch', {
            scope: 'col',
            class: (m.col && m.col.field && cur.options.crossFilter !== false ? 'is-clickable ' : '') + (sel.indexOf(k) >= 0 ? 'is-selected' : (sel.length ? 'is-dim' : ''))
          }, hasCols ? label(m.col, k) : (m.val ? m.val.title : tr('pivotTable.value', 'Value')));
          th._rkCol = k;
          return th;
        });
        if (hasCols) {
          thead.appendChild(h('tr.rk-table__group', corner, h('th.rk-pivot__coltitle', { colspan: m.ckeys.length, scope: 'colgroup' }, h('span', m.col.title)), extra));
          thead.appendChild(h('tr', colCells));
        } else {
          thead.appendChild(h('tr', corner, colCells, extra));
        }
      }

      function totalLabel(o) { return o.agg === 'sum' || o.agg === 'count' || o.agg === 'countd' ? tr('total', 'Total') : tr('all', 'All'); }

      /* ---------------- body ---------------- */
      function drawBody(m, animate) {
        var o = m.o, t = cur.theme, depth = m.dims.length;
        if (!collapsed) {
          collapsed = new Set();
          if (o.collapsed && depth > 1) (function walk(n) { n.kids.forEach(function (k) { if (k.kids.length && k.level < depth - 1) { collapsed.add(k.key); walk(k); } }); })(m.tree);
        }
        // heat domain over the leaf cells as displayed
        var heat = null, minN = Math.max(1, +o.heatMinN || 1);
        function heated(n, k) { return (n.cells.get(k) || []).length >= minN; }
        if (o.heat) {
          var vals = [];
          (function walk(n) {
            if (!n.kids.length && n.level >= 0) m.ckeys.forEach(function (k) { var v = m.shown(n, k); if (util.isNum(v) && heated(n, k)) vals.push(v); });
            n.kids.forEach(walk);
          })(m.tree);
          if (vals.length > 1) {
            var ext = util.extent(vals);
            heat = heatScale(t, o.heat === 'div' ? 'div' : 'seq', ext, RK.expr.agg.median(vals), o.heatIntensity);
          }
        }
        var selBy = m.dims.map(function (d) { return d.field ? cur.selected(d.field) : []; });
        var anySel = selBy.some(function (s) { return s.length; });
        var colSel = m.col && m.col.field ? cur.selected(m.col.field) : [];
        var tweens = [];
        tbody.innerHTML = '';
        tfoot.innerHTML = '';

        function valueCells(n, isLeaf) {
          var out = m.ckeys.map(function (k) {
            var v = m.shown(n, k), hc = isLeaf && heat && heated(n, k) ? heat(v) : null;
            var td = h('td.is-num.rk-pivot__v', {
              class: (hc ? 'is-heat ' : '') + (isLeaf && heat && !heated(n, k) && util.isNum(v) ? 'is-thin ' : '') + (colSel.length && colSel.indexOf(k) < 0 ? 'is-coldim' : ''),
              style: hc ? { 'background-color': hc.bg, color: hc.fg } : null
            });
            td._rkCell = { node: n, ck: k };
            tweens.push([td, n.key + '|' + k, v, m.fmt]);
            return td;
          });
          if (o.totalCol) {
            var tv = m.shown(n, '\u0002');
            var td = h('td.is-num.rk-pivot__tot');
            td._rkCell = { node: n, ck: '\u0002' };
            tweens.push([td, n.key + '|tot', tv, m.fmt]);
            out.push(td);
          }
          if (o.cagr && m.col && m.ckeys.length > 1) {
            var cg = h('td.is-num.rk-pivot__cagr');
            tweens.push([cg, n.key + '|cagr', m.cagr(n), '0.0%;(0.0%)']);
            out.push(cg);
          }
          return out;
        }
        function onPath(n) {
          for (var p = n; p && p.level >= 0; p = p.parent) if (selBy[p.level].indexOf(p.value) >= 0) return true;
          return false;
        }
        function hiddenBy(n) {
          for (var p = n.parent; p && p.level >= 0; p = p.parent) if (collapsed.has(p.key)) return true;
          return false;
        }
        var idx = 0;
        (function walk(n) {
          n.kids.forEach(function (k) {
            var group = k.kids.length > 0 && k.level < depth - 1;
            var open = !collapsed.has(k.key);
            var lab = h('td.rk-pivot__label.is-sticky', { style: { 'padding-left': (8 + k.level * 16) + 'px' } },
              group && o.collapsible !== false
                ? h('button.rk-pivot__tg', { type: 'button', 'aria-expanded': String(open), 'aria-label': tr(open ? 'pivotTable.collapse' : 'pivotTable.expand', open ? 'Collapse {label}' : 'Expand {label}', { label: label(k.dim, k.value) }) })
                : (group ? null : (depth > 1 ? h('span.rk-pivot__tg-sp') : null)),
              h('span.rk-pivot__name', { class: k.dim.field && o.crossFilter !== false ? 'is-clickable' : null }, label(k.dim, k.value)));
            var rowEl = h('tr', {
              class: [group ? 'is-group' : 'is-leaf', 'is-l' + k.level, hiddenBy(k) ? 'is-hidden' : '',
                anySel ? (onPath(k) ? 'is-selected' : 'is-dim') : ''].join(' ')
            }, lab, valueCells(k, !group));
            rowEl._rkNode = k;
            rowEl.dataset.key = k.key;
            if (first && cur.motion) { rowEl.classList.add('is-in'); rowEl.style.setProperty('--rk-i', Math.min(idx, 40)); }
            idx++;
            tbody.appendChild(rowEl);
            walk(k);
          });
        })(m.tree);

        if (o.totalRow) {
          var rowEl = h('tr.is-stat.is-stat-first.rk-pivot__total', h('td.rk-pivot__label.is-sticky', totalLabel(o)), valueCells(m.tree, false));
          tfoot.appendChild(rowEl);
        }

        // write numbers (tweened from the previous render when motion is on)
        var next = new Map();
        function paint(k) {
          tweens.forEach(function (tw) {
            var to = tw[2], from = prevVals.get(tw[1]);
            var x = k < 1 && util.isNum(to) && util.isNum(from) ? from + (to - from) * k : to;
            tw[0].textContent = RK.format(x, tw[3]);
          });
        }
        tweens.forEach(function (tw) { next.set(tw[1], tw[2]); });
        if (animate && cur.motion && prevVals.size) RK.motion.tween(450, paint, 'outCubic');
        else paint(1);
        prevVals = next;
      }

      function draw(animate) {
        model = compute(cur);
        drawHead(model);
        drawBody(model, animate);
        edges();
        first = false;
      }

      /* ---------------- interactions ---------------- */
      function toggle(tr) {
        var n = tr._rkNode;
        var open = collapsed.has(n.key);
        if (open) collapsed.delete(n.key); else collapsed.add(n.key);
        tr.querySelector('.rk-pivot__tg').setAttribute('aria-expanded', String(open));
        Array.prototype.forEach.call(tbody.children, function (row) {
          var k = row._rkNode, hidden = false;
          for (var p = k.parent; p && p.level >= 0; p = p.parent) if (collapsed.has(p.key)) { hidden = true; break; }
          var was = row.classList.contains('is-hidden');
          row.classList.toggle('is-hidden', hidden);
          if (was && !hidden && cur.motion) {
            row.classList.remove('is-in', 'is-enter');
            void row.offsetWidth;
            row.classList.add('is-enter');
          }
        });
      }
      function onClick(e) {
        var tg = e.target.closest('.rk-pivot__tg');
        var tr = e.target.closest('tr');
        if (tg && tr && tr._rkNode) { toggle(tr); return; }
        if (cur.options.crossFilter === false) return;
        var name = e.target.closest('.rk-pivot__name.is-clickable');
        if (name && tr && tr._rkNode) { select(tr._rkNode.dim.field, tr._rkNode.value); return; }
        var ch = e.target.closest('th.rk-pivot__ch.is-clickable');
        if (ch && model.col && model.col.field) select(model.col.field, ch._rkCol);
      }
      function select(f, v) { cur.select(f, v, GENERIC.test(f) && !cur.options.crossFilterScope ? { scope: 'dataset' } : null); }
      function onOver(e) {
        var td = e.target.closest('td.rk-pivot__v, td.rk-pivot__tot');
        if (!td || !td._rkCell || cur.options.tooltip === false) { tip.hide(); return; }
        var m = model, n = td._rkCell.node, ck = td._rkCell.ck;
        var path = [];
        for (var p = n; p && p.level >= 0; p = p.parent) path.unshift(label(p.dim, p.value));
        var title = (path.length ? path.join(' › ') : totalLabel(m.o)) + (m.col ? '  ·  ' + (ck === '\u0002' ? totalLabel(m.o) : label(m.col, ck)) : '');
        var raw = ck === '\u0002' ? m.total(n) : m.cell(n, ck);
        var rows = [{ label: m.val ? m.val.title : tr('pivotTable.records', 'Records'), value: RK.format(raw, m.vfmt), bold: true }];
        var colTot = ck === '\u0002' ? m.total(m.tree) : m.cell(m.tree, ck);
        if (n.level >= 0 && util.isNum(raw) && colTot) rows.push({ label: m.col && ck !== '\u0002' ? tr('pivotTable.pctOf', '% of {name}', { name: label(m.col, ck) }) : tr('pivotTable.pctOfTotal', '% of total'), value: RK.format(raw / colTot, '0.0%') });
        var rowTot = m.total(n);
        if (m.col && ck !== '\u0002' && util.isNum(raw) && rowTot && (m.o.agg === 'sum' || m.o.agg === 'count')) rows.push({ label: tr('pivotTable.pctOfRow', '% of row'), value: RK.format(raw / rowTot, '0.0%') });
        var cnt = ck === '\u0002' ? n.n : (n.cells.get(ck) || []).length;
        tip.show(RK.chart.tip(title, rows, tr(cnt === 1 ? 'pivotTable.nRecord' : 'pivotTable.nRecords', cnt === 1 ? '{n} record' : '{n} records', { n: cnt })), td);
      }
      table.addEventListener('click', onClick);
      table.addEventListener('mouseover', onOver);
      table.addEventListener('mouseleave', tip.hide);

      draw(false);

      return {
        update: function (c) { cur = c; draw(true); },
        resize: edges,
        destroy: function () {
          scroller.removeEventListener('scroll', edges);
          table.removeEventListener('click', onClick);
          table.removeEventListener('mouseover', onOver);
          table.removeEventListener('mouseleave', tip.hide);
          root.remove();
          tip.destroy();
          if (auto) cur.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
