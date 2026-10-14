/*!
 * RK component: small-multiples — a grid of mini line / area / bar charts, one panel per facet value,
 * all in ONE ECharts instance (one grid + axis pair per panel). Shared or independent y scale,
 * compact axes, last-value labels, optional "ghost" context lines and a linked crosshair.
 * The pixel layout is recomputed on resize (rebuildOnResize) so panels keep exact gutters and label room.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'smallMultiples.dateAxis': 'yy"年"m"月"', 'smallMultiples.dateLong': 'yyyy"年"m"月"d"日"', 'smallMultiples.more': '另有 {n} 个未显示'
    });
  }

  RK.component({
    id: 'small-multiples',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'year', y: 'revenue', facet: 'segment' },
      type: 'area',          // line | area | bar
      columns: null,         // panels per row (null = auto from the available width)
      sharedY: true,         // one y scale for every panel (true) or one per panel (false)
      highlight: null,       // facet value(s) drawn in accent2 (e.g. the target)
      ghost: false,          // other facets as faint context lines in every panel
      baseline: null,        // horizontal reference value, e.g. 100 for rebased prices
      lastLabel: true,       // value label at the last point
      showChange: true,      // first -> last % change in each panel header
      sort: null,            // null (data order) | 'last-desc' | 'last-asc' | 'name'
      agg: 'sum',            // duplicate rows per facet and x: sum | avg | last
      maxPanels: 24,         // panel cap (also limited to what fits the block height); the rest are noted as "+N more"
      format: null,          // value format (defaults to the y field format)
      dateFormat: 'mmm yy'   // time-axis label format (date x fields)
    },
    render: function (ctx) {
      var state = { facets: [] };                                   // per-instance: facet order for click -> filter
      return C(function (c, chart) { return build(c, chart, state); }, {
        rebuildOnResize: true,                                      // panel geometry is in pixels
        select: function (p, c, chart) {
          var sm = chart.getModel().getSeriesByIndex(p.seriesIndex);   // line-body clicks carry no seriesId
          var m = /^f-(\d+)$/.exec(sm ? sm.id : '');
          return m ? { field: c.enc.facet, value: state.facets[+m[1]] } : null;      // the raw facet value
        }
      })(ctx);
    }
  });

  function build(ctx, chart, state) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var d = prepare(ctx);
    var facets = d.facets, xs = d.xs, vals = d.values;
    var fmt = o.format || ctx.fmtOf(enc.y) || 'auto';
    var type = o.type === 'bar' || o.type === 'line' ? o.type : 'area';
    var hl = (o.highlight == null ? [] : [].concat(o.highlight)).map(keyOf);
    var sel = ctx.selected(enc.facet).map(keyOf);
    var W = chart.getWidth(), H = chart.getHeight();
    var gapX = 22, gapY = 12, headH = 24, xLabH = 18, MIN_CELL = headH + xLabH + 56;   // panels keep a readable plot
    if (!facets.length) { state.facets = []; return { series: [] }; }

    /* ---------------- panel cap: a high-cardinality facet field must not freeze the report ---------------- */
    function colsFor(k) {
      if (o.columns) return Math.max(1, Math.min(k, o.columns | 0));
      var c = Math.max(1, Math.min(k, Math.floor((W + gapX) / (210 + gapX))));
      return Math.ceil(k / Math.ceil(k / c));                       // balance rows (5 -> 3 + 2, not 4 + 1)
    }
    var maxP = Math.max(1, (o.maxPanels | 0) || 24), hidden = 0;
    // up to maxPanels are always drawn (squeezed if need be); beyond that only what fits the block height
    var cap = facets.length <= maxP ? maxP
      : Math.min(maxP, colsFor(maxP) * Math.max(1, Math.floor((H - 18 + gapY) / (MIN_CELL + gapY))));
    if (facets.length > cap) {
      // keep the first `cap` panels in sort order, highlighted facets always included
      var keep = facets.slice(0, cap);
      facets.slice(cap).forEach(function (f) {
        if (hl.indexOf(f) < 0) return;
        for (var r = keep.length - 1; r >= 0; r--) if (hl.indexOf(keep[r]) < 0) { keep.splice(r, 1); break; }
        keep.push(f);
      });
      hidden = facets.length - keep.length;
      if (typeof console !== 'undefined') console.warn('[RK] small-multiples: ' + facets.length + ' facets, showing ' + keep.length + ' (options.maxPanels / block height)');
      facets = keep;
      H -= 18;                                                         // room for the "+N more" note
    }
    var n = facets.length;
    state.facets = facets.map(function (f) { return d.raw[f]; });

    /* ---------------- scales ---------------- */
    var zero = type !== 'line';
    function scaleOf(list) {
      var e = U.extent(list.filter(U.isNum).concat(o.baseline != null ? [o.baseline] : []));
      var lo = e[0], hi = e[1];
      if (!U.isNum(lo) || !U.isNum(hi)) { lo = 0; hi = 1; }             // no numeric data: a harmless 0..1 frame
      if (zero && lo >= 0) lo = 0;
      if (type === 'bar' && o.lastLabel !== false && hi > 0) hi += (hi - lo) * 0.1;   // headroom for the last-bar label
      var step = U.niceStep((hi - lo) || Math.abs(hi) || 1, 3);
      var mn = Math.floor(lo / step) * step, mx = Math.ceil(hi / step) * step;
      if (mx === mn) mx = mn + step;
      return { min: mn, max: mx, step: step };
    }
    var all = [].concat.apply([], facets.map(function (f) { return vals[f]; }));
    var shared = o.sharedY !== false ? scaleOf(all) : null;
    var scales = facets.map(function (f) { return shared || scaleOf(o.ghost ? all : vals[f]); });

    /* ---------------- pixel layout ---------------- */
    var fTick = '11px ' + t.fontNum, fLast = '600 10.5px ' + t.fontNum;
    var yLabW = Math.max.apply(null, scales.map(function (s) {
      var w = 0, f = C.tickFmt(fmt, s.step);
      for (var v = s.min; v <= s.max + 1e-9; v += s.step) w = Math.max(w, measure(f(v), fTick));
      return w;
    })) + 8;
    var lasts = facets.map(function (f) { return lastOf(vals[f]); });
    var rightPad = o.lastLabel !== false && type !== 'bar'
      ? Math.max.apply(null, lasts.map(function (v) { return measure(RK.format(v, fmt), fLast); })) + 10 : 6;
    var cols = colsFor(n);
    var rowsN = Math.ceil(n / cols);
    var perColY = shared ? 0 : yLabW;
    var plotW = Math.max(40, (W - (shared ? yLabW : 0) - cols * (perColY + rightPad) - (cols - 1) * gapX) / cols);
    var cellH = (H - (rowsN - 1) * gapY) / rowsN;
    var plotH = Math.max(30, cellH - headH - xLabH);

    var grids = [], xAxes = [], yAxes = [], series = [], graphic = [];
    var isTime = d.isTime, dfmt = !o.dateFormat || o.dateFormat === 'mmm yy' ? tr('smallMultiples.dateAxis', 'mmm yy') : o.dateFormat;
    facets.forEach(function (f, i) {
      var c = i % cols, r = Math.floor(i / cols);
      var left = (shared ? yLabW : 0) + c * (perColY + plotW + rightPad + gapX) + perColY;
      var top = r * (cellH + gapY);
      var isHl = hl.indexOf(f) >= 0, dim = sel.length > 0 && sel.indexOf(f) < 0;
      var col = isHl ? t.accent2 : t.accent;
      var name = String(d.raw[f]);
      if (dim) col = RK.theme.alpha(col, 0.3);
      var showX = i + cols >= n;                                   // nothing below this panel
      var showY = !shared || c === 0;
      var s = scales[i];

      grids.push({ left: left, top: top + headH, width: plotW, height: plotH, containLabel: false });
      xAxes.push(U.merge({
        gridIndex: i, axisTick: { show: false }, splitLine: { show: false },
        axisLine: { show: true, lineStyle: { color: t.axis } },
        axisPointer: { label: { show: false } },
        axisLabel: { show: showX, fontSize: 11, hideOverlap: true }          // house axis size, theme colours
      }, isTime
        ? { type: 'time', min: xs[0], max: xs[xs.length - 1], splitNumber: 3, axisLabel: { formatter: function (v) { return RK.format(new Date(v), dfmt); } } }
        : { type: 'category', data: xs, boundaryGap: type === 'bar', axisLabel: { interval: 'auto' } }));
      yAxes.push({
        // squeezed panels: fewer ticks rather than labels printed over each other (11px labels need ~14px)
        gridIndex: i, type: 'value', min: s.min, max: s.max, interval: s.step * Math.max(1, Math.ceil((s.max - s.min) / s.step / Math.max(1, Math.floor(plotH / 14)))),
        axisLabel: { show: showY, fontSize: 11, formatter: C.tickFmt(fmt, s.step) },
        splitLine: { show: true, lineStyle: { color: t.grid } },
        axisPointer: { show: false }
      });

      // header: facet name, first -> last change, hairline
      var chg = changeOf(vals[f]);
      var cellL = left, cellR = left + plotW + rightPad;
      graphic.push({ type: 'text', silent: true, x: cellL, y: top + 4,
        // target title in the text-safe accent (accent2 itself is for marks), 11px / 600 like other panel headers
        style: { text: name, fill: dim ? t.ink3 : (isHl ? t.accent2Ink : t.ink), font: '600 11px ' + t.fontSans, textAlign: 'left', align: 'left' } });
      if (o.showChange !== false && chg != null) {
        graphic.push({ type: 'text', silent: true, x: cellR, y: top + 5,
          style: { text: RK.format(chg, '+0.0%;−0.0%;0.0%'), fill: !isFinite(chg) ? t.ink3 : chg >= 0 ? t.pos : t.neg, font: '600 10.5px ' + t.fontNum, textAlign: 'right', align: 'right' } });
      }
      graphic.push({ type: 'line', silent: true, shape: { x1: cellL, y1: top + headH - 5, x2: cellR, y2: top + headH - 5 }, style: { stroke: t.rule, lineWidth: 1 } });

      // ghost context: every other facet as a faint line
      if (o.ghost && type !== 'bar') {
        facets.forEach(function (g, j) {
          if (g === f) return;
          series.push({
            id: 'g-' + i + '-' + j, type: 'line', xAxisIndex: i, yAxisIndex: i, silent: true, z: 1,
            showSymbol: false, tooltip: { show: false }, emphasis: { disabled: true },
            lineStyle: { width: 1, color: RK.theme.alpha(t.ink3, t.dark ? 0.35 : 0.28) },
            data: dataOf(g)
          });
        });
      }
      var main = {
        id: 'f-' + i, name: name, type: type === 'bar' ? 'bar' : 'line', xAxisIndex: i, yAxisIndex: i, z: 3,
        data: dataOf(f),
        itemStyle: { color: col },
        emphasis: { focus: 'none' }
      };
      if (type === 'bar') {
        main.barCategoryGap = '28%';
        if (o.lastLabel !== false) {
          main.data = main.data.map(function (v, k) {
            return k === xs.length - 1 ? { value: v, label: { show: true, position: 'top', distance: 3, formatter: function (p) { return RK.format(p.value, fmt); },
              color: t.ink, fontWeight: 600, fontSize: 10.5, fontFamily: t.fontNum } } : v;
          });
        }
      } else {
        main.showSymbol = false;
        main.triggerLineEvent = true;     // the whole line is clickable (cross-filter), as in the line component
        main.symbol = 'circle';
        main.symbolSize = 5;
        main.lineStyle = { width: isHl ? 2.2 : 1.8, color: col };
        if (type === 'area') main.areaStyle = { color: RK.theme.alpha(isHl ? t.accent2 : t.accent, dim ? 0.04 : 0.12) };
        if (o.lastLabel !== false && lasts[i] != null) {
          var lv = vals[f], li = lv.length - 1;
          while (li > 0 && !U.isNum(lv[li])) li--;
          var lab = { color: dim ? t.ink3 : t.ink, fontWeight: 600, fontSize: 10.5, fontFamily: t.fontNum };
          if (li > 0 && U.isNum(lv[li - 1])) {
            main.endLabel = U.merge({ show: true, distance: 4, formatter: function () { return RK.format(lasts[i], fmt); } }, lab);
          } else {
            // an isolated last point has no line end to hang an endLabel on (ECharts would place it at NaN):
            // position the label in pixels from the panel geometry instead
            var fx = isTime ? frac(xs[li], xs[0], xs[xs.length - 1]) : (xs.length > 1 ? li / (xs.length - 1) : 0.5);
            var fy = (lasts[i] - s.min) / ((s.max - s.min) || 1);
            graphic.push({ type: 'text', silent: true, x: left + plotW * fx + 6, y: top + headH + plotH * (1 - fy),
              style: { text: RK.format(lasts[i], fmt), fill: lab.color, font: '600 10.5px ' + t.fontNum, align: 'left', verticalAlign: 'middle' } });
          }
        }
      }
      if (o.baseline != null) {
        main.markLine = { silent: true, symbol: ['none', 'none'], label: { show: false }, animation: false,
          lineStyle: { color: t.ink3, type: [3, 3], width: 1 }, data: [{ yAxis: o.baseline }] };
      }
      series.push(main);
    });

    function dataOf(f) {
      // trailing gaps are trimmed: the end label sits on the last real point (a null end would place it at NaN)
      var v = vals[f], end = v.length;
      while (end > 0 && !U.isNum(v[end - 1])) end--;
      return isTime ? xs.slice(0, end).map(function (x, k) { return [x, v[k]]; }) : v.slice(0, end);
    }
    if (hidden) {
      graphic.push({ type: 'text', silent: true, left: 0, bottom: 0,
        style: { text: tr('smallMultiples.more', '+{n} more not shown', { n: hidden }), fill: t.ink3, font: '11px ' + t.fontSans } });
    }

    return {
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      graphic: graphic,
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: t.axis, type: 'dashed' } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: function (ps) {
          ps = (ps || []).filter(function (p) { return /^f-\d+$/.test(p.seriesId); });
          if (!ps.length) return '';
          var k = ps[0].dataIndex, hover = ps.map(function (p) { return p.seriesName; });
          var rows = facets.map(function (f) {
            var nm = String(d.raw[f]);
            return { color: hl.indexOf(f) >= 0 ? t.accent2 : t.accent, label: nm, value: RK.format(vals[f][k], fmt), bold: hover.indexOf(nm) >= 0 && facets.length > 1 };
          });
          var head = isTime ? RK.format(xs[k], tr('smallMultiples.dateLong', 'dd mmm yyyy')) : xs[k];
          return C.tip(head, rows);
        }
      },
      series: series
    };
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  /** -> {facets, xs, values: {facet: [v per x]}, isTime}; duplicate rows aggregated with options.agg. */
  function prepare(ctx) {
    var enc = ctx.enc, o = ctx.options, rows = ctx.rows;
    var xf = enc.x, yf = enc.y, ff = enc.facet;
    var fld = ctx.field(xf);
    var isTime = !!(fld && fld.type === 'date');
    var xs = U.unique(rows.map(function (r) { return r[xf]; }).filter(function (v) { return v != null && v !== ''; }));
    if (isTime) xs.sort();
    var xi = new Map(xs.map(function (x, i) { return [x, i]; }));
    // facets are keyed by their string form (array cells by JSON) so any cell value groups predictably;
    // raw keeps the original value for cross-filtering and the panel title
    var raw = Object.create(null), facets = [];
    rows.forEach(function (r) {
      var v = r[ff];
      if (v == null || v === '') return;
      var key = keyOf(v);
      if (!(key in raw)) { raw[key] = v; facets.push(key); }
    });
    var acc = Object.create(null);
    facets.forEach(function (f) { acc[f] = xs.map(function () { return []; }); });
    rows.forEach(function (r) {
      var f = r[ff] == null ? null : keyOf(r[ff]), k = xi.get(r[xf]);
      if (f != null && acc[f] && k != null && U.isNum(r[yf])) acc[f][k].push(r[yf]);
    });
    var values = Object.create(null);
    facets.forEach(function (f) {
      values[f] = acc[f].map(function (list) {
        if (!list.length) return null;
        if (o.agg === 'last') return list[list.length - 1];
        var s = list.reduce(function (a, b) { return a + b; }, 0);
        return o.agg === 'avg' ? s / list.length : s;
      });
    });
    if (o.sort === 'name') facets.sort(function (a, b) { return a.localeCompare(b); });
    else if (o.sort === 'last-desc' || o.sort === 'last-asc') {
      var dir = o.sort === 'last-asc' ? 1 : -1;
      facets.sort(function (a, b) { return ((lastOf(values[a]) || 0) - (lastOf(values[b]) || 0)) * dir; });
    }
    return { facets: facets, raw: raw, xs: xs, values: values, isTime: isTime };
  }

  function keyOf(v) { return Array.isArray(v) ? JSON.stringify(v) : String(v); }

  function lastOf(list) {
    for (var i = list.length - 1; i >= 0; i--) if (U.isNum(list[i])) return list[i];
    return null;
  }
  function firstOf(list) {
    for (var i = 0; i < list.length; i++) if (U.isNum(list[i])) return list[i];
    return null;
  }
  /** First -> last % change; null when undefined, NaN (-> "n.m.") when the base is not positive. */
  function changeOf(list) {
    var a = firstOf(list), b = lastOf(list);
    if (a == null || b == null) return null;
    return a > 0 ? b / a - 1 : NaN;
  }

  function measure(text, font) { return Math.ceil(C.measure(text, font)); }

  /** Position of date x between a and b as a 0..1 fraction (time axes). */
  function frac(x, a, b) {
    var tx = +RK.format.toDate(x), ta = +RK.format.toDate(a), tb = +RK.format.toDate(b);
    return tb > ta && isFinite(tx) ? Math.max(0, Math.min(1, (tx - ta) / (tb - ta))) : 1;
  }
})();
