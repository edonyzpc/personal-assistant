# PA Agent Product Spec Development Tracker

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-07-10

## Current Status

This tracker is the execution record for
[PA Agent Product Spec Development Plan](./pa-agent-product-spec-development-plan.md).
It uses [PA Product North Star](../product/pa-product-north-star.md) as the top-level
product standard.

Current state:

- M0.1-M0.6 are complete as docs-only planning gates.
- Slice 0: Raw Capture Seed is complete for M7.1-M7.3, using the defaults
  recorded below.
- Quick Capture now provides raw save only: command/modal, Daily Note default,
  Inbox/current-file settings, exact-text preservation, short feedback, no AI
  post-processing, and no Pagelet routing.
- Slice A: Thin Evidence Substrate is complete for the bounded
  M1/M2/M3/M4.0-M4.1 scope recorded below.
- Slice A added provider-free contracts, deterministic eval fixtures, Data
  Boundary settings/adapters, and a Pagelet-first Active Vault Indexer facade.
- Slice B: Review Workbench is complete for M5.0-M5.6 and M6 Pagelet-first
  scope.
- Slice C: Capture Enrichment Loop is complete for M7.4-M7.5 and routes only
  durable optional post-save suggestions into Review Queue.
- Slice D: Insight/Memory Loop is complete for M8 V1 with Saved Insight
  ledger state, memory candidate admission, read-only Memory governance shell,
  Context Firewall V1, and memory lifecycle eval fixtures.
- Slice E: Maintenance Hand is complete for M9.1-M9.7. Manual Pagelet
  Maintenance Review scans create preview/source-backed proposals, and the
  explicitly approved M9.6B move-only apply/undo path passes automated gates
  and real Obsidian test-vault smoke.
- Slice F: Weekly Compounding Loop is complete for M10 and M11.0-M11.2.
  Manual Weekly Review creates source-backed sections and accepted-only review
  notes after confirmation; Quiet Recall generates source-backed candidates in
  Pagelet Panel/Tab and can save a recall back to Saved Insights.
- Slice A2: AVI Deepening is complete for M4.2-M4.6. Activity/structure lanes,
  explicit retrieval statuses, sources-to-check plan, and text-free replay
  metadata are implemented behind the existing AVI/VSS boundary.
- Slice G: Recall Adaptation is complete for M11.3-M11.4. Quiet Recall Bubble
  nudges are disabled by default, explicit opt-in, frequency/quiet/off gated,
  route-only, and use View/Dismiss/Later local UI state. Recall feedback
  learning is opt-in, local aggregate-only, Data Boundary checked, and stores no
  raw query/path/title/source text.
- M12 Later Layers Expansion is complete for M12.1-M12.3. Retrieval Habit
  Profile is disabled by default and weak/local, Graph Discovery creates
  source-backed review items only, and Scope Recap is on-demand with confirmed
  Markdown export.
- No runtime gates remain open in this product-spec plan. Any scope beyond the
  recorded slices still requires a new explicit approval gate.

North Star reminder:

> Capture should be light. Review should be natural. Connections should have
> evidence. Maintenance should be reversible. Action should be earned.

## Status Legend

| Mark | Meaning |
| --- | --- |
| `[ ]` | Todo |
| `[D]` | Drafting / mapping |
| `[R]` | Ready for review |
| `[A]` | Approved for implementation |
| `[~]` | Implementing |
| `[V]` | Review in progress |
| `[S]` | Obsidian smoke in progress |
| `[x]` | Done |
| `[!]` | Blocked |
| `[T]` | Triggered backlog only |

## SPEC / Slice Index

| Slice | Includes | Status | Gate / notes |
| --- | --- | --- | --- |
| Slice 0: Raw Capture Seed | M0.1-M0.6, M7.1-M7.3 | `[x]` | Done for raw Quick Capture only. No AI enrichment, no Pagelet queue, no current-file destination until explicitly selected in settings. |
| Slice A: Thin Evidence Substrate | minimal M1, thin M2, M3, M4.0-M4.1 Pagelet-first | `[x]` | Done for bounded substrate implementation. No Chat main adoption, no VSS storage migration, no broad provider run, no persisted raw excerpts/provider output. |
| Slice B: Review Workbench | M5.0-M5.6, M6 Pagelet-first | `[x]` | Done. Review Queue + Source Cards and Context Pager V1 are implemented, tested, deployed, and smoke-tested in the Obsidian test vault. |
| Slice C: Capture Enrichment Loop | M7.4-M7.5 + M5 producers | `[x]` | Done. Optional Quick Capture enrichment runs after raw save, asks disclosure before provider work, routes only durable suggestions to Review Queue, and adds eval fixtures. |
| Slice D: Insight/Memory Loop | M8 + M6 | `[x]` | Done. Saved Insight ledger, memory candidate admission, read-only Memory governance shell, Context Firewall V1, and memory lifecycle eval fixtures are implemented, tested, deployed, and runtime-smoked in the Obsidian test vault. |
| Slice E: Maintenance Hand | M9 preview-only, then M9.6A/B one allowlisted action | `[x]` | Done. M9.1-M9.7 are implemented, including approved move-only apply/undo, automated gates, and real Obsidian test-vault smoke. |
| Slice F: Weekly Compounding Loop | M10 + M11.0-M11.2 | `[x]` | Done. Manual-first Weekly Review, accepted-only note write, and Pagelet Panel/Tab recall surfaces are implemented, tested, deployed, and smoke-tested. |
| Slice A2: AVI Deepening | M4.2-M4.6 | `[x]` | Done. Adds activity/structure lanes, explicit outcome statuses, sources-to-check plan, and replay metadata without private text; no Chat main adoption, VSS storage migration, provider call, queue write, or UI surface added. |
| Slice G: Recall Adaptation | M11.3-M11.4 | `[x]` | Done. Adds restrained opt-in Bubble recall plus opt-in local aggregate feedback learning; Bubble remains route-only and no automatic writes/provider telemetry were added. |
| M12 Later Layers Expansion | M12.1-M12.3 | `[x]` | Done. Retrieval Habit Profile, lightweight graph discovery, and source-backed scope recap are implemented, tested, deployed, and smoke-tested in the Obsidian test vault. |

## Task Status Table

| Task ID | Spec refs | Status | Owner / agent | Branch / commit | Validation command | Smoke evidence | Review disposition | Risks | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M0.1 | Development plan, North Star | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Self-reviewed | Drift if index not updated | Tracker created and linked from docs index. |
| M0.2 | Development plan | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Self-reviewed | Code map can stale | Codebase and test command maps recorded below. |
| M0.3 | Settings patterns | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Self-reviewed | Future setting namespace drift | Feature flag policy recorded below. |
| M0.4 | Product specs listed in plan | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Self-reviewed | Future agents reopen decisions | Product Decision Ledger recorded below. |
| M0.5 | Release slices | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Self-reviewed | Smoke gaps hide UI regressions | Smoke Matrix recorded below. |
| M0.6 | Quick Capture spec, plan stop points | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Approved | Runtime approval only covers M7.1-M7.3 defaults | Slice 0 moved through review to `[A]`. |
| M1.1 | Product IA, Pagelet Trust Layer | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | Review Queue type contract. Active producers start empty/tiny until M5/M7.4. |
| M1.2 | Active Vault Indexer, Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | SourceRef and ReplayRef contract. Persisted shape does not store excerpts/provider output. |
| M1.3 | Active Vault Indexer, Eval Harness | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | RetrievalOutcome contract adopted by Pagelet related-note adapter in M4.1. |
| M1.4 | Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | Data Boundary primitives plus M3 adapters. |
| M1.5 | Memory Type Taxonomy, Pagelet Trust Layer | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | Memory taxonomy and lifecycle contract. Existing Memory/VSS naming remains unchanged. |
| M1.6 | Context Pager | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | Context trace contract. Persisted traces use ids/counts/hashes only. |
| M1.7 | Settings copy | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Self-reviewed, approved | Closed for Slice A | Settings copy inventory updated through Data Boundary settings. |
| M2.1 | Eval Harness | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` | Not required | Self-reviewed, approved | Closed for Slice A | Eval fixture directory and schema. Synthetic data only. |
| M2.2 | Eval Harness | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required | Self-reviewed, approved | Closed for Slice A | Deterministic runner. No credentials/network/provider calls. |
| M2.3 | Eval Harness, Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required | Self-reviewed, approved | Closed for Slice A | SourceRef assertion pack. |
| M2.4 | Product IA | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required | Self-reviewed, approved | Closed for Slice A | Review Queue assertion pack rejects inactive/invalid shapes. |
| M2.5 | Memory taxonomy | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required | Self-reviewed, approved | Closed | Memory lifecycle assertion pack now covers source-backed Saved Insights, Confirmed Memory source refs, text-free tombstones, and Context Firewall decisions. |
| M2.6 | Maintenance Review | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/maintenance-review-apply.test.ts __tests__/maintenance-review.test.ts __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required | Self-reviewed, approved | Closed | Maintenance assertion pack covers preview metadata, affected paths, hard-delete rejection, merge-new-note boundary, apply-selected-only, rollback restore, and no source writes. |
| M2.7 | Eval Harness | `[x]` | Codex | master / pending | `npm run eval:pa:fast` and `git diff --check` | Not required | Self-reviewed, approved | Closed for Slice A | Eval documentation and tracker update. |
| M3.1 | Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/data-boundary.test.ts __tests__/settings.test.ts` | Settings smoke passed with live DOM readback | Self-reviewed, approved | Closed for Slice A | Data Boundary settings model. Safe defaults; no destructive cleanup. |
| M3.2 | Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/data-boundary.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | Boundary resolver. One-run overrides only. |
| M3.2A | Data Boundary, AVI | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/data-boundary.test.ts __tests__/get-vss-files.test.ts __tests__/pagelet-scope.test.ts __tests__/memory-extraction.test.ts __tests__/pa-agent-runtime-search-vss.test.ts` | Settings/Pagelet smoke passed | Self-reviewed, approved | Closed for Slice A | Boundary adapters filter VSS enumeration, Memory search/expansion, Pagelet host scope, related notes, and extraction events. |
| M3.3 | Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/data-boundary.test.ts` | Settings smoke passed | Self-reviewed, approved | Closed for Slice A | Provider disclosure policy model and settings copy; no provider modal UI added. |
| M3.4 | Data Boundary, Memory extraction | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/memory-extraction.test.ts __tests__/data-boundary.test.ts` | Not required unless UI added | Self-reviewed, approved | Closed for Slice A | Memory extraction vault-event gate skips Data Boundary denied sources. Local hash verification remains separate. |
| M3.5 | Data Boundary, settings | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/settings.test.ts __tests__/data-boundary.test.ts` plus lint/build | Settings smoke passed with live Data Boundary section readback | Self-reviewed, approved | Closed for Slice A | Data cleanup UI skeleton has disabled groups only; no deletion wired. |
| M4.0 | AVI, VSS | `[x]` | Codex | master / pending | `git diff --check` | Docs-only skip | Self-reviewed, approved | Closed for Slice A | Retrieval adapter map implemented as `ActiveVaultIndexer`; Pagelet related-notes selected as first caller. |
| M4.1 | AVI, Data Boundary, VSS | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/active-vault-indexer.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/vss.test.ts` plus lint/build | Pagelet panel smoke passed, no provider call | Self-reviewed, approved | Closed for Slice A | AVI facade wraps existing VSS; no VSS storage/queue migration and no Chat main adoption. |
| M4.2 | AVI | `[x]` | Codex | master / pending | Focused Slice A2 suite, type-check, eval, lint, build, source scan, `git diff --check` | Not required; no UI added | Self-reviewed, approved | Closed | Activity lane implemented as signal-only; score-zero activity cannot create evidence and denied/generated sources receive no activity metadata. |
| M4.3 | AVI | `[x]` | Codex | master / pending | Focused Slice A2 suite, type-check, eval, lint, build, source scan, `git diff --check` | Not required; no UI added | Self-reviewed, approved | Closed | Structure metadata implemented as tie-breaker/why-shown only; weak structure-only signals cannot outrank strong source evidence. |
| M4.4 | AVI | `[x]` | Codex | master / pending | Focused Slice A2 suite, type-check, eval, lint, build, source scan, `git diff --check` | Not required; no UI added | Self-reviewed, approved | Closed | Outcome classifier covers evidence_found, partial_evidence, conflict, no_evidence, and blocked_by_privacy. |
| M4.5 | AVI, Data Boundary | `[x]` | Codex | master / pending | Focused Slice A2 suite, type-check, eval, lint, build, source scan, `git diff --check` | Not required; no UI added | Self-reviewed, approved | Closed | Sources-to-check plan model is local; cancel/adjust do not call provider code or create queue items. |
| M4.6 | AVI, Data Boundary | `[x]` | Codex | master / pending | Focused Slice A2 suite, type-check, eval, lint, build, source scan, `git diff --check` | Not required; no UI added | Self-reviewed, approved | Closed | Replay records store source refs, hashes, reasons, and policy ids only; re-resolve current text only if Data Boundary allows it. |
| M5.0 | Product IA, Pagelet | `[x]` | Codex | master / pending | Slice B focused suite, lint, build, source scan, deploy | Bubble/Panel/Tab smoke passed | Self-reviewed, approved | Closed | Pagelet host owns queue access; Bubble stays route-only and does not surface generated `suggested` item counts. |
| M5.1 | Product IA, Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/review-queue-store.test.ts __tests__/pa-contracts.test.ts` plus Slice B focused suite | Not required beyond Slice B UI smoke | Self-reviewed, approved | Closed | Local store validates type/status/source refs and persists no raw excerpts/provider output. |
| M5.2 | Product IA, Data Boundary | `[x]` | Codex | master / pending | Review Queue store/contracts plus Pagelet orchestrator tests | Not required beyond Slice B UI smoke | Self-reviewed, approved | Closed | Producer API validates active item types and source-backed input; API itself runs no provider work. |
| M5.3 | Pagelet Trust Layer | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts` plus Slice B focused suite | Pagelet panel smoke passed | Self-reviewed, approved | Closed | Panel filters current-scope queue items. |
| M5.4 | Pagelet Trust Layer | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pagelet-panel-tab-view.test.ts` plus Slice B focused suite | Pagelet detail tab smoke passed | Self-reviewed, approved | Closed | Tab renders global queue with local status/group filters. |
| M5.5 | Pagelet Trust Layer, Data Boundary | `[x]` | Codex | master / pending | Panel/tab view tests, Review Queue store tests, eval privacy assertions | Pagelet panel/tab smoke passed | Self-reviewed, approved | Closed | Source-backed card state stores refs/claims/reasons, not hidden raw provider output. |
| M5.6 | Pagelet Trust Layer | `[x]` | Codex | master / pending | Review note save/orchestrator coverage in Slice B focused suite | Pagelet panel/tab smoke passed | Self-reviewed, approved | Closed | Saved review notes are Markdown history artifacts only; they no longer auto-create `evidence_insight` Review Queue items. |
| M6.1 | Context Pager, AVI | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/context-pager.test.ts __tests__/pa-agent-history.test.ts` plus TypeScript check | Pagelet smoke passed for visible trace | Self-reviewed, approved | Closed | Trace is read-only and persisted fields are ids/counts/reasons/hashes only. |
| M6.2 | Context Pager, Pagelet | `[x]` | Codex | master / pending | Context Pager and Pagelet panel/tab view tests plus Slice B focused suite | Panel and Tab pager DOM readback passed | Self-reviewed, approved | Closed | Collapsed and expanded product-language pager renders in Pagelet. |
| M6.3 | Context Pager, Chat | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-agent-history.test.ts __tests__/context-pager.test.ts` | Chat UI smoke not run; metadata hook only | Self-reviewed, approved | Closed with residual UI gap | Chat turn metadata stores compact trace derived from existing context-used metadata; no new visible Chat UI. |
| M6.4 | Context Pager, Eval Harness | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/context-pager.test.ts __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required beyond Pagelet UI smoke | Self-reviewed, approved | Closed | Eval fixtures assert count alignment and no private text in context trace. |
| M7.1 | Quick Capture, Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/settings.test.ts`; `npm run lint`; `npm run build`; `git diff --check`; `make deploy` | Obsidian command registered; modal DOM present; raw save wrote `- 23:31 Smoke quick capture 2026-06-28TPA-S0` to `2026-06-28.md`; empty input wrote nothing; `dev:errors` clean | Self-reviewed, approved | Closed | Raw Quick Capture command saves exact text and calls no AI provider/Pagelet route. |
| M7.2 | Quick Capture, settings | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/settings.test.ts`; `npm run lint`; `npm run build`; `git diff --check`; `make deploy` | Live settings tab readback showed Quick Capture section, `daily` destination, and `Inbox/Quick Capture.md`; destination changes covered by settings test | Self-reviewed, approved | Closed | Destination settings preserve Daily Note default; current-file requires explicit selection. |
| M7.3 | Quick Capture | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/settings.test.ts`; `npm run lint`; `npm run build`; `git diff --check`; `make deploy` | Modal text/actions present; save feedback paths covered by tests; empty input keeps modal/write state unchanged | Self-reviewed, approved | Closed | Feedback is short; no suggestions copy appears until M7.4. |
| M7.4 | Quick Capture, Data Boundary, Review Queue | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/quick-capture-enrichment.test.ts __tests__/review-queue-store.test.ts __tests__/pa-contracts.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts`; lint/build/diff/source scan/deploy | Raw-save smoke passed; disclosure cancel path unit-tested; direct smoke showed no model call before disclosure | Self-reviewed, approved | Closed with modal smoke limitation | Async post-processing is optional, disabled by default, nonblocking, disclosure-gated, and queue-only. |
| M7.5 | Quick Capture, Eval Harness | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required | Self-reviewed, approved | Closed | Quick Capture eval fixtures assert raw text unchanged, queue capture id, AI-generated separation, and no direct Memory/task writes. |
| M8.1 | Saved Insight Ledger | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/saved-insight-store.test.ts __tests__/settings.test.ts` | Not required beyond Slice D Pagelet smoke | Self-reviewed, approved | Closed | Saved Insight local store validates type/origin/status/sourceRefs, allows marked user-authored unsourced insights, and persists weak-only recall assets. |
| M8.2 | Saved Insight Ledger, Pagelet | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/saved-insight-store.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts` plus lint/build | Pagelet detail tab smoke passed with DOM/visibility readback | Self-reviewed, approved | Closed with visual screenshot limitation | Detail Tab renders Saved Insights separately from Review Queue and preserves session payload without serializing text into workspace state. |
| M8.3 | Memory taxonomy, Pagelet Trust Layer | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/memory-governance-store.test.ts __tests__/quick-capture-enrichment.test.ts __tests__/review-queue-store.test.ts` plus lint/build | Pagelet detail tab smoke passed | Self-reviewed, approved | Closed | Quick Capture memory candidates carry type/sensitivity metadata; candidates remain queue items until explicit store confirmation. |
| M8.4 | Memory taxonomy, Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/memory-governance-store.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts` plus lint/build | Pagelet detail tab smoke passed | Self-reviewed, approved | Closed for read-only shell | Memory governance store supports archive/restore/forget/export confirmation semantics; Pagelet shell shows active/forgotten records. Destructive UI controls are not exposed in this slice. |
| M8.5 | Memory taxonomy, Context Pager | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/memory-governance-store.test.ts __tests__/pa-eval.test.ts` plus lint/build | Pagelet detail tab smoke passed | Self-reviewed, approved | Closed | Context Firewall V1 drops archived/forgotten/high-sensitivity/out-of-scope records, asks for stale/task/medium, and auto-includes low-risk in-scope memory. |
| M9.1 | Maintenance Review | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts` plus focused Slice E suite | Not required beyond Slice E Pagelet smoke | Self-reviewed, approved | Closed | Maintenance proposal model includes action type, scope, sourceRefs, confidence, preview, undo metadata, hard-delete rejection, and merge-new-note guard. |
| M9.2 | Maintenance Review, Pagelet | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-commands.test.ts` plus lint/build/deploy | Pagelet detail smoke passed | Self-reviewed, approved | Closed | Manual `pa-pagelet:maintenance-review` command opens a native Pagelet detail tab; weekly scan remains disabled and no auto-apply exists. |
| M9.3 | Maintenance Review | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts` plus focused Slice E suite | Pagelet detail smoke passed | Self-reviewed, approved | Closed | Inbox/unsorted scan respects scope/Data Boundary and records source reason plus affected paths. |
| M9.4 | Maintenance Review | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts` plus focused Slice E suite | Pagelet detail smoke covered visible cards | Self-reviewed, approved | Closed | Weak-title rename proposals include old/new title and undo metadata. |
| M9.5 | Maintenance Review | `[x]` | Codex | master / pending | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts` plus focused Slice E suite | Pagelet detail smoke covered visible cards | Self-reviewed, approved | Closed | Weak-link proposals include source/target, affected source path, and preview-only action plan; no source note is modified. |
| M9.6A | Write Action Framework, Maintenance Review | `[x]` | Codex | master / pending | `git diff --check` plus tracker security notes | Docs-only boundary; M9.6B smoke tracked separately | Self-reviewed, approved for boundary only | Closed for boundary | First executable family is move-only; M9.6B implemented this approved family after user approval. |
| M9.6B | Write Action Framework, Maintenance Review | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/maintenance-review-apply.test.ts __tests__/maintenance-review.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts`; `npx tsc -noEmit -skipLibCheck --pretty false`; `npm test -- --runInBand`; `npm run lint`; `npm run build`; `npm run eval:pa:fast`; `make deploy` | Passed: live Obsidian test vault moved `Inbox/PA Maintenance Move Smoke.md` to `Notes/PA Maintenance Move Smoke.md`, then undid it and cleaned smoke state | Self-reviewed, approved | Closed | Move-only apply/undo implemented with target confinement, stale reread, Data Boundary checks, confirmation, action log, and Review Queue status updates. |
| M9.7 | Maintenance Review, Eval Harness | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/maintenance-review-apply.test.ts __tests__/maintenance-review.test.ts __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Not required | Self-reviewed, approved | Closed | Maintenance eval fixtures cover preview metadata, affected paths, hard-delete failure, merge-new-note guard, apply-selected-only, rollback restore, and no source writes. |
| M10.1 | Weekly Review | `[x]` | Codex | master / pending | Focused Slice F suite; `npx tsc -noEmit -skipLibCheck --pretty false`; full Jest; lint/build; source scan; `make deploy` | Weekly Review detail-tab smoke passed | Self-reviewed, approved | Closed | Manual `pa-pagelet:weekly-review` shell opens a restrained source-backed seven-day review. |
| M10.2 | Weekly Review | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/weekly-review.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts` plus broad gates | Weekly Review detail-tab smoke passed | Self-reviewed, approved | Closed | Sections populate from recent notes, Saved Insights, Memory queue candidates/conflicts, Maintenance proposals, and Quiet Recall candidates; unsourced/dismissed items are filtered. |
| M10.3 | Weekly Review, Data Boundary | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/weekly-review.test.ts __tests__/pagelet-panel-tab-view.test.ts`; write-action preview covered by smoke | Obsidian smoke saved accepted-only note after two confirmations | Self-reviewed, approved | Closed | Weekly Review defaults to digest reading; item selection appears only after the user chooses to save material, and the note includes generatedAt/sourceRefs, selected items only, and no full queue/provider dump. |
| M10.4 | Weekly Review, Quiet Recall | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/weekly-review.test.ts __tests__/pagelet-bubble-content.test.ts __tests__/settings.test.ts` plus broad gates | Weekly/Recall smoke passed | Self-reviewed, approved | Closed | Prepared review remains opt-in; Bubble builder returns only a hint route and is suppressed when off/quiet. No automatic weekly scan was introduced. |
| M11.0 | Quiet Recall, Pagelet | `[x]` | Codex | master / pending | `git diff --check`; Bubble/weekly tests | Docs rule recorded; Bubble recall nudge not implemented | Self-reviewed, approved | Closed | Nudge arbitration: max one Bubble nudge, route-only content, evidence/actions stay in Panel/Tab, respect off/quiet/frequency gates before M11.3. |
| M11.1 | Quiet Recall, AVI, Saved Insight | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/quiet-recall.test.ts __tests__/pagelet-orchestrator.test.ts` plus broad gates | Quiet Recall command smoke passed | Self-reviewed, approved | Closed | Passive recall uses active-note plus related-note/VSS entrypoint and active Saved Insight signals; stale/weak unrelated evidence is filtered and far association is capped below current relevance. |
| M11.2 | Quiet Recall, Pagelet | `[x]` | Codex | master / pending | `npm test -- --runInBand __tests__/quiet-recall.test.ts __tests__/pagelet-panel-tab-view.test.ts` plus broad gates | Quiet Recall Panel/Tab smoke passed | Self-reviewed, approved | Closed | Pagelet Panel/Tab show source, why-now, next action; save-as-insight writes a source-backed Saved Insight. |
| M11.3 | Quiet Recall, Pagelet Bubble | `[x]` | Codex | master / pending | Focused Slice G suite; `npx tsc -noEmit -skipLibCheck --pretty false`; full Jest; lint/build; source scan; `git diff --check`; `make deploy` | Quiet Recall Bubble smoke passed with screenshot `/private/tmp/pa-slice-g-quiet-recall-bubble.png` | Self-reviewed, approved | Closed | Bubble Recall nudge is disabled by default, explicit enablement only, quiet/off/cooldown gated, route-only, and View/Dismiss/Later make no automatic writes. |
| M11.4 | Quiet Recall, Retrieval Habit Profile | `[x]` | Codex | master / pending | Focused Slice G suite; `__tests__/retrieval-habit-profile.test.ts`; full Jest; type-check; lint/build; serialization assertions | Not required; no UI added | Self-reviewed, approved | Closed | Opt-in local aggregate feedback store records accept/view/dismiss/later/not-relevant only when enabled; Data Boundary excluded scopes do not learn; clear/disable stops collection and influence; no raw query/path/title stored. |
| M12.1 | Retrieval Habit Profile | `[x]` | Codex | master / pending | Focused M12 suite; full Jest; type-check; eval; lint/build; source scan; `make deploy` | Settings full-ui smoke passed: Local recall preferences visible, opt-in modal shown, cancel kept `enabled=false`, Clear disabled | Self-reviewed, approved | Closed | 90-day aggregate retention, explicit enable/clear controls, unsafe serialization rejection, and weak near-tie-only AVI influence implemented. |
| M12.2 | Lightweight Graph Discovery | `[x]` | Codex | master / pending | Focused M12 suite; graph discovery/review queue/contract tests; full Jest; lint/build; source scan; `make deploy` | Obsidian Pagelet smoke passed: `pa-pagelet:graph-discovery` created related/theme/conflict/index review items with sourceRefs and no graph visualization | Self-reviewed, approved | Closed | Source-backed review items only; rejected/dismissed feedback remains local/no-write; full graph UI remains out of scope. |
| M12.3 | Scope Recap and Theme Summary | `[x]` | Codex | master / pending | Focused M12 suite; scope recap/write-flow/Data Boundary tests; full Jest; lint/build; source scan; `make deploy` | Obsidian smoke passed: `pa-pagelet:scope-recap` showed source-backed recap, two-step confirmation, WAF `execute.ok`, and cleaned generated note | Self-reviewed, approved | Closed | On-demand source-backed recap and accepted-only confirmed Markdown export implemented; recap cannot become source truth/Memory by default. |

## Codebase Map

| File / module | Current role | Planned use | Risks / notes |
| --- | --- | --- | --- |
| `src/plugin.ts` | Main plugin integration, command registration, host factories, VSS/memory startup, Pagelet runtime setup. | M7 command registration and Quick Capture service entry; M3 adapters through `getVSSFiles`, Memory extraction scheduler, Pagelet host; M4 Pagelet-first retrieval adoption. | Large file. Keep future feature services isolated and wire through narrow host methods. |
| `src/settings.ts` | Top-level persisted settings, migrations, render entrypoint. Existing `targetPath` and `fileFormat` model date-based note paths. | M7 destination settings and M3 Data Boundary settings. | Avoid bloating settings with feature-specific logic; use submodules when fields grow. |
| `src/settings/pagelet/index.ts` | Pagelet settings namespace, defaults, normalizers, render section. | Pattern for future nested feature settings and copy inventory. | Settings copy must stay product-friendly and avoid VSS/RAG/chunk jargon. |
| `src/pagelet/PageletHost.ts` | Narrow host boundary for Pagelet orchestrator. | M5 queue host methods, M6 trace rendering inputs, M4 Pagelet retrieval adoption. | Do not let queue state leak directly into Panel internals. |
| `src/pagelet/orchestrator.ts` | Pagelet UI orchestration, Bubble/Panel/Tab routing, foreground/background review guards. | M5 queue routing, M6 Pagelet pager, M9/M10/M11 Pagelet modes. | Preserve `beginForegroundReviewRun()` semantics and Bubble lightweight boundary. |
| `src/pagelet/panel/*`, `src/pagelet/tab/*`, `src/pagelet/bubble/*` | Visible Pagelet surfaces and DOM/component rendering. | M5 cards/queue, M6 pager, M9 maintenance, M10 weekly, M11 recall. | UI changes require tests, scoped CSS, deploy, and real Obsidian smoke. |
| `src/pagelet/scope/*` | Scope resolution and active-file/current-range selection. | M3 scope exclusions, M4 activity lane, M5 current-scope queue. | Active-file changes can show stale items if not filtered source-first. |
| `src/pagelet/pa-review-*`, `src/pagelet/output/*` | Existing Pagelet provider model, schemas, review note generation, file I/O. | M5 adoption of current suggestions into Review Queue without changing saved review notes. | Do not persist raw provider output or prompt chunks in queue state. |
| `src/vss.ts`, `src/vss/*` | Memory/VSS facade, vector index, reconciler, maintenance state, local store. | M4 Active Vault Indexer wraps existing search results; M3 adapters filter denied sources before use. | VSS queue/exclusive lock and storage contracts must not be rewritten in M4. |
| `src/memory-manager.ts` | User-facing Memory orchestration and prepare/update approval. | M3 provider disclosure alignment, M8 Memory governance, M8.5 context firewall. | Keep user-facing Memory behavior in MemoryManager. |
| `src/ai-services/context/*` | PA Agent context manager, projector, hygiene, budget, compaction. | M6 Chat Context Pager and persisted trace boundaries. | Context is projection; do not mix with source-of-truth Memory storage. |
| `src/ai-services/memory-extraction/*` | Type A/C extraction scheduler and profile/vault insight logic. | M3.4 event gate before provider-backed candidate paths. | Excluded/generated events must not trigger provider extraction. |
| `src/ai-services/write-action-framework/*` | Append action, preview modal, stale reread, target confinement, prompt-injection tests. | M7 append raw capture, M9 one allowlisted maintenance action. | M9 source-note mutation requires explicit user approval and one action family. |
| `src/ai-services/pa-agent-runtime.ts` | Chat agent tools, MemorySearchTool, write-action runtime policy. | M3/M4/M6 Chat adoption after Pagelet-first substrate. | Do not expand Chat broad retrieval before Data Boundary and sources-to-check gates. |
| `__tests__/*` | Jest suites for Pagelet, VSS, Memory, chat, settings, write framework. | Add focused suites per task before broad validation. | New tests should be deterministic and provider-free. |

Specific current paths to preserve:

- `getVSSFiles`: `src/plugin.ts`, filters Markdown files using `settings.vssCacheExcludePath`.
- Pagelet scope filtering: `src/pagelet/scope/*` and orchestrator selection calls.
- `MemorySearchTool`: `src/ai-services/pa-agent-runtime.ts`, covered by `__tests__/pa-agent-runtime-search-vss.test.ts`.
- Pagelet host methods: `src/pagelet/PageletHost.ts` and `createPageletHost()` in `src/plugin.ts`.
- Bubble nudge coordination: `src/pagelet/BubbleCoordinator.ts` and `src/pagelet/hints/ProactiveHints.ts`.
- Write action support: `src/ai-services/write-action-framework/*`, already covering append, stale reread, target confinement, prompt injection, and runtime integration.

## Test Command Map

| Task range | Likely tests | Focused command | Broaden when |
| --- | --- | --- | --- |
| M0 docs | Markdown docs only | `git diff --check` | No broadening unless docs touch generated release files. |
| M1 shared contracts | New `__tests__/pa-contracts.test.ts` | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` | Broaden to lint/build if imports reach runtime modules. |
| M2 eval harness | New `__tests__/pa-eval.test.ts`, fixture runner | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Broaden if package scripts or fixture loaders affect build. |
| M3 Data Boundary | New `__tests__/data-boundary.test.ts`, plus settings, get-vss-files, pagelet-scope, memory-extraction, runtime search | `npm test -- --runTestsByPath __tests__/data-boundary.test.ts __tests__/get-vss-files.test.ts __tests__/pagelet-scope.test.ts __tests__/memory-extraction.test.ts __tests__/pa-agent-runtime-search-vss.test.ts` | Always run lint/build for adapters or settings UI. |
| M4 Active Vault Indexer | New `__tests__/active-vault-indexer.test.ts`, Pagelet/VSS tests | `npm test -- --runTestsByPath __tests__/active-vault-indexer.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/vss.test.ts` | Run lint/build and Pagelet smoke when visible surfaces adopt it. |
| M5 Review Queue | New queue tests, Pagelet panel/tab/bubble/card tests | `npm test -- --runTestsByPath __tests__/review-queue-store.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts` | Run lint/build, source scan, deploy, smoke for visible UI. |
| M6 Context Pager | New context pager tests, chat/pagelet tests | `npm test -- --runTestsByPath __tests__/context-pager.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/chat-view.test.ts` | Run lint/build, source scan, deploy, smoke for visible UI. |
| M7.1-M7.3 Quick Capture | New `__tests__/quick-capture.test.ts`, settings tests | `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/settings.test.ts` | Run lint/build, `git diff --check`, `make deploy`, and Obsidian smoke before UX claim. |
| M9 Maintenance Review preview/apply | `__tests__/maintenance-review-apply.test.ts`, `__tests__/maintenance-review.test.ts`, Pagelet command/orchestrator/tab tests, eval fixtures | `npm test -- --runInBand __tests__/maintenance-review-apply.test.ts __tests__/maintenance-review.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` | Run lint/build/source scan/deploy/smoke for visible Pagelet tab; after M9.6B, apply/undo smoke is required before closing Slice E. |

## Feature Flag And Settings Policy

Defaults preserve current shipped behavior until the owning runtime slice is
complete.

| Feature | Proposed persisted key | Default before implementation | Default after owning slice | Rollout notes |
| --- | --- | --- | --- | --- |
| Quick Capture raw save | `quickCapture.enabled` | `false` until M7.1-M7.3 ship | `true` after Slice 0 passes tests and smoke | Raw save only. No AI enrichment. |
| Quick Capture destination | `quickCapture.destination` | `daily` | `daily` | Options: `daily`, `inbox`, `current-file`; current-file requires explicit user selection. |
| Quick Capture inbox note | `quickCapture.inboxPath` | `Inbox/Quick Capture.md` | Same | Rolling inbox note, not one file per capture. |
| Quick Capture post-processing | `quickCapture.postProcessingEnabled`, `quickCapture.postProcessingDisclosureAccepted` | `false` | `false` by default after M7.4; user enables suggestions explicitly | First-use disclosure is required before provider work; raw save never waits for enrichment. |
| Review Queue | `reviewQueue.enabled` | `false` | `true` after M5 | Store active producer types only; after Slice E preview active producers are `evidence_insight`, `task_suggestion`, `memory_candidate`, and `maintenance_proposal`; `capture_enrichment` and Quick Capture `related_note` require a future explicit Keep UI. |
| Context Pager | `contextPager.enabled` | `false` | `true` after M6 visible adoption | Read-only trace; Pagelet pager is gated by this setting. |
| Saved Insights | `savedInsights.items` | `[]` | `[]`; populated only by explicit local store calls | Weak-only recall assets. PA-generated/recommended/imported insights require sourceRefs; user-authored insights may be unsourced and marked. |
| Memory Governance | `memoryGovernance.records`, `confirmedMemoryCount`, `memoryAutoAcceptPaused` | `[]`, `0`, `false` | Explicit at trust Levels 0-1; after 30 manual confirmations, new eligible low-sensitivity candidates auto-confirm unless paused | `ConfirmedMemoryRecord` is canonical for active/archive/stale/tombstone lifecycle. Records remain visible/removable; conflicts, task constraints, medium/high sensitivity, and historical pending candidates remain manual. |
| Maintenance Review weekly preparation | `maintenanceReview.weeklyScanEnabled`; `maintenanceReview.actionLog` | `false`; `[]` | `false`; move-only apply writes reversible action log entries after explicit confirmation | Manual scan command is available through Pagelet; weekly preparation remains disabled. Apply is limited to one selected move proposal with undo. |
| Weekly Review | `weeklyReview.enabled`, `weeklyReview.preparedReviewEnabled` | `false`, `false` | `true`, `false` after M10 manual shell passes smoke | Manual Weekly Review is available; prepared review stays opt-in and no automatic weekly scan runs. |
| Quiet Recall | `quietRecall.enabled`, `quietRecall.bubbleNudgesEnabled` | `false`, `false` | `true`, `false` after M11.1-M11.2 pass smoke | Recall Panel/Tab may ship before Bubble nudges. Bubble nudges remain disabled until M11.3. |
| Retrieval Habit Profile | `retrievalHabitProfile.enabled` | `false` | `false`; user opt-in remains required after M12.1 | Local aggregate only; clearable; weak near-tie influence only; no provider call, sync, export, note write, or raw query/path/title storage. |

## Settings Copy Inventory

| Internal concept | Product copy direction |
| --- | --- |
| VSS / vector index / embeddings | Memory from your notes; Prepare memory; Update memory |
| Review Queue | Kept for later; Actions to confirm; Saved suggestions |
| Context Pager | Sources used; Sources skipped; Memory used |
| Data Boundary | Data & Privacy Boundaries; Excluded sources |
| Provider disclosure | Note text may be sent to your configured AI provider |
| Quick Capture | Quick Capture; Saved to Daily Note; Saved to Inbox |
| Maintenance proposals | Suggested cleanup; Preview changes; Apply selected |

## Slice 0 Runtime Approval Gate

Approval status: `[A] Approved for implementation` for M7.1-M7.3 only.

Defaults:

- Command name: `PA: Quick Capture`.
- Raw Daily Note format: append a timestamped bullet. Single-line input is
  saved as `- HH:mm <original text>`. Multi-line input is saved under the same
  timestamp with a nested text block whose fence length is chosen so the exact
  original text is preserved inside the block.
- Daily Note path: use existing `settings.targetPath` and `settings.fileFormat`
  semantics, defaulting to `./YYYY-MM-DD.md`.
- Inbox destination: append to rolling note `Inbox/Quick Capture.md`.
- Current-file destination: disabled until explicitly selected in settings.
- Saved feedback: short saved confirmation, for example `Saved to Daily Note`.
- Suggestions copy appears only when AI post-processing is enabled.
- Slice 0 writes no Markdown tasks, no frontmatter, no title/tag metadata, and
  no generated expansion.
- Slice 0 does not open Pagelet Bubble/Panel/Tab and does not call any AI
  provider.

Validation commands for M7.1-M7.3:

- `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/settings.test.ts`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`
- Obsidian test-vault smoke: command palette `PA: Quick Capture`, save exact
  text, empty input writes nothing, no Pagelet auto-open, cleanup recorded.

Review result:

- Reviewer: Codex main agent, 2026-06-28.
- Result: approved for implementation.
- Blocking findings: none for docs-only gate.
- Residual risk: runtime append and UI behavior are unproven until M7.1-M7.3
  tests, deploy, and Obsidian smoke complete.

## Smoke Matrix

| Slice | User action | Expected visible behavior | Automated checks | Obsidian smoke requirement | Cleanup | Skip rule |
| --- | --- | --- | --- | --- | --- | --- |
| Slice 0 | Run `PA: Quick Capture`; submit text; submit empty input; switch destination in settings | Exact original text saved to Daily Note/Inbox/current-file policy; empty input writes nothing; short saved confirmation; no AI call; no Pagelet auto-open | Quick Capture tests, settings tests, diff check, lint/build | Required before claiming command UX works | Remove test capture lines/files from test vault or record retained artifact | Cannot skip if command/UI changed. |
| Slice A | Trigger Pagelet-first retrieval outcome on allowed and excluded/generated sources | Included/skipped sources reflect Data Boundary; no Chat adoption claimed unless implemented | Contracts, Eval, Data Boundary, AVI, Pagelet/VSS tests | Required if visible Pagelet source UI changes or settings UI changes | Restore test notes/settings | Skip only for pure contract/tasks with no UI. |
| Slice A2 | Trigger AVI deepening fixtures for activity, structure, outcomes, retrieval plan, and replay metadata | Activity/structure are reasons only; statuses are explicit; broad retrieval shows plan before provider work; replay stores no private text | AVI, Data Boundary, eval, serialization/provider-call mock tests | Required only if visible Pagelet plan/status UI is added | Clear temporary fixtures/settings; verify no provider calls/queue items from cancel/adjust | Skip UI smoke for pure model/facade changes. |
| Slice B | Open Bubble, Panel current-scope queue, Tab global queue filters | Bubble routes/counts only; Panel shows focused cards; Tab filters global queue; no raw provider output persisted | Queue, Pagelet panel/tab/bubble/card tests, source scan | Required | Clear queue state and test notes | Cannot skip visible queue UI. |
| Slice C | Save raw capture with optional enrichment enabled; force enrichment failure | Raw save succeeds; only durable suggestions route to Review Queue; lightweight title/tag/related/expansion suggestions create no review debt without an explicit Keep UI; failure does not block save | Quick Capture, Data Boundary, Review Queue, eval tests | Required | Clear queue items and capture notes | Cannot skip provider/capture UI smoke. |
| Slice D | Review saved insight and memory candidate | Source-backed insights and candidates show lifecycle; memory not confirmed until user confirms | Saved insight, memory candidate, Memory governance tests | Required for Memory/Pagelet UI | Clear local test memory/queue state | Skip only for pure model tasks. |
| Slice E | Run manual Maintenance scan; preview proposals; apply one approved action after M9.6B | Preview-only proposals first; selected low-risk action only after explicit allowlist; undo/recovery works | Maintenance, write-action, eval tests | Required | Revert or delete test-vault changes using recorded cleanup | Done for M9.6B move-only apply/undo; new action families need separate approval and smoke. |
| Slice F | Open manual weekly review | Restrained sections, source-backed items only, accepted-only note write after confirmation | Weekly Review/Pagelet tests | Required | Remove generated weekly review note | Skip only for docs-only M11.0 arbitration. |
| Slice G | Trigger recall nudge after enabled | Frequency cap respected; Bubble only hints/routes; full evidence stays in Panel/Tab; feedback learning is opt-in local aggregate only | Quiet Recall, Bubble, Retrieval Habit Profile tests, source scan | Required for M11.3 Bubble; optional for M11.4 unless UI added | Clear recall feedback/local state | Cannot skip visible Bubble smoke. |
| M12 Later Layers | Run opt-in habit/graph/recap flows after approval | Habit profile remains weak/local; graph items are reviewable source-backed items; recap is on-demand and confirmed before Markdown write | Habit profile, graph discovery, scope recap, Data Boundary, write/export tests | Completed because Pagelet graph/recap UI and Markdown export command were added | Clear local profile aggregates, graph candidates, recap notes, and queue items | Done; future graph UI, broad recap scans, telemetry, or stronger automation need a new gate. |

## Maintenance Apply Boundary M9.6A

Status: `[x]` boundary recorded and M9.6B move-only implementation smoked.

First executable family selected and implemented for M9.6B after explicit user
approval:

- `move` only.
- Scope: one selected Maintenance Review proposal at a time.
- Source: existing Markdown source note referenced by a source-backed
  `maintenance_proposal`.
- Target: a normalized Markdown path inside the same vault, never `.obsidian`,
  plugin folders, generated Pagelet folders, excluded Data Boundary folders, or
  absolute/parent-traversal paths.
- Required user approval before implementation: received in-thread on
  2026-06-29.

Required gates for M9.6B:

- Explicit user approval for the move-only action family in the current thread:
  done.
- Preview displays old path, new path, affected paths, source reason, and undo
  metadata before apply.
- Target confinement rejects absolute paths, parent traversal, excluded folders,
  generated-note folders, non-Markdown targets, and collisions unless the
  chosen UX explicitly mints a non-colliding target.
- Stale reread checks source existence/path state immediately before moving.
- Close/cancel applies nothing.
- Audit/recovery metadata records action id, old path, new path, timestamp,
  sourceRefs, and enough data to move the note back when possible.
- Prompt-injection text inside the source note cannot change action family,
  target path, scope, or confirmation text.
- Multi-file moves, merge, content patch, frontmatter/status patch,
  add/remove link, archive, index-note, and delete-candidate actions remain out
  of scope until separately approved.
- Hard delete remains unavailable.
- Automated validation and real Obsidian test-vault smoke passed for
  move-only apply/undo.

## Phase Ledger

| Slice / task | Spec review | Dev | Test | Code review | Deploy | Smoke | Fix / disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0.1-M0.6 | `[x]` Plan, North Star, Quick Capture/Data Boundary headings read | `[x]` Docs-only tracker/index | `[x]` `git diff --check` | `[x]` Self-review | Not required | Not required | No runtime changes. |
| Slice 0 M7.1-M7.3 | `[x]` Quick Capture defaults and non-goals recorded | `[x]` `src/quick-capture.ts`, command wiring, settings/locales/CSS | `[x]` Focused tests, lint, build, diff check, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Command/modal/settings/raw-save/empty-submit smoke in running Obsidian test vault | Done. Built-in `dev:screenshot` did not capture modal/settings overlays, so DOM readback is the UI evidence. |
| Slice A | `[x]` M1/M2/M3/M4 specs checked; first Pagelet caller selected | `[x]` Contracts, eval harness, Data Boundary adapters/settings, AVI facade/Pagelet adapter | `[x]` Focused Slice A suites, lint, build, eval, diff check, source scan, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Settings Data Boundary DOM readback and Pagelet panel runtime smoke in running Obsidian test vault | Done for bounded M1/M2/M3/M4.0-M4.1 scope. Computer Use timed out, so visual-window smoke relies on CLI DOM/readback evidence. |
| Slice B | `[x]` M5/M6 specs checked; Pagelet-first scope retained | `[x]` Review Queue store/API/UI, Source Cards, Context Pager model/UI/metadata/eval, setting gate | `[x]` Focused Slice B suites, eval, lint, build, TypeScript, diff check, source scan, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Running Obsidian test vault showed Bubble/Panel/Tab queue and pager DOM; final reload showed default-enabled pager DOM and `dev:errors` clean | Done for M5.0-M5.6 and M6 Pagelet-first scope. Chat visible UI remains a later surface; metadata hook is complete. |
| Slice C | `[x]` Quick Capture, Data Boundary, Review Queue, Eval specs checked | `[x]` Post-save enrichment service hook, parser/mapper, disclosure gate, active producers, Pagelet callout rendering, eval fixtures | `[x]` Focused Slice C suites, eval, lint, build, diff check, source scan, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Raw save with post-processing enabled wrote and cleaned smoke capture; direct probe showed model creation not reached before disclosure; `dev:errors` clean | Done for optional enrichment. Disclosure modal was not observable through eval smoke, so cancel/no-provider behavior is covered by unit tests. |
| Slice D | `[x]` Saved Insight, Memory taxonomy, Context Firewall specs checked | `[x]` Saved Insight store, Memory governance store, Context Firewall, Pagelet Tab ledger sections, eval fixtures | `[x]` Focused Slice D suites, eval, type-check, lint, build, diff check, source scan, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Running Obsidian test vault showed Pagelet detail ledger DOM/visibility and clean errors | Done for M8 V1 read-only governance shell. Computer Use timed out; Obsidian screenshot command was inconsistent, so UI evidence is DOM/visibility readback. |
| Slice E | `[x]` Maintenance Review product spec, Pagelet ownership, eval harness, and write-action boundary docs checked | `[x]` Preview scanner/model, Pagelet command/detail UI, Review Queue producer, settings, eval fixtures, M9.6A boundary, and M9.6B move-only apply/undo | `[x]` Focused M9.6B suite, full Jest, eval, type-check, lint, build, source scan, `make deploy` | `[x]` Self-review, no blocking findings in code path | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Obsidian test vault apply/undo smoke passed and cleaned smoke state | Done for M9.1-M9.7. New Maintenance action families remain out of scope until separately approved. |
| Slice F | `[x]` M10/M11.0-M11.2 specs checked; Bubble recall nudge kept out of scope | `[x]` Weekly Review model/command/Tab save, Quiet Recall model/Panel/Tab/save-as-insight, settings and Bubble hint guard | `[x]` Focused Slice F suite, full Jest, eval, type-check, lint, build, source scan, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Weekly Review accepted-only note write and Quiet Recall save-as-insight smoke passed in running Obsidian test vault | Done for M10 and M11.0-M11.2. M11.3/M11.4 remain unapproved. |
| Slice A2 | `[x]` M4.2-M4.6 approved on 2026-06-29 after acceptance/validation expansion | `[x]` `src/pa/active-vault-indexer.ts` plus focused tests | `[x]` Focused Slice A2 suite, eval, type-check, lint, build, source scan, diff check | `[x]` Self-review, no blocking findings | Not required | Not required; no visible UI added | Done. |
| Slice G | `[x]` M11.3-M11.4 approved by user on 2026-06-29; acceptance/validation expanded | `[x]` Bubble recall nudge and retrieval habit runtime implemented | `[x]` Focused Slice G suite, full Jest, type-check, lint/build, source scan, diff check, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Obsidian test vault showed Quiet Recall Bubble, View route, Dismiss suppression, Later snooze, clean errors, and restored smoke state | Done. |
| M12 Later Layers | `[x]` M12.1-M12.3 approved by user on 2026-06-29; acceptance/validation expanded | `[x]` Retrieval Habit Profile expansion, Graph Discovery producer/UI command, and Scope Recap preview/export implemented | `[x]` Focused M12 suites, full Jest 130 suites / 2209 tests, eval, type-check, lint/build, source scan, `make deploy` | `[x]` Self-review, no blocking findings | `[x]` `make deploy` copied built plugin to `test/` vault | `[x]` Obsidian test vault verified Graph Suggestions, Scope Recap two-step confirmed write, Settings opt-in modal/cancel, clean errors, and cleaned smoke state | Done. No graph visualization, provider telemetry, background broad scan, or unconfirmed Markdown write added. |

## Review Log

| Date | Scope | Reviewer | Result | Findings | Disposition |
| --- | --- | --- | --- | --- | --- |
| 2026-06-28 | M0.1-M0.6 docs-only gates | Codex main agent | Approved | No blocking findings. Runtime work not reviewed because no runtime code changed. | Slice 0 approved only for M7.1-M7.3 defaults. |
| 2026-06-28 | Slice 0 M7.1-M7.3 runtime | Codex main agent | Approved | No blocking findings. Scope stayed limited to Quick Capture raw save, settings, locales, CSS, tests, and tracker updates. | Slice 0 closed; stop before Slice A approval. |
| 2026-06-28 | Slice A M1/M2/M3/M4.0-M4.1 approval gate | Codex main agent | Approved | No blocking findings. Scope excludes Chat main adoption, VSS storage/queue migration, broad provider scans, hidden raw excerpt/provider-output persistence, and product-semantic/privacy/autonomy drift. | Implement in order: M1 contracts, M2 eval, M3 boundary, M4 Pagelet-first facade. M2.5/M2.6 and M4.2-M4.6 stayed outside Slice A approval. |
| 2026-06-28 | Slice A M1/M2/M3/M4.0-M4.1 runtime | Codex main agent | Approved | No blocking findings. No raw excerpt/provider output persisted in new contracts/outcomes; denied sources filtered from tested adapters; Pagelet related-notes uses AVI facade without changing VSS storage or Chat main retrieval. | Slice A closed; stop before unapproved Slice B/C/D/E/F/G work. |
| 2026-06-28 | Slice B M5/M6 runtime | Codex main agent | Approved | No blocking findings. Review Queue is shared/local and source-backed, Bubble stays route-only without exposing review details, Context Pager stores no private text or prompt chunks, and Pagelet UI uses product copy. | Slice B closed; Slice C capture enrichment is unblocked but requires its own review gate before provider-backed runtime. |
| 2026-06-28 | Slice C M7.4-M7.5 runtime | Codex main agent | Approved | No blocking findings. Raw capture remains first and unchanged; enrichment is optional and nonblocking; provider work is disclosure-gated; suggestions are Review Queue-only and generated expansion cards are visually separated. | Slice C closed; Slice D M8 memory/insight loop remains pending and should start with its own review gate. |
| 2026-06-28 | Slice D M8 runtime | Codex main agent | Approved | No blocking findings for the V1 read-only shell. Saved Insights are source-backed unless user-authored, memory candidates stay queue-only until confirmation, tombstones are text-free, and Context Firewall avoids unsafe auto-use. | Slice D closed. Destructive archive/forget/export UI controls are intentionally not exposed; store semantics and eval fixtures are in place for a future action surface. |
| 2026-06-28 | Slice E M9 preview runtime + M9.6A boundary | Codex main agent | Approved for preview scope; apply blocked | No blocking findings for preview-only scope. Maintenance proposals are source-backed, preview-only, blocked from apply, and visible in Pagelet Detail Tab. M9.6A selects move-only as first candidate family, but M9.6B is not authorized. | Preview scope closed. Stop before implementing any source-note mutation until user explicitly approves move-only apply. |
| 2026-06-29 | M9.6B move-only apply implementation | Codex main agent | Approved | No blocking findings. Move-only apply uses confirmation, target confinement, stale reread, Data Boundary checks, action log, Review Queue status update, and undo. | M9.6B/Slice E closed after Obsidian test vault apply/undo smoke. |
| 2026-06-29 | Slice F M10/M11.0-M11.2 runtime | Codex main agent | Approved | No blocking findings. Weekly Review is manual-first and accepted-only on write; Quiet Recall uses source-backed Saved Insight plus current/related-note signals, caps far association, and keeps evidence/actions in Panel/Tab. | Slice F closed after automated gates and Obsidian test-vault Weekly Review/Quiet Recall smoke. M11.3 Bubble recall nudge and M11.4 feedback learning remain unapproved. |
| 2026-06-29 | Remaining gates docs-only mapping | Codex main agent | Ready for user review | No runtime code changed. M4.2-M4.6, M11.3-M11.4, and M12.1-M12.3 now have explicit acceptance/validation and next approval gates. | Stop before runtime. User must approve exactly one gate or task before implementation starts. |
| 2026-06-29 | Slice A2 AVI Deepening runtime | User / Codex main agent | Approved | User approved `Approve Slice A2 AVI Deepening runtime`. Scope is limited to M4.2-M4.6 behind existing AVI/VSS boundaries. | Start runtime implementation; later Slice G and M12 approvals are recorded below. |
| 2026-06-29 | Slice A2 AVI Deepening runtime | Codex main agent | Approved | No blocking findings. Activity and structure are signal-only, explicit statuses are classified, sources-to-check plans are local/cancelable, and replay records store no raw text. | Slice A2 closed after focused tests, eval, type-check, lint, build, source scan, and diff check. Obsidian smoke skipped because no visible UI was added. |
| 2026-06-29 | Slice G preflight | Codex main agent | Ready for user review | No runtime code changed. Current Quiet Recall/Bubble/settings entrypoints, implementation order, non-goals, validation gates, and Obsidian smoke requirements are mapped. | Superseded by later Slice G and M12 approvals/closeouts below. |
| 2026-06-29 | M12 preflight | Codex main agent | Ready for user review | No runtime code changed. Retrieval Habit Profile, Graph Discovery, and Scope Recap specs were mapped to current AVI, Review Queue, Insight/Memory, and write-flow entrypoints with implementation order, non-goals, validation gates, and smoke requirements. | Superseded by M12 approval and closeout below. |
| 2026-06-29 | Slice G Recall Adaptation runtime | User / Codex main agent | Approved | User approved `Approve Slice G Recall Adaptation runtime`. Scope is limited to M11.3 Bubble recall nudge and M11.4 opt-in local aggregate feedback learning. | Start runtime implementation; later M12 approval is recorded below. |
| 2026-06-29 | Slice G Recall Adaptation runtime | Codex main agent | Approved | No blocking findings. Bubble recall is explicit opt-in, route-only, and lower priority than Review Queue; View routes to existing Quiet Recall Detail, while Dismiss/Later are local UI state. Feedback learning is disabled by default, Data Boundary checked, aggregate-only, and stores no raw query/path/title/source text. | Slice G closed after focused/full automated gates, `make deploy`, and Obsidian test-vault Bubble smoke. |
| 2026-06-29 | Post-Slice G state reconciliation | Codex main agent | Approved | No runtime code changed. TODO, roadmap, suggested slices, and M12 preflight were reconciled before M12 approval. | Superseded by M12 runtime approval and closeout below. |
| 2026-06-29 | M12 Later Layers runtime | User / Codex main agent | Approved | User approved `Approve M12 Later Layers runtime`. Scope is limited to M12.1-M12.3 per the expanded plan. | Start runtime implementation; no external actions, provider telemetry, full graph UI, background broad scan, or unconfirmed Markdown write. |
| 2026-06-29 | M12 Later Layers runtime | Codex main agent | Approved | No blocking findings. Retrieval Habit Profile remains disabled-by-default, local aggregate-only, clearable, and weak near-tie influence. Graph Discovery creates source-backed Review Queue items only. Scope Recap is on-demand, source-backed, not source truth, and writes Markdown only after explicit confirmation plus Write Action Framework preview. | M12 closed after focused/full automated gates, `make deploy`, and Obsidian test-vault Graph/Scope/Settings smoke with cleanup. |

## Verification Log

| Date | Scope | Command / evidence | Result | Residual risk |
| --- | --- | --- | --- | --- |
| 2026-06-28 | Pre-edit state | `git status --short`, `git diff --stat` | Clean worktree before M0 docs | None for baseline. |
| 2026-06-28 | M0 docs | `git diff --check` | Pass | No runtime behavior validated yet. |
| 2026-06-28 | Slice 0 focused tests | `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/settings.test.ts` | Pass, 2 suites / 127 tests | Unit smoke covers Inbox/current-file paths; real app smoke used Daily Note path. |
| 2026-06-28 | Slice 0 broad gates | `npm run lint`; `npm run build`; `git diff --check`; source scan for runtime style/HTML injection | Pass | `dev:console` was unavailable until debugger attachment; `dev:errors` was clean. |
| 2026-06-28 | Slice 0 deploy | `make deploy` | Pass, including repo test/lint/build and copy to `test/.obsidian/plugins/personal-assistant/` | None. |
| 2026-06-28 | Slice 0 Obsidian smoke | `obsidian plugin:reload id=personal-assistant vault=test`; `obsidian commands vault=test filter=personal-assistant`; `obsidian command id=personal-assistant:pa-quick-capture vault=test`; `obsidian eval` / `dev:dom` / `read`; `obsidian dev:errors vault=test` | Pass: plugin enabled, command registered, modal/settings DOM present, raw capture saved to `2026-06-28.md`, empty input wrote nothing, errors clean | Smoke line retained in ignored test vault daily note; built-in `dev:screenshot` did not show overlays despite DOM presence. |
| 2026-06-28 | Slice A approval gate | Plan and specs checked: North Star, Product IA, Pagelet Trust Layer, Active Vault Indexer, Data Boundary, Eval Harness, Memory Type Taxonomy, Context Pager. Tracker records boundaries, non-goals, first caller, validation commands, deferred items, and risks. | `git diff --check` passed after Slice A implementation. | Runtime evidence recorded below. |
| 2026-06-28 | Slice A focused tests | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts __tests__/pa-eval.test.ts __tests__/settings.test.ts __tests__/data-boundary.test.ts __tests__/get-vss-files.test.ts __tests__/pagelet-scope.test.ts __tests__/memory-extraction.test.ts __tests__/pa-agent-runtime-search-vss.test.ts __tests__/active-vault-indexer.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/vss.test.ts` | Pass, 11 suites / 311 tests | Full repo deploy gate also passed. |
| 2026-06-28 | Slice A gates | `npm run lint`; `npm run build`; `npm run eval:pa:fast`; `git diff --check`; source scan for runtime style/HTML injection | Pass; source scan returned no matches | None. |
| 2026-06-28 | Slice A deploy | `make deploy` | Pass, including 118 suites / 2108 tests, lint, build, and copy to `test/.obsidian/plugins/personal-assistant/` | None. |
| 2026-06-28 | Slice A Obsidian smoke | `obsidian plugin:reload id=personal-assistant vault=test`; `obsidian plugin id=personal-assistant vault=test`; `obsidian eval` settings readback; `obsidian command id=personal-assistant:pa-pagelet:open-panel vault=test`; Pagelet DOM readback; `obsidian dev:errors vault=test` | Pass: plugin enabled 2.8.4, Data Boundary settings section/control text present, six cleanup buttons disabled, Pagelet panel DOM present with current-note scope, errors clean | Computer Use timed out twice; built-in screenshot captured main workspace, not the separate settings window, so UI evidence is DOM/readback rather than visual-window inspection. |
| 2026-06-28 | Slice B focused tests | `npm test -- --runTestsByPath __tests__/review-queue-store.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-bubble-content.test.ts __tests__/context-pager.test.ts __tests__/pa-agent-history.test.ts __tests__/pa-eval.test.ts __tests__/pa-contracts.test.ts` | Pass, 8 suites / 75 tests | Full deploy gate also passed. |
| 2026-06-28 | Slice B eval/settings/type gates | `npm run eval:pa:fast`; `npm test -- --runTestsByPath __tests__/settings.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/context-pager.test.ts`; `npx tsc -noEmit -skipLibCheck` | Pass; focused settings/orchestrator/pager suite passed 3 suites / 146 tests | Chat visible UI was not added; M6.3 is metadata-only in this slice. |
| 2026-06-28 | Slice B broad gates | `npm run lint`; `npm run build`; `git diff --check`; source scan for runtime style/HTML injection | Pass; source scan returned no matches | None. |
| 2026-06-28 | Slice B deploy | `make deploy` | Pass, including 120 suites / 2125 tests, lint, build, and copy to `test/.obsidian/plugins/personal-assistant/` | None. |
| 2026-06-28 | Slice B Obsidian smoke | `obsidian plugin:reload id=personal-assistant vault=test`; injected one local Review Queue item with `obsidian eval`; opened Pagelet Panel; expanded to Detail Tab; inspected DOM; cleaned queue; final reload/open-panel after setting gate; `obsidian dev:errors vault=test` | Pass: earlier Panel and Tab DOM both showed Review Queue and Context Pager; detail tab filters rendered; injected queue cleaned back to zero; final reload showed Panel and default-enabled Context Pager DOM; errors clean | Smoke used DOM/readback evidence from running Obsidian test vault. |
| 2026-06-28 | Slice C focused tests | `npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/quick-capture-enrichment.test.ts __tests__/review-queue-store.test.ts __tests__/pa-contracts.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts` | Pass, 7 suites / 178 tests | Full deploy gate also passed. |
| 2026-06-28 | Slice C eval | `npm run eval:pa:fast` | Pass, 1 suite / 7 tests | None. |
| 2026-06-28 | Slice C broad gates | `npm run lint`; `npm run build`; `git diff --check`; source scan for runtime style/HTML injection | Pass; source scan returned no matches | None. |
| 2026-06-28 | Slice C deploy | `make deploy` | Pass, including 121 suites / 2132 tests, lint, build, and copy to `test/.obsidian/plugins/personal-assistant/` | None. |
| 2026-06-28 | Slice C Obsidian smoke | `obsidian plugin:reload id=personal-assistant vault=test`; enabled Quick Capture post-processing in settings via eval; saved smoke capture; cleaned smoke line from `2026-06-29.md`; probed direct post-processing before disclosure; `obsidian dev:errors vault=test` | Pass with limitation: raw save returned saved result and wrote the capture, cleanup succeeded, queue stayed zero, direct probe showed `createChatModel` not called before disclosure, errors clean | Disclosure modal was not visible through eval smoke; unit tests cover cancel/no-provider/no-queue behavior. |
| 2026-06-28 | Slice D focused tests | `npm test -- --runTestsByPath __tests__/saved-insight-store.test.ts __tests__/memory-governance-store.test.ts __tests__/quick-capture-enrichment.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts` | Pass, 7 suites / 192 tests | Full deploy gate also passed. |
| 2026-06-28 | Slice D eval/type gates | `npm run eval:pa:fast`; `npx tsc -noEmit -skipLibCheck --pretty false` | Pass, eval 1 suite / 8 tests; type-check clean | None. |
| 2026-06-28 | Slice D broad gates | `npm run lint`; `npm run build`; `git diff --check`; source scan for runtime style/HTML injection | Pass; source scan returned no matches | None. |
| 2026-06-28 | Slice D deploy | `make deploy` | Pass, including 123 suites / 2147 tests, lint, build, and copy to `test/.obsidian/plugins/personal-assistant/` | None. |
| 2026-06-28 | Slice D Obsidian smoke | `obsidian plugin:reload id=personal-assistant vault=test`; injected one Saved Insight, one active Memory, and one forgotten tombstone into test-vault settings; opened `pagelet-smoke-golden.md`; opened Pagelet panel; clicked `Expand to tab`; inspected `.pa-pagelet-tab-saved-insights`, `.pa-pagelet-tab-memory-governance`, DOM text, visibility metrics; cleaned injected records; `obsidian dev:errors vault=test` | Pass with limitation: live DOM showed Saved Insights, active Memory, and forgotten marker without original memory text; visibility metrics showed `.pa-pagelet-tab` visible; injected records cleaned; errors clean | Computer Use timed out after 300s and `dev:screenshot` was inconsistent/blank for the active tab, so visual-window inspection is blocked and CLI DOM/visibility readback is the smoke evidence. |
| 2026-06-28 | Slice E focused tests | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-commands.test.ts __tests__/pa-contracts.test.ts __tests__/review-queue-store.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts` | Pass, 8 suites / 203 tests | Full deploy gate also passed. |
| 2026-06-28 | Slice E eval/type/broad gates | `npm run eval:pa:fast`; `npx tsc -noEmit -skipLibCheck --pretty false`; `npm run lint`; `npm run build`; `git diff --check`; source scan for runtime style/HTML injection | Pass; eval 1 suite / 9 tests; source scan returned no matches | None for preview scope. |
| 2026-06-28 | Slice E deploy | `make deploy` | Pass, including 124 suites / 2157 tests, lint, build, and copy to `test/.obsidian/plugins/personal-assistant/` | None. |
| 2026-06-28 | Slice E Obsidian smoke | `obsidian plugin:reload id=personal-assistant vault=test`; created temporary `Inbox/Maintenance Smoke Untitled.md` and `Projects/Maintenance Smoke Target.md`; ran `personal-assistant:pa-pagelet:maintenance-review`; inspected Pagelet detail leaf and `.pa-pagelet-tab-maintenance-review`; inspected local maintenance queue; cleaned 24 maintenance proposals and temp notes; `obsidian dev:errors vault=test` | Pass: detail leaf had one maintenance section, summary showed 24 preview-only suggestions, `Preview only`, `Weekly scan is off`, category counts, affected paths, and no errors; queue cleanup returned count to zero; temp notes removed | Smoke used CLI DOM/readback evidence from the running Obsidian test vault. No apply behavior exists or was tested. |
| 2026-06-29 | M9.6B focused tests | `npm test -- --runInBand __tests__/maintenance-review-apply.test.ts __tests__/maintenance-review.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts`; `npx tsc -noEmit -skipLibCheck --pretty false` | Pass: 5 suites / 170 tests; type-check clean | Focused tests cover move-only apply/undo boundaries and Tab action state, not live Obsidian UI. |
| 2026-06-29 | M9.6B broad gates | `npm run eval:pa:fast`; `npm run lint`; `npm run build`; source scan for runtime style/HTML injection; `npm test -- --runInBand`; `make deploy` | Pass: eval 1 suite / 9 tests; source scan returned no matches; full Jest 125 suites / 2163 tests; deploy copied built plugin to `test/.obsidian/plugins/personal-assistant/` | None for automated gates. |
| 2026-06-29 | M9.6B Obsidian apply/undo smoke | Launched Obsidian outside sandbox; `obsidian vaults verbose`; `obsidian plugin:reload id=personal-assistant vault=test`; opened `Inbox/PA Maintenance Move Smoke.md`; ran `personal-assistant:pa-pagelet:maintenance-review`; clicked live `.pa-pagelet-tab-maintenance-apply`; captured modal DOM/screenshot; confirmed move; verified old path false/new path true, action log `applied`, queue status `applied`, UI `Undo move`/`Moved`; clicked undo; confirmed modal; verified old path true/new path false, action log `undone`, queue status `undone`, UI `Move undone`; `obsidian dev:errors vault=test`; cleaned smoke queue/action log and temp files | Pass: move-only apply and undo worked in the real Obsidian test vault; confirmation modals named old/new paths; `dev:errors` clean; cleanup verified no smoke file, queue, or action-log residue | Screenshot artifacts: `/private/tmp/pa-m9-6b-confirm-modal.png`, `/private/tmp/pa-m9-6b-after-apply.png`, `/private/tmp/pa-m9-6b-undo-modal.png`. |
| 2026-06-29 | Slice F focused tests | `npm test -- --runInBand __tests__/weekly-review.test.ts __tests__/quiet-recall.test.ts __tests__/pagelet-commands.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-bubble-content.test.ts __tests__/settings.test.ts`; `npx tsc -noEmit -skipLibCheck --pretty false` | Pass: focused suite 7 suites / 197 tests; type-check clean | Focused tests cover Weekly Review range/sections/digest-first selection mode/accepted-only note, Quiet Recall ranking/filter/save input, Pagelet command/orchestrator/Panel/Tab UI, Bubble hint guard, and settings defaults. |
| 2026-06-29 | Slice F broad gates | `npm test -- --runInBand`; `npm run eval:pa:fast`; `npm run lint`; `npm run build`; source scan for runtime style/HTML injection; `npm run tailwind:build`; `make deploy` | Pass: full Jest 127 suites / 2178 tests; eval 1 suite / 9 tests; lint/build/source scan clean; deploy copied built plugin to `test/.obsidian/plugins/personal-assistant/` | None for automated gates. |
| 2026-06-29 | Slice F Obsidian Weekly/Recall smoke | `obsidian plugin:reload id=personal-assistant vault=test`; created `Notes/PA Slice F Smoke.md`; injected one source-backed Saved Insight; ran `personal-assistant:pa-pagelet:weekly-review`; checked `.pa-pagelet-tab-weekly-review`, marker item, and then-current save selection controls; accepted one item; confirmed Weekly Review modal and Pagelet write-action preview modal; verified `.pagelet/pagelet-weekly-review-2026-06-29.md` contained only the accepted item, generatedAt, and source ref; ran `personal-assistant:pa-pagelet:quiet-recall`; checked `.pa-pagelet-tab-quiet-recall`, source, why-now, next action; clicked save-as-insight; verified new source-backed Saved Insight; `obsidian dev:errors vault=test`; cleaned injected insights, queue items, generated note, and temp file | Pass: Weekly Review note write and Quiet Recall save-as-insight worked in the real Obsidian test vault; `dev:errors` clean; cleanup verified no marker, queue, generated note, or temp-file residue. Current regression tests now assert digest-first default before selection controls. | Smoke used CLI DOM/readback evidence from the running Obsidian test vault. |
| 2026-06-29 | M12 focused and broad gates | M12.1 focused suite passed 4 suites / 151 tests; M12.2 focused suite passed 6 suites / 75 tests; M12.3 focused suite passed 6 suites / 85 tests; combined M12 suite passed 12 suites / 248 tests; `npx tsc -noEmit -skipLibCheck --pretty false`; `npm run eval:pa:fast`; source scan returned no matches; `npm test -- --runInBand`; `npm run lint`; `npm run build` | Pass: full Jest 130 suites / 2209 tests, eval 1 suite / 9 tests, type-check/lint/build/source scan clean | None for automated gates. |
| 2026-06-29 | M12 deploy | `make deploy` | Pass: ran full Jest 130 suites / 2209 tests, lint, build, and copied `dist/main.js`, manifests, and `styles.css` to `test/.obsidian/plugins/personal-assistant/` | None. |
| 2026-06-29 | M12 Obsidian Graph/Scope/Settings smoke | `obsidian plugin:reload id=personal-assistant vault=test`; created temporary `Notes/m12-smoke/*` notes; ran `personal-assistant:pa-pagelet:graph-discovery`; inspected `.pa-pagelet-tab` text and Review Queue items; ran `personal-assistant:pa-pagelet:scope-recap`; inspected source-backed recap preview; clicked save and verified first modal plus Write Action Framework preview before write; confirmed final write and observed `gate.confirmation.received`, `gate.stale-reread.ok`, and `execute.ok`; opened Settings with Computer Use and observed Local recall opt-in modal/cancel; `obsidian dev:errors vault=test`; cleaned generated recap note, temporary notes, and 7 smoke queue items | Pass: graph items included related/theme/conflict/index families with sourceRefs; recap had 3/3 coverage and source refs; no write occurred before confirmation; settings cancel kept `retrievalHabitProfile.enabled=false`; `dev:errors` clean | Obsidian dev screenshot captured the main window instead of the separate Settings window, so Settings visual evidence comes from Computer Use accessibility tree/screenshot. |

## Risk Table

| Risk | Owner | Status | Closure condition |
| --- | --- | --- | --- |
| R1: Broad plan tempts large unreviewed implementation | Codex | Open | Work proceeds only by approved slice/task. |
| R2: Data Boundary becomes paper-only | Codex for Slice A | Closed for Slice A | M3.2A adapters adopted at VSS source enumeration, Memory search/expansion, Pagelet scope/related notes, and extraction events with tests. |
| R3: Raw note excerpts leak into persisted replay/queue/context | Codex for M1/M5/M6 | Closed for Slice B | Contract/store/eval tests reject raw text in persisted models; Context Pager stores ids/counts/reasons/hashes only. |
| R4: Quick Capture mutates or structures user thought too early | Codex for M7 | Closed for Slice C | Tests and Obsidian smoke prove exact raw save remains first; enrichment is optional, nonblocking, queue-only, and no direct Memory/task write. |
| R5: Bubble becomes a heavy review surface | Codex for M5/M11 | Closed for Slice F | Bubble tests prove Review Queue Bubble reminders are limited to user-kept/later items, Weekly Review uses hint/route-only content, and evidence/actions stay in Panel/Tab. |
| R6: Maintenance apply scope expands silently | Codex for M9 | Closed for M9 | M9.6B implements and smokes only the approved move action; any new action family requires separate approval. |
| R7: Provider disclosure becomes invisible for capture enrichment | Codex for M7.4 | Watch | Unit tests prove cancel prevents model/queue; eval smoke could not observe the modal, so future UI smoke should verify the modal through a visual/browser path before broadening capture enrichment. |
| R8: Memory lifecycle actions appear destructive before UI proof | Codex for M8 | Closed for Slice D | Store semantics and eval fixtures are implemented, but archive/forget/export controls are not exposed in UI; future action UI must add confirmation smoke before enabling. |
| R9: Maintenance preview appears executable before trust is earned | Codex for M9 | Closed for M9 | Apply controls appear only for approved move proposals, with confirmation and undo verified in the Obsidian test vault. |
| R10: Weekly Review dumps unaccepted or unsourced content | Codex for M10 | Closed for Slice F | Model and smoke prove the generated weekly note includes only accepted source-backed items with generatedAt and sourceRefs. |

## M11.0 Nudge Arbitration Rule

Before any M11.3 Bubble recall nudge work, Pagelet nudges must follow this
priority and surface boundary:

- At most one top Bubble nudge may appear at a time; otherwise combine into a
  compact count/hint digest.
- Priority order is async-ready/prepared result, user-kept/later Review Queue
  reminder, Weekly Review prepared hint, Quiet Recall hint, then other
  proactive hints.
- Bubble content may show only 2-3 short why-shown/count items and a route
  action. Evidence, source lists, accept/save/apply actions, and generated
  review sections stay in Panel/Tab.
- Off settings, quiet hours, cooldown/frequency gates, and explicit
  `quietRecall.bubbleNudgesEnabled=false` suppress recall Bubble output.

## Next Approval Gates

Closed gates are retained here for evidence. Gates still marked `[R]` are mapped
so the next approval can be precise.

| Gate | Status | Includes | Implementation boundary | Required closeout |
| --- | --- | --- | --- | --- |
| Slice A2: AVI Deepening | `[x]` | M4.2-M4.6 | Closed. Activity/structure lanes, explicit retrieval statuses, sources-to-check plan, and text-free replay metadata are implemented behind existing VSS/AVI boundaries. No Chat main adoption, VSS storage migration, broad provider run, persisted raw text, or visible UI surface. | Focused AVI/Data Boundary/eval tests, type-check, lint/build, source scan, and `git diff --check` passed. Obsidian smoke skipped because no visible Pagelet plan/status UI was added. |
| Slice G: Recall Adaptation | `[x]` | M11.3-M11.4 | Closed. Disabled-by-default Bubble recall nudge and opt-in local aggregate feedback learning are implemented. Bubble remains route-only; Panel/Tab own evidence/actions; no automatic writes. | Focused Quiet Recall/Bubble/Habit tests, source scan, lint/build, `make deploy`, and Obsidian Bubble smoke passed. |
| M12 Later Layers Expansion | `[x]` | M12.1-M12.3 | Closed. Adds opt-in weak Retrieval Habit Profile, reviewable graph discovery items, and on-demand source-backed scope recap. No user-facing graph visualization, provider telemetry, background broad scan, or unconfirmed Markdown write. | Focused M12 tests, full Jest, eval, type-check, lint/build, source scan, `make deploy`, and Obsidian Graph/Scope/Settings smoke passed. |

There are no open runtime gates in this product-spec plan. New scope should be
added as a new approval gate before implementation.

## Slice G Preflight

Status: `[x]` closed by Slice G runtime implementation.

Pre-implementation source map:

- `src/pa/quiet-recall.ts`: M11.1/M11.2 candidate generation, source-backed
  candidate model, and save-as-insight mapping. It has no Bubble state or
  feedback-learning store.
- `src/pagelet/bubble/BubbleContent.ts`: existing nudge builders for generic,
  kept/later Review Queue reminders, and Weekly Review Bubble content. It
  enforces route-only behavior for existing nudges.
- `src/pagelet/BubbleCoordinator.ts`: Pet-click and pending-hint Bubble routing.
  It currently shows prepared findings, user-kept/later Review Queue reminders,
  or regular quick-access content; it does not run Quiet Recall.
- `src/pagelet/orchestrator.ts`: manual `runQuietRecall()` opens the Detail Tab
  with full evidence/actions and has a no-op `handleBubbleDismiss()` hook.
- `src/settings.ts`: `quietRecall.enabled` defaults `true`;
  `quietRecall.bubbleNudgesEnabled` defaults `false`.
- Existing tests: `__tests__/quiet-recall.test.ts`,
  `__tests__/pagelet-bubble-content.test.ts`,
  `__tests__/pagelet-orchestrator.test.ts`,
  `__tests__/pagelet-panel-tab-view.test.ts`, and `__tests__/settings.test.ts`.

Implementation order used:

1. M11.3 Bubble nudge builder: add a pure
   `buildQuietRecallNudgeContent()` that takes already-prepared candidate
   summary state and returns View/Dismiss/Later actions. Findings must be a
   single why-now/route hint, never source cards or save actions.
2. M11.3 runtime arbitration: add a local candidate source that respects
   `pagelet.enabled`, `proactiveHints`, quiet hours, cooldown/frequency, and
   `quietRecall.bubbleNudgesEnabled`. View opens the existing Quiet Recall
   Detail Tab/Panel path. Dismiss and Later only update local suppression state.
3. M11.4 feedback model: add an opt-in local aggregate profile/store for
   accept/view/dismiss/not-relevant signals. Disabled mode records nothing.
4. M11.4 influence hook: use aggregate feedback only as weak local ranking input
   for future recall suggestions, behind Data Boundary checks and without raw
   query/path/title storage.

Non-goals:

- No automatic vault writes, Memory writes, Saved Insight creation, queue item
  creation, or provider telemetry from Bubble View/Dismiss/Later.
- No Bubble evidence cards, source lists, generated review sections, or
  save/apply actions.
- No change to Chat main retrieval.
- No raw query, raw path, title, excerpt, prompt, provider output, or source
  note text in feedback storage.

Validation completed:

- `npm test -- --runTestsByPath __tests__/quiet-recall.test.ts __tests__/pagelet-bubble-content.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts`
- Add `__tests__/retrieval-habit-profile.test.ts` before closing M11.4.
- `npx tsc -noEmit -skipLibCheck --pretty false`
- `npm run eval:pa:fast`
- `npm run lint`
- `npm run build`
- Source scan:
  `rg -n "createElement\\([\"']style[\"']\\)|\\.innerHTML\\s*=|\\.outerHTML\\s*=" src`
- `git diff --check`
- `make deploy`
- Obsidian smoke for M11.3: enable `quietRecall.bubbleNudgesEnabled` in the
  test vault, seed one source-backed recall candidate, trigger the Bubble, prove
  View routes to the Quiet Recall Detail Tab/Panel, Dismiss suppresses repeat,
  Later snoozes without writes, `dev:errors` is clean, and local suppression
  state is cleaned.

## M12 Completion Closeout

Status: `[x]` closed after user approval on 2026-06-29.

Implemented source map:

- `src/pa/retrieval-habit-profile.ts`: expanded to 90-day aggregate retention,
  explicit enable/clear controls, unsafe persisted-shape rejection, generic
  signal recording, and weak near-tie-only influence.
- `src/pa/active-vault-indexer.ts`: accepts Retrieval Habit Profile settings and
  applies the profile only as a weak evidence-capped tie-breaker.
- `src/settings.ts`: adds the Local recall preferences settings section with an
  explicit opt-in confirmation and clear action.
- `src/pa/graph-discovery.ts`: adds local deterministic graph discovery items
  for `related_note`, `theme_chain`, `conflict_pair`, and
  `index_note_candidate`; feedback is local and no-write.
- `src/pa/contracts/review-queue.ts`: activates the later-layer graph producer
  item types.
- `src/pa/scope-recap.ts`: adds on-demand, source-backed scope recap with
  coverage, stale status, skipped source counts, and accepted-only Markdown
  export helpers.
- `src/plugin.ts` and `src/pagelet/*`: add Pagelet commands for Graph Discovery
  and Scope Recap, route recap Markdown writes through confirmation and the
  existing write flow, and expose no full graph UI.

Non-goals preserved:

- No full-vault Knowledge Map, graph browser, ontology editor, or recursive
  graph expansion.
- No background whole-vault recap scan.
- No provider telemetry, sync, export, or note write from Retrieval Habit
  Profile.
- No automatic link creation, index note creation, Memory confirmation, Saved
  Insight creation, or Markdown recap write.
- No answering factual questions from recap alone.
- No strong rerank from unconfirmed graph edges or habit signals.

Validation completed:

- M12.1 focused: `npm test -- --runTestsByPath
  __tests__/retrieval-habit-profile.test.ts __tests__/active-vault-indexer.test.ts
  __tests__/data-boundary.test.ts __tests__/settings.test.ts --runInBand`
  passed 4 suites / 151 tests.
- M12.2 focused: `npm test -- --runTestsByPath
  __tests__/graph-discovery.test.ts __tests__/review-queue-store.test.ts
  __tests__/pa-contracts.test.ts __tests__/pagelet-commands.test.ts
  __tests__/pagelet-orchestrator.test.ts __tests__/pa-locales-pagelet.test.ts
  --runInBand` passed 6 suites / 75 tests.
- M12.3 focused: `npm test -- --runTestsByPath
  __tests__/scope-recap.test.ts __tests__/pagelet-commands.test.ts
  __tests__/pagelet-orchestrator.test.ts
  __tests__/pagelet-review-note-save-flow.test.ts
  __tests__/data-boundary.test.ts __tests__/pa-locales-pagelet.test.ts
  --runInBand` passed 6 suites / 85 tests.
- Combined M12 focused suite passed 12 suites / 248 tests.
- `npx tsc -noEmit -skipLibCheck --pretty false`, `npm run eval:pa:fast`,
  `npm test -- --runInBand`, `npm run lint`, `npm run build`, source scan, and
  `make deploy` passed.
- Obsidian smoke passed in the running `test/` vault: Graph Discovery created
  source-backed review items; Scope Recap showed a source-backed preview,
  required both recap confirmation and Write Action Framework preview before
  writing, then produced `gate.confirmation.received`,
  `gate.stale-reread.ok`, and `execute.ok`; Settings showed the Local recall
  opt-in modal and cancel kept `retrievalHabitProfile.enabled=false`.

### M12 Completion Audit

| Task | Requirement | Closeout evidence | Disposition |
| --- | --- | --- | --- |
| M12.1 | Disabled-by-default local aggregate profile | Settings default remains `retrievalHabitProfile.enabled=false`; live Settings opt-in modal was observed and cancel preserved disabled state. | Closed. |
| M12.1 | 90-day rolling aggregate and decay | Store prunes aggregates older than 90 days; focused tests cover retention. | Closed. |
| M12.1 | No raw query/path/title/sensitive labels | Serialization tests reject raw query, path, title, excerpt, prompt/provider output, and sensitive-shaped fields. | Closed. |
| M12.1 | Weak influence cannot cross explicit scope, Data Boundary, Context Firewall, or evidence strength | Ranking tests and AVI tests prove RHP only breaks near-ties and cannot cross evidence strength or denied scopes. | Closed. |
| M12.2 | Reviewable graph discovery items for `related_note`, `theme_chain`, `conflict_pair`, `index_note_candidate` | Graph discovery tests and Obsidian smoke produced all four source-backed Review Queue item families. | Closed. |
| M12.2 | Rejected/dismissed edges remain local and do not write notes, Memory, Saved Insights, or telemetry | Feedback tests prove local-only status updates and no vault/Memory/Saved Insight/telemetry calls. | Closed. |
| M12.2 | No full graph visualization MVP | Pagelet smoke showed a Review Queue detail surface only; no graph visualization was added. | Closed. |
| M12.3 | On-demand, scope-bounded recap with claim-level source refs, coverage, stale/low-evidence state, and generatedAt | Scope Recap tests and smoke showed generatedAt, 3/3 coverage, stale status, sections, and sourceRefs. | Closed. |
| M12.3 | Generated recap is not source truth and cannot become Memory/Saved Insight by default | Tests prove recap cannot answer as fact or become Confirmed Memory; no Saved Insight path is exposed by default. | Closed. |
| M12.3 | Markdown export requires confirmation and accepted-only content | Scope Recap export goes through recap confirmation plus Write Action Framework preview; smoke verified no write before confirmation and `execute.ok` only after final approval. | Closed. |

## Open Decisions

| Decision | Current default | Requires user approval before runtime? | Affected tasks |
| --- | --- | --- | --- |
| Slice 0 command name | `PA: Quick Capture` | No, unless changed | M7.1 |
| Raw Daily Note format | Timestamped bullet; fenced nested block for multi-line exact text | No, unless changed | M7.1 |
| Inbox destination | Append to `Inbox/Quick Capture.md` | No, unless changed | M7.2 |
| Current-file destination | Disabled until explicitly selected in settings | No | M7.2 |
| AI enrichment | Disabled by default; user can enable post-save suggestions | Yes for rewrite/replacement, direct Memory/task write, or broader provider-backed scope | M7.4, M7.5 |
| Slice A first AVI caller | Pagelet related-notes/Panel path | No, unless changed to Chat main retrieval or broader provider-backed flow | M4.0/M4.1 |
| First Maintenance apply action | Move-only is selected, implemented, and smoked after approval | No for this action family; yes for any additional action family | M9.6A/M9.6B |
| Weekly Review prepared mode | Manual Weekly Review enabled; prepared review disabled by default | Yes for automatic scheduled scans or intrusive reminders | M10.4 |
| Quiet Recall Bubble | Panel/Tab recall enabled; Bubble recall disabled by default | Yes before enabling Bubble recall nudges or feedback learning | M11.0-M11.4 |
| M12 work | Completed for the approved M12.1-M12.3 boundary on 2026-06-29 | Yes before any scope beyond Retrieval Habit Profile, lightweight graph discovery, and source-backed scope recap | M12 |

## Product Decision Ledger

| ID | Decision | Rationale | Affected specs / tasks | Amendment rule |
| --- | --- | --- | --- | --- |
| PD-001 | PA is quieter thinking infrastructure, not a more proactive ChatGPT clone. | Aligns to North Star: less interruption, more return. | All slices | User approval required for autonomy/proactivity changes. |
| PD-002 | Do not introduce `Project` as a required primitive for Obsidian vaults. | Obsidian vaults are folder/tag/link/native-note centered. | M4, M8, M10, M12 | User approval required to add required project setup. |
| PD-003 | Quick Capture is a PA-level command/service; raw text saves first. | Capture must be light and preserve original thought. | M7 | User approval required to make AI enrichment foreground or blocking. |
| PD-004 | AI enrichment is later and visually separated. | Protects original capture and trust. | M7.4, M7.5 | User approval required for rewrite/replacement behavior. |
| PD-005 | Maintenance is global vault-care surfaced through Pagelet review surfaces; manual trigger first. | Maintenance should be reversible and review-first. | M9, M10 | User approval required before any source-note mutation. |
| PD-006 | Evidence Cards and Memory Cards may share card family, but lifecycle and item type stay explicit. `ConfirmedMemoryRecord` is canonical; Review Queue is workflow/audit only. After 30 manual confirmations, new eligible Memory candidates may be auto-confirmed, remain visible/removable, and can be paused without decrementing trust. | Prevents Memory from becoming hidden queue state while implementing earned, reversible trust. | M5, M8, D6 | Approved by user on 2026-07-10. Any lower threshold, historical sweep, conflict/task-constraint auto-confirm, or less reversible behavior requires new approval. |
| PD-007 | Bubble is only lightweight count/nudge/route. Panel and Tab own evidence and decisions. | Keeps interruption low and review surfaces capable. | M5, M10, M11 | User approval required for full-card Bubble review. |
| PD-008 | Scope answers where this applies; action type answers what PA may do. | Autonomy must combine both dimensions. | M3, M4, M9 | Approval required for new autonomy or write scope. |
| PD-009 | Default relevance sorting favors current context; far-association bonus is limited. | Old thoughts should return naturally but not override evidence. | M4, M11, M12 | Approval required for broad proactive recall changes. |
| PD-010 | External actions are out of scope; vault actions are review-first and allowlisted. | Protects user trust and write boundary. | M9, operations docs | Approval required for external actions. |
| PD-011 | User confirmation should be minimized for low-risk review actions, but source-note mutation, broad/sensitive provider scans, and new autonomy require gates. | Balances low friction with earned trust. | M3, M5, M9, M10, M11 | Approval required for broad/sensitive scans or autonomy. |

## Deferred Items / TODO

| Item | Reason | Unblock condition |
| --- | --- | --- |
| M7.4 AI enrichment | Completed as optional post-save suggestions only. | Future work may add accepted write actions or richer related-note context after a separate review gate. |
| M2.5 Memory lifecycle assertion pack | Completed in Slice D. | Closed by `memory-governance-pass` and `memory-tombstone-leak` eval fixtures. |
| M2.6 Maintenance assertion pack | Completed for preview/apply/rollback boundary assertions in Slice E. | Closed by maintenance eval fixtures and focused tests. |
| M4.2-M4.6 additional AVI lanes/replay | Completed in Slice A2. | Closed by focused Slice A2 tests and broader validation gates. |
| Chat main retrieval adoption | Active Vault Indexer spec says Pagelet first, Chat later. | Pagelet adoption proves sourceRefs/outcomes/exclusions and a later slice is approved. |
| M9.6B Maintenance apply smoke | Completed for move-only apply/undo. | Closed by Obsidian test-vault smoke and cleanup verification. |
| M11.3 Bubble recall nudge | Completed in Slice G. | Closed by focused tests, full gates, `make deploy`, and Obsidian Bubble smoke. |
| M12 tasks | Completed for M12.1-M12.3 after user approval on 2026-06-29. | Any future scope beyond Retrieval Habit Profile, lightweight graph discovery, and source-backed scope recap requires a new explicit approval gate. |

## Validation Log

| Date | Task / slice | Acceptance evidence | Validation evidence | Smoke evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-06-28 | M0.1 | Tracker contains every task ID and release slice; links plan and North Star; docs index update included. | `git diff --check` passed. | Docs-only skip. | Runtime gate text included. |
| 2026-06-28 | M0.2 | Codebase map and test command map recorded. | `git diff --check` passed. | Docs-only skip. | No runtime files changed. |
| 2026-06-28 | M0.3 | Feature flag names, defaults, rollout order recorded. | `git diff --check` passed. | Docs-only skip. | Defaults preserve current behavior until implementation. |
| 2026-06-28 | M0.4 | Product Decision Ledger recorded with affected tasks and amendment rules. | `git diff --check` passed. | Docs-only skip. | Stop points retained. |
| 2026-06-28 | M0.5 | Smoke Matrix covers required visible slices and cleanup. | `git diff --check` passed. | Docs-only skip. | Runtime smoke still required for M7. |
| 2026-06-28 | M0.6 | Slice 0 defaults, validation commands, smoke entry, reviewer, and result recorded. | `git diff --check` passed. | Docs-only skip. | M7.1-M7.3 may start. |
| 2026-06-28 | M7.1 | `PA: Quick Capture` command registered; raw Daily Note save preserves exact single-line and multiline text; protected paths rejected; no provider/Pagelet imports or calls. | Focused tests, lint, build, `git diff --check`, source scan, and `make deploy` passed. | Running Obsidian test vault saved `- 23:31 Smoke quick capture 2026-06-28TPA-S0` to `2026-06-28.md`; empty input wrote nothing; `dev:errors` clean. | Smoke line retained in ignored test vault daily note; no tracked artifact. |
| 2026-06-28 | M7.2 | Settings merge/defaults render Quick Capture enabled, Daily Note destination, Inbox path, and explicit current-file option. | Focused settings test passed; lint/build/diff/deploy passed. | Live Personal Assistant settings tab readback showed Quick Capture copy, `daily` dropdown value, and `Inbox/Quick Capture.md`. | Settings overlay was verified by `app.setting` readback because `dev:screenshot` captured only the main workspace. |
| 2026-06-28 | M7.3 | Modal has Save/Cancel controls; empty input writes nothing; saved feedback remains short and non-interruptive. | Focused tests passed; lint/build/diff/deploy passed. | Live modal DOM showed placeholder and actions; empty save kept daily note unchanged; `dev:errors` clean. | AI suggestions remain disabled until M7.4. |
| 2026-06-28 | M7.4 | Optional post-processing runs only after raw save; first-use disclosure is required before model invocation; Data Boundary denied targets skip provider work; only durable parsed suggestions become Review Queue items with capture provenance; lightweight title/tag/related/expansion suggestions require a future explicit Keep UI. | Focused Slice C suite passed; lint/build/diff/source scan passed; `make deploy` passed with 121 suites / 2132 tests. | Running Obsidian test vault saved a smoke capture with post-processing enabled, then cleaned `2026-06-29.md`; direct probe showed `createChatModel` was not called before disclosure and queue stayed zero; `dev:errors` clean. | Disclosure modal was not observable through eval smoke, so cancel/no-provider/no-queue behavior is covered by unit tests. |
| 2026-06-28 | M7.5 | Quick Capture eval fixtures assert raw capture unchanged, source capture id on queue items, generated-content distinction, no Confirmed Memory, and no task write. | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` passed. | Not required. | Deterministic fixtures use synthetic data and no provider credentials. |
| 2026-06-28 | Slice A gate | Approved bounded M1/M2/M3/M4.0-M4.1 implementation after checking plan and relevant specs. | `git diff --check` passed after implementation/tracker updates. | Not required for docs-only approval gate. | Runtime implementation proceeded through M1/M2/M3/M4.0-M4.1 only. |
| 2026-06-28 | M1.1-M1.7 | Shared PA contracts added for Review Queue item types, SourceRef/ReplayRef, RetrievalOutcome, Data Boundary, Memory taxonomy, and Context Trace. Persisted models reject raw excerpts/provider output. | `npm test -- --runTestsByPath __tests__/pa-contracts.test.ts` passed; included in Slice A focused suite and `make deploy`. | Not required for contract-only work. | Active Review Queue producers remain empty; runtime producers wait for M5/M7.4+. |
| 2026-06-28 | M2.1-M2.4/M2.7 | Deterministic eval fixture schema/runner added with synthetic vault data, source assertions, Review Queue assertions, and negative privacy/excerpt-leak cases. | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` passed. | Not required. | M2.5/M2.6 remain deferred until Memory/Maintenance runtime objects exist. |
| 2026-06-28 | M3.1-M3.5 | Data Boundary settings, resolver, provider disclosure policy model, cleanup skeleton, and adapters added for VSS file enumeration, Memory search expansion, Pagelet scope/related notes, and Memory extraction vault events. | Data Boundary focused suite passed; Slice A focused suite passed; lint/build/diff/source scan/deploy passed. | Live settings readback found `Data & Privacy Boundaries`, generated-note policy copy, provider disclosure copy, and six disabled cleanup buttons; `dev:errors` clean. | Cleanup actions remain disabled; no destructive action wired. |
| 2026-06-28 | M4.0-M4.1 | `ActiveVaultIndexer` facade maps existing VSS-style results to `RetrievalOutcome` with Source/Semantic lanes and persisted SourceRefs; Pagelet related-note retrieval adopted the facade. | `npm test -- --runTestsByPath __tests__/active-vault-indexer.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/vss.test.ts` passed; included in Slice A focused suite and `make deploy`. | Pagelet panel opened in running Obsidian test vault; `.pa-pagelet-panel` DOM count 1, current-note scope text present, `dev:errors` clean. | No Chat main adoption, no VSS storage/queue migration, no broad provider run. M4.2-M4.6 are now mapped under Slice A2 and still require approval. |
| 2026-06-28 | M5.0-M5.2 | Pagelet host exposes Review Queue read/create/dismiss methods; shared local store validates active producers, source-backed input, status transitions, snooze/dismiss, origin, and no raw excerpt/provider output persistence. | Review Queue store, contracts, orchestrator, bubble, panel/tab tests passed in Slice B focused suite; lint/build/diff/source scan/deploy passed. | Running Obsidian test vault showed Bubble route boundary indirectly through Pagelet command path and Panel/Tab queue DOM; `dev:errors` clean. | Store is local plugin state, not Markdown. Only `evidence_insight` producer is active after Slice B. |
| 2026-06-28 | M5.3-M5.6 | Pagelet Panel shows current-scope queue cards; Detail Tab shows global queue with group filters; source-backed cards show claim/source/why/actions. Review note saves are now note-only history writes and do not auto-create `evidence_insight` items. | Pagelet panel/tab/orchestrator/bubble tests passed; `make deploy` passed with full test/lint/build gate. | Obsidian smoke injected one queue item, verified Panel and Detail Tab Review Queue DOM, then cleaned queue back to zero. | Bubble remains route-only for queue work; no generated `suggested` count and no full-card Bubble review. |
| 2026-06-28 | M6.1-M6.2 | Context Pager state builds from retrieval/pagelet decisions, stores only ids/counts/reasons/hashes, maps skipped reasons to product language, and renders collapsed/expanded trace in Pagelet Panel/Tab. | Context Pager, Pagelet panel/tab/orchestrator, settings, and TypeScript checks passed; source scan returned no matches. | Obsidian smoke showed Panel and Detail Tab pager DOM with `Used 1 sources, 0 memories. 0 skipped.` and used-source path; errors clean. | `contextPager.enabled` now gates Pagelet pager visibility and defaults true after M6. |
| 2026-06-28 | M6.3-M6.4 | Chat turn metadata now carries compact context trace derived from existing `contextUsed`; eval fixtures assert context count alignment and no private text in traces. | `npm test -- --runTestsByPath __tests__/pa-agent-history.test.ts __tests__/context-pager.test.ts __tests__/pa-eval.test.ts`; `npm run eval:pa:fast`; Slice B focused suite passed. | Chat visible UI smoke not run because this slice adds metadata hook only; Pagelet visible Context Pager smoke passed. | Future Chat visible UI can read the existing metadata without widening stored context content. |
| 2026-06-28 | M2.5 | Memory lifecycle eval fixtures assert source-backed Saved Insights, weak-only influence, Confirmed Memory source refs, text-free tombstones, and Context Firewall decisions. | `npm test -- --runTestsByPath __tests__/pa-eval.test.ts` and `npm run eval:pa:fast` passed. | Not required. | Fixtures are deterministic synthetic data and use no provider credentials. |
| 2026-06-28 | M8.1 | Saved Insight local store enforces type/origin/status/influence policy, requires sourceRefs for PA-generated/recommended/imported insights, allows marked user-authored unsourced insights, filters by type/status/scope, and archives/restores/promotes locally. | `npm test -- --runTestsByPath __tests__/saved-insight-store.test.ts __tests__/settings.test.ts`; focused Slice D suite; `make deploy` passed. | Covered by Slice D Pagelet detail smoke for visible ledger rendering. | Store persists no raw excerpts/provider output in source refs. |
| 2026-06-28 | M8.2 | Pagelet Detail Tab renders Saved Insights separately from Review Queue with type/status/origin/source chips and keeps session cache copies out of serialized workspace state. | `npm test -- --runTestsByPath __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts`; lint/build/source scan/deploy passed. | Running Obsidian test vault showed `.pa-pagelet-tab-saved-insights` count 1 and text for the injected source-backed insight; visibility metrics showed `.pa-pagelet-tab` visible. | Computer Use timed out; screenshot command was unreliable for this tab. |
| 2026-06-28 | M8.3 | Quick Capture enrichment can emit `memory_candidate` Review Queue items with memory type and sensitivity metadata; candidates are converted to Memory candidates only through governance-store validation and are not Confirmed Memory until explicit confirmation. | `npm test -- --runTestsByPath __tests__/memory-governance-store.test.ts __tests__/quick-capture-enrichment.test.ts __tests__/review-queue-store.test.ts`; Slice D focused suite passed. | Pagelet detail smoke showed active Memory only from explicit injected governance state, not from queue-only candidates. | High-sensitivity candidates are rejected by default. |
| 2026-06-28 | M8.4 | Memory governance store supports archive/restore/forget/export confirmation semantics; forget leaves a text-free tombstone and archive preserves content while Context Firewall drops archived records. Pagelet Detail Tab shows active and forgotten records read-only. | `npm test -- --runTestsByPath __tests__/memory-governance-store.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts`; Slice D focused suite and `make deploy` passed. | Running Obsidian test vault showed `.pa-pagelet-tab-memory-governance` count 1 with active Memory and forgotten marker; injected records were cleaned; `dev:errors` clean. | Archive/forget/export UI controls are intentionally not exposed in Slice D; future UI must add action confirmations and visual smoke. |
| 2026-06-28 | M8.5 | Context Firewall V1 auto-includes low-risk in-scope memory, asks for stale/task/medium sensitivity, and drops archived/forgotten/high-sensitivity/out-of-scope memory. | `npm test -- --runTestsByPath __tests__/memory-governance-store.test.ts __tests__/pa-eval.test.ts`; `npm run eval:pa:fast`; `make deploy` passed. | Pagelet detail smoke verified read-only Memory visibility; direct Context Firewall behavior is covered by deterministic unit/eval tests. | Chat runtime inclusion is not widened in this slice. |
| 2026-06-29 | M2.6 | Maintenance eval assertions cover preview metadata, affected paths, hard-delete rejection, merge-to-new-note boundary, apply-selected-only, rollback restore, and no source writes. | `npm test -- --runInBand __tests__/pa-eval.test.ts`; `npm run eval:pa:fast`; focused M9.6B suite passed. | Not required. | Fixtures remain deterministic synthetic data and use no provider credentials. |
| 2026-06-28 | M9.1 | Maintenance proposal model includes all planned action types, scope, sourceRefs, confidence, preview, undo metadata, and blocked apply metadata. Permanent delete and overwrite merge are rejected. | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts`; focused Slice E suite; `make deploy` passed. | Covered by Slice E Pagelet detail smoke for visible proposal cards. | No action execution is implemented. |
| 2026-06-28 | M9.2 | Manual `pa-pagelet:maintenance-review` command runs a local scan, creates `maintenance_proposal` Review Queue items, and opens a native Pagelet Detail Tab with category counts. Weekly scan remains disabled. | Pagelet command/orchestrator/tab tests, focused Slice E suite, lint/build/source scan/deploy passed. | Running Obsidian test vault showed `.pa-pagelet-tab-maintenance-review` with 24 preview-only suggestions, category counts, and `Weekly scan is off`. | Smoke queue was cleaned back to zero. |
| 2026-06-28 | M9.3-M9.5 | Inbox/unsorted, weak-title, and weak-link scanners create source-backed preview proposals with affected paths, old/new titles where relevant, source/target link context, and no source-note mutation. | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts`; focused Slice E suite passed. | Smoke showed inbox, title, and weak-link cards in Pagelet Detail Tab; temporary smoke notes were removed. | The scanner is local heuristic only and makes no provider calls. |
| 2026-06-28 | M9.6A | Tracker records move-only as the first candidate apply family plus target confinement, stale reread, audit/recovery, cancel, prompt-injection, and out-of-scope action rules. | `git diff --check` passed for boundary record; M9.6B later implemented after explicit approval. | Boundary smoke not required. | Closed as the boundary source for M9.6B. |
| 2026-06-29 | M9.6B | Move-only Maintenance apply/undo uses explicit confirmation, target confinement, stale reread, Data Boundary checks, source-backed action log, Review Queue applied/undone status updates, and Tab action state. | Focused M9.6B suite passed 5 suites / 170 tests; `npx tsc -noEmit -skipLibCheck --pretty false`; full `npm test -- --runInBand` passed 125 suites / 2163 tests; `npm run lint`; `npm run build`; `npm run eval:pa:fast`; source scan; `make deploy`. | Obsidian test-vault smoke moved `Inbox/PA Maintenance Move Smoke.md` to `Notes/PA Maintenance Move Smoke.md`, then undid it; modals showed old/new paths; action log and queue statuses reached `applied` then `undone`; `dev:errors` clean. | Smoke queue/action log entries and temp files were cleaned and verified absent. |
| 2026-06-29 | M9.7 | Maintenance eval fixtures include passing preview/no-write cases, negative permanent-delete fixture, selected-only apply fixture, and rollback restore fixture. | `npm run eval:pa:fast` passed, 1 suite / 9 tests. | Not required. | Runtime apply behavior is covered by M9.6B focused tests and Obsidian apply/undo smoke. |
| 2026-06-29 | M10.1-M10.2 | Manual Weekly Review opens a Pagelet Detail Tab for the recent seven-day range and populates restrained source-backed sections from recent notes, Saved Insights, Memory queue items, Maintenance proposals, and Quiet Recall candidates. | Focused Slice F suite passed 7 suites / 197 tests; full Jest passed 127 suites / 2178 tests; lint/build/type-check/source scan clean. | Obsidian test-vault smoke showed `.pa-pagelet-tab-weekly-review` with the smoke Saved Insight and source path. | Empty sections render restrained placeholders; provider output is not persisted or displayed. |
| 2026-06-29 | M10.3 | Weekly Review note generation is accepted-only and uses the existing Pagelet write-action preview path after user confirmation; the Tab defaults to digest mode and shows item selection only after the user chooses to save material. | Weekly Review tests verify digest-first default, selected items included, and unselected/dismissed content omitted; broad gates and `make deploy` passed. | Obsidian smoke accepted one smoke item, confirmed Weekly Review modal and write-action preview modal, then verified `.pagelet/pagelet-weekly-review-2026-06-29.md` contained only that item, generatedAt, and sourceRefs. | Generated smoke note was removed and verified absent. Current focused tests cover the updated digest-first UI boundary; Obsidian smoke has not been rerun for this follow-up. |
| 2026-06-29 | M10.4 | Prepared Weekly Review remains opt-in; Bubble can only build a short route hint when enabled and not quiet/off. | `__tests__/pagelet-bubble-content.test.ts` and settings tests passed in focused/full suites. | Covered by Slice F smoke for manual Pagelet route; automatic prepared scan was not introduced. | M11.3 must still wire frequency/cooldown runtime before enabling recall Bubble nudges. |
| 2026-06-29 | M11.0 | Nudge arbitration rule records max-one/compact-digest behavior, route-only Bubble content, Panel/Tab evidence ownership, and off/quiet/frequency gates. | `git diff --check` plus Bubble/settings tests passed. | Docs-only acceptance; Bubble recall runtime later closed by M11.3. | Closed. |
| 2026-06-29 | M11.1 | Quiet Recall candidate generation uses active current-note relevance, related-note/VSS entrypoint scores, and active Saved Insight signals; weak/stale unrelated evidence is filtered and far association is capped. | `__tests__/quiet-recall.test.ts`, orchestrator tests, full Jest, type-check, lint/build passed. | Obsidian smoke produced one current-note recall from the smoke Saved Insight. | No provider call or persistent raw note text is used by recall ranking. |
| 2026-06-29 | M11.2 | Quiet Recall renders source, why-now, next action in Pagelet Panel/Tab, and save-as-insight writes a source-backed Saved Insight. | `__tests__/pagelet-panel-tab-view.test.ts`, `__tests__/quiet-recall.test.ts`, full/broad gates passed. | Obsidian smoke showed `.pa-pagelet-tab-quiet-recall`, saved the recall as a `pa-recommended` active Saved Insight, and cleaned both injected/saved insights. | Bubble recall runtime later closed by M11.3. |
| 2026-06-29 | Remaining approval gates | M4.2-M4.6, M11.3-M11.4, and M12.1-M12.3 acceptance/validation expanded in the plan; tracker created precise next approval gates. | `git diff --check` passed for this docs-only update. | Not required; no runtime/UI files changed. | Runtime was blocked until the user approved one gate or task. |
| 2026-06-29 | Slice A2 M4.2-M4.6 | Activity signals, structure tie-breakers, retrieval status classifier, local sources-to-check plan, and text-free replay records implemented in `ActiveVaultIndexer`. | `npm test -- --runTestsByPath __tests__/active-vault-indexer.test.ts`; `npm test -- --runTestsByPath __tests__/data-boundary.test.ts __tests__/pa-contracts.test.ts __tests__/pa-eval.test.ts`; `npm test -- --runTestsByPath __tests__/active-vault-indexer.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/context-pager.test.ts __tests__/vss.test.ts`; `npx tsc -noEmit -skipLibCheck --pretty false`; `npm run eval:pa:fast`; `npm run lint`; `npm run build`; source scan; `git diff --check` all passed. | Not required; no visible UI or Obsidian runtime surface added. | No Chat main adoption, VSS storage migration, provider call, queue write, raw text persistence, or UI smoke path added. |
| 2026-06-29 | M11.3 Quiet Recall Bubble | `buildQuietRecallNudgeContent` returns a single route hint with View/Dismiss/Later; runtime gates on `pagelet.enabled`, proactive hints, quiet hours/cooldown, and `quietRecall.bubbleNudgesEnabled`; only user-kept/later Review Queue items can outrank recall in Bubble; Dismiss/Later are local UI suppression/snooze only. | Focused Slice G suite passed 6 suites / 186 tests; full `npm test -- --runInBand` passed 128 suites / 2193 tests via final `make deploy`; `npx tsc -noEmit -skipLibCheck --pretty false`; `npm run lint`; `npm run build`; source scan returned no matches; `git diff --check`; `make deploy` passed. | Obsidian 1.13.1 test-vault smoke reloaded plugin, injected/restored a smoke Saved Insight, verified then-current nudge ordering, then showed Quiet Recall Bubble text `A saved insight may fit the note you are viewing.` with View/Dismiss/Later. View opened `.pa-pagelet-tab-quiet-recall`; Dismiss suppressed the same candidate; Later snoozed it; `/private/tmp/pa-slice-g-quiet-recall-bubble.png`; `dev:errors` clean. | Current Bubble tests narrow Review Queue reminders to `accepted`, `edited`, and `snoozed` items; smoke restored `quietRecall.bubbleNudgesEnabled=false`, removed the smoke insight, and restored Review Queue enabled state. |
| 2026-06-29 | M11.4 Recall Feedback Learning | `RetrievalHabitProfileStore` is disabled by default and records only aggregate accept/view/dismiss/later/not-relevant counters when enabled; Data Boundary excluded sources do not learn; clear/disable stops collection and future influence; persisted state stores no raw query/path/title/source text. | `npm test -- --runTestsByPath __tests__/retrieval-habit-profile.test.ts __tests__/quiet-recall.test.ts __tests__/pagelet-bubble-content.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/settings.test.ts __tests__/pagelet-proactive-hints.test.ts`; full Jest/type-check/lint/build/source scan/diff check and `make deploy` passed. | Not required; no user-facing RHP UI added. Obsidian Bubble smoke confirmed default disabled feedback state stayed `{ enabled: false, state: { aggregates: [] } }` after View/Dismiss/Later. | Superseded by M12 Retrieval Habit Profile expansion below. |
| 2026-06-29 | Post-Slice G docs state | TODO, roadmap, suggested release slices, and M12 preflight were reconciled before M12 approval. | Stale-state search for Slice G remaining-gate wording returned no matches; `git diff --check` passed. | Not required; docs-only reconciliation. | Superseded by M12 runtime closeout below. |
| 2026-06-29 | M12 Later Layers | Retrieval Habit Profile adds opt-in settings, 90-day aggregate retention, unsafe-shape rejection, and weak near-tie AVI influence; Graph Discovery creates source-backed Review Queue items only; Scope Recap is on-demand, source-backed, not source truth, and exports Markdown only through confirmation plus WAF preview. | Focused M12 suites, combined M12 suite, full Jest, eval, type-check, lint/build, source scan, and `make deploy` passed. | Running Obsidian test vault verified Graph Suggestions, Scope Recap two-step confirmed write, Settings opt-in modal/cancel, clean `dev:errors`, and smoke cleanup. | No M12 graph visualization, provider telemetry, background broad scan, automatic Memory/Saved Insight creation, or unconfirmed Markdown write was added. |
