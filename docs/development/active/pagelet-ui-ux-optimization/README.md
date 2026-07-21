# Pagelet UI/UX Optimization Development Track

Document status: Current
Delivery status: Implementing
Design status: Approved
Updated: 2026-07-21
Work item: B-118
Authority: 本 track 的一页式状态、artifact routing、交付边界与下一步。
Decision: [DEC-021 — evidence-led Pagelet UI/UX hardening](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Tracker: [Development Tracker](./tracker.md)
Provider trust amendment: [DEC-023 — shared non-blocking Pagelet provider first-use](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)

## Outcome And Boundary

- Outcome: 修复 2026-07-19 真实桌面/iPhone 审查确认的 Pagelet 触控、Recap 首屏、
  授权、motion、Recall 动作/feedback/provider disclosure、Pet 状态、可读性与定位问题，同时保留已通过的移动
  safe-area、44×44 触控目标与短点/长按基线。
- Delivery class: L3；涉及 Obsidian UI 生命周期、跨 Bubble/Pet/Recap/Recall/Settings
  runtime、移动真机触控和真实可见界面验证。
- Current phase: SDD 已批准；多数 runtime/CSS/i18n slice 与自动化 gate 已完成，但
  2026-07-21 源码复核重新打开 F-03/F-10。fresh install 仍被旧 authorization tuple
  置为 Scope Recap preparation off，shared notice 也未统一到每个 feature 的第一次
  实际 provider call，因此当前回到 Implementing。
- Target release / no release commitment: 无 release commitment；不自动进入 beta/stable。
- Explicit non-goals: 不重做 Pagelet IA，不新增自动写入/队列/provider 能力，不扩大
  B-118 以外的 Settings 或 release 范围，不用测试/DOM 代替真机结论。

## Authority And Evidence

唯一 Product spec metadata authority 是本页上方的 B-118 Product Spec，唯一
Decision metadata authority 是 DEC-021；DEC-023 是 provider first-use 的现行 scoped
amendment。下列当前合同与归档证据提供支持，但不创建
第二套 B-118 执行状态：

- [PA Product North Star](../../../product/pa-product-north-star.md)
- [DEC-023 — shared Pagelet provider first-use](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)
- [Scope Recap Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md)
- [Quiet Recall Spec](../../../product/specs/pa-quiet-recall-insight-timing-product-spec.md)
- [Bubble Spec](../../../product/specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- [Data Boundary Spec](../../../product/specs/pa-data-boundary-product-spec.md)
- [Retrieval Habit Profile Spec](../../../product/specs/pa-retrieval-habit-profile-product-spec.md)
- [Saved Insight Spec](../../../product/specs/pa-saved-insight-ledger-product-spec.md)
- [B-108 archived validation package](../../../archive/2026/pagelet-b108-dogfood-followup/README.md)

## Artifact Map

- Plan: [Delivery Plan](./plan.md)
- SDD: [Approved SDD](./sdd.md) — 2026-07-20 created, covers B-118/REQ-01..10 and AC-01..10
- Tracker: [Development Tracker](./tracker.md)
- Detailed handoff: [Claude Code UI/UX implementation handoff](./handoff-claude-code.md)
- Tests / smoke surface: focused Jest、local validation gate、`make deploy`、真实 Obsidian
  桌面烟测、iCloud byte-match 与 iPhone 触控/横竖屏/Reduce Motion 复测。
- Closeout: 仅在实现、review 与全部声明的真实界面证据完成后创建。

## Traceability Snapshot

| Requirement / AC | Design | Tracker evidence | State |
| --- | --- | --- | --- |
| B-118/REQ-01 / B-118/AC-01 | SDD Slice A：touch ownership | [Tracker T-01](./tracker.md#work) | Implemented；iPhone validation pending |
| B-118/REQ-02 / B-118/AC-02 | SDD Slice B：Recap concrete delivery | [Tracker T-02](./tracker.md#work) | Implemented；desktop validation pending |
| B-118/REQ-03 / B-118/AC-03 | SDD Slice B/C：DEC-023 shared notice + broad-run gate | [Tracker T-03](./tracker.md#work) | Runtime reconciliation pending；fresh-install gate 仍冲突 |
| B-118/REQ-04 / B-118/AC-04 | SDD Slice D：reduced-motion matrix | [Tracker T-04](./tracker.md#work) | Implemented；iPhone validation pending |
| B-118/REQ-05 / B-118/AC-05 | SDD Slice E：View/Later/Dismiss | [Tracker T-05](./tracker.md#work) | Implemented；surface validation pending |
| B-118/REQ-06 / B-118/AC-06 | SDD Slice D：owner-aware Pet lifecycle | [Tracker T-06](./tracker.md#work) | Implemented；desktop validation pending |
| B-118/REQ-07 / B-118/AC-07 | SDD Slice E：Quiet Recall Off/On | [Tracker T-07](./tracker.md#work) | Implemented；Settings validation pending |
| B-118/REQ-08 / B-118/AC-08 | SDD Slice F：typography floor | [Tracker T-08](./tracker.md#work) | Implemented；visible validation pending |
| B-118/REQ-09 / B-118/AC-09 | SDD Slice F：active-leaf placement | [Tracker T-09](./tracker.md#work) | Implemented；desktop/iPhone validation pending |
| B-118/REQ-10 / B-118/AC-10 | SDD Slice C：shared Data Boundary / DEC-023 | [Tracker T-10](./tracker.md#work) | Runtime reconciliation pending；cross-feature actual-call gate 未闭合 |

## Current Stop Point

- Next action: 获得明确 runtime 修复指令后，先闭合 F-03/F-10：fresh install 默认
  eligible、保留真实 opt-out，并把 shared notice 放到 Recap/Recall/Discover 第一次
  实际 provider call 的共同 gate；完整源码证据、最小修复边界与回归矩阵见
  [Tracker execution record](./tracker.md#dec-023-runtime-reconciliation-execution-record)。
  focused tests/review 通过后才 `make deploy`。
- User decision needed: 无。SG-01..07 已有 disposition；provider first-use 统一以
  DEC-023 为准。本轮只有产品合同/文档同步，未授权 runtime 修改。
- Blocker: F-03/F-10 P1 runtime reconciliation 与修复后 desktop/iPhone 真实 surface
  证据尚未完成，因此不能进入 Validating/Validated/Closeout。iPad/Android 不属于
  B-118 完成门。commit、push、tag、release 仍未授权。

## Closeout Destination

`docs/archive/2026/pagelet-ui-ux-optimization/`
