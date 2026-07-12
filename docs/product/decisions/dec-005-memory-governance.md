# DEC-005 — Use Transparent And Reversible Memory Governance

Decision ID: DEC-005
Status: Accepted
Updated: 2026-07-12
Authority: Memory 自动提取、使用与用户控制的产品信任模型。
Work item: Historical Memory governance

## Context

逐条确认可以降低单次错误写入，但会把用户变成 clickworker；完全黑箱自动化又违背“安静且可信”。需要在低负担与可控性之间建立稳定边界。

## Options Considered

| Option | Benefit | Cost / risk |
| --- | --- | --- |
| 每条 Memory 都确认 | 明确授权 | 高管理负担、阻断自然使用 |
| 完全自动且不可见 | 摩擦最低 | 难以纠正、无法建立信任 |
| 自动提取 + 可见/可纠正/可撤销 + effect/risk gate | 低负担且可恢复 | 需要持续维护治理与迁移契约 |

## Decision

Memory 默认自动提取；用可见、可纠正、可撤销、source-backed 和 effect/risk 分级补偿信任。冲突、敏感推断、跨 vault/global effect、vault mutation 与外部 action 继续要求与后果相匹配的披露或授权。

## Consequences

- 不把逐条确认扩展为一般产品规则。
- UI 必须能解释来源、状态、影响与恢复边界。
- 当前 30-confirmation Level 2 只作为 legacy migration policy，不扩张其语义。

## Revisit Trigger

真实安全事件、持续性错误 Memory 或用户研究证明当前透明/恢复机制不足时复议。

## Traceability

- [Product North Star](../pa-product-north-star.md)
- [Memory Control Center Product Spec](../specs/pa-memory-control-center-product-spec.md)
- [Active Decision Register](../active-decisions.md)
