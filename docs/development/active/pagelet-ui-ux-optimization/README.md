# Pagelet UI/UX Optimization Development Track

Document status: Current
Delivery status: Validated
Design status: Approved
Updated: 2026-07-21
Work item: B-118
Authority: 本 track 的一页式状态、artifact routing、交付边界与下一步。
Decision: [DEC-021 — evidence-led Pagelet UI/UX hardening](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Tracker: [Development Tracker](./tracker.md)
Provider trust amendment: [DEC-023 — shared non-blocking Pagelet provider first-use](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)
Quiet Recall retrieval amendment: [DEC-024 — cold semantic retrieval uses the existing actual-call budget](../../../product/decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)

## Outcome And Boundary

- Outcome: 修复 2026-07-19 真实桌面/iPhone 审查确认的 Pagelet 触控、Recap 首屏、
  授权、motion、Recall 动作/feedback/provider disclosure、Pet 状态、可读性与定位问题，同时保留已通过的移动
  safe-area、44×44 触控目标与短点/长按基线。
- Delivery class: L3；涉及 Obsidian UI 生命周期、跨 Bubble/Pet/Recap/Recall/Settings
  runtime、移动真机触控和真实可见界面验证。
- Current phase: SDD、runtime reconciliation、全量自动化、构建、docs/local community
  gate、第二轮隐私复审、completion re-audit/remediation 及授权范围内的 desktop/iPhone
  真实 surface smoke 已完成，当前为 Validated。iPhone 真机发现的 F-04 blink/dots/zzz
  selector 漏配已修复，并在 Reduce Motion=true 的 WKWebView 中复验为 `none`；最终
  owner-aware nudge admission/source-invalidation 与 Prepared Panel 生产入口/只读边界
  及空缓存无状态变更 preflight 收口后，两次部署门禁均为 163 suites / 3417 tests。
- Target release / no release commitment: 无 release commitment；不自动进入 beta/stable。
- Explicit non-goals: 不重做 Pagelet IA，不新增自动写入/队列/provider 能力，不扩大
  B-118 以外的 Settings 或 release 范围，不用测试/DOM 代替真机结论。

## Authority And Evidence

唯一 Product spec metadata authority 是本页上方的 B-118 Product Spec，唯一
Decision metadata authority 是 DEC-021；DEC-023 是 provider first-use、DEC-024 是
Quiet Recall semantic retrieval 的现行 scoped amendment。下列当前合同与归档证据提供支持，但不创建
第二套 B-118 执行状态：

- [PA Product North Star](../../../product/pa-product-north-star.md)
- [DEC-023 — shared Pagelet provider first-use](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)
- [DEC-024 — Quiet Recall cold semantic retrieval](../../../product/decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)
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
  桌面烟测、iCloud byte-match 与 iPhone 触控/竖屏/Reduce Motion 复测；浅横屏明确
  `NOT TESTED / accepted waiver`。生产 Prepared 命令注册与空缓存路径另由 CLI runtime
  证明；provider-free shell runner 为 26 PASS / 1 BLOCKED / 0 FAIL。
- Closeout: 仅在实现、review 与全部声明的真实界面证据完成后创建。

## Traceability Snapshot

| Requirement / AC | Design | Tracker evidence | State |
| --- | --- | --- | --- |
| B-118/REQ-01 / B-118/AC-01 | SDD Slice A：touch ownership | [Tracker T-01](./tracker.md#work) | Validated；自动化三菜单项 ownership + iPhone 真手指长按 |
| B-118/REQ-02 / B-118/AC-02 | SDD Slice B：Recap concrete delivery | [Tracker T-02](./tracker.md#work) | Validated；desktop 3-second-value/Detail evidence |
| B-118/REQ-03 / B-118/AC-03 | SDD Slice B/C：DEC-023 shared notice + broad-run gate | [Tracker T-03](./tracker.md#work) | Validated；provider-spy matrix + desktop notice surface |
| B-118/REQ-04 / B-118/AC-04 | SDD Slice D：reduced-motion matrix | [Tracker T-04](./tracker.md#work) | Validated；iPhone post-fix computed matrix |
| B-118/REQ-05 / B-118/AC-05 | SDD Slice E：View/Later/Dismiss | [Tracker T-05](./tracker.md#work) | Validated；provider-free side-effect matrix |
| B-118/REQ-06 / B-118/AC-06 | SDD Slice D：owner-aware Pet lifecycle | [Tracker T-06](./tracker.md#work) | Validated；explicit admission/presentation/source-invalidation interleaving + desktop reload convergence |
| B-118/REQ-07 / B-118/AC-07 | SDD Slice E：Quiet Recall Off/On | [Tracker T-07](./tracker.md#work) | Validated；migration + desktop Settings surface |
| B-118/REQ-08 / B-118/AC-08 | SDD Slice F：typography floor | [Tracker T-08](./tracker.md#work) | Validated with tooling residual；24-case deterministic CSS cascade + user manual visible pass；browser computed automation BLOCKED |
| B-118/REQ-09 / B-118/AC-09 | SDD Slice F：active-leaf placement | [Tracker T-09](./tracker.md#work) | Validated with residual；desktop/portrait pass，landscape `NOT TESTED` by user waiver |
| B-118/REQ-10 / B-118/AC-10 | SDD Slice C：shared Data Boundary / DEC-023/DEC-024 | [Tracker T-10](./tracker.md#work) | Validated；automated privacy matrix + Settings/notice/runtime surface |

## Current Stop Point

- Next action: 无剩余产品或 runtime 动作。若要关闭本 track，需另行明确授权
  closeout/archive；commit、push、tag、release 也仍需单独授权。
- User decision needed: 无产品决策。用户已于 2026-07-21 明确接受本轮 iPhone 浅横屏
  `NOT TESTED`，不得改写为 PASS。
- Blocker: 无产品、runtime 或 validation blocker。post-F-13 owner-path 与 Prepared
  Panel 入口/只读/空缓存状态边界由 fixtures、独立复审、部署身份与 CLI runtime
  验证闭合，未新增非空 Prepared 实机交互结论；durable Memory D6 live-write probe
  需要隔离 fixture，已安全记为与 B-118 无关的 `BLOCKED`，未触碰 Memory；
  真实 provider/high-risk 调用未获
  数据/成本授权，iPad/Android 未测，均作为 residual risk 保留而不冒充 PASS。

## Closeout Destination

等待显式 closeout 授权；按 Documentation Workflow 默认吸收后删除，只有仍被当前
contract 直接引用的独有证据才 opt-in archive。
