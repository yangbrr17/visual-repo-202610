/*!
 * RK component: funnel — process / pipeline funnel in pitchbook style: one flat bar per stage
 * (centred or left-aligned, width ∝ value), light connectors between stages carrying the stage
 * conversion %, stage names on the left and optional right-hand columns (secondary value,
 * % of first stage) with headers. No 3D, no trapezoid "cone".
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
      'funnel.pctOfFirst': '占首阶段比例', 'funnel.pctOfTop': '占顶层比例', 'funnel.convFrom': '自{stage}的转化率', 'funnel.pctOf': '占{stage}比例',
      'funnel.avgPerUnit': '单位平均值'
    });
  }

  /** Label width via the shared canvas measure; +7% because the canvas may still measure a fallback face. */
  function measure(text, font) { return C.measure(text, font) * 1.07; }

  RK.component({
    id: 'funnel',
    deps: ['echarts'],
    defaults: {
      encode: { stage: 'stage', value: 'count', secondary: 'value' },
      align: 'center',          // center | left
      conversion: 'previous',   // previous | first | false — % shown in the connector below each stage
      cumulative: true,         // right-hand "% of first" column
      columns: true,            // right-hand columns (secondary value, % of first) with headers
      colorBy: 'stage',         // stage (ordinal ramp, dark -> light) | single (accent)
      highlight: null,          // stage name(s) drawn in accent2 (e.g. 'Closed won')
      barRatio: 0.6,            // bar thickness as a share of the row
      labels: true,             // value labels on the bars
      format: null,             // value format (defaults to the value field's format)
      secondaryFormat: null,    // secondary column format (defaults to its field's format)
      crossFilter: true,
      crossFilterScope: 'dataset'   // 'stage' is a generic field: the selection filters this dataset only
    },
    render: C(function (ctx) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var rows = ctx.rows.filter(function (r) { return r[enc.stage] != null; });
      var stages = rows.map(function (r) { return String(r[enc.stage]); });
      var vals = rows.map(function (r) { return util.isNum(r[enc.value]) ? r[enc.value] : null; });
      var hasSec = !!(enc.secondary && ctx.field(enc.secondary));
      var secs = rows.map(function (r) { return hasSec && util.isNum(r[enc.secondary]) ? r[enc.secondary] : null; });
      var fmt = o.format || ctx.fmtOf(enc.value) || '#,##0';
      var sfmt = o.secondaryFormat || (hasSec && ctx.fmtOf(enc.secondary)) || 'auto';
      var max = Math.max.apply(null, vals.filter(util.isNum).concat([1e-9]));
      var first = vals[0];
      var center = o.align !== 'left';
      var hi = o.highlight == null ? [] : [].concat(o.highlight);
      var n = stages.length;

      function conv(i) {
        if (i <= 0) return null;
        var base = o.conversion === 'first' ? first : vals[i - 1];
        return vals[i] == null || base == null ? null : (base ? vals[i] / base : NaN);
      }

      // colours: ordinal ramp down the funnel (dark -> light), highlight in accent2
      var ramp = RK.theme.ramp(t.ord.slice(0, 4));
      var colors = stages.map(function (s, i) {
        var c = hi.indexOf(s) >= 0 ? t.accent2 : (o.colorBy === 'single' ? t.accent : ramp(n > 1 ? i / (n - 1) : 0));
        return C.dim(ctx, enc.stage, s, c);
      });
      // label colour against what is actually painted (a dimmed bar is its colour at 25% over the paper)
      function inkOn(c) { var x = RK.theme.parseColor(c); return RK.theme.textOn(x[3] < 1 ? RK.theme.mix(RK.theme.toHex(x), t.paper, 1 - x[3]) : c); }

      // geometry: stage labels left, columns right, header row on top
      var labFont = '600 11px ' + t.fontSans, numFont = '11px ' + t.fontNum, headFont = '600 10px ' + t.fontSans;
      var labW = Math.min(220, Math.max.apply(null, stages.map(function (s) { return measure(s, labFont); }).concat([40])));
      /** Header text with the field's unit, e.g. "PIPELINE VALUE (USD M)". */
      function titled(f) { var fd = ctx.field(f) || {}; return String(ctx.title(f)) + (fd.unit ? ' (' + fd.unit + ')' : ''); }
      var cols = [];
      if (o.columns !== false) {
        if (hasSec) cols.push({ title: titled(enc.secondary), text: secs.map(function (v) { return RK.format(v, sfmt); }) });
        if (o.cumulative !== false) cols.push({ title: o.conversion === 'first' ? tr('funnel.pctOfFirst', '% of first') : tr('funnel.pctOfTop', '% of top'), text: vals.map(function (v) { return RK.format(v == null ? null : (first ? v / first : NaN), '0.0%'); }) });
        if (!o.cumulative && !hasSec) cols = [];
      }
      cols.forEach(function (c) {
        c.w = Math.ceil(Math.max(measure(String(c.title).toUpperCase(), headFont) + 6, Math.max.apply(null, c.text.map(function (s) { return measure(s, numFont); }))) + 22);
      });
      var colsW = cols.reduce(function (s, c) { return s + c.w; }, 0);
      var headH = cols.length ? 24 : 4;

      // value labels: one placement rule for the whole chart — inside every bar when all of them fit,
      // otherwise outside every bar (with room reserved right of the widest bar)
      var W0 = ctx.el.clientWidth || 600, valFont = '600 ' + numFont;
      var tws = vals.map(function (v) { return measure(RK.format(v, fmt), valFont); });
      var plot0 = Math.max(40, W0 - (labW + 18) - (colsW + (center ? 8 : 40)));
      var allInside = vals.every(function (v, i) { return !util.isNum(v) || v / max * plot0 > tws[i] + 14; });
      var outRoom = allInside || o.labels === false ? 0 : Math.max.apply(null, tws.concat([0])) + 10;
      var gridRight = colsW + (center ? 8 : 40) + (outRoom ? (center ? outRoom * 2 : Math.max(0, outRoom - 32)) : 0);

      function renderItem(params, api) {
        var i = params.dataIndex, v = vals[i];
        var rowH = api.size([0, 1])[1], bh = Math.max(6, rowH * o.barRatio);
        var cy = api.coord([0, i])[1];
        var a = api.coord([center ? -(v || 0) / 2 : 0, i])[0], b = api.coord([center ? (v || 0) / 2 : (v || 0), i])[0];
        var mid = (a + b) / 2;
        var kids = [];
        kids.push({
          type: 'rect', id: 'bar',
          shape: { x: a, y: cy - bh / 2, width: Math.max(v ? 1 : 0, b - a), height: bh },
          style: { fill: colors[i] },
          originX: center ? mid : a, originY: cy,
          enterFrom: { scaleX: 0, style: { opacity: 0 } },
          transition: ['shape', 'style'],
          emphasis: { style: { fill: RK.theme.mix(colors[i], t.ink, 0.15) } }
        });
        // value label: inside every bar or outside every bar (decided once for the chart above)
        if (o.labels !== false) {
          var txt = RK.format(v, fmt);
          var inside = allInside;
          kids.push({
            type: 'text', id: 'val', silent: true,
            x: inside ? mid : b + 6, y: cy,
            style: {
              text: txt, align: inside ? 'center' : 'left', verticalAlign: 'middle', font: '600 ' + numFont,
              fill: inside ? inkOn(colors[i]) : t.ink2
            },
            enterFrom: { style: { opacity: 0 } }, transition: ['x', 'y']
          });
        }
        // connector to the next stage with the conversion %
        if (i < n - 1) {
          var nv = vals[i + 1] || 0, ncy = api.coord([0, i + 1])[1];
          var na = api.coord([center ? -nv / 2 : 0, i + 1])[0], nb = api.coord([center ? nv / 2 : nv, i + 1])[0];
          var y0 = cy + bh / 2, y1 = ncy - bh / 2;
          kids.push({
            type: 'polygon', id: 'link', silent: true,
            shape: { points: [[a, y0], [b, y0], [nb, y1], [na, y1]] },
            style: { fill: RK.theme.alpha(t.accent3 || t.accent, t.dark ? 0.16 : 0.1) },
            transition: ['shape'], enterFrom: { style: { opacity: 0 } }
          });
          var cv = conv(i + 1);
          if (o.conversion !== false && y1 - y0 >= 11) {
            var cx2 = center ? (a + b) / 2 : Math.min(b, nb) / 2 + Math.max(a, na) / 2;
            kids.push({
              type: 'text', id: 'conv', silent: true, x: center ? cx2 : Math.max(a, na) + 8, y: (y0 + y1) / 2,
              style: {
                text: '↓ ' + RK.format(cv, '0.0%'), align: center ? 'center' : 'left', verticalAlign: 'middle',
                font: '500 10.5px ' + t.fontNum, fill: t.ink2
              },
              enterFrom: { style: { opacity: 0 } }, transition: ['x', 'y']
            });
          }
        }
        // stage name (left) and right-hand columns
        kids.push({
          type: 'text', id: 'stage', silent: true, x: 2, y: cy,
          style: { text: stages[i], align: 'left', verticalAlign: 'middle', font: labFont, fill: hi.indexOf(stages[i]) >= 0 ? t.ink : t.ink2, width: labW, overflow: 'truncate' },
          transition: ['y']
        });
        var xr = api.getWidth() - 2;
        for (var c = cols.length - 1; c >= 0; c--) {
          kids.push({
            type: 'text', id: 'col' + c, silent: true, x: xr, y: cy,
            style: { text: cols[c].text[i], align: 'right', verticalAlign: 'middle', font: numFont, fill: t.ink2 },
            transition: ['y']
          });
          xr -= cols[c].w;
        }
        // hairline between rows across the stage-label and column areas (table feel; the funnel itself stays clear)
        if (cols.length && i < n - 1) {
          var ly = (cy + api.coord([0, i + 1])[1]) / 2;
          kids.push({ type: 'line', id: 'rule', silent: true, shape: { x1: api.getWidth() - colsW + 8, y1: ly, x2: api.getWidth(), y2: ly }, style: { stroke: t.grid, lineWidth: 1 } });
          kids.push({ type: 'line', id: 'rule2', silent: true, shape: { x1: 0, y1: ly, x2: labW + 8, y2: ly }, style: { stroke: t.grid, lineWidth: 1 } });
        }
        return { type: 'group', children: kids };
      }

      // column headers + rule under them
      var graphic = [];
      if (cols.length) {
        var xr = 0;
        cols.slice().reverse().forEach(function (c, k) {
          graphic.push({
            type: 'text', id: 'h' + k, right: xr + 2, top: 4, silent: true,
            style: { text: String(c.title).toUpperCase(), font: headFont, fill: t.ink3, align: 'right' }
          });
          xr += c.w;
        });
        graphic.push({ type: 'text', id: 'hv', left: labW + 18, top: 4, silent: true, style: { text: titled(enc.value).toUpperCase(), font: headFont, fill: t.ink3 } });
        graphic.push({ type: 'rect', id: 'hr', left: 0, top: headH - 4, silent: true, shape: { width: 4000, height: 1 }, style: { fill: t.rule } });
      }

      return {
        grid: { left: labW + 18, right: gridRight, top: headH + 2, bottom: 2, containLabel: false },
        xAxis: { type: 'value', show: false, min: center ? -max / 2 : 0, max: center ? max / 2 : max },
        yAxis: { type: 'category', show: false, inverse: true, data: stages },
        graphic: graphic,
        tooltip: {
          trigger: 'item',
          formatter: function (p) {
            var i = p.dataIndex, tipRows = [{ color: colors[i], label: ctx.title(enc.value), value: RK.format(vals[i], fmt), bold: true }];
            if (hasSec) tipRows.push({ label: ctx.title(enc.secondary), value: RK.format(secs[i], sfmt) });
            if (i > 0) tipRows.push({ label: tr('funnel.convFrom', 'Conversion from {stage}', { stage: stages[i - 1] }), value: RK.format(vals[i] == null || !vals[i - 1] ? null : vals[i] / vals[i - 1], '0.0%') });
            if (i > 0) tipRows.push({ label: tr('funnel.pctOf', '% of {stage}', { stage: stages[0] }), value: RK.format(vals[i] == null || !first ? null : vals[i] / first, '0.0%') });
            if (hasSec && util.isNum(secs[i]) && vals[i]) tipRows.push({ label: tr('funnel.avgPerUnit', 'Average per unit'), value: RK.format(secs[i] / vals[i], 'auto') });
            return C.tip(stages[i], tipRows);
          }
        },
        series: [{
          id: 'funnel',
          type: 'custom',
          name: ctx.title(enc.value),
          renderItem: renderItem,
          clip: false,
          encode: { x: 1, y: 0 },
          data: stages.map(function (s, i) { return { name: s, value: [i, vals[i] == null ? 0 : vals[i]] }; }),
          animationDuration: 800,
          animationEasing: 'cubicOut'
        }]
      };
    }, {
      rebuildOnResize: true,     // inside / outside label rule and the reserved label room depend on the width
      select: function (p, ctx) { return p.componentType === 'series' ? { field: ctx.enc.stage, value: p.name } : null; }
    })
  });
})();
