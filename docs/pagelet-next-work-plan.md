# Pagelet Beta Closeout Work Plan

> Status date: 2026-06-06. This plan starts from the latest Pagelet
> workbench smoke in `docs/pagelet-smoke-checklist.md` and reconciles it
> against the current code.

## Scope

Pagelet beta is not in release mode yet. The next goal is to complete and
verify the full beta feature path before any release dry-run, tag, publish, or
GitHub release work.

Provider structured-output matrix testing was initially deferred by product
decision, then resumed after the core desktop workbench smoke passed. It is now
recorded as passed compatibility evidence.

## Current Baseline

Completed and verified:

- Pagelet panel opens without provider calls.
- Current / yesterday / last 3 days / last 7 days local scope selection exists.
- Included / skipped note toggling works.
- Current-note review reaches the configured provider and produces cards.
- Preview confirmation writes a review note under `.pagelet/`.
- Accept adds an editable draft block.
- Research opens Chat with a prefilled prompt and does not auto-submit.
- Automated coverage exists for scope selection, SuggestionCard rendering, command
  registration, review-note recording, and the PageletView workbench interactions
  listed below.

Newly covered in this pass:

- Draft edits persist through localStorage and restore after panel reopen for the
  same source note.
- Draft removal clears the local pending snapshot.
- Pending draft restore is source-bound; a draft from one note is not restored
  onto another active note.
- Source chip, related-note chip, and Research actions call the plugin boundary
  with the expected payloads.

## Workstream A: Workbench Completion

| ID | Task | Status | Verification |
| --- | --- | --- | --- |
| A1 | Source-bound draft lifecycle: accept, edit, close/reopen restore, remove | Implemented | `__tests__/pagelet-view.test.ts` |
| A2 | Source chip / related-note / Research action wiring | Implemented | `__tests__/pagelet-view.test.ts` |
| A3 | Manual GUI re-smoke for draft edit restore + Remove | Passed | 2026-06-06 desktop test vault smoke |
| A4 | Manual GUI re-smoke for source chip and related-note click | Passed | 2026-06-06 desktop test vault smoke |
| A5 | View-type gating negative smoke outside Markdown views | Passed | 2026-06-06 desktop test vault smoke |
| A6 | Reduce-motion smoke for mascot animation suppression | Passed | 2026-06-06 desktop test vault smoke |

## Workstream B: Compatibility And Accessibility

| ID | Task | Status | Verification |
| --- | --- | --- | --- |
| B1 | Provider structured-output matrix | Passed | 2026-06-06 provider matrix follow-up |
| B2 | Mobile Pagelet smoke | Passed | 2026-06-06 mobile smoke follow-up |
| B3 | Real screen-reader announcement smoke | Passed | 2026-06-06 VoiceOver smoke |
| B4 | Coexistence with other AI plugins / resource overlap | Passed | 2026-06-06 AI plugin coexistence smoke |

## Workstream C: Documentation And Tracking

| ID | Task | Status | Verification |
| --- | --- | --- | --- |
| C1 | Keep latest smoke evidence in `docs/pagelet-smoke-checklist.md` | In progress | Updated after each smoke pass |
| C2 | Keep `docs/todo.md` active gate aligned with Pagelet state | In progress | This plan is linked from TODO |
| C3 | Keep SDD/rollout wording historical where implementation has diverged | Pending | Code-led doc pass before release planning |

## Product Decisions To Preserve

- Pagelet remains user-triggered. It does not auto-run on source note edits.
- The panel is the primary beta interaction surface; Chat is used only for
  explicit Research handoff.
- The only write action in v1 remains confirmed creation of a review note.
- The draft collector is local pending UI state, not a second write path.
- Session cost stays inside the Pagelet panel for now; no status-bar cost
  indicator is needed for beta completion.
- Keep the current direct-DOM Pagelet UI. Do not introduce React or a larger UI
  framework just to finish the beta surface.

## Execution Order

1. Finish automated coverage for workbench-only behavior.
2. Run focused Pagelet tests plus type-check and whitespace check.
3. Run `make deploy` before any new Obsidian GUI smoke.
4. Manually smoke A3-A6 and append evidence to
   `docs/pagelet-smoke-checklist.md`.
5. Revisit B1-B4 only after the core beta workbench is functionally complete.
