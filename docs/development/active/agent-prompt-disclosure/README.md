# PA Agent Prompt Disclosure Development Track

Document status: Current
Updated: 2026-10-11
Work item: B-171
Authority: 本任务简短入口与 owning contract 路由。
Decision: [DEC-060](../../../product/decisions/dec-060-agent-prompt-progressive-disclosure.md)
Product spec: [Prompt Disclosure](../../../product/specs/pa-agent-prompt-disclosure-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

复用现有 prompt、工具声明与 Skill/reference 机制，明确常驻、按需方法和随事实出现的解释，保持 Agent 自主规划与现有执行边界。Delivery class: L3（共享请求拼装与历史事实解释）；不意味着建设新框架。

B-170 通用计算方案独立保留；本任务不新增能力、动态工具发现或用户模式。

## Artifacts

- [SDD](./sdd.md)：源码核对、最小接线、职责、兼容与回滚。
- [Tracker](./tracker.md)：开发顺序、最低充分测试映射、执行授权与验证证据。
- [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)：统一职责。

开发/测试计划足以放入 Tracker，不另建 plan.md、测试计划或 handoff。
