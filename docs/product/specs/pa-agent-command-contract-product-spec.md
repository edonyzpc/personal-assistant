# PA Agent Command Contract Product Spec

Document status: Approved
Updated: 2026-10-04
Work item: B-158
Decision: [DEC-049](../decisions/dec-049-command-agent-host-tool-contract.md)
Authority: Owner 确认的四角色职责、统一契约、流程落实与分阶段重构顺序；不表示运行实现或验收完成。

## Problem And Outcome

避免 command 随功能实现漂移为本地语义分类器或固定调用脚本。用户能自然表达目标，
Agent 在实际反馈下纠错；确定性权限、资源与副作用保护仍由 Host 和领域 owner 执行。
减少反复纠偏与无意义确认，符合“安静且可信”。

## Scope

- B-158/REQ-01：统一 command/Agent/Host/Tool 职责，定义声明/调用与 run/attempt/operation 的交互契约，唯一架构来源。
- B-158/REQ-02：自然语言意图、否定、目标与计划由主 Agent 理解；Host 检查明确权限、结构化输入与实际事实，程序默认不能冒充用户选择。
- B-158/REQ-03：可恢复技术错误返回 Agent；确定未执行可修正，已受理复用，部分/不明结果核实；执行事实、领域状态和任务完成分开。
- B-158/REQ-04：将职责映射及三类证据落实到方案、SDD、派工、测试与 review；不增加每项任务的强制文档或新关键词 checker。
- B-158/REQ-05：在各 command 调整前重构公共接入及结果传递，复用既有 loop、registry、policy、来源与回执；独立框架阶段可验证且兼容旧入口。
- B-158/REQ-06：公共阶段验收后逐个迁移 Ghost、Writing、CreateImage，保持其已批准能力、必要阶段、真实结果与确认/恢复边界。

### Non-goals

- 新建主 Agent、command 编排引擎、长期状态库、网络服务或通用权限框架。
- 为安全猜测新增自然语言硬门、内容分类或每次准备前确认。
- 将普通直接 Obsidian 命令强制转成 Agent 任务；改变 provider、预算或已有数据/领域存储格式。
- 私有 vault/真实站点部署、生产外部写入、Git 交付或发布。

## Interaction And Trust

用户通过已有入口触发任务；Host 捕获上下文和本轮实际能力；Agent 选择工具与参数；
Host 准入后领域执行；真实结果和恢复动作返回 Agent；必要用户判断沿用已有 UI。
选 command 可以讨论或诊断，不能强制产生领域效果。历史事实、Skill 与模型参数不授予权限。

模型语义误判仍可能存在，不声称 Host 独立证明自然语言意图。沿用显式范围、Data Boundary、
来源 lineage、付费及领域确认保护。准备、受理、产物、正式完成分别呈现，未知结果不伪称未执行。

## Acceptance Criteria

- B-158/AC-01：四角色、五项 command 契约与调用/状态关系在唯一架构来源清楚定义，其他入口无竞争定义。
- B-158/AC-02：各设计中的语义/准入/状态/副作用事项有 owner 和事实依据；Host 不以任意词面规则或模型自报生成语义权限。
- B-158/AC-03：确定未执行修参、已受理复用、未知/部分不盲重放及取消/撤销路径有相应真实调用证据；合法事实在投影中保真。
- B-158/AC-04：开工、SDD、派工与正常 review gate 要求职责符合性；确定性、模型和 app 证据按变化区分，docs-only 不触发 runtime gate。
- B-158/AC-05：公共接入和桥接有集中 focused/integration、独立审查与所需 broad/app gate，旧命令行为/持久化兼容，框架退出不夹带领域行为重写。
- B-158/AC-06：每个领域迁移遵守统一契约，代表性真实模型任务与受影响 app 交互证明泛化/纠错及确认边界；未改部分复用有效证据。

## Delivery Handoff

- [B-158 最终验证](../../archive/2026/b158-agent-command-contract-validation.md)
- [Architecture](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
- 已完成切片及原失败见最终验证；B-159/F-24 等未完成事项见 Backlog。没有生产站点或发布授权。
