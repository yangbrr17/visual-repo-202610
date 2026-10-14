# ReportKit 架构与契约 (Architecture & Contracts)

> 本文件是所有组件、Python 构建器和 gallery 网站共同遵守的**契约**。改动契约前先改这里。

## 1. 目标

- 投行交付给客户的交互式报告：Python/SQL 跑出 metrics → Python builder 生成一个**自包含文件夹**。
- **HTML / CSS / JS / DATA 严格分离**；数据独立成文件，将来可替换为数据 API。
- **离线可用**：双击 `index.html`（`file://`）即可打开；不依赖 CDN；所有脚本是 classic script（非 ES module）。
- 视觉质感对标 GS / JPM pitchbook：16:9 页面、action title、footnote / source、克制的配色和动效。
- 交互：缩放（dataZoom / 地图缩放）、全局筛选 + 交叉筛选、参数 what-if、客户自定义指标与查询。

## 2. 仓库结构

```
kit/                      前端框架（源码，唯一事实来源）
  core/                   rk.core / rk.format / rk.expr / rk.data / rk.theme / rk.chart / rk.motion / rk.runtime
  styles/                 tokens.css, base.css, layout.css, components.css, print.css, themes/*.css
  components/<id>/        <id>.js  (+ <id>.css)  + manifest.json      ← 每个组件一个目录
  samples/datasets/       gallery 与 demo 共用的示例数据（数据契约格式）
vendor/                   第三方库 dist 构建（npm 固定版本 + LICENSE），由 tools/vendor.py 生成
gallery/                  组件网站（分门别类展示、说明、可交互 demo）
py/reportkit/             Python 构建器：DataFrame/records → 报告文件夹
examples/                 生成好的示例报告
research/                 调研报告（landscape.md, catalog.json, raw/*.md）
tools/                    vendor.py, build_catalog.py, smoke.mjs ...
tests/                    js (node) + py (pytest) + 浏览器冒烟测试
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
             "date": "2026-10-14", "confidentiality": "Strictly private & confidential", "locale": "en-US"},
  "datasets": {"comps": {"path": "datasets/comps.json", "title": "Trading comparables", "rows": 18}},
  "params": {"wacc": {"value": 0.09, "min": 0.07, "max": 0.11, "step": 0.0025, "format": "0.0%", "title": "WACC"}}
}
```

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
- 页面结构固定 16:9（打印 13.333in × 7.5in），屏幕上可自适应。

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
| `select(field, value)` | 交叉筛选：切换本组件发起的 `in` 过滤 |
| `selected(field)` | 本组件当前选中值数组（用于高亮） |
| `store` | `RK.store`（filters / params / state） |
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
  "samples": [
    {"title": "Equity value per share", "data": "valuation_ranges", "height": 340,
     "options": {"encode": {"label": "method", "low": "low", "high": "high"}, "refLines": [{"value": 42.5, "label": "Current $42.50"}]}}
  ]
}
```

类别（`category`）：`layout` 版式与叙事 · `controls` 交互控件 · `valuation` 估值 · `trend` 时间趋势 ·
`comparison` 规模与排名 · `composition` 结构占比 · `bridge` 偏差与桥接 · `distribution` 相关与分布 ·
`flow` 流向与关系 · `geo` 地理空间 · `table` 表格 · `timeline` 流程与时间线。

## 7. 运行时 API（摘要）

```js
RK.boot()                                   // 自动：加载数据 → 主题 → 挂载所有 [data-rk] → 导航/动效/打印
RK.mount(el, {component, data, options})    // 命令式挂载（gallery 使用）
RK.data.get(id) / RK.data.view(id, opts) / RK.data.put(json)
RK.store.setFilter(key, {field, op:'in'|'between'|'search'|'expr', ...}) / setParam(name, v) / subscribe(fn)
RK.query('median(ev_ebitda_25e) by sector from comps where region == "Asia" sort 2 desc top 5')
RK.expr.compile('ev / ebitda', {fields})
RK.theme.set('bronze')                       // 运行时换肤
RK.format(v, '0.0x')
```
