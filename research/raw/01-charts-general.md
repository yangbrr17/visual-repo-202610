# 01 · 通用图表库 (General-purpose JS Charting Libraries): raw research notes

> Angle: `01-charts-general` · Date: 2026-10-14 · Author: research sub-agent
> Scope: every serious general-purpose JS charting engine as of late 2026, judged against the ReportKit constraints. Those constraints are: an offline folder opened by double-click (`file://`), classic `<script>` builds, permissive licences, a pitchbook-grade look, tasteful motion, zoom, cross-filtering, live re-render and multi-dimensional encodings.
>
> **How the facts were checked (2026-10-14):**
> - **Versions, licences, publish dates:** `npm view <pkg> version license time[<ver>] dist-tags` against the live npm registry. Licence changes were bisected per version where relevant (ApexCharts).
> - **Dist file lists:** `data.jsdelivr.com/v1/packages/npm/<pkg>@<ver>?structure=tree`.
> - **Sizes:** the actual dist file was downloaded and measured with `gzip -9 | wc -c` (KB = 1024 B).
> - **Stars and last push:** `repos.ecosyste.ms` (GitHub API is proxied/blocked).
> - **`file://` smoke test:** every candidate's classic-script build was loaded from a local `file://` page in **headless Chromium 141.0.7390.37 (Playwright 1.56.1)**. Each rendered a small chart, and errors, SVG/canvas output and time-to-done were recorded (§3).
> - **ECharts pitchbook feasibility test (§5.1.4):** a 6-chart page was rendered with a pitchbook theme:
>   - EBITDA bridge with connectors and **axis break**
>   - Marimekko
>   - football field
>   - 4-dimension bubble chart
>   - 200k-point LTTB time series
>   - CAGR bracket
>
>   It was then printed to PDF to compare vector (SVG renderer) against raster (canvas) output.
> - **Scratch artefacts** (not in repo): `/tmp/claude-0/-home-user-visual-repo-202610/daf46e49-46d8-53fd-b25b-6ebd897edb84/scratchpad/{smoke,dl,tools}`.

---

## 0. TL;DR: 结论与推荐

1. **PRIMARY ENGINE: Apache ECharts 6.1.0** (Apache-2.0, ASF top-level project, 67.5k★). Use the UMD `dist/echarts.min.js` (1095 KB min / **359 KB gz**). It is already vendored at `vendor/echarts/` and that choice is **confirmed**.
   - **Breadth:** it is the only permissive-licence engine that natively covers almost the whole IB chart vocabulary in one classic script. That vocabulary includes sankey, treemap, sunburst, boxplot, candlestick, heatmap, parallel, radar, funnel, gauge, **calendar**, graph, geo/map, themeRiver, pictorialBar and lines/flows.
   - **ECharts 6 additions:** **chord**, **beeswarm/jitter**, **axis breaks**, **matrix coordinate system**, **runtime `setTheme()`** and **reusable custom series**.
   - **Rendering:** it has both an **SVG renderer** (vector print/PDF with selectable text, verified) and a **canvas renderer** (200k points with LTTB in ~290 ms headless).
   - **Interaction:** dataZoom, brush, `echarts.connect` linking, `dataset`/`transform` and `setOption` diff-animation with `universalTransition` morphs.
   - **Server-side SVG:** Node SSR (`renderToSVGString`) works from the same UMD file (verified, 60 ms per chart).
2. **Waterfall, Marimekko, football field and CAGR/think-cell annotations are *recipes*, not native series in ECharts.**
   - They are ~20–40 lines each with `type:'custom'` + `renderItem` and `graphic`, all verified to render cleanly (§5.1.4, §7).
   - Ship them as kit components; the repo already has `marimekko/`, `football-field/` and similar.
   - ECharts 6 **axis breaks** give the think-cell "broken value axis" for bridges with large totals. Verified, including the zig-zag through bars.
3. **Complements:**
   - **`@echarts-x/custom-*` 1.x** (Apache-2.0, ~2 KB each, `*.auto.min.js` UMD auto-registers): violin, bar-range, line-range, segmented doughnut, contour, stage, liquid-fill, word-cloud. Adopt as needed.
   - **uPlot 1.6.32** (MIT, **21 KB gz** IIFE): ultra-dense time series and dozens of sparklines in tables, where one ECharts instance per cell is too heavy. Consider.
   - **D3 7.9.0** (ISC, 90 KB gz UMD): utility layer only (d3-format, d3-scale, d3-hierarchy, d3-sankey maths) and bespoke SVG one-offs. Consider.
   - **Vega-Lite 6.5 + Vega 6.4 + vega-embed 7.3** (BSD-3, ~275 KB gz combined, UMD still shipped although Vega 6 is "ESM-only" on npm entry points):
     - Use only for an **optional "explore / ask" mode**. It has the best declarative cross-filtering (`params`), and it is the most LLM-friendly chart grammar (Altair on the Python side).
     - Lazy-load it; do not use it for the printed report.
   - **echarts-gl 2.1.0** (MIT, 170 KB gz): only if 3D vol surfaces or globe views are ever needed.
   - **Plotly.js 4.1.2** (MIT): reference/optional for scientific charts (parcats, splom, contour, 3D surface) and parity with `plotly.py`. It is heavy: 1.44 MB gz full, 422 KB gz finance bundle.
4. **Do NOT adopt:**
   - **ApexCharts ≥ 5.1** is no longer open source. Its *dual licence* makes it free only for orgs **< US$2M revenue**, so a bank needs a paid licence. The last MIT release was 5.0.0 (2025-07-09).
   - **AG Charts Community 14.2** (MIT) has only bar/line/area/scatter/bubble/histogram/pie/donut. Waterfall, sankey, heatmap, box-plot, candlestick, radar, funnel, treemap, **zoom, navigator and animations are Enterprise** (verified in-browser warnings).
   - **Highcharts 13.1.1, amCharts 5.21.2 and ZingChart 2.9.16** are commercial, logo-linkware or watermarked. Use them as **design reference only**.
   - **TradingView Lightweight Charts 5.2.1** is Apache-2.0 **plus a mandatory attribution notice and link** (non-standard). Flag it; KLineChart 10 (Apache-2.0, no attribution clause) is the cleaner alternative if a trading-terminal chart is ever needed.
   - **React-only** (Recharts 3.10, Nivo 0.99, visx 4.0, Victory, MUI X Charts, Tremor): React 19 no longer ships UMD, so these need a bundler and a framework runtime. Not for a vanilla, `file://` report kit.
   - **Stale or broken:**
     - Taucharts 2.8.0 (2020; throws without an external d3)
     - Frappe Charts 1.6.2 (2021)
     - C3 0.7.20 (2020)
     - Britecharts (2023)
     - Toast UI Chart 4.6.1 (2022)
     - Vizzu 0.18 (ESM + WASM, **fails under `file://`**)
     - Unovis 1.7.1 (ESM-only, no UMD)
5. **Strong alternatives kept as reference:**
   - **AntV G2 5.4.8** (MIT, 320 KB gz) is grammar-of-graphics with native sankey, chord, treemap, partition, beeswarm, gauge, liquid, `flexX` Marimekko and **broken axis**. It is canvas by default; SVG needs `g2.lite` + `@antv/g-svg`.
   - **VisActor VChart 2.1.7** (MIT, **617 KB gz**) has native **waterfall** and **mosaic/Marimekko**, rich storytelling animation and a canvas renderer. SVG only via a separate plugin.
   - Both are excellent, but they are Chinese-first in docs, corporate-governed (Ant Group / ByteDance), larger, and canvas-first, which is worse for print. ECharts is ASF-governed and SVG-capable. **Borrow ideas from them, do not switch.**

---

## 1. 需求 → 评估维度 (Requirements → evaluation criteria)

| # | Requirement (from brief) | Criterion used in this survey | Weight |
|---|---|---|---|
| R1 | Opens offline from `file://`, no CDN | Ships a **UMD/IIFE classic-script** dist. No runtime `fetch()` of WASM/JSON/fonts. Verified in a headless smoke test. | Gate |
| R2 | Commercial client deliverables | Licence ∈ {MIT, BSD, Apache-2.0, ISC}. Flag attribution clauses, revenue caps and "freeware" | Gate |
| R3 | GS/JPM pitchbook look | **Theming depth:** global theme object, per-element styles, rich text labels, custom shapes for think-cell annotations, number formatting hooks | High |
| R4 | Dense, IB chart vocabulary | **Coverage:** waterfall, Marimekko, sankey, treemap, sunburst, boxplot, candlestick, heatmap, parallel, radar, funnel, gauge, calendar, graph, geo, chord, beeswarm, football field | High |
| R5 | Multi-dimensional encodings | Position + colour + size + opacity + shape, mapped declaratively (visualMap / encodings) | High |
| R6 | Zoom, filters, cross-filter | dataZoom/brush/selection APIs and events. Programmatic filtering + re-render. | High |
| R7 | Dynamic re-render when data changes | Incremental update with animated transitions (diff, morph) | Med |
| R8 | Print / PDF / PPT quality | SVG output (vector, selectable text) or high-DPR canvas; image export API | High |
| R9 | Tasteful motion | Enter/update/exit animation quality and control (duration/easing/off for print and reduced-motion) | Med |
| R10 | Swappable data, future API | Engine is data-agnostic (spec/option JSON). Python can emit the spec. | Med |
| R11 | Step 2: local LLM + skills | Spec format that LLMs know well and that can be JSON-schema-validated | Low (future) |
| R12 | Footprint | min+gz size. Parse cost per page. | Low (offline, local disk) |

---

## 2. 版本 / 许可 / 体积 总表 (verified 2026-10-14)

Columns:
- **Released** is the npm publish time of the latest version.
- **Stars** and **Last push** come from ecosyste.ms.
- **Classic-script file** is the dist file used in the smoke test.
- **min / gz** were measured by us.

| Library | npm package | Latest | Released | Licence | Stars | Last push | Classic-script file | min KB | gz KB |
|---|---|---|---|---|---|---|---|---|---|
| **Apache ECharts** | `echarts` | **6.1.0** | 2026-05-19 | Apache-2.0 | 67.5k | 2026-10-04 | `dist/echarts.min.js` (also `.common`, `.simple`) | 1095 / 698 / 488 | **359** / 233 / 164 |
| ECharts custom series | `@echarts-x/custom-{violin,bar-range,line-range,contour,stage,segmented-doughnut,liquid-fill,word-cloud}` | 1.0.x–1.2.x | 2026-01-12 | Apache-2.0 | 74 (repo) | 2026-08-18 | `dist/<name>.auto.min.js` (auto-registers) | ~2–5 | ~1–2 |
| ECharts GL | `echarts-gl` | 2.1.0 | 2026-05-28 | MIT | — | — | `dist/echarts-gl.min.js` | 624 | 170 |
| AntV G2 | `@antv/g2` | 5.4.8 | 2026-01-06 | MIT | 12.6k | 2026-10-09 | `dist/g2.min.js` (`g2.lite.min.js` for SVG) | 1058 | 320 |
| VisActor VChart | `@visactor/vchart` | 2.1.7 | 2026-09-18 | MIT | 1.8k | 2026-10-12 | `build/index.min.js` | 2368 | **617** |
| Plotly.js | `plotly.js-dist-min` (+ `-finance-`, `-basic-`, `-cartesian-`, `-geo-` …) | 4.1.2 | 2026-10-05 | MIT | 18.4k | 2026-10-08 | `plotly.min.js` / `plotly-finance.min.js` / `plotly-basic.min.js` | 4721 / 1273 / 1170 | **1441** / 422 / 388 |
| Vega | `vega` | 6.4.0 | 2026-08-14 | BSD-3-Clause | 12.0k | 2026-10-05 | `build/vega.min.js` | 508 | 175 |
| Vega-Lite | `vega-lite` | 6.5.0 | 2026-10-08 | BSD-3-Clause | 5.5k | 2026-10-08 | `build/vega-lite.min.js` | 251 | 79 |
| vega-embed | `vega-embed` | 7.3.0 | 2026-09-23 | BSD-3-Clause | — | — | `build/vega-embed.min.js` | 58 | 20 |
| Observable Plot | `@observablehq/plot` | 0.6.17 | 2025-02-14 | ISC | 5.4k | 2026-09-01 | `dist/plot.umd.min.js` (+ d3) | 204 | 67 (+90 d3) |
| D3 | `d3` | 7.9.0 | 2024-03-12 | ISC | 113.7k | 2026-05-28 | `dist/d3.min.js` | 273 | 90 |
| Chart.js | `chart.js` | 4.5.1 | 2025-10-13 | MIT | 67.7k | 2026-10-04 | `dist/chart.umd.min.js` | 203 | 68 |
| ├ zoom / annotation / datalabels | `chartjs-plugin-*` | 2.2.0 / 3.1.0 / 2.2.0 | 2024-11 / 2024-10 / **2022-12** | MIT | | | `dist/*.min.js` | 14 / 37 / 12 | 5 / 12 / 5 |
| ├ sankey / treemap / matrix | `chartjs-chart-*` | 0.19.1 / 4.2.2 / 3.1.0 | 2026-09 | MIT | | | `dist/*.min.js` | 18 / 15 / 3 | 7 / 6 / 1 |
| ├ boxplot / geo / financial | `@sgratzl/chartjs-chart-boxplot`, `chartjs-chart-geo`, `chartjs-chart-financial` | 4.4.5 / 4.3.6 / **0.2.1** | 2025-10 / 2025-10 / **2024-03** | MIT | | | `build/index.umd.min.js` … | 18 / 83 / 12 | 5 / — / 3 |
| billboard.js | `billboard.js` | 4.1.1 | 2026-09-30 | MIT | 6.0k | 2026-10-06 | `dist/billboard.pkgd.min.js` (with d3) / `billboard.min.js` | 810 / 465 | 267 / 153 |
| uPlot | `uplot` | 1.6.32 | 2025-03-14 | MIT | 10.5k | 2026-10-05 | `dist/uPlot.iife.min.js` | 49 | **21** |
| AG Charts Community | `ag-charts-community` | 14.2.0 | 2026-09-16 | MIT (Enterprise = Commercial) | 0.5k | 2026-10-12 | `dist/umd/ag-charts-community.min.js` | 1378 | 412 |
| IBM Carbon Charts | `@carbon/charts` | 1.27.21 | 2026-10-05 | Apache-2.0 | 1.1k | 2026-10-05 | `dist/umd/bundle.umd.js` (+ `styles.min.css`) | 552 | 161 |
| **ApexCharts** | `apexcharts` | 8.2.0 | 2026-10-13 | **Proprietary dual licence** (free < $2M revenue). Last MIT = **5.0.0** | 15.2k | 2026-10-11 | `dist/apexcharts.min.js` | 915 | 260 |
| Highcharts | `highcharts` | 13.1.1 | 2026-09-20 | **Commercial** (Highsoft) | 12.5k | 2026-10-12 | `highcharts.js` (core only; modules extra) | 273 | 99 |
| amCharts 5 | `@amcharts/amcharts5` | 5.21.2 | 2026-10-14 | **Freeware linkware**: logo must stay; commercial to remove | 0.4k | 2026-10-13 | `index.js` + per-chart scripts | — | — |
| ZingChart | `zingchart` | 2.9.16-1 | 2025-01-16 | **Proprietary, branded**: "Powered by ZingChart" watermark | 0.3k | 2025-01-16 | `zingchart.min.js` | 867 | 256 |
| TradingView Lightweight Charts | `lightweight-charts` | 5.2.1 | 2026-08-12 | Apache-2.0 **+ attribution notice & link required** | 17.5k | 2026-10-09 | `dist/lightweight-charts.standalone.production.js` | 193 | 60 |
| KLineChart | `klinecharts` | 10.0.4 | 2026-10-12 | Apache-2.0 | 4.2k | 2026-09-30 | `dist/umd/klinecharts.min.js` | 231 | 58 |
| Chartist | `chartist` | 1.5.0 | 2025-09-30 | MIT OR WTFPL | 13.4k | 2026-10-13 | `dist/index.umd.js` | 36 | 11 |
| Dygraphs | `dygraphs` | 2.2.2 | 2026-07-27 | MIT | 3.2k | 2026-07-29 | `dist/dygraph.min.js` | 127 | 36 |
| Frappe Charts | `frappe-charts` | 1.6.2 (next 2.0.0-rc29) | **2021-06-16** | MIT | 15.1k | 2026-10-09 | `dist/frappe-charts.min.umd.js` | 67 | 17 |
| Taucharts | `taucharts` | 2.8.0 | **2020-02-26** | Apache-2.0 | 1.9k | 2023-10-04 | `dist/taucharts.min.js` (needs external d3) | 451 | 124 |
| Vizzu | `vizzu` | 0.18.0 | 2026-04-20 | Apache-2.0 | 2.0k | 2026-04-20 | **ESM + `cvizzu.wasm`**, no UMD | 59 + wasm | 17 + wasm |
| Unovis | `@unovis/ts` | 1.7.1 | 2026-09-29 | Apache-2.0 | 2.9k | 2026-10-08 | **none** (ESM only) | — | — |
| BokehJS | `@bokeh/bokehjs` | 3.10.1 | 2026-10-13 | BSD-3-Clause | 20.5k | 2026-10-14 | `build/js/bokeh.min.js` | 1361 | — |
| Recharts | `recharts` | 3.10.1 | 2026-07-25 | MIT | 27.6k | 2026-10-09 | `umd/Recharts.js` (needs React UMD, and React 19 dropped UMD) | — | — |
| Nivo | `@nivo/*` | 0.99.0 | 2025-05-23 | MIT | 14.1k | 2026-07-21 | none | — | — |
| visx | `@visx/visx` | 4.0.0 | 2026-06-11 | MIT | 21.1k | 2026-06-22 | none | — | — |
| Victory | `victory` | 37.3.6 | 2025-01-14 | MIT | 11.2k | 2025-12-19 | `dist/victory.min.js` (needs React) | — | — |
| MUI X Charts | `@mui/x-charts` | 9.15.0 | 2026-10-06 | MIT (Pro = commercial) | 5.9k (mui-x) | 2026-10-12 | none | — | — |
| C3 | `c3` | 0.7.20 | **2020-08-08** | MIT | — | — | `c3.min.js` + d3 v5 | — | — |
| Britecharts | `britecharts` | 2.18.2 | **2023-01-04** | Apache-2.0 | — | — | — | — | — |
| Toast UI Chart | `@toast-ui/chart` | 4.6.1 | **2022-12-21** | MIT | — | — | — | — | — |

Python-side counterparts (PyPI, 2026-10-14):

| Package | Version | Released | Licence |
|---|---|---|---|
| `pyecharts` | 2.1.0 | 2026-02-10 | MIT. Default asset host is now `assets.pyecharts.org/assets/v6/`, so it **targets ECharts 6**. |
| `altair` | 6.3.0 | 2026-09-15 | BSD-3. Emits Vega-Lite. |
| `plotly` | 7.1.0 | 2026-09-15 | MIT |
| `bokeh` | 3.10.1 | 2026-10-13 | BSD-3 |
| `vl-convert-python` | 1.9.0 | — | BSD-3 |
| `kaleido` | 1.5.0 | 2026-10-06 | MIT |

---

## 3. `file://` 冒烟测试 (classic-script smoke test, headless Chromium 141)

Method:
- Each page was `file:///…/pages/<lib>.html` with `<script src="../vendor/<dist>.js">`.
- Each rendered a 5-bar P&L dataset, or a lib-appropriate equivalent.
- We recorded window errors, console errors, `<svg>` and `<canvas>` counts, and ms from first script to "done".

| Library | Result | Output | ms | Notes |
|---|---|---|---|---|
| ECharts 6.1.0 | ✅ | SVG + canvas | 261 | Verified working in one page:<br>• waterfall<br>• **axis break** (`yAxis.breaks`)<br>• **beeswarm** (`xAxis.jitter` + `jitterOverlap:false`)<br>• **matrix** coord heatmap<br>• **chord**<br>• `setTheme('dark')` at runtime<br>• `renderToSVGString()`<br>• `getDataURL({type:'png',pixelRatio:2})` |
| G2 5.4.8 | ✅ | canvas | 590 | `new G2.Chart({container})`; `chart.render()` returns a Promise |
| VChart 2.1.7 | ✅ | canvas | 255 | `new VChart.default(spec,{dom})` → `renderSync()`; native `type:'waterfall'` |
| Plotly 4.1.2 (finance) | ✅ | SVG | 368 | Native `waterfall` trace with `measure` |
| Vega 6.4 + VL 6.5 + embed 7.3 | ✅ | SVG | 154 | UMD builds still shipped despite "ESM-only" packaging |
| Observable Plot 0.6.17 + d3 | ✅ | SVG | 82 | Fastest SVG path |
| Chart.js 4.5.1 + 7 plugins | ✅ | canvas | 155 | sankey, treemap, matrix, boxplot/violin, zoom, datalabels and annotation all register from UMD |
| billboard.js 4.1.1 (pkgd) | ✅ | SVG | 548 | |
| uPlot 1.6.32 | ✅ | canvas | 44 | 10k points |
| AG Charts Community 14.2 | ✅ | canvas (+svg overlay) | 1190 | Enterprise series warn and do not render (§5.10) |
| Carbon Charts 1.27 | ✅ | SVG | 956 | Needs `styles.min.css` |
| Lightweight Charts 5.2.1 | ✅ | canvas | 330 | |
| Chartist 1.5 / Dygraphs 2.2 / KLineChart 10 / Frappe 1.6 | ✅ | SVG / canvas / canvas / SVG | ~300 | |
| ApexCharts 8.2 / Highcharts 13.1 / ZingChart 2.9 | ✅ (ref only) | SVG | 138 / 424 / 1370 | Highcharts shows a "Highcharts.com" credit and a "Chart title" by default. ZingChart shows its watermark off-localhost. |
| **Taucharts 2.8.0** | ❌ | — | — | `yn.format is not a function`. The bundle expects an external d3 global, and the project has been dead since 2020. |
| **Vizzu 0.18.0** | ❌ | — | — | ESM `import` + `cvizzu.wasm` are blocked by CORS on `file://` (`net::ERR_FAILED`) |
| Unovis 1.7.1 / Nivo / visx / MUI X | n/a | — | — | No classic-script build exists |

**Gotcha found during testing: the POSIX locale breaks Intl.**
- With the environment's `LANG=C` / POSIX locale, headless Chromium reported `navigator.language = "en-US@posix"`.
- **uPlot, Carbon Charts and Lightweight Charts then threw `RangeError: Invalid language tag: en-US@posix`.** They pass `navigator.language` into `Intl.*`.
- ECharts was unaffected because it uses its own `locale:'EN'`.
- **Implications for ReportKit:**
  1. The Python builder's headless PNG/PDF step must pass `locale: 'en-US'` (Playwright `newPage({locale})`) or `LANG=en_US.UTF-8`.
  2. Kit formatters must **sanitise** `navigator.language` (strip `@…`, fall back to `en-US`) before calling `Intl.NumberFormat`.

---

## 4. 图表类型覆盖矩阵 (chart-type coverage)

Legend:
- ✅ native series or mark
- ◐ documented recipe or plugin (a few lines of config or an extra file)
- 🔒 commercial tier only
- ❌ not practical

| Type | ECharts 6.1 | G2 5.4 | VChart 2.1 | Plotly 4.1 | Vega-Lite 6 / Vega 6 | Obs. Plot | Chart.js 4.5 (+plugins) | billboard 4 | AG Charts CE 14 | Highcharts 13 (ref) | amCharts 5 (ref) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Waterfall / bridge | ◐ stack or **custom** (verified) | ◐ interval `y:[a,b]` | ✅ `waterfall` | ✅ `waterfall` (measure/connector) | ◐ window transform | ◐ | ◐ floating bars `[lo,hi]` | ◐ | 🔒 | ✅ | ◐ |
| Marimekko / mekko | ◐ **custom** (verified) | ✅ `flexX` transform | ✅ `mosaic` | ◐ bar `width[]` | ◐ example | ◐ rect+stack | ❌ | ❌ | ❌ | ✅ variwide | ◐ |
| Football field (range bars) | ◐ transparent stack / custom (verified) | ✅ `rangeX` | ✅ `rangeColumn` | ◐ `base` | ✅ bar `x`/`x2` | ✅ barX `x1/x2` | ✅ floating bars | ◐ | 🔒 range-bar | ✅ columnrange | ✅ |
| Sankey | ✅ | ✅ | ✅ | ✅ | ❌ (no native in Vega) | ◐ d3-sankey | ✅ plugin | ❌ | 🔒 | ✅ | ✅ |
| Chord | ✅ **new in v6** | ✅ | ❌ | ❌ | ◐ | ❌ | ❌ | ❌ | 🔒 | ✅ dependency wheel | ✅ |
| Treemap | ✅ (drill-down) | ✅ | ✅ | ✅ | ✅ Vega / ❌ VL | ◐ | ✅ plugin | ✅ | 🔒 | ✅ | ✅ |
| Sunburst / icicle | ✅ | ✅ `partition` | ✅ | ✅ (+icicle) | ✅ Vega partition / ❌ VL | ◐ | ❌ | ❌ | 🔒 | ✅ | ✅ |
| Boxplot / violin | ✅ / ◐ custom-violin | ✅ / ◐ | ✅ / ❌ | ✅ / ✅ | ✅ boxplot / ◐ density | ✅ box / ◐ | ✅ plugin (box + violin) | ❌ | 🔒 | ✅ | ◐ |
| Candlestick / OHLC | ✅ | ◐ | ◐ `vchart-extension` | ✅ | ◐ layered | ◐ | ◐ financial plugin (stale 2024, needs date adapter) | ✅ | 🔒 | ✅ (Stock) | ✅ |
| Heatmap / matrix | ✅ (+ v6 matrix coord) | ✅ cell | ✅ | ✅ | ✅ rect | ✅ cell | ✅ matrix plugin | ❌ | 🔒 | ✅ | ✅ |
| Calendar heatmap | ✅ `calendar` coord | ◐ cell | ◐ | ◐ | ✅ rect + timeUnit | ✅ cell + utcWeek | ◐ matrix | ❌ | ❌ | ◐ | ◐ |
| Parallel coordinates | ✅ | ✅ | ❌ | ✅ `parcoords`/`parcats` | ◐ | ◐ | ◐ (pcp plugin) | ❌ | ❌ | ✅ | ❌ |
| Radar | ✅ | ✅ | ✅ | ✅ scatterpolar | ◐ hack | ◐ | ✅ | ✅ | 🔒 | ✅ | ✅ |
| Funnel | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ◐ plugin | ✅ | 🔒 | ✅ | ✅ |
| Gauge / KPI dial | ✅ | ✅ | ✅ | ✅ `indicator` | ◐ arc | ❌ | ◐ doughnut | ✅ | 🔒 | ✅ | ✅ |
| Graph / network | ✅ force/circular | ✅ forceGraph | ❌ | ◐ | ✅ Vega force | ◐ (no layout) | ◐ plugin | ❌ | ❌ | ✅ | ✅ |
| Geo choropleth / bubbles / flows | ✅ `registerMap(GeoJSON)` + scatter/`lines` | ✅ geoView | ✅ map | ✅ (geo bundle; topojson must be pre-loaded) | ✅ geoshape | ✅ geo | ✅ geo plugin | ❌ | 🔒 | ✅ Maps | ✅ (best) |
| Beeswarm | ✅ **v6** `jitterOverlap:false` | ✅ (5.4.2) | ◐ | ◐ random jitter only | ◐ | ✅ dodge | ❌ | ❌ | ❌ | ◐ | ◐ |
| Axis break (broken axis) | ✅ **v6** `axis.breaks` (+expand/collapse actions) | ✅ (5.4.0) | ❌ | ◐ `rangebreaks` (dates only) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ broken-axis module | ✅ |
| Small multiples | ✅ multi-grid / v6 matrix layout | ✅ facet | ◐ | ✅ subplots | ✅ facet/repeat | ✅ fx/fy | ◐ (N canvases) | ◐ | ◐ | ◐ | ◐ |
| 3D / vol surface | ◐ echarts-gl | ◐ g2-extension-3d | ◐ | ✅ gl3d | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

**Take-away:**
- ECharts covers or recipes every row.
- The only rows where another lib is *more* native are waterfall (Plotly, VChart, Highcharts) and Marimekko (G2 `flexX`, VChart `mosaic`, Highcharts variwide). Both are easy ECharts custom series and are already in the kit.

---

## 5. 逐库详评 (per-library deep dives)

### 5.1 Apache ECharts 6.1.0: PRIMARY

#### 5.1.1 Identity and governance
- **Apache Software Foundation** top-level project, Apache-2.0. NOTICE and LICENSE files must be shipped (the d3 sub-licence is included). `vendor/echarts/` already does this.
- Originated at Baidu but **ASF-governed**, which helps vendor-risk reviews.
- Very active: 6.0.0 shipped on 2025-07-30 and 6.1.0 on 2026-05-19, last push 2026-10-04. `dist-tags` show `rc: 6.1.0-rc.2`, so no 6.2 pre-release yet.
- `zrender` (BSD-3) is bundled inside `echarts.min.js`.

#### 5.1.2 What v6 added (RELEASE_NOTE 6.0.0 + v6 feature handbook)

| Feature | Option / API | Relevance for IB reports |
|---|---|---|
| New default theme (design-token based) | default; old look via `echarts/theme/v5.js`; old `light` → `rainbow.js` | We use our own `rk` theme anyway. **Breaking:** default legend moved to the **bottom**. |
| Dynamic theme registration and switching | `echarts.registerTheme(name, obj)` + **`chart.setTheme(name)`** (no dispose/re-init, so no replay animation) | Light, dark and "print" theme toggles, plus client branding |
| Dark mode | listen to `matchMedia('(prefers-color-scheme: dark)')` → `setTheme('dark')` | Screen viewing |
| **Chord** series | `series.type:'chord'` (gradient edges) | Cross-border flows, counterparty exposure |
| **Beeswarm** / scatter jitter | `xAxis.jitter: n`, `jitterOverlap: false` (beeswarm) / `true` (random jitter) | Comps distributions, deal-multiple dispersion |
| **Axis break** | `yAxis.breaks:[{start,end,gap}]`, `breakArea` styling, `breakLabelLayout`. Actions `expandAxisBreak` / `collapseAxisBreak` / `toggleAxisBreak`. | think-cell style **broken axis** in bridges and in comparisons with one outlier |
| **Matrix coordinate system** | top-level `matrix:{x:{data},y:{data}}`, `series.coordinateSystem:'matrix'`. Any series/component can be laid out in matrix or calendar cells. 6.1: `matrix.x/y.length`, `triggerEvent`. | Correlation matrices, "periodic table" KPI grids, **small multiples in one instance** |
| Reusable custom series | `echarts.registerCustomSeries` + `@echarts-x/custom-*` packages (violin, contour, stage, segmentedDoughnut, barRange, lineRange, liquidFill, wordCloud) | Ship our **waterfall, mekko and football-field** as registered custom series |
| Axis label/name anti-overflow layout | default. Opt-out: `grid.outerBoundsMode:'none'`, `axisLabel.nameMoveOverlap:false` | Fewer clipped labels in dense layouts |
| Marker `relativeTo` | `markPoint.data[].relativeTo:'coordinate'` | Pin "Current price" and annotations to chart corners |
| Roam / thumbnail | `roamTrigger`, `preserveAspect`, graph `thumbnail` | Network and geo navigation |
| Stack order reverse, marker `z/z2`, legend `triggerEvent`, tooltip `displayTransition`, `visualMap.unboundedRange` | — | Polish |
| **Rich-label inheritance change** | label rich styles now inherit plain label styles; restore with `richInheritPlainLabel:false` | Breaking for existing rich labels |
| `center` percent base for geo/map/graph/tree changed | `legacyViewCoordSysCenterBase:true` restores the old base | Breaking |

**6.1.0 (2026-05-19) highlights** (from RELEASE_NOTE):
- **New options:**
  - `axis.dataMin`/`dataMax` for nice extents.
  - **`containShape`**: bar, candlestick and boxplot no longer overflow the grid; `containShape:false` restores the old behaviour.
  - Log axis drops values ≤0.
  - `axisLabel.formatter` receives an index with `customValues`.
  - Line `triggerEvent`.
  - Pie `tangential-noflip`.
  - Gauge `progress.color:'auto'`.
  - Radar `clockwise`.
  - Candlestick `cursor`; dataZoom `cursorGrab`.
  - `visualMap.seriesTargets` (several series-dimension mappings).
- **Fixes:**
  - **XSS fix in `lines` tooltip**, relevant if client-typed labels are rendered.
  - Many dataZoom, axis and time-scale fixes.
- **Breaking:**
  - `tooltip.valueFormatter` 2nd arg is now `rawDataIndex`.
  - `axis.startValue` is decoupled from `min`.

#### 5.1.3 Builds, offline and SSR
- **UMD builds** (`dist/`):

  | Build | min KB | gz KB |
  |---|---|---|
  | `echarts.min.js` (all charts + components) | 1095 | 359 |
  | `echarts.common.min.js` | 698 | 233 |
  | `echarts.simple.min.js` | 488 | 164 |

  The full build is right for a kit with 50+ components. Parse cost on local disk is negligible next to fonts and images.
- **37 theme files** ship in `theme/` (e.g. `v5.js`, `dark.js`, `rainbow.js`, `macarons.js`). **27 locales** ship in `i18n/` as UMD (`langEN.js`, `langDE.js` …).
- **Maps:** no map data is bundled. Call `echarts.registerMap('world', geoJSON)` from a JS file that sets a global, never via `fetch` (fetch fails under `file://`). Our `vendor/geo-world/world-110m.js` follows this pattern.
- **Node SSR:** `echarts.init(null, null, {renderer:'svg', ssr:true, width, height})` → `renderToSVGString()` works **from the same UMD file in Node 22** (verified: 4 KB SVG, 60 ms).
  - `echarts/ssr/client` can hydrate SSR SVG with light interactivity.
  - **Use case:** the Python builder, via a tiny Node step or a headless browser, can pre-render static SVG fallbacks for print, PPT export, e-mail and thumbnails.

#### 5.1.4 Pitchbook feasibility test (scratch `ec-pitchbook.html`, SVG renderer, theme `pb`)

| Chart | Technique | Result |
|---|---|---|
| EBITDA bridge, $m | `type:'custom'` `renderItem` that returns `group{rect,text,line}`. Connectors are dashed lines between bars. Totals are dark navy, positives mid-blue, negatives grey with **(27.4)** parentheses. **`yAxis.breaks:[{start:40,end:360,gap:'4%'}]`** | ✅ Clean. The zig-zag break runs through the total bars, exactly as think-cell does. **Needs `clip:true`** on custom series, because custom series are not clipped by default. Without the break, `yAxis.min:350` made totals overflow below the axis. |
| Marimekko | `custom` on a value×value grid. Each cell is `[x0,x1,y0,y1,seg,label,share]`. White 1px separators and share labels. | ✅ ~25 lines |
| Football field | Category y-axis, transparent base bar + range bar stacked, low/high labels, `markLine` "Current $25.3" | ✅ |
| 4-dimension bubble | x/y position, `symbolSize` callback (√ market cap), series colour = sector, **continuous `visualMap` on dim 4 → `colorAlpha`** (ROIC) | ✅ Multi-dimensional encoding is declarative. ⚠ The default `visualMap` handle style needs theming. |
| 200k ticks | canvas, `sampling:'lttb'`, `showSymbol:false`, dataZoom inside + slider | ✅ **~290 ms** to first render, headless with no GPU |
| Revenue with CAGR | bars + `graphic` polyline bracket + ellipse "CAGR 10.8%". Positions come from `convertToPixel`. | ✅ Must re-run on `resize` (graphic uses pixel coordinates) |

**Whole page (6 charts):** ~550 ms. SVG DOM ≈ 53 KB.

**Layout lessons from the test:**
- With the title, legend and `yAxis.name` all inside the chart, they overlapped.
- **Recommendation: keep chart chrome in HTML, not in the chart canvas.** That means the title, subtitle/units, legend where feasible, "Source:" and footnotes.
- ECharts should own only the plot area. This also gives consistent typography, Ctrl+F, accessibility and a clean PPT export.

**Print/PDF test (Chromium `page.pdf`):**
- The **SVG-renderer charts came out as vector paths with selectable text.** `pdftotext` extracted "EBITDA bridge ($m) … (27.4) … 454.0".
- The **canvas chart was embedded as a 600×340 raster at ~104 ppi**, which is visibly soft on paper.
- Rule:
  - SVG by default. The kit already does this in `kit/core/rk.chart.js`.
  - Canvas only for >~5k marks. For those, init with `devicePixelRatio: 3`, or re-init on `beforeprint`. A rendered PNG snapshot (`getDataURL({pixelRatio:3})`) swapped in via `@media print` also works.

#### 5.1.5 Theming depth (can it look like GS/JPM?) Yes.
- **Global theme object** (`registerTheme`). It controls:
  - palette and backgroundColor
  - `textStyle.fontFamily`, so bundled fonts declared in CSS `@font-face` are used by the SVG and canvas renderers once loaded
  - per-axis-type defaults (`categoryAxis`, `valueAxis`, `timeAxis`, `logAxis`)
  - per-series defaults
  - legend, tooltip, dataZoom, visualMap and markLine styles
- **Font loading:** wait for `document.fonts.ready` before the first `setOption`, or call `chart.resize()` after fonts load. Otherwise canvas text measures with the fallback font.
- **Rich text labels** (`label.rich`) give mixed bold/regular, superscript footnote markers and boxed values.
- **`decal`** patterns (aria) give B&W-print-safe fills.
- **Number formatting:** ECharts has no Excel-style format strings. Use `Intl.NumberFormat` or `d3-format` in `axisLabel.formatter`, `label.formatter` and `tooltip.valueFormatter`. Our components should accept Excel-like format codes from Python (`#,##0.0;(#,##0.0)`, `0.0x`, `0.0%`) and compile them to JS formatters.
- **Runtime `setTheme`:** switch screen, print and dark themes without re-creating instances.

#### 5.1.6 Interaction and dynamic data
- **Zoom:**
  - `dataZoom` `inside` (wheel or pinch) and `slider` (with data-shadow thumbnail), x and/or y
  - `toolbox.dataZoom` box zoom
  - `restore`
- **Brush:** `brush` component (rect, polygon, lineX/lineY, keep/clear). Listen to `brushSelected` or `brushEnd` events to get the selected `dataIndex` per series.
- **Linking:** `echarts.connect(groupId)` synchronises tooltip, axisPointer and dataZoom across instances.
- **Cross-filter pattern:** use our own store, not ECharts internals.
  1. A chart emits `brushSelected` / `legendselectchanged` / `click` / `datazoom`.
  2. The store applies the filter (row IDs or predicate) to the canonical dataset.
  3. Every subscribed component calls `setOption({dataset:{source}}, {replaceMerge:['dataset']})` or a full option rebuild.
  4. ECharts diffs and animates the update. Use `universalTransition: {enabled:true}` + `dataGroupId` for morphs, such as bar → pie or drill-down treemap → bar.
- **Data swap:** `dataset` + `encode` decouples data from series. `dataset.transform` (filter/sort, plus `registerTransform` for ecStat regression/clustering) supports declarative derived views.
- **Labels:** `series.label.valueAnimation:true` makes numbers count up on update (bar-race style).
- **Large data:** `large:true` (bar/scatter), `progressive`/`progressiveThreshold`, `sampling:'lttb'|'average'|'max'`, `appendData` streaming.

#### 5.1.7 Animation quality
- **Defaults:** enter animations (grow/fade), configurable via `animationDuration`, `animationEasing`, `animationDelay(idx)` and `animationDurationUpdate`.
- **Strongest motion features:** `universalTransition` morphing between series types and between parent/child groups, and `valueAnimation` for labels.
- **For print:** set `animation:false` on `beforeprint`, `prefers-reduced-motion` and in SSR. Otherwise mid-animation frames get captured; our smoke-test screenshots caught ApexCharts, Carbon and Frappe mid-animation.

#### 5.1.8 Multi-dimensional encoding
- **`visualMap`** (continuous or piecewise) maps any data dimension to `color`, `colorAlpha`, `colorLightness`, `colorSaturation`, `symbolSize`, `symbol` or `opacity`.
  - Several visualMaps can target different dimensions or series (6.1 `seriesTargets`).
  - `inRange` / `outOfRange` give filtered-out styling, which is an instant cross-filter visual.
- **Per-item encodings:** `symbolSize` and `itemStyle` callbacks, `encode` for x/y/tooltip/itemName mapping, and `decal` for pattern as an extra categorical channel.
- **Geo:**
  - choropleth via `series.map` + visualMap
  - proportional symbols via `scatter` on `geo` with `symbolSize` from data
  - flows via `lines` (with `effect` trail animation)
  - all in one geo instance

#### 5.1.9 Gotchas (ECharts-specific)
1. The v6 default theme and **legend at the bottom** differ from v5. Always pass our theme. Never rely on defaults.
2. **Custom series are not clipped** to the grid. Set `clip:true`.
3. `graphic` elements use pixel coordinates. Recompute on `resize` (CAGR brackets, callouts).
4. `setOption` merges by default. For data swaps use `{notMerge:true}` or `replaceMerge:['series','dataset']`, or stale series linger.
5. Canvas text uses the font available *at render time*. Await `document.fonts.ready`.
6. **6.1 behaviour changes:**
   - `tooltip.valueFormatter(value, rawDataIndex)`
   - `containShape` now keeps edge bars inside the grid, which can change bar widths at the axis ends vs 6.0
7. Tooltip HTML is injected (`tooltip.formatter` returning HTML). **Escape client-typed strings**; 6.1 fixed an XSS in `lines`.
8. `dataZoom` with `filterMode:'filter'` (default) re-computes axis extents. For pitchbook stability use `'none'` or `'weakFilter'`.
9. Under `file://`, never `fetch` GeoJSON or themes. Wrap them as JS globals (already the kit convention: `data/bundle.js`).
10. Instances must be `dispose()`d when components are re-mounted (filter-driven re-layout), or memory leaks.

---

### 5.2 AntV G2 5.4.8: reference (strongest grammar-of-graphics alternative)
- **Licence and governance:** MIT, Ant Group, 12.6k★. Last release 2026-01-06; repo active (2026-10).
- **Runtime introspection of `G2.stdlib()` in the UMD build (verified):**
  - **Marks:** interval, rect, line, point, text, cell, area, link, image, polygon, box, **boxplot**, vector, lineX/Y, **connector**, range/rangeX/rangeY, path, shape, density, heatmap, **beeswarm**, **sankey**, **chord**, **treemap**, **partition** (sunburst/icicle), **pack**, **tree**, **forceGraph**, **gauge**, **liquid**, **wordCloud**. Geo comes via `geolib` (geoPath/geoView).
  - **Transforms:** stackY, dodgeX, **flexX** (Marimekko), normalizeY, **diffY**, jitter, bin, group, sort, select, sample, pack, symmetryY.
  - **Interactions:** elementHighlight/Select (ByX, ByColor), **brushFilter / brushXFilter**, brushHighlight, **sliderFilter, sliderWheel, scrollbarFilter**, legendFilter/Highlight, tooltip, fisheye, chartIndex, poptip, treemapDrillDown, drillDown, elementPointMove (drag to edit data!).
  - **Animations:** fadeIn/Out, scaleIn/OutX/Y, growInX/Y, waveIn, zoomIn/Out, pathIn, **morphing**.
- **5.4.x additions:** **broken Y axis (5.4.0)**, beeswarm mark, sparkline interval, slider scale sync, click-to-lock tooltip, pyramid, funnel radius.
- **Rendering:** **canvas by default** through `@antv/g`. SVG requires `g2.lite.min.js` + `@antv/g` + `@antv/g-svg` UMD with `renderer: new G.SVG.Renderer()`. The full and lite builds cannot co-exist on one page, which is a print-quality friction.
- **Why not primary:**
  - Canvas-first.
  - Docs and examples are Chinese-first (English site exists but lags).
  - API churn between v4 and v5. G2Plot 2.4.35 is effectively frozen and superseded by G2 5 "plots".
  - Corporate-governed, which may trigger vendor-risk review in US/EU banks.
  - No calendar coordinate.
  - 320 KB gz, about the same as ECharts, but fewer finance-specific series (no native candlestick).
- **Borrow:**
  - The `flexX` mekko idea.
  - `elementPointMove`, i.e. "drag a bar to change a forecast", a strong idea for interactive scenario tools.
  - `diffY` for difference areas.

### 5.3 VisActor VChart 2.1.7: reference
- **Licence and governance:** MIT, ByteDance, 1.8k★. Very frequent releases (2.1.7 on 2026-09-18; 2.1.8-alpha).
- **Chart types confirmed in the UMD bundle:**
  - waterfall, **mosaic (Marimekko)**, sankey, treemap, sunburst, circlePacking, boxPlot, heatmap, funnel, gauge, radar, rose, wordCloud, liquid, venn, correlation, map, rangeColumn, rangeArea, linear/circularProgress, histogram, pictogram
  - components: dataZoom, brush, scrollBar, **player** (timeline storytelling), markLine/Area/Point
  - Candlestick is in `@visactor/vchart-extension`.
- **Strengths:**
  - **Storytelling animation**: player, narrative, "VStory".
  - Highly structured **theme JSON** (`@visactor/vchart-theme` 1.13.1).
  - **`updateSpec`** in-place updates (2.1.0).
  - LLM tooling: **VMind** (`@visactor/vmind` 2.0.10, MIT) generates specs from natural language. That is a Step-2 reference.
- **Weaknesses:**
  - **617 KB gz**, the heaviest.
  - Canvas only. SVG via the separate `@visactor/vchart-svg-plugin` after render, with animation off.
  - No parallel coordinates or force graph.
  - Docs Chinese-first.
  - ByteDance origin likely triggers vendor-risk questions at some banks.
- **Verdict:** reference for motion and storytelling patterns and for the native waterfall/mosaic spec design.

### 5.4 Plotly.js 4.1.2: consider (narrow complement), reference otherwise
- **Licence and versions:** MIT, 18.4k★. **v4.0.0 published 2026-08-24**, with 4.1.2 on 2026-10-05.
- **Breaking changes in 4.0:**
  - `scattermapbox`, `choroplethmapbox`, `densitymapbox` and `layout.mapbox` were **removed**; use the MapLibre-based `*map` traces.
  - Chart Studio bits, `stream` and `*src` attributes were removed.
  - **Colour parsing moved from tinycolor2 to culori (CSS Color 4).** `rgb()` 0–1 fractions are no longer rescaled, `hsv()` is rejected, and auto-contrast now uses WCAG ratios.
  - MathJax v2 was dropped.
  - New `quiver` trace, sankey `node.sort/link.sort:'input'`, geo `projection.minscale/maxscale`, bundled TS types.
- **Partial bundles** (official README, min+gz):

  | Bundle | gz | Contents |
  |---|---|---|
  | basic | 401 kB | bar/pie/scatter |
  | cartesian | 504 kB | + box/contour/heatmap/histogram/violin |
  | finance | 436 kB | bar/candlestick/funnel/funnelarea/histogram/indicator/ohlc/pie/scatter/**waterfall** |
  | geo | 470 kB | — |
  | gl2d | 502 kB | — |
  | gl3d | 564 kB | — |
  | map | 892 kB | — |
  | **strict** | 1.59 MB | all traces, no `new Function` (CSP-safe) |
  | full | 1.49 MB | — |

- **Coverage:** waterfall ✅, funnel ✅, sankey ✅, treemap/sunburst/icicle ✅, parcoords/parcats ✅, splom ✅, 3D surface ✅, indicator gauges ✅, candlestick ✅. **No** chord, calendar, force graph or beeswarm (random jitter only).
- **Interaction:** best-in-class *out of the box*: drag-zoom, pan, rangeslider/rangeselector, box/lasso select (`plotly_selected` events → cross-filter), hover modes, modebar with **SVG/PNG export** (`Plotly.toImage`, `downloadImage`).
- **Animation:** limited. `Plotly.animate` works for scatter/bar frames; there is no enter/morph polish.
- **Theming:** `layout.template` gives deep theming (fonts, axes, colourway, per-trace defaults). A pitchbook look is achievable but takes work, and the default "plotly" look is recognisable.
- **Offline gotchas:**
  - **Geo traces fetch topojson from `cdn.plot.ly` by default.** Pre-load it through the global **`window.PlotlyGeoAssets = {topojson:{…}}`** (present in the 4.1.2 bundle) or set `config.topojsonURL` to a local path. A local path still fails under `file://` because it uses XHR.
  - Set `config.displaylogo:false`.
- **Use only if:**
  - analysts want `plotly.py` parity (`fig.to_json()` → `data/*.js`), or
  - a scientific chart (3D vol surface, splom, parcats) is needed.
- Otherwise ECharts + echarts-gl cover it at a fraction of the weight.

### 5.5 Vega 6.4 / Vega-Lite 6.5 / vega-embed 7.3: consider (explore/ask mode)
- **Licence:** BSD-3 (UW IDL). Vega 12.0k★, VL 5.5k★.
- **Vega 6.0 (2025-03-27)** declares *"Vega is now ESM only!"* for package entry points, but **`build/vega.min.js` UMD is still published in 6.4.0**, as are `vega-lite.min.js` and `vega-embed.min.js`. Smoke test passed: `window.vega`, `vegaLite`, `vegaEmbed`.
- **Vega-Lite 6.5.0 (2026-10-08):** exponential moving average, tooltip field filtering, ResizeObserver container sizing.
- **Strengths:**
  - **The best declarative interaction model.** `params` with `select:'interval'|'point'`, `bind:'scales'` (zoom/pan), `bind:'legend'`, and cross-view filtering via `filter:{param}`.
  - Coordinated multiple views (concat/facet/repeat) with zero imperative code.
  - Transforms: aggregate, bin, **calculate (expression language)**, window, joinaggregate, fold, pivot, lookup, density, loess, regression, quantile, impute.
  - Altair emits it, so Python analysts already know it. It is also the chart grammar **LLMs generate most reliably**.
- **Weaknesses:**
  - **No animation.** There is only an experimental `time` encoding; 6.5 merely fixes "animation selections".
  - Vega-Lite has no sankey, treemap, sunburst, chord, radar or gauge (Vega has treemap/partition/force but no sankey).
  - Nominal axes sort alphabetically by default (`sort:null` needed; smoke test showed COGS, D&A, EBIT, Opex, Rev).
  - Look is "academic" until heavily configured.
  - The expression engine uses `new Function` (CSP; use `vega-interpreter` if CSP ever applies).
- **Role:** lazy-loaded in the **query console / "ask your data"** module. The LLM or user emits a VL spec, which is validated against the VL JSON schema and rendered SVG. It is not part of the printed pitchbook pages.

### 5.6 Observable Plot 0.6.17 + D3 7.9.0
- **Plot** (ISC, 5.4k★):
  - Last release **2025-02-14** (20 months ago) although the repo is still committed to (2026-09). Slow cadence; still 0.x.
  - SVG, concise, beautiful defaults for static exploratory graphics.
  - Marks: bar, rect, cell, dot, line, area, text, tip, geo, hexbin, density, contour, raster, vector, arrow, link, tree, waffle, box, rule, tick, difference.
  - Transforms include **dodge (beeswarm)**, stack, normalize, window, bin, group.
  - Faceting with fx/fy.
  - **No zoom, no brush-to-filter (pointer/tip only), no animation.** Ordinal domains sort alphabetically by default.
  - Verdict: reference (good for static small multiples, but ECharts covers that).
- **D3 7.9.0** (ISC, 113.7k★): no release since 2024-03, but it is the bedrock everyone builds on.
  - As a *charting library* it is too low-level for a kit of 50+ components maintained by a small team.
  - As a **utility** it is valuable:
    - `d3-format` (financial number formats)
    - `d3-scale` / `d3-scale-chromatic` (colour scales for our tokens)
    - `d3-hierarchy`, `d3-sankey` 0.12.3 (BSD-3, last 2019)
    - `d3-geo` projections
  - Verdict: **consider**, as an optional vendored UMD (`dist/d3.min.js`, 90 KB gz) for bespoke one-off SVG exhibits and maths helpers.

### 5.7 Chart.js 4.5.1 (+ plugin ecosystem): reference / avoid as primary
- **Licence and status:** MIT, 67.7k★. Latest 4.5.1 (2025-10-13); no v5 on npm.
- **Pros:**
  - Tiny core (68 KB gz).
  - Smooth default animations.
  - Huge community.
  - Every plugin we tested registers from UMD under `file://`: sankey, treemap, matrix, boxplot + **violin**, zoom, datalabels, annotation.
- **Cons for this project:**
  - **Canvas only**, so print is raster. Workaround: `devicePixelRatio` bump plus `beforeprint` resize.
  - Breadth comes from a **patchwork of plugins with uneven maintenance:** `chartjs-plugin-datalabels` last released **2022-12**, `chartjs-chart-financial` **0.2.1, 2024-03** (needs a date adapter).
  - No geo-symbol maps beyond the geo plugin, no calendar, no chord, no parallel, no axis breaks.
  - Waterfall and football field only via floating bars.
  - Default legend shows "undefined" when `label` is missing.
- **Verdict:** reference. Only consider it for ultra-light embedded mini-charts. uPlot or hand-SVG are lighter still.

### 5.8 billboard.js 4.1.1: reference
- **Licence and status:** MIT, NAVER, 6.0k★. A D3-based C3 successor with active releases.
- **4.0.0 (2026-06-16):** **opt-in canvas mode** for dense bubble, candlestick and treemap (SVG stays default) and a lighter ESM build.
- **Types:** line, spline, step, area and area-range variants, bar, bubble, **candlestick**, donut, pie, **gauge**, **funnel**, polar, radar, scatter, treemap.
- **Features:** zoom + **subchart** (navigator), regions and grid lines, `export()` to PNG, plugins (stanford, textoverlap, tableview, sparkline, bubblecompare).
- **Pro:** SVG with **CSS-class theming**. Styling with our CSS tokens is natural.
- **Con:** too narrow (no sankey, sunburst, heatmap, geo, parallel, chord); 267 KB gz with d3 bundled.
- **Verdict:** reference.

### 5.9 uPlot 1.6.32: consider (complement for density and sparklines)
- **Licence and status:** MIT, 10.5k★, **21 KB gz** IIFE. Last release 2025-03-14, repo active 2026-10.
- **Strengths:**
  - Renders ~1M points in tens of ms.
  - **Cursor sync** across charts (`cursor.sync.key`).
  - Drag-zoom.
  - Tiny memory footprint per instance.
- **Weaknesses:** canvas only, time/numeric-x oriented, minimal styling primitives, no animation.
- **Role:**
  - **Sparklines in comps/league tables:** 20–100 instances per page, where ECharts instances at ~1–2 MB heap each are wasteful.
  - Tick-level price histories when >1M points.
  - Otherwise ECharts LTTB is enough.

### 5.10 AG Charts 14.2.0 Community vs Enterprise: avoid
- **Verified in-browser** with the Community UMD. Creating these series logged *"AG Charts - unable to use these enterprise features as 'ag-charts-enterprise' has not been loaded"* and nothing rendered: `waterfall`, `sankey`, `heatmap`, `box-plot`, `candlestick`, `radar-line`, `funnel`, `treemap`, and options `zoom`, `navigator`.
- Official comparison: Community = "basic chart types" (bar, line, area, scatter, bubble, histogram, pie, donut) + tooltips + download API.
- **Animations, zoom, navigator, crosshairs, context menu, sync, financial charts, maps and 20+ types are Enterprise (commercial).**
- 412 KB gz, canvas.
- **Verdict:** avoid. Polished, but the free tier is too thin for IB use.

### 5.11 IBM Carbon Charts 1.27.21: reference
- **Licence and status:** Apache-2.0, vanilla UMD (`Charts.*`), SVG via D3, 161 KB gz + CSS.
- **Types:** Alluvial (sankey), Area, Bar (simple/grouped/stacked), Boxplot, Bubble, **Bullet**, **Choropleth** (experimental), CirclePack, Combo, Donut, Gauge, Heatmap, Histogram, Line, Lollipop, Meter, Pie, Radar, Scatter, Tree, Treemap, WordCloud.
- Themes white/g10/g90/g100 via CSS.
- Accessibility-minded; enterprise-dashboard look tied to IBM Carbon. Hard to make it look like a GS/JPM pitchbook without fighting the CSS.
- Needs a sane locale (crashed with `en-US@posix`).
- **Verdict:** reference for accessibility patterns and the bullet chart.

### 5.12 ApexCharts 8.2.0: avoid (licence change)
- **Licence bisected on npm:**
  - `4.7.0` (2025-04-24) and `5.0.0` (2025-07-09) were **MIT**.
  - From **`5.1.0` (2025-07-09)** the field is "SEE LICENSE IN LICENSE.md" / "ApexCharts License".
- **Current `LICENSE.md` (8.2.0):** a *dual licence*.
  - The **Community License is free only for organisations with < US$2M annual revenue/budget/funding (incl. parent and affiliates).** Everyone else needs a **Commercial (Pro/Premium/OEM)** licence.
  - Redistribution inside toolkits/SDKs/platforms needs **OEM**.
  - Premium-only features: Unit/Waffle, Raincloud, Trellis, Storyboard, Linked Views, Ink, Measure Ruler, Context Menu, Perspectives, Rewind.
- An investment bank is far above the cap, so this is **commercial**.
- Forking MIT 5.0.0 is legal but freezes us on an abandoned line.
- **Verdict:** avoid.

### 5.13 Commercial: Highcharts 13.1.1, amCharts 5.21.2, ZingChart 2.9.16. Reference only.
- **Highcharts (Highsoft):**
  - **Proprietary**: "licensed, not sold". Source is downloadable but it is not OSS.
  - Licence types:
    - **Internal**: employees only, not clients.
    - **SaaS**: required for public websites and "External Applications" that deliver account-specific content, which is what **client reports** are.
    - **OEM**: customer installations.
  - Widely used in financial services. Stock, Maps, Gantt, Dashboards and Grid have the richest finance feature set (navigator, data grouping, technical indicators, accessibility module, offline exporting).
  - Default output shows a "Highcharts.com" credit.
  - **Use as a design and UX reference** (e.g. accessibility module, broken-axis, variwide, dependency wheel).
- **amCharts 5:**
  - Free "linkware" `LICENSE`: you *can* use it commercially, **but must not hide or alter the amCharts branding link/logo on every chart**, must ship the LICENSE, and cannot sell it. A paid licence removes branding.
  - Best-in-class animation and maps (geodata packages), stock chart, gantt, flow/sankey/chord, force-directed graph.
  - Logo on client deliverables → unacceptable, so reference only.
- **ZingChart:**
  - Proprietary; npm `license` field empty.
  - Free "Branded License" requires a visible **"Powered by ZingChart" watermark + link**, which is not shown only on localhost. Paid tiers remove it ($99–$9,999, OEM on request).
  - Its `file://` render took 1.37 s.
  - **Avoid.**

### 5.14 Finance-specialist engines: Lightweight Charts 5.2.1, KLineChart 10.0.4
- **TradingView Lightweight Charts:**
  - Apache-2.0 **plus a NOTICE requirement**. README: *"This license requires specifying TradingView as the product creator. You shall add the 'attribution notice' from the NOTICE file and a link to https://www.tradingview.com/ to the page …"* The `attributionLogo` option satisfies the link part.
  - **Flag it as non-standard attribution** in client PDFs.
  - Canvas; excellent pan/zoom for OHLC; 60 KB gz.
- **KLineChart 10:** Apache-2.0 with no extra attribution, 58 KB gz, canvas, built-in indicators and drawing tools.
- **Both are reference.** ECharts candlestick + dataZoom + markLine covers pitchbook price/volume charts. The repo already has `price-volume/`.

### 5.15 React-only: Recharts 3.10.1, Nivo 0.99.0, visx 4.0.0 (also Victory 37, MUI X Charts 9, Tremor 3)
- All require React (and often a bundler).
- **React 19 removed the UMD builds**, so "React via `<script>`" now means vendoring an old React 18 UMD or bundling with esbuild into an IIFE.
- Recharts ships `umd/Recharts.js` but expects `React`/`ReactDOM` globals.
- Nivo and visx have no UMD at all.
- MUI X Charts Pro features are commercial.
- Quality is high (Recharts is the most popular React chart lib at 27.6k★; visx is D3-in-React primitives).
- **Verdict: avoid** for a vanilla HTML/CSS/JS report kit. Revisit only if the gallery site itself becomes a React app.

### 5.16 Stale, broken or out-of-scope (avoid)

| Library | Why |
|---|---|
| Taucharts 2.8.0 | Last release 2020-02; throws without an external d3 global (`yn.format is not a function`) |
| Frappe Charts 1.6.2 | Last stable 2021-06 (2.0 stuck in rc29); a dozen types only; rendered empty axes at the 400 ms snapshot |
| C3 0.7.20 | 2020; superseded by billboard.js |
| Britecharts 2.18.2 | 2023, unmaintained |
| Toast UI Chart 4.6.1 | 2022-12, unmaintained |
| Chartist 1.5.0 | MIT OR WTFPL; minimal SVG line/bar/pie; no interaction |
| Dygraphs 2.2.2 | MIT time-series only; dated look |
| **Vizzu 0.18.0** | Apache-2.0. *Beautiful* animated transitions between chart types (a reference for motion design!). But it is **ESM + WASM** (`cvizzu.wasm`) and **fails under `file://`**. |
| **Unovis 1.7.1** | Apache-2.0, well-designed TS lib from F5. ESM-only, no UMD; could be esbuild-bundled to IIFE but adds nothing over ECharts. |
| BokehJS 3.10.1 | BSD-3; Python-first (linked brushing via shared `ColumnDataSource`, `output_file(mode='relative')` offline). Scientific look; 1.36 MB min core. A reference for analyst-side tooling, not client pitchbooks. |
| Plottable 4.0.0 | Ex-Palantir. A 4.0.0 appeared on npm 2026-10-07; not evaluated; historically low activity. |
| Google Charts | Not on npm. The ToS forbid offline/self-hosted loading of the library → incompatible with R1. |

---

## 6. 横向维度对比 (cross-cutting comparison)

| Dimension | ECharts 6.1 | G2 5.4 | VChart 2.1 | Plotly 4.1 | Vega-Lite 6.5 | Obs. Plot | Chart.js 4.5 | billboard 4.1 | uPlot | Highcharts (ref) | amCharts 5 (ref) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Renderer | **SVG or canvas** (per instance) | canvas (SVG via g-svg + lite) | canvas (SVG plugin) | SVG (+WebGL traces) | **SVG** or canvas | SVG | canvas | SVG (+canvas opt-in) | canvas | SVG | canvas+SVG |
| Theming depth | ★★★★★ theme JSON + `setTheme` + rich text + decal | ★★★★ | ★★★★★ token JSON | ★★★★ template | ★★★★ config | ★★★ CSS/opts | ★★★ defaults | ★★★★ CSS | ★★ | ★★★★★ | ★★★★★ |
| Animation | ★★★★★ (universalTransition, valueAnimation) | ★★★★ (morphing) | ★★★★★ (storytelling) | ★★ | ★ (none) | ☆ | ★★★★ | ★★★ (d3 transitions) | ☆ | ★★★★ | ★★★★★ |
| Zoom | dataZoom inside/slider/box | slider/scrollbar/wheel | dataZoom/scrollBar | drag/rangeslider | `bind:'scales'` | ❌ | plugin | zoom+subchart | drag | ✅ navigator | ✅ |
| Brush / cross-filter | brush + events + `connect` | brushFilter (in-chart) | brush | box/lasso events | ★★★★★ native params | ❌ | ❌ | ◐ | ◐ (select) | ✅ | ✅ |
| Live data re-render | `setOption` diff + `replaceMerge` | `changeData` | `updateSpec`/`updateData` | `Plotly.react` | `view.change()` | re-plot | `chart.update()` | `load()` | `setData()` | `setData` | data processor |
| Multi-dim encoding | visualMap (colour/alpha/size/symbol), callbacks, decal | grammar encode (x,y,color,size,shape,opacity) | spec fields + visual maps | marker arrays | grammar encode | grammar channels | manual per-point | manual | manual | colorAxis, zAxis | heat rules, adapters |
| Print fidelity | ★★★★★ (SVG mode verified vector) | ★★★ | ★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★ (raster) | ★★★★★ | ★★ | ★★★★★ | ★★★★ |
| Image export API | `getDataURL` PNG/SVG, `renderToSVGString`, toolbox `saveAsImage` | `chart.getContext().canvas` | `exportImg` | `toImage`/`downloadImage` | `view.toSVG/toImageURL` | serialize SVG | `toBase64Image` | `export()` | canvas | exporting module | exporting plugin (PDF/XLSX) |
| Server-side render | ✅ Node SSR SVG (zero deps) | node-canvas | node-canvas | Kaleido (Python) | `vl-convert` (Python/Rust) | jsdom | node-canvas | jsdom | — | export server | — |
| a11y | `aria` auto-description + decal | ◐ | ◐ | ◐ | ◐ (SVG aria) | ◐ | ◐ | ◐ | ❌ | ★★★★★ | ★★★★ |
| `file://` UMD | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Licence OK for bank | ✅ Apache-2.0 | ✅ MIT | ✅ MIT | ✅ MIT | ✅ BSD-3 | ✅ ISC | ✅ MIT | ✅ MIT | ✅ MIT | ❌ commercial | ❌ logo / commercial |

---

## 7. Pitchbook / think-cell 风格在 ECharts 中的实现配方 (recipes)

think-cell is the de-facto IB charting tool, so its feature list is the reference. How each feature maps to ECharts:

| think-cell feature | ECharts implementation | Status in test |
|---|---|---|
| Waterfall with connectors, subtotals and "e" (end) totals | `custom` series → `group{rect, text, line(dashed)}`; totals flagged in data | ✅ verified |
| **Value axis break** | `yAxis.breaks` (v6) + `breakArea` zig-zag | ✅ verified |
| Mekko (% and unit) | `custom` on value-value axes; width = segment total | ✅ verified |
| CAGR arrow / bubble | `graphic` polyline + ellipse + text, with `convertToPixel` (recompute on resize). Or a custom series bound to data coordinates, which survives resize and zoom. | ✅ verified (graphic) |
| Level / difference arrows | `markLine` between two `yAxis` values with `symbol:['none','arrow']` + label, or a custom series | recipe |
| 100% stacked with totals above | stacked bars + an extra invisible `bar` series carrying totals as label (`position:'top'`) | recipe |
| Data labels inside/outside with auto-contrast | `label.position` + `label.color` per item (compute WCAG contrast in kit) | recipe |
| Negative numbers in parentheses, "x" multiples, "bps" | formatter compiled from Excel-like format string (`#,##0.0;(#,##0.0)`) | kit formatter |
| Gantt / timeline | `custom` (bar-range) or `@echarts-x/custom-bar-range` | recipe |
| Football field | transparent stack or `custom`, plus `markLine` for the current price | ✅ verified |
| Scatter with labelled points, no overlap | `labelLayout:{hideOverlap:true, moveOverlap:'shiftY'}` + `labelLine` | built-in |
| Consistent scale across charts ("same scale") | kit computes shared `min/max` across sibling components; ECharts `alignTicks` for dual axes | kit |

Kit architecture implications (consistent with `docs/architecture.md`):
- Register kit custom series once: `RK.series.waterfall`, `RK.series.mekko`, `RK.series.range` via `echarts.registerCustomSeries`, so components and LLM-generated configs reference them by name.
- **Python emits component config + dataset**, not raw ECharts options (formatter functions can't be JSON). The JS component compiles config → option. This keeps data swappable and lets a future API or LLM target a small validated schema.
- Default renderer is SVG. Components with >5k marks set `renderer:'canvas'` + `devicePixelRatio:max(2, dpr)` and a print snapshot.
- On `beforeprint`: `setTheme('rk-print')` (no animation, black text, hairlines) → `resize()`. On `afterprint`: restore.

---

## 8. 推荐 (final recommendation)

**PRIMARY: Apache ECharts 6.1.0** (keep the vendored full UMD; pin 6.1.x; watch for 6.2).
- Reasons, in order:
  1. Permissive (Apache-2.0) and ASF-governed.
  2. Single classic script covering ~95% of the IB chart vocabulary natively. The remaining 5% (waterfall, mekko, football field, CAGR) are proven custom-series recipes.
  3. **Dual SVG/canvas renderer**: vector print and big-data canvas.
  4. Deepest theming of any OSS engine, now with runtime `setTheme`.
  5. Mature interaction (dataZoom, brush, connect, visualMap, universalTransition).
  6. Node SSR from the same file for static SVG/PNG fallbacks.
  7. Python ecosystem (pyecharts 2.1 targets v6) and strong LLM familiarity with its option JSON.

**Complements (ranked):**

| Rank | Library | Status | Role |
|---|---|---|---|
| 1 | `@echarts-x/custom-*` (Apache-2.0) | adopt per need | violin, bar-range/line-range (gantt, ranges), contour, segmented doughnut |
| 2 | uPlot 1.6.32 (MIT, 21 KB gz) | consider | table sparklines and >1M-point series |
| 3 | D3 7.9.0 (ISC) | consider (utility) | d3-format/scale/hierarchy/geo helpers; bespoke SVG exhibits |
| 4 | Vega-Lite 6.5 + Vega 6.4 + vega-embed 7.3 (BSD-3) | consider, lazy | "explore / ask" console: declarative cross-filter, LLM-generated ad-hoc charts (validated against the VL schema), Altair interop. Not in printed pages. |
| 5 | echarts-gl 2.1.0 (MIT) | optional | 3D surfaces (vol surface), globe |
| 6 | Plotly.js 4.1 (MIT) partial bundles | optional | only if analysts insist on plotly.py parity or need parcats/splom |

**Reference-only for design ideas:**
- Highcharts: accessibility, broken axis, variwide, navigator UX.
- amCharts 5: animation timing, map interactions.
- VChart: storytelling player, native waterfall/mosaic specs, VMind.
- G2: `flexX`, `elementPointMove` drag-to-edit, morphing.
- Vizzu: animated chart-type transitions.
- think-cell: annotation vocabulary.

---

## 9. Gotchas 汇总 (all libraries)

1. **Intl locale in headless runs:** `navigator.language` can be `en-US@posix` under `LANG=C`. uPlot, Carbon and LWC crash. Sanitise the locale and set Playwright `locale`.
2. **Canvas ≠ print quality:** a canvas chart printed to PDF at ~104 ppi (measured). Use SVG or a high-DPR snapshot.
3. **Mid-animation captures:** headless screenshots and PDFs taken <1 s after render caught ApexCharts, Carbon and Frappe mid-animation. Disable animation for print and SSR, or await `finished` (ECharts event `'finished'`).
4. **ESM/WASM under `file://`:** module scripts and `.wasm` fetches are CORS-blocked on `file://` in Chromium (Vizzu verified). Same for Perspective and DuckDB-WASM (see 03/08 notes). ESM-only JS libs can still be pre-bundled to an IIFE with esbuild at **kit-build time**; WASM can't be (unless base64-inlined and the lib supports it).
5. **"ESM-only" ≠ no UMD:** Vega 6 says ESM-only, yet `build/*.min.js` UMD still ships and works. Always check the actual dist listing (jsdelivr) rather than release notes.
6. **Licence drift:** ApexCharts went MIT → proprietary in a *minor* version (5.0.0 → 5.1.0). **Pin exact versions in `vendor/vendor.json` and re-check `npm view <pkg>@<ver> license` in CI** before any bump.
7. **Attribution clauses:** Lightweight Charts (TradingView notice + link) and amCharts (logo). Highcharts and ZingChart show credits/watermarks by default.
8. **Free tiers that are really demos:** AG Charts Community lacks waterfall, sankey, heatmap, box, candlestick, radar, funnel, treemap, zoom, navigator and animation.
9. **Alphabetical default sort** of categorical axes in Vega-Lite and Observable Plot. Pass explicit order.
10. **Plotly geo** fetches topojson from `cdn.plot.ly`. Pre-load via `window.PlotlyGeoAssets`.
11. **Plotly 4 colour parser:** `rgb(0.2,0.4,0.6)`-style fractions now render near-black. Use hex or proper CSS colours.
12. **ECharts 6 defaults:** legend at bottom; anti-overflow axis layout can shift the grid; rich labels inherit plain label styles; 6.1 `containShape`. Always render with the kit theme and pinned version, and diff screenshots on upgrade.
13. **Fonts:** canvas renderers measure text with whatever font is loaded at first paint. Bundle fonts (OFL) and await `document.fonts.ready` before init.
14. **Tooltip HTML injection:** any engine that accepts HTML formatters (ECharts, Highcharts, ApexCharts, Plotly hovertemplate) must escape client-typed metric names and labels.
15. **React 19 has no UMD:** React-based chart libs are not drop-in for a classic-script kit.

---

## 10. Sources

- ECharts:
  - v6 feature page: https://echarts.apache.org/handbook/en/basics/release-note/v6-feature
  - 6.0.0 release note: https://archive.apache.org/dist/echarts/6.0.0/RELEASE_NOTE.txt
  - 6.1.0 release note: https://apache.cs.utah.edu/echarts/6.1.0/RELEASE_NOTE.txt
  - repo: https://github.com/apache/echarts
  - custom series: https://github.com/apache/echarts-custom-series ; npm `@echarts-x/custom-*`
  - dist listing: https://data.jsdelivr.com/v1/packages/npm/echarts@6.1.0?structure=flat
  - migration guide (secondary): https://www.mintlify.com/apache/echarts/migration/v5-to-v6
- AntV G2:
  - releases: https://github.com/antvis/G2/releases
  - SVG renderer with UMD: https://oss.issuehunt.io/r/antvis/G2/issues/4944
  - gglite notes on bundles: https://pkg.yihui.org/gglite/examples/canvas
- VChart:
  - releases: https://github.com/VisActor/VChart/releases
  - SVG plugin: https://github.com/visactor/vchart-svg-plugin
- Plotly.js:
  - v4 guide: https://plotly.com/javascript/guides/whats-new-in-v4/
  - bundle README: https://cdn.jsdelivr.net/npm/plotly.js@4.1.2/dist/README.md
  - v4 release (secondary): https://newreleases.io/project/github/plotly/plotly.js/release/v4.0.0
- Vega / Vega-Lite:
  - https://github.com/vega/vega/releases
  - https://github.com/vega/vega-lite/releases
- AG Charts: https://www.ag-grid.com/charts/javascript/community-vs-enterprise/ (plus in-browser verification)
- ApexCharts:
  - `LICENSE.md`: https://cdn.jsdelivr.net/npm/apexcharts@8.2.0/LICENSE.md
  - 6.0 blog: https://apexcharts.com/blog/apexcharts-6-0-release/
- Highcharts:
  - licence: https://shop.highcharts.com/license
  - reseller pricing (secondary): https://www.componentsource.com/product/highcharts-grid
- amCharts:
  - `LICENSE` in npm package: https://unpkg.com/@amcharts/amcharts5@5.21.2/LICENSE
  - download page: https://www.amcharts.com/download/
- ZingChart:
  - https://www.zingchart.com/pricing
  - https://help.zingsoft.com/article/413-zingchart-what-is-the-difference-between-the-branded-and-licensed-versions
- Lightweight Charts attribution: https://unpkg.com/lightweight-charts@5.2.1/README.md
- billboard.js 4.0: https://netil.medium.com/billboard-js-4-0-release-canvas-rendering-mode-94-3-faster-overall-in-benchmark-894b18798ffe
- Stars and activity: https://repos.ecosyste.ms/api/v1/hosts/GitHub/repositories/<owner>/<repo>
- npm registry (versions, licences, dates): `npm view` on 2026-10-14
- PyPI JSON API: https://pypi.org/pypi/<pkg>/json
- pyecharts v6 asset host: https://raw.githubusercontent.com/pyecharts/pyecharts/master/pyecharts/globals.py
