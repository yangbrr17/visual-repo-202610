/*!
 * RK component: radar — peer benchmarking across several metrics (spider chart). The target is a
 * filled accent-2 polygon labelled at each vertex; peers are thin outlines (categorical or muted),
 * optionally with a dashed peer-median polygon. Long data (series / axis / value) or wide data
 * (encode.axis = [fields], one polygon per row).
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
      'radar.peers': '可比公司', 'radar.peerMedian': '可比公司中位数', 'radar.diffNote': '（ ）内为与可比公司中位数的差异'
    });
  }

  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  var DASH_ICON = 'path://M0,0h3v1.6H0z M3.5,0h3v1.6h-3z M7,0h3v1.6H7z';   // dashed legend swatch for the median
  var NAME_GAP = 12;
  /** Value text with a true minus sign. */
  function num(v, f) { return RK.format(v, f).replace(/^-/, '\u2212'); }
  function isPct(f) {
    var code = RK.format.presets[f] || f;
    return typeof code === 'string' && /%/.test(code.split(';')[0].replace(/"[^"]*"/g, ''));
  }
  function ppCode(f) { var dec = RK.format.decimals(f) || 0; return '0' + (dec ? '.' + new Array(dec + 1).join('0') : '') + '"pp"'; }
  /** Axis names longer than 18 characters wrap onto two lines at a space. */
  function axisName(name) { name = String(name); return name.length > 18 ? name.replace(/(.{1,18})(\s|$)/g, '$1\n').trim() : name; }

  RK.component({
    id: 'radar',
    deps: ['echarts'],
    defaults: {
      encode: { series: 'company', axis: 'metric', value: 'score', target: 'is_target' },
      highlight: null,        // series value(s) drawn filled in accent-2 (adds to rows flagged by encode.target)
      max: null,              // null = nice max per axis | number = common max | {axis: max}
      min: 0,                 // axis minimum (number) or null = nice min from the data
      peers: 'outline',       // 'outline' (thin categorical outlines) | 'muted' (thin grey outlines)
      median: false,          // dashed "Peer median" polygon (target excluded)
      labels: 'highlight',    // vertex value labels: 'highlight' | 'all' | 'none'
      shape: 'polygon',       // polygon | circle
      splitNumber: 4,         // number of concentric rings
      format: null,           // value format (long data); wide data uses each field's format
      legend: true
    },
    render: C(build, {
      rebuildOnResize: true,  // the radar centre / radius and the legend column depend on the block size
      select: function (p, ctx) { return p.name && p.seriesId !== 'median' ? { field: ctx.enc.series, value: p.name } : null; }
    })
  });

  function build(ctx) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc, rows = ctx.rows;
    var wide = Array.isArray(enc.axis);
    var sf = enc.series;

    /* ---------- normalise to names[] x axes[] matrix ---------- */
    var axes, names, matrix = {}, fmts;
    if (wide) {
      axes = enc.axis.map(function (f) { return { key: f, name: ctx.title(f) }; });
      fmts = enc.axis.map(function (f) { return o.format || ctx.fmtOf(f) || 'auto'; });
      names = util.unique(rows.map(function (r) { return r[sf]; }));
      rows.forEach(function (r) { matrix[r[sf]] = enc.axis.map(function (f) { return util.isNum(r[f]) ? r[f] : null; }); });
    } else {
      axes = util.unique(rows.map(function (r) { return r[enc.axis]; })).map(function (a) { return { key: a, name: String(a) }; });
      var f0 = o.format || ctx.fmtOf(enc.value) || 'auto';
      fmts = axes.map(function () { return f0; });
      names = util.unique(rows.map(function (r) { return r[sf]; }));
      var acc = {};
      rows.forEach(function (r) {
        var k = r[sf] + '\u0001' + r[enc.axis];
        if (util.isNum(r[enc.value])) (acc[k] || (acc[k] = [])).push(r[enc.value]);
      });
      names.forEach(function (n) {
        matrix[n] = axes.map(function (a) {
          var v = acc[n + '\u0001' + a.key];
          return v ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null;   // mean of duplicates
        });
      });
    }

    // target(s): explicit highlight + rows flagged by the target channel
    var hl = o.highlight == null ? [] : [].concat(o.highlight);
    var flagged = enc.target ? util.unique(rows.filter(function (r) { return r[enc.target] === true; }).map(function (r) { return r[sf]; })) : [];
    var isHL = function (n) { return flagged.indexOf(n) >= 0 || hl.some(function (h) { return same(h, n); }); };
    var targets = names.filter(isHL), peers = names.filter(function (n) { return !isHL(n); });

    // peer median per axis (target excluded)
    var med = axes.map(function (_, j) { return RK.expr.agg.median(peers.map(function (n) { return matrix[n][j]; }).filter(util.isNum)); });

    /* ---------- axis scale ---------- */
    var indicator = axes.map(function (a, j) {
      var vals = names.map(function (n) { return matrix[n][j]; }).filter(util.isNum);
      var ext = util.extent(vals);
      var max = util.isNum(o.max) ? o.max : (util.isObj(o.max) && util.isNum(o.max[a.key]) ? o.max[a.key] : null);
      var min = util.isNum(o.min) && !(ext[0] < o.min) ? o.min : null;   // data below options.min extends the axis
      if (max == null || min == null) {
        var lo = min != null ? min : Math.min(0, ext[0]);
        var step = util.niceStep((ext[1] - lo) || 1, o.splitNumber);
        if (max == null) max = Math.ceil(ext[1] / step) * step || step;
        if (min == null) min = Math.floor(lo / step) * step;
      }
      return { name: a.name, max: max, min: min };
    });

    /* ---------- colours ---------- */
    var order = util.unique(ctx.allRows.map(function (r) { return r[sf]; })).filter(function (n) { return !isHL(n); });   // stable colours
    var pal = RK.theme.palette({ n: order.length });   // peer outlines never resemble the accent-2 target
    var sel = ctx.selected(sf);
    var colorOf = function (n) {
      if (isHL(n)) return t.accent2;
      if (o.peers === 'muted') return RK.theme.mix(t.ink3, t.paper, 0.25);
      return pal[Math.max(0, order.indexOf(n))];
    };
    var dimmed = function (n) { return sel.length && sel.indexOf(n) < 0; };

    var vertexLabel = function (j0, strong, color) {
      return {
        show: true, distance: 4, fontSize: 10.5, fontFamily: t.fontNum, fontWeight: strong ? 600 : 400,
        color: color, textBorderColor: t.paper, textBorderWidth: 3,
        formatter: function (p) { return C.richSafe(num(p.value, fmts[p.dimensionIndex != null ? p.dimensionIndex : j0] || fmts[0])); }
      };
    };

    // three radar series on one radar, painted in order: peers, peer median, target(s) — so the target's
    // vertex labels always sit above the dashed median polygon
    var muted = o.peers === 'muted';
    var peerData = peers.map(function (n) {
      var c = colorOf(n), dim = dimmed(n);
      return {
        name: String(n), value: matrix[n],
        symbol: 'circle', symbolSize: 3.5,
        lineStyle: { color: dim ? RK.theme.alpha(c, 0.18) : c, width: 1.4, opacity: 1 },
        itemStyle: { color: dim ? RK.theme.alpha(c, 0.18) : c },
        areaStyle: { opacity: 0 },
        label: o.labels === 'all' && !dim ? vertexLabel(0, false, t.ink2) : { show: false }
      };
    });
    var hasMed = o.median && peers.length > 1;
    var targetData = targets.map(function (n) {
      var dim = dimmed(n);
      return {
        name: String(n), value: matrix[n],
        symbol: 'circle', symbolSize: 6,
        lineStyle: { color: t.accent2, width: 2.5, opacity: dim ? 0.25 : 1 },
        itemStyle: { color: t.accent2, borderColor: t.paper, borderWidth: 1.5, opacity: dim ? 0.25 : 1 },
        areaStyle: { color: RK.theme.alpha(t.accent2, dim ? 0.06 : 0.22) },
        label: o.labels !== 'none' && !dim ? vertexLabel(0, true, t.ink) : { show: false }
      };
    });

    // legend: target(s) first, then peers (one 'Peers' entry when they are muted — identical grey swatches say
    // nothing), then the median
    var mutedCol = RK.theme.mix(t.ink3, t.paper, 0.25);
    var peerEntries = muted ? (peers.length ? [{ name: tr('radar.peers', 'Peers'), itemStyle: { color: mutedCol } }] : []) : peers.map(String);
    var legendData = targets.map(String).concat(peerEntries, hasMed ? [{ name: tr('radar.peerMedian', 'Peer median'), icon: DASH_ICON, itemStyle: { color: t.ink3 } }] : []);
    var legendNames = legendData.map(function (d) { return typeof d === 'string' ? d : d.name; });

    /* ---------- layout: the legend column sits next to the radar and the pair is centred in the block ---------- */
    var W = ctx.el.clientWidth || 600, H = ctx.el.clientHeight || 320;
    var vertical = W > H * 1.45 && o.legend !== false;
    var legendW = vertical ? Math.min(200, 26 + Math.max.apply(null, legendNames.map(function (n) { return C.measure(n, '11px ' + t.fontSans); }))) : 0;
    var top = o.legend !== false && !vertical ? 30 : 0;
    var nameFont = '600 11px ' + t.fontSans;
    var nameLines = indicator.map(function (ind) { return axisName(ind.name); });
    var nameW = Math.max.apply(null, nameLines.map(function (n) { return Math.max.apply(null, n.split('\n').map(function (l) { return C.measure(l, nameFont); })); }).concat([20]));
    var nameH = 13 * Math.max.apply(null, nameLines.map(function (n) { return n.split('\n').length; }).concat([1]));
    var side = Math.min(120, nameW + NAME_GAP + 8);                   // horizontal room the axis names need beyond the radius
    var gapL = vertical ? 24 : 0;
    var radius = Math.max(40, Math.min((W - legendW - gapL) / 2 - side, (H - top) / 2 - nameH - NAME_GAP - 6));
    var groupW = legendW + gapL + 2 * (radius + side);
    var x0 = vertical ? Math.max(0, (W - groupW) / 2) : 0;
    var cx = vertical ? x0 + legendW + gapL + side + radius : W / 2;

    var series = [];
    if (peerData.length) {
      series.push({
        id: 'peers', name: tr('radar.peers', 'Peers'), type: 'radar', z: 2,
        lineStyle: { color: mutedCol }, itemStyle: { color: mutedCol },
        emphasis: { focus: 'self', lineStyle: { width: 3 } },
        blur: { lineStyle: { opacity: 0.15 }, itemStyle: { opacity: 0.15 }, areaStyle: { opacity: 0.04 }, label: { show: false } },
        data: peerData
      });
    }
    if (hasMed) {
      series.push({
        id: 'median', name: tr('radar.peerMedian', 'Peer median'), type: 'radar', z: 3, silent: false,
        lineStyle: { color: t.ink3, width: 1.5, type: [4, 3] }, itemStyle: { color: t.ink3 },
        emphasis: { focus: 'self' }, blur: { lineStyle: { opacity: 0.3 } },
        data: [{ name: tr('radar.peerMedian', 'Peer median'), value: med, symbol: 'none', lineStyle: { color: t.ink3, width: 1.5, type: [4, 3] }, itemStyle: { color: t.ink3 }, areaStyle: { opacity: 0 }, label: { show: false } }]
      });
    }
    if (targetData.length) {
      series.push({
        id: 'target', name: targets.map(String).join(' / '), type: 'radar', z: 4,
        lineStyle: { color: t.accent2 }, itemStyle: { color: t.accent2 },   // legend swatch
        emphasis: { focus: 'self', lineStyle: { width: 3 } },
        blur: { lineStyle: { opacity: 0.15 }, itemStyle: { opacity: 0.15 }, areaStyle: { opacity: 0.04 }, label: { show: false } },
        data: targetData
      });
    }

    return {
      legend: C.legend(ctx, {
        data: legendData, orient: vertical ? 'vertical' : 'horizontal', top: vertical ? 4 : 0, left: x0, itemGap: vertical ? 9 : 14
      }),
      tooltip: {
        trigger: 'item', confine: true,
        formatter: function (p) {
          var n = p.name, vals = p.value || [];
          var isMed = p.seriesId === 'median';
          var tipRows = indicator.map(function (ind, j) {
            var v = vals[j], d = util.isNum(v) && util.isNum(med[j]) && !isMed ? v - med[j] : null;
            // differences of percentages are percentage points
            var dtxt = d == null ? '' : '  (' + (d > 0 ? '+' : d < 0 ? '\u2212' : '\u00b1') + (isPct(fmts[j]) ? RK.format(Math.abs(d) * 100, ppCode(fmts[j])) : RK.format(Math.abs(d), fmts[j])) + ')';
            return { label: ind.name, value: num(v, fmts[j]) + dtxt };
          });
          return C.tip(n, tipRows, isMed || !peers.length ? null : tr('radar.diffNote', '( ) difference vs. peer median'));
        }
      },
      radar: {
        indicator: indicator,
        shape: o.shape,
        splitNumber: o.splitNumber,
        center: [cx, top + (H - top) / 2 + 1],
        radius: radius,
        axisName: {
          color: t.ink2, fontSize: 11, fontWeight: 600, fontFamily: t.fontSans, lineHeight: 13,
          formatter: function (name) { return C.richSafe(axisName(name)); }
        },
        nameGap: NAME_GAP,
        axisLine: { lineStyle: { color: t.rule } },
        splitLine: { lineStyle: { color: t.grid, width: 1 } },
        splitArea: { show: false },
        axisLabel: { show: false }
      },
      series: series
    };
  }
})();
