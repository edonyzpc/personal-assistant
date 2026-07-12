# Development Roadmap

> Last updated: 2026-07-11. The previous v2.7 release-prep roadmap is archived
> at [development-roadmap-v2.7.md](./archive/development-roadmap-v2.7.md).

## Current Baseline

| Field | Value |
| --- | --- |
| Current version in this worktree | `2.8.4` |
| Release tag | `2.8.4` |
| Current release theme | Post-2.8 patch line plus completed Memory Control Center validation and PA Agent/Pagelet release-readiness |
| Runtime shape | PA Agent + Memory + Pagelet + Statistics + Obsidian read tools |
| Hidden / disabled major runtime | Operations Agent append mode remains disabled by `OPERATIONS_AGENT_RUNTIME_ENABLED=false` |

## Completed Release Lines

| Line | Status | Current authority |
| --- | --- | --- |
| v2.2-v2.7 implementation train | Complete, historical | [v2 post-release tracker](./archive/v2-post-release-spec-driven-development.md) |
| v2.7 consolidated feature release | Complete, historical | [archived roadmap](./archive/development-roadmap-v2.7.md) and release tags |
| v2.8.0 license migration | Complete, historical one-time migration | [license migration sign-off](./archive/license-migration-2.8.0.md) |
| v2.8.1-v2.8.4 patch line | Current shipped baseline | [changelog](../CHANGELOG.md) and release metadata |

## Current Product Baseline

| Theme | Current meaning | Current authority |
| --- | --- | --- |
| Memory Control Center | Validated device-local Memory governance; broader sync/action authority is not implied | [Product Spec](./product/specs/pa-memory-control-center-product-spec.md) |
| PA Agent | Capture/review/memory/maintenance/recall runtime with source-backed evidence and current safety boundaries | [Product index](./product/README.md), [Architecture](./architecture/pa-agent-architecture-plan.md) |
| Pagelet Delivery | Bubble、Scope Recap、Recall、Pattern 与 Review 的安静、可忽略 delivery model | [Pagelet Product Design](./product/pagelet-product-design.md) |

## Candidate Directions

Roadmap 只表达方向，不复制执行状态。每项当前状态、下一步与启动条件以 Backlog 或 Active Tracker 为准。

| Direction | Work item | Why it may matter | Scope guard |
| --- | --- | --- | --- |
| Operations Agent productization | B-101 | 把既有 write-action substrate 变成可确认的有限笔记编辑模式 | runtime flag 保持关闭；不加入 shell、任意文件写入、plugin action 或 command execution |
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
