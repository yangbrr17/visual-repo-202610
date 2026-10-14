/*!
 * RK component: scatter — labelled two-metric scatter (e.g. EV/EBITDA vs. growth) with optional
 * OLS regression line + R², quadrant lines (medians / means / fixed values) with corner labels,
 * collision-avoiding point labels, target highlight, colour by category, click / box-select
 * cross-filter and box zoom. Peer statistics (medians, regression) exclude the target.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /* ---------------- small stats helpers ---------------- */
  function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  /** Ordinary least squares y = a + b·x over [[x, y], ...]; r2 = coefficient of determination. */
  function ols(pts) {
    var n = pts.length;
    if (n < 3) return null;
    var mx = mean(pts.map(function (p) { return p[0]; })), my = mean(pts.map(function (p) { return p[1]; }));
    var sxx = 0, sxy = 0, syy = 0;
    pts.forEach(function (p) { var dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; });
    if (!sxx || !syy) return null;
    var b = sxy / sxx;
    return { a: my - b * mx, b: b, r2: (sxy * sxy) / (sxx * syy), n: n };
  }
  /** Nice axis bounds around the data with fractional padding; never crosses zero needlessly. */
  function niceExtent(vals, pad, count) {
    var ext = util.extent(vals), span = ext[1] - ext[0] || Math.abs(ext[0]) || 1;
    var step = util.niceStep(span * (1 + 2 * pad), count || 5);
    var lo = Math.floor((ext[0] - span * pad) / step) * step, hi = Math.ceil((ext[1] + span * pad) / step) * step;
    if (ext[0] >= 0 && lo < 0) lo = 0;
    if (ext[1] <= 0 && hi > 0) hi = 0;
    return { min: +lo.toPrecision(12), max: +hi.toPrecision(12), step: step };
  }
  /** Regression coefficient in compact, unit-free form for the equation label. */
  function coef(v) {
    var a = Math.abs(v);
    return RK.format(v, a >= 100 ? '#,##0' : a >= 10 ? '0.0' : a >= 1 ? '0.00' : '0.000');
  }
  /** Category palette that skips colours too close to accent2, which is reserved for the target. */
  function catPalette(values, t) {
    var a = RK.theme.parseColor(t.accent2);
    var pool = t.cat.filter(function (c) {
      var b = RK.theme.parseColor(c);
      return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2)) > 90;
    });
    if (!pool.length) pool = t.cat;
    var map = {};
    values.forEach(function (v, i) { map[v] = pool[i % pool.length]; });
    return function (v) { return map[v] || t.neutral; };
  }
  /** Rough rendered width (px) of an axis label — used to space the rotated y-axis name. */
  function textW(s, px) { return String(s).length * (px || 11) * 0.58; }

  /* ---------------- chart toolbar (select / zoom / reset), HTML so it can hide on hover-out --------------- */
  var ICON = {
    select: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><circle cx="12" cy="12" r="1.6"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5M10.5 8v5M8 10.5h5"/>'
  };
  function svgIcon(name) {
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  }

  function toolbar(ctx, inst) {
    var h = util.h, buttons = {};
    var bar = h('div.rk-xy-tools.rk-noprint', { role: 'toolbar', 'aria-label': 'Chart tools' });
    function mode(m) {
      var next = inst.__rkMode === m ? null : m;
      inst.__rkMode = next;
      Object.keys(buttons).forEach(function (k) { buttons[k].classList.toggle('is-on', k === next); buttons[k].setAttribute('aria-pressed', k === next ? 'true' : 'false'); });
      bar.classList.toggle('has-on', !!next);
      inst.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: next ? { brushType: 'rect', brushMode: 'single' } : { brushType: false } });
    }
    function btn(key, label, html, fn) {
      var b = h('button.rk-iconbtn', { type: 'button', title: label, 'aria-label': label, html: html, on: { click: fn } });
      if (key) { buttons[key] = b; b.setAttribute('aria-pressed', 'false'); }
      bar.appendChild(b);
    }
    if (inst.__rkCanBrush) btn('select', 'Box-select points (cross-filter)', svgIcon('select'), function () { mode('select'); });
    btn('zoom', 'Box zoom', svgIcon('zoom'), function () { mode('zoom'); });
    btn(null, 'Reset zoom and selection', RK.ui.icon('reset'), function () {
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 });
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 0, end: 100 });
      inst.dispatchAction({ type: 'brush', areas: [] });
      if (inst.__rk && inst.__rk.ctx) inst.__rk.ctx.clearSelection();
      if (inst.__rkMode) mode(inst.__rkMode);
    });
    ctx.el.appendChild(bar);
    return bar;
  }

  /** Box-select / box-zoom handler (brush component in "rect" mode). */
  function onBrushEnd(params, inst) {
    var area = params.areas && params.areas[0], st = inst.__rk;
    if (!area || !area.coordRange || !st) return;
    var cr = area.coordRange, xr = cr[0], yr = cr[1];
    if (inst.__rkMode === 'zoom') {
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: xr[0], endValue: xr[1] });
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, startValue: yr[0], endValue: yr[1] });
      inst.dispatchAction({ type: 'brush', areas: [] });
      return;
    }
    if (!st.selField) return;
    var vals = st.points.filter(function (p) {
      return p.x >= xr[0] && p.x <= xr[1] && p.y >= yr[0] && p.y <= yr[1];
    }).map(function (p) { return p.key; });
    var key = st.ctx.id + ':' + st.selField;
    if (vals.length) RK.store.setFilter(key, { field: st.selField, op: 'in', values: util.unique(vals), source: st.ctx.id });
    else RK.store.clearFilter(key);
  }

  var build = function (ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc, ds = ctx.dataset;
    var has = function (f) { return !!(f && ds && ds.has(f)); };
    var xFmt = o.xFormat || ctx.fmtOf(enc.x) || 'auto', yFmt = o.yFormat || ctx.fmtOf(enc.y) || 'auto';
    var labelF = has(enc.label) ? enc.label : null, nameF = has(enc.name) ? enc.name : labelF;
    var selField = labelF || nameF;
    var colorF = has(enc.color) ? enc.color : null;
    var highlights = o.highlight == null ? null : [].concat(o.highlight);
    function isTarget(r) {
      if (highlights) return highlights.indexOf(r[labelF]) >= 0 || highlights.indexOf(r[nameF]) >= 0;
      return has(enc.target) && !!r[enc.target];
    }

    var rows = ctx.rows.filter(function (r) { return util.isNum(r[enc.x]) && util.isNum(r[enc.y]); });
    var showLabels = !!labelF && (o.labels === 'auto' ? rows.length <= 40 : !!o.labels);
    // stable colours: category order from the unfiltered data so filtering never re-colours points
    var groups = colorF ? util.unique(ctx.allRows.map(function (r) { return r[colorF]; }).filter(function (v) { return v != null; })) : [];
    var palette = catPalette(groups, t);
    var sel = selField ? ctx.selected(selField) : [];
    var peers = rows.filter(function (r) { return !isTarget(r); });
    var targets = rows.filter(isTarget);

    /* ---- axes ---- */
    var xs = rows.map(function (r) { return r[enc.x]; }), ys = rows.map(function (r) { return r[enc.y]; });
    var stats = { x: peers.map(function (r) { return r[enc.x]; }), y: peers.map(function (r) { return r[enc.y]; }) };
    var q = null;
    if (o.quadrants === 'median' || o.quadrants === 'mean') {
      var fn = o.quadrants === 'median' ? median : mean;
      q = { x: fn(stats.x), y: fn(stats.y), label: o.quadrants === 'median' ? 'Median' : 'Mean' };
    } else if (util.isObj(o.quadrants)) {
      q = { x: o.quadrants.x, y: o.quadrants.y, label: o.quadrants.label || '' };
    }
    var fit = o.regression ? ols(peers.map(function (r) { return [r[enc.x], r[enc.y]]; })) : null;
    var xe = niceExtent(xs.concat(q && util.isNum(q.x) ? [q.x] : []), 0.06, 6);
    var ye = niceExtent(ys.concat(q && util.isNum(q.y) ? [q.y] : []), 0.08, 5);
    var points = [];

    /* ---- point series: one per category (legend toggles), target(s) on top ----
     * Labels live in a transparent companion series with the same name (so the legend toggles both)
     * drawn above every point: a later point can never cover an earlier label. */
    function item(r, color, target) {
      var key = selField ? r[selField] : null;
      var dim = sel.length && sel.indexOf(key) < 0;
      points.push({ x: r[enc.x], y: r[enc.y], key: key });
      return {
        value: [r[enc.x], r[enc.y]],
        name: labelF ? String(r[labelF] == null ? '' : r[labelF]) : '',
        row: r,
        dim: dim,
        itemStyle: { color: dim ? RK.theme.alpha(color, 0.22) : color, borderColor: target ? t.paper : RK.theme.alpha(t.paper, 0.9) }
      };
    }
    var size = o.symbolSize;
    var layers = [];
    if (colorF) {
      groups.forEach(function (g) {
        var list = peers.filter(function (r) { return r[colorF] === g; });
        if (list.length) layers.push({ id: 'g-' + g, name: String(g), color: palette(g), rows: list });
      });
    } else if (peers.length) {
      layers.push({ id: 'peers', name: o.peerLabel, color: catPalette([0], t)(0), rows: peers });
    }
    targets.forEach(function (r, i) {
      layers.push({ id: 'target-' + i, name: String(r[nameF] == null ? 'Target' : r[nameF]), color: t.accent2, rows: [r], target: true });
    });
    var series = [];
    layers.forEach(function (L) {
      var sz = L.target ? size + 5 : size;
      var data = L.rows.map(function (r) { return item(r, L.color, L.target); });
      series.push({
        id: L.id, name: L.name, type: 'scatter', symbol: 'circle', symbolSize: sz, z: L.target ? 4 : 2,
        itemStyle: { color: L.color, borderWidth: L.target ? 1.5 : 0.8 },
        emphasis: { scale: 1.35, focus: 'none' },
        animationDelay: function (i) { return i * 14; },
        data: data
      });
      if (!showLabels) return;
      series.push({
        id: L.id + ':lab', name: L.name, type: 'scatter', symbol: 'circle', symbolSize: sz, z: 6, silent: true,
        tooltip: { show: false }, itemStyle: { color: 'transparent', borderWidth: 0 }, emphasis: { disabled: true },
        label: {
          show: true, position: 'right', distance: 4, fontFamily: t.fontSans,
          fontSize: L.target ? 11 : 10.5, fontWeight: L.target ? 700 : 400, color: L.target ? t.ink : t.ink2,
          textBorderColor: t.paper, textBorderWidth: 2.5,
          formatter: function (p) { return p.name; }
        },
        labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
        animationDelay: function (i) { return 200 + i * 14; },
        data: data.map(function (d) {
          return { value: d.value, name: d.name, label: d.dim ? { color: RK.theme.alpha(L.target ? t.ink : t.ink2, 0.35) } : undefined };
        })
      });
    });

    /* ---- reference layer: zero lines, quadrant lines + labels, regression ---- */
    var lines = [], areas = [];
    var refLine = { color: t.ink3, type: [4, 3], width: 1 };
    if (xe.min < 0 && xe.max > 0) lines.push({ xAxis: 0, lineStyle: { color: t.axis, type: 'solid', width: 1 }, label: { show: false } });
    if (ye.min < 0 && ye.max > 0) lines.push({ yAxis: 0, lineStyle: { color: t.axis, type: 'solid', width: 1 }, label: { show: false } });
    if (q) {
      var qlab = function (v, f) { return (q.label ? q.label + ' ' : '') + RK.format(v, f); };
      if (util.isNum(q.x)) lines.push({ xAxis: q.x, lineStyle: refLine, label: { show: true, position: 'end', formatter: qlab(q.x, xFmt), color: t.ink3, fontSize: 10, distance: 3 } });
      if (util.isNum(q.y)) lines.push({ yAxis: q.y, lineStyle: refLine, label: { show: true, position: 'insideEndTop', formatter: qlab(q.y, yFmt), color: t.ink3, fontSize: 10, distance: 3 } });
      var ql = o.quadrantLabels || [];
      if (ql.length && util.isNum(q.x) && util.isNum(q.y)) {
        var qa = function (text, x0, x1, y0, y1, pos) {
          if (!text) return;
          areas.push([{ coord: [x0, y0], itemStyle: { color: 'transparent' },
            label: { show: true, position: pos, formatter: text, color: t.ink3, fontSize: 10, fontWeight: 600, distance: 6 } }, { coord: [x1, y1] }]);
        };
        qa(ql[0], xe.min, q.x, q.y, ye.max, 'insideTopLeft');
        qa(ql[1], q.x, xe.max, q.y, ye.max, 'insideTopRight');
        qa(ql[2], xe.min, q.x, ye.min, q.y, 'insideBottomLeft');
        qa(ql[3], q.x, xe.max, ye.min, q.y, 'insideBottomRight');
      }
    }
    var fitName = null;
    if (fit) {
      var fx = util.extent(xs), pad = (fx[1] - fx[0]) * 0.04;
      var x0 = Math.max(xe.min, fx[0] - pad), x1 = Math.min(xe.max, fx[1] + pad);
      fitName = (o.equation ? 'y = ' + coef(fit.b) + 'x ' + (fit.a < 0 ? '− ' : '+ ') + coef(Math.abs(fit.a)) + ', ' : 'Linear fit, ') + 'R² = ' + RK.format(fit.r2, '0.00');
    }
    series.unshift({
      id: 'ref', type: 'scatter', data: [], silent: true, tooltip: { show: false }, z: 1,
      markLine: lines.length ? { silent: true, symbol: ['none', 'none'], animationDuration: 600, data: lines } : undefined,
      markArea: areas.length ? { silent: true, data: areas } : undefined
    });

    // regression: a 2-point line series so the fit (and its R²) sits in the legend, never on top of labels
    var legendOn = o.legend !== false;
    if (fit) {
      var fitColor = t.accent3 || t.ink2;
      series.splice(1, 0, {
        id: 'fit', name: fitName, type: 'line', silent: true, z: 1, symbol: 'none', tooltip: { show: false },
        lineStyle: { color: fitColor, width: 1.25, type: 'solid' }, itemStyle: { color: fitColor },
        endLabel: { show: !legendOn, formatter: fitName, color: fitColor, fontSize: 10.5, fontWeight: 600, distance: 4, textBorderColor: t.paper, textBorderWidth: 2.5, align: 'right', offset: [0, -10] },
        data: [[x0, fit.a + fit.b * x0], [x1, fit.a + fit.b * x1]]
      });
    }

    inst.__rk = { ctx: ctx, points: points, selField: selField };
    inst.__rkCanBrush = !!selField && o.brush !== false;

    var yLabW = Math.max(textW(RK.format(ye.min, yFmt)), textW(RK.format(ye.max, yFmt)));
    var legendNames = layers.map(function (L) { return L.name; });
    if (fit) legendNames.push({ name: fitName, icon: 'path://M0 4.2h18v1.6H0z', itemWidth: 16, itemHeight: 9 });
    var showLegend = legendOn && legendNames.length > 1;
    var interactive = !ctx.print && o.zoom !== false;

    return {
      legend: C.legend(ctx, { show: showLegend, data: legendNames, right: interactive ? 92 : 0, icon: 'circle', itemWidth: 9, itemHeight: 9 }),
      // containLabel:false lets ECharts 6 fit axis labels *and* axis names inside the container (outerBounds)
      grid: C.grid(ctx, { top: (showLegend || interactive ? 30 : 10) + (q && util.isNum(q.x) ? 14 : 0), right: 8, left: 2, bottom: 2, containLabel: false }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var r = p.data && p.data.row;
          if (!r) return '';
          var title = r[nameF] == null ? '' : String(r[nameF]);
          if (labelF && nameF !== labelF && r[labelF] != null) title += ' (' + r[labelF] + ')';
          var tr = [
            { label: ctx.title(enc.x), value: RK.format(r[enc.x], xFmt) },
            { label: ctx.title(enc.y), value: RK.format(r[enc.y], yFmt) }
          ];
          (o.tooltipFields || []).forEach(function (f) { tr.push({ label: ctx.title(f), value: RK.format(r[f], ctx.fmtOf(f)) }); });
          if (colorF) tr.unshift({ color: isTarget(r) ? t.accent2 : palette(r[colorF]), label: ctx.title(colorF), value: r[colorF] });
          return C.tip(title, tr, isTarget(r) ? 'Target' : null);
        }
      },
      xAxis: {
        type: 'value', min: xe.min, max: xe.max, interval: xe.step, name: o.xTitle || ctx.title(enc.x), nameLocation: 'middle', nameGap: 26,
        axisLine: { show: true, onZero: false, lineStyle: { color: t.axis } },
        axisLabel: { formatter: C.axisFmt(xFmt), hideOverlap: true },
        splitLine: { show: true, lineStyle: { color: t.grid } }
      },
      yAxis: {
        type: 'value', min: ye.min, max: ye.max, interval: ye.step, name: o.yTitle || ctx.title(enc.y), nameLocation: 'middle', nameGap: Math.round(yLabW + 14),
        axisLine: { show: false, onZero: false },
        axisLabel: { formatter: C.axisFmt(yFmt) },
        splitLine: { show: true, lineStyle: { color: t.grid } }
      },
      toolbox: { show: false },  // the brush is driven from the HTML toolbar
      dataZoom: interactive ? [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true, moveOnMouseWheel: false },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true, moveOnMouseWheel: false }
      ] : [],
      brush: interactive ? {
        toolbox: [], xAxisIndex: 0, yAxisIndex: 0, brushMode: 'single', transformable: false, removeOnClick: true, throttleType: 'debounce', throttleDelay: 120,
        brushStyle: { borderWidth: 1, color: RK.theme.alpha(t.accent3 || t.accent, 0.08), borderColor: RK.theme.alpha(t.accent3 || t.accent, 0.7) },
        inBrush: {}, outOfBrush: {}
      } : undefined,
      series: series
    };
  };

  var base = C(build, {
    select: function (p, ctx) {
      if (!p.data || !p.data.row || !p.componentType || p.componentType !== 'series') return null;
      var st = p.data.row, enc = ctx.enc, ds = ctx.dataset;
      var f = enc.label && ds.has(enc.label) ? enc.label : (enc.name && ds.has(enc.name) ? enc.name : null);
      return f ? { field: f, value: st[f] } : null;
    },
    init: function (inst) {
      inst.on('brushEnd', function (params) { onBrushEnd(params, inst); });
      inst.on('brush', function (params) {
        // a click on empty canvas removes the box: clear the box selection as well
        if (inst.__rkMode === 'select' && params.areas && !params.areas.length && inst.__rk && inst.__rk.selField) {
          RK.store.clearFilter(inst.__rk.ctx.id + ':' + inst.__rk.selField);
        }
      });
    }
  });

  RK.component({
    id: 'scatter',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'x', y: 'y', label: 'label', name: null, color: null, target: 'is_target' },
      labels: 'auto',          // true | false | 'auto' (on up to 40 points); collisions are shifted / hidden
      regression: false,       // OLS fit line (peers only, target excluded) labelled with R²
      equation: false,         // also print "y = bx + a" next to the fit line
      quadrants: null,         // null | 'median' | 'mean' | {x, y, label} — dashed cross-hair lines
      quadrantLabels: null,    // [top-left, top-right, bottom-left, bottom-right] corner captions
      highlight: null,         // label / name value(s) to emphasise; default: rows where encode.target is true
      peerLabel: 'Peers',      // legend name of the single series when no colour field is set
      symbolSize: 9,
      xFormat: null,           // axis / tooltip formats (default: field formats)
      yFormat: null,
      xTitle: null,            // axis titles (default: field titles)
      yTitle: null,
      tooltipFields: [],       // extra fields listed in the tooltip
      brush: true,             // box-select tool -> cross-filter on the label field
      zoom: true,              // box zoom, ctrl + wheel zoom, drag to pan; false = static chart
      legend: true
    },
    render: function (ctx) {
      var api = base(ctx);
      var bar = !ctx.print && ctx.options.zoom !== false ? toolbar(ctx, api.chart) : null;
      var destroy = api.destroy;
      api.destroy = function () { if (bar) bar.remove(); destroy(); };
      return api;
    }
  });
})();
