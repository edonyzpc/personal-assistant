# v2.0.0 代码审查修复方案

**Status:** Code-led status reconciled on 2026-05-30; original Phase 1-2 remains mostly open; Phase 3 implementation status reconciled against current code
**Source:** `docs/archive/v2-comprehensive-code-review.md`
**Plan file mirror:** `~/.claude/plans/breezy-wiggling-gem.md`

## Context

基于 `docs/archive/v2-comprehensive-code-review.md` 审查报告和讨论确认的决策，制定从简单到复杂的分阶段修复方案。

**不动的项：** 三层工具管线 / PolicyEngine / 双事件系统（action mode 预留）、Skill 系统基础设施（计划扩展）、LangChain 依赖（保留）、React 19（不降级）。

## 2026-05-30 Code-Led Status

当前代码已经偏离本文件最初的顺序执行计划：本轮实际优先完成了 Settings/Keychain、Chat history UI、Memory OPFS lock recovery 以及相关 smoke/回归验证。下面状态以当前代码为准。

### 已在当前代码中完成

| Area | Status | Code evidence |
| --- | --- | --- |
| API token migration and storage cleanup | Done | `src/plugin.ts` deletes legacy `settings.apiToken` after migration/failure/empty value, migrates legacy `pa-api-token` into vault-scoped secret id when needed, and keeps `getAPIToken()` fallback/copy logic. |
| API Token settings UX | Done | `src/settings.ts` uses scoped/legacy secret fallback, confirms token removal, labels the control as `Keychain`, and uses the Add secret-style editor for API token edits. |
| Provider presets and confirmation | Done | `src/settings.ts` includes Qwen, Qwen International, OpenAI, and Custom presets; switching providers shows a confirmation before replacing URL/model defaults. |
| Settings data-safety fixes | Done | `safeParseInt()`, `mergeLoadedSettings()`, metadata add-form defaults/validation, runtime-only `isEnabledMetadataUpdating`, and fresh-install explicit provider choice are in code. |
| Settings layout polish | Partially done | AI settings are grouped near the top; Memory child controls hide behind the master toggle; text inputs have scoped alignment/width CSS. Full IA simplification is still not a complete redesign. |
| Chat history modal overflow/duplicate preview | Done | `src/chat/modals.ts` hides duplicate previews; `src/custom.pcss` constrains modal/list row width and keeps delete controls aligned. |
| Chat history persistence | Done | `src/plugin.ts` initializes `ChatHistoryManager`; `src/chat/chat-history-store.ts` provides IndexedDB/Memory/Unavailable stores; `src/chat/chat-view.ts` restores, switches, clears, deletes, and persists finalized turns. |
| `chat-tools.ts` module split | Done | `src/ai-services/chat-tools.ts` is now a barrel re-export over `chat-tool-types`, `chat-tool-registry`, `chat-tool-factories`, guards, constants, prepare helpers, and execution helpers. |
| Statistics `calcSnapshot()` incremental cache | Done | `src/stats/stats-local-store.ts` stores `fileCountCache`; `src/stats/stats-manager.ts` loads/validates cache entries and handles create/modify/delete/rename invalidation before incremental snapshots. |
| WASM lazy load | Done | `esbuild.config.mjs` uses `lazyBinaryPlugin`; `src/vss/sqlite-inline-assets.ts` calls `getSqliteWasmBinary()` only when creating the inline SQLite WASM URL. |
| Required capability refactor | Done | `src/ai-services/pa-agent-required-capability-policy.ts` removes the old `ignore` level, uses a runtime phase model, unified `scoreCapability()`, and structured English/CJK signal tables. |
| Memory OPFS locked recovery | Done | Foreground startup/chat/status no longer opens OPFS just to recover a missing marker; manual technical stats can bounded-retry/recover. `opfs-sahpool-locked` records diagnostics without falling back to legacy JSON. |
| Memory update smoke | Done | Obsidian test-vault smoke after deploy recovered Memory diagnostics to Ready and completed `Update memory now` with notes unchanged. |

### 原 Phase 1-2 — 全部完成（2026-06-01 SDD-driven 收尾）

| Item | Status | SDD | Commit |
| --- | --- | --- | --- |
| 1.1 Prompt same-language/citation/no-guess lines | ✅ Done | [sdd-prompt-and-token-quality](./sdd-prompt-and-token-quality.md) | `7d84584` |
| 1.2 `getVSSFiles()` filter optimization | ✅ Done | [sdd-trivial-cleanups](./sdd-trivial-cleanups.md) | `a9b48cd` |
| 1.3 `getReadOnlyToolContextInfo` lookup map | ✅ Done | [sdd-trivial-cleanups](./sdd-trivial-cleanups.md) | `776812f` |
| 1.4 `tsconfig` `strict: true` | ✅ Done | [sdd-strict-mode-and-coverage](./sdd-strict-mode-and-coverage.md) | `f2682f1` + `f87d5d7` + `7dfc275` |
| 1.5 Jest `coverageThreshold` | ✅ Done | [sdd-strict-mode-and-coverage](./sdd-strict-mode-and-coverage.md) | `046774b` (baseline -5%: 75/71/74/75) |
| 1.6 Rerank excerpt 200 → 400 | ✅ Done | [sdd-prompt-and-token-quality](./sdd-prompt-and-token-quality.md) | `5980a47` |
| 1.7 Chinese capability signals | Done, adjusted | (covered by Phase 3.6) | superseded by `pa-agent-required-capability-policy.ts` CJK tables |
| 2.1 Planner tool definition de-dup | ✅ Done | [sdd-prompt-and-token-quality](./sdd-prompt-and-token-quality.md) | `42126f4` |
| 2.2 Canonical chat history sandbox/limit | ✅ Done | [sdd-prompt-and-token-quality](./sdd-prompt-and-token-quality.md) | `5d58d55` (MAX_CHAT_HISTORY_TURNS=20) |
| 2.3 Operations capability catalog simplification | ✅ Done | [sdd-trivial-cleanups](./sdd-trivial-cleanups.md) | `c858e5b` (359 → 76 lines, validator removed) |
| 2.4 Rewrite + embedding parallelization | ✅ Done | [sdd-search-pipeline-parallelization](./sdd-search-pipeline-parallelization.md) | `a031185` + `178b7ac` |

实施方式：SDD docs PR (`2ebf211`) + Wave 1 并行 worktrees (PR-1/PR-2/PR-4) + Wave 2 worktree (PR-3 strict + coverage)；全量门禁（tsc / 全量 test+coverage / lint / build）每 PR 单独通过 + 集成后再过一遍。Obsidian 手动 smoke 仍待用户验证（参见 [sdd-prompt-and-token-quality](./sdd-prompt-and-token-quality.md) §4.6 / [sdd-search-pipeline-parallelization](./sdd-search-pipeline-parallelization.md) §4.5）。

### Smoke status and remaining high-risk checks

Completed validation in this code state:

- Focused VSS/SQLite tests: `npm test -- --runInBand __tests__/vss.test.ts __tests__/sqlite-worker.test.ts __tests__/sqlite-vector-index.test.ts`.
- Expanded Memory tests, then full `npm test -- --runInBand`.
- `npm run lint`, `npm run build`, `git diff --check`, and `make deploy`.
- Obsidian test-vault smoke: Memory diagnostics Ready, manual `Update memory now` succeeded, metadata command disabled path showed the expected Notice, Memory reset/delete confirmations opened and were cancelled.
- Later high-risk Obsidian smoke in this conversation passed after explicit confirmation: `Update plugins`, `Update themes`, AI Featured Images, and actual Memory reset/delete old cache confirmation.
- **2026-06-01 SDD-driven 收尾批次 smoke (Wave 1/2)** — Obsidian test vault 中验证通过：PR-2 6 项（中文输入回中文、Memory 命中引用 note path、无证据明说不知道、25+ turn 对话 `<chat_history>` 块仅保留最后 20 turn、rerank candidate excerpt 长度可达 400、planner tool definitions 仅含 `name` + `planner_guidance`）+ PR-4 4 项（rewrite/embed 并行延迟下降、rewrite 模型名错误降级到 raw prompt、rewrite 超时降级、正常流程命中相同 candidates）。

### Status document ownership

The current code-led status is split by document so release checks can find the source of truth quickly:

| File | Current role |
| --- | --- |
| `docs/v2-fix-plan.md` | Tracks the original v2 review plan against current code and keeps the still-open Phase 1-2 items visible. |
| `docs/settings-ui-review.md` | Preserves the historical Settings review and adds the current fixed/partial/open status for each finding. |
| `docs/vss-local-state-plan.md` | Defines the current local-state boundary: no foreground marker recovery; manual diagnostics can recover a compatible OPFS index. |
| `docs/vss-local-state-development-tracker.md` | Records the OPFS-lock follow-up verification, Obsidian smoke evidence, and completed high-risk manual checks. |
| `docs/vss-sqlite-wasm-architecture.md` | Documents the runtime OPFS/marker lifecycle, including foreground lock handling and manual-only missing-marker reconstruction. |
| `docs/todo.md` | Holds the release gate for accepting/deferring remaining v2 review items and high-risk smoke checks. |
| `docs/sdd-*.md` Phase 3 records | Historical design records for implemented Phase 3 items; they are not current open implementation plans. |

Runtime/test changes were split by module (`vss`, `settings`, `chat-history`, `ui styles`). Keep the document files above synchronized when the release gate changes.

## 历史开发方法：Spec-Driven Development (SDD) + Worktree 并行

本节记录最初针对复杂项（Phase 3）的执行方法。当前 3.1、3.2、3.3、3.5、3.6 已经落地，下面内容仅作为历史执行约束和未来类似拆解的参考。

原计划采用 SDD 流程 + git worktree 隔离开发：
1. **写 Spec** — 设计文档落到 `docs/` 目录，作为唯一 source of truth
2. **用户确认** — Spec 文档逐份 review，确认后才开始编码
3. **Worktree 实施** — 每个 Phase 3 项目使用独立 git worktree，避免分支切换冲突
4. **验证** — 按 Spec 中的测试计划在 worktree 中验证
5. **合并** — 验证通过后从 worktree 推送 PR

### 并发开发支持

原计划中 Phase 3 各项之间**无代码依赖**，可在多个 worktree 中并行开发。用户可以：
- 在当前 Claude session 中启动一个 worktree 推进某项
- **同时**启动新的 Claude 实例（在不同 terminal）接管其他 worktree 并行开发
- 各 worktree 互不干扰，PR 顺序不限

当时如果某个 Phase 3 项目较复杂（例如 3.1 chat-tools 拆分、3.2 calcSnapshot 增量），建议交给独立 Claude 实例处理，避免单一 session 上下文压力过大。

### Phase 3 SDD 设计文档清单

| # | 文档 | 状态 |
|---|------|------|
| 3.1 | [docs/archive/sdd-chat-tools-split.md](./sdd-chat-tools-split.md) | ✅ 已实现；SDD 保留为历史设计记录 |
| 3.2 | [docs/archive/sdd-calc-snapshot-incremental.md](./sdd-calc-snapshot-incremental.md) | ✅ 已实现；SDD 保留为历史设计记录 |
| 3.3 | [docs/archive/sdd-wasm-lazy-load.md](./sdd-wasm-lazy-load.md) | ✅ 已实现；SDD 保留为历史设计记录 |
| 3.5 | [docs/archive/sdd-chat-history-persistence.md](./sdd-chat-history-persistence.md) | ✅ 已实现；SDD 保留为历史设计记录 |
| 3.6 | [docs/archive/sdd-required-capability-refactor.md](./sdd-required-capability-refactor.md) | ✅ 已实现；SDD 保留为历史设计记录 |

---

## Phase 1: 简单修复（7 项，单文件编辑，低风险，可并行）

### 1.1 系统 prompt 加 3 条指令
- **文件:** `src/ai-services/pa-agent-runtime.ts:1182-1198`
- **改动:** 在 `PA_AGENT_ANSWER_STREAM_SYSTEM_PROMPT_LINES` 数组的安全规则后（第 1189 行之后）插入 3 行：
  - `"Respond in the same language as the user's input unless asked otherwise."`
  - `"When your answer uses facts from tool observations, cite the source note path so the user can verify."`
  - `"If the available evidence is insufficient to answer, say so rather than guessing."`
- **验证:** `npm test -- --testPathPattern=pa-agent-runtime-prompt`，在测试中增加 3 条新断言
- **风险:** 极低

### 1.2 getVSSFiles() Set 优化
- **文件:** `src/plugin.ts:675-691`
- **改动:** 删除中间 `excludeFiles` 数组，改为单次 filter：
  ```ts
  getVSSFiles() {
      const files = this.app.vault.getMarkdownFiles();
      const excludePaths = (this.settings.vssCacheExcludePath || []).map(p => p.trim()).filter(Boolean);
      if (excludePaths.length === 0) return files;
      return files.filter(file => !excludePaths.some(ep => file.path.startsWith(ep)));
  }
  ```
- **验证:** `npm test -- --testPathPattern=vss`
- **风险:** 极低

### 1.3 getReadOnlyToolContextInfo if-chain → lookup map
- **文件:** `src/ai-services/pa-agent-host-tools.ts:300-378`
- **改动:** 用 `Record<string, {...}>` 替代 10 分支 if-chain，保留 fallback return
- **验证:** `npm test -- --testPathPattern=pa-agent-host-tools`
- **风险:** 极低

### 1.4 tsconfig 开启 strict: true
- **文件:** `tsconfig.json`
- **改动:** 替换 `noImplicitAny` + `strictNullChecks` + `strictPropertyInitialization` 为 `"strict": true`
- **新启用:** `strictFunctionTypes`, `strictBindCallApply`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict`
- **影响范围:** 源码 0 报错，仅 4 个测试文件约 18 处 mock 类型需修复
- **验证:** `tsc -noEmit -skipLibCheck` + `npm test`
- **风险:** 低

### 1.5 jest 配置 coverageThreshold
- **文件:** `jest.config.js:45`
- **改动:** 取消注释并设置保守初始值（先运行 `npm test` 获取基线，设为基线 -10%）
- **验证:** `npm test`
- **风险:** 极低

### 1.6 重排序摘要长度 200→400
- **文件:** `src/ai-services/pa-agent-runtime.ts:899`
- **改动:** `c.excerpt.slice(0, 200)` → `c.excerpt.slice(0, 400)`
- **验证:** `npm test -- --testPathPattern=pa-agent-runtime`
- **风险:** 极低

### 1.7 score 函数加中文关键词
- **文件:** `src/ai-services/pa-agent-required-capability-policy.ts:532-576`
- **改动:** 在 `scoreWebSearch`、`scoreMemory`、`scoreCurrentNote` 的正则之外加 `text.includes()` 中文匹配：
  - Web: `搜索`/`网上查`/`最新`/`今天`/`当前`/`实时`/`最近`/`更新`
  - Memory: `我的笔记`/`笔记库`/`记忆`/`我写过`/`我的文档`/`我的资料`
  - CurrentNote: `当前笔记`/`这篇笔记`/`打开的文件`/`这篇文章`/`这个文档`/`选中的文字`
- **注意:** `\b` 不适用于 CJK，使用 `text.includes()` 匹配
- **验证:** `npm test -- --testPathPattern=pa-agent-required-capability-policy`，新增中文输入测试用例
- **风险:** 低
- **注:** 1.7 是 Phase 3.6 重构前的临时缓解措施；3.6 完成后会被覆盖

---

## Phase 2: 中等复杂度（4 项，需仔细设计，按顺序执行）

### 2.1 formatPlannerToolDefinitions 去重
- **文件:** `src/ai-services/pa-agent-runtime.ts:943-958`
- **问题:** 当前将完整工具定义（name/description/input_schema/permission/cost 等）序列化为 JSON 放入 system prompt，与 native function-calling schema 重复，浪费 ~1500-2000 tokens/turn
- **改动:** 只保留 `plannerGuidance`（native schema 中不包含的唯一字段）：
  ```ts
  function formatPlannerToolDefinitions(definitions: ChatToolRegistryDefinition[]): string {
      if (definitions.length === 0) return "None";
      const lines = definitions
          .filter((d) => d.plannerGuidance && d.plannerGuidance.length > 0)
          .map((d) => `${d.name}: ${d.plannerGuidance.join("; ")}`);
      return lines.length > 0 ? lines.join("\n") : "None";
  }
  ```
- **验证:** `npm test`，手动测试多工具对话确认工具选择质量不退化
- **风险:** 中低（改变 LLM 可见内容，但 native schema 已包含权威定义）
- **依赖:** Phase 1.1 先完成（同文件）

### 2.2 formatCanonicalChatHistory 加沙箱 + 限长
- **文件:** `src/ai-services/pa-agent-runtime.ts:1257-1260`
- **改动:**
  ```ts
  const MAX_CHAT_HISTORY_TURNS = 20;
  function formatCanonicalChatHistory(history: ChatMessage[] | undefined): string {
      if (!history || history.length === 0) return "";
      const recent = history.slice(-MAX_CHAT_HISTORY_TURNS);
      const formatted = recent
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n");
      return `<chat_history context_only="true">\n${formatted}\n</chat_history>`;
  }
  ```
- **验证:** `npm test`，手动测试超长对话仍能正确回忆上下文
- **风险:** 中低
- **依赖:** Phase 2.1 先完成（同文件）

### 2.3 obsidian-operations-capability-catalog 扁平化
- **文件:** `src/ai-services/obsidian-operations-capability-catalog.ts`（359 行）
- **分析:** 运行时只用 `plannerGuidance`（通过 `buildObsidianOperationsPlannerGuidance`）。但 `examples`/`negativeExamples`/`forbiddenSemantics` 被 `validateObsidianOperationsCatalog()` 和测试使用。
- **改动:** 保留结构但精简：
  - 移除 `representativeQueries`（无运行时消费者，无测试验证）
  - 移除 `sourceProvenance`（纯文档）
  - 合并 `forbiddenSemantics` 到 plannerGuidance 的负面指引（减少独立验证逻辑）
  - 简化 `validateObsidianOperationsCatalog` 移除对已删字段的检查
  - 预计 360 行 → ~200 行
- **验证:** `npm test -- --testPathPattern=obsidian-operations-capability-catalog`
- **风险:** 低
- **依赖:** 无

### 2.4 LLM 调用并行化（rewrite + embedding）
- **文件:** `src/ai-services/pa-agent-runtime.ts:817-848`, `src/vss.ts:1383-1414`
- **问题:** 代码注释写 "Parallel" 但实际是串行：先 `await rewritePromise`，再调用 `searchHybrid()`（内含 `embedQuery`）
- **改动:** 修改 `searchHybrid` 接受 promise 参数：
  ```ts
  // vss.ts — searchHybrid 签名扩展
  async searchHybrid(prompt: string, options?: {
      ftsQueryOverride?: string | null;           // 保留兼容
      ftsQueryOverridePromise?: Promise<string | null>;  // 新增
  }) {
      const embeddings = await this.aiUtils.createEmbeddings(profile.dimensions);
      const [ftsOverride, queryEmbedding] = await Promise.all([
          options?.ftsQueryOverridePromise ?? Promise.resolve(options?.ftsQueryOverride ?? null),
          embeddings.embedQuery(prompt),
      ]);
      const ftsQuery = ftsOverride != null ? buildFtsQuery(ftsOverride) : buildFtsQuery(prompt);
      // ... 其余不变
  }
  ```
  ```ts
  // pa-agent-runtime.ts — searchVss 不再 await rewrite
  const rewritePromise = policyModelName
      ? this.rewriteQueryWithTimeout(query, policyModelName, signal)
      : Promise.resolve(null);
  const rawResults = await this.plugin.vss.searchHybrid(query, {
      ftsQueryOverridePromise: rewritePromise,
  });
  ```
- **预期收益:** 减少 1-3 秒延迟（rewrite + embed 从串行变并行）
- **验证:** `npm test -- --testPathPattern=vss`，`npm test -- --testPathPattern=query-rewriter`，手动测量搜索延迟
- **风险:** 中（改变异步时序，需确认 rewrite 失败时的错误隔离）
- **依赖:** Phase 2.1 + 2.2 先完成（同 runtime 文件）

---

## Phase 3: 复杂项（SDD — 当前代码已落地项）

> 本节保留最初 SDD 拆解方案，并在每项下记录当前代码状态。Phase 3 的 SDD 文件不再作为待实施计划，而是作为历史设计记录和实现审计入口。

### 3.1 chat-tools.ts 拆分（3043 行 → 6 模块）
- **SDD 文档:** [docs/archive/sdd-chat-tools-split.md](./sdd-chat-tools-split.md)
- **当前状态:** 已实现。`src/ai-services/chat-tools.ts` 是 barrel re-export，逻辑拆到 `chat-tool-types.ts`、`chat-tool-registry.ts`、`chat-tool-factories.ts`、`chat-tool-guards.ts`、`chat-tool-constants.ts`、`chat-tool-prepare-helpers.ts` 和 `chat-tool-execution-helpers.ts`。
- **核心方案:** 拆分为 6 个子模块 + barrel re-export
- **兼容策略:** 保留 `chat-tools.ts` 作为 barrel re-export，10 个消费文件无需修改
- **风险:** 中（纯重构，barrel 兜底）

### 3.2 calcSnapshot() 增量优化
- **SDD 文档:** [docs/archive/sdd-calc-snapshot-incremental.md](./sdd-calc-snapshot-incremental.md)
- **当前状态:** 已实现。`StatsLocalStore` 提供 `fileCountCache` 持久化；`StatsManager` 加载、校验、增量失效并在需要时回退全量 snapshot。
- **核心方案:** IndexedDB 文件计数缓存 + 批处理 + 基于 vault 事件的增量更新
- **风险:** 高（核心统计管线，错误增量 → 持久化错误数据）

### 3.3 WASM 懒加载
- **SDD 文档:** [docs/archive/sdd-wasm-lazy-load.md](./sdd-wasm-lazy-load.md)
- **当前状态:** 已实现。构建使用 `lazyBinaryPlugin`，SQLite inline assets 在首次创建 WASM URL 时才取 `Uint8Array`。
- **核心方案:** 自定义 esbuild `lazyBinaryPlugin`，模块评估时不解码，首次使用时 `atob` 并 GC base64 字符串
- **改动范围:** 3 文件（esbuild.config.mjs / sqlite-inline-assets.ts / __mocks__/asset-string.js）
- **内存收益:** 加载时 -941KB，首次使用后稳态 -1.25MB（base64 字符串 GC）
- **风险:** 低（改动小、单一代码路径）

### 3.4 设置页简化
- **状态:** 部分实现。API Token/Provider/Memory/文本输入对齐等高风险体验问题已修复；完整 Settings IA 简化、组件化和所有长表单的交互一致性仍是单独 UX 工作。
- **不在当前批次:** 保留为 release 前可接受/延期的产品决策，而不是已经完成项。

### 3.5 聊天历史持久化
- **SDD 文档:** [docs/archive/sdd-chat-history-persistence.md](./sdd-chat-history-persistence.md)
- **当前状态:** 已实现。当前代码已有 IndexedDB chat history store、manager、active conversation 恢复、历史选择、turn 删除/清空和 finalize 后持久化。
- **核心方案:** IndexedDB 三层模式（conversations + turns 两个 store），LRU prune 50 个，turn finalize 后写入
- **风险:** 中（新功能，但复用成熟模式）

### 3.6 RequiredCapabilityClassification 重构
- **SDD 文档:** [docs/archive/sdd-required-capability-refactor.md](./sdd-required-capability-refactor.md)
- **当前状态:** 已实现。`RequiredCapabilityLevel` 的旧 `ignore` arm 已移除；分类逻辑使用统一 score 表和 CJK token 表；运行时策略使用 phase 状态。
- **核心方案:** 类型扁平化 / score 统一 / CJK 双语关键词表 / phase 状态机 / 4 阶段增量迁移
- **覆盖 1.7:** 实施 3.6 后会替换 1.7 的临时 CJK 缓解措施
- **风险:** 中（多消费者，4 阶段增量迁移降低风险）

---

## 当前剩余工作与历史 PR 策略

### Phase 1-2: 仍按顺序接受/延期/执行

```
PR 1 (Phase 1): Items 1.1-1.7 — "代码审查修复: prompt/性能/质量"
  └── 可拆分: 1.4 (tsconfig strict) 单独 PR（改测试文件）

PR 2 (Phase 2.1+2.2): "Prompt token 优化: 工具定义去重 + 聊天历史沙箱"
  └── 同文件，逻辑相关

PR 3 (Phase 2.3): "Catalog 精简" — 小 PR

PR 4 (Phase 2.4): "搜索延迟优化: rewrite+embedding 并行化"
  └── 跨 2 个文件，需仔细 review 异步行为
```

### Phase 3: 原 worktree 计划已成为历史记录

最初计划要求 Phase 1-2 合并后再启动 Phase 3 worktree。当前代码实际已经落地 3.1、3.2、3.3、3.5、3.6，因此下面表格只保留为历史执行计划，不再代表待办。

| Phase | Worktree 名称 | 分支 | 建议执行方式 |
|-------|-------------|------|------------|
| 3.1 | `chat-tools-split` | `feat/chat-tools-split` | 独立 Claude 实例（diff 大） |
| 3.2 | `calc-snapshot-incr` | `feat/calc-snapshot-incr` | 独立 Claude 实例（核心逻辑改动） |
| 3.3 | `wasm-lazy-load` | `feat/wasm-lazy-load` | 当前/新 Claude 实例 |
| 3.5 | `chat-history-persist` | `feat/chat-history-persist` | 独立 Claude 实例（新功能） |
| 3.6 | `capability-refactor` | `feat/capability-refactor` | 独立 Claude 实例（多消费者） |

## 下一步行动

1. ✅ **已完成** — Phase 3 的 3.1、3.2、3.3、3.5、3.6 已按当前代码状态完成同步。
2. ✅ **已完成** — 原 Phase 1-2 全部 10 项已在 2026-06-01 SDD-driven 收尾批次落地（详见上方 Done 表格）。
3. 🔲 **Settings UX 决策** — 完整 Settings IA/组件化简化仍需单独 UX 设计，当前只完成高风险修复和局部 polish。
4. ✅ **已完成** — Obsidian 手动 smoke 已于 2026-06-01 在 test vault 中通过：PR-2 6 项（语言匹配 / 来源引用 / 不知道明说 / 超长对话截断 / rerank 摘要 400 / planner tool 定义精简）+ PR-4 4 项（延迟对比 / rewrite 失败降级 / rewrite 超时降级 / 正常流程不退化）。

## 验证清单

继续实现或接受 open 项前，使用当前仓库标准验证：
1. `npx tsc -noEmit -skipLibCheck` 或 `npm run build` — 类型检查/生产构建
2. `npm test -- --runInBand` — 全量序列化测试
3. `npm run lint` — lint
4. `git diff --check` — whitespace check
5. UI/runtime 相关改动需 `make deploy` 后在 Obsidian test vault 中做对应 smoke
