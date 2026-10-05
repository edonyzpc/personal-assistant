# DEC-048 — Context 保留合法执行事实

Decision ID: DEC-048
Status: Accepted
Updated: 2026-10-02
Work item: B-157
Authority: Owner 明确要求从 context 根本解决 create_image、Writing、blog2ghost 等历史执行事实丢失，并要求按 B-157 方案设计及开发计划完成全部任务。

## Context And Decision

旧要求仍进入后续请求而执行事实被过滤、压缩或未保存，会使 Agent 误判尚未完成。Host 继续执行合法调用符合既有职责。沿 [DEC-043](./dec-043-agent-runtime-evolution-and-source-scope.md) 与 [Context 契约](../specs/pa-context-management-product-spec.md)，修复统一事实投影，而非建立 Host 自然语言意图分类器。

采用 B-157 已讨论方案：领域 owner 的最小安全状态、正文与状态各自来源准入、现有 conversation 存储可选扩展、领域真实事件刷新、压缩/摘要/native/compat/fallback 一致。工具返回成功不等于领域完成；历史不是新权限。

不采用每命令局部去重作为主修复，不建立第二 ledger/Agent SDK，不原样持久化 canonical、私有正文、Undo 内容或摘要，不自动重放未知操作。

## Consequences And Revisit

产品范围以 [B-157 Product Spec](../specs/pa-action-continuity-product-spec.md) 为准，已完成的开发验收和 Owner 判读见 [最终证据](../../archive/2026/b157-context-action-continuity-validation.md)。原批准是设计与实施授权，不是 Git 或发布授权。若须扩大来源/动作权限、改变持久化边界或新增存储层，必须先交 Owner 决定。
