# PA Agent Task Source Boundary Product Spec

Document status: Approved
Updated: 2026-09-24
Work item: B-146
Decision: [DEC-042](../decisions/dec-042-agent-task-source-boundary.md)
Authority: Owner 最终确认的当前产品边界与验收条件。原方案的 B-146/REQ-01–06、AC-01–06 已由 DEC-042 后续修订替代，仅为历史事实；本规格以 REQ-07–08、AC-07–08 为准。

> [DEC-043](../decisions/dec-043-agent-runtime-evolution-and-source-scope.md) 与 [B-149 产品合同](./pa-agent-runtime-evolution-product-spec.md)已局部接续：用户显式选择的问答范围硬约束实际取材、历史及派生上下文。本文仍记录 B-146 已交付行为；自由语言不充当 Host 已证明的权限、显式 Writing 和独立动作保护继续适用。

## Current Boundary

- 主 Agent 遵循本轮自由语言中的取材、禁网、偏好和排除指令，自主决定普通笔记读取、搜索与补查。Host 不把这些自然语言解释或模型自报声明转换成普通读取硬门，也不承诺独立识别任意措辞。
- Host 保留 Data Boundary、真实来源和操作身份、能力开关、取消/预算、来源撤销及持久或结果未知副作用的运行时保护。写文件、改配置、删除等独立操作仍按权限和后果请求用户决定；普通获准读取和已开启的常规搜索不逐次确认。
- 按现有来源设置允许 Chat 读取的笔记，可用于已配置 LLM 和已开启的 WebSearch 等 Chat 工具；Host 不按目的地或内容敏感性增加第二层外发门，也不新增受保护标记。允许来源可能含敏感内容；Host 不保证拦截其原文或改写内容进入搜索请求。
- Data Boundary 排除文件夹/标签是完整来源排除：默认不可读取、引用或发送至模型和搜索工具。现有 Data Boundary 规格中的显式本次例外还没有 Chat 接线，B-146 不以旧来源决定工具冒充该例外；独立后续见 [B-147](../../backlog.md)。
- Writing 作品由 `@Writing` 等显式 Chat 操作或明确继续已有版本开启。普通咨询不因答案长度、写作词汇或历史作品隐式进入作品交付；旧作品和恢复记录仍可读、可继续。
- Data Boundary 拒绝某次读取不单独判定整个任务无法完成。Agent 确认无法完成时可用结构化纯输出标记说明并使终态为 `incomplete`；Host 不用最终文本关键词推断任务状态。模型漏用标记仍可能误报完成，独立运行故障按原规则处理。

## Requirements And Acceptance

- **B-146/REQ-07 — Agent 自主取材**：主 Agent 遵循用户自由语言来源要求，直接选择普通笔记读取与已开启的搜索；Host 不要求模型先自报用户上限，也不从自由语言自行生成普通读取硬门。结果说明实际使用了哪些来源。
- **B-146/AC-07**：普通取材与搜索可在独立设置允许时无需 `declare_source_scope` 完成；用户自由语言中的限定由 Agent 遵循，Host 不以模型声明或关键词误拒合法补查；回答中的来源可追溯到真实执行结果。普通问答不绑定 Writing 交付；`@Writing` 或明确继续已有版本才绑定写作上下文与作品交付，运行中断后仅由用户主动继续该任务时恢复操作和父版本。
- **B-146/REQ-08 — 独立运行时保护**：Host 保留明确设置、真实目标与执行结果、取消/预算、来源撤销和不可逆或结果未知副作用的保护。Chat 可读来源可用于已配置模型和已开启的搜索工具；Host 不对该来源增加内容敏感性或目的地确认。写文件、改配置、删除等独立操作仍由用户按既有规则决定。
- **B-146/AC-08**：普通读取和常规已开启搜索不因抽象取材计划或内容敏感性逐次询问；Data Boundary 排除阻止读取及进入模型/搜索输入，最终请求后真实撤销也阻止来源派生正文交付；WebSearch 关闭后不能新增搜索请求。来源拒绝本身不强制整个任务 `incomplete`；Agent 使用可选结构化未完成结果时，说明可见、终态为 `incomplete`，不执行伴随的其他工具。模型输出不能伪造写入确认、放宽独立设置或把结果未知操作当作可安全重放。

## Compatibility, Non-goals And Evidence

- 旧 `declare_source_scope` / `request_source_decision` 协议不再可执行；历史记录可只读解释或取消，不能被新一轮任务当作权限或自动重放。普通 Chat 与显式 Writing 的状态、作品版本及恢复身份分别持久化。
- B-146 不增加本轮结构化取材控件、自由语言形式化证明、自动跨重载续跑、Data Boundary 排除例外、敏感外发分层或新的写入/付费权限。自由语言限制由 Agent 遵循，Host 不提供独立硬保证。
- 回答事实质量与来源准入是不同的验收问题。B-146 的 Chat 运行、来源保护和状态可完成，并不证明联网回答的数字与结论正确；已发现的事实质量问题和泛化核实方向见 [B-148](../../backlog.md)。
- 实现职责见 [PA Agent architecture](../../architecture/pa-agent-architecture-plan.md#task-source-and-writing-output)；本地验证结果、已处理 review 问题及保留证据范围见 [B-146 validation](../../archive/2026/b146-agent-task-source-boundary-validation.md)。本规格与本地验证均不等于 beta 发布或设备安装证明。
