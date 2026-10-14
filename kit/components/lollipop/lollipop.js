/*!
 * RK component: lollipop — ranking with thin stems and dots: a calmer alternative to bars when there
 * are many categories. Sorted, target highlighted (accent-2 dot, bold label, tinted row), median /
 * mean reference line, optional second value per row (e.g. 2025E vs 2026E) drawn as a hollow dot
 * joined to the first by a light band. Optional colouring by group (sector / region).
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function median(a) {
    a = a.filter(isNum).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  /** Colours too close to the highlight accent are skipped for group colouring. */
  function near(a, b) {
    var x = RK.theme.parseColor(a), y = RK.theme.parseColor(b);
    return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)) < 64;
  }
  function mean(a) { a = a.filter(isNum); return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }

  /** Is row r highlighted (boolean field such as is_target, or label listed in options.highlight)? */
  function highlighter(ctx) {
    var enc = ctx.enc, list = ctx.options.highlight == null ? [] : [].concat(ctx.options.highlight);
    var hf = enc.highlight && ctx.dataset && ctx.dataset.has(enc.highlight) ? enc.highlight : null;
    return function (r) { return (hf && !!r[hf] && r[hf] !== 'false') || list.indexOf(r[enc.label]) >= 0; };
  }

  /** Tinted full-width row band behind highlighted categories (like .rk-table tr.is-target). */
  function rowBand(ctx, idx, horiz) {
    var t = ctx.theme;
    return {
      id: 'band', type: 'custom', silent: true, z: 0, tooltip: { show: false }, animation: false,
      renderItem: function (params, api) {
        var cs = params.coordSys, p = api.coord(horiz ? [0, api.value(0)] : [api.value(0), 0]);
        var bw = horiz ? api.size([0, 1])[1] : api.size([1, 0])[0];
        var shape = horiz ? { x: 0, y: p[1] - bw / 2, width: cs.x + cs.width + 8, height: bw }
          : { x: p[0] - bw / 2, y: cs.y, width: bw, height: cs.height + 40 };
        return { type: 'rect', shape: shape, style: { fill: RK.theme.alpha(t.accent2, t.dark ? 0.16 : 0.11) } };
      },
      data: idx.map(function (i) { return [i]; })
    };
  }

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var horiz = o.orientation !== 'vertical';
    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
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
    var groupPal = t.cat.filter(function (c) { return !near(c, t.accent2) && !near(c, t.paper); });
    function baseColor(r, i) {
      if (hi[i]) return t.accent2;
      if (groups.length) return groupPal[groups.indexOf(r[enc.group]) % groupPal.length] || t.neutral;
      return t.accent;
    }
    var colors = rows.map(function (r, i) { return C.dim(ctx, enc.label, r[enc.label], baseColor(r, i)); });

    // ---- reference statistic ----
    var statRows = o.refExcludeHighlight ? v1.filter(function (_, i) { return !hi[i]; }) : v1;
    var ref = o.refLine === 'median' ? median(statRows) : o.refLine === 'mean' ? mean(statRows) : isNum(o.refLine) ? o.refLine : null;
    var refName = o.refLabel || (o.refLine === 'median' ? 'Median' : o.refLine === 'mean' ? 'Mean' : 'Ref.');

    // ---- value axis bounds with room for end labels ----
    var ext = util.extent(v1.concat(v2, [0, ref], (o.refLines || []).map(function (r) { return r.value; })));
    var span = (ext[1] - ext[0]) || Math.abs(ext[1]) || 1;
    // room for end labels: approximate label width in px as a share of the plot length
    var plotPx = Math.max(160, horiz ? inst.getWidth() - 190 : inst.getHeight() - 70);
    var padFrac = o.labels === false ? 0.03 : Math.min(0.45, (horiz ? (has2 ? 92 : 46) : 22) / plotPx * 1.15);
    var step = util.niceStep(span * (1 + padFrac), horiz ? 6 : 5);
    var axMax = ext[1] > 0 ? Math.ceil((ext[1] + span * padFrac) / step) * step : 0;
    var axMin = ext[0] < 0 ? Math.floor((ext[0] - span * padFrac) / step) * step : 0;

    var size = o.dotSize || 9;
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
      markLine: (ref != null || (o.refLines || []).length) ? {
        silent: true, symbol: ['none', 'none'], animation: false,
        data: (ref != null ? [{ name: refName, value: ref, lineStyle: { color: t.ink3, type: [4, 3], width: 1 } }] : []).concat((o.refLines || []).map(function (r) {
          return { name: r.label || '', value: r.value, lineStyle: { color: r.color || t.accent2, type: [4, 3], width: 1.2 } };
        })).map(function (d) {
          d[horiz ? 'xAxis' : 'yAxis'] = d.value;
          d.label = {
            show: true, position: horiz ? 'start' : 'insideEndTop', distance: 4, color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum,
            formatter: (d.name ? d.name + ' ' : '') + RK.format(d.value, fmt)
          };
          return d;
        })
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
              formatter: function () {
                var s = hi[i] ? '{h|' + RK.format(v, fmt) + '}' : RK.format(v, fmt);
                return has2 && v2[i] != null ? s + '{s| / ' + RK.format(v2[i], fmt) + '}' : s;
              },
              rich: { h: { color: t.ink, fontWeight: 600, fontSize: 11, fontFamily: t.fontNum }, s: { color: t.ink3, fontSize: 10.5, fontFamily: t.fontNum } }
            }
          };
        })
      });
    }

    // legend swatches for groups
    groups.forEach(function (g, k) {
      series.push({ id: 'lg-' + k, name: g, type: 'scatter', data: [], symbol: 'circle', itemStyle: { color: groupPal[k % groupPal.length] } });
    });
    var legendData = groups.slice();
    if (has2) {
      var lc = groups.length ? t.ink3 : t.accent;
      legendData = [
        { name: ctx.title(enc.value), icon: 'circle', itemStyle: { color: lc, borderWidth: 0 } },
        { name: ctx.title(enc.value2), icon: 'circle', itemStyle: { color: t.paper, borderColor: lc, borderWidth: 1.5 } }
      ].concat(legendData);
    }
    var showLegend = o.legend !== false && legendData.length > 0;
    var hasTopRef = ref != null || (o.refLines || []).length;

    var catAxis = {
      type: 'category', data: labels, inverse: horiz,
      axisLine: { show: true, onZero: true, lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: {
        interval: 0, color: t.ink2, fontSize: 11,
        width: horiz ? 150 : Math.max(48, (inst.getWidth() - 60) / Math.max(1, labels.length) - 6), overflow: horiz ? 'truncate' : 'break',
        rotate: !horiz && labels.length > 12 ? 35 : 0,
        formatter: function (v, i) { return hi[i] ? '{h|' + v + '}' : v; },
        rich: { h: { color: t.ink, fontWeight: 600, fontSize: 11 } }
      }
    };
    var valAxis = {
      type: 'value', min: axMin, max: axMax, interval: step,
      axisLabel: { formatter: C.axisFmt(fmt) },
      splitLine: { show: true, lineStyle: { color: t.grid } }
    };
    var top = (showLegend ? 28 : 6) + (horiz && hasTopRef ? 18 : 0);
    var zoom = o.zoom ? C.zoom(ctx, horiz ? 'y' : 'x', horiz ? { orient: 'vertical', right: 0, top: top, bottom: 24, width: 12, height: null } : {}) : [];

    return {
      legend: C.legend(ctx, { show: showLegend, data: legendData, selectedMode: groups.length ? true : false }),
      grid: C.grid(ctx, { top: top, left: 4, right: (o.zoom && horiz ? 30 : 20), bottom: o.zoom && !horiz ? 30 : 4 }),
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var i = p.dataIndex, r = rows[i];
          if (!r || (p.seriesId !== 'dot' && p.seriesId !== 'dot2')) return '';
          var tr = [{ color: colors[i], label: ctx.title(enc.value), value: RK.format(v1[i], fmt), bold: p.seriesId === 'dot' }];
          if (has2) {
            tr.push({ label: ctx.title(enc.value2), value: RK.format(v2[i], fmt), bold: p.seriesId === 'dot2' });
            if (v1[i] != null && v2[i] != null) tr.push({ label: 'Change', value: RK.format(v1[i] ? v2[i] / v1[i] - 1 : NaN, '+0.0%;-0.0%;0.0%') });
          }
          if (ref != null && v1[i] != null && ref > 0 && v1[i] > 0) tr.push({ label: 'vs. ' + refName.toLowerCase(), value: RK.format(v1[i] / ref - 1, '+0.0%;-0.0%;0.0%') });
          if (enc.group) tr.unshift({ label: ctx.title(enc.group), value: r[enc.group] });
          return C.tip(labels[i], tr);
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
      zoom: false
    },
    render: C(build, {
      select: function (p, ctx) { return p.seriesId === 'dot' || p.seriesId === 'dot2' ? { field: ctx.enc.label, value: p.name } : null; }
    })
  });
})();
