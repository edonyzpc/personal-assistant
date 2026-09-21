# PA Agent empty-answer investigation — 2026-09-21

Initial investigation scope: current post-B-143 source at `9809cd9`, plus uncommitted
debug observability. That phase included no timeout, admission, retry, source
authorization or completion policy fix. The owner authorized GPT-6 implementation/validation of
observability after the configured GLM preflight returned quota exhaustion.

## Confirmed local incomplete failure

User reproduction: edit a note, observe yellow Memory status, submit Chat.
Live target: desktop Obsidian, `anthelion`, plugin manifest `2.10.0-beta.12`,
configured provider `qwen`, model `deepseek-v4-pro`. The user's other-device
screenshots and DeepSeek transcript are inputs, not evidence from this machine.

The final live probe recorded the following relative to `streamTurn:start`
at Unix milliseconds `1789979899237`:

| Relative time | Observation |
| --- | --- |
| Before run | Chat lease acquisition took 24,093 ms, outside the following idle window |
| +23–24 ms | Model creation completed in 1 ms |
| +52 ms | First local admission rejection |
| +1,293 / 4,292 / 11,573 / 26,188 / 51,424 ms | Same rejection repeated |
| +60,026 ms | `streamTurn` resolved; measured duration 60,027 ms |
| +60,033 ms | First subsequent fetch began, after the answer run ended |

All six admission errors were exactly:
`Writing generation sources changed before provider dispatch`.
There was no observed native fetch during this run. Serialized injected-context
fingerprints were unchanged during the rejection sequence. No `search_memory`
execution occurred in the failed answer path.

Read-only inspection afterward established:

- `getVaultInsightsSnapshot()` returned a snapshot.
- The integration's Vault Insights source receipt was `null`.
- A newly created `getMemoryExtractionPromptContext()` immediately returned
  `isSourceCurrent() === false`.
- Its input provenance was Personal `none`, Insights `unknown/governed`.
- Insights could report `ready` while its receipt was absent.
- At `1789980537086`, a source receipt was present again, and a newly
  created context returned `true` again. No settings or source-guard bypass was
  used to obtain that recovery.

`insights.state = unknown` is an identity-description state, not proof of stale
sources: current governed Insights use it too. The invalidity evidence is the
missing receipt plus the false currentness guard. The later inspection proves
recovery of these facts, but does not identify which scheduler job restored them.

The raw content-free probe is retained locally at
`/tmp/pa-agent-debug-20260921/live-records.json`; it contains timings and hashes,
not note or request bodies. This machine-local file is supporting evidence,
not a portable repository dependency.

## Source-level causal chain

1. `src/plugin/vault-event-bridge.ts` invalidates Insights provenance on note
   changes. `src/memory/plugin-integration.ts::invalidateVaultInsightsSourceForFile`
   clears the aggregate receipt. This source revocation is intentional.
2. `extraction-scheduler.ts::getVaultInsightsSnapshot` continues returning the
   cached snapshot. `getVaultInsightsStatus` checks the data boundary, but not
   that receipt. `plugin.ts::readGovernedVaultInsightsSnapshot` supplies the
   cached material to governed selection without checking current provenance.
3. `getMemoryExtractionPromptContext` therefore selects Insights text and adds
   an already-false `isSourceCurrent` guard. Fresh projection does not imply
   usable sources; equality of text does not imply equality of provenance.
4. Native Chat establishes a `writingRequest` even for ordinary conversation
   (`chat-view.ts`, `nativeWriting` branch). Runtime's prepared generation
   snapshot includes background provenance. Its synchronous admission rejects
   the invalid background before any answer fetch.
5. Installed LangChain `AsyncCaller` defaults to six retries with randomized
   exponential backoff. A plain host `Error` is retried. Retrying the same
   serialized request cannot renew its captured source guard.
6. `ModelChunkConsumer.nextChunk` starts the 60-second idle timer before the
   first `iterator.next()`. That interval includes preparation and SDK retry
   waits. The loop maps expiration to `assistant_idle_timeout`, leaving no
   answer and obscuring the underlying local source rejection.

This is a background Memory projection/admission coordination defect, amplified
by retry classification and timeout attribution. It is not evidence of slow
vector search or an answer-provider HTTP failure. Increasing the idle timeout
alone cannot make revoked provenance valid. The analysis does not establish
which commit originally introduced the defect.

## Other screenshots: separate evidence bounds

The textual `<tool_calls>` screenshot is from another device; its exact provider
payload is unavailable. Current code exposes a concrete recovery conflict:
source declaration rejection asks the model to correct the declaration, while
answer completion policy can treat failed-only tool observations as
`tool_failure` and transition to `final_answer_only`. Runtime then exports no
ordinary tool schemas. A nonempty text body containing literal `<tool_calls>`
is text, not a native tool call; the loop can complete with the prior warning.
This explains a supported path to the symptom, but does not prove that exact
remote screenshot used that path. A local earlier turn did contain
`invalid_instruction_quote`, without the same XML text.

Likewise, the remote `Thinking complete` plus blank body screenshot has no raw
turn record here. Current loop tests classify pure reasoning/empty output as
incomplete; whitespace counts as nonempty in the loop but can render blank.
That is a possible code path, not a proven diagnosis of the screenshot.

## Observability delivery and validation scope

Filter developer logs by `PA Agent trace`. Correlate service `chatRequestId`,
runtime `runId`, `turnId` and physical HTTP `requestId`. Preparation, admission,
HTTP dispatch/response/error, first deltas, tool outcomes, host policy and final
lifecycle are separate events. HTTP calls lacking Agent scope explicitly carry
null run/turn IDs. Body content, credentials and arbitrary metadata are excluded.
These logs are metadata observations, not full request/response dumps.

Risk → minimum evidence:

- Observer interference → original Promise/error identity and broken sink tests.
- False timings → composed HTTP/scoped logger test keeps HTTP and run clocks distinct.
- Privacy/off overhead → unknown-code redaction, no body parse when disabled,
  native-runtime disabled-observer test.
- This admission failure → runtime fixture with stale Insights provenance,
  background rejection reason and zero admitted model input.
- Shared transport/runtime changes → `make deploy` (lint/build/full Jest),
  source DOM scan, documentation check, then deployed test-vault runtime probe.

Validation results:

- PASS: final `make deploy`, natural exit 0; platform guards, lint, production
  build/type check, **315 suites / 7,968 tests**, and test-vault asset copy.
  Log: `/tmp/pa-agent-debug-20260921/deploy-final.log`. An earlier full run was
  explicitly stopped as superseded by the review correction; it is not PASS evidence.
- PASS: `npm run docs:check`; four pre-existing episodic-Memory documentation
  findings remain advisory. `git diff --check` and the runtime DOM source scan
  also passed (the latter returned 1 with no matches).
- PASS: test-vault plugin reload and loaded `chat_start` marker. A synthetic
  host and intercepted fixture SSE response exercised the **deployed bundle's
  actual AIUtils / SDK / runtime / loop** in Obsidian. Two fixture requests
  completed; debug enabled produced 48 trace records, disabled added zero.
  HTTP and terminal records shared run/turn identity; literal `<tool_calls>`
  was flagged as text, with zero native tool calls. HTTP timing and run timing
  remained separate. Fresh developer capture contained no errors.
- This smoke used **no real provider calls** and no user note input. It proves
  deployed logging wiring, not real-provider behavior or the remote screenshot.
  Evidence: `/tmp/pa-agent-debug-20260921/app-smoke-result.json`.
- Cleanup: restored fetch, disposed fixture runtimes, removed transient globals,
  detached temporary debugger capture in both vaults, uninstalled the anthelion
  live probe, and returned focus to anthelion. Required logs/scripts remain in
  the task's `/tmp/pa-agent-debug-20260921` directory.

The new bundle was deployed to **test only**. The anthelion failure was observed
on its existing bundle, and its plugin was not replaced. These results do not
claim a deployed root-cause fix. No repository commit or publication was performed.

## Initial Memory failure repair direction (superseded by final repair below)

Keep provenance fail-closed. Exclude unavailable Insights when constructing a
fresh Chat background and let Chat answer with admissible context while
background maintenance catches up. Distinguish local admission failures from
retryable network errors. Report preparation/source rejection separately from
provider idle. For tool recovery, evaluate a bounded corrected-declaration turn
without widening authority; never execute textual XML as a tool call.

## Follow-up: source declaration recovery repair

The owner subsequently requested fixing the confirmed tool-call issue. The
current local run `run_mub0fhwu_jfatygg3` provides direct evidence for the recovery
defect: `notes=current_note` plus `noteHandles` caused `invalid_declaration`;
both declaration and current-note read were rejected before execution, and the
model ended with an inability-to-read answer. Its canonical status was
`completed`, with `tool_batch_preflight_rejected` retained as a UI warning. This
run did not contain the remote screenshot's literal XML text.

The follow-up implements one narrowly scoped declaration correction per run:

- Only complete Host source-preflight batches rejected for `invalid_declaration`
  or `invalid_instruction_quote` qualify, with unique matching native call/result
  identities and consistent rejection metadata.
- Recovery precedes required-capability failure handling, so a rejected but
  unexecuted current-note read can be tried after correcting its declaration.
- No control snapshot or source constraint is widened; the corrected batch is
  revalidated by the original executor. Repeat failure enters existing bounded
  finalization. Already-finalizing runs and authority/lifecycle failures do not
  receive this allowance.
- Schema descriptions and source instructions now explicitly forbid
  `noteHandles` outside `notes=selected`. Prompt instructions distinguish native
  tool execution from literal XML/JSON examples and discourage fake execution
  envelopes in prose.

This corrects the confirmed recovery conflict. It does not parse or strip answer
text, and does not guarantee that every provider will obey the prompt. Literal
tool-call text remains non-executable. The separate stale-Insights admission
defect above is outside this follow-up implementation.

Validation mapping: real executor/loop red-to-green regression for both allowed
reasons and zero preflight reads; policy negative cases for authority, receipts,
final-only and retry bounds; service-to-runtime tool-schema retention on repair
and removal after exhaustion; then one frozen full gate and deployed runtime
smoke. Source fixtures and simulated transport are distinguished from provider
behavior. Full-gate and app evidence for this follow-up are recorded separately
from the preceding observability-only build.

Follow-up validation results:

- PASS: both executor/loop regressions failed before the fix and passed after it.
  Four focused suites passed 126 tests; the service suite passed 68 tests.
  Logs: `/tmp/pa-agent-debug-20260921/source-repair-{red,focused,service}.log`.
- PASS: frozen `make deploy`, natural exit 0, including platform guards, lint,
  production build/type check, **315 suites / 7,988 tests**, and verified asset
  copy to the test vault. Jest printed its delayed-exit warning, then exited
  naturally; no force-exit option was used.
  Log: `/tmp/pa-agent-debug-20260921/source-repair-deploy.log`.
- PASS: reloaded test-vault bundle exercised through its actual AIUtils, SDK,
  runtime and loop with fixture SSE transport. Both scenarios made three fixture
  requests. Corrected declaration retained native schemas and performed exactly
  one note read; the next request contained its evidence. Repeated invalid
  declaration performed zero reads and removed all tools for finalization.
  Both ended `completed` with zero admission errors; fresh developer capture
  contained no errors. Evidence:
  `/tmp/pa-agent-debug-20260921/source-repair-app-result.json`.
- No real provider calls or user note input were used. This proves deployed
  recovery wiring, not provider compliance or reproduction of the remote XML
  screenshot. Independent read-only review found no new P1/P2 findings.
- Restored fetch, disposed fixture runtimes/timers, deleted the temporary result,
  detached debug capture and returned focus to anthelion. Deployment remains
  **test only**; anthelion's plugin was not replaced. No commit or publication.

## Follow-up: completed status with a blank body

The owner authorized code diagnosis and fixing confirmed defects for the remote
`Thinking complete` / empty-body symptom. Two source-level paths were reproduced;
the remote provider payload remains unavailable, so neither is asserted as that
particular screenshot's proven cause.

1. `PaAgentLoop` treated `pendingText.length > 0` as a successful or partial
   answer. Reasoning plus spaces/newlines could therefore end `completed`, even
   though the renderer displayed no body. A whitespace `stop` also incorrectly
   established completed content before a failing transport tail. Before the
   fix, four regression cases returned completed/completed-with-warning rather
   than incomplete/error.
2. Native ordinary Chat also uses the writing preview bridge. A source receipt
   can be valid at dispatch but invalid by output delivery. The bridge cleared
   the preview, then silently returned from its ordinary-text branch without
   recovery. The loop still reported completed. Runtime integration reproduced
   this by revoking admitted background after the first preview; bridge tests
   independently covered invalidation before and after content arrival.

Fixes preserve original answer whitespace but require a non-whitespace character
for completion, partial-answer retention and completed-content transport handling.
The existing observation-based finalization allowance now also handles whitespace
and remains bounded; no new universal retry is introduced. Ordinary text checks
the same source receipt as preview before commit and again after Host Policy,
withdrawing invalid output and emitting `assistant_source_changed`. Source checks
do not weaken cancellation, native artifact or non-text Host output contracts.
The bridge emits source-changed recovery with no raw/preview text, and the UI
explains the withdrawal without suggesting recovery from an empty original.
History uses the final run status rather than the earlier model turn status.

Validation mapping: loop blank/idle/stop-tail and bounded-finalization regressions;
bridge source validity controls and late Host Policy invalidation; runtime receipt
wiring; ChatView feedback plus history reopen; independent review, one frozen
full deployment gate, and a deployed SDK/runtime probe using fixture transport.
Pure reasoning-only output was already incomplete; hidden reasoning itself is
not evidence that valid answer text was deleted. Markdown comments/invisible
syntax and missing terminal events were not reproduced and are not claimed fixed.

Follow-up validation results:

- Red evidence: four whitespace cases and the runtime source-withdrawal status
  case failed as expected before the loop fix (`blank-answer-red.log`, 5 failed /
  116 passed). Native ordinary bridge recovery had two independent failures
  before its fix (`/tmp/pa-agent-bridge-source-recovery-red.log`).
- Focused loop/runtime/UI checks passed 409 tests; bridge checks passed 19 tests,
  including source invalidation during an actual awaited Host Policy and
  simultaneous cancellation. Review found the late-policy window; the final
  delivery receipt recheck and persisted terminal precedence closed it.
- PASS: frozen `make deploy`, natural exit 0, platform guards/lint/production
  build/type check, **315 suites / 8,003 tests**, and verified test-vault copy.
  Jest printed a delayed-exit warning, then exited naturally without force-exit.
  Log: `/tmp/pa-agent-debug-20260921/blank-answer-deploy.log`.
- PASS: deployed Obsidian bundle, actual SDK/runtime/loop with intercepted fixture
  SSE: whitespace plus reasoning ended incomplete with `assistant_empty_response`;
  valid ordinary text completed; revoked ordinary background ended incomplete
  with `assistant_source_changed`, empty recovery text and no answer snapshot.
  Each made one fixture request; zero real provider calls and no user note input.
- PASS: a DOM-driven Chat fixture exercised preview withdrawal, a completed model
  turn followed by incomplete delivery, visible recovery feedback, persistence
  and plugin reload. Live and reopened UI both showed `Answer incomplete` and the
  source-changed hint, with no withdrawn body. The actual window screenshot was
  inspected. This is targeted DOM/runtime evidence, not native pointer/keyboard
  or real-provider reproduction of the remote screenshot.
  Evidence: `/tmp/pa-agent-debug-20260921/blank-answer-app-result.json` and
  `/tmp/pa-agent-debug-20260921/blank-answer-ui.png`; fresh developer capture had
  zero errors.
- Cleanup restored fetch and service methods, disposed fixture runtimes/timers,
  removed the exact fixture conversation, restored the original empty test chat
  and draft, deleted temporary globals, detached debugger capture and returned
  focus to anthelion. The anthelion bundle remains unchanged. No commit/publication.
- Documentation check, diff check and the runtime DOM source scan passed; four
  existing episodic-Memory documentation findings remain advisory.

Related runtime logging contract:
[PA Agent runtime lifecycle](../../architecture/pa-agent-runtime-lifecycle-plan.md#debugging-one-run).

## Final completeness audit and remaining repairs

The owner explicitly authorized completing all confirmed defects. The audit found
the initial Memory admission chain was still open, plus two completion edge cases.
Current changes close the following paths without changing source authorization:

- Fresh governed and legacy Chat omit missing/revoked Insights and retain valid
  Personal. Background maintenance need not finish before the answer is sent.
- Same-source, same-facts refresh reuses a live aggregate receipt (only generatedAt
  is ignored for fact equality). Host withdrawal has a separate publication epoch;
  an old guard cannot revive through null followed by republishing the same object.
  File identity/stat, source epoch, data boundary and real fact changes still revoke.
- Physical background validation uses the captured source receipt when supplied,
  avoiding false rejection when only refresh metadata changes. Hosts without a
  receipt retain the string comparison. Actual Personal/Insights revocation remains
  terminal even when serialized text is unchanged.
- Physical preparation/admission errors are explicitly nonretryable through the
  real SDK cause chain, including bound model copies. Background and authority
  rejection cannot enter stream-to-invoke fallback. Explicitly classified history
  or Vault projection changes retain the existing one-time fallback with fresh
  input preparation, removal of stale evidence and renewed admission. 429/500
  retry and per-send checks remain; no timeout increase or guard bypass is used.
- Request-aware runtime models arm incremental idle only at admission. Preparation
  remains bounded by existing soft/hard deadlines; buffered timing is unchanged.
- Blank output plus conflicting finish markers cannot be completed-with-warning.
  A tool_calls finish without native calls is incomplete and cannot become committed
  answer text. Both ordinary bridge delivery and canonical Chat withdraw its preview.
  Normal stop with a legitimate XML example remains text; no textual tool execution.

Validation mapping: plugin/scheduler receipt and fresh-selection regressions;
installed-SDK native/Obsidian stream/invoke retry tests; runtime serialized-input
receipt tests; fake-clock preparation/idle/deadline tests; loop/bridge/UI completion
tests; independent cross-layer review; one frozen full deployment gate followed by
fixture-only probes of the deployed Obsidian bundle. This updates the earlier
follow-up boundary: the stale-Insights chain is now within implementation scope.

The separate 24,093 ms Chat lease wait precedes the failure window. Its coordinator
serializes Chat with a running Pagelet turn; it does not wait for Memory refresh.
The original trace does not establish which run held that lease, so it is not
claimed as a second diagnosed Memory defect.

The first full test gate exposed six existing multimodal/history integration
regressions from disabling every local-error fallback. The failed gate is not
PASS evidence. Those tests require safe re-projection after rejecting an old
serialized payload; their assertions are retained. Recovery classification was
narrowed to preserve that existing behavior while keeping SDK retries of locally
rejected payloads disabled.

Final validation results:

- PASS: final frozen `make deploy`, natural exit 0: platform guards, lint,
  production build/type check, **316 suites / 8,050 tests**, verified asset copy
  to `test/.obsidian/plugins/personal-assistant`. Jest emitted its delayed-exit
  notice and then exited naturally; no force-exit was used.
  Log: `/tmp/pa-agent-debug-20260921/final-complete-deploy.log`.
- PASS: deployed actual SDK/runtime/loop with intercepted fixture SSE. Blank
  response was incomplete; valid answer completed; delivery-time revocation
  cleared preview and ended incomplete; missing native tools cleared preview,
  emitted `provider_tool_calls_missing` and produced no answer snapshot. Physical
  background revocation performed **one admission / zero HTTP calls**, ending
  with `provider_admission_rejected`; a still-live receipt with refreshed background
  text performed one call and completed. No real provider calls were made.
  Evidence: `/tmp/pa-agent-debug-20260921/final-runtime-app-result.json`.
- PASS: deployed scheduler/integration and governed-reader fixture. Same-facts
  refresh preserved the captured guard; explicit source invalidation kept cached
  data but omitted it from both legacy and governed Chat; refreshing afterward
  admitted a new context without reviving the old guard. No user note content
  was read. Evidence: `/tmp/pa-agent-debug-20260921/final-memory-app-result.json`.
- PASS: final bundle's source-declaration correction matrix again retained tools
  for one correction, read one fixture note after valid correction, and performed
  zero reads plus final-only delivery after repeat rejection.
  Evidence: `/tmp/pa-agent-debug-20260921/final-source-app-result.json`.
- PASS: DOM-driven Chat fixture displayed incomplete plus a clear tool-request
  warning, with no literal tool envelope in the body. Plugin reload retained
  incomplete and empty answer content. Inspected actual expanded-panel screenshot:
  `/tmp/pa-agent-debug-20260921/final-tool-ui.png`; metadata:
  `/tmp/pa-agent-debug-20260921/final-ui-app-result.json`. This is app-runtime/DOM
  and screenshot evidence, not native pointer/keyboard or real-provider evidence.
- Independent cross-layer review found no remaining P1/P2 in the final scoped
  changes. Documentation/diff/runtime DOM source checks passed; the four existing
  episodic-Memory documentation findings remain advisory.
- Cleanup restored fetch and service methods, disposed fixture runtimes/scheduler,
  deleted the exact temporary conversation, restored the empty test chat and draft,
  removed probe globals, detached debug capture and returned focus to anthelion.
  Fresh developer error capture was empty. Evidence files remain under the task's
  `/tmp/pa-agent-debug-20260921` directory. The bundle remains deployed to **test
  only**; anthelion was not replaced. No commit, push or release was performed.

All confirmed code defects above are repaired. The other-device screenshots still
lack original provider payloads; in particular a normal `stop` response containing
literal XML is not automatically a protocol violation and is not stripped globally.
