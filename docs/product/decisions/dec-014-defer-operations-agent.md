# DEC-014 — Defer Operations Agent Productization

Decision ID: DEC-014
Status: Deferred
Updated: 2026-07-12
Authority: Operations Agent 用户开放与 productization gate。
Work item: B-101

## Context

Append/write substrate 已存在，但 shipped product 仍关闭 `OPERATIONS_AGENT_RUNTIME_ENABLED`。把实现存在等同于可开放，会跳过 prompt、Settings、安全、确认与真实 app smoke 边界。

## Decision

延期 Operations Agent productization，runtime flag 保持关闭。只有 B-101 的 action runtime、prompt split、Settings 语义、安全 review 与真实 Obsidian smoke 都完成并获得明确批准后，才可创建 Active Package 推进开放。

## Consequences

- 当前只把相关文件当作 long-lived proposal/architecture evidence。
- 不新增 shell、任意 filesystem write、plugin action 或 command execution。
- 任何 restart 都从 B-101、Proposal 与新的 Product Decision 开始。

## Revisit Trigger

[Backlog B-101](../../backlog.md) 的明确启动条件全部满足并获得用户批准。

## Traceability

- [Proposal Registry](../../development/proposals/README.md)
- [Write Action Framework](../../architecture/write-action-framework-sdd.md)
- [Active Decision Register](../active-decisions.md)
