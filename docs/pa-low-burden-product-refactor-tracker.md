# PA Low-Burden Product Refactor Tracker

Updated: 2026-06-30

## Status

| Field | Value |
| --- | --- |
| Document type | Development tracker |
| Status | Implemented; automated validation and Obsidian test-vault smoke completed |
| Plan | [PA Low-Burden Product Refactor Plan](./pa-low-burden-product-refactor-plan.md) |
| Product doctrine | [Low-Burden Review Product Principles](./pa-low-burden-review-product-principles.md) |
| Workflow | [Reusable refactor workflow](./refactor-workflow.md) |

## Phase Tracker

| Phase | Status | Goal | Decision gate | Owner files | Required validation | Obsidian smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 0 Source-of-truth alignment | `[x]` | Make specs/docs stop reintroducing the queue-first model. | D1/D4/D6 decisions resolved during implementation. | `docs/pa-*-product-spec.md`, `docs/pagelet-*-product-spec.md`, `docs/pa-product-information-architecture-spec.md`, `docs/pagelet-trust-layer-product-spec.md`, `docs/pa-lightweight-graph-discovery-product-spec.md`, `docs/pa-agent-product-spec-review-plan.md`, `src/locales/pagelet/*`, `src/locales/plugin/*` | `git diff --check`; docs/UI-copy scan; graph-spec/root-spec queue-first scan | Not required | Current specs and UI copy now describe generated graph/maintenance/review artifacts as preview, digest, kept, selected, or action-bearing rather than automatic queue work. |
| Phase 1 Lifecycle policy module | `[x]` | Add shared artifact lifecycle/disposition policy with tests. | None. | `src/pa/review-artifact-lifecycle.ts`, `src/pa/contracts/*`, `__tests__/pa-contracts.test.ts`, new lifecycle tests | Focused lifecycle/contracts tests; `npx tsc -noEmit -skipLibCheck --pretty false`; `git diff --check` | Not required | Lifecycle helpers now classify admission, Bubble reminder eligibility, and Weekly carry-over eligibility. |
| Phase 2 Queue admission refactor | `[x]` | Require user intent or durable consequence before Review Queue creation, including real Pagelet producer paths. | D2/D3/D4/D5/D6 resolved. | `src/pa/review-queue-store.ts`, `src/pa/contracts/review-queue.ts`, `src/settings.ts`, `src/plugin.ts`, `src/pagelet/orchestrator.ts`, `src/pagelet/PageletHost.ts`, `src/pagelet/commands.ts`, `src/pagelet/DiscoveryAnalyzer.ts`, `src/quick-capture-enrichment.ts`, `src/pa/weekly-review.ts`, `src/pa/maintenance-review.ts`, `src/pa/maintenance-review-apply.ts`, `src/pa/graph-discovery.ts`, `src/pa/quiet-recall.ts`, `__tests__/review-queue-store.test.ts`, `__tests__/settings.test.ts`, `__tests__/pagelet-orchestrator.test.ts`, `__tests__/pagelet-commands.test.ts`, `__tests__/weekly-review.test.ts`, `__tests__/maintenance-review.test.ts`, `__tests__/maintenance-review-apply.test.ts`, `__tests__/graph-discovery.test.ts`, `__tests__/quiet-recall.test.ts` | Queue/store/contracts/legacy-migration/quick-capture/weekly/maintenance/apply/graph/quiet-recall/orchestrator/commands/settings tests; type-check; lint | Passed | Queue admission now requires explicit `admissionReason`; legacy items are preserved and marked; Maintenance/Graph no longer enqueue by default; Weekly ignores ordinary generated `suggested` carry-over. |
| Phase 3 Surface refactor | `[x]` | Make Bubble/Panel/Tab/Weekly/Maintenance surfaces obey recognition-first defaults. | D1/D6 resolved. | `src/pagelet/BubbleCoordinator.ts`, `src/pagelet/PageletHost.ts`, `src/pagelet/orchestrator.ts`, `src/pagelet/commands.ts`, `src/pagelet/bubble/*`, `src/pagelet/panel/*`, `src/pagelet/tab/*`, `src/locales/pagelet/*`, `src/custom.pcss`, `src/pa/maintenance-review-apply.ts` | Bubble/panel/tab/orchestrator/commands/locales/maintenance-apply tests; type-check; lint/build; source scan | Passed | Bubble reminders use user-kept/action-bearing eligibility; Panel/Tab copy uses `Kept Items & Actions`; Graph/Maintenance open preview/detail surfaces. |
| Phase 4 Memory and insight trust loop | `[x]` | Keep Saved Insight, Memory, RHP, and Vault Insights durable only after explicit user intent. | D7/D8 resolved. | `src/pa/saved-insight-store.ts`, `src/pa/memory-governance-store.ts`, `src/pa/retrieval-habit-profile.ts`, `src/pa/active-vault-indexer.ts`, `src/pagelet/tab/TabView.ts`, `src/plugin.ts`, `src/settings.ts`, `src/ai-services/AiServiceHost.ts`, `src/ai-services/pa-agent-runtime.ts`, `src/ai-services/context/PaAgentContextProjector.ts`, `src/ai-services/memory-extraction/*`, `src/chat/ConversationPersistence.ts`, `src/chat/chat-view.ts`, `src/chat/ChatHost.ts`, `__tests__/retrieval-habit-profile.test.ts`, `__tests__/active-vault-indexer.test.ts`, `__tests__/memory-extraction.test.ts`, `__tests__/settings.test.ts`, `__tests__/plugin-record-note.test.ts`, `__tests__/pa-agent-context.test.ts`, `__tests__/chat-service.test.ts` | Saved insight, memory governance, retrieval habit, active-vault-indexer, memory extraction, settings, prompt-context, chat, eval tests; no-opt-in feedback tests; first-use extraction/insight confirmation tests | Passed | Memory Extraction and Vault Insights now default to unconfirmed/off until recorded consent; runtime startup, scheduler/model creation, prompt context, and insight commands share the consent gate. |
| Phase 5 Broad scan strategy hardening | `[x]` | Complete Weekly/Maintenance broad-scan controls after the minimum Phase 2/3 safety lands. | D6 resolved. | `src/plugin.ts`, `src/settings.ts`, `src/pa/weekly-review.ts`, `src/pa/maintenance-review.ts`, `src/pa/graph-discovery.ts`, `src/pa/active-vault-indexer.ts`, `src/pagelet/orchestrator.ts`, `src/pagelet/PageletHost.ts`, `src/pagelet/DiscoveryAnalyzer.ts` | Weekly direct-input tests; maintenance/data-boundary/performance tests; graph/provider-preflight tests; caps/cooldown/in-flight tests; full focused Pagelet suite | Passed | Maintenance scan defaults to active note, same folder, and recent 7 days with file/category caps; Weekly passes explicit recent note scope; whole-vault path is not a default runtime precondition. |
| Phase 6 Cleanup/migration/release readiness | `[x]` | Remove stale helpers/copy, add migration/release evidence, and close tracker. | All D1-D8 resolved. | Legacy helpers, docs, release notes, tests | Full Jest, eval, type-check, lint, build, source scan, `make deploy` | Passed | Release/publish was not requested, so no tag, GitHub release, or formal changelog was generated. Release-readiness evidence is recorded below. |

## Implementation Evidence Snapshot

| Finding | Evidence | Residual risk | Phase |
| --- | --- | --- | --- |
| Queue admission requires a durable/user-intent reason. | `ReviewQueueCreateInput` now requires `admissionReason`; store validation rejects missing, invalid, or type-incompatible reasons; legacy items are tagged `legacy_pre_refactor`. | Keep future producers behind the shared admission helpers. | Phase 2 |
| Maintenance and Graph Discovery are preview-first by default. | Host methods only enqueue when `enqueueProposals === true` or `enqueueItems === true`; Pagelet command paths call them with enqueue disabled and open detail previews; Maintenance/Graph/Quiet helper functions require explicit admission reasons. | Apply/keep entry points must continue to use explicit reasons. | Phase 2 / Phase 3 |
| Bubble, Weekly, and Pagelet extras filter by lifecycle. | Shared lifecycle helpers gate Bubble reminders, Weekly carry-over, and Panel/Tab Review Queue extras. | Legacy items remain intentionally visible in Tab-only views for migration safety. | Phase 3 |
| Broad scan defaults are bounded. | Maintenance Review defaults to active note, same folder, and recent 7 days with file/category caps; Weekly Review passes current weekly note paths into Maintenance Review. | No whole-vault UI was added; any future whole-vault entry must add explicit confirmation. | Phase 5 |
| Memory Extraction and Vault Insights are consent-gated. | Missing or legacy consent merges to unconfirmed/off; scheduler startup, provider model creation, prompt context, AI Insights command/viewer, and onboarding notices check recorded consent. | Future extraction consumers must call the same consent helper before provider work or prompt injection. | Phase 4 |
| User-facing copy is lower-burden. | Pagelet/Plugin locales use `Kept Items & Actions`, `Kept for later`, `Actions to confirm`, and selected/save wording; docs align Graph/Trust/IA specs. | Internal code names remain `ReviewQueue` to avoid broad churn. | Phase 0 / Phase 3 |
| Obsidian smoke found and fixed a real visible-panel regression. | Initial smoke showed `.pa-pagelet-panel[data-state=visible]` remained offscreen under transform; desktop panel CSS now slides via `right` and smoke captured visible panel UI. | Keep `src/custom.pcss` and `PanelView.scheduleUnmount()` aligned if panel motion changes again. | Phase 3 |

## Decision Register

| ID | Status | Decision | Recommended default | Owner phase |
| --- | --- | --- | --- | --- |
| D1 | Confirmed / implemented | Rename user-facing "Review Queue" label? | Yes: UI copy says "Kept items" or "Actions to confirm"; internal class names remain `ReviewQueue`. | Phase 3 |
| D2 | Confirmed | Stop Maintenance Review enqueue-by-default? | Yes: preview/category digest first, queue only user-kept/apply-mode/action-recovery items. | Phase 2 |
| D3 | Confirmed | Stop Graph Discovery enqueue-by-default? | Yes: digest/preview first, queue only user-kept edge suggestions. | Phase 2 |
| D4 | Confirmed / implemented | Legacy queue item migration policy? | Preserve in intentional Tab views, exclude from Bubble/Weekly proactive debt, tag as legacy until touched. | Phase 2 |
| D5 | Confirmed | Should Weekly Review consume ordinary suggested queue items? | No: digest sources plus user-kept/action-bearing items only. | Phase 2 |
| D6 | Confirmed / implemented | First large-vault scan scope? | Active note, same folder, and recent 7 days with caps before whole vault; whole-vault requires an explicit internal option and is not a default precondition. | Phase 2 / Phase 5 |
| D7 | Confirmed | Retrieval Habit Profile feedback learning default, retention, and reset? | Default off unless explicitly opted in; define allowed aggregate signals, retention window, and clear/reset behavior. | Phase 4 |
| D8 | Confirmed | Is AI Memory Extraction / Vault Insights first-use confirmation in this refactor scope? | Included; recorded first-use confirmation is a pre-runtime/release blocker for background extraction, vault-insight refresh, provider model creation, and vault-insight prompt injection. Legacy/missing consent defaults to unconfirmed/paused. | Phase 4 / pre-runtime |

## Risk Register

| Risk | Severity | Mitigation | Phase |
| --- | --- | --- | --- |
| Existing users may have useful pre-refactor Review Queue items. | P1 | Legacy migration preserves visibility in Tab but avoids proactive reminders. | Phase 2 |
| Legacy items could be dropped by validation before migration. | P1 | Add review queue schema/version migration before normalization rejects missing `admissionReason`. | Phase 2 |
| Refactor could accidentally remove safety confirmation. | P1 | Keep Memory, generated notes, source-note writes, external actions behind confirmation tests. | All runtime phases |
| Queue-neutral scans might hide useful suggestions too aggressively. | P2 | Provide explicit Keep/Save/Apply entry points and digest expansion. | Phase 3 / Phase 5 |
| Copy rename could diverge from internal type names and confuse tests. | P2 | Keep internal `ReviewQueue` names, adjust only user-facing locale strings and docs. | Phase 3 |
| Large-vault scans may be slow or noisy. | P1 | Scope-first scan controls, Data Boundary before read/provider work, caps per section. | Phase 5 |
| Large-vault scans may block Weekly Review before first value appears. | P1 | Move minimum Weekly/Maintenance scan caps and direct-input gating into Phase 2/3. | Phase 2 / Phase 5 |
| Provider-backed discovery can bypass normal cost/privacy preflight. | P2 | Route discovery through shared Pagelet provider preflight before model invocation. | Phase 3 / Phase 5 |
| Future-behavior learning may be enabled without explicit user intent. | P2 | D7 confirmed: implement default-off RHP learning, allowed aggregate signals, retention window, and clear/reset behavior before retrieval influence. | Phase 4 |
| Memory Extraction / Vault Insights may run or inject before consent. | P1 | D8 confirmed: add consent/version migration defaulting missing consent to unconfirmed/paused; gate startup, scheduler, provider calls, prompt context, and legacy installs. | Phase 4 / pre-runtime |
| Current tests may encode default-on Memory Extraction behavior. | P2 | Update settings/memory-extraction/context/chat tests so the new no-consent path is the expected baseline. | Phase 4 |

## Validation Log

| Date | Scope | Command / evidence | Result | Residual risk |
| --- | --- | --- | --- | --- |
| 2026-06-29 | Plan creation | Source review of North Star, low-burden principles, refactor workflow, Review Queue, Quick Capture enrichment, Weekly Review, Maintenance Review, Graph Discovery, Quiet Recall, and plugin orchestration entry points. | Plan/tracker created. | No runtime behavior changed yet. |
| 2026-06-29 | Plan/tracker review remediation | Subagent findings reviewed across product contract, architecture/migration, code landing map, and scan/privacy lanes; plan/tracker patched for confirmed doc gaps. | Docs updated. | Runtime behavior still unchanged; follow-up implementation must satisfy the new gates. |
| 2026-06-29 | User decision update | User confirmed D7 recommended default and confirmed D8 inclusion in this refactor. | Decision register updated. | Runtime behavior still unchanged. |
| 2026-06-30 | Review follow-up remediation | Applied second review findings to plan/tracker: D8 pre-runtime gate, D7/D8 scope/done definition, D2/D3/D5 confirmed constraints, Phase gate timing, owner/test maps, evidence/risk tables. | Docs updated. | Runtime behavior still unchanged; D1/D4/D6 remain open or provisional. |
| 2026-06-30 | Low-burden runtime implementation | Implemented lifecycle/admission policy, producer default changes, legacy migration, bounded scan defaults, Pagelet/Bubble/Weekly filtering, Graph/Maintenance preview paths, Memory Extraction consent gate, locale/spec cleanup, and Pagelet panel visibility fix. | Runtime/docs/tests updated. | No release/tag/publish was requested or performed. |
| 2026-06-30 | Focused checks | `npx tsc -noEmit -skipLibCheck --pretty false`; focused Jest coverage for review queue/contracts/quick capture/quiet recall/weekly/maintenance/graph/pagelet/settings/memory extraction/RHP/active vault paths; `npm test -- __tests__/pagelet-panel-tab-view.test.ts --runInBand` after panel fix. | Passed. | Focused checks are supplemented by full `make deploy`. |
| 2026-06-30 | Full local gate | `make deploy` after the final Pagelet panel fix. It ran full Jest, lint, build, Tailwind, esbuild production bundle, and copied plugin assets into `test/.obsidian/plugins/personal-assistant/`. | Passed: 131 suites, 2235 tests. | None for automated local gate. |
| 2026-06-30 | Community-source scan and whitespace | `rg -n "createElement\\([\"']style[\"']\\)|\\.innerHTML\\s*=|\\.outerHTML\\s*=" src`; `git diff --check`. | Passed: source scan had no matches; whitespace check passed. | Future DOM/CSS changes still need the same scan. |
| 2026-06-30 | Obsidian runtime smoke | `open -a Obsidian`; `obsidian version vault=test`; `obsidian vault info=path vault=test`; `obsidian plugin:reload id=personal-assistant vault=test`; `obsidian open path=pagelet-smoke-golden.md vault=test`; `obsidian command id=personal-assistant:pa-pagelet:open-panel vault=test`; DOM/eval checks for `.pa-pagelet-panel`; `obsidian dev:errors vault=test`. | Passed after fixing desktop panel slide-in: plugin enabled, panel in viewport, no errors. | Initial sandbox CLI calls could not find Obsidian until rerun with host permission for local IPC. |
| 2026-06-30 | Obsidian UI evidence | `obsidian dev:screenshot selector=.pa-pagelet-panel path=/private/tmp/pa-low-burden-pagelet-panel-element.png vault=test`; visual inspection of screenshot. | Passed: Pagelet panel visible, readable, and shows `Recent Review`, selected current note scope, source count, and `Review selected (1)` / `Expand to tab` actions. | A full macOS screenshot was rejected by permission review due unrelated-screen risk; app-scoped Obsidian screenshot was used instead. |
| 2026-06-30 | Queue-growth command smoke | Queue count before commands was 5; executed `personal-assistant:pa-pagelet:maintenance-review`, `personal-assistant:pa-pagelet:graph-discovery`, and `personal-assistant:pa-pagelet:weekly-review`; queue count after commands remained 5; `dev:errors` showed no errors; Pagelet detail copy showed `Kept Items & Actions`. | Passed: preview/digest commands did not create default queue growth. | Existing 5 test-vault queue items remain visible as kept/action/legacy data. |
| 2026-06-30 | Completion audit follow-up | Re-read plan/tracker and scanned current implementation for admission bypasses and source-of-truth drift. Tightened `maintenanceProposalToReviewQueueInput()` to require explicit `admissionReason`; aligned remaining current root-spec examples away from generic `accepted` / `needs review` and old Graph primary-queue wording. | Audit fixes applied. | Historical/pre-refactor wording remains in the low-burden plan itself as problem statement; internal code statuses still include `accepted`. |
| 2026-06-30 | Completion audit focused gate | `npm test -- --runTestsByPath __tests__/maintenance-review.test.ts __tests__/review-queue-store.test.ts __tests__/graph-discovery.test.ts __tests__/pagelet-orchestrator.test.ts`; `npx tsc -noEmit -skipLibCheck --pretty false`; `rg -n "maintenanceProposalToReviewQueueInput\\([^,\\n]+\\)" src __tests__`. | Passed: 4 suites / 48 tests; type-check clean; no maintenance helper call without explicit admission reason. | Supplemented by full `make deploy`. |
| 2026-06-30 | Completion audit full gate | `make deploy`; `rg -n "createElement\\([\"']style[\"']\\)|\\.innerHTML\\s*=|\\.outerHTML\\s*=" src`; `git diff --check`. | Passed: 131 suites / 2235 tests, lint, build, deploy; source scan no matches; whitespace check clean. | None for automated gate. |
| 2026-06-30 | Completion audit Obsidian smoke | Obsidian `1.13.1`, vault `test`; plugin reload; Pagelet panel visible DOM `state=visible`, `left=636`, `right=1016`, `width=380`, `innerWidth=1016`; screenshot `/private/tmp/pa-low-burden-final-panel-visible.png`; Maintenance/Graph/Weekly commands left Review Queue count `5 -> 5`; `dev:errors` no errors. | Passed. | First `open-panel` command toggled a hidden existing panel; second command produced the verified visible state. |

## Review Log

| Date | Scope | Reviewer | Result | Findings | Disposition |
| --- | --- | --- | --- | --- | --- |
| 2026-06-29 | Plan draft | Codex main agent | Ready for user review | Main architectural issue is queue-first artifact lifecycle. | Wait for user decisions before runtime phases. |
| 2026-06-29 | Plan/tracker subagent review | Codex + 4 subagents | Changes required | P1 migration gap, P1 scan strategy too late, P2 missing orchestrator producer/consumer gates, P2 Weekly suggested cleanup misplaced, P2 graph spec contradiction, P2 over-broad retry admission reason. | Plan/tracker remediation applied; D7/D8 later confirmed by user. |
| 2026-06-29 | D7/D8 product decisions | User | Confirmed | D7 accepts default-off RHP feedback learning; D8 includes AI Memory Extraction / Vault Insights first-use confirmation in this refactor. | Phase 4 scope updated. |
| 2026-06-30 | Refactor plan/tracker review follow-up | Codex main agent | Changes applied | P1 D8 gate too late/incomplete; P2 scope/done definition missed D7/D8; P2 D2/D3/D5 left open; P2 tracker gate/owner/test map incomplete; P3 D7 retention/reset and root review-plan source missing. | Plan/tracker patched; runtime implementation still pending. |
| 2026-06-30 | Runtime implementation and smoke closeout | Codex main agent | Passed after fix | Obsidian smoke found Pagelet panel visible-state CSS stuck offscreen under transform. | Replaced desktop transform slide-in with `right` transition, rebuilt/deployed, and verified visible app-scoped screenshot plus no queue growth. |

## Implementation Notes

- Future producers must not call `createReviewQueueItem()` for generated
  read-only candidates unless they have a valid lifecycle admission reason.
- Keep legacy queue items visible in intentional Tab views, but do not let them
  power Bubble reminders or Weekly carry-over unless the item is touched and
  reclassified.
- Do not reintroduce Maintenance Review or Graph Discovery enqueue-by-default;
  preview/digest is the default surface, and queue state belongs to
  user-kept/action-bearing items.
- Keep direct generated-object-to-queue helpers explicit. Maintenance, Graph,
  and Quiet Recall queue conversion helpers should require an admission reason
  at the callsite.
- Any future whole-vault Maintenance/Weekly/Graph entry must add an explicit
  scope confirmation before reading/sending broad note content.
- Any future Memory Extraction or Vault Insights consumer must call the shared
  recorded-consent gate before scheduler startup, provider model creation,
  refresh, prompt injection, or command/viewer work.
- If Pagelet panel motion changes again, rerun Obsidian visual smoke. The
  2026-06-30 smoke found that transform-based desktop slide-in could leave the
  panel offscreen despite `data-state=visible`.
- Release/publish was intentionally not performed in this refactor turn. Draft
  release note: "PA review surfaces are now lower-burden: generated candidates
  stay ignorable by default, Review Queue focuses on kept/action-bearing items,
  broad scans open as bounded previews, and Vault Insights/Memory Extraction
  require recorded first-use consent."
