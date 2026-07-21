---
name: sdd-lifecycle
description: Deliver non-trivial Personal Assistant work with explicit plan-only, sdd-only, implement-approved-spec, and full-lifecycle modes. Use when routed by pa-docs-lifecycle-manager or explicitly asked to plan, design, implement approved scope, continue an active track, or close it. Create Plan and SDD only when complexity requires them, stop plan-and-implement after validated implementation, and keep closeout, commit, push, tag, publish, and release separately authorized.
---

# SDD Lifecycle

## Boundaries

Choose the earliest mode authorized by the request. An upstream `review-only`,
`analysis-only`, `read-only`, `no-file-changes`, “只分析”, or “不要改文件”
request means **zero writes**.

| Mode | Allowed work | Stop point |
| --- | --- | --- |
| `plan-only` | Scope approved work; create a Plan only when phased/risky delivery needs one | Before implementation design/code |
| `sdd-only` | Write or review source-verified implementation design | Before runtime edits |
| `implement-approved-spec` | Create justified prerequisites, implement, test, review, fix, and validate | Validated implementation; no closeout/commit |
| `full-lifecycle` | Delivery plus explicitly requested closeout | Contracts reconciled and process artifacts disposed |

“Plan and implement” is `implement-approved-spec`; it never implies closeout,
archive, or commit. If target resolution remains ambiguous after explicit
ID/slug, current-conversation package, and the only Active Package, ask one
target question and perform zero writes.

## Read Set

Read `AGENTS.md`, the owning Product Spec or Governance Contract, the matching
Tracker, and nearby architecture/code/tests. Read North Star for product work.
Read Plan/SDD only when they exist or the change justifies creating them. Treat
Archive as historical evidence, not approval.

## Artifacts

- Use exactly one authority lane: Product Decision/Spec for product behavior;
  Governance Contract for repo-only docs/checker/CI/release/Agent rules.
- Baseline Active Package: `README.md` + `tracker.md`.
- Add `plan.md` for phased delivery, material dependencies, risk, rollback, or
  cross-session execution.
- Add `sdd.md` for multi-module design, shared infrastructure, behavior/data/
  privacy/lifecycle changes, compatibility, migration, or non-trivial UI state.
- Tracker is the only execution status and validation log. Active Registry and
  Feature Home contain links, not status mirrors.
- Follow `docs/development/documentation-workflow.md` for exact lifecycle and
  retention rules; do not duplicate its templates inside this skill.

## Plan And Design

Before implementation:

1. Confirm approved product scope or explicit governance authority.
2. Search the actual dependency surface with `rg`.
3. Create/update Feature Home and Tracker; register the Feature Home.
4. Create a Plan only when its delivery/risk content would not fit concisely in
   Tracker.
5. Create an SDD only when the design criteria above apply. Verify every named
   method, type, setting, command, locale key, and CSS class against source.
6. Record compatibility, rollback, and a requirement-to-test mapping where
   relevant. Close or explicitly defer P0/P1/P2 design findings.

Missing Plan/SDD in `implement-approved-spec` is not a separate user approval
gate: create only what the implementation genuinely requires. Stop if product
scope or risk acceptance is unresolved.

## Implement And Validate

For each behavior slice:

```text
implement -> focused validation -> review -> fix -> verify
```

Keep the Tracker current, use existing module boundaries, and add regression
tests with the changed behavior. Run the Local Validation Gate from `AGENTS.md`
at the scope justified by the change. Use PA review/follow-up skills for
implementation review.

Use `make deploy` and observed Obsidian smoke only when runtime/UI/shared
infrastructure confidence is required. Do not claim app or iOS validation
without observed evidence.

## Closeout

Enter only in `full-lifecycle` or after explicit close/archive intent.

1. Reconcile actual behavior, current Product/Architecture/Governance contract,
   Tracker, and release state.
2. Record final checks and residual risk; move unresolved work to Backlog.
3. Absorb durable outcomes into current contracts/tests.
4. Delete Feature Home, Tracker, Plan, SDD, handoff, and round-by-round logs
   after absorption unless one contains unique evidence.
5. Retain only a compact closeout or evidence document when a current authority
   needs the historical rationale. Place it in `docs/archive/<year>/` and link
   it from that authority; do not preserve a complete package by default.
6. Update the link-only Active Registry and run docs validation.

If a selected archive path exists, fail closed before mutating source state; do
not overwrite, merge, auto-suffix, or partially move it.

## Git Boundary And Output

Do not stage, commit, push, tag, publish, or release without explicit authority.
For a requested local commit, inspect status and focused diffs, stage only the
intended files, use a signed-off Conventional Commit, and add no
`Co-Authored-By` trailer.

Report the selected mode, artifacts justified or omitted, validation performed,
open decisions, residual risk, and the exact stop point.
