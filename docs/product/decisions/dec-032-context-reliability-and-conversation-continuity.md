# DEC-032 — Context Reliability And Conversation Continuity

Decision ID: DEC-032
Status: Accepted
Updated: 2026-09-05
Authority: Owner 于 2026-09-05 接受先解决 Context 管理和长会话连续稳定的路线，随后明确纠正“排除 LLM 调用并不是决策，需要按照 context management 的需求进行技术判断和选型，成本问题后面再优化”。技术选型由本任务依据需求和源码完成；此前 Agent 写下的排除项不是 Owner 的禁止或新增审批门。本记录保留该纠正，不追溯制造旧批准。
Work item: B-128

## Context

当前 Context 层已独立于 Memory，但按 user 数量保护工具结果与实际单 user / 多 model-cycle transcript 不匹配；历史固定十轮压缩；总字符预算只观测、不准入；Context UI 没有真实压缩回执。短暂 runtime 不能证明用户没有长会话连续性需求。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 仅保持请求不超长 | 范围小 | 不能证明早期要求、后续修正及讨论结果仍可用 | 必要但不足以作为完整交付 |
| 修复可靠性并独立验收会话连续性 | 复用现有边界，以真实失败决定摘要需求 | 多模块测试与 app 验证 | Accepted |
| 一并新增 Memory、工具归档和重启续跑 | 覆盖更多任务生命周期 | 数据、权限、成本和状态所有权明显扩大 | 当前不纳入 |

## Decision

1. Context 管理本次模型输入；Conversation State 拥有原始会话记录与本轮 transcript；长期 Memory 保持现有检索、提取、准入、更新和遗忘契约。
2. 实施按 model cycle 压缩工具观察、fit-first/recent-first 历史选择、完整本地请求预算准入、真实简短回执及明确的本地超限说明。
3. 同时验收长会话中的原文保留、后续修正、近期决定、重复投影稳定性及来源/权限边界。字符预算通过不等于语义连续性通过。
4. 采用“结构化会话摘要 + 近期完整原文”，承接早期要求、修正、决定、已完成事项及待办；旧工具证据在被缩减前使用同一模型能力生成独立的语义摘要。复用配置的 Chat provider/model，成本不作为是否采用 LLM 的门槛。输入、输出、时限和缓存界限用于可靠性与取消控制。
5. 原始 Chat 和 canonical 工具记录仍为依据，摘要是精确源快照校验的派生投影，不进入长期 Memory 或赋予执行权限。初版由长寿命 ChatService 持有单会话缓存；切换/删除/修改/关闭时失效，重载从已保存原文重建。选择依据是源记录可重建且无需新增持久化事实来源，而非节约调用成本。
6. 原始工具归档、历史恢复工具、可恢复执行 checkpoint、window lineage/CAS、不可变历史授权锚点不是本需求的必要前提；不引入新管理界面。后续是否需要这些能力仍按需求判断，不把历史技术候选排除项当作永久产品决策。

## Technical Selection

| Option | Requirement fit | Selection |
| --- | --- | --- |
| 只裁剪 / 扩大窗口 | 已复现早期 SQLite 要求完全丢失；扩大窗口仍有有限边界 | 保留为机械兜底，不能单独承担语义连续性 |
| 替换为框架 summarization middleware / provider 专有 compaction | 需迁移既有自定义 Loop 或绑定特定 provider；当前并无该迁移需求 | 不替换现有执行层 |
| PA Context 内的 provider-neutral 结构化摘要 | 可复用当前模型、完整预算门、来源重验证、取消和 Context 回执；覆盖会话与工具语义 | 采用 |

该选型参考 [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
关于压缩承接长任务信息的实践，以及 [LangChain short-term context](https://docs.langchain.com/oss/javascript/langchain/short-term-memory)
对历史摘要与跨会话长期存储的区分。它们提供技术参考，不替代 PA 的产品边界。

## Consequences

- 已保存原始 Chat、本轮 canonical transcript、Memory 和来源记录保持原有所有权；压缩只修改投影。
- 既有 turn metadata 可增加三个无正文布尔值；旧行默认为未压缩，沿既有 conversation 删除。
- 本地字符门覆盖格式化请求及工具 schema 估算，不保证所有 provider token window 适配。
- 摘要失败/非法/超时回退确定性投影，用户取消直接停止；摘要不进入现有历史 metadata，仅已有三布尔回执持久化。
- 压缩和历史选择、最终准入、UI 回执分别可回滚；关闭语义路径可恢复确定性实现，原始对话不变。

## Revisit Trigger

模型评测或 dogfood 出现约束遗漏、修正失效、未知被填补或递归摘要漂移时，调整摘要策略并保留原文对照证据。重启工具任务续跑和跨对话知识学习有独立需求时分别定义契约。

## Traceability

- Discovery: [B-128 research](../../development/discovery/pa-agent-context-management-research.md)
- Product Spec: [Context reliability and continuity](../specs/pa-context-management-product-spec.md)
- Architecture / SDD: [SDD](../../development/active/context-management/sdd.md)
- Supersedes / superseded by: 取代 Discovery 的 research-only 下一步建议；不取代现有 Memory 产品决定。
