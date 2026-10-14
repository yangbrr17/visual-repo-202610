# 组件目录 Component catalogue

由 `tools/build_catalog.py` 自动生成 · 10 components · 12 categories

## 版式与叙事 · Layout & narrative

封面、关键数字、核心结论与文字说明，搭建报告的叙事骨架。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `kpi-tiles` | 关键指标卡 / KPI Tiles | dom | 关键指标数字卡片：数字滚动动画、同比/环比变化（自动判断好坏方向）与迷你趋势线。 | `label`*, `value`*, `format`, `delta`, `deltaFormat`, `period`, `spark`, `good` |
| `text-block` | 叙事文本块 / Text Block | dom | 页面叙事模块：安全 Markdown 子集正文、编号要点卡片、强调框、衬线体引言、大数字统计（数字滚动），可用 {{字段\|格式}} 占位符从数据集实时取数。 | `title`, `text`, `value`, `label`, `format`, `note` |

## 交互控件与查询 · Controls & query

全局筛选、情景切换、参数假设（what-if）与客户自助查询控制台。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `scenario-switch` | 情景切换器 / Scenario Switch | dom | 带滑动指示条的分段切换控件（基准 / 乐观 / 悲观），为整份报告设置情景筛选或共享状态。 | `field` |

## 估值分析 · Valuation

估值足球场图等估值总结类图表。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `football-field` | 估值足球场图 / Football Field | echarts | 按估值方法展示估值区间的横向浮动条形图，叠加当前股价 / 报价参考线。 | `label`*, `low`*, `high`*, `group`, `note`, `order` |

## 规模与排名 · Magnitude & ranking

比较同业、业务板块或不同期间的规模与排名。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `bar` | 柱状图 / 条形图 / Bar / Column Chart | echarts | 比较不同类别的数值大小：分组、堆叠、百分比堆叠、横向排名。 | `x`*, `y`*, `series` |

## 桥接与偏差 · Bridges & deviation

从一个数字走到另一个数字（如 EBITDA 桥），以及相对基准的偏差。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `waterfall` | 瀑布图 / 桥接图 / Waterfall / Bridge | echarts | 从期初总额经过各项正负变动走到期末总额的桥接图：EBITDA 桥、企业价值到股权价值桥、预算差异分析。 | `label`*, `value`*, `kind`, `category` |

## 结构占比 · Part-to-whole

结构、份额与层级：环形图、矩形树图、旭日图、马赛克图。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `donut` | 环形图 / 饼图 / Donut / Pie | echarts | 部分与整体关系的环形图：中心总数滚动动画，侧边图例表（数值 · 占比）或引线标签，超出数量自动归入“其他”。 | `label`*, `value`* |

## 分布与相关 · Distribution & correlation

散点、气泡、热力矩阵、箱线图——指标间的关系与分布。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `beeswarm` | 蜂群分布图 / Beeswarm | echarts | 把每个观测值画成互不重叠的点，按分组逐行排列，叠加四分位区间和中位数刻度，直观展示离散程度以及目标公司所处位置。 | `label`*, `value`*, `group`, `size`, `target` |
| `scatter` | 散点图（回归 / 象限） / Scatter Plot | echarts | 带标签的双指标散点图：回归线与 R²、中位数象限、目标公司高亮、框选交叉筛选。 | `x`*, `y`*, `label`, `name`, `color`, `target` |

## 表格 · Tables

可比公司表、敏感性分析表、透视表与交互式数据表格。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `comps-table` | 可比公司 / 先例交易表 / Comparables Table | dom | 投行标准的可比公司 / 先例交易表：多级表头、按行业分节、均值 / 中位数 / 最高 / 最低统计行、目标公司高亮。 | `label`*, `highlight`, `note` |

`*` = required channel / 必填通道
