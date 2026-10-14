# ReportKit 架构与契约 (Architecture & Contracts)

> 本文件是所有组件、Python 构建器和 gallery 网站共同遵守的**契约**。改动契约前先改这里。

## 1. 目标

- 投行交付给客户的交互式报告：Python/SQL 跑出 metrics → Python builder 生成一个**自包含文件夹**。
- **HTML / CSS / JS / DATA 严格分离**；数据独立成文件，将来可替换为数据 API。
- **离线可用**：双击 `index.html`（`file://`）即可打开；不依赖 CDN；所有脚本是 classic script（非 ES module）。
- 视觉质感对标 GS / JPM pitchbook：16:9 页面、action title、footnote / source、克制的配色和动效。
- 交互：缩放（dataZoom / 地图缩放）、全局筛选 + 交叉筛选、指标 / 维度切换、参数 what-if、客户自定义指标与查询。
- 交付变体：文件夹（默认）、单文件 HTML、Excel 底稿、数据 API 模式（§3.1）；界面语言与涨跌色随报告切换（§7.5）。

## 2. 仓库结构

```
kit/                      前端框架（源码，唯一事实来源）
  core/                   rk.core（含 RK.i18n）/ rk.format / rk.expr / rk.data / rk.theme / rk.chart / rk.geo / rk.motion / rk.runtime
                          （kit/build.json 定义拼接顺序）
  styles/                 tokens.css, base.css, layout.css, components.css, print.css, themes/*.css
  components/<id>/        <id>.js  (+ <id>.css)  + manifest.json      ← 每个组件一个目录（57 个）
  categories.json         12 个类别（显示顺序）；catalog.json 由 tools/build_catalog.py 从全部 manifest 生成
  samples/datasets/       gallery 与 demo 共用的示例数据（数据契约格式，41 个，由 tools/make_sample_data.py 生成）
vendor/                   第三方库 dist 构建（npm 固定版本 + LICENSE + sha256），由 tools/vendor.py 生成与校验
gallery/                  组件网站（分门别类展示、说明、可交互 demo）
py/reportkit/             Python 构建器：DataFrame/records → 报告文件夹 / 单文件 HTML / Excel
examples/                 生成好的示例报告（demo-pitchbook、demo-zh-cn、sql-pipeline-report）
research/                 调研报告（landscape.md, catalog.json, raw/*.md, engine-audit.md）
tools/                    vendor.py, build_catalog.py, build_geo.py, make_sample_data.py, smoke.cjs, thumbs.cjs, check.sh
tests/                    js（node）+ py（unittest）+ e2e（Playwright：示例报告与 gallery）
```

## 3. 报告输出文件夹（builder 产物）

```
<report>/
  index.html                    只有版式与绑定（哪个组件、绑定哪个 dataset、options）
  assets/
    css/reportkit.css           tokens + base + layout + components + print + 所有主题 + 已用组件 css
    js/reportkit.js             kit/core/* 按顺序拼接
    js/components/<id>.js       仅包含本报告用到的组件
    vendor/<id>/...             仅包含已用组件依赖的第三方库（含 LICENSE）
    fonts/                      （可选）离线字体
  data/
    manifest.json               报告元信息 + dataset 索引 + params
    datasets/<id>.json          每个 dataset 一个文件（API 友好）
    bundle.js                   RK.data.preload({...})：file:// 双击打开时使用
```

数据加载顺序：`bundle.js` 已加载 → 直接用；否则 http(s) 下 fetch `data/manifest.json` + `datasets/*.json`；
`<meta name="rk:data-source" content="api">` + `<meta name="rk:api" content="https://…/">` → 调用数据 API（同样的 JSON 形状）。

### 3.1 交付变体（builder 选项）

| 选项 | 产物 | 说明 |
|---|---|---|
| 默认 | 上面的文件夹 | `data_source="bundle"`：`index.html` 引用 `data/bundle.js`，双击 `file://` 可用 |
| `data_source="http"` | 同一文件夹，不引用 `bundle.js`，`<meta name="rk:data-source" content="http">` | 只能经 web 服务器打开；`data/*.json` 可单独替换 |
| `data_source="api", api="https://…/"` | 同一文件夹（`data/` 照常写出，可作为 API 的静态内容），`index.html` 带 `rk:data-source=api` + `rk:api` | 运行时 `GET {api}manifest`、`GET {api}datasets/<id>`；带 token 见 §7 `RK.boot` |
| `single_file=True` | `<out>/<slug>.html`（或直接给 `….html`） | 所有 `<link>` / `<script src>` 换成内联 `<style data-rk-inline="href">` / `<script data-rk-inline="src">`；CSS 中的字体与图片转成 `data:` URI；不能与 `data_source="http"` 同用 |
| `excel=True` | `data/<slug>.xlsx`（单文件模式：与 html 同目录） | 需要 openpyxl；每个 dataset 一个工作表，数字格式由字段格式码换算；顶栏出现 `<a data-rk-download="excel">` 下载按钮 |

命令行等价：`python -m reportkit build spec.json out [--single-file] [--excel] [--locale zh-CN]`。

## 4. 数据契约

### 4.1 Dataset — `data/datasets/<id>.json`

```json
{
  "id": "comps",
  "title": "Trading comparables",
  "schema": {
    "fields": [
      {"name": "company", "type": "string", "title": "Company"},
      {"name": "sector",  "type": "string", "title": "Sector"},
      {"name": "mkt_cap", "type": "number", "title": "Market cap", "format": "$#,##0", "unit": "USD m"},
      {"name": "ev_ebitda_25e", "type": "number", "title": "EV/EBITDA 2025E", "format": "0.0x"},
      {"name": "date", "type": "date", "title": "Date", "format": "dd mmm yyyy"}
    ]
  },
  "data": [ {"company": "Alpha Corp", "sector": "Software", "mkt_cap": 12450.3, "ev_ebitda_25e": 14.2} ],
  "meta": { "source": "FactSet, company filings; market data as of 10-Oct-2026", "unit": "USD m",
            "notes": ["Excludes outliers > 40x"], "asOf": "2026-10-10" },
  "computed": [ {"name": "ebitda_margin", "formula": "ebitda_25e / revenue_25e", "format": "0.0%", "title": "EBITDA margin"} ]
}
```

- `type`: `string | number | date | boolean`；日期用 ISO `YYYY-MM-DD` 字符串。
- `format`: Excel 风格格式码（`0.0x`, `0.0%`, `$#,##0.0,,"m"`, `#,##0;(#,##0)`, `dd mmm yyyy`）或预设名（`mult`, `pct1`, `usd_m` …），见 `kit/core/rk.format.js`。
- `data` 可以是 records（推荐，pandas `to_dict("records")`），也可以是与 fields 顺序一致的数组。
- `computed`: 用 RK 公式语言定义的派生字段（可引用 `@param`），前端实时计算。
- 缺失值用 `null`（显示 `n.a.`），无意义值（除零等）显示 `n.m.`。

### 4.2 Manifest — `data/manifest.json`

```json
{
  "reportkit": "0.1",
  "report": {"title": "Project Atlas", "subtitle": "Discussion materials", "client": "Board of Directors",
             "date": "2026-10-14", "confidentiality": "Strictly private & confidential", "locale": "en-US",
             "firm": "Northbridge Capital", "theme": "navy", "page_size": "letter", "updown": "cn"},
  "datasets": {"comps": {"path": "datasets/comps.json", "title": "Trading comparables", "rows": 18}},
  "params": {"wacc": {"value": 0.09, "min": 0.07, "max": 0.11, "step": 0.0025, "format": "0.0%", "title": "WACC"}}
}
```

`report` 中值为空的键不写出；`page_size` 仅在非 16:9 时出现，`updown` 仅在显式设置时出现。
`report.title` + `report.date` + `<meta name="rk:built">` 组成 `RK.data.reportKey()`，用于浏览器存储的命名空间（§7.4）。

### 4.3 Bundle — `data/bundle.js`

```js
RK.data.preload({"manifest": {...}, "datasets": {"comps": {...}, ...}});
```

## 5. HTML 版式契约

```html
<html lang="en" data-rk-theme="navy">
<head>
  <meta name="rk:data" content="data/">
  <link rel="stylesheet" href="assets/css/reportkit.css">
</head>
<body class="rk-report">
  <header class="rk-topbar">…标题 / 全局筛选 / 主题切换…</header>
  <nav class="rk-nav" data-rk-nav></nav>                       <!-- 运行时自动生成目录 -->
  <main class="rk-deck">
    <section class="rk-page" id="valuation" data-rk-page="Valuation summary">
      <header class="rk-page__head">
        <p class="rk-page__kicker">Valuation</p>
        <h2 class="rk-page__title">Implied equity value of $4.2–5.6bn</h2>   <!-- action title -->
        <p class="rk-page__subtitle">USD m unless otherwise stated</p>
      </header>
      <div class="rk-page__body rk-grid">
        <figure class="rk-block" style="--rk-span:7" data-rk="football-field" data-rk-data="valuation">
          <figcaption class="rk-block__head">
            <h3 class="rk-block__title">Valuation summary</h3>
            <p class="rk-block__subtitle">Implied share price (USD)</p>
          </figcaption>
          <div class="rk-block__body" style="--rk-h:340px"></div>
          <script type="application/json" data-rk-options>{"encode": {"label": "method", "low": "low", "high": "high"}}</script>
          <footer class="rk-block__foot">Source: Company filings, FactSet</footer>
        </figure>
      </div>
      <footer class="rk-page__foot">
        <span class="rk-page__source">Source: …</span><span class="rk-page__conf">Strictly confidential</span><span class="rk-page__num"></span>
      </footer>
    </section>
  </main>
  <script src="assets/vendor/echarts/echarts.min.js"></script>
  <script src="assets/js/reportkit.js"></script>
  <script src="assets/js/components/football-field.js"></script>
  <script src="data/bundle.js"></script>
</body>
```

- `data-rk="<component id>"`：挂载点；`data-rk-data="<dataset id>"`：绑定数据集（UI 组件可省略）。
- options：`data-rk-options='{"…"}'` 属性或子元素 `<script type="application/json" data-rk-options>`（推荐）。
- `--rk-span`：12 栅格列宽（默认 12）；`--rk-h`：图表高度。
- 页面结构固定 16:9（打印 13.333in × 7.5in），屏幕上可自适应；`<html data-rk-page-size="letter" | "a4">` 改为 Letter / A4 横向
  （builder `Report(page_size=…)` 同时追加对应的 `@page` 规则）。

其他属性与 meta（builder 输出，手写 HTML 时可选）：

| 位置 | 属性 / meta | 作用 |
|---|---|---|
| `<html>` | `lang`、`data-rk-theme`、`data-rk-updown="cn"`、`data-rk-page-size`、`data-rk-autoboot="false"` | 语言、主题、红涨绿跌（§7.5）、页面尺寸、关闭自动启动（之后手动 `RK.boot(cfg)`） |
| `<head>` | `rk:locale`、`rk:data`、`rk:data-source`、`rk:api`、`rk:themes`、`rk:version`、`rk:built`、`generator=ReportKit` | 界面语言（优先于 `lang`）、数据位置与模式、主题下拉列表、kit 版本、构建日期（参与 reportKey）；`generator` 让 builder 识别自己写过的文件 |
| 页面 / block 标题 | `data-rk-template="…{{…}}…"` | 标题模板（§7.1），元素文字为回退文本 |
| `section.rk-page` | `data-rk-filters="off"` | 本页忽略全局筛选与交叉选择（§7.2） |
| `section.rk-page` | `data-rk-page="…"`、`class="rk-page--cover" / "rk-page--section"` | 导航标题、封面 / 章节页 |

## 6. 组件契约

### 6.1 JS — `kit/components/<id>/<id>.js`

```js
RK.component({
  id: 'football-field',
  deps: ['echarts'],          // vendor ids（见 vendor/vendor.json）
  needsData: true,            // 纯 UI 组件设为 false
  defaults: { encode: {label: 'label', low: 'low', high: 'high'}, format: null },
  render: RK.chart(function build(ctx) { return /* ECharts option */; })
  // 或 render(ctx) { … return { update(ctx), resize(), destroy(), exportImage() } }
});
```

`ctx`（运行时传入）：

| 字段 | 说明 |
|---|---|
| `el` | 组件绘制容器（`.rk-block__body`） |
| `block` | 外层 `figure.rk-block` |
| `options` | defaults ⊕ 块 options（深合并） |
| `enc` | `options.encode`：通道 → 字段名 |
| `dataset` | `RK.Dataset`（schema / meta），无数据时为 null |
| `rows` | 应用全局筛选后的行（不含本组件自己发起的交叉筛选） |
| `allRows` | 未筛选行 |
| `field(name)` / `title(name)` / `fmtOf(name)` | 字段定义 / 标题 / 格式 |
| `format(v, spec)` | `RK.format` |
| `theme` | 当前主题 token（`cat[]`, `seq[]`, `div[]`, `ink`, `accent` …） |
| `select(field, value, opt?)` | 交叉筛选：切换本组件发起的 `in` 过滤；`opt.scope: 'global' \| 'dataset'`（默认取 `options.crossFilterScope`，通用字段名默认 `dataset`） |
| `setSelection(field, values, opt?)` / `clearSelection()` | 整体替换 / 清除本组件的选择（刷选、框选） |
| `selected(field)` | 本组件当前选中值数组（用于高亮） |
| `ignoredSelections` | 因会使本组件为空而被忽略的其他组件选择的 key（§7.2） |
| `data(id)` / `view(id, opts)` | 读取其他数据集（`view` 默认排除本组件自己的选择，并遵守本页 / 本组件的 filters 开关） |
| `store` | `RK.store`（filters / params / state） |
| `emit(type, payload)` | 在 `RK.bus` 上发事件（自动带 `block` id） |
| `id` / `component` | block id、组件 id |
| `print` | 是否处于打印渲染 |
| `motion` | 是否允许动画（prefers-reduced-motion / 打印时为 false） |

### 6.2 Manifest — `kit/components/<id>/manifest.json`

```json
{
  "id": "football-field",
  "name": "Football Field", "name_zh": "估值足球场图",
  "category": "valuation",
  "engine": "echarts", "deps": ["echarts"],
  "summary": "Horizontal floating bars comparing valuation ranges by methodology.",
  "summary_zh": "按估值方法比较估值区间的横向浮动条形图。",
  "description_zh": "…能展示什么、适合什么数据、怎么读…",
  "best_for": ["DCF / trading comps / precedents / 52-week range summary"],
  "avoid_when": ["More than ~10 methodologies"],
  "channels": {
    "label": {"type": "string", "required": true, "desc": "Methodology name"},
    "low":   {"type": "number", "required": true, "desc": "Range low"},
    "high":  {"type": "number", "required": true, "desc": "Range high"},
    "group": {"type": "string", "required": false, "desc": "Optional section (e.g. Intrinsic / Market)"}
  },
  "options": {
    "refLines": {"type": "array", "default": [], "desc": "[{value, label}] vertical reference lines (current price, offer)"},
    "format":   {"type": "string", "default": null, "desc": "Value format; defaults to the low field's format"}
  },
  "interactions": ["hover tooltip", "click to highlight", "PNG / CSV export"],
  "optionDeps": {"basemap": {"world-50m": ["geo-world-50m"]}},
  "samples": [
    {"title": "Equity value per share", "data": "valuation_ranges", "height": 340,
     "options": {"encode": {"label": "method", "low": "low", "high": "high"}, "refLines": [{"value": 42.5, "label": "Current $42.50"}]}}
  ]
}
```

`optionDeps`（I6，可选；上例取自 `choropleth`）：`{"<option>": {"<value>": ["<vendor id>", …]}}`。builder 计算依赖时，block 上该选项的值（未设置时取 manifest
`options.<option>.default`；点号路径指向嵌套选项；数组值逐个匹配；布尔 / 数字按 JSON 拼写 `"true"` / `"2"`）命中的 vendor 包会被追加打包。
校验器会报出 `optionDeps` 中不存在的 vendor id。目前 `choropleth`、`bubble-map` 用它在 `basemap: "world-50m"` 时打包 `geo-world-50m`。

类别（`category`）：`layout` 版式与叙事 · `controls` 交互控件 · `valuation` 估值 · `trend` 时间趋势 ·
`comparison` 规模与排名 · `composition` 结构占比 · `bridge` 偏差与桥接 · `distribution` 相关与分布 ·
`flow` 流向与关系 · `geo` 地理空间 · `table` 表格 · `timeline` 流程与时间线。

## 7. 运行时 API（摘要）

```js
RK.boot(cfg?)                               // 自动：加载数据 → 主题 → 挂载所有 [data-rk] → 导航/动效/打印
                                            // cfg: {token, api, source, base, bundle, theme, ignoreSavedTheme, progress, root, force}
RK.data.adapter('name', cfg => Promise.resolve({manifest, datasets}))   // 自定义数据源；<meta name="rk:data-source" content="name">
RK.mount(el, {component, data, options})    // 命令式挂载（gallery 使用）
RK.data.get(id) / RK.data.view(id, opts) / RK.data.put(json)
RK.store.setFilter(key, {field, op:'in'|'between'|'search'|'expr', ...}) / setParam(name, v) / subscribe(fn)
RK.query('median(ev_ebitda_25e) by sector from comps where region == "Asia" sort 2 desc top 5')
RK.expr.compile('ev / ebitda', {fields})
RK.theme.set('bronze')                       // 运行时换肤
RK.format(v, '0.0x')
```

### 7.1 标题模板（I1）— `RK.template`

任何带 `data-rk-template="…"` 的元素（页面 title / subtitle / kicker、block title / subtitle）在启动时和每次 store
变化（筛选、交叉选择、参数、数据）后由运行时重新求值，只写 `textContent`（永不 `innerHTML`）。

```text
{{<dataset>: <RK.expr> | <format>}}   聚合式在该数据集「当前筛选后」的行上求值；行公式 / 普通字段取第一行
{{@wacc | 0.0%}}                       参数（可省略 dataset）
{{<expr>}}                              在 block 内省略 dataset 时用该 block 的数据集（及其实际显示的行）
```

- 格式码可省略：参数用 manifest 中的 `format`，公式按查询列的规则推断（`median(x)` 继承 `x` 的格式，`count()` 为 `#,##0`）。
- 分隔符是引号外的第一个单独 `|`（`||` 是逻辑或）；无法求值的占位符显示 `…` 并 `console.warn('[RK] title template …')` 一次。
- `data-rk-filters="off"` 页面上的模板读取未筛选数据；builder 输出的回退文本即把每个占位符替换为 `…`（`RK.template.fallback(tpl)`）。

```js
RK.template.render('Peers at {{peers: median(ev_ebitda_25e) | 0.0x}}', {dataset, rows(ds), filters, onError})
RK.template.parse(tpl)      // ['Peers at ', {src, dataset, expr, format}]
RK.template.evaluate(ph, opts) -> {value, format, dataset}
RK.runtime.refreshTemplates()   // 手动刷新（通常不需要）
```

### 7.2 筛选状态：页脚「Filtered view」与 block 徽标（I2 / P2）

- 只要有全局筛选或交叉选择作用于某页的任一 block，该页 `.rk-page__foot` 中出现
  `<span class="rk-page__filtered">Filtered view: Region = Europe · Sector = Automation</span>`（i18n 键 `filteredView`，打印可见）。
- `<section class="rk-page" data-rk-filters="off">`（builder：`page(..., filters=False)`）：页内 block 等同 `options.filters === false`，
  忽略全局筛选与交叉选择，永不显示该标记。
- block 标题栏：`.rk-block__status` 内的「Filtered」徽标（悬停列出作用于本 block 的筛选，× 清除这些筛选；仅屏幕显示）；
  若本 block 的行**仅因其他 block 的交叉选择**（带 `source` 的筛选）变为空，则忽略这些选择、按未选择状态渲染，并显示柔和徽标
  「Selection not in this view」（`options.selectionFallback: false` 关闭；`options.badges: false` 隐藏徽标）。
- 筛选描述：`spec.label`（筛选控件可设置）优先，否则取字段标题；值按字段格式显示。

```js
RK.data.applied(ds, {exclude, ignore, filters})  // view() 实际应用的筛选 [{key, spec}]
RK.data.describeFilter(spec, ds)                 // "Region = Europe" / "Market cap: $1,000 – $5,000"
block.view() -> {rows, applied, ignored}         // ctx.rows 的来源；ctx.ignoredSelections = 被忽略的选择 key
RK.runtime.pageFilters(pageEl) / RK.runtime.updateChrome()
```

### 7.3 指标 / 维度切换（I3）

```json
{"encode": {"x": "company", "y": "ev_ebitda_25e"},
 "choices": {"y": ["ev_ebitda_25e", "ev_revenue_25e", "*computed"]}, "choiceLabels": {"y": "Metric"}}
```

运行时在 block 标题栏渲染紧凑下拉框（`.rk-block__choices`，显示字段标题）；选择后设置 `options.encode[channel]` 并重渲染
（清除本 block 自己的旧选择），该选择按 block 保存、筛选变化后保留。`"*computed"` 展开为数据集的计算字段与客户自建指标，
新增 / 删除指标时自动更新。程序化：`block.choose('y', 'ev_revenue_25e')`（触发 `RK.bus` 事件 `block:choice`）。

### 7.4 客户自建指标持久化与存储命名空间（I4）

```js
ds.addComputed({name, title, formula, format, user: true})   // 写入 localStorage "rk:metrics:" + RK.data.reportKey()
RK.data.userMetrics()            // [{dataset, name, title, formula, format, active}]
RK.data.removeUserMetric(ds, name)
RK.data.reportKey()              // "报告标题|日期|<meta name="rk:built">"；三者皆空时追加页面路径
RK.data.storageKey('theme')      // "rk:theme:" + reportKey（主题偏好也按报告隔离）
```

- 加载数据后（`RK.data.load` / `put`）自动恢复；已无法编译的（字段已删除、语法变化）跳过但保留在存储中；
  与数据中真实列同名的指标永不覆盖该列；`ds.removeComputed(name)` 删除用户指标时同时清除存储。
- file:// 下多份报告可能共享同一 localStorage 源，因此所有键都带 reportKey；所有存储访问都有 try/catch，
  无存储（隐私模式、沙箱）时功能照常，只是不持久化。

### 7.5 国际化与涨跌色（I5）

```js
RK.i18n.locale                    // <meta name="rk:locale"> 优先，其次 <html lang>；'zh' / 'zh-Hans' 使用 zh-CN 包
RK.i18n.t('viewData', 'View data', {vars})   // 查找顺序：精确 locale → 同语言包 → en → fallback → key；{name} 占位
RK.i18n.add('zh-CN', {'myComp.title': '…'})  // 组件注册自己的字符串
RK.i18n.set('zh-CN')              // 运行时切换（事件 i18n:changed；已渲染的工具栏需重建）
```

- 内置 `en` / `zh-CN` 包覆盖运行时全部 UI 文本（工具栏、View data、Download CSV/PNG、Expand、No data for the current filters、
  Reset、Filtered / Filtered view、Selection not in this view、主题名称等）以及组件常用词（Search、All、None、Median …）。
- zh-CN 下 `RK.format` 的紧凑单位为 `亿 / 万`（`RK.format.config.compactUnits = [[1e8,'亿'],[1e4,'万']]`，页面自定义的单位不被覆盖），
  布尔值显示「是 / 否」，`data-rk-meta="date"` 显示「2026年10月14日」。
- `<html data-rk-updown="cn">`：红涨绿跌——运行时以内联样式交换 `--rk-pos` / `--rk-neg`（换肤后重新应用），
  `RK.theme.tokens().pos/neg` 同步交换；`RK.theme.updown()` / `RK.theme.setUpdown('cn'|'us')`。
- builder：`Report(locale="zh-CN", updown="cn"|"us")` 输出 `<html lang>`、`<meta name="rk:locale">`、`data-rk-updown`。

### 7.6 打印适配（P1）

打印时（`beforeprint` / `matchMedia('print')`）运行时对每个内容溢出其 body 的 block（`scrollWidth > clientWidth + 1` 或
`scrollHeight > clientHeight + 1`，包括表格包裹层、Tabulator holder 等嵌套滚动容器）先展开嵌套滚动容器，再对 body 的子元素施加
CSS `zoom` 缩放到 body 原尺寸内（最小 0.55，仍放不下的部分在 body 处裁切）；打印结束后恢复。

```js
RK.runtime.printFit()     // -> [{id, zoom, clipped, box:[w,h], content:[w,h]}]；模拟打印媒体后可在测试中调用
RK.runtime.printUnfit()   // 恢复（afterprint 自动调用）
// block options.printFit: false 跳过某个 block
```

注意：屏幕上的缩放仍禁止使用 CSS `zoom`（ECharts 命中位置会错）；打印时没有指针交互，所以 `print.css`（Letter / A4 页面）与 printFit 使用 `zoom`。

### 7.7 通用 block options（运行时处理，对任何组件生效）

| option | 默认 | 作用 |
|---|---|---|
| `encode` | manifest 默认 | 通道 → 字段 |
| `filters` | `true` | `false`：忽略全局筛选与交叉选择（整页用 `data-rk-filters="off"`） |
| `ignoreFilters` | — | 忽略指定 key 的筛选（字符串或数组） |
| `where` | — | 本 block 的行级预筛选（RK.expr 行公式，可用 `@param`） |
| `choices` / `choiceLabels` | — | 标题栏指标 / 维度下拉框（§7.3） |
| `selectionFallback` | `true` | `false`：不忽略导致本 block 为空的其他 block 选择（§7.2） |
| `badges` | `true` | `false`：不显示 Filtered / Selection 徽标 |
| `crossFilterScope` | 按字段 | `ctx.select` 的默认范围：`'global'`（所有含该字段的数据集）或 `'dataset'` |
| `printFit` | `true` | `false`：打印时不缩放（§7.6） |
| `tools` | `true` | `false`：不显示工具栏（View data / CSV / PNG / Expand） |
| `aria` | 开启 | （ECharts 组件）`false` 关闭 ECharts aria 自动描述 |

### 7.8 第三方库完整性（I6）

`vendor/vendor.json` 是唯一事实来源：每个包写精确版本、许可、上游仓库、保留哪些文件，并记录 `integrity`（npm tarball 的
sha512，`local` 生成的包没有）与 `sha256`（每个分发文件）。`python3 tools/vendor.py --check` 离线校验所有文件存在且哈希一致
（`tools/check.sh` 第一步）；`--rehash [id]` 在有意替换文件后重新记录；`python3 tools/vendor.py <id>` 用
`npm pack --ignore-scripts` 重新获取，tarball integrity 与记录不符时报错。当前 11 个条目：9 个库 / 数据包
（echarts、leaflet、leaflet-markercluster、leaflet-heat、topojson-client、world-atlas、tabulator、geo-world、geo-world-50m）
+ 2 套字体（Inter、Source Serif 4，输出到 `kit/fonts/`）。
