# Settings Current Status

Updated: 2026-09-09

## Status

| Field | Value |
| --- | --- |
| Document type | Current status / navigation entry |
| Scope | Settings UI, settings persistence, SecretStorage migration follow-ups |
| Current source of truth | Current code and linked product contracts; B-106 delivery evidence is owned only by its Tracker |
| Historical design target | [Settings SDD](../archive/settings-ui-sdd.md) |

This document is the current entry point for Settings work. The original
[Settings UI Review](../archive/settings-ui-review.md) is retained as evidence and
contains historical finding evidence. It does not own current implementation
or delivery status.

## Current Summary

Settings 简化的产品目标和旧选项失效规则见
[DEC-033](../product/decisions/dec-033-simple-settings-and-unified-defaults.md) 与
[B-106 Product Spec](../product/specs/pa-simple-settings-product-spec.md)。这是已确定的
产品契约，运行时仍以当前源码为准；实施入口为
[B-106 Feature Home](../development/active/simple-settings/README.md)，执行状态只看
[Tracker](../development/active/simple-settings/tracker.md)。

2026-09-09产品修订将长期记忆提取与本地习惯学习改为分别默认开启。当前源码仍为
旧默认关闭及consent准入；新默认、真实退出和旧值迁移全部由
[B-135 Tracker](../development/active/unified-task-execution/tracker.md)承接，产品修订见
[DEC-034](../product/decisions/dec-034-unified-agent-task-execution.md)。旧B-106不新增后续任务。本页下述既有实现说明及2026-09-08验证不证明该新规则已实现，不能只凭
Product Spec获批宣称当前设置已默认开启。

Highest-risk Settings issues are no longer open:

- API token migration clears legacy persisted token fields after SecretStorage
  handling.
- API token editing uses a PA-owned modal over the existing vault-scoped
  SecretStorage ID. It does not patch Obsidian's private Keychain picker DOM or
  programmatically focus the password field when the modal opens.
- Numeric settings use safe parsing and bounds.
- Metadata add form initializes, validates, and resets values.
- Runtime-only settings state is not persisted.
- Provider preset changes and token clearing require explicit confirmation.
- Memory settings copy and visibility have been aligned with current product
  language.

The current Settings implementation uses four groups: AI connection,
Preferences, Notes & privacy, and Advanced & maintenance. Native details keep
specialized choices behind their related product area. Old Memory and
Appearance deep links resolve to the corresponding detail; exact recovery
targets open the maintenance group.

Pagelet preferences and Memory management refresh their own regions. Provider
tuple drafts remain separate from the effective connection, and passive
Settings navigation reads only the token cache state. Permission changes use
queued snapshots and become effective after persistence; source-exclusion text
has an explicit Save scope action and retains an unsaved draft on failure.

Graph and featured-image options use the same modal from Settings and their
contextual entry. Statistics view selection remains in its existing tabs;
`displaySectionCounts` and `countComments` already have Settings controls.
Ordinary field saves and statistics choices expose failure/retry feedback.

The [B-106 Tracker](../development/active/simple-settings/tracker.md) owns all
remaining review, Desktop, real-device, and acceptance evidence. Source-level
implementation here does not imply those gates passed.

## Navigation Rule

Use this file for current planning. Use the historical review only when exact
finding details, original evidence, or previous risk rationale are needed.
