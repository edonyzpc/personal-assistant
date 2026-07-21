---
name: sdd-lifecycle
description: Orchestrate staged SDD work for non-trivial personal-assistant features with explicit plan-only, SDD-only, implement-approved-spec, and full-lifecycle authorization modes. Use when explicitly invoked or routed by pa-docs-lifecycle-manager to plan a feature, draft or review an SDD, implement approved product scope, track progress, or run an explicitly requested full lifecycle. Treat "plan and implement" as implement-approved-spec that may bootstrap missing Plan/SDD and stops after validated implementation; run closeout/archive only after explicit full-lifecycle or closeout intent. Keep commits separately authorized. For one-file bug fixes, use the focused review/fix/test path.
---

# SDD Lifecycle

## Core Boundaries

Choose the narrowest mode authorized by the request. Do not treat planning as
permission to implement, implementation as permission to commit, or a local
commit as permission to push.

An upstream explicit `review-only`, `analysis-only`, `read-only`,
`no-file-changes`, “只分析”, or “不要改文件” request means **zero writes**. Do
not create planning artifacts, edit runtime, update trackers, or touch git.

When resuming work directly, accept an explicit `B-xxx`/slug first, then a
current-conversation Active Package, then the only Active Package. If the target
is still absent or ambiguous, ask one target question and perform zero writes.

Read these current sources before acting:

1. `AGENTS.md`
2. `docs/index.md`, `docs/development-roadmap.md`, and `docs/backlog.md`
3. `docs/product/pa-product-north-star.md` and the related Product Spec for PA
   behavior, or the related Governance Contract for repo-only governance work
4. `docs/development/documentation-workflow.md`
5. `docs/development/workflows/refactor-workflow.md` for repo-scale work
6. The active Feature Home, architecture docs, plan, SDD, tracker, and nearby code/tests

Treat `docs/archive/` as historical evidence, not current approval. Read
`../../../docs/development/templates/tracker.md` only when creating a tracker.

## Authorization Modes

| Mode | Select when | Allowed work | Stop point |
| --- | --- | --- | --- |
| `plan-only` | The user asks to plan, scope, or design a feature | Inspect evidence; draft or update approved product scope, plan, and tracker | Stop before SDD and runtime edits |
| `sdd-only` | The user asks to write or review an implementation SDD | Verify the approved plan and write/review the SDD | Stop before runtime edits |
| `implement-approved-spec` | The user asks to implement approved product scope, including “先规划并实现 / plan and implement”; Plan/SDD may be missing | Bootstrap required Plan/SDD, implement, test, review, fix, smoke, and update active tracking artifacts | Stop after validated implementation; no closeout or commit |
| `full-lifecycle` | The user explicitly asks for “full lifecycle / 完整生命周期 / 端到端做到收尾”, closeout, or archive | Run planning through closeout | Stop after artifacts, validation, closeout, and archive agree |

If the request is ambiguous, choose the earlier mode. Ask only when moving to a
later mode would materially change product semantics or user authority.
“Plan and implement” is not full-lifecycle authority. Implementation never
implies closeout, archive, or commit.

When an explicit “实现 / 落地 / 修复 / 先规划并实现” request selects
`implement-approved-spec`, treat creation and source-review of a missing
Plan/SDD as an authorized implementation prerequisite. Stop only when approved product scope is missing,
the design exposes a new product/risk decision, or the requested runtime/Git
boundary remains ambiguous; do not ask the user to authorize the document phase
itself. Treat Plan/SDD approval as a source-review gate, not a ceremonial user
confirmation: when no user-owned product or risk decision remains, complete the
review and record approval automatically.

## Artifact Routing

- Keep current Product Specs in `docs/product/specs/`.
- Keep repo-only documentation/checker/CI/release-tooling/Agent-skill contracts
  in `docs/development/governance/`. Use exactly one authority lane per Active
  Package. If the work changes PA runtime or user behavior, use the Product
  Decision/Product Spec lane; never disguise engineering governance as a
  Product Spec.
- Start active planning work in `docs/development/active/<feature>/` with
  `README.md`, `plan.md`, and `tracker.md`; add `sdd.md` in Phase 1. Never
  fabricate an empty SDD for a plan-only or pre-SDD cancelled track.
- Use `docs/development/templates/` as the canonical artifact templates; do not
  maintain a second project tracker format inside this skill.
- Keep workflow documents in `docs/development/workflows/`; do not create a
  feature-specific workflow there.
- Keep only unresolved, not-yet-active work in `docs/backlog.md`.
- Follow `docs/development/documentation-workflow.md` for closeout and archive
  placement.

Do not create long plan/SDD packages for an unapproved idea. Return raw or
unapproved intake to `pa-docs-lifecycle-manager`; casual ideas remain
conversation-local until explicit durable capture or another promotion gate is
met.

## Phase 0: Plan

Run when planning does not already exist in `plan-only`, `sdd-only`, and
`full-lifecycle`. Also run in `implement-approved-spec` when approved product
scope exists but the Plan/Active Package is missing; this is prerequisite
bootstrap, not closeout authority.

1. Verify the feature against the North Star and current decisions.
2. Read or update the selected authority contract: Product Spec after product
   scope is approved, or Governance Contract for explicitly authorized
   repo-only governance work.
3. Create `docs/development/active/<feature>/README.md`, `plan.md`, and
   `tracker.md`, then register the Feature Home in
   `docs/development/active/README.md`.
4. Define goals, non-goals, dependencies, risks, validation strategy, rollback,
   and explicit stop points.
5. Grep the actual codebase for the dependency surface.
6. Review and revise the plan until it is internally consistent and approved.

Exit with an approved plan and tracker. Stop here in `plan-only`; otherwise
continue only through the selected mode. Do not commit unless the user
explicitly asked for a commit.

## Phase 1: SDD

Run in `sdd-only` and `full-lifecycle` modes. In `implement-approved-spec`,
require an approved SDD whenever the work changes module boundaries, shared
infrastructure, product behavior, lifecycle, data, privacy, or multiple files.
If it is missing and approved product scope exists, create and source-review it
as an already-authorized implementation prerequisite. Do not request ceremonial
authorization for the missing Plan or SDD, and do not convert the mode to
`full-lifecycle`.

1. Write `docs/development/active/<feature>/sdd.md` with interfaces, data flow,
   lifecycle, migration, rollback, shared resources, and test matrix.
2. Verify every existing method, type, file, setting key, command ID, locale key,
   and CSS class named in the SDD with `rg`.
3. Mark proposed names explicitly instead of presenting them as current code.
4. Audit compatibility with persisted state, old settings, desktop/mobile, and
   Obsidian mount/unmount/reload behavior.
5. Review, fix, and repeat until no P0/P1/P2 design findings remain or the user
   explicitly defers them.

Exit with an approved, source-verified SDD. In `sdd-only`, stop here.

## Phase 2: Implement

Run only in `implement-approved-spec` or `full-lifecycle` mode.

For each behavior slice, loop:

```text
implement -> focused validation -> review -> fix -> verify
```

1. Confirm the selected Product Spec or Governance Contract, plan, SDD, and
   tracker agree before editing code.
2. Mark the active tracker slice `[~]` and keep scope/non-goals visible.
3. Implement through existing module boundaries and update regression tests in
   the same slice.
4. Run the **Local Validation Gate** from `AGENTS.md`, scoped to the changed
   surface. Do not copy or redefine that gate in this skill.
5. Use `personal-assistant-review` for the review pass and
   `personal-assistant-review-followup` for confirmed fixes.
6. Re-run the smallest checks that prove each fix, then re-review the trigger.

Do not run `make deploy` after every batch. Use it when app-runtime confidence
is required, including runtime/UI/shared-infrastructure behavior and the final
gate specified by the active plan.

## Phase 3: Final Review and Smoke

1. Run a final `personal-assistant-review` pass over the complete scoped diff.
2. Triage and fix only confirmed findings authorized by the implementation
   request.
3. Use `obsidian-test-vault-smoke` at the lightest tier that proves the changed
   behavior.
4. Require `make deploy` plus observed test-vault behavior for runtime/UI work.
5. Use `obsidian-ios-real-device-smoke` only when real-device behavior is in
   scope.
6. Use `obsidian-community-check` for the release/community gate when required.
7. Repeat review/fix/verification until no unresolved P0/P1/P2 findings remain
   or the user explicitly defers them.

Do not claim Obsidian validation without deployed, observed evidence.

## Phase 4: Closeout

Run closeout only for `full-lifecycle` or when the user explicitly asks to close
or archive the active track. Never enter this phase merely because
`implement-approved-spec` reached validated implementation.

Before any terminal-status edit, closeout document creation, rename, or move:

1. Resolve the exact `docs/archive/<year>/<feature>/` target.
2. Read the annual and root Archive indexes and inspect that exact path.
3. If the exact archive target already exists, fail closed. Do not merge,
   overwrite, auto-suffix, change source statuses, or partially archive. Report
   the collision and wait for one explicit target decision.

After the preflight passes:

1. Reconcile the selected Product Spec or Governance Contract, architecture,
   plan, SDD, tracker, and actual behavior.
2. Record focused checks, review findings, smoke evidence, risks, and decisions
   in the tracker, then create `closeout.md` from the canonical template.
3. Move unresolved follow-up into `docs/backlog.md` without duplicating the
   design.
4. Follow `docs/development/documentation-workflow.md`: retain durable product
   and governance contracts only when delivered, map every artifact disposition,
   archive Cancelled/Superseded governance records under the annual Archive,
   and move the complete package to `docs/archive/<year>/<feature>/`.
5. Update affected indexes and links.

## Commit Boundary

Do not stage, commit, push, tag, or publish unless the user explicitly requests
that exact level of git action.

When a local commit is requested:

1. Inspect `git status --short`, `git diff --stat`, and targeted diffs.
2. Stage only intended files.
3. Use a non-interactive Conventional Commit with sign-off, for example
   `git commit -s -m "feat(<scope>): <summary>"`.
4. Do not add `Co-Authored-By` trailers.
5. Keep runtime/tests, docs/tracker, backlog, and release changes split by intent.

## Output

Report:

- selected authorization mode and stop point
- artifacts created or updated
- implementation and review status, when authorized
- validation run and validation not run
- unresolved decisions, deferred findings, and residual risk

Never imply that a later phase, commit, smoke tier, or release action ran when it
did not.

## Related Skills and Docs

- `pa-docs-lifecycle-manager`: natural-language intake, authority routing, and
  automatic repo-doc maintenance before/around this staged delivery workflow
- `personal-assistant-review`: code-level review methodology
- `personal-assistant-review-followup`: finding triage and confirmed fixes
- `obsidian-test-vault-smoke`: local app/runtime/UI validation
- `obsidian-ios-real-device-smoke`: real-device iOS validation
- `obsidian-community-check`: community compliance gate
- `docs/development/workflows/pagelet-sdd-guide.md`: Pagelet-specific delivery
- `docs/development/workflows/refactor-workflow.md`: repo-scale phase loop
