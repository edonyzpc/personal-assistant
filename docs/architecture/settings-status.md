# Settings Current Status

Updated: 2026-06-28

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

Highest-risk Settings issues are no longer open:

- API token migration clears legacy persisted token fields after SecretStorage
  handling.
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
