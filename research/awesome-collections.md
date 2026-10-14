# 现成的"大仓库"：可视化合集、画廊与分类法（Awesome collections）

> **日期** 2026-10-14 · **读者** ReportKit 产品负责人、组件开发者 · **用途** 用别人整理好的目录、分类法和画廊扩展 ReportKit，少走弯路
> **依据**
> - 主要来源：`research/raw/07-collections.md`（下称 07）。
> - 补充来源：02（地图）、04（pitchbook）、05（图标）、06（中国生态）、08（AI）、09（架构）各篇笔记。
> - 现状核对：`research/catalog.json`（239 个库）、`research/landscape.md` §3（FT 覆盖矩阵）、`kit/catalog.json`（53 个组件）、`kit/categories.json`（12 类）、`vendor/vendor.json`、`docs/architecture.md`。
>
> **口径**
> - 最近提交日期、条目数、许可都来自 07 在 2026-10-14 的实查：`git clone --depth 1` 取 HEAD 日期，按 README 标题和列表项计数，raw LICENSE 看许可。Star 数是 shields.io 的取整值。本文不另行估算。
> - 维护状态：✅ 3 个月内有提交；🟡 18 个月内；🔴 超过 18 个月。
> - Verdict 分 4 级：**adopt** 采用 · **consider** 备选 · **reference** 仅作参考 · **avoid** 避免。

---

## 0. 一页结论

1. **真正值得长期用的只有 5 个，各管一件事：**

   | 合集 | 管什么 | 在 kit 中的落点 |
   |---|---|---|
   | **FT Visual Vocabulary** | 图型分类法 | 我们 12 个类别的骨架（`kit/categories.json` 的 `$comment` 写明了这一点） |
   | **data-to-viz.com** | 第二筛选维度："你手上是什么形状的数据" | gallery 筛选、测试数据命名 |
   | **Apache ECharts examples** | 参考实现。Apache-2.0，可以合法改写 | 每个 ECharts 组件的 recipe 来源 |
   | **Leaflet Plugins DB** | 地图插件目录 | 已 vendor 2 个插件，下一批的候选也从这里出 |
   | **hal9ai/awesome-dataviz** | 库雷达，用来发现新库 | `research/catalog.json` 的种子；每月 diff 一次 |

2. **现状：我们 53 个组件已覆盖 FT 72 种图型中的 50 种，另有 5 种部分覆盖**（landscape §3）。原先列出的 4 个"合集能直接补上的缺口"里，equalised cartogram 已经补上，还剩 3 个：
   - Fan chart → `@echarts-x/custom-line-range`。
   - Violin → `@echarts-x/custom-violin`。
   - Surplus/deficit filled line → ECharts 的 area 配方。
   - （已完成）Equalised cartogram → `china-tilemap`。manifest 和 `china_provinces` 样例数据已进 `kit/catalog.json`；只覆盖中国省级，世界区域和美国州版本还没有。
3. **版权与许可的红线：**
   - **只借概念、不抄内容：** Data Viz Catalogue 和 Datavizproject 有版权但没有许可。FT 的配色、字体、logo 不在 MIT 范围内。
   - **复用列表文字要署名：** awesome-dataviz 是 CC BY 4.0。
   - **Tabler 的图表 widget 不能照抄：** 它用的是 ApexCharts 7.0.0，而 ApexCharts 从 5.1.0 起改为双许可，投行用不了 Community 版。
4. **合集里的徽章和描述会过时，一律重新核实。**
   - chartjs/awesome 把 `chartjs-chart-financial` 标成不支持 v4，但 npm 0.2.1 的 peer 依赖实际是 `chart.js ^4.0.0`。
   - 不少列表仍把 MapLibre 写成"可用 `<script>` 加载"，但 6.x 已经是 ESM-only。
   - 规则：先 `npm view <pkg> version license peerDependencies` 和 jsDelivr 的 dist 列表，再做 `file://` 实测。
5. **框架绑定的合集只当设计参考**，包括 shadcn/ui charts、Tremor、awesome-react-components、awesome-vue。kit 是 classic script，没有 React/Vue 构建步骤。
6. **扩展 ReportKit 的标准流程（§3）：**
   1. 在 FT 上选图型，用 data-to-viz 核对数据形状。
   2. 找 ECharts 示例 id 作为参考实现。
   3. 优先用 ECharts 原生能力或官方 custom series；需要新依赖时，从合集挑选并锁定版本。
   4. 写成 `kit/components/<id>/`，即 JS + `manifest.json`，并补上 `refs` 溯源字段。
   5. 运行 `tools/build_catalog.py` 和 `tools/check.sh`。

---

## 1. 总表：所有合集、画廊与分类法

按用途分 8 组。"映射到 ReportKit"一列说明这个合集落到 kit 的哪一层。

### 1.1 库目录（awesome lists）：用来发现新库

| 合集 | URL | 维护（最近提交） | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **awesome-dataviz**（hal9ai；fasouto 和 javierluraschi 两个旧地址都重定向到这里） | https://github.com/hal9ai/awesome-dataviz · 镜像站 https://awesomedataviz.com | ✅ 2026-10-13 · 4.4k★ | 约 420 条 / 24 节（镜像站显示 365 个工具）；JS 部分约 133 条，其中 Charting 35、Financial charts 9、Maps 22、Misc 23；另有 Dashboards & BI 13 条 | CC BY 4.0 | 新库雷达。2025–26 年的新秀都在里面：ChartGPU、Vela、Flint、mapcn、Perspective 新 org | `research/catalog.json` 的种子；每月 diff Financial、Maps、Misc 三节 | **adopt** |
| **chartjs/awesome** | https://github.com/chartjs/awesome | 🟡 2026-03-23 · 2.7k★ | 75 行，其中 50 行标注支持 v4；每行有 v2/v3/v4 支持矩阵 | MIT | Chart.js 插件矩阵：zoom、annotation、datalabels、financial、geo、matrix、sankey、treemap、boxplot | 我们不用 Chart.js。只作为"某种图在其他引擎怎么做"的旁证 | adopt（只限 Chart.js 方向） |
| **awesome-echarts**（ecomfe） | https://github.com/ecomfe/awesome-echarts | 🔴 2025-01-16 · 1.6k★（07 标为 🟡，但距今已约 21 个月，按本文图例应为 🔴） | 约 52 条（89 个链接里有 37 个是目录） | CC0 1.0 | 扩展清单：wordcloud、liquidfill、echarts-leaflet；Python 绑定 pyecharts | 旧扩展大多只声明支持 echarts ^5，**已被官方 `@echarts-x/*` 取代**（06 §4.2）。社区画廊 makeapie.com 已失效 | reference |
| **awesome-geojson**（tmcw） | https://github.com/tmcw/awesome-geojson | ✅ 2026-09-23 · 2.6k★ | 123 条 / 8 节，其中 conversion 35 条 | CC0 1.0 | GeoJSON 处理工具：turf、geojson-rewind、simplify、topojson | 服务于 Python builder 和 `tools/build_geo.py`（切日界线、简化），不进前端 | reference |
| **awesome-maplibre** | https://github.com/maplibre/awesome-maplibre | ✅ 2026-10-14 · 1.1k★ | 236 条 / 约 12 节 | BSD-3 | MapLibre 插件；ECharts↔MapLibre 绑定 | 只在将来启用 "served mode" 矢量底图时有用。MapLibre 6 是 ESM-only，`file://` 下最后可用的是 5.24.0 | reference |
| **awesome-vector-tiles**（mapbox） | https://github.com/mapbox/awesome-vector-tiles | ✅ 2026-08-10 · 2.6k★ | 142 条 / 9 节 | CC0 1.0 | PMTiles / MBTiles 工具链 | 只在需要街道级离线底图时用（02 §6.4） | reference |
| **awesome-javascript** 的 Data Visualization 节（sorrycc） | https://github.com/sorrycc/awesome-javascript#data-visualization | ✅ 2026-10-14 · 35k★ | 全表 866 条，其中 DataViz 46 条，约 40% 是停更的 jQuery 时代库 | 未声明 | 它的 Table/Grid 和 Spreadsheet 节反而更有用 | 无 | avoid（DataViz 节） |
| **awesome-react-components**（brillout）：Chart / Map / Table 节 | https://github.com/brillout/awesome-react-components | 🟡 2026-01-26 · 49k★ | 共 664 条；chart 约 23、grid 约 11、table 约 12、map 7 | CC0 1.0 | 交互和样式的设计模式 | 只当设计参考 | reference |
| **awesome-vue**：Charts / Map / Admin Template 节 | https://github.com/vuejs/awesome-vue | ✅ 2026-10-01 · 74k★ | 共 1208 条；charts 9、maps 8、admin 18 | MIT | vue-data-ui（60 多个图表组件）的视觉 | 只当设计参考 | reference |
| **awesome-d3**（wbkd） | https://github.com/wbkd/awesome-d3 | 🔴 2023-01-13 · 5.3k★ | 145 条 / 6 节；bl.ocks.org 链接全部失效 | CC0 1.0 | D3 插件名单：d3fc（金融 OHLC）、d3-annotation（think-cell 式 callout）、d3-legend、venn.js、textures（黑白打印用图案） | 将来做装饰插件（callout、差值箭头）时，用来参考设计 | reference |
| **awesome-charting**（zingchart） | https://github.com/zingchart/awesome-charting | 🔴 2021-02-25 · 2.1k★ | 62 条 | MIT | 没有新东西，而且偏向厂商自家产品 | 无 | **avoid** |
| **awesome-maps**（simsieg） | https://github.com/simsieg/awesome-maps | ✅ 2026-10-09 · 516★ | 124 个**地图网站**，不是库 | 未声明 | 只作灵感 | 无 | reference |
| awesome-leaflet（harryprince） | 07 只通过 context-awesome.com 镜像看到，未能直接访问原仓库 | 🔴 · 约 28★ | 23 条，大多是 R 包 | 未知 | — | 用官方 Leaflet DB 代替 | avoid |

### 1.2 图型分类法（taxonomy）：决定"画什么"

| 合集 | URL | 维护 | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **FT Visual Vocabulary**（chart-doctor 海报 + ft-interactive D3 模板） | https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary · https://github.com/ft-interactive/visual-vocabulary | 🔴 2024-03-12 / 2021-08-18（内容不过时）· 3.4k / 350★ | **9 类 72 种图型**；有机读的 `chartTypes.csv`（列为 `chartName, category, img, avail, description`）；42 种有 D3 v4 模板（共 58 个模板目录） | 软件 MIT；**FT 内容和品牌保留版权** | 主分类法；FT 的 "frame" 概念，即固定的 print / web / social 输出尺寸 | `kit/categories.json` 的骨架，映射见 §2.1。坑：CSV 用老 Mac 的 CR 换行，`wc -l` 显示 0，要用 Python `csv` 模块解析 | **adopt** |
| **data-to-viz.com**（holtzy） | https://www.data-to-viz.com · https://github.com/holtzy/data_to_viz | 🔴 2024-10-18（07 标为 🟡，但已约 24 个月；内容是决策树，不过时）· 1.1k★ | 6 个数据形态根节点、约 39 个图型页、12 条精选 caveat（共 74 个文件）、约 20 个数据格式 "story"、20 多个示例 CSV | 仓库 MIT | 按数据形态选图的决策树；caveat 可以直接变成 lint 规则；示例数据集的命名方式 | gallery 的第二筛选维度；测试数据命名（§2.2） | **adopt** |
| **Data Viz Catalogue**（Severino Ribecca） | https://datavizcatalogue.com | ✅ | 60 种方法 / 16 种功能 | **有版权、无许可** | 金融类图型的查漏清单，这些 FT 没有：Kagi、Point & Figure、Span、OHLC、Candlestick、Marimekko、Error bars | 只用来核对完整性，**不复制文字和缩略图** | reference |
| **Data Viz Project**（Ferdio） | https://datavizproject.com | ✅ | 166 种图型；4 个分面：Family、Input、Function、Shape | **有版权、无许可** | 分面筛选的 UX | 同上 | reference |
| awesome-dataviz 的 Catalogs 节 | 同 1.1 | — | 11 条：R Graph Gallery、From Data to Viz、AnyChart Chartopedia、Depict Data Studio Chart Chooser、5 个 Wikipedia 列表等 | 各自不同 | — | 07 没有逐个深入核实。需要时再看 | reference |

### 1.3 代码画廊：决定"怎么画"（参考实现）

| 合集 | URL | 维护 | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **Apache ECharts examples** | https://echarts.apache.org/examples · https://github.com/apache/echarts-examples | ✅ 2026-09-24 · 400★（仓库） | **377 个 2D 示例 + 59 个 GL 示例**，301 个 TS 文件。`src/data/chart-list-data.js` 是机读的，每条有 `id, title, titleCN, category[], difficulty, since`。**28 个示例标为 `since: 6.0.0`** | Apache-2.0 | 直接改写成组件。v6 新能力：axis breaks、intraday breaks、matrix 坐标系、chord、jitter | 36 个 ECharts 组件的 recipe 来源，逐个映射见 §2.3。改写代码合法，保留 NOTICE 即可（`vendor/echarts/NOTICE` 已随包分发） | **adopt** |
| **Vega-Lite examples** | https://vega.github.io/vega-lite/examples/ · 索引在 https://github.com/vega/vega-lite/blob/main/site/_data/examples.json | ✅ 2026-10-08 · 5.5k★ | **203 个画廊条目 / 6 组**，共 633 个 spec 文件；其中 Interactive 32 个 | BSD-3 | 语法级交互模式：刷选、联动、多视图、标注图层 | 我们 `encode` 的通道名尽量和它对齐（roadmap-step2 §5）；将来写 VL→block spec 的导入器 | consider |
| **Plotly.js gallery** | https://plotly.com/javascript/ | ✅（展示的是 v4.1.x） | 12 节；Financial 节有 waterfall、indicators、candlestick、funnel、带 rangeselector 的时间序列 | MIT | 时间范围按钮（1M/6M/YTD/1Y）、indicator 卡片 | `price-volume`、`candlestick` 的时间范围按钮；`kpi-tiles` | reference（plotly.min.js 有 4.7 MB，不 vendor） |
| **D3 Graph Gallery**（holtzy） | https://d3-graph-gallery.com · https://github.com/holtzy/D3-graph-gallery | ✅ 2026-08-01 · 855★ | 47 个图族页面、165 个示例 HTML | MIT | 每类图都有短小易读的 D3 片段 | 做 SVG 组件时参考（例如 `waffle`）。**代码是 d3 v4/v6**：`d3.v4.js` 出现 183 次，`d3.v6.js` 126 次 | reference |
| **Observable D3 gallery** | https://observablehq.com/collection/@d3/gallery | ✅ | 147 条 | 每个 notebook 单独定许可（多数 @d3 notebook 是 ISC，要逐个核对） | D3 v7 的标准写法：zoomable sunburst、bar chart race、bubble map | notebook 不能离线，代码要手工摘出来 | reference |

### 1.4 插件数据库

| 合集 | URL | 维护 | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **Leaflet Plugins DB**（官方） | https://leafletjs.com/plugins · 源文件在 https://github.com/Leaflet/Leaflet/tree/main/docs/_plugins | ✅ 2026-09-19 · Leaflet 46k★ | **578 个插件 / 36 类**，其中 dataviz 21、clustering 13、heatmaps 8、markers-renderers 80。每个插件的 frontmatter 都有 `compatible-v1/v2` 字段 | 仓库 BSD-2；插件各自定许可 | 地图多维编码插件 | **568 个标为兼容 v1，0 个标为兼容 v2**，所以锁定 Leaflet 1.9.4。已 vendor 和下一批候选见 §2.4 | **adopt** |
| `@echarts-x/*` 官方 custom series | https://github.com/apache/echarts-custom-series | ✅ 2026-08 · 74★ | 8 个包：bar-range、line-range、violin、contour、segmented-doughnut、stage、word-cloud、liquid-fill | Apache-2.0 | 每个包都有 `*.auto.min.js` classic script，2–15 KB，加载后自动注册 | 给 ECharts 补图型的首选来源（06 §4.2）。**尚未 vendor** | adopt |

### 1.5 设计与仪表盘参考（不作为依赖）

| 合集 | URL | 维护 | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **shadcn/ui charts** | https://ui.shadcn.com/charts | ✅ 2026-10-14 · 126k★ | **70 个 block**：area 10、bar 10、line 10、pie 11、radar 14、radial 6、tooltip 9。基于 Recharts 3.8.0 和 React 19 | MIT | tooltip 版式（indicator line/dot/dashed）、`--chart-1..5` CSS 变量调色板、带中心标签的 radial KPI | 用来打磨 `rk.chart` 的 tooltip 和 `kpi-tiles` 的样式；调色板思路和我们的 `--rk-*` token 一致 | reference |
| **Tremor Raw / Tremor Blocks** | https://tremor.so · https://github.com/tremorlabs/tremor · https://github.com/tremorlabs/tremor-blocks | 🟡 Raw 2025-10-10 / 🔴 Blocks 2025-01-22。2025-01 被 Vercel 收购，npm 包 `@tremor/react` 停在 3.18.7 | Raw 约 35 个组件；Blocks 300 多个 | Raw Apache-2.0；Blocks MIT | KPI 原语的词汇：**BarList**、**CategoryBar**、**Tracker**、**SparkChart** | 组件映射见 §2.6 | reference |
| **Tabler**（`@tabler/core` 1.6.1） | https://github.com/tabler/tabler | ✅ 2026-10-11 · 42k★ | 139 个 Astro 预览页 | MIT | 版式网格、卡片、暗色模式 | ⚠ 其中 23 页用 **ApexCharts 7.0.0**（双许可），**不要照抄图表 widget**；CSS 有 635 KB，不当依赖（05） | reference |
| **AdminLTE 4**（4.10.0） | https://github.com/ColorlibHQ/AdminLTE | ✅ 2026-10-08 · 46k★ | Bootstrap 5.3.8 的页面集 | MIT | 依赖许可干净：Chart.js 4.5.1、jsvectormap 1.7、Tabulator 6.6.1 | 和我们一样选了 Tabulator 6.6.1，算一个旁证。⚠ 演示页从 cdn.jsdelivr.net 加载，不能离线 | consider（只看版式） |

### 1.6 投行专用参考集（来自 04）

| 合集 | URL | 维护 | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **SEC EDGAR 上的银行 "Discussion Materials"**（Schedule 13E-3 附件 EX-99.(c)） | 全文搜索：https://efts.sec.gov/LATEST/search-index ；样本如 Evercore "Project Everest" https://www.sec.gov/Archives/edgar/data/1863105/000119312523280779/d306045dex99cix.htm | ✅ 持续有新提交 | 2023–2026 年各家银行的真实 pitchbook | 公开披露文件 | **一手证据**：页面比例、配色、数字格式（`n.m.`）、页面类型 | 发现美国投行几乎都用 **US Letter 11 × 8.5 in**，而 kit 当前是 16:9（landscape §0.4 列为未完成项）；`comps-table` 的统计行、`n.m.` 规则都来自这里 | **adopt**（做设计依据） |
| **think-cell 图表目录** | https://www.thinkcell.com/en/product/think-cell-charts · 第三方速查 https://info.transitionaccelerator.ca/allabouttools/think-cell-quick-reference | ✅ | 柱 / 瀑布 / Mekko / Gantt / 组合图，加装饰层 | 商业产品，只看文档 | **装饰层**：CAGR 箭头、差值箭头、value line、总计、`TCROUND` 保证四舍五入后部分之和等于总计 | `combo` 的 CAGR 箭头、`waterfall` 的连接线已经做了；差值箭头和全局 `roundToTotal` 是 P1 缺口（landscape §3.4） | reference |
| **Alexander Jarvis：IB slide examples** | https://www.alexanderjarvis.com/investment-banking-slide-examples-of-premiums-paid-analysis/ | — | 32 类页面目录 | 有版权 | 投行页面类型清单 | P0 缺口 **AVP 表、premiums paid** 就来自这类清单（04 §8） | reference |
| **Anthropic financial-services 插件**（pitch-agent skills） | https://github.com/anthropics/financial-services/tree/main/plugins/agent-plugins/pitch-agent | ✅ | pitch-deck formatting-standards、comps-analysis、dcf-model、lbo-model 等 skill | Apache-2.0 | Excel 模型的配色惯例（section header `#1F4E79`，"只用蓝和灰，3–4 种颜色"）；skill 的打包方式 | 主题 token 的旁证；Step 2 技能包格式的参考 | reference |
| nexu-io/open-design：IB pitch book conventions | https://raw.githubusercontent.com/nexu-io/open-design/main/design-templates/ib-pitch-book/references/conventions.md | — | 一份约定文档 | 04 没有记录许可，**未核实** | `alternatives-matrix` 等页面约定 | 04 §8.34 | reference |

### 1.7 数据与资产集

| 合集 | URL | 维护 | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **Natural Earth**（含 31 种 point-of-view 视角版本） | https://github.com/nvkelso/natural-earth-vector · 争议边界政策 https://www.naturalearthdata.com/about/disputed-boundaries-policy/ | 最新数据版本：5.1.2 文化数据（2022-05） | admin-0 / admin-1，各有 10m、50m、110m 三种精度 | public domain | 世界底图；`_chn` 视角版本（台湾并入中国，带九段线）；`NAME_ZH` 中文名 | 当前 `vendor/geo-world/world-110m.js` 来自 world-atlas 2.0.2，后者冻结在 NE 4.1.0，而且 110m 精度下**没有新加坡、香港、澳门**。计划升级到 NE 5.1.2 10m 简化版（02 §10） | adopt |
| **ECharts 内置主题**（`echarts/theme/*.js`，36 个）+ theme builder | https://echarts.apache.org/en/theme-builder.html · https://github.com/apache/echarts-theme-builder | ✅ 2026-08 · 288★ | 36 个 UMD 主题 | Apache-2.0 | 调色板试验 | **没有一个达到 pitchbook 级**。kit 用自己的 token 生成 `rk` 主题（`kit/core/rk.theme.js`） | reference |
| **@visactor/vchart-theme** 1.13.1 | https://unpkg.com/@visactor/vchart-theme@1.13.1/public/veODesignLightFinance.json | ✅ 2026-06 | 约 30 套主题，其中有 `veODesignLightFinance` | MIT | 浅色金融色板：`#294C60` navy、`#E2B890` tan、`#9D0800` oxblood | 可以作为 `bronze` 主题之外的暖色备选（06 §13） | reference |
| **Lucide** 1.57.0 + **Tabler Icons** 3.49.0 | https://lucide.dev · https://github.com/tabler/tabler-icons | ✅ 2026-10 | Lucide `sprite.svg` 有 1890 个 symbol；Tabler 有 5184 个线性图标 + 1054 个实心图标，其中约 366 个与金融或图表相关（正则粗计） | ISC / MIT | 线性图标 | 05 的结论是 adopt，由 builder 只内联用到的图标。**尚未 vendor** | adopt（未落地） |

### 1.8 AI / Skills 合集（Step 2 用）

| 合集 | URL | 维护 | 规模 | 许可 | 借什么 | 映射到 ReportKit | Verdict |
|---|---|---|---|---|---|---|---|
| **AntV chart-visualization-skills** | https://github.com/antvis/chart-visualization-skills | ✅ 2026-09-22 · 508★ | 9 个 `SKILL.md` 技能 | MIT | 技能包目录结构，以及配套的评测用例 | `docs/roadmap-step2.md` §3 的技能包格式。⚠ 其中 `chart-visualization` 技能会**用 curl 把数据发到 AntV 云端渲染** | reference |
| **VisActor/skills**（原 VMind 仓库） | https://github.com/VisActor/skills | ✅ | vchart-skill、vtable-skill、data-storytelling；有 41 个评测用例 | MIT | 技能 = 说明 + 参考 + 模板 + 评测 | 同上。⚠ 生成的 HTML 从 unpkg 加载，不能离线 | reference |
| **Agent Skills 规范** | https://agentskills.io | ✅ · 规范仓库 26k★ | 已有 26 个以上的 agent 产品支持 | — | `SKILL.md` frontmatter 字段和渐进披露机制 | 我们的技能包直接对齐这个规范（08 §9.1） | adopt |
| **Microsoft Flint**（`flint-chart` 0.5.1） | https://github.com/microsoft/flint-chart | ✅ 2026-08 · 4.4k★ | 通道词汇（含 `open/high/low/close`）加 70 多种语义类型 | MIT | 一份 spec 可编译到 Vega-Lite、ECharts、Chart.js、Plotly，以及**可编辑的 Excel 图表** | 用来丰富 block spec 的通道和字段 role；"导出 Excel 原生图表"可在 builder 侧做（roadmap-step2 §5） | consider |

---

## 2. 深挖：每个关键合集怎么映射到 kit

### 2.1 FT Visual Vocabulary → `kit/categories.json`

我们的 12 个类别 = FT 的 9 类合并成 7 类（Ranking 和 Magnitude 合为 `comparison`，Correlation 和 Distribution 合为 `distribution`），再加 5 个投行或报告骨架专用类，并按投行阅读习惯重新命名。对应关系：

| FT 类别（种数） | ReportKit 类别 | 承接组件 | 覆盖（✓/◐/✗，见 landscape §3.1） |
|---|---|---|---|
| Deviation（4） | `bridge` 桥接与偏差 | `diverging-bar`；`waterfall`、`bullet` 处理差异 | 1 / 0 / 3 |
| Correlation（5） | `distribution` 分布与相关；双轴归 `trend` | `scatter`、`bubble`、`heatmap`、`combo` | 4 / 1 / 0 |
| Change over Time（12） | `trend` 时间趋势；Priestley 时间线归 `timeline` | `line`、`bar`、`combo`、`candlestick`、`price-volume`、`slope`、`calendar-heatmap`、`gantt` | 8 / 1 / 3 |
| Ranking（8） | `comparison` 规模与排名 | `bar`、`lollipop`、`bump`、`slope`；榜单用 `league-table` | 6 / 1 / 1 |
| Distribution（8） | `distribution` | `histogram`、`boxplot`、`beeswarm`、`dumbbell` | 4 / 1 / 3 |
| Part-to-whole（11） | `composition` 结构占比；瀑布归 `bridge` | `donut`、`treemap`、`sunburst`、`waffle`、`marimekko`、`bar`（堆叠） | 8 / 0 / 3 |
| Magnitude（12） | `comparison` | `bar`、`lollipop`、`radar`、`bullet`、`parallel`、`marimekko` | 10 / 0 / 2 |
| Spatial（8） | `geo` 地理空间 | `choropleth`、`bubble-map`、`flow-map`、`geo-heat`、`cluster-map`、`china-tilemap` | 5 / 1 / 2 |
| Flow（4） | `flow` 流向与关系 | `sankey`、`chord`、`network`、`waterfall` | 4 / 0 / 0 |
| （FT 没有） | `valuation` · `table` · `timeline` · `layout` · `controls` | `football-field`；5 个表格；`gantt`、`timeline`；`kpi-tiles`、`text-block`；4 个控件 | 这 5 类共 14 个组件（占 53 个的 26%）。其中 `gantt`、`timeline` 同时承接 FT 的 priestley / circles-timeline。完全不在 FT 词表里的组件共 16 个（30%），除这 12 个外还有 `multiple-history`、`small-multiples`、`tree`、`funnel`（landscape §3.3） |
| **合计** | | | **50 ✓ / 5 ◐ / 17 ✗**（72 种） |

**合集能直接补上的 FT 缺口**（按投行价值排序；优先级与 landscape §3.4 一致）：

| FT 图型 | 优先级 | 参考实现来自哪个合集 | 建议做法 |
|---|---|---|---|
| fan（预测区间） | **P1** | `@echarts-x/custom-line-range`（1.4 节）；Plotly 的 Financial 节 | 新组件 `fan-chart`，或给 `line` 加 `band` 选项 |
| equalised-cartogram（中国版已完成） | **P1**（世界区域 / 美国州） | FT 模板；`china-tilemap` 的方格布局是自研的（按省份质心经纬度排布，压缩到 7 × 8），并与 geofacet 的 `china_prov_grid1` 网格（MIT）交叉核对过，见 `china-tilemap.js` 文件头注释 | `china-tilemap` 已完成（manifest 和 `china_provinces` 样例已进 catalog，还没有 `refs` 字段）。下一步推广到世界区域和美国州 |
| violin | P1 | `@echarts-x/custom-violin` | 给 `boxplot` 或 `beeswarm` 加 `violin` 变体 |
| line-surplus-deficit-filled | P2 | ECharts area 配方：两条线之间按正负着色填充 | 给 `line` 加 `fillBetween` 选项（实际对预算） |
| population-pyramid（butterfly / tornado） | P2 | think-cell 的 butterfly；ECharts 双向 bar | 给 `bar` 加 `diverging: 'mirror'` 选项 |
| cumulative-curve | P2 | data-to-viz 的 caveat 页；ECharts line | 给 `histogram` 加 `cumulative` 选项（volume-at-price） |
| scatterplot-line-timeline（connected scatter） | P2 | Vega-Lite 的 connected scatter 示例 | 给 `scatter` 加 `path` 通道 |
| Voronoi、arc、Venn、contour、scaled cartogram、seismogram、isotype、spine | P3 | D3 Graph Gallery；`@echarts-x/custom-contour` | 对投行价值低，按需再做 |

**金融图型的查漏**（FT 没有，Data Viz Catalogue 有）：
- OHLC 和 candlestick：已有 `candlestick`。
- Span chart：用 `dumbbell` 近似。
- Marimekko：已有。
- Kagi 和 Point & Figure：交易终端风格，不进 pitchbook，avoid。
- Error bars：可以用 ECharts 示例 `custom-error-scatter` 做成 `scatter` 的一个选项。

### 2.2 data-to-viz → 第二筛选维度，以及测试数据命名

**数据形态 → 组件。** 可以直接做成 gallery 的"按数据选图"筛选器，也可以作为 Step 2 LLM 选组件的一条规则。

| data-to-viz 根节点 | 子形态 | ReportKit 组件 |
|---|---|---|
| Numeric | 一个数值 / 两个 / 三个 / 多个 | `histogram`、`beeswarm` / `scatter` / `bubble` / `parallel`、`heatmap`（相关矩阵）、`boxplot` |
| Categoric | 一个类别 / 嵌套 / 邻接 / 多个独立列表 | `bar`、`lollipop`、`donut`、`waffle` / `treemap`、`sunburst` / `chord`、`sankey` / ✗（Venn，P3） |
| Num & Cat | 每类一个值 / 每类多个观测 / 多类一个值 / 多个数值 | `bar`、`lollipop`、`bullet`、`diverging-bar` / `boxplot`、`beeswarm` / 分组或堆叠 `bar`、`marimekko`、`heatmap` / `radar`、`dumbbell`、`comps-table` |
| Maps | GPS 无值 / GPS 有值 / 区域有值 / 连接 | `cluster-map` / `bubble-map`、`geo-heat` / `choropleth`、`china-tilemap`（开发中） / `flow-map` |
| Network | 邻接矩阵 / 层级 | `network`、`chord`、`sankey` / `tree`、`treemap`、`sunburst` |
| Time series | 一条 / 多条 | `line`、`bar`、`calendar-heatmap`、`candlestick`、`price-volume`、`multiple-history` / `line`、`small-multiples`、`bump`、`slope` |

**12 条 caveat → QA / lint 规则。** 这批规则与飞书设计指南的规则（见 `research/china-ecosystem.md` §7）合并，作为 Step 2 自动生成图表的校验项：

| caveat | 对应的 kit 规则 |
|---|---|
| cut the Y axis? | 只有 `waterfall`、`football-field` 的 `axisBreak` 允许断轴，而且必须显示断轴标记 |
| pie chart | `donut` 超出阈值的类别自动归入"其他" |
| spaghetti chart | 线超过 5 条时提示改用 `small-multiples` |
| overplotting | 用 `beeswarm` 或 jitter |
| rainbow palette | 只允许使用主题 token 色板 |
| order your data | `bar` 和 `lollipop` 默认排序 |

**示例数据命名。** data-to-viz 的 `Example_dataset/` 按数据形态命名，例如 `1_OneNum.csv`、`7_OneCatOneNum.csv`、`13_Adjacency*.csv`、`19_MapConnection.csv`。
- 我们的 `kit/samples/datasets/` 按业务场景命名（`peers`、`ebitda_bridge` 等），这一点保持不变。
- 建议在每个 dataset 的 `meta` 里加一个 `shape` 标签，例如 `"shape": "OneCatOneNum"`，gallery 就能按数据形态筛选。

### 2.3 ECharts examples → 组件 recipe

规则：
- 示例代码是 Apache-2.0，可以改写进组件，保留 NOTICE 即可。
- 改写时必须把颜色、字体、格式全部换成 `ctx.theme` 和 `RK.format`，不保留示例里的硬编码样式。
- 下表"示例 id"一列：凡是出现在 07 附录 B 中的 id，都在 `chart-list-data.js` 里核实过。只写了分类 tag 的，说明该类没有逐个核对 id，用 tag 去画廊里筛即可。

| kit 组件 | ECharts 示例 id 或分类 tag | 借什么 / 下一步 |
|---|---|---|
| `waterfall` | `bar-waterfall`、`bar-waterfall2`；`bar-breaks-simple`、`bar-breaks-brush`（6.0.0） | 透明占位堆叠；`axisBreak: 'auto'` 已实现，breaks 示例可以用来对照断轴样式 |
| `candlestick` | `candlestick-sh`、`candlestick-large`、`candlestick-brush`、`custom-ohlc`；`intraday-breaks-1`、`intraday-breaks-2`（6.0.0） | 用 intraday breaks 去掉休市时段的空档：**日内图的下一步** |
| `price-volume` | `candlestick-brush`、`candlestick-touch`（axisPointer 联动） | 双 pane 共享缩放已实现；可借移动端 touch 交互 |
| `calendar-heatmap` | `calendar-heatmap`、`calendar-horizontal`、`calendar-vertical` | 已实现。`calendar-pie`、`calendar-graph` 对投行价值低 |
| `small-multiples` | `matrix-sparkline`、`matrix-grid-layout`（6.0.0） | 现在是在一个 ECharts 实例里给每个面板配一组 `grid` + 坐标轴；**可以评估迁移到 matrix 坐标系**，省掉布局计算 |
| `heatmap` | `matrix-correlation-heatmap`、`matrix-covariance`、`matrix-correlation-scatter`（6.0.0） | 相关矩阵可以改用 matrix 坐标系，表头更规整 |
| `comps-table`（DOM） | `matrix-sparkline`、`matrix-mini-bar-data-collection`（6.0.0） | think-cell 式"表里带迷你图"可以考虑用 ECharts matrix 实现；也可以继续用 DOM 表加内联 SVG（打印更稳） |
| `beeswarm` | 6.0.0 的 `scatter-jitter` | 现有实现是在 custom series 里自算的确定性 swarm 布局，点不重叠，缩放时重排。jitter 示例只用来对照，不必迁移 |
| `chord` | 6.0.0 的 `chord-*` 系列 | 已实现 |
| `gantt` | `custom-gantt-flight` | 已实现 |
| `scatter` | `custom-error-scatter` | 可以加误差棒（error bars）选项 |
| `football-field` | 不在 examples 里，用 `@echarts-x/custom-bar-range` | 改用 bar-range 后，低值、高值有正规编码，标签和 tooltip 是一等公民（06 §4.2）。**P1** |
| fan chart（缺） | `@echarts-x/custom-line-range` | 见 §3 的完整示例 |
| violin（缺） | `@echarts-x/custom-violin` | — |
| `sankey` / `treemap` / `sunburst` / `tree` / `network` | 分类 tag：sankey（7 例）、treemap（7 例）、sunburst（7 例）、tree（7 例）、graph（13 例） | 已实现；遇到新交互（下钻、面包屑）时再回来查 |
| `radar` / `parallel` / `boxplot` / `funnel` / `donut` | 分类 tag：radar（5 例）、parallel（4 例）、boxplot（4 例）、funnel（4 例）、pie（19 例） | 已实现 |
| `choropleth`（ECharts 版本，计划中） | `map-bar-morph`（"Morphing between Map and Bar"，见 02 的来源） | 02 §10.3 计划新增的 `map-bar-morph` 组件（地图和条形图互相变形），不需要新 vendor |

**持续跟进的方法：** `chart-list-data.js` 的 `since` 字段可以直接列出新版本引入了哪些能力，6.0.0 一共引入了 28 个示例。每次升级 ECharts 时，筛一遍 `since` 等于新版本号的示例，看有没有可以改写成新组件或新选项的。

### 2.4 Leaflet Plugins DB → 已 vendor 什么、自研了什么、下一步考虑什么

**已 vendor 的**（`vendor/vendor.json`）：

| 插件 | 版本 · 许可 | kit 组件 | 备注 |
|---|---|---|---|
| Leaflet core | 1.9.4 · BSD-2 | 5 个 geo 组件 | Leaflet 2.0 还是 alpha.1，DB 里 0 个插件标为兼容 v2 |
| Leaflet.markercluster | 1.5.3 · MIT | `cluster-map` | 外环按类别分段，效果等于 DonutCluster，不需要额外插件 |
| Leaflet.heat | 0.2.0 · BSD-2（npm 的 license 字段缺失，以 LICENSE 文件为准） | `geo-heat` | 必须设 `maxZoom` |
| topojson-client + world-atlas | 3.1.0 ISC / 2.0.2 ISC | 底图 | 经 `tools/build_geo.py` 包成 classic script |

**DB 里有现成插件、我们选择自研的**（理由：许可、停更，或者更容易统一主题）：

| DB 插件 | 我们的自研替代 | 理由 |
|---|---|---|
| Leaflet.Canvas-Flowmap-Layer、Leaflet.Arc、leaflet.migrationLayer | `flow-map`：SVG 二次 Bézier、箭头、流动光点 | Leaflet.Arc 的大圆弧会跨日界线绕行；另外两个已停更；SVG 打印为矢量 |
| leaflet-choropleth、leaflet-dataclassification | `choropleth` 内置 quantile、equal、nice 分档，带计数图例 | 前者停在 2017 年，后者不在 npm 上 |
| Leaflet.DonutCluster | `cluster-map` 的 `iconCreateFunction` 生成 SVG 分段环 | 它也不在 npm 上 |
| Leaflet.Legend、leaflet-html-legend | kit 的 HTML 图例系统 | 和主题 token、打印样式统一 |
| leaflet-gesture-handling | 核心层已实现：普通滚轮滚动页面，Ctrl/⌘ + 滚轮才缩放（commit `2442ce2`、`88a4097`） | 少一个依赖 |
| leaflet.minichart | 计划用 ECharts pie-on-geo，或 SVG divIcon | **GPL-2.0+**，不能用 |

**下一批候选**（02 §4 已核实版本和许可；按价值排序）：

| 插件 | 版本 · 许可 · gz 体积 | 解决什么 | 触发条件 |
|---|---|---|---|
| **Proj4Leaflet** + proj4 | 1.0.2 BSD-2 + 2.22.0 MIT · 约 45 KB | 在 Leaflet 里用等面积投影（Equal Earth、中国 Albers）画分级设色 | 做中国省级地图或要求面积不失真的世界图 |
| **Leaflet.Sync** | 0.2.4 BSD-3 · 2.5 KB | 地图小多图：前后对比、指标 A 对指标 B | 需要地图 small multiples |
| **@asymmetrik/leaflet-d3**（hexbin），或只用 d3-hexbin | 6.0.1 MIT · 5.7 KB + d3；d3-hexbin 0.2.2 BSD-3 · 1.7 KB | 有定量图例的 hexbin 密度图。比模糊热力图更适合 pitchbook | `geo-heat` 的升级版 `hexbin-map` |
| leaflet-svg-shape-markers | 1.4.0 MIT · 很小 | 给地图符号加**形状**通道 | 类别需要用形状区分（不超过 4 类） |
| leaflet-textpath | 1.3.0 MIT · 很小 | 沿流向弧线写标签（"$4.2bn"） | `flow-map` 的标注增强 |
| Leaflet.glify | 3.3.1 MIT · 39.7 KB | Leaflet 里用 WebGL 画 10 万级以上的点 | 大数据点位；否则用 deck.gl（懒加载） |
| protomaps-leaflet + pmtiles | 5.1.0 BSD-3 · 37.7 KB | 离线街道级矢量底图（PMTiles 用 base64 内嵌） | 只在客户要求街道底图时使用 |

**不能用的：**
- `leaflet.minichart`：GPL。
- `Leaflet.VectorGrid`：Beerware 许可。
- `leaflet.pattern`：许可不明。
- `leaflet-easyprint`、`leaflet-image`：停在 2016–17 年。
- Leaflet 2.0 alpha：插件全部不兼容。

**维护方法：**
- 每月 sparse checkout 一次 `docs/_plugins`，统计 `compatible-v2: true` 的插件数量。
- 等数量明显增长、2.0 也出了正式版，再评估迁移。

### 2.5 awesome-dataviz → 库雷达（发现，而不是采用）

- 它已经被并进 `research/catalog.json`（239 个库，每个都有 verdict）。新库进入 kit 前，必须先在 catalog 里有一条 verdict。
- **需要关注的新库**（07 §7）：

  | 库 | 判断 |
  |---|---|
  | Vela 0.8.4 | Apache-2.0，IIFE 1 MB，TradingView 风格的金融图。0.x 版本，持续观察 |
  | Flint | Step 2 用，见 1.8 |
  | AG Charts Community 14.2.0 | MIT 部分可以考虑；Enterprise 功能是商业许可 |
  | ChartGPU | WebGPU，解包后 135 MB，avoid |
  | Perspective、Vizzu、Mosaic | 依赖 WASM 或 ESM-only，`file://` 下不可用 |

- **它的 Dashboards & BI 节**（13 条）提供了架构先例：
  - **Evidence**（SQL + Markdown 报告）和 **Observable Framework**（数据 loader 生成静态快照）与我们的思路最接近。
  - 09 已经借鉴了它们的 loader 约定，并确认：两者的输出都需要 HTTP，不能 `file://` 打开。
- **每月 diff 一次** Financial、Maps、Misc 三节，新增条目交给 07 的核实流程：`npm view` 查版本和许可 → 看 jsDelivr 有没有 UMD dist → `file://` 实测。

### 2.6 设计参考（shadcn / Tremor / Tabler）→ 组件词汇

| Tremor 或 shadcn 原语 | ReportKit 对应 | 状态 |
|---|---|---|
| SparkChart | `kpi-tiles` 的 `spark` 通道 | ✓ |
| BarList（带标签的横向排名条） | `bar` 的横向排序模式；`league-table` 的行内数值条 | ✓ |
| CategoryBar（单根分段条） | `bullet` 的定性区间；`waffle` | ◐。可以给 `kpi-tiles` 加一个 `segments` 通道 |
| Tracker（状态条带） | 无 | ✗。做交易进度或 SLA 页时可以加进 `timeline` |
| ProgressCircle / radial KPI | 不做仪表盘式的圆环 | 06 §11 判定低数据墨水比；真需要时用 `@echarts-x/custom-segmented-doughnut` |
| tooltip 版式（indicator line/dot/dashed） | `rk.chart` 的 tooltip | 打磨项 |
| `--chart-1..5` CSS 变量 | `--rk-*` token → `RK.theme` → ECharts `rk` 主题 | ✓（架构一致） |

---

## 3. 用这些合集扩展 ReportKit：标准工作流

### 3.1 八步流程

```text
需求（action title / 投行场景）
  │
  ├─①  选图型 ─── FT Visual Vocabulary：这是什么关系？
  │                └ data-to-viz：手上是什么形状的数据？
  │                └ Data Viz Catalogue：金融图型查漏（只看概念）
  │                └ 先查 landscape §3：现有组件加个选项能不能解决？能就不新建组件
  │
  ├─②  找参考实现 ─ ECharts examples（chart-list-data.js 的 id / since）
  │                └ 交互模式：Vega-Lite Interactive 节；时间范围按钮等：Plotly Financial 节
  │                └ SVG / DOM 组件：D3 Graph Gallery（要从 v4/v6 移植到 v7 的写法）
  │                └ 记下许可：Apache-2.0 / MIT 可以改写；有版权的只借概念
  │
  ├─③  需要新依赖吗？
  │       优先级：ECharts 原生 > @echarts-x/* 官方 custom series > 合集里的插件 > 自研
  │       引入前的核实清单：
  │         npm view <pkg>@<ver> version license peerDependencies dist.integrity
  │         jsDelivr dist 列表里有 UMD / IIFE（不能是 ESM-only，不能要 WASM）
  │         file:// 实测，并拦截所有网络请求，确认 0 外连
  │         写进 vendor/vendor.json（精确版本 + LICENSE），运行 python3 tools/vendor.py <id>
  │
  ├─④  写组件 ──── kit/components/<id>/<id>.js
  │       RK.component({id, deps, defaults, render: RK.chart(build)})
  │       颜色只用 ctx.theme，数字只用 RK.format / ctx.fmtOf，交叉筛选用 ctx.select
  │       动画看 ctx.motion，打印看 ctx.print；SVG renderer 输出矢量
  │
  ├─⑤  写 manifest ─ kit/components/<id>/manifest.json（契约见 docs/architecture.md §6.2）
  │       必填字段：id、name、name_zh、category（12 类之一）、engine、deps、summary(_zh)、
  │       description_zh、best_for、avoid_when、channels、options、interactions、samples
  │       建议新增 refs，记录溯源（见 3.2）
  │
  ├─⑥  示例数据 ─── kit/samples/datasets/<name>.json（数据契约见 docs/architecture.md §4）
  │       meta.source 写明"合成数据"；建议给 meta 加 shape 标签（data-to-viz 形态）
  │
  ├─⑦  构建与测试 ─ python3 tools/build_catalog.py --strict
  │                 （生成 kit/catalog.json、gallery/catalog.js、docs/component-catalog.md）
  │                 bash tools/check.sh（vendor 文件 / Python / JS / catalog / 浏览器冒烟）
  │                 截图 tests/screens/<id>.png 和 <id>-ink.png（暗色），再打印 PDF 看矢量和分页
  │
  └─⑧  回写 ────── 更新 landscape §3 的覆盖矩阵（✗ → ✓）
                   新依赖要在 research/catalog.json 里有 verdict，并标 in_kit
```

### 3.2 建议给 manifest 加的 `refs` 字段

`tools/build_catalog.py` 只校验 `id`、`category` 和 `<id>.js` 是否存在，额外字段会原样进入 `kit/catalog.json` 和 `gallery/catalog.js`。所以加 `refs` 不需要改构建脚本。它有三个用途：
- gallery 可以显示"参考实现"链接；
- Step 2 的 LLM 可以按 FT 类别或数据形态检索组件（这正是 07 §10 R1 的建议）；
- 许可审计可以追溯到出处。

```json
"refs": {
  "ft": ["Change over Time:fan"],
  "dataShape": "TimeSeries:OneSeries+Interval",
  "echartsExample": [],
  "echartsCustomSeries": "@echarts-x/custom-line-range@1.1.1",
  "vegaLite": "layer_line_errorband_ci",
  "plotly": "/javascript/continuous-error-bars/",
  "license": "Apache-2.0 (echarts-custom-series); concept only from FT"
}
```

> `vegaLite` 和 `plotly` 两个值是示意。写进真实 manifest 之前，要先对照 Vega-Lite 的 `examples.json` 和 Plotly 的页面核实。

### 3.3 完整示例：fan chart（P1 缺口）

| 步骤 | 内容 |
|---|---|
| ① 选型 | FT 的 Change over Time → `fan`："Use to show the uncertainty in future projections"。data-to-viz 的形态是一条时间序列加上下区间。现有的 `line` 只有预测期虚线，**没有区间**，所以要么给 `line` 加选项，要么新建组件。区间带不止 fan chart 用得上（一致预期的高低区间、情景区间），建议做成 `line` 的 `band` 选项，同时在 gallery 里单独列一个 "Fan chart" 示例 |
| ② 参考 | `@echarts-x/custom-line-range`：官方 custom series，Apache-2.0，`line-range.auto.min.js` 约 2 KB，06 §3 已核实。旁证是 Plotly Financial 节的区间带 |
| ③ 依赖 | 在 `vendor/vendor.json` 新增 `{"id":"echarts-line-range","npm":"@echarts-x/custom-line-range","version":"1.1.1","license":"Apache-2.0","files":{"dist/line-range.auto.min.js":"line-range.auto.min.js","LICENSE":"LICENSE"}}`。tarball 里的确切文件路径要以运行 `vendor.py` 时的结果为准。它要求 ECharts ≥ 6，我们是 6.1.0 |
| ④ 组件 | 在 `line.js` 里：`band` 选项为 `{low, high, levels:[0.5, 0.8, 0.95]}`，渲染为 `type:'custom', renderItem:'lineRange'`。颜色用 `ctx.theme.seq[]` 的浅色梯度，越靠外越浅。预测起点画竖线，用 markLine 实现 |
| ⑤ manifest | `channels` 新增 `low`、`high`，或用 `band` 通道组；`best_for` 写"consensus range、scenario fan、forecast CI"；`refs` 按 3.2 填 |
| ⑥ 数据 | `kit/samples/datasets/forecast_fan.json`：年份、实际值、p10–p90 |
| ⑦ 测试 | `tools/check.sh` 全部通过；截图 light 和 ink 两版；打印 PDF 确认区间带是矢量 |
| ⑧ 回写 | landscape §3.2 的 "Change over Time / fan" 从 ✗ 改为 ✓ |

### 3.4 不要做的事

1. 不要从 Data Viz Catalogue、Datavizproject 复制文字或缩略图。不要用 FT 的配色、字体、logo。
2. 如果在 gallery 里引用 awesome-dataviz 的描述文字，必须写明 CC BY 4.0 署名。CC0 的列表（awesome-d3、awesome-echarts、awesome-geojson 等）不需要署名。
3. 不要照抄 Tabler 的图表 widget（ApexCharts 双许可）。AdminLTE 和 Tabler 的演示页从 CDN 加载，不能拿来当离线模板。
4. 不要直接搬 D3 Graph Gallery 或 FT 模板的代码。它们分别是 d3 v4/v6 和 d3 v4，v6 起去掉了 `d3.event`。我们只在必要时 vendor d3 7.9 的 UMD。
5. 不要用合集里的在线服务处理客户数据：
   - Google Charts loader
   - ECharts 的 gmap / amap / bmap 扩展
   - AntV `chart-visualization` 技能和 `mcp-server-chart`（都走云端渲染）
   - vega-embed 的 "Open in Vega Editor"，要设 `actions:false`
6. 不要相信合集里的支持徽章，一律用 `npm view` 和 `file://` 实测复核。

---

## 4. 维护节奏（成本很低，建议每月一次）

| 检查项 | 怎么做 | 关注什么 |
|---|---|---|
| awesome-dataviz | diff Financial、Maps、Misc 三节 | 新库先进 `research/catalog.json` 待评估 |
| Leaflet Plugins DB | 统计 `docs/_plugins/**/*.md` frontmatter 里 `compatible-v2: true` 的数量 | Leaflet 2.0 的迁移时机 |
| ECharts examples | 按 `chart-list-data.js` 的 `since` 字段筛新示例 | 能改写成新组件或新选项的能力 |
| `@echarts-x/*` | `npm view` 看新版本和新包 | 新的官方 custom series |
| chartjs/awesome | 复核 peerDependencies | 只用作旁证 |
| AntV、VisActor skills 仓库 | 看技能包结构和评测用例的变化 | Step 2 技能格式 |

---

## 附：来源索引

- 合集主笔记：`research/raw/07-collections.md`，§2 总表、§3 README 深挖、§5 分类法、§7 新秀、§9 坑、§10 建议、附录 A（FT 72 种图型）、附录 B（ECharts 示例 id）。
- 地图插件核实：`research/raw/02-geo-maps.md` §4、§6、§10。
- 投行参考集：`research/raw/04-pitchbook-design.md` §1、§9、§11 及其来源节。
- 中国生态相关合集：`research/raw/06-china-xhs.md` §3、§4、§6、§7、§13，详见 `research/china-ecosystem.md`。
- 图标：`research/raw/05-motion-ui.md` §5。Skills 规范：`research/raw/08-query-ai.md` §9。架构先例：`research/raw/09-architecture.md` §2。
- kit 现状：`kit/categories.json`、`kit/catalog.json`、`docs/component-catalog.md`、`vendor/vendor.json`、`research/landscape.md` §3。
