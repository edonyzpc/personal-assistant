# DEC-046 — 笔记最终差异审阅与 Operations 审计退役

Decision ID: DEC-046
Status: Accepted
Updated: 2026-10-05
Authority: Owner 在本次对话逐项确认下述产品选择，并于 2026-09-30 授权文档、开发测试及文档收尾；本记录承载产品选择，不授予 Git 或发布权限。
Work item: B-154

## 2026-10-05 Scoped Successor

[DEC-051](./dec-051-proportionate-confirmation-and-contract-alignment.md) 取消当前明确修改请求
的必经整批二次确认，保留差异审阅、真实结果与撤销；用户主动要求仅预览仍不执行。
持久Operations审计退役结论不变。运行代码尚待B-161对齐。

## Context

Chat 的长篇 Edit 预览难以辨认具体变化，确认按钮过于突出，Operations 在插件目录
持续生成用户不希望保留的 audit 文件。源码基线中预览将 Before/After 合并后截到
1,600 字符，可能丢掉全部 After；操作逐条渲染，审计与内存 Undo 是独立机制。
当前源码职责见 [Operations 架构](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)，
基线缺陷及完成证据见 [B-154 验证记录](../../archive/2026/b154-note-change-review-validation.md)。

本次以[北极星](../pa-product-north-star.md)的安静、可信和低管理负担为标准：
用户应能迅速看清笔记最终改变，而不必理解 Agent 的中间操作或管理日志目录。

## Options Considered

| Option | Benefits | Costs / conclusion |
| --- | --- | --- |
| 每个工具操作一块预览 | 直接对应执行步骤 | 同文件重复、需要自行拼合结果；替换为按笔记最终差异 |
| 所有差异都只放 Chat | 小修改无需切换 | 长文占满对话；保留紧凑预览并补手动展开 |
| 所有修改强制进入独立 tab | 集中审阅 | 小修改增加打断；不采用 |
| Chat 紧凑差异 + 手动打开完整审阅 tab | 小修改快，长文有阅读空间 | 需共享状态；Owner 选定 |
| 逐笔记或逐片段接受 | 更细控制 | 操作依赖与部分接受复杂；本次不采用 |
| 左右对照及模式切换 | 宽窗口便于比较 | 窄窗和 mobile 成本较高；第一版统一上下差异 |
| 审计默认关闭但保留开关 | 可选排查历史 | 增加设置与文件管理；Owner 选择彻底移除 |
| 自动清理旧 audit | 升级后目录消失 | 超出用户最终选择；明确不采用，用户自行管理 |

## Decision

1. 同一批操作按笔记分组，对比第一步之前与最后一步之后；不跨批次合并。
2. 按 DEC-051，当前明确修改请求可直接执行本批，不要求整批二次确认；仅讨论/预览
   不执行，用户主动从预览发起执行仍绑定本批不可变操作。不加入单文件/片段接受。
3. Chat 保留真实、紧凑差异，用户手动展开到一个本批独立 Obsidian tab；不自动抢焦点。
   重复打开复用本批审阅页，两个界面共享实际内容、执行状态、可用操作和结果。
4. 使用上下排列、增删标记与颜色、局部字词高亮；保留少量上下文，未改内容可展开。
   第一版无左右切换；完整审阅必须能查看全部变更，不以字符截断丢弃正文。
5. 桌面按钮 36px；mobile 保留约 44px 触摸高度。当前有效的主要动作突出，展开审阅弱化；
   Chat 操作在卡片底部，完整 tab 中操作区保持可见。
6. 彻底停止 Operations 持久化审计，移除正文记录/保留期设置，不留开关，不转存
   data.json、其他目录或新的持久日志。保留结果反馈、原有检查和内存撤销。
7. 新版不扫描、读取、迁移、清理或删除任何 vault 的旧 audit 目录；Owner 自行管理。
   本任务不改变独立 Chat history、Agent Debug、Memory 或 Ghost 的数据契约。

## Consequences

- 局部接续 [DEC-014](./dec-014-defer-operations-agent.md) 的逐操作 inline 呈现与
  content-free durable audit：本批 Chat 审阅采用双入口，Operations 审计不再持久化。
  其余工具、来源、权限、写前检查、顺序执行、Undo 边界不因本决定改变。
- 独立 tab 是同一会话的只读审阅视图，不是编辑器、持久任务中心或跨重启恢复系统。
- 整批执行不等于原子事务：既有顺序执行可以部分成功，界面必须诚实呈现。
- 失去独立审计文件的跨重启追查能力是已接受的代价；Undo 本来就是短期内存状态。
- 旧记录原地保留，不能把“移除审计功能”解释成删除用户现存文件的授权。
- 产品选择及稳定工程职责已吸收到当前 Spec 与 Architecture；本地实现验收的独有证据紧凑归档，过程包删除，不代表 Git 集成或发布。

## Revisit Trigger

真实审阅证明上下差异不足以核对大段重写；出现明确的逐片段接受需求；或 Owner
重新要求可见历史/持久审计时另行评估。不得自动恢复落盘或清理旧目录。

## Traceability

- [Product Spec](../specs/pa-note-change-review-product-spec.md)
- [B-154 验证记录](../../archive/2026/b154-note-change-review-validation.md)
- [现有 Operations 架构](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)
- Supersedes: DEC-014 中上述两个局部边界，不替代整个 Decision。
