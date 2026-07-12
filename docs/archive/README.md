# Documentation Archive

本目录保存已完成、已替代或只用于溯源的设计、SDD、Tracker、review、research 与最终报告。它们不是当前实现状态的权威来源。

- 当前入口：[docs/index.md](../index.md)
- 未完成事项：[docs/backlog.md](../backlog.md)
- 文档生命周期：[Documentation Workflow](../development/documentation-workflow.md)
- 删除/吸收记录：[Disposition Log](./disposition-log.md)
- 新结构化归档：[2026 Archive](./2026/README.md)

如果 archive 与当前 Product Spec、Architecture、活跃 Tracker 或代码冲突，以当前资料和代码为准。需要恢复历史 feature 时，先把仍有效的决策提炼到新的 Product Spec/SDD，不要直接把旧 Tracker 改回 Active。

部分历史正文保留了归档前的 `docs/<filename>.md` 文字路径。若根目录没有该文件、但本索引存在同名文档，应将它解析为 `docs/archive/<filename>.md`；当前文档不得继续使用这种历史简写。

既有历史文档继续保留扁平结构；新 Closeout 必须保留完整 package 到 `docs/archive/<year>/<feature>/`，避免通用 `plan.md` / `sdd.md` / `tracker.md` 重名。年度 README 是新 package 的索引，Feature Home 是包内入口。

## 快速定位

| 主题 | 推荐入口 |
| --- | --- |
| PA Agent 完整开发记录 | [Product spec tracker](./pa-agent-product-spec-development-tracker.md), [runtime/control records](./pa-agent-control-policy-development-tracker.md) |
| PA Product Redesign / Pagelet | [Redesign tracker](./pa-product-redesign-development-tracker.md), [Tab tracker](./pagelet-tab-restructure-tracker.md), [Bubble SDD](./pagelet-bubble-readiness-and-recall-sdd.md) |
| Memory Control Center | [Product intake](./pa-memory-control-center-optimization-plan.md), [SDD](./pa-memory-control-center-sdd.md), [tracker](./pa-memory-control-center-development-tracker.md) |
| UI/UX audit 与优化 | [Audit](./pa-ui-ux-audit-report.md), [plan](./pa-ui-ux-optimization-plan.md), [tracker](./pa-ui-ux-optimization-tracker.md) |
| Repo-wide optimization | [2026-07-10 final report](./repo-wide-optimization-2026-07-10-final-report.md) |
| v2.x 版本与 release 历史 | [v2 post-release tracker](./v2-post-release-spec-driven-development.md), [v2.7 roadmap](./development-roadmap-v2.7.md), [2.8.0 migration](./license-migration-2.8.0.md) |
| Memory/VSS/SQLite 历史 | [VSS implementation plan](./vss-sqlite-wasm-implementation-plan.md), [local-state tracker](./vss-local-state-development-tracker.md), [spike report](./sqlite-wasm-spike-report.md) |
| 旧 Review Assistant / AI Insight | [Review Assistant SDD](./review-assistant-sdd.md), [AI Insight activation plan](./ai-insight-activation-plan.md) |

## 完整索引

以下列表按文件名排序，覆盖本目录全部 Markdown；移动或新增 archive 文档时必须同步更新。

- [2026 structured archive](./2026/README.md)
- [disposition-log.md](./disposition-log.md)

- [agent-context-management-research.md](./agent-context-management-research.md)
- [agent-memory-extraction-research.md](./agent-memory-extraction-research.md)
- [ai-insight-activation-development-plan.md](./ai-insight-activation-development-plan.md)
- [ai-insight-activation-plan.md](./ai-insight-activation-plan.md)
- [ai-insight-foundation-audit.md](./ai-insight-foundation-audit.md)
- [ai-insight-improvement-analysis.md](./ai-insight-improvement-analysis.md)
- [architecture-refactor-development-tracker.md](./architecture-refactor-development-tracker.md)
- [architecture-refactor-plan.md](./architecture-refactor-plan.md)
- [chat-agent-architecture.md](./chat-agent-architecture.md)
- [chat-agent-development-tracker.md](./chat-agent-development-tracker.md)
- [chat-agent-phase2-readonly-tools-plan.md](./chat-agent-phase2-readonly-tools-plan.md)
- [chat-timeline-identicon-tech-selection.md](./chat-timeline-identicon-tech-selection.md)
- [community-scan-remediation-plan.md](./community-scan-remediation-plan.md)
- [development-roadmap-v2.7.md](./development-roadmap-v2.7.md)
- [external-ai-assistant-research-redacted.md](./external-ai-assistant-research-redacted.md)
- [featured-image-model-upgrade-plan.md](./featured-image-model-upgrade-plan.md)
- [featured-image-model-upgrade-spec-driven-development.md](./featured-image-model-upgrade-spec-driven-development.md)
- [license-migration-2.8.0.md](./license-migration-2.8.0.md)
- [mobile-network-optimization-plan.md](./mobile-network-optimization-plan.md)
- [obsidian-operations-spec-driven-development.md](./obsidian-operations-spec-driven-development.md)
- [pa-agent-ai-insight-research-reading-pack.md](./pa-agent-ai-insight-research-reading-pack.md)
- [pa-agent-ai-insight-research-report.md](./pa-agent-ai-insight-research-report.md)
- [pa-agent-answer-completion-policy-plan.md](./pa-agent-answer-completion-policy-plan.md)
- [pa-agent-architecture-plan-pre-v2-closeout.md](./pa-agent-architecture-plan-pre-v2-closeout.md)
- [pa-agent-control-policy-development-tracker.md](./pa-agent-control-policy-development-tracker.md)
- [pa-agent-control-policy-sdd.md](./pa-agent-control-policy-sdd.md)
- [pa-agent-design-completion-audit.md](./pa-agent-design-completion-audit.md)
- [pa-agent-latency-optimization-plan.md](./pa-agent-latency-optimization-plan.md)
- [pa-agent-product-safety-review.md](./pa-agent-product-safety-review.md)
- [pa-agent-product-spec-development-plan.md](./pa-agent-product-spec-development-plan.md)
- [pa-agent-product-spec-development-tracker.md](./pa-agent-product-spec-development-tracker.md)
- [pa-agent-product-spec-review-plan.md](./pa-agent-product-spec-review-plan.md)
- [pa-agent-research-to-spec-coverage-audit.md](./pa-agent-research-to-spec-coverage-audit.md)
- [pa-agent-runtime-lifecycle-plan-implementation-record.md](./pa-agent-runtime-lifecycle-plan-implementation-record.md)
- [pa-commercialization-analysis-2026-07-08.md](./pa-commercialization-analysis-2026-07-08.md)
- [pa-low-burden-product-refactor-plan.md](./pa-low-burden-product-refactor-plan.md)
- [pa-low-burden-product-refactor-tracker.md](./pa-low-burden-product-refactor-tracker.md)
- [pa-memory-control-center-development-plan.md](./pa-memory-control-center-development-plan.md)
- [pa-memory-control-center-development-tracker.md](./pa-memory-control-center-development-tracker.md)
- [pa-memory-control-center-optimization-plan.md](./pa-memory-control-center-optimization-plan.md)
- [pa-memory-control-center-sdd.md](./pa-memory-control-center-sdd.md)
- [pa-product-discussion-2026-07-02.md](./pa-product-discussion-2026-07-02.md)
- [pa-product-north-star-zh.md](./pa-product-north-star-zh.md)
- [pa-product-redesign-development-plan.md](./pa-product-redesign-development-plan.md)
- [pa-product-redesign-development-tracker.md](./pa-product-redesign-development-tracker.md)
- [pa-ui-ux-audit-report.md](./pa-ui-ux-audit-report.md)
- [pa-ui-ux-optimization-plan.md](./pa-ui-ux-optimization-plan.md)
- [pa-ui-ux-optimization-tracker.md](./pa-ui-ux-optimization-tracker.md)
- [pa-weekly-review-product-spec.md](./pa-weekly-review-product-spec.md)
- [pagelet-async-result-plan.md](./pagelet-async-result-plan.md)
- [pagelet-bubble-next-iteration-context-2026-07-05.md](./pagelet-bubble-next-iteration-context-2026-07-05.md)
- [pagelet-bubble-product-discussion-2026-07-05.md](./pagelet-bubble-product-discussion-2026-07-05.md)
- [pagelet-bubble-readiness-and-recall-sdd.md](./pagelet-bubble-readiness-and-recall-sdd.md)
- [pagelet-maintenance-review-product-spec.md](./pagelet-maintenance-review-product-spec.md)
- [pagelet-next-work-plan.md](./pagelet-next-work-plan.md)
- [pagelet-tab-restructure-plan.md](./pagelet-tab-restructure-plan.md)
- [pagelet-tab-restructure-sdd.md](./pagelet-tab-restructure-sdd.md)
- [pagelet-tab-restructure-tracker.md](./pagelet-tab-restructure-tracker.md)
- [pagelet-trust-layer-product-spec.md](./pagelet-trust-layer-product-spec.md)
- [pr-376-review-report.md](./pr-376-review-report.md)
- [project-todo-pre-2.8.0.md](./project-todo-pre-2.8.0.md)
- [rag-hybrid-retrieval-plan.md](./rag-hybrid-retrieval-plan.md)
- [repo-wide-optimization-2026-07-10-final-report.md](./repo-wide-optimization-2026-07-10-final-report.md)
- [review-assistant-decisions.md](./review-assistant-decisions.md)
- [review-assistant-design-review.md](./review-assistant-design-review.md)
- [review-assistant-product-design.md](./review-assistant-product-design.md)
- [review-assistant-sdd.md](./review-assistant-sdd.md)
- [sdd-ai-insight-foundation.md](./sdd-ai-insight-foundation.md)
- [sdd-apitoken-cleanup.md](./sdd-apitoken-cleanup.md)
- [sdd-architecture-refactor.md](./sdd-architecture-refactor.md)
- [sdd-calc-snapshot-incremental.md](./sdd-calc-snapshot-incremental.md)
- [sdd-chat-history-persistence.md](./sdd-chat-history-persistence.md)
- [sdd-chat-onboarding-flow.md](./sdd-chat-onboarding-flow.md)
- [sdd-chat-tools-split.md](./sdd-chat-tools-split.md)
- [sdd-command-palette-cleanup.md](./sdd-command-palette-cleanup.md)
- [sdd-dependency-pruning.md](./sdd-dependency-pruning.md)
- [sdd-deprecated-flags-removal.md](./sdd-deprecated-flags-removal.md)
- [sdd-graph-aware-retrieval.md](./sdd-graph-aware-retrieval.md)
- [sdd-prompt-and-token-quality.md](./sdd-prompt-and-token-quality.md)
- [sdd-react-preact-evaluation.md](./sdd-react-preact-evaluation.md)
- [sdd-required-capability-refactor.md](./sdd-required-capability-refactor.md)
- [sdd-rollout-plan.md](./sdd-rollout-plan.md)
- [sdd-search-pipeline-parallelization.md](./sdd-search-pipeline-parallelization.md)
- [sdd-sqliteai-supplier-migration.md](./sdd-sqliteai-supplier-migration.md)
- [sdd-strict-mode-and-coverage.md](./sdd-strict-mode-and-coverage.md)
- [sdd-tool-registry-collapse.md](./sdd-tool-registry-collapse.md)
- [sdd-trivial-cleanups.md](./sdd-trivial-cleanups.md)
- [sdd-type-a-llm-extraction.md](./sdd-type-a-llm-extraction.md)
- [sdd-wasm-lazy-load.md](./sdd-wasm-lazy-load.md)
- [settings-ui-review.md](./settings-ui-review.md)
- [settings-ui-sdd.md](./settings-ui-sdd.md)
- [sqlite-wasm-spike-report.md](./sqlite-wasm-spike-report.md)
- [statistics-v3-development-tracker.md](./statistics-v3-development-tracker.md)
- [v2-comprehensive-code-review.md](./v2-comprehensive-code-review.md)
- [v2-fix-plan.md](./v2-fix-plan.md)
- [v2-post-release-spec-driven-development.md](./v2-post-release-spec-driven-development.md)
- [v2.1.2-comprehensive-review.md](./v2.1.2-comprehensive-review.md)
- [v2.1.2-decisions.md](./v2.1.2-decisions.md)
- [v2.3-implementation-plan.md](./v2.3-implementation-plan.md)
- [v2.7-user-guide-en.md](./v2.7-user-guide-en.md)
- [v2.7-user-guide.md](./v2.7-user-guide.md)
- [v2.8.1-feedback-fix-plan.md](./v2.8.1-feedback-fix-plan.md)
- [vault-native-assistant-development-tracker.md](./vault-native-assistant-development-tracker.md)
- [vault-native-assistant-refactor-plan.md](./vault-native-assistant-refactor-plan.md)
- [vss-dirty-state-optimization-plan.md](./vss-dirty-state-optimization-plan.md)
- [vss-local-state-development-tracker.md](./vss-local-state-development-tracker.md)
- [vss-sqlite-wasm-architecture-pre-official-wasm-migration.md](./vss-sqlite-wasm-architecture-pre-official-wasm-migration.md)
- [vss-sqlite-wasm-development-tracker.md](./vss-sqlite-wasm-development-tracker.md)
- [vss-sqlite-wasm-implementation-plan.md](./vss-sqlite-wasm-implementation-plan.md)
- [write-action-design-handoff.md](./write-action-design-handoff.md)

## Assets

历史原型与历史资源在 [assets/](./assets/)。当前 README/文档使用的媒体在 [docs/assets/](../assets/)。
