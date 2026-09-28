# Unified Chat Image Creation Development Track

Document status: Current
Updated: 2026-09-28
Work item: B-152
Authority: 统一生图入口与内容配图的简短路由。
Decision: [DEC-044](../../../product/decisions/dec-044-unified-chat-image-creation.md)
Product spec: [Product Spec](../../../product/specs/pa-unified-chat-image-creation-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- 单一 CreateImage、明确全文/选区来源、保留 Featured 专用描述生成步骤。
- 原 command 作为 Chat 快捷入口；生成结果和保存共用现有图片任务流程。
- Delivery class: L2，包含异步/来源/兼容性设计；不建设通用编排或第二套图片系统。

## Artifacts

- [Development Tracker](./tracker.md)：执行入口、GPT/GLM 任务和唯一验收记录。
- [Software Design Document](./sdd.md)：源码基线、实施细节、失败路径与最小验收矩阵。
- [当前图片架构](../../../architecture/chat-image-generation-architecture.md)：已实现行为基线。
- 顺序和验证分工由 Tracker 承载，不另建 Plan 或测试计划。
