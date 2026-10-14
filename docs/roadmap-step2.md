# Step 2 路线图 · 数据 API · 客户技能 (Skills) · 本地 LLM

> 状态：提案（2026-10-14）。范围：在 Step 1 的离线、数据分离报告上增加三项能力：
> ① 数据从 API 实时获取；② 客户导入自己的 "skills"（指标、查询、图表预设和工具）；③ 接入银行内网或本机部署的 LLM，
> 支持自然语言提问、生成查询和生成图表。
> 依据：`research/raw/08-query-ai.md`（`file://` / CSP / 引擎 / LLM 服务实测）、`09-architecture.md`（打包、契约与版本）、
> `06-china-xhs.md`（AI 图表生态、AntV 供应链事件）、`07-collections.md`（Flint 等新项目）。
> 标记：✅ 已有 · 🟡 部分 · ⬜ 待做。

---

## 0. 结论 (TL;DR)

1. **一种契约，多种传输方式**：数据 API 返回和 `data/` 目录**完全相同的 JSON**，组件代码一行不改。API 模式已经可用 ✅。Step 2 补齐鉴权、ETag 缓存、版本协商、按需加载和大数据的 Arrow 通道。
2. **默认拓扑是本机 companion**：新增 `python -m reportkit serve` ⬜，在 `http://127.0.0.1:<port>` 同源提供报告，并且只把白名单路由
   `/llm/v1/chat/completions`、`/llm/v1/models` 反向代理到 Ollama / LM Studio / vLLM / llama.cpp。这样同时解决 `Origin: null` 的 CORS 问题、
   Chrome LNA 授权弹窗和管理接口暴露问题（08 §0-11）。从 `file://` 直连本地模型只作为高级选项。
3. **LLM 只输出结构化意图 (intent)，不输出代码**。可执行的目标只有四种，都是 kit 已有的安全语言或契约：`RK.query` 语句（RKQL）、
   `RK.expr` 公式、筛选变更、block JSON spec。不让 LLM 写 SQL、JS 或 ECharts option。原则是"AI 只做填空题"（06 §8）。
4. **Skill = `SKILL.md`（给 LLM）+ `rk-skill.json`（给运行时）+ 可选沙箱代码**。运行时导入的 skill 只应用经过校验的**声明式**部分。
   代码只能在 `sandbox="allow-scripts"` 的 `srcdoc` iframe 里运行，通过 JSON-RPC 通信。这一点已在 `file://` 下实测可用（08 §2）。
5. **防数据外泄的第一道防线是严格 CSP**：`connect-src` 只放行 LLM 和数据 API 的地址。实测在 `file://` 下能拦截外网 fetch，
   而且 vendored 的 ECharts 6.1.0 和 Leaflet 1.9.4 在没有 `unsafe-eval` 的情况下都能正常渲染（08 §0-13）。
6. **互操作**：我们的 block spec 是中枢 (hub)。Vega-Lite 和 Flint 作为导入 / 导出格式和通道词汇的参考；VMind 已停止维护；GPT-Vis
   只借鉴其流式容错 DSL 的思路，不引入依赖（AntV npm 命名空间在 2026-05-19 被投毒，06 §2）。

---

## 1. 基线：Step 1 已有的能力

| 能力 | 位置 | 状态 |
|---|---|---|
| 报告文件夹三层分离（HTML / CSS·JS / DATA），数据每个 dataset 一个 JSON | `docs/architecture.md` §3 | ✅ |
| 数据适配器：`bundle`（file://）、`http`、`api`、自定义 `RK.data.adapter(name, fn)` | `kit/core/rk.data.js` | ✅ |
| Builder：`build(report, out, data_source='api', api='https://…/')` 写入 `rk:data-source` / `rk:api` meta | `py/reportkit/build.py` | ✅ |
| 鉴权钩子：`data-rk-autoboot="false"` + `RK.boot({token})` → `Authorization: Bearer` | `docs/pipeline-guide.md` §9 | ✅ |
| 安全公式语言 `RK.expr`（Pratt parser → closures，没有 `eval` / `new Function`，`check()` 返回错误位置） | `kit/core/rk.expr.js` | ✅ |
| 查询语言 `RK.query`（RKQL）+ 解析结果 `RK.query.parse(text)` → `{from, select[{expr,as,format}], by, where, sort, limit}` | `kit/core/rk.data.js`，`docs/formula-language.md` §10 | ✅ |
| 交叉筛选 `RK.store`：组件不会被自己发出的筛选影响（crossfilter 语义） | `rk.data.js` | ✅ |
| 客户自助：`query-console`（Builder + RKQL 编辑器 + "Add as metric" 写回 `computed[]`） | `kit/components/query-console` | ✅ |
| 53 个组件的 manifest（channels / options / best_for / avoid_when / samples）→ `kit/catalog.json` | `tools/build_catalog.py` | ✅ |
| JSON layout spec（`reportkit` / `report` / `datasets` / `pages[].blocks[]`）与 `reportkit validate` | `py/README.md` | ✅ |
| 函数注册表 `RK.expr.register`、严格 CSP、`RK.skills`、`RK.ai`、companion server | — | ⬜ |

---

## 2. 数据 API 模式

### 2.1 REST 形状（向后兼容现有 adapter）

| 方法 / 路径 | 返回 | 说明 |
|---|---|---|
| `GET {base}manifest` | 与 `data/manifest.json` 相同 | ✅ 现有 adapter 已经在调用。建议增加 `revision`、`generator`、`datasets[id].{hash, version, asOf, rows, eager}`（09 §5） |
| `GET {base}datasets/{id}` | 与 `data/datasets/<id>.json` 相同（`rk.dataset@1`） | ✅ 现有。`ETag` = dataset `hash`；支持 `If-None-Match` → 304 |
| `GET {base}datasets/{id}` + `Accept: application/vnd.apache.arrow.stream` | Arrow IPC | ⬜ 用于大表（> ~20 MB / 300k 行）。前端用 Flechette 2.7 解码（UMD，16 KB gz，08 §5.6） |
| `POST {base}query` body = RKQL 解析结果（JSON） | `{columns, rows}`，与 `RK.query()` 的返回形状相同 | ⬜ 可选的下推 (pushdown) 查询：服务端把解析结果编译成 SQL（DuckDB），用于百万行以上的数据（08 §5.7） |
| `GET {base}revisions` / `?revision=3` | 发布历史 / 指定版本 | ⬜ 对应 pitchbook "v3" 重发惯例 |
| 错误 | `application/problem+json`：`{type, title, status, detail}` | ⬜ 前端在 block 内显示可读错误，不显示白屏 |

设计规则：
- **相同的字节，不同的传输方式**：服务端返回的 JSON 和 builder 写入 `data/` 的是同一份序列化结果（09 §3）。API 模式和离线模式可以逐字节比对。
- **按需加载**：manifest 里标 `eager: true` 的 dataset 在首屏加载，其余在页面首次显示时再拉取（09 §3）。现有 `api` adapter 一次拉全部，需要改 ⬜。
- **实时刷新**：再次 `register` 一个带新 `version` 的 dataset，会触发受影响组件重绘（`affected(ds, changes)` 已有）。轮询用 ETag，
  需要推送时用 SSE ⬜。页面要显示 "Data as of …" 的变化提示，避免读者以为数字是静态的。

### 2.2 鉴权

| 场景 | 推荐 | 不要做 |
|---|---|---|
| 报告和 API 同源（内网门户、companion） | 用会话 cookie（`HttpOnly; Secure; SameSite=Strict`），由反向代理接 SSO | — |
| 跨源（报告和 API 不在同一域名） | OIDC 短期 access token 作为 `RK.boot({token})` 的参数传入；API 的 CORS 只允许列出的 origin | 允许 `Origin: null`（等于允许任何网站，08 §8.2） |
| `file://` 双击打开 | 只读离线 bundle；需要实时数据时改为打开 companion 或内网 URL | 把长期 token 写进报告文件或 `localStorage`：Chrome 中所有 `file://` 页面共用同一个存储桶（09 §1） |

- 每个 dataset 可以带 `meta.confidentiality`。服务端按用户权限裁剪行或字段，**返回的形状保持不变**（缺失字段为 `null`，显示 `n.a.`）。
- CSP 的 `connect-src` 只写 API 的 origin。

### 2.3 缓存与版本

- **HTTP 缓存**：`Cache-Control: private, no-cache` + ETag（每次都重新验证，数据未变时返回 304）。客户数据**默认不落地**：
  `localStorage` 和 IndexedDB 只存 UI 状态，key 带前缀 `rk:<report.id>:<revision>:`（09 §9）。
- **契约版本**：dataset 带 `contract: "rk.dataset@1"`，只升 major，允许增加字段。spec 带 `$schema` + `specVersion`。
  运行时接受当前 major 和 N-1（在内存中 migrate），遇到更新的 major 时显示 "This report requires ReportKit ≥ 2.0"（09 §7）。
- **API 路径版本**：`/api/v1/reports/{id}/…`。`v1` 对应 `rk.dataset@1`，契约升 major 时才换路径。
- **完整性**：manifest 里的 `hash` 和 dataset 的 `hash` 必须一致才接受（只做相等比较）。需要重算时可以用 `crypto.subtle`，它在 `file://` 下可用（09 §5）。

---

## 3. 客户 "Skills" 导入

### 3.1 包格式

```text
comps-valuation/                # = skill name（小写连字符，Agent Skills 规范）
├── SKILL.md                    # 给 LLM：何时使用、步骤、示例（YAML frontmatter: name, description）
├── rk-skill.json               # 给运行时：机器可读的贡献清单（JSON Schema 校验）
├── skill.js                    # 可选：classic-script 包装，file:// 下用 <script> 加载 → RK.skills.register(...)
├── sandbox.js                  # 可选：代码型工具，只在沙箱 iframe 里运行
└── references/ assets/         # 指标口径说明、图表 / 查询预设
```

`SKILL.md` 遵循开放的 **Agent Skills** 规范（https://agentskills.io/specification ），采用渐进披露：启动时只加载 name + description
（约 100 tokens），激活后才读正文。这样同一个 skill 也能被外部 agent 复用（08 §9.1）。

```json
{
  "name": "comps-valuation", "version": "1.2.0", "rkApi": "^1",
  "contributes": {
    "functions": [{"name": "ev_to", "params": ["metric"], "formula": "ev / {metric}", "doc": "EV multiple of a metric"}],
    "metrics":   [{"dataset": "comps", "name": "ev_ebitda_26e", "formula": "ev / ebitda_26e", "format": "0.0x", "title": "EV / EBITDA 2026E"}],
    "queries":   [{"id": "median-by-sector", "title": "Median multiple by sector", "rkql": "median(ev_ebitda_25e) by sector sort 2 desc"}],
    "charts":    [{"id": "multiple-ranking", "block": {"component": "bar", "data": "comps",
                   "encode": {"x": "company", "y": "ev_ebitda_25e"}, "options": {"orientation": "horizontal", "sort": "desc"}}}],
    "prompts":   [{"id": "explain-outliers", "template": "Explain why {company} trades at {value} vs the peer median."}],
    "tools":     [{"name": "peer_screen", "description": "Screen peers by growth and margin",
                   "parameters": {"type": "object", "properties": {"minGrowth": {"type": "number"}}}, "impl": "sandbox:peerScreen"}]
  },
  "permissions": {"datasets": ["comps"], "fields": "*", "network": false, "storage": "none", "ui": ["panel"], "llm": false},
  "sandbox": {"entry": "sandbox.js"},
  "integrity": {"sha256": {"rk-skill.json": "…", "sandbox.js": "…"}}
}
```

### 3.2 贡献如何注册

| 贡献 | 落点 | 校验 | 前置条件 |
|---|---|---|---|
| `functions` | 由公式模板定义的函数，展开后交给 `RK.expr` | 展开后的公式必须通过 `RK.expr.check` | ⬜ `RK.expr.register(name, {fn\|formula, kind, arity, doc})`；同时更新 `RK.expr.functions`，用于自动补全和 LLM 提示（08 §4.3） |
| `metrics` | `Dataset.addComputed()`，与 "Add as metric" 同一路径 | `RK.expr.check` + 字段存在性检查 | ✅ |
| `queries` | `query-console` 的 Templates 菜单 | `RK.query.parse` | 🟡 控制台已有历史记录，模板入口待加 |
| `charts` | block JSON spec，在 "Insert / Explore" 面板中挂载 | §4.6 的 spec 校验器 | ⬜ |
| `prompts` / `SKILL.md` | `RK.skills.catalogForLLM()` / `activate(name)` | 长度上限；作为数据插入提示词，不当作指令执行 | ⬜ |
| `tools` | `RK.ai.tools()`；`impl` 只能是 `sandbox:*` | JSON Schema（参数） | ⬜ |
| 新组件（JS） | **只允许 builder 构建时打包**（经过代码审阅，可信），通过 `RK.component()` 注册 | 代码审阅 + `tools/check.sh` | ✅ 机制已有。运行时导入的 skill **不能**注册新组件 |

运行时 API（草图，08 §9.5）：`RK.skills.register(manifest, impl?)`（构建时）、`RK.skills.import(fileOrDirHandle)`（运行时：
校验 → 预览贡献的 diff → 用户确认）、`list()` / `enable()` / `disable()`、`catalogForLLM()`、`activate(name)`。
导入入口：拖拽 `.zip`、`<input webkitdirectory>`、`showDirectoryPicker()`，这些在 `file://` 下都可用（08 §2）。

### 3.3 信任级别与权限模型

| 来源 | 信任 | 允许 |
|---|---|---|
| Builder 构建时打包（分析师 / IT 审阅过的 `skills/*.js`） | 可信 | 全部贡献，包括原生 JS 函数和新组件 |
| 运行时由用户导入 | 不可信 | 只允许声明式贡献。`tools` 只能在沙箱中运行 |
| Companion 模式下的 `scripts/*.py`（Agent Skills 中常见） | 需要逐次确认 | 由 companion 在本机执行，页面只拿到 JSON 结果。浏览器内不跑 Python（Pyodide 体积大，且是 MPL-2.0） |

权限是显式白名单，由 host 强制执行：
- `datasets` / `fields`：沙箱只能拿到声明过的数据集，以 structured clone 传入。host 可以先截断或聚合再交给沙箱。
- `network`：浏览器内**恒为 false**。iframe 内的 CSP 是 `default-src 'none'; script-src 'unsafe-inline'`。
- `storage`：`none` | `session`。不允许写持久存储。
- `ui`：`panel` | `toolbar`，只能在 host 提供的容器里渲染。
- `llm`：是否可以调用 `RK.ai`。调用要计入审计日志，并受同一套数据最小化规则约束。
- `params`：是否可以写 `@param` 和筛选。默认只读。

### 3.4 沙箱

- **首选**：`<iframe sandbox="allow-scripts" srcdoc="…">`，**不给** `allow-same-origin`。实测在 `file://` 下 iframe 的 origin 是 `null`，
  读不到 `parent.document`、cookie 和存储（08 §2）。
- **通信**：postMessage 上跑 JSON-RPC 2.0，方法集参照 MCP Apps（`ui/initialize`、`tools/call`、`notifications/*`；spec 2026-01-26，
  https://github.com/modelcontextprotocol/ext-apps ）。host 只响应 manifest `permissions` 允许的方法。
- **纯计算**可以放进 Blob Worker（`file://` 可用）。需要确定性和指令计数限制时，用 QuickJS-emscripten（MIT，可以设置 interrupt handler
  和内存上限）。**不用 SES / lockdown**：它会冻结全局 intrinsics，可能破坏 ECharts / Leaflet（08 §9.4）。

### 3.5 安全评审清单（每个 skill 都要过）

- [ ] `rk-skill.json` 通过 JSON Schema 校验，未知键给警告，类型错误直接拒绝；`rkApi` 版本兼容。
- [ ] 所有公式都过 `RK.expr.check`，所有 RKQL 都过 `RK.query.parse`，所有 chart 都过 block spec 校验器。拒绝 SQL 和任何形式的 JS 表达式。
- [ ] 文本（标题、说明、prompt）一律走 `textContent` 或安全的 Markdown 子集。kit 的 `h()` 支持 `html:` 属性，skill 内容**不能**走这条路径。
- [ ] manifest 和资源里不能有远程 URL，资源必须内联。AntV 的 `chart-visualization` skill 会把数据发到 AntV 云端渲染（07 §0-8），这种行为必须拒绝。
- [ ] 加命名空间：skill 贡献的名字带前缀（`comps-valuation.ev_to`），避免覆盖内置函数或数据集字段。
- [ ] 完整性：`integrity.sha256` 和实际内容一致。银行内部分发时可以加签名 ⬜。
- [ ] 供应链：skill 不能带 npm 依赖；kit 的 vendor 一律精确锁定版本，用 `npm pack --ignore-scripts` 获取，并记录 sha256（AntV 投毒事件教训，06 §2）。现状：精确版本 ✅；`tools/vendor.py` 用 `npm pack <pkg>@<ver>` 取 registry tarball、`tarfile` 解压，不跑安装脚本 ✅，但命令里没有显式加 `--ignore-scripts`；sha256 / `dist.integrity` 还没记录 ⬜。
- [ ] 资源上限：单个 skill ≤ 1 MB，沙箱单次调用 ≤ 5 s，返回 ≤ 1 万行。
- [ ] 审计：导入、启用、禁用、每次 tool 调用都写入本地审计日志（IndexedDB，可导出）。

---

## 4. 本地 LLM 集成

### 4.1 拓扑（08 §8.1）

| 方案 | 描述 | `file://` 双击 | 结论 |
|---|---|---|---|
| **B. Python companion** | `python -m reportkit serve ./report --llm http://127.0.0.1:11434` → `http://127.0.0.1:8765/`，同源反代 `/llm/v1/*` | 用户改为打开 127.0.0.1 | **默认**。同源，没有 CORS 和 LNA 问题；只暴露白名单路由；有 token、审计和限流；还能顺带解锁 fetch、ESM、Worker 和 WebLLM 缓存 |
| A. 直连本地 OpenAI 兼容服务 | 页面直接 `fetch('http://127.0.0.1:11434/v1/chat/completions')` | ⚠️ 取决于服务端 CORS 和 Chrome LNA | 高级用户选项，UI 里提示需要哪些配置 |
| E. 内网 LLM 网关 | `https://llm.bank.internal/v1`（vLLM / LiteLLM） | ⚠️ 网关的 CORS 必须允许报告所在的 origin | 银行集中治理时首选，报告从内网门户打开 |
| C. 浏览器内模型 | WebLLM 0.2.86 / transformers.js 4.3.1 / wllama 3.8.1 | ⚠️ 模型权重必须通过 http(s) 获取 | 只用于小任务，见 §4.4 |
| D. 浏览器内置 AI | Chrome Prompt API（Gemini Nano） | ? | 只做渐进增强。2026 年网页端是否进入 stable，资料说法不一，而且不是银行指定的模型 |

### 4.2 `file://` 的事实（实测，08 §2 / §8.2–8.3）

- 页面 origin 是字符串 `"null"`。每个请求都会带 `Origin: null`，并先发 CORS 预检。
- **Ollama**：默认允许列表里有 `file://*`，但它**匹配不到** Chrome 发出的 `null`。设置 `OLLAMA_ORIGINS=null` 会导致启动时 panic；
  只有 `*` 或 `null*` 能生效（结论来自阅读源码：https://github.com/ollama/ollama/blob/main/envconfig/config.go ，未在真实进程上验证）。
- **vLLM**：新版本 `--allowed-origins` 默认为 `[]`，需要设置 `'["null"]'` 并配合 `--api-key`（https://docs.vllm.ai/en/latest/cli/serve/ ）。
  **llama.cpp** 默认回显任意 Origin 并允许 credentials（https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md ）。
  **LM Studio** 需要打开 "Enable CORS"（https://lmstudio.ai/docs/developer/core/server/settings ）。
- **安全警告**：允许 `null` 基本等于允许任何网站。任何公网页面都可以用 sandboxed iframe 伪造 `null` origin，调用本机模型 API，
  其中包括 Ollama 的 `/api/pull` 和 `/api/delete`。
- **Chrome LNA（142+）**：公网页面访问 loopback 需要用户授权，`file://` 发起方的行为在规范中定义得比较模糊
  （https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY ）。企业可以用组策略 `LocalNetworkAccessAllowedForUrls` 放行。
  **必须在银行的目标 Chrome / Edge 版本上实测。**

### 4.3 Provider 抽象

```js
RK.ai.configure({
  provider: 'openai-compatible',      // | 'webllm' | 'chrome-prompt'
  baseURL: '/llm/v1',                 // companion; or 'http://127.0.0.1:11434/v1' (mode A)
  model: 'qwen3:14b',                 // chosen by IT, listed via GET /v1/models
  temperature: 0, timeoutMs: 60000
});
```

不引入 `openai` SDK，自己用约 80 行 fetch + SSE 解析实现。四种本地服务都兼容 OpenAI 的 `/v1/chat/completions`。Ollama 支持
`tools`，`response_format` 也支持 JSON Schema 约束输出（https://ollama.com/blog/structured-outputs ）。

### 4.4 浏览器内推理（选项 C）

- **WebLLM 0.2.86**（Apache-2.0）：只发布 ESM（6.8 MB），基于 WebGPU，支持 JSON schema 约束生成。权重必须从 http(s) 拉取，
  因此只能在 companion 或内网模式下使用（https://github.com/mlc-ai/web-llm ）。
- **transformers.js 4.3.1**：适合跑**嵌入模型**，例如对字段和指标做语义搜索。all-MiniLM 量化版约 20–25 MB，可以用 `data:` URL 内嵌。
- **wllama 3.8.1**：用户可以通过 `<input type=file>` 选择本机的 `.gguf`，`file://` 下可用。但只能单线程运行（没有 SharedArrayBuffer），
  1–3B 模型尚可，7B 不现实。

### 4.5 Text-to-query：目标是 RKQL，不是 SQL 或 JS

为什么选 RKQL：
- **安全**：没有 `eval`，没有属性访问，只能读字段、`@param` 和内置函数。严格 CSP 下也能运行。
- **可读**：银行家能读懂，也能直接改，例如 `median(ev_ebitda_25e) by sector where region == "Asia" sort 2 desc top 5`。
- **便于修复**：`RK.expr.check` 返回 `{error, pos}`，还会给出 "did you mean" 建议，可以直接回传给模型重试。
- **语义一致**：自动遵守全局筛选，n.a. / n.m. 的口径和报告其他部分一致。
- **性能足够**：100k 行 45 ms，1M 行约 0.7 s（08 §5.1）。
- 只有启用 DuckDB power-pack 时才允许 `kind: "sql"`，并且必须过 `json_serialize_sql()` 只读守卫，再执行
  `SET enable_external_access=false; SET lock_configuration=true`（08 §5.5）。**AlaSQL 禁用**：它的双反引号语法可以执行任意 JS（08 §5.3）。

意图 schema（`response_format: {type: 'json_schema'}`）：

```json
{"oneOf": [
  {"properties": {"kind": {"const": "query"},  "rkql": {"type": "string"}, "explain": {"type": "string"}}},
  {"properties": {"kind": {"const": "metric"}, "name": {"type": "string"}, "formula": {"type": "string"}, "format": {"type": "string"}}},
  {"properties": {"kind": {"const": "filter"}, "field": {"type": "string"}, "op": {"enum": ["in","not_in","between","eq","search","expr"]}, "values": {}}},
  {"properties": {"kind": {"const": "chart"},  "block": {"$ref": "#/$defs/rkBlock"}}},
  {"properties": {"kind": {"const": "answer"}, "text": {"type": "string"}, "cites": {"type": "array"}}}
]}
```

执行管线：LLM → `JSON.parse` → schema 校验 → `RK.query.parse` / `RK.expr.check` → 在本地执行 → 把结果和**可编辑的查询文本**
一起展示给用户 → 出错时把错误位置回传给模型，最多重试 2 次 → 仍然失败就打开 Builder，并预填已经识别出的字段。

提示词上下文由以下部分组成（数据最小化）：
- 字段字典：name / title / unit / format / role / aggregate，以及 RKQL 语法摘要和函数表（`RK.expr.functions`）。
- few-shot 示例：取自 `docs/formula-language.md` §11 的 17 个**已由脚本执行验证**的例子。
- 少量聚合样本。**默认不发送明细行**。

Tool-calling 循环（模型支持 tools 时）：`list_datasets`、`describe_dataset`、`run_query`（返回 ≤ 50 行聚合结果）、`define_metric`、
`set_filter`、`make_chart`。最多 6 轮，每次调用都在 UI 中可见。

### 4.6 Text-to-chart：目标是我们自己的 block JSON spec

LLM 只填写和 JSON layout spec 里 `blocks[]` 相同的结构：

```json
{"component": "scatter", "data": "comps", "title": "Growth vs multiple", "subtitle": "NTM, x",
 "encode": {"x": "rev_growth_25e", "y": "ev_ebitda_25e", "label": "company", "target": "is_target"},
 "options": {"regression": true}}
```

- **可选组件和通道表**：直接来自 `kit/catalog.json`（53 个组件的 `channels`、`options`、`best_for`、`avoid_when`、`category`）。
  它本身就是给 LLM 用的工具清单（07 R1）。
- **校验器** ⬜：组件必须存在；必填通道都要给；字段必须在 dataset 里存在且类型匹配；`options` 的键必须在 manifest 里声明过；
  未知键给警告。用一个小型手写 JS 校验器实现，不用 Ajv（Ajv 依赖代码生成，和严格 CSP 冲突，09 §2.7）。Python 端已有的
  `reportkit validate` 规则与它共用一套 schema。
- **样式全部由确定性编译负责**（主题 token、格式码、动效）。LLM 不能设置颜色、字体或 ECharts option。
- **伪流式渲染**：先缓冲完整的 JSON，在屏幕外渲染好图表，再在文字流到对应锚点时显示，避免闪烁和解析半截 JSON
  （https://juejin.cn/post/7603581886148935734 ）。
- 生成的 block 可以"钉到页面上"，也可以导出成 JSON layout spec 片段交回分析师的 pipeline，形成从客户问题到分析师成稿的闭环。

### 4.7 Guardrails

1. **CSP**：builder 生成严格 CSP ⬜：`default-src 'none'; script-src 'self' file: 'unsafe-inline' blob:; connect-src data: <llm> <api>; …`。
   启用 DuckDB 时再加 `'wasm-unsafe-eval'`。实测这样会拦截外网 fetch，"模型被提示注入后把数据发到外网" 在浏览器层面就做不到（08 §8.4）。
   同时给 `tests/` 加一个 CSP 冒烟测试。
2. **输出永远不可信**：只接受 schema 内的意图。文本用 `textContent` 或安全 Markdown 渲染，**不进 `innerHTML`，也不进 ECharts HTML formatter**。
3. **数字必须可追溯**：`answer` 里的数字必须来自本轮 `run_query` 的结果（`cites` 指向查询结果）。没有引用的数字在 UI 上标注为 "unverified"。
4. **数据最小化和透明**：UI 提供 "将发送的内容" 预览。默认只发 schema 和聚合结果，发送明细需要用户逐次勾选。
5. **提示注入**：dataset 里的字符串和 skill 的文本作为带定界符的**数据**放进提示词，system prompt 明确说明它们不是指令。不允许任何工具有写外部系统的能力。
6. **审计**：每次请求、响应、工具调用和执行结果都写入本地 IndexedDB 日志，可导出给合规部门。companion 端也写一份服务端日志。
7. **确定性**：`temperature: 0`；模型白名单由 IT 配置；UI 显示所用的模型名和版本。

### 4.8 离线 / 物理隔离（air-gapped）部署

- **交付物**：报告 zip（`file://` 只读模式可用）+ companion（`pip install reportkit` 的离线 wheel）+ 安装说明。
  模型权重由银行内部的制品库分发（Ollama 的 `OLLAMA_MODELS` 指向内部目录，或者 vLLM 挂载本地权重）。
- **启动**：`python -m reportkit serve ./report --llm http://gpu-node:8000/v1 --port 8765` ⬜。
  它只监听 127.0.0.1，使用随机 token，路由白名单是 `/`、`/llm/v1/chat/completions`、`/llm/v1/models` 和 `/api/*`（数据 API），
  并且永远不转发 `/api/pull`、`/api/delete`。
- **浏览器策略**：如果需要模式 A，通过 GPO 下发 `LocalNetworkAccessAllowedForUrls`。模式 B 是 loopback 到 loopback，不会触发 LNA。
- **模型选型**（需要在银行自己的数据字典上评测）：通用指令模型（Qwen3 8B–32B 级）配合 JSON schema 约束解码，通常足以生成 RKQL。
  只有 SQL power-pack 才考虑 Arctic-Text2SQL-R1 或 DuckDB-NSQL-7B（08 §8.6）。对 RKQL 这类专有方言，few-shot 示例比专门的 SQL 模型更重要。
- **评测集**：formula-language 的 17 个已验证例子，加上 50–100 条银行提供的 "问题 → 期望 RKQL 和结果" 金标对。
  指标是执行准确率 (execution accuracy)、首次通过率和平均重试次数。

---

## 5. 互操作：Vega-Lite / Flint / VMind / GPT-Vis

| 项目 | 版本 · 许可 | 形态 | 我们怎么用 | 结论 |
|---|---|---|---|---|
| **Vega-Lite** | 6.5.0 · BSD-3（vega 6.4.0、vega-embed 7.3.0，有 UMD，175 + 79 + 20 KB gz） | 声明式 grammar：`mark` + `encoding` + `datasets` + `params` | ① **通道词汇**：我们 `encode` 的通道名尽量和它对齐（x / y / color / size / shape / label / tooltip），它在模型训练语料里很常见（09 §10）；② **导入器** ⬜：把 VL 子集（bar / line / point / rect / arc + field encoding）转成 block spec；③ 可选的懒加载 `vega-lite` 组件给高级用户。注意 `data.url` 在 `file://` 下会失败，只能用 `values`（04 §13-7） | consider |
| **Microsoft Flint** | `flint-chart` 0.5.1 · MIT · 只发 ESM | 面向 AI 的图表 spec，可以编译成 Vega-Lite / ECharts / Chart.js / Plotly / **可编辑的 Excel 图表**；有 `flint-chart-mcp` | ① 借鉴它的通道表（含 `open/high/low/close`）和 70 多种语义类型（Rank、Price、Country…），用来丰富字段 `role`；② **导出到 Excel 原生图表**很有价值：构建时用 esbuild 打包成 IIFE，只在 builder 或 companion 侧使用（07 §7，https://github.com/microsoft/flint-chart ） | consider（Step 2 后期） |
| **VMind**（VisActor） | 2.0.10 · MIT | LLM → VChart spec | 仓库已改名为 `VisActor/skills`，README 写明 "The previous VMind SDK is no longer maintained"（06 §0-6）；而且它输出的是 VChart spec，不是我们的引擎 | avoid（只借鉴思路） |
| **GPT-Vis**（AntV） | 1.0.2 · MIT | 类 Markdown 的 ```` ```vis ```` DSL，可流式渲染、容错 | 借鉴"流式 + 容错 DSL"的思路；以后可以加一个 ```` ```vis ```` → block spec 的转换器 ⬜。**不引入依赖**：AntV 命名空间在 2026-05-19 被投毒（`@antv/gpt-vis` 1.1.0 / 1.2.0 是恶意版本，06 §2），而且风格不是投行风 | reference |
| AntV chart-visualization-skills | MIT | `SKILL.md` 目录 | 学习技能包的组织方式；其中的 `chart-visualization` 会调用云端渲染，**禁止用于客户数据** | reference |
| NL4DV / Data Formulator / LIDA | MIT | NL → 结构化 JSON / 交互式探索 / 生成并执行代码 | NL4DV 的意图 JSON 模式和我们的方案一致；Data Formulator 的分支式探索 UX 可以借鉴；LIDA "生成并执行代码" 的模式**不采用** | reference |
| MCP Apps | `@modelcontextprotocol/ext-apps` 2.0.3 | `ui://` 资源 + 沙箱 iframe + JSON-RPC | 我们的沙箱协议向它对齐，将来同一个 skill UI 可以同时运行在 Claude / ChatGPT 和报告里。npm 标注 MIT，README 徽章写 Apache-2.0，**引入代码前要先确认许可证** | reference → consider |

原则：**block spec 是中枢**。外部格式只通过导入器 / 导出器接入，不在运行时引入第二套渲染引擎。

---

## 6. 里程碑 · Milestones

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| **M0 基础**（1–2 周） | `RK.expr.register` 函数注册表 + Formula.js 4.6.1 金融函数包（IRR / XNPV / PMT，MIT，严格 CSP 下可用，08 §4.2）；把 RKQL 解析结果、block spec、intent 写成 JSON Schema（`schemas/*.json`，由 pydantic 生成）；builder 生成严格 CSP，并加 CSP 冒烟测试；manifest 和 dataset 增加 `$schema`、`contract`、`hash`、`revision` | `tools/check.sh` 全绿；每个组件在严格 CSP 下截图无报错 |
| **M1 数据 API**（2–3 周） | 参考服务端（`reportkit serve` 内置 `/api/v1/reports/{id}/…`）；ETag / 304；按需加载；鉴权（cookie / OIDC token）；problem+json 错误；Arrow 通道（可选）；"Data as of" 刷新提示 | API 模式和离线 bundle 渲染结果逐像素一致（smoke 截图对比）；断网和 401 时显示可读错误 |
| **M2 Skills v1**（3 周） | `rk-skill.json` schema；`RK.skills` 运行时；声明式导入（metrics / queries / charts / functions）；权限预览与确认；query-console Templates；构建时打包 skill | 3 个示例 skill（comps-valuation、precedents-premia、dcf-sensitivity）；恶意样例（远程 URL、JS 注入、越权数据集）全部被拒绝 |
| **M3 本地 LLM v1**（3–4 周） | companion 反向代理 + token + 审计；`RK.ai` provider；意图 query / metric / filter / answer；聊天面板；评测工具 | 在评测集上执行准确率 ≥ 85%（Qwen3 14B 级）；CSP 拦截外泄测试通过；所有数字都可追溯 |
| **M4 Text-to-chart + 沙箱**（3 周） | chart 意图 → block spec 校验器 → 钉到页面或导出 spec；iframe 沙箱 JSON-RPC；Vega-Lite 子集导入器 | 53 个组件的 sample 都能被 LLM 复现（catalog 驱动）；沙箱逃逸测试通过 |
| **M5 加固与试点**（2–3 周） | 物理隔离安装手册、GPO 模板；在银行数据字典上评测模型；安全评审签字；可选：transformers.js 语义搜索、DuckDB power-pack（46 MB，懒加载，08 §5.5）、Flint → Excel 导出 | 1–2 个真实项目试点；合规审阅通过 |

依赖顺序：M0 → M1 / M2 可以并行 → M3 → M4 → M5。

---

## 7. 风险与未决问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| Chrome LNA 对 `file://` 的行为没有明确规范 | 模式 A 可能被浏览器拦截 | 默认用模式 B；在目标浏览器版本上实测；准备 GPO 模板 |
| 模型对 RKQL 这种专有方言不熟 | 生成的查询准确率低 | 约束解码 + few-shot + 错误位置回传重试；失败时回退到 Builder |
| Chrome 中所有 `file://` 页面共享 IndexedDB / localStorage | 不同报告之间可能串数据 | 用命名空间区分；客户数据不落地；审计日志只记元数据 |
| DuckDB-WASM 体积 46 MB，npm `latest` 是 dev 构建 | 交付包过大；版本漂移 | 默认关闭；精确锁定 1.32.0；只在大数据附录中使用 |
| 第三方 AI / 图表包的供应链风险 | 恶意版本混入 | 只在构建时打包；`npm pack --ignore-scripts`；记录 integrity；不在运行时拉取任何依赖 |
| MCP ext-apps 许可证标注不一致 | 法律风险 | 引入代码前先确认；在此之前只对齐协议，不复制代码 |

---

## 来源 · Sources

- 详细笔记：`research/raw/08-query-ai.md`（§2 `file://` 能力矩阵、§5 引擎基准、§8 LLM 拓扑与 CORS、§9 skills）、
  `research/raw/09-architecture.md`（§5 加载协议、§7 版本、§10 Step 2 预留）、`research/raw/06-china-xhs.md`（§2 AntV 事件、§8 AI 图表）、
  `research/raw/07-collections.md`（§7 新项目）。
- Agent Skills https://agentskills.io/specification · MCP Apps https://github.com/modelcontextprotocol/ext-apps
- Ollama CORS 源码 https://github.com/ollama/ollama/blob/main/envconfig/config.go · OpenAI 兼容 https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx
- vLLM https://docs.vllm.ai/en/latest/cli/serve/ · llama.cpp server https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md ·
  LM Studio https://lmstudio.ai/docs/developer/core/server/settings
- Chrome LNA https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY · MDN https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access
- WebLLM https://github.com/mlc-ai/web-llm · transformers.js https://github.com/huggingface/transformers.js · wllama https://github.com/ngxson/wllama
- Vega-Lite https://vega.github.io/vega-lite/docs/data.html · Flint https://github.com/microsoft/flint-chart · VMind https://github.com/VisActor/VMind ·
  GPT-Vis https://github.com/antvis/GPT-Vis · NL4DV https://github.com/nl4dv/nl4dv · Data Formulator https://github.com/microsoft/data-formulator
- AntV 供应链事件 https://security.snyk.io/antv-supply-chain-compromise-may-2026 · https://www.stepsecurity.io/blog/shai-hulud-here-we-go-again-mass-npm-supply-chain-attack-hits-the-antv-ecosystem
- 实践经验（"AI 只做填空题"）https://juejin.cn/post/7603581886148935734
- DuckDB-WASM https://duckdb.org/docs/current/clients/wasm/overview.html · Formula.js https://github.com/formulajs/formulajs · Flechette https://github.com/uwdata/flechette
