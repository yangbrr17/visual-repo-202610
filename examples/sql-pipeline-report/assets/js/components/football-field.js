/*!
 * RK component: football-field — valuation ranges by methodology (horizontal floating bars)
 * with reference lines (current / offer price, theme reference colour), an optional shaded band
 * (e.g. proposed offer range) and reference-only methods (52-week range, analyst targets) greyed.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /**
   * Category label lines: one line when it fits, else break before an opening parenthesis
   * ("Trading comparables / (EV / EBITDA)"), else greedy word wrap.
   */
  function labelLines(text, font, maxW) {
    text = String(text == null ? '' : text);
    if (C.measure(text, font) <= maxW) return [text];
    var k = text.indexOf(' (');
    if (k > 0) {
      var a = text.slice(0, k), b = text.slice(k + 1);
      if (C.measure(a, font) <= maxW && C.measure(b, font) <= maxW) return [a, b];
    }
    var words = text.split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (C.measure(next, font) <= maxW || !cur) cur = next; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
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

      // colours: peers by group (clear of accent2 = the band, of the reference-line colour and of greys), reference rows grey
      var refGroups = [].concat(o.referenceGroups || []);
      function isRef(r) { return !!enc.group && refGroups.indexOf(r[enc.group]) >= 0; }
      var groups = enc.group ? util.unique(rows.map(function (r) { return r[enc.group]; })) : [];
      var peers = groups.filter(function (g) { return refGroups.indexOf(g) < 0; });
      var byGroup = !!enc.group && o.groupColors !== false;
      var all = RK.theme.palette({ n: Math.max(2, peers.length) + 4, exclude: [t.accent2, t.ref, t.neg] });
      var pal = all.filter(function (c) { var x = RK.theme.parseColor(c); return Math.max(x[0], x[1], x[2]) - Math.min(x[0], x[1], x[2]) >= 40; });
      if (pal.length < 2) pal = all;
      function groupColor(g) { return refGroups.indexOf(g) >= 0 ? t.neutral : pal[peers.indexOf(g)]; }
      function colorOf(r, i) { return isRef(r) ? t.neutral : byGroup ? groupColor(r[enc.group]) : pal[i % 2]; }

      var lows = rows.map(function (r) { return r[enc.low]; });
      var highs = rows.map(function (r) { return r[enc.high]; });
      var refs = (o.refLines || []).filter(function (r) { return r && util.isNum(r.value); });
      var ext = util.extent(lows.concat(highs, refs.map(function (r) { return r.value; })));

      // geometry in px, computed here (grid without containLabel) so label collisions can be checked exactly:
      // category labels left (wrapped, max 170 / 28% of the width), value labels outside the bar ends
      var W = ctx.el.clientWidth || 600, catFont = '11px ' + t.fontSans, numFont = '11px ' + t.fontNum;
      var catCap = Math.min(170, Math.max(90, W * 0.28));
      var catLines = labels.map(function (l) { return labelLines(l, catFont, catCap); });
      var labW = Math.max.apply(null, catLines.map(function (ls) { return Math.max.apply(null, ls.map(function (x) { return C.measure(x, catFont); })); }).concat([40]));
      var gridRight = 12, x0 = 4 + Math.ceil(labW) + 8, plotW = Math.max(160, W - gridRight - x0);
      // tick count adapts to the available width so labels never collide
      var step = util.niceStep((ext[1] - ext[0]) * 1.2 || 1, Math.max(2, Math.min(7, Math.floor(plotW / 70))));
      var axMin = Math.floor((ext[0] - step * 0.4) / step) * step, axMax = Math.ceil((ext[1] + step * 0.4) / step) * step;
      var xOf = function (v) { return x0 + (v - axMin) / (axMax - axMin) * plotW; };
      // the axis must hold the low / high labels: widen it a step at a time until the outermost labels fit
      if (o.showValues) {
        for (var grow = 0; grow < 6; grow++) {
          var okL = true, okR = true;
          rows.forEach(function (r, i) {
            if (util.isNum(lows[i]) && xOf(lows[i]) - 4 - C.measure(RK.format(lows[i], fmt), numFont) - 4 < x0 + 2) okL = false;
            if (util.isNum(highs[i]) && xOf(highs[i]) + 4 + C.measure(RK.format(highs[i], fmt), numFont) + 4 > x0 + plotW + gridRight - 2) okR = false;
          });
          if (okL && okR) break;
          if (!okL) axMin -= step;
          if (!okR) axMax += step;
        }
      }

      // reference-line labels sit above the plot; close values are spread apart so labels never overlap
      var refFont = '600 11px ' + t.fontSans;
      var refW = refs.map(function (r) { return C.measure(r.label || RK.format(r.value, fmt), refFont); });
      var gap = Math.max.apply(null, refW.concat([0])) + 12;
      var xs = refs.map(function (r) { return xOf(r.value); });
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

      var series = [
        { id: 'base', type: 'bar', stack: 'ff', silent: true, itemStyle: { color: 'transparent' }, tooltip: { show: false },
          data: lows, barWidth: '52%' },
        {
          id: 'range', name: 'Range', type: 'bar', stack: 'ff', barWidth: '52%',
          data: rows.map(function (r, i) {
            var c = C.dim(ctx, enc.label, r[enc.label], colorOf(r, i));
            return { value: (r[enc.high] != null && r[enc.low] != null) ? r[enc.high] - r[enc.low] : null, itemStyle: { color: c } };
          }),
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
      // low / high labels on a ghost series above the reference lines; a label crossed by a reference line
      // (+-3px) gets a chip in the colour painted behind it (paper, or the band) so the dashed line stops at the
      // figures instead of striking them through
      if (o.showValues) {
        var band = o.refBand ? [Math.min(o.refBand.from, o.refBand.to), Math.max(o.refBand.from, o.refBand.to)] : null;
        var bandFill = RK.theme.mix(t.accent2, t.paper, 0.88), ends = [];
        var refX = refs.map(function (r) { return xOf(r.value); });
        var end = function (v, i, side) {
          if (!util.isNum(v)) return;
          var w = C.measure(RK.format(v, fmt), numFont) * 1.06 + 4;
          var xa = xOf(v) + side * 4, xb = xOf(v) + side * (4 + w), lo = Math.min(xa, xb) - 3, hi = Math.max(xa, xb) + 3;
          var crossed = refX.some(function (x) { return x >= lo && x <= hi; });
          var midV = axMin + ((xa + xb) / 2 - x0) / plotW * (axMax - axMin);
          ends.push({ value: [v, i], label: { position: side < 0 ? 'left' : 'right', backgroundColor: !crossed ? null : band && midV >= band[0] && midV <= band[1] ? bandFill : t.paper } });
        };
        rows.forEach(function (r, i) { end(lows[i], i, -1); end(highs[i], i, 1); });
        series.push({
          // scatter defaults to opacity 0.8, which the labels (and their chips) inherit: keep them opaque
          id: 'values', type: 'scatter', silent: true, symbolSize: 0, z: 6, tooltip: { show: false }, data: ends, itemStyle: { opacity: 1 },
          label: { show: true, distance: 4, padding: [1, 2], color: t.ink2, fontSize: 11, fontFamily: t.fontNum,
            formatter: function (p) { return RK.format(p.value[0], fmt); } }
        });
      }
      // group key: empty series carry the legend swatches (the bars themselves are one stacked series)
      if (showLegend) {
        groups.forEach(function (g) { series.push({ id: 'key:' + g, name: g, type: 'scatter', silent: true, data: [], itemStyle: { color: groupColor(g) } }); });
      }

      return {
        legend: C.legend(ctx, { show: showLegend, data: groups, selectedMode: false }),
        grid: { left: x0, right: gridRight, top: top, bottom: 24, containLabel: false },
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
        xAxis: { type: 'value', min: axMin, max: axMax, interval: step, axisLabel: { formatter: C.tickFmt(fmt, step), hideOverlap: true } },
        yAxis: {
          type: 'category', data: labels, inverse: true,
          axisLine: { show: true, lineStyle: { color: t.axis } },
          axisLabel: {
            color: function (v, i) { return rows[i] && isRef(rows[i]) ? t.ink3 : t.ink2; },
            fontSize: 11, lineHeight: 14, margin: 8,
            formatter: function (v, i) { return (catLines[i] || [String(v)]).join('\n'); }
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
