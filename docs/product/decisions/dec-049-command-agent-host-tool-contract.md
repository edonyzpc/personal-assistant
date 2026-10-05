# DEC-049 — PA Agent Command 的统一职责与交互契约

Decision ID: DEC-049
Status: Accepted
Updated: 2026-10-05
Authority: Owner 于 2026-10-04 要求先明确 command、Agent、Host、Tool 抽象与契约，再落实方案/SDD/测试/review工作流，随后公共框架重构，最后逐 command 调整。
Work item: B-158

## Context

既有 DEC-034/038/040/042/043 已明确主 Agent 负责语义及恢复，Host 守明确权限、
执行事实和资源。仅重复原则未能阻止功能实现重新以词面规则裁决语义、把首次失败
锁成永久阻断。需要固定 command 范式及交互关系，并将其纳入设计与验收输入。

## Decision

1. Command 是同一主 PA Agent 执行的领域任务契约与工作指引。固定目标、必要领域条件、
   输入/产物、能力需求、完成与确认边界；Agent 自主理解、规划与在授权内纠错。
2. Host 提供横切 harness：真实调用上下文、明确权限、文件/来源/协议校验、运行资源、
   取消/并发与实际效果保护。Tool 是结构化执行接口，领域 owner 拥有业务 operation、
   必要阶段、产物及真实状态。不能把所有领域逻辑集中到通用 Host。
3. 将声明与本次调用、Agent run 与 tool attempt 与 business operation 分开；
   确定未执行的技术错误允许修正，已受理/部分/不明效果保留身份并核实，不能盲重放。
4. 统一定义只在 [架构契约](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
   维护。方案、SDD、派工、测试和 review 引用并落实任务级职责映射；架构符合性先于绿测验收。
5. 顺序固定为架构契约 → 流程落地 → 公共框架 → 领域 command 迁移。沿用现有
   loop/registry/policy/来源准入/回执/存储，不新建编排引擎、权限体系或 command 状态库。

## Authority And Compatibility

2026-10-05 Owner 先要求清理 Host 关键词读取判断及 Operations 无依据容量限制的
规则和合同，再讨论去掉 Host。相应旧约定已撤销，统一定义见
[架构修订](../../architecture/pa-agent-architecture-plan.md#2026-10-05-contract-cleanup)。
本次仅修改文档，运行代码尚未对齐；上述既有模块、流程及 Host 职责不构成后续
讨论必须保留 Host 规则的前提。

这是既定职责的统一落实，不授予新的网络、数据、付费、写入、确认、跨设备恢复或
Git/release 权限。DEC-038/044/045 等领域具体范围、必要辅助模型和确认边界保持。
原批准工程范围已完成，历史验收见 [B-158 最终验证](../../archive/2026/b158-agent-command-contract-validation.md)；
后续容量/读取/直接执行约定由 [B-161](../../archive/2026/b161-contract-alignment-validation.md) 接续。
F-24 恢复提示仍延期至 B-159，不以架构或后续工程结果改写原模型失败。

## Revisit Trigger

真实证据证明既有身份、回执或执行事实不足以支撑恢复，或需要改变用户可见权限/费用/
数据/兼容承诺时，提交具体差异；不能由局部实现或测试反推批准。

## Traceability

- [Product Spec](../specs/pa-agent-command-contract-product-spec.md)
- [B-158 最终验证](../../archive/2026/b158-agent-command-contract-validation.md)
- [DEC-043](./dec-043-agent-runtime-evolution-and-source-scope.md)
- [DEC-048](./dec-048-action-facts-and-context-continuity.md)
