# Agent Debug Explorer Development Track

Document status: Current
Updated: 2026-10-09
Work item: B-167
Authority: 本 track 的入口与 owning contract 路由；执行状态仅由 Tracker 持有。
Decision: [DEC-057](../../../product/decisions/dec-057-agent-debug-explorer.md)
Product spec: [Agent Debug Explorer](../../../product/specs/pa-agent-debug-explorer-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- 完整 Run 大纲、真实时间轴、聚焦展开和节点定位搜索；桌面右侧详情，移动整页详情与可恢复导航。
- Delivery class: L3。跨观察元数据、持久化读取与实时视图状态，但复用既有 Debug 数据与权限机制。
- 不增加全文/跨 Run 搜索、外部 tracing 服务、重放、同步、媒体副本或 Agent 执行能力。

## Artifacts

- [Tracker 与开发测试任务](./tracker.md)
- [Source-verified SDD](./sdd.md)
- [Current Debug architecture](../../../architecture/pa-agent-debug-view.md)
- [Data boundary successor](../../../product/specs/pa-agent-snapshot-execution-product-spec.md)
- [Command responsibility contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)

阶段依赖和派工字段可容纳于 Tracker，本次不另建 Plan、测试计划或 handoff 文件。
