# Operations Agent Step 2 — Software Design Document

Document status: Current
Design status: Approved
Delivery status: Closed
Updated: 2026-08-01
Work item: B-101
Implementation step: Step 2 — Operations Phase 1 / Chat conclusions to vault
Authority: [Owner decision record](../proposal-review-response-2026-07-28.md) and [Operations capability direction](./agent-operations-capability.md); owner authorized implementation on 2026-08-01.
Restart condition: Step 2 closed on 2026-08-01; reopen only for a confirmed Step 2 regression. Step 3 was separately authorized, delivered, and closed under its own SDD; every write capability outside the four core tools still requires a new owner decision.
Handoff: [Implementation Handoff Brief](../implementation-handoff.md)

## 1. Outcome And Scope

Step 2 makes one bounded product flow functional:

```text
Chat reaches a conclusion
  → user asks to save, or PA offers one quiet save suggestion
  → model chooses a vault target and emits structured core tool calls
  → PA freezes one intent and shows one inline preview card
  → user confirms or cancels
  → confirmed operations execute sequentially
  → card shows per-operation results and drift-safe Undo
```

In scope:

- Exactly four structured tools: `vault_create`, `vault_append`, `vault_process`,
  and `frontmatter_update`.
- Explicit save requests and one proactive save suggestion per conversation.
- Model-selected vault-relative Markdown targets, with `0.unsorted/` as the
  required fallback when no better target can be justified.
- On-demand action tool exposure, bundled `obsidian-markdown` guidance, one
  intent-level inline confirmation, atomic existing-note mutation, content-free
  audit, short-lived Undo, focused tests, `make deploy`, and vault dogfood.

Out of scope:

- Pagelet action buttons or Pagelet → Chat handoff (Step 3).
- Rename, move, trash/delete-file, folder creation, arbitrary Obsidian commands,
  shell, script, eval, DOM actions, arbitrary filesystem access, or MCP writes.
- Background or confirmation-free writes.
- Persistent write-history UI or durable rollback snapshots.
- `replace_selection`, the old append-only modal flow, and cleanup of historical
  proposal files.

## 2. Current Source Baseline

The following names and seams were verified against current source before this
design was approved:

| Current source | Verified behavior | Step 2 disposition |
| --- | --- | --- |
| `src/operations-agent-flags.ts` | `OPERATIONS_AGENT_RUNTIME_ENABLED=false` | Change to a build availability gate; persisted user opt-in remains separately required. |
| `src/settings.ts` / `src/plugin.ts` | loaded setting is overwritten by the build flag; host getter ignores the toggle | Correct to `build gate && persisted user toggle`; add suggestion/audit settings. |
| `src/ai-services/policy-engine.ts` | supports `chat-with-actions`, `allowWrite`, and `local-filesystem-write` | Reuse unchanged as the permission gate. |
| `src/ai-services/capability-registry.ts` | policy-registers actions but exports only `kind="tool"` | Export policy-approved actions only when the current run selected Operations tools. |
| `src/ai-services/pa-agent-runtime.ts` | injects append + selection scaffolds when enabled; action executor is optional | Replace those providers with one four-tool provider and an Operations staging executor. |
| `src/ai-services/chat-service.ts` | does not wire write-action UI/runtime | Own a per-view Operations controller and pass an inline UI bridge per turn. |
| `src/ai-services/pa-agent-prompts.ts` | says all tools are read-only and forbids note modification | Split the instruction by bound capability: absent actions remain read-only; bound core actions only stage a proposal. |
| `src/ai-services/pa-agent-tool-dispatcher.ts` | executes buffered calls individually | Add an optional batch-prepare seam so all action calls in one assistant tool phase form one intent. |
| `src/ai-services/write-action-framework/target-confinement.ts` | robust path-spoof/traversal/dotfolder checks; create-oriented collision check | Reuse the pure path checks; existing-file operations use operation-specific existence rules. |
| `src/ai-services/write-action-framework/stale-reread.ts` | content-hash stale concepts exist | Preserve the invariant, but compare the exact frozen baseline inside `vault.process()`. |
| `src/ai-services/write-action-framework/preview-modal.ts` | confirmation is a blocking Modal | Do not use it for Step 2; confirmation is a non-blocking Chat card. |
| `src/ai-services/write-action-framework/append-action.ts` | `read → modify` and blind rollback | Do not use its write/rollback implementation. Existing-note mutations use `vault.process()`. |
| `src/ai-services/bundled-skills.ts` | bundled skill id `obsidian-markdown` exists | Prompt requires loading it before generating substantial Markdown content. |
| `src/chat/chat-view.ts` | canonical live assistant message owns stable DOM outside Markdown render buffer | Mount proposal/result cards beside the live assistant content without runtime HTML/style injection. |
| `src/chat/chat-history-store.ts` | conversation records are extensible objects | Persist only suggestion state (`offered/declined/accepted`), never pending content or rollback snapshots. |

Proposed production modules:

```text
src/ai-services/operations/
  types.ts
  input-validation.ts
  vault-path.ts
  vault-transform.ts
  operations-tool-provider.ts
  operations-intent-controller.ts
  operations-tool-executor.ts
  operations-undo-store.ts
  operations-audit-store.ts
  save-suggestion-policy.ts
  index.ts
```

## 3. Core Tool Contracts

All schemas use `additionalProperties: false` except the value map inside
`frontmatter_update.set`. Runtime validation is authoritative even if a provider
accepts an invalid nested schema.

```ts
type VaultCreateInput = {
  path: string;
  content: string;
};

type VaultAppendInput = {
  path: string;
  content: string;
};

type VaultProcessInput = {
  path: string;
  operation: "replace" | "insert" | "delete";
  params:
    | { search: string; replace: string; occurrence?: "first" | "all" }
    | { anchor: { heading: string } | { line: number }; position: "before" | "after"; content: string }
    | { section: string }
    | { from: number; to: number };
};

type FrontmatterUpdateInput = {
  path: string;
  set?: Record<string, JsonLikeValue>;
  delete?: string[];
};
```

Rules:

- All paths are normalized vault-relative `.md` paths, max 200 characters.
- Absolute paths, drive letters, traversal, control/invisible characters,
  trailing dot/space, and protected `.obsidian`, `.git`, `.trash`, or backup
  paths fail before a preview is shown.
- `vault_create` requires a missing target and an existing parent folder. It
  never overwrites and does not implicitly create folders (T12).
- The other three tools require an existing `TFile` Markdown target.
- Each action also re-checks the shared Data Boundary path decision when the
  host exposes one; a denied target does not reach preview or audit.
- Per-operation supplied and actual generated content are each capped at
  50,000 characters. For `replace/all`, actual generated characters are
  `matchCount × replacement length` and are checked before constructing output.
  A single transformation may grow its target by at most 200,000 characters;
  one intent contains at most 16 operations and 200,000 actual generated
  characters in total.
- `vault_process.replace` uses literal string matching only; regular
  expressions are neither accepted nor constructed (T13).
- Heading parameters are visible heading text without a `#` prefix. Markdown
  headings inside fenced code are ignored. Missing or duplicate matching
  headings fail instead of guessing (T14).
- Line anchors and delete ranges are 1-based; delete ranges are inclusive.
- Frontmatter rejects `__proto__`, `prototype`, and `constructor` at every
  nested level. At least one non-empty `set` or `delete` change is required.

## 4. On-Demand Discovery And Prompt Contract

The host performs a narrow multilingual write-intent check over the latest user
message. Positive examples include explicit create/save/append/update requests
and the synthetic request emitted by the Save suggestion button. A positive
check does not authorize a write; it only makes the four action schemas eligible
for this run.

When write intent is absent:

- The four schemas are not bound or included in planner definitions.
- `PolicyEngine` remains default-deny for action execution.
- The model may answer and, if the local suggestion policy qualifies, the UI may
  offer one save suggestion after the answer.

When write intent is present and Operations is enabled:

- The four action capabilities are policy-exported alongside needed read/skill
  tools; source-only constraints must not accidentally remove them.
- The system prompt names only those four writable capabilities and says each
  call stages a proposal rather than completing a write.
- For substantial generated Markdown, the model calls
  `load_skill({name:"obsidian-markdown"})` before the write tool. If the skill is
  unavailable, it continues with ordinary Obsidian-compatible Markdown and says
  no skill was loaded; it never broadens authority.
- The model selects path and filename from cited/current notes, maturity, and
  visible vault structure. If it cannot justify a better location, it uses a
  descriptive `.md` filename under `0.unsorted/`.
- Prompt/tool observations remain untrusted. No note, web result, skill body, or
  old assistant message can request confirmation bypass, a fifth tool, or a
  protected path.

## 5. Intent Staging And Inline Confirmation

`ToolExecutionDispatcher` receives all tool calls from one assistant tool phase.
Before individual execution it optionally calls `prepareBatch(...)` on the tool
executor. The Operations wrapper filters the calls whose registered capability
is one of the four actions and stages them in original order as one immutable
`OperationsIntent`.

```ts
type OperationsIntent = {
  id: string;
  runId: string;
  turnId: string;
  createdAt: number;
  operations: PreparedOperation[];
  state: "pending" | "cancelled" | "executing" | "completed" | "partial" | "failed";
};
```

Staging performs all schema/path/existence checks, reads each initial target,
and simulates ordered transformations in memory. A virtual path map means two
operations on the same file freeze the expected output of the earlier step as
the expected input of the later step. No vault or audit write occurs.

The action tool results returned to the model state only:

```text
proposal staged; no write has occurred; ask the user to review the inline card
```

This lets the agent turn finish normally rather than holding a tool promise or
Modal open against the 30s tool timeout / 180s turn clock.

The Chat card is mounted outside the Markdown render buffer and contains:

- intent summary and all affected paths;
- operation-specific preview: new/append body, mini diff, or property changes;
- explicit `Confirm` and `Cancel` buttons;
- no default-confirm, keyboard shortcut, historical authorization, or timeout
  that writes automatically.

One card confirms all operations in the staged intent (T17). Cancel destroys
the pending baselines. Pending intents are memory-only, expire after 30 minutes,
and are cleared when the Chat service/view is disposed.

## 6. Atomic Execute, Partial Failure And Stale Protection

After Confirm, the controller executes operations sequentially in preview order.

For `vault_append`, `vault_process`, and `frontmatter_update`:

```ts
await app.vault.process(file, current => {
  if (current !== prepared.expectedBefore) throw new StaleTargetError();
  return prepared.expectedAfter;
});
```

The equality check and mutation therefore share the same atomic callback (T6,
T8). No `read → modify` path is permitted.

For `vault_create`, Confirm rechecks that the target is still absent immediately
before `vault.create`. A collision returns an error and never changes the file.

On failure:

- The failing operation is reported with a user-safe reason.
- Later operations are marked skipped; already completed operations remain
  explicit rather than being silently hidden.
- The result card offers per-operation Undo and `Undo completed` for the
  completed subset, satisfying selective recovery after partial execution (T15).
- The agent/runtime never claims all-or-nothing multi-file atomicity.

## 7. Undo And Drift Detection

Successful execution stores a short-lived in-memory receipt separate from audit:

```ts
type UndoReceipt = {
  id: string;
  intentId: string;
  operationId: string;
  path: string;
  kind: CoreWriteToolName;
  before: string | null;
  expectedAfter: string;
  expiresAt: number;
};
```

- Receipt TTL is 30 minutes and never survives view/plugin unload (T11).
- Existing-note Undo uses `vault.process()` and restores `before` only when
  current content exactly equals `expectedAfter` (T7).
- Create Undo re-reads the file and deletes it only when its current content
  exactly equals `expectedAfter`; otherwise it fails closed.
- Expired, already-used, missing, or drifted receipts do not mutate the vault.
- Each result row owns its Undo control; bulk Undo processes the user-selected
  successful receipts in reverse order and reports each outcome.

## 8. Audit Privacy And Retention

Audit and rollback are deliberately different stores:

```text
.obsidian/plugins/personal-assistant/audit/
  2026-08-01T12-34-56.789Z_<operation-id>.json
```

One file is written per attempted operation, with a unique name. The default
record is a strict allowlist:

```ts
type ContentFreeAuditRecord = {
  version: 1;
  operationId: string;
  intentId: string;
  tool: CoreWriteToolName | "undo";
  targetPath: string;
  status: "succeeded" | "failed" | "stale" | "undone" | "undo_failed";
  startedAt: string;
  completedAt: string;
  errorCategory?: string;
};
```

Default records exclude input content, before/after text, diff, snippets,
frontmatter values, prompts, model output, source excerpts, tool raw arguments,
and debug-event extras (T9). A separate Settings opt-in may add exact before and
after content. The default retention is 30 days; the user may choose 90 days.
Cleanup runs at most once per Chat service session and only deletes expired audit
files from this plugin-owned directory.

Audit failure does not roll back a successful user-confirmed vault write. It is
reported in the result card and debug log so the UI does not falsely claim that
an audit record exists.

## 9. Proactive Save Suggestion

The suggestion is a quiet local card appended after a completed answer, not a
provider call and not a write proposal. It appears only when all are true:

- Operations and proactive suggestions are enabled;
- the conversation has not already offered, accepted, or declined one;
- the answer used vault/current-note/Memory evidence;
- the latest exchange is convergent (`总结/梳理/方案/决定/结论` or equivalent),
  or a multi-turn vault discussion ends with a sufficiently structured answer;
- the answer is not an error, short factual reply, casual chat, or obviously
  still exploratory.

The card says the conclusion can be saved and offers `Save` / `Not now` (T16).
`Save` marks the conversation accepted and submits a visible synthetic user
request asking the model to save the just-completed conclusion; the next run then
loads the four tools, chooses the target, and stages the real preview. `Not now`
marks declined. `offered/accepted/declined` is persisted as content-free
conversation metadata so reload does not re-offer; no conclusion text is stored
in this field.

## 10. Settings And Compatibility

Settings semantics:

| Setting | Default | Behavior |
| --- | --- | --- |
| `operationsAgentEnabled` | `false` | User opt-in; effective only when build gate is available. |
| `operationsProactiveSaveSuggestionsEnabled` | `true` | Applies only while Operations is enabled. |
| `operationsAuditIncludeContent` | `false` | Explicit privacy opt-in for before/after audit content. |
| `operationsAuditRetentionDays` | `30` | Allowed values: 30 or 90. |

Migration:

- Existing installs stay disabled even after the build gate becomes available.
- Persisted `operationsAgentEnabled=true` from an older hidden build is honored
  only when the current build gate is available; no write can occur without the
  new inline intent confirmation.
- Old `append_to_current_note` and `replace_selection` are not registered or
  exported by Step 2.
- Desktop and mobile share tool/safety behavior. The inline card must use normal
  DOM APIs, scoped `pa-` CSS, 44px touch targets, clear focus order, and no
  runtime `<style>`, `innerHTML`, or `outerHTML`.
- Pending intents/Undo safely disappear on reload; audit stays content-free and
  vault notes remain the source of truth.

## 11. Lifecycle And Ownership

- `ChatService` owns one `OperationsIntentController` per Chat view/service and
  disposes pending intents, Undo timers, and UI listeners on close.
- `PaAgentRuntime` owns only per-turn registration and the staging executor; it
  does not own durable rollback data.
- `OperationsIntentController` is the only execution entry for the four tools.
  Capability `execute()` cannot write directly.
- The Chat card owns visible confirmation/result state. Markdown re-render does
  not destroy it because it is a sibling of the content render buffer.
- Audit cleanup and directory creation are lazy; merely enabling Settings does
  not touch the vault until a confirmed operation or cleanup pass is required.

## 12. Test Matrix

| Requirement | Unit / integration | App smoke | Failure / fallback |
| --- | --- | --- | --- |
| Four tools / structured only | provider exports exactly four names; nested validation; no selection/append-old tool | explicit create/append/process/frontmatter proposals appear | disabled/no intent exports zero actions; direct execute cannot write |
| T6 / T8 atomic stale | spies prove existing writes use `vault.process`; stale baseline throws inside callback | edit target after preview, then Confirm | card reports stale, file remains user-edited |
| T7 / T11 Undo | expected-after equality, expiry, repeat, reverse bulk Undo | confirm write → edit → Undo fails; unchanged write Undo succeeds | no audit content used as rollback source |
| T12 create collision | missing/existing/parent-missing cases | propose existing path | no overwrite and clear result |
| T13 process replace | first/all literal metacharacters; high-match growth rejected before construction | replace text containing regex characters | missing literal or >200k actual growth is error |
| T14 heading/line | fences, missing/duplicate heading, 1-based ranges | insert/delete section in fixture note | ambiguous/missing anchor is error |
| frontmatter | create/update/delete, dangerous keys, invalid YAML | set tag/status and Undo | parse error fails without rewrite |
| T15 / T17 intent | multi-call batch stages one card; ordered same-path virtual baseline; partial stop/selective Undo | two-file link intent | completed/failed/skipped rows stay visible |
| Inline UI | confirm/cancel/focus/44px/no Modal; survives Markdown render | desktop and mobile-width Chat | Cancel/close never writes |
| T9 audit | strict default field allowlist; opt-in content; unique files; 30/90 cleanup | inspect plugin audit directory after fixture write | audit error is disclosed, write result remains honest |
| T16 suggestion | once/conversation, decline/accept persistence, trigger/non-trigger corpus | converged vault chat → Save → proposal | disabled/exploratory/outside-vault stays quiet |
| On-demand/prompt | intent detector, action export constraints, skill guidance, prompt injection | normal question has no actions; save request loads actions | protected-path/bypass instructions rejected |
| Compatibility | settings migration, runtime disposal, mobile DOM | reload plugin/vault | pending proposal and Undo expire safely |

Required closeout gate:

1. Focused Jest for transforms, executor, intent, audit, Undo, provider, runtime,
   prompt, settings, history, and Chat UI.
2. Type-check, `git diff --check`, and community DOM scan.
3. Project-specific review with all P0/P1/P2 fixed or explicitly deferred by the
   owner.
4. `make deploy` full gate.
5. Test-vault smoke covering cancel, each of four tools, stale rejection, partial
   result, and Undo.
6. Real-vault dogfood through the configured provider: one natural Chat
   conclusion → Save suggestion or explicit save → confirmed write → visible
   result → successful Undo or a deliberately retained note. Record exactly
   what note content was sent and what path was mutated.

## 13. Approved Technical Choices

- Existing WAF safety primitives and `PolicyEngine` are reused; the old blocking
  Modal and non-atomic append implementation are not.
- A model tool phase is the intent boundary. It gives the model freedom to plan
  one or many of the four operations while preserving one user confirmation.
- Confirmation stages and later executes a frozen plan outside the model turn;
  this avoids tool/turn timeout coupling and makes “proposed” distinct from
  “written”.
- Existing-note stale validation happens inside `vault.process()`, not as a
  separate preflight read.
- Undo snapshots are memory-only and short-lived; audit is durable and
  content-free by default.
- Runtime availability may ship behind a build gate, but the user setting stays
  opt-in and defaults off. Step 3 was a separate owner decision and its later
  delivery does not enlarge this Step 2 boundary.

Open design findings: None. Direction choices are settled by the owner decision
record; implementation discoveries must preserve these invariants or be raised
as technical blockers.

## 14. Closeout Evidence (2026-08-01)

Step 2 is closed against the approved scope and gates:

- Runtime: exactly four on-demand tools, one intent-level inline confirmation,
  sequential partial-result reporting, drift-safe Undo, quiet save suggestion,
  content-free audit, and a persisted opt-in that defaults off.
- Automated gates: final focused runtime/Chat suites passed 171 tests;
  type-check and scoped lint passed; final `make deploy` passed 175 suites / 3691
  tests, lint, build, and deployment to the repo-local test vault.
- Repository closeout gates: `npm run docs:check` passed 162 Markdown files /
  1087 local links; `git diff --check` passed; the Community source scan found
  no runtime `<style>`, `innerHTML`, or `outerHTML` injection in `src/`.
- Review: the final write-intent and Chinese action-order reviews found no open
  P0/P1/P2 issue. Question, negation, instruction, quoted meta-instruction, and
  action-first path forms have regression coverage.
- Test-vault UI smoke through Qwen `deepseek-v4-flash`: one four-tool proposal
  exercised create/append/process/frontmatter, Confirm, Cancel, and Undo all;
  the final build then exercised the action-first Chinese append, stale
  rejection, partial success, and selective Undo. Both fixtures returned to
  their exact baseline hashes (`a1180703...9985` and `5699f9fa...2863`), and
  Obsidian reported no captured errors.
- Real-vault dogfood through Qwen `deepseek-v4-pro`: selected note
  `3.literature/literature-AI/function calling.md` produced a pending card,
  Cancel left the note unchanged, Confirm changed it once, and Undo restored
  the exact original hash (`291fe9eb...e6d`). The original plugin assets,
  `data.json`, version `2.9.0-beta.1`, and `operationsAgentEnabled=false` were
  restored and reloaded; Obsidian reported no captured errors.
- Provider transmission was limited to the authorized test fixtures and the
  selected real note. The final test-vault prompts were
  `请追加‘STALE_PROPOSAL_MARKER’到 operations-agent-step2-dogfood-secondary.md 末尾。只生成待确认预览，不要写入，等待我点击确认。`
  and
  `请追加‘PARTIAL_PRIMARY_MARKER’到 operations-agent-step2-dogfood.md 末尾，并追加‘PARTIAL_SECONDARY_MARKER’到 operations-agent-step2-dogfood-secondary.md 末尾。只生成待确认预览，不要写入，等待我点击确认。`;
  the real-vault prompts used the same request form with
  `B-101 STEP2 FINAL CANCEL MARKER 2026-08-01` and
  `B-101 STEP2 FINAL CONFIRM MARKER 2026-08-01`. No WebSearch query was needed,
  and no real-note body is retained in this evidence.
- Default audit files were inspected before removal from both vaults. Records
  contained only the strict metadata allowlist plus optional `errorCategory`
  for stale results; no prompt, note content, snapshot, diff, or tool arguments
  were present.

Step 3 was subsequently authorized and closed under the
[Step 3 SDD](./operations-agent-step3-sdd.md#12-closeout-evidence--2026-08-01).
Extra write tools, additional Pagelet direct actions, or command execution still
require independent demand evidence and explicit owner authorization.
