# Chat Image Generation Development Track

Document status: Current
Updated: 2026-09-18
Work item: B-133
Authority: Chat 图片生成与编辑的产品、技术设计和执行记录入口。
Decision: [DEC-038](../../../product/decisions/dec-038-chat-image-generation.md)
Product spec: [Product Spec](../../../product/specs/pa-chat-image-generation-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: Chat 中按需创建、参考和编辑图片，支持可恢复任务、确切版本、复制与下载。
- Delivery class: L3；涉及共享连接、付费外发、图片文件、持久任务与跨视图生命周期。
- Explicit non-goals: 新图片 provider、通用任务平台、跨设备聊天、局部编辑器、
  图库扫描、自动付费试图；不扩大 Featured Image 的笔记写入语义。

## Artifacts

- [Software Design Document](./sdd.md) — 详细交互、模块、数据、状态、迁移和验证矩阵。
- [Delivery constraints](./sdd.md#14-lean-delivery-constraints) 与 [Discussion traceability](./sdd.md#13-discussion-detail-traceability) — 精简设计/验证约束及讨论细节验收映射。
- [Development Tracker](./tracker.md) — 授权终点、工作拆分、证据与待验证风险。
- [Product Spec](../../../product/specs/pa-chat-image-generation-product-spec.md) — REQ/AC。
- [DEC-038](../../../product/decisions/dec-038-chat-image-generation.md) — 已确认选择及原因。
- [Current Multimodal Chat Architecture](../../../architecture/multimodal-chat-architecture.md)。

继续工作先读本页与 Tracker；状态和下一步仅由 Tracker 维护。
