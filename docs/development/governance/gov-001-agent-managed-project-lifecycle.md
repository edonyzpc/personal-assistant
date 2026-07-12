# GOV-001 — Agent-Managed Project Lifecycle

Document status: Current
Governance ID: GOV-001
Updated: 2026-07-12
Work item: B-115
Authority: PA 仓库的 Linear intake、repo docs authority、Agent 自动维护、工程授权与信息连续性规则；不定义 PA runtime 或用户产品行为。

Bootstrap source: 用户于 2026-07-12 直接授权修复 docs/Agent/checker lifecycle 的 review findings，并选择 Linear-first 方案。B-115 是这次 engineering governance remediation 的直接 bootstrap ID，不是由 raw Linear idea promotion 得到；以下 intake 规则适用于未来 PA idea。

## Context And Selected Governance Choice

用户希望只负责产品思考和关键决定，同时避免 raw idea 直接堆积成 repo Backlog、空 Product Spec 或无人维护的过程文档。

| Option | Result | Rationale |
| --- | --- | --- |
| Choice 1: raw PA idea 先进入 Linear，达到 promotion gate 后再创建 `B-xxx` | Selected by user, 2026-07-12 | 收件低负担，repo 只保留需要决策、进入版本候选或准备跨会话研究/执行的 durable work |
| Choice 2: 每个 raw idea 立即创建 `B-xxx` 并镜像 Linear | Rejected | Backlog 会重新积累低信号、重复或尚无下一步的条目 |

Linear 负责 raw intake、优先级、版本、依赖与高层状态镜像；repo docs 负责晋升后的 Governance/Product contract、Plan/SDD、Tracker、验证与 Closeout authority。外部状态不能单独证明实现、smoke 或 release。

## Requirements

- B-115/REQ-01: Raw PA idea 必须先进入 Linear `PA 产品收件箱`；promotion gate 前不得创建 repo `B-xxx` 或空 Spec/Tracker。
- B-115/REQ-02: 需要产品决策、进入 Roadmap/版本候选或开始跨会话研究/执行时，必须创建唯一 `B-xxx` 并双向链接 Linear 与 repo。
- B-115/REQ-03: 显式 review-only、analysis-only 或 no-file-changes 必须成为全局零写入覆盖规则。
- B-115/REQ-04: plan/implement、continue、closeout 与 archive 必须使用确定性的授权终点、目标解析和冲突 fail-closed 规则。
- B-115/REQ-05: docs moves、deletions、Backlog removal、Closeout disposition 与 tag release 必须由可执行 gate 证明信息连续性。

## Non-goals

- NG-01: 不把 Linear 变成需求、设计或验证的第二 source of truth。
- NG-02: 不在本 track 中创建 Codex 定时 Automation 或改变真实 Linear workspace 数据。
- NG-03: 不授权 commit、push、tag、publish 或 release。
- NG-04: 不修改 PA runtime、数据/隐私边界或 Obsidian UI。
- NG-05: 不用 Product Decision/Product Spec 承载纯 repo governance/tooling 约束。

## Acceptance Criteria

- B-115/AC-01: T-01 同时证明 REQ-01 与 REQ-02：raw idea 只写 Linear、不创建 `B-xxx`；promotion 场景只创建一个共享 ID 并双向链接。
- B-115/AC-02: review-only/no-file-changes 路由测试证明 repo、Linear、Archive 均为零写入。
- B-115/AC-03: plan-and-implement、缺失 Plan/SDD bootstrap、零/多 Active Package continue 场景都有唯一模式与 stop point；archive collision fail closed。
- B-115/AC-04: checker 对失效 HTML 资源、无关 basename、外部 disposition、`T-xxx` 删除、不完整 Closeout 和无 baseline tag release fail closed。
- B-115/AC-05: 这次 engineering bootstrap 在交付期可从 docs index → Development index → Governance index/GOV-001 → Active Package/Tracker 完整发现；closeout 后可继续定位 Archived Package/Tracker/Closeout，且不伪造 Linear promotion、Product Decision 或 Product Spec provenance。

## Traceability

| Requirement / AC | Design | Delivery evidence |
| --- | --- | --- |
| B-115/REQ-01 + B-115/REQ-02 / B-115/AC-01 | [SDD — Intake state machine](../../archive/2026/agent-managed-docs-lifecycle/sdd.md#intake-and-promotion-state-machine) | [Tracker T-01](../../archive/2026/agent-managed-docs-lifecycle/tracker.md#work) |
| B-115/REQ-03 / B-115/AC-02 | [SDD — Authorization](../../archive/2026/agent-managed-docs-lifecycle/sdd.md#authorization-and-target-resolution) | [Tracker T-02](../../archive/2026/agent-managed-docs-lifecycle/tracker.md#work) |
| B-115/REQ-04 / B-115/AC-03 | [SDD — Authorization](../../archive/2026/agent-managed-docs-lifecycle/sdd.md#authorization-and-target-resolution) | [Tracker T-03](../../archive/2026/agent-managed-docs-lifecycle/tracker.md#work) |
| B-115/REQ-05 / B-115/AC-04 | [SDD — Integrity gates](../../archive/2026/agent-managed-docs-lifecycle/sdd.md#documentation-integrity-gates) | [Tracker T-04](../../archive/2026/agent-managed-docs-lifecycle/tracker.md#work) |
| Engineering bootstrap / B-115/AC-05 | [Authority ownership](../../archive/2026/agent-managed-docs-lifecycle/sdd.md#authority-ownership) | [Tracker T-05](../../archive/2026/agent-managed-docs-lifecycle/tracker.md#work) |

## Authority And Change Boundary

- Current governance authority: 本文件与 [Documentation Workflow](../documentation-workflow.md)。两者冲突时先修复 drift，不由 Product Decision Register 接管。
- Delivery authority: [B-115 Archived Package](../../archive/2026/agent-managed-docs-lifecycle/README.md)、[Tracker](../../archive/2026/agent-managed-docs-lifecycle/tracker.md) 与 [Closeout](../../archive/2026/agent-managed-docs-lifecycle/closeout.md)，最终状态为 `Closed`。
- Product escalation: 任何实现若改变 PA runtime、用户行为、数据/隐私边界或 Obsidian UI，必须停止 governance-only lane，并进入 Accepted Product Decision + Approved Product Spec。
- Revisit trigger: Linear intake 无法可靠保存/双向链接，或数据证明 promotion gate增加管理负担；通过 successor `GOV-xxx` 修订，不创建产品 Decision 除非同时改变 PA 产品行为。
