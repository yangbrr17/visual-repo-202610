/*!
 * RK component: param-slider — what-if parameter sliders bound to RK.store params (@wacc, @tgr ...).
 * Moving a slider calls RK.store.setParam(): datasets re-materialise every computed field that
 * references the parameter (Dataset.addComputed) and the blocks using them update live.
 *
 * - params default to the report's RK.data.manifest.params (value / min / max / step / format / title);
 *   missing ranges are inferred from the base value (rates get a ±50% band in 25 bp steps)
 * - live formatted value (click it to type an exact number), change vs. base (bps for % formats),
 *   base-value tick on the track, per-slider reset, compact single-row mode for the top bar
 * - options.computed adds formula fields to the bound dataset; options.preview renders a small live
 *   readout table of the bound dataset (current value and change vs. base parameters: relative % for
 *   amounts, percentage points / bps for rates, n.m. when the base is zero or negative)
 */
(function () {
  'use strict';
  var h = RK.util.h, isNum = RK.util.isNum;

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'paramSlider.nmZero': '无意义：基准值为零', 'paramSlider.nmNeg': '无意义：基准值为负数', 'paramSlider.type': '点击输入数值',
      'paramSlider.resetTo': '恢复为 {value}', 'paramSlider.resetLabel': '将{label}恢复为基准值', 'paramSlider.base': '基准 {value}'
    });
  }

  /* ---------------- parameter definitions ---------------- */
  function decimalsOf(step) {
    var s = String(+step.toFixed(10));
    return s.indexOf('.') < 0 ? 0 : s.length - s.indexOf('.') - 1;
  }
  function snap(v, d) {
    var n = Math.round((v - d.min) / d.step) * d.step + d.min;
    return +RK.util.clamp(n, d.min, d.max).toFixed(Math.min(12, decimalsOf(d.step) + 2));
  }

  // the same parameter reads the same everywhere (stacked panel, top bar, other reports)
  var KNOWN = {
    wacc: 'WACC', tgr: 'Terminal growth', g: 'Terminal growth', terminal_growth: 'Terminal growth', exit_multiple: 'Exit multiple',
    entry_multiple: 'Entry multiple', tax_rate: 'Tax rate', ke: 'Cost of equity', kd: 'Cost of debt', erp: 'Equity risk premium',
    beta: 'Beta', rf: 'Risk-free rate', leverage: 'Leverage', synergies: 'Synergies', premium: 'Offer premium', offer_price: 'Offer price'
  };
  function labelOf(name) {
    var k = String(name).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(KNOWN, k)) return KNOWN[k];
    var s = String(name).replace(/[_\-]+/g, ' ').trim();
    return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Merge option entries with manifest params and infer what is missing. */
  function resolveParams(list) {
    var man = (RK.data.manifest && RK.data.manifest.params) || {};
    var names = list && list.length ? list : Object.keys(man);
    return names.map(function (p) {
      if (typeof p === 'string') p = { name: p };
      var m = man[p.name];
      m = RK.util.isObj(m) ? m : (m != null ? { value: m } : {});
      var d = RK.util.merge({}, m, p);
      var cur = RK.store.param(d.name);
      d.base = isNum(d.default) ? d.default : isNum(d.value) ? d.value : isNum(cur) ? cur : 0;
      d.label = String(d.label || d.title || labelOf(d.name));
      var rate = d.base !== 0 && Math.abs(d.base) < 1;
      var span = rate ? Math.max(Math.abs(d.base) * 0.5, 0.01) : Math.max(Math.abs(d.base) * 0.5, 1);
      if (!isNum(d.step)) {
        if (rate) d.step = span * 2 >= 0.02 ? 0.0025 : 0.001;
        else { var raw = RK.util.niceStep(span * 2, 40); d.step = raw; }
      }
      if (!isNum(d.min)) d.min = Math.floor((d.base - span) / d.step) * d.step;
      if (!isNum(d.max)) d.max = Math.ceil((d.base + span) / d.step) * d.step;
      d.min = +d.min.toFixed(10); d.max = +d.max.toFixed(10);
      if (!d.format) {
        var dec = decimalsOf(rate ? d.step * 100 : d.step);
        d.format = rate ? '0.' + '00'.slice(0, Math.max(1, dec)) + '%' : (dec ? '#,##0.' + new Array(dec + 1).join('0') : '#,##0');
      }
      d.pct = /%/.test(RK.format.presets[d.format] || d.format);
      d.id = RK.util.uid('rk-ps');
      return d;
    });
  }

  /** Signed change vs. base: basis points for percentages, else the value format with a sign. */
  function deltaText(v, d) {
    var diff = v - d.base;
    if (Math.abs(diff) < d.step / 1000) return '';
    if (d.pct) return (diff > 0 ? '+' : '−') + bpsText(diff);
    return (diff > 0 ? '+' : '−') + RK.format(Math.abs(diff), d.format);
  }
  /** |diff| of two rates (fractions) in basis points: 0.0025 -> "25 bps". */
  function bpsText(diff) { return RK.format(Math.abs(diff) * 10000, '#,##0') + ' bps'; }
  /** |diff| of two rates (fractions) in percentage points: 0.023 -> "2.3 pp". */
  function ppText(diff) { return RK.format(Math.abs(diff) * 100, '#,##0.0') + ' pp'; }

  /**
   * How a readout value's change vs. base reads, from its format code (or an explicit preview.changes entry):
   *   'pp'  — a rate shown with % (0.0%, +0%;-0%): the change in percentage points (bps when every move is < 1 pp);
   *           v / b - 1 on a rate is meaningless (a premium going from -2% to +4% is not a "(300%)" change)
   *   'pts' — values already in percent units ('0.0"%"', unit '%'): the plain difference, in pp
   *   'bps' — values in basis points ('#,##0" bps"'): the plain difference, in bps
   *   'rel' — amounts ($, x, counts): relative change v / b - 1, n.m. when the base is zero or negative
   *   'none'
   */
  function changeKind(fmt, field, override) {
    if (override === 'rel' || override === 'pp' || override === 'pts' || override === 'bps' || override === 'none') return override;
    var code = String((fmt && RK.format.presets[fmt]) || fmt || ''), bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '');
    if (/%/.test(bare)) return 'pp';
    var lit = (code.match(/"[^"]*"/g) || []).join(' ') + ' ' + ((field && field.unit) || '');
    if (/bps|bp\b/i.test(lit)) return 'bps';
    if (/%|\bpp\b|percent/i.test(lit)) return 'pts';
    return 'rel';
  }
  /**
   * Change badge text + direction for value v vs. base b. small = every change in this column is < 1 pp, so rates
   * read in bps. Negatives in parentheses (table convention); null when there is no change to show.
   */
  function changeOf(kind, v, b, small) {
    if (kind === 'none' || !isNum(v) || !isNum(b)) return null;
    var diff = v - b;
    if (Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(b))) return null;
    var text;
    if (kind === 'pp') text = small ? bpsText(diff) : ppText(diff);
    else if (kind === 'pts') text = small ? bpsText(diff / 100) : ppText(diff / 100);
    else if (kind === 'bps') text = RK.format(Math.abs(diff), '#,##0') + ' bps';
    else {
      // a relative change needs a positive base: from 0 it is undefined, from a negative base its sign is inverted
      if (!(b > 0)) return { text: RK.format.config.nm, dir: 'nm', title: b === 0 ? tr('paramSlider.nmZero', 'Not meaningful: the base value is zero') : tr('paramSlider.nmNeg', 'Not meaningful: the base value is negative') };
      var chg = v / b - 1;
      if (Math.abs(chg) <= 1e-9) return null;
      return { text: RK.format(chg, '+0.0%;(0.0%)'), dir: chg > 0 ? 'up' : 'down' };
    }
    return { text: diff > 0 ? '+' + text : '(' + text + ')', dir: diff > 0 ? 'up' : 'down' };
  }
  /** True when every change in a column of rates is below 1 pp (the column then reads in bps). */
  function smallMoves(kind, pairs) {
    var unit = kind === 'pp' ? 0.01 : kind === 'pts' ? 1 : 0;
    return !!unit && pairs.every(function (p) { return !isNum(p[0]) || !isNum(p[1]) || Math.abs(p[0] - p[1]) < unit - 1e-12; });
  }
  function changeEl(c) {
    return c ? h('span.rk-ps__chg', { class: 'is-' + c.dir, title: c.title || null }, c.text) : null;
  }

  /** Parse typed input ("9.25%", "9.25", "0.0925", "$1,200", "8.5x"). */
  function parseInput(text, d) {
    var s = String(text).trim().replace(/[,\s$€£x]/gi, '');
    var pctSign = /%$/.test(s);
    s = s.replace(/%$/, '').replace(/bps$/i, '').replace(/^−/, '-');
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    if (d.pct && (pctSign || Math.abs(n) >= 1)) n /= 100;
    return n;
  }

  RK.component({
    id: 'param-slider',
    deps: [],
    needsData: false,
    lazy: false,
    defaults: {
      params: null,         // [{name, label, min, max, step, format}] or ['wacc', ...]; null = all report params
      compact: false,       // single-row inline layout (top bar); automatic inside .rk-topbar
      columns: null,        // slider columns in the stacked layout (null = auto-fit)
      showRange: true,      // min / max labels under each track
      showDelta: true,      // change vs. base value (bps for % formats)
      computed: [],         // [{name, formula, title, format}] computed fields added to the bound dataset
      preview: false,       // true | {fields, where, title, total} live readout table of the bound dataset
      tools: false
    },
    render: function (ctx) {
      var o = ctx.options, ds = ctx.dataset;
      var compact = o.compact || !!ctx.block.closest('.rk-topbar');
      var defs = resolveParams(o.params);
      ctx.el.classList.add('is-auto');
      // parameters that only exist in the options (not in the report manifest) start at their base value
      var undef = {};
      defs.forEach(function (d) { if (RK.store.param(d.name) === undefined) undef[d.name] = d.base; });
      RK.store.defineParams(undef);

      // computed fields that depend on the parameters (idempotent: re-render keeps them)
      var computedNames = [];
      if (ds && o.computed && o.computed.length) {
        o.computed.forEach(function (c) {
          var ex = ds.field(c.name);
          if (!ex || ex.formula !== c.formula) ds.addComputed(c);
          computedNames.push(c.name);
        });
      }

      var root = h('div.rk-ps', { class: (compact ? 'rk-ps--compact' : 'rk-ps--stacked') + (ctx.motion ? '' : ' is-static') });
      var grid = h('div.rk-ps__grid', { style: o.columns ? { '--rk-ps-cols': o.columns } : null });
      root.appendChild(grid);
      var rows = defs.map(function (d) { return buildSlider(d); });
      var preview = o.preview && ds ? buildPreview() : null;
      if (preview) root.appendChild(preview.el);
      ctx.el.appendChild(root);
      sync();

      /* ---------------- one slider ---------------- */
      function buildSlider(d) {
        var input = h('input.rk-range.rk-ps__range', {
          type: 'range', id: d.id, min: d.min, max: d.max, step: d.step, 'aria-label': d.label,
          on: { input: function () { set(+input.value, true); }, change: function () { set(+input.value, false); } }
        });
        var valueBtn = h('button.rk-ps__value.rk-num', { type: 'button', title: tr('paramSlider.type', 'Click to type a value'), on: { click: edit } });
        var delta = h('span.rk-ps__delta.rk-num');
        var reset = h('button.rk-ps__reset', {
          type: 'button', title: tr('paramSlider.resetTo', 'Reset to {value}', { value: RK.format(d.base, d.format) }), 'aria-label': tr('paramSlider.resetLabel', 'Reset {label} to base value', { label: d.label }),
          html: RK.ui.icon('reset'), on: { click: function () { set(d.base, false); } }
        });
        var basePct = (d.base - d.min) / ((d.max - d.min) || 1) * 100;
        var tick = h('i.rk-ps__base', { style: { left: 'calc(' + basePct + '% + ' + (8 - basePct * 0.16) + 'px)' }, title: tr('paramSlider.base', 'Base {value}', { value: RK.format(d.base, d.format) }) });
        var track = h('div.rk-ps__track', input, tick);
        var range = o.showRange && !compact ? h('div.rk-ps__minmax.rk-num', h('span', RK.format(d.min, d.format)), h('span', RK.format(d.max, d.format))) : null;
        var row = h('div.rk-ps__item',
          h('div.rk-ps__head',
            h('label.rk-ps__label', { for: d.id }, d.label),
            h('span.rk-ps__readout', o.showDelta ? delta : null, reset, valueBtn)),
          track, range);
        grid.appendChild(row);

        var pending = null, timer = null;
        function set(v, live) {
          v = snap(v, d);
          paint(v);
          pending = v;
          // throttle store writes while dragging: every change re-materialises computed fields
          if (live) { if (!timer) timer = setTimeout(flush, 60); }
          else flush();
        }
        function flush() {
          clearTimeout(timer); timer = null;
          if (pending != null && RK.store.param(d.name) !== pending) RK.store.setParam(d.name, pending);
          pending = null;
        }
        function paint(v) {
          if (document.activeElement !== input || +input.value !== v) input.value = v;
          var pct = (v - d.min) / ((d.max - d.min) || 1) * 100;
          input.style.setProperty('--rk-fill', RK.util.clamp(pct, 0, 100) + '%');
          input.setAttribute('aria-valuetext', RK.format(v, d.format));
          valueBtn.textContent = RK.format(v, d.format);
          var dt = deltaText(v, d);
          delta.textContent = dt;
          delta.className = 'rk-ps__delta rk-num' + (dt ? (v > d.base ? ' is-up' : ' is-down') : '');
          row.classList.toggle('is-changed', !!dt);
        }
        function edit() {
          var cur = RK.store.param(d.name);
          var field = h('input.rk-input.rk-ps__edit.rk-num', { type: 'text', value: RK.format(isNum(cur) ? cur : d.base, d.format), 'aria-label': d.label + ' value' });
          var done = false;
          function finish(commit) {
            if (done) return;
            done = true;
            if (commit) {
              var n = parseInput(field.value, d);
              if (n != null) set(n, false);
            }
            field.replaceWith(valueBtn);
            if (commit !== null) valueBtn.focus();
          }
          field.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          });
          field.addEventListener('blur', function () { finish(true); });
          valueBtn.replaceWith(field);
          field.focus();
          field.select();
        }
        return {
          def: d,
          refresh: function () { var v = RK.store.param(d.name); paint(isNum(v) ? v : d.base); },
          destroy: function () { clearTimeout(timer); }
        };
      }

      /* ---------------- live readout table ---------------- */
      function buildPreview() {
        var p = RK.util.isObj(o.preview) ? o.preview : {};
        var strField = ds.fields.filter(function (f) { return f.type === 'string' || f.type === 'date'; })[0];
        var fields = (p.fields || [strField && strField.name].concat(computedNames)).filter(function (n) { return n && ds.has(n); });
        var totals = p.total === true ? fields.filter(function (n) { return ds.field(n).type === 'number'; }) : (p.total || []);
        var changes = RK.util.isObj(p.changes) ? p.changes : {};   // per-field override: rel | pp | pts | bps | none
        var wrap = h('div.rk-ps__preview');
        if (p.title) wrap.appendChild(h('div.rk-ps__ptitle', String(p.title)));
        var table = h('table.rk-table.rk-ps__table');
        wrap.appendChild(table);
        // headline outputs under the table, e.g. PV of terminal value and enterprise value
        var summary = (p.summary || []).filter(function (it) { return it && (it.field || it.expr); });
        var sumEl = summary.length ? h('div.rk-ps__summary') : null;
        if (sumEl) wrap.appendChild(sumEl);
        var sumExpr = {};
        summary.forEach(function (it, i) {
          if (!it.expr) return;
          var names = summary.slice(0, i).map(function (x, j) { return { name: x.name || 's' + j, type: 'number' }; });
          try { sumExpr[i] = RK.expr.compile(it.expr, { fields: names }); } catch (e) { console.warn('[RK] param-slider summary', it.expr, e.message); }
        });
        /** Summary values for a set of rows: field aggregates, then formulas over the earlier items. */
        function summarise(data, env) {
          var vals = {}, out = [];
          summary.forEach(function (it, i) {
            var v = null;
            if (it.field) {
              var fn = RK.expr.agg[it.agg || 'sum'] || RK.expr.agg.sum;
              v = fn(data.map(function (r) { return r[it.field]; }).filter(isNum));
            } else if (sumExpr[i]) {
              try { v = sumExpr[i].eval(vals, env); } catch (e) { v = null; }
            }
            vals[it.name || 's' + i] = v;
            out.push(v);
          });
          return out;
        }

        function baseParams() {
          var out = RK.util.merge({}, RK.store.params());
          defs.forEach(function (d) { out[d.name] = d.base; });
          return out;
        }
        /** Base-case row: the dataset's computed fields re-evaluated in order with the base params (chains included). */
        function baseRow(r, env) {
          var b = RK.util.merge({}, r);
          ds.computed.forEach(function (c) { try { b[c.def.name] = c.compiled.eval(b, env); } catch (e) { b[c.def.name] = null; } });
          return b;
        }
        function draw() {
          var data = RK.data.view(ds, p.where ? { where: p.where } : null);
          var env = { params: baseParams() };
          var live = {};   // computed fields driven by a @param directly or through another computed field
          ds.computed.forEach(function (c) { live[c.def.name] = c.compiled.params.length > 0 || c.compiled.fields.some(function (f) { return live[f]; }); });
          // one key output column carries the weight; the other computed columns read as plain ink figures
          var key = p.key || fields.filter(function (n) { return live[n]; }).slice(-1)[0];
          var thead = h('thead', h('tr', fields.map(function (n) {
            var f = ds.field(n);
            return h('th', { class: (f.type === 'number' ? 'is-num' : '') + (n === key ? ' is-key' : '') }, String(f.title || n));
          })));
          // base-case rows once per draw; each live column reads its change in its own unit (relative %, pp or bps)
          var bases = data.map(function (r) { return baseRow(r, env); });
          var kinds = {}, small = {};
          fields.forEach(function (n) {
            if (!live[n]) return;
            var f = ds.field(n);
            kinds[n] = changeKind(f.format, f, changes[n]);
            small[n] = smallMoves(kinds[n], data.map(function (r, i) { return [r[n], bases[i][n]]; }));
          });
          var tbody = h('tbody', data.map(function (r, ri) {
            return h('tr', fields.map(function (n) {
              var f = ds.field(n), v = r[n];
              var td = h('td', { class: f.type === 'number' ? 'is-num' : null }, RK.format(v, f.format));
              if (n === key) td.classList.add('is-key');
              if (live[n]) {
                td.classList.add('is-live');
                var ch = changeEl(changeOf(kinds[n], v, bases[ri][n], small[n]));
                if (ch) td.appendChild(ch);
              }
              return td;
            }));
          }));
          var tfoot = null;
          if (totals.length) {
            tfoot = h('tfoot', h('tr.is-stat', fields.map(function (n, i) {
              var f = ds.field(n);
              if (totals.indexOf(n) < 0) return h('td', { class: f.type === 'number' ? 'is-num' : null }, i === 0 ? tr('total', 'Total') : '');
              var s = RK.expr.agg.sum(data.map(function (r) { return r[n]; }));
              return h('td.is-num', RK.format(s, f.format));
            })));
          }
          table.innerHTML = '';
          table.appendChild(thead);
          table.appendChild(tbody);
          if (tfoot) table.appendChild(tfoot);
          if (sumEl) {
            var now = summarise(data, { params: RK.store.params() });
            var then = summarise(data.map(function (r) { return baseRow(r, env); }), env);
            sumEl.innerHTML = '';
            summary.forEach(function (it, i) {
              var v = now[i], b = then[i];
              var sf = it.field ? ds.field(it.field) : null;
              var fmt = it.format || (sf && sf.format) || '$#,##0';
              var kind = changeKind(fmt, sf, it.change);
              sumEl.appendChild(h('div.rk-ps__sitem', { class: it.key ? 'is-key' : null },
                h('span.rk-ps__slabel', String(it.label || it.name || '')),
                h('span.rk-ps__sval.rk-num', RK.format(v, fmt), changeEl(changeOf(kind, v, b, smallMoves(kind, [[v, b]]))))));
            });
          }
          if (ctx.motion) {
            wrap.classList.remove('is-flash');
            void wrap.offsetWidth;
            wrap.classList.add('is-flash');
          }
        }
        draw();
        return { el: wrap, draw: draw };
      }

      function sync() { rows.forEach(function (r) { r.refresh(); }); }

      return {
        update: function (c) { ctx = c; sync(); if (preview) preview.draw(); },
        onStore: function (changes) {
          var params = changes.some(function (ch) { return ch.type === 'param'; });
          if (params) sync();
          if (preview && (params || changes.some(function (ch) { return ch.type === 'filter' || ch.type === 'data'; }))) preview.draw();
        },
        destroy: function () { rows.forEach(function (r) { r.destroy(); }); root.remove(); }
      };
    }
  });
})();
