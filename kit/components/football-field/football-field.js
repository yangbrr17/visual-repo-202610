/*!
 * RK component: football-field — valuation ranges by methodology (horizontal floating bars)
 * with reference lines (current price, offer price, 52-week high/low).
 */
(function () {
  'use strict';
  var C = RK.chart;

  RK.component({
    id: 'football-field',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'method', low: 'low', high: 'high', group: null, note: null },
      refLines: [],          // [{value, label, color}]
      refBand: null,         // {from, to, label} shaded band, e.g. offer range
      format: null,          // value format (defaults to the low field format)
      showValues: true,      // low / high labels at the bar ends
      groupColors: true,     // colour bars by group
      legend: true
    },
    render: C(function (ctx) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var rows = ctx.rows.slice();
      if (enc.order || ctx.dataset.has('order')) {
        var of = enc.order || 'order';
        rows.sort(function (a, b) { return (a[of] || 0) - (b[of] || 0); });
      }
      var fmt = o.format || ctx.fmtOf(enc.low) || '#,##0.00';
      var labels = rows.map(function (r) { return r[enc.label]; });
      var groups = enc.group ? RK.util.unique(rows.map(function (r) { return r[enc.group]; })) : [];
      var colorOf = function (r, i) {
        if (enc.group && o.groupColors) return RK.theme.color(groups.indexOf(r[enc.group]));
        return i % 2 ? t.cat[1] : t.cat[0];
      };
      var lows = rows.map(function (r) { return r[enc.low]; });
      var highs = rows.map(function (r) { return r[enc.high]; });
      var ext = RK.util.extent(lows.concat(highs, (o.refLines || []).map(function (r) { return r.value; })));
      // tick count adapts to the available width so labels never collide
      var plotW = Math.max(160, (ctx.el.clientWidth || 600) - 220);
      var step = RK.util.niceStep((ext[1] - ext[0]) * 1.2 || 1, Math.max(2, Math.min(7, Math.floor(plotW / 70))));
      var axMin = Math.floor((ext[0] - step * 0.4) / step) * step, axMax = Math.ceil((ext[1] + step * 0.4) / step) * step;

      var mark = (o.refLines || []).map(function (r) {
        return {
          xAxis: r.value,
          lineStyle: { color: r.color || t.accent2, type: r.type || 'dashed', width: 1.5 },
          // y axis is inverted, so 'start' sits above the first bar
          label: { show: true, position: 'start', distance: 4, formatter: r.label || RK.format(r.value, fmt), color: r.color || t.accent2, fontWeight: 600, fontSize: 11 }
        };
      });

      var series = [
        { id: 'base', type: 'bar', stack: 'ff', silent: true, itemStyle: { color: 'transparent' }, tooltip: { show: false },
          data: lows, barWidth: '52%' },
        {
          id: 'range', name: 'Range', type: 'bar', stack: 'ff', barWidth: '52%',
          data: rows.map(function (r, i) {
            var c = C.dim(ctx, enc.label, r[enc.label], colorOf(r, i));
            return { value: (r[enc.high] != null && r[enc.low] != null) ? r[enc.high] - r[enc.low] : null, itemStyle: { color: c } };
          }),
          label: o.showValues ? {
            show: true, position: 'right', distance: 6, color: t.ink2, fontSize: 11, fontFamily: t.fontNum,
            formatter: function (p) { return RK.format(highs[p.dataIndex], fmt); }
          } : { show: false },
          markLine: mark.length ? { silent: true, symbol: ['none', 'none'], data: mark } : undefined,
          markArea: o.refBand ? {
            silent: true,
            itemStyle: { color: RK.theme.alpha(t.accent2, 0.12) },
            label: { show: !!o.refBand.label, position: 'insideTop', color: t.ink3, fontSize: 10.5, formatter: o.refBand.label || '' },
            data: [[{ xAxis: o.refBand.from }, { xAxis: o.refBand.to }]]
          } : undefined
        }
      ];
      // low labels on a ghost series so they sit left of the bar
      if (o.showValues) {
        series.push({
          id: 'lowlab', type: 'scatter', silent: true, symbolSize: 0, tooltip: { show: false },
          data: lows.map(function (v, i) { return [v, i]; }),
          label: { show: true, position: 'left', distance: 6, color: t.ink2, fontSize: 11, fontFamily: t.fontNum, formatter: function (p) { return RK.format(p.value[0], fmt); } }
        });
      }

      return {
        legend: { show: false },
        grid: C.grid(ctx, { top: mark.length ? 34 : 10, left: 4, right: 44 }),
        tooltip: {
          trigger: 'item',
          formatter: function (p) {
            var r = rows[p.dataIndex];
            if (!r) return '';
            var tr = [
              { label: 'Low', value: RK.format(r[enc.low], fmt) },
              { label: 'High', value: RK.format(r[enc.high], fmt) },
              { label: 'Midpoint', value: RK.format((r[enc.low] + r[enc.high]) / 2, fmt) }
            ];
            if (enc.group) tr.unshift({ label: ctx.title(enc.group), value: r[enc.group] });
            return C.tip(r[enc.label], tr, enc.note ? r[enc.note] : (ctx.dataset.has('basis') ? r.basis : null));
          }
        },
        xAxis: { type: 'value', min: axMin, max: axMax, interval: step, axisLabel: { formatter: C.axisFmt(fmt) } },
        yAxis: {
          type: 'category', data: labels, inverse: true,
          axisLine: { show: true, lineStyle: { color: t.axis } },
          axisLabel: { color: t.ink, fontSize: 11.5, width: 170, overflow: 'break', lineHeight: 14 }
        },
        series: series
      };
    }, {
      select: function (p, ctx) { return p.seriesId === 'range' ? { field: ctx.enc.label, value: p.name } : null; }
    })
  });
})();
