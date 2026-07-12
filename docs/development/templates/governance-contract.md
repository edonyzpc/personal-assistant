# GOV-xxx — <Engineering Governance Contract>

Document status: Current
Governance ID: GOV-xxx
Updated: YYYY-MM-DD
Work item: B-xxx
Authority: <repo engineering governance/tooling boundary; explicitly exclude PA runtime and user behavior>

Bootstrap source: <user authorization / Backlog / prior governance contract>. 不得伪造 Linear promotion；若为用户直接授权的 engineering bootstrap，明确写出。

## Context And Selected Governance Choice

说明工程治理问题、已确认选择、备选方案与原因。产品价值或用户行为选择不放在这里，应转 Product Decision。

## Requirements

- B-xxx/REQ-01:

## Non-goals

- NG-01: 不改变 PA runtime、数据/隐私边界、Obsidian UI 或用户产品行为。

## Acceptance Criteria

- B-xxx/AC-01:

## Traceability

| Requirement / AC | Design | Delivery evidence |
| --- | --- | --- |
| B-xxx/REQ-01 / B-xxx/AC-01 | <Active SDD section> | <Tracker row> |

## Authority And Change Boundary

- Current governance authority:
- Delivery authority:
- Product escalation: 若实现会改变 PA runtime 或用户行为，停止 governance-only lane，创建 Accepted Product Decision + Approved Product Spec。
- Revisit trigger and successor `GOV-xxx` rule:

## Terminal Disposition

- Closed package: 本 contract 保持 `Document status: Current` 并留在 `docs/development/governance/`；归档 package 链接它作为 terminal authority。
- Cancelled package: 未交付 contract 改为 `Document status: Archived` + `Delivery status: Cancelled`，移动到 `docs/archive/<year>/gov-xxx-<slug>.md`，并从 Current Governance index 移除。
- Superseded package: 被替代 contract 改为 `Document status: Archived` + `Delivery status: Superseded`，移动到年度直属 `gov-xxx-<slug>.md`，并必须链接一个新的 Current successor GOV；没有 successor 时使用 `Cancelled`。
- 无论终态为何，曾进入 Active Development 的完整 package 都必须另外归档到 `docs/archive/<year>/<feature>/`；年度直属 GOV record 不能替代 package。
