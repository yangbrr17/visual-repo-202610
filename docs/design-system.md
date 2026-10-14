# ReportKit 设计规范 · Design System

> 读者：写报告的分析师、开发组件的工程师、做主题的设计师。
> **事实来源**（改规范先改这些文件，本文只解释它们）：`kit/styles/tokens.css`（字体 / 字号 / 间距 / 动效）、
> `kit/styles/themes/*.css`（颜色）、`kit/core/rk.theme.js`（token → ECharts / Leaflet / canvas）、
> `kit/core/rk.format.js`（数字格式）、`kit/styles/layout.css` + `print.css`（页面）、`kit/core/rk.motion.js`（动效）。
> **依据**：`research/raw/04-pitchbook-design.md`（SEC EDGAR 上 GS / MS / Evercore / Rothschild 真实 "Discussion Materials" 逐页观察）、
> `05-motion-ui.md`、`06-china-xhs.md`、`09-architecture.md`。色板分数用 dataviz skill 的 `validate_palette.js`
> （OKLab ΔE×100，Machado 2009 CVD 模拟）于 2026-10-14 重跑。
> 标记：✅ 已实现 · 🟡 部分实现 · ⬜ 规划中（汇总见 §10）。

---

## 0. 十条硬规则 (TL;DR)

1. **一页一个结论**：每页必须有 action title（完整句子，≤ 2 行）、带单位的 subtitle、Source 行和 as-of 日期。
2. **画布固定 16:9**：1280×720 CSS px = 13.333×7.5 in。打印时超出部分会被裁掉，所以按一页的量设计内容。
3. **数字只走格式层**（`RK.format` / 字段 `format`）。负数用括号；缺失值显示 `n.a.`，无意义值显示 `n.m.`，零或不适用显示 `–`。
4. **数字用 tabular figures**（`.rk-num`）。Inter 默认是比例数字，必须显式开启。
5. **颜色只能来自 token**。组件代码里不写 hex；新颜色先进主题文件。
6. **单页数据色 ≤ 4–5 种**。"标的 vs 同业" 是语义强调（`--rk-accent-2`），不是分类。
7. **参考线**（offer price / current price）只用 `--rk-ref` 虚线加标签，不能和任何数据系列同色。
8. **红 / 绿只表示增减**，并且必须同时有 `+/−` 符号、括号或 ▲▼。不能只靠颜色传达信息。
9. **动效克制**：首次出现时播一次，≤ 900 ms，只动 transform / opacity。在 `prefers-reduced-motion` 和打印状态下直接显示终态。
10. **图表都有表格替代**："View data" 和 "Download CSV" 对所有数据块可用。打印永远是浅色纸面（`ink` 主题在打印时会被强制换成纸面配色）。

---

## 1. 页面解剖 · Page anatomy

### 1.1 画布

| 项 | 规定 | 实现 |
|---|---|---|
| 比例 | 16:9；设计稿 1280×720 CSS px | ✅ `.rk-page { aspect-ratio: 16/9 }`（屏幕上内容过高时会自动长高） |
| 打印 | 13.333 in × 7.5 in = PowerPoint widescreen = 960×540 pt | ✅ `print.css`：`@page { size: 13.333in 7.5in; margin: 0 }`，每个 `.rk-page` 一张 |
| 屏幕最大宽 | `--rk-deck-max: 1320px`，左侧 nav `236px` | ✅ `layout.css` |
| 窄屏 | 取消 16:9，改为纵向流式排版（reflow） | ✅ `@media` 中 `.rk-page { aspect-ratio: auto }` |

**决策说明**：research 04 实测美国投行 deck 基本都是 **US Letter 横向 11×8.5 in（1.294）**，没有一家是 16:9
（例：GS "Project Jewel" https://www.sec.gov/Archives/edgar/data/1274173/000110465926008735/tm2534023d8_ex99-civ.htm ）。
我们仍以 16:9 为默认，原因有两点：交付物以屏幕交互为主；页面要能直接贴进 widescreen PPT。另外，research 09 实测 Chromium `page.pdf()` 能精确产出 960×540 pt
的页面，不需要缩放或重排（§8.1）。Letter / A4 作为可选的命名页面（named page），状态 ⬜。

### 1.2 页面槽位（自上而下）

```
┌─ accent ███████████████████████████████ accent-2 ████ ─┐ 4px signature rule (.rk-page::before, 72% / 28%)
│ VALUATION                                              │ kicker / section tracker
│ Implied equity value of $4.2–5.6bn, above the offer    │ action title
│ USD m unless otherwise stated                          │ subtitle = units line
│ ┌ figure.rk-block  --rk-span:7 ──────┐ ┌ span 5 ─────┐ │
│ │ Block title · block subtitle       │ │ commentary  │ │ .rk-block__head
│ │ chart / table body  (--rk-h)       │ │ or KPI side │ │ .rk-block__body
│ │ Source: … (block level, optional)  │ │ panel       │ │ .rk-block__foot
│ └────────────────────────────────────┘ └─────────────┘ │
│ ─────────────────────────────────────────────────────── │ 1px --rk-rule
│ Source: FactSet, company filings; market data as of    │ .rk-page__source
│ 10-Oct-2026. Note: (1) Excludes outliers > 40x.        │ .rk-page__notes
│                         STRICTLY CONFIDENTIAL      7   │ .rk-page__conf / .rk-page__num
└────────────────────────────────────────────────────────┘
```

| 槽位 | class / 来源 | 规则 | 依据 |
|---|---|---|---|
| Section tracker | `.rk-page__kicker`（Python `kicker=`） | 1–3 个词，全大写，11px，600，`letter-spacing:.1em`，`--rk-accent-3` | Rothschild 左上 "2. EXECUTIVE SUMMARY"；GS 梯形 tab（04 §1.1） |
| Action title | `.rk-page__title`（`r.page("…")`） | 一句话结论，带数字，≤ 2 行（`text-wrap: balance`）；Source Serif 4 600；颜色 `--rk-accent`（ink 主题用 `--rk-ink`）；不加句号 | 04 §2；McKinsey "so what" 标题（https://slidemodel.com/mckinsey-presentation-structure/ ） |
| Subtitle / units | `.rk-page__subtitle` | 写单位口径：`USD m unless otherwise stated`、`($ in millions, except per share data)`；14px `--rk-ink-3` | GS / Evercore 单位行（04 §2） |
| Block 标题 | `.rk-block__title` / `__subtitle` | 图表名词短语（不重复结论）+ 单位或期间；14px / 11px | — |
| Source | `.rk-page__source` | 以 `Source:` 开头，附 `market data as of DD-MMM-YYYY`。不写时，builder 会自动汇总本页所用 dataset 的 `meta.source` ✅ | 04 §2："Source 行必须有" |
| Notes | `.rk-page__notes` | 用 `(1) (2)` 编号，和表内标记一一对应；数据中的 n.m. 阈值必须在这里注明 | Chaus DEFM14A n.m. 先例（04 §6.2） |
| Confidentiality | `.rk-page__conf` | 默认取 `report.confidentiality`（"Strictly private & confidential"），大写，`letter-spacing:.06em` | GS / Centerview / Evercore |
| Page number | `.rk-page__num` | 运行时自动编号 ✅；右下角，tabular，600 | GS 右下页码 |
| DRAFT 章 | — | 右上描边框 "DRAFT — Subject to refinement"，颜色用 `--rk-ref` ⬜ | GS 红框（04 §1.1） |

**Action title 写法**

| ✗ 话题式 | ✓ 结论式 |
|---|---|
| Trading comparables | Peers trade at a median 9.5x NTM EBITDA; Helios sits at a 1.2x discount |
| Valuation summary | DCF and precedents support $46–58 per share, above the $46.10 proposal |
| Revenue by segment | Software grows to 41% of revenue by 2028E, driving the margin step-up |

- 标题里的数字由数据算出（f-string / `{{median(x)|0.0x}}` 占位符），不要手打（`docs/pipeline-guide.md` §10 检查清单）。
- 审阅时只看导航栏里的标题，应该能读出完整故事线（horizontal logic，04 §10）。

### 1.3 栅格

- 12 列：`--rk-span: 1…12`（默认 12）；块间距 `--rk-gap: 20px`，列间距 ×1.4。
- 图表高度 `--rk-h`（默认 `--rk-chart-h: 320px`）。16:9 页面去掉页眉和页脚后，正文高度约 520px：
  一行放一个 `--rk-h:340px` 的图，或者两行各放一个约 230px 的图。
- 常用版式：`7 + 5`（图 + 评论 / KPI 侧栏，对应 GS / Rothschild 的 side panel）、`6 + 6`、`4 + 4 + 4`（KPI 行）、`12`（宽表）。
- 页面边距：`--rk-page-pad-x: clamp(20px, 3.2vw, 52px)`，`--rk-page-pad-y: clamp(20px, 2.6vw, 40px)`。

### 1.4 封面与章节页

- 封面 `.rk-page--cover`：`--rk-accent` 满底，Source Serif 4 display 字号（`--rk-fs-display`），右上角放机密标记。只用一个淡几何纹理，不放图片。
- 章节页 `.rk-page--section`：章节编号用 `--rk-accent-2` 大号衬线数字，标题用 `--rk-accent`。

---

## 2. 排版 · Typography

### 2.1 字体

| 角色 | Token | 字体栈 | 授权 |
|---|---|---|---|
| 正文 / UI / 数据 | `--rk-font-sans` / `--rk-font-num` | **Inter** 400/500/600/700 → Helvetica Neue → Arial → PingFang SC → Hiragino Sans GB → Microsoft YaHei → Noto Sans SC（`--rk-font-num` 只到 Arial，不含中文回退） | OFL-1.1，`kit/fonts/inter/` |
| 标题 | `--rk-font-serif` | **Source Serif 4** 400/400i/600/700 → Georgia → Times New Roman → Songti SC → SimSun | OFL-1.1，`kit/fonts/source-serif-4/` |
| 公式 / 代码 | — | 系统 monospace（建议改用 JetBrains Mono ⬜，05 §TL;DR） | — |

- 选型依据：bulge-bracket 投行偏好全 sans，精品投行偏好 serif 大标题 + sans 正文（04 §3.1）。本 kit 取后者：
  serif 标题 + Inter 数据，在屏幕上更有"顾问"气质。
- `file://` 下字体必须放在 `index.html` 所在目录的子目录里。Firefox 只允许加载同目录或子目录的字体
  （https://lists.w3.org/Archives/Public/www-font/2013OctDec/0007.html ）。builder 已经把字体输出到 `assets/fonts/`。
- 中文：目前回退到系统字体（PingFang / YaHei）。如果要内嵌 Noto Sans SC，必须由 builder 用 `pyftsubset` 按报告实际用字做子集化。
  全量分片约 3.4–4.5 MB（04 §3.3、05 §6.3）⬜。

### 2.2 字号阶梯（`tokens.css`）

| Token | 值 | 用途 |
|---|---|---|
| `--rk-fs-xs` | 10px | Source / Notes / 页脚、表格脚注、block foot |
| `--rk-fs-sm` | 11px | kicker、block subtitle、轴标签（ECharts `axisLabel` 11）、图例 11 |
| `--rk-fs-base` | 13px | 正文、表格正文 |
| `--rk-fs-md` | 14px | 页面 subtitle、block 标题 |
| `--rk-fs-lg` | 17px | 顶栏报告名、章节副标题 |
| `--rk-fs-title` | `clamp(20px, 1.2vw + 12px, 27px)` | **action title** |
| `--rk-fs-display` | `clamp(30px, 2.4vw + 16px, 48px)` | 封面 / 章节标题 |
| `--rk-lh` | 1.45 | 正文行高；标题 1.18，封面 1.06 |

ECharts 侧（`rk.theme.js` 中的 `echartsTheme`）：全局 `textStyle` 12px，图内 title 14px serif 600，tooltip 12px，dataZoom 文本 10px。
这些值对照 04 §3.2 的 Letter 画布阶梯换算而来（轴标签 8–9 pt ≈ 11–12 px，脚注 7–8 pt ≈ 9.5–10.5 px）。

### 2.3 数字排版

- 数字列、数据标签、KPI、页码一律加 `.rk-num` / `.is-num`：`font-variant-numeric: tabular-nums lining-nums`（`base.css`）✅。
  research 05 用 fontTools 测过：Fontsource 版 Inter 默认是**比例数字**，但保留了 `tnum` 特性，所以这样写有效（05 §6.2）。
- 表格数字右对齐（或按列配置居中），小数点对齐。会计格式 `_)` 会给正数留出右括号的宽度（§5）。
- **不要用等宽字体（monospace）显示表格数字**：等宽字体里的 "1" 和 "." 会显得稀疏。投行惯例是比例字体 + tabular figures（05 §6.2-4）。
- 斜杠零 `zero`、`case` 等特性需要换成上游 `inter-ui` 4.1.1 的 variable 字体文件 ⬜（05 §6.2-2）。

---

## 3. 色彩系统 · Colour

### 3.1 Token 分层

| 层 | Tokens | 规则 |
|---|---|---|
| 结构 Structure | `--rk-canvas`（页外背景）、`--rk-paper`（页面）、`--rk-surface` / `--rk-surface-2`（面板、统计行底） | 不用于数据 |
| 文字 Ink | `--rk-ink`（主文本）、`--rk-ink-2`（次级、轴标题）、`--rk-ink-3`（轴标签、脚注） | **文字只用 ink token**，系列色只用于标记 (marks)，即 dataviz "text wears text tokens" 规则（04 §4.4-6） |
| 线 Lines | `--rk-rule`（边框 / 表线）、`--rk-grid`（网格线，刻意弱化）、`--rk-axis`（轴线） | 0.5–1px |
| 品牌 Brand | `--rk-accent`（主色：标题、封面、主系列）、`--rk-accent-3`（kicker、次强调） | — |
| **目标高亮** | `--rk-accent-2`（= `t.accent2`）、`--rk-highlight` | 标的公司 / 本行 / 选中项；**每页只给一个对象** |
| **参考线** | `--rk-ref`（= `t.ref`） | 只用于 offer / current price / 52 周区间等价格参考线和 DRAFT 章；虚线 + 斜体标签 |
| 语义 Semantic | `--rk-pos` / `--rk-neg` / `--rk-neutral` | 增 / 减 / 无变化或 n.a.；必须配合符号使用（§3.2-5） |
| Categorical | `--rk-cat-1…8` | 顺序固定：cat-1 = 品牌主系列，cat-8 = 灰色 "Other / reference" |
| Ordinal | `--rk-ord-1…5`（深 → 浅） | 单色相，用于有序堆叠（业务线、期限结构） |
| Sequential | `--rk-seq-1…7`（浅 → 深） | 热力图、分级着色图、sensitivity 底色 |
| Diverging | `--rk-div-1…7`（负 → 中性 → 正） | accretion / (dilution)、相对中位数偏差 |
| 地图 / 浮层 | `--rk-map-land/border/water`、`--rk-tooltip-bg/ink` | Leaflet / ECharts geo 共用 |

### 3.2 用色规则（IB 版，源自 04 §4.4）

1. **Subject vs peers 是强调，不是分类**：标的公司用 `accent2`，同业用一种中性色或 cat-2，均值 / 中位数用虚线。
   不要给 15 家同业各配一种颜色。`RK.theme.categoricalSafe(values, {highlight:[target]})` 会自动避开 accent2 ✅。
2. **堆叠优先用 ordinal**（单色相深 → 浅）。只有类别确实无序、又必须区分时才用 categorical。
3. **参考线专用 `--rk-ref`**：football field 的报价线、股价图的 offer 线、事件线都用它；任何系列都不能用这个颜色。
4. **Reference-only 方法**（52 周区间、分析师目标价）用浅色或灰色条，和主方法区分开（GS "For Reference Only"）。
5. **pos / neg 只用于 delta 列、bridge 增减和 diverging 热力图**，并且必须同时带符号：`+5.2%` / `(3.1%)` / ▲▼。
   单页最多 1 个 diverging 语义。KPI tile 用 `good` 通道（该行字段值为 `'down'`）声明"下降为好"（如 leverage、成本）✅。
6. **中国惯例 红涨绿跌**：ECharts candlestick 默认就是红涨绿跌（06 §0-3）。kit 的 candlestick / price-volume 已改为读取 `t.pos` / `t.neg`
   （西方惯例）✅。面向中国客户时，建一个主题变体对调 `--rk-pos` 和 `--rk-neg` 即可，组件不用改。
7. **暗色不是自动反色**：`ink` 主题有单独一套 token。暗色色板必须在暗底上单独验证（§3.4）。
8. **大屏风格禁用**：霓虹、发光、渐变柱、玻璃拟态、3D、飞线、水球图、词云，都不适合投行交付物（06 §11）。

### 3.3 JS API（`RK.theme`，组件只能通过它取色）

```js
var t = RK.theme.tokens();                 // {cat[], seq[], div[], ord[], accent, accent2, ref, pos, neg, ink, ink3, grid, ...}
RK.theme.palette()                         // categorical, already excluding colours too close to accent2 (target-safe)
RK.theme.palette({exclude: [t.pos, t.neg], n: 12})   // extends with tints/shades instead of repeating
RK.theme.categoricalSafe(values, {highlight: ['Helios']})  // stable value -> colour; highlighted -> accent2
RK.theme.sequential([lo, hi]) / RK.theme.diverging([lo, hi], 0)
RK.theme.textOn(fill)                      // WCAG-contrast label colour on a data fill, correct in light and dark
```

### 3.4 已验证色板 · Validated palettes

下表是 research 04 §4 提出的参考色板，2026-10-14 重跑 `validate_palette.js` 后，**每一行都通过全部硬门槛**：
lightness band、chroma ≥ 0.10、相邻 CVD ΔE ≥ 8、正常视觉 ΔE ≥ 15、对比度 ≥ 3:1。
前 3 色还在 `--pairs all` 下复验过，用于散点、气泡和地图。**调换顺序会改变分数**，复用时不要重排。

| 主题 · 模式 | 底色 | Categorical（slot 1 → 8） | 相邻 CVD / 正常 | 前 3 色 all-pairs |
|---|---|---|---|---|
| navy · light | `#ffffff` | `#2e64a6 #b68028 #9f3960 #4b99c9 #57873a #7555a8 #cb5f31 #008e88` | 12.1 / 19.5 | 12.0 / 20.7 |
| navy · dark | `#0f1724` | `#4c82c6 #bd8630 #b74e74 #449fc9 #639346 #8a69be #d5683b #129d97` | 12.9 / 17.7 | 13.4 / 18.3 |
| bronze · light | `#fbf9f5` | `#aa6926 #37649e #8f2c47 #a68922 #008b9d #cb6443 #865695 #469364` | 12.8 / 18.6 | 14.1 / 17.4 |
| bronze · dark | `#16130f` | `#bf7c3c #5382be #ac425c #ae912c #0097aa #d26a49 #9b6aab #4e9c6d` | 11.2 / 16.8 | 13.7 / 16.4 |
| slate · light | `#ffffff` | `#3e6dc8 #db6143 #009783 #7d5abc #3e9245 #379fc7 #c38700 #c35f92` | 9.9 / 18.1 | 9.9 / 18.5 |
| slate · dark | `#111418` | `#5283e0 #e2684a #00a38f #926fd4 #4b9f50 #39a0c9 #c38700 #c96598` | 11.2 / 17.2 | 11.2 / 17.8 |

| Ordinal（深 → 浅） | 值 | 结果 |
|---|---|---|
| navy 5 阶（**kit 现用**） | `#0e2a47 #1f4e79 #3a6fa6 #6b93c4 #98b4d8` | PASS（单色相 6°，浅端 2.13:1） |
| navy 4 阶 | `#0e2a47 #1f4e79 #3a6fa6 #6f97c7` | PASS（浅端 3.03:1） |
| bronze 4 阶 | `#3b2a1a #6b4a26 #9a6b35 #c49a60` | PASS（浅端 2.45:1） |
| slate 4 阶 | `#1b2533 #33475f #52698a #7c93b3` | PASS（浅端 3.14:1） |
| ink 5 阶（**kit 现用**，暗底） | `#cfe0f5 #93b6e2 #5f8fcb #3a6aa3 #284a78` | PASS（浅端 2.00:1） |

去掉和主题 `accent-2` 撞色的那一格（navy 去 gold，bronze 去 slate blue，slate 去 teal，ink 去 gold）以后，
剩余 7 色**按原顺序**仍然全部 PASS（navy 12.0 / 19.5，bronze 12.8 / 17.4，slate 16.0 / 18.1，ink 12.9 / 17.7）。
`RK.theme.palette()` 在有目标高亮时就是这样剔除颜色的，所以这些色板可以直接配合目标高亮使用。

### 3.5 现行 kit token 审计（2026-10-14）

kit 主题里的 categorical **并不等同于上表**：cat-1 被设成品牌深色（作"主系列"），cat-8 被设成灰色（作 "Other"）。
这两格是**语义槽位**，本来就不在 categorical 验证范围内。但即便只看 slot 2–7，验证结果也不全是 PASS：

| 主题 | slot 2–7 结果 | 问题 | 建议（已用 validator 验证 PASS） |
|---|---|---|---|
| navy | FAIL | `#5f8dc4` chroma 0.097 < 0.10；`#57873a↔#008e88` 正常视觉 ΔE 10.3 | 改为 `#9f3960 #4b99c9 #cb5f31 #008e88 #7555a8 #57873a`（相邻 11.1 / 20.0；前 3 色 all-pairs 15.2 / 15.3） |
| bronze | **PASS**（12.8 / 18.6） | 只有 cat-8 灰色不过（预期内） | 保持不变 |
| slate | FAIL | `#c38700↔#3e9245` protan ΔE 4.0 | 只重排：`#c38700 #c35f92 #3e6dc8 #db6143 #7d5abc #3e9245`（相邻 9.7 / 19.8；前 3 色 all-pairs 9.7 / 19.8） |
| ink | FAIL | 4 色超出暗色 lightness band（L 0.71–0.87 > 0.67），3 色 chroma < 0.10；相邻 CVD ΔE 4.3、正常视觉 ΔE 12.3 | 用 §3.4 "navy · dark" 一行（去掉 gold）：`#d5683b #129d97 #8a69be #639346 #449fc9 #b74e74`（9.6 / 17.7；前 3 色 9.6 / 19.8） |

同时，bronze 的 ordinal 浅端 `#dfc7a3` 只有 1.61:1，slate 的 `#a9bad0` 只有 1.98:1，都低于 2:1 下限。
改用 §3.4 的 4 阶版本，或者删掉第 5 阶。**修正属于 token 改动，要另开任务做**（§10）。
做完后按 §4.2 第 4 步重跑 validator。

### 3.6 对比度（WCAG 2.x，相对 `--rk-paper` 实测）

| 主题 | ink | ink-2 | ink-3（脚注 10px） | accent-2 | ref | pos | neg | axis |
|---|---|---|---|---|---|---|---|---|
| navy | 17.1 | 9.0 | 4.53 ✅ | 3.09 | 6.54 | 4.91 | 5.66 | 3.03 |
| bronze | 15.3 | 9.3 | **4.22 ✗** | 11.3 | 6.43 | 5.64 | 5.86 | 2.85 |
| slate | 16.3 | 8.9 | 4.51 ✅ | 4.13 | 5.44 | **4.18 ✗** | 4.67 | 2.93 |
| ink | 15.3 | 9.9 | 5.85 ✅ | 9.13 | 7.42 | 7.24 | 6.23 | 2.94 |

- 小字（< 18px）需要 ≥ 4.5:1，因此 bronze 的 `--rk-ink-3` 和 slate 的 `--rk-pos`（当它被用作文字色时）需要加深 ⬜。
- 图形标记需要 ≥ 3:1：navy 的 accent-2（3.09）刚好达标，所以金色高亮条不能再调浅。
- 网格线和轴线刻意做弱（< 3:1）。它们是辅助线，不承载信息。

---

## 4. 主题 · Themes

### 4.1 四套主题

| id | 名称（`RK.theme.labels`） | 定位 | accent / accent-2 / ref | 备注 |
|---|---|---|---|---|
| `navy`（默认） | Navy classic | Bulge-bracket pitchbook：深 navy + 冷蓝 + 一个 muted gold | `#0b2d5b` / `#b08d57` / `#b3261e` | `:root` 同时等于 navy |
| `bronze` | Bronze & ivory | 精品投行 / 私行：暖纸面、espresso 文字、bronze 主色，navy 作对比色 | `#6b4f36` / `#1f3a5f` / `#b3261e` | 和 serif 标题最搭（ref 原为 `#8f2c47`，与 cat-2 撞色，c4f9b5d 改为 `#b3261e`） |
| `slate` | Slate modern | 咨询风：冷灰 + teal 点缀 | `#1f2a44` / `#1b8a8f` / `#c0392b` | 适合内部 dashboard |
| `ink` | Ink (dark) | 屏幕 / 会议室大屏演示的暗色模式 | `#7fa7d9` / `#d6b47a` / `#ef8a8a` | **打印时 `print.css` 会强制换回纸面色** |

注：bronze 的 `--rk-highlight`（`#a78155`）和 `--rk-accent-2`（`#1f3a5f`）不是同一个颜色，其他三套主题里两者相同。
写组件时，目标高亮统一用 `t.accent2`。

### 4.2 新建主题（只改 token，不改组件）

1. **复制** `kit/styles/themes/navy.css` → `kit/styles/themes/<id>.css`。选择器改成只保留 `[data-rk-theme="<id>"]`（去掉 `:root,`，只有默认主题才带它）。
2. **改 token**：结构色 → 文字色 → accent / accent-2 / ref → pos / neg → cat / ord / seq / div → map / tooltip。
   必须把所有 token 写全。漏写的 token 会继承 `:root`（即 navy）的值，而 `rk.theme.js` 的 fallback 只覆盖一部分。
3. **登记**：在 `kit/build.json` 的 `styles` 和 `themes` 里加入新主题（可选：`themeLabels: {"<id>": "Label"}`）。
   Python builder 会据此拼接 CSS 并生成主题下拉框。运行时的 `RK.theme.list` / `labels` 目前写死在 `rk.theme.js` 里。
   不改核心代码时，可以在 `reportkit.js` 之后执行 `RK.theme.list.push('<id>'); RK.theme.labels['<id>'] = '…'`，这样"记住上次主题"也会生效 🟡。
4. **验证**（必做）：
   ```bash
   node validate_palette.js "<cat-2..cat-7>" --mode light --surface "<paper>"           # 暗色主题用 --mode dark
   node validate_palette.js "<cat-2,cat-3,cat-4>" --mode light --surface "<paper>" --pairs all
   node validate_palette.js "<ord-1..ord-n>" --ordinal --mode light --surface "<paper>"
   ```
   脚本在 dataviz skill 的 `scripts/validate_palette.js`。建议把它 vendor 到 `tools/` 并接入 `tools/check.sh` ⬜。
   文字 token 再查一遍 WCAG（§3.6 的口径）。
5. **截图**：`node tools/smoke.cjs --all --theme <id>`（不加 `--theme` 时用 navy，文件名不带后缀），然后对比 `tests/screens/*-<id>.png`。重点看 football field 的参考线、
   comps 表的目标行、waterfall 的增减色、choropleth 的 seq。
6. **切换**：`<html data-rk-theme="<id>">`、Python `Report(..., theme="<id>")`，或运行时调用 `RK.theme.set('<id>')`。
   `RK.theme.set` 会重读 token、重新注册 ECharts 主题 `rk`、发出 `theme:changed` 事件，所有 block 随之重绘 ✅。

**禁止**：复制任何银行的 logo、定制字体或精确品牌色（例如 GS `#7399c6` / `#00355f`）。只做 "inspired-by"（04 §13-14）。

---

## 5. 数字格式 · Number formatting

格式码是 Excel 风格（分析师在模型里本来就这么写），由 `kit/core/rk.format.js` 实现。完整语法见 `docs/formula-language.md` §12。

### 5.1 约定

| 场景 | 规则 | 格式码 / 示例 |
|---|---|---|
| 缺失 | `null` / 未披露 → `n.a.` | `RK.format(null,'0.0x')` → `n.a.` ✅ |
| 无意义 | 除零、负 EBITDA 的倍数、超阈值 → `n.m.`，并**从 mean / median 中剔除** | NaN → `n.m.` ✅；comps-table 列选项 `nm:[0,50]` ✅ |
| 零 / 不适用 | en dash `–` | `0.0x;(0.0x);"–"` |
| 负数 | 括号；会计对齐时正数留出右括号宽度 | `#,##0.0_);(#,##0.0)`（preset `acct1`） |
| 舍入 | 与 Excel 一致：按十进制数位四舍五入（half away from zero），没有二进制误差；不会显示 `-0.0` 或 `(0.0)` | `10.35` @ `0.0x` → `10.4x`，`2.675` @ `$0.00` → `$2.68` ✅ |
| 零值留空 | Excel 的空零段写法 | `#,##0;(#,##0);` → 零显示为空 ✅ |
| 倍数 | 1 位小数 + `x`（不加空格） | `0.0x`（`mult`）→ `8.5x` |
| 百分比 | 增长率 / 利润率 1 位小数，大表 0 位；负值 `(5.2%)` | `0.0%;(0.0%)` |
| 变动 | 显式正负号 | `+0.0%;-0.0%;0.0%`（`delta_pct`）→ `+5.2%` |
| bps | 0 位小数 | `#,##0" bps"`（`bps`） |
| 金额 | 百万 0 位（< 100 时 1 位）、bn 1 位、每股 2 位 | `$#,##0"m"`（`usd_m`）、`$#,##0.0"bn"`、`$#,##0.00`；Excel 货币标签 `[$€-407]` 会保留 `€` ✅ |
| 缩放 | 数位后的逗号每个 ÷1,000 | `$#,##0.0,,"m"` → `$1.2m` |
| 紧凑 | 自动 k / m / bn / tn | `auto` → `1.5bn` |
| 日期 | 表格 `dd mmm yyyy` / `dd-mmm-yyyy`；轴 `mmm-yy`；季度 `"Q"q yyyy` | `14 Oct 2026` / `Oct-26` / `Q4 2026` |
| 期间后缀 | 列头 `2025A / 2026E / LTM / NTM / 4Q'25E` | 写在字段 `title` 里 |
| 区间 | 两端各自格式化，中间用 en dash `–` | `$42.97 – $58.15`、`19.1x – 27.4x` |
| 中文单位 | 同一份报告只用一套：万 / 亿，或者 m / bn | `yyyy"年"m"月"d"日"` ✅；万 / 亿可通过改 `RK.format.config.compactUnits` 实现 🟡 |

### 5.2 单位放在哪里

- **单位行优先**：每页 subtitle 写 `USD m unless otherwise stated`，每张表的表头下写 `($m)` / `(x)` / `(%)`。数值本身不再带 `m`。
- **首行 / 合计行才带单位**：GS 的 DCF、AVP、precedents 表都是只有首行和合计行带 `$` / `x`，中间行只写数字（04 §0-7）。
  kit 计划提供 `unitOn: 'first+total'` ⬜。在那之前，表格里用不带单位的格式码，单位写到列头上。
- **Rounding to total**：份额、100% 堆叠、bridge 的标签必须满足"四舍五入后各项之和 = 显示的总计"，否则审阅时会出现 99.9% / 100.1%
  这种低级错误（think-cell TCROUND，https://www.think-cell.com/en/resources/manual/excel-data-rounding ）。
  waffle 已使用 largest-remainder ✅；通用 `roundToTotal()` 尚未进入 `rk.format` ⬜。

### 5.3 House style

各家银行的写法不同：GS 写 `$ 44.71`、`7.6 x`、`(0.9)%`，Rothschild 写 `$2.27`、`7.9x`、`(32%)`（04 §6.1）。kit 的默认值是
`$44.71` / `7.6x` / `(0.9%)` / `n.a.` / `n.m.`。`RK.format.config` 可以改 `na`、`nm`、`decimal`、`group`、`months`、`compactUnits`；
`currencySpace`、`multSpace`、`pctParen` 这类 house-style 开关 ⬜。

---

## 6. 图表规则 · Chart do / don't（IB）

### 6.1 Do

- **数据标签优先，少用轴**：think-cell 式柱图不画 y 轴和网格，柱顶直接标数（04 §5、§9）。
- **线末直接标注最新值**（ECharts `endLabel`），颜色与线相同；系列 ≤ 4 条时用直接标注代替图例（GS / MS 实证）。
- **时间序列**：用浅网格（`--rk-grid`）或不用网格；x 轴用 `mmm-yy` 均匀刻度；事件用字母标记或竖向引线 + `dd-mmm-yy` 标签。
- **Football field**：主方法用 `accent` / cat，reference-only 方法用浅色条，报价 / 现价用 `--rk-ref` 竖虚线 + 斜体标签，条两端标注数值。
- **Comps / precedents 表**：统计行（Max / 75th / Median / Mean / 25th / Min）加灰底（`comps-table` 目前支持 `stats: mean | median | high | low`，75th / 25th 分位行 ⬜）；目标行用 `accent2` 浅底 + 粗体；
  统计时排除 n.m. 和目标公司本身（`statsExcludeTarget: true` ✅）。
- **Sensitivity / comps 必须是 HTML table**：可选中、可复制到 Excel、打印清晰。不要用 canvas 画表（04 §13-16）。
- **双轴默认改成上下两个 pane，共用 x 轴**（multi-grid + 联动 dataZoom）。`combo` 组件默认 `layout: 'band'`，
  需要经典双轴时再设 `overlay`，并且两侧都要有轴标题和单位（04 §0-12）✅。
- **轴断裂**（ECharts 6 `breaks`）只用于有极端值的 bridge 或柱图，必须画出断裂标记并加脚注（06 §11）。
- **"Other" 归并**：donut 和 marimekko 超出可读数量的类别归入灰色 "Other"（`--rk-neutral` / cat-8）✅。
- **缩放不能劫持页面滚动**：普通滚轮滚动页面，Ctrl/Cmd + 滚轮或触控板捏合才缩放图表 ✅（`rk.chart.js`）。
- **打印用 SVG renderer**：`rk.chart.js` 默认就是 SVG。PDF 里是矢量，文字可选中（09 §8.1：canvas 在 PDF 中会变成 560×360 位图）✅。

### 6.2 Don't

| ✗ | 改用 |
|---|---|
| 3D 柱 / 3D 饼 / 地球仪 | 2D；超过 100k 点的散点才考虑 GL |
| 饼图超过 5–6 块、多个饼并排比较 | 横向排序条形图、100% 堆叠、waffle |
| 每家同业一个颜色 | 目标用 accent2，同业统一中性色，中位数用虚线 |
| 红 / 绿当分类色，或只用颜色表示增减 | pos / neg 只表示增减，并且必带符号 |
| 渐变填充、阴影、发光、霓虹、玻璃拟态 | 平涂、0.5–1px 细线、留白 |
| 水球图、速度表、词云、飞线 | bullet chart、KPI tile（delta + sparkline）、排序条形图、静态流向图 |
| 1920×1080 整页缩放 (scale-to-fit) 的大屏布局 | 12 栅格 + 打印页面尺寸 |
| 自动轮播表格、自动轮换 tooltip | 读者控制节奏：可排序的静态表 + 分页 |
| LLM 或用户文本进入 ECharts HTML formatter | kit 自己的 tooltip 渲染器 + `textContent` |
| 用 CSS `zoom` 缩放页面 | `transform: scale()`（`zoom` 会让 ECharts 命中错误的柱，09 §8.3） |

---

## 7. 动效 · Motion

原则："少而准"。图表动画交给 ECharts 自带的 animation 和 `universalTransition`；DOM 动效用原生能力
（CSS transition、WAAPI、IntersectionObserver、View Transitions），不引入第三方动画库（05 §TL;DR）。

| 场景 | 规则 | 实现 |
|---|---|---|
| Tokens | `--rk-dur: 520ms`、`--rk-dur-fast: 160ms`、`--rk-ease: cubic-bezier(.2,.7,.2,1)` | ✅ `tokens.css` |
| 图表入场 | 柱从基线生长、线从左到右画出；只在滚动进入视口时播一次 | ✅ ECharts `animationDuration: 900`、`cubicOut`；research 建议 600 ms（总时长 ≤ 900 ms）🟡 |
| 数据更新 | 从旧值补间到新值，不先清空再重画 | ✅ `animationDurationUpdate: 600`、`cubicInOut`（建议 400 ms 🟡） |
| 页面 / 卡片出现 | fade + 12px 上移，每页内 stagger 70 ms，最多 8 级；只播一次（`unobserve`） | ✅ `RK.motion.reveal` |
| KPI count-up | 首次出现时播一次，≤ 1.1 s，`aria-label` 写最终值；后台标签页直接显示终态 | ✅ `RK.motion.countUp` |
| 筛选 / 排序重排 | View Transitions（不支持时直接更新 DOM）；表格行用 FLIP | ✅ `RK.motion.swap` / `RK.motion.flip` |
| Hover / focus | focus + context：其它系列降到 20–30% 不透明度，150 ms | ECharts `emphasis.focus` |
| Reduced motion | 跟随系统设置实时切换（监听 `matchMedia` 的 change）；关闭后所有元素为终态 | ✅ `rk.motion.js` + `layout.css` |
| 打印 / PDF | 动画全部关闭；视口外尚未挂载的图表在打印前一次性挂载 | ✅ `beforeprint` / `matchMedia('print')` + `print.css` 强制 `.rk-reveal` 终态 |

**禁止**：parallax、3D 翻转、bounce / elastic 缓动、打字机效果、平滑滚动劫持（scroll-jacking，Lenis 一类）、
把关键数字绑定到 scroll-scrub（读者可能停在中间态，看到错误的数字）、数据区的循环动画、超过 1 s 的入场、每次滚回来都重播。
依据：Heer & Robertson 2007（https://idl.uw.edu/papers/animated-transitions ）、
NN/g 动画时长（https://www.nngroup.com/articles/animation-duration/ ）、05 §3.3。

截图、录屏、审阅时，建议用 URL 参数 `?motion=off` 强制关闭动画 ⬜（05 §3.6-2）。

---

## 8. 无障碍 · Accessibility

**已实现 ✅**
- 每个数据块的工具栏都有 "View data"（弹出完整表格）和 "Download CSV"，作为图表的文本替代。
- 控件有完整的 ARIA 语义：`role="radio"` + `aria-checked`（情景切换）、`aria-pressed`（图表内的模式切换按钮，如 `scatter`、`bubble`、`sensitivity-table`）、`aria-sort`（表格排序）、`aria-expanded` / `aria-activedescendant`
  （下拉）、`aria-valuetext`（滑块）、`aria-live`（查询结果）。`:focus-visible` 焦点环、键盘可操作。
- 数据标签颜色由 `RK.theme.textOn(fill)` 按 WCAG 对比度自动选深色或浅色，明暗主题都适用。
- 增减同时用 ▲▼ 箭头、符号和括号表达，颜色只是冗余编码；KPI 箭头带 `aria-hidden`，读屏只读数字。
- count-up 用 `aria-label` 提供最终值；遵守 `prefers-reduced-motion`。
- `<html lang>` 跟随 `report.locale`。

**规则**
- 文字 ≥ 4.5:1，图形标记 ≥ 3:1（§3.6）。不能只靠颜色区分系列：≤ 4 条线时直接标注，散点用形状或标签区分。
- 每页都要有表格替代；纯图片（logo、tombstone）要有 `alt`。
- 最小字号 10px（`--rk-fs-xs`），只能用于脚注和页脚；交互控件文字 ≥ 11px。

**缺口 ⬜**
- ECharts 的 `aria` 选项（自动生成图表描述和 decal 图案）尚未开启。建议在 `rk.chart.js` 里统一打开 `aria: {enabled: true}`。
  decal 只在单色打印模式下启用。
- bronze 的 `--rk-ink-3` 只有 4.22:1，slate 的 `--rk-pos` 只有 4.18:1（§3.6）。
- 打印成 PDF 后没有 tagged 结构；builder 走 Playwright 时可以加 `tagged=True, outline=True`（09 §8.1）。

---

## 9. 交付前设计 QA 清单

- [ ] 每页：action title（结论 + 数字，≤ 2 行）、units subtitle、Source、as-of、Notes 编号与表内标记一致、机密标记、页码。
- [ ] 只读导航栏里的标题，能读出完整故事线。
- [ ] 所有数字都经过格式码；负数用括号；n.a. / n.m. / – 的语义正确；n.m. 不参与统计且阈值写进了脚注。
- [ ] 份额类标签加总等于显示的总计；同一份报告里单位体系一致（m / bn 和 万 / 亿 不混用）。
- [ ] 每页数据色 ≤ 4–5 种；目标只用 accent2；参考线只用 ref；红绿必带符号。
- [ ] 组件里没有硬编码颜色；新主题已经跑过 validator 和 WCAG 检查。
- [ ] `prefers-reduced-motion` 和打印预览下，每页都显示终态，不出现半截动画；打印出来每页都是 16:9，没有内容被裁掉。
- [ ] `ink` 主题打印出来是浅色纸面。

---

## 10. 设计系统层面的待办（本次审阅发现）

| # | 项 | 位置 | 优先级 |
|---|---|---|---|
| 1 | navy / slate / ink 的 categorical slot 2–7 改成 §3.5 中已验证的顺序或色值；bronze、slate 的 ordinal 浅端加深 | `themes/*.css` | P0 |
| 2 | bronze `--rk-ink-3`、slate `--rk-pos` 提到 ≥ 4.5:1 | `themes/*.css` | P0 |
| 3 | validator vendor 到 `tools/`，接入 `check.sh`（categorical + ordinal + 文字对比度） | `tools/` | P1 |
| 4 | `rk.format`：`roundToTotal()`、`formatRange()`、`unitOn`、house-style 开关、万 / 亿 preset | `rk.format.js` | P1 |
| 5 | ECharts 入场和更新时长改为 600 / 400 ms；新增 `?motion=off` | `rk.theme.js` / `rk.motion.js` | P2 |
| 6 | ECharts `aria` + 单色打印 decal | `rk.chart.js` | P2 |
| 7 | DRAFT 章、Letter / A4 命名页面、`RK.theme.list` 从 `build.json` 注入 | `layout.css` / `print.css` / builder | P2 |
| 8 | 中文字体子集化（Noto Sans SC），以及 `zero` / `case` 等 OpenType 特性（上游 inter-ui） | builder / `kit/fonts` | P3 |

---

## 来源 · Sources

- 一手 pitchbook 样本（SEC EDGAR EX-99.(c)）：GS https://www.sec.gov/Archives/edgar/data/1274173/000110465926008735/tm2534023d8_ex99-civ.htm ·
  MS https://www.sec.gov/Archives/edgar/data/1634997/000119312524165806/d842696dex99c10.htm ·
  Evercore https://www.sec.gov/Archives/edgar/data/1863105/000119312523280779/d306045dex99cix.htm ·
  Rothschild https://www.sec.gov/Archives/edgar/data/1855457/000114036126014631/ny20068726x2_excii.htm
- 格式规范：Anthropic financial-services pitch-agent skills https://github.com/anthropics/financial-services/tree/main/plugins/agent-plugins/pitch-agent ·
  think-cell rounding https://www.think-cell.com/en/resources/manual/excel-data-rounding · FT Visual Vocabulary https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary
- 打印与 `file://`：MDN CORS not HTTP https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHTTP ·
  Chrome print margins https://developer.chrome.com/blog/print-margins
- 动效：https://idl.uw.edu/papers/animated-transitions · https://www.nngroup.com/articles/animation-duration/ ·
  View Transitions baseline https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
- 字体授权：Inter https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt · Source Serif https://raw.githubusercontent.com/adobe-fonts/source-serif/release/LICENSE.md
- 详细笔记：`research/raw/04-pitchbook-design.md`、`05-motion-ui.md`、`06-china-xhs.md`、`09-architecture.md`
