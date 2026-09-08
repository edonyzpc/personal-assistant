# Simple Settings Development Track

Document status: Current
Updated: 2026-09-08
Work item: B-106
Authority: 本 track 的产品契约、实施设计与开发任务入口。
Decision: [DEC-033 — Simple Settings And Unified Defaults](../../../product/decisions/dec-033-simple-settings-and-unified-defaults.md)
Product spec: [Simple Settings Product Spec](../../../product/specs/pa-simple-settings-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 普通用户不管理内部调用机制，仍可控制使用偏好、数据范围和权限；
  废弃开关不再造成新旧用户运行差异。
- Delivery class: L3，涉及设置持久化、Pagelet 调度、Memory/Skills admission 和多处 UI。
- Explicit non-goals: 新 provider 架构、检索算法、Memory 存储重构、权限扩大、
  旧 Pagelet 管线重启、Git/release 与未授权 closeout。

## Artifacts

- [Development Tracker](./tracker.md) — 任务、依赖、状态和验证证据。
- [Delivery Plan](./plan.md) — 阶段边界、协作安排、验证复用和回滚。
- [Software Design Document](./sdd.md) — 字段清单、源码入口、状态与接口设计。
- [Settings current implementation](../../../architecture/settings-status.md)

执行状态与下一步只看 Tracker。
