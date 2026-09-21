# Plugin Shell Refactor Development Track

Document status: Current
Updated: 2026-09-20
Work item: B-143
Authority: 本 track 的简短入口与 owning contract 路由。
Decision: [DEC-039](../../../product/decisions/dec-039-plugin-shell-refactor.md)
Product spec: [Product Spec](../../../product/specs/pa-plugin-shell-refactor-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 保持现有完整功能，按实际状态和资源所有者拆分 plugin.ts，并完成 LC-01..03 限定修复。
- Delivery class: L3，跨模块、事务与生命周期的分阶段重构。
- Non-goals: 启动提速、数据迁移、全局关闭重设计、其他既有缺陷修复、框架或 runner 改造。

## Artifacts

- [Development Tracker](./tracker.md)
- [Delivery Plan](./plan.md)
- [Software Design](./sdd.md)
- [GOV-003：B-142 最终测试约束](../../governance/gov-003-proportionate-test-design.md)
- [Refactor Workflow](../../workflows/refactor-workflow.md)
- [GPT-6 / GLM Delivery](../../workflows/gpt6-glm-delivery-workflow.md)

执行状态、下一步、finding 和证据只写 Tracker。
