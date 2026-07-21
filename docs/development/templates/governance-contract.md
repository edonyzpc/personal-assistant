# GOV-xxx — <Engineering Governance Contract>

Document status: Current
Governance ID: GOV-xxx
Updated: YYYY-MM-DD
Work item: B-xxx
Authority: <repo engineering governance/tooling boundary; explicitly exclude PA runtime and user behavior>

Bootstrap source: <user authorization / Backlog / prior governance contract>. 若为用户直接授权的 engineering bootstrap，明确写出；不要求外部 tracker 来源。

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
| B-xxx/REQ-01 / B-xxx/AC-01 | <current workflow/tooling or optional SDD> | <focused test/check or Tracker row> |

## Authority And Change Boundary

- Current governance authority:
- Delivery authority: <Active Tracker while executing; current tooling/tests after closeout>
- Product escalation: 若实现会改变 PA runtime 或用户行为，停止 governance-only lane，创建 Accepted Product Decision + Approved Product Spec。
- Revisit trigger and successor `GOV-xxx` rule:

## Terminal Disposition

- Closed: 本 contract 保持 Current；稳定交付证据吸收到 contract/tooling/tests，过程 package 默认删除。
- Cancelled: 未交付 contract 从 Current index 移除；仅在终止 rationale 仍被当前 authority 引用时，作为紧凑年度 Archive record 保留。
- Superseded: 从 Current index 移除，并链接新的 Current successor；只有长期 rationale 仍有用时才保留 Archive record。没有 successor 时使用 Cancelled。
