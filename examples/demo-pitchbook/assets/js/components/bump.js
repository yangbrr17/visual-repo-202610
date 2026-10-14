/*!
 * RK component: bump — rank over time (or across any ordered dimension). One line per entity,
 * rank #1 at the top, a node per period carrying the rank number, entity names at both ends
 * (left = first-period order, right = last-period order + value). Ranks come from encode.rank or
 * are computed per period from encode.value. Wide data: encode.rank / encode.value = [fields],
 * one period per field (e.g. ['prior_rank', 'rank']).
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
      'bump.changeVs': '较{period}的排名变化', 'bump.dateMonth': 'yy"年"m"月"'
    });
  }

  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  /** Greedy word wrap to `width` px (period headers that would run into their neighbours). */
  function wrap(text, width, font) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (cur && C.measure(next, font) > width) { lines.push(cur); cur = w; } else cur = next;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  RK.component({
    id: 'bump',
    deps: ['echarts'],
    defaults: {
      encode: { x: 'period', series: 'series', value: 'value', rank: null },
      rankOrder: 'desc',      // ranks computed from encode.value: 'desc' = largest is #1 | 'asc' = smallest is #1
      agg: 'sum',             // combines several rows per period + entity (e.g. a region dimension)
      highlight: null,        // entity value(s) drawn in accent-2
      muted: 'auto',          // grey non-highlighted lines: 'auto' (when highlight is set) | true | false
      top: null,              // show ranks 1..N only (entities enter / leave the chart)
      smooth: true,           // S-curves between periods
      rankLabels: true,       // rank number inside each node
      endLabels: true,        // entity names at both ends, in rank order
      showValue: true,        // last-period value next to the right-hand name (when values exist)
      xLabels: null,          // override period labels (e.g. ['FY2025', 'FY2026 YTD'] for wide rank fields)
      sortX: false,           // sort periods ascending (long data); otherwise data order
      format: null            // value format; defaults to the value field's format
    },
    render: C(function (ctx) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc, rows = ctx.rows, sf = enc.series;
      var wideFields = Array.isArray(enc.rank) ? enc.rank : Array.isArray(enc.value) ? enc.value : null;
      var rankGiven = wideFields ? Array.isArray(enc.rank) : !!enc.rank;
      var fmt = o.format || (!wideFields && enc.value ? ctx.fmtOf(enc.value) : null) || 'auto';

      /* ---------- periods x entities matrices (value, rank) ---------- */
      var periods, entities = util.unique(rows.map(function (r) { return r[sf]; }).filter(function (v) { return v != null; }));
      var val = {}, rank = {};
      entities.forEach(function (e) { val[e] = []; rank[e] = []; });
      if (wideFields) {
        periods = wideFields.map(function (f) { return ctx.title(f); });
        rows.forEach(function (r) {
          if (r[sf] == null) return;
          wideFields.forEach(function (f, j) { (rankGiven ? rank : val)[r[sf]][j] = util.isNum(r[f]) ? r[f] : null; });
        });
      } else {
        periods = util.unique(rows.map(function (r) { return r[enc.x]; }).filter(function (v) { return v != null; }));
        if (o.sortX) periods.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
        var aggFn = RK.expr.agg[o.agg] || RK.expr.agg.sum, acc = {};
        rows.forEach(function (r) {
          if (r[sf] == null || r[enc.x] == null) return;
          var k = r[sf] + '\u0001' + r[enc.x];
          (acc[k] || (acc[k] = { v: [], r: [] })).v.push(r[enc.value]);
          if (rankGiven) acc[k].r.push(r[enc.rank]);
        });
        entities.forEach(function (e) {
          periods.forEach(function (p, j) {
            var a = acc[e + '\u0001' + p];
            val[e][j] = a && enc.value ? aggFn(a.v) : null;
            if (rankGiven) rank[e][j] = a ? RK.expr.agg.min(a.r) : null;
          });
        });
      }
      // computed ranks: competition ranking (1, 2, 2, 4) per period
      if (!rankGiven) {
        periods.forEach(function (_, j) {
          var list = entities.filter(function (e) { return util.isNum(val[e][j]); })
            .sort(function (a, b) { return o.rankOrder === 'asc' ? val[a][j] - val[b][j] : val[b][j] - val[a][j]; });
          list.forEach(function (e, i) {
            var prev = list[i - 1];
            rank[e][j] = i > 0 && val[prev][j] === val[e][j] ? rank[prev][j] : i + 1;
          });
          entities.forEach(function (e) { if (!util.isNum(val[e][j])) rank[e][j] = null; });
        });
      }
      var hasValues = entities.some(function (e) { return val[e].some(util.isNum); });
      var labelsX = (o.xLabels && o.xLabels.length === periods.length ? o.xLabels : periods).map(function (p) {
        var f = !wideFields && ctx.field(enc.x);
        return f && f.type === 'date' ? RK.format(p, f.format || tr('bump.dateMonth', 'mmm yy')) : String(p);
      });

      var allRanks = [];
      entities.forEach(function (e) { rank[e].forEach(function (r) { if (util.isNum(r)) allRanks.push(r); }); });
      var N = util.isNum(o.top) ? o.top : Math.max.apply(null, allRanks.concat([1]));
      var inView = function (r) { return util.isNum(r) && r >= 1 && r <= N; };
      entities = entities.filter(function (e) { return rank[e].some(inView); });
      var last = periods.length - 1;
      // colour order: entity order in the unfiltered data (colours stay put while filters change)
      var colorOrder = util.unique(ctx.allRows.map(function (r) { return r[sf]; }));

      /* ---------- colours ---------- */
      var hl = o.highlight == null ? [] : [].concat(o.highlight);
      var isHL = function (e) { return hl.some(function (h) { return same(h, e); }); };
      var muted = o.muted === true || (o.muted === 'auto' && hl.length > 0);
      var pal = RK.theme.palette({ n: colorOrder.length });   // peer colours never resemble the accent-2 highlight
      var mutedColor = RK.theme.mix(t.ink3, t.paper, 0.45);
      var sel = ctx.selected(sf);
      var colorOf = function (e) {
        if (isHL(e)) return t.accent2;
        return muted ? mutedColor : pal[Math.max(0, colorOrder.indexOf(e))];
      };
      var dimmed = function (e) { return sel.length && sel.indexOf(e) < 0; };

      /* ---------- end labels via left / right category axes (containLabel sizes the margins) ---------- */
      // names wear ink tokens (the series colour is carried by the rank node next to them); the target is ink 600.
      // Right-hand values sit in one right-aligned column after a fixed-width name segment.
      var nameFont = '11px ' + t.fontSans, valFont = '10.5px ' + t.fontNum;
      var namesAt = function (j, ri) {
        return entities.filter(function (e) { return rank[e][j] === ri + 1; });
      };
      var valText = function (e, j) { return o.showValue && hasValues && util.isNum(val[e][j]) ? C.richSafe(RK.format(val[e][j], fmt).replace(/^-/, '\u2212')) : ''; };
      var nameW = 0, valW = 0, leftW = 0;
      entities.forEach(function (e) {
        var f = (isHL(e) ? '600 ' : '') + nameFont;
        if (inView(rank[e][last])) { nameW = Math.max(nameW, C.measure(e, f)); valW = Math.max(valW, C.measure(valText(e, last), valFont)); }
        if (inView(rank[e][0])) leftW = Math.max(leftW, C.measure(e, f));
      });
      nameW = Math.ceil(nameW) + 1; valW = Math.ceil(valW) + 1;
      var rich = {
        v: { color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum, padding: [0, 0, 0, 6] },
        vc: { color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum, width: valW, align: 'right', padding: [0, 0, 0, 10] },
        n: { color: t.ink2, fontSize: 11, fontFamily: t.fontSans },
        h: { color: t.ink, fontSize: 11, fontFamily: t.fontSans, fontWeight: 600 },
        d: { color: RK.theme.alpha(t.ink3, 0.5), fontSize: 11, fontFamily: t.fontSans }
      };
      ['n', 'h', 'd'].forEach(function (k) { rich[k + 'w'] = util.merge({}, rich[k], { width: nameW }); });
      var cls = function (e) { return dimmed(e) ? 'd' : isHL(e) ? 'h' : 'n'; };
      var sideLabel = function (j, right) {
        return function (_, ri) {
          var list = namesAt(j, ri);
          if (!list.length) return '';
          var column = right && list.length === 1 && valW > 1;   // ties ('a / b') fall back to running text
          return list.map(function (e) {
            var v = right ? valText(e, j) : '';
            if (column) return '{' + cls(e) + 'w|' + C.richSafe(e) + '}{vc|' + v + '}';
            return '{' + cls(e) + '|' + C.richSafe(e) + '}' + (v ? '{v|' + v + '}' : '');
          }).join('{v| / }');
        };
      };
      var ranks = []; for (var k = 1; k <= N; k++) ranks.push(String(k));
      var yBase = {
        type: 'category', data: ranks, inverse: true, boundaryGap: false,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }
      };
      var yAxes = [
        util.merge({}, yBase, { position: 'left', axisLabel: o.endLabels ? { margin: 16, rich: rich, formatter: sideLabel(0, false) } : { margin: 14, color: t.ink3, formatter: '#{value}' } }),
        util.merge({}, yBase, { position: 'right', axisLabel: { show: !!o.endLabels, margin: 16, rich: rich, formatter: sideLabel(last, true) } })
      ];

      /* ---------- period headers: wrapped to the column spacing so neighbours never run together ---------- */
      var nodeSize = o.rankLabels ? (N > 14 ? 16 : 20) : 8;
      var W = ctx.el.clientWidth || 800, headFont = '600 11px ' + t.fontSans;
      var plotW = W - 12 - (o.endLabels ? leftW + 16 + nameW + valW + 26 : 40);
      var colPx = periods.length > 1 ? plotW / (periods.length - 1) : plotW;
      var heads = labelsX.map(function (l) { return wrap(l, Math.max(40, colPx - 10), headFont); });
      var headLines = Math.max.apply(null, heads.map(function (h) { return h.length; }).concat([1]));

      /* ---------- series ---------- */
      var series = entities.map(function (e) {
        var c = colorOf(e), dim = dimmed(e), h = isHL(e);
        var lc = dim ? RK.theme.alpha(c, 0.18) : c;
        return {
          id: 'b-' + e, name: String(e), type: 'line',
          smooth: o.smooth ? 0.45 : false, smoothMonotone: 'x', connectNulls: false,
          symbol: 'circle', symbolSize: nodeSize, showSymbol: true,
          z: h ? 4 : 2,
          lineStyle: { color: lc, width: h ? 3.5 : (muted ? 2 : 2.5) },
          itemStyle: { color: lc, borderColor: t.paper, borderWidth: 1.5 },
          label: o.rankLabels ? {
            show: true, position: 'inside', fontSize: N > 14 ? 9 : 10, fontWeight: 600, fontFamily: t.fontNum,
            color: dim ? 'rgba(0,0,0,0)' : RK.theme.textOn(c),
            formatter: function (p) { return String(+p.value[1] + 1); }
          } : { show: false },
          emphasis: { focus: 'series', lineStyle: { width: h ? 4 : 3.5 } },
          blur: { lineStyle: { opacity: 0.12 }, itemStyle: { opacity: 0.15 }, label: { opacity: 0.15 } },
          data: periods.map(function (_, j) { var r = rank[e][j]; return inView(r) ? [j, r - 1] : [j, null]; })
        };
      });
      // highlighted entities paint last
      series.sort(function (a, b) { return a.z - b.z; });

      var change = function (e, j) {
        if (j === 0 || !inView(rank[e][j]) || !util.isNum(rank[e][j - 1])) return '';
        var d = rank[e][j - 1] - rank[e][j];
        return d > 0 ? '  ▲' + d : d < 0 ? '  ▼' + (-d) : '  –';
      };

      return {
        legend: { show: false },
        grid: { left: 6, right: 6, top: 28 + 13 * (headLines - 1) + nodeSize / 2, bottom: nodeSize / 2 + 3, containLabel: true },
        tooltip: {
          trigger: 'axis', confine: true,
          axisPointer: { type: 'line', lineStyle: { color: t.axis, type: 'dashed' } },
          formatter: function (ps) {
            if (!ps.length) return '';
            var j = ps[0].dataIndex;
            var list = entities.filter(function (e) { return inView(rank[e][j]); }).sort(function (a, b) { return rank[a][j] - rank[b][j]; });
            return C.tip(labelsX[j], list.map(function (e) {
              var v = hasValues && util.isNum(val[e][j]) ? RK.format(val[e][j], fmt) : '';
              return { color: colorOf(e), label: '#' + rank[e][j] + '  ' + e, value: v + change(e, j), bold: isHL(e) };
            }), j > 0 ? tr('bump.changeVs', 'Change vs. {period}', { period: labelsX[j - 1] }) : null);
          }
        },
        xAxis: {
          type: 'category', data: labelsX, position: 'top', boundaryGap: false,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: {
            color: t.ink, fontWeight: 600, fontSize: 11, lineHeight: 13, margin: 14, interval: 0,
            formatter: function (v, j) { return (heads[j] || [String(v)]).map(C.richSafe).join('\n'); }
          },
          splitLine: { show: true, lineStyle: { color: t.grid } }
        },
        yAxis: yAxes,
        series: series
      };
    }, {
      select: function (p, ctx) { return p.seriesName ? { field: ctx.enc.series, value: p.seriesName } : null; }
    })
  });
})();
