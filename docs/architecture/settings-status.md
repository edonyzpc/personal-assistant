# Settings Current Status

Updated: 2026-09-08

## Status

| Field | Value |
| --- | --- |
| Document type | Current status / navigation entry |
| Scope | Settings UI, settings persistence, SecretStorage migration follow-ups |
| Current source of truth | Current code plus the status table in [Settings UI Review](../archive/settings-ui-review.md) |
| Historical design target | [Settings SDD](../archive/settings-ui-sdd.md) |

This document is the current entry point for Settings work. The original
[Settings UI Review](../archive/settings-ui-review.md) is retained as evidence and
contains detailed finding-level status, but its original P0/P1 sections are
historical.

## Current Summary

Settings 简化的产品目标和旧选项失效规则见
[DEC-033](../product/decisions/dec-033-simple-settings-and-unified-defaults.md) 与
[B-106 Product Spec](../product/specs/pa-simple-settings-product-spec.md)。这是已确定的
产品契约，运行时仍以当前源码为准；实施入口为
[B-106 Feature Home](../development/active/simple-settings/README.md)，执行状态只看
[Tracker](../development/active/simple-settings/tracker.md)。

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

Remaining Settings work is product/architecture polish, not an active release
blocker:

| Area | Status | Next action |
| --- | --- | --- |
| Broader Settings IA | Partially open | Group the long settings surface into clearer current product areas. |
| Componentization | Partially open | Continue replacing full `display()` rebuild paths with scoped rebuilds. |
| Statistics hidden fields | Open | Decide whether `displaySectionCounts` and `countComments` need UI controls or should remain internal. |
| Text input save churn | Partially open | Finish end-to-end audit for debounced or explicit saves. |
| Narrow-screen Metadata UX | Open | Validate layout on narrow desktop/mobile-style widths before claiming complete. |

## Navigation Rule

Use this file for current planning. Use the historical review only when exact
finding details, original evidence, or previous risk rationale are needed.
