# Pagelet Delivery Preparation Consolidation Product Note

Updated: 2026-07-05
Status: **Implemented Phase 6 product amendment** — source contract for the
Pagelet Bubble Readiness & Recall runtime migration and release-readiness
review.

## Purpose

This note records the product consolidation that emerged while reviewing the
Pagelet Bubble Readiness & Recall design.

The issue is not only Bubble copy. Pagelet currently has three adjacent
capabilities that all look like "review/recap/preparation" from a user's point
of view, but they are implemented as separate product paths:

1. Periodic Summary
2. Scope Recap
3. Background Preparation / Preload

This creates duplicated product identity and makes Bubble drift back toward an
AI feature menu. The consolidation target is a single Pagelet Delivery
Preparation layer that prepares source-backed delivery candidates for Bubble,
Panel, and Tab.

## North Star Fit

Use [PA Product North Star](../pa-product-north-star.md) as the standard:

> 随手记下，需要时自然浮现。

The Delivery Preparation layer should answer one question:

> Does PA have something genuinely worth bringing back to the user now?

It should not answer:

> Which AI feature button should the user click next?

## Current Capability Inventory

| Capability | Current runtime shape | Product value | Problem | Consolidation direction |
| --- | --- | --- | --- | --- |
| Periodic Summary | User clicks, PA generates a periodic summary note preview in Panel. | Useful for intentional reports or diary/project recaps. | It is foreground generation, not prepared delivery. It overlaps with Recap and can revive Weekly Review burden. | Product direction confirmed: migrate into Recap's time-range mode and retire the standalone Periodic Summary product concept after runtime migration. |
| Scope Recap | User-triggered, source-backed derived recap via `buildScopeRecap()`, opened in Pagelet detail. | Best fit for "review/recap" because it is source-backed, scoped, stale-aware, and derived. | No background prepared object/cache, no Bubble nudge contract yet. | Promote to Recap Delivery substrate. |
| Background Preparation / Preload | Background engine prepares generic `PreloadFinding[]` review findings for Bubble/Panel. | Provides actual prepared results and Pet/Bubble readiness. | Output is generic review findings, not a unified delivery candidate model. | Keep mechanism; evolve output toward `DeliveryCandidate[]`. |

## Product Decisions Already Confirmed

These are settled for the Bubble Readiness & Recall iteration:

| Decision | Result |
| --- | --- |
| Bubble Recall display | Use a single-visible-card stack. Default one card; support up to 3 high-quality cards through restrained desktop arrows/dots and mobile swipe. |
| Save as insight | Do not show in Bubble. It belongs in Panel/Tab detail because it is a durable insight decision. |
| Link to current note | Keep in Bubble as a secondary action. It must validate the active card and active-note snapshot and show success/failure feedback. |
| First-use guidance | Real Recall delivery takes priority. Onboarding annotates value moments as inline hints; it does not replace real delivery. |
| Data Boundary explanation | Treat as a trust signal, not setup error. Show "PA will stay quiet" copy and only a weak settings-view action. |
| Recap Delivery | May enter the design only as an already-prepared recap delivery. Bubble must not show a "PA can build a recap" CTA when no prepared recap exists. |
| Prepared Recap artifact | Use a local derived cache with enough structured information for Panel/Tab detail. Do not auto-write Markdown and do not store full raw provider output. User confirmation is required to export/save a recap note. |
| Recap scope and triggers | Default to current-context + time-range recap. Pagelet open, note save, and low-frequency idle preparation may prepare recap artifacts; do not default to daily/weekly whole-vault summaries. |
| DeliveryCandidate persistence | `DeliveryCandidate` is a display/action contract, not one unified durable inbox. Recap may use local derived cache; Pattern may use short-term dedupe; Recall and Review should not add new long-term persistence by default. |
| Review findings in Bubble | Generic review does not enter Bubble. Only source-backed, high-confidence review candidates with clear why-now and low-burden next action may appear, and they rank below Recall, Recap, and Pattern. |
| Discover click behavior | Run a lightweight async search inside Bubble. Fast high-quality results can stay in Bubble; slow, weak, or complex results route to Panel. Results must be bound to the active-note snapshot at trigger time. |
| Small interaction defaults | Intentionally Quiet copy shows once then becomes minimal; progress numbers appear only for larger vaults; Pet state expansion is out of this round; Bubble must not show queue-like pending counts. |
| Periodic Summary terminal state | Do not keep Periodic Summary as an independent long-term capability. Migrate its value into Recap time-range mode and directly remove old Periodic Summary / Generate Summary entrypoints in the migration; no legacy alias or redirect. |

## Delivery Candidate Model

The long-term product model should converge on a single candidate pool:

```typescript
type DeliveryCandidateKind =
    | "recall"
    | "recap"
    | "pattern"
    | "review";
```

Every candidate should provide:

| Field | Meaning |
| --- | --- |
| `id` | Stable local identifier for dismiss/later feedback |
| `kind` | Recall, recap, pattern, or review |
| `title` | Short user-facing title |
| `body` | One compact explanation |
| `sourceRefs` | Source evidence behind the claim |
| `whyNow` | Why PA is surfacing it now |
| `preparedAt` | When this candidate was prepared |
| `staleStatus` | Fresh/stale/low-coverage/boundary-changed where relevant |
| `actions` | Surface-specific low-burden actions |
| `route` | Panel/Tab payload for details |

Bubble should consume this pool without knowing whether the candidate came from
Quiet Recall, Scope Recap, Pattern Detection, or a review-preparation pass.
The pool is not a single durable inbox. Candidate sources own their own
lifecycle and persistence policy.

## Bubble Delivery Rules

- Bubble shows delivery cards or one readiness explanation, never a feature
  launcher.
- Bubble uses a single-visible-card stack for multiple high-quality candidates.
- Hard cap: 3 Bubble cards. Larger sets route to Panel/Tab.
- No autoplay. No prominent unresolved count. No queue pressure.
- Every card action acts on the active card only.
- Dismiss/Later creates no future debt.
- Durable actions require explicit, clearly named user action and success or
  failure feedback.

## Recap Delivery Contract

Recap Delivery is not a renamed Generate Summary button.

It may appear in Bubble only when all of the following are true:

1. A fresh prepared recap artifact already exists.
2. The recap is source-backed and has source coverage.
3. The recap is not stale, boundary-changed, or low-coverage unless the card
   explicitly says so.
4. The Bubble card delivers a concrete recap observation, not a promise to run
   generation.
5. The action opens Panel/Tab detail. Bubble does not generate or expand the
   full recap inline.

The prepared artifact must be a local derived object that can support Panel/Tab
detail, including recap items, sourceRefs, source coverage, stale status,
preparedAt, scope/range, and skipped-source metadata where relevant. It must not
auto-write a Markdown recap note or store full raw provider output.

Allowed copy shape:

```text
PA prepared a short recap for this scope.

[View recap] [Later]
```

Disallowed copy shape:

```text
PA can build a short recap.

[Generate summary]
```

## Remaining Implementation Decisions

The main product direction is settled. These are implementation choices to
resolve in the Phase 6 SDD:

| Decision | Product Default | SDD Work |
| --- | --- | --- |
| Prepared Recap storage | Local derived cache, no Markdown auto-write, no raw provider output | Choose schema, storage location, invalidation, and cleanup policy. |
| Recap preparation budget | Current-context + time-range only; no daily/weekly whole-vault default | Define thresholds for enough recent change, source coverage, low-frequency idle, and provider cost. |
| Discover timeout threshold | Bubble async first, Panel fallback for slow/complex results | Define timeout, stale-result handling, and weak-result routing. |
| Periodic Summary deletion | Directly remove old Periodic Summary / Generate Summary entrypoints; no alias/redirect | Audit command registrations, locale strings, tests, docs, and release notes. |

## Development Plan Amendment

Add a new product-design phase after the original PA Product Redesign phases:

### Phase 6: Pagelet Delivery Preparation Consolidation

**Goal**: unify Pagelet's review/recap/preparation paths behind a single
Delivery Preparation model while preserving quiet, source-backed Bubble
delivery.

Suggested slices:

| Slice | Scope | Decision status |
| --- | --- | --- |
| P6.0 Product inventory | Map Periodic Summary, Scope Recap, Preload, Recall, Pattern Detection entrypoints and outputs. | No additional user decision needed. |
| P6.1 DeliveryCandidate contract | Define candidate type, active-card actions, routing, sourceRefs, stale status, and feedback. | No additional user decision if scoped to docs/SDD. |
| P6.2 Bubble card stack | Implement single-visible-card stack, desktop arrows/dots, mobile swipe, reduced motion, active-card actions. | Confirmed. |
| P6.3 Recall adapter | Adapt existing `QuietRecallCandidate` to delivery cards instead of creating a parallel recall result model. | No additional user decision. |
| P6.4 Recap substrate | Promote `ScopeRecap` to Recap Delivery substrate and define prepared recap cache. | Product direction confirmed; runtime SDD required. |
| P6.5 Periodic Summary terminal migration | Migrate the existing foreground Periodic Summary value into Recap time-range mode and directly remove old Periodic Summary / Generate Summary entrypoints. | Product direction confirmed; no alias/redirect. Requires runtime SDD before code removal. |
| P6.6 Validation | Unit tests, local validation gate, Bubble desktop/mobile smoke, and source-backed evidence checks. | No additional user decision. |

## Non-Goals

- Do not remove Periodic Summary runtime paths in this amendment; removal or
  command migration belongs to the Phase 6 migration SDD.
- Do not make Bubble generate a recap on click.
- Do not store full provider output as hidden Obsidian view state.
- Do not expose technical terms such as VSS, preload, backend, embedding, or
  queue in ordinary Bubble copy.
- Do not convert Recap into Confirmed Memory or Saved Insight without explicit
  user action.

## References

- [Pagelet Bubble Readiness & Recall Product Spec](./pagelet-bubble-readiness-and-recall-product-spec.md)
- [Pagelet Bubble Readiness & Recall SDD](../../archive/pagelet-bubble-readiness-and-recall-sdd.md)
- [PA Scope Recap And Theme Summary Product Spec](./pa-scope-recap-theme-summary-product-spec.md)
- [PA Product Information Architecture Spec](../pa-product-information-architecture-spec.md)
- [PA Product North Star](../pa-product-north-star.md)
