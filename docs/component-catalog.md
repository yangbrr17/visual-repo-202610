# 组件目录 Component catalogue

由 `tools/build_catalog.py` 自动生成 · 3 components · 12 categories

## 版式与叙事 · Layout & narrative

封面、关键数字、核心结论与文字说明，搭建报告的叙事骨架。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `kpi-tiles` | 关键指标卡 / KPI Tiles | dom | 关键指标数字卡片：数字滚动动画、同比/环比变化（自动判断好坏方向）与迷你趋势线。 | `label`*, `value`*, `format`, `delta`, `deltaFormat`, `period`, `spark`, `good` |

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

`*` = required channel / 必填通道
