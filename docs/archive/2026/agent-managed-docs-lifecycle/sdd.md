# Agent-Managed Docs Lifecycle Software Design Document

Document status: Archived
Updated: 2026-07-12
Work item: B-115
Authority: 本 track 的归档 source-verified implementation design、兼容性、风险与 test matrix。
Governance contract: [GOV-001 Agent-Managed Project Lifecycle](../../../development/governance/gov-001-agent-managed-project-lifecycle.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

## Pre-B-115 Source Baseline

以下是 B-115 实施前的 source-verified baseline；对应缺口现已修复并由
[Tracker](./tracker.md#validation-log) 的最终证据覆盖：

- `scripts/check-docs.mjs` 当时已有 Markdown reachability、metadata、Active/Archive package 与 Git diff continuity gate，但 HTML、本地 disposition target、legacy `T-xxx` 和 tag baseline 存在缺口。
- `pa-docs-lifecycle-manager`、`pa-linear-product-manager` 与 `sdd-lifecycle` 当时已覆盖主要流程，但 raw idea、read-only、plan-and-implement、continue target 和 archive collision 仍有重叠。
- `.github/workflows/ci.yml` 当时已传 PR/push base；tag release workflow 尚未建立等价 baseline。

## Authority Ownership

- Linear：raw intake、优先级、版本、依赖和高层状态 mirror。
- Repo Governance Contract：不改变 PA runtime/用户行为的 engineering workflow/tooling contract；若跨越该边界才进入 Product Decision/Spec。
- Active Tracker：唯一 delivery status 与验证 authority。
- Archive Closeout：终态结果与过程信息 disposition。
- 外部状态不得单独证明实现、smoke 或 release。

## Intake And Promotion State Machine

```text
raw idea -> Linear Inbox only
needs decision | version candidate | cross-session research/execution
  -> allocate one stable Backlog ID -> bidirectional link -> repo lifecycle
```

Duplicate ideas update the canonical Linear issue. Linear write failure returns
an explicit uncaptured result; it must not silently create a different authority
or claim success.

B-115 本身来自用户直接授权的 engineering bootstrap，不是 raw Linear idea，也不
声称经过上述 promotion。该 state machine 约束未来 PA idea intake。

## Authorization And Target Resolution

- Explicit review-only/analysis-only/no-file-changes overrides every repo/Linear write route.
- Plan-and-implement uses `implement-approved-spec` with authorized Plan/SDD bootstrap and stops at validated implementation.
- Full lifecycle/Phase 4 requires explicit complete/closeout/archive language.
- Continue target order: explicit B-ID/slug, current-session package, unique Active Package; otherwise ask once before any write.
- Archive destination must not already exist; conflicts stop before move and never merge/overwrite evidence.

## Documentation Integrity Gates

- Validate local Markdown and HTML `href/src` targets.
- Treat a deletion as a move only with Git/content continuity, never basename alone.
- Require an existing repo-local Markdown destination for every absorption/deletion disposition.
- Audit stable Backlog IDs and legacy `T-xxx` removal against promotion or terminal evidence.
- Reject direct annual `Closed` records and incomplete/unknown Closeout disposition rows.
- Tag release resolves a real prior release/root baseline before `docs:check`.

## Compatibility, Migration And Rollback

- Existing Linear issues and current stable Backlog IDs are unchanged.
- Existing archived history is not mechanically rewritten.
- Current untracked docs moves remain valid only when content continuity or explicit disposition proves their destination.
- Reverting the new routing contract must use a successor Governance Contract；只有同时改变 PA runtime/用户行为时才创建 Product Decision/Spec，不得独立恢复冲突的 skill prose。

## Test Matrix

| Requirement / AC | Unit / integration | App smoke | Failure / fallback | Evidence target |
| --- | --- | --- | --- | --- |
| B-115/REQ-01 + B-115/REQ-02 / B-115/AC-01 | skill routing contract test | N/A | raw idea must not create B；promotion only creates one shared ID | Tracker T-01 |
| B-115/REQ-03 / B-115/AC-02 | negative no-write forward test | N/A | any write route is blocker | Tracker T-02 |
| B-115/REQ-04 / B-115/AC-03 | mode/continue/archive collision tests | N/A | choose earlier mode or ask once | Tracker T-03 |
| B-115/REQ-05 / B-115/AC-04 | checker/release adversarial tests | N/A | gate fails closed | Tracker T-04 |
| Engineering bootstrap / B-115/AC-05 | docs governance/index traceability checks | N/A | Product authority pollution or missing index fails | Tracker T-05 |

## Open Design Findings

无。用户已选择 Linear-first；其余 finding 是 contract-restoring implementation。

## Approval

- Design authority: [GOV-001](../../../development/governance/gov-001-agent-managed-project-lifecycle.md)、当前 repo workflow 与 review-confirmed findings。
- Approved on: 2026-07-12
- Authorized implementation scope: docs/skills/checker/tests/CI；stop after Validated，不 closeout、不 commit。
- Closeout authority: 用户于 2026-07-12 后续明确授权 Phase 4；Git 仍未授权。
