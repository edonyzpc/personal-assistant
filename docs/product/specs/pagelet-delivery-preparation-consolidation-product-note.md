# Pagelet Delivery Preparation Consolidation Product Note

Updated: 2026-07-19
Status: **Implemented Phase 6 base plus B-108/DEC-017/DEC-018/DEC-019/DEC-020
runtime contract** — supporting product narrative for the Pagelet Bubble
Readiness & Recall runtime. The owning B-108 behavior authority is the
[Scope Recap Product Spec](./pa-scope-recap-theme-summary-product-spec.md);
automated/deploy, bounded unlocked desktop/iPhone 15 evidence, and provider-free
real Review/Discover downstream routing/presentation plus user-operated desktop/iPhone
physical long-press pass. The correctly prepared user-owned 3-Second Value Test passed;
provider-backed Review/Discover semantics and the separate, optional-by-contract
Scope Recap real-provider token smoke passed.

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
| Historical Periodic Summary | The standalone Bubble/command identity is retired from the current contract. | Its intentional time-range review intent remains useful. | Reintroducing it would duplicate Recap and revive Weekly Review burden. | Any future value belongs to a separately authorized Recap time-range mode, not an independent current capability. |
| Scope Recap | Source-backed derived recap plus bounded prepared-Recap scheduling; a valid artifact opens immediately in Pagelet detail. | Best fit for "review/recap" because it is source-backed, scoped, stale-aware, derived, and can be ready before click. | B-108 resolved the prior disclosure, budget, delivery, failure-state, physical-gesture and downstream-routing ambiguity; the correctly prepared user-owned 3-Second Value Test passed. | Preserve the implemented DEC-017/018/019 behavior and its distinct user control. |
| Background Preparation / Preload | Separate generic background engine, gated by `preloadEnabled`, prepares `PreloadFinding[]` review findings for Bubble/Panel. | Provides generic Pet/Bubble readiness. | Its setting and output do not govern the independent prepared Scope Recap scheduler; exposing both as `preload` is ambiguous. | Keep generic preload opt-in unless separately decided; internal reuse must preserve the distinct Scope Recap product contract. |

## Product Decisions Already Confirmed

These are settled for the Bubble Readiness & Recall iteration:

| Decision | Result |
| --- | --- |
| Bubble Recall display | Default to the one highest-quality card. Expose a 2-to-3-card single-visible stack only when every candidate independently passes the high-quality gate and remains distinct and source-backed; otherwise keep one card. |
| Save as insight | Do not show in Bubble. It belongs in Panel/Tab detail because it is a durable insight decision. |
| Link to current note | Keep in Bubble as a secondary action. It must validate the active card and active-note snapshot and show success/failure feedback. |
| First-use guidance | Real Recall delivery takes priority. Onboarding annotates value moments as inline hints; it does not replace real delivery. |
| Data Boundary explanation | Treat as a trust signal, not setup error. Show "PA will stay quiet" copy and only a weak settings-view action. |
| Recap Delivery | May enter the design only as an already-prepared recap delivery. Bubble must not show a "PA can build a recap" CTA when no prepared recap exists. |
| Prepared Recap artifact | Use a local derived cache with enough structured information for Panel/Tab detail. Do not auto-write Markdown and do not store full raw provider output. User confirmation is required to export/save a recap note. |
| Recap scope and triggers | Default to current-context + time-range recap. Pagelet open, note save, and low-frequency idle preparation may prepare recap artifacts; do not default to daily/weekly whole-vault summaries. |
| Prepared Scope Recap default | Distinct from generic review preload: after provider setup and affirmative first-run Data Boundary authorization, bounded Recap preparation is on by default and remains user-disableable. Its calls/cost are separately attributable. It must make fresh value immediately available without turning every note event into a provider call. See [DEC-017](../decisions/dec-017-default-background-recap-preparation.md). |
| Prepared Scope Recap hint | After DEC-017 authorization, high-value Recap hints are on by default but require a new, fresh, concrete cross-note insight backed by at least two sources. Summary/coverage-only and repeated/suppressed artifacts stay silent; other hint kinds retain their existing defaults. See [DEC-018](../decisions/dec-018-quality-gated-scope-recap-hints.md). |
| Scope Recap failure fallback | Failed/empty/quality-rejected attempts create no ready delivery or nudge and do not overwrite a still-valid artifact. Explicit Recap open without a valid artifact immediately shows an explanation-only local scope overview plus Retry/View sources, never a rule-generated insight. See [DEC-019](../decisions/dec-019-honest-layered-recap-fallback.md). |
| DeliveryCandidate persistence | `DeliveryCandidate` is a display/action contract, not one unified durable inbox. Recap may use local derived cache; Pattern may use short-term dedupe; Recall and Review should not add new long-term persistence by default. |
| Review findings in Bubble | Generic review does not enter Bubble. Only source-backed, high-confidence review candidates with clear why-now and low-burden next action may appear, and they rank below Recall, Recap, and Pattern. |
| Discover click behavior | Run a lightweight async search inside Bubble. AI-evaluated results may use Recall cards. When AI evaluation is unavailable or rejected, explicit Discover may still show a local match only as a clearly labeled `Local related clue` / `本地关联线索`, without AI why-now copy and never mixed with proactive Recall cards. Slow or complex results route to Panel. Results remain bound to the active-note snapshot at trigger time. |
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
- Bubble defaults to the one highest-quality delivery card.
- A single-visible stack is enabled only when all 2-3 candidates independently
  pass their quality gates and remain distinct and source-backed. The hard cap
  is 3; larger sets route to Panel/Tab.
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
Two newer notes changed the release plan from weekly to milestone-based,
while three earlier notes still assume the weekly cadence.

[Review evidence] [Later]
```

Disallowed copy shape:

```text
PA can build a short recap.

[Generate summary]
```

When no valid artifact exists after an unavailable, failed, empty, malformed,
or quality-rejected attempt, the normal candidate pool receives no Recap
Delivery. Only an explicit Recap open may render the DEC-019 explanation
fallback from local scope/source metadata in its owning Bubble or detail
surface. It must remain outside `DeliveryCandidate`, cannot nudge, and starts no
provider call until the user chooses Retry. A failed attempt must not replace a
still-current last valid artifact; existing command routes do not have to
detour through Bubble.

## Implemented B-108 Contract Details

The B-108 product choices are no longer open implementation questions:

| Decision | Implemented contract |
| --- | --- |
| Prepared Recap storage | Local derived artifact, no Markdown auto-write, no raw provider output; source/currentness invalidation and clear controls apply. |
| Recap preparation budget | Prepared Scope Recap becomes default-on only after affirmative first-run Data Boundary authorization; generic review preload remains a separate opt-in; Recap has its own persisted opt-out and 2/hour, 10/day actual-call bucket. |
| Recap hint gate | High-value Recap hints are independently disableable and default on only after DEC-017 authorization; stable fingerprint, shown/dismiss/Later, quiet/focus, cooldown, and source-quality gates apply. Generic and Quiet Recall hints remain off by default. |
| Recap failure state | Last valid artifact and last attempt status remain separate; explicit open without a valid artifact returns local scope orientation plus Retry/View sources, never a rule-generated insight. |
| Quiet Recall evaluation | Each candidate is independently AI-evaluated within the DEC-020 limiter/cache boundary; local-only matches stay explicit-Discover clues and never become proactive Recall. |

Discover timeout tuning and the broader time-range Recap migration remain
separate follow-up directions; they are not unfinished B-108 deltas.

## Historical Phase 6 Plan

This delivered phase explains the consolidation provenance. Current behavior and
status come from the owning Product Spec and the
[B-108 archived delivery package](../../archive/2026/pagelet-b108-dogfood-followup/README.md),
not this plan table or an Archive discussion:

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
| P6.4 Recap substrate | Promote `ScopeRecap` to Recap Delivery substrate and define prepared recap cache. | Delivered base; B-108 amendments implemented. |
| P6.5 Periodic Summary terminal migration | Retire the independent Periodic Summary / Generate Summary Bubble identity in favor of the broader Recap time-range direction. | Delivered product consolidation; broader time-range capability needs its own current authority. |
| P6.6 Validation | Unit tests, local validation gate, Bubble desktop/mobile smoke, and source-backed evidence checks. | Automated/deploy, bounded unlocked desktop/iPhone 15 evidence, user-operated physical long-press, and real Review/Discover downstream routing, presentation and Qwen semantics complete; the user-owned 3-Second Value Test stays in the active Tracker. |

## Non-Goals

- Do not reintroduce standalone Periodic Summary as a current Bubble or success
  contract. A broader time-range Recap is future scope unless separately
  approved and implemented.
- Do not make Bubble generate a recap on click.
- Do not store full provider output as hidden Obsidian view state.
- Do not expose technical terms such as VSS, preload, backend, embedding, or
  queue in ordinary Bubble copy.
- Do not convert Recap into Confirmed Memory or Saved Insight without explicit
  user action.

## References

- [Pagelet Bubble Readiness & Recall Product Spec](./pagelet-bubble-readiness-and-recall-product-spec.md)
- [Historical Pagelet Bubble Readiness & Recall SDD](../../archive/pagelet-bubble-readiness-and-recall-sdd.md)
- [PA Scope Recap And Theme Summary Product Spec](./pa-scope-recap-theme-summary-product-spec.md)
- [PA Product Information Architecture Spec](../pa-product-information-architecture-spec.md)
- [PA Product North Star](../pa-product-north-star.md)
