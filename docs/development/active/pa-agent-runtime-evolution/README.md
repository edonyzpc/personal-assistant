# B-149 PA Agent Runtime Evolution

Document status: Current
Updated: 2026-09-24
Work item: B-149
Authority: B-149 产品合同、技术设计与执行入口；本页只路由，不复制交付状态。
Decision: [DEC-043](../../../product/decisions/dec-043-agent-runtime-evolution-and-source-scope.md)
Product spec: [PA Agent 问答范围与 Runtime 演进](../../../product/specs/pa-agent-runtime-evolution-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Read Next

跨会话先读本页与 [Tracker](./tracker.md)，从 Tracker 的 Current Snapshot 获取下一步、证据与未完成项。

| 文档 | 用途 |
| --- | --- |
| [产品北极星](../../../product/pa-product-north-star.md) | “随手记下，需要时自然浮现”；安静且可信 |
| [Product Spec](../../../product/specs/pa-agent-runtime-evolution-product-spec.md) | 范围、上下文取舍、五项演进与 13 组 REQ/AC |
| [SDD](./sdd.md) | 源码基线、接口所有权、来源/消息/生命周期、迁移与负例 |
| [Delivery Plan](./plan.md) | GPT-6 Sol 任务卡、依赖顺序、测试命令、评测和实际应用门禁 |
| [Tracker](./tracker.md) | 唯一任务状态、finding、验证记录与跨模型交接 |
| [固定任务评测记录](./evaluation.md) | 逐例真实模型与离线证据、成本和可比性边界 |

## Related Contracts

- [DEC-040：可恢复 Agent 执行](../../../product/decisions/dec-040-recoverable-agent-execution.md)。
- [DEC-042：任务来源与显式动作](../../../product/decisions/dec-042-agent-task-source-boundary.md)。
- [PA Agent 当前架构](../../../architecture/pa-agent-architecture-plan.md)。
- [Documentation Workflow](../../documentation-workflow.md) 与 [Refactor Workflow](../../workflows/refactor-workflow.md)。
