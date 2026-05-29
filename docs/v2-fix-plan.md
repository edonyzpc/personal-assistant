# v2.0.0 代码审查修复方案

**Status:** Approved, in progress
**Source:** `docs/v2-comprehensive-code-review.md`
**Plan file mirror:** `~/.claude/plans/breezy-wiggling-gem.md`

## Context

基于 `docs/v2-comprehensive-code-review.md` 审查报告和讨论确认的决策，制定从简单到复杂的分阶段修复方案。

**不动的项：** 三层工具管线 / PolicyEngine / 双事件系统（action mode 预留）、Skill 系统基础设施（计划扩展）、LangChain 依赖（保留）、React 19（不降级）。

## 开发方法：Spec-Driven Development (SDD) + Worktree 并行

所有复杂项（Phase 3）采用 SDD 流程 + git worktree 隔离开发：
1. **写 Spec** — 设计文档落到 `docs/` 目录，作为唯一 source of truth
2. **用户确认** — Spec 文档逐份 review，确认后才开始编码
3. **Worktree 实施** — 每个 Phase 3 项目使用独立 git worktree，避免分支切换冲突
4. **验证** — 按 Spec 中的测试计划在 worktree 中验证
5. **合并** — 验证通过后从 worktree 推送 PR

### 并发开发支持

Phase 3 各项之间**无代码依赖**，可在多个 worktree 中并行开发。用户可以：
- 在当前 Claude session 中启动一个 worktree 推进某项
- **同时**启动新的 Claude 实例（在不同 terminal）接管其他 worktree 并行开发
- 各 worktree 互不干扰，PR 顺序不限

如果某个 Phase 3 项目较复杂（例如 3.1 chat-tools 拆分、3.2 calcSnapshot 增量），建议交给独立 Claude 实例处理，避免单一 session 上下文压力过大。

### Phase 3 SDD 设计文档清单

| # | 文档 | 状态 |
|---|------|------|
| 3.1 | [docs/sdd-chat-tools-split.md](./sdd-chat-tools-split.md) | ✅ 已写入 |
| 3.2 | [docs/sdd-calc-snapshot-incremental.md](./sdd-calc-snapshot-incremental.md) | ✅ 已写入 |
| 3.3 | [docs/sdd-wasm-lazy-load.md](./sdd-wasm-lazy-load.md) | ✅ 已写入 |
| 3.5 | [docs/sdd-chat-history-persistence.md](./sdd-chat-history-persistence.md) | ✅ 已写入 |
| 3.6 | [docs/sdd-required-capability-refactor.md](./sdd-required-capability-refactor.md) | ✅ 已写入 |

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

## Phase 3: 复杂项（SDD — 独立分支并行开发）

> 每项有完整 SDD 设计文档在 `docs/` 目录，确认后才开始实施。

### 3.1 chat-tools.ts 拆分（3043 行 → 6 模块）
- **SDD 文档:** [docs/sdd-chat-tools-split.md](./sdd-chat-tools-split.md)
- **核心方案:** 拆分为 6 个子模块 + barrel re-export
- **兼容策略:** 保留 `chat-tools.ts` 作为 barrel re-export，10 个消费文件无需修改
- **风险:** 中（纯重构，barrel 兜底）
- **依赖:** Phase 2.1+2.2 合并后再做

### 3.2 calcSnapshot() 增量优化
- **SDD 文档:** [docs/sdd-calc-snapshot-incremental.md](./sdd-calc-snapshot-incremental.md)
- **核心方案:** IndexedDB 文件计数缓存 + 批处理 + 基于 vault 事件的增量更新
- **风险:** 高（核心统计管线，错误增量 → 持久化错误数据）
- **独立 PR**

### 3.3 WASM 懒加载
- **SDD 文档:** [docs/sdd-wasm-lazy-load.md](./sdd-wasm-lazy-load.md)
- **核心方案:** 自定义 esbuild `lazyBinaryPlugin`，模块评估时不解码，首次使用时 `atob` 并 GC base64 字符串
- **改动范围:** 3 文件（esbuild.config.mjs / sqlite-inline-assets.ts / __mocks__/asset-string.js）
- **内存收益:** 加载时 -941KB，首次使用后稳态 -1.25MB（base64 字符串 GC）
- **风险:** 低（改动小、单一代码路径）
- **独立 PR**

### 3.4 设置页简化
- **状态:** 需单独设计（多文件，影响 UX，需 mockup）
- **不在当前批次**

### 3.5 聊天历史持久化
- **SDD 文档:** [docs/sdd-chat-history-persistence.md](./sdd-chat-history-persistence.md)
- **核心方案:** IndexedDB 三层模式（conversations + turns 两个 store），LRU prune 50 个，turn finalize 后写入
- **风险:** 中（新功能，但复用成熟模式）
- **独立 PR**

### 3.6 RequiredCapabilityClassification 重构
- **SDD 文档:** [docs/sdd-required-capability-refactor.md](./sdd-required-capability-refactor.md)
- **核心方案:** 类型扁平化 / score 统一 / CJK 双语关键词表 / phase 状态机 / 4 阶段增量迁移
- **覆盖 1.7:** 实施 3.6 后会替换 1.7 的临时 CJK 缓解措施
- **风险:** 中（多消费者，4 阶段增量迁移降低风险）
- **独立 PR**

---

## 执行顺序 & PR 策略

### Phase 1-2: 顺序执行

```
PR 1 (Phase 1): Items 1.1-1.7 — "代码审查修复: prompt/性能/质量"
  └── 可拆分: 1.4 (tsconfig strict) 单独 PR（改测试文件）

PR 2 (Phase 2.1+2.2): "Prompt token 优化: 工具定义去重 + 聊天历史沙箱"
  └── 同文件，逻辑相关

PR 3 (Phase 2.3): "Catalog 精简" — 小 PR

PR 4 (Phase 2.4): "搜索延迟优化: rewrite+embedding 并行化"
  └── 跨 2 个文件，需仔细 review 异步行为
```

### Phase 3: SDD + Worktree 并行开发

**前置条件：** Phase 1-2 合并后再开始 Phase 3（避免 rebase 冲突）。Phase 3 各项之间无代码依赖，可在独立 worktree 并行。

| Phase | Worktree 名称 | 分支 | 建议执行方式 |
|-------|-------------|------|------------|
| 3.1 | `chat-tools-split` | `feat/chat-tools-split` | 独立 Claude 实例（diff 大） |
| 3.2 | `calc-snapshot-incr` | `feat/calc-snapshot-incr` | 独立 Claude 实例（核心逻辑改动） |
| 3.3 | `wasm-lazy-load` | `feat/wasm-lazy-load` | 当前/新 Claude 实例 |
| 3.5 | `chat-history-persist` | `feat/chat-history-persist` | 独立 Claude 实例（新功能） |
| 3.6 | `capability-refactor` | `feat/capability-refactor` | 独立 Claude 实例（多消费者） |

每个 worktree 的 SDD 工作流：
1. ✅ Spec 文档已就绪（`docs/sdd-*.md`）
2. 🔲 用户确认 Spec（逐份 review）
3. 🔲 通过 EnterWorktree 创建独立 worktree
4. 🔲 按 Spec 实施 + 按测试计划验证
5. 🔲 推送 PR，合并后通过 ExitWorktree 清理

### 启动并发 Claude 实例的指引

需要并发推进时，提示用户：
> 启动一个新的 Claude session（新 terminal），输入 `恢复任务 - 实现 docs/sdd-XXX.md 的 spec，使用 worktree`，新实例会创建独立 worktree 推进该项。

## 下一步行动

1. ✅ **已完成（当前 session）** — 5 份 SDD 设计文档已写入 `docs/` 目录
2. 🔲 **用户 review** — 逐份 review SDD 文档，按需调整
3. 🔲 **实施阶段:**
   - Phase 1-2 在主分支顺序执行
   - Phase 3 用 worktree 隔离，必要时多 Claude 实例并发

## 验证清单

每个 Phase/PR 完成后：
1. `tsc -noEmit -skipLibCheck` — 类型检查
2. `npm test` — 全量测试
3. `npm run build` — 生产构建
4. `npm run audit:bundle` — bundle 大小检查
5. 手动在测试 vault 中运行 AI Chat，验证核心功能不退化
