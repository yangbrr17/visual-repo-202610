/*!
 * RK component: small-multiples — a grid of mini line / area / bar charts, one panel per facet value,
 * all in ONE ECharts instance (one grid + axis pair per panel). Shared or independent y scale,
 * compact axes, last-value labels, optional "ghost" context lines and a linked crosshair.
 * The pixel layout is recomputed on resize (rebuildOnResize) so panels keep exact gutters and label room.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;

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
          return m ? { field: c.enc.facet, value: state.facets[+m[1]] } : null;
        }
      })(ctx);
    }
  });

  function build(ctx, chart, state) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var d = prepare(ctx);
    var facets = d.facets, xs = d.xs, vals = d.values, n = facets.length;
    state.facets = facets;
    var fmt = o.format || ctx.fmtOf(enc.y) || 'auto';
    var type = o.type === 'bar' || o.type === 'line' ? o.type : 'area';
    var hl = o.highlight == null ? [] : [].concat(o.highlight);
    var sel = ctx.selected(enc.facet);
    var W = chart.getWidth(), H = chart.getHeight();
    if (!n) return { series: [] };

    /* ---------------- scales ---------------- */
    var zero = type !== 'line';
    function scaleOf(list) {
      var e = U.extent(list.concat(o.baseline != null ? [o.baseline] : []));
      var lo = e[0], hi = e[1];
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
    var fTick = '10px ' + t.fontNum, fLast = '600 10.5px ' + t.fontNum;
    var yLabW = Math.max.apply(null, scales.map(function (s) {
      var w = 0, f = tickFmt(fmt, s.step);
      for (var v = s.min; v <= s.max + 1e-9; v += s.step) w = Math.max(w, measure(f(v), fTick));
      return w;
    })) + 8;
    var lasts = facets.map(function (f) { return lastOf(vals[f]); });
    var rightPad = o.lastLabel !== false && type !== 'bar'
      ? Math.max.apply(null, lasts.map(function (v) { return measure(RK.format(v, fmt), fLast); })) + 10 : 6;
    var gapX = 22, gapY = 12, headH = 24, xLabH = 18;
    var cols = o.columns || (function () {
      var c = Math.max(1, Math.min(n, Math.floor((W + gapX) / (210 + gapX))));
      return Math.ceil(n / Math.ceil(n / c));                       // balance rows (5 -> 3 + 2, not 4 + 1)
    })();
    cols = Math.max(1, Math.min(n, cols | 0));
    var rowsN = Math.ceil(n / cols);
    var perColY = shared ? 0 : yLabW;
    var plotW = Math.max(40, (W - (shared ? yLabW : 0) - cols * (perColY + rightPad) - (cols - 1) * gapX) / cols);
    var cellH = (H - (rowsN - 1) * gapY) / rowsN;
    var plotH = Math.max(30, cellH - headH - xLabH);

    var grids = [], xAxes = [], yAxes = [], series = [], graphic = [];
    var isTime = d.isTime, dfmt = o.dateFormat || 'mmm yy';
    facets.forEach(function (f, i) {
      var c = i % cols, r = Math.floor(i / cols);
      var left = (shared ? yLabW : 0) + c * (perColY + plotW + rightPad + gapX) + perColY;
      var top = r * (cellH + gapY);
      var isHl = hl.indexOf(f) >= 0, dim = sel.length > 0 && sel.indexOf(f) < 0;
      var col = isHl ? t.accent2 : t.accent;
      if (dim) col = RK.theme.alpha(col, 0.3);
      var showX = i + cols >= n;                                   // nothing below this panel
      var showY = !shared || c === 0;
      var s = scales[i];

      grids.push({ left: left, top: top + headH, width: plotW, height: plotH, containLabel: false });
      xAxes.push(U.merge({
        gridIndex: i, axisTick: { show: false }, splitLine: { show: false },
        axisLine: { show: true, lineStyle: { color: t.axis } },
        axisPointer: { label: { show: false } },
        axisLabel: { show: showX, fontSize: 10, hideOverlap: true }          // compact panels: 10px, theme colours
      }, isTime
        ? { type: 'time', min: xs[0], max: xs[xs.length - 1], splitNumber: 3, axisLabel: { formatter: function (v) { return RK.format(new Date(v), dfmt); } } }
        : { type: 'category', data: xs, boundaryGap: type === 'bar', axisLabel: { interval: 'auto' } }));
      yAxes.push({
        gridIndex: i, type: 'value', min: s.min, max: s.max, interval: s.step,
        axisLabel: { show: showY, fontSize: 10, formatter: tickFmt(fmt, s.step) },
        splitLine: { show: true, lineStyle: { color: t.grid } },
        axisPointer: { show: false }
      });

      // header: facet name, first -> last change, hairline
      var chg = changeOf(vals[f]);
      var cellL = left, cellR = left + plotW + rightPad;
      graphic.push({ type: 'text', silent: true, x: cellL, y: top + 4,
        style: { text: String(f), fill: dim ? t.ink3 : (isHl ? RK.theme.mix(t.accent2, t.ink, t.dark ? 0 : 0.35) : t.ink), font: '600 11.5px ' + t.fontSans, textAlign: 'left', align: 'left' } });
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
        id: 'f-' + i, name: String(f), type: type === 'bar' ? 'bar' : 'line', xAxisIndex: i, yAxisIndex: i, z: 3,
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
        if (o.lastLabel !== false) {
          main.endLabel = { show: true, distance: 4, color: dim ? t.ink3 : t.ink, fontWeight: 600, fontSize: 10.5, fontFamily: t.fontNum,
            formatter: function () { return RK.format(lasts[i], fmt); } };
        }
      }
      if (o.baseline != null) {
        main.markLine = { silent: true, symbol: ['none', 'none'], label: { show: false }, animation: false,
          lineStyle: { color: t.ink3, type: [3, 3], width: 1 }, data: [{ yAxis: o.baseline }] };
      }
      series.push(main);
    });

    function dataOf(f) {
      return isTime ? xs.map(function (x, k) { return [x, vals[f][k]]; }) : vals[f].slice();
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
            return { color: hl.indexOf(f) >= 0 ? t.accent2 : t.accent, label: String(f), value: RK.format(vals[f][k], fmt), bold: hover.indexOf(String(f)) >= 0 && facets.length > 1 };
          });
          var head = isTime ? RK.format(xs[k], 'dd mmm yyyy') : xs[k];
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
    var facets = U.unique(rows.map(function (r) { return r[ff]; }).filter(function (v) { return v != null && v !== ''; }));
    var acc = {};
    facets.forEach(function (f) { acc[f] = xs.map(function () { return []; }); });
    rows.forEach(function (r) {
      var f = r[ff], k = xi.get(r[xf]);
      if (acc[f] && k != null && U.isNum(r[yf])) acc[f][k].push(r[yf]);
    });
    var values = {};
    facets.forEach(function (f) {
      values[f] = acc[f].map(function (list) {
        if (!list.length) return null;
        if (o.agg === 'last') return list[list.length - 1];
        var s = list.reduce(function (a, b) { return a + b; }, 0);
        return o.agg === 'avg' ? s / list.length : s;
      });
    });
    if (o.sort === 'name') facets.sort(function (a, b) { return String(a).localeCompare(String(b)); });
    else if (o.sort === 'last-desc' || o.sort === 'last-asc') {
      var dir = o.sort === 'last-asc' ? 1 : -1;
      facets.sort(function (a, b) { return ((lastOf(values[a]) || 0) - (lastOf(values[b]) || 0)) * dir; });
    }
    return { facets: facets, xs: xs, values: values, isTime: isTime };
  }

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
})();
