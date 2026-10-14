/*!
 * RK component: gantt — transaction timetable / process Gantt (ECharts custom series).
 * One row per task, grouped by workstream (bold header rows with a summary bracket), bars coloured
 * by phase, milestones (milestone flag or start == end) as diamonds with date labels, a two-tier
 * calendar header on top (months / weeks, years / months or years / quarters depending on zoom),
 * optional "today" line with the elapsed period shaded, time zoom, and click-to-filter by workstream.
 */
(function () {
  'use strict';
  var C = RK.chart;
  var DAY = 864e5, TIER = 18;

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'gantt.fmtMonthLong': 'yyyy"年"m"月"', 'gantt.fmtMonthYear': 'yyyy"年"m"月"', 'gantt.fmtMonth': 'm"月"',
      'gantt.fmtDate': 'yyyy"年"m"月"d"日"', 'gantt.fmtDay': 'm"月"d"日"', 'gantt.fmtDateShort': 'yy"年"m"月"d"日"', 'gantt.today': '今天',
      'gantt.milestone': '里程碑', 'gantt.task': '任务', 'gantt.date': '日期', 'gantt.duration': '工期', 'gantt.days': '{n} 天',
      'gantt.day': '{n} 天', 'gantt.weeks': '（{n} 周）', 'gantt.daysShort': '{n}天', 'gantt.weeksShort': '{n}周', 'gantt.completed': '已完成',
      'gantt.startsIn': '{n} 天后开始', 'gantt.inProgress': '进行中 — 已过时间 {pct}'
    });
  }
  /** Milestone legend / tooltip name: options.milestoneName, in the report locale when left at the default. */
  function msName(o) { return o.milestoneName === 'Milestone' ? tr('gantt.milestone', 'Milestone') : o.milestoneName; }

  function ts(v) { var d = RK.format.toDate(v); return d && !isNaN(d) ? d.getTime() : null; }
  function isTrue(v) { return v === true || v === 1 || v === 'true' || v === 'TRUE' || v === 'Y' || v === 'yes'; }
  function weekStart(t, ws) { var d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7)); return d.getTime(); }
  function monthStart(t, step) { var d = new Date(t); return new Date(d.getFullYear(), Math.floor(d.getMonth() / (step || 1)) * (step || 1), 1).getTime(); }
  function addMonths(t, n) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); }
  function addDays(t, n) { var d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }

  /**
   * Calendar header periods for a visible window [lo, hi] at pxPerDay.
   * -> [{s, e, tier (0 upper | 1 lower), text, grid (draw gridline at s)}]
   */
  /** Month header text in the report locale: full code, or a one-letter / numeric form for narrow columns. */
  function monthText(t, narrow) {
    var code = tr('gantt.fmtMonth', 'mmm');
    if (!narrow) return RK.format(new Date(t), code);
    return code === 'mmm' ? RK.format(new Date(t), 'mmm').charAt(0) : RK.format(new Date(t), 'm');
  }
  function calendar(lo, hi, pxPerDay, o) {
    var out = [], monthPx = pxPerDay * 30.4;
    var mode = o.calendar && o.calendar !== 'auto' ? o.calendar : pxPerDay * 7 >= 17 ? 'weeks' : monthPx >= 20 ? 'months' : 'quarters';
    var t, n;
    if (mode === 'weeks') {
      var mfmt = monthPx >= 92 ? tr('gantt.fmtMonthLong', 'mmmm yyyy') : monthPx >= 52 ? tr('gantt.fmtMonthYear', 'mmm yyyy') : monthPx >= 26 ? tr('gantt.fmtMonth', 'mmm') : null;
      for (t = monthStart(lo); t < hi; t = n) { n = addMonths(t, 1); out.push({ s: t, e: n, tier: 0, text: mfmt ? RK.format(new Date(t), mfmt) : monthText(t, true), grid: true }); }
      for (t = weekStart(lo, o.weekStart); t < hi; t = n) { n = addDays(t, 7); out.push({ s: t, e: n, tier: 1, text: String(new Date(t).getDate()) }); }
    } else if (mode === 'months') {
      for (t = new Date(new Date(lo).getFullYear(), 0, 1).getTime(); t < hi; t = n) { n = addMonths(t, 12); out.push({ s: t, e: n, tier: 0, text: RK.format(new Date(t), 'yyyy'), grid: true }); }
      for (t = monthStart(lo); t < hi; t = n) { n = addMonths(t, 1); out.push({ s: t, e: n, tier: 1, text: monthText(t, monthPx < 26), grid: monthPx >= 26 }); }   // 'Jan' or 'J'
    } else {
      for (t = new Date(new Date(lo).getFullYear(), 0, 1).getTime(); t < hi; t = n) { n = addMonths(t, 12); out.push({ s: t, e: n, tier: 0, text: RK.format(new Date(t), 'yyyy'), grid: true }); }
      for (t = monthStart(lo, 3); t < hi; t = n) { n = addMonths(t, 3); out.push({ s: t, e: n, tier: 1, text: 'Q' + RK.format(new Date(t), 'q'), grid: false }); }
    }
    return out;
  }

  /**
   * ECharts' inside-zoom controller consumes every wheel event over the plot (preventDefault) even with
   * zoomOnMouseWheel 'ctrl', which would block page scrolling. Installed on the ECharts viewport
   * (disposed with the chart): plain wheels bypass it, so the page scrolls and only Ctrl + wheel / pinch
   * reaches the time zoom; options.wheelZoom: true opts out.
   */
  function passWheel(inst, ctx) {
    var root = inst.getZr().painter.getViewportRoot();
    function onWheel(e) { if (!e.ctrlKey && ctx.options.wheelZoom !== true) e.stopPropagation(); }
    root.addEventListener('wheel', onWheel, true);
    root.addEventListener('mousewheel', onWheel, true);
  }

  /** Visible x window of the chart (honours dataZoom), falling back to the full domain. */
  function zoomWindow(inst, S) {
    var lo = S.lo, hi = S.hi;
    try {
      var dz = (inst.getOption().dataZoom || [])[0];
      if (dz && dz.start != null) { var span = S.hi - S.lo; lo = S.lo + span * dz.start / 100; hi = S.lo + span * dz.end / 100; }
    } catch (e) { /* not rendered yet */ }
    return [lo, hi];
  }

  function calendarData(inst, S, o) {
    var w = zoomWindow(inst, S);
    var px = Math.max(1, S.plotW) / Math.max(DAY, w[1] - w[0]) * DAY;
    S.periods = calendar(w[0], w[1], px, o);
    return S.periods.map(function (p, i) { return [p.s, p.e, 0, i]; });
  }

  RK.component({
    id: 'gantt',
    deps: ['echarts'],
    defaults: {
      encode: { group: 'workstream', label: 'task', start: 'start', end: 'end', phase: 'phase', milestone: 'milestone', owner: 'owner' },
      today: null,              // 'YYYY-MM-DD' | 'now' | null — vertical "today" line
      todayLabel: 'Today',
      shadePast: true,          // shade the elapsed period left of "today"
      groupHeaders: true,       // bold workstream header rows
      summary: true,            // summary bracket (first start -> last end) on header rows
      sort: 'start',            // 'start' (groups and tasks by start date) | 'data' (dataset order)
      groupOrder: null,         // explicit workstream order, e.g. ["Process management", "Legal"]
      palette: 'categorical',   // categorical | sequential (ordered phases in shades of the accent)
      milestoneLabel: 'date',   // date | label (name, only when the row labels are hidden — else the date) | none
      milestoneName: 'Milestone',
      barLabel: null,           // field shown right of each bar (e.g. 'owner'), 'duration', or null
      endInclusive: true,       // end date is the last working day (bar runs to end of that day)
      calendar: 'auto',         // auto | weeks | months | quarters — header granularity
      weekStart: 1,             // 1 = Monday (week-commencing labels), 0 = Sunday
      domain: null,             // [start, end] fixed time window; default = whole months around the data
      labelWidth: 'auto',       // px or 'auto' (fits the longest label, max 38% of the width)
      dateFormat: null,         // tooltip date format; default = start field format or 'dd mmm yyyy'
      selectBy: 'group',        // channel used for click-to-filter / highlight: group | phase | label | null
      crossFilter: true,
      crossFilterScope: 'dataset',  // workstream / phase / task are timetable-specific: filter this dataset only
      legend: true,
      zoom: true,
      wheelZoom: null           // true: plain wheel zooms (default: Ctrl + wheel or pinch; a plain wheel scrolls the page)
    },
    render: C(function build(ctx, inst) {
      var o = ctx.options, t = ctx.theme, enc = ctx.enc;
      var S = inst.__rkGantt || (inst.__rkGantt = {});
      var dfmt = o.dateFormat || ctx.fmtOf(enc.start) || tr('gantt.fmtDate', 'dd mmm yyyy');
      if (!RK.format.isDateCode(dfmt)) dfmt = tr('gantt.fmtDate', 'dd mmm yyyy');

      /* ---------- tasks ---------- */
      var tasks = [];
      ctx.rows.forEach(function (r, i) {
        var s = ts(r[enc.start]), e = ts(r[enc.end]);
        if (s == null && e == null) return;
        if (s == null) s = e;
        if (e == null || e < s) e = s;
        var ms = (enc.milestone && isTrue(r[enc.milestone])) || s === e;
        tasks.push({
          i: i, row: r, s: s, e: e, ms: ms,
          barEnd: ms ? s : (o.endInclusive ? addDays(e, 1) : Math.max(e, s + DAY / 4)),
          group: enc.group ? (r[enc.group] == null ? '' : String(r[enc.group])) : '',
          label: r[enc.label] == null ? '' : String(r[enc.label]),
          phase: enc.phase && r[enc.phase] != null ? String(r[enc.phase]) : null
        });
      });

      // groups: explicit order, else by first start (stable), else data order
      var groupNames = RK.util.unique(tasks.map(function (k) { return k.group; }));
      var firstStart = {};
      tasks.forEach(function (k) { if (firstStart[k.group] == null || k.s < firstStart[k.group]) firstStart[k.group] = k.s; });
      if (Array.isArray(o.groupOrder) && o.groupOrder.length) {
        var pos = function (g) { var i = o.groupOrder.indexOf(g); return i < 0 ? 1e6 + groupNames.indexOf(g) : i; };
        groupNames.sort(function (a, b) { return pos(a) - pos(b); });
      } else if (o.sort === 'start') {
        groupNames = groupNames.map(function (g, i) { return [g, i]; })
          .sort(function (a, b) { return (firstStart[a[0]] - firstStart[b[0]]) || (a[1] - b[1]); })
          .map(function (x) { return x[0]; });
      }
      var headers = o.groupHeaders !== false && enc.group && groupNames.some(function (g) { return g !== ''; });

      // y rows: [header?, tasks...] per group
      var rowsY = [], groups = [];
      groupNames.forEach(function (g, gi) {
        var list = tasks.filter(function (k) { return k.group === g; });
        if (o.sort === 'start') list.sort(function (a, b) { return (a.s - b.s) || (a.barEnd - b.barEnd) || (a.i - b.i); });
        var grp = { name: g, gi: gi, tasks: list, s: Math.min.apply(null, list.map(function (k) { return k.s; })), e: Math.max.apply(null, list.map(function (k) { return k.barEnd; })) };
        if (headers) { grp.y = rowsY.length; rowsY.push({ key: 'g' + gi, text: g, header: true, group: grp }); }
        grp.first = rowsY.length;
        list.forEach(function (k) { k.y = rowsY.length; rowsY.push({ key: 't' + k.i, text: k.label, task: k }); });
        groups.push(grp);
      });

      /* ---------- colours ---------- */
      // colours are keyed on the phases of all rows, so they do not shift when filters remove a phase
      var phases = RK.util.unique(tasks.map(function (k) { return k.phase; }).filter(function (p) { return p != null; }));
      // (the block's own 'where' still applies: a timetable restricted to some phases spreads its shades over those)
      var baseRows = ctx.allRows;
      if (o.where && ctx.dataset) {
        try { var wc = RK.expr.compile(o.where, { fields: ctx.dataset.fields }); baseRows = baseRows.filter(function (r) { return wc.eval(r, { params: RK.store.params() }); }); } catch (e) { baseRows = ctx.rows; }
      }
      var allPhases = enc.phase ? RK.util.unique(baseRows.map(function (r) { return r[enc.phase] == null ? null : String(r[enc.phase]); }).filter(function (p) { return p != null; })) : [];
      phases.forEach(function (p) { if (allPhases.indexOf(p) < 0) allPhases.push(p); });
      phases.sort(function (a, b) { return allPhases.indexOf(a) - allPhases.indexOf(b); });
      var phaseColor;
      if (o.palette === 'sequential') {
        // ordered phases: the theme's ordinal ramp (validated steps), early phases light -> late phases dark
        var ordRamp = RK.theme.ramp(t.ord.slice().reverse());
        phaseColor = function (p) { return ordRamp(allPhases.length > 1 ? allPhases.indexOf(p) / (allPhases.length - 1) : 1); };
      } else {
        var cat = RK.theme.categoricalSafe(allPhases);   // extended with tints instead of repeating
        phaseColor = function (p) { return p == null ? t.accent : cat(p); };
      }
      var selField = o.selectBy ? enc[o.selectBy] : null;
      function selValue(k) { return o.selectBy === 'group' ? k.group : o.selectBy === 'phase' ? k.phase : o.selectBy === 'label' ? k.label : (selField ? k.row[selField] : null); }
      function colorOf(k, base) { return selField ? C.dim(ctx, selField, selValue(k), base) : base; }

      /* ---------- domain & layout ---------- */
      var todayTs = o.today === 'now' ? new Date().setHours(0, 0, 0, 0) : (o.today ? ts(o.today) : null);
      var lo, hi;
      if (Array.isArray(o.domain) && o.domain.length === 2) { lo = ts(o.domain[0]); hi = ts(o.domain[1]); }
      if (lo == null || hi == null) {
        var ext = RK.util.extent(tasks.map(function (k) { return k.s; }).concat(tasks.map(function (k) { return k.barEnd; })));
        lo = monthStart(ext[0]);
        hi = addMonths(monthStart(ext[1]), 1);
        if (hi - ext[1] < 3 * DAY) hi = addMonths(hi, 1);       // keep end milestones off the edge
        if (ext[0] - lo < 2 * DAY) lo = addDays(lo, -7);
      }
      var W = inst.getWidth() || ctx.el.clientWidth || 800;
      var fontLab = '11px ' + t.fontSans, fontHead = '600 11px ' + t.fontSans;
      var labW = o.labelWidth === 'auto' || o.labelWidth == null
        ? Math.ceil(Math.max(90, Math.min(W * 0.38, Math.max.apply(null, rowsY.map(function (r) { return r.header ? C.measure(r.text, fontHead) : C.measure(r.text, fontLab) + 12; }).concat([0])))))
        : +o.labelWidth;
      var hasLegend = o.legend !== false && (phases.length > 0 || tasks.some(function (k) { return k.ms; }));
      var zoomOn = o.zoom !== false;
      var slider = zoomOn && o.zoomSlider !== false && !ctx.print;
      var gridTop = (hasLegend ? 28 : 4) + TIER * 2;
      var gridBottom = (todayTs != null ? 18 : 4) + (slider ? 28 : 0);
      var grid = { left: labW + 14, right: 16, top: gridTop, bottom: gridBottom, containLabel: false };
      S.lo = lo; S.hi = hi; S.plotW = W - grid.left - grid.right;

      /* ---------- renderers ---------- */
      var animate = ctx.motion;
      function clip(shape, cs) {
        return window.echarts.graphic.clipRectByRect(shape, { x: cs.x, y: cs.y, width: cs.width, height: cs.height });
      }
      function bandH(api) { return api.size([0, 1])[1]; }

      function renderBar(params, api) {
        var k = tasks[api.value(3)], cs = params.coordSys;
        var p0 = api.coord([k.s, k.y]), p1 = api.coord([k.barEnd, k.y]);
        var h = Math.max(4, Math.min(16, bandH(api) * 0.56));
        var shape = clip({ x: p0[0], y: p0[1] - h / 2, width: Math.max(2, p1[0] - p0[0]), height: h }, cs);
        if (!shape) return null;
        var fill = colorOf(k, phaseColor(k.phase));
        var kids = [{
          type: 'rect', shape: RK.util.merge(shape, { r: 1.5 }), style: { fill: fill },
          originX: shape.x, originY: shape.y + h / 2,
          enterFrom: animate ? { scaleX: 0, style: { opacity: 0.4 } } : undefined,
          enterAnimation: animate ? { delay: 120 + k.y * 22, duration: 640, easing: 'cubicOut' } : undefined
        }];
        var lab = o.barLabel === 'duration' ? durText(k, true) : (o.barLabel && k.row[o.barLabel] != null ? String(k.row[o.barLabel]) : null);
        if (lab) {
          var tw = C.measure(lab, '11px ' + t.fontSans), right = cs.x + cs.width;
          var after = shape.x + shape.width + 5;
          var x = after + tw <= right ? after : shape.x - 5;
          if (x >= cs.x && (x === after || x - tw >= cs.x)) {
            kids.push({ type: 'text', x: x, y: p0[1], silent: true,
              // paper halo: the today line and gridlines stop at the text
              style: { text: lab, fill: t.ink3, font: '11px ' + t.fontSans, align: x === after ? 'left' : 'right', verticalAlign: 'middle', stroke: t.paper, lineWidth: 3, opacity: selField && fill !== phaseColor(k.phase) ? 0.4 : 1 },
              enterFrom: animate ? { style: { opacity: 0 } } : undefined,
              enterAnimation: animate ? { delay: 520 + k.y * 22, duration: 400 } : undefined });
          }
        }
        return { type: 'group', children: kids };
      }

      function renderMilestone(params, api) {
        var k = tasks[api.value(3)], cs = params.coordSys;
        var p = api.coord([k.s, k.y]);
        var r = Math.max(4, Math.min(7, bandH(api) * 0.36));
        if (p[0] < cs.x - r || p[0] > cs.x + cs.width + r) return null;
        var fill = colorOf(k, t.ink);
        var kids = [{
          type: 'polygon', shape: { points: [[p[0], p[1] - r], [p[0] + r, p[1]], [p[0], p[1] + r], [p[0] - r, p[1]]] },
          style: { fill: fill, stroke: t.paper, lineWidth: 1 },
          originX: p[0], originY: p[1],
          enterFrom: animate ? { scaleX: 0, scaleY: 0 } : undefined,
          enterAnimation: animate ? { delay: 520 + k.y * 22, duration: 420, easing: 'backOut' } : undefined
        }];
        // 'label' would repeat the row label right beside it (every milestone has its own labelled row): the
        // name is only drawn when the row label column is hidden (labelWidth 0), otherwise the date
        var named = o.milestoneLabel === 'label' && labW <= 0;
        var text = named ? k.label : (o.milestoneLabel === 'date' || o.milestoneLabel === 'label') ? RK.format(new Date(k.s), tr('gantt.fmtDay', 'd mmm')) : null;
        if (text && p[0] + r + 4 < cs.x + cs.width) {
          kids.push({ type: 'text', x: p[0] + r + 4, y: p[1], silent: true,
            style: { text: text, fill: fill === t.ink ? t.ink2 : fill, font: (named ? '500 ' : '600 ') + '11px ' + t.fontSans, verticalAlign: 'middle', stroke: t.paper, lineWidth: 3 },
            enterFrom: animate ? { style: { opacity: 0 } } : undefined,
            enterAnimation: animate ? { delay: 640 + k.y * 22, duration: 400 } : undefined });
        }
        return { type: 'group', children: kids };
      }

      // workstream header rows: band behind label + plot, top rule, summary bracket
      function renderBand(params, api) {
        var g = groups[api.value(3)], cs = params.coordSys;
        var bh = bandH(api), yc = api.coord([g.s, g.y != null ? g.y : g.first])[1];
        var top = yc - bh / 2, kids = [];
        if (headers) {
          kids.push({ type: 'rect', silent: true, shape: { x: 0, y: top, width: cs.x + cs.width, height: bh }, style: { fill: t.surface } });
          if (g.gi > 0) kids.push({ type: 'line', silent: true, shape: { x1: 0, y1: top, x2: cs.x + cs.width, y2: top }, style: { stroke: t.rule, lineWidth: 1 } });
          if (o.summary !== false) {
            var x0 = api.coord([g.s, g.y])[0], x1 = api.coord([g.e, g.y])[0];
            var cx0 = Math.max(x0, cs.x), cx1 = Math.min(x1, cs.x + cs.width);
            if (cx1 > cx0) {
              var col = selField === enc.group ? C.dim(ctx, enc.group, g.name, t.ink3) : t.ink3;
              var y = yc + 1, tick = Math.min(5, bh * 0.3);
              kids.push({ type: 'polyline', shape: { points: x0 >= cs.x ? [[cx0, y + tick], [cx0, y], [cx1, y]] : [[cx0, y], [cx1, y]] }, style: { stroke: col, lineWidth: 1.5, fill: null },
                enterFrom: animate ? { style: { opacity: 0 } } : undefined, enterAnimation: animate ? { delay: 80, duration: 500 } : undefined });
              if (x1 <= cs.x + cs.width) kids.push({ type: 'line', shape: { x1: cx1, y1: y, x2: cx1, y2: y + tick }, style: { stroke: col, lineWidth: 1.5 },
                enterFrom: animate ? { style: { opacity: 0 } } : undefined, enterAnimation: animate ? { delay: 80, duration: 500 } : undefined });
            }
          }
        } else if (g.gi > 0) {
          kids.push({ type: 'line', silent: true, shape: { x1: 0, y1: top, x2: cs.x + cs.width, y2: top }, style: { stroke: t.rule, lineWidth: 1 } });
        }
        return { type: 'group', children: kids };
      }

      // calendar header cells + gridlines into the plot
      function renderCal(params, api) {
        var p = S.periods && S.periods[api.value(3)], cs = params.coordSys;
        if (!p) return null;
        var x0 = api.coord([p.s, 0])[0], x1 = api.coord([p.e, 0])[0];
        var cx0 = Math.max(x0, cs.x), cx1 = Math.min(x1, cs.x + cs.width);
        if (cx1 - cx0 < 1) return null;
        var yTop = cs.y - (2 - p.tier) * TIER, kids = [];
        var inside = x0 > cs.x + 0.5 && x0 < cs.x + cs.width - 0.5;
        if (inside) {
          kids.push({ type: 'line', silent: true, shape: { x1: x0, y1: yTop + (p.tier ? 5 : 3), x2: x0, y2: p.tier ? cs.y - 3 : cs.y - TIER }, style: { stroke: p.tier ? t.grid : t.rule, lineWidth: 1 } });
          if (p.grid) kids.push({ type: 'line', silent: true, shape: { x1: x0, y1: cs.y, x2: x0, y2: cs.y + cs.height }, style: { stroke: t.grid, lineWidth: 1 } });
        }
        // (the today caret sits below the lower tier's text, so no label is ever dropped or pushed for it)
        var font = p.tier ? '11px ' + t.fontNum : '600 11px ' + t.fontSans;
        var tw = p.text ? C.measure(p.text, font) : 0, tx = (cx0 + cx1) / 2;
        if (p.text && tw + 6 <= cx1 - cx0 && tx - tw / 2 >= cx0 - 1 && tx + tw / 2 <= cx1 + 1) {
          kids.push({ type: 'text', silent: true, x: tx, y: yTop + TIER / 2 + 1,
            style: { text: p.text, fill: p.tier ? t.ink3 : t.ink2, font: font, align: 'center', verticalAlign: 'middle' } });
        }
        return { type: 'group', children: kids };
      }

      // elapsed period left of "today" (drawn under the bars)
      function renderPast(params, api) {
        var cs = params.coordSys, x = api.coord([todayTs, 0])[0];
        var w = Math.min(x, cs.x + cs.width) - cs.x;
        if (w <= 0) return null;
        return { type: 'rect', silent: true, shape: { x: cs.x, y: cs.y, width: w, height: cs.height }, style: { fill: RK.theme.alpha(t.ink3, t.dark ? 0.1 : 0.055) } };
      }

      // today: dashed reference line (t.ref) + marker on the header edge + label below the plot (drawn over the bars)
      function renderToday(params, api) {
        var cs = params.coordSys, x = api.coord([todayTs, 0])[0];
        if (x < cs.x || x > cs.x + cs.width) return null;
        var label = (o.todayLabel === 'Today' ? tr('gantt.today', 'Today') : o.todayLabel) + ' ' + RK.format(new Date(todayTs), tr('gantt.fmtDay', 'd mmm')), font = '600 11px ' + t.fontSans;
        var half = C.measure(label, font) / 2, lx = Math.max(cs.x + half, Math.min(cs.x + cs.width + 12 - half, x));   // keep the label inside the chart
        return { type: 'group', children: [
          { type: 'line', silent: true, shape: { x1: x, y1: cs.y, x2: x, y2: cs.y + cs.height + 3 }, style: { stroke: t.ref, lineWidth: 1.25, lineDash: [4, 3] } },
          { type: 'polygon', silent: true, shape: { points: [[x - 3.5, cs.y - 2], [x + 3.5, cs.y - 2], [x, cs.y + 2.5]] }, style: { fill: t.ref } },
          { type: 'text', silent: true, x: lx, y: cs.y + cs.height + 5,
            style: { text: label, fill: t.ref, font: font, align: 'center', verticalAlign: 'top' } }
        ] };
      }

      /* ---------- series ---------- */
      var series = [];
      series.push({ id: 'bands', type: 'custom', silent: true, z: -1, renderItem: renderBand, tooltip: { show: false },
        encode: { x: [0, 1], y: 2 }, data: groups.map(function (g) { return [g.s, g.e, g.y != null ? g.y : g.first, g.gi]; }), animation: animate });
      series.push({ id: 'cal', type: 'custom', silent: true, z: 0, renderItem: renderCal, tooltip: { show: false },
        encode: { x: [0, 1], y: 2 }, data: calendarData(inst, S, o), animation: false });
      if (todayTs != null) {
        if (o.shadePast !== false) {
          series.push({ id: 'past', type: 'custom', silent: true, z: 0, renderItem: renderPast, tooltip: { show: false },
            encode: { x: 0, y: 1 }, data: [[todayTs, 0]], animation: false });
        }
        // under the bars / milestones (z 3-4): their labels carry a paper halo, so the line never cuts through text
        series.push({ id: 'today', type: 'custom', silent: true, z: 2, renderItem: renderToday, tooltip: { show: false },
          encode: { x: 0, y: 1 }, data: [[todayTs, 0]], animation: false });
      }
      phases.concat(tasks.some(function (k) { return !k.ms && k.phase == null; }) ? [null] : []).forEach(function (ph, pi) {
        var list = tasks.filter(function (k) { return !k.ms && k.phase === ph; });
        if (!list.length) return;
        series.push({
          id: 'ph-' + pi, name: ph == null ? tr('gantt.task', 'Task') : ph, type: 'custom', z: 3,
          itemStyle: { color: phaseColor(ph) },
          renderItem: renderBar, encode: { x: [0, 1], y: 2, tooltip: [] },
          data: list.map(function (k) { return [k.s, k.barEnd, k.y, tasks.indexOf(k)]; })
        });
      });
      var msList = tasks.filter(function (k) { return k.ms; });
      if (msList.length) {
        series.push({
          id: 'ms', name: msName(o), type: 'custom', z: 4, itemStyle: { color: t.ink },
          renderItem: renderMilestone, encode: { x: 0, y: 2, tooltip: [] },
          data: msList.map(function (k) { return [k.s, k.s, k.y, tasks.indexOf(k)]; })
        });
      }

      /* ---------- tooltip ---------- */
      function durText(k, short) {
        var days = Math.round((k.barEnd - k.s) / DAY);
        if (short) return days >= 14 ? tr('gantt.weeksShort', '{n}w', { n: RK.format(days / 7, '0.#') }) : tr('gantt.daysShort', '{n}d', { n: days });
        return tr(days === 1 ? 'gantt.day' : 'gantt.days', days === 1 ? '{n} day' : '{n} days', { n: days }) + (days >= 7 ? ' ' + tr('gantt.weeks', '({n} weeks)', { n: RK.format(days / 7, '0.0') }) : '');
      }
      function tip(p) {
        var k = tasks[p.value[3]];
        if (!k) return '';
        var rows = [];
        if (enc.group && k.group) rows.push({ label: ctx.title(enc.group), value: k.group });
        if (k.phase != null) rows.push({ color: phaseColor(k.phase), label: ctx.title(enc.phase), value: k.phase });
        if (k.ms) rows.push({ label: tr('gantt.date', 'Date'), value: RK.format(new Date(k.s), dfmt), bold: true });
        else {
          rows.push({ label: ctx.title(enc.start), value: RK.format(new Date(k.s), dfmt) });
          rows.push({ label: ctx.title(enc.end), value: RK.format(new Date(k.e), dfmt) });
          rows.push({ label: tr('gantt.duration', 'Duration'), value: durText(k), bold: true });
        }
        if (enc.owner && k.row[enc.owner] != null) rows.push({ label: ctx.title(enc.owner), value: String(k.row[enc.owner]) });
        var foot = k.ms ? msName(o) : (todayTs != null ? (k.barEnd <= todayTs ? tr('gantt.completed', 'Completed') : k.s > todayTs ? tr('gantt.startsIn', 'Starts in {n} days', { n: Math.ceil((k.s - todayTs) / DAY) })
          : tr('gantt.inProgress', 'In progress — {pct} of time elapsed', { pct: RK.format((todayTs - k.s) / (k.barEnd - k.s), '0%') })) : null);
        return C.tip(k.label, rows, foot);
      }

      /* ---------- axes ---------- */
      var rowIndex = {};
      rowsY.forEach(function (r) { rowIndex[r.key] = r; });
      ctx.__gantt = { tasks: tasks, rowIndex: rowIndex, selField: selField, selValue: selValue };   // read by the select hook
      var yAxis = {
        type: 'category', inverse: true, data: rowsY.map(function (r) { return r.key; }),
        triggerEvent: true,
        axisLine: { show: true, lineStyle: { color: t.rule } }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: {
          interval: 0, align: 'left', margin: labW + 6, width: labW, overflow: 'truncate', ellipsis: '…',
          formatter: function (key) {
            var r = rowIndex[key];
            if (!r) return key;
            var txt = C.richSafe(r.text);   // braces in data would open / close rich-text runs
            if (r.header) return '{g|' + txt + '}';
            return '{' + (r.task && r.task.ms ? 'm' : 't') + '|' + txt + '}';
          },
          rich: {
            g: { fontFamily: t.fontSans, fontSize: 11, fontWeight: 600, color: t.ink },
            t: { fontFamily: t.fontSans, fontSize: 11, color: t.ink2, padding: [0, 0, 0, headers ? 12 : 0] },
            m: { fontFamily: t.fontSans, fontSize: 11, color: t.ink, padding: [0, 0, 0, headers ? 12 : 0] }
          }
        }
      };

      // RK.chart keeps the user's zoom window across filter updates and resizes (keepZoom)
      var dataZoom = zoomOn ? C.zoom(ctx, 'x', { bottom: 4, labelFormatter: function (v) { return RK.format(new Date(v), tr('gantt.fmtDateShort', 'd mmm yy')); } }) : [];

      return {
        animation: !!ctx.motion,
        legend: C.legend(ctx, {
          show: hasLegend,
          data: series.filter(function (s) { return s.name; }).map(function (s) { return s.id === 'ms' ? { name: s.name, icon: 'diamond' } : { name: s.name }; })
        }),
        grid: grid,
        tooltip: { trigger: 'item', confine: true, formatter: tip },
        xAxis: { type: 'time', position: 'top', min: lo, max: hi, axisLine: { show: true, lineStyle: { color: t.rule } }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
        yAxis: yAxis,
        dataZoom: dataZoom,
        series: series
      };
    }, {
      select: function (p, ctx) {
        var G = ctx.__gantt;
        if (!G || !G.selField) return null;
        if (p.componentType === 'yAxis') {
          // clicking a row label: a header toggles its workstream, a task toggles its own value
          var r = G.rowIndex[p.value];
          if (!r) return null;
          if (r.header) return ctx.options.selectBy === 'group' ? { field: G.selField, value: r.group.name } : null;
          return { field: G.selField, value: G.selValue(r.task) };
        }
        if (p.componentType !== 'series' || !Array.isArray(p.value)) return null;
        var k = G.tasks[p.value[3]];
        return k ? { field: G.selField, value: G.selValue(k) } : null;
      },
      rebuildOnResize: true,     // label column, calendar tiers and bar geometry depend on the width
      init: passWheel,
      on: {
        datazoom: function (params, ctx, inst) {
          var S = inst.__rkGantt;
          if (!S) return;
          if (S._raf) cancelAnimationFrame(S._raf);
          S._raf = requestAnimationFrame(function () {
            S._raf = null;
            inst.setOption({ series: [{ id: 'cal', data: calendarData(inst, S, ctx.options) }] });
          });
        }
      }
    })
  });
})();
