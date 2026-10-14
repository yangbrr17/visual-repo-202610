/*!
 * RK component: scenario-switch — segmented control (Base / Upside / Downside) that drives the
 * report through RK.store: a filter on the scenario field (mode 'filter') or a plain state key
 * that other components listen to (mode 'state'). Sliding indicator, radio-group keyboard
 * navigation, optional per-scenario headline metric and description caption.
 * Pure DOM (no chart engine). The default value is applied on mount when the store has none,
 * and re-applied if something clears it (a scenario view must always show exactly one case).
 */
(function () {
  'use strict';
  var h = RK.util.h;

  // name -> tone used for the small status dot (overridable with options.tones)
  var TONES = [[/up|bull|high|best|strong|accel|optimis/i, 'pos'], [/down|bear|low|worst|stress|weak|reces|pessim/i, 'neg']];
  function autoTone(v) {
    for (var i = 0; i < TONES.length; i++) if (TONES[i][0].test(String(v))) return TONES[i][1];
    return 'base';
  }
  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  RK.component({
    id: 'scenario-switch',
    deps: [],
    needsData: false,
    lazy: false,
    defaults: {
      field: 'scenario',    // dataset field the scenarios live in
      values: null,         // explicit order; null = distinct values of the bound dataset (data order)
      labels: {},           // value -> display label
      descriptions: {},     // value -> caption shown under the control
      default: null,        // initial value (null = first value)
      mode: 'filter',       // filter | state
      key: null,            // store key (defaults to the field name)
      label: null,          // small-caps label (e.g. "Scenario")
      tones: 'auto',        // 'auto' | false | {value: 'pos' | 'neg' | 'base'}
      metric: null,         // {field, agg, where, format, label, compare} headline value under each option
      layout: 'auto',       // auto | stacked | inline   (auto = inline inside .rk-topbar)
      tools: false
    },
    render: function (ctx) {
      var o = ctx.options, ds = ctx.dataset;
      var key = o.key || o.field;
      var values = (o.values && o.values.length ? o.values : (ds && ds.has(o.field) ? ds.distinct(o.field) : ['Base', 'Upside', 'Downside'])).slice();
      var inline = o.layout === 'inline' || (o.layout === 'auto' && !!ctx.block.closest('.rk-topbar'));
      var labelId = RK.util.uid('rk-ss-label');
      ctx.el.classList.add('is-auto');

      var root = h('div.rk-ss', { class: (inline ? 'rk-ss--inline' : 'rk-ss--stacked') + (o.metric ? ' has-metric' : '') + (ctx.motion ? '' : ' is-static') });
      var labelText = o.label || (ds && ds.has(o.field) ? ds.field(o.field).title : null);
      if (o.metric && o.metric.label) labelText = (labelText ? labelText + ' · ' : '') + o.metric.label;
      if (labelText) root.appendChild(h('span.rk-ss__label', { id: labelId }, labelText));

      var track = h('div.rk-ss__track', { role: 'radiogroup', 'aria-labelledby': labelText ? labelId : null, 'aria-label': labelText ? null : 'Scenario' });
      var thumb = h('span.rk-ss__thumb', { 'aria-hidden': 'true' });
      track.appendChild(thumb);
      var buttons = values.map(function (v, i) {
        var tone = o.tones === false ? null : (RK.util.isObj(o.tones) && o.tones[v]) || autoTone(v);
        var b = h('button.rk-ss__opt', {
          type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-tone': tone,
          on: {
            click: function () { choose(v, true); },
            keydown: function (e) { onKey(e, i); }
          }
        },
        h('span.rk-ss__main', tone ? h('i.rk-ss__dot', { 'aria-hidden': 'true' }) : null, h('span.rk-ss__text', o.labels[v] || String(v))),
        o.metric ? h('span.rk-ss__metric.rk-num') : null);
        track.appendChild(b);
        return b;
      });
      root.appendChild(track);
      var desc = h('p.rk-ss__desc', { 'aria-live': 'polite' });
      var hasDesc = Object.keys(o.descriptions || {}).length > 0;
      if (hasDesc) root.appendChild(desc);
      ctx.el.appendChild(root);

      /* ---------------- store bridge ---------------- */
      function current() {
        var v;
        if (o.mode === 'state') v = RK.store.get(key);
        else { var f = RK.store.filter(key); v = f && f.op === 'in' && f.values && f.values.length ? f.values[0] : null; }
        if (v == null) return null;
        for (var i = 0; i < values.length; i++) if (same(values[i], v)) return values[i];
        return v;
      }
      function apply(v) {
        if (o.mode === 'state') RK.store.set(key, v);
        else RK.store.setFilter(key, { field: o.field, op: 'in', values: [v] });
      }
      function choose(v, focus) {
        if (!same(current(), v)) apply(v);
        paint(v, focus);
      }

      /* ---------------- painting ---------------- */
      var active = null;
      function paint(v, focus) {
        active = v;
        buttons.forEach(function (b, i) {
          var on = v != null && same(values[i], v);
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          b.tabIndex = on || (v == null && i === 0) ? 0 : -1;
          if (on && focus) b.focus();
        });
        moveThumb();
        if (hasDesc) {
          var text = v != null && o.descriptions[v] ? o.descriptions[v] : '';
          if (desc.textContent !== text) {
            desc.classList.remove('is-in');
            desc.textContent = text;
            void desc.offsetWidth; // restart the fade
            desc.classList.add('is-in');
          }
        }
      }
      function moveThumb(instant) {
        var i = -1;
        for (var k = 0; k < values.length; k++) if (active != null && same(values[k], active)) i = k;
        if (i < 0) { thumb.style.opacity = '0'; return; }
        var b = buttons[i];
        if (instant) thumb.classList.add('is-instant');
        thumb.style.opacity = '1';
        thumb.style.width = b.offsetWidth + 'px';
        thumb.style.height = b.offsetHeight + 'px';
        thumb.style.transform = 'translate(' + b.offsetLeft + 'px,' + b.offsetTop + 'px)';
        if (instant) { void thumb.offsetWidth; thumb.classList.remove('is-instant'); }
      }
      function onKey(e, i) {
        var n = values.length, j = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = n - 1;
        if (j == null) return;
        e.preventDefault();
        choose(values[j], true);
      }

      /* ---------------- per-scenario metric ---------------- */
      function paintMetric() {
        if (!o.metric || !ds) return;
        var m = o.metric;
        var rows = RK.data.view(ds, { ignore: [key], where: m.where || null });
        var agg = RK.expr.agg[m.agg || 'sum'] || RK.expr.agg.sum;
        var fmt = m.format || ctx.fmtOf(m.field) || 'auto';
        var groups = RK.util.groupBy(rows, function (r) { return String(r[o.field]).toLowerCase(); });
        var vals = values.map(function (v) {
          var g = groups.get(String(v).toLowerCase());
          return g ? agg(g.map(function (r) { return r[m.field]; })) : null;
        });
        // change vs. the reference case (the default), e.g. "+11.5%"
        var refIdx = 0;
        values.forEach(function (v, i) { if (o.default != null && same(v, o.default)) refIdx = i; });
        var ref = vals[refIdx];
        buttons.forEach(function (b, i) {
          var el = b.querySelector('.rk-ss__metric');
          el.textContent = RK.format(vals[i], fmt);
          if (m.compare !== false && i !== refIdx && RK.util.isNum(vals[i]) && RK.util.isNum(ref) && ref !== 0) {
            var d = vals[i] / ref - 1;
            el.appendChild(h('span.rk-ss__delta', { class: d > 0 ? 'is-pos' : d < 0 ? 'is-neg' : null }, RK.format(d, m.compareFormat || '+0.0%;-0.0%;0.0%')));
          }
        });
      }

      // default on mount (only when nothing is set yet, so a re-render keeps the user's choice)
      var cur = current();
      if (cur == null && values.length) {
        cur = o.default != null ? o.default : values[0];
        apply(cur);
      }
      paintMetric();
      thumb.classList.add('is-instant');
      paint(cur);
      thumb.classList.remove('is-instant');
      // label widths change once web fonts arrive
      var alive = true;
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (alive) moveThumb(true); });
      var ro = 'ResizeObserver' in window ? new ResizeObserver(RK.util.rafThrottle(function () { moveThumb(true); })) : null;
      if (ro) ro.observe(track);

      return {
        update: function (c) { ctx = c; paintMetric(); paint(current()); },
        onStore: function (changes) {
          var v = current();
          if (v == null && values.length) {
            // cleared from elsewhere (e.g. a global reset): fall back to the default case
            var hit = changes.some(function (ch) { return ch.key === key; });
            if (hit) { v = o.default != null ? o.default : values[0]; apply(v); }
          }
          if (o.metric && changes.some(function (ch) { return ch.type !== 'state' && ch.key !== key; })) paintMetric();
          if (!same(v, active)) paint(v);
        },
        resize: function () { moveThumb(true); },
        destroy: function () { alive = false; if (ro) ro.disconnect(); root.remove(); }
      };
    }
  });
})();
