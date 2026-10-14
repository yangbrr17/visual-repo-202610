# ReportKit · 投行客户报告可视化组件框架

把 Python / SQL 的分析结果，生成**投行 pitchbook 质感**的交互式报告：一个自包含的文件夹，
**HTML · CSS · JS · DATA 严格分离**，客户双击 `index.html` 即可离线打开，可以缩放、筛选、交叉联动、
做 what-if 假设分析、输入自己的指标进行查询，也能一键打印成 16:9（或 Letter / A4）PDF。

<p>
<img src="gallery/thumbs/demo-valuation.jpg" width="49%" alt="估值页：足球场图 + DCF 敏感性分析">
<img src="gallery/thumbs/demo-footprint.jpg" width="49%" alt="全球布局：分级设色地图 + 气泡地图">
<img src="gallery/thumbs/demo-financials.jpg" width="49%" alt="财务概览：柱线组合图 + EBITDA 桥">
<img src="gallery/thumbs/demo-comps.jpg" width="49%" alt="可比公司表">
</p>

> 以上截图来自示例报告 **Project Atlas**（虚构公司与数据）：[`examples/demo-pitchbook/index.html`](examples/demo-pitchbook/index.html) · [PDF](examples/demo-pitchbook.pdf)

---

## 快速开始

```bash
# 1) 组件库网站：分门别类展示全部组件（双击即可，离线可用）
open gallery/index.html

# 2) 用 Python 生成示例报告（无第三方依赖；pandas 可选）
python3 py/examples/build_demo.py          # -> examples/demo-pitchbook/
python3 py/examples/sql_pipeline.py        # SQL -> pandas -> metrics -> 报告 的完整链路示例

# 3) 打开生成的报告（双击即可）
open examples/demo-pitchbook/index.html
```

在自己的分析流程里：

```python
from reportkit import Report            # PYTHONPATH=py 或 pip install -e py

r = Report("Project Atlas", subtitle="Discussion materials", client="Board of Directors",
           date="2026-10-14", theme="navy", firm="Northbridge Capital")
r.dataset("peers", df_peers, title="Trading comparables", source="FactSet as of 10-Oct-2026",
          fields={"ev_ebitda_25e": {"title": "EV/EBITDA 2025E", "format": "0.0x"}})
r.param("wacc", 0.09, min=0.075, max=0.105, step=0.0025, format="0.00%", title="WACC")

p = r.page("Helios trades at a discount to peers", kicker="Valuation", subtitle="USD m")
p.block("football-field", data="valuation_ranges", span=7, height=360,
        options={"refLines": [{"value": 42.5, "label": "Current $42.50"}]})
p.block("comps-table", data="peers", span=5, height="auto", options={"groupBy": "sector", "stats": ["mean", "median"]})

r.build("out/atlas")                     # data_source="api", api="https://.../" 切换为数据接口模式
```

完整指南：[`py/README.md`](py/README.md) · [`docs/pipeline-guide.md`](docs/pipeline-guide.md)

## 输出的报告文件夹（结构化、数据独立）

```
out/atlas/
  index.html                 只有版式与绑定（哪个组件、绑定哪个数据集、options）
  assets/css/reportkit.css   设计 token + 主题 + 版式 + 已用组件样式
  assets/js/reportkit.js     运行时（classic script，file:// 可用）
  assets/js/components/*.js  只打包本报告用到的组件
  assets/vendor/*            只打包用到的第三方库（附 LICENSE）
  assets/fonts/              离线字体（Inter, Source Serif 4；OFL）
  data/manifest.json         报告元信息 + 数据集索引 + 参数
  data/datasets/<id>.json    每个数据集一个文件：schema + records + meta(source/notes/unit)
  data/bundle.js             同一份数据的 file:// 版本（双击打开时使用）
```

- **数据与版式分离**：数据集是独立 JSON（Frictionless Table Schema 风格，Excel 格式码），将来可直接换成数据 API：
  `build(data_source="api", api="https://host/api/reports/42/")`，同样的 JSON 形状（见 [`docs/architecture.md`](docs/architecture.md)）。
- **离线**：不依赖任何 CDN / 在线瓦片 / 外部字体；世界底图来自 Natural Earth（随库打包）。

## 组件库（57 个，12 个类别）

在 [`gallery/index.html`](gallery/index.html) 中每个组件都有：实时示例（多种变体）、能展示什么 / 适用与不适用场景、
数据通道（channel → 字段）、全部配置项、交互说明、Python / HTML / JSON 用法代码、示例数据预览。
完整目录：[`docs/component-catalog.md`](docs/component-catalog.md)。

| 类别 | 数量 | 组件 |
|---|---|---|
| 版式与叙事 · Layout & narrative | 3 | `tombstones` 交易业绩墓碑卡, `kpi-tiles` 关键指标卡, `text-block` 叙事文本块 |
| 交互控件与查询 · Controls & query | 4 | `filter-bar` 全局筛选栏, `param-slider` 参数滑块（假设分析）, `query-console` 自助分析控制台, `scenario-switch` 情景切换器 |
| 估值分析 · Valuation | 3 | `avp-table` 不同报价下的估值分析表（AVP）, `football-field` 估值足球场图, `sotp` 分部加总估值（SOTP） |
| 时间趋势 · Change over time | 8 | `calendar-heatmap` 日历热力图, `candlestick` K 线图与成交量, `combo` 柱线组合图（双轴）, `line` 折线图 / 面积图, `price-volume` 股价与成交量图, `slope` 斜率图, `small-multiples` 小多图, `multiple-history` 历史估值倍数走势图 |
| 规模与排名 · Magnitude & ranking | 7 | `bar` 柱状图 / 条形图, `bullet` 子弹图, `bump` 排名变化图, `dumbbell` 哑铃图, `lollipop` 棒棒糖排名图, `parallel` 平行坐标图, `radar` 雷达图 |
| 桥接与偏差 · Bridges & deviation | 2 | `diverging-bar` 正负偏差条形图, `waterfall` 瀑布图 / 桥接图 |
| 结构占比 · Part-to-whole | 5 | `donut` 环形图, `marimekko` 马赛克图 / 市场地图, `sunburst` 旭日图, `treemap` 矩形树图, `waffle` 华夫饼图 |
| 分布与相关 · Distribution & correlation | 6 | `beeswarm` 蜂群图, `boxplot` 箱线图, `bubble` 气泡图（四维散点）, `heatmap` 热力矩阵, `histogram` 直方图, `scatter` 散点图（回归 / 象限） |
| 流向与关系 · Flow & relationships | 5 | `chord` 弦图, `funnel` 漏斗图, `network` 关系网络图, `sankey` 桑基图, `tree` 股权 / 组织结构图 |
| 地理空间 · Geospatial | 6 | `bubble-map` 气泡地图, `china-tilemap` 中国省份方块地图（无边界，规避审图号问题）, `choropleth` 分级设色地图, `cluster-map` 聚合点地图, `flow-map` 流向地图, `geo-heat` 地理热力图 |
| 表格 · Tables | 6 | `comps-table` 可比公司 / 先例交易表, `data-grid` 交互式数据表格, `league-table` 排行榜, `pivot-table` 数据透视表, `sensitivity-table` 敏感性分析表, `sources-uses` 资金来源与运用表 |
| 流程与时间线 · Process & timeline | 2 | `gantt` 交易时间表 / 甘特图, `timeline` 里程碑时间线 |

### 交互能力（客户在报告里能做什么）

- **缩放**：时间序列 / 大数据量图表支持滑块与 Ctrl/⌘+滚轮（或触控板捏合）缩放；地图可缩放平移。普通滚轮始终滚动页面。
- **筛选与交叉联动**：顶栏全局筛选（多选、区间、搜索）；点击任意图表元素即对其他图表交叉筛选，已选中的高亮、其余变淡；筛选标签可一键清除。
- **What-if**：参数滑块（如 WACC、永续增长率）驱动公式字段，图表实时重算（链式公式也会更新）。
- **自助查询**：`query-console` 支持构建器（选指标 / 分组 / 筛选）与查询语句两种方式，例如
  `median(ev_ebitda_25e) by sector from peers where region == "Europe" sort 2 desc`；
  支持自定义公式（`ev / ebitda_25e as "EV/EBITDA" format "0.0x"`），可一键“添加为指标”供其他图表使用。
  语言参考：[`docs/formula-language.md`](docs/formula-language.md)（安全求值，无 `eval`）。
- **导出**：每个模块可查看数据、导出 CSV、导出 PNG；整份报告可打印为矢量 PDF（版式与屏幕一致）。
- **主题**：navy（经典投行深蓝）、bronze（暖色精品投行）、slate（现代咨询风）、ink（暗色演示）运行时切换；
  新主题 = 复制一个 CSS token 文件（[`docs/design-system.md`](docs/design-system.md)）。

## 设计规范（对标 GS / J.P. Morgan pitchbook）

action title（一句话结论）+ kicker（章节）+ 单位副标题；正文 Inter（等宽数字）+ 标题 Source Serif 4；
目标公司用唯一高亮色，报价 / 现价参考线用红色虚线，均值 / 中位数用灰色虚线；每页 Source / Notes / 保密声明 / 页码；
色板经色盲可辨性（CVD）与对比度验证。详见 [`docs/design-system.md`](docs/design-system.md)。

## 调研（开源生态）

9 个方向、239 个开源项目，结论与选型理由见 **[`research/landscape.md`](research/landscape.md)**（中文）：

- 主引擎 **Apache ECharts 6.1**（Apache-2.0）；地图 **Leaflet 1.9.4** + markercluster + heat（离线 Natural Earth 底图）；
  交互表格 **Tabulator 6.6**；版式表格、公式 / 查询引擎、动效均为自研（零依赖）。
- 许可红旗：ApexCharts 5.1+ 非开源许可、GSAP 非 OSI 许可、AG Grid / AG Charts 企业版功能、Highcharts / amCharts 商业许可、
  TradingView 署名要求、npm 上的 SheetJS 有 CVE、中国地图审图号合规、AntV L7 默认外联 logo。
- 已打包好的大仓库 / 画廊：[`research/awesome-collections.md`](research/awesome-collections.md)；
  中文生态与小红书推荐：[`research/china-ecosystem.md`](research/china-ecosystem.md)；
  结构化目录：[`research/catalog.json`](research/catalog.json)（gallery「开源调研」页可筛选）；原始笔记：`research/raw/`。

## 仓库结构

```
kit/            前端框架源码：core/（运行时、格式、公式与查询引擎、数据层、主题、图表/地图适配、动效）、
                styles/（token、4 套主题、版式、打印）、components/<id>/（JS + CSS + manifest.json）、samples/（41 个示例数据集）
vendor/         第三方库固定版本 dist + LICENSE（tools/vendor.py 可复现；LICENSES.md 汇总）
py/reportkit/   Python 构建器（Report / Page / Block、校验、CLI：python -m reportkit build|validate|components|new-component）
gallery/        组件库网站（离线可用）
examples/       示例报告：demo-pitchbook（+ PDF）、sql-pipeline-report
docs/           架构契约、设计规范、公式语言、流水线指南、Step 2 路线图、组件目录
research/       调研报告与原始笔记、引擎审计
tools/          vendor.py、build_catalog.py、build_geo.py、make_sample_data.py、smoke.cjs、harness.html、check.sh
tests/          js（公式 / 格式 / 查询引擎，约 940 个用例）、py（构建器）、e2e（示例报告与 gallery，含 file:// 与打印）
```

## 质量保障

```bash
bash tools/check.sh          # vendor 校验 + Python 测试 + JS 引擎测试 + 目录校验 + 57 个组件浏览器冒烟测试 + gallery
node tests/e2e/demo.cjs --pdf    # 示例报告：file:// 打开、筛选 / 滑块 / 查询联动、打印 PDF
node tests/e2e/gallery.cjs       # gallery 全部路由（file:// 与 http，含 390px 移动端）
```

- 引擎经过对抗性审计（36 项问题全部修复：Excel 一致的四舍五入、原型链安全、查询格式推断、防挂死），见 `research/engine-audit.md`。
- 组件经过 4 套主题 × 2 种宽度的视觉 QA，以及 XSS 模糊测试（恶意字符串注入每个数据集与配置项）。

## Step 2

数据 API、客户导入 skills、接入本地部署大模型（输出受限于本库的查询语言与 block 规格，而非任意代码）：
[`docs/roadmap-step2.md`](docs/roadmap-step2.md)。

## 许可

本仓库代码供内部使用。第三方组件各自的许可证随 `vendor/` 与 `kit/fonts/` 一同分发（均为 Apache-2.0 / MIT / BSD / ISC / OFL），
汇总见 [`vendor/LICENSES.md`](vendor/LICENSES.md)。示例中的公司、银行、投资者与数据均为虚构。
