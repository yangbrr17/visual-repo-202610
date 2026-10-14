/*!
 * ReportKit chart — thin ECharts adapter shared by all ECharts-based components.
 *
 *   RK.component({
 *     id: 'bar', deps: ['echarts'],
 *     render: RK.chart(function (ctx, chart) { return {...echarts option...}; }, {
 *       select: function (params, ctx) { return { field: ctx.enc.x, value: params.name }; }  // click -> cross-filter
 *     })
 *   });
 *
 * Handles: themed init, SVG renderer by default (crisp print/PDF), motion on/off, update with
 * animated transitions, resize, dispose, PNG/SVG export, click-to-filter.
 * Also exports small helpers used by many components (tooltip HTML, axis formatters, pivot ...).
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});
  var util = RK.util;

  function chart(build, hooks) {
    hooks = hooks || {};
    return function render(ctx) {
      if (!global.echarts) throw new Error('ECharts is not loaded (vendor/echarts/echarts.min.js)');
      var renderer = ctx.options.renderer || (ctx.print ? 'svg' : 'svg');
      var inst = global.echarts.init(ctx.el, 'rk', { renderer: renderer, locale: ctx.options.locale || 'EN' });
      var current = ctx;
      // ECharts' roam/inside-zoom controller calls preventDefault on every wheel event before checking
      // zoomOnMouseWheel:'ctrl', which swallows page scrolling. Keep plain wheel for the report; let
      // Ctrl/Cmd + wheel (and trackpad pinch, which sends ctrlKey) through to ECharts.
      function onWheel(e) { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }
      if (ctx.options.wheelZoom !== true) ctx.el.addEventListener('wheel', onWheel, { capture: true });

      function apply(c, first) {
        current = c;
        var opt = build(c, inst) || {};
        if (!c.motion) opt.animation = false;
        if (first) { inst.setOption(opt, { notMerge: true }); return; }
        // keep the user's zoom window across filter / param updates
        if (hooks.keepZoom !== false && opt.dataZoom) {
          var prev = (inst.getOption() || {}).dataZoom || [];
          [].concat(opt.dataZoom).forEach(function (dz, i) {
            var p = prev[i];
            if (p && dz && dz.start == null && dz.end == null && dz.startValue == null && dz.endValue == null && p.start != null) {
              dz.start = p.start; dz.end = p.end;
            }
          });
        }
        inst.setOption(opt, { replaceMerge: ['series', 'dataset', 'xAxis', 'yAxis', 'visualMap', 'graphic', 'legend', 'grid', 'dataZoom', 'polar', 'radiusAxis', 'angleAxis', 'radar', 'parallelAxis', 'singleAxis', 'calendar', 'geo', 'matrix'] });
      }
      apply(ctx, true);

      if (hooks.select) {
        inst.on('click', function (params) {
          var sel = hooks.select(params, current, inst);
          if (sel && sel.field != null && current.options.crossFilter !== false) current.select(sel.field, sel.value);
        });
      }
      if (hooks.on) {
        Object.keys(hooks.on).forEach(function (ev) {
          inst.on(ev, function (params) { hooks.on[ev](params, current, inst); });
        });
      }
      if (hooks.init) hooks.init(inst, ctx);

      return {
        chart: inst,
        update: function (c) { apply(c, false); },
        resize: function () {
          inst.resize();
          if (hooks.rebuildOnResize) apply(current, false);   // width-dependent layouts (tick density, label widths)
        },
        destroy: function () { ctx.el.removeEventListener('wheel', onWheel, { capture: true }); inst.dispose(); },
        exportImage: function () { return exportPNG(inst, current); },
        exportSVG: function () {
          return inst.renderToSVGString ? inst.renderToSVGString() : null;
        }
      };
    };
  }

  /** PNG data URL (works for both canvas and SVG renderers). */
  function exportPNG(inst, ctx) {
    var bg = (ctx && ctx.theme && ctx.theme.paper) || '#ffffff';
    if (inst.getZr && inst.getZr().painter && inst.getZr().painter.type === 'canvas') {
      return Promise.resolve(inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: bg }));
    }
    var svg = inst.renderToSVGString ? inst.renderToSVGString() : null;
    if (!svg) return Promise.resolve(inst.getDataURL({ type: 'svg' }));
    var w = inst.getWidth(), h = inst.getHeight();
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = w * 2; c.height = h * 2;
        var g = c.getContext('2d');
        g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  /** Axis label formatter from a format code (compact "auto" if none). */
  chart.axisFmt = function (spec) {
    return function (v) { return RK.format(v, spec || 'auto'); };
  };

  /**
   * Standard tooltip HTML.
   * tip('FY2025', [{color, label, value, bold}], footer)
   */
  chart.tip = function (title, rows, footer) {
    var e = util.escapeHTML;
    var html = '<div class="rk-tip">';
    if (title != null && title !== '') html += '<div class="rk-tip__title">' + e(title) + '</div>';
    html += '<table class="rk-tip__rows">';
    (rows || []).forEach(function (r) {
      if (!r) return;
      html += '<tr' + (r.bold ? ' class="is-strong"' : '') + '><td>' +
        (r.color ? '<i class="rk-tip__dot" style="background:' + e(r.color) + '"></i>' : '') + e(r.label) +
        '</td><td class="rk-tip__v">' + e(r.value) + '</td></tr>';
    });
    html += '</table>';
    if (footer) html += '<div class="rk-tip__foot">' + e(footer) + '</div>';
    return html + '</div>';
  };

  /** Legend positioned top-left, pitchbook style. */
  chart.legend = function (ctx, extra) {
    return util.merge({ show: ctx.options.legend !== false, top: 0, left: 0, type: 'scroll' }, extra || {});
  };

  /** Grid with room for legend; pass overrides. */
  chart.grid = function (ctx, extra) {
    var hasLegend = ctx.options.legend !== false;
    return util.merge({ left: 4, right: 12, top: hasLegend ? 32 : 12, bottom: 4, containLabel: true }, extra || {});
  };

  /** Standard zoom: inside (wheel/pinch) + compact slider. */
  chart.zoom = function (ctx, axis, extra) {
    if (ctx.options.zoom === false) return [];
    var key = (axis || 'x') + 'AxisIndex';
    // plain wheel scrolls the report; Ctrl/Cmd + wheel (and trackpad pinch) zooms. options.wheelZoom: true to zoom on plain wheel
    var wheel = ctx.options.wheelZoom != null ? ctx.options.wheelZoom : 'ctrl';
    var inside = { type: 'inside', filterMode: 'none', zoomOnMouseWheel: wheel, moveOnMouseWheel: false, moveOnMouseMove: true };
    inside[key] = 0;
    var out = [inside];
    if (ctx.options.zoomSlider !== false && !ctx.print) {
      var slider = { type: 'slider', height: 18, bottom: 4, filterMode: 'none', showDetail: false, brushSelect: false };
      slider[key] = 0;
      out.push(util.merge(slider, extra || {}));
    }
    return out;
  };

  /**
   * Normalise wide or long data into series.
   *   long:  enc.x, enc.y (single field), enc.series (field)  -> one series per distinct series value
   *   wide:  enc.x, enc.y (array of fields)                    -> one series per y field
   * Returns { categories:[x...], series:[{name, field?, values:[...]}], yFormat }
   */
  chart.toSeries = function (ctx, opts) {
    opts = opts || {};
    var rows = ctx.rows, enc = ctx.enc, xf = enc.x;
    var ys = Array.isArray(enc.y) ? enc.y : [enc.y];
    var cats = util.unique(rows.map(function (r) { return r[xf]; }));
    if (opts.sortX) cats.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    var series = [];
    // several rows per x (e.g. long data that still has a region dimension) are combined with opts.agg
    var aggName = opts.agg || ctx.options.agg || 'sum';
    var aggFn = RK.expr.agg[aggName] || RK.expr.agg.sum;
    function collect(list, field) {
      var byX = new Map();
      list.forEach(function (r) {
        var k = r[xf];
        if (!byX.has(k)) byX.set(k, []);
        byX.get(k).push(r[field]);
      });
      return cats.map(function (c) { var vals = byX.get(c); return vals ? aggFn(vals) : null; });
    }
    if (enc.series && !Array.isArray(enc.y)) {
      var groups = util.groupBy(rows, function (r) { return r[enc.series]; });
      groups.forEach(function (g, name) {
        series.push({ name: name, field: enc.y, values: collect(g, enc.y) });
      });
    } else {
      ys.forEach(function (f) {
        series.push({ name: ctx.title(f), field: f, values: collect(rows, f) });
      });
    }
    return { categories: cats, series: series, yFormat: ctx.options.format || ctx.fmtOf(ys[0]) };
  };

  /** Value label config for bars/lines using a format code. */
  chart.label = function (ctx, spec, extra) {
    return util.merge({
      show: true,
      color: ctx.theme.ink2,
      fontSize: 11,
      fontFamily: ctx.theme.fontNum,
      formatter: function (p) {
        var v = p.value;
        if (Array.isArray(v)) v = v[v.length - 1];
        if (v && typeof v === 'object' && 'value' in v) v = v.value;
        return RK.format(v, spec || 'auto');
      }
    }, extra || {});
  };

  /** Dim non-selected categories (for cross-filter highlight). */
  chart.dim = function (ctx, field, value, color) {
    var sel = ctx.selected(field);
    if (!sel.length || sel.indexOf(value) >= 0) return color;
    return RK.theme.alpha(color, 0.25);
  };

  /** Text width in px for a CSS font shorthand (cached canvas). */
  var measureCtx = null;
  chart.measure = function (text, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font || '11px ' + (RK.theme.tokens().fontSans || 'sans-serif');
    return measureCtx.measureText(String(text)).width;
  };

  /**
   * Spread 1-D label positions so neighbours are at least `gap` apart, staying within [lo, hi].
   * items: array of desired positions; returns adjusted positions in the same order.
   */
  chart.spreadLabels = function (items, gap, lo, hi) {
    var idx = items.map(function (y, i) { return i; }).sort(function (a, b) { return items[a] - items[b]; });
    var pos = idx.map(function (i) { return items[i]; });
    for (var iter = 0; iter < 50; iter++) {
      var moved = false;
      for (var k = 1; k < pos.length; k++) {
        var d = pos[k] - pos[k - 1];
        if (d < gap) { var shift = (gap - d) / 2; pos[k - 1] -= shift; pos[k] += shift; moved = true; }
      }
      if (lo != null && pos.length && pos[0] < lo) { var dl = lo - pos[0]; pos = pos.map(function (p) { return p + dl; }); }
      if (hi != null && pos.length && pos[pos.length - 1] > hi) { var dh = pos[pos.length - 1] - hi; pos = pos.map(function (p) { return p - dh; }); }
      if (!moved) break;
    }
    var out = new Array(items.length);
    idx.forEach(function (i, k) { out[i] = pos[k]; });
    return out;
  };

  RK.chart = chart;
})(typeof window !== 'undefined' ? window : this);
