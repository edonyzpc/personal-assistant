# Share Card Sharer Development Track

Document status: Current
Updated: 2026-10-15
Work item: B-124
Authority: 本 track 的简短入口与 owning contract 路由。
Decision: [DEC-026](../../../product/decisions/dec-026-local-share-card.md)
Product spec: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 左侧保留产品来源品牌，右下角默认 `by` + EZ SVG；当前 Modal 可用名字
  替换分享者 SVG，清空后恢复默认。
- Delivery class: L2，B-124 的当前修订。简单设计、风险与证据映射放在 Tracker，
  不新增 Plan 或 SDD。
- Explicit non-goals: 不增加全局设置、持久名字、上传 logo、模板体系、网络/provider
  路径或外部发布；保留现有固定尺寸、正文、字号、分页与资源契约。

## Artifacts

- Tracker: [Development Tracker](./tracker.md)
- Current product contract: [Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
- Current architecture contract: [Share Card Architecture](../../../architecture/share-card-architecture.md)

执行状态、下一步、finding 与验证证据只写 Tracker，不在本页镜像。
