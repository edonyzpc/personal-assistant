# Memory Preparation Lifecycle Development Track

Document status: Current
Updated: 2026-11-13
Work item: B-197
Authority: 本切片的入口与契约路由；执行状态只见 Tracker。
Decision: [DEC-080](../../../product/decisions/dec-080-memory-preparation-lifecycle.md)
Product spec: [Product Spec](../../../product/specs/pa-memory-preparation-lifecycle-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Delivery class: L3，共享 Chat/Memory 生命周期、来源准入及 UI 状态。
- Outcome: 获准后台准备不受短检索取消，进度与终态可见。
- Non-goals: 新任务框架、持久历史、暂停恢复、Pagelet 交互改变、私人 vault 验证和发布。

## Artifacts

- [SDD](./sdd.md)
- [Memory architecture](../../../architecture/vss-sqlite-wasm-architecture.md)
- [Refresh architecture](../../../architecture/vss-embedding-refresh.md)

交付顺序、风险和回滚适合写在现有 Tracker/SDD，不另建 Plan。
