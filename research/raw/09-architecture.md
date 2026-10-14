# 09 · 报告打包与数据分离架构先例 (Report packaging & data-separation architecture)

> Research date: 2026-10-14 · Angle: `09-architecture`
> Scope: precedents for static, data-separated, code-generated reports; the precise `file://` constraints and how to work around them; a recommended report folder layout, data contract, layout/spec + bindings, versioning, and print-to-PDF practice for landscape pitchbook pages.
>
> **How the facts were checked**
> - Versions and licenses: `npm view … version license time` (npm registry), PyPI JSON API (`https://pypi.org/pypi/<pkg>/json`), jsDelivr file listings (`data.jsdelivr.com/v1/package/npm/<pkg>@<ver>/flat`), GitHub stars and activity via `repos.ecosyste.ms` (the GitHub API is not reachable from this sandbox), and browser support via `@mdn/browser-compat-data` 8.1.5 (2026-10-08).
> - **Empirical browser tests (the important part):** Playwright 1.64 with **Chromium 156.0.8078.4** (both headless-shell and "new headless" channel) and **Firefox 157.0**. Test fixtures are in the scratchpad, not the repo. Playwright's Firefox build ships `security.fileuri.strict_origin_policy=false` in `playwright.cfg`, which loosens `file://` rules, so every Firefox result below was re-run with the **stock value `true`**. Without that re-run, Firefox would wrongly appear to allow fetch, modules and workers.

---

## 0. 结论速览 (TL;DR)

1. **`file://` is a hard wall for `fetch`/XHR, ES modules (static *and* dynamic `import()`), file-based Web Workers, Service Workers, iframe DOM access, CSSOM `cssRules` of linked sheets, and canvas export after drawing a local `<img>`.** This holds in both Chromium 156 and stock Firefox 157, as measured here. **Classic `<script src>` (static or injected at runtime), linked CSS, `@font-face` fonts from a subfolder, `localStorage`/IndexedDB, `crypto.subtle`, Blob-URL and `data:` workers, inline WASM bytes and `data:`/`blob:` fetches all work.** `isSecureContext === true` and `origin === "null"`.
2. Therefore the **data transport must be "JSONP-style" classic scripts.** Each dataset is emitted twice: `data/<id>.json` (canonical, for HTTP and the future API) and `data/<id>.js`, which contains `RK.data.register("<id>", JSON.parse("…"))`. The `JSON.parse("…")` string form loaded **2.8× faster** than an object literal in Chromium for a 9.3 MB dataset (133 ms vs 372 ms) and 1.9× faster in Firefox, which matches V8's "≥10 kB → JSON.parse" guidance. Columnar orientation is about 38% smaller on disk and 26% smaller gzipped than records.
3. **Precedents converge on one model: build-time loaders → static snapshot files → declarative spec → thin runtime.** Examples are Observable Framework data loaders, Evidence's SQL→parquet step, Plotly's `{data, layout, config}` with `include_plotlyjs='directory'`, Vega-Lite named `datasets`, Panel `embed`, and Quarto `embed-resources`. **None of them works from `file://` with separate data files except by inlining.** Panel's docs say outright that exported JSON states need HTTP because "Browsers block access to local files". Our dual `.json` + `.js` emission is the missing piece.
4. **Data contract: align with Frictionless Table Schema v2 (2024-06-26).** pandas `to_json(orient="table")` already emits a v1-compatible subset. On top of that, add the finance semantics no standard has: `unit` (currency/scale/kind), `format` (Excel-style codes, which the kit already supports), `role` (dimension/measure/key/label/geo), `aggregate`, labelled `missingValues` ("NM" vs "NA"), cell-level `flags` → footnotes, plus `meta.source[]`, `footnotes[]`, `asOf`, `lineage`, `hash`. Keep `orient: records | columns | rows`.
5. **Spec: separate *elements* from *layout*** (Grafana schema v2 pattern). Use **Vega-Lite encoding vocabulary** for bindings (`x, y, color, size, shape, opacity, theta, radius, latitude, longitude, geoId, detail, label, tooltip`; Graphic Walker uses the same set). Use **Mosaic-style selections with `crossfilter` resolution**, where a component's own selection does not filter itself. Use `$param` references for what-if inputs. Declare everything in JSON Schema 2020-12, generated from pydantic models in the builder.
6. **Versioning:** `$schema` URL + `specVersion` and a migration chain (Vega-Lite `$schema`, Grafana `schemaVersion`, Graphic Walker `IChart.$schema` + `migrate()`). Datasets carry `contract`, `version` (pipeline run), and a content `hash`. The manifest carries `revision` (client re-issue counter), generator and kit versions, and checksums. Each report is an immutable artifact with its own vendored libs.
7. **Print:** design pages as **fixed 1280×720 CSS px "slides" = 13.333 in × 7.5 in = PowerPoint 16:9**, with `@page { size: 13.333in 7.5in; margin: 0 }`. This produced exact 960×540 pt PDF pages in Chromium. Charts then need **no print-time resize**. **Use the ECharts SVG renderer for print:** canvas charts became 560×360 *bitmaps* in the PDF, while SVG charts stayed vector with selectable text. `beforeprint` and `matchMedia('print')` *do* fire during headless `page.pdf()`. Page margin boxes (`@bottom-right { content: counter(page) }`) work in Chrome/Edge 131+ only (not Firefox or Safari per BCD), so render footers and page numbers in the DOM per slide. On screen, scale slides with **`transform: scale()`**; ECharts and Leaflet hit-testing was correct. Do **not** use CSS `zoom`, which made ECharts hover the wrong bar in both browsers.
8. **Avoid as runtime deps under `file://`:** Perspective (ESM + `import.meta.url` + WASM fetch), DuckDB-WASM (worker + WASM fetch), Graphic Walker (UMD needs React ≥19 globals, and React 19 ships no UMD), Paged.js (XHRs linked stylesheets, which fails on `file://`; it does work with inline `<style>`), Observable Framework/Notebook Kit and Evidence output (ES modules + fetch), Vivliostyle (AGPL), Metabase (AGPL), and Datapane (unmaintained since 0.17.0, 2023-09).

---

## 1. `file://` 约束：实测矩阵 (Empirical capability matrix)

Fixture: `report/index.html` with `css/`, `js/`, `data/`, `fonts/` and `assets/` subfolders. Every resource is in the same folder tree.

| Capability (from `index.html` opened via `file://`) | Chromium 156 | Firefox 157 (stock `strict_origin_policy=true`) | Firefox 157 (Playwright default, relaxed) | Notes / exact error |
|---|---|---|---|---|
| `self.origin` / `isSecureContext` | `null` / **true** | `null` / **true** | same | file pages are secure contexts → `crypto.subtle`, Clipboard API exist |
| Classic `<script src="data/x.js">` (static) | ✅ | ✅ | ✅ | the transport we rely on |
| Classic script **injected at runtime** (`createElement('script')`) | ✅ | ✅ | ✅ | `document.currentScript` is set → lazy-loading per page works |
| `fetch('data/x.json')` | ❌ | ❌ | ✅ | Chrome: `Fetch API cannot load file:///…/x.json. URL scheme "file" is not supported.` / `Access to fetch at 'file://…' from origin 'null' has been blocked by CORS policy` (new headless); FF: `NetworkError when attempting to fetch resource` |
| `XMLHttpRequest` to local JSON | ❌ | ❌ | ✅ | `Access to XMLHttpRequest at 'file://…' from origin 'null' has been blocked by CORS policy` |
| `<script type="module" src>` | ❌ (not executed) | ❌ | ✅ | Chrome: `Access to script at 'file:///…/m.js' from origin 'null' has been blocked by CORS policy`; FF: `Module source URI is not allowed in this document` |
| Inline `<script type="module">…</script>` | ✅ | ✅ | ✅ | no fetch involved, but it cannot `import` local files |
| Dynamic `import('./js/m.js')` | ❌ | ❌ | ✅ | `Failed to fetch dynamically imported module` |
| `new Worker('js/w.js')` | ❌ | ❌ | ✅ | Chrome: `SecurityError: Failed to construct 'Worker': Script at 'file:///…' cannot be accessed from origin 'null'` |
| Worker from **Blob URL** (`blob:null/…`) | ✅ | ✅ | ✅ | workaround: ship worker code as a string inside a classic script |
| Worker from `data:` URL | ✅ | ✅ | ✅ | |
| Service Worker | ❌ | ❌ | ❌ | `The URL protocol of the current origin ('null') is not supported` → no offline cache/PWA tricks |
| `fetch('data:…')` / `fetch(blob:)` | ✅ / ✅ | ✅ / ✅ | ✅ | so base64-embedded binary (Arrow IPC, WASM) can be "fetched" |
| `WebAssembly.instantiate(bytes)` (inline bytes) | ✅ | ✅ | ✅ | `instantiateStreaming(fetch('x.wasm'))` fails (fetch) |
| `@font-face url("../fonts/x.ttf")` from `css/` | ✅ loaded | ✅ loaded | ✅ | fonts in the report subtree are OK; inline base64 `@font-face` is the belt-and-braces option |
| `document.styleSheets[0].cssRules` (linked CSS) | ❌ SecurityError | ❌ SecurityError | ✅ | breaks libs that read CSSOM (Paged.js, some DOM-to-image exporters). `getComputedStyle()` (CSS variables) still works |
| Draw local `<img src="assets/x.png">` on canvas → `toDataURL()` | ❌ tainted | ❌ "The operation is insecure" | ✅ | `crossOrigin="anonymous"` makes the image **fail to load** entirely |
| Same, but image is a `data:` URI | ✅ | ✅ | ✅ | → embed logos/images as data URIs if charts must export PNG |
| ECharts `getDataURL()` (pure vector canvas) | ✅ | n/t | n/t | ECharts 6.1.0 |
| ECharts `getDataURL()` with `symbol: 'image://red.png'` | ❌ `Tainted canvases may not be exported` | n/t | n/t | **gotcha for "Export chart as PNG"** |
| ECharts SVG renderer `renderToSVGString()` | ✅ | n/t | n/t | vector export always works |
| `<iframe src="page2.html">` → `contentDocument` | ❌ null | ❌ null | ✅ | multi-page reports must not rely on iframe DOM access; use one `index.html` + hash routing |
| `history.pushState(…, '#p2')` / `?q=1` | ✅ | ✅ | ✅ | hash routing (`#/page/3`) is safest and survives reload |
| `localStorage` / IndexedDB | ✅ / ✅ | ✅ / ✅ | ✅ | Chrome shares one storage bucket across *all* `file://` pages → namespace keys by `report.id + revision` |
| `SharedArrayBuffer` | undefined | undefined | undefined | not cross-origin isolated → no multi-threaded WASM (DuckDB-WASM MT, Perspective MT) |

**Implications (all verified above):**
- No `fetch`, no ES modules, no workers from files. The runtime must be classic scripts (UMD/IIFE) and data must be JS files. For CPU-heavy work, create workers from Blob URLs built from code shipped in a classic script.
- "Export PNG" must avoid bitmap images from disk: use `data:` URIs or SVG export.
- Never depend on CSSOM rule access or iframes.
- `--allow-file-access-from-files` (Chrome flag) and `security.fileuri.strict_origin_policy=false` (Firefox pref) exist, but clients will not have them set. **Design for stock browsers.**
- MDN background: "Many browsers, including Firefox and Chrome, now treat all local files as having opaque origins (by default)… loading a local file with included local resources will now result in CORS errors" (CVE-2019-11730 drove Firefox's change). https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHTTP

### 1.1 数据脚本解析性能 (data-as-JS parse benchmark)

Synthetic dataset: 40,000 rows × 15 fields (ticker, region, ISO date, 12 floats). Each file was loaded via injected `<script>` from `file://`, median of 5 runs.

| File form | Size | Chromium 156 | Firefox 157 |
|---|---|---|---|
| records, JS object literal `RK_REG({...})` | 9.34 MB | 372 ms | 411 ms |
| records, `RK_REG(JSON.parse("…"))` | 10.78 MB | **133 ms** | **220 ms** |
| columns, JS literal | 5.78 MB | 110 ms | 177 ms |
| columns, `JSON.parse("…")` | 6.02 MB | **79 ms** | **160 ms** |

gzip size (relevant to the API/HTTP mode): records 3.08 MB, columns 2.28 MB.

→ **Recommendation:** for any payload over about 10 kB, emit `JSON.parse(<python json.dumps(json_text)>)`. V8 says "A good rule of thumb is to apply this technique for objects of 10 kB or larger… the JSON.parse approach is much faster compared to the JavaScript object literal, especially for cold loads" (https://v8.dev/blog/cost-of-javascript-2019). Offer `orient: "columns"` for wide or large tables, converted to row views lazily in JS, and `orient: "records"` (the default) for small, human-readable datasets.

### 1.2 Python 序列化陷阱 (builder-side serialization gotchas)

- `json.dumps(float('nan'))` → `NaN`, which is **invalid JSON**. `JSON.parse` throws on it, but a JS object literal accepts it, so the bug hides until the format switches. Map NaN/±Inf → `null` (plus a flag such as `NM`) and dump with `allow_nan=False` to fail fast.
- pandas 3.0.5 (tested): `to_json()` without `date_format` raises `Pandas4Warning: The default 'epoch' date format is deprecated` and emits epoch ms. Always pass `date_format="iso"`.
- `orient="table"` emits `"asof":"2026-10-10T00:00:00.000"` (no `Z`). In JS, `new Date("2026-10-10")` is **UTC midnight** but `new Date("2026-10-10T00:00:00.000")` is **local midnight**, so a date-only value can display as the previous day in the Americas. **Contract rule:** `type:"date"` values are `YYYY-MM-DD` strings. Parse them manually to Y/M/D (no `Date` timezone conversion). Use `datetime` only with an explicit offset or `Z`.
- `orient="table"` details seen in pandas 3.0.5: `"pandas_version":"1.4.0"` is the *table-schema version*, not the pandas version. Categoricals become `"type":"any","constraints":{"enum":[…]},"ordered":false`. Strings get `"extDtype":"str"`. The index becomes `primaryKey`.
- int64 identifiers > 2^53 must be strings. Decimals become floats, rounded at the source to about 6–8 significant digits to shrink files and avoid `0.30000000000000004` artefacts in tooltips.
- `ensure_ascii=True` (default) escapes U+2028/2029 and non-ASCII. That is safe for both JS string literals and `<script>` inlining. In single-file mode, also escape `<` as `<` to prevent `</script>` breakout.
- Deterministic output: keep field order, use `separators=(",",":")` and no timestamps inside the data body. Then the content `hash` is stable across rebuilds with identical data.

---

## 2. 先例逐个分析 (Precedents)

### 2.1 Summary table

| Precedent | What it is | License | Latest (verified) | Output / runtime model | Opens from `file://`? | What to borrow |
|---|---|---|---|---|---|---|
| **Observable Framework** | static-site generator for data apps | ISC | `@observablehq/framework` 1.13.4 (2026-03-02); 3.7k★ | data loaders (`x.json.py` → stdout) at build → `_file/` static snapshots; pages use ES modules + `FileAttachment` (fetch) | ❌ needs HTTP | loader naming convention, stdout contract, cache, "fail build on loader error", static-analysis of referenced files |
| Observable Notebook Kit | Notebooks 2.0 toolchain | ISC | `@observablehq/notebook-kit` 2.7.1 (2026-10) | notebook HTML files → static site | ❌ (ESM) | signal: Observable's energy moved here; Framework in maintenance (deploy deprecated) |
| **Evidence** | SQL + Markdown BI-as-code | MIT | classic `@evidence-dev/evidence` 40.1.8 (2026-02-06); 7.0k★ | classic: sources → parquet, DuckDB-WASM "universal SQL", SvelteKit static build; 2026 docs: `evidence serve` + Studio | ❌ | markdown + component props as bindings (`<BarChart data={q} x=… y=…/>`), "query results are named datasets" |
| **Quarto dashboards** | Pandoc-based publishing | MIT (CLI) | quarto-cli 1.10.19 (PyPI, 2026-10-06); 6.1k★ | pages/rows/columns/cards/value boxes/sidebars; static or Shiny-backed; `embed-resources: true` single file | ✅ only in single-file/static-widget form | layout vocabulary (cards, value boxes, sidebars, tabsets), the static-vs-server split, single-file option |
| **Vega-Lite** (+ vega, vega-embed) | declarative grammar (JSON spec) | BSD-3-Clause | vega-lite 6.5.0 (2026-10-08), vega 6.4.0, vega-embed 7.3.0; 5.5k★ | spec JSON + named data swapped at runtime (`view.insert('name', rows).run()`) | ✅ UMD builds exist (`build/vega.min.js` 175 KB gz + `vega-lite.min.js` 79 KB gz + `vega-embed.min.js` 20 KB gz) | **encoding-channel vocabulary**, top-level `datasets`, `params`/selections, `$schema` URL versioning |
| Altair + vl-convert | Python API for Vega-Lite | BSD-3-Clause | altair 6.3.0 (2026-09-15), vl-convert-python 1.9.0.post1 | `chart.save('x.html', inline=True)` inlines JS (needs vl-convert); `chart.save('x.json')` = spec only | ✅ when inline | "spec is the artifact" mindset; browserless SVG/PNG via vl-convert |
| **Perspective** | WASM pivot/grid/chart engine | Apache-2.0 | `@perspective-dev/*` 5.6.0 (2026-10-14); legacy `@finos/perspective` stopped at 3.8.0 (2025-09); 11.3k★ | ESM + `import.meta.url` + `fetch(*.wasm)` + workers; viewer config `save()`/`restore()` JSON | ❌ (verified: CDN build is ESM with `import.meta`) | serializable **view-state JSON** (group_by/split_by/columns/filter/sort/expressions/plugin); Arrow interchange |
| **Datapane** | Python → HTML reports | Apache-2.0 | 0.17.0 (2023-09-07), "no longer actively maintained" | standalone HTML files | ✅ (inlined) | cautionary tale: don't build on vendor-led report SDKs |
| **Panel / Bokeh** | Python dashboards | BSD-3-Clause | panel 1.9.4 (2026-08), bokeh/bokehjs 3.10.1 (2026-10-13); 5.8k★ / 20.5k★ | `save(resources=INLINE)`; doc JSON in `<script type="application/json">`; `embed=True` precomputes widget states (~1000 max; `max_opts` 3 per slider) | ✅ inline; ❌ when states exported as JSON files (docs: "Browsers block access to local files") | `embed` = precomputed states; JSON-in-script-tag pattern; confirms our file:// diagnosis |
| **Plotly** | charts + offline HTML | MIT | plotly.js 4.1.2 (2026-10-05), plotly.py 7.1.0 (2026-09-15), Kaleido 1.5.0; 18.4k★ | figure = `{data, layout, config, frames}`; `write_html(include_plotlyjs=True|'cdn'|'directory'|path|False)` | ✅ (`True` or `'directory'`) | **`'directory'` = shared vendor bundle next to HTML** (= our `vendor/`); clean data/layout/config split; `post_script` hook |
| Streamlit / stlite | Python app server / Pyodide port | Apache-2.0 | streamlit 1.65.0 (2026-10-02); `@stlite/browser` 1.11.0 | server (WebSocket); stlite runs Python in WASM, fetching wheels | ❌ | nothing for packaging; widget→rerun model is the anti-pattern for static reports |
| Apache Superset | BI server | Apache-2.0 | 6.1.0 (2026-05-13); embedded SDK 0.4.0; 75.1k★ | server + guest-token embedding | ❌ | chart "form data" JSON as a portable chart definition (reference only) |
| Metabase | BI server | **AGPL-3.0** (OSS) / commercial; embedding SDK "SEE LICENSE" | v0.64.1 (2026-10-07); 49.6k★ | server embedding | ❌ | avoid (license) |
| **Rill** | BI-as-code (Go + DuckDB/ClickHouse) | Apache-2.0 | v0.90.5 (2026-10-09); 2.9k★ | YAML metrics views + YAML canvas dashboards, served app | ❌ | **metrics-layer YAML**: measures with `expression` + `format_preset`/`format_d3`, `valid_percent_of_total`; canvas `rows[].items[].width` (12-col) |
| **Graphic Walker / PyGWalker** | Tableau-like drag-and-drop explorer | Apache-2.0 | `@kanaries/graphic-walker` 0.5.3 (2026-10-01), pygwalker 0.5.0.1 (2026-04); 3.3k★ / 16.0k★ | UMD 4.1 MB (1.18 MB gz) **requires React ≥19, ReactDOM, styled-components globals** | ⚠ only with React globals; React 19.3.0 ships **no UMD** (verified; 18.3.1 still had `umd/`) | `IChart.encodings` = {rows, columns, color, opacity, size, shape, theta, radius, longitude, latitude, geoId, details, filters, text}; `IChart.$schema` + `spec.migrate()` |
| **Great Tables** | Python publication tables | MIT | 1.0.0 (2026-09-25); 2.9k★ | GT object → HTML (inline CSS), LaTeX, `gtsave()` via headless Chrome; `opt_interactive()` (0.24) | ✅ (static HTML) | **table anatomy + formatter vocabulary** (see §2.4); 1.0 made HTML-escaping the default |
| **Frictionless Table Schema / Data Package v2** | open data spec | spec: Unlicense; frictionless-py MIT | spec v2.0 (2024-06-26); frictionless-py 5.20.0 (2026-10-08) | descriptors (JSON) | n/a | **field/schema vocabulary** for our contract (§4) |
| JSON Schema 2020-12 | validation spec | – | 2020-12 is still current (json-schema.org) | – | n/a | contract & spec validation in builder (python `jsonschema` 4.26.0, `pydantic` 2.14.1) |
| pandas `to_json(orient="table")` | Table Schema emitter | BSD-3 | pandas 3.0.6 (2026-09-17) | `{schema:{fields,primaryKey,pandas_version}, data:[…]}` | n/a | the zero-effort ingestion path for analysts |
| **Mosaic** (UW IDL) | coordinated views over DuckDB | BSD-3-Clause | 0.33.0 (2026-10-13); 1.4k★ | declarative JSON/YAML spec (`meta`, `data`, `params`, `vconcat`/`hconcat`, `plot`, `input`), `$param` refs | ❌ (DuckDB) | **Selection resolution** (`intersect`, `union`, `single`, `crossfilter`) and `$param` syntax |
| Grafana dashboard JSON | dashboard-as-code model | AGPL-3.0 (code; concept is free to emulate) | v12.x schema v2; 77.2k★ | v1: `panels[]` with `gridPos` (24 cols); v2: `spec.elements` map + `layout` (Grid/AutoGrid/Rows/Tabs) items referencing elements | n/a | **elements ≠ layout**; `schemaVersion` + migrations; `fieldConfig.defaults` (unit/decimals/thresholds) |
| Flourish templates | hosted data-viz templates | proprietary SDK (`@flourish/sdk` 5.2.10 "SEE LICENSE") | – | template declares **data bindings** (`column` vs `columns` slots) | n/a | binding-slot concept for "client maps their own columns" |

### 2.2 Observable Framework — data loaders (most relevant packaging precedent)

Source: https://github.com/observablehq/framework/blob/main/docs/data-loaders.md

- "**Data loaders** generate static snapshots of data during build." Rationale: dashboards are fast because "data is precomputed", and "your users don't need direct access to your data warehouse".
- Naming: `quakes.json.sh` → `quakes.json`. The second extension picks the interpreter (`.py`, `.R`, `.js`, `.ts`, `.sh`, `.exe` …). "Data loaders must output to standard output… log to standard error."
- Archives: a loader can emit `.zip`/`.tar.gz`, and individual members are addressable (`FileAttachment("quakes/2021.csv")`).
- Caching: `.observablehq/cache`. In preview, the cache is fresh if newer than the loader's mtime. At build, a loader runs only if its output is not cached. "When any data loader fails, the entire build fails." Empty output only warns.
- Only referenced files are built (static analysis of `FileAttachment` calls).
- Status: 1.13.3 added a **deprecation notice on `deploy`**. Observable Cloud data-app hosting was phased out (release note 2025-04-15: building/deploying to Observable Cloud ended 2025-10-15). 1.13.4 (2026-03-02) is dependency bumps only, and Notebook Kit 2.x is where development continues. → **Borrow the conventions, not the tool.** Its output is ES-module based, so it is a no-go on `file://`.

**Borrow for our Python builder:** a `loaders/` folder where `comps.json.py` writes JSON (or a DataFrame via a helper) to stdout. The builder caches by loader hash + input hash, fails the build on non-zero exit, and only builds datasets referenced by the spec.

### 2.3 Evidence / Quarto / Plotly / Panel / Altair — "how others go offline"

- **Evidence** (classic, from prior knowledge of the 2023–2025 docs): `sources/` queries → parquet snapshots. Pages are markdown with fenced ```sql blocks whose results are named and passed to components such as `<BarChart data={orders} x=month y=sales series=region/>`. The build is SvelteKit static output plus DuckDB-WASM ("universal SQL") and must be **served**. The 2026 docs (https://docs.evidence.dev/cli/commands) list `evidence dev/serve/launch/query…` and **no static build command**; self-hosting runs "`evidence serve`… hardened as a production server". → The precedent value is the authoring model (SQL + markdown + props-as-bindings), not the packaging.
- **Quarto dashboards** (https://quarto.org/docs/dashboards/): pages/rows/columns by headings; cards, tabsets, sidebars, toolbars, value boxes. Dashboards can be "deployed as static web pages (no special server required)" or use Shiny. `embed-resources: true` → "self contained HTML" where everything is in one file, except math libraries unless `self-contained-math: true`.
- **Plotly** `write_html` (https://plotly.com/python-api-reference/generated/plotly.io.write_html.html): `include_plotlyjs='directory'` means "a script tag is included that references an external plotly.min.js bundle that is assumed to reside in the same directory as the HTML file", and the bundle is copied once per directory. That is exactly our shared `vendor/` folder. plotly.js v4.0.0 (2026-08-24) removed the Mapbox traces (`scattermapbox` etc.), dropped MathJax v2, and switched color parsing to a new library. The plotly.js dist-min bundle is **4.7 MB raw / 1.44 MB gz**, 4× ECharts (1.07 MB / 359 KB gz).
- **Panel** (https://panel.holoviz.org/how_to/export/embedding.html): `embed()` records outputs for each widget state so the app runs "entirely from within Javascript". By default about 1000 states, and sliders get 3 options (`max_opts`). Exported state JSON needs HTTP because "Browsers block access to local files". → **Lesson:** precomputing states explodes combinatorially. Ship the data plus a small client query engine instead.
- **Altair**: `chart.save('chart.html', inline=True)` "includes all necessary JavaScript dependencies inline" and requires vl-convert. The default HTML loads Vega from a CDN. `chart.save('chart.json')` is spec-only.

### 2.4 Great Tables 1.0 — the table anatomy to copy (as a design reference)

Release notes (https://github.com/posit-dev/great-tables/releases), PyPI 1.0.0 = 2026-09-25:
- **Anatomy:** header (title/subtitle) → column spanners → column labels → stub (row labels) + row groups (`tab_stub_indent` for hierarchy) → body → summary rows (`summary_rows`, 0.22) → footnotes (`tab_footnote`, `opt_footnote_spec`, 1.0) → source notes.
- **Formatters:** `fmt_number`, `fmt_currency`, `fmt_percent`, `fmt_scientific`, `fmt_engineering` (0.21), `fmt_number_si` (0.23), `fmt_date/time/datetime`, `fmt_duration`, `fmt_partsper` (0.22), `fmt_fraction`, `fmt_index`, `fmt_url/email` (1.0), `fmt_nanoplot` (inline sparkline/bar), `data_color` (`col_numeric/col_bin/col_factor`), `define_units` (units notation).
- **Behaviour:** `sub_missing`/`sub_zero` substitutions, `cols_merge`, `opt_interactive()` (sort/search/filter/paginate, 0.24), `gtsave()` via headless Chrome (0.22), and in **1.0: "Cell body values are now HTML-escaped by default"** (XSS hardening).
- **For us:** mirror this anatomy in the table component's spec (`title, subtitle, spanners[], stub, groupBy, summaryRows[], footnotes[] (cell-targeted), sourceNotes[]`, per-column `format` + `missing` substitution + `colorScale`). Escape by default and allow a markdown subset. Builder-side GT is an option for static PDF/email tables, but it would put data into HTML, so it is not the main path.

### 2.5 Frictionless Table Schema v2 (https://datapackage.org/standard/table-schema/)

- Field types: `string, number, integer, boolean, object, array, list, datetime, date, time, year, yearmonth, duration, geopoint, geojson, any`.
- Field props: `name` (required), `title`, `description`, `example`, `type`, `format`, `constraints` (`required, unique, minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, jsonSchema, pattern, enum`), `missingValues` (field-level override), `categories` (+labels), `categoriesOrdered`, `rdfType`. Number-specific: `groupChar`, `decimalChar`, `bareNumber`.
- Schema props: `fields`, `fieldsMatch` (`exact|equal|subset|superset|partial`), `missingValues` (strings **or `{value,label}` objects**: labelled missingness), `primaryKey` (array), `uniqueKeys`, `foreignKeys`, `$schema`.
- Data Package v2.0 changelog (https://datapackage.org/overview/changelog/), released **2024-06-26**: `$schema` replaces `profile`, `version` is part of the spec, `sources[].version`, `contributors[].roles`, `categories`, labelled `missingValues`, `fieldsMatch`, `list` type, Table Dialect spec.
- JS libs (`tableschema` 1.12.6, `datapackage` 1.1.10) last published in 2022, so they are stale. The Python `frictionless` 5.20.0 is active. → Use the **spec vocabulary**, and validate in Python.

### 2.6 Mosaic selections + Grafana layout + Graphic Walker encodings (spec design inputs)

- **Mosaic Selection** (https://idl.uw.edu/mosaic/api/core/selection.html):
  - `intersect` (AND), `union` (OR), `single` (latest clause only).
  - With `cross: true`, clauses are omitted "where the clients set includes the input". So a view is **not filtered by its own brush**. `Selection.crossfilter()` = `intersect({cross:true})`.
  - A clause is `{source, clients, predicate, value, schema}`. A new clause from the same source replaces the old one.
  - Empty selection = all rows (unless `empty:true`). `include` relays upstream selections.
- **Mosaic spec** (https://idl.uw.edu/mosaic/spec/): `{meta, config, data:{name:{file|query|values}}, params:{name: default}, plotDefaults, vconcat:[{input:'slider', as:'$point'}, {plot:[{mark:'areaY', data:{from:'walk'}, x:'t', y:{sql:'v + $point'}}]}]}`. Note the **`$name` reference syntax** for params in expressions.
- **Grafana schema v2** (https://grafana.com/docs/grafana/latest/observability-as-code/schema-v2/layout-schema/):
  - Panels live in `spec.elements` (PanelKind, LibraryPanelKind).
  - Layout kinds `GridLayoutKind | AutoGridLayoutKind | RowsLayoutKind | TabsLayoutKind` hold items `{x, y, width, height, element: ElementReference}`.
  - v1 used a 24-column `gridPos` with `h` in 30 px units, and `schemaVersion` "incremented each time a Grafana update brings changes to said schema".
- **Graphic Walker `IChart`** (`packages/graphic-walker/src/interfaces.ts`): `{ $schema?, visId, name, encodings: DraggableFieldState, config: {defaultAggregated, geoms[], coordSystem, limit, folds?}, layout }`. The encoding channels (rows/columns/color/opacity/size/shape/theta/radius/longitude/latitude/geoId/details/filters/text) are a ready-made list of **multi-dimensional encoding channels**. The source comment on `$schema` says: "Version stamp added by `normalize()`. Optional so that specs persisted by earlier releases… stay valid."
- **Rill metrics view** (https://docs.rilldata.com/reference/project-files/metrics-views): `dimensions[{name, display_name, column|expression}]`, `measures[{name, display_name, expression, format_preset|format_d3, valid_percent_of_total, requires}]`. Presets are `humanize, none, currency_usd, currency_eur, percentage, interval_ms`. Canvas (https://docs.rilldata.com/reference/project-files/canvas-dashboards): `rows[{height, items[{component, width}]}]` or tab groups, plus `filters.pinned/required` and `defaults`.

### 2.7 Supporting libraries evaluated (runtime / builder), verified versions and classic-script availability

| Library | License | Latest (date) | Classic `<script>` build? (file) | min+gz | Verdict | Why |
|---|---|---|---|---|---|---|
| ECharts (dataset/encode + SSR) | Apache-2.0 (+NOTICE) | 6.1.0 (2026-05-19) | ✅ `dist/echarts.min.js` UMD; `ssr/client/dist/index.js` UMD 3.6 KB | 359 KB | adopt (already vendored) | `dataset`+`encode` is the natural compile target for our `encoding`; SVG renderer for print; SSR for static fallback |
| vega + vega-lite + vega-embed | BSD-3-Clause | 6.4.0 / 6.5.0 (2026-10-08) / 7.3.0 | ✅ UMD (`build/vega.min.js`, `build/vega-lite.min.js`, `build/vega-embed.min.js`) | 175+79+20 KB | consider (optional "grammar" component; reference for spec) | lets power users paste a VL spec; also LLM-friendly |
| crossfilter2 | Apache-2.0 | 1.5.4 (2020 code; npm meta 2022) | ✅ `crossfilter.min.js` UMD | 5 KB | consider | sorted-index filtering for >100k-row linked views; tiny; stable but unmaintained |
| Arquero | BSD-3-Clause | 8.0.3 (2025-05-29) | ✅ `dist/arquero.min.js` UMD (global `aq`; bundles acorn) | 71 KB | consider | dataframe verbs (groupby/rollup/pivot/join/window) for client queries; expressions compile via `Function` |
| Apache Arrow JS | Apache-2.0 | 21.2.0 (2026-07-21) | ✅ `Arrow.es2015.min.js` UMD (global `Arrow`) | 50 KB | consider (API mode, big data) | Arrow IPC over HTTP, or base64 inside `.js` on `file://` |
| DuckDB-WASM | MIT | npm `latest` = 1.33.1-dev57.0 (dev build!) | ❌ ESM + Worker + WASM fetch | multi-MB | avoid on file:// (consider for hosted/API mode) | blocked by worker and fetch rules; huge |
| Perspective (`@perspective-dev/*`) | Apache-2.0 | 5.6.0 (2026-10-14) | ❌ CDN build is ESM with `import.meta.url`, fetches `.wasm` | 24 KB + WASM | reference | view-config JSON is a great "saved view" precedent |
| Graphic Walker | Apache-2.0 | 0.5.3 (2026-10-01) | ⚠ UMD needs React ≥19 + styled-components globals; React 19.3.0 has no UMD | 1.18 MB | reference | channel vocabulary + spec `$schema`/migrate |
| Paged.js | MIT | 0.4.3 (2023-07-06); 0.5.0-beta.2 (2024-10) | ✅ UMD, but ❌ on `file://` with linked CSS (verified) | 94 KB | avoid (reference) | native Chrome 131+ margin boxes + DOM footers cover the need |
| Vivliostyle core | **AGPL-3.0** | 2.45.2 (2026-09) | – | – | avoid | license |
| Playwright (Python) | Apache-2.0 | 1.64.0 (2026-10-13) | n/a (builder) | – | adopt (builder) | PDF (`prefer_css_page_size`, `outline`, `tagged`), PNG per slide, `file://` regression tests |
| WeasyPrint | BSD-3-Clause | 70.0 (2026-09-08) | n/a (builder) | – | reference | no JavaScript, so charts would need pre-rendering |
| Kaleido / vl-convert | MIT / BSD-3-Clause | 1.5.0 / 1.9.0.post1 | n/a (builder) | – | reference | per-library static export; Playwright covers all components uniformly |
| frictionless-py | MIT | 5.20.0 (2026-10-08) | n/a (builder) | – | consider (builder validation) | validates Table Schema v2 resources; JS ports stale (2022) |
| jsonschema (py) / pydantic | MIT / MIT | 4.26.0 / 2.14.1 | n/a (builder) | – | adopt (builder) | pydantic models → `model_json_schema()` → `schemas/*.json` shipped with the kit |
| Ajv | MIT | 8.20.0 (2026-04-24) | ❌ no browser UMD in dist (bundle needed); uses code generation | – | consider (Node/API server only) | runtime validation not needed in the client |

---

## 3. 推荐：报告文件夹布局 (Report folder layout)

```
acme-sw-comps_2026-10-14_r3/            # <report-id>_<date>_r<revision>; zip this for delivery
├─ index.html                           # thin shell: <link> CSS, classic <script> tags, <noscript>, no data, no inline JSON
├─ report.js                            # spec (layout + components + bindings), JSONP-wrapped: RK.spec.register(JSON.parse("…"))
├─ report.json                          # same spec, canonical JSON (for HTTP/API, diffing, LLM tooling)
├─ manifest.js / manifest.json          # report meta, generator, datasets index, hashes, checksums
├─ css/
│  ├─ rk.base.css  rk.components.css  rk.print.css
│  └─ themes/ navy.css  ...             # design tokens as CSS custom properties (read via getComputedStyle, not cssRules)
├─ js/
│  ├─ rk.core.js rk.format.js rk.expr.js rk.data.js …   # kit runtime (classic IIFE), versioned
│  ├─ rk.components.js                  # component registry implementations
│  └─ rk.worker-src.js                  # (optional) worker code as a string → Blob-URL worker
├─ vendor/                              # pinned 3rd-party UMD builds + LICENSE/NOTICE per package
│  ├─ echarts/ leaflet/ topojson-client/ …
│  └─ THIRD_PARTY_NOTICES.md           # aggregated; Apache-2.0 NOTICE files (ECharts) must be reproduced
├─ fonts/  *.woff2  OFL.txt             # bundled; optional base64 @font-face in css for single-file mode
├─ data/
│  ├─ comps.json   comps.js             # dual emission per dataset
│  ├─ prices.json  prices.js
│  └─ geo/ world-110m.js                # TopoJSON wrapped as JS (vendor geodata also as .js)
├─ assets/  logo.svg  ...               # prefer SVG; raster images that charts draw → data: URIs inside .js
├─ exports/ (optional)  report.pdf  report.xlsx   # builder-produced static companions
└─ README.txt                           # "Open index.html in Chrome/Edge/Firefox; no internet needed"
```

Rules:
- **Load order** in `index.html`: vendor → kit core → `manifest.js` → `report.js` → (eager) datasets needed by page 1 → app boot. Other datasets are **lazy-loaded via script injection** when their page or tab is first shown (verified to work on `file://`).
- Every `data/*.js` calls `RK.data.register(id, obj)`. Do **not** assign a global (`window.X = …`): this allows validation on arrival, multiple reports per page, and no global leakage. Let the kit also accept early arrival through a queue (`(window.RK_Q = window.RK_Q || []).push(["dataset", id, obj])`) so script order mistakes don't break things.
- **Same bytes, different transports:** the `.json` file is the canonical document. The `.js` file is exactly `RK.data.register("<id>", JSON.parse(<json.dumps(json_text)>));`. The builder writes both from one serialized string, so they cannot diverge.
- **Hash routing** (`#/p/3`, `#/p/3?region=EU`) for deep links. URL state = page + filters + params, so a link reproduces the view (works on `file://`, verified `pushState` with hash and query).
- **Single-file mode** (builder flag `--single-file`) for email or portal upload. Inline CSS into `<style>`, JS into `<script>`, datasets into `<script type="application/json" id="rk-data-comps">` (parsed by the kit; keeps data separable and extractable), fonts and images as base64. Precedents: Quarto `embed-resources`, Plotly `include_plotlyjs=True`, Altair `inline=True`, Bokeh `INLINE`.
- **Size budget:** ECharts 1.07 MB + Leaflet ~150 KB + kit, so roughly 1.5 MB of JS before data. Data over about 20 MB on `file://` should switch to columnar orientation and pre-aggregation in the pipeline (Observable's argument: "data can be highly optimized (and aggregated and anonymized)").

## 4. 推荐：数据契约 (Dataset contract `rk.dataset@1`)

Aligned with Table Schema v2 names (so `frictionless` and pandas `orient="table"` map almost 1:1), plus finance-specific extensions (marked ★). This is compatible with the kit's existing `rk.data.js` header (`id/title/schema.fields/data/meta/computed`).

```json
{
  "$schema": "schemas/rk.dataset-1.0.json",
  "contract": "rk.dataset@1",
  "id": "comps",
  "title": "Trading comparables — US application software",
  "description": "NTM multiples on consensus; market data at close.",
  "version": "2026-10-14T06:10:03Z+run.4411",
  "hash": "sha256-3f5a0c…",
  "asOf": "2026-10-10",
  "orient": "records",
  "schema": {
    "fields": [
      {"name": "ticker",  "type": "string", "title": "Ticker",  "role": "key"},
      {"name": "company", "type": "string", "title": "Company", "role": "label"},
      {"name": "region",  "type": "string", "title": "Region",  "role": "dimension",
       "categories": [{"value": "NA", "label": "North America"}, {"value": "EU", "label": "Europe"}],
       "categoriesOrdered": true},
      {"name": "mkt_cap", "type": "number", "title": "Market cap", "role": "measure",
       "unit": {"currency": "USD", "scale": 1e6, "label": "USD m"},
       "format": "#,##0", "aggregate": "sum"},
      {"name": "ev_ebitda_ntm", "type": "number", "title": "EV / NTM EBITDA", "role": "measure",
       "unit": {"kind": "multiple"}, "format": "0.0x", "aggregate": "median",
       "constraints": {"minimum": 0}},
      {"name": "rev_growth", "type": "number", "title": "NTM revenue growth", "role": "measure",
       "unit": {"kind": "ratio"}, "format": "0.0%;(0.0%)", "aggregate": "median", "polarity": "higher-better"},
      {"name": "hq_lat", "type": "number", "role": "geo.lat"},
      {"name": "hq_lon", "type": "number", "role": "geo.lon"},
      {"name": "listing_date", "type": "date", "title": "IPO date", "format": "mmm-yy"}
    ],
    "primaryKey": ["ticker"],
    "missingValues": [{"value": "", "label": "n.a."}, {"value": "NM", "label": "Not meaningful"}]
  },
  "data": [
    {"ticker": "AAA", "company": "Alpha Software", "region": "NA", "mkt_cap": 41250.3,
     "ev_ebitda_ntm": 24.1, "rev_growth": 0.183, "hq_lat": 37.4, "hq_lon": -122.1, "listing_date": "2012-05-18"}
  ],
  "flags": [
    {"key": ["BBB"], "field": "ev_ebitda_ntm", "code": "NM", "footnote": "f2"}
  ],
  "computed": [
    {"name": "ev_rev_ntm", "title": "EV / NTM revenue", "formula": "ev / revenue_ntm", "format": "0.0x"}
  ],
  "meta": {
    "source": [{"title": "FactSet consensus", "asOf": "2026-10-10"}, {"title": "Company filings"}],
    "footnotes": [
      {"id": "f1", "text": "Pro forma for the acquisition of Gamma (closed Sep-26)."},
      {"id": "f2", "text": "NM = not meaningful (negative NTM EBITDA)."}
    ],
    "currency": "USD",
    "confidentiality": "Strictly confidential",
    "lineage": {"loader": "loaders/comps.json.py", "sql": "sql/comps.sql", "run_id": "4411", "git": "a1b2c3d"}
  }
}
```

Contract rules (the builder enforces them with JSON Schema 2020-12 generated from pydantic models, and the runtime does a light shape check only):
1. **Values are raw numbers; presentation lives in `format`; meaning lives in `unit`.** `unit.scale` lets axis titles auto-read "USD m" and lets the formatter rescale (`$#,##0.0,,"bn"`). Keep Excel-style codes because analysts already know them (`rk.format.js` supports them). Optionally also accept d3-format (Rill's `format_d3`) and an `Intl.NumberFormat` options object.
2. **`role`** (`key | label | dimension | measure | time | geo.lat | geo.lon | geo.id | ignore`) drives defaults: auto-encoding suggestions, tooltip ordering, and which fields a client may put on axes. It plays the role of Rill's dimensions/measures and Graphic Walker's dimension/measure split.
3. **`aggregate`** is the default roll-up. Multiples and ratios must default to `median` (or a weighted formula), **never `sum`**. Encode `polarity` (higher-better/lower-better) for conditional colouring.
4. **Missingness:** cells hold `null`; the *reason* lives in `schema.missingValues` labels and the per-cell `flags[]` (code + footnote). Renderers print `n.a.` / `NM` and attach the footnote marker. This is the banking convention Great Tables handles with `sub_missing` + `tab_footnote`.
5. **`orient`**: `records` (default, readable), `columns` (`{"field":[…]}`, about 38% smaller, fastest), or `rows` (arrays in field order, pandas `split`-like). The runtime normalizes to an internal columnar or row store.
6. **Dates** are `YYYY-MM-DD` strings (`type:"date"`). `datetime` must carry an offset or `Z`. Periods use `yearmonth`, `year`, or a `"2026Q3"` string with `type:"string", role:"time", "timeGrain":"quarter"` ★.
7. **`asOf`, `source[]`, `footnotes[]` are mandatory for client deliverables.** Components inherit them (`"source": "inherit"`) and render the "Source: …; as of …" line automatically, as think-cell/pitchbook pages do.
8. **`computed[]`** formulas use the kit's safe expression language (no `eval`). Client-typed formulas are added at runtime under the same structure and can be exported back as JSON, which gives a round trip with the builder.
9. **Ingestion path for analysts:** `df.to_json(orient="table", date_format="iso")` gives `schema.fields` + `primaryKey` + `data`. The builder upgrades it (pandas `type:"any"` + `constraints.enum` → `categories`; drop `extDtype`, `pandas_version`), then merges a sidecar `comps.meta.yaml` with titles, units, formats, sources and footnotes. Analysts never hand-write JSON.

## 5. 推荐：manifest、加载协议与未来 API (Manifest, loader protocol, API mode)

```json
{
  "$schema": "schemas/rk.manifest-1.0.json",
  "report": {"id": "acme-sw-comps", "title": "Project Falcon — Valuation materials", "client": "ACME Corp",
             "date": "2026-10-14", "revision": 3, "lang": "en-GB", "confidentiality": "Strictly confidential"},
  "generator": {"name": "rk-builder", "version": "0.4.0", "kit": "0.1.0", "python": "3.13",
                "builtAt": "2026-10-14T06:12:00Z", "specVersion": "1.0", "contract": "rk.dataset@1"},
  "spec": {"json": "report.json", "js": "report.js", "hash": "sha256-…"},
  "datasets": [
    {"id": "comps", "json": "data/comps.json", "js": "data/comps.js", "rows": 42, "bytes": 18320,
     "hash": "sha256-…", "version": "2026-10-14T06:10:03Z+run.4411", "asOf": "2026-10-10",
     "eager": true, "usedBy": ["p2", "p3"]}
  ],
  "vendor": [{"id": "echarts", "version": "6.1.0", "license": "Apache-2.0"}],
  "checksums": {"index.html": "sha256-…", "js/rk.core.js": "sha256-…"},
  "changelog": [{"revision": 3, "date": "2026-10-14", "note": "Updated market data to 10-Oct close"}]
}
```

Loader protocol (`RK.data.load(id) → Promise<Dataset>`), adapter chosen at boot:

| Mode | Detection | Transport | Notes |
|---|---|---|---|
| `file` | `location.protocol === 'file:'` | inject `<script src="data/<id>.js">`, resolve on `register` | verified in Chromium/Firefox; add a timeout and `onerror` → visible "data file missing" panel |
| `static-http` | http(s) and no `<meta name="rk:api">` | `fetch('data/<id>.json')` (or still script injection) | allows `?v=<hash>` cache-busting, gzip/brotli |
| `api` | `<meta name="rk:api" content="https://host/api/reports/42/">` | `GET {api}manifest`, `GET {api}datasets/{id}` → **the identical JSON document** | ETag = dataset `hash`; optional `Accept: application/vnd.apache.arrow.stream` for big data (Arrow JS 21.2.0 has a UMD build, 50 KB gz) |
| `inline` | `<script type="application/json" id="rk-data-<id>">` present | `JSON.parse(el.textContent)` | single-file mode |

- Because every mode returns the same contract, swapping to an API changes no component code. That is the core requirement.
- Cross-check: `register` verifies `contract` and `id`, and that `hash` matches the manifest (cheap equality check, not re-hashing). `crypto.subtle` is available on `file://` (secure context, verified) if re-hashing is ever wanted.

## 6. 推荐：布局 / 规格与绑定 (Report spec: components, bindings, interactions)

Design principles taken from the precedents:
- **Elements vs layout** (Grafana v2): `components{}` is a map by id, and `pages[].items[]` reference components with grid coordinates. A component can be reused on several pages (e.g., summary + appendix) and moved without editing its definition.
- **Encodings = Vega-Lite channel names.** These are the best-known grammar for both humans and LLMs (step 2) and line up with Graphic Walker's channels. They compile to ECharts `dataset` + `encode` + `visualMap` (color/size) or Leaflet styles.
- **Params** (`$name`) for what-if inputs (Mosaic/Vega-Lite `params`; the kit's `@name` syntax in `rk.expr.js` is equivalent, so pick one sigil and alias the other).
- **Selections** with explicit resolution (Mosaic): `crossfilter` by default for linked views.

```json
{
  "$schema": "schemas/rk.report-1.0.json",
  "specVersion": "1.0",
  "id": "acme-sw-comps",
  "theme": {"name": "navy", "density": "compact", "page": {"size": "16:9", "width": 1280, "height": 720}},
  "format": {"locale": "en-GB", "na": "n.a.", "nm": "n.m."},
  "params": {
    "wacc": {"type": "number", "default": 0.085, "min": 0.06, "max": 0.12, "step": 0.0025, "format": "0.00%", "label": "WACC"},
    "ccy":  {"type": "enum", "values": ["USD", "EUR"], "default": "USD", "label": "Currency"}
  },
  "selections": {
    "region": {"field": "region", "dataset": "comps", "type": "multi", "resolve": "crossfilter"},
    "peer":   {"field": "ticker", "dataset": "comps", "type": "single", "resolve": "crossfilter"}
  },
  "filters": [
    {"id": "f_region", "control": "chips", "bind": "region", "scope": "report", "label": "Region"}
  ],
  "pages": [
    {"id": "p2", "title": "Trading comparables", "subtitle": "EV / NTM EBITDA vs growth",
     "layout": {"type": "grid", "columns": 12, "rowHeight": 40, "gap": 12},
     "items": [
       {"ref": "kpi_median",  "x": 0, "y": 0, "w": 3, "h": 2},
       {"ref": "bar_mult",    "x": 0, "y": 2, "w": 7, "h": 9},
       {"ref": "bubble",      "x": 7, "y": 2, "w": 5, "h": 9},
       {"ref": "tbl_comps",   "x": 0, "y": 11, "w": 12, "h": 6}
     ],
     "footer": {"source": "auto", "footnotes": "auto", "pageNumber": true}}
  ],
  "components": {
    "kpi_median": {"type": "kpi", "data": {"dataset": "comps"},
                   "value": {"field": "ev_ebitda_ntm", "aggregate": "median"}, "label": "Peer median EV/EBITDA"},
    "bar_mult": {
      "type": "bar", "title": "EV / NTM EBITDA",
      "data": {"dataset": "comps", "filter": "ev_ebitda_ntm > 0", "sort": [{"field": "ev_ebitda_ntm", "order": "desc"}], "limit": 20},
      "encoding": {
        "x": {"field": "company"}, "y": {"field": "ev_ebitda_ntm"},
        "color": {"field": "region"}, "label": {"field": "ev_ebitda_ntm"}
      },
      "marks": [{"type": "rule", "y": {"aggregate": "median", "field": "ev_ebitda_ntm"}, "label": "Median {value}"}],
      "interactions": {"select": {"selection": "peer", "on": "click"}, "zoom": false},
      "footnotes": ["f2"]
    },
    "bubble": {
      "type": "scatter",
      "data": {"dataset": "comps"},
      "encoding": {
        "x": {"field": "rev_growth"}, "y": {"field": "ev_ebitda_ntm"},
        "size": {"field": "mkt_cap", "scale": {"type": "sqrt", "range": [6, 42]}},
        "color": {"field": "region"}, "shape": {"field": "listing"},
        "label": {"field": "ticker"}, "tooltip": [{"field": "company"}, {"field": "mkt_cap"}, {"field": "ev_ebitda_ntm"}]
      },
      "marks": [{"type": "regression", "method": "linear", "show": "r2"}],
      "interactions": {"zoom": {"type": "inside+slider", "axes": ["x", "y"]}, "brush": {"selection": "peer"}}
    },
    "tbl_comps": {
      "type": "table", "data": {"dataset": "comps"},
      "stub": "company", "groupBy": "region",
      "spanners": [{"label": "Valuation", "columns": ["ev_ebitda_ntm", "ev_rev_ntm"]}, {"label": "Growth", "columns": ["rev_growth"]}],
      "columns": [{"field": "mkt_cap"}, {"field": "ev_ebitda_ntm", "colorScale": {"type": "diverging", "mid": "median"}},
                  {"field": "ev_rev_ntm"}, {"field": "rev_growth", "nanoplot": false}],
      "summaryRows": ["median", "mean"],
      "highlight": {"selection": "peer"}
    }
  }
}
```

Binding semantics:
- `data` = `{dataset, filter?: expr, params?, sort?, limit?, aggregate?: {groupBy, measures}, join?: {...}}`. All of it is evaluated by the kit's query engine (`rk.data.js` + `rk.expr.js`) on the client, so client-typed formulas and filters reuse the same path.
- `encoding.<channel>` = `{field | value | expr, aggregate?, scale?, format?, title?, legend?}`. Missing `title`/`format` fall back to the dataset field metadata, so **format lives with the data and is overridable per component**.
- Effective filter for component C = report filters ∧ page filters ∧ ∧(selections S with `resolve: "crossfilter"`, excluding clauses whose `source === C`) ∧ C.data.filter. This is Mosaic's crossfilter rule and prevents a brushed chart from collapsing itself.
- **Re-render on change:** the store emits `{type:'filter'|'param'|'data', key}`. Each component declares its dependencies at compile time (datasets, params, selections), and only affected components re-render (`rk.data.js` already has `affected(ds, changes)`). Data swaps (`RK.data.register` again with a new `version`) trigger the same path, which is the hook for a live API.
- **Unknown properties:** warn, don't fail (forward compatibility, like Table Schema `fieldsMatch` tolerance). Unknown component `type` renders a visible placeholder card.
- **Authoring:** analysts write YAML (Rill/Quarto style) or a Python DSL (`Report().page(...).bar(...)`); the builder emits JSON. The JSON is the contract, never the YAML.

## 7. 版本管理 (Versioning)

| Thing | Field | Scheme | Precedent |
|---|---|---|---|
| Report spec grammar | `$schema` + `specVersion` | `MAJOR.MINOR`; minor = additive; major = migration required | Vega-Lite `$schema: …/v6.json`; Grafana `schemaVersion`; GW `IChart.$schema` |
| Dataset contract | `contract: "rk.dataset@1"` | major only; additive fields allowed | Table Schema `$schema` profile 1.0 → 2.0 |
| Dataset content | `version` (pipeline run / timestamp) + `hash` (sha256 of canonical JSON) | immutable per build | Data Package `version`, `sources[].version` |
| Report issue | `manifest.report.revision` + `changelog[]` | integer, increments on each client re-send | pitchbook "v3" practice |
| Kit runtime | `RK.version` + `manifest.generator.kit` | semver; **frozen inside each report** | Plotly `include_plotlyjs='directory'` (bundle travels with HTML) |
| Vendor libs | `vendor/vendor.json` + `THIRD_PARTY_NOTICES` | exact pins | lockfiles |

- **Migrations:** `RK.spec.migrate(spec)` applies ordered `1.0→1.1→2.0` functions. Mirror them in Python (`rk_builder.migrate`) so old report sources can be rebuilt. The runtime accepts the current major and N-1 (migrating in memory) and refuses newer majors with a readable message ("This report requires ReportKit ≥ 2.0"). Graphic Walker's `spec.migrate()` and `normalize()` stamping is a precedent.
- **Reproducibility:** a delivered folder must render identically years later (record-keeping). That is why vendor and kit are copied in rather than referenced, and `checksums` lets compliance verify integrity.
- **Diffability:** `report.json` and `data/*.json` are pretty-printed in a debug build and compact in a release build. Stable field order gives meaningful git diffs of report revisions.

## 8. 打印 / PDF 最佳实践 (Print-to-PDF for landscape pitchbook pages)

### 8.1 Measured (Chromium 156 `page.pdf(prefer_css_page_size=True, print_background=True)`)
- `@page { size: 13.333in 7.5in; margin: 0 }` → every page MediaBox = **960 × 540 pt** (exactly 13.333 × 7.5 in = PowerPoint 16:9). 1280×720 CSS px at 96 px/in = 13.333 × 7.5 in, so a slide authored at 1280×720 px fills the page with **no scaling and no reflow**.
- ECharts canvas renderer → the PDF contains a **560×360 raster image** (DPR 1 in headless; blurry when zoomed, text not selectable).
- ECharts **SVG renderer → vector paths + extractable text** (axis labels and data labels appear in `extract_text()`).
- Named page with margin boxes (`@page deck { @bottom-right { content: "Page " counter(page) " of " counter(pages) } }` + `.slide.deck { page: deck }`) → rendered "Page 3 of 3" + "Strictly confidential" on that page only.
- DOM-based footer with CSS counters (`body{counter-reset:slide} .foot::after{counter-increment:slide; content:"Slide " counter(slide)}`) → rendered on every slide. This is portable to all browsers.
- `outline=True` → 3 PDF bookmarks generated from `<h1>` headings. `tagged=True` is accepted.
- Event sequence during headless `page.pdf()`: `beforeprint`, `matchMedia('print') change:true`, `afterprint`, `change:false`. Print hooks therefore also run in the builder's PDF path.
- **Paged.js 0.4.3** polyfill with `<link rel="stylesheet">` → fails on `file://` (it XHRs the CSS: `Access to XMLHttpRequest … blocked`, `pageerror ProgressEvent`) in both Chromium and stock Firefox. With an inline `<style>` it runs. The latest stable is from 2023-07 (0.5.0-beta.2 from 2024-10). → Not a dependency.

### 8.2 Browser support (MDN browser-compat-data 8.1.5, 2026-10-08)

| Feature | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| `@page` `size` | 15 / 79 | 95 | 18.2 |
| `@page` margin boxes (`@top-left` … `@bottom-right-corner`) | **131** | ✗ | ✗ |
| `page` property (named pages) | 85 | 110 | (listed 1) |
| `page-orientation` descriptor | 85 | 122 | ✗ |
| `break-after: page`, `break-inside: avoid` | 50 | 65 | 10 |
| `print-color-adjust` (unprefixed) | 136 | 97 | 15.4 → also emit `-webkit-print-color-adjust: exact` |
| CSS `zoom` | 1 | 126 | 3.1 |
| `page-margin-safety` | 150 | ✗ | ✗ |

### 8.3 Recipe

```css
/* rk.print.css */
@page { size: 13.333in 7.5in; margin: 0; }                 /* 16:9 deck; offer A4/Letter landscape variants */
@page appendix { size: 11in 8.5in; margin: 0.5in 0.5in 0.6in;
  @bottom-right { content: counter(page); }                  /* Chrome 131+ only: progressive enhancement */ }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print {
  html, body { background: #fff; }
  .rk-slide { width: 1280px; height: 720px; transform: none !important; margin: 0; box-shadow: none;
              break-after: page; break-inside: avoid; overflow: hidden; }
  .rk-appendix { page: appendix; }
  .rk-card, .rk-chart, figure { break-inside: avoid; }
  table.rk-table thead { display: table-header-group; }      /* repeat header rows on each printed page */
  table.rk-table tr { break-inside: avoid; }
  .rk-toolbar, .rk-filter-panel, .rk-tooltip, .no-print { display: none !important; }
  .rk-print-only { display: block !important; }                /* e.g. "Filters applied: Region = EU; WACC 8.5%" */
}
```

```js
// Print hooks (kit): idempotent, also called explicitly by the builder before page.pdf()
RK.print = {
  prepare() {                       // sync: Chrome snapshots layout right after beforeprint handlers
    document.documentElement.classList.add('rk-printing');
    RK.charts.forEach(c => { c.setOption({ animation: false }, { lazyUpdate: false }); c.resize(); });
    RK.maps.forEach(m => m.invalidateSize({ animate: false }));
  },
  restore() { document.documentElement.classList.remove('rk-printing'); RK.charts.forEach(c => c.resize()); }
};
addEventListener('beforeprint', RK.print.prepare);
addEventListener('afterprint', RK.print.restore);
```

- **Fixed-geometry slides are the key decision.** Charts are laid out at the same pixel size on screen and on paper, so print needs no resize. The user's own Ctrl+P also works without relying on `beforeprint` timing. On screen, fit slides to the viewport with `transform: scale(k)` and `transform-origin: 0 0`. Verified: ECharts 6.1 hover and Leaflet 1.9.4 marker/map clicks hit correctly under `transform: scale(0.6)` in Chromium and Firefox. Under `zoom: 0.6`, ECharts reported hovering bar "B" when the pointer was over bar "C" in both browsers, so **avoid `zoom`**. Also offer a responsive "dashboard" mode (reflowing grid) for exploration, and switch to "deck" mode for print and PDF.
- **Animations:** disable them in print. Use `?print=1` or `matchMedia('print').matches` at init, otherwise the snapshot can catch bars mid-tween. Keep entrance animations short (≤600 ms) and transform/opacity-only on screen.
- **Renderer:** use the SVG renderer by default for report charts (vector PDF, selectable text, crisp at any zoom). Use canvas only for dense series (>5–10k points), and then set `devicePixelRatio: 2–3` for print.
- **Fonts:** await `document.fonts.ready` before PDF. Use bundled WOFF2 (verified: subfolder fonts load on `file://`).
- **Builder PDF path:** Playwright Python 1.64.0 (Apache-2.0). Open `file://…/index.html?print=1`, `await page.evaluate("RK.ready")`, `await page.evaluate("RK.print.prepare()")`, then `page.pdf(prefer_css_page_size=True, print_background=True, outline=True, tagged=True)`. Optionally screenshot each `.rk-slide` to PNG for PowerPoint or email. One Chromium renders HTML, PDF and PNG with the same engine as the client, so there is no second rendering stack (WeasyPrint has no JS; vl-convert/Kaleido are per-library).
- **Static fallback per chart (optional):** ECharts SSR (`echarts.init(null, null, {renderer:'svg', ssr:true, width, height})` → `renderToSVGString()`) in Node, plus the 3.6 KB `echarts/ssr/client` UMD for light interactivity. This is useful for emails or a no-JS appendix, but adds a Node step. Prefer Playwright screenshots/SVG extraction from the live page.

## 9. 交付与安全 (Delivery & safety)

- **HTML email attachments are commonly blocked or quarantined** because of HTML-smuggling. Security guidance recommends blocking `.htm/.html` from external senders (https://www.securityscientist.net/blog/12-questions-and-answers-about-html-smuggling-evasion-technique/). → Deliver the **zip of the folder** via data room or secure file transfer, and ship the PDF alongside. Test single-file mode against the client's gateway before relying on it.
- Test on **locked-down Edge/Chrome with enterprise policies** and on Windows files extracted from a downloaded zip. Under `file://`, nothing in our design needs elevated permissions.
- **Escaping:** HTML-escape every text value from data, footnotes and titles by default (Great Tables 1.0 made this its default for XSS reasons), and allow a safe markdown subset (`**bold**`, `_italic_`, links). Data `.js` files are produced only by `json.dumps`, never by string templating, so data cannot inject code.
- **Formula sandbox:** keep client formulas on the kit's own parser (`rk.expr.js`, no `eval`/`new Function`). Arquero's expressions compile with `Function`, which is fine offline but not under a strict CSP in API mode.
- **localStorage namespacing:** Chrome shares one `file://` storage bucket across all local pages, so prefix keys with `rk:<report.id>:<revision>:`. Never store client data there, only UI state.
- **Licenses in the deliverable:** `vendor/THIRD_PARTY_NOTICES.md` aggregates LICENSE texts. ECharts (Apache-2.0) ships a NOTICE file that must be reproduced. Fonts need OFL.txt next to the WOFF2 files.

## 10. 为 Step 2 预留 (skills + local LLM readiness)

- A **JSON-Schema'd spec + contract** is what makes LLM editing safe. The LLM proposes a JSON Patch on `report.json` or a new `computed[]` formula; the kit validates it against the schema and the expression parser and applies it only if valid (otherwise it shows the error). Vega-Lite-style channel names are well represented in model training data, so generation quality should be higher than with a bespoke vocabulary.
- Field `description`, `unit`, `role`, `aggregate`, `polarity` and dataset `description`/`footnotes` double as **semantic context** for the LLM (Rill's metrics-view idea), so no separate semantic layer is needed.
- **"Skills"** = bundles of `{name, description, inputs (JSON Schema), template spec fragment, optional formula set}` loaded like datasets (`skills/<id>.js` → `RK.skills.register`), which works on `file://`.
- **Local LLM transport:** from `file://`, `fetch('http://localhost:11434/…')` is a cross-origin request from origin `null`. The local server must send `Access-Control-Allow-Origin: *` (or `null`). Treat it as an optional adapter, alongside the data API adapter.

## 11. Gotchas 清单 (checklist)

1. ❌ `fetch`/XHR/ESM/`import()`/file Workers/Service Worker/iframe DOM/`cssRules` on `file://`: verified in Chromium 156 and Firefox 157 (stock).
2. Playwright's bundled Firefox **relaxes** `security.fileuri.strict_origin_policy` (`playwright.cfg`). CI tests of `file://` behaviour must set `firefox_user_prefs={"security.fileuri.strict_origin_policy": True}`, or they will pass while real users fail.
3. Local `<img>` drawn on canvas taints it, and `crossOrigin="anonymous"` makes the image fail outright. Use `data:` URIs for any raster used inside charts (ECharts `image://`, pictorial bars, logos in map markers) if PNG export is offered.
4. `json.dumps` NaN → invalid JSON. pandas epoch dates are deprecated. Date-only vs local-time parsing shifts dates.
5. JS object literal data is about 2–3× slower to parse than `JSON.parse("…")` above 10 kB.
6. React 19 has no UMD, so any React-based widget (Graphic Walker, many grid libs) is unusable as a classic script unless we vendor React 18 UMD (and GW 0.5 requires React ≥19).
7. CSS `zoom` breaks ECharts hit-testing (verified). Use `transform: scale`.
8. Canvas charts print as bitmaps; use the SVG renderer for print.
9. Margin boxes are Chrome/Edge 131+ only; put page furniture in the DOM.
10. Safari supports `@page size` only from 18.2. Older Safari users must choose landscape manually, so state this in README.txt.
11. DuckDB-WASM's npm `latest` tag is currently a **dev build** (`1.33.1-dev57.0`), and it needs workers + WASM fetch. Do not plan on it for `file://`.
12. Perspective moved npm scope (`@finos/perspective` frozen at 3.8.0, 2025-09 → `@perspective-dev/*` 5.6.0). It is ESM-only with `import.meta.url`.
13. Observable Framework: deploy deprecated and Observable Cloud hosting ended. Evidence docs no longer document a static build. Don't anchor on either tool.
14. Chrome shares `localStorage` across all `file://` pages, so namespace keys.

## 12. Sources

- MDN — CORS request not HTTP / opaque file origins: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHTTP
- V8 — The cost of JavaScript in 2019 (JSON.parse ≥10 kB): https://v8.dev/blog/cost-of-javascript-2019
- Chrome 131 page margin boxes: https://developer.chrome.com/blog/print-margins , https://developer.chrome.com/blog/new-in-chrome-131
- MDN browser-compat-data 8.1.5 (npm `@mdn/browser-compat-data`, 2026-10-08) — `css.at-rules.page.*`, `css.properties.print-color-adjust`, `css.properties.zoom`
- Observable Framework data loaders: https://github.com/observablehq/framework/blob/main/docs/data-loaders.md ; releases: https://github.com/observablehq/framework/releases ; Observable Cloud deprecation: https://observablehq.com/release-notes/2025-04-15-deprecating-observable-cloud ; Notebook Kit: https://observablehq.com/notebook-kit/
- Evidence: https://github.com/evidence-dev/evidence , https://docs.evidence.dev/cli/commands , https://docs.evidence.dev/deployment/self-host/
- Quarto dashboards: https://quarto.org/docs/dashboards/ ; HTML publishing / embed-resources: https://quarto.org/docs/output-formats/html-publishing.html
- Vega-Lite data / datasets: https://vega.github.io/vega-lite/docs/data.html
- Altair saving charts: https://altair-viz.github.io/user_guide/saving_charts.html
- Plotly `write_html`: https://plotly.com/python-api-reference/generated/plotly.io.write_html.html ; plotly.js v4 changelog: https://unpkg.com/plotly.js@4.0.0/CHANGELOG.md , https://plotly.com/javascript/guides/whats-new-in-v4/
- Panel embedding: https://panel.holoviz.org/how_to/export/embedding.html ; saving: https://panel.holoviz.org/how_to/export/saving.html
- Perspective: https://github.com/perspective-dev/perspective , https://perspective-dev.github.io ; OpenJS: https://openjsf.org/blog/perspective-joins-openjs
- Datapane status: https://docs.datapane.com/ , https://pypi.org/project/datapane
- Rill metrics views: https://docs.rilldata.com/reference/project-files/metrics-views ; canvas: https://docs.rilldata.com/reference/project-files/canvas-dashboards
- Graphic Walker interfaces: https://raw.githubusercontent.com/Kanaries/graphic-walker/main/packages/graphic-walker/src/interfaces.ts ; PyGWalker HTML API: https://docs.kanaries.net/pygwalker/api-reference
- Great Tables releases: https://github.com/posit-dev/great-tables/releases ; blog: https://posit-dev.github.io/great-tables/blog/
- Table Schema v2: https://datapackage.org/standard/table-schema/ ; Data Package changelog: https://datapackage.org/overview/changelog/
- JSON Schema: https://json-schema.org/specification
- Mosaic spec: https://idl.uw.edu/mosaic/spec/ ; selections: https://idl.uw.edu/mosaic/api/core/selection.html
- Grafana JSON model: https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model/ ; schema v2 layout: https://grafana.com/docs/grafana/latest/observability-as-code/schema-v2/layout-schema/
- HTML smuggling / attachment blocking: https://www.securityscientist.net/blog/12-questions-and-answers-about-html-smuggling-evasion-technique/ , https://abnormal.ai/learning/html-smuggling
- Registry checks: npm registry (`npm view`), PyPI JSON API, jsDelivr data API, repos.ecosyste.ms (stars and activity, 2026-10-14)
