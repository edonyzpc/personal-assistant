# DEC-063 — 单次 Operations 写入、结果连续性与原生移动

Decision ID: DEC-063
Status: Accepted
Updated: 2026-10-12
Authority: Owner 于 2026-10-11 明确选择单次写入、review/现有 Undo、结果连续性、能力不足收敛与移动；2026-10-12 确认引用由 Obsidian 负责，授权 GPT 开发测试，随后明确授权 B-173 closeout 与本地 master 提交。Accepted 定义产品范围，不代替实际 Git 或发布结果。
Work item: B-173

## Context

一次明确移动请求出现长时间推理与未结束状态。已核实的机制是：现有工具只能创建
副本，没有 Markdown 移动或删除原文件能力；实际创建已 completed，但执行观察在
下一轮来源准入中被移除，有限状态投影也因 receipt 身份格式不匹配而失败；模型在
确认能力不足、甚至重新查询到创建成功后仍未及时收尾。

Confirm 卡片不是该次创建的执行前提。当时明确写入已经可由 Agent 直接调用
`execute_operations`，但仍需先 stage，再让模型发起下一次执行调用。现有 Undo 没有
在故障中执行，也没有证据表明它造成主要耗时。机制、时序及证据限制见
[故障及验证记录](../../archive/2026/b173-direct-operations-validation.md#根因与历史边界)。

## Options Considered

| 选项 | 收益 | 代价与边界 | 结论 |
| --- | --- | --- | --- |
| 只修结果传递 | 消除已成功动作被遗忘 | 仍有必经 stage/execute 往返；不能移动；能力不足仍可能反复探索 | 不足以覆盖本次目标 |
| 去掉 Confirm 和 Undo，仅保留记录并让 Agent 回滚 | 表面交互更少 | 需要新的恢复数据与反向操作能力；增加模型依赖，不能替代当前确定性 Undo | 不采用 |
| 单次写入 + 保留 review/Undo + 结果修复 + 能力收敛 + 原生 move | 去掉无必要的模型往返，覆盖实际缺陷，保留现有恢复能力 | 需要同时对齐工具语义、领域结果、上下文和审阅生命周期 | Owner 选择 |
| Host 语义判定目标、固定少量轮次强制结束 | 可强制停止某些长任务 | 偏离 Command Architecture Contract，可能截断正常复杂任务 | 不纳入本次 |

## Decision

1. 当前明确的 Operations 修改请求，在一次写入工具调用内完成准备、校验、执行和
   真实结果返回。准备仍是内部职责，不再要求模型先暂存、再调用执行工具。
2. 删除该流程多余的 Confirm 与等待卡片激活逻辑。保留差异查看、完整审阅页、Undo
   和 Undo all。用户明确要求仅预览时零写入；随后请求执行时重新核验当前状态。
3. 领域 owner 的结构化执行事实成为工具返回、审阅状态及下一轮上下文的一致依据。
   保留来源限制与未知状态，不用放宽来源准入或自动重放来修复丢失。
4. Agent 按目标所需效果判断能力；已确认不能完成时使用现有 incomplete 终态说明
   完成部分、缺失能力与下一步。Host 提供真实能力及效果，不接管语义规划。
5. 增加当前 vault 内 Markdown 原生移动，并接入相同结果、审阅与 Undo 链路。
   不以创建副本、清空原文或重定向替代移动。

### 移动与引用的宿主职责

2026-10-12，Owner 明确：“Obsidian 会自动更新引用，PA 不需要自己做。”
正向移动和 Undo 反向移动均使用 `FileManager.renameFile`，由 Obsidian 按自身设置
维护引用。PA 不实现关联引用扫描、改写、快照、逐项恢复或独立引用策略。

PA 负责移动目标的身份/路径/冲突检查、实际结果、路径变更审阅及现有临时 Undo。
移动 Undo 是经校验后调用宿主移回原路径，引用仍由宿主处理，不承诺整个 vault 的
历史字节级恢复。此前 OQ-01 已解决，原先要求 PA 接管关联引用恢复的设计不再采用；
实际接线及验证边界见 [B-173 验证记录](../../archive/2026/b173-direct-operations-validation.md)。

## Consequences

- 产品：少一次必经模型往返，写后可查看、可撤销；不承诺固定完成秒数或所有模型都
  在固定轮次收敛。真实模型行为必须单独验收。
- 架构：沿用现有 Operations controller、review、Undo store、action facts 与 Context
  Manager；不新增持久执行账本、通用事务框架或 Host 语义分类器。
- 数据：继续会话内恢复，不增加审计、长期变更历史、持久 Undo 或跨重载写入恢复。
  Undo 失效不抹去已经确认的执行事实。
- 兼容：旧 pending 提案不自动执行；历史结果仅作上下文，不能取得新写入权限。
  其他领域的必要确认继续由各自契约决定。

## Authority And Compatibility

本决定细化 [DEC-051](./dec-051-proportionate-confirmation-and-contract-alignment.md)
第 4 项，并局部接续 [DEC-046](./dec-046-note-change-review-and-audit-retirement.md)
相关 Operations stage/Confirm 用户流程；不改变来源、图片联合删除、Writing、Ghost
正式更新或 Pagelet 其他领域的授权边界。[DEC-048](./dec-048-action-facts-and-context-continuity.md)
的真实状态连续性与 [DEC-049](./dec-049-command-agent-host-tool-contract.md) 的职责继续适用。

本次修复来自真实使用中定位的 Operations 结果丢失和不可完成任务，不能将 B-159/F-24
及 B-171 M3 的历史延期样本改记为已修复或已通过，也不启动原来的完整评测矩阵。

## Revisit Trigger

需要非 Markdown/跨 vault/目录移动、持久恢复、通用文件删除，或充分真实模型证据
表明正确能力与结果反馈下仍无法收敛时，再单独讨论扩展；不从可能性预先加机制。

## Traceability

- [Product Spec](../specs/pa-direct-operations-product-spec.md)
- [当前 Operations 架构](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)
- [B-173 验证与收尾](../../archive/2026/b173-direct-operations-validation.md)
- [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
- [现有写入框架](../../architecture/write-action-framework-sdd.md)
