# DEC-065 — Pagelet 自主发现闭环

Decision ID: DEC-065
Status: Accepted
Updated: 2026-10-16
Authority: 用户于 2026-10-16 在 Pagelet 连续产品讨论中认可第一轮细化方案，并明确要求按项目规范形成设计、开发和测试文档；本次仅授权文档，不授权运行代码修改、提交或推送。
Work item: B-175

## Context

Pagelet 的价值是让有用内容在需要时自然浮现；主动性和深入洞察都是关键。
发现可以是旧笔记之间的新联系，也可以是当前笔记的错字、表述问题、矛盾或更高阶的改进建议。
这些是可能的价值，不能变成分类配额、指定优化方向或 Host 的价值评分标准。

当前实现通过 exact-ID lead、首条/第二条阶段、双来源、单条输出、浅层关键词和相似度等
规则替 Agent 判断探索与交付；部分规则同时存在于代码、提示词和工具回执。
用户选择由 Agent 自主判断方向、深度、何时继续及是否值得呈现，PA 提供事实上下文、工具和可靠交付。

## Options Considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| 保留规则，仅放宽阈值或改成提示词建议 | 改动较少 | 仍由 Host 规定探索路线与何时收束，违背已确认职责 | 不采用 |
| 只接收最终一份报告，删除暂存 | 路径较少 | 后续失败会丢失已完成结果，也失去各份结果独立来源与失效边界 | 不采用 |
| 自主探索、可选完整文本暂存、事实校验、最小交付修复 | 保留模型主动性、深入能力和完成成果 | 需要协调现有多处约束与状态 | 采用，仅第一轮 |

## Decision

1. Agent 决定关联、问题、改进价值、取材顺序、探索深度、继续/结束、结果内容与数量。
   允许自动深入；不要求先浅后深、先相关后洞察，或必须由用户另点“深度”才能探索。
2. Pagelet 提供当前冻结 Vault 笔记、已许可读工具、来源和运行事实，负责来源/权限、
   生命周期、真实资源边界及完整交付。不添加价值分类器、语义判分器或第二规划者。
3. 自然 Markdown 保持自由；一份完整交付文本可以包含多个发现。取消每 run 0–2 上限、
   单文本单发现、双来源及 non-anchor 必需条件，不按标题/编号重新拆分语义成果。
4. 保留 `stage_pagelet_insight` 作为可选暂存：Agent 可直接最终回答，也可暂存一份或多份
   完整文本后继续。暂存与检索恢复开关、Host 邀请、首条/第二条阶段、`unresolvedLead`
   解耦。每份文本保留独立身份、真实来源和重新校验；不承诺跨重载恢复或流式半成品交付。
5. 检索恢复仍由 Pagelet run-scoped owner 管理既有单次 token、查询快照和真实执行边界。
   合格 `none` 或 `partial + needsMoreEvidence` 在原搜索调用内恢复，不等待暂存；
   token 耗尽只影响该恢复机制，不代表 Agent 不能换查询、继续读取或产生更多发现。
6. 移除约束时同步覆盖所有模型可见输入。不能用“通常先……”“优先……”“建议到此结束”
   重新包装 exact-ID、固定步数、首/次发现、价值门及强制收束；保留目标、事实、工具能力、
   引用真实性、输入信任与权限边界，不规定唯一方法。
7. 第一轮只保证有效结果完整可达、来源可看、显式发现确实运行和终态真实。
   移除根据首个非锚点来源自动生成 Link 主操作的推断。发现和建议不授予修改权限；
   既有 Chat/Operations 仍按当前明确请求及真实权限执行，不新增确认链。
8. 主动出现保持轻量、可忽略，不自动打开完整内容或抢焦点。
   已认可的“短点始终看当前相关内容，长按快捷操作”留作后续入口收敛；本轮不扩大到
   完整入口重构、编辑器上下文扩展、保存中心、跨轮历史或新的修改执行界面。

## Supersession And Unchanged Boundaries

本决定局部接续 DEC-027 §5 中 Pagelet 的 0–2、首/次发现、暂存触发 partial recovery、
Host novelty/value 门，以及 Pagelet 旧 SDD/产品设计中的对应语义约束。
它不替换共享检索算法、Chat recovery、DEC-031 平台策略、全局来源权限、provider 信任、
自动运行额度与既有副作用授权。DEC-025 的完整入口/已看内容交互后续单独收敛，
DEC-035/DEC-052 的兼容命令及 `Open Pagelet` 零调用查看边界继续有效。

该接续是已批准的目标，不是代码已完成的声明。当前实现仍以源码为准，执行和验证只由
[B-175 Tracker](../../development/active/pagelet-autonomous-discovery/tracker.md) 记录；B-123/B-125 历史证据不重写、不复开。

## Consequences

- 模型可能得出不同方向、不同篇幅或没有发现；Host 事实校验不能证明语义正确或保证惊喜。
- 已明确暂存且仍有效的文本可在受控失败/未完成时保留，不能把整轮标成完成；显式取消、
  权限撤销及失效来源仍按真实边界丢弃或隔离。不同文本独立校验，一份内部不做语义拆分。
- 改动沿用当前模块、结果集合和来源生命周期；不新增结果平台或通用 Agent 框架。
- 实施时升级 pipeline identity，防止旧约束下缓存被当作新闭环的验证结果；无用户笔记迁移。

## Revisit Trigger

具体使用或验证证明来源不可追溯、有效成果丢失、取消/撤销失效、真实资源不可承受或
结果无法读到时，修正对应边界。个别模型没有产生预期洞察，不构成重新加入语义规则的依据。

## Traceability

- [Product Spec](../specs/pagelet-autonomous-discovery-product-spec.md)
- [SDD](../../development/active/pagelet-autonomous-discovery/sdd.md)
- [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
- Scoped predecessor: [DEC-027](./dec-027-bounded-retrieval-recovery.md)
- 来源：User request / approval 2026-10-16，本对话中职责边界、第一轮细化方案与文档化授权。
