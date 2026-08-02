# Operations Agent Step 3 — Pagelet Integration Software Design Document

Document status: Current
Design status: Approved
Delivery status: Closed
Updated: 2026-08-01
Work item: B-101
Implementation step: Step 3 — Pagelet insight action and Chat handoff
Authority: [Owner decision record](../proposal-review-response-2026-07-28.md), [Operations capability direction](./agent-operations-capability.md), and the owner's explicit Step 3 implementation authorization on 2026-08-01.
Restart condition: Step 3 is closed. Any additional direct action or write capability requires a new work item, independent demand evidence, and explicit owner authorization.
Handoff: [Implementation Handoff Brief](../implementation-handoff.md)

## 1. Outcome And Scope

Step 3 completes one bounded companion flow:

```text
Deep Discover returns a verified, source-backed insight
  → the user opens the full Pagelet Panel
  → PA offers a context-specific single-note action and a Chat handoff
  → direct action: stage only → inline preview → explicit confirm/cancel
  → confirmed action uses the Step 2 Operations executor and drift-safe Undo
  → complex path: open a new Chat with the complete visible insight context
  → the user decides what to ask and whether any later Chat proposal is written
```

In scope:

- A context-specific action row on the first Deep Discover finding in the
  user-opened Panel. The proactive Bubble remains `View` / `Later` only.
- One deterministic direct action: add a one-way `pa-related` link from the
  anchor note to one verified non-anchor source by staging
  `frontmatter_update` through the shared Operations layer.
- Pagelet-local inline preview, Confirm, Cancel, result, and Undo states.
- A typed Pagelet → Chat handoff containing the complete visible insight,
  anchor/source snapshots, all source references, why-now context, verified
  web URLs, trigger, preparation time, and pipeline identity.
- One plugin-owned Operations service, a singleton four-tool provider, and
  surface-scoped intent sessions for Chat and Pagelet.
- Focused tests, review/fix, `make deploy`, test-vault smoke, and real-vault
  read/write dogfood under the existing per-vault Operations opt-in.

Out of scope:

- New write tools, bidirectional or multi-file Pagelet writes, rename/move,
  delete, folder creation, arbitrary commands, shell, script, or `eval`.
- Background or confirmation-free writes.
- Parsing free-form insight prose into arbitrary tool calls.
- Passing hidden model thinking, tool transcripts, prompts, or chain of
  thought to Chat.
- Auto-sending the Chat composer, replacing a user draft, or treating the
  handoff itself as write authority.
- A durable Pagelet action history or cross-restart handoff attachment.

## 2. Source-Verified Baseline

| Current source | Verified behavior | Step 3 disposition |
| --- | --- | --- |
| `src/pagelet/agent/types.ts` | Verified insight retains body, anchor/source snapshots, cache identity, trigger, time, and web observations. | Preserve these fields in a typed handoff projection; exclude metrics and hidden runtime transcript. |
| `src/pagelet/agent/delivery-adapter.ts` | Projection currently drops snapshot identity and web observations. | Attach an immutable Pagelet integration context to the delivery candidate. |
| `src/pagelet/bubble/BubbleContent.ts` | Agent insight Bubble has `View` and `Later`. | Keep it quiet and unchanged; writes appear only after the user opens the full finding. |
| `src/pagelet/orchestrator.ts` | `openAgentInsightPanel()` owns the first full insight finding and current-source invalidation. | Add action state and typed host calls here; preserve `preparedReadOnly:true`. |
| `src/pagelet/panel/types.ts` / `PanelLayouts.ts` | `PanelFinding.actions` already renders actions inside a finding. | Reuse it for stage/confirm/cancel/result/Undo; add only the minimum disabled/busy semantics needed. |
| `src/ai-services/operations/operations-intent-controller.ts` | Staging is non-mutating; execute and Undo re-check boundary and exact content. | Reuse unchanged as the write safety core. |
| `src/ai-services/chat-service.ts` | Each view owns a controller, while runtime constructs a new Operations provider each turn. | Inject a surface session and the plugin-owned provider; keep test-compatible fallbacks. |
| `src/ai-services/operations/operations-tool-provider.ts` | Every `load()` creates four new capability objects. | Cache the four capabilities once per plugin-owned provider. |
| `src/chat/chat-view.ts` | Composer prefill protects non-empty drafts; New Chat reset is private; no typed attachment exists. | Add one atomic public handoff entry and a visible session attachment; never auto-send. |
| `src/ai-services/context/PaAgentContextProjector.ts` | Context-only tagged projections escape their closing boundaries. | Add a Pagelet evidence block with the same escaping and explicit no-authority attributes. |

## 3. Product Routing Contract

The Deep Discover final answer remains free-form Markdown. Step 3 does not add
a rigid model output schema and does not infer arbitrary writes from prose.

Local routing is fail closed:

- **Direct**: exactly one existing Markdown target, exactly one deterministic
  operation, all paths belong to the verified insight sources, and no user
  judgment is needed.
- **Chat**: more than one target, any ambiguity, any content-generation or
  organization choice, missing/invalid source state, or an operation outside
  the existing four tools.

The first direct projection is deliberately narrow:

1. Target is the verified anchor note.
2. Related note is the first verified source whose normalized path differs
   from the anchor.
3. PA reads the anchor's current Markdown and computes a deduplicated
   `pa-related` string array containing `[[<source path>]]`.
4. PA stages one `frontmatter_update`; it does not write while preparing.
5. If current frontmatter cannot be parsed, the link already exists, a source
   is no longer current/allowed, or the exact pre-stage body changed, direct
   routing disappears or fails stale and Chat remains available.

The label names both notes, for example: `Link “Design Notes” from “Project A”`.
This is context-specific without asking a second model to invent an action.
One-way linking is intentional: reciprocal links are two-file work and must
route to Chat under the settled simple/complex rule.

## 4. Shared Operations Service

Add a plugin-owned `OperationsService` with:

- one cached `OperationsToolProvider` and the same four capability objects for
  every Chat runtime in that plugin instance;
- a session factory that creates isolated `OperationsIntentController`, Undo
  store, pending intents, event listeners, and lifecycle disposal;
- common audit, Data Boundary, trash, live setting gate, and preview helpers.

Chat and Pagelet share this service and implementation, but not mutable intent
state. A global controller is forbidden because one view's reset/dispose could
cancel another surface's pending proposal or Undo receipts.

Each session exposes only:

```ts
interface OperationsSession {
  readonly provider: OperationsToolProvider;
  stageIntent(input: StageOperationsIntentInput, signal?: AbortSignal): Promise<OperationsIntent>;
  confirm(intentId: string): Promise<OperationsExecutionResult>;
  cancel(intentId: string): OperationsIntent;
  cancelPending(): void;
  undoMany(receiptIds: readonly string[]): Promise<UndoResult[]>;
  subscribe(listener: OperationsEventListener): () => void;
  dispose(): void;
}
```

Both `stageIntent` and `confirm` re-check build availability plus the persisted
per-vault `operationsAgentEnabled` setting. If it is off, pending state is
cancelled and no write/audit record is produced.

`PaAgentRuntime` accepts the injected shared provider. It never creates a
second provider when one was supplied. Pagelet direct actions call their
session directly with a structured core call; the read-only Deep Discover
registry remains `allowWrite:false` and receives no Operations capability.

## 5. Direct Action Lifecycle

Pagelet owns at most one action state for the currently open verified insight:

```ts
type PageletInsightActionState =
  | { kind: "idle" }
  | { kind: "staging" }
  | { kind: "pending"; intent: OperationsIntent }
  | { kind: "executing"; intent: OperationsIntent }
  | { kind: "result"; result: OperationsExecutionResult }
  | { kind: "undoing"; result: OperationsExecutionResult }
  | { kind: "undone"; results: UndoResult[] }
  | { kind: "error"; message: string };
```

Panel behavior:

- Idle: show the context-specific link action and `Discuss in Chat`.
- Staging/executing/undoing: show a calm inline busy status; duplicate taps are
  inert.
- Pending: show target, exact property preview, expiry-safe Confirm and Cancel.
- Result: show per-operation result and Undo only for successful receipts.
- Error/stale: show a short explanation and keep Chat available.
- `preparedReadOnly:true` remains set, so legacy Save Review Note and Expand
  controls stay hidden while finding actions remain available.

Close, Escape, source/policy invalidation, setting disable, candidate
replacement, or plugin unload cancels any pending intent. A confirmed write is
not interrupted mid-execution, but no unconfirmed work survives the surface.

### Self-write events

The controller's existing `markSelfWrite(path)` hook feeds a Pagelet-local,
counted, short-TTL registry. The next matching vault event is consumed once.
This prevents Pagelet's own Confirm/Undo from closing the result card before
the user can see it. After success the proactive candidate is retired, while
the open result card and Undo receipt remain. Any later external modify,
delete, or rename still closes the stale Panel and cancels pending state.

## 6. T10 Pagelet → Chat Handoff

Use a neutral typed envelope shared by Pagelet, Chat, and the context projector:

```ts
interface PageletChatHandoffContext {
  version: 1;
  id: string;                 // verified cache identity hash
  body: string;               // complete visible insight; never truncated
  anchor: PageletAnchorSnapshotIdentity;
  sources: PageletAgentSourceSnapshot[];
  sourceRefs: Array<{ path: string; title?: string }>;
  webUrls: string[];
  whyNow: string[];
  triggerReason: string;
  preparedAt: number;
  pipelineVersion: string;
}
```

For T10, “reasoning” means the final user-visible, source-backed argument in
`body` plus `whyNow`; it never means hidden chain of thought. Metrics, raw tool
prompts, tool observations, and loop transcripts are excluded.

Before opening Chat, Pagelet revalidates the exact policy identity and every
anchor/source snapshot without a provider call. Stale or newly excluded input
fails closed.

`LLMView.preparePageletHandoff(context)` is atomic:

1. Return `busy` if a turn is streaming and `draft-conflict` if the composer
   contains a different user draft.
2. Use the existing New Chat reset transaction, preserving the previous
   conversation in history and discarding its pending Operations proposal.
3. Store the immutable handoff as a visible `From Pagelet` attachment and
   prefill only a short editable intent; do not paste the body into the user
   prompt and do not send automatically.
4. On the first explicit Ask, pass the typed attachment through
   `StreamLLMOptions` and `PaAgentStreamOptions`.
5. After a successful finalized turn, mark the attachment consumed so it is
   not re-injected. On provider failure it remains available for an explicit
   retry. New Chat, removal, conversation switch, or view close clears it.

The attachment is intentionally session-bound for Step 3. Closing/reloading
before Ask requires reopening it from Pagelet; no incomplete context is
silently restored from Chat history.

The context projector emits a boundary such as:

```xml
<pagelet_handoff
  context_only="true"
  source="pagelet_deep_discover"
  grants_tool_authority="false"
  grants_write_authority="false">
  ...
</pagelet_handoff>
```

All text uses the existing tagged-boundary escaping. The user prompt remains
the only Operations write-intent signal, so note/insight text cannot make write
tools eligible.

## 7. Staleness And Data Boundary

Add a read-only controller validator that compares:

- current policy identity to the insight's cached identity;
- current anchor and every source material to their path/mtime/size/hash;
- current Pagelet and shared Data Boundary allow decisions;
- expected pipeline version and cache identity hash.

Validation performs no model/provider call and does not refresh or replace an
insight. It runs before direct staging and before Chat attachment creation.
Operations independently re-checks its write target at stage, confirmation,
execution, and Undo. Passing the Pagelet check never grants write authority.

## 8. UI, Accessibility, And Copy

- Bubble stays low-pressure: `View insight` / `Later` only.
- Panel finding actions are ordinary `type="button"` controls with at least
  44px mobile targets, wrapped long labels, focus-visible styling, disabled
  state, and exactly-once handlers.
- Pending/result status uses `aria-live="polite"`; busy controls use
  `aria-busy` and remain keyboard operable.
- Chat shows a visible, removable `From Pagelet` attachment with title,
  complete insight, all vault/web sources, and verification time.
- All new copy has English/Chinese parity and uses product language; internal
  terms such as VSS, tool registry, snapshot, and controller remain hidden.
- DOM is constructed with element/text APIs only. No runtime `<style>`,
  `innerHTML`, or `outerHTML` is introduced.

Settings copy states that the existing per-vault Operations toggle enables
confirmed changes proposed from both Chat and Pagelet. No second write toggle
is added.

## 9. Failure Semantics

| Failure | User-visible behavior | Write result |
| --- | --- | --- |
| Operations disabled before stage/confirm | Action unavailable or calm inline explanation | Zero writes |
| Source/policy/pipeline stale | “Insight changed; run Deep Discover again” | Zero writes |
| Frontmatter invalid or link already exists | Direct action omitted/fails closed; Chat remains | Zero writes |
| Target changes after preview | Stale result; user must restage | Zero writes |
| Panel closes while pending | Pending intent cancelled | Zero writes |
| Confirmed operation fails | Per-operation result; no invented success | Existing Step 2 semantics |
| Undo target drifted | Undo reports stale | Zero rollback writes |
| Chat streaming or has draft | Handoff refused without replacing state | Zero provider calls |
| Chat handoff validation fails | Pagelet remains open with retry guidance | Zero provider calls |
| Provider fails after Ask | Attachment retained; user chooses retry | No automatic retry |

## 10. Test And Validation Plan

Focused automated coverage:

1. Shared Operations service
   - provider/capability identity is stable across Chat turns;
   - Chat and Pagelet pending/Undo/dispose state is isolated;
   - live setting off at stage/confirm produces zero writes.
2. Direct projection
   - exactly one anchor target and one verified non-anchor source;
   - `pa-related` merge/coercion/dedup from exact Markdown;
   - changed pre-stage body retries/fails stale instead of overwriting;
   - multi-file/ambiguous/invalid input has Chat only.
3. Pagelet Panel
   - Bubble remains View/Later;
   - `preparedReadOnly` still hides Save/Expand while actions render;
   - click stages only, Confirm writes once, Cancel/close/Escape writes zero;
   - own modify event preserves result/Undo; external change invalidates;
   - success, stale, failure, and drift-safe Undo states.
4. T10 handoff
   - >500-character multiline body and every vault/web source survive intact;
   - hidden transcript/prompt/metrics are absent;
   - CTA alone makes zero provider calls; one Ask makes one call;
   - draft/streaming/deferred leaf paths preserve state;
   - closing-tag and prompt-injection strings stay inside `context_only`;
   - handoff text alone does not expose Operations tools.
5. Locale/community gates
   - English/Chinese key parity;
   - no runtime style/HTML injection regressions.

Local gate:

```bash
npm test -- --runInBand <focused Step 3 suites>
npx tsc -noEmit -skipLibCheck
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

Runtime validation:

1. `make deploy` into `test/`.
2. In the test vault, verify explicit Deep Discover → Panel → staged link →
   Cancel; repeat → Confirm → visible result → Undo.
3. Verify Panel → Chat with complete visible attachment, no auto-send, one
   user Ask, then an existing Step 2 save proposal/confirm/Undo.
4. In the real vault, select current, allowed source-backed insights and run
   both the direct and Chat routes. Record which note fragments were sent to
   the configured Qwen provider and any WebSearch verification used.

## 11. Completion Criteria

Step 3 may close only when:

- context-specific Pagelet actions are visible in the full insight card;
- direct single-note action uses inline confirm/cancel and the Step 2 executor;
- complex action opens Chat with complete T10 context and no auto-send;
- Chat and Pagelet demonstrably share the plugin Operations layer while their
  mutable intent sessions remain isolated;
- focused tests, review/fix, `make deploy`, test-vault smoke, and real-vault
  full-flow dogfood pass;
- current product/proposal documents describe the delivered boundary and no
  new write capability beyond the existing four tools was introduced.

## 12. Closeout Evidence — 2026-08-01

Implementation and review:

- Added one plugin-owned `OperationsService` with stable four-capability
  identity and isolated Chat/Pagelet sessions; Deep Discover remains read-only.
- Delivered deterministic one-way `pa-related` staging, inline preview,
  Confirm/Cancel/result/Undo, and a typed complete Pagelet → Chat attachment
  that never auto-sends or inherits write authority.
- Integrated review fixes closed execution-close recovery, receipt-preserving
  teardown, serialized/abortable Chat preparation, semantic wikilink dedupe,
  and fail-closed Chat persistence/attachment consumption.
- Focused gate passed 18 suites / 1080 tests plus TypeScript, lint,
  documentation, whitespace, and community source-injection checks.
- `make deploy` passed 177 suites / 3750 tests, lint, type-check, Tailwind,
  build, and deployment into the repo-local test vault.

Test-vault dogfood:

- The provider-free runtime runner recorded 26 PASS, one intentional protected
  durable-Memory BLOCKED result, and zero unexpected failures.
- The configured Qwen provider (`deepseek-v4-flash`) produced a verified
  source-backed contradiction insight from the temporary ignored fixtures
  `step3-deep-discover-anchor.md`, `step3-deep-discover-safety.md`, and
  `step3-deep-discover-product.md`.
  Direct-action Cancel preserved the original SHA-256; Confirm added exactly
  one `pa-related`; Undo restored the exact original SHA-256.
- The Pagelet attachment retained the complete insight and all three vault
  sources, opened Chat without sending, and was consumed only after one
  explicit successful Ask. No Operations card appeared before that Ask.
- The real 12/hour Deep Discover limit was respected. After it was exhausted,
  one session-only freshness shim reused the already provider-generated result
  solely to finish the Chat attachment UI path; it did not reset/bypass the
  limiter or change production code. Temporary fixtures and runner artifacts
  were removed.

Real-vault dogfood (`anthelion`):

- Qwen Deep Discover produced current source-backed findings for
  `3.literature/理解Smart Note.md`, including
  `2.fleeting/Zettelkasten Note Level.md` and
  `4.permanent/Anthelion Vault 管理逻辑.md`; no WebSearch URL was used.
- With the normal persisted Operations setting temporarily enabled, the actual
  Panel buttons staged the exact `pa-related` change. Cancel wrote nothing;
  Confirm added exactly one link; Undo restored the anchor's original SHA-256
  `36774e45...`.
- The final Pagelet → Chat route used the complete visible insight plus the
  Pagelet references `3.literature/理解Smart Note.md` and
  `4.permanent/Anthelion Vault 管理逻辑.md`. One explicit Ask to Qwen
  (`deepseek-v4-pro`) also included the current-note context and eight selected
  Memory chunks; their four canonical records were the current note,
  `4.permanent/Anthelion Vault 管理逻辑.md`, `README.md`, and
  `4.permanent/permanent-blogging/我的 PKM 系统.md`. The turn returned
  successfully, consumed the attachment, and created no Operations proposal.
- The original plugin assets/data and anchor note were restored byte-for-byte,
  Operations returned to `false`, and the Obsidian error buffer was empty. The
  legitimate 36/day provider quota usage was retained rather than rolled back.
- The Mac later relocked, so validation evidence is the actual Obsidian
  DOM/state and button interactions through the running app, not a claim of a
  fresh compositor screenshot.

No extra write tool, background write, confirmation bypass, limiter bypass,
commit, push, or release was introduced by Step 3.
