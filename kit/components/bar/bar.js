/*!
 * RK component: bar — column / bar chart (grouped, stacked, 100% stacked, horizontal).
 * Wide data (encode.y = [fields]) or long data (encode.y = field + encode.series = field).
 * Value labels are fitted in pixels: inside-stack labels that would not fit their segment are dropped
 * (never clipped), column labels that would collide with their neighbours turn vertical, and the
 * value axis gets headroom so the labels on the longest bars stay inside the plot.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;
  var BAR_GAP = 0.18, MAX_BAR = 96;

  RK.component({
    id: 'bar',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'category', y: 'value' },
      orientation: 'vertical',     // vertical | horizontal
      stack: false,                // false | true | 'percent'
      labels: 'auto',              // true | false | 'auto' (on when few bars and they fit)
      sort: null,                  // null | 'asc' | 'desc' (by total)
      highlight: null,             // x value(s) to emphasise, e.g. the target company
      refLines: [],                // [{value, label, color}] reference lines (default colour: theme ref)
      avgLine: false,              // dashed average line (single-series only)
      colorBy: 'series',           // series | category
      palette: 'auto',             // auto (ordinal ramp for stacks, categorical otherwise) | cat | ord
      showTotal: true,             // total label on top of stacks
      format: null,
      legend: true,
      zoom: false
    },
    render: C(function (ctx, inst) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var horiz = o.orientation === 'horizontal';
      var data = C.toSeries(ctx);
      var fmt = o.format || data.yFormat || 'auto';
      var cats = data.categories.slice();
      var totals = cats.map(function (_, i) {
        return data.series.reduce(function (s, se) { return s + (se.values[i] || 0); }, 0);
      });

      if (o.sort) {
        var idx = cats.map(function (_, i) { return i; });
        idx.sort(function (a, b) { return o.sort === 'asc' ? totals[a] - totals[b] : totals[b] - totals[a]; });
        cats = idx.map(function (i) { return data.categories[i]; });
        totals = idx.map(function (i) { return totals[i]; });
        data.series.forEach(function (se) { se.values = idx.map(function (i) { return se.values[i]; }); });
      }
      if (o.stack === 'percent') {
        data.series.forEach(function (se) {
          se.raw = se.values.slice();
          se.values = se.values.map(function (v, i) { return totals[i] ? (v || 0) / totals[i] : null; });
        });
        fmt = '0%';
      }
      // value labels: house style drops the decimals of figures >= 100 ("$1,463", not "$1,462.8") unless a
      // format is forced; tooltips keep the field format
      var lfmt = labelFormatter(o.format || o.stack === 'percent' ? null : fmt, fmt);

      var highlights = o.highlight == null ? [] : [].concat(o.highlight);
      var single = data.series.length === 1;
      var k = o.stack ? 1 : data.series.length;                 // bars side by side per category
      var nC = Math.max(1, cats.length);
      var catGap = single ? 0.38 : 0.28;
      var showLabels = o.labels === 'auto' ? (cats.length * data.series.length <= 24 && (!o.stack || data.series.length <= 4)) : !!o.labels;

      /* ---------------- pixel geometry (label fitting, headroom, legend rows) ---------------- */
      var W = inst.getWidth(), H = inst.getHeight();
      var names = data.series.map(function (s) { return s.name; });
      var hasLegend = o.legend !== false && data.series.length > 1;
      var legendRows = hasLegend ? rowsOf(names, W, t) : 0;
      var top = hasLegend ? 32 + (legendRows - 1) * 22 : 14;
      var bottom = o.zoom && !ctx.print ? 30 : 4;
      var numFont = '11px ' + t.fontNum, labFont = '10.5px ' + t.fontNum;
      var catW = horiz ? Math.min(Math.max(140, Math.round(W * 0.3)),
        Math.ceil(Math.max.apply(null, cats.map(function (c) { return C.measure(String(c), '11px ' + t.fontSans); }).concat([20]))) + 8) : 90;
      var s0 = valueScale(o, data, cats, 0), t0 = C.tickFmt(fmt, s0.step);
      var valLabW = Math.max(C.measure(t0(s0.max), numFont), C.measure(t0(s0.min), numFont));
      var right = horiz ? Math.max(12, Math.ceil(valLabW / 2) + 4) : 12;
      var plotW = Math.max(60, W - 4 - right - (horiz ? catW : valLabW) - 8);
      var plotH = Math.max(60, H - top - bottom - 20);
      var plotLen = horiz ? plotW : plotH;                      // along the value axis
      var band = (horiz ? plotH : plotW) / nC;                   // along the category axis
      var barPx = Math.min(MAX_BAR, band * (1 - catGap) / (k + (k - 1) * BAR_GAP));

      var texts = data.series.map(function (se) { return se.values.map(function (v) { return U.isNum(v) ? lfmt(v) : ''; }); });
      var maxLW = Math.max.apply(null, [].concat.apply([], texts).map(function (s) { return s ? C.measure(s, labFont) : 0; }).concat([0]));
      var rotate = false;
      if (showLabels && !o.stack) {
        // labels of neighbouring bars must not touch: one slot per bar (grouped) or per category
        var pitch = k > 1 ? barPx * (1 + BAR_GAP) : band;
        if (horiz) {
          if (pitch < 11 && o.labels === 'auto') showLabels = false;
        } else if (maxLW + 4 > pitch) {
          if (barPx >= 11) rotate = true;
          else if (o.labels === 'auto') showLabels = false;
          else rotate = true;
        }
      }
      // room beyond the longest bar for its label (column top / bar end): the free space above the plot is
      // used first (a few px of padding), the value axis is only extended when that is not enough
      var need = 0;
      if (showLabels && !o.stack) need = horiz ? maxLW + 8 : (rotate ? maxLW + 8 : 18);
      else if (showLabels && o.stack === true && o.showTotal && data.series.length > 1) need = 18;
      var scale = s0;
      if (need) {
        var hiVal = valueScale(o, data, cats, 0, true);
        var freeTop = horiz ? 0 : top - (hasLegend ? 16 + (legendRows - 1) * 22 : 0);
        var gap = (s0.max - hiVal) / ((s0.max - s0.min) || 1) * plotLen + freeTop;
        if (gap < need && !horiz && need - gap <= 12) { top += Math.ceil(need - gap); plotLen -= Math.ceil(need - gap); }
        else if (gap < need) scale = valueScale(o, data, cats, Math.min(0.45, Math.max(0, need - freeTop) / plotLen));
      }
      var span = (scale.max - scale.min) || 1;

      // stacks are parts of a whole -> ordinal ramp; otherwise categorical colours kept clear of the accent2 highlight
      var useOrd = o.palette === 'ord' || (o.palette === 'auto' && o.stack && data.series.length <= t.ord.length);
      var pal = RK.theme.palette({ n: Math.max(data.series.length, o.colorBy === 'category' ? cats.length : 0) });
      var series = data.series.map(function (se, si) {
        var base = useOrd ? t.ord[si % t.ord.length] : pal[si];
        var label = { show: false };
        if (showLabels && o.stack) {
          label = C.label(ctx, fmt, {
            position: 'inside', color: RK.theme.textOn(base), fontSize: 10.5,
            formatter: function (p) {
              var v = p.value;
              if (!U.isNum(v) || (o.stack === 'percent' && Math.abs(v) < 0.06)) return '';
              var txt = lfmt(v), seg = Math.abs(v) / span * plotLen, w = C.measure(txt, labFont);
              // a label that does not fit its segment is dropped, never clipped ("$1,462." misleads)
              if (horiz ? (w + 6 > seg || barPx < 12) : (w + 4 > barPx || seg < 13)) return '';
              return txt;
            }
          });
        } else if (showLabels) {
          label = C.label(ctx, fmt, {
            position: horiz ? 'right' : 'top', distance: rotate ? 4 : 5, color: t.ink2, fontSize: 10.5,
            rotate: rotate ? 90 : 0, align: rotate ? 'left' : undefined, verticalAlign: rotate ? 'middle' : undefined,
            // paper chip: legible where an average / reference line crosses the label
            backgroundColor: t.paper, padding: [1, 2], borderRadius: 2,
            formatter: function (p) { return U.isNum(p.value) ? lfmt(p.value) : ''; }
          });
        }
        return {
          id: 's-' + si,
          name: se.name,
          type: 'bar',
          stack: o.stack ? 'total' : null,
          barGap: Math.round(BAR_GAP * 100) + '%',
          barCategoryGap: Math.round(catGap * 100) + '%',
          barMaxWidth: MAX_BAR,
          emphasis: { focus: 'series' },
          itemStyle: { color: base },          // series colour also drives the legend icon
          label: label,
          labelLayout: showLabels && !o.stack ? { hideOverlap: true } : undefined,
          data: se.values.map(function (v, i) {
            var c = o.colorBy === 'category' ? pal[i] : base;
            var hl = highlights.length && single && highlights.indexOf(cats[i]) >= 0;
            if (highlights.length && single) c = hl ? t.accent2 : c;
            c = C.dim(ctx, enc.x, cats[i], c);
            var d = { value: v, itemStyle: { color: c } };
            if (hl && showLabels && !o.stack) d.label = { color: t.accent2Ink, fontWeight: 600 };   // target text: text-safe accent
            return d;
          }),
          markLine: si === 0 ? markLines(ctx, o, se, horiz) : undefined
        };
      });

      // total labels on stacks
      if (o.stack === true && o.showTotal && showLabels && data.series.length > 1) {
        series.push({
          id: 's-total', name: 'Total', type: 'bar', stack: 'total', silent: true, barMaxWidth: MAX_BAR,
          itemStyle: { color: 'transparent' }, tooltip: { show: false },
          label: { show: true, position: horiz ? 'insideLeft' : 'insideBottom', color: t.ink, fontWeight: 600, fontSize: 11, fontFamily: t.fontNum,
            formatter: function (p) { return lfmt(totals[p.dataIndex]); } },
          data: cats.map(function () { return 0; })
        });
      }

      var catAxis = { type: 'category', data: cats, axisLabel: { interval: 0, hideOverlap: true, width: catW, overflow: 'truncate' }, inverse: horiz };
      var tick = C.tickFmt(fmt, scale.step);
      var valAxis = { type: 'value', min: scale.min, max: scale.max, interval: scale.step, axisLabel: { formatter: tick } };
      // horizontal: the last tick label is centred on the plot's right edge, keep room for its right half
      if (horiz) right = Math.max(12, Math.ceil(C.measure(tick(scale.max), numFont) / 2) + 4);

      return {
        // plain legend: wraps onto a second row instead of paging ("1/2") on narrow blocks
        legend: C.legend(ctx, { show: hasLegend, type: 'plain', right: 0, data: names }),
        grid: C.grid(ctx, { top: top, right: right, bottom: bottom }),
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: function (ps) {
            ps = ps.filter(function (p) { return p.seriesId !== 's-total'; });
            if (!ps.length) return '';
            var i = ps[0].dataIndex;
            var rows = ps.map(function (p) {
              var raw = data.series[p.seriesIndex] && data.series[p.seriesIndex].raw;
              var v = raw ? RK.format(raw[i], data.yFormat) + '  (' + RK.format(p.value, '0.0%') + ')' : RK.format(p.value, fmt);
              return { color: p.color, label: p.seriesName, value: v };
            });
            if (ps.length > 1 && o.stack === true) rows.push({ label: 'Total', value: RK.format(totals[i], fmt), bold: true });
            return C.tip(cats[i], rows);
          }
        },
        xAxis: horiz ? valAxis : catAxis,
        yAxis: horiz ? catAxis : valAxis,
        dataZoom: o.zoom ? C.zoom(ctx, horiz ? 'y' : 'x') : [],
        series: series
      };
    }, {
      rebuildOnResize: true,     // label fitting, headroom and legend rows are computed in pixels
      // generic x fields (type, kind ...) are scoped to this dataset by core ctx.select
      select: function (p, ctx) { return p.seriesId === 's-total' ? null : { field: ctx.enc.x, value: p.name }; }
    })
  });

  /** Label text: `auto` (the field format) drops its decimals for |v| >= 100; null = always `code`. */
  function labelFormatter(auto, code) {
    var src = auto ? String(RK.format.presets[auto] || auto) : null;
    var trimmed = src ? src.replace(/([0#])\.[0#]+/g, '$1') : null;
    return function (v) { return RK.format(v, trimmed && trimmed !== src && Math.abs(v) >= 100 ? trimmed : code); };
  }

  /** Legend rows needed for the names at width w (10px swatch + 5px gap + text + 14px item gap). */
  function rowsOf(names, w, t) {
    var rows = 1, x = 0;
    names.forEach(function (n) {
      var iw = 15 + C.measure(String(n), '11px ' + t.fontSans);
      if (x > 0 && x + iw > w) { rows++; x = 0; }
      x += iw + 14;
    });
    return rows;
  }

  /**
   * Nice value-axis scale over the bars (stack sums when stacked), reference lines and zero.
   * head: share of the axis length kept free beyond the largest bar (room for its label).
   */
  function valueScale(o, data, cats, head, maxOnly) {
    var vals = [0];
    if (o.stack) {
      cats.forEach(function (_, i) {
        var p = 0, q = 0;
        data.series.forEach(function (se) { var v = se.values[i]; if (U.isNum(v)) { if (v > 0) p += v; else q += v; } });
        vals.push(p, q);
      });
    } else data.series.forEach(function (se) { se.values.forEach(function (v) { if (U.isNum(v)) vals.push(v); }); });
    var ext = U.extent(vals);
    if (maxOnly) return ext[1];
    if (head > 0 && ext[1] > 0) ext[1] = ext[1] / (1 - head);
    (o.refLines || []).forEach(function (r) { if (U.isNum(r.value)) { ext[0] = Math.min(ext[0], r.value); ext[1] = Math.max(ext[1], r.value); } });
    var step = U.niceStep(ext[1] - ext[0] || Math.abs(ext[1]) || 1, 5);
    var min = Math.floor(ext[0] / step + 1e-9) * step, max = Math.ceil(ext[1] / step - 1e-9) * step;
    if (o.stack === 'percent') max = Math.min(max, 1);
    return { min: min, max: max > min ? max : min + step, step: step };
  }

  function markLines(ctx, o, se, horiz) {
    var t = ctx.theme;
    var vfmt = o.format || ctx.fmtOf(Array.isArray(ctx.enc.y) ? ctx.enc.y[0] : ctx.enc.y) || 'auto';
    var lines = (o.refLines || []).map(function (r) {
      var col = RK.theme.resolve(r.color) || t.ref;          // token names ('pos', 'accent2') or literal colours
      // label text from a function: "{a}", "{b}", "{c}" in a label are never template-substituted
      var text = r.label != null && r.label !== '' ? String(r.label) : RK.format(r.value, vfmt);
      var d = { name: text, label: { formatter: function () { return text; }, color: col }, lineStyle: { color: col, type: 'dashed', width: 1.25 } };
      d[horiz ? 'xAxis' : 'yAxis'] = r.value;
      return d;
    });
    if (o.avgLine) {
      var vals = se.values.filter(function (v) { return v != null; });
      var avg = vals.reduce(function (s, v) { return s + v; }, 0) / (vals.length || 1);
      var avgText = 'Avg ' + RK.format(avg, vfmt);
      var d = { name: 'Average', lineStyle: { color: t.ink3, type: 'dashed', width: 1 },
        label: { formatter: function () { return avgText; }, color: t.ink2 } };
      d[horiz ? 'xAxis' : 'yAxis'] = avg;
      lines.push(d);
    }
    if (!lines.length) return undefined;
    return { silent: true, symbol: ['none', 'none'], z: 1, label: { position: horiz ? 'start' : 'insideEndTop', fontSize: 10.5 }, data: lines };
  }
})();
