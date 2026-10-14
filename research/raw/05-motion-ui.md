# 05 · 动效 / UI 控件 / 图标 / 字体 — 原始调研笔记 (Motion, UI controls, icons, fonts)

> Angle: `05-motion-ui` · 调研日期 2026-10-14 · 作者: research subagent
> 目标: 为离线 (file://) 投行级 report kit 选出 **最小、依赖轻、许可证宽松** 的动效 / 控件 / 图标 / 字体组合。

## 0. 方法与可信度 (Method)

- **版本和许可证**: 全部用 `npm view <pkg> version license time[<ver>]` 在 2026-10-14 实时核对 (不是凭记忆)。
- **dist 结构和模块格式**: 用 jsDelivr data API (`https://data.jsdelivr.com/v1/packages/npm/<pkg>@<ver>?structure=flat`) 列文件，再下载每个 dist，`head` 检查 UMD/IIFE 包装和导出的 global 名字。
- **体积**: 下载后自己用 `gzip -9` 计算 min+gz (不是官网宣传值)。
- **GitHub 活跃度和 stars**: GitHub API 在本会话被网关拦截，改用 `repos.ecosyste.ms` 镜像数据，并用 WebFetch 打开 GitHub 页面核实 archived 状态。
- **file:// 实测**: 用本机 Playwright 自带的 **Chromium 141.0.7390.37** (headless)，以 `file://` 打开测试页，加载 20 个 UMD 包并实际初始化 (结果见 §1)。Firefox 和 Safari 没有实测，这部分写的是文献结论。
- **字体 OpenType 特性**: 用 `fontTools 4.67` 解析 woff2 的 GSUB feature 列表、`fvar` 轴和数字字宽 (判断默认等宽数字还是比例数字)。
- **tree-shaking 子集体积**: 用 `esbuild 0.28.2` 打 IIFE 子集包实测。

测试工件 (scratchpad，不在仓库里): `/tmp/claude-0/-home-user-visual-repo-202610/daf46e49-46d8-53fd-b25b-6ebd897edb84/scratchpad/{dl,fonts,filetest,bundle}`

---

## TL;DR · 结论与推荐的最小组合

**核心观点**: 投行报告的动效应该"少而准"。图表动画交给已 vendored 的 **ECharts 6.1.0** 自带的 animation / `universalTransition`。DOM 层动效用 **原生平台能力** (CSS transition、WAAPI `element.animate()`、IntersectionObserver、View Transitions API)，再加上 kit 现有的 `kit/core/rk.motion.js` (80 行，零依赖) 就够了，**核心不需要引入第三方动画库**。第三方库只用在原生做不好的交互控件上 (多选下拉、双柄范围滑块、浮层定位)。

| 角色 | 推荐 | 版本 (npm 核实) | License | min+gz | classic-script global | 备注 |
|---|---|---|---|---|---|---|
| 页面和卡片动效 | **原生**: CSS transition + WAAPI + IntersectionObserver (`RK.motion`) | — | — | 0 | — | kit 已有 `rk.motion.js`，建议补齐 §3.6 列的缺口 |
| 筛选切换过渡 | **View Transitions API** (`document.startViewTransition`) | Baseline 2025-10 | — | 0 | — | file:// 实测可用；不支持时直接更新 DOM |
| 图表动画 | **ECharts 内建** (`animationDurationUpdate`, `universalTransition`) | echarts 6.1.0 (已 vendored) | Apache-2.0 | 已含 | `echarts` | 不另加库 |
| 可选的 JS 动画引擎 | **Motion `motion/mini` + `inView` + `stagger`** (esbuild IIFE 子集) | motion 14.2.0 | MIT | **4.4 KB** | 自定 (如 `RKMotionLib`) | 只在需要 spring 或复杂时间线时才加；完整 UMD 51 KB |
| 多选/搜索下拉 | **Tom Select** | 2.6.2 (2026-07) | Apache-2.0 | 17.6 KB (+2.0 KB css) | `TomSelect` | 带插件: remove_button, checkbox_options, virtual_scroll |
| 区间滑块 | **noUiSlider** | 15.8.1 | MIT | 9.4 KB (+1.2 KB css) | `noUiSlider` | 双柄、pips、format，金融区间筛选的事实标准 |
| tooltip/popover 定位 | **Floating UI** (`core` + `dom` UMD) | dom 1.8.0 | MIT | 8.4 KB (两包合计) | `FloatingUICore`, `FloatingUIDOM` | CSS anchor positioning 作渐进增强 |
| 日期 (可选) | 原生 `<input type="date/month">` + 期间预设按钮；需要日历时用 **Air Datepicker** | 3.6.0 | MIT | 13.6 KB (+3.4 KB css) | `AirDatepicker` | flatpickr 自 2022 年没有发版 |
| 拖拽排序 (可选) | **SortableJS** | 1.15.7 | MIT | 15.0 KB | `Sortable` | 仪表板卡片/列重排 |
| 图标 | **Lucide** 为主 + **Tabler Icons** 补金融图标 | 1.57.0 / 3.49.0 | ISC (+MIT) / MIT | 只内联用到的图标 | — | **Python builder 把用到的图标内联成 `<symbol>` sprite**；外链 sprite 在 file:// 被拦 |
| 正文和数字字体 | **Inter** (建议用上游 `inter-ui` 4.1.1 的 variable latin subset) | 4.1.1 | OFL-1.1 (无 RFN) | ~100 KB woff2 | — | 保留 `tnum`/`zero`/`case`/`ss0x`/`cv0x`；Fontsource 版只剩 `tnum`/`pnum`/`frac` |
| 标题衬线 | **Source Serif 4** (variable) | @fontsource-variable 5.3.1 | OFL-1.1 (RFN "Source") | 51 KB latin wght | — | kit 已 vendor 静态版 |
| 中文 | **Noto Sans SC** variable (unicode-range 分片) 或 builder 按报告文字 **子集化** | @fontsource-variable 5.3.1 | OFL-1.1 (无 RFN) | 4.5 MB 全量分片；子集通常 <200 KB | — | 系统字体作 fallback |
| 等宽 (公式编辑器) | **JetBrains Mono** (variable) | 5.3.0 | OFL-1.1 | 40 KB latin | — | 只给公式/代码输入用；表格数字用 Inter `tnum` |

**明确不建议 (avoid)**:
- GSAP: 非 OSI 的 Webflow "no charge" license，可修改、可终止，附竞品条款。
- Lenis / Locomotive: 平滑滚动劫持，和 ECharts/Leaflet 的滚轮缩放冲突。
- AOS: 2018 年后没有发版。
- Tippy.js: 2024-11 archived。
- Shoelace: archived，迁到了 Web Awesome。
- Web Awesome: ESM-only，file:// 加载失败。
- Pico.css: **2026-10-04 archived**，官方声明不再维护。
- typed.js: 已改为 **GPL-3.0**。
- dotlottie-web: ESM + WASM，file:// 无法加载。

---

## 1. file:// 实测 (Playwright Chromium 141, headless)

测试页结构: `index.html` 加 `vendor/*.js` (20 个 UMD 包)、`fonts/*.woff2`、`data/d.json` 与 `data/d.js`、`icons/sprite.svg`、`js/mod.js` (ES module)。

| 测试项 | 结果 | 说明 |
|---|---|---|
| 20 个 UMD/IIFE classic `<script src>` | ✅ 全部挂上 global | gsap, ScrollTrigger, anime, Motion, Lenis, scrollama, countUp, lottie, TomSelect, Choices, noUiSlider, flatpickr, FloatingUICore/DOM, Sortable, lucide, SlimSelect, AirDatepicker, VanillaCalendarPro, Coloris |
| 实际初始化 | ✅ | `new TomSelect`, `noUiSlider.create`, `lucide.createIcons`, `anime.animate`, `Motion.animate`, `new countUp.CountUp().start()`, `gsap.to`, `document.startViewTransition` 全部成功 |
| `<script type="module">` | ❌ | `from origin 'null' has been blocked by CORS policy` |
| `fetch('data/d.json')` | ❌ | `URL scheme "file" is not supported` |
| 同步 XHR 读 JSON | ❌ | CORS 拦截 |
| `<script src="data/d.js">` (`window.RK_DATA = {...}`) | ✅ | **数据必须用 JS 包装 (JSONP 风格)**，这一点和其它 angle 的结论一致 |
| `@font-face url("fonts/x.woff2")` (子目录) | ✅ loaded | Chrome 允许 file:// 字体。Firefox 自 68.0.2 起也允许 (见 §6.5) |
| 外链 sprite `<use href="icons/sprite.svg#id">` | ❌ bbox 0×0 | `Unsafe attempt to load URL ... 'file:' URLs are treated as unique security origins.` |
| 内联 sprite `<use href="#id">` | ✅ 24×24 | **图标必须内联到 HTML (或由 classic JS 注入)** |
| `<img src="icons/x.svg">` | ✅ | 像素检测 84/576 个深色像素 |
| CSS `background-image: url(x.svg)` | ✅ | 同上 |
| CSS `mask-image: url(x.svg)` | ✅ (仅 Chromium 验证) | mask 是 CORS 型请求，Firefox/Safari 未测，不建议依赖 |
| `<object data="x.svg">` | ✅ | |
| Lottie `loadAnimation({path:'x.json'})` | ❌ | 内部用 XHR，被拦 |
| Lottie `loadAnimation({animationData: window.ANIM})` | ✅ | 动画 JSON 也要包成 `.js` |
| View Transitions (same-document) | ✅ `vt.finished` resolve | |
| Chromium 141 的特性检测 | ✅ | `anchor-name`、`animation-timeline: view()`、`popover`、`CSSStartingStyleRule`、`appearance: base-select`、`interpolate-size` 全部支持 |

**对 kit 的约束 (要写进 builder)**:
1. 所有第三方库只用 UMD/IIFE 构建；ESM-only 的库要在 vendor 阶段用 esbuild 预打成 IIFE (见 §2.11)。
2. 数据、Lottie JSON、图标 sprite 一律输出成 `.js` 或内联进 HTML。
3. 字体放在 `index.html` 的同级或子目录 (`fonts/`、`vendor/fonts/`)，**不能放在父目录** (Firefox 只允许同目录和子目录)。可加一个 builder 选项 `--embed-fonts`，把字体 base64 内联进 CSS，作为单文件的保底方案。

---

## 2. 动画库 (Animation libraries)

### 2.1 版本 / 许可证 / 体积总表 (2026-10-14 核实)

| 库 | npm | 最新版 | 发布日期 | License | classic-script 文件 → global | min (raw) | min+gz | GitHub stars / 状态 |
|---|---|---|---|---|---|---|---|---|
| GSAP core | `gsap` | 3.15.0 | 2026-04-13 | **"Standard 'no charge' license"** (非 OSI) | `dist/gsap.min.js` → `gsap` | 72.9 KB | 28.3 KB | 28.9k, active |
| GSAP ScrollTrigger | `gsap` | 3.15.0 | — | 同上 | `dist/ScrollTrigger.min.js` → `ScrollTrigger` | 44.6 KB | 18.0 KB | (gsap + ST = 45.6 KB gz) |
| anime.js | `animejs` | 4.5.0 | 2026-06-22 | MIT | `dist/bundles/anime.umd.min.js` → `anime` | 118 KB | 40.6 KB | 73.4k, active |
| Motion (原 Framer Motion) | `motion` | 14.2.0 | 2026-10-13 | MIT | `dist/motion.js` → `Motion` | 154 KB | 51.3 KB | 34.1k, very active |
| Lenis | `lenis` | 1.3.26 | 2026-08-05 | MIT | `dist/lenis.min.js` → `Lenis` (globalThis) | 18.7 KB | 5.4 KB | 16.5k |
| Scrollama | `scrollama` | 3.2.0 | 2022-06-17 | MIT | `build/scrollama.min.js` → `scrollama` | 4.8 KB | 2.1 KB | 6.0k (repo `russellsamora/scrollama`, last push 2025-11) |
| AOS | `aos` | 2.3.4 | **2018-10-03** | MIT | `dist/aos.js` → `AOS` | 14.7 KB | 4.7 KB | 28.1k, stale (3.0 beta 一直没有正式版) |
| CountUp.js | `countup.js` | 2.10.1 | 2026-07-02 | MIT | `dist/countUp.umd.js` → `countUp.CountUp` | 7.1 KB | 2.3 KB | 8.2k |
| NumberFlow | `number-flow` | 0.6.2 | 2026-07-18 | MIT | ❌ 只有 ESM/CJS；esbuild IIFE 后 5.2 KB gz | — | 5.2 KB (IIFE) | 7.7k |
| lottie-web | `lottie-web` | 5.13.0 | 2025-05-21 | MIT | `build/player/lottie_light.min.js` → `lottie` | 168 KB | 46.4 KB | 32.2k, slowing |
| dotLottie web | `@lottiefiles/dotlottie-web` | 0.81.0 | 2026-10-06 | MIT | ❌ ESM + 1.2 MB WASM | — | 33 KB + wasm | 0.9k |
| auto-animate | `@formkit/auto-animate` | 0.10.0 | 2026-07-10 | MIT | ❌ ESM (`index.min.js`)，需 IIFE 预打包 | 8.4 KB | 3.3 KB | 13.9k |
| Locomotive Scroll | `locomotive-scroll` | 5.0.1 | 2026-01-15 | MIT | `bundled/locomotive-scroll.min.js` | 37 KB | 9.6 KB | (基于 Lenis) |
| Swup | `swup` | 4.10.0 | 2026-09-03 | MIT | `dist/Swup.umd.js` | 25.7 KB | 8.4 KB | 5.2k (MPA 页面切换，不适用) |
| ScrollMagic | `scrollmagic` | 2.0.9 | 2026-02-20 | (MIT OR GPL-3.0+) | — | — | — | legacy |
| typed.js | `typed.js` | 3.0.0 | 2026-01-24 | **GPL-3.0** | — | — | — | ⚠ avoid |

### 2.2 GSAP 许可证详解 (Webflow 收购后)

来源: <https://gsap.com/standard-license> (标题 "Standard 'No Charge' GSAP License"，生效于 2025-04-30，最后修改于 2025-05-30)。npm 的 `license` 字段原文是 `"Standard 'no charge' license: https://gsap.com/standard-license."`。dist 文件头写着 `@license Copyright 2026, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license.`

- **允许**: "use, reproduce, display, and implement GSAP Products solely for Permitted Uses"，适用于 "any website, web application, or digital interface by any person or entity"。FAQ 明确写 "Commercial usage is covered under the standard license"。原先付费的 Club 插件 (SplitText、MorphSVG 等) 也都免费 (FAQ 点名了 SplitText 和 MorphSVG；DrawSVG、ScrollSmoother 按 "GSAP Products" 的定义同样包含)。
- **禁止 (Prohibited Uses)**: 在 "tools that allow users to build visual animations without code" 中使用，且该工具 "encourages, induces, or materially assists in creating a solution that competes with Webflow's" 动画能力 → 需要 Webflow **事先书面同意**。也禁止为做竞品去 reverse engineer，禁止删除 proprietary notices。FAQ 说明 "AI-generated code is not a 'Prohibited Use'"。
- **旧版条款**: 2025 以前的 "no charge" 许可还有一条 "end users 不能被收费，否则要买 Business Green"。**新版已经去掉**，所以新版对 SaaS 收费没有限制。网上不少文章还在引用旧条款，要注意区分。
- **风险点 (对本项目)**:
  1. **非 OSI、非 permissive**，不符合项目 "permissive only" 的硬规则。
  2. Webflow 可以 "update the license at any time by posting the revised terms"，继续使用即视为接受 (不接受的话可以继续用旧版本)。
  3. Webflow 可 "in its discretion" 终止，终止后必须 "cease all use ... and destroy all copies"。
  4. 本项目 Step 2 计划让客户输入 metric/formula、导入 "skills"、接本地 LLM。如果将来 kit 演变成 "让用户无代码配置动画" 的工具，可能落入 Prohibited Uses 的灰区。
  5. 再分发 (把 gsap.min.js 打包进交付给客户的文件夹) 没有被逐字授权，只能从 "reproduce/implement" 推出来。
- **结论**: **avoid 作为 kit 依赖**。技术上 GSAP 依然是最强的时间线引擎，可以作为效果参考 (ScrollTrigger 的 pin/scrub 思路、Flip 的 FLIP 思路)，但用 MIT 方案实现。

### 2.3 anime.js v4 (MIT)

- v4 是彻底重写的 ESM-first 版本，API 从 `anime({...})` 变成 `animate(targets, params)`。UMD bundle 一次性暴露全部模块 (实测 global `anime` 上的成员): `animate, createTimeline, createTimer, createAnimatable, createDraggable, createLayout, createScope, createSpring, spring, onScroll, splitText, scrambleText, stagger, svg, text, utils, waapi, eases, engine`。
- 近期版本 (GitHub releases):
  - v4.3.0 (2026-01-20): 新增 `createLayout()` (FLIP 式布局动画)、max fps 240。
  - v4.4.0 (2026-04-29): **breaking**，改了 transform 顺序和 stagger 回调参数 (`total`→`targets`)；新增 `scrambleText()`、`grid:true` 自动网格 stagger、`revert()` 能还原属性。
  - v4.5.0 (2026-06-22): `registerAdapter()` 支持非 DOM 目标 (自带 three.js adapter)；stagger 新增 3D grid、`jitter`、`seed`。
- `waapi.animate()` 是走浏览器 WAAPI 的轻量版本 (硬件加速)，子集 IIFE (`waapi` + `stagger`) 实测 **7.8 KB gz**。
- tree-shaking 子集 (`animate, stagger, createTimeline, utils`) 打成 IIFE 是 **17.0 KB gz**，完整 UMD 是 40.6 KB gz。
- 适用场景: SVG 描线 (`svg.createDrawable`)、复杂时间线、拖拽物理效果。报告里很少需要。
- **verdict: consider**。如果 kit 将来要 "动画化的 storytelling 页" (类似 Pudding)，它是 MIT 阵营里功能最全的 all-in-one。注意 v4.x 的小版本里有 breaking change，**必须锁定版本**。

### 2.4 Motion (motion.dev, MIT)

- `motion@14.2.0` 发布于 2026-10-13，和 `framer-motion@14.2.0` 同步发版。**major 版本迭代很快** (一年内从 v12 到 v14)，vendor 时必须锁定。
- vanilla UMD `dist/motion.js` 的 global 是 `Motion`，导出 `animate, animateView, hover, inView, press, scroll, spring, stagger`。
  - `animateView` 封装了 View Transitions API，支持 spring 和中断排队；浏览器不支持时 "the DOM update still runs, it just isn't animated"。
- 体积: 完整 UMD 51.3 KB gz。**`motion/mini` 的 `animate` (纯 WAAPI) + `inView` + `stagger` 用 esbuild 打 IIFE 后是 4.4 KB gz**，适合 kit 的可选增强。只用 `animate, inView, stagger` 的完整引擎版是 24.6 KB gz。
- 许可证: 核心库是 MIT (LICENSE.md 写 "Copyright (c) 2024 Motion B.V.")。**Motion+** 是付费产品 (Personal 一次性买断，或 Business 按席位年付)，包括 450+ examples、Cursor/Ticker 等 premium API 和 transition editor。免费包里没有 Motion+ 的东西，不会误用。
- **verdict: consider** (首选的可选 JS 引擎，用 `motion/mini` 子集)。

### 2.5 Lenis / Locomotive Scroll (平滑滚动) — avoid

- Lenis 1.3.26 (MIT, 5.4 KB gz, global `Lenis`)。Locomotive v5 也是基于 Lenis。
- **为什么不适合投行报告**:
  1. 它劫持 wheel 事件做惯性平滑。报告里大量 ECharts `dataZoom` (滚轮缩放) 和 Leaflet 地图滚轮缩放，每个容器都得加 `data-lenis-prevent`，很容易漏掉。
  2. 降低可访问性和可预期性，投行客户用触控板或鼠标精确翻页时会觉得 "飘"。
  3. 和 `position: sticky` 加 IntersectionObserver 的 scrollytelling 可以共存，但没有必要。
- Pudding 的文章明确说过 scrollytelling 应该 "monitor scroll rather than hijack it (scrolljacking)"。

### 2.6 Scrollama 和 scrollytelling

- Scrollama 3.2.0 (MIT, 2.1 KB gz, global `scrollama`)。基于 IntersectionObserver，提供 step enter/exit、`progress`、`offset`、`debug`，v3 内置 ResizeObserver。npm 最近一次发布是 2022 年，但 API 已经稳定，仓库 2025-11 仍有 push。
- **业界做法 (实际查了 package.json 和源码)**:
  - **The Pudding** `svelte-starter` 的依赖: `svelte@5`, `@sveltejs/kit`, `d3@7.9`, `@lucide/svelte`, `bits-ui`, `archieml`, `style-dictionary`，**没有任何动画库**。它的 `Scrolly.svelte` 只有约 80 行 **原生 IntersectionObserver** ("most in view" 算法: 每个 step 用 0..1 共 100 个 threshold 记录 `intersectionRatio`，取最大值)。
  - **Reuters Graphics** `graphics-components` 的依赖: `@lottiefiles/dotlottie-web` (scrollytelling 里的 Lottie 视频化动画)、`svelte-intersection-observer`、`maplibre-gl`、`@fortawesome/free-*-svg-icons`、`d3-geo`、`topojson-client`。**同样没有 GSAP/anime 之类的库**。
  - NYT: Svelte 本身就出自 NYT graphics 团队 (Rich Harris)，Layer Cake 出自 NYT 的 Michael Keller。动效主要靠 Svelte transition/tweened 和 d3-transition。
- **结论**: 顶级数据新闻团队的模式是 **框架自带 transition (或 d3-transition) + 原生 IntersectionObserver + sticky 布局**，不用重型动画库。kit 应该照搬这个模式: `RK.scrolly(container, {steps, onStep, onProgress})` 自己实现大约 60–80 行，Scrollama 只作为备选。
- **verdict: Scrollama consider**；用自研 IO 加 `position: sticky` 实现是推荐方案。

### 2.7 AOS / sal.js — avoid

- AOS 2.3.4 在 2018 年后就没有发版，sal.js 0.8.5 停在 2021 年。功能就是 "滚动到视口时加 class"，kit 的 `RK.motion.reveal()` 已经实现了 (IO + CSS class + `--rk-delay` stagger + 减弱动效 + 打印覆盖)。

### 2.8 KPI 数字动画: CountUp.js / NumberFlow / 自研

- **CountUp.js 2.10.1** (MIT, 2.3 KB gz, `countUp.CountUp`)。选项 (从源码 grep 到): `startVal, decimalPlaces, duration, useGrouping, useIndianSeparators, useEasing, smartEasingThreshold, smartEasingAmount, separator, decimal, prefix, suffix, enableScrollSpy, scrollSpyDelay, scrollSpyOnce, autoAnimate, autoAnimateDelay, autoAnimateOnce, onStartCallback, onCompleteCallback, plugin, numerals, formattingFn, easingFn`。
- **NumberFlow 0.6.2** (MIT): 一个 `<number-flow>` custom element，每一位数字像里程表那样滚动，并且用 `Intl.NumberFormat` 格式化。很适合 **数据变化时** 的 KPI 更新 (而不仅仅是首屏)。只有 ESM/CJS，用 esbuild IIFE 打包后 5.2 KB gz。
- **kit 现状**: `RK.motion.countUp(el, to, {format})` 已经基于 `RK.format` (kit 自己的格式化代码) 做 rAF 补间。**建议保持自研** (格式化必须和 kit 的 format code 一致，CountUp 的格式化体系是另一套)。可以借鉴的改进:
  1. 动画期间强制 `font-variant-numeric: tabular-nums`，防止数字宽度抖动 (kit 的 `.rk-num` 已有)。
  2. **a11y**: 动画中的文本会被屏幕阅读器反复播报。给容器加 `aria-label="<最终值>"`，动画 span 设为 `aria-hidden="true"`。
  3. 从旧值补间到新值 (筛选变化时)，而不总是从 0 开始。
  4. 正负变化时用 120ms 的背景色 flash (绿/红 10% alpha) 再淡出。这在交易终端里很常见，也足够专业。
- **verdict**: CountUp 定为 reference；NumberFlow 定为 consider (如果要 "数字滚轮" 效果)。

### 2.9 Lottie

- lottie-web 5.13.0 (MIT)。`lottie_light.min.js` (只有 SVG renderer，没有 expressions) 是 46.4 KB gz。**file:// 下 `path:` 加载失败**，必须用 `animationData` (把 JSON 包成 .js)。Airbnb 仓库的活跃度在下降 (最后 push 2025-09)，LottieFiles 主推 dotLottie。
- dotlottie-web 0.81.0 是 ESM 加 1.2 MB WASM，file:// 下 WASM 的 fetch 会失败，所以 **avoid**。
- 报告场景里 Lottie 只适合封面品牌动画或 loading 动画，价值低、体积大，所以 **avoid** (除非品牌部门提供素材)。

### 2.10 原生平台能力 (Web platform) — 首选

| 能力 | 支持情况 (2026-10) | file:// | kit 用法 |
|---|---|---|---|
| CSS transitions/animations | 全支持 | ✅ | 悬停、展开、reveal (已有) |
| **WAAPI** `el.animate(keyframes, opts)`、`anim.finished`、`document.getAnimations()` | Baseline 2020+ | ✅ | 程序化动画、stagger、打印前 `finish()` |
| **IntersectionObserver** | Baseline 2019 | ✅ | reveal、图表懒挂载、scrollytelling |
| **View Transitions (same-document)** `document.startViewTransition(cb)` | **Baseline Newly available 2025-10** (Chrome/Edge 111, Safari 18, Firefox 144) | ✅ 实测 | 筛选和 tab 切换、KPI 卡重排、主题切换 |
| View Transitions (cross-document, `@view-transition`) | Chrome 126+, Safari 18.2+；Firefox 状态各来源说法不一 | ⚠ 未测；file:// 是 opaque origin，大概率不行 | 不用 (报告是单页) |
| `view-transition-class`, `match-element` | Firefox 144 一起带来 | ✅ | 批量给卡片命名 |
| **@starting-style** 加 `transition-behavior: allow-discrete` | Baseline 2024 (Chrome 117, Safari 17.5, Firefox 129) | ✅ | `<dialog>`、popover 的入场动画 (不用 JS) |
| **Popover API** (`popover` 属性) | Baseline 2024 (Chrome 114, Safari 17, Firefox 125) | ✅ | 下拉、菜单、说明浮层 |
| **CSS Anchor Positioning** | **Baseline Newly available 2026-01** (Chrome 125, Safari 26, **Firefox 147**) | ✅ (Chromium 实测 `CSS.supports`) | tooltip 和 popover 定位；旧浏览器回退到 Floating UI |
| `interestfor` (hover 触发 popover) | 实验性，Chromium-only | — | 暂不用 |
| **Scroll-driven animations** (`animation-timeline: scroll()/view()`) | Chrome 115+, Safari 26+；**Firefox stable 仍在 flag 后** (非 Baseline) | ✅ | 只在 `@supports` 里做阅读进度条之类的装饰；**默认样式要等于终态** |
| `appearance: base-select` (可定制 `<select>`) | Chrome 135+；Firefox/Safari 未确认 | ✅ | 渐进增强单选下拉的样式 |
| `interpolate-size: allow-keywords` (`height:auto` 动画) | Chromium 129+ | ✅ | 折叠面板，渐进增强 |
| `prefers-reduced-motion` | 全支持 | ✅ | 必须遵守 (kit 已做) |

> **企业环境注意**: 投行客户常用的是被 IT 锁定的 Chrome/Edge (通常落后 1–2 个版本)，或 Firefox ESR。所有 2025–2026 才 Baseline 的特性 (View Transitions、anchor positioning) **都要做特性检测和回退**，不能作为功能的前提。

### 2.11 ESM-only 库 → IIFE 的 vendor 管线 (实测)

esbuild 0.28.2，`--bundle --minify --format=iife --global-name=X`:

| 子集入口 | IIFE raw | IIFE gz | 对比完整 UMD |
|---|---|---|---|
| `motion/mini` 的 `animate` + `motion` 的 `inView, stagger` | 10.6 KB | **4.4 KB** | 51.3 KB |
| `motion` 的 `animate, inView, stagger` (完整混合引擎) | 65.8 KB | 24.6 KB | 51.3 KB |
| `animejs` 的 `animate, stagger, createTimeline, utils` | 43.0 KB | 17.0 KB | 40.6 KB |
| `animejs` 的 `waapi, stagger` | 18.0 KB | 7.8 KB | 40.6 KB |
| `number-flow` (自注册 custom element) | 15.8 KB | 5.2 KB | 无 UMD |

建议给 `tools/vendor.py` 增加一种 `"build": {"entry": "...", "global": "..."}` 类型的条目，在 vendor 阶段一次性 IIFE 化，产物提交进 `vendor/`，**运行时不依赖构建工具**。这条管线同样适用于 CodeMirror 6 (公式编辑器，ESM-only)。

---

## 3. 什么样的动效 "专业"？(投行和顶级数据新闻的实践)

### 3.1 依据

- **Heer & Robertson 2007, "Animated Transitions in Statistical Data Graphics"** (InfoVis): 受控实验表明，设计良好的动画过渡能显著提升图形感知。原则分两组:
  - **Congruence**: 过渡过程中图形保持合法、语义映射一致、保持对应关系、避免歧义。
  - **Apprehension**: 把相似变化分组、尽量减少遮挡、可预测、slow-in/slow-out、简单过渡、复杂变化 **分阶段 (staging)**、"keep transitions only as long as needed"。
  - 典型 staging 示例: 先移动 x 坐标并更新坐标轴，再把点变形为柱。
- **NN/g "Executing UX Animations: Duration and Motion Characteristics"**:
  - 大多数 UI 动画在 100–500 ms 之间，取 "the shortest time that an animation can take without being jarring"。
  - 简单反馈 (toggle、checkbox) 约 100 ms；较大的屏幕变化 (例如 modal) 200–300 ms；大屏大位移最多约 400 ms；500 ms 起 "feel like a real drag"。
  - 入场比出场略长 (例如 300 ms 入、200–250 ms 出)；入场用 ease-out；避免 linear。
- **scrollytelling 的分类** (data.europa.eu 数据可视化指南，引用 2022 年对 50 个案例的研究): 分为 graphic sequence、animated transitions、pan/zoom、scroll through movie、auto-play。动画可以是 "fully controlled by scroll position" (scrub) 或 "only triggered by scroll position" (trigger)。**报告类建议用 trigger，不用 scrub** (scrub 在触控板上难以停在精确的状态)。

### 3.2 保持专业的效果 (Do) — 投行 pitchbook 风格

1. **图表入场**: 柱从 baseline 生长，线条从左向右 "draw-on"，饼和环按角度展开。单图 400–700 ms，多系列 stagger 30–60 ms，总时长 ≤ 900 ms。ECharts 的对应配置:
   - `animationDuration: 600`
   - `animationEasing: 'cubicOut'`
   - `animationDelay: (idx) => idx * 30`
2. **数据更新** (筛选、切换期间、切换币种): 从旧值补间到新值，不要先清空再重画。ECharts 配置:
   - `animationDurationUpdate: 400`
   - `animationEasingUpdate: 'cubicInOut'`
   - series 加 `universalTransition: true`，用于同一数据在柱、饼、散点之间变形 (按 `dataGroupId`/`groupId` 对应)
   - 排名变化用 bar race 的 `realtimeSort`
3. **焦点加上下文 (focus+context)**: hover 某个 series 时其它 series 降到 20–30% 不透明度 (ECharts 的 `emphasis.focus: 'series'` 加 `blur`)。图例联动、地图和表格联动高亮，过渡时长 150 ms。
4. **KPI count-up**: 只在首屏出现时播一次 (≤ 1.1 s，ease-out quart)，之后数据变化用补间加 120 ms 的正负色 flash。
5. **卡片和章节 reveal**: fade 加 8–12 px 上移，每页内 stagger 70 ms，最多 8 级 (kit 已有)。
6. **筛选结果重排**: 用 View Transitions 给卡片设置 `view-transition-name`，由浏览器做 FLIP 重排；或用 WAAPI 手写 FLIP。时长 200–250 ms。
7. **Tooltip**: 出现 120 ms fade，加 4 px 位移；消失 80 ms。不要有弹跳。
8. **骨架屏 (skeleton)**: 只用在异步数据 (Step 2 接 API 时)，脉冲动画用 1.2 s 的低对比度 shimmer。

### 3.3 不专业、应该避免的效果 (Don't)

- parallax、3D 翻转、弹跳和 elastic 缓动 (`easeOutBack`、`elastic`)、粒子、打字机效果 (而且 typed.js 已是 GPL)。
- scroll-jacking 和平滑滚动劫持 (Lenis)、scroll-scrub 绑定关键数字 (读者可能停在中间态，读到错误的数字)。
- 超过 1 s 的入场、每次滚动回来都重播 (应该 `unobserve`，只播一次)。
- 让关键信息依赖动画才可见。打印、PDF、减弱动效的情况下必须直接是终态。
- 循环动画 (呼吸灯、跑马灯) 出现在数据区域。

### 3.4 Motion tokens 建议 (和 kit 的 `tokens.css` 对齐)

```css
:root {
  --rk-dur-instant: 80ms;   /* hover 颜色、按下 */
  --rk-dur-fast: 150ms;     /* tooltip、tab 指示条 */
  --rk-dur: 240ms;          /* 卡片 reveal、popover、filter 结果重排 */
  --rk-dur-chart: 600ms;    /* 图表首次入场 (ECharts animationDuration) */
  --rk-dur-chart-update: 400ms; /* 图表数据更新 */
  --rk-ease: cubic-bezier(.2, 0, 0, 1);        /* emphasized decelerate，入场 */
  --rk-ease-exit: cubic-bezier(.3, 0, 1, 1);   /* 出场 */
  --rk-ease-std: cubic-bezier(.2, 0, .2, 1);   /* 位置互换 */
  --rk-stagger: 70ms;
}
@media (prefers-reduced-motion: reduce) {
  :root { --rk-dur-fast: 0ms; --rk-dur: 0ms; --rk-dur-chart: 0ms; --rk-dur-chart-update: 0ms; }
}
```

ECharts 侧: `RK.theme` 生成 option 时，从 `getComputedStyle` 读出这些 token 再映射。`RK.motion.reduced === true` 时直接设 `animation: false`。

### 3.5 代码模式 (classic script, 零依赖)

**筛选切换 + View Transitions (带回退)**

```js
RK.motion.swap = function (update) {
  if (!RK.motion.enabled || !document.startViewTransition) { update(); return Promise.resolve(); }
  var vt = document.startViewTransition(update);
  return vt.finished.catch(function () {});   // 被新的 transition 打断时 AbortError 吞掉
};
// 用法: RK.motion.swap(() => renderTable(filtered));
// CSS: .rk-card { view-transition-name: match-element; view-transition-class: card; }
//      ::view-transition-group(*.card) { animation-duration: var(--rk-dur); animation-timing-function: var(--rk-ease); }
```

**WAAPI stagger (不引库)**

```js
function staggerIn(els, opts) {
  opts = opts || {};
  return Promise.all([].map.call(els, function (el, i) {
    return el.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: opts.duration || 240, delay: i * (opts.step || 40), easing: 'cubic-bezier(.2,0,0,1)', fill: 'backwards' }
    ).finished;
  }));
}
```

**打印和 PDF 前把所有动画推到终态 (kit 缺口，见 §3.6)**

```js
window.addEventListener('beforeprint', function () {
  document.getAnimations().forEach(function (a) { try { a.finish(); } catch (e) {} });
  RK.bus.emit('print:before');   // 让图表组件: 挂载所有未挂载的图表，setOption({animation:false})，然后 resize()
});
```

### 3.6 对现有 `kit/core/rk.motion.js` 的审阅意见 (只读审阅，未修改)

现状: reveal (IO 加 class 加 stagger)、countUp (rAF 加 RK.format)、tween，减弱动效时关闭；print.css 强制 `.rk-reveal` 显示终态。方向正确。缺口如下:

1. **图表 "滚动到视口才挂载" 会导致打印和 PDF 时视口外的图表是空白**。需要 `beforeprint` 和 `matchMedia('print').addEventListener('change')` 钩子，一次性挂载全部图表，设置 `animation:false` 并 `resize()` 到打印宽度。用 Playwright 导出 PDF 时，要先 `page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })`，再等待 `RK.ready`。
2. `reduced` 只在加载时计算一次。应该监听 `matchMedia('(prefers-reduced-motion: reduce)')` 的 `change` 事件，并提供 URL 参数 `?motion=off` (截图、审阅、录屏时使用)。
3. 增加 `RK.motion.swap()` (View Transitions 封装，见上)，作为所有筛选和数据变化重渲染的统一入口。
4. countUp 加上 a11y 处理 (`aria-label` 写最终值) 和 "旧值到新值" 的补间。
5. `document.hidden` 时跳过动画，直接设终态 (后台标签页里 rAF 会被节流，导致动画延迟到切回来才播放)。

---

## 4. UI 控件 (filters / inputs)

### 4.1 总表

| 控件 | npm | 版本 / 日期 | License | classic file → global | JS gz | CSS gz | 状态 | verdict |
|---|---|---|---|---|---|---|---|---|
| **Tom Select** | `tom-select` | 2.6.2 / 2026-07-07 | Apache-2.0 | `dist/js/tom-select.complete.min.js` → `TomSelect` | 17.6 KB (base 14.8 KB) | 2.0 KB | active, 2.2k★ | **adopt** |
| Choices.js | `choices.js` | 11.2.4 / 2026-08-23 | MIT | `public/assets/scripts/choices.min.js` → `Choices` | 20.8 KB | 2.4 KB | active, 6.8k★ | consider |
| Slim Select | `slim-select` | 4.6.1 / 2026-10-13 | MIT | `dist/slimselect.js` (UMD) 或 `.iife.js` → `SlimSelect` | 19.3 KB | 2.8 KB | active, 1.3k★ | consider |
| **noUiSlider** | `nouislider` | 15.8.1 / 2024-06-21 | MIT | `dist/nouislider.min.js` → `noUiSlider` | 9.4 KB | 1.2 KB | 稳定, 5.8k★ | **adopt** |
| flatpickr | `flatpickr` | 4.6.13 / **2022-04-14** | MIT | `dist/flatpickr.min.js` → `flatpickr` | 14.4 KB | 3.0 KB | 停滞 (最后 push 2024-08), 16.5k★ | reference |
| **Air Datepicker** | `air-datepicker` | 3.6.0 / 2025-05-18 | MIT | `air-datepicker.js` → `AirDatepicker` | 13.6 KB | 3.4 KB | 2.9k★ | consider (首选日历) |
| Vanilla Calendar Pro | `vanilla-calendar-pro` | 3.4.0 / 2026-09-22 | MIT | `index.js` (UMD) → `VanillaCalendarPro.Calendar` | 25.0 KB | 5.6 KB | active, 1.3k★ | consider |
| Cally | `cally` | 0.9.2 / 2026-02 | MIT | ❌ ESM-only web component | 12.3 KB | — | — | reference |
| **Floating UI** | `@floating-ui/dom` (+`@floating-ui/core`) | 1.8.0 / 2026-07-11 | MIT | `floating-ui.core.umd.min.js` → `FloatingUICore`，`floating-ui.dom.umd.min.js` → `FloatingUIDOM` (先加载 core) | 8.4 KB (合计) | — | active, 32.8k★ | **adopt** |
| Tippy.js | `tippy.js` | 6.3.7 / 2021-11 | MIT | `tippy-bundle.umd.min.js` + popper | 8.6 + 7.4 KB | — | **archived 2024-11-09** | avoid |
| SortableJS | `sortablejs` | 1.15.7 / 2026-02-11 | MIT | `Sortable.min.js` → `Sortable` | 15.0 KB | — | 31.2k★ | consider |
| Web Awesome | `@awesome.me/webawesome` | 3.14.0 / 2026-09-24 | MIT (free 部分；Pro 付费) | ❌ `webawesome.loader.js` 是 ESM `import` 链 | — | — | 1.4k★ (Fonticons 公司) | avoid (file://) |
| Shoelace | `@shoelace-style/shoelace` | 2.20.1 / 2025-03 | MIT | ❌ ESM | — | — | **archived** (→ Web Awesome) | avoid |
| Tabler (UI kit) | `@tabler/core` | 1.6.1 / 2026-09-28 | MIT | `dist/js/tabler.min.js` (39 KB gz) + `tabler.min.css` (**635 KB raw**) | 39 KB | 大 | 41.8k★ | reference (视觉参考) |
| Pico.css | `@picocss/pico` | 2.1.1 / 2025-03 | MIT | `css/pico.min.css` | — | 11.6 KB | **archived 2026-10-04，"no longer maintained"** | avoid |
| Coloris | `@melloware/coloris` | 0.25.0 / 2025-06 | MIT | `dist/umd/coloris.min.js` → `Coloris` | 5.4 KB | ~2 KB | 0.6k★ | consider (主题取色，可选) |
| a11y-dialog | `a11y-dialog` | 8.1.5 / 2026-02 | MIT | `dist/a11y-dialog.min.js` | 1.9 KB | — | — | reference (原生 `<dialog>` 已够用) |
| CodeMirror 6 | `@codemirror/view` 等 | 6.43.14 / 2026-10-07 | MIT | ❌ ESM-only，需 esbuild IIFE | — | — | — | reference (公式编辑器，交叉见 formula angle) |

### 4.2 下拉选择: Tom Select (adopt)

- Apache-2.0 属于 permissive。分发时要附 LICENSE (项目里没有 NOTICE 文件)。
- 关键能力: 多选 tag、搜索 (内置 sifter 打分和高亮)、`optgroup`、`create` (允许输入新值，适合 "自定义 ticker")、远程 `load` (Step 2 接 API)、插件 `remove_button`、`checkbox_options`、`clear_button`、`dropdown_input`、`virtual_scroll` (几千个证券或国家时需要)、`caret_position`。
- `tom-select.complete.min.js` 含全部插件 (17.6 KB gz)，`base` 加单独插件需要分别加载，所以 **建议直接用 complete**。CSS 用 `tom-select.min.css`，再用 kit 的 CSS 变量覆盖成 pitchbook 风格。
- 对比: Choices.js 体积略大，默认风格更 "消费级"；Slim Select 很活跃，但社区较小。三者都能在 file:// 下工作 (已实测加载)。
- 单选、少量选项的场景: **原生 `<select>`**，在 Chromium 135+ 用 `appearance: base-select` 渐进美化，其它浏览器保持原生样式，这对企业用户反而更熟悉。

### 4.3 区间滑块: noUiSlider (adopt)

- 双柄 (`start: [min, max]`、`connect: true`)、`step`、`margin/limit/padding`、`pips` (刻度)、`tooltips`、`format` (可以接 kit 的 `RK.format`)、键盘可访问、`behaviour: 'tap-drag'`。事件 `update/change/slide/set`。
- 金融用例: 市值区间、P/E 区间、期间年份区间。可以与 ECharts `dataZoom` 双向同步 (slider 的 `set` 调用 `chart.dispatchAction({type:'dataZoom', startValue, endValue})`)。
- 状态: 15.8.1 自 2024-06 起没有新版，但 API 成熟，issue 主要是边角问题，可接受。

### 4.4 日期选择

- 投行报告的时间筛选 **主要是期间预设** (MTD、QTD、YTD、1Y、3Y、5Y、Since Inception) 加起止年月，而不是逐日点选。推荐做法:
  - 用分段按钮做预设 (kit 已有 `.rk-seg`)。
  - 起止用原生 `<input type="month">` 或 `<input type="date">`，零依赖、可访问、file:// 下没有问题。
  - 需要可视化区间日历时，用 **Air Datepicker** (13.6 KB gz，支持 `range: true`、`view: 'months'|'years'`、locale 有 zh 和 en)。
- flatpickr 依然能用，但 4.6.13 发布于 2022 年，仓库 2024-08 后没有 push，作为长期交付的依赖有风险，定为 **reference**。
- Vanilla Calendar Pro 3.4.0 很活跃，功能也多，但 25 KB gz 偏大。

### 4.5 Tooltip / Popover: Floating UI (adopt) 加 CSS Anchor Positioning (渐进)

- ECharts 和 Leaflet 有自己的 tooltip，**Floating UI 只用于 DOM 组件** (表格单元格注释、指标定义 "ⓘ"、筛选面板、列菜单)。
- UMD 加载顺序: `floating-ui.core.umd.min.js` 必须在 `floating-ui.dom.umd.min.js` 之前 (dom 的 UMD 依赖 `global.FloatingUICore`)。API: `FloatingUIDOM.computePosition(ref, el, {placement, middleware:[offset(6), flip(), shift({padding:8}), arrow({element})]})`，加 `autoUpdate`。
- 渐进增强: 检测 `CSS.supports('anchor-name: --a')`，支持时用 `popover` 加 `position-anchor` 加 `position-try-fallbacks: flip-block`，不需要 JS 定位。否则回退到 Floating UI。anchor positioning 是 2026-01 才 Baseline 的，企业版浏览器不一定有。
- **Tippy.js 已在 2024-11-09 archived**，新项目不要用。

### 4.6 其它

- **SortableJS** (consider): 仪表板卡片拖拽重排、表格列顺序、"我的指标" 列表排序。支持 `handle`、`animation: 150` (内置 FLIP)、`group` 跨列表拖拽、`store` 持久化 (可接 localStorage)。
- **auto-animate** (consider，需要 IIFE 预打包 3.3 KB gz): 给列表或表格容器一行代码加上增删和重排的 FLIP 动画，适合筛选后的结果列表。
- **组件库 (Web Awesome / Shoelace / Tabler / Pico)**: 都不适合作为依赖。Web Awesome 和 Shoelace 是 ESM-only (file:// 下 `import` 链失败)，`<wa-icon>` 默认从 Font Awesome kit 远程拉取，Shoelace 已 archived。Tabler 基于 Bootstrap，CSS 有 635 KB，太重，但作为 **dashboard 视觉参考** 很好。Pico **刚在 2026-10-04 归档**。kit 应该保持自己的 `components.css` (已有 `.rk-seg`、`.rk-table` 等)。
- **公式输入 (交叉)**: CodeMirror 6 质量最高 (MIT)，但只有 ESM，要在 vendor 阶段 IIFE 化 (`@codemirror/view`、`state`、`autocomplete`、`language`)，估计 120–200 KB gz。轻量替代是 `<textarea>` 加自研 token 高亮和 autocomplete (配合 kit 的 `rk.expr.js`)，用 **JetBrains Mono** 字体。

---

## 5. 图标 (Icons)

### 5.1 总表 (版本、图标数为 2026-10-14 实测)

| 图标集 | npm | 版本 / 日期 | License | 图标数 | 金融和图表类 (正则粗计) | 风格 | 离线用法 | verdict |
|---|---|---|---|---|---|---|---|---|
| **Lucide** | `lucide-static` / `lucide` | 1.57.0 / **2026-10-14** | **ISC** (Feather 派生的约 120 个图标附 MIT 声明) | 2154 个文件 (含别名；`sprite.svg` 1890 个 symbol) | 125 | 24px 网格、2px stroke、round cap | `icons/*.svg`；`sprite.svg` 528 KB raw / 90 KB gz；`lucide.min.js` UMD 是 454 KB raw / 108 KB gz (含全部图标，太大) | **adopt** (主) |
| **Tabler Icons** | `@tabler/icons` (+`-sprite`, `-webfont`) | 3.49.0 / 2026-10-05 | MIT | **5184 outline + 1054 filled** | **366** (`chart-candle`、`chart-bubble`、`building-bank`、`report-money`、`currency-*`…) | 24px、2px stroke (和 Lucide 视觉兼容) | `icons/outline/*.svg`；`tabler-sprite.svg` 2.2 MB；webfont woff2 507 KB | **adopt** (补充) |
| Phosphor | `@phosphor-icons/web` / `core` | 2.1.2 / 2025-03 | MIT | 1512 (regular) ×6 种 weight | 66 | 6 种字重，含 duotone | 每种 weight 的 woff2 约 150 KB 加 css 78 KB；⚠ `src/index.js` **从 jsDelivr CDN 注入 CSS**，离线必须改用本地 `src/<weight>/style.css` | consider |
| Heroicons | `heroicons` | 2.2.0 / 2024-11 | MIT | 324 (24 outline) | 36 | Tailwind 风格 | 只有 SVG 文件 | reference (太少) |
| Font Awesome Free | `@fortawesome/fontawesome-free` | 7.3.1 / 2026-07 | **CC-BY-4.0 (图标) AND OFL-1.1 (字体) AND MIT (代码)** | 约 2000 | — | 实心风格偏 "web 2.0" | — | reference (CC-BY 需要署名，Reuters 在用) |

### 5.2 打包策略 (考虑 file:// 约束)

- **file:// 实测**: 外链 `<use href="icons/sprite.svg#x">` ❌ 被拦；内联 `<symbol>` ✅；`<img src=x.svg>` 和 CSS `background-image` ✅ (但无法用 `currentColor` 着色)；`mask-image` 在 Chromium 下 ✅ (其它浏览器未测)。
- **推荐方案**: Python builder 在渲染 HTML 时收集所有 `data-icon="name"` 或 `{{ icon('name') }}` 的用法，只把用到的图标读出 SVG，转成 `<symbol id="i-name" viewBox="0 0 24 24">…</symbol>`，**内联到 `<body>` 开头的隐藏 `<svg>` 里**。使用时写 `<svg class="rk-icon"><use href="#i-name"/></svg>`。
  - 优点: 体积通常 < 10 KB，`currentColor` 着色，跟随主题，可打印，无请求。
  - 运行时 JS 动态生成的图标 (例如组件内部) 用一个 classic `icons.js`，内容是 `RK.icons = {name: '<path …/>'}` 的子集。
- 不要用 icon webfont (Tabler webfont 507 KB、Phosphor 约 150 KB/weight)。它体积大，并且字体加载前会出现方块 (FOIT)，打印时也可能缺字。
- 命名冲突: Lucide 和 Tabler 同名的图标，加前缀 `lu-`、`tb-` 区分。两者都是 24 px、2 px stroke，可以统一用 CSS `stroke-width: 1.5` 做得更精致 (pitchbook 风格的细线)。
- **License 合规**: 在 `vendor/LICENSES.md` 里列出 Lucide 的 ISC 声明，并附 Feather MIT 声明 (LICENSE 文件里列出了派生图标名单)，以及 Tabler 的 MIT。内联 sprite 时在 HTML 注释里保留 `<!-- Lucide (ISC) / Tabler Icons (MIT) -->`。

```python
# builder 片段 (示意)
import re, pathlib
def build_sprite(names, roots):
    out = []
    for n in sorted(set(names)):
        prefix, name = n.split(':', 1) if ':' in n else ('lu', n)
        svg = (roots[prefix] / f"{name}.svg").read_text()
        inner = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)
        out.append(f'<symbol id="i-{prefix}-{name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                   f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{inner.strip()}</symbol>')
    return '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' + ''.join(out) + '</svg>'
# roots = {'lu': Path('vendor/lucide/icons'), 'tb': Path('vendor/tabler-icons/outline')}
```

---

## 6. 字体 (Fonts)

### 6.1 版本 / License / RFN / 体积

| 字体 | 包 (版本) | License | Reserved Font Name | 关键 woff2 (latin) | 全部分片合计 |
|---|---|---|---|---|---|
| **Inter** | `@fontsource-variable/inter` 5.3.0 | OFL-1.1 | 无 | wght 48 KB；opsz+wght 73 KB | 1.87 MB (含 cyrillic/greek/vietnamese 等) |
| **Inter (上游)** | `inter-ui` 4.1.1 (rsms 官方) | OFL-1.1 | 无 | `variable-latin/InterVariable-subset.woff2` **99.7 KB** (opsz+wght，**保留全部 OT 特性**)；完整 `InterVariable.woff2` 352 KB | — |
| IBM Plex Sans | `@fontsource/ibm-plex-sans` 5.3.0 / `@fontsource-variable/ibm-plex-sans` 5.3.0；上游 `@ibm/plex-sans` 1.1.0 | OFL-1.1 | **"Plex"** | 400: 22.6 KB；variable wght: 45.7 KB | 1.24 MB |
| IBM Plex Serif / Mono | `@fontsource/ibm-plex-serif` / `-mono` 5.3.0 | OFL-1.1 | "Plex" | 19.6 KB / 14.7 KB (400) | — |
| **Source Serif 4** | `@fontsource-variable/source-serif-4` 5.3.1 | OFL-1.1 | **"Source"** (Adobe) | wght 50.9 KB；opsz 122 KB | 2.17 MB |
| Source Sans 3 | `@fontsource-variable/source-sans-3` 5.3.1 | OFL-1.1 | "Source" | wght 28.9 KB | 0.31 MB |
| **Noto Sans SC** | `@fontsource-variable/noto-sans-sc` 5.3.1 | OFL-1.1 | 无 (noto-cjk LICENSE 未声明 RFN) | latin 分片 24.9 KB | **101 个 unicode-range 分片，共 4.50 MB** (静态版 918 文件 31.75 MB) |
| IBM Plex Sans SC | `@ibm/plex-sans-sc` 1.1.0 | OFL-1.1 | "Plex" | 每个字重完整 woff2 约 3.8 MB (未分片) | 包内 76 MB |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` 5.3.0 | OFL-1.1 | 无 | wght 40.4 KB | 0.18 MB |
| Roboto Mono | `@fontsource-variable/roboto-mono` 5.3.0 | OFL-1.1 | 无 | wght 32.8 KB | 0.28 MB |
| Inter Tight / Geist | `@fontsource-variable/*` 5.3.0 | OFL-1.1 | — | 44.9 KB / 29.4 KB | — |

### 6.2 fontTools 实测: OpenType 特性和默认数字形态 (**关键发现**)

| woff2 | 版本 | 默认数字 | GSUB 特性 (与数字/排版相关) |
|---|---|---|---|
| Fontsource Inter (wght) | 4.001 | **比例 (proportional)** | `tnum pnum frac` (**没有** `zero` `case` `ss01-08` `cv01-13` `sups` `sinf`) |
| **inter-ui 4.1.1** latin subset | 4.001 (git-9221beed3) | 比例 | `aalt calt case cv01–cv13 dlig dnom frac locl numr ordn pnum salt sinf ss01–ss08 subs sups tnum zero` |
| Fontsource IBM Plex Sans | 3.201 | **等宽 (tabular)** | 只有 `frac` |
| 上游 @ibm/plex-sans | 3.005 | 等宽 (所有数字宽 600) | `aalt ccmp dnom frac liga lnum locl numr onum ordn salt sinf ss01–ss06 subs sups zero` (没有 pnum，始终等宽) |
| Source Serif 4 | 4.004 | 等宽 | `tnum pnum frac` |
| Source Sans 3 | 3.052 | 等宽 | `pnum frac` |
| Noto Sans SC (latin 分片) | 2.004 | 等宽 | (分片中没有 GSUB) |
| JetBrains / Roboto / Plex Mono | — | 等宽 | — |
| Geist / Inter Tight | — | 比例 | `tnum pnum frac` |

**结论和建议**:
1. **Fontsource (Google Fonts 来源) 的子集会裁掉大部分 OpenType 特性**，但 Inter 的 `tnum` 还在。kit 当前的 `--rk-font-num: Inter` 加 `font-variant-numeric: tabular-nums` (见 `kit/styles/base.css` 第 22 行) **可以正常工作** ✅。
2. 如果要 **斜杠零 `zero`** (避免 0 和 O 混淆，适合 ticker、ISIN、公式)、**`case`** (大写语境下的标点对齐)、`ss01` (open digits) 或 `cv11` (单层 a)，就必须换成 **上游 `inter-ui` 4.1.1 的 `variable-latin/InterVariable-subset.woff2`** (99.7 KB，比 Fontsource 的 wght 版 48 KB 大一倍，但特性齐全)。推荐表格样式:
   ```css
   .rk-table td.num, .rk-num { font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1; }
   .rk-code, .rk-id { font-feature-settings: "zero" 1, "tnum" 1; }        /* 需 inter-ui 上游文件 */
   .rk-caps { font-feature-settings: "case" 1; text-transform: uppercase; letter-spacing: .04em; }
   ```
3. IBM Plex Sans 默认就是等宽数字 (不需要 `tnum`)。但 Plex 有 RFN "Plex"，自行子集化需要改名 (见 §6.4)。
4. 表格数字 **不要用等宽字体 (monospace)**。GS/JPM pitchbook 的惯例是比例字体加 tabular figures；等宽字体的 "1" 和 "." 会显得稀疏。等宽字体只用在公式和代码输入。

### 6.3 中文策略 (Noto Sans SC)

- 方案 A，零字节: 系统字体栈 `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif`。缺点是跨平台不一致，Windows 的 YaHei 和 Mac 的 PingFang 视觉差异较大。
- 方案 B，全量分片: `@fontsource-variable/noto-sans-sc` 的 101 个 unicode-range 分片 (4.5 MB)。浏览器只加载页面实际用到的字符所在的分片 (每片约 30–60 KB)。file:// 下可用，因为都是本地相对路径。文件夹体积会明显变大，但运行时只加载少量分片。
- 方案 C，**推荐**: **builder 按报告文字子集化**。Python builder 已经掌握全部静态文字 (标题、注释、标签、数据中的中文名)，用 `fontTools.subset` (`pyftsubset`) 生成只含这些字的 woff2，通常 50–200 KB。Noto Sans SC **没有 RFN**，子集化后可以保留原名。运行时如果有新文字 (Step 2 API、用户输入、LLM 回答)，依次回退到方案 A 的系统字体。可选再附上方案 B 的分片作为 "完整模式"。
  ```bash
  pyftsubset NotoSansSC[wght].ttf --text-file=report_text.txt --flavor=woff2 \
    --layout-features='*' --output-file=fonts/noto-sans-sc-report.woff2
  ```
- 中英混排的字体栈顺序: `font-family: "Inter", "Noto Sans SC", <系统中文>, sans-serif`。拉丁字符用 Inter，中文自动落到 Noto Sans SC。数字统一用 Inter 的 tnum。
- IBM Plex Sans SC (OFL, RFN "Plex") 和 Plex 拉丁版风格统一，但每个字重约 3.8 MB 且没有分片，太重，只作 reference。

### 6.4 OFL 合规要点

- OFL-1.1 **允许商用、允许嵌入文档和网页、允许随软件再分发**，不能单独出售字体。
- 交付文件夹里要附上每种字体的 `OFL.txt` (包含原始版权行)。注意: **Fontsource 包里的 LICENSE 有时只写 "Google Inc."** (例如 source-serif-4、noto-sans-sc)，缺少上游版权行和 RFN 声明。建议从上游仓库获取 LICENSE (Adobe 的 Source: "Copyright 2014 - 2023 Adobe ..., with Reserved Font Name 'Source'"；IBM: "Copyright © 2017 IBM Corp. with Reserved Font Name 'Plex'")。
- **RFN 与子集化**: SIL 的 OFL-FAQ 把 web 子集化视为 Modified Version，带 RFN 的字体修改后不能沿用原名 (二手引用，没有在 SIL 官网逐字核对)。实务上:
  - Inter、Noto Sans SC、JetBrains Mono、Roboto Mono **没有 RFN**，可以放心自行子集化。
  - **Source Serif 4 和 IBM Plex 有 RFN**: 直接使用官方或 Fontsource 发布的文件 (不再改动)，或者自己子集化后把内部 family name 改掉 (例如 "RK Serif")。
- 嵌入的 subset 字体 "does not require you to include this license" (OFL-FAQ)，但为了稳妥，交付包中仍然附上。

### 6.5 file:// 字体加载

- Chromium 141 实测: `fonts/` 子目录的 woff2 → `document.fonts` 状态为 `loaded` ✅。
- Firefox: 68 引入 `privacy.file_unique_origin` 后，file:// 字体一度被拦截。**Bug 1565942 "Allow the loading of TYPE_FONT from file: URLs"** 已在 Firefox 70 修复，并 uplift 到 68.0.2/68.0.2esr ("Allow fonts to be loaded via file:// URLs when opening a page locally")。同时 `security.fileuri.strict_origin_policy` 的老规则依然适用: 字体必须在文档的 **同目录或子目录**，父目录不行。kit 的 `index.html` 加 `vendor/fonts/` 结构符合要求。
- 保底: builder 选项 `--embed-fonts`，把关键字体 (Inter latin 加 Source Serif latin，约 150 KB) base64 进 CSS (体积 +33%)，彻底消除路径问题，也方便 "单 HTML 文件" 的交付模式。
- 加上 `font-display: swap` (正文) 或 `block` (KPI 大数字，避免换字体时宽度跳动)，并用 `size-adjust`、`ascent-override` 定义 fallback 字体的度量，减少 CLS:
  ```css
  @font-face { font-family: "Inter"; src: url("../vendor/fonts/inter/InterVariable-subset.woff2") format("woff2");
               font-weight: 100 900; font-style: normal; font-display: swap; }
  @font-face { font-family: "Inter Fallback"; src: local("Arial"); size-adjust: 107%; ascent-override: 90%; }
  :root { --rk-font-sans: "Inter", "Inter Fallback", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; }
  ```
  (`size-adjust` 等数值需要实测校准，这里是示意。)

---

## 7. 建议的 `vendor/vendor.json` 增量条目 (按现有 schema 草拟，未写入)

```jsonc
[
  { "id": "tom-select", "npm": "tom-select", "version": "2.6.2", "license": "Apache-2.0",
    "repo": "https://github.com/orchidjs/tom-select", "purpose": "Searchable multi-select filters (tags, optgroups, virtual scroll)",
    "files": { "dist/js/tom-select.complete.min.js": "tom-select.complete.min.js", "dist/css/tom-select.min.css": "tom-select.min.css", "LICENSE": "LICENSE" } },
  { "id": "nouislider", "npm": "nouislider", "version": "15.8.1", "license": "MIT",
    "repo": "https://github.com/leongersen/noUiSlider", "purpose": "Dual-handle range filters (valuation bands, periods)",
    "files": { "dist/nouislider.min.js": "nouislider.min.js", "dist/nouislider.min.css": "nouislider.min.css", "LICENSE.md": "LICENSE.md" } },
  { "id": "floating-ui", "npm": "@floating-ui/dom", "version": "1.8.0", "license": "MIT",
    "repo": "https://github.com/floating-ui/floating-ui", "purpose": "Tooltip/popover positioning for DOM components (fallback for CSS anchor positioning)",
    "files": { "dist/floating-ui.dom.umd.min.js": "floating-ui.dom.umd.min.js", "LICENSE": "LICENSE" },
    "$note": "also vendor @floating-ui/core@1.8.0 (MIT, dom 1.8.0 depends on core ^1.8.0) dist/floating-ui.core.umd.min.js; load core first" },
  { "id": "air-datepicker", "npm": "air-datepicker", "version": "3.6.0", "license": "MIT", "optional": true,
    "repo": "https://github.com/t1m0n/air-datepicker", "purpose": "Calendar range picker when native <input type=date/month> is not enough",
    "files": { "air-datepicker.js": "air-datepicker.js", "air-datepicker.css": "air-datepicker.css", "locale/zh.js": "locale/zh.js" },
    "$note": "npm tarball has NO LICENSE file (package.json says MIT) — fetch LICENSE from https://github.com/t1m0n/air-datepicker (raw) at vendor time" },
  { "id": "sortablejs", "npm": "sortablejs", "version": "1.15.7", "license": "MIT", "optional": true,
    "repo": "https://github.com/SortableJS/Sortable", "purpose": "Drag reorder of dashboard tiles / columns",
    "files": { "Sortable.min.js": "Sortable.min.js", "LICENSE": "LICENSE" } },
  { "id": "lucide", "npm": "lucide-static", "version": "1.57.0", "license": "ISC (Feather-derived subset: MIT)",
    "repo": "https://github.com/lucide-icons/lucide", "purpose": "Primary UI icon set; builder inlines only used icons as <symbol> sprite",
    "files": { "icons/": "icons/", "LICENSE": "LICENSE" } },
  { "id": "tabler-icons", "npm": "@tabler/icons", "version": "3.49.0", "license": "MIT",
    "repo": "https://github.com/tabler/tabler-icons", "purpose": "Secondary icons (finance/chart-specific glyphs)",
    "files": { "icons/outline/": "outline/", "icons/filled/": "filled/", "LICENSE": "LICENSE" } },
  { "id": "font-inter-upstream", "npm": "inter-ui", "version": "4.1.1", "license": "OFL-1.1",
    "repo": "https://github.com/rsms/inter", "purpose": "Inter variable latin subset WITH full OpenType features (tnum, zero, case, ss/cv)",
    "files": { "variable-latin/InterVariable-subset.woff2": "InterVariable-subset.woff2", "variable-latin/InterVariable-Italic-subset.woff2": "InterVariable-Italic-subset.woff2", "LICENSE.txt": "OFL.txt" } },
  { "id": "font-noto-sans-sc", "npm": "@fontsource-variable/noto-sans-sc", "version": "5.3.1", "license": "OFL-1.1",
    "repo": "https://github.com/notofonts/noto-cjk", "purpose": "Chinese UI font; unicode-range chunks (4.5 MB total, browser loads only needed chunks) — or builder subsets per report",
    "files": { "files/": "files/", "wght.css": "wght.css", "LICENSE": "LICENSE" } },
  { "id": "font-jetbrains-mono", "npm": "@fontsource-variable/jetbrains-mono", "version": "5.3.0", "license": "OFL-1.1", "optional": true,
    "repo": "https://github.com/JetBrains/JetBrainsMono", "purpose": "Formula / expression editor monospace",
    "files": { "files/jetbrains-mono-latin-wght-normal.woff2": "jetbrains-mono-latin-wght-normal.woff2", "LICENSE": "LICENSE" } }
]
```

(LICENSE 文件名已按 jsDelivr 列表逐一核对: tom-select、@floating-ui/dom、sortablejs、lucide-static、@tabler/icons、@fontsource-variable/* 都是 `/LICENSE`；nouislider 是 `/LICENSE.md`；inter-ui 是 `/LICENSE.txt`；**air-datepicker 的 npm 包里没有 LICENSE 文件**，要从 GitHub 获取。)

可选的 IIFE 构建条目 (需要扩展 `tools/vendor.py`):

```jsonc
{ "id": "motion-mini", "npm": "motion", "version": "14.2.0", "license": "MIT", "optional": true,
  "build": { "tool": "esbuild@0.28.2", "entry": "export { animate } from 'motion/mini'; export { inView, stagger } from 'motion';",
             "format": "iife", "global": "RKMotionLib", "out": "motion-mini.iife.min.js" },
  "purpose": "4.4 KB gz WAAPI animate + inView + stagger, only if RK.motion needs springs/sequences" }
```

---

## 8. 风险与待验证 (Open questions)

1. **Firefox 和 Safari 的 file:// 实测缺失** (本机只有 Chromium)。需要重点验证: Firefox ESR 的字体、`mask-image`、View Transitions 回退；Safari 的 file:// 字体 (Safari 默认会限制本地文件跨目录访问)。建议在 QA 阶段用 BrowserStack 或真机测一次。
2. Cross-document View Transitions 和 `appearance: base-select` 在 Firefox/Safari 上的状态各来源说法不一。kit 不依赖这两项，只作渐进增强。
3. GSAP 许可证未来可能被 Webflow 修改。本笔记引用的是 2025-05-30 修订版。
4. Motion 的 major 版本迭代很快 (v14)，`motion/mini` 的入口路径如果将来变化，IIFE 构建条目需要更新。
5. Pico 和 Tippy 都在 archived 状态，如果其它 angle 的笔记推荐了它们，需要统一口径。
6. OFL-FAQ 中 "子集化等于修改" 的原文没有在 SIL 官网逐字核对。处理 RFN 字体 (Plex、Source) 时，保守做法是不改动官方文件。

---

## 9. 来源 (Sources)

**许可证和产品页**
- GSAP Standard License: https://gsap.com/standard-license (另有镜像 https://open.windriver.com/info/uni-license-list/licenses/gsap-standard-no-charge-2025.html)
- Webflow 论坛 "Webflow makes GSAP 100% free": https://discourse.webflow.com/t/webflow-makes-gsap-100-free/319967
- Pinegrow 论坛讨论: https://forum.pinegrow.com/t/gsap-has-been-acquired-by-webflow/9906
- Motion 定价 / Motion+: https://motion.dev/pricing , https://motion.dev/plus ；animateView 文档: https://motion.dev/docs/animate-view ；README: https://cdn.jsdelivr.net/npm/motion@14.2.0/README.md
- anime.js releases: https://github.com/juliangarnier/anime/releases
- Lucide LICENSE: https://cdn.jsdelivr.net/npm/lucide-static@1.57.0/LICENSE
- Pico archived: https://github.com/picocss/pico
- Tippy archived: https://github.com/atomiks/tippyjs

**业界实践**
- The Pudding svelte-starter: https://raw.githubusercontent.com/the-pudding/svelte-starter/main/package.json ；Scrolly 组件: https://raw.githubusercontent.com/the-pudding/svelte-starter/main/src/components/helpers/Scrolly.svelte
- Reuters graphics-components: https://raw.githubusercontent.com/reuters-graphics/graphics-components/main/package.json
- Pudding "How to implement scrollytelling with six different libraries": https://pudding.cool/process/how-to-implement-scrollytelling ；"Introducing Scrollama": https://pudding.cool/process/introducing-scrollama/
- ONS 数字博客 (Svelte 与 NYT): https://digitalblog.ons.gov.uk/2021/06/02/how-we-build-scrollytelling-articles
- data.europa.eu scrollytelling 指南: https://data.europa.eu/apps/data-visualisation-guide/scrollytelling-animated-transition
- Heer & Robertson 2007: https://idl.uw.edu/papers/animated-transitions ，PDF https://vis.berkeley.edu/papers/animated_transitions/2007-AnimatedTransitions-InfoVis.pdf
- NN/g Animation duration: https://www.nngroup.com/articles/animation-duration/

**平台支持**
- Same-document View Transitions Baseline: https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available ；Chrome 2025 更新: https://developer.chrome.com/blog/view-transitions-in-2025
- Anchor positioning Baseline (Firefox 147): https://web.dev/blog/web-platform-01-2026
- Scroll-driven animations 状态: https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026 (二手来源，Firefox flag 状态待核)
- Customizable select: https://developer.chrome.com/blog/a-customizable-select
- Interest invokers: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using_interest_invokers
- MDN CORS request not HTTP: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHttp
- Firefox file:// 字体修复: https://bugzilla.mozilla.org/show_bug.cgi?id=1565942
- Firefox 同目录/子目录字体规则: https://lists.w3.org/Archives/Public/www-font/2013OctDec/0007.html
- file:// 下 SVG `<use>` 被拦的讨论: https://ecs-static.teamtreehouse.com/community/why-cant-i-link-to-my-svg-sprite-sheet

**字体许可**
- OFL-FAQ 镜像: https://tex.org.uk/fonts/amsfonts/doc/OFL-FAQ.txt ；LWN 关于 rebuild 和 RFN: https://lwn.net/Articles/552178/
- Adobe Source Serif LICENSE: https://raw.githubusercontent.com/adobe-fonts/source-serif/release/LICENSE.md
- Noto CJK LICENSE: https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE
- Inter LICENSE: https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt

**数据源 (实时查询)**
- npm registry (`npm view`)，jsDelivr data API `https://data.jsdelivr.com/v1/packages/npm/<pkg>@<ver>?structure=flat`，ecosyste.ms `https://repos.ecosyste.ms/api/v1/hosts/GitHub/repositories/<owner>%2F<repo>`
