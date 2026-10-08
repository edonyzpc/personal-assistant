# DEC-055 — PA Agent 快照执行与完整 Debug 历史

Decision ID: DEC-055
Status: Accepted
Updated: 2026-10-08
Authority: Owner 在 2026-10-08 anthelion Chat 卡顿讨论中明确取消正在生成内容的持续来源复核；随后选择下一轮不再使用新排除旧材料、完整文本/reasoning/工具结果本地持久化、媒体只留引用与指纹、自动重试仍沿用当前轮输入。方案收缩后，Owner 授权完成 B-165 的开发与测试，并要求 GPT 接管实施；验收后明确授权 closeout 与本地 master 提交。推送与发布权限独立。
Work item: B-165

## Context

| 类别 | 依据 |
| --- | --- |
| 明确要求 | 元数据统计本身可保留；不能因为扫描过文件就在各阶段及回复片段间完整重查全部来源。配置变化是低频事件，由后续 loop 更新；当前在途生成不受后改配置、原文件编辑或删除影响。Debug 记录实际全过程 |
| 已验证事实 | 本次 `list_vault_tags` 扫描 1,859 篇笔记元数据；来源事实被继承到后续上下文。准备流程多次重入；每个 stream chunk 在 Debug 内容记录前调用同步完整来源检查，即使 Debug 关闭也执行 |
| 历史比较 | B-155 的异步扫描及工具批次准入复用仍在；两个 source-only guard 和每 chunk 接线在 B-155 前已存在，属于旧修复未覆盖路径 |
| 证据限制 | 137.512 秒的发送前准备有真实阶段记录，但未完成内部耗时分摊；不能归因于尚未开始的该轮流式接收，也不能当成连续冻结时长 |
| 产品澄清 | 下一轮收起新排除旧材料；Debug 完整文本/提取内容持久化但不复制媒体本体；网络重试仍属当前轮并沿用原输入。均由 Owner 明确答复 |

## Options Considered

| Option | Benefits | Costs / risks | Disposition |
| --- | --- | --- | --- |
| 保留即时撤销，只给全量检查加缓存与切片 | 小幅改变调用结构 | 继续承担 Owner 已否定的持续复核职责，容易由其它入口再次放大 | 不采用作为本次主方案 |
| 当前生成固定输入快照；配置变化在后续 loop 一次处理 | 正常路径轻量，变化时仍更新取材 | 需同时处理旧材料和依赖它的摘要，不能仅给模型一句提示 | Owner 选择 |
| 整个多轮 run 永久冻结配置 | 最简单 | 下一轮仍使用新排除材料，违反 Owner 补充选择 | 不采用 |
| Debug 沿用 reasoning/工具详情仅会话保存 | 不扩展历史内容 | 重启后仍缺少实际过程 | Owner 明确改为完整文本历史 |

## Decision

1. 一次已经开始的模型生成使用其已接受的输入快照，网络自动重试和 stream fallback 仍属当前轮并沿用原输入。后续配置排除、原文件编辑、删除不追溯使这次生成或交付失效，不因此重准备、额外重试或丢弃已收到内容。
2. 下一轮 loop 不再使用新排除的旧材料。Host 提供配置变化事实并从实际输入中收起受影响材料及其派生上下文；Agent 决定如何更新取材、补查和回答。不能只提示模型却继续外发被排除内容，也不强制每次变化额外调用一个模型。
3. 新取材继续按生效配置过滤目标来源。普通文件编辑、删除只影响后续真实读取与相关动作，不触发已读快照的持续撤销。要求最新内容时由 Agent 主动重读。
4. 保留必要来源事实以解释结果和关联低频配置变化；不再把全部扫描来源作为每个包装阶段、每个回复片段都要遍历的授权清单。
5. 同一轮材料准备、最终请求组装分别由单一入口负责；无输入变化不重复准备。发送与流式接收保留取消、运行身份、协议及真实请求记账等职责，不重新证明原文件仍有效。
6. Debug 开启时，本地历史保存实际完整输入、输出、provider 实际返回的 reasoning、工具参数与结果；后来的来源配置或文件状态变化不拦截采集、不清除这些历史事实。没有返回的 reasoning 如实标为未提供，不生成补充内容。
7. 历史期限沿用现有规则。完整文本与附件提取内容持久化；图片、附件只保留引用、类型与指纹，不另存本体。明确删除 Debug/对话、Forget 的对应清理语义独立保留；普通排除、编辑、删除笔记不能冒充这些清理操作。既有凭据不采集边界保持。
8. Obsidian 原生 tab、编辑、命令、保存和 Stop 保持可操作。删除不必要检查之后，剩余组装、Debug 序列化和持久化仍须分段执行，不新增通用权限框架或独立日志平台。

## Supersession And Scope

本决定局部接续 [DEC-043](./dec-043-agent-runtime-evolution-and-source-scope.md) 和 [DEC-047](./dec-047-agent-responsive-execution.md) 中“运行中来源变化即时撤销当前生成”的要求，以及 [DEC-041](./dec-041-agent-debug-view-and-local-history.md) 中 reasoning/完整工具详情仅会话保存、普通来源变化触发历史过滤的要求。原决定其它范围继续有效，历史验收不改写。

这是 Owner 已确认的行为，当前机制见 [Agent architecture](../../architecture/pa-agent-architecture-plan.md#source-and-trust-boundaries) 与 [Debug architecture](../../architecture/pa-agent-debug-view.md)，独有诊断和最终验证见 [B-165 evidence](../../archive/2026/b165-agent-snapshot-execution-validation.md)。普通 Chat 与同一 PA Agent 生成路径适用快照规则；Operations 写入冲突、Ghost 发布确认、已接受图片任务及显式删除的独立生命周期不因本方案自动放宽。

## Consequences

- Product behavior：停止以低频配置变化为理由反复重做正常生成；变化在后续 loop 处理。
- Data：扩大本机 Debug 文本历史内容，来源后来变化不追溯过滤；不新增网络发送、同步或后台记录器。
- Compatibility：旧 Chat/Debug 历史可读；旧历史没有保存的字段不能补造。存储与恢复机制见当前 Debug architecture。
- Rollback：实现回退保留新历史数据，读取未知类型时降级展示，不删除数据库；回到旧二进制会重新出现旧动态检查语义，必须明示，不作为新规则已满足。
- Work：B-165 的实际开发与验收结论已吸收入当前契约；不重开 B-155 历史任务。

## Revisit Trigger

新增全量数据副本、同步、存储后端、独立动作权限或执行期间紧急撤销产品能力时，另行讨论；不由性能修复暗中引入。

## Traceability

- [Product Spec](../specs/pa-agent-snapshot-execution-product-spec.md)
- [Agent architecture](../../architecture/pa-agent-architecture-plan.md#source-and-trust-boundaries)
- [Debug architecture](../../architecture/pa-agent-debug-view.md)
- [B-165 最终验证](../../archive/2026/b165-agent-snapshot-execution-validation.md)
- Source：Owner discussion and explicit choices, 2026-10-08。
