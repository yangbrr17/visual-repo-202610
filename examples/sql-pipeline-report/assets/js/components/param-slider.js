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
 *   readout table of the bound dataset (current value and % change vs. base parameters)
 */
(function () {
  'use strict';
  var h = RK.util.h, isNum = RK.util.isNum;

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
    if (d.pct) return (diff > 0 ? '+' : '−') + RK.format(Math.abs(diff) * 10000, '#,##0') + ' bps';
    return (diff > 0 ? '+' : '−') + RK.format(Math.abs(diff), d.format);
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
        var valueBtn = h('button.rk-ps__value.rk-num', { type: 'button', title: 'Click to type a value', on: { click: edit } });
        var delta = h('span.rk-ps__delta.rk-num');
        var reset = h('button.rk-ps__reset', {
          type: 'button', title: 'Reset to ' + RK.format(d.base, d.format), 'aria-label': 'Reset ' + d.label + ' to base value',
          html: RK.ui.icon('reset'), on: { click: function () { set(d.base, false); } }
        });
        var basePct = (d.base - d.min) / ((d.max - d.min) || 1) * 100;
        var tick = h('i.rk-ps__base', { style: { left: 'calc(' + basePct + '% + ' + (8 - basePct * 0.16) + 'px)' }, title: 'Base ' + RK.format(d.base, d.format) });
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
          var tbody = h('tbody', data.map(function (r) {
            var base = null;
            return h('tr', fields.map(function (n) {
              var f = ds.field(n), v = r[n];
              var td = h('td', { class: f.type === 'number' ? 'is-num' : null }, RK.format(v, f.format));
              if (n === key) td.classList.add('is-key');
              if (live[n]) {
                td.classList.add('is-live');
                var b = (base || (base = baseRow(r, env)))[n];
                if (isNum(v) && isNum(b) && b !== 0 && Math.abs(v / b - 1) > 1e-9) {
                  var chg = v / b - 1;
                  td.appendChild(h('span.rk-ps__chg', { class: chg > 0 ? 'is-up' : 'is-down' }, RK.format(chg, '+0.0%;(0.0%)')));
                }
              }
              return td;
            }));
          }));
          var tfoot = null;
          if (totals.length) {
            tfoot = h('tfoot', h('tr.is-stat', fields.map(function (n, i) {
              var f = ds.field(n);
              if (totals.indexOf(n) < 0) return h('td', { class: f.type === 'number' ? 'is-num' : null }, i === 0 ? 'Total' : '');
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
              var fmt = it.format || (it.field && ds.field(it.field) && ds.field(it.field).format) || '$#,##0';
              var chg = isNum(v) && isNum(b) && b !== 0 && Math.abs(v / b - 1) > 1e-9 ? v / b - 1 : null;
              sumEl.appendChild(h('div.rk-ps__sitem', { class: it.key ? 'is-key' : null },
                h('span.rk-ps__slabel', String(it.label || it.name || '')),
                h('span.rk-ps__sval.rk-num', RK.format(v, fmt),
                  chg != null ? h('span.rk-ps__chg', { class: chg > 0 ? 'is-up' : 'is-down' }, RK.format(chg, '+0.0%;(0.0%)')) : null)));
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
