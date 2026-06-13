# Pagelet / Review Assistant — Software Design Document (SDD)

> Implementation-level companion to `docs/review-assistant-product-design.md`.
>
> - **What lives here**：架构、模块、接口契约、文件 IO 形态、关键算法、测试与发布执行细节。
> - **What does NOT live here**：产品意图（→ product-design.md）、决策"为什么"（→ decisions.md）。
> - **Traceability**：每个章节脚注引用决策 ID（D001-D030）与 product-design.md 章节。

---

## 0 · Status

| 项 | 值 |
|----|----|
| Spec version | 0.1 |
| 实现状态 | **Current Pagelet implemented** — quiet review surfaces → preview → confirmed review-note write |
| 对应版本 | PA `2.2.0-beta.1`（沿用 D013 通道） |
| 决策依据 | `docs/review-assistant-decisions.md` D001-D031 |
| 产品意图 | `docs/review-assistant-product-design.md` |
| 阻塞项 | ~~OQ001 (Write Action Framework create-file path)~~ ✅ Resolved（详见 [[D031]] + §14.1）；~~OQ002 (F5 provider spike)~~ ✅ Resolved（2026-06-05 spike + live 测试制度化到 smoke checklist）；自动 related-note read / 自动 WebSearch 为后续范围 |
| 主作者 | PA core |
| 上次更新 | 2026-06-06 |

> **解阻塞标记（2026-06-03）**：D025 + D030 决定写路径走 **Write Action Framework create-file path**（基础设施层）。`docs/write-action-framework-sdd.md` 已落地、`src/ai-services/write-action-framework/**` 4 子模块 + PolicyEngine 参数化已实现、`pagelet.write_review_output` 作为首个真实 caller 跑通端到端测试。本 SDD §2.4 / §3 / §14 的契约面占位已去 stub 化，Pagelet beta 随 PA `2.2.0-beta.1` 发布（详见 [[D031]]）。
>
> **历史背景（保留可追溯）**：Pagelet 立项时 OQ001 被升级为 Pagelet beta Hard Blocker（Pagelet 唯一写动作"创建 review note"是框架的首个真实 caller，没有框架就没有 Pagelet beta）。

---

## 1 · Architecture Overview

### 1.1 一图概览

```
┌──────────────────────────────────────────────────────────────────┐
│                       PA Plugin (main.ts)                        │
│                                                                  │
│  ┌────────────┐    ┌────────────────────┐    ┌────────────────┐  │
│  │ Chat UI    │    │ Pagelet UI         │    │ Settings UI    │  │
│  │ (existing) │    │ (new)              │    │ (extended)     │  │
│  └─────┬──────┘    └─────────┬──────────┘    └────────────────┘  │
│        │                     │                                   │
│        ▼                     ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │            PaAgentRuntime  (existing, lightly extended)    │  │
│  │  - createChatModel(temperature, options)                   │  │
│  │  - sharedCapabilityRegistry                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│        │                     │                                   │
│        ▼                     ▼                                   │
│  ┌────────────────────────┐  ┌──────────────────────────────┐    │
│  │ ChatRunKindAdapter     │  │ PageletRunKindAdapter (NEW)  │    │
│  │ (= today's chat path)  │  │  - PageletAgentModel         │    │
│  │                        │  │  - PageletHostPolicy         │    │
│  │                        │  │  - PageletToolProvider       │    │
│  └─────────┬──────────────┘  └──────────────┬───────────────┘    │
│            │                                │                    │
│            └──────────────┬─────────────────┘                    │
│                           ▼                                      │
│         ┌────────────────────────────────────────┐               │
│         │ PaAgentLoop  (existing, runtime-       │               │
│         │ agnostic; runs both adapters)          │               │
│         └────────────────────────────────────────┘               │
│                           │                                      │
│                           ▼                                      │
│         ┌────────────────────────────────────────┐               │
│         │ PolicyEngine  (extended: read-only     │               │
│         │ assumption parameterized)              │               │
│         └────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

> 决策依据：D024（单 Runtime + 多 adapter）、D025（写路径走 Write Action Framework）、D030（框架先行 + 二层命名对齐）。

### 1.2 单 Runtime 原则

PA 始终只有 **一个** `PaAgentRuntime`（详见 `src/ai-services/pa-agent-runtime.ts`）。Chat 与 Pagelet 是 runtime 上跑的不同 workload（kind），通过"RunKindAdapter"模式区分：

| 共享 | 适配差异 |
|------|----------|
| `PaAgentRuntime` 实例与 `createChatModel` | `PaAgentModel.stream()`：Pagelet 改用 structured-output prompt 形态 |
| `CapabilityRegistry`（capability 仓库） | `PaAgentToolExecutor.execute()`：Pagelet 走 review 专用 tool 子集 |
| `PaAgentLoop` 逐 turn 循环逻辑 | `PaAgentHostPolicy.afterTurn()`：Pagelet 单轮即止（max 1 turn） |
| `PolicyEngine`（参数化后） | `hostContext`：Pagelet 注入 source note、detected language、cost budget |

> 决策依据：D024。
> 代码位置：`src/ai-services/pa-agent-loop.ts:43,72,111`（3 个 DI 接口）。

### 1.3 新增/改造文件清单（当前实测落地）

> **路径修订（2026-06-04）**：§1.3 原设想所有 Pagelet 模块挂在 `src/ai-services/` 与 `src/components/pagelet/` 下。实际实现为了与 PA 既有目录边界对齐（`ai-services` 留给 chat/runtime/policy 共享层），把 Pagelet 拆到了独立的 `src/pagelet/` + `src/ui/pagelet/` + `src/settings/pagelet/` + `src/locales/pagelet/`。本表已替换为实测路径，原计划 1:1 对应关系记录在每行末尾以备追溯。

#### Pagelet runtime（`src/pagelet/`）

| 文件 | 状态 | 责任 | 原计划占位 |
|------|------|------|-----------|
| `src/pagelet/pa-review-runtime.ts` | NEW | Write Action Framework 装配、settings 读取、自写入 guard；当前 MVP 由 plugin 触发当前笔记 review | ↔ 计划同名 |
| `src/pagelet/pa-review-model.ts` | NEW | `PaAgentModel` 实现：单 turn structured output + 降级 parser | ↔ 计划同名 |
| `src/pagelet/pa-review-tool-provider.ts` | NEW | `CapabilityProvider`：当前实现 `pagelet.write_review_output`；`read_source_note` / `search_related_notes` 为后续 workbench/agent 模式范围 | ↔ 计划同名 |
| `src/pagelet/pa-review-schemas.ts` | NEW | zod schemas + EN/ZH few-shot 样本 + few-shot 注入策略 | ↔ 计划同名 |
| `src/pagelet/pa-review-cost.ts` | NEW | provider/model 定价表 + `computeCost` | (未在计划单列；§7.4) |
| `src/pagelet/pa-review-rate-limit.ts` | NEW | 滑窗 cost gate（10/h、100/d）+ 强制跳过 | (未在计划单列；§7.2) |
| `src/pagelet/pa-review-file-io.ts` | NEW | `.pagelet/` 目录与 `vault.adapter.write` 持久化 + frontmatter | (未在计划单列；§5) |
| `src/pagelet/scope.ts` | NEW | Panel scope selection：current/yesterday/last3/last7、included/skipped rows、multi-note segment/source-id map | (当前 workbench follow-up) |
| `src/pagelet/compat/{view-type,debounce,focus-command}.ts` | NEW | R1/R2 兼容隔离 + D007 focus 命令；Pagelet ribbon compat 已移除，`ribbonPosition` 仅作旧 data.json 兼容字段 | ↔ 原 plugin.ts/main.ts diff 拆分 |
| `src/pagelet/view.ts` | REMOVED | 历史 workbench ItemView；当前 Pagelet 使用 Pet / Bubble / Panel / Tab progressive disclosure surface |
| `src/pagelet/index.ts` | NEW | barrel | — |

> 当前没有单独的 `pa-review-host-policy.ts`：basic/deeper 单 turn 流程目前在 `pa-review-runtime.ts` 内联完成，未拆出独立 HostPolicy 类。Deeper 多 turn 真正需要时再抽。

#### UI / 设置 / i18n / 样式

| 文件 | 状态 | 责任 |
|------|------|------|
| `src/ui/pagelet/mascot/{markup,dom-renderer,types,index}.ts` | NEW | 4-state mascot（idle / thinking / done / error）+ SVG inline + reduce-motion 隔离 |
| `src/ui/pagelet/suggestion-card/{markup,dom-renderer,types,index}.ts` | NEW | 5-section card：source / kind / rationale / proposed / related |
| `src/settings/pagelet/index.ts` | NEW | Pagelet 设置项 + `normalizeReviewsFolder`（10 类越界形状 fail-closed，§14.1 H-B3.2 第一道防线） |
| `src/locales/pagelet/{en,zh}.json` + `index.ts` | NEW | EN/ZH 文案条目 |
| `src/locales/pagelet/language-detect.ts` | NEW | 笔记语言检测 regex `/[一-鿿]/g` > 30%（§8.1） |
| `src/custom.pcss` | MODIFIED | `.pa-pagelet-*` 样式、手绘风 token、`prefers-reduced-motion` 媒体查询（合并入主 PCSS，未单建 `pagelet.pcss`） |

#### 共享层修改

| 文件 | 状态 | 责任 |
|------|------|------|
| `src/ai-services/policy-engine.ts` | MODIFIED | 参数化 `runKind` + `allowWrite`（§3） |
| `src/ai-services/write-action-framework/**` | NEW | 4 gate（target-confinement / preview-confirmation / stale-reread / runtime-integration）+ debug-observer + types。Pagelet 的 `pagelet.write_review_output` 是首个真实 caller |
| `src/plugin.ts` | MODIFIED | 注册 commands / Pagelet runtime wiring；Pagelet 不再注册 ribbon |

> 测试文件清单见 §12.1（实际名称已与本节对齐）。

---

## 2 · Runtime: PageletRunKindAdapter

### 2.1 入口流程

```
[user 触发 "Pagelet: Open Pagelet"]
  → 打开/更新 Pagelet panel（只计算本地文件 metadata scope，不读正文，不调用 AI）
  → 用户选择 Current / Yesterday / Last 3 days / Last 7 days，手动 include/exclude
  → 点击 panel review
  → 1. 读取选中 Markdown 笔记正文（`.pagelet/` review 输出 locked skipped）
  → 2. 构造 multi-note segment bundle，source_id 映射到 note path，并截断到 settings.maxInputTokens（D018）
  → 3. cost-gate：检查小时/天计数（D020）
  → 4. 检测语言（D015 + D017）
  → 5. 实例化 PageletReviewModel / PaReviewRuntime / PageletToolProvider
  → 6. 单 turn structured review（withStructuredOutput → JSON fallback）
  → 7. panel 渲染 SuggestionCard，更新 session cost total + editable draft list（D022）
  → 8. Write Action Framework preview/confirm
  → 9. 持久化到 .pagelet/{原笔记名}-pagelet-review-{YYYY-MM-DD}.md（D008-D009）

[user 触发 "Pagelet: Review current note"]
  → 使用严格 active MarkdownView 作为 Current scope，进入同一 review/write 流程
```

### 2.2 `PageletAgentModel.stream()`（D026 落地）

实现 `PaAgentModel` 接口（`src/ai-services/pa-agent-loop.ts:43`）：

```ts
class PageletAgentModel implements PaAgentModel {
  constructor(
    private readonly aiUtils: AIUtils,           // 复用 PaAgentRuntime.createChatModel
    private readonly schema: ZodSchema,           // pa-review-schemas.ts 导出
    private readonly detectedLang: "zh" | "en",   // D015
    private readonly mode: "basic" | "deeper",
  ) {}

  async *stream(input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk> {
    const llm = await this.aiUtils.createChatModel(0.2, { /* provider 从 settings */ });
    // 优先 LangChain withStructuredOutput；失败则降级到 JSON parse
    const structured = llm.withStructuredOutput?.(this.schema, { method: "json_schema" });
    if (structured) {
      const result = await structured.invoke(this.buildMessages(input));
      // 将 structured result 转成 PaAgentModelStreamChunk 流
      yield { type: "text_delta", text: JSON.stringify(result) };
      return;
    }
    // 降级路径：手写 prompt + json parse
    const text = await llm.invoke(this.buildFallbackMessages(input));
    yield { type: "text_delta", text };
  }
}
```

**Schema 注入策略**（D026.f = A+B 混合）：
- **A**：JSON schema 嵌入 system prompt（`"Output strictly conforms to: <schema>"`）
- **B**：1 个 few-shot 示例放 user message（不放 system，避免污染 system token）
- **source-id 强约束**：schema 中 `source_id` 字段标注 `description: "must equal one of provided segment ids; otherwise reject"`

### 2.3 `PageletHostPolicy.afterTurn()`

实现 `PaAgentHostPolicy` 接口（`src/ai-services/pa-agent-loop.ts:111`）：

```ts
class PageletHostPolicy implements PaAgentHostPolicy {
  constructor(private readonly mode: "basic" | "deeper") {}

  afterTurn(summary: PaAgentTurnSummary): PaAgentAfterTurnDecision {
    if (this.mode === "basic") {
      return { action: "stop", status: "success", reason: "basic_review_complete" };
    }
    // deeper：允许最多 5 个 turn（D019）；若上一 turn 已出 final_answer 则停
    if (summary.committedFinalText.length > 0 && summary.turnIndex >= 3) {
      return { action: "stop", status: "success", reason: "deeper_review_complete" };
    }
    return { action: "continue", reason: "needs_follow_up" };
  }
}
```

### 2.4 `PageletToolProvider`

实现 `CapabilityProvider`（`src/ai-services/capability-types.ts:153`）：

| Capability | kind | permission | 责任 |
|-----------|------|------------|------|
| `pagelet.read_source_note` | tool | read-only | **Planned**：给 LLM 提供切分后的笔记片段（带 source_id）；当前 MVP 在 plugin 触发器内直接构造 segments |
| `pagelet.search_related_notes` | tool | read-only | **Planned**：复用 PA 的 VSS（D006-D = vault-aware）；当前 MVP 不读 related notes |
| `pagelet.write_review_output` | action | write | 走 **Write Action Framework create-file path**；preview 后写入冻结的 `.pagelet/...md` 目标 |

> Pagelet 的 `pagelet.write_review_output` 是 Write Action Framework 的**首个真实 caller**——意味着 framework 的 API 设计必须以本 capability 为最小验收用例，但 capability 本身不允许 Pagelet-specific 假设漏到 framework 内部。

---

## 3 · PolicyEngine Changes

当前 `src/ai-services/policy-engine.ts` 硬编码"只接受 read-only / network-read"。Pagelet 写 capability 需要参数化。

### 3.1 改造点

```diff
 export interface PolicyEngineOptions {
     platform?: AgentRuntimePlatform;
+    runKind?: "chat" | "review";  // 默认 "chat"
+    allowWrite?: boolean;          // review 时为 true；写动作仍需 Write Action Framework 包装
 }
```

```diff
 private evaluate(capability: AgentCapability): CapabilityPolicyDecision {
-    if (capability.kind === "action") {
-        return { allowed: false, reason: "action capabilities are reserved for future action mode" };
-    }
+    if (capability.kind === "action" && !this.allowWrite) {
+        return { allowed: false, reason: "action capabilities require allowWrite=true" };
+    }
+    if (capability.kind === "action" && this.allowWrite) {
+        // 必须经 Write Action Framework 包装（[[OQ001]]），此处仅放行 capability 注册
+        return { allowed: true };
+    }
     ...
 }
```

### 3.2 兼容性约束

- Chat 路径仍走默认 options（`runKind: "chat"`, `allowWrite: false`），行为不变。
- 现有所有单测期望 `action capabilities are reserved...` 提示语，需要同步更新或保留 chat 模式下原提示。

---

## 4 · Structured Output 实现（D026）

### 4.1 zod schemas（`pa-review-schemas.ts`）

```ts
import { z } from "zod";

export const PageletSuggestionSchema = z.object({
  source_id: z.string().min(1),          // 必须命中 read_source_note 返回的 segment id
  kind: z.enum(["clarify", "expand", "link", "trim", "evidence"]),
  rationale: z.string().min(8).max(280), // 简短理由
  proposed_action: z.string().min(8).max(500),
  related_notes: z.array(z.string()).max(5).optional(),
});

export const PageletReviewResultSchema = z.object({
  schema_version: z.literal(1),
  detected_language: z.enum(["zh", "en"]),
  suggestions: z.array(PageletSuggestionSchema).max(8),
  overall_remark: z.string().max(280).optional(),
});

export type PageletReviewResult = z.infer<typeof PageletReviewResultSchema>;
```

### 4.2 Provider 兼容矩阵（D026.c，OQ002 spike 更新 2026-06-05）

| Provider | `withStructuredOutput` | JSON schema 模式 | JSON object 模式 | 降级 parser 是否为主路径？ |
|----------|----------------------|------------------|------------------|--------------------------|
| Qwen/DashScope（qwen3.5+、qwen-max/plus/flash/turbo，非思考模式） | Yes（ChatOpenAI） | Yes | Yes | 否，仅安全网 |
| Qwen/DashScope（旧模型 / 思考模式） | Yes（方法存在） | No | Yes | 是 |
| Bailian（Qwen 模型） | 同 DashScope | 同 DashScope | 同 DashScope | 同 DashScope |
| Bailian（第三方：DeepSeek、GLM 等） | Yes（方法存在） | 不确定 | Likely | 是 |
| DeepSeek（直连） | Yes（方法存在） | No | Yes（V3+/R1+） | 是 |
| OpenAI（原生） | Yes | Yes | Yes | 否，仅安全网 |
| Groq | Yes | Likely | Yes | 否，仅安全网 |
| Together AI | Yes | 部分 | Yes | 视模型而定 |
| Ollama | **不支持**（D026.c 排除） | No | No | 不进入候选 |

> **OQ002 spike 结论（2026-06-05）**：PA 主要目标用户使用的 Qwen 主流模型（qwen-plus / qwen-max / qwen-turbo / qwen-flash）通过 DashScope OpenAI-compatible endpoint 均支持 `json_schema` 严格模式。DeepSeek 直连和 DashScope 上的第三方模型由 JSON-mode fallback parser 兜底。当前双路径架构充分可用，不需要重新设计。详见 `tmp/oq002-spike-report.md`。

### 4.3 失败矩阵（D026.d）

8 行均需在 `PageletAgentModel` 内捕获并优雅处理：

| Failure mode | 处理 |
|--------------|------|
| schema mismatch | 一次重试（带 `"previous output did not match schema; fix only the malformed fields"`）；仍失败 → 用户提示"review 失败"+ feedback 链接 |
| missing source_id | 同上（重试时强调 source-id 约束） |
| wrong field type | 同上 |
| empty suggestions[] | 视为 success，渲染"没有建议——你的笔记看起来不错"空状态 |
| over length（单 suggestion 超 schema 限制） | 截断到 schema 上限，标记 `truncated: true` |
| partial（只解出部分 suggestion） | 渲染已解出的，剩余丢弃，diagnostics 记录 |
| timeout | 走 PaAgentLoop 的 `maxWallClockMs`（默认 180s）；超时返回友好提示 |
| parse error | 走降级 path：手写 parser（容忍 trailing comma、code fence 包裹） |

### 4.4 Few-shot 注入

只 1 个 few-shot（D026.f），位置：user message 而非 system，避免 system token 膨胀。Few-shot 内容随 detected_language 切换中/英版本，存放于 `pa-review-schemas.ts` 的 `FEW_SHOT_ZH` / `FEW_SHOT_EN`。

---

## 5 · 文件 IO 与持久化（D008-D010）

### 5.1 目录与文件结构

```
<vault root>/
├── .pagelet/                                          # D008（dotfolder）
│   ├── note-a-pagelet-review-2026-06-01.md            # D009
│   ├── note-a-pagelet-review-2026-06-08.md
│   └── meeting-minutes-pagelet-review-2026-06-01.md
└── ...用户原有结构
```

### 5.2 写入路径——绕过 `modify` 事件（R3）

```ts
// 必须用 vault.adapter.write 而非 vault.modify / vault.create
// 否则 Templater / Better Word Count / Tag Wrangler 会触发副作用
async function writePageletOutput(plugin: PluginManager, path: string, content: string) {
  // 0. 确保 .pagelet/ 存在
  if (!(await plugin.app.vault.adapter.exists(".pagelet"))) {
    await plugin.app.vault.adapter.mkdir(".pagelet");
  }
  // 1. 撞名时避让到 .pagelet-reviews/（D008）
  const targetDir = await resolveTargetDir(plugin);
  // 2. 用 adapter.write 写——不会触发 vault.on("modify")
  await plugin.app.vault.adapter.write(`${targetDir}/${path}`, content);
}
```

### 5.3 Frontmatter（D029 命名规范 + D009）

每个产物文件 head：

```yaml
---
pagelet: true
pagelet_schema_version: 1
pagelet_source: "path/to/original-note.md"
pagelet_created_at: "2026-06-01T10:23:45+08:00"
pagelet_mode: "basic"
pagelet_cost_usd: 0.003
---
```

`pagelet: true` 让其他插件可识别忽略（Smart Connections / Copilot 等）。

### 5.4 自定义路径（D010）

`settings.pagelet.reviewsFolder`（默认 `.pagelet`）允许用户改路径。变更时执行：
1. 校验路径不在 `.obsidian/` 下。
2. 不强制迁移旧文件（避免破坏用户已有 review）。
3. 重启 plugin 后生效。

---

## 6 · 插件兼容性实现（D029）

### 6.1 4 红旗（R1-R4，当前必须落地）

#### R1 · Mascot view-type gating

```ts
// 在 plugin.ts 的 registerEvent('layout-change') 中
this.registerEvent(
  this.app.workspace.on("layout-change", () => {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.getViewType() === "markdown") {
      this.pageletUI.mountMascot(view);
    } else {
      this.pageletUI.unmountMascot();
    }
  }),
);
```

不能挂载到 Canvas / Excalidraw / Kanban / DB Folder 等视图。

#### R2 · file-open debounce + idempotent

```ts
let lastFileOpenAt = 0;
let lastOpenedPath: string | null = null;
const DEBOUNCE_MS = 300;

this.registerEvent(
  this.app.workspace.on("file-open", (file) => {
    if (!file) return;
    const now = Date.now();
    if (file.path === lastOpenedPath && now - lastFileOpenAt < DEBOUNCE_MS) return;
    lastOpenedPath = file.path;
    lastFileOpenAt = now;
    this.pageletUI.onActiveNoteChanged(file);   // 幂等：多次触发等价于一次
  }),
);
```

#### R3 · `.pagelet/` 写入用 `vault.adapter.write`

见 §5.2。**不要** 用 `app.vault.modify` 或 `app.vault.create`，避免触发 `vault.on("modify")` 让 Templater/Linter/Tag Wrangler 误处理产物文件。

#### R4 · Ribbon 已移除

Pagelet 当前不注册 Obsidian ribbon icon。历史 `pagelet.ribbonPosition`
字段仅为旧 `data.json` 兼容保留；设置页不再展示该选项，运行时也不再创建
Pagelet ribbon。

### 6.2 8 中等风险缓解

| 编号 | 风险 | 缓解 |
|------|------|------|
| M1 | CSS 全局污染 | 所有 selector 加 `.pa-pagelet-*` 前缀 + 根节点 `data-plugin="pa-pagelet"` 属性 |
| M2 | 命令名撞名 | 所有 commands 固定 `Pagelet:` 前缀 |
| M3 | Frontmatter key 撞名 | 自有 key 全用 `pagelet_*` 命名空间（见 §5.3） |
| M4 | Status bar 拥挤 | 默认 **不** 占用 status bar；只在 deeper review 进行中显示，结束后移除 |
| M5 | 上下文菜单冲突 | 当前不注册右键菜单；通过 commands + ribbon 触发 |
| M6 | Editor extension 冲突 | 当前不注入 CodeMirror extension（Pagelet 是 side-panel，不动编辑器） |
| M7 | Workspace 布局污染 | 当前 Pagelet 使用 overlay surface，不注册独立 ItemView；不复用 `markdown` |
| M8 | 设置序列化撞名 | settings JSON 段名 `pagelet`，所有子项嵌套在内 |

### 6.3 命名规范汇总

| 范畴 | 规范 |
|------|------|
| Command ID | Current beta: `pa-pagelet:review-current`; future panel: `pa-pagelet:open-panel` ... |
| Command display name | 中文 `拾页：...` / 英文 `Pagelet: ...` |
| CSS class | `.pa-pagelet-mascot` / `.pa-pagelet-card` / `.pa-pagelet-callout` |
| HTML data attr | `data-plugin="pa-pagelet"` 加在 Pagelet surface 根节点 |
| Settings key | `pagelet.*` 嵌套 |
| Frontmatter | `pagelet: true` + `pagelet_*` 前缀 |
| Review file | `{原笔记名}-pagelet-review-{YYYY-MM-DD}.md` |
| View type | 不注册独立 Pagelet ItemView |

---

## 7 · Cost Ceiling 实现（D018-D023）

### 7.1 Token 限额（D018）

```ts
const TOKEN_LIMITS = {
  defaultInput: 8_000,
  defaultOutput: 2_000,
  maxInput: 32_000,
  maxOutput: 4_000,
  hardCap: 36_000,           // input + output 永远 ≤ 36k
};

function enforceTokenLimits(settings: PageletSettings, inputTokens: number) {
  const maxInput = Math.min(settings.maxInputTokens, TOKEN_LIMITS.maxInput);
  if (inputTokens > maxInput) {
    throw new PageletError("input_too_large", {
      userMessage: "笔记过大，请考虑切分后再 review，或在设置中调高输入上限。",
    });
  }
  if (inputTokens + settings.maxOutputTokens > TOKEN_LIMITS.hardCap) {
    throw new PageletError("hard_cap_exceeded");
  }
}
```

### 7.2 Call 计数（D019-D020）

```ts
class PageletCostGate {
  // 滑窗：保存最近 1 小时的时间戳，超出窗口的 expire
  private hourlyCallTimestamps: number[] = [];
  // 简单计数：每日 00:00 reset（按本地时区）
  private dailyCallCount = 0;
  private dailyResetAt = nextLocalMidnight();

  reserve(): "ok" | "hourly_exceeded" | "daily_exceeded" {
    const now = Date.now();
    this.hourlyCallTimestamps = this.hourlyCallTimestamps.filter(t => now - t < 3_600_000);
    if (this.hourlyCallTimestamps.length >= 10) return "hourly_exceeded";   // D020
    if (Date.now() >= this.dailyResetAt) { this.dailyCallCount = 0; this.dailyResetAt = nextLocalMidnight(); }
    if (this.dailyCallCount >= 100) return "daily_exceeded";                 // D020
    this.hourlyCallTimestamps.push(now);
    this.dailyCallCount += 1;
    return "ok";
  }
}
```

### 7.3 触达上限行为（D021）

```ts
if (gateResult === "hourly_exceeded" || gateResult === "daily_exceeded") {
  const userChoice = await showCostLimitModal({
    title: "已达 Pagelet 调用上限",
    message: gateResult === "hourly_exceeded" ? "每小时 10 次上限" : "每日 100 次上限",
    primary: "强制再来一次（跳过限制）",   // BYOK 自主权
    secondary: "取消",
  });
  if (userChoice !== "force") return;
  // force 路径直接绕过 cost-gate，但仍受 hardCap token 限制约束
}
```

### 7.4 费用展示（D022）

```ts
// LLM 调用后通过 provider response 拿到实际 usage
const costUsd = computeCost({
  provider: settings.pagelet.provider,
  model: settings.pagelet.model,
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
});
suggestionCard.setFooter(`this review used ~$${costUsd.toFixed(3)}`);
// 同步写入 frontmatter pagelet_cost_usd
```

定价表硬编码在 `pa-review-pricing.ts`，按 provider/model 分桶，未知 provider 显示 `~$? (unknown pricing)`。

### 7.5 异常熔断（D023）

当前 Pagelet 只做最低限度："任意 LLM 调用失败 → 用户提示 + 提供 feedback 链接 + 不重试"。

更精细的熔断（OQ003）：
- LLM 返回超 10K tokens → 截断+报警
- 单次 call > 60s → 中止+提示（当前暂复用 PaAgentLoop 的 `maxWallClockMs`）
- 连续 3 次 call 报错 → 暂停 30 分钟
- Provider rate limit → 指数退避重试

---

## 8 · 国际化 / 语言（D014-D017）

### 8.1 笔记语言检测（D015）

```ts
// src/locales/pagelet/language-detect.ts
export function detectNoteLanguage(text: string): "zh" | "en" {
  const chineseChars = text.match(/[一-鿿]/g)?.length ?? 0;
  const ratio = chineseChars / Math.max(1, text.length);
  return ratio > 0.3 ? "zh" : "en";   // 30% 阈值（D015）
}
```

**Settings 覆盖**（D015 C 兜底）：`settings.pagelet.outputLanguage: "auto" | "zh" | "en"`，auto 时走检测，否则强制。

### 8.2 System prompt 语言策略（D016）

System prompt 全英文模板，detected_language 通过运行时指令注入：

```ts
const systemPrompt = `
You are Pagelet, a quiet reviewer for a user's Obsidian note.
${ROLE_DESCRIPTION_EN}
${SCHEMA_INSTRUCTIONS_EN}
${PROHIBITED_ACTIONS_EN}

IMPORTANT: respond in ${detectedLang === "zh" ? "Chinese (Simplified)" : "English"}.
The 'detected_language' field in your structured output MUST equal "${detectedLang}".
`;
```

### 8.3 UI / Mascot 文案语言（D014 + D017）

| 元素 | 语言决定 |
|------|----------|
| Mascot 文案（"让我看看..." 等） | UI 语言（D017） |
| Settings / commands / ribbon tooltip | UI 语言（D014） |
| Review 产物内容 | 笔记语言（D015） |
| Beta callout 文本 | UI 语言 |

i18n 资源加在现有 `src/i18n/` 下：

```
src/i18n/
├── zh-CN.json
│   └── "pagelet.mascot.thinking": "让我看看…"
│   └── "pagelet.beta.callout": "拾页处于 Beta 阶段，建议可能不完美 —— 你的反馈帮助我们改进。"
└── en.json
    └── "pagelet.mascot.thinking": "Let me take a look…"
    └── "pagelet.beta.callout": "Pagelet is in Beta. Suggestions may be imperfect — your feedback helps us improve."
```

---

## 9 · 可访问性（D007）

### 9.1 焦点管理

- 默认不抢焦点（用户继续写作）。
- 全局命令 `Pagelet: Review current note` 启动当前 beta 审阅路径。
- 全局命令 `Pagelet: focus latest suggestion` 默认绑定 `Mod+/`；当 Pagelet panel 有可见 SuggestionCard 时聚焦首个交互控件，没有 card 时安全 no-op。
- Suggestion panel 内的 card 用 `tabindex="0"` + roving tabindex 模式。

### 9.2 屏幕阅读器

```html
<div
  class="pa-pagelet-suggestions"
  role="region"
  aria-label="Pagelet suggestions"
  aria-live="polite"     <!-- D007.3: 仅出现建议时公告 -->
  aria-atomic="false"
>
  ...
</div>
```

`aria-live="polite"` 而非 `assertive`——避免打断屏幕阅读器当前朗读，只在用户停顿时插入。

### 9.3 `prefers-reduced-motion`（D007.4）

```css
.pa-pagelet-mascot {
  animation: pa-pagelet-float 3s ease-in-out infinite;
}
.pa-pagelet-mascot--thinking path {
  animation: pa-pagelet-wobble 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .pa-pagelet-mascot,
  .pa-pagelet-mascot--thinking path {
    animation: none !important;
  }
  /* 颜色变化保留（功能性状态信号） */
}
```

颜色 token（D005）保持不变：
- 中性灰 `#e8e8e8`
- Thinking 蓝 `#7c9eff`
- Done 绿 `#5dd39e`
- Error 红 `#ff6b6b`

---

## 10 · UI 模块

### 10.1 Mascot SVG（D004 极简线稿 + D005 Tldraw-like）

- 单 SVG inline 渲染，~12 个 path。
- stroke-width 1.6px，stroke-linecap `round`，stroke-linejoin `round`。
- 抖动用 SVG path 顶点 ±0.1~0.3 微偏移模拟手绘（参考 `docs/pagelet-visual-spec.html` §② "手绘抖动"），不依赖 SVG filter。
- 状态切换用 CSS class（`--idle` / `--thinking` / `--done` / `--error`），不重新挂 DOM。

### 10.2 SuggestionCard 渲染

```ts
interface SuggestionCardProps {
  suggestion: PageletSuggestion;
  onAccept(): void;
  onDismiss(): void;
  costUsd?: number;            // D022
}
```

- 不修改原笔记（D006 B = 非侵入）。
- Accept 行为：把建议追加到 `.pagelet/{...}.md` 末尾的 "accepted" 段（不动原笔记）。
- Dismiss：本地标记，下次同 source_id 不再出现。

### 10.3 Settings UI

新增 group `Pagelet`：

```
Pagelet
├── General
│   ├── Reviews folder        (default: .pagelet)            D010
│   ├── Output language       [auto | zh | en]               D015
│   └── Ribbon icon           [default | hidden]             R4
├── Model
│   ├── Provider              (复用 PA chat provider)
│   ├── Model                 (复用)
│   └── Temperature           (0.0-0.5，默认 0.2)
├── Limits
│   ├── Max input tokens      (默认 8000，上限 32000)         D018
│   ├── Max output tokens     (默认 2000，上限 4000)
│   ├── Hourly call limit     (默认 10，固定，不可改)         D020
│   └── Daily call limit      (默认 100，固定，不可改)
└── Advanced
    └── (callout: "Pagelet is in Beta..." + [Send feedback →])    D011
```

---

## 11 · Telemetry / 事件钩子

### 11.1 复用 PA 既有事件系统

通过 `onEvent` 回调走 PaAgentLoop 现有 `AgentEvent` 流（`src/ai-services/pa-agent-loop.ts:124`），新增 4 个 review 专用 event type：

| Event | 时机 | payload |
|-------|------|---------|
| `pagelet.review_started` | adapter.run() 入口 | `{ runKind: "basic" | "deeper", filePath }` |
| `pagelet.review_completed` | LLM 返回 + schema 校验通过 | `{ suggestionsCount, costUsd, durationMs }` |
| `pagelet.cost_limit_hit` | 触达每小时/每日上限 | `{ scope: "hourly" | "daily", forceTriggered: boolean }` |
| `pagelet.schema_parse_failed` | structured-output 降级 | `{ provider, errorClass: "schema" | "json" | "timeout" }` |

### 11.2 DAU/MAU（OQ004）

当前暂不直接收集遥测数据。代用指标：
- GitHub Issues 中 Pagelet label 计数
- 用户自报（设置内"send feedback"链接）

正式 telemetry → 后续范围（OQ004）。

---

## 12 · 测试策略

### 12.1 单元测试（实测落地）

| 测试文件（`__tests__/`） | 覆盖 |
|---------|------|
| `pa-locales-pagelet.test.ts` | EN/ZH key parity + `detectNoteLanguage` regex（中文比例 0% / 20% / 30% / 31% / 100%） |
| `pa-review-schemas.test.ts` | schema 边界：空 suggestions / 超长 rationale / 缺字段 / source_id 不命中 |
| `pa-review-cost.test.ts` | 定价表 + canonical provider 别名（qwen/dashscope/bailian） |
| `pa-review-rate-limit.test.ts` | 滑窗 / 强制跳过 / 跨日 reset |
| `pa-review-file-io.test.ts` | `.pagelet/` 解析 + `vault.adapter.write` 路径 + frontmatter |
| `pa-review-model.test.ts` | structured output + 降级 path |
| `pa-review-tool-provider.test.ts` | capability 注册 + targetConfinement 行为 |
| `pagelet-settings.test.ts` | `normalizeReviewsFolder` 10 类越界形状（§14.1 H-B3.2 第一道防线） |
| `pagelet-mascot.test.ts` / `pagelet-mascot-a11y.test.ts` / `pagelet-suggestion-card.test.ts` | UI markup + a11y + reduced-motion |
| `pagelet-compat-{view-type,debounce,ribbon,focus-command}.test.ts` | R1/R2/R4 + Cmd+/ |
| `policy-engine.test.ts`（扩展） | runKind="review" + allowWrite=true → action capability 放行 |

> 当前没有 `pa-review-host-policy.test.ts`：HostPolicy 未单独抽出（见 §1.3 注），单 turn 行为由 `pa-review-runtime.ts` 与 model 测试间接覆盖。

### 12.2 集成测试

- Fake provider（参考 `src/tests/fakes/fake-chat-model-provider.ts`）注入预制 structured output，跑完整 adapter.run 路径。
- Schema-mismatch 路径：fake provider 返回坏 JSON → 验证降级 + diagnostics。

### 12.3 手测清单（Beta 发布前）

- [ ] Canvas / Excalidraw / Kanban 视图打开时 mascot **不** 挂载（R1）
- [ ] 快速切换文件 5 次（< 1.5s）只触发 1 次 review prefetch（R2）
- [ ] 写入 `.pagelet/*.md` 不触发 Templater / Linter（R3）
- [ ] 与 Smart Connections + Copilot 共存装载，无 hotkey/ribbon 冲突
- [ ] `prefers-reduced-motion` 开启时 mascot 不抖动但仍变色
- [ ] 中文笔记 → 中文建议；英文笔记 → 英文建议；混合笔记 → 走 settings 兜底
- [ ] 每小时 11 次连续调用 → 第 11 次弹"强制再来一次"
- [ ] BRAT 安装/卸载/重装 → `.pagelet/` 数据保留

---

## 13 · Rollout（D013）

### 13.1 SemVer

- 当前最新：PA release line
- Pagelet 发布通道：next PA beta channel
- Graduate 标准（D013）：连续 2 个 `-beta.N` 无 P0/P1 bug + GitHub Issues 反馈无致命问题
- Graduate 版本：next PA stable release

### 13.2 Beta 默认行为

- 装 `-beta.N` → Pagelet **默认开启**（D013：用户装 beta 即想试新功能）
- 用户可在 Settings 关闭：`settings.pagelet.enabled: false`
- Graduate 后默认仍 开启，但用户初次升级会看到 callout 提示

### 13.3 CHANGELOG

沿用 PA 现有 `docs/release-process.md` 规范，Pagelet 特性单独段落标注 `[Beta]`：

```markdown
## 2.5.0-beta.1

### Beta Features
- [Beta] Pagelet (拾页): your note's quiet reviewer
  - Review-first AI suggestions in side panel
  - Non-intrusive: suggestions never mutate your notes
  - Vault-aware: cites related notes from your existing graph
  - See Settings → Pagelet to configure

### ...其他常规改动
```

### 13.4 反馈渠道（D012）

- 极客用户：GitHub Issues + `pagelet` label
- 普通用户：表单（Google Form 或飞书 / 腾讯问卷），链接放在 settings callout

---

## 14 · Open Dependencies & Risks

### 14.1 阻塞中

| ID | 内容 | 严重程度 | 影响 SDD 章节 |
|----|------|---------|--------------|
| ~~**OQ001**~~ | ~~**Write Action Framework create-file path + PolicyEngine 参数化**~~ | **✅ Resolved（2026-06-03，[[D031]]）** | §2.4 / §3 / §7 / §14.3 占位已去 stub |
| ~~**OQ002**~~ | ~~**F5 Provider 兼容性 spike**~~ | **✅ Resolved（2026-06-05）** — spike 确认双路径架构可用；live 测试制度化到 `docs/pagelet-smoke-checklist.md` P1 section | §4.2（兼容矩阵已更新）、§4.3（失败矩阵实际触发率） |

> **OQ001 解阻塞标记（2026-06-03）**：Write Action Framework SDD 落地（`docs/write-action-framework-sdd.md`），`src/ai-services/write-action-framework/**` 4 个 gate 实现就绪，PolicyEngine 参数化（runKind + allowWrite）完成，`pagelet.write_review_output` 作为首个真实 caller 接入并通过 E2E + prompt-injection 测试。本 SDD §2.4 与 §3 的契约面占位已 1:1 映射到 framework SDD §3 capability contract 与 §4 PolicyEngine diff。Append / replace / multi-file / shell action family 扩展走 Operations Agent mode 路线，参 [[D031]]。
>
> **H-B3.2 两层闭环（更新 2026-06-04，issue #358 关闭后）**：`PaReviewToolProvider` 的 `targetConfinement.allowedRoots` 由两层独立防线保护——
>
> 1. **Settings 层（第一道，user-facing）**：`normalizeReviewsFolder` 在 data.json 写入边界处先行 fail-closed 把 10 类越界形状（`empty / too_long / absolute_path / drive_letter / parent_traversal / obsidian_config / forbidden_dotfolder / control_chars / invisible_chars / trailing_dot_or_space`）落到默认 `.pagelet`。实现位置：`src/settings/pagelet/index.ts` `normalizeReviewsFolder` + `mergePageletSettings` boot-time merge + `src/plugin.ts` `loadSettings` + 一次性迁移 Notice（localStorage flag `pa-pagelet-reviews-folder-migration`）。
> 2. **Framework Gate 1（第二道，defense-in-depth）**：`validateAllowedRoots` 在 `buildConfinement` 内对 `allowedRoots` 做 NFC+lowercase fold 检查，命中 `{.obsidian, .git, .trash, .obsidian.bak}` 直接 throw `ConfinementConfigError`（issue #358 AC #1）；写入期 `validateTargetConfinementSync` 在第 9 步（SDD §2.2 1–13 sync 序列里的 candidate-side denylist 段）对 candidate path 重做同套段检查（issue #358 AC #2-3）。实现位置：`src/ai-services/write-action-framework/target-confinement.ts` `validateAllowedRoots` + `validateTargetConfinementSync` step 9 + `src/pagelet/pa-review-tool-provider.ts:286` `buildConfinement` 的内嵌调用。**触发时机说明**：Pagelet 用 `get targetConfinement()` getter（`pa-review-tool-provider.ts:410`），每次属性读时都会调一次 `buildConfinement` → `validateAllowedRoots`，throw 因此延迟到执行期（runtime 的 `validateTargetConfinement` catch 兜底转成 `rejected_at_confinement` 事件）；如果第三方 `CapabilityProvider` 改用 eager `targetConfinement: {...}` 字面量，调用 `buildConfinement` / `validateAllowedRoots` 的位置就回到字面 register 期，throw 在 provider 构造时立刻冒出。两种模式都满足 "loud, not silent" 的 AC #1 要求，但调用 site 和栈追踪不同。
>
> framework SDD §8.3 描述的攻击面在两层任一即被截断；即使未来某个第三方 `CapabilityProvider` 跳过 settings 层直接接入 framework，Gate 1 仍能独立 fail-closed。回归测试见 `__tests__/pagelet-settings.test.ts` 47 个 case（settings 层）+ `src/ai-services/write-action-framework/target-confinement.spec.ts` 30+ case（framework 层，含 `validateAllowedRoots` 10 个变体 + `forbidden_dotfolder` 候选侧 7 个变体）。剩余 framework-layer Cf-invisibles / trailing-dot-or-space mirror 单独跟踪 follow-up issue（issue #358 AC 不要求）。
>
> **历史背景（保留可追溯）**：OQ001 在 2026-06-02 由 [[D030]] 升级为 Pagelet beta Hard Blocker，约束 §2.4 / §3 / §14 仅勾勒契约面与命名占位、不进入实现，直到 framework create-file path 就绪。该阻塞自 2026-06-03 起解除。

### 14.2 后续范围

| ID | 内容 |
|----|------|
| OQ003 | 异常熔断细化（10K 截断 / 60s 中止 / 3 连错暂停 / rate-limit 退避） |
| OQ004 | DAU/MAU 正式 telemetry |
| OQ005 | Pagelet + 其他 AI 插件并存的资源/事件叠加实测 |

### 14.3 风险登记

| 风险 | 等级 | 缓解 |
|------|------|------|
| Provider structured-output 实际兼容性低于预期 | 低（OQ002 spike 降级） | OQ002 spike（2026-06-05）确认主流 Qwen 模型支持 json_schema；fallback parser 8 步纵深防御（容错提取 → 容错解析 → schema 修补 → 超长截断 → source-id 过滤 → 纠错重试 → 部分成功）已验证可靠 |
| 用户对 `.pagelet/` 隐藏目录的接受度 | 低 | dotfolder 默认隐藏 + settings 可改 + 文档说明 |
| Beta 期间 cost 失控（用户脚本误触发） | 中 | 小时/日双层限制（D020） + 强制跳过需手动确认 |
| 与 Templater 等插件的隐性冲突 | 中 | R3 + frontmatter `pagelet: true` + view-type 隔离（M7） |

---

## 15 · 决策追溯

| 决策 ID | SDD 章节 |
|---------|----------|
| D004-D005（视觉） | §10.1 |
| D007（a11y） | §9 |
| D008-D010（存储） | §5 |
| D011-D012（Beta） | §10.3、§13.4 |
| D013（Release） | §13 |
| D014-D017（i18n） | §8 |
| D018-D023（Cost） | §7 |
| D024（架构） | §1, §2 |
| D025（写路径） | §0、§2.4, §3, §7, §14.1 |
| D026（Structured Output） | §4 |
| D029（兼容性） | §6 |
| **D030（写路径基础设施 + 二层命名对齐）** | §0、§1.1、§2.4、§3、§14.1 |

---

> 文档结束。后续修订需同步更新 `decisions.md`（新增决策记入对应 D 号）与 `product-design.md`（产品意图变更）。
