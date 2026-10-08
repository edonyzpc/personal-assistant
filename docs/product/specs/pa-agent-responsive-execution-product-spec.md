# PA Agent 响应性 Product Spec

Document status: Approved
Updated: 2026-10-08
Work item: B-155
Authority: Owner 已授权的非阻塞运行约束及 [DEC-047](../decisions/dec-047-agent-responsive-execution.md)。
Decision: [DEC-047](../decisions/dec-047-agent-responsive-execution.md)

> 2026-10-08：[B-165 Product Spec](./pa-agent-snapshot-execution-product-spec.md) 接续来源复核与准备方式，取消当前生成/重试的持续追溯检查，并按配置变化更新下一 loop。原生 UI 响应、协作执行与能力范围要求保持；B-155 历史证据不作为新目标的完成证明。

## Outcome And Scope

Agent 检索、准备输入和检查来源时，用户仍可切换 tab、编辑笔记、执行原生命令、保存和停止任务。保持“安静且可信”：安全负责确定性权限和真实来源，Agent loop 负责按任务需要复查事实与最新内容。

本次覆盖 Chat 的 vault 检索、来源批次准入、观察证据投影和上下文准备。沿用 [Agent runtime 产品合同](./pa-agent-runtime-evolution-product-spec.md) 的范围、快照、取消、预算及真实请求边界；不新增工具或模型调用。

## Requirements

| ID | Requirement |
| --- | --- |
| B-155/REQ-01 | Agent 工作规模增长时，PA 的检索、来源校验与输入准备必须有界地让出 renderer；Obsidian 原生 tab、编辑、命令和保存保持可操作 |
| B-155/REQ-02 | 来源检查按职责分层：整批输入准入、目标单篇身份与权限、实际读取与请求边界；不在每候选路径重复解析与验证整个 ancestry，不为单文件身份复查枚举全库 |
| B-155/REQ-03 | 保留真实来源、派生 ancestry、未知来源拒绝、固定本次范围和动态撤销；普通编辑保留已读快照，最新请求和写入另行验证 |
| B-155/REQ-04 | 停止、会话失效和卸载能中断只读准备；停止后不开始下一读取或模型请求，迟到结果不能更新结束任务；已接受的独立图片任务与队列回执保持原有生命周期 |
| B-155/REQ-05 | 保持既有检索语义、排序、覆盖/截断说明、任务预算、历史与存储格式；不通过缩小能力或静默丢弃扫描证据换取响应性 |
| B-155/REQ-06 | 验收覆盖以上行为与关键失败路径，复用现有测试与构建部署；桌面真实原生操作与 CLI mobile simulator 各验证受影响流程，不建立额外全域性能或设备矩阵 |

## Non-goals

- 不承诺设备 CPU 无限负荷下的固定帧率或固定完成时长；约束的是 PA 自身不会以无界同步工作阻断原生操作。
- 不改来源选择产品、Data Boundary、Memory 自动维护或跨设备状态。
- 不把扫描未命中项偷偷改成 source-free；范围级观察的压缩需要完整来源生命周期证明，本次不能凭一个 digest 放行。
- 不新增用户可调线程数、切片设置、性能面板或持续压测。
- 不改 Git、发布、正式 vault 配置；本次授权到实现验收。

## Acceptance Criteria

| ID | Acceptance criterion |
| --- | --- |
| B-155/AC-01 | 代表性多笔记检索与大 ancestry 的实际准备过程中，桌面可以切换两篇测试笔记、输入并保存内容，命令及停止按钮响应；mobile simulator 能执行对应受影响操作 |
| B-155/AC-02 | 回归证明重复候选检查不会乘上完整 ancestry 验证次数，单篇读取复查使用直接身份查询；枚举、匹配、排序及投影的大循环存在实际 macrotask 切片 |
| B-155/AC-03 | 在让出执行期间排除/删除/替换来源或撤销域权限，恢复后不能继续读取或实际模型请求；相同位置普通正文编辑不误撤销旧快照，未知和混合来源规则保持 |
| B-155/AC-04 | 在准备、遍历或读取等待中停止后，执行及时结束且不再开始后续读取/请求；后来的结果被忽略；既有独立图片和持久队列的来源撤销回归通过 |
| B-155/AC-05 | 现有来源、检索、观察投影及上下文相关回归保持通过，结果次序/覆盖和预算契约保持；打包仍使用正常 Obsidian 插件资产 |
| B-155/AC-06 | Tracker 记录 focused/full/build/deploy、实际桌面/mobile 证据及其边界；缺失证据不能冒充通过。检查仅因相关输入变化或具体未解决风险扩展 |

## Traceability

- [B-155 最终验证](../../archive/2026/b155-agent-responsive-execution-validation.md)
- [B-155 Architecture](../../architecture/pa-agent-responsive-execution.md)
