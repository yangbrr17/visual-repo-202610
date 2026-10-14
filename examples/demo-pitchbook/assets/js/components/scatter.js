/*!
 * RK component: scatter — labelled two-metric scatter (e.g. EV/EBITDA vs. growth) with optional
 * OLS regression line + R² (in the legend), quadrant lines (medians / means / fixed values) with corner
 * labels, point labels placed clear of every other label and point, target highlight, colour by
 * category, click / box-select cross-filter and box zoom. Peer statistics (medians, regression)
 * exclude the target.
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
      'scatter.tools': '图表工具', 'scatter.boxSelect': '框选数据点（交叉筛选）', 'scatter.boxZoom': '框选缩放', 'scatter.resetZoomSel': '重置缩放和选择',
      'scatter.target': '目标公司', 'scatter.peers': '可比公司', 'scatter.linearFit': '线性拟合'
    });
  }

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
    return RK.format(v, a >= 100 ? '#,##0' : a >= 10 ? '0.0' : '0.00');
  }
  /** Tick labels in the field format, without decimals while the tick step is whole ("18x", "5%" — not "18.0x"). */
  function ticks(fmt, step) {
    return function (v) {
      var s = RK.format(v, fmt), st = typeof step === 'function' ? step() : step;
      return st && !/\.\d*[1-9]/.test(RK.format(st, fmt)) ? s.replace(/\.0+(?=\D*$)/, '') : s;
    };
  }
  /** Live tick interval of a value axis (changes while zoomed); `dflt` before the first layout. */
  function axisStep(inst, axis, dflt) {
    try { return inst.getModel().getComponent(axis, 0).axis.scale.getInterval() || dflt; } catch (e) { return dflt; }
  }

  /** Rows a wrapping (type 'plain') ECharts legend needs within `avail` px — mirrors ECharts' box layout. */
  var LEGEND_ROW = 25;   // item height (~11px) + itemGap (14px)
  function legendRows(items, avail, t) {
    var font = '11px ' + t.fontSans, rows = 1, x = 0;
    items.forEach(function (it) {
      var name = typeof it === 'string' ? it : it.name, iw = (it && it.itemWidth) || 10;
      var w = iw + 5 + C.measure(name, font);
      if (x > 0 && x + w > avail) { rows++; x = 0; }
      x += w + 14;
    });
    return rows;
  }

  /* ---------------- label placement (greedy, think-cell style) ---------------- */
  function gridRect(inst) {
    try { return inst.getModel().getComponent('grid', 0).coordinateSystem.getRect(); }
    catch (e) { return { x: 0, y: 0, width: inst.getWidth(), height: inst.getHeight() }; }
  }
  /**
   * Labels overlap neither each other nor any point: each tries 10 positions around its point (right,
   * left, above, below, the diagonals, then further out) and keeps the first free one. Labels that fit
   * nowhere are hidden (hover still shows the tooltip); forced labels (the target) always show.
   * Runs after every render, zoom, resize and legend toggle; updates only the label series.
   */
  function layoutLabels(inst) {
    var L = inst.__rkLabels;
    if (!L || !L.specs.length || inst.isDisposed()) return;
    var rect = gridRect(inst), legendSel = {};
    try { legendSel = (inst.getOption().legend || [])[0].selected || {}; } catch (e) { legendSel = {}; }
    var on = function (name) { return legendSel[name] !== false; };
    var toPx = function (p) { return inst.convertToPixel({ gridIndex: 0 }, [p.x, p.y]); };
    var inRect = function (q) { return q[0] >= rect.x - 0.5 && q[0] <= rect.x + rect.width + 0.5 && q[1] >= rect.y - 0.5 && q[1] <= rect.y + rect.height + 0.5; };
    var obs = L.obstacles.filter(function (o) { return on(o.name); }).map(function (o) { var q = toPx(o); return { x: q[0], y: q[1], r: o.r, id: o.id }; });
    var placed = [];
    // reference lines (quadrant / regression) in px: labels prefer spots that no line crosses
    var segs = (L.lines || []).map(function (ln) {
      if (ln.x != null) { var px = toPx({ x: ln.x, y: 0 })[0]; return [px, rect.y, px, rect.y + rect.height]; }
      if (ln.y != null) { var py = toPx({ x: 0, y: ln.y })[1]; return [rect.x, py, rect.x + rect.width, py]; }
      var a = toPx({ x: ln.x0, y: ln.y0 }), b = toPx({ x: ln.x1, y: ln.y1 });
      return [a[0], a[1], b[0], b[1]];
    });
    function crosses(b) {
      for (var i = 0; i < segs.length; i++) {
        var sg = segs[i], x0 = b.x - 1, x1 = b.x + b.w + 1, y0 = b.y - 1, y1 = b.y + b.h + 1;
        var dx = sg[2] - sg[0], dy = sg[3] - sg[1], t0 = 0, t1 = 1;
        // Liang-Barsky clip of the segment against the label box
        var pp = [-dx, dx, -dy, dy], qq = [sg[0] - x0, x1 - sg[0], sg[1] - y0, y1 - sg[1]], hit = true;
        for (var k = 0; k < 4 && hit; k++) {
          if (pp[k] === 0) { if (qq[k] < 0) hit = false; continue; }
          var r = qq[k] / pp[k];
          if (pp[k] < 0) { if (r > t1) hit = false; else if (r > t0) t0 = r; } else { if (r < t0) hit = false; else if (r < t1) t1 = r; }
        }
        if (hit) return true;
      }
      return false;
    }
    function free(b, selfId) {
      if (b.x < rect.x + 1 || b.y < rect.y + 1 || b.x + b.w > rect.x + rect.width - 1 || b.y + b.h > rect.y + rect.height - 1) return false;
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];   // >= 4px between neighbouring labels
        if (b.x < p.x + p.w + 4 && b.x + b.w + 4 > p.x && b.y < p.y + p.h + 1 && b.y + b.h + 1 > p.y) return false;
      }
      for (var j = 0; j < obs.length; j++) {
        var o = obs[j];
        if (o.id === selfId) continue;
        var nx = Math.max(b.x, Math.min(o.x, b.x + b.w)), ny = Math.max(b.y, Math.min(o.y, b.y + b.h));
        if ((o.x - nx) * (o.x - nx) + (o.y - ny) * (o.y - ny) < (o.r + 1) * (o.r + 1)) return false;
      }
      return true;
    }
    var specs = L.specs.map(function (sp) { var q = toPx(sp); return util.merge({}, sp, { px: q[0], py: q[1] }); });
    // targets first, then isolated points (they rarely block), then crowded ones
    specs.forEach(function (sp) {
      sp.crowd = obs.filter(function (o) { var dx = o.x - sp.px, dy = o.y - sp.py; return dx * dx + dy * dy < 1600; }).length;
    });
    specs.sort(function (a, b) { return (b.force ? 1 : 0) - (a.force ? 1 : 0) || a.crowd - b.crowd; });
    var res = {};
    specs.forEach(function (sp) {
      var key = sp.seriesId + '#' + sp.index;
      if (sp.inside || !on(sp.name) || !inRect([sp.px, sp.py])) { res[key] = sp.inside && on(sp.name) && inRect([sp.px, sp.py]) ? 'inside' : null; return; }
      var r = sp.r, g = 3, w = sp.w, h = sp.h, d = r * 0.71;
      var cands = [[r + g, -h / 2], [-r - g - w, -h / 2], [-w / 2, -r - g - h], [-w / 2, r + g],
        [d + 1, -d - h + 1], [d + 1, d - 1], [-d - 1 - w, -d - h + 1], [-d - 1 - w, d - 1],
        [r + g + 9, -h / 2], [-r - g - 9 - w, -h / 2]];
      // first pass: a free spot no reference line runs through; second pass: any free spot (the halo keeps it legible)
      for (var pass = 0; pass < 2; pass++) {
        for (var k = 0; k < cands.length; k++) {
          var b = { x: sp.px + cands[k][0], y: sp.py + cands[k][1], w: w, h: h };
          if (free(b, sp.id) && (pass || !crosses(b))) { placed.push(b); res[key] = cands[k]; return; }
        }
      }
      if (sp.force) { placed.push({ x: sp.px + r + g, y: sp.py - h / 2, w: w, h: h }); res[key] = [r + g, -h / 2]; return; }
      res[key] = null;
    });
    var upd = Object.keys(L.series).map(function (id) {
      return {
        id: id,
        data: L.series[id].map(function (it, i) {
          var pos = res[id + '#' + i], r = it.symbolSize ? it.symbolSize / 2 : L.r[id];
          if (pos === 'inside') return util.merge({}, it, { label: { show: true, position: 'inside' } });
          if (!pos) return util.merge({}, it, { label: { show: false } });
          // array positions are offsets from the symbol's bounding-box corner (-r, -r)
          return util.merge({}, it, { label: { show: true, position: [pos[0] + r, pos[1] + r], align: 'left', verticalAlign: 'top' } });
        })
      };
    });
    inst.setOption({ series: upd });
  }

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
    var bar = h('div.rk-xy-tools.rk-noprint', { role: 'toolbar', 'aria-label': tr('scatter.tools', 'Chart tools') });
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
    if (inst.__rkCanBrush) btn('select', tr('scatter.boxSelect', 'Box-select points (cross-filter)'), svgIcon('select'), function () { mode('select'); });
    btn('zoom', tr('scatter.boxZoom', 'Box zoom'), svgIcon('zoom'), function () { mode('zoom'); });
    btn(null, tr('scatter.resetZoomSel', 'Reset zoom and selection'), RK.ui.icon('reset'), function () {
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 });
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 0, end: 100 });
      inst.dispatchAction({ type: 'brush', areas: [] });
      if (inst.__rk && inst.__rk.ctx) inst.__rk.ctx.clearSelection();
      if (inst.__rkMode) mode(inst.__rkMode);
    });
    ctx.el.appendChild(bar);
    return bar;
  }

  /** Current zoom window of the two inside dataZooms, so re-renders (filters, selection) keep it. */
  function zoomState(inst) {
    var dz = null;
    try { dz = inst.getOption() && inst.getOption().dataZoom; } catch (e) { dz = null; }
    return [0, 1].map(function (i) {
      var d = dz && dz[i];
      return d ? { start: d.start, end: d.end } : { start: 0, end: 100 };
    });
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
    st.ctx.setSelection(st.selField, util.unique(vals));   // empty box clears; generic fields stay in this dataset (core)
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
    var palette = RK.theme.categoricalSafe(groups);   // peers never resemble the accent2 target
    var sel = selField ? ctx.selected(selField) : [];
    var peers = rows.filter(function (r) { return !isTarget(r); });
    var targets = rows.filter(isTarget);

    /* ---- axes ---- */
    var xs = rows.map(function (r) { return r[enc.x]; }), ys = rows.map(function (r) { return r[enc.y]; });
    var stats = { x: peers.map(function (r) { return r[enc.x]; }), y: peers.map(function (r) { return r[enc.y]; }) };
    var q = null;
    if (o.quadrants === 'median' || o.quadrants === 'mean') {
      var fn = o.quadrants === 'median' ? median : mean;
      q = { x: fn(stats.x), y: fn(stats.y), label: o.quadrants === 'median' ? tr('median', 'Median') : tr('mean', 'Mean') };
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
      layers.push({ id: 'peers', name: o.peerLabel === 'Peers' ? tr('scatter.peers', 'Peers') : o.peerLabel, color: RK.theme.palette({ n: 1 })[0], rows: peers });
    }
    targets.forEach(function (r, i) {
      layers.push({ id: 'target-' + i, name: String(r[nameF] == null ? tr('scatter.target', 'Target') : r[nameF]), color: t.accent2, rows: [r], target: true });
    });
    var series = [];
    layers.forEach(function (L) {
      var sz = L.target ? size + 5 : size;
      var data = L.rows.map(function (r) { return item(r, L.color, L.target); });
      series.push({
        id: L.id, name: L.name, type: 'scatter', symbol: 'circle', symbolSize: sz, z: L.target ? 7 : 2,  // target above all labels
        itemStyle: { color: L.color, borderWidth: L.target ? 1.5 : 0.8 },
        emphasis: { scale: 1.35, focus: 'none' },
        animationDelay: function (i) { return i * 14; },
        data: data
      });
      L.data = data;
      L.sz = sz;
    });
    // label layers: transparent companions drawn above every point; positions come from layoutLabels()
    var labelSeries = {}, specs = [], obstacles = [], radius = {};
    layers.forEach(function (L) {
      L.data.forEach(function (d, i) { obstacles.push({ x: d.value[0], y: d.value[1], r: L.sz / 2 + 0.5, id: L.id + '#' + i, name: L.name }); });
      if (!showLabels) return;
      var font = (L.target ? '700 11px ' : '400 10.5px ') + t.fontSans;
      var items = L.data.map(function (d, i) {
        specs.push({ seriesId: L.id + ':lab', index: i, x: d.value[0], y: d.value[1], r: L.sz / 2, w: C.measure(d.name, font) + 2, h: L.target ? 14 : 13,
          force: !!L.target, id: L.id + '#' + i, name: L.name });
        return { value: d.value, name: d.name, label: { show: false, color: d.dim ? RK.theme.alpha(L.target ? t.ink : t.ink2, 0.35) : (L.target ? t.ink : t.ink2) } };
      });
      labelSeries[L.id + ':lab'] = items;
      radius[L.id + ':lab'] = L.sz / 2;
      series.push({
        id: L.id + ':lab', name: L.name, type: 'scatter', symbol: 'circle', symbolSize: L.sz, z: 6, silent: true,
        tooltip: { show: false }, itemStyle: { color: 'transparent', borderWidth: 0, opacity: 1 }, emphasis: { disabled: true },
        // opaque paper halo: quadrant and regression lines never strike through a label
        label: {
          show: false, fontFamily: t.fontSans, fontSize: L.target ? 11 : 10.5, fontWeight: L.target ? 700 : 400, opacity: 1,
          textBorderColor: t.paper, textBorderWidth: 3.5, formatter: function (p) { return p.name; }
        },
        animationDelay: function (i) { return 200 + i * 14; },
        data: items
      });
    });
    var refSegs = [];
    inst.__rkLabels = { series: labelSeries, specs: specs, obstacles: obstacles, r: radius, lines: refSegs };

    /* ---- reference layer: zero lines, quadrant lines + labels, regression ---- */
    var lines = [], areas = [];
    // house style for statistics lines (medians / means): ink-3, [4, 3] dash, 1px, 10.5px italic label
    var refLine = { color: t.ink3, type: [4, 3], width: 1 };
    var refLab = { color: t.ink3, fontSize: 10.5, fontStyle: 'italic', fontWeight: 400, distance: 3, textBorderColor: t.paper, textBorderWidth: 3 };
    if (xe.min < 0 && xe.max > 0) lines.push({ xAxis: 0, lineStyle: { color: t.axis, type: 'solid', width: 1 }, label: { show: false } });
    if (ye.min < 0 && ye.max > 0) lines.push({ yAxis: 0, lineStyle: { color: t.axis, type: 'solid', width: 1 }, label: { show: false } });
    if (q) {
      // formatter functions (not template strings): '{b}' / '{c}' in a label are never substituted
      var qlab = function (v, f) { var txt = (q.label ? q.label + ' ' : '') + RK.format(v, f); return function () { return txt; }; };
      if (util.isNum(q.x)) { refSegs.push({ x: q.x }); lines.push({ xAxis: q.x, lineStyle: refLine, label: util.merge({ show: true, position: 'end', formatter: qlab(q.x, xFmt) }, refLab) }); }
      if (util.isNum(q.y)) { refSegs.push({ y: q.y }); lines.push({ yAxis: q.y, lineStyle: refLine, label: util.merge({ show: true, position: 'insideEndTop', formatter: qlab(q.y, yFmt) }, refLab) }); }
      var ql = o.quadrantLabels || [];
      if (ql.length && util.isNum(q.x) && util.isNum(q.y)) {
        var qa = function (text, x0, x1, y0, y1, pos) {
          if (!text) return;
          areas.push([{ coord: [x0, y0], itemStyle: { color: 'transparent' },
            label: { show: true, position: pos, formatter: function () { return text; }, color: t.ink3, fontSize: 10, fontWeight: 600, distance: 6 } }, { coord: [x1, y1] }]);
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
      fitName = (o.equation ? 'y = ' + coef(fit.b) + 'x ' + (fit.a < 0 ? '− ' : '+ ') + coef(Math.abs(fit.a)) + ', ' : tr('scatter.linearFit', 'Linear fit') + ', ') + 'R² = ' + RK.format(fit.r2, '0.00');
      refSegs.push({ x0: x0, y0: fit.a + fit.b * x0, x1: x1, y1: fit.a + fit.b * x1 });
    }
    series.unshift({
      id: 'ref', type: 'scatter', data: [], silent: true, tooltip: { show: false }, z: 1,
      // precision: ECharts rounds markLine values to 2 decimals by default (an 18.79% median would draw at 19%)
      markLine: lines.length ? { silent: true, symbol: ['none', 'none'], precision: 10, animationDuration: 600, data: lines } : undefined,
      markArea: areas.length ? { silent: true, data: areas } : undefined
    });

    // regression: a 2-point line series so the fit (and its R²) sits in the legend, never on top of labels
    var legendOn = o.legend !== false;
    if (fit) {
      var fitColor = t.accent3 || t.ink2;
      series.splice(1, 0, {
        id: 'fit', name: fitName, type: 'line', silent: true, z: 1, symbol: 'none', tooltip: { show: false },
        lineStyle: { color: fitColor, width: 1.25, type: 'solid' }, itemStyle: { color: fitColor },
        endLabel: { show: !legendOn, formatter: function () { return fitName; }, color: fitColor, fontSize: 10.5, fontWeight: 600, distance: 4, textBorderColor: t.paper, textBorderWidth: 2.5, align: 'right', offset: [0, -10] },
        data: [[x0, fit.a + fit.b * x0], [x1, fit.a + fit.b * x1]]
      });
    }

    inst.__rk = { ctx: ctx, points: points, selField: selField };
    inst.__rkCanBrush = !!selField && o.brush !== false && o.crossFilter !== false;

    var yLab = ticks(yFmt, ye.step), labFont = '11px ' + t.fontNum;
    var yLabW = Math.max(C.measure(yLab(ye.min), labFont), C.measure(yLab(ye.max), labFont));
    var legendNames = layers.map(function (L) { return L.name; });
    if (fit) legendNames.push({ name: fitName, icon: 'path://M0 4.2h18v1.6H0z', itemWidth: 16, itemHeight: 9 });
    var showLegend = legendOn && legendNames.length > 1;
    var interactive = !ctx.print && o.zoom !== false;
    var zoomed = zoomState(inst).some(function (z) { return z.start > 0 || z.end < 100; });
    // plain legend that wraps onto extra rows (never scroll paging: page 2 would vanish in print / PDF)
    var legendRight = interactive ? 92 : 0;
    var lRows = showLegend ? legendRows(legendNames, inst.getWidth() - legendRight - 10, t) : 1;

    return {
      legend: C.legend(ctx, { show: showLegend, type: 'plain', data: legendNames, right: legendRight }),
      // containLabel:false lets ECharts 6 fit axis labels *and* axis names inside the container (outerBounds)
      grid: C.grid(ctx, { top: (showLegend || interactive ? 30 : 10) + (lRows - 1) * LEGEND_ROW + (q && util.isNum(q.x) ? 14 : 0), right: 8, left: 2, bottom: 2, containLabel: false }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var r = p.data && p.data.row;
          if (!r) return '';
          var title = r[nameF] == null ? '' : String(r[nameF]);
          if (labelF && nameF !== labelF && r[labelF] != null) title += ' (' + r[labelF] + ')';
          var tipRows = [
            { label: ctx.title(enc.x), value: RK.format(r[enc.x], xFmt) },
            { label: ctx.title(enc.y), value: RK.format(r[enc.y], yFmt) }
          ];
          (o.tooltipFields || []).forEach(function (f) { tipRows.push({ label: ctx.title(f), value: RK.format(r[f], ctx.fmtOf(f)) }); });
          if (colorF) tipRows.unshift({ color: isTarget(r) ? t.accent2 : palette(r[colorF]), label: ctx.title(colorF), value: r[colorF] });
          return C.tip(title, tipRows, isTarget(r) ? tr('scatter.target', 'Target') : null);
        }
      },
      xAxis: {
        type: 'value', min: xe.min, max: xe.max, splitNumber: Math.round((xe.max - xe.min) / xe.step), name: o.xTitle || ctx.title(enc.x), nameLocation: 'middle', nameGap: 26,
        axisLine: { show: true, onZero: false, lineStyle: { color: t.axis } },
        axisLabel: { formatter: ticks(xFmt, function () { return axisStep(inst, 'xAxis', xe.step); }), hideOverlap: true, showMinLabel: !zoomed, showMaxLabel: !zoomed },
        splitLine: { show: true, lineStyle: { color: t.grid } }
      },
      yAxis: {
        type: 'value', min: ye.min, max: ye.max, splitNumber: Math.round((ye.max - ye.min) / ye.step), name: o.yTitle || ctx.title(enc.y), nameLocation: 'middle', nameGap: Math.round(yLabW + 14),
        axisLine: { show: false, onZero: false },
        axisLabel: { formatter: ticks(yFmt, function () { return axisStep(inst, 'yAxis', ye.step); }), showMinLabel: !zoomed, showMaxLabel: !zoomed },
        splitLine: { show: true, lineStyle: { color: t.grid } }
      },
      toolbox: { show: false },  // the brush is driven from the HTML toolbar
      // inside zoom on both axes: Ctrl/Cmd + wheel or pinch (plain wheel scrolls the report unless options.wheelZoom);
      // RK.chart keeps the zoom window across filter updates
      dataZoom: interactive ? [C.zoom(ctx, 'x')[0], C.zoom(ctx, 'y')[0]] : [],
      brush: interactive ? {
        toolbox: [], xAxisIndex: 0, yAxisIndex: 0, brushMode: 'single', transformable: false, removeOnClick: true, throttleType: 'debounce', throttleDelay: 120,
        brushStyle: { borderWidth: 1, color: RK.theme.alpha(t.accent3 || t.accent, 0.08), borderColor: RK.theme.alpha(t.accent3 || t.accent, 0.7) },
        inBrush: {}, outOfBrush: {}
      } : undefined,
      series: series
    };
  };

  var base = C(build, {
    rebuildOnResize: true,   // legend rows depend on the width
    // click a point -> toggle it in the cross-filter on the label (or name) field
    select: function (p, ctx, inst) {
      var f = inst.__rk && inst.__rk.selField;
      return p.componentType === 'series' && p.data && p.data.row && f ? { field: f, value: p.data.row[f] } : null;
    },
    init: function (inst) {
      inst.on('brushEnd', function (params) { onBrushEnd(params, inst); });
      inst.on('datazoom', function () {
        // hide the odd boundary labels (e.g. 15.6x) while zoomed, restore them at full extent
        var z = zoomState(inst).some(function (d) { return d.start > 0 || d.end < 100; });
        var lab = { axisLabel: { showMinLabel: !z, showMaxLabel: !z } };
        inst.setOption({ xAxis: lab, yAxis: lab });
      });
      inst.on('brush', function (params) {
        // a click on empty canvas removes the box: clear the box selection as well
        var st = inst.__rk;
        if (inst.__rkMode === 'select' && params.areas && !params.areas.length && st && st.selField) st.ctx.setSelection(st.selField, []);
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
      wheelZoom: null,         // true: a plain mouse wheel zooms (default: Ctrl/Cmd + wheel or pinch, so the page scrolls)
      legend: true
    },
    render: function (ctx) {
      var api = base(ctx), inst = api.chart;
      var bar = ctx.options.zoom !== false ? toolbar(ctx, inst) : null;
      if (bar) bar.hidden = !!ctx.print;   // print: no buttons (also re-checked on every print refresh)
      var relabel = util.rafThrottle(function () { layoutLabels(inst); });
      layoutLabels(inst);
      inst.on('datazoom', relabel);
      inst.on('legendselectchanged', relabel);
      var update = api.update, resize = api.resize, destroy = api.destroy;
      api.update = function (c) { update(c); layoutLabels(inst); if (bar) bar.hidden = !!c.print; };
      api.resize = function () { resize(); layoutLabels(inst); };
      api.destroy = function () { if (bar) bar.remove(); destroy(); };
      return api;
    }
  });
})();
