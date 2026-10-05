# DEC-051 — 必要确认、前后台预算与合同接续

Decision ID: DEC-051
Status: Accepted
Updated: 2026-10-05
Authority: Owner 在本次 PA 合同审计中逐项确认第 1—11 项及第 1 项必要确认条件，并于 2026-10-05 要求制定优化方案和 SDD 开发任务。产品选择已获确认；本次授权终点是方案与任务设计，不是运行代码实施或 Git/release。
Work item: B-161

## Context

旧合同、当前实现和 Owner 最新选择出现三种差异：仍生效但已撤销的限制；已有 successor
但旧文档继续使用强制措辞；只存在于旧管线、并非当前用户入口的规则。
本次用实际入口追踪校正审计，不把实现常量、旧 Accepted 状态或测试通过当成产品依据。

审计来源：当前会话 `01a10b28-a561-7153-9820-36d723a4fb5e` 的逐项选择；关联
`01a104ab-0c67-7d41-827e-d56407835a1f` 的合同清理已由
[DEC-049](./dec-049-command-agent-host-tool-contract.md#authority-and-compatibility) 记录。
早期将旧 Review/Quiet Recall 限制描述为当前主入口行为的结论已撤回：当前普通入口
转向 Deep Discover；旧代码的问题不作为已观察到的用户故障。

## Options Considered

| Option | Benefits | Costs / risks | Disposition |
| --- | --- | --- | --- |
| 延续全部历史确认与数量上限 | 改动少 | 重复确认，后台额度阻断手动任务，旧合同限制新能力 | Owner 拒绝相关条款 |
| 删除所有限制和 Host | 表面简化 | 混淆语义判断与来源权限、文件身份、实际效果；超出已决定范围 | 不采用；整体 Host 去留另行讨论 |
| 只保留必要确认与有事实依据的执行保护，分开前后台 | 对齐明确授权，后台消耗仍受控 | 需要调整执行入口、结果展示、预算和旧合同 | Owner 选择 |

## Decision

| 讨论项 | 确认结果及适用范围 |
| --- | --- |
| 1 + 最后细化 | 取消按笔记篇数判高风险。来源/目标/范围不清时澄清；超出已有授权或实际费用超出已说明且获接受范围时说明变化并确认。已有明确授权不重复询问，不新增固定次数/金额门槛或语义正则。 |
| 2 | 保留旧 Quiet Recall 自动调用预算 10/小时、50/日的原边界；这是旧管线的 provider-call 桶，不代表当前 Deep Discover，也不授权复活旧管线。 |
| 3 | 保留显式 `@Writing` / 继续已有作品入口；普通 Chat 可文字回答，不能自动创建 Writing 作品。 |
| 4 | 当前明确修改请求可直接执行 Operations，取消必经的整批第二次确认；保留结果、差异审阅、撤销和用户主动要求的仅预览。 |
| 5 | 明确自然语言指定笔记时，Agent 可查找并绑定真实来源，不强制补点全文/选区控件；实际歧义才问。显式控件选择不能被静默替换。 |
| 6 | 保留 Ghost 边界：准备请求可上传资源、建立草稿并预览；正式更新/恢复确认具体版本；新文章由用户在 Ghost 发布。 |
| 7 | 取消 Share Card 50,000 字符/24 页的固定整批拒绝；保留内容完整、取消、实际资源失败处理及既定 SnapDOM 技术。 |
| 8A | 旧 Recall 5 候选是可调整实现默认，不是永久产品上限，不增设置 UI。 |
| 8B | 取消旧 Recall 字符正则语言拒绝及其自动重试；模型遵循输出语言，保留结构/必要字段校验和适用预算，不新增语言评审模型。 |
| 9 | 保留用户显式“我的笔记/网络资料/综合”对读取及派生材料的确定性边界；不要求保留某个 Host 类或现有组织形式。 |
| 10 | 明确手动请求不设累计次数硬限，不消费自动后台池；同样适用于本地 Maintenance/Graph 检查。 |
| 11 | 当前自动 Deep Discover 先保留 12/小时、36/日，按启动的发现任务计数，是可调整默认而非永久产品常数；不增设置 UI。 |

关联会话已撤销的 Host 关键词读取/复用判断、Operations 无依据数量/内容大小/恢复额度
拒绝一并纳入代码对齐。保留真实读取、分配、权限、共享引用、取消、并发及效果事实检查。
完整恢复快照未准备成功时不能把不可撤销删除当作成功执行。

## Supersession And Preserved Boundaries

本决定局部接续 DEC-023 的多来源确认、DEC-020 的候选/语言约束、DEC-024 的旧管线
适用性说明、DEC-044 的控件唯一选源、DEC-046/DEC-050 的必经整批确认，以及当前
Pagelet/Share Card 文档的相关限制。未涉及条款继续有效；不将整份旧 Decision 作废。
第 2 项保留历史桶不等于要求保留死代码；无生产消费者的专用 evaluator 可按依赖证据
退役，仍用到的共享 helper、合法旧数据读取和隐私边界必须保留。

已存在 successor 的 runtime 软预算、基础 Operations 能力、审计退役、已读快照、
generic preload/旧范围控件退役、effect/risk Memory、独立 Weekly Review 退役，
按既有 successor 校正文档；不重新实施已交付功能或改写原始验证结果。

## Consequences

- 已确认目标已由 B-161 完成本地实现与验收，历史失败及证据范围见
  [最终验证](../../archive/2026/b161-contract-alignment-validation.md)；不从批准状态推断实现或发布。
- Agent 判断语义和是否需要澄清；运行时/领域 owner 核验真实请求、权限、身份及效果。
  不以模型提交 `approved=true` 或 Host 关键词分类替代用户授权。
- 直接执行不等于自动执行所有提案；未知/部分效果先查询原操作，不能重复付费或重放写入。
- 不新增权限系统、持久审计、备份服务、预算设置页或语言评审层；不启用 B-119/B-112
  等未激活产品，不重开 B-159/F-24 的延期模型专项。

## Revisit Trigger

实际后台使用/成本数据支持调整默认；真实资源失败需要新的保护方式；涉及新的数据、
来源、正式发布或跨设备恢复范围。提出具体证据和差异，不从技术常量反推用户决定。

## Traceability

- [Product Spec](../specs/pa-contract-alignment-product-spec.md)
- [B-161 最终验证](../../archive/2026/b161-contract-alignment-validation.md)
- [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
