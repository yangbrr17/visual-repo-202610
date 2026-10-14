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

  /**
   * Caption text as nodes: hyphenated date tokens ("Sep-26", "09-Oct-2026") never break inside, and the
   * CSS balances the lines so no word is left alone ("… 1 year / ago").
   */
  function caption(text) {
    var out = [];
    String(text).split(/(\s+)/).forEach(function (part) {
      if (!part) return;
      if (/\S-\S/.test(part)) out.push(h('span.rk-kpi__nw', part));
      else out.push(part);
    });
    return out;
  }

  /** Balanced column count: as many as fit (>= minW px each), spread so the last row is not left short. */
  function balancedCols(n, width, minW) {
    var fit = Math.max(1, Math.floor((width + 1) / minW));
    if (n <= fit) return n;
    var rows = Math.ceil(n / fit);
    return Math.ceil(n / rows);
  }

  RK.component({
    id: 'kpi-tiles',
    deps: [],
    defaults: {
      encode: { label: 'label', value: 'value', format: 'format', delta: 'delta', deltaFormat: 'delta_format', period: 'period', spark: 'spark', good: 'good' },
      columns: null,        // null = balanced auto (as many as fit, rows evened out: 6 -> 3 x 2 at ~760px)
      countUp: true,
      sparkline: true,
      variant: 'plain'      // plain | boxed | accent
    },
    render: function (ctx) {
      ctx.el.classList.add('is-auto');
      var grid = h('div.rk-kpi'), prev = null, current = ctx;

      /** Columns (explicit or balanced for the current width) + row-start / next-row classes for the rules. */
      function layout() {
        var o = current.options, tiles = grid.children, n = tiles.length;
        var cols = o.columns ? +o.columns : balancedCols(n, ctx.el.clientWidth || grid.clientWidth || 900, o.variant === 'boxed' ? 170 : 160);
        grid.style.setProperty('--rk-kpi-cols', String(Math.max(1, cols)));
        for (var i = 0; i < n; i++) {
          tiles[i].classList.toggle('is-row-start', i % cols === 0);
          tiles[i].classList.toggle('is-next-row', i >= cols);
        }
      }

      function build(c) {
        current = c;
        var o = c.options, enc = c.enc, t = c.theme, next = {};
        grid.className = 'rk-kpi rk-kpi--' + o.variant;
        grid.textContent = '';
        c.rows.forEach(function (r, i) {
          var fmt = (enc.format && r[enc.format]) || c.fmtOf(enc.value) || 'auto';
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
          var line = t.accent3 || t.cat[1];
          var spark = o.sparkline && enc.spark && Array.isArray(r[enc.spark]) ? sparkline(r[enc.spark], line, RK.theme.alpha(line, 0.12)) : null;
          // data cells are only ever text children (never props / HTML)
          var labelText = r[enc.label] == null ? '' : String(r[enc.label]);
          var periodText = enc.period && r[enc.period] != null && r[enc.period] !== '' ? String(r[enc.period]) : null;
          var tile = h('div.rk-kpi__tile', { style: { '--rk-i': String(i) } },
            h('div.rk-kpi__label', { title: labelText }, labelText),
            valueEl,
            h('div.rk-kpi__meta', deltaEl, periodText ? h('span.rk-kpi__period', caption(periodText)) : null),
            spark);
          grid.appendChild(tile);
          // first reveal counts up from 0; filter / param updates glide from the previous figure
          var key = r[enc.label] + '#' + i, value = r[enc.value];
          next[key] = value;
          RK.motion.countUp(valueEl, value, { format: fmt, from: prev && RK.util.isNum(prev[key]) ? prev[key] : 0, duration: prev ? 700 : 1100, animate: o.countUp && c.motion });
        });
        prev = next;
        layout();
      }
      ctx.el.appendChild(grid);
      build(ctx);
      return {
        update: build,
        resize: layout,
        destroy: function () { grid.remove(); ctx.el.classList.remove('is-auto'); }
      };
    }
  });
})();
