# Pagelet Bubble Next Iteration Context

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-07-05

## Purpose

This document is a product-discussion context package for follow-up work in
Claude Code. It is not an approved implementation plan.

Use it to discuss the next Pagelet product iteration from user value and product
philosophy first, before writing an SDD or changing runtime code.

## Source Baseline

Primary references:

- [PA Product North Star](../product/pa-product-north-star.md)
- [PA product discussion 2026-07-02](./pa-product-discussion-2026-07-02.md)
- [PA Product Information Architecture spec](../product/pa-product-information-architecture-spec.md)
- [PA UI/UX Design Audit Report](./pa-ui-ux-audit-report.md)
- [Pagelet product design](../product/pagelet-product-design.md)

Current North Star:

> 随手记下，需要时自然浮现。

Working English form:

> Capture lightly. Let the right notes return when they matter.

Design philosophy:

> 安静且可信。

Key constraint for this discussion:

> The Bubble is not the queue. The Bubble is the doorway.

## Non-Negotiable Product Standards

Evaluate every proposal against these standards:

1. Does it lower the friction of capturing or revisiting real thoughts?
2. Does it make the user's own notes more likely to return at the right time?
3. Does it preserve the user's original thinking instead of drowning it in AI
   output?
4. Does it connect ideas with evidence rather than black-box insight?
5. Does it maintain the vault gently, with preview, recovery, or undo?
6. Does it keep advanced AI capability behind a quiet product surface?
7. Does the user understand what is happening without learning PA internals?
8. Can the user ignore the artifact without future penalty?
9. Is confirmation tied to durable consequence, not every AI sentence?
10. Does it reduce more review burden than it creates?

Avoid:

- turning Pagelet into "ChatGPT buttons inside Obsidian"
- making Bubble a feature launcher
- showing queues, badges, or unresolved state for every AI candidate
- exposing Memory, RAG, VSS, graph, background job, or provider jargon as the
  user's first explanation
- pushing autonomous behavior before trust is earned

## Confirmed Follow-Up Decisions

The following decisions were confirmed after the initial context package was
written:

| Decision | Confirmed direction |
| --- | --- |
| Prepared Recap artifact/cache | Use local derived cache with enough structured detail for Panel/Tab. Do not auto-write Markdown. Do not store full raw provider output. Export/save requires explicit user action. |
| Recap scope and trigger | Default to current-context + time-range recap. Pagelet open, note save, and low-frequency idle preparation may prepare artifacts. Do not default to daily/weekly whole-vault summaries. |
| DeliveryCandidate persistence | `DeliveryCandidate` is a display/ranking/action contract, not one durable inbox. Recap may use local derived cache; Pattern uses short-term dedupe; Recall/Review do not add long-term persistence by default. |
| Review findings in Bubble | Generic review does not enter Bubble. Only source-backed, high-confidence review candidates with why-now and low-burden next action may appear, below Recall/Recap/Pattern. |
| Discover click flow | Bubble starts lightweight async search. Fast high-quality results stay in Bubble; slow, weak, or complex results route to Panel. Results bind to the active-note snapshot. |
| Small interaction defaults | Intentionally Quiet explains once then becomes minimal; progress numbers only for larger vaults; no Pet state expansion this round; no pending-queue wording. |
| Periodic Summary migration | Migrate value into Recap time-range mode and directly remove old Periodic Summary / Generate Summary entrypoints. Do not keep aliases or redirects. |

## Current Bubble Surface Under Discussion

Observed empty-state Bubble:

```text
No new findings yet.

[Review current note]
Scan the active note now

[Discover connections]
Find related notes

[Generate summary]
Use AI to summarize recent changes
```

The current UI gives three apparent actions when there are no prepared findings.
The product risk is that Pagelet starts to feel like an AI tool launcher rather
than a quiet recall doorway.

## Current Feature Meanings

### Review Current Note

What it currently suggests to the user:

- "Scan the active note now."
- "Review this note for suggestions."

User value:

- Easy to understand.
- Useful immediately after writing a note.
- Reduces blank-prompt friction.
- Gives a first-time user something obvious to try.

Product risk:

- This is not strongly differentiated.
- It can make Pagelet feel like a generic AI reviewer or writing assistant.
- It may pull PA away from "old notes return" toward "AI comments on current
  text."

Strict assessment:

- Not necessarily a fake need.
- But as the primary Bubble action, it may be a fake main need.
- It should not define Pagelet's core product identity.

Recommended framing:

- "Current note" should become context for recall/discovery, not a standalone
  top-level product promise.
- If kept, it should produce source-backed observations and possible missing
  links, not broad writing advice.

### Discover Connections

What it currently suggests to the user:

- "Find related notes."

User value:

- Strongly aligned with PA's North Star.
- Helps old notes return without manual search.
- Addresses the long-term Obsidian problem: notes become hard to re-find after
  the vault grows.

Product risk:

- If it is only a related-note list, it competes with Smart Connections.
- "Find related notes" is too weak and generic.
- The value is not just relation detection; it is timely, explainable return.

Strict assessment:

- This is the strongest strategic direction among the three Bubble actions.
- It needs deeper product design, not just more UI polish.

Recommended framing:

- Unify Discover Connections and Quiet Recall into one recall/discovery product
  line.
- Active path: user asks Pagelet to find old notes.
- Passive path: Quiet Recall surfaces a small number of old notes at natural
  breaks.
- Both paths should answer:
  - Which old note returned?
  - Why now?
  - What source evidence supports the connection?
  - What can the user do next?

### Generate Summary

What it currently suggests to the user:

- "Use AI to summarize recent changes."

User value:

- Potentially useful for weekly reports, retrospectives, project summaries, or
  diary review.
- Can compress recent material into a readable digest.

Product risk:

- In the Bubble empty state, it has weak context.
- The user does not know what range will be summarized.
- It sounds like a generic AI summary action.
- It can reintroduce the Weekly Review burden that the 2026-07-02 discussion
  intentionally decomposed.
- It moves Pagelet toward "generation" instead of "return."

Strict assessment:

- The capability may remain valuable.
- The always-visible Bubble action is not justified.

Recommended framing:

- Remove it from the default Bubble empty state.
- Treat `Generate summary` / Periodic Summary as a legacy surface during the
  migration toward Recap time-range mode.
- Show recap in Bubble only when PA has already prepared a source-backed recap
  artifact for the current scope.
- Directly remove old command palette or Panel/Tab Periodic Summary entrypoints
  during the Phase 6 migration; do not keep compatibility aliases or redirects.

### Quick Capture

Relevant observation:

- Long-press Pagelet triggers Quick Capture.
- The circular hold animation is product-aligned: it gives progress feedback at
  the point of intent without text-heavy instruction.

User value:

- Supports "Capture lightly."
- Gives a low-friction entry for raw thoughts.
- The real value comes later when captured material can return through PA.

Product risk:

- Quick Capture is not unique versus QuickAdd/Daily Notes.
- If over-promoted, it can dilute Pagelet's identity.

Recommended framing:

- Keep as a quiet affordance rather than a large Bubble button.
- Consider subtle first-use discoverability.
- The bridge message after capture should be:
  - "Saved. PA may bring it back when it becomes relevant."

## User's Tentative Ideas And Critical Analysis

The user explicitly said these ideas may be wrong. Analyze them coldly from the
perspective of ordinary users, product strategy, and PA tone.

### Idea 1: Review Current Note overlaps with Quiet Recall; maybe merge them.

Assessment:

- Partly correct.
- Review Current Note and Quiet Recall are not identical in theory.
- But in the Bubble, both can become "do something with current note," which
  causes product confusion.

Difference in theory:

| Capability | User problem | Product strength |
| --- | --- | --- |
| Review Current Note | Is this note missing something or worth improving? | Immediate and easy to understand |
| Quiet Recall | What old note should return now? | Strong North Star fit |

Conclusion:

- Do not simply delete Review Current Note without replacing its first-use value.
- Do demote it from "primary Pagelet identity."
- Merge most of its valuable output into a recall/discovery-centered current-note
  analysis.

Better product model:

```text
Current note is the anchor.
PA's main job is to bring back relevant old notes and source-backed observations.
```

### Idea 2: Discover Connections deserves deeper product design.

Assessment:

- Correct.
- This should be the main next design discussion.

Key design problem:

- The value is not "find related notes."
- The value is "this older thought matters again now, for this reason."

Design questions:

1. What relation types should Pagelet expose?
   - same topic
   - prior decision
   - unresolved question
   - contradiction/tension
   - repeated theme
   - possible link target
2. How many connections should Bubble show?
3. What belongs in Bubble versus Panel versus Tab?
4. Which actions are allowed from Bubble?
5. When does a connection become durable state?
6. How should `pa-related` linking be explained to ordinary users?

### Idea 3: Generate Summary has unclear value.

Assessment:

- Correct for Bubble.
- Not necessarily correct for the capability as a whole.

Recommendation:

- Remove from default Bubble empty state.
- Reintroduce only as a contextual recap when:
  - user explicitly asks for recent review
  - Pagelet has enough recent notes to summarize
  - summary has a clear range and source disclosure

### Idea 4: Pagelet has background functions with weak or opaque status.

Assessment:

- Correct and important.
- This may be the highest-impact next UX problem.

Problem:

`No new findings yet` can mean many different things:

- Pagelet is disabled.
- Pet is hidden.
- proactive hints are off.
- Quiet Recall Bubble nudges are off.
- Memory is not prepared.
- current note is too short.
- current note is excluded by Data Boundary.
- quiet hours or Focus Mode are suppressing nudges.
- background preparation has not run.
- Pagelet ran and genuinely found nothing strong.

These are not equivalent user states. If all collapse into "No new findings
yet," first-time users cannot know whether Pagelet is useful, misconfigured, or
working quietly.

Strict product implication:

- Before adding more advanced functionality, make Pagelet understandable.
- The goal is not a technical status dashboard.
- The goal is a quiet, human-readable readiness explanation and one sensible
  next action.

## Proposed Next Iteration Theme

Recommended theme:

> Make Pagelet understandable as a quiet recall doorway.

Not:

> Add more Bubble actions.

Not:

> Turn Bubble into a background job control center.

The iteration should improve first-use comprehension, recall/discovery focus,
and readiness transparency.

## Recommended Product Direction

### 1. Redesign Bubble Empty State

Current issue:

```text
No new findings yet.
Review current note / Discover connections / Generate summary
```

This reads like a feature menu.

Preferred direction:

```text
No prepared findings yet.

PA can start from this note and look for related old notes.

[Find related notes]
[Review this note]
```

Only show actions that are valid for the current state.

Examples:

#### Memory Not Ready

```text
PA needs Memory prepared before it can reliably bring old notes back.

[Prepare Memory]
[Review this note]
```

#### Current Note Too Short

```text
This note is still too light for meaningful recall.

[Capture a thought]
[Review anyway]
```

#### Proactive Hints Off

```text
PA is quiet unless you open it.

[Find related notes]
[Turn on gentle hints]
```

#### Strong Recall Available

```text
This note may connect to 2 older notes.

[View]
[Later]
```

### 2. Unify Discover Connections And Quiet Recall

Product line:

```text
Recall / Discovery
  - user-initiated: Discover connections
  - PA-initiated: Quiet Recall
```

Shared result card:

```text
Old note: <title>
Relation: <why this matters now>
Evidence: <source note / tag / link / excerpt reference>
Next: <open / link / save insight / ignore>
```

Allowed actions:

- Open source
- Link to current note
- Dismiss / Later
- Save as insight only from Panel/Tab detail, not from Bubble

Durable boundary:

- Opening or dismissing creates no debt.
- Linking writes `pa-related` and needs a clear success state.
- Saving as insight creates a local Saved Insight with sourceRefs, but because
  it creates durable interpreted knowledge, it belongs in Panel/Tab detail.
- Promoting to Memory remains a stricter explicit confirmation path.

### 3. Migrate Generate Summary / Periodic Summary To Recap

Recommended change:

- Remove from default Bubble empty state.
- Terminal product direction: migrate Periodic Summary into Recap time-range
  mode, not a standalone long-term product capability.
- Directly remove legacy `Generate summary` / Periodic Summary entrypoints in
  the migration; do not keep aliases or redirects.
- Bubble may show recap only as contextual delivery of an already-prepared,
  source-backed recap artifact.

Allowed delivery example:

```text
PA prepared a short recap for this scope.

[View recap]
[Later]
```

Disallowed delivery example:

```text
PA can build a short recap.

[Generate summary]
```

This preserves the review value without making summary a generic AI button.

### 4. Add Pagelet Readiness Explanation

Do not expose raw internals.

Use user-readable readiness states:

| User-facing state | Internal causes it may cover | User action |
| --- | --- | --- |
| Ready to review this note | Pagelet enabled, active md note exists | Review / Discover |
| Can bring old notes back after Memory is prepared | Memory/VSS not ready | Prepare Memory |
| Quiet unless opened | proactive hints off | Turn on gentle hints |
| Paused for focus | Focus Mode / quiet hours | Keep quiet / change setting |
| Nothing strong yet | no high-confidence candidates | Close / Review anyway |
| This note is outside PA's current boundary | Data Boundary exclusion | Explain boundary / change settings |

Copy principles:

- Explain what the user can do next.
- Do not say VSS, RAG, OPFS, embedding, queue, or backend.
- Do not over-explain.
- Avoid "errors" when the system is simply quiet by design.

## Priority Recommendation

Recommended order:

1. **Bubble readiness and empty-state redesign**
   - Highest first-use and retention impact.
   - Prevents users from mistaking "quiet" for "broken."

2. **Recall/Discover product unification**
   - Highest strategic value.
   - Aligns Pagelet with "old notes return."

3. **Periodic Summary migration into Recap**
   - Reduces tool-menu feeling.
   - Avoids rebuilding Weekly Review pressure.
   - Keeps "review" as source-backed return rather than generic generation.

4. **Memory batch confirmation refinement**
   - Keep in Tab, not Bubble.
   - Low urgency unless current Tab experience creates user burden.

5. **Cross-note pattern detection design**
   - Worth doing later.
   - Must stay rare, high-confidence, and source-backed.

6. **Chat text selection**
   - Useful but not Pagelet's main product line.
   - Keep separate from Bubble iteration.

7. **Trust upgrade / autonomy**
   - Too early.
   - Needs repeated evidence that PA suggestions are accurate and safe.

## Historical Discussion Items Now Resolved

The following items were originally prepared for Claude Code discussion. They
are no longer open product decisions after the 2026-07-05 follow-up discussion.
Keep them as rationale/provenance, not as approval gates.

### Resolved A: What should Bubble be when there are no findings?

Options:

1. Keep as feature launcher.
   - Pros: simple, gives users actions.
   - Cons: weak product identity, generic AI tool feel.

2. Make it a readiness explanation plus one primary next action.
   - Pros: clearer, more trustworthy, better first-use comprehension.
   - Cons: requires state model and copy design.

3. Hide most actions until Pagelet has something prepared.
   - Pros: very quiet.
   - Cons: weak discoverability; first-time users may see no value.

Resolved direction: option 2. Bubble shows a user-readable readiness/empty
state with one context-appropriate action.

### Resolved B: Should Review Current Note remain a primary Bubble action?

Options:

1. Keep primary.
   - Pros: obvious first-time action.
   - Cons: makes Pagelet look like generic note review AI.

2. Demote behind Discover / Recall.
   - Pros: strengthens North Star.
   - Cons: users with no Memory or small vault may lose the easiest entry.

3. Merge into a "Start from this note" action.
   - Pros: current note becomes anchor for review + recall.
   - Cons: needs careful result design.

Resolved direction: Review Current Note is not a primary Bubble action. It
remains only as a Needs Setup fallback or explicit command/panel route.

### Resolved C: Should Discover Connections and Quiet Recall share a product model?

Resolved direction: yes.

Rationale:

- Same user value: old notes return.
- Different trigger mode: user-initiated versus PA-initiated.
- Shared cards/actions reduce product confusion.

### Resolved D: Should Generate Summary remain in Bubble?

Recommended: no, not as a default empty-state action.

Resolved direction: migrate Periodic Summary / Generate Summary into Recap
time-range mode. Bubble can deliver a prepared recap, but it must not offer a
foreground "generate summary" CTA. The runtime migration directly deletes old
entrypoints without alias or redirect.

### Resolved E: How much background status should Pagelet reveal?

Resolved direction:

- Reveal user-readable readiness, not technical status.
- Show one reason and one next action.
- Deeper diagnostics belong in settings/advanced, not Bubble.

## Archived Claude Code Prompt

This was the original prompt for product critique before decisions were
resolved. Do not use it as the current implementation brief.

```text
We are discussing the next Pagelet product iteration in the PA Obsidian plugin.
Do not optimize for adding features. Evaluate only by user value, PA North Star
("随手记下，需要时自然浮现"), and design philosophy ("安静且可信").

Please critique and refine the proposed direction:

1. Bubble should stop acting like a generic AI feature launcher.
2. Bubble empty state should explain Pagelet readiness in user language and show
   one context-appropriate next action.
3. Discover Connections and Quiet Recall should be unified into one Recall /
   Discovery product line: user-initiated versus PA-initiated.
4. Review Current Note should be demoted or reframed as "start from this note,"
   not remain the core product promise.
5. Generate Summary / Periodic Summary should migrate into Recap time-range
   mode. Bubble may show only already-prepared source-backed recap delivery,
   never a foreground generation CTA.
6. Background capability status should be understandable without exposing
   internals.

Please analyze from ordinary-user value, product strategy, and PA tone. Push
back where this direction is wrong. Then propose the smallest next product
spec/SDD slice that should be written before implementation.
```

## Historical Suggested Next Artifact

The direction was accepted and the focused product spec/SDD have already been
created. This section remains as provenance for why those artifacts exist.

```text
docs/product/specs/pagelet-bubble-readiness-and-recall-product-spec.md
```

Suggested sections:

1. Problem statement
2. Product principles
3. Bubble state model
4. Recall/Discover unified result model
5. Empty-state copy matrix
6. Allowed Bubble actions
7. What moves to Panel/Tab
8. Non-goals
9. Open decisions
10. Validation / smoke scenarios

## Non-Goals For The Next Slice

Do not include:

- real-time editing recall
- autonomous linking
- full trust/autonomy upgrade
- broad summary generation redesign beyond the Periodic Summary to Recap
  time-range migration
- Chat text replacement
- Memory cabinet redesign
- Graph visualization redesign

These may matter later, but they distract from the immediate product clarity
problem.

## Success Criteria

The next iteration is successful if:

1. A first-time user understands whether Pagelet is ready, quiet, or needs setup.
2. The Bubble no longer reads like a generic AI feature menu.
3. The strongest visible product path is old-note return, not AI generation.
4. `Generate summary` no longer appears as a Bubble CTA; any recap delivery is
   already prepared, source-backed, and routed to detail.
5. `Review current note` no longer dominates the product identity.
6. Discover/Quiet Recall results show source-backed "why now" explanations.
7. Ignoring a Bubble creates no debt.
8. Durable actions remain explicit and understandable.
