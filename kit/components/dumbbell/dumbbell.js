/*!
 * RK component: dumbbell — two values per category joined by a segment: before / after
 * (consensus -> actual), low / high (52-week range) with an optional third "marker" value
 * (current price). Coloured by direction (pos / neg) or one colour; sort by gap, ends or marker;
 * optional right-hand delta column; 'range' variant draws a band with end ticks.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;
  var MINUS = '−';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** Re-run the layout without animation when the width changes (label room is measured in px). */
  function relayout(render) {
    return function (ctx) {
      var api = render(ctx), last = ctx, update = api.update, w = api.chart.getWidth();
      api.update = function (c) { last = c; w = api.chart.getWidth(); update(c); };
      api.resize = function () {
        api.chart.resize();
        if (Math.abs(api.chart.getWidth() - w) > 4) { w = api.chart.getWidth(); update(Object.assign({}, last, { motion: false })); }
      };
      return api;
    };
  }

  var measureCtx = null;
  /** Text width in px (used to size the delta column and the room needed by end labels). */
  function textW(s, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(String(s)).width;
  }

  /** Axis tick format: drop decimals of the value format on large integer steps ($1,250 not $1,250.0). */
  function tickFmt(fmt, step, max) {
    if (typeof fmt !== 'string' || step < 1 || step % 1 || Math.abs(max) < 100) return fmt;
    var code = RK.format.presets[fmt] || fmt;
    return code.replace(/(0)\.0+/g, '$1').replace(/(#)\.#+/g, '$1');
  }
  function signed(v, fmt) {
    if (!isNum(v)) return RK.format(v, fmt);
    var s = RK.format(Math.abs(v), fmt);
    return v > 0 ? '+' + s : v < 0 && /[1-9]/.test(s) ? MINUS + s : s;
  }

  /** Tinted full-width row band behind highlighted categories (like .rk-table tr.is-target). */
  function rowBand(ctx, idx) {
    var t = ctx.theme;
    return {
      id: 'band', type: 'custom', silent: true, z: 0, tooltip: { show: false }, animation: false,
      renderItem: function (params, api) {
        var p = api.coord([0, api.value(0)]), bw = api.size([0, 1])[1];
        return { type: 'rect', shape: { x: 0, y: p[1] - bw / 2, width: api.getWidth(), height: bw }, style: { fill: RK.theme.alpha(t.accent2, t.dark ? 0.16 : 0.11) } };
      },
      data: idx.map(function (i) { return [i]; })
    };
  }

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var range = o.variant === 'range';
    var hasMarker = !!(enc.marker && ctx.dataset && ctx.dataset.has(enc.marker));
    var rawFmt = o.format || ctx.fmtOf(enc.from) || 'auto';
    var norm = o.normalize === 'to' || o.normalize === 'from' ? o.normalize : null;
    var fmt = norm ? (o.format || '0%') : rawFmt;
    var hf = enc.highlight && ctx.dataset && ctx.dataset.has(enc.highlight) ? enc.highlight : null;
    var hlist = o.highlight == null ? [] : [].concat(o.highlight);

    // ---- rows -> items (raw + plotted values) ----
    var items = ctx.rows.map(function (r) {
      var f = isNum(r[enc.from]) ? r[enc.from] : null, to = isNum(r[enc.to]) ? r[enc.to] : null;
      var m = hasMarker && isNum(r[enc.marker]) ? r[enc.marker] : null;
      var base = norm === 'to' ? to : norm === 'from' ? f : 1;
      var sc = function (v) { return v == null ? null : norm ? (base ? v / base : null) : v; };
      return {
        row: r, label: r[enc.label], from: f, to: to, marker: m,
        pf: sc(f), pt: sc(to), pm: sc(m),
        gap: f != null && to != null ? to - f : null,
        hi: (hf && !!r[hf] && r[hf] !== 'false') || hlist.indexOf(r[enc.label]) >= 0
      };
    });
    if (o.sort) {
      var dir = o.sortOrder === 'asc' ? 1 : -1;
      var key = {
        gap: function (d) { return norm && d.pf != null && d.pt != null ? d.pt - d.pf : d.gap; },
        from: function (d) { return d.pf; }, to: function (d) { return d.pt; }, marker: function (d) { return d.pm; }
      }[o.sort];
      items.sort(function (a, b) {
        if (o.sort === 'label') return String(a.label).localeCompare(String(b.label)) * dir;
        var x = key ? key(a) : null, y = key ? key(b) : null;
        if (x == null) return y == null ? 0 : 1;
        if (y == null) return -1;
        return (x - y) * dir;
      });
    }
    var labels = items.map(function (d) { return d.label; });
    var hiIdx = [];
    items.forEach(function (d, i) { if (d.hi) hiIdx.push(i); });

    // ---- colours ----
    var byDir = o.colorBy === 'direction';
    var up = o.goodDirection === 'down' ? t.neg : t.pos, down = o.goodDirection === 'down' ? t.pos : t.neg;
    var single = range ? t.accent : (t.accent3 || t.accent);
    var fromCol = byDir ? RK.theme.mix(t.ink3, t.paper, 0.15) : single;
    function colorOf(d) {
      if (!byDir) return single;
      if (d.gap == null || d.gap === 0) return t.neutral;
      return d.gap > 0 ? up : down;
    }
    var cols = items.map(function (d) { return C.dim(ctx, enc.label, d.label, colorOf(d)); });

    // ---- value axis: nice bounds, extended when end labels need room ----
    var vals = [];
    items.forEach(function (d) { vals.push(d.pf, d.pt, d.pm); });
    (o.refLines || []).forEach(function (r) { vals.push(r.value); });
    var ext = util.extent(vals), span = (ext[1] - ext[0]) || Math.abs(ext[1]) || 1;
    var plotPx = Math.max(160, inst.getWidth() - 190 - (o.delta ? 70 : 0));
    var step = util.niceStep(span, Math.max(3, Math.min(6, Math.round(plotPx / 110))));
    var axMin = Math.floor(ext[0] / step) * step, axMax = Math.ceil(ext[1] / step) * step;
    if (o.zero || (ext[0] >= 0 && ext[0] < span * 0.25)) axMin = Math.min(0, axMin);
    // end labels sit outside the dots: widen the axis by a step where they would not fit
    var labelsOn = o.labels !== false && o.labels !== 'none' && o.labels !== 'marker';
    var size = o.dotSize || 9;
    var lblPx = 0;
    if (labelsOn) items.forEach(function (d) { [d.pf, d.pt].forEach(function (v) { if (v != null) lblPx = Math.max(lblPx, textW(RK.format(v, fmt), '10.5px ' + t.fontNum)); }); });
    // end labels run past the plot edge: push the category labels / delta column out by the overflow
    var room = function (gap, side) {
      var need = labelsOn && !(norm === 'to' && side === 'right') && !(norm === 'from' && side === 'left') ? lblPx + size / 2 + 6 : 0;
      return Math.max(0, Math.ceil(need - gap / ((axMax - axMin) || 1) * plotPx));
    };
    var overL = room(ext[0] - axMin, 'left'), overR = room(axMax - ext[1], 'right');

    var rangeName = o.rangeLabel || (ctx.title(enc.from) + ' \u2013 ' + ctx.title(enc.to));
    var stagger = Math.min(45, 700 / Math.max(1, items.length));
    var series = [];
    if (hiIdx.length && o.highlightBand !== false) series.push(rowBand(ctx, hiIdx));

    // segment (dumbbell bar or range band), grows from "from" to "to"
    series.push({
      id: 'seg', name: rangeName, type: 'custom', z: 2, silent: true, tooltip: { show: false },
      itemStyle: { color: RK.theme.alpha(single, 0.45) },
      animationDelay: function (i) { return i * stagger; },
      renderItem: function (params, api) {
        var a0 = api.value(1), b0 = api.value(2);
        if (isNaN(a0) || isNaN(b0)) return null;
        var a = api.coord([a0, api.value(0)]), b = api.coord([b0, api.value(0)]);
        var c = cols[params.dataIndex] || single;
        var w = range ? Math.min(9, api.size([0, 1])[1] * 0.42) : 3;
        return {
          type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
          style: { stroke: RK.theme.alpha(c, range ? (t.dark ? 0.42 : 0.26) : (t.dark ? 0.6 : 0.5)), lineWidth: w, lineCap: 'butt' },
          enterFrom: { shape: { x2: a[0] } }
        };
      },
      data: items.map(function (d, i) { return [i, d.pf == null ? NaN : d.pf, d.pt == null ? NaN : d.pt]; })
    });

    // end labels: outside the lower end on the left, outside the upper end on the right
    function endLabel(which) {
      if (!labelsOn || o.labels === 'marker') return { show: false };
      if (norm === which) return { show: false };     // the normalising end is always 100%
      return {
        show: true, distance: range ? 5 : size / 2 + 3, fontSize: 10.5, fontFamily: t.fontNum, color: t.ink3,
        formatter: function (p) { var d = items[p.dataIndex]; return RK.format(which === 'from' ? d.pf : d.pt, fmt); }
      };
    }
    function endPos(d, which) {
      var me = which === 'from' ? d.pf : d.pt, other = which === 'from' ? d.pt : d.pf;
      return other == null || me <= other ? 'left' : 'right';
    }
    var tick = range ? { symbol: 'rect', symbolSize: [2, 12] } : null;

    series.push({
      id: 'from', name: o.fromLabel || ctx.title(enc.from), type: 'scatter', z: 4,
      symbol: tick ? tick.symbol : 'circle', symbolSize: tick ? tick.symbolSize : size,
      animationDelay: function (i) { return i * stagger; },
      itemStyle: { color: fromCol },
      label: endLabel('from'),
      data: items.map(function (d, i) {
        var c = byDir ? fromCol : cols[i];
        return {
          name: d.label, value: [d.pf, i], label: { position: endPos(d, 'from') },
          itemStyle: range || byDir ? { color: c } : { color: t.paper, borderColor: c, borderWidth: 1.6 }
        };
      })
    });

    var toSeries = function (id, name, color, keep) {
      return {
        id: id, name: name, type: 'scatter', z: 5,
        symbol: tick ? tick.symbol : 'circle', symbolSize: tick ? tick.symbolSize : size,
        animationDelay: function (i) { return i * stagger + 260; },
        itemStyle: { color: color },
        label: endLabel('to'),
        data: items.map(function (d, i) {
          return { name: d.label, value: [keep(d) ? d.pt : null, i], label: { position: endPos(d, 'to') }, itemStyle: { color: cols[i] } };
        })
      };
    };
    var toName = o.toLabel || ctx.title(enc.to);
    if (byDir) {
      series.push(toSeries('to-up', o.upLabel || 'Increase', up, function (d) { return d.gap == null || d.gap >= 0; }));
      series.push(toSeries('to-down', o.downLabel || 'Decrease', down, function (d) { return d.gap != null && d.gap < 0; }));
    } else {
      series.push(toSeries('to', toName, single, function () { return true; }));
    }

    if (hasMarker) {
      series.push({
        id: 'marker', name: o.markerLabel || ctx.title(enc.marker), type: 'scatter', z: 6,
        symbol: 'diamond', symbolSize: size + 3,
        animationDelay: function (i) { return i * stagger + 420; },
        itemStyle: { color: t.accent2, borderColor: t.paper, borderWidth: 1 },
        label: labelsOn && (o.labels === 'marker' || o.labels === 'all') ? {
          show: true, position: 'top', distance: 3, fontSize: 10, fontFamily: t.fontNum, color: t.ink2,
          formatter: function (p) { return RK.format(items[p.dataIndex].pm, fmt); }
        } : { show: false },
        data: items.map(function (d, i) {
          return { name: d.label, value: [d.pm, i], itemStyle: { color: C.dim(ctx, enc.label, d.label, t.accent2) } };
        }),
        markLine: (o.refLines || []).length ? {
          silent: true, symbol: ['none', 'none'],
          data: o.refLines.map(function (r) {
            return { xAxis: r.value, lineStyle: { color: r.color || t.ink3, type: [4, 3], width: 1 },
              label: { show: true, position: 'start', color: t.ink2, fontSize: 10.5, formatter: r.label || RK.format(r.value, fmt) } };
          })
        } : undefined
      });
    }

    // ---- delta column (secondary category axis on the right) ----
    function deltaOf(d) {
      if (o.delta === 'abs') return d.gap;
      if (o.delta === 'pct') return d.from ? (d.to == null ? null : d.to / d.from - 1) : (d.to == null ? null : NaN);
      if (o.delta === 'marker') return d.to ? (d.marker == null ? null : d.marker / d.to - 1) : null;
      return null;
    }
    var deltaFmt = o.deltaFormat || (o.delta === 'abs' ? rawFmt : '0.0%');
    // right-aligned numbers: column width = widest label; the header is right-aligned over it
    var deltaTitle = o.deltaTitle || (o.delta === 'marker' ? 'vs. ' + (o.toLabel || ctx.title(enc.to)) : 'Change');
    var colW = 0;
    if (o.delta) items.forEach(function (d) { colW = Math.max(colW, textW(signed(deltaOf(d), deltaFmt), '600 11px ' + t.fontNum)); });
    colW = Math.ceil(colW) + 2;
    var headW = textW(deltaTitle, '10.5px ' + t.fontSans);
    var deltaAxis = o.delta ? {
      type: 'category', data: labels, inverse: true, position: 'right',
      axisLine: { show: false }, axisTick: { show: false },
      name: deltaTitle, nameLocation: 'start', nameGap: 10,
      nameTextStyle: { color: t.ink3, fontSize: 10.5, align: 'left', verticalAlign: 'bottom', padding: [0, 0, 0, Math.max(0, 14 + colW + overR - headW)] },
      axisLabel: {
        interval: 0, align: 'right', margin: 14 + colW + overR, fontFamily: t.fontNum, fontSize: 11,
        formatter: function (v, i) {
          var d = items[i], x = d ? deltaOf(d) : null;
          var cls = o.delta === 'marker' || !byDir || !isNum(x) || x === 0 ? 'n' : ((x > 0) === (o.goodDirection !== 'down') ? 'p' : 'm');
          return '{' + cls + '|' + signed(x, deltaFmt) + '}';
        },
        rich: {
          p: { color: t.pos, fontFamily: t.fontNum, fontSize: 11, fontWeight: 600 },
          m: { color: t.neg, fontFamily: t.fontNum, fontSize: 11, fontWeight: 600 },
          n: { color: t.ink2, fontFamily: t.fontNum, fontSize: 11 }
        }
      }
    } : null;

    // ---- legend ----
    var fromName = o.fromLabel || ctx.title(enc.from), legendData = [];
    if (range) legendData.push({ name: rangeName, icon: 'roundRect', itemStyle: { color: RK.theme.alpha(single, 0.45) } });
    else if (byDir) legendData.push({ name: fromName, icon: 'circle', itemStyle: { color: fromCol } },
      { name: o.upLabel || 'Increase', icon: 'circle', itemStyle: { color: up } }, { name: o.downLabel || 'Decrease', icon: 'circle', itemStyle: { color: down } });
    else legendData.push({ name: fromName, icon: 'circle', itemStyle: { color: t.paper, borderColor: single, borderWidth: 1.5 } },
      { name: toName, icon: 'circle', itemStyle: { color: single } });
    if (hasMarker) legendData.push({ name: o.markerLabel || ctx.title(enc.marker), icon: 'diamond' });
    var showLegend = o.legend !== false;
    var hasTopRef = (o.refLines || []).length > 0;

    var catAxis = {
      type: 'category', data: labels, inverse: true,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: t.grid, type: [2, 3] } },
      axisLabel: {
        interval: 0, color: t.ink2, fontSize: 11, width: 150, overflow: 'truncate', margin: 8 + overL,
        formatter: function (v, i) { return items[i] && items[i].hi ? '{h|' + v + '}' : v; },
        rich: { h: { color: t.ink, fontWeight: 600, fontSize: 11 } }
      }
    };
    var valAxis = {
      type: 'value', min: axMin, max: axMax, interval: step,
      axisLabel: { formatter: C.axisFmt(tickFmt(fmt, step, axMax)), hideOverlap: true },
      splitLine: { show: true, lineStyle: { color: t.grid } }
    };

    return {
      legend: C.legend(ctx, { show: showLegend, data: legendData, selectedMode: false }),
      grid: C.grid(ctx, { top: (showLegend ? 30 : 8) + (hasTopRef || o.delta ? 16 : 0), left: 4, right: o.delta ? 8 : 16 + overR, bottom: 4 }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var d = items[p.dataIndex];
          if (!d) return '';
          var tr = [
            { color: fromCol, label: o.fromLabel || ctx.title(enc.from), value: RK.format(d.from, rawFmt) },
            { color: colorOf(d), label: toName, value: RK.format(d.to, rawFmt) }
          ];
          if (hasMarker) {
            tr.push({ color: t.accent2, label: o.markerLabel || ctx.title(enc.marker), value: RK.format(d.marker, rawFmt), bold: true });
            if (d.to != null && d.marker != null) tr.push({ label: '% of ' + toName, value: RK.format(d.to ? d.marker / d.to : NaN, '0.0%') });
            if (d.from != null && d.to != null && d.marker != null) tr.push({ label: 'Position in range', value: RK.format(d.to - d.from ? (d.marker - d.from) / (d.to - d.from) : NaN, '0%') });
          } else {
            tr.push({ label: 'Change', value: signed(d.gap, rawFmt), bold: true });
            tr.push({ label: 'Change %', value: signed(d.from ? (d.gap == null ? null : d.gap / Math.abs(d.from)) : NaN, '0.0%') });
          }
          return C.tip(d.label, tr);
        }
      },
      xAxis: valAxis,
      yAxis: deltaAxis ? [catAxis, deltaAxis] : catAxis,
      series: series
    };
  }

  RK.component({
    id: 'dumbbell',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'company', from: 'from', to: 'to', marker: null, highlight: 'is_target' },
      variant: 'dumbbell',        // dumbbell (dots joined by a bar) | range (band with end ticks, e.g. 52-week range)
      colorBy: 'direction',       // direction (to above from = pos colour) | single
      goodDirection: 'up',        // 'up' | 'down' — which direction is favourable (gets --rk-pos)
      normalize: null,            // null | 'to' | 'from' — plot values as % of that end (e.g. % of 52-week high)
      sort: 'gap',                // null | 'gap' | 'from' | 'to' | 'marker' | 'label'
      sortOrder: 'desc',          // 'desc' | 'asc'
      labels: 'ends',             // 'ends' | 'marker' | 'all' | false
      delta: null,                // null | 'abs' | 'pct' | 'marker' — right-hand change column
      deltaFormat: null,          // format of the delta column; default value format ('abs') or 0.0%
      deltaTitle: null,           // header of the delta column
      fromLabel: null,            // legend names (default: field titles)
      toLabel: null,
      markerLabel: null,
      rangeLabel: null,           // legend name of the range band (variant 'range')
      upLabel: null,              // legend names for direction colouring (default 'Increase' / 'Decrease')
      downLabel: null,
      highlight: null,            // label value(s) to emphasise in addition to encode.highlight
      highlightBand: true,
      refLines: [],               // [{value, label, color}] vertical reference lines
      zero: false,                // force the value axis to include zero
      dotSize: 9,
      format: null,
      legend: true
    },
    render: relayout(C(build, {
      select: function (p, ctx) { return p.seriesType === 'scatter' && p.name ? { field: ctx.enc.label, value: p.name } : null; }
    }))
  });
})();
