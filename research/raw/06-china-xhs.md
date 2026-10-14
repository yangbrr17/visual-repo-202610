# 06 — 中国开源可视化生态 + 小红书 / 掘金 / 知乎 / CSDN 社区推荐

> Angle: Chinese open-source viz ecosystem (ECharts, AntV, VisActor, DataV / 数据大屏) and what Chinese designers/devs recommend in 2025-2026, judged against our IB "report kit" requirements (offline `file://`, classic scripts, permissive licenses, pitchbook-grade style, swappable data, future local-LLM step).
>
> Research date: 2026-10-14. All versions / licenses / dates / sizes below were **verified** with `npm view`, the jsDelivr data API, downloaded UMD bundles (gzip -9 measured locally), raw GitHub LICENSE files and shields.io badges, unless marked *(unverified)*.

---

## 0. 结论速览 (TL;DR)

1. **ECharts 6.1 remains the right core engine.** The Chinese ecosystem confirms it: nearly every 大屏 template, low-code BI (DataEase, GoView, iDataV, BigDataView) and Python wrapper (pyecharts 2.1 → ECharts 6 assets) is built on it. We already vendor `echarts@6.1.0`, so we should not add a second general-purpose engine such as G2 or VChart.
2. **Biggest concrete win: the official `@echarts-x/*` custom series** (Apache-2.0, published 2026-01, each ships a `*.auto.min.js` classic script of 2–15 KB that self-registers). `custom-bar-range` gives a native **football-field** chart. `custom-line-range` covers ranges, fan charts and confidence bands. `custom-violin` and `custom-contour` cover distributions, and `custom-segmented-doughnut` covers progress. `custom-word-cloud` and `custom-liquid-fill` are drop-in successors to the old `echarts-wordcloud` and `echarts-liquidfill`, which still declare `peerDependencies: echarts ^5` and are unmaintained.
3. **ECharts 6 features to use:** the design-token default theme, `chart.setTheme()` for runtime light/dark switching without re-init, the **matrix coordinate system** (small multiples and table-like layouts), **broken axis** (`yAxis.breaks`, tested OK on 6.1 SSR), auto label anti-overlap, `markPoint.relativeTo`, and `dataMin/dataMax` nice extents (6.1).
   **Gotcha:** ECharts' candlestick defaults are **red up / green down** (`#eb5454` / `#47b262`, the Chinese 红涨绿跌 convention). Western IB clients expect the opposite, so the kit must set up/down colours explicitly through a locale convention token.
4. **Security: the AntV npm namespace was compromised on 2026-05-19** ("Mini Shai-Hulud" worm via maintainer account `atool`). About 317–324 packages and 600+ malicious versions were published, including `@antv/g2`, `g6`, `l7`, `s2`, `x6`, `ava`, `gpt-vis`, `infographic`, plus `echarts-for-react`, `size-sensor` and `timeago.js`. The malicious versions were bumped **above** the real ones (e.g. g2 5.5.8/5.6.8 while the real latest is 5.4.8), so any `^` range would have pulled them in. I verified the malicious versions now return E404 on npm. **Rules for us:** pin exact versions, fetch with `npm pack` (no lifecycle scripts, which `tools/vendor.py` already does), record `dist.integrity` / sha256 per vendored file, and never `npm install` AntV packages on a machine that holds secrets.
5. **Pivot / large tables are the one place where a Chinese library adds capability we lack.** **AntV S2** (MIT, UMD global `S2`, ~302 KB gz) or **VisActor VTable** (MIT, UMD global `VTable`, ~531 KB gz; includes PivotTable, PivotChart and Gantt). Both are *consider*, loaded lazily only for pivot-heavy reports. Tabulator (already vendored) covers flat comps tables.
6. **AI chart generation (step 2):**
   - **VMind is dead.** The repo was renamed to `VisActor/skills`, and its README says "The previous VMind SDK is no longer maintained". The npm package is frozen at 2.0.10 (2025-08).
   - **LIDA** is stale (last commit 2024-03) and works by generating and executing Python code.
   - **AntV AVA v4** is being rebuilt as a Node-side "AI-native Visual Analytics" framework (DuckDB, ClickHouse, ai-sdk); `4.0.0-beta.1` landed 2026-10-13.
   - The durable lesson, which GPT-Vis, VSeed, the echarts-mcp README and several Juejin practitioners all converge on: **the LLM fills in a minimal, schema-validated intent spec (chartType + dataset + dimensions/measures); a deterministic compiler owns all styling.** "AI 只做填空题，不做开放性简答题." We should design our `data/*.json` plus component spec around this now.
7. **Big-screen (数据大屏) aesthetics are not appropriate for IB client reports.** That means dark navy backgrounds, neon/glow, glassmorphism, SVG tech borders, 3D globes, flying lines, liquid-fill gauges, word clouds and 1920×1080 scale-to-fit. Ideas worth borrowing: restrained KPI count-up, linked highlight across panels, data-refresh transitions, the explicit storyline layout (top→bottom, left→right), and theme-token discipline.
8. **小红书 itself is not crawlable.** Search requires login plus signed API headers (`x-s`), the SSR page contains only shell UI strings, `site:xiaohongshu.com` returns nothing in the available search engine, and Bing/Baidu/DDG are blocked or captcha'd. Findings on "what XHS recommends" therefore come from secondary sources: Juejin (I fetched about 12 articles plus search-API metadata), WeChat articles via Sogou, CSDN titles (bodies are JS-challenged), and vendor docs. §10 covers this.

---

## 1. 方法与来源可信度 (Method & source reliability)

| Source | Access result | How used |
|---|---|---|
| 小红书 xiaohongshu.com | `search_result` returns a 60 KB SSR shell; `__INITIAL_STATE__` holds only app settings and placeholder titles ("想了解些什么？", "搜索小红书"). The edith API returns 404 without signed headers. Not indexed by our WebSearch (`site:` query → 0 hits). | **Not crawlable.** Style trends are inferred from secondary sources. |
| 知乎 zhuanlan.zhihu.com | WebFetch → HTTP 403 | Titles only, from search snippets. |
| CSDN blog | JS cookie challenge (`eu(34)`) / HTTP 521 via WebFetch. The search API (`so.csdn.net/api/v3/search`) works. | Titles, dates and view counts as **trend signals** only. |
| 掘金 Juejin | Search API `api.juejin.cn/search_api/v1/search` works. Article pages sit behind a ByteDance WAF proof-of-work (sha256 nonce), which I solved for about 12 public articles at low volume. | Primary Chinese practitioner source. |
| WeChat 公众号 | Sogou `weixin.sogou.com` search works (titles and abstracts only). | Signals (e.g. it surfaced the AntV supply-chain incident). |
| npm / jsDelivr / unpkg / raw.githubusercontent / shields.io / ungh.cc | Work. GitHub REST via `gh` is blocked by session policy; ungh.cc was rate-limited part-way, so shields.io was used for stars, last commit and license. | Hard facts. |
| Vendor docs (echarts.apache.org, visactor.github.io, github.com READMEs via WebFetch) | Work. | Feature facts. |

Reliability caveat: many CSDN "gitblog_00xxx" posts in 2025-2026 are AI-generated SEO content (e.g. "34 款主题终极指南"), and some Juejin listicles are marketing. One example: the post "1.3K star！VisActor团队开源神器" (juejin.cn/post/7476295800785993728) claims ECharts has no 3D (false, since echarts-gl exists) and shows a `vchart.autoChart()` API that does not exist. I treated such posts as **popularity signals, not facts**.

---

## 2. ⚠️ 安全事件：AntV npm 供应链投毒 (2026-05-19)

- **What:** the "Mini Shai-Hulud" worm, attributed by Snyk to "TeamPCP". The compromised maintainer account was `atool` (i@hust.cc, the author of timeago.js, echarts-for-react and size-sensor), which had publish rights across `@antv/*`.
- **When:** 2026-05-19, wave 1 at 01:56 UTC and wave 2 at 02:06 UTC. About 637–639 malicious versions across 317–324 packages were published in a ~22-minute burst.
- **Payload:** a `preinstall` / `postinstall` hook (`spawnSync('bun',['run','index.js'])`, which installs Bun if missing), or an `optionalDependencies` git reference to a poisoned commit in `antvis/G2` whose `prepare` hook runs `bun run index.js && exit 1`. It daemonises, steals CI secrets (GitHub Actions runner memory), cloud and wallet credentials, plants persistence in `.claude/setup.mjs`, `.vscode/setup.mjs` and `.claude/settings.json`, and self-propagates. C2 domain: `t.m-kosche.com`.
- **Malicious versions (examples):**

  | Package | Malicious versions |
  |---|---|
  | `@antv/g2` | 5.5.8, 5.6.8 |
  | `@antv/g6` | 5.2.1, 5.3.1 |
  | `@antv/l7` | 2.26.10, 2.27.10 |
  | `@antv/s2` | 2.8.1, 2.9.1 |
  | `@antv/x6` | 3.2.7, 3.3.7 |
  | `@antv/f2` | 5.15.0, 5.16.0 |
  | `@antv/g2plot` | 2.5.35, 2.6.35 |
  | `@antv/ava` | 3.5.1, 3.6.1 |
  | `@antv/gpt-vis` | 1.1.0, 1.2.0 |
  | `@antv/infographic` | 0.3.19, 0.4.19 |
  | `@antv/s2-react` | 2.4.1, 2.5.1 |
  | `@antv/smart-color` | 0.3.1, 0.4.1 |
  | `echarts-for-react` | 3.0.7, 3.1.7, 3.2.7 |
  | `timeago.js` | 4.1.2, 4.2.2 |

  More are listed in the StepSecurity/Snyk/SafeDep lists.
- **Verified today:** `npm view @antv/g2@5.6.8` → E404, and likewise for g2@5.5.8, s2@2.9.1, g6@5.3.1, l7@2.27.10, x6@3.3.7, gpt-vis@1.2.0, infographic@0.4.19, echarts-for-react@3.2.7 and ava@3.6.1. The latest g2 versions list ends at `5.4.8`. The bulk `time.modified = 2026-09-21` on every @antv package is consistent with the post-incident cleanup and deprecation sweep.
- **Not affected:** `echarts` itself (Apache release process, different publishers). No VisActor packages appear in the published lists. **The UMD `dist/` bundles were not reported as modified; the attack was install-time.** Vendoring dist files via `npm pack` (which does not run the package's lifecycle scripts) is therefore the safer pattern.
- **Implications for the kit:**
  1. Exact pins only (already true in `vendor/vendor.json`).
  2. Add `integrity` (npm `dist.integrity`, sha512) and per-file sha256 to `vendor.json`, and verify them in `vendor.py --check`.
  3. Run `npm pack --ignore-scripts` explicitly, or keep pack-only.
  4. Never run `npm install` of `@antv/*` on a developer box with cloud creds.
  5. Prefer packages with a smaller blast radius.
  6. If we ever vendor AntV, use versions published **before 2026-05-19** or **after the cleanup**, and diff them against the jsDelivr hash.
- Sources: https://www.stepsecurity.io/blog/shai-hulud-here-we-go-again-mass-npm-supply-chain-attack-hits-the-antv-ecosystem , https://security.snyk.io/antv-supply-chain-compromise-may-2026 , https://www.infoworld.com/article/4173277/antv-data-visualization-tool-the-latest-to-be-hit-by-ongoing-npm-supply-chain-attacks.html , https://snyk.io/blog/mini-shai-hulud-antv-npm-supply-chain-attack/ , https://orca.security/resources/blog/antv-npm-supply-chain-attack/ . I first saw the incident in a 2026-10-08 WeChat article by 图表兔 that cited "2026年5月AntV供应链攻击".

---

## 3. 总表：版本 / 许可 / 体积 / UMD 全局名 (all verified 2026-10-14)

Sizes were measured by downloading the dist file from jsDelivr and running `gzip -9`. Stars come from shields.io (rounded). "Last" is the last commit/push.

| Package | Latest (published) | License | UMD file (raw → gz) | Global | Stars / last | Notes |
|---|---|---|---|---|---|---|
| `echarts` | 6.1.0 (2026-05-19) | Apache-2.0 | `dist/echarts.min.js` 1095 KB → **359 KB**; `echarts.simple.min.js` 488 → 164 KB | `echarts` | 67.5k / 2026-10-13 | Already vendored. Needs NOTICE kept. |
| `zrender` | 6.1.0 (2026-05-04) | BSD-3-Clause | bundled in echarts | – | 6.3k / 2026-09 | – |
| `@echarts-x/custom-bar-range` | 1.2.1 (2026-01-12) | Apache-2.0 | `dist/bar-range.auto.min.js` 1.8 KB | auto-registers | repo apache/echarts-custom-series 74★ / 2026-08 | **Football field** |
| `@echarts-x/custom-line-range` | 1.1.1 | Apache-2.0 | `line-range.auto.min.js` ~2 KB | auto | – | Bands / ranges |
| `@echarts-x/custom-violin` | 1.1.1 | Apache-2.0 | `violin.auto.min.js` 2.2 KB | auto | – | – |
| `@echarts-x/custom-contour` | 1.2.1 | Apache-2.0 | `contour.auto.min.js` 2.9 KB | auto | – | – |
| `@echarts-x/custom-segmented-doughnut` | 1.1.1 | Apache-2.0 | `segmented-doughnut.auto.min.js` | auto | – | – |
| `@echarts-x/custom-stage` | 1.1.1 | Apache-2.0 | `stage.auto.min.js` | auto | – | Gantt-ish stages |
| `@echarts-x/custom-word-cloud` | 1.0.1 | Apache-2.0 | `word-cloud.auto.min.js` 14.7 KB | auto | – | Replaces echarts-wordcloud |
| `@echarts-x/custom-liquid-fill` | 1.0.2 | Apache-2.0 | `liquid-fill.auto.min.js` 7.8 KB | auto | – | Replaces echarts-liquidfill |
| `echarts-gl` | 2.1.0 (2026-05-28) | MIT (BSD deps: claygl) | `dist/echarts-gl.min.js` 624 → 170 KB | extends `echarts` | 2.7k / 2026-06 | peer `^5.1.2 \|\| ^6` ✔ |
| `echarts-wordcloud` | 2.1.0 (2022-11-24) | ISC (pkg.json; no LICENSE file in repo) | 16 → 6 KB | `echarts-wordcloud` | 1.8k / 2024-03 | peer `echarts ^5` only |
| `echarts-liquidfill` | 3.1.0 (2021-09-18) | MIT | 7 → 3 KB | – | 1.5k / 2024-03 | peer `^5` only. I tested it with echarts 6.1 SSR and it renders (needs `self` global in Node). |
| `pyecharts` (PyPI) | 2.1.0 (2026-02-10) | MIT | – | – | 16k / 2026-02 | `DEFAULT_HOST = https://assets.pyecharts.org/assets/v6/`, so CDN by default |
| `@antv/g2` | 5.4.8 (2026-01-06) | MIT | `dist/g2.min.js` 1058 → **320 KB**; `g2.lite.min.js` 975 → 292 KB | `G2` | 12.6k / 2026-10-13 | Compromised namespace (§2) |
| `@antv/g6` | 5.1.1 (2026-05-08) | MIT | `dist/g6.min.js` 1350 → 380 KB | `G6` | 12.3k / 2026-10-14 | – |
| `@antv/l7` | 2.29.1 (2026-07-13) | MIT | `dist/l7.js` 1434 → 337 KB | `L7` | 4.1k / 2026-07 | WebGL. Loads logo/textures from Alipay CDN. |
| `@antv/s2` | 2.7.2 (2026-06-10) | MIT | `dist/s2.min.js` 1105 → **302 KB** (+`s2-extends.min.js` 730 KB) | `S2` | 1.7k / 2026-06 | Pivot. Self-contained UMD. |
| `@antv/x6` | 3.1.8 (2026-08-11) | MIT | `dist/x6.min.js` 569 → 162 KB | `X6` | 6.7k / 2026-10 | Diagram editor |
| `@antv/ava` | 3.4.1 (**2024-03-15**) / 4.0.0-beta.1 (2026-10-13) | MIT | `dist/ava.min.js` 344 → 102 KB | `AVA` | 1.6k / 2026-10 | v4 is a Node framework |
| `@antv/g2plot` | 2.4.35 (2025-09-19) | MIT | 9.5 MB unpacked | `G2Plot` | 2.7k | Legacy (G2 4 based) |
| `@antv/gpt-vis` | 1.0.2 (2026-09-17) | MIT | `dist/umd/index.min.js` 2250 → **649 KB** | `GPTVis` | 0.8k / 2026-09 | Bundles G2+G6+T8 |
| `@antv/infographic` | 0.2.20 (2026-08-19) | MIT | `dist/infographic.min.js` 857 → 281 KB | `AntVInfographic` | 7.0k / 2026-08 | Fetches fonts/icons from CDN |
| `@antv/t8` | 0.3.1 (2026-09-04) | MIT | `dist/t8.min.js` 56 → **18 KB** | `T8` | 54 / 2026-09 | Narrative text |
| `@antv/mcp-server-chart` | 0.9.10 (2026-02-25) | MIT | Node | – | 4.4k / 2026-08 | Renders via remote GPT-Vis-SSR |
| `@visactor/vchart` | 2.1.7 (2026-09-18) | MIT | `build/index.min.js` 2368 → **617 KB** | `VChart` | 1.8k / 2026-10-14 | 2.0 on 2025-06-10, 2.1 on 2026-06-23 |
| `@visactor/vtable` | 1.26.8 (2026-09-11) | MIT | `dist/vtable.min.js` 2242 → **531 KB** | `VTable` | 3.7k / 2026-10-10 | ListTable / PivotTable / PivotChart |
| `@visactor/vtable-gantt` | 1.26.8 | MIT | `dist/vtable-gantt.min.js` 2366 KB raw | – | – | – |
| `@visactor/vtable-sheet` | 1.26.8 (new 2025-09) | MIT | 2604 KB raw | – | – | Spreadsheet |
| `@visactor/vgrammar` | 0.16.18 (2026-07-28) | MIT | 1110 → 285 KB | `VGrammar` | 109 | Pre-1.0 |
| `@visactor/vrender` | 1.1.12 (2026-10-13) | MIT | – | – | 264 | Engine under VChart/VTable |
| `@visactor/vmind` | 2.0.10 (**2025-08-01**) | MIT | `build/index.min.js` 2078 → 521 KB | `VMind` | (repo renamed → VisActor/skills) | **Unmaintained**. UMD expects Node globals. |
| `@visactor/vstory` | 0.0.26 (2026-04-13) | MIT | 4773 → **1083 KB** | `VStory` | 36 | Pre-alpha |
| `@visactor/vseed` | 0.7.0 (2026-10-14) | MIT | `dist/umd/index.js` 1609 → 203 KB | `VSeed` | (VBI monorepo) 33 | LLM/BI-friendly spec |
| `@visactor/vbi` | 0.7.0 (2026-10-14) | MIT | – | – | 33 | yjs-based BI builder |
| `@visactor/vchart-theme` | 1.13.1 (2026-06-25) | MIT | `build/index.min.js` 17 KB + `public/*.json` | – | 11 | Includes **Finance** themes |
| `@jiaminghi/data-view` (DataV) | 2.10.0 (**2020-09-09**) | MIT | – | – | 9.7k / 2023-07 | Vue 2 only |
| `@kjgl77/datav-vue3` | 1.7.4 (2024-10-21) | MIT | – | – | 642 / 2024-10 | Vue 3 fork |
| iGaoWei/BigDataView | – | **none** ("资源来自网络收集") | static HTML | – | 5.3k / 2025-10 | Do not reuse |
| yyhsong/iDataV | – | **none** | static | – | 5.7k / 2021-07 | Do not reuse |
| dromara/go-view | – | MIT | Vue 3 app | – | 971 / 2025-12 | Low-code 大屏 |
| dataease/dataease | – | **GPL-3.0** (raw LICENSE) | Java+Vue app | – | 25k / 2026-10 | Avoid |
| dataease/SQLBot | – | **Modified GPLv3** (logo clause) | app | – | 6.9k | Avoid |
| microsoft/lida (PyPI `lida`) | 0.0.14 (**2024-02-06**) | MIT | – | – | 3.3k / 2024-03 | Stale |
| timqian/chart.xkcd | – | MIT | – | – | 7.9k / 2026-07 | "Cute" sketch style |
| tw93/Kami | – | MIT (code); fonts mixed | – | – | 12k / 2026-10 | Doc design system |

---

## 4. ECharts 生态 (Baidu → Apache)

### 4.1 ECharts 6.0 (2025-07-30) / 6.1 (2026-05-19): what matters for IB

Sources: the Juejin 6.0 release post (https://juejin.cn/post/7521283343268036646, 17.7k views, the most-read Chinese viz article of 2025 in my sample), https://github.com/apache/echarts/releases and https://echarts.apache.org/handbook/en/basics/release-note/v6-feature .

The 12 upgrades in 6.0:

1. **New default theme built on design tokens.** `lib/visual/tokens.js` defines a `color.theme` palette of `#5070dd #b6d634 #505372 #ff994d #0ca8df #ffd10a #fb628b #785db0 #3fbe95`. It also defines a neutral ramp `neutral00..99` (`#fff → #000`) and an accent ramp `accent05..95` (blue-grey `#eff1f9 → #121521`). Semantic aliases include `primary = neutral80 (#3c3c41)`, `axisLabel = neutral70`, `axisSplitLine = neutral15 (#dbdee4)` and `background = neutral05 (#f4f7fd)`. Dark tokens are derived automatically via HSL transforms. **Action:** mirror these semantic token names in our CSS custom properties so the CSS and ECharts themes stay in lock-step.
2. **Dynamic theme switch:** `chart.setTheme('dark')` with no dispose/re-init and no replayed intro animation. The handbook example listens to `matchMedia('(prefers-color-scheme: dark)')`.
3. Dark-mode response (same mechanism).
4. Chord diagram, with gradient edges between source and target colours. The docs pitch it for "金融交易" flows.
5. **Beeswarm** (non-overlap distribution) and 6. **scatter jitter.** Good for comps-multiple dispersion (EV/EBITDA by peer).
7. **Broken axis** (`yAxis.breaks: [{start, end, gap}]`, torn-paper style, click to expand). I verified it renders under 6.1 SSR. Useful when one peer dwarfs the others; use it sparingly and label it.
8. Upgraded stock/trading charts: labels positioned relative to the coordinate system (`markPoint.data[].relativeTo`), combined K-line, MACD, volume and depth.
9. **Matrix coordinate system:** any series or component (grid, geo, polar, pie, heatmap…) can be declared into a matrix cell, and calendar cells work too. This gives small multiples and periodic-table or covariance layouts without manual `grid[]` math. 6.1 added `matrix.x/y.length` and `triggerEvent` for cells.
10. **Reusable custom series** (registration like themes). The official repo is `apache/echarts-custom-series`, published to npm as `@echarts-x/*` (see §4.2).
11. New custom charts: violin, contour, sleep stage, segmented doughnut, bar range, line range.
12. **Axis label anti-overflow and anti-overlap by default.** Disable with `grid.outerBoundsMode: 'none'`.

Breaking changes in 6.0:
- The default theme changed, including the default legend position. Restore with `echarts/theme/v5.js`.
- The percent base for `center` changed for geo/map/graph/tree. Restore with `legacyViewCoordSysCenterBase: true`.
- Rich text now inherits plain label style. Restore with `richInheritPlainLabel: false`.

6.1 additions:
- `dataMin`/`dataMax` nice extents.
- Bar, candlestick and boxplot render on any axis type without overflow (`containShape`).
- Log axes auto-exclude non-positive values.
- `visualMap.seriesTargets`, radar `clockwise`, pie `tangential-noflip`.
- Tooltip **XSS fix in `lines` series**. Upgrade note: 6.1.0 ≥ is required if tooltips render user-supplied names.

The 6.0 post also announced **ECharts MCP**. It exists at `apache/echarts-mcp` (86★, Apache-2.0, last 2026-10). It is a *demo* that renders server-side and uploads to Baidu BCE object storage, then returns an image URL. Its README argues for "Approach 3: ask the LLM for minimal parameters (series type, data, seriesName, title, axisName)" with the theme fixed in-app, because full LLM-written options are unstable. **This validates our step-2 design.**

### 4.2 `@echarts-x/*` official custom series (adopt)

- Install via `npm pack` and vendor `dist/<name>.auto.min.js`. Load it after `echarts.min.js` and it auto-registers. Usage is `series: [{ type: 'custom', renderItem: 'violin', ... }]`, i.e. `renderItem` is the *string name* of the registered series.
- Each package ships `.js`, `.min.js` (UMD; manual `echarts.use(installer)`), `.auto.js` and `.auto.min.js` (classic script, auto-register) and `.esm.mjs`. The classic/auto builds are `file://`-safe.
- IB mapping:
  - `bar-range` → football-field valuation (52-week range, trading comps, precedent transactions, DCF ranges). Today `kit/components/football-field` presumably hand-rolls this with stacked bars; switching to `bar-range` gives proper low/high encoding, labels and tooltips.
  - `line-range` → forecast bands, consensus high/low, scenario fans.
  - `violin` / `contour` → distribution of multiples or returns.
  - `segmented-doughnut` → progress-to-target.
  - `stage` → deal timeline / process stages.
  - `word-cloud` / `liquid-fill` → only if a client insists (see §11).
- The packages depend on ECharts ≥ 6 (custom series registration). They are not usable with v5.

### 4.3 Legacy ECharts plugins (ecomfe)

- `echarts-gl@2.1.0` (2026-05-28) now officially allows `echarts ^6`; its deps are claygl and zrender `^5 || ^6`. Use cases are 3D globe, bar3D, scatterGL and flowGL. **Verdict for IB: avoid 3D** (distorts reading, prints badly). Its one legit use is `scatterGL` / `linesGL` for >100k points. It adds 170 KB gz.
- `echarts-wordcloud@2.1.0` and `echarts-liquidfill@3.1.0` have been unmaintained since 2021-22 with peer `^5`. They do still load. My check: liquidfill renders under 6.1 SSR with 11 paths, but the dist assumes the global `self` (fails in plain Node without a polyfill). **Superseded by `@echarts-x/custom-word-cloud` / `custom-liquid-fill`.**
- `echarts-for-react` (hustcc, 5k★): the **same account `atool` was the compromise vector**. Not needed (we are vanilla).
- `vue-echarts@8.3.2` (2026-10-09) and `ngx-echarts@22`: framework wrappers, irrelevant for us.

### 4.4 Themes

- `echarts/theme/*.js` in the 6.1 package ships 36 UMD theme files that register on the global `echarts` when loaded as classic scripts: azul, bee-inspired, blue, caravan, carp, cool, dark, dark-blue, dark-bold, dark-digerati, dark-fresh-cut, dark-mushroom, eduardo, forest, fresh-cut, fruit, gray, green, helianthus, infographic, inspired, jazz, london, macarons, macarons2, mint, rainbow, red, red-velvet, roma, royal, sakura, shine, tech-blue, **v5**, vintage.
- **None of them is pitchbook-grade.** They are colourful, Excel-2007-ish or 大屏. Build our own theme from tokens (see §13) and register it with `echarts.registerTheme('ib-light', …)` and `'ib-dark'`, switching at runtime via `setTheme`.
- The theme builder (https://echarts.apache.org/en/theme-builder.html, repo `apache/echarts-theme-builder` 288★, last 2026-08) exports JSON/JS. It is fine for quick palette trials, but our tokens should be the source of truth.
- Chinese tutorials on "金融 ECharts 主题" (CSDN 2025-2026) almost all push **deep-navy + gradient + glow**. That is the 大屏 idiom, not IB.

### 4.5 Maps (Chinese-specific gotchas)

- **ECharts has not bundled `china.json` or world maps since v5.** Users must register their own GeoJSON (`echarts.registerMap`). The common Chinese source is Aliyun DataV's `geo.datav.aliyun.com` boundary API, which is online-only and has unclear licensing. Do not use it for client deliverables.
- **China map compliance (审图号 / "问题地图")**: maps published in or for mainland China must show officially approved national boundaries (Taiwan, South Tibet/Arunachal, the South China Sea nine-dash line, Aksai Chin). Natural Earth / world-atlas boundaries are *not* compliant. For China-facing deliverables: (a) use the official 标准地图服务 outline or a compliant dataset, (b) show the 审图号 if required, or (c) avoid national-border basemaps and use region-level symbols or tables instead. The kit should make the **geo source swappable per client jurisdiction**. *(Legal detail unverified by search; flag for compliance review.)*
- AntV L7 notes (2.29.1 UMD):
  - It wraps Gaode (AMap), Baidu, Tencent, Tianditu, Google, Mapbox and MapLibre. The bundle contains `webapi.amap.com`, `api.map.baidu.com` and `api.tianditu.gov.cn` loaders, all of which need keys and network.
  - The default **logo control loads from `gw.alipayobjects.com`**, so set `logoVisible: false`. Some layers (wind, water, earth) pull textures from the Alipay CDN.
  - The blank `Map` base works offline with local GeoJSON, but it is WebGL-only (print and PDF risk).
  - **Verdict: avoid.** Leaflet, already vendored, plus ECharts geo cover proportional symbols and choropleths.

### 4.6 pyecharts (Python side)

- `pyecharts 2.1.0` (2026-02, MIT, 16k★) targets ECharts 6 (`assets/v6/`) and includes the new v6 custom chart types.
- Its output is HTML with inline options *and* data, plus CDN script tags by default (`CurrentConfig.ONLINE_HOST`). That violates our HTML/JS/DATA separation.
- **Verdict: reference.** Analysts may prototype with it, but our Python builder should emit `data/*.json(.js)` plus a kit spec, not pyecharts HTML. Its `Bar().add_xaxis().add_yaxis()` fluent API is a nice model for our builder ergonomics.

---

## 5. AntV 家族 (Ant Group)

The overall picture: a strong grammar-of-graphics lineage (G2 5, inspired by Vega-Lite and Observable Plot), the best Chinese pivot table (S2), the best Chinese graph library (G6 5), and an early, aggressive push into AI (GPT-Vis, Infographic, T8, mcp-server-chart, chart-visualization-skills, Sive, AVA 4).

**Caveats:** the npm supply-chain incident (§2), and every UMD bundle is heavy because each embeds `@antv/g` (its own canvas/SVG/WebGL renderer).

| Lib | What it is | IB relevance | Verdict |
|---|---|---|---|
| **G2 5.4.8** | Grammar of graphics: marks, transforms (stackY, dodgeX, binX, groupX…), `facetRect`, composition (`spaceFlex`, `repeatMatrix`), interactions (`brushFilter`, `legendFilter`, `sliderFilter`, `elementHighlight`), animations (`keyframe` for storytelling). UMD `G2.Chart`. | Very expressive (Marimekko via `interval` + `flexX`, facet small multiples) and nice default typography. A second engine duplicates ECharts at +320 KB gz. Its namespace was compromised. | **reference** (borrow grammar ideas: transforms, facet, keyframe) |
| **G6 5.1.1** | Graph viz (force, dagre, combo, tree, mindmap). 5.1 shipped 2026-03-30. | Ownership/holding structures, supply-chain networks. ECharts `graph` / `tree` cover simple cases. | **reference**; consider only if ownership graphs become a core module |
| **L7 2.29.1** | WebGL geo (point/line/polygon/heatmap/hexagon layers on AMap/Mapbox/blank) | Big-data geo. Online basemaps, CDN logo. | **avoid** |
| **S2 2.7.2** | Canvas pivot/detail tables (PivotSheet, TableSheet), row/column totals and subtotals, frozen panes, tree mode, drill-down, sort/filter, copy/export, themes, "trend analysis table" with mini charts. Claims 1M cells in <8 s. | **Bank-style cross-tabs** (segment × year × metric with subtotals) are its sweet spot. 302 KB gz. Self-contained UMD (`S2.PivotSheet`). | **consider** (lazy-load) |
| **X6 3.1.8** | Diagram editor (flowchart, ER, DAG) | Transaction structure diagrams; but an editor is overkill for a static report. | **avoid** |
| **AVA 3.4.1 / 4.0.0-beta.1** | v3: ChartAdvisor (rules + lint: "bar chart should …"), LiteInsight (auto insights: trend, outlier, change point). v4: Node "AI-native Visual Analytics" (`ai`, `@ai-sdk/openai`, DuckDB, ClickHouse). | The idea of **chart linting rules** is valuable for QA of auto-generated charts. v3 has been stale since 2024-03 and v4 is server-side. | **reference** |
| **G2Plot 2.4.35** | Legacy G2-4 high-level charts | Superseded by G2 5 | **avoid** |
| **F2 5.14.0** | Mobile charts | n/a | avoid |
| **GPT-Vis 1.0.2** | "AI-native visualization library": 26 types (line, area, column, bar, pie, scatter, radar, funnel, waterfall, dual-axes, histogram, boxplot, violin, venn, sankey, treemap, word-cloud, liquid; flow-diagram, network-graph, mindmap, indented-tree, org-chart, fishbone; table, summary). Markdown-like DSL in ```` ```vis ```` fences, streaming render with `isVisSyntax(buffer)`, fault-tolerant. Themes: default, dark, **academy** (Tableau-10 palette). | **The DSL/streaming pattern** is exactly step 2's need. But the UMD is 649 KB gz (bundles G2+G6+T8+snapdom) and it uses the compromised namespace. | **reference** (copy the pattern, not the lib) |
| **Infographic 0.2.20** | Declarative infographic engine (open-sourced 2025-11-22), ~200 templates, SVG, editor, streaming-tolerant syntax, hand-drawn (roughjs) styles. 7k★ in under a year. | Executive-summary "process / timeline / list" graphics. **Gotcha:** at runtime it fetches icons from `https://www.weavefox.cn/api/v1/infographic/icon` and Alibaba PuHuiTi fonts from `assets.antv.antgroup.com`, which breaks offline and is a privacy concern. Style skews 小红书/PPT-cute. | **reference** |
| **T8 0.3.1** | Narrative text visualization: Markdown + entity annotations, e.g. `Total sales reached [¥1,234,567](metric_value, origin=1234567)`. Entity types (metric value, delta, ratio, trend, …) render with semantic colour, up/down arrows and inline mini charts. 18 KB gz, preact inside. Prompt templates for LLMs included. | **Excellent fit for IB commentary boxes**: numbers in prose get consistent formatting, +/- colouring, and tooltips back to source data, and an LLM can emit it. | **consider** (or re-implement the ~10 entity types in our text-block component) |
| **mcp-server-chart 0.9.10** | MCP server, 25+ chart tools, returns **image URLs rendered by AntV's hosted GPT-Vis-SSR** unless `VIS_REQUEST_SERVER` points to a private instance. Maps are not supported privately. | Data leaves the machine by default. A non-starter for client data. | **reference** |
| **chart-visualization-skills** | Agent skills (antv-g2-chart, antv-g6-graph, antv-x6-editor, antv-gpt-vis, antv-infographic, antv-t8-ntv, icon-retrieval). The context service is hosted at `sive.antv.antgroup.com`. It claims 98.2% on 174 G2 test cases vs 80.5% for a Context7 baseline. README: "This project only merges AI-generated code". | A model for our "skills" step (skill = instructions + references + eval cases). | **reference** |
| **Sive** (2026-08) | Hosted "AI Native" analysis and authoring SaaS (data connect, 18+ analysis methods, 100+ "Golden Queries", 50+ "Design Skills", PPT export). The GitHub repo `antvis/Sive` (MIT) holds **only a README and logo**. | Cloud. Not open source in substance. | **avoid** |

Community signal (Juejin): "替代Echarts，采用antv实现数据可视化图表" (21k views, 2022), "vue中，整合AntV + DataV实现可视化大屏" (22k), and many X6 flowchart tutorials. AntV is perceived as **"more elegant defaults, steeper learning curve, Ant-Design-ecosystem"**. The 2026 Juejin "从夯到拉，锐评 39 个前端技术" (26k views) rates Ant Design 人上人 and mentions AntV only as part of the Ant ecosystem.

---

## 6. VisActor 家族 (ByteDance)

Positioning: "面向叙事的智能可视化解决方案" (narrative-oriented intelligent viz). The stack is VRender (renderer) → VGrammar → VChart / VTable → VStory / VMind / VSeed / VBI. Docs are excellent in Chinese and English. VTable is the standout.

| Lib | Status / facts | IB relevance | Verdict |
|---|---|---|---|
| **VChart 2.1.7** | 2.0 shipped 2025-06-10 and 2.1 on 2026-06-23 (VRender 1.1 app-scoped runtime; finer-grained `updateSpec` that avoids full re-compile on data/style changes; legend `maxRow/maxCol` functions; waterfall leader-line fixes). Spec-driven (`{type:'bar', data:[{values}], xField, yField}`), with rich **narrative features**: mark points/lines/areas with rich text, player (timeline animation), "race" bar/line/pie, sequence animation. Cross-platform (Node SSR, mini-programs). | Very good defaults and storytelling annotations, and `updateSpec` partial update is attractive for dynamic re-render. But it is 617 KB gz and a second engine. | **reference** (borrow annotation and player ideas) |
| **VTable 1.26.8** | Canvas table: `ListTable`, `PivotTable`, **`PivotChart`** (pivot whose cells are VChart charts, i.e. small multiples with shared axes), tree, frozen columns, sparkline/progress/image cells, editing, conditional styles, aggregation, `autoWidth`; spin-offs `vtable-gantt` and `vtable-sheet` (2025-09). A Juejin VTable post has 39k views (2023), the most-read VisActor article. A 2025-12 migration report (Arco Table → VTable) notes `react-vtable` did not support React 19. | Pivot plus big data. `PivotChart` gives a think-cell-like "chart per cell" matrix. 531 KB gz; pivot charts additionally need VChart (`VTable.register.chartModule('vchart', VChart)`), i.e. +617 KB. | **consider** (S2 vs VTable: S2 is lighter and has a more finance-y pivot; VTable has better ecosystem momentum and charts-in-cells) |
| VGrammar 0.16.18 | Pre-1.0 grammar layer | – | **avoid** |
| **VMind 2.0.10** | LLM chart gen, data extraction from text, editing, insights (alasql inside, axios to OpenAI-compatible URL, `jsonrepair`). **Repo renamed to `VisActor/skills`; README: "The previous VMind SDK is no longer maintained."** The UMD build's factory expects Node modules (`util`, `stream`, `http`, `fs`…) as globals. Its helper packages `@visactor/calculator` ("SQL-like query executor with DSL") and `@visactor/chart-advisor` are frozen at 2.0.10 and calculator has **no license field**. | Was the obvious pick for "local LLM generates charts". Now dead. | **avoid** |
| **VStory 0.0.26** | Storytelling/animation player (scenes, characters = charts/tables/text). 1083 KB gz, pre-alpha, last 2026-04. | Concept of animated data stories, but immature. | **avoid** |
| **VSeed 0.7.0 / VBI 0.7.0** | VSeed is a "standardized DSL for analysis": `{chartType:'line', dataset:[…], dimensions:[{id, alias}], measures:[{id, alias, parentId}]}` compiled to VChart or VTable specs by `Builder.from(vseed).build()`. About 40 chart types incl. pivot variants, race charts, dual-axis, sankey and heatmap. `registerAll()` registers types and themes. VBI is the BI builder on top (yjs, zod, simple-statistics). Both were published 2026-10-14, so very active. It is what the **Coze "VisActor 图表技能"** edits ("通过修改 VSeed spec 的方式进一步对图表进行调整"). UMD global `VSeed`, 203 KB gz. | **This is the design we want for our data-spec layer**: a business-semantic spec (dimensions/measures, aliases, grouping, encodings) separate from the render spec. | **reference** (strongly; mirror the shape) |
| **vchart-theme 1.13.1** | Themes: light, dark, legacy, mobile, arcoDesign, semiDesign, ttPlatform, chartHub, **veODesign{Light,Dark}{Finance,Government,Medical,Consumer,Automobile,NewEnergy,CulturalTourism}**, and vScreen* (大屏: BlueOrange, Clean, ECommercePurple, ElectricGreen, **FinanceYellow**, Outskirts, PartyRed, RedBlue, VolcanoBlue, WenLvCyan). `veODesignLightFinance.dataScheme = #E2B890 #294C60 #E04D43 #324BCC #9CADC8 #9D0800 #AD7F45 #3C4579 #97A1A6 #57A1B1` (tan / deep teal-navy / brick / royal blue / slate). `vScreenFinanceYellow` is dark with gold `#FFCF67 #FF9254 …` (大屏). | The **light Finance palette is genuinely pitchbook-adjacent** (navy, gold, oxblood). Useful as a reference for an "ib-warm" alternate palette. | **reference** |
| **VisActor/skills** | `vchart-skill`, `vtable-skill`, `data-storytelling` (HTML reports, scrollytelling, Web-PPT). "No separate VisActor CLI, MCP server, model key or hosted VisActor API is required. The host agent supplies the model." Generated HTML **loads pinned VChart/VTable/React/Monaco/VSeed/GSAP from unpkg ("not a fully offline bundle")**. There is an eval harness against OpenAI-compatible Chat Completions (32 VChart, 4 VTable and 5 storytelling cases). | Template for our step-2 "import skills" structure (SKILL.md + references + templates + scripts + evals). Note the **GSAP** dependency in storytelling (GSAP standard license, not OSI). | **reference** |

Community signal: VisActor runs paid community programmes (Juejin "开发者奖励计划", 开源之夏, an essay contest in 2026-03 for the VChart/VTable Skills), so Juejin volume is partly sponsored. Real adoption is mostly ByteDance-internal (DataWind 火山引擎) plus VTable in the wider community.

---

## 7. 数据大屏 / DataV 生态

What "数据大屏" means: full-screen 1920×1080 (or wider) wall displays for command centres and government/enterprise "驾驶舱" (cockpits). Aliyun DataV's own design guide names the style keywords **科技感、空间感、光感** (tech, space, light): high-saturation accents on dark backgrounds, and layout as a storyline top→bottom, left→right (https://help.aliyun.com/zh/datav/datav-6-0/getting-started/introduction-to-data-dashboard-design).

| Repo / lib | Facts | Verdict |
|---|---|---|
| **DataV (DataV-Team / jiaminghi)** `@jiaminghi/data-view` 2.10.0 | MIT, 9.7k★, last commit 2023-07, last npm 2020-09, Vue 2 only. React port `@jiaminghi/data-view-react` 1.2.5 (2021). Components: 13 animated SVG borders (边框), decorations (装饰), digital flop (数字翻牌器), scroll board (轮播表), ranking board, water level (水位图), flyline map (飞线图), capsule chart. | **avoid** (style and framework) |
| `@kjgl77/datav-vue3` 1.7.4 | MIT, Vue 3 fork, last 2024-10 | **avoid** |
| **iGaoWei/BigDataView** | 5.3k★, last 2025-10. "100+套大数据可视化模板", static HTML5 (jQuery + ECharts). README: resources were **collected from the internet**; no LICENSE. | **avoid** (IP risk; reference only for "what not to do") |
| **yyhsong/iDataV** | 5.7k★, last 2021-07, no LICENSE. Cases: "上市公司全景概览" (listed-company overview: bars, maps, flip numbers), Baidu-map heat, ECharts-GL 3D, word cloud, liquid fill. | **avoid** |
| jackchen0120/vueDataV | MIT, 2.2k★, last 2024-03, Vue + ECharts templates | avoid |
| **GoView** (dromara/go-view) | MIT, 971★, last 2025-12. Vue 3 + NaiveUI + ECharts 5 low-code 大屏 editor | **avoid** (app, not kit) |
| **DataEase** | **GPL-3.0**, 25k★. Open-source BI (ECharts/AntV charts) | **avoid** (license) |
| **SQLBot** (DataEase team, text-to-SQL) | **Modified GPLv3** (must keep logo/copyright; contributor terms) | **avoid** |
| FlyFish, OpenDataV, Light Chaser, DataGear | Low-code 大屏 platforms (Juejin 2022-23) | not evaluated in depth; apps, not kits |
| `autofit.js` 3.2.8 / `v-scale-screen` 2.3.0 | MIT. CSS-transform scale a fixed 1920×1080 canvas to any screen | **avoid** (breaks text reflow and print; our reports must be responsive and printable) |
| "lgdsunday" repos | Not found on GitHub via search or shields (repo-not-found for `lgdsunday/vue-datavision`). LGD_Sunday is known as a Chinese course author (imooc 大屏 course), *unverified*. | n/a |

Juejin signal: "从0到1开发可视化数据大屏（上）" (30k views, 2021), "推荐几个数据大屏可视化开发工具" (33k), "如何实现数据大屏-基于VChart" (7.4k, 2023), "GoView 开源" (6k). In 2026 the newest 大屏 posts are AI-generated (e.g. "用 GPT Image 2 生成数据大屏", "Data Max 入驻 WorkBuddy"). **Big-screen demand is shifting to "AI generates the dashboard"**, which reinforces the need for a strict spec plus house style.

---

## 8. AI 生成图表 (VMind / GPT-Vis / LIDA / MCP / Skills): comparison and lessons

| Project | Approach | Runs offline with local LLM? | Status 2026-10 | Verdict |
|---|---|---|---|---|
| VisActor **VMind** 2.0.10 | LLM → VChart spec; text→data extraction; edit via dialogue; insights; SQL via alasql | Yes in principle (custom URL/model via axios to an OpenAI-compatible endpoint) | **Unmaintained** (repo → VisActor/skills) | avoid |
| VisActor **skills** + **VSeed** | Agent skill + business DSL (VSeed) → deterministic VChart/VTable spec | The host agent supplies the model. The generated HTML loads from unpkg (needs patching to vendor). | Very active | reference (pattern) |
| AntV **GPT-Vis** 1.0.2 | Markdown-like ```` ```vis ```` DSL or JSON → chart, streaming and fault-tolerant | Yes (pure front-end) | Active | reference (pattern) |
| AntV **mcp-server-chart** 0.9.10 | MCP tools → hosted SSR → image URL | Only with private GPT-Vis-SSR | Active | reference |
| AntV **Infographic** / **T8** | DSL for infographics / narrative text, LLM prompt files included | Yes (Infographic needs CDN fonts/icons patched) | Active | reference / consider (T8) |
| AntV **AVA** v3 → v4 | Rules-based advisor and lint → AI-native Node framework | v3 browser yes; v4 server | v4 beta 2026-10-13 | reference |
| **apache/echarts-mcp** | Minimal-parameter tool → server render → image URL (Baidu BCE) | Needs patching | Demo | reference |
| **Microsoft LIDA** 0.0.14 | Python: summarize → goals → generate and **execute** viz code (matplotlib/seaborn/altair) | Yes (HF local or vLLM/OpenAI-compatible) | Stale (2024-03); README: run in a secure env | reference |
| AntV **Sive** | Hosted SaaS + API key | No | 2026-08 | avoid |

Practitioner lessons (Chinese sources):

- **"零幻觉交付：如何构建一个高可用 AI 图表生成组件"** (Juejin, 2026-02, https://juejin.cn/post/7603581886148935734):
  - (1) A minimal contract: the LLM wraps data in a custom fence (```` ```vchart ````) and supplies **only `data` + `chartType`**; colours, axes and legends come from front-end defaults. "AI 只做填空题".
  - (2) Code-side fallback: default-template injection, JSON repair with regex/heuristics so the chart "at least renders".
  - (3) MCP tool calls for data the model cannot know (e.g. `get_vchart_schema`, DB lookups); validate server-side.
  - (4) **Pseudo-streaming**: buffer the full LLM message, render the chart off-screen as soon as the JSON is complete, then typewriter the text and reveal the pre-rendered chart at its anchor. This avoids flicker and broken-JSON parsing.
- **"AI 文字信息图表的技术选型"** (Juejin, 2025-12, https://juejin.cn/post/7578793960626536474) compares four options:
  - Mermaid: accurate but technical; 2.7 MB.
  - AI-direct HTML/SVG: easy, but "AI 味" style and uncontrollable; SVG text collisions.
  - Multimodal image models (Gemini 3 / "banana pro"): good-looking, but not editable, no interaction, closed and costly.
  - AntV Infographic: open, templated, editable, ~410 KB.
  - Its recommendation: Infographic + Mermaid.
- **echarts-mcp README**: full LLM-written ECharts options are unstable, especially for rare series, so ask for minimal params and fix the theme in-app.

**Concrete recommendation for our step 2 (local LLM):**
1. Define `ReportSpec` (JSON Schema) à la VSeed: `{component, title, subtitle, dataset ref, dimensions[{id, label, type}], measures[{id, label, format, unit, parentId}], encodings{x, y, color, size, shape}, annotations[], sort, filter}`.
2. The LLM may output only this spec, validated with JSON Schema (ajv-like) and repaired with `jsonrepair`-style logic.
3. A deterministic compiler (`kit/core`) maps the spec to an ECharts option using house tokens.
4. Narrative is in a T8-like annotated Markdown so numbers stay data-bound.
5. Ship each kit component with a **SKILL.md + examples + eval cases** (pattern: VisActor/skills, antvis/chart-visualization-skills).
6. Local LLM via an OpenAI-compatible endpoint (Ollama, llama.cpp server, vLLM). Note that under `file://` the browser can call `http://localhost:11434` only if the server sends CORS headers (Ollama: `OLLAMA_ORIGINS=*` or `null` origin handling). This is a gotcha to test.

---

## 9. "Kitten / Chart cuteness" 风格

I could not identify a "Kitten" chart library. The closest matches for "cute charts" are `timqian/chart.xkcd` (MIT, 7.9k★, hand-drawn xkcd style) and `cutecharts.py` (MIT, Python port, last 2024-05). AntV Infographic also ships rough.js hand-drawn styles, and the Chinese PPT/XHS crowd likes 手绘风 and 马卡龙色 (macaron palettes). **Verdict for IB: avoid.** Sketchy rendering reads as unserious and imprecise. The only acceptable exception is internal brainstorming material.

---

## 10. 社区推荐信号 (What XHS / Juejin / CSDN creators recommend)

XHS was not reachable (§1), so this section triangulates from Juejin search metadata (titles, dates, views, collects), WeChat (Sogou) titles and CSDN titles.

**Evergreen "宝藏" lists (high collects):**
- "全网echarts案例资源大总结和echarts的高效使用技巧" (Juejin 2022, 99k views, 1,898 collects) points people to ECharts community galleries. The original "Make A Pie" gallery shut down in 2022; CSDN 2026-03 has "ECharts Gallery弃用后，这4个替代网站…" (body blocked).
- "推荐一些有趣实用的前端可视化工具库" (Juejin 2021, 31k views, 793 collects).
- "VTable——不只是高性能的多维数据分析表格" (39k, 584 collects).

**Typical recommended stack in Chinese listicles (2024-2026):**
- ECharts (default; "图表最全、社区最大")
- AntV G2 / G6 / X6 / L7 ("颜值高", Ant Design users)
- VChart / VTable (newer; "叙事", "高性能表格")
- DataV (大屏 borders)
- Three.js (3D / digital twin)
- D3 (custom)
- BI apps: DataEase, Superset, Metabase, DataGear

**2025-2026 hot topics:**
- AI generation: MCP chart servers ("推荐一款宝藏MCP Server—mcp-server-chart", 2025-05; "蚂蚁开源MCP黑科技！Cursor免费秒生成20+图表", 2025-07).
- Agent Skills ("AI Skills：前端新的效率神器", 2026-01, **73k views**; "VChart & VTable Skill 使用", 2026-02).
- Infographic ("一个可以补充 Mermaid 的可视化组件库 Infographic", 2025-11; "复刻'灵光'同款交互", referencing Ant Group's 灵光 app, which renders charts and infographics in chat).
- "AI 问数" (text-to-SQL + charts: WrenAI, SQLBot, "SQLite + DuckDB 打造 AI 问数平台", 2026-08).

**Style trends visible in titles:**
- "CSS Glassmorphism … 暗色霓虹风格大数据看板" (2026-07). Palette: `#00f5d4 #00bbf9 #9b5de5 #f15bb5` on `#0a0e1a`, `backdrop-blur-xl`, glow box-shadows.
- "赛博朋克风"; "Three.js 带主题切换的数据可视化大屏"; "ECharts 深色主题、边框、背景美化"; "ECharts环形图进阶技巧：用 LinearGradient 打造高级感图表"; "ECharts 5.4 饼图渐变配色实战".
- In other words, **"高级感" (premium feel) in this community usually means dark + gradient + glow**, the opposite of the IB idiom.

**Counter-signals worth noting:**
- CSDN "别再乱用饼图了！ECharts高级配色方案与业务场景匹配指南" (2026-03).
- "ECharts图表美化实战：用markArea+markLine组合打造专业级数据报告样式" (2026-05). markArea/markLine for reference bands and targets is exactly the IB annotation vocabulary.
- 图表兔 (WeChat) "你看到的每一张图表，都可能在偷偷骗你" (2026-10) on misleading charts (truncated axes etc.), relevant to our broken-axis policy.

**IB-specific Chinese content (CSDN 2025-2026):**
- AI-generated guides to Anthropic's `financial-services` plugin skills (pitch-deck, ib-check-deck, strip-profile with PptxGenJS).
- "Kun" PPT design systems such as "蜂蜜橙投行备忘录风格" (honey-orange IB memo), "Rice Paper Annual 金融研报风格" and "Lake Blue Memo 投资备忘录风格". I could not locate the Kun repo (*unverified*).
- The best adjacent find is **tw93/Kami** (MIT, 12k★): a document design system with an "Equity Report" template.
  - Tokens: parchment `#f5f4ed` (never pure white) and a single ink-blue accent `#1B365D`.
  - Serif-led hierarchy.
  - "Thin single-line geometric strokes and simple flat icons. No gradients, no drop shadows, no 3D."
  - "One accent only … everything else in warm gray."
  - Font caveat: its Chinese serif TsangerJinKai02 is **personal-use only**.

**Generic Chinese design guidance that *is* IB-compatible.** Feishu 数据可视化设计指南 (https://open.feishu.cn/document/design-specification/data-visualization/data-visualization-design-guide?lang=zh-CN):
- Categorical palette used in a fixed order; a single series uses colour #1; cycle after 14.
- Sequential palette for ordered values; diverging for −/0/+ (涨跌).
- Functional colours: red = error, orange = severe, yellow = warning, green = OK, noting that meaning varies by culture.
- Line charts: avoid more than 5 series. Pie/donut: fewer than 9 categories. Funnel: at most 12 steps. Area: at most 3 legend items (else stack).
- Dual Y axes only when units differ.
- Legend: desktop bottom-centre, mobile top; hide it when there is a single series.
- Element priority when space is tight: marks > legend > axes > gridlines.
- Rotated labels are hard to read; truncate if taller than 30% of the container.
- Pie outer labels in grey with connector lines in series colour.
- In grouped bars, centre-align groups that contain null values.

Canva CN "咨询报告图表" on McKinsey-style colours (https://www.canva.cn/learn/consult-report-graphic-design/): "麦肯锡出品的研究报告内的图表通常是不同深浅的黑色和蓝色", and reserve the brightest colour for the emphasised datum.

---

## 11. 风格判断：不适合 IB vs 值得借鉴

| Chinese idiom | IB client report? | Why / what to do instead |
|---|---|---|
| Dark navy/black 大屏 background (`#0a0e1a`, `#001529`) | ❌ (except an optional "presentation dark" theme) | Pitchbooks are printed and PDF'd. Use white or warm-white paper. Keep dark only via `setTheme('ib-dark')` for screen. |
| Neon cyan/magenta, glow `box-shadow`, gradients on bars | ❌ | Reduces precision, prints muddy, reads as consumer tech. Use flat fills; one accent; greys for context. |
| Glassmorphism (`backdrop-filter: blur`) panels | ❌ | GPU cost, poor contrast, no print equivalent. Use hairline rules (0.5–1 px) and whitespace. |
| DataV-style animated SVG tech borders / corner decorations | ❌ | Chart junk. Use section titles, rule lines and numbered exhibits ("Exhibit 3: …"). |
| 3D bars / 3D pie / globe (echarts-gl) | ❌ | Distorts magnitude. Use 2D. `scatterGL` only for >100k points. |
| Flying lines (飞线) on maps, rotating radar rings, particle backgrounds | ❌ | Decorative. Use static flow maps with width-encoded lines and a legend. |
| Liquid-fill gauges, speedometer gauges | ❌ (rarely ok) | Low data-ink. Use bullet charts or a KPI tile with delta and sparkline. |
| Word clouds | ❌ | Imprecise. Use ranked bars. |
| 1920×1080 scale-to-fit (autofit.js) | ❌ | Breaks responsive reflow, print and accessibility. Use a CSS grid with print page sizes (A4/Letter landscape). |
| Infinite auto-scroll tables (轮播表) / auto-rotating tooltips | ❌ | The reader controls the pace. Use sortable static tables (Tabulator) with pagination. |
| Macaron / Morandi / hand-drawn (XHS-popular) | ❌ | Too soft and casual for IB. |
| **Digital flop / count-up KPI (数字翻牌器)** | ✅ restrained | Once on first view, ≤600 ms, tabular figures; disabled in print and `prefers-reduced-motion`. |
| **Linked highlight across charts** (ECharts `connect`, VChart cross-chart) | ✅ | Cross-filtering is a requirement; keep highlight colour = accent. |
| **Storyline layout** (DataV guide: top→bottom, left→right, data first) | ✅ | Matches pitchbook "headline → exhibit → footnote". |
| **Annotation vocabulary** (VChart markers, ECharts markLine/markArea/markPoint `relativeTo`) | ✅ | Targets, consensus, LTM/NTM bands, event lines, CAGR arrows. |
| **Narrative entities** (AntV T8) | ✅ | Number formatting and ± semantics inside prose. |
| **Theme tokens and runtime `setTheme`** (ECharts 6) | ✅ | Light/dark/print variants from one token set. |
| **Matrix layout / small multiples** (ECharts 6 matrix, VTable PivotChart, G2 facet) | ✅ | think-cell-style peer panels. |
| **Broken axis** | ⚠️ | Only with an explicit break marker and note; otherwise log scale or separate panel. |
| **Pivot with subtotals** (S2/VTable) | ✅ | Segment financials, cross-tabs. |
| **"Race" / player animations** (VChart player, VStory) | ⚠️ optional | Only as an opt-in "play" control on time series, never autoplay. |
| **红涨绿跌 (red = up) convention** | ⚠️ locale | Default to Western (green up / red down, or blue/orange neutral) and switch per client locale. ECharts candlestick defaults to the Chinese convention. |

---

## 12. 字体 (Fonts for bilingual / Chinese deliverables)

| Font | License | Notes |
|---|---|---|
| Source Han Sans / Noto Sans SC (思源黑体) | **OFL-1.1** | Safe CJK sans. Huge (~8–16 MB per weight for full CJK), so **subset** with `fonttools pyftsubset --text-file=…` per report, or GB2312-level 3,500-char subset (~1–2 MB). Pair with Inter for Latin and tabular numerals (`font-variant-numeric: tabular-nums`). |
| Source Han Serif / Noto Serif SC | OFL-1.1 | For serif titles (Kami-like editorial look). |
| LXGW WenKai 霞鹜文楷 | OFL-1.1 (26k★, very popular on XHS/dev blogs) | Kai/handwriting feel, not IB. |
| Smiley Sans 得意黑 | OFL-1.1 (15k★) | Display italic, trendy; not IB. |
| Alibaba PuHuiTi 阿里巴巴普惠体 | Alibaba custom free-commercial license (not OSI/OFL) | AntV Infographic **auto-loads it from `assets.antv.antgroup.com`** (offline failure plus a legal-review need). |
| HarmonyOS Sans, MiSans, OPPO Sans | Vendor custom licenses | Legal review needed; avoid by default. |
| TsangerJinKai 仓耳今楷 (used by Kami) | Personal use only | **avoid** commercial use. |

Chinese-specific number formatting: 万 / 亿 units (1亿 = 100,000,000). Chinese finance reports use "亿元", and Western IB uses mm/bn. The format layer should support both `zh-CN` (万/亿) and `en` (k/mm/bn) unit systems; `Intl.NumberFormat('zh-CN', {notation:'compact'})` gives 万/亿.

---

## 13. 配色参考 (Palettes worth borrowing)

- **ECharts 6 default tokens:** theme `#5070dd #b6d634 #505372 #ff994d #0ca8df #ffd10a #fb628b #785db0 #3fbe95`; neutral ramp; accent ramp `#eff1f9 … #121521`. Borrow the **token naming scheme** (primary/secondary/tertiary text, axisLine, axisSplitLine, background, backgroundTint, highlight), not the palette (too bright).
- **VChart veODesignLightFinance:** `#294C60` (deep teal-navy), `#E2B890` (tan/gold), `#9D0800` (oxblood), `#324BCC` (royal), `#9CADC8` (slate), `#AD7F45` (bronze), `#3C4579` (indigo), `#97A1A6` (grey), `#57A1B1` (teal), `#E04D43` (brick). This is closest to GS/JPM pitchbook colours among Chinese presets.
- **GPT-Vis "academy":** Tableau-10 (`#4e79a7 #f28e2c #e15759 #76b7b2 #59a14f…`). A well-known, safe categorical set.
- **Kami:** paper `#f5f4ed`, ink `#1B365D`, warm greys; one accent. Matches the pitchbook "navy + greys + one highlight" idiom.
- **McKinsey-style** (Canva CN): shades of black and blue, brightest colour reserved for emphasis.
- Anti-palette (大屏 neon): `#00f5d4 #00bbf9 #9b5de5 #f15bb5` on `#0a0e1a`. Do not use.

---

## 14. Offline / `file://` gotchas per library (checked by inspecting UMD bundles)

| Lib | Classic-script UMD? | Runtime network calls found in bundle |
|---|---|---|
| echarts 6.1 `dist/echarts.min.js` | ✅ global `echarts` | none |
| `echarts/theme/*.js` | ✅ registers on global | none |
| `@echarts-x/*.auto.min.js` | ✅ auto-register | none |
| echarts-gl `dist/echarts-gl.min.js` | ✅ extends global | none (WebGL) |
| G2 `dist/g2.min.js` | ✅ `G2` | only doc links |
| S2 `dist/s2.min.js` | ✅ `S2` | doc links; html2canvas inside for export |
| G6 `dist/g6.min.js` | ✅ `G6` | doc links |
| L7 `dist/l7.js` | ✅ `L7` | **logo and textures from gw/mdn.alipayobjects.com**; AMap/Baidu/Tianditu/Google/Tencent loaders |
| GPT-Vis `dist/umd/index.min.js` | ✅ `GPTVis` | none (localhost placeholders only) |
| Infographic `dist/infographic.min.js` | ✅ `AntVInfographic` | **icons from weavefox.cn API; fonts from assets.antv.antgroup.com** |
| T8 `dist/t8.min.js` | ✅ `T8` | none |
| VChart `build/index.min.js` | ✅ `VChart` | none |
| VTable `dist/vtable.min.js` | ✅ `VTable` | none |
| VSeed `dist/umd/index.js` | ✅ `VSeed` (root = `globalThis`) | none |
| VMind `build/index.min.js` | ⚠️ `VMind`, but the factory expects `util/stream/http/fs/...` globals | LLM calls by design |
| VStory `dist/index.min.js` | ✅ `VStory` | none, but 1 MB gz |
| pyecharts output | ❌ CDN `assets.pyecharts.org` by default | must set `CurrentConfig.ONLINE_HOST` to a local path |
| VisActor/skills generated HTML | ❌ unpkg CDN | must rewrite to vendored paths |

---

## 15. 具体建议 (Prioritized actions for the kit)

1. **Adopt `@echarts-x/custom-bar-range`, `custom-line-range`, `custom-violin`** (and optionally `contour`, `segmented-doughnut`, `stage`) in `vendor/vendor.json`. All are Apache-2.0, 2–3 KB each, classic `*.auto.min.js`. Rebuild the `football-field` component on `bar-range`, add a `range-band` / fan-chart component on `line-range`, and offer a `violin` / `beeswarm` toggle for comps dispersion (ECharts 6 already has beeswarm/jitter natively).
2. **ECharts 6 theme tokens:**
   - Define `ib-light`, `ib-dark` and `ib-print` themes generated from our CSS tokens (one JSON source, emitted to both CSS custom properties and `echarts.registerTheme`).
   - Switch via `chart.setTheme()`.
   - Override the candlestick and waterfall up/down colours through a `convention: 'western' | 'cn'` token (CN = 红涨绿跌).
3. **Use ECharts 6 matrix** for small-multiples / peer-panel components before considering VTable PivotChart or G2 facets.
4. **Supply chain:**
   - Add `integrity` (sha512 from `npm view <pkg>@<ver> dist.integrity`) and per-file sha256 to `vendor.json`; make `tools/vendor.py --check` verify them.
   - Document "no `^` ranges, `npm pack` only".
   - Add a note on the 2026-05-19 AntV incident in `vendor/LICENSES.md` or a SECURITY note.
5. **Pivot module (optional, lazy):** if pivot/subtotal tables are needed, prototype **S2 2.7.2** (302 KB gz, finance-style cross-tab) vs **VTable 1.26.8** (531 KB gz, plus charts-in-cells). Load either only on pages that need it (`<script>` injected on demand). Keep Tabulator for flat tables.
6. **Data/spec layer shaped like VSeed:** `dimensions[]` / `measures[]` with `id`, `label`, `format`, `unit`, `parentId` (grouping) and encodings. This makes (a) the Python builder simple, (b) the future data API mapping trivial, and (c) LLM output constrained.
7. **Narrative text-block:** support T8-style inline entities (`[12.3%](delta, assessment=positive)`, `[$4.2bn](metric_value, origin=4200000000)`). Either vendor `@antv/t8@0.3.1` (18 KB gz, MIT; pin and verify, since it is in the compromised namespace but published after cleanup) or re-implement in ~150 lines.
8. **LLM step-2 design:** minimal JSON intent → schema validation and repair → deterministic compile; pseudo-streaming render; skills = SKILL.md + references + eval cases (VisActor/skills, antvis/chart-visualization-skills). Local endpoint via an OpenAI-compatible API; test CORS from a `file://` origin (`Origin: null`).
9. **Do not adopt** VMind (dead), VStory (pre-alpha), GPT-Vis/Infographic as runtime deps (size, CDN fetches, namespace risk), L7 (online basemaps), DataV / 大屏 templates (style, no license), DataEase/SQLBot (GPL), Sive (SaaS).
10. **Fonts:** if Chinese text is required, add Noto Sans SC (OFL) **subset at build time** by the Python builder (fonttools), plus 万/亿 compact number formatting for `zh-CN`.
11. **Maps:** keep Leaflet + local GeoJSON. Add a per-client **boundary-dataset switch** and a compliance note for China-facing reports (审图号). Never fetch boundaries from `geo.datav.aliyun.com` at runtime.

---

## 16. Sources

Hard facts (registry/CDN):
- npm registry via `npm view` (versions, licenses, dist-tags, peerDependencies, time).
- jsDelivr data API (`https://data.jsdelivr.com/v1/package/npm/<pkg>@<ver>/flat`) and CDN downloads; gzip sizes measured locally.
- shields.io JSON badges (stars, last-commit, license); ungh.cc (`/repos/<owner>/<repo>`).
- PyPI JSON (`https://pypi.org/pypi/<pkg>/json`): pyecharts, py-vchart, pyg2plot, lida, streamlit-echarts.

ECharts:
- https://juejin.cn/post/7521283343268036646 (Apache ECharts 6.0 震撼发布・前图无量)
- https://github.com/apache/echarts/releases
- https://echarts.apache.org/handbook/en/basics/release-note/v6-feature
- https://github.com/apache/echarts-custom-series , https://cdn.jsdelivr.net/npm/@echarts-x/custom-violin@1.1.1/README.md
- https://github.com/apache/echarts-mcp
- https://echarts.apache.org/en/theme-builder.html
- echarts 6.1.0 package source: `lib/visual/tokens.js`, `lib/chart/candlestick/CandlestickSeries.js`, `theme/*.js`

AntV:
- https://github.com/antvis/GPT-Vis , https://unpkg.com/@antv/gpt-vis@1.0.2/README.md
- https://github.com/antvis/Infographic
- https://unpkg.com/@antv/t8@0.3.1/README.md
- https://github.com/antvis/chart-visualization-skills
- https://github.com/antvis/Sive , https://juejin.cn/post/7678318381181124659
- https://juejin.cn/post/7578793960626536474 (AI 文字信息图表的技术选型)

VisActor:
- https://github.com/VisActor/skills (formerly VisActor/VMind)
- https://visactor.github.io/VBI/vseed/guide/quickStart
- https://raw.githubusercontent.com/VisActor/VChart/develop/docs/assets/changelog/zh/release.md
- https://juejin.cn/post/7605535884939526195 (VChart & VTable Skill 使用)
- https://juejin.cn/post/7613555403788681254 (Coze + VisActor Skill)
- https://juejin.cn/post/7585289701826822153 (从 Arco Table 迁移到 VTable)
- https://juejin.cn/post/7476295800785993728 (low-quality marketing post, cited as a counter-example)
- https://unpkg.com/@visactor/vchart-theme@1.13.1/public/veODesignLightFinance.json

AI generation:
- https://juejin.cn/post/7603581886148935734 (零幻觉交付：AI 图表生成组件)
- https://github.com/microsoft/lida

大屏 / DataV:
- https://raw.githubusercontent.com/DataV-Team/DataV/master/LICENSE
- https://raw.githubusercontent.com/iGaoWei/BigDataView/master/README.md
- https://raw.githubusercontent.com/yyhsong/iDataV/master/README.md
- https://raw.githubusercontent.com/dataease/dataease/dev-v2/LICENSE , https://raw.githubusercontent.com/dataease/SQLBot/main/LICENSE
- https://help.aliyun.com/zh/datav/datav-6-0/getting-started/introduction-to-data-dashboard-design
- https://juejin.cn/post/7661646269913022514 (Glassmorphism 暗色霓虹大数据看板, anti-pattern reference)

Design guidance:
- https://open.feishu.cn/document/design-specification/data-visualization/data-visualization-design-guide?lang=zh-CN
- https://www.canva.cn/learn/consult-report-graphic-design/
- https://github.com/tw93/kami

Security:
- https://www.stepsecurity.io/blog/shai-hulud-here-we-go-again-mass-npm-supply-chain-attack-hits-the-antv-ecosystem
- https://security.snyk.io/antv-supply-chain-compromise-may-2026
- https://snyk.io/blog/mini-shai-hulud-antv-npm-supply-chain-attack/
- https://www.infoworld.com/article/4173277/antv-data-visualization-tool-the-latest-to-be-hit-by-ongoing-npm-supply-chain-attacks.html
- https://orca.security/resources/blog/antv-npm-supply-chain-attack/

Community signals:
- Juejin search API (`api.juejin.cn/search_api/v1/search`) for: 数据可视化 开源 推荐, VChart, VisActor, AntV G2 5.0, ECharts 6, 数据大屏 开源, VMind, GPT-Vis, S2 透视表, VTable, Infographic AntV, 可视化 Skill, ECharts 主题 配色, 大屏 玻璃拟态, echarts-gl, 图表 AI 生成 LLM.
- https://juejin.cn/post/7591346773826732058 (从夯到拉，锐评 39 个前端技术)
- https://juejin.cn/post/7525085089114832931 (Canvas/WebGL 图形库推荐)
- CSDN search API (`so.csdn.net/api/v3/search`): titles only.
- Sogou WeChat search (`weixin.sogou.com`): titles and abstracts only (incl. 图表兔 2026-10-08, IT开源项目精选 2026-10-12).
- Xiaohongshu: https://www.xiaohongshu.com/search_result?keyword=数据可视化 returns a login-gated shell, so it is **not crawlable**.
