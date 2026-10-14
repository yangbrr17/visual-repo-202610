# reportkit — Python 报告构建器 / Python report builder

把 Python / SQL 跑出来的指标变成一个**自包含、离线可用、HTML/CSS/JS/数据严格分离**的交互式报告文件夹
（双击 `index.html` 即可打开）。契约见 [`docs/architecture.md`](../docs/architecture.md) §3–§6。

Turn metrics computed in Python / SQL into a **self-contained, offline, data-separated** interactive
report folder (double-click `index.html`). The binding contract is [`docs/architecture.md`](../docs/architecture.md) §3–§6.

- 纯标准库（Python ≥ 3.10）；pandas / numpy 仅为**可选**输入。Stdlib only; pandas / numpy are optional inputs.
- 输出确定性（同样输入 → 逐字节相同），便于 code review / diff。Deterministic, diff-friendly output.

## 安装 / Install

```bash
pip install -e py                 # 或 / or: export PYTHONPATH=$PWD/py
pip install -e "py[pandas]"       # 可选：DataFrame / parquet 支持 (optional)
```

构建器需要找到前端 kit（含 `kit/build.json` 的仓库根目录）：在仓库内会自动向上查找；
安装到别处时设置 `REPORTKIT_HOME=/path/to/repo` 或 `build(..., kit="/path/to/repo")`。

The builder needs the front-end kit (the repo root containing `kit/build.json`). Inside the repo it is
found automatically; otherwise set `REPORTKIT_HOME=/path/to/repo` or pass `kit=...`.

## 快速开始 / Quick start

在仓库根目录可直接运行（实际项目里把 `peers` / `kpis` 换成 SQL / pandas 的结果）：

```python
import json
from reportkit import Report

# 实际项目：df_comps = pd.read_sql(...)；这里读 kit 自带的示例数据（records 列表）
peers = json.load(open("kit/samples/datasets/peers.json", encoding="utf-8"))["data"]
kpis = json.load(open("kit/samples/datasets/kpis.json", encoding="utf-8"))["data"]

r = Report("Project Atlas", subtitle="Discussion materials", client="Board of Directors",
           date="2026-10-14", firm="Northbridge Partners", theme="navy")

# 数据集：DataFrame | list[dict] | dict[str, list] | .csv/.json/.parquet/.xlsx 路径 | 契约格式 JSON
r.dataset("comps", peers, title="Trading comparables",
          source="FactSet, company filings; market data as of 10-Oct-2026", unit="USD m",
          fields={"ev_ebitda_25e": {"title": "EV/EBITDA 2025E", "format": "0.0x"},
                  "mkt_cap": {"title": "Market cap", "format": "$#,##0"}},
          computed=[{"name": "ebitda_margin", "formula": "ebitda_25e / revenue_25e", "format": "0.0%"}])
r.dataset("kpis", kpis, title="Key performance indicators", source="Company filings")
r.param("wacc", 0.09, min=0.07, max=0.11, step=0.0025, format="0.0%", title="WACC")   # @wacc in formulas

r.topbar_block("filter-bar", data="comps", options={"filters": [               # 全局筛选
    {"field": "sector", "type": "multi", "label": "Sector"},
    {"field": "region", "type": "multi", "label": "Region"}]})

r.cover()                                   # 封面（标题/客户/日期/保密声明）
r.section("Valuation")                      # 章节页（自动编号 01, 02 …）
p = r.page("Peers trade at a median {{comps: median(ev_ebitda_25e) | 0.0x}} EBITDA",   # action title（模板，随筛选重算）
           kicker="Trading comparables", subtitle="USD m unless otherwise stated",
           notes="Excludes outliers > 40x")
p.block("bar", data="comps", title="EV / EBITDA 2025E", span=7, height=380,
        encode={"x": "company", "y": "ev_ebitda_25e"}, options={"sort": "desc", "avgLine": True})
p.block("kpi-tiles", data="kpis", span=5, height="auto")

out = r.build("out/atlas")                  # -> out/atlas/index.html
```

`Report(title, subtitle=, client=, date=, theme="navy", confidentiality="Strictly private & confidential", locale="en-US",
firm=, page_size="16:9" | "letter" | "a4", updown=None | "us" | "cn")`。

### 数据规范化 / Normalisation

| 输入 / input | 处理 / handling |
|---|---|
| numpy 标量 / numpy scalars | → Python `int / float / bool` |
| `NaN`, `NaT`, `pd.NA`, `±inf` | → `null`（前端显示 `n.a.`） |
| `datetime` / `date` / `Timestamp` | → `"YYYY-MM-DD"`（含时间则 `"YYYY-MM-DDTHH:MM:SS"`） |
| `Decimal` | → `float` |
| DataFrame 命名索引 / DatetimeIndex | 变成第一列 / becomes the first column |
| CSV（标准库读取）| 数字列自动转数值（支持 `1,234.5`），`n.a.`/`#N/A`/`-` 等视为空；`"NA"`（北美）在文本列中保持文本；`00123` 保持文本 |

字段类型自动推断为 `number / string / date / boolean`，再合并 `fields=` 覆盖（也可写 `{"co": "Company"}` 只改标题）。
Field types are inferred and merged with `fields=` overrides.

### 页面与组件 / Pages & blocks

- `r.page(title, kicker=, subtitle=, source=, notes=, id=, kind="content"|"cover"|"section", nav=, filters=True)`
- `p.block(component, data=, title=, subtitle=, span=1..12, height=px|"50vh", options=, encode=, source=, notes=, id=)`
  - `encode` 合并进 `options["encode"]`；`data=` 也可直接传 DataFrame/records（自动注册数据集）。
  - 页脚 Source：未显式给出时，取本页所用数据集的 `meta.source`（`source=False` 关闭）。
  - `options={"choices": {"y": ["revenue", "ebitda", "*computed"]}}`：在模块标题栏放一个指标 / 维度下拉框，
    客户可切换该通道绑定的字段（`*computed` = 数据集的公式字段与客户自建指标）；未写 `encode.y` 时默认第一个字段。
    A metric / dimension picker in the block head; `*computed` expands to computed + user metrics.
- `filters=False`：该页不受全局筛选与图表交叉筛选影响（例如“全市场概览”页），HTML 上是 `data-rk-filters="off"`。
  其他页面在有筛选时页脚自动显示 “Filtered view: Region = Europe · …”（打印时也保留）。
  The page ignores global filters / selections; filtered pages get a "Filtered view: …" stamp in the footer.
- 组件列表 / list components: `python -m reportkit components`

### 标题模板 / Title templates

页面的 title / subtitle / kicker 和模块的 title / subtitle 可以写占位符，**按当前筛选后的数据实时计算**——
客户筛选到 Europe 时，action title 里的数字也跟着变：

Page and block titles can hold placeholders evaluated live against the **currently filtered** rows:

```python
t = r.page("Core peers trade at a median {{comps: median(ev_ebitda_25e) | 0.0x}} 2025E EBITDA "
           "vs. {{comps: avg(ev_ebitda_25e) | 0.0x}} on average",
           kicker="Peer multiples", subtitle="{{comps: count()}} companies · DCF at {{@wacc | 0.00%}} WACC")
t.block("bar", data="comps", title="EV / EBITDA 2025E ({{comps: count()}} peers shown)", span=7,
        encode={"x": "company", "y": "ev_ebitda_25e"}, options={"orientation": "horizontal", "sort": "desc"})
```

- 语法 / syntax: `{{<dataset>: <RK 公式> | <格式码>}}`；只用 `@param` 时可省略数据集：`{{@wacc | 0.0%}}`。
  聚合（`median / avg / sum / count / min / max / pctl …`）作用于筛选后的全部行；普通字段 / 行表达式取筛选后的第一行。
  `|` 之后是 Excel 风格格式码（可省略）；`||` 是“或”运算符，不是分隔符。
- 格式码省略时：参数用自己的 `format`，聚合沿用所读字段的格式（`median(x)` 继承 `x`），`count()` 为 `#,##0`。
- 页面标题里不写数据集时，默认用本页第一个绑定数据的模块的数据集；模块标题默认用该模块的数据集（及其实际显示的行）。
  `filters=False` 的页面上读取未筛选数据。
- 构建器输出 `data-rk-template="原模板"`，元素文字是把占位符换成 `…` 的版本（运行时启动后立即替换；无 JS 预览时
  显示它，页面 id 也由它生成）。运行时无法求值的占位符显示 `…` 并 `console.warn` 一次。
- 校验：数据集不存在、字段不存在（可用字段名、标题或 computed 字段）、`@param` 未定义、引用字段却没写数据集、
  `{{ }}` 不配对、公式非法——都会列入 `ReportValidationError`。

### 语言与涨跌色 / Locale & up/down colours

```python
r_zh = Report("项目 Atlas", date="2026-10-14", locale="zh-CN", updown="cn",   # 红涨绿跌；"us" = 绿涨红跌（默认）
              confidentiality="严格保密")                                       # 保密声明默认是英文，中文报告请显式传入
```

- `locale` → `<html lang>` 与 `<meta name="rk:locale">`：运行时界面文字（工具栏、查看数据、导出、筛选提示……）、
  页脚 来源 / 注、封面日期（2026年10月14日）、紧凑单位（`zh-CN` 用 亿 / 万）随之切换。
- `updown="cn"` → `<html data-rk-updown="cn">`：所有组件的正 / 负颜色互换（瀑布图、偏差条、K 线、涨跌幅着色等），换主题后仍然有效。
- 命令行可临时覆盖：`python -m reportkit build spec.json out --locale zh-CN`。
- 组件或页面自己的界面文字：`RK.i18n.add('zh-CN', {'myKey': '…'})` + `RK.i18n.t('myKey', 'English fallback')`
  （`docs/architecture.md` §7.5）。

### 客户自建指标 / Client metrics (browser side)

客户在 `query-console` 里“添加为指标”的公式（`ev / ebitda_26e`）会成为数据集的 computed 字段，出现在所有 `*computed` 下拉框中，
并保存在**客户本机浏览器的 localStorage**：键 `rk:metrics:<报告标题>|<报告日期>|<构建日期>`（按报告隔离——`file://` 打开的
多份报告共享同一存储源）。重新打开同一份报告时自动恢复；不再能编译的公式跳过，与真实列同名的不覆盖该列。
删除：控制台“我的指标”中的 ×，或 `localStorage.removeItem(RK.data.storageKey('metrics'))`。构建器不参与这一过程——
同一份报告重新构建（构建日期不变）后，客户的指标仍然有效；想让某个指标对所有人可见，请把它写进 `r.dataset(..., computed=[...])`。

### 模块级开关 / Block-level options (any component)

| option | 作用 / effect |
|---|---|
| `filters: False` | 本模块忽略全局筛选与交叉选择（`page(..., filters=False)` 对整页生效） |
| `ignoreFilters: ["region"]` | 忽略指定 key 的筛选 |
| `where: "is_target or mkt_cap > 5000"` | 本模块的行级预筛选（RK 公式） |
| `choices` / `choiceLabels` | 标题栏指标 / 维度下拉框（见上） |
| `selectionFallback: False` | 默认情况下，若本模块**仅因其他模块的点选**而无数据，会忽略这些点选并提示 “Selection not in this view”；设为 False 则保持空白 |
| `badges: False` | 隐藏标题栏的 “Filtered” / “Selection not in this view” 徽标 |
| `printFit: False` | 打印时不对溢出内容做缩放适配（默认：溢出的表格等按 CSS zoom 缩小到模块内，最小 0.55） |
| `crossFilterScope: "dataset"` | 点选只筛选同一数据集（默认按字段名跨数据集联动；`name`、`label`、`value` 等通用字段名默认只筛同一数据集） |
| `tools: False` | 隐藏模块工具栏（查看数据 / CSV / PNG / 放大） |

### 数据 API 模式 / Data API

```python
r.build("out/atlas-api", data_source="api", api="https://data.example-bank.com/api/reports/atlas/")
```

页面运行时请求 `GET {api}manifest` 与 `GET {api}datasets/<id>`，返回与 `data/manifest.json`、`data/datasets/<id>.json`
完全相同的 JSON（`data/` 仍会写出，可直接作为 API 的静态内容）。鉴权：`<html data-rk-autoboot="false">` +
`RK.boot({token})` → `Authorization: Bearer …`；其他来源：`RK.data.adapter(name, fn)`。参考服务端与改造步骤见
`docs/pipeline-guide.md` §9。

### 第三方库与底图 / Vendor libraries & basemaps

- 只打包用到的组件所依赖的 vendor 包；组件 manifest 的 `optionDeps` 让某些选项值追加依赖：
  `choropleth` / `bubble-map` 的 `options={"basemap": "world-50m"}` → 额外打包 `geo-world-50m`（1:50m Natural Earth，
  含新加坡、香港、澳门、巴林、马耳他、开曼等，约 0.75 MB）；默认 `world-110m` 底图约 0.1 MB。
- `vendor/vendor.json` 记录每个包的 npm `integrity`（sha512）和每个分发文件的 sha256：
  `python3 tools/vendor.py --check`（离线校验，`tools/check.sh` 第一步）；有意替换文件后 `python3 tools/vendor.py --rehash [id]`。

### 校验 / Validation

`r.build()` 默认先校验，并**一次列出全部问题**（`ReportValidationError.errors`）：未知组件、未知数据集、
需要数据却未绑定、`encode` 字段不存在（含 computed 字段）、必填通道未映射且无默认字段、重复 id、
公式引用未定义的 `@param` 或未知字段、span/height 不合法、主题不存在、vendor 文件缺失……
超过 50k 行的数据集给出警告。`r.check()` 返回 `(errors, warnings)` 不抛异常。

`build()` validates first and reports **every** problem at once. `r.check()` returns `(errors, warnings)`.
另外检查标题模板（数据集 / 字段 / `@param`）、`options.choices` 字段、`filters` 类型，以及组件 `optionDeps`
引用的 vendor 包（例如 `basemap: "world-50m"` 会自动打包 `geo-world-50m` 高精度底图）。

### 输出 / Output (architecture.md §3)

```
out/atlas/
  index.html                  版式与绑定 only layout + bindings
  assets/css/reportkit.css    core styles + themes + used component css
  assets/js/reportkit.js      kit/core/* concatenated (header: version + build date)
  assets/js/components/*.js   only the components used
  assets/vendor/<id>/         only the vendor libs needed (with LICENSE)
  assets/fonts/               kit/fonts (if present)
  data/manifest.json          report meta + dataset index + params
  data/datasets/<id>.json     one file per dataset (one row per line → reviewable diffs)
  data/bundle.js              RK.data.preload({...}) for file://
  data/<slug>.xlsx            excel=True only
```

`clean=True`（默认）只删除上一次构建生成的 `index.html / assets / data`；若目录中这些名字不是 ReportKit
生成的（例如你自己的 `data/` 文件夹），会拒绝构建而不是删除。
`clean=True` only removes a previous ReportKit build; it refuses to touch foreign `data/` / `assets/` folders.

### 单文件交付 / Single file

```python
path = r.build("out/delivery", single_file=True)        # -> out/delivery/project-atlas.html
path = r.build("out/Atlas_Board_14Oct.html", single_file=True)   # 指定文件名
```

一个自包含的 `.html`：CSS（字体以 base64 `data:` URI 内嵌）、第三方库 CSS/JS（图片同样内嵌）、`reportkit.js`、
用到的组件和数据 bundle 全部内联；双击即可离线打开（`file://`），**不发出任何网络请求**，适合邮件附件 / 数据室上传
（不会出现“解压后才能打开”的问题）。内联脚本已转义 `</script>`、`<!--` 和 U+2028/2029。示例 pitchbook 约 3–4 MB。
`data_source="api"` 也可以与单文件同用（页面从 API 取数，不内嵌数据）。目标文件已存在且不是 ReportKit 生成的会拒绝覆盖。

One self-contained HTML file (fonts / images as `data:` URIs, every script inlined and escaped); opens from
`file://` with no network request. Combine with `data_source="api"` to inline everything except the data.

### Excel 导出 / Excel export

```python
out = r.build("out/atlas", excel=True)                  # + out/atlas/data/project-atlas.xlsx
r.build("out/delivery", single_file=True, excel=True)   # + out/delivery/project-atlas.xlsx（与 html 同目录）
```

每个数据集一个工作表：标题行、Source / Notes / Unit / As of / 保密声明行、加粗表头（字段标题，含单位）、
**数字格式直接取自字段的格式码**（`0.0x` → `0.0"x"`、`$#,##0.0,,"m"`、`0.0%`、`dd mmm yyyy` …；日期写成真正的
Excel 日期）、冻结表头、筛选按钮、列宽、横向打印 + 页脚保密声明。computed 字段（浏览器实时计算）以注释行列出公式。
字符串一律写成文本单元格（`=HYPERLINK(...)` 之类不会变成公式）。报告右上角出现 “Excel” 下载按钮。
需要 `openpyxl`（`pip install openpyxl`，或 `pip install -e "py[xlsx]"`）；只有 `excel=True` 时才导入，
缺失时给出明确错误且不写任何文件。输出确定性（同样输入 → 逐字节相同的 .xlsx）。

## JSON 规格 / JSON layout spec (non-Python tools)

```json
{
  "reportkit": "0.1",
  "report": {"title": "Project Atlas", "date": "2026-10-14", "client": "Board of Directors",
             "locale": "en-US", "updown": "us"},
  "params": {"wacc": {"value": 0.09, "min": 0.07, "max": 0.11, "step": 0.0025, "format": "0.0%"}},
  "datasets": {
    "comps": {"path": "comps.csv", "source": "FactSet", "fields": {"ev_ebitda": {"format": "0.0x"}}},
    "kpis":  {"data": [{"label": "Revenue", "value": 1234}]}
  },
  "topbar": [{"component": "filter-bar", "data": "comps",
              "options": {"filters": [{"field": "sector", "type": "multi", "label": "Sector"}]}}],
  "pages": [
    {"kind": "cover", "title": "Project Atlas"},
    {"title": "Peers trade at {{comps: median(ev_ebitda) | 0.0x}}", "kicker": "Comps", "blocks": [
      {"component": "bar", "data": "comps", "span": 7, "height": 360, "encode": {"x": "company", "y": "ev_ebitda"},
       "options": {"choices": {"y": ["ev_ebitda", "*computed"]}}}
    ]},
    {"title": "Whole market (unfiltered)", "filters": false, "blocks": []}
  ]
}
```

```python
spec = r.to_spec()                      # inline datasets (contract form)
r.save_spec("spec/report.json")         # + spec/datasets/<id>.json
r2 = Report.from_spec("spec/report.json")   # relative paths resolve against the spec folder
```

## 命令行 / CLI

```bash
python -m reportkit build spec.json out/atlas [--no-validate] [--no-clean] [--date 2026-10-14]
                         [--single-file] [--excel] [--locale zh-CN]
python -m reportkit validate spec.json            # exit 1 + every problem on stderr
python -m reportkit components [--category valuation] [--json]
python -m reportkit new-component waterfall-pro --category bridge [--engine echarts|dom] [--name "..."]
```

`new-component` 在 `kit/components/<id>/` 生成 `manifest.json` 与遵循契约的 `<id>.js` 骨架（填写 TODO 即可）。

## 测试 / Tests

```bash
python3 -m unittest discover -s tests/py -v      # uses a temporary fake kit via REPORTKIT_HOME
REPORTKIT_SKIP_BROWSER=1 python3 -m unittest discover -s tests/py   # skip the Chromium single-file check
```

`tests/py/test_delivery.py` 还会把示例报告构建成单文件，用 Playwright 从 `file://` 打开：所有 block 均 `rendered`、
无 console error、除 `data:` URI 外没有任何请求（`tests/py/single_file_check.cjs`；未安装 node/playwright 时跳过）。
