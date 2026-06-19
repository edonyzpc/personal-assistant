# AI Insight 激活 — SDD 驱动开发方案

**创建日期**: 2026-06-17
**版本归属**: v2.5
**方案来源**: `docs/ai-insight-activation-plan.md`（产品决策 AD-1~AD-5）
**开发模式**: SDD 驱动 + Worktree 并发（沿用 `v2-post-release-spec-driven-development.md` 流程）

> **2026-06-19 状态说明**：本文件是 E-series AI Insight Activation 的历史执行计划。SPEC-E1~E6 已在主 tracker 中标记为 implemented；当前状态以 `docs/v2-post-release-spec-driven-development.md` 和 `docs/development-roadmap.md` 为准。下方原 Ready / Drafting 状态已转换为 implemented/historical，避免与发布前 tracker 冲突。

---

## 1. SPEC 划分

Activation plan 的 10 个 work item 按 SDD 需求和文件依赖划分为 **6 个 SPEC**：

| SPEC | 标题 | 来源 | 需要独立 SDD？ | Phase |
|------|------|------|---------------|-------|
| SPEC-E1 | Vault Insights 激活 + Discovery 专用流程 | P1-A + P1-B | 否（改动已在 activation plan 中充分描述） | Phase 1 |
| SPEC-E2 | 图感知检索 | P2-A | **是**（AD-2 明确要求独立设计） | Phase 2 |
| SPEC-E3 | Pagelet VSS 全场景覆盖 | P2-B | 否（SDD D2 的补齐，改动明确） | Phase 2 |
| SPEC-E4 | Budget→Compaction 联动 + 测试补齐 | P2-C + P2-D | 否（小改动 + 测试） | Phase 2 |
| SPEC-E5 | Type A LLM 后台提取 | P3-A | **是**（LLM prompt 设计 + cost 控制 + fallback） | Phase 3 |
| SPEC-E6 | 语义聚类 + temporal range + 死代码清理 | P3-B + P3-C + P3-D | 否（P3-B 设计已在 activation plan §5.2 充分描述） | Phase 3 |

### 1.1 SPEC 划分依据

**合并原则**：文件依赖重叠且无法并行的 item 合入同一 SPEC。

- **E1 = P1-A + P1-B**：都改 `plugin.ts`，且 P1-B 依赖 P1-A 暴露的 `PageletHost.findRelatedNotes`。总计 2 天，拆分两个 worktree 的 overhead 不值得。
- **E4 = P2-C + P2-D**：P2-C 改 `context/` 层，P2-D 写 `__tests__/`，无冲突但都是小改动（1.5 天），合并减少管理开销。P2-D 的测试可顺便覆盖 P2-C 的改动。
- **E6 = P3-B + P3-C + P3-D**：P3-C（0.5 天）和 P3-D（0.5 天）太小不值得独立 worktree。P3-B 主要改 `vss/` 和 `memory-extraction/type-c-analyzer.ts`，与 P3-C（`query-rewriter.ts`）和 P3-D（`pagelet/llm/prompts.ts`）无文件冲突。

**独立原则**：有独立 SDD 需求的、或文件改动面广需要隔离的 item 独立为 SPEC。

- **E2 独立**：AD-2 明确要求独立方案设计。改动集中在 `pa-agent-runtime.ts` 搜索管线，与其他 SPEC 不重叠。
- **E3 独立**：改 Pagelet 层（`PeriodicSummaryFlow.ts`、`ReviewNoteGenerator.ts`），与 E2（runtime 层）和 E4（context 层）无冲突。
- **E5 独立**：LLM 提取是全新能力，需要 prompt 设计、cost 控制、fallback 策略。改动集中在 `memory-extraction/` 层。

---

## 2. Worktree 并发设计

### 2.1 文件冲突矩阵

`plugin.ts` 是所有 SPEC 的交汇点，但各 SPEC 改动的函数/区域不重叠：

| SPEC | `plugin.ts` 改动区域 | 其他主要文件 | 冲突风险 |
|------|---------------------|-------------|---------|
| E1 | `syncMemoryExtractionRuntime()` + `createPageletHost()` | `settings.ts`, `pagelet/orchestrator.ts`, `pagelet/panel/` | 低 |
| E2 | 暴露 `resolvedLinks` 接口 | `pa-agent-runtime.ts` | 低 |
| E3 | `createPreloadAnalyzeCallback()` | `pagelet/PeriodicSummaryFlow.ts`, `pagelet/output/` | 低 |
| E4 | 无 | `context/PaAgentContextManager.ts`, `context/PaAgentContextCompactor.ts`, `__tests__/` | 无 |
| E5 | 向 scheduler 传入 `createChatModel`（与 E1 共享 `syncMemoryExtractionRuntime` 构造块） | `memory-extraction/type-a-extractor.ts`, `memory-extraction/extraction-scheduler.ts` | **中**（与 E1 共享 scheduler 构造块 `plugin.ts:659-664`，需 rebase） |
| E6 | 暴露 clustering 能力（挂在 `TypeCVaultMetacognitionAnalyzer`，不改 scheduler 构造函数） | `vss/sqlite-worker*.ts`, `memory-extraction/type-c-analyzer.ts`, `query-rewriter.ts` | 低 |

> **Review 修正 [A1]**：E6 的 clustering 能力通过 `TypeCVaultMetacognitionAnalyzer`（已在 scheduler 内实例化）传递，不修改 `MemoryExtractionSchedulerOptions` 构造函数，避免与 E5 在 `extraction-scheduler.ts` 的冲突。
>
> **Review 修正 [A4]**：E5 `plugin.ts` 风险从"低"升为"中"，因为 E1 和 E5 都修改 `syncMemoryExtractionRuntime()` 中 `MemoryExtractionScheduler` 构造调用（`plugin.ts:659-664`，同一 6 行代码块）。E5 在 E1 merge 后执行，需 rebase 到 E1 的构造参数基线。

结论：**E2/E3/E4 可完全并行**（改不同层）；**E5/E6 可完全并行**（改不同子系统）。`plugin.ts` 的合并冲突可通过 sequential merge 解决。

### 2.2 Worktree Map

```
master ─── E1: sequential on master ────────────────────────────────────┐
           (P1-A + P1-B, ~2-3d)                                        │
                                                                        │ merge E1 → master
           ┌── WT-E2: feat/graph-aware-retrieval ──────────┐            │
           │   (P2-A, ~3-4d, 需独立 SDD)                    │            │
           │                                                │            │
master ────┼── WT-E3: feat/pagelet-vss-coverage ───────────┤── merge ───┤
           │   (P2-B, ~2d)                                  │  E4→E3→E2 │
           │                                                │            │
           └── WT-E4: feat/budget-compaction-tests ────────┘            │
               (P2-C + P2-D, ~1.5d)                                     │
                                                                        │ merge → master
           ┌── WT-E5: feat/type-a-llm-extraction ─────────┐            │
           │   (P3-A, ~5d, 需独立 SDD)                     │            │
master ────┤                                                ├── merge ──┘
           └── WT-E6: feat/semantic-clustering-cleanup ────┘  E6→E5
               (P3-B + P3-C + P3-D, ~4d)
```

### 2.3 并发时序图

```
Week 1          Week 2          Week 3          Week 4
─────────────── ─────────────── ─────────────── ───────
E1 on master
██████ (2-3d)
  merge ↓
                WT-E2 ──────────────
                ████████████ (3-4d)
                WT-E3 ────────
                ████████ (2d)
                WT-E4 ──────
                ██████ (1.5d)
                      merge E4→E3→E2 ↓
                                    WT-E5 ──────────────────
                                    ████████████████ (5d)
                                    WT-E6 ──────────────
                                    ████████████ (4d)
                                                merge E6→E5 ↓
                                                            smoke + release
```

**关键路径**：E1 → E2 → E5 → smoke = 2 + 4 + 5 + 2 = ~13 天
**并行收益**：E3/E4 与 E2 并行省 ~3.5 天；E6 与 E5 并行省 ~4 天

---

## 3. SPEC 详情与 SDD 需求

### 3.1 SPEC-E1: Vault Insights 激活 + Discovery 专用流程

| 属性 | 值 |
|------|-----|
| 状态 | `[x]` Implemented（historical: activation plan §3.1 + §3.2 曾作为 ready design） |
| SDD | 无需独立 SDD，`ai-insight-activation-plan.md` §3 即为设计文档 |
| 分支 | sequential on master |
| 估时 | 2-3 天 |
| 改动文件 | `settings.ts`, `plugin.ts`, `locales/plugin/`, `pagelet/orchestrator.ts`, `pagelet/panel/PanelLayouts.ts` |
| 依赖 | 无 |
| Exit gate | `make deploy` + vault insights 出现在对话中 + Discovery 返回 connections/gaps/insights + `PageletHost.findRelatedNotes` 签名已定义并导出 |

> **Review 修正 [A2]**：E1 exit gate 必须包含 `PageletHost.findRelatedNotes()` 的完整签名定义（参数类型 + 返回类型），因为 E3 和 E6 依赖此接口。E1 merge 后此签名作为 E3/E6 的稳定合约。
>
> **Review 修正 [U1]**：E1 实现时需新增 vault insights 首次启用的 onboarding Notice（类似现有 `PAGELET_BACKGROUND_PREPARATION_NOTICE_KEY` 模式），告知用户 "PA now shares your vault structure with the AI to improve answers. Disable in Settings > Memory."
>
> **Review 修正 [U2]**：`discoverConnections()` 需检查 VSS ready，不可用时在 discover panel 显示引导信息 "Enable Memory to discover semantic connections" 而非静默 fallback。

### 3.2 SPEC-E2: 图感知检索

| 属性 | 值 |
|------|-----|
| 状态 | `[x]` Implemented（historical: AD-2 曾要求独立 SDD） |
| SDD | 已完成：`docs/sdd-graph-aware-retrieval.md` |
| 分支 | `feat/graph-aware-retrieval` (worktree) |
| 估时 | SDD 1 天 + 实现 2-3 天 = 3-4 天 |
| 改动文件 | `pa-agent-runtime.ts`, `plugin.ts` |
| 依赖 | SPEC-E1 merge 后（需 master 上的 PageletHost 接口） |
| Exit gate | `make deploy` + 搜索命中笔记的 wikilink 目标出现在结果中 + 展开笔记 score 衰减 |

**SDD 需覆盖的设计问题**（从 activation plan §4.1 提取）：

1. 展开方向（outbound / backlink / both）
2. 展开深度（1-hop / configurable）
3. 候选膨胀控制（数量上限、score 衰减策略、与 reranker 交互）
4. 展开笔记内容来源（VSS chunks / vault read）
5. 搜索管线插入点
6. 对 Pagelet `findPageletRelatedNotes()` 的影响
7. 性能预算（延迟上限、移动端影响）
8. **[Review P3]** 非 LLM 搜索阶段总延迟预算 ≤ 2s（含 expansion）。`resolvedLinks` in-memory 查找快，但 chunk 内容获取若需 VSS worker round-trip 约 50-200ms，需控制

### 3.3 SPEC-E3: Pagelet VSS 全场景覆盖

| 属性 | 值 |
|------|-----|
| 状态 | `[x]` Implemented（historical: activation plan §4.2 曾作为 ready design） |
| SDD | 无需独立 SDD，是 SPEC-D2 的补齐 |
| 分支 | `feat/pagelet-vss-coverage` (worktree) |
| 估时 | 2 天 |
| 改动文件 | `plugin.ts` (preload callback), `pagelet/PeriodicSummaryFlow.ts`, `pagelet/output/ReviewNoteGenerator.ts` |
| 依赖 | SPEC-E1 merge 后（需 `PageletHost.findRelatedNotes`） |
| Exit gate | `make deploy` + Preload 结果包含 related notes + Periodic Summary 包含跨笔记引用 |

### 3.4 SPEC-E4: Budget→Compaction 联动 + 测试补齐

| 属性 | 值 |
|------|-----|
| 状态 | `[x]` Implemented（historical: activation plan §4.3 + §4.4 曾作为 ready design） |
| SDD | 无需独立 SDD |
| 分支 | `feat/budget-compaction-tests` (worktree) |
| 估时 | 1.5 天 |
| 改动文件 | `context/PaAgentContextManager.ts`, `context/PaAgentContextCompactor.ts`, `__tests__/pa-agent-context.test.ts`, `__tests__/memory-extraction.test.ts` |
| 依赖 | 无（context 层独立于 E1/E2/E3） |
| Exit gate | `make deploy` + 4 个新测试文件通过 + Budget nearObservationLimit 触发二次压缩 |

### 3.5 SPEC-E5: Type A LLM 后台提取

| 属性 | 值 |
|------|-----|
| 状态 | `[x]` Implemented（historical: 曾需 SDD 细化 LLM prompt + cost + fallback） |
| SDD | 已完成：`docs/sdd-type-a-llm-extraction.md` |
| 分支 | `feat/type-a-llm-extraction` (worktree) |
| 估时 | SDD 1 天 + 实现 4 天 = 5 天 |
| 改动文件 | `memory-extraction/type-a-extractor.ts`, `memory-extraction/extraction-scheduler.ts`, `plugin.ts`, `locales/plugin/` |
| 依赖 | SPEC-E2/E3/E4 merge 后（避免与 Phase 2 worktree 冲突） |
| Exit gate | `make deploy` + `inferred_behavior` 记录出现 + LLM 不可用时 fallback 到 regex + Settings 关闭后无 LLM 调用 |

**SDD 需覆盖的设计问题**（从 activation plan §5.1 提取）：

1. Extraction prompt 完整设计（system + user prompt、输出 JSON schema）
2. 每次提取的输入截断策略（最近 N 轮，多少 tokens）
3. Model 选择（chatModel vs policyModel、temperature）
4. **[Review U3 must-fix]** Cost disclosure 文案：当前 i18n Notice 说 "Data is stored locally"，切换到 LLM 后**必须**明确告知有 API 调用。更新 `plugin.memoryExtraction.enabledNotice` 和 `plugin.memoryExtraction.settings.enabled.desc`
5. Fallback 策略（LLM 失败/超时/禁用 → regex）
6. 与现有 regex `extractCandidatesFromText()` 的共存方式
7. IndexedDB schema 兼容（是否需要 migration）
8. **[Review P4]** 移动端 idle guard：`extraction-scheduler.ts` 当前无 `Platform.isMobile` / `visibilitychange` 感知。E5 需在 LLM 调用前检查 `document.visibilityState !== 'hidden'`（移动端后台时跳过/延迟提取）
9. **[Review U4]** Type A LLM 调用的 cost tracking：接入现有 `PageletCostTracker` 或新建独立的 extraction cost 追踪，确保用户有费用可见性

### 3.6 SPEC-E6: 语义聚类 + temporal range + 死代码清理

| 属性 | 值 |
|------|-----|
| 状态 | `[x]` Implemented（historical: activation plan §5.2/5.3/5.4 曾作为 ready design） |
| SDD | 无需独立 SDD |
| 分支 | `feat/semantic-clustering-cleanup` (worktree) |
| 估时 | 4 天 |
| 改动文件 | `vss/sqlite-worker-protocol.ts`, `vss/sqlite-worker.ts`, `vss.ts`, `memory-extraction/type-c-analyzer.ts`, `query-rewriter.ts`, `pa-agent-runtime.ts`, `pagelet/llm/prompts.ts` |
| 依赖 | SPEC-E1 merge 后（Type C insights 需开启才有意义） |
| Exit gate | `make deploy` + Topic Clusters 显示语义集群 + `range:` temporal 生效 + 死代码删除 + jest 通过 |

> **Review 修正 [A1]**：E6 的 clustering 能力通过 `TypeCVaultMetacognitionAnalyzer` 传递（该实例已在 `extraction-scheduler.ts:67` 创建），不新增 `MemoryExtractionSchedulerOptions` 参数，避免与 E5 在 scheduler 构造函数的冲突。
>
> **Review 修正 [P5]**：移动端 chunk-count guard：当 `chunkCount > 15000` 且 `Platform.isMobile` 时，跳过 worker 内 k-means 聚类，fallback 到 folder-based 分组。避免在移动端 WebView 100-200MB worker 内存限制下 ~40MB 向量缓存上运行密集计算。

---

## 4. SDD 编写优先级

两个 SPEC 需要独立 SDD，应在实现前完成：

| SDD | SPEC | 编写时机 | 估时 |
|-----|------|---------|------|
| `sdd-graph-aware-retrieval.md` | E2 | E1 实现期间并行编写 | 1 天 |
| `sdd-type-a-llm-extraction.md` | E5 | Phase 2 worktree 开发期间并行编写 | 1 天 |

**SDD 编写不在关键路径上**：E2 SDD 在 E1 实现时并行写；E5 SDD 在 Phase 2 worktree 开发时并行写。

---

## 5. 开发节奏

### 5.1 推荐执行序列

```
Day 1-2:   E1 on master（激活）
           ∥ 并行：编写 E2 SDD (sdd-graph-aware-retrieval.md)
Day 2:     E1 merge → master
           E2 SDD review
Day 3-4:   WT-E2 开发（图感知检索）
           ∥ WT-E3 开发（Pagelet VSS 覆盖）
           ∥ WT-E4 开发（Budget 联动 + 测试）
Day 5:     E4 merge → E3 merge → E2 merge → master
           ∥ 并行：编写 E5 SDD (sdd-type-a-llm-extraction.md)
Day 6:     E5 SDD review
Day 7-10:  WT-E5 开发（Type A LLM 提取）
           ∥ WT-E6 开发（语义聚类 + temporal + 清理）
Day 11:    E6 merge → E5 merge → master
Day 12-13: Obsidian smoke + dogfooding + fix
Day 14:    v2.5 release candidate
```

### 5.2 SPEC 状态流转（历史）

每个 SPEC 严格遵循项目的 delivery loop：

```
Draft → Ready → review → Approved → Implementing → test → code review → make deploy → Smoke → Done
```

| SPEC | 当前状态 | 下一步 |
|------|---------|--------|
| E1 | `[x]` Implemented | 历史计划已完成；发布状态看 `development-roadmap.md` |
| E2 | `[x]` Implemented | 历史计划已完成；发布状态看 `development-roadmap.md` |
| E3 | `[x]` Implemented | 历史计划已完成；发布状态看 `development-roadmap.md` |
| E4 | `[x]` Implemented | 历史计划已完成；发布状态看 `development-roadmap.md` |
| E5 | `[x]` Implemented | 历史计划已完成；发布状态看 `development-roadmap.md` |
| E6 | `[x]` Implemented | 历史计划已完成；发布状态看 `development-roadmap.md` |

---

## 6. SPEC Index 更新（追加到 v2-post-release-spec-driven-development.md）

以下条目是 E-series 起草时的历史 SPEC Index 草案；当前状态以
[`v2-post-release-spec-driven-development.md`](./v2-post-release-spec-driven-development.md)
为准，不再把本代码块作为 release tracker。

```markdown
| SPEC-E1 | Vault Insights 激活 + Discovery 专用流程 | historical draft | v2.5 | SPEC-D8 | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §3 | `settings.ts`, `plugin.ts`, `pagelet/orchestrator.ts`, `pagelet/panel/` | vault insights 注入 prompt + Discovery 返回 connections/gaps/insights |
| SPEC-E2 | 图感知检索 (1-hop link expansion) | historical draft | v2.5 | SPEC-E1 | [`sdd-graph-aware-retrieval.md`](./sdd-graph-aware-retrieval.md) | `memory-search-tool.ts`, `pa-agent-runtime.ts` | 搜索命中笔记的 wikilink/backlink 目标经 VSS chunk fetch 后出现在候选中 |
| SPEC-E3 | Pagelet VSS 全场景覆盖 | historical draft | v2.5 | SPEC-E1 | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §4.2 | `plugin.ts`, `pagelet/PeriodicSummaryFlow.ts`, `pagelet/output/` | Preload + Periodic Summary 包含跨笔记 VSS 上下文 |
| SPEC-E4 | Budget→Compaction 联动 + 测试补齐 | historical draft | v2.5 | None | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §4.3-4.4 | `context/*`, `__tests__/*` | Budget 超限触发二次压缩 + 4 类新测试通过 |
| SPEC-E5 | Type A LLM 后台提取 | historical draft | v2.5 | SPEC-E1 | [`sdd-type-a-llm-extraction.md`](./sdd-type-a-llm-extraction.md) | `memory-extraction/*`, `plugin.ts` | inferred_behavior 候选出现 + malformed/failed LLM fallback + cost disclosure |
| SPEC-E6 | 语义聚类 + temporal range + 死代码清理 | historical draft | v2.5 | SPEC-E1 | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §5.2-5.4 | `vss/*`, `memory-extraction/type-c-analyzer.ts`, `query-rewriter.ts` | Topic Clusters 语义化 + range: temporal + 死代码删除 |
```

---

## 7. Merge 顺序与冲突管理

### 7.1 Merge 顺序

Phase 内各 worktree merge 到 master 的顺序按**文件冲突最小化**原则：

**Phase 2**：E4 → E3 → E2
- E4 先 merge（仅改 `context/` + `__tests__/`，零冲突）
- E3 再 merge（改 `plugin.ts` preload 区域 + `pagelet/`，与 E4 无冲突）
- E2 最后 merge（改 `plugin.ts` resolvedLinks + `pa-agent-runtime.ts`，与 E3 在 `plugin.ts` 可能有小冲突但区域不重叠）

**Phase 3**：E6 → E5
- E6 先 merge（改 `vss/` + `type-c-analyzer` + `query-rewriter.ts` + `prompts.ts`）
- E5 后 merge（改 `type-a-extractor` + `extraction-scheduler`，与 E6 在 `extraction-scheduler.ts` 可能有小冲突但改动函数不同）

### 7.2 `plugin.ts` 冲突预防

`plugin.ts` 是 6 个 SPEC 中 5 个都涉及的文件。冲突预防策略：

1. **E1 on master**：先 merge，为后续 SPEC 建立 `PageletHost.findRelatedNotes` 基线
2. **Phase 2 三个 worktree**：各自改 `plugin.ts` 的不同函数，sequential merge 时冲突局限于 import 行
3. **Phase 3 两个 worktree**：E5 改 `syncMemoryExtractionRuntime`（scheduler 参数），E6 改 clustering 暴露接口。不同区域。

---

## 8. SDD 清单（历史）

| SDD 文件 | SPEC | 内容要求 | 何时编写 | 阻塞 |
|----------|------|---------|---------|------|
| `docs/sdd-graph-aware-retrieval.md` | E2 | 展开方向/深度/膨胀控制/插入点/性能预算（8 个设计问题，含 [P3] 非 LLM 延迟 ≤ 2s） | 已完成 | 历史阻塞已解除 |
| `docs/sdd-type-a-llm-extraction.md` | E5 | Prompt 设计/截断/model/cost disclosure/fallback/schema 兼容/移动端 guard/cost tracking（9 个设计问题，含 [U3][P4][U4]） | 已完成 | 历史阻塞已解除 |

---

## 9. Review 记录

### 2026-06-17 三维度 Review

**Reviewer**: 3 个独立 Explore agent（架构 / 产品+UX / 性能），基于代码级验证

| # | 来源 | 维度 | 严重度 | 发现 | 处置 |
|---|------|------|--------|------|------|
| A1 | 架构 | E5/E6 冲突 | 烦人 | E6 clustering 若改 scheduler 构造函数则与 E5 冲突 | **已修正**：E6 通过 `TypeCVaultMetacognitionAnalyzer` 传递 clustering 能力（§3.6 + §2.1） |
| A2 | 架构 | E1→E3 合约 | 烦人 | E1 暴露的 `findRelatedNotes` 签名是 E3 硬依赖 | **已修正**：E1 exit gate 增加签名定义要求（§3.1） |
| A4 | 架构 | E1→E5 冲突 | 需注意 | E1/E5 共享 `syncMemoryExtractionRuntime` 构造块 | **已修正**：冲突矩阵 E5 风险升为"中"（§2.1） |
| U1 | 产品 | Vault insights onboarding | should-fix | 默认开启但无解释 Notice | **已修正**：E1 增加 onboarding Notice 要求（§3.1） |
| U2 | 产品 | Discovery VSS 不可用 UX | should-fix | 静默 fallback 无引导 | **已修正**：E1 增加 discover panel 引导信息要求（§3.1） |
| U3 | 产品 | Type A LLM consent 文案 | **must-fix** | 当前说 "locally" 但改为 LLM 后有 API 调用 | **已修正**：E5 SDD 设计问题 #4 标为 must-fix（§3.5） |
| U4 | 产品 | Type A LLM cost tracking | should-fix | 后台 LLM 调用无费用追踪 | **已修正**：E5 SDD 设计问题新增 #9（§3.5） |
| U5 | 产品 | Settings 复杂度 | nice-to-have | 已有 23 toggles | 不修改方案，新 toggle 放现有 section |
| P1 | 性能 | injected context 长度控制 | 可接受 | 当前通过 vault insights 摘要上限、tag boundary escaping、Budget diagnostics 控制 prompt 长度；Projector diffing 未实现 | 已同步为当前实现口径 |
| P2 | 性能 | Discovery 延迟 | 警告 | VSS 搜索 + LLM = 3-8s | 不修改方案，已有 Pet 动画 + analysis-start/done 状态机 |
| P3 | 性能 | Graph expansion 延迟 | 警告 | 需控制非 LLM 阶段 ≤ 2s | **已修正**：E2 SDD 设计问题新增 #8（§3.2） |
| P4 | 性能 | Type A 移动端无 idle guard | 警告 | scheduler 无 visibilitychange 感知 | **已修正**：E5 SDD 设计问题新增 #8（§3.5） |
| P5 | 性能 | 语义聚类移动端内存 | 警告 | 10K chunks × 1024d = ~40MB | **已修正**：E6 增加 mobile chunk-count guard（§3.6） |
| P6 | 性能 | 累积 prompt ~130K chars | 可接受 | 128K token 模型基线内（~25%） | 无需修改，Budget + Compactor 控制 |
