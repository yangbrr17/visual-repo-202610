/*!
 * RK component: price-volume — share price line (or light area) over a volume sub-panel.
 * Two aligned grids with one shared zoom, moving averages, rolling VWAP, 52-week high / low,
 * numbered event pins (eventsData), current-price tag, crosshair tooltip and a date-range selector.
 * Data: one row per trading day (date, close, volume; high / low improve the 52-week range and VWAP).
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util, h = util.h;
  var DELTA = '+0.0%;-0.0%;0.0%';
  var DAY = 864e5;
  var RANGES = [['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['2y', '2Y'], ['5y', '5Y'], ['all', 'All']];

  RK.component({
    id: 'price-volume',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'date', close: 'close', volume: 'volume', high: 'high', low: 'low' },
      area: true,              // light fill under the price line
      ma: [50, 200],           // simple moving averages in trading days; [] = none
      vwap: false,             // false | true (20-day) | number of days — rolling VWAP line
      range52w: 'lines',       // 'lines' | 'band' | false — 52-week high / low (high / low fields, else close)
      lastPrice: true,         // current price tag on the right axis + dotted guide
      refLines: [],            // [{value, label, color}] e.g. offer price, unaffected price (default colour: theme ref)
      eventsData: null,        // dataset id with events {date, label, kind, detail} -> numbered pins
      eventsEncode: { date: 'date', label: 'label', kind: 'kind', detail: 'detail' },
      range: 'all',            // initial window: 'all' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | days
      rangeSelector: true,     // 1M / 3M / 6M / YTD / 1Y / All buttons (hidden in print)
      volumeShare: 0.24,       // share of the plot height given to the volume panel
      format: null,            // price format (defaults to the close field format)
      volumeFormat: null,      // volume format for the tooltip (defaults to the volume field format)
      zoom: true,
      legend: true
    },
    render: function (ctx) {
      var state = { zoom: null, legendSel: null, model: null, axes: null, extentKey: null };
      // grid heights and date ticks are laid out in pixels: rebuild on resize
      var api = C(function (c, inst) { return build(c, inst, state); }, { rebuildOnResize: true })(ctx);
      var inst = api.chart;
      var current = ctx;
      var selector = rangeSelector(ctx, state, inst);

      var refit = util.rafThrottle(function () {
        if (inst.isDisposed() || !state.model || !state.model.n) return;
        var patch = {};
        var ax = axesFor(current, state);
        if (ax && !sameAxes(ax, state.axes)) {
          state.axes = ax;
          patch.yAxis = [
            { id: 'yp', min: ax.p.min, max: ax.p.max, interval: ax.p.interval },
            { id: 'yv', min: 0, max: ax.v.max, interval: ax.v.interval }
          ];
        } else if (ax) state.axes.first = ax.first;
        var tk = dateTicks(windowOf(state.model, state.zoom), state.plotW);
        if (tk.key !== state.ticks.key) {
          state.ticks = tk;
          patch.xAxis = [{ id: 'xp', axisLabel: tickLabel(tk), axisTick: { customValues: tk.values } },
            { id: 'xv', axisLabel: tickLabel(tk), axisTick: { customValues: tk.values } }];
        }
        if (patch.yAxis || patch.xAxis) inst.setOption(patch);
      });
      inst.on('datazoom', function () {
        var dz = (inst.getOption().dataZoom || [])[0];
        if (dz) state.zoom = { start: dz.start, end: dz.end };
        selector.sync();
        refit();
      });
      ['legendselectchanged', 'legendselected', 'legendunselected', 'legendselectall', 'legendinverseselect'].forEach(function (ev) {
        inst.on(ev, function (p) { state.legendSel = util.merge({}, p.selected); refit(); });
      });
      selector.sync();

      return {
        chart: inst,
        update: function (c) { current = c; api.update(c); selector.sync(); },
        resize: api.resize,
        destroy: function () { selector.remove(); api.destroy(); },
        exportImage: api.exportImage,
        exportSVG: api.exportSVG
      };
    }
  });

  /* ------------------------------------------------------------------ *
   * Data model
   * ------------------------------------------------------------------ */
  function prepare(ctx) {
    var o = ctx.options, enc = ctx.enc;
    var rows = ctx.rows.filter(function (r) { return r[enc.x] != null && r[enc.close] != null; }).slice();
    rows.sort(function (a, b) { return a[enc.x] < b[enc.x] ? -1 : a[enc.x] > b[enc.x] ? 1 : 0; });
    var xs = rows.map(function (r) { return r[enc.x]; });
    var xv = xs.map(function (x) { var d = RK.format.toDate(x); return d ? d.getTime() : null; });
    var close = rows.map(function (r) { return r[enc.close]; });
    var vol = enc.volume ? rows.map(function (r) { return r[enc.volume]; }) : [];
    var hi = rows.map(function (r) { return enc.high && r[enc.high] != null ? r[enc.high] : r[enc.close]; });
    var lo = rows.map(function (r) { return enc.low && r[enc.low] != null ? r[enc.low] : r[enc.close]; });
    var n = rows.length;

    var mas = (o.ma || []).filter(function (d) { return util.isNum(d) && d > 1 && d < n; }).map(function (d) {
      return { key: 'ma' + d, name: d + '-day MA', days: d, values: sma(close, d) };
    });
    var vw = null;
    if (o.vwap && vol.length) {
      var vd = o.vwap === true ? 20 : +o.vwap;
      vw = { key: 'vwap', name: vd + '-day VWAP', days: vd, values: rollingVwap(close, hi, lo, vol, vd) };
    }

    // 52-week high / low over the last 364 days
    var r52 = null;
    if (o.range52w && n) {
      var from = xv[n - 1] - 364 * DAY, i0 = n - 1;
      while (i0 > 0 && xv[i0 - 1] >= from) i0--;
      var hiV = -Infinity, loV = Infinity, hiI = i0, loI = i0;
      for (var i = i0; i < n; i++) {
        if (hi[i] > hiV) { hiV = hi[i]; hiI = i; }
        if (lo[i] < loV) { loV = lo[i]; loI = i; }
      }
      r52 = { from: xv[i0], to: xv[n - 1], high: hiV, low: loV, hiI: hiI, loI: loI };
    }
    return {
      rows: rows, xs: xs, xv: xv, close: close, vol: vol, n: n, mas: mas, vwap: vw, r52: r52,
      fmt: o.format || ctx.fmtOf(enc.close) || '#,##0.00',
      vfmt: o.volumeFormat || ctx.fmtOf(enc.volume) || '#,##0'
    };
  }

  function sma(v, d) {
    var out = new Array(v.length), sum = 0, cnt = 0;
    for (var i = 0; i < v.length; i++) {
      if (v[i] != null) { sum += v[i]; cnt++; }
      if (i >= d && v[i - d] != null) { sum -= v[i - d]; cnt--; }
      out[i] = i >= d - 1 && cnt === d ? sum / d : null;
    }
    return out;
  }

  function rollingVwap(c, hi, lo, vol, d) {
    var out = new Array(c.length), pv = 0, vv = 0;
    for (var i = 0; i < c.length; i++) {
      var tp = (hi[i] + lo[i] + c[i]) / 3;
      pv += tp * (vol[i] || 0); vv += vol[i] || 0;
      if (i >= d) { var tq = (hi[i - d] + lo[i - d] + c[i - d]) / 3; pv -= tq * (vol[i - d] || 0); vv -= vol[i - d] || 0; }
      out[i] = i >= d - 1 && vv > 0 ? pv / vv : null;
    }
    return out;
  }

  /** Events dataset -> pins on the close line (nearest trading day). */
  function preparePins(ctx, m) {
    var o = ctx.options;
    if (!o.eventsData || !RK.data.get(o.eventsData) || !m.n) return [];
    var ee = util.merge({ date: 'date', label: 'label', kind: 'kind', detail: 'detail' }, o.eventsEncode || {});
    var dateFmt = (RK.data.get(o.eventsData).field(ee.date) || {}).format;
    var pins = [];
    ctx.view(o.eventsData).forEach(function (r) {
      var d = RK.format.toDate(r[ee.date]);
      if (!d) return;
      var ts = d.getTime();
      if (ts < m.xv[0] - 4 * DAY || ts > m.xv[m.n - 1] + 4 * DAY) return;
      var best = nearest(m.xv, ts);
      pins.push({ i: best, x: r[ee.date], y: m.close[best], label: r[ee.label], kind: r[ee.kind], detail: r[ee.detail], dateFmt: dateFmt });
    });
    pins.sort(function (a, b) { return a.i - b.i; });
    pins.forEach(function (p, k) { p.n = k + 1; });
    return pins;
  }

  function nearest(xv, ts) {
    var lo = 0, hi = xv.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xv[mid] < ts) lo = mid; else hi = mid; }
    return Math.abs(xv[lo] - ts) <= Math.abs(xv[hi] - ts) ? lo : hi;
  }

  /* ------------------------------------------------------------------ *
   * Window + axis ranges (value axes re-fit to the visible dates)
   * ------------------------------------------------------------------ */
  function rangeStart(lastTs, key) {
    var d = new Date(lastTs);
    if (util.isNum(key)) return lastTs - key * DAY;
    switch (String(key).toLowerCase()) {
      case '1m': d.setMonth(d.getMonth() - 1); break;
      case '3m': d.setMonth(d.getMonth() - 3); break;
      case '6m': d.setMonth(d.getMonth() - 6); break;
      case 'ytd': d = new Date(d.getFullYear(), 0, 1); break;
      case '1y': d.setFullYear(d.getFullYear() - 1); break;
      case '2y': d.setFullYear(d.getFullYear() - 2); break;
      case '5y': d.setFullYear(d.getFullYear() - 5); break;
      default: return null;
    }
    return d.getTime();
  }
  function zoomFor(m, key) {
    var s = rangeStart(m.xv[m.n - 1], key);
    if (s == null || s <= m.xv[0]) return { start: 0, end: 100 };
    return { start: (s - m.xv[0]) / (m.xv[m.n - 1] - m.xv[0]) * 100, end: 100 };
  }
  function windowOf(m, zoom) {
    var a = m.xv[0], b = m.xv[m.n - 1], z = zoom || { start: 0, end: 100 };
    return [a + (b - a) * z.start / 100, a + (b - a) * z.end / 100];
  }

  function shown(state, name) { return !state.legendSel || state.legendSel[name] !== false; }

  function axesFor(ctx, state) {
    var m = state.model, o = ctx.options;
    if (!m || !m.n) return null;
    var win = windowOf(m, state.zoom);
    var pv = [], vv = [];
    var lines = [m.close].concat(m.mas.filter(function (s) { return shown(state, s.name); }).map(function (s) { return s.values; }));
    if (m.vwap && shown(state, m.vwap.name)) lines.push(m.vwap.values);
    var first = -1;
    for (var i = 0; i < m.n; i++) {
      if (m.xv[i] < win[0] - DAY / 2 || m.xv[i] > win[1] + DAY / 2) continue;
      if (first < 0) first = i;
      lines.forEach(function (arr) { if (arr[i] != null) pv.push(arr[i]); });
      if (m.vol[i] != null) vv.push(m.vol[i]);
    }
    if (!pv.length) return null;
    (o.refLines || []).forEach(function (r) { if (util.isNum(r.value)) pv.push(r.value); });
    // 52-week lines join the range when the window covers most of the 52 weeks
    if (m.r52 && first >= 0 && m.xv[first] <= m.r52.from + 120 * DAY) pv.push(m.r52.high, m.r52.low);
    var ext = util.extent(pv);
    if (state.pins && state.pins.length) ext[1] += (ext[1] - ext[0]) * 0.16;
    var gh = state.priceH || 220;
    var step = util.niceStep((ext[1] - ext[0]) || Math.abs(ext[1]) * 0.1 || 1, util.clamp(Math.round(gh / 50), 3, 7));
    var p = { min: rnd(Math.floor(ext[0] / step + 1e-9) * step), max: rnd(Math.ceil(ext[1] / step - 1e-9) * step), interval: step };
    if (p.min === p.max) p.max = rnd(p.max + step);
    var vmax = vv.length ? Math.max.apply(null, vv) : 1;
    var vstep = util.niceStep(vmax || 1, util.clamp(Math.round((state.volH || 60) / 34), 1, 3));
    var v = { max: rnd(Math.ceil(vmax / vstep) * vstep) || 1, interval: vstep };
    return { p: p, v: v, first: first };
  }
  function rnd(v) { return Math.round(v * 1e10) / 1e10; }
  function sameAxes(a, b) {
    return a && b && a.p.min === b.p.min && a.p.max === b.p.max && a.p.interval === b.p.interval && a.v.max === b.v.max;
  }

  /* ------------------------------------------------------------------ *
   * Option builder
   * ------------------------------------------------------------------ */
  function build(ctx, inst, state) {
    var o = ctx.options, t = ctx.theme;
    var m = state.model = prepare(ctx);
    var fmt = m.fmt;
    if (!m.n) return { series: [] };
    var pins = state.pins = preparePins(ctx, m);
    // a new date extent (e.g. a date filter) resets the window to options.range
    var key = m.xv[0] + ':' + m.xv[m.n - 1];
    if (state.extentKey !== key) { state.zoom = zoomFor(m, o.range); state.extentKey = key; }

    var useZoom = o.zoom !== false && m.n > 20;
    var slider = useZoom && o.zoomSlider !== false && !ctx.print;
    var hasLegend = o.legend !== false;
    var H = inst.getHeight();
    var hasSelector = o.rangeSelector && !ctx.print && useZoom && m.n >= 30;
    var top = hasLegend || hasSelector ? 34 : 14, gap = 16, xLab = 22, bottom = slider ? 32 : 4;
    var avail = Math.max(120, H - top - gap - xLab - bottom);
    var hasVol = m.vol.length > 0;
    var volH = state.volH = hasVol ? Math.max(36, Math.round(avail * util.clamp(o.volumeShare || 0.24, 0.1, 0.5))) : 0;
    var priceH = state.priceH = avail - volH - (hasVol ? 0 : -gap);

    var ax = state.axes = axesFor(ctx, state);
    // fixed left margin so both panels share one x scale
    var pAxisFmt = tickFmt(fmt, function () { return state.axes && state.axes.p.interval; });
    var font = '11px ' + t.fontNum;
    var left = Math.ceil(Math.max(
      C.measure(pAxisFmt(ax.p.max), font), C.measure(pAxisFmt(ax.p.min), font),
      C.measure(RK.format(-ax.p.max, fmt), font) * 0.92,
      hasVol ? C.measure(RK.format(ax.v.max, 'auto'), font) : 0)) + 14;
    var right = o.lastPrice ? Math.ceil(C.measure(RK.format(m.close[m.n - 1], fmt), '600 10.5px ' + t.fontNum) + 18) : 14;
    state.plotW = Math.max(120, inst.getWidth() - left - right);
    var tk = state.ticks = dateTicks(windowOf(m, state.zoom), state.plotW);

    var priceColor = t.accent;
    // MA / VWAP overlays stay clear of the price line, the accent2 highlight, the 52-week (pos / neg) and reference lines
    var pal = RK.theme.palette({ exclude: [priceColor, t.accent2, t.pos, t.neg, t.ref], minDistance: 110, n: m.mas.length + 1 });
    var series = [];
    var sel = state.legendSel;

    // price
    series.push({
      id: 'price', name: ctx.title(ctx.enc.close) || 'Close', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
      showSymbol: false, symbol: 'circle', symbolSize: 6, z: 4,
      lineStyle: { color: priceColor, width: 1.75 }, itemStyle: { color: priceColor, borderColor: t.paper, borderWidth: 1.5 },
      areaStyle: o.area ? { color: RK.theme.alpha(priceColor, t.dark ? 0.16 : 0.08), origin: 'start' } : undefined,
      emphasis: { disabled: true },
      animationDuration: 1100,
      data: m.close.map(function (v, i) { return [m.xv[i], v, i]; })
    });
    m.mas.forEach(function (s, k) {
      s.color = pal[k];
      series.push(lineSeries(s, s.color, k === 1 ? [4, 3] : 'solid', m));
    });
    if (m.vwap) {
      m.vwap.color = pal[m.mas.length];
      series.push(lineSeries(m.vwap, m.vwap.color, [1.5, 2.5], m));
    }
    var marks = markSeries(ctx, m, priceColor);
    if (marks) series.push(marks);
    if (pins.length) series.push(pinSeries(ctx, m, pins));
    if (hasVol) {
      series.push({
        id: 'volume', name: ctx.title(ctx.enc.volume) || 'Volume', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        barMaxWidth: 8, barMinWidth: 1, barCategoryGap: '30%', large: m.n > 600,
        itemStyle: { color: RK.theme.alpha(t.ink3, t.dark ? 0.55 : 0.42) },
        emphasis: { itemStyle: { color: RK.theme.alpha(priceColor, 0.7) } },
        animationDuration: 700,
        data: m.vol.map(function (v, i) { return [m.xv[i], v, i]; })
      });
    }

    var legendData = [series[0].name].concat(m.mas.map(function (s) { return s.name; }), m.vwap ? [m.vwap.name] : [],
      hasVol ? [ctx.title(ctx.enc.volume) || 'Volume'] : []);

    var xBase = {
      type: 'time', min: 'dataMin', max: 'dataMax', splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: t.axis } },
      axisTick: { show: true, length: 3, lineStyle: { color: t.axis }, customValues: tk.values },
      axisPointer: { label: { formatter: function (p) { return RK.format(new Date(p.value), 'dd mmm yyyy'); } } }
    };
    // core zoom (Ctrl/Cmd + wheel or pinch, drag to pan, slider unless printing) shared by both panels
    var z = state.zoom, link = { xAxisIndex: [0, 1], start: z.start, end: z.end };
    var dz = useZoom ? C.zoom(ctx, 'x', util.merge({ id: 'dzs', left: left, right: right, bottom: 6 }, link)) : [];
    if (dz.length) util.merge(dz[0], { id: 'dzi' }, link);

    return {
      animationDurationUpdate: 500,
      legend: C.legend(ctx, { show: hasLegend, data: legendData, right: o.rangeSelector && !ctx.print ? 250 : 0, selected: sel || undefined }),
      axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: t.ink2, color: t.paper, fontSize: 10.5, padding: [3, 5], fontFamily: t.fontNum } },
      grid: [
        { id: 'gp', left: left, right: right, top: top, height: priceH, containLabel: false },
        { id: 'gv', left: left, right: right, top: top + priceH + gap, height: volH, containLabel: false, show: false }
      ],
      tooltip: {
        trigger: 'axis', confine: true,
        axisPointer: { type: 'cross', crossStyle: { color: t.axis, width: 1, type: 'dashed' }, lineStyle: { color: t.axis, type: 'dashed' } },
        formatter: function (ps) { return tooltip(ctx, inst, state, ps); }
      },
      xAxis: [
        util.merge({}, xBase, { id: 'xp', gridIndex: 0, axisLabel: util.merge({ show: !hasVol }, tickLabel(tk)), axisTick: { show: !hasVol },
          axisPointer: { label: { show: !hasVol } } }),
        util.merge({}, xBase, { id: 'xv', gridIndex: 1, show: hasVol, axisLabel: tickLabel(tk) })
      ],
      yAxis: [
        { id: 'yp', gridIndex: 0, type: 'value', min: ax.p.min, max: ax.p.max, interval: ax.p.interval,
          axisLabel: { formatter: pAxisFmt }, axisPointer: { label: { formatter: function (p) { return RK.format(p.value, fmt); } } } },
        { id: 'yv', gridIndex: 1, type: 'value', min: 0, max: ax.v.max, interval: ax.v.interval, show: hasVol,
          splitLine: { show: true, lineStyle: { color: t.grid } },
          axisLabel: { formatter: function (v) { return v === 0 ? '' : RK.format(v, 'auto'); } },
          axisPointer: { label: { formatter: function (p) { return RK.format(p.value, 'auto'); } } } }
      ],
      dataZoom: dz,
      series: series
    };
  }

  function lineSeries(s, color, dash, m) {
    var data = [];
    s.values.forEach(function (v, i) { if (v != null) data.push([m.xv[i], v, i]); });
    return {
      id: s.key, name: s.name, type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, symbol: 'circle', symbolSize: 5, z: 3,
      lineStyle: { color: color, width: 1.25, type: dash }, itemStyle: { color: color }, emphasis: { disabled: true },
      animationDuration: 1100, data: data
    };
  }

  /** Reference lines, 52-week range and current price on a silent helper series. */
  function markSeries(ctx, m, priceColor) {
    var o = ctx.options, t = ctx.theme, fmt = m.fmt;
    var chip = RK.theme.alpha(t.paper, 0.85);       // label background: legible where it crosses the line
    var lines = [], area = null;
    (o.refLines || []).forEach(function (r) {
      var col = RK.theme.resolve(r.color) || t.ref;          // token names ('pos', 'accent2') or literal colours
      lines.push({ yAxis: r.value, lineStyle: { color: col, type: r.type || 'dashed', width: 1.25 },
        label: { formatter: r.label || RK.format(r.value, fmt), position: 'insideStartTop', color: col, fontWeight: 600, fontSize: 10.5, backgroundColor: chip, padding: [1, 4], borderRadius: 2 } });
    });
    if (m.r52 && o.range52w === 'band') {
      area = { silent: true, itemStyle: { color: RK.theme.alpha(t.accent3 || t.accent, t.dark ? 0.12 : 0.07) },
        label: { show: true, position: 'insideTopLeft', color: t.ink3, fontSize: 10.5,
          formatter: '52-week range ' + RK.format(m.r52.low, fmt) + ' – ' + RK.format(m.r52.high, fmt) },
        data: [[{ xAxis: m.r52.from, yAxis: m.r52.low }, { xAxis: m.r52.to, yAxis: m.r52.high }]] };
    } else if (m.r52 && o.range52w) {
      lines.push({ yAxis: m.r52.high, lineStyle: { color: t.pos, type: [4, 3], width: 1 },
        label: { formatter: '52-wk high ' + RK.format(m.r52.high, fmt), position: 'insideStartTop', color: t.pos, fontSize: 10.5, backgroundColor: chip, padding: [1, 4], borderRadius: 2 } });
      lines.push({ yAxis: m.r52.low, lineStyle: { color: t.neg, type: [4, 3], width: 1 },
        label: { formatter: '52-wk low ' + RK.format(m.r52.low, fmt), position: 'insideStartBottom', color: t.neg, fontSize: 10.5, backgroundColor: chip, padding: [1, 4], borderRadius: 2 } });
    }
    if (o.lastPrice) {
      var last = m.close[m.n - 1];
      lines.push({ yAxis: last, lineStyle: { color: priceColor, type: [1.5, 2.5], width: 1, opacity: 0.8 },
        label: { formatter: RK.format(last, fmt), position: 'end', distance: 4, backgroundColor: priceColor,
          color: RK.theme.textOn(priceColor), padding: [3, 4, 2, 4], borderRadius: 2, fontWeight: 600, fontSize: 10.5, fontFamily: t.fontNum } });
    }
    if (!lines.length && !area) return null;
    return {
      id: 'marks', type: 'line', name: '__marks', xAxisIndex: 0, yAxisIndex: 0, data: [], silent: true, tooltip: { show: false }, clip: true,
      markLine: lines.length ? { silent: true, symbol: ['none', 'none'], animation: false, data: lines } : undefined,
      markArea: area || undefined
    };
  }

  /** Numbered pins on stems; staggered vertically when they would touch. */
  function pinSeries(ctx, m, pins) {
    var t = ctx.theme, pinColor = t.ink2, txt = RK.theme.textOn(pinColor), R = 8;
    return {
      id: 'events', type: 'custom', name: '__events', xAxisIndex: 0, yAxisIndex: 0, z: 6, clip: true, tooltip: { show: false },
      encode: { x: 0, y: 1 },
      data: pins.map(function (p) { return [m.xv[p.i], p.y, p.n]; }),
      renderItem: function (params, api) {
        var c = params.context, cs = params.coordSys;
        if (!c.pos) {
          c.pos = pins.map(function (p) { return api.coord([m.xv[p.i], p.y]); });
          c.lv = [];
          c.pos.forEach(function (pt, k) {
            var used = {};
            for (var j = 0; j < k; j++) if (Math.abs(c.pos[j][0] - pt[0]) < 2 * R + 3) used[c.lv[j]] = 1;
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
        return { type: 'group', children: [
          { type: 'line', shape: { x1: pt[0], y1: pt[1], x2: pt[0], y2: cy + (up ? R : -R) }, style: { stroke: pinColor, lineWidth: 1, opacity: 0.7 } },
          { type: 'circle', shape: { cx: pt[0], cy: pt[1], r: 2.5 }, style: { fill: pinColor, stroke: t.paper, lineWidth: 1 } },
          { type: 'circle', shape: { cx: pt[0], cy: cy, r: R }, style: { fill: pinColor, stroke: t.paper, lineWidth: 1.25 } },
          { type: 'text', x: pt[0], y: cy, style: { text: String(api.value(2)), fill: txt, font: '600 10px ' + t.fontNum, align: 'center', verticalAlign: 'middle' } }
        ] };
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Tooltip: date, close, 1-day change, change since the window start, volume, MAs, VWAP, events
   * ------------------------------------------------------------------ */
  function tooltip(ctx, inst, state, ps) {
    var m = state.model, fmt = m.fmt, t = ctx.theme;
    var p0 = ps.filter(function (p) { return (p.seriesId === 'price' || p.seriesId === 'volume') && Array.isArray(p.value); })[0];
    if (!p0 || m.close[p0.value[2]] == null) return '';
    var i = p0.value[2];
    var c = m.close[i], prev = i > 0 ? m.close[i - 1] : null;
    var rows = [{ color: t.accent, label: ctx.title(ctx.enc.close) || 'Close', value: RK.format(c, fmt), bold: true }];
    rows.push({ label: 'Change (1 day)', value: prev ? RK.format(c / prev - 1, DELTA) : 'n.a.' });
    var first = state.axes && state.axes.first;
    if (first != null && first >= 0 && first < i) rows.push({ label: 'Since ' + RK.format(m.xs[first], 'dd mmm yy'), value: RK.format(c / m.close[first] - 1, DELTA) });
    if (m.vol.length) rows.push({ color: RK.theme.alpha(t.ink3, 0.6), label: ctx.title(ctx.enc.volume) || 'Volume', value: RK.format(m.vol[i], m.vfmt) });
    m.mas.concat(m.vwap ? [m.vwap] : []).forEach(function (s) {
      if (shown(state, s.name)) rows.push({ color: s.color, label: s.name, value: RK.format(s.values[i], fmt) });
    });
    var html = C.tip(RK.format(m.xs[i], (ctx.field(ctx.enc.x) || {}).format || 'dd mmm yyyy'), rows);
    var pins = state.pins || [];
    if (pins.length) {
      var px = inst.convertToPixel({ xAxisIndex: 0 }, m.xv[i]);
      var hits = pins.filter(function (pin) { return Math.abs(inst.convertToPixel({ xAxisIndex: 0 }, m.xv[pin.i]) - px) <= 8; });
      if (hits.length) html = html.slice(0, -6) + hits.map(eventHTML).join('') + '</div>';
    }
    return html;
  }

  function eventHTML(pin) {
    var e = util.escapeHTML;
    return '<div class="rk-tip__foot rk-pv-tip-event">' +
      '<b>' + pin.n + '. ' + e(pin.label) + '</b>' + (pin.kind ? ' <span class="rk-pv-tip-kind">' + e(pin.kind) + '</span>' : '') +
      '<br>' + e(RK.format(pin.x, pin.dateFmt || 'dd mmm yyyy')) + (pin.detail ? ' — ' + e(pin.detail) : '') + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * Range selector (DOM overlay, top-right)
   * ------------------------------------------------------------------ */
  function rangeSelector(ctx, state, inst) {
    var o = ctx.options;
    var noop = { sync: function () {}, remove: function () {} };
    var m = state.model;
    if (!o.rangeSelector || ctx.print || !m || m.n < 30 || o.zoom === false) return noop;
    var span = m.xv[m.n - 1] - m.xv[0];
    var keys = Array.isArray(o.rangeSelector) ? o.rangeSelector.map(function (k) { return String(k).toLowerCase(); }) : null;
    var items = RANGES.filter(function (r) {
      if (keys && keys.indexOf(r[0]) < 0) return false;
      if (r[0] === 'all') return true;
      var s = rangeStart(m.xv[m.n - 1], r[0]);
      return s != null && m.xv[m.n - 1] - s < span * 0.98;
    });
    // narrow blocks keep the essential buttons only
    var w = ctx.el.clientWidth || 600;
    var keepNarrow = w < 340 ? ['3m', '1y', 'all'] : w < 480 ? ['1m', '3m', '6m', '1y', 'all'] : null;
    if (keepNarrow && !keys) items = items.filter(function (r) { return keepNarrow.indexOf(r[0]) >= 0; });
    var btns = {};
    var bar = h('div.rk-seg.rk-pv-range.rk-noprint', { role: 'group', 'aria-label': 'Date range' }, items.map(function (r) {
      var b = h('button', { type: 'button', 'aria-pressed': 'false', on: { click: function () {
        var z = zoomFor(state.model, r[0]);
        inst.dispatchAction({ type: 'dataZoom', start: z.start, end: z.end });
      } } }, r[1]);
      btns[r[0]] = b;
      return b;
    }));
    ctx.el.appendChild(bar);
    return {
      sync: function () {
        var z = state.zoom || { start: 0, end: 100 };
        items.forEach(function (r) {
          var w = zoomFor(state.model, r[0]);
          var on = Math.abs(w.start - z.start) < 0.6 && Math.abs(w.end - z.end) < 0.6;
          btns[r[0]].classList.toggle('is-on', on);
          btns[r[0]].setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      },
      remove: function () { bar.remove(); }
    };
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  /**
   * Axis tick formatter (house style: no decimals when the tick step is whole at display precision,
   * "$6,000" not "$6,000.0", "20%" not "20.0%"). step: number, function returning the live step,
   * or an array of tick values; null decides per value.
   */
  function tickFmt(code, step) {
    code = String(RK.format.presets[code] || code || 'auto');
    var trimmed = code.replace(/([0#])\.[0#]+/g, '$1');
    function num(v, c) { return parseFloat(RK.format(v, c).replace(/[^\d.\-]/g, '')); }
    function whole(v) { return num(v, code) === num(v, trimmed); }
    return function (v) {
      var s = typeof step === 'function' ? step() : step;
      var ok = trimmed !== code && (Array.isArray(s) ? s.every(whole) : whole(s != null ? s : v));
      return RK.format(v, ok ? trimmed : code);
    };
  }

  /**
   * Pitchbook date ticks for a window [a, b] (ms): month multiples aligned to quarters / halves / years
   * ("Jan-25", "Apr-25"), weeks or days ("5 Aug"), about one label per 80px.
   */
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
    var f = tk.unit === 'y' ? 'yyyy' : tk.unit === 'm' ? 'mmm-yy' : 'd mmm';
    return { customValues: tk.values, hideOverlap: true, formatter: function (v) { return RK.format(new Date(v), f); } };
  }
})();
