/*!
 * RK component: parallel — parallel coordinates for multi-criteria screening. One vertical axis per
 * numeric field (options.dims), one line per row; lines coloured by a category or muted with the
 * target in accent-2 on top, plus a dashed peer-median line. Dragging on an axis brushes a range;
 * the brushed rows become a cross-filter ('in' on encode.label) for every other block.
 */
(function () {
  'use strict';
  var C = RK.chart, util = RK.util;

  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  /** Categorical palette without colours too close to accent-2 (reserved for the target). */
  function paletteFor(t) {
    var a = RK.theme.parseColor(t.accent2);
    var pal = t.cat.filter(function (c) {
      var b = RK.theme.parseColor(c), d = Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2));
      return d > 64;
    });
    return pal.length ? pal : t.cat;
  }
  var NONE = '\u0000(no match)';   // filter value that matches nothing (brush selected zero rows)
  var DASH_ICON = 'path://M0,4h5v2H0z M7.5,4h5v2h-5z M15,4h5v2h-5z';   // dashed legend swatch for median lines

  /** dims option -> [{field, title, format, type, cats, inverse, min, max}] */
  function dimsOf(ctx) {
    var o = ctx.options, ds = ctx.dataset;
    var list = o.dims && o.dims.length ? o.dims : (ds ? ds.fields.filter(function (f) {
      return f.type === 'number' && !/^(lat|lon|lng|latitude|longitude)$/i.test(f.name);
    }).slice(0, 6).map(function (f) { return f.name; }) : []);
    return list.map(function (d) {
      if (typeof d === 'string') d = { field: d };
      var f = ctx.field(d.field) || {};
      var cat = f.type === 'string' || f.type === 'boolean';
      return {
        field: d.field,
        title: d.title || ctx.title(d.field),
        format: d.format || f.format || o.format || 'auto',
        type: cat ? 'category' : 'value',
        cats: cat ? util.unique(ctx.allRows.map(function (r) { return r[d.field]; }).filter(function (v) { return v != null; })).map(String) : null,
        inverse: !!d.inverse, min: d.min, max: d.max
      };
    });
  }

  RK.component({
    id: 'parallel',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'label', color: null, target: 'is_target' },
      dims: [],               // fields or {field, title, format, inverse, min, max}; [] = first 6 numeric fields
      highlight: null,        // label value(s) drawn in accent-2 on top (adds to rows flagged by encode.target)
      median: true,           // dashed peer-median line (target excluded)
      brush: true,            // publish brushed rows (drag along an axis) as a cross-filter on encode.label
      smooth: false,          // curved lines
      opacity: 0.55,          // peer line opacity
      format: null,           // fallback axis format when a field has none
      legend: true
    },
    render: function (ctx) {
      var o = ctx.options, enc = ctx.enc, lf = enc.label;
      var key = ctx.id + ':' + lf;                 // same key as ctx.select -> ctx.selected(label) sees it
      var intervals = {};                           // parallelAxisId -> [[lo, hi], ...]
      var restoring = false, lastSig = null;
      var handle = chart(ctx);
      var inst = handle.chart, cur = ctx;

      function sig(c) {
        return c.rows.length + '|' + c.rows.map(function (r) { return r[lf]; }).join('\u0001') + '|' + RK.theme.tokens().name;
      }
      function active() { return Object.keys(intervals).filter(function (k) { return intervals[k] && intervals[k].length; }); }

      /** rows inside every brushed interval -> store filter (or clear it) */
      function publish() {
        var axesOn = active();
        if (!axesOn.length) { RK.store.clearFilter(key); return; }
        var ds = dimsOf(cur);
        var labels = cur.rows.filter(function (r) {
          return axesOn.every(function (id) {
            var d = ds[+id.slice(3)];
            if (!d) return true;
            var v = d.type === 'category' ? d.cats.indexOf(String(r[d.field])) : r[d.field];
            if (v == null || v === -1 || (typeof v === 'number' && !isFinite(v))) return false;
            return intervals[id].some(function (iv) { var lo = Math.min(iv[0], iv[1]), hi = Math.max(iv[0], iv[1]); return v >= lo - 1e-9 && v <= hi + 1e-9; });
          });
        }).map(function (r) { return r[lf]; });
        RK.store.setFilter(key, { field: lf, op: 'in', values: labels.length ? labels : [NONE], source: cur.id });
      }

      /** re-apply brushes after a rebuild (silently: no event, no filter churn) */
      function restore() {
        restoring = true;
        try {
          Object.keys(intervals).forEach(function (id) {
            inst.dispatchAction({ type: 'axisAreaSelect', parallelAxisId: id, intervals: intervals[id] }, { silent: true });
          });
        } finally { restoring = false; }
      }

      if (o.brush !== false) {
        inst.on('axisareaselected', function (ev) {
          if (restoring || !ev || !ev.parallelAxisId) return;
          intervals[ev.parallelAxisId] = (ev.intervals || []).slice();
          publish();
        });
      }

      lastSig = sig(ctx);
      var baseUpdate = handle.update;
      handle.update = function (c) {
        cur = c;
        // the filter was cleared from outside (reset / filter chip) -> drop the brushes
        if (!c.selected(lf).length && active().length) {
          Object.keys(intervals).forEach(function (id) { intervals[id] = []; });
          restore();
          intervals = {};
        }
        // our own brush changed only our own filter: rows are identical, keep the chart as is
        var s = sig(c);
        if (s === lastSig) return;
        lastSig = s;
        baseUpdate(c);
        restore();
      };
      var baseDestroy = handle.destroy;
      handle.destroy = function () { intervals = {}; baseDestroy(); };
      return handle;
    }
  });

  var chart = C(function (ctx) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc, lf = enc.label;
    var dims = dimsOf(ctx);
    var rows = ctx.rows;
    var pal = paletteFor(t);
    var peerColor = t.accent3 || t.cat[1];

    var hl = o.highlight == null ? [] : [].concat(o.highlight);
    var isHL = function (r) { return (enc.target && r[enc.target] === true) || hl.some(function (h) { return same(h, r[lf]); }); };
    var targets = rows.filter(isHL), peers = rows.filter(function (r) { return !isHL(r); });
    var valueOf = function (r) {
      return dims.map(function (d) {
        var v = r[d.field];
        if (d.type === 'category') return v == null ? null : String(v);
        return util.isNum(v) ? v : null;
      });
    };
    var item = function (r) { return { name: String(r[lf]), value: valueOf(r) }; };

    // colour groups (one series each so the legend toggles them)
    var cf = enc.color && ctx.dataset && ctx.dataset.has(enc.color) ? enc.color : null;
    var cats = cf ? util.unique(peers.map(function (r) { return r[cf]; })) : [null];
    var lineBase = { width: 1.25, opacity: o.opacity, cap: 'round', join: 'round' };
    var series = cats.map(function (c, i) {
      var color = cf ? pal[i % pal.length] : peerColor;
      return {
        id: 'p-' + i, name: cf ? String(c) : 'Peers', type: 'parallel', smooth: o.smooth ? 0.2 : false,
        lineStyle: util.merge({ color: color }, lineBase),
        itemStyle: { color: color },
        emphasis: { lineStyle: { width: 2.5, opacity: 1 } },
        inactiveOpacity: 0.05, activeOpacity: 1, z: 2,
        data: peers.filter(function (r) { return !cf || r[cf] === c; }).map(item)
      };
    });

    // peer median on numeric axes (target excluded); category axes use the most common value
    if (o.median && peers.length > 2) {
      var med = dims.map(function (d) {
        if (d.type === 'category') {
          var cnt = {};
          peers.forEach(function (r) { var k = String(r[d.field]); cnt[k] = (cnt[k] || 0) + 1; });
          return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
        }
        var a = peers.map(function (r) { return r[d.field]; }).filter(util.isNum).sort(function (x, y) { return x - y; });
        return a.length ? RK.expr.quantile(a, 0.5) : null;
      });
      series.push({
        id: 'median', name: 'Peer median', type: 'parallel', smooth: o.smooth ? 0.2 : false, z: 3,
        lineStyle: { color: t.ink, width: 1.6, type: [5, 4], opacity: 0.9 },
        itemStyle: { color: t.ink },
        emphasis: { lineStyle: { width: 2.2, opacity: 1 } },
        inactiveOpacity: 0.9, activeOpacity: 0.9,
        data: [{ name: 'Peer median', value: med }]
      });
    }
    if (targets.length) {
      series.push({
        id: 'target', name: targets.map(function (r) { return String(r[lf]); }).join(' / '), type: 'parallel', smooth: o.smooth ? 0.2 : false, z: 4,
        lineStyle: { color: t.accent2, width: 3, opacity: 1, cap: 'round', join: 'round' },
        itemStyle: { color: t.accent2 },
        emphasis: { lineStyle: { width: 3.5, opacity: 1 } },
        inactiveOpacity: 0.2, activeOpacity: 1,
        data: targets.map(item)
      });
    }

    // axes: nice padded bounds from all rows (stable while brushing / filtering)
    var parallelAxis = dims.map(function (d, i) {
      var ax = {
        id: 'pa-' + i, dim: i, name: d.title, type: d.type, inverse: d.inverse,
        nameLocation: d.inverse ? 'start' : 'end', nameGap: 14,
        nameTextStyle: { color: t.ink, fontSize: 11, fontWeight: 600, fontFamily: t.fontSans, width: 120, overflow: 'break', lineHeight: 13, align: 'center', verticalAlign: 'bottom' },
        axisLabel: { color: t.ink3, fontSize: 10.5, fontFamily: t.fontNum, formatter: d.type === 'category' ? null : C.axisFmt(d.format), hideOverlap: true,
          textBorderColor: t.paper, textBorderWidth: 3 },
        axisLine: { show: true, lineStyle: { color: t.axis, width: 1 } },
        axisTick: { show: true, length: 3, lineStyle: { color: t.axis } },
        splitLine: { show: false }
      };
      if (d.type === 'category') { ax.data = d.cats; ax.axisLabel.width = 90; ax.axisLabel.overflow = 'truncate'; }
      else {
        var ext = util.extent(ctx.allRows.map(function (r) { return r[d.field]; }));
        var step = util.niceStep((ext[1] - ext[0]) || Math.abs(ext[1]) || 1, 5);
        ax.min = d.min != null ? d.min : Math.floor(ext[0] / step) * step;
        ax.max = d.max != null ? d.max : Math.ceil(ext[1] / step) * step;
        ax.interval = d.min == null && d.max == null ? step : null;
      }
      return ax;
    });

    var showLegend = o.legend !== false;
    var fmts = dims.map(function (d) { return d.format; });
    return {
      legend: C.legend(ctx, {
        show: showLegend, icon: 'roundRect', itemWidth: 14, itemHeight: 3, itemStyle: { borderWidth: 0 },
        data: series.filter(function (s) { return s.id !== 'median'; }).map(function (s) { return s.name; })
          .concat(o.median && peers.length > 2 ? [{ name: 'Peer median', icon: DASH_ICON }] : [])
      }),
      tooltip: {
        trigger: 'item', confine: true,
        formatter: function (p) {
          var r = rows.filter(function (x) { return String(x[lf]) === p.name; })[0];
          var tr = dims.map(function (d, i) {
            var v = p.value ? p.value[i] : null;
            return { label: d.title, value: d.type === 'category' ? (v == null ? 'n.a.' : String(v)) : RK.format(v, fmts[i]) };
          });
          if (r && cf) tr.unshift({ color: p.color, label: ctx.title(cf), value: String(r[cf]) });
          return C.tip(p.name, tr);
        }
      },
      parallel: {
        left: 64, right: 72, top: showLegend ? 74 : 46, bottom: 14,
        parallelAxisDefault: {
          realtime: false,
          areaSelectStyle: { width: 16, borderWidth: 1, borderColor: t.accent, color: RK.theme.alpha(t.accent3 || t.accent, 0.18), opacity: 1 }
        }
      },
      parallelAxis: parallelAxis,
      series: series
    };
  });
})();
