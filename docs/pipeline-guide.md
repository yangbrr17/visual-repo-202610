# 分析师工作流：SQL → Python → Metrics → ReportKit 报告

> 适用对象：在 deal team 里用 SQL / pandas 做 comps、precedents、trading analysis 的分析师。
> 完整示例：[`py/examples/sql_pipeline.py`](../py/examples/sql_pipeline.py)（"Project Kestrel"，产出
> [`examples/sql-pipeline-report/`](../examples/sql-pipeline-report/index.html)）。契约以
> [`docs/architecture.md`](architecture.md) 为准，Python API 见 [`py/README.md`](../py/README.md)。

```
 raw tables (SQL)  ──►  SQL views (CTE / window / GROUP BY)  ──►  Python (pandas 或 dict)  ──►  reportkit.Report  ──►  report folder
 companies, prices,     market cap, EV, LTM/NTM multiples,         quartiles, medians,         datasets + fields +      index.html
 financials, deals…     CAGR, TSR, 30d vol, premiums, medians      pivot / melt, R²            pages / blocks           assets/  data/
```

本文所有 ```` ```python ```` 代码块**按顺序粘贴进同一个 Python 会话（仓库根目录）即可运行**；标注
`# file:` 的代码块是独立脚本。Bash 命令同样在仓库根目录执行。

---

## 0. 先跑一遍完整示例

```bash
python3 py/examples/sql_pipeline.py                 # pandas 路径（已安装时）→ examples/sql-pipeline-report/
python3 py/examples/sql_pipeline.py --no-pandas     # 纯 sqlite3 rows / dicts 路径
python3 py/examples/sql_pipeline.py --parity        # 两条路径都跑一遍，逐字段比对所有 dataset 与版式
python3 py/examples/sql_pipeline.py --check         # 只校验（r.check()），不写文件
python3 py/examples/sql_pipeline.py --dump-db /tmp/kestrel.sqlite   # 导出原始表 + views，用任意 SQL 客户端查看
```

示例做了四件事：

| 阶段 | 内容 | 代码位置 |
|---|---|---|
| 1. RAW | 内存 SQLite：`companies`、`prices`（10 个 ticker × 2 年日线）、`dividends`、`financials`（FY21A–FY27E）、`transactions`、`deal_prices`；`random.Random(7)` 生成，结果确定 | `generate_raw()` |
| 2. SQL | 6 个 view + 1 张 staging table：`v_market`、`v_fundamentals`、`v_vol`、`v_tsr`、`comps`、`v_peer_stats`、`v_deals` | `VIEWS` |
| 3. PYTHON | `PandasBackend`（`read_sql` + groupby / melt / quantile / corr）与 `PlainBackend`（标准库）实现同一组接口 | `analyse()` |
| 4. REPORT | 11 个 dataset、1 个 param、7 个 computed field、14 页 | `build_report()` |

同一输入下，pandas 与 no-pandas 两条路径产出的 `data/` 与 `index.html` **逐字节相同**（`--parity` 校验；
`diff -r` 两次构建也可以验证）。

---

## 1. 数据契约（data contract）一页纸

报告文件夹里，数据与版式严格分离：

```
out/project-demo/
  index.html                 只有版式 + 绑定（哪个组件、哪个 dataset、options）
  assets/                    css / js / vendor（只含用到的组件与第三方库）
  data/manifest.json         报告元信息 + dataset 索引 + params
  data/datasets/<id>.json    每个 dataset 一个文件（一行一条记录，diff 友好）
  data/bundle.js             RK.data.preload({...})：双击 index.html（file://）时使用
```

每个 dataset 的 JSON 形状（architecture.md §4.1）：

```json
{
  "id": "comps",
  "title": "Trading comparables",
  "schema": {"fields": [
    {"name": "company", "type": "string", "title": "Company"},
    {"name": "ev_ebitda_ntm", "type": "number", "title": "EV / EBITDA NTM", "format": "0.0x"}
  ]},
  "data": [{"company": "Kestrel Automation", "ev_ebitda_ntm": 9.6}],
  "meta": {"source": "FactSet; market data as of 13-Oct-2026", "unit": "USD m",
           "notes": ["NTM = next twelve months consensus."], "asOf": "2026-10-13"},
  "computed": [{"name": "net_leverage", "formula": "net_debt / ebitda_ltm", "format": "0.0x"}]
}
```

要点：

- `type` 只有 `string | number | date | boolean`（另有 `array`，例如 kpi-tiles 的 sparkline）。日期一律 ISO `YYYY-MM-DD`。
- 缺失值是 `null`，前端显示 `n.a.`；无意义值（负 P/E、除零）显示 `n.m.`（见 §3.4）。
- **你不需要手写这些 JSON**：`r.dataset(...)` 负责把 DataFrame / records 规范化成这个形状。

---

## 2. 第一步：在 SQL 里算 metrics

原则：**重计算放在 SQL**（数据库离数据最近，逻辑可复核），**Python 只做 reshaping 和统计**，
**ReportKit 只负责呈现**。

### 2.1 一个最小可运行的例子

```python
# 在仓库根目录运行（或先 pip install -e py，就不需要 sys.path 这一行）
import sqlite3
import sys

sys.path.insert(0, "py")
from reportkit import Report

conn = sqlite3.connect(":memory:")
conn.executescript("""
CREATE TABLE companies (ticker TEXT PRIMARY KEY, company TEXT, sector TEXT, is_target INTEGER,
                        shares_out REAL, net_debt REAL, ebitda_ntm REAL, net_income_ntm REAL,
                        revenue_cagr REAL);
CREATE TABLE prices (ticker TEXT, date TEXT, close REAL, PRIMARY KEY (ticker, date));
""")
conn.executemany("INSERT INTO companies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    ("KSTL", "Kestrel Automation", "Automation",       1, 182.0, 1265.0, 586.0, 260.0, 0.090),
    ("ORVX", "Orvanta Controls",   "Automation",       0, 140.0, 1290.0, 790.0, 405.0, 0.061),
    ("HLMN", "Halmaren Motion",    "Motion Control",   0, 120.0,  900.0, 520.0, 266.0, 0.048),
    ("TRVD", "Torvald Drives",     "Motion Control",   0, 210.0,  350.0, 570.0, 275.0, 0.049),
    ("PRSN", "Prisane Sensing",    "Sensors & Vision", 0,  95.0,  720.0, 730.0, -12.0, 0.105),
    ("LMNO", "Lumeno Optics",      "Sensors & Vision", 0, 150.0,  -70.0, 465.0, 255.0, None),  # no history
])
closes = {"KSTL": [24.80, 24.31, 23.95], "ORVX": [61.02, 60.75, 60.31], "HLMN": [36.10, 36.52, 36.64],
          "TRVD": [22.40, 22.05, 22.23], "PRSN": [104.90, 105.30, 105.84], "LMNO": [40.20, 40.71, 40.95]}
conn.executemany("INSERT INTO prices VALUES (?, ?, ?)",
                 [(t, d, c) for t, cs in closes.items()
                  for d, c in zip(["2026-10-09", "2026-10-12", "2026-10-13"], cs)])

SQL = """
WITH ranked AS (                                   -- CTE + window：每个 ticker 的最新收盘价
    SELECT ticker, date, close,
           ROW_NUMBER()  OVER (PARTITION BY ticker ORDER BY date DESC) AS rn,
           FIRST_VALUE(close) OVER (PARTITION BY ticker ORDER BY date) AS first_close,
           MAX(close)    OVER (PARTITION BY ticker)                    AS high_3d
    FROM prices
)
SELECT c.ticker, c.company, c.sector, c.is_target,
       r.date                                                     AS price_date,
       r.close                                                    AS price,
       r.high_3d,
       ROUND(r.close / r.first_close - 1, 6)                      AS chg_3d,
       ROUND(r.close * c.shares_out, 1)                           AS mkt_cap,
       ROUND(r.close * c.shares_out + c.net_debt, 1)              AS ev,
       c.shares_out, c.net_debt, c.ebitda_ntm, c.net_income_ntm, c.revenue_cagr,
       ROUND((r.close * c.shares_out + c.net_debt) / c.ebitda_ntm, 6)    AS ev_ebitda_ntm,
       ROUND(r.close * c.shares_out / NULLIF(c.net_income_ntm, 0), 6)    AS pe_ntm
FROM companies c
JOIN ranked r ON r.ticker = c.ticker AND r.rn = 1
ORDER BY c.is_target DESC, ev DESC
"""
```

### 2.2 示例里用到的 SQL 模式（可直接复用）

| 需求 | 模式 | 示例中的 view |
|---|---|---|
| 最新价 / 每组第一行 | `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) = 1` | `v_market` |
| 52 周高低、30 日 VWAP | CTE 里先排 `rn`，再 `GROUP BY` + `SUM(close*volume)/SUM(volume)` | `v_market` |
| LTM / NTM calendarisation | 条件聚合把 FY 摆成列：`MAX(CASE WHEN fiscal_year = s.fy THEN ebitda END)`，再 `0.25 × FY25A + 0.75 × FY26E` | `v_fundamentals` |
| N 年前的值 | `LAG(x, 3) OVER (PARTITION BY ticker ORDER BY fiscal_year)`，**并校验** `LAG(fiscal_year, 3) = fiscal_year - 3`（历史有缺口时返回 NULL，而不是错位的年份） | `v_fundamentals` |
| 滚动波动率 | `AVG(lr) / AVG(lr*lr) OVER (... ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)` → `sqrt((m2 − mu²)·n/(n−1))·√252` | `v_vol` |
| TSR（含分红） | 起止日用 `MAX(date) ... WHERE date <= date(d1, '-1 year')`，分红按 ex-date 落在区间内求和 | `v_tsr` |
| 中位数（SQLite 没有 MEDIAN） | `ROW_NUMBER()` + `COUNT(*) OVER (PARTITION BY metric)`，取 `k IN ((n+1)/2, (n+2)/2)` 的平均 | `v_peer_stats` |
| 溢价 | 公告前最后一个交易日（`k = 1`）与 30 日 VWAP（`k <= 30`） | `v_deals` |
| 假设参数 | 单行 `settings` 表 `CROSS JOIN`（view 不能带 bind parameter） | 全部 |

几条经验：

- SQLite 的除零返回 `NULL` 而不报错——用 `NULLIF(x, 0)` 把意图写清楚。
- 在 SQL 里 `ROUND(...)`：文件更小，pandas / 非 pandas 两条路径结果逐字节一致。
- `ln / sqrt / power` 在较老的 SQLite 编译版本里可能没有；示例的 `ensure_math_functions()` 会注册 Python 实现兜底。

---

## 3. 第二步：DataFrame → dataset

### 3.1 pandas 与无 pandas 两条路径

```python
try:
    import pandas as pd
    comps = pd.read_sql_query(SQL, conn, parse_dates=["price_date"])
    comps["is_target"] = comps["is_target"].astype(bool)            # SQLite 0/1 -> boolean
    peer_median = float(comps.loc[~comps["is_target"], "ev_ebitda_ntm"].median())
except ImportError:                                                   # 没装 pandas：同样的逻辑用 dict
    import statistics
    cur = conn.execute(SQL)
    cols = [d[0] for d in cur.description]
    comps = [dict(zip(cols, row)) for row in cur.fetchall()]
    for row in comps:
        row["is_target"] = bool(row["is_target"])
    peer_median = statistics.median(r["ev_ebitda_ntm"] for r in comps if not r["is_target"])

print(f"peer median EV / EBITDA NTM = {peer_median:.1f}x")
```

`r.dataset()` 同时接受 DataFrame、`list[dict]`、`dict[str, list]`、`.csv/.json/.parquet` 路径和契约格式 JSON，
两条路径后面的代码完全一样。在装了 pandas 的机器上验证 fallback：
`python3 -c "import sys, runpy; sys.modules['pandas'] = None; sys.argv = ['x', '--check']; runpy.run_path('py/examples/sql_pipeline.py', run_name='__main__')"`
（`sys.modules['pandas'] = None` 让 `import pandas` 抛 `ImportError`）。完整示例里把差异封装成两个类（`PandasBackend` / `PlainBackend`），接口相同：
`read / flag / quartiles / r_squared / target_vs_peers / melt`。

> 统计口径要对齐：pandas `Series.quantile()` 默认线性插值，等价于
> `statistics.quantiles(values, n=4, method="inclusive")`（Excel `QUARTILE.INC`）；
> 用 `exclusive`（默认值）会得到不同的四分位数。

### 3.2 字段：type / title / format / unit

```python
r = Report("Project Demo", subtitle="Peer valuation snapshot", client="Board of Directors",
           date="2026-10-14", firm="Northbridge Partners", theme="navy")

r.dataset(
    "comps", comps,
    title="Trading comparables",
    source="FactSet; market data as of 13-Oct-2026",        # 页脚 Source 默认取这里
    unit="USD m",
    as_of="2026-10-13",
    notes=["NTM = next twelve months consensus.", "P / E <= 0x or > 60x shown as n.m."],
    fields={
        "company": "Company",                                 # 只改标题：直接写字符串
        "sector": "Sector",
        "is_target": "Target",
        "price_date": {"title": "Price date", "format": "dd mmm yyyy"},
        "price": {"title": "Share price", "format": "$#,##0.00", "unit": "USD"},
        "high_3d": {"title": "3-day high", "format": "$#,##0.00", "unit": "USD"},
        "shares_out": {"title": "Diluted shares", "format": "#,##0.0", "unit": "m"},
        "net_debt": {"title": "Net debt", "format": "$#,##0", "unit": "USD m"},
        "chg_3d": {"title": "3-day change", "format": "+0.0%;-0.0%;0.0%"},
        "mkt_cap": {"title": "Market cap", "format": "$#,##0", "unit": "USD m"},
        "ev": {"title": "Enterprise value", "format": "$#,##0", "unit": "USD m"},
        "ebitda_ntm": {"title": "EBITDA NTM", "format": "$#,##0", "unit": "USD m"},
        "net_income_ntm": {"title": "Net income NTM", "format": "$#,##0;($#,##0)", "unit": "USD m"},
        "revenue_cagr": {"title": "Revenue CAGR 3y", "format": "0.0%"},
        "ev_ebitda_ntm": {"title": "EV / EBITDA NTM", "format": "0.0x"},
        "pe_ntm": {"title": "P / E NTM", "format": "0.0x"},
    },
)
for f in r.datasets["comps"]["schema"]["fields"][:5]:
    print(f)
```

输出（`type` 由数据推断，`fields=` 覆盖其余属性）：

```
{'name': 'ticker', 'type': 'string', 'title': 'ticker'}
{'name': 'company', 'type': 'string', 'title': 'Company'}
{'name': 'sector', 'type': 'string', 'title': 'Sector'}
{'name': 'is_target', 'type': 'boolean', 'title': 'Target'}
{'name': 'price_date', 'type': 'date', 'title': 'Price date', 'format': 'dd mmm yyyy'}
```

常用 format（Excel 风格，见 `kit/core/rk.format.js`）：

| format | 值 | 显示 | 用途 |
|---|---|---|---|
| `0.0x` | 9.64 | `9.6x` | 倍数 |
| `0.0%` | 0.0902 | `9.0%` | 比率（**数据里存小数**，不要存 9.02） |
| `+0.0%;-0.0%;0.0%` | -0.292 | `-29.2%` | 变化 / TSR，带正负号 |
| `$#,##0` | 5624.3 | `$5,624` | USD m（单位写在 `unit` / subtitle） |
| `$#,##0"m"` | 5624.3 | `$5,624m` | KPI 大数字 |
| `$#,##0.00` | 23.95 | `$23.95` | 每股价格 |
| `#,##0;(#,##0)` | -420 | `(420)` | 会计负数 |
| `+#,##0" bps";-#,##0" bps";0" bps"` | 205 | `+205 bps` | 利润率变化（数据存 bps 数值） |
| `dd mmm yyyy` / `mmm yyyy` | 2026-10-13 | `13 Oct 2026` / `Oct 2026` | 日期 |
| `0` | 2025 | `2025` | 年份等整数标签（默认数字格式会显示成 `2,025`） |

`unit` 写在字段上（`"unit": "USD m"`）供 tooltip / 数据表使用；dataset 级 `unit=` 写进 `meta.unit`；
页面 subtitle 里也要写清楚（"USD m unless otherwise stated"）——这是给读 PDF 的人看的。

### 3.3 sources / notes / as of

| 级别 | 写法 | 出现在 |
|---|---|---|
| dataset | `r.dataset(..., source=, notes=, as_of=)` → `meta.source / notes / asOf` | 未显式指定时，页面页脚 Source 自动汇总本页所用 dataset 的 `meta.source`（字符串完全相同才会去重） |
| page | `r.page(..., source=[...], notes=[...])` | 页脚；`source=False` 关闭；多条 notes 自动编号 `(1) (2) …` |
| block | `p.block(..., source=, notes=)` | 图表下方小字；有 block source 时页面不再自动汇总 |

示例里 Trading performance 页同时用了 `comps`（source = 市场数据 + 财务数据）和 `perf`（只有市场数据），
所以显式写了 `source=SRC_MARKET`，避免页脚出现两条重叠的来源。

comps-table 的行内脚注标记（`options.notes = {"Cardwell Software": "(1)"}`）要和页面 notes 的自动编号一致：
示例按 `len(foot)` 生成标记，某个条件不出现时编号不会错位。

### 3.4 缺失值与 n.a. / n.m.

```python
from reportkit import normalize_dataset

demo, warnings = normalize_dataset("demo", [
    {"company": "A", "pe": float("nan"), "ev": float("inf"), "date": "2026-10-13"},
    {"company": "B", "pe": 14.2, "ev": 1250.0, "date": None},
])
print(demo["data"])
print([(f["name"], f["type"]) for f in demo["schema"]["fields"]])
```

```
[{'company': 'A', 'pe': None, 'ev': None, 'date': '2026-10-13'}, {'company': 'B', 'pe': 14.2, 'ev': 1250.0, 'date': None}]
[('company', 'string'), ('pe', 'number'), ('ev', 'number'), ('date', 'date')]
```

| 情况 | 处理 | 显示 |
|---|---|---|
| SQL `NULL`、pandas `NaN` / `NaT` / `pd.NA`、`±inf` | 构建时一律变成 `null` | `n.a.` |
| 没有基期数据（新上市公司没有 FY22A → CAGR 为 NULL） | 保留 `null`，在页脚说明 | `n.a.` + 脚注 |
| 有数但无意义（负 P/E、> 60x） | **保留原值**，在 comps-table 列上设 `"nm": [0, 60]`；SQL 里的 peer median 用同样的阈值过滤 | `n.m.`，且不参与 mean / median |
| 前端公式除零（computed field） | `RK.expr` 返回 NaN | `n.m.` |
| 图表的长表数据 | `dropna()` 掉缺失点（示例的 `melt(...).dropna(...)`） | 不画点 |
| pandas 里含 NULL 的整数列 | 会变成 float（`1` → `1.0`），对 JSON 和显示无影响 | — |

规则：**表格保留 null（读者需要看到 n.a.），图表丢掉 null（不画不存在的点）**。

---

## 4. 第三步：按问题选组件

先问"这一页要回答什么问题"，再选组件。只能用 `kit/components/` 里存在的组件：

```bash
python3 -m reportkit components                       # 当前 kit 的全部组件
python3 -m reportkit components --category valuation  # 按类别
```

| 读者的问题 | 组件 | 关键 encode / options | 示例页 |
|---|---|---|---|
| 关键数字是多少？和同行比如何？ | `kpi-tiles` | `label / value / format / delta / delta_format / period / spark / good` | Executive summary |
| 结论是什么？ | `text-block` | `variant: takeaways / stats / prose`，`items` 用 f-string 填入算出的数 | Executive summary、Capital structure |
| 值多少钱（区间）？ | `football-field` | `label / low / high / group / note`，`refLines` 当前股价 | Executive summary |
| 和可比公司逐项比较 | `comps-table` | `encode.label / highlight`，`columns`（`group / heat / nm / stats`），`groupBy`，`pinTarget` | Trading comparables、Precedents |
| 谁高谁低（排名） | `bar` | `orientation: horizontal`，`sort: desc`，`highlight`，`refLines` 中位数 | Multiples、TSR |
| 两个指标有什么关系？ | `scatter` | `x / y / label / color / target`，`regression: true` | Multiples |
| 随时间如何变化？ | `line` | `x / y / series`（长表），`highlight` | Trading performance / risk |
| 分布多分散？ | `beeswarm` | `label / value / group`，`refLines` | Premiums paid |
| 由什么构成？（≤ 7 项） | `donut` | `label / value`，`layout: labels` | Premiums paid |
| 从 A 怎么走到 B？ | `waterfall` | `label / value / kind (total / delta)` | Capital structure |
| 如果假设变了呢？ | `param-slider` + computed fields | `options.params` | Illustrative offer |
| 只看某个行业 / 地区 | `filter-bar`（top bar） | `r.topbar_block("filter-bar", options={"filters": [...]})` | 全局 |

组件还在持续增加。示例脚本在构建时检查组件是否就绪（manifest **和** `<id>.js` 都存在），
可选组件缺失时自动降级（例如没有 `line` 时改用 `bar`）：

```python
from reportkit import Kit

kit = Kit.locate()
available = {c for c in kit.component_ids() if kit.component_js(c).is_file()}
print(sorted(available & {"bar", "comps-table", "scatter", "line", "param-slider"}))
```

长表 vs 宽表：`line` / `bar` 的 `series` 通道要长表（`date, series, value`）；`bar` 的 `y` 也可以是字段数组
（宽表，每个字段一条 series，例如 `["ref_price", "offer_price"]`）。pandas 用 `melt`，无 pandas 用列表推导。

---

## 5. 第四步：版式（pages / blocks / span / height）

```python
r.cover(kicker="Discussion materials")
r.section("Trading analysis")                                   # 章节页，自动编号 01, 02 …

target = next(row for row in (comps.to_dict("records") if hasattr(comps, "to_dict") else comps)
              if row["is_target"])
gap = target["ev_ebitda_ntm"] - peer_median
p = r.page(f"{target['company'].split()[0]} trades at {target['ev_ebitda_ntm']:.1f}x NTM EBITDA, "
           f"a {abs(gap):.1f}x {'discount' if gap < 0 else 'premium'} to the peer median",   # action title
           kicker="Trading comparables", subtitle="USD m unless otherwise stated",
           notes="Mean and median exclude the target.")
p.block("bar", data="comps", span=7, height=340, title="EV / EBITDA NTM",
        encode={"x": "company", "y": "ev_ebitda_ntm"},
        options={"orientation": "horizontal", "sort": "desc", "highlight": target["company"],
                 "refLines": [{"value": peer_median, "label": f"Peer median {peer_median:.1f}x"}]})
p.block("scatter", data="comps", span=5, height=340, title="EV / EBITDA NTM vs. revenue CAGR",
        encode={"x": "revenue_cagr", "y": "ev_ebitda_ntm", "label": "ticker", "name": "company",
                "color": "sector", "target": "is_target"},
        options={"regression": True})

p = r.page("Trading comparables", kicker="Comps table", subtitle="Market data as of 13-Oct-2026; USD m")
p.block("comps-table", data="comps", title="Selected listed peers",       # 不给 height：表格自适应高度
        encode={"label": "company", "highlight": "is_target"},
        options={"scroll": False, "stats": ["mean", "median"], "groupBy": "sector", "pinTarget": "top",
                 "columns": [{"field": "company"},
                             {"field": "mkt_cap", "group": "Market data"},
                             {"field": "ev", "group": "Market data"},
                             {"field": "ev_ebitda_ntm", "title": "NTM", "group": "EV / EBITDA", "heat": "seq"},
                             {"field": "pe_ntm", "title": "NTM", "group": "P / E", "nm": [0, 60]},
                             {"field": "revenue_cagr", "title": "CAGR 3y", "group": "Operating"}]})
```

| 概念 | 规则 |
|---|---|
| 页面 | `kind="cover" / "section" / "content"`；16:9（打印 13.333 × 7.5 in），屏幕上自适应 |
| action title | **用 f-string 从数据生成**，不要手写数字；数据更新后标题自动跟着变 |
| `span` | 12 栅格，整数 1–12；常用 7/5、6/6、8/4、12 |
| `height` | 数字（px）或 CSS 长度（`"50vh"`）。**不能写 `"auto"`**——自适应高度的 DOM 组件（`kpi-tiles`、`text-block`、`param-slider`、`comps-table` + `scroll: False`）直接省略 `height` |
| 高度预算 | 1440 px 宽屏幕上一页正文约 460 px：单行图表 340–380 正好占满。再叠一行（如 Executive summary 的 `kpi-tiles` + 图表）会超出 16:9，屏幕上页面自动变高——打印前用 Print / PDF 预览检查 |
| id | 页面 id = kicker（或标题）的 slug，block id = 页面 id + block 标题 slug；可在 URL 里 `#trading-comparables` 直达 |
| 导航 | 左侧目录用 kicker；`nav=` 可自定义 |

---

## 6. params 与 computed fields（what-if）

- `r.param(name, value, min=, max=, step=, format=, title=)` 定义参数，公式里写 `@name`。
- `computed=[{"name", "formula", "title", "format"}]` 在**浏览器里**计算，参数变化时实时重算；
  后面的 computed 可以引用前面的（按顺序求值）。
- 可用函数：`abs round min max sqrt ln exp pow div pct_change cagr coalesce if …`（`kit/core/rk.expr.js`）。
- `param-slider` 组件提供滑块；没有滑块时参数取默认值，computed 照样生效。

```python
r.param("premium", 0.30, min=0.10, max=0.50, step=0.025, format="0.0%", title="Offer premium")

terms = {"shares_out": target["shares_out"], "adj_net_debt": target["net_debt"],
         "ebitda_ntm": target["ebitda_ntm"]}                             # 公式用到的常量也作为列
r.dataset("offer", [
    {"reference": "Current price", "ref_price": target["price"], **terms},
    {"reference": "3-day high", "ref_price": target["high_3d"], **terms},
], title="Illustrative offer", source="Northbridge Partners analysis", unit="USD m",
    fields={"reference": "Reference", "ref_price": {"title": "Reference price", "format": "$#,##0.00"}},
    computed=[
        {"name": "offer_price", "formula": "ref_price * (1 + @premium)", "title": "Offer price", "format": "$#,##0.00"},
        {"name": "offer_ev", "formula": "offer_price * shares_out + adj_net_debt", "title": "Implied EV",
         "format": "$#,##0"},
        {"name": "offer_ev_ntm", "formula": "offer_ev / ebitda_ntm", "title": "EV / EBITDA NTM", "format": "0.0x"},
    ])

p = r.page("What-if: offer premium", kicker="Illustrative offer", subtitle="USD")
if "param-slider" in available:
    p.block("param-slider", span=4, title="Assumption", options={"params": ["premium"]})
p.block("bar", data="offer", span=8, height=300, title="Reference vs. offer price",
        encode={"x": "reference", "y": ["ref_price", "offer_price"]})       # computed 字段可直接用于 encode
```

公式里引用了不存在的字段或参数时，`r.check()` 会给出带拼写建议的错误（见 §7）。

---

## 7. 校验（validation）

`r.check()` 返回 `(errors, warnings)`，不抛异常；`r.build()` 默认先校验，**一次列出所有问题**
（`ReportValidationError.errors`）。CI / 脚本里：

```python
errors, warnings = r.check()
for w in warnings:
    print("warning:", w)
assert not errors, "\n".join(errors)
```

一个故意写错的报告，看看错误长什么样：

```python
from reportkit import ReportValidationError

bad = Report("Broken", date="2026-10-14")
bad.dataset("comps", comps, fields={"ev_ebitda": {"format": "0.0x"}},          # 列名拼错 -> warning
            computed=[{"name": "m", "formula": "ev / ebitda_ntmm * @wacc"}])
pg = bad.page("Typos everywhere")
pg.block("barr", data="comps")
pg.block("bar", data="compz", encode={"x": "company", "y": "ev_ebitda_ntm"})
pg.block("bar", data="comps", span=14, height="auto", encode={"x": "company", "y": "ev_ebitda"})

errors, warnings = bad.check()
print("\n".join(errors))
print("\n".join(warnings))
try:
    bad.build("out/broken")
except ReportValidationError as e:
    print(f"build refused: {len(e.errors)} errors")
```

```
dataset 'comps' computed field 'm': formula uses @wacc but no param 'wacc' is defined (add r.param('wacc', value))
dataset 'comps' computed field 'm': formula references unknown field 'ebitda_ntmm' — did you mean 'ebitda_ntm', 'ev_ebitda_ntm'?
page 1 'Typos everywhere' › block 'typos-everywhere-barr' [barr]: unknown component 'barr' (no kit/components/barr/manifest.json) — did you mean 'bar'?
page 1 'Typos everywhere' › block 'typos-everywhere-bar' [bar]: unknown dataset 'compz' — did you mean 'comps'?
page 1 'Typos everywhere' › block 'typos-everywhere-bar-2' [bar]: span must be an integer 1-12, got 14
page 1 'Typos everywhere' › block 'typos-everywhere-bar-2' [bar]: height must be a positive number of px or a CSS length like '50vh', got 'auto'
page 1 'Typos everywhere' › block 'typos-everywhere-bar-2' [bar]: encode.y -> field 'ev_ebitda' is not in dataset 'comps' — did you mean 'ev_ebitda_ntm', 'ebitda_ntm'?
dataset 'comps': fields override for 'ev_ebitda' but the data has no such column (columns: ticker, company, sector, is_target, price_date, price, high_3d, chg_3d, mkt_cap, ev, shares_out, net_debt, ebitda_ntm, net_income_ntm, revenue_cagr, ev_ebitda_ntm, pe_ntm)
build refused: 7 errors
```

| 错误 / 警告 | 原因 | 修复 |
|---|---|---|
| `unknown component 'x'` | 组件不存在或拼错 | `python3 -m reportkit components` 查 id |
| `unknown dataset 'x'` | `data=` 拼错或忘了 `r.dataset()` | 看 did-you-mean |
| `encode.<ch> -> field 'x' is not in dataset` | SQL 列名改了、或用了 alias 之前的名字 | 列名以 SQL `AS` 为准；computed 字段也算 |
| `required channel 'y' is not mapped` | 必填通道没映射，dataset 里也没有默认字段名 | 加 `encode={"y": "..."}` |
| `formula uses @x but no param 'x'` / `unknown field` | 公式引用错误 | `r.param()` / 修正字段名 |
| `span must be an integer 1-12` / `height must be …` | 版式参数非法 | 见 §5（`"auto"` 不合法，省略即可） |
| `fields override for 'x' but the data has no such column`（warning） | `fields=` 写了数据里没有的列 | 通常是拼写错误，务必处理 |
| `dataset 'x' has N rows (> 50,000)`（warning） | 明细太多，全部会发到浏览器 | 在 SQL 里先聚合 / 抽样（示例把日线抽成周线） |
| `duplicate id` | 显式 id 重复 | 改 id 或不写（自动生成） |

---

## 8. 构建与交付（build & delivery）

```python
import shutil

out = r.build("out/project-demo")              # 先校验再写文件；返回文件夹路径
zip_path = shutil.make_archive("out/project-demo", "zip", root_dir=out.parent, base_dir=out.name)
print(out / "index.html")
print(zip_path)
```

- **确定性**：同样的输入 → 逐字节相同的输出；重跑 pipeline 只更新数字时，git diff 只出现在 `data/`（每行一条记录）。
- **clean**：`build()` 默认只清理上一次 ReportKit 生成的 `index.html / assets / data`，不会删除别人的文件夹。
- **交付（文件夹）**：把整个文件夹打成 zip。提醒客户**先"全部解压"再双击 `index.html`**——在 Windows 的压缩包预览里直接打开只会解出 `index.html` 本身，脚本和数据找不到。部分邮件网关会拦截含 `.js` 的压缩包，用公司的安全文件传输渠道。

### 8.1 单文件交付（推荐给客户）

```python
html_file = r.build("out/delivery", single_file=True, excel=True)
print(html_file)                         # out/delivery/project-demo.html  (+ out/delivery/project-demo.xlsx)
```

| 选项 | 产物 | 说明 |
|---|---|---|
| `single_file=True` | `<out_dir>/<slug>.html`（或直接给 `"…/name.html"`） | CSS、字体（base64）、第三方库、运行时、组件、数据全部内联；双击即开，无需解压，**零网络请求**；内联脚本转义了 `</script>` / `<!--` / U+2028 |
| `excel=True` | `data/<slug>.xlsx`（单文件模式在 html 旁边） | 每个 dataset 一个工作表：标题、Source / Notes / Unit / As of、加粗表头、**沿用字段格式码的数字格式**（`0.0x`、`0.0%`、`$#,##0` …）、真正的日期、冻结表头、筛选、列宽；报告右上角出现 Excel 下载按钮。需要 `openpyxl` |
| `data_source="api"` + `single_file=True` | 一个 html，不含数据 | 页面从数据 API 取数（§9） |

命令行等价写法：`python -m reportkit build spec.json out/delivery --single-file --excel [--locale zh-CN]`。

单文件的体积 ≈ 文件夹里 `assets/` + `data/bundle.js` 之和（示例 pitchbook 约 3.4 MB；用到地图时 +0.1 MB，
`basemap: "world-50m"` 高精度底图 +0.75 MB）。数据很大（> 50k 行，构建时会警告）时仍建议文件夹 + 内网托管。

### 8.2 面向客户的细节：标题模板、语言、不受筛选影响的页面

- **标题跟着筛选变**：action title 里的数字写成模板，客户筛选后标题仍然正确（不会出现“图是欧洲、标题是全球”）：

  ```python
  r.page("Peers trade at a median {{comps: median(ev_ebitda_ntm) | 0.0x}} NTM EBITDA "
         "({{comps: count()}} companies)", kicker="Trading comparables")
  r.page("Offer at a {{@premium | 0%}} premium to the current share price", kicker="Offer")  # 只用参数时可省略 dataset
  ```

  语法 `{{<dataset>: <公式> | <格式码>}}`：聚合函数作用于**筛选后**的行，普通字段取筛选后的第一行；
  构建时校验 dataset / 字段 / `@param` 是否存在。HTML 里是 `data-rk-template="…"`，未运行脚本时显示 `…`。
- **筛选提示**：有全局筛选或图表选中时，受影响页面的页脚自动出现 “Filtered view: Region = Europe · …”，
  打印成 PDF 也保留——客户转发截图时不会被误读成全量数据。
- **不受筛选影响的页**：`r.page("Whole-market context", filters=False)`（`data-rk-filters="off"`），该页图表始终显示全量数据，也不显示筛选提示。
- **中文客户**：`Report(..., locale="zh-CN", updown="cn", confidentiality="严格保密")`——界面文字、来源 / 注、日期（2026年10月14日）、
  紧凑单位（亿 / 万）切换为中文，`updown="cn"` 红涨绿跌（默认 `"us"` 绿涨红跌）。保密声明默认是英文，需显式传入中文。
- **客户自选指标**：`options={"choices": {"y": ["ev_ebitda_ntm", "pe_ntm", "*computed"]}}` 在模块标题栏放一个下拉框；
  客户在 query-console 里“添加为指标”的自定义公式会出现在 `*computed` 中，并保存在客户本机浏览器的 localStorage
  （键 `rk:metrics:<报告标题>|<日期>|<构建日期>`，按报告区分；在控制台“我的指标”中删除）。重新构建同一份报告（标题、日期不变）
  后这些指标仍然有效；希望所有读者都看到的指标，请写进 `r.dataset(..., computed=[...])`。
- **交叉选择不会“点空”页面**：某个模块若仅因其他图表的点选而无数据，会忽略这些点选并提示 “Selection not in this view”
  （模块 `options={"selectionFallback": False}` 关闭；`"badges": False` 隐藏徽标）。
- **file:// vs http(s)**：

| 打开方式 | 数据从哪来 | 说明 |
|---|---|---|
| 双击 `index.html`（`file://`） | `data/bundle.js`（`RK.data.preload`） | 离线、无需服务器；浏览器禁止 file:// 下 fetch JSON，所以需要 bundle |
| `python3 -m http.server 8000 -d out/project-demo` | 仍然是 `bundle.js`（已加载就优先使用） | 内网 / SharePoint 静态托管同理 |
| http(s) 且去掉 `<script src="data/bundle.js">` | `fetch data/manifest.json` + `data/datasets/<id>.json` | 数据文件可单独替换，无需重建页面 |
| `<meta name="rk:data-source" content="api">` | 数据 API（§9） | 同样的 JSON 形状 |

- **浏览器冒烟测试**：`node tools/smoke.cjs --page examples/sql-pipeline-report/index.html`（console error 即失败，截图到 `tests/screens/`）。
  更严格的检查是在页面里滚动一遍后断言 `RK.blocks().every(b => b.state === 'rendered')`——示例报告就是这样验证的（`rendered` 之外还有 `idle` 未滚动到、`empty` 筛选后无数据、`error` 渲染失败）。
- **打印 / PDF**：右上角 Print / PDF，每页一张 16:9（`Report(page_size="letter" | "a4")` 改为 Letter / A4 横向）。
  内容溢出模块的宽表 / 长表在打印时自动缩小适配（最小 0.55 倍；模块 `options={"printFit": False}` 关闭），缩到下限仍放不下的要拆页。

---

## 9. 切换到数据 API

页面不变，只换数据来源。前端约定（`kit/core/rk.data.js`）：

```
GET {rk:api}manifest            -> 与 data/manifest.json 相同的 JSON
GET {rk:api}datasets/{id}       -> 与 data/datasets/<id>.json 相同的 JSON
```

**构建时直接选择 API 模式**（推荐）：

```python
api_out = r.build("out/project-demo-api", data_source="api",
                  api="http://127.0.0.1:8765/api/reports/project-demo/")
print([line.strip() for line in (api_out / "index.html").read_text(encoding="utf-8").splitlines()
       if 'name="rk:api"' in line or 'name="rk:data-source"' in line])
```

`index.html` 不再引用 `data/bundle.js`，并带上 `rk:data-source` / `rk:api` 两行 meta；`data/` 仍会写出，可直接作为 API 的静态内容。
也可以与 `single_file=True` 同用（一个 html，数据从 API 取）。

**转换一个已经构建好的文件夹**（不重新跑 pipeline 时）——改动只有两处：

1. **删除 `<script src="data/bundle.js"></script>`**——preload 的 bundle 优先级最高，留着它 API 永远不会被调用；
2. 在 `<head>` 加两行 meta：

```html
<meta name="rk:data-source" content="api">
<meta name="rk:api" content="https://data.example-bank.com/api/reports/project-demo/">
```

用 Python 对已构建的文件夹做这个转换：

```python
from pathlib import Path

def to_api_mode(folder, api_base):
    """Point a built report at a data API: drop the preloaded bundle, add the rk:data-source / rk:api metas."""
    html = Path(folder, "index.html")
    text = html.read_text(encoding="utf-8")
    text = text.replace('  <script src="data/bundle.js"></script>\n', "")
    text = text.replace('<meta name="rk:data" content="data/">',
                        '<meta name="rk:data" content="data/">\n'
                        '  <meta name="rk:data-source" content="api">\n'
                        f'  <meta name="rk:api" content="{api_base}">')
    html.write_text(text, encoding="utf-8")

api_copy = Path("out/project-demo-converted")
shutil.rmtree(api_copy, ignore_errors=True)
shutil.copytree(out, api_copy, ignore=shutil.ignore_patterns("data"))   # 页面不再带数据
to_api_mode(api_copy, "http://127.0.0.1:8765/api/reports/project-demo/")
print(sorted(p.name for p in api_copy.iterdir()))
```

一个最小的数据 API（把已构建报告的 `data/` 按 API 形状提供；真实系统里在这里查数据库，
用 `reportkit.normalize_dataset(id, df, fields=...)` 生成与构建时完全相同的 JSON）：

```python
# file: api_server.py   用法: python3 api_server.py out/project-demo/data
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "out/project-demo/data")
PREFIX = "/api/reports/project-demo/"


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b""):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")            # 报告与 API 不同源时需要 CORS
        self.send_header("Access-Control-Allow-Headers", "Authorization")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):                                                 # 带 Authorization 头时的 preflight
        self._send(204)

    def do_GET(self):
        path = unquote(self.path.split("?")[0])
        if path == PREFIX + "manifest":
            file = DATA / "manifest.json"
        elif path.startswith(PREFIX + "datasets/") and re.fullmatch(r"[\w.-]+", path[len(PREFIX) + 9:]):
            file = DATA / "datasets" / (path[len(PREFIX) + 9:] + ".json")
        else:
            return self._send(404, json.dumps({"error": "not found"}).encode())
        if not file.is_file():
            return self._send(404, json.dumps({"error": "not found"}).encode())
        self._send(200, file.read_bytes())


ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
```

```bash
python3 api_server.py out/project-demo/data &       # 启动 API
# 然后双击 out/project-demo-api/index.html：页面从 API 取数，渲染结果与离线版相同
```

需要鉴权时，关闭自动启动并自己调用 `RK.boot`，token 会以 `Authorization: Bearer …` 发送：

```html
<html lang="en" data-rk-theme="navy" data-rk-autoboot="false">
…
<script>RK.boot({ token: window.sessionStorage.getItem('rk:token') });</script>
```

其他来源（例如公司内部的 GraphQL）可以在 `reportkit.js` 之后的 `<script>` 里注册自定义 adapter：
`RK.data.adapter('my-source', cfg => Promise.resolve({manifest, datasets}))` 并设置
`<meta name="rk:data-source" content="my-source">`。只要返回同样的 JSON 形状，所有组件无需改动。

---

## 10. 交付前检查清单

- [ ] `r.check()` 没有 error，warning 逐条看过（尤其是 `fields override … no such column`）
- [ ] 每个 dataset 有 `source`、`unit`、`as_of`；比率存小数、bps 存数值，format 正确
- [ ] action title 由数据生成（随筛选变化的数字用 `{{dataset: 公式 | 格式}}` 模板）；页面 subtitle 写明单位；脚注编号与表内标记一致
- [ ] null（n.a.）与 n.m. 的口径在表格和 peer median 中一致（同一个阈值）
- [ ] 只用了 `kit/components/` 里存在的组件；可选组件有降级方案
- [ ] 无 pandas 环境也能跑（`--no-pandas` / `--parity`）
- [ ] 浏览器打开无 console error，所有 block `rendered`；打印预览每页 16:9
- [ ] zip 后在另一台机器解压、双击验证；或交付单文件（`single_file=True`）并在断网环境双击验证
- [ ] 需要给客户底稿时加 `excel=True`，用 Excel 打开检查格式（倍数 `x`、百分比、日期）
- [ ] 筛选到一个子集（如 Europe）后：action title 的数字、图表、页脚 “Filtered view” 一致；不该被筛选的页设了 `filters=False`
- [ ] 中文客户：`locale="zh-CN"`、中文 `confidentiality`、需要时 `updown="cn"`；打印预览中宽表没有被裁掉
