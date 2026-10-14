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

```python
from reportkit import Report

r = Report("Project Atlas", subtitle="Discussion materials", client="Board of Directors",
           date="2026-10-14", firm="Northbridge Partners", theme="navy")

# 数据集：DataFrame | list[dict] | dict[str, list] | .csv/.json/.parquet 路径 | 契约格式 JSON
r.dataset("comps", df_comps, title="Trading comparables",
          source="FactSet, company filings; market data as of 10-Oct-2026", unit="USD m",
          fields={"ev_ebitda_25e": {"title": "EV/EBITDA 2025E", "format": "0.0x"},
                  "mkt_cap": {"title": "Market cap", "format": "$#,##0"}},
          computed=[{"name": "ebitda_margin", "formula": "ebitda_25e / revenue_25e", "format": "0.0%"}])
r.param("wacc", 0.09, min=0.07, max=0.11, step=0.0025, format="0.0%", title="WACC")   # @wacc in formulas

r.topbar_block("filter-bar", data="comps", options={"fields": ["sector", "region"]})  # 全局筛选

r.cover()                                   # 封面（标题/客户/日期/保密声明）
r.section("Valuation")                      # 章节页（自动编号 01, 02 …）
p = r.page("Peers trade at a median 9.5x EBITDA",          # action title
           kicker="Trading comparables", subtitle="USD m unless otherwise stated",
           notes="Excludes outliers > 40x")
p.block("bar", data="comps", title="EV / EBITDA 2025E", span=7, height=380,
        encode={"x": "company", "y": "ev_ebitda_25e"}, options={"sort": "desc", "avgLine": True})
p.block("kpi-tiles", data="kpis", span=5)

out = r.build("out/atlas")                  # -> out/atlas/index.html
```

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

- `r.page(title, kicker=, subtitle=, source=, notes=, id=, kind="content"|"cover"|"section", nav=)`
- `p.block(component, data=, title=, subtitle=, span=1..12, height=px|"50vh", options=, encode=, source=, notes=, id=)`
  - `encode` 合并进 `options["encode"]`；`data=` 也可直接传 DataFrame/records（自动注册数据集）。
  - 页脚 Source：未显式给出时，取本页所用数据集的 `meta.source`（`source=False` 关闭）。
- 组件列表 / list components: `python -m reportkit components`

### 校验 / Validation

`r.build()` 默认先校验，并**一次列出全部问题**（`ReportValidationError.errors`）：未知组件、未知数据集、
需要数据却未绑定、`encode` 字段不存在（含 computed 字段）、必填通道未映射且无默认字段、重复 id、
公式引用未定义的 `@param` 或未知字段、span/height 不合法、主题不存在、vendor 文件缺失……
超过 50k 行的数据集给出警告。`r.check()` 返回 `(errors, warnings)` 不抛异常。

`build()` validates first and reports **every** problem at once. `r.check()` returns `(errors, warnings)`.

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
```

`clean=True`（默认）只删除上一次构建生成的 `index.html / assets / data`；若目录中这些名字不是 ReportKit
生成的（例如你自己的 `data/` 文件夹），会拒绝构建而不是删除。
`clean=True` only removes a previous ReportKit build; it refuses to touch foreign `data/` / `assets/` folders.

## JSON 规格 / JSON layout spec (non-Python tools)

```json
{
  "reportkit": "0.1",
  "report": {"title": "Project Atlas", "date": "2026-10-14", "client": "Board of Directors"},
  "params": {"wacc": {"value": 0.09, "min": 0.07, "max": 0.11, "step": 0.0025, "format": "0.0%"}},
  "datasets": {
    "comps": {"path": "comps.csv", "source": "FactSet", "fields": {"ev_ebitda": {"format": "0.0x"}}},
    "kpis":  {"data": [{"label": "Revenue", "value": 1234}]}
  },
  "topbar": [{"component": "filter-bar", "data": "comps", "options": {"fields": ["sector"]}}],
  "pages": [
    {"kind": "cover", "title": "Project Atlas"},
    {"title": "Peers trade at 9.5x", "kicker": "Comps", "blocks": [
      {"component": "bar", "data": "comps", "span": 7, "height": 360, "encode": {"x": "company", "y": "ev_ebitda"}}
    ]}
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
python -m reportkit validate spec.json            # exit 1 + every problem on stderr
python -m reportkit components [--category valuation] [--json]
python -m reportkit new-component waterfall-pro --category bridge [--engine echarts|dom] [--name "..."]
```

`new-component` 在 `kit/components/<id>/` 生成 `manifest.json` 与遵循契约的 `<id>.js` 骨架（填写 TODO 即可）。

## 测试 / Tests

```bash
python3 -m unittest discover -s tests/py -v      # uses a temporary fake kit via REPORTKIT_HOME
```
