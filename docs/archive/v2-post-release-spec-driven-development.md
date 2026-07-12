# v2 Post-Release SPEC-Driven Development

## Purpose

This tracker drives SPEC-first implementation of the 8 SDDs split out of the v2.1.2 review. Use [`v2.1.2-decisions.md`](./v2.1.2-decisions.md) as the frozen decision contract. Use this tracker to record approval gates, phase status (per release window v2.2 / v2.3 / v2.4 / v2.5), review records, verification evidence, and Obsidian smoke closeout for each SPEC-A* slice.

No runtime code should be changed under a SPEC until that SPEC is reviewed and marked `[A] Approved for implementation`.

## Source Relationship

| Document | Role | Conflict Rule |
| --- | --- | --- |
| [`v2.1.2-comprehensive-review.md`](./v2.1.2-comprehensive-review.md) | Frozen review snapshot (2026-06-01); contains the 5 decisions, 8 review dimensions, P0 list, and §8 driver fix. | Decisions in this snapshot are immutable; if real implementation diverges, record an Addendum here, do not edit the review. |
| [`v2.1.2-decisions.md`](./v2.1.2-decisions.md) | Frozen decision record indexing all 5 original decisions + Q1-Q8 拍板 + P0 list. | This is the contract source of truth for "what to build and when". This tracker must stay synchronized with it. |
| Root `./sdd-*.md` + archived `./archive/sdd-*.md` | Per-SPEC implementation specs. Active SDDs stay in root; completed historical SDDs move to archive. | Each SDD owns runtime detail; this tracker indexes status only. |
| Memory `[[v2-release-schedule]]` | v2.x version cadence (≥ 5 minor + 6 month gates). | This tracker references the schedule; cadence changes update both together. |

## Status Legend

| Mark | Meaning |
| --- | --- |
| `[ ]` | Todo |
| `[D]` | Drafting |
| `[R]` | Ready for review |
| `[A]` | Approved for implementation |
| `[~]` | Implementing |
| `[T]` | Triggered evaluation only — placeholder, no implementation until trigger fires |
| `[V]` | Review in progress |
| `[S]` | Obsidian smoke in progress |
| `[x]` | Done |
| `[!]` | Blocked |

## SPEC Approval Gates

A SPEC may move to `[R] Ready for review` only when all of these are true:

- Decision references in [`v2.1.2-decisions.md`](./v2.1.2-decisions.md) have been checked for drift.
- Implementation file:line references in the SDD have been re-grepped against the current `master` (line numbers in v2.1.2 may have shifted).
- The SDD lists implementation boundaries, expected code/test areas, non-goals, and verification commands.
- Acceptance checklist covers product behavior, runtime behavior, negative assertions, and verification commands.
- Risks have an owner and a closure condition.

A SPEC may move to `[A] Approved for implementation` only after review records:

- reviewer (subagent or human),
- date,
- result (approved / request changes),
- blocking findings and disposition,
- deferred items with owner, reason, unblock condition.

Runtime implementation must not begin while the owning SPEC is `[D]`, `[R]`, or `[!]`.
`[T]` SPECs do not begin implementation; they wait for trigger conditions documented in the SDD.

## Required Delivery Loop

Every implementation SPEC follows the repository refactor loop:

```mermaid
flowchart LR
  Spec["SPEC draft"]
  SpecReview["SPEC review"]
  Dev["dev"]
  Test["test"]
  CodeReview["review"]
  Fix["fix"]
  Deploy["make deploy"]
  Smoke["Obsidian smoke test"]
  SmokeFix["fix"]
  Done["done"]

  Spec --> SpecReview --> Dev --> Test --> CodeReview --> Fix --> Deploy --> Smoke --> SmokeFix --> Done
  Fix --> Test
  SmokeFix --> Deploy
```

Loop rules:

- SPEC review must happen before runtime implementation starts.
- Runtime/UI phases must use subagent review when available; if unavailable, record the skip reason and residual risk.
- Runtime/UI phases require automated tests, `make deploy`, and real Obsidian test-vault smoke before completion.
- Docs-only phases may skip Obsidian smoke, but the skip and residual risk must be recorded.
- SPEC status changes must update Current Status, SPEC Index, Phase Ledger, Review Log, and Verification Log together.
- `[T]` SPECs do not enter the loop until trigger conditions in their SDD are met; trigger event is recorded in the Review Log.

## Current Status

| Field | Value |
| --- | --- |
| Created | 2026-06-01 |
| Decision contract source | [`v2.1.2-decisions.md`](./v2.1.2-decisions.md) |
| Current stage | A-series: SPEC-A0~A7 全部 `[x] Done`; SPEC-A8/A9 `[T]`。B-series: SPEC-B1 `[x]`; SPEC-B2 superseded by v2.7 release; SPEC-B3 `[x]` (dataview + templater); SPEC-B4 `[x]`; SPEC-B5 `[x]` (866 行 accepted)。C-series: SPEC-C1 `[x]` Done (C1-P1~P5 + review fixes); SPEC-C2 `[ ]` deferred (产品设计未明确)。D-series: SPEC-D1~D8 `[x]` implemented 2026-06-16。E-series: SPEC-E1~E6 `[x]` implemented 2026-06-17 + 16 post-merge fixes。v2.2~v2.6 跳过正式发布，v2.7 做合并 release。Execution roadmap: [`development-roadmap.md`](./development-roadmap-v2.7.md)。 |
| Runtime code changes in this pass | Review remediation: PA Agent history sandboxing, VSS search abort/rewrite safety, Obsidian Operations v1A capability invariant enforcement, chat setup banner refresh on settings save, and release/changelog/doc consistency fixes. |
| Open contract decisions | None. All 5 original decisions + Q1-Q8 拍板 are frozen in the decision record. |
| Blocked implementation areas | SPEC-A8/A9 (triggered). |
| Next required action | (1) v2.7 合并 release: Provider OQ002 矩阵验证 + Pagelet smoke checklist + manifest 版本号对齐 + CHANGELOG/Release Notes 编写。iOS 真机 smoke 已有 2026-06-19 iPhone Mirroring 证据，带 Pagelet final confirm/save caveat。(2) A1 follow-up: Manual-CN.md mirror + onboarding screenshots (non-blocking)。 |

## SPEC Index

| SPEC | Goal | Status | Phase | Depends On | SDD File | Primary Areas | Exit Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-A0 | Freeze v2.1.2 review + author decision record + tracker | `[x]` Done | v2.1.2 (closeout) | None | (this file + [`v2.1.2-decisions.md`](./v2.1.2-decisions.md) + [`v2.1.2-comprehensive-review.md`](./v2.1.2-comprehensive-review.md)) | Docs | Review frozen, decisions immutable, tracker exists, all 8 SDDs cross-linked. |
| SPEC-A1 | Chat onboarding 链路(P0 #1+#2+#4) | `[x]` Done @`6ed1ea8`/`db0db7b`/`b251962`(smoke pass 2026-06-01) | v2.2 批 1 | SPEC-A0 | [`sdd-chat-onboarding-flow.md`](./sdd-chat-onboarding-flow.md) | `./src/plugin.ts` ribbon(left=chat,right=modal)、`./src/chat/chat-view.ts` empty state(setupIssue banner)、`./src/custom.pcss` `.pa-chat-config-banner`、`README.md` "AI Chat in 60 seconds"、`Manual.md` AI Chat chapter | ✅ Ribbon 直达 chat、空状态 banner 引导配置、README + Manual Chat 章节齐备。Manual-CN.md 镜像 + onboarding 截图 follow-up 非阻塞。 |
| SPEC-A2 | 命令面板清理(P0 #8) | `[x]` Done @`b2696f8`(merged `4a730f5` 2026-06-15) | v2.2 批 2 | SPEC-A0 | [`sdd-command-palette-cleanup.md`](./sdd-command-palette-cleanup.md) | `./src/plugin.ts` `addCommand` 注册、`./src/settings.ts` toggle | ✅ Featured Images `editorCheckCallback` gate `aiProvider === 'qwen'`;Memory advanced 已被 `showAdvancedMemoryControls` toggle 守卫(验证通过)。 |
| SPEC-A3 | 依赖与构建清理(P0 #5+#6+#7+H-1) | `[x]` Done — PR-1 @`cee367a`(2026-06-01);H-1 @`5c0d6d9`(merged `d3c2d5c` 2026-06-15) | v2.2 批 2 | SPEC-A0 | [`sdd-dependency-pruning.md`](./sdd-dependency-pruning.md) | `./jest.config.js`、`./package.json`、`./src/ai-services/pa-agent-required-capability-policy.ts` | ✅ PR-1 全部闭合;H-1 deprecated `RequiredCapabilityLevel` type alias 已删除(0 外部消费者)。 |
| SPEC-A4 | 无消费者 flag 删除 | `[x]` Done @`8352261`(smoke pass 2026-06-01 on `fd6f9b5`) | v2.2 | SPEC-A0 | [`sdd-deprecated-flags-removal.md`](./sdd-deprecated-flags-removal.md) | `./src/settings.ts`、`./src/ai-services/chat-service.ts`、`./src/plugin.ts` migrateSettings、`./__tests__/chat-service.test.ts`、`./scripts/changelog.mjs` | ✅ `paAgentAnswerStreamEnabled` / `nativeToolPlanningSmokeEnabled` 字段及全部消费点已删除;generated CHANGELOG breaking section 已记录;native tool planning 主链路 + 旧 settings 兼容均通过真机 smoke。 |
| SPEC-A5 | 三层 ToolRegistry 塌缩(决策②) | `[x]` Done @`6cd1042`(smoke pass 2026-06-01) | v2.2 | SPEC-A0 | [`sdd-tool-registry-collapse.md`](./sdd-tool-registry-collapse.md) | `./src/ai-services/chat-tool-registry.ts`、`./src/ai-services/core-tool-provider.ts`(已删)、`./src/ai-services/capability-adapter.ts`、`./src/ai-services/pa-agent-runtime.ts`、`./src/ai-services/capability-types.ts` | ✅ `ToolRegistry` + `CoreToolProvider` 已删;wrap 改在 `capability-adapter.ts` parity 层(SDD §4.1 偏离,reviewer 接受);net −7 LOC src;`policy-engine.ts:35` action 防御线未动。 |
| SPEC-A6 | @sqliteai 供应商脱钩(决策⑤) | `[x]` Done — spike `2893b57`(merged `54bbc00`); 迁移已完成,`@sqlite.org/sqlite-wasm` 在用,`@sqliteai` 0 引用 | v2.3 | SPEC-A0 | [`sdd-sqliteai-supplier-migration.md`](./sdd-sqliteai-supplier-migration.md) | `./package.json`、`./src/vss/sqlite-worker.ts`、`./src/vss/sqlite-inline-assets.ts` | ✅ `@sqlite.org/sqlite-wasm` 替换;JS brute-force 向量 + 热向量 cache;spike 报告 [`sqlite-wasm-spike-report.md`](./sqlite-wasm-spike-report.md)。 |
| SPEC-A7 | apiToken 链清理(决策④ part 2) | `[x]` Done @`3536e90` | v2.6+ | SPEC-A0 | [`sdd-apitoken-cleanup.md`](./sdd-apitoken-cleanup.md) | `./src/settings.ts`、`./src/utils.ts`、`./src/plugin.ts` 迁移段 | ✅ v1.x 迁移代码已删除;v2.7 release notes 需标注 v1.x 跳升用户重输 token。 |
| SPEC-A8 | React → Preact 评估(决策③触发型) | `[T]` Triggered evaluation only | 触发型(无固定 phase) | SPEC-A0 | [`sdd-react-preact-evaluation.md`](./sdd-react-preact-evaluation.md) | (占位) | 触发条件:新组件用 React 独占特性 OR 引入 preact/compat 不兼容库;触发后启动正式 SDD,本占位标 `[x] superseded`。 |
| SPEC-A9 | WASM 内联策略复议(决策①触发型) | `[T]` Triggered evaluation only | 触发型(无固定 phase) | SPEC-A0 | (无 SDD,仅决策记录) | (占位) | 触发条件:移动端冷启动 ≥ 5s / OOM ≥ 3 例 / P95 ≥ 5s;触发后开 SDD;不主动测 bundle。 |
| SPEC-B1 | Pagelet review 5 修复(C-2/H-1/H-3/H-6/iOS) + Orchestrator 拆分 + Bubble 行为 + Onboarding | `[x]` Done — 4 commits `607c16a`→`08a312d`(2026-06-15) | v2.2 | SPEC-A0 | (无独立 SDD;源自历史 `pagelet-v2-review-decisions` 记录) | `src/pagelet/orchestrator.ts`、`src/pagelet/pet/PetSvg.ts`、`src/pagelet/preload/PreloadEngine.ts`、`src/pagelet/bubble/BubbleView.ts`、`src/pagelet/dom-utils.ts`(新)、`src/plugin.ts`、`src/custom.pcss`、`src/locales/pagelet/*.json`、`src/settings/pagelet/index.ts` | ✅ 16 文件 4 commits;1134 pagelet tests 全过;Orchestrator 拆分完成(AnalysisSessionManager + ReviewNoteSaveFlow 提取)。 |
| SPEC-B2 | Pagelet beta 毕业 gate(commit + smoke + provider) | Superseded — v2.2~v2.6 跳过正式发布,gate 验证项并入 v2.7 release | v2.2→v2.7 | SPEC-B1, SPEC-A3 H-1 | (无 SDD;gate checklist in [`development-roadmap.md`](./development-roadmap-v2.7.md)) | `manifest.json`、`manifest-beta.json`、`versions.json`、`CHANGELOG.md` | 验证项移入 v2.7 release: OQ002 provider 矩阵 + iOS 真机 + Pagelet smoke。 |
| SPEC-B3 | 内置 Skills 扩展(obsidian-dataview + obsidian-templater) | `[x]` Done — dataview @`814e7d3`; templater @`3965c01` | v2.3 | SPEC-A0 | (无独立 SDD) | `skills/` 新目录、`src/ai-services/bundled-skill-catalog.ts`、`src/ai-services/bundled-skills.ts` | ✅ 两个 skill SKILL.md + references 完整;catalog 注册;jest 通过。 |
| SPEC-B4 | v1 Pagelet 死代码移除 | `[x]` Done @`4fc33a9` | v2.3 | SPEC-B2 | (无 SDD;机械删除) | `src/ui/pagelet/`(全目录)→`src/pagelet/ui/` | ✅ v1 UI primitives 迁移到 `src/pagelet/ui/`;旧 `src/ui/pagelet/` 目录已删除;jest 通过。 |
| SPEC-B5 | Orchestrator 进一步拆分(纯协调层) | `[x]` Done @`d96bf4b` — 866 行(exit gate <800 accepted,不再缩减) | v2.3 | SPEC-B1 | (无独立 SDD) | `src/pagelet/orchestrator.ts` | ✅ 提取 4 模块(AnalysisSessionManager 365 行 / ReviewNoteSaveFlow 280 行 / DiscoveryAnalyzer 117 行 / BackgroundPreparationCoordinator 158 行);jest 通过。行数 866 vs 800 目标,2026-06-18 决定 accepted 不再改动。 |
| SPEC-C1 | Action Mode Phase 1(append-to-current-note) | `[x]` Done — C1-P1 `7befc18` → P2 `68c3306` → P3 `ebd62b1` → P4 `0f482a9` → P5 `f2267d6` + review fixes `bf7e56e`/`8f4d675`/`917edbf` | v2.6 | SPEC-B2, Framework v1 验证(dogfooding pass), SPEC-B5 | [`operations-agent-mode-sdd.md`](../development/proposals/operations-agent/operations-agent-mode-sdd.md) + [`write-action-framework-sdd.md`](../architecture/write-action-framework-sdd.md) | `src/ai-services/write-action-framework/`(15 files)、`src/ai-services/policy-engine.ts`、`src/ai-services/pa-agent-runtime.ts` | ✅ append action family + stale-reread mode B (SHA-256) + policy tier + prompt injection tests + Operations Agent runtime wiring + preview modal + target confinement。 |
| SPEC-C2 | Skill 用户自定义扩展 | `[ ]` Deferred — 产品设计和用户价值不明确(2026-06-18 决策) | v2.7+ | SPEC-B3 | (待起草) | `src/ai-services/skill-router.ts`、`src/ai-services/skill-context-provider.ts`、`src/settings.ts` | allowed-tools enforce + Settings UI + (optional) vault-side discovery。 |
| SPEC-D1 | 改进切片策略(heading-aware + frontmatter 保留) | `[x]` Implemented | v2.4 | SPEC-B2 | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/vss/markdown-chunker.ts`、`src/vss.ts`、`src/vss/types.ts` | heading-aware 切割 + frontmatter 保留 + chunk metadata heading path/行号填充；schema v2 走确认重建路径。 |
| SPEC-D2 | Pagelet 接入 VSS + Reranker 升级 | `[x]` Implemented | v2.4 | SPEC-D1 | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/plugin.ts`、`src/pagelet/pa-review-schemas.ts`、`src/ai-services/pa-agent-runtime.ts` | Pagelet VSS related notes + related_notes 语义化 + reranker excerpt 扩展 + heading path。 |
| SPEC-D3 | 按需时间感知检索(Query Rewriter temporal 扩展) | `[x]` Implemented | v2.4 | None | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/ai-services/query-rewriter.ts`、`src/vss/sqlite-worker.ts` | Query Rewriter 输出 temporal 字段 + SQL WHERE 时间过滤。 |
| SPEC-D4 | 检索窗口扩大(4→8 文档 / 2000→4000 字符) | `[x]` Implemented | v2.4 | None | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/ai-services/pa-agent-runtime.ts` | MAX_MEMORY_DOCUMENTS 4→8 + MAX_MEMORY_CHARS 2000→4000；candidate/rerank 窗口同步扩大。 |
| SPEC-D5 | Context Projector(Phase 1 提取 + Phase 2 Hygiene) | `[x]` Implemented | v2.4 | None | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/ai-services/context/*`、`src/ai-services/pa-agent-runtime.ts` | `forPrompt()` 边界 + origin 诊断 metrics；status-only/orphan 过滤；Type A/C injected context 入口。Host-context diffing 未实现。 |
| SPEC-D6 | Context Compactor + Budget(micro/history compaction + budget diagnostics) | `[x]` Implemented | v2.5 | SPEC-D5 | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/ai-services/context/*`、`src/ai-services/pa-agent-runtime.ts` | micro-compaction moved to projection boundary + deterministic history summary + chars/tokens/provider-usage diagnostics and budget-driven recompaction。Budget 不统一管控 Memory 检索常量。 |
| SPEC-D7 | Type A 用户画像(自动提取 + 注入) | `[x]` Implemented | v2.5 | SPEC-D5 | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/ai-services/memory-extraction/type-a-extractor.ts`、`profile-store.ts`、`extraction-scheduler.ts` | local-first 自动提取 + 对话边界触发 + IndexedDB 存储 + 置信度/recurrence。 |
| SPEC-D8 | Type C Vault 元认知 + Extraction pipeline | `[x]` Implemented | v2.5 | SPEC-D5 | [`sdd-ai-insight-foundation.md`](./sdd-ai-insight-foundation.md) | `src/ai-services/memory-extraction/type-c-analyzer.ts`、`extraction-scheduler.ts` | 6 维度 metadata/topology 分析 + 独立调度 + internal snapshot；默认不写 vault。E1 激活后，`memoryExtractionIncludeVaultInsights` 默认启用并以摘要注入 prompt。 |
| SPEC-E1 | Vault Insights 激活 + Discovery 专用流程 | `[x]` Implemented | v2.5 | SPEC-D8 | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §3 | `settings.ts`、`plugin.ts`、`pagelet/orchestrator.ts`、`pagelet/PageletHost.ts`、`pagelet/panel/` | vault insights opt-in 注入 prompt + onboarding Notice + Discovery 专用 LLM 分析 + VSS-not-ready 引导 + `PageletHost.findRelatedNotes` 合约。 |
| SPEC-E2 | 图感知检索 (1-hop link expansion) | `[x]` Implemented | v2.5 | SPEC-E1 | [`sdd-graph-aware-retrieval.md`](./sdd-graph-aware-retrieval.md) | `memory-search-tool.ts`、`pa-agent-runtime.ts` | 搜索命中笔记的 outbound wikilink + inbound backlink 目标自动展开；VSS chunk 内容填充；outbound 0.5 / backlink 0.4 衰减；top-3 bounded。 |
| SPEC-E3 | Pagelet VSS 全场景覆盖 | `[x]` Implemented | v2.5 | SPEC-E1 | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §4.2 | `plugin.ts`、`pagelet/PeriodicSummaryFlow.ts`、`pagelet/output/` | Preload + Periodic Summary 接入 VSS related notes 搜索；`PeriodicSummaryInput.relatedNotes` 新增。 |
| SPEC-E4 | Budget→Compaction 联动 + 测试补齐 | `[x]` Implemented | v2.5 | None | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §4.3-4.4 | `context/PaAgentContextManager.ts`、`__tests__/pa-agent-context.test.ts` | Budget `nearObservationLimit` 触发二次 micro-compaction (targetRatio 0.4) + 5 个 review-backfill 测试。 |
| SPEC-E5 | Type A LLM 后台提取 | `[x]` Implemented | v2.5 | SPEC-E1 | [`sdd-type-a-llm-extraction.md`](./sdd-type-a-llm-extraction.md) | `memory-extraction/type-a-extractor.ts`、`extraction-scheduler.ts`、`plugin.ts` | LLM 提取 `inferred_behavior` + regex fallback + mobile idle guard + cost tracking + consent i18n 更新。 |
| SPEC-E6 | 语义聚类 + temporal range + 死代码清理 | `[x]` Implemented | v2.5 | SPEC-E1 | [`ai-insight-activation-plan.md`](./ai-insight-activation-plan.md) §5.2-5.4 | `vss/*`、`memory-extraction/type-c-analyzer.ts`、`query-rewriter.ts`、`pagelet/llm/prompts.ts` | Worker k-means 聚类 + 15K guard + `range:YYYY-MM-DD..YYYY-MM-DD` temporal + `buildQuickReviewPrompt`/`buildWritingAssistPrompt` 删除。 |

## Phase Ledger(by release window)

每行 = 一个 v2.x release 窗口,列出该窗口要落地的 SPEC 与状态。Per-SPEC 阶段(SPEC Review / Dev / Test / Code Review / Deploy / Smoke)在 SPEC 开始执行后填入对应 SDD 与本表。

### v2.1.2(closeout)

| SPEC | SPEC Review | Dev | Test | Code Review | Deploy | Smoke | Fix / Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-A0 | Self-review on 2026-06-01: review.md 冻结 + decisions.md/tracker 创建 + 8 SDD 交叉链接通过 | Docs-only | Docs checks pending(待 §Verification Log 记录) | None required | Not applicable | Skipped(docs-only) | Done; v2.2 SPEC 进入 `[R]` 后启动正式 SPEC review。 |

### v2.2(P0 + flag 清扫 + Plan C 拆 SDD)

| SPEC | SPEC Review | Dev | Test | Code Review | Deploy | Smoke | Fix / Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-A1 | Self-review 2026-06-01 (re-grep validated: ribbon at `plugin.ts:162`, `activeChatView` at `:693`, `getAISetupIssue` at `:1222`, `renderEmptyState` closure at `chat-view.ts:829`; SDD references to `VIEW_TYPE_CHAT`/`activateView(...)` corrected to use existing `activeChatView()` + `VIEW_TYPE_LLM`) | ✓ 2026-06-01 commits `6ed1ea8` (ribbon) → `db0db7b` (empty-state banner + CSS) → `b251962` (README + Manual) | ✓ tsc=0 + jest 4492/4492 on master HEAD `b251962` 2026-06-01;chat-related subset 540/540 | Skipped — incremental commits each scoped to a single concern; residual risk: SDD §4.2 prescribed a CN mirror in Manual-CN.md and onboarding screenshots (`docs/onboarding-*.png`) that are deferred to a follow-up commit | ✓ 2026-06-01 user `make deploy` to test vault | ✓ 2026-06-01 combined Obsidian smoke pass (A3 PR-1 + A5 + A1 tree on HEAD `13dbb2b`) | Done。Manual-CN.md mirror + onboarding screenshots deferred to follow-up (non-blocking, can ride alongside A4/A2 PR)。 |
| SPEC-A2 | Pending(批 2 独立 PR) | Pending | Pending | Pending | Pending | Pending(命令面板 Memory + Featured Images 显隐) | Drafted; awaits SPEC review pass。 |
| SPEC-A3(non-H-1) | Self-review 2026-06-01 (1-line scope, dry-run validated) | ✓ 2026-06-01 commit `0ec8b92` (worktree-agent-a076c1ec001c1c741) | ✓ tsc=0 + jest 916 (throwaway) + jest 4492 (master) on 2026-06-01 | Skipped — 1-line scope; residual risk: jest coverage threshold (master commit `046774b`) is inert when collectCoverage off (acceptable per A3 SDD) | ✓ 2026-06-01 user `make deploy` to test vault | ✓ 2026-06-01 combined Obsidian smoke pass (A3 PR-1 + A5 + A1 tree on HEAD `13dbb2b`);record-note callout 不退化 + jest coverage 默认关都符合预期 | Done。P0 #5/#6 closed by decision (no code change)。 |
| SPEC-A3(H-1) | Self (1 type alias, 0 consumers) | ✓ 2026-06-15 commit `5c0d6d9` (worktree) | ✓ 1711 tests passed | Self-review (mechanical deletion) | Pending(`make deploy`) | Pending(PA Agent chat 不退化) | Done; merged `d3c2d5c`。 |
| SPEC-B1 | Self (assessment-derived, review decisions 已确认) | ✓ 2026-06-15 commits `607c16a`→`5549fd9`→`b8733c6`→`08a312d` | ✓ 1134 pagelet tests passed | Self-review (review decision execution) | Pending(`make deploy`) | Pending(pagelet-smoke-checklist.md) | Done; 4 模块化 commits。Review fixes: a24fe81 (scope i18n, type safety, RateLimiter invalidation, .gitignore, SKILL.md) + 8319435 (mobile scroll, touch/click guard)。 |
| SPEC-A2 | Self (SDD re-grep validated) | ✓ 2026-06-15 commit `b2696f8` (worktree) | ✓ 1711 tests passed | Self-review (checkCallback gate) | Pending(`make deploy`) | Pending(命令面板 smoke) | Done; merged `4a730f5`。Featured Images `editorCheckCallback` + `aiProvider !== 'qwen'` gate; Memory advanced 已由 `showAdvancedMemoryControls` 守卫(验证通过)。 |
| SPEC-B2 | N/A (gate, not implementation) | N/A | N/A | N/A | Superseded | Superseded | v2.2~v2.6 跳过正式发布(2026-06-18 决策)。验证项(OQ002 provider 矩阵 + iOS 真机 + Pagelet smoke)并入 v2.7 release。 |
| SPEC-A4 | Self-review 2026-06-01 (re-grep validated against master HEAD `e3914f2`: `settings.ts:70`/`:140`、`chat-service.ts:102` 三元、`plugin.ts:1062-1065`/`:1084-1087` 两段 migrate;all matches present, scope unchanged from SDD) | ✓ 2026-06-01 commit `8352261` (refactor) + companion `b8030b9` (A1 styles rebuild) | ✓ tsc=0 + jest 4492/4492 + chat-service 子集 65/65 on master HEAD `8352261` 2026-06-01 | Self-review only (deletion-only diff,无逻辑变更;两个 flag 自 v2.0.0 起已是 no-op) | ✓ 2026-06-01 用户 `make deploy` to test vault | ✓ 2026-06-01 Obsidian smoke pass on master HEAD `fd6f9b5`;native tool planning 主链路 + 旧 settings 残留 keys 兼容均符合预期 | Done。 |
| SPEC-A5 | Subagent review 2026-06-01: Approve (deviations: factories unmodified, parity layer added at registry edge — defensible per `__tests__/obsidian-operations-tools.test.ts:208` direct registry.execute() callsite;LOC delta accepted) | ✓ 2026-06-01 commits `9129ae6` → `dfa3f91` → `285d8f1` → `d98ceb2` (worktree-agent-a16cf09d50baee0e9) | ✓ tsc=0 + jest 916 (throwaway) + jest 4492 (master) on 2026-06-01 | ✓ Subagent Approve, no blockers (LOC delta −7 net source vs −500 SDD prediction;user accepted) | ✓ 2026-06-01 user `make deploy` to test vault | ✓ 2026-06-01 combined Obsidian smoke pass (A3 PR-1 + A5 + A1 tree on HEAD `13dbb2b`);全 capability 调用链行为不变 + chat / search_memory / WebSearch / record-note 均符合预期 | Done。 |

### v2.3(@sqliteai 脱钩 + spike + 真机回归)

| SPEC | SPEC Review | Dev | Test | Code Review | Deploy | Smoke | Fix / Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-A6 | Self(spike report) | ✓ spike `2893b57` + 迁移完成 | ✓ 1893 tests | Self-review | ✓ `make deploy` | Pending(v2.7 合并 smoke) | Done; `@sqlite.org/sqlite-wasm` 在用,`@sqliteai` 0 引用。 |
| SPEC-B3 | Self | ✓ dataview `814e7d3` + templater `3965c01` | ✓ 1893 tests | Self-review | ✓ `make deploy` | Pending(v2.7 合并 smoke) | Done; 两个 built-in skills 完成。 |
| SPEC-B4 | Self(机械删除) | ✓ `4fc33a9` | ✓ 1893 tests | Self-review | ✓ `make deploy` | Pending(v2.7 合并 smoke) | Done; v1 UI primitives 迁移到 `src/pagelet/ui/`。 |
| SPEC-B5 | Self | ✓ `d96bf4b` | ✓ 1893 tests | Self-review | ✓ `make deploy` | Pending(v2.7 合并 smoke) | Done; 4 模块提取,866 行 accepted。 |

### v2.4(AI 洞察力提升 — 地基 + 投影)

| SPEC | SPEC Review | Dev | Test | Code Review | Deploy | Smoke | Fix / Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-D1 | Self | ✓ code | ✓ `markdown-chunker`, `vss.test` | Self-review | ✓ `make deploy` | ✓ app smoke(VSS schema-v2 stale status) | heading-aware chunker + schema v2 stale path; AGENTS confirmation rule overrides silent rebuild wording。 |
| SPEC-D2 | Self | ✓ code | ✓ `pa-review-schemas.test` | Self-review | ✓ `make deploy` | ✓ app smoke(Pagelet panel visible) | Pagelet VSS related-note context is separate from source segments。 |
| SPEC-D3 | Self | ✓ code | ✓ `query-rewriter`, `pa-agent-runtime-search-vss`, `vss-search-hybrid-parallel` | Self-review | ✓ `make deploy` | ✓ safe runtime smoke(no errors) | Temporal filter runs in parallel with query embedding and rewrite。 |
| SPEC-D4 | Self | ✓ code + existing stats implementation | ✓ existing `stats-manager` incremental snapshot tests + `pa-agent-runtime-search-vss` | Self-review | ✓ `make deploy` | ✓ safe runtime smoke(no errors) | `calcSnapshotIncremental()` already landed before this closeout; AI Insight analysis #4 retrieval windows are expanded in `pa-agent-runtime.ts`。 |
| SPEC-D5 | Self | ✓ code | ✓ `pa-agent-context`, `pa-agent-runtime-chat-history` | Self-review | ✓ `make deploy` | ✓ safe app smoke(runtime diagnostics, no console errors) | Projector/Hygiene/Compactor wired into canonical model input metrics。Provider-backed retry remains an external privacy-approval residual risk。 |

### v2.5(Context Compactor + 理解层)

| SPEC | SPEC Review | Dev | Test | Code Review | Deploy | Smoke | Fix / Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-D6 | Self | ✓ code + review fixes | ✓ `pa-agent-context`, `pa-agent-stream-fallback` | Self-review + subagent review | ✓ `make deploy` | ✓ app smoke(Pagelet/runtime no errors) | Projection owns observation compaction/truncation; provider usage diagnostics feed budget tracker。 |
| SPEC-D7 | Self | ✓ code | ✓ `memory-extraction` | Self-review | ✓ `make deploy` | ✓ app smoke(userProfile context present) | Type A local-first extraction persists through vault-scoped IndexedDB store。 |
| SPEC-D8 | Self | ✓ code + review fixes | ✓ `memory-extraction` | Self-review + subagent review | ✓ `make deploy` | ✓ app smoke(pre-E1 Type C internal snapshot) | Type C stays internal and does not write vault notes by default; E1 activation later enables prompt-summary injection behind `memoryExtractionIncludeVaultInsights`。 |

### v2.5 E-series（AI Insight Activation）

| SPEC | SPEC Review | Dev | Test | Code Review | Deploy | Smoke | Fix / Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-E1 | Self(activation plan §3 as design doc) | ✓ 2026-06-17 | ✓ 1887 tests after smoke fixes | Self + 3-agent review (arch/product/perf) | ✓ `make deploy` | ✓ 2026-06-17 runtime smoke | Vault insights opt-in + Discovery flow + PageletHost contract; Memory-ready Discovery returned mapped connections。 |
| SPEC-E2 | Self([`sdd-graph-aware-retrieval.md`](./sdd-graph-aware-retrieval.md)) | ✓ 2026-06-17 | ✓ 1887 tests after smoke fixes | Self + review fix(VSS chunk fill) | ✓ `make deploy` | ✓ 2026-06-17 runtime smoke | 1-hop expansion with VSS chunk content; VSS ready/search/chunk lookup surfaces passed, full Chat graph-answer click path not re-clicked due Computer Use timeout。 |
| SPEC-E3 | Self(activation plan §4.2) | ✓ 2026-06-17 | ✓ 1887 tests after smoke fixes | Self | ✓ `make deploy` | ✓ 2026-06-17 runtime smoke | Pagelet related-note query returns Memory candidates within the interaction budget; Discovery panel consumes mapped related notes。 |
| SPEC-E4 | Self(activation plan §4.3-4.4) | ✓ 2026-06-17 | ✓ 1887 tests after smoke fixes | Self | ✓ `make deploy` | ✓ automated/runtime smoke | Budget-driven recompaction + annotateOrigins/constants/escape/production-values tests; runtime smoke did not expose context budget errors。 |
| SPEC-E5 | Self([`sdd-type-a-llm-extraction.md`](./sdd-type-a-llm-extraction.md)) | ✓ 2026-06-17 | ✓ 1887 tests after smoke fixes | Self + review must-fix(cost tracking) | ✓ `make deploy` | ✓ 2026-06-17 provider-backed runtime smoke | Type A LLM extraction updated User Profile with the smoke preference; cost-bearing provider call recorded by runtime。 |
| SPEC-E6 | Self(activation plan §5.2-5.4) | ✓ 2026-06-17 | ✓ 1887 tests after smoke fixes | Self + review must-fix(O(n²) perf + 15K guard) | ✓ `make deploy` | ✓ automated/runtime smoke | Worker k-means + range: temporal + dead code removal covered by tests; Type C vault insights contained topology/themes/trends in prompt context。 |

### v2.6(Action Mode + 清理)

| SPEC | SPEC Review | Dev | Test | Code Review | Deploy | Smoke | Fix / Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPEC-C1 | Self([`operations-agent-mode-sdd.md`](../development/proposals/operations-agent/operations-agent-mode-sdd.md)) | ✓ C1-P1~P5 `7befc18`→`f2267d6` + review fixes | ✓ 1893 tests(含 WAF 5 spec files) | Self + review fixes `bf7e56e`/`8f4d675`/`917edbf` | ✓ `make deploy` | Pending(v2.7 合并 smoke) | Done; Framework v1 dogfooding pass 解除 8 周时间锁。 |
| SPEC-C2 | Deferred | — | — | — | — | — | 2026-06-18 决策: 产品设计和用户价值不明确,推迟到 v2.7+。 |
| SPEC-A7 | Self | ✓ `3536e90` | ✓ 1893 tests | Self-review | ✓ `make deploy` | Pending(v2.7 合并 smoke) | Done; v1.x 迁移代码已删除。 |

### Triggered evaluation(无固定 phase)

| SPEC | Trigger Condition | Status |
| --- | --- | --- |
| SPEC-A8 | 新组件用 React 独占特性(Suspense+lazy / useTransition / useDeferredValue / concurrent / Server Components)OR 引入 preact/compat 不兼容第三方库 | `[T]` 占位;触发后启动正式 SDD。 |
| SPEC-A9 | 移动端冷启动 ≥ 5s / OOM ≥ 3 例独立用户 / 加载阶段被动遥测 P95 ≥ 5s | `[T]` 占位;触发后开 SDD。bundle 体积变化不触发。 |

## Traceability Matrix

| 决策 | SPEC | 关键 file:line(以 v2.1.2 为基线,实施前需 grep 验证) | Phase |
| --- | --- | --- | --- |
| 决策① WASM 不动(A3) | SPEC-A9 | (无代码改动;触发后定位 `./src/vss/sqlite-inline-assets.ts` + `./src/vss/sqlite-worker.ts`) | 触发型 |
| 决策② 三层塌缩(B3) | SPEC-A5 | `./src/ai-services/chat-tool-registry.ts`(整 class)、`./src/ai-services/core-tool-provider.ts`(整文件)、`./src/ai-services/chat-tool-factories.ts`、`./src/ai-services/capability-types.ts:20`(kind 注释)、`./src/ai-services/policy-engine.ts:35`(action 守卫,**不动**) | v2.2 或 v2.3 |
| 决策③ React 不切(C1) | SPEC-A8 | (无代码改动;触发后定位 `./package.json`、`./esbuild.config.mjs`、`./jest.config.js`、`./src/components/*.tsx`) | 触发型 |
| 决策④ part 1: flag 清扫 | SPEC-A4 | `./src/settings.ts:70`(类型)、`./src/settings.ts:140`(默认值)、`./src/ai-services/chat-service.ts:102`(消费点)、`./src/plugin.ts:1062-1065`(归一化)、`./src/plugin.ts:1084-1087`(已存在的 delete 块) | v2.2 |
| 决策④ part 2: apiToken 链 | SPEC-A7 | `./src/settings.ts:59-60`、`./src/utils.ts:189-190`(`personalAssitant` 常量)、`./src/utils.ts:192-`(`CryptoHelper` 类)、`./src/plugin.ts:14`(import)、`./src/plugin.ts:117-118`(字段)、`./src/plugin.ts:1172-1196`(migrateSettings)、`./src/plugin.ts:1219-1221`(`getLegacyAPITokenSecretId`)、`./src/plugin.ts:1224-1227`(legacy fallback) | v2.6+ |
| 决策⑤ @sqliteai 脱钩 | SPEC-A6 | `./package.json`(依赖替换)、`./src/vss/sqlite-worker.ts:339-622`(3 处 `vector_*` SQL)、`./src/vss/sqlite-inline-assets.ts`(WASM 路径)、`./src/vss/schema.ts`(若存在) | v2.3 |
| P0 #1 ribbon 直达 | SPEC-A1 | `./src/plugin.ts:162-165`(addRibbonIcon,需 grep 验证) | v2.2 批 1 |
| P0 #2 空状态 banner | SPEC-A1 | `./src/chat/chat-view.ts:829-861`(`renderEmptyState`,需 grep 验证) | v2.2 批 1 |
| P0 #3 4 个 deprecated 类型 | SPEC-A3 (H-1) | `./src/ai-services/pa-agent-required-capability-policy.ts:25,42,52,77`(类型)、`:99-101`(签名 inline) | v2.2 批 2,6/12 之后 |
| P0 #4 README + Manual | SPEC-A1 | `./README.md`、`./Manual.md`、`./docs/onboarding-*.png`(新增) | v2.2 批 1 |
| P0 #5 patches/ 残留 | SPEC-A3 | (确认不存在) | v2.2 批 2(PR-1) |
| P0 #6 obsidian-callout-manager | SPEC-A3 | `./package.json`、`./src/callout.ts:4`、`./src/plugin.ts:4`、`./src/types/obsidian-callout-manager.d.ts:1`、`./__tests__/plugin-record-note.test.ts:50`、`./__tests__/callout.test.ts:4`(路径 A 保留) | v2.2 批 2(PR-1) |
| P0 #7 jest coverage | SPEC-A3 | `./jest.config.js:20`(`collectCoverage: true` 改注释或 false) | v2.2 批 2(PR-1) |
| P0 #8 命令面板清理 | SPEC-A2 | `./src/plugin.ts`(addCommand 调用,需 grep 验证)、`./src/settings.ts`(`showAdvancedMemoryControls` toggle) | v2.2 批 2 |
| §8 决策驱动力修正 | (横向) | (无代码改动;反映在 SPEC-A8 / SPEC-A9 触发条件 + decisions.md §0/§4) | v2.1.2 review 时点 |

## Verification Log

| Date | SPEC / Phase | Scope | Command / Method | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-06-01 | SPEC-A0 | 文档冻结 + 交叉链接 | Manual review of [`v2.1.2-comprehensive-review.md`](./v2.1.2-comprehensive-review.md) Status header + decision/tracker cross-links | Passed | Review 头部已加 Frozen 标识;decisions.md 引用 review.md + tracker;tracker 引用 decisions.md + 8 SDD;8 SDD 各自含 Phase 标识。 |
| 2026-06-01 | SPEC-A3 PR-1 + SPEC-A5 + docs(umbrella) | Throwaway worktree merge validation | `git worktree add --detach /tmp/pa-merge-test master` + 3 sequential `git merge --no-ff` of docs / A3 / A5 + `npx tsc --noEmit --skipLibCheck` + `npm test` | Passed (3 auto-merges;tsc=0;jest 57 suites / 916 tests) | Throwaway used symlinked node_modules;lower test count vs master is path-resolution artifact, no failures。Worktree cleaned up post-validation。 |
| 2026-06-01 | master post-merge sanity | tsc + jest on master HEAD `510efcf` | `npx tsc --noEmit --skipLibCheck` + `npm test` | Passed (tsc=0;jest 265 suites / 4492 tests in 8.7s) | Authoritative green;master ready for `make deploy` + smoke。Rollback anchor `pre-v2.1.2-merge` → `6a262d8` retained。 |
| 2026-06-01 | SPEC-A1 Commit 1 (ribbon) | Targeted regression on `plugin-record-note.test.ts` after `addEventListener` mock extension | `npx jest __tests__/plugin-record-note.test.ts` | Passed (5 suites / 75 tests) | Confirms ribbon mock contract widening does not break existing record-note behavior。 |
| 2026-06-01 | SPEC-A1 Commit 2 (empty-state banner) | Chat-related tests after `renderEmptyState` setupIssue path + CSS tweak | `npx jest src/chat/ __tests__/chat-view` | Passed (5 suites / 540 tests) | Banner branch executes only when `getAISetupIssue()` returns non-null;default chips path unchanged。 |
| 2026-06-01 | SPEC-A1 full sanity | tsc + jest on master HEAD `b251962` after all 3 A1 commits | `npx tsc --noEmit --skipLibCheck` + `npm test` | Passed (tsc=0;jest 265 suites / 4492 tests in 6.6s) | Authoritative green post-A1;master ready for combined Step 1 + A1 deploy + smoke。 |
| 2026-06-01 | Combined Step 1 + A1 Obsidian smoke | Real Obsidian test vault on master HEAD `13dbb2b` (after `make deploy`) | User-driven manual smoke per tracker checklist (ribbon left/right click;empty-state banner show/clear;capability dispatch;jest config) | Passed | Smoke green;A3(non-H-1) + A5 + A1 cleared the deploy gate;v2.2 batch 1 + 批 2 PR-1 portion fully closed。Manual-CN.md + onboarding screenshots remain as A1 follow-up docs (non-blocking)。 |
| 2026-06-01 | SPEC-A4 dev cycle | tsc + jest on master HEAD `8352261` after flag removal commit | `npx tsc --noEmit --skipLibCheck` + `npx jest __tests__/chat-service.test.ts` + `npm test` | Passed (tsc=0;jest 5 suites / 65 tests targeted;jest 265 suites / 4492 tests full in 5.4s) | Authoritative green post-A4 dev;master ready for `make deploy` + smoke。Companion `b8030b9` 仅为 A1 `.pa-chat-config-banner` CSS 重新生成,无逻辑变更。 |
| 2026-06-01 | SPEC-A4 Obsidian smoke | Real Obsidian test vault on master HEAD `fd6f9b5` (after `make deploy`) | User-driven manual smoke (chat path / native tool planning / record-note / search_memory + 旧 settings 残留 `paAgentAnswerStreamEnabled` / `nativeToolPlanningSmokeEnabled` keys 加载) | Passed | Smoke green;两个 deprecated flag 移除不影响主链路,旧 settings 加载亦无错误。SPEC-A4 翻 `[x] Done`。 |
| 2026-06-16 | SPEC-D1~D8 focused dev cycle | Heading-aware chunks, temporal search, Pagelet related notes, context manager, extraction scheduler, VSS schema bump | `npx tsc -noEmit -skipLibCheck`; focused Jest suites: `markdown-chunker`, `query-rewriter`, `pa-review-schemas`, `pa-agent-context`, `memory-extraction`, `pa-agent-runtime-search-vss`, `pa-agent-stream-fallback`, `pa-agent-loop`, `vss`, `vss-search-hybrid-parallel`, `vss-state`, `vss-local-state-store` | Passed | Confirms D-series module contracts and schema-v2 test fixture updates。 |
| 2026-06-16 | SPEC-D1~D8 broad automated checks | Full serialized Jest + lint + whitespace/source scan | `npm test -- --runInBand --forceExit`; `npm run lint`; `git diff --check`; source scan for runtime `<style>` creation / `innerHTML` / `outerHTML` injection | Passed (Jest 104 suites / 1803 tests; lint=0; diff-check=0; source scan no matches) | Plain `npm test -- --runInBand` also reported all tests passed but kept an open handle; `--forceExit` produced exit 0。 |
| 2026-06-16 | SPEC-D1~D8 build/deploy gate | Full build and Obsidian deploy | `npm install`; `npm run build`; `make deploy` | Passed | `npm install` restored missing declared dependency `@sqlite.org/sqlite-wasm` without tracked package metadata changes; build passed; `make deploy` passed and copied assets into `test/.obsidian/plugins/personal-assistant/`。 |
| 2026-06-16 | SPEC-D1~D8 post-review Obsidian app smoke | Real Obsidian 1.13.1 test vault after deploy/reload | `obsidian plugin:reload`; `obsidian plugin id=personal-assistant`; `obsidian open path=pagelet-smoke-golden.md`; `obsidian command id=personal-assistant:pa-pagelet:open-panel`; `obsidian dev:dom selector=.pa-pagelet-panel`; runtime eval; `obsidian dev:errors` | Passed | Reload printed success and plugin status is enabled. Pagelet panel rendered in DOM with expected smoke note scope text; no runtime errors captured. Memory extraction scheduler is live; runtime config has `typeCWritePath: null`; prompt context includes userProfile and no `vaultInsights`. Existing `PA-Memory/vault-insights.md` in the test vault is treated as prior smoke residue, not current default output。 |
| 2026-06-17 | v2.2+ broad runtime smoke + E-series closeout | Real Obsidian 1.13.1 test vault after final `make deploy`/reload | `make deploy`; `obsidian plugin:reload`; `prepareMemory()`; `runTypeCRefresh`; provider-backed `runTypeAExtraction`; Pagelet `discoverConnections`; Chat/Records/Stats commands + DOM; `dev:errors`; source scan for runtime style/HTML injection | Passed with UI click caveat | Final deploy passed 108 suites / 1887 tests, lint, build. VSS recovered from stale/settings-changed plan to ready SQLite OPFS (`31` files / `96` chunks). Prompt context contains User Profile + Vault Insights. Type A smoke sent "For this smoke run, remember that I prefer validation summaries with PASS, FAIL, and BLOCKED labels." and profile updated. Discovery returned Memory-backed mapped connections. Chat `.llm-view`, Records Preview, and Statistics rendered. Operations Agent remained disabled. Source scan had no runtime `<style>`/`innerHTML`/`outerHTML` matches. Computer Use `get_app_state` timed out twice; 2026-06-18 retry timed out again and macOS Accessibility exposed `0` Obsidian windows, so new click-through UI paths are not counted as passed in this row。 |
| 2026-06-18 | Post-commit redeploy check | Current `master` in real Obsidian 1.13.1 test vault | `make deploy`; `obsidian plugin:reload`; activate `pagelet-smoke-golden.md`; `obsidian command id=personal-assistant:pa-pagelet:open-panel`; `.pa-pagelet-panel` DOM/state/position checks; `dev:errors`; Computer Use + System Events retry | Passed with UI click blocker | `make deploy` passed 108 suites / 1887 tests, lint, build, and copied plugin assets. Plugin reload succeeded. Pagelet panel DOM rendered with `data-state=visible`, current-note scope, `Review selected (1)`, and no captured errors. Computer Use still timed out at `get_app_state` for `md.obsidian` after 120s, and System Events still exposed `0` Obsidian windows, so no new click-through UI paths are counted as passed。 |
| 2026-06-17 | Smoke-found fixes | VSS SQLite asset loading + Pagelet related notes + Discovery mapping | Focused Jest: `sqlite-vector-index`, `sqlite-inline-assets`, `vss`, `vss-search-hybrid-parallel`, `pagelet-related-notes-query`, `pagelet-discovery-analyzer`, `pagelet-orchestrator`; `npx tsc --noEmit --skipLibCheck`; repeated `make deploy` | Passed | Fixed `blob:` inline SQLite WASM URLs being rejected by `prepareWasmUrl`, shortened Pagelet related-note Memory queries to stay within the 8s interaction budget, and mapped Discovery connection targets from related-note aliases instead of falling back to current-current cards。 |

(后续 SPEC `[R]` → `[A]` → `[~]` → `[T]` → `[V]` → `[S]` → `[x]` 期间产生的 verification 命令在此追加。)

## Review Log

| Date | Scope | Reviewer | Result | Findings / Disposition |
| --- | --- | --- | --- | --- |
| 2026-06-01 | v2.1.2 review 5 决策 + Q1-Q8 不确定性 | 用户(主决策)+ 多 subagent(支持分析) | Frozen | 5 原始决策 + Q1-Q8 拍板全部入 [`v2.1.2-decisions.md`](./v2.1.2-decisions.md);review.md 加 Frozen header + F4 修正 + §8 决策驱动力章节。 |
| 2026-06-01 | 9 个 SPEC 拆分（A1-A9） | Wave 1.B/C/D/E 多 subagent | Drafted | 7 个 SDD (A1-A7) 进入 `[D]` Drafting;触发型 SDD-A8 标 `[T]`;SPEC-A9 仅决策记录无 SDD,占位 `[T]`。 |
| 2026-06-01 | tracker / decisions / SDD 一致性自检 | Self (Wave 1+2 closeout) | Fixed | 5 项 across 6 文件:B-1 `[[]]` reference 格式不统一(7 处)、B-4 memory 中 "今天到期" 与 today=2026-06-01 矛盾、+3 项小修;2 commits in worktree (`738796a` + `77d2a5a`)。 |
| 2026-06-01 | SPEC-A5 implementation diff | Subagent code-review (worktree-agent-a16cf09d50baee0e9 commits `9129ae6`→`dfa3f91`→`285d8f1`→`d98ceb2`) | Approve (no blockers) | 偏离 SDD §3/§4.1:`chat-tool-factories.ts` 未改,wrap 移到 `capability-adapter.ts` parity 层(理由:`__tests__/obsidian-operations-tools.test.ts:208` 直接调 `registry.execute()`,要求 entry-point parity)。LOC delta −7 net src(SDD 预测 −500),用户已接受。`policy-engine.ts:35` action 守卫未动。 |
| 2026-06-01 | SPEC-A1 implementation (3 commits) | Self-review only (incremental commits, each tsc + targeted jest green) | Self-approve, no blockers | 偏离 SDD §4.1:采用 Plan A(单 ribbon icon + contextmenu 右键弹 modal),与 SDD 推荐一致。SDD §4 提及的 `VIEW_TYPE_CHAT` / `activateView(VIEW_TYPE_CHAT)` 在仓库中实际为 `VIEW_TYPE_LLM` / `activeChatView()`;实施已对齐现仓库命名。SDD §4.2 假设 `hasConfiguredAPIToken` 可能不存在,实际已存在于 `plugin.ts:1216`,且更具体的 `getAISetupIssue()` 已存在于 `:1222`,空状态 banner 直接复用后者(返回 string \| null,既检测又给文案)。`pa-chat-config-banner` CSS class 在 `custom.pcss` 末端追加,样式微调(gap + max-width),未引入红色错误态。SDD §4.3 要求三张截图(`docs/onboarding-*.png`)与 Manual-CN.md 镜像 — 两者均推迟到 follow-up,残余风险已记入 Phase Ledger 与 Verification Log。`hasConfiguredAPIToken` / `getAISetupIssue` / `activeChatView` 等 helper 全部复用,未引入新 helper。 |
| 2026-06-01 | Combined Step 1 + A1 smoke closeout | User (real Obsidian test vault) | Pass (no blockers) | 用户在 master HEAD `13dbb2b` 上 `make deploy` + 真机 smoke 确认 A3 PR-1 + A5 + A1 tree 全部行为符合预期。三个 SPEC 同步翻 `[x] Done`。v2.2 批 1 + 批 2 PR-1 部分完全闭合,下一步为 SPEC-A4(flag removal)→ SPEC-A2(命令面板)顺序实施。`pre-v2.1.2-merge` → `6a262d8` 回滚锚点保留以备后续 SmokeFix 需要。 |
| 2026-06-01 | SPEC-A4 implementation diff | Self-review only (deletion-only;无逻辑变更;两个 flag 自 v2.0.0 起已是 no-op) | Self-approve, no blockers | 删除 7 处:`settings.ts` 类型字段 (`:70`) + 默认值 (`:140`)、`chat-service.ts` `SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS` import + 三元 `nativeToolPlanningOptions` (折叠为单对象)、`plugin.ts` migrateSettings 两段 (`nativeToolPlanningSmokeEnabled` 归一化 + `paAgentAnswerStreamEnabled` delete 块)、`chat-service.test.ts` fixture 类型字段 + 默认值 (2 处)。`scripts/changelog.mjs` 生成 `Removed (Breaking)` section 记录两 flag 移除及历史背景。`SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS` 常量本身保留(`__tests__/ai-utils.test.ts` 仍引用,SDD §4.1 允许)。Companion commit `b8030b9` 提交属于 A1 build artifact 重新生成 (`styles.css` 加入 `.pa-chat-config-banner` 规则),与 A4 解耦但同一推送。 |
| 2026-06-01 | SPEC-A4 smoke closeout | User (real Obsidian test vault on master HEAD `fd6f9b5`) | Pass (no blockers) | 用户 `make deploy` + 真机 smoke 确认两个 deprecated flag 移除不影响 chat / native tool planning / record-note / search_memory 等主链路;旧 settings 中残留 key 加载亦无错误。SPEC-A4 同步翻 `[x] Done`。v2.2 Step 2 仅余 SPEC-A2(命令面板清理)+ SPEC-A3 H-1(>= 6/12)未闭合。 |
| 2026-06-17 | v2.2+ broad runtime smoke / E-series closeout | Self + Obsidian CLI/runtime evidence | Pass with caveat | Runtime smoke found and fixed SQLite inline WASM `blob:` rejection, Pagelet related-note query timeout/no-results, and Discovery current-current/alias mapping. Obsidian CLI/DOM/screenshots show Memory ready, Type A/C prompt context, Discovery results, Chat/Records/Stats rendering, Operations gate disabled, and no captured errors. Computer Use timed out reading Obsidian twice; 2026-06-18 retry timed out again and System Events saw the Obsidian process with `0` windows, so no new real click-through UI smoke is claimed beyond prior Pagelet GUI smoke evidence。 |

(后续 SPEC review/code review/smoke 评审记录在此追加。)

## Update Rules

- 本 tracker 是 v2 后续发版唯一活跃 SPEC tracker。
- SPEC 状态变化必须同时更新 Current Status、SPEC Index、Phase Ledger、Review Log、Verification Log。
- 决策语言变化必须同步修订 [`v2.1.2-decisions.md`](./v2.1.2-decisions.md) + 本 tracker;不得只动一边。
- 不得将运行时/UI SPEC 标 `[A] Approved for implementation` 而无 Review Log 记录。
- 不得将运行时/UI SPEC 标 `[x] Done` 而无自动化测试 + `make deploy` + Obsidian smoke 证据(或显式 deferral)。
- `[T]` SPEC 触发条件满足时,在 Review Log 记录触发事件,起草正式 SDD,本占位 SPEC 标 `[x] superseded` 并链接到新 SDD。
- file:line 引用以 v2.1.2 为基线;每个 SPEC 进入 `[A]` 前必须 re-grep 验证行号偏移并在 SDD 内修正。
