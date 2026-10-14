# 02 · 地理 / 地图可视化 (Geo / Map Visualization: Leaflet ecosystem deep dive): raw research notes

> Angle: `02-geo-maps` · Date: 2026-10-14 · Author: research sub-agent
> Scope: Leaflet 1.9 / 2.0 and its plugins for multi-dimensional business maps, compared with MapLibre GL JS, deck.gl, kepler.gl, AntV L7, ECharts geo, D3-geo / Observable Plot and OpenLayers. Offline (`file://`) basemap strategy, China-map compliance, and a concrete stack for five pitchbook map types.
>
> **How the facts were checked:**
> - **Versions, licences and publish dates:** npm registry (`npm view <pkg> version license time[...]`), checked 2026-10-14.
> - **Dist file lists:** `data.jsdelivr.com`.
> - **Gzip sizes:** downloaded each dist file and ran `gzip -9 | wc -c`.
> - **Stars and last push:** `repos.ecosyste.ms`.
> - **file:// smoke tests:** 17 local HTML pages opened via `file://` in headless Chromium (Playwright, `chromium-1194`, SwiftShader WebGL2).
>   - Each page renders a world choropleth, office bubbles, flows and density layers from the vendored `world-atlas` data.
>   - The runner logs JS errors, results, screenshots, and every outgoing `http(s)` request. Requests were blocked, to audit offline behaviour.
>   - Scratch pages live in the session scratchpad (`…/scratchpad/geo02/pages/*.html`). The key code snippets are copied into §2 and §6 below.
> - **Existing repo context:** ReportKit already vendors Leaflet 1.9.4, leaflet.heat, leaflet.markercluster, topojson-client, world-atlas and ECharts 6.1.0. It also has five Leaflet map components: `choropleth`, `bubble-map`, `flow-map`, `geo-heat` and `cluster-map` (`kit/core/rk.geo.js`). These notes validate that choice and list what to fix or add.

---

## 0. TL;DR: 结论与推荐栈

1. **Keep Leaflet 1.9.4 as the primary interactive map engine.** It is BSD-2-Clause, ~42 KB gzipped, and ships a classic UMD `dist/leaflet.js`.
   - Do **not** move to Leaflet 2.0 yet. It is still `2.0.0-alpha.1` (2025-08-16); there is no beta or rc, and 1.9.4 (2023-05-18) is still the "Latest" release on GitHub.
   - 2.0 removes the factory functions (`L.map`, `L.circleMarker`…) and is ESM-first. There is a `leaflet-global.js` classic build that still sets `window.L` and `window.leaflet`.
   - In my test, 1.x plugins break on 2.0. The official "Leaflet V1 Polyfill" fixes `leaflet.heat` and `markercluster`, but **not** `leaflet-ant-path`, which fails with `Class constructor … cannot be invoked without 'new'`.
2. **Use ECharts 6.1 `geo` / `map` as the second map engine (already vendored)** for "chart-like" maps. All of the following were verified offline:
   - choropleth with `visualMap` (drag-filter legend)
   - **pies placed on geo coordinates** (`series-pie.coordinateSystem:'geo'`)
   - `effectScatter` ripples, `lines` with travelling-trail effects, `heatmap` on geo, and `brush` lasso/rect selection on geo (→ cross-filter)
   - the SVG renderer for print
   - `projection: {project, unproject, stream}`, which takes any **d3-geo projection** (Equal Earth, Albers / Conic Equal-Area for China, Pacific-centred rotations)
   - universal-transition morph between map and bar (official example "Morphing between Map and Bar")
3. **d3-geo 3.1.1 + d3-geo-projection 4.0.0 (ISC) are the geometry utility layer.** They provide projections and **antimeridian cutting**.
   - **Critical bug found:** world-atlas TopoJSON is wound and stitched for *spherical* d3 rendering. Every planar renderer (Leaflet, MapLibre, deck.gl, OpenLayers, L7 and ECharts' default projection) draws **horizontal streaks across the map** from Russia/Chukotka, Fiji and Antarctica.
   - **Fix (verified):** `d3.geoProject(fc, d3.geoEquirectangular().scale(180/Math.PI).translate([0,0]).reflectY(true).precision(0))`. It removes all 7 ring jumps in about 25 ms.
   - Better still, do the cut once in the Python builder (`antimeridian` Apache-2.0, or `shapely`, or `mapshaper`).
4. **Basemap strategy: "no tiles" by default.** Use thematic vector basemaps built from **Natural Earth (public domain)** and shipped as classic-script data files (`RK.geo.register(...)`). This already matches the kit.
   - Upgrade the data. world-atlas 2.0.2 is **archived** and frozen on Natural Earth **4.1.0**.
   - At 110m it has **no Singapore, Hong Kong, Macao, Bahrain, Malta, Cayman or Bermuda** — exactly the financial centres a bank map needs.
   - Build from Natural Earth **5.1.2** 10m with `mapshaper -simplify 1% keep-shapes` instead. The world comes out at ~109 KB raw / 36 KB gzipped and keeps those micro-states.
   - Natural Earth 5.x also ships **point-of-view (worldview) variants**, e.g. `ne_10m_admin_0_countries_chn` (Taiwan merged into China; HK and Macao have sovereign "China"; 9-dash line in `…maritime_indicator_chn`).
5. **Optional heavy engine: deck.gl 9.4.0** (MIT, UMD `dist.min.js`, **575 KB gzipped**, needs WebGL2). It was verified under file:// with GeoJsonLayer, ScatterplotLayer, ArcLayer, HexagonLayer and HeatmapLayer, and made zero network calls.
   - Use it only for ≥10k points or flows, or for 3D arcs. Lazy-load it per block. It prints as a raster.
6. **Do not adopt for double-click deliverables:**
   - **MapLibre GL JS 6.x** (6.0.0 on 2026-07-22 went **ESM-only + WebGL2-only**). In the test, the `.mjs` was blocked by CORS under file://.
     - **5.24.0** (2026-04-23) is the last UMD. It **does** work under file:// with inline style + GeoJSON, and with **in-memory PMTiles via `addProtocol`**. When it can't load glyph PBFs, it renders labels with local fonts.
     - It is now a frozen branch: keep it as a "served mode" option only.
   - **kepler.gl** — a React/Redux app with a 10.9 MB UMD.
   - **AntV L7 2.29.1** — works offline without a basemap, but **phones home for its logo** (`gw.alipayobjects.com`) unless `logoVisible:false`. Its China basemaps (Gaode/Tencent/Baidu) need online keys.
   - **OpenLayers 10.11** — works offline (`dist/ol.js` classic build), but it is a GIS toolkit with verbose styling. Use it only if real GIS or projection needs appear.
7. **Licence red flags:**
   - `leaflet.minichart` is **GPL-2.0+** → avoid. Build pie/bar markers by hand or with ECharts pie-on-geo.
   - `world-geojson` (npm) is **GPL-3.0** → avoid.
   - `Leaflet.VectorGrid` is **Beerware** (non-standard) → avoid.
   - Mapbox GL JS v2+ is proprietary → reference only.
   - **DataV.GeoAtlas** China GeoJSON (the de facto ECharts China source) is "仅供学习和交流使用" (learning only), with data from 高德 → **not for client deliverables**.
   - **GADM** forbids commercial use and redistribution without permission → avoid.
   - geoBoundaries is CC BY 4.0 → usable with attribution.
8. **China maps are a compliance problem, not just a data problem.** PRC rules (地图管理条例, 地图审核管理规定) require a 审图号 for publicly shown China maps.
   - The 自然资源部 "标准地图" can be used **unmodified** with its 审图号. Any edit, including crop or zoom, requires review.
   - Microsoft even suspended Excel 2D/3D map charts for China.
   - For China-facing deliverables, either:
     - license a reviewed base map,
     - use a **tile-grid (方块/六边形) province cartogram**, which shows no boundaries but must include Taiwan, Hong Kong and Macao tiles, or
     - get compliance sign-off.
   - For global audiences, Natural Earth CHN-POV or default (de facto) data is public domain.
9. **Concrete per-use-case stack (§7):**

| Use case | Primary | Alternate | Basemap |
|---|---|---|---|
| World choropleth by country | Leaflet SVG (kit `choropleth`) | ECharts `map` + d3 Equal Earth (projection-correct, morph to bar) | NE 5.1.2 10m@1% keep-shapes, antimeridian-cut, ISO A3 + numeric ids, micro-state dots |
| Bubble map of offices / assets | Leaflet `circleMarker` (sqrt-area, nested legend) + markercluster >200 pts | ECharts scatter / effectScatter / **pie on geo** | same world basemap; land-only for cleaner look |
| Cross-border M&A flow map | Leaflet SVG quadratic Bézier arcs (kit `flow-map`), width ∝ value, arrowheads, dash animation | ECharts `lines` + effect trail; Pacific-centred via d3 `rotate`; deck.gl ArcLayer for >500 flows | world, optionally Pacific-centred |
| China province map | ECharts `map` + `d3.geoConicEqualArea().parallels([25,47]).rotate([-105,0])` | Leaflet + Proj4Leaflet Albers; **tile-grid cartogram** (compliance-safe) | NE admin-1 (32 CHN features, `name_zh`, `iso_3166_2`) for non-PRC audiences; licensed 审图号 base for PRC audiences |
| Density heatmap | **Hexbin** (leaflet-d3 hexbin / Plot.hexbin / own d3-hexbin) for quantitative legends | Leaflet.heat (kit `geo-heat`, set `maxZoom`!), ECharts heatmap-on-geo; deck.gl Heatmap/HexagonLayer for 100k+ | world or regional |

---

## 1. 需求拆解 → 地图技术约束

| Requirement (brief) | Map implication | Best fit |
|---|---|---|
| Opens offline by double-clicking `index.html` | No CDN, no tile server, no `fetch()` of local JSON, no ES modules, no module workers. Geo data must be **JS files** (`window.__RK_GEO[name]=…` / `RK.geo.register`). Images *do* load from relative paths (raster tiles in a folder work). | Leaflet 1.9 UMD, ECharts UMD, deck.gl UMD, OL full build, MapLibre **5.x** UMD (blob worker), Plot UMD |
| Pitchbook visual quality (GS/JPM/think-cell) | Clean land/borders in theme greys, no street basemap clutter. Equal-area projections for choropleths. Crisp vector print. Nested size legends, classed legends with counts, direct labels with collision handling. | SVG renderers: Leaflet SVG, ECharts `renderer:'svg'`, Plot |
| Data strictly separated and swappable | Geometry (basemap) and metrics (data) are separate files. Join by stable keys: ISO 3166-1 alpha-3 / numeric; China GB/T 2260 adcode or ISO 3166-2:CN (`CN-BJ`). | Kit `RK.geo.features(name)` plus a join table |
| Zoom / filter / cross-filter / dynamic re-render | Zoom and pan (Leaflet native, ECharts `roam`). Click-to-filter. Brush on map (ECharts `brush` + `geoIndex`, verified). Re-style without rebuilding layers (`layer.setStyle`, `setOption` merge). | Leaflet + RK cross-filter bus; ECharts brush |
| Multi-dimensional encodings | colour (choropleth), size (bubble area), shape (symbol), opacity, pies/donuts per location, flow width + colour, density, time | Leaflet + ECharts cover all; deck.gl for scale |
| Motion | Grow-in bubbles, colour tweening on filter, arc draw-in / travelling dots, map↔bar morph, `flyToBounds` | Leaflet CSS + rAF tweens; ECharts built-ins |
| Permissive licences | BSD/MIT/ISC/Apache code; public-domain or CC BY data | See §4–§6 |
| Step 2: LLM / skills | Map specs as JSON (component + encode + options) that an LLM can emit. Basemaps from a registry by name. | Kit manifests already fit |

---

## 2. file:// 冒烟测试结果 (headless Chromium, double-click conditions)

All pages were loaded as `file:///…/pages/*.html`, with external `http(s)` requests intercepted and aborted.

| # | Page | Libraries | Result | External requests | Notes |
|---|---|---|---|---|---|
| p1 | Leaflet 1.9 full plugin stack | leaflet 1.9.4, topojson-client, leaflet.heat, markercluster, ant-path, Leaflet.Arc, d3 7.9 + d3-hexbin + @asymmetrik/leaflet-d3, Leaflet.Sync | ✅ 284 SVG paths, 46 hexbin hexagons, 7 clusters, sync on | 0 | **First run threw `Map has no maxZoom specified`.** markercluster needs `maxZoom` on the map when there is no tile layer. Antimeridian streaks visible. Leaflet.Arc great circle NY→HK wraps across the date line. |
| p2 | Leaflet 2.0.0-alpha.1 `leaflet-global.js` | core only + 1.x plugins | core ✅ (`new L.Map`, `new L.GeoJSON`, `new L.CircleMarker`); `L.map`/`L.circleMarker` = `undefined`; **leaflet.heat ❌ `L.setOptions is not a function`; markercluster ❌ `L.featureGroup is not a function`** | 0 | `L.Layer.extend` / `L.Class.extend` still exist |
| p2b | Leaflet 2.0 alpha.1 + Leaflet-V1-polyfill (`applyAllPolyfills()`) | + heat, markercluster, ant-path | heat ✅, markercluster ✅, **ant-path ❌ `Class constructor … cannot be invoked without 'new'`** | 0 | Plugins transpiled with ES5-style `_inherits` break on ES6 classes |
| p3 | MapLibre GL JS **5.24.0** UMD | inline style + GeoJSON fill + data-driven circle | ✅ `load` fired, 190 rendered features | 0 | A second map with a `symbol` text layer and `glyphs:'./glyphs/{fontstack}/{range}.pbf'`: the XHR was blocked (origin `null`), MapLibre warned "Rendering codepoint … locally instead" and **labels still rendered** using local fonts |
| p4 | MapLibre **6.14.0** `maplibre-gl.mjs` | `<script type=module>` | ❌ blocked by CORS ("Access to script … from origin 'null'") | 0 | v6 is ESM-only: unusable from file:// without re-bundling, and the worker is a separate module |
| p5 | deck.gl **9.4.0** `dist.min.js` | GeoJsonLayer, HeatmapLayer, HexagonLayer, ScatterplotLayer, ArcLayer | ✅ WebGL2 context, renders | 0 | Antimeridian streaks with raw world-atlas |
| p6 | OpenLayers **10.11.0** `dist/ol.js` | Vector + Heatmap + circle styles | ✅ `rendercomplete` | 0 | Antimeridian streaks |
| p7 | AntV L7 **2.29.1** `dist/l7.js` | `new L7.Scene({map: new L7.Map(...)})`, PolygonLayer, PointLayer, LineLayer arc + animate | ✅ | **1 → `gw.alipayobjects.com/...` (logo)** | p7b with `logoVisible:false` → 0 requests. UMD expects globals `mapboxgl` / `maplibregl` (may be undefined) |
| p8 | ECharts **6.1.0** | `map` + visualMap, `effectScatter`, `lines` with effect | ✅ | 0 | Antimeridian streak with the default projection |
| p9 | Observable Plot **0.6.17** UMD + d3 | `Plot.geo`, `Plot.dot` (r), `Plot.arrow` (bend), Equal Earth | ✅ 183 paths, **no antimeridian artefacts** (d3 spherical clipping) | 0 | Static SVG, no zoom |
| p10 | pmtiles 4.5.0 + protomaps-leaflet 5.1.0 | A: `new PMTiles('../x.pmtiles')`; B: custom in-memory `Source` from base64 JS | A ❌ `Fetch API cannot load file:///… URL scheme "file" is not supported`; **B ✅ header and metadata read, layer added** | 0 | protomaps-leaflet accepts a PMTiles *instance* as `url` |
| p11 | antimeridian fix | d3-geo + d3-geo-projection `geoProject` identity cut → Leaflet, MapLibre 5; ECharts with `projection.stream` = `d3.geoEqualEarth().stream` | ✅ ring jumps 7 → 0 in 25 ms; all three render cleanly | 0 | See snippet below |
| p12 | ECharts pies on geo | `series-pie` `coordinateSystem:'geo'`, `center:[lon,lat]` + scatter with mixed `symbol` shapes | ✅ 5 pie series positioned | 0 | Mini-charts without GPL `leaflet.minichart` |
| p13 | Leaflet local raster tiles | `L.tileLayer('../tiles/{z}/{x}/{y}.png')` | ✅ tiles load from file:// (plain `<img>`, no CORS) | 0 | Out-of-range tiles 404 harmlessly; use `bounds` / `noWrap` |
| p14 | Leaflet + Proj4Leaflet 1.0.2 + proj4 2.22.0 | Equal Earth CRS (`+proj=eqearth`), China Albers (`+proj=aea +lat_1=25 +lat_2=47 +lon_0=105`) | ✅ both render (tune `resolutions`) | 0 | Custom CRS only makes sense with **no tiles** or tiles in the same CRS |
| p15 | ECharts heatmap-on-geo + brush | `heatmap` `coordinateSystem:'geo'`, `brush:{geoIndex:0}`, `dispatchAction({type:'brush'})`, `renderer:'svg'` | ✅ `brushSelected` returned the indices of the 3 offices inside the box | 0 | In the SVG renderer the heatmap is a single `<image>` (raster) |
| p16 | China provinces + world CHN-POV | NE admin-1 (32 CHN features) simplified to 5% → 25 KB TopoJSON; `d3.geoConicEqualArea().parallels([25,47]).rotate([-105,0])` in ECharts | ✅ | 0 | Feeding *cut* (planar, reflected) geometry into a d3 spherical projection inverted 2 polygons → the whole sphere filled. **Rule: raw geometry for d3 projections, cut geometry for planar engines.** |
| p17 | MapLibre 5.24 + in-memory PMTiles | `pmtiles.Protocol().add(p)` + `maplibregl.addProtocol('pmtiles', protocol.tile)` | ✅ vector tile rendered | 0 | Vector tiles fully offline under file:// |

**Antimeridian cut snippet (runtime fallback; prefer doing it in Python at build time):**

```js
// world-atlas / Natural Earth geometry → cut at ±180° for planar renderers (Leaflet, MapLibre, deck, OL, ECharts default)
var cutFC = d3.geoProject(rawFC,
  d3.geoEquirectangular().scale(180 / Math.PI).translate([0, 0]).reflectY(true).precision(0));
// rawFC: keep for d3 / Plot / ECharts-with-d3-projection (spherical winding);
// cutFC: use for planar engines (winding reversed — fine for Leaflet/MapLibre fills).
```

**In-memory PMTiles snippet (works under file://):**

```js
var buf = Uint8Array.from(atob(window.PMT_B64), c => c.charCodeAt(0)).buffer; // data/basemap.pmtiles.js
var p = new pmtiles.PMTiles({ getKey: () => 'basemap', getBytes: async (o, l) => ({ data: buf.slice(o, o + l) }) });
protomapsL.leafletLayer({ url: p, paintRules: [...], labelRules: [] }).addTo(map);       // Leaflet
// or MapLibre 5: var proto = new pmtiles.Protocol(); proto.add(p); maplibregl.addProtocol('pmtiles', proto.tile);
//                source: {type:'vector', url:'pmtiles://basemap'}
```

---

## 3. Leaflet 核心: 1.9.4 (stable) vs 2.0 (alpha)

### 3.1 Release status (verified)

| Item | Value | Source |
|---|---|---|
| npm `latest` | **1.9.4**, published 2023-05-18, BSD-2-Clause | `npm view leaflet` |
| npm `alpha` | **2.0.0-alpha.1**, 2025-08-16 (first alpha 2025-05-18) | `npm view leaflet time` |
| GitHub releases | v1.9.4 marked "Latest"; v2.0.0-alpha, v2.0.0-alpha.1, plus a rolling "Development snapshot (dev)" pre-release dated 17 Sep; **no beta or rc** | https://github.com/Leaflet/Leaflet/releases |
| Repo | 45.7k stars, pushed 2026-10-05 | ecosyste.ms |
| Community status | FOSSGIS 2026 (Mar) and FOSS4G 2026 (1 Sep 2026) talks titled "Leaflet 2.0 is coming – it's official!" say the alpha has existed "for over a year" and "it remained unclear what to expect"; no stable date given | https://talks.osgeo.org/foss4g-2026/talk/VK8SSV/ , https://pretalx.com/fossgis2026/talk/CVEQQA/ |
| Earlier target | A plugin-maintainer notice mentioned a November 2025 stable target; it did not ship | https://gitlab.com/jkuebart/Leaflet.VectorTileLayer/-/issues/26 |

### 3.2 What 2.0 changes (from the 2.0.0-alpha CHANGELOG / blog)

- Targets evergreen browsers only and drops IE. Uses Pointer Events instead of Mouse + Touch.
- **ESM-first.** "The global `L` is no longer part of the core package (though it's still available in the bundled version `leaflet-global.js`)."
  - Measured: `dist/leaflet-global.js` is 136.7 KB raw / 39.5 KB gzipped.
  - The UMD wrapper assigns `globalThis.leaflet` **and** `globalThis.L` (with `L.noConflict`).
- **All factory methods removed:** `L.marker(latlng)` becomes `new Marker(latlng)`.
- Aliases dropped: `addEventListener`/`fireEvent` on Evented; `addListener`/`removeListener` on DomEvent.
- Classes rewritten as ES6 classes. `L.Class.extend` still exists, but plugins that subclass with Babel ES5 helpers fail.
- New in alpha.1: `LeafletMap` export alias, `Control.Layers` `collapseDelay`, `BlanketOverlay` renderer superclass.
- Migration aid: **Leaflet-V1-polyfill** (BSD-2-Clause, Falke-Design, 10 stars) with `applyAllPolyfills()` / `applyMinimumPolyfills()`.
  - In my test it rescued `leaflet.heat` and `markercluster`, but not `leaflet-ant-path`.
- Sources: https://leafletjs.com/2025/05/18/leaflet-2.0.0-alpha.html , CHANGELOG in the npm tarball, https://github.com/Falke-Design/Leaflet-V1-polyfill

**Decision.** Stay on 1.9.4 and write kit code that is "2.0-ready":
- Use constructors (`new L.CircleMarker`) rather than factories; 1.9 supports both.
- Avoid deprecated aliases.
- Don't subclass plugins.

When 2.0 goes stable, swapping in `leaflet-global.js` plus the polyfill is a small change. The risk is in third-party plugins, so keep the plugin count small and own the critical ones (arcs, legends, pies, labels).

### 3.3 Leaflet capabilities that matter for business maps

- **`L.geoJSON(fc, {style, onEachFeature, filter})`** — choropleths. `layer.setStyle()` re-colours in place on a data change, without rebuilding.
- **Renderers:**
  - `L.svg()` (default): vector print, CSS-stylable, CSS `transition: fill .4s` works for animated re-colouring.
  - `L.canvas()` (`preferCanvas:true`): faster for >~2–5k features, but prints as raster.
  - You can mix them: a canvas renderer for dense points, SVG for polygons.
- **Panes** (`map.createPane('bubbles')`, `zIndex`) control z-order: land < choropleth < flows < bubbles < labels.
- **`L.circleMarker`** radius is in **pixels**, which is right for proportional symbols. `L.circle` radius is in **metres** and its on-screen size changes with latitude and zoom → wrong for bubbles.
- **`zoomSnap: 0.25`** gives fractional zoom for tight `fitBounds`. `maxBounds` + `maxBoundsViscosity` keep the world from drifting.
- **`L.tooltip({permanent:true, direction:'center', className})`** gives cheap direct labels. Collision avoidance is your own code; the kit already does "crowded labels hide".
- **Custom CRS** through Proj4Leaflet (BSD-2) + proj4 (MIT, 42 KB gzipped) gives equal-area world maps or China Albers, with no tiles (p14).
- **Gotchas:**
  - (1) Without a tile layer, `map.getMaxZoom()` is `Infinity`. That breaks **markercluster** (throws) and **leaflet.heat** (intensity divided by 2^12). Always set `minZoom`/`maxZoom` on the map. The kit's `geo-heat` already sets `heat.setOptions({maxZoom: round(map.getZoom())})`.
  - (2) Maps inside hidden tabs, collapsed sections or print: call `map.invalidateSize()` from `ResizeObserver` / `beforeprint`.
  - (3) `scrollWheelZoom` hijacks page scroll in long reports. Default it off, or use `leaflet-gesture-handling` (MIT 1.2.2, 2021) / a custom "Ctrl+scroll to zoom" overlay.
  - (4) `L.Icon.Default` image path detection; prefer circleMarkers or divIcons.
  - (5) World copies: set `worldCopyJump:false`, `noWrap` and maxBounds for a single world.

---

## 4. Leaflet 插件生态 (plugin ecosystem, verified)

Sizes are raw / gzipped for the dist file that would be vendored. "Test" refers to the §2 smoke tests.

| Plugin (npm) | Version · date | Licence | Stars · last push | Classic dist file | Size | Test | Verdict |
|---|---|---|---|---|---|---|---|
| **leaflet.heat** | 0.2.0 · 2015-10-26 | BSD-2-Clause (LICENSE file; **npm `license` field missing**) | 1.7k · 2024-06 | `dist/leaflet-heat.js` | 5.2 KB / 2.1 KB | ✅ (needs maxZoom) | **adopt** (vendored) — simpleheat canvas; zoom-dependent intensity gotcha |
| **leaflet.markercluster** | 1.5.3 · 2021-10-18 | MIT | 4.2k · 2024-08 | `dist/leaflet.markercluster.js` + 2 CSS | 34 KB / 8.7 KB | ✅ (needs maxZoom) | **adopt** (vendored) — `iconCreateFunction` → SVG donut clusters by category |
| leaflet-ant-path | 1.3.0 · 2019-05-23 | MIT | 480 · 2022-12 | `dist/leaflet-ant-path.js` | 42.5 KB / 13.7 KB (bundles Babel runtime) | ✅ 1.9 / ❌ 2.0 | consider → better: own CSS `stroke-dashoffset` animation on SVG paths (kit flow-map does dots) |
| leaflet-arc (Leaflet.Arc) | 1.0.2 · 2016-09-23 | ISC (npm) / MIT (repo) | 45 · 2019-03 | `bin/leaflet-arc.min.js` (bundles arc.js) | 5.7 KB / 2.2 KB | ✅ but great-circle arcs wrap across the date line | reference — use own Bézier (`RK.geo.arc`) |
| @elfalem/leaflet-curve | 0.9.2 · 2023-03-08 | MIT | — | `leaflet.curve.js` | small | — | consider if SVG Bézier commands are needed (`L.curve(['M',a,'Q',c,b])`) |
| leaflet.migrationLayer (lit-forest) | no npm · repo pushed 2024-06 | MIT | 136 | `dist/leaflet.migrationLayer.js` | — | not tested | reference — ECharts-style migration animation on canvas; unmaintained |
| Leaflet.Canvas-Flowmap-Layer (jwasilgeo) | no npm · 2021-02 | MIT | 174 | — | — | not tested | reference — canvas OD Bézier flows with animation; stale |
| leaflet-polylinedecorator | 1.6.0 · 2018-01-28 | MIT | 520 · 2020-05 | `dist/leaflet.polylineDecorator.js` | small | — | consider — arrowheads along polylines (or draw arrowheads yourself, as the kit does) |
| **@asymmetrik/leaflet-d3** (now bluehalo/leaflet-d3) | 6.0.1 · 2022-02-19 | MIT | 271 · 2026-09 | `dist/leaflet-d3.min.js` (peer: d3 7, d3-hexbin 0.2) | 20.8 KB / 5.7 KB (+ d3 92 KB gz + d3-hexbin 1.7 KB) | ✅ 46 hexagons | **consider** — `L.hexbinLayer` with colour + radius scales, hover/click, D3 transitions. Or hand-roll with d3-hexbin to avoid all of d3 |
| leaflet-hexbin (lsdch) | 0.2.0 · 2025-05-15 | MIT | 0 | — | — | — | avoid (no adoption) |
| leaflet.minichart | 0.2.5 · 2018-06-08 | **GPL-2.0+** | 33 · 2020-08 | `src/minichart.js` (d3 v4, tinycolor2) | — | not tested | **avoid** (GPL, stale). Use ECharts pie-on-geo (p12) or own SVG divIcon pies/bars |
| leaflet-dvf (Leaflet.DataViz) | 0.3.1 · 2017-02-16 | MIT | 686 · 2018-03 | `dist/leaflet-dvf.min.js` | — | not tested | reference — pie/bar/radial chart markers, ChoroplethDataLayer, legends; good design ideas, stale code (2017, Leaflet 0.7/1.0 era) |
| leaflet-timedimension | 1.1.1 · 2019-11-05 | MIT (+ dep iso8601-js-period 0.2.1 Apache-2.0) | 455 · 2026-06 | `dist/leaflet.timedimension.min.js` | 40 KB / 9.2 KB | not exercised | reference — WMS/ISO-8601 oriented. For monthly or quarterly business data, a custom slider + `setStyle` / `setOption` is simpler and on-brand |
| leaflet.sync | 0.2.4 · 2018-05-04 | BSD-3-Clause | 245 · 2021-11 | `L.Map.Sync.js` | 10.4 KB / 2.5 KB | ✅ two maps synced | **consider** — small-multiple maps (before/after, metric A vs B) |
| leaflet.glify | 3.3.1 · 2024-12-09 | MIT | 538 · 2026-02 | `dist/glify-browser.js` | 118 KB / 39.7 KB | not tested | consider for 100k+ points/lines (WebGL) inside Leaflet; otherwise deck.gl |
| leaflet-pixi-overlay | 1.9.5 · 2025-11-04 | MIT (+ PixiJS MIT) | 511 · 2025-11 | `L.PixiOverlay.min.js` | 7.2 KB / 2.3 KB + PixiJS | not tested | reference — custom WebGL markers / animated particles |
| leaflet-canvas-marker (Leaflet.Canvas-Markers) | 0.2.0 · 2018-06-09 | MIT | 175 · **archived** | — | — | — | avoid |
| deck.gl-leaflet | 1.3.1 · 2024-09-13 | MIT | 41 · 2024-12 | `dist/deck.gl-leaflet.umd.min.js` | 4.2 KB / 1.5 KB (+ deck.gl 575 KB gz) | not tested | consider only if deck layers must live inside the Leaflet zoom/pan |
| @maplibre/maplibre-gl-leaflet | 0.1.4 · 2026-08-16 | ISC | 228 · 2026-09 | `dist/leaflet-maplibre-gl.js` | 9.3 KB / 2.7 KB | — | reference — vector basemap under Leaflet (needs MapLibre 5 UMD) |
| protomaps-leaflet | 5.1.0 · 2025-06-18 | BSD-3-Clause | 855 · 2026-02 | `dist/protomaps-leaflet.js` (IIFE `protomapsL`, bundles pmtiles 3) | 128 KB / 37.7 KB | ✅ in-memory PMTiles | consider (only if street-level vector basemaps are needed) |
| leaflet.vectorgrid | 1.3.0 · (2022 metadata) | **Beerware** | — | — | — | — | avoid (licence + stale; fetch-based) |
| leaflet-geojson-vt / geojson-vt | 1.1.0 / 5.0.4 (2026-09-30) | MIT / ISC | — | — | — | — | consider for very heavy polygon layers (on-the-fly tiling) |
| leaflet-svg-shape-markers | 1.4.0 · 2022-08-19 | MIT | — | — | small | — | consider — `L.shapeMarker({shape:'triangle'|'diamond'|'square'…})` for a **shape** channel |
| leaflet-textpath | 1.3.0 · 2025-06-23 | MIT | — | — | small | — | consider — text along flow arcs ("$4.2bn") |
| leaflet.fullscreen | 5.3.3 · 2026-06-30 | MIT | — | `dist/Control.FullScreen.js` | 7.3 KB / 2.4 KB | — | consider — maintained; or 20 lines of Fullscreen API |
| leaflet-gesture-handling | 1.2.2 · 2021-10-22 | MIT | — | — | small | — | consider — fixes scroll hijacking in long reports |
| leaflet-easyprint / leaflet-image | 2.1.9 (2017) / 0.4.0 (2016) | MIT / BSD-2 | — | — | — | — | avoid — stale. Prefer browser print with print CSS (SVG stays vector) or `html-to-image` 1.11.13 (MIT) |
| leaflet-html-legend (consbio) | 0.3.5 · 2020-02-13 | ISC-style permissive (LICENSE text) | — | — | — | — | reference — legends are easier as own HTML in the kit's legend system |
| Leaflet.Legend (ptma) | no npm `leaflet.legend` | MIT | — | — | — | — | reference |
| leaflet-choropleth (timwis) | 1.1.4 · 2017-05-30 | MIT (uses chroma-js) | — | — | — | — | reference — the kit already does quantile/equal/nice breaks |
| leaflet.pattern | 0.1.0 · 2018 | **unclear (no licence field)** | — | — | — | — | avoid — draw SVG `<pattern>` hatching (no-data / estimates) yourself in the SVG renderer `<defs>` |
| Proj4Leaflet | 1.0.2 · 2017-08-14 | BSD-2-Clause | 612 · 2020-02 | `src/proj4leaflet.js` | 7.7 KB (+ proj4 2.22.0, MIT, 130 KB / 42 KB) | ✅ Equal Earth, China Albers | consider — equal-area choropleths inside Leaflet |
| leaflet-providers | 4.0.0 · 2026-09-03 | BSD-2-Clause | — | — | — | — | online-mode only (tile URL presets) |

**Plugin takeaways:**
- The Leaflet plugin ecosystem is **old**. Most data-viz plugins were last released 2016–2019.
- The maintained ones are markercluster (barely), glify, pixi-overlay, fullscreen, textpath, maplibre-gl-leaflet and protomaps-leaflet.
- For a bank kit, own the thematic layers (choropleth classing, bubbles, legends, arcs, pies, hexbin) in `rk.geo.js`. Each is 50–300 lines on top of Leaflet core.
- Vendor only: markercluster, heat, optionally leaflet-d3/d3-hexbin, Proj4Leaflet + proj4, and Leaflet.Sync.

---

## 5. 替代方案对比 (alternatives)

| Library | Version (date) | Licence | Stars | Classic script for file:// | Size gz | Basemap need | Strengths for us | Weaknesses for us | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **ECharts geo / map** | 6.1.0 (2026-05-19) | Apache-2.0 | 67.5k | ✅ `dist/echarts.min.js` (vendored) | 368 KB (full) | none; `registerMap(name, geojson[, specialAreas])` | choropleth + visualMap; scatter/effectScatter (size/colour/shape); **pie on geo**; `lines` with effect trails and `large` mode; heatmap on geo; **brush on geo**; `roam`; SVG renderer; **d3 projections via `projection.stream`**; universalTransition map↔bar morph; consistent look with other kit charts | Tiles/streets need a plugin (no); zoom behaviour less "map-like" than Leaflet; heatmap is raster in SVG mode | **adopt** (2nd map engine) |
| **Leaflet** | 1.9.4 (2023-05-18) | BSD-2 | 45.7k | ✅ `dist/leaflet.js` | 42 KB | none needed (vector basemap) | real slippy-map UX, panes, SVG print, tiny, huge mindshare | old plugins; Web Mercator unless Proj4Leaflet; DIY legends/labels | **adopt** (primary) |
| MapLibre GL JS | **6.14.0** (2026-10-11); 6.0.0 = 2026-07-22; last UMD **5.24.0** (2026-04-23) | BSD-3 | 11.9k | v6 ❌ (ESM-only + module worker); v5 ✅ `dist/maplibre-gl.js` (blob worker) | v5 275 KB; v6 285 KB + worker 143 KB | style JSON (inline OK); glyphs/sprites via URL (fail on file://; local-font fallback for text); PMTiles via `addProtocol` | GPU vector rendering, globe (v5+), data-driven expressions, feature-state hover, smooth zoom | WebGL raster print; v6 drops UMD and WebGL1; style-spec learning curve; overkill for thematic maps | **avoid** for file:// deliverables; consider v5/v6 in "served mode" |
| deck.gl | 9.4.0 (2026-09-05) | MIT | 14.7k | ✅ `dist.min.js` (global `deck`) | **575 KB** | none (MapView) or MapLibre/Leaflet bridge | ScatterplotLayer, **ArcLayer** (source/target colour gradient, 3D height), **HexagonLayer/GridLayer** (GPU aggregation since 9.1), **HeatmapLayer**, GeoJsonLayer, TripsLayer (animated paths), H3HexagonLayer; attribute `transitions` for animated updates; millions of points | size, WebGL2 required, raster print, no SVG; WebGPU still "experimental, not recommended for production" in 9.4 | **consider** (optional lazy engine for big data) |
| @flowmap.gl/layers | 9.4.0 (2026-06-16) | Apache-2.0 | 141 | ❌ ESM files only (re-bundle with esbuild → IIFE possible) | — | deck.gl | OD-flow clustering, totals per location, animated flows — best-in-class for many flows | ESM-only, deck dependency | reference / served mode |
| kepler.gl | stable 3.2.6 (2026-03-16); npm `latest`=3.3.0-alpha.16 (2026-10-09) | MIT | 12.0k | `umd/keplergl.min.js` **10.9 MB raw** + React/Redux/styled-components | huge | MapLibre online styles by default | analyst exploration UI (filters, time playback, layer editor) | it's an app, not a component; huge; online basemaps | **reference** (internal exploration tool, not deliverables) |
| AntV L7 | 2.29.1 (2026-07-13); 2.30.0-beta.1 | MIT | 4.1k | ✅ `dist/l7.js` (expects globals `mapboxgl`/`maplibregl`) | 346 KB | `L7.Map` (no basemap, offline OK) or GaodeMap/Tencent/Baidu/Google/Mapbox/MapLibre (online keys) | rich Chinese-market map vis: bubbles, 3D columns, arc/arc3d/greatcircle with animate, hexagon/grid heat, choropleth; strong China basemap integrations | **network call for logo by default** (`logoVisible:false` fixes); online assets for some features (icons/textures on alipayobjects); docs mostly Chinese; WebGL raster print | reference (consider only for China-hosted online apps) |
| OpenLayers | 10.11.0 (2026-10-04) | BSD-2 | 12.6k | ✅ `dist/ol.js` (IIFE global `ol`) | 298 KB | none needed | real GIS: any projection (proj4), WebGL heatmap, cluster source, vector tiles, PMTiles via ol-pmtiles | verbose style API, chart-like encodings DIY, heavier | consider (fallback if GIS needs grow) |
| Observable Plot | 0.6.17 (2025-02-14) | ISC | 5.4k | ✅ `dist/plot.umd.min.js` (+ d3 UMD) | 69 KB + d3 92 KB | none | static, print-perfect SVG maps; projections (`equal-earth`, `albers-usa`, conic, `rotate`); `geo`, `dot` (r), `arrow` (bend), `hexbin` transform, `density` contours, faceting → **map small multiples**; spherical clipping (no antimeridian bugs) | no zoom/pan, limited interactivity (`tip`), d3 dependency | **consider** (static/print maps, small multiples) |
| d3-geo + d3-geo-projection | 3.1.1 (2024-03-12) + 4.0.0 (2021-06-11) | ISC | 1.1k / 1.2k | ✅ `dist/d3-geo.min.js` (13 KB gz) + `d3-geo-projection.min.js` (23 KB gz) | 36 KB together | none | projections, `geoProject` cutting, `geoArea`/`geoCentroid`/`geoBounds`, graticules, `geoPath` to SVG; powers ECharts `projection.stream` | low-level | **adopt** (utility) |
| d3-composite-projections | 2.0.0 (2025-09-06) | BSD-3 | 102 | ✅ | small | — | insets for countries such as Spain, Portugal and France (no China/South China Sea preset) | — | reference |
| Mapbox GL JS | 3.33.0 (2026-10-13) | **proprietary** ("SEE LICENSE IN LICENSE.txt"), token + billing | — | — | — | Mapbox online | — | licence | **avoid** (reference only) |

**Notes per alternative:**
- **MapLibre v6 ESM-only (critical for this project).** CHANGELOG 6.0.0: "⚠️ Switch to an ESM-only distribution (`maplibre-gl.mjs`). The UMD bundles (`maplibre-gl.js`, `maplibre-gl-csp.js`) are no longer published… the ESM build loads its worker as a real URL." v6 also removed WebGL1 ("WebGL2 is now required").
  - Re-bundling v6 into an IIFE is non-trivial: Chrome blocks module workers from file:// origins, so the worker would have to be inlined as a blob.
  - **If MapLibre is ever needed offline, pin 5.24.0 UMD.**
  - Source: https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md
- **deck.gl roadmap.**
  - 9.1 (2025-01) restored GPU aggregation (`HexagonLayer gpuAggregation:true`) and made GlobeView match MapLibre globe.
  - 9.2 (2025-10) added widgets.
  - 9.3 (2026-04) overhauled widgets.
  - 9.4 (2026-09) added `@deck.gl/maplibre` for MapLibre v4–v6 and the `visgl:webgl-only` export condition. WebGPU is still "experimental and is not yet recommended for production".
  - The UMD `dist.min.js` is still published (verified).
  - Source: https://deck.gl/docs/whats-new
- **ECharts projection hook.** `geo.projection` / `series-map.projection` has existed since 5.3.0, with `project`, `unproject` and optional `stream`. The stream "allows using d3's antimeridian clipping".
  - Sources: apache/echarts#16364 and test page `map-projection-d3.html`.
  - Verified in 6.1: Equal Earth and China conic equal-area work. Use the **raw** (uncut) geometry with it.
- **ECharts `registerMap(name, geoJSON, specialAreas)`** can move or scale regions (insets). The official USA example moves Alaska, Hawaii and Puerto Rico. Use the same mechanism for a South China Sea inset box, or to enlarge micro-states.

---

## 6. 离线底图策略 (offline basemaps)

### 6.1 Ladder of options

| Tier | What | file:// | Size | Licence | Use for |
|---|---|---|---|---|---|
| **0 (default)** | Thematic vector basemap (land, countries, provinces, graticule, sphere outline) from **Natural Earth** as TopoJSON → classic JS | ✅ | world 110m: 108 KB raw / 38 KB gz; world 50m: 756 KB / 230 KB; **NE 10m CHN-POV simplified 1% keep-shapes: 109 KB / 36 KB**; China admin-1 @5%: 25 KB / 10 KB | public domain (NE); world-atlas packaging ISC | all five use cases |
| 1 | Pre-rendered raster tiles in `vendor/tiles/{z}/{x}/{y}.png` (or a JS sprite) | ✅ (`<img>`, verified p13) | z0–4 ≈ 341 tiles; z0–5 ≈ 1,365 tiles (×10–40 KB each) | depends on source (NE shaded relief = PD; OSM-derived = ODbL attribution) | hillshade/relief backgrounds for "atlas" look; rarely needed |
| 2 | **PMTiles** single-file vector tiles embedded as base64 in a `.js`, read through a custom in-memory `Source` | ✅ (p10, p17) | planet z0–15 ≈ 120 GB (Protomaps docs); each extra zoom ≈ ×2; city/region extracts via `pmtiles extract --bbox … --maxzoom N`; base64 adds +33% | Protomaps basemap = **ODbL Produced Work → "© OpenStreetMap" attribution required**; code BSD-3 | street-level office maps (city scale), only when truly needed |
| 3 | Online tiles (opt-in "online mode") | ❌ offline | — | OSM tile server: **"Offline use is not permitted"**, bulk prefetch prohibited, commercial access "may be withdrawn at any point"; CARTO basemaps: commercial use needs an Enterprise licence (free key = 5M tile requests/month, "intended for non-commercial use") | live dashboards only; never default |

Sources:
- https://operations.osmfoundation.org/policies/tiles/
- https://docs.carto.com/faqs/carto-basemaps , https://www.carto.com/basemaps/apikey/
- https://docs.protomaps.com/basemaps/downloads , https://docs.protomaps.com/pmtiles/cli

### 6.2 Natural Earth vs world-atlas (data facts measured)

- **world-atlas 2.0.2** (ISC, 2019-09-05; repo **archived**) redistributes **Natural Earth 4.1.0**.
  - Geometry is "quantized, but not projected … in spherical coordinates", i.e. meant for d3-geo spherical rendering.
  - Measured issues:
    - **110m is missing** Singapore (702), Hong Kong (344), Macao (446), Bahrain (048), Malta (470), Monaco, Liechtenstein, Cayman (136) and Bermuda (060). Luxembourg, Cyprus and Qatar are present.
    - At 110m, **N. Cyprus, Somaliland and Kosovo have no `id`**. At 50m the no-id list also includes "Indian Ocean Ter." and "Siachen Glacier".
    - 50m (241 features) includes HK, Macao, Singapore, Bahrain, Monaco, San Marino and Vatican.
    - Antimeridian: 7 ring jumps (Russia, Fiji, Antarctica) → streaks in every planar renderer (§2).
- **Natural Earth latest:** 5.1.2 cultural (2022-05-13); 5.2.0 physical (2022-06-02). The repo `VERSION` file says `5.2.0-pre`. Public domain.
  - **ISO gotcha:** in NE 110m admin-0, `ISO_A3` / `ISO_N3` are **`-99` for France and Norway** (as well as N. Cyprus, Somaliland and Kosovo). Use `ISO_A3_EH` / `ISO_N3_EH` or `ADM0_A3` for joins.
  - Admin-0 has 168 properties, including `NAME_ZH` / `NAME_ZHT` (Chinese labels for free) and 33 `FCLASS_*` worldview columns.
- **Point-of-view (worldview) variants (since v5.0, Dec 2021)** cover 31 viewpoints: `ar bd br cn de eg es fr gb gr id il in it jp ko ma nl np pk pl ps pt ru sa se tr tw us vn iso`, plus `tlc`.
  - Preassembled files follow the pattern `ne_10m_admin_0_countries_[iso3]`.
  - Measured `ne_10m_admin_0_countries_chn.geojson` (13.2 MB, 246 features):
    - no separate TWN feature (merged into China);
    - `HKG` / `MAC` separate, with `SOVEREIGNT = China`;
    - `Scarborough Reef` / 黄岩岛 separate.
  - `ne_10m_admin_0_boundary_lines_maritime_indicator_chn` has 9 "Chinese 9 dash line" segments (`FCLASS_CN = 'International boundary (verify)'`).
  - The default dataset shows **de facto** boundaries ("who actually controls the situation on the ground").
  - Sources: https://www.naturalearthdata.com/about/disputed-boundaries-policy/ , https://github.com/nvkelso/natural-earth-vector
- **NE admin-1 (states/provinces) 10m** is 40.7 MB GeoJSON.
  - China (`adm0_a3='CHN'`) has **32 features**: 31 provincial units plus "Paracel Islands" (西沙群岛, `CN-X01~`). It has `name_zh`, `name_local` and `iso_3166_2` (e.g. `CN-XJ`).
  - Hong Kong (18 districts) and Taiwan (22 counties/cities) are under their own adm0. Macao is one feature, `MO-M`.
  - mapshaper sizes for China provinces: 2% → 14.6 KB, **5% → 25 KB**, 10% → 42 KB TopoJSON (q=1e5).
- **Recommended build (Python, extend `tools/build_geo.py`):**
  1. Download NE 5.1.2 10m admin-0 (default **and** CHN-POV) and admin-1.
  2. Cut at the antimeridian (`antimeridian.fix_polygon`, Apache-2.0, 0.4.9; or `shapely` split).
  3. Drop Antarctica unless needed.
  4. Simplify with `mapshaper -simplify 1% keep-shapes` (MPL-2.0; build-time only, not shipped).
  5. Quantize TopoJSON at 1e5.
  6. Keep a properties whitelist: `ADM0_A3`, `ISO_A3_EH`, `ISO_N3_EH`, `NAME`, `NAME_ZH`, `CONTINENT`, `REGION_UN`, `SUBREGION`, plus a label point (`LABEL_X`/`LABEL_Y` exist in NE).
  7. Emit `vendor/geo-world/world-10m-1pct.js` → `RK.geo.register('world', topo)`.
  8. Ship a **centroid/label-point table for all ISO codes**, so micro-states missing at small scale can still be drawn as dots.

**Winding / spherical vs planar rule (learned the hard way, p16):**
- d3, Plot and ECharts-with-d3-projection expect d3 winding: clockwise exteriors on the sphere.
- After a planar cut (`reflectY`), winding is reversed. The fill is fine for Leaflet and MapLibre, but **inverted for d3** (the polygon fills the globe).
- Keep both `raw` and `cut` variants (or cut on demand), and assert `d3.geoArea(f) < 2π` in tests.

### 6.3 China map data + compliance (中国地图合规)

**Legal facts:**
- Under the PRC 地图管理条例 (2015) and 地图审核管理规定 (2017, amended 2019), maps shown publicly need **map review (审图号)**.
- Directly using 自然资源部-provided public-interest maps that already carry a 审图号 needs no new review.
- The 标准地图服务 (http://bzdt.ch.mnr.gov.cn/) offers free downloads. Using them **directly** requires printing the 审图号. Any edit to map content, "including enlarging, shrinking or cropping", must be reviewed before public use.
- Sources:
  - https://cn.chinadaily.com.cn/a/202308/28/WS64ec4ceba3109d7585e4b1e1.html
  - https://www.news.cn/politics/2023-08/29/c_1129831410.htm
  - https://www.163.com/dy/article/EO8EAICG05366JV6.html (regulation text transcription)

**Practical consequences:**
- "问题地图" (incorrect maps: missing Taiwan, South China Sea islands/dash line, 藏南 or 阿克赛钦 drawn per de facto lines) is a reputational and legal risk for a bank serving PRC clients.
- Microsoft: "2D Map Charts and 3D Maps are no longer available for China Excel users… suspended and there is no available workaround" (https://support.microsoft.com/en-us/Support/known-issues/excel-2d-map-charts-and-3d-maps-are-suspended-for-china).

**Data sources and licences:**

| Source | Licence / terms | Compliance | Verdict |
|---|---|---|---|
| **DataV.GeoAtlas** (阿里云, data from 高德) — the usual ECharts China GeoJSON | "数据来自高德开放平台，**仅供学习和交流使用**"; copyright questions → 高德 | Has PRC boundaries, but no licence for commercial redistribution | **avoid** for deliverables (https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/) |
| Natural Earth admin-0 CHN-POV + admin-1 | public domain | PRC worldview for country outlines and the 9-dash line; admin-1 is de facto (no Taiwan provinces under CHN; Arunachal in India) → **not** equal to a reviewed 标准地图 | consider for **global** audiences; not for PRC-public use without review |
| 标准地图 (自然资源部) | free; unmodified use with 审图号 | compliant as-is | use as a **static image** (PNG/SVG) when a China map is shown to a PRC audience and no interactivity is needed |
| geoBoundaries (gbOpen) | CC BY 4.0 (attribution) | US State Dept. disputed-area definitions (CGAZ) → not PRC-compliant | consider for non-China admin-1 elsewhere |
| GADM | "Redistribution or commercial use is not allowed without prior permission" | — | **avoid** (https://gadm.org/license.html) |
| @surbowl/world-geo-json-zh 2.1.5 | Unlicense | NE 1:50m simplified, adjusted against 标准地图 GS(2023)2767 **and DataV** (Taiwan merged, 十段线 included) | reference (mixed provenance via DataV) |
| china-map-echarts 1.0.5 (ISC), echarts-china-provinces-js (MIT), china-geojson | permissive package licence, but **unclear upstream data provenance** (likely DataV/AMap) | — | avoid unless provenance is documented |
| @svg-maps/china 2.0.0 | CC-BY-4.0 | unknown | reference |
| province-city-china 9.0.0 | MIT | GB/T 2260 admin codes (no geometry) | **adopt** for code ↔ name joins |
| world-geojson 3.5.3 | **GPL-3.0-or-later** | — | **avoid** |

**Recommendation for the kit:**
- (a) A `china-provinces` basemap built from NE admin-1 with `name_zh` + ISO 3166-2 + GB/T 2260 adcode join keys. Flag it in its manifest as `compliance: "de facto / not PRC-reviewed"`.
- (b) A **`tile-grid` China province cartogram** component: squares or hexes on a hand-tuned grid, including 台湾, 香港 and 澳门 tiles, plus an optional South China Sea note.
  - It conveys the metric without drawing boundaries. This is pitchbook-friendly (equal visual weight per province) and avoids geometry compliance issues.
- (c) For PRC-public deliverables, allow a licensed or reviewed base map dropped in as a data file, with the 审图号 rendered in the footnote automatically.
- (d) Get compliance/legal sign-off as a process step, not a code feature.

### 6.4 PMTiles details

- **pmtiles 4.5.0** (BSD-3, 2026-08-10): classic IIFE `dist/pmtiles.js` (global `pmtiles`), 20 KB / 8 KB gzipped.
  - Under file://, `new PMTiles(url)` fails ("URL scheme 'file' is not supported").
  - A custom `Source {getKey, getBytes(offset,len)}` over an `ArrayBuffer` decoded from a base64 JS file works in both protomaps-leaflet and MapLibre 5 (`addProtocol`).
- **go-pmtiles CLI** (BSD-3):
  - `pmtiles extract IN OUT --bbox=… --maxzoom=N` (the source must be clustered);
  - `pmtiles convert x.mbtiles x.pmtiles`;
  - `pmtiles serve` for served mode.
- **Protomaps basemap** is an "ODbL Produced Work". Keep "© OpenStreetMap contributors" attribution visible.
  - Embedding the *tiles file* itself arguably distributes a database extract. Have legal review the ODbL obligations if PMTiles is ever shipped to clients; Natural Earth avoids the question entirely.

---

## 7. 五个用例的具体方案 (concrete stack per use case)

### 7.1 World choropleth by country (世界分级设色)
- **Engine:** Leaflet 1.9.4 SVG (kit `choropleth`).
  - Switch to the ECharts `map` series when you need (a) an equal-area or Pacific-centred projection, (b) a `visualMap` range-drag filter, or (c) a map↔bar morph to rank the same countries ("where" → "how much").
- **Basemap:** NE 5.1.2 10m@1% keep-shapes (default worldview, or CHN-POV for China-facing decks), antimeridian-cut for Leaflet, raw for d3 projections. Drop Antarctica.
- **Join:** ISO alpha-3 via `ADM0_A3` / `ISO_A3_EH`, with ISO numeric as a fallback; normalise "Kosovo" (XKX/KOS) and "N. Cyprus" explicitly.
  - Report unmatched rows in a dev overlay; the kit's sample data has the same need.
- **Encoding:**
  - Classed sequential with 5–7 bins (quantile → nice-rounded breaks; the kit already does this).
  - Diverging around a benchmark for growth.
  - **Hatched "no data"** via SVG `<pattern>`.
  - Micro-states: draw a 3 px coloured dot at the NE label point when the polygon is < 2 px².
  - Bivariate 3×3 (e.g. growth × margin) as an advanced option.
- **Interaction:** hover tooltip (value, rank, extra fields); click → cross-filter; legend click → highlight a class; `fitBounds` to countries with data.
- **Motion:** colour tween via CSS `transition: fill .45s` on `.leaflet-interactive` (SVG only); staggered fade-in by region.
- **Print:** SVG stays vector. Set fixed dimensions in `@media print`, then call `invalidateSize()`.

### 7.2 Bubble map of offices / assets (办公室/资产气泡图)
- **Engine:** Leaflet `L.circleMarker` in a dedicated pane, using the kit `bubble-map`.
  - Radius = `sqrt(value/max) × rMax` (area-true).
  - Draw bubbles **largest first** so small ones sit on top.
  - Nested reference-circle legend.
  - Colour = segment/category (clickable legend) or a metric ramp.
  - Shape channel via `leaflet-svg-shape-markers` or ECharts `scatter` `symbol`. Shapes beyond 3–4 categories become unreadable.
- **Pie/donut per location** (e.g. AUM by asset class per office): ECharts `pie` with `coordinateSystem:'geo'` (verified p12), or a hand-rolled SVG `L.divIcon` donut of about 60 lines. **Never use `leaflet.minichart` (GPL).**
- **Dense (>200 points):** markercluster with `iconCreateFunction` → SVG donut split by category, size by count or sum (kit `cluster-map`). For >50k points use `supercluster` 9.1.0 (ISC, 4 KB gzipped) with your own rendering.
- **Labels:** top-N by size with collision hiding; target company highlighted in accent-2 (kit already does this).
- **Motion:** grow-in radius tween with `requestAnimationFrame` (Leaflet draws circleMarkers as `<path>`, so CSS `r` transitions do not apply); ECharts `effectScatter` ripple for "HQ" emphasis.

### 7.3 Cross-border M&A flow map (跨境并购流向图)
- **Engine:** Leaflet SVG with **own quadratic Bézier arcs** (kit `flow-map`, `RK.geo.arc`).
  - Width ∝ value (linear, 1–9 px). Colour = sector, or source→target gradient.
  - Arrowheads at the destination (direction must survive print).
  - Node circles sized by in+out totals, with a net-flow tooltip.
  - Parallel flows fan out. Aggregate to top-N plus "Other", or by region, when there are more than ~60 flows.
- **Avoid great-circle plugins (Leaflet.Arc).** They wrap across the date line (p1).
  - For Americas↔Asia flows, a Pacific-centred view reads better. Use the ECharts `lines` series with `projection = d3.geoEqualEarth().rotate([-150,0])` and the raw geometry. In Leaflet the only option is shifting longitudes by +360.
- **ECharts alternative (fastest high polish):**
  - `lines` with `effect: {show:true, symbol:'arrow', trailLength}` and `curveness:.25`;
  - `effectScatter` nodes;
  - `large:true` for thousands of lines;
  - brush/legend filtering.
- **Big-data alternative:** deck.gl `ArcLayer` (`getSourceColor`/`getTargetColor`, `getHeight`, `greatCircle`), with `transitions` for animated re-filtering. flowmap.gl for OD clustering (served mode).
- **Motion:** CSS `stroke-dasharray`/`stroke-dashoffset` draw-in using `pathLength="1"`, then travelling dots (the kit does dots and respects `prefers-reduced-motion`).

### 7.4 China province map (中国省级地图)
- **Engine:** ECharts `map` with `nameProperty:'name_zh'` (or an adcode property) and `projection` = `d3.geoConicEqualArea().parallels([25,47]).rotate([-105,0])` (verified p16).
  - Add `visualMap` piecewise, labels for the top N, and `specialAreas` for a South China Sea inset if the geometry includes it.
  - Leaflet alternative: Proj4Leaflet `+proj=aea +lat_1=25 +lat_2=47 +lon_0=105` (p14).
- **Data:** see §6.3.
  - For non-PRC audiences, NE admin-1 China at 5% (25 KB).
  - For PRC audiences, a reviewed/licensed base or the **tile-grid cartogram**.
  - Joins: GB/T 2260 adcode (e.g. 110000 北京) via `province-city-china` (MIT), or ISO 3166-2:CN letter codes (`CN-BJ`). NE uses the post-2017 letter codes.
- **Encodings:** province choropleth; city bubbles via scatter on geo; inter-provincial flows via `lines`.
- **Avoid** DataV/AMap GeoJSON in deliverables (licence), even though most ECharts tutorials use it.

### 7.5 Density heatmap (密度热力图)
- **Prefer hexbin for pitchbooks.** A hexbin has a quantitative legend ("deals per hex"), prints crisply and is honest about counts. Blur heatmaps are "relative density" only.
  - Options: `@asymmetrik/leaflet-d3` hexbin (verified), `Plot.hexbin` for static maps, or own d3-hexbin over a Leaflet SVG overlay.
- **Leaflet.heat** (kit `geo-heat`) for ≤ ~10k points as an atmospheric layer.
  - Always set `maxZoom` (the intensity scales by `1/2^(maxZoom − zoom)`, capped at 2^12).
  - Theme gradient. Toggle to reveal points.
- **ECharts heatmap on geo** (verified p15). It is a raster image even with the SVG renderer.
- **100k–1M points:** deck.gl `HeatmapLayer` / `HexagonLayer` (`gpuAggregation:true`) / `H3HexagonLayer` (with h3-js 4.5.0, Apache-2.0, 65 KB gzipped), lazy-loaded.

---

## 8. 多维编码手册 (multi-dimensional encodings on maps)

| Channel | Good for | How (Leaflet / ECharts / deck) | Pitfalls |
|---|---|---|---|
| Fill colour (polygon) | rates, shares, growth | `style(f)` / `visualMap` / `getFillColor` | area bias (Russia dominates), so use equal-area projections or tile grids; never map totals to choropleth colour |
| Size (area) | additive totals (revenue, AUM, deal value) | `circleMarker` radius = sqrt / `symbolSize` callback / `getRadius` (metres) or `radiusUnits:'pixels'` | linear radius exaggerates; occlusion, so draw large first; nested legend |
| Colour (symbol) | category or a second metric | palette / visualMap `dimension` / `getFillColor` | ≤ 7 categories |
| Shape | category (≤ 4) | svg-shape-markers / `symbol` / IconLayer | poor at small sizes |
| Opacity (value-by-alpha) | confidence, sample size | `fillOpacity` / `itemStyle.opacity` | interacts with overlaps |
| Pie / donut per location | composition by place | ECharts pie on geo / divIcon SVG | ≤ 4 slices; size it by total |
| Bar / spike glyph | magnitude without overlap | ECharts `custom` series / thin `L.polygon` triangles / deck ColumnLayer | needs a baseline legend |
| Flow width + colour | OD volume + type | SVG Bézier / `lines` / ArcLayer | hairballs; aggregate |
| Density | concentration | heat / hexbin / contour (`Plot.density`) | relative vs absolute |
| Time | evolution | own slider + `setStyle` / ECharts `timeline` component / deck `TripsLayer`, `DataFilterExtension` | animate by tweening, not redraw |
| Small multiples | compare metrics/periods | Leaflet.Sync / ECharts multiple `geo` / Plot `fx` facets | keep a common scale |
| Tile-grid cartogram | equal weight per region; compliance-safe China | ECharts `custom`/heatmap on category axes, or plain SVG | users must learn the layout; label tiles |

---

## 9. 交互、动效、打印 (interaction, motion, print)

- **Zoom/pan:**
  - Leaflet native: `zoomSnap 0.25`, `fitBounds` padding, `maxBounds`.
  - ECharts `roam: true|'scale'|'move'` with `scaleLimit`.
  - In scrolling reports, require Ctrl/⌘ + wheel (gesture handling).
- **Cross-filter:**
  - Leaflet click on a feature or marker → kit event bus.
  - ECharts `brush` with `geoIndex` (rect/polygon lasso) → `brushSelected` gives `dataIndex` per series (verified).
  - deck `pickable` + `onClick`.
- **Dynamic re-render:**
  - Leaflet: keep one `L.geoJSON` layer and call `setStyle` (choropleth), or diff markers by key (bubbles).
  - ECharts: `setOption` merge with stable `id`/`name` gives an animated update.
  - deck: new layer instances with the same `id` plus `transitions`.
- **Motion vocabulary:** grow-in, colour tween, arc draw-in, travelling dots, ripple, map↔bar morph (`universalTransition`), `flyToBounds` story steps. Respect `prefers-reduced-motion` (the kit's motion module does).
- **Print / PDF:**
  - SVG engines (Leaflet SVG, ECharts SVG, Plot) print as vectors.
  - WebGL/canvas (deck, MapLibre, L7, OL, Leaflet canvas, heatmaps) print as rasters. Render at 2× and set `preserveDrawingBuffer` where available for snapshot export.
  - Hide zoom controls in print. Keep attribution and source notes.

---

## 10. 对 ReportKit 的具体建议 (actionable for this repo)

1. **Fix the antimeridian streaks in the shipped basemap.** `vendor/geo-world/world-110m.js` is raw world-atlas, so the Leaflet components inherit the Russia/Fiji/Antarctica streaks (seen in p1).
   - Pre-cut in `tools/build_geo.py` (shapely or `antimeridian`).
   - Or, at runtime, cut in `RK.geo.features()` when `d3.geoProject` is present.
   - Keep the raw geometry for ECharts-with-projection.
2. **Upgrade the world basemap** to NE 5.1.2 10m @1% keep-shapes (~109 KB, similar to the current file), so SG, HK, MO, BH, MT, KY and BM exist.
   - Add `iso_a3` and `name_zh` properties.
   - Ship two worldviews: `world` (de facto) and `world-cn` (CHN POV).
   - Add a full **label-point table** keyed by ISO for bubbles and fallbacks.
3. **Add ECharts-based geo components (no new vendor code):**
   - `pie-map` (pies on geo);
   - `map-bar-morph` (choropleth ↔ ranked bar);
   - `china-map` (ECharts + d3 conic; requires vendoring d3-geo + d3-geo-projection, 36 KB gzipped, ISC);
   - `tile-grid-map` (China provinces / world regions / US states).
4. **Vendor small utilities:** d3-geo 3.1.1 + d3-geo-projection 4.0.0 (ISC). Optionally Proj4Leaflet 1.0.2 + proj4 2.22.0 for equal-area Leaflet, and d3-hexbin 0.2.2 (BSD-3) for a `hexbin-map` component without full d3.
5. **Keep deck.gl 9.4 as an optional, lazily loaded "big-data map" engine.** It is 575 KB gzipped. Gate it behind a manifest flag; it is not in the default bundle.
6. **Do not vendor** MapLibre 6 (ESM-only), L7, kepler.gl or leaflet.minichart (GPL). Document MapLibre 5.24.0 UMD as the only offline-capable MapLibre build.
7. **Test hooks:**
   - assert there are no antimeridian jumps;
   - assert `d3.geoArea < 2π` for d3-fed features;
   - assert every data row joins to a feature;
   - block network requests in smoke tests (as in §2) to guarantee offline behaviour;
   - leaflet.heat/markercluster: assert the map has a finite `maxZoom`.
8. **Compliance metadata in basemap manifests:** `worldview`, `source`, `licence`, `attribution`, `prc_reviewed:false`, and an optional `审图号` string rendered in the footnote.

---

## 11. Sources

- Leaflet: https://github.com/Leaflet/Leaflet/releases · https://leafletjs.com/2025/05/18/leaflet-2.0.0-alpha.html · https://talks.osgeo.org/foss4g-2026/talk/VK8SSV/ · https://pretalx.com/fossgis2026/talk/CVEQQA/ · https://gitlab.com/jkuebart/Leaflet.VectorTileLayer/-/issues/26 · https://github.com/Falke-Design/Leaflet-V1-polyfill · npm registry (leaflet dist-tags: latest 1.9.4, alpha 2.0.0-alpha.1)
- Leaflet plugins:
  - https://github.com/Leaflet/Leaflet.heat
  - https://github.com/Leaflet/Leaflet.markercluster
  - https://github.com/rubenspgcavalcante/leaflet-ant-path
  - https://github.com/mad-gooze/Leaflet.Arc
  - https://github.com/bluehalo/leaflet-d3
  - https://github.com/socib/Leaflet.TimeDimension
  - https://github.com/jieter/Leaflet.Sync
  - https://github.com/robertleeplummerjr/Leaflet.glify
  - https://github.com/humangeo/leaflet-dvf
  - https://github.com/rte-antares-rpackage/leaflet.minichart (GPL-2.0+)
  - https://github.com/lit-forest/leaflet.migrationLayer
  - https://github.com/jwasilgeo/Leaflet.Canvas-Flowmap-Layer
  - https://github.com/kartena/Proj4Leaflet
  - https://github.com/protomaps/protomaps-leaflet
  - https://github.com/manubb/Leaflet.PixiOverlay
- MapLibre 6.0.0 ESM-only: https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md
- deck.gl: https://deck.gl/docs/whats-new
- ECharts:
  - https://echarts.apache.org/handbook/en/basics/release-note/v6-feature
  - https://github.com/apache/echarts/issues/16364 (projection.stream)
  - https://echarts.apache.org/examples/en/editor.html?c=map-bar-morph ("Morphing between Map and Bar")
- Natural Earth:
  - https://www.naturalearthdata.com/about/disputed-boundaries-policy/
  - https://github.com/nvkelso/natural-earth-vector (CHANGELOG 5.1.2 / 5.2.0; POV files `ne_10m_admin_0_countries_chn`, `ne_10m_admin_0_boundary_lines_maritime_indicator_chn`)
- world-atlas: https://github.com/topojson/world-atlas (README: Natural Earth 4.1.0, spherical coordinates)
- Tile policies: https://operations.osmfoundation.org/policies/tiles/ · https://docs.carto.com/faqs/carto-basemaps · https://www.carto.com/basemaps/apikey/
- Protomaps / PMTiles: https://docs.protomaps.com/basemaps/downloads · https://docs.protomaps.com/pmtiles/cli · https://github.com/protomaps/PMTiles
- China:
  - https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/ ("仅供学习和交流使用")
  - https://cn.chinadaily.com.cn/a/202308/28/WS64ec4ceba3109d7585e4b1e1.html (标准地图 use rules)
  - https://www.news.cn/politics/2023-08/29/c_1129831410.htm
  - https://www.163.com/dy/article/EO8EAICG05366JV6.html (地图审核管理规定 text)
  - https://support.microsoft.com/en-us/Support/known-issues/excel-2d-map-charts-and-3d-maps-are-suspended-for-china
  - https://github.com/Surbowl/world-geo-json-zh
- Boundaries licences: https://gadm.org/license.html · geoBoundaries via https://developers.google.cn/earth-engine/datasets/catalog/WM_geoLab_geoBoundaries_600_ADM1
- Tools: https://github.com/gadomski/antimeridian (Apache-2.0) · https://github.com/mbloch/mapshaper (MPL-2.0)
- Stars: https://repos.ecosyste.ms (queried 2026-10-14)
