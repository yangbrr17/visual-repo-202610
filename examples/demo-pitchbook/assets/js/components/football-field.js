/*!
 * RK component: football-field — valuation ranges by methodology (horizontal floating bars)
 * with reference lines (current / offer price, theme reference colour), an optional shaded band
 * (e.g. proposed offer range) and reference-only methods (52-week range, analyst targets) greyed.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /** Axis tick format: no decimals when the tick step is whole ($30 rather than $30.00). */
  function tickFmt(fmt, step) {
    var code = RK.format.presets[fmt] || fmt;
    return step % 1 === 0 && RK.format.decimals(code) ? code.replace(/0\.0+/g, '0') : code;
  }

  RK.component({
    id: 'football-field',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'method', low: 'low', high: 'high', group: null, note: null },
      refLines: [],          // [{value, label, color, type}] current / offer price (theme reference colour, dashed)
      refBand: null,         // {from, to, label} shaded band, e.g. offer range
      referenceGroups: ['Reference'],   // groups shown greyed: market reference only (52-week range, analyst targets)
      format: null,          // value format (defaults to the low field format)
      showValues: true,      // low / high labels at the bar ends
      groupColors: true,     // colour bars by group
      legend: true,          // group key, top-left (when bars are coloured by group)
      crossFilter: true,
      crossFilterScope: 'dataset'   // 'method' is a field of this table only
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

      // colours: peers by group (clear of accent2 = the band and of the reference-line colour), reference rows grey
      var refGroups = [].concat(o.referenceGroups || []);
      function isRef(r) { return !!enc.group && refGroups.indexOf(r[enc.group]) >= 0; }
      var groups = enc.group ? util.unique(rows.map(function (r) { return r[enc.group]; })) : [];
      var peers = groups.filter(function (g) { return refGroups.indexOf(g) < 0; });
      var byGroup = !!enc.group && o.groupColors !== false;
      var pal = RK.theme.palette({ n: Math.max(2, peers.length), exclude: [t.accent2, t.ref] });
      function groupColor(g) { return refGroups.indexOf(g) >= 0 ? t.neutral : pal[peers.indexOf(g)]; }
      function colorOf(r, i) { return isRef(r) ? t.neutral : byGroup ? groupColor(r[enc.group]) : pal[i % 2]; }

      var lows = rows.map(function (r) { return r[enc.low]; });
      var highs = rows.map(function (r) { return r[enc.high]; });
      var refs = (o.refLines || []).filter(function (r) { return r && util.isNum(r.value); });
      var ext = util.extent(lows.concat(highs, refs.map(function (r) { return r.value; })));

      // geometry (px): category labels left (max 170, wrapped), value labels need ~44px on the right
      var W = ctx.el.clientWidth || 600;
      var labW = Math.min(170, Math.max.apply(null, labels.map(function (l) { return C.measure(l, '11px ' + t.fontSans); }).concat([40])));
      var x0 = 4 + labW + 8, plotW = Math.max(160, W - 44 - x0);
      // tick count adapts to the available width so labels never collide
      var step = util.niceStep((ext[1] - ext[0]) * 1.2 || 1, Math.max(2, Math.min(7, Math.floor(plotW / 70))));
      var axMin = Math.floor((ext[0] - step * 0.4) / step) * step, axMax = Math.ceil((ext[1] + step * 0.4) / step) * step;

      // reference-line labels sit above the plot; close values are spread apart so labels never overlap
      var refFont = '600 11px ' + t.fontSans;
      var refW = refs.map(function (r) { return C.measure(r.label || RK.format(r.value, fmt), refFont); });
      var gap = Math.max.apply(null, refW.concat([0])) + 12;
      var xs = refs.map(function (r) { return x0 + (r.value - axMin) / (axMax - axMin) * plotW; });
      var spread = C.spreadLabels(xs, gap, gap / 2, W - gap / 2);
      var mark = refs.map(function (r, k) {
        var col = r.color || t.ref;
        return {
          xAxis: r.value,
          lineStyle: { color: col, type: r.type || 'dashed', width: 1.25 },
          // y axis is inverted, so 'start' sits above the first bar
          label: { show: true, position: 'start', distance: 4, offset: [spread[k] - xs[k], 0], formatter: r.label || RK.format(r.value, fmt), color: col, fontWeight: 600, fontSize: 11, fontFamily: t.fontSans }
        };
      });

      var showLegend = byGroup && o.legend !== false && groups.length > 1;
      var bandLabel = o.refBand && o.refBand.label ? o.refBand.label : null;
      var top = (showLegend ? 26 : 0) + (bandLabel ? 18 : 0) + (mark.length ? 26 : 10);
      var valueLabel = { color: t.ink2, fontSize: 11, fontFamily: t.fontNum, textBorderColor: t.paper, textBorderWidth: 2 };

      var series = [
        { id: 'base', type: 'bar', stack: 'ff', silent: true, itemStyle: { color: 'transparent' }, tooltip: { show: false },
          data: lows, barWidth: '52%' },
        {
          id: 'range', name: 'Range', type: 'bar', stack: 'ff', barWidth: '52%',
          data: rows.map(function (r, i) {
            var c = C.dim(ctx, enc.label, r[enc.label], colorOf(r, i));
            return { value: (r[enc.high] != null && r[enc.low] != null) ? r[enc.high] - r[enc.low] : null, itemStyle: { color: c } };
          }),
          label: o.showValues ? util.merge({
            show: true, position: 'right', distance: 6,
            formatter: function (p) { return RK.format(highs[p.dataIndex], fmt); }
          }, valueLabel) : { show: false },
          markLine: mark.length ? { silent: true, symbol: ['none', 'none'], data: mark } : undefined,
          markArea: o.refBand ? {
            silent: true,
            itemStyle: { color: RK.theme.alpha(t.accent2, 0.12) },
            // band caption above the reference-line labels, centred on the band
            label: { show: !!bandLabel, position: 'top', distance: mark.length ? 22 : 4, color: t.ink3, fontSize: 10.5, fontFamily: t.fontSans, formatter: bandLabel || '' },
            data: [[{ xAxis: o.refBand.from }, { xAxis: o.refBand.to }]]
          } : undefined
        }
      ];
      // low labels on a ghost series so they sit left of the bar
      if (o.showValues) {
        series.push({
          id: 'lowlab', type: 'scatter', silent: true, symbolSize: 0, tooltip: { show: false },
          data: lows.map(function (v, i) { return [v, i]; }),
          label: util.merge({ show: true, position: 'left', distance: 6, formatter: function (p) { return RK.format(p.value[0], fmt); } }, valueLabel)
        });
      }
      // group key: empty series carry the legend swatches (the bars themselves are one stacked series)
      if (showLegend) {
        groups.forEach(function (g) { series.push({ id: 'key:' + g, name: g, type: 'scatter', silent: true, data: [], itemStyle: { color: groupColor(g) } }); });
      }

      return {
        legend: C.legend(ctx, { show: showLegend, data: groups, selectedMode: false }),
        grid: { left: 4, right: 44, top: top, bottom: 4, containLabel: true },
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
            if (enc.group) tr.unshift({ color: colorOf(r, p.dataIndex), label: ctx.title(enc.group), value: r[enc.group] });
            return C.tip(r[enc.label], tr, enc.note ? r[enc.note] : (ctx.dataset.has('basis') ? r.basis : null));
          }
        },
        xAxis: { type: 'value', min: axMin, max: axMax, interval: step, axisLabel: { formatter: C.axisFmt(tickFmt(fmt, step)) } },
        yAxis: {
          type: 'category', data: labels, inverse: true,
          axisLine: { show: true, lineStyle: { color: t.axis } },
          axisLabel: {
            color: function (v, i) { return rows[i] && isRef(rows[i]) ? t.ink3 : t.ink2; },
            fontSize: 11, width: 170, overflow: 'break', lineHeight: 14
          }
        },
        series: series
      };
    }, {
      rebuildOnResize: true,     // tick count and reference-label spreading depend on the width
      select: function (p, ctx) { return p.seriesId === 'range' ? { field: ctx.enc.label, value: p.name } : null; }
    })
  });
})();
