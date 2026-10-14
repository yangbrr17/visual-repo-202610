/*!
 * RK component: combo — columns + line on dual axes (e.g. revenue bars with EBITDA margin line in %).
 * Bars: wide (encode.bars = [fields]) or long (encode.bars = field + encode.series = field); line: [fields].
 * Estimate years are drawn lighter + hatched on a "Projected" band; optional CAGR brackets.
 * The default 'band' layout keeps the line in its own band above the bars so labels never collide.
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util;
  // legend glyph for line series: a rule with a dot; the two empty sub-paths keep the 14x14 box square
  var LINE_ICON = 'path://M7,0L7,0Z M7,14L7,14Z M0,6.4L14,6.4L14,7.6L0,7.6Z M9.4,6L9.4,8L8,9.4L6,9.4L4.6,8L4.6,6L6,4.6L8,4.6Z';

  RK.component({
    id: 'combo',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'year', bars: ['revenue'], series: null, line: ['ebitda_margin'], period: 'period' },
      layout: 'band',              // band (line in its own band above the bars) | overlay (classic dual axes)
      barStack: false,             // stack the bar series
      labels: 'auto',              // true | false | 'auto' | 'bars' | 'line'
      format: null,                // bar value format (defaults to the first bar field's format)
      lineFormat: null,            // line value format (defaults to the first line field's format)
      lineAxisFormat: null,        // right-axis tick format (defaults to lineFormat, trimmed when ticks are whole)
      forecastFrom: 'auto',        // x value where estimates start | 'auto' (period field "E…" or x ending in E/F/B) | null
      forecastLabel: 'Projected',  // caption over the estimate band ('' = none)
      cagr: false,                 // false | true (first -> last) | 'split' (actuals + estimates) | {from, to, label, field} | [...]
      cagrFormat: '0.0%',
      legend: true,
      zoom: false
    },
    render: C(function (ctx, inst) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var d = prepare(ctx);
      var cats = d.cats, bars = d.bars, lines = d.lines, n = cats.length;
      var fi = forecastIndex(ctx, cats, d.byX);
      var isEst = function (i) { return fi >= 0 && i >= fi; };
      var sel = ctx.selected(enc.x);
      var bfmt = o.format || ctx.fmtOf(bars.length ? bars[0].field : null) || 'auto';
      var lfmt = o.lineFormat || ctx.fmtOf(lines.length ? lines[0].field : null) || '0.0%';
      var band = o.layout !== 'overlay';
      // primary line in accent2; bars and further lines from the palette, kept clear of it
      var pal = RK.theme.palette({ n: bars.length + lines.length });
      var ord = o.barStack && bars.length > 1 && bars.length <= t.ord.length;   // stacked bars: parts of a whole
      var barColor = function (i) { return bars.length === 1 ? t.accent : ord ? t.ord[i] : pal[i]; };
      var lineColor = function (i) { return i === 0 ? t.accent2 : i === 1 ? t.ink3 : pal[bars.length + i - 2]; };

      // per-category bar tops (stack totals or tallest bar) — used for scales, labels and CAGR legs
      var pos = [], neg = [], tops = [];
      for (var i = 0; i < n; i++) {
        var p = 0, q = 0, mx = null;
        bars.forEach(function (b) {
          var v = b.values[i];
          if (!U.isNum(v)) return;
          if (v >= 0) p += v; else q += v;
          mx = mx == null ? v : Math.max(mx, v);
        });
        pos.push(p); neg.push(q);
        tops.push(o.barStack ? p : (mx == null ? 0 : Math.max(0, mx)));
      }
      var hi = Math.max(0, Math.max.apply(null, tops.concat([0])));
      var lo = o.barStack ? Math.min(0, Math.min.apply(null, neg.concat([0])))
        : Math.min(0, U.extent([].concat.apply([], bars.map(function (b) { return b.values; })))[0]);

      // labels: 'auto' = on when the bars are wide enough to carry them
      var groups = o.barStack ? 1 : Math.max(1, bars.length);
      var barPx = (inst.getWidth() - 110) / Math.max(1, n) * 0.62 / groups;
      var autoBars = barPx >= 34 && n <= 16, autoLine = n <= 16;
      var showBarLabels = o.labels === true || o.labels === 'bars' || (o.labels === 'auto' && autoBars);
      var showLineLabels = o.labels === true || o.labels === 'line' || (o.labels === 'auto' && autoLine);
      var labelPad = showBarLabels ? 18 : 6;

      var cagrs = cagrSpecs(o.cagr, cats, fi);
      var lineVals = [].concat.apply([], lines.map(function (l) { return l.values; })).filter(U.isNum);
      var hasLine = lineVals.length > 0;

      /* ---------------- value axes ---------------- */
      var hasLegend = o.legend !== false && bars.length + lines.length > 1;
      var gridTop = hasLegend ? 40 : (fi >= 0 && o.forecastLabel ? 24 : 12);
      var plotH = Math.max(120, inst.getHeight() - gridTop - (o.zoom && !ctx.print ? 56 : 26));
      var lineLo = 0.72, lineHi = 0.92;
      var yLeft, yRight = null, lAxisFmt = o.lineAxisFormat || lfmt;
      var lmin = hasLine ? Math.min.apply(null, lineVals) : 0, lmax = hasLine ? Math.max.apply(null, lineVals) : 0;
      if (band) {
        // share of the plot height used by the bars: leave room for bar labels, CAGR pills and the line band
        var room = labelPad + (cagrs.length ? 16 + 18 : 14);
        var barTop = hasLine ? Math.min(0.62, Math.max(0.4, (lineLo * plotH - room) / plotH))
          : (cagrs.length ? Math.min(0.84, (plotH - room - 12) / plotH) : null);
        if (barTop) {
          var bstep = U.niceStep(hi - lo || 1, 4);
          var bmin = lo < 0 ? Math.floor(lo / bstep) * bstep : 0;
          var bmax = bmin + (hi - bmin) / barTop;
          var bticks = [];
          for (var bv = bmin; bv <= Math.ceil(hi / bstep) * bstep + 1e-9 && bv <= bmax; bv += bstep) bticks.push(+bv.toPrecision(12));
          yLeft = {
            type: 'value', min: bmin, max: bmax,
            axisLabel: { customValues: bticks, formatter: C.tickFmt(bfmt, bstep) },
            axisTick: { show: false, customValues: bticks }
          };
        } else {
          var astep = U.niceStep(hi - lo || 1, 5);
          var amin = Math.floor(lo / astep) * astep, amax = Math.ceil(hi / astep) * astep;
          yLeft = { type: 'value', min: amin, max: amax > amin ? amax : amin + astep, interval: astep, axisLabel: { formatter: C.tickFmt(bfmt, astep) } };
        }
        if (hasLine) {
          // the line gets its own band [lineLo, lineHi] of the plot; right-axis labels only inside it
          var lspan = lmax - lmin || Math.abs(lmax) * 0.25 || 1;
          var lstep = U.niceStep(lspan, 2);
          var range = lspan / (lineHi - lineLo);
          var A = lmin - lineLo * range, B = A + range;
          var lticks = [];
          for (var lv = Math.floor(lmin / lstep) * lstep; lv <= Math.ceil(lmax / lstep) * lstep + 1e-9; lv += lstep) {
            if (lv >= A && lv <= B) lticks.push(+lv.toPrecision(12));
          }
          yRight = {
            type: 'value', position: 'right', min: A, max: B, splitLine: { show: false },
            axisLabel: { customValues: lticks, formatter: C.tickFmt(lAxisFmt, o.lineAxisFormat ? null : lstep) },
            axisTick: { show: false, customValues: lticks }
          };
        }
      } else {
        // overlay: classic dual axes; both scales computed here so ticks align and formats are stable
        var top = cagrs.length ? hi / 0.8 : hi;
        var ostep = U.niceStep(top - lo || 1, 5);
        var omin = lo < 0 ? Math.floor(lo / ostep) * ostep : 0;
        var omax = Math.ceil(top / ostep) * ostep;
        var k = Math.max(1, Math.round((omax - omin) / ostep));
        yLeft = { type: 'value', min: omin, max: omax, interval: ostep, axisLabel: { formatter: C.tickFmt(bfmt, ostep) } };
        if (hasLine) {
          var al = alignScale(lmin, lmax, k);
          yRight = { type: 'value', position: 'right', min: al.min, max: al.max, interval: al.step, splitLine: { show: false },
            axisLabel: { formatter: C.tickFmt(lAxisFmt, o.lineAxisFormat ? null : al.step) } };
        }
      }
      yLeft.splitLine = { show: true };
      var yAxes = yRight ? [yLeft, yRight] : [yLeft];

      /* ---------------- series ---------------- */
      function estStyle(base) {
        return {
          color: RK.theme.mix(base, t.paper, 0.62),
          borderColor: base, borderWidth: 1,
          decal: { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [1.5, 3.5], rotation: -Math.PI / 4, color: RK.theme.alpha(base, 0.5) }
        };
      }
      var series = [];
      bars.forEach(function (b, bi) {
        var base = barColor(bi);
        series.push({
          id: 'b-' + bi, name: b.name, type: 'bar', yAxisIndex: 0,
          stack: o.barStack ? 'bars' : null,
          barGap: '14%', barCategoryGap: groups > 1 ? '30%' : '36%',
          z: 2,
          itemStyle: { color: base },          // series colour also drives the legend icon
          label: showBarLabels ? C.label(ctx, bfmt, o.barStack ? {
            position: 'inside', fontSize: 10.5, color: RK.theme.textOn(base),
            formatter: function (p) { return U.isNum(p.value) && Math.abs(p.value) >= (hi - lo) * 0.07 ? RK.format(p.value, bfmt) : ''; }
          } : { position: 'top', distance: 4, fontSize: 10.5, color: t.ink2 }) : { show: false },
          data: b.values.map(function (v, i) {
            var st = isEst(i) ? estStyle(base) : { color: base };
            st.color = C.dim(ctx, enc.x, cats[i], st.color);
            if (isEst(i) && sel.length && sel.indexOf(cats[i]) < 0) {   // dim the hatch and outline too
              st.borderColor = RK.theme.alpha(base, 0.25);
              st.decal.color = RK.theme.alpha(base, 0.12);
            }
            if (o.barStack && isEst(i)) st.color = C.dim(ctx, enc.x, cats[i], RK.theme.mix(base, t.paper, 0.45));
            return { value: v, itemStyle: st, label: o.barStack && isEst(i) ? { color: RK.theme.textOn(RK.theme.mix(base, t.paper, 0.45)) } : undefined };
          })
        });
      });
      // stack totals sit on an invisible zero-height series, as in the bar component
      if (o.barStack && bars.length > 1 && showBarLabels) {
        series.push({
          id: 'b-total', name: 'Total', type: 'bar', stack: 'bars', silent: true, yAxisIndex: 0,
          itemStyle: { color: 'transparent' }, tooltip: { show: false },
          label: { show: true, position: 'insideBottom', distance: 4, color: t.ink, fontWeight: 600, fontSize: 10.5, fontFamily: t.fontNum,
            formatter: function (p) { return RK.format(pos[p.dataIndex], bfmt); } },
          data: cats.map(function () { return 0; })
        });
      }
      lines.forEach(function (l, li) {
        var col = lineColor(li);
        var labCol = RK.theme.mix(col, t.ink, 0.35);
        var common = {
          type: 'line', name: l.name, yAxisIndex: yRight ? 1 : 0, z: 5,
          symbol: 'circle', symbolSize: 6, showSymbol: true,
          lineStyle: { width: 2, color: col },
          itemStyle: { color: col, borderColor: t.paper, borderWidth: 1 },
          emphasis: { focus: 'none', scale: 1.3 },
          label: showLineLabels ? { show: true, position: 'top', distance: 6, color: labCol, fontSize: 10.5, fontWeight: 600, fontFamily: t.fontNum,
            // overlay: the line crosses the bars, so its labels sit on small paper chips
            backgroundColor: band ? null : RK.theme.alpha(t.paper, 0.92), padding: band ? 0 : [1, 3], borderRadius: 2,
            formatter: function (p) { return RK.format(p.value, lfmt); } } : { show: false }
        };
        var split = fi > 0 && fi < n;
        // estimate points are hollow (per item, so the legend keeps the solid series colour)
        var hollow = { color: t.paper, borderColor: col, borderWidth: 1.5 };
        if (!split) {
          series.push(U.merge({}, common, { id: 'l-' + li, data: l.values.map(function (v, i) {
            return isEst(i) ? { value: v, itemStyle: hollow } : v;
          }) }, fi === 0 ? { lineStyle: { type: [4, 3] } } : {}));
          return;
        }
        series.push(U.merge({}, common, { id: 'l-' + li, data: l.values.map(function (v, i) { return i < fi ? v : null; }) }));
        series.push(U.merge({}, common, {
          id: 'l-' + li + '-e', lineStyle: { type: [4, 3] },
          data: l.values.map(function (v, i) {
            if (i < fi - 1) return null;
            return i === fi - 1 ? { value: v, symbolSize: 0, label: { show: false } } : { value: v, itemStyle: hollow };
          })
        }));
      });

      // estimate band + divider + caption (custom series so it tracks zoom / resize)
      if (fi >= 0 && fi < n) {
        var caption = o.forecastLabel ? String(o.forecastLabel).toUpperCase() : '';
        series.push({
          id: 'fc-band', type: 'custom', silent: true, z: 0, clip: false, tooltip: { show: false }, yAxisIndex: 0,
          data: [[fi, 0]],
          renderItem: function (params, api) {
            var cs = params.coordSys, w = api.size([1, 0])[0];
            var x = api.coord([fi, 0])[0] - w / 2, right = cs.x + cs.width;
            if (x >= right - 1) return null;
            var x0 = Math.max(cs.x, x);
            var kids = [{ type: 'rect', shape: { x: x0, y: cs.y, width: right - x0, height: cs.height }, style: { fill: RK.theme.alpha(t.ink, t.dark ? 0.05 : 0.028) } }];
            if (x > cs.x + 1) kids.push({ type: 'line', shape: { x1: x, y1: cs.y - 6, x2: x, y2: cs.y + cs.height }, style: { stroke: t.axis, lineWidth: 1, lineDash: [3, 3] } });
            if (caption) kids.push({ type: 'text', x: x0 + 6, y: cs.y - 3, style: { text: caption, fill: t.ink3, font: '600 9.5px ' + t.fontSans, align: 'left', verticalAlign: 'bottom' } });
            return { type: 'group', children: kids };
          }
        });
      }

      // CAGR brackets: elbow from the first bar up, across, down to an arrow on the last bar
      if (cagrs.length) {
        var level = 0;
        cagrs.forEach(function (s) {
          s.idx = s.field ? Math.max(0, seriesIndex(bars, s.field)) : 0;
          s.values = o.barStack ? (s.field ? bars[s.idx].values : pos) : (bars[s.idx] ? bars[s.idx].values : []);
          s.end = o.barStack ? pos : s.values;
          s.rate = cagrRate(s.values[s.from], s.values[s.to], periodsBetween(cats[s.from], cats[s.to], s.to - s.from));
          s.text = (s.label || (cagrs.length > 1 ? shortX(cats[s.from]) + '–' + shortX(cats[s.to]) + ' CAGR' : 'CAGR')) + ': ' + RK.format(s.rate, o.cagrFormat);
          for (var k = s.from; k <= s.to; k++) level = Math.max(level, tops[k]);
          s.padL = cagrs.some(function (x) { return x !== s && x.to === s.from; }) ? 5 : 0;
          s.padR = cagrs.some(function (x) { return x !== s && x.from === s.to; }) ? 5 : 0;
        });
        var ink = t.ink3;
        series.push({
          id: 'cagr', type: 'custom', silent: true, z: 6, clip: false, tooltip: { show: false }, yAxisIndex: 0,
          data: cagrs.map(function (s, k) { return [s.from, s.to, k]; }),
          renderItem: function (params, api) {
            var s = cagrs[params.dataIndex];
            if (!s) return null;
            // grouped bars: offset the legs onto the series' own bar (barCategoryGap 30%, barGap 14%)
            var off = 0;
            if (!o.barStack && groups > 1) {
              var area = api.size([1, 0])[0] * 0.7, bw = area / (groups + (groups - 1) * 0.14);
              off = -area / 2 + s.idx * bw * 1.14 + bw / 2;
            }
            var x1 = api.coord([s.from, 0])[0] + off + s.padL, x2 = api.coord([s.to, 0])[0] + off - s.padR;
            var yTop = api.coord([0, level])[1] - labelPad - 16;
            var y1 = api.coord([s.from, Math.max(0, s.end[s.from] || 0)])[1] - labelPad - 2;
            var y2 = api.coord([s.to, Math.max(0, s.end[s.to] || 0)])[1] - labelPad - 1;
            var accent = t.dark ? t.ink : t.accent;
            var fade = { style: { opacity: 0 } };
            return {
              type: 'group',
              children: [
                { type: 'polyline', shape: { points: [[x1, y1], [x1, yTop], [x2, yTop], [x2, y2 - 5]] }, style: { stroke: ink, lineWidth: 1, fill: null }, enterFrom: fade },
                { type: 'polygon', shape: { points: [[x2 - 3.5, y2 - 6], [x2 + 3.5, y2 - 6], [x2, y2]] }, style: { fill: ink }, enterFrom: fade },
                { type: 'text', x: (x1 + x2) / 2, y: yTop, enterFrom: fade,
                  style: { text: s.text, align: 'center', verticalAlign: 'middle', fill: accent, font: '600 10.5px ' + t.fontNum,
                    backgroundColor: t.paper, borderColor: accent, borderWidth: 1, borderRadius: 10, padding: [3, 9] } }
              ]
            };
          }
        });
      }

      return {
        legend: C.legend(ctx, {
          show: hasLegend,
          data: bars.map(function (b) { return b.name; }).concat(lines.map(function (l) { return { name: l.name, icon: LINE_ICON, itemStyle: { color: lineColor(lines.indexOf(l)), borderWidth: 0 } }; }))
        }),
        grid: C.grid(ctx, { top: gridTop, right: hasLine ? 6 : 12, bottom: o.zoom && !ctx.print ? 30 : 4 }),
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: function (ps) {
            if (!ps || !ps.length) return '';
            var i = cats.indexOf(ps[0].axisValue);
            if (i < 0) i = ps[0].dataIndex;
            var shown = ps.map(function (p) { return p.seriesName; });
            var rows = [];
            bars.forEach(function (b, bi) {
              if (shown.indexOf(b.name) >= 0) rows.push({ color: barColor(bi), label: b.name, value: RK.format(b.values[i], bfmt) });
            });
            if (o.barStack && bars.length > 1) rows.push({ label: 'Total', value: RK.format(pos[i] + neg[i], bfmt), bold: true });
            lines.forEach(function (l, li) {
              if (shown.indexOf(l.name) >= 0) rows.push({ color: lineColor(li), label: l.name, value: RK.format(l.values[i], lfmt) });
            });
            return C.tip(cats[i], rows, isEst(i) ? (o.forecastLabel || 'Estimate') : null);
          }
        },
        xAxis: { type: 'category', data: cats, axisLabel: { interval: 0, hideOverlap: true } },
        yAxis: yAxes,
        dataZoom: o.zoom ? C.zoom(ctx, 'x') : [],
        series: series
      };
    }, {
      rebuildOnResize: true,     // label density and the band split depend on the plot size
      select: function (p, ctx) { return /^b-\d+$/.test(p.seriesId) ? { field: ctx.enc.x, value: p.name } : null; }
    })
  });

  /* ------------------------------------------------------------------ *
   * Data helpers
   * ------------------------------------------------------------------ */

  /** Categories (first-seen order), bar series and line series aggregated per x. */
  function prepare(ctx) {
    var enc = ctx.enc, rows = ctx.rows, xf = enc.x;
    var cats = U.unique(rows.map(function (r) { return r[xf]; }).filter(function (v) { return v != null && v !== ''; }));
    var byX = U.groupBy(rows, function (r) { return r[xf]; });
    function agg(list, field, how) {
      var vals = (list || []).map(function (r) { return r[field]; }).filter(U.isNum);
      if (!vals.length) return null;
      var s = vals.reduce(function (a, b) { return a + b; }, 0);
      return how === 'avg' ? s / vals.length : s;
    }
    var bars = [];
    if (enc.bars && !Array.isArray(enc.bars) && enc.series) {
      U.unique(rows.map(function (r) { return r[enc.series]; })).forEach(function (name) {
        bars.push({ name: name, field: enc.bars, values: cats.map(function (c) {
          return agg(byX.get(c).filter(function (r) { return r[enc.series] === name; }), enc.bars, 'sum');
        }) });
      });
    } else {
      [].concat(enc.bars || []).filter(Boolean).forEach(function (f) {
        bars.push({ name: ctx.title(f), field: f, values: cats.map(function (c) { return agg(byX.get(c), f, 'sum'); }) });
      });
    }
    // line fields are ratios in most decks (margin, growth) -> average duplicate rows rather than sum
    var lines = [].concat(enc.line || []).filter(Boolean).map(function (f) {
      return { name: ctx.title(f), field: f, values: cats.map(function (c) { return agg(byX.get(c), f, 'avg'); }) };
    });
    return { cats: cats, byX: byX, bars: bars, lines: lines };
  }

  /** Index of the first estimate category, or -1. */
  function forecastIndex(ctx, cats, byX) {
    var f = ctx.options.forecastFrom, enc = ctx.enc;
    if (f == null || f === false || f === '') return -1;
    if (f !== 'auto') {
      for (var j = 0; j < cats.length; j++) if (String(cats[j]) === String(f)) return j;
      return -1;
    }
    var pf = enc.period && ctx.dataset && ctx.dataset.has(enc.period) ? enc.period : null;
    for (var i = 0; i < cats.length; i++) {
      if (pf) {
        var p = byX.get(cats[i])[0][pf];
        if (p != null && /^[EFPB]/i.test(String(p))) return i;
      } else if (/\d\s*[EFB]$/i.test(String(cats[i]))) return i;
    }
    return -1;
  }

  function cagrSpecs(c, cats, fi) {
    var n = cats.length;
    if (!c || n < 2) return [];
    if (c === true) return [{ from: 0, to: n - 1 }];
    if (c === 'split') {
      return fi > 1 && fi < n ? [{ from: 0, to: fi - 1 }, { from: fi - 1, to: n - 1 }] : [{ from: 0, to: n - 1 }];
    }
    function at(v, dflt) {
      if (v == null) return dflt;
      for (var i = 0; i < n; i++) if (String(cats[i]) === String(v)) return i;
      return -1;
    }
    return [].concat(c).filter(U.isObj).map(function (s) {
      return { from: at(s.from, 0), to: at(s.to, n - 1), label: s.label, field: s.field };
    }).filter(function (s) { return s.from >= 0 && s.to > s.from; });
  }

  function seriesIndex(bars, key) {
    for (var i = 0; i < bars.length; i++) if (bars[i].field === key || bars[i].name === key) return i;
    return -1;
  }

  /** Line-axis scale with exactly k nice intervals covering [lo, hi] (ticks align with the bar axis). */
  function alignScale(lo, hi, k) {
    var raw = (hi - lo) / k || Math.abs(hi) / k || 1;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var cands = [1, 2, 2.5, 5, 10, 20, 25, 50];
    for (var i = 0; i < cands.length; i++) {
      var st = cands[i] * mag, mn = Math.floor(lo / st + 1e-9) * st;
      if (mn + k * st >= hi - 1e-12) return { min: +mn.toPrecision(12), max: +(mn + k * st).toPrecision(12), step: st };
    }
    return { min: lo, max: hi, step: (hi - lo) / k };
  }

  /** Number of years between two x labels ("2019A" -> "2025A" = 6), else the index distance. */
  function periodsBetween(a, b, dflt) {
    var ya = String(a).match(/(\d{4})/), yb = String(b).match(/(\d{4})/);
    return ya && yb && +yb[1] > +ya[1] ? +yb[1] - +ya[1] : dflt;
  }

  function cagrRate(v0, v1, n) {
    if (!U.isNum(v0) || !U.isNum(v1)) return null;
    if (v0 <= 0 || v1 < 0 || !n) return NaN;            // -> "n.m."
    return Math.pow(v1 / v0, 1 / n) - 1;
  }

  /** "2019A" -> "'19A" for compact bracket captions. */
  function shortX(x) { return String(x).replace(/^(?:FY)?(\d{2})(\d{2})/, '’$2'); }
})();
