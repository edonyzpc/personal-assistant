# DEC-080 — Chat 确认后后台准备 Memory

Decision ID: DEC-080
Status: Accepted
Updated: 2026-11-13
Authority: Owner 于 2026-11-13 明确选择 A，并要求按项目规范和 SDD 完成文档、开发跟踪与全部必要测试，避免过度设计和测试。
Work item: B-197

## Context

Chat 的获确认恢复准备使用检索 attempt 的取消信号，默认短预算同时包含确认和完整准备。长重建因检索超时中断后，进度消失，未完成 guard 继续使 Memory 不可用。状态入口本身没有取消代码；通知被关闭后没有恢复展示的入口，Chat 也未优先显示 preparing。

这些源码事实能解释故障机制，但不能唯一复原用户最初每次中断的原因。五篇 YAML 解析排除只解释它们未纳入索引，不是整轮重建中断的原因。

## Options Considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| A：确认后后台准备，Chat 本次继续 | 保持 Chat 响应，适合可能持续几十分钟的准备 | 本次回答暂不能使用尚未准备完成的 Memory；须保持真实取消和进度反馈 | Owner 选择 |
| B：确认后等完整准备再回答 | 本次回答可以等待新 Memory | 长等待与外层期限处理更复杂 | 未选择 |

## Decision

1. Chat 先做来源受限的 readiness / approval 检查，真正检索才进入短检索预算。非首次重建仍先说明 Data / AI provider / Cost 并确认；DEC-028 首次例外保持原限定范围。
2. 确认后重验来源授权、配置和生命周期，再由 MemoryManager 现有 operation 后台准备。Chat 返回准备中事实并继续回答。没有合法旧 Memory 时本次不使用 Memory；合法旧 Memory 可继续使用的更新语义保持。
3. attempt 超时、正常工具结束、Chat 正常回答完成不取消已接受的准备。活跃 Chat 的真实 Stop 取消该 Chat 独占准备；共享消费者、配置变化、Memory 关闭及卸载保持既有规则。
4. Status、查看进度和关闭通知只改变展示，不改变任务所有权。重复相容 Prepare/Update 复用有效 operation，不再次批准、清空或启动第二轮。
5. Chat 优先显示正在准备并提供查看进度；通知关闭后仅在用户要求时重开。计数单位准确，当前进程/配置的最近终态可重看；不将未知中断推断为用户取消。
6. 使用现有 Manager、端口、通知与 VSS 队列；不新增任务框架、持久任务历史、ETA、暂停恢复、全量准备独立停止按钮或自动跨重启续建。
7. 新的前置检查及确认后后台交互限定 Chat。共享调用保持 Pagelet、旧同步调用及手动 shared 操作兼容；不扩大来源、provider 或权限范围。

## Consequences

无 Markdown 修改、存储迁移或索引 schema 变化；保留 durable guard、prepared handle 和失败补偿。准备失败不会强设 Ready。聊天结束后，不再提供该聊天的 Stop；已有 Memory 关闭/卸载等生命周期入口仍有效。

最初授权为开发及必要本地验证；用户于2026-11-13随后明确授权将当前进展提交并推送master供MacBook续接。不包含tag/release或文档closeout。验收状态只见Tracker。

## Revisit Trigger

已有生命周期无法表达批准后的工作、必须改变 Pagelet 准入/等待或数据/成本边界时，回到产品决定。局部实现缺陷在本范围内修复。

## Traceability

- Product Spec: [Memory preparation lifecycle](../specs/pa-memory-preparation-lifecycle-product-spec.md)
- SDD / evidence: [B-197](../../development/active/memory-preparation-lifecycle/README.md)
- Inherited: [DEC-028](./dec-028-silent-memory-auto-prepare.md)、[Memory 产品契约](../specs/pa-memory-control-center-product-spec.md)
- Source: 本会话 Owner 的“A，我建议按照项目规范和SDD标准……完成所有的开发测试，不过度设计，不过度测试”。此前讨论草案已吸收到本决定、Spec 和 SDD。
