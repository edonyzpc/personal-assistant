# DEC-047 — Agent 执行不能阻塞 Obsidian 原生操作

Decision ID: DEC-047
Status: Accepted
Updated: 2026-10-08
Authority: Owner 本次讨论明确要求 Agent 运行不能阻塞 Obsidian UI、笔记编辑等原生功能，并授权 GPT 完成设计、实现和验收。
Work item: B-155

> 2026-10-08 行为修订：[DEC-055](./dec-055-agent-snapshot-execution-and-debug-history.md) 取消当前生成/重试的持续来源复核，配置变化在下一 loop 处理，并移除重复准备与逐片段来源检查。B-155 的历史实现/验收及原生 UI 响应要求保持；B-165 的最终验证见 [证据记录](../../archive/2026/b165-agent-snapshot-execution-validation.md)。

## Context

一次 Chat 检索占用 Obsidian renderer 线程，使切换 tab、编辑和按钮都无法响应。根因是逐文件来源检查反复验证整个输入 ancestry，并在同步循环中执行。它不是由实际读取几十万次正文造成，也没有证据证明存在无限循环。

来源控制继续遵循 [DEC-043](./dec-043-agent-runtime-evolution-and-source-scope.md)。普通内容变化采用已读快照，权限撤销、排除、删除和身份丢失继续生效；不能用性能优化降低这个边界。

## Options Considered

| 方案 | 收益 | 成本 / 风险 | 结论 |
| --- | --- | --- | --- |
| 每候选反复检查全部 ancestry | 保守地重复同一判断 | 乘法放大，同步阻塞，取消也不能执行 | 移除重复层级 |
| 仅让模型在 loop 中发现所有变化 | 开销小 | 确定性来源撤销不能交给模型概率判断 | 不采用 |
| 分离批次来源准入、单篇实时授权与协作执行 | 保留硬边界，降低重复成本，让原生 UI 有执行机会 | 各调用边界必须明确且真实接线 | 采用 |
| 全部 Agent 搬到新通用 worker runtime | 可以隔离纯计算 | Obsidian API 仍在 renderer，增加生命周期与协议负担 | 本次不建设；单项不能切片时才隔离该纯计算 |

## Decision

1. 原生编辑、tab、命令、保存与停止操作优先于 Agent 后台计算；不得让随 vault 或 ancestry 规模增长的 PA 同步循环垄断 renderer。
2. 完整 ancestry 在批次、读取、协作恢复及实际模型请求边界准入；候选路径只做目标身份和当前权限检查。
3. 普通内容变化沿用已读快照，明确要求最新时再查；来源权限撤销继续确定性阻止后续读取、请求和交付。
4. 调度、切片、Worker 和局部算法由 GPT 按实际源码决定，不需重复产品确认；不引入全域授权缓存、通用调度平台或新压力测试系统。
5. 不降低既有任务预算、检索范围或返回能力。验收覆盖讨论中的行为与回归，采用最低充分证据；非 iOS 特有行为用 Obsidian CLI mobile simulator。
6. GLM 已达周限额，本次由 GPT 负责完整设计、实现及独立验收。这是本次授权，不改写常规 GPT/GLM 工作流。

## Consequences

- Product behavior: Agent 可以花较长时间完成任务，但用户仍能继续操作 Obsidian。
- Architecture / data / safety: 无新增来源权限，无新增持久存储；输入 ancestry 和读取证据继续完整保留。
- Compatibility / migration: 不改历史格式和已有设置；桌面与 mobile 使用相同执行边界。
- Work created or removed: 创建 B-155 的实施设计和回归；移除逐候选全量 ancestry 校验与单篇复查全库的重复工作。

## Revisit Trigger

若真实验证发现某个不可分割的 PA 纯计算仍独占 renderer，则将该计算移入现有内联 Worker 构建方式，并补充对应兼容与取消证据；不因此重新建设整个 Agent runtime。

## Traceability

- Product Spec: [Agent 响应性](../specs/pa-agent-responsive-execution-product-spec.md)
- Architecture / SDD: [B-155 Architecture](../../architecture/pa-agent-responsive-execution.md)
