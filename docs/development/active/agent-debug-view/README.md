# Agent Debug View Development Track

Document status: Current
Updated: 2026-09-23
Work item: B-145
Authority: 本 track 的产品契约、技术设计与开发任务入口。
Decision: [DEC-041](../../../product/decisions/dec-041-agent-debug-view-and-local-history.md)
Product spec: [Agent Debug View](../../../product/specs/pa-agent-debug-view-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: Chat 中可查看阶段轨迹、调用/工具细节与本机有界历史，删除联动可靠，采集开销可验证。
- Delivery class: L3；涉及正文持久化、来源撤销、跨库恢复、共享 provider 路径和 Obsidian UI 生命周期。
- Explicit non-goals: 全后台采集、持久 reasoning、媒体副本、导出/同步、自动重放、Git/release。

## Artifacts

- [Development Tracker](./tracker.md)：唯一执行状态、风险、验证证据与后续入口。
- [Delivery Plan](./plan.md)：开发顺序、阶段门、当前执行分工与回滚。
- [Software Design Document](./sdd.md)：源码接入、数据结构、删除协议、预算和测试映射。
- [现行 Agent 执行契约](../../../product/specs/pa-recoverable-agent-execution-product-spec.md)
- [Data Boundary](../../../product/specs/pa-data-boundary-product-spec.md)
