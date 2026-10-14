/*!
 * RK component: calendar-heatmap — two calendar views of time-indexed values:
 *   mode 'daily'   : a calendar of day cells (trading activity, volumes) — weekend rows only when needed,
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
      weekdays: 'auto',      // daily: weekday rows — 'auto' (Sat / Sun only when data falls on a weekend) | 'all' | 'weekdays'
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
    }, { rebuildOnResize: true })   // daily cell size and band wrapping are derived from the block size
  });

  /* ------------------------------------------------------------------ *
   * Daily: a calendar of day cells drawn by the component (week columns x weekday rows).
   * Weekend rows are dropped when no data falls on a weekend (trading days), and a long range wraps
   * into several bands when that gives larger cells (narrow blocks), so the grid fills its block.
   * ------------------------------------------------------------------ */
  var DAY_MS = 864e5;
  function daily(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var df = enc.date, vf = enc.value;
    var fmt = o.format || ctx.fmtOf(vf) || 'auto';
    var pts = ctx.rows.filter(function (r) { return r[df] && U.isNum(r[vf]) && RK.format.toDate(String(r[df]).slice(0, 10)); })
      .map(function (r) { return [String(r[df]).slice(0, 10), r[vf]]; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    if (!pts.length) return { series: [] };
    var values = pts.map(function (p) { return p[1]; });
    var avg = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    var from = o.range ? String(o.range[0]).slice(0, 10) : pts[0][0].slice(0, 8) + '01';
    var to = o.range ? String(o.range[1]).slice(0, 10) : monthEnd(pts[pts.length - 1][0]);
    var d0 = RK.format.toDate(from), d1 = RK.format.toDate(to);
    if (!d0 || !d1 || d1 < d0) return { series: [] };
    var byDay = {};
    pts.forEach(function (p) { byDay[p[0]] = p[1]; });

    // weekday rows (Mon = 0): weekends only when data falls on them (or weekdays: 'all')
    var hasWeekend = o.weekdays === 'all' || (o.weekdays !== 'weekdays' && pts.some(function (p) { var d = RK.format.toDate(p[0]); return d.getDay() === 0 || d.getDay() === 6; }));
    var nRows = hasWeekend ? 7 : 5;

    // months spanned, grouped by year
    var months = [];
    for (var md = new Date(d0.getFullYear(), d0.getMonth(), 1); md <= d1; md = new Date(md.getFullYear(), md.getMonth() + 1, 1)) {
      var a = md < d0 ? d0 : md, b = new Date(md.getFullYear(), md.getMonth() + 1, 0);
      if (b > d1) b = d1;
      months.push({ y: md.getFullYear(), m: md.getMonth(), a: a, b: b });
    }
    var years = U.unique(months.map(function (x) { return x.y; }));
    var multi = years.length > 1, hasLegend = o.legend !== false;
    var W = inst.getWidth(), H = inst.getHeight();
    var left = multi ? 40 : 34, right = 4, legendH = hasLegend ? 34 : 4, monthRow = 18, bandGap = 8;

    // choose how many bands each year wraps into: the split with the largest cells wins (fewer bands on ties)
    function bandsFor(k) {
      var out = [];
      years.forEach(function (y) {
        var ms = months.filter(function (x) { return x.y === y; }), parts = Math.min(k, ms.length), per = Math.ceil(ms.length / parts);
        for (var i = 0; i < ms.length; i += per) out.push({ year: y, months: ms.slice(i, i + per), first: i === 0 });
      });
      out.forEach(function (bd) {
        bd.a = bd.months[0].a; bd.b = bd.months[bd.months.length - 1].b;
        bd.start = new Date(bd.a.getFullYear(), bd.a.getMonth(), bd.a.getDate() - ((bd.a.getDay() + 6) % 7));
        bd.weeks = Math.floor(Math.round((bd.b - bd.start) / DAY_MS) / 7) + 1;
      });
      return out;
    }
    var best = null;
    for (var k = 1; k <= 4; k++) {
      var bands = bandsFor(k);
      var maxWeeks = Math.max.apply(null, bands.map(function (bd) { return bd.weeks; }));
      var cw = (W - left - right) / maxWeeks;
      var chAvail = (H - legendH - bands.length * monthRow - (bands.length - 1) * bandGap - 2) / (bands.length * nRows);
      var size = Math.min(cw, chAvail);
      if (!best || size > best.size + 0.5) best = { bands: bands, cw: cw, ch: chAvail, size: size };
      if (bands.length >= months.length) break;
    }
    var bandsL = best.bands;
    var ch = Math.max(5, Math.min(best.cw, best.ch));
    var cwF = Math.max(5, Math.min(best.cw, ch * 1.6));          // cells may widen a little, never become slabs

    // cell geometry
    var cells = [];                                              // [{x, y, w, h, date, v, band}]
    bandsL.forEach(function (bd, bi) {
      bd.top = legendH + bi * (monthRow + nRows * ch + bandGap);
      for (var d = new Date(bd.a); d <= bd.b; d.setDate(d.getDate() + 1)) {
        var dow = (d.getDay() + 6) % 7;
        if (dow >= nRows) continue;
        var col = Math.floor(Math.round((d - bd.start) / DAY_MS) / 7);
        var iso = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
        cells.push({ x: left + col * cwF, y: bd.top + monthRow + dow * ch, col: col, row: dow, date: iso, v: byDay[iso], band: bi });
      }
    });
    var dataCells = cells.filter(function (c) { return c.v != null; });
    var g = ch >= 10 ? 2 : 1;

    // month separators (stair lines), month / weekday / year labels
    var graphic = [];
    var lineCol = t.axis;              // month boundaries run in the cell gaps, above the cells
    bandsL.forEach(function (bd, bi) {
      var bCells = cells.filter(function (c) { return c.band === bi; });
      var y0 = bd.top + monthRow, y1 = y0 + nRows * ch;
      bd.months.forEach(function (mo, mi) {
        var first = bCells.filter(function (c) { var d = RK.format.toDate(c.date); return d.getMonth() === mo.m && d.getFullYear() === mo.y; })[0];
        if (!first) return;
        var x = left + first.col * cwF, yr = y0 + first.row * ch;
        graphic.push({ type: 'text', silent: true, x: x + 1, y: bd.top + monthRow / 2,
          style: { text: MONTHS[mo.m], fill: t.ink2, font: '11px ' + t.fontSans, align: 'left', verticalAlign: 'middle' } });
        if (mi === 0) return;
        var pts2 = first.row === 0 ? [[x, y0], [x, y1]] : [[x + cwF, y0], [x + cwF, yr], [x, yr], [x, y1]];
        graphic.push({ type: 'polyline', silent: true, z: 5, shape: { points: pts2 }, style: { stroke: lineCol, lineWidth: 1.25, fill: null } });
      });
      ['Mon', '', 'Wed', '', 'Fri', '', ''].slice(0, nRows).forEach(function (lab, r) {
        if (!lab || ch < 8) return;
        graphic.push({ type: 'text', silent: true, x: left - 6, y: y0 + r * ch + ch / 2,
          style: { text: lab, fill: t.ink3, font: '11px ' + t.fontSans, align: 'right', verticalAlign: 'middle' } });
      });
      if (multi && bd.first) {
        graphic.push({ type: 'text', silent: true, x: 0, y: bd.top + monthRow / 2,
          style: { text: String(bd.year), fill: t.ink2, font: '600 11px ' + t.fontSans, align: 'left', verticalAlign: 'middle' } });
      }
    });

    var emptyFill = t.dark ? RK.theme.mix(t.paper, t.ink, 0.035) : t.surface;
    function rect(c) { return { x: c.x + g / 2, y: c.y + g / 2, width: Math.max(1, cwF - g), height: Math.max(1, ch - g) }; }
    var vm = visualDaily(o, t, values, fmt, hasLegend);
    vm.seriesIndex = 1;
    vm.dimension = 1;
    var series = [
      {
        // every day of the range: empty days (holidays) stay distinct from the lowest bucket, also in dark themes
        id: 'days', type: 'custom', coordinateSystem: 'none', silent: true, tooltip: { show: false }, z: 1,
        data: cells.map(function (c, i) { return [i]; }),
        renderItem: function (params) {
          var c = cells[params.dataIndex];
          return { type: 'rect', shape: rect(c), style: { fill: emptyFill } };
        }
      },
      {
        id: 'cal', type: 'custom', coordinateSystem: 'none', z: 2,
        data: dataCells.map(function (c, i) { return [i, c.v]; }),
        renderItem: function (params, api) {
          var c = dataCells[params.dataIndex];
          return { type: 'rect', shape: rect(c), style: { fill: api.visual('color') || emptyFill },
            emphasis: { style: { stroke: t.ink, lineWidth: 1.2 } },
            enterFrom: { style: { opacity: 0 } }, enterAnimation: { delay: Math.min(600, c.col * 12), duration: 360 } };
        }
      }
    ];

    return {
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var c = p.seriesId === 'cal' ? dataCells[p.dataIndex] : null;
          if (!c) return '';
          var dt = RK.format.toDate(c.date);
          var rows = [{ label: ctx.title(vf), value: RK.format(c.v, fmt) }];
          if (avg) rows.push({ label: 'vs. period average', value: RK.format(c.v / avg - 1, '+0.0%;(0.0%);0.0%') });
          return C.tip((dt ? WEEKDAYS[dt.getDay()] + ' ' : '') + RK.format(c.date, 'dd mmm yyyy'), rows);
        }
      },
      visualMap: vm,
      graphic: graphic,
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
    var common = { show: show, orient: 'horizontal', left: 0, top: 0, textStyle: { color: t.ink2, fontSize: 11, fontFamily: t.fontNum } };
    if (scale === 'linear') {
      return U.merge(common, {
        type: 'continuous', min: lo, max: hi, calculable: true, realtime: true,
        itemWidth: 10, itemHeight: 130, formatter: C.tickFmt(fmt),     // per value: whole bounds drop decimals, dragged handles keep them
        inRange: { color: [0.18, 0.4, 0.62, 0.82, 1].map(ramp) },
        outOfRange: { color: t.surface2 || t.surface },
        handleStyle: { borderColor: t.ink3 }, indicatorStyle: { borderColor: t.paper }
      });
    }
    var cuts = U.unique([0.2, 0.4, 0.6, 0.8].map(function (p) { return roundSig(q(p), 2); })).filter(function (v) { return v > lo && v < hi; });
    var cols = [0.18, 0.38, 0.58, 0.78, 1].map(ramp);
    var cut = C.tickFmt(fmt, cuts);         // bucket bounds read like axis ticks: "74–85", not "74.0–85.0"
    var pieces = [];
    for (var i = 0; i <= cuts.length; i++) {
      var p = { color: cols[Math.round(i * (cols.length - 1) / Math.max(1, cuts.length))] };
      if (i > 0) p.gte = cuts[i - 1];
      if (i < cuts.length) p.lt = cuts[i];
      p.label = i === 0 ? '< ' + cut(cuts[0]) : i === cuts.length ? '≥ ' + cut(cuts[i - 1]) : cut(cuts[i - 1]) + '–' + cut(cuts[i]);
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
    // house negatives in brackets: "(5.4%)"; the coloured year / average cells always carry a sign: "+7.8%"
    var base = o.format || ctx.fmtOf(vf) || '0.0%';
    var fmt = negParens(base), sumFmt = signedParens(base);
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
      // the year axis is inverse, so api.size() can be negative: normalise or hit-testing (tooltips) fails
      var c = api.coord([x, y]), s = api.size([1, 1]), w = Math.abs(s[0]), h = Math.abs(s[1]);
      var g = 1.5;
      return { x: c[0] - w / 2 + g + (shift || 0), y: c[1] - h / 2 + g, width: w - 2 * g - (shift || 0), height: h - 2 * g };
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
        var kids = [U.merge({ type: 'rect', shape: U.merge(r, { r: 2 }), style: { fill: fill, stroke: null },
          emphasis: { style: { stroke: t.ink, lineWidth: 1.5 } } }, enter(x, y))];
        var txt = RK.format(v, fmt);
        if (showText && C.measure(txt, font) <= r.width - 4) {          // a figure that does not fit is dropped, never cut
          kids.push(U.merge({ type: 'text', x: r.x + r.width / 2, y: r.y + r.height / 2,
            style: { text: txt, fill: RK.theme.textOn(fill), font: font, align: 'center', verticalAlign: 'middle' } }, enter(x, y)));
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
          var txt = RK.format(v, sumFmt), f = fontB;
          // the year column is set off by a 6px gap; narrow blocks give that room back to the figure first
          var r = cellRect(api, x, y, isTot && C.measure(txt, f) <= cellRect(api, x, y, 6).width - 4 ? 6 : 0);
          if (!isTot) { r.y += 3; r.height -= 3; }
          if (C.measure(txt, f) > r.width - 4) f = '600 10px ' + t.fontNum;
          var ink = !U.isNum(v) ? t.ink3 : v > 0 ? t.pos : v < 0 ? t.neg : t.ink2;
          var kids = [U.merge({ type: 'rect', shape: U.merge(r, { r: 2 }), style: { fill: t.surface, stroke: t.rule, lineWidth: 1 } }, enter(x, y))];
          if (C.measure(txt, f) <= r.width - 2) {              // summary cells keep their figures even when labels = false
            kids.push(U.merge({ type: 'text', x: r.x + r.width / 2, y: r.y + r.height / 2,
              style: { text: txt, fill: ink, font: f, align: 'center', verticalAlign: 'middle' } }, enter(x, y)));
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
            return C.tip(MONTHS[d[0]] + ' ' + yCats[d[1]], [{ label: ctx.title(vf), value: RK.format(d[2], fmt) }]);
          }
          if (d[4] === 'total') {
            var partial = d[3] < 12;
            return C.tip(String(d[5]) + (partial ? ' YTD' : ''), [{ label: (o.compound !== false ? 'Compounded ' : 'Sum of ') + 'monthly ' + ctx.title(vf).toLowerCase(), value: RK.format(d[2], sumFmt) }],
              partial ? d[3] + ' months of data' : null);
          }
          return C.tip(MONTHS[d[0]] + ' average', [{ label: ctx.title(vf), value: RK.format(d[2], sumFmt) }], d[3] + ' years');
        }
      },
      visualMap: {
        show: hasLegend, type: 'continuous', seriesIndex: 0, dimension: 2,
        min: -lim, max: lim, calculable: true, realtime: true,
        orient: 'horizontal', left: 0, top: 0, itemWidth: 10, itemHeight: 140,
        textStyle: { color: t.ink2, fontSize: 11, fontFamily: t.fontNum },
        inRange: { color: divStops(t) },
        outOfRange: { color: t.surface2 || t.surface },
        formatter: C.tickFmt(sumFmt)
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
        axisLabel: { color: t.ink2, fontWeight: 600, fontSize: 11, fontFamily: t.fontNum }
      },
      series: series
    };
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  /** "0.0%" -> "0.0%;(0.0%)": negatives in brackets (a format with its own sections is kept). */
  function negParens(code) {
    return code === 'auto' ? code : RK.format.parens(code);
  }
  /** "0.0%" -> "+0.0%;(0.0%);0.0%": red / green summary figures always carry a sign. */
  function signedParens(code) {
    code = String(RK.format.presets[code] || code);
    if (code === 'auto') return code;
    var b = code.split(';')[0].replace(/^\+/, '');
    return '+' + b + ';(' + b + ');' + b;
  }
  /**
   * Diverging stops from the theme's --rk-div-* tokens. An end that is close to the accent2 target colour
   * (e.g. a navy positive end in a theme whose target is navy) is rebuilt from pos / neg, so a good month
   * never reads as "the target".
   */
  function divStops(t) {
    var st = t.div.slice(), n = st.length, mid = Math.floor(n / 2);
    if (n < 3) return st;
    function rebuild(endIdx, col) {
      var lo = Math.min(endIdx, mid), hi = Math.max(endIdx, mid), span = hi - lo;
      for (var i = lo; i <= hi; i++) {
        if (i === mid) continue;
        var f = Math.abs(i - mid) / span;                          // 0 at the midpoint, 1 at the end
        st[i] = RK.theme.mix(st[mid], col, f);
      }
    }
    if (RK.theme.distance(st[n - 1], t.accent2) < 140) rebuild(n - 1, t.pos);
    if (RK.theme.distance(st[0], t.accent2) < 140) rebuild(0, t.neg);
    return st;
  }

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
})();
