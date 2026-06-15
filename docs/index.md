# Documentation Index

This directory is split into current product/runtime contracts and archived historical records.

## Current Entry Points

| Area | Current docs |
| --- | --- |
| User workflows | [Pagelet user guide](./pagelet-user-guide.md), [Pagelet smoke checklist](./pagelet-smoke-checklist.md) |
| Project gates | [Project TODO](./todo.md), [Release process](./release-process.md), [Reusable refactor workflow](./refactor-workflow.md) |
| PA Agent | [Architecture plan](./pa-agent-architecture-plan.md), [Runtime lifecycle plan](./pa-agent-runtime-lifecycle-plan.md), [Context management research](./agent-context-management-research.md), [Control policy SDD](./pa-agent-control-policy-sdd.md), [Control policy tracker](./pa-agent-control-policy-development-tracker.md) |
| v2 follow-up | [v2 post-release tracker](./v2-post-release-spec-driven-development.md), [v2.1.2 decisions](./v2.1.2-decisions.md), [v2.1.2 review snapshot](./v2.1.2-comprehensive-review.md), [v2 fix plan](./v2-fix-plan.md) |
| Memory / VSS | [SQLite/WASM architecture](./vss-sqlite-wasm-architecture.md), [Embedding refresh](./vss-embedding-refresh.md), [Local state plan](./vss-local-state-plan.md), [Local state tracker](./vss-local-state-development-tracker.md) |
| Pagelet / Review Assistant | [Pagelet product design](./pagelet-product-design.md), [Pagelet SDD guide](./pagelet-sdd-guide.md), [Historical decisions](./review-assistant-decisions.md), [Visual spec](./pagelet-visual-spec.html), [Write action framework](./write-action-framework-sdd.md) |
| Architecture & Roadmap | [Architecture overview](./architecture-overview.md), [Development roadmap](./development-roadmap.md) |
| Future work | [Operations Agent boundary](./operations-agent-plan.md), [Obsidian Operations plan](./obsidian-operations-agent-plan.md), [Obsidian Operations tracker](./obsidian-operations-spec-driven-development.md), [Write action handoff](./write-action-design-handoff.md) |

## Active SDDs

These documents may still drive runtime work or future release gates:

- [Command palette cleanup](./sdd-command-palette-cleanup.md)
- [Dependency pruning](./sdd-dependency-pruning.md)
- [SQLite WASM supplier migration](./sdd-sqliteai-supplier-migration.md)
- [API token cleanup](./sdd-apitoken-cleanup.md)
- [React to Preact evaluation placeholder](./sdd-react-preact-evaluation.md)
- [SDD rollout plan](./sdd-rollout-plan.md)

## Archive

[archive/](./archive/) contains historical implementation plans, completed SDDs, frozen review inputs, and superseded trackers. Archived files are retained for provenance and evidence, not as current implementation authority. If an archived document conflicts with a current entry point above, the current entry point wins.

Archived assets that are kept for provenance but not linked from README or runtime docs live in [archive/assets/](./archive/assets/).
