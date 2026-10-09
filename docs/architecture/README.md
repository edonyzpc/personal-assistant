# Architecture 文档

这里保存与当前代码仍一致、需要在行为变化时同步更新的技术契约。历史迁移方案、完成的 SDD 与 review 证据在 [archive](../archive/README.md)。

## 总览与 PA Agent

- [项目架构全景](./architecture-overview.md)
- [PA Agent Architecture](./pa-agent-architecture-plan.md)
- [PA Agent Runtime Lifecycle](./pa-agent-runtime-lifecycle-plan.md)
- [Agent 响应性完整设计](./pa-agent-responsive-execution.md) — B-155 已交付设计，按 Owner 要求完整保留。
- [PA Agent Debug View 与本机历史](./pa-agent-debug-view.md)
- [Multimodal Chat、文案版本与图文保存](./multimodal-chat-architecture.md)
- [Chat 图片生成、版本与任务恢复](./chat-image-generation-architecture.md)
- [Obsidian read tools / Operations boundary](./obsidian-operations-agent-plan.md)

## Harness 审查与实施

- [PA Agent Harness 深审与离线消融](./pa-agent-harness/pa-agent-harness-review-2026-10-04.md)
- [PA Agent Harness 完整优化方案](./pa-agent-harness/pa-agent-harness-optimization-plan-2026-10-04.md)
- [实施与消融结果](./pa-agent-harness/implementation-results-2026-10-04.md) — 默认策略、逐项结果、验证与保留限制。

## Memory / VSS

- [SQLite/WASM architecture](./vss-sqlite-wasm-architecture.md)
- [Embedding refresh](./vss-embedding-refresh.md)
- [Local state](./vss-local-state-plan.md)

## 保留的未实施设计输入

以下原稿按 Owner 的保留要求继续留在原路径。它们是 2026-08 的讨论与实施前设计，
不代表已批准范围、当前 Memory 实现或活跃任务；当前实现事实以代码为准，
以上技术契约用于记录和对照，不以文档状态推定已经实施。

- [Episodic Memory 设计讨论原稿](./pa-episodic-memory-design-discussion.md)
- [Episodic Memory 与 Attunement 实施前设计](./pa-episodic-memory-design.md)

## Write、Statistics 与 Settings

- [Write Action Framework](./write-action-framework-sdd.md)
- [Statistics v3](./statistics-v3-plan.md)
- [Settings current status](./settings-status.md)
- [Tag Appearance](./tag-appearance.md) — 默认关闭的标签外观、固定配色与跨视图清理。

## Share Card

- [Share Card architecture](./share-card-architecture.md)

## 更新规则

- 当前代码是事实基线；文档描述目标但尚未实现时，必须明确标成 proposal 或 future。
- Memory/VSS 行为变化同步更新对应三份契约；不要在 Tracker 中复制长期架构说明。
- Runtime/UI 变化完成 closeout 后，把最终契约更新在这里；已吸收的过程文档默认删除，只有当前源码或文档仍引用的独有证据才归档。
