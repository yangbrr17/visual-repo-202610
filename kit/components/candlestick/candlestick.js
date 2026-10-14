/*!
 * RK component: candlestick — daily OHLC candles over an up / down coloured volume panel,
 * with moving averages, numbered event pins (eventsData), last-close tag, crosshair tooltip
 * (OHLC + change %), a shared zoom that opens on the last ~6 months and a date-range selector.
 * Trading days sit on a category axis, so weekends and holidays leave no gaps.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util, h = util.h;
  var DELTA = '+0.0%;-0.0%;0.0%';
  var DAY = 864e5;
  var RANGES = [['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['2y', '2Y'], ['5y', '5Y'], ['all', 'All']];

  RK.component({
    id: 'candlestick',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'date', open: 'open', high: 'high', low: 'low', close: 'close', volume: 'volume' },
      ma: [20, 50],            // simple moving averages of the close, in trading days; [] = none
      volume: true,            // volume panel (bars coloured by the day's direction)
      lastPrice: true,         // last close tag on the right axis (coloured by the day's move)
      refLines: [],            // [{value, label, color}] horizontal price lines (default colour: theme ref)
      eventsData: null,        // dataset id with events {date, label, kind, detail} -> numbered pins above the candle
      eventsEncode: { date: 'date', label: 'label', kind: 'kind', detail: 'detail' },
      range: '6m',             // initial window: '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | 'all' | days
      rangeSelector: true,     // 1M / 3M / 6M / YTD / 1Y / All buttons (hidden in print)
      volumeShare: 0.22,       // share of the plot height given to the volume panel
      format: null,            // price format (defaults to the close field format)
      volumeFormat: null,      // volume format in the tooltip (defaults to the volume field format)
      zoom: true,
      legend: true
    },
    render: function (ctx) {
      var state = { zoom: null, legendSel: null, model: null, axes: null, ticks: null, extentKey: null };
      // panel heights and date ticks are laid out in pixels: rebuild on resize
      var api = C(function (c, inst) { return build(c, inst, state); }, { rebuildOnResize: true })(ctx);
      var inst = api.chart;
      var current = ctx;
      var selector = rangeSelector(ctx, state, inst);

      var refit = util.rafThrottle(function () {
        var m = state.model;
        if (inst.isDisposed() || !m || !m.n) return;
        var patch = {};
        var ax = axesFor(current, state);
        if (ax && !sameAxes(ax, state.axes)) {
          state.axes = ax;
          patch.yAxis = [{ id: 'yp', min: ax.p.min, max: ax.p.max, interval: ax.p.interval }, { id: 'yv', max: ax.v.max, interval: ax.v.interval }];
        }
        var tk = catTicks(m, windowOf(m, state.zoom), state.plotW);
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
    var rows = ctx.rows.filter(function (r) {
      return r[enc.x] != null && r[enc.open] != null && r[enc.high] != null && r[enc.low] != null && r[enc.close] != null;
    }).slice();
    rows.sort(function (a, b) { return a[enc.x] < b[enc.x] ? -1 : a[enc.x] > b[enc.x] ? 1 : 0; });
    var n = rows.length;
    var xs = rows.map(function (r) { return r[enc.x]; });
    var xv = xs.map(function (x) { var d = RK.format.toDate(x); return d ? d.getTime() : null; });
    var O = rows.map(function (r) { return r[enc.open]; }), H = rows.map(function (r) { return r[enc.high]; });
    var L = rows.map(function (r) { return r[enc.low]; }), Cl = rows.map(function (r) { return r[enc.close]; });
    var V = o.volume !== false && enc.volume ? rows.map(function (r) { return r[enc.volume]; }) : [];
    var up = Cl.map(function (c, i) { return c > O[i] || (c === O[i] && (i === 0 || c >= Cl[i - 1])); });
    var mas = (o.ma || []).filter(function (d) { return util.isNum(d) && d > 1 && d < n; }).map(function (d) {
      return { key: 'ma' + d, name: d + '-day MA', days: d, values: sma(Cl, d) };
    });
    return {
      rows: rows, n: n, xs: xs, xv: xv, O: O, H: H, L: L, C: Cl, V: V, up: up, mas: mas,
      fmt: o.format || ctx.fmtOf(enc.close) || '#,##0.00',
      vfmt: o.volumeFormat || ctx.fmtOf(enc.volume) || '#,##0'
    };
  }

  function sma(v, d) {
    var out = new Array(v.length), sum = 0;
    for (var i = 0; i < v.length; i++) {
      sum += v[i];
      if (i >= d) sum -= v[i - d];
      out[i] = i >= d - 1 ? sum / d : null;
    }
    return out;
  }

  /** Events dataset -> pins above the candle of the nearest trading day. */
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
      var i = nearest(m.xv, ts);
      pins.push({ i: i, x: r[ee.date], y: m.H[i], label: r[ee.label], kind: r[ee.kind], detail: r[ee.detail], dateFmt: dateFmt });
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
  function firstAtOrAfter(xv, ts) {
    var lo = 0, hi = xv.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (xv[mid] < ts) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /* ------------------------------------------------------------------ *
   * Window (category indices) + value axes re-fitted to the visible candles
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
  /** dataZoom percentages for a range key; on a category axis 0..100% spans index 0..n-1. */
  function zoomFor(m, key) {
    var s = rangeStart(m.xv[m.n - 1], key);
    if (s == null || s <= m.xv[0] || m.n < 2) return { start: 0, end: 100 };
    var i = Math.max(0, firstAtOrAfter(m.xv, s) - 0.5);
    return { start: i / (m.n - 1) * 100, end: 100 };
  }
  function windowOf(m, zoom) {
    var z = zoom || { start: 0, end: 100 };
    return [(m.n - 1) * z.start / 100, (m.n - 1) * z.end / 100];
  }
  function shown(state, name) { return !state.legendSel || state.legendSel[name] !== false; }

  function axesFor(ctx, state) {
    var m = state.model, o = ctx.options;
    if (!m || !m.n) return null;
    var win = windowOf(m, state.zoom);
    var a = Math.max(0, Math.ceil(win[0] - 1e-6)), b = Math.min(m.n - 1, Math.floor(win[1] + 1e-6));
    if (b < a) { a = Math.max(0, Math.floor(win[0])); b = Math.min(m.n - 1, a + 1); }
    var lo = Infinity, hi = -Infinity, vmax = 0;
    var mas = m.mas.filter(function (s) { return shown(state, s.name); });
    for (var i = a; i <= b; i++) {
      if (m.L[i] < lo) lo = m.L[i];
      if (m.H[i] > hi) hi = m.H[i];
      mas.forEach(function (s) { var v = s.values[i]; if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
      if (m.V.length && m.V[i] > vmax) vmax = m.V[i];
    }
    (o.refLines || []).forEach(function (r) { if (util.isNum(r.value)) { lo = Math.min(lo, r.value); hi = Math.max(hi, r.value); } });
    if (!isFinite(lo)) return null;
    var pinsIn = (state.pins || []).some(function (p) { return p.i >= a && p.i <= b; });
    if (pinsIn) hi += (hi - lo) * 0.16;
    var step = util.niceStep((hi - lo) || Math.abs(hi) * 0.1 || 1, util.clamp(Math.round((state.priceH || 220) / 50), 3, 7));
    var p = { min: rnd(Math.floor(lo / step + 1e-9) * step), max: rnd(Math.ceil(hi / step - 1e-9) * step), interval: step };
    if (p.max === p.min) p.max = rnd(p.max + step);
    var vstep = util.niceStep(vmax || 1, util.clamp(Math.round((state.volH || 60) / 34), 1, 3));
    return { p: p, v: { max: rnd(Math.ceil((vmax || 1) / vstep) * vstep), interval: vstep }, first: a, last: b };
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
    if (!m.n) return { series: [] };
    var fmt = m.fmt;
    var pins = state.pins = preparePins(ctx, m);
    var key = m.xs[0] + ':' + m.xs[m.n - 1];
    if (state.extentKey !== key) { state.zoom = zoomFor(m, o.range); state.extentKey = key; }

    var useZoom = o.zoom !== false && m.n > 20;
    var slider = useZoom && o.zoomSlider !== false && !ctx.print;
    var hasLegend = o.legend !== false;
    var hasVol = m.V.length > 0;
    var H = inst.getHeight();
    var hasSelector = o.rangeSelector && !ctx.print && useZoom && m.n >= 30;
    var top = hasLegend || hasSelector ? 34 : 14, gap = 16, xLab = 22, bottom = slider ? 32 : 4;
    var avail = Math.max(120, H - top - gap - xLab - bottom);
    var volH = state.volH = hasVol ? Math.max(36, Math.round(avail * util.clamp(o.volumeShare || 0.22, 0.1, 0.5))) : 0;
    var priceH = state.priceH = hasVol ? avail - volH : avail + gap;

    var ax = state.axes = axesFor(ctx, state);
    var pAxisFmt = C.tickFmt(fmt, function () { return state.axes && state.axes.p.interval; });
    var font = '11px ' + t.fontNum;
    var left = Math.ceil(Math.max(C.measure(pAxisFmt(ax.p.max), font), C.measure(pAxisFmt(ax.p.min), font),
      C.measure(RK.format(m.C[m.n - 1], fmt), font), hasVol ? C.measure(RK.format(ax.v.max, 'auto'), font) : 0)) + 14;
    var right = o.lastPrice ? Math.ceil(C.measure(RK.format(m.C[m.n - 1], fmt), '600 10.5px ' + t.fontNum) + 18) : 14;
    state.plotW = Math.max(120, inst.getWidth() - left - right);
    var tk = state.ticks = catTicks(m, windowOf(m, state.zoom), state.plotW);

    var upC = t.pos, dnC = t.neg;
    // MAs sit on dense red / green candles: keep them well clear of up / down and of the accent2 highlight
    var pal = RK.theme.palette({ exclude: [upC, dnC, t.accent2], minDistance: 110, n: m.mas.length });
    var series = [{
      id: 'ohlc', name: 'OHLC', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0,
      barMaxWidth: 14, barMinWidth: 1,
      itemStyle: { color: upC, color0: dnC, borderColor: upC, borderColor0: dnC, borderWidth: 1 },
      emphasis: { itemStyle: { borderWidth: 1.5 } },
      animationDuration: 800,
      // ECharts candlestick order: [open, close, low, high]
      data: m.rows.map(function (_, i) { return [m.O[i], m.C[i], m.L[i], m.H[i]]; })
    }];
    m.mas.forEach(function (s, k) {
      s.color = pal[k];
      series.push({
        id: s.key, name: s.name, type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, symbol: 'none', z: 3,
        lineStyle: { color: s.color, width: 1.25, type: k === 1 ? [4, 3] : 'solid' }, itemStyle: { color: s.color },
        emphasis: { disabled: true }, smooth: false, animationDuration: 900,
        data: s.values
      });
    });
    var marks = markSeries(ctx, m);
    if (marks) series.push(marks);
    if (pins.length) series.push(pinSeries(ctx, m, pins));
    if (hasVol) {
      series.push({
        id: 'volume', name: ctx.title(ctx.enc.volume) || 'Volume', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        barMaxWidth: 14, barMinWidth: 1, barCategoryGap: '25%', animationDuration: 600,
        itemStyle: { color: RK.theme.alpha(t.ink3, 0.5) },
        data: m.V.map(function (v, i) {
          return { value: v, itemStyle: { color: RK.theme.alpha(m.up[i] ? upC : dnC, t.dark ? 0.55 : 0.45) } };
        })
      });
    }

    var legendData = m.mas.map(function (s) { return s.name; }).concat(hasVol ? [ctx.title(ctx.enc.volume) || 'Volume'] : []);
    var xBase = {
      type: 'category', data: m.xs, boundaryGap: true,
      axisLine: { show: true, lineStyle: { color: t.axis } },
      axisTick: { show: true, length: 3, alignWithLabel: true, lineStyle: { color: t.axis }, customValues: tk.values },
      splitLine: { show: false },
      axisPointer: { label: { formatter: function (p) { return RK.format(p.value, 'dd mmm yyyy'); } } }
    };
    // core zoom (Ctrl/Cmd + wheel or pinch, drag to pan, slider unless printing) shared by both panels
    var z = state.zoom, link = { xAxisIndex: [0, 1], start: z.start, end: z.end, minValueSpan: 10 };
    var dz = useZoom ? C.zoom(ctx, 'x', util.merge({ id: 'dzs', left: left, right: right, bottom: 6 }, link)) : [];
    if (dz.length) util.merge(dz[0], { id: 'dzi' }, link);

    return {
      animationDurationUpdate: 450,
      legend: C.legend(ctx, { show: hasLegend && legendData.length > 0, data: legendData, right: o.rangeSelector && !ctx.print ? 250 : 0,
        selected: state.legendSel || undefined }),
      axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: t.ink2, color: t.paper, fontSize: 10.5, padding: [3, 5], fontFamily: t.fontNum } },
      grid: [
        { id: 'gp', left: left, right: right, top: top, height: priceH, containLabel: false },
        { id: 'gv', left: left, right: right, top: top + priceH + gap, height: volH, containLabel: false }
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

  /** Last close tag + reference lines on a silent helper series. */
  function markSeries(ctx, m) {
    var o = ctx.options, t = ctx.theme, fmt = m.fmt;
    var chip = RK.theme.alpha(t.paper, 0.85);       // label background: legible where it crosses the candles
    var lines = (o.refLines || []).map(function (r) {
      var col = RK.theme.resolve(r.color) || t.ref;          // token names ('pos', 'accent2') or literal colours
      return { yAxis: r.value, lineStyle: { color: col, type: r.type || 'dashed', width: 1.25 },
        label: { formatter: r.label || RK.format(r.value, fmt), position: 'insideStartTop', color: col, fontWeight: 600, fontSize: 10.5, backgroundColor: chip, padding: [1, 4], borderRadius: 2 } };
    });
    if (o.lastPrice) {
      var i = m.n - 1, c = m.C[i];
      var col = i > 0 && c < m.C[i - 1] ? t.neg : t.pos;
      lines.push({ yAxis: c, lineStyle: { color: col, type: [1.5, 2.5], width: 1, opacity: 0.9 },
        label: { formatter: RK.format(c, fmt), position: 'end', distance: 4, backgroundColor: col,
          color: RK.theme.textOn(col), padding: [3, 4, 2, 4], borderRadius: 2, fontWeight: 600, fontSize: 10.5, fontFamily: t.fontNum } });
    }
    if (!lines.length) return null;
    return { id: 'marks', type: 'line', name: '__marks', xAxisIndex: 0, yAxisIndex: 0, data: [], silent: true, tooltip: { show: false }, clip: true,
      markLine: { silent: true, symbol: ['none', 'none'], animation: false, data: lines } };
  }

  /** Numbered pins on stems above the candle high; staggered when they would touch. */
  function pinSeries(ctx, m, pins) {
    var t = ctx.theme, pinColor = t.ink2, txt = RK.theme.textOn(pinColor), R = 8;
    return {
      id: 'events', type: 'custom', name: '__events', xAxisIndex: 0, yAxisIndex: 0, z: 6, clip: true, tooltip: { show: false },
      encode: { x: 0, y: 1 },
      data: pins.map(function (p) { return [p.i, p.y, p.n]; }),
      renderItem: function (params, api) {
        var c = params.context, cs = params.coordSys;
        if (!c.pos) {
          c.pos = pins.map(function (p) { return api.coord([p.i, p.y]); });
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
        var stem = 12 + c.lv[k] * (2 * R + 4);
        var up = pt[1] - stem - R >= cs.y - 2;
        var cy = up ? pt[1] - 3 - stem : pt[1] + stem;
        var y0 = up ? pt[1] - 3 : pt[1];
        return { type: 'group', children: [
          { type: 'line', shape: { x1: pt[0], y1: y0, x2: pt[0], y2: cy + (up ? R : -R) }, style: { stroke: pinColor, lineWidth: 1, opacity: 0.7 } },
          { type: 'circle', shape: { cx: pt[0], cy: cy, r: R }, style: { fill: pinColor, stroke: t.paper, lineWidth: 1.25 } },
          { type: 'text', x: pt[0], y: cy, style: { text: String(api.value(2)), fill: txt, font: '600 10px ' + t.fontNum, align: 'center', verticalAlign: 'middle' } }
        ] };
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Tooltip: OHLC, change vs prior close, intraday range, volume, MAs, events
   * ------------------------------------------------------------------ */
  function tooltip(ctx, inst, state, ps) {
    var m = state.model, fmt = m.fmt, t = ctx.theme;
    var p0 = ps.filter(function (p) { return p.seriesId === 'ohlc' || p.seriesId === 'volume'; })[0];
    if (!p0 || p0.dataIndex == null || p0.dataIndex >= m.n) return '';
    var i = p0.dataIndex, prev = i > 0 ? m.C[i - 1] : null;
    var col = m.up[i] ? t.pos : t.neg;
    var rows = [
      { label: ctx.title(ctx.enc.open) || 'Open', value: RK.format(m.O[i], fmt) },
      { label: ctx.title(ctx.enc.high) || 'High', value: RK.format(m.H[i], fmt) },
      { label: ctx.title(ctx.enc.low) || 'Low', value: RK.format(m.L[i], fmt) },
      { color: col, label: ctx.title(ctx.enc.close) || 'Close', value: RK.format(m.C[i], fmt), bold: true },
      { label: 'Change', value: prev ? RK.format(m.C[i] - prev, signed(fmt)) + '  (' + RK.format(m.C[i] / prev - 1, DELTA) + ')' : 'n.a.' }
    ];
    if (m.V.length) rows.push({ label: ctx.title(ctx.enc.volume) || 'Volume', value: RK.format(m.V[i], m.vfmt) });
    m.mas.forEach(function (s) { if (shown(state, s.name)) rows.push({ color: s.color, label: s.name, value: RK.format(s.values[i], fmt) }); });
    var html = C.tip(RK.format(m.xs[i], (ctx.field(ctx.enc.x) || {}).format || 'dd mmm yyyy'), rows);
    var hits = (state.pins || []).filter(function (pin) { return Math.abs(pin.i - i) <= Math.max(0, Math.round(8 / bandWidth(inst, state))); });
    if (hits.length) html = html.slice(0, -6) + hits.map(eventHTML).join('') + '</div>';
    return html;
  }

  /** '$#,##0.00' -> '+$#,##0.00;-$#,##0.00' (codes that already have sections are kept). */
  function signed(fmt) {
    var code = String(RK.format.presets[fmt] || fmt);
    return code.indexOf(';') >= 0 ? code : '+' + code + ';-' + code + ';' + code;
  }

  function bandWidth(inst, state) {
    var a = inst.convertToPixel({ xAxisIndex: 0 }, 0), b = inst.convertToPixel({ xAxisIndex: 0 }, 1);
    return Math.max(0.5, Math.abs(b - a) || 1);
  }

  function eventHTML(pin) {
    var e = util.escapeHTML;
    return '<div class="rk-tip__foot rk-cs-tip-event">' +
      '<b>' + pin.n + '. ' + e(pin.label) + '</b>' + (pin.kind ? ' <span class="rk-cs-tip-kind">' + e(pin.kind) + '</span>' : '') +
      '<br>' + e(RK.format(pin.x, pin.dateFmt || 'dd mmm yyyy')) + (pin.detail ? ' — ' + e(pin.detail) : '') + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * Range selector (DOM overlay, top-right)
   * ------------------------------------------------------------------ */
  function rangeSelector(ctx, state, inst) {
    var o = ctx.options, m = state.model;
    var noop = { sync: function () {}, remove: function () {} };
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
    var bar = h('div.rk-seg.rk-cs-range.rk-noprint', { role: 'group', 'aria-label': 'Date range' }, items.map(function (r) {
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
   * Helpers: date ticks on a category axis
   * ------------------------------------------------------------------ */
  var STEPS = [[1, 'd'], [2, 'd'], [7, 'w'], [14, 'w'], [1, 'm'], [2, 'm'], [3, 'm'], [6, 'm'], [12, 'm'], [24, 'm'], [60, 'm']];
  /** Calendar ticks (months aligned to quarters / halves / years, Mondays, days) mapped to trading-day indices. */
  function catTicks(m, win, width) {
    var a = Math.max(0, Math.ceil(win[0] - 1e-6)), b = Math.min(m.n - 1, Math.floor(win[1] + 1e-6));
    var t0 = m.xv[a], t1 = m.xv[b], target = util.clamp(Math.floor((width || 600) / 100), 3, 12);
    var days = (t1 - t0) / DAY, step = STEPS[STEPS.length - 1];
    for (var k = 0; k < STEPS.length; k++) {
      var approx = STEPS[k][1] === 'm' ? STEPS[k][0] * 30.44 : STEPS[k][1] === 'w' ? STEPS[k][0] : STEPS[k][0] * 7 / 5;   // 'd' counts trading days
      if (days / approx <= target) { step = STEPS[k]; break; }
    }
    var marks = [], d = new Date(t0), n = step[0];
    if (step[1] === 'm') {
      d = new Date(d.getFullYear(), d.getMonth(), 1);
      if (d.getTime() < t0) d.setMonth(d.getMonth() + 1);
      while ((d.getMonth() % Math.min(n, 12)) !== 0) d.setMonth(d.getMonth() + 1);
      if (n > 12) while (d.getFullYear() % (n / 12) !== 0) d.setFullYear(d.getFullYear() + 1);
      for (; d.getTime() <= t1; d.setMonth(d.getMonth() + n)) marks.push(d.getTime());
    } else if (step[1] === 'w') {
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      while (d.getDay() !== 1 || d.getTime() < t0) d.setDate(d.getDate() + 1);
      for (; d.getTime() <= t1; d.setDate(d.getDate() + n)) marks.push(d.getTime());
    }
    var vals = [];
    if (step[1] === 'd') {
      for (var i = a; i <= b; i += n) vals.push(i);
    } else {
      marks.forEach(function (ts) {
        var j = firstAtOrAfter(m.xv, ts);
        if (j <= b && j >= a && vals[vals.length - 1] !== j) vals.push(j);
      });
    }
    var unit = step[1] === 'm' ? (n >= 12 ? 'y' : 'm') : 'd';
    return { values: vals, unit: unit, key: unit + n + ':' + vals.join(',') };
  }
  function tickLabel(tk) {
    var f = tk.unit === 'y' ? 'yyyy' : tk.unit === 'm' ? 'mmm-yy' : 'd mmm';
    return { customValues: tk.values, hideOverlap: true, interval: 0, formatter: function (v) { return RK.format(v, f); } };
  }
})();
