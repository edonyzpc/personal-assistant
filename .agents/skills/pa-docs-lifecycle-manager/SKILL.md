---
name: pa-docs-lifecycle-manager
description: Route Personal Assistant ideas, decisions, planning, implementation, continuation, status, closeout, and archive requests from ordinary language. Use for requests such as "记录一个 PA idea", "继续推进", "先规划并实现", "需要我决定什么", or "帮我收尾". Keep casual ideas conversation-local, persist only explicit capture or promoted work, use the lightest repo authority lane, route substantial delivery to sdd-lifecycle, and keep Git/release authority explicit.
---

# PA Docs Lifecycle Manager

## Contract

Act as a low-burden router. Infer lanes, IDs, paths, and status transitions; do
not ask the user to operate the documentation system. Ask only about product
judgment, risk acceptance, target ambiguity, or implementation/Git/release
authority.

An explicit `review-only`, `analysis-only`, `read-only`, `no-file-changes`,
“只分析”, “不要改文件”, or equivalent request means **zero writes**. This guard
overrides every route below. Quoted, historical, negated, and hypothetical
phrases do not grant write authority.

## Read Minimally

1. Inspect `git status --short`, focused diffs, and search by ID/slug/concept.
2. Read only the matching current authority: Backlog/Discovery for intake,
   Decision/Product Spec for product behavior, Governance Contract for repo
   tooling, and Tracker for execution status.
3. Read the relevant section of
   `docs/development/documentation-workflow.md`; read a template only when
   creating that artifact.
4. Read Archive only when a current authority cites historical rationale or a
   closeout must decide whether unique evidence deserves retention.

Do not preload Roadmap, every index, every contract, templates, or Archive.

## Route Intent

| Intent | Route | Stop point |
| --- | --- | --- |
| Casual idea or feedback | Discuss in chat; create no `B-xxx` | Zero repo writes |
| “记录 / 保存” | Deduplicate; create or reuse one minimal Backlog row | Durable capture only |
| Analysis or discussion | Read-only unless cross-session preservation is explicit | Findings or a compact Discovery Brief |
| Product decision / version candidate / cross-session execution | Create or reuse `B-xxx`, then use the matching authority lane | Authority established |
| “先规划 / 不写代码” | Create only artifacts justified by complexity | Stop before implementation |
| “实现 / 修复 / 先规划并实现” | L0 for a narrow contract-restoring fix; otherwise route to `sdd-lifecycle` | Validated implementation; no commit/closeout |
| “继续” | Resolve explicit ID/slug, then current-conversation package, then the only active package | Current authorized phase |
| “收尾 / 关闭 / 归档” | Reconcile evidence and apply the closeout retention rule | Closed/Cancelled/Superseded |
| Status / “需要我决定什么” | Read current authority and return one compact decision card | Read-only brief |

For continuation, if zero or multiple candidates remain after the ordered
resolution above, ask one target question and perform zero writes.

Planning plus implementation selects `sdd-lifecycle`
`implement-approved-spec`; it does not authorize closeout, commit, push, tag,
publish, or release. Only explicit full-lifecycle or closeout language selects
`full-lifecycle`.

## Choose One Authority Lane

- Product behavior, runtime, UI, data, privacy, or permissions: Accepted
  Decision + Product Spec.
- Repo documentation, checker, CI/release tooling, or Agent workflow without
  product behavior changes: Current Governance Contract.
- Narrow restoration of an existing contract: affected code/doc plus focused
  regression evidence; do not create lifecycle scaffolding.

Existing external tracker links are provenance only. Do not use an external
tracker as the default inbox, planning mirror, state authority, or sync gate.

## Keep Delivery Lean

- Tracker is the only delivery-status and execution authority.
- Active Registry is link-only. Feature Home is a short routing page; neither
  mirrors Tracker status.
- An Active Package starts with `README.md` and `tracker.md`.
- Add `plan.md` only for phased, risky, or cross-session delivery.
- Add `sdd.md` only when source-verified design is needed for behavior, data,
  lifecycle, compatibility, or multi-module change.
- Route substantial implementation/review/smoke work to `sdd-lifecycle`.
- Put out-of-scope findings in Backlog instead of silently expanding scope.

## Closeout And Archive

Close only against real validation evidence and explicit closeout authority.

1. Reconcile actual behavior with the durable Product/Architecture/Governance
   contract and Tracker.
2. Move unresolved work to Backlog with a restart condition.
3. Absorb final behavior, decisions, and validation into current durable
   contracts or focused tests.
4. Delete process artifacts after absorption by default.
5. Archive only unique rationale, migration/release/incident evidence, or a
   compact final report that current source or documentation still cites. Do
   not archive a complete package merely because it existed.
6. Keep delivered Governance Contracts current. Archive Cancelled/Superseded
   contracts only when their terminal rationale remains useful; a Superseded
   contract must identify its Current successor.

If a chosen archive destination already exists, fail closed: do not overwrite,
merge, auto-suffix, or partially move content.

## Decisions, Skills, And Output

Ask at most one ordinary decision at a time. Batch 3-5 cards only when the user
explicitly requests a decision queue; keep it read-only until answered.

Use `sdd-lifecycle` for substantial delivery, PA review skills for code review,
and the appropriate smoke/release skill only when the authorized phase needs
it. Route an explicit commit request through `codex-commit` when available.

After docs changes run:

```bash
npm run docs:check
git diff --check
```

Docs-only work does not require Build or Obsidian smoke. Report changed
authorities, validation, unresolved decisions, and ungranted Git/release
actions; do not explain the hierarchy unless asked.
