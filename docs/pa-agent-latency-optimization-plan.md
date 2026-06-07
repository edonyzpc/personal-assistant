# PA Agent Control Policy And Latency Optimization Plan

## Status

Drafted: 2026-06-07

Implementation SDD: [SDD: PA Agent Control Policy](./pa-agent-control-policy-sdd.md)

Development tracker: [PA Agent Control Policy Development Tracker](./pa-agent-control-policy-development-tracker.md)

Scope: PA Agent control-policy and perceived-latency optimization after the Pagelet timing pass. This plan uses the recent timing samples as diagnostic evidence, but does not include Pagelet or VSS retrieval optimization work.

The architecture target is Pi-style model-driven tool choice with Obsidian-specific host policy. The model remains responsible for semantic tool choice, continuation, synthesis, and final wording. The host owns explicit source constraints, tool exposure, admission checks, duplicate/no-op guardrails, bounded recovery, and timing observability.

## Evidence

### Pagelet Baseline Boundary

Recent Pagelet timing showed local overhead is effectively zero and the remaining delay is dominated by a single structured model call. Pagelet has already been reduced to a smaller default suggestion target, and further Pagelet changes are out of scope for this plan.

### PA Agent Samples

The broad PA Agent sample showed:

- `runtime_startup_total`: 3 ms
- `loopElapsedMs`: 76,498 ms
- `turnCount`: 8
- real tool calls: 6
- model time was the largest contributor across turns, with several turns spending 5-13 seconds in the model.

The targeted weather sample, prompt `看一下杭州今天的天气`, showed:

- `runtime_startup_total`: 3 ms
- `loopElapsedMs`: 17,234 ms
- `turnCount`: 2
- real tool calls: 1
- tool used: `webSearch`
- turn 0: model selected `webSearch` in 5,423 ms; `webSearch` execution took 3,868 ms
- turn 1: final answer model turn took 7,937 ms

This means the weather path is structurally correct, but still pays one full model turn for tool selection and one full model turn for final answer.

The Memory sample, prompt `找一下周至擅长什么`, showed the same control-policy problem in a different form:

- total elapsed time: 22.9 seconds
- model time: about 20.0 seconds across 4 model turns
- tool wall-clock time: about 3.0 seconds total
- actual trajectory: 3 rounds of tool decisions, 7 tool calls, then final answer
- tools repeatedly combined `search_memory`, `search_vault_metadata`, and `search_vault_snippets`

Memory itself was not the bottleneck. The expensive part was repeated model planning without enough host-side visibility into why another round was needed and without clear guardrails for source constraints, duplicates, and low-level follow-up access.

A later five-prompt sample added three more observations:

- `解释一下番茄工作法` incorrectly used `webSearch` before answering. Stable common-knowledge prompts should normally answer directly and should not pay a network/tool round.
- `找一下周至擅长什么` improved compared with the earlier sample, but still overused lower-level vault tools.
- `只从我的笔记里找周至擅长什么` still expanded into multiple tools and even called current-note context. Source constraints are not tight enough if "my notes only" can drift into current-note or repeated vault-tool exploration.

This batch reinforces that classification misses are not the root problem. The root problem is overly open low-level tool exposure plus weak source-constraint enforcement, weak duplicate/budget guardrails, and insufficient visibility into why the model continued tooling.

## Problem Statement

PA Agent currently mixes three concerns:

1. required-capability classification decides which capabilities the request may require;
2. schema export decides which tools the model can see;
3. answer-completion policy decides whether to keep tooling or finalize.

The current runtime computes `requiredCapabilityClassification`, but schema filtering still mostly depends on explicit user constraints such as "only current note" or "do not use web search". For ordinary prompts, the model can still see a broad tool set and must self-select across semantic tools and lower-level vault search tools in the same turn.

The current answer-completion policy treats new successful tool observations as a reason to keep tooling, but the runtime does not make the model's choice to continue observable enough, nor does it distinguish healthy multi-step reasoning from duplicate, source-violating, or low-level exploratory loops.

The model also uses tools too eagerly for stable general-knowledge prompts. A prompt like `解释一下番茄工作法` usually should answer directly, but WebSearch should not be globally hard-blocked for every ambiguous prompt. Search remains a model-selected semantic source unless the user explicitly constrains or suppresses it.

## Strategy Positioning

This plan should learn from Pi-style model-driven tool choice, but not collapse into fully unconstrained tool choice.

The intended split is:

```text
required_capability_classification = explicit hard constraints and rare audited routes only
model-selected tools = semantic source selection and continuation decisions
agent_control_policy = source constraints, tool exposure, budgets, duplicate/no-op guardrails, recovery, and observability
```

`required_capability_classification` must not become an exhaustive natural-language intent recognizer. It should only handle:

1. explicit hard constraints such as no web, current-note only, or no Memory;
2. a very small set of audited high-confidence routes that are safe enough to narrow or direct-route.

Safety boundaries such as read-only permissions, loop limits, duplicate suppression, lower-level follow-up access, and final-only recovery turns belong to the agent control policy, not to required-capability classification.

When no high-confidence rule matches, the runtime should avoid guessing. It should expose semantic source tools and let the model choose the information source and whether more context is needed, while host policy still controls hard source constraints, lower-level tool exposure, budgets, repeated calls, unavailable tools, and recovery/finalization behavior.

## Architecture Target: Pi-Style Loop With Obsidian Policy

Pi's useful lesson is the shape of the loop, not the exact tool set:

```text
context -> model -> assistant tool calls -> tool execution -> tool results -> host hook -> next model turn or stop
```

PA Agent should keep this shape. It should not add a separate deterministic planner that tries to understand every natural-language prompt before the model sees tools.

The Obsidian-specific optimization should live in host policy hooks around that loop:

```text
PaAgentLoop
  streams model turns and executes tool calls

RequiredCapabilityRouter
  parses explicit hard constraints and rare audited routes

PaAgentControlPolicy
  owns per-turn exposure mode, source scope, budgets, duplicate/no-op guardrails, and recovery

ToolExposurePolicy
  maps exposure mode + source scope -> provider schemas and textual tool definitions

ToolAdmissionPolicy
  rejects only hard violations at execution time

ObservationLedger
  records tool outcomes, source records, query keys, hit counts, answer-ready facts, and repeated/no-op calls

TimingDiagnostics
  records why tools were exposed, admitted, rejected, continued, or finalized
```

This keeps the model in charge of planning while giving the Obsidian host a clear place to enforce vertical-domain safety: notes-only means notes-source tools only, current-note means current-note context only, no-web means no network, and lower-level vault drill-down stays inside the Memory/notes source boundary.

## Agent Control Policy

The control policy is the host-side contract that decides what the model is allowed to do next. The model still chooses semantic tools, decides whether more context is useful, and writes the answer. The host owns tool exposure, hard constraints, budgets, repeated-call suppression, lower-level follow-up access, and recovery/finalization when the loop is no longer productive.

This should be implemented as a dedicated control-policy module, not by continuing to expand `pa-agent-required-capability-policy.ts`. Required-capability classification is one input to control policy; it is not the control policy itself.

The policy consumes:

- explicit user constraints, such as no web, no Memory, or current-note only;
- source-scoped user constraints, such as notes-only, web-only, or current-note-only;
- available capabilities and exported provider schemas;
- rare high-confidence required-capability routes;
- turn facts from the previous model turn;
- tool result metadata, including success/error/duplicate status and whether an observation is included in the next prompt;
- observation ledger state for successful tools, repeated tools, failed tools, and semantic source count;
- observed continuation signals, such as changed query, changed source, same-source drill-down, new result count, or repeated/no-op call.

The model may be prompted to explain why it continues after useful context is available, but host policy should not depend on a free-form self-reported reason. The durable signal should come from tool calls and tool results.

### Tool Exposure Modes

Every model turn should run in exactly one exposure mode:

| Mode | When Used | Exported Tools |
| --- | --- | --- |
| `final-only` | Host must recover/finalize after hard constraint violation, failure, duplicate/no-op loop, empty behavior, or exhausted budget | No tools |
| `answer-ready` | Useful context exists and the model should decide whether to answer or gather more | Semantic/source-scoped tools remain available within budget |
| `narrowed-required` | Explicit constraint or rare high-confidence route selects one available capability | Only mapped required-capability tools |
| `source-scoped` | User constrains the source, e.g. notes-only or current-note-only | Only tools for that source |
| `semantic-first` | Default first context-gathering round when no high-confidence route exists | `search_memory`, `webSearch`, `get_current_note_context`, minus explicit suppressions |
| `follow-up` | Prior observations or model reasoning requests a lower-level drill-down within the current source boundary | Targeted lower-level tool set, e.g. `search_vault_snippets` |
| `blocked/unavailable` | Requested or required tools are suppressed/unavailable | No phantom tools; continue to warning/finalization behavior |

The model should not see semantic tools and low-level vault search tools together by default. That mixed exposure is what caused repeated `search_memory + search_vault_metadata + search_vault_snippets` planning rounds in the Memory sample.

### Per-Turn Decision Flow

```text
before turn:
  apply explicit hard constraints
  if toolMode=final_answer_only:
    export no tools
  else if user input constrains the source:
    export only source-scoped tools
  else if a high-confidence required route is available:
    export only mapped required-capability tools
  else if prior observations or model reasoning requests lower-level follow-up:
    export targeted follow-up tools within the source boundary
  else:
    export semantic-first tools only

after turn:
  record used capabilities and tool outcomes
  reject tools only when they violate hard constraints, final-only mode, duplication, or budgets
  suppress duplicate/no-op tool calls
  if the model produced final text:
    stop completed
  else if useful context exists and budget remains:
    continue with answer-ready guidance
  else if a semantic source or model reasoning requests follow-up and follow-up budget remains:
    continue with follow-up mode
  else if failures/unavailable/status observations exist:
    continue with final_answer_only and explain limitation
  else if control budget is exhausted:
    continue with final_answer_only from available context
  else:
    continue with semantic tools and record why another context-gathering round is allowed
```

### Control Budgets

Control budgets are guardrails, not product goals. The plan should not treat multi-tool or multi-turn reasoning as a failure. The model is allowed to use multiple semantic sources or multiple context-gathering rounds when it judges that useful work remains, especially for comparison, synthesis, uncertainty reduction, or explicit multi-source requests.

Budgets define the point where host policy must stop unproductive continuation:

```text
healthy path:
  model gathers as much context as needed within exposed tools and budgets
  model answers when ready

guardrail path:
  duplicate/no-op/failure/budget exhaustion
  host switches to final_answer_only and asks for the best available answer or limitation
```

Initial guardrails should be conservative and observable:

- weather/current-info: `webSearch` is allowed; repeated WebSearch must show a new query or reason;
- short Memory lookup: `search_memory` is allowed; repeated Memory calls must show a changed query or new context need;
- notes-only lookup: only notes-source tools are allowed unless the user broadens the source;
- insufficient Memory context: lower-level vault follow-up can be exposed inside the same notes source boundary;
- explicit multi-source analysis: allow multiple semantic context-gathering rounds, still with duplicate suppression and hard caps.

This is the main control-policy latency lever: not preventing multi-step reasoning, but preventing repeated, unexplained, source-violating, or no-new-information tool loops.

### Tool Guidance And Hard Source Constraints

Tool exposure controls what the model can see. Hard source constraints control whether a requested call is allowed to execute. WebSearch use in unconstrained prompts should generally remain a model decision, with prompt guidance and budget/finalization controls rather than a broad host-side reject rule.

Hard rejection should be limited to:

- explicit suppressions, such as no web, no Memory, current-note only, notes-only, or web-only;
- `final_answer_only` mode;
- unavailable tools;
- duplicate/no-op calls and exhausted budgets;
- lower-level vault tools outside `follow-up` mode.

Recommended source-constraint guards:

- `webSearch` is blocked when the user says no web, asks for notes-only/current-note-only, or the runtime is in a non-web source-scoped mode;
- `search_memory` is blocked when the user suppresses Memory or asks for current-note-only/web-only;
- `get_current_note_context` is blocked for broad notes-only prompts and admitted only for current-note/selection/open-file requests;
- lower-level vault tools are admitted only in `follow-up` mode and only for the targeted follow-up reason.

For stable common-knowledge prompts such as `解释一下番茄工作法`, the model should usually answer directly. The system prompt should make this explicit: tools are optional and should be called when the model judges that the answer needs the user's notes, current note, real-time external information, source-backed lookup, or uncertainty reduction. If the model chooses `webSearch` in an unconstrained prompt, host policy should allow it within normal budgets, record the decision in timing, and rely on duplicate/budget/finalization guardrails if the search becomes unproductive. Treat this as an advisory signal to tune prompts and model behavior, not as a hard execution error.

## Goals

- Preserve PA Agent's read-only and network-read safety boundary.
- Keep the model in charge of final wording, source synthesis, and ambiguity handling.
- Reduce unnecessary model/tool turns for simple capability-bound prompts.
- Make every latency decision observable in `PA Agent timing`.
- Avoid regressing multi-tool prompts that genuinely need Memory, current-note context, WebSearch, or skill context together.
- Prevent lower-level vault search tools from being combined repeatedly with semantic Memory search unless observations say a follow-up is needed.

## Non-Goals

- Do not add write actions, shell execution, arbitrary endpoints, or provider built-in search.
- Do not optimize VSS/Memory retrieval in this plan.
- Do not replace the answer-stream tool loop with a new planner loop.
- Do not remove model-selected tools entirely; the optimization should constrain model choice when the request is obvious, not make every request deterministic.
- Do not grow deterministic rules into an exhaustive prompt taxonomy.
- Do not add deterministic Memory intent filters such as "find/check/look up + entity". Those should remain model-selected semantic tool decisions.

## Proposed Design

### Phase 0: Observability First

Add enough timing metadata to explain PA Agent behavior without guessing:

- classification result: required/suggested capabilities, confidence, source reason, deterministic vs model-derived;
- control-policy snapshot: exposure mode, source scope, allowed tools, blocked tools, budget state, and recovery state;
- exported tool schema names/count per turn;
- active `toolMode`;
- active tool exposure layer: semantic-first, narrowed-required, follow-up, or final-only;
- source-constraint mode and tool-admission decisions;
- WebSearch overuse/advisory signal when the model searches an unconstrained stable-knowledge prompt;
- context-gathering round count and control budgets;
- host-policy decision after each turn, including `continue`, `force_finalize`, `stop`, or corrective turn;
- answer-completion decision reason;
- whether schema narrowing was applied and why.
- follow-up reason when lower-level vault tools are exposed after Memory.

The log should make this kind of question answerable from one console object:

> Did `看一下杭州今天的天气` deterministically require `webSearch`, did the first turn expose only `webSearch`, and why did the runtime continue or finalize after the tool result?

It should also make this Memory question answerable:

> Did `找一下周至擅长什么` expose only semantic source tools first, did `search_memory` return answerable context, and why did the runtime continue, answer, or expose vault metadata/snippet tools?

And this source/admission question:

> Did `解释一下番茄工作法` answer directly without `webSearch`, or if the model chose `webSearch`, did the runtime keep the continuation observable and within budget? Did `只从我的笔记里找周至擅长什么` expose only notes-source tools?

### Phase 1: Hard Constraints And Rare Audited Routes

Keep deterministic classification narrow. Add or adjust rules only when they are high-confidence enough to justify host-side routing, and do not use it to understand ordinary Memory lookup phrasing.

Allowed responsibilities:

- explicit suppressions such as no web, no Memory, or current-note only;
- source-scoped constraints such as notes-only should map to Memory-source tools only, not current-note context unless the user explicitly says current note;
- rare audited current-info routes where false positives are unlikely and cost/safety benefits are clear;
- no broad "find/check/look up + entity/topic" Memory intent rules.

Implementation boundary:

- keep deterministic signal tables and optional classifier normalization in `pa-agent-required-capability-policy.ts` or a renamed `pa-agent-required-capability-router.ts`;
- do not add answer-ready, follow-up, duplicate/no-op, or budget logic to this module;
- expose the router result as input to `PaAgentControlPolicy`.

For current-info WebSearch, candidate route signals should require a current-info shape, not only a domain noun:

- `今天...天气`
- `现在...天气`
- `实时...天气`
- city + `天气` / `气温`
- `今天` / `现在` / `当前` / `实时` + `空气质量`, excluding current-note phrases such as `当前笔记`
- `今天` / `现在` / `实时` + `降雨` / `预报`
- query verbs such as `看一下` / `查一下` + city + current weather phrasing

Guardrail: keep `今天` alone weak or ignored. Phrases like `今天我写了什么` must not trigger WebSearch.

Anti-goal: do not keep adding medium-confidence domain words just because a model might benefit from a tool. Low-confidence and ambiguous requests should fall through to model-selected semantic tools.

Expected result for `看一下杭州今天的天气`:

```text
required_capability_classification:
  required: webSearch
  reason: deterministic Chinese weather/current-info signal
```

### Phase 2: Semantic-First Tool Exposure

Use required-capability classification to narrow schemas only when the classifier has a high-confidence requirement. Otherwise, default to semantic-first tool exposure instead of exposing every low-level search tool in the first turn.

The semantic source layer should be explicit:

| Source | First-Class Semantic Tools | Lower-Level Follow-Up Tools |
| --- | --- | --- |
| `notes` | `search_memory` | `search_vault_snippets` |
| `current_note` | `get_current_note_context` | none initially |
| `web` | `webSearch` | none initially |

Lower-level notes tools are not worse tools; they are drill-down tools inside the notes source. They should be reachable when the model needs them, but they should not be first-turn peers of `search_memory`.

First-turn exposure rules:

- If exactly one required capability is available and the prompt has no obvious multi-hop/mixed-source signal, expose only that capability's tool schema.
- Keep explicit user suppressions as the strongest constraint.
- If the user constrains the source, use `source-scoped` exposure before default semantic-first exposure.
- Keep `final_answer_only` as the strongest runtime mode and export zero tool schemas.
- Do not narrow on weak/suggested capabilities in the first implementation.
- If no high-confidence required capability exists, do not force a route; expose semantic source tools and let the model select the source.

Schema narrowing needs one explicit mapping, shared by provider schema export, prompt tool definitions, executor preflight, and timing diagnostics:

```ts
const REQUIRED_CAPABILITY_TOOL_NAMES = {
  webSearch: ["webSearch"],
  search_memory: ["search_memory"],
  get_current_note_context: ["get_current_note_context"],
} as const;
```

The default semantic-first tool set should start with:

```ts
const SEMANTIC_FIRST_TOOL_NAMES = [
  "search_memory",
  "webSearch",
  "get_current_note_context",
] as const;
```

Implementation contract:

- derive one `AgentControlSnapshot` before every model turn;
- derive `sourceScopedConstraints` before fallback semantic-first exposure;
- apply the same snapshot to native provider schemas, textual `tool_definitions`, and executor allowed/blocked checks;
- if a required capability is unavailable, do not export a phantom tool; let the control policy produce the existing warning/finalization behavior from the router result;
- fallback mode exposes the semantic-first tool set, minus explicit suppressions;
- lower-level vault tools such as `search_vault_metadata`, `search_vault_snippets`, `read_note_outline`, and `inspect_obsidian_note` are not part of the default first-turn set;
- lower-level vault tools can be exposed only in a follow-up layer when prior observations say they are needed;
- required-capability narrowing only owns the three required capabilities above. It must not implicitly classify vault metadata/snippet/outline tools as Memory or current-note unless a separate explicit mapping is designed.

Expected result for the weather prompt:

```text
turn 0 exported schemas:
  webSearch
```

This still requires one model turn to call `webSearch`, but it removes irrelevant lower-level tool-space noise.

Expected result for an ambiguous prompt:

```text
required_capability_classification:
  no high-confidence required capability

turn 0 exported schemas:
  semantic source tools, minus explicit suppressions

model:
  selects tools or answers directly
```

Expected result for the Memory prompt:

```text
turn 0 exported schemas:
  search_memory
  webSearch
  get_current_note_context

model:
  calls search_memory(query="周至 擅长什么")
```

Expected result for a notes-only Memory prompt:

```text
turn 0 exported schemas:
  search_memory

blocked by source constraint:
  webSearch
  get_current_note_context

not exposed on the first turn; allowed only as same-source follow-up if Memory observations require it:
  search_vault_snippets
```

### Phase 3: Answer-Ready Guidance And Follow-Up Guardrails

After a successful semantic source tool result, do not force `final_answer_only` by default. Instead, enter `answer-ready` mode: the next model turn receives the observations, a clear instruction that it should answer if the context is sufficient, and the same hard constraints/budgets. The model remains responsible for deciding whether more context is genuinely useful.

`final_answer_only` is a recovery or guardrail mode, not the normal success path. Use it when:

- a hard source constraint was violated;
- the model repeats duplicate/no-op tool calls;
- the run hits tool/context/wall-clock budget;
- only failure/unavailable/status observations are available and the user still deserves a bounded answer;
- the assistant returns empty after observations.

For Memory, prefer tool-result status over prompt intent filters. `search_memory` should eventually expose enough metadata for host policy to decide:

```text
hitCount
hasAnswerableContent
needsSnippetFollowup
confidence
```

Policy behavior:

- `hasAnswerableContent=true` -> enter `answer-ready` mode;
- `needsSnippetFollowup=true` -> allow targeted lower-level follow-up tools inside the source boundary;
- no results or low confidence -> allow the model to rewrite/fallback within budget;
- repeated successful `search_memory` without changed query or new context need -> treat as duplicate/no-op and recover with `final_answer_only`.

Recommended code boundary:

- implement answer-ready / follow-up / duplicate guardrail decisions inside a new `pa-agent-control-policy.ts`, not as broad prompt-intent rules and not inside required-capability classification;
- keep `pa-agent-required-capability-policy.ts` focused on required-capability classification, missing-required warnings, and any short-term compatibility wrapper needed during migration;
- run control-policy decision after tool observations are recorded and after failed-required handling, but before the generic branch that currently returns `continue_tooling` for new successful observations;
- return normal `continue` with an `answer-ready` runtime instruction when context is useful but budgets remain;
- return the existing `force_finalize` shape only for recovery/guardrail cases;
- refactor the generic answer-completion controller into reusable guardrail helpers where possible, so duplicate/no-op/failure/empty-response behavior is not duplicated across policies.

Expected result:

```text
turn 0:
  model calls webSearch
  tool returns weather context

host policy:
  answer-ready guidance
  tools remain available within source/budget constraints

turn 1:
  model decides whether to answer or gather more context
```

This often still has two model turns, but it does not encode "avoid multi-tool/multi-turn" as a hidden goal. It makes the model's continuation decision visible and bounded.

For low-confidence model-selected tool flows, host policy should still prevent unproductive behavior through duplicate suppression, per-run tool caps, wall-clock limits, and recovery finalization when the loop hits a guardrail. Pi-style model autonomy improves coverage, while host policy keeps continuation observable and bounded.

Expected result for `找一下周至擅长什么`:

```text
turn 0:
  model calls search_memory
  search_memory returns answerable context

host policy:
  answer-ready guidance

turn 1:
  model answers from Memory context, or requests justified follow-up within budget
```

If Memory context is insufficient:

```text
turn 0:
  search_memory returns needsSnippetFollowup=true

turn 1:
  exported tools: search_vault_snippets only
  model calls targeted snippets lookup

turn 2:
  model answers, unless duplicate/budget/failure guardrails require final_answer_only
```

### Phase 4: Optional Direct Route For Simple Current-Info Prompts

After Phase 0-3 are validated, consider a direct-route path for highly obvious prompts:

```text
deterministic classifier says webSearch required
runtime synthesizes a webSearch query
runtime executes webSearch before the first answer model turn
model receives observation and produces final answer
```

For `看一下杭州今天的天气`, this would remove the first 5-second model-selection turn. It is more invasive because query synthesis, source handling, cancellation, failure recovery, and UI status ordering move into runtime logic before the model has spoken.

Recommendation: do not implement direct-route first. Use Phase 0-3 to measure whether tool exposure, answer-ready guidance, and guardrails are enough.

If direct-route is later implemented, it must preserve PA Agent runtime contracts instead of becoming a side channel:

- create a synthetic tool-call/tool-result transcript entry that can be rendered through the normal `tool_observations` path;
- count the routed tool execution in timing and capability telemetry, with a distinct `route: "direct"` diagnostic;
- preserve Web source records exactly as normal `webSearch` execution does;
- preserve cancellation and wall-clock behavior;
- define whether `turnCount` means model turns only or total runtime turns, and whether direct-routed tools contribute to `toolCallCount`;
- fail closed into the normal model-selected flow if query synthesis or direct execution is ambiguous.

## Expected Weather Trajectory After Phase 0-3

```text
startup:
  capability_preload
  host_context
  required_capability_classification -> required webSearch

turn 0:
  exported tools: webSearch only
  model emits one webSearch call
  webSearch executes
  tool result included in next prompt

policy:
  single required capability satisfied
  answer-ready guidance

turn 1:
  model returns final weather answer or requests justified follow-up within budget

agent_end:
  completed
  turnCount=2
  toolCallCount=1
```

## Expected Future Weather Trajectory With Direct Route

```text
startup:
  required_capability_classification -> required webSearch
  synthesize query: 杭州 2026-06-07 天气
  execute webSearch

turn 0:
  toolMode=final_answer_only
  exported tools: none
  model returns final weather answer from observation

agent_end:
  completed
  turnCount=1
  toolCallCount=1 if direct-routed tools are counted in the canonical metric, which is recommended
```

This is the fastest likely path, but it should be gated by measured evidence and explicit product review.

## Senior Programmer Latency Review

Phase 0-3 primarily reduce wasted tool exploration and make continuation observable. They do not remove the unavoidable "model chooses tool, tool runs, model answers" shape for normal model-selected tool use. The weather sample proves this: a structurally correct `webSearch -> final` path still spends one model turn selecting the tool and one model turn producing the final answer.

Latency levers should be ranked by whether they remove model/provider time, tool wall-clock time, or only local overhead:

| Lever | Expected Latency Impact | Priority | Notes |
| --- | --- | --- | --- |
| Semantic-first schema exposure | Medium | Phase 2 | Reduces tool-choice noise and prompt/schema tokens; most useful for Memory prompts that currently see low-level vault tools too early. |
| Control-policy duplicate/no-op suppression | Medium | Phase 3 | Prevents repeated model/tool rounds after no-new-information calls; preserves model autonomy for real multi-step work. |
| Direct-route for audited current-info prompts | High | Deferred | Can remove the first model-selection turn for prompts like `看一下杭州今天的天气`, but changes query synthesis, status ordering, cancellation, source records, and failure handling. |
| Compact final-answer mode for single-fact queries | Medium | After Phase 3 | The final answer turn can still take 5-8 seconds. For simple weather/rate/version queries, use a concise runtime instruction and lower output budget if provider options support it. |
| Hybrid/parallel execution for independent read-only tool batches | Medium for multi-tool turns | Phase 2/3 audit | If the model legitimately calls multiple independent read-only tools in one turn, run them concurrently when tool execution mode permits it. Keep sequential mode for tools with ordering or state assumptions. |
| Per-run result reuse for identical tool calls | Low to medium | Phase 3 | If the same tool/query/source key repeats, reuse or skip from the observation ledger instead of re-executing. This is a guardrail, not a planner. |
| Prompt and schema token trimming | Low to medium | Phase 2 | Measure serialized tool schema length, textual `tool_definitions` length, chat history length, and host-context length per turn. Reduce repeated boilerplate before tuning model behavior. |
| Local schema filtering and timing code | Low | Opportunistic | Current samples show startup/local overhead near zero. Do not spend major effort here unless timing later shows regression. |
| WebSearch provider optimization | Unknown | Later | WebSearch wall-clock was several seconds in samples, but product correctness and freshness matter. Start with per-run duplicate reuse and timeout diagnostics before caching external facts. |

Concrete latency checks to add to timing:

- model input character count and estimated token count per turn;
- provider schema count and serialized schema size per turn;
- textual `tool_definitions` character count per turn;
- time from turn start to first model chunk;
- time from first tool call token to complete parsed tool call;
- real tool wall-clock time by tool name;
- time from tool result included in prompt to first final-answer chunk;
- duplicate/no-op tool call count and avoided execution count;
- answer length and output token estimate for final turns.

Expected latency posture after Phase 0-3:

```text
Simple current-info prompt:
  still often 2 model turns
  less irrelevant tool exposure
  no duplicate/no-op search continuation

Short Memory lookup:
  first turn exposes semantic source tools only
  low-level vault tools not exposed unless same-source follow-up is justified
  extra rounds allowed when the model has a real reason, not because all tools were visible

Stable common-knowledge prompt:
  prompt guidance should make direct answer more likely
  WebSearch remains allowed in unconstrained prompts
  repeated or source-violating search is blocked
```

The only planned lever that can reliably remove the first model-selection latency is direct-route. It should stay deferred until Phase 0-3 timing proves the remaining common paths are structurally correct and the latency problem is specifically the first model-selection turn.

## Validation Plan

Automated tests:

- required-capability Chinese weather signal resolves to `webSearch`;
- `今天我写了什么` does not resolve to `webSearch`;
- ambiguous prompts without high-confidence signals do not get deterministic schema narrowing;
- classification-driven schema narrowing exports only `webSearch` for weather;
- `PaAgentControlPolicy` returns a per-turn control snapshot with exposure mode, source scope, allowed tools, blocked tools, and budget diagnostics;
- ordinary low-confidence prompts export only semantic-first tools on turn 0;
- turn 0 does not expose `search_vault_metadata` / `search_vault_snippets` together with `search_memory` by default;
- default tool-use prompt says tools are optional and stable common knowledge should normally be answered directly;
- if the model calls `webSearch` on an unconstrained stable common-knowledge prompt, the runtime allows it within normal budgets, records the advisory signal, and prevents only duplicate/no-op/budget-exhausted continuation;
- `webSearch` is rejected only when it violates hard source constraints, such as no-web, notes-only, or current-note-only;
- notes-only prompts expose `search_memory` only and block `webSearch` / `get_current_note_context`;
- explicit "不要联网" blocks `webSearch` even if weather signal matches;
- useful `webSearch` or `search_memory` observations produce answer-ready guidance, not forced final-only;
- `search_memory` with `needsSnippetFollowup=true` allows same-source `search_vault_snippets` follow-up;
- identical repeated tool/source/query calls are skipped or reused from the observation ledger without real re-execution;
- independent read-only tool batches remain eligible for hybrid/parallel execution when tool execution mode permits it;
- multi-source prompts do not get incorrectly narrowed to one tool;
- existing duplicate/no-op and failed-tool finalization tests still pass.

Manual smoke prompts:

- `看一下杭州今天的天气`
- `杭州现在气温多少`
- `今天北京空气质量怎么样`
- `找一下周至擅长什么`
- `找一下周至相关内容`
- `解释一下番茄工作法`
- `只从我的笔记里找周至擅长什么`
- `搜索一下 Obsidian 最新版本`
- `不要联网，看当前笔记里有没有提到杭州天气`
- `结合我的笔记和网上资料，分析杭州今天出行是否合适`

Success metrics:

- weather prompt's common path is expected to stay around `turnCount=2`, but extra model/tool turns are acceptable when the model provides non-duplicate continuation reasons within budget;
- weather first turn exported schema count becomes 1 after high-confidence narrowing;
- no duplicate/no-op extra tool turns after successful `webSearch`;
- Memory short lookup should avoid first-turn vault metadata/snippet calls; additional semantic rounds are acceptable when the model gives a non-duplicate continuation reason;
- Memory insufficient-context lookup should stay inside notes-source tools and expose lower-level vault follow-up only after Memory observations ask for it;
- stable common-knowledge prompts should usually answer directly; if the model chooses `webSearch`, the run remains acceptable when it stays within budget and finalizes without duplicate/no-op search loops;
- notes-only lookup should not call `webSearch` or `get_current_note_context`;
- no false WebSearch warning for no-memory/current-note-only prompts;
- console timing explains classification, control snapshot, schema narrowing, tool result, continuation reasons, budget state, and finalization decisions;
- compare p50/p95 for weather and short Memory lookup `loopElapsedMs`, turn 0 `modelElapsedMs`, final-answer `modelElapsedMs`, first model chunk, final-answer first chunk, and tool execution elapsed time before and after Phase 0-3;
- compare model input size, provider schema count/size, textual tool-definition size, and output length before and after Phase 2/3;
- for Phase 0-3, success is primarily better observability, source fidelity, duplicate/no-op suppression, and bounded continuation; direct-route is the phase expected to remove the first model-selection latency if later approved.

## Recorded Decisions

These decisions are resolved for SPEC-00 through SPEC-04. Items that require more latency evidence are explicitly deferred to SPEC-05 rather than left as implementation blockers.

1. Schema narrowing applies to `required` capabilities and explicit source constraints only.

2. Deterministic narrowing requires explicit constraints or strong single-capability patterns. Ambiguous medium-confidence prompts fall through to model-selected tools.

3. Default first-turn exposure uses the smaller semantic-first tool set. Lower-level vault tools are exposed only as host-policy follow-up when prior observations request it.

4. Useful semantic observations produce answer-ready guidance, not forced finalization. `final_answer_only` is reserved for duplicate/no-op, failure/unavailable, hard constraint violation, empty response, or budget exhaustion.

5. `search_memory` returns minimal answerability metadata: `hitCount`, `hasAnswerableContent`, and `needsSnippetFollowup`. `confidence` remains optional/future because the current Memory backend does not emit a calibrated value.

6. `webSearch` admission is not hard-rejected for unconstrained stable common-knowledge prompts. Hard rejection applies only to explicit source-constraint violations; model-selected WebSearch remains allowed within normal guardrails.

7. Notes-only prompts map to Memory on the first turn. Current-note requires explicit current-note wording; lower-level vault tools require follow-up observations.

8. Direct-route is deferred to SPEC-05. It can cut one model turn, but it changes runtime ownership of query synthesis and status ordering.

9. Lower tool-call budgets are treated as hard caps, not desired paths. They must not encode "avoid multi-tool planning" as a product goal.

10. Control-policy logic lives in `pa-agent-control-policy.ts`. Required-capability policy remains the router/input provider, not the owner of exposure modes, source scopes, budgets, and recovery.

11. Compact final-answer mode is deferred to SPEC-05. It needs timing evidence and a narrow product decision before it changes answer-turn behavior.

## Implementation Order

1. Add Phase 0 timing/log metadata, including control-policy snapshots and model/schema size metrics.
2. Strengthen answer-stream tool-use prompt guidance: tools are optional; stable common knowledge should be answered directly.
3. Create `pa-agent-control-policy.ts` with explicit `AgentControlSnapshot`, exposure modes, source scopes, budget state, and admission diagnostics.
4. Add deterministic Chinese current-info signals and focused classifier/router tests.
5. Add the required-capability-to-tool-name mapping, semantic-first tool set, source-scoped constraints, and shared tool constraints.
6. Wire the control snapshot into native provider schema export, textual tool definitions, executor preflight, and timing diagnostics.
7. Add schema export, textual tool-definition, executor-preflight, and tool-admission tests for narrowed, source-scoped, semantic-first, follow-up, answer-ready, and final-only modes.
8. Add conservative hard source-constraint guards for `webSearch`, plus advisory timing for stable common-knowledge overuse.
9. Add answer-ready guidance and recovery finalization in `pa-agent-control-policy.ts`, starting with useful `webSearch` and `search_memory` observations.
10. Add Memory follow-up metadata or an initial non-empty-result heuristic, then expose same-source lower-level vault follow-up when needed.
11. Audit hybrid/parallel execution for independent read-only tool batches and add per-run identical-call reuse/skip diagnostics.
12. Run focused PA Agent tests, typecheck, lint, and whitespace checks.
13. Deploy to the test vault and run the weather/current-info/Memory/common-knowledge/source-scoped smoke prompts.
14. Decide whether compact final-answer mode and direct-route are justified by measured data.
