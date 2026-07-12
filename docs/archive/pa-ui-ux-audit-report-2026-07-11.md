# PA UI/UX Targeted Audit — 2026-07-11

## Status

| Field | Value |
| --- | --- |
| Audit scope | Current local `HEAD` (`ab361220`), focused on Memory control center and affected Settings, Pagelet, Quiet Recall, and Chat surfaces |
| Framework | [PA UI/UX Review Framework](../development/workflows/pa-ui-ux-review-framework.md) |
| Product baseline | [PA Product North Star](../product/pa-product-north-star.md) and effect/risk-based Memory governance |
| Method | Three-lane source audit, cross-agent adversarial verification, real Obsidian 1.13.1 Settings inspection, focused implementation loop |
| Initial findings | 20 deduplicated P0-P2 candidates |
| Verified findings | 16 confirmed, 4 partially confirmed, 0 false positives |
| Severity after verification | 0 P0, 7 P1, 13 P2 |
| Implementation status | Complete for the approved quick-fix scope; no open P0-P2 implementation findings |
| Visible smoke | Completed 2026-07-12 in Obsidian 1.13.1 against the repo-local `test` vault |

This is a targeted refresh of the July 3 baseline. It does not rescore every PA
surface. The changed product slice is the new Memory control center and the
cross-surface routes that explain or act on Memory and Quiet Recall.

## 1. Evaluation Scope

| Lane | Primary surfaces | Primary files |
| --- | --- | --- |
| Settings | Memory overview, governed details, Recent changes, Data and recovery | `src/settings.ts`, `src/pa/memory-control-center.ts`, `src/pa/memory-governance-view.ts` |
| Pagelet | Contextual Memory, Quiet Recall cards, empty/error states, Settings deep links | `src/pagelet/tab/*`, `src/pagelet/contextual-memory.ts` |
| Cross-surface | Chat Memory entry, proactive Recall, terminology, consequence/control consistency | `src/chat/chat-view.ts`, `src/pa/quiet-recall.ts`, `src/pagelet/orchestrator.ts`, locales |

## 2. Targeted Score Heatmap

Scores use the framework's 1–5 rubric. They are source- and observed-UI-based
review scores, not product analytics.

| Surface | A1 | A2 | A3 | A4 | B1 | B2 | B3 | B4 | B5 | B6 | Avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Settings overview | 4.0 | 4.0 | 3.0 | 3.0 | 4.0 | 4.0 | 4.0 | 3.0 | 3.0 | 3.0 | **3.5** |
| Settings lifecycle + recovery | 3.7 | 4.0 | 3.7 | 3.7 | 4.0 | 4.3 | 4.0 | 3.7 | 4.0 | 3.3 | **3.8** |
| Pagelet contextual Memory | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 | 4.0 | 5.0 | 3.0 | 3.0 | 4.0 | **3.8** |
| Quiet Recall | 3.0 | 4.0 | 2.0 | 2.0 | 4.0 | 2.0 | 5.0 | 4.0 | 5.0 | 4.0 | **3.5** |
| Chat + cross-surface consistency | 3.0 | 4.0 | 3.0 | 3.0 | 4.0 | 3.0 | 4.0 | 3.0 | 4.0 | 3.0 | **3.4** |
| **Dimension avg** | **3.5** | **4.0** | **3.1** | **2.9** | **4.0** | **3.5** | **4.4** | **3.3** | **3.8** | **3.5** | |

Strongest qualities are capture isolation, quiet on-demand governance, and
theme-consistent visual styling. The weakest dimension is content clarity,
followed by interaction quality and consequence/control consistency.

## 3. Adversarial Verification Summary

The highest initial finding — Quiet Recall linking — was downgraded from P0 to
P1 after verification. It requires an explicit click, checks the active note and
Data Boundary, and rolls back the first frontmatter write if the second fails.
It remains P1 because one click changes both notes without previewing the two
targets or asking for current-turn confirmation, while the current product spec
explicitly routes vault mutation through the Write Action Framework.

| ID | Verified finding | Status | Severity | Route |
| --- | --- | --- | --- | --- |
| QR-1 | Quiet Recall Link updates both notes without consequence preview/current-turn confirmation | Confirmed | P1 | Quick fix |
| QR-2 | Generated Recall title, summary, why-now, and next action are hard-coded English | Confirmed | P1 | Quick fix with locale input; reason-code refactor deferred |
| QR-3 | Zero-candidate Quiet Recall payload is discarded before its dedicated empty state renders | Confirmed | P1 | Quick fix |
| QR-4 | Proactive Recall accepts the first unsuppressed candidate without an explicit high-confidence threshold | Confirmed | P1 | Quick fix using the existing score-65 delivery threshold |
| ST-1 | A failed Correct action rebuilds Settings and discards the user's draft | Confirmed | P1 | Quick fix |
| ST-2 | Full Memory overview load failure says only “partly unavailable” and offers no retry | Confirmed | P1 | Quick fix |
| ST-3 | Device-only finalization can auto-expand two warning blocks even when legacy counts are 0/0 | Partially confirmed + observed in app | P1 | Quick fix |
| ST-4 | Saved-understanding overview merges active, paused, and stale counts | Confirmed | P2 | Quick fix |
| ST-5 | Recent changes hides the event kind whenever a content label exists | Confirmed | P2 | Quick fix |
| ST-6 | The whole asynchronous overview body is an `aria-live` region | Partially confirmed | P2 | Quick fix |
| ST-7 | Correct Save silently accepts an enabled no-op state for empty/unchanged text | Confirmed | P2 | Quick fix |
| ST-8 | Data and recovery is always expanded and precedes the more useful Recent changes | Confirmed | P2 | Quick fix; full repair-owner consolidation deferred |
| PG-1 | Contextual Memory reuses global candidate copy and shows a candidate empty state before used records | Confirmed | P2 | Quick fix |
| PG-2 | Pagelet timestamps use UTC slices while Settings uses localized device time | Confirmed | P2 | Quick fix |
| PG-3 | Contextual claim reload failure falls into a generic expired-result page | Confirmed | P2 | Deferred: needs a dedicated recoverable state contract |
| CH-1 | Chat's Memory menu opens the plugin root rather than the Memory group | Confirmed | P2 | Quick fix |
| EV-1 | Multi-source Saved Insight matching can use one source while showing/linking the first source | Confirmed | P2 | Quick fix: prioritize the matched source for display and choose a distinct source for linking |
| EV-2 | Settings note provenance is plain text and conversation provenance is overly generic | Partially confirmed | P2 | Deferred: safe navigation/history contract needed |
| DS-1 | Forget is visually grouped with ordinary actions and the shared confirm modal has no danger tone | Partially confirmed | P2 | Deferred to shared confirmation-tone change |
| TX-1 | `Memory/记忆`, `vault/仓库`, and `静默回忆/安静回忆` drift across surfaces | Confirmed | P2 | Canonicalize Pagelet Recall now; shared glossary follow-up |

## 4. Real Obsidian Baseline Evidence

`make deploy` completed against the existing `test` vault after reusing the
workspace dependency installation. Full Jest, lint, TypeScript, Tailwind, and
bundle generation passed before deployment.

Visible Settings inspection confirmed:

- the top-level Memory summary cards and current-vault boundary are readable;
- details are appropriately collapsed;
- `Finish device-only setup` was expanded by default;
- the expanded block showed an orange “other devices may depend on 0 saved
  items and 0 review items” warning plus a second orange not-ready warning;
- `Data and recovery` appeared before `Recent changes` and remained fully
  expanded even when prevention-marker count was zero.

Baseline screenshot:

`settings-memory-before.jpeg` in the task visualization directory.

## 5. Decision Routing

### Implement directly

- Close all seven verified P1 findings.
- Apply narrow P2 fixes that share the same touched code and do not require a
  new product decision: status breakdown, event-kind clarity, targeted Settings
  routing, contextual copy, local time, matched source, accessible loading, and
  advanced recovery disclosure.

### Defer as structural/shared work

- Full Write Action Framework integration with durable audit and Undo for
  frontmatter links. This iteration adds explicit two-target preview and
  confirmation; audit/Undo remains a dedicated action-framework slice.
- Structured Recall reason codes that can be re-localized after persistence.
- A dedicated recoverable contextual-Memory reload state.
- Safe conversation-history provenance navigation.
- A shared danger-tone confirmation component and a repository-wide product
  terminology glossary.
- Consolidating all local-index repair controls into the new Data and recovery
  owner; the current quick fix only corrects disclosure order and default state.

## 6. North Star Assessment

Before fixes, Quiet Recall fails the trust questions for preview/recovery and
consequence-bound confirmation. The Memory control center otherwise respects
the current product direction: it is on-demand, source/scope/effect aware,
contains no unread or inbox-zero mechanics, and keeps Settings as the only full
governance destination.

The implementation gate is complete: focused and full tests, typecheck,
community DOM scan, independent review, deployment, and visible post-fix smoke
all passed. The intentionally deferred structural work remains routed as a
separate product/architecture slice rather than being hidden inside this closeout.

## 7. Implementation Closeout

### Delivered in this iteration

- Added a two-target consequence preview and current-turn confirmation before
  Quiet Recall writes `pa-related`; same-note links now fail closed before file
  lookup, confirmation, or frontmatter mutation.
- Applied the existing score-65 threshold to proactive Recall, localized
  generated Recall copy, restored the dedicated empty state, removed the
  persisted English relation marker, and kept matched-source evidence separate
  from the distinct link target.
- Preserved failed correction drafts, added accurate load failure/retry states,
  split active/paused/stale counts, exposed event kind, narrowed live-region
  announcements, and disabled empty or unchanged corrections.
- Kept 0/0 non-actionable finalization quiet and collapsed while preserving
  warnings for pending/reconcile/recovery states; moved Data and recovery after
  Recent changes into collapsed progressive disclosure with a 44px narrow-view
  target.
- Added contextual Pagelet copy and local time, and routed Chat's Memory entry
  directly to Memory settings.

### Verification log

| Gate | Result |
| --- | --- |
| Integrated focused suites | Pass — 6 suites / 567 tests |
| Full repository Jest | Pass — 155 suites / 2900 tests |
| TypeScript + ESLint | Pass |
| Tailwind + production bundle + test-vault deployment | Pass via `make deploy` |
| Community DOM injection scan | Pass — no matches |
| `git diff --check` | Pass |
| Independent post-implementation review | Pass — cross-review found no remaining P0–P2 |
| Visible Obsidian post-fix smoke | Pass — Settings, Chat route, Quiet Recall confirmation/cancel, and console inspection |

### Visible post-fix evidence

The deployed plugin was fully restarted before final inspection because an
already-open Settings window retained its pre-deploy DOM after the ordinary
community-plugin reload. After restart, the loaded UI matched the current
bundle:

- **Settings:** the 0/0 device-only finalization state was collapsed and showed
  no orange warning; active/paused/needs-refresh counts were separated; Recent
  changes appeared before a collapsed Data and recovery disclosure.
- **Chat:** clicking the Memory status chip and then Open settings opened the
  independent Settings window directly at Memory & Personalization rather
  than the plugin root.
- **Quiet Recall:** the dedicated command showed five source-backed candidates.
  Link to current note opened a current-turn modal naming
  `pagelet-smoke-golden.md` and `Weekly Product Review.md`, explained the
  reciprocal `pa-related` Property effect, and stated that note bodies remain
  unchanged.
- **Cancel safety:** Cancel restored keyboard focus to Link to current note and
  showed “No links were added.” SHA-256 hashes for both notes were identical
  before and after the interaction.
- **Runtime console:** the fresh post-restart console contained three
  informational startup messages and no errors.

Screenshots in the task visualization directory:

- `settings-memory-after.jpeg`
- `chat-memory-settings-route.jpeg`
- `quiet-recall-link-confirm.jpeg`
- `quiet-recall-after-cancel.jpeg`

### Explicitly deferred, non-blocking structural work

The structural/shared items in Section 5 remain intentionally deferred. They
are not hidden failures of this iteration: durable Write Action audit/Undo,
structured Recall reason codes, a dedicated contextual reload contract,
provenance navigation, shared danger tone, terminology governance, and full
repair-owner consolidation each require a broader product or architecture
slice.
