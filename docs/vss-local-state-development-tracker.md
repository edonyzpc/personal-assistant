# VSS Local State Development Tracker

This tracker records implementation status for [VSS Local State Plan](./vss-local-state-plan.md). If runtime behavior changes, update the plan and tracker together.

## Status

| Phase | Goal | Status | Notes |
| --- | --- | --- | --- |
| SPEC-00 | Plan and tracker | Done | Source-of-truth docs added before runtime edits |
| SPEC-01 | Local state store | Done | IndexedDB, memory test store, unavailable production store |
| SPEC-02 | VSS integration | Done | Store injected, vault state writes removed, dirty state serialized |
| SPEC-03 | Remove JSON fallback | Done | Removed `MemoryVectorIndex`, manifest threshold logic, and old JSON vector write helpers |
| SPEC-04 | Tests and docs closeout | Done | Focused Jest, full Jest, lint, build, whitespace, and real Obsidian update/reset/prepare smoke passed |

## Decisions

- VSS runtime state is local IndexedDB by default.
- OPFS stores Memory embedding/index data; IndexedDB stores VSS maintenance state and Statistics v3 local history in separate databases.
- A transient IndexedDB open failure does not block VSS. Marker/dirty state may remain in process memory until a later update/status path retries IndexedDB and persists it.
- Legacy vault state is read-only and never auto-deleted.
- Legacy JSON vector fallback is removed.
- `statisticsVaultId` is reused only as one part of the local database scope.
- OPFS scope stays unchanged in this migration and is recorded in local marker validation.

## Verification Log

| Date | Check | Result | Notes |
| --- | --- | --- | --- |
| 2026-05-20 | Focused VSS/store tests | Passed | `npm test -- --runInBand __tests__/vss.test.ts __tests__/vss-local-state-store.test.ts __tests__/vss-state.test.ts`: 3 suites, 66 tests passed |
| 2026-05-20 | Full Jest regression | Passed | `npm test`: 28 suites, 500 tests passed |
| 2026-05-20 | Lint | Passed | `npm run lint` |
| 2026-05-20 | Build | Passed | `npm run build` (`tsc -noEmit -skipLibCheck`, Tailwind, production bundle) |
| 2026-05-20 | Whitespace check | Passed | `git diff --check` |
| 2026-05-20 | Obsidian smoke | Passed | `make deploy`, reloaded the `test` vault in Obsidian, then ran real `Update memory`, `Reset local memory copy`, and `Prepare memory` after explicit approval. Final Memory diagnostics reported `Ready`, `21 chunks across 20 files`, `sqlite-wasm-opfs-sahpool`, persistent storage, and `Maintenance Up to date`. Legacy `vss-cache` and `vss-index-state` JSON hashes/mtimes were unchanged and no tracked vault state files changed. |

## Open Risks

| Risk | Mitigation |
| --- | --- |
| IndexedDB unavailable after user approves prepare | Continue with in-memory marker/dirty state, retry IndexedDB on update/status paths, and persist when available |
| Late dirty/marker writes after reset/dispose | Serialize state writes and guard by lifecycle/generation |
| Copied vault state collision | Scope DB by plugin id, vault id, config dir, and local path |
| Marker missing while OPFS index exists | Cheap SQLite verify reconstructs local marker |
