# Deep Discover Code Review Results

Date: 2026-07-31
Scope: Commits 4ae5a48, 0898540, b3cceed
Reviewers: 4 parallel agents (core runtime, infrastructure, UI integration, test coverage)

---

## Summary

| Severity | Found | Fixed (b3cceed) | Remaining |
|----------|-------|-----------------|-----------|
| Blocking | 1 | 1 | 0 |
| Important | 13 | 5 | 8 |
| Minor | 16 | 0 | 16 |

Architecture assessment: **Sound.** All proposal design decisions correctly implemented.
Key strengths: anchor freeze triple-check, evidence-based quality gate, clean concurrency model, backward-compatible PaAgentLoop changes.

---

## Fixed in b3cceed

| ID | Issue | Fix |
|----|-------|-----|
| B1 | Missing `return` after cached panel open → double agent run | Added `return` at orchestrator.ts:1921 |
| I1 | Explicit triggers blocked by rate limiter | `force` param bypasses rate limit |
| I2 | hourly=daily=36 (hourly cap redundant) | hourly set to 12 |
| I3 | Scheduler delayMs=0 (no debounce) | Set to 3000ms |
| I8 | Ephemeral AttentionAwareDeliveryStore per isSeen call | Cached instance |

---

## Remaining Important Issues (to be addressed)

| ID | Area | File:Line | Issue | Suggested fix |
|----|------|-----------|-------|---------------|
| I4 | Tools | chat-tool-factories.ts:862 | Folder-scope bypasses `isPathAllowed` check | Also check folder scopes against the predicate |
| I5 | Loop | pa-agent-loop.ts:293 | No integration test for `turnLeaseProvider` five exit paths | Add test combining lease wait + finalization reserve + timeout + abort |
| I6 | Chat | chat-service.ts:100 | Chat lease acquired before slow provider resolution | Acquire lease after runtime construction, before streamTurn |
| I7 | Tools | anchor-note-tool.ts:117 | anchor.path normalization may differ from input.path | Normalize both with same function before comparison |
| I9 | UI | orchestrator.ts:2041 | handleLeafChange dual-fires for previous+new note | Mitigated by 3s scheduler debounce; consider additional leave-note debounce if budget exhaustion observed |
| I10 | UI | orchestrator.ts:1893 | Automatic trigger doesn't pass AbortSignal | Pass signal so abandoned runs cancel LLM calls |
| I11 | UI | delivery-adapter.ts:17-28 | `sources` vs `sourceRefs` semantic coupling | Ensure both derive from same canonical source list |
| I12 | Tests | lead-driven-policy.ts | No direct unit test | Add tests for toolBudgetExhausted, wallClockReserve, finalization_exhausted |
| I13 | Tests | quality gate | No anchor-only finding test | Add test verifying single-source (anchor-only) findings are rejected |

---

## Remaining Minor Issues (low priority)

- M1: Duplicated `safeAllowed`/`normalizeLocale` utilities across 6+ files → consolidate
- M2: `evidenceTerms` regex misses 2-char tokens (AI, DB, UI)
- M3: `hashPageletContent` fallback lower collision resistance (acceptable for use case)
- M4: `toolBudgetExhausted` naming slightly misleading (soft fuse, not hard)
- M5: Controller defines own `throwIfAborted` duplicate of `chat-utils` version
- M6: PanelLayouts SVG listeners rely on implicit GC cleanup (concern only on old mobile WebView)
- M7: BubbleCoordinator hardcoded guard values in ticket content build (correct but confusing)
- M8: `runKind: "review"` semantic mismatch for Pagelet mode
- M9: Coordinator lacks `dispose()` for plugin reload cleanup

---

## Next Steps

1. Step 1 code is implementation-complete. Remaining work is dogfood validation (20+ real vault cases).
2. Remaining important issues (I4-I13) should be addressed before or during dogfood.
3. Step 2 (Operations) can start in parallel per handoff document §4.2 (no dependency on Step 1).
4. Test gaps (I5, I12, I13) should be closed to prevent regressions during future changes.
