# Statistics v3 Development Tracker

## Purpose

This tracker records the SPEC-driven development plan, phase status, review evidence, verification results, and risk handling for [Statistics v3 Plan](../architecture/statistics-v3-plan.md).

This document is not the architecture source of truth. Product goals, storage model, migration rules, sync semantics, and UI copy boundaries come from `docs/architecture/statistics-v3-plan.md`. If the plan and tracker drift, update both in the same reviewed change before implementation continues.

## Status Legend

| Marker | Meaning |
| --- | --- |
| `[ ]` | Todo |
| `[~]` | In progress |
| `[x]` | Done |
| `[!]` | Blocked |

## Required Delivery Loop

Every runtime phase must follow:

```mermaid
flowchart LR
  Dev["dev"] --> Test["test"]
  Test --> Review["subagent review"]
  Review --> Fix["fix findings"]
  Fix --> Deploy["make deploy"]
  Deploy --> Smoke["Obsidian smoke"]
  Smoke --> Evidence["tracker evidence"]
```

Docs-only phases may skip deploy/smoke, but the tracker must state why.

Review gate:

- Use subagents for product, architecture, and senior-engineering review.
- Treat P0/P1/P2 findings as blockers unless explicitly deferred in the Risk Register.
- Update Review Log and Verification Log when each phase status changes.

Smoke gate:

- Runtime/UI phases require `make deploy` and real Obsidian test-vault smoke.
- Do not claim Obsidian validation without deployed app evidence.

## Current Status

| Item | Status |
| --- | --- |
| Created | 2026-05-19 |
| Source of truth | `docs/architecture/statistics-v3-plan.md` |
| Current phase | Phase 4: UI, Diagnostics, And Closeout |
| Current status | [x] Final review fixes complete; v2 cleanup deferred to read-only import, dashboard reads import synced JSONL, runtime edge cases hardened, and Obsidian smoke passed on 2026-05-20 |
| Runtime implementation | [x] SPEC-04 UI/copy hardening implemented, reviewed, deployed, and smoke-tested in the Obsidian test vault |
| Default product decision | Local-only IndexedDB; no new or updated vault Statistics data files |
| Cross-device sync decision | Optional per-device JSONL after setting is enabled; files live under `<vault.configDir>/plugins/personal-assistant/stats/devices/` |
| v2 cleanup decision | No automatic cleanup in v3 MVP; legacy history is read-only imported and left in place |

## SPEC Index

| SPEC | Goal | Status | Owner Areas | Exit Gate |
| --- | --- | --- | --- | --- |
| SPEC-00 | Plan and tracker source of truth | [x] Done | `docs/architecture/statistics-v3-plan.md`, this tracker | Docs checks pass and review records no P0/P1/P2 blockers |
| SPEC-01 | Store facade extraction | [x] Done | `src/stats/*`, focused tests | Existing v2 behavior preserved behind `StatsRepository` facade |
| SPEC-02A | Local v3 IndexedDB store | [x] Done; smoke backfilled | stats local store, repository, settings migration, tests | Default mode no longer creates v3 JSONL and Obsidian dashboard reloads local edits |
| SPEC-02B | v2 read-only import | [x] Done; smoke backfilled | stats migration, repository, tests | Existing v2 fixture history imports into the Obsidian dashboard with low-noise issue reporting |
| SPEC-02C | v2 cleanup deferral | [x] Done; smoke passed | stats migration metadata, tests, docs | v2 files are never automatically deleted; read-only import records low-noise migration issues |
| SPEC-03 | Optional JSONL sync | [x] Done; smoke passed | sync store, settings UI, Statistics UI, tests | Sync disabled creates no JSONL; sync enabled uses per-device JSONL and dashboard reads import newly synced device files before rendering |
| SPEC-04 | UI, diagnostics, and smoke closeout | [x] Done; smoke backfilled | settings, Statistics component, docs | Product copy hides internals; Obsidian smoke evidence recorded |

## Phase Ledger

| Phase | Scope | Status | Suggested Commit Scope |
| --- | --- | --- | --- |
| Phase 0 | Docs/spec gate | [x] Done | `docs(statistics): add v3 plan and tracker` |
| Phase 1 | Repository facade without behavior change | [x] Done | `refactor(statistics): introduce store repository facade` |
| Phase 2A | Local IndexedDB default | [x] Done; smoke backfilled | `feat(statistics): store history locally by default` |
| Phase 2B | v2 read-only import | [x] Done; smoke backfilled | `feat(statistics): import legacy history locally` |
| Phase 2C | v2 cleanup deferral | [x] Done; smoke passed | `fix(statistics): defer legacy cleanup` |
| Phase 3 | Optional cross-device JSONL sync | [x] Done; smoke backfilled | `feat(statistics): add optional history sync` |
| Phase 4 | UI polish, smoke, and tracker closeout | [x] Done; smoke backfilled | `docs(statistics): close v3 tracker` |

## MVP Exclusions

These are intentionally outside the first local-storage milestone and must not block SPEC-02A:

- Cross-device JSONL sync.
- Manual sync command or button.
- JSONL compaction.
- Vault backup/export flows.
- Multi-device `Devices` metric in the default local-only UI.

## Phase Task Plan

### Phase 0: Spec Gate

Goal: Lock the product and architecture plan before runtime code changes.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Create Statistics v3 plan | docs | [x] Done | Plan records local default, optional JSONL sync, read-only v2 import, cleanup deferral, review findings, and phased roadmap |
| dev | Create tracker | docs | [x] Done | Tracker contains SPEC index, phase ledger, MVP exclusions, risk register, review log, and verification log |
| test | Docs whitespace checks | docs | [x] Done | `git diff --check`, new-file `--no-index --check`, and trailing whitespace scan passed |
| review | Subagent docs review | docs | [x] Done | Product/architecture and implementation/overdesign re-review found no P0/P1/P2 blockers |
| gate | Approve runtime start | docs | [x] Done | SPEC-00 moved to `[x]`; SPEC-01 may start |

Expected commands:

- `git diff --check -- docs/architecture/statistics-v3-plan.md docs/archive/statistics-v3-development-tracker.md`
- `rg -n "[[:blank:]]+$" docs/architecture/statistics-v3-plan.md docs/archive/statistics-v3-development-tracker.md`

### Phase 1: Store Facade Without Behavior Change

Goal: Prepare the code for v3 storage without changing current v2 behavior.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Extract only necessary stats helper seams | `src/stats/*` | [x] Done | No broad helper extraction was needed; SPEC-01 uses a thin wrapper around existing `StatsStore` |
| dev | Add `StatsRepository` facade | `src/stats/*` | [x] Done | `src/stats/stats-repository.ts` covers `initialize`, `getDeviceId`, `invalidateDashboardCache`, dashboard/snapshot/shard reads, shard writes, and path matching |
| dev | Keep v2 store behavior unchanged | `src/stats/*` | [x] Done | `StatsManager` was moved behind `StatsRepository` before the v3 local repository became the default |
| test | Focused v2 regression tests | `__tests__/stats-store.test.ts`, `__tests__/stats-manager.test.ts` | [x] Done | Existing focused stats tests passed without loosening assertions |
| review | Subagent review | runtime/tests | [x] Done | Two subagent reviews found no P0/P1 blockers; P2 tracker/doc status drift was fixed |
| smoke | Obsidian smoke | `test/` vault | [x] Skipped | SPEC-01 is a thin facade with no intended runtime behavior or UI change; focused tests, typecheck, lint, and subagent review cover the change |

Expected commands:

- `npm test -- __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `git diff --check`
- `make deploy`

### Phase 2A: Local v3 IndexedDB Store

Goal: Make local IndexedDB the default Statistics store and stop all new v2 shard writes.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add `StatsLocalStore` interface and memory implementation | `src/stats/*` | [x] Done | Business tests run through injected `MemoryStatsLocalStore` without browser IndexedDB |
| dev | Add native IndexedDB implementation | `src/stats/*` | [x] Done | Open, upgrade/create-store, upsert, read, unavailable storage, and open-error paths are covered through injected IndexedDB fakes |
| dev | Add stable `vaultId` setting migration | settings/plugin load | [x] Done | Existing users get one generated vault id; plugin startup awaits settings persistence before constructing `StatsManager` |
| dev | Preserve dashboard DTO shape | stats repository | [x] Done | Dashboard DTO remains current `StatsDashboardData`; v3 is internal storage schema only |
| dev | Stop new v2 writes | stats repository | [x] Done | Default initialization, edit, and flush no longer call vault `mkdir/write/append/process` for Statistics data |
| dev | Hide normal legacy stats path setting | settings UI | [x] Done | Users no longer see v2 storage path in normal settings |
| test | Verify local-only default | tests | [x] Done | Init, edit, flush, and dashboard reads do not create v2 shards or v3 JSONL in focused tests |
| review | Subagent review | runtime/tests/settings | [x] Done | Initial P1 blockers were fixed; re-review found one P2 IndexedDB error-path test gap, which is now covered |
| smoke | Obsidian smoke | `test/` vault | [x] Backfilled | Default-mode Statistics opened in Obsidian, generated `statisticsVaultId`, and created no `.jsonl` while sync was off |

Expected commands:

- `npm test -- __tests__/stats-repository.test.ts __tests__/stats-local-store.test.ts __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

### Phase 2B: v2 Read-Only Import

Goal: Import old Statistics history into local records without deleting old files.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Import configured legacy stats path | stats migration | [x] Done | `settings.statsPath`, current config-dir `stats.json`, and legacy `.obsidian/stats.json` are read and deduplicated |
| dev | Import current and legacy v2 roots | stats migration | [x] Done | Current config-dir v2 root and legacy `.obsidian` v2 root are read-only sources |
| dev | Add migration metadata | local store | [x] Done | Metadata records import fingerprint, valid/corrupt shard counts, imported record count, aggregate hash, compatibility cleanup status, timestamp, and last import error |
| dev | Keep old files during import phase | stats migration | [x] Done | SPEC-02B importer uses only `exists/read/list`; tests assert no `mkdir/write/remove/rmdir` calls |
| test | Verify idempotent import | tests | [x] Done | Repeated repository startup does not duplicate records or overwrite existing local records |
| test | Verify damaged old data behavior | tests | [x] Done | Corrupt old data records a dashboard issue, sets cleanup status `blocked`, and still imports valid records |
| review | Subagent review | migration/tests | [x] Done | Initial P1/P2 migration-safety findings were fixed; final re-review found no remaining P0/P1/P2 blockers |
| smoke | Obsidian smoke | `test/` vault | [x] Backfilled | Existing v2 fixture data appeared in Statistics after local import; low-noise issue banner reported invalid old history without storage internals |

Expected commands:

- `npm test -- __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

### Phase 2C: v2 Cleanup Deferral

Goal: Keep legacy v2 history read-only in the MVP and avoid deleting files that may still be needed by other devices.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Remove automatic cleanup execution | stats migration/repository | [x] Done | Repository imports v2 data read-only; migration service exposes no cleanup executor; old files remain untouched |
| dev | Preserve legacy stats files | stats migration | [x] Done | Configured `stats.json` files and plugin-owned v2 files are not deleted by default |
| test | Verify no cleanup side effects | tests | [x] Done | Repository tests assert imported, damaged, and unrelated old files remain and no `remove/rmdir` calls occur |
| review | Subagent review | migration/sync/runtime/tests | [x] Done | Final review found P1 cleanup/sync-read findings and P2 runtime edge cases; user selected 1A and 2A for P1 fixes |
| smoke | Obsidian smoke | `test/` vault | [x] Done | Restarted Obsidian with the deployed bundle; v2 fixture files remained; dashboard imported a newly added synced-device JSONL on view reopen |

Expected commands:

- `npm test -- __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

### Phase 3: Optional Cross-Device JSONL Sync

Goal: Add opt-in cross-device history sync without reintroducing default Git noise.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add `statisticsSyncEnabled` setting | settings/plugin load | [x] Done | Default is false; description explains vault file and Git impact; toggle takes effect without plugin reload |
| dev | Add `StatsSyncStore` per-device JSONL reader/writer | `src/stats/*` | [x] Done | Current device writes only its own `plugins/personal-assistant/stats/devices/<deviceId>.jsonl` file |
| dev | Keep v3 sync files inside the plugin directory | `src/stats/stats-sync-store.ts` | [x] Done | New sync files are written under `<vault.configDir>/plugins/personal-assistant/stats/devices/` |
| dev | Add sync checkpoint metadata | local store | [x] Done | `StatsSyncState` stores last exported revision/hash/exportedAt by record key |
| dev | Import sync files into local records on startup/checkpoint/dashboard read | stats repository | [x] Done | Multi-device records merge by date and device; dashboard reads absorb newly synced JSONL before rendering |
| dev | Split local flush from sync checkpoint | `StatsManager`, plugin call sites | [x] Done | Ordinary edits flush local first; checkpoint runs only when sync is enabled |
| dev | Add low-frequency checkpoint triggers | stats/plugin/view | [x] Done | View open/flush, debounced idle write, cross-day rollover, and unload best effort are covered |
| test | JSONL parser and merge tests | tests | [x] Done | Bad lines and conflict markers are skipped with recoverable errors; duplicates prefer revision |
| test | Sync frequency tests | tests | [x] Done | Sync disabled creates no JSONL; sync enabled appends only changed records |
| review | Subagent review | runtime/sync/tests | [x] Done | Initial runtime-toggle/checkpoint findings were fixed; final re-review found no remaining P0/P1/P2 blockers |
| smoke | Obsidian smoke | `test/` vault | [x] Backfilled | Enabling sync in Settings created the current-device JSONL; synthetic second-device JSONL imported and the dashboard showed `Devices` with multi-device aggregation |

Expected commands:

- `npm test -- __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

### Phase 4: UI, Diagnostics, And Closeout

Goal: Finish user-facing copy, issue reporting, smoke evidence, and documentation.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Update Statistics UI device card behavior | `src/components/Statistics.tsx` | [x] Done | Devices hidden when sync off; visible only with sync on and multi-device data |
| dev | Add low-noise migration issue copy | UI/settings | [x] Done | User-facing text avoids v2/shard/IndexedDB/deviceId terms |
| dev | Update privacy/docs references | README/docs as needed | [x] Done | README says default Statistics is local; sync creates vault files only when enabled |
| test | UI and copy tests | `__tests__/statistics.test.ts`, relevant UI tests | [x] Done | Device visibility, issue copy, and sync setting copy are covered |
| review | Final subagent review | full diff/docs | [x] Done | Product, architecture, and senior-engineering reviews passed after targeted re-review |
| smoke | Final Obsidian smoke | `test/` vault | [x] Done | Default local-only path, sync-enabled JSONL path, multi-device aggregation, local edit reload, and low-noise issue copy were observed in Obsidian. IndexedDB-unavailable UI remains automated-test evidence only |
| closeout | Update tracker evidence | tracker | [x] Done | Verification Log, Review Log, Risk Register, and Current Status match final behavior |

Expected commands:

- `npm test -- __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts --runInBand`
- `npm test -- --runInBand`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

## Acceptance Scenarios

| Scenario | Owner SPEC | Status | Evidence |
| --- | --- | --- | --- |
| Default mode creates no v3 vault sync file | SPEC-02A | [x] Automated and smoke pass | `__tests__/stats-manager.test.ts`; Obsidian smoke verified no `.jsonl` before enabling sync |
| Default mode stops new v2 shard mkdir/write | SPEC-02A | [x] Automated pass; smoke observed no new sync file | `__tests__/stats-manager.test.ts` asserts zero vault `mkdir/write/append/process` calls; Obsidian default path created no `.jsonl` |
| Editing updates local Statistics dashboard | SPEC-02A | [x] Automated and smoke pass | Obsidian smoke edited `Welcome`, sync checkpoint wrote revision 2, and Statistics reload showed `Updated 2026-05-19 14:30:57 UTC` |
| v2 history imports into local store | SPEC-02B | [x] Automated and smoke pass | Obsidian dashboard showed imported historical totals and writing activity from v2 fixture data |
| Configured legacy stats path imports before setting is hidden | SPEC-02B | [x] Automated and review pass | `__tests__/stats-repository.test.ts` imports `custom/stats.json` ahead of config-dir and legacy defaults |
| Current and legacy v2 roots import and deduplicate | SPEC-02B | [x] Automated and smoke pass | Obsidian dashboard loaded current/legacy fixture history; tests cover deduplication details |
| v2 cleanup does not run automatically | SPEC-02C | [x] Automated and smoke pass | `__tests__/stats-repository.test.ts` verifies old files remain after read-only import and no delete calls occur; smoke confirmed v2 fixture files remained after restart |
| Old v2 files remain available for later devices | SPEC-02C | [x] Automated and docs pass | Plan records cleanup deferral; repository no longer calls cleanup code |
| Corrupt v2 data records a low-noise issue | SPEC-02C | [x] Automated and smoke pass | Obsidian showed `10 Statistics history issues...` and existing v2 fixture files remained |
| Dashboard read imports newly synced JSONL | SPEC-03 | [x] Automated and smoke pass | `__tests__/stats-repository.test.ts` covers dashboard read importing sync records before rendering; smoke added a synced-device JSONL while Obsidian was running and the reopened dashboard showed `DEVICES 4` |
| Sync disabled never writes JSONL | SPEC-03 | [x] Automated and smoke pass | Obsidian default-mode smoke found no `.jsonl`; sync setting was false |
| Sync enabled creates one per-device JSONL | SPEC-03 | [x] Automated and smoke pass | Obsidian settings toggle created `plugins/personal-assistant/stats/devices/6c8cd752-e4c4-49c0-9165-2e76ef07e2c6.jsonl` |
| Multi-device JSONL aggregates correctly | SPEC-03 | [x] Automated and smoke pass | Synthetic `smoke-device.jsonl` imported; Obsidian dashboard showed `DEVICES 3` and 30d/all writing increased by 7 words |
| JSONL conflict marker lines are skipped | SPEC-03 | [x] Automated and review pass | `__tests__/stats-sync-store.test.ts` skips conflict marker lines with recoverable errors |
| Damaged own-device JSONL does not block local writes | SPEC-03 | [x] Automated and review pass | `__tests__/stats-sync-store.test.ts` skips invalid lines while importing valid records |
| Devices metric hidden in default mode | SPEC-04 | [x] Automated and smoke pass | Obsidian default-mode Overview showed no `Devices` card while sync was off |
| Devices metric visible for sync multi-device data | SPEC-04 | [x] Automated and smoke pass | Obsidian sync-enabled Overview showed `DEVICES 3` after importing synthetic second-device data |
| Statistics issue copy hides storage internals | SPEC-04 | [x] Automated and smoke pass | Obsidian displayed low-noise `Statistics history issues... Your notes are not affected.` copy |
| Sync setting copy hides storage internals | SPEC-04 | [x] Automated and smoke pass | Obsidian Settings displayed the revised cross-device sync copy without storage internals |
| Cross-day pending writes preserved | SPEC-03 | [x] Automated and review pass | `StatsManager.ensureToday()` flushes the current shard before resetting day state |

## Risk Register

| Risk | Impact | Owner SPEC | Mitigation | Status |
| --- | --- | --- | --- | --- |
| IndexedDB unavailable in Obsidian environment | Statistics history unavailable | SPEC-02A | Production returns an explicit unavailable local-history error; memory store is test-injected only; notes and vault data are unaffected | [x] Mitigated for SPEC-02A |
| Jest lacks browser IndexedDB | Tests become brittle | SPEC-02A | Use injected `MemoryStatsLocalStore` for business tests; wrapper tests use injected IndexedDB API fakes with no new dependency by default | [x] Mitigated for SPEC-02A |
| Automatic v2 cleanup removes data after partial import | History loss | SPEC-02C | Avoided by removing automatic cleanup from v3 MVP; migration is read-only and old files stay in place | [x] Avoided by 1A |
| Automatic cleanup syncs deletions before another device upgrades | Other devices cannot import v2 later | SPEC-02C | Avoided by user-selected 1A: v2 import is read-only and cleanup is deferred to a future explicit flow | [x] Avoided by 1A |
| JSONL grows indefinitely | Slow startup or large Git diffs | SPEC-03 | Append only changed records; defer compaction until there is evidence | [~] Accepted for v3 phase 1 |
| Sync checkpoint on unload is skipped | Latest cross-device data may lag | SPEC-03 | Use idle/view-open/cross-day checkpoints; unload is best effort only | [x] Mitigated for SPEC-03 |
| JSONL conflict markers or damaged files break sync import | Sync history import failure | SPEC-03 | Skip invalid/conflict lines with recoverable issue; local Statistics remains writable | [x] Mitigated for SPEC-03 |
| User-facing copy exposes internals | Product trust issue | SPEC-04 | Statistics issue copy and sync setting copy avoid v2/shard/IndexedDB/deviceId/JSONL terms; raw device ID is not shown in the Devices metric | [x] Mitigated for SPEC-04 |

## Review Log

| Date | Scope | Reviewer Mode | Result | Findings | Follow-up |
| --- | --- | --- | --- | --- | --- |
| 2026-05-19 | Pre-plan review | Product, architecture, senior-engineering subagents | Incorporated | Default JSONL backup conflicted with Git quiet goal; single shared JSONL caused cross-device conflict risk; automatic cleanup needed validation and explicit boundaries | Plan updated: JSONL only when sync enabled; per-device JSONL; validated automatic v2 cleanup |
| 2026-05-19 | SPEC-00 docs creation | Local doc setup | Created | Plan and tracker created from agreed decisions; no runtime code changed | Run docs checks and request docs review |
| 2026-05-19 | SPEC-00 docs review | Product/architecture, overdesign/MVP, and evolution/implementation subagents | Request changes; incorporated | P0/P1/P2 findings covered default vault-write wording, v2 cleanup scope, configured legacy path import, Phase 2 overbreadth, facade interface gaps, storage/DTO boundary, migration metadata, IndexedDB test strategy, sync watermark/recovery, and acceptance gaps | Plan/tracker updated; requires docs checks and re-review before SPEC-01 |
| 2026-05-19 | SPEC-00 re-review | Product/architecture and implementation/overdesign subagents | Passed | No P0/P1/P2 blockers; SPEC-01 judged thin enough and SPEC-02 split considered implementation-friendly | SPEC-00 closed; SPEC-01 started |
| 2026-05-19 | SPEC-01 runtime review | Runtime/architecture and testing/overdesign subagents | Passed | No P0/P1 blockers. P2 findings: tracker runtime status still said not started; plan flush wording did not say local-only begins after SPEC-02A; smoke needed an explicit skip or evidence | Tracker status and plan wording fixed; SPEC-01 smoke explicitly skipped as no behavior/UI change |
| 2026-05-19 | SPEC-02A initial runtime review | Product/architecture and senior-engineering subagents | Request changes; fixed locally | P1 findings: local writes needed serialization, generated `statisticsVaultId` needed durable save before `StatsManager`, and production could not silently fall back to volatile memory. P2 findings: same-timestamp device tie-breaker, IndexedDB test gaps, tracker drift, new test command omission, and default Devices metric deferred to SPEC-04 | Added repository write chain and concurrency test, awaited settings migration save during startup, changed missing IndexedDB to explicit unavailable state, covered IndexedDB upgrade/open-error paths, fixed deterministic snapshot tie-breaker, and updated tracker |
| 2026-05-19 | SPEC-02A re-review | Product/architecture and senior-engineering subagents | Passed after P2 follow-up | One reviewer found no remaining P0/P1/P2. The other confirmed P0/P1 closed and found one P2: IndexedDB request failure and transaction error/abort branches lacked tests | Added `getAll` request failure, transaction error, and transaction abort tests in `__tests__/stats-local-store.test.ts` |
| 2026-05-19 | SPEC-02B initial migration review | Product/architecture and senior-engineering subagents | Request changes; fixed locally | P1 findings: `exists()` adapter failures could make old data look absent, malformed v2 shards could import as zero counts, migration metadata was overwritten every initialization, and IndexedDB upgrade could hang on `onblocked`. P2 finding: import should use an atomic add-if-absent write | Added migration scan error accounting, strict v2 shard validation, metadata merge preservation, IndexedDB `onblocked`/`onversionchange` handling, store-level `addRecordIfAbsent`, and focused tests |
| 2026-05-19 | SPEC-02B re-review | Migration/data-safety subagents | Request changes; fixed locally | Remaining findings: malformed legacy days could import as zero counts, completed cleanup state could be preserved when v2 files reappeared, missing or malformed `updatedAt` needed to block cleanup, and transient initialization failures needed retry coverage | Added strict legacy-day validation, stricter `updatedAt` validation, complete-state preservation only for empty post-cleanup scans, local-store and repository initialization retry handling, and regression tests |
| 2026-05-19 | SPEC-02B final re-review | Migration/data-safety subagents | Passed | No remaining P0/P1/P2 findings. Review confirmed strict malformed data handling, complete-state metadata behavior, atomic add-if-absent, and initialization retry handling | SPEC-02B closed; Obsidian smoke was deferred at the time and later backfilled |
| 2026-05-19 | SPEC-02C initial cleanup review | Product/architecture and senior-engineering subagents | Request changes; fixed locally | P1 findings: duplicate date/device v2 shards could be deleted even when not represented in local stats; cleanup could delete before durable cleanup metadata evidence; cleanup targets lacked import-time content hashes and could delete changed files. P2 finding: final metadata write failure could be overwritten by a later empty scan | Duplicate shards now block cleanup, cleanup targets include content hashes and are re-read before deletion, a retryable cleanup state is persisted before deletion, failed evidence is preserved after empty scans, and regression tests cover each path |
| 2026-05-19 | SPEC-02C final cleanup re-review | Migration/data-safety subagents | Passed | No remaining P0/P1/P2 findings. Review confirmed duplicate blocking, hash re-read, retryable metadata behavior, and final-write failure preservation | SPEC-02C closed; Obsidian smoke was deferred at the time and later backfilled for the blocked-cleanup path |
| 2026-05-19 | SPEC-03 initial sync review | Product/architecture and senior-engineering subagents | Request changes; fixed locally | P1 findings: sync toggle did not take effect until reload, idle debounced writes could wait until flush/unload, checkpoint writes were not serialized, and cross-day rollover could drop a pending previous-day shard. P2 findings: IndexedDB sync state lacked direct tests, Devices UI appeared in local-only mode, JSONL path drifted from spec, and tracker status lagged implementation | Added runtime repository reconfiguration, debounced-write checkpointing, sync checkpoint serialization, pre-rollover shard flush, IndexedDB sync-state tests, conditional Devices metric, spec path alignment, and tracker updates |
| 2026-05-19 | SPEC-03 sync re-review | Product/architecture and senior-engineering subagents | Passed after tracker follow-up | Runtime and test findings were closed. One remaining P2 was tracker drift after implementation | Tracker updated to mark SPEC-03 complete; Obsidian smoke was deferred at the time and later backfilled |
| 2026-05-19 | SPEC-04 final review | Product/UX, architecture/evolution, and senior-engineering subagents | Request changes; fixed locally | P2 findings: unavailable local history looked like normal empty state; sync setting copy used singular file wording; plan interface and sync-state docs were stale; smoke deferral rule contradicted `Done; smoke deferred`; unused v2 repository adapter remained. P1 finding: sync-off setting copy implied no Git changes even though validated v2 cleanup can remove old plugin-owned files by design | Added unavailable-history empty state and test, changed sync copy to plural and scoped it to ongoing synced-history Git changes, updated plan interface and sync-state docs, clarified tracker smoke-deferred rule, and removed unused v2 repository adapter |
| 2026-05-19 | SPEC-04 targeted re-review | Product/UX, architecture/evolution, and senior-engineering subagents | Passed | No remaining P0/P1/P2 blockers. Review confirmed unavailable-history copy, scoped sync setting copy, plan/repository contract alignment, sync-state doc alignment, smoke-deferred governance, and v2 adapter removal | SPEC-04 closed; Obsidian smoke was deferred at the time and later backfilled |
| 2026-05-20 | Final code review after smoke | Product/architecture, overdesign, and senior-engineering subagents | Fixed after user selected 1A and 2A | P1 findings: automatic v2 cleanup could delete shared history before other devices import; synced JSONL changes were invalidating cache but dashboard reads could render before importing them. P2 findings: pending write tracking, sync checkpoint duplicate recovery, sync toggle rollback, and background snapshot races needed hardening | v2 cleanup removed from MVP, dashboard reads import sync JSONL, write generation replaces boolean pending-write state, sync checkpoints seed state from existing own JSONL, sync toggle failure rolls back, and background snapshot refresh is generation-guarded |

## Verification Log

| Date | Scope | Command / Evidence | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-19 | SPEC-00 docs creation | Create `docs/architecture/statistics-v3-plan.md` and `docs/archive/statistics-v3-development-tracker.md` | Passed | Docs-only setup; no runtime code changed |
| 2026-05-19 | SPEC-00 docs whitespace | `rg -n "[[:blank:]]+$" docs/architecture/statistics-v3-plan.md docs/archive/statistics-v3-development-tracker.md` | Passed | No trailing whitespace matches |
| 2026-05-19 | SPEC-00 new-file diff checks | `git diff --no-index --check -- /dev/null <new-doc>` for each new doc | Passed | No whitespace warnings after removing extra EOF blank lines; `--no-index` returns non-zero because the files are new |
| 2026-05-19 | SPEC-00 review incorporation checks | `rg -n "[[:blank:]]+$" docs/architecture/statistics-v3-plan.md docs/archive/statistics-v3-development-tracker.md`; `git diff --check -- docs/architecture/statistics-v3-plan.md docs/archive/statistics-v3-development-tracker.md`; `git diff --no-index --check -- /dev/null <new-doc>` for each new doc | Passed | No whitespace warnings or trailing whitespace matches after review-driven revisions; new-file `--no-index` returns non-zero because the files are new |
| 2026-05-19 | SPEC-01 focused tests | `npm test -- __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts --runInBand` | Passed | 3 suites passed, 18 tests passed |
| 2026-05-19 | SPEC-01 typecheck | `npx tsc -noEmit -skipLibCheck` | Passed | No TypeScript errors |
| 2026-05-19 | SPEC-01 lint | `npm run lint` | Passed | ESLint passed |
| 2026-05-19 | SPEC-01 whitespace checks | `git diff --check`; `git diff --no-index --check -- /dev/null src/stats/stats-repository.ts`; new-doc `--no-index --check` checks | Passed | No whitespace warnings; `--no-index` returns non-zero because the files are new |
| 2026-05-19 | SPEC-01 post-review focused tests | `npm test -- __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts --runInBand` | Passed | 3 suites passed, 18 tests passed after review follow-up docs fixes |
| 2026-05-19 | SPEC-01 post-review whitespace checks | `rg -n "[[:blank:]]+$" docs/architecture/statistics-v3-plan.md docs/archive/statistics-v3-development-tracker.md src/stats/stats-repository.ts src/stats/stats-manager.ts`; `git diff --check` | Passed | No trailing whitespace matches and no diff whitespace warnings |
| 2026-05-19 | SPEC-02A focused implementation tests | `npm test -- __tests__/stats-repository.test.ts __tests__/stats-local-store.test.ts __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts --runInBand` | Passed | 7 suites passed, 40 tests passed |
| 2026-05-19 | SPEC-02A typecheck | `npx tsc -noEmit -skipLibCheck` | Passed | No TypeScript errors |
| 2026-05-19 | SPEC-02A lint | `npm run lint` | Passed | ESLint passed |
| 2026-05-19 | SPEC-02A build | `npm run build` | Passed | Build completed; Browserslist reported an existing caniuse-lite update notice |
| 2026-05-19 | SPEC-02A whitespace checks | `git diff --check`; `rg -n "[[:blank:]]+$" <SPEC-02A files>`; `git diff --no-index --check -- /dev/null <new SPEC-02A files>` | Passed | No whitespace warnings; `--no-index` returns non-zero because the checked files are new |
| 2026-05-19 | SPEC-02A P2 error-path tests | `npm test -- __tests__/stats-local-store.test.ts __tests__/stats-repository.test.ts --runInBand` | Passed | 2 suites passed, 9 tests passed; covers IndexedDB request failure and transaction error/abort branches |
| 2026-05-19 | SPEC-02A deploy | `make deploy` | Passed | Full Jest suite passed with 27 suites and 449 tests, lint and build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-19 | SPEC-02A post-deploy file checks | `find test/.obsidian/plugins/personal-assistant -maxdepth 1 -type f -print \| sort`; `find test -name '*.jsonl' -print` | Passed | Deployed `main.js`, `manifest.json`, `manifest-beta.json`, and `styles.css` are present; no `.jsonl` files are present in the test vault. Existing v2 fixture files remain for later SPEC-02B/02C work |
| 2026-05-19 | SPEC-02A Obsidian smoke attempt | `command -v obsidian`; `open 'obsidian://open?vault=test'`; `open -a Obsidian`; `open -a Obsidian /Users/edonyzpc/code/personal-assistant/test`; `osascript -e 'tell application "Obsidian" to activate'`; Computer Use `get_app_state` | Blocked | No `obsidian` CLI was available. Obsidian open/activation commands returned success, but Computer Use reported `cgWindowNotFound` and AppleScript saw no Obsidian windows. No in-app Statistics smoke was completed or counted as passed |
| 2026-05-19 | SPEC-02 smoke deferral decision | User instruction after blocked smoke attempt | Accepted | User asked to remember the smoke state, continue later tasks, and backfill smoke when the environment supports it |
| 2026-05-19 | SPEC-02B focused tests | `npm test -- __tests__/stats-repository.test.ts __tests__/stats-local-store.test.ts --runInBand` | Passed | 2 suites passed, 26 tests passed; covers strict malformed legacy/v2 import handling, missing/malformed `updatedAt`, metadata complete-state behavior, atomic add-if-absent, and initialization retries |
| 2026-05-19 | SPEC-02B focused implementation suite | `npm test -- __tests__/stats-repository.test.ts __tests__/stats-local-store.test.ts __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts --runInBand` | Passed | 7 suites passed, 57 tests passed |
| 2026-05-19 | SPEC-02B typecheck/lint/whitespace | `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `git diff --check` | Passed | TypeScript, ESLint, and whitespace checks passed |
| 2026-05-19 | SPEC-02B deploy | `make deploy` | Passed | Full Jest suite passed with 27 suites and 466 tests, lint and build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`; build reported the existing Browserslist caniuse-lite update notice |
| 2026-05-19 | SPEC-02C focused tests | `npm test -- __tests__/stats-repository.test.ts __tests__/stats-local-store.test.ts --runInBand` | Passed | 2 suites passed, 31 tests passed; covers validated cleanup, duplicate blocking, changed-after-import hash checks, unrelated-file preservation, and retryable metadata |
| 2026-05-19 | SPEC-02C focused implementation suite | `npm test -- __tests__/stats-repository.test.ts __tests__/stats-local-store.test.ts __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts --runInBand` | Passed | 7 suites passed, 62 tests passed |
| 2026-05-19 | SPEC-02C typecheck/lint/whitespace | `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `git diff --check` | Passed | TypeScript, ESLint, and whitespace checks passed |
| 2026-05-19 | SPEC-02C deploy | `make deploy` | Passed | Full Jest suite passed with 27 suites and 471 tests, lint and build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`; build reported the existing Browserslist caniuse-lite update notice |
| 2026-05-19 | SPEC-02C Obsidian smoke | User-approved deferred smoke state | Deferred | Same environment blocker as SPEC-02A: no accessible Obsidian window for in-app verification. Must backfill when environment supports smoke testing |
| 2026-05-19 | SPEC-03 focused tests | `npm test -- __tests__/stats-sync-store.test.ts __tests__/stats-local-store.test.ts __tests__/stats-repository.test.ts __tests__/stats-manager.test.ts --runInBand` | Passed | 4 suites passed, 41 tests passed; covers sync store import/export, local sync metadata, repository sync behavior, runtime toggle, and debounced write checkpoint |
| 2026-05-19 | SPEC-03 focused implementation suite | `npm test -- __tests__/stats-sync-store.test.ts __tests__/stats-repository.test.ts __tests__/stats-local-store.test.ts __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/statistics.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts --runInBand` | Passed | 8 suites passed, 68 tests passed |
| 2026-05-19 | SPEC-03 typecheck/lint/whitespace | `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `git diff --check` | Passed | TypeScript, ESLint, and whitespace checks passed |
| 2026-05-19 | SPEC-03 deploy | `make deploy` | Passed | Full Jest suite passed with 28 suites and 477 tests, lint and build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`; build reported the existing Browserslist caniuse-lite update notice |
| 2026-05-19 | SPEC-03 Obsidian smoke | User-approved deferred smoke state | Deferred | Same environment blocker as SPEC-02A: no accessible Obsidian window for in-app verification. Must backfill sync-enabled JSONL and multi-device aggregation smoke when available |
| 2026-05-19 | SPEC-04 UI/copy focused tests | `npm test -- __tests__/statistics.test.ts __tests__/settings.test.ts --runInBand` | Passed | 2 suites passed, 6 tests passed; covered Devices visibility helper, Statistics issue copy, and sync setting copy before final review fixes |
| 2026-05-19 | SPEC-04 post-review focused tests | `npm test -- __tests__/statistics.test.ts __tests__/settings.test.ts __tests__/stats-repository.test.ts --runInBand` | Passed | 3 suites passed, 26 tests passed; covers unavailable empty state, low-noise issue copy, scoped sync setting copy, and repository migration behavior |
| 2026-05-19 | SPEC-04 typecheck/whitespace | `npx tsc -noEmit -skipLibCheck`; `git diff --check` | Passed | TypeScript and whitespace checks passed after review fixes |
| 2026-05-19 | SPEC-04 stale-string checks | `rg -n -F <stale string> src docs __tests__` | Passed | No stale `V2StatsRepository`, `lastExportedByRecordKey`, `statistics file issue`, or old sync-copy wording remains |
| 2026-05-19 | SPEC-04 deploy | `make deploy` | Passed | Full Jest suite passed with 28 suites and 481 tests, lint and build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`; build reported the existing Browserslist caniuse-lite update notice |
| 2026-05-19 | SPEC-04 Obsidian smoke | User-approved deferred smoke state | Deferred | Same environment blocker as SPEC-02A: no accessible Obsidian window for in-app verification. Must backfill default-mode, sync-enabled JSONL, multi-device aggregation, and unavailable-history UI smoke when available |
| 2026-05-19 | SPEC-04 Obsidian smoke backfill deploy | `make deploy` | Passed | Full Jest suite passed with 28 suites and 481 tests, lint and build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/` before smoke |
| 2026-05-19 | SPEC-02A/SPEC-04 default-mode Obsidian smoke backfill | Obsidian test vault, Computer Use, `find test -name '*.jsonl'`, settings file check | Passed | Restarted Obsidian with deployed plugin. Statistics generated `statisticsVaultId`, `statisticsSyncEnabled=false`, no `.jsonl` files existed, Overview rendered without a `Devices` card, and low-noise issue copy appeared |
| 2026-05-19 | SPEC-03 sync Obsidian smoke backfill | Obsidian Settings toggle, file checks, Computer Use | Passed | Enabled `Sync statistics history across devices`; current-device JSONL was created under the previous `test/.obsidian/personal-assistant-stats/v3/devices/` path before the plugin-directory path consolidation |
| 2026-05-19 | SPEC-03 path consolidation focused tests | `npm test -- __tests__/settings.test.ts __tests__/stats-sync-store.test.ts __tests__/stats-manager.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `git diff --check` | Passed | Focused settings/sync/manager tests passed with 11 tests; TypeScript and whitespace checks passed after moving v3 sync output to the plugin directory |
| 2026-05-19 | SPEC-03 path consolidation deploy and smoke | `make deploy`; Obsidian restart; `find test/.obsidian/plugins/personal-assistant/stats -maxdepth 4 -type f -print`; `wc -l test/.obsidian/plugins/personal-assistant/stats/devices/*.jsonl` | Passed | Full deploy passed with 28 suites and 481 tests, lint and build passed, and Obsidian created `test/.obsidian/plugins/personal-assistant/stats/devices/6c8cd752-e4c4-49c0-9165-2e76ef07e2c6.jsonl` with 4 lines. Old `test/.obsidian/personal-assistant-stats/v3` files remained only as previous smoke artifacts |
| 2026-05-19 | SPEC-03/SPEC-04 multi-device Obsidian smoke backfill | Added `smoke-device.jsonl`, restarted Obsidian, observed Statistics Overview | Passed | Dashboard imported synthetic second-device data, showed `DEVICES 3`, and 30d/all writing increased from 312 to 319. Device count is 3 because imported legacy-device history is also present |
| 2026-05-19 | SPEC-02A/SPEC-03 edit/reload Obsidian smoke backfill | Edited `Welcome` in Obsidian, waited for debounced write, inspected JSONL, restarted, observed Statistics Overview | Passed | Current-device JSONL appended revision 2 with `updatedAt 2026-05-19T14:33:06.157Z`; Statistics reload showed `Updated 2026-05-19 14:30:57 UTC` and current totals |
| 2026-05-19 | SPEC-02C blocked-cleanup Obsidian smoke backfill | Obsidian Statistics issue banner plus v2 fixture file check | Passed | Existing invalid v2 fixture data remained and Statistics showed `10 Statistics history issues... Your notes are not affected.` Cleanup-success path remains covered by automated tests rather than this smoke fixture |
| 2026-05-19 | Overall Statistics v3 smoke rerun | `make deploy`; Obsidian restart; Statistics UI; sync enabled/disabled edits; path and line-count checks | Passed | Full deploy passed with 28 suites and 481 tests, lint and build passed. Sync enabled wrote only to `test/.obsidian/plugins/personal-assistant/stats/devices/6c8cd752-e4c4-49c0-9165-2e76ef07e2c6.jsonl`; old `test/.obsidian/personal-assistant-stats/v3` files did not change. Sync disabled hid the Devices card and did not append JSONL. After restoring sync enabled, Statistics showed `Updated 2026-05-19 15:25:01 UTC`, `TOTAL WORDS 1,842`, `30D WRITING 331`, `ALL WRITING 331`, and `DEVICES 3` |
| 2026-05-19 | Post-smoke timestamp-only sync churn fix | `npm test -- __tests__/stats-sync-store.test.ts __tests__/stats-repository.test.ts __tests__/stats-manager.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `git diff --check`; `make deploy`; two Obsidian restarts with line-count checks | Passed | Smoke found repeated JSONL appends on restart when only `updatedAt` changed. Fixed repository writes to ignore same-count shard updates and changed sync hashes to ignore `updatedAt` while accepting legacy hashes without appending. Focused tests passed with 31 tests, final deploy passed with 28 suites and 484 tests, and new bundle restart kept the sync file at 10 lines with latest revision 4 unchanged. Final Computer Use UI read timed out, but the same smoke run had already validated Statistics UI before the backend-only fix |
| 2026-05-20 | Final review focused tests | `npm test -- __tests__/stats-repository.test.ts __tests__/stats-sync-store.test.ts __tests__/stats-manager.test.ts __tests__/settings.test.ts --runInBand` | Passed | 4 suites passed, 34 tests passed; covers read-only v2 import, dashboard-read sync import, sync checkpoint state seeding, manager sync-toggle rollback, initial checkpoint failure rollback, and settings copy |
| 2026-05-20 | Final review static checks | `npx tsc -noEmit -skipLibCheck`; `git diff --check`; `rg -n "[[:blank:]]+$" <final review files>`; `npm run lint`; `npm run build` | Passed | TypeScript, whitespace, trailing-whitespace, ESLint, and production build passed; build reported the existing Browserslist caniuse-lite update notice |
| 2026-05-20 | Final review deploy | `make deploy` | Passed | Full Jest suite passed with 28 suites and 485 tests, lint and build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-20 | Final review Obsidian smoke | Obsidian restart, Statistics UI, v2 file checks, JSONL line checks, command-palette Statistics reopen after adding `smoke-dashboard-read.jsonl` | Passed | Restarted Obsidian with the deployed bundle. Initial UI showed `TOTAL WORDS 1,842`, `30D WRITING 331`, `DEVICES 3`, and low-noise issue copy. Current-device JSONL added one new 2026-05-20 record, then stayed at 11 lines after a second restart. Existing v2 fixture files remained. While Obsidian was running, a new synced-device JSONL was added and reopening Statistics showed `TOTAL WORDS 1,851`, `30D WRITING 340`, `ALL WRITING 340`, and `DEVICES 4` without app restart |
| 2026-05-20 | Post-cleanup test helper check | `npm test -- __tests__/stats-manager.test.ts --runInBand`; `git diff --check` | Passed | 1 suite passed with 9 tests after removing an unused test helper and adding explicit initial-checkpoint rollback coverage; whitespace check passed |
| 2026-05-20 | Final redeploy file checks | Final `make deploy`; Obsidian restart; `wc -l` current and smoke sync files; v2 fixture `find`; deployed asset `find`; Computer Use retry | Passed with UI caveat | Final deploy passed with 28 suites and 485 tests. After restart, current-device JSONL stayed at 11 lines, `smoke-dashboard-read.jsonl` stayed at 1 line, v2 fixture files remained, and deployed assets were present. Computer Use `get_app_state` timed out twice after the final restart, so no additional UI screenshot is counted beyond the earlier passed UI smoke in this same fix cycle |

## Update Rules

- When a SPEC status changes, update Current Status, SPEC Index, Phase Ledger, Review Log, and Verification Log in the same change.
- When product or architecture decisions change, update `docs/architecture/statistics-v3-plan.md` and this tracker together.
- Do not start SPEC-01 runtime work until SPEC-00 has docs checks and review evidence.
- Do not mark a runtime SPEC done until focused tests, subagent review, `make deploy`, Obsidian smoke, and tracker evidence are complete, except for an explicit `[x] Done; smoke deferred` state under the next rule.
- Obsidian smoke may be deferred only when the environment blocks app access and the user explicitly approves continuing. Deferred smoke must stay visible in Current Status, the owning SPEC smoke row, and Verification Log until it is backfilled; runtime specs may use `[x] Done; smoke deferred` only in that state.
