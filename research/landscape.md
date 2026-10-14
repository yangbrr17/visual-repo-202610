# ReportKit 可视化技术版图调研报告（Landscape）

> **日期** 2026-10-14 · **读者** 投行客户报告产品负责人 · **范围** 离线、数据分离、可交互、pitchbook 级（GS/JPM 质感）的报告套件
> **依据** `research/raw/01–09-*.md`（细节笔记）与 `*.json`（结构化结论）、`research/catalog.json`（去重后 239 个库）、`vendor/vendor.json`、`kit/build.json`、`kit/components/*/manifest.json`（57 个组件）、`docs/architecture.md`。
> **复核** 2026-10-14 按 Step 1 第一阶段补齐项（单文件 HTML、Excel 导出、vendor 完整性哈希、Letter / A4、1:50m 底图、i18n、红涨绿跌）更新了 §0 的现状与"未完成项"；调研结论本身未变。
> **约定**
> - 版本、许可、star、体积都取自调研笔记。笔记的口径是：2026-10-14 实查 npm registry，看 jsDelivr 上的 dist 列表，自己跑 `gzip -9` 测体积，star 取自 ecosyste.ms 或 shields.io。本文不另行估算。
> - `file://` 指双击 `index.html` 打开。符号含义：✓ 已实测可用；✗ 已实测失败；◐ 部分可用或有条件；— 未测或不适用。
> - Verdict 用 4 级：**adopt** 采用、**consider** 备选、**reference** 仅作参考、**avoid** 避免。

---

## 0. 一页结论

**一句话：** 我们以三个 permissive 许可的 classic-script 引擎为主，即 **Apache ECharts 6.1.0 + Leaflet 1.9.4 + Tabulator 6.6.1**，另加自研、零依赖的公式 / 查询 / 版式表格 / 动效层。产出是一个双击即开（`file://`）、数据与版式分离、打印为矢量的报告文件夹（也可输出单个自包含 HTML 与 Excel 底稿）。57 个组件完整覆盖 FT Visual Vocabulary 72 种图型中的 50 种，另有 5 种部分覆盖（§3）。

### 0.1 推荐技术栈（与 `vendor/vendor.json` 逐项一致）

| 角色 | 库（npm 包） | 版本 | 许可 | 为什么 |
|---|---|---|---|---|
| 主图表引擎（37/57 个组件） | Apache ECharts（`echarts`） | 6.1.0 | Apache-2.0（随附 NOTICE、LICENSE-d3） | 只有它同时满足四点：许可 permissive、由 ASF 治理、一个 classic script（full UMD，1095 KB min / 359 KB gz）就能覆盖几乎全部 IB 图型、SVG renderer 打印出来是矢量且文字可选中。v6 新增的 axis break、matrix 坐标系、chord、beeswarm 和运行时 `setTheme()` 都已在 `file://` 下验证（01 §0、§5.1） |
| 交互地图（5 个 Leaflet 组件；geo 类第 6 个组件 `china-tilemap` 用 ECharts） | Leaflet（`leaflet`） | 1.9.4 | BSD-2-Clause | 147.6 KB raw / 42.4 KB gz，SVG 输出打印为矢量。2.0 目前只有 `2.0.0-alpha.1`，且 1.x 插件在 2.0 上会失效（02 §3） |
| 点聚合 | `leaflet.markercluster` | 1.5.3 | MIT | 密集点位的标准方案，8.7 KB gz。没有瓦片层时，必须给地图设 `maxZoom`（02 §4） |
| 密度热力 | `leaflet.heat` | 0.2.0 | BSD-2-Clause（npm 的 license 字段缺失，以 LICENSE 文件为准） | 2.1 KB gz。强度按 `1/2^(maxZoom−zoom)` 缩放，kit 的 `geo-heat` 已处理（02 §7.5） |
| TopoJSON 解码 | `topojson-client` | 3.1.0 | ISC | 2.6 KB gz，用来解码离线底图；`mesh()` 可以只画内部边界（02 §4） |
| 离线世界底图（数据） | `world-atlas` | 2.0.2 | ISC（数据来自 Natural Earth，public domain） | 110m 版 108 KB raw / 38 KB gz。仓库已归档，数据停在 NE 4.1.0，计划升级（§2.2） |
| 底图的 classic-script 包装 | `geo-world`（由 `tools/build_geo.py` 从 world-atlas 2.0.2 生成） | world-atlas 2.0.2 | 同上 | `file://` 下不能 fetch JSON，所以底图必须写成 `RK.geo.register('world-110m', …)` 形式的脚本（02 §1、09 §1） |
| 高精度底图（按需打包） | `geo-world-50m`（同上，countries-50m） | world-atlas 2.0.2 | 同上 | 756 KB；含 110m 缺失的新加坡、香港、澳门、巴林、马耳他、开曼、百慕大等。只有 block 设了 `basemap: "world-50m"` 时，builder 才通过组件 manifest 的 `optionDeps` 打包它 |
| 交互数据网格（`data-grid`） | Tabulator（`tabulator-tables`） | 6.6.1 | MIT | MIT 许可、UMD 构建、DOM 渲染（可打印、可复制、可访问），约 103 KB gz。支持冻结列、多级表头、groupBy、CSV 下载（03 §4.1） |
| 正文 / UI / 数字字体 | Inter（`@fontsource/inter`） | 5.3.0 | OFL-1.1（无 Reserved Font Name） | 保留了 `tnum`，所以 `tabular-nums` 仍生效。字体放在 `kit/fonts/` 子目录，符合 `file://` 的字体加载规则（05 §6） |
| 标题衬线字体 | Source Serif 4（`@fontsource/source-serif-4`） | 5.3.1 | OFL-1.1（RFN 为 "Source"，自行子集化后不能沿用原名） | 用于精品投行风格的 action title（04 §3.3、05 §6.4） |

**自研零依赖层**（不进 vendor，代码在 `kit/core/*` 与 DOM 组件里）：

| 层 | 实现 | 为什么不用第三方 |
|---|---|---|
| 公式 | `RK.expr`：没有 `eval`，也没有 `new Function` | 100k 行逐行求值 14 ms，比 math.js、expr-eval-fork、filtrex（45–72 ms）都快，且能在严格 CSP 下运行（08 §0.1） |
| 查询与交叉筛选 | `RK.query` + `RK.store`，交叉筛选按"组件不被自己的筛选过滤"的 crossfilter 语义 | 40 组 group-by：10k 行 17 ms，100k 行 45 ms，1M 行约 0.7 s（08 §5.1） |
| 数字格式 | `RK.format`，用 Excel 风格格式码（`0.0x`、`#,##0;(#,##0)`） | ECharts 没有格式串系统，而且各家投行 house style 不同（01 §5.1.5、04 §6） |
| 动效 | `RK.motion`：IntersectionObserver reveal、count-up、View Transitions `swap()`、实时响应 reduced-motion | Pudding、Reuters 这类顶级数据新闻团队都不依赖动画库；GSAP 的许可不是 OSI 许可（05 §0） |
| 版式表格 | `comps-table`、`sensitivity-table`、`league-table`、`pivot-table`，都是 DOM `<table>` | 打印为矢量，能复制到 Excel/PPT，支持 Ctrl+F，没有许可风险（03 §0.1、§6） |
| 控件 | `filter-bar`、`param-slider`、`scenario-switch`、`query-console`（DOM） | 05 推荐过 Tom Select、noUiSlider、Floating UI，但 kit 先自研实现，**没有 vendor** 这些库 |
| 地图几何 | `RK.geo` 加载底图时，把跨越 ±180° 的环切成平面片段 | world-atlas 的拓扑是按球面渲染缝合的，平面渲染器会画出横贯地图的条纹（02 §0.3） |

### 0.2 关键决策

1. **只用一个主引擎：ECharts 6.1.0。** AntV G2 5.4.8（320 KB gz）和 VisActor VChart 2.1.7（617 KB gz）都是 MIT 许可的强力备选，但它们 canvas 优先、文档以中文为主、由企业治理，而且都和 ECharts 功能重叠，所以"借思路，不切换"（01 §0.5、06 §0.1）。
2. **`file://` 是硬墙，按硬墙设计。** fetch/XHR、ES module（包括动态 `import()`）、基于文件的 Worker 都被拦截；classic `<script src>`、子目录字体、Blob/data: worker 可用。09 在 Chromium 156 和 Firefox 157 上实测了这些规则，01、03、05、08 在 Chromium 141 上得到相同结论（09 §1）。因此：
   - 数据走 `data/bundle.js` 里的 `RK.data.preload(…)`。超过 1,000,000 字符时改用 `JSON.parse("…")` 形式，Chromium 下加载快约 2.8 倍（09 §1.1）。
   - 默认包里不放任何 ESM/WASM 库。
3. **打印优先。**
   - 默认用 ECharts SVG renderer（`kit/core/rk.chart.js`）。canvas 图在 PDF 里是约 104 ppi 的位图，SVG 图保持矢量（01 §5.1.4、09 §8）。
   - 标题、单位、来源、脚注写在 HTML 里，不画进 canvas。
   - 页面默认 16:9、13.333 × 7.5 in，Chromium 实测输出恰好 960 × 540 pt 的 PDF 页（09 §0.7）。
   - 04 的一手证据显示，美国投行实际用 **US Letter 11 × 8.5 in**；kit 已提供 `Report(page_size="letter" | "a4")` 报告级选项。
4. **表格分三层：**
   - 自研 DOM 表格承担印刷级的 comps、sensitivity、league 和 pivot 表；
   - Tabulator 承担大型交互明细表；
   - 重度透视表留给以后懒加载的 AntV S2 或 VTable（03 §0、06 §0.5）。
5. **地图方案：**
   - Leaflet 1.9.4 加最少插件，不用瓦片，Natural Earth 矢量底图配主题色。
   - ECharts geo 作为第二引擎，按需使用（pie-on-geo、map↔bar morph、d3 投影）。
   - 不用 MapLibre 6（ESM-only）、L7、kepler.gl（02 §0）。
6. **动效零依赖。** 图表动画用 ECharts 自带的 `universalTransition` / `animationDurationUpdate`，DOM 动画用 CSS + WAAPI + IntersectionObserver + View Transitions。打印和 reduced-motion 时关闭（05 §0、§3）。
7. **公式和查询引擎都自研。** `RK.expr`、`RK.query`、`RK.store` 在安全、速度、领域语法三方面都胜过现有库（08 §0.1–0.9）。DuckDB-WASM 将来作为可选的 SQL power-pack（约 46 MB，启动 2–4 s）。
8. **供应链纪律：**
   - `vendor.json` 只写精确版本，`tools/vendor.py` 用 `npm pack` 拉包（不执行安装脚本），每个 dist 旁边保留上游 LICENSE。
   - 升级前重新查许可：ApexCharts 在一个 minor 版本里从 MIT 变成了专有许可。
   - 完整性哈希已补上：`vendor.json` 记录 npm tarball `integrity`（sha512）和每个分发文件的 sha256，`tools/vendor.py --check` 离线校验（AntV 的 npm 命名空间在 2026-05-19 被投毒，01 §9.6、06 §2）。

### 0.3 红旗清单（许可、合规、离线、安全）

| # | 红旗 | 事实 | 我们的处置 | 来源 |
|---|---|---|---|---|
| 1 | **ApexCharts ≥ 5.1** | 4.7.0 和 5.0.0（2025-07-09）还是 MIT；**5.1.0（2025-07-09）起改为专有双许可**，Community 版只给年收入低于 US$2M 的组织（含母公司和关联方）免费使用，当前版本 8.2.0。Tabler 的 23 个 demo 页仍在用 ApexCharts 7.0.0 | avoid。从 Tabler 复制组件时要删掉 ApexCharts 部分 | [LICENSE.md](https://cdn.jsdelivr.net/npm/apexcharts@8.2.0/LICENSE.md)，01 §5.12，07 §0.6 |
| 2 | **GSAP 3.15.0 不是 OSI 许可** | "Standard 'No Charge' GSAP License"（2025-04-30 生效）：Webflow 可以随时修改或终止，禁止用于和 Webflow 竞争的无代码动画工具，也没有明文授予再分发权 | avoid。用 ECharts、CSS、WAAPI 实现；确实需要 JS 引擎时用 MIT 的 Motion 或 anime.js | [gsap.com/standard-license](https://gsap.com/standard-license)，05 §2.2 |
| 3 | **AG Grid / AG Charts 的 Community 版缺功能** | AG Charts Community 14.2.0 一用到 waterfall、sankey、heatmap、box-plot、candlestick、radar、funnel、treemap、zoom、navigator 就报 Enterprise 警告且不渲染。AG Grid Community 36.2.0 没有分组、聚合、pivot、Excel 导出、sparkline、剪贴板、区域选择；Enterprise 每开发者 $999，与 AG Charts 捆绑 $1,498 | AG Charts：avoid。AG Grid Community：consider，作为 Tabulator 的替补。**不得 vendor `ag-grid-enterprise`**（没有 key 会出水印，正式使用即违约） | [AG Charts CE vs EE](https://www.ag-grid.com/charts/javascript/community-vs-enterprise/)，[AG Grid 定价](https://www.ag-grid.com/license-pricing/)，01 §5.10，03 §2 |
| 4 | **Highcharts / amCharts / ZingChart 是商业或带品牌的许可** | Highcharts 13.1.1：给客户的报告需要 SaaS 许可，默认显示 credits 链接。amCharts 5.21.2：logo 和链接必须保留（linkware）。ZingChart 2.9.16-1：免费版有强制水印 | reference，只作设计参考 | [Highcharts license](https://shop.highcharts.com/license)，[amCharts LICENSE](https://unpkg.com/@amcharts/amcharts5@5.21.2/LICENSE)，01 §5.13 |
| 5 | **TradingView Lightweight Charts 的署名条款** | 5.2.1 是 Apache-2.0，但**另外要求**在页面上放 NOTICE 署名和 tradingview.com 链接。NOTICE 文件只在 GitHub 仓库里，npm tarball 里没有 | reference。价量图用 ECharts candlestick + dataZoom。无署名条款的替代：KLineChart 10.0.4（Apache-2.0）；Vela 0.8.4 尚在 1.0 之前，持续观察 | [README](https://unpkg.com/lightweight-charts@5.2.1/README.md)，01 §5.14，07 §9 |
| 6 | **SheetJS 的 npm 版本有 CVE** | npm 上的 `xlsx` 停在 0.18.5，存在 [CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533.html) 和 [CVE-2024-22363](https://advisories.gitlab.com/npm/xlsx/CVE-2024-22363/)。CE 0.20.3 只在 cdn.sheetjs.com 发布 | 永远不 `npm i xlsx`；需要读取客户 xlsx 时，从 cdn.sheetjs.com 拉 0.20.3（`vendor.py` 要支持 URL 来源） | 03 §4.17、§10.10 |
| 7 | **中国地图的审图号合规** | 依据地图管理条例（2015）和地图审核管理规定（2017，2019 修订），公开展示的中国地图需要审图号。自然资源部的标准地图只能原样使用；放大、缩小、裁剪都要重新送审。DataV.GeoAtlas 的数据注明"仅供学习和交流使用"（数据来自高德）。GADM 禁止商用和再分发。微软已停止向中国 Excel 用户提供地图图表 | 面向中国境内受众的交付物：用经审定或授权的底图，或者用 tile-grid 省份方块图（不画边界，需包含台湾、香港、澳门；kit 已有 `china-tilemap`，34 个省级方块含台港澳）。在法务流程中签字确认；底图 manifest 标注 `prc_reviewed:false`（**待实现**） | [中国日报](https://cn.chinadaily.com.cn/a/202308/28/WS64ec4ceba3109d7585e4b1e1.html)，[DataV](https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)，[GADM](https://gadm.org/license.html)，[Microsoft](https://support.microsoft.com/en-us/Support/known-issues/excel-2d-map-charts-and-3d-maps-are-suspended-for-china)，02 §6.3 |
| 8 | **AntV L7 会主动外连** | L7 2.29.1 默认从 `gw.alipayobjects.com` 拉 logo。在拦截网络的离线测试里，它是唯一一个发出外部请求的引擎（1 次）。设 `logoVisible:false` 后为 0。它的中国底图（高德、腾讯、百度）还需要在线 key | avoid 或 reference。机密数据场景不能有任何外连 | 02 §2（p7），06 §14 |
| 9 | **ESM/WASM 库在 `file://` 下跑不起来** | 实测失败的有：MapLibre GL JS 6.x（6.0.0 起 ESM-only，最后一个 UMD 是 5.24.0）、Perspective 5.6.0（ESM，经 `import.meta.url` 加载 WASM）、Vizzu 0.18.0、Web Awesome 3.14.0、dotlottie-web 0.81.0、Paged.js（用 `<link>` 引入 CSS 时）。另有 ESM-only、需要预打包成 IIFE 的：Unovis、TanStack Table v9、Flint。Leaflet 2.0 alpha 上 1.x 插件会坏 | 默认包只收 classic UMD/IIFE。确需 ESM 库时，在 vendor 阶段用 esbuild 打成 IIFE；WASM 只能走 base64 + `data:` URL 的配方（08 §5.5） | [MapLibre CHANGELOG](https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md)，01 §3，03 §3，05 §1，09 §0.8 |
| 10 | **AntV npm 供应链投毒** | 2026-05-19，"Mini Shai-Hulud" 蠕虫劫持了账号 `atool`，在 317–324 个 `@antv/*` 包以及 `echarts-for-react`、`size-sensor`、`timeago.js` 下发布了 600 多个恶意版本。恶意版本号都高于真实最新版（例如 g2 5.5.8/5.6.8，而真实最新版是 5.4.8），任何 `^` 范围都会把它们拉进来。截至调研时这些版本已返回 404 | 只写精确版本，只用 `npm pack --ignore-scripts`；在 `vendor.json` 里记录 sha512/sha256 并由 `--check` 校验（**已实现**）；不在持有凭据的机器上 `npm install` AntV 包 | [Snyk](https://security.snyk.io/antv-supply-chain-compromise-may-2026)，[StepSecurity](https://www.stepsecurity.io/blog/shai-hulud-here-we-go-again-mass-npm-supply-chain-attack-hits-the-antv-ecosystem)，06 §2 |
| 11 | **会执行代码的引擎** | `expr-eval` ≤2.0.2 有 CVE-2025-12735（RCE，CVSS 9.8）。AlaSQL 4.20.0 的双反引号语法可以执行任意 JS（实测改写了全局变量）。Arquero、AlaSQL、filtrex 都靠 `new Function`，在严格 CSP 下失效 | 不让 LLM 生成的、共享链接带来的或用户输入的 SQL/公式进入这些引擎；保持自研 `RK.expr` | [CVE-2025-12735](https://cvefeed.io/vuln/detail/CVE-2025-12735)，08 §0.2、§0.5 |
| 12 | **Copyleft 和非标准许可** | HyperFormula（GPL-3.0）、simple-datatables（LGPL-3.0）、leaflet.minichart（GPL-2.0+）、world-geojson（GPL-3.0）、typed.js（已改为 GPL-3.0）、DataEase / SQLBot（GPL-3.0 / 改版 GPLv3）、Vivliostyle 和 Metabase（AGPL）、Leaflet.VectorGrid（Beerware）、WebDataRocks（专有 EULA）、Handsontable（专有） | avoid。交付物里只放 MIT / BSD / Apache / ISC 许可的代码和 OFL 字体 | 02 §4，03 §2，05 §0，06 §3，09 §0.8 |
| 13 | **在线瓦片与 ODbL 数据** | OSM 瓦片服务禁止离线使用和批量预取，商业访问可能随时被收回。CARTO 底图商用需要 Enterprise 许可。Protomaps 底图属于 ODbL Produced Work，必须保留 OSM 署名 | 默认不用任何在线瓦片，只用 Natural Earth 矢量底图 | [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)，[CARTO](https://docs.carto.com/faqs/carto-basemaps)，02 §6.1 |
| 14 | **字体许可** | Alibaba PuHuiTi、HarmonyOS Sans、MiSans 用的是厂商自定许可；仓耳今楷（TsangerJinKai）仅限个人使用；AntV Infographic 运行时会从 `assets.antv.antgroup.com` 拉普惠体 | 中文只用 Noto Sans SC / 思源黑体（OFL），并按报告内容子集化 | 06 §12 |

### 0.4 未完成项（产品负责人现在就应知道）

1. ~~**页面尺寸。**~~ 已解决：GS、Morgan Stanley、Evercore 在 EDGAR 上的实际页面都是 **US Letter 横向 11 × 8.5 in**，Rothschild 是 4:3，样本里没有一家用 16:9（04 §0.1）。kit 默认仍为 16:9，`Report(page_size="letter" | "a4")` 切换为 Letter / A4 横向（`<html data-rk-page-size>` + builder 追加的 `@page` 规则）。
2. **底图。** 运行时的反子午线条纹问题已修复；world-atlas 110m 里没有的新加坡、香港、澳门、巴林、马耳他、开曼、百慕大（02 §6.2）现在可以用 `basemap: "world-50m"`（同一 world-atlas 2.0.2 的 1:50m 版，756 KB，按需打包）显示，`choropleth` 对仍无多边形但带经纬度的行画成同色阶的小圆点。仍可考虑：数据停在 Natural Earth 4.1.0，升级到 NE 5.1.2（10m 简化版约 109 KB / 36 KB gz）。
3. **引擎审计的补丁已合入（2026-10-14 复核）。** `research/engine-audit.md` 列出的 36 个缺陷（其中 2 个高危）已全部修复：`node tests/js/engine-audit.test.js` 现为 **164/164 通过**，36/36 个缺陷 ID 都有回归测试；`engine.test.js` 542/542、`core.test.js` 67/67、`formula-doc.test.js` 165/165、`runtime-api.test.js` 53/53。对客户影响最大的 F1 已修：`RK.format(10.35,'0.0x')` 现在输出 "10.4x"，与 Excel 一致。Q9 的自引用检查已移植到 `py/reportkit/validate.py`。仍需跟进：组件和 `rk.geo.js` 里仍有若干 `toFixed`，应改用 `RK.format.fixed`（见 engine-audit.md 的 Resolution 节）。
4. **`file://` 测试已部分覆盖。** `tests/e2e/demo.cjs` 从 `file://` 打开示例报告（筛选、滑块、查询联动、打印 PDF），`tests/e2e/gallery.cjs` 以 `file://` 和 http 两种方式爬遍 gallery 路由，`tests/py/test_delivery.py` 用 Chromium 从 `file://` 打开单文件报告并断言除 `data:` URI 外零网络请求。`tools/smoke.cjs` 仍走本地 http server；Firefox（`security.fileuri.strict_origin_policy=true`）尚未进入测试。
5. **组件目录文件已同步。** git 里的 `kit/catalog.json` 和 `docs/component-catalog.md` 都是 57 个组件、12 类，与 57 个 manifest 一致；`tools/check.sh` 每次都会运行 `python3 tools/build_catalog.py --strict` 重新生成。
6. **已实现 / 尚未实现：**
   - ✅ styled Excel 导出：由 Python builder 用 openpyxl 生成（`excel=True`，每个 dataset 一个工作表、数字格式沿用字段格式码），不在浏览器端；
   - ✅ vendor 完整性哈希（`tools/vendor.py --check` / `--rehash`）；
   - ✅ 单文件模式（`single_file=True` / `--single-file`，零网络请求）；
   - ⬜ 严格的 meta CSP；
   - 🟡 Playwright 导出 PDF：`node tests/e2e/demo.cjs --pdf` 可导出示例报告，builder 本身还没有 `pdf=True`；
   - ⬜ 每个 dataset 单独的 `.js` 懒加载文件。

   相关研究分别见 03 §9、08 §0.13、06 §2、09 §9。

---

## 1. 方法

### 1.1 九个调研方向

| # | 方向 | 笔记 | 评估库数 | 主要验证手段 |
|---|---|---|---|---|
| 01 | 通用图表库 | `research/raw/01-charts-general.md` | 30 | 30 多个库在 `file://` 下的 smoke 测试；用 ECharts 渲染 6 图 pitchbook 页，并打印成 PDF 对比矢量与位图 |
| 02 | 地图 / Leaflet 生态 | `research/raw/02-geo-maps.md` | 30 | 17 个 `file://` 页面，**拦截全部外部请求**，审计离线行为 |
| 03 | 表格 / 网格 / 透视 | `research/raw/03-tables-grids.md` | 33 | 每个库在 `file://` 下渲染一张 5 行 comps 表（冻结首列、列分组、统计行） |
| 04 | Pitchbook 设计规范 | `research/raw/04-pitchbook-design.md` | 33 | SEC EDGAR 上 GS、MS、Evercore、Rothschild、Centerview 的 EX-99.(c) 原件；色板经 dataviz `validate_palette.js` 校验 |
| 05 | 动效 / UI 控件 / 图标 / 字体 | `research/raw/05-motion-ui.md` | 34 | 20 个 UMD 包在 `file://` 下实际初始化；用 fontTools 解析字体特性；用 esbuild 测 IIFE 子集体积 |
| 06 | 中国生态与小红书 | `research/raw/06-china-xhs.md` | 30 | 检查 UMD bundle 里的外连代码；npm 404 复核；掘金 / 搜狗微信 / CSDN 社区信号 |
| 07 | 已打包好的大仓库（合集、画廊） | `research/raw/07-collections.md` | 28 | `git clone --depth 1` 后统计 README 分类；解析 Leaflet 插件 frontmatter 和 ECharts `chart-list-data.js` |
| 08 | 浏览器内查询 / AI 引擎 | `research/raw/08-query-ai.md` | 30 | 统一基准（10k / 100k / 1M 行）；严格 CSP 探针；DuckDB-WASM 在 `file://` 下的离线配方 |
| 09 | 打包架构 | `research/raw/09-architecture.md` | 30 | 在 Chromium 156 + Firefox 157 测 `file://` 能力矩阵；40k 行数据加载基准；PDF 页面尺寸实测 |

9 个方向合计 278 条记录，按库名去重后剩 **239 个库**：**44 adopt / 55 consider / 84 reference / 56 avoid**。合并由 `tools/build_research_catalog.py` 生成 `research/catalog.json`，`in_kit` 标记表示该库已 vendor。例外：两款已 vendor 的字体（Inter、Source Serif 4）在 catalog 里 `in_kit` 仍为 false，因为调研记录的包名是 `inter-ui` 和 `@fontsource-variable/source-serif-4`，而 vendor 的是静态的 `@fontsource/inter`、`@fontsource/source-serif-4`，名称对不上。

### 1.2 事实核验口径

- **版本、许可、发布日期：** 2026-10-14 在 npm registry 上实时执行 `npm view <pkg> version license time dist-tags`。ApexCharts 的许可变化逐个版本二分确认（01 §5.12）。
- **dist 文件与体积：** 用 jsDelivr data API 列出文件；下载真实的 dist 文件，自己跑 `gzip -9 | wc -c`，不用官网宣传的数字。
- **Stars：** GitHub API 在本环境被网关拦截，改用 repos.ecosyste.ms、shields.io 或 ungh.cc，数值为近似值。
- **`file://` smoke 测试：** 01、03、05、08 用 headless **Chromium 141.0.7390.37**（Playwright 1.56.1）；02 用 Playwright 自带的 `chromium-1194`（SwiftShader WebGL2），并拦截了全部外部请求。09 用 **Chromium 156.0.8078.4 + Firefox 157.0**（Playwright 1.64）。Playwright 自带的 Firefox 把 `security.fileuri.strict_origin_policy` 设成了 `false`，会掩盖拦截，所以 Firefox 结果都在恢复为 `true` 后重跑过（09 §0）。
- **已知局限：**
  - 05 没有实测 Firefox 和 Safari，相关结论来自文献；
  - Ollama 的 CORS 行为来自阅读源码，没有对真实进程实测（08 §8.2）；
  - 小红书无法访问（§2.6）；
  - CSDN 正文被 JS 校验拦截，只用了标题。

### 1.3 各方向共同的地基：`file://` 能力矩阵（09 §1，Chromium 156 / Firefox 157 实测）

| 被拦截 | 可用 |
|---|---|
| `fetch` / XHR 读本地 JSON | classic `<script src>`（静态写入或运行时注入均可，`document.currentScript` 有值） |
| `<script type=module>` 和动态 `import()` | 外链 CSS；放在子目录（不能是父目录）的 `@font-face` 字体 |
| `new Worker('file.js')`、Service Worker | Blob URL 和 `data:` 创建的 Worker；内联的 WASM 字节；对 `data:`、`blob:` URL 的 fetch |
| iframe 的 `contentDocument`；外链样式表的 `cssRules` | `localStorage`、IndexedDB、`crypto.subtle`（`isSecureContext === true`，`origin === "null"`） |
| 画过本地 `<img>` 的 canvas 调 `toDataURL`；外链 SVG sprite `<use href="x.svg#id">`（05 §1） | 内联 `<symbol>` sprite、`<img src=x.svg>`、剪贴板 API、`<a download>` 下载 Blob |

**推论：** 数据、底图、主题、图标都必须写成 classic JS 或内联到页面里。浏览器不会解压本地文件，所以在 `file://` 下决定加载成本的是**原始体积**，gzip 体积只影响邮件或 zip 投递（08 §11.12）。

---

## 2. 分方向结论

### 2.1 通用图表库（01）

| 库 | 版本 | 许可 | 体积（gz） | Stars | `file://` | Verdict | 理由 |
|---|---|---|---|---|---|---|---|
| **Apache ECharts** | **6.1.0** | Apache-2.0 | 359 KB full / 233 common / 164 simple | 67.5k | ✓ | **adopt（已 vendor）** | 一个脚本覆盖约 95% 的 IB 图型；同时有 SVG 和 canvas renderer；Node SSR（`renderToSVGString`，约 60 ms 一张）可以用同一个 UMD 文件 |
| @echarts-x/custom-*（官方 custom series） | 1.0.x–1.2.x（bar-range 1.2.1、violin 1.1.1） | Apache-2.0 | 每个约 1–2 KB | 74（仓库） | ✓（`*.auto.min.js` 自动注册） | adopt（**未 vendor**） | violin、bar-range、line-range、contour、segmented doughnut |
| echarts-gl | 2.1.0 | MIT | 170 KB | — | ✓ | consider（06 判 avoid） | 只在需要 3D vol surface 时用；WebGL 输出打印为位图 |
| D3 | 7.9.0 | ISC | 90 KB | 113.7k | ✓ | consider（工具层） | 只当工具用：d3-format、scale、hierarchy、geo |
| uPlot | 1.6.32 | MIT | 21 KB | 10.5k | ✓（需要合法的 Intl locale） | consider | 表格里的 sparkline、超过 1M 点的序列 |
| Vega-Lite / Vega / vega-embed | 6.5.0 / 6.4.0 / 7.3.0 | BSD-3-Clause | 合计约 275 KB | 5.5k / 12.0k | ✓（npm 声称 ESM-only，但 UMD 仍在发布） | consider（Step 2 懒加载） | 声明式交叉筛选最好，对 LLM 最友好；但没有动画，也没有 sankey、chord、radar |
| Plotly.js | 4.1.2 | MIT | 1441 KB full / 422 KB finance | 18.4k | ✓（geo 图默认从 cdn.plot.ly 拉数据） | consider（窄用途） | 太重；v4 换了颜色解析库 culori，并删除了 mapbox traces |
| AntV G2 | 5.4.8 | MIT | 320 KB | 12.6k | ✓ | reference | 有原生 Mekko（`flexX`）和 broken axis；但 canvas 优先，命名空间曾被投毒 |
| VisActor VChart | 2.1.7 | MIT | 617 KB | 1.8k | ✓ | reference | 动效和叙事能力最强，有原生 waterfall / mosaic；但最重，且只有 canvas |
| Observable Plot | 0.6.17 | ISC | 67 KB（另需 d3 90 KB） | 5.4k | ✓ | reference | 无缩放、无交叉筛选、无动画；类目轴默认按字母排序 |
| Chart.js | 4.5.1 | MIT | 68 KB core | 67.7k | ✓ | reference | 只有 canvas，打印为位图；插件维护参差（datalabels 最后发版在 2022-12） |
| billboard.js | 4.1.1 | MIT | 267 KB（pkgd） | 6.0k | ✓ | reference | 图型太少（没有 sankey、sunburst、heatmap、geo） |
| AG Charts Community | 14.2.0 | MIT（Enterprise 为商业许可） | 412 KB | 0.5k | ✓ | **avoid** | 免费层缺几乎所有 IB 图型、缩放和动画 |
| IBM Carbon Charts | 1.27.21 | Apache-2.0 | 161 KB | 1.1k | ✓（locale 为 `en-US@posix` 时崩溃） | reference | 外观锁定 Carbon 设计语言 |
| ApexCharts | 8.2.0 | 专有双许可（5.1.0 起） | 260 KB | 15.2k | ✓ | **avoid** | 见红旗 #1 |
| Highcharts / amCharts 5 / ZingChart | 13.1.1 / 5.21.2 / 2.9.16-1 | 商业 / linkware / 带水印 | 99 / — / 256 KB | 12.5k / 0.4k / 0.3k | ✓ / 未测 / ✓ | reference / reference / avoid | 见红旗 #4 |
| Lightweight Charts / KLineChart | 5.2.1 / 10.0.4 | Apache-2.0 + 署名要求 / Apache-2.0 | 60 / 58 KB | 17.5k / 4.2k | ✓ | reference | 见红旗 #5 |
| Recharts / Nivo / visx | 3.10.1 / 0.99.0 / 4.0.0 | MIT | — | 27.6k / 14.1k / 21.1k | ✗（React 19 不再提供 UMD） | avoid | 只能用于 React |
| Vizzu | 0.18.0 | Apache-2.0 | 17 KB + wasm | 2.0k | ✗（CORS） | reference | 图型间的动画过渡很漂亮，可作动效参考 |
| Unovis / Taucharts / Frappe Charts | 1.7.1 / 2.8.0 / 1.6.2 | Apache-2.0 / Apache-2.0 / MIT | — / 124 / 17 KB | 2.9k / 1.9k / 15.1k | ✗ ESM-only / ✗ 抛错 / ✓ | avoid | 没有 UMD，或已停更（2020、2021） |

**我们采用了什么、为什么：**
- 采用 **ECharts 6.1.0 full UMD**。50 多个组件需要全量图型，本地磁盘上的解析成本相对字体和图片可以忽略（01 §5.1.3）。
- **默认用 SVG renderer。** `rk.chart.js` 以 `renderer:'svg'` 初始化，打印时 `beforeprint` 会重建全部 block 并关闭动画（`rk.runtime.js`）。
- **图表外框（chrome）放在 HTML 里。** 测试中，画在 canvas 里的标题、图例和 `yAxis.name` 发生了重叠（01 §5.1.4）。这正是 `architecture.md` 规定的 `figure.rk-block` 结构。
- **Python 只输出组件 config 和 dataset，不直接输出 ECharts option。** formatter 函数不能写进 JSON；Excel 格式码由 `RK.format` 编译成函数。
- **think-cell 风格的图都是 custom series 配方，各 20–40 行：**
  - waterfall（含连接线），已在 `waterfall` 组件实现；
  - Marimekko，在 `marimekko` 组件实现；
  - football field，在 `football-field` 组件实现；
  - CAGR 括号，在 `combo` 组件的 `cagr` 选项实现。

**多维编码（R5）：** ECharts 的 `visualMap` 可以把任意维度映射到 color、colorAlpha、lightness、symbolSize、symbol、opacity；6.1 新增的 `seriesTargets` 允许多个 visualMap 同时生效。01 用它测试过一张气泡图，同时编码 x、y、size、colour（行业）和 alpha（ROIC）。kit 的 `bubble` 组件实现了 x、y、面积、颜色四维，另加 `timeField` 时间播放（01 §5.1.8）。

**以后要回头看的：**
1. 把 `@echarts-x/custom-bar-range`、`custom-line-range`、`custom-violin` 加进 vendor，补上 fan chart 和 violin 两个缺口（§3）。
2. 盯住 ECharts 6.2。调研时 dist-tags 只有 `rc: 6.1.0-rc.2`。v6 改了不少默认行为：图例默认在底部、`containShape`、`richInheritPlainLabel`、`tooltip.valueFormatter` 的第二个参数，所以升级必须做截图对比（01 §5.1.9）。
3. 在 Python builder 里用 Node SSR 预渲染静态 SVG，用于 PPT、邮件和缩略图。
4. 规范 locale：headless 环境下 `navigator.language` 可能是 `en-US@posix`，会导致 uPlot、Carbon、LWC 崩溃。kit 格式化器要去掉 `@…` 后缀，Playwright 要显式设置 `locale:'en-US'`（01 §3）。

### 2.2 地图与 Leaflet 生态，含多维编码（02）

**主引擎与替代方案：**

| 库 | 版本（日期） | 许可 | 体积（gz） | Stars | `file://` | Verdict | 理由 |
|---|---|---|---|---|---|---|---|
| **Leaflet 1.9.x** | **1.9.4**（2023-05-18） | BSD-2-Clause | 42.4 KB | 45.7k | ✓ | **adopt（已 vendor）** | 真正的 slippy-map 交互；SVG 打印为矢量；体积小 |
| Leaflet 2.0 | 2.0.0-alpha.1（2025-08-16） | BSD-2-Clause | 39.5 KB（`leaflet-global.js`） | 同上 | 核心 ✓；1.x 插件 ✗ | avoid（暂时） | 一直没有 beta 或 rc；去掉了 factory 方法；V1 polyfill 救得回 heat 和 markercluster，救不回 ant-path |
| **ECharts geo/map** | 6.1.0 | Apache-2.0 | 已含在 ECharts 里 | 67.5k | ✓（全部 geo 功能已验证） | **adopt（第二引擎）** | pie-on-geo、heatmap-on-geo、brush on geo（用于交叉筛选）、d3 投影、map↔bar morph |
| d3-geo + d3-geo-projection | 3.1.1 / 4.0.0 | ISC | 合计 36 KB | 1.1k / 1.2k | ✓ | adopt（工具层，**未 vendor**） | Equal Earth、中国 Albers、太平洋居中视图；`geoProject` 可切开反子午线 |
| Observable Plot | 0.6.17 | ISC | 69 KB（另需 d3） | 5.4k | ✓（反子午线处理正确） | consider | 适合静态印刷地图和地图小多图 |
| deck.gl | 9.4.0 | MIT | 575 KB | 14.7k | ✓（5 种 layer，0 次外连） | consider（可选懒加载） | 适合 1 万到 100 万个点或流；需要 WebGL2；打印为位图 |
| OpenLayers | 10.11.0 | BSD-2-Clause | 298 KB | 12.6k | ✓ | consider | 将来真有 GIS 需求时的后备 |
| MapLibre GL JS | 6.14.0（最后一个 UMD 是 5.24.0） | BSD-3-Clause | v5 275 KB；v6 285 KB + worker 143 KB | 11.9k | v6 ✗；v5 ✓（内存 PMTiles） | avoid（`file://`） | v6 是 ESM-only 且只支持 WebGL2；v5 分支已冻结 |
| AntV L7 | 2.29.1 | MIT | 346 KB | 4.1k | ✓，但有 **1 次外连** | reference | 见红旗 #8 |
| kepler.gl | 3.2.6 | MIT | 10.9 MB raw | 12.0k | 需要 React/Redux | reference | 它是个应用，不是可嵌入组件 |
| Mapbox GL JS | 3.33.0 | 专有 | — | — | — | avoid | 需要 token 和计费 |

**Leaflet 插件（只 vendor 必需的）：**

| 插件 | 版本 · 日期 | 许可 | 体积（gz） | `file://` | Verdict | 备注 |
|---|---|---|---|---|---|---|
| leaflet.markercluster | 1.5.3 · 2021-10 | MIT | 8.7 KB | ✓（需要 maxZoom） | **adopt（已 vendor）** | 用 `iconCreateFunction` 画按类别分段的 SVG 环形聚合点（`cluster-map`） |
| leaflet.heat | 0.2.0 · 2015-10 | BSD-2-Clause | 2.1 KB | ✓（需要 maxZoom） | **adopt（已 vendor）** | 已停更；需要定量图例时优先用 hexbin |
| @asymmetrik/leaflet-d3（hexbin） | 6.0.1 · 2022-02 | MIT | 5.7 KB（另需 d3 92 KB） | ✓ | consider | 定量密度图 |
| Proj4Leaflet + proj4 | 1.0.2 + 2.22.0 | BSD-2 / MIT | proj4 42 KB | ✓ | consider | 在 Leaflet 里做等积投影 |
| Leaflet.Sync | 0.2.4 · 2018-05 | BSD-3-Clause | 2.5 KB | ✓ | consider | 地图小多图 |
| protomaps-leaflet + pmtiles | 5.1.0 + 4.5.0 | BSD-3-Clause | 37.7 KB | ◐（只能用内存中的 Source） | consider | 只在需要街道级底图时用；数据受 ODbL 约束 |
| supercluster | 9.1.0 | ISC | 4.1 KB | ✓ | consider | 超过 5 万个点时用 |
| leaflet-ant-path / Leaflet.Arc | 1.3.0 / 1.0.2 | MIT / ISC | 13.7 / 2.2 KB | ✓ | consider / reference | Arc 的大圆弧会在日期变更线处断开；kit 自研了 Bézier 弧（`RK.geo.arc`） |
| leaflet.minichart / Leaflet.VectorGrid | 0.2.5 / 1.3.0 | **GPL-2.0+ / Beerware** | — | — | **avoid** | 每个地点画饼图改用 ECharts pie-on-geo |

**多维编码手册（02 §8，直接用作组件设计规范）：**

| 通道 | 适合表达 | Leaflet / ECharts 怎么做 | 坑 |
|---|---|---|---|
| 面填充色（choropleth） | 比率、份额、增速 | `style(f)` / `visualMap` | 有面积偏差（俄罗斯视觉上压倒一切）。**不要把总量映射到颜色** |
| 符号面积 | 可加总的量（收入、AUM、交易额） | `circleMarker` 半径取 sqrt（以像素计，**不要用以米计的 `L.circle`**） | 半径线性映射会夸大差异；大圆先画；用嵌套圆图例 |
| 符号颜色 / 形状 | 类别或第二个指标 | palette、`symbol`、svg-shape-markers | 颜色不超过 7 类，形状不超过 4 类 |
| 透明度（value-by-alpha） | 置信度、样本量 | `fillOpacity` / `itemStyle.opacity` | 和重叠互相干扰 |
| 每个地点一个饼 / 环 | 地点上的构成 | ECharts pie on geo | 不超过 4 个切片，大小按总量 |
| 流的线宽 + 颜色 | OD 流量 + 类型 | SVG 二次 Bézier / `lines` | 流太多会成毛线团；超过约 60 条时聚合成 top-N |
| 密度 | 集中程度 | heat / hexbin | 热力只表示相对密度；hexbin 能给出绝对数 |
| 时间 | 演变 | 自定义滑块 + `setStyle` / ECharts `timeline` | 用补间过渡，不要整图重画 |
| Tile-grid cartogram | 每个区域等权；中国地图合规 | ECharts custom 或纯 SVG | 读者要先学会看布局 |

**离线底图阶梯（02 §6.1）：**
- **第 0 级（默认）：** Natural Earth 矢量底图写成 classic JS。
- **第 1 级：** 本地栅格瓦片，以 `<img>` 加载，已验证可用。
- **第 2 级：** 把 PMTiles 以 base64 嵌入 `.js`。
- **第 3 级：** 在线瓦片，**永远不作为默认**。

**中国地图（02 §6.3）：**
- 面向全球受众：NE admin-1 中国 32 个要素，带 `name_zh`、`iso_3166_2`，简化到 5% 后为 25 KB。
- 面向中国境内受众：用经审定的底图，或 tile-grid 方块图（kit 的 `china-tilemap`）。

**我们采用了什么：**
- 5 个 Leaflet 组件：`choropleth`、`bubble-map`、`flow-map`、`cluster-map`、`geo-heat`。
- 1 个 ECharts 组件 `china-tilemap`：34 个省级行政区（含台湾、香港、澳门）的等大方块 / 六边形 tile-grid，不画边界线。布局是自研的（按省份质心经纬度排布，压缩到 7 × 8），并与 geofacet 的 `china_prov_grid1`（MIT）交叉核对过。
- 不用瓦片，用 world-atlas 2.0.2 的 110m 底图。
- `RK.geo` 加载时自研切开反子午线（不依赖 d3），已消除俄罗斯、斐济、南极洲的条纹。
- 滚轮规则：普通滚轮滚动报告，Ctrl/Cmd + 滚轮才缩放地图，与 02 建议的 gesture handling 一致。
- 弧线是自研的二次 Bézier，带箭头。
- 气泡用 sqrt 面积，大的先画。

**以后要回头看的：**
1. 底图升级到 **NE 5.1.2 10m @1% keep-shapes**：
   - 补回新加坡、香港、澳门、巴林、马耳他、开曼、百慕大；
   - 按 `ISO_A3_EH` 或 `ADM0_A3` join，因为 `ISO_A3` 对法国和挪威是 `-99`；
   - 另出一份中国视角（CHN-POV）的 worldview；
   - 附一张标注点表。
2. 用 ECharts geo 新增组件：`pie-map`、`map-bar-morph`、`china-map`（需要 d3-geo）、`tile-grid-map`。中国版 tile-grid 已由 `china-tilemap` 实现，世界区域和美国州版本还没有。
3. 增加 hexbin 密度图。
4. 把 deck.gl 做成可选的懒加载大数据引擎。
5. 底图 manifest 增加合规元数据：`worldview`、`licence`、`prc_reviewed`、`审图号`。
6. 为 Leaflet 2.0 做准备。现在 `rk.geo.js` 和 5 个地图组件用的是 factory 写法（`L.map`、`L.circleMarker`），可以先在 1.9.4 上改成构造函数（1.9 两种都支持），等 2.0 稳定后再评估换成 `leaflet-global.js` + polyfill。

### 2.3 表格、网格与透视表（03）

| 库 | 版本 | 许可 | 体积（gz） | Stars | `file://` | Verdict | 理由 |
|---|---|---|---|---|---|---|---|
| **自研 DOM 表格**（comps、sensitivity、league、pivot） | — | 内部 | 估计 5–15 KB | — | ✓ | **adopt（已构建）** | 投行表格小、静态、排版要求严，库都会在细节上和你较劲；DOM 表格打印为矢量、表头每页重复、能粘贴进 Excel |
| **Tabulator** | **6.6.1** | MIT | ~103 KB | ~7.8k | ✓ | **adopt（已 vendor）** | 一列只能有一个 top calc 和一个 bottom calc；内置 calc 返回字符串；XLSX 无样式；打印要用 `printAsHtml` |
| AG Grid Community | 36.2.0 | MIT | ~522 KB | ~15.6k | ✓ | consider | 多行 `pinnedBottomRowData` 很适合放统计行；但分组、聚合、Excel 导出都是 Enterprise 功能 |
| AG Grid Enterprise | 36.2.0 | 商业（$999/dev） | — | — | 需要 key，否则有水印 | reference | 见红旗 #3 |
| AntV S2 | 2.7.2 | MIT | ~310 KB（06 测得 ~302 KB） | ~1.7k | ✓（默认中文，需 `S2.setLang('en_US')`） | adopt / consider（懒加载，**未 vendor**） | 开源里最好的交叉表：总计、小计、树形、条件格式、迷你图 |
| VisActor VTable | 1.26.8 | MIT | ~544 KB（06 测得 ~531 KB）+ 插件 ~358 KB | ~3.7k | ✓（容器尺寸必须是整数） | consider | 功能最全，有入场动画；但最重，而且是 canvas |
| Perspective（`@perspective-dev`） | 5.6.0 | Apache-2.0 | viewer ~25 KB + 1.6 MB WASM | ~11.3k | ✗（ESM + WASM） | reference → Step 2 served mode | ExprTK 表达式列很适合"客户自己写公式"的场景 |
| DataTables | 3.1.4 | MIT | ~42 KB | ~7.4k | ✓（v3 起不再依赖 jQuery） | consider | 可以给 Python 渲染的静态表做渐进增强 |
| SlickGrid（6pac） | 5.20.2 | MIT | ~90 KB | ~2.1k | ✓（必须先加载 SortableJS） | consider | 精简快速，但 API 和外观偏老 |
| TanStack Table | 9.3.1 | MIT | — | ~28.5k | ✗（v9 ESM-only） | reference | 状态模型的架构参考 |
| Grid.js / Glide / RevoGrid | 6.2.0 / 6.0.3 / 4.28.3 | MIT（RevoGrid Pro 为商业） | — | — | ✓ / ✗ / ✗ | avoid | 停更 / 只能用于 React / Stencil ESM 且关键功能在 Pro 版 |
| Handsontable / HyperFormula | 18.1.2 / 3.5.0 | 专有 / **GPL-3.0** | — | ~22k / ~2.8k | — | reference / avoid | 见红旗 #12 |
| PivotTable.js / WebDataRocks / Flexmonster | 2.23.0 / 1.4.9 / 2.9.140 | MIT（需 jQuery）/ EULA / 商业 | — | — | — | avoid / avoid / reference | 2018 年停更；数据上限约 1 MB；商业许可 |
| **write-excel-file** | 4.1.1 | MIT | ~19 KB | — | ✓（v4 API 是 `.toBlob()`） | adopt（**未 vendor**） | 带样式的 XLSX：`0.0"x"` 格式、括号负数、填充、冻结窗格 |
| SheetJS CE | 0.20.3（仅在 cdn.sheetjs.com） | Apache-2.0 | 86–334 KB | ~36k | ✓ | consider | 读取客户的文件；见红旗 #6 |
| ExcelJS / jsPDF + AutoTable | 4.4.0 / 4.2.1 + 5.0.8 | MIT | ~256 / ~132+10 KB | ~15.5k / ~31k | ✓ | consider | 只在必须用 Excel 条件格式，或必须有"下载 PDF"按钮时使用 |
| Formula.js | 4.6.1 | MIT | ~45 KB | ~0.8k | ✓（CSP 安全） | adopt / consider | 给 `RK.expr` 补充 Excel 财务函数（IRR、XNPV、PMT） |

**我们采用了什么：**
- 三层分工中的前两层已经落地。
  - **版式表**：`comps-table` 支持多级表头、分节、均值 / 中位数 / 最高 / 最低统计行、目标公司高亮；`sensitivity-table` 以 base case 为中点着发散色；`league-table`；`pivot-table` 是轻量透视表，用 kit 自研实现代替 S2。
  - **交互表**：`data-grid`（Tabulator 6）。
- 导出：CSV 和 PNG 已内置在 block 工具栏里。

**排版规范：** 03 §7 和 04 §7 给出了 IB 表格的排版规范：
- phantom ')' 让小数点对齐；
- `NM`、`NA`、`–` 三者区分清楚；
- 统计行排除目标公司和 n.m. 值；
- 不画竖向网格线；
- 用 `border-collapse:separate` 配合 sticky；
- 热力色加 `print-color-adjust:exact`。

**以后要回头看的：**
1. 用 write-excel-file 做带样式的 XLSX 导出。
2. 读取客户的 xlsx：SheetJS CE 0.20.3，`vendor.py` 需要支持 URL 来源。
3. 重度透视需求出现时，原型对比 S2 和 VTable，按页懒加载。
4. 定义声明式 `TableSpec`，供 LLM 安全编辑（03 §8）。
5. Perspective 留给 Step 2 的 served mode。

### 2.4 Pitchbook 设计规范（04）

**一手证据**：SEC EDGAR 上的 Schedule 13E-3 附件 EX-99.(c)，例如：
- GS "Project Jewel"：<https://www.sec.gov/Archives/edgar/data/1274173/000110465926008735/tm2534023d8_ex99-civ.htm>
- Morgan Stanley（Avangrid）：<https://www.sec.gov/Archives/edgar/data/1634997/000119312524165806/d842696dex99c10.htm>
- Evercore "Project Everest"：<https://www.sec.gov/Archives/edgar/data/1863105/000119312523280779/d306045dex99cix.htm>
- Rothschild & Co "Project Kona"：<https://www.sec.gov/Archives/edgar/data/1855457/000114036126014631/ny20068726x2_excii.htm>

**可以直接用作产品规范的惯例：**

| 主题 | 惯例（来自实证） | kit 现状 |
|---|---|---|
| 页面 | US Letter 横向 11 × 8.5 in（宽高比 1.294）；Rothschild 为 4:3；没有一家用 16:9 | 默认 16:9；Letter / A4 横向已作为报告级选项提供（`page_size`） |
| 页面解剖 | section tracker → 一句话 action title → 单位行 "($ in millions, except per share data)" → navy 横幅式图表标题 → 图 / 表加评论侧栏 → 编号脚注 → "Source:" 行（含数据截至日期）→ 机密 / 草稿章 → 页码 | `rk-page__kicker / title / subtitle / foot（source / conf / num）` 已有 |
| 配色 | navy 主色 + steel-blue 对比色 + 灰 + 1 个点缀色；标的公司用强调色表示，**不给每家公司一种颜色**；offer / current price 用红色或 claret 虚线 | 4 套主题：navy / bronze / slate，外加 ink（深色演示模式，打印时强制恢复纸面样式） |
| 数字格式 | 各家 house style 不同：GS 写 `$ 44.71`、`7.6 x`、`(0.9)%`，其他家写 `$2.27`、`7.9x`、`(32%)`。负数一律加括号；n.m. 不进均值和中位数；n.a. 和 – 要区分；只有首行和合计行带单位 | `RK.format` 支持格式码；**house-style 预设和 `unitOn` 尚未实现** |
| think-cell 装饰层 | CAGR 箭头、差值箭头、value line、合计标签、axis break、"Other" 归并、自动黑白标签对比、TCROUND（取整后各部分之和等于总计） | `combo` 有 CAGR 括号；`bar` 有 `showTotal` 和 `refLines`；`waffle` 用 largest remainder 取整。**差值箭头和全局 `roundToTotal` 还没有** |
| 事件标注 | 三种风格：GS 是带引线、按类别着色的 callout 框；MS 是字母徽标加事件表；Rothschild 是竖向引线加粗体日期 | `price-volume` / `line` 有带编号的事件标注 |
| 双轴 | IB 习惯用双 y 轴，但 dataviz 最佳实践反对 | 默认改为上下堆叠的 pane，共享 x 轴并联动 dataZoom |
| 字体 | 大投行几乎全用 sans（类 Arial）；精品投行用 serif 大标题加 sans 正文。开源替代有 Arimo / Tinos（与 Arial / Times 度量兼容）、Source Serif 4、Inter、IBM Plex | 已 vendor Inter 和 Source Serif 4；Arimo **未 vendor** |

**P0 组件清单（04 §8 的 12 项）对照 kit：**

| P0 组件 | kit 组件 | 状态 |
|---|---|---|
| Football field | `football-field` | ✓（直接用 ECharts 实现，没用 @echarts-x/custom-bar-range） |
| 股价 + 成交量 + 事件 | `price-volume`（另有 `candlestick`） | ✓（三种事件风格中只实现了编号标注） |
| Indexed performance（以 100 为基） | `line`（`rebase` 选项） | ✓ |
| Comps 表 | `comps-table` | ✓ |
| Precedents 表 | `comps-table`（包含 premium 列组） | ✓ |
| Sensitivity grid | `sensitivity-table` | ✓ |
| Waterfall / bridge | `waterfall` | ✓ |
| Analysis at Various Prices（AVP） | — | ✗ **缺失** |
| Premiums paid | `beeswarm` / `boxplot`（能画溢价分布和 offer 参考线） | ◐（没有分位数柱和隐含价 chips） |
| 历史估值倍数 + "% of time in range" | `multiple-history`（±1σ / ±2σ 带） | ◐（缺 "% of time in range" 分桶表） |
| 财务摘要表 | `pivot-table`（有 CAGR 列） | ◐（缺 A/E 列分隔、growth / margin 行样式） |
| think-cell 式柱图 | `bar`、`combo` | ◐（缺差值箭头和全局取整一致性） |

结果：7 项完整，4 项部分，1 项缺失。

**相关库（04 §12）：**

| 库 | 版本 | 许可 | Verdict | 说明 |
|---|---|---|---|---|
| @echarts-x/custom-bar-range | 1.2.1 | Apache-2.0 | adopt（未 vendor） | 1.8 KB，自动注册，可直接画 football field |
| simple-statistics | 7.12.1 | ISC | adopt（未 vendor） | ~9 KB gz；回归、分位数（kit 目前自研） |
| frappe-gantt / vis-timeline | 1.2.2 / 8.5.4 | MIT / Apache-2.0 或 MIT | consider / reference | 印刷版时间表更适合 CSS grid 或 ECharts；kit 的 `gantt` 用 ECharts 实现 |
| d3-svg-annotation | 2.5.1 | Apache-2.0 | reference | 2019 年起无人维护，只借 callout 的设计 |
| Noto Sans SC | 5.3.1 | OFL-1.1 | adopt（**builder 子集化尚未实现**） | 单个字重约 3.4 MB，必须按报告内容子集化 |

**以后要回头看的：**
1. ~~页面尺寸增加 Letter 和 A4 选项~~：已实现（`Report(page_size="letter" | "a4")`）。
2. `RK.format` 支持 house-style 预设：`currencySpace`、`multSpace`、`pctParen`、`unitOn`。
3. 把装饰插件化：差值箭头、callout、字母事件标注、全局 `roundToTotal`。
4. 新增 AVP 表（✅ `avp-table`）、premiums-paid 组件、financial-summary 表。
5. `multiple-history` 增加 "% of time in range" 分桶表。
6. 不复制任何银行的 logo 或精确品牌色（04 §13.14）。

### 2.5 动效、UI 控件、图标与字体（05）

**动效库（05 §2.1）：**

| 库 | 版本 | 许可 | 体积（gz） | Stars | `file://` | Verdict | 理由 |
|---|---|---|---|---|---|---|---|
| **原生**：CSS transition、WAAPI、IntersectionObserver、View Transitions | View Transitions 于 2025-10 进入 Baseline | 浏览器内置 | 0 | — | ✓（`startViewTransition` 实测可用） | **adopt（`RK.motion`）** | 零依赖；Pudding 的 Scrolly 组件只是约 80 行 IntersectionObserver 代码 |
| GSAP（+ScrollTrigger） | 3.15.0 | 非 OSI | 28.3 KB / 45.6 KB | 28.9k | ✓ | **avoid** | 见红旗 #2 |
| Motion（motion.dev） | 14.2.0 | MIT | 完整版 51.3 KB；`motion/mini` IIFE 4.4 KB | 34.1k | ✓ | consider | 将来需要 spring 或复杂时间线时用，**必须固定精确版本**（主版本更迭快） |
| anime.js | 4.5.0 | MIT | 40.6 KB（子集 17.0 KB） | 73.4k | ✓ | consider | 4.4.0 引入过破坏性变更 |
| CountUp.js / NumberFlow | 2.10.1 / 0.6.2 | MIT | 2.3 / 5.2 KB（IIFE） | 8.2k / 7.7k | ✓ / 需要预打包 | reference / consider | kit 自带 count-up，并且和 `RK.format` 保持一致 |
| Scrollama | 3.2.0 | MIT | 2.1 KB | 6.0k | ✓ | consider | 自研 60–80 行代码即可替代 |
| Lenis / AOS / lottie-web | 1.3.26 / 2.3.4 / 5.13.0 | MIT | 5.4 / 4.7 / 46.4 KB | — | ✓（lottie 只能用 `animationData`） | avoid | Lenis 劫持滚动，和图表缩放冲突；AOS 2018 年起停更；Lottie 价值低 |

**控件、图标、字体：**

| 库 | 版本 | 许可 | 体积（gz） | Verdict | 现状 / 说明 |
|---|---|---|---|---|---|
| Tom Select | 2.6.2 | Apache-2.0 | 17.6 KB | adopt | **未 vendor**；`filter-bar` 用自研的多选下拉 |
| noUiSlider | 15.8.1 | MIT | 9.4 KB | adopt | **未 vendor**；`filter-bar` 自研了双滑块区间，`param-slider` 自研了参数滑块 |
| Floating UI | 1.8.0 | MIT | 8.4 KB（core + dom） | adopt | **未 vendor**；CSS anchor positioning 于 2026-01 进入 Baseline，可作渐进增强 |
| Air Datepicker | 3.6.0 | MIT | 13.6 KB | consider | 金融场景优先用期间预设（MTD/QTD/YTD/1Y）加原生 `<input type=date/month>` |
| flatpickr / Tippy / Shoelace / Pico / Web Awesome | 4.6.13 / 6.3.7 / 2.20.1 / 2.1.1 / 3.14.0 | MIT | — | avoid / reference | 2022 年起不再发版 / 2024-11 归档 / 已归档 / 2026-10-04 归档 / ESM-only |
| Lucide（主）+ Tabler Icons（补） | 1.57.0 / 3.49.0 | ISC / MIT | 按用到的图标内联 | adopt | **未 vendor**；kit runtime 内联了少量自绘 SVG。外链 sprite 在 `file://` 下被拦，**builder 必须把用到的图标内联成 `<symbol>`** |
| Inter（Fontsource） | 5.3.0 | OFL-1.1 | — | **adopt（已 vendor）** | 只保留 `tnum`、`pnum`、`frac`，去掉了 `zero`、`case`、ss/cv。上游 inter-ui 4.1.1 的 variable latin（约 100 KB）保留全部特性 |
| Source Serif 4 | 5.3.1 | OFL-1.1（RFN "Source"） | — | **adopt（已 vendor）** | 要附上游的 OFL 文本，因为 Fontsource 的 LICENSE 只写了 "Google Inc." |
| Noto Sans SC | 5.3.1 | OFL-1.1（无 RFN） | 全部分片 4.5 MB；按报告子集化通常 < 200 KB | adopt（待做） | builder 用 `pyftsubset` 把字体裁到报告实际用到的字 |
| IBM Plex / JetBrains Mono | 5.3.0 | OFL-1.1（Plex 的 RFN 是 "Plex"） | — | consider | 只给公式编辑器用的等宽字体 |

**专业动效规则（05 §3）：**
- UI 动效 100–500 ms（[NN/g](https://www.nngroup.com/articles/animation-duration/)）。
- 图表入场 400–700 ms，元素间 stagger 30–60 ms，总时长不超过 900 ms。
- 数据更新时从旧值补间到新值。
- 复杂变化分阶段过渡（[Heer & Robertson 2007](https://idl.uw.edu/papers/animated-transitions)）。
- **禁止：** parallax、弹跳 / 弹性、劫持滚动、关键数字随滚动变化、打字机效果、循环动画。

**我们采用了什么：** 05 §3.6 指出 `rk.motion.js` 有 5 个缺口，现在都已处理，只剩缺口 2 里的 `?motion=off` URL 参数没做：
- `beforeprint` 时挂载全部懒加载 block 并关闭动画（`rk.runtime.js` 的 `renderAllNow()`）；
- 实时监听 `prefers-reduced-motion`；
- `RK.motion.swap()` 封装 View Transitions；
- count-up 写入 `aria-label`，支持从旧值补间到新值（`from`，`kpi-tiles`、`text-block`、`league-table` 已使用）；
- `document.hidden` 时跳过动画。

**以后要回头看的：**
1. 增加 `?motion=off` URL 参数，供截图和审阅使用。
2. builder 按需内联图标 sprite（Lucide + Tabler）。
3. 中文报告的 Noto Sans SC 子集化。
4. 只有在自研控件不够用时，才引入 Tom Select / noUiSlider / Floating UI。
5. 在 `vendor.py` 里增加 "esbuild → IIFE" 构建类型，用于 Motion mini 和 NumberFlow。

### 2.6 中国开源生态与小红书推荐（06）

**能访问和不能访问的（06 §1）：**

| 来源 | 访问结果 | 用法 |
|---|---|---|
| **小红书** xiaohongshu.com | **无法抓取。** 搜索需要登录和签名的 `x-s` 头；SSR 页面只有 60 KB 的空壳；edith API 不带签名返回 404；`site:xiaohongshu.com` 在可用搜索引擎里 0 结果 | **没有直接数据。** "小红书推荐什么"只能从下面的二手来源三角推断 |
| 知乎 | WebFetch 返回 HTTP 403 | 只用了搜索摘要里的标题 |
| CSDN | 正文被 JS cookie 校验拦截（HTTP 521）；搜索 API 可用 | 只用标题、日期、阅读数，作为**趋势信号** |
| 掘金 Juejin | 搜索 API 可用；文章页有 ByteDance WAF 的 proof-of-work，低频解开了约 12 篇 | 主要的中文从业者来源 |
| 微信公众号 | 搜狗 `weixin.sogou.com` 可用，只有标题和摘要 | 信号来源（例如由此发现了 AntV 投毒事件） |
| npm / jsDelivr / unpkg / shields.io / 官方文档 | 可用 | 硬事实 |

可信度提示：2025–26 年的很多 CSDN 帖子是 AI 生成的 SEO 内容，部分掘金文章是带错误事实的营销文。例如 [juejin.cn/post/7476295800785993728](https://juejin.cn/post/7476295800785993728) 声称 ECharts 没有 3D，还展示了一个不存在的 API。这类内容只当热度信号。

**中国生态库（06 §3，2026-10-14 核实）：**

| 库 | 版本 | 许可 | 体积（gz） | Stars | `file://` / 外连 | Verdict | 理由 |
|---|---|---|---|---|---|---|---|
| Apache ECharts | 6.1.0 | Apache-2.0 | 359 KB | 67.5k | ✓，无外连 | **adopt（已 vendor）** | 中国生态的事实标准：大屏模板、低代码 BI、pyecharts 2.1 都基于它 |
| @echarts-x/*（bar-range、line-range、violin、contour、word-cloud、liquid-fill） | 1.2.1 / 1.1.1 / 1.1.1 / 1.2.1 / 1.0.1 / 1.0.2 | Apache-2.0 | 各 1.8–14.7 KB（min） | 74 | ✓ | adopt（未 vendor） | 取代停更的 ecomfe 插件（那些插件仍只声明支持 echarts ^5） |
| pyecharts | 2.1.0 | MIT | — | 16k | 默认从 CDN `assets.pyecharts.org` 加载 | reference | 把 option、数据和 HTML 混在一起，破坏了我们的分离原则 |
| AntV S2 / VTable | 2.7.2 / 1.26.8 | MIT | 302 / 531 KB | 1.7k / 3.7k | ✓，无外连 | consider（懒加载） | 唯一一块中国库能补上 kit 缺的能力：带小计的透视表 |
| AntV T8（叙事文本） | 0.3.1 | MIT | 18 KB | 54 | ✓，无外连 | consider | `[12.3%](delta_value, assessment=positive)` 这种行内实体语法很适合评论框 |
| AntV G2 / G6 / X6 / G2Plot | 5.4.8 / 5.1.1 / 3.1.8 / 2.4.35 | MIT | 320 / 380 / 162 KB / — | 12.6k / 12.3k / 6.7k / 2.7k | ✓ | reference / avoid | 与 ECharts 重复，且命名空间曾被投毒 |
| AntV L7 / Infographic | 2.29.1 / 0.2.20 | MIT | 337 / 281 KB | 4.1k / 7.0k | **有外连**（alipayobjects.com；weavefox.cn 和普惠体字体） | avoid / reference | 离线不可用 |
| AntV GPT-Vis / mcp-server-chart | 1.0.2 / 0.9.10 | MIT | 649 KB / — | 0.8k / 4.4k | GPT-Vis ✓；MCP 走云端渲染 | reference | 借鉴 DSL 和流式容错设计；**数据会离开本机** |
| VisActor VChart / VSeed / VMind | 2.1.7 / 0.7.0 / 2.0.10 | MIT | 617 / 203 / 521 KB | 1.8k / 33 / 471 | ✓ / ✓ / ◐（需要 Node 全局对象） | reference / reference / avoid | VSeed 的 dimensions/measures 结构是 spec 层的范本。VMind 已停止维护（仓库改名为 [VisActor/skills](https://github.com/VisActor/skills)） |
| DataV / 大屏模板 / DataEase | 2.10.0 / — / — | MIT / 无许可 / GPL-3.0 | — | 9.7k / 5.3k–5.7k / 25k | — | avoid | 霓虹风格、知识产权风险、copyleft |
| LIDA / AVA | 0.0.14 / 3.4.1（4.0.0-beta.1） | MIT | — / 102 KB | 3.3k / 1.6k | — | reference | LIDA 会执行生成的代码；AVA v4 已转向服务端 |
| tw93/Kami | — | MIT（字体另计） | — | 12k | — | reference | 纸面底色 `#f5f4ed` 加单一墨蓝 `#1B365D`，"不用渐变、阴影、3D"，和印刷级 IB 风格一致 |

**风格判断（06 §11）：**
- **不适合 IB：** 深色大屏背景、霓虹配色（`#00f5d4 #00bbf9 #9b5de5 #f15bb5`）、发光、毛玻璃、DataV 科技边框、3D、飞线、水球图、词云、1920 × 1080 等比缩放、自动滚动的表格。
- **值得借鉴：** 克制的单次 KPI count-up（不超过 600 ms）、跨图联动高亮、自上而下的叙事布局、markLine / markArea / markPoint 标注体系、主题 token 纪律。
- **配色参考：**
  - [VChart veODesignLightFinance](https://unpkg.com/@visactor/vchart-theme@1.13.1/public/veODesignLightFinance.json)：`#294C60` navy、`#E2B890` tan、`#9D0800` oxblood。
  - [飞书数据可视化设计指南](https://open.feishu.cn/document/design-specification/data-visualization/data-visualization-design-guide?lang=zh-CN)的规则可以做成 lint：折线不超过 5 条、饼图少于 9 类、只有单位不同时才用双轴。

**社区信号（06 §10）：**
- 2025–26 年的热点是 MCP 图表服务、Agent Skills（"AI Skills：前端新的效率神器"，7.3 万阅读）、Infographic、"AI 问数"。
- 社区里的"高级感"通常意味着深色 + 渐变 + 发光，正好与 IB 风格相反。
- AI 出图的共识可以概括为一句话："AI 只做填空题"：LLM 只填一个最小的、经 schema 校验的意图 spec，样式由确定性的编译器负责（[零幻觉交付](https://juejin.cn/post/7603581886148935734)）。

**我们采用了什么：**
- 只用 ECharts，不引入任何 AntV 或 VisActor 运行时依赖。
- `candlestick` 的涨跌色取主题的 `--pos`/`--neg`（西式），不用 ECharts 默认的红涨绿跌（`#eb5454` / `#47b262`）；中国客户用 `Report(updown="cn")` 对调。
- `china-tilemap`：中国省级 tile-grid 方块图，作为中国地图的合规替代方案（见 `research/china-ecosystem.md` §9.3）。

**以后要回头看的：**
1. ~~增加 `convention: 'western' | 'cn'` token~~：已实现为 `<html data-rk-updown="cn">`（builder `Report(updown="cn")`），运行时对调 `--rk-pos` / `--rk-neg`，K 线、瀑布图、涨跌颜色随之切换。
2. ~~支持中文 万 / 亿 紧凑格式~~：已实现，`locale="zh-CN"` 时 `RK.format` 的 `auto` 用 亿 / 万（自研，不依赖 `Intl` compact）；运行时界面文字也有 zh-CN 包（`RK.i18n`）。
3. text-block 支持 T8 风格的行内实体（vendor T8 0.3.1，或自研约 150 行）。
4. 给 S2 / VTable 做透视原型时，只用投毒清理后的版本，并核对哈希。

### 2.7 已经打包好的大仓库：合集与画廊（07）

| 合集 | 许可 | 最近提交 | Stars | 规模 | Verdict | 我们借什么 |
|---|---|---|---|---|---|---|
| [hal9ai/awesome-dataviz](https://github.com/hal9ai/awesome-dataviz)（原 fasouto、javierluraschi） | CC BY 4.0 | 2026-10-13 | 4.4k | 约 420 条 / 24 节；JS 部分约 133 条（含 Financial charts 9 条） | **adopt** | 候选库目录的种子；复用文字需要署名 |
| [FT Visual Vocabulary](https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary)（+ ft-interactive/visual-vocabulary） | MIT（仅软件；FT 内容和品牌保留版权） | 2024-03 / 2021-08 | 3.4k / 350 | **9 类、72 种图型**，有机读的 `chartTypes.csv` | **adopt** | **gallery 主导航分类法**（§3）。CSV 用的是老 Mac 的 CR 换行，要用 Python csv 模块解析 |
| [data-to-viz.com](https://www.data-to-viz.com) | MIT（仓库） | 2024-10 | 1.1k | 6 个数据形态根节点、约 39 种图、12 条注意事项 | **adopt** | 第二筛选维度："你手上是什么形状的数据" |
| [Apache ECharts examples](https://github.com/apache/echarts-examples) | Apache-2.0 | 2026-09-24 | 400 | 377 个 2D + 59 个 GL 示例；有 `since` 标签 | **adopt** | 按组件给出可合法复用的参考实现；28 个示例要求 6.0.0 |
| [Leaflet Plugins DB](https://github.com/Leaflet/Leaflet/tree/main/docs/_plugins) | BSD-2（各插件许可各自不同） | 2026-09-19 | 46k | 578 个插件 / 36 类 | **adopt** | 568 个标为兼容 v1，**0 个标为兼容 v2**，所以锁定 1.9.4 |
| [chartjs/awesome](https://github.com/chartjs/awesome) | MIT | 2026-03-23 | 2.7k | 75 行 | adopt（Chart.js 方向） | 徽章已过时（financial 0.2.1 实际支持 chart.js ^4），一律用 `npm view` 复核 |
| Vega-Lite examples / Plotly.js gallery | BSD-3 / MIT | 2026-10 | 5.5k / 18k | 203 例 / 12 节 | consider / reference | 刷选、联动、标注层的语法级参考 |
| D3 Graph Gallery / Observable D3 gallery | MIT / 各 notebook 不同 | 2026-08 / — | 855 / — | 165 个 HTML / 147 条 | reference | 代码基于 d3 v4/v6，需要移植到 7.9 |
| Data Viz Catalogue / Datavizproject | **有版权、无许可** | — | — | 60 种 / 166 种 | reference | 只用来查漏：Kagi、Point & Figure、Span、Fan 等金融图型 |
| shadcn/ui charts / Tremor Raw | MIT / Apache-2.0 | 2026-10 / 2025-10 | 126k / 3.7k | 70 个 block / 约 35 个组件 | reference | 都是 React。借 KPI 原语（BarList、CategoryBar、Tracker、SparkChart）和 tooltip 的打磨 |
| Tabler / AdminLTE 4 | MIT | 2026-10 | 42k / 46k | 139 页 / Bootstrap 5.3.8 | consider | AdminLTE 4.10 的依赖许可干净（Chart.js 4.5.1、jsvectormap、Tabulator 6.6.1）；Tabler 要先剥掉 ApexCharts |
| awesome-d3 / awesome-echarts / awesome-charting | CC0 / CC0 / MIT | 2023-01 / 2025-01 / 2021-02 | 5.3k / 1.6k / 2.1k | — | reference / avoid | 已停更；makeapie.com 已失效 |
| [AntV chart-visualization-skills](https://github.com/antvis/chart-visualization-skills) | MIT | 2026-09-22 | 508 | 9 个 `SKILL.md` | reference | Step 2 技能打包格式的参考。⚠ `chart-visualization` 会把数据 curl 到 AntV 云端 |

**2025–26 年的新秀（07 §7）：**
- [Microsoft Flint](https://github.com/microsoft/flint-chart) 0.5.1（MIT，ESM）：一份 spec 编译到 Vega-Lite、ECharts、Chart.js、Plotly 和**可编辑的 Excel 图表**，并带 MCP server。它的通道词汇适合作为 Step 2 spec 的模板。
- Vela 0.8.4（Apache-2.0，IIFE 约 1 MB）：可作为 TradingView 的替代，持续观察。
- ChartGPU 0.4.0（WebGPU，解包 135 MB）：avoid。

**我们采用了什么：**
- `kit/categories.json` 的 12 个类别是按 FT Visual Vocabulary 再加上投行特有类别设计的。
- 组件实现参考了 ECharts 示例。
- Leaflet 锁定在 1.9.4。

**以后要回头看的：**
1. 把 kit 的 catalog 和 FT 类别、data-to-viz 数据形态、ECharts 示例 id 自动关联（07 §10 R1/R2）。这份目录同时也是 Step 2 LLM 读取的工具清单。
2. 每月重新扫描一次（成本很低）：
   - diff awesome-dataviz 的 Financial、Maps、Misc 三节；
   - 统计 Leaflet 插件的 `compatible-v2` 数量；
   - 看 ECharts `chart-list-data.js` 的 `since` 字段；
   - 复核 chartjs/awesome 的 peerDependencies。

### 2.8 浏览器内查询与 AI 引擎（08）

**公式引擎：**

| 引擎 | 版本 | 许可 | 体积（gz） | 严格 CSP | 100k 行求值 | Verdict | 理由 |
|---|---|---|---|---|---|---|---|
| **`RK.expr`（自研）** | — | 内部 | — | ✓ | **14 ms** | **adopt（已构建）** | 有 `20%` 字面量、`@param`、`` `EV/EBITDA 2025E` `` 引号名、聚合函数，以及 n.m. / n.a. 语义 |
| Formula.js | 4.6.1 | MIT | 45 KB | ✓ | — | adopt（未 vendor） | 通过函数注册表接入：IRR、XNPV、PMT 已验证 |
| math.js | 15.2.0 | Apache-2.0 | 175 KB | ✓ | ~70 ms | reference | 能力过剩（矩阵、单位） |
| expr-eval-fork / jsep | 3.0.3 / 1.6.0 | MIT | 8 / 3.5 KB | ✓ | expr-eval-fork 在 45–72 ms 区间内（与 math.js、filtrex 同组）；jsep 只是解析器 | consider / reference | 没有 IB 专用语法 |
| expr-eval | 2.0.2 | MIT | 8 KB | — | — | **avoid** | CVE-2025-12735，RCE，CVSS 9.8 |
| filtrex | 3.1.0 | MIT | 12 KB | ✗（`new Function`） | 在 45–72 ms 区间内 | avoid | 用了 `new Function`，严格 CSP 下失效 |

**查询 / SQL 引擎（统一基准：40 组 group-by；08 §5.1）：**

| 引擎 | 版本 | 许可 | 体积 | `file://` | 10k / 100k / 1M 行 | Verdict |
|---|---|---|---|---|---|---|
| **`RK.query`（自研）** | — | 内部 | — | ✓ | 17 ms / 45 ms / 691 ms | **adopt（已构建；`query-console` 组件）** |
| DuckDB-WASM | 1.32.0 stable（npm 的 `latest` 是 dev 版） | MIT | eh.wasm 34.2 MB raw / 7.6 MB gz；落盘约 46 MB | ◐（三招配方，见下） | — / 140+68 ms / 1200+**111 ms**（启动 2.2–4 s） | adopt 作为可选 power-pack（**09 视其为不应进默认运行时的依赖**） |
| sql.js | 1.14.2 | MIT | 约 0.9 MB（base64） | ✓（传 `wasmBinary`） | 102+66 / 253+214 / 2353+3280 ms | consider（≤100k 行） |
| AlaSQL | 4.20.0 | MIT | 111 KB | ✓ | 28–40 / 97–185 / 101–148 ms | **avoid**（可执行任意 JS，严格 CSP 下失效） |
| Arquero | 8.0.3 | BSD-3-Clause | 74 KB | ✓（CSP ✗） | 1M 行时转换就要 272–718 ms | consider |
| crossfilter2 / Mosaic | 1.5.4 / 0.33.0 | Apache-2.0 / BSD-3 | 6 KB / 只有源码 | ✓ / ✗ | 不比手写 JS 循环快 / 需要 DuckDB | reference（交叉筛选架构参考） |
| Perspective / PRQL / danfo.js | 5.6.0 / 0.13.14 / 1.2.0 | Apache-2.0 / Apache-2.0 / MIT | MB 级 WASM / 5.5 MB wasm / 6.8 MB（含 TF.js） | ✗ / ✗ / — | — | reference / avoid / avoid |

**DuckDB-WASM 的 `file://` 离线配方（08 §0.4，已验证）：**
1. ESM 主模块以字符串形式内嵌，用 `import(blobURL)` 加载；其中的 `apache-arrow` 裸导入改写为 Arrow 17 的 UMD 全局对象。
2. worker 源码同样以字符串内嵌，用 `new Worker(blobURL)` 启动。
3. wasm 以 base64 放进 classic script，再通过 `data:` URL 实例化。不能用 blob URL：从 `file://` 启动的 worker 无法 fetch 页面的 blob URL。
4. 加固：`SET enable_external_access=false; SET lock_configuration=true`，再用 `json_serialize_sql` 拦截所有非 SELECT 语句。

**本地 LLM（Step 2）的事实（08 §8）：**

| 主题 | 事实 | 结论 |
|---|---|---|
| 页面 origin | `file://` 页面发出的请求带 `Origin: null`，且有 CORS 预检 | 直连本地 LLM 取决于服务端的 CORS 配置 |
| [Ollama](https://github.com/ollama/ollama/blob/main/envconfig/config.go)（MIT，183k★） | 默认允许列表里的 `file://*` 匹配不到 `null`；`OLLAMA_ORIGINS=null` 会在启动时 panic；只有 `*` 或 `null*` 可用（**来自阅读源码，未对真实进程实测**） | 允许 `null` 基本等于允许任何网站驱动本地模型（可以经沙箱 iframe），包括 `/api/pull` 和 `/api/delete` |
| vLLM / llama.cpp / LM Studio | 新版 vLLM 默认不开 CORS；llama.cpp 回显任意 Origin；LM Studio 需要打开 CORS 开关 | — |
| [Chrome LNA](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY)（142+） | 对 `file://` 的行为"规格不明确" | 必须在银行实际使用的浏览器上实测，或通过 GPO 下发 `LocalNetworkAccessAllowedForUrls` |
| 推荐拓扑 | Python companion（`python -m reportkit serve`）在 127.0.0.1 上提供报告，只反向代理 `/v1/chat/completions` 和 `/v1/models`，带 token | 同源，避开 CORS 和 LNA；还能顺带解锁 fetch、ESM、worker |
| 严格 CSP | `connect-src` 只放行 LLM 端点，实测可以拦截 `fetch('https://example.com')`。ECharts 6.1.0 和 Leaflet 1.9.4 在不含 `unsafe-eval` 的 CSP 下都能正常渲染 | 全 kit 可以上严格 CSP，这是防止数据外泄的最佳护栏 |
| 浏览器内 LLM | WebLLM 0.2.86 和 transformers.js 4.3.1 的权重必须通过 http(s) 获取；wllama 3.8.1 在 `file://` 下只能单线程运行 | 只适合 companion 模式或内网模式 |

**LLM 契约（08 §0.12）：**
- 模型只返回 **JSON 意图**：一条 RK.query、一个 RK.expr 公式、一次筛选变更、一个只含数据的 rk-chart spec，或一条只读 SQL。所有意图都用 JSON Schema 校验，**永远不返回代码**。
- 页面在本地校验并执行意图，展示可编辑的公式。
- 发给模型的是 schema、数据字典和聚合值，不发原始行。
- LLM 生成的文本永远不进入 `innerHTML`。

**我们采用了什么：**
- `RK.expr` 和 `RK.query`。
- `RK.store` 的交叉筛选：`view(ds,{exclude:source})`，组件不被自己的筛选过滤。
- `query-console`：Builder 加查询编辑器、自动出图、"Add as metric"；自建指标按报告持久化在浏览器（`rk:metrics:<reportKey>`），"My metrics" 可删除。
- block `choices`：标题栏的指标 / 维度下拉框，`*computed` 包含客户自建指标。
- `param-slider`：What-if 参数 `@wacc`、`@tgr`，相关计算字段实时重算。

**以后要回头看的：**
1. ~~合入 `research/engine-audit.md` 的 36 个补丁~~：已完成，回归测试 164/164 通过，F1 取整已与 Excel 一致；Q9 自引用检查已移植到 Python validator。剩余跟进：组件里的 `toFixed` 改用 `RK.format.fixed`。
2. 给 `RK.expr` 加函数注册表，并接入 Formula.js。
3. 内部存储改为列式 + bitset。08 估计 1M 行可从约 0.7 s 降到 0.15–0.25 s，这比引入 DuckDB 更划算。
4. 由 builder 输出严格 CSP，并为每个 vendor 库加 CSP smoke 测试。
5. DuckDB power-pack 用 builder flag 控制是否打包。

### 2.9 打包架构（09）

**先例都收敛到同一个模型**：构建期运行 loader → 生成静态快照文件 → 声明式 spec → 薄运行时。但**没有一个先例能在 `file://` 下加载独立的数据文件，只能内联**。

| 先例 | 版本 | 许可 | `file://` | Verdict | 我们借鉴 |
|---|---|---|---|---|---|
| [Observable Framework](https://github.com/observablehq/framework/blob/main/docs/data-loaders.md) | 1.13.4 | ISC | ✗（ESM + fetch） | reference | 数据 loader 约定：stdout 输出、失败即中止、按输入哈希缓存 |
| Evidence | 40.1.8 | MIT | ✗（2026 文档已转向 `evidence serve`） | reference | SQL + markdown + "props 即绑定"的写作模型 |
| [Plotly `write_html`](https://plotly.com/python-api-reference/generated/plotly.io.write_html.html) | plotly.py 7.1.0 | MIT | ✓（内联时） | reference | `include_plotlyjs='directory'`，即同目录共享 `vendor/` 的先例 |
| [Panel embed](https://panel.holoviz.org/how_to/export/embedding.html) | 1.9.4 | BSD-3 | 导出的 JSON 状态需要 HTTP | reference | 预计算状态会组合爆炸，应该"发数据 + 客户端查询引擎" |
| Quarto dashboards | 1.10.19 | MIT | 只在 `embed-resources` 时可用 | reference | 单文件模式的先例 |
| [Frictionless Table Schema v2](https://datapackage.org/standard/table-schema/) | 2.0（2024-06-26） | Unlicense | n/a | **adopt** | 数据契约的基础词汇；pandas `to_json(orient='table')` 已兼容其子集 |
| JSON Schema 2020-12 + pydantic | 2.14.1 | MIT | n/a | **adopt** | spec 和契约的单一事实来源；Step 2 的 LLM 编辑也要先经校验 |
| [Great Tables](https://github.com/posit-dev/great-tables/releases) | 1.0.0（2026-09-25） | MIT | n/a | consider | 表格结构参考：spanner、stub、summary_rows、单元格级脚注 |
| [Grafana schema v2](https://grafana.com/docs/grafana/latest/observability-as-code/schema-v2/layout-schema/) / [Mosaic](https://idl.uw.edu/mosaic/api/core/selection.html) | 12.x / 0.33.0 | AGPL（只借概念）/ BSD-3 | n/a | reference | 元素与布局分离；selection 的 crossfilter 解析规则；`$param` 写法 |
| Playwright（Python） | 1.64.0 | Apache-2.0 | n/a | **adopt** | 同一个引擎做 PDF、PNG 和 `file://` 测试 |
| Paged.js / Vivliostyle / Datapane / Metabase / Graphic Walker | 0.4.3 / 2.45.2 / 0.17.0 / v0.64.1 / 0.5.3 | MIT / **AGPL** / Apache-2.0 / **AGPL** / Apache-2.0 | ✗（外链 CSS）/ — / — / — / ✗（需要 React 19 全局对象） | avoid / reference | 已停更、AGPL、或需要服务端 |

**关键实测数据：**
1. **数据传输**（40k 行 × 15 字段，`file://`，取 5 次中位数）：
   - Chromium：records 对象字面量 372 ms，`JSON.parse` 133 ms；columns 字面量 110 ms，`JSON.parse` 79 ms。
   - 体积：records 9.3 MB，columns 5.8 MB（gzip 后 3.08 MB 对 2.28 MB）。
   - V8 的建议：超过 10 kB 就用 `JSON.parse`（[v8.dev](https://v8.dev/blog/cost-of-javascript-2019)）。
2. **打印：**
   - 1280 × 720 CSS px = 13.333 × 7.5 in = PowerPoint 16:9；`@page{size:13.333in 7.5in;margin:0}` 输出恰好 960 × 540 pt。
   - 页面 margin box 只有 Chrome/Edge 131+ 支持（[Chrome blog](https://developer.chrome.com/blog/print-margins)），所以页脚和页码要放在 DOM 里。
   - 屏幕上缩放用 `transform: scale()`。**不要用 CSS `zoom`**，会让 ECharts 命中错误的柱子（打印没有指针交互，kit 的 Letter / A4 打印页和 printFit 用 `zoom` 不受影响）。
3. **Python 序列化陷阱：**
   - `json.dumps(NaN)` 会输出非法 JSON，要写 `allow_nan=False`，并把 NaN 映射为 null 加标记。
   - pandas 3 的 `to_json` 必须写 `date_format='iso'`。
   - 只有日期的字符串被解析为 UTC，带时间的字符串被解析为本地时间，可能错开一天。
4. **交付：** HTML 附件常被邮件网关按 HTML smuggling 拦截（[来源](https://www.securityscientist.net/blog/12-questions-and-answers-about-html-smuggling-evasion-technique/)）。默认交付方式应该是"zip 文件夹 + PDF"，通过 data room 发送。
5. **Chrome 的 `file://` localStorage：** 所有本地页面共用一个桶，键名要带报告标识前缀。kit 已实现为 `rk:<kind>:<标题|日期|构建日期>`（`RK.data.storageKey()`）。

**我们采用了什么：** `docs/architecture.md` 已经落地。
- 报告文件夹分为 `index.html`（只有版式和绑定）、`assets/`（只带用到的组件和 vendor）、`data/manifest.json`、`data/datasets/<id>.json`、`data/bundle.js`。
- 三种数据源模式：`bundle`（`file://` 默认）、`http`、`api`，三者 JSON 形状相同。
- `bundle.js` 超过 1,000,000 字符时改用 `JSON.parse`。
- 16:9 固定页面，SVG 图表，页脚在 DOM 里。
- 契约版本是 `"reportkit": "0.1"`。
- 单文件模式（`single_file=True`）：CSS、字体、vendor、运行时、组件与数据全部内联；HTML 附件可能被邮件网关拦截（上面第 4 点），所以文件夹 zip 与单文件两种形式都保留。

**以后要回头看的：**
1. 每个 dataset 一个 `.js` 文件，按页懒加载（09 §0.2）；同时提供 `orient:'columns'`。
2. 契约向 Frictionless v2 对齐，加入 `unit`、`role`、`aggregate`、带标签的 `missingValues`，以及 cell flags 到脚注的链接。
3. 加 `$schema` + `specVersion`，Python 和 JS 两侧都要有迁移链；dataset 加 `hash`。
4. ~~`--single-file` 模式~~：已实现（`build(single_file=True)` / CLI `--single-file`）。
5. builder 用 Playwright 导出 PDF（`prefer_css_page_size`、outline、tagged）。
6. CI 增加 `file://` 和 Firefox 严格模式的测试。

---

## 3. 组件覆盖矩阵：FT Visual Vocabulary × ReportKit 组件

**数据口径：**
- 组件取自 57 个 `kit/components/*/manifest.json`。`tools/build_catalog.py` 会把它们汇编成 `kit/catalog.json`（git 里的版本已同步，57 个组件）。
- FT 图型取自 07 附录 A（`chartTypes.csv`，共 72 行，跨类重复的图型分别计数）。
- 状态：✓ 有组件直接支持；◐ 可以用现有组件近似；✗ 缺失。

### 3.1 汇总

| FT 类别 | FT 图型数 | ✓ | ◐ | ✗ | 主要承接组件 |
|---|---|---|---|---|---|
| Deviation 偏差 | 4 | 1 | 0 | 3 | `diverging-bar`（另有 `bullet`、`waterfall` 处理差异） |
| Correlation 相关 | 5 | 4 | 1 | 0 | `scatter`、`bubble`、`combo`、`heatmap` |
| Change over Time 时间变化 | 12 | 8 | 1 | 3 | `line`、`bar`、`combo`、`candlestick`、`price-volume`、`slope`、`calendar-heatmap`、`gantt` |
| Ranking 排名 | 8 | 6 | 1 | 1 | `bar`、`lollipop`、`slope`、`bump`（另有 `league-table`） |
| Distribution 分布 | 8 | 4 | 1 | 3 | `histogram`、`boxplot`、`beeswarm`、`dumbbell` |
| Part-to-whole 部分与整体 | 11 | 8 | 0 | 3 | `bar`、`marimekko`、`donut`、`treemap`、`sunburst`、`waffle`、`waterfall` |
| Magnitude 量级 | 12 | 10 | 0 | 2 | `bar`、`marimekko`、`lollipop`、`radar`、`bullet`、`parallel` |
| Spatial 空间 | 8 | 5 | 1 | 2 | `choropleth`、`bubble-map`、`flow-map`、`geo-heat`、`cluster-map`、`china-tilemap` |
| Flow 流向 | 4 | 4 | 0 | 0 | `sankey`、`waterfall`、`chord`、`network` |
| **合计** | **72** | **50** | **5** | **17** | 69% 完整覆盖，加上部分覆盖为 76% |

### 3.2 逐项明细

| FT 类别 | FT 图型 | ReportKit 组件 | 状态 | 备注 |
|---|---|---|---|---|
| Deviation | bar-diverging | `diverging-bar` | ✓ | 以 0 或同业中位数为基准 |
| Deviation | bar-diverging-stacked | — | ✗ | 问卷类图，IB 优先级低 |
| Deviation | spine-chart | — | ✗ | 低 |
| Deviation | line-surplus-deficit-filled | — | ✗ | 中：实际对预算的差异带 |
| Correlation | scatterplot | `scatter` | ✓ | 回归线、R²、象限、框选交叉筛选 |
| Correlation | line-column | `combo` | ✓ | 双轴，有 CAGR 括号 |
| Correlation | scatterplot-connected | `bubble`（`timeField` 播放） | ◐ | 用动画播放代替连线 |
| Correlation | Bubble | `bubble` | ✓ | 四维：x、y、面积、颜色 |
| Correlation | XY-heatmap | `heatmap` | ✓ | 相关矩阵、月度收益表 |
| Change over Time | line | `line` | ✓ | rebase 到 100、事件标注、预测期虚线 |
| Change over Time | column-timeline | `bar` | ✓ | — |
| Change over Time | column-line-timeline | `combo` | ✓ | 预测年份用斜线填充 |
| Change over Time | stock-price | `candlestick`、`price-volume` | ✓ | 有 OHLC、MA、52 周高低、VWAP |
| Change over Time | slope | `slope` | ✓ | — |
| Change over Time | area | `line`（`area`） | ✓ | — |
| Change over Time | fan | — | ✗ | **高**：预测区间可用 @echarts-x/custom-line-range 实现 |
| Change over Time | scatterplot-line-timeline | — | ✗ | 中：倍数对增速随时间变化 |
| Change over Time | calendar-heatmap | `calendar-heatmap` | ✓ | 支持日维度和年 × 月 |
| Change over Time | priestley timeline | `gantt` | ✓ | 交易时间表（04 §11 把它映射到 deal-timeline） |
| Change over Time | circles-timeline | `timeline` | ◐ | 有里程碑，但标记大小不编码数值 |
| Change over Time | seismogram | — | ✗ | 低 |
| Ranking | bar-ordered | `bar`（`sort`、横向） | ✓ | — |
| Ranking | column-ordered | `bar` | ✓ | — |
| Ranking | symbol-proportional-ordered | — | ✗ | 低 |
| Ranking | dot-plot-strip | `dumbbell` / `lollipop` | ◐ | 可近似 |
| Ranking | slope | `slope` | ✓ | — |
| Ranking | lollipop-h | `lollipop` | ✓ | — |
| Ranking | lollipop-v | `lollipop`（`orientation`） | ✓ | — |
| Ranking | bump | `bump` | ✓ | — |
| Distribution | histogram | `histogram` | ✓ | 有密度曲线和 rug |
| Distribution | boxplot | `boxplot` | ✓ | — |
| Distribution | violin | — | ✗ | **中高**：comps 离散度，可用 @echarts-x/custom-violin 实现 |
| Distribution | population-pyramid | — | ✗ | 中：可做成 think-cell 的 butterfly / tornado |
| Distribution | dot-plot-strip | `beeswarm` | ✓ | ECharts 6 jitter；可以标出目标公司 |
| Distribution | dot-plot | `dumbbell` | ✓ | 区间点图，52 周最低 / 最高 |
| Distribution | barcode | `histogram`（`rug`） | ◐ | — |
| Distribution | cumulative-curve | — | ✗ | 中：volume-at-price 的累计线（04 §8.20） |
| Part-to-whole | column-stacked | `bar`（`stack`） | ✓ | — |
| Part-to-whole | bar-stacked-proportional | `bar`（100%）、`marimekko` | ✓ | — |
| Part-to-whole | pie | `donut` | ✓ | 超出数量的类别自动并入"其他" |
| Part-to-whole | doughnut | `donut` | ✓ | — |
| Part-to-whole | treemap | `treemap` | ✓ | 可下钻 |
| Part-to-whole | Voronoi | — | ✗ | 低 |
| Part-to-whole | sunburst | `sunburst` | ✓ | — |
| Part-to-whole | arc | — | ✗ | 低（议席图） |
| Part-to-whole | gridplot | `waffle` | ✓ | 用 largest remainder 取整 |
| Part-to-whole | Venn | — | ✗ | 低 |
| Part-to-whole | Waterfall | `waterfall` | ✓ | — |
| Magnitude | Column | `bar` | ✓ | — |
| Magnitude | Bar | `bar` | ✓ | — |
| Magnitude | column-grouped | `bar` | ✓ | — |
| Magnitude | bar-grouped | `bar` | ✓ | — |
| Magnitude | bar-stacked-proportional | `marimekko` | ✓ | — |
| Magnitude | symbol-proportional | — | ✗ | 低（地理版有 `bubble-map`） |
| Magnitude | isotype（pictogram） | — | ✗ | 低 |
| Magnitude | lollipop-h | `lollipop` | ✓ | — |
| Magnitude | lollipop-v | `lollipop` | ✓ | — |
| Magnitude | Radar | `radar` | ✓ | — |
| Magnitude | Bullet | `bullet` | ✓ | — |
| Magnitude | Parallel coordinates | `parallel` | ✓ | 在轴上刷选可交叉筛选 |
| Spatial | basic-choropleth | `choropleth` | ✓ | — |
| Spatial | proportional-symbol | `bubble-map` | ✓ | — |
| Spatial | flow | `flow-map` | ✓ | — |
| Spatial | contour | — | ✗ | 低 |
| Spatial | equalised-cartogram | `china-tilemap` | ✓ | 中国 34 个省级行政区的等大方块 / 六边形，是中国地图的合规方案（02 §6.3）；世界区域、美国州版本还没有 |
| Spatial | scaled-cartogram-value | — | ✗ | 低 |
| Spatial | dot-density | `cluster-map` | ◐ | 聚合点，非真正的点密度 |
| Spatial | heat-map | `geo-heat` | ✓ | — |
| Flow | sankey | `sankey` | ✓ | — |
| Flow | waterfall | `waterfall` | ✓ | — |
| Flow | chord | `chord` | ✓ | — |
| Flow | network | `network` | ✓ | — |

### 3.3 FT 词表之外的组件

57 个组件中，37 个已出现在上表里（`timeline`、`cluster-map` 只算部分覆盖）。另外 20 个（35%）是投行特有或报告骨架类组件，FT 词表里没有对应图型。04 §11 也指出，football field、sensitivity grid、AVP、league table 是 FT 没有单独命名的 IB 图型。

| kit 类别 | 组件 |
|---|---|
| 估值 | `football-field`、`avp-table`（不同报价下的估值分析）、`sotp`（分部加总估值） |
| 时间趋势（IB 专用） | `multiple-history`、`small-multiples` |
| 表格 | `comps-table`、`sensitivity-table`、`pivot-table`、`league-table`、`data-grid`、`sources-uses`（资金来源与运用） |
| 流向与关系 | `tree`（股权 / 法人结构）、`funnel` |
| 版式与叙事 | `kpi-tiles`、`text-block`、`tombstones`（交易业绩墓碑卡） |
| 控件与查询 | `filter-bar`、`param-slider`、`scenario-switch`、`query-console` |

### 3.4 缺口优先级（结合 04 的 IB 需求）

| 优先级 | 缺口 | 建议实现 | 依据 |
|---|---|---|---|
| ~~P0~~ ✅ | AVP 表（Analysis at Various Prices） | 已实现：`avp-table`（DOM 表 + 实时重算） | 04 §8.8 |
| P0 | Premiums paid（分位数柱 + 隐含价 chips） | ECharts bar；样本可交叉筛选 | 04 §8.9 |
| P0 | 财务摘要表（A/E 分隔、growth / margin 行、CAGR） | 扩展 `pivot-table` 或新增 DOM 表 | 04 §8.11 |
| P1 | Fan chart / 区间带 | vendor `@echarts-x/custom-line-range` | 01 §8，06 §15.1 |
| P1 | Tile-grid cartogram（世界区域 / 美国州；中国版已由 `china-tilemap` 实现） | 复用 `china-tilemap` 的 ECharts 布局和图例代码，换网格表 | 02 §6.3、§10.3 |
| P1 | "% of time in range" 分桶表 | 扩展 `multiple-history` | 04 §8.10 |
| P1 | Violin | vendor `@echarts-x/custom-violin` | 01 §0.3 |
| P1 | think-cell 差值箭头、全局 `roundToTotal` | 做成装饰插件 | 04 §0.11、§13.12 |
| P2 | Butterfly / tornado、累计曲线（volume-at-price）、connected scatter | ECharts 配方 | 04 §8.20，FT |
| P3 | Voronoi、arc、Venn、contour、scaled cartogram、seismogram、isotype | 按需再做 | 对 IB 价值低 |

---

## 4. Step 2 路线图与 vendor 栈维护

### 4.1 Step 2 路线图

Step 2 指本地部署的 LLM、可导入的 skills、客户自定义指标与查询的增强。完整计划见 **`docs/roadmap-step2.md`**。调研给出的约束如下：

1. **意图契约。** LLM 只输出经 JSON Schema 校验的意图，永远不输出代码；最多重试 2 次（08 §0.12）。
   - spec 词汇借 Vega-Lite / Graphic Walker 的通道名（09 §0.5）和 [Flint](https://github.com/microsoft/flint-chart) 的通道表（07 §10 R6）。
   - 维度 / 度量结构借 VSeed（06 §15.6）。
2. **传输。** Python companion 在 127.0.0.1 上同源反向代理 LLM，从而避开 `Origin: null`、CORS 和 Chrome LNA（08 §8）；`file://` 直连只作为高级用户的后备方案。
3. **安全。** builder 输出严格 CSP，`connect-src` 只放行 LLM 端点；发给模型的是 schema 和聚合值，不发原始行；审计日志写在 IndexedDB 里。
4. **Skills。** 每个 skill 包含三部分：
   - [Agent Skills](https://agentskills.io/specification) 的 `SKILL.md`（给 LLM 读）；
   - `rk-skill.json`（声明式贡献：函数、指标、查询、图表预设）；
   - 可选的 `skill.js`（classic script）。

   代码运行在沙箱化的 `srcdoc` iframe 里，用 postMessage 上的 JSON-RPC 通信，模型参照 [MCP Apps](https://github.com/modelcontextprotocol/ext-apps)。该方案在 `file://` 下已验证（08 §9）。
5. **能力扩展包**（按 builder flag 懒加载）：
   - DuckDB-WASM 1.32.0：SQL console；
   - AntV S2 2.7.2 或 VTable 1.26.8：重度透视；
   - Vega-Lite 6.5：ask 模式下的临时出图；
   - Perspective 5.6.0：只用于 served mode。
6. **先修地基，再上 LLM：**
   - 合入引擎审计补丁（已完成，164/164）；
   - 实现函数注册表 + Formula.js；
   - 内部存储改为列式 + bitset；
   - 加 `specVersion` 和迁移链（08 §10 中的 P0/P1 分期）。

### 4.2 vendor 栈怎么保持最新

**现有机制：**
- `vendor/vendor.json` 是唯一的事实来源：每个包写精确版本、许可、上游仓库、用途，以及从 tarball 中保留哪些文件。
- `python3 tools/vendor.py [id]` 对每个包执行 `npm pack <pkg>@<version>`（不执行生命周期脚本），解包后只复制清单列出的 dist 和 LICENSE/NOTICE，再重新生成 `vendor/LICENSES.md`。
- `python3 tools/vendor.py --check` 离线检查所有文件是否存在、sha256 是否与 `vendor.json` 记录一致，`tools/check.sh` 的第一步就是它；有意替换文件后用 `--rehash [id]` 重新记录。重新获取时 tarball 的 `integrity`（sha512）与记录不符即报错。
- `geo-world`、`geo-world-50m` 是本地生成的条目（`"local": true`），由 `python3 tools/build_geo.py` 从 world-atlas 重新包装。
- 组件 manifest 的 `optionDeps` 让某个选项值追加 vendor 依赖（例如 `basemap: "world-50m"` → `geo-world-50m`），builder 只在用到时打包。
- Python builder 只把报告实际用到的组件所依赖的 vendor 复制到 `assets/vendor/`，每份报告冻结自己的副本（09 §0.6，参照 Plotly 的 `include_plotlyjs='directory'`）。

**升级流程（每次升级任何 vendor 都要走一遍）：**
1. `npm view <pkg>@<new> version license dist-tags time`：确认新版本**许可没变**（ApexCharts 就是在 minor 版本里变的），也确认 `latest` 不是 dev 构建（DuckDB-WASM 的 `latest` 就是 dev 版）。
2. 查看 jsDelivr 上的 dist 列表，确认仍然有 UMD/IIFE 构建。MapLibre 6 和 TanStack v9 都在新主版本里去掉了 UMD。不要只看发布说明：Vega 6 声称 ESM-only，实际上仍发布 UMD（01 §9.5）。
3. 修改 `vendor.json` 里的版本号，运行 `tools/vendor.py <id>`，然后运行 `bash tools/check.sh`（Python 测试、JS 引擎测试、目录校验、浏览器 smoke 测试）。
4. 对所有组件跑截图对比（`node tools/smoke.cjs --all`，截图输出到 `tests/screens/`）。ECharts 的默认行为在小版本之间也会变（01 §5.1.9）。
5. 在 `file://` 下双击打开 `examples/` 下的示例报告，检查控制台没有错误、没有外部请求、打印预览正常。

**需要补的维护能力（按优先级）：**

| # | 能力 | 原因 | 来源 |
|---|---|---|---|
| ~~1~~ ✅ | 在 `vendor.json` 里记录 `integrity`（npm `dist.integrity` sha512）和每个文件的 sha256，由 `--check` 校验——已实现 | AntV 投毒事件 | 06 §2、§15.4 |
| 2 | 增加 `"url"` 来源类型 | SheetJS CE 只在 cdn.sheetjs.com 发布 | 03 §9.2 |
| 3 | 增加 `"build"` 类型：在 vendor 阶段用 esbuild 把 ESM 打成 IIFE | 用于 Motion mini（4.4 KB）、NumberFlow、Flint | 05 §2.11 |
| 4 | 在 CI 里加 Firefox 的 `file://` 测试（`strict_origin_policy=true`）和全组件的拦截网络离线审计 | Chromium 的 `file://` 已由 e2e 与单文件测试覆盖；`tools/smoke.cjs` 仍走 http server | 02 §2，09 §0 |
| 5 | 对每个 vendor 库跑严格 CSP smoke 测试 | 新库如果用 `new Function`，严格 CSP 会失效 | 08 §11.5 |
| 6 | 自动重新生成 `kit/catalog.json`，并检查它与 manifest 一致 | 重新生成已有：`tools/check.sh` 每次运行 `build_catalog.py --strict`（目前 57/57 一致）。还缺一步：在 CI 里用 `git diff --exit-code` 检查生成文件是否已提交 | §0.4 |

**观察清单：**

| 对象 | 当前 | 触发条件 | 动作 |
|---|---|---|---|
| ECharts | 6.1.0（2026-05-19） | 发布 6.2 | 跑截图对比；查看 RELEASE_NOTE 里的行为变化 |
| Leaflet | 1.9.4；2.0 仍是 alpha.1（2025-08-16） | 2.0 发布稳定版，且 Leaflet 插件库开始出现 `compatible-v2` 标记 | 评估换成 `leaflet-global.js` + V1 polyfill。⚠ kit 目前用的是 factory 写法（`L.map`、`L.circleMarker`、`L.geoJSON`），2.0 已删除 factory，迁移前要改成构造函数（02 §3.2） |
| world-atlas | 2.0.2（已归档，NE 4.1.0） | 现在 | 改为由 builder 从 NE 5.1.2 构建底图 |
| Tabulator | 6.6.1 | 新的 minor 版本 | 仓库已迁到 `tabulator-tables` 组织；git 里已无 `dist/`，只认 npm |
| MapLibre | 6.14.0（最后一个 UMD 是 5.24.0） | 需要矢量底图时 | 只在 served mode 使用 |
| Lightweight Charts 的替代 | Vela 0.8.4 / KLineChart 10.0.4 | Vela 1.0 | 需要交易终端类组件时再评估 |
| AntV（S2、T8） | 2.7.2 / 0.3.1 | 决定引入时 | 只用投毒清理后的版本，并核对 jsDelivr 哈希 |
| DuckDB-WASM | 1.32.0 stable | 发布新的 stable 版 | 注意 npm 的 `latest` 是 dev 版 |
| 字体 | Inter 5.3.0（Fontsource） | 需要 `zero`、`case`、`ss` 特性时 | 改用上游 inter-ui 4.1.1 的 variable latin（约 100 KB） |
| 许可漂移 | ApexCharts、GSAP 的先例 | 每次升级 | 走升级流程第 1 步 |

**每月低成本复扫（07 §10 R4）：**
- diff awesome-dataviz 的 Financial、Maps、Misc 三节；
- 统计 Leaflet `_plugins` 里 `compatible-v2` 的数量；
- 查看 ECharts `chart-list-data.js` 的 `since` 字段；
- 复核 chartjs/awesome 的 peerDependencies；
- 重新运行 `python3 tools/build_research_catalog.py` 更新 `research/catalog.json`。

---

## 附录：笔记与数据索引

| 文件 | 内容 |
|---|---|
| `research/raw/01-charts-general.md` / `.json` | 图表库总表、`file://` smoke 测试、覆盖矩阵、think-cell 配方、Sources（§10） |
| `research/raw/02-geo-maps.md` / `.json` | 17 个离线测试、插件表、底图阶梯、中国合规、多维编码手册、Sources（§11） |
| `research/raw/03-tables-grids.md` / `.json` | 网格库总表、功能矩阵、IB 表格排版规范、TableSpec、Sources（§11） |
| `research/raw/04-pitchbook-design.md` / `.json` | EDGAR 实证、页面解剖、3 套验证过的色板、34 个组件愿望清单、FT 映射、Sources（§15） |
| `research/raw/05-motion-ui.md` / `.json` | 动效 / 控件 / 图标 / 字体总表、`file://` 实测、GSAP 许可详解、Sources（§9） |
| `research/raw/06-china-xhs.md` / `.json` | AntV 投毒事件、中国生态总表、社区信号、风格判断、Sources（§16） |
| `research/raw/07-collections.md` / `.json` | 28 个合集、FT 72 种图型全表（附录 A）、ECharts 示例 id（附录 B）、Sources（§11） |
| `research/raw/08-query-ai.md` / `.json` | 公式和查询基准、DuckDB 离线配方、LLM CORS、skills 架构、Sources（§12） |
| `research/raw/09-architecture.md` / `.json` | `file://` 能力矩阵、数据加载基准、先例、契约、打印、Sources（§12） |
| `research/catalog.json` | 239 个库合并后的目录（verdict、`in_kit`），由 `tools/build_research_catalog.py` 生成 |
| `research/engine-audit.md` | `RK.expr` / `RK.format` / `RK.data` 审计：36 个缺陷及补丁、128 个测试 |
