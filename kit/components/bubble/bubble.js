/*!
 * RK component: bubble — four-dimensional scatter: x, y, bubble *area* (√-scaled size), colour
 * (category legend or continuous visualMap). Nested-circle size key, labels for the largest
 * bubbles, target highlight, linear / log axes, click & box-select cross-filter, box zoom, and an
 * optional animation over a time field (ECharts timeline with play button and fading trails).
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  /* ---------------- scale helpers ---------------- */
  /** Nice linear axis bounds around the data with fractional padding; never crosses zero needlessly. */
  function niceExtent(vals, pad, count) {
    var ext = util.extent(vals), span = ext[1] - ext[0] || Math.abs(ext[0]) || 1;
    var step = util.niceStep(span * (1 + 2 * pad), count || 5);
    var lo = Math.floor((ext[0] - span * pad) / step) * step, hi = Math.ceil((ext[1] + span * pad) / step) * step;
    if (ext[0] >= 0 && lo < 0) lo = 0;
    if (ext[1] <= 0 && hi > 0) hi = 0;
    return { min: +lo.toPrecision(12), max: +hi.toPrecision(12), step: step };
  }
  /** Log axis bounds on the 1-2-5 ladder around the positive data (tighter than whole decades). */
  function logExtent(vals) {
    var ext = util.extent(vals.filter(function (v) { return v > 0; }));
    if (!(ext[0] > 0)) return { min: 1, max: 10 };
    var lo = ext[0] / 1.12, hi = ext[1] * 1.12;
    var mlo = Math.pow(10, Math.floor(Math.log10(lo))), mhi = Math.pow(10, Math.floor(Math.log10(hi)));
    var nlo = lo / mlo, nhi = hi / mhi;
    return { min: (nlo >= 5 ? 5 : nlo >= 2 ? 2 : 1) * mlo, max: (nhi <= 1 ? 1 : nhi <= 2 ? 2 : nhi <= 5 ? 5 : 10) * mhi };
  }
  /** Largest "nice" number (1, 2, 2.5, 5 × 10^k) not above v — size-key reference values. */
  function niceBelow(v) {
    if (!(v > 0)) return 0;
    var mag = Math.pow(10, Math.floor(Math.log10(v))), n = v / mag;
    return (n >= 5 ? 5 : n >= 2.5 ? 2.5 : n >= 2 ? 2 : 1) * mag;
  }
  /** Perceptual-ish similarity: close hue and lightness (or near-identical greys). */
  function similar(a, b) {
    function hsl(c) {
      var p = RK.theme.parseColor(c), r = p[0] / 255, g = p[1] / 255, bl = p[2] / 255;
      var mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), l = (mx + mn) / 2, d = mx - mn, h = 0;
      var s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
      if (d) h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
      return [(h * 60 + 360) % 360, s, l, p];
    }
    var x = hsl(a), y = hsl(b);
    if (x[1] < 0.15 || y[1] < 0.15) {
      return Math.sqrt(Math.pow(x[3][0] - y[3][0], 2) + Math.pow(x[3][1] - y[3][1], 2) + Math.pow(x[3][2] - y[3][2], 2)) < 40;
    }
    var dh = Math.abs(x[0] - y[0]); dh = Math.min(dh, 360 - dh);
    return dh < 22 && Math.abs(x[2] - y[2]) < 0.22;
  }
  /**
   * Category palette: theme order, but skipping colours similar to accent2 (reserved for the target)
   * or to a colour already picked, so neighbouring categories stay distinguishable.
   */
  function catPalette(values, t) {
    var pool = [];
    t.cat.forEach(function (c) { if (!similar(c, t.accent2) && pool.every(function (p) { return !similar(c, p); })) pool.push(c); });
    t.cat.forEach(function (c) { if (pool.indexOf(c) < 0 && !similar(c, t.accent2)) pool.push(c); });  // reuse the rest if needed
    if (!pool.length) pool = t.cat;
    var map = {};
    values.forEach(function (v, i) { map[v] = pool[i % pool.length]; });
    return function (v) { return map[v] || t.neutral; };
  }
  /** Axis tick formatter: the field format, but whole ticks >= 100 (any whole tick on a log axis) drop ".0" — "$1,800" not "$1,800.0". */
  function axisFmt(fmt, log) {
    return function (v) {
      var s = RK.format(v, fmt);
      return Math.round(v) === v && (log || Math.abs(v) >= 100) ? s.replace(/\.0+(?=\D*$)/, '') : s;
    };
  }
  function textW(s, px) { return String(s).length * (px || 11) * 0.58; }
  function sortPeriods(list) {
    var nums = list.every(function (v) { return typeof v === 'number'; });
    return list.slice().sort(function (a, b) { return nums ? a - b : String(a).localeCompare(String(b)); });
  }

  /* ---------------- hover toolbar (select / zoom / reset) — same pattern as scatter ---------------- */
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
    if (inst.__rkCanBrush) btn('select', 'Box-select bubbles (cross-filter)', svgIcon('select'), function () { mode('select'); });
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
  function zoomState(inst) {
    var dz = null;
    try { dz = inst.getOption() && inst.getOption().dataZoom; } catch (e) { dz = null; }
    return [0, 1].map(function (i) {
      var d = dz && dz[i];
      return d ? { start: d.start, end: d.end } : { start: 0, end: 100 };
    });
  }
  function timelineIndex(inst) {
    try { var tl = inst.getOption() && inst.getOption().timeline; return tl && tl[0] ? tl[0].currentIndex : null; } catch (e) { return null; }
  }
  function onBrushEnd(params, inst) {
    var area = params.areas && params.areas[0], st = inst.__rk;
    if (!area || !area.coordRange || !st) return;
    var xr = area.coordRange[0], yr = area.coordRange[1];
    if (inst.__rkMode === 'zoom') {
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: xr[0], endValue: xr[1] });
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, startValue: yr[0], endValue: yr[1] });
      inst.dispatchAction({ type: 'brush', areas: [] });
      return;
    }
    if (!st.selField) return;
    var vals = st.points.filter(function (p) { return p.x >= xr[0] && p.x <= xr[1] && p.y >= yr[0] && p.y <= yr[1]; })
      .map(function (p) { return p.key; });
    var key = st.ctx.id + ':' + st.selField;
    if (vals.length) RK.store.setFilter(key, { field: st.selField, op: 'in', values: util.unique(vals), source: st.ctx.id });
    else RK.store.clearFilter(key);
  }

  /* ---------------- option builder ---------------- */
  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc, ds = ctx.dataset;
    var has = function (f) { return !!(f && ds && ds.has(f)); };
    var xFmt = o.xFormat || ctx.fmtOf(enc.x) || 'auto', yFmt = o.yFormat || ctx.fmtOf(enc.y) || 'auto';
    var sizeF = has(enc.size) ? enc.size : null, colorF = has(enc.color) ? enc.color : null;
    var sFmt = o.sizeFormat || (sizeF && ctx.fmtOf(sizeF)) || 'auto', cFmt = o.colorFormat || (colorF && ctx.fmtOf(colorF)) || 'auto';
    var labelF = has(enc.label) ? enc.label : null, nameF = has(enc.name) ? enc.name : labelF;
    var selField = labelF || nameF;
    var tf = o.timeField && has(o.timeField) ? o.timeField : null;
    var highlights = o.highlight == null ? null : [].concat(o.highlight);
    function isTarget(r) {
      if (highlights) return highlights.indexOf(r[labelF]) >= 0 || highlights.indexOf(r[nameF]) >= 0;
      return has(enc.target) && !!r[enc.target];
    }
    var valid = function (r) { return util.isNum(r[enc.x]) && util.isNum(r[enc.y]) && (o.xScale !== 'log' || r[enc.x] > 0) && (o.yScale !== 'log' || r[enc.y] > 0); };
    var rows = ctx.rows.filter(valid), allRows = ctx.allRows.filter(valid);
    var sel = selField ? ctx.selected(selField) : [];
    var opacity = o.opacity;

    /* colour mode */
    var cType = 'none';
    if (colorF) {
      var numeric = (ds.field(colorF) || {}).type === 'number';
      cType = o.colorScale === 'auto' ? (numeric ? 'auto-num' : 'category') : o.colorScale;
    }
    var cExt = colorF ? util.extent(allRows.map(function (r) { return r[colorF]; })) : [0, 1];
    if (cType === 'auto-num') cType = cExt[0] < o.mid && cExt[1] > o.mid ? 'diverging' : 'sequential';
    var continuous = cType === 'sequential' || cType === 'diverging';
    var cDom = cExt.slice();
    if (cType === 'diverging') { var m = Math.max(Math.abs(cExt[0] - o.mid), Math.abs(cExt[1] - o.mid)) || 1; cDom = [o.mid - m, o.mid + m]; }
    // sequential: drop the two lightest stops — near-paper bubbles would vanish
    var stops = cType === 'diverging' ? t.div : (t.seq.length > 4 ? t.seq.slice(2) : t.seq);
    var cScale = continuous ? RK.theme.sequential(cDom, stops) : null;   // identical ramp to the visualMap -> label contrast
    var groups = cType === 'category' ? util.unique(allRows.map(function (r) { return r[colorF]; }).filter(function (v) { return v != null; })) : [];
    var palette = catPalette(groups.length ? groups : [0], t);

    /* size: area ∝ value (diameter ∝ √value), scaled to the unfiltered maximum so filtering never rescales */
    var sMax = sizeF ? util.extent(allRows.map(function (r) { return Math.abs(r[sizeF]); }))[1] : 0;
    var dMin = o.sizeRange[0], dMax = o.sizeRange[1];
    function diam(v) {
      if (!sizeF) return Math.round((dMin + dMax) / 3);
      if (!util.isNum(v) || v <= 0 || !sMax) return dMin;
      return Math.max(dMin, dMax * Math.sqrt(v / sMax));
    }

    /* periods (timeline) */
    var periods = tf ? sortPeriods(util.unique(rows.map(function (r) { return r[tf]; }).filter(function (v) { return v != null; }))) : [null];
    var frameRows = periods.map(function (p) { return tf ? rows.filter(function (r) { return r[tf] === p; }) : rows; });
    var timeline = !!tf && periods.length > 1;
    var tlShown = timeline && !ctx.print;   // print: static last period, no player

    /* axes: fixed across frames so motion is meaningful */
    var xs = rows.map(function (r) { return r[enc.x]; }), ys = rows.map(function (r) { return r[enc.y]; });
    var xe = o.xScale === 'log' ? logExtent(xs) : niceExtent(xs, 0.1, 6);
    var ye = o.yScale === 'log' ? logExtent(ys) : niceExtent(ys, 0.12, 5);

    /* layers: one series per category (legend toggles) + target layer */
    var layers = [];
    if (cType === 'category') groups.forEach(function (g) { layers.push({ id: 'g-' + g, name: String(g), color: palette(g), match: function (r) { return !isTarget(r) && r[colorF] === g; } }); });
    else layers.push({ id: 'all', name: o.peerLabel, color: continuous ? null : palette(0), match: function (r) { return !isTarget(r); } });
    var targetName = null;
    allRows.some(function (r) { if (isTarget(r)) { targetName = String(r[nameF] == null ? 'Target' : r[nameF]); return true; } return false; });
    if (targetName) layers.push({ id: 'target', name: targetName, color: continuous ? null : t.accent2, target: true, match: isTarget });

    var points = [];
    function frameSeries(list, fi) {
      var topN = o.labels === true ? Infinity : o.labels === false ? 0 : +o.labels || 0;
      var bySize = list.slice().sort(function (a, b) { return (b[sizeF] || 0) - (a[sizeF] || 0); });
      var labelled = new Set(bySize.slice(0, topN));
      var out = [], labelOut = [];
      layers.forEach(function (L) {
        var mine = bySize.filter(L.match);   // large first: small bubbles drawn on top
        var data = [], labs = [];
        mine.forEach(function (r) {
          var key = selField ? r[selField] : null, dim = sel.length && sel.indexOf(key) < 0;
          var d = diam(sizeF ? r[sizeF] : null);
          var fill = continuous ? cScale(r[colorF]) : L.color;
          var name = labelF ? String(r[labelF] == null ? '' : r[labelF]) : '';
          if (!timeline) points.push({ x: r[enc.x], y: r[enc.y], key: key });
          var it = {
            value: [r[enc.x], r[enc.y], sizeF ? r[sizeF] : null, colorF ? r[colorF] : null],
            name: name, row: r, symbolSize: d,
            itemStyle: { opacity: dim ? 0.14 : opacity }
          };
          if (sizeF && !(r[sizeF] > 0)) it.itemStyle = { opacity: dim ? 0.14 : 1, color: 'transparent', borderColor: fill || t.ink3, borderWidth: 1 };
          if (L.target && continuous) { it.itemStyle.borderColor = t.accent2; it.itemStyle.borderWidth = 2.5; }
          data.push(it);
          if (!name || !(L.target || labelled.has(r))) return;
          var inside = d >= textW(name, 10.5) + 8;
          var eff = RK.theme.mix(t.paper, fill || t.cat[0], opacity);
          labs.push({
            value: it.value, name: name, symbolSize: d,
            label: {
              position: inside ? 'inside' : 'right', distance: 3,
              color: dim ? RK.theme.alpha(t.ink2, 0.35) : inside ? RK.theme.onColor(eff, t.dark ? t.paper : t.ink, t.dark ? t.ink : '#ffffff') : (L.target ? t.ink : t.ink2),
              textBorderWidth: inside ? 0 : 2.5, fontWeight: L.target ? 700 : 500
            }
          });
        });
        out.push({
          id: L.id, name: L.name, type: 'scatter', symbol: 'circle', z: L.target ? 3 : 2,
          itemStyle: L.color ? { color: L.color, borderColor: t.paper, borderWidth: 1 } : { borderColor: t.paper, borderWidth: 1 },
          emphasis: { focus: 'self', scale: 1.06, itemStyle: { opacity: 1, borderColor: t.ink, borderWidth: 1.5 } },
          blur: { itemStyle: { opacity: 0.25 } },
          animationDelay: function (i) { return i * 18; },
          data: data
        });
        labelOut.push({
          id: L.id + ':lab', name: L.name, type: 'scatter', symbol: 'circle', z: 6, silent: true,
          tooltip: { show: false }, itemStyle: { color: 'transparent', borderWidth: 0 }, emphasis: { disabled: true },
          label: { show: true, fontSize: 10.5, fontFamily: t.fontSans, textBorderColor: t.paper, formatter: function (p) { return p.name; } },
          labelLayout: { hideOverlap: true },
          animationDelay: function (i) { return 250 + i * 18; },
          data: labs
        });
      });
      // trails: each entity's path through the periods so far
      var trails = [];
      if (timeline && o.trails) {
        var keyF = nameF || labelF;
        util.unique(rows.map(function (r) { return r[keyF]; })).forEach(function (k, ki) {
          var path = [];
          for (var j = 0; j <= fi; j++) frameRows[j].forEach(function (r) { if (r[keyF] === k) path.push([r[enc.x], r[enc.y]]); });
          var proto = rows.filter(function (r) { return r[keyF] === k; })[0];
          var col = isTarget(proto) && !continuous ? t.accent2 : (cType === 'category' ? palette(proto[colorF]) : t.ink3);
          trails.push({
            id: 'trail-' + ki, type: 'line', silent: true, z: 1, symbol: 'circle', symbolSize: 4, showSymbol: true,
            lineStyle: { color: RK.theme.alpha(col, 0.45), width: 1.2 }, itemStyle: { color: RK.theme.alpha(col, 0.55) },
            tooltip: { show: false }, animation: false, data: path
          });
        });
      }
      return out.concat(labelOut, trails);
    }

    var frames = frameRows.map(frameSeries);
    var bubbleIdx = [];
    frames[0].forEach(function (s, i) { if (s.type === 'scatter' && !/:lab$/.test(s.id)) bubbleIdx.push(i + 1); }); // +1: ref series first

    /* reference lines */
    var lines = [];
    var refStyle = { color: t.ink3, type: [4, 3], width: 1 };
    if (o.xScale !== 'log' && xe.min < 0 && xe.max > 0) lines.push({ xAxis: 0, lineStyle: { color: t.axis, type: 'solid' }, label: { show: false } });
    if (o.yScale !== 'log' && ye.min < 0 && ye.max > 0) lines.push({ yAxis: 0, lineStyle: { color: t.axis, type: 'solid' }, label: { show: false } });
    (o.refLines || []).forEach(function (r) {
      var isX = r.axis === 'x', d = { lineStyle: util.merge({}, refStyle, r.color ? { color: r.color } : {}) };
      d[isX ? 'xAxis' : 'yAxis'] = r.value;
      d.label = { show: true, position: isX ? 'end' : 'insideEndTop', color: r.color || t.ink3, fontSize: 10, distance: 3,
        formatter: (r.label ? r.label + ' ' : '') + RK.format(r.value, isX ? xFmt : yFmt) };
      lines.push(d);
    });
    var hasXRef = (o.refLines || []).some(function (r) { return r.axis === 'x'; });
    var ref = {
      id: 'ref', type: 'scatter', data: [], silent: true, tooltip: { show: false }, z: 1,
      markLine: lines.length ? { silent: true, symbol: ['none', 'none'], data: lines } : undefined
    };

    /* size key (nested circles, bottom-aligned) in the right gutter */
    var showKey = o.sizeLegend !== false && !!sizeF && sMax > 0;
    var keyVals = showKey ? util.unique([niceBelow(sMax), niceBelow(sMax / 4), niceBelow(sMax / 16)]).filter(function (v) { return v > 0; }) : [];
    var keyLabW = Math.max.apply(null, [24].concat(keyVals.map(function (v) { return textW(axisFmt(sFmt, true)(v), 10); })));
    var gutter = showKey ? Math.max(Math.round(dMax + 14 + keyLabW), textW(ctx.title(sizeF), 10) * 0.6) : 0;
    var graphic = [];
    var top0 = 34;
    if (showKey) {
      var sTitle = o.sizeTitle || ctx.title(sizeF);
      var lines = Math.max(1, Math.ceil(textW(sTitle, 10) / gutter));
      var kids = [{ type: 'text', x: 0, y: 0, style: { text: sTitle, fill: t.ink3, font: '600 10px ' + t.fontSans, width: gutter, overflow: 'break', lineHeight: 12 } }];
      var base = 6 + 12 * lines + dMax;
      keyVals.forEach(function (v) {
        var r = diam(v) / 2, ty = base - 2 * r;
        kids.push({ type: 'circle', shape: { cx: dMax / 2, cy: base - r, r: r }, style: { fill: 'none', stroke: t.ink3, lineWidth: 0.8 } });
        kids.push({ type: 'line', shape: { x1: dMax / 2, y1: ty, x2: dMax + 6, y2: ty }, style: { stroke: t.ink3, lineWidth: 0.6, lineDash: [2, 2] } });
        kids.push({ type: 'text', x: dMax + 8, y: ty, style: { text: axisFmt(sFmt, true)(v), fill: t.ink2, font: '10px ' + t.fontNum, verticalAlign: 'middle' } });
      });
      graphic.push({ type: 'group', id: 'rk-size', right: 2, top: top0, silent: true, children: kids });
    }

    /* legend / visualMap (top-left) */
    var legendOn = o.legend !== false;
    var visualMap;
    if (continuous) {
      var cTitle = o.colorTitle || ctx.title(colorF);
      var tw = textW(cTitle, 10.5) + 10;
      graphic.push({ type: 'text', id: 'rk-ctitle', left: 0, top: 16, silent: true, style: { text: cTitle, fill: t.ink2, font: '600 10.5px ' + t.fontSans } });
      visualMap = {
        type: 'continuous', dimension: 3, seriesIndex: bubbleIdx, min: cDom[0], max: cDom[1],
        orient: 'horizontal', left: tw + 30, top: 1, itemWidth: 9, itemHeight: 110, calculable: false, hoverLink: true,
        text: [RK.format(cDom[1], cFmt), RK.format(cDom[0], cFmt)], textGap: 6, textStyle: { color: t.ink3, fontSize: 10 },
        inRange: { color: stops }, outOfRange: { color: t.grid, opacity: 0.35 },
        formatter: function (v) { return RK.format(v, cFmt); },
        handleStyle: { borderColor: t.ink3 }, indicatorStyle: { borderColor: t.paper }
      };
    }
    var legendNames = layers.map(function (L) { return L.name; });
    var showLegend = legendOn && !continuous && legendNames.length > 1;
    var interactive = !ctx.print && o.zoom !== false;
    var zs = zoomState(inst), zoomed = zs.some(function (z) { return z.start > 0 || z.end < 100; });

    inst.__rk = { ctx: ctx, points: points, selField: selField };
    inst.__rkCanBrush = !!selField && o.brush !== false && !timeline;

    var axisBase = function (isX, ext, fmt, scale, title) {
      var a = {
        type: scale === 'log' ? 'log' : 'value', min: ext.min, max: ext.max, name: title, nameLocation: 'middle',
        axisLabel: {
          formatter: axisFmt(fmt, scale === 'log'),
          hideOverlap: true, showMinLabel: !zoomed, showMaxLabel: !zoomed
        },
        splitLine: { show: true, lineStyle: { color: t.grid } },
        axisLine: { show: isX, onZero: false, lineStyle: { color: t.axis } }
      };
      if (scale === 'log') { a.logBase = 10; a.minorSplitLine = { show: false }; }
      else a.splitNumber = Math.round((ext.max - ext.min) / ext.step);
      return a;
    };
    var yLabW = Math.max(textW(RK.format(ye.min, yFmt)), textW(RK.format(ye.max, yFmt)));
    var xAxis = util.merge(axisBase(true, xe, xFmt, o.xScale, o.xTitle || ctx.title(enc.x)), { nameGap: 26 });
    var yAxis = util.merge(axisBase(false, ye, yFmt, o.yScale, o.yTitle || ctx.title(enc.y)), { nameGap: Math.round(yLabW + 14) });

    var tooltip = {
      trigger: 'item',
      formatter: function (p) {
        var r = p.data && p.data.row;
        if (!r) return '';
        var title = r[nameF] == null ? '' : String(r[nameF]);
        if (labelF && nameF !== labelF && r[labelF] != null) title += ' (' + r[labelF] + ')';
        var tr = [];
        if (colorF) tr.push({ color: continuous ? cScale(r[colorF]) : (isTarget(r) ? t.accent2 : palette(r[colorF])), label: ctx.title(colorF), value: RK.format(r[colorF], continuous ? cFmt : null) });
        tr.push({ label: ctx.title(enc.x), value: RK.format(r[enc.x], xFmt) });
        tr.push({ label: ctx.title(enc.y), value: RK.format(r[enc.y], yFmt) });
        if (sizeF) tr.push({ label: ctx.title(sizeF) + ' (size)', value: RK.format(r[sizeF], sFmt) });
        (o.tooltipFields || []).forEach(function (f) { tr.push({ label: ctx.title(f), value: RK.format(r[f], ctx.fmtOf(f)) }); });
        return C.tip(title, tr, tf ? ctx.title(tf) + ': ' + r[tf] : (isTarget(r) ? 'Target' : null));
      }
    };
    var gridTop = (continuous ? 42 : showLegend || interactive ? 30 : 10) + (hasXRef ? 14 : 0);
    var common = {
      legend: C.legend(ctx, { show: showLegend, data: legendNames, right: (interactive ? 92 : 0) + gutter, icon: 'circle', itemWidth: 9, itemHeight: 9 }),
      // containLabel:false -> ECharts 6 keeps axis labels + names inside outerBounds (above the timeline)
      grid: C.grid(ctx, { top: gridTop, right: gutter ? gutter + 14 : 8, left: 2, bottom: tlShown ? 50 : 2, containLabel: false,
        outerBounds: { left: 0, right: 0, top: 0, bottom: tlShown ? 48 : 0 } }),
      tooltip: tooltip,
      xAxis: xAxis,
      yAxis: yAxis,
      visualMap: visualMap ? [visualMap] : [],
      toolbox: { show: false },
      dataZoom: interactive ? [
        util.merge({ type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true, moveOnMouseWheel: false }, zs[0]),
        util.merge({ type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true, moveOnMouseWheel: false }, zs[1])
      ] : [],
      brush: interactive ? {
        toolbox: [], xAxisIndex: 0, yAxisIndex: 0, brushMode: 'single', transformable: false, removeOnClick: true, throttleType: 'debounce', throttleDelay: 120,
        brushStyle: { borderWidth: 1, color: RK.theme.alpha(t.accent3 || t.accent, 0.08), borderColor: RK.theme.alpha(t.accent3 || t.accent, 0.7) },
        inBrush: {}, outOfBrush: {}
      } : undefined
    };

    if (!timeline) return util.merge(common, { graphic: graphic, series: [ref].concat(frames[0]) });

    /* timeline: base option + one option per period (series matched by id -> animated transitions) */
    var idx = timelineIndex(inst);
    if (idx == null || idx >= periods.length) idx = ctx.print || o.startAt !== 'first' ? periods.length - 1 : 0;
    var wm = function (p) {
      return { type: 'text', id: 'rk-wm', right: (gutter ? gutter + 26 : 18), bottom: tlShown ? 106 : 56, silent: true, z: 0,
        style: { text: String(p), fill: RK.theme.alpha(t.ink, t.dark ? 0.12 : 0.08), font: '700 46px ' + t.fontNum, align: 'right' } };
    };
    var dur = Math.round(o.playInterval * 0.7);
    var baseOption = util.merge(common, {
      animation: !!ctx.motion,
      animationDurationUpdate: dur, animationEasingUpdate: 'cubicInOut',
      graphic: graphic.concat(wm(periods[idx])),
      timeline: {
        axisType: 'category', data: periods.map(String), currentIndex: idx,
        autoPlay: !!(o.autoPlay && ctx.motion), playInterval: o.playInterval, loop: o.loop,
        show: !ctx.print, left: 6, right: gutter ? gutter + 14 : 8, bottom: 2, height: 36, padding: 0,
        symbol: 'circle', symbolSize: 7,
        lineStyle: { color: t.rule, width: 1.5 }, itemStyle: { color: t.rule, borderWidth: 0 },
        label: { color: t.ink3, fontSize: 10.5, fontFamily: t.fontNum, position: 10 },
        checkpointStyle: { color: t.accent, borderColor: t.paper, borderWidth: 2, symbolSize: 12, animationDuration: Math.min(dur, 500) },
        controlStyle: { showPrevBtn: false, showNextBtn: false, itemSize: 18, color: t.ink3, borderColor: t.ink3, position: 'left' },
        progress: { lineStyle: { color: t.accent }, itemStyle: { color: t.accent }, label: { color: t.ink } },
        emphasis: { label: { color: t.ink }, itemStyle: { color: t.accent }, controlStyle: { color: t.accent, borderColor: t.accent } }
      },
      series: [ref].concat(frames[idx])
    });
    return {
      baseOption: baseOption,
      options: periods.map(function (p, i) { return { series: [ref].concat(frames[i]), graphic: graphic.concat(wm(p)) }; })
    };
  }

  var base = C(build, {
    select: function (p, ctx) {
      if (!p.data || !p.data.row || p.componentType !== 'series') return null;
      var enc = ctx.enc, ds = ctx.dataset;
      var f = enc.label && ds.has(enc.label) ? enc.label : (enc.name && ds.has(enc.name) ? enc.name : null);
      return f ? { field: f, value: p.data.row[f] } : null;
    },
    init: function (inst) {
      inst.on('brushEnd', function (params) { onBrushEnd(params, inst); });
      inst.on('brush', function (params) {
        if (inst.__rkMode === 'select' && params.areas && !params.areas.length && inst.__rk && inst.__rk.selField) {
          RK.store.clearFilter(inst.__rk.ctx.id + ':' + inst.__rk.selField);
        }
      });
      inst.on('timelineplaychanged', function (e) {
        // pressing play on the last period replays from the first one
        var tl = inst.getOption().timeline;
        if (e.playState && tl && tl[0] && !tl[0].loop && tl[0].currentIndex >= tl[0].data.length - 1) {
          inst.dispatchAction({ type: 'timelineChange', currentIndex: 0 });
        }
      });
      inst.on('datazoom', function () {
        var z = zoomState(inst).some(function (d) { return d.start > 0 || d.end < 100; });
        var lab = { axisLabel: { showMinLabel: !z, showMaxLabel: !z } };
        inst.setOption({ xAxis: lab, yAxis: lab });
      });
    }
  });

  RK.component({
    id: 'bubble',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'x', y: 'y', size: 'size', color: null, label: 'label', name: null, target: 'is_target' },
      timeField: null,         // field with periods (year, quarter) -> animated timeline with play button
      startAt: 'last',         // 'last' | 'first' — period shown before playing (print always shows the last)
      autoPlay: false,         // start playing when rendered (never in print / reduced motion)
      playInterval: 1600,      // ms per period
      loop: false,
      trails: true,            // timeline: faint path of each bubble through the periods so far
      colorScale: 'auto',      // 'auto' | 'category' | 'sequential' | 'diverging' (auto: numeric colour field -> continuous)
      mid: 0,                  // diverging midpoint
      sizeRange: [8, 54],      // [min, max] bubble diameter in px; area ∝ value
      labels: 8,               // label the N largest bubbles (true = all, false = none); the target is always labelled
      opacity: 0.82,           // bubble fill opacity (overlaps stay readable)
      sizeLegend: true,        // nested-circle size key (right gutter)
      sizeTitle: null,         // size key title (default: size field title)
      colorTitle: null,        // continuous colour legend title (default: colour field title)
      refLines: [],            // [{axis: 'x' | 'y', value, label, color}] dashed reference lines
      highlight: null,         // label / name value(s) to emphasise; default: rows where encode.target is true
      peerLabel: 'Peers',      // legend name when there is no category colour
      xScale: 'linear',        // 'linear' | 'log'
      yScale: 'linear',
      xFormat: null, yFormat: null, sizeFormat: null, colorFormat: null,
      xTitle: null, yTitle: null,
      tooltipFields: [],
      brush: true,             // box-select tool -> cross-filter on the label field (not in timeline mode)
      zoom: true,              // box zoom, ctrl + wheel zoom, drag to pan and the hover toolbar
      legend: true
    },
    render: function (ctx) {
      var api = base(ctx), inst = api.chart;
      var bar = !ctx.print && ctx.options.zoom !== false ? toolbar(ctx, inst) : null;
      var update = api.update, destroy = api.destroy;
      // timeline options (baseOption + options) cannot be replace-merged: rebuild them in place, keeping the period
      api.update = function (c) {
        if (!c.options.timeField) return update(c);
        var opt = build(c, inst);
        inst.setOption(opt, { notMerge: true });
      };
      api.destroy = function () { if (bar) bar.remove(); destroy(); };
      return api;
    }
  });
})();
