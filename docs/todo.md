# Project TODO

This file is the current short-form status board. Older release-gate details were
archived to [project-todo-pre-2.8.0.md](./archive/project-todo-pre-2.8.0.md).

## Current Release State

- Current shipped baseline in this worktree: `2.8.4`.
- `package.json`, `package-lock.json`, `manifest.json`, and
  `manifest-beta.json` are aligned at `2.8.4`.
- The `2.8.0` license migration is historical. Current release validation
  belongs in [Release process](./release-process.md); one-time migration
  evidence is retained in [2.8.0 License Migration Sign-Off](./license-migration-2.8.0.md).
- v2.2 through v2.7 implementation trackers are historical; use archived
  records only for evidence and provenance.

## Active Product / Engineering Follow-Ups

| Area | Status | Next decision or action | Evidence |
| --- | --- | --- | --- |
| PA Agent product spec implementation | Complete / release-readiness | Slices 0-G, A2, and M12 are implemented with automated gates and Obsidian smoke evidence. Use the tracker for release-readiness review or define a new approval gate for future scope. | [Product spec development plan](./pa-agent-product-spec-development-plan.md); [tracker](./pa-agent-product-spec-development-tracker.md#next-approval-gates) |
| Operations Agent append mode | Deferred / not exposed | Keep `OPERATIONS_AGENT_RUNTIME_ENABLED=false` until the full action runtime, prompt split, setting semantics, and Obsidian smoke are complete. | `src/operations-agent-flags.ts`; [architecture refactor tracker](./archive/architecture-refactor-development-tracker.md) |
| Operations Agent Phase 2 | Future | Scope replace-section, multi-file edits, command execution, batch-confirm UX, and production audit only after separate product/security review. | [Operations Agent plan](./operations-agent-plan.md); [Operations Agent mode SDD](./operations-agent-mode-sdd.md) |
| User custom Skills (SPEC-C2) | Deferred | Decide the product value and UX before drafting the SDD for allowed tools, Settings UI, and optional vault-side discovery. | [v2 post-release tracker](./archive/v2-post-release-spec-driven-development.md) |
| Obsidian Operations CLI adapter (v1B) | Deferred | Start SPEC-05 only if desktop CLI reads become valuable enough to justify probe, allowlist, timeout, and vault confinement work. | [Obsidian Operations plan](./obsidian-operations-agent-plan.md); [tracker](./archive/obsidian-operations-spec-driven-development.md) |
| Pagelet source-bound async results | Planned | Implement the typed result outcome, in-memory result store, and Pet/Bubble ready-state UX. | [Pagelet async result plan](./pagelet-async-result-plan.md) |
| PA Agent telemetry baseline | Future milestone | Collect at least seven days of opt-in aggregate capability usage before using telemetry to prioritize Operations Agent work. | [Telemetry runbook](./pa-agent-telemetry-baseline.md) |
| PA Agent latency levers | Deferred | Run a focused perf pass for read-only batch audit, compact final-answer experiment, p50/p95 samples, and direct-route go/no-go. | [Latency plan](./pa-agent-latency-optimization-plan.md); [control policy tracker](./archive/pa-agent-control-policy-development-tracker.md) |
| Architecture quality pass | Deferred | Improve prompt/classifier builders, Chat conversation lifecycle extraction, VSS method-body extraction, and plain `tsc --noEmit` DOM/WebWorker tsconfig split. | [architecture refactor tracker](./archive/architecture-refactor-development-tracker.md) |
| Settings IA/componentization | Partially open | Finish broader Settings IA, remaining componentization, Statistics hidden fields, text-input save churn audit, and narrow-screen Metadata UX. | [Settings current status](./settings-status.md); [historical Settings UI review](./settings-ui-review.md); [Settings SDD](./archive/settings-ui-sdd.md) |
| Android VSS real-device validation | Pending verification | Validate the SQLite/WASM VSS backend on a physical Android device before claiming full Android parity. | [README](../README.md#mobile-vss-validation-note) |

## Triggered Evaluations

| Evaluation | Trigger | Source |
| --- | --- | --- |
| React to Preact | A new component depends on React-only features, or a third-party library is incompatible with `preact/compat`. | [SDD placeholder](./sdd-react-preact-evaluation.md) |
| SQLite/WASM inline strategy | Mobile cold start >= 5s, OOM in three independent reports, or passive load P95 >= 5s. | [v2 decisions](./archive/v2.1.2-decisions.md) |
| Write-action production audit | User reports unexplained writes, a visible write-history UI is needed, or compliance review requires durable audit records. | [Write Action Framework SDD](./write-action-framework-sdd.md) |

## Documentation Hygiene

- Keep root `docs/` for current contracts, user guides, and active future plans.
- Move completed implementation plans, frozen reviews, and superseded trackers to
  [archive/](./archive/).
- When archiving a current entry point, preserve the old file and add a short
  replacement or index link so no decision/evidence is lost.
