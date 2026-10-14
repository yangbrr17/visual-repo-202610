# 04 · Pitchbook / IB 视觉规范与图表分类（raw notes）

> Angle: `04-pitchbook-design` · 调研日期 2026-10-14 · 作者：research subagent
> 方法：(1) 一手证据：从 SEC EDGAR 下载 2023–2026 年各家投行提交的 fairness / special-committee
> "Discussion Materials"（Schedule 13E-3 附件 EX-99.(c)），逐页看图并抽取颜色/版式/数字格式；
> (2) 二手资料：think-cell 产品与手册、FT Visual Vocabulary、Anthropic `financial-services`
> 插件（Apache-2.0）里的 pitch-deck / comps / DCF / LBO 格式规范、行业培训站点；
> (3) 用 `npm view` + jsdelivr 核实每个候选库的版本、许可证、UMD 文件和 gzip 体积；
> (4) 用 dataviz skill 的 `validate_palette.js` 跑分验证 3 套主题色板（light + dark）。
>
> 重要约束复述：离线 file:// 打开 → 只能用 classic `<script>`（UMD/IIFE），不能 ES module、不能 fetch 本地 JSON；
> 只用 MIT/BSD/Apache/ISC/OFL；**不使用任何银行 logo/商标/品牌色原值**，只做 "inspired-by"。

---

## 0. TL;DR（给主 agent 的 12 条结论）

1. **页面比例**：美国投行 deck 实测几乎都是 **US Letter 横向 11×8.5in（宽高比 1.294）**——GS、Morgan Stanley、Evercore 的 EDGAR 页面图都是 1.294；Rothschild 为 4:3（1.333）。**没有一家是 16:9**。HTML 报告的 "page" 容器应默认 1056×816 CSS px（Letter @96dpi），提供 A4 横向（297×210mm, 1.414）和 16:9 两个备选。
2. **页面解剖固定**：section tracker（左上小标签/页签）→ action title（一句话结论）→ subtitle / units line（"($ in millions, except per share data)"）→ navy 横幅式 chart header → 图/表 + 右侧 commentary 或 "Select data points" 侧栏 → 编号脚注 + **"Source:"/"Note:" 行** → 机密/草稿标记（"Highly Confidential", "DRAFT Preliminary – Subject to Refinement"）→ 页码（右下）。
3. **调色**：所有样本都是 **navy 主色 + 1–2 个中/浅 steel-blue + 灰 + 1 个点缀色**（GS 用红色虚线标 offer price；Rothschild 用 gold/tan 与 claret；MS 用亮蓝/青绿）。单页颜色 ≤ 4–5 种，"语义强调"多于 "分类"。
4. **我们给出 3 套主题（navy / bronze / slate）**，每套含结构色 token + 8 色 categorical（light & dark 均**通过** validator 全部硬门槛）+ ordinal ramp + diverging ramp，见 §4。
5. **字体**：bulge-bracket（GS/MS/Evercore）几乎全 sans（Arial 类，粗体 navy 标题）；精品投行（Rothschild 类）用 **serif 大标题 + sans 正文**。开源替代：Arimo（Arial 度量兼容, OFL）/ Tinos（Times 度量兼容）/ Source Serif 4 / Inter / IBM Plex；中文 Noto Sans SC（需子集化，单字重 3.4MB/102 个分片）。
6. **数字格式**有"house style"差异（GS：`$ 44.71`、`7.6 x`、`(0.9)%`、`05-Dec-2025`；其他：`$2.27`、`7.9x`、`(32%)`、`Apr '24`），所以 kit 的格式层必须**可配置 house style**，而不是写死。负数一律括号；缺失 `n.a.`/`NA`，无意义 `n.m.`/`NM`，零或不适用 `–`。
7. **"首行带单位"规则**：表格里只有第一行和合计行带 `$`/`x`/`%`，中间行只给数字（GS DCF、AVP 页实证）。这是 IB 表格"高级感"的关键细节，kit 需要支持 `unitOn: 'first|total|all'`。
8. **图表 canon（P0）**：football field、股价+成交量+事件标注、indexed 相对表现、comps/precedents 表（含 Max/75th/Median/Mean/25th/Min 统计行）、sensitivity grid、waterfall/bridge、analysis at various prices、premiums paid、历史倍数（含 "% of time in range"）、财务摘要表、think-cell 式柱图（CAGR 箭头/差值箭头/value line/总计）。完整 34 个组件清单见 §8。
9. **引擎选择**：ECharts 6.1（已 vendored，Apache-2.0）覆盖 ~85% canon；v6 新增 **axis break、matrix 坐标系、chord、beeswarm/jitter、动态 setTheme/暗色**，官方 `@echarts-x/custom-bar-range`（Apache-2.0, 1.8KB, 有 `.auto.min.js` classic 版本）可直接画 football field。表格用原生 HTML table（sensitivity/comps 必须可复制到 Excel），重交互表可选 Tabulator 6.6（MIT, UMD）。统计用 simple-statistics 7.12（ISC, 9KB gz）。
10. **许可证雷区（2026 新变化）**：**ApexCharts 8.x 已改为按营收门槛的双许可（年收入 ≥ $2M 必须买商业版）→ 投行 = avoid**；**MapLibre GL 6.x 只发 `.mjs`（ESM-only）→ file:// 不可用**（最后 UMD 是 5.24.0）；lightweight-charts 要求 NOTICE + tradingview.com 链接；GSAP 3.15 是非 OSI "Standard no charge license"。
11. **think-cell 的灵魂不是图型而是"装饰层"**：CAGR arrows、level/difference arrows、value lines、totals、axis breaks、"Other" 归并、**rounding 一致性（TCROUND：四舍五入后部分之和=总计）**、自动黑白文字对比。kit 应做成可复用的 decoration plugins。
12. **dual-axis 冲突**：IB 惯例常用双 y 轴（股价+成交量 / 股价+EV/NTM EBITDA），dataviz 最佳实践禁止双轴。建议默认 **上下堆叠 pane 共享 x 轴（ECharts multi-grid + 联动 dataZoom）**，`dualAxis:true` 作为 house-style 兼容选项。

---

## 1. 一手证据：EDGAR 上的真实银行 "Discussion Materials"

Schedule 13E-3（going-private）要求把给特别委员会的银行材料作为 EX-99.(c) 公开，因此是**最权威、最新的真实 pitchbook 样本**。
EDGAR 全文搜索可用：`https://efts.sec.gov/LATEST/search-index?q=...`（需要带 User-Agent），页面图在同目录 `*.jpg`。

| 银行 | 交易/项目 | 日期 | URL | 看了哪些页 |
|---|---|---|---|---|
| Goldman Sachs | Janus Henderson "Project Jewel" | 2025-12 | https://www.sec.gov/Archives/edgar/data/1274173/000110465926008735/tm2534023d8_ex99-civ.htm | 股价表现、历史倍数、football field、AVP、DCF、precedents |
| Goldman Sachs | Thoughtworks (Apax) | 2024-05 | https://www.sec.gov/Archives/edgar/data/1866550/000121390024085645/ea021234402ex99-cxxi_thoug.htm | 文本 |
| Morgan Stanley | Avangrid "Considerations" | 2024-02 | https://www.sec.gov/Archives/edgar/data/1634997/000119312524165806/d842696dex99c10.htm | indexed 股价表现、Transaction impacts（accretion/dilution） |
| Evercore | EngageSmart "Project Everest" | 2023-10 | https://www.sec.gov/Archives/edgar/data/1863105/000119312523280779/d306045dex99cix.htm | Illustrative Financial Analysis Summary（football field） |
| Evercore | MFW "Project Montana" | 2011-09 | https://www.sec.gov/Archives/edgar/data/945235/000095012311097323/y05297exv99wcw6.htm | 全文结构、表头、脚注 |
| Rothschild & Co | KORE "Project Kona" | 2025-04 | https://www.sec.gov/Archives/edgar/data/1855457/000114036126014631/ny20068726x2_excii.htm | league table、bid evolution、交易表现、premiums paid、股东结构 |
| Centerview | Walgreens "Project Blazing Star" | 2024-12 | https://www.sec.gov/Archives/edgar/data/1618921/000119312525135574/d946494dex99c3.htm | 文本 |

### 1.1 逐页观察（只记录"惯例"，不复制品牌）

**GS · 股价表现页（Share Price Performance – Last 3 Years）**
- 标题 navy 粗体 sans（Arial 类）约 26–28pt，副标题同色粗体较小（"Last 3 Years"）；右上红框 "DRAFT Preliminary – Subject to Refinement"；标题下细横线。
- 图内标题居中 navy 粗体 + 下划线（"Share Price Performance & Volume Trading History"）。
- 股价：深 navy 粗线（~2px）；成交量：浅 steel-blue 面积，**右侧 secondary axis "Volume (mm)"**；y 轴标签 `$ 20 … $ 50`（$ 与数字之间有空格），x 轴 `Dec-22 / Jun-23 …`（MMM-YY，半年刻度）；**无网格线**。
- 线末端直接标注最新价 `$ 44.71`。
- 事件 callout：矩形框 + 引线，框内 "日期: 事件"（粗斜体），**按事件类型着色**（M&A Activity 中蓝紫、Earnings 浅蓝、Macro 灰），底部图例三色块。
- 左上嵌入迷你表：`3Y 1Y 6M 3M 1M` × `% Performance / Average Share Price`；以及 "Undisturbed Trading History: 52-Week High (05-Feb-2025) $45.94 / Low $29.47"。
- 底部：斜体小字 "Source: Company filings, FactSet. Note: Market data as of 05-Dec-2025. ¹ … ² … ³ …"（上标编号脚注串在一行）；右下页码带竖线。

**GS · Football field（Illustrative Summary of … Financial Analysis）**
- 三栏：左 "Methodology"（navy 填充色块、白色粗体字）｜中 "Illustrative Valuation Range"（横条，两端外侧标注 `$ 42.97` / `$ 58.15` 粗体）｜右 "Selected Commentary"（方块 bullet，"**Low:** WACC of 13.50%, PGR of 1.50%"）。
- 主方法条为 navy；"For Reference Only"（52-week range、precedent premia 52w-high、public market valuation）条用**浅 steel-blue**，左侧有竖排 "For Reference Only" 侧标签。
- **红色竖虚线**表示报价（"Trian / GC Proposal: $46.10⁵"，斜体）；横轴不显示刻度（靠两端标签表达）。
- 行间细灰分隔线。

**GS · 历史倍数页（Historical … and Peer EV / NTM EBITDA）**
- 两条线：公司（navy）vs 同业均值（steel-blue）；y 轴 `5.0 x … 9.5 x`；线末直接标注 `7.7 x` / `7.6 x`（与线同色）。
- 顶部三张小表："Average 3Y/2Y/1Y"，以及 **"% of Time Spent in Range"**（`9.0x+ / 8.5x–9.0x / … / <6.0x` 分桶 × 3Y/2Y/1Y）——这是一种很 IB 的分布表达（直方图的表格版）。
- 关键时点 callout（浅蓝底框+深边）"EV / NTM EBITDA on 24-Oct-2025 (Pre-Proposal): 7.3 x"。

**GS · DCF 页**
- 页签式 section tracker（左上 navy 梯形 tab "DCF"）。
- navy 全宽横幅 "Discounted Cash Flows Model"；列 `4Q'25E | 2026E … 2029E | Terminal`；stub 期与预测期之间**竖虚线**；Terminal 列浅灰底。
- `$` 只出现在首行与小计/合计行（`$ 225` → `(12)` → `$ 214`…），小计行粗体 + 上边线；负数括号。
- 两个 3×3 sensitivity：行 "Growth Rate"（竖排轴标题）× 列 "WACC"；**只有左上第一格带单位**（`$ 53.77` / `7.9 x`），其余裸数字。

**GS · Analysis at Various Prices（AVP）**
- 列：Metric | Value | Offer 1 | Offer 2 | Illustrative Prices `$47…$52` | 竖虚线 | TAM Peers | Precedent Transactions。
- 行组：Premium To（Undisturbed, 30-Day VWAP, 52-Week High, All-Time High, cost basis）/ Comparison to Initial Offer / Implied multiples（LTM, 2025E, 2026E EBITDA）。
- 星形标记 + 图例：在 % 变化行上用不同颜色星标标注可比交易的 "初始→最终报价涨幅" 位置（很巧妙的"表内注释"）。

**GS · Precedent M&A Transactions**：Acquirer | Target（logo）| Announced `Apr-2024` | Consideration `$ 1.0`（首行带 $）| EV / LTM EBITDA `8.9 x`；**Median 行灰底粗体**；行间细分隔线。

**Morgan Stanley · Indexed Share Price Performance**
- 黑色粗体 sans 标题 + **亮蓝副标题**；图标题亮蓝（"Indexed Share Price Performance Since … Announcement ⁽¹⁾ (%)"）。
- 3 条线（公司深蓝、Peers 亮蓝、Index 青绿），**线末直接标注区间涨跌 `(36.6%)` `(9.1%)` `(6.4%)`**，无网格线，y 轴 40–140（rebased=100）。
- **字母编号事件标记**（灰色圆角方块 A–E 放在线上）+ 右上事件表（# | Date | Description）。
- 嵌入表 `L3M SPP / L6M SPP / L12M SPP`。页脚右侧 "ADDITIONAL MATERIALS 6"（section 名 + 页码）。

**Morgan Stanley · Transaction Impacts**：蓝色表头块、行组标签为**竖排侧边色条**（"Power Delay / No Power Delay"），行头浅灰块 "$35.0p.s. Offer Price"，数值格为白底细蓝边框的独立单元（"tile table" 风格），accretion/(dilution) 用括号。

**Evercore · Illustrative Financial Analysis Summary**
- 右上斜体 "($ in millions, except per share data)"；左侧 navy/蓝色方法分组 tab（DCF: PGR / DCF: Terminal Multiple / Trading Multiples / Precedent Transactions / Reference）。
- 每行：灰色说明文字（"Disc. Rate: 12.5% - 13.5%"）→ 区间条 → 右侧 **Implied TEV、Implied FY24E EBITDA / Revenue Multiple、Impl. Prem. to Unaffected 30D VWAP** 三列。
- **多条竖虚线框注**：Unaffected 30D VWAP `$17.74`、Bid `$23.00`、Current TEV、consensus multiples（虚线边框的标签框）。
- Reference 方法用灰色条；SOTP 行条形分两段并带 icon 图例（Enterprise | SMB）。
- 页脚：左下公司 wordmark、居中页码、右侧项目名 "Project Everest"。

**Rothschild & Co · 版式**
- 左上 section label 全大写灰色小字（"2. EXECUTIVE SUMMARY" / "APPENDIX"）+ 通栏 navy 细线；**大号 serif 标题**（约 36pt）+ **sans 副标题即 action title**（"Typical takeover premiums in the range of 30%–45%"）。
- 内容块用 **navy 横幅（白色粗体）**做小标题；数据侧栏 "Select data points"（Share price / returns / VWAP 10/30/90-day / 52-week high-low / historical multiples）用粗细横线分组。
- 股价 + EV/NTM EBITDA 双轴（slate 蓝灰 + 米金色），事件为**竖向细引线 + 粗体日期 "Nov '23" + 文字**，按事件类型用 claret / navy 菱形标记；线末数值用描边框 `$2.27`、`7.9x`。
- Premiums paid：两组 5 根柱（25th / Median / Mean / 75th / 90th percentile），浅灰蓝柱+navy 描边，柱顶 `%` 标签；上方一排 **navy 实心 "chips"** 写隐含股价 `$2.73 … $4.49`。
- 股东结构：表头分组色（"Investor details" navy / "Holding" gold），行内 "Passive" 用斜体+浅灰底，`%SO 12m chg.` 列用**浅红/浅绿底**条件格式，合计行粗体上下粗线；右侧饼图（Active/Passive/Individual）。
- League table：排名 | 银行 | 数量；**本行高亮金色底**；"Source: Refinitiv / Note: Announced deals by number from 1/1/2023 to 9/30/2024"。
- Bid evolution：柱序列（Unaffected 浅灰 → 各轮报价 navy → 最终报价 gold 底 + 虚线框），中间插入"事件框"（不带柱），柱下双行表格（Premium to unaffected / to Atlas proposal），底部带箭头时间轴 "Six-month process …"。
- Footer："**Sources:** … **Notes:** 1. … 2. …"（粗体标签 + 编号列表），右下灰色页码。

### 1.2 从页面图采样的颜色（JPEG 量化，±误差，仅作"类型"参考，不用于复制）

| 来源 | navy/主色 | 中蓝 | 浅蓝/底 | 其他 |
|---|---|---|---|---|
| GS（3 页） | `#01345d` / `#1f396c` / `#1e3045` | `#7499c5` / `#759ac4` | `#ced7e7`, `#e4eef5` | 红色虚线、灰 `#6d7888` |
| Rothschild（2 页） | `#1c355d` / `#2b3e5e` | — | `#f2f2f2`, `#e8e4dc` | 米金 `#c9a464` 类, claret, teal `#5fa3ae` 类 |
| Evercore（1 页） | `#394367` | `#849ab2` | `#cbd7df`, `#f3f1f2` | 灰 `#cccccc`（reference 条） |

> 二手资料（非官方模板站）声称 "GS blue #7399c6, navy #00355f, light blue #acd4f1"——与我们采样吻合，但**属于品牌色**，kit 里不要原样使用。来源：https://slidespeak.co/slide-design-prompts/prompts/goldman-sachs-style
> Anthropic `financial-services` 插件（Apache-2.0）里 comps/DCF/LBO 默认填充：section header `#1F4E79`/`#17365D`、column header `#D9E1F2`、stats rows `#F2F2F2`、key output `#BDD7EE`；字体默认 Times New Roman 11/12pt；"只用蓝和灰，3–4 种颜色"。这是 Excel 模型惯例（也是 PPT 里粘贴表格的来源）。

---

## 2. 页面解剖（Page anatomy）→ kit 的 page 组件规范

```
┌──────────────────────────────────────────────────────────────── 1056 × 816 px (Letter landscape)
│ [Section tracker]  2. VALUATION ANALYSIS ▸ DCF            [DRAFT / Confidential stamp]  [logo slot]
│ ───────────────────────────────────────────────────────────────────────────────── (hairline, navy)
│ Action title: one sentence, ≤ 2 lines (serif 或 sans 粗体)
│ Subtitle / units line: ($ in millions, except per share data)
│ ┌[ navy banner: chart header ]────────────────┐ ┌[ navy banner: side panel ]──┐
│ │ legend row (top-left, inline)               │ │ "Select data points" table   │
│ │ chart / table body                          │ │ or "Selected commentary"     │
│ │                                              │ │ ■ bullets, bold lead-ins     │
│ └──────────────────────────────────────────────┘ └──────────────────────────────┘
│ Source: FactSet, Company filings. Market data as of 05-Dec-2025.
│ Note: ¹ … ² …                                                     PROJECT NAME │ 6
└────────────────────────────────────────────────────────────────────────────────
```

| 元素 | 规范（建议值，Letter 1056×816px 画布） | 证据 |
|---|---|---|
| Section tracker | 三种形式均需支持：(a) 左上全大写灰色小字 `2. EXECUTIVE SUMMARY`；(b) 左上 navy 梯形 tab（"DCF"）；(c) 页脚 section 名 "ADDITIONAL MATERIALS"。可选：顶部章节进度条（高亮当前章节）。12–13px，letter-spacing .04em | Rothschild / GS / MS |
| Action title | 一句话结论，≤2 行；27–37px（20–28pt）；navy 粗体 sans 或 serif regular；左对齐 | 全部 |
| Subtitle / units | 19–24px 的结论副标题，或 13–16px 的单位行 "($ in millions)"；单位行可放标题右侧斜体 | GS / Evercore / Rothschild |
| Draft/Confidential | 右上描边框 "DRAFT Preliminary – Subject to Refinement"（红）或 "Highly Confidential"（斜体灰）；也可页脚 "Strictly Confidential" | GS / Centerview / Evercore |
| Chart header banner | 全宽 navy 底 + 白色粗体 15–16px，高 24–28px；或居中粗体+下划线 | GS / Rothschild / MS |
| Side panel | 右侧 30–35% 宽：KPI 表或 commentary（方块 bullet，粗体 lead-in "**Low:** …"） | GS / Rothschild |
| Legend | 图上方一行内联（色块 + 文字），或图下方居中；≤4 系列优先直接标注线末 | 全部 |
| Footnotes | 上标数字 ¹²³ 或 (1)(2)；底部按序解释；9.5–10.5px（7–8pt）；GS 用一整段斜体，Rothschild/MS 用 "**Sources:** / **Notes:** 1. 2." 列表 | 全部 |
| Source line | 必须有，"Source:" / "Sources:" 开头，附 "Market data as of DD-MMM-YYYY" | 全部 |
| Page number | 右下 11–12px，可带竖线分隔；或居中 + 项目名在右 | GS / Evercore |
| "For reference only" | 竖排侧标签或分组 tab，配合浅色/灰色条 | GS / Evercore |
| 边距 | 左右 40–48px（≈0.45in），header 区 ~110px，footer 区 ~56px | 估算 |

HTML 实现提示：
- `.rk-page{aspect-ratio:11/8.5}`；`@page{size:11in 8.5in;margin:0}` 打印一页一张；A4 版 `@page{size:297mm 210mm}`。
- 屏幕模式：page 以 1056px 设计稿等比缩放（CSS `transform:scale` 或 container query + `cqw` 字号），保证"PowerPoint 观感"；同时提供 "reflow/responsive" 阅读模式给手机。
- 脚注编号自动化：组件声明 `footnotes:[...]`，页面收集后统一编号（避免手工 ¹²³ 错位）。

---

## 3. 排版（Typography）

### 3.1 观察
- **Bulge bracket（GS / MS / Evercore / Centerview）**：全 sans（Arial/Helvetica 类），标题粗体 navy（GS）或黑色（MS）；副标题彩色（MS 亮蓝）。
- **精品投行（Rothschild 类；Lazard/Evercore 的部分 deck 也偏 serif 标识）**：**serif 大标题 regular + sans 正文**，标题字重轻、字号大（~36pt），显得"老钱/顾问"气质。
- Excel → PPT 粘贴的表格常见 Times New Roman / Arial；Anthropic comps skill 默认 Times New Roman 11/12pt。
- 培训/论坛口碑：Garamond 被称作"banker font"（WSO 论坛，仅轶事）。https://www.wallstreetoasis.com/forum/resume/best-font-for-a-resume-which-theme-to-go-with

### 3.2 字号阶梯（pt → CSS px @96dpi，Letter 画布）

| 角色 | pt | px | 字重/样式 |
|---|---|---|---|
| Action title | 20–28 | 27–37 | sans 700 / serif 400–500 |
| Subtitle（结论句） | 14–18 | 19–24 | sans 400–600 |
| Units line | 10–12 | 13–16 | italic 或 bold |
| Banner header | 11–12 | 15–16 | 700, white on navy |
| Body / bullets | 10–12 | 13–16 | 400 |
| Table header | 9–10 | 12–13 | 700 |
| Table body | 9–10 | 12–13 | 400, `font-variant-numeric: tabular-nums lining-nums` |
| Axis labels | 8–9 | 11–12 | 400, muted |
| Data labels | 8–10 | 11–13 | 700（关键值）/ 400 |
| Footnote / Source | 7–8 | 9.5–10.5 | 400 或 italic |

（Anthropic pitch-deck skill 给出的 16:9 大画布范围：Title 40–48pt、Table body 9–11pt、Footnotes 8–9pt italic——注意它针对的是 13.33in 宽画布。）

### 3.3 开源字体推荐（全部 OFL-1.1，经 npm @fontsource 5.3.x 核实）

| 用途 | 首选 | 备选 | 说明 |
|---|---|---|---|
| "Banker sans"（PPT 一致观感） | **Arimo**（Arial 度量兼容） | Liberation Sans | 与客户 PPT/Excel 里的 Arial 换行一致；数字默认等宽 |
| 现代 sans | **Inter**（含 `tnum`, `cv11` 等） | IBM Plex Sans / Source Sans 3 / Public Sans | 屏幕可读性更好；需显式 `tabular-nums` |
| Serif 标题 | **Source Serif 4**（可变字重/opsz） | Libre Caslon Text / EB Garamond / Newsreader / Tinos（Times 度量兼容） | 精品投行风；标题用 400–600 |
| Condensed（密表格） | IBM Plex Sans Condensed | Roboto Flex（可变宽度） | comps 表 15+ 列时 |
| 中文 | **Noto Sans SC**（思源黑体同源） | Noto Serif SC / Noto Sans TC | 单字重 latin+CJK 102 个 woff2 分片共 ~3.4MB → **Python builder 必须 pyftsubset 子集化**（只保留报告实际用字） |
| Mono | IBM Plex Mono | Roboto Mono | 公式/代码输入框 |

file:// 字体坑：Firefox `security.fileuri.strict_origin_policy` 只允许加载**同目录或子目录**的字体文件 → 字体必须放在 `index.html` 同级的 `fonts/` 下（不能 `../`）；最稳是把子集化后的 woff2 **base64 内联进 CSS**。

---

## 4. 色板（Palettes）——"classic navy" + 2 个备选，全部经 validator 验证

方法：结构色（ink/banner/rule/grid/stat-row）按 IB 惯例手选并做 WCAG 对比度检查；**数据色**按 dataviz 方法：OKLCH 定 L/C/h → 枚举排列（slot1、2 固定为主题色）→ `validate_palette.js` 选 min 相邻 CVD ΔE 最大的顺序，并要求前 3 色在 `--pairs all` 下也通过（散点/气泡/地图用）。
所有 6 组（3 主题 × light/dark）**ALL CHECKS PASS**（Lightness band、Chroma ≥0.10、CVD ≥8、Normal-vision ≥15、Contrast ≥3:1）。

### 4.1 Theme A — `navy`（Classic navy pitchbook，bulge-bracket inspired）

结构 token（light）：

| token | hex | 用途 | 对比度 |
|---|---|---|---|
| `--ink` | `#0b2545` | 标题、主文本、主系列（subject） | 15.4:1 on white |
| `--banner` | `#12355f` | 横幅/表头底色（白字） | 白字 12.4:1 |
| `--navy-700` | `#1f4e79` | 次级表头、强调线 | 白字 8.7:1 |
| `--steel` | `#6f97c7` | 对比系列（peers）、reference 条 | 3.0:1 |
| `--steel-light` | `#c9d7ea` | callout 底、浅条 | — |
| `--tint` | `#e6edf6` | 高亮行、callout 填充 | ink 13.1:1 |
| `--stat-row` | `#f2f4f7` | Mean/Median 统计行底 | muted 文本需 ≥ `#5b6472` |
| `--text-2` | `#4a5568` | 次级文本 | 7.5:1 |
| `--muted` | `#6b7280` | 轴标签、脚注 | 4.8:1（白底） |
| `--rule` | `#0b2545` 1px / `#c5ccd6` 0.5px | 标题线 / 表格分隔线 | — |
| `--grid` | `#e3e7ec` | 网格线（若启用） | 1.24:1（刻意弱化） |
| `--axis` | `#9aa3ae` | 轴线/刻度 | — |
| `--accent` | `#b68028`（muted gold） | 当前公司高亮、本行 league 高亮 | 3.4:1 |
| `--ref` | `#b3261e` | Offer/Current price 参考虚线、DRAFT 章 | 6.5:1 |
| `--pos` / `--neg` | `#2e7d4f` / `#b3261e` | 表格增减（必须 + 符号/括号，不靠颜色） | — |

Categorical（8 色，**顺序固定**）：

| slot | light (#ffffff) | dark (#0f1724) | 色相 |
|---|---|---|---|
| 1 | `#2e64a6` | `#4c82c6` | pitchbook blue |
| 2 | `#b68028` | `#bd8630` | ochre/gold |
| 3 | `#9f3960` | `#b74e74` | claret |
| 4 | `#4b99c9` | `#449fc9` | sky |
| 5 | `#57873a` | `#639346` | olive |
| 6 | `#7555a8` | `#8a69be` | violet |
| 7 | `#cb5f31` | `#d5683b` | rust |
| 8 | `#008e88` | `#129d97` | teal |

Validator：light 相邻 CVD worst 12.1 / normal worst 19.5 / 全部 ≥3:1；前 3 色 all-pairs CVD 12.0 / normal 20.7。dark 相邻 CVD 12.9 / normal 17.7；前 3 色 all-pairs CVD 13.4 / normal 18.3。

Ordinal（单色 navy ramp，"IB 单色堆叠柱"首选）：`#0e2a47, #1f4e79, #3a6fa6, #6b93c4, #98b4d8`（`--ordinal` PASS：单色相 6°，ΔL ≥0.06，浅端 2.13:1）。4 阶版：`#0e2a47, #1f4e79, #3a6fa6, #6f97c7`（浅端 3.03:1）。
Sequential（热力/sensitivity 底色 7 阶）：`#e1f0ff, #c5daf5, #9fbadd, #7495be, #4b71a0, #234e82, #002b65`。
Diverging（accretion/dilution、增减；负→0→正）：`#862726, #a35954, #c48f8a, #e2c6c3, #eef0f3, #c2cfe0, #88a1c1, #5074a1, #1d4d87`。
Dark surface：`--surface:#0f1724`、`--text:#e6ebf2`（15.0:1）、`--muted:#9aa6b8`（7.3:1）、banner `#1c3a63`。

### 4.2 Theme B — `bronze`（Boutique advisory，serif 标题，暖色纸面）

结构：`--paper:#fbf9f5`（略暖白）、`--ink:#2a2118`（15.0:1）、`--banner:#3a2e22`（白字 13.2:1）、`--accent-text:#8a5a22`（5.6:1）、`--claret:#8f2c47`（7.6:1，参考线/强调）、`--rule:#cdbfa8`、`--stat-row:#f1ece3`、`--muted:#6f655a`。标题字体 Source Serif 4 400/500，正文 Arimo/Inter。

| slot | light (#fbf9f5) | dark (#16130f) |
|---|---|---|
| 1 | `#aa6926` bronze | `#bf7c3c` |
| 2 | `#37649e` slate blue | `#5382be` |
| 3 | `#8f2c47` claret | `#ac425c` |
| 4 | `#a68922` brass | `#ae912c` |
| 5 | `#008b9d` teal | `#0097aa` |
| 6 | `#cb6443` terracotta | `#d26a49` |
| 7 | `#865695` plum | `#9b6aab` |
| 8 | `#469364` sage | `#4e9c6d` |

Validator：light 相邻 CVD 12.8 / normal 18.6 / 全 ≥3:1；前 3 all-pairs CVD 14.1 / normal 17.4。dark 相邻 CVD 11.2 / normal 16.8；前 3 all-pairs CVD 13.7 / normal 16.4。
Ordinal：`#3b2a1a, #6b4a26, #9a6b35, #c49a60`（PASS，浅端 2.58:1）。Diverging：`#812a37, #9f5b60, #c19092, #e1c6c7, #eef0f3, #c1d1d8, #86a4b3, #4b788e, #0a5470`。Dark：`--surface:#16130f`、`--text:#efe9df`（15.3:1）、`--muted:#a99f90`（7.1:1）。

### 4.3 Theme C — `slate`（Modern / consulting-dashboard，冷灰 + 高饱和点缀）

结构：`--ink:#1d2733`（15.1:1）、`--banner:#24303f`（白字 13.4:1）、`--accent:#db6143`（coral, 3.6:1）、`--rule:#d5dbe3`、`--stat-row:#f3f5f8`、`--muted:#5f6b7a`。字体 Inter + IBM Plex Mono。

| slot | light (#ffffff) | dark (#111418) |
|---|---|---|
| 1 | `#3e6dc8` cobalt | `#5283e0` |
| 2 | `#db6143` coral | `#e2684a` |
| 3 | `#009783` teal | `#00a38f` |
| 4 | `#7d5abc` violet | `#926fd4` |
| 5 | `#3e9245` green | `#4b9f50` |
| 6 | `#379fc7` sky | `#39a0c9` |
| 7 | `#c38700` amber | `#c38700` |
| 8 | `#c35f92` pink | `#c96598` |

Validator：light 相邻 CVD 9.9 / normal 18.1；前 3 all-pairs CVD 9.9 / normal 18.5。dark 相邻 CVD 11.2 / normal 17.2；前 3 all-pairs CVD 11.2 / normal 17.8。
Ordinal：`#1b2533, #33475f, #52698a, #7c93b3`（PASS，浅端 3.14:1）。Diverging：`#892218, #a6584c, #c68e85, #e4c6c0, #eef0f3, #bcd3d4, #7aa8ab, #317f83, #005c62`。Dark：`--surface:#111418`、`--text:#e8ecf1`（15.6:1）、`--muted:#98a2b0`（7.2:1）。

### 4.4 IB 用色规则（适用于所有主题）
1. **"Subject vs peers" 是语义强调，不是分类**：标的公司 = `--ink`/slot1 深色，同业 = `--steel` 或灰，均值/中位数 = 虚线。不要给 15 家同业各配一色。
2. **单色 ordinal ramp 用于堆叠**（如收入按业务线），只有当类别真的无序且需要区分时才用 categorical。
3. **参考线专用色**：offer price / current price 用 `--ref`（红/claret）虚线 + 斜体标签；不与任何数据系列同色。
4. **Reference-only 方法**（52 周区间、分析师目标价）用浅色/灰色条，与主方法区分。
5. 增减色（红/绿）只用于表格 delta 列和 diverging 热力图，**必须同时用括号/符号**；单页 ≤1 个 diverging 语义。
6. **文字永远用 ink/muted token**，系列色只给标记（线、条、点）——dataviz 的 "text wears text tokens" 规则。
7. 暗色模式不是自动反色：用上表 dark 列（已在暗底上单独验证）。

---

## 5. 网格线与坐标轴（Gridlines / axes）

| 场景 | 惯例 | kit 默认 |
|---|---|---|
| 时间序列（股价/倍数） | **无水平网格线**（GS/MS/Rothschild 均无）；y 轴保留刻度标签；x 轴 MMM-YY 均匀刻度 | `splitLine:false`，`axisLine` 0.5px `--axis` |
| 柱图（think-cell 式） | **无 y 轴**、无网格，柱顶数据标签；类目轴基线一条 | `yAxis.show:false` + labels |
| 横向条（benchmark） | 无轴，条尾标注；均值/中位数竖虚线 + 标签 | markLine dashed |
| Football field | 轴通常隐藏或只在底部给少量刻度；两端标签承担数值 | `xAxis.show:'bottom-light'` |
| 散点（回归） | 可用浅网格（`--grid`），回归线 + R² 标签；坐标轴标题带单位 | `splitLine` 0.5px |
| 单位 | 轴标签带单位前后缀（`$ 50`、`9.5 x`、`40%`），或轴标题 "(%)" "($ actuals)" | 由 format preset 生成 |
| 线末标签 | 最新值直接标在线末，与线同色或描边框 | `endLabel`（ECharts） |
| 双轴 | IB 常见，但默认改为上下 pane；保留 `dualAxis` 兼容 | 见 §0-12 |
| 轴断裂 | think-cell 支持；ECharts 6 原生 `breaks` | 用于极端值柱 |

---

## 6. 数字格式（Number formatting）

### 6.1 实证到的 house style

| 维度 | GS（2025） | MS（2024） | Evercore | Rothschild（2025） | 建议默认 |
|---|---|---|---|---|---|
| 货币 | `$ 44.71`（$ 后空格） | `$35.0p.s.`、`$2.5Bn` | `$13.71` | `$2.27`、`$185m` | `$44.71`；house 选项 `currencySpace` |
| 倍数 | `7.6 x`（空格） | — | `19.1x - 27.4x` | `7.9x` | `7.6x`；选项 `multSpace`、`×` 符号 |
| 百分比负数 | `(0.9)%`、`(23)%` | `(36.6%)` | `(22.7%)` | `(32%)` | `(0.9%)`；选项 `pctParenOutside` |
| 大单位 | `$mm`、`$bn` | `MM`、`Bn` | `$ in millions` | `$m`、`c.1,400` | `m`/`bn`（欧式）；选项 `mm`/`MM`/`B` |
| 日期 | `05-Dec-2025`、`Dec-22` | `Feb-24`、`Dec-21` | `9/30/23` | `April 8, 2025`、`Apr '24`、`4/8/2025` | `dd-mmm-yyyy`（表）/`mmm-yy`（轴） |
| 缺失/无意义 | `-` | — | `NA`/`NM` | `-` | `n.a.` / `n.m.` / `–` |
| 区间 | `$ 42.97 – $ 58.15` | — | `$2,023 - $2,896` | `30%–45%` | en dash `–`，两端同格式 |
| 近似 | `~14%`、`~$13mm` | — | — | `~44%`、`c.250` | 支持 `~`/`c.` 前缀 |
| 期间后缀 | `2026E`、`2025P`、`4Q'25E`、`LTM`、`NTM`、`'22A - '24A` | `2024PF` | `FY24E`、`LFQ`、`CY2011E` | `2025E` | 列头模板 `{FY}{A|E|P|PF}` |

### 6.2 规则清单（kit 格式层必须支持）
1. **负数括号**：`(1,234.5)`；百分比 `(5.2%)`；会计对齐：正数尾部留括号宽度（Excel `_)`），保证小数点对齐。
2. **n.m.**（not meaningful）：分母 ≤ 0（负 EBITDA/EPS）、倍数超阈值（house 设置，如 EV/EBITDA > 100x、P/E > 100x 或 < 0）→ 显示 `n.m.`，并**从 mean/median 统计中剔除**，加脚注说明阈值。证据：多份 SEC 委托书将负 EBITDA 的倍数标为 not meaningful（例：https://www.sec.gov/Archives/edgar/data/0000793983/000117494712000273/b315827_defm14a.htm）。
3. **n.a.**：数据缺失（未披露）；**–**：零/不适用。三者语义不同，不能混用（Evercore 2011 样本里 NA/n.a./NM 混用，是反例）。
4. **精度**：per-share 2dp；百万级金额 0dp（或 1dp 当 < 100）；bn 1dp；倍数 1dp；百分比 1dp（增长/利润率）或 0dp（大表内）；bps 0dp；股数 mm 1dp。
5. **首行/合计行带单位**：`unitOn:'first+total'`（GS DCF、AVP、precedents 实证）。
6. **单位行**：每页/每表声明 "($ in millions, except per share data)"，数值本身不再带 m。
7. **rounding 一致性**：部分-整体标签（100% 堆叠、饼、份额表、bridge）要保证**四舍五入后各项之和 = 显示的总计**——think-cell 的 TCROUND 就是干这个（https://www.think-cell.com/en/resources/manual/excel-data-rounding，KB0028）。实现：largest-remainder（Hamilton）算法，在格式化前对一组值做调整。
8. **区间统一格式**：`19.1x – 27.4x`、`$42.97 – $58.15`；football field 两端各自格式化。
9. **中文/亚洲单位**：支持 `万/亿`（`compactUnits` 可替换为 `[[1e8,'亿'],[1e4,'万']]`），金额前缀 `RMB`/`¥`/`HK$`/`US$`。
10. **表格数字**：`font-variant-numeric: tabular-nums lining-nums;` 右对齐（或居中，Anthropic comps skill 默认居中；IB 常见右对齐/居中混用 → 按列配置）。

与现有 `kit/core/rk.format.js` 的对接建议（只提建议，不改文件）：增加 house-style 预设，如 `mult_gs:'0.0 "x"'`、`usd_ps:'$#,##0.00'`、`pct_paren_out:'0.0%;(0.0)%'`、`usd_mm:'$#,##0"mm"'`、`range` 格式器（low/high 两值 → 一串），以及 `nmRules`（分母符号、阈值）与 `roundToTotal(values, decimals)` 工具。

---

## 7. 表格惯例（Comps / Precedents / Financial summary / Sensitivity）

| 元素 | 规范 |
|---|---|
| 表头 | navy 底白字粗体（section）+ 浅蓝 `#D9E1F2` 类底黑字（列头）；多级表头（"Investor details | Holding"，"TEV / EBITDA → 2025E | 2026E"）用分组色 |
| 单位行 | 表头下方一行小字 `($m)`, `(x)`, `(%)` |
| 标的公司行 | 高亮（tint 底 + 粗体），或单列放最右/最上，或 "at market / at offer" 两行 |
| 统计行 | **Max / 75th Percentile / Mean / Median / 25th Percentile / Min**（Anthropic comps skill；GS precedents 只给 Median；Evercore 给 Mean/Median/Max/Min/High/Low）；灰底 `#F2F2F2`，与数据行之间空一行或粗线 |
| 分组 | 同业分组小标题行（"Printing / Education / …"），每组可有自己的 mean/median |
| 历史 vs 预测 | 列之间竖虚线（GS DCF）或细竖线；列头 A/E 后缀；Terminal 列灰底 |
| 小计/合计 | 粗体 + 上边线（小计单线、总计双线或粗线） |
| 条件格式 | delta 列浅红/浅绿底（Rothschild 股东表）；sensitivity 中心格（base case）高亮 `#BDD7EE` + 粗体（Anthropic DCF/LBO skill 规范） |
| 斜体 | passive/参考性行用斜体（Rothschild），margin % 行缩进斜体 |
| 行高/分隔 | 细灰分隔线（0.5px），无竖线；或隔行浅底（banding 可选） |
| Tile table | MS 风格：每格独立白底细边框 tile（适合 3×N 的影响矩阵） |
| 交互 | 排序、列显隐、按分组筛选、点击行 → 跨图高亮；**复制为 TSV 以便粘贴 Excel** |

Comps 表常用列（GS/Evercore/Anthropic 综合）：Company | Price | % of 52W High | Equity Value | Net Debt | TEV | TEV/Revenue (CY+1, CY+2) | TEV/EBITDA (CY+1, CY+2) | P/E (CY+1, CY+2) | Revenue growth | EBITDA margin | LT EPS growth (IBES) | Dividend yield。
Precedents 常用列：Date Announced | Target | Acquirer | Consideration/TEV | TEV/LTM Revenue | TEV/LTM EBITDA | Premium (1-day/4-week) | Payment (cash/stock)。

---

## 8. 组件愿望清单（Component wish-list：purpose + data fields + encoding）

字段约定（JSON，可由 Python builder 生成、将来由 API 替换）：所有组件共享 `{id, title, subtitle, units, asOf, source, notes[], footnotes[], format:{...}, theme}`；下面只列组件特有字段。优先级 P0 = 首批必做。

### P0（IB canon 核心）

**8.1 `football-field` 估值汇总**
- Purpose：把多种估值方法的区间放在同一价格轴上，配合 offer/current price 判断"公平区间"。
- Data：`methods[{id,label,group:'primary'|'reference',low,high,lowNote?,highNote?,commentary[],basis?:{metric,value,multipleRange}}]`，`refLines[{label,value,style:'dashed',role:'offer'|'current'|'unaffected'|'vwap'}]`，`axis:{unit:'USD/share'|'EV $m',min?,max?}`，可选右侧列 `impliedColumns[{key:'tev'|'multiple'|'premium',label,format}]`（Evercore 风格）。
- Encoding：y=方法（类目，分组 tab），x=价格；条=low→high（primary=`--ink`/navy，reference=`--steel`/灰）；两端外侧数值标签；竖虚线=参考价（`--ref`）；左侧方法名 navy 底白字块；右侧 commentary bullets；SOTP 可分段着色。
- Interaction：hover 显示假设（WACC/PGR/倍数区间）；拖动 offer price 线 → 实时重算右侧 premium 列；方法显隐。
- 实现：ECharts `@echarts-x/custom-bar-range` 或 `bar` 堆叠（透明底 + 区间段）；左右栏用 HTML grid 而非画在 canvas 里。

**8.2 `price-volume-events` 股价 + 成交量 + 事件**
- Data：`series[{date,close,volume,vwap?}]`，`events[{date,label,category:'mna'|'earnings'|'macro'|'other',text,anchor:'line'|'top'}]`，`refLines[{label,value,role}]`，`stats{perf:{'1M','3M','6M','1Y','3Y'},avgPrice:{...},high52w:{value,date},low52w:{value,date},vwap:{'10d','30d','90d'}}`，`undisturbedDate?`。
- Encoding：主 pane 线（`--ink` 2px）；下 pane 成交量柱/面积（`--steel` 低不透明度），共享 x；事件 = (a) 字母徽标 + 事件表（MS），(b) 带引线 callout 框按 category 着色（GS），(c) 竖引线 + 日期粗体（Rothschild）三种 style；线末 `endLabel` 最新价；undisturbed 日期竖线；offer 水平虚线；左上/右侧 KPI 迷你表。
- Interaction：时间范围预设（1M/3M/6M/1Y/3Y/5Y/Since unaffected/Max）+ dataZoom 刷选；事件 hover；crosshair tooltip（价、量、相对 unaffected 涨幅）；与 `indexed-performance`、`multiple-history` 联动缩放（`echarts.connect`）。

**8.3 `indexed-performance` 相对表现（rebased = 100）**
- Data：`series[{key,label,role:'subject'|'peer'|'index',points[{date,value}]}]`，`baseDate`，`events[]`，`statsTable{periods:['L3M','L6M','L12M'],rows[{key,values[]}]}`。
- Encoding：线；subject 深色粗线，peers/index 中蓝/青；y 轴 40–140 或 % 变化；**线末直接标注区间涨跌 `(36.6%)`**；基准 100 细线；事件字母标记。
- Interaction：可切换基准日（点击图上任一日期重设 base=100），系列显隐，peer 组合（均值 vs 个股）。

**8.4 `comps-table` 可比公司表**
- Data：`columns[{key,label,group?,format,unitOn,nm?:{rule}}]`，`groups[{label,rows[]}]`，`rows[{company,ticker,isSubject?,values{...}}]`，`stats:['max','p75','mean','median','p25','min']`，`excludeFromStats:[tickers]`。
- Encoding：见 §7；n.m. 统计剔除；subject 行高亮；可选每格内嵌 mini bar（数据条）。
- Interaction：排序/筛选/列组切换（Valuation | Operating | Credit）；行点击 → 在 `peer-bars`、`regression-scatter` 中高亮；**用户自定义列**（输入公式如 `tev / ebitda_2026e` → rk.expr 计算，自动纳入统计）。

**8.5 `precedents-table` 先例交易表**：同上，加 `date, target, acquirer, consideration, payment, premium1d, premium4w`；可视化扩展：倍数随时间散点（x=宣布日期，y=TEV/EBITDA，size=交易额）+ median 线。

**8.6 `sensitivity-grid` 敏感性矩阵（WACC×TGR、Exit multiple×IRR、Price×%Stock 等）**
- Data：`rowAxis{label,values[],format}`，`colAxis{label,values[],format}`，`cells[[...]]` 或 `formula`（rk.expr 表达式 + 基础输入，前端重算），`base{row,col}`，`thresholds?`（如 accretive>0）。
- Encoding：HTML table；轴标题竖排/横排（"Growth Rate" / "WACC"）；**base case 格高亮**；可选 sequential/diverging 背景（低饱和）；左上首格带单位，其余裸数字；超出阈值格加粗/边框。
- Interaction：用户修改中心值与步长 → 重算；hover 显示该格的输入组合；复制为 TSV。

**8.7 `waterfall` 桥图（EV→Equity、EBITDA bridge、Returns attribution、Sources→Uses）**
- Data：`steps[{label,value,kind:'start'|'delta'|'subtotal'|'end'}]`，`format`，`connectors:true`。
- Encoding：起止/小计柱 = `--ink`；增量正 = slot1 或 `--pos`，负 = `--neg`（同时用括号）；**柱间细水平连接线**（think-cell 风格）；标签在柱上/内；可跨零基线；支持横向版（EV→equity per share）。
- Interaction：hover 显示累计值；点击 delta 展开子项（drill-down）；数据变化时柱高动画过渡。
- 实现：ECharts 堆叠 bar（透明占位）或 custom series；think-cell 的 totals/subtotals 自动计算放在数据层。

**8.8 `avp-table` Analysis at Various Prices**
- Data：`prices[{label,value,kind:'offer'|'illustrative'|'current'}]`，`metrics[{group,label,base,calc:'premium'|'multiple'|'pctChange',denominator}]`，`benchmarks[{label,values}]`（peers/precedents 列）。
- Encoding：列 = 价格；首列 base 值；竖虚线分隔 benchmark 列；表内星标注释（GS）。
- Interaction：**滑块添加任意价格列**；所有隐含溢价/倍数由公式实时计算。

**8.9 `premiums-paid` 溢价分析**
- Data：`deals[{date,target,acquirer,premium1d,premium1w,premium4w,premium52wHigh,size,payment}]` 或预聚合 `stats{window:{p25,median,mean,p75,p90}}`，`currentPrice`。
- Encoding：(a) 每个窗口一组 percentile 柱 + 柱顶 %，上方 navy "chips" 给隐含股价（Rothschild）；(b) 或 dot strip（每笔交易一个点，median 竖线，subject offer 用 `--ref` 标）；表格版 Mean/Median/25th/75th/High/Low（Evercore）。
- Interaction：按规模/行业/支付方式过滤交易样本 → 统计与隐含价重算（cross-filter）。

**8.10 `multiple-history` 历史估值倍数**
- Data：`series[{key,label,points[{date,value}]}]`（EV/NTM EBITDA、P/E NTM），`bands:{mean,sd}`，`buckets[{label,min,max}]`。
- Encoding：线 + 均值线 + ±1σ 阴影带；线末标签 `7.7x`；附 "% of time spent in range" 分桶表（GS）——或其图形版：横向直方图。
- Interaction：期间切换（1Y/2Y/3Y/5Y），分桶阈值可编辑。

**8.11 `financial-summary` 财务摘要表**：`periods[{label,type:'A'|'E'|'P'|'PF'}]`，`rows[{label,values[],kind:'line'|'growth'|'margin'|'subtotal'|'total',indent}]`，`cagr[{from,to}]`；历史/预测分隔虚线；growth/margin 行斜体缩进；CAGR 列；可选每行 sparkline。

**8.12 `column-pro` think-cell 式柱图**
- Data：`categories[]`，`series[{key,label,values[]}]`，`mode:'clustered'|'stacked'|'stacked100'`，`decorations:[{type:'cagr',from,to}|{type:'diff',from,to}|{type:'valueLine',value,label}|{type:'total'}|{type:'axisBreak',at}]`，`otherThreshold?`。
- Encoding：无 y 轴；段内标签（自动黑/白反色）、柱顶总计；CAGR 箭头（从柱顶到柱顶的折线箭头 + 圆角标签 "+8.2%"）；差值箭头（两柱间 "+$120m"）；value line（虚线 + 右端标签）；类目间隙 ~50%；"A/E" 柱可用斜线纹理区分预测。
- Interaction：hover 段 tooltip；图例点选；数据变更动画。

### P1（常用扩展）

**8.13 `peer-bars` 同业对标横条**：`rows[{label,value,isSubject}]`，`refs:{mean,median}`；降序；subject 用 `--ink`/accent，其他 `--steel`；条尾标签；mean/median 竖虚线；可做 small multiples（增长/利润率/倍数并排，共享公司顺序）。

**8.14 `regression-scatter` 回归散点（EV/EBITDA vs 增长）**：`points[{label,x,y,size?,group?,isSubject?}]`，`fit:{type:'linear'|'log',show:true}`；x=NTM 收入增长或 EPS 增长，y=EV/NTM EBITDA；**size=市值（气泡面积∝值，sqrt 比例）**、**color=子行业**（≤3 色 all-pairs 安全，见 §4）、shape=上市地；回归线 + 方程 + R²（simple-statistics `linearRegression`/`rSquared`）；subject 标星并显示"隐含倍数 = f(其增长)"；标签防碰撞（ECharts `labelLayout:{hideOverlap:true}`）。交互：brush 选择 → comps 表筛选；剔除离群点后重算回归。

**8.15 `sotp` 分部估值**：`segments[{label,metric,metricValue,multipleLow,multipleHigh}]`，`adjustments[{label,value}]`（net debt、少数股东、中心成本）；编码：横向堆叠区间（每段 low/high）+ 合计区间 → 每股价值；或瀑布：segment EV → 总 EV → equity。

**8.16 `lbo-returns` LBO 回报**：`sourcesUses{sources[],uses[]}`（两列表 + 100% 堆叠条），`irrGrid`（entry×exit multiple → IRR/MOIC，复用 sensitivity-grid），`attribution[{label:'EBITDA growth'|'Multiple expansion'|'Debt paydown'|'Fees',value}]`（waterfall），`debtSchedule`（堆叠柱 + 杠杆率折线 → 建议双 pane）。

**8.17 `accretion-dilution` 增厚/摊薄**：`grid`（offer price × % stock 或 synergies），`years[]`，`breakevenSynergies`；diverging 背景（摊薄=暖色，增厚=冷色，0=中性灰）+ 括号负数；MS "tile table" 变体；附 breakeven 线。

**8.18 `contribution` 贡献分析**：`metrics[{label,acquirer,target}]`（Revenue/EBITDA/Net income/Market cap/FCF），`proFormaOwnership`；横向 100% 堆叠条（两方两色）+ **竖虚线 = 交易隐含的 pro forma 持股比例**；标签显示各方 %（rounding 一致）。

**8.19 `shareholder-register` 股东结构**：`holders[{name,type:'active'|'passive'|'individual'|'insider',style?:'growth'|'value'|'GARP'|'index'|'HF',geo?,pctSO,chg12m,shares}]`，`mix{by:'type'|'style'|'geo'}`；表（%SO、12m 变化带浅红/浅绿底 + 符号）+ 构成图（donut 或 100% 堆叠条，优先后者）；top-N 合计行。

**8.20 `volume-at-price` 成交量-价格分布 / VWAP 分析**：`bins[{priceLow,priceHigh,volume,pctTotal}]`，`windows['LTM','6M','3M']`，`vwap{'10d','30d','90d'}`，`refs{current,offer}`；横向直方图（y=价格带，x=% of volume），累计线（cumulative % below price）；参考价虚线 "X% of LTM volume traded below offer price"。

**8.21 `range-52w` 52 周区间**：`rows[{label,low,high,current,offer?}]`（可多公司："% of 52W high"）；编码：细区间条 + 当前价圆点 + offer 菱形；数值标签；适合 peer 小倍图。

**8.22 `price-targets` 分析师目标价**：`brokers[{name,target,rating,date}]`，`current`，`offer`；dot strip（每个券商一个点，按评级着色/形状：Buy/Hold/Sell），median 线，range 文字；或作为 football field 的 reference 行。

**8.23 `league-table` 排行榜**：`rows[{rank,advisor,value,count,share,isSelf}]`，`criteria{metric:'value'|'count',period,region,source:'LSEG/Dealogic/Mergermarket'}`；表 + 内嵌条（数据条）；本行金色/accent 高亮；可做 bump chart（多年排名变化）。

**8.24 `deal-timeline` 交易时间表 / Gantt**：`phases[{label,start,end,owner?,status?}]`，`milestones[{date,label,kind}]`，`today`，`scale:'week'|'month'`；条 = 阶段（ordinal ramp 按阶段顺序着色），◆ = 里程碑，竖线 = today；左侧任务列 + 可选 Harvey ball 状态列（think-cell Gantt 特征）。实现：HTML CSS grid（打印最稳）或 ECharts custom series；frappe-gantt 可选。

**8.25 `offer-evolution` 报价演进**：`steps[{date,label,kind:'unaffected'|'proposal'|'event'|'final',value?,premiumTo{...}}]`；柱（unaffected 浅灰、proposal navy、final accent + 虚线框），事件框无柱，柱下溢价表，底部箭头时间轴（Rothschild）。

**8.26 `marimekko` 市场份额矩阵**：`segments[{label,total,players[{name,share}]}]`；x 宽度 = 细分市场规模，y = 份额（100%），颜色 = 玩家（top-N + Other 灰），段内标签；think-cell 支持 unit 轴/百分比轴两种。实现：ECharts custom series 或 D3。

**8.27 `market-map` 市场地图 / landscape**：`segments[{label,companies[{name,logo?,size?,isTarget?,tags[]}]}]`；分区 tile 网格（文字 tile，**logo 由客户提供，kit 不内置任何商标**），可选 tile 大小 ∝ 收入（treemap 版）；筛选 tags。

**8.28 `debt-maturity` 债务到期 + 资本结构**：`instruments[{name,type,amount,coupon,maturity,rating?}]`；按年份堆叠柱（instrument type 着色）+ cap table（Book value, Coupon, Maturity, Cumulative Debt/EBITDA）。

**8.29 `synergy-ramp` 协同效应爬坡**：`years[]`，`cost[]`，`revenue[]`，`runRate`，`costToAchieve[]`；堆叠柱 + run-rate 虚线 + 负向一次性成本柱。

**8.30 `buyer-matrix` 买方矩阵 / ability-to-pay**：`buyers[{name,type:'strategic'|'sponsor',fit,capacity,marketCap,dryPowder?}]`；气泡（x=战略契合度，y=财务能力，size=市值/可用资金，color=类型，shape=地区）；四象限分隔线与标签（"Priority / Opportunistic"…）。

**8.31 `geo-footprint` 地理分布**：`regions[{iso,value}]`（choropleth：营收占比）或 `points[{lat,lon,value,category}]`（比例符号：门店/资产）；Leaflet（已 vendored）+ world-atlas；size=√value 面积编码，color=类别/增长（sequential）。

**8.32 `tombstones` 交易墓碑/资历**：`deals[{client,counterparty,type,value,date,role}]`；卡片网格（文字版），按类型筛选。

**8.33 `harvey-matrix` 定性比较矩阵**：`rows[]`，`cols[]`，`cells[[0|0.25|0.5|0.75|1|'check'|'cross']]`；Harvey balls / ✓ ×（think-cell data-driven table 特征）；用于战略选项、买方筛选。

**8.34 `alternatives-matrix` 战略选项 2×2**：四个选项卡片（标题、隐含价值区间、for/against bullets），推荐项反色（open-design conventions）。

### 横切能力（所有组件共享）
- **Decoration plugins**：CAGR arrow、difference arrow、value line、total labels、axis break、callout box、letter markers、end labels、"Other" 归并、rounding-to-total。
- **Cross-filter store**：选中公司/日期区间 → 所有订阅组件高亮或过滤（comps 表 ↔ 散点 ↔ 横条 ↔ 股价图）。
- **Formula columns**：用户在表头输入表达式（rk.expr）生成新指标列，统计行与图自动更新。
- **Motion**：线条 clip 揭示 600–900ms `cubicOut`；柱从基线生长 400–600ms、30ms stagger；数据更新用 ECharts `universalTransition`；KPI count-up；`prefers-reduced-motion` 与打印时关闭。

---

## 9. think-cell 图表目录 → kit 映射

来源：https://www.thinkcell.com/en/product/think-cell-charts ；第三方速查 https://info.transitionaccelerator.ca/allabouttools/think-cell-quick-reference

| think-cell | 说明 | kit 组件 |
|---|---|---|
| Column/Bar: stacked, clustered, 100% | 含 axis breaks、butterfly/tornado（柱图变体） | `column-pro`、`peer-bars`（butterfly = 双向条） |
| Waterfall | 自动 totals/subtotals，可穿越基线 | `waterfall` |
| Line / Area / Area 100% | 也用于 candlestick、football field | `price-volume-events`、`multiple-history` |
| Pie / Doughnut / pie-of-pie / concentric / gauge | | 尽量少用；`shareholder-register` 中 donut 可选 |
| Scatter / Bubble | 自动点标签、bubble sizing、分区阴影（情景/热区） | `regression-scatter`、`buyer-matrix` |
| Mekko（unit 轴 / % 轴，"Other" 归并） | | `marimekko` |
| Combination（柱+线，单/双轴，net lines，Pareto） | | `column-pro` + 第二 pane |
| Gantt（day/week/month/quarter/FY 刻度，milestones，Harvey balls/checkbox 列） | | `deal-timeline` |
| 装饰：CAGR arrows、value lines、difference arrows、error bars、secondary axis、linear interpolation、connectors、net lines | | decoration plugins |
| Data-driven tables（Excel 公式、条纹、Harvey balls） | | HTML tables + formula columns |
| Excel links / slide workbooks / smart automation（Excel/JSON 填模板） | 与我们"Python 生成 data/*.js"思路一致 | builder |
| think-cell round（TCROUND 等） | 部分和=总计 | `roundToTotal` |

think-cell 观感要点（我们要复刻的"PowerPoint 级"细节）：无 y 轴、数据标签优先、段内标签自动反色、柱宽/间隙一致、总计在柱顶、连接线细（0.5–0.75px）、箭头标签用圆角小框、预测期用斜线纹理或浅色、所有标签同一数字格式。

---

## 10. McKinsey / BCG 咨询风格（参考）

（无官方公开指南；以下为二手描述的共识 + 我们在银行样本中看到的同样做法。来源：https://slidemodel.com/mckinsey-presentation-structure/ 、https://deckary.com/blog/mckinsey-style-slides ）
- **Action title = "so what"**：完整句子陈述结论；整套 deck 只读标题即可得到故事（horizontal logic）；页内证据支撑标题（vertical logic / Pyramid Principle，SCR 结构）。
- 一页一个信息；图优先直接标注，图例少；**灰色为主 + 1 个强调色**；source 行必有；tracker 标明章节。
- 常用：瀑布（价值驱动）、Marimekko（市场结构）、横条排序、2×2 矩阵、Harvey ball 表、时间线、"ghost deck" 先写标题后填图。
- 对 kit 的启发：`page.title` 必填且校验长度（≤ 2 行）；提供 "title-only outline" 视图（只看所有页的 action title = storyline 检查）。

---

## 11. FT Visual Vocabulary 分类 → IB 图表映射

来源：https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary （repo 代码 MIT；**海报内容 © The Financial Times，仅参考分类，不复制图稿**；有简体/繁体中文版海报）。

| FT 类别 | FT 图型 | IB 用法 / kit 组件 |
|---|---|---|
| Deviation（偏离基准） | diverging bar, diverging stacked bar, spine, surplus/deficit line | accretion/(dilution)、vs consensus 差异、`peer-bars` 相对中位数、`contribution` |
| Correlation（相关） | scatter, line+column, connected scatter, bubble, XY heatmap | `regression-scatter`、`buyer-matrix`、股价 vs 倍数 |
| Ranking（排名） | ordered bar/column, ordered proportional symbol, dot strip, slope, lollipop | `peer-bars`、`league-table`、`price-targets`（dot strip）、bump |
| Distribution（分布） | histogram, boxplot, violin, population pyramid, dot strip, barcode, cumulative curve | `premiums-paid`（percentile/dot strip）、"% time in range"、`volume-at-price`、comps 倍数箱线 |
| Change over time | line, column, line+column, stock price, slope, area, fan chart, calendar heatmap, Priestley timeline… | `price-volume-events`、`indexed-performance`、`multiple-history`、`financial-summary` sparkline、`deal-timeline`（Priestley） |
| Magnitude（量级） | column, bar, paired column/bar, proportional stacked bar, proportional symbol, isotype, lollipop, radar, parallel coords | `column-pro`、`peer-bars`、`sotp` |
| Part-to-whole（构成） | stacked column, proportional stacked bar, pie, donut, treemap, Voronoi, arc, gridplot, Venn, **waterfall** | `waterfall`、`shareholder-register`、`sources & uses`、`marimekko`、`market-map`（treemap） |
| Spatial（空间） | choropleth, proportional symbol, flow map, contour, cartogram, dot density, heat map | `geo-footprint`（Leaflet） |
| Flow（流向） | Sankey, waterfall, chord, network | 资金流（sources→uses Sankey）、收入流向；ECharts sankey/chord |

IB 特有、FT 词表里没有单独命名的：**football field（range/dumbbell 的变体）**、sensitivity grid（XY heatmap 的表格版）、AVP 表、league table、tombstones、Harvey ball 矩阵。

---

## 12. 库评估（versions/licenses 均于 2026-10-14 用 npm/jsdelivr 核实）

| 库 | 版本（发布） | 许可证 | 经典 script（file://） | gz 体积 | ★ | 结论 |
|---|---|---|---|---|---|---|
| Apache ECharts | 6.1.0 (2026-05) | Apache-2.0 | `dist/echarts.min.js` UMD（已 vendored, 1.1MB min） | ~359KB（全量） | 67.5k | **adopt**（主引擎） |
| @echarts-x/custom-bar-range | 1.2.1 (2026-01) | Apache-2.0 | `dist/bar-range.auto.min.js`（1.8KB，自动注册） | <1KB | (echarts-custom-series 74) | **adopt**（football field / range） |
| @echarts-x/custom-line-range / violin / contour | 1.1.x (2026-01) | Apache-2.0 | `*.auto.min.js` | 很小 | — | consider（±1σ 带、分布） |
| D3 | 7.9.0 (2024-03) | ISC | `dist/d3.min.js` UMD | ~90KB | 113.8k | consider（Marimekko/market map/定制注释） |
| d3-svg-annotation | 2.5.1 (2019-10) | Apache-2.0 | `d3-annotation.min.js` | ~8KB | 0.8k | reference（停更；只借鉴 callout 设计） |
| Observable Plot | 0.6.17 (2025-02) | ISC | `dist/plot.umd.min.js`（需先加载 d3 UMD） | ~67KB | 5.4k | consider（快速原型、small multiples、回归） |
| Vega + Vega-Lite + vega-embed | 6.4.0 / 6.5.0 / 7.3.0 (2026) | BSD-3-Clause | `build/vega.min.js` + `vega-lite.min.js` UMD | ~175+79KB | 5.5k | consider（Step 2：LLM 生成 JSON spec 的沙箱渲染） |
| Chart.js | 4.5.1 (2025-10) | MIT | `dist/chart.umd.min.js` | ~68KB | 67.7k | reference（原生 floating bar 可画 football field/waterfall，但 ECharts 已覆盖） |
| chartjs-plugin-annotation | 3.1.0 (2024-10) | MIT | UMD | ~12KB | 0.6k | reference |
| chartjs-chart-matrix | 3.1.0 (2026-09) | MIT | UMD 3.7KB | tiny | 0.2k | reference（sensitivity 用 HTML 表更好） |
| Plotly.js (dist-min) | 4.1.2 (2026-10) | MIT | `plotly.min.js` | **~1.44MB** | 18.4k | avoid（体积；geo 默认从 CDN 拉 topojson） |
| uPlot | 1.6.32 (2025-03) | MIT | `uPlot.iife.min.js` | ~21KB | 10.6k | consider（10 年日频 × 多 ticker 的超大时序） |
| TradingView lightweight-charts | 5.2.1 (2026-08) | Apache-2.0 **+ 署名要求** | `lightweight-charts.standalone.production.js` IIFE | ~60KB | 17.6k | reference（交易终端风，不是 pitchbook 风；需 NOTICE + tradingview.com 链接） |
| ApexCharts | 8.2.0 (2026-10) | **双许可：社区版仅限年收入 < $2M** | UMD | — | 15.2k | **avoid**（投行必须买商业许可） |
| Highcharts | 13.1.1 (2026-09) | 商业 | — | — | 12.5k | reference only |
| amCharts 5 | 5.21.2 (2026-10) | 商业（免费版带署名） | — | — | 0.4k | reference only |
| billboard.js | 4.1.1 (2026-09) | MIT | `billboard.pkgd.min.js` | ~267KB | 6.0k | avoid（与 ECharts 重叠、IB 图型少） |
| Tabulator | 6.6.1 (2026-09) | MIT | `dist/js/tabulator.min.js` UMD | ~100KB | 7.8k | consider（重交互 comps：排序/分组/冻结列/导出） |
| AG Grid Community | 36.2.0 (2026-09) | MIT（Enterprise 商业） | `ag-grid-community.min.js` | ~509KB | 15.6k | consider（大表；注意 pivot/row grouping 属 Enterprise） |
| Grid.js | 6.2.0 (2024-03) | MIT | UMD | ~16KB | 4.7k | avoid（功能弱、停更） |
| frappe-gantt | 1.2.2 (2026-02) | MIT | `frappe-gantt.umd.js` | ~13KB | 6.1k | consider（交互 Gantt；打印版用 CSS grid） |
| vis-timeline | 8.5.4 (2026-08) | Apache-2.0 OR MIT | standalone UMD | ~152KB | 2.6k | reference（排程器风格过重） |
| simple-statistics | 7.12.1 (2026-09) | ISC | `simple-statistics.min.js` | ~9KB | 3.5k | **adopt**（回归、R²、quantile、mean/median） |
| d3-format | 3.1.2 (2026-01) | ISC | 含于 d3 | — | 0.6k | reference（kit 已有 Excel 风格 rk.format） |
| numbro / numeral | 2.5.0 (2024-04) / 2.0.6 | MIT | UMD | — | 1.1k | avoid（停滞；Intl + rk.format 足够） |
| Leaflet | 1.9.4 (2023-05) | BSD-2-Clause | `leaflet.js` UMD（已 vendored） | ~41KB | 45.7k | **adopt**（地图） |
| MapLibre GL JS | 6.14.0 (2026-10) | BSD-3-Clause | **6.x 仅 `.mjs`**；5.24.0 仍有 UMD | — | 11.9k | avoid（file://）；如需矢量瓦片钉 5.24.0 |
| GSAP | 3.15.0 (2026-04) | **"Standard no charge license"（非 OSI）** | UMD | — | 29.2k | avoid（许可证非 OSI；用 CSS/WAAPI + ECharts 动画） |
| FT chart-doctor | — (2024-03) | MIT（代码）；海报 © FT | n/a | — | 3.4k | reference（分类法） |
| @financial-times/o-colors | 6.7.1 (2026-02) | MIT（代码） | SCSS | — | — | reference（FT 品牌色，勿复用） |
| think-cell | — | 商业 | n/a | — | — | reference（装饰层与 rounding 设计） |
| Arimo / Tinos（@fontsource） | 5.3.0 (2026-07) | OFL-1.1 | woff2 + CSS | ~11KB/字重（latin 子集 woff2，实测 400/700 各 11.4KB） | — | **adopt**（Arial/Times 度量兼容） |
| Source Serif 4 / Inter / IBM Plex | 5.3.x (2026) | OFL-1.1 | woff2 | — | Inter 20k / Plex 11.7k | adopt（serif 标题 / 现代 sans） |
| Noto Sans SC / TC | 5.3.1 (2026-10) | OFL-1.1 | 102 个 unicode-range 分片 | 3.4MB/字重 | 4.1k (noto-cjk) | adopt + **必须子集化** |

ECharts 6 与 IB 相关的能力核对（在 vendored `echarts.min.js` 里 grep 到关键字）：`breaks`/`breakArea`（轴断裂）、`jitterOverlap`（beeswarm/jitter）、`matrix`（矩阵坐标系，可做 small multiples / 表格式布局）、`chord`、`relativeTo`（markPoint 角标定位）、`setTheme`（运行时换主题/暗色）、`universalTransition`、`dataZoom`、`brushSelected`、`labelLayout`、`aria`、`candlestick`、`boxplot`、`calendar`、`parallel`。**没有原生 waterfall series**（用堆叠 bar 或 custom series）。

---

## 13. Gotchas（踩坑清单）

1. **ApexCharts 许可证已变**（8.x LICENSE.md）：社区版仅限年收入/预算 < $2M 的组织，且"嵌入他人使用的产品/平台需 OEM 许可"——投行交付物绝对不能用。https://unpkg.com/apexcharts@8.2.0/LICENSE.md
2. **MapLibre GL 6 = ESM-only**（`dist/maplibre-gl.mjs`），file:// 下 Chrome 拒绝 module script → 白屏；最后 UMD = 5.24.0。
3. **Plotly**：1.44MB gz；`geo` 图默认从 CDN 加载 topojson（需配置 `topojsonURL` 指向本地）。
4. **lightweight-charts**：Apache-2.0 但 README 要求在页面可见处给出 NOTICE 署名 + tradingview.com 链接（`attributionLogo` 可满足链接）——客户交付物里出现第三方 logo 不合适。
5. **GSAP**：3.13 起"全部免费"，但许可证是 GreenSock 自有 Standard License（非 OSI，含使用限制）→ 按要求标记 non-OSI，避免。
6. **Observable Plot UMD** 依赖全局 `d3`，必须先加载 `d3.min.js`；Vega-Lite UMD 依赖全局 `vega`。
7. **Vega loader**：spec 里的 `url` 数据在 file:// 下会 fetch 失败 → 只用 `values` 内联数据（由 data/*.js 注入）。
8. **字体 file://**：Firefox 只允许同目录/子目录字体；CJK 字体必须子集化；建议 base64 内联。
9. **ECharts 6 默认主题变了**（新 token 化主题），并且新的 Cartesian 布局默认 `axis.containShape` 防溢出——升级/截图对比时注意；我们始终显式注册 navy/bronze/slate 主题。
10. **Canvas 打印发糊**：打印/PDF 导出用 `renderer:'svg'`（ECharts init 选项），或打印前切换 SVG 渲染。
11. **双轴**：IB 习惯 vs 最佳实践冲突 → 默认堆叠 pane，`dualAxis` 选项保留并强制两侧轴标题+单位。
12. **Rounding**：份额/构成标签不做 largest-remainder 调整会出现 "99.9%/100.1%"，在投行审阅里是硬伤。
13. **n.m. 统计**：mean/median 计算前剔除 n.m. 与 subject 自身；脚注写明阈值；不要把 n.m. 当 0。
14. **品牌/商标**：不得复制任何银行 logo、字体（如定制标题字体）、精确品牌色（例如 GS `#7399c6`/`#00355f`、FT `#fff1e5`/`#990f3d`）；tombstones/market map 的 logo 由客户提供并自行负责授权。
15. **Letter vs A4**：美国投行 Letter，欧洲/亚洲常 A4；`@page size` 与容器比例需按报告配置切换，否则 PDF 页边错位。
16. **Sensitivity / comps 用 canvas 画是反模式**：不可选中复制、不可访问、打印糊——用 HTML table + CSS 背景。
17. **中文单位**：`万/亿` 与 `m/bn` 不可混用；同一报告固定一种，表头单位行说明。
18. **"$ 44.71" 空格风格**：若用 Arimo/Inter，`$` 后用 thin space（U+2009）或 `font-feature-settings` 控制；表格中货币符号常左对齐、数字右对齐（会计格式 `_($* #,##0_)`）——需要 table cell 内两段式布局。

---

## 14. 具体建议（给后续实现 workflow）

1. **页面系统**：实现 `rk-page`（Letter 1056×816 默认，A4/16:9 可选）+ 槽位：`tracker / stamp / logo / title / subtitle / units / body(grid) / side / footnotes / source / pageNo`；脚注自动编号；打印 CSS 一页一张。
2. **主题**：在 `styles/themes/{navy,bronze,slate}.css` 写入 §4 token（结构色 + `--series-1..8` light/dark + `--ordinal-*` + `--seq-*` + `--div-*`）；ECharts 主题对象从 CSS 变量读取生成（`getComputedStyle`），`setTheme` 切换暗色。`ink` 主题可作为 navy 的高对比/打印黑白变体。
3. **格式层**：在 rk.format 上加 house-style 配置（`currencySpace, multSpace, multSymbol:'x'|'×', pctParen:'inside'|'outside', unitOn, na, nm, dash, dateAxis:'mmm-yy', dateTable:'dd-mmm-yyyy'`）+ `nmRules` + `roundToTotal` + `formatRange`。
4. **P0 组件**按 §8.1–8.12 实现；每个组件：`render(el, spec, data)`、`update(data)`（带动画）、`toTable()`（无障碍/导出）、`footnotes`。
5. **装饰插件**（CAGR/差值箭头、value line、callout、字母事件、end label、axis break）做成 ECharts `graphic`/`markLine`/`markPoint` 生成器，跨组件复用。
6. **交互骨架**：全局 selection store（选中公司/日期区间/情景）；时间范围按钮组；表格公式列（rk.expr）；sensitivity 与 AVP 实时重算——满足"客户输入自己的指标/公式并查询"。
7. **库**：ECharts 6.1 +（新增 vendor）`@echarts-x/custom-bar-range` 1.2.1、`simple-statistics` 7.12.1；可选 Tabulator 6.6.1（若需要重交互表）；Vega-Lite 6.5 放到 Step 2（LLM 生成 spec）再引入。避免 ApexCharts / Plotly / MapLibre 6 / GSAP / lightweight-charts。
8. **字体**：vendor Arimo（400/700）、Source Serif 4（400/600）、Inter Variable、IBM Plex Mono；Noto Sans SC 由 Python builder 按需子集化后内联。
9. **QA 清单**：每页必须有 action title、source 行、as-of 日期；所有数字走格式层；份额类标签 rounding 一致；n.m. 剔除统计；颜色全部来自 token；validator 已过的顺序不得重排。

---

## 15. Sources（本笔记引用）

一手（SEC EDGAR, 2023–2026）：
- GS "Project Jewel" (Janus Henderson) EX-99.(c)(iv): https://www.sec.gov/Archives/edgar/data/1274173/000110465926008735/tm2534023d8_ex99-civ.htm （同目录 ex99-ci…cv）
- GS (Thoughtworks/Apax) EX-99.(c)(21): https://www.sec.gov/Archives/edgar/data/1866550/000121390024085645/ea021234402ex99-cxxi_thoug.htm
- Morgan Stanley (Avangrid) EX-99.(c)(10): https://www.sec.gov/Archives/edgar/data/1634997/000119312524165806/d842696dex99c10.htm
- Evercore "Project Everest" (EngageSmart) EX-99.(c)(ix): https://www.sec.gov/Archives/edgar/data/1863105/000119312523280779/d306045dex99cix.htm
- Evercore "Project Montana" (MFW, 2011) EX-99.(c)(6): https://www.sec.gov/Archives/edgar/data/945235/000095012311097323/y05297exv99wcw6.htm
- Rothschild & Co "Project Kona" (KORE) EX-99.(c)(ii): https://www.sec.gov/Archives/edgar/data/1855457/000114036126014631/ny20068726x2_excii.htm
- Centerview "Project Blazing Star" (Walgreens) EX-99.(c)(3): https://www.sec.gov/Archives/edgar/data/1618921/000119312525135574/d946494dex99c3.htm
- n.m. 先例（Chaus DEFM14A 2012）: https://www.sec.gov/Archives/edgar/data/0000793983/000117494712000273/b315827_defm14a.htm
- EDGAR 全文搜索 API: https://efts.sec.gov/LATEST/search-index

格式/规范：
- Anthropic financial-services（Apache-2.0）pitch-agent skills（pitch-deck formatting-standards、comps-analysis、dcf-model、lbo-model、3-statement formatting）: https://github.com/anthropics/financial-services/tree/main/plugins/agent-plugins/pitch-agent
- nexu-io/open-design IB pitch book conventions: https://raw.githubusercontent.com/nexu-io/open-design/main/design-templates/ib-pitch-book/references/conventions.md
- Wall Street Prep — football field: https://www.wallstreetprep.com/knowledge/football-field-valuation-real-example-excel-template/
- Alexander Jarvis — IB slide examples（32 类页面目录）: https://www.alexanderjarvis.com/investment-banking-slide-examples-of-premiums-paid-analysis/
- FE Training — pitch book structure: https://www.fe.training/free-resources/investment-banking/investment-banking-pitch-book/
- SlideSpeak（非官方 GS 风模板，色值仅作佐证）: https://slidespeak.co/slide-design-prompts/prompts/goldman-sachs-style
- WSO（Garamond 轶事）: https://www.wallstreetoasis.com/forum/resume/best-font-for-a-resume-which-theme-to-go-with

think-cell / 咨询 / FT：
- think-cell charts: https://www.thinkcell.com/en/product/think-cell-charts
- think-cell Excel data rounding: https://www.think-cell.com/en/resources/manual/excel-data-rounding ；KB0028: https://www.think-cell.com/en/resources/kb/0028
- think-cell quick reference（第三方）: https://info.transitionaccelerator.ca/allabouttools/think-cell-quick-reference
- McKinsey 结构（二手）: https://slidemodel.com/mckinsey-presentation-structure/ ；https://deckary.com/blog/mckinsey-style-slides
- FT Visual Vocabulary: https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary （LICENSE MIT, © 2016 FT Interactive News）
- FT o-colors palette: https://cdn.jsdelivr.net/npm/@financial-times/o-colors@6.7.1/src/scss/_palette.scss

库：
- ECharts 6 features: https://echarts.apache.org/handbook/en/basics/release-note/v6-feature ；changelog https://echarts.apache.org/changelog.html
- echarts-custom-series: https://github.com/apache/echarts-custom-series
- ApexCharts license: https://unpkg.com/apexcharts@8.2.0/LICENSE.md
- lightweight-charts: https://github.com/tradingview/lightweight-charts
- GSAP standard license: https://gsap.com/standard-license
- npm registry（`npm view <pkg> version license time`）与 jsdelivr flat listings（`https://data.jsdelivr.com/v1/package/npm/<pkg>@<v>/flat`）用于核实版本/文件/体积；GitHub stars 经 ungh.cc 读取（2026-10-14）。

验证工具：dataviz skill `scripts/validate_palette.js`（OKLab ΔE×100，Machado 2009 CVD 模拟）；对比度 WCAG 2.x。
