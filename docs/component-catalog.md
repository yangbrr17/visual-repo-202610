# 组件目录 Component catalogue

由 `tools/build_catalog.py` 自动生成 · 53 components · 12 categories

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
| `filter-bar` | 全局筛选栏 / Filter Bar | dom | 全局筛选栏：可搜索的多选下拉框、双滑块区间、文本搜索和开关，并以标签行汇总当前筛选（包括图表点击产生的交叉筛选）。 |  |
| `param-slider` | 参数滑块（假设分析） / Parameter Sliders (What-if) | dom | 绑定报告参数（@wacc、@tgr 等）的假设分析滑块：拖动后所有引用该参数的计算字段实时重算，图表同步更新。 |  |
| `query-console` | 自助分析控制台 / Query Console | echarts | 客户自助分析控制台：透视表式“构建器”与带实时校验的查询编辑器，结果以格式化表格 + 自动图表呈现，支持 CSV 导出、查询历史和“保存为指标”。 |  |
| `scenario-switch` | 情景切换器 / Scenario Switch | dom | 带滑动指示条的分段切换控件（基准 / 乐观 / 悲观），为整份报告设置情景筛选或共享状态。 | `field` |

## 估值分析 · Valuation

估值足球场图等估值总结类图表。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `football-field` | 估值足球场图 / Football Field | echarts | 按估值方法展示估值区间的横向浮动条形图，叠加当前股价 / 报价参考线。 | `label`*, `low`*, `high`*, `group`, `note`, `order` |

## 时间趋势 · Change over time

股价、财务指标、估值倍数随时间的变化。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `calendar-heatmap` | 日历热力图 / Calendar Heatmap | echarts | 日历热力图：按日（交易活跃度、成交量，顺序色）或按年 × 月网格（月度回报，发散色、单元格标注百分比、复利全年列）展示时间数据。 | `date`, `value`*, `year`, `month` |
| `candlestick` | K 线图（OHLC）与成交量 / Candlestick (OHLC) & Volume | echarts | 日 K 线（开高低收）+ 按涨跌着色的成交量副图，叠加移动均线与事件标注，默认显示最近 6 个月并可缩放。 | `x`*, `open`*, `high`*, `low`*, `close`*, `volume` |
| `combo` | 柱线组合图（双轴） / Combo: Bars + Line | echarts | 柱状 + 折线双轴组合图：如收入柱 + EBITDA 利润率折线（右轴 %），预测年份斜线填充，可加 CAGR 箭头标注。 | `x`*, `bars`*, `series`, `line`, `period` |
| `line` | 折线图 / 面积图 / Line / Area Chart | echarts | 多系列时间趋势：股价相对表现（重设基数为 100）、目标公司高亮、线端直接标注、预测期虚线、事件编号标注与缩放。 | `x`*, `y`*, `series` |
| `price-volume` | 股价与成交量图 / Share Price & Volume | echarts | 日度股价折线 + 成交量副图：移动均线、52 周高低点、VWAP、事件编号标注、最新价标签，两图共享缩放。 | `x`*, `close`*, `volume`, `high`, `low` |
| `slope` | 斜率图（两期对比） / Slope Chart | echarts | 两期斜率图：每条线连接同一对象在两个时点的数值，两侧标注名称和数值，按升降着色并突出目标公司。 | `label`*, `from`, `to`, `period`, `value`, `highlight`, `group` |
| `small-multiples` | 小多图（分面趋势） / Small Multiples | echarts | 分面小多图：每个业务板块 / 地区 / 序列一个迷你折线、面积或柱状图，可共享或独立 y 轴，末值标签，十字准线跨面板联动。 | `x`*, `y`*, `facet`* |
| `multiple-history` | 历史估值倍数走势图 / Trading Multiple History | echarts | NTM EV/EBITDA（或 P/E）历史走势：期间均值线、±1σ / ±2σ 阴影带、当前值标签，可叠加同业中位数对比。 | `x`*, `y`*, `compare` |

## 规模与排名 · Magnitude & ranking

比较同业、业务板块或不同期间的规模与排名。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `bar` | 柱状图 / 条形图 / Bar / Column Chart | echarts | 比较不同类别的数值大小：分组、堆叠、百分比堆叠、横向排名。 | `x`*, `y`*, `series` |
| `bullet` | 子弹图 / Bullet Chart | echarts | 逐行展示实际值对比目标值，背景为定性区间（差 / 中 / 好），右侧附实际值与差异列。 | `label`*, `value`*, `target`, `bands`, `highlight`, `format` |
| `bump` | 排名变化图（Bump Chart） / Bump Chart (Rank over Time) | echarts | 展示排名随时间（或跨市场）的变化：每个主体一条线，第 1 名在最上方，节点内标注名次，两端直接标注名称。 | `x`*, `series`*, `value`, `rank` |
| `dumbbell` | 哑铃图 / 区间点图 / Dumbbell / Range Dot Plot | echarts | 每个类别两个数值以线段相连：前后对比、一致预期对比实际、52 周最低/最高价加当前股价标记。 | `label`*, `from`*, `to`*, `marker`, `highlight` |
| `lollipop` | 棒棒糖排名图 / Lollipop Ranking | echarts | 细杆加圆点的排名图：类别较多时比柱状图更清爽，支持高亮目标公司、中位数参考线以及第二个数值点（如 2025E 对比 2026E）。 | `label`*, `value`*, `value2`, `highlight`, `group` |
| `parallel` | 平行坐标图 / Parallel Coordinates | echarts | 多指标筛选：每个指标一条纵轴、每家公司一条折线；在任意轴上拖选区间即可交叉筛选报告中的其他图表。 | `label`*, `color`, `target` |
| `radar` | 雷达图（蛛网图） / Radar (Spider) Chart | echarts | 在 4–8 个维度上同时对标目标公司与同业：目标公司为 accent-2 填充多边形，同业为细线轮廓，可叠加同业中位数虚线多边形。 | `series`*, `axis`*, `value`*, `target` |

## 桥接与偏差 · Bridges & deviation

从一个数字走到另一个数字（如 EBITDA 桥），以及相对基准的偏差。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `diverging-bar` | 正负偏差条形图 / Diverging Bar | echarts | 以 0 或基准值（如同业中位数）为中轴的正负条形图：业绩超预期/不及预期、股东总回报、预算差异。 | `label`*, `value`*, `highlight` |
| `waterfall` | 瀑布图 / 桥接图 / Waterfall / Bridge | echarts | 从期初总额经过各项正负变动走到期末总额的桥接图：EBITDA 桥、企业价值到股权价值桥、预算差异分析。 | `label`*, `value`*, `kind`, `category` |

## 结构占比 · Part-to-whole

结构、份额与层级：环形图、矩形树图、旭日图、马赛克图。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `donut` | 环形图 / 饼图 / Donut / Pie | echarts | 部分与整体关系的环形图：中心总数滚动动画，侧边图例表（数值 · 占比）或引线标签，超出数量自动归入“其他”。 | `label`*, `value`* |
| `marimekko` | 马赛克图 / 市场地图 / Marimekko / Market Map | echarts | 可变宽度的百分比堆叠柱（市场地图）：柱宽代表细分市场规模，柱内堆叠代表各参与者份额。 | `x`*, `series`*, `value`* |
| `sunburst` | 旭日图 / Sunburst | echarts | 径向层级图：内环为一级分类、外环为下级，中心显示总数或当前层级，可点击下钻。 | `id`, `parent`, `name`, `value`*, `path`, `color` |
| `treemap` | 矩形树图 / Treemap | echarts | 层级结构的矩形树图：面积代表数值，颜色代表一级分组或某个指标（如增长率），点击下钻并通过面包屑返回。 | `id`, `parent`, `name`, `value`*, `path`, `color` |
| `waffle` | 华夫饼图（百格图） / Waffle Chart | svg | 10 × 10 百格图（每格 = 1%）表达部分与整体：单个堆叠百格图配图例表、按字段分面的多个百格图，或每个类别一个小百格图。 | `label`*, `value`*, `facet` |

## 分布与相关 · Distribution & correlation

散点、气泡、热力矩阵、箱线图——指标间的关系与分布。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `beeswarm` | 蜂群分布图 / Beeswarm | echarts | 把每个观测值画成互不重叠的点，按分组逐行排列，叠加四分位区间和中位数刻度，直观展示离散程度以及目标公司所处位置。 | `label`*, `value`*, `group`, `size`, `target` |
| `boxplot` | 箱线图（分组分布） / Box Plot | echarts | 由原始行数据计算的分组分布：四分位箱体、中位数、均值、须线、离群点与抖动散点，并标出目标公司。 | `group`*, `value`*, `label`, `name`, `target` |
| `bubble` | 气泡图（四维散点） / Bubble Chart | echarts | 四维散点图：横轴、纵轴、气泡面积、颜色；嵌套圆尺寸图例、最大气泡标注、对数轴，可按时间字段播放动画。 | `x`*, `y`*, `size`, `color`, `label`, `name`, `target` |
| `heatmap` | 热力矩阵图 / Heatmap Matrix | echarts | 按数值着色的类别矩阵：相关系数矩阵、月度收益表、同业评分卡；单元格内直接标注数值并带色阶图例。 | `x`*, `y`*, `value`* |
| `histogram` | 直方图（分布） / Histogram | echarts | 单一指标的分箱分布：自动取整的组距、可选核密度曲线、中位数/均值线、目标所在组高亮及观测值地毯线。 | `value`*, `label`, `name`, `target` |
| `scatter` | 散点图（回归 / 象限） / Scatter Plot | echarts | 带标签的双指标散点图：回归线与 R²、中位数象限、目标公司高亮、框选交叉筛选。 | `x`*, `y`*, `label`, `name`, `color`, `target` |

## 流向与关系 · Flow & relationships

桑基图、弦图、关系网络、股权/法人结构图与漏斗图。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `chord` | 弦图 / Chord Diagram | echarts | 同一组实体之间的双向流量：圆弧长度为双向总量，弦带连接来源与去向（跨境并购、贸易走廊、业务单元间转介）。 | `source`*, `target`*, `value`*, `count` |
| `funnel` | 漏斗图 / Funnel | echarts | 以扁平条形表示各阶段的管道 / 流程漏斗（居中或左对齐），阶段之间标注转化率，右侧可附金额与占首阶段比例列。 | `stage`*, `value`*, `secondary` |
| `network` | 关系网络图 / Network Graph | echarts | 由边表（可选节点表）生成的关系网络：围绕目标公司的客户、供应商、竞争对手与合作伙伴；力导向或环形布局，支持缩放、拖拽与邻接高亮。 | `source`*, `target`*, `value`, `edgeType`, `id`, `name`, `category`, `size` |
| `sankey` | 桑基图 / Sankey Diagram | echarts | 按数值比例绘制各阶段之间的流量宽度：从分部收入到净利润的损益流向、分部→地区收入、资金来源与用途。 | `source`*, `target`*, `value`* |
| `tree` | 股权 / 组织结构图 / Structure Chart (Tree) | echarts | 由 (id, parent) 表生成的法律实体 / 集团结构图：按实体类型着色的方框、带持股比例的直角连线、可折叠展开与缩放；支持自上而下、从左到右与放射状布局。 | `id`*, `parent`*, `name`*, `country`, `pct`, `category` |

## 地理空间 · Geospatial

离线地图：分级着色、比例符号（气泡）、流向弧线、聚合点与密度热力。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `bubble-map` | 气泡地图 / Bubble Map | leaflet | 按经纬度绘制比例气泡：面积与数值成正比，按类别或数值着色，嵌套尺寸图例，标注前 N 个，入场生长动画。 | `lat`*, `lon`*, `size`*, `color`, `label`, `target` |
| `china-tilemap` | 中国省份方块地图 / China Tile Map | echarts | 合规友好的中国省级方块地图：34 个省级行政区各占一个等大的方块（或六边形），按近似地理位置排布并按指标着色；不绘制任何边界线，客户材料中无需审图号。 | `id`*, `value`* |
| `choropleth` | 分级设色地图 / Choropleth Map | leaflet | 在离线世界底图上按指标给国家着色：顺序/发散色阶，连续或分级（自动取整的分档）。 | `id`*, `value`*, `label` |
| `cluster-map` | 聚合点地图 / Cluster Map | leaflet | 密集点位自动聚合为主题化的聚合气泡（显示数量或数值合计，外环按类别占比分段），缩放时逐级展开，最大缩放时蛛网展开重叠点。 | `lat`*, `lon`*, `label`, `color`, `value` |
| `flow-map` | 流向地图 / Flow Map | leaflet | 以弧线展示起点到终点的流向：线宽表示金额，颜色区分类别，箭头指向目的地，节点大小表示总流量，带流动光点动画。 | `from`*, `to`*, `fromLat`*, `fromLon`*, `toLat`*, `toLon`*, `value`*, `count`, `color` |
| `geo-heat` | 地理热力图 / Geo Heatmap | leaflet | 点位的核密度热力面（可按数值加权），使用主题顺序色阶；可一键叠加显示原始点位。 | `lat`*, `lon`*, `weight`, `label` |

## 表格 · Tables

可比公司表、敏感性分析表、透视表与交互式数据表格。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `comps-table` | 可比公司 / 先例交易表 / Comparables Table | dom | 投行标准的可比公司 / 先例交易表：多级表头、按行业分节、均值 / 中位数 / 最高 / 最低统计行、目标公司高亮。 | `label`*, `highlight`, `note` |
| `data-grid` | 交互式数据表格 / Interactive Data Grid | tabulator | 可排序、可筛选、可搜索的明细数据表（Tabulator 6），支持冻结列、分组表头、分页 / 虚拟滚动和 CSV 下载。 | `key`, `highlight` |
| `league-table` | 排行榜（League Table） / League Table | dom | 财务顾问 / 收购方 / 投资人排名表：名次变化箭头、行内数值条、市场份额与交易数量，可高亮自家机构。 | `rank`, `name`*, `value`*, `share`, `count`, `prior` |
| `pivot-table` | 数据透视表 / Pivot Table | dom | 轻量数据透视表：可折叠的多级行分组 × 一个列维度，任意聚合函数，合计行 / 列、CAGR、行 / 列占比与热力着色。 | `rows`*, `cols`, `value` |
| `sensitivity-table` | 敏感性分析表 / Sensitivity Table | dom | 双变量敏感性分析表（如 DCF 股价对 WACC × 永续增长率、LBO IRR 对进入 × 退出倍数），以基准情形为中点的发散色热力。 | `row`*, `col`*, `value`* |

## 流程与时间线 · Process & timeline

交易时间表、甘特图与里程碑。

| id | 名称 | 引擎 | 能展示什么 | 数据通道 |
|---|---|---|---|---|
| `gantt` | 交易时间表 / 甘特图 / Gantt / Transaction Timetable | echarts | 交易流程时间表：按工作流分组的任务条（按阶段着色）、里程碑菱形、双层日历表头、“今天”线与时间缩放。 | `group`, `label`*, `start`*, `end`, `phase`, `milestone`, `owner` |
| `timeline` | 里程碑时间线 / Milestone Timeline | dom | 按时间轴排列的事件里程碑：标签上下交替并自动分层避免重叠，引线不交叉，按事件类型区分形状与颜色；窄版块自动切换为纵向布局。 | `date`*, `label`*, `kind`, `detail` |

`*` = required channel / 必填通道
