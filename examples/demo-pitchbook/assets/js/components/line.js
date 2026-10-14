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

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'line.projected': '预测', 'line.dateLong': 'yyyy"年"m"月"d"日"', 'line.dateMonth': 'yy"年"m"月"', 'line.dateDay': 'm"月"d"日"'
    });
  }
  /** Caption of the estimate band: options.forecastLabel, in the report locale when left at the default 'Projected'. */
  function forecastText(o) { return o.forecastLabel === 'Projected' ? tr('line.projected', 'Projected') : o.forecastLabel; }
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
      refLines: [],            // [{value, label, color}] horizontal reference lines (default colour: theme ref)
      zoom: 'auto',            // 'auto' (on for time axes) | true | false
      xType: 'auto',           // 'auto' | 'time' | 'category' | 'value'
      xFormat: null,           // x format for tooltips (dates default to the field format / 'dd mmm yyyy')
      format: null,            // value format; defaults to the y field format ('#,##0.0' when rebased)
      yMin: 'auto',            // 'auto' (zero for areas, else fit the data) | 'dataMin' | number
      legend: 'auto'           // 'auto' (off when end labels already name <= 4 series) | true | false
    },
    render: function (ctx) {
      var state = { zoom: null, legendSel: null, labelIds: [], model: null, yAxis: null, raf: 0 };
      var api = C(function (c, inst) { return build(c, inst, state); }, {
        rebuildOnResize: true,     // date-tick density and the end-label margin depend on the plot size
        select: function (p, c, chart) {
          // clicks on the line body carry seriesIndex but no seriesId; generic series fields are scoped by core
          var sm = chart.getModel().getSeriesByIndex(p.seriesIndex);
          var s = state.model && sm && state.model.byId[sm.id];
          return s && c.enc.series && !Array.isArray(c.enc.y) && p.seriesType === 'line' ? { field: c.enc.series, value: s.name } : null;
        }
      })(ctx);
      var inst = api.chart;
      var current = ctx;

      // zoom / legend changes: re-fit the value axis to what is visible, then move the end labels
      var refit = util.rafThrottle(function () {
        var model = state.model;
        if (inst.isDisposed() || !model) return;
        var patch = {};
        var y = yAxisFor(current, state);
        if (!sameAxis(y, state.yAxis)) { state.yAxis = y; patch.yAxis = [{ id: 'y', min: y.min, max: y.max, interval: y.interval }]; }
        if (model.isTime) {
          var tk = dateTicks(windowFromZoom(model, state.zoom), state.plotW);
          if (!state.ticks || tk.key !== state.ticks.key) {
            state.ticks = tk;
            patch.xAxis = [{ id: 'x', axisLabel: tickLabel(tk), axisTick: { customValues: tk.values } }];
          }
        }
        if (patch.yAxis || patch.xAxis) inst.setOption(patch);
        layoutEndLabels(inst, current, state, 'instant');
      });
      inst.on('datazoom', function () {
        var dz = (inst.getOption().dataZoom || [])[0];
        if (dz) state.zoom = { start: dz.start, end: dz.end };
        refit();
      });
      ['legendselectchanged', 'legendselected', 'legendunselected', 'legendselectall', 'legendinverseselect'].forEach(function (ev) {
        inst.on(ev, function (p) { state.legendSel = util.merge({}, p.selected); refit(); });
      });

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
    var xv = xs.map(function (x, i) { return isTime ? toTs(x) : isValue ? +x : i; });

    var fmt = o.format || (o.rebase != null ? '#,##0.0' : data.yFormat) || 'auto';
    var hl = o.highlight;
    var stacked = o.area === 'stacked';
    // stacked areas are parts of a whole -> ordinal ramp; otherwise peers stay clear of the accent2 highlight
    var pal = stacked && data.series.length <= t.ord.length ? t.ord : RK.theme.palette({ n: data.series.length });
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
      var color = isHl ? t.accent2 : pal[pi++];
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
        var fv = isTime ? toTs(o.forecastFrom) : o.forecastFrom;
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

  /** ISO date / Date -> local-time ms (the same parsing RK.format uses), null when unparseable. */
  function toTs(x) { var d = RK.format.toDate(x); return d && !isNaN(d) ? d.getTime() : null; }

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
      var pos = model.isTime ? toTs(x) : (model.isValue ? +x : model.xs.indexOf(x));
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
    var min = util.isNum(o.yMin) ? o.yMin : (o.yMin === 'dataMin' ? ext[0] : Math.floor(lo / step + 1e-9) * step);
    var max = Math.ceil(hi / step - 1e-9) * step;
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
    // a new x extent (e.g. a date filter) resets the zoom window
    var extentKey = n ? model.xs[0] + ':' + model.xs[n - 1] + ':' + n : '';
    if (state.extentKey !== extentKey) { state.zoom = null; state.extentKey = extentKey; }
    var useZoom = o.zoom === 'auto' ? model.isTime && n > 12 : !!o.zoom;
    // 'auto' labels: few points on a category axis; with a highlight only the highlighted series is labelled
    var showLabels = o.labels === 'auto' ? model.isCat && n <= 12 && !model.stacked && (o.highlight != null || model.series.length <= 2) : !!o.labels;
    var showSymbols = o.symbols === 'auto' ? model.isCat && n <= 24 && !model.stacked : !!o.symbols;
    var pins = state.pins = preparePins(ctx, model);
    // direct labels beat a legend: end labels that carry the names replace it for a few series
    var named = o.endLabels === true || o.endLabels === 'name';
    var hasLegend = o.legend !== false && model.series.length > 1 && (o.legend === true || !(named && model.series.length <= 4));
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
    var top = hasLegend ? 34 : (pins.length || (model.fIdx > 0 && o.forecastLabel) ? 24 : 12);
    var bottom = slider ? 34 : 4;
    var h = inst.getHeight ? inst.getHeight() : 300;
    state.gridH = Math.max(80, h - top - bottom - 24);
    state.plotW = Math.max(120, (inst.getWidth ? inst.getWidth() : 600) - right - 56);
    var tk = state.ticks = model.isTime && n ? dateTicks(windowFromZoom(model, state.zoom), state.plotW) : null;

    var y = state.yAxis = yAxisFor(ctx, state);
    // the "Projected" caption sits above the plot: keep it clear of point labels near the top of the band
    var capLift = 0;
    if (showLabels && model.fIdx > 0 && o.forecastLabel && y && util.isNum(y.max) && y.max > y.min) {
      var hiV = null;
      model.series.forEach(function (s) {
        if (!(o.labels === true || o.highlight == null || s.hl)) return;
        for (var j = model.fIdx; j < n; j++) if (util.isNum(s.values[j]) && (hiV == null || s.values[j] > hiV)) hiV = s.values[j];
      });
      if (hiV != null) {
        // a label tops out ~19px above its point; the caption's baseline sits 5px above the plot
        var dPx = (y.max - hiV) / (y.max - y.min) * state.gridH;
        capLift = Math.max(0, Math.ceil(16 - dPx));
        var needTop = 19 + capLift + (hasLegend ? 22 : 0);
        if (top < needTop) { state.gridH -= needTop - top; top = needTop; }
      }
    }

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
      var areaOpacity = model.stacked ? 0.88 : (model.series.length === 1 || s.hl ? 0.12 : 0.07);
      // area: true with a highlight fills the highlighted series only (overlapping fills read as mud)
      var hasArea = o.area && (model.stacked || o.highlight == null || s.hl);
      var lab = showLabels && (o.labels === true || o.highlight == null || s.hl);
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
        areaStyle: hasArea ? { color: model.stacked ? s.color : RK.theme.alpha(s.solid, s.dimmed ? areaOpacity / 3 : areaOpacity), opacity: model.stacked ? areaOpacity : 1 } : undefined,
        label: lab ? C.label(ctx, o.labelFormat || fmt, {
          position: k === 0 && model.series.length > 1 && !model.stacked && isBelow(model, k) ? 'bottom' : 'top',
          distance: 6, fontSize: 10.5, color: s.dimmed ? RK.theme.alpha(t.ink2, 0.3) : (s.hl ? t.ink : t.ink2), fontWeight: s.hl ? 600 : 400
        }) : { show: false },
        labelLayout: lab ? { hideOverlap: true } : undefined,
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
          label: lab ? util.merge({}, base.label, { formatter: function (p) { return p.dataIndex === f - 1 ? '' : RK.format(Array.isArray(p.value) ? p.value[1] : p.value, o.labelFormat || fmt); } }) : base.label
        }));
      } else {
        series.push(util.merge({}, base, { id: s.key, data: xAxisData(s) }));
      }
    });

    // reference lines / estimates band / rebase baseline on a silent helper series (survives legend toggles)
    var marks = markSeries(ctx, model, fmt, capLift);
    if (marks) series.push(marks);
    if (pins.length) series.push(pinSeries(ctx, model, pins, state));

    var xAxis = model.isCat ? {
      id: 'x', type: 'category', data: model.xs, boundaryGap: showLabels || showSymbols,
      axisLabel: { hideOverlap: true, formatter: o.xFormat ? function (v) { return RK.format(v, o.xFormat); } : null },
      axisPointer: { show: true, type: 'line', label: { show: false } }
    } : {
      id: 'x', type: model.isTime ? 'time' : 'value', min: model.isTime ? 'dataMin' : null, max: model.isTime ? 'dataMax' : null,
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: t.axis } },
      axisTick: model.isTime ? { show: true, length: 3, lineStyle: { color: t.axis }, customValues: tk.values } : { show: true },
      axisLabel: model.isTime ? tickLabel(tk) : { formatter: C.tickFmt(o.xFormat || ctx.fmtOf(ctx.enc.x) || 'auto') },
      axisPointer: { show: true, type: 'line', label: { show: false } }
    };

    // core zoom: Ctrl/Cmd + wheel or pinch (plain wheel scrolls the report), drag to pan, slider unless printing
    var z = state.zoom || { start: 0, end: 100 };
    state.slider = slider ? state.slider || { left: 56, right: right } : null;
    var dz = useZoom ? C.zoom(ctx, 'x', slider ? { id: 'dzs', bottom: 6, left: state.slider.left, right: state.slider.right, start: z.start, end: z.end } : null) : [];
    if (dz.length) util.merge(dz[0], { id: 'dzi', start: z.start, end: z.end });

    var legendNames = model.series.map(function (s) { return s.name; });
    return {
      animationDurationUpdate: 600,
      legend: C.legend(ctx, { show: hasLegend, data: legendNames, selected: state.legendSel || undefined }),
      grid: C.grid(ctx, { top: top, bottom: bottom, right: right, left: 4 }),
      tooltip: {
        trigger: 'axis', confine: true,
        axisPointer: { type: 'line', lineStyle: { color: t.axis, type: 'dashed', width: 1 } },
        formatter: function (ps) { return tooltip(ctx, inst, model, pins, ps); }
      },
      xAxis: xAxis,
      yAxis: {
        id: 'y', type: 'value', min: y ? y.min : null, max: y ? y.max : null, interval: y ? y.interval : null,
        axisLabel: { formatter: C.tickFmt(fmt, function () { return state.yAxis && state.yAxis.interval; }) }
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

  /**
   * Pitchbook date ticks for a window [a, b] (ms): month multiples aligned to quarters / halves / years
   * ("Jan-25", "Apr-25"), weeks or days ("5 Aug"), about one label per 100px.
   */
  var DAY = 864e5;
  var STEPS = [[1, 'd'], [2, 'd'], [7, 'w'], [14, 'w'], [1, 'm'], [2, 'm'], [3, 'm'], [6, 'm'], [12, 'm'], [24, 'm'], [60, 'm']];
  function dateTicks(win, width) {
    if (!util.isNum(win[0]) || !util.isNum(win[1])) return { values: [], unit: 'd', key: 'none' };
    var a = win[0], b = win[1], target = util.clamp(Math.floor((width || 600) / 100), 3, 12);
    var days = (b - a) / DAY, step = STEPS[STEPS.length - 1];
    for (var k = 0; k < STEPS.length; k++) {
      var approx = STEPS[k][1] === 'm' ? STEPS[k][0] * 30.44 : STEPS[k][0];
      if (days / approx <= target) { step = STEPS[k]; break; }
    }
    var vals = [], d = new Date(a), n = step[0];
    if (step[1] === 'm') {
      d = new Date(d.getFullYear(), d.getMonth(), 1);
      if (d.getTime() < a) d.setMonth(d.getMonth() + 1);
      while ((d.getMonth() % Math.min(n, 12)) !== 0) d.setMonth(d.getMonth() + 1);
      if (n > 12) while (d.getFullYear() % (n / 12) !== 0) d.setFullYear(d.getFullYear() + 1);
      for (; d.getTime() <= b; d.setMonth(d.getMonth() + n)) vals.push(d.getTime());
    } else {
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (d.getTime() < a) d.setDate(d.getDate() + 1);
      if (step[1] === 'w') while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
      for (; d.getTime() <= b; d.setDate(d.getDate() + n)) vals.push(d.getTime());
    }
    var unit = step[1] === 'm' ? (n >= 12 ? 'y' : 'm') : 'd';
    return { values: vals, unit: unit, key: unit + n + ':' + vals[0] + ':' + vals.length };
  }
  function tickLabel(tk) {
    var f = tk.unit === 'y' ? 'yyyy' : tk.unit === 'm' ? tr('line.dateMonth', 'mmm-yy') : tr('line.dateDay', 'd mmm');
    return { customValues: tk.values, hideOverlap: true, formatter: function (v) { return RK.format(new Date(v), f); } };
  }

  function markSeries(ctx, model, fmt, capLift) {
    var o = ctx.options, t = ctx.theme;
    var lines = (o.refLines || []).map(function (r) {
      var col = RK.theme.resolve(r.color) || t.ref;          // token names ('pos', 'accent2') or literal colours
      return {
        yAxis: r.value, name: r.label || '',
        lineStyle: { color: col, type: r.type || 'dashed', width: 1.25 },
        // label on a paper chip so it stays legible where it crosses the lines
        // text from a function: "{a}", "{b}", "{c}" in a label are never template-substituted
        label: { formatter: refText(r, fmt), position: 'insideStartTop', color: col, fontWeight: 600, fontSize: 10.5,
          backgroundColor: RK.theme.alpha(t.paper, 0.85), padding: [1, 4], borderRadius: 2 }
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
        label: { show: !!o.forecastLabel, position: 'top', distance: 5 + (capLift || 0), color: t.ink3, fontSize: 10.5, fontStyle: 'italic',
          formatter: function () { return String(forecastText(o) || ''); } },
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

  function refText(r, fmt) {
    var text = r.label != null && r.label !== '' ? String(r.label) : RK.format(r.value, fmt);
    return function () { return text; };
  }

  /* ------------------------------------------------------------------ *
   * Event pins (custom series): numbered markers on stems, staggered when close
   * ------------------------------------------------------------------ */
  function pinSeries(ctx, model, pins, state) {
    var t = ctx.theme;
    var pinColor = t.ink2, txt = RK.theme.textOn(pinColor);
    var R = 8.5;
    var xOf = function (i) { return model.isCat ? i : model.xv[i]; };
    return {
      // not clipped: a pin on the last point may reach into the right margin rather than be cut in half
      id: 'events', type: 'custom', name: '__events', z: 6, clip: false, silent: false, tooltip: { show: false },
      encode: { x: 0, y: 1 },
      data: pins.map(function (p) { return [xOf(p.i), p.y, p.n]; }),
      renderItem: function (params, api) {
        var c = params.context;
        var cs = params.coordSys;
        if (!c.pos) {
          c.pos = pins.map(function (p) { return api.coord([xOf(p.i), p.y]); });
          // a pin stands above every visible line near it (not only its own series), so it never hides data
          c.top = pins.map(function (p, k) {
            var px = c.pos[k][0], top = c.pos[k][1], bot = c.pos[k][1];
            [-1, 1].forEach(function (dir) {
              for (var j = dir < 0 ? p.i : p.i + 1; j >= 0 && j < model.xv.length; j += dir) {
                var x = api.coord([xOf(j), 0])[0];
                if (Math.abs(x - px) > R + 3) break;
                model.series.forEach(function (s) {
                  if (!isShown(state, s)) return;
                  var v = model.stacked ? s.top[j] : s.values[j];
                  if (!util.isNum(v)) return;
                  var y = api.coord([xOf(j), v])[1];
                  if (y < top) top = y;
                  if (y > bot) bot = y;
                });
              }
            });
            return [top, bot];
          });
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
        var lift = 14 + c.lv[k] * (2 * R + 4);
        var up = c.top[k][0] - lift - R >= cs.y - 2;
        var cy = up ? c.top[k][0] - lift : c.top[k][1] + lift;
        return {
          type: 'group',
          blur: { style: { opacity: 1 } },      // annotations stay crisp when a line is focused
          children: [
            { type: 'line', shape: { x1: pt[0], y1: pt[1], x2: pt[0], y2: cy + (up ? R : -R) }, style: { stroke: pinColor, lineWidth: 1, opacity: 0.7 }, blur: { style: { opacity: 0.7 } } },
            { type: 'circle', shape: { cx: pt[0], cy: pt[1], r: 2.5 }, style: { fill: pinColor, stroke: t.paper, lineWidth: 1 }, blur: { style: { opacity: 1 } } },
            { type: 'circle', shape: { cx: pt[0], cy: cy, r: R }, style: { fill: pinColor, stroke: t.paper, lineWidth: 1.25 }, blur: { style: { opacity: 1 } } },
            { type: 'text', x: pt[0], y: cy, style: { text: String(api.value(2)), fill: txt, font: '600 11px ' + t.fontNum, align: 'center', verticalAlign: 'middle' }, blur: { style: { opacity: 1 } } }
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
      : RK.format(model.xs[i0], o.xFormat || (xField && xField.format) || (model.isTime ? tr('line.dateLong', 'dd mmm yyyy') : 'auto'));
    if (model.fIdx > 0 && i0 >= model.fIdx) title += '  ·  ' + (o.forecastLabel ? forecastText(o) : tr('line.projected', 'Projected'));
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
    if (model.stacked && rows.length > 1) rows.push({ label: tr('total', 'Total'), value: RK.format(total, fmt), bold: true });
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
          extra += '<div class="rk-tip__foot rk-ln-tip-event">' +
            '<b>' + pin.n + '. ' + e(pin.label) + '</b>' +
            (pin.kind ? ' <span class="rk-ln-tip-kind">' + e(pin.kind) + '</span>' : '') +
            '<br>' + e(RK.format(pin.x, pin.dateFmt || tr('line.dateLong', 'dd mmm yyyy'))) + (pin.detail ? ' — ' + e(pin.detail) : '') + '</div>';
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
  function labelWidth(mode, s, vtxt, t) {
    var w = 0;
    if (mode !== 'name') w += C.measure(vtxt, '600 10.5px ' + t.fontNum) + 10;
    if (mode !== 'value') w += (w ? 5 : 0) + C.measure(s.name, (s.hl ? '600 ' : '400 ') + '11px ' + t.fontSans);
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
      // label centres >= 15px apart, label boxes inside the plot height (+4px)
      var ly = C.spreadLabels(items.map(function (it) { return it.y; }), 15, g.y + 3.5, g.y + g.height - 3.5);
      items.forEach(function (it, k) { it.ly = ly[k]; });
      var lx = g.x + g.width + 8;
      items.forEach(function (it) {
        var s = it.s, id = 'el-' + s.key;
        var vtxt = RK.format(s.values[it.i], model.fmt);
        var rich = {
          // graphic elements take zrender style names: fill (not color)
          v: { backgroundColor: s.color, fill: RK.theme.textOn(s.solid), padding: [2, 4, 1, 4], borderRadius: 2,
               fontSize: 10.5, fontWeight: 600, fontFamily: t.fontNum, lineHeight: 14 },
          n: { fill: s.dimmed ? RK.theme.alpha(t.ink2, 0.4) : (s.hl ? t.ink : t.ink2), fontSize: 11, fontWeight: s.hl ? 600 : 400, fontFamily: t.fontSans, padding: [0, 0, 0, 4], lineHeight: 14 }
        };
        // data strings never reach the rich-text markup unescaped ("{v|...}" in a name would restyle it)
        var vs = C.richSafe(vtxt), ns = C.richSafe(s.name);
        var text = o.endLabels === 'value' ? '{v|' + vs + '}' : o.endLabels === 'name' ? '{n|' + ns + '}' : '{v|' + vs + '}{n|' + ns + '}';
        // names in the series colour must still read as text (>= 4.5:1): the target uses accent2Ink
        if (o.endLabels === 'name') rich.n.fill = s.dimmed ? s.color : (s.hl ? t.accent2Ink : textInk(s.solid, t));
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

  /** The series colour, deepened toward the ink until it reads as text on the paper (WCAG 4.5:1). */
  function textInk(col, t) {
    var c = col;
    for (var k = 1; k <= 6 && RK.theme.contrast(c, t.paper) < 4.5; k++) c = RK.theme.mix(col, t.ink, 0.15 * k);
    return c;
  }

  function animFor(ctx, mode) {
    if (!ctx.motion) return {};
    if (mode === 'enter') return { enterFrom: { style: { opacity: 0 } }, enterAnimation: { duration: 350, delay: 850 } };
    if (mode === 'update') return { enterFrom: { style: { opacity: 0 } }, enterAnimation: { duration: 300, delay: 450 }, updateAnimation: { duration: 600 } };
    return { updateAnimation: { duration: 0 } };
  }

})();
