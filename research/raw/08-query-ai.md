# 08 · 浏览器内查询 / 计算引擎 + 本地 LLM 集成（raw notes）

> Angle: `08-query-ai` · 调研日期 2026-10-14 · 作者：research sub-agent
> Scope: the client can type their own metric/formula and query the report's data **offline in the browser**. This covers formula engines, SQL/dataframe engines and the cross-filter approach. Step 2 (future) covers connecting a **locally deployed LLM** to a static HTML report, plus a front-end "skills" plugin architecture.
>
> **How the facts were checked:**
> - **Versions, licences, publish dates:** `npm view <pkg> version license time[...] dist-tags` on 2026-10-14.
> - **Dist file lists:** `data.jsdelivr.com`.
> - **Sizes:** each dist file was downloaded and measured raw and with `gzip -9 | wc -c`.
> - **Star counts:** `repos.ecosyste.ms`. The GitHub API is blocked by the proxy.
> - **Empirical probes:** every claim about `file://` behaviour, CSP and performance in §2 and §5 was **measured**. The probe pages were opened through `file://` in **headless Chromium 141.0.7390.37** (Playwright 1.56.1). Probe pages and scripts are in the scratchpad, not in the repo.
> - **The kit's own engines:** `kit/core/rk.expr.js` (formula language) and `kit/core/rk.data.js` (`RK.query` + `RK.store` filters) were benchmarked against the libraries. They were loaded read-only; the repo was not modified.

---

## 0. TL;DR（给主 agent 的 15 条结论）

1. **Formula engine: keep the kit's own `RK.expr`. Do not adopt a library.**
   - **Safety:** it has no `eval` and no `new Function`. It is the fastest engine measured: 100k rows of per-row eval in **14 ms**, against 45–72 ms for math.js, expr-eval-fork and filtrex.
   - **CSP:** it still works under a strict CSP without `'unsafe-eval'` (verified).
   - **Domain syntax:** it already has the IB-specific syntax, which no library offers: `20%` literals, `@param`, `` `EV/EBITDA 2025E` `` quoted names, aggregates and `n.m.`/`n.a.` semantics.
   - **What to add:** a **function registry** (so skills can add functions) and an optional **Excel financial-function pack from Formula.js 4.6.1** (MIT, UMD `lib/browser/formula.min.js`, 45 KB gz, CSP-safe; IRR, XNPV, PMT and others verified).
2. **Avoid `expr-eval` (silentmatt) ≤2.0.2: CVE-2025-12735 is an RCE with CVSS 9.8, and the package is unmaintained.** If a JS-like expression library is ever wanted, use `expr-eval-fork` ≥3.0.0 or `jsep` 1.6.0 (parser only, 3.5 KB gz, IIFE build).
   - **filtrex** compiles with `new Function`, so it breaks under CSP. Verdict: avoid.
   - **math.js 15.2** works under CSP but costs 175 KB gz and offers capabilities (matrices, units) we don't need. Verdict: reference.
3. **The client query language stays `RK.query`, the kit's mini-language.** Example: `median(ev_ebitda) by sector where region == "Asia" sort 2 desc top 5`.
   - **Measured:** 17 ms at 10k rows, 45 ms at 100k and ~0.7 s at 1M rows (40-group group-by).
   - That is fine for typical pitchbook datasets (<100k rows). Bankers can read it, it reuses `RK.expr`, and it already honours the global filters.
4. **Optional "SQL console power-pack" = DuckDB-WASM**, lazy-loaded, built in only when the builder flag asks for it.
   - **Verified working fully offline from a double-clicked `file://` page** using three tricks (recipe in §5.5):
     - (a) the ESM main module is shipped as a string, then loaded with `import(blobURL)`, and the bare `"apache-arrow"` import is rewritten to the global `Arrow` UMD;
     - (b) the worker source is shipped as a string, then started with `new Worker(blobURL)`;
     - (c) the `.wasm` is shipped as base64 in a classic `<script>`, then instantiated from a **`data:` URL**. A blob URL does **not** work: a worker started from `file://` cannot fetch the page's blob URLs.
   - **Cost:** about **46 MB on disk** (34 MB wasm, plus base64 overhead) and **2–4 s to instantiate**.
   - **Benefit:** **111 ms group-by and 50 ms median over 1M rows**, plus full analytical SQL (window, QUALIFY, PIVOT, quantiles).
5. **Do not use AlaSQL for client-typed SQL.** By design, ``SELECT VALUE ``window.x=1`` `` runs arbitrary JS. **Verified: the probe set a global.**
   - It also compiles every query with `new Function`, so it breaks under a strict CSP.
   - It is fast (≈100–150 ms for 1M rows), but it is a code-execution surface. That matters once SQL can arrive from an LLM, a shared link or a skill.
6. **sql.js 1.14.2** is the lightweight SQL fallback: about 0.9 MB as base64 JS, `initSqlJs({wasmBinary})`, and it works on `file://`. `sql-asm.js` (1.36 MB) needs no wasm at all.
   - **Limits:** it is slow beyond 100k rows (about 2.4 s to load plus 3.3 s to group-by at 1M rows), and it lacks median, quantile and PIVOT.
   - **Use it only when** the size budget forbids DuckDB.
7. **Arquero 8.0.3**: good API, UMD build, BSD-3. **Verdict: consider.**
   - **CSP:** it compiles every op with `new Function`. Under a strict CSP even `groupby().rollup()` fails (verified).
   - **Speed:** ingesting row objects is slow, about 0.3–0.7 s for 1M rows.
   - It does not beat `RK.query` plus DuckDB on either axis, so treat it as an alternative, not the core.
8. **danfo.js (6.8 MB bundle, uses TensorFlow.js), PRQL (`prql-js` is deprecated and replaced by `prqlc` 0.13.14 with a 5.5 MB ESM-only wasm), PGlite and the official sqlite-wasm (ESM + OPFS + COOP/COEP): verdict avoid.**
9. **Cross-filter: keep `RK.store`.** It already implements Mosaic/crossfilter semantics: each chart excludes the filter it created itself (`view(ds, {exclude: source})`).
   - **Mosaic 0.33.0** (2026-10-13) is the architecture reference: Selections, pre-aggregation, consolidated queries. **Do not ship it.** Its packages are ESM source-only, it needs DuckDB, and it has had breaking releases monthly.
   - **crossfilter2 1.5.4** has been stale since 2020 and was no faster than plain JS in the probes.
   - **Scale-up path:** columnar storage plus dictionary-encoded strings plus per-filter bitsets. Above about 500k rows, delegate to the DuckDB adapter.
10. **On `file://` the page origin is `"null"`** (verified). Every `fetch` to a local LLM server sends `Origin: null` plus a CORS preflight. What each server does with it (§8.2):
    - **Ollama:** its default allow-list includes `file://*`, which does **not** match `null`. `OLLAMA_ORIGINS=null` makes gin-cors panic at startup ("bad origin"). Only `*` or the hack `null*` work.
    - **vLLM:** current docs say `--allowed-origins` defaults to `[]` (cross-origin disabled).
    - **llama.cpp:** echoes any Origin by default.
    - **LM Studio:** needs the "Enable CORS" toggle.
    - **Security:** allowing `null` effectively allows *any website* (via a sandboxed iframe) to drive the local model API, including Ollama's `/api/pull` and `/api/delete`.
11. **Chrome Local Network Access (LNA, Chrome 142+) gates public-to-loopback requests behind a permission prompt.** Behaviour for `file://` pages is "weakly specified" (blink-dev).
    - **Enterprise fix:** the policies `LocalNetworkAccessAllowedForUrls` / `...BlockedForUrls`.
    - **Recommendation:** Step 2 should ship a **tiny Python "companion"** (`python -m reportkit serve`). It serves the report folder on `http://127.0.0.1:<port>` and reverse-proxies only `/v1/chat/completions` and `/v1/models` to the bank's local LLM, with a token.
    - **What that buys:** same origin, no CORS, no LNA prompt, no exposure of `/api/pull`. It also unlocks `fetch()`, ES modules, workers, OPFS and WebLLM caching.
    - **Fallback:** a direct `file://`-to-LLM mode with `OLLAMA_ORIGINS="*"` for power users.
12. **LLM contract: the model emits *structured intents* (JSON validated by JSON Schema), never code.** An intent is one of: an `RK.query` string, an `RK.expr` formula, a filter change, or an `rk-chart` spec (data-only, no ECharts formatter functions or HTML).
    - **Execution:** the page validates intents with `RK.expr.check` and the schema, executes them locally and shows the editable formula/query. This follows the NL4DV/GPT-Vis pattern; avoid LIDA's "generate code and execute" pattern.
    - **Server support:** all four servers support OpenAI-compatible `/v1/chat/completions`, with `tools` and `response_format` (JSON schema) on Ollama.
    - **Data minimisation:** send the schema, data dictionary, metric catalog and small aggregates, not raw rows.
13. **CSP is our best data-exfiltration guard.** `<meta http-equiv="Content-Security-Policy" content="... connect-src data: http://127.0.0.1:11434">` blocked `fetch('https://example.com')` from `file://` (verified).
    - The builder should emit a strict CSP. Then each library's eval needs matter: `RK.expr`, sql.js, math.js, jsep, expr-eval-fork, JSONata and Formula.js are OK; Arquero, AlaSQL and filtrex are not.
    - **The vendored ECharts 6.1.0 and Leaflet 1.9.4 also render fine under a no-`unsafe-eval` CSP** (verified), so a strict CSP is achievable for the whole kit.
    - DuckDB/sql.js wasm additionally needs `'wasm-unsafe-eval'`.
14. **In-browser LLMs:**
    - **WebLLM 0.2.86 / transformers.js 4.3.1:** WebGPU is available on `file://` (secure context: true), but weights must be *fetched* from an http(s) origin. They cannot be bundled at GB scale, so they are only viable in companion or intranet mode.
    - **wllama 3.8.1:** can load a user-picked `.gguf` via `<input type=file>` even on `file://`, but runs single-threaded (no SharedArrayBuffer without COOP/COEP), so it is too slow for 7B models.
    - **Chrome built-in Prompt API (Gemini Nano):** stable status for web pages is contested in 2026 sources, it is Chrome-only and it is not the bank's model. Use it only as a progressive enhancement.
15. **"Skills" architecture:** a skill package is:
    - **for the LLM:** an **Agent Skills `SKILL.md`** (open standard, agentskills.io) with instructions and examples;
    - **for the runtime:** an **`rk-skill.json` manifest** contributing formulas, query templates, chart presets, prompt templates and tool definitions;
    - **for `file://` loading:** an optional **`skill.js`** classic-script wrapper (`RK.skills.register(...)`).

    Declarative parts apply after schema validation. Any code runs in a **sandboxed `srcdoc` iframe**, which is verified to work on `file://` (origin `null`, cannot touch the parent). It talks to the page over **JSON-RPC on postMessage**, the same model as **MCP Apps** (the official MCP extension, spec 2026-01-26), and only gets the datasets its manifest requests.

---

## 1. 评估维度与约束复述

| 维度 | 为什么重要 | 判定方法 |
|---|---|---|
| Classic-script build (UMD/IIFE) | `file://` 双击：Chrome 阻止 `<script type=module>`/`import()` 加载 file: 文件 | jsdelivr 文件清单 + `head -c` 看包装 |
| 不需要 `fetch()` 本地资源 | `file://` 下 fetch/XHR 本地文件被 CORS 拦截（origin `null`） | 实测 |
| Workers / wasm 加载方式 | `new Worker('file.js')` 被拦；wasm 默认 `fetch()` | 实测 + 找绕法 |
| CSP 兼容（无 `unsafe-eval`） | 报告应带严格 CSP 防数据外泄；`new Function` 类库会挂 | 实测（meta CSP） |
| 安全：不执行任意代码 | 客户/LLM/技能输入的公式和查询都不可信 | 读 advisory + 注入 probe |
| SQL/聚合完整性 | group-by、median/quantile、window、pivot | 实测 |
| 性能 10k–1M 行 | 典型 IB 数据 1k–100k 行，偶尔 1M（tick/持仓） | 实测（同一合成数据） |
| 体积 | `file://` 从磁盘读**未压缩**文件，原始体积决定加载时间；邮件/zip 投递看 gz 体积 | 实测 raw + gzip -9 |
| 许可证 | 客户交付物商用：MIT/BSD/Apache/ISC/OFL；GPL/AGPL avoid | npm + LICENSE |

---

## 2. 实测：`file://` 能力矩阵（Chromium 141 headless, 双击语义）

| Probe | 结果 | 含义 |
|---|---|---|
| `self.origin` | `"null"` | 所有跨源请求带 `Origin: null` |
| `isSecureContext` | `true` | WebGPU / Permissions / File System Access 可用 |
| `crossOriginIsolated` / `SharedArrayBuffer` | `false` / `undefined` | **无多线程 wasm**（DuckDB COI bundle、wllama 多线程不可用） |
| `navigator.gpu` | present（headless 需 flag） | WebLLM 理论可跑 |
| `caches.open()` / `localStorage` / `indexedDB` | ok / ok / ok | 可持久化用户公式/技能（注意：Chrome 中所有 `file://` 页共享同一存储桶——属已知行为，需在目标浏览器复核） |
| OPFS `navigator.storage.getDirectory()` | **ERR SecurityError** | sqlite-wasm OPFS 持久化不可用 |
| `showDirectoryPicker` / `showOpenFilePicker` | function | 可让用户"导入技能文件夹/数据文件"（需用户手势） |
| `fetch('data/x.json')` / XHR | **blocked (CORS)** | 数据必须是 `data/bundle.js` 这类 classic script（kit 已如此设计） |
| `new Worker('vendor/w.js')` | **blocked** "cannot be accessed from origin 'null'" | worker 源码必须内联为字符串 → Blob URL |
| `new Worker(blobURL)` | ok | ✅ |
| `import('./x.mjs')` | **blocked** | ESM 库不能直接用 |
| `import(blobURL)` | ok | ✅ ESM 库可"字符串化 + blob import"（需改写 bare import） |
| Blob-worker 内 `fetch(页面创建的 blobURL)` | **Failed to fetch** | 不同 opaque origin；**wasm 不能用 blob URL 传给 worker** |
| Blob-worker 内 `fetch('data:…;base64,…')`（30 MB） | ok | ✅ wasm 用 data: URL 传给 worker |
| sandboxed `srcdoc` iframe (`sandbox="allow-scripts"`) + postMessage | ok，iframe origin `null`，`parent.document` 不可读 | ✅ 技能沙箱可在 file:// 工作 |
| meta CSP `connect-src` 白名单 | 外网 fetch 被拦 | ✅ 防外泄 |
| sql.js 默认（fetch `.wasm`） | **fail**（"both async and sync fetching of the wasm failed"）；且失败后 `initSqlJs` 缓存了失败的 promise，同页再用 `wasmBinary` 也失败 | 一开始就传 `wasmBinary` |
| sql.js `initSqlJs({wasmBinary: b64→Uint8Array})` | ok，23–46 ms | ✅ |
| `sql-asm.js`（纯 asm.js，无 wasm） | ok，严格 CSP 下也 ok | ✅ 零 wasm 方案 |
| DuckDB-WASM 1.32.0 全离线（§5.5 配方） | ok：import 15–20 ms，instantiate 2.2–4.0 s，`SELECT version()` = v1.4.3 | ✅ 可行但重 |
| `fetch('http://127.0.0.1:port')` from file:// | 发 `OPTIONS` 预检 + `Origin: null`；服务端回 `Access-Control-Allow-Origin: null` 后 POST 成功 | 本地 LLM 可直连，取决于服务端 CORS |

---

## 3. 库总表（版本 / 许可证 / 体积 / 离线可用性，均 2026-10-14 核实）

| 库 | npm 版本（发布日） | License | Classic-script 文件 | raw / gz | 严格 CSP（无 unsafe-eval） | file:// | ★ | 结论 |
|---|---|---|---|---|---|---|---|---|
| **RK.expr / RK.query**（kit 自研） | — | 自有 | `kit/core/rk.expr.js`, `rk.data.js` | ~45 KB 源码 | ✅ | ✅ | — | **adopt（已在）** |
| Arquero | 8.0.3 (2025-05-29) | BSD-3-Clause | `dist/arquero.min.js` (global `aq`) | 236 KB / 74 KB | ❌（全部 verbs 用 `Function`） | ✅ | 1.5k | consider |
| AlaSQL | 4.20.0 (2026-10-08；min.js 头注 4.19.1) | MIT | `dist/alasql.min.js` | 516 KB / 111 KB | ❌ | ✅ | 7.3k | avoid（客户 SQL） |
| DuckDB-WASM | 1.32.0 stable (2025-12-16, DuckDB 1.4.3)；npm `latest`=1.33.1-dev57.0，`next`=1.33.1-dev65.0（含 DuckDB 1.5.6） | MIT | ❌ 无 UMD：`duckdb-browser.mjs` + `duckdb-browser-eh.worker.js`(classic) + `duckdb-eh.wasm` | wasm 34.2 MB / 7.6 MB；worker 773 KB / 188 KB；mjs 32 KB | 需 `'wasm-unsafe-eval'`；worker 内 55× `Function` | ✅（配方） | 2.1k | **adopt（可选 power-pack）** |
| sql.js | 1.14.2 (2026-08-14) | MIT (SQLite PD) | `dist/sql-wasm.js` + `.wasm`；`dist/sql-asm.js` | 47 KB + 658 KB wasm (322 KB gz)；asm 1.36 MB / 452 KB | ✅（asm 实测）；wasm 版需 `wasm-unsafe-eval` | ✅（wasmBinary） | 13.7k | consider（轻量 SQL 备选） |
| danfo.js | 1.2.0 (2025-04-03) | MIT | `lib/bundle.js` | 6.8 MB（含 TF.js） | — | — | 5.1k | avoid |
| Apache Arrow JS | 21.2.0 (2026-07-21)；DuckDB-WASM 1.32 依赖 `^17.0.0` | Apache-2.0 | `Arrow.es2015.min.js` (global `Arrow`) | 193 KB / 51 KB（v17: 173 KB） | ✅ | ✅ | (apache/arrow-js 0.1k, 新拆分仓库) | consider（仅作 DuckDB peer） |
| Flechette | 2.7.0 (2026-10-12) | BSD-3-Clause | `dist/flechette.min.js` (UMD) | 49 KB / 16 KB | ✅ | ✅ | 0.2k | consider（Arrow IPC 数据通道） |
| Formula.js | 4.6.1 (2026-07-28) | MIT | `lib/browser/formula.min.js` (global `formulajs`) | 143 KB / 45 KB | ✅ | ✅ | 0.8k | **adopt（Excel 金融函数包）** |
| math.js | 15.2.0 (2026-04-07) | Apache-2.0 | `lib/browser/math.js` (global `math`) | 650 KB / 175 KB | ✅ | ✅ | 15.1k | reference |
| expr-eval | 2.0.2 (2019-09-28) | MIT | `dist/bundle.min.js` | 25 KB / 8 KB | — | — | 1.4k | **avoid（CVE-2025-12735）** |
| expr-eval-fork | 3.0.3 (2026-02-02) | MIT | `dist/bundle.min.js` (global `exprEval`) | 27 KB / 8 KB | ✅ | ✅ | — | consider |
| filtrex | 3.1.0 (2024-10-14) | MIT | `dist/browser/filtrex.min.js` | 74 KB / 12 KB | ❌ | ✅ | 0.1k | avoid |
| jsep | 1.6.0 (2026-10-11) | MIT | `dist/iife/jsep.iife.min.js` | 11 KB / 3.5 KB | ✅（仅解析） | ✅ | 1.0k | reference |
| JSONata | 2.2.2 | MIT | `jsonata.min.js` | 80 KB / 24 KB | ✅ | ✅ | 2.7k | reference（API 适配层转换） |
| vega-expression | 6.2.2 | BSD-3-Clause | ❌ build 是 ESM | 54 KB / 14 KB | codegen 用 Function（vega-interpreter 为 CSP 版） | ❌ | (vega 12k) | reference（allow-list AST 设计） |
| HyperFormula | 3.5.0 | **GPL-3.0-only** / 商业 | — | — | — | — | 2.8k | avoid |
| PRQL | `prqlc` 0.13.14 (2026-07-24)；`prql-js` 0.12.1 (2024-06) 已停更 | Apache-2.0 | ❌ wasm-bindgen ESM | wasm 5.5 MB | — | ❌ | 10.9k | avoid |
| Mosaic | 0.33.0 (2026-10-13) | BSD-3-Clause | ❌ 只发 `src/*.js`（ESM 源码） | core 0.5 MB 源码 | — | ❌ | 1.4k | reference |
| crossfilter2 | 1.5.4 (2020-09) | Apache-2.0 | `crossfilter.min.js` | 15 KB / 6 KB | ✅ | ✅ | 1.8k | reference |
| Perspective | `@perspective-dev/client` 5.6.0 (2026-10)；旧 `@finos/perspective` 3.8.0 | Apache-2.0 | ❌ ESM + wasm + worker（`perspective-js.wasm` 630 KB + server wasm） | MB 级 | — | 需配方 | 11.3k | reference（pivot + ExprTK 表达式列，源自 J.P. Morgan） |
| @sqlite.org/sqlite-wasm | 3.53.4-build2 | Apache-2.0 | ❌ ESM | wasm 869 KB | — | OPFS ❌ | 1.1k | avoid（用 sql.js） |
| PGlite | 0.5.9 | Apache-2.0 | ❌ ESM | 数 MB | — | — | 16.1k | avoid |
| QuickJS-emscripten | 0.32.0 | MIT | `@jitl/quickjs-singlefile-browser-release-sync`（wasm 内嵌 base64，ESM） | ~0.6–0.8 MB | ✅（解释器） | 需 blob import | 1.7k | consider（不可信技能 JS 沙箱） |
| SES (Hardened JS) | 2.3.0 | Apache-2.0 | `dist/ses.umd.min.js` | 238 KB | — | ✅ | 1.1k | avoid（lockdown 冻结 intrinsics，易破坏 ECharts 等） |
| Pyodide | 314.0.7 | **MPL-2.0** | — | 10s of MB | — | — | 14.9k | avoid（体积 + MPL 标注） |

---

## 4. 公式引擎（derived metrics）

### 4.1 现状：`RK.expr`（kit 自研，580 行）

- Pratt parser → AST → **closures**（无 `eval`/`Function`）；`compile()` 带缓存；`check()` 返回 `{ok, error, pos}` 便于输入框实时提示；未知字段给 "did you mean" 建议。
- 语法覆盖 IB 场景：`ev / ebitda_25e`、`if(net_debt < 0, "Net cash", "Net debt")`、`region in ["Asia","Europe"] and mkt_cap > 1000`、`ebitda_margin > 20%`、`` `EV / EBITDA 2025E` * 1.1 ``、`fcf / (@wacc - @g)`（@param 绑定 what-if 滑块）、聚合 `sum(ev)/sum(ebitda_25e)`、`median()`、`wavg()`、`countd()`。
- 语义：除零 → NaN（显示 `n.m.`），null 传播（`n.a.`），字符串等值大小写不敏感。

**实测（100k 行逐行求值 `ebitda / rev * 100`，同一页面同一数据）：**

| 引擎 | 10k | 100k | 严格 CSP |
|---|---|---|---|
| **RK.expr** | **9.7 ms** | **14 ms** | ✅ |
| filtrex 3.1（编译成 JS） | 3.3–27 ms | 32–47 ms | ❌ |
| expr-eval-fork 3.0.3（栈式解释） | 12–33 ms | 45–67 ms | ✅ |
| math.js 15.2 `compile().evaluate()` | 14–32 ms | 70–72 ms | ✅ |

结论：**没有任何库在安全性、速度、IB 语义三方面超过现有 `RK.expr`**；不换。

### 4.2 候选库要点（为什么不选）

- **expr-eval 2.0.2**：CVE-2025-12735（CWE-94，CVSS 9.8）——向 `evaluate()` 传入构造的 context/member 可执行任意代码；修复在 `expr-eval-fork` 3.0.0（另有报道称原包 2.0.3 修复，但 npm 上原包最新仍是 2.0.2/2019）。来源：cvefeed、BleepingComputer、Rescana（见 §12）。**avoid**。
- **expr-eval-fork 3.0.3**：已修补、UMD、8 KB gz、CSP 安全；但语法（`and`/`or`、`x ? y : z`、无百分号/参数）不比 RK.expr 更适合；可作"如果将来想要外部维护的引擎"的备胎。
- **filtrex 3.1**：设计初衷就是"用户输入的安全过滤表达式"，属性访问受控（probe：`constructor` → `ReferenceError`）；但实现为编译成 JS + `new Function` → **严格 CSP 下直接失败**（实测）。仓库 92★，2024 后无发布。
- **jsep 1.6**：只做 JS 表达式解析 → ESTree AST（3.5 KB gz，IIFE）；求值器要自己写。若哪天重写 RK.expr 的 parser，可用它做"JS 子集"方言；目前没必要。
- **math.js 15.2**：表达式解析器是沙箱化的（`import()`/`createUnit` 等在 evaluate 中被禁用，probe：`import({x:1})` → "Undefined function import"），CSP 安全；但允许用户定义函数（`f(x)=x^2`）、矩阵、单位——对客户公式框是**过大的能力面**，体积 175 KB gz。reference。
- **JSONata 2.2**：JSON 查询/转换语言（MIT，24 KB gz，CSP 安全）。不适合银行家写指标，但非常适合**数据 API 适配层**（把未来 API 的 JSON 形状映射到 kit 的 dataset contract），可在 Python builder/adapter 侧使用。
- **vega-expression 6.2**：Vega 的安全表达式（allow-list AST + codegen）；新版 build 为 ESM-only，codegen 依赖 `Function`（CSP 场景用 `vega-interpreter`）。设计参考：**白名单函数表 + 禁止成员访问到原型**。
- **HyperFormula 3.5**：最完整的 Excel 公式引擎，但 **GPL-3.0-only 或商业许可** → avoid（客户交付物不可 GPL）。
- **Formula.js 4.6.1**：MIT，纯函数库（无解析器），实现 Excel 函数：`IRR`、`XIRR`、`NPV`、`XNPV`、`PMT`、`FV`、`RATE`、日期/统计/文本函数。实测 `IRR([-1000,300,400,500]) = 0.08896`，`XNPV(0.09, …) = 2086.65`，`PMT(0.05/12,360,300000) = -1610.46`，**严格 CSP 下正常**。→ **adopt 作为 `RK.expr` 的可选函数包**：`RK.expr.register('irr', {fn: formulajs.IRR, kind: 'aggregate'})`。

### 4.3 建议：公式引擎改进点

1. `RK.expr.register(name, {fn, kind: 'scalar'|'aggregate'|'window', arity, doc, returns})` —— 函数注册表；skills 和 Formula.js 包都通过它扩展；`RK.expr.functions` 自动更新（供自动补全和 LLM 提示）。
2. 窗口/时间序列函数（IB 常用）：`lag(x)`、`pct_change(x)`、`cagr(x, n)`、`rank(x)`、`percentile_rank(x)`、`zscore(x)`、`rolling_mean(x, 20)`——需在 `RK.query` 中引入 `order` 上下文。
3. 明确的**单位/格式推断**：已有 `guessFormat`；可扩展为"比率/倍数/百分比"类型系统（`ev/ebitda` → `x`，`a/b-1` → `%`）。
4. **公式即数据**：dataset contract 里已有 `"computed": [{name, formula, format}]`；客户新建的指标也存成同一结构（localStorage/IndexedDB），可导出为 JSON 给分析师回灌 Python 管线——形成"客户自定义指标 ↔ 分析师 pipeline"的闭环。
5. 输入体验：语法高亮 + 字段/函数自动补全（数据来自 `ds.fields` 和 `RK.expr.functions`）+ `check()` 位置错误提示——全部可原生实现，无需 CodeMirror（若需要，CodeMirror 6 是 ESM，需要打包成 IIFE）。

---

## 5. 查询 / SQL 引擎

### 5.1 统一基准（同一合成数据：`id, region(5), sector(8), rev, ebitda, ev`；查询 = region×sector 40 组，`SUM(rev), AVG(ebitda/rev), COUNT(*)`，按 rev 排序）

单次运行、headless、未预热，两次运行取范围；仅作量级参考。

| 引擎 | 10k | 100k | 1M | 备注 |
|---|---|---|---|---|
| 手写 JS 循环（下限） | 5 ms | 14–36 ms | 125–240 ms | |
| **RK.query**（kit） | 17 ms | 45 ms | 691 ms | 同时 median: 5 / 18 / 190 ms |
| Arquero 8（`from` 行对象 + derive + groupby + rollup） | 4 + 22–36 ms | 38–42 + 96–111 ms | 272–718 + 372–425 ms | `from()` 行→列转换是大头 |
| AlaSQL 4.20 | 28–40 ms | 97–185 ms | 101–148 ms | 编译成 JS，大数据反而快 |
| sql.js 1.14（insert + group） | 102 + 66 ms | 253 + 214 ms | 2353 + 3280 ms | SQLite 行存，无向量化 |
| **DuckDB-WASM 1.32**（Arrow 插入 + group） | — | 140 + 68 ms | 1200 + **111 ms** | median(`quantile_cont`) 36 / **50 ms**；instantiate 2.2–4 s 一次性 |
| crossfilter2（build + 一次 filter/重算） | 15 + 11 ms | 52–71 + 48–60 ms | 559–586 + 175–226 ms | |

解读：
- ≤100k 行（绝大多数 pitchbook 数据）：**RK.query 足够**（<50 ms，交互无感）。
- 100k–1M 行：RK.query 0.2–0.7 s（可接受但卡顿）；**DuckDB 查询 ~0.1 s 但需 2–4 s 启动 + 46 MB**。
- 列式化 kit 内部存储（见 §6.3）能让 RK.query 在 1M 行上接近手写循环（~0.15–0.25 s），这比引入 DuckDB 更划算，应优先做。

### 5.2 Arquero 8.0.3（UW IDL）

- 优点：dplyr 式 verbs（`derive/filter/groupby/rollup/pivot/fold/join/lookup`）、窗口函数、Arrow I/O（v7 起内置 flechette）、v8 新增流式 CSV/NDJSON 读取、UMD 产物齐全（`aq` 全局）。BSD-3。
- 安全：表达式字符串经 acorn 解析，**禁止赋值和闭包/全局引用**（probe：`d => (window.x = 1)` → "Assignments not allowed"；`globalThis` → "Invalid variable reference"），所以对注入是相对安全的。
- 但：**所有 verbs 都用 `new Function` 生成代码** → 严格 CSP 下连 `groupby().rollup()` 都失败（实测）；行对象 `aq.from()` 摄入慢（1M 行 0.3–0.7 s）；仓库自 2025-05 后无推送。
- 定位：如果 kit 想要一个"给开发者用的 dataframe API"（组件内部变换），Arquero 是最好的选择；但对"客户输入的查询"没有优势（还需要再造一个文本语法），故 **consider**，不进核心。

### 5.3 AlaSQL 4.20.0

- 优点：SQL 覆盖面广（JOIN、子查询、GROUP BY、PIVOT 方言）、直接查 JS 数组（`FROM ?`）、导入 XLSX/CSV、体积 111 KB gz、维护活跃（2026-10）。
- **致命问题（实测）**：双反引号 ``` ``…`` ``` 是"内联 JavaScript"语法——`alasql('SELECT VALUE ``window.__pwned3=1``')` 执行成功并改写了全局变量。历史上还有方括号/反引号标识符拼接进生成代码的注入（Snyk SNYK-JS-ALASQL-1082932，<0.7.0）。所有查询编译为 JS（81 处 `Function`）→ 严格 CSP 失败。
- 风险模型：客户在自己的浏览器里"注入自己"本身不是大问题，但一旦 SQL 文本来自 **LLM 输出、共享链接/保存的视图、导入的技能**，它就是 XSS/数据外泄通道。→ **avoid**（作为客户 SQL 控制台引擎）。

### 5.4 sql.js 1.14.2

- 用法（file:// 可用）：Python builder 把 `sql-wasm.wasm` 写成 `vendor/sqljs/sql-wasm.wasm.b64.js`（`window.SQL_WASM_B64="…"`，878 KB），页面 `initSqlJs({wasmBinary: b64ToBytes(SQL_WASM_B64)})`，23–46 ms 完成。
- **坑**：若先用默认方式（fetch `.wasm`）失败，`initSqlJs` 会缓存失败的 promise，同页再传 `wasmBinary` 也失败——必须第一次就传。
- `sql-asm.js`（1.36 MB，纯 JS）在严格 CSP、无 `wasm-unsafe-eval` 下也能跑。
- SQLite 方言：有窗口函数（实测 `SUM() OVER (PARTITION BY … ORDER BY …)` ok），**无** median/quantile/PIVOT/QUALIFY；行存逐行 INSERT，1M 行需 2.4 s 装载 + 3.3 s 聚合。
- 定位：体积预算 <1 MB 且数据 ≤100k 时的 SQL 控制台；**consider**。

### 5.5 DuckDB-WASM（推荐的可选 SQL power-pack）

**版本现状（坑）**：npm 的 `latest` dist-tag 指向 **dev 构建** `1.33.1-dev57.0`（2026-06-22），`next` = `1.33.1-dev65.0`（2026-09-29，内含 DuckDB **v1.5.6**——从 wasm 字符串确认）；最后一个非 dev 版本是 **1.32.0**（2025-12-16，DuckDB **v1.4.3**，实测 `version()`）。GitHub release 页另有 v1.33.0 tag（"修复 npm 发布"）但 npm 上没有 1.33.0。DuckDB 官方文档称"latest stable DuckDB-Wasm = 1.5.6"（按 core 版本号称呼）。**→ vendor.json 必须精确 pin**（建议 1.32.0 = 1.4 LTS 线；需要 1.5 特性（GEOMETRY/VARIANT）时 pin `1.33.1-dev65.0`）。Mosaic 0.33 依赖 `1.33.1-dev57.0`。

**Bundles**：`mvp`（无 wasm 异常，41 MB）、`eh`（wasm exceptions，34–36 MB，现代浏览器都支持 → 选它）、`coi`（多线程，需 `crossOriginIsolated` → file:// 不可用）。

**file:// 全离线配方（实测通过，Chromium 141）**——Python builder 生成 3 个 classic-script 文件：

```text
vendor/duckdb/arrow17.min.js          # apache-arrow@17 Arrow.es2015.min.js → global Arrow（1.32.0 依赖 ^17）
vendor/duckdb/duckdb-browser.mjs.js   # window.DUCKDB_MJS_SRC = "<duckdb-browser.mjs 源码, 把 import*as X from"apache-arrow" 改成 const X=self.Arrow>"
vendor/duckdb/duckdb-eh.worker.js.js  # window.DUCKDB_EH_WORKER_SRC = "<duckdb-browser-eh.worker.js 源码>"
vendor/duckdb/duckdb-eh.wasm.b64.js   # window.DUCKDB_EH_WASM_B64 = "<base64>"   (34.2 MB → 45.7 MB)
```

```js
// 懒加载（用户第一次打开 SQL 控制台时才插入上述 <script>，避免 46 MB 拖慢首屏）
const mod = await import(URL.createObjectURL(new Blob([DUCKDB_MJS_SRC], {type: 'text/javascript'})));
const worker = new Worker(URL.createObjectURL(new Blob([DUCKDB_EH_WORKER_SRC], {type: 'text/javascript'})));
const db = new mod.AsyncDuckDB(new mod.VoidLogger(), worker);
await db.instantiate('data:application/wasm;base64,' + DUCKDB_EH_WASM_B64);  // ← data: URL；blob: URL 在 worker 里 fetch 失败
const conn = await db.connect();
await conn.query("SET enable_external_access = false");   // 禁远程/文件访问
await conn.query("SET lock_configuration = true");        // 锁配置，防 SQL 里改回
await conn.insertArrowTable(Arrow.tableFromArrays(columns), {name: 'comps'});
```

**实测**：instantiate 2.2–4.0 s；100k 行 Arrow 插入 140 ms / group-by 68 ms；1M 行插入 1.2 s（含行→列转换）/ group-by **111 ms** / median **50 ms**；JS heap ~170–270 MB。`PIVOT … USING sum()`、窗口函数、`QUALIFY`、`GROUP BY ALL` 均可用。

**安全加固（实测）**：
- `SET enable_external_access=false` + `SET lock_configuration=true` 后：`read_csv('https://…')` → "Permission Error: file system operations are disabled"；`SET enable_external_access=true` → "configuration has been locked"。
- **只读校验**：`SELECT json_serialize_sql($q)` 对非 SELECT 返回 `{"error":true,"error_message":"Only SELECT statements can be serialized to json!"}` → 用作"只允许 SELECT"的守卫（再配合每次查询在独立连接/重建临时表）。
- **结果类型坑**：`COUNT(*)`/BIGINT 返回 JS `BigInt` → `JSON.stringify` 抛 "Do not know how to serialize a BigInt"；DECIMAL 返回字符串/对象。结果适配层需把 Int64→Number（超出 2^53 时转字符串）、Decimal→Number。

**体积权衡**：46 MB 放在报告文件夹里可以接受（离线 U 盘/内网共享），但邮件附件不行 → builder flag `sql_console: "duckdb" | "sqljs" | "none"`，默认 `none`（RK.query 即可）。

### 5.6 其他

- **danfo.js 1.2**：pandas-like，但 bundle 6.8 MB 含 TensorFlow.js，Plotly 绑定；2025-04 后无发布。avoid。
- **PRQL**：管道式查询语言，编译到 SQL；JS 绑定改名 `prqlc`（0.13.14，2026-07），5.5 MB wasm，ESM（wasm-bindgen web target），仍需底层 SQL 引擎。对银行客户是第三种语言，没有必要。avoid。
- **Perspective**（`@perspective-dev/*` 5.6.0，Apache-2.0，原 J.P. Morgan 开源，现 perspective-dev 组织）：流式 pivot + 表达式列（ExprTK）+ datagrid/图表，WASM + worker；ESM，需同样的 blob 配方；体积 MB 级且自带视觉风格。作为"高级数据浏览附录"的候选 reference，不进核心。
- **Apache Arrow JS 21.2 / Flechette 2.7**：未来数据 API 若返回 Arrow IPC，用 flechette（16 KB gz UMD，零拷贝 typed arrays）解码，比 apache-arrow 小 3×；但 DuckDB-WASM 1.32 的 JS 接口硬依赖 apache-arrow 17。

### 5.7 推荐（查询）

| 层 | 引擎 | 何时 |
|---|---|---|
| L0 默认 | `RK.query`（文本 mini-language）+ `RK.expr` | 所有报告；≤~300k 行 |
| L1 可选 SQL 控制台 | DuckDB-WASM 1.32.0（eh bundle，懒加载，锁配置，只读守卫） | builder flag；大数据（>300k）或需要 window/pivot/quantile 的分析附录 |
| L1' 轻量 SQL | sql.js 1.14.2 | 体积受限、数据 ≤100k、只要标准 SQL |
| 不用 | AlaSQL / Arquero（客户输入）/ danfo / PRQL / PGlite | 见上 |

两种查询语言并存时，**以 `RK.query` 的 spec 对象为中间表示**（`{from, select:[{expr, as, format}], by, where, sort, limit}`）：L0 直接执行；L1 把 spec 编译成 DuckDB SQL（`RK.expr` AST → SQL 表达式，函数名映射 `median→median`, `wavg(x,w)→sum(x*w)/sum(w)`, `countd→count(DISTINCT …)`）。这样图表组件、LLM 意图、保存的视图都只认一种 spec，引擎可替换。

---

## 6. Cross-filter 方案

### 6.1 现状

`RK.store` 已有：`setFilter(key, {field, op:'in'|'not_in'|'between'|'search'|'expr'|'eq', values, source, datasets})`、`toggleValue()`、`clearFilters(source)`，`RK.data.view(ds, {exclude: source})` —— **即 crossfilter 语义：每个图表计算自己的视图时排除自己发出的过滤**（Mosaic 叫 `Selection.crossfilter()`；dc.js/crossfilter 叫 "dimension 不受自身 filter 影响"）。`affected(ds, changes)` 用于只重绘受影响的组件。

### 6.2 参考：Mosaic 0.33（UW IDL）

- 架构：`Coordinator` 管理所有 `MosaicClient`（图表/输入），客户端声明查询，交互产生 `Selection`（clauses: point/interval/match），协调器把查询**合并（consolidation）**、**缓存**、对 crossfilter 自动建**预聚合物化视图**（v0.32 起基于 lineage 分析），推给 DuckDB（WASM 或 Python/Go server）。
- 0.32.0（2025-09-28）breaking：去掉 JSON 传输，**强制 Arrow**；0.32.1 去掉 WebSocket；0.33.0（2026-10-13）SQL AST 扩展。npm 包只发 TS/ESM 源码（`src/*.js`），**无 bundle**。
- 可借鉴：(1) Selection 的 `resolve: 'intersect'|'union'|'single'` + `cross: true`；(2) **预聚合**：对 brush 型交互，预先按"被刷字段的像素分箱"聚合，刷选时只扫描分箱表（Falcon/Mosaic 思路），1M→几千行；(3) 查询合并：多个图表的同一数据源查询合成一次扫描。

### 6.3 推荐

1. **保留 `RK.store` 作为唯一的过滤状态源**（可序列化进 URL hash / 保存视图 / LLM 意图），ECharts `brushSelected`/`datazoom`/`click`、Leaflet 选区、表格行点击都只写 store。
2. **性能分级**：
   - ≤100k 行：现状（行对象 + predicate 过滤）足够（RK.query 100k 45 ms）。
   - 100k–1M 行：**内部列式化**——`Dataset` 保留 `rows` 视图但内部存 `columns: {name: Float64Array | Uint32Array(dict codes)}`；字符串字典编码；每个 filter 生成一个 `Uint32Array` bitset，`view()` = 各 bitset AND（排除自身时跳过）；group-by 走 dict code 的数组累加器。预期 1M 行 group-by ~100–200 ms（手写循环实测 125–240 ms）。
   - >1M 或需要 SQL：DuckDB 适配器（`RK.data.adapter('duckdb')`），filter spec → SQL `WHERE`。
3. **不引入** crossfilter2（2020 后停更，实测 build 0.56 s/1M，与手写同量级）与 Mosaic（ESM 源码、强依赖 DuckDB、月度 breaking）。
4. 动画：过滤变化时用 ECharts `setOption` 的 merge + `universalTransition`，保持"tasteful motion"。

---

## 7. 数据通道（与查询引擎相关的建议）

- 现行 contract：`data/bundle.js` 调 `RK.data.preload({...})`（file:// 可用）；records 或 arrays-in-field-order；`meta`、`computed` 字段。✅
- 为 1M 行/DuckDB 场景，建议 contract 增加**列式编码**：`"columns": {"rev": {"type":"f64","b64":"…"}, "sector": {"type":"dict","values":[…],"codes_b64":"…"}}`（Python 端 `numpy.tobytes()` + base64），或直接 `"arrow_ipc_b64"`（pyarrow 生成，flechette/apache-arrow 解码）。base64 typed arrays 比 JSON 数字数组小 ~40–60%、解析快一个数量级，且可零拷贝喂给 DuckDB（`insertArrowTable`）。
- 未来数据 API：`GET {api}datasets/{id}` 支持 `Accept: application/vnd.apache.arrow.stream` 与 JSON 两种；服务器端可直接用 DuckDB/Mosaic Python server。

---

## 8. Step 2：连接本地部署的 LLM

### 8.1 拓扑选项

| 方案 | 描述 | file:// 双击 | 优点 | 缺点 |
|---|---|---|---|---|
| **A. 直连本地 OpenAI 兼容服务** | 页面 `fetch('http://127.0.0.1:11434/v1/chat/completions')` | ⚠️ 取决于服务端 CORS 是否接受 `Origin: null` + Chrome LNA | 零额外组件 | CORS 配置危险（§8.2）；LNA 行为未定义；暴露 `/api/pull` 等管理接口 |
| **B. Python companion（推荐）** | `python -m reportkit serve ./report --llm http://127.0.0.1:11434` → `http://127.0.0.1:8765/`，同源反代 `/llm/v1/chat/completions` | 用户改为打开 http://127.0.0.1:8765 | 同源，无 CORS/LNA；只暴露白名单路由；可加 token、审计日志、限流；顺带解锁 fetch/ESM/worker/OPFS/WebLLM 缓存/技能里的 Python 脚本 | 需要本机 Python（分析师/银行环境通常有）；客户端机器不一定有 |
| C. 浏览器内模型 | WebLLM（WebGPU）、transformers.js（ONNX/WebGPU）、wllama（CPU wasm） | ⚠️ 权重需 http(s) 获取（GB 级不可内嵌）；wllama 可让用户选本地 `.gguf` | 数据绝不出页面 | 设备依赖强（WebGPU/显存）；首载 GB 级；file:// 无多线程 |
| D. 浏览器内置 AI | Chrome Prompt API（Gemini Nano, `LanguageModel`） | ? | 零部署 | 仅 Chrome 桌面；2026 年网页端是否 stable 资料冲突（Tom's Hardware 称 Chrome 148 stable，其他称仍 origin trial）；非银行指定模型 |
| E. 内网 LLM 网关 | `https://llm.bank.internal/v1`（vLLM/LiteLLM） | ⚠️ 需网关 CORS 允许 `null` | 集中治理、日志、鉴权 | 离开"本机"范畴，需 IT 审批 |

**推荐**：Provider 抽象层支持 A/B/C/D/E，默认 B；A 作为"高级用户"选项并在 UI 中提示所需配置；C 作为"完全离线演示"选项（小模型）。

### 8.2 CORS 实况（`Origin: null`）

| 服务 | 默认 | 让 file:// 页面可调用的设置 | 备注（来源） |
|---|---|---|---|
| **Ollama**（MIT，183k★） | 允许 `http(s)://localhost|127.0.0.1|0.0.0.0[:*]`、`app://*`、`file://*`、`tauri://*`、`vscode-webview://*`、`vscode-file://*` | `OLLAMA_ORIGINS="*"`（全放开）或 `OLLAMA_ORIGINS="null*"`（只匹配字面 `null`） | 读源码 `envconfig/config.go` + gin-contrib/cors：`file://*` 匹配不到 Chrome 发送的 `null`；**`OLLAMA_ORIGINS=null` 会因 `Validate()` "bad origin: origins must contain '*' or include http://,https://…" 在启动时 panic**；`null*` 走 wildcard 规则通过校验并前缀匹配 `null`。⚠️ 基于代码阅读，未对真实 Ollama 进程实测。Linux systemd 下需写进 service 环境变量。 |
| **LM Studio** | 未说明（指南称默认只同源） | Developer → Server Settings → **Enable CORS** 开关；另有 "Require Authentication"（API token） | lmstudio.ai docs + 第三方指南；端口默认 1234 |
| **vLLM**（Apache-2.0） | 当前文档：`--allowed-origins` 默认 `[]`（"Cross-origin browser access is disabled by default"），老版本为 `["*"]` | `--allowed-origins '["null"]'`（Starlette 精确匹配）+ `--api-key` | docs.vllm.ai/en/latest/cli/serve；`--api-key` 只保护 `/v1` `/v2` `/inference` 前缀 |
| **llama.cpp `llama-server`**（MIT） | `--cors-origins` 默认 `*`：**回显任意 Origin 且允许 credentials** | 默认即可；启用 `--tools/--agent/MCP` 时默认收紧为 `localhost` | tools/server/README.md |

**安全警告**：允许 `null` ≈ 允许任何网站——任何公网页面都能用 `<iframe sandbox="allow-scripts" srcdoc>` 制造 `null` origin 去调用本机模型 API（Ollama 还包括拉取/删除模型、Codex 代理等端点）。Chrome 142+ 的 LNA 权限提示能挡住"公网→loopback"，但不是所有浏览器/版本都有。**这就是推荐方案 B（companion 只反代白名单路由 + 随机 token）的根本原因。**

### 8.3 Chrome Local Network Access（LNA）

- Chrome 141/142 起：公网站点访问本地/loopback 地址（fetch、子资源、子 frame 导航；后续扩展到 WebSocket/WebTransport/WebRTC）需用户授权；仅限 secure context；Chrome 145 拆分为 `local-network` 与 `loopback-network` 两个权限；iframe 需 `allow="loopback-network"`；企业策略 `LocalNetworkAccessAllowedForUrls` / `LocalNetworkAccessBlockedForUrls`（`*` = 全放行）。
- `file://` 发起方：blink-dev 回复称 "somewhat weakly specified"；`file://` 是 secure context（实测 `isSecureContext=true`）。**必须在银行目标 Chrome/Edge 版本上实测**；企业环境用 GPO 下发 `LocalNetworkAccessAllowedForUrls`（含 `file:///*` 或 companion 的 `http://127.0.0.1:8765`）。
- 方案 B 中页面本身在 loopback（`http://127.0.0.1:8765`），loopback→loopback 不触发 LNA。

### 8.4 页面侧安全基线

1. 严格 CSP（builder 生成）：`default-src 'none'; script-src 'self' file: 'unsafe-inline' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src data: <llm-endpoint>; img-src data: blob: file: 'self'; style-src 'unsafe-inline' file: 'self'; font-src file: 'self' data:`（file:// 下 `'self'` 语义不可靠，显式列 `file:`）。实测外网 fetch 被拦。**这让"LLM 被提示注入后把数据发到外网"在浏览器层面不可能。**
2. LLM 输出一律当**不可信数据**：只接受 JSON schema 内的意图；渲染文本用 `textContent`/sanitizer，绝不 `innerHTML`；不把 LLM 文本塞进 ECharts `tooltip.formatter`（HTML）——用 kit 自己的 tooltip 渲染器。
3. 发送给模型的上下文**最小化**：schema + data dictionary（字段 title/unit/format/描述）+ 指标目录 + 少量聚合样本；默认不发明细行；UI 显示"将发送的内容"并可审计（银行合规）。
4. 所有 LLM 交互写本地审计日志（IndexedDB），可导出。

### 8.5 交互协议：结构化意图（推荐）

**Provider 抽象**（OpenAI 兼容即可覆盖 Ollama / LM Studio / vLLM / llama.cpp / 网关；不引入 `openai` SDK——80 行 fetch + SSE 解析即可）：

```js
RK.ai.configure({
  provider: 'openai-compatible',            // | 'webllm' | 'chrome-prompt'
  baseURL: '/llm/v1',                       // companion；或 'http://127.0.0.1:11434/v1'
  model: 'qwen3-coder:30b',                 // 由用户/IT 配置
  apiKey: null, temperature: 0, timeoutMs: 60000
});
```

**意图 schema（`response_format: {type:'json_schema', json_schema:{name:'rk_intent', schema}}`，Ollama 原生 `format` 也支持 JSON schema；tools 亦可）**：

```json
{
  "oneOf": [
    {"properties": {"kind": {"const": "query"},   "rkql": {"type": "string"}, "explain": {"type": "string"}}},
    {"properties": {"kind": {"const": "metric"},  "name": {"type": "string"}, "formula": {"type": "string"}, "format": {"type": "string"}}},
    {"properties": {"kind": {"const": "filter"},  "field": {"type": "string"}, "op": {"enum": ["in","not_in","between","eq","search","expr"]}, "values": {}}},
    {"properties": {"kind": {"const": "chart"},   "spec": {"$ref": "#/defs/rkChart"}}},
    {"properties": {"kind": {"const": "sql"},     "sql": {"type": "string"}}},
    {"properties": {"kind": {"const": "answer"},  "text": {"type": "string"}, "cites": {"type": "array"}}}
  ]
}
```

执行管线：`LLM → JSON.parse → schema 校验 → RK.expr.check / RK.query.parse / json_serialize_sql 只读守卫 → 本地执行 → 结果 + "可编辑的公式/查询" 回显给用户 → 失败时把错误（含 pos、did-you-mean）回喂模型重试 ≤2 次`。

**Tool-calling 循环**（模型支持 tools 时）：`list_datasets()`, `describe_dataset(id)`（字段+统计摘要）, `run_query(rkql)`（返回 ≤50 行聚合）, `define_metric(name, formula)`, `set_filter(...)`, `make_chart(spec)`, `explain_chart(id)`。最多 6 轮；每轮结果截断；用户可见每个工具调用（透明度）。

**Chart 意图**：LLM 生成 kit 自己的 `rk-chart` spec（`{type:'bar'|'scatter'|'bubble'|'choropleth'|…, data:{rkql}, encode:{x,y,color,size,shape,label}, title, subtitle}`），由 kit 映射到 ECharts/Leaflet——表面积小、可 schema 校验、风格统一；**不要**让 LLM 直接写 ECharts option（巨大表面积、formatter 字符串/HTML、风格失控）。这与 GPT-Vis 的"LLM 友好 DSL"、NL4DV 的"结构化 JSON 输出 Vega-Lite"一致。

### 8.6 Text-to-SQL / Text-to-Chart 生态（参考）

| 项目 | 许可 | 形态 | 最新 | 对我们 |
|---|---|---|---|---|
| **VMind**（VisActor） | MIT | TS 库，`generateChart(prompt, fieldInfo, dataset)` → **VChart spec**；数据抽取/洞察/对话式编辑/导出 GIF | 2.0.10（2025-08-01）；仓库 470★ | reference：只出 VChart spec（我们用 ECharts）；UMD 2.1 MB min/534 KB gz，UMD 包装期望 Node 模块全局（`util`/`stream`/`http`…）；默认 GPT，可换 OpenAI 兼容 URL |
| **GPT-Vis**（AntV） | MIT | 26 种图；**markdown-like DSL**（`vis line` + 缩进数据行）可流式渲染、容错；基于 G2/G6；附 MCP server（mcp-server-chart, 4.4k★）与 "chart-visualization" Agent Skill | 1.0.2（2026-09-17）；788★ | reference：DSL 设计、流式渲染、容错思路很值得借鉴；UMD 2.3 MB/665 KB gz，风格非投行 |
| **LIDA**（Microsoft） | MIT | Python；summarize → goals → **生成并执行可视化代码** → 自评/修复 | 仓库 2024-08 后无推送；3.3k★ | reference（思路）/ avoid（代码执行模型不适合客户交付物） |
| **NL4DV** | MIT | Python；NL query → **结构化 JSON**（属性、任务、Vega-Lite specs）；v3/4 支持 LLM 模式 | 2026-08 有推送；171★ | reference：意图 JSON 模式与我们推荐一致 |
| **Data Formulator**（Microsoft） | MIT | 应用；AI agent + 概念驱动的数据变换 + 图表；数据线程（Data Threads） | 活跃（2026-10）；17.6k★ | reference（UX：分支式探索、派生字段） |
| AntV AVA | MIT | 图表推荐/洞察（规则 + LLM） | 3.4.1；`dist/ava.min.js` 353 KB | reference |

**本地 text-to-SQL 模型**（供 IT 选型参考，需在银行数据字典上自评）：Snowflake **Arctic-Text2SQL-R1**（7B/14B/32B，基于 Qwen2.5-Coder，RL + 执行正确性奖励，ACL 2026 Findings，7B 号称超过 70B 级旧系统）；**Qwen3-Coder**（Ollama 有 `qwen3-coder`）；MotherDuck **DuckDB-NSQL-7B**（Ollama 有 `duckdb-nsql`，专为 DuckDB 方言）；defog sqlcoder-7b-2（基线）。对我们的 `RKQL` 方言，**few-shot + schema 内的示例** 比专门的 SQL 模型更重要；通用指令模型（Qwen3 8B–32B 级）+ JSON schema 约束解码通常足够。

### 8.7 浏览器内推理（选项 C 细节）

- **WebLLM 0.2.86**（Apache-2.0，19.3k★）：WebGPU；OpenAI 风格 API、JSON mode/JSON schema 约束生成（XGrammar）、function calling；Web Worker / Service Worker 引擎；缓存后端 Cache API（默认）/ IndexedDB / OPFS / 实验性 Cross-Origin Storage。**npm 只发 ESM `lib/index.js`（6.8 MB / 2.3 MB gz）**；模型库 wasm + 权重从 HF/自托管 URL fetch。file:// 下 Cache API 与 IndexedDB 可用（实测），但首次必须从 http(s) 拉权重（HF CDN 有 `ACAO:*`，离线则不行）。→ 仅适合 companion/内网模式。
- **transformers.js 4.3.1**（Apache-2.0）：`dist/transformers.web.min.js` 为 ESM（128 KB gz，另需 onnxruntime-web wasm 数 MB）。适合小任务：**嵌入模型做"指标/字段语义搜索"**（如 all-MiniLM 量化版 ~20–25 MB，可用 data: URL 内嵌，同 DuckDB 配方）、零样本分类。
- **wllama 3.8.1**（MIT）：llama.cpp → wasm（8.8 MB），CPU 推理，可从 `File`/`Blob` 加载 GGUF（用户 `<input type=file>` 选择本地模型）→ **file:// 可用**；但无 SharedArrayBuffer → 单线程，1–3B 模型尚可，7B 不现实。
- **Chrome Prompt API**：`LanguageModel.availability()` / `create()` / `prompt()`；桌面 Chrome，需 ~22 GB 磁盘、>4 GB VRAM；2026 stable 状态资料冲突；页面里 `typeof LanguageModel` 在 headless 141 为 `undefined`。→ 渐进增强（"如果可用，提供快速本地摘要"）。

---

## 9. "Skills" 插件架构（前端）

### 9.1 设计目标

- 技能 = 可导入的能力包：**提示词/知识（给 LLM）** + **声明式贡献（给报告运行时）** + **可选代码（沙箱）**。
- 兼容开放标准 **Agent Skills**（agentskills.io；Anthropic 发起，26k★ 规范仓库；26+ agent 产品支持）：目录内 `SKILL.md`（YAML frontmatter：`name`≤64 小写连字符且与目录同名、`description`≤1024，可选 `license`、`compatibility`≤500、`metadata`、实验性 `allowed-tools`），可选 `scripts/`、`references/`、`assets/`；**渐进披露**：启动时只加载 name+description（~100 tokens），激活时加载正文（建议 <5000 tokens/<500 行），资源按需加载。
- AntV（GPT-Vis 的 chart-visualization skill）与 MCP Apps（4 个官方 skill）都已用该格式发布 → 我们的技能包可直接被外部 agent（Claude/Codex/Copilot）复用，反之亦然。

### 9.2 包格式（建议）

```text
comps-valuation/                 # = skill name
├── SKILL.md                     # Agent Skills 标准：何时使用、步骤、示例（给 LLM）
├── rk-skill.json                # ReportKit 运行时清单（机器可读，JSON Schema 校验）
├── skill.js                     # 可选：classic-script 包装，file:// 下 <script> 加载 → RK.skills.register(...)
├── references/metrics.md        # 指标定义（LLM 按需读取）
└── assets/presets.json          # 图表/查询模板
```

```json
// rk-skill.json
{
  "name": "comps-valuation", "version": "1.0.0", "rkApi": "^1",
  "contributes": {
    "functions":  [{"name": "ev_to", "formula": "ev / {metric}", "params": ["metric"], "doc": "EV multiple"}],
    "metrics":    [{"name": "ev_ebitda_25e", "formula": "ev / ebitda_25e", "format": "0.0x", "dataset": "comps"}],
    "queries":    [{"id": "median-by-sector", "rkql": "median(ev_ebitda_25e) by sector sort 2 desc"}],
    "charts":     [{"id": "football-field", "spec": {"type": "range-bar", "data": {"rkql": "..."}}}],
    "prompts":    [{"id": "explain-outliers", "template": "Explain why {company} trades at {value}..."}],
    "tools":      [{"name": "peer_screen", "description": "...", "parameters": {"type": "object"}, "impl": "sandbox:peerScreen"}]
  },
  "permissions": {"datasets": ["comps"], "network": false, "ui": ["panel"]},
  "sandbox": {"entry": "sandbox.js"}
}
```

### 9.3 加载路径与信任级别

| 路径 | 信任 | 处理 |
|---|---|---|
| Builder 构建时打包（`skills/*.js` 由分析师/IT 审核） | 可信 | 直接 `RK.skills.register()`；函数可用原生 JS（仍建议纯函数） |
| 运行时用户导入（拖拽 .zip / `<input webkitdirectory>` / `showDirectoryPicker`，file:// 均可用） | 不可信 | 只应用**声明式**部分（schema 校验后：formula 走 `RK.expr.check`，rkql 走 `RK.query.parse`，chart spec 走 schema）；`tools`/代码只能在沙箱跑 |
| Companion 模式下的 `scripts/*.py`（Agent Skills 常见形态） | 需用户确认 | 由 companion 在本机执行（Python），页面只拿 JSON 结果；浏览器内不跑 Python（Pyodide 体积 + MPL-2.0） |

### 9.4 沙箱（代码型技能）

- **首选：sandboxed `srcdoc` iframe**（`sandbox="allow-scripts"`，**不给** `allow-same-origin`）——实测 file:// 下工作，origin `null`，无法访问 `parent.document`、cookie、storage。iframe 内再放 meta CSP `default-src 'none'; script-src 'unsafe-inline'` → 无网络。
- 通信：**JSON-RPC 2.0 over postMessage**，方法集仿 MCP Apps（`ui/initialize`、`tools/call`、`notifications/*`）：页面作为 host，技能 iframe 作为 client；host 只回应清单 `permissions` 允许的方法；数据以 structured clone 传入（只给声明的数据集、可截断/聚合后再给）。
- MCP Apps（`@modelcontextprotocol/ext-apps` 2.0.3；spec 2026-01-26，`text/html;profile=mcp-app`，`ui://` 资源，host 必须按声明构造 CSP、默认严格 CSP，web host 需中间 "sandbox proxy" 且与 host 不同源）——是成熟的参考实现，未来可让同一个技能 UI 同时跑在 Claude/ChatGPT 和我们的报告里。注意：npm 标 MIT、README 徽章标 Apache-2.0，需确认后再引入代码。
- 纯计算型技能也可放 **Blob Worker**（实测 file:// 可用，无 DOM）；需要**确定性 + 指令计数限制**时用 **QuickJS-emscripten**（MIT，singlefile 变体内嵌 wasm → 可 blob import），可设 interrupt handler/内存上限。
- 不用 SES/lockdown：会冻结全局 intrinsics，可能破坏 ECharts/Leaflet 等库。

### 9.5 运行时 API 草图

```js
RK.skills.register(manifest, impl?)     // 构建时打包的技能
RK.skills.import(fileOrDirHandle)       // 运行时导入 → 校验 → 预览贡献 → 用户确认
RK.skills.list() / enable(name) / disable(name)
RK.skills.catalogForLLM()               // [{name, description}]（渐进披露第 1 层）
RK.skills.activate(name)                // 返回 SKILL.md 正文（第 2 层），供 LLM system prompt
RK.ai.tools()                           // 内置工具 + 已启用技能的 tools（JSON schema）
```

持久化：IndexedDB（file:// 可用；注意 Chrome 中 file:// 页面共享存储桶 → 存技能时带报告 ID 命名空间，敏感内容不落盘或加密）。

---

## 10. 推荐总体架构

```text
┌────────────────────────── index.html (file:// or http://127.0.0.1) ──────────────────────────┐
│  UI: formula bar · query console (RKQL | SQL) · chat panel · skills manager                  │
│        │                     │                         │                    │                │
│   RK.expr (formulas)   RK.query spec (IR) ──► engine:  │               RK.skills             │
│   + fn registry        ├─ L0 RK.query (JS, default)    │               ├─ declarative → expr/query/chart
│   + Formula.js pack    └─ L1 DuckDB-WASM (lazy) / sql.js               └─ code → sandbox iframe (JSON-RPC)
│        │                     │                         │                                     │
│   RK.store (filters/params/selection; crossfilter "exclude own source") ──► components (ECharts/Leaflet/tables)
│        │                                               │                                     │
│   RK.data (bundle.js | api adapter | duckdb adapter)   RK.ai (provider: openai-compatible | webllm | chrome)
│                                                        └─ intents (JSON schema) → validate → execute locally
│  CSP: connect-src = LLM endpoint only · no unsafe-eval (except wasm-unsafe-eval when DuckDB on)            │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
                     │ (optional)                                     │ (optional)
        python -m reportkit serve (companion)  ──── /llm/v1/* ───►  Ollama | LM Studio | vLLM | llama.cpp
        (same-origin, token, allow-listed routes, audit log, runs skill scripts/*.py with consent)
```

**分期**：
- **P0（现在）**：RK.expr 函数注册表 + Formula.js 包；RK.query 作为 IR；公式/查询输入框（补全 + 错误定位）；保存为 `computed`。
- **P1**：内部列式化 + bitset 过滤；DuckDB power-pack（builder flag + 离线配方 + 锁配置 + 只读守卫 + BigInt 适配）；严格 CSP 生成。
- **P2（Step 2）**：`RK.ai` provider + 意图 schema + 工具循环；Python companion；技能包格式 + 声明式导入；沙箱 iframe 运行时。
- **P3**：浏览器内小模型（嵌入语义搜索）；MCP Apps 兼容的技能 UI；WebLLM（companion 模式）。

---

## 11. Gotchas 清单

1. `file://` 下：fetch/XHR 本地文件、`new Worker(file)`、`import(file)` 全部被拦；Blob worker 不能 fetch 页面的 blob URL（不同 opaque origin）→ wasm 用 **data: URL**。
2. sql.js：失败的 `initSqlJs()` 被缓存；第一次就传 `wasmBinary`。
3. DuckDB-WASM：npm `latest` 是 dev 构建；1.32.0 硬依赖 apache-arrow 17（不是 21）；ESM 主模块有 bare import `"apache-arrow"` 需改写；COI bundle 在 file:// 不可用；BIGINT→BigInt、DECIMAL→字符串需适配；46 MB 体积必须懒加载。
4. AlaSQL：``` ``js`` ``` 内联 JS = 代码执行；不要喂不可信 SQL。
5. 严格 CSP（无 `unsafe-eval`）实测：Arquero / AlaSQL / filtrex **失败**；已 vendored 的 **ECharts 6.1.0（SVG renderer、字符串 formatter、dataZoom、brush）与 Leaflet 1.9.4 正常**；RK.expr、sql.js(asm)、math.js、expr-eval-fork、jsep、JSONata、Formula.js 正常。建议 `tests/` 增加 CSP smoke test，覆盖今后每个新 vendored 库（VChart 等含 `Function` 的库需逐个确认）。
6. expr-eval ≤2.0.2：CVE-2025-12735 RCE。
7. Ollama：`OLLAMA_ORIGINS=null` → 启动 panic（gin-cors Validate）；`file://*` 默认项匹配不到 Chrome 的 `null`；用 `*` 或 `null*`；Linux systemd 需改 unit 环境变量；允许 null ≈ 允许所有网站。
8. vLLM 新版默认不开 CORS（`--allowed-origins []`）；llama.cpp 默认回显任何 Origin 且带 credentials。
9. Chrome LNA（142+）对 file:// 行为未明确 → 目标环境实测或企业策略；companion 规避。
10. WebLLM/transformers.js 权重必须 fetch；file:// 只能在线首拉或换 companion。
11. `file://` 下 OPFS 不可用；IndexedDB/localStorage 可用但 Chrome 中所有 file:// 页面共享。
12. 原始体积才是 file:// 加载成本（浏览器不解压）；gz 体积只影响邮件/zip 投递。
13. LLM 输出永不进 `innerHTML`/ECharts HTML formatter；只接受 schema 内意图。
14. Agent Skills 的 `scripts/` 多为 Python/Bash：浏览器不执行，交给 companion（需确认）或忽略。

---

## 12. Sources

- Arquero: https://github.com/uwdata/arquero · releases https://github.com/uwdata/arquero/releases · npm https://www.npmjs.com/package/arquero
- AlaSQL: https://github.com/AlaSQL/alasql · Snyk advisory https://security.snyk.io/vuln/SNYK-JS-ALASQL-1082932 · Mend WS-2022-0138 https://www.mend.io/vulnerability-database/WS-2022-0138/
- DuckDB-WASM: https://github.com/duckdb/duckdb-wasm · releases https://github.com/duckdb/duckdb-wasm/releases · docs https://duckdb.org/docs/current/clients/wasm/overview.html · instantiation https://duckdb.org/docs/lts/clients/wasm/instantiation · extensions https://duckdb.org/docs/lts/clients/wasm/extensions
- sql.js: https://github.com/sql-js/sql.js
- danfo.js: https://github.com/javascriptdata/danfojs
- Apache Arrow JS: https://github.com/apache/arrow-js · Flechette: https://github.com/uwdata/flechette
- expr-eval CVE-2025-12735: https://cvefeed.io/vuln/detail/CVE-2025-12735 · https://bleepingcomputer.com/news/security/popular-javascript-library-expr-eval-vulnerable-to-rce-flaw · https://www.rescana.com/post/critical-rce-vulnerability-cve-2025-12735-in-javascript-library-expr-eval-and-expr-eval-fork-ris · expr-eval-fork https://github.com/jorenbroekema/expr-eval
- math.js: https://github.com/josdejong/mathjs · security https://mathjs.org/docs/expressions/security.html
- filtrex: https://github.com/cshaa/filtrex · jsep: https://github.com/EricSmekens/jsep · JSONata: https://github.com/jsonata-js/jsonata · vega-expression: https://github.com/vega/vega/tree/main/packages/vega-expression
- Formula.js: https://github.com/formulajs/formulajs · HyperFormula (GPL-3.0/commercial): https://github.com/handsontable/hyperformula
- PRQL: https://github.com/PRQL/prql · CHANGELOG https://github.com/PRQL/prql/blob/main/CHANGELOG.md
- Mosaic: https://github.com/uwdata/mosaic · releases https://github.com/uwdata/mosaic/releases · https://idl.uw.edu/mosaic/what-is-mosaic · Observable Framework Mosaic https://observablehq.com/framework/lib/mosaic
- crossfilter: https://github.com/crossfilter/crossfilter
- Perspective: https://github.com/perspective-dev/perspective
- QuickJS-emscripten: https://github.com/justjake/quickjs-emscripten · SES: https://github.com/endojs/endo · Pyodide: https://github.com/pyodide/pyodide
- Ollama allowed origins source: https://github.com/ollama/ollama/blob/main/envconfig/config.go · CORS wiring https://github.com/ollama/ollama/blob/main/server/routes.go · gin-contrib/cors https://github.com/gin-contrib/cors (config.go `Validate`, `parseWildcardRules`) · OpenAI compatibility https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx · structured outputs https://ollama.com/blog/structured-outputs · guides https://objectgraph.com/blog/ollama-cors/ https://localaimaster.com/blog/ollama-403-forbidden-cors
- LM Studio server settings: https://lmstudio.ai/docs/developer/core/server/settings · https://docs.privategpt.dev/providers/lmstudio
- vLLM serve CLI: https://docs.vllm.ai/en/latest/cli/serve/ · https://docs.vllm.ai/en/v0.8.5/serving/openai_compatible_server.html
- llama.cpp server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- Chrome LNA: https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY · MDN https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access · https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/loopback-network · https://blog.openreplay.com/chrome-local-network-access-lna-permission/ · https://workadventu.re/tech/chrome-142-local-scripts-fix/
- Chrome Prompt API (conflicting status): https://www.tomshw.it/business/chrome-148-gemini-nano-prompt-api-stabile-runtime-browser-locale · https://jwatte.com/blog/chrome-prompt-api-free-browser-llm.md · https://noqta.tn/en/tutorials/chrome-built-in-ai-prompt-api-gemini-nano-2026
- WebLLM: https://github.com/mlc-ai/web-llm · transformers.js: https://github.com/huggingface/transformers.js · wllama: https://github.com/ngxson/wllama
- VMind: https://github.com/VisActor/VMind · GPT-Vis: https://github.com/antvis/GPT-Vis · mcp-server-chart: https://github.com/antvis/mcp-server-chart · LIDA: https://github.com/microsoft/lida · NL4DV: https://github.com/nl4dv/nl4dv · https://nl4dv.github.io/nl4dv/ · Data Formulator: https://github.com/microsoft/data-formulator · AVA: https://github.com/antvis/AVA
- Text-to-SQL models: https://snowflake.com/en/engineering-blog/arctic-text2sql-r1-sql-generation-benchmark · https://www.snowflake.com/en/blog/engineering/arctic-text2sql-excot-sql-generation-accuracy/ · https://ollama.com/library/duckdb-nsql · https://ollama.com/library/qwen3-coder · https://bestllmfor.com/best/coding-sql-generation/
- Agent Skills: https://agentskills.io/specification · https://agentskills.io/home · https://github.com/agentskills/agentskills
- MCP Apps: https://github.com/modelcontextprotocol/ext-apps · spec https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx · https://apps.extensions.modelcontextprotocol.io/api/
- 版本/许可证/体积：npm registry（`npm view`）· https://data.jsdelivr.com/v1/package/npm/ · stars: https://repos.ecosyste.ms/

---

## 13. 附录：实测方法与原始数据（可复现）

- 环境：Linux, Node 22.22, Playwright 1.56.1, Chromium 141.0.7390.37 headless（`/opt/pw-browsers/chromium-1194`），页面均以 `file://` 打开；探针页与脚本放在会话 scratchpad（`…/scratchpad/q08/site/test*.html`, `scripts/run2.js`），不进仓库。
- 合成数据：`genRows(n)` 线性同余随机，字段 `id, region(5 值), sector(8 值), rev, ebitda, ev`；group-by 结果 40 组。
- 本地 Origin 探针：Node `http` 服务模仿 Ollama 允许列表；Chrome 发送 `OPTIONS` + `Origin: "null"`，在允许列表加入 `^null$` 前返回 403、之后 POST 200。
- 严格 CSP 探针：`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' file: blob:; worker-src blob:; connect-src data: http://127.0.0.1:11434">`。

| CSP 探针（无 `unsafe-eval`） | 结果 |
|---|---|
| Arquero `derive`/`groupby().rollup()`（字符串或函数表达式） | ❌ "Refused to evaluate a string as JavaScript" |
| AlaSQL `SELECT … GROUP BY` | ❌ |
| filtrex `compileExpression` | ❌ |
| math.js `evaluate` | ✅ |
| expr-eval-fork `Parser().evaluate` | ✅ |
| jsep parse | ✅ |
| RK.expr `evaluate('a * 2 + 10%')` → 6.1 | ✅ |
| sql.js `sql-asm.js` `SELECT 1+1` | ✅ |
| Formula.js IRR/XNPV/PMT | ✅ |
| JSONata `$sum(rows.rev)` | ✅ |
| ECharts 6.1.0（vendored, SVG, formatter 字符串, dataZoom, brush） | ✅ |
| Leaflet 1.9.4（vendored） | ✅ |
| `fetch('https://example.com/')` | ❌ blocked by `connect-src`（期望行为） |

| DuckDB-WASM 1.32.0 offline run | 值 |
|---|---|
| blob `import()` of patched mjs | 15–20 ms |
| base64 → bytes（仅诊断；生产用 data: URL 无需解码） | 247–294 ms（34,242,586 bytes） |
| `instantiate(data: URL)` | 2,199–4,040 ms |
| `version()` | v1.4.3 |
| Arrow insert / group-by / median — 100k | 140 / 68 / 36 ms |
| Arrow insert / group-by / median — 1M | 1,200 / 111 / 50 ms |
| `json_serialize_sql('DROP TABLE t')` | `{"error":true,…"Only SELECT statements can be serialized to json!"}` |
| `SET enable_external_access=false; SET lock_configuration=true` → `read_csv('https://…')` | Permission Error（期望） |
| `SELECT count(*)…` → `JSON.stringify` | TypeError: Do not know how to serialize a BigInt（需适配） |
