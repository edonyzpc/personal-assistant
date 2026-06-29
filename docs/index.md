# Documentation Index

This directory is split into current product/runtime contracts and archived
historical records. Root-level docs should remain short, current, and useful for
active work. Completed implementation plans, frozen reviews, and superseded
trackers belong in [archive/](./archive/).

## Current Entry Points

| Area | Current docs |
| --- | --- |
| User workflows | [v2.7 user guide (English)](./v2.7-user-guide-en.md), [v2.7 用户指南](./v2.7-user-guide.md), [Pagelet user guide](./pagelet-user-guide.md), [Pagelet smoke checklist](./pagelet-smoke-checklist.md) |
| Current status | [Project TODO](./todo.md), [Development roadmap](./development-roadmap.md), [Release process](./release-process.md), [Reusable refactor workflow](./refactor-workflow.md) |
| Architecture | [Architecture overview](./architecture-overview.md), [PA Agent architecture](./pa-agent-architecture-plan.md), [Runtime lifecycle](./pa-agent-runtime-lifecycle-plan.md), [Design completion audit](./pa-agent-design-completion-audit.md) |
| PA Agent planning | [Product North Star](./pa-product-north-star.md), [Low-Burden Review principles](./pa-low-burden-review-product-principles.md), [Low-Burden Product Refactor plan](./pa-low-burden-product-refactor-plan.md), [Low-Burden Product Refactor tracker](./pa-low-burden-product-refactor-tracker.md), [Product spec development plan](./pa-agent-product-spec-development-plan.md), [Product spec development tracker](./pa-agent-product-spec-development-tracker.md), [Product spec review plan](./pa-agent-product-spec-review-plan.md), [Research-to-spec coverage audit](./pa-agent-research-to-spec-coverage-audit.md), [Product Information Architecture spec](./pa-product-information-architecture-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Retrieval Habit Profile spec](./pa-retrieval-habit-profile-product-spec.md), [Context Pager spec](./pa-context-pager-product-spec.md), [Weekly Review spec](./pa-weekly-review-product-spec.md), [Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [Eval Harness spec](./pa-eval-harness-product-spec.md), [Data Boundary spec](./pa-data-boundary-product-spec.md), [Latency optimization plan](./pa-agent-latency-optimization-plan.md), [Telemetry baseline](./pa-agent-telemetry-baseline.md), [MCP adapter decision](./pa-agent-mcp-adapter-decision.md), [Product safety review](./pa-agent-product-safety-review.md) |
| Memory / VSS / Statistics | [SQLite/WASM architecture](./vss-sqlite-wasm-architecture.md), [Embedding refresh](./vss-embedding-refresh.md), [Local state plan](./vss-local-state-plan.md), [Statistics v3 plan](./statistics-v3-plan.md) |
| Settings | [Settings current status](./settings-status.md), [historical Settings UI review](./settings-ui-review.md) |
| Pagelet | [Pagelet product design](./pagelet-product-design.md), [Maintenance Review spec](./pagelet-maintenance-review-product-spec.md), [Trust Layer spec](./pagelet-trust-layer-product-spec.md), [Async result plan](./pagelet-async-result-plan.md), [Pagelet SDD guide](./pagelet-sdd-guide.md), [Visual spec](./pagelet-visual-spec.html), [Prototype](./pagelet-prototype.html) |
| Write / Operations | [Write action handoff](./write-action-design-handoff.md), [Write Action Framework](./write-action-framework-sdd.md), [Operations Agent boundary](./operations-agent-plan.md), [Operations Agent mode SDD](./operations-agent-mode-sdd.md), [Obsidian Operations plan](./obsidian-operations-agent-plan.md) |
| Commercial / legal | [2.8.0 license migration](./license-migration-2.8.0.md) |

## Active SDDs

These documents may still drive runtime work or future release gates:

- [React to Preact evaluation placeholder](./sdd-react-preact-evaluation.md)

## Archive

[archive/](./archive/) contains historical implementation plans, completed SDDs, frozen review inputs, and superseded trackers. Archived files are retained for provenance and evidence, not as current implementation authority. If an archived document conflicts with a current entry point above, the current entry point wins.

Archived assets that are kept for provenance but not linked from README or runtime docs live in [archive/assets/](./archive/assets/).
