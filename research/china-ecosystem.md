# 中文可视化生态与小红书推荐（China ecosystem）

> **日期** 2026-10-14 · **读者** ReportKit 产品负责人；面向中国客户或中文交付物的项目组
> **依据**
> - 主要来源：`research/raw/06-china-xhs.md`（下称 06）。
> - 补充来源：02（地图合规）、07（合集与 AI 新秀）、08（AI 与 Step 2）。
> - 现状核对：`vendor/vendor.json`、`kit/catalog.json`（57 个组件）、`docs/design-system.md`、`docs/roadmap-step2.md`、`research/landscape.md` §2.6。
> - 2026-10-14 复核：Step 1 第一阶段已实现 vendor 完整性哈希、zh-CN 界面与 万 / 亿、红涨绿跌（`updown="cn"`），下文相应状态已更新。
>
> **口径**
> - 版本、许可、体积、日期都在 2026-10-14 实查。方法：`npm view`、jsDelivr 数据 API、下载 UMD 后本地 `gzip -9`、读 raw LICENSE、shields.io。标 *（未核实）* 的除外。
> - Verdict 分 4 级：**adopt** 采用 · **consider** 备选 · **reference** 仅作参考 · **avoid** 避免。
> - 本文不是法律意见。涉及地图审核的部分，必须由合规或法务确认。

---

## 0. 结论（先看这里）

| # | 决策 | 一句话理由 |
|---|---|---|
| 1 | **只用 ECharts 6.1.0 一个引擎，不引入 AntV G2 / VisActor VChart 运行时** | 中国生态的大屏模板、低代码 BI 和 pyecharts 都建在 ECharts 上。kit 的 57 个组件里已有 37 个用 ECharts。G2（320 KB gz）和 VChart（617 KB gz）与它功能重叠 |
| 2 | **vendor 官方 `@echarts-x/custom-bar-range`、`custom-line-range`、`custom-violin`** | Apache-2.0，每个约 2 KB（min 1.8–2.2 KB，见 §2.2），是 `file://` 可用的 classic script。分别补上 football field 的正规区间编码、fan chart / 区间带、violin。**目前尚未 vendor** |
| 3 | **透视表是中国库唯一能补能力的地方：AntV S2 或 VisActor VTable，懒加载** | 带小计的交叉表是投行刚需。只用 2026-05-19 投毒事件清理后的版本，并核对哈希 |
| 4 | **AI 出图走"AI 只做填空题"** | LLM 只输出一个经 schema 校验的最小意图 spec，样式由确定性编译器负责。VMind 已停更；GPT-Vis、VSeed、T8 只借设计，不当依赖；**云端渲染一律禁止**（mcp-server-chart、chart-visualization 技能、echarts-mcp） |
| 5 | **供应链：AntV npm 命名空间在 2026-05-19 被投毒** | 300 多个包、600 多个恶意版本。我们的 `tools/vendor.py` 用 `npm pack --ignore-scripts`，不跑 install 脚本；`vendor.json` 已记录 tarball `integrity`（sha512）和逐文件 sha256，`--check` 离线校验 ✓ |
| 6 | **大屏审美不适合投行客户报告** | 深色背景、霓虹、发光、毛玻璃、3D、飞线、水球、词云、1920 × 1080 等比缩放都不用。可以借鉴的：克制的 count-up、跨图联动、叙事布局、标注体系、主题 token |
| 7 | **小红书本身无法访问** | 需要登录和签名请求头，搜索引擎也不收录。"中文设计师推荐什么"是从掘金、微信（经搜狗）、CSDN 和知乎标题、官方设计指南三角推断出来的（§1） |
| 8 | **中国地图：不用 DataV.GeoAtlas，面向中国受众时用 tile-grid 方格图或原样使用标准地图** | GeoAtlas 声明"仅供学习和交流使用"。按 PRC 规定，公开展示的地图需要审图号，标准地图哪怕只做裁剪或缩放也要重新送审。`china-tilemap` 组件已进 kit（manifest 和 `china_provinces` 样例数据已在 catalog 中），合规表述仍待法务确认（§9.3） |
| 9 | **中文交付物的细节靠 token 和配置切换，不改组件** | 已实现：`Report(locale="zh-CN", updown="cn")` → 中文界面文字（`RK.i18n` zh-CN 包）、万 / 亿 紧凑单位、中文日期、红涨绿跌（运行时对调 `--rk-pos` / `--rk-neg`，四套主题通用）。还没做：中文字体由 builder 对 Noto Sans SC 子集化 |

---

## 1. 信息来源与可访问性：小红书到底看到了什么

**直说：小红书（xiaohongshu.com）没有拿到任何一手内容。** 下文所有"小红书 / 中文设计圈推荐"的结论都是从二手来源三角推断的。

| 来源 | 访问结果（06 §1） | 我们怎么用 |
|---|---|---|
| **小红书** | ❌ 搜索页 `https://www.xiaohongshu.com/search_result?keyword=数据可视化` 只返回约 60 KB 的 SSR 空壳，`__INITIAL_STATE__` 里只有 "想了解些什么？"、"搜索小红书" 之类的占位文字。edith API 不带签名头 `x-s` 就返回 404。`site:xiaohongshu.com` 在可用的搜索引擎里 0 结果；Bing、Baidu、DDG 被拦截或要求验证码 | **没有直接数据** |
| 知乎 zhuanlan.zhihu.com | ❌ WebFetch 返回 HTTP 403 | 只用了搜索摘要里的标题 |
| CSDN | ◐ 正文被 JS cookie 校验拦截（HTTP 521）；搜索 API `so.csdn.net/api/v3/search` 可用 | 只用标题、日期、阅读数，当**趋势信号** |
| **掘金 Juejin** | ◐ 搜索 API `api.juejin.cn/search_api/v1/search` 可用。文章页有 ByteDance WAF 的 proof-of-work，低频解开了**约 12 篇** | **主要的中文从业者来源** |
| 微信公众号 | ◐ 搜狗 `weixin.sogou.com` 可用，但只有标题和摘要 | 信号来源，例如搜狗微信的搜索结果让我们注意到了 AntV 投毒事件（06 没有记录是哪一篇；06 引用的图表兔 2026-10 那篇讲的是误导性图表） |
| 官方文档与设计指南 | ✅ echarts.apache.org、visactor.github.io、飞书设计规范、阿里云 DataV 帮助中心、Canva CN | 设计规则的硬依据 |
| npm、jsDelivr、unpkg、raw.githubusercontent、shields.io | ✅ | 版本、许可、体积等硬事实 |

**可信度提示：**
- 2025–26 年很多 CSDN "gitblog_00xxx" 帖子是 AI 生成的 SEO 内容，例如"34 款主题终极指南"。
- 一些掘金文章是营销文，而且事实有错。例如 https://juejin.cn/post/7476295800785993728 声称 ECharts 没有 3D（实际有 echarts-gl），还展示了一个不存在的 `vchart.autoChart()` API。
- 这类内容只当**热度信号**，不当事实。

---

## 2. ECharts 生态（Baidu → Apache）

**现状：** kit vendor 了 `echarts@6.1.0`（Apache-2.0，随附 NOTICE 和 LICENSE-d3），57 个组件里有 37 个基于它。06 在 ECharts 生态里没有发现投行刚需它覆盖不了的情况。

### 2.1 ECharts 6.x 对投行有用的能力

来源：
- ECharts 6.0 发布文 https://juejin.cn/post/7521283343268036646（1.77 万阅读，06 样本里 2025 年阅读量最高的中文可视化文章）
- https://echarts.apache.org/handbook/en/basics/release-note/v6-feature
- https://github.com/apache/echarts/releases

| 能力 | 投行用途 | kit 现状 |
|---|---|---|
| 设计 token 默认主题（`lib/visual/tokens.js`）+ `chart.setTheme()` 运行时换肤，不需要重新初始化 | 一套 token 生成浅色、深色、打印三种变体 | kit 走自己的路：CSS token → `RK.theme` → `echarts.registerTheme('rk', …)`，效果一致 |
| **Matrix 坐标系**：任何 series 都可以放进矩阵单元格 | think-cell 式同业面板、带迷你图的表格、相关矩阵 | `small-multiples` 和 `heatmap` 目前没用它，可以评估迁移 |
| **断轴** `yAxis.breaks` | 某一家同业远大于其他家时；瀑布图里变动相对合计很小时 | `waterfall` 已有 `axisBreak`。策略：必须显示断轴标记并加注释 |
| Beeswarm / jitter | comps 倍数的离散度 | `beeswarm` 已实现（自算布局） |
| Chord（官方文档推荐用于"金融交易"流向） | 跨境并购、业务单元间流量 | `chord` 已实现 |
| `markPoint.relativeTo`、K 线 / MACD / 成交量组合 | 股价图事件标注 | `candlestick`、`price-volume` 已实现 |
| 轴标签默认防溢出、防重叠（`grid.outerBoundsMode`） | 长公司名 | 已受益 |
| 6.1 修复 `lines` series tooltip 的 **XSS** | tooltip 显示用户提供的名称时 | 已在 6.1.0 ✓ |

**坑：ECharts K 线默认红涨绿跌**（`#eb5454` / `#47b262`，中国惯例）。kit 的 `candlestick` 和 `price-volume` 已改为读取主题的 `t.pos` / `t.neg`，默认西方惯例；中国客户用 `Report(updown="cn")` 统一切换为红涨绿跌（`docs/design-system.md` §3.2 第 6 条）。

### 2.2 官方 custom series `@echarts-x/*`（adopt）

| 包 | 版本 | 文件 | 投行映射 |
|---|---|---|---|
| `custom-bar-range` | 1.2.1 | `bar-range.auto.min.js` 1.8 KB | **football field**：52 周区间、trading comps、precedents、DCF 区间。给 `football-field` 提供正规的低值 / 高值编码 |
| `custom-line-range` | 1.1.1 | 约 2 KB | **fan chart**、一致预期高低区间、情景区间（FT 缺口，P1） |
| `custom-violin` | 1.1.1 | 2.2 KB | comps 倍数或回报的分布（FT 缺口，P1） |
| `custom-contour` | 1.2.1 | 2.9 KB | 分布密度（P3） |
| `custom-segmented-doughnut` | 1.1.1 | — | 目标完成度（替代仪表盘） |
| `custom-stage` | 1.1.1 | — | 交易阶段 |
| `custom-word-cloud` / `custom-liquid-fill` | 1.0.1 / 1.0.2 | 14.7 / 7.8 KB | **只在客户坚持时才用**（§8） |

- 仓库：https://github.com/apache/echarts-custom-series 。Apache-2.0，2026-01 发布。
- 用法：在 `echarts.min.js` 之后加载 `*.auto.min.js`，它会自动注册。之后写 `series: [{type:'custom', renderItem:'violin', …}]`。
- 要求 ECharts ≥ 6。
- 它们取代了 ecomfe 的旧插件 `echarts-wordcloud` 2.1.0 和 `echarts-liquidfill` 3.1.0。旧插件停更于 2021–22 年，只声明支持 echarts ^5。

### 2.3 其他 ECharts 生态项目

| 项目 | 事实 | Verdict |
|---|---|---|
| `echarts-gl` 2.1.0 | MIT，现在正式支持 echarts ^6，170 KB gz | **avoid 3D**（扭曲数值大小，打印效果差）。唯一合理的用途是 10 万点以上的 `scatterGL` / `linesGL` |
| 内置 36 个主题（`echarts/theme/*.js`） | 包括 macarons、shine、tech-blue、dark-* 等 | **没有一个达到 pitchbook 级**，不用。kit 用自己的 token |
| Theme builder（https://echarts.apache.org/en/theme-builder.html） | 可导出 JSON | 只适合快速试色；token 才是事实来源 |
| **pyecharts** 2.1.0（MIT，16k★） | 输出的 HTML 把 option 和数据内联在一起，默认从 CDN `assets.pyecharts.org` 加载 | reference：它的链式 API 写法值得借鉴，但输出**违反我们 HTML / JS / DATA 分离的原则**。builder 输出 `data/*.json` 加 block spec |
| `echarts-for-react` | 投毒事件中被攻破的账号 `atool` 正是这个包的作者 | 不需要（我们是 vanilla JS） |
| `apache/echarts-mcp`（86★，demo） | 在服务端渲染，**上传到百度 BCE 对象存储**后返回图片 URL | reference：它 README 里的 "Approach 3"（只让 LLM 给最小参数，主题固定在应用里）**印证了我们 Step 2 的设计** |
| makeapie.com 社区画廊 | 2022 年已关闭；CSDN 2026-03 有一篇"ECharts Gallery弃用后，这4个替代网站…"（正文被拦，没读到） | 改用官方 examples，见 `research/awesome-collections.md` §2.3 |

---

## 3. AntV（蚂蚁集团）

**总体判断：**
- 优势：语法谱系很强（G2 5 借鉴了 Vega-Lite 和 Observable Plot）；有中国最好的透视表 S2 和最好的图分析库 G6；在 AI 方向投入激进（GPT-Vis、Infographic、T8、mcp-server-chart、skills、AVA 4）。
- 两个硬伤：
  1. 2026-05-19 npm 投毒事件（§10）。
  2. 每个 UMD 包都自带一套 `@antv/g` 渲染器，所以体积都很大。

| 库 | 版本 · 许可 · gz 体积 | 投行相关性 | Verdict |
|---|---|---|---|
| **S2** | 2.7.2 · MIT · 302 KB（UMD 全局名 `S2`，自包含） | **带小计和合计的交叉表**（板块 × 年份 × 指标）、冻结窗格、树形模式、下钻；号称 100 万单元格 8 秒内渲染 | **consider（懒加载）**。只在透视需求重的报告上加载。平面表格继续用 Tabulator |
| G2 | 5.4.8 · MIT · 320 KB | 表达力强，比如用 `flexX` 做 Marimekko、分面小多图、keyframe 叙事动画。但它是第二个引擎，而且命名空间被投毒过 | reference（借鉴 transform、facet、keyframe 的思路） |
| G6 | 5.1.1 · MIT · 380 KB | 股权结构、供应链网络 | reference。ECharts 的 `graph` / `tree` 已覆盖 `network`、`tree` 两个组件 |
| X6 | 3.1.8 · MIT · 162 KB | 图编辑器，对静态报告来说过重 | avoid |
| L7 | 2.29.1 · MIT · 337 KB | WebGL 地理可视化。底图（高德、百度、天地图）需要在线 key；**默认 logo 从 `gw.alipayobjects.com` 加载** | **avoid** |
| G2Plot / F2 | 2.4.35 / 5.14.0 | G2Plot 已被 G2 5 取代；F2 是移动端库 | avoid |
| AVA | 3.4.1（2024-03）/ 4.0.0-beta.1（2026-10-13） | v3 的 ChartAdvisor 有 **chart lint** 规则；v4 转成了 Node 端框架 | reference（lint 思路，§6） |
| **T8** | 0.3.1 · MIT · **18 KB**（UMD `T8`，无外连） | 叙事文本里的行内实体，例如 `[$4.2bn](metric_value, origin=4200000000)`、`[12.3%](delta_value, assessment=positive)`：数字格式统一，自动着正负色，能回溯到数据源 | **consider**。可以 vendor（锁定清理后的版本并核对哈希），也可以在 `text-block` 里自研约 150 行 |
| GPT-Vis | 1.0.2 · MIT · 约 650 KB | 类 Markdown 的 ```` ```vis ```` DSL，可流式渲染、容错；默认风格不是投行风 | reference（借思路，不当依赖） |
| Infographic | 0.2.20 · MIT · 281 KB · 7k★ | 约 200 个模板。**运行时从 `weavefox.cn` 拉图标，从 `assets.antv.antgroup.com` 拉阿里巴巴普惠体字体**，离线不可用，也有隐私问题；风格偏小红书和 PPT 的"可爱风" | reference |
| mcp-server-chart | 0.9.10 · MIT · 4.4k★ | 默认由 **AntV 托管的 GPT-Vis-SSR 渲染**，数据会离开本机 | reference（**禁止用于客户数据**） |
| Sive | SaaS（2026-08） | GitHub 仓库只有 README 和 logo | avoid |

社区印象（掘金）：AntV "颜值高、上手难、属于 Ant Design 生态"。例如"替代Echarts，采用antv实现数据可视化图表"有 2.1 万阅读（2022）。

---

## 4. VisActor（字节跳动）

技术栈：VRender（渲染器）→ VGrammar → VChart / VTable → VStory / VMind / VSeed / VBI。中英文文档质量都很好。**VTable 是这个家族里最突出的。**

| 库 | 版本 · 许可 · gz 体积 | 投行相关性 | Verdict |
|---|---|---|---|
| **VTable** | 1.26.8 · MIT · 531 KB（UMD `VTable`，无外连） | `ListTable`、`PivotTable`，以及 **`PivotChart`**（每个单元格是一张图、共享坐标轴，相当于 think-cell 式图表矩阵）。注意：PivotChart 还要再加载 VChart，多 617 KB | **consider**。和 S2 对比：S2 更轻，更像金融交叉表；VTable 生态势头更好，还能单元格内嵌图 |
| VChart | 2.1.7 · MIT · 617 KB | 默认样式好，叙事标注丰富（mark point、line、area 都支持富文本），有 player 时间轴动画，`updateSpec` 支持局部更新 | reference（借鉴标注和 player 的设计） |
| **VSeed / VBI** | 0.7.0 · MIT · 203 KB | 面向业务语义的 DSL：`{chartType, dataset, dimensions[{id, alias}], measures[{id, alias, parentId}]}`，经 `Builder.from(vseed).build()` 编译成 VChart 或 VTable spec；约 40 种图型。Coze 上的 "VisActor 图表技能"就是通过修改 VSeed spec 来调图的 | **reference（重点）**：我们数据 spec 层应该长成这样（§6） |
| `vchart-theme` | 1.13.1 · MIT | `veODesignLightFinance` 色板：`#294C60` 深青蓝、`#E2B890` 棕金、`#9D0800` 酒红、`#324BCC` 宝蓝……这是中国预设里**最接近 GS / JPM 风格**的。`vScreenFinanceYellow` 是大屏风格 | reference（可作为暖色主题的备选） |
| VMind | 2.0.10（2025-08，冻结） | 仓库已改名为 `VisActor/skills`，README 写明 "The previous VMind SDK is no longer maintained"。UMD 包期望 Node 的 `util`、`stream`、`http`、`fs` 等全局对象 | **avoid** |
| VStory / VGrammar | 0.0.26 / 0.16.18 | VStory 是 pre-alpha，1 MB gz；VGrammar 还没到 1.0 | avoid |
| **VisActor/skills** | MIT | vchart-skill、vtable-skill、data-storytelling，配 41 个评测用例。宿主 agent 提供模型，不需要 VisActor 的 key。⚠ 生成的 HTML 从 unpkg 加载，而且依赖 GSAP（非 OSI 许可） | reference（技能包格式） |

社区信号：
- VTable 的掘金文章 3.9 万阅读，是 VisActor 阅读量最高的一篇。
- VisActor 在掘金有赞助性质的社区计划（开发者奖励计划、2026-03 的 Skills 征文），所以掘金上的热度有一部分是赞助出来的。

---

## 5. DataV 与"数据大屏"

**什么是数据大屏：**
- 指 1920 × 1080 或更宽的全屏墙面展示，用于指挥中心和政企"驾驶舱"。
- 阿里云 DataV 的官方设计指南把风格关键词定为**科技感、空间感、光感**：深色背景上用高饱和点缀，版面按"自上而下、自左而右"的故事线布局。
- 来源：https://help.aliyun.com/zh/datav/datav-6-0/getting-started/introduction-to-data-dashboard-design

| 项目 | 事实 | Verdict |
|---|---|---|
| DataV（`@jiaminghi/data-view` 2.10.0） | MIT，9.7k★。npm 最后发布于 2020-09，仓库最后提交 2023-07。只支持 Vue 2。组件包括 13 种动画 SVG 边框、装饰、数字翻牌器、轮播表、水位图、飞线图 | **avoid**（风格不合适，框架也不兼容） |
| `@kjgl77/datav-vue3` 1.7.4 | MIT，Vue 3 分支，2024-10 | avoid |
| **iGaoWei/BigDataView** | 5.3k★，自称"100+套大数据可视化模板"。README 说明资源"**来自网络收集**"，**没有 LICENSE** | **avoid**（知识产权风险；只能当反面教材） |
| yyhsong/iDataV | 5.7k★，没有 LICENSE，2021-07 后停更。里面有"上市公司全景概览"案例 | avoid |
| GoView（dromara/go-view） | MIT，Vue 3 低代码大屏编辑器 | avoid（这是应用，不是组件库） |
| DataEase / SQLBot | **GPL-3.0** / **修改版 GPLv3**（要求保留 logo） | **avoid**（许可） |
| `autofit.js` / `v-scale-screen` | MIT，把 1920 × 1080 画布用 CSS transform 等比缩放到任意屏幕 | **avoid**：破坏文字重排、打印和无障碍 |
| DataV.GeoAtlas（地图数据） | 见 §9 | **avoid** |

**趋势：** 2026 年掘金上最新的大屏文章都是 AI 生成大屏，例如"用 GPT Image 2 生成数据大屏"。需求正在转向"AI 生成仪表盘"。这反过来说明：**严格的 spec 加 house style** 是必需的。

---

## 6. AI 图表生成：VMind、GPT-Vis、Flint 等

### 6.1 项目对比

| 项目 | 做法 | 能否离线用本地 LLM | 2026-10 状态 | Verdict |
|---|---|---|---|---|
| VisActor **VMind** 2.0.10 | LLM → VChart spec；文本数据抽取；对话式编辑 | 理论上可以（OpenAI 兼容接口） | **停更**（仓库已改名 VisActor/skills） | **avoid** |
| VisActor **skills + VSeed** | Agent skill 加业务 DSL，确定性地编译成 VChart / VTable | 宿主 agent 提供模型；生成的 HTML 要改成用本地 vendor 文件 | 很活跃 | reference（模式） |
| AntV **GPT-Vis** 1.0.2 | ```` ```vis ```` DSL 或 JSON → 图表，可流式渲染、容错 | 可以（纯前端） | 活跃 | reference（模式） |
| AntV **mcp-server-chart** 0.9.10 | MCP 工具 → 托管 SSR → 图片 URL | 只有私有部署 GPT-Vis-SSR 才行；地图不支持私有部署 | 活跃 | reference |
| AntV **chart-visualization-skills** | 9 个 `SKILL.md`。官方号称在 174 个 G2 测试用例上达到 98.2%，Context7 基线是 80.5% | ⚠ `chart-visualization` 技能用 curl 调用 AntV 云端 | 活跃 | reference |
| AntV **Infographic** / **T8** | 信息图和叙事文本的 DSL，自带 LLM prompt 文件 | Infographic 要先改掉 CDN 字体和图标；T8 可以直接离线 | 活跃 | reference / **consider（T8）** |
| AntV **AVA** v3 → v4 | 规则型推荐和 lint → AI 原生的 Node 框架 | v3 浏览器可用；v4 在服务端 | v4 beta（2026-10-13） | reference |
| **apache/echarts-mcp** | 最小参数 → 服务端渲染 → 图片 URL（百度 BCE） | 要改造 | demo | reference |
| **Microsoft Flint** 0.5.1（MIT，4.4k★） | 一份 AI 友好的 spec，编译到 Vega-Lite、ECharts、Chart.js、Plotly，以及**可编辑的 Excel 图表**；有 `flint-chart-mcp` | 可以，但只发 ESM，需要构建时用 esbuild 打成 IIFE | 活跃 | **consider（Step 2 后期，builder 侧）** |
| Microsoft **LIDA** 0.0.14 | Python：摘要 → 目标 → **生成并执行**可视化代码 | 可以 | 停更（2024 年起） | reference / avoid（代码执行模型不适合客户交付物） |
| NL4DV / Data Formulator | NL → 结构化 JSON（Vega-Lite）/ 分支式探索 UX | — | 活跃 | reference（08 §8.6） |
| AntV **Sive** | 托管 SaaS 加 API key | 不可以 | 2026-08 | avoid |

### 6.2 中文从业者的共识："AI 只做填空题"

- **"零幻觉交付：如何构建一个高可用 AI 图表生成组件"**（掘金 2026-02，https://juejin.cn/post/7603581886148935734）：
  1. **最小契约**：LLM 只给 `data` 和 `chartType`，颜色、坐标轴、图例都用前端默认值。
  2. **代码兜底**：注入默认模板，修复 JSON，确保"至少能渲染"。
  3. 模型不可能知道的东西走 MCP 工具（例如 `get_vchart_schema`），服务端校验。
  4. **伪流式**：先完整缓冲 LLM 的输出，JSON 一完整就在屏幕外渲染图表；文字用打字机效果呈现，到锚点时再显示预渲染好的图，避免闪烁和解析残缺的 JSON。
- **"AI 文字信息图表的技术选型"**（掘金 2025-12，https://juejin.cn/post/7578793960626536474）比较了四条路线：

  | 路线 | 评价 |
  |---|---|
  | Mermaid | 准确但偏技术，2.7 MB |
  | AI 直接写 HTML/SVG | 有"AI 味"，不可控，文字容易重叠 |
  | 多模态生图 | 好看，但不能编辑、不能交互、成本高 |
  | AntV Infographic | 开源、模板化、可编辑 |

  它的推荐是 Infographic + Mermaid。
- **echarts-mcp 的 README**：让 LLM 写完整 ECharts option 不稳定，冷门 series 尤其如此。应该只要最小参数，主题固定在应用里。

### 6.3 落到 ReportKit（与 `docs/roadmap-step2.md` §4.6、§5 一致）

1. **block spec 是中枢。** LLM 只输出我们自己的 block JSON spec，即 `component`、`data`、`encode`、`options`。spec 先经过 JSON Schema 校验和修复，再交给确定性的 `kit/core` 编译；**绝不让 LLM 直接写 ECharts option**。
2. **数据层对齐 VSeed 的形状**：`dimensions[]` 和 `measures[]` 各带 `id`、`label`、`format`、`unit`、`parentId`。这和我们 dataset 的 `schema.fields`（`format`、`unit`）已经很接近，只需要再补上 `role`（维度 / 度量）和分组。
3. **叙事文本用 T8 式的行内实体**，让 LLM 写出的数字和数据绑定，见 §3 的 T8 行。
4. **流式渲染用 GPT-Vis 和"伪流式"的思路**：将来可以写一个 ```` ```vis ```` → block spec 的转换器。
5. **chart lint**：合并 AVA 的思路、飞书指南的规则（§7.4）和 data-to-viz 的 caveat，校验自动生成的图表。
6. **任何把数据发到云端渲染的工具都不用**：mcp-server-chart 默认配置、chart-visualization 技能、echarts-mcp、Sive。

---

## 7. 中文设计圈在推荐什么

> **再次说明：小红书没有一手数据。** 以下来自掘金的搜索元数据（标题、日期、阅读和收藏数）和约 12 篇正文、搜狗微信的标题和摘要、CSDN 标题、知乎标题，以及官方设计指南（06 §10）。

### 7.1 常青的"宝藏"清单（收藏数高）

| 文章 | 数据 |
|---|---|
| "全网echarts案例资源大总结和echarts的高效使用技巧" | 掘金 2022，9.9 万阅读，1898 收藏 |
| "推荐一些有趣实用的前端可视化工具库" | 掘金 2021，3.1 万阅读，793 收藏 |
| "VTable——不只是高性能的多维数据分析表格" | 3.9 万阅读，584 收藏 |
| "从0到1开发可视化数据大屏（上）" | 3 万阅读 |
| "推荐几个数据大屏可视化开发工具" | 3.3 万阅读 |

### 7.2 中文列表文的典型推荐栈（2024–2026）

| 推荐项 | 列表文里的说法 | 我们的处理 |
|---|---|---|
| ECharts | 默认首选，"图表最全、社区最大" | **adopt** |
| AntV G2 / G6 / X6 / L7 | "颜值高"，Ant Design 用户常用 | reference；S2 可以考虑 |
| VChart / VTable | 较新，主打"叙事"和"高性能表格" | reference；VTable 可以考虑 |
| DataV | 大屏边框 | avoid |
| Three.js | 3D 和数字孪生 | avoid |
| D3 | 定制 | 必要时才用 |
| BI 应用：DataEase、Superset、Metabase、DataGear | — | 不相关，有的是 GPL |

### 7.3 2025–26 年的热点与风格趋势

**热点：**
- MCP 图表服务，例如"推荐一款宝藏MCP Server—mcp-server-chart"。
- **Agent Skills**，例如"AI Skills：前端新的效率神器"，2026-01，**7.3 万阅读**。
- Infographic，例如"一个可以补充 Mermaid 的可视化组件库 Infographic"。
- "AI 问数"（text-to-SQL 加图表）。

**风格（从标题看）：**
- 例子：
  - "CSS Glassmorphism … 暗色霓虹风格大数据看板"（2026-07），配色是 `#00f5d4 #00bbf9 #9b5de5 #f15bb5`，背景 `#0a0e1a`。
  - "赛博朋克风"。
  - "ECharts环形图进阶技巧：用 LinearGradient 打造高级感图表"。
- 结论：**这个圈子里的"高级感"多半等于深色 + 渐变 + 发光，正好和投行风格相反。**

**反向信号（和投行风格一致的少数派）：**
- CSDN"别再乱用饼图了！ECharts高级配色方案与业务场景匹配指南"（2026-03）。
- "ECharts图表美化实战：用markArea+markLine组合打造专业级数据报告样式"（2026-05）。markArea 和 markLine 正是投行的标注词汇。
- 图表兔（微信）"你看到的每一张图表，都可能在偷偷骗你"（2026-10），讲截断坐标轴之类的误导手法，可以作为我们断轴策略的佐证。

**中文投行相关内容：**
- CSDN 上有 AI 生成的 Anthropic `financial-services` 插件教程。
- 有人提到 "Kun" PPT 设计系统里的"蜂蜜橙投行备忘录风格"等。**没有找到它的仓库，未核实。**
- 最有价值的相邻发现是 **tw93/Kami**（MIT，12k★），一套文档设计系统，带 "Equity Report" 模板：
  - 纸面底色 `#f5f4ed`（不用纯白），单一墨蓝点缀色 `#1B365D`，其余一律暖灰；
  - 衬线字体主导层级；
  - "No gradients, no drop shadows, no 3D"。
  - ⚠ 它的中文衬线字体"仓耳今楷"**仅限个人使用**。

### 7.4 和投行兼容的中文设计规范（可以直接做成 lint）

**飞书数据可视化设计指南**（https://open.feishu.cn/document/design-specification/data-visualization/data-visualization-design-guide?lang=zh-CN）：
- 类别色按固定顺序使用；单系列只用第 1 色。
- 涨跌用发散色板。
- **折线不超过 5 条；饼图 / 环形图少于 9 类；漏斗不超过 12 步；面积图不超过 3 个图例项。**
- **只有单位不同时才用双 Y 轴。**
- 桌面端图例放底部居中；只有一个系列时隐藏图例。
- 空间不够时的优先级：图形 > 图例 > 坐标轴 > 网格线。
- 避免旋转标签；高度超过容器 30% 时截断。

**Canva CN 咨询报告图表**（https://www.canva.cn/learn/consult-report-graphic-design/）："麦肯锡出品的研究报告内的图表通常是不同深浅的黑色和蓝色"，最亮的颜色留给要强调的数据。这与 kit 的 navy 主题加单一强调色的做法一致。

---

## 8. 风格判断：哪些适合投行客户报告

| 中文常见做法 | 投行客户报告？ | 理由和替代方案 | kit 现状 |
|---|---|---|---|
| 深色或深蓝大屏背景（`#0a0e1a`、`#001529`） | ❌（屏幕演示时可选） | pitchbook 要打印和转 PDF | `ink` 暗色主题只用于屏幕，打印时 `print.css` 强制换回纸面色 ✓ |
| 霓虹青 / 品红、`box-shadow` 发光、柱子渐变 | ❌ | 降低精度，打印发灰，像消费科技产品 | 不用；`design-system.md` §3.2 第 8 条明令禁止 ✓ |
| 毛玻璃（`backdrop-filter: blur`） | ❌ | 对比度差，打印没有对应效果 | 不用 ✓ |
| DataV 式动画科技边框、角标装饰 | ❌ | 图表垃圾（chart junk） | 改用 kicker、action title、细分隔线、"Exhibit N" ✓ |
| 3D 柱 / 3D 饼 / 地球（echarts-gl） | ❌ | 扭曲数值大小 | 没有 vendor echarts-gl ✓ |
| 地图飞线、旋转雷达环、粒子背景 | ❌ | 纯装饰 | `flow-map` 以静态弧线为主，线宽编码金额；**流动光点由 `animate` 控制，默认开启**，打印和 reduced-motion 时自动关闭 ◐ |
| 水球图、速度表仪表盘 | ❌（极少数情况可以） | 数据墨水比低 | 用 `bullet` 或 `kpi-tiles`（带变化值和迷你线） ✓ |
| 词云 | ❌ | 不精确 | 用排序条形图 ✓ |
| 1920 × 1080 等比缩放（autofit.js） | ❌ | 破坏重排、打印和无障碍 | 12 栅格加打印页面尺寸 ✓ |
| 自动滚动表格（轮播表）、自动轮播 tooltip | ❌ | 阅读节奏应该由读者控制 | Tabulator 可排序、分页 ✓ |
| 马卡龙、莫兰迪、手绘风（小红书流行；"cute chart" 如 chart.xkcd、cutecharts） | ❌ | 显得不严肃、不精确 | 不用。06 §9 没有找到叫 "Kitten" 的图表库 |
| **数字翻牌器、count-up** | ✅（克制使用） | 只在首次进入视野时播放，≤ 600 ms，用等宽数字；打印和 reduced-motion 时关闭 | `kpi-tiles` 的 `countUp` ✓ |
| **跨图联动高亮** | ✅ | 交叉筛选是硬需求；高亮色就是强调色 | `RK.store` 的交叉筛选 ✓ |
| **叙事布局**（自上而下、自左而右） | ✅ | 和 pitchbook 的"标题 → 图表 → 脚注"一致 | 页面契约 ✓ |
| **标注体系**（markLine / markArea / markPoint） | ✅ | 目标值、一致预期、LTM/NTM 区间、事件线、CAGR 箭头 | `line`、`combo`、`multiple-history` ✓ |
| **叙事实体**（T8） | ✅ | 正文里的数字统一格式、统一正负语义 | `text-block` 的 `{{字段\|格式}}` 占位符 ◐（还没有实体类型和正负着色） |
| **主题 token、运行时换肤** | ✅ | 一套 token 生成多种变体 | `RK.theme.set()`，4 个主题 ✓ |
| **矩阵布局、小多图** | ✅ | think-cell 式同业面板 | `small-multiples` ✓ |
| **断轴** | ⚠️ | 必须显示断轴标记并加注释；否则用对数轴或拆成两个面板 | `waterfall` 的 `axisBreak` ◐ |
| **带小计的透视表**（S2 / VTable） | ✅ | 板块财务、交叉表 | 自研 `pivot-table` ◐；重度需求时用 S2 / VTable |
| **"竞速"动画、player** | ⚠️ 可选 | 只能作为时间序列上手动点击的"播放"控件，绝不自动播放 | `bubble` 的 `timeField` 播放 ◐ |
| **红涨绿跌** | ⚠️ 看地区 | 默认西方惯例，按客户地区切换 | 组件读 `--rk-pos` / `--rk-neg` ✓；`updown="cn"` 一键切换 ✓ |

---

## 9. 中国地图合规：审图号、DataV GeoAtlas、tile-grid 方格图

### 9.1 规则要点（02 §6.3）

- 依据《地图管理条例》（2015）和《地图审核管理规定》（2017，2019 年修订），**公开展示的地图需要送审，取得审图号**。
- 直接使用自然资源部提供、已带审图号的公益性地图，不需要重新送审。标准地图服务（http://bzdt.ch.mnr.gov.cn/）可以免费下载，原样使用时要标注审图号。**任何对地图内容的修改，"包括放大、缩小或裁剪"，都要先审核才能公开使用。**
  - 来源：https://cn.chinadaily.com.cn/a/202308/28/WS64ec4ceba3109d7585e4b1e1.html 、https://www.news.cn/politics/2023-08/29/c_1129831410.htm 、规定原文转录 https://www.163.com/dy/article/EO8EAICG05366JV6.html
- **"问题地图"** 指漏画台湾、漏画南海诸岛或九段线、藏南或阿克赛钦按实控线画等情况。对服务中国客户的银行来说，这既是法律风险，也是声誉风险。
- 旁证：微软已对中国区 Excel 用户暂停 2D 地图图表和 3D 地图，"no available workaround"（https://support.microsoft.com/en-us/Support/known-issues/excel-2d-map-charts-and-3d-maps-are-suspended-for-china）。
- ⚠ 以上依据是新闻报道和规定原文转录，**法律细节没有经过律师确认，要提交合规评审**。

### 9.2 数据源与许可

| 数据源 | 许可或条款 | 合规性 | Verdict |
|---|---|---|---|
| **DataV.GeoAtlas**（阿里云，数据来自高德）：几乎所有 ECharts 中国地图教程都用它 | "数据来自高德开放平台，**仅供学习和交流使用**"；版权问题找高德（https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/） | 边界是中国口径的，但**没有商业再分发许可** | **avoid**。交付物里不用；运行时也绝不从 `geo.datav.aliyun.com` 拉数据（那是在线接口） |
| Natural Earth admin-0 中国视角版（`ne_10m_admin_0_countries_chn`）+ admin-1 | public domain | 国家轮廓和九段线是中国视角；但 admin-1 是实控口径（台湾不属 CHN，藏南属印度），**不等于审过的标准地图** | 面向**全球受众**时可以考虑；不能用于中国境内的公开展示 |
| 标准地图（自然资源部） | 免费；原样使用要标审图号 | 原样使用就合规 | 面向中国受众且不需要交互时，作为**静态图片**（PNG/SVG）使用 |
| geoBoundaries | CC BY 4.0 | 采用美国国务院的争议地区口径，不符合中国口径 | 只用于中国以外地区的 admin-1 |
| GADM | 禁止未经许可的商业使用和再分发 | — | **avoid** |
| `@surbowl/world-geo-json-zh` 2.1.5 | Unlicense | 参照标准地图 GS(2023)2767 **和 DataV** 调整过 | reference（混入了 DataV 来源） |
| china-map-echarts、echarts-china-provinces-js、china-geojson | 包本身是宽松许可，但**上游数据来源不明**（很可能来自 DataV / 高德） | — | avoid，除非能说清来源 |
| `province-city-china` 9.0.0 | MIT | 只有 GB/T 2260 行政区划代码，没有几何 | **adopt**，做代码和名称的关联 |

**别漏掉世界地图。** kit 的 `choropleth`、`bubble-map` 等组件用的是 `vendor/geo-world/world-110m.js`：
- 它来自 world-atlas，即 Natural Earth 4.1.0 的默认实控口径。台湾是一个单独的要素。
- 面向中国境内的公开交付物时，**世界地图同样属于"地图"**。
- 02 §10.2 建议另外发布一份 `world-cn`（中国视角）底图。但它仍然**没有经过审核**。

### 9.3 替代方案：tile-grid 方格图（compliance-safe 的设计）

**思路：** 每个省级行政区画成一个等大的方块或六边形，按大致地理位置排成网格，**不画任何边界线**。

**优点：**
- 不画边界，几何上就不会画错。
- 每个省视觉权重相同，避免面积偏差：在普通地图上，新疆、西藏、内蒙古的面积会压过上海。这本身就是 pitchbook 友好的做法。

**必须满足：**
- 包含**台湾、香港、澳门**三个方块。
- 可以选择加一条南海诸岛的说明。

**kit 现状：**
- `china-tilemap` 已进 kit：`kit/components/china-tilemap/` 有 JS 和 `manifest.json`（category `geo`，引擎 ECharts），已收入 `kit/catalog.json`、`docs/component-catalog.md` 和 gallery。
- 已实现的部分：
  - 34 个省级行政区排成 7 × 8 网格。布局是自研的：按省份质心经纬度排布再压缩，并与 geofacet 的 `china_prov_grid1`（MIT）交叉核对过。台湾放在福建东侧，中间隔一个空格作为"海峡"；70 条省际陆地边界中有 63 条保留为相邻方块；
  - 可以按 GB/T 2260 adcode、中英文名称或 ISO 3166-2:CN 关联数据；
  - 方块或六边形两种形状；支持顺序色、发散色、分档图例、交叉筛选。
- 示例数据 `kit/samples/datasets/china_provinces.json`（34 行，合成数据）已经就绪。
- ⚠ 组件的文件头注释写着"no 审图号 needed in client decks"，manifest 的 `summary_zh` 和 `best_for` 里也有"无需审图号"的说法。这是**工程上的设计意图，不是法律结论**。上线前仍要合规确认（02 §6.3 (d)）。

### 9.4 按受众选方案

| 受众 | 推荐方案 | 组件 / 数据 |
|---|---|---|
| 全球或海外客户，只看中国以外 | 正常用世界底图（实控口径，public domain） | `choropleth`、`bubble-map` 等加 `world-110m` |
| 全球客户，含中国省级数据 | 首选 tile-grid；也可以用 NE admin-1 中国省级加等面积投影（manifest 标注 `compliance: "de facto / not PRC-reviewed"`） | `china-tilemap`；计划中的 `china-map`（ECharts 加 d3 Albers，02 §10.3） |
| **中国境内客户或中国境内公开展示** | ① **tile-grid 方格图**（首选，可交互）；② 标准地图**原样**作为静态图片，并标审图号；③ 已取得授权或审核的底图作为数据文件放进来，审图号自动渲染到脚注 | `china-tilemap`；静态图片块；底图 manifest 的合规字段 |
| 不确定 | 不画地图，改用省级排序条形图或表格 | `bar`、`league-table` |

**底图 manifest 的合规元数据**（02 §10.8，还没实现）：
- `worldview`（例如 `"default"` 或 `"chn"`）
- `source`、`licence`、`attribution`
- `prc_reviewed: false`
- 可选的 `审图号` 字符串，由 kit 自动渲染到 `rk-block__foot` 脚注里
- builder 检测到 `report.locale = zh-CN` 且用了未审底图时，应当发出警告

---

## 10. 安全：AntV npm 供应链投毒（2026-05-19）

- **事件经过：**
  - "Mini Shai-Hulud" 蠕虫通过被攻破的维护者账号 `atool`（`@antv/*` 的发布者，也是 echarts-for-react、size-sensor、timeago.js 的作者）作案。
  - 约 22 分钟内，在 317–324 个包上发布了 637–639 个恶意版本。
  - **恶意版本号刻意高于真实最新版**，例如 `@antv/g2` 5.5.8 / 5.6.8，而真实最新是 5.4.8。所以任何 `^` 范围都会被拉到恶意版本。
- **载荷：**
  - 通过 `preinstall` / `postinstall` / `prepare` 钩子执行 `bun run index.js`。
  - 窃取 CI 密钥、云凭据、钱包。
  - 在 `.claude/setup.mjs`、`.vscode/setup.mjs`、`.claude/settings.json` 里植入持久化代码，并自我传播。
- **现状：**
  - 06 当日核实，这些恶意版本在 npm 上已返回 E404。
  - `echarts` 本体不受影响（Apache 发布流程，发布者不同）。
  - VisActor 不在受影响名单里。
  - 攻击发生在**安装时**，UMD `dist/` 文件没有报告被篡改。
- **来源：** https://www.stepsecurity.io/blog/shai-hulud-here-we-go-again-mass-npm-supply-chain-attack-hits-the-antv-ecosystem 、https://security.snyk.io/antv-supply-chain-compromise-may-2026 、https://snyk.io/blog/mini-shai-hulud-antv-npm-supply-chain-attack/ 、https://www.infoworld.com/article/4173277/antv-data-visualization-tool-the-latest-to-be-hit-by-ongoing-npm-supply-chain-attacks.html 、https://orca.security/resources/blog/antv-npm-supply-chain-attack/

**对 kit 的含义：**

| 规则 | 现状 |
|---|---|
| 只用精确版本，不用 `^` | ✓ `vendor/vendor.json` 全部是精确版本 |
| 用 `npm pack` 取 tarball，不跑生命周期脚本 | ✓ `tools/vendor.py` 用 `npm pack --ignore-scripts` 下载，再用 `tarfile` 解压（`filter="data"`），不执行 install 钩子 |
| 记录 `dist.integrity`（sha512），并逐文件记 sha256；`vendor.py --check` 时校验 | ✓ 已实现：`--check` 校验每个文件的 sha256，`--rehash` 重新记录；重新获取时 integrity 不符即报错 |
| 不在存有云凭据的开发机上 `npm install` 任何 `@antv/*` 包 | 流程约定，写进 `vendor/LICENSES.md` 或 SECURITY 说明 |
| 如果要 vendor S2 或 T8，只用投毒窗口之前或清理之后发布的版本，并和 jsDelivr 的哈希比对 | 引入时执行 |

---

## 11. 中文交付物细节：字体、数字单位、涨跌色

| 话题 | 建议 | kit 现状 |
|---|---|---|
| **中文字体** | Noto Sans SC / 思源黑体（**OFL-1.1**）。完整 CJK 字体每个字重约 8–16 MB，所以由 builder 用 `fonttools pyftsubset` 按报告实际用字做子集化，或者用 GB2312 一级 3500 字的子集（约 1–2 MB）。标题用衬线体时选 Noto Serif SC（OFL） | 目前回退到系统字体（PingFang、YaHei），子集化是 P3（`docs/design-system.md` §2.1 和 §10 第 8 项） |
| 避免的字体 | 霞鹜文楷、得意黑（OFL，但太花哨）；阿里巴巴普惠体、HarmonyOS Sans、MiSans、OPPO Sans（厂商自定义许可，需要法务审核）；仓耳今楷（**仅限个人使用**） | 不用 |
| **万 / 亿** | 中文财报常用"亿元"，西方投行用 mm / bn。同一份报告只用一套。`Intl.NumberFormat('zh-CN', {notation:'compact'})` 可以输出万 / 亿 | ✓ `Report(locale="zh-CN")` 时 `auto` 自动用 亿 / 万（`1.5e9` → `15亿`）；页面自定义的 `RK.format.config.compactUnits` 不被覆盖 |
| **红涨绿跌** | 默认西方惯例；中国客户对调 `--rk-pos` 和 `--rk-neg`，组件不用改 | ✓ `Report(updown="cn")` → `<html data-rk-updown="cn">`，换主题后仍有效；不需要单独的主题变体 |
| **界面文字** | 工具栏、筛选提示、导出、查询控制台等全部中文化 | ✓ `RK.i18n` 内置 zh-CN 包；组件可 `RK.i18n.add('zh-CN', {...})` 补充。保密声明需在 `Report(confidentiality=…)` 中写中文 |
| 日期 | `yyyy"年"m"月"d"日"` | ✓ |

---

## 12. 具体建议（按优先级）

| 优先级 | 动作 | 落点 | 依据 |
|---|---|---|---|
| **P0** | 交付物里禁用 DataV.GeoAtlas 和任何来源不明的中国 GeoJSON；运行时禁止访问 `geo.datav.aliyun.com`。`tools/smoke.cjs` 目前只记录 `requestfailed`，建议加一条断言：拦截所有外部请求，出现任何外连即判失败 | 规范加测试 | §9.2 |
| **P0** | 中国境内交付物的地图一律走 §9.4 的决策表；上线前由合规签字 | 流程 | §9.1 |
| **P1** | `china-tilemap`：manifest（category `geo`）和 `china_provinces` 样例已进 catalog ✓。还没做的：manifest 加 `refs.ft: "Spatial:equalised-cartogram"`；文件头、manifest 的 `summary_zh` / `best_for` 里"无需审图号"的说法改成"设计意图，须合规确认" | `kit/components/china-tilemap/` | §9.3 |
| **P1** | vendor `@echarts-x/custom-bar-range` 1.2.1、`custom-line-range` 1.1.1、`custom-violin` 1.1.1。`football-field` 改用 bar-range；`line` 加 `band`（fan chart）；`boxplot` 或 `beeswarm` 加 violin 变体 | `vendor/vendor.json`、对应组件 | §2.2 |
| ~~P1~~ ✅ | `vendor.json` 增加 `integrity`（npm `dist.integrity`）和逐文件 sha256，`vendor.py --check` 校验——已实现。仍可做：在 `vendor/LICENSES.md` 记下 AntV 事件和"只 pack、不 install"的约定 | `tools/vendor.py` | §10 |
| **P1** | 底图 manifest 增加合规元数据（`worldview`、`prc_reviewed`、`审图号`），审图号自动渲染到脚注；builder 在 zh-CN 报告用了未审底图时发出警告 | `kit/core/rk.geo.js`、`py/reportkit` | §9.4 |
| ~~P2~~ ✅ | 中国客户变体：对调 `--rk-pos` / `--rk-neg`（实现为 `updown="cn"`，不是单独主题）；`zh-CN` 紧凑单位（万 / 亿）随 `report.locale` 切换——均已实现 | `kit/core/rk.theme.js`、`kit/core/rk.format.js` | §11 |
| **P2** | `text-block` 支持 T8 式行内实体：`metric_value`、`delta_value`、`ratio`、`trend` 等约 10 种类型，带正负着色和数据溯源。优先自研约 150 行；如果 vendor T8 0.3.1，必须核对哈希 | `kit/components/text-block/` | §3、§6.3 |
| **P2** | Step 2 的 block spec 对齐 VSeed 的 `dimensions` / `measures`（加 `role` 和 `parentId`）；chart lint 合并飞书规则、AVA 思路和 data-to-viz caveat | `docs/roadmap-step2.md` §4.6 | §6.3、§7.4 |
| **P3** | 透视需求出现时，用同一份数据给 S2 2.7.2 和 VTable 1.26.8 各做一个原型，懒加载，比较体积、打印效果和小计能力 | 新组件 `pivot-pro` | §3、§4 |
| **P3** | 中文报告的字体子集化：builder 用 `pyftsubset` 生成 Noto Sans SC 子集 | `py/reportkit` | §11 |
| **不做** | VMind（停更）、VStory（pre-alpha）、GPT-Vis 和 Infographic 当运行时依赖（体积大、要从 CDN 拉资源、命名空间被投毒过）、L7（在线底图）、DataV 和大屏模板（风格不合适、没有许可）、DataEase 和 SQLBot（GPL）、Sive（SaaS）、echarts-gl 3D、任何云端渲染的 MCP 或技能 | — | §3–§6 |

---

## 附：来源索引

- 主笔记：`research/raw/06-china-xhs.md` 全文，含 §16 来源清单。
- 地图合规：`research/raw/02-geo-maps.md` §0.7–0.8、§6.3、§7.4、§10。
- AI 和 Step 2：`research/raw/08-query-ai.md` §8.5–8.6、§9；`research/raw/07-collections.md` §7；`docs/roadmap-step2.md` §4.6、§5。
- kit 现状：`vendor/vendor.json`、`kit/catalog.json`、`docs/design-system.md`（中文字体、红涨绿跌、大屏禁用、万 / 亿）、`kit/components/china-tilemap/`（`china-tilemap.js` + `manifest.json`）。
- 相关合集与画廊：`research/awesome-collections.md`。
