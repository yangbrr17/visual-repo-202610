/*!
 * ReportKit theme — design tokens live in CSS custom properties (kit/styles/tokens.css,
 * kit/styles/themes/*.css). This module reads them at runtime and bridges them to
 * ECharts / Leaflet / canvas so one palette drives everything. Re-skin = swap a theme file.
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});

  var TOKEN_NAMES = [
    'font-sans', 'font-serif', 'font-num', 'paper', 'canvas', 'surface', 'surface-2',
    'ink', 'ink-2', 'ink-3', 'rule', 'grid', 'axis', 'accent', 'accent-2', 'accent-3',
    'highlight', 'pos', 'neg', 'neutral', 'tooltip-bg', 'tooltip-ink', 'map-land', 'map-border', 'map-water'
  ];

  /* ---------------- color helpers ---------------- */
  function parseColor(c) {
    c = String(c || '').trim();
    var m;
    if ((m = c.match(/^#([0-9a-f]{3,8})$/i))) {
      var h = m[1];
      if (h.length === 3) h = h.replace(/./g, '$&$&');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    if ((m = c.match(/^rgba?\(([^)]+)\)$/i))) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
    }
    return [128, 128, 128, 1];
  }
  function toHex(rgb) {
    return '#' + rgb.slice(0, 3).map(function (v) { var s = Math.round(Math.max(0, Math.min(255, v))).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
  }
  function mix(a, b, t) {
    var x = parseColor(a), y = parseColor(b);
    return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function alpha(c, a) {
    var x = parseColor(c);
    return 'rgba(' + Math.round(x[0]) + ',' + Math.round(x[1]) + ',' + Math.round(x[2]) + ',' + a + ')';
  }
  function luminance(c) {
    var x = parseColor(c).slice(0, 3).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
  }
  /** Readable text color (ink or white) on top of a fill. */
  function onColor(fill, dark, light) {
    return luminance(fill) > 0.4 ? (dark || '#111827') : (light || '#ffffff');
  }
  function ramp(stops) {
    return function (t) {
      if (t == null || isNaN(t)) return null;
      t = Math.max(0, Math.min(1, t));
      var seg = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(seg));
      return mix(stops[i], stops[i + 1], seg - i);
    };
  }

  /* ---------------- token reading ---------------- */
  function readTokens(el) {
    el = el || document.documentElement;
    var cs = getComputedStyle(el);
    function v(name) { return cs.getPropertyValue('--rk-' + name).trim(); }
    var t = {};
    TOKEN_NAMES.forEach(function (n) { t[n.replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); })] = v(n); });
    function series(prefix, max) {
      var out = [];
      for (var i = 1; i <= max; i++) { var c = v(prefix + '-' + i); if (c) out.push(c); }
      return out;
    }
    t.cat = series('cat', 12);
    t.seq = series('seq', 9);
    t.div = series('div', 9);
    t.ord = series('ord', 9);           // ordinal ramp: stacked parts of a whole (dark -> light)
    if (!t.cat.length) t.cat = ['#0b2d5b', '#3b6ea8', '#8fb3d9', '#b08d57', '#6b7785', '#c9d3df', '#2f7d6d', '#a3485a'];
    if (!t.seq.length) t.seq = ['#eef3f9', '#c9d8ea', '#93b1d4', '#5b86ba', '#2f5f99', '#163f73', '#0b2d5b'];
    if (!t.div.length) t.div = ['#a3485a', '#d79aa4', '#f1dfe2', '#f4f4f2', '#d8e4f0', '#8fb3d9', '#1f4e89'];
    t.ink = t.ink || '#111827';
    t.ink2 = t.ink2 || '#4b5563';
    t.ink3 = t.ink3 || '#6b7280';
    t.rule = t.rule || '#d1d5db';
    t.grid = t.grid || '#e5e7eb';
    t.axis = t.axis || t.ink3;
    t.accent = t.accent || t.cat[0];
    t.accent2 = t.accent2 || t.cat[3] || t.cat[1];
    t.pos = t.pos || '#2f7d6d';
    t.neg = t.neg || '#a3485a';
    t.neutral = t.neutral || '#9ca3af';
    t.highlight = t.highlight || t.accent2;
    if (!t.ord.length) t.ord = t.seq.slice().reverse().slice(0, 5);
    t.ref = v('ref') || t.neg;            // reference lines: current / offer price
    t.paper = t.paper || '#ffffff';
    t.surface = t.surface || t.paper;
    t.tooltipBg = t.tooltipBg || '#ffffff';
    t.tooltipInk = t.tooltipInk || t.ink;
    t.fontSans = t.fontSans || 'Inter, "Helvetica Neue", Arial, sans-serif';
    t.fontNum = t.fontNum || t.fontSans;
    t.fontSerif = t.fontSerif || 'Georgia, serif';
    // ECharts writes font stacks into SVG style="" attributes: double quotes would break PNG/SVG export
    ['fontSans', 'fontNum', 'fontSerif'].forEach(function (k) { t[k] = String(t[k]).replace(/"/g, "'"); });
    t.dark = luminance(t.paper) < 0.3;
    t.name = (document.documentElement.getAttribute('data-rk-theme') || 'navy');
    return t;
  }

  /* ---------------- ECharts theme ---------------- */
  function echartsTheme(t) {
    var axisLabel = { color: t.ink3, fontSize: 11, fontFamily: t.fontNum };
    var valueAxis = {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: axisLabel,
      splitLine: { show: true, lineStyle: { color: t.grid, width: 1 } },
      nameTextStyle: { color: t.ink3, fontSize: 11 }
    };
    var catAxis = {
      axisLine: { show: true, lineStyle: { color: t.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: { color: t.ink2, fontSize: 11, fontFamily: t.fontSans },
      splitLine: { show: false },
      nameTextStyle: { color: t.ink3, fontSize: 11 }
    };
    return {
      color: t.cat,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: t.fontSans, color: t.ink2, fontSize: 12 },
      title: { textStyle: { color: t.ink, fontFamily: t.fontSerif, fontWeight: 600, fontSize: 14 }, subtextStyle: { color: t.ink3 } },
      legend: {
        textStyle: { color: t.ink2, fontSize: 11 },
        icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 14, itemStyle: { borderWidth: 0 },
        inactiveColor: t.rule, pageIconColor: t.accent, pageTextStyle: { color: t.ink3 }
      },
      tooltip: {
        backgroundColor: t.tooltipBg,
        borderColor: t.rule,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: t.tooltipInk, fontSize: 12, fontFamily: t.fontSans },
        extraCssText: 'box-shadow:0 8px 24px rgba(15,23,42,.14);border-radius:6px;',
        axisPointer: { lineStyle: { color: t.axis, type: 'dashed' }, crossStyle: { color: t.axis }, shadowStyle: { color: alpha(t.accent, 0.06) } }
      },
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      categoryAxis: catAxis,
      valueAxis: valueAxis,
      timeAxis: Object.assign({}, catAxis, { axisLabel: axisLabel }),
      logAxis: valueAxis,
      line: { symbol: 'circle', symbolSize: 5, showSymbol: false, lineStyle: { width: 2 }, emphasis: { lineStyle: { width: 2.5 } } },
      bar: { barMaxWidth: 36, itemStyle: { borderRadius: 0 } },
      scatter: { symbolSize: 8, itemStyle: { opacity: 0.9 } },
      candlestick: { itemStyle: { color: t.pos, color0: t.neg, borderColor: t.pos, borderColor0: t.neg } },
      markLine: { lineStyle: { color: t.ink3, type: 'dashed' }, label: { color: t.ink2, fontSize: 11 }, symbol: ['none', 'none'] },
      dataZoom: {
        borderColor: t.rule, backgroundColor: 'transparent', fillerColor: alpha(t.accent, 0.08),
        handleStyle: { color: t.paper, borderColor: t.accent }, moveHandleStyle: { color: alpha(t.accent, 0.35) },
        dataBackground: { lineStyle: { color: t.rule }, areaStyle: { color: alpha(t.accent, 0.08) } },
        selectedDataBackground: { lineStyle: { color: t.accent }, areaStyle: { color: alpha(t.accent, 0.2) } },
        textStyle: { color: t.ink3, fontSize: 10 }, brushStyle: { color: alpha(t.accent, 0.12) }
      },
      visualMap: { textStyle: { color: t.ink2, fontSize: 11 }, inRange: { color: t.seq } },
      toolbox: { iconStyle: { borderColor: t.ink3 }, emphasis: { iconStyle: { borderColor: t.accent } } },
      geo: {
        itemStyle: { areaColor: t.mapLand || t.surface2 || '#eef1f5', borderColor: t.mapBorder || t.paper, borderWidth: 0.6 },
        emphasis: { itemStyle: { areaColor: t.highlight }, label: { color: t.ink } },
        label: { color: t.ink2 }
      },
      animationDuration: 900,
      animationDurationUpdate: 600,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicInOut'
    };
  }

  /* ---------------- public API ---------------- */
  var theme = RK.theme = {
    current: null,
    list: ['navy', 'bronze', 'slate', 'ink'],
    labels: { navy: 'Navy classic', bronze: 'Bronze & ivory', slate: 'Slate modern', ink: 'Ink (dark)' },
    mix: mix,
    alpha: alpha,
    onColor: onColor,
    luminance: luminance,
    parseColor: parseColor,
    toHex: toHex,

    refresh: function () {
      theme.current = readTokens();
      if (global.echarts) global.echarts.registerTheme('rk', echartsTheme(theme.current));
      return theme.current;
    },
    init: function () { return theme.refresh(); },
    tokens: function () { return theme.current || theme.refresh(); },
    echarts: function () { return echartsTheme(theme.tokens()); },

    /** Switch theme at runtime: sets <html data-rk-theme>, re-reads tokens, re-renders blocks. */
    set: function (name) {
      document.documentElement.setAttribute('data-rk-theme', name);
      try { localStorage.setItem('rk:theme', name); } catch (e) { /* storage unavailable */ }
      theme.refresh();
      RK.bus.emit('theme:changed', theme.current);
    },

    /** Readable label colour on top of a data fill, correct in light and dark themes. */
    textOn: function (fill) {
      var t = theme.tokens();
      return onColor(fill, t.dark ? t.paper : t.ink, t.dark ? t.ink : '#ffffff');
    },

    /** Categorical color for index i (wraps). */
    color: function (i) { var c = theme.tokens().cat; return c[((i % c.length) + c.length) % c.length]; },

    /** Stable category -> color map. Known keys keep their color across re-renders. */
    categorical: function (values) {
      var cat = theme.tokens().cat, map = {};
      values.forEach(function (v, i) { map[v] = cat[i % cat.length]; });
      return function (v) { return map[v] || theme.tokens().neutral; };
    },

    /** Sequential scale over [min, max]. */
    sequential: function (domain, stops) {
      var r = ramp(stops || theme.tokens().seq), lo = domain[0], hi = domain[1];
      return function (v) { return v == null || isNaN(v) ? theme.tokens().neutral : r(hi === lo ? 1 : (v - lo) / (hi - lo)); };
    },

    /** Diverging scale with a midpoint (default 0). */
    diverging: function (domain, mid, stops) {
      var r = ramp(stops || theme.tokens().div), lo = domain[0], hi = domain[1];
      mid = mid == null ? 0 : mid;
      return function (v) {
        if (v == null || isNaN(v)) return theme.tokens().neutral;
        if (v < mid) return r(0.5 - 0.5 * Math.min(1, (mid - v) / ((mid - lo) || 1)));
        return r(0.5 + 0.5 * Math.min(1, (v - mid) / ((hi - mid) || 1)));
      };
    },
    ramp: ramp
  };
})(typeof window !== 'undefined' ? window : this);
