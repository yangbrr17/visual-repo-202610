# 07 — 合集与画廊：Awesome lists, mega-repos & galleries (curated catalogs)

> Angle: find curated "big repos" and galleries that already aggregate many viz libraries/components, so the report kit can use them as a **catalog** (taxonomy + reference implementations + candidate libraries).
> Research date: **2026-10-14**. All "last commit" dates come from shallow `git clone --depth 1` of the repos (HEAD commit date), all versions/licenses come from `npm view` / jsDelivr `data.jsdelivr.com` / PyPI, and stars come from shields.io (`img.shields.io/github/stars/<repo>.json`). GitHub REST API was not available in this session, so stars are shields.io rounded values.
> Raw working copies were in the session scratchpad only (not committed).

---

## 0. TL;DR 结论（先看这里）

1. **Best single catalog seed = `hal9ai/awesome-dataviz`** (formerly `fasouto/…` → `javierluraschi/…`; all three URLs serve the same repo). It is actively maintained (commit 2026-10-13), ~4.4k stars, ~420 entries in 24 sections, CC BY 4.0. Its JS sub-sections (Charting / Graphs / **Financial charts** / Maps / React / Misc ≈ 133 entries) already include the 2025–26 newcomers (ChartGPU, Vela, Flint, mapcn, Perspective's new org). Mirror site awesomedataviz.com shows "365 tools across 24 categories" with stars/commits/license columns.
2. **Best chart *taxonomy* to borrow = FT Visual Vocabulary** (9 relationship categories, 72 chart types, MIT for the software / machine-readable `chartTypes.csv`), cross-indexed with **data-to-viz.com** (6 data-shape roots → ~39 chart types + 12 caveats, MIT repo). Use FT as the *primary* gallery navigation ("what relationship?") and data-to-viz as the *secondary* filter ("what data shape do you have?").
3. **Best *reference implementation* gallery = Apache ECharts examples** (377 2D + 59 GL examples, Apache-2.0, machine-readable `chart-list-data.js` with category tags, bilingual titles). ECharts 6 added finance-relevant features: **axis breaks** (`bar-breaks-*`, `intraday-breaks-*` = trading-hours gaps) and the **matrix coordinate system** (sparklines/mini-bars inside a grid = think-cell/pitchbook "table with charts").
4. **Best map plugin catalog = official Leaflet Plugins DB** (578 plugin entries in 36 categories; machine-readable frontmatter in `Leaflet/Leaflet/docs/_plugins/<category>/*.md`). **0 of 578 are flagged compatible with Leaflet 2.x** → pin **Leaflet 1.9.4** (BSD-2) for the kit.
5. **Plugin matrix for Chart.js = `chartjs/awesome`** (75 table rows with v2/v3/v4 support badges, MIT). But badges are stale (e.g. `chartjs-chart-financial` is shown as unsupported on v4, while npm 0.2.1 has `peerDependencies: chart.js ^4.0.0`) → always re-verify via `npm view <pkg> peerDependencies`.
6. **License traps surfaced by the catalogs**:
   - **ApexCharts is no longer MIT** from **5.1.0 (2025-07-09)** onward: dual "Community (orgs < US$2M revenue) / Commercial" license; current 8.2.0. Last MIT = 5.0.0. An investment bank cannot use the Community tier → **avoid** (reference only). **Tabler's demo pages ship ApexCharts 7.0.0** (23 of 139 preview pages), so do not copy Tabler chart widgets verbatim.
   - **GSAP** 3.15.0: "Standard 'no charge' license" (non-OSI) — flag.
   - Data Viz Catalogue / Datavizproject are © content (no license) → borrow *concepts*, not text/images.
   - awesome-dataviz text is CC BY 4.0 → if we republish list text in our gallery, attribute.
7. **file:// traps surfaced**: **MapLibre GL JS 6.x is ESM-only** (`dist/maplibre-gl.mjs` + worker `.mjs`, no UMD) → last classic-script build is **5.24.0** (`dist/maplibre-gl.js`, BSD-3). **Leaflet 2.0.0-alpha.1** is ESM-first and has no plugin ecosystem. WASM-based libraries in the lists (Perspective, Vizzu, Mosaic/DuckDB-WASM) need fetch() of `.wasm` → do not work by double-click without inlining/base64 tricks.
8. **Step-2 (LLM + skills) relevant newcomers** found through the lists: **Microsoft Flint** (`flint-chart` 0.5.1, MIT, one spec → Vega-Lite / ECharts / Chart.js / Plotly / Excel; `flint-chart-mcp` server), **AntV `chart-visualization-skills`** (MIT, ships `SKILL.md` folders for G2/G6/X6/Infographic/GPT-Vis/T8), **AntV Infographic** (0.2.20, MIT, UMD build, streaming-tolerant DSL), **AntV GPT-Vis** (1.0.2, MIT, UMD), **awesomedataviz.com** (site advertises an MCP server in README). Caution: AntV's `chart-visualization` skill renders by **calling an external AntV cloud API via curl** → data leaves the machine; unacceptable for client data unless re-pointed to a local renderer.
9. **Framework-bound lists** (awesome-react-components 49k★, awesome-vue 74k★, shadcn charts, Tremor) are useful only as *design pattern* references (KPI cards, BarList, CategoryBar, Tracker, tooltip styles) because the kit is classic-script, no React/Vue build step.
10. **Stale lists**: `wbkd/awesome-d3` (last commit 2023-01, bl.ocks.org links dead), `zingchart/awesome-charting` (2021-02, vendor-biased; note the real name is *awesome-charting*, not *awesome-charts*), `ecomfe/awesome-echarts` (2025-01; its community gallery link makeapie.com is defunct), `Financial-Times/chart-doctor` (2024-03, but content is timeless).

---

## 1. 方法 Methodology

| Step | How | Notes |
|---|---|---|
| README fetch | `curl https://raw.githubusercontent.com/<owner>/<repo>/<branch>/README.md` and `git clone --depth 1` | raw.githubusercontent works; github.com HTML returns 403 to curl; GitHub REST API gated in this session |
| Category counts | Python split on `^#{2,4} ` headings, count `^\s*[-*] \[` bullets | Bullet counts include TOC bullets — noted where relevant |
| Leaflet plugins | sparse checkout of `Leaflet/Leaflet` `docs/_plugins` (one `.md` per plugin with YAML frontmatter: `name, category, repo, author, demo, compatible-v0/v1/v2`) | Directory = category |
| ECharts examples | sparse checkout of `apache/echarts-examples` `src/data/chart-list-data*.js`, `public/examples/ts` | JSON-like array with `category[]`, `id`, `title`, `titleCN`, `difficulty`, `since` |
| Vega-Lite gallery | sparse checkout `vega/vega-lite` `site/_data/examples.json`, `examples/specs` | |
| Versions | `npm view <pkg> --json` (version, license, time[version], dist.unpackedSize), jsDelivr flat listing for dist files | |
| Stars | `img.shields.io/github/stars/<repo>.json` | rounded |

---

## 2. 总览表 Master table of collections

Legend: ✅ active (commit ≤ 3 months), 🟡 slow (≤ 18 months), 🔴 stale (> 18 months).

| # | Collection | URL | Type | List license | Last commit | Stars | Size (entries) | Status | What we borrow |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **awesome-dataviz** (hal9ai; ex fasouto, javierluraschi) | https://github.com/hal9ai/awesome-dataviz · https://awesomedataviz.com | awesome list | CC BY 4.0 | 2026-10-13 | 4.4k | ~420 bullets / 24 sections (site: 365 tools) | ✅ | Library catalog seed incl. "Financial charts", "Maps", "Dashboards and BI", "Catalogs" sections |
| 2 | **awesome-d3** (wbkd) | https://github.com/wbkd/awesome-d3 | awesome list | CC0 1.0 | 2023-01-13 | 5.3k | 145 bullets / 6 sections | 🔴 | D3 plugin names: d3-annotation, d3-legend, d3fc, crossfilter, d3-interpolate-path, venn.js, d3-composite-projections, swoopy-drag |
| 3 | **awesome-echarts** (ecomfe) | https://github.com/ecomfe/awesome-echarts | awesome list | CC0 1.0 | 2025-01-16 | 1.6k | ~52 entries (89 link bullets incl. 37 TOC) | 🟡 | Extensions: echarts-wordcloud, liquidfill, echarts-leaflet, graph-modularity; Python bindings (pyecharts) |
| 4 | **Leaflet Plugins DB** | https://leafletjs.com/plugins · source `Leaflet/Leaflet/docs/_plugins` | official DB | BSD-2 (repo) | 2026-09-19 | 46k (Leaflet) | **578** plugin files / **36** categories | ✅ | Thematic map plugins: markercluster, heat, choropleth, dataclassification, DonutCluster, Canvas-Flowmap, PixiOverlay, glify, legends |
| 5 | **chartjs/awesome** | https://github.com/chartjs/awesome | awesome list (tables) | MIT | 2026-03-23 | 2.7k | 75 table rows (50 marked v4) | 🟡 | Chart.js plugin matrix: zoom, annotation, datalabels, financial, geo, matrix, sankey, treemap, boxplot, error-bars, venn, wordcloud, a11y-legend, chart2music |
| 6 | **awesome-geojson** (tmcw) | https://github.com/tmcw/awesome-geojson | awesome list | CC0 1.0 | 2026-09-23 | 2.6k | 123 / 8 sections | ✅ | GeoJSON ops for the Python builder & JS (turf, geojson-rewind, simplify, topojson) |
| 7 | **awesome-vector-tiles** (mapbox) | https://github.com/mapbox/awesome-vector-tiles | awesome list | CC0 1.0 | 2026-08-10 | 2.6k | 142 / 9 sections | ✅ | Only if we go vector tiles (PMTiles/MBTiles offline basemap) |
| 8 | **awesome-maplibre** | https://github.com/maplibre/awesome-maplibre | awesome list | BSD-3 | 2026-10-14 | 1.1k | 236 / ~12 sections | ✅ | MapLibre plugins, ECharts-MapLibre bindings, tile providers |
| 9 | **awesome-javascript** (sorrycc) — *Data Visualization* section | https://github.com/sorrycc/awesome-javascript#data-visualization | awesome list | none stated | 2026-10-14 | 35k | 866 total; **46** in DataViz | ✅ (but section is legacy-heavy) | Little: many entries are dead (rickshaw, envision, g.raphael, morris). Useful sections: Table/Grid, Spreadsheet, Maps, Animations |
| 10 | **awesome-react-components** (brillout) — *Chart / Map / Table* | https://github.com/brillout/awesome-react-components | awesome list | CC0 1.0 | 2026-01-26 | 49k | 664 total; ~23 chart, ~11 grid, ~12 table, 7 map | 🟡 | Design references only (React) |
| 11 | **awesome-vue** (vuejs) — *Charts / Map / Graph / Admin Template* | https://github.com/vuejs/awesome-vue | awesome list | MIT | 2026-10-01 | 74k | 1208 total; 9 charts, 8 maps, 5 graph, 18 admin | ✅ | Admin templates list; vue-data-ui (60+ chart comps) as design ref |
| 12 | **awesome-charting** (zingchart) | https://github.com/zingchart/awesome-charting | awesome list | MIT | 2021-02-25 | 2.1k | 62 | 🔴 | Nothing new; vendor-biased |
| 13 | **awesome-maps** (simsieg) | https://github.com/simsieg/awesome-maps | list of map *websites* | none in README | 2026-10-09 | 516 | 124 | ✅ | Not libraries — inspiration only |
| 14 | **awesome-leaflet** (harryprince) | (via context-awesome.com mirror) | awesome list | ? | ? | ~28 | 23 (mostly R pkgs) | 🔴 | Skip; use official Leaflet DB |
| 15 | **FT chart-doctor / Visual Vocabulary** | https://github.com/Financial-Times/chart-doctor · https://github.com/ft-interactive/visual-vocabulary | taxonomy poster + D3 templates | MIT (software only; FT content/branding ©) | 2024-03-12 / 2021-08-18 | 3.4k / 350 | **72 chart types / 9 categories**; 58 D3 v4 template folders | 🔴 (timeless) | **Primary gallery taxonomy** |
| 16 | **data-to-viz.com** (holtzy) | https://www.data-to-viz.com · https://github.com/holtzy/data_to_viz | decision tree | MIT (repo) | 2024-10-18 | 1.1k | 6 data roots, **~39** chart pages, 12 caveats (74 caveat files), ~20 data-format "stories", 20+ example CSVs | 🟡 | **Data-shape → chart decision tree**; example dataset naming scheme |
| 17 | **D3 Graph Gallery** (holtzy) | https://d3-graph-gallery.com · https://github.com/holtzy/D3-graph-gallery | code gallery | MIT | 2026-08-01 | 855 | 47 chart-family pages, **165** example HTMLs | ✅ | Small, readable D3 snippets per chart family (but **d3 v4/v6** code) |
| 18 | **Observable D3 gallery** | https://observablehq.com/@d3/gallery (collection: /collection/@d3/gallery) | notebooks | per-notebook (most @d3 notebooks are ISC – verify per notebook) | n/a | — | **147** listings | ✅ | Canonical D3 v7 idioms (zoomable sunburst, bar chart race, bubble map, etc.) |
| 19 | **Apache ECharts examples** | https://echarts.apache.org/examples · https://github.com/apache/echarts-examples | code gallery | Apache-2.0 | 2026-09-24 | 400 | **377** 2D + **59** GL; 301 TS files | ✅ | **Reference implementations**; category list; v6 features |
| 20 | **Vega-Lite examples** | https://vega.github.io/vega-lite/examples/ | spec gallery | BSD-3 | 2026-10-08 | 5.5k (vega-lite) | **203** gallery items / 6 groups; 633 spec files | ✅ | Grammar-level patterns (interactive multi-view, brushing/linking, layered annotations) |
| 21 | **Plotly.js gallery** | https://plotly.com/javascript/ | doc gallery | plotly.js MIT | n/a (v4.1.x shown) | 18k | 12 sections | ✅ | Financial section (waterfall, indicators, candlestick, funnel, time series w/ range selector) |
| 22 | **Data Viz Catalogue** (Severino Ribecca) | https://datavizcatalogue.com | catalogue | © (no license) | n/a | — | **60** methods / **16** functions | ✅ | Concept only: function taxonomy (Comparisons, Proportions, Relationships, Hierarchy, Location, Part-to-whole, Distribution, Movement/flow, Range, Data over time…) |
| 23 | **Data Viz Project** (Ferdio) | https://datavizproject.com | catalogue | © (no license) | n/a | — | **166** types | ✅ | Concept only: 4 facets — Family (Chart/Diagram/Geospatial/Plot/Table), Input, Function (Comparison/Concept/Correlation/Distribution/Geolocation/Part-to-whole/Trend over time), Shape |
| 24 | **shadcn/ui charts** | https://ui.shadcn.com/charts | copy-paste blocks | MIT | 2026-10-14 | 126k | **70** blocks (area 10, bar 10, line 10, pie 11, radar 14, radial 6, tooltip 9) | ✅ | Visual polish patterns (tooltips, gradients, radial KPI); Recharts **3.8.0**, React 19 |
| 25 | **Tremor Raw / Tremor Blocks** | https://tremor.so · https://github.com/tremorlabs/tremor · /tremor-blocks · /tremor-npm | copy-paste comps + blocks | Raw: Apache-2.0; Blocks: MIT; npm `@tremor/react` Apache-2.0 | 2025-10-10 / 2025-01-22 | 3.7k / 543 / 16k | Raw: ~35 components (AreaChart, BarChart, **BarList, CategoryBar**, ComboChart, DonutChart, LineChart, ProgressBar, ProgressCircle, **SparkChart, Tracker**…); Blocks: 300+ (381 .tsx) | 🟡 (acquired by Vercel 2025-01; npm frozen at 3.18.7 2025-01-13) | KPI/dashboard primitives taxonomy |
| 26 | **Tabler** | https://github.com/tabler/tabler | dashboard template | MIT | 2026-10-11 | 42k | 139 Astro preview pages | ✅ | Layout/CSS tokens, cards, tables, **@tabler/icons** 3.49 (MIT); **strip ApexCharts** |
| 27 | **AdminLTE 4** | https://github.com/ColorlibHQ/AdminLTE | dashboard template | MIT | 2026-10-08 | 46k | Bootstrap 5.3.8 pages | ✅ | Uses **Chart.js 4.5.1 + jsvectormap 1.7 + Tabulator 6.6.1** (all MIT) → license-clean reference |
| 28 | **AntV chart-visualization-skills** | https://github.com/antvis/chart-visualization-skills | Agent Skills pack | MIT | 2026-09-22 | 508 | 9 `SKILL.md` skills | ✅ | Step-2 skill format reference (but see data-egress gotcha) |

---

## 3. Top-4 README 深挖：categories extracted (verified via raw README)

### 3.1 awesome-dataviz (hal9ai) — 24 sections, ~420 entries

Source: `https://raw.githubusercontent.com/javierluraschi/awesome-dataviz/master/README.md` (same commit `94405b3` as hal9ai/fasouto URLs).

| Section | Entries |
|---|---|
| **JavaScript tools → Charting libraries** | 35 |
| JavaScript tools → Charting libraries for graphs | 18 |
| JavaScript tools → **Financial charts** | 9 |
| JavaScript tools → **Maps** | 22 |
| JavaScript tools → d3 | 1 (+ pointer to awesome-d3) |
| JavaScript tools → React | 18 |
| JavaScript tools → React Native | 7 |
| JavaScript tools → Misc | 23 |
| Android | 5 |
| C++ | 17 |
| **Dashboards and BI** | 13 |
| Flutter | 3 |
| Golang | 7 |
| iOS | 7 |
| Julia | 5 |
| JVM | 4 |
| Machine Learning | 18 |
| .NET | 8 |
| **Python** | 64 |
| R | 24 |
| Ruby | 4 |
| Rust | 4 |
| Markup-based | 17 |
| Other tools | 33 |
| Resources: Books 10 · **Catalogs 11** · Podcasts 3 · Twitter 10 · Websites 23 | 57 |

JS total ≈ 133. Notable entries (with our classification):

- **Charting (35)**: Apache ECharts, ApexCharts (⚠ license), billboard.js, C3, Cal-Heatmap, Carbon Charts, Chart.js, chart.xkcd, **ChartGPU** (WebGPU), Chartist, **Charts.css**, **dc.js**, DHTMLX Gantt (GPL/commercial ⚠), **Dygraphs**, ECharts GL, Epoch, Flot, **Frappe Charts/Gantt**, **G2**, **Glyph** (JSON→SVG + DuckDB + MCP; only 4★ → unvetted), Google Charts (online-only ⚠), GraphicsJS, heatmap.js, lit-line, MetricsGraphics, NVD3, **Observable Plot**, **Plotly.js**, roughViz, TOAST UI Chart, **Unovis**, **uPlot**, **VChart**, **Vizzu**.
- **Financial (9)**: chartjs-chart-financial, dxcharts-lite (MPL-2.0), HQChart, **KLineChart**, **Lightweight Charts** (Apache-2.0 + attribution notice requirement), React Financial Charts, TechanJS (dead), TradeCanvas, **Vela** (LuxAlgo, Apache-2.0, WebGL2, IIFE build available).
- **Maps (22)**: CanvasGlobe, Cesium, COBE, DataMaps, deck.gl, Dipper, globe.gl, Globedots, L7, L7Plot, **Leaflet**, Mapael, **mapcn** (React+MapLibre+shadcn, 12k★), **MapLibre GL JS**, maptalks, **OpenLayers**, Pharos AI, Potree, React Simple Maps, react-map-gl, TerriaJS, **VectorAtlas** (80 KB SVG world map, one path per ISO-3166 alpha-2 id → ideal offline choropleth base).
- **Misc (23)**: **Flint** (Microsoft), **Mosaic** (DuckDB-linked views), **Perspective** (now `perspective-dev` org), Vega, Vega-Lite, Textures.js, Timeline.js, vis-timeline, vtk.js, Vue Data UI, LayerChart, Layer Cake…
- **Dashboards & BI (13)**: Superset, DataLens, datart, **Evidence** (SQL+Markdown reports — closest conceptual sibling to our kit), Grafana, Kibana, Lightdash, Metabase, **Observable Framework** (static data-app generator), OpenSearch Dashboards, Perses, Redash, **Rill**.
- **Python (64)** relevant to our Python builder: altair (→Vega-Lite), bokeh, Dash, folium (→Leaflet), hvPlot, ipychart (→Chart.js), **lightweight-charts-python**, Lonboard (deck.gl), LIDA (LLM), plotly, pyecharts (via awesome-echarts).
- **Catalogs (11)**: Data Visualization Catalogue, Data Viz Project, R Graph Gallery, From Data to Viz, AnyChart Chartopedia, Depict Data Studio Chart Chooser, 5 Wikipedia lists.

### 3.2 awesome-d3 (wbkd) — 6 sections, 145 entries, last commit 2023-01-13

| Section | Entries |
|---|---|
| Charts (incl. "Third Party" React/Vue/Angular/Svelte) | 62 |
| Maps (incl. Third Party) | 18 |
| Utils | 29 |
| Miscellaneous | 14 |
| Server side | 2 |
| Bl.ocks.org profiles | 20 (all **dead links**: bl.ocks.org shut down) |

Still-useful items for a pitchbook kit: **d3fc** (financial components: candlestick/OHLC, WebGL series; npm 15.2.13 MIT, `build/d3fc.min.js` UMD 158 KB), **d3-annotation** (npm `d3-svg-annotation` 2.5.1 Apache-2.0 — callouts like think-cell), **d3-legend** (`d3-svg-legend` 2.25.6 Apache-2.0), **crossfilter** (`crossfilter2` 1.5.4 Apache-2.0, 14 KB) + **dc.js** (4.2.7 Apache-2.0 — cross-filtering), **d3-interpolate-path** (smooth line morphs), **venn.js**, **d3-funnel**, **d3-composite-projections** (Alaska/Hawaii insets), **d3-geo-projection**, **d3-area-label**, **swoopy-drag / swoopyarrows** (annotation arrows), **textures** (SVG patterns for B/W print). Also "D3 Discovery" site (d3-discovery.net) — unverified status.

### 3.3 awesome-echarts (ecomfe) — 89 link bullets (37 TOC) ≈ 52 entries, last commit 2025-01-16

Top-level: About · Learn (Official docs 3, Videos 0) · **Extensions (8 + 6 CN)** · Frameworks (Angular 2, AngularJS 1, Blazor 1, Flutter 1, React 3, React Native 2, Svelte 1, Vue 4, Web components 1) · Languages (Clojure, Java, JS 2, Julia, Jupyter, .NET, Node, PHP, PureScript, **Python 5**, R 3, Ruby, Tcl) · Tools (Grafana, Markdown, VSCode) · Community.

Extensions worth noting: `echarts-wordcloud` (2.1.0 ISC), `echarts-liquidfill` (3.1.0 MIT), `echarts-graph-modularity`, `echarts-leaflet` / `leaflet-echarts3` (old; ECharts 3/4 era), `echarts-extension-gmap/amap` (online map SDKs ✗ offline), `echarts-countries-js` (213 country maps), `echarts-china-cities-js`. Python: **pyecharts** (PyPI 2.1.0) — a working example of "Python builder emits ECharts option JSON".
Gotchas: community gallery link **makeapie.com is defunct**; ECharts 5+ no longer bundles world/china map GeoJSON — we must ship our own GeoJSON/TopoJSON (`echarts.registerMap`).

### 3.4 Leaflet Plugins DB — 578 plugins, 36 categories (source frontmatter)

| Category | # | Category | # |
|---|---|---|---|
| markers-renderers | 80 | geocoding | 17 |
| user-interface | 36 | interactive-pan-zoom | 16 |
| frameworks-build-systems | 32 | search-popups | 15 |
| edit-geometries | 26 | time-elevation | 14 |
| tile-image-display | 25 | measurement | 14 |
| **dataviz** | **21** | events | 13 |
| overlay-animations | 20 | **clustering-decluttering** | **13** |
| basemap-providers | 18 | bookmarked-pan-zoom | 13 |
| basemap-formats | 18 | synthetic-overlays | 12 |
| 3rd-party-integration | 18 | data-providers | 12 |
| overlay-data-formats | 17 | tile-load | 11 |
| layer-switching-controls | 17 | mouse-coordinates | 11 |
| geoprocessing | 10 | area-overlay-selection | 10 |
| vector-tiles | 9 | routing | 9 |
| dynamic-custom-data-loading | 9 | **heatmaps** | **8** |
| non-map-base-layers | 7 | minimaps-synced-maps | 7 |
| geolocation | 7 | print-export | 6 |
| plugin-collections | 3 | fullscreen-controls | 3 |

Frontmatter template: `name, category, repo, author, author-url, demo, compatible-v0, compatible-v1, compatible-v2`.
**Compatibility count: `compatible-v1: true` = 568; `compatible-v2: true` = 0.** → Leaflet 2.0 (npm tag `alpha` = 2.0.0-alpha.1, 2025-08) is not viable for a plugin-heavy kit. `latest` = **1.9.4** (2023-05-18), BSD-2, `dist/leaflet.js` 144 KB UMD.

Dataviz-relevant plugins (multi-dimensional encodings):

| Plugin | Repo | Encoding it adds | Notes |
|---|---|---|---|
| Leaflet.markercluster | Leaflet/Leaflet.markercluster | count → cluster size/colour; animated split | 1.5.3 MIT (2021), 4.2k★; `dist/leaflet.markercluster.js` |
| Leaflet.DonutCluster | kalisio/Leaflet.DonutCluster | cluster as **donut** of category shares | not on npm → vendor from repo |
| Leaflet.heat | Leaflet/Leaflet.heat | density heat (simpleheat) | 0.2.0 (2015); npm has no license field, repo LICENSE is BSD-2-style © Agafonkin |
| leaflet-choropleth | timwis/leaflet-choropleth | value → colour classes (chroma.js) | 1.1.4 MIT (2017) |
| leaflet-dataclassification | balladaniel/leaflet-dataclassification | **classification (quantile/jenks/equal) + symbology + auto legend**, incl. graduated symbol size | not on npm; best fit for "proportional symbols + choropleth + legend" |
| Leaflet.Canvas-Flowmap-Layer | jwasilgeo/… | origin→destination Bezier flows (width/colour) | canvas |
| Leaflet.PixiOverlay | manubb/… | WebGL sprites, animation (Pixi.js) | for 10k+ symbols |
| Leaflet.glify | robertleeplummerjr/… | WebGL points/polygons for 100 MB GeoJSON | |
| Leaflet.D3SvgOverlay | teralytics/… | D3 SVG layer that scales with zoom | |
| antv/l7-leaflet | antvis/L7-Leaflet | L7 WebGL layers on Leaflet | |
| leaflet-velocity | onaci/leaflet-velocity | animated vector fields | |
| leaflet-partition | locknono/… | Voronoi / hex tiling | |
| Leaflet.Legend / Leaflet.HtmlLegend | ptma/… / consbio/… | legends with toggle | |
| L.Donut, Leaflet.SvgShapeMarkers, Leaflet.VectorMarkers, Leaflet.TextPath, Leaflet.curve, Leaflet.Geodesic, Leaflet.PolylineDecorator | markers-renderers | shape / arc / label encodings | 80 entries in this category |

### 3.5 Bonus verified lists

**chartjs/awesome** — 75 rows; 6 sections (Charts 15 · Plugins: Styling 6 / Features 10 / Interactions 7 / Data Sources 2 · Adapters 6 · Integrations ~28 · Tools 1). Has a per-row support matrix for Chart.js v2/v3/v4. Verified npm peerDependencies (2026-10-14):

| Package | Version | License | peer chart.js | Classic script |
|---|---|---|---|---|
| chart.js | 4.5.1 (2025-10) | MIT | — | `dist/chart.umd.min.js` 204 KB |
| chartjs-plugin-zoom | 2.2.0 | MIT | — | `dist/chartjs-plugin-zoom.min.js` 15 KB (needs hammerjs for touch) |
| chartjs-plugin-annotation | 3.1.0 | MIT | — | dist min |
| chartjs-plugin-datalabels | 2.2.0 (2022) | MIT | >=3.0.0 | dist min |
| chartjs-chart-financial | 0.2.1 (2024-03) | MIT | **^4.0.0** (list badge says ❕ for v4 → stale) | `dist/chartjs-chart-financial.min.js` |
| chartjs-chart-geo | 4.3.6 | MIT | ^4.1.0 | `build/index.umd.min.js` 83 KB |
| chartjs-chart-matrix | 3.1.0 (2026-09) | MIT | >=3.0.0 | |
| chartjs-chart-sankey | 0.19.1 (2026-09) | MIT | >=3.3.0 | `dist/chartjs-chart-sankey.min.js` 19 KB |
| chartjs-chart-treemap | 4.2.2 (2026-09) | MIT | >=3.0.0 | |
| @sgratzl/chartjs-chart-boxplot | 4.4.5 | MIT | — | |

**awesome-geojson** (8 sections: operations 27, editors & viewers 17, validation 8, services 7, **conversion 35**, data 19, serialization 6, resources 4). Builder-side picks: turf (`@turf/turf` 7.4.0 MIT, `turf.min.js` 535 KB UMD), geojson-rewind (fix winding for d3-geo), simplify-geojson, topojson (`topojson-client` 3.1.0 ISC, 2019).

**awesome-maplibre** (236 entries): User Interface Plugins 30, Map Rendering Plugins 25, Layer Types 16, Utility Libraries 18, Map/Tile Providers 26, Users 58, bindings incl. **ECharts ↔ MapLibre** (2).

**awesome-vector-tiles** (142): Parsers & Generators 22, Clients 25, CLI apps 15, CLI utilities 24, Servers 40 … — only relevant if we ship offline vector basemaps (PMTiles).

---

## 4. 其余列表 Other lists (framework-bound or legacy)

- **awesome-javascript → Data Visualization (46 bullets)**: d3, metrics-graphics, three.js, Chart.js, paper.js, fabric.js, peity, raphael, echarts, visjs, two.js, sigma.js, arbor, cubism, dc.js, vega, envisionjs, rickshaw, flot, morris.js, nvd3, svg.js, heatmap.js, jquery.sparkline, trianglify, d3-cloud, d4, dimple.js, chartist, epoch, c3, BabylonJS, recharts, GraphicsJS, mxGraph, Frappe Charts/Gantt, G2, G2Plot, Cytoscape.js, cola.js, jointjs, vizzu, G6, **AntV Infographic** (newest addition). ~40 % are unmaintained jQuery-era libs. Its **Spreadsheet** (Handsontable ⚠ commercial, Frappe Datatable, Luckysheet, Jspreadsheet CE, RevoGrid) and **Table/Grid** (DataTables, Tabulator, Bootstrap Table…) sections are more useful.
- **awesome-react-components**: Chart (~23: echarts-for-react, recharts, victory, visx-era libs, nivo absent here, react-sparklines, react-timeseries-charts…), Editable grid (AG Grid ⚠ enterprise, Handsontable ⚠, MUI X, RevoGrid, SheetXL…), Table (TanStack Table — headless, `@tanstack/table-core` 9.3.1 MIT is framework-agnostic ✔), Map (react-leaflet, pigeon-maps, react-map-gl).
- **awesome-vue**: Charts (vue-chartjs, vue-echarts, vue-apexcharts ⚠, **vue-data-ui** 60+ comps, ZingChart ⚠ commercial), Map (vue-leaflet for Leaflet 1.x and a fork for 2.x, vue-maplibre-gl, vue3-openlayers, map-chart), Admin templates (18).
- **zingchart/awesome-charting**: Commercial 8 · Free & OSS 27 · Free 1 · Framework-specific 19 · Resources 7 — last commit 2021; skip.
- **simsieg/awesome-maps**: catalog of map *websites* (weather, transit, satellites, historic) — not libraries.

---

## 5. 图表分类法 Chart taxonomies to borrow (galleries & decision tools)

### 5.1 FT Visual Vocabulary — 9 categories × 72 chart types (machine-readable)

File: `ft-interactive/visual-vocabulary/chartTypes.csv` columns `chartName, category, img, avail, description`. **Gotcha: the CSV uses old-Mac CR (`\r`) line endings** — `wc -l` reports 0; parse with universal newlines (`csv` module in Python works).

| Category (FT wording) | # types | Examples |
|---|---|---|
| Deviation | 4 | diverging bar, diverging stacked bar, spine, surplus/deficit filled line |
| Correlation | 5 | scatter, column+line, connected scatter, bubble, XY heatmap |
| Change over Time | 12 | line, column timeline, column+line timeline, **stock price (OHLC)**, slope, area, **fan chart (projections)**, connected scatter timeline, calendar heatmap, Priestley timeline, circle timeline, seismogram |
| Ranking | 8 | ordered bar/column, proportional symbol ordered, dot strip, slope, lollipop h/v, bump |
| Distribution | 8 | histogram, boxplot, violin, population pyramid, dot strip, dot plot, barcode, cumulative curve |
| Part-to-whole | 11 | stacked column, proportional stacked bar (Marimekko), pie, doughnut, treemap, Voronoi, sunburst, arc (hemicycle), gridplot (waffle), Venn, **waterfall** |
| Magnitude | 12 | column, bar, grouped column/bar, proportional stacked bar, proportional symbol, isotype, lollipop h/v, radar, **bullet**, parallel coordinates |
| Spatial | 8 | **choropleth**, **proportional symbol**, flow map, contour, equalised cartogram, scaled cartogram, dot density, heat map |
| Flow | 4 | sankey, **waterfall**, chord, network |

`avail=TRUE` (has D3 template in repo) for 42 of 72 types; 58 template folders (D3 **v4**, each with `drawFrame.js`, `frameGlobalStyles.css`, `saveSvgAsPng.js` → FT "frame" concept = print/web/social sizes, worth copying as idea: fixed output frames for PPT-sized exports).
License: software MIT; **FT content and branding not covered** → do not reuse FT colours/fonts/logo.

### 5.2 data-to-viz.com — data-shape decision tree

Roots (from site): **Numeric** (one / two / three / several numeric; ordered), **Categoric** (one cat; several independent lists; nested; adjacency), **Num & Cat** (one num per cat one obs / several obs; several cats one num; several nums), **Maps** (GPS without value; GPS with value; region with value; connections), **Network** (adjacency matrix; nested value for connections/leaves; hierarchical), **Time series** (one / several series).
Portfolio = **39** chart items tagged by function: distribution, correlation, ranking, part-of-a-whole, evolution, maps, flow (+ data-type tags numonly/numfact/graphstructure, smalldata/bigdata).
Caveats gallery (12 featured; 74 files): order your data, cut the Y axis?, spaghetti chart, pie chart, histogram bin size, boxplots hide info, error bars, too many distributions, overplotting, **rainbow palette**, facet direction, don't be counter-intuitive.
`Example_dataset/` naming scheme is reusable for our test fixtures: `1_OneNum.csv, 2_TwoNum.csv, 3_TwoNumOrdered.csv, 4_ThreeNum.csv, 5_OneCatSevNumOrdered.csv, 6_SeveralNum.csv, 7_OneCatOneNum.csv, 9_OneNumSevCatSubgroupOneObs.csv, 10_OneNumSevCatSubgroupsSevObs.csv, 11_SevCatOneNumNestedOneObsPerGroup.csv, 13_Adjacency*.csv, 14_SeveralIndepLists.csv, 17_ListGPSCoordinates.csv, 18_ListGPSCoordinatesWithValue.csv, 19_MapConnection.csv`.

### 5.3 Data Viz Catalogue (60 methods, 16 functions) & Datavizproject (166 types, 4 facets)

- Catalogue functions: Comparisons, Proportions, Relationships, Hierarchy, Concepts, Location, Part-to-a-whole, Distribution, How things work, Processes & methods, Movement or flow, Patterns, Range, Data over time, Analysing text, Reference tool. Finance-relevant methods it covers that FT lacks: **Kagi, Point & Figure, Span chart, OHLC, Candlestick, Marimekko, Nightingale rose, Radial bar/column, Spiral plot, Timetable, Gantt, Error bars**.
- Datavizproject facets: Family (Chart, Diagram, Geospatial, Plot, Table), Input (A..Z codes), Function (Comparison, Concept visualization, Correlation, Distribution, Geolocation, Part to whole, Trend over time), Shape (Square, Circle, Area, Pyramid, Polygon, Line, Bar, Dot, Icon, Map).
- Both are © — use as cross-check for completeness, never copy text/thumbnails.

### 5.4 ECharts examples — 377 + 59 (machine-readable)

Category tag counts (`src/data/chart-list-data.js`, one example may have several tags): bar 46, line 40, scatter 36, map 25, custom 20, pie 19, **matrix 14**, graph 13, gauge 12, **candlestick 10**, calendar 9, dataset 9, pictorialBar 8, heatmap 7, sankey 7, sunburst 7, treemap 7, tree 7, radar 5, dataZoom 5, graphic 5, lines 5, chord 4, parallel 4, boxplot 4, funnel 4, animation 3(+1 typo "animtion"), rich 3, transform 2, themeRiver 2, visualMap 1, geo 1.
GL (`chart-list-data-gl.js`): bar3D 12, surface 11, globe 10, scatter3D 6, lines3D 4, map3D 4, flowGL 3, graphGL 3, geo3D 2, scatterGL 2, line3D 1, linesGL 1.
**28 examples flagged `since: 6.0.0`**: chord-*, matrix-* (correlation heatmap, covariance, confusion, sparkline, mini-bar geo, stock, periodic table, grid-layout), **bar-breaks-simple, bar-breaks-brush, intraday-breaks-1/2** (axis breaks), scatter-jitter, line-fisheye-lens, roam indicators, grid-outerBounds.
Entry fields `id, title, titleCN, category[], difficulty, since, ts` → can auto-generate our "reference implementation" links per FT chart type.
ECharts itself: **6.1.0** (2026-05-19; 6.0.0 = 2025-07-30), Apache-2.0, `dist/echarts.min.js` 1.1 MB UMD (also `echarts.common.min.js` 698 KB, `echarts.simple.min.js` 489 KB); echarts-gl 2.1.0 MIT `dist/echarts-gl.min.js` 625 KB.

### 5.5 Vega-Lite examples — 203 in 6 groups

Single-View Plots 115 (Bar 24, Histograms/Density/Dot 15, Scatter & Strip 14, Line 20, Area & Streamgraph 7, Table-based 8, Circular 6, Advanced Calculations 21) · Composite Marks 7 (Error bars/bands 4, Box plots 3) · Layered 19 (Labeling & Annotation 12, Other 7) · Multi-View 18 (Faceting 10, Repeat & Concat 8) · Maps 12 · **Interactive 32** (Interactive charts 24, Multi-view interactive 8).
Libraries: vega 6.4.0, vega-lite 6.5.0, vega-embed 7.3.0 — all BSD-3, all still ship **UMD** `build/*.min.js` (vega 509 KB + vega-lite 252 KB + vega-embed 59 KB). Gotcha: vega-embed's default actions menu links to the online editor — disable (`actions:false`) for client deliverables.

### 5.6 Plotly.js gallery — 12 sections

Fundamentals, Guides (v4 migration), Basic, Statistical, Scientific (contour, heatmap, ternary, parcoords, log), **Financial** (waterfall, indicators, candlestick, funnel/funnelarea, time series w/ rangeselector), **Maps** (tile map layers via MapLibre, density tile heatmap, choropleth tile map, lines, bubble maps), 3D, Subplots, Custom chart events, **Custom controls** (dropdown, buttons, slider, lasso, range slider/selector), Animations.
plotly.js-dist-min **4.1.2** (2026-10-05; 4.0.0 = 2026-08-24), MIT, `plotly.min.js` **4.7 MB** (heavy; partial bundles exist).

### 5.7 D3 Graph Gallery & Observable D3 gallery

- d3-graph-gallery: 47 family pages; 165 examples in `graph/` (barplot 14, line 10, scatter 7, backgroundmap 7, lollipop 6, bubblemap 6, …). Script tags: `d3.v4.js` ×183, `d3.v6.js` ×126 → **port to v7** before reuse (v6 removed `d3.event`; v7 is ESM-first but `d3@7.9.0` still ships `dist/d3.min.js` UMD 273 KB, ISC).
- Observable `@d3/gallery`: 147 listings (D3 v7 idioms). Notebooks are not offline-friendly; extract code manually.

### 5.8 shadcn/ui charts & Tremor — modern dashboard aesthetics (React)

- shadcn charts: 70 blocks (area 10, bar 10, line 10, pie 11, radar 14, radial 6, tooltip 9) built on **Recharts 3.8.0** (`apps/v4/package.json`), MIT. Borrow: CSS-variable chart palette (`--chart-1..5`), tooltip layouts (indicator line/dot/dashed), gradient fills, radial KPI with centre label.
- Tremor Raw (Apache-2.0, last commit 2025-10-10, Recharts ^2.15) components: AreaChart, BarChart, **BarList**, **CategoryBar**, ComboChart, DonutChart, LineChart, ProgressBar, ProgressCircle, **SparkChart**, **Tracker** + Card/Table/Tabs. Tremor Blocks MIT (frozen 2025-01-22). `@tremor/react` npm frozen at 3.18.7 (2025-01-13). → borrow the *component vocabulary* for KPI rows (BarList = ranked horizontal bars with labels; CategoryBar = segmented single bar; Tracker = status strip).

---

## 6. 仪表盘模板 Dashboard templates

| Template | Version (npm) | License | Charts it bundles | Classic script | Verdict |
|---|---|---|---|---|---|
| **Tabler** (`@tabler/core`) | 1.6.1 (2026-09-28) | MIT | **ApexCharts 7.0.0** (dual-license ⚠) in 23/139 preview pages; jsvectormap 1.7.0 (MIT) for vector maps; countup.js, tom-select, flatpickr, nouislider, list.js (all MIT/Apache) | `dist/js/tabler.min.js` 132 KB (+ ESM) | Consider for CSS/layout/icons; **replace ApexCharts** |
| **@tabler/icons** | 3.49.0 (2026-10-05) | MIT | 5k+ SVG icons | SVG sprite / webfont | Adopt (icons) |
| **AdminLTE** (`admin-lte`) | 4.10.0 (2026-10-01; repo refs 4.10.1) | MIT | **Chart.js 4.5.1**, jsvectormap 1.7.0, Tabulator 6.6.1, FullCalendar 7.1.1, Bootstrap 5.3.8, bootstrap-icons 1.13.1, OverlayScrollbars | `dist/js/adminlte.min.js` 27 KB | Consider; clean licenses; but all demo pages load from **cdn.jsdelivr.net** → must vendor |
| vue-vben-admin, soybean-admin, Geeker-Admin… (from awesome-vue) | — | MIT mostly | ECharts / Vue | build step | Reference only |
| shadcn-admin / Tremor blocks | — | MIT | Recharts | build step | Reference only |

---

## 7. 2025–2026 新秀 Newcomers surfaced by the lists

| Project | npm / version | License | Stars | Classic script? | Why it matters | Verdict |
|---|---|---|---|---|---|---|
| **Microsoft Flint** (`flint-chart`) | 0.5.1 (2026-08-14) | MIT | 4.4k | ✗ (ESM `dist/index.js`, per-backend `dist/{vegalite,echarts,chartjs,plotly,excel}/index.js`) | AI-oriented chart spec; channels include `x,y,x2,y2,color,opacity,size,shape,strokeDash,row,column,latitude,longitude,radius,detail,group,open,high,low,close,angle` + 70+ semantic types (Rank, Price, Country…); compiles to Vega-Lite / ECharts / Chart.js / Plotly / **editable Excel charts**; `flint-chart-mcp` server | Consider for Step 2 (pre-bundle to IIFE with esbuild) |
| **AntV Infographic** (`@antv/infographic`) | 0.2.20 | MIT | 7k | ✔ `dist/infographic.min.js` UMD 857 KB (global `AntVInfographic`) | Declarative, LLM-friendly infographic DSL, ~200 templates, streaming-tolerant | Consider (Step 2 / cover pages) |
| **AntV GPT-Vis** (`@antv/gpt-vis`) | 1.0.2 | MIT | 791 | ✔ `dist/umd/index.min.js` | Markdown-ish chart syntax for LLM output | Consider (Step 2) |
| **AntV chart-visualization-skills** | repo (2026-09-22) | MIT | 508 | n/a | 9 Agent Skills (`SKILL.md`): antv-g2-chart, antv-g6-graph, antv-x6-editor, antv-infographic, antv-gpt-vis, gpt-vis, antv-t8-ntv, chart-visualization, icon-retrieval | Reference for Step-2 skill packaging; ⚠ `chart-visualization` posts data to AntV cloud API |
| **@antv/mcp-server-chart** | 0.9.10 | MIT | 4.4k | n/a | MCP chart server (cloud rendering by default) | Reference |
| **ChartGPU** (`chartgpu`) | 0.4.0 | MIT | 3.3k | ✗ ESM, **WebGPU**, 135 MB unpacked | Huge time-series | Avoid (WebGPU availability, size, 0.x) |
| **Vela** (`@luxalgo/vela`) | 0.8.4 (2026-10-13) | Apache-2.0 | 1.1k | ✔ `dist/vela.global.min.js` 1 MB IIFE | Financial charting, WebGL2, plugin SDK | Consider (watch; 0.x) |
| **mapcn** | (React registry) | MIT | 12k | ✗ React/Tailwind | shadcn-style MapLibre map components | Reference |
| **VectorAtlas** | site | free (check terms) | — | SVG | 80 KB world SVG, ISO-A2 ids → zero-dependency choropleth | Consider (verify license) |
| **Glyph** (seanhanca/glyph) | — | ? | 4 | ? | JSON→deterministic SVG, DuckDB, MCP | Avoid (unvetted, 4★) |
| **Perspective** → `@perspective-dev/*` | 5.6.0 (2026-10-14) | Apache-2.0 | 11k | ✔ `dist/cdn/*.js` but **WASM** | Pivot/streaming grid+charts | Consider only with an HTTP server; ✗ file:// |
| **Mosaic / vgplot** (`@uwdata/vgplot`) | 0.33.0 | BSD-3 | 1.4k | ✗ ESM + DuckDB-WASM | Linked views over DuckDB | Reference for cross-filter architecture |
| **ECharts 6** | 6.1.0 | Apache-2.0 | 68k | ✔ | axis breaks, matrix coord, chord, jitter, new default theme | Adopt (core) |
| **AG Charts Community** | 14.2.0 | MIT | 485 | ✔ `dist/umd/ag-charts-community.min.js` 1.4 MB | Finance-styled charts; Enterprise features commercial | Consider (MIT part only) |

---

## 8. 版本/许可核验表 Verified versions & classic-script dist (npm, 2026-10-14)

| Package | Version | Release | License | Classic-script file (jsDelivr) | Size |
|---|---|---|---|---|---|
| echarts | 6.1.0 | 2026-05-19 | Apache-2.0 | dist/echarts.min.js | 1096 KB |
| chart.js | 4.5.1 | 2025-10 | MIT | dist/chart.umd.min.js | 204 KB |
| d3 | 7.9.0 | (2024) | ISC | dist/d3.min.js | 273 KB |
| vega / vega-lite / vega-embed | 6.4.0 / 6.5.0 / 7.3.0 | 2026-08/10/09 | BSD-3 | build/*.min.js (UMD) | 509/252/59 KB |
| plotly.js-dist-min | 4.1.2 | 2026-10-05 | MIT | plotly.min.js | 4721 KB |
| @observablehq/plot | 0.6.17 | 2025-02-14 | ISC | dist/plot.umd.min.js (needs d3 UMD) | 204 KB |
| uplot | 1.6.32 | 2025-03 | MIT | dist/uPlot.iife.min.js | 50 KB |
| billboard.js | 4.1.1 | 2026-09-30 | MIT | dist/billboard.pkgd.min.js | 811 KB |
| frappe-charts | 1.6.2 | 2026-10-14 | MIT | dist/frappe-charts.min.umd.js | 67 KB |
| dygraphs | 2.2.2 | 2026-07 | MIT | dist/dygraph.min.js | 127 KB |
| @antv/g2 | 5.4.8 | 2026-09 | MIT | dist/g2.min.js | 1058 KB |
| @visactor/vchart | 2.1.7 | 2026-10 | MIT | build/index.min.js | 2369 KB |
| @unovis/ts | 1.7.1 | 2026-10 | Apache-2.0 | none (ESM only) | — |
| vizzu | 0.18.0 | 2026-04 | Apache-2.0 | dist/vizzu.min.js + **cvizzu.wasm** | 60 KB + wasm |
| lightweight-charts | 5.2.1 | 2026-08 | Apache-2.0 (+ TradingView attribution notice/link requirement) | dist/lightweight-charts.standalone.production.js | 193 KB |
| klinecharts | 10.0.4 | 2026-10-12 | Apache-2.0 | dist/umd/klinecharts.min.js | 231 KB |
| d3fc | 15.2.13 | 2024-07 | MIT | build/d3fc.min.js | 158 KB |
| crossfilter2 / dc | 1.5.4 / 4.2.7 | 2022 / 2024 | Apache-2.0 | crossfilter.min.js / dist/dc.min.js | 14 / 139 KB |
| d3-svg-annotation / d3-svg-legend / d3-sankey / venn.js | 2.5.1 / 2.25.6 / 0.12.3 / 0.2.20 | 2022 | Apache-2.0 / Apache-2.0 / BSD-3 / MIT | | |
| leaflet | 1.9.4 (latest); 2.0.0-alpha.1 | 2023-05 / 2025-08 | BSD-2 | dist/leaflet.js | 144 KB |
| leaflet.markercluster | 1.5.3 | 2021-10 | MIT | dist/leaflet.markercluster.js | |
| maplibre-gl | **6.14.0 (ESM-only)**; last UMD **5.24.0** | 2026-10-11 / 2026-04-23 | BSD-3 | 5.24.0: dist/maplibre-gl.js (+ csp variants) | 1032 KB |
| ol (OpenLayers) | 10.11.0 | 2026-10 | BSD-2 | dist/ol.js (full UMD build, global `ol`) | 1046 KB |
| deck.gl | 9.4.0 | 2026-09 | MIT | dist.min.js (standalone bundle, global `deck`) | 2025 KB |
| @turf/turf | 7.4.0 | 2026-08 | MIT | turf.min.js | 535 KB |
| topojson-client | 3.1.0 | 2019 | ISC | dist/topojson-client.min.js | |
| jsvectormap | 1.7.0 | 2025-05 | MIT | dist/jsvectormap.min.js | |
| tabulator-tables | 6.6.1 | 2026-09 | MIT | dist/js/tabulator.min.js | 443 KB |
| datatables.net | 3.1.4 | 2026-10 | MIT | js/dataTables.min.js | 121 KB |
| gridjs | 6.2.0 | 2024-03 | MIT | dist/gridjs.umd.js | 52 KB |
| @tanstack/table-core | 9.3.1 | 2026-10 | MIT | ESM only | |
| @tabler/core | 1.6.1 | 2026-09 | MIT | dist/js/tabler.min.js | 132 KB |
| admin-lte | 4.10.0 | 2026-10 | MIT | dist/js/adminlte.min.js | 27 KB |
| apexcharts | 8.2.0 | 2026-10-13 | **ApexCharts License (dual; ≥5.1.0)** | — | — |
| gsap | 3.15.0 | 2026-04 | **GSAP Standard "no charge" license (non-OSI)** | dist/gsap.min.js | |
| animejs | 4.5.0 | 2026-06 | MIT | dist/bundles/anime.umd.min.js | 115 KB |
| @perspective-dev/viewer | 5.6.0 | 2026-10-14 | Apache-2.0 | dist/cdn/perspective-viewer.js + wasm | |
| flint-chart | 0.5.1 | 2026-08 | MIT | ESM only | |
| @antv/infographic | 0.2.20 | 2026-08 | MIT | dist/infographic.min.js | 857 KB |
| @antv/gpt-vis | 1.0.2 | 2026-09 | MIT | dist/umd/index.min.js | |
| @luxalgo/vela | 0.8.4 | 2026-10-13 | Apache-2.0 | dist/vela.global.min.js | 1019 KB |
| ag-charts-community | 14.2.0 | 2026-09 | MIT | dist/umd/ag-charts-community.min.js | 1378 KB |
| charts.css | 1.2.0 | 2025-07 | MIT | dist/charts.min.css (CSS only) | |
| PyPI: pyecharts / folium / altair | 2.1.0 / 0.20.0 / 6.3.0 | | MIT / MIT / BSD-3 | (Python side) | |

---

## 9. 关键坑 Gotchas

1. **List badges/claims go stale** — chartjs/awesome marks `chartjs-chart-financial` unsupported on v4, but npm 0.2.1 peers `chart.js ^4.0.0`. Always verify via `npm view <pkg> peerDependencies`.
2. **ApexCharts license flip** at 5.1.0 (2025-07-09). awesome-dataviz, awesome-vue (`vue-apexcharts`), Tabler and many admin templates still present it as free/MIT. Tabler pins `apexcharts 7.0.0` in devDependencies and 23 preview pages.
3. **MapLibre 6 = ESM-only**; any list recommending "MapLibre via `<script>`" refers to ≤5.x. Pin 5.24.0 if we want vector maps under file://. (Also: vector maps need glyph/sprite/tile files → offline basemap packaging is non-trivial; Leaflet + local GeoJSON is the pragmatic default.)
4. **Leaflet 2.0 alpha** — no plugin compatibility (0/578 flagged). Pin 1.9.4.
5. **D3 example code versions**: D3 Graph Gallery = v4/v6; FT visual-vocabulary = v4; awesome-d3 plugins frequently target d3 v3/v4. Budget porting time to v7.
6. **FT `chartTypes.csv` uses CR line endings**; FT branding excluded from MIT.
7. **Copyrighted catalogs** (datavizcatalogue.com, datavizproject.com) — no license; don't scrape thumbnails/text into our gallery.
8. **awesome-dataviz is CC BY 4.0** — attribution needed if we embed its descriptions; CC0 lists (awesome-d3, awesome-echarts, awesome-geojson, awesome-react-components, awesome-vector-tiles) need none.
9. **Dead links**: bl.ocks.org (all profiles in awesome-d3), makeapie.com (ECharts community gallery), TechanJS, many jQuery-era libs in awesome-javascript.
10. **CDN-default templates**: AdminLTE and Tabler demo HTML loads from cdn.jsdelivr.net → vendor everything for offline delivery.
11. **WASM / ESM-only libs** found in the lists (Perspective, Vizzu, Mosaic, DuckDB-WASM, Unovis, Flint, ChartGPU, TanStack Table core, MapLibre 6) fail or need a bundling step under file:// in Chrome. Pre-bundle ESM to IIFE with esbuild during *our* build (allowed: it's our build step, the client still gets classic scripts); WASM needs base64-inlining + `WebAssembly.instantiate(bytes)` — feasible but bloats the folder.
12. **Online-only services in lists**: Google Charts (loader fetches from gstatic), ECharts gmap/amap/bmap extensions, AntV `chart-visualization` skill & `mcp-server-chart` (cloud rendering), vega-embed "Open in Vega Editor" action → all must be disabled/avoided for confidential client data.
13. **Lightweight Charts (TradingView)** Apache-2.0 *plus* README/NOTICE condition: "You shall add the attribution notice from the NOTICE file and a link to https://www.tradingview.com/ to the page … available to your users" (the `attributionLogo` chart option satisfies the link part). NOTICE is in the GitHub repo, **not in the npm tarball** → vendor it manually. Flag as non-standard requirement for client decks.
14. **Recharts-based galleries** (shadcn, Tremor) are React-only; copying their look requires re-implementing in ECharts/Chart.js theme + CSS.
15. **Repo renames**: awesome-dataviz (fasouto → javierluraschi → hal9ai, all redirect), awesome-charts vs **awesome-charting** (ZingChart), Perspective (finos → perspective-dev; npm `@finos/perspective` frozen at 3.8.0), Tremor (`tremor-npm` frozen; `tremor` = Raw).

---

## 10. 具体建议 Concrete recommendations for the report kit

**R1 — Gallery taxonomy (catalog.json).** Build our component gallery around a machine-readable catalog:
```
{ "id": "waterfall", "ftCategory": ["Part-to-whole","Flow"], "dataShape": "OneCatOneNum (signed)",
  "encodings": {"x":"category","y":"delta","color":"sign"}, "engines": {"echarts": "bar-waterfall", "chartjs": "floating-bar"},
  "refs": {"echartsExample": "bar-waterfall", "vegaLiteExample": "waterfall_chart", "plotly": "/javascript/waterfall-charts/"} }
```
Primary axis = FT's 9 categories (Deviation, Correlation, Change over Time, Ranking, Distribution, Part-to-whole, Magnitude, Spatial, Flow); secondary filter = data-to-viz data shapes; extra finance types from Data Viz Catalogue (OHLC/candlestick, Kagi, Point&Figure, Marimekko, span, bullet, fan). This JSON also becomes the "tool manifest" the Step-2 LLM reads to pick charts.

**R2 — Reference implementations.** For each catalog id, link the nearest ECharts example id (auto-joinable from `chart-list-data.js`), then Vega-Lite and Plotly gallery pages. ECharts examples are Apache-2.0, so adapting code is permitted (keep NOTICE).

**R3 — Pin versions surfaced as traps:** Leaflet 1.9.4 (+ markercluster 1.5.3, leaflet-dataclassification, DonutCluster vendored from repos), MapLibre 5.24.0 only if vector maps are needed, ApexCharts excluded, GSAP flagged (prefer anime.js 4.5.0 MIT or CSS/WAAPI), Lightweight Charts flagged for attribution.

**R4 — Plugin catalogs to watch** (cheap to re-scan): Leaflet `_plugins` frontmatter (re-run count of `compatible-v2`), chartjs/awesome table (re-verify peerDeps), awesome-dataviz Financial/Maps/Misc sections (diff monthly), ECharts `chart-list-data.js` `since` field (new features).

**R5 — Design references, not dependencies:** shadcn charts (tooltip/legend polish, CSS-variable palettes), Tremor Raw (BarList/CategoryBar/Tracker/SparkChart KPI primitives), Tabler/AdminLTE (layout grid, cards, dark mode, icons). Implement equivalents in vanilla JS + ECharts/Chart.js.

**R6 — Step-2 (LLM/skills):** study Flint's channel vocabulary (`x,y,color,size,shape,radius,latitude,longitude,open/high/low/close…`) for our own JSON chart spec so a local LLM can emit specs; study AntV's `SKILL.md` layout for packaging "skills"; never use cloud-rendering skills/MCP servers on client data.

**R7 — Python builder parallels:** pyecharts (option JSON), altair (Vega-Lite JSON), folium (Leaflet HTML) — all prove the "Python emits spec JSON, JS renders" split; folium injects CDN `<script>` links by default, i.e. our builder must own asset URLs (vendor/ paths) rather than delegating HTML generation to these libraries.

---

## 11. Sources

- awesome-dataviz: https://github.com/hal9ai/awesome-dataviz (raw: https://raw.githubusercontent.com/javierluraschi/awesome-dataviz/master/README.md), https://awesomedataviz.com
- awesome-d3: https://github.com/wbkd/awesome-d3
- awesome-echarts: https://github.com/ecomfe/awesome-echarts
- Leaflet plugins: https://leafletjs.com/plugins · https://github.com/Leaflet/Leaflet/tree/main/docs/_plugins
- chartjs/awesome: https://github.com/chartjs/awesome
- awesome-geojson: https://github.com/tmcw/awesome-geojson
- awesome-vector-tiles: https://github.com/mapbox/awesome-vector-tiles
- awesome-maplibre: https://github.com/maplibre/awesome-maplibre
- awesome-javascript: https://github.com/sorrycc/awesome-javascript
- awesome-react-components: https://github.com/brillout/awesome-react-components
- awesome-vue: https://github.com/vuejs/awesome-vue
- awesome-charting: https://github.com/zingchart/awesome-charting
- awesome-maps: https://github.com/simsieg/awesome-maps
- FT: https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary · https://github.com/ft-interactive/visual-vocabulary
- data-to-viz: https://www.data-to-viz.com · https://github.com/holtzy/data_to_viz
- D3 Graph Gallery: https://d3-graph-gallery.com · https://github.com/holtzy/D3-graph-gallery
- Observable D3 gallery: https://observablehq.com/collection/@d3/gallery
- ECharts examples: https://echarts.apache.org/examples · https://github.com/apache/echarts-examples
- Vega-Lite examples: https://vega.github.io/vega-lite/examples/ · https://github.com/vega/vega-lite/blob/main/site/_data/examples.json
- Plotly JS gallery: https://plotly.com/javascript/
- Data Viz Catalogue: https://datavizcatalogue.com · Data Viz Project: https://datavizproject.com
- shadcn charts: https://ui.shadcn.com/charts · https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/charts
- Tremor: https://tremor.so · https://vercel.com/blog/vercel-acquires-tremor · https://github.com/tremorlabs/tremor · https://github.com/tremorlabs/tremor-blocks
- Tabler: https://github.com/tabler/tabler · AdminLTE: https://github.com/ColorlibHQ/AdminLTE
- ApexCharts license: https://cdn.jsdelivr.net/npm/apexcharts@8.2.0/LICENSE.md · https://apexcharts.com/pricing
- Flint: https://github.com/microsoft/flint-chart · https://www.microsoft.com/research/blog/flint-a-visualization-language-for-the-ai-era/
- AntV: https://github.com/antvis/Infographic · https://github.com/antvis/GPT-Vis · https://github.com/antvis/chart-visualization-skills · https://github.com/antvis/mcp-server-chart
- npm registry (`npm view`), jsDelivr data API (https://data.jsdelivr.com/v1/package/npm/<pkg>@<ver>/flat), shields.io star badges.

---

## Appendix A — FT Visual Vocabulary full list (from `chartTypes.csv`, 72 rows)

| # | chartName | FT category | D3 template in repo (`avail`) | FT one-line guidance (abridged) |
|---|---|---|---|---|
| 1 | bar-diverging | Deviation | TRUE | A simple standard bar chart that can handle both negative and positive magnitude values |
| 2 | bar-diverging-stacked | Deviation | TRUE | Perfect for presenting survey results which involve sentiment (eg disagree, neutral, agreed |
| 3 | spine-chart | Deviation | TRUE | Splits a single value into 2 contrasting components (eg Male/Female) |
| 4 | line-surplus-deficit-filled | Deviation | FALSE | The shaded area of these charts allows a balance to be shown;  either against a baseline or between two serie |
| 5 | scatterplot | Correlation | TRUE | The standard way to show the relationship between two variables, each of which has its own axis |
| 6 | line-column | Correlation | TRUE | A good way of showing the relationship between an amount (columns) and a rate (line) |
| 7 | scatterplot-connected | Correlation | TRUE | Usually used to show how the relationship between 2 variables has changed over time |
| 8 | Bubble | Correlation | TRUE | Like a scatterplot, but adds additional detail by sizing the circles according to a third variable |
| 9 | XY-heatmap | Correlation | TRUE | A good way of showing the patterns between 2 categories of data, less good at showing fine differences in a... |
| 10 | line | Change v Time | TRUE | The standard way to show a changing time series. If data are irregular, consider markers to represent data ... |
| 11 | column-timeline | Change v Time | TRUE | Columns work well for showing change over time - but usually best with only one series of data at a time |
| 12 | column-line-timeline | Change v Time | TRUE | A good way of showing the relationship over time between an amount (columns) and a rate (line) |
| 13 | stock-price | Change v Time | FALSE | Usually focused on day-to-day activity, these charts show opening/closing and hi/low points of each day |
| 14 | slope | Change v Time | TRUE | Good for showing changing data as long as the data can be simplified into 2 or 3 points without missing a k... |
| 15 | area | Change v Time | TRUE | Use with care. These are good at showing changes to total, but seeing change in components can be very diff... |
| 16 | fan | Change v Time | FALSE | Use to show the uncertainty in future projections - usually this grows the further forward to projection |
| 17 | scatterplot-line-timeline | Change v Time | FALSE | A good way of showing changing data for two variables whenever there is a relatively clear pattern of progr... |
| 18 | calendar-heatmap | Change v Time | TRUE | A great way of showing temporal patterns (daily, weekly, monthly), at the expense of showing precision in q... |
| 19 | priestley timeline | Change v Time | TRUE | Great when date and duration are key elements of the story in the data |
| 20 | circles-timeline | Change v Time | TRUE | Good for showing discrete values of varying size across multiple categories (eg earthquakes by contintent) |
| 21 | seismogram | Change v Time | FALSE | Another alternative to the circle timeline for showing series where there are big variations in the data |
| 22 | bar-ordered | Ranking | TRUE | Standard bar charts display the ranks of values much more easily when sorted into order |
| 23 | column-ordered | Ranking | TRUE | Standard column charts display the ranks of values much more easily when sorted into order |
| 24 | symbol-proportional-ordered | Ranking | FALSE | Use when there are big variations between values and/or seeing fine differences between data is not so impo... |
| 25 | dot-plot-strip | Ranking | FALSE | Dots placed in order on a strip are a space-efficient method of laying out ranks across multiple categories. |
| 26 | slope | Ranking | TRUE | Perfect for showing how ranks have changed over time or vary between categories. |
| 27 | lollipop-h | Ranking | TRUE | Lollipop charts draw more attention to the data value than standard bar/column and can also show rank effec... |
| 28 | lollipop-v | Ranking | TRUE | Lollipop charts draw more attention to the data value than standard bar/column and can also show rank effec... |
| 29 | bump | Ranking | TRUE |  |
| 30 | histogram | Distribution | TRUE | The standard way to show a statistical distribution - keep the gaps between columns small to highlight the ... |
| 31 | boxplot | Distribution | TRUE | Summarise multiple distributions by showing the median (centre) and range of the data |
| 32 | violin | Distribution | FALSE | Similar to a box plot but more effective with complex distributions (data that cannot be summarised with si... |
| 33 | population-pyramis | Distribution | TRUE | A standard way for showing the age and sex breakdown of a population distribution; effectively, back to bac... |
| 34 | dot-plot-strip | Distribution | FALSE | Good for showing individual values in a distribution, can be a problem when too many dots have the same value |
| 35 | dot-plot | Distribution | TRUE | A simple way of showing the range (min/max) of data across multiple categories. |
| 36 | barcode | Distribution | FALSE | Like dot strip plots, good for displaying all the data in a table,they work best when highlighting individu... |
| 37 | cumulative-curve | Distribution | FALSE | A good way of showing how unequal a distribution is: y axis is always cumulative frequency, x axis is alway... |
| 38 | column-stacked | Part to whole | TRUE | A simple way of showing part-to-whole relationships but can be difficult to read with more than a few compo... |
| 39 | bar-stacked-proportional | Part to whole | TRUE | A good way of showing the size and proportion of data at the same time, as long as the data are not too com... |
| 40 | pie | Part to whole | TRUE | A common way of showing part-to-whole data - but be aware that it's difficult to accurately compare the siz... |
| 41 | doughnut | Part to whole | TRUE | Similar to a pie chart - but the centre can be a good way of making space to include more information about... |
| 42 | treemap | Part to whole | TRUE | Use for hierarchical part-to-whole relationships; can be difficult to read when there are many small segments |
| 43 | Voronoi | Part to whole | FALSE | A way of turning points into areas - any point within the area is closer to the central point than any othe... |
| 44 | sunburst | Part to whole | FALSE | Another way of visualisaing hierarchical part-to-whole relationships. Use sparingly (if at all) for obvious... |
| 45 | arc | Part to whole | FALSE | A hemicycle, often used for visualising political results. |
| 46 | gridplot | Part to whole | FALSE | Good for showing % information, they work best when used on whole numbers and work well in multiple layout ... |
| 47 | Venn | Part to whole | FALSE | Generally only used for schematic representation |
| 48 | Waterfall | Part to whole | TRUE | Can be useful for showing part-to-whole relationships where some of the components are negative. |
| 49 | Column | Magnitude | TRUE | The standard way to compare the size of things. Must always start at 0 on the axis |
| 50 | Bar | Magnitude | TRUE | The standard way to compare the size of things. Must always start at 0 on the axis. Good when the data are ... |
| 51 | column-grouped | Magnitude | TRUE | As per standard column but allows for multiple series. Can become tricky to read with more than 2 series |
| 52 | bar-grouped | Magnitude | TRUE | As per standard bar but allows for multiple series. Can become tricky to read with more than 2 series |
| 53 | bar-stacked-proportional | Magnitude | TRUE | A good way of showing the size and proportion of data at the same time - as long as the data are not too co... |
| 54 | symbol-proportional | Magnitude | FALSE | Use when there are big variations between values and/or seeing fne differences between data is not so impor... |
| 55 | isotope (pictogram) | Magnitude | FALSE | Excellent solution in some instances - use only with whole numbers (do not slice off an arm to represent a ... |
| 56 | lollipop-h | Magnitude | TRUE | Lollipop charts draw more attention to the data value than standard bar/column and can also show rank effec... |
| 57 | lollipop-v | Magnitude | TRUE | Lollipop charts draw more attention to the data value than standard bar/column and can also show rank effec... |
| 58 | Radar | Magnitude | FALSE | A space-efficient way of showing value pf multiple variables -  but make sure they are organised in a way t... |
| 59 | Bullet | Magnitude | TRUE |  |
| 60 | Parallel coordinates | Magnitude | FALSE | An alternative to radar charts - again, the arrngement of the variables is important. Usually benefits from... |
| 61 | basic-choropleth | Spatial | FALSE | The standard approach for putting data on a map - should always be rates rather than totals and use a sensi... |
| 62 | proportional-symbol | Spatial | FALSE | Use for totals rather than rates  - be wary that small differences in data will be hard to see. |
| 63 | flow | Spatial | FALSE | For showing unambiguous movement across a map |
| 64 | contour | Spatial | FALSE | For showing areas of equal value on a map. Can use deviation colour schemes for showing +/- values |
| 65 | equalised-cartogram | Spatial | FALSE | Converting each unit on a map to a regular and equally-sized shape - good for representing voting regions w... |
| 66 | scaled-cartogram-value | Spatial | FALSE | Stretching and shrinking a map so that each area is sized according to a particular value. |
| 67 | dot-density | Spatial | FALSE | Used to show the location of individual events/locations - make sure to annotate any patterns the reader sh... |
| 68 | heat-map | Spatial | FALSE | Grid-based data values mapped with an intensity colour scale. As choropleth map - but not snapped to an adm... |
| 69 | sankey | Flow | TRUE | Shows changes in flows from one condition to at least one other; good for tracing the eventual outcome of a... |
| 70 | waterfall | Flow | TRUE | Designed to show the sequencing of data through a flow process, typically budgets. Can include +/- components |
| 71 | chord | Flow | FALSE | A complex but powerful diagram which can illustrate 2-way flows (and net winner) in a matrix |
| 72 | network | Flow | FALSE | Used for showing the complexity and inter-connectdness of relationships of varying types. |

## Appendix B — ECharts example ids most relevant to a pitchbook kit (from `chart-list-data.js`)

| id | title | categories | since |
|---|---|---|---|
| calendar-simple | Simple Calendar | calendar |  |
| candlestick-simple | Basic Candlestick | candlestick |  |
| bar-waterfall | Waterfall Chart | bar |  |
| calendar-heatmap | Calendar Heatmap | calendar, heatmap |  |
| calendar-vertical | Calendar Heatmap Vertical | calendar, heatmap |  |
| custom-ohlc | OHLC Chart | candlestick |  |
| matrix-simple | Simple Matrix | matrix | 6.0.0 |
| calendar-horizontal | Calendar Heatmap Horizontal | calendar |  |
| candlestick-sh | ShangHai Index | candlestick |  |
| custom-error-scatter | Error Scatter on Catesian | custom, dataZoom |  |
| matrix-correlation-heatmap | Correlation Matrix (Heatmap) | matrix | 6.0.0 |
| matrix-correlation-scatter | Correlation Matrix (Scatter) | matrix | 6.0.0 |
| matrix-covariance | Covariance Matrix | matrix | 6.0.0 |
| matrix-graph | Graph Chart in Matrix | matrix | 6.0.0 |
| matrix-pie | Pie Charts in Matrix | matrix | 6.0.0 |
| bar-breaks-simple | Bar Chart with Axis Breaks | bar | 6.0.0 |
| bar-waterfall2 | Waterfall Chart | bar |  |
| candlestick-large | Large Scale Candlestick | candlestick |  |
| matrix-confusion | Confusion Matrix | matrix | 6.0.0 |
| matrix-grid-layout | Responsive grid layout based on matrix | matrix | 6.0.0 |
| matrix-stock | Matrix Stock Application | matrix, candlestick | 6.0.0 |
| area-simple | Large scale area chart | line, dataZoom |  |
| calendar-graph | Calendar Graph | calendar, graph |  |
| calendar-lunar | Calendar Lunar | calendar |  |
| candlestick-touch | Axis Pointer Link and Touch | candlestick |  |
| custom-gantt-flight | Gantt Chart of Airport Flights | custom, dataZoom |  |
| intraday-breaks-1 | Intraday Chart with Breaks | candlestick, line | 6.0.0 |
| intraday-breaks-2 | Intraday Chart with Breaks (II) | candlestick, line | 6.0.0 |
| matrix-sparkline | Mini Line Charts (Sparkline) in Matrix | matrix, line | 6.0.0 |
| wind-barb | Wind Barb | custom, dataZoom |  |
| calendar-pie | Calendar Pie | calendar, pie |  |
| matrix-mini-bar-geo | Mini Bars and Geo in Matrix | matrix, bar, geo | 6.0.0 |
| custom-calendar-icon | Custom Calendar Icon | custom, calendar |  |
| bar-breaks-brush | Bar Chart with Axis Breaks (Brush-enabled) | bar | 6.0.0 |
| candlestick-brush | Candlestick Brush | candlestick |  |
| candlestick-sh-2015 | ShangHai Index, 2015 | candlestick |  |
| line-tooltip-touch | Tooltip and DataZoom on Mobile | line, dataZoom |  |
| matrix-periodic-table | Periodic Table | matrix | 6.0.0 |
| calendar-charts | Calendar Charts | calendar, scatter |  |
| matrix-mbti | MBTI Partner Compatibility | matrix | 6.0.0 |
| matrix-mini-bar-data-collection | Matrix Header Data Collection (Mini Bar) | matrix | 6.0.0 |
