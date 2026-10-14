/*!
 * RK component: bar — column / bar chart (grouped, stacked, 100% stacked, horizontal).
 * Wide data (encode.y = [fields]) or long data (encode.y = field + encode.series = field).
 */
(function () {
  'use strict';
  var C = RK.chart;

  RK.component({
    id: 'bar',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'category', y: 'value' },
      orientation: 'vertical',     // vertical | horizontal
      stack: false,                // false | true | 'percent'
      labels: 'auto',              // true | false | 'auto' (on when few bars)
      sort: null,                  // null | 'asc' | 'desc' (by total)
      highlight: null,             // x value(s) to emphasise, e.g. the target company
      refLines: [],                // [{value, label}]
      avgLine: false,              // dashed average line (single-series only)
      colorBy: 'series',           // series | category
      palette: 'auto',             // auto (ordinal ramp for stacks, categorical otherwise) | cat | ord
      showTotal: true,             // total label on top of stacks
      format: null,
      legend: true,
      zoom: false
    },
    render: C(function (ctx) {
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

      var highlights = o.highlight == null ? [] : [].concat(o.highlight);
      var single = data.series.length === 1;
      var showLabels = o.labels === 'auto' ? (cats.length * data.series.length <= 24 && (!o.stack || data.series.length <= 4)) : !!o.labels;

      var useOrd = o.palette === 'ord' || (o.palette === 'auto' && o.stack && data.series.length <= t.ord.length);
      var series = data.series.map(function (se, si) {
        var base = useOrd ? t.ord[si] : RK.theme.color(si);
        return {
          id: 's-' + si,
          name: se.name,
          type: 'bar',
          stack: o.stack ? 'total' : null,
          barGap: '18%',
          barCategoryGap: single ? '38%' : '28%',
          emphasis: { focus: 'series' },
          label: showLabels ? C.label(ctx, fmt, {
            position: o.stack ? 'inside' : (horiz ? 'right' : 'top'),
            color: o.stack ? RK.theme.onColor(base, t.ink, '#fff') : t.ink2,
            fontSize: 10.5,
            formatter: function (p) {
              if (o.stack && (p.value == null || Math.abs(p.value) < (o.stack === 'percent' ? 0.06 : 0))) return '';
              return RK.format(p.value, fmt);
            }
          }) : { show: false },
          data: se.values.map(function (v, i) {
            var c = o.colorBy === 'category' ? RK.theme.color(i) : base;
            if (highlights.length && single) c = highlights.indexOf(cats[i]) >= 0 ? t.accent2 : c;
            c = C.dim(ctx, enc.x, cats[i], c);
            return { value: v, itemStyle: { color: c } };
          }),
          markLine: si === 0 ? markLines(ctx, o, se, horiz) : undefined
        };
      });

      // total labels on stacks
      if (o.stack === true && o.showTotal && showLabels && data.series.length > 1) {
        series.push({
          id: 's-total', name: 'Total', type: 'bar', stack: 'total', silent: true,
          itemStyle: { color: 'transparent' }, tooltip: { show: false },
          label: { show: true, position: horiz ? 'insideLeft' : 'insideBottom', color: t.ink, fontWeight: 600, fontSize: 11, fontFamily: t.fontNum,
            formatter: function (p) { return RK.format(totals[p.dataIndex], fmt); } },
          data: cats.map(function () { return 0; })
        });
      }

      var catAxis = { type: 'category', data: cats, axisLabel: { interval: 0, hideOverlap: true, width: horiz ? 140 : 90, overflow: 'truncate' }, inverse: horiz };
      var valAxis = { type: 'value', axisLabel: { formatter: C.axisFmt(fmt) }, max: o.stack === 'percent' ? 1 : null };

      return {
        legend: C.legend(ctx, { show: o.legend !== false && data.series.length > 1, data: data.series.map(function (s) { return s.name; }) }),
        grid: C.grid(ctx, { top: o.legend !== false && data.series.length > 1 ? 32 : 14, bottom: o.zoom ? 30 : 4 }),
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
      select: function (p, ctx) { return p.seriesId === 's-total' ? null : { field: ctx.enc.x, value: p.name }; }
    })
  });

  function markLines(ctx, o, se, horiz) {
    var lines = (o.refLines || []).map(function (r) {
      var d = { name: r.label || '', label: { formatter: r.label || '{c}' }, lineStyle: { color: r.color || ctx.theme.accent2 } };
      d[horiz ? 'xAxis' : 'yAxis'] = r.value;
      return d;
    });
    if (o.avgLine) {
      var vals = se.values.filter(function (v) { return v != null; });
      var avg = vals.reduce(function (s, v) { return s + v; }, 0) / (vals.length || 1);
      var d = { name: 'Average', label: { formatter: 'Avg ' + RK.format(avg, o.format || ctx.fmtOf(Array.isArray(ctx.enc.y) ? ctx.enc.y[0] : ctx.enc.y) || 'auto') } };
      d[horiz ? 'xAxis' : 'yAxis'] = avg;
      lines.push(d);
    }
    if (!lines.length) return undefined;
    return { silent: true, symbol: ['none', 'none'], label: { position: horiz ? 'start' : 'insideEndTop', fontSize: 10.5 }, data: lines };
  }
})();
