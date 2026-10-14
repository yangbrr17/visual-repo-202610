/*!
 * RK component: donut — part-to-whole ring (or pie) with a count-up total in the hole, a side legend
 * table (name · value · % of total) or callout labels, "Others" grouping and click-to-filter.
 * Rows sharing a label are aggregated (options.agg), so long data can be bound directly.
 */
(function () {
  'use strict';
  var C = RK.chart;

  /** Generic label fields ('type', 'category' …) cross-filter only this block's dataset; business dimensions stay global. */
  var GENERIC = /^(type|kind|source|target|step|stage|metric|measure|category|group|series|label|name|id|parent|key|value|x|y)$/i;
  function scoped(ctx, f) { return GENERIC.test(f) ? { scope: ctx.options.crossFilterScope || 'dataset' } : null; }
  function truncate(s, w, font) {
    var ef = window.echarts && window.echarts.format;
    return ef && ef.truncateText ? ef.truncateText(String(s), w, font, '…') : String(s);
  }

  /** Aggregate rows by label, sort, group the tail into "Others". */
  function model(ctx) {
    var o = ctx.options, enc = ctx.enc;
    var aggFn = RK.expr.agg[o.agg] || RK.expr.agg.sum;
    function collect(rows) {
      var out = [];
      RK.util.groupBy(rows, function (r) { return r[enc.label]; }).forEach(function (g, k) {
        if (k == null || k === '') return;
        var v = aggFn(g.map(function (r) { return r[enc.value]; }));
        if (v == null || !isFinite(v) || v <= 0) return;           // negative / zero parts have no share
        out.push({ name: String(k), value: v });
      });
      return out;
    }
    var items = collect(ctx.rows);
    var bySize = function (a, b) { return b.value - a.value; };
    if (o.sort === 'desc') items.sort(bySize);
    else if (o.sort === 'asc') items.sort(function (a, b) { return a.value - b.value; });

    // tail beyond maxSlices (by size, whatever the display order) -> "Others" (always last)
    var max = o.maxSlices;
    if (max && max > 1 && items.length > max) {
      var keep = new Set(items.slice().sort(bySize).slice(0, max - 1).map(function (d) { return d.name; }));
      var members = items.filter(function (d) { return !keep.has(d.name); }).sort(bySize);
      items = items.filter(function (d) { return keep.has(d.name); });
      items.push({ name: o.othersLabel, value: members.reduce(function (s, d) { return s + d.value; }, 0), members: members, others: true });
    }
    var total = items.reduce(function (s, d) { return s + d.value; }, 0);
    items.forEach(function (d) { d.share = total ? d.value / total : null; });

    // colours: stable rank in the unfiltered data, so slices keep their colour while filtering
    var t = ctx.theme;
    var hl = o.highlight == null ? [] : [].concat(o.highlight).map(String);
    var rank = collect(ctx.allRows).sort(bySize).map(function (d) { return d.name; });
    // with a highlight, no other slice may read like the accent; tints extend the palette instead of repeating it
    var pal = RK.theme.palette(hl.length ? { n: rank.length } : { exclude: [], n: rank.length });
    items.forEach(function (d, i) {
      var r = rank.indexOf(d.name);
      var base = d.others ? t.neutral : hl.indexOf(d.name) >= 0 ? t.accent2 : pal[(r < 0 ? i : r) % pal.length];
      d.base = base;
      d.hl = hl.indexOf(d.name) >= 0;
      d.color = dimmed(ctx, d) ? RK.theme.alpha(base, 0.28) : base;
    });

    var fmt = o.format || ctx.fmtOf(enc.value) || 'auto';
    var display = o.display === 'auto' ? (/%/.test(RK.format.presets[fmt] || fmt) ? 'value' : 'both') : o.display;
    return { items: items, total: total, fmt: fmt, pctFmt: o.pctFormat || '0.0%', display: display };
  }

  function dimmed(ctx, d) {
    var sel = ctx.selected(ctx.enc.label);
    if (!sel.length) return false;
    if (d.others) return !d.members.some(function (m) { return sel.indexOf(m.name) >= 0; });
    return sel.indexOf(d.name) < 0;
  }

  /** Geometry: donut + legend table placed as one centred group. */
  function layout(ctx, m, W, H) {
    var o = ctx.options, t = ctx.theme;
    var L = { W: W, H: H, side: o.layout === 'legend' && m.items.length > 0 };
    var fontName = '11.5px ' + t.fontSans, fontNum = '11.5px ' + t.fontNum;
    if (L.side) {
      var showV = m.display !== 'pct', showP = m.display !== 'value';
      var nameW = Math.max.apply(null, m.items.map(function (d) { return C.measure(d.name, fontName); }).concat([C.measure(ctx.title(ctx.enc.label), '600 10px ' + t.fontSans), 40]));
      var valW = showV ? Math.max(56, C.measure(RK.format(m.total, m.fmt), '600 ' + fontNum) + 18) : 0;
      var pctW = showP ? 58 : 0;
      nameW = Math.min(Math.ceil(nameW) + 8, 200);
      var tableW = 18 + nameW + valW + pctW;
      var gap = Math.max(28, Math.min(56, W * 0.05));
      var R = Math.min(H / 2 - 6, (W - tableW - gap - 10) / 2, 190);
      if (R < 56) {                                   // narrow: shrink the name column first
        nameW = Math.max(60, nameW - (56 - R) * 2);
        tableW = 18 + nameW + valW + pctW;
        R = Math.max(44, Math.min(H / 2 - 6, (W - tableW - gap - 10) / 2));
      }
      var groupW = 2 * R + gap + tableW;
      var x0 = Math.max(4, (W - groupW) / 2);
      L.cx = x0 + R; L.cy = H / 2; L.R = R;
      L.table = { x: x0 + 2 * R + gap, w: tableW, nameW: nameW, valW: valW, pctW: pctW, showV: showV, showP: showP };
      var n = m.items.length, head = 22, foot = 26;
      L.table.rowH = Math.max(17, Math.min(24, (H - head - foot - 8) / Math.max(1, n)));
      var th = head + n * L.table.rowH + foot;
      L.table.y = Math.max(2, (H - th) / 2);
    } else {
      var room = o.layout === 'labels' ? Math.min(150, W * 0.22) : 6;
      L.R = Math.max(40, Math.min(H / 2 - (o.layout === 'labels' ? 32 : 6), W / 2 - room, 190));
      L.cx = W / 2; L.cy = H / 2;
    }
    L.r0 = L.R * Math.max(0, Math.min(0.9, o.innerRadius || 0));
    L.readout = !!o.center && L.r0 > 44;
    return L;
  }

  function seriesOption(ctx, m, L) {
    var o = ctx.options, t = ctx.theme;
    var labels = o.layout === 'labels';
    function readout(d) {
      if (m.display === 'value') return RK.format(d.value, m.fmt);
      if (m.display === 'pct') return RK.format(d.share, m.pctFmt);
      return RK.format(d.value, m.fmt) + '  ·  ' + RK.format(d.share, m.pctFmt);
    }
    return {
      id: 'donut', type: 'pie',
      center: [L.cx, L.cy],
      radius: [L.r0, L.R],
      startAngle: 90, clockwise: true,
      avoidLabelOverlap: true,
      minShowLabelAngle: 3,
      itemStyle: { borderColor: t.paper, borderWidth: m.items.length > 1 ? 1.5 : 0 },
      label: labels ? {
        show: true, position: 'outside', alignTo: 'labelLine', edgeDistance: 6, bleedMargin: 4,
        color: t.ink2, fontSize: 11, lineHeight: 15,
        formatter: function (p) { var d = m.items[p.dataIndex]; return '{n|' + d.name + '}\n{v|' + readout(d) + '}'; },
        rich: {
          n: { color: t.ink, fontSize: 11.5, fontWeight: 600, fontFamily: t.fontSans, lineHeight: 15 },
          v: { color: t.ink3, fontSize: 11, fontFamily: t.fontNum, lineHeight: 15 }
        }
      } : { show: false },
      labelLine: labels ? { show: true, length: 10, length2: 14, smooth: false, lineStyle: { color: t.axis, width: 1 } } : { show: false },
      labelLayout: labels ? { hideOverlap: true } : undefined,
      emphasis: { scale: true, scaleSize: 5, focus: 'self' },
      blur: { itemStyle: { opacity: 0.4 } },
      animationType: 'expansion',
      animationDuration: 900,
      animationDurationUpdate: 600,
      data: m.items.map(function (d) {
        return { name: d.name, value: d.value, itemStyle: { color: d.color } };
      })
    };
  }

  /** Legend table + centre total as graphic elements (the total counts up from 0, then from the previous total). */
  function graphics(ctx, m, L, first) {
    var o = ctx.options, t = ctx.theme, els = [];
    var anim = ctx.motion;
    var enterRow = function (i) { return anim && first ? { enterFrom: { style: { opacity: 0 }, x: 6 }, enterAnimation: { duration: 420, delay: 250 + i * 45 } } : {}; };

    if (o.center && L.r0 > 26) {
      var vSize = Math.round(Math.max(13, Math.min(24, L.r0 * 0.3)));
      var showLbl = o.centerLabel && L.r0 > 38;
      var val = {
        id: 'ctr-val', type: 'text', x: L.cx, y: L.cy + (showLbl ? -7 : 0), z: 1, silent: true,
        style: { text: RK.format(m.total, m.fmt), fill: t.ink, font: '600 ' + vSize + 'px ' + t.fontNum, textAlign: 'center', textVerticalAlign: 'middle' },
        extra: { v: m.total }, transition: ['extra'],
        during: function (api) { api.setStyle('text', RK.format(api.getExtra('v'), m.fmt)); }
      };
      if (anim && L.from !== m.total) { val.enterFrom = { extra: { v: L.from || 0 } }; val.enterAnimation = { duration: first ? 1000 : 600 }; }
      if (!anim) val.transition = [];
      els.push(val);
      els.push({
        id: 'ctr-lbl', type: 'text', x: L.cx, y: L.cy + vSize / 2 + 5, z: 1, silent: true, invisible: !showLbl,
        style: { text: String(o.centerLabel || '').toUpperCase(), fill: t.ink3, font: '600 10px ' + t.fontSans, textAlign: 'center', textVerticalAlign: 'middle' }
      });
    } else {
      els.push({ id: 'ctr-val', type: 'text', invisible: true, style: { text: '' } }, { id: 'ctr-lbl', type: 'text', invisible: true, style: { text: '' } });
    }

    if (L.side && L.table) {
      var T = L.table, x = T.x, y = T.y, head = 22;
      var xName = x + 16, xVal = x + 16 + T.nameW + T.valW, xPct = x + T.w;
      var hFont = '600 10px ' + t.fontSans;
      var cell = function (id, tx, ty, text, extra) {
        return RK.util.merge({ id: id, type: 'text', x: tx, y: ty, silent: true,
          style: { text: text, fill: t.ink2, font: '11.5px ' + t.fontSans, textAlign: 'left', textVerticalAlign: 'middle' } }, extra || {});
      };
      els.push(cell('h-name', x, y + 8, truncate(ctx.title(ctx.enc.label), T.nameW + 12, hFont), { style: { fill: t.ink3, font: hFont } }));
      els.push(cell('h-val', xVal, y + 8, T.showV ? truncate(ctx.title(ctx.enc.value), T.valW + T.nameW * 0.5, hFont) : '', { style: { fill: t.ink3, font: hFont, textAlign: 'right' } }));
      els.push(cell('h-pct', xPct, y + 8, T.showP ? '% of total' : '', { style: { fill: t.ink3, font: hFont, textAlign: 'right' } }));
      els.push({ id: 'h-rule', type: 'line', silent: true, shape: { x1: x, y1: y + head - 4, x2: x + T.w, y2: y + head - 4 }, style: { stroke: t.ink3, lineWidth: 1 } });

      m.items.forEach(function (d, i) {
        var cy = y + head + T.rowH * (i + 0.5);
        var dim = d.color !== d.base;
        var ink = dim ? RK.theme.alpha(t.ink2, 0.45) : (d.hl ? t.ink : t.ink2);
        var weight = d.hl ? '600 ' : '';
        // flat elements (no groups): merges then add / update / remove each one cleanly by id
        var hit = {
          id: 'row-' + i + '-hit', type: 'rect', cursor: 'pointer',
          shape: { x: x - 4, y: cy - T.rowH / 2, width: T.w + 8, height: T.rowH }, style: { fill: 'rgba(0,0,0,0)' },
          onmouseover: function () { L.inst.dispatchAction({ type: 'highlight', seriesId: 'donut', name: d.name }); L.onHover(d); },
          onmouseout: function () { L.inst.dispatchAction({ type: 'downplay', seriesId: 'donut', name: d.name }); L.onHover(null); },
          onclick: function () { if (L.onPick) L.onPick(d); }
        };
        var parts = [
          { id: 'row-' + i + '-sw', type: 'rect', silent: true, shape: { x: x, y: cy - 5, width: 10, height: 10, r: 2 }, style: { fill: d.color } },
          { id: 'row-' + i + '-n', type: 'text', silent: true, x: xName, y: cy, style: { text: truncate(d.name, T.nameW - 4, weight + '11.5px ' + t.fontSans), fill: ink, font: weight + '11.5px ' + t.fontSans, textVerticalAlign: 'middle' } },
          { id: 'row-' + i + '-v', type: 'text', silent: true, x: xVal, y: cy, invisible: !T.showV, style: { text: RK.format(d.value, m.fmt), fill: dim ? ink : t.ink, font: weight + '11.5px ' + t.fontNum, textAlign: 'right', textVerticalAlign: 'middle' } },
          { id: 'row-' + i + '-p', type: 'text', silent: true, x: xPct, y: cy, invisible: !T.showP, style: { text: RK.format(d.share, m.pctFmt), fill: dim ? ink : t.ink3, font: weight + '11.5px ' + t.fontNum, textAlign: 'right', textVerticalAlign: 'middle' } }
        ];
        els.push(hit);
        parts.forEach(function (el) { els.push(RK.util.merge(el, enterRow(i))); });
      });
      var fy = y + head + T.rowH * m.items.length + 4;
      els.push({ id: 'f-rule', type: 'line', silent: true, shape: { x1: x, y1: fy, x2: x + T.w, y2: fy }, style: { stroke: t.rule, lineWidth: 1 } });
      els.push(cell('f-name', xName, fy + 12, 'Total', { style: { fill: t.ink, font: '600 11.5px ' + t.fontSans } }));
      els.push(cell('f-val', xVal, fy + 12, T.showV ? RK.format(m.total, m.fmt) : '', { style: { fill: t.ink, font: '600 11.5px ' + t.fontNum, textAlign: 'right' } }));
      els.push(cell('f-pct', xPct, fy + 12, T.showP ? RK.format(1, m.pctFmt) : '', { style: { fill: t.ink, font: '600 11.5px ' + t.fontNum, textAlign: 'right' } }));
    }
    return els;
  }

  function tooltip(ctx, m, L) {
    return {
      show: !L.readout,               // the centre readout replaces the tooltip when the hole is large enough
      trigger: 'item',
      confine: true,
      formatter: function (p) {
        var d = m.items[p.dataIndex];
        if (!d) return '';
        var rows = [
          { color: d.base, label: ctx.title(ctx.enc.value), value: RK.format(d.value, m.fmt) },
          { label: '% of total', value: RK.format(d.share, m.pctFmt) }
        ];
        var foot = null;
        if (d.others) {
          var names = d.members.slice(0, 5).map(function (x) { return x.name; });
          foot = d.members.length + ' items: ' + names.join(', ') + (d.members.length > 5 ? ', …' : '');
        }
        return C.tip(d.name, rows, foot);
      }
    };
  }

  /** Toggle the cross-filter for a slice ("Others" toggles all of its members). */
  function pick(ctx, d) {
    if (!d || ctx.options.crossFilter === false) return;
    var f = ctx.enc.label, sc = scoped(ctx, f);
    if (!d.others) { ctx.select(f, d.name, sc); return; }
    var sel = ctx.selected(f);
    var all = d.members.every(function (x) { return sel.indexOf(x.name) >= 0; });
    // all members selected -> drop them, else add the missing ones (one store write)
    ctx.setSelection(f, all ? sel.filter(function (n) { return !d.members.some(function (x) { return x.name === n; }); })
      : sel.concat(d.members.map(function (x) { return x.name; }).filter(function (n) { return sel.indexOf(n) < 0; })), sc);
  }

  RK.component({
    id: 'donut',
    deps: ['echarts'],
    defaults: {
      encode: { label: 'label', value: 'value' },
      layout: 'legend',        // legend (side table: name · value · %) | labels (callout lines) | none
      display: 'auto',         // auto | value | pct | both — auto shows only the value when it is already a %
      maxSlices: 7,            // slices beyond this are grouped into "Others"
      othersLabel: 'Others',
      sort: 'desc',            // desc | asc | null (data order); "Others" is always last
      agg: 'sum',              // how rows sharing a label are combined
      innerRadius: 0.62,       // hole as a share of the outer radius (0 = pie)
      center: true,            // total in the hole (count-up)
      centerLabel: 'Total',
      highlight: null,         // label(s) drawn in the accent colour (e.g. the client)
      format: null,            // value format; defaults to the value field format
      pctFormat: '0.0%'
    },
    render: function (ctx) {
      var state = { m: null, L: null, first: true, ctx: ctx, prevTotal: 0 };
      // hover readout in the hole (HTML: transient, so it does not need to be part of exports)
      var h = RK.util.h;
      var rName = h('div.rk-donut__name'), rVal = h('div.rk-donut__value.rk-num'), rPct = h('div.rk-donut__pct');
      var readout = h('div.rk-donut__readout', { 'aria-hidden': 'true' }, rName, rVal, rPct);
      function hover(d) {
        var L = state.L, m = state.m;
        if (!d || !L || !L.readout) { readout.classList.remove('is-on'); return; }
        rName.textContent = d.name;
        rVal.textContent = RK.format(d.value, m.fmt);
        rPct.textContent = RK.format(d.share, m.pctFmt) + ' of total' + (d.others ? ' · ' + d.members.length + ' items' : '');
        readout.classList.add('is-on');
      }

      var base = C(function (c, inst) {
        if (!state.first) hover(null);
        state.ctx = c;
        var m = state.m = model(c);
        var L = state.L = layout(c, m, inst.getWidth(), inst.getHeight());
        L.inst = inst;
        L.onPick = function (d) { pick(state.ctx, d); };
        L.onHover = hover;
        var d = Math.floor(L.r0 * 1.8);
        readout.style.cssText = 'left:' + L.cx + 'px;top:' + L.cy + 'px;width:' + d + 'px;height:' + d + 'px;--rk-donut-v:' + Math.round(Math.max(13, Math.min(24, L.r0 * 0.3))) + 'px';
        // the legend table / centre total are replaced on every build (RK.chart replace-merges 'graphic'),
        // so the total counts up from the previous value via enterFrom
        L.from = state.first ? 0 : state.prevTotal;
        var els = graphics(c, m, L, state.first);
        state.prevTotal = m.total;
        state.first = false;
        return {
          legend: { show: false },
          tooltip: tooltip(c, m, L),
          graphic: { elements: els },
          series: [seriesOption(c, m, L)]
        };
      }, {
        rebuildOnResize: true,   // radius + legend table are laid out in pixels
        on: {
          click: function (p) { if (p.seriesId === 'donut') pick(state.ctx, state.m.items[p.dataIndex]); },
          mouseover: function (p) { if (p.seriesId === 'donut') hover(state.m.items[p.dataIndex]); },
          mouseout: function (p) { if (p.seriesId === 'donut') hover(null); },
          globalout: function () { hover(null); }
        }
      })(ctx);
      ctx.el.appendChild(readout);

      var destroy = base.destroy;
      base.destroy = function () { readout.remove(); destroy(); };
      return base;
    }
  });
})();
