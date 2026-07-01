# PR #376 Review Report

**PR**: feat(pa): add low-burden PA runtime, contracts, and supporting modules
**Scope**: 22,854 additions / 392 deletions / 140 files / 5 commits
**Review date**: 2026-07-01
**Dimensions covered**: Architecture, Contracts, Security, Product Alignment, Integration, Tests, UI Safety, Performance

---

## Executive Summary

PR #376 introduces a complete "Low-Burden PA" runtime system with 27 new modules,
comprehensive test coverage (16/17 modules tested), and strong product alignment
(9.5/10). The architecture is fundamentally sound with clean lazy initialization,
proper error isolation, and full Obsidian community compliance (zero DOM violations).

**1 P0** (context firewall unwired), **19 P1s** across security, architecture,
integration, performance, and test coverage. No structural design flaws — P1s are
primarily defensive programming gaps and optimization opportunities.

---

## P0 — Must Fix (1)

### P0-1 · [D3] Context Firewall is completely unwired
- **File**: `src/pa/context-firewall.ts` (entire file)
- **Issue**: `decideContextFirewall()` is exported and unit-tested, but **never
  called in any production code path**. Confirmed memories with
  `lifecycle: "forgotten_tombstone"`, `sensitivity: "high"`, or
  `lifecycle: "archived"` are not filtered at retrieval time through this function.
- **Impact**: A forgotten/archived/high-sensitivity memory could be surfaced to
  users or sent to LLM context. The "firewall" name gives a false sense of security.
- **Fix**: Wire `decideContextFirewall()` into every code path that reads confirmed
  memories for LLM context or user display — at minimum the context-pager and any
  pagelet/recall surface consuming `MemoryGovernanceStore.list()`.

---

## P1 — Should Fix (19)

### Security & Data Boundary (4)

| ID | Dim | File | Issue | Fix |
|----|-----|------|-------|-----|
| P1-S1 | D3 | `quick-capture-enrichment.ts:177-195` | Raw user text sent to LLM; boundary check is path-based only, not content-based. After one-time disclosure, all future captures auto-process. | Consider per-session disclosure reset, or document that all captures will be processed. |
| P1-S2 | D3 | `contracts/data-boundary.ts:111` | `DataBoundaryOverride` with missing `sourcePath` acts as wildcard bypass — `!override.sourcePath` evaluates true for ANY path. | Require non-empty `sourcePath` or explicit `sourcePath: "*"` for wildcard. |
| P1-S3 | D3 | `contracts/data-boundary.ts` | `private/` folder not in default exclusions. Users must manually configure. | Add `private` and `.obsidian` as defaults in `DEFAULT_DATA_BOUNDARY_POLICY.excludedFolders`. |
| P1-S4 | D3 | `quiet-recall.ts:168-213` | Quiet Recall doesn't re-check data boundaries on source ref paths. A saved insight from a later-excluded file still surfaces. | Accept `isPathAllowed` callback in `QuietRecallBuildInput` and filter by excluded paths. |

### Architecture & Contracts (4)

| ID | Dim | File | Issue | Fix |
|----|-----|------|-------|-----|
| P1-A1 | D1 | `review-queue-store.ts:180-198` | `updateStatus()` has no state transition guard — any status can be set from any state (e.g., "applied" → "suggested"). | Add `VALID_TRANSITIONS` map and reject invalid transitions. |
| P1-A2 | D1 | `scope-recap.ts:7`, `weekly-review.ts:11`, `maintenance-review-apply.ts:1` | 3 upward dependency violations: PA imports from `pagelet/output/types` and `ai-services/write-action-framework/`. | Move `GeneratedReviewNote` to `src/pa/contracts/`; move or document `validateTargetConfinement`. |
| P1-A3 | D1 | `src/pa/*.ts` (12 files) | `normalizeVaultPath` duplicated 12×, `stableHash` 5×, `isRecord` 6×, `includesString` 4×. Subtle divergence already exists. | Extract shared helpers into `src/pa/utils.ts`. |
| P1-A4 | D2 | `contracts/memory-taxonomy.ts:100-103` | `canAutoConfirmMemoryCandidate` always returns `false` — dead code or stub. | Add comment explaining intent, or mark `@deprecated`, or fix if buggy. |

### Integration (6)

| ID | Dim | File | Issue | Fix |
|----|-----|------|-------|-----|
| P1-I1 | D5 | `orchestrator.ts:841,919,1019,1065` | No timeout/abort for foreground LLM calls. Hung LLM locks `foregroundRunInProgress` mutex permanently until plugin reload. | Add configurable timeout (60s) with `Promise.race` + mutex release on timeout. |
| P1-I2 | D5 | `orchestrator.ts:446-582` | 5 tab commands bypass `foregroundRunInProgress` mutex and per-hour/per-day LLM budget guard. Can cause redundant LLM calls. | Route through same budget guard, or document exemption. |
| P1-I3 | D5 | `plugin.ts:2409-2456` | PA stores not nulled in `unloadAsync()`. `destroyPageletRuntime()` does null them correctly, but `unloadAsync()` doesn't call it. | Call `destroyPageletRuntime()` from `unloadAsync()` or replicate null assignments. |
| P1-I4 | D5 | `tab/TabView.ts:98-105,169-179` | `destroy()` doesn't clear `maintenanceActionState`, `weeklyAcceptedItemIds`, `quietRecallSaveState`. Async methods can write post-destroy. | Add `.clear()` + `_destroyed` guard before post-await operations. |
| P1-I5 | D5 | `tab/PageletDetailView.ts:35-36` | Module-level `pageletDetailSessionCache` (Map, 12 entries) not cleared on plugin unload. Survives disable/re-enable. | Export `clearPageletDetailSessionCache()` and call from `unloadAsync()`. |
| P1-I6 | D5 | `pagelet/commands.ts:56-144` | All 15 command callbacks use `void callbacks.onXxx()` — errors silently swallowed with no user Notice. | Wrap in `callbacks.onXxx().catch(handleCommandError)` or apply HOF wrapper. |

### Performance (4)

| ID | Dim | File | Issue | Fix |
|----|-----|------|-------|-----|
| P1-P1 | D8 | `graph-discovery.ts:240-278` | O(n²) pair enumeration in `buildRelatedNoteItems`. Currently bounded to n=40 by caller, but function accepts unbounded input. | Early-exit once `maxItemsPerType` items produced inside nested loop. |
| P1-P2 | D8 | `maintenance-review.ts:349-363` | O(n²·k) keyword cross-matching in `bestLinkTarget`. Bounded by caller convention (50), not enforced. | Add `maxNotes` parameter or internal cap. |
| P1-P3 | D8 | `plugin.ts:1511-1516` | `getGraphDiscoveryBacklinks(path)` iterates entire `resolvedLinks` map per file. O(40·V) for V=10K vault. | Build inverted backlinks map once before per-file loop: O(V+40). |
| P1-P4 | D8 | `review-queue-store.ts:112-211` | Unbounded queue growth. Dismissed/expired items persist forever. JSON serialization on every `saveSettings()` grows. | Add max-items cap (200) with eviction of oldest dismissed/expired items. |

### Test Coverage (1)

| ID | Dim | File | Issue | Fix |
|----|-----|------|-------|-----|
| P1-T1 | D6 | `src/pa/review-artifact-lifecycle.ts` | Zero test coverage. Pure classifier with 6 dispositions + 5 eligibility helpers. | Add `__tests__/review-artifact-lifecycle.test.ts`. |

---

## P2 — Nice to Have (Selected)

| ID | Dim | File | Summary |
|----|-----|------|---------|
| P2-01 | D4 | `weekly-review.ts:214` | "Memory item still needs review" — obligation language vs North Star copy guidelines. Use "Memory candidate you may want to revisit." |
| P2-02 | D4 | `graph-discovery.ts:453-456` | `dismiss` and `reject` feedback both map to `edgeState: "rejected"`. Distinguish so dismissed items can potentially resurface. |
| P2-03 | D4 | `maintenance-review-apply.ts` | Non-`move` action types declared in type system but not yet applyable. Surface clear message to user. |
| P2-04 | D1 | `plugin.ts` | At 3714 lines, approaching extraction threshold. Consider `PaIntegration` helper class when >4000. |
| P2-05 | D2 | `contracts/*.ts` | Contracts contain runtime logic (validators). Defensible pattern (co-located pure functions), not a defect. |
| P2-06 | D2 | `contracts/context-trace.ts:23-36` | `ContextMemoryRef.text` not in `FORBIDDEN_PERSISTED_TEXT_KEYS`. Currently safe (stripped by `toPersistedContextTrace`), but defense-in-depth risk. |
| P2-07 | D2 | `contracts/retrieval-outcome.ts:34` | `confidence?: number` has no range constraint (0-1). |
| P2-08 | D1 | `src/pa/eval/` | Physically inside `src/pa/` but test-time only. Consider ESLint `no-restricted-imports` or move to `tests/`. |
| P2-09 | D6 | `eval/assertions.ts:361-364` | Unknown assertion type falls through to generic check instead of throwing. |
| P2-10 | D5 | `plugin.ts:987-994` | 16 pagelet commands registered permanently once enabled; visible in palette after disable. Obsidian API limitation. |
| P2-11 | D5 | `plugin.ts:1751,1266` | Concurrent `saveSettings()` possible from parallel store persistence. Safe in single-threaded JS but fragile. |
| P2-12 | D5 | `pagelet/commands.ts:10-24` | Legacy `preload-status` and replacement `background-preparation-status` both registered. Remove legacy or add deprecation. |
| P2-13 | D8 | `scope-recap.ts:198-247` | Reads full note content (~400KB for 40 notes). Linear scans, fine at current scale. Monitor if cap increases. |
| P2-14 | D8 | `review-queue-store.ts:329-335` | `isDuplicateItem` uses `JSON.stringify` for comparison. Negligible at <50 items, compounds with P1-P4. |
| P2-15 | D3 | `memory-governance-store.ts:160-167` | `list()` returns unfiltered records. Consider `listForContext(scopePaths)` convenience method. |
| P2-16 | D3 | `quick-capture-enrichment.ts:193` | Vault file path included in LLM prompt. Low risk given user consent. |

---

## Positive Findings

| Area | Assessment |
|------|-----------|
| **Product alignment** | 9.5/10 across all 6 PA modules. Strong adherence to North Star. |
| **Startup impact** | Zero — all PA modules deferred to Phase 3 (`onIdle`). Estimated <50ms desktop / <100ms mobile. |
| **DOM safety** | Zero innerHTML/outerHTML/style violations. Full Obsidian community compliance. |
| **Lifecycle management** | All 5 pagelet views properly clean up listeners, timers, observers, Components. |
| **CSS scoping** | 600 new CSS lines, all scoped with `pa-` prefix. No leakage. |
| **Test coverage** | 16/17 PA modules tested. Eval framework well-designed with 24 assertions. |
| **i18n** | 521 pagelet keys + 594 plugin keys, perfect en/zh parity. |
| **Error isolation** | Orchestrator wraps all PA calls in try/catch. No cascade risk. |
| **Tombstone handling** | `forget()` correctly zeroes text + source refs. Validator enforces. |
| **Maintenance safety** | Preview-only default, `permanentDelete: true` rejected, full undo metadata. |
| **Scope Recap guardrails** | `scopeRecapCanAnswerAsFact` always returns false. Generated content cannot become confirmed memory. |

---

## Verification Checklist

```bash
# 1. Build chain
make deploy

# 2. Full test suite
npm test -- --runInBand

# 3. DOM safety scan
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src

# 4. Whitespace check
git diff --check

# 5. Context firewall wiring (P0-1 fix verification)
rg -n "decideContextFirewall" src --type ts | grep -v test | grep -v __fixtures__
# Should show production call sites after fix

# 6. Helper duplication count (P1-A3)
rg -c "function normalizeVaultPath" src/pa/
```

---

## Recommended Fix Priority

1. **P0-1** (Context Firewall) — security gap, fix before merge
2. **P1-S2** (DataBoundary wildcard bypass) — security, fix before merge
3. **P1-I1** (Orchestrator mutex deadlock) — can lock core feature
4. **P1-S4** (Quiet Recall boundary re-check) — data leakage path
5. **P1-I6** (Command error swallowing) — debuggability
6. **P1-A1** (Queue state transition guard) — data integrity
7. **P1-P3** (Backlinks O(40·V)) — performance at scale
8. **P1-P4** (Unbounded queue growth) — progressive degradation
9. Remaining P1s — next iteration
