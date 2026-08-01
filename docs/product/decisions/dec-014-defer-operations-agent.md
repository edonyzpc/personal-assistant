# DEC-014 — Bound Operations Agent Step 2 To Explicit Vault Opt-In

Decision ID: DEC-014
Status: Accepted
Updated: 2026-08-01
Authority: Owner 于 2026-08-01 授权 B-101 Step 2；本记录限定 Operations Agent 的用户开放与 write/action 边界。
Work item: B-101

## Context

DEC-014 原先在 action runtime、prompt、Settings 与确认边界不完整时延期 Operations Agent。B-101 Step 2 现已获得 owner 的有界实现授权：`OPERATIONS_AGENT_RUNTIME_ENABLED=true` 只表示当前 build 具备该能力，不是用户授权；持久化的 `operationsAgentEnabled` 仍默认为 `false`，必须在每个 vault 显式 opt in。

该授权不等于开放通用写入 Agent。第一个产品切片必须保持可预览、可拒绝、可恢复、对并发变更 fail closed，且不默认持久化笔记内容。

## Decision

接受 B-101 Step 2，且仅接受以下有界产品面：

1. build availability 为 `OPERATIONS_AGENT_RUNTIME_ENABLED=true`；实际开放仍要求持久化的 `operationsAgentEnabled=true`，其默认值为 `false`，且是 per-vault opt-in。
2. 仅提供 `vault_create`、`vault_append`、`vault_process` 与 `frontmatter_update` 四个 core tools；它们只在当前用户请求被识别为写入意图时按需暴露。
3. 同一 tool phase 的操作组成一个不可变 intent，先在 Chat 显示一张 inline preview card；只有用户显式确认后才按顺序写入，取消、超时或关闭不得写入。
4. 已有笔记的变更在 `vault.process()` 回调中重验 frozen baseline；创建在执行前重验冲突。Undo 只在当前内容仍等于此次写入结果时恢复，有 drift 则 fail closed。
5. audit 默认 content-free；不记录输入内容、before/after 文本、diff、prompt 或 model output。
6. Step 3 Pagelet integration 以及任何超出这四个 tools 的写入继续关闭，不因 Step 2 获得隐含授权。

## Consequences

- build gate 不改写用户设置；缺失或 `false` 仍关闭，已显式持久化的 `true` 保持有效。
- 不注册旧 `append_to_current_note`、`replace_selection`，也不新增 rename、move、delete、folder creation、shell、script、任意 filesystem write、plugin action 或 command execution。
- 实现、验证与发布状态仍由 B-101 的执行权威与真实证据管理；本决定不单独宣称 shipped。

## Revisit Trigger

真实 Obsidian dogfood 或安全证据要求缩窄 Step 2，或 owner 准备评估 Step 3 Pagelet integration / 额外写入能力时，重新评审本决定。

## Traceability

- [Backlog B-101](../../backlog.md)
- [Step 2 SDD](../../development/proposals/operations-agent/operations-agent-step2-sdd.md)
- [Operations capability direction](../../development/proposals/operations-agent/agent-operations-capability.md)
- [Write Action Framework](../../architecture/write-action-framework-sdd.md)
- [Active Decision Register](../active-decisions.md)
