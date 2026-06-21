# Development Roadmap

> Last updated: 2026-06-21. The previous v2.7 release-prep roadmap is archived
> at [development-roadmap-v2.7.md](./archive/development-roadmap-v2.7.md).

## Current Baseline

| Field | Value |
| --- | --- |
| Current version in this worktree | `2.8.0` |
| Release tag | `2.8.0` |
| Current release theme | License and compliance migration |
| Runtime shape | PA Agent + Memory + Pagelet + Statistics + Obsidian read tools |
| Hidden / disabled major runtime | Operations Agent append mode remains disabled by `OPERATIONS_AGENT_RUNTIME_ENABLED=false` |

## Completed Release Lines

| Line | Status | Current authority |
| --- | --- | --- |
| v2.2-v2.7 implementation train | Complete, historical | [v2 post-release tracker](./archive/v2-post-release-spec-driven-development.md) |
| v2.7 consolidated feature release | Complete, historical | [archived roadmap](./archive/development-roadmap-v2.7.md) and release tags |
| v2.8.0 license migration | Complete in current tree | [license migration sign-off](./license-migration-2.8.0.md) |

## Next Candidate Themes

| Theme | Why it matters | Scope guard |
| --- | --- | --- |
| Operations Agent productization | Turns the existing write-action infrastructure into a usable, confirmed note-editing mode. | Start with append-to-current-note only; do not add shell, arbitrary filesystem writes, plugin actions, or command execution without separate review. |
| User custom Skills | Lets advanced users extend PA Agent behavior without waiting for bundled skills. | Requires product design first; keep scripts/tools out until allowed-tools policy is explicit. |
| Pagelet async result UX | Prevents paid provider results from being discarded when the user changes notes mid-run. | First pass is in-memory source-bound results only; no hidden persistence of full provider output. |
| Architecture quality pass | Keeps the mature codebase maintainable after large v2.x feature work. | Behavior-preserving extraction first; run focused tests plus Obsidian smoke for runtime/UI surfaces. |
| Android VSS validation | Closes the remaining mobile validation note in README. | Real-device validation only; do not infer Android parity from desktop/iOS smoke. |

## Deferred / Triggered Work

| Work | Start condition |
| --- | --- |
| Obsidian Operations CLI read adapter | Desktop CLI reads become important enough to justify a full SPEC-05 pass. |
| PA Agent latency levers | There is a focused latency investigation with comparable p50/p95 evidence. |
| React to Preact evaluation | React-only features or incompatible libraries are introduced. |
| SQLite/WASM inline strategy review | Mobile cold-start or OOM triggers fire. |
| Paid hosted/commercial services | Separate Terms, privacy, billing, entitlement, and counsel review are complete. |

## Links

- Current short-form status: [Project TODO](./todo.md)
- Release process: [release-process.md](./release-process.md)
- Architecture overview: [architecture-overview.md](./architecture-overview.md)
- Archive index: [archive/README.md](./archive/README.md)
