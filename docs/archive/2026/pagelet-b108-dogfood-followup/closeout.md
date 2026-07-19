# Pagelet B-108 Dogfood Follow-up Closeout

Document status: Archived
Delivery status: Closed
Updated: 2026-07-19
Work item: B-108
Authority: 本 track 的最终结果、验证、遗留项与信息去向。
Lane: Product
Decision: [DEC-017 — default bounded background preparation](../../../product/decisions/dec-017-default-background-recap-preparation.md)
Product spec: [Scope Recap And Theme Summary Product Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md)

## Outcome

- Final state: Shipped to BRAT `2.9.0-beta.2` prerelease and Closed. Stable `2.9.0` was not authorized or published.
- What changed: Scope Recap now prepares only after affirmative disclosure, opens a fresh source-backed artifact without waiting or a duplicate call, preserves honest local recovery when no valid artifact exists, and applies independent quality/cost gates to proactive Recap and Quiet Recall. Pagelet Bubble/Tab/Pet presentation, context actions, long-press lifecycle, font/touch behavior and same-session Recap reauthorization were reconciled with the current contracts.
- What did not change: generic review preload and generic proactive-hint defaults remain off; no automatic Markdown, Memory, task or Review Queue writes were added; broader double-Ctrl, Chat Quick Command, frontmatter Sync, Weekly Review, Pattern LLM, `replace_selection` and Operations Agent scopes were not expanded.
- Release state and evidence: [`2.9.0-beta.2`](https://github.com/edonyzpc/personal-assistant/releases/tag/2.9.0-beta.2) is a GitHub prerelease. [Actions run `29685255023`](https://github.com/edonyzpc/personal-assistant/actions/runs/29685255023) passed. The beta packaging commit/tag remain isolated on `beta/2.9.0-beta.2` and must not be merged back to development or `master`.

## Contract Reconciliation

| Contract | Final authority | Updated | Notes |
| --- | --- | --- | --- |
| Product Decision + Spec | [DEC-017](../../../product/decisions/dec-017-default-background-recap-preparation.md) through [DEC-020](../../../product/decisions/dec-020-independent-quiet-recall-evaluation.md); [Scope Recap Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md) | Yes | Decisions remain Accepted and the Product Spec remains Current; links and BRAT delivery state now point to this archived package. |
| Architecture | [Pagelet Product Design](../../../product/pagelet-product-design.md) | Yes | Current design records the shipped BRAT prerelease while stable delivery remains separate. |

## Verification And Review

| Gate | Result | Evidence | Residual risk |
| --- | --- | --- | --- |
| Focused and full automation | Passed | 15 focused suites / 807 tests; compatibility 348 tests; final authorization/settings 323 tests; final release gate 160 suites / 3165 tests; TypeScript, lint, docs, whitespace, community DOM scan, build and bundle audit passed. | None within B-108 requirements. |
| Independent completion review | Passed | Product drift, privacy/cost, async/lifecycle, UI/i18n and test-adequacy findings F-01 through F-20 were resolved; final same-session reauthorization review found no P0-P2 issue. | Future dogfood tuning must not weaken disclosure, pre-call reservation or provenance gates. |
| User-owned value validation | Passed | With authorization and a fresh 12-source artifact already prepared, Pet exposed `insights ready`; the click made no duplicate call. The Recap's honest explanation of the test vault's limited real value increased trust and future-open intent. | Test-vault content cannot predict long-term real-vault frequency or value; use future dogfood evidence, not speculation. |
| Physical desktop/mobile interaction | Passed | Desktop short-click, 16/24px, light/dark, reduced motion and user mouse long-press passed; iPhone 15 44×44 target, short-tap Bubble and user finger long-press passed. | iPad placement was not claimed. |
| Prerelease publication | Passed | Local release dry-run/release/publish and GitHub Actions run `29685255023` passed; the release is marked prerelease and contains LICENSE, main.js, manifest.json, NOTICE, styles.css and THIRD_PARTY_NOTICES.md. | Stable release is intentionally unshipped and requires a separate PR/release decision. |
| Desktop BRAT smoke | Passed | BRAT 2.2.0 installed and pinned `edonyzpc/personal-assistant` to `2.9.0-beta.2`; runtime manifest loaded beta.2. Settings, empty Chat composer and prepared source-backed Recap opened; no provider call was added and `dev:errors` was empty. | None for the exercised desktop beta path. |
| iPhone BRAT smoke | Passed | BRAT 2.2.0 was installed/enabled in the iCloud `test` vault, selected beta.2, persisted the frozen version and reloaded runtime `2.9.0-beta.2`. Safari Inspector measured the Pet at 44×44; Mirroring taps closed/reopened the Bubble; fresh Console was empty. Release `main.js`/`styles.css` byte-match both installs and manifest semantics match. | Mobile smoke did not rerun provider-backed generation; it verified packaging, load, layout and interaction. |

## Residual Work

| Backlog ID | Item | Restart condition | Historical basis |
| --- | --- | --- | --- |
| [B-116](../../../backlog.md#已延期的产品与工程工作) | Original Pagelet dogfood residuals: double-Ctrl, Chat Quick Command, `pa-related` Sync, Weekly Review compatibility and Pattern LLM. `replace_selection` remains under B-101/T-003. | Restart only when the item-specific real dogfood, compatibility, conflict or cost condition in Backlog is met. | [Historical redesign tracker](../../../archive/pa-product-redesign-development-tracker.md) and this package's [dogfood analysis](./pagelet-v29-dogfooding-analysis.md). |

## Information Disposition

| Source artifact / information | Unique information | Destination | Disposition | Why safe |
| --- | --- | --- | --- | --- |
| [Feature Home](./README.md) | One-page B-108 scope, authority and terminal delivery snapshot | [Archived Feature Home](./README.md) | archive | It remains the package entry but no longer drives active execution. |
| [Delivery Plan](./plan.md) | Delivery phases, risks, rollback and historical authorization boundary | [Archived Plan](./plan.md) | archive | Completed plan retains why the work was sequenced and bounded this way. |
| [Software Design Document](./sdd.md) | Implemented consent, outcome, quality, limiter/cache and lifecycle design | [Archived SDD](./sdd.md) | archive | Current behavior authority remains in Product Specs/Decisions; the SDD preserves implementation rationale. |
| [Development Tracker](./tracker.md) | F-01 through F-20, traceability and formal validation/release evidence | [Archived Tracker](./tracker.md) | archive | It is the complete historical execution record and all findings are terminal. |
| [Validation Handoff](./handoff-pagelet-v29-validation.md) | Stepwise formal validation, physical-evidence boundaries and provider smoke history | [Archived Handoff](./handoff-pagelet-v29-validation.md) | archive | Its remaining unique evidence is historical, not a current checklist. |
| [Dogfood Analysis](./pagelet-v29-dogfooding-analysis.md) | beta.1 diagnosis, rejected directions and action rationale that led to B-108 | [Archived Analysis](./pagelet-v29-dogfooding-analysis.md) | archive | Current product behavior has been absorbed by Decisions/Specs; historical diagnosis remains useful provenance. |
| [This Closeout](./closeout.md) | Final result, BRAT delivery, residual work and information disposition | [Archived Closeout](./closeout.md) | archive | It is the terminal historical authority for this track. |
| [DEC-017](../../../product/decisions/dec-017-default-background-recap-preparation.md) | Background preparation choice and trust boundary | [Current DEC-017](../../../product/decisions/dec-017-default-background-recap-preparation.md) | durable contract | Accepted decision still governs current behavior. |
| [DEC-018](../../../product/decisions/dec-018-quality-gated-scope-recap-hints.md) | Quality-gated proactive hint choice | [Current DEC-018](../../../product/decisions/dec-018-quality-gated-scope-recap-hints.md) | durable contract | Accepted decision still governs current behavior. |
| [DEC-019](../../../product/decisions/dec-019-honest-layered-recap-fallback.md) | Honest layered failure fallback | [Current DEC-019](../../../product/decisions/dec-019-honest-layered-recap-fallback.md) | durable contract | Accepted decision still governs current behavior. |
| [DEC-020](../../../product/decisions/dec-020-independent-quiet-recall-evaluation.md) | Independent Quiet Recall evaluation | [Current DEC-020](../../../product/decisions/dec-020-independent-quiet-recall-evaluation.md) | durable contract | Accepted decision still governs current behavior. |
| [Scope Recap Product Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md) | B-108 requirements, acceptance criteria and user behavior | [Current Scope Recap Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md) | durable contract | It remains the owning Current Product Spec. |
| [Quiet Recall Product Spec](../../../product/specs/pa-quiet-recall-insight-timing-product-spec.md) | Recall timing/provenance supporting contract | [Current Quiet Recall Spec](../../../product/specs/pa-quiet-recall-insight-timing-product-spec.md) | durable contract | It remains current beyond this delivery track. |
| [Bubble Readiness Product Spec](../../../product/specs/pagelet-bubble-readiness-and-recall-product-spec.md) | Bubble/Pet delivery and interaction contract | [Current Bubble Spec](../../../product/specs/pagelet-bubble-readiness-and-recall-product-spec.md) | durable contract | It remains current beyond this delivery track. |
| [Pagelet Product Design](../../../product/pagelet-product-design.md) | Current Pagelet model and cross-surface design | [Current Pagelet Design](../../../product/pagelet-product-design.md) | durable contract | It remains the current Pagelet design authority. |
| [Delivery Preparation Note](../../../product/specs/pagelet-delivery-preparation-consolidation-product-note.md) | Supporting consolidation narrative | [Current Delivery Note](../../../product/specs/pagelet-delivery-preparation-consolidation-product-note.md) | durable contract | It remains useful current narrative but not a second behavior authority. |
| [Eval Harness Product Spec](../../../product/specs/pa-eval-harness-product-spec.md) | Durable Recap/Recall evaluation expectations | [Current Eval Harness Spec](../../../product/specs/pa-eval-harness-product-spec.md) | durable contract | It remains a shared product-quality contract. |
| [Pagelet SDD Guide](../../../development/workflows/pagelet-sdd-guide.md) | Reusable design/delivery workflow | [Current Pagelet SDD Guide](../../../development/workflows/pagelet-sdd-guide.md) | durable contract | It is reusable process guidance, not B-108 execution state. |
| [BRAT Beta Testing Runbook](../../../operations/brat-beta-testing.md) | Current beta identity and next-beta operating sequence | [Current BRAT Beta Testing Runbook](../../../operations/brat-beta-testing.md) | durable contract | It records `2.9.0-beta.2` as the published prerelease and keeps future beta/stable operations separate from this archived track. |
| [Original residual scope](../../../backlog.md#已延期的产品与工程工作) | Deferred work and exact restart conditions | [Backlog B-116](../../../backlog.md#已延期的产品与工程工作) | backlog | Every excluded item has a stable ID, boundary and restart trigger. |
| [GitHub prerelease](https://github.com/edonyzpc/personal-assistant/releases/tag/2.9.0-beta.2) and [Actions run](https://github.com/edonyzpc/personal-assistant/actions/runs/29685255023) | Public package identity, assets and CI result | [Tracker validation log](./tracker.md#validation-log) | archive | The external links preserve verifiable delivery evidence without making release metadata a product contract. |

No B-108 artifact is deleted after absorption.

## Archive Move

- Destination: `docs/archive/2026/pagelet-b108-dogfood-followup/`
- Destination preflight: Absent.
- Terminal authority: Closed Product track; Accepted DEC-017 through DEC-020 and the Current Scope Recap Product Spec remain outside Archive.
- Direct annual records: none.
- Complete package destination: `docs/archive/2026/pagelet-b108-dogfood-followup/`.
- Package documents changed to `Document status: Archived` during the move: `README.md`, `plan.md`, `sdd.md`, `tracker.md`, `closeout.md`, `handoff-pagelet-v29-validation.md`, `pagelet-v29-dogfooding-analysis.md`.
- Active Registry removed: yes.
- Annual Archive index updated: yes.
- Backlog source item removed only after this document references its outcome: B-108 was already promoted out of Backlog; residual scope remains as B-116 and now links this archived package.
