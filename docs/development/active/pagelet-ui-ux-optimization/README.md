# Pagelet UI/UX Optimization Development Track

Document status: Current
Delivery status: Planned
Design status: Not started
Updated: 2026-07-19
Work item: B-118
Authority: 本 track 的一页式状态、artifact routing、交付边界与下一步。
Decision: [DEC-021 — evidence-led Pagelet UI/UX hardening](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 修复 2026-07-19 真实桌面/iPhone 审查确认的 Pagelet 触控、Recap 首屏、
  授权、motion、Recall 动作/feedback/provider disclosure、Pet 状态、可读性与定位问题，同时保留已通过的移动
  safe-area、44×44 触控目标与短点/长按基线。
- Delivery class: L3；涉及 Obsidian UI 生命周期、跨 Bubble/Pet/Recap/Recall/Settings
  runtime、移动真机触控和真实可见界面验证。
- Current phase: handoff 与产品合同已就绪；SDD 尚未创建，runtime 实现尚未开始。
- Target release / no release commitment: 无 release commitment；不自动进入 beta/stable。
- Explicit non-goals: 不重做 Pagelet IA，不新增自动写入/队列/provider 能力，不扩大
  B-118 以外的 Settings 或 release 范围，不用测试/DOM 代替真机结论。

## Authority And Evidence

唯一 Product spec metadata authority 是本页上方的 B-118 Product Spec，唯一
Decision metadata authority 是 DEC-021。下列当前合同与归档证据提供支持，但不创建
第二套 B-118 执行状态：

- [PA Product North Star](../../../product/pa-product-north-star.md)
- [Scope Recap Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md)
- [Quiet Recall Spec](../../../product/specs/pa-quiet-recall-insight-timing-product-spec.md)
- [Bubble Spec](../../../product/specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- [Data Boundary Spec](../../../product/specs/pa-data-boundary-product-spec.md)
- [Retrieval Habit Profile Spec](../../../product/specs/pa-retrieval-habit-profile-product-spec.md)
- [Saved Insight Spec](../../../product/specs/pa-saved-insight-ledger-product-spec.md)
- [B-108 archived validation package](../../../archive/2026/pagelet-b108-dogfood-followup/README.md)

## Artifact Map

- Plan: [Delivery Plan](./plan.md)
- SDD: Claude Code 进入设计 phase 后创建 `./sdd.md`；实现前必须 Approved
- Tracker: [Development Tracker](./tracker.md)
- Detailed handoff: [Claude Code UI/UX implementation handoff](./handoff-claude-code.md)
- Tests / smoke surface: focused Jest、local validation gate、`make deploy`、真实 Obsidian
  桌面烟测、iCloud byte-match 与 iPhone 触控/横竖屏/Reduce Motion 复测。
- Closeout: 仅在实现、review 与全部声明的真实界面证据完成后创建。

## Traceability Snapshot

| Requirement / AC | Design | Tracker evidence | State |
| --- | --- | --- | --- |
| B-118/REQ-01 / B-118/AC-01 | SDD touch ownership section after design starts | [Tracker T-01](./tracker.md#work) | Planned |
| B-118/REQ-02 / B-118/AC-02 | SDD Recap delivery section after design starts | [Tracker T-02](./tracker.md#work) | Planned |
| B-118/REQ-03 / B-118/AC-03 | SDD authorization state section + SG-06 after decision | [Tracker T-03](./tracker.md#work) | Partly blocked |
| B-118/REQ-04 / B-118/AC-04 | SDD motion matrix after design starts | [Tracker T-04](./tracker.md#work) | Planned |
| B-118/REQ-05 / B-118/AC-05 | SDD characterization + SG-02..04 after decisions | [Tracker T-05](./tracker.md#work) | Partly blocked |
| B-118/REQ-06 / B-118/AC-06 | SDD Pet ownership section after design starts | [Tracker T-06](./tracker.md#work) | Planned |
| B-118/REQ-07 / B-118/AC-07 | SDD settings characterization + SG-01 after decision | [Tracker T-07](./tracker.md#work) | Partly blocked |
| B-118/REQ-08 / B-118/AC-08 | SDD typography matrix after design starts | [Tracker T-08](./tracker.md#work) | Planned |
| B-118/REQ-09 / B-118/AC-09 | SDD placement/safe-area matrix after design starts | [Tracker T-09](./tracker.md#work) | Planned |
| B-118/REQ-10 / B-118/AC-10 | SDD shared Data Boundary fail-closed gate + SG-05 | [Tracker T-10](./tracker.md#work) | Partly blocked |

## Current Stop Point

- Next action: Claude Code 先完整读取 handoff 与当前合同，复核代码基线，创建并批准
  `sdd.md`，随后先实现不依赖 stop gate 的 F-01/F-02、provider fail-closed、motion、
  lifecycle 与视觉 slice。
- User decision needed: DEC-021 的 `SG-01` 至 `SG-07`。它们分别阻塞 Quiet Recall
  frequency/migration、action taxonomy、feedback、Later、shared authorization
  mapping、Scope Recap Run/reprompt 与 Discover/name/quiet-first-screen 语义。
- Blocker: 实现前的 Approved SDD 尚未创建；受 SG 影响的 slice 必须标 `BLOCKED`，
  其他 slice 可继续。iPhone/iPad 不可用只会阻塞相应真机 claim，不阻塞自动化和
  桌面开发。

## Closeout Destination

`docs/archive/2026/pagelet-ui-ux-optimization/`
