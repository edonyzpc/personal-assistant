# AI Insight Foundation — 多维度完成度审计报告

**审计日期**: 2026-06-17
**审计范围**: SDD `sdd-ai-insight-foundation.md` 定义的 SPEC-D1 至 SPEC-D8 + Context 基础设施
**审计方法**: 5 个独立 agent 并行从代码层面逐行验证，覆盖功能实现、测试覆盖、UI/UX、性能四个维度
**基准代码**: master 分支 `b8885fa`

---

## 0. 总览

SDD 定义了 8 个 SPEC（D1-D8），文档中全部标记为 `[x] Implemented`。经代码级审计，实际完成度如下：

| SPEC | 功能 | 版本 | 状态 | 完整度 |
|------|------|------|------|--------|
| D1 | Heading-aware Chunking | v2.4 | **完成** | 100% |
| D2 | Pagelet VSS Integration | v2.4 | **部分完成** | 70% |
| D3 | Prompt 改进 5 项 | v2.4 | **基本完成** | 95% |
| D4 | calcSnapshot + 检索窗口 | v2.4 | **完成** | 100% |
| D5 | Context Compactor | v2.5 | **完成** | 100% |
| D6 | Context Budget | v2.5 | **部分完成** | 80% |
| D7 | Type A 用户画像 | v2.5 | **基本完成** | 90% |
| D8 | Type C Vault 元认知 | v2.5 | **完成** | 100% |
| — | Context Infrastructure | v2.4 | **基本完成** | 95% |

**总体评估**：v2.4 地基层和 v2.5 压缩+理解层的核心功能均已落地。最大的功能缺口是 D2（Pagelet VSS Integration），前台 3 个场景已接入但 Preload 和 Periodic Summary 两个场景缺失。其余缺口为设计与实现的细节偏差，不影响主体功能。

---

## 1. 功能维度

### 1.1 SPEC-D1: Heading-aware Chunking — 完成 (100%)

所有规格点均已实现，无缺口。

| 规格项 | 实现位置 | 验证结论 |
|--------|---------|---------|
| heading-aware 切割替代固定 4000 字符 | `src/vss/markdown-chunker.ts:33` `createHeadingAwareMarkdownChunks()` | 已替代，旧切割逻辑不存在 |
| heading 层级上下文保留 | `markdown-chunker.ts:100-118` `splitMarkdownIntoHeadingSections()` | H1-H6 层级栈弹栈/入栈正确 |
| `headingPath` 字段填充 | `pa-agent-runtime.ts:1544-1546` `normalizeSearchCandidates()` | 从 metadata 读取并过滤，流入 reranker prompt (`:1401`) |
| Frontmatter 保留 | `markdown-chunker.ts:74-98` | `extractFrontmatter()` + `formatFrontmatterForChunk()`，上限 1200 字符，附加到每个 chunk |
| `VSS_SCHEMA_VERSION = 2` | `src/vss/types.ts:3` | 已确认值为 2 |
| Stale v1 索引处理 | `vss.ts:439,1641,1897` | schema v1 标记为 stale，走用户确认 Prepare/Update Memory 流程 |
| Chunk metadata 策略标记 | `markdown-chunker.ts:65` | `chunkStrategy: "heading-aware-v2"` |

### 1.2 SPEC-D2: Pagelet VSS Integration — 部分完成 (70%)

**已实现：**

| 功能 | 实现位置 | 说明 |
|------|---------|------|
| VSS 语义搜索方法 | `plugin.ts:1031-1082` `findPageletRelatedNotes()` | 调用 `vss.searchHybrid()`，8s 超时，结果上限 6 条 |
| related_notes schema | `pa-review-schemas.ts:199-207` | 包含 `path/content/score/headingPath` |
| Prompt 注入 | `pa-review-schemas.ts:400-430` | 标注为 "Semantic Memory matches from the wider vault" |
| Quick Review (前台) | `plugin.ts:796-826` `createForegroundAnalyzeCallback` | 通过 `findPageletRelatedNotes()` |
| Writing Assist (前台) | 同上 | 共享前台回调路径 |
| Discover Connections (前台) | 同上 | 走 `analyzeCurrentNote()` → 前台回调 |

**缺失：**

| 场景 | 问题 | 代码位置 |
|------|------|---------|
| Background Preparation (Preload) | `createPreloadAnalyzeCallback()` 直接用 `buildPreloadPrompt()`，不调 VSS | `plugin.ts:755-794` |
| Periodic Summary | `PeriodicSummaryFlow` / `ReviewNoteGenerator` 无任何 VSS 调用 | `pagelet/PeriodicSummaryFlow.ts` |
| 死代码 | `buildDiscoveryPrompt` / `buildQuickReviewPrompt` / `buildWritingAssistPrompt` 被导出但未被调用 | `pagelet/llm/prompts.ts:137,170,206` |

**SDD vs 实际对照：**

| 场景 | SDD 要求 | 实际 |
|------|---------|------|
| Quick Review | VSS | VSS |
| Writing Assist | VSS | VSS |
| Discovery | VSS | VSS (但用通用流程，非专用 prompt) |
| Background Preparation | VSS | 无 VSS |
| Periodic Summary | VSS | 无 VSS |

### 1.3 SPEC-D3: Prompt 改进 5 项 — 基本完成 (95%)

5 项改进全部到位：

| # | 改进项 | 实现位置 | 状态 |
|---|--------|---------|------|
| 1 | 语言匹配 | `pa-agent-runtime.ts:1751` 系统提示行 | 完成 |
| 2 | 引用格式 | `pa-agent-runtime.ts:1752` 系统提示行 | 完成 |
| 3 | 坦诚不知 | `pa-agent-runtime.ts:1753` 系统提示行 | 完成 |
| 4 | 工具定义去重 | `capability-registry.ts:60-68` 注册时 + `pa-agent-runtime.ts:1458-1463` prompt 级精简 | 完成 |
| 5 | 聊天历史沙箱+限长 | `PaAgentContextProjector.ts:101-111` `<chat_history>` 标签 + `pa-agent-runtime.ts:205` `MAX_CHAT_HISTORY_CHARS = 60,000` + `escapeTaggedBoundary()` 防注入 | 完成 |

**Query-rewriter temporal 字段：**

| temporal 值 | SDD 要求 | 实现状态 |
|-------------|---------|---------|
| `recent_7d` | 支持 | 已实现 (`query-rewriter.ts:17`) |
| `recent_30d` | 支持 | 已实现 |
| `none` | 支持 | 已实现 |
| `range:YYYY-MM..YYYY-MM` | 支持 | **未实现** — `QueryTemporalIntent` 类型不包含，parser 将未知值归为 `"none"` |

Temporal 过滤链路完整：`query-rewriter.ts` → `pa-agent-runtime.ts:1322` `temporalFilterPromise` → `vss.ts:1475` `searchHybrid` → `sqlite-worker.ts:644-769` SQL WHERE 子句。

### 1.4 SPEC-D4: calcSnapshot + 检索窗口 — 完成 (100%)

**calcSnapshotIncremental**：`stats-manager.ts:746-843`

- IndexedDB 文件计数缓存 + 随机采样验证完整性
- 仅对 mtime/size 变化的文件重新读取
- batch-and-yield：桌面 50 文件/批 + 16ms yield，移动端 20 文件/批 + 50ms yield
- 缓存不可用时 fallback 到完整 `calcSnapshot()`

**检索窗口常量**：全部 8 个精确匹配 SDD 规格。

| 常量 | 旧值 | SDD 目标 | 实际值 | 位置 |
|------|------|---------|--------|------|
| `MAX_MEMORY_DOCUMENTS` | 4 | 8 | 8 | `pa-agent-runtime.ts:199` |
| `MAX_MEMORY_CHARS` | 2,000 | 4,000 | 4,000 | `:200` |
| `MAX_MEMORY_RERANK_CANDIDATES` | 6 | 12 | 12 | `:201` |
| `MAX_MEMORY_CANDIDATE_CHUNKS` | 2 | 3 | 3 | `:202` |
| `MAX_MEMORY_CANDIDATE_EXCERPT_CHARS` | 500 | 1,000 | 1,000 | `:203` |
| `MAX_CHAT_HISTORY_CHARS` | 无 | 60,000 | 60,000 | `:205` |
| `maxObservationChars` | 24,000 | 64,000 | 64,000 | `PaAgentContextBudget.ts:28` |
| `MAX_CHAT_HISTORY_TURNS` | 20 | 移除 | **已移除** | 不存在于代码中 |

### 1.5 SPEC-D5: Context Compactor — 完成 (100%)

**Micro-compaction** (`PaAgentContextCompactor.ts:30-108`)：

| 规格项 | SDD 值 | 实际值 | 说明 |
|--------|--------|--------|------|
| 触发阈值 | 70% | `DEFAULT_TRIGGER_RATIO = 0.7` | 一致 |
| 目标比例 | — | `DEFAULT_TARGET_RATIO = 0.55` | 55% 安全水位 |
| 保护最近轮次 | 2 | `DEFAULT_PROTECTED_RECENT_TURNS = 2` | 一致 |
| 压缩方向 | 从最旧开始 | 从最旧 tool result 向新方向推进 | 一致 |
| sourceRecords 保留 | 是 | `sourceRecords` 不被压缩 | 一致 |
| 压缩格式 | `[Earlier search_memory: 4 docs from ...]` | `[Earlier ${toolName} result compacted${sourcePaths}. Source metadata is still available.]` | 格式略有不同，含工具名和源路径，不含文档计数 |

**Full compaction** (`compactChatHistory()` `:110-138`)：

- 确定性摘要（非 LLM），保留最近 10 轮完整
- 旧轮次压缩为单行：用户问题 160 字符 + 助手回答 220 字符
- 摘要上限 `maxSummaryChars = 2400`
- 包裹在 `<compaction_summary context_only="true">` 标签中（`PaAgentContextProjector.ts:94-96`）

### 1.6 SPEC-D6: Context Budget — 部分完成 (80%)

**已实现** (`PaAgentContextBudget.ts`)：

| 追踪维度 | 实现 |
|----------|------|
| prompt chars | `:35-38` 累加 input + skills + toolDefs + toolObs |
| estimated tokens | `:63` `estimateTokensFromChars()` = chars / 4 |
| tool observation chars | `:41` 独立追踪 |
| observation usage ratio | `:42-44` 比率计算 |
| nearObservationLimit | `:52` 70% 阈值标志 |
| provider usage 回写 | `:57` `recordProviderUsage()`；runtime `:997` 从 model response 回写 |

常量：`DEFAULT_MAX_PROMPT_CHARS = 120,000`，`DEFAULT_MAX_OBSERVATION_CHARS = 64,000`

**缺口**：

**Budget 超限不自动触发 Compaction**。`nearObservationLimit` 被计算并写入 diagnostics，但无代码消费此标志来触发 Compactor。Micro-compaction 是 `forPrompt()` 管线的固定步骤（每次都运行），不由 Budget 动态驱动。SDD 规格 §3.7 明确要求 "当预算接近限额时，通知 Compactor 触发 micro-compaction"。

### 1.7 SPEC-D7: Type A 用户画像 — 基本完成 (90%)

**已实现**：

| 功能 | 实现位置 | 说明 |
|------|---------|------|
| 自动提取 | `type-a-extractor.ts:116-141` | regex 检测 explicit/correction 模式（中英文） |
| 置信度类型 | `type-a-extractor.ts:4-8` | `user_explicit` / `user_correction` / `inferred_behavior` / `discussed` |
| 直接写入 | `type-a-extractor.ts:127-138` | `user_explicit` 和 `user_correction` 直接生成候选 |
| `discussed` 丢弃 | `type-a-extractor.ts:69` | `mergeCandidates()` 中过滤 |
| Recurrence | `type-a-extractor.ts:99` | `RECURRENCE_THRESHOLD = 3`，跨 3 次对话确认 |
| IndexedDB 存储 | `profile-store.ts:50-138` | `IndexedDbUserProfileStore` + 内存 fallback |
| 容量上限 | `type-a-extractor.ts:39,163-165` | `PROFILE_MAX_CHARS = 1400` |
| 调度 | `extraction-scheduler.ts:103-113` | 每 8 轮提取 + 对话切换触发 + 2s 延迟 |
| 运行时集成 | `plugin.ts:656-677,1217-1222` | 启动/停止/prompt 注入/聊天轮次触发 |

**缺口**：

`inferred_behavior` 类型定义存在（rank 2）但**无提取逻辑生成**此类候选。当前实现是 local-first explicit/correction regex 提取，不调用 LLM 做行为推断。SDD §3.8.1 设计了 LLM 自动提取管线，但实际实现为纯本地 regex——这是有意的降级（见 SDD §0 closeout "local-first explicit-preference/correction extraction"），避免额外 LLM 调用。

### 1.8 SPEC-D8: Type C Vault 元认知 — 完成 (100%)

**7 个维度全部实现**（比 SDD 的 6 个多了 trends）：

| # | 维度 | 实现函数 | 数据源 | API 成本 |
|---|------|---------|--------|---------|
| 1 | 文件夹结构 | `rankFolders()` `:96` | 文件路径 | 零 |
| 2 | 标签分布 | `rankTags()` `:106` | `metadataCache` | 零 |
| 3 | 链接拓扑 | `analyzeLinks()` `:123` | `resolvedLinks` + `unresolvedLinks` | 零 |
| 4 | 写作习惯 | `analyzeWritingHabits()` `:154` | 文件 stat | 零 |
| 5 | 主题聚类 | `inferTopicClusters()` `:170` | 文件夹分组 | 零 |
| 6 | 知识空白 | `inferKnowledgeGaps()` `:184` | unresolved links (count ≥ 2) | 零 |
| 7 | 趋势 | `inferTrends()` `:197` | 最近 30 天活跃文件夹 | 零 |

**调度**：独立于 Type A。`typeCInterval` = 24h 定时刷新，vault 变化事件 5 分钟防抖，启动 15s 后首次刷新。
**存储**：内部 snapshot（`typeCWritePath` 默认 null，不写 vault 笔记）。`includeVaultInsightsInPrompt` 默认 false。
**注意**：主题聚类使用文件夹分组而非 SDD 提到的 "VSS embeddings k-means"——这是有意简化，避免额外计算成本。

### 1.9 Context 基础设施 — 基本完成 (95%)

| 组件 | 文件 | 状态 | 说明 |
|------|------|------|------|
| `PaAgentContextManager` | `context/PaAgentContextManager.ts` | 完成 | 组合 4 个 delegate，`forPrompt()` 边界，`recordProviderUsage()` |
| `PaAgentContextProjector` | `context/PaAgentContextProjector.ts` | 完成 | `projectUserInput()`、`annotateOrigins()`、injected context diffing (`previousInjectedContextKey`) |
| `PaAgentContextHygiene` | `context/PaAgentContextHygiene.ts` | 完成 | `clean()` — orphan 修复、`duplicate_skipped`/`policy_rejected` 过滤、空消息清除 |
| `PaAgentContextBudget` | `context/PaAgentContextBudget.ts` | 完成 | `snapshot()` + `recordProviderUsage()` |
| `PaAgentContextCompactor` | `context/PaAgentContextCompactor.ts` | 完成 | `microCompact()` + `compactChatHistory()` |
| Message origin 标注 | `PaAgentContextProjector.ts:54-59` | 部分 | 仅 `user`/`assistant`/`tool_result`；`host_context`/`runtime_instruction`/`compaction_summary` 嵌入文本但未作为独立 origin |
| Host context diffing | `PaAgentContextProjector.ts:35-41` | 完成 | 对 injected personal context 做 diffing，未变化时输出 `"[Personal context unchanged from previous turn]"` |

运行时集成：`pa-agent-runtime.ts:729` 实例化 ContextManager，`:1192` 调用 `forPrompt()`，`:997` 回写 provider usage。

---

## 2. 测试维度

### 2.1 核心测试文件

| 测试文件 | 行数 | 用例数 | 覆盖范围 |
|----------|------|--------|---------|
| `markdown-chunker.test.ts` | 169 | 8 | D1 heading-aware chunking |
| `pa-agent-context.test.ts` | 301 | 12 | Context Manager/Projector/Hygiene/Compactor/Budget 全栈 |
| `query-rewriter.test.ts` | 172 | 30 | D3 temporal intent + query rewrite |
| `memory-extraction.test.ts` | 390 | 14 | D7 Type A + D8 Type C + extraction scheduler |
| `vss-data-safety.test.ts` | 950+ | 20+ | temporal 过滤、schema stale 检测、brute-force |
| `chat-history-manager.test.ts` | 400+ | 15+ | history 持久化、sourceRecords 保留 |
| `pa-agent-runtime-chat-history.test.ts` | 50+ | 3+ | full compaction format |

总计 105 个测试文件，项目级测试基础设施完善。

### 2.2 各 SDD 测试要求覆盖情况

| SDD 测试要求 | 是否存在 | 覆盖质量 | 缺失场景 |
|-------------|---------|---------|---------|
| **v2.4** | | | |
| Context 限制常量默认值 | **无** | 无 | 未断言 `DEFAULT_MAX_OBSERVATION_CHARS === 64_000` 等常量值 |
| Projector `forPrompt()` 行为等价 | 有 | 基础 | 无 Phase 1 显式等价比较 |
| Projector origins 标注 | **无** | 无 | `annotateOrigins()` 零测试覆盖 |
| Hygiene 过滤/修复/清除 | 有 | 充分 | orphan 修复 vs 移除区分、连续 orphan 边界 |
| Heading-aware chunking | 有 | 充分 | 深层嵌套 heading、代码块中的 `#` 误检 |
| Query rewriter temporal | 有 | 充分 | `range:` 格式、冲突意图 |
| **v2.5** | | | |
| Micro-compaction 阈值/保护 | 有 | 充分但偏差 | 测试用 `triggerRatio: 0.1` 和 `protectedRecentTurns: 1`，非 SDD 的 0.7 和 2 |
| Full compaction 摘要+origin | 有 | 基础 | 无 origin 标注验证、大历史（50+轮）扩展 |
| Budget 追踪 | 有 | 基础 | `estimateTokensFromChars` 公式、默认值 fallback |
| Type A 置信度+存储 | 有 | 基础 | 所有测试用内存 store，无 IndexedDB seam 测试 |
| Type C 6 维度+安全 | 有 | 充分 | **无 prompt injection 防护测试**（如笔记标题含 `</vault_insights>`） |
| Memory extraction 管线 | 有 | 基础 | 端到端流程、并发提取、错误恢复 |

### 2.3 关键测试缺口

**P1 — 应补充：**
1. `annotateOrigins()` 专项测试 — 方法存在但零覆盖
2. Context 限制常量回归测试 — 防止意外修改
3. Type C prompt injection 防护测试 — vault 内容直接进入 prompt，需验证 escape

**P2 — 建议补充：**
4. Micro-compaction 用生产配置值（0.7 / 2）的测试
5. Type A IndexedDB store seam 测试
6. Budget → Compaction 联动测试（当前不存在因功能未实现）

---

## 3. 性能维度

### 3.1 评估汇总

| 关注点 | 风险等级 | 分析 |
|--------|---------|------|
| Heading-aware chunking | **无** | O(n) 线性扫描，输出有界 |
| Schema v1→v2 索引重建 | **中** | 全量 re-embed，无增量迁移路径。大 vault（千级文件）需用户等待 + 消耗 embedding API 额度 |
| Pagelet VSS 搜索延迟 | **低** | 异步 + 8s 超时 + AbortController。SQLite worker 内部 500ms deadline 控制 FTS leg |
| Context Compactor | **低** | 线性遍历 transcript，两阶段压缩效率高 |
| Memory extraction (Type A) | **低** | regex 模式匹配，仅处理新增轮次 |
| Memory extraction (Type C) | **低-中** | 每维度间 `yieldToEventLoop()` 释放主线程。`setTimeout(0)` 而非 `requestIdleCallback` |
| Context 限制扩大 | **低-中** | 最大 prompt 可达 184K chars（~46K tokens），但有 Budget 追踪和 Compactor 控制 |
| calcSnapshot 增量化 | **低** | IndexedDB 缓存 + batch-and-yield + 变更取消机制 |
| VSS brute-force 搜索 | **低（当前）** | O(n) 扫描向量缓存。万级 chunk 的超大 vault 可能需要 ANN 索引（远期） |

### 3.2 详细说明

**Schema 重建（中风险）**：`vss.ts:rebuildLocalIndex` 对全 vault 重新 chunk + embed。批量 embed（batch 8-10）+ rate-limiting（100ms 间隔）。有 `onProgress` 回调和 `ProgressBar` 进度条。无增量迁移路径——即使 schema 变更是 additive（如仅加 FTS 表），也做全量重建。`sqlite-worker.ts` 中已有 `backfillFtsIfNeeded` 模式可参考。

**Pagelet VSS**：`PAGELET_RELATED_NOTES_TIMEOUT_MS = 8000`（`plugin.ts:150`）。查询截取笔记前 2400 字符，结果上限 6 条 × 1200 字符。失败/超时 gracefully 返回空数组。

**Type C 分析**：主题聚类使用文件夹分组（非 VSS embedding k-means），零 API 成本。`yieldToEventLoop()` 用 `setTimeout(resolve, 0)` 实现，不如 `requestIdleCallback` 精确但影响小（每日仅运行一次）。

**Budget 控制**：vault insights 注入上限 40 行 / 3000 字符（`extraction-scheduler.ts:222-228`）。User profile 上限 1400 字符。Micro-compaction target 55% 安全水位。

---

## 4. UI/UX 维度

### 4.1 评估汇总

| 功能 | 状态 | 说明 |
|------|------|------|
| Memory extraction 开关 | **已实现** | `settings.ts:1877-1887` toggle 开关，默认开启 |
| Type A 用户画像查看/编辑 | **未实现** | SDD 标注"后续 UI 工作"，符合预期 |
| Type C vault insights 展示 | **未实现** | SDD 标注"后续 UI/导出能力另行设计"，符合预期 |
| 索引重建进度条 | **已有** | `ProgressBar` 类 + `onProgress` 回调，有百分比显示 |
| Schema 迁移提示 | **部分** | 仅显示通用 "Memory is not ready"，未解释 schema 升级原因 |
| Compaction 可见性 | **不可见（符合设计）** | 压缩摘要在 prompt 中，diagnostics 内部日志 |
| Pagelet related notes 展示 | **已实现** | prompt 中标注 "Semantic Memory matches"，通过 LLM 呈现给用户 |
| Pagelet VSS 加载状态 | **部分** | 超时/错误 graceful 降级，但无专门的 loading skeleton |

### 4.2 关键 UX 问题

**Schema 迁移用户沟通不足**：`getMemoryReadiness` 返回 `reason: "settings-changed"` 等结构化原因，但用户只看到 "Memory is not ready. Please prepare it first."。建议在 stale 由 schema version 变化引起时，显示具体提示（如 "索引格式已升级，需要重新构建"）。

---

## 5. 未完成任务清单

### 5.1 必须修复（与 SDD 不一致）

| # | 问题 | SPEC | 优先级 | 影响 |
|---|------|------|--------|------|
| 1 | Pagelet Preload 未接入 VSS | D2 | P2 | Background preparation 缺少跨笔记上下文 |
| 2 | Pagelet Periodic Summary 未接入 VSS | D2 | P2 | 定期摘要缺少跨笔记发现 |
| 3 | Budget 超限不自动触发 Compaction | D6 | P2 | micro-compaction 每次固定运行而非按需 |
| 4 | `inferred_behavior` 无提取逻辑 | D7 | P3 | 行为推断需 LLM 调用，当前为有意降级 |
| 5 | Query-rewriter `range:` temporal 格式未实现 | D3 | P3 | 任意日期范围查询不可用 |

### 5.2 建议改进

| # | 建议 | 维度 | 优先级 |
|---|------|------|--------|
| 6 | 补充 `annotateOrigins()` 专项测试 | 测试 | P2 |
| 7 | 补充 Context 限制常量回归测试 | 测试 | P2 |
| 8 | 补充 Type C prompt injection 防护测试 | 测试 | P2 |
| 9 | 清理死代码：3 个未使用的 Pagelet prompt builder | 代码质量 | P3 |
| 10 | Message origin 标注扩展到 `host_context`/`runtime_instruction`/`compaction_summary` | 功能 | P3 |
| 11 | Topic clustering 升级为 VSS embedding k-means | 功能 | P3 |
| 12 | Type A / Type C 查看 UI | UI/UX | P3 |
| 13 | Schema 迁移 UX：显示具体升级原因 | UI/UX | P3 |
| 14 | Micro-compaction 测试用生产配置值 | 测试 | P3 |

---

## 6. 附录

### 6.1 审计 Agent 清单

| Agent | 分析维度 | 覆盖范围 | 耗时 |
|-------|---------|---------|------|
| #1 | 功能实现 | SPEC-D1 + SPEC-D2 | ~199s |
| #2 | 功能实现 | SPEC-D3 + SPEC-D4 | ~143s |
| #3 | 功能实现 | SPEC-D5~D8 + Context 基础设施 | ~146s |
| #4 | 测试覆盖 | 全部 SPEC 测试验证 | ~185s |
| #5 | 性能 + UI/UX | 延迟/索引重建/设置UI/用户体验 | ~236s |

### 6.2 涉及的核心源文件

**Context 管理层** (`src/ai-services/context/`)：
- `PaAgentContextManager.ts` — 组合调度
- `PaAgentContextProjector.ts` — 投影 + origin + diffing
- `PaAgentContextHygiene.ts` — 清洁
- `PaAgentContextCompactor.ts` — 压缩
- `PaAgentContextBudget.ts` — 预算

**Memory 提取层** (`src/ai-services/memory-extraction/`)：
- `type-a-extractor.ts` — 用户画像提取
- `type-c-analyzer.ts` — Vault 元认知分析
- `extraction-scheduler.ts` — 调度管线
- `profile-store.ts` — IndexedDB 存储

**检索层**：
- `src/vss/markdown-chunker.ts` — heading-aware 切割
- `src/vss/sqlite-worker.ts` — temporal 过滤 + hybrid search
- `src/ai-services/query-rewriter.ts` — temporal intent
- `src/ai-services/pa-agent-runtime.ts` — 检索常量 + prompt 构建

**Pagelet 层**：
- `src/plugin.ts` — VSS related notes + extraction scheduler 集成
- `src/pagelet/pa-review-schemas.ts` — related notes schema
- `src/pagelet/llm/prompts.ts` — prompt builders（部分为死代码）

### 6.3 参考文档

- `docs/sdd-ai-insight-foundation.md` — 主 SDD
- `docs/ai-insight-improvement-analysis.md` — 方向分析 + 产品决策
- `docs/agent-context-management-research.md` — context 管理研究
- `docs/agent-memory-extraction-research.md` — memory 提取研究

---

## 7. 第一性原理 Review：距离产品目标的关键差距

### 7.1 产品目标回溯

原始目标（`ai-insight-improvement-analysis.md` 核心问题）：

> 当前 AI 的"读"能力不够有洞察力，只是浅层搜索+摘要。在让 AI "写/编辑"笔记之前，应该先提升哪些能力？

D1-D8 解决的是**管道质量**（切片、检索、上下文管理）。但"洞察力"有三个层次：

```
Level 1: 搜索准确性 — "你问什么我找什么"（RAG 基线）
Level 2: 关联发现   — "你没问但这些有关联"（主动连接）
Level 3: 理解深度   — "我理解你的思维模式和知识体系"（认知模型）
```

### 7.2 各层次实际达到的水平

| 层次 | D1-D8 前 | D1-D8 后 | 评估 |
|------|---------|---------|------|
| **Level 1 搜索准确性** | 4000 字符暴力切割、4 文档、无时间感知 | heading-aware 切割、8 文档、temporal filter、reranker 升级 | **显著提升** — 搜索准确性天花板提高，原料质量大幅改善 |
| **Level 2 关联发现** | Pagelet 靠 LLM 猜 related_notes，完全无跨笔记语义发现 | 前台 3 场景接入 VSS 语义搜索，Discover Connections 有了数据支撑 | **部分提升** — 前台已接入但 Preload/Summary 未接入，无图遍历，Discovery 无专用逻辑 |
| **Level 3 理解深度** | 对每个用户都是陌生人，不知道 vault 是什么样的 | regex 提取显式偏好（Type A），vault 结构 7 维度分析（Type C），Context Projector 管理注入 | **基础建设完成，但未激活** — Type C 分析了但默认不注入 prompt |

### 7.3 五个关键差距

#### 差距 1：Type C vault insights 未接入 prompt — 分析了但不用

`type-c-analyzer.ts` 已分析出文件夹主题、标签分布、链接拓扑、写作习惯、知识空白等 7 个维度，但 `includeVaultInsightsInPrompt` 默认 `false`（`extraction-scheduler.ts:65`），AI 对话时看不到这些信息。

**影响**：用户问"我最近在研究什么"时，AI 仍然只能靠 VSS 搜索猜测，无法说出"你的 vault 在 Research 文件夹有 47 篇笔记，最近 30 天活跃的主要是 distributed-systems 相关"。

**根因**：SDD §3.9.3 决策"默认不注入；后续如接入 prompt 需按需注入并明确 sandbox/data disclosure"。Projector 已实现注入管道（`PaAgentContextProjector.ts:120-122` `<vault_insights>` 标签 + `escapeTaggedBoundary` 防注入），但产品层面的开关未打开。

**修复路径**：将 `includeVaultInsightsInPrompt` 设为 `true`（或按场景条件触发），同时在 Settings UI 中提供可见性和关闭选项。技术管道已就绪，只需产品决策。

#### 差距 2：Type A 只捕获显式表达，无行为推断

当前 Type A 用 regex 检测 "I prefer" / "remember" / "don't" / "请记住" / "我偏好" 等显式表达（`type-a-extractor.ts:123-128`）。但真正有价值的用户画像来自行为推断：

| 信号类型 | 示例 | 当前捕获能力 |
|----------|------|-------------|
| 显式偏好 | "I prefer concise answers" | 已捕获（`user_explicit`） |
| 显式纠正 | "不是这样，应该是..." | 已捕获（`user_correction`） |
| 隐式模式 | 用户每次问完问题后都要求 "更简洁一点" | **未捕获** |
| 领域推断 | 用户 80% 的问题关于分布式系统 | **未捕获** |
| 工具偏好 | 用户从不使用某个 tool | **未捕获** |

SDD §3.8.1 设计了 `inferred_behavior` + LLM 后台提取（每 N 轮 + 对话边界触发），但实现为 local-first regex——有意降级以避免额外 LLM 调用（SDD §0 closeout 确认）。

**影响**：AI 只能记住用户明确说的话，无法从对话模式中"理解"用户。对于不会说"请记住我偏好..."的用户（大多数人），Type A 近乎无效。

**修复路径**：分两步——(a) 先做 local-first 行为统计（如对话主题词频、tool 使用频率），不需 LLM 成本但能推断领域和偏好；(b) 后续实现 LLM-based 提取（需要用户确认 UI 和 cost disclosure）。

#### 差距 3：无图感知检索 — 找到 A 不会拉入 A 链接的 B

`ai-insight-improvement-analysis.md` 方向 #2（图感知检索，价值 4/5，难度 3/5）未实现。当前搜索是点对点的：查询 → top-K chunks → 返回。但 Obsidian 的核心价值是 wikilink 网络。

**当前链路**：`query → embed → bruteForceTopK → RRF fusion → rerank → return top-8`

**缺失链路**：命中笔记 A 后，不会追踪 A 的 wikilinks 拉入 B 和 C。`metadataCache.resolvedLinks` 已提供完整链接图，Type C 也分析了链接拓扑（hub notes / orphan notes），但搜索管线没有利用这些信息做 1-hop expansion。

**影响**：对 wikilink 重度用户，AI 只能找到直接匹配的笔记，无法沿知识图谱发现间接但高度相关的笔记。这是 Obsidian 生态下的差异化能力缺失。

**修复路径**：在 `normalizeSearchCandidates()` 或 `flattenCandidateDocuments()` 后加一步 1-hop link expansion，用 `resolvedLinks` 追加关联笔记，控制 expansion 数量（如 top-3 命中各展开 2 个 link）。

#### 差距 4：主题聚类是文件夹分组，非语义聚类

SDD §3.9.1 维度 5 提到"主题集群（复用 VSS embedding）"，但 `inferTopicClusters()` 实现为纯文件夹分组（`type-c-analyzer.ts:170-182`）。

**影响**：
- 用户如果不按文件夹组织笔记（如使用平铺结构 + 标签），主题检测失效
- 跨文件夹的主题关联不可见
- 无法发现"你在 3 个不同文件夹里都写了关于同一个主题的笔记"

**基础设施就绪度**：VSS embeddings 已存在于 SQLite 向量缓存中（`sqlite-worker.ts` 的 `getOrLoadVectorCache()`），brute-force 搜索已把向量加载到内存。做 k-means 只需读取这些缓存向量，不需要额外 embedding API 调用。

**修复路径**：在 `type-c-analyzer.ts` 中实现 JS k-means（或用更简单的层次聚类），输入为已缓存的 chunk embeddings，输出为语义主题集群。每个集群用代表性笔记标题或高频词命名。

#### 差距 5：Pagelet Discovery 没有专用逻辑

"Discover Connections"（发现隐藏联系）是最体现"洞察力"的场景。但当前 Discovery 与 Quick Review 走完全相同的前台回调流程（`createForegroundAnalyzeCallback` → `buildPageletScopeReviewBundle` → `PageletReviewModel`），无专用 prompt。

`buildDiscoveryPrompt()` 是死代码（`pagelet/llm/prompts.ts:206`），它专门设计了接收 `relatedNotes` 参数并围绕"发现联系"构建 prompt 的逻辑，但从未被调用。

**影响**：用户点击 "Discover Connections" 时，得到的是一个通用 review（"2-3 one-sentence insights"），而不是"这篇笔记和 vault 中哪些笔记有隐藏联系"的深度分析。

**修复路径**：在 orchestrator 的 Discovery 路径中接入 `buildDiscoveryPrompt()`，将 VSS related notes 以结构化方式注入，引导 LLM 专注于跨笔记关联分析而非通用建议。

### 7.4 差距优先级矩阵

按"对用户感知的洞察力提升"和"实现成本"两个维度排序：

| 优先级 | 差距 | 用户感知提升 | 实现成本 | 说明 |
|--------|------|-----------|---------|------|
| **P0** | Type C insights 注入 prompt | 高 | 极低 | 开关已存在，只需产品决策 + Settings UI |
| **P1** | Discovery 专用逻辑 | 高 | 低 | `buildDiscoveryPrompt` 已存在，接线即可 |
| **P1** | 图感知检索 (1-hop expansion) | 高 | 中 | `resolvedLinks` 已可用，需设计 expansion 策略 |
| **P2** | Type A 行为统计（local-first） | 中 | 低 | 对话主题词频/tool 使用频率，不需 LLM |
| **P2** | 语义主题聚类 (k-means on embeddings) | 中 | 中 | 向量缓存已在内存，需实现 JS k-means |
| **P3** | Type A LLM 提取 | 高 | 高 | 需 LLM 调用 + cost disclosure + 确认 UI |

### 7.5 一句话总结

**管道重建完成了，但管道里流的"洞察"还是稀的。** D1-D8 把水管从 4 寸换成了 8 寸，装了过滤器和压力表，但水源（真正的语义理解和关联发现）没有本质变化。最低成本的突破口是 P0（打开已有开关）和 P1（接线已有代码），能让用户立刻感受到 AI "了解我的 vault"。
