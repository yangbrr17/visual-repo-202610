/*!
 * RK component: lollipop — ranking with thin stems and dots: a calmer alternative to bars when there
 * are many categories. Sorted, target highlighted (accent-2 dot, bold label, tinted row), median /
 * mean reference line, optional second value per row (e.g. 2025E vs 2026E) drawn as a hollow dot
 * joined to the first by a light band. Optional colouring by group (sector / region).
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
      'lollipop.ref': '参考值', 'lollipop.change': '变动', 'lollipop.vs': '较{Name}'
    });
  }

  var isNum = util.isNum;
  function stat(name, a) { return RK.expr.agg[name](a.filter(isNum)); }   // median / mean of finite values

  /** Axis tick format: the value format with no more decimals than the tick step needs (5x not 5.0x). */
  function tickFmt(fmt, step) {
    var code = RK.format.presets[fmt] || fmt;
    if (typeof code !== 'string' || !step || !/[0#]/.test(code) || RK.format.isDateCode(code)) return fmt;
    var sec = code.split(';')[0].replace(/"[^"]*"/g, ''), scale = Math.pow(1000, ((sec.match(/[0#](,+)[^0#]*$/) || [])[1] || '').length);
    var v = Math.abs(step) * (/%/.test(sec) ? 100 : 1) / scale, dec = 0;
    while (dec < 4 && Math.abs(Math.round(v * Math.pow(10, dec)) - v * Math.pow(10, dec)) > 1e-6) dec++;
    return code.replace(/([0#])\.([0#]+)/g, function (m, a, d) { var n = Math.min(dec, d.length); return a + (n ? '.' + d.slice(0, n) : ''); });
  }

  var MINUS = '\u2212';
  /** Value text with a true minus sign (the signed delta columns use U+2212 too). */
  function num(v, f) { return RK.format(v, f).replace(/^-/, MINUS); }
  /** Signed value with a true minus sign. */
  function signed(v, f) {
    if (!isNum(v)) return RK.format(v, f);
    var s = RK.format(Math.abs(v), f);
    return v > 0 ? '+' + s : v < 0 && /[1-9]/.test(s) ? MINUS + s : s;
  }
  function pct(v) { return signed(v, '0.0%'); }
  /** Percent formats: differences of two percentages are percentage points, not relative %. */
  function isPct(f) {
    var code = RK.format.presets[f] || f;
    return typeof code === 'string' && /%/.test(code.split(';')[0].replace(/"[^"]*"/g, ''));
  }
  function ppDiff(d, f) {
    var dec = RK.format.decimals(f) || 0;
    return signed(isNum(d) ? d * 100 : d, '0' + (dec ? '.' + new Array(dec + 1).join('0') : '') + '"pp"');
  }

  /** Is row r highlighted (boolean field such as is_target, or label listed in options.highlight)? */
  function highlighter(ctx) {
    var enc = ctx.enc, list = ctx.options.highlight == null ? [] : [].concat(ctx.options.highlight);
    var hf = enc.highlight && ctx.dataset && ctx.dataset.has(enc.highlight) ? enc.highlight : null;
    return function (r) { return (hf && !!r[hf] && r[hf] !== 'false') || list.indexOf(r[enc.label]) >= 0; };
  }

  /**
   * Tinted full-width row band behind highlighted categories (like .rk-table tr.is-target). On dark paper an
   * alpha tint of accent-2 turns muddy, so it stays faint and a 2px accent-2 rule marks the row instead.
   */
  function rowBand(ctx, idx, horiz) {
    var t = ctx.theme;
    return {
      id: 'band', type: 'custom', silent: true, z: 0, tooltip: { show: false }, animation: false,
      renderItem: function (params, api) {
        var cs = params.coordSys, p = api.coord(horiz ? [0, api.value(0)] : [api.value(0), 0]);
        var bw = horiz ? api.size([0, 1])[1] : api.size([1, 0])[0];
        var shape = horiz ? { x: 0, y: p[1] - bw / 2, width: api.getWidth(), height: bw }
          : { x: p[0] - bw / 2, y: cs.y, width: bw, height: cs.height + 40 };
        var kids = [{ type: 'rect', shape: shape, style: { fill: RK.theme.alpha(t.accent2, t.dark ? 0.09 : 0.11) } }];
        if (t.dark) kids.push({ type: 'rect', shape: horiz ? { x: 0, y: shape.y, width: 2, height: bw } : { x: shape.x, y: cs.y, width: bw, height: 2 }, style: { fill: t.accent2 } });
        return { type: 'group', children: kids };
      },
      data: idx.map(function (i) { return [i]; })
    };
  }

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var horiz = o.orientation !== 'vertical';
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var pctFmt = isPct(fmt);
    var has2 = !!(enc.value2 && ctx.dataset && ctx.dataset.has(enc.value2));
    var isHi = highlighter(ctx);

    var rows = ctx.rows.slice();
    if (o.sort === 'asc' || o.sort === 'desc') {
      var dir = o.sort === 'asc' ? 1 : -1;
      rows.sort(function (a, b) {
        var x = a[enc.value], y = b[enc.value];
        if (!isNum(x)) return isNum(y) ? 1 : 0;
        if (!isNum(y)) return -1;
        return (x - y) * dir;
      });
    }
    var labels = rows.map(function (r) { return r[enc.label]; });
    var v1 = rows.map(function (r) { return isNum(r[enc.value]) ? r[enc.value] : null; });
    var v2 = rows.map(function (r) { return has2 && isNum(r[enc.value2]) ? r[enc.value2] : null; });
    var hi = rows.map(isHi);
    var hiIdx = [];
    hi.forEach(function (h, i) { if (h) hiIdx.push(i); });

    // ---- colours ----
    var groups = enc.group ? util.unique(rows.map(function (r) { return r[enc.group]; }).filter(function (g) { return g != null; })) : [];
    var groupPal = RK.theme.palette({ n: groups.length });   // never resembles the accent-2 target
    function baseColor(r, i) {
      if (hi[i]) return t.accent2;
      if (groups.length) return groupPal[groups.indexOf(r[enc.group])] || t.neutral;
      return t.peer || t.accent;   // one peer colour across the kit
    }
    var colors = rows.map(function (r, i) { return C.dim(ctx, enc.label, r[enc.label], baseColor(r, i)); });

    // ---- reference statistic ----
    var statRows = o.refExcludeHighlight ? v1.filter(function (_, i) { return !hi[i]; }) : v1;
    var ref = o.refLine === 'median' || o.refLine === 'mean' ? stat(o.refLine, statRows) : isNum(o.refLine) ? o.refLine : null;
    var refName = o.refLabel || (o.refLine === 'median' ? tr('median', 'Median') : o.refLine === 'mean' ? tr('mean', 'Mean') : tr('lollipop.ref', 'Ref.'));

    // ---- end-label text and the vertical band width (labels wider than a band turn 90°) ----
    var numFont = '11px ' + t.fontNum;
    function endText(i) {
      var s = num(v1[i], fmt);
      return has2 && v2[i] != null ? s + ' / ' + num(v2[i], fmt) : s;
    }
    var bandPx = Math.max(8, ((inst.getWidth() || 600) - 56) / Math.max(1, labels.length));   // ~value-axis labels + margins
    var endW = 0, catW = 0;
    rows.forEach(function (r, i) {
      if (o.labels !== false) endW = Math.max(endW, C.measure(endText(i), (hi[i] ? '600 ' : '') + numFont));
      catW = Math.max(catW, C.measure(labels[i], (hi[i] ? '600 ' : '') + '11px ' + t.fontSans));
    });
    var rotVal = !horiz && o.labels !== false && endW > bandPx - 4;
    var rotCat = !horiz && catW > bandPx - 6;

    // ---- value axis bounds with room for end labels ----
    var ext = util.extent(v1.concat(v2, [0, ref], (o.refLines || []).map(function (r) { return r.value; })));
    var span = (ext[1] - ext[0]) || Math.abs(ext[1]) || 1;
    // end labels may run into the grid margin: keep the axis on nice steps, widen the margin instead
    var labelPx = o.labels === false ? 0 : (horiz ? (has2 ? 88 : 44) : rotVal ? endW + 8 : 20);
    var plotPx = Math.max(160, horiz ? inst.getWidth() - 190 : inst.getHeight() - 70 - (rotCat ? 20 : 0));
    var step = util.niceStep(span * 1.04, horiz ? 6 : 5);
    var axMax = ext[1] > 0 ? Math.ceil(ext[1] / step) * step : 0;
    var axMin = ext[0] < 0 ? Math.floor(ext[0] / step) * step : 0;
    var room = function (gap) { return labelPx - gap / ((axMax - axMin) || 1) * plotPx; };
    for (var k = 0; k < 3 && !horiz && room(axMax - ext[1]) > 0; k++) axMax += step;     // vertical: keep labels inside the plot
    if (ext[0] < 0 && room(ext[0] - axMin) > 0) axMin -= step;      // negative labels never overlap category labels
    var marginR = horiz ? Math.max(20, room(axMax - ext[1]) + 8) : 20;

    var size = o.dotSize || 9;
    // statistic: ink-3 dashed 1px, regular italic label; reference (offer / target multiple): --rk-ref 1.2px, semibold italic
    // vertical: the label sits at whichever end of the line is clear of dots and value labels (end preferred)
    function sideOf(value, text) {
      if (horiz) return 'start';
      var perPx = ((axMax - axMin) || 1) / Math.max(60, plotPx), cols = Math.ceil((C.measure(text, 'italic 10.5px ' + t.fontNum) + 6) / bandPx);
      var lo = value + 2 * perPx, hi = value + 18 * perPx;
      function clash(from, to) {
        for (var i = Math.max(0, from); i < Math.min(rows.length, to); i++) {
          var v = v2[i] != null && v1[i] != null ? Math.max(v1[i], v2[i]) : v1[i];
          if (v == null) continue;
          var top = v + (o.labels === false ? size / 2 : size / 2 + 5 + labelPx) * perPx, bot = Math.min(v, v1[i]) - size / 2 * perPx;
          if (top > lo && bot < hi) return true;
        }
        return false;
      }
      return !clash(rows.length - cols, rows.length) || clash(0, cols) ? 'insideEndTop' : 'insideStartTop';
    }
    function lineItem(name, value, color, width, labelColor, weight) {
      var d = { name: name, value: value, lineStyle: { color: color, type: [4, 3], width: width } };
      d[horiz ? 'xAxis' : 'yAxis'] = value;
      var text = C.richSafe((name ? name + ' ' : '') + num(value, fmt));
      d.label = {
        show: true, position: sideOf(value, text), distance: 4, color: labelColor || color, fontSize: 10.5, fontFamily: t.fontNum,
        fontStyle: 'italic', fontWeight: weight || 400, textBorderColor: t.paper, textBorderWidth: 3,
        formatter: function () { return text; }   // a function: data text is never read as a {a}/{b}/{c} template
      };
      return d;
    }

    var stagger = Math.min(45, 700 / Math.max(1, rows.length));
    var delay = function (i) { return i * stagger; };
    var at = function (v, i) { return horiz ? [v, i] : [i, v]; };

    var series = [];
    if (hiIdx.length && o.highlightBand !== false) series.push(rowBand(ctx, hiIdx, horiz));

    // stems: thin bars from zero to the primary value
    series.push({
      id: 'stem', name: '_stem', type: 'bar', barWidth: 1.6, z: 2,
      animationDelay: delay, emphasis: { disabled: true }, tooltip: { show: false }, silent: true,
      data: v1.map(function (v, i) { return { value: v, itemStyle: { color: RK.theme.alpha(colors[i], hi[i] ? 0.95 : 0.7) } }; })
    });

    // light band between the two values (second-value variant)
    if (has2) {
      series.push({
        id: 'gap', type: 'custom', z: 3, silent: true, tooltip: { show: false },
        animationDelay: function (i) { return i * stagger + 300; },
        renderItem: function (params, api) {
          if (isNaN(api.value(1)) || isNaN(api.value(2))) return null;
          var a = api.coord(at(api.value(1), api.value(0))), b = api.coord(at(api.value(2), api.value(0)));
          return {
            type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
            style: { stroke: RK.theme.alpha(colors[params.dataIndex] || t.accent, 0.3), lineWidth: Math.max(3, size * 0.55), lineCap: 'round' },
            enterFrom: { style: { opacity: 0 } }
          };
        },
        data: v1.map(function (v, i) { return v != null && v2[i] != null ? [i, v, v2[i]] : [i, NaN, NaN]; })
      });
    }

    // primary dots
    series.push({
      id: 'dot', name: ctx.title(enc.value), type: 'scatter', z: 5, symbol: 'circle',
      animationDelay: function (i) { return i * stagger + 200; },
      itemStyle: { color: t.accent },
      data: v1.map(function (v, i) {
        return { name: labels[i], value: at(v, i), symbolSize: hi[i] ? size + 2 : size, itemStyle: { color: colors[i], borderColor: t.paper, borderWidth: 1 } };
      }),
      // precision 10: the line sits at the exact statistic (the default 2 decimals moved 0.2152 to 0.22);
      // z below the end-label series so value labels (with a paper halo) are never struck through
      markLine: (ref != null || (o.refLines || []).length) ? {
        silent: true, symbol: ['none', 'none'], animation: false, precision: 10, z: 4,
        // statistic: ink-3 dashed; user reference lines (offer / target multiple): --rk-ref, label in the line colour
        data: (ref != null ? [lineItem(refName, ref, t.ink3, 1, t.ink2, 400)] : []).concat((o.refLines || []).map(function (r) {
          return lineItem(r.label || '', r.value, r.color || t.ref, 1.2, null, 600);
        }))
      } : undefined
    });

    // hollow dots for the second value
    if (has2) {
      series.push({
        id: 'dot2', name: ctx.title(enc.value2), type: 'scatter', z: 6, symbol: 'circle', symbolSize: size,
        animationDelay: function (i) { return i * stagger + 380; },
        itemStyle: { color: t.paper, borderColor: t.accent, borderWidth: 1.6 },
        data: v2.map(function (v, i) {
          return { name: labels[i], value: at(v, i), itemStyle: { color: t.paper, borderColor: colors[i], borderWidth: 1.6 } };
        })
      });
    }

    // end labels on an invisible series placed beyond the outer dot
    if (o.labels !== false) {
      series.push({
        id: 'lab', type: 'scatter', symbolSize: 0, silent: true, z: 7, tooltip: { show: false },
        animationDelay: function (i) { return i * stagger + 300; },
        data: v1.map(function (v, i) {
          var outer = v2[i] != null && v != null ? (Math.abs(v2[i]) > Math.abs(v) && (v2[i] >= 0) === (v >= 0) ? v2[i] : v) : v;
          var neg = outer != null && outer < 0;
          return {
            value: at(outer == null ? 0 : outer, i),
            label: {
              show: true, position: horiz ? (neg ? 'left' : 'right') : (neg ? 'bottom' : 'top'), distance: size / 2 + 5,
              fontSize: 11, fontFamily: t.fontNum, color: t.ink2,
              // knock-out box in the paper (or row-tint) colour: reference lines never strike through a value
              backgroundColor: hi[i] && o.highlightBand !== false ? RK.theme.mix(t.paper, t.accent2, t.dark ? 0.09 : 0.11) : t.paper,
              padding: [1, 2], borderRadius: 2,
              // vertical: labels wider than a band run upwards (downwards below zero) instead of touching
              rotate: rotVal ? 90 : 0, align: rotVal ? (neg ? 'right' : 'left') : undefined, verticalAlign: rotVal ? 'middle' : undefined,
              formatter: function () {
                var a = C.richSafe(num(v, fmt)), s = hi[i] ? '{h|' + a + '}' : a;
                return has2 && v2[i] != null ? s + '{s| / ' + C.richSafe(num(v2[i], fmt)) + '}' : s;
              },
              rich: { h: { color: t.ink, fontWeight: 600, fontSize: 11, fontFamily: t.fontNum }, s: { color: t.ink3, fontSize: 10.5, fontFamily: t.fontNum } }
            }
          };
        })
      });
    }

    // legend swatches for groups
    groups.forEach(function (g, k) {
      series.push({ id: 'lg-' + k, name: g, type: 'scatter', data: [], symbol: 'circle', itemStyle: { color: groupPal[k] } });
    });
    var legendData = groups.slice();
    if (has2) {
      var lc = groups.length ? t.ink3 : t.accent;
      legendData = [
        { name: ctx.title(enc.value), itemStyle: { color: lc, borderWidth: 0 } },
        { name: ctx.title(enc.value2), itemStyle: { color: t.paper, borderColor: lc, borderWidth: 1.5 } }   // hollow = second value
      ].concat(legendData);
    }
    var showLegend = o.legend !== false && legendData.length > 0;
    var hasTopRef = ref != null || (o.refLines || []).length;

    var catAxis = {
      type: 'category', data: labels, inverse: horiz,
      axisLine: { show: true, onZero: true, lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: {
        interval: 0, color: t.ink2, fontSize: 11,
        width: horiz ? 150 : rotCat ? 90 : Math.max(24, bandPx - 6), overflow: horiz || rotCat ? 'truncate' : 'break',
        rotate: rotCat ? 35 : 0,   // only when the longest label is wider than its band
        formatter: function (v, i) { var s = C.richSafe(v); return hi[i] ? '{h|' + s + '}' : s; },
        rich: { h: { color: t.ink, fontWeight: 600, fontSize: 11 } }
      }
    };
    var valAxis = {
      type: 'value', min: axMin, max: axMax, interval: step,
      axisLabel: { formatter: function (v) { return num(v, tickFmt(fmt, step)); } },
      splitLine: { show: true, lineStyle: { color: t.grid } }
    };
    var top = (showLegend ? 28 : 6) + (horiz && hasTopRef ? 18 : 0);
    var zoom = o.zoom ? C.zoom(ctx, horiz ? 'y' : 'x', horiz ? { orient: 'vertical', right: 0, top: top, bottom: 24, width: 12, height: null } : {}) : [];

    return {
      legend: C.legend(ctx, { show: showLegend, data: legendData, selectedMode: groups.length ? true : false }),
      grid: C.grid(ctx, { top: top, left: 4, right: marginR + (o.zoom && horiz ? 14 : 0), bottom: o.zoom && !horiz ? 30 : 4 }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var i = p.dataIndex, r = rows[i];
          if (!r || (p.seriesId !== 'dot' && p.seriesId !== 'dot2')) return '';
          var tipRows = [{ color: colors[i], label: ctx.title(enc.value), value: num(v1[i], fmt), bold: p.seriesId === 'dot' }];
          // differences of two percentages are percentage points ('+2.1pp'), not relative changes
          if (has2) {
            tipRows.push({ label: ctx.title(enc.value2), value: num(v2[i], fmt), bold: p.seriesId === 'dot2' });
            if (v1[i] != null && v2[i] != null) tipRows.push({ label: tr('lollipop.change', 'Change'), value: pctFmt ? ppDiff(v2[i] - v1[i], fmt) : pct(v1[i] ? v2[i] / v1[i] - 1 : NaN) });
          }
          if (ref != null && v1[i] != null && (pctFmt || (ref > 0 && v1[i] > 0))) tipRows.push({ label: tr('lollipop.vs', 'vs. {name}', { name: refName.toLowerCase(), Name: refName }), value: pctFmt ? ppDiff(v1[i] - ref, fmt) : pct(v1[i] / ref - 1) });
          if (enc.group) tipRows.unshift({ label: ctx.title(enc.group), value: r[enc.group] });
          return C.tip(labels[i], tipRows);
        }
      },
      xAxis: horiz ? valAxis : catAxis,
      yAxis: horiz ? catAxis : valAxis,
      dataZoom: zoom,
      series: series
    };
  }

  RK.component({
    id: 'lollipop',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'company', value: 'value', value2: null, highlight: 'is_target', group: null },
      orientation: 'horizontal',   // horizontal | vertical
      sort: 'desc',                // 'desc' | 'asc' | null (data order)
      highlight: null,             // label value(s) to emphasise in addition to encode.highlight
      highlightBand: true,         // tinted row behind highlighted categories
      refLine: 'median',           // 'median' | 'mean' | number | null
      refExcludeHighlight: true,   // statistic excludes highlighted rows (peer median excl. target)
      refLabel: null,              // default 'Median' / 'Mean'
      refLines: [],                // extra [{value, label, color}]
      labels: true,
      dotSize: 9,
      format: null,
      legend: true,
      zoom: false,
      wheelZoom: null              // zoom: null = Ctrl/Cmd + wheel or pinch (plain wheel scrolls the report) | true = plain wheel
    },
    render: C(build, {
      rebuildOnResize: true,       // label room and category label widths are measured in px
      select: function (p, ctx) { return p.seriesId === 'dot' || p.seriesId === 'dot2' ? { field: ctx.enc.label, value: p.name } : null; }
    })
  });
})();
