# Architecture 文档

这里保存与当前代码仍一致、需要在行为变化时同步更新的技术契约。历史迁移方案、完成的 SDD 与 review 证据在 [archive](../archive/README.md)。

## 总览与 PA Agent

- [项目架构全景](./architecture-overview.md)
- [PA Agent Architecture](./pa-agent-architecture-plan.md)
- [PA Agent Runtime Lifecycle](./pa-agent-runtime-lifecycle-plan.md)
- [Obsidian read tools / Operations boundary](./obsidian-operations-agent-plan.md)

## Memory / VSS

- [SQLite/WASM architecture](./vss-sqlite-wasm-architecture.md)
- [Embedding refresh](./vss-embedding-refresh.md)
- [Local state](./vss-local-state-plan.md)

## Write、Statistics 与 Settings

- [Write Action Framework](./write-action-framework-sdd.md)
- [Statistics v3](./statistics-v3-plan.md)
- [Settings current status](./settings-status.md)

## 更新规则

- 当前代码是事实基线；文档描述目标但尚未实现时，必须明确标成 proposal 或 future。
- Memory/VSS 行为变化同步更新对应三份契约；不要在 Tracker 中复制长期架构说明。
- Runtime/UI 变化完成 closeout 后，把最终契约更新在这里，并将实现过程归档。
