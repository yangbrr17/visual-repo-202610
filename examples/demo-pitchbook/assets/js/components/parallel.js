/*!
 * RK component: parallel — parallel coordinates for multi-criteria screening. One vertical axis per
 * numeric field (options.dims), one line per row; lines coloured by a category or muted with the
 * target in accent-2 on top, plus a dashed peer-median line. Dragging on an axis brushes a range;
 * the brushed rows become a cross-filter ('in' on encode.label) for every other block.
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
      'parallel.peers': '可比公司', 'parallel.peerMedian': '可比公司中位数'
    });
  }

  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  var DASH_ICON = 'path://M0,0h3v1.6H0z M3.5,0h3v1.6h-3z M7,0h3v1.6H7z';   // dashed legend swatch for the median line

  /** Axis tick format: the value format with no more decimals than the tick step needs (20x not 20.0x). */
  function tickFmt(fmt, step) {
    var code = RK.format.presets[fmt] || fmt;
    if (typeof code !== 'string' || !step || !/[0#]/.test(code) || RK.format.isDateCode(code)) return fmt;
    var sec = code.split(';')[0].replace(/"[^"]*"/g, ''), scale = Math.pow(1000, ((sec.match(/[0#](,+)[^0#]*$/) || [])[1] || '').length);
    var v = Math.abs(step) * (/%/.test(sec) ? 100 : 1) / scale, dec = 0;
    while (dec < 4 && Math.abs(Math.round(v * Math.pow(10, dec)) - v * Math.pow(10, dec)) > 1e-6) dec++;
    return code.replace(/([0#])\.([0#]+)/g, function (m, a, d) { var n = Math.min(dec, d.length); return a + (n ? '.' + d.slice(0, n) : ''); });
  }

  /** Value text with a true minus sign. */
  function num(v, f) { return RK.format(v, f).replace(/^-/, '\u2212'); }
  /** Greedy word wrap to `width` px; a single word wider than that stays whole (never an ellipsis). */
  function wrap(text, width, font) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (cur && C.measure(next, font) > width) { lines.push(cur); cur = w; } else cur = next;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  /** Rows a wrapping (type 'plain') ECharts legend needs within `avail` px — mirrors ECharts' box layout. */
  function legendRows(names, avail, font) {
    var rows = 1, x = 0;
    names.forEach(function (n) {
      var w = 15 + C.measure(n, font);
      if (x > 0 && x + w > avail) { rows++; x = 0; }
      x += w + 14;
    });
    return rows;
  }

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
      var key = ctx.id + ':' + lf;                 // store key of this block's selection (ctx.setSelection / ctx.selected)
      var intervals = {};                           // parallelAxisId -> [[lo, hi], ...]
      var restoring = false, lastSig = null;
      var handle = chart(ctx);
      var inst = handle.chart, cur = ctx;

      function sig(c) {
        return c.rows.length + '|' + c.rows.map(function (r) { return r[lf]; }).join('\u0001') + '|' + RK.theme.tokens().name + (c.print ? '|print' : '');   // print rebuilds without animation
      }
      function active() { return Object.keys(intervals).filter(function (k) { return intervals[k] && intervals[k].length; }); }

      /** rows inside every brushed interval -> selection on the label field (cleared when no brush is left) */
      function publish() {
        var axesOn = active();
        if (!axesOn.length) { cur.setSelection(lf, []); return; }
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
        cur.setSelection(lf, labels, { allowEmpty: true });   // a brush that catches no row matches nothing
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
        if (!RK.store.filter(key) && active().length) {
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
      // a resize re-lays out the axes (name wrapping): put the brushes back afterwards
      var baseResize = handle.resize;
      handle.resize = function () { baseResize(); restore(); };
      var baseDestroy = handle.destroy;
      handle.destroy = function () { intervals = {}; baseDestroy(); };
      return handle;
    }
  });

  var chart = C(function (ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc, lf = enc.label;
    var dims = dimsOf(ctx);
    var rows = ctx.rows;
    var peerColor = t.peer || t.accent;   // one peer colour across the kit

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
    var allCats = cf ? util.unique(ctx.allRows.map(function (r) { return r[cf]; })) : [null];   // stable colour order
    var pal = RK.theme.palette({ n: allCats.length });   // group colours never resemble the accent-2 target
    var cats = cf ? allCats.filter(function (c) { return peers.some(function (r) { return r[cf] === c; }); }) : [null];
    var lineBase = { width: 1.25, opacity: o.opacity, cap: 'round', join: 'round' };
    var series = cats.map(function (c) {
      var i = allCats.indexOf(c), color = cf ? pal[i] : peerColor;
      return {
        id: 'p-' + i, name: cf ? String(c) : tr('parallel.peers', 'Peers'), type: 'parallel', smooth: o.smooth ? 0.2 : false,
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
        id: 'median', name: tr('parallel.peerMedian', 'Peer median'), type: 'parallel', smooth: o.smooth ? 0.2 : false, z: 3,
        lineStyle: { color: t.ink3, width: 1.6, type: [4, 3], opacity: 0.9 },
        itemStyle: { color: t.ink3 },
        emphasis: { lineStyle: { width: 2.2, opacity: 1 } },
        inactiveOpacity: 0.9, activeOpacity: 0.9,
        data: [{ name: tr('parallel.peerMedian', 'Peer median'), value: med }]
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

    /* ---------- layout: wrapped axis names and a wrapping legend set the top margin ---------- */
    var W = (inst && inst.getWidth()) || ctx.el.clientWidth || 800;
    var PL = 64, PR = 72, nameFont = '600 11px ' + t.fontSans;
    var spacing = dims.length > 1 ? (W - PL - PR) / (dims.length - 1) : W - PL - PR;
    var nameW = Math.max(48, Math.min(160, spacing - 10));
    // ECharts truncates parallel axis names to the axis spacing with an ellipsis: wrap them ourselves instead
    var names = dims.map(function (d) { return wrap(d.title, nameW, nameFont); });
    var nameLines = Math.max.apply(null, names.map(function (n) { return n.length; }).concat([1]));
    var showLegend = o.legend !== false;
    var legendNames = series.filter(function (s) { return s.id !== 'median'; }).map(function (s) { return s.name; })
      .concat(o.median && peers.length > 2 ? [tr('parallel.peerMedian', 'Peer median')] : []);
    var lRows = showLegend ? legendRows(legendNames, W, '11px ' + t.fontSans) : 0;
    var top = (showLegend ? 25 * lRows + 4 : 0) + 13 * nameLines + 28;

    // axes: nice padded bounds from all rows (stable while brushing / filtering)
    var parallelAxis = dims.map(function (d, i) {
      var ax = {
        id: 'pa-' + i, dim: i, name: names[i].map(C.richSafe).join('\n'), type: d.type, inverse: d.inverse,
        nameLocation: d.inverse ? 'start' : 'end', nameGap: 14, nameTruncate: { maxWidth: nameW + 40 },
        nameTextStyle: { color: t.ink, fontSize: 11, fontWeight: 600, fontFamily: t.fontSans, lineHeight: 13, align: 'center', verticalAlign: 'bottom' },
        // tick labels sit on a paper chip above the lines: no polyline ever runs through a number
        axisLabel: { color: t.ink3, fontSize: 11, fontFamily: t.fontNum, hideOverlap: true, backgroundColor: t.paper, padding: [1, 2], borderRadius: 2 },
        axisLine: { show: true, lineStyle: { color: t.axis, width: 1 } },
        axisTick: { show: true, length: 3, lineStyle: { color: t.axis } },
        splitLine: { show: false }
      };
      if (d.type === 'category') {
        // truncated here, not with a fixed label width (which would stretch the paper chip to 90px)
        var labFont = '11px ' + t.fontNum;
        ax.data = d.cats;
        ax.axisLabel.formatter = function (v) {
          var txt = String(v);
          if (C.measure(txt, labFont) > 90) { while (txt.length > 1 && C.measure(txt + '\u2026', labFont) > 90) txt = txt.slice(0, -1); txt += '\u2026'; }
          return C.richSafe(txt);
        };
      }
      else {
        var ext = util.extent(ctx.allRows.map(function (r) { return r[d.field]; }));
        var step = util.niceStep((ext[1] - ext[0]) || Math.abs(ext[1]) || 1, 5);
        ax.min = d.min != null ? d.min : Math.floor(ext[0] / step) * step;
        ax.max = d.max != null ? d.max : Math.ceil(ext[1] / step) * step;
        ax.interval = d.min == null && d.max == null ? step : null;
        var tf = tickFmt(d.format, ax.interval);
        ax.axisLabel.formatter = function (v) { return num(v, tf); };
      }
      return ax;
    });

    var fmts = dims.map(function (d) { return d.format; });
    return {
      // plain, wrapping legend (never scroll paging in report output)
      legend: C.legend(ctx, {
        show: showLegend, type: 'plain',
        data: legendNames.map(function (n) { return n === tr('parallel.peerMedian', 'Peer median') ? { name: n, icon: DASH_ICON } : n; })
      }),
      tooltip: {
        trigger: 'item', confine: true,
        formatter: function (p) {
          var r = rows.filter(function (x) { return String(x[lf]) === p.name; })[0];
          var tipRows = dims.map(function (d, i) {
            var v = p.value ? p.value[i] : null;
            return { label: d.title, value: d.type === 'category' ? (v == null ? RK.format(null) : String(v)) : num(v, fmts[i]) };
          });
          if (r && cf) tipRows.unshift({ color: p.color, label: ctx.title(cf), value: String(r[cf]) });
          return C.tip(p.name, tipRows);
        }
      },
      parallel: {
        left: PL, right: PR, top: top, bottom: 14,
        parallelAxisDefault: {
          realtime: false,
          areaSelectStyle: { width: 16, borderWidth: 1, borderColor: t.accent, color: RK.theme.alpha(t.accent3 || t.accent, 0.18), opacity: 1 }
        }
      },
      parallelAxis: parallelAxis,
      series: series
    };
  }, { rebuildOnResize: true });   // axis-name wrapping and legend rows are laid out in px
})();
