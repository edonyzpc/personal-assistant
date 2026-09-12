# DEC-005 — Use Transparent And Reversible Memory Governance

Decision ID: DEC-005
Status: Accepted
Updated: 2026-09-12
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

长期记忆提取按 [DEC-033](./dec-033-simple-settings-and-unified-defaults.md) 的产品策略默认开启，首次透明说明且可独立关闭、暂停和管理；实际触发满足既有调度、预算、来源与 effect/risk 契约后自动处理。用可见、可纠正、可撤销、source-backed 和 effect/risk 分级补偿信任。冲突、敏感推断、跨 vault/global effect、vault mutation 与外部 action 继续要求与后果相匹配的披露或授权。

2026-09-08 historical amendment：DEC-033 当日明确长期提取默认关闭、独立主动
开启的前提，取代此前笼统的“默认自动提取”措辞。这是当日真实选择，保留其日期，
不回填为默认开启；该前提现已被下述修订覆盖。

2026-09-09 scoped amendment：Owner 明确选择长期提取与本地习惯学习分别默认
开启，无需逐项主动启用，保留独立退出与首次透明说明。默认依据为产品策略，不能
伪造用户点击确认或 `confirmedAt`；真实关闭/暂停需保留，旧值迁移边界见 DEC-033。
本次修订不增加逐条确认，不改变 DEC-028 的笔记 Memory 首次准备路径、已有记录
治理、显式风格授权或高后果权限；生成、改稿、保存和本次指令不自动成为长期风格。
新默认的实现与验证已由B-135完成，长期选择见[DEC-034](./dec-034-unified-agent-task-execution.md)，最终证据见[B-135验证归档](../../archive/2026/b135-unified-task-execution-validation.md)；旧任务不重开。

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
