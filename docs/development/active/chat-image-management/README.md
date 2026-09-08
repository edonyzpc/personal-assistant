# Chat Image Management

Document status: Current
Updated: 2026-09-08
Work item: B-129
Authority: 图片管理简化的产品契约与执行入口。
Decision: [DEC-030](../../../product/decisions/dec-030-multimodal-chat-image-copywriting.md)
Product spec: [Multimodal Chat](../../../product/specs/pa-multimodal-chat-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

统一实际交付文件语义，拒绝新 HEIC，PA 保存时迁出聊天专用图片并复用普通附件。
L3 数据生命周期变更；不批量清理旧数据，不监听手动笔记引用，不增加图片生成。

## Artifacts

- [SDD](./sdd.md)
- [Architecture](../../../architecture/multimodal-chat-architecture.md)
