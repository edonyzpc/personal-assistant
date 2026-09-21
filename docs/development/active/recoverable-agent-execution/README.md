# Recoverable Agent Execution Development Track

Document status: Current
Updated: 2026-09-21
Work item: B-144
Authority: 本 track 的简短入口与 owning contract 路由。
Decision: [DEC-040](../../../product/decisions/dec-040-recoverable-agent-execution.md)
Product spec: [Product Spec](../../../product/specs/pa-recoverable-agent-execution-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 主 Agent 在授权边界内围绕有限任务自主恢复；稳定材料版本、30 分钟操作期限、受控并发、领域交付与真实终态。
- Delivery class: L3；共享 runtime、来源/副作用、写作交付与调度生命周期。
- Explicit non-goals: 通用跨重载自动任务引擎、扩大权限/付费动作、改变 provider/model、放宽 Pagelet 内容质量与 VSS 写入约束。

## Artifacts

- [Development Tracker](./tracker.md)：执行顺序、状态与验证证据。
- [Software Design Document](./sdd.md)：源码基线、目标职责、接口、恢复、时限、调度、兼容与验收。
- [Current Runtime Lifecycle](../../../architecture/pa-agent-runtime-lifecycle-plan.md)：当前代码行为。
- [Original incident and fixes](../../validation/pa-agent-empty-answer-diagnosis-2026-09-21.md)：已知事故证据及限制。
