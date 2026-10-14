/*!
 * RK component: line — multi-series line / area chart for time series and category trends.
 * Wide data (encode.y = [fields]) or long data (encode.y = field + encode.series = field).
 * Time axis when x is a date field, category axis otherwise. Rebasing (e.g. = 100), a highlighted
 * series, collision-free end labels, dashed estimates ("2026E"), numbered event pins (eventsData),
 * reference lines, and zoom that re-fits the value axis to the visible window.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;
  var FORECAST_RE = /\d\s*[EFBP]$/i;      // "2026E", "FY27F", "2025B", "2028P"
  var DELTA = '+0.0%;-0.0%;0.0%';

  RK.component({
    id: 'line',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'date', y: 'value', series: null },
      area: false,             // false | true | 'stacked'
      rebase: null,            // null | number — each series / its first non-null value x rebase (e.g. 100)
      endLabels: true,         // true | false | 'value' | 'name' — collision-free labels at the line ends
      smooth: false,
      highlight: null,         // series name drawn thicker in accent2; the other series are muted
      labels: 'auto',          // point value labels: true | false | 'auto' (category axis, few points)
      labelFormat: null,       // format of point labels (defaults to format)
      symbols: 'auto',         // point markers: true | false | 'auto' (category axis, <= 24 points)
      forecastFrom: 'auto',    // first estimate x value (dashed line + shaded band); 'auto' detects "2026E"; null = off
      forecastLabel: 'Projected',
      eventsData: null,        // dataset id with events {date, label, kind, detail} -> numbered pins
      eventsEncode: { date: 'date', label: 'label', kind: 'kind', detail: 'detail' },
      eventsSeries: null,      // series the pins sit on (default: highlight, else the first series)
      refLines: [],            // [{value, label, color}] horizontal reference lines
      zoom: 'auto',            // 'auto' (on for time axes) | true | false
      xType: 'auto',           // 'auto' | 'time' | 'category' | 'value'
      xFormat: null,           // x format for tooltips (dates default to the field format / 'dd mmm yyyy')
      format: null,            // value format; defaults to the y field format ('#,##0.0' when rebased)
      yMin: 'auto',            // 'auto' (zero for areas, else fit the data) | 'dataMin' | number
      legend: true
    },
    render: function (ctx) {
      var state = { zoom: null, legendSel: null, labelIds: [], model: null, yAxis: null, raf: 0 };
      var api = C(function (c, inst) { return build(c, inst, state); }, {
        select: function (p, c) {
          if (!c.enc.series || Array.isArray(c.enc.y) || p.componentType !== 'series' || p.seriesType !== 'line') return null;
          var s = state.model && state.model.byId[p.seriesId];
          return s ? { field: c.enc.series, value: s.name } : null;
        }
      })(ctx);
      var inst = api.chart;
      var current = ctx;

      // zoom / legend changes: re-fit the value axis to what is visible, then move the end labels
      var refit = util.rafThrottle(function () {
        if (inst.isDisposed()) return;
        var y = yAxisFor(current, state, visibleX(inst, state.model));
        if (!sameAxis(y, state.yAxis)) { state.yAxis = y; inst.setOption({ yAxis: [{ id: 'y', min: y.min, max: y.max, interval: y.interval }] }); }
        layoutEndLabels(inst, current, state, 'instant');
      });
      inst.on('datazoom', function () {
        var dz = (inst.getOption().dataZoom || [])[0];
        if (dz) state.zoom = { start: dz.start, end: dz.end };
        refit();
      });
      inst.on('legendselectchanged', function (p) { state.legendSel = util.merge({}, p.selected); refit(); });

      layoutEndLabels(inst, ctx, state, 'enter');
      return {
        chart: inst,
        update: function (c) { current = c; api.update(c); layoutEndLabels(inst, c, state, 'update'); },
        resize: function () { api.resize(); layoutEndLabels(inst, current, state, 'instant'); },
        destroy: function () { api.destroy(); },
        exportImage: api.exportImage,
        exportSVG: api.exportSVG
      };
    }
  });

  /* ------------------------------------------------------------------ *
   * Data model
   * ------------------------------------------------------------------ */
  function prepare(ctx) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var xf = ctx.field(enc.x);
    var xType = o.xType !== 'auto' ? o.xType :
      (xf && xf.type === 'date') || (!xf && ctx.rows.length && /^\d{4}-\d{2}-\d{2}/.test(String(ctx.rows[0][enc.x]))) ? 'time' :
      (xf && xf.type === 'number') ? 'value' : 'category';
    var isTime = xType === 'time', isValue = xType === 'value';
    var data = C.toSeries(ctx, { sortX: isTime });
    var xs = data.categories;
    if (isValue) {
      var order = xs.map(function (_, i) { return i; }).sort(function (a, b) { return xs[a] - xs[b]; });
      xs = order.map(function (i) { return data.categories[i]; });
      data.series.forEach(function (s) { s.values = order.map(function (i) { return s.values[i]; }); });
    }
    // numeric axis positions: local-time ms for dates (same parsing as RK.format), raw numbers, or indices
    var xv = xs.map(function (x, i) {
      if (isTime) { var d = RK.format.toDate(x); return d ? d.getTime() : null; }
      return isValue ? +x : i;
    });

    var fmt = o.format || (o.rebase != null ? '#,##0.0' : data.yFormat) || 'auto';
    var hl = o.highlight;
    var stacked = o.area === 'stacked';
    var pal = palette(t, hl != null);
    var sel = enc.series && !Array.isArray(enc.y) ? ctx.selected(enc.series) : [];

    var pi = 0;
    var series = data.series.map(function (s, k) {
      var raw = s.values, vals = raw;
      if (o.rebase != null) {
        var base = null;
        for (var i = 0; i < raw.length; i++) if (raw[i] != null && raw[i] !== 0) { base = raw[i]; break; }
        vals = raw.map(function (v) { return v == null || base == null ? null : v / base * o.rebase; });
      }
      var isHl = hl != null && s.name === hl;
      var color = isHl ? t.accent2 : pal[pi++ % pal.length];
      var muted = hl != null && !isHl;
      if (muted) color = RK.theme.mix(color, t.paper, 0.12);
      var dimmed = sel.length && sel.indexOf(s.name) < 0;
      return {
        key: 's' + k, name: s.name, field: s.field, raw: raw, values: vals,
        color: dimmed ? RK.theme.alpha(color, 0.22) : color, solid: color,
        hl: isHl, muted: muted, dimmed: dimmed,
        width: isHl ? 2.75 : muted ? 1.5 : (data.series.length === 1 ? 2.25 : 2)
      };
    });
    // stacked: cumulative tops (for axis range, labels and tooltip totals)
    if (stacked) {
      var run = xs.map(function () { return 0; });
      series.forEach(function (s) {
        s.base = run.slice();
        s.top = s.values.map(function (v, i) { run[i] += v || 0; return run[i]; });
      });
    }

    // estimates boundary
    var fIdx = -1;
    if (o.forecastFrom != null && !stacked) {
      if (o.forecastFrom === 'auto') {
        if (!isTime && !isValue) {
          for (var j = 1; j < xs.length; j++) if (FORECAST_RE.test(String(xs[j])) && !FORECAST_RE.test(String(xs[j - 1]))) { fIdx = j; break; }
        }
      } else {
        var fv = isTime ? (RK.format.toDate(o.forecastFrom) || {}).getTime && RK.format.toDate(o.forecastFrom).getTime() : o.forecastFrom;
        for (var m = 0; m < xs.length; m++) {
          if ((isTime || isValue) ? xv[m] >= fv : xs[m] === o.forecastFrom) { fIdx = m; break; }
        }
      }
      if (fIdx <= 0) fIdx = -1;
    }

    var byId = {};
    series.forEach(function (s) { byId[s.key] = s; byId[s.key + 'f'] = s; });
    return { xType: xType, isTime: isTime, isValue: isValue, isCat: !isTime && !isValue, xs: xs, xv: xv,
      series: series, byId: byId, fmt: fmt, stacked: stacked, fIdx: fIdx };
  }

  /**
   * Series colours. With a highlight, the context series use the calm semantic tokens first
   * (accent, accent3, ink3) and nothing close to accent2, so gold always means "the target".
   */
  function palette(t, highlight) {
    var base = highlight ? [t.accent, t.accent3, t.ink3].concat(t.cat) : t.cat.slice();
    var out = [];
    base.forEach(function (c) {
      if (!c) return;
      if (highlight && colorDist(c, t.accent2) < 72) return;
      if (out.some(function (x) { return colorDist(x, c) < 46; })) return;
      out.push(c);
    });
    return out.length ? out : t.cat.slice();
  }
  function colorDist(a, b) {
    var x = RK.theme.parseColor(a), y = RK.theme.parseColor(b);
    return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2));
  }

  /** Events dataset -> pins anchored on one series (nearest x). */
  function preparePins(ctx, model) {
    var o = ctx.options;
    if (!o.eventsData || !RK.data.get(o.eventsData) || !model.series.length) return [];
    var ee = util.merge({ date: 'date', label: 'label', kind: 'kind', detail: 'detail' }, o.eventsEncode || {});
    var anchor = null;
    var want = o.eventsSeries != null ? o.eventsSeries : o.highlight;
    model.series.forEach(function (s) { if (!anchor && want != null && s.name === want) anchor = s; });
    anchor = anchor || model.series[0];
    var rows = ctx.view(o.eventsData).slice();
    var pins = [];
    rows.forEach(function (r) {
      var x = r[ee.date];
      if (x == null) return;
      var pos = model.isTime ? (RK.format.toDate(x) || {}).getTime && RK.format.toDate(x).getTime() : (model.isValue ? +x : model.xs.indexOf(x));
      if (pos == null || pos < 0 || isNaN(pos)) return;
      // nearest observation with a value (weekly data vs daily event dates)
      var best = -1, bd = Infinity;
      for (var i = 0; i < model.xv.length; i++) {
        if (anchor.values[i] == null) continue;
        var dd = Math.abs(model.xv[i] - pos);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best < 0) return;
      // ignore events outside the plotted range
      if (pos < model.xv[0] - (model.xv[1] - model.xv[0] || 0) || pos > model.xv[model.xv.length - 1] + (model.xv[1] - model.xv[0] || 0)) return;
      var y = model.stacked ? anchor.top[best] : anchor.values[best];
      pins.push({ i: best, x: x, y: y, label: r[ee.label], kind: r[ee.kind], detail: r[ee.detail], dateFmt: (ctx.data(o.eventsData).field(ee.date) || {}).format });
    });
    pins.sort(function (a, b) { return model.xv[a.i] - model.xv[b.i]; });
    pins.forEach(function (p, k) { p.n = k + 1; });
    return pins;
  }

  /* ------------------------------------------------------------------ *
   * Axis range (re-fitted to the visible x window)
   * ------------------------------------------------------------------ */
  function fullX(model) { return [model.xv[0], model.xv[model.xv.length - 1]]; }

  function windowFromZoom(model, zoom) {
    var ext = fullX(model);
    if (!zoom) return ext;
    var span = ext[1] - ext[0];
    return [ext[0] + span * (zoom.start || 0) / 100, ext[0] + span * (zoom.end == null ? 100 : zoom.end) / 100];
  }

  function visibleX(inst, model) {
    var g = gridRect(inst);
    if (!g || !model) return null;
    var a = inst.convertFromPixel({ xAxisIndex: 0 }, g.x), b = inst.convertFromPixel({ xAxisIndex: 0 }, g.x + g.width);
    if (!util.isNum(a) || !util.isNum(b)) return null;
    if (model.isCat) { a = Math.floor(a); b = Math.ceil(b); }
    return [Math.min(a, b), Math.max(a, b)];
  }

  function isShown(state, s) { return !state.legendSel || state.legendSel[s.name] !== false; }

  function yAxisFor(ctx, state, win) {
    var o = ctx.options, model = state.model;
    if (!model) return null;
    win = win || windowFromZoom(model, state.zoom);
    var vals = [];
    model.series.forEach(function (s) {
      if (!isShown(state, s)) return;
      var arr = model.stacked ? s.top : s.values;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] == null || !isFinite(arr[i])) continue;
        if (model.xv[i] < win[0] - 1e-9 || model.xv[i] > win[1] + 1e-9) continue;
        vals.push(arr[i]);
      }
    });
    if (!vals.length) return { min: null, max: null, interval: null };
    var ext = util.extent(vals);
    var lo = ext[0], hi = ext[1];
    var zeroBased = o.area === true || model.stacked;
    if (zeroBased) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (util.isNum(o.yMin)) lo = Math.min(o.yMin, lo);
    if (hi === lo) { hi += Math.abs(hi) * 0.1 || 1; lo -= zeroBased ? 0 : Math.abs(lo) * 0.1 || 1; }
    if (state.pins && state.pins.length) hi += (hi - lo) * 0.14;       // headroom for event pins
    var g = state.gridH || 260;
    var step = util.niceStep(hi - lo, util.clamp(Math.round(g / 52), 3, 7));
    var min = util.isNum(o.yMin) ? o.yMin : (o.yMin === 'dataMin' ? ext[0] : Math.floor(lo / step - 1e-9) * step);
    var max = Math.ceil(hi / step - 1e-9) * step;
    if (max === hi && !zeroBased && !(state.pins && state.pins.length)) max += 0;  // exact fit keeps the top gridline
    return { min: round(min), max: round(max), interval: o.yMin === 'dataMin' ? null : step };
  }
  function round(v) { return Math.round(v * 1e10) / 1e10; }
  function sameAxis(a, b) { return a && b && a.min === b.min && a.max === b.max && a.interval === b.interval; }

  /* ------------------------------------------------------------------ *
   * Option builder
   * ------------------------------------------------------------------ */
  function build(ctx, inst, state) {
    var o = ctx.options, t = ctx.theme;
    var model = state.model = prepare(ctx);
    var fmt = model.fmt;
    var n = model.xs.length;
    var useZoom = o.zoom === 'auto' ? model.isTime && n > 12 : !!o.zoom;
    var showLabels = o.labels === 'auto' ? model.isCat && n <= 12 && model.series.length <= 3 && !model.stacked : !!o.labels;
    var showSymbols = o.symbols === 'auto' ? model.isCat && n <= 24 : !!o.symbols;
    var pins = state.pins = preparePins(ctx, model);
    var hasLegend = o.legend !== false && model.series.length > 1;
    var slider = useZoom && o.zoomSlider !== false && !ctx.print;

    // reserve the right margin for the end labels
    var right = 14;
    if (o.endLabels && model.series.length) {
      var wMax = 0;
      model.series.forEach(function (s) {
        var ext = util.extent(s.values);
        var vtxt = [RK.format(ext[0], fmt), RK.format(ext[1], fmt)].sort(function (a, b) { return b.length - a.length; })[0];
        wMax = Math.max(wMax, labelWidth(o.endLabels, s, vtxt, t));
      });
      right = Math.ceil(wMax) + 18;
    }
    var top = hasLegend ? 34 : (pins.length ? 16 : 12);
    var bottom = slider ? 34 : 4;
    var h = inst.getHeight ? inst.getHeight() : 300;
    state.gridH = Math.max(80, h - top - bottom - 24);

    var y = state.yAxis = yAxisFor(ctx, state);

    var xAxisData = function (s, mask) {
      if (model.isCat) return s.values.map(function (v, i) { return mask && !mask(i) ? null : v; });
      var out = [];
      for (var i = 0; i < n; i++) {
        if (s.values[i] == null || (mask && !mask(i))) continue;
        out.push([model.xv[i], s.values[i], i]);
      }
      return out;
    };

    var series = [];
    model.series.forEach(function (s, k) {
      var areaOpacity = model.stacked ? 0.88 : (model.series.length === 1 ? 0.12 : 0.07);
      var base = {
        type: 'line', name: s.name, smooth: !!o.smooth, smoothMonotone: 'x',
        triggerLineEvent: true,
        symbol: 'circle', symbolSize: showSymbols ? 6 : 5, showSymbol: showSymbols,
        z: s.hl ? 4 : 2,
        lineStyle: { color: model.stacked ? t.paper : s.color, width: model.stacked ? 0.8 : s.width },
        itemStyle: { color: s.color, borderColor: t.paper, borderWidth: showSymbols ? 1.5 : 1 },
        emphasis: { focus: model.series.length > 2 ? 'series' : 'none', lineStyle: { width: model.stacked ? 0.8 : s.width + 0.5 } },
        blur: { lineStyle: { opacity: 0.35 }, itemStyle: { opacity: 0.35 }, areaStyle: { opacity: 0.2 } },
        stack: model.stacked ? 'total' : null,
        areaStyle: o.area ? { color: model.stacked ? s.color : RK.theme.alpha(s.solid, s.dimmed ? areaOpacity / 3 : areaOpacity), opacity: model.stacked ? areaOpacity : 1 } : undefined,
        label: showLabels ? C.label(ctx, o.labelFormat || fmt, {
          position: k === 0 && model.series.length > 1 && !model.stacked && isBelow(model, k) ? 'bottom' : 'top',
          distance: 6, fontSize: 10.5, color: s.dimmed ? RK.theme.alpha(t.ink2, 0.3) : (s.hl ? t.ink : t.ink2), fontWeight: s.hl ? 600 : 400
        }) : { show: false },
        labelLayout: showLabels ? { hideOverlap: true } : undefined,
        connectNulls: false,
        animationDuration: 1000,
        animationEasing: 'cubicOut'
      };
      if (model.fIdx > 0) {
        var f = model.fIdx;
        series.push(util.merge({}, base, { id: s.key, data: xAxisData(s, function (i) { return i <= f - 1; }) }));
        series.push(util.merge({}, base, {
          id: s.key + 'f',
          data: xAxisData(s, function (i) { return i >= f - 1; }),
          lineStyle: { type: [5, 3] },
          itemStyle: { color: t.paper, borderColor: s.color, borderWidth: 1.5 },
          areaStyle: base.areaStyle ? { color: RK.theme.alpha(s.solid, areaOpacity * 0.55) } : undefined,
          label: showLabels ? util.merge({}, base.label, { formatter: function (p) { return p.dataIndex === f - 1 ? '' : RK.format(Array.isArray(p.value) ? p.value[1] : p.value, o.labelFormat || fmt); } }) : base.label
        }));
      } else {
        series.push(util.merge({}, base, { id: s.key, data: xAxisData(s) }));
      }
    });

    // reference lines / estimates band / rebase baseline on a silent helper series (survives legend toggles)
    var marks = markSeries(ctx, model, fmt);
    if (marks) series.push(marks);
    if (pins.length) series.push(pinSeries(ctx, model, pins));

    var xAxis = model.isCat ? {
      id: 'x', type: 'category', data: model.xs, boundaryGap: showLabels || showSymbols,
      axisLabel: { hideOverlap: true, formatter: o.xFormat ? function (v) { return RK.format(v, o.xFormat); } : null },
      axisPointer: { show: true, type: 'line', label: { show: false } }
    } : {
      id: 'x', type: model.isTime ? 'time' : 'value', min: 'dataMin', max: 'dataMax',
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: t.axis } },
      axisTick: { show: model.isValue },
      axisLabel: model.isTime ? { hideOverlap: true, formatter: timeLabel, rich: { y: { fontWeight: 600, color: t.ink2, fontSize: 11, fontFamily: t.fontNum } } }
        : { formatter: C.axisFmt(o.xFormat || ctx.fmtOf(ctx.enc.x) || 'auto') },
      axisPointer: { show: true, type: 'line', label: { show: false } }
    };

    var dz = [];
    if (useZoom) {
      var z = state.zoom || { start: 0, end: 100 };
      dz.push({ id: 'dzi', type: 'inside', xAxisIndex: 0, filterMode: 'none', start: z.start, end: z.end });
      if (slider) {
        state.slider = state.slider || { left: 56, right: right };
        dz.push({ id: 'dzs', type: 'slider', xAxisIndex: 0, filterMode: 'none', start: z.start, end: z.end, height: 18, bottom: 6,
          showDetail: false, brushSelect: false, left: state.slider.left, right: state.slider.right });
      }
    } else state.slider = null;

    var legendNames = model.series.map(function (s) { return s.name; });
    return {
      animationDurationUpdate: 600,
      legend: C.legend(ctx, {
        show: hasLegend, data: legendNames.map(function (nm) { return { name: nm, icon: 'rect' }; }),
        itemWidth: 16, itemHeight: 4, selected: state.legendSel || undefined
      }),
      grid: C.grid(ctx, { top: top, bottom: bottom, right: right, left: 4 }),
      tooltip: {
        trigger: 'axis', confine: true,
        axisPointer: { type: 'line', lineStyle: { color: t.axis, type: 'dashed', width: 1 } },
        formatter: function (ps) { return tooltip(ctx, inst, model, pins, ps); }
      },
      xAxis: xAxis,
      yAxis: {
        id: 'y', type: 'value', min: y ? y.min : null, max: y ? y.max : null, interval: y ? y.interval : null,
        axisLabel: { formatter: axisFmt(fmt) }
      },
      dataZoom: dz,
      series: series
    };
  }

  /** First series labels go below when it sits under the second one (e.g. EBITDA under revenue). */
  function isBelow(model, k) {
    var a = model.series[k], b = model.series[k + 1];
    if (!b) return false;
    var below = 0, total = 0;
    a.values.forEach(function (v, i) { if (v != null && b.values[i] != null) { total++; if (v < b.values[i]) below++; } });
    return total && below / total > 0.5;
  }

  /** Axis labels: drop decimals on round ticks ("100" not "100.0", "$40" not "$40.00"). */
  function axisFmt(fmt) {
    var intFmt = typeof fmt === 'string' ? (RK.format.presets[fmt] || fmt).replace(/\.[0#]+/g, '') : fmt;
    return function (v) { return RK.format(v, Math.abs(v - Math.round(v)) < 1e-9 && !/%/.test(String(RK.format.presets[fmt] || fmt)) ? intFmt : fmt); };
  }

  function timeLabel(v) {
    var d = new Date(v);
    if (d.getMonth() === 0 && d.getDate() === 1) return '{y|' + d.getFullYear() + '}';
    if (d.getDate() === 1) return RK.format(d, 'mmm');
    return RK.format(d, 'd mmm');
  }

  function markSeries(ctx, model, fmt) {
    var o = ctx.options, t = ctx.theme;
    var lines = (o.refLines || []).map(function (r) {
      return {
        yAxis: r.value, name: r.label || '',
        lineStyle: { color: r.color || t.accent2, type: r.type || 'dashed', width: 1.25 },
        label: { formatter: r.label || RK.format(r.value, fmt), position: 'insideStartTop', color: r.color || t.accent2, fontWeight: 600, fontSize: 10.5 }
      };
    });
    if (o.rebase != null) {
      lines.unshift({ yAxis: o.rebase, lineStyle: { color: t.ink3, type: 'solid', width: 0.8, opacity: 0.6 }, label: { show: false } });
    }
    var area = null;
    if (model.fIdx > 0) {
      var from = model.isCat ? model.xs[model.fIdx] : model.xv[model.fIdx];
      var to = model.isCat ? model.xs[model.xs.length - 1] : model.xv[model.xv.length - 1];
      area = {
        silent: true,
        itemStyle: { color: RK.theme.alpha(t.ink3, t.dark ? 0.1 : 0.06) },
        label: { show: !!o.forecastLabel, position: 'top', distance: 5, color: t.ink3, fontSize: 10.5, fontStyle: 'italic', formatter: o.forecastLabel || '' },
        data: [[{ xAxis: from }, { xAxis: to }]]
      };
    }
    if (!lines.length && !area) return null;
    return {
      id: 'marks', type: 'line', name: '__marks', data: [], silent: true, tooltip: { show: false }, legendHoverLink: false,
      markLine: lines.length ? { silent: true, symbol: ['none', 'none'], animation: false, data: lines } : undefined,
      markArea: area || undefined
    };
  }

  /* ------------------------------------------------------------------ *
   * Event pins (custom series): numbered markers on stems, staggered when close
   * ------------------------------------------------------------------ */
  function pinSeries(ctx, model, pins) {
    var t = ctx.theme;
    var pinColor = t.ink2, txt = RK.theme.onColor(pinColor, t.ink, '#ffffff');
    var R = 8;
    return {
      id: 'events', type: 'custom', name: '__events', z: 6, clip: true, silent: false, tooltip: { show: false },
      encode: { x: 0, y: 1 },
      data: pins.map(function (p) { return [model.isCat ? p.i : model.xv[p.i], p.y, p.n]; }),
      renderItem: function (params, api) {
        var c = params.context;
        var cs = params.coordSys;
        if (!c.pos) {
          c.pos = pins.map(function (p) { return api.coord([model.isCat ? p.i : model.xv[p.i], p.y]); });
          c.lv = [];
          c.pos.forEach(function (pt, k) {
            var used = {};
            for (var m = 0; m < k; m++) if (Math.abs(c.pos[m][0] - pt[0]) < 2 * R + 3) used[c.lv[m]] = 1;
            var l = 0;
            while (used[l]) l++;
            c.lv.push(l);
          });
        }
        var k = params.dataIndex, pt = c.pos[k];
        if (!pt || pt[0] < cs.x - 1 || pt[0] > cs.x + cs.width + 1) return null;
        var stem = 14 + c.lv[k] * (2 * R + 4);
        var up = pt[1] - stem - R >= cs.y - 2;
        var cy = up ? pt[1] - stem : pt[1] + stem;
        return {
          type: 'group',
          children: [
            { type: 'line', shape: { x1: pt[0], y1: pt[1], x2: pt[0], y2: cy + (up ? R : -R) }, style: { stroke: pinColor, lineWidth: 1, opacity: 0.7 } },
            { type: 'circle', shape: { cx: pt[0], cy: pt[1], r: 2.5 }, style: { fill: pinColor, stroke: t.paper, lineWidth: 1 } },
            { type: 'circle', shape: { cx: pt[0], cy: cy, r: R }, style: { fill: pinColor, stroke: t.paper, lineWidth: 1.25 } },
            { type: 'text', x: pt[0], y: cy, style: { text: String(api.value(2)), fill: txt, font: '600 10px ' + t.fontNum, align: 'center', verticalAlign: 'middle' } }
          ]
        };
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Tooltip
   * ------------------------------------------------------------------ */
  function tooltip(ctx, inst, model, pins, ps) {
    var o = ctx.options, fmt = model.fmt;
    ps = ps.filter(function (p) { return model.byId[p.seriesId]; });
    if (!ps.length) return '';
    var idx = function (p) { return model.isCat ? p.dataIndex : p.value[2]; };
    var i0 = idx(ps[0]);
    var xField = ctx.field(ctx.enc.x);
    var title = model.isCat ? (o.xFormat ? RK.format(model.xs[i0], o.xFormat) : model.xs[i0])
      : RK.format(model.xs[i0], o.xFormat || (xField && xField.format) || (model.isTime ? 'dd mmm yyyy' : 'auto'));
    if (model.fIdx > 0 && i0 >= model.fIdx) title += '  ·  ' + (o.forecastLabel || 'Projected');
    var seen = {}, rows = [], total = 0;
    ps.forEach(function (p) {
      var s = model.byId[p.seriesId];
      if (seen[s.key]) return;
      seen[s.key] = 1;
      var i = idx(p), v = s.values[i];
      var txt = RK.format(v, fmt);
      if (o.rebase != null && v != null) txt += '  (' + RK.format(v / o.rebase - 1, DELTA) + ')';
      total += v || 0;
      rows.push({ color: s.solid, label: s.name, value: txt, bold: s.hl });
    });
    if (model.stacked && rows.length > 1) rows.push({ label: 'Total', value: RK.format(total, fmt), bold: true });
    var html = C.tip(title, rows);
    // event pin near the hovered x (within ~8px)
    if (pins.length) {
      var px = inst.convertToPixel({ xAxisIndex: 0 }, model.isCat ? i0 : model.xv[i0]);
      var hits = pins.filter(function (pin) {
        var pp = inst.convertToPixel({ xAxisIndex: 0 }, model.isCat ? pin.i : model.xv[pin.i]);
        return Math.abs(pp - px) <= 8;
      });
      if (hits.length) {
        var e = util.escapeHTML, extra = '';
        hits.forEach(function (pin) {
          extra += '<div class="rk-tip__foot" style="max-width:280px;white-space:normal;border-top:1px solid var(--rk-rule);padding-top:4px;margin-top:6px">' +
            '<b style="color:var(--rk-tooltip-ink)">' + pin.n + '. ' + e(pin.label) + '</b>' +
            (pin.kind ? ' <span style="text-transform:uppercase;letter-spacing:.04em;font-size:10px">· ' + e(pin.kind) + '</span>' : '') +
            '<br>' + e(RK.format(pin.x, pin.dateFmt || 'dd mmm yyyy')) + (pin.detail ? ' — ' + e(pin.detail) : '') + '</div>';
        });
        html = html.slice(0, -6) + extra + '</div>';
      }
    }
    return html;
  }

  /* ------------------------------------------------------------------ *
   * End labels: value tag + name in the right margin, de-collided vertically,
   * with a leader line to the last visible point. Drawn as ECharts graphic elements.
   * ------------------------------------------------------------------ */
  var measureCtx = null;
  function textWidth(str, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(str).width;
  }
  function labelWidth(mode, s, vtxt, t) {
    var w = 0;
    if (mode !== 'name') w += textWidth(vtxt, '600 10.5px ' + t.fontNum) + 10;
    if (mode !== 'value') w += (w ? 5 : 0) + textWidth(s.name, (s.hl ? '600 ' : '400 ') + '11px ' + t.fontSans);
    return w;
  }

  function gridRect(inst) {
    try {
      var g = inst.getModel().getComponent('grid', 0);
      return g && g.coordinateSystem ? g.coordinateSystem.getRect() : null;
    } catch (e) { return null; }
  }

  function layoutEndLabels(inst, ctx, state, mode) {
    var o = ctx.options, t = ctx.theme, model = state.model;
    if (inst.isDisposed() || !model) return;
    var elements = [];
    var keep = {};
    var g = gridRect(inst);
    if (o.endLabels && g && model.series.length) {
      var win = visibleX(inst, model) || fullX(model);
      var items = [];
      model.series.forEach(function (s) {
        if (!isShown(state, s)) return;
        var i = -1;
        for (var j = model.xv.length - 1; j >= 0; j--) {
          if (s.values[j] == null || model.xv[j] > win[1] + 1e-9) continue;
          if (model.xv[j] < win[0] - 1e-9) break;
          i = j; break;
        }
        if (i < 0) return;
        var yv = model.stacked ? (s.base[i] + s.top[i]) / 2 : s.values[i];
        var pt = inst.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [model.isCat ? i : model.xv[i], model.stacked ? s.top[i] : s.values[i]]);
        var py = model.stacked ? inst.convertToPixel({ yAxisIndex: 0 }, yv) : pt[1];
        if (!pt || !util.isNum(pt[0]) || !util.isNum(py)) return;
        items.push({ s: s, i: i, px: pt[0], py: pt[1], y: util.clamp(py, g.y, g.y + g.height) });
      });
      spread(items, 15, g.y - 4, g.y + g.height + 4);
      var lx = g.x + g.width + 8;
      items.forEach(function (it) {
        var s = it.s, id = 'el-' + s.key;
        var vtxt = RK.format(s.values[it.i], model.fmt);
        var rich = {
          v: { backgroundColor: s.color, color: RK.theme.onColor(s.solid, t.ink, '#ffffff'), padding: [2, 4, 1, 4], borderRadius: 2,
               fontSize: 10.5, fontWeight: 600, fontFamily: t.fontNum, lineHeight: 14 },
          n: { color: s.dimmed ? RK.theme.alpha(t.ink2, 0.4) : (s.hl ? t.ink : t.ink2), fontSize: 11, fontWeight: s.hl ? 600 : 400, fontFamily: t.fontSans, padding: [0, 0, 0, 4], lineHeight: 14 }
        };
        var text = o.endLabels === 'value' ? '{v|' + vtxt + '}' : o.endLabels === 'name' ? '{n|' + esc(s.name) + '}' : '{v|' + vtxt + '}{n|' + esc(s.name) + '}';
        if (o.endLabels === 'name') rich.n.color = s.color;
        var needLeader = Math.abs(it.ly - it.py) > 1.5 || lx - it.px > 10;
        var anim = animFor(ctx, mode);
        elements.push(util.merge({ id: id + '-l', type: 'polyline', z: 8, silent: true, invisible: !needLeader,
          shape: { points: [[it.px + 3, it.py], [lx - 6, it.ly], [lx - 2, it.ly]] },
          style: { stroke: s.color, lineWidth: 0.8, fill: null, opacity: 0.8 } }, anim));
        elements.push(util.merge({ id: id + '-d', type: 'circle', z: 9, silent: true,
          shape: { cx: it.px, cy: it.py, r: s.hl ? 3.5 : 3 }, style: { fill: s.color, stroke: t.paper, lineWidth: 1.25 } }, anim));
        elements.push(util.merge({ id: id + '-t', type: 'text', z: 9, silent: true, x: lx, y: it.ly,
          style: { text: text, rich: rich, verticalAlign: 'middle', align: 'left' } }, anim));
        keep[id + '-l'] = keep[id + '-d'] = keep[id + '-t'] = 1;
      });
    }
    state.labelIds.forEach(function (id) { if (!keep[id]) elements.push({ id: id, $action: 'remove' }); });
    state.labelIds = Object.keys(keep);
    var patch = {};
    if (elements.length) patch.graphic = { elements: elements };
    // keep the zoom slider exactly under the plot area (the grid's left edge depends on label widths)
    if (g && state.slider) {
      var l = Math.round(g.x), r = Math.round(inst.getWidth() - g.x - g.width);
      if (state.slider.left !== l || state.slider.right !== r) {
        state.slider = { left: l, right: r };
        patch.dataZoom = [{ id: 'dzs', left: l, right: r }];
      }
    }
    if (patch.graphic || patch.dataZoom) inst.setOption(patch);
  }

  function animFor(ctx, mode) {
    if (!ctx.motion) return {};
    if (mode === 'enter') return { enterFrom: { style: { opacity: 0 } }, enterAnimation: { duration: 350, delay: 850 } };
    if (mode === 'update') return { enterFrom: { style: { opacity: 0 } }, enterAnimation: { duration: 300, delay: 450 }, updateAnimation: { duration: 600 } };
    return { updateAnimation: { duration: 0 } };
  }

  /** Spread label centres so they are >= gap apart, staying close to their anchors (cluster merge). */
  function spread(items, gap, lo, hi) {
    items.sort(function (a, b) { return a.y - b.y; });
    var groups = items.map(function (it) { return { items: [it], sum: it.y }; });
    function top(gr) {
      var size = gr.items.length * gap;
      var c = gr.sum / gr.items.length;
      return util.clamp(c - size / 2, lo, Math.max(lo, hi - size));
    }
    var merged = true;
    while (merged) {
      merged = false;
      for (var k = 1; k < groups.length; k++) {
        var a = groups[k - 1], b = groups[k];
        if (top(a) + a.items.length * gap > top(b) + 1e-6) {
          groups.splice(k - 1, 2, { items: a.items.concat(b.items), sum: a.sum + b.sum });
          merged = true;
          break;
        }
      }
    }
    groups.forEach(function (gr) {
      var y0 = top(gr);
      gr.items.forEach(function (it, j) { it.ly = y0 + gap * (j + 0.5); });
    });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[{}|]/g, ' '); }
})();
