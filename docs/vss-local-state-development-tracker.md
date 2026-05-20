# VSS Local State Development Tracker

This tracker records implementation status for [VSS Local State Plan](./vss-local-state-plan.md). If runtime behavior changes, update the plan and tracker together.

## Status

| Phase | Goal | Status | Notes |
| --- | --- | --- | --- |
| SPEC-00 | Plan and tracker | Done | Source-of-truth docs added before runtime edits |
| SPEC-01 | Local state store | Done | IndexedDB, memory test store, unavailable production store |
| SPEC-02 | VSS integration | Done | Store injected, vault state writes removed, dirty state serialized |
| SPEC-03 | Remove JSON fallback | Done | Removed `MemoryVectorIndex`, manifest threshold logic, and old JSON vector write helpers |
| SPEC-04 | Tests and docs closeout | Done | Focused Jest, full Jest, lint, type check, and whitespace passed; Obsidian smoke still needs manual app run |

## Decisions

- VSS runtime state is local IndexedDB by default.
- Legacy vault state is read-only and never auto-deleted.
- Legacy JSON vector fallback is removed.
- `statisticsVaultId` is reused only as one part of the local database scope.
- OPFS scope stays unchanged in this migration and is recorded in local marker validation.

## Verification Log

| Date | Check | Result | Notes |
| --- | --- | --- | --- |
| 2026-05-20 | Focused VSS/store tests | Passed | `npm test -- __tests__/vss-local-state-store.test.ts __tests__/vss.test.ts __tests__/vss-state.test.ts --runInBand`: 60 tests passed |
| 2026-05-20 | Full Jest regression | Passed | `npm test -- --runInBand`: 28 suites, 494 tests passed |
| 2026-05-20 | Lint | Passed | `npm run lint` |
| 2026-05-20 | Type check | Passed | `npx tsc -noEmit -skipLibCheck` |
| 2026-05-20 | Whitespace check | Passed | `git diff --check` |
| 2026-05-20 | Obsidian smoke | Not run | Requires deploying/reloading the plugin in the test vault |

## Open Risks

| Risk | Mitigation |
| --- | --- |
| IndexedDB unavailable after user approves prepare | Initialize local state store before note reads or embedding calls |
| Late dirty writes after reset/dispose | Serialize dirty state writes and guard by lifecycle/epoch |
| Copied vault state collision | Scope DB by plugin id, vault id, config dir, and local path |
| Marker missing while OPFS index exists | Cheap SQLite verify reconstructs local marker |
