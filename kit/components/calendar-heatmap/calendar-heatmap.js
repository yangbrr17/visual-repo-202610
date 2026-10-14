/*!
 * RK component: calendar-heatmap — two calendar views of time-indexed values:
 *   mode 'daily'   : ECharts calendar coordinate, one cell per day (trading activity, volumes),
 *                    sequential colour with a top-left legend (linear or quantile buckets);
 *   mode 'monthly' : year x month grid (fund-factsheet "monthly returns"), diverging colour around 0,
 *                    formatted values in every cell, compounded full-year column and optional average row.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  RK.component({
    id: 'calendar-heatmap',
    deps: ['echarts'],
    defaults: {
      encode: { date: 'date', value: 'value', year: 'year', month: 'month' },
      mode: 'daily',         // daily (calendar of days) | monthly (year x month grid)
      format: null,          // value format (defaults to the value field format)
      scale: 'auto',         // daily colour scale: auto | linear | quantile (5 buckets; auto = quantile when skewed)
      range: null,           // daily: [from, to] ISO dates (default: whole months spanned by the data)
      yearTotal: true,       // monthly: full-year column
      compound: true,        // monthly: compound monthly returns into the year column (false = sum)
      totalLabel: 'Year',    // monthly: header of the full-year column
      avgRow: false,         // monthly: average of each calendar month as a bottom row
      labels: true,          // monthly: print values in the month cells (year / average cells always show theirs)
      yearOrder: 'desc',     // monthly: 'desc' (latest year on top) | 'asc'
      legend: true
    },
    render: C(function (ctx, inst) {
      return ctx.options.mode === 'monthly' ? monthly(ctx, inst) : daily(ctx, inst);
    })
  });

  /* ------------------------------------------------------------------ *
   * Daily: calendar coordinate system
   * ------------------------------------------------------------------ */
  function daily(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var df = enc.date, vf = enc.value;
    var fmt = o.format || ctx.fmtOf(vf) || 'auto';
    var pts = ctx.rows.filter(function (r) { return r[df] && U.isNum(r[vf]); })
      .map(function (r) { return [String(r[df]).slice(0, 10), r[vf]]; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    if (!pts.length) return { series: [] };
    var values = pts.map(function (p) { return p[1]; });
    var avg = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    var from = o.range ? o.range[0] : pts[0][0].slice(0, 8) + '01';
    var to = o.range ? o.range[1] : monthEnd(pts[pts.length - 1][0]);

    // one calendar per calendar year touched; all share one cell size so weeks line up
    var cals = [];
    for (var y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      var a = y === +from.slice(0, 4) ? from : y + '-01-01', b = y === +to.slice(0, 4) ? to : y + '-12-31';
      cals.push({ range: [a, b], weeks: weeksIn(a, b), year: y });
    }
    var W = inst.getWidth(), H = inst.getHeight();
    var multi = cals.length > 1, hasLegend = o.legend !== false;
    var left = multi ? 64 : 36, right = 8, top = (hasLegend ? 34 : 6) + 18, gap = 28;
    var maxWeeks = Math.max.apply(null, cals.map(function (c) { return c.weeks; }));
    var cw = Math.max(6, (W - left - right) / maxWeeks);
    var ch = Math.max(6, Math.min(cw, (H - top - (cals.length - 1) * gap - 6) / (7 * cals.length)));
    cw = Math.min(cw, Math.max(ch * 1.6, ch));               // keep cells from becoming wide slabs

    var calendar = cals.map(function (c, i) {
      return {
        range: c.range, orient: 'horizontal', left: left, top: top + i * (7 * ch + gap), cellSize: [cw, ch],
        itemStyle: { color: t.surface, borderColor: t.paper, borderWidth: 2 },
        splitLine: { show: true, lineStyle: { color: t.rule, width: 1 } },
        dayLabel: { firstDay: 1, nameMap: ['', 'Mon', '', 'Wed', '', 'Fri', ''], color: t.ink3, fontSize: 10, margin: 6, fontFamily: t.fontSans },
        monthLabel: { nameMap: 'EN', color: t.ink2, fontSize: 10.5, margin: 6, position: 'start', align: 'left', fontFamily: t.fontSans },
        yearLabel: { show: multi, position: 'left', margin: 34, color: t.ink2, fontSize: 11, fontWeight: 600, fontFamily: t.fontSans }
      };
    });

    var vm = visualDaily(o, t, values, fmt, hasLegend);
    var series = cals.map(function (c, i) {
      return {
        id: 'cal-' + i, type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: i,
        data: pts.filter(function (p) { return p[0] >= c.range[0] && p[0] <= c.range[1]; }),
        itemStyle: { borderColor: t.paper, borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.2 } }
      };
    });

    return {
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var d = p.value && p.value[0], v = p.value && p.value[1];
          var dt = RK.format.toDate(d);
          var rows = [{ label: ctx.title(vf), value: RK.format(v, fmt), bold: true }];
          if (avg) rows.push({ label: 'vs. period average', value: RK.format(v / avg - 1, '+0.0%;−0.0%;0.0%') });
          return C.tip((dt ? WEEKDAYS[dt.getDay()] + ' ' : '') + RK.format(d, 'dd mmm yyyy'), rows);
        }
      },
      visualMap: vm,
      calendar: calendar,
      series: series
    };
  }

  /** Sequential legend: continuous (linear) or 5 quantile buckets (robust to spikes). */
  function visualDaily(o, t, values, fmt, show) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var q = function (p) { var i = (sorted.length - 1) * p, lo = Math.floor(i); return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (i - lo); };
    var lo = sorted[0], hi = sorted[sorted.length - 1];
    var scale = o.scale === 'linear' || o.scale === 'quantile' ? o.scale : (hi - q(0.5) > 3 * (q(0.95) - q(0.5)) ? 'quantile' : 'linear');
    var ramp = RK.theme.ramp(t.seq);
    var common = { show: show, orient: 'horizontal', left: 0, top: 0, textStyle: { color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum } };
    if (scale === 'linear') {
      return U.merge(common, {
        type: 'continuous', min: lo, max: hi, calculable: true, realtime: true,
        itemWidth: 10, itemHeight: 130, formatter: function (v) { return RK.format(v, fmt); },
        inRange: { color: [0.12, 0.35, 0.6, 0.82, 1].map(ramp) },
        outOfRange: { color: t.surface2 || t.surface },
        handleStyle: { borderColor: t.ink3 }, indicatorStyle: { borderColor: t.paper }
      });
    }
    var cuts = U.unique([0.2, 0.4, 0.6, 0.8].map(function (p) { return roundSig(q(p), 2); })).filter(function (v) { return v > lo && v < hi; });
    var cols = [0.1, 0.3, 0.52, 0.76, 1].map(ramp);
    var pieces = [];
    for (var i = 0; i <= cuts.length; i++) {
      var p = { color: cols[Math.round(i * (cols.length - 1) / Math.max(1, cuts.length))] };
      if (i > 0) p.gte = cuts[i - 1];
      if (i < cuts.length) p.lt = cuts[i];
      p.label = i === 0 ? '< ' + RK.format(cuts[0], fmt) : i === cuts.length ? '≥ ' + RK.format(cuts[i - 1], fmt) : RK.format(cuts[i - 1], fmt) + '–' + RK.format(cuts[i], fmt);
      pieces.push(p);
    }
    return U.merge(common, {
      type: 'piecewise', pieces: pieces, itemWidth: 12, itemHeight: 10, itemGap: 12, itemSymbol: 'roundRect',
      selectedMode: 'multiple', outOfRange: { color: t.surface2 || t.surface }
    });
  }

  /* ------------------------------------------------------------------ *
   * Monthly: year x month grid with diverging colour
   * ------------------------------------------------------------------ */
  function monthly(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var yf = enc.year, mf = enc.month, vf = enc.value;
    var fmt = o.format || ctx.fmtOf(vf) || '0.0%';
    var cells = {};                                        // year -> [12 values]
    ctx.rows.forEach(function (r) {
      var y = r[yf], m = monthIndex(r[mf]);
      if (y == null || m < 0 || !U.isNum(r[vf])) return;
      (cells[y] || (cells[y] = new Array(12).fill(null)))[m] = r[vf];
    });
    var years = Object.keys(cells).sort();
    if (o.yearOrder !== 'asc') years.reverse();
    var total = o.yearTotal !== false, avgRow = !!o.avgRow;
    var xCats = MONTHS.concat(total ? [o.totalLabel || 'Year'] : []);
    var yCats = years.concat(avgRow ? ['Avg'] : []);

    var main = [], extra = [];
    years.forEach(function (y, yi) {
      cells[y].forEach(function (v, m) { if (v != null) main.push([m, yi, v]); });
      if (total) {
        var vs = cells[y].filter(U.isNum);
        var tot = !vs.length ? null : o.compound !== false ? vs.reduce(function (p, v) { return p * (1 + v); }, 1) - 1 : vs.reduce(function (p, v) { return p + v; }, 0);
        extra.push([12, yi, tot, vs.length, 'total', y]);
      }
    });
    if (avgRow) {
      for (var m = 0; m < 12; m++) {
        var col = years.map(function (y) { return cells[y][m]; }).filter(U.isNum);
        if (col.length) extra.push([m, years.length, col.reduce(function (a, b) { return a + b; }, 0) / col.length, col.length, 'avg', null]);
      }
    }
    var absMax = Math.max.apply(null, main.map(function (c) { return Math.abs(c[2]); }).concat([1e-9]));
    var lim = niceCeil(absMax);
    var hasLegend = o.legend !== false;
    var font = '500 10.5px ' + t.fontNum, fontB = '600 10.5px ' + t.fontNum;
    var showText = o.labels !== false;

    function cellRect(api, x, y, shift) {
      var c = api.coord([x, y]), s = api.size([1, 1]);
      var g = 1.5;
      return { x: c[0] - s[0] / 2 + g + (shift || 0), y: c[1] - s[1] / 2 + g, width: s[0] - 2 * g - (shift || 0), height: s[1] - 2 * g };
    }
    function enter(x, y) {
      return { enterFrom: { style: { opacity: 0 } }, enterAnimation: { delay: (x + y) * 22, duration: 420 } };
    }

    var series = [{
      id: 'cells', type: 'custom', data: main, encode: { x: 0, y: 1, tooltip: 2 },
      renderItem: function (params, api) {
        var x = api.value(0), y = api.value(1), v = api.value(2);
        var fill = api.visual('color') || t.surface;
        var r = cellRect(api, x, y);
        var kids = [U.merge({ type: 'rect', shape: U.merge(r, { r: 2 }), style: { fill: fill } }, enter(x, y))];
        if (showText && r.width > 26) {
          kids.push(U.merge({ type: 'text', x: r.x + r.width / 2, y: r.y + r.height / 2,
            style: { text: RK.format(v, fmt), fill: textOn(fill, t), font: font, align: 'center', verticalAlign: 'middle' } }, enter(x, y)));
        }
        return { type: 'group', children: kids };
      }
    }];
    if (extra.length) {
      series.push({
        id: 'totals', type: 'custom', data: extra, encode: { x: 0, y: 1, tooltip: 2 },
        renderItem: function (params, api) {
          var x = api.value(0), y = api.value(1), v = api.value(2);
          var isTot = x === 12;
          var r = cellRect(api, x, y, isTot ? 6 : 0);
          if (!isTot) { r.y += 3; r.height -= 3; }
          var ink = !U.isNum(v) ? t.ink3 : v > 0 ? t.pos : v < 0 ? t.neg : t.ink2;
          var kids = [U.merge({ type: 'rect', shape: U.merge(r, { r: 2 }), style: { fill: t.surface, stroke: t.rule, lineWidth: 1 } }, enter(x, y))];
          if (r.width > 26) {                                  // summary cells keep their figures even when labels = false
            kids.push(U.merge({ type: 'text', x: r.x + r.width / 2, y: r.y + r.height / 2,
              style: { text: RK.format(v, fmt), fill: ink, font: fontB, align: 'center', verticalAlign: 'middle' } }, enter(x, y)));
          }
          return { type: 'group', children: kids };
        }
      });
    }

    return {
      grid: { left: 4, right: 4, top: hasLegend ? 54 : 26, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var d = p.data;
          if (!d) return '';
          if (p.seriesId === 'cells') {
            return C.tip(MONTHS[d[0]] + ' ' + yCats[d[1]], [{ label: ctx.title(vf), value: RK.format(d[2], fmt), bold: true }]);
          }
          if (d[4] === 'total') {
            var partial = d[3] < 12;
            return C.tip(String(d[5]) + (partial ? ' YTD' : ''), [{ label: (o.compound !== false ? 'Compounded ' : 'Sum of ') + 'monthly ' + ctx.title(vf).toLowerCase(), value: RK.format(d[2], fmt), bold: true }],
              partial ? d[3] + ' months of data' : null);
          }
          return C.tip(MONTHS[d[0]] + ' average', [{ label: ctx.title(vf), value: RK.format(d[2], fmt), bold: true }], d[3] + ' years');
        }
      },
      visualMap: {
        show: hasLegend, type: 'continuous', seriesIndex: 0, dimension: 2,
        min: -lim, max: lim, calculable: true, realtime: true,
        orient: 'horizontal', left: 0, top: 0, itemWidth: 10, itemHeight: 140,
        textStyle: { color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum },
        inRange: { color: t.div.slice() },
        outOfRange: { color: t.surface2 || t.surface },
        formatter: function (v) { return RK.format(v, fmt); }
      },
      xAxis: {
        type: 'category', data: xCats, position: 'top',
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: t.ink2, fontWeight: 600, fontSize: 11, interval: 0,
          formatter: function (v) { return v; } }
      },
      yAxis: {
        type: 'category', data: yCats.map(String), inverse: true,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: t.ink, fontWeight: 600, fontSize: 11, fontFamily: t.fontNum }
      },
      series: series
    };
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  /** 1..12, "1".."12", "Jan".."Dec" or "January"... -> 0..11 (else -1). */
  function monthIndex(m) {
    if (U.isNum(m)) return m >= 1 && m <= 12 ? Math.round(m) - 1 : -1;
    var s = String(m || '').trim();
    if (/^\d+$/.test(s)) return monthIndex(+s);
    var i = MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(s.slice(0, 3).toLowerCase());
    return i;
  }

  function monthEnd(iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    var d = new Date(y, m, 0).getDate();
    return iso.slice(0, 8) + ('0' + d).slice(-2);
  }

  /** Number of Monday-start week columns a date range occupies. */
  function weeksIn(a, b) {
    var d0 = RK.format.toDate(a), d1 = RK.format.toDate(b);
    var days = Math.round((d1 - d0) / 864e5) + 1;
    return Math.ceil((((d0.getDay() + 6) % 7) + days) / 7);
  }

  function roundSig(v, n) {
    if (!v) return v;
    var p = Math.pow(10, n - Math.ceil(Math.log10(Math.abs(v))));
    return Math.round(v * p) / p;
  }

  /** Symmetric legend bound: 0.1138 -> 0.12, 0.191 -> 0.2. */
  function niceCeil(v) {
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= v - 1e-12) return steps[i] * mag;
    return 10 * mag;
  }

  /** Readable text on a fill in any theme (dark themes have a light ink, so "dark text" is the paper colour). */
  function textOn(fill, t) { return RK.theme.onColor(fill, t.dark ? t.paper : t.ink, t.dark ? t.ink : '#fff'); }
})();
