# Development Roadmap

> Last updated: 2026-10-06. The previous v2.7 release-prep roadmap is archived
> at [development-roadmap-v2.7.md](./archive/development-roadmap-v2.7.md).

## Current Baseline

| Field | Value |
| --- | --- |
| Current version in this worktree | `2.9.2`, from [package.json](../package.json) and [manifest.json](../manifest.json) |
| Latest stable version recorded in Changelog | `2.9.2` (2026-08-09), from [Changelog](../CHANGELOG.md); this is not a live remote-release check |
| Worktree / release boundary | Current contracts also describe later accepted local development; the version field alone does not prove those changes were published |
| Runtime shape | PA Agent + Memory + Pagelet + Statistics + Obsidian read tools + approved bounded Operations with delivered Pagelet integration |
| Operations Agent availability | Build availability and the live controller/policy remain factual gates. The persisted legacy `operationsAgentEnabled` field no longer gates admission; a current explicit modification request can execute through the same main Agent under [DEC-051](./product/decisions/dec-051-proportionate-confirmation-and-contract-alignment.md) and the [current architecture](./architecture/pa-agent-architecture-plan.md#operations-agent-providers) |

## Completed Release Lines

| Line | Status | Current authority |
| --- | --- | --- |
| v2.2-v2.7 implementation train | Complete, historical | [v2 post-release tracker](./archive/v2-post-release-spec-driven-development.md) |
| v2.7 consolidated feature release | Complete, historical | [archived roadmap](./archive/development-roadmap-v2.7.md) and release tags |
| v2.8.0 license migration | Complete, historical one-time migration | [license migration sign-off](./archive/license-migration-2.8.0.md) |
| v2.8.1-v2.8.4 patch line | Historical recorded releases | [changelog](../CHANGELOG.md) and release metadata |
| v2.9.0-v2.9.2 release line | Latest stable releases recorded in Changelog | [changelog](../CHANGELOG.md); later worktree acceptance is separate from publication |

## Current Product Baseline

| Theme | Current meaning | Current authority |
| --- | --- | --- |
| Memory Control Center | Validated device-local Memory governance; broader sync/action authority is not implied | [Product Spec](./product/specs/pa-memory-control-center-product-spec.md) |
| PA Agent | The same main Chat Agent handles Memory, source-backed answers and approved domain commands; current Operations execution, results and Undo follow the accepted command boundary | [Product index](./product/README.md), [Architecture](./architecture/pa-agent-architecture-plan.md) |
| Pagelet Delivery | Active-note Deep Discover is the current review/recall/recap alias route; Pet, Panel/Tab, source visibility and saved insights retain their scoped contracts. Earlier Bubble/Scope Recap scenarios are historical for those aliases | [Pagelet Product Design](./product/pagelet-product-design.md), [DEC-035](./product/decisions/dec-035-bounded-cleanup-and-pagelet-scope-retirement.md) |

## Candidate Directions

Roadmap 只表达方向，不复制执行状态。每项当前状态、下一步与启动条件以 Backlog 或 Active Tracker 为准。

| Direction | Work item | Why it may matter | Scope guard |
| --- | --- | --- | --- |
| Pagelet async result UX | B-002 | 避免用户切换笔记时丢失已付费 provider result | 先复核现有实现；不隐藏持久化完整 provider output |
| Architecture quality pass | B-105 | 降低成熟 v2.x codebase 的维护成本 | 行为保持、按独立 slice 验证；runtime/UI 需要 app smoke |
| Android VSS validation | B-003 | 关闭 README 中剩余 mobile parity 证据缺口 | 只接受物理 Android 证据，不从 desktop/iOS 推断 |
| User custom Skills | B-103 | 让高级用户扩展 PA Agent 行为 | 先批准产品价值、权限和 Settings UX；不提前开放 scripts/tools |

## Deferred / Triggered Work

Deferred and trigger-gated work is maintained only in [Project Backlog](./backlog.md#已延期的产品与工程工作) so roadmap and execution status cannot drift into separate ledgers.

## Links

- Unresolved work: [Project Backlog](./backlog.md)
- Product contracts: [Product index](./product/README.md)
- Architecture contracts: [Architecture index](./architecture/README.md)
- Development workflow: [Development index](./development/README.md)
- Release process: [Release process](./operations/release-process.md)
- Historical evidence: [Archive index](./archive/README.md)
