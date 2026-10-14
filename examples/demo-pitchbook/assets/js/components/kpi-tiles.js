/*!
 * RK component: kpi-tiles — headline metrics with count-up, delta pill and sparkline.
 * One row of the dataset = one tile. Pure DOM + inline SVG (no chart engine).
 */
(function () {
  'use strict';
  var h = RK.util.h;

  function sparkline(values, color, fill) {
    var vals = (values || []).filter(function (v) { return v != null && isFinite(v); });
    if (vals.length < 2) return null;
    var w = 120, ht = 34, pad = 2;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1;
    var pts = vals.map(function (v, i) {
      return [pad + i * (w - pad * 2) / (vals.length - 1), ht - pad - (v - lo) / span * (ht - pad * 2)];
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + ht + ' L' + pts[0][0].toFixed(1) + ' ' + ht + ' Z';
    var last = pts[pts.length - 1];
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + ht);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML =
      '<path d="' + area + '" fill="' + fill + '" stroke="none"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>';
    // end dot is HTML so preserveAspectRatio="none" does not squash it
    var dot = h('i.rk-kpi__dot', { style: { left: (last[0] / w * 100) + '%', top: (last[1] / ht * 100) + '%', background: color } });
    return h('div.rk-kpi__spark', svg, dot);
  }

  RK.component({
    id: 'kpi-tiles',
    deps: [],
    defaults: {
      encode: { label: 'label', value: 'value', format: 'format', delta: 'delta', deltaFormat: 'delta_format', period: 'period', spark: 'spark', good: 'good' },
      columns: null,        // null = auto-fit
      countUp: true,
      sparkline: true,
      variant: 'plain'      // plain | boxed | accent
    },
    render: function (ctx) {
      var o = ctx.options, enc = ctx.enc, t = ctx.theme;
      ctx.el.classList.add('is-auto');
      var grid = h('div.rk-kpi', { class: 'rk-kpi--' + o.variant, style: o.columns ? { '--rk-kpi-cols': o.columns } : null });

      function build(rows) {
        grid.innerHTML = '';
        rows.forEach(function (r, i) {
          var fmt = (enc.format && r[enc.format]) || ctx.fmtOf(enc.value) || 'auto';
          var valueEl = h('div.rk-kpi__value.rk-num');
          var delta = enc.delta ? r[enc.delta] : null;
          var good = (enc.good && r[enc.good]) || 'up';
          var dfmt = (enc.deltaFormat && r[enc.deltaFormat]) || '+0.0%;-0.0%;0.0%';
          var deltaEl = null;
          if (delta != null && isFinite(delta)) {
            var positive = delta > 0, favourable = good === 'down' ? delta < 0 : delta > 0;
            deltaEl = h('span.rk-kpi__delta', { class: delta === 0 ? 'is-flat' : (favourable ? 'is-good' : 'is-bad') },
              h('span.rk-kpi__arrow', { 'aria-hidden': 'true' }, delta === 0 ? '■' : (positive ? '▲' : '▼')),
              RK.format(delta, dfmt));
          }
          var spark = o.sparkline && enc.spark && Array.isArray(r[enc.spark]) ? sparkline(r[enc.spark], t.accent3 || t.cat[1], RK.theme.alpha(t.accent3 || t.cat[1], 0.12)) : null;
          var tile = h('div.rk-kpi__tile', { style: { '--rk-i': i } },
            h('div.rk-kpi__label', r[enc.label]),
            valueEl,
            h('div.rk-kpi__meta', deltaEl, enc.period && r[enc.period] ? h('span.rk-kpi__period', r[enc.period]) : null),
            spark);
          grid.appendChild(tile);
          RK.motion.countUp(valueEl, r[enc.value], { format: fmt, animate: o.countUp && ctx.motion });
        });
      }
      build(ctx.rows);
      ctx.el.appendChild(grid);
      return {
        update: function (c) { ctx = c; build(c.rows); },
        destroy: function () { grid.remove(); }
      };
    }
  });
})();
