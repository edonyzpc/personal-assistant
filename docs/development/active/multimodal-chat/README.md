# Multimodal Chat Development Track

Document status: Current
Updated: 2026-09-06
Work item: B-129
Authority: 多模态 Chat 的产品契约与执行文档入口。
Decision: [DEC-030](../../../product/decisions/dec-030-multimodal-chat-image-copywriting.md)
Product spec: [Multimodal Chat Product Spec](../../../product/specs/pa-multimodal-chat-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 在现有 Chat 理解图片、结合有来源的背景辅助表达，由用户分别决定保存图文和以后参考类似场景的风格。
- Delivery class: L3；涉及附件、聊天持久化、共享请求组装、Memory 来源与多文件保存。
- Explicit non-goals: 图片生成、音视频、跨设备聊天同步、图片库索引、自动发布，以及 PA 写入权限体系迁移。

## Artifacts

- [Tracker](./tracker.md)：任务、执行状态、评审处置与验证证据。
- [Delivery Plan](./plan.md)：依赖、阶段出口、验证和回退。
- [SDD](./sdd.md)：接口、数据生命周期和失败处理。
- [用户指南](../../../guides/multimodal-chat-user-guide.md)：图片、保存、风格与同步操作。
- [Product Spec](../../../product/specs/pa-multimodal-chat-product-spec.md)：用户行为及稳定 REQ/AC。

执行状态和下一步只由 Tracker 承接。
