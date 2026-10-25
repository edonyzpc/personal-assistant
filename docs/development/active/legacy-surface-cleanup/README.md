# Legacy Surface Cleanup Development Track

Document status: Current
Updated: 2026-10-25
Work item: B-189
Authority: 本 track 的入口与 owning contract 路由；执行状态唯一权威是 Tracker。
Decision: [DEC-075](../../../product/decisions/dec-075-legacy-surface-cleanup.md)
Product spec: [Bounded Cleanup Product Spec](../../../product/specs/pa-bounded-code-cleanup-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- 移除明确批准的 Pagelet 旧设置 UI、七个命令入口、无效每周扫描跳转、旧 Operations
  设置链与 Pagelet 专用自动关联链；保留发现、阅读、保存、Chat Operations 与历史数据。
- Delivery class: L2。复用既有清理规范，以短 SDD 说明多模块兼容与共享边界，不另建 Plan。
- 第二批按 DEC-075 与规范 REQ/AC-07–14 接续：旧生成/气泡、外围旧命令、无效开关、
  匿名事件链、旧 append/StatsStore 与专用资源退役；当前功能、显示和数据保留。
- 第三批按 DEC-075 与 REQ/AC-15–21 接续：旧状态命令/metadata链、无效设置兼容、
  coalescer、append预览/hash、提示pending和三个辅助入口退役；明确保留项不变。
- 不包含批准范围外的功能退役、测试 vault 数据清理、Git 推送或发布；第二批本地提交
  已获 Owner 后续授权，具体范围见 Tracker。

## Artifacts

- [Tracker](./tracker.md)
- [SDD](./sdd.md)
- [Pagelet Product Design](../../../product/pagelet-product-design.md)
- [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)

本页不镜像交付状态、下一步或验证结果。
