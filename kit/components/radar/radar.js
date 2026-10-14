/*!
 * RK component: radar — peer benchmarking across several metrics (spider chart). The target is a
 * filled accent-2 polygon labelled at each vertex; peers are thin outlines (categorical or muted),
 * optionally with a dashed peer-median polygon. Long data (series / axis / value) or wide data
 * (encode.axis = [fields], one polygon per row).
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  function median(vals) {
    var a = vals.filter(util.isNum).sort(function (x, y) { return x - y; });
    return a.length ? RK.expr.quantile(a, 0.5) : null;
  }

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
    render: function (ctx) {
      // the radar centre / radius depend on the block size, so a resize re-runs the layout
      var cur = ctx, handle = chart(ctx), upd = handle.update, rsz = handle.resize;
      handle.update = function (c) { cur = c; upd(c); };
      handle.resize = function () { rsz(); upd(cur); };
      return handle;
    }
  });

  var chart = C(function (ctx) {
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
    var med = axes.map(function (_, j) { return median(peers.map(function (n) { return matrix[n][j]; })); });

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
    var pal = t.cat.filter(function (c) { return !same(c, t.accent2); });
    if (!pal.length) pal = t.cat;
    var sel = ctx.selected(sf);
    var colorOf = function (n) {
      if (isHL(n)) return t.accent2;
      if (o.peers === 'muted') return RK.theme.mix(t.ink3, t.paper, 0.25);
      return pal[peers.indexOf(n) % pal.length];
    };
    var dimmed = function (n) { return sel.length && sel.indexOf(n) < 0; };

    var vertexLabel = function (j0, strong, color) {
      return {
        show: true, distance: 4, fontSize: 10.5, fontFamily: t.fontNum, fontWeight: strong ? 600 : 400,
        color: color, textBorderColor: t.paper, textBorderWidth: 2.5,
        formatter: function (p) { return RK.format(p.value, fmts[p.dimensionIndex != null ? p.dimensionIndex : j0] || fmts[0]); }
      };
    };

    var data = peers.map(function (n) {
      var c = colorOf(n), dim = dimmed(n);
      return {
        name: String(n), value: matrix[n],
        symbol: 'circle', symbolSize: 3.5,
        lineStyle: { color: dim ? RK.theme.alpha(c, 0.18) : c, width: 1.4, opacity: 1 },
        itemStyle: { color: dim ? RK.theme.alpha(c, 0.18) : c },
        areaStyle: { opacity: 0 },
        label: o.labels === 'all' && !dim ? vertexLabel(0, false, t.ink3) : { show: false }
      };
    });
    if (o.median && peers.length > 1) {
      data.push({
        name: 'Peer median', value: med, symbol: 'none',
        lineStyle: { color: t.ink2, width: 1.5, type: [4, 3] }, itemStyle: { color: t.ink2 }, areaStyle: { opacity: 0 },
        label: { show: false }
      });
    }
    targets.forEach(function (n) {
      var dim = dimmed(n);
      data.push({
        name: String(n), value: matrix[n],
        symbol: 'circle', symbolSize: 6,
        lineStyle: { color: t.accent2, width: 2.5, opacity: dim ? 0.25 : 1 },
        itemStyle: { color: t.accent2, borderColor: t.paper, borderWidth: 1.5, opacity: dim ? 0.25 : 1 },
        areaStyle: { color: RK.theme.alpha(t.accent2, dim ? 0.06 : 0.22) },
        label: o.labels !== 'none' && !dim ? vertexLabel(0, true, t.ink) : { show: false },
        z: 3
      });
    });

    // legend: target(s) first, then peers, then median; vertical at top-left when the block is wide
    var legendNames = targets.concat(peers).map(String).concat(o.median && peers.length > 1 ? ['Peer median'] : []);
    var W = ctx.el.clientWidth || 600, H = ctx.el.clientHeight || 320;
    var vertical = W > H * 1.45 && o.legend !== false;
    var legendW = vertical ? Math.min(200, 26 + Math.max.apply(null, legendNames.map(function (n) { return n.length * 6.3; }))) : 0;
    var top = o.legend !== false && !vertical ? 30 : 0;
    var cx = vertical ? legendW + (W - legendW) / 2 : W / 2;
    var radius = Math.max(40, Math.min((W - legendW) / 2 - 80, (H - top) / 2 - 26));

    return {
      legend: C.legend(ctx, {
        data: legendNames, orient: vertical ? 'vertical' : 'horizontal', top: vertical ? 4 : 0, left: 0, itemGap: vertical ? 9 : 14,
        icon: 'roundRect', itemWidth: 14, itemHeight: 3
      }),
      tooltip: {
        trigger: 'item', confine: true,
        formatter: function (p) {
          var n = p.name, vals = p.value || [];
          var isMed = n === 'Peer median';
          var tr = indicator.map(function (ind, j) {
            var v = vals[j], d = util.isNum(v) && util.isNum(med[j]) && !isMed ? v - med[j] : null;
            var dtxt = d == null ? '' : '  (' + (d > 0 ? '+' : d < 0 ? '-' : '±') + RK.format(Math.abs(d), fmts[j]) + ')';
            return { label: ind.name, value: RK.format(v, fmts[j]) + dtxt };
          });
          return C.tip(n, tr, isMed || !peers.length ? null : '(vs. peer median' + (isHL(n) ? '' : ', incl. this peer') + ')');
        }
      },
      radar: {
        indicator: indicator,
        shape: o.shape,
        splitNumber: o.splitNumber,
        center: [cx, top + (H - top) / 2 + 4],
        radius: radius,
        axisName: {
          color: t.ink2, fontSize: 11, fontWeight: 600, fontFamily: t.fontSans,
          formatter: function (name) { return name.length > 18 ? name.replace(/(.{1,18})(\s|$)/g, '$1\n').trim() : name; }
        },
        nameGap: 10,
        axisLine: { lineStyle: { color: t.rule } },
        splitLine: { lineStyle: { color: t.grid, width: 1 } },
        splitArea: { show: false },
        axisLabel: { show: false }
      },
      series: [{
        id: 'radar', type: 'radar',
        emphasis: { focus: 'self', lineStyle: { width: 3 } },
        blur: { lineStyle: { opacity: 0.15 }, itemStyle: { opacity: 0.15 }, areaStyle: { opacity: 0.04 }, label: { show: false } },
        data: data
      }]
    };
  }, {
    select: function (p, ctx) { return p.name && p.name !== 'Peer median' ? { field: ctx.enc.series, value: p.name } : null; }
  });
})();
