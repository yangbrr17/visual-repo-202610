/*!
 * RK component: multiple-history — trading multiple over time (NTM EV/EBITDA, P/E ...) with the
 * period mean, ±1σ / ±2σ shaded bands and an optional comparison series (peer median).
 * Right-edge labels (current value pills, mean, σ levels) are laid out without collisions.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;

  RK.component({
    id: 'multiple-history',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'date', y: 'target', compare: 'peer_median' },
      sigma: 1,              // 0 | 1 | 2 — standard-deviation bands drawn around the mean
      meanLine: true,        // dashed mean line (ink-3, house style for averages)
      lookback: null,        // years used for mean / σ (null = full history), e.g. 2
      compareMean: false,    // also draw the comparison series' mean
      endLabels: true,       // current value pills + mean / σ labels at the right edge
      premium: true,         // premium / (discount) vs. the comparison series in the tooltip
      format: null,          // value format (defaults to the y field format, else 0.0x)
      dateFormat: 'mmm yy',  // time-axis label format
      legend: true,
      zoom: true
    },
    render: C(function (ctx) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var xf = enc.x, yf = enc.y;
      var cf = enc.compare && ctx.dataset && ctx.dataset.has(enc.compare) ? enc.compare : null;
      var rows = ctx.rows.filter(function (r) { return r[xf] != null && r[xf] !== ''; }).slice()
        .sort(function (a, b) { return String(a[xf]) < String(b[xf]) ? -1 : String(a[xf]) > String(b[xf]) ? 1 : 0; });
      var fmt = o.format || ctx.fmtOf(yf) || '0.0x';
      var ys = rows.map(function (r) { return [r[xf], U.isNum(r[yf]) ? r[yf] : null]; });
      var cs = cf ? rows.map(function (r) { return [r[xf], U.isNum(r[cf]) ? r[cf] : null]; }) : null;
      var first = rows.length ? rows[0][xf] : null, last = rows.length ? rows[rows.length - 1][xf] : null;

      // statistics over the look-back window
      var from = o.lookback ? shiftYears(last, -o.lookback) : first;
      if (from < first) from = first;
      var inWin = rows.filter(function (r) { return String(r[xf]) >= String(from); });
      var st = stats(inWin.map(function (r) { return r[yf]; }));
      var cst = cf ? stats(inWin.map(function (r) { return r[cf]; })) : null;
      var k = Math.max(0, Math.min(2, o.sigma | 0));
      var avgName = o.lookback ? o.lookback + 'Y avg' : 'Avg';

      // value axis: data + bands, padded to a nice step
      var vals = ys.map(function (p) { return p[1]; }).concat(cs ? cs.map(function (p) { return p[1]; }) : []);
      if (st && k) vals.push(st.mean - k * st.sd, st.mean + k * st.sd);
      var ext = U.extent(vals);
      var step = U.niceStep((ext[1] - ext[0]) || 1, 5);
      var yMin = Math.floor((ext[0] - step * 0.25) / step) * step, yMax = Math.ceil((ext[1] + step * 0.25) / step) * step;
      if (ext[0] >= 0 && yMin < 0) yMin = 0;

      var lastY = lastValue(ys), lastC = cs ? lastValue(cs) : null;
      var yColor = t.accent, cColor = t.dark ? t.ink3 : RK.theme.mix(t.ink3, t.paper, 0.15);
      var meanColor = t.ink3;                 // averages: ink-3 dashed (accent2 is reserved for a highlighted target)

      /* ---------------- bands + reference lines on the main series ---------------- */
      var areas = [], marks = [];
      if (st) {
        for (var s = k; s >= 1; s--) {
          areas.push([
            { xAxis: from, yAxis: st.mean - s * st.sd, itemStyle: { color: RK.theme.alpha(t.accent3 || t.accent, s === 1 ? (t.dark ? 0.16 : 0.1) : (t.dark ? 0.08 : 0.05)) } },
            { xAxis: last, yAxis: st.mean + s * st.sd }
          ]);
          [1, -1].forEach(function (sign) {
            marks.push([
              { coord: [from, st.mean + sign * s * st.sd], lineStyle: { color: RK.theme.alpha(t.accent3 || t.accent, 0.55), type: [2, 3], width: 1 } },
              { coord: [last, st.mean + sign * s * st.sd] }
            ]);
          });
        }
        if (o.meanLine !== false) {
          marks.push([{ coord: [from, st.mean], lineStyle: { color: meanColor, type: [5, 3], width: 1.25 } }, { coord: [last, st.mean] }]);
        }
      }
      if (cst && o.compareMean) {
        marks.push([{ coord: [from, cst.mean], lineStyle: { color: cColor, type: [5, 3], width: 1.2 } }, { coord: [last, cst.mean] }]);
      }

      /* ---------------- right-edge labels (custom series, de-overlapped in pixel space) ---------------- */
      var labels = [];
      if (o.endLabels !== false) {
        if (lastY != null) labels.push({ v: lastY, text: RK.format(lastY, fmt), kind: 'pill', bg: yColor });
        if (lastC != null) labels.push({ v: lastC, text: RK.format(lastC, fmt), kind: 'pill', bg: cColor });
        if (st && o.meanLine !== false) labels.push({ v: st.mean, text: avgName + ' ' + RK.format(st.mean, fmt), kind: 'mean' });
        if (cst && o.compareMean) labels.push({ v: cst.mean, text: avgName + ' ' + RK.format(cst.mean, fmt), kind: 'cmean' });
        if (st) {
          for (var j = 1; j <= k; j++) {
            labels.push({ v: st.mean + j * st.sd, text: '+' + j + 'σ ' + RK.format(st.mean + j * st.sd, fmt), kind: 'sd' });
            labels.push({ v: st.mean - j * st.sd, text: '−' + j + 'σ ' + RK.format(st.mean - j * st.sd, fmt), kind: 'sd' });
          }
        }
      }
      var font = '600 10.5px ' + t.fontNum;
      var labelW = labels.reduce(function (m, l) { return Math.max(m, Math.ceil(C.measure(l.text, font)) + (l.kind === 'pill' ? 12 : 0)); }, 0);
      var layout = null;

      var series = [{
        id: 'y', name: ctx.title(yf), type: 'line', data: ys, z: 4,
        showSymbol: false, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 1.8, color: yColor }, itemStyle: { color: yColor },
        emphasis: { focus: 'none', lineStyle: { width: 1.8 } },
        markArea: areas.length ? { silent: true, data: areas } : undefined,
        markLine: marks.length ? { silent: true, symbol: ['none', 'none'], label: { show: false }, data: marks, animation: false } : undefined
      }];
      if (cs) {
        series.push({
          id: 'c', name: ctx.title(cf), type: 'line', data: cs, z: 3,
          showSymbol: false, symbol: 'circle', symbolSize: 4,
          lineStyle: { width: 1.4, color: cColor }, itemStyle: { color: cColor },
          emphasis: { focus: 'none', lineStyle: { width: 1.4 } }
        });
      }
      if (labels.length) {
        series.push({
          id: 'labels', type: 'custom', silent: true, clip: false, z: 6, tooltip: { show: false },
          data: labels.map(function (l) { return [last, l.v]; }),
          renderItem: function (params, api) {
            var cs2 = params.coordSys;
            if (params.dataIndex === 0 || !layout) {
              // one pass for all labels: y from the value, then push apart (min gap 16px) inside the plot
              layout = C.spreadLabels(labels.map(function (l) { return api.coord([last, l.v])[1]; }), 16, cs2.y + 6, cs2.y + cs2.height - 6);
            }
            var l = labels[params.dataIndex], y0 = api.coord([last, l.v])[1], y = layout[params.dataIndex];
            var x = cs2.x + cs2.width + 10;
            var kids = [];
            if (Math.abs(y - y0) > 1.5 || l.kind !== 'pill') {
              kids.push({ type: 'polyline', shape: { points: [[cs2.x + cs2.width + 1, y0], [x - 4, y0 + (y - y0) * 0.7], [x - 2, y]] },
                style: { stroke: l.kind === 'pill' ? l.bg : t.rule, lineWidth: 1, fill: null } });
            }
            var st2 = l.kind === 'pill'
              ? { text: l.text, fill: RK.theme.textOn(l.bg), backgroundColor: l.bg, padding: [2, 5], borderRadius: 2, font: font }
              : { text: l.text, fill: l.kind === 'mean' ? t.ink2 : (l.kind === 'cmean' ? cColor : t.ink3),
                font: l.kind === 'sd' ? '10px ' + t.fontNum : font };
            st2.align = 'left'; st2.verticalAlign = 'middle';
            kids.push({ type: 'text', x: x, y: y, style: st2, enterFrom: { style: { opacity: 0 } } });
            return { type: 'group', children: kids };
          }
        });
      }

      var dfmt = o.dateFormat || 'mmm yy';
      var slider = o.zoom !== false && o.zoomSlider !== false && !ctx.print;
      return {
        legend: C.legend(ctx, { show: o.legend !== false && !!cs,
          data: series.filter(function (x) { return x.type === 'line'; }).map(function (x) { return x.name; }) }),
        grid: C.grid(ctx, { top: o.legend !== false && cs ? 32 : 14, right: labelW ? labelW + 16 : 12, bottom: slider ? 32 : 4 }),
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line' },
          formatter: function (ps) {
            ps = (ps || []).filter(function (p) { return p.seriesId === 'y' || p.seriesId === 'c'; });
            if (!ps.length) return '';
            var i = ps[0].dataIndex, r = rows[i];
            if (!r) return '';
            var v = r[yf], c = cf ? r[cf] : null;
            var tr = [{ color: yColor, label: ctx.title(yf), value: RK.format(v, fmt), bold: false }];
            if (cf) tr.push({ color: cColor, label: ctx.title(cf), value: RK.format(c, fmt) });
            if (cf && o.premium !== false) {
              tr.push({ label: 'Premium / (discount)', value: U.isNum(v) && U.isNum(c) && c ? RK.format(v / c - 1, '+0.0%;(0.0%);0.0%') : RK.format(null) });
            }
            if (st && U.isNum(v)) {
              tr.push({ label: 'vs. ' + (o.lookback ? avgName : 'average'), value: RK.format(v - st.mean, signed(fmt)) + (st.sd ? '  (' + RK.format((v - st.mean) / st.sd, '+0.0;−0.0;0.0') + 'σ)' : '') });
            }
            return C.tip(RK.format(r[xf], 'dd mmm yyyy'), tr);
          }
        },
        xAxis: {
          type: 'time', min: first, max: last,
          axisLabel: { formatter: function (v) { return RK.format(new Date(v), dfmt); }, hideOverlap: true },
          splitLine: { show: false }
        },
        yAxis: { type: 'value', min: yMin, max: yMax, interval: step, axisLabel: { formatter: C.tickFmt(fmt, step) } },
        dataZoom: o.zoom !== false ? C.zoom(ctx, 'x') : [],
        series: series
      };
    }, { rebuildOnResize: true })   // right-edge label layout is in pixels
  });

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function stats(list) {
    var v = list.filter(U.isNum);
    if (!v.length) return null;
    var mean = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    var sd = v.length > 1 ? Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (v.length - 1)) : 0;
    return { mean: mean, sd: sd, n: v.length };
  }

  function lastValue(pairs) {
    for (var i = pairs.length - 1; i >= 0; i--) if (U.isNum(pairs[i][1])) return pairs[i][1];
    return null;
  }

  /** ISO date shifted by n years ("2026-10-13", -2 -> "2024-10-13"). */
  function shiftYears(iso, n) {
    var d = RK.format.toDate(iso);
    if (!d) return iso;
    d.setFullYear(d.getFullYear() + n);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /** "+0.0x;-0.0x" style signed variant of a single-section format code. */
  function signed(code) {
    code = RK.format.presets[code] || code;
    if (String(code).indexOf(';') >= 0) return code;
    return '+' + code + ';−' + code + ';' + code;
  }
})();
