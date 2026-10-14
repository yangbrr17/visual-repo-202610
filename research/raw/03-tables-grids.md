# 03 · 表格 / 数据网格 / 透视表 (Tables, Data Grids, Pivot Tables): raw research notes

> Angle: `03-tables-grids` · Date: 2026-10-14 · Author: research sub-agent
> Scope: JS table, grid and pivot libraries for investment-bank report folders (offline, `file://`, permissive licences), plus what to hand-build in HTML/CSS to get a pitchbook look.
>
> **How the facts were checked:**
> - Every version, licence and publish date below comes from the npm registry (`npm view <pkg> version license time[...]`) on 2026-10-14.
> - The dist file lists come from `data.jsdelivr.com`.
> - The gzip sizes come from downloading the dist file and running `gzip -9 | wc -c`.
> - Star counts come from `repos.ecosyste.ms`. The GitHub API was blocked by the proxy.
> - **file:// smoke test:** each library's UMD build was loaded from a local `file://` HTML page in headless Chromium 141 through Playwright, and a small comps table was rendered (see §3).

---

## 0. TL;DR: 结论与推荐栈

1. **Pitchbook-style static tables should be built by hand.** This covers comps, precedent transactions, sensitivity tables, financial summaries and league tables. Use a small in-house `RK.Table` / `RK.Sensitivity` component made of a DOM `<table>`, CSS tokens and a few hundred lines of vanilla JS.
   - Bank tables are static and tightly typeset. They need decimal alignment, phantom parentheses, NM/NA rules, mean/median/high/low rows that exclude the target, footnotes, underlined group headers and correct print output.
   - Every grid library fights you on these details. They are easy in plain HTML/CSS.
   - A DOM `<table>` also prints as vectors, copies and pastes into Excel/PowerPoint, works with Ctrl+F and screen readers, and needs no vendor code.
2. **Interactive data grids get Tabulator 6.6.1** (MIT, UMD `dist/js/tabulator.min.js`, ~103 KB gz, DOM-rendered). Use it for large or long lists, editable inputs, client-side filtering/grouping and spreadsheet-like range selection. It supports:
   - frozen columns and column groups (multi-level headers)
   - `groupBy` with group calcs, top/bottom column calcs and header filters
   - clipboard, range selection and fill handle (6.6.0)
   - print mode (`printAsHtml`) and downloads (CSV/JSON/HTML built in; XLSX via SheetJS; PDF via jsPDF)
   - Restyle it with our own CSS tokens.
   - **Runner-up: AG Grid Community 36.2.0** (MIT, ~522 KB gz UMD). It is the best for 100k+ virtualised rows and polish. Its Community edition still includes multi-row `pinnedBottomRowData` for stats rows, column groups, pinning and CSV export.
   - But grouping, aggregation, pivot, Excel export, sparklines, clipboard, range selection, formulas, calculated columns, Find and the status bar are **Enterprise ($999/dev)**.
3. **Pivot / cross-tab exploration gets AntV S2 2.7.2** (MIT, UMD `dist/s2.min.js`, ~310 KB gz, canvas). Load it as an *optional, lazy* module, used only for an interactive "data explorer" appendix. It has:
   - true cross-tab semantics: grand totals and subtotals, grid and tree modes, drill-down
   - conditional formatting: text, background, interval bars and icons
   - built-in mini charts (line, bar, bullet) and copy/export to CSV
   - **Alternative: VisActor VTable 1.26.8** (MIT, ~544 KB gz plus plugins ~358 KB gz). It is broader (list + pivot + pivot chart + appear animations + sheet with formulas) but heavier.
   - Canvas tables print poorly and cannot be searched, so **never use them for the primary printed tables.**
4. **Exports:**
   - **CSV:** hand-written. Prepend a UTF-8 BOM.
   - **Styled XLSX:** **`write-excel-file` 4.1.1** (MIT, ~19 KB gz UMD, global `writeXlsxFile`). It supports number formats, fills, fonts, borders, merges, frozen panes and formulas. Verified working under `file://`.
   - **Reading or importing client XLSX:** SheetJS CE **0.20.3 from cdn.sheetjs.com**, never npm `xlsx@0.18.5`, which has unfixed CVEs.
   - **PDF:** the browser's Print → PDF with print CSS. jsPDF/AutoTable only if a button-driven PDF is mandatory.
5. **Perspective** (`@perspective-dev/*` 5.6.0, Apache-2.0) is the best engine for streaming pivots with user expressions. It uses ExprTK expressions, virtual servers for DuckDB and ClickHouse, and a Python backend.
   - Its builds are **ESM + WASM fetched via `import.meta.url`**. Under `file://` the smoke test failed with a CORS error.
   - Treat it as **"Step 2 / served mode"** (localhost server or Python host), not as part of the double-click report.
6. **Avoid:**
   - Grid.js: stale since 2024-03.
   - Glide Data Grid: React-only, stale since 2024-02.
   - RevoGrid: Stencil ESM, and Excel export and pivot are Pro.
   - PivotTable.js: jQuery + jQuery UI, last release 2018.
   - simple-datatables: **LGPL-3.0**.
   - HyperFormula: **GPL-3.0** or commercial.
   - WebDataRocks: proprietary EULA and a ~1 MB data cap.
   - Handsontable, Flexmonster, AG Grid Enterprise and RevoGrid Pro: reference only, because they are commercial.

---

## 1. 需求拆解 → 表格技术约束

| Need (from the brief) | What it means for tables | Who does it best |
|---|---|---|
| Comps table with mean/median rows | Several stats rows (Mean, Median, often High/Low, 25th/75th percentile). The target company is excluded from the stats and highlighted. Stats rows stay pinned through sort/filter, and stats are recomputed after filtering. | Hand-built (`<tfoot>`); AG Grid CE `pinnedBottomRowData` (multiple rows allowed); Tabulator allows only **one** topCalc and **one** bottomCalc per column |
| Conditional formatting (heat colours) | Per-column or per-block colour scales (sequential or diverging), thresholds, top/bottom-N, text-contrast flip, and it must print (`print-color-adjust: exact`) | Hand-built (full control); S2 `conditions.background/interval`; VTable `style` functions; Tabulator/AG Grid via formatter or `cellClassRules` |
| Frozen columns and headers | `position: sticky` on first column and header for screen only; unset in print | Hand-built CSS; Tabulator `frozen:true`; AG Grid `pinned:'left'`; S2/VTable `frozenColCount` |
| Multi-level headers | 2–3 header rows with `colspan`; group underline "with gaps" | Hand-built; Tabulator nested `columns`; AG Grid `children`; VTable nested `columns`; S2 pivot columns |
| Sorting / filtering | Sort that keeps stats rows pinned; peer-group filter chips; cross-filter from charts via `RK.bus` | Hand-built (small); Tabulator; AG Grid CE |
| Grouping | Peer-group sub-headers with group mean/median | Hand-built (group rows); Tabulator `groupBy` + `columnCalcs:'both'`; AG Grid only in **Enterprise** |
| Inline sparklines and bars | Trend lines, bullet bars, two-sided data bars (with negatives), win/loss | Hand-built inline SVG (crisp in print); VTable `cellType:'sparkline'/'progressbar'`; S2 mini charts; AG Grid sparklines are **Enterprise** |
| CSV/XLSX export | Formatted XLSX that keeps number formats, bold stats rows, fills and frozen panes | write-excel-file (styled); SheetJS CE (unstyled values plus number formats); ExcelJS (styled plus conditional-format rules, but heavy and slow-moving) |
| Printing | Vector output, repeated `thead` on each page, no virtual-DOM truncation, colours kept | Hand-built DOM table; Tabulator `printAsHtml`; AG Grid `domLayout:'print'`. Canvas libraries only print what is drawn. |
| Sensitivity tables (2D) | Row variable × column variable, base case boxed, diverging colour vs current price, optional live recompute | Hand-built (trivial); ECharts heatmap is an alternative visual but worse for print and copy |
| `file://` offline | UMD/IIFE classic script, no `fetch()`, no ESM, no WASM fetch, CSS bundled | Tabulator, AG Grid, S2, VTable, DataTables 3, SlickGrid, Cheetah Grid all pass (§3); Perspective and RevoGrid fail or are unsuitable |
| User formulas and metrics; LLM in Step 2 | Calculated columns from expression strings and a declarative JSON table spec | Own `rk.expr.js` (already in kit) + optional `@formulajs/formulajs` for the Excel function catalogue; Perspective ExprTK in served mode |

---

## 2. 版本 / 许可证 / 体积核验总表 (verified 2026-10-14)

`gz` = gzip -9 of the main UMD/IIFE file actually downloaded from jsDelivr. Stars are approximate (ecosyste.ms).

| Library | npm pkg | Latest | Published | License | Classic-script build for `file://` | gz | Stars | Render |
|---|---|---|---|---|---|---|---|---|
| Tabulator | `tabulator-tables` | **6.6.1** | 2026-09-30 | MIT | `dist/js/tabulator.min.js` (UMD, global `Tabulator`, all modules) + `dist/css/*.min.css` | ~103 KB | ~7.8k (repo moved to `tabulator-tables/tabulator`) | DOM (virtual) |
| AG Grid Community | `ag-grid-community` | **36.2.0** | 2026-09-16 | MIT | `dist/ag-grid-community.min.js` (UMD, global `agGrid`, CSS-in-JS themes) | ~522 KB | ~15.6k | DOM (virtual) |
| AG Grid Enterprise | `ag-grid-enterprise` | 36.2.0 | 2026-09-16 | **Commercial** | UMD available, but needs a licence key; watermark without one | n/a | (same repo) | DOM |
| AntV S2 | `@antv/s2` | **2.7.2** | 2026-06-10 | MIT | `dist/s2.min.js` (UMD, global `S2`) + `dist/s2.min.css` | ~310 KB | ~1.7k | Canvas (AntV G) |
| VisActor VTable | `@visactor/vtable` | **1.26.8** | 2026-09-11 | MIT | `dist/vtable.min.js` (UMD, global `VTable`) | ~544 KB | ~3.7k | Canvas (VRender) |
| VTable plugins / export | `@visactor/vtable-plugins` / `-export` | 1.26.8 | 2026-09-11 | MIT | `dist/vtable-plugins.min.js` (~358 KB gz); `vtable-export` now deprecated in favour of plugins | ~358 KB | — | — |
| Perspective (new scope) | `@perspective-dev/viewer`, `/client`, `/viewer-datagrid` | **5.6.0** | 2026-10-14 | Apache-2.0 | **None.** `dist/cdn/*.js` are ESM with top-level `await` + `fetch(new URL('../wasm/…wasm', import.meta.url))` | viewer ~25 KB + WASM 1.6 MB (raw) + client WASM 0.6 MB | ~11.3k (`perspective-dev/perspective`) | DOM grid + WebGL charts |
| Perspective (old scope) | `@finos/perspective*` | 3.8.0 | 2025-09-03 | Apache-2.0 | frozen; superseded by `@perspective-dev` | — | — | — |
| DataTables | `datatables.net` | **3.1.4** | 2026-10-13 | MIT | `js/dataTables.min.js` (UMD, `window.DataTable`), **no jQuery needed since v3** | ~42 KB | ~7.4k | DOM |
| DT extensions | `datatables.net-buttons` 4.1.2, `-fixedcolumns` 6.1.1, `-fixedheader` 5.1.2, `-rowgroup` 2.1.1, `-columncontrol` 2.1.2 | — | 2026-09/10 | MIT (Editor = commercial) | UMD per extension | Buttons ~17 KB, FixedColumns ~2.5 KB | — | — |
| Grid.js | `gridjs` | 6.2.0 | **2024-03-03** | MIT | `dist/gridjs.umd.js` | ~17 KB | ~4.7k | DOM |
| TanStack Table | `@tanstack/table-core` | **9.3.1** | 2026-10-12 | MIT | **v9 is ESM-only** (`"type":"module"`). v8.21.3 still has `build/umd/index.production.js` (~15 KB gz) | — | ~28.5k | headless |
| Handsontable | `handsontable` | 18.1.2 | 2026-10-07 | **Proprietary** ("SEE LICENSE IN LICENSE.txt"; non-commercial key `non-commercial-and-evaluation`) | `dist/handsontable.full.min.js` | ~449 KB | ~22k | DOM |
| HyperFormula | `hyperformula` | 3.5.0 | 2026-10-09 | **GPL-3.0-only** (or commercial) | — | — | ~2.8k | engine |
| RevoGrid | `@revolist/revogrid` | 4.28.3 | 2026-10-05 | MIT core; **Pro = commercial** | Stencil web components: `dist/revo-grid/*.esm.js` + lazy chunks. **No UMD**; `loader/cdn.js` is CJS | — | ~3.4k | DOM (virtual) |
| Glide Data Grid | `@glideapps/glide-data-grid` | 6.0.3 (beta 6.0.4-alpha24 on 2025-10-08) | **2024-02-03** | MIT | **React-only** ESM/CJS | — | ~5.4k | Canvas |
| SlickGrid (6pac) | `slickgrid` | **5.20.2** | 2026-09-17 | MIT | `dist/browser/slick.*.js` IIFE (core + interactions + dataview + grid); **needs SortableJS** global | grid ~73 KB + core/dataview | ~2.1k | DOM (virtual) |
| Cheetah Grid | `cheetah-grid` | 2.2.0 | 2026-08-20 | MIT | `dist/main.umd.js` (global `cheetahGrid`) + `dist/main.css` (warns if missing) | ~86 KB | ~1.5k | Canvas |
| canvas-datagrid | `canvas-datagrid` | 0.26.0 | 2026-09-20 | BSD-3-Clause | UMD | — | ~1.6k | Canvas |
| Frappe DataTable | `frappe-datatable` | 1.21.2 | 2026-09-23 | MIT | UMD (+ deps) | — | ~1.3k | DOM |
| simple-datatables | `simple-datatables` | 10.3.0 | 2026-07-30 | **LGPL-3.0** | UMD | — | ~1.6k | DOM |
| PivotTable.js | `pivottable` | 2.23.0 | **2018-11-04** | MIT | `dist/pivot.min.js` (~9 KB gz) + **jQuery + jQuery UI** | ~9 KB (+ jQuery) | ~4.4k | DOM |
| react-pivottable | `react-pivottable` | 0.11.1 | 2026-03-13 | MIT | React only | — | — | DOM |
| WebDataRocks | `webdatarocks` | 1.4.9 | 2023-10-19 | **Proprietary EULA** (free; OEM/SaaS redistribution banned), ~1 MB data cap | UMD | — | — | DOM |
| Flexmonster | `flexmonster` | 2.9.140 | 2026-10-12 | **Commercial** | UMD | — | — | DOM |
| Jspreadsheet CE | `jspreadsheet-ce` | 5.0.4 | 2025-08-25 | MIT (LICENSE file; npm field blank) | UMD | — | ~7.2k | DOM |
| Univer | `@univerjs/presets` / `@univerjs/core` | 1.0.4 | 2026-10-10 | Apache-2.0 | per-package `lib/umd/index.js` (core alone ~490 KB raw; many packages) | large | ~22.6k | Canvas |
| Formula.js | `@formulajs/formulajs` | 4.6.1 | 2026-07-28 | MIT | `lib/browser/formula.min.js` (~45 KB gz) | ~45 KB | ~0.8k | — |
| SheetJS CE | `xlsx` | **0.20.3 on cdn.sheetjs.com**; npm stuck at 0.18.5 (2022) | 2024 (CDN) | Apache-2.0 | `xlsx.full.min.js` (~334 KB gz incl. codepages) / `xlsx.mini.min.js` (~86 KB gz) | 86–334 KB | ~36k | — |
| write-excel-file | `write-excel-file` | **4.1.1** | 2026-06-08 | MIT | `bundle/write-excel-file.min.js` (UMD, global `writeXlsxFile`) | **~19 KB** | (GitLab) | — |
| ExcelJS | `exceljs` | 4.4.0 | 2023-10-19 | MIT | `dist/exceljs.min.js` | ~256 KB | ~15.5k | — |
| xlsx-js-style | `xlsx-js-style` | 1.2.0 | 2022-04-05 | Apache-2.0 | fork of SheetJS 0.18 with styles; **stale + inherits CVEs** | — | — | — |
| jsPDF / AutoTable | `jspdf` 4.2.1 / `jspdf-autotable` 5.0.8 | — | 2026-03 / 2026-05 | MIT | `dist/jspdf.umd.min.js` (~132 KB gz) / `dist/jspdf.plugin.autotable.min.js` | ~132 + ~10 KB | ~31k / ~2.5k | — |
| JSZip / pdfmake (DT Buttons deps) | `jszip` 3.10.2 / `pdfmake` 0.3.11 | — | — | (MIT OR GPL-3.0) → choose MIT / MIT | UMD | — | — | — |
| SortableJS (SlickGrid dep) | `sortablejs` | 1.15.7 | 2026-02-11 | MIT | `Sortable.min.js` | small | — | — |
| Observable Inputs (`Inputs.table`) | `@observablehq/inputs` | 0.12.0 | 2024-08-27 | ISC | ESM | — | ~0.2k | DOM |

**Licence flags for client deliverables:**
- **Avoid:**
  - **HyperFormula:** GPL-3.0.
  - **simple-datatables:** LGPL-3.0. It is a weak copyleft, but out of policy.
  - **WebDataRocks:** proprietary, not OSI.
- **Commercial, reference only:**
  - **Handsontable:** non-commercial key only. Commercial production needs a paid key, and the non-commercial terms v3.0 (2026-01-22) give businesses a single 90-day evaluation.
  - **AG Grid Enterprise:** EULA, $999/dev perpetual + 1 year updates. The Bundle with AG Charts Enterprise is $1,498/dev.
  - **RevoGrid Pro:** Excel export, pivot, formulas, charts and cell merge are Pro; from $199/dev/yr.
  - **Flexmonster.**
- **JSZip** is dual-licensed (MIT OR GPL-3.0). Elect MIT and keep its LICENSE.

---

## 3. file:// 离线冒烟测试 (headless Chromium 141, Playwright 1.56)

**Method:**
- For each library, a local HTML page was loaded via `file:///…/pages/<lib>.html`.
- It used `<script src="../vend/…">` classic scripts plus a `data.js` that assigns `window.COMPS = [...]`, so the data was not fetched.
- Each page rendered a five-row comps table with a frozen first column, an "EV / EBITDA" column group and an aggregate row.
- Scratch files: `/tmp/claude-0/-home-user-visual-repo-202610/daf46e49-46d8-53fd-b25b-6ebd897edb84/scratchpad/t03/{pages,vend,scripts,shots}`.

| Library | Result | Notes / gotchas found |
|---|---|---|
| Tabulator 6.6.1 | ✅ 7 rows rendered (5 + top/bottom calc rows) | **Gotcha:** built-in `bottomCalc:'avg'` returns a **string**, already `toFixed(precision)`. A calc formatter doing `v.toFixed()` threw `v.toFixed is not a function`; use `+v`. Default `tabulator_simple` theme is close to a report look. |
| AG Grid Community 36.2.0 | ✅ | UMD auto-registers all Community modules (no `ModuleRegistry` call needed). Theme CSS is injected from JS, so no CSS file is needed offline. `pinnedBottomRowData` works in Community. |
| AntV S2 2.7.2 | ✅ (1 canvas) | **Gotcha:** the grand-total label defaulted to **"总计"** (Chinese locale). Call `S2.setLang('en_US')` (present in UMD) or override i18n. `conditions.background` works. |
| VTable 1.26.8 | ✅ (1 canvas) | `cellType:'sparkline'` and `'progressbar'` worked. Aggregation row is cut off unless you set `bottomFrozenRowCount`, as the docs say. Container width/height must be **integers**. Columns truncate with `...` unless `widthMode:'autoWidth'`. Progressbar text colour is faint by default. |
| DataTables 3.1.4 | ✅ (`typeof jQuery === 'undefined'`) | Confirms v3 is dependency-free as a classic script. |
| Grid.js 6.2.0 | ✅ | — |
| Cheetah Grid 2.2.0 | ✅ | Logs a warning if `main.css` is not loaded. |
| SlickGrid 5.20.2 | ✅ once SortableJS was loaded | **Gotcha:** `Sortable is not defined` without `Sortable.min.js` loaded first. |
| write-excel-file 4.1.1 | ✅ Blob ~3 KB | **Gotcha:** v4 API is `writeXlsxFile(data, opts).toBlob()` / `.toFile(name)`, not a bare Promise (README for v1–2 differs). |
| Perspective 5.6.0 | ❌ | `Access to script at 'file:///…/perspective-viewer.js' from origin 'null' has been blocked` (ESM over file://). Even inlined, it then `fetch()`es `.wasm`, which fails on `file://`. |

**Environment facts measured under `file://` in Chromium 141:**
- `window.isSecureContext === true`
- `navigator.clipboard.writeText` exists, so copy-to-clipboard buttons can work, with an `execCommand('copy')` fallback for other browsers
- `URL.createObjectURL(blob)` works (`blob:null/...`), so CSV/XLSX downloads via `<a download>` work
- `fetch('data.js')` → **"Failed to fetch"**

This confirms that data must ship as JS (`window.__RK_DATA__…`) or be inlined as `<script type="application/json">`.

---

## 4. 逐库评估

### 4.1 Tabulator 6.6.1: ✅ adopt as the interactive grid

- **Release cadence:**
  - 6.0 (2024-03) added the Spreadsheet module and range selection.
  - 6.3 (2024-09) added an import module and adaptive formatters/editors.
  - 6.4 (2026-03) added unit tests and fixes.
  - 6.5 (2026-06) added "smart/smarter" fuzzy filters and fixed tree-data child aggregation in column calcs.
  - 6.6.0 (2026-09-29) added the **range fill handle**. 6.6.1 (2026-09-30): `rangeEdited` emits changed cells.
  - Repo moved to the `tabulator-tables` GitHub org. Since 6.5 the git repo no longer holds `dist/`, but the npm package still ships `dist/js` and `dist/css`.
- **Features relevant to us:**
  - `frozen:true` columns, plus `frozenRows` (top only)
  - nested `columns` for multi-level headers, `headerFilter`, multi-column sort
  - `groupBy` (multi-level, functions) with `groupHeader` formatter
  - `dataTree`, `movableColumns`, `resizableColumns`, `clipboard`, `history` (undo), `selectableRange`, `spreadsheet` mode
  - pagination or virtual DOM, `persistence`, localisation
- **Column calcs:** `topCalc`/`bottomCalc` support `avg|max|min|sum|count|unique|concat` or a custom function (`values, data, params`).
  - `columnCalcs:'both'|'table'|'group'`; `groupClosedShowCalcs`; `getCalcResults()`; `recalc()`.
  - **Limitation:** only one top and one bottom calc row per column. For Mean + Median + High + Low, use either:
    - (a) a custom bottomCalc formatter that renders multiple lines, or
    - (b) a separate stats `<table>` or second Tabulator instance aligned below, or
    - (c) synthetic rows with `_stat:true`, a custom sorter that uses its `dir` argument to always keep them last, and a `rowFormatter` for styling.
  - For printed comps, (b) or the hand-built table is cleaner.
- **Conditional formatting:** via a `formatter` function that sets `cell.getElement().style`, or a `rowFormatter`.
  - Built-in formatters include `progress` (data bar), `star`, `tickCross`, `traffic`, `color`, `money` and `image`.
  - Sparklines need a custom formatter that returns an SVG string or element (our `rk.spark`).
- **Download** ([docs](https://tabulator.info/docs/6.3/download)):
  - Formats: `csv | json | jsonLines | html | xlsx | pdf` or a custom function. `downloadConfig` toggles column groups, row groups, calcs and data tree. CSV drops groups and calcs.
  - XLSX needs global `XLSX` (SheetJS): `sheetName`, `documentProcessing(workbook)`, `writeOptions`, multi-table `sheets`. The docs describe **no cell styling** for XLSX.
  - PDF needs `jspdf` + `jspdf-autotable`. The docs' example pins jsPDF **2.4.0** + AutoTable **3.5.20**, so test before pairing with jsPDF 4.x / AutoTable 5.x.
  - `downloadEncoder` can intercept the Blob.
- **Print** ([docs](https://tabulator.info/docs/6.3/print)):
  - `printAsHtml:true` renders a full static HTML table for print, so browsers repeat headers. Without it, **only the viewport's virtual rows print**.
  - Other options: `printStyled`, `printRowRange: visible|active|selected|all|fn` (docs advise ≤ ~1,000 rows), `printConfig` (columnGroups/rowGroups/columnCalcs/dataTree/formatCells), `printHeader/printFooter`, `formatterPrint`.
- **Verdict:**
  - Best balance of MIT licence, classic script, DOM rendering (print/copy/a11y) and a rich feature set.
  - Style it with a kit theme file (`kit/styles/rk-tabulator.css`) on top of `tabulator_simple.min.css`, using our fonts, `tabular-nums`, 11–12px, no vertical lines and a navy header.
  - Use it for long lists (transactions, holdings, bond tables), filtering and editing. **Do not** use it for the pitchbook-page comps.

### 4.2 AG Grid 36.2.0: Community (MIT) vs Enterprise (Commercial) 🟡 consider

Releases:
- v33 (2024-12): Theming API, module registry.
- v34 (2025-06).
- v35 (2025-12).
- v36 (2026-06-24): Calculated Columns, Show Values As, automatic column generation, Client-Side Row Model moved into core, `suppressContentVisibilityAuto` now defaults to `true`, TS ≥ 5.8.3.
- 36.1 (2026-08-05): column header edit, AI coding skill, docs in Markdown.
- 36.2 (2026-09-16).
- `v32-lts` dist-tag = 32.3.9.

Feature split from [license-pricing](https://www.ag-grid.com/license-pricing/) and [community-vs-enterprise](https://www.ag-grid.com/javascript-data-grid/community-vs-enterprise/):

| Feature | Community | Enterprise |
|---|---|---|
| Sorting, filtering (text/number/date), pagination, cell renderers, themes, virtualisation | ✅ | ✅ |
| Column groups (multi-level headers), column pinning | ✅ | ✅ |
| Pinned rows (`pinnedTopRowData`/`pinnedBottomRowData`) | ✅ (verified on [row-pinning](https://www.ag-grid.com/javascript-data-grid/row-pinning/)) | ✅ |
| CSV export, undo/redo, basic cell editors | ✅ | ✅ |
| SSRM basic (sort/filter/selection/pagination) | ✅ | ✅ |
| Row grouping, aggregation, pivoting, tree data, master/detail | ❌ | ✅ |
| Set filter, multi filter, advanced filter | ❌ | ✅ |
| **Excel export**, clipboard operations, cell range selection, fill handle | ❌ | ✅ |
| **Sparklines** | ❌ | ✅ |
| Formulas, calculated columns (v36), Find, status bar, tool panels, row numbers, batch editing | ❌ | ✅ |
| Integrated charts | ❌ | Bundle only |

Notes:
- **UMD use:** `agGrid.createGrid(el, gridOptions)`. The UMD build needs no module registration (verified).
- **Print:** `domLayout:'print'` (Community) renders all rows for printing.
- **Conditional formatting:** `cellClassRules` / `cellStyle` (Community). Inline bars or sparklines come from custom `cellRenderer` with our SVG (Community), which avoids the Enterprise sparklines.
- **Comps stats rows:** compute Mean/Median/High/Low in JS on `filterChanged`/`rowDataUpdated` (`api.forEachNodeAfterFilter`) and set `pinnedBottomRowData` (multiple rows OK). They stay out of sort and filter. This is cleaner than Tabulator for stats.
- **Risks:**
  - ~522 KB gz.
  - "Accidentally Enterprise": the Enterprise bundle shows a watermark and console error without a key, so vendor only `ag-grid-community`.
  - Heavy API surface. Theming API differs from the legacy CSS themes.
- **Verdict:** consider as an alternative to Tabulator when row counts are very large (≥100k), or when the client already standardises on AG Grid. Not needed for the default kit.

### 4.3 AntV S2 2.7.2 (Ant Group): ✅ adopt as optional pivot module (lazy)

- **What it is:** a "multi-dimensional cross-analysis table" engine on AntV G canvas, with `PivotSheet` and `TableSheet`.
  - v2 (2024–) moved to G 6. `v1-latest` = 1.56.4. 2.7.2 published 2026-06-10.
  - Core package is framework-free. React/Vue wrappers are separate.
- **Pivot:**
  - `fields: { rows, columns, values }`, grid or tree hierarchy, collapse/expand, drill-down, custom headers
  - sort by measure or group sort, pagination, frozen rows/cols, merge cells, editable mode
- **Totals:**
  - `totals.row|col.{showGrandTotals, showSubTotals, reverseGrandTotalsLayout, subTotalsDimensions, calcGrandTotals|calcSubTotals: { aggregation: 'SUM'|'MIN'|'MAX'|'AVG'|'COUNT', calcFunc }}`
  - Grouped totals by dimension.
  - Median needs `calcFunc` (custom), or pre-computed totals passed in `data`.
  - Source: [totals.en.md](https://github.com/antvis/S2/blob/next/s2-site/docs/manual/basic/totals.en.md).
- **Conditional formatting** (`conditions`):
  - `text`, `background`, `interval` (in-cell bar chart; custom `minValue/maxValue/isCompare`), `icon` (`position: left|right`)
  - `field` accepts a regex. `mapping(value, data, cell)` returns a style.
  - Data cells support all four. Headers support text, background and icon.
  - Source: [conditions.en.md](https://github.com/antvis/S2/blob/next/s2-site/docs/manual/basic/conditions.en.md).
- **Mini charts:**
  - Built in, with no G2 dependency, for `line`, `bar` and `bullet`. Replace a value with `{ values: { type:'line', data, encode } }`.
  - Full G2 charts in cells via `@antv/g2` (heavier).
  - Source: [chart-in-cell.en.md](https://github.com/antvis/S2/blob/next/s2-site/docs/manual/advanced/cell-render/chart-in-cell.en.md).
- **Export:**
  - `interaction.copy`, `withFormat`, `withHeader`, brush selection copy.
  - `asyncGetAllPlainData` (present in UMD) → CSV/TSV string. No XLSX; pipe to write-excel-file.
  - HTML-format copy into rich editors.
- **Gotchas:**
  - Default locale zh_CN, so call `S2.setLang('en_US')`.
  - Canvas: the browser prints only what is painted, there is no Ctrl+F and screen readers are limited. Mitigate with `hd-adapter` (DPR) and "export image" for slides.
  - ~310 KB gz UMD (bundles G).
  - Docs site is a SPA, so read the markdown sources on GitHub `next` branch.
- **Verdict:** best open-source cross-tab for an interactive appendix ("Data Explorer": region × product × year). Load lazily only on pages that need it. Map our `TableSpec` to S2 `dataCfg`/`options`.

### 4.4 VisActor VTable 1.26.8 (ByteDance): 🟡 consider (alternative to S2, plus richer cells and animation)

- **Table types:**
  - `ListTable` (incl. tree list, group list, transpose)
  - `PivotTable` (tree or grid, custom header)
  - `PivotChart` (needs VChart)
  - Gantt, Calendar, and **VTable-Sheet** (multi-sheet with formula, filter and import/export)
- **Cell types:** text, link, image/video, **progressbar**, checkbox, radio, switch, button, **sparkline** (line only), **chart** (any VChart spec; `VTable.register.chartModule('vchart', VChart)`).
- **Data analysis:**
  - ListTable aggregation per column: `AggregationType.SUM|AVG|MAX|MIN|COUNT|CUSTOM` (+ `aggregationFun`, `formatFun`, `showOnTop`).
  - Combine with `bottomFrozenRowCount` to pin aggregate rows.
  - Filtering via `updateFilterRules`. Pivot has totals/subtotals and derived fields.
- **Frozen:** `frozenColCount`, `rightFrozenColCount`, `bottomFrozenRowCount`.
- **Style:** per-column `style`/`headerStyle` objects or functions (conditional), themes, custom render (JSX-like layout).
- **Motion:** `animationAppear: true | { type:'one-by-one'|'all', direction:'row'|'column', duration, delay }`, scroll animation, carousel. This is the only grid surveyed with built-in tasteful entry animation.
- **Export:**
  - `@visactor/vtable-export` is **deprecated**. Use `TableExportPlugin` in `@visactor/vtable-plugins` (`exportToCsv`, `exportToExcel` based on **ExcelJS** with `formatExcelJSCell` / `excelJSWorksheetCallback`).
  - UMD exists, but plugins are ~358 KB gz on top of the ~544 KB core.
  - `exportImg()` / `exportCellImg()` exist in the core.
- **Gotchas:**
  - Container size must be integer pixels.
  - Auto-width needs `widthMode`.
  - Canvas print and a11y limits, the same as S2.
  - Heaviest of the surveyed MIT options.
  - The docs English is machine-translated in places. Source markdown is at `github.com/VisActor/VTable/tree/develop/docs/assets/guide/en/`.
- **Verdict:** pick VTable instead of S2 if one canvas engine should cover big list grids + pivot + in-cell charts + entry animation and a heavy bundle is acceptable. Otherwise S2 for pivot, and Tabulator plus hand-built tables for lists.

### 4.5 Perspective 5.6.0 (`@perspective-dev/*`): 📚 reference now, adopt in Step 2 "served mode"

- **Status:**
  - The npm scope moved from `@finos/perspective*` (frozen at 3.8.0, 2025-09) to `@perspective-dev/*` (5.6.0 on 2026-10-14).
  - The GitHub repo is now `perspective-dev/perspective` (~11.3k stars). Licence Apache-2.0.
  - `@perspective-dev/viewer-d3fc` lags at 4.4.1.
- **Engine:**
  - C++ → WASM streaming query engine (memory64 build for >4 GB) with group-by/split-by pivots.
  - ExprTK-based **expression columns**: users type formulas, which matches our "client types their own metric" need.
  - Reactive joins. Virtual servers for DuckDB/ClickHouse ("delegates to a database you already have"). Python, Node and Rust hosts.
- **Why not in the double-click report:**
  - `dist/cdn/perspective-viewer.js` is an ES module with top-level `await` and `fetch(new URL('../wasm/perspective-viewer.wasm', import.meta.url))`. The client does the same for `perspective-server.wasm`.
  - Chrome blocks ESM from `file://` (origin `null`), which was verified, and `fetch` of local files fails.
  - Work-arounds (inline base64 WASM + inline module) are fragile and add about 2 MB+.
- **Verdict:** design the data layer (`RK.data` datasets + expression strings) so that a future "served mode" can swap in Perspective for big or streaming tables. Keep it out of the offline kit.

### 4.6 DataTables 3.1.4: 🟡 consider (progressive enhancement of server-rendered HTML)

- **v3.0.0 (2026-07-22)** removed the jQuery dependency.
  - It still registers as a jQuery plugin if jQuery is present.
  - TypeScript port, new `DataTable.Dom` helper, grouped column search (`search.columns`), `language.ajax`.
  - **Breaking:** jQuery-only selectors (`:contains`, `:gt`, …) no longer work.
  - Sources: [releases/3/new](https://datatables.net/releases/3/new), [blog: DataTables 3 beta](https://datatables.net/blog/2026/datatables-3-beta).
- **UMD verified:** `js/dataTables.min.js` sets `window.DataTable`, ~42 KB gz, works with `typeof jQuery === 'undefined'`.
- **Strength:** it **enhances an existing `<table>`**. The Python builder can emit a complete, semantic, print-ready table (readable with JS disabled), and DataTables adds sort, search and paging.
- **Extensions (MIT):** FixedColumns 6.1.1, FixedHeader 5.1.2, RowGroup 2.1.1, Buttons 4.1.2 (CSV, Excel via JSZip, PDF via pdfmake, print view), ColumnControl 2.1.2, SearchPanes 2.3.5. Editor 3.1.1 is commercial.
- **Weaknesses:**
  - Its look is opinionated (`dataTables.dataTables.css`), so it needs a theme pass.
  - `<tfoot>` stats rows are supported (footerCallback), but there are no built-in median/percentile calcs.
  - Each extension adds size and configuration.
- **Verdict:** a viable alternative to our own enhancer for sort and search on static HTML. Our hand-built enhancer can do the same in < 5 KB, so DataTables is "consider" if we need paging/search/FixedHeader quickly.

### 4.7 Grid.js 6.2.0: ⛔ avoid

MIT, tiny (~17 KB gz UMD) and simple: search, sort, pagination, server-side. But there have been no releases since **2024-03-03**. It has no frozen columns, no grouping and no calcs. Our hand-built table covers more.

### 4.8 TanStack Table 9.3.1: 📚 reference

- v9 stable since 2026-08-04 (9.3.1 on 2026-10-12).
  - Tree-shakable feature plugins on TanStack Store.
  - New cell (range) selection and cell spanning.
  - Better aggregation, pinning and resizing.
  - Ten framework adapters + `@tanstack/table-core`.
  - **ESM-only** (`"type":"module"`, no UMD).
  - Source: [announcing v9](https://tanstack.com/blog/announcing-tanstack-table-v9).
- v8.21.3 still ships a UMD (`build/umd/index.production.js`, ~15 KB gz) usable as a headless state engine (row models: sorted, filtered, grouped, aggregated, expanded) under `file://`.
- **Verdict:** use its architecture (row models, feature flags, state slices) as a design reference for `RK.Table`. We do not need the dependency.

### 4.9 Handsontable 18.1.2 + HyperFormula 3.5.0: 📚 reference only / ⛔ avoid

- **Handsontable** has a proprietary dual licence (`LICENSE.txt`). The non-commercial key is `'non-commercial-and-evaluation'`; commercial production needs a paid key. Non-commercial terms v3.0 (2026-01-22) cover Handsontable + HyperFormula, and businesses get **one 90-day non-production evaluation**.
- **HyperFormula** is **GPL-3.0-only** on npm, or commercial.
- It is the best Excel-like editing UX, but not allowed for client deliverables without purchase.

### 4.10 RevoGrid 4.28.3: ⛔ avoid (for this kit)

- The MIT core is free (with an attribution requirement per its licensing guide). **Pro** (Excel export/import, pivot, formulas, charts, cell merge) is commercial, from $199/dev/yr; the tiers for pivot are inconsistent across vendor pages.
- It is a Stencil web component. The dist has ESM lazy-loaded chunks (`dist/revo-grid/revo-grid.esm.js`) and a CJS loader, with **no UMD/IIFE**, so it is not `file://`-friendly without bundling.

### 4.11 Glide Data Grid 6.0.3: ⛔ avoid

MIT, canvas, very fast, but **React-only**. The last stable release was 2024-02-03 and the alpha 6.0.4-alpha24 came out on 2025-10-08. Wrong framework for a vanilla classic-script kit.

### 4.12 SlickGrid 5.20.2 (6pac): 🟡 consider (niche: huge lists, minimal deps)

- MIT, active (2026-09). Ships `dist/browser/*.js` IIFE builds, verified under `file://` **after loading SortableJS**.
- Features:
  - `frozenColumn` / `frozenRow`
  - column groups via pre-header panel
  - `DataView` grouping with aggregators (Avg/Sum/Min/Max/custom) and `GroupItemMetadataProvider`
  - very fast virtualisation, editors, plugins (cell copy manager, header menu, etc.)
- Weaknesses: dated API and look. XLSX export lives in the separate `slickgrid-universal` TS/ESM ecosystem. Tabulator is friendlier.

### 4.13 Cheetah Grid 2.2.0 / canvas-datagrid 0.26.0: 📚 reference

- **Cheetah Grid** is canvas, MIT, UMD `dist/main.umd.js` (~86 KB gz) + `main.css`, and verified. It supports multi-level headers and `frozenColCount`, and is fast for large lists, but has few analytics features (no grouping or calcs).
- **canvas-datagrid** is canvas, BSD-3, and spreadsheet-like.
- Both share the canvas print, copy and a11y limits. Not needed given Tabulator, S2 and VTable.

### 4.14 Frappe DataTable 1.21.2 / simple-datatables 10.3.0: ⛔ avoid

- **Frappe DataTable** is MIT and maintained, but tied to Frappe-ecosystem dependencies, with nothing unique to offer.
- **simple-datatables** is **LGPL-3.0**, which is out of licence policy.

### 4.15 PivotTable.js 2.23.0 / react-pivottable / WebDataRocks / Flexmonster: ⛔ avoid / 📚 reference

- **PivotTable.js** is MIT with a nice drag-and-drop pivot UX (heatmap renderers, "Table Barchart"). It needs **jQuery + jQuery UI** and has had no release since 2018-11. Useful only as a UX reference for a future "pivot builder" panel.
- **react-pivottable** 0.11.1 (2026-03) is React-only.
- **WebDataRocks** 1.4.9 (2023-10) is free under a **proprietary EULA**. OEM/SaaS redistribution is prohibited, there is a **~1 MB data limit** (vendor forum and 2026 comparison post), and it is not OSI. Avoid.
- **Flexmonster** 2.9.140 is commercial. Reference only.

### 4.16 Jspreadsheet CE 5.0.4 / Univer 1.0.4: 📚 reference (Step 2 "what-if" sheets)

- **Jspreadsheet CE** is MIT, with a spreadsheet UI and basic formulas. Pro features are commercial.
- **Univer** is Apache-2.0, a full canvas spreadsheet with a formula engine, and very active (~22.6k stars). It is a heavy multi-package build with per-package UMD (`@univerjs/core` `lib/umd/index.js` ~490 KB raw alone).
- Only relevant if clients must type formulas into a grid. For report tables, formula columns via `rk.expr` are lighter.

### 4.17 Export helpers

| Need | Pick | Why |
|---|---|---|
| CSV | **own** (`RK.export.csv`) | RFC-4180 quoting, `\r\n`, **UTF-8 BOM `﻿`** so Excel opens UTF-8 correctly, numbers raw (unformatted), optional formatted mode. Blob + `<a download>` works under `file://` (verified). |
| Styled XLSX (formats, bold stats, fills, frozen panes, merges, formulas) | **write-excel-file 4.1.1** (MIT, ~19 KB gz, `writeXlsxFile(rows, {columns, sheet, stickyRowsCount, stickyColumnsCount, orientation}).toBlob()/.toFile()`) | Cell options: `format` (Excel number format), `fontWeight`, `fontStyle`, `fontFamily`, `fontSize`, `textColor`, `backgroundColor`, `borderColor`/`borderStyle` (per side), `align`, `alignVertical`, `indent`, `wrap`, `textRotation`, `columnSpan`, `rowSpan`, `type:'Formula'`. Verified working under `file://`. No native Excel conditional-format rules (bake fills instead). |
| Real Excel conditional-format rules or reading templates | ExcelJS 4.4.0 (MIT, ~256 KB gz) | Full styling and CF rules, but last release 2023-10. |
| Reading client XLSX/CSV (import own data) | **SheetJS CE 0.20.3 from cdn.sheetjs.com** (`xlsx.mini.min.js` ~86 KB gz or `xlsx.full.min.js`) | Best reader. **npm `xlsx@0.18.5` is vulnerable:** CVE-2023-30533 (prototype pollution when reading, fixed 0.19.3) and CVE-2024-22363 (ReDoS, fixed 0.20.2). Both fixes exist only on the SheetJS CDN. CE does not write cell fills or fonts (Pro feature). Tabulator's XLSX download depends on global `XLSX`. |
| PDF | Browser Print → "Save as PDF" with print CSS (vector, exact fonts); Python builder can also run headless Chrome | jsPDF 4.2.1 + AutoTable 5.0.8 (MIT) only for a no-dialog "Download PDF" button. Fonts must be embedded via `addFileToVFS`; tables lose our CSS look. |

---

## 5. 功能矩阵 (✅ native · 🟡 via custom code or plugin · ❌ no · 💲 commercial tier)

| Need | Hand-built RK.Table | Tabulator 6.6 | AG Grid CE 36 | S2 2.7 | VTable 1.26 | DataTables 3.1 | SlickGrid 5.20 |
|---|---|---|---|---|---|---|---|
| Multi stats rows (mean/median/high/low, exclude target) | ✅ `<tfoot>` | 🟡 1 top + 1 bottom calc | ✅ `pinnedBottomRowData` (compute yourself) | 🟡 totals AVG/SUM…, median via `calcFunc` | 🟡 aggregation + `bottomFrozenRowCount` | 🟡 `footerCallback` | 🟡 group totals |
| Heat / conditional colours | ✅ | 🟡 formatter | 🟡 `cellClassRules`/`cellStyle` | ✅ `conditions.background` | ✅ style fn | 🟡 `createdCell` | 🟡 formatter |
| Data bars (incl. negative) | ✅ SVG/CSS | 🟡 `progress` (no neg axis) | 🟡 renderer | ✅ `conditions.interval` | ✅ progressbar | 🟡 | 🟡 |
| Sparklines in cells | ✅ inline SVG | 🟡 custom formatter | 🟡 renderer (native = 💲) | ✅ mini line/bar/bullet | ✅ sparkline/chart | 🟡 | 🟡 |
| Frozen cols / sticky header | ✅ sticky | ✅ | ✅ | ✅ | ✅ | ✅ (FixedColumns/FixedHeader) | ✅ |
| Multi-level headers | ✅ colspan | ✅ | ✅ | ✅ | ✅ | ✅ (complex headers) | 🟡 pre-header |
| Sort / filter | 🟡 small code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Row grouping + subtotals | 🟡 | ✅ | 💲 | ✅ | ✅ | 🟡 RowGroup | ✅ |
| Pivot / cross-tab | ❌ | ❌ | 💲 | ✅ | ✅ | ❌ | ❌ |
| CSV | ✅ own | ✅ | ✅ | ✅ (copy/plain data) | ✅ plugin | ✅ Buttons | 🟡 |
| Styled XLSX | ✅ write-excel-file | 🟡 SheetJS (unstyled) | 💲 | 🟡 via our exporter | ✅ plugin (ExcelJS) | ✅ Buttons (JSZip) | 🟡 |
| Print (vector, all rows, repeated header) | ✅ | ✅ `printAsHtml` | ✅ `domLayout:'print'` | ❌ canvas | ❌ canvas (`exportImg`) | ✅ (DOM) | 🟡 |
| Copy into Excel/PPT, Ctrl+F, a11y | ✅ | ✅ | ✅ | 🟡 copy only | 🟡 copy only | ✅ | ✅ |
| Built-in entry animation | 🟡 (own CSS/WAAPI) | ❌ | 🟡 row animations | ❌ | ✅ `animationAppear` | ❌ | ❌ |
| `file://` classic script (verified) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (+Sortable) |
| gz weight | ~5–15 KB | ~103 KB | ~522 KB | ~310 KB | ~544 KB (+358) | ~42 KB (+ext) | ~90 KB |

---

## 6. 为什么投行 pitchbook 表格应该手写 (hand-built rationale)

1. **They are static and typeset, not interactive grids.** A GS or JPM comps page is 8–25 rows, 10–16 numeric columns, 2-row grouped headers, stats rows, footnotes and a source line. That is fewer than 500 cells. Virtualisation, editors and menus add nothing, and the libraries' CSS resets fight the look.
2. **Print and PDF fidelity.** Clients print and forward PDFs. DOM tables give vector text, repeated `thead` across pages and exact fonts. Canvas grids print only the painted viewport (as bitmaps), and virtual DOM grids print only visible rows unless switched into a special print mode.
3. **Copy and paste.** Bankers copy tables into Excel and PowerPoint. Native `<table>` HTML pastes with structure, while canvas grids need custom copy handlers.
4. **Typesetting details that libraries do not expose cleanly:**
   - phantom `)` alignment, NM/NA/– rules, `x` and `%` suffixes, superscript footnote markers inside numeric cells
   - group-header underlines with gaps, rule weights (thin vs medium), target-row highlight excluded from stats, and stats separator rules
5. **Zero dependency and tiny size.** It follows the kit philosophy (`kit/core/rk.*.js` classic scripts) and has no licence surface.
6. **Data/HTML separation is preserved.** The Python builder can either emit the full static `<table>` (so the page works without JS and prints) or emit an empty container plus `data/*.js` and a JSON `TableSpec` that `RK.Table` renders. Prefer **render-from-spec at runtime** (so data swaps re-render), and optionally pre-render a static fallback for noscript and print.

**Rule of thumb:**
- Fewer than ~2,000 rows, presentation-first → **RK.Table (hand-built)**.
- 2k–200k rows, exploration or editing → **Tabulator** (or AG Grid CE).
- Multi-dimensional slicing → **S2** (lazy).
- Streaming or very large data → **Perspective** (served mode).

---

## 7. Pitchbook 表格设计规范 (spec for RK.Table / RK.Sensitivity)

### 7.1 Visual conventions (GS / JPM / MS style comps)

- **Title block:**
  - Page title ("Selected Trading Comparables").
  - Unit line in italics: "($ in millions, except per-share data)".
  - "Market data as of 10-Oct-2026".
- **Header:**
  - Either a navy fill with white bold text, or no fill with a bold label and a 1px dark bottom rule.
  - Group header ("EV / EBITDA") centred over its child columns ("CY25E", "CY26E") with an **underline that leaves gaps between adjacent groups**.
- **Body:**
  - About 11–12px on screen (8–9pt printed), row height 18–22px, `white-space: nowrap`.
  - **No vertical gridlines.** Hairline horizontal rules, or none with zebra off.
  - Light separators between column groups (optional).
- **Peer groups:** sub-header rows ("Large-Cap Diversified") in bold or italic with a light tint. Each group can show its own Mean/Median.
- **Target company:** a highlighted row (light accent tint, bold), placed at the top or in its group, **excluded from stats**.
- **Stats rows:** "Mean", "Median" (often "High", "Low", sometimes 25th/75th percentile). Bold, with a single rule above. The block is separated from the body by a blank row or a medium rule. There is also an "Overall" block at the bottom.
- **Number formats:**
  - Multiples `12.3x`.
  - Percentages `15.2%`.
  - Currency `$1,234` (no decimals for $mm; per-share `$142.30`).
  - Negatives in parentheses `(3.4)` / `(3.4%)`, sometimes red.
  - Zero → `–` (en dash).
  - `NM` = not meaningful (negative denominators, multiples > 100x or < 0x, growth on negative base).
  - `NA` = not available.
  - Right-aligned, **tabular figures**.
- **Footnotes:** numbered superscripts in cells and on company names. A source line: "Source: FactSet, company filings. Note: Multiples > 100x shown as NM."
- **Heat colouring:**
  - Usually muted and low saturation, per column (e.g., green = cheap and red = expensive for valuation multiples, reversed for growth and margins).
  - Banks often avoid heat colour on the main comps page and use it in appendix or "benchmarking" tables. Make it opt-in per column.

### 7.2 CSS sketch (tokens assumed from the kit theme)

```css
.rk-table { border-collapse: separate; border-spacing: 0;               /* sticky + collapse loses borders */
  font: 400 12px/1.35 var(--rk-font-sans);
  font-variant-numeric: tabular-nums lining-nums;                       /* or font-feature-settings:"tnum" 1,"lnum" 1 */
  color: var(--rk-ink); background: var(--rk-surface); }
.rk-table th, .rk-table td { padding: 3px 8px; white-space: nowrap; }
.rk-table td.num, .rk-table th.num { text-align: right; }
/* phantom paren: positives reserve the width of ")" so decimals align with "(3.4)" */
.rk-table td.num.pos::after, .rk-table td.num.zero::after { content: ")"; visibility: hidden; }
.rk-table td.nm { color: var(--rk-ink-muted); }
/* header */
.rk-table thead th { position: sticky; top: 0; z-index: 2; background: var(--rk-head-bg); color: var(--rk-head-ink);
  font-weight: 600; border-bottom: 1px solid var(--rk-rule-strong); }
.rk-table thead th.grp { text-align: center; border-bottom: 0;
  background-image: linear-gradient(var(--rk-rule-strong), var(--rk-rule-strong));
  background-size: calc(100% - 12px) 1px; background-position: center bottom; background-repeat: no-repeat; } /* underline with gaps */
/* frozen first column */
.rk-table .stick { position: sticky; left: 0; z-index: 1; background: inherit; }
.rk-table thead .stick { z-index: 3; }
/* rows */
.rk-table tbody tr + tr td { border-top: 1px solid var(--rk-rule-hair); }
.rk-table tr.peer-head td { font-weight: 600; font-style: italic; background: var(--rk-tint-1); }
.rk-table tr.target td { background: var(--rk-accent-tint); font-weight: 600; }
.rk-table tfoot tr.stat td { font-weight: 600; }
.rk-table tfoot tr.stat:first-child td { border-top: 1px solid var(--rk-rule-strong); }
.rk-table sup.fn { font-size: 0.7em; vertical-align: super; line-height: 0; }
@media print {
  .rk-table thead th, .rk-table .stick { position: static; }
  .rk-table thead { display: table-header-group; }      /* repeat header per page */
  .rk-table tr { break-inside: avoid; }
  .rk-table, .rk-table * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } /* keep heat fills */
  .rk-table * { animation: none !important; transition: none !important; }
}
@media (prefers-reduced-motion: reduce) { .rk-table * { animation: none !important; transition: none !important; } }
```

- **Fonts (bundled, OFL):** Inter, IBM Plex Sans, or Source Sans 3. All have `tnum`/`lnum` features. Ship WOFF2 in `vendor/fonts/`. Arial or Frutiger look like a bank, but are not redistributable (Frutiger) or not consistent across platforms.
- **Decimal alignment:** CSS `text-align: "."` is not implemented in browsers. Use right-align, fixed decimals per column, tabular numbers and the phantom-paren trick.
- **Sticky with collapse:** `border-collapse: collapse` + sticky cells loses the header borders when scrolling. Use `separate` + `border-spacing: 0` and draw rules on cells, or use `box-shadow` for the header bottom rule.
- **Print headers:** Chromium repeats `thead` per page (it applies `break-inside: avoid` to `thead` by default). Safari has had issues, so test it.

### 7.3 Heat colours: implementation notes

- Compute per-column domain from **non-target, non-NM** values: min/max, or 5th–95th percentile to resist outliers.
- **Diverging around the median** for valuation multiples. Sequential for growth and margins.
- Interpolate in OKLab/OKLCH for even perception. Modern CSS `color-mix(in oklab, …)` works in Chromium/Firefox/Safari 16.2+, or compute in JS.
- Keep the palette muted (e.g., L≈0.92–0.80 range in OKLCH) so black text stays readable. Flip text to white when the relative luminance of the fill is below ~0.45.
- Always offer a **legend or caption** ("Shading: green = below peer median") and a toggle to switch heat off (screen) and on (print).
- Export: bake the computed fill into XLSX `backgroundColor` (write-excel-file).

### 7.4 In-cell micro-charts (`rk.spark`, inline SVG)

| Type | Encoding | Implementation |
|---|---|---|
| Sparkline (trend) | position (line), last-point dot, min/max dots | `<svg viewBox="0 0 64 16" preserveAspectRatio="none"><polyline vector-effect="non-scaling-stroke" …/></svg>`, 60–80×14px |
| Data bar (two-sided) | length from a zero axis, colour by sign | absolutely positioned `<span>` (or SVG `<rect>`) with `left: zero%`, `width: |v|%`; axis tick at zero; value text overlay or adjacent |
| Bullet | bar = actual, tick = target/consensus, bands = ranges | SVG rects plus a line |
| Win/loss | up/down blocks per period | SVG rect grid |
| Range / 52-week position | dot on a min–max track (e.g., % of 52-week high) | SVG line plus a circle |
| Icon / arrow | direction of change, rating | inline SVG symbols (no icon font) |

- **Do not** create one ECharts instance per cell. It is memory-heavy and slow above ~50 instances. ECharts is fine for a single heatmap or sensitivity chart outside the table.
- SVG stays vector in print and inherits `currentColor` for theming.

### 7.5 Sensitivity table (2D)

- **Layout:**
  - A corner cell with axis titles ("WACC ↓ / Terminal growth →"), column header values and row header values.
  - Base case in the centre, **boxed** (`outline: 2px solid var(--rk-accent); outline-offset: -2px`) and bold.
  - Optional second variant "Premium / (discount) to current price" with diverging fill (green above current, red below).
- **Data:**
  - Preferably computed in Python, giving a full grid `values[i][j]` + `rowAxis` + `colAxis` + `base:{i,j}` + `format`.
  - Optional live mode: a `formula` string (`rk.expr`) + `steps` so the client can re-centre or re-step the axes with small steppers and see the grid recompute. This shows the "dynamic re-render" requirement with tasteful cross-fade.
- **Typical sets:**
  - DCF: WACC × terminal growth (or exit multiple).
  - LBO: entry multiple × exit multiple → IRR/MOIC.
  - Accretion/dilution: % stock × premium.
- Export maps cleanly to XLSX (fills + bold base cell) and prints as a normal table.

### 7.6 Motion for tables (tasteful)

- **Sort / filter reorder:** FLIP (record `getBoundingClientRect` before and after, then `el.animate([{transform:'translateY(dy)'},{transform:'none'}], {duration:240, easing:'cubic-bezier(.2,.7,.2,1)'})`).
- **Stats rows:** re-computed values **cross-fade** (160ms). Avoid count-up animations on dense numeric tables because they are distracting. Reserve count-up for KPI tiles.
- **Heat fill:** fade `background-color` with `transition: background-color .3s`. Data bars grow from 0 on first reveal (IntersectionObserver), staggered 15–25ms per row and capped at about 400ms total.
- **Row hover:** 1px accent left bar plus a subtle tint. Highlight the corresponding chart mark via `RK.bus` (cross-highlighting).
- Respect `prefers-reduced-motion`. Disable all motion in `@media print`.
- VTable's `animationAppear` (one-by-one by row or column) is the reference for "entry" motion if a canvas grid is used.

---

## 8. 公式 / 自定义指标 / LLM (Step 2) 与表格

- **Calculated columns:** `{ key:'ev_ebitda_26', label:'EV / EBITDA CY26E', expr:'ev / ebitda_26', fmt:'multiple', nm:'v<0 || v>100' }`.
  - Evaluate with the existing `kit/core/rk.expr.js` (no `eval`; parse to an AST, whitelist functions).
  - Re-render the column, recompute stats and heat domain.
  - Client-typed formulas reuse the same path.
- **Function catalogue:** implement core statistics in-house (MEAN, MEDIAN, PERCENTILE, STDEV, MIN, MAX, RANK, CAGR, IFERROR). Optionally map Excel names to **@formulajs/formulajs 4.6.1** (MIT, UMD `lib/browser/formula.min.js` ~45 KB gz) for finance functions (NPV, XNPV, IRR, XIRR, PMT) if users expect Excel parity. **Do not** use HyperFormula (GPL).
- **Querying:** a small filter/query bar (`sector = "Software" and ev > 5000`) parsed by `rk.expr` → predicate → `RK.data` filter → `RK.bus.emit('filter', …)`, so charts and tables update together.
- **LLM-friendly `TableSpec` (JSON):** a declarative spec that an LLM can write or modify without touching code.

```json
{ "type": "comps", "dataset": "comps_2026q3", "title": "Selected Trading Comparables",
  "units": "($ in millions, except per share data)", "asOf": "2026-10-10",
  "rowKey": "ticker", "highlight": { "where": "ticker == 'TGT'" }, "groupBy": "peer_group",
  "columns": [
    { "key": "name", "label": "Company", "sticky": true },
    { "group": "EV / EBITDA", "columns": [
      { "key": "ev_ebitda_25", "label": "CY25E", "fmt": "multiple", "nm": "v < 0 || v > 100", "heat": { "scheme": "diverging", "reverse": true } },
      { "key": "ev_ebitda_26", "label": "CY26E", "fmt": "multiple", "nm": "v < 0 || v > 100" } ] },
    { "key": "trend_8q", "label": "Rev. trend", "cell": "sparkline" },
    { "key": "pct_52w_high", "label": "% 52W High", "fmt": "pct0", "cell": "range" }
  ],
  "stats": { "rows": ["mean", "median", "high", "low"], "exclude": "ticker == 'TGT'", "perGroup": ["mean", "median"] },
  "footnotes": ["Multiples > 100x or negative shown as NM."], "source": "FactSet; company filings",
  "export": ["csv", "xlsx"], "interactions": { "sort": true, "filterChips": "peer_group", "crossFilter": true } }
```

- The same `TableSpec` can be **adapted** to Tabulator (`columns`, `groupBy`, `bottomCalc`), AG Grid CE (`columnDefs`, `pinnedBottomRowData`) or S2 (`fields`, `conditions`, `totals`). Keep the adapters thin and optional.

---

## 9. 推荐栈与落地计划

### 9.1 Stack

| Layer | Choice | Ship how |
|---|---|---|
| Presentation tables (comps, precedents, financial summary, league tables, sensitivity) | **`RK.Table`, `RK.Sensitivity`, `rk.spark` (own)** | `kit/components/rk.table.js` + `kit/styles/rk.table.css` (classic script, IIFE on `window.RK`) |
| Interactive large or editable grid | **Tabulator 6.6.1** (MIT) | `vendor/tabulator/tabulator.min.js` + `tabulator_simple.min.css` + own `rk-tabulator.css` theme |
| Pivot / cross-tab explorer (optional, lazy) | **AntV S2 2.7.2** (MIT); alt **VTable 1.26.8** | `vendor/s2/s2.min.js` + `s2.min.css`; load only when the page contains an `RK.Pivot` |
| XLSX export (styled) | **write-excel-file 4.1.1** (MIT) | `vendor/write-excel-file/write-excel-file.min.js` (global `writeXlsxFile`) |
| XLSX/CSV import (client's own data) | **SheetJS CE 0.20.3** (Apache-2.0) from `cdn.sheetjs.com` (not npm) | `vendor/sheetjs/xlsx.mini.min.js` (or `full` if XLS/codepages needed) |
| Excel function parity (optional) | @formulajs/formulajs 4.6.1 (MIT) | `vendor/formulajs/formula.min.js` |
| PDF | Print CSS (+ headless Chrome in Python builder) | — |
| Big/streaming data (Step 2, served) | Perspective `@perspective-dev` 5.6.0 (Apache-2.0) | Not vendored in the offline kit. Used via local server or the Python host. |
| Alternatives kept on file | AG Grid Community 36.2.0 (MIT), DataTables 3.1.4 (MIT), SlickGrid 5.20.2 (MIT) | — |

### 9.2 Proposed `vendor/vendor.json` additions (for the vendoring step; *not applied here*)

```json
{ "id": "tabulator", "npm": "tabulator-tables", "version": "6.6.1", "license": "MIT",
  "repo": "https://github.com/tabulator-tables/tabulator",
  "files": { "dist/js/tabulator.min.js": "tabulator.min.js", "dist/css/tabulator_simple.min.css": "tabulator_simple.min.css", "LICENSE": "LICENSE" } },
{ "id": "s2", "npm": "@antv/s2", "version": "2.7.2", "license": "MIT",
  "repo": "https://github.com/antvis/S2",
  "files": { "dist/s2.min.js": "s2.min.js", "dist/s2.min.css": "s2.min.css", "LICENSE": "LICENSE" } },
{ "id": "write-excel-file", "npm": "write-excel-file", "version": "4.1.1", "license": "MIT",
  "repo": "https://gitlab.com/catamphetamine/write-excel-file",
  "files": { "bundle/write-excel-file.min.js": "write-excel-file.min.js", "LICENSE": "LICENSE" } },
{ "id": "sheetjs", "url": "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js", "version": "0.20.3", "license": "Apache-2.0",
  "note": "npm 'xlsx' is stale (0.18.5, CVE-2023-30533, CVE-2024-22363); fetch from cdn.sheetjs.com" }
```

- Check that each package actually ships the `LICENSE` file name used above (e.g., `jspdf-autotable` uses `LICENSE.txt`). `tools/vendor.py` currently supports npm only, so SheetJS needs a URL source.

### 9.3 `RK.Table` feature checklist (MVP → v2)

- **MVP:**
  - spec → DOM; multi-level headers; sticky header and first column
  - formats (multiple, pct, currency, bps, number, NM/NA/–, parentheses, phantom paren)
  - target highlight; stats tfoot (mean/median/high/low/percentile; exclude rule); peer-group sections with group stats
  - footnotes and source; per-column heat (opt-in) + legend; sparkline/bar/range/bullet cells
  - sort (stats pinned) with FLIP; CSV + XLSX export; print CSS; `RK.bus` cross-highlight and filter; data-change re-render
- **v2:**
  - column show/hide; filter chips/query bar via `rk.expr`; calculated columns typed by the client
  - copy-as-TSV/HTML; per-row drill-down (expand a detail row); keyboard navigation (roving tabindex)
  - `aria-sort`, `<caption>`, `scope`
- **Performance:**
  - Up to ~2k rows × 20 cols renders in < 50ms with string building + `innerHTML` (single write).
  - Beyond that, switch to Tabulator (virtual DOM) automatically (`spec.engine: 'auto'`).

---

## 10. Gotchas 汇总

1. **`file://`:** no ESM imports, no `fetch()` of local JSON or WASM. Data must be `data/*.js` (`window.__RK_DATA__["comps"] = {...}`) or inline `<script type="application/json">`. Verified: `fetch` fails; Blob downloads and Clipboard API work (`isSecureContext` is true on `file://` in Chromium 141).
2. **Tabulator:**
   - Built-in calcs return **strings** (precision-formatted). Parse before custom formatting.
   - Only one top and one bottom calc per column.
   - XLSX has no styles (SheetJS CE).
   - Printing without `printAsHtml` prints only the virtual viewport.
   - PDF docs target jsPDF 2.4 / AutoTable 3.5.20.
   - Repo moved to the `tabulator-tables` org; no `dist/` in git since 6.5 (npm still has it).
3. **AG Grid:**
   - Community lacks grouping, aggregation, Excel export, sparklines, clipboard and range selection.
   - Do not vendor `ag-grid-enterprise` (watermark + console error without a key, and a licence breach in production).
   - v36 changed defaults (`suppressContentVisibilityAuto`).
4. **S2:**
   - zh_CN default strings ("总计"), so call `S2.setLang('en_US')`.
   - Canvas means no print, Ctrl+F or screen reader.
   - Mini charts accept only built-in line/bar/bullet without G2.
5. **VTable:**
   - Integer container size; `widthMode:'autoWidth'` for content-fit.
   - Aggregation rows need `bottomFrozenRowCount`.
   - `@visactor/vtable-export` is deprecated in favour of `@visactor/vtable-plugins` `TableExportPlugin` (+358 KB gz; ExcelJS-based).
   - The sparkline cell type supports only line.
6. **SlickGrid 5:** load **SortableJS** before `slick.grid.js`.
7. **Cheetah Grid:** load `main.css` or it warns.
8. **Perspective:**
   - Scope moved to `@perspective-dev` (old `@finos` frozen at 3.8.0).
   - ESM + WASM breaks `file://`.
   - The d3fc chart plugin lags (4.4.1).
9. **DataTables 3:** jQuery-only selectors removed. Extensions are versioned separately (Buttons 4.x, FixedColumns 6.x…). Buttons' Excel export needs JSZip (elect MIT); PDF needs pdfmake.
10. **SheetJS:**
    - Never `npm i xlsx` (0.18.5 vulnerable; CVE-2023-30533 / CVE-2024-22363). Use `cdn.sheetjs.com` 0.20.3.
    - CE writes values and number formats, not fills or fonts.
    - `xlsx.full.min.js` is about 334 KB gz because of codepages; prefer `mini` (~86 KB gz) unless legacy XLS is needed.
11. **write-excel-file v4:** the API returns a builder (`.toBlob()`, `.toFile()`), not a Promise. Date cells need a `format` or a sheet-level `dateFormat`.
12. **CSS:**
    - `border-collapse: collapse` + `position: sticky` loses borders.
    - Background colours do not print without `print-color-adjust: exact`.
    - Safari's `thead` repetition is unreliable.
    - `text-align: "."` is unsupported.
13. **Heat scales:** exclude the target and NM values from the domain. Clip at percentiles. Ensure text contrast and add a legend.
14. **Licence traps:** HyperFormula (GPL), simple-datatables (LGPL), WebDataRocks (EULA, 1 MB cap), Handsontable (proprietary), RevoGrid Pro, AG Grid Enterprise, Flexmonster. JSZip is dual MIT/GPL, so elect MIT.

---

## 11. Sources

- npm registry (`npm view`), queried 2026-10-14, for all versions, licences and dates in §2.
- jsDelivr package file listings (`https://data.jsdelivr.com/v1/packages/npm/<pkg>@<ver>?structure=flat`) and dist downloads (`https://cdn.jsdelivr.net/npm/...`).
- Star counts: `https://repos.ecosyste.ms/api/v1/hosts/GitHub/repositories/<owner%2Frepo>`.
- AG Grid feature split and pricing: https://www.ag-grid.com/license-pricing/ · https://www.ag-grid.com/javascript-data-grid/community-vs-enterprise/ · row pinning: https://www.ag-grid.com/javascript-data-grid/row-pinning/ · getting started (UMD): https://www.ag-grid.com/javascript-data-grid/getting-started/ · What's new / v36: https://www.ag-grid.com/whats-new/ , https://www.ag-grid.com/vue-data-grid/upgrading-to-ag-grid-36/ , https://www.ag-grid.com/vue-data-grid/upgrading-to-ag-grid-36-1/
- Tabulator: releases https://github.com/olifolkerd/tabulator/releases (now https://github.com/tabulator-tables/tabulator) · download https://tabulator.info/docs/6.3/download · print https://tabulator.info/docs/6.3/print · column calcs https://tabulator.info/docs/6.3/column-calcs
- DataTables 3: https://datatables.net/releases/3/new · https://datatables.net/releases/3/upgrade · https://datatables.net/blog/2026/datatables-3-beta · https://cdn.datatables.net/3.0.0/
- AntV S2 docs (markdown sources): https://github.com/antvis/S2/blob/next/s2-site/docs/manual/basic/conditions.en.md · https://github.com/antvis/S2/blob/next/s2-site/docs/manual/basic/totals.en.md · https://github.com/antvis/S2/blob/next/s2-site/docs/manual/advanced/cell-render/chart-in-cell.en.md · https://github.com/antvis/S2/blob/next/s2-site/docs/manual/advanced/analysis/export.en.md · site https://s2.antv.antgroup.com/
- VisActor VTable docs (markdown sources): https://github.com/VisActor/VTable/tree/develop/docs/assets/guide/en (cell_type/sparkline.md, cell_type/chart.md, data_analysis/list_table_dataAnalysis.md, export/excel.md, plugin/table-export.md, animation/appear_animation.md, Getting_Started/Getting_Started.md) · site https://visactor.io/vtable
- Perspective: https://github.com/perspective-dev/perspective (README) · https://perspective-dev.github.io · old docs https://perspective.finos.org/
- TanStack Table v9: https://tanstack.com/blog/announcing-tanstack-table-v9 · https://tanstack.com/table/latest/docs/framework/react/guide/migrating
- Handsontable licence: https://handsontable.com/docs/license-key/ · https://handsontable.com/static/licenses/non-commercial/v5/handsontable-non-commercial-license.pdf
- RevoGrid licensing and pricing: https://www.rv-grid.com/guide/licensing · https://rv-grid.com/pricing · https://rv-grid.com/pro/v1/
- WebDataRocks: https://www.webdatarocks.com/doc/intro/ · 1 MB limit threads https://www.webdatarocks.com/?p=6181 , https://www.webdatarocks.com/?p=3408 , https://www.webdatarocks.com/?p=15532 · EULA https://www.webdatarocks.com/?p=11785
- SheetJS: https://docs.sheetjs.com/docs/getting-started/installation/standalone · CVEs https://cdn.sheetjs.com/advisories/CVE-2023-30533.html , https://advisories.gitlab.com/npm/xlsx/CVE-2024-22363/ · npm-not-updated issue https://git.sheetjs.com/sheetjs/sheetjs/issues/2961
- write-excel-file README: https://gitlab.com/catamphetamine/write-excel-file (read via https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/README.md)
- Sticky table headers/columns and print header repetition: https://css-tricks.com/?p=342294 · Chromium commit "Display table header groups at the top of each page": https://chromium.googlesource.com/chromium/src/+/81c0fc6d4e08e4e2bb4eb8a42747f21b13303616 · Safari issue https://developer.apple.com/forums/thread/90140
- Local verification artefacts (scratch, not part of repo): `/tmp/claude-0/-home-user-visual-repo-202610/daf46e49-46d8-53fd-b25b-6ebd897edb84/scratchpad/t03/` (`pages/*.html`, `scripts/smoke.js`, `shots/*.png`).
