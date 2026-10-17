# DEC-068 — Chat 本次修改单卡汇总与整次撤销

Decision ID: DEC-068
Status: Accepted
Updated: 2026-10-18
Authority: Owner 于 2026-10-17 确认单卡交互预览及「撤销 / Undo」双语修订，先要求设计和独立审查，随后授权按 B-178 完成开发测试及测试库实际交互；2026-10-18 补修验收后明确授权收尾及本地 master 提交。Accepted 记录产品选择；已完成范围与证据限度分别见当前 Spec 和历史验证记录，不表示发布。
Work item: B-178

## Context

Anthelion 的一次发布前检查在同一条用户请求下出现四张 Review 卡片，包含已应用、
执行冲突、跳过、撤销失败和已撤销状态。同一笔记的路径与逐操作 Undo 重复出现，
用户必须自己拼合最终结果。该观察证明交互负担；未查询完整原始回执，不能把每次
冲突或撤销失败都归因于某个确定的执行缺陷。

原 [DEC-046](./dec-046-note-change-review-and-audit-retirement.md) 按 intent 汇总，
明确不跨批次。设计开始时 Chat 在 `onOperationsIntentStaged` 为每个 intent 创建审阅会话；
一次用户请求可能包含多个模型阶段和 SDK 子操作。这是产品展示单位与任务单位不一致。

## Options Considered

| Option | 收益 | 代价 / 结论 |
| --- | --- | --- |
| 维持批次卡片，只默认折叠 | 改动少 | 仍须理解多个结果与多个 Undo；不采用 |
| 一张外壳，内部原样堆叠各批卡片 | 入口集中 | 未解决最终差异与整次撤销范围；不采用 |
| 按本次用户请求汇总实际变化，复用 owner 回执整次撤销 | 与用户任务对应，最终结果可核对 | 需要跨批次投影及撤销接线；Owner 选择 |
| 新建跨请求事务、持久历史和快照回滚 | 可提供更广恢复 | 超出当前需要，可能覆盖后续编辑；不采用 |

## Decision

1. 同一 Chat 用户请求的 Operations 修改汇总为一张卡片，包含该请求的原生工具与
   SDK 子操作；不同用户请求、会话和 Pagelet 不合并。Agent 仍自主分步执行。
2. 默认收起，显示真实完成状态、涉及笔记/资源及变化摘要；展开可查看全部实际变化。
   连续修改同一内容合并初末差异，失败、未执行、已撤销内容不得冒充当前有效变化。
   存在人工编辑或不同内容表示的断点时，保留分段事实，不伪造一个连续差异。
3. 卡片只提供本次范围的撤销，按钮为「撤销 / Undo」，进行中为「撤销中… / Undoing…」。
   无逐操作 Undo 列表。撤销使用现有真实回执逆序恢复，保留 drift、权限、身份、
   恢复资源与期限检查；不以整篇旧快照覆盖，不承诺原子全部回滚。
4. 真实完成、停止、部分完成、结果未知、撤销中、全部/部分撤销、冲突与失效如实区分。
   停止不抹去已发生效果。撤销后原差异默认收起，以历史变化标识；后续编辑受保护。
5. UI 支持项目现有中英文机制。笔记名、路径和正文保持原文；不增加产品语言开关。
   预览里的语言/场景选择器仅用于评审，不进入产品。
6. 继续内存审阅与临时 Undo，不增加持久审计、跨重载恢复、模型摘要或额外 provider 请求。
   不改变 Operations 的执行授权、Agent 规划、SDK 能力或其他领域的确认边界。

### Scoped Supersession

本决定仅为 Chat 本次请求接续 DEC-046 的“不跨批次合并”、每批独立审阅入口及
逐操作 Undo 呈现；对应目标见 [B-178 Spec](../specs/pa-chat-request-change-summary-product-spec.md)。
DEC-046 的审计退役、旧目录零管理、差异完整性与临时恢复边界继续有效；
[DEC-063](./dec-063-direct-operations-and-native-move.md) 的单次工具写入、真实结果、
移动与宿主引用职责不变。当前行为由 Spec 与 Operations 架构承载，验证范围见历史记录。

## Consequences

- 复用 Operations owner、审阅模型/会话、Chat、既有完整审阅 tab 和本地化；不新增执行器或状态账本。
- 跨批次汇总需要区分用户请求与模型阶段；整次撤销需要真实顺序和 owner 并发保护。
- 混合资源效果继续显示各自事实，例如 editor buffer 不声称已保存，打开文件不计作正文修改。
- 设计和实际实现均已独立审查，测试与 repo-local 交互验收完成；Git 与发布仍分别授权。

## Revisit Trigger

需要持久/跨请求 Undo、局部接受/撤销、跨领域事务，或现有 owner 无法保留实际效果
与恢复语义时，再讨论新的产品范围；不以预览固定数字或示例流程制造额外能力。

## Traceability

- [Product Spec](../specs/pa-chat-request-change-summary-product-spec.md)
- [Operations Architecture](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)
- [B-178 Validation](../../archive/2026/b178-chat-request-change-summary-validation.md)
- [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
