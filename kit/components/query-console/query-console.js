/*!
 * RK component: query-console — the client self-service analysis console.
 *
 *   Builder tab  pivot-style form (Values = aggregation x field, Rows = group-by fields, Filter,
 *                Sort, Top N) that writes RK.query text and runs it as you change it.
 *   Query tab    editor for the RK.query grammar
 *                  <items> [from ds] [by fields] [where expr] [sort col desc] [top n]
 *                  items := expr [as "Label"] [format "0.0x"], ...
 *                with syntax highlighting, debounced live validation (message + line / column + wavy
 *                underline at the error), autocomplete (fields, functions, keywords, @params,
 *                datasets), Ctrl/Cmd+Enter to run, clickable examples.
 *   Reference    fields (title, name, type, format), @parameters, functions and syntax — click to
 *                insert at the caret.
 *   Results      formatted table (column formats, sortable headers, target highlight) + an automatic
 *                ECharts chart in a split view (bar for one category column, line when the category
 *                looks like a year / date, dual axis for mixed units, KPI read-out for a single row),
 *                CSV export, "Add as metric" (Dataset.addComputed) for row-level formulas, history
 *                (localStorage, guarded). Results respect the global filters and re-run when they change.
 */
(function () {
  'use strict';
  var h = RK.util.h, isNum = RK.util.isNum;
  var memo = {};                                   // blockId -> UI state (survives theme re-render)
  var HKEY = 'rk:query-console:history';
  var MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);

  // builder aggregations (in picker order); labels via aggLabel() so they follow the report language
  var AGGS = ['none', 'sum', 'avg', 'median', 'min', 'max', 'count', 'countd', 'stdev'];
  // English names of every aggregate (aliases share one translation key, AGG_KEY)
  var AGG_LABEL = {
    none: 'Value', sum: 'Sum', avg: 'Average', median: 'Median', min: 'Min', max: 'Max', count: 'Count', countd: 'Distinct count',
    stdev: 'Std. dev.', average: 'Average', mean: 'Average', stddev: 'Std. dev.', first: 'First', last: 'Last', pctl: 'Percentile',
    percentile: 'Percentile', wavg: 'Weighted avg.'
  };
  var AGG_KEY = { average: 'avg', mean: 'avg', stddev: 'stdev', percentile: 'pctl' };

  var FN_DOC = {
    sum: 'sum(x) — total', avg: 'avg(x) — mean', average: 'average(x) — mean', mean: 'mean(x) — mean', median: 'median(x)',
    min: 'min(x) — smallest (or min(a, b) per row)', max: 'max(x) — largest (or max(a, b) per row)',
    count: 'count() rows, count(x) non-empty', countd: 'countd(x) — distinct values', stdev: 'stdev(x) — sample std. dev.', stddev: 'stddev(x)',
    first: 'first(x) — first non-empty', last: 'last(x) — last non-empty', pctl: 'pctl(x, 0.75) — percentile', percentile: 'percentile(x, 0.25)',
    wavg: 'wavg(x, weight) — weighted average',
    abs: 'abs(x)', round: 'round(x, 1)', floor: 'floor(x)', ceil: 'ceil(x)', sqrt: 'sqrt(x)', pow: 'pow(x, y)', exp: 'exp(x)', ln: 'ln(x)',
    log: 'log(x [, base])', log10: 'log10(x)', sign: 'sign(x)', clamp: 'clamp(x, lo, hi)', div: 'div(a, b) — null-safe divide',
    pct_change: 'pct_change(new, old) — growth', cagr: 'cagr(end, start, years)', coalesce: 'coalesce(a, b, …) — first non-empty',
    isnull: 'isnull(x)', between: 'between(x, lo, hi)', number: 'number(x)', text: 'text(x, "0.0x") — formatted text',
    len: 'len(s)', lower: 'lower(s)', upper: 'upper(s)', concat: 'concat(a, b, …)', contains: 'contains(s, "sub")',
    startswith: 'startswith(s, "p")', endswith: 'endswith(s, "p")', year: 'year(date)', month: 'month(date)', quarter: 'quarter(date)',
    if: 'if(condition, then, else)'
  };
  var CLAUSE_KW = { select: 1, show: 1, from: 1, by: 1, group: 1, order: 1, where: 1, sort: 1, top: 1, limit: 1, as: 1, format: 1, asc: 1, desc: 1 };
  var LOGIC_KW = { and: 1, or: 1, not: 1, in: 1, true: 1, false: 1, null: 1 };
  var AC_KEYWORDS = ['from', 'by', 'where', 'sort', 'top', 'as', 'format', 'desc', 'asc', 'and', 'or', 'not', 'in'];

  var ICONS = {
    play: '<path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
    book: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17.2v.1"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    metric: '<path d="M17 5H7l6 7-6 7h10"/>',
    caret: '<path d="m7 10 5 5 5-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>'
  };
  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 14) + '" height="' + (size || 14) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  /** UI string via RK.i18n when present ({name} placeholders filled from vars); English fallback otherwise. */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    RK.i18n.add('zh-CN', {
      'queryConsole.metricsHint': '用“添加为指标”保存的公式会显示在这里，并在本浏览器中为本报告保留',
      'queryConsole.metricInactive': '无法在当前数据中计算（字段缺失）',
      'queryConsole.metricIn': '{dataset} 中',
      'queryConsole.metricAddedLong': '已将“{title}”添加为 {dataset} 的字段 {name} — 使用该数据集的所有图表均可使用，并保存在本浏览器中',
      'queryConsole.addFormula': '将公式添加为数据集字段',
      'queryConsole.liveNote': '实时重算（含 @参数）· 保存在本浏览器',
      'queryConsole.addTo': '添加到 {dataset}',
      'queryConsole.title': '标题',
      'queryConsole.fieldName': '字段名',
      'queryConsole.format': '格式',
      'queryConsole.badName': '字段名须以字母开头，只能包含字母、数字或 _',
      'queryConsole.sourceField': '“{name}”已是 {dataset} 的源字段',
      'queryConsole.saveFormula': '将公式列保存为 {dataset} 的新字段',
      'queryConsole.filterRef': '筛选字段和函数…',
      'queryConsole.refTip': '点击条目插入到光标处',
      'queryConsole.fields': '字段',
      'queryConsole.parameters': '参数',
      'queryConsole.aggFns': '聚合函数',
      'queryConsole.rowFns': '行函数',
      'queryConsole.syntax': '语法',
      'queryConsole.refTitle': '字段与函数',
      'queryConsole.groupBy': '分组',
      'queryConsole.addColumn': '添加列',
      'queryConsole.values': '数值',
      'queryConsole.filter': '筛选',
      'queryConsole.sort': '排序',
      'queryConsole.top': '前',
      'queryConsole.clearHistory': '清除历史记录',
      'queryConsole.split': '分栏',
      'queryConsole.table': '表格',
      'queryConsole.chart': '图表',
      // aggregations ("{agg} {field}" reads "{field}{agg}" in Chinese: EV/EBITDA 2026E中位数)
      'queryConsole.agg.none': '原值', 'queryConsole.agg.sum': '合计', 'queryConsole.agg.avg': '平均值', 'queryConsole.agg.median': '中位数',
      'queryConsole.agg.min': '最小值', 'queryConsole.agg.max': '最大值', 'queryConsole.agg.count': '计数', 'queryConsole.agg.countd': '不重复计数',
      'queryConsole.agg.stdev': '标准差', 'queryConsole.agg.first': '首个值', 'queryConsole.agg.last': '末个值', 'queryConsole.agg.pctl': '百分位数',
      'queryConsole.agg.wavg': '加权平均值', 'queryConsole.aggOf': '{field}{agg}', 'queryConsole.noAgg': '不汇总 — 每条记录一行',
      // head, pickers, builder
      'queryConsole.mode': '控制台模式', 'queryConsole.history': '查询历史', 'queryConsole.chooseDs': '选择数据集',
      'queryConsole.chooseDsStart': '请先选择数据集。', 'queryConsole.options': '选项', 'queryConsole.searchPh': '搜索…',
      'queryConsole.noMatches': '无匹配项', 'queryConsole.datasets': '数据集', 'queryConsole.searchDs': '搜索数据集…',
      'queryConsole.searchFields': '搜索字段…', 'queryConsole.numbers': '数值', 'queryConsole.textDates': '文本与日期',
      'queryConsole.aggregation': '汇总方式', 'queryConsole.of': '·', 'queryConsole.removeValue': '移除数值',
      'queryConsole.addValue': '添加数值', 'queryConsole.removeX': '移除{name}', 'queryConsole.filterExpr': '筛选表达式',
      'queryConsole.eg': '例如：{example}', 'queryConsole.aggInWhere': '行筛选中不能使用聚合函数', 'queryConsole.validFilter': '筛选表达式有效',
      'queryConsole.noSort': '不排序', 'queryConsole.sortBy': '排序依据', 'queryConsole.highLow': '从高到低', 'queryConsole.lowHigh': '从低到高',
      'queryConsole.topN': '前 N 行', 'queryConsole.editAsQuery': '以查询语句编辑',
      // status line
      'queryConsole.idle': '输入查询语句、点选示例，或使用参考面板 →', 'queryConsole.lnCol': '第 {line} 行，第 {col} 列',
      'queryConsole.nRows': '{n} 行', 'queryConsole.nRows.one': '{n} 行', 'queryConsole.nCols': '{n} 列', 'queryConsole.nCols.one': '{n} 列',
      'queryConsole.valid': '有效 — {rows} × {cols}{by}', 'queryConsole.groupedBy': ' · 按 {list} 分组', 'queryConsole.summaryRow': ' · 汇总',
      'queryConsole.toRun': '按 {key} + Enter 运行', 'queryConsole.builderIdle': '构建器会自动生成查询语句 — 修改后结果即时更新',
      'queryConsole.builderOk': '{rows} — 结果随编辑即时更新', 'queryConsole.runSaves': '点击“运行”保存到历史记录',
      'queryConsole.ran': '已运行 — {rows}，用时 {ms} 毫秒',
      'queryConsole.unknownDs': '未知数据集“{id}” — 可用数据集：{list}',
      'queryConsole.whereAgg': 'where 用于筛选行 — 其中不能使用 sum()、median() 等聚合函数',
      'queryConsole.unknownField': '未知字段“{name}”', 'queryConsole.didYouMean': ' — 是否指 {list}？', 'queryConsole.seeFields': ' — 请查看字段列表',
      'queryConsole.keyword': '关键字', 'queryConsole.items': '输出列', 'queryConsole.label': '标签',
      // history
      'queryConsole.histEmpty': '运行过的查询会显示在这里。', 'queryConsole.nRecent': '最近 {n} 条查询', 'queryConsole.nRecent.one': '最近 {n} 条查询',
      'queryConsole.justNow': '刚刚', 'queryConsole.minAgo': '{n} 分钟前', 'queryConsole.hAgo': '{n} 小时前', 'queryConsole.dAgo': '{n} 天前',
      // results
      'queryConsole.rowsUnit': '行', 'queryConsole.rowsUnit.one': '行', 'queryConsole.ms': '{n} 毫秒',
      'queryConsole.respects': '结果已应用报告筛选：{list}', 'queryConsole.nFilters': '{n} 个全局筛选', 'queryConsole.nFilters.one': '{n} 个全局筛选',
      'queryConsole.resultView': '结果视图', 'queryConsole.csvTitle': '将全部结果行下载为 CSV',
      'queryConsole.noRows': '没有匹配的行 — 请检查 where 条件或报告筛选。', 'queryConsole.showingFirst': '显示前 {max} 行，共 {n} 行 — CSV 导出全部行。',
      'queryConsole.nothingToChart': '没有可绘制的数据', 'queryConsole.noNumeric': '没有可绘制的数值列',
      'queryConsole.addLabel': '添加一个标签列（例如 {name}）即可绘制这些数值', 'queryConsole.estimate': '预测',
      'queryConsole.notCharted': '{n} 列未绘制（单位不同）', 'queryConsole.notCharted.one': '{n} 列未绘制（单位不同）',
      'queryConsole.preview': '预览：{list}',
      // function reference (descriptions after the signature)
      'queryConsole.fn.sum': 'sum(x) — 合计', 'queryConsole.fn.avg': 'avg(x) — 平均值', 'queryConsole.fn.average': 'average(x) — 平均值',
      'queryConsole.fn.mean': 'mean(x) — 平均值', 'queryConsole.fn.median': 'median(x) — 中位数',
      'queryConsole.fn.min': 'min(x) — 最小值（或逐行 min(a, b)）', 'queryConsole.fn.max': 'max(x) — 最大值（或逐行 max(a, b)）',
      'queryConsole.fn.count': 'count() 行数，count(x) 非空值个数', 'queryConsole.fn.countd': 'countd(x) — 不重复值个数',
      'queryConsole.fn.stdev': 'stdev(x) — 样本标准差', 'queryConsole.fn.stddev': 'stddev(x) — 样本标准差',
      'queryConsole.fn.first': 'first(x) — 第一个非空值', 'queryConsole.fn.last': 'last(x) — 最后一个非空值',
      'queryConsole.fn.pctl': 'pctl(x, 0.75) — 百分位数', 'queryConsole.fn.percentile': 'percentile(x, 0.25) — 百分位数',
      'queryConsole.fn.wavg': 'wavg(x, weight) — 加权平均值', 'queryConsole.fn.abs': 'abs(x) — 绝对值', 'queryConsole.fn.round': 'round(x, 1) — 四舍五入',
      'queryConsole.fn.floor': 'floor(x) — 向下取整', 'queryConsole.fn.ceil': 'ceil(x) — 向上取整', 'queryConsole.fn.sqrt': 'sqrt(x) — 平方根',
      'queryConsole.fn.pow': 'pow(x, y) — 乘方', 'queryConsole.fn.exp': 'exp(x) — e 的 x 次方', 'queryConsole.fn.ln': 'ln(x) — 自然对数',
      'queryConsole.fn.log': 'log(x [, base]) — 对数', 'queryConsole.fn.log10': 'log10(x) — 以 10 为底的对数', 'queryConsole.fn.sign': 'sign(x) — 正负号',
      'queryConsole.fn.clamp': 'clamp(x, lo, hi) — 限定在区间内', 'queryConsole.fn.div': 'div(a, b) — 安全除法（除数为零时为空）',
      'queryConsole.fn.pct_change': 'pct_change(new, old) — 增长率', 'queryConsole.fn.cagr': 'cagr(end, start, years) — 复合年增长率',
      'queryConsole.fn.coalesce': 'coalesce(a, b, …) — 第一个非空值', 'queryConsole.fn.isnull': 'isnull(x) — 是否为空',
      'queryConsole.fn.between': 'between(x, lo, hi) — 是否在区间内', 'queryConsole.fn.number': 'number(x) — 转为数字',
      'queryConsole.fn.text': 'text(x, "0.0x") — 格式化为文本', 'queryConsole.fn.len': 'len(s) — 文本长度', 'queryConsole.fn.lower': 'lower(s) — 转为小写',
      'queryConsole.fn.upper': 'upper(s) — 转为大写', 'queryConsole.fn.concat': 'concat(a, b, …) — 连接文本',
      'queryConsole.fn.contains': 'contains(s, "sub") — 是否包含', 'queryConsole.fn.startswith': 'startswith(s, "p") — 是否以 p 开头',
      'queryConsole.fn.endswith': 'endswith(s, "p") — 是否以 p 结尾', 'queryConsole.fn.year': 'year(date) — 年份', 'queryConsole.fn.month': 'month(date) — 月份',
      'queryConsole.fn.quarter': 'quarter(date) — 季度', 'queryConsole.fn.if': 'if(condition, then, else) — 条件取值'
    });
  }
  /** Aggregation name in the report language ('median' -> "Median" / 中位数); null for anything else. */
  function aggLabel(id) {
    id = String(id || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(AGG_LABEL, id)) return null;
    return tr('queryConsole.agg.' + (AGG_KEY[id] || id), AGG_LABEL[id]);
  }
  /** Aggregate column title: "Median EV/EBITDA 2025E" (zh: "EV/EBITDA 2025E中位数"). */
  function aggTitle(id, fieldTitle) { return tr('queryConsole.aggOf', '{agg} {field}', { agg: aggLabel(id) || id, field: fieldTitle }); }
  /** Function reference line ("median(x) — …") in the report language. */
  function fnDoc(name) { return Object.prototype.hasOwnProperty.call(FN_DOC, name) ? tr('queryConsole.fn.' + name, FN_DOC[name]) : ''; }
  /** "{n} rows" / "1 row" (keys key and key.one) with the count formatted. */
  function countText(key, n, one, many) { return tr(n === 1 ? key + '.one' : key, n === 1 ? one : many, { n: RK.format(n, '#,##0') }); }

  function norm(s) { return String(s).toLowerCase().replace(/[\s_]+/g, ' ').trim(); }
  function quoteName(n) {
    var low = String(n).toLowerCase();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !CLAUSE_KW[low] && !LOGIC_KW[low] ? n : '`' + n + '`';
  }
  function slug(s) {
    var out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return /^\d/.test(out) ? 'm_' + out : (out || 'metric');
  }
  function lineCol(text, pos) { var pre = text.slice(0, pos).split('\n'); return { line: pre.length, col: pre[pre.length - 1].length + 1 }; }
  function typeTag(t) { return t === 'number' ? '#' : t === 'date' ? 'dt' : t === 'boolean' ? 'y/n' : 'abc'; }
  /** Hue (0-360) and saturation (0-1) of a colour. */
  function hueSat(c) {
    var x = RK.theme.parseColor(c), r = x[0] / 255, g = x[1] / 255, b = x[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2, hh = 0;
    if (d) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hh * 60, d ? d / (1 - Math.abs(2 * l - 1)) : 0];
  }
  /**
   * Series colours: categorical, clear of accent-2 (the highlighted target) and of anything that reads as the
   * pos / neg change colours (hue within 40 degrees of either, or a saturated green / red), so a series never
   * looks like "good" or "bad".
   */
  function seriesPalette(n) {
    var t = RK.theme.tokens(), sem = [hueSat(t.pos)[0], hueSat(t.neg)[0]];
    function semantic(c) {
      var hs = hueSat(c);
      if (hs[1] < 0.22) return false;
      var near = sem.some(function (x) { var dd = Math.abs(hs[0] - x) % 360; return Math.min(dd, 360 - dd) < 40; });
      return near || (hs[0] >= 80 && hs[0] <= 170) || hs[0] >= 345 || hs[0] <= 12;
    }
    var base = t.cat.filter(function (c) {
      return !semantic(c) && [t.accent2, t.pos, t.neg].every(function (e) { return RK.theme.distance(c, e) >= 90; });
    });
    if (!base.length) return RK.theme.palette({ n: n, exclude: [t.accent2, t.pos, t.neg] });
    var out = base.slice(0, n), k = 0;
    while (out.length < n) { var src = base[k % base.length]; out.push(RK.theme.mix(src, t.paper, 0.4 + 0.15 * Math.floor(k / base.length))); k++; }
    return out;
  }
  function isTimeLike(v) {
    if (typeof v === 'number') return v >= 1900 && v <= 2100 && Math.round(v) === v;
    return typeof v === 'string' && /^(\d{4}[AEFPB]?|\d{4}-\d{2}(-\d{2})?|[QH][1-4][ -]?'?\d{2,4}|\d{4}[ -]?[QH][1-4]|FY\d{2,4}[AE]?)$/i.test(v.trim());
  }
  function fmtKind(f) { f = String(RK.format.presets[f] || f || ''); return /%/.test(f) ? 'pct' : /x"?\s*$/.test(f) ? 'mult' : 'num'; }
  function relTime(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    return s < 60 ? tr('queryConsole.justNow', 'just now') : s < 3600 ? tr('queryConsole.minAgo', '{n} min ago', { n: Math.round(s / 60) })
      : s < 86400 ? tr('queryConsole.hAgo', '{n} h ago', { n: Math.round(s / 3600) }) : tr('queryConsole.dAgo', '{n} d ago', { n: Math.round(s / 86400) });
  }
  /**
   * History store, scoped to this report: every file:// page shares one storage origin in Chromium, so an
   * unscoped key would show one client's queries in another client's report. Under file:// history lives in
   * sessionStorage (this tab only); the key carries a hash of the report path + title either way.
   */
  function historyKey() {
    var man = (RK.data && RK.data.manifest) || {}, title = (man.report && man.report.title) || '';
    // RK.data.reportKey(): title + date + build stamp, so two builds of the same report do not mix histories either
    if (RK.data && typeof RK.data.reportKey === 'function') { try { title = RK.data.reportKey(); } catch (e) { /* keep the title */ } }
    var src = String(location.pathname || '') + '|' + title, hsh = 5381;
    for (var i = 0; i < src.length; i++) hsh = ((hsh << 5) + hsh + src.charCodeAt(i)) | 0;
    return HKEY + ':' + (hsh >>> 0).toString(36);
  }
  var legacyCleared = false;
  function historyStore() {
    try {
      // drop the old unscoped key (shared by every report on this machine)
      if (!legacyCleared) { legacyCleared = true; window.localStorage.removeItem(HKEY); }
    } catch (e) { /* storage unavailable */ }
    try { return location.protocol === 'file:' ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function loadHistory() {
    try {
      var v = JSON.parse(historyStore().getItem(historyKey()) || '[]');
      // query text + dataset id + time only (never result values)
      return Array.isArray(v) ? v.filter(function (x) { return x && typeof x.q === 'string'; }).map(function (x) { return { q: x.q, ds: typeof x.ds === 'string' ? x.ds : null, t: +x.t || 0 }; }) : [];
    } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { historyStore().setItem(historyKey(), JSON.stringify(list)); } catch (e) { /* storage unavailable (private mode) */ }
  }

  function editDistance(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /** Better "did you mean" for unknown fields: prefix, then substring, then small edit distance. */
  function suggest(name, ds) {
    var n = norm(name);
    var scored = ds.fields.map(function (f) {
      var a = norm(f.name), b = norm(f.title || '');
      if (a.indexOf(n) === 0 || b.indexOf(n) === 0) return [f.name, 0];
      if (a.indexOf(n) >= 0 || b.indexOf(n) >= 0) return [f.name, 1];
      var d = Math.min(editDistance(n, a), editDistance(n, b));
      return [f.name, d <= Math.max(2, Math.floor(n.length / 4)) ? 2 + d : 99];
    }).filter(function (x) { return x[1] < 99; }).sort(function (x, y) { return x[1] - y[1]; });
    return scored.slice(0, 3).map(function (x) { return x[0]; });
  }
  function friendlyError(msg, ds) {
    var m = /^Unknown field "([^"]+)"/.exec(msg || '');
    if (m && ds) {
      var s = suggest(m[1], ds);
      return tr('queryConsole.unknownField', 'Unknown field "{name}"', { name: m[1] }) +
        (s.length ? tr('queryConsole.didYouMean', ' — did you mean {list}?', { list: s.join(tr('listSep', ', ')) }) : tr('queryConsole.seeFields', ' — see the field list'));
    }
    return msg;
  }
  /**
   * Example snippets built from a dataset's own fields (editor / filter placeholders, syntax reference), so no report
   * shows another report's fields (a Chinese deck never reads region == "Europe"): {query, where, by, from}.
   */
  function hints(ds) {
    var out = {
      from: 'from peers', by: 'by sector, region', where: 'region == "Europe" and mkt_cap > 5000',
      query: 'median(ev_ebitda_25e) by sector where region != "Latin America" sort 2 desc'
    };
    if (!ds) return out;
    out.from = 'from ' + quoteName(ds.id);
    var nums = ds.fields.filter(function (f) { return f.type === 'number' && !/^(lat|lon|lng|latitude|longitude|year|fiscal_year|order|rank|id)$/i.test(f.name); });
    var strs = ds.fields.filter(function (f) { return f.type === 'string'; });
    var dims = strs.filter(function (f) { var n = ds.distinct(f.name).length; return n > 1 && n <= 12 && n < ds.rows.length; });
    if (!dims.length) dims = strs.slice(0, 1);
    var num = nums.filter(function (f) { return fmtKind(f.format) === 'mult'; })[0] || nums[0];
    // a size measure for the example filter: the money field with the largest typical value (market cap, EV, revenue)
    function mid(f) { var v = ds.rows.map(function (r) { return r[f.name]; }).filter(isNum).sort(function (a, b) { return a - b; }); return v.length ? v[Math.floor(v.length / 2)] : null; }
    var money = nums.filter(function (f) { return f !== num && /\$|€|£|¥|元/.test(f.format || '') && isNum(mid(f)); })
      .sort(function (a, b) { return Math.abs(mid(b)) - Math.abs(mid(a)); });
    var size = money[0] || nums.filter(function (f) { return f !== num; })[0] || num;
    var d1 = dims[0], d2 = dims[1] || dims[0];
    var val = null;
    if (d2) { var r0 = ds.rows.filter(function (r) { return r[d2.name] != null && r[d2.name] !== ''; })[0]; val = r0 ? String(r0[d2.name]) : null; }
    var cond = d2 && val != null ? quoteName(d2.name) + ' == "' + val.replace(/["\\]/g, '\\$&') + '"' : null;
    var thr = size && isNum(mid(size)) ? +(+mid(size)).toPrecision(1) : null;
    var cmp = size && thr != null && isFinite(thr) ? quoteName(size.name) + ' > ' + String(thr) : null;
    out.where = [cond, cmp].filter(Boolean).join(' and ') || out.where;
    out.by = d1 ? 'by ' + quoteName(d1.name) + (d2 && d2 !== d1 ? ', ' + quoteName(d2.name) : '') : out.by;
    var item = num ? 'median(' + quoteName(num.name) + ')' : 'count()';
    out.query = item + (d1 ? ' by ' + quoteName(d1.name) : '') + (d2 && d2 !== d1 && val != null ? ' where ' + quoteName(d2.name) + ' != "' + val.replace(/["\\]/g, '\\$&') + '"' : '') + (d1 ? ' sort 2 desc' : '');
    return out;
  }
  /** Syntax reference rows (clause, example) for a dataset. */
  function syntaxRows(ds) {
    var hn = hints(ds), lab = tr('queryConsole.label', 'Label');
    return [
      [tr('queryConsole.items', 'items'), 'expr [as "' + lab + '"] [format "0.0x"], …'],
      ['from', hn.from],
      ['by', hn.by],
      ['where', 'where ' + hn.where],
      ['sort', 'sort 2 desc  ·  sort "' + lab + '" asc'],
      ['top', 'top 10']
    ];
  }
  /**
   * The aggregation word every title shares, as [prefix, suffix] of the aggTitle template ("Median " + "" in English,
   * "" + "中位数" in Chinese), or null.
   */
  function sharedAgg(titles) {
    var tpl = tr('queryConsole.aggOf', '{agg} {field}'), ids = Object.keys(AGG_LABEL);
    for (var i = 0; i < ids.length; i++) {
      var parts = tpl.replace('{agg}', aggLabel(ids[i])).split('{field}');
      if (parts.length !== 2) return null;
      var ok = titles.every(function (x) {
        return x.length > parts[0].length + parts[1].length && x.indexOf(parts[0]) === 0 && x.slice(x.length - parts[1].length) === parts[1];
      });
      if (ok) return parts;
    }
    return null;
  }
  /**
   * The report's wheel rule for the result chart (RK.chart.wheelGuard when the core has it): a plain wheel scrolls the
   * page, Ctrl / ⌘ + wheel or a pinch zooms long line charts; options.wheelZoom: true zooms on a plain wheel.
   */
  function wheelGuard(el, options) {
    if (RK.chart && typeof RK.chart.wheelGuard === 'function') return RK.chart.wheelGuard(el, options);
    if (options && options.wheelZoom === true) return { adapt: function (opt) { return opt; }, destroy: function () {} };
    function onWheel(e) { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }
    el.addEventListener('wheel', onWheel, { capture: true });
    return {
      adapt: function (opt) {
        [].concat(opt.dataZoom || []).forEach(function (dz) { if (dz && dz.type === 'inside' && dz.zoomOnMouseWheel === 'ctrl') dz.zoomOnMouseWheel = true; });
        return opt;
      },
      destroy: function () { el.removeEventListener('wheel', onWheel, { capture: true }); }
    };
  }

  /** "avg(ebitda_margin_25e)" -> "Average EBITDA margin 2025E" for unlabeled aggregate columns. */
  function prettyTitle(col, ds) {
    var m = /^\s*(\w+)\(\s*`?([^`()]*?)`?\s*\)\s*$/.exec(col.title || '');
    if (!m || !AGG_LABEL[m[1].toLowerCase()]) return col.title;
    var f = m[2] && ds.field(m[2]);
    if (!m[2]) return aggLabel(m[1]);
    return aggTitle(m[1], f ? f.title : m[2]);
  }

  /* ------------------------------------------------------------------ *
   * Popover attached to <body> (never clipped by the page / console)
   * ------------------------------------------------------------------ */
  function popover(anchor, content, opts) {
    opts = opts || {};
    var el = h('div.rk-qc-pop', { class: opts.cls || null }, content);
    document.body.appendChild(el);
    var closed = false;
    function place() {
      var r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      if (opts.minWidth !== false) el.style.minWidth = Math.max(opts.minWidth || 0, r.width) + 'px';
      var w = el.offsetWidth, ht = el.offsetHeight;
      var left = opts.align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      var top = r.bottom + 6, above = false;
      if (top + ht > vh - 8 && r.top - ht - 6 > 8) { top = r.top - ht - 6; above = true; }
      el.classList.toggle('is-above', above);
      el.style.left = left + 'px';
      el.style.top = Math.max(8, top) + 'px';
    }
    function onDown(e) { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); if (anchor.focus) anchor.focus(); } }
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      el.classList.remove('is-open');
      setTimeout(function () { el.remove(); }, 160);
      if (opts.onClose) opts.onClose();
    }
    document.addEventListener('pointerdown', onDown, true);
    el.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    place();
    (window.requestAnimationFrame || setTimeout)(function () { if (!closed) el.classList.add('is-open'); });
    return { el: el, close: close, place: place };
  }

  /** Searchable listbox picker: items [{value, label, sub, tag, group}] -> opts.onPick(value). */
  function picker(anchor, items, opts) {
    var q = '', act = 0, rows = [];
    var listId = RK.util.uid('rk-qc-pk');
    var list = h('div.rk-qc-pk__list', { id: listId, role: 'listbox', tabindex: '-1', 'aria-label': opts.label || tr('queryConsole.options', 'Options'), on: { keydown: onKey } });
    var search = items.length > 10 ? h('input.rk-qc-pk__q', {
      type: 'text', placeholder: opts.placeholder || tr('queryConsole.searchPh', 'Search…'), role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId, autocomplete: 'off', spellcheck: 'false',
      on: { input: function () { q = search.value; act = 0; render(); }, keydown: onKey }
    }) : null;
    function render() {
      list.innerHTML = '';
      rows = [];
      var t = q.toLowerCase(), lastGroup = null;
      items.forEach(function (it) {
        if (t && (it.label + ' ' + (it.sub || '') + ' ' + it.value).toLowerCase().indexOf(t) < 0) return;
        if (it.group && it.group !== lastGroup) { list.appendChild(h('div.rk-qc-pk__group', it.group)); lastGroup = it.group; }
        var on = opts.value != null && it.value === opts.value;
        var el = h('div.rk-qc-pk__opt', {
          id: listId + '-' + rows.length, role: 'option', 'aria-selected': on ? 'true' : 'false', class: on ? 'is-on' : null,
          on: { click: function () { pick(it); }, mousemove: function () { var i = rows.indexOf(rec); if (i !== act) { act = i; paint(false); } } }
        }, it.tag != null ? h('span.rk-qc-tag', it.tag) : null, h('span.rk-qc-pk__t', it.label), it.sub ? h('span.rk-qc-pk__s', it.sub) : null);
        var rec = { el: el, it: it };
        list.appendChild(el);
        rows.push(rec);
      });
      if (!rows.length) list.appendChild(h('div.rk-qc-pk__empty', tr('queryConsole.noMatches', 'No matches')));
      act = Math.max(0, Math.min(act, rows.length - 1));
      paint(false);
    }
    function paint(scroll) {
      rows.forEach(function (r, i) { r.el.classList.toggle('is-act', i === act); });
      var owner = search || list, a = rows[act];
      if (a) owner.setAttribute('aria-activedescendant', a.el.id);
      if (a && scroll !== false) a.el.scrollIntoView({ block: 'nearest' });
    }
    function onKey(e) {
      if (e.key === 'ArrowDown') { act = Math.min(rows.length - 1, act + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (rows[act]) { e.preventDefault(); pick(rows[act].it); } }
      else if (e.key === 'Tab') p.close();
    }
    function pick(it) { p.close(); if (anchor.focus) anchor.focus(); opts.onPick(it.value, it); }
    var p = popover(anchor, h('div.rk-qc-pk', search ? h('div.rk-qc-pk__search', h('span', { html: icon('filter', 12) }), search) : null, list), {
      minWidth: opts.minWidth || 220, onClose: opts.onClose
    });
    items.forEach(function (it, i) { if (it.value === opts.value) act = i; });
    render();
    paint();
    p.place();
    (search || list).focus();
    return p;
  }

  /* ------------------------------------------------------------------ *
   * Syntax highlighting (display only — the engine is RK.query / RK.expr)
   * ------------------------------------------------------------------ */
  var TOKEN_RE = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`[^`]*`?|@[A-Za-z_]\w*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?%?|\.\d+%?|[A-Za-z_À-￿][A-Za-z0-9_À-￿]*|\s+|[\s\S]/g;

  function highlight(text, ds, err, caret) {
    var n = text.length, cls = new Array(n), keys = Object.create(null), dsIds = Object.create(null);
    if (ds) ds.fields.forEach(function (f) { keys[norm(f.name)] = 1; keys[norm(f.title || '')] = 1; });
    RK.data.ids().forEach(function (id) { dsIds[id.toLowerCase()] = 1; });
    var m, prev = '';
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      var tk = m[0], s = m.index, c = '', ch = tk[0];
      if (ch === '"' || ch === "'") { c = 't-str'; prev = ''; }
      else if (ch === '`') { c = keys[norm(tk.replace(/`/g, ''))] ? 't-fld' : 't-id'; prev = ''; }
      else if (ch === '@') { c = 't-par'; prev = ''; }
      else if (/\d/.test(ch) || (ch === '.' && /\d/.test(tk))) { c = 't-num'; prev = ''; }
      else if (/[A-Za-z_À-￿]/.test(ch)) {
        var low = tk.toLowerCase();
        if (prev === 'from') c = dsIds[low] ? 't-ds' : 't-id';
        else if (CLAUSE_KW[low]) c = 't-kw';
        else if (LOGIC_KW[low]) c = 't-op';
        else if (/^\s*\(/.test(text.slice(s + tk.length))) c = FN_DOC[low] ? 't-fn' : 't-id';
        else if (keys[norm(tk)]) c = 't-fld';
        else c = 't-id';
        prev = low;
      } else if (/\s/.test(ch)) c = '';
      else { c = 't-pun'; prev = ''; }
      for (var i = s; i < s + tk.length; i++) cls[i] = c;
    }
    var eof = false;
    if (err && err.pos >= 0) {
      if (err.pos >= n) eof = true;
      for (var j = err.pos; j < Math.min(n, err.end); j++) cls[j] = (cls[j] || '') + ' is-err';
    }
    var out = '', run = '', runCls = null;
    function flush() {
      if (!run) return;
      out += runCls ? '<span class="' + runCls + '">' + RK.util.escapeHTML(run) + '</span>' : RK.util.escapeHTML(run);
      run = '';
    }
    for (var k = 0; k <= n; k++) {
      if (k === caret) { flush(); out += '<span class="rk-qc-ed__caret"></span>'; }
      if (k === n) break;
      var c2 = cls[k] || '';
      if (c2 !== runCls) { flush(); runCls = c2; }
      run += text[k];
    }
    flush();
    if (eof) out += '<span class="is-err is-eof">&nbsp;</span>';
    if (/\n$/.test(text) || !text) out += ' ';
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Validation with positions (RK.expr errors are relative to one expression)
   * ------------------------------------------------------------------ */
  function tokenEnd(text, pos) {
    var e = pos;
    while (e < text.length && /[A-Za-z0-9_@.À-￿]/.test(text[e])) e++;
    return Math.max(e, pos + 1);
  }
  function clausePos(text, kw) {
    var re = new RegExp('(^|\\s)' + kw + '\\s', 'i'), m = re.exec(text);
    return m ? m.index + m[1].length : -1;
  }
  function validate(text, dsId, self) {
    if (!String(text).trim()) return { empty: true };
    var spec = RK.query.parse(text);
    var ds = RK.data.get(spec.from || dsId);
    if (!ds) {
      var fp = clausePos(text, 'from');
      var at = fp >= 0 ? text.indexOf(spec.from, fp) : 0;
      return { error: tr('queryConsole.unknownDs', 'Unknown dataset "{id}" — available: {list}', { id: spec.from || dsId, list: RK.data.ids().join(', ') }), pos: at, end: at + String(spec.from || '').length };
    }
    var cursor = 0, i, chk, at2;
    for (i = 0; i < spec.select.length; i++) {
      var it = spec.select[i];
      if (it.expr === '*') continue;
      at2 = text.indexOf(it.expr, cursor);
      if (at2 >= 0) cursor = at2 + it.expr.length;
      chk = RK.expr.check(it.expr, { fields: ds.fields });
      if (!chk.ok) {
        var p = Math.max(0, at2) + Math.max(0, chk.pos);
        return { error: friendlyError(chk.error, ds), pos: p, end: chk.pos >= it.expr.length ? p : tokenEnd(text, p) };
      }
    }
    var bp = clausePos(text, 'by');
    for (i = 0; i < spec.by.length; i++) {
      chk = RK.expr.check(spec.by[i], { fields: ds.fields });
      at2 = text.indexOf(spec.by[i], Math.max(0, bp));
      if (!chk.ok) return { error: friendlyError(chk.error, ds), pos: Math.max(0, at2), end: Math.max(0, at2) + spec.by[i].length };
    }
    if (spec.where) {
      chk = RK.expr.check(spec.where, { fields: ds.fields });
      var wp = text.indexOf(spec.where, Math.max(0, clausePos(text, 'where')));
      if (!chk.ok) {
        var pw = Math.max(0, wp) + Math.max(0, chk.pos);
        return { error: friendlyError(chk.error, ds), pos: pw, end: chk.pos >= spec.where.length ? pw : tokenEnd(text, pw) };
      }
      if (chk.aggregate) return { error: tr('queryConsole.whereAgg', '"where" filters rows — aggregates such as sum() or median() are not allowed there'), pos: wp, end: wp + spec.where.length };
    }
    try {
      var res = RK.query(text, { dataset: dsId, exclude: self });
      return { ok: true, res: res, spec: spec, ds: ds };
    } catch (e) {
      var sp = /sort/i.test(e.message) ? clausePos(text, 'sort') : -1;
      return { error: friendlyError(e.message, ds), pos: sp, end: sp >= 0 ? text.length : -1 };
    }
  }

  /* ------------------------------------------------------------------ *
   * Component
   * ------------------------------------------------------------------ */
  RK.component({
    id: 'query-console',
    deps: ['echarts'],
    needsData: false,
    lazy: false,
    defaults: {
      datasets: null,       // dataset ids offered in the picker (null = every loaded dataset)
      dataset: null,        // initial dataset (default: the block's dataset, else the first)
      query: null,          // initial query text (shown in the Query tab and run on mount)
      builder: null,        // initial builder state {values:[{agg, field}], rows:[...], where, sort:{col, dir}, top}
      examples: [],         // [{label, query}] or query strings — clickable chips
      tab: 'builder',       // builder | query
      view: 'split',        // split | table | chart
      chart: 'auto',        // auto | bar | line | none
      reference: true,      // side reference panel (fields / parameters / functions / syntax)
      history: true,        // remember recent queries (localStorage)
      historySize: 20,
      addMetric: true,      // "Add as metric" for row-level formula columns
      highlight: null,      // value(s) whose result rows / bars are highlighted (e.g. the target company)
      maxRows: 500,         // rows rendered in the table (CSV always exports all)
      wheelZoom: null,      // long line charts: null = Ctrl/Cmd + wheel or pinch zooms (plain wheel scrolls the page); true = plain wheel
      tools: false
    },
    render: function (ctx) {
      var o = ctx.options;
      var t = ctx.theme;
      var highlights = (o.highlight == null ? [] : [].concat(o.highlight)).map(function (v) { return String(v).toLowerCase(); });
      function available() { return (o.datasets || RK.data.ids()).filter(function (id) { return RK.data.get(id); }); }
      function DS() { return RK.data.get(st.ds); }

      var st = memo[ctx.id];
      if (!st) {
        var ids0 = available();
        var ds0 = (o.query && RK.query.parse(o.query).from) || o.dataset || (ctx.dataset && ctx.dataset.id) || ids0[0] || null;
        st = memo[ctx.id] = {
          tab: o.query && !o.builder && o.tab === 'builder' ? 'query' : o.tab, ds: ds0, text: o.query || '',
          view: o.view, builder: null, last: null, tsort: null, refOpen: false
        };
        st.builder = defaultBuilder(ds0, o.builder);
        if (!st.text && st.builder) st.text = genQuery(st.builder, ds0);
      }

      var alive = true, pops = [], chart = null, chartKey = null, ro = null, result = null, ac = null, wheel = null;
      var lastEditor = null, valTimer = null, autoTimer = null, err = null;
      function track(p) { pops.push(p); return p; }

      /* ---------------- skeleton ---------------- */
      ctx.el.classList.add('rk-qc-host');
      var root = h('div.rk-qc', { class: (ctx.motion ? '' : 'is-static') + (o.reference ? ' has-ref' : '') });
      var tabsEl = h('div.rk-qc-tabs', { role: 'tablist', 'aria-label': tr('queryConsole.mode', 'Console mode') });
      var tabBtn = {};
      [['builder', tr('builder', 'Builder')], ['query', tr('query', 'Query')]].forEach(function (p) {
        tabBtn[p[0]] = h('button.rk-qc-tab', {
          type: 'button', role: 'tab', id: ctx.id + '-tab-' + p[0], 'aria-controls': ctx.id + '-pane-' + p[0],
          on: { click: function () { setTab(p[0]); }, keydown: function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(p[0] === 'builder' ? 'query' : 'builder'); tabBtn[st.tab].focus(); } } }
        }, p[1]);
        tabsEl.appendChild(tabBtn[p[0]]);
      });
      var dsName = h('span.rk-qc-ds__v'), dsRows = h('span.rk-qc-ds__n.rk-num');
      var dsBtn = h('button.rk-qc-ds', { type: 'button', 'aria-haspopup': 'listbox', on: { click: openDatasets } },
        h('span.rk-qc-ds__k', tr('dataset', 'Dataset')), dsName, dsRows, h('span.rk-qc-caret', { html: icon('caret', 12) }));
      var histBtn = o.history ? h('button.rk-iconbtn.rk-qc-hbtn', { type: 'button', title: tr('queryConsole.history', 'Query history'), 'aria-label': tr('queryConsole.history', 'Query history'), html: icon('history', 15), on: { click: openHistory } }) : null;
      var refBtn = o.reference ? h('button.rk-iconbtn.rk-qc-refbtn', { type: 'button', title: tr('queryConsole.refTitle', 'Fields & functions'), 'aria-label': tr('queryConsole.refTitle', 'Fields & functions'), 'aria-expanded': 'false', html: icon('book', 15), on: { click: function () { setRef(!st.refOpen); } } }) : null;
      var runBtn = h('button.rk-btn.rk-btn--primary.rk-qc-run', { type: 'button', on: { click: runCurrent } },
        h('span', { html: icon('play', 12) }), tr('run', 'Run'), h('kbd.rk-qc-kbd', MAC ? '⌘↵' : 'Ctrl ↵'));
      var head = h('div.rk-qc__head', tabsEl, dsBtn, h('span.rk-qc__spacer'), histBtn, refBtn, runBtn);

      // query pane
      var mirror = h('div.rk-qc-ed__mirror', { 'aria-hidden': 'true' });
      var ta = h('textarea.rk-qc-ed__input', {
        spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': tr('query', 'Query'), rows: '3'
      });
      var ed = h('div.rk-qc-ed', mirror, ta);
      var exEl = h('div.rk-qc-ex');
      var queryPane = h('div.rk-qc-pane', { id: ctx.id + '-pane-query', role: 'tabpanel', 'aria-labelledby': ctx.id + '-tab-query' }, ed, exEl);

      // builder pane
      var builderPane = h('div.rk-qc-pane.rk-qc-b', { id: ctx.id + '-pane-builder', role: 'tabpanel', 'aria-labelledby': ctx.id + '-tab-builder' });
      var statusEl = h('div.rk-qc-status', { 'aria-live': 'polite' });
      var editor = h('div.rk-qc__editor', builderPane, queryPane, statusEl);

      var refEl = o.reference ? h('aside.rk-qc__ref', { 'aria-label': tr('queryConsole.refTitle', 'Fields & functions') }) : null;
      // bottom fade over the reference list while more items sit below the fold
      var refFade = o.reference ? h('div.rk-qc__reffade', { 'aria-hidden': 'true' }) : null;
      function refEdge() { if (refEl) refFade.classList.toggle('is-on', refEl.scrollHeight - refEl.clientHeight - refEl.scrollTop > 2); }
      if (refEl) refEl.addEventListener('scroll', refEdge, { passive: true });
      var resHead = h('div.rk-qc-rh');
      var tableWrap = h('div.rk-qc-table');
      var chartHost = h('div.rk-qc-chart__host');
      var chartMsg = h('div.rk-qc-chart__msg');
      var chartWrap = h('div.rk-qc-chart', chartHost, chartMsg);
      var resBody = h('div.rk-qc-rb', tableWrap, chartWrap);
      var results = h('div.rk-qc__results', resHead, resBody);
      root.appendChild(h('div.rk-qc__grid', head, editor, refEl, refFade, results));
      ctx.el.appendChild(root);

      /* ---------------- dataset ---------------- */
      function paintDataset() {
        var ds = DS();
        dsName.textContent = ds ? ds.title : tr('queryConsole.chooseDs', 'Choose a dataset');
        dsRows.textContent = ds ? countText('queryConsole.nRows', ds.rows.length, '{n} row', '{n} rows') : '';
        dsBtn.title = ds ? ds.id : '';
        // the example in the empty editor uses this dataset's own fields
        ta.placeholder = tr('queryConsole.eg', 'e.g. {example}', { example: hints(ds).query });
      }
      function openDatasets() {
        track(picker(dsBtn, available().map(function (id) {
          var d = RK.data.get(id);
          return { value: id, label: d.title, sub: id + ' · ' + countText('queryConsole.nRows', d.rows.length, '{n} row', '{n} rows') };
        }), {
          value: st.ds, label: tr('queryConsole.datasets', 'Datasets'), placeholder: tr('queryConsole.searchDs', 'Search datasets…'), minWidth: 300,
          onPick: function (id) {
            if (id === st.ds) return;
            st.ds = id;
            st.builder = defaultBuilder(id, null);
            // keep the query text but point it at the new dataset
            var spec = RK.query.parse(st.text || '');
            if (spec.from) st.text = st.text.replace(new RegExp('(\\bfrom\\s+)[`"\']?' + spec.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[`"\']?', 'i'), '$1' + id);
            else st.text = genQuery(st.builder, id);
            ta.value = st.text;
            paintDataset(); paintBuilder(); paintRef(); onEdit(true);
            if (st.tab === 'builder') autoRun(); else runCurrent();
          }
        }));
      }

      /* ---------------- builder ---------------- */
      function numericFields(ds) { return ds ? ds.fields.filter(function (f) { return f.type === 'number'; }) : []; }
      function dimFields(ds) { return ds ? ds.fields.filter(function (f) { return f.type !== 'number'; }) : []; }
      function defaultBuilder(dsId, given) {
        var ds = RK.data.get(dsId);
        var b = { values: [], rows: [], where: '', sort: { col: null, dir: 'desc' }, top: null };
        if (given) return RK.util.merge(b, JSON.parse(JSON.stringify(given)));   // options must not be mutated
        if (!ds) return b;
        var nums = numericFields(ds).filter(function (f) { return !/^(lat|lon|lng|latitude|longitude|year|fiscal_year|order|rank|id)$/i.test(f.name); });
        var pref = nums.filter(function (f) { return fmtKind(f.format) === 'mult'; })[0] || nums.filter(function (f) { return /\$|€|£/.test(f.format || ''); })[0] || nums[0];
        var dims = dimFields(ds).filter(function (f) {
          var n = ds.distinct(f.name).length;
          return f.type === 'string' && n > 1 && n <= 12 && n < ds.rows.length;
        });
        if (pref) b.values.push({ agg: dims.length ? 'median' : 'none', field: pref.name });
        if (dims.length) b.rows.push(dims[0].name);
        else { var lab = dimFields(ds)[0]; if (lab) b.rows.push(lab.name); }
        if (pref) b.sort = { col: 'v0', dir: 'desc' };
        return b;
      }
      function aggregated(b) { return b.values.some(function (v) { return v.agg !== 'none'; }); }
      function genQuery(b, dsId) {
        var ds = RK.data.get(dsId);
        if (!ds || !b) return '';
        var agg = aggregated(b);
        var items = agg ? [] : b.rows.map(quoteName);
        b.values.forEach(function (v) {
          var f = ds.field(v.field);
          if (!f) return;
          if (v.agg === 'none') items.push(quoteName(f.name));
          else items.push(v.agg + '(' + quoteName(f.name) + ') as "' + aggTitle(v.agg, f.title).replace(/"/g, "'") + '"');
        });
        if (!items.length) items = ['*'];
        var s = items.join(', ') + ' from ' + dsId;
        if (agg && b.rows.length) s += ' by ' + b.rows.map(quoteName).join(', ');
        if (b.where && b.where.trim()) s += ' where ' + b.where.trim();
        var pos = sortPosition(b);
        if (pos) s += ' sort ' + pos + ' ' + (b.sort.dir === 'asc' ? 'asc' : 'desc');
        if (b.top) s += ' top ' + b.top;
        return s;
      }
      function sortPosition(b) {
        var c = b.sort && b.sort.col;
        if (!c) return null;
        if (c.indexOf('r:') === 0) { var i = b.rows.indexOf(c.slice(2)); return i >= 0 ? i + 1 : null; }
        var vi = parseInt(c.slice(1), 10);
        if (!(vi < b.values.length)) return null;
        return b.rows.length + vi + 1;
      }
      function outputColumns(b) {
        var ds = DS(), out = [];
        if (!ds) return out;
        b.rows.forEach(function (r) { var f = ds.field(r); if (f) out.push({ value: 'r:' + r, label: f.title }); });
        b.values.forEach(function (v, i) {
          var f = ds.field(v.field);
          if (f) out.push({ value: 'v' + i, label: v.agg === 'none' ? f.title : aggTitle(v.agg, f.title) });
        });
        return out;
      }
      function fieldItems(prefer) {
        var ds = DS();
        if (!ds) return [];
        var list = ds.fields.slice().sort(function (a, b) {
          var pa = prefer === 'number' ? (a.type === 'number' ? 0 : 1) : (a.type === 'number' ? 1 : 0);
          var pb = prefer === 'number' ? (b.type === 'number' ? 0 : 1) : (b.type === 'number' ? 1 : 0);
          return pa - pb;
        });
        return list.map(function (f) {
          return { value: f.name, label: f.title, sub: f.name + (f.format ? ' · ' + f.format : ''), tag: (f.computed ? 'ƒ ' : '') + typeTag(f.type), group: f.type === 'number' ? tr('queryConsole.numbers', 'Numbers') : tr('queryConsole.textDates', 'Text & dates') };
        });
      }
      function bChanged() { st.text = genQuery(st.builder, st.ds); paintBuilder(); autoRun(); }

      function paintBuilder() {
        var b = st.builder, ds = DS();
        builderPane.innerHTML = '';
        if (!ds || !b) { builderPane.appendChild(h('p.rk-muted', tr('queryConsole.chooseDsStart', 'Choose a dataset to start.'))); return; }
        var hint = hints(ds);
        // values
        var vals = h('div.rk-qc-b__items');
        b.values.forEach(function (v, i) {
          var f = ds.field(v.field);
          var aggBtn = h('button.rk-qc-pill__agg', { type: 'button', title: tr('queryConsole.aggregation', 'Aggregation'), on: { click: function () {
            var numeric = f && f.type === 'number';
            track(picker(aggBtn, AGGS.filter(function (a) { return numeric || a === 'none' || a === 'count' || a === 'countd'; })
              .map(function (a) { return { value: a, label: aggLabel(a), sub: a === 'none' ? tr('queryConsole.noAgg', 'No aggregation — one row per record') : null }; }), {
              value: v.agg, label: tr('queryConsole.aggregation', 'Aggregation'), minWidth: 200,
              onPick: function (id) { v.agg = id; bChanged(); }
            }));
          } } }, aggLabel(v.agg) || v.agg);
          var fBtn = h('button.rk-qc-pill__f', { type: 'button', title: tr('field', 'Field'), on: { click: function () {
            track(picker(fBtn, fieldItems('number'), { value: v.field, label: tr('queryConsole.fields', 'Fields'), placeholder: tr('queryConsole.searchFields', 'Search fields…'), minWidth: 300, onPick: function (name) {
              v.field = name;
              var nf = ds.field(name);
              if (nf && nf.type !== 'number' && ['none', 'count', 'countd'].indexOf(v.agg) < 0) v.agg = 'countd';
              bChanged();
            } }));
          } } }, f ? f.title : v.field);
          var rm = h('button.rk-qc-pill__x', { type: 'button', 'aria-label': tr('queryConsole.removeValue', 'Remove value'), html: icon('x', 11), on: { click: function () {
            b.values.splice(i, 1);
            if (b.sort.col && b.sort.col[0] === 'v') b.sort.col = null;
            bChanged();
          } } });
          vals.appendChild(h('span.rk-qc-pill', aggBtn, h('span.rk-qc-pill__of', tr('queryConsole.of', 'of')), fBtn, rm));
        });
        var addV = h('button.rk-qc-add', { type: 'button', on: { click: function () {
          track(picker(addV, fieldItems('number'), { label: tr('queryConsole.fields', 'Fields'), placeholder: tr('queryConsole.searchFields', 'Search fields…'), minWidth: 300, onPick: function (name) {
            var nf = ds.field(name);
            b.values.push({ agg: nf && nf.type === 'number' ? (b.rows.length && aggregated(b) ? 'median' : (aggregated(b) ? 'median' : 'none')) : 'countd', field: name });
            bChanged();
          } }));
        } } }, h('span', { html: icon('plus', 12) }), tr('queryConsole.addValue', 'Add value'));
        vals.appendChild(addV);

        // rows (group by / label columns)
        var rws = h('div.rk-qc-b__items');
        b.rows.forEach(function (r, i) {
          var f = ds.field(r);
          rws.appendChild(h('span.rk-qc-pill.rk-qc-pill--dim', h('span.rk-qc-pill__f.is-static', f ? f.title : r),
            h('button.rk-qc-pill__x', { type: 'button', 'aria-label': tr('queryConsole.removeX', 'Remove {name}', { name: f ? f.title : r }), html: icon('x', 11), on: { click: function () {
              b.rows.splice(i, 1);
              if (b.sort.col === 'r:' + r) b.sort.col = null;
              bChanged();
            } } })));
        });
        var addR = h('button.rk-qc-add', { type: 'button', on: { click: function () {
          track(picker(addR, fieldItems('dim').filter(function (it) { return b.rows.indexOf(it.value) < 0; }), { label: tr('queryConsole.fields', 'Fields'), placeholder: tr('queryConsole.searchFields', 'Search fields…'), minWidth: 300, onPick: function (name) { b.rows.push(name); bChanged(); } }));
        } } }, h('span', { html: icon('plus', 12) }), aggregated(b) ? tr('queryConsole.groupBy', 'Group by') : tr('queryConsole.addColumn', 'Add column'));

        // filter
        var where = h('input.rk-input.rk-qc-b__where', {
          type: 'text', value: b.where || '', spellcheck: 'false', autocomplete: 'off', 'aria-label': tr('queryConsole.filterExpr', 'Filter expression'),
          placeholder: tr('queryConsole.eg', 'e.g. {example}', { example: hint.where }),
          on: {
            input: function () { b.where = where.value; checkWhere(); clearTimeout(autoTimer); autoTimer = setTimeout(function () { if (!whereBad) { st.text = genQuery(b, st.ds); paintGen(); runText(st.text, { silent: true }); } }, 380); },
            focus: function () { lastEditor = where; },
            keydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); runCurrent(); } }
          }
        });
        var whereMark = h('span.rk-qc-b__mark');
        var whereBad = false;
        function checkWhere() {
          var v = where.value.trim();
          var c = v ? RK.expr.check(v, { fields: ds.fields }) : { ok: true };
          if (c.ok && c.aggregate) c = { ok: false, error: tr('queryConsole.aggInWhere', 'Aggregates are not allowed in a row filter') };
          whereBad = !c.ok;
          where.classList.toggle('is-bad', whereBad);
          whereMark.innerHTML = v ? icon(c.ok ? 'check' : 'warn', 13) : '';
          whereMark.className = 'rk-qc-b__mark ' + (v ? (c.ok ? 'is-ok' : 'is-bad') : '');
          whereMark.title = c.ok ? tr('queryConsole.validFilter', 'Valid filter') : friendlyError(c.error, ds);
          if (!c.ok) setStatus('error', friendlyError(c.error, ds));
        }

        // sort + top
        var cols = outputColumns(b);
        var cur = cols.filter(function (c) { return c.value === b.sort.col; })[0];
        var sortBtn = h('button.rk-qc-sel', { type: 'button', on: { click: function () {
          track(picker(sortBtn, [{ value: null, label: tr('queryConsole.noSort', 'No sorting') }].concat(cols), { value: b.sort.col, label: tr('queryConsole.sortBy', 'Sort by'), minWidth: 220, onPick: function (v) { b.sort.col = v; bChanged(); } }));
        } } }, h('span', cur ? cur.label : tr('queryConsole.noSort', 'No sorting')), h('span.rk-qc-caret', { html: icon('caret', 12) }));
        var dirSeg = h('div.rk-seg.rk-qc-seg', [['desc', tr('queryConsole.highLow', 'High → low')], ['asc', tr('queryConsole.lowHigh', 'Low → high')]].map(function (d) {
          return h('button', { type: 'button', class: b.sort.dir === d[0] ? 'is-on' : null, 'aria-pressed': b.sort.dir === d[0] ? 'true' : 'false', disabled: !b.sort.col, on: { click: function () { b.sort.dir = d[0]; bChanged(); } } }, d[1]);
        }));
        var top = h('input.rk-input.rk-qc-b__top.rk-num', {
          type: 'number', min: '1', step: '1', value: b.top || '', placeholder: tr('all', 'All'), 'aria-label': tr('queryConsole.topN', 'Top N rows'),
          on: { change: function () { var n = parseInt(top.value, 10); b.top = n > 0 ? n : null; bChanged(); } }
        });

        var gen = h('code.rk-qc-gen');
        function paintGen() { gen.innerHTML = highlight(st.text || genQuery(b, st.ds), ds, null, -1); }
        var editAs = h('button.rk-qc-link', { type: 'button', on: { click: function () { st.text = genQuery(b, st.ds); ta.value = st.text; setTab('query'); ta.focus(); } } }, tr('queryConsole.editAsQuery', 'Edit as query'), h('span', { html: icon('arrow', 12) }));

        function row(label, body, hint) {
          return h('div.rk-qc-b__row', h('div.rk-qc-b__k', label, hint ? h('span.rk-qc-b__hint', hint) : null), h('div.rk-qc-b__v', body));
        }
        builderPane.appendChild(row(tr('queryConsole.values', 'Values'), vals));
        builderPane.appendChild(row(aggregated(b) ? tr('queryConsole.groupBy', 'Group by') : tr('columns', 'Columns'), h('div.rk-qc-b__items', rws.childNodes.length ? Array.prototype.slice.call(rws.childNodes) : null, addR)));
        builderPane.appendChild(row(tr('queryConsole.filter', 'Filter'), h('div.rk-qc-b__wherewrap', where, whereMark)));
        builderPane.appendChild(row(tr('queryConsole.sort', 'Sort'), h('div.rk-qc-b__inline', sortBtn, dirSeg, h('span.rk-qc-b__k2', tr('queryConsole.top', 'Top')), top)));
        builderPane.appendChild(row(tr('query', 'Query'), h('div.rk-qc-b__inline.rk-qc-b__genrow', gen, editAs)));
        paintGen();
        if (b.where) checkWhere();
      }
      function autoRun() {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(function () { runText(st.text, { silent: true }); }, 120);
      }

      /* ---------------- query editor ---------------- */
      function paintMirror() {
        mirror.innerHTML = highlight(ta.value, RK.data.get(RK.query.parse(ta.value).from || st.ds) || DS(), err, ta.selectionStart);
        mirror.scrollTop = ta.scrollTop;
      }
      function autosize() {
        ta.style.height = 'auto';
        var hgt = Math.max(62, Math.min(184, ta.scrollHeight + 2));
        ta.style.height = hgt + 'px';
        mirror.style.height = hgt + 'px';
      }
      function onEdit(skipAc) {
        st.text = ta.value;
        err = null;
        autosize();
        paintMirror();
        clearTimeout(valTimer);
        valTimer = setTimeout(runValidation, 220);
        if (!skipAc) autocomplete();
      }
      function runValidation() {
        if (!alive) return;
        var v = validate(ta.value, st.ds, ctx.id);
        if (v.empty) { err = null; setStatus('idle', tr('queryConsole.idle', 'Type a query, pick an example or use the reference panel →')); }
        else if (v.error) {
          err = v.pos >= 0 ? { pos: v.pos, end: v.end } : null;
          var lc = v.pos >= 0 ? lineCol(ta.value, v.pos) : null;
          setStatus('error', v.error, lc ? tr('queryConsole.lnCol', 'Ln {line}, Col {col}', { line: lc.line, col: lc.col }) : null);
        } else {
          err = null;
          var r = v.res, by = v.spec.by.length ? tr('queryConsole.groupedBy', ' · grouped by {list}', { list: v.spec.by.join(', ') }) : (r.aggregate ? tr('queryConsole.summaryRow', ' · summary') : '');
          setStatus('ok', tr('queryConsole.valid', 'Valid — {rows} × {cols}{by}', {
            rows: countText('queryConsole.nRows', r.rows.length, '{n} row', '{n} rows'), cols: countText('queryConsole.nCols', r.columns.length, '{n} column', '{n} columns'), by: by
          }), tr('queryConsole.toRun', '{key} + Enter to run', { key: MAC ? '⌘' : 'Ctrl' }));
        }
        paintMirror();
      }
      function setStatus(kind, msg, aside) {
        statusEl.className = 'rk-qc-status is-' + kind;
        statusEl.innerHTML = '';
        statusEl.appendChild(h('span.rk-qc-status__i', { html: kind === 'error' ? icon('warn', 13) : kind === 'ok' ? icon('check', 13) : '' }));
        statusEl.appendChild(h('span.rk-qc-status__m', msg));
        if (aside) statusEl.appendChild(h('span.rk-qc-status__a', aside));
      }

      ta.value = st.text || '';
      ta.addEventListener('input', function () { onEdit(false); });
      ta.addEventListener('scroll', function () { mirror.scrollTop = ta.scrollTop; });
      ta.addEventListener('focus', function () { lastEditor = ta; });
      ta.addEventListener('blur', function () { setTimeout(closeAc, 120); });
      ta.addEventListener('click', function () { closeAc(); paintMirror(); });
      ta.addEventListener('keyup', function (e) { if (/^(Arrow|Home|End|Page)/.test(e.key) && !ac) paintMirror(); });
      ta.addEventListener('keydown', function (e) {
        if (ac) {
          if (e.key === 'ArrowDown') { e.preventDefault(); ac.move(1); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); ac.move(-1); return; }
          if ((e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) || e.key === 'Tab') { e.preventDefault(); ac.accept(); return; }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAc(); return; }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') closeAc();
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCurrent(); }
      });

      /* ---------------- autocomplete ---------------- */
      function closeAc() { if (ac) { ac.el.remove(); ac = null; ta.removeAttribute('aria-activedescendant'); } }
      function autocomplete() {
        var caret = ta.selectionStart, before = ta.value.slice(0, caret);
        var m = /(@?[A-Za-z_À-￿][A-Za-z0-9_À-￿]*|@)$/.exec(before);
        var quotes = (before.match(/"/g) || []).length % 2 || (before.match(/`/g) || []).length % 2;
        if (!m || quotes || ta.selectionEnd !== caret) { closeAc(); return; }
        var prefix = m[1], low = prefix.toLowerCase(), cands = [];
        var ds = RK.data.get(RK.query.parse(ta.value).from || st.ds) || DS();
        if (prefix[0] === '@') {
          var ps = RK.store.params();
          Object.keys(ps).forEach(function (k) { cands.push({ ins: '@' + k, label: '@' + k, sub: RK.format(ps[k], Math.abs(ps[k]) < 1 ? '0.00%' : 'auto'), kind: 'param' }); });
        } else if (/\bfrom\s+[A-Za-z_]*$/i.test(before)) {
          available().forEach(function (id) { cands.push({ ins: id, label: id, sub: RK.data.get(id).title, kind: 'ds' }); });
        } else {
          if (ds) ds.fields.forEach(function (f) { cands.push({ ins: quoteName(f.name), label: f.name, sub: f.title, kind: f.type === 'number' ? '#' : typeTag(f.type), title: f.title }); });
          RK.expr.functions.aggregate.concat(RK.expr.functions.scalar).forEach(function (fn) {
            if (!cands.some(function (c) { return c.label === fn + '()'; })) cands.push({ ins: fn + '(', label: fn + '()', sub: fnDoc(fn), kind: 'ƒ' });
          });
          AC_KEYWORDS.forEach(function (k) { cands.push({ ins: k + ' ', label: k, sub: tr('queryConsole.keyword', 'keyword'), kind: 'kw' }); });
        }
        var starts = [], contains = [];
        cands.forEach(function (c) {
          var l = c.label.toLowerCase(), tl = (c.title || '').toLowerCase();
          if (l === low || l === low + '()') return;
          if (l.indexOf(low) === 0 || (low[0] === '@' && l.indexOf(low) === 0)) starts.push(c);
          else if (low.length >= 2 && (l.indexOf(low) > 0 || tl.indexOf(low) >= 0)) contains.push(c);
        });
        var list = starts.concat(contains).slice(0, 8);
        if (!list.length || (prefix.length < 1)) { closeAc(); return; }
        paintMirror();
        var mark = mirror.querySelector('.rk-qc-ed__caret');
        if (!mark) { closeAc(); return; }
        var r = mark.getBoundingClientRect();
        if (!ac) {
          var el = h('div.rk-qc-ac', { role: 'listbox', id: ctx.id + '-ac' });
          document.body.appendChild(el);
          ac = { el: el, act: 0, list: [] };
          ac.move = function (d) { ac.act = (ac.act + d + ac.list.length) % ac.list.length; paintAc(); };
          ac.accept = function () { var c = ac.list[ac.act]; if (c) insertCompletion(c, ac.prefix); };
          ta.setAttribute('aria-controls', el.id);
        }
        ac.list = list; ac.prefix = prefix; ac.act = Math.min(ac.act, list.length - 1);
        paintAc();
        var top = r.bottom + 4, left = r.left - 8;
        var ht = ac.el.offsetHeight, w = ac.el.offsetWidth;
        if (top + ht > window.innerHeight - 8) top = r.top - ht - 4;
        ac.el.style.top = top + 'px';
        ac.el.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + 'px';
      }
      function paintAc() {
        ac.el.innerHTML = '';
        ac.list.forEach(function (c, i) {
          var row = h('div.rk-qc-ac__opt', { role: 'option', id: ctx.id + '-ac-' + i, class: i === ac.act ? 'is-act' : null, 'aria-selected': i === ac.act ? 'true' : 'false',
            on: { pointerdown: function (e) { e.preventDefault(); insertCompletion(c, ac.prefix); } } },
          h('span.rk-qc-tag', c.kind === 'param' ? '@' : c.kind === 'ds' ? 'ds' : c.kind), h('span.rk-qc-ac__l', c.label), h('span.rk-qc-ac__s', c.sub));
          ac.el.appendChild(row);
        });
        ta.setAttribute('aria-activedescendant', ctx.id + '-ac-' + ac.act);
      }
      function insertCompletion(c, prefix) {
        var caret = ta.selectionStart, start = caret - prefix.length;
        ta.setRangeText(c.ins, start, caret, 'end');
        closeAc();
        onEdit(true);
        ta.focus();
      }

      /** Insert text at the caret of the last focused editor (reference panel clicks). */
      function insert(text) {
        var target = st.tab === 'builder' ? builderPane.querySelector('.rk-qc-b__where') : ta;
        if (!target) return;
        if (target === ta && st.tab !== 'query') setTab('query');
        var s = target.selectionStart != null ? target.selectionStart : target.value.length, e = target.selectionEnd != null ? target.selectionEnd : s;
        if (document.activeElement !== target && lastEditor !== target) { s = e = target.value.length; }
        var pre = target.value.slice(0, s);
        var pad = pre && !/[\s(,\[]$/.test(pre) && !/^[),\]]/.test(text) ? ' ' : '';
        target.setRangeText(pad + text, s, e, 'end');
        target.focus();
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }

      /* ---------------- reference panel ---------------- */
      var refQ = '';
      function paintRef() {
        if (!refEl) return;
        var ds = DS();
        var keepFocus = document.activeElement && document.activeElement.classList.contains('rk-qc-ref__q');
        refEl.innerHTML = '';
        var q = h('input.rk-qc-ref__q', { type: 'text', placeholder: tr('queryConsole.filterRef', 'Filter fields & functions…'), value: refQ, 'aria-label': tr('queryConsole.filterRef', 'Filter fields & functions…'), spellcheck: 'false',
          on: { input: function () { refQ = q.value; paintRef(); } } });
        refEl.appendChild(h('div.rk-qc-ref__top', q, h('p.rk-qc-ref__tip', tr('queryConsole.refTip', 'Click an item to insert it at the cursor'))));
        var t0 = refQ.toLowerCase();
        function match(s) { return !t0 || String(s).toLowerCase().indexOf(t0) >= 0; }
        if (o.addMetric) paintMyMetrics(ds, match, !!t0);
        if (ds) {
          var fl = h('div.rk-qc-ref__list');
          ds.fields.forEach(function (f) {
            if (!match(f.name + ' ' + f.title)) return;
            var item = h('button.rk-qc-ref__item', { type: 'button', class: f.user ? 'is-user' : null, title: (f.formula ? f.formula : f.title) + (f.format ? '  ·  ' + f.format : ''), on: { click: function () { insert(quoteName(f.name)); } } },
              h('span.rk-qc-tag', (f.computed ? 'ƒ' : '') + typeTag(f.type)),
              h('span.rk-qc-ref__main', h('span.rk-qc-ref__t', f.title), h('span.rk-qc-ref__n', f.name)),
              f.format ? h('span.rk-qc-ref__f', f.format) : null);
            fl.appendChild(item);
          });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', tr('queryConsole.fields', 'Fields'), h('span.rk-num', String(ds.fields.length))), fl));
        }
        var ps = RK.store.params(), pk = Object.keys(ps).filter(function (k) { return match('@' + k); });
        if (pk.length) {
          var pl = h('div.rk-qc-ref__list');
          pk.forEach(function (k) {
            var v = ps[k];
            pl.appendChild(h('button.rk-qc-ref__item', { type: 'button', on: { click: function () { insert('@' + k); } } },
              h('span.rk-qc-tag', '@'), h('span.rk-qc-ref__main', h('span.rk-qc-ref__t.rk-qc-mono', '@' + k)),
              h('span.rk-qc-ref__f', isNum(v) ? RK.format(v, Math.abs(v) < 1 ? '0.00%' : 'auto') : String(v))));
          });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', tr('queryConsole.parameters', 'Parameters')), pl));
        }
        [[tr('queryConsole.aggFns', 'Aggregate functions'), RK.expr.functions.aggregate], [tr('queryConsole.rowFns', 'Row functions'), RK.expr.functions.scalar]].forEach(function (grp) {
          var names = grp[1].filter(function (n) { return match(n + ' ' + fnDoc(n)); });
          if (!names.length) return;
          var gl = h('div.rk-qc-ref__fns');
          names.forEach(function (n) {
            gl.appendChild(h('button.rk-qc-fn', { type: 'button', title: fnDoc(n) || n + '()', on: { click: function () { insert(n + '('); } } }, n));
          });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', grp[0]), gl));
        });
        if (!t0) {
          var sl = h('dl.rk-qc-ref__syntax');
          syntaxRows(ds).forEach(function (s) { sl.appendChild(h('dt', s[0])); sl.appendChild(h('dd', s[1])); });
          refEl.appendChild(h('section.rk-qc-ref__sec', h('h4', tr('queryConsole.syntax', 'Syntax')), sl));
        }
        if (keepFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
        refEdge();
      }

      /**
       * "My metrics": formulas the client saved with "Add as metric" (kept in this browser for this report by
       * RK.data; without that API, the user fields of the loaded datasets). Click = insert (or switch to that
       * metric's dataset); × = delete it everywhere.
       */
      function savedMetrics() {
        if (typeof RK.data.userMetrics === 'function') {
          try { return RK.data.userMetrics() || []; } catch (e) { return []; }
        }
        var out = [];
        RK.data.ids().forEach(function (id) {
          RK.data.get(id).fields.forEach(function (f) {
            if (f.user && f.computed) out.push({ dataset: id, name: f.name, title: f.title, formula: f.formula, format: f.format, active: true });
          });
        });
        return out;
      }
      function removeMetric(m) {
        if (typeof RK.data.removeUserMetric === 'function') RK.data.removeUserMetric(m.dataset, m.name);
        else { var d = RK.data.get(m.dataset); if (d && d.field(m.name) && d.field(m.name).computed) d.removeComputed(m.name); }
        // a saved metric that was not loaded emits no data change: repaint here
        paintRef();
        if (st.tab === 'builder') paintBuilder();
      }
      function paintMyMetrics(ds, match, filtering) {
        var list = savedMetrics().filter(function (m) { return match(m.name + ' ' + (m.title || '') + ' ' + m.dataset); });
        if (!list.length && filtering) return;
        // this dataset's metrics first
        list.sort(function (a, b) { return (a.dataset === st.ds ? 0 : 1) - (b.dataset === st.ds ? 0 : 1); });
        var ml = h('div.rk-qc-ref__list', { role: 'list' });
        list.forEach(function (m) {
          var here = !!ds && m.dataset === ds.id, active = m.active !== false;
          var tip = m.formula + (m.format ? '  ·  ' + m.format : '') + (active ? '' : '  —  ' + tr('queryConsole.metricInactive', 'cannot be computed on the current data (missing fields)'));
          var main = h('button.rk-qc-ref__item.rk-qc-my__item', { type: 'button', title: tip, disabled: !active && here ? true : null, on: { click: function () {
            if (here) { insert(quoteName(m.name)); return; }
            if (!RK.data.get(m.dataset)) return;
            st.ds = m.dataset; st.builder = defaultBuilder(m.dataset, null);
            paintDataset(); paintBuilder(); paintRef();
            insert(quoteName(m.name));
          } } },
            h('span.rk-qc-tag.rk-qc-tag--my', 'ƒ#'),
            h('span.rk-qc-ref__main', h('span.rk-qc-ref__t', m.title || m.name),
              h('span.rk-qc-ref__n', m.name + (here ? '' : '  ·  ' + tr('queryConsole.metricIn', 'in {dataset}', { dataset: m.dataset })))),
            m.format ? h('span.rk-qc-ref__f', m.format) : null);
          var rm = h('button.rk-qc-my__rm', { type: 'button', title: tr('removeMetric', 'Remove metric {name}', { name: m.title || m.name }),
            'aria-label': tr('removeMetric', 'Remove metric {name}', { name: m.title || m.name }), html: icon('x', 12), on: { click: function () { removeMetric(m); } } });
          ml.appendChild(h('div.rk-qc-my', { role: 'listitem', class: (here ? '' : 'is-other') + (active ? '' : ' is-inactive') }, main, rm));
        });
        if (!list.length) ml.appendChild(h('p.rk-qc-my__empty', tr('queryConsole.metricsHint', 'Formulas you save with “Add as metric” appear here and are kept in this browser for this report')));
        refEl.appendChild(h('section.rk-qc-ref__sec.rk-qc-ref__sec--my',
          h('h4', tr('myMetrics', 'My metrics'), list.length ? h('span.rk-num', String(list.length)) : null), ml));
      }
      function setRef(open) {
        st.refOpen = open;
        root.classList.toggle('is-ref-open', open);
        if (refBtn) refBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }

      /* ---------------- examples ---------------- */
      function paintExamples() {
        exEl.innerHTML = '';
        var ex = (o.examples || []).map(function (e) { return typeof e === 'string' ? { label: e, query: e } : e; });
        if (!ex.length) return;
        exEl.appendChild(h('span.rk-qc-ex__k', tr('examples', 'Examples')));
        ex.forEach(function (e) {
          exEl.appendChild(h('button.rk-qc-chip', { type: 'button', title: e.query, on: { click: function () {
            ta.value = e.query;
            onEdit(true);
            runCurrent();
          } } }, e.label));
        });
      }

      /* ---------------- history ---------------- */
      function pushHistory(text, dsId) {
        if (!o.history) return;
        var list = loadHistory().filter(function (x) { return !(x.q === text && x.ds === dsId); });
        list.unshift({ q: text, ds: dsId, t: Date.now() });
        saveHistory(list.slice(0, o.historySize || 20));
      }
      function openHistory() {
        var list = loadHistory();
        var body = h('div.rk-qc-hist');
        if (!list.length) body.appendChild(h('p.rk-qc-hist__empty', tr('queryConsole.histEmpty', 'Queries you run appear here.')));
        list.forEach(function (x) {
          body.appendChild(h('button.rk-qc-hist__item', { type: 'button', on: { click: function () {
            p.close();
            if (x.ds && RK.data.get(x.ds) && x.ds !== st.ds) { st.ds = x.ds; st.builder = defaultBuilder(x.ds, null); paintDataset(); paintBuilder(); paintRef(); }
            ta.value = x.q;
            setTab('query');
            onEdit(true);
            runCurrent();
          } } }, h('code.rk-qc-hist__q', { html: highlight(x.q, RK.data.get(x.ds), null, -1) }), h('span.rk-qc-hist__meta', (x.ds || '') + ' · ' + relTime(x.t))));
        });
        var foot = h('div.rk-qc-hist__foot', h('span', countText('queryConsole.nRecent', list.length, '{n} recent query', '{n} recent queries')),
          list.length ? h('button.rk-qc-link', { type: 'button', on: { click: function () { saveHistory([]); p.close(); } } }, tr('queryConsole.clearHistory', 'Clear history')) : null);
        var p = track(popover(histBtn, h('div', body, foot), { minWidth: 380, align: 'right', cls: 'rk-qc-pop--hist' }));
      }

      /* ---------------- tabs ---------------- */
      function setTab(tab) {
        st.tab = tab;
        ['builder', 'query'].forEach(function (k) {
          var on = k === tab;
          tabBtn[k].classList.toggle('is-on', on);
          tabBtn[k].setAttribute('aria-selected', on ? 'true' : 'false');
          tabBtn[k].tabIndex = on ? 0 : -1;
        });
        builderPane.hidden = tab !== 'builder';
        queryPane.hidden = tab !== 'query';
        closeAc();
        if (tab === 'query') { autosize(); paintMirror(); runValidation(); }
        else setStatus('idle', tr('queryConsole.builderIdle', 'Builder writes the query for you — results update as you change it'));
      }

      /* ---------------- running ---------------- */
      function runCurrent() {
        if (st.tab === 'builder') { st.text = genQuery(st.builder, st.ds); runText(st.text, {}); }
        else runText(ta.value, {});
      }
      function runText(text, opts) {
        opts = opts || {};
        if (!text || !text.trim()) return;
        var t0 = (window.performance || Date).now();
        var res;
        try { res = RK.query(text, { dataset: st.ds, exclude: ctx.id }); }
        catch (e) {
          if (st.tab === 'query') runValidation();
          else setStatus('error', friendlyError(e.message, DS()));
          return;
        }
        res.ms = (window.performance || Date).now() - t0;
        if (res.dataset !== st.ds) {
          st.ds = res.dataset;
          st.builder = defaultBuilder(st.ds, null);
          paintDataset(); paintRef();
          if (st.tab !== 'builder') paintBuilder();
        }
        if (!opts.keepSort) st.tsort = null;
        st.last = { text: text, ds: res.dataset };
        if (!opts.silent) pushHistory(text, res.dataset);
        var nrows = countText('queryConsole.nRows', res.rows.length, '{n} row', '{n} rows');
        if (!opts.rerun && st.tab === 'builder') setStatus('ok', tr('queryConsole.builderOk', '{rows} — results update as you edit', { rows: nrows }), tr('queryConsole.runSaves', 'Run saves to history'));
        if (!opts.rerun && st.tab === 'query' && !opts.silent) setStatus('ok', tr('queryConsole.ran', 'Ran — {rows} in {ms} ms', { rows: nrows, ms: RK.format(res.ms, '0.0') }));
        result = res;
        paintResults(opts.rerun);
        if (!opts.silent && !opts.rerun) {
          runBtn.classList.remove('is-pulse');
          void runBtn.offsetWidth;
          if (ctx.motion) runBtn.classList.add('is-pulse');
        }
      }

      /* ---------------- results ---------------- */
      function sortedRows() {
        var rows = result.rows.slice();
        if (st.tsort) {
          var k = st.tsort.col, dir = st.tsort.dir === 'asc' ? 1 : -1;
          rows.sort(function (a, b) {
            var x = a[k], y = b[k];
            if (x == null || (typeof x === 'number' && isNaN(x))) return 1;
            if (y == null || (typeof y === 'number' && isNaN(y))) return -1;
            return (typeof x === 'string' ? x.localeCompare(String(y)) : x - y) * dir;
          });
        }
        return rows;
      }
      function isHi(r) {
        if (!highlights.length) return false;
        for (var k in r) if (typeof r[k] === 'string' && highlights.indexOf(r[k].toLowerCase()) >= 0) return true;
        return false;
      }
      function metricCandidates() {
        if (!o.addMetric || !result || result.aggregate) return [];
        var ds = RK.data.get(result.dataset);
        return (result.spec.select || []).filter(function (it) {
          if (!it.expr || it.expr === '*') return false;
          try {
            var c = RK.expr.compile(it.expr, { fields: ds.fields });
            return !c.aggregate && c.ast.type !== 'field' && c.ast.type !== 'lit' && c.fields.length > 0;
          } catch (e) { return false; }
        });
      }
      function activeFilters() {
        var ds = RK.data.get(result.dataset), fs = RK.store.filters();
        return Object.keys(fs).filter(function (k) { return fs[k].source !== ctx.id && RK.data.applies(fs[k], ds); });
      }

      function paintResults(rerun) {
        var ds = RK.data.get(result.dataset);
        result.columns.forEach(function (c) { c.title = prettyTitle(c, ds); });
        var rows = sortedRows();
        // header
        resHead.innerHTML = '';
        var nf = activeFilters();
        resHead.appendChild(h('div.rk-qc-rh__meta',
          h('strong.rk-num', RK.format(result.rows.length, '#,##0')), ' ' + tr(result.rows.length === 1 ? 'queryConsole.rowsUnit.one' : 'queryConsole.rowsUnit', result.rows.length === 1 ? 'row' : 'rows'),
          h('span.rk-qc-dot', '·'), countText('queryConsole.nCols', result.columns.length, '{n} col', '{n} cols'),
          h('span.rk-qc-dot.rk-qc-rh__time', '·'), h('span.rk-num.rk-qc-rh__time', tr('queryConsole.ms', '{n} ms', { n: RK.format(result.ms || 0, '0.0') })),
          nf.length ? h('span.rk-qc-badge', { title: tr('queryConsole.respects', 'Results respect the report filters: {list}', { list: nf.join(', ') }) }, h('span', { html: icon('filter', 11) }), countText('queryConsole.nFilters', nf.length, '{n} global filter', '{n} global filters')) : null,
          h('span.rk-qc-rh__note')));
        resHead.appendChild(h('span.rk-qc__spacer'));
        // on paper the editor is hidden: the query that produced these results is printed above them instead
        if (st.last && st.last.text) resHead.appendChild(h('code.rk-qc-rh__q', { html: highlight(st.last.text, ds, null, -1) }));
        var viewSeg = h('div.rk-seg.rk-qc-seg', { role: 'group', 'aria-label': tr('queryConsole.resultView', 'Result view') }, [['split', tr('queryConsole.split', 'Split')], ['table', tr('queryConsole.table', 'Table')], ['chart', tr('queryConsole.chart', 'Chart')]].map(function (v) {
          return h('button', { type: 'button', class: st.view === v[0] ? 'is-on' : null, 'aria-pressed': st.view === v[0] ? 'true' : 'false', on: { click: function () { st.view = v[0]; paintResults(true); } } }, v[1]);
        }));
        resHead.appendChild(viewSeg);
        var cands = metricCandidates();
        if (cands.length) {
          var addBtn = h('button.rk-btn.rk-qc-mbtn', { type: 'button', title: tr('queryConsole.saveFormula', 'Save a formula column as a new field of {dataset}', { dataset: ds.title }), on: { click: function () { openAddMetric(addBtn, cands); } } },
            h('span', { html: icon('metric', 13) }), tr('addAsMetric', 'Add as metric'));
          resHead.appendChild(addBtn);
        }
        resHead.appendChild(h('button.rk-btn.rk-qc-csv', { type: 'button', title: tr('queryConsole.csvTitle', 'Download all result rows as CSV'), on: { click: exportCSV } }, h('span', { html: icon('download', 13) }), 'CSV'));

        resBody.className = 'rk-qc-rb is-' + st.view;
        paintTable(rows);
        if (st.view !== 'table' && o.chart !== 'none') paintChart(rows, rerun);
        else if (chart) chart.resize();
      }

      function paintTable(rows) {
        var cols = result.columns;
        var max = o.maxRows || 500;
        var thead = h('thead', h('tr', cols.map(function (c) {
          var num = c.type === 'number';
          var on = st.tsort && st.tsort.col === c.name;
          return h('th', {
            class: (num ? 'is-num ' : '') + 'is-sortable' + (on ? ' is-sorted' : ''), scope: 'col', tabindex: '0',
            'aria-sort': on ? (st.tsort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
            on: {
              click: function () { sortBy(c); },
              keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c); } }
            }
          }, h('span', c.title), h('span.rk-sort', on ? (st.tsort.dir === 'asc' ? '▲' : '▼') : ''));
        })));
        var tbody = h('tbody', rows.slice(0, max).map(function (r) {
          return h('tr', { class: isHi(r) ? 'is-target' : null }, cols.map(function (c) {
            var v = r[c.name], num = typeof v === 'number';
            return h('td', { class: (c.type === 'number' || num ? 'is-num' : '') + (num && v < 0 ? ' is-neg' : '') }, Array.isArray(v) ? v.join(', ') : RK.format(v, c.format));
          }));
        }));
        tableWrap.innerHTML = '';
        if (!rows.length) { tableWrap.appendChild(h('div.rk-qc-empty', tr('queryConsole.noRows', 'No rows match — check the "where" clause or the report filters.'))); return; }
        tableWrap.appendChild(h('table.rk-table.rk-qc-tbl', thead, tbody));
        if (rows.length > max) tableWrap.appendChild(h('p.rk-qc-more', tr('queryConsole.showingFirst', 'Showing first {max} of {n} rows — CSV exports all.', { max: RK.format(max, '#,##0'), n: RK.format(rows.length, '#,##0') })));
        snapTable();
      }
      /**
       * The table pane ends on a row boundary (no half-cut last row); highlighted rows below the fold stay
       * pinned to the bottom edge (CSS sticky) so the target is always visible next to its chart bar.
       */
      function snapTable() {
        tableWrap.style.maxHeight = '';
        var tbl = tableWrap.querySelector('table');
        if (!tbl || !tableWrap.clientHeight || tbl.offsetHeight <= tableWrap.clientHeight + 1) return;
        var H = tableWrap.clientHeight, rws = tbl.tBodies[0].rows, best = 0;
        for (var i = 0; i < rws.length; i++) {
          var b = rws[i].offsetTop + rws[i].offsetHeight;
          if (b > H + 0.5) break;
          best = b;
        }
        if (best) tableWrap.style.maxHeight = (best + (tableWrap.offsetHeight - tableWrap.clientHeight)) + 'px';
      }
      function sortBy(c) {
        var cur = st.tsort && st.tsort.col === c.name ? st.tsort.dir : null;
        st.tsort = cur === 'desc' ? { col: c.name, dir: 'asc' } : cur === 'asc' ? null : { col: c.name, dir: c.type === 'number' ? 'desc' : 'asc' };
        if (cur === null && c.type !== 'number') st.tsort.dir = 'asc';
        paintResults(true);
      }

      /* ---------------- auto chart ---------------- */
      // bar  : one category column (horizontal ranking when labels are long / many; side-by-side
      //        panels when the measures have different units — the pitchbook "comps bar" layout)
      // line : category looks like a year / date; short annual series with mixed units become the
      //        classic columns + line combo (e.g. revenue bars + margin line on the right axis)
      var lastRows = null, panelMode = false;
      /** Axis ticks in the column format, without decimals on whole ticks ($#,##0.0 -> $4,000; 0.0x -> 10x; 2.5x stays). */
      function axisFmt(fmt) {
        var code = String(RK.format.presets[fmt] || fmt || 'auto');
        var whole = RK.format.decimals(code) ? code.replace(/\.[0#]+/g, '') : null;
        var zeros = new RegExp('\\' + RK.format.config.decimal + '0+(?!\\d)');
        return function (v) {
          var full = RK.format(v, code);
          return whole && zeros.test(full) ? RK.format(v, whole) : full;
        };
      }
      function isEstimate(c) { return typeof c === 'string' && /\d{2}\s?[EFPB]$/i.test(c.trim()); }
      function paintChart(rows, rerun) {
        lastRows = rows;
        var cols = result.columns;
        var dims = cols.filter(function (c) { return rows.some(function (r) { return r[c.name] != null && typeof r[c.name] !== 'number'; }) || (c.type !== 'number' && c.type !== undefined && !rows.some(function (r) { return isNum(r[c.name]); })); });
        var meas = cols.filter(function (c) { return dims.indexOf(c) < 0 && rows.some(function (r) { return isNum(r[c.name]); }); });
        // a numeric year column (fiscal_year) is a category, not a measure, when it is the first column
        if (!dims.length && meas.length > 1 && rows.every(function (r) { return isTimeLike(r[meas[0].name]); })) dims = [meas.shift()];
        chartMsg.innerHTML = '';
        chartWrap.classList.remove('has-msg', 'has-kpi');
        panelMode = false;
        st.chartNote = '';
        if (!rows.length || !meas.length) return chartMessage(!rows.length ? tr('queryConsole.nothingToChart', 'Nothing to chart') : tr('queryConsole.noNumeric', 'No numeric column to chart'));
        if (!dims.length) {
          if (rows.length === 1) return chartKpi(rows[0], meas);
          var lab = dimFields(DS())[0];
          return chartMessage(tr('queryConsole.addLabel', 'Add a label column (e.g. {name}) to chart these values', { name: lab ? lab.name : 'company' }));
        }
        var x = dims[0];
        var sdim = dims.length > 1 && meas.length === 1 ? dims[1] : null;
        var cats = RK.util.unique(rows.map(function (r) { return r[x.name]; }));
        var timeLike = cats.length > 1 && cats.every(isTimeLike);
        var kinds = RK.util.unique(meas.map(function (m) { return fmtKind(m.format); }));
        var combo = timeLike && !sdim && kinds.length > 1 && cats.length <= 15 && o.chart !== 'line';
        var kind = o.chart === 'bar' || o.chart === 'line' ? o.chart : (timeLike && !combo ? 'line' : 'bar');
        if (timeLike && !st.tsort) cats.sort(function (a, b) { return String(a).localeCompare(String(b)); });
        // braces in data would start ECharts rich-text runs in axis / point labels
        var catLabels = cats.map(function (c) { return c == null ? RK.format(null) : RK.chart.richSafe(RK.format(c, x.format)); });
        var labelLen = Math.max.apply(null, catLabels.map(function (c) { return c.length; }));
        var horiz = kind === 'bar' && !timeLike && (cats.length > 7 || labelLen > 11);
        function byCat(list, field) {
          var mp = new Map();
          list.forEach(function (r) { if (!mp.has(r[x.name])) mp.set(r[x.name], r[field]); });
          return cats.map(function (c) { return mp.has(c) ? mp.get(c) : null; });
        }
        function valueOf(p) { return p && typeof p === 'object' && 'value' in p ? p.value : p; }
        function barData(values, color, single) {
          return values.map(function (v, i) {
            var c = color;
            if (single && highlights.indexOf(String(cats[i]).toLowerCase()) >= 0) c = t.accent2;
            if (isEstimate(cats[i])) c = RK.theme.mix(c, t.paper, 0.42);    // projected periods in a lighter shade
            return { value: v, itemStyle: { color: c } };
          });
        }
        function labelCfg(fmt, pos) {
          return { show: true, position: pos, distance: 4, color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum, formatter: function (p) { return RK.format(valueOf(p.value), fmt); } };
        }
        var opt, dropped = 0;
        // series colours kept clear of accent-2 (the highlighted target) and of pos / neg (red / green mean change)
        var pal = seriesPalette(8);

        if (horiz && !sdim) {
          // ---- side-by-side horizontal panels sharing the category axis ----
          var panels = meas.slice(0, 3);
          dropped = meas.length - panels.length;
          // "Median EV/EBITDA 2025E" + "Median EBITDA margin" -> drop the shared aggregation word in panel titles
          // (zh: the shared 中位数 suffix of "EV/EBITDA 2025E中位数")
          var shared = panels.length > 1 ? sharedAgg(panels.map(function (p) { return String(p.title); })) : null;
          function panelTitle(p) { var s2 = String(p.title); return shared ? s2.slice(shared[0].length, s2.length - shared[1].length) : p.title; }
          var W = chartHost.clientWidth || 420;
          var labelW = Math.min(170, Math.max(70, labelLen * 6.3 + 14));
          var valPad = cats.length <= 24 ? 40 : 10, gap = 14, MINW = 60;
          // fit: shrink the label column first (labels truncate), then drop panels that still do not fit
          var fits = function (k, lw) { return (W - lw - k * valPad - (k - 1) * gap) / k >= MINW; };
          while (panels.length > 1 && !fits(panels.length, 90)) { panels.pop(); dropped++; }
          if (!fits(panels.length, labelW)) labelW = Math.max(90, W - panels.length * (MINW + valPad) - (panels.length - 1) * gap);
          var n = panels.length;
          panelMode = n > 1;
          var pw = Math.max(40, (W - labelW - n * valPad - (n - 1) * gap) / n);
          var top = n > 1 ? 24 : 8;
          var showVals = cats.length <= 24;
          opt = {
            animation: ctx.motion, color: pal,
            title: n > 1 ? panels.map(function (p, i) {
              return { text: panelTitle(p), left: labelW + i * (pw + valPad + gap), top: 2, textStyle: { fontSize: 11, fontWeight: 600, color: t.ink2, fontFamily: t.fontSans, width: pw + valPad - 8, overflow: 'truncate' } };
            }) : [],
            grid: panels.map(function (p, i) { return { left: labelW + i * (pw + valPad + gap), width: pw, top: top, bottom: n > 1 && showVals ? 6 : 22, containLabel: false }; }),
            tooltip: {
              trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
              formatter: function (ps) {
                if (!ps.length) return '';
                var i = ps[0].dataIndex, r = rows.filter(function (row) { return row[x.name] === cats[i]; })[0] || {};
                return RK.chart.tip(catLabels[i], panels.map(function (p, k) { return { color: k === 0 ? undefined : null, label: p.title, value: RK.format(r[p.name], p.format) }; }));
              }
            },
            xAxis: panels.map(function (p, i) {
              // labelled panels need no value axis (think-cell style); a single ranking keeps it
              var bare = n > 1 && showVals;
              return { type: 'value', gridIndex: i, splitNumber: n > 1 ? 3 : 5, axisLabel: { show: !bare, formatter: axisFmt(p.format), hideOverlap: true }, splitLine: { show: !bare, lineStyle: { color: t.grid } } };
            }),
            yAxis: panels.map(function (p, i) {
              return { type: 'category', gridIndex: i, data: catLabels, inverse: true, axisTick: { show: false },
                axisLabel: { show: i === 0, interval: 0, width: labelW - 12, overflow: 'truncate', color: t.ink2 } };
            }),
            series: panels.map(function (p, i) {
              return {
                name: p.title, type: 'bar', xAxisIndex: i, yAxisIndex: i, barMaxWidth: 26, barCategoryGap: '32%',
                data: barData(byCat(rows, p.name), pal[0], true),     // one colour: panels are labelled, accent-2 stays for the target
                label: showVals ? labelCfg(p.format || 'auto', 'right') : { show: false },
                emphasis: { focus: 'none' }
              };
            })
          };
        } else {
          // ---- vertical bars / lines / combo, optional right axis for a second unit ----
          var primaryKind = fmtKind(meas[0].format), secondary = null, plotted = [];
          meas.forEach(function (m) {
            var k = fmtKind(m.format);
            if (k === primaryKind && plotted.length < 4) plotted.push({ col: m, axis: 0 });
            else if (!horiz && !sdim && (!secondary || secondary === k) && plotted.length < 4) { secondary = k; plotted.push({ col: m, axis: 1 }); }
            else dropped++;
          });
          var series = [], legend = [];
          var single = !sdim && plotted.length === 1;
          var nBars = sdim ? 1 : plotted.filter(function (p) { return kind === 'bar' && p.axis === 0; }).length;
          var hasRight = plotted.some(function (p) { return p.axis === 1; });
          var barLabels = kind === 'bar' && cats.length <= 24 && (nBars === 1 || (!hasRight && nBars <= 2 && cats.length <= 8));
          var lineLabels = cats.length <= 15 && (kind === 'bar' ? hasRight : plotted.length <= 2);
          var showLabels = barLabels || lineLabels;
          if (sdim) {
            var groups = RK.util.groupBy(rows, function (r) { return r[sdim.name]; }), gi = 0;
            var gpal = seriesPalette(groups.size);   // extended with tints instead of repeating
            groups.forEach(function (list, name) {
              legend.push(RK.chart.richSafe(name));
              series.push(mk(RK.chart.richSafe(name), byCat(list, meas[0].name), meas[0], 0, gpal[gi++], kind, false));
            });
          } else {
            plotted.forEach(function (p, i) {
              var asLine = kind === 'line' || p.axis === 1;
              var color = pal[i % pal.length];
              legend.push(p.col.title);
              series.push(mk(p.col.title, byCat(rows, p.col.name), p.col, p.axis, color, asLine ? 'line' : 'bar', single));
            });
          }
          function mk(name, values, col, axis, color, type, isSingle) {
            var fmt = col.format || 'auto';
            var se = {
              name: name, type: type, yAxisIndex: horiz ? 0 : axis,
              data: type === 'bar' ? barData(values, color, isSingle) : values,
              itemStyle: { color: color }, lineStyle: { color: color, width: 2 }, emphasis: { focus: 'series' },
              label: (type === 'bar' ? barLabels : lineLabels) ? labelCfg(fmt, type === 'bar' ? (horiz ? 'right' : 'top') : 'top') : { show: false }
            };
            if (type === 'bar') { se.barMaxWidth = 34; se.barGap = '12%'; se.barCategoryGap = isSingle ? '36%' : '28%'; }
            else { se.symbol = 'circle'; se.symbolSize = cats.length > 30 ? 0 : 6; se.showSymbol = cats.length <= 30; se.z = 3; }
            return se;
          }
          var p1 = plotted.filter(function (p) { return p.axis === 1; })[0];
          var catAxis = { type: 'category', data: catLabels, inverse: horiz, boundaryGap: kind === 'bar',
            axisLabel: horiz ? { interval: 0, hideOverlap: true, width: 150, overflow: 'truncate' } : { interval: cats.length <= 16 ? 0 : 'auto', hideOverlap: true } };
          // narrow charts: "2019A" -> "19A" so every period keeps its label (tooltips show the full label)
          var slot = ((chartHost.clientWidth || 400) - 90) / Math.max(1, cats.length);
          if (!horiz && slot < labelLen * 6.4 + 8 && catLabels.every(function (c) { return /^(FY)?\d{4}[A-Z]?$/.test(c); })) {
            catAxis.axisLabel.formatter = function (v) { return String(v).replace(/^(FY)?\d{2}(\d{2})/, '$2'); };
          }
          if (!horiz && cats.length <= 40) {
            var lfmt = catAxis.axisLabel.formatter || function (v) { return v; };
            var lblW = Math.max.apply(null, catLabels.map(function (c) { return RK.chart.measure(lfmt(c), '11px ' + t.fontSans); })) + 10;
            var slotW = ((chartHost.clientWidth || 400) - 70) / Math.max(1, cats.length), nC = cats.length;
            var every = Math.max(1, Math.ceil(lblW / slotW));
            catAxis.axisLabel.hideOverlap = false;
            catAxis.axisLabel.interval = every === 1 ? 0 : function (i) { return (nC - 1 - i) % every === 0; };
          }
          var valAxis = [{ type: 'value', scale: kind === 'line' && primaryKind !== 'num', axisLabel: { formatter: axisFmt(plotted[0] ? plotted[0].col.format : meas[0].format) }, splitLine: { lineStyle: { color: t.grid } } }];
          // columns + a second-unit line: stacked panels (stackedCombo below); two-unit lines: a labelled right axis
          if (p1 && kind !== 'bar') valAxis.push({ type: 'value', scale: true, position: 'right', axisLabel: { formatter: axisFmt(p1.col.format) }, splitLine: { show: false } });
          // long series: Ctrl/Cmd + wheel or pinch zooms (plain wheel scrolls the report), slider on screen only
          var zoom = kind === 'line' && cats.length > 40 ? RK.chart.zoom(ctx, 'x', { height: 16 }) : [];
          var slider = zoom.some(function (z) { return z.type === 'slider'; });
          var showLegend = legend.length > 1;
          if (p1 && kind === 'bar') opt = stackedCombo();
          else opt = {
            animation: ctx.motion, color: pal,
            legend: RK.chart.legend(ctx, { show: showLegend, data: legend }),
            grid: { left: 4, right: p1 && kind !== 'bar' ? 8 : (horiz && showLabels ? 36 : 16), top: showLegend ? 34 : 14, bottom: slider ? 28 : 4, containLabel: true },
            tooltip: {
              trigger: 'axis', axisPointer: { type: kind === 'bar' ? 'shadow' : 'line' }, confine: true,
              formatter: function (ps) {
                if (!ps.length) return '';
                var i = ps[0].dataIndex;
                return RK.chart.tip(catLabels[i], ps.map(function (p) {
                  var col = sdim ? meas[0] : (plotted[p.seriesIndex] || plotted[0]).col;
                  return { color: p.color, label: p.seriesName, value: RK.format(valueOf(p.value), col.format) };
                }), isEstimate(cats[i]) ? tr('queryConsole.estimate', 'Estimate') : null);
              }
            },
            xAxis: horiz ? valAxis[0] : catAxis,
            yAxis: horiz ? catAxis : valAxis,
            dataZoom: zoom,
            series: series
          };

          /**
           * Columns + a second-unit line (revenue bars + margin %): two stacked panels sharing the periods, each
           * with its own readable scale (a % line on a $ axis would be misleading). Line labels thin out on
           * narrow charts (every other point, or first / last), always keeping the last period.
           */
          function stackedCombo() {
            var W = chartHost.clientWidth || 400, H = chartHost.clientHeight || 300;
            var barCols = plotted.filter(function (p) { return p.axis === 0; }), lineCols = plotted.filter(function (p) { return p.axis === 1; });
            var bFmt = axisFmt(barCols[0].col.format), lFmt = axisFmt(lineCols[0].col.format);
            var bVals = [], lVals = [];
            barCols.forEach(function (p) { byCat(rows, p.col.name).forEach(function (v) { if (isNum(v)) bVals.push(v); }); });
            lineCols.forEach(function (p) { byCat(rows, p.col.name).forEach(function (v) { if (isNum(v)) lVals.push(v); }); });
            var font = '11px ' + t.fontNum, bx = RK.util.extent(bVals.length ? bVals : [0]), lx = RK.util.extent(lVals.length ? lVals : [0]);
            var gutter = Math.ceil(Math.max(RK.chart.measure(bFmt(bx[1] * 1.15), font), RK.chart.measure(bFmt(bx[0]), font),
              RK.chart.measure(lFmt(lx[1]), font), RK.chart.measure(lFmt(lx[0]), font))) + 12;
            var legendH = showLegend ? 28 : 4, xLab = 22, gap = 26;
            var plotH = Math.max(120, H - legendH - xLab - gap);
            var topH = Math.max(66, Math.round(plotH * 0.36));
            // % panel scale: three or four round ticks with head-room for the point labels
            var lSpan = (lx[1] - lx[0]) || Math.abs(lx[1]) || 1, lStep = RK.util.niceStep(lSpan * 1.5, 2);
            var lMin = Math.floor((lx[0] - lSpan * 0.15) / lStep) * lStep, lMax = Math.ceil((lx[1] + lSpan * 0.3) / lStep) * lStep;
            if (lx[0] >= 0 && lMin < 0) lMin = 0;
            var plotW = Math.max(60, W - gutter - 10), slotW = plotW / Math.max(1, cats.length), nC = cats.length;
            // point labels: all when they fit, else every other (counted from the last), else first + last
            var lw = 0;
            lineCols.forEach(function (p) { byCat(rows, p.col.name).forEach(function (v) { if (isNum(v)) lw = Math.max(lw, RK.chart.measure(RK.format(v, p.col.format || 'auto'), '10.5px ' + t.fontNum)); }); });
            var step = slotW >= lw + 6 ? 1 : slotW * 2 >= lw + 6 ? 2 : 0;
            function showAt(i) { return step === 1 || (step === 2 ? (nC - 1 - i) % 2 === 0 : i === 0 || i === nC - 1); }
            series.forEach(function (se, i) {
              var p = plotted[i];
              if (p.axis === 1) {
                se.xAxisIndex = 0; se.yAxisIndex = 0;
                var fmt = p.col.format || 'auto';
                se.label = { show: lineLabels, position: 'top', distance: 5, color: t.ink2, fontSize: 10.5, fontFamily: t.fontNum,
                  formatter: function (q) { return showAt(q.dataIndex) ? RK.format(valueOf(q.value), fmt) : ''; } };
                se.labelLayout = { hideOverlap: true };
              } else { se.xAxisIndex = 1; se.yAxisIndex = 1; }
            });
            var bottomAxis = RK.util.merge({}, catAxis, { gridIndex: 1 });
            return {
              animation: ctx.motion, color: pal,
              legend: RK.chart.legend(ctx, { show: showLegend, data: legend }),
              axisPointer: { link: [{ xAxisIndex: 'all' }] },
              grid: [
                { left: gutter, right: 10, top: legendH + 12, height: topH - 12, containLabel: false },
                { left: gutter, right: 10, top: legendH + topH + gap, bottom: xLab, containLabel: false }
              ],
              tooltip: {
                trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
                formatter: function (ps) {
                  if (!ps.length) return '';
                  var i = ps[0].dataIndex;
                  return RK.chart.tip(catLabels[i], plotted.map(function (p, k) {
                    return { color: pal[k % pal.length], label: p.col.title, value: RK.format(byCat(rows, p.col.name)[i], p.col.format) };
                  }), isEstimate(cats[i]) ? tr('queryConsole.estimate', 'Estimate') : null);
                }
              },
              xAxis: [
                { type: 'category', gridIndex: 0, data: catLabels, boundaryGap: true, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
                bottomAxis
              ],
              yAxis: [
                { type: 'value', gridIndex: 0, min: +lMin.toFixed(10), max: +lMax.toFixed(10), interval: lStep,
                  axisLabel: { formatter: lFmt, fontSize: 11, color: t.ink3 }, splitLine: { lineStyle: { color: t.grid } } },
                { type: 'value', gridIndex: 1, axisLabel: { formatter: bFmt, fontSize: 11, color: t.ink3 }, splitLine: { lineStyle: { color: t.grid } } }
              ],
              series: series
            };
          }
        }
        var key = (opt.grid.length || 1) + '|' + horiz + '|' + kind + '|' + (opt.yAxis.length || 1) + '|' + opt.series.length;
        // ECharts' own strings (aria descriptions) follow the report language, like RK.chart()
        if (opt.aria === undefined && o.aria !== false) opt.aria = { enabled: true, decal: { show: false } };
        if (!chart) {
          chart = window.echarts.init(chartHost, 'rk', { renderer: 'svg', locale: RK.i18n && RK.i18n.lang && RK.i18n.lang() === 'zh' ? 'ZH' : 'EN' });
          wheel = wheelGuard(chartHost, o);
          ro = 'ResizeObserver' in window ? new ResizeObserver(RK.util.rafThrottle(function () {
            if (!chart) return;
            if (panelMode && lastRows) paintChart(lastRows, true); else chart.resize();
          })) : null;
          if (ro) ro.observe(chartHost);
        }
        chart.resize();
        wheel.adapt(opt);
        if (key !== chartKey) chart.setOption(opt, { notMerge: true });
        else chart.setOption(opt, { replaceMerge: ['series', 'xAxis', 'yAxis', 'legend', 'dataZoom', 'grid', 'title'] });
        chartKey = key;
        if (dropped) st.chartNote = countText('queryConsole.notCharted', dropped, '{n} column not charted (other units)', '{n} columns not charted (other units)');
        var note = resHead.querySelector('.rk-qc-rh__note');
        if (note) note.textContent = st.chartNote ? '· ' + st.chartNote : '';
      }
      function chartMessage(text) {
        if (chart) { chart.clear(); chartKey = null; }
        chartWrap.classList.add('has-msg');
        chartMsg.appendChild(h('div.rk-qc-chart__empty', text));
      }
      function chartKpi(row, meas) {
        if (chart) { chart.clear(); chartKey = null; }
        chartWrap.classList.add('has-kpi');
        var grid = h('div.rk-qc-kpis');
        meas.forEach(function (m) {
          var val = h('div.rk-qc-kpi__v.rk-num');
          grid.appendChild(h('div.rk-qc-kpi', h('div.rk-qc-kpi__k', m.title), val));
          RK.motion.countUp(val, row[m.name], { format: m.format || 'auto', animate: ctx.motion, duration: 700 });
        });
        chartMsg.appendChild(grid);
      }

      /* ---------------- CSV / add metric ---------------- */
      function exportCSV() {
        if (!result) return;
        var csv = RK.Dataset.prototype.toCSV.call({}, sortedRows(), result.columns);
        RK.util.download((result.dataset || 'query') + '-query.csv', csv, 'text/csv;charset=utf-8');
      }
      function openAddMetric(anchor, cands) {
        var ds = RK.data.get(result.dataset);
        var chosen = cands[0];
        var nameIn = h('input.rk-input.rk-qc-mono', { type: 'text', spellcheck: 'false', 'aria-label': tr('queryConsole.fieldName', 'Field name') });
        var titleIn = h('input.rk-input', { type: 'text', 'aria-label': tr('queryConsole.title', 'Title') });
        var fmtIn = h('input.rk-input.rk-qc-mono', { type: 'text', spellcheck: 'false', placeholder: '0.0x', 'aria-label': tr('queryConsole.format', 'Format') });
        var preview = h('div.rk-qc-am__preview.rk-num');
        var msg = h('div.rk-qc-am__msg');
        function fill(it) {
          chosen = it;
          var title = it.as || it.expr;
          titleIn.value = title;
          var base = slug(it.as || it.expr), name = base, n = 2;
          while (ds.field(name) && !ds.field(name).computed) name = base + '_' + (n++);
          nameIn.value = name;
          fmtIn.value = it.format || guessFormat(it.expr) || '';
          paintPreview();
        }
        function guessFormat(expr) {
          try {
            var c = RK.expr.compile(expr, { fields: ds.fields });
            var fs = c.fields.map(function (f) { return ds.field(f) && ds.field(f).format; });
            if (/\//.test(expr) && fs.length >= 2 && fs[0] && fs[0] === fs[1]) return fmtKind(fs[0]) === 'num' ? '0.0x' : null;
            return fs[0] || null;
          } catch (e) { return null; }
        }
        function paintPreview() {
          var vals;
          try {
            var c = RK.expr.compile(chosen.expr, { fields: ds.fields });
            vals = ds.rows.slice(0, 4).map(function (r) { return RK.format(c.eval(r, { params: RK.store.params() }), fmtIn.value || 'auto'); });
          } catch (e) { vals = []; }
          preview.textContent = vals.length ? tr('queryConsole.preview', 'Preview: {list}', { list: vals.join('  ·  ') + '  …' }) : '';
        }
        fmtIn.addEventListener('input', paintPreview);
        var choice = cands.length > 1 ? h('div.rk-qc-am__choice', cands.map(function (it, i) {
          var id = ctx.id + '-am-' + i;
          var radio = h('input', { type: 'radio', name: ctx.id + '-am', id: id, checked: i === 0, on: { change: function () { fill(it); } } });
          return h('label.rk-qc-am__opt', { for: id }, radio, h('code', it.expr), it.as ? h('span', it.as) : null);
        })) : h('code.rk-qc-am__expr', chosen.expr);
        var addBtn = h('button.rk-btn.rk-btn--primary', { type: 'button', on: { click: function () {
          var name = nameIn.value.trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { msg.textContent = tr('queryConsole.badName', 'Name must start with a letter and use letters, digits or _'); return; }
          if (ds.field(name) && !ds.field(name).computed) { msg.textContent = tr('queryConsole.sourceField', '"{name}" is already a source field of {dataset}', { name: name, dataset: ds.id }); return; }
          var title = titleIn.value.trim() || name;
          try {
            // user: true — RK.data keeps it in this browser for this report and restores it on the next visit
            ds.addComputed({ name: name, formula: chosen.expr, title: title, format: fmtIn.value.trim() || null, user: true });
          } catch (e) { msg.textContent = e.message; return; }
          p.close();
          paintRef();
          setStatus('ok', tr('queryConsole.metricAddedLong', 'Added “{title}” as field {name} to {dataset} — every block using it can now use it; saved in this browser', { title: title, name: name, dataset: ds.title }));
        } } }, tr('queryConsole.addTo', 'Add to {dataset}', { dataset: ds.id }));
        var form = h('div.rk-qc-am',
          h('div.rk-qc-am__title', tr('queryConsole.addFormula', 'Add formula as a dataset field')),
          choice,
          h('div.rk-qc-am__grid',
            h('label', h('span', tr('queryConsole.title', 'Title')), titleIn),
            h('label', h('span', tr('queryConsole.fieldName', 'Field name')), nameIn),
            h('label', h('span', tr('queryConsole.format', 'Format')), fmtIn)),
          preview, msg,
          h('div.rk-qc-am__foot', h('span.rk-muted', tr('queryConsole.liveNote', 'Recalculates live (incl. @parameters) · saved in this browser')), addBtn));
        var p = track(popover(anchor, form, { minWidth: 360, align: 'right' }));
        fill(chosen);
        titleIn.focus();
        titleIn.select();
      }

      /* ---------------- wiring / first paint ---------------- */
      var onData = RK.util.debounce(function (e) {
        if (!alive) return;
        paintRef();
        paintDataset();
        if (st.tab === 'builder') paintBuilder();
        if (result && (!e || !e.dataset || e.dataset === result.dataset)) runText(st.last.text, { silent: true, rerun: true, keepSort: true });
      }, 40);
      var offData = RK.bus.on('data:changed', onData);

      paintDataset();
      paintBuilder();
      paintRef();
      paintExamples();
      setTab(st.tab);
      setRef(st.refOpen);
      autosize();
      paintMirror();
      if (st.last) runText(st.last.text, { silent: true, rerun: true, keepSort: true });
      else if (st.tab === 'builder' || !st.text) runText(genQuery(st.builder, st.ds), { silent: true });
      else runText(st.text, { silent: true });
      if (st.tab === 'query') runValidation();

      return {
        update: function (c) { ctx = c; },
        onStore: function (changes) {
          if (!alive) return;
          var params = changes.some(function (ch) { return ch.type === 'param'; });
          if (params) paintRef();
          if (!result) return;
          var ds = RK.data.get(result.dataset);
          // re-run when a global filter touches the dataset, or a parameter used by the query / its fields changes
          if ((ds && RK.data.affected(ds, changes)) || (params && /@/.test(st.last.text))) runText(st.last.text, { silent: true, rerun: true, keepSort: true });
        },
        // the chart layout depends on its size (panel widths, stacked-combo heights, label thinning): repaint it, e.g. when
        // print lays the results out over the whole block
        resize: function () {
          var plain = chartWrap.classList.contains('has-msg') || chartWrap.classList.contains('has-kpi');
          if (chart && result && lastRows && !plain && st.view !== 'table' && o.chart !== 'none') paintChart(lastRows, true);
          else if (chart) chart.resize();
          snapTable(); refEdge();
        },
        exportImage: function () {
          if (!chart || st.view === 'table') return null;
          return chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: t.paper });
        },
        destroy: function () {
          alive = false;
          clearTimeout(valTimer); clearTimeout(autoTimer);
          offData();
          closeAc();
          pops.forEach(function (p) { p.close(); });
          if (ro) ro.disconnect();
          if (wheel) wheel.destroy();
          if (chart) { chart.dispose(); chart = null; }
          root.remove();
        }
      };
    }
  });
})();
