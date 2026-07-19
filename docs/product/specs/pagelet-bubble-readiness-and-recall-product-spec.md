# Pagelet Bubble Readiness & Recall Product Spec

## Status

| Field | Value |
| --- | --- |
| Document type | Product specification |
| Scope | Pagelet Bubble empty-state redesign, Recall/Discover unification, readiness transparency, DeliveryCandidate contract |
| Status | Phase 6 base and DEC-017/DEC-018/DEC-019/DEC-020 B-108 runtime validated with automated/deploy gates passing; bounded unlocked desktop/iPhone 15 evidence, user-operated desktop/iPhone physical long-press, real Obsidian Review/Discover routing/presentation/Qwen semantics, and the correctly prepared user-owned 3-Second Value Test complete |
| Updated | 2026-07-19 |
| Created | 2026-07-05 |
| North Star | [PA Product North Star](../pa-product-north-star.md): 随手记下，需要时自然浮现 |
| Design philosophy | 安静且可信 |
| Current authority | This spec, the [B-108 owning Scope Recap spec](./pa-scope-recap-theme-summary-product-spec.md), and [DEC-017](../decisions/dec-017-default-background-recap-preparation.md) through [DEC-020](../decisions/dec-020-independent-quiet-recall-evaluation.md) |
| Historical provenance (non-authoritative) | [Pagelet Bubble Next Iteration Context](../../archive/pagelet-bubble-next-iteration-context-2026-07-05.md) |
| Parent design | [Pagelet Product Design](../pagelet-product-design.md) |
| Product amendment | [Pagelet Delivery Preparation Consolidation Product Note](./pagelet-delivery-preparation-consolidation-product-note.md) |
| Implementation record | [Historical SDD](../../archive/pagelet-bubble-readiness-and-recall-sdd.md) and [redesign tracker](../../archive/pa-product-redesign-development-tracker.md) |

---

## 1. Problem Statement

The pre-implementation Bubble empty state showed three action buttons (Review
current note / Discover connections / Generate summary), making Pagelet feel
like an AI feature launcher rather than a quiet recall doorway.

```text
No new findings yet.

[Review current note]
Scan the active note now

[Discover connections]
Find related notes

[Generate summary]
Use AI to summarize recent changes
```

"No new findings yet" collapses 10+ distinct internal states into one opaque
message, preventing users from understanding whether PA is useful,
misconfigured, or working quietly. Those internal states include:

- Pagelet is disabled.
- Pet is hidden.
- Generic proactive hints are off and no fresh prepared Recap is available.
- Quiet Recall Bubble nudges are off.
- Memory is not prepared.
- Current note is too short.
- Current note is excluded by Data Boundary.
- Quiet hours or Focus Mode are suppressing nudges.
- Background preparation has not run.
- Pagelet ran and genuinely found nothing strong.

These are not equivalent user states. When all collapse into "No new findings
yet," first-time users cannot know whether Pagelet is ready, quiet, or needs
setup — and they are left facing a feature menu instead of a recall doorway.

---

## 2. Product Principles

Based on the current [PA North Star](../pa-product-north-star.md), the B-108
owning Product Spec, and DEC-017 through DEC-020:

1. **Bubble is PA's Delivery Surface, not a control panel or feature menu.**
   The Bubble exists to present PA-prepared findings. It should not read like a
   toolbar of AI actions.

2. **Core concept: PA brings results to the user, not user goes to find
   features.** The primary Bubble path is: PA found something → show it. The
   fallback is: PA has nothing → explain why, offer one next action.

3. **Exclusive content model: findings OR explanation, never both as separate
   zones.** At any moment, the Bubble shows exactly one thing: a delivery card
   or a readiness explanation. Mixed layouts are not allowed.

4. **Background info conveyed through inline context hints within findings, not
   separate status area.** When delivery content exists but a background
   condition (e.g., Memory still preparing) also applies, it appears as a subtle
   annotation on the delivery content, not a separate status bar.

5. **Presence conveyed through Pet visual state, not Bubble text.** Whether PA
   is idle, working, or has findings is communicated by the Pet's visual state.
   The Bubble does not duplicate this with status text.

6. **Status explanation is on-demand: one sentence + one action, not proactive
   reporting.** When the Bubble has nothing to deliver, it shows one human-
   readable reason and one sensible next action. It does not present a status
   dashboard or diagnostics panel.

7. **State set is capped — no expansion without replacing an existing state.**
   The state model defined in this spec is the complete set. Adding a new state
   requires removing or merging an existing one.

8. **Prefer not showing over showing unconvincing recommendations.** If PA
   cannot articulate why a result matters now, it should show nothing rather
   than show a weak result. Silence is a valid product state.

9. **Delivery is selected from a unified candidate pool.** Recall, Recap,
   Pattern, and Review candidates should converge on a single delivery model.
   The Bubble should not preserve old feature boundaries as separate user-facing
   buttons.

10. **Onboarding annotates value moments; it does not replace them.** A real
    Recall or Recap delivery is a stronger first-use explanation than a generic
    bridge hint. Bridge hints can appear when nothing stronger is available or
    as inline context on a real delivery.

---

## 3. Bubble State Model

### 3.1 State Categories

Two mutually exclusive categories. At any moment, Bubble is in exactly one
state.

**Category A: Delivery** (PA has something to deliver)

| State | Trigger | Content |
| --- | --- | --- |
| Recall Delivery | Enabled Quiet Recall or explicit Discover produced an independently AI-evaluated high-quality result | Result card + AI why now + actions |
| Recap Delivery | A fresh prepared Scope Recap exists for the current scope | Recap card + source coverage + route to details |
| Pattern Delivery | Cross-note pattern detection found valuable pattern | Pattern description + sources + actions |
| Review Delivery | Background preparation completed source-backed observations for the current note/scope | Observation result + route to details |
| Bridge Hint | One-time onboarding nudge when no stronger delivery exists | One line guidance + one action |

**Category B: Explanation** (PA has nothing to deliver, explain why)

| State | Trigger | Content |
| --- | --- | --- |
| Needs Setup | Memory not prepared | Explain + [Prepare Memory] + [Review this note] as fallback |
| Preparing | Memory preparation in progress | Progress indication + optional count |
| Ready, Nothing Found | Everything ready, no high-confidence results | Quiet empty + [Find related old notes] |
| Intentionally Quiet | User disabled generic proactive hints and no prepared delivery is available | Minimal empty, no repeated explanation |
| Context Limited | Current note too short / Data Boundary exclusion | Brief reason + alternative action |
| Recap Needs Retry | User explicitly opened Recap, but no valid artifact exists after an unavailable/failed/empty/quality-rejected attempt | Honest status + local scope orientation + [Retry] + [View sources] |

### 3.2 Delivery Selection Rules

Delivery selection should use a unified candidate pool, not fixed feature-button
priority. A candidate is eligible only if it can explain why it is worth showing
now and can route to source-backed detail.

Bubble defaults to the single highest-quality eligible candidate. It may expose
a 2-to-3-card single-visible stack only when every candidate independently
passes its quality gate and remains distinct and source-backed. It must not
render a list.

Bridge hints never replace a real delivery. If a first-use explanation is useful
while Recall or Recap is available, it becomes an inline hint on that delivery.

**A always beats B**: If delivery content exists, show it. Background info
(e.g., Memory still preparing) becomes an inline context hint at the bottom of
the delivery content.

**B-type is mutually exclusive**: Show the single most relevant explanation
state. B-type priority order: Needs Setup > Preparing > Context Limited > Recap
Needs Retry > Intentionally Quiet > Ready, Nothing Found. Recap Needs Retry is
eligible only after an explicit Recap open; it does not occupy the normal Bubble
just because a background attempt failed.

### 3.3 Bubble Card Stack

Bubble is a single-card delivery surface with optional card switching, not a
list.

Rules:

- Default to one visible delivery card: the highest-quality candidate.
- Enable multiple cards only when 2-3 candidates all pass their quality gates
  and are meaningfully distinct.
- Hard cap Bubble at 3 cards. Larger sets route to Panel/Tab.
- Desktop may use subtle arrows or dots. Mobile must support horizontal swipe.
- No autoplay carousel, strong motion, or prominent "remaining" count.
- Each action applies only to the active card.
- Respect reduced-motion settings.

### 3.4 Inline Context Hints

When A-type content is shown but a B-type condition also applies (e.g., Memory
still preparing), append a subtle inline hint at the bottom of the delivery
content:

```
💡 PA 还在熟悉你的笔记，可能有更多发现
💡 PA is still learning your notes — more findings may follow
```

This is NOT a separate status area. It is contextual annotation on this
specific delivery. Rules:

- Maximum one inline hint per delivery.
- Inline hint is always the last element in the delivery card.
- Inline hint uses a muted visual style (smaller font, lower contrast).
- Inline hint is not interactive — no buttons, no links.

---

## 4. Recall/Discover Unified Result Model

### 4.1 Product Line

Recall and Discovery are one unified product line with two trigger modes:

| Mode | Trigger | Entry |
| --- | --- | --- |
| User-initiated (Discover) | User clicks "Find related old notes" in empty state, or uses command palette `PA: Discover connections` | Explicit user action |
| PA-initiated (Quiet Recall) | Triggered by note open/switch only after the user enables Quiet Recall/generic proactive hints; both default off | Background, automatic |

An independently AI-evaluated Discover result may share the Recall card format.
A local-only match is different: explicit Discover may show it as a clearly
labeled `Local related clue` / `本地关联线索`, but it has no AI why-now, never
uses proactive Recall styling, never mixes into a proactive Recall stack, and
cannot nudge. The user must be able to tell these provenance levels apart.

### 4.2 Why Now Depth: L3 (Full)

Every proactive Recall and AI-evaluated Discover result MUST include LLM
relationship reasoning. The three layers are fused, not phased:

| Layer | Mechanism | Role |
| --- | --- | --- |
| L1 (semantic similarity) | VSS retrieval finds candidates | Candidate generation — not shown to user |
| L2 (topic + excerpt) | Extract shared topics and source excerpts | Evidence backing — shown as source excerpt |
| L3 (relationship reasoning) | LLM analyzes why this old note matters NOW for the current note | Display-level explanation — shown as "why now" |

All three layers are executed together. L1 produces candidates; for each
candidate, L2 and L3 are generated together in one candidate-scoped initial
call. Candidates are not batch-judged:
[DEC-020](../decisions/dec-020-independent-quiet-recall-evaluation.md) permits
at most 5 independent initial calls plus one language retry per candidate. The
user sees L3 (why now) and L2 (source excerpt). L1 scores are internal and not
displayed.

### 4.3 Display Threshold

The LLM's ability to articulate a convincing "why now" IS the proactive Recall
and AI-evaluated Discover display threshold.

- If LLM can explain why this old note matters now → **show**.
- If LLM cannot produce a convincing explanation → **do not show**.
- No fixed semantic similarity score cutoff.

This means Recall may return zero results even when VSS finds candidates. This
is correct behavior — silence is preferable to unconvincing recommendations
(Principle 8).

Explicit Discover has one provenance-safe exception: it may show a local match
as `Local related clue` / `本地关联线索`, with source/title and a verifiable local
relation signal only. It must omit AI why-now copy and must not be presented as
Recall Delivery.

### 4.4 Result Card Structure

```
┌─────────────────────────────────────┐
│ 📄 [Old note title]                 │
│ [Why now: one-sentence relationship │
│  reasoning from LLM]               │
│ "[Source excerpt from old note]"    │
│                                     │
│ [Open] [Link to current] [Later]    │
└─────────────────────────────────────┘
```

Bilingual examples:

**English:**

```
📄 System Refactoring Notes
Your current note discusses a transaction timeout issue.
You explored a similar trade-off 3 months ago:
"Decided on saga pattern, but worried about compensation complexity..."

[Open] [Link to current note] [Later]
```

**中文：**

```
📄 系统重构笔记
你当前笔记讨论的事务超时问题，
3 个月前你做过类似的权衡：
"当时决定用 saga 模式，但担心补偿逻辑的复杂度..."

[打开] [链接到当前笔记] [稍后]
```

Card layout rules:

- Title line: note title with 📄 icon prefix. Clickable — opens the note.
- Why now: one sentence from L3. Must be specific to the current context.
- Source excerpt: one quoted excerpt from the old note (L2). Maximum 2 lines.
- Actions: horizontally laid out below the excerpt.

These layout rules apply to AI-evaluated Recall cards. A Discover-only local
clue uses the distinct local label and source facts instead of the L3 why-now
line.

### 4.5 Allowed Actions

| Action | Effect | Durable? | Success feedback |
| --- | --- | --- | --- |
| Open | Navigate to the old note | No (no debt created) | Note opens in editor |
| Link to current note | Write `pa-related` frontmatter link | Yes (needs success feedback) | Brief toast: "Linked ✓" / "已链接 ✓" |
| Later / Dismiss | Close the card | No (no debt created) | Card closes |

Durable boundary:

- **Opening or dismissing creates no debt.** The user can read, close, or
  ignore any Recall card without creating pending items, queues, or future
  notifications about the same result.
- **Linking writes `pa-related`** frontmatter and needs a clear success state.
  This is a vault mutation and follows the Write Action Framework (D025, D030).
- **Saving as insight does not appear in Bubble in this iteration.** It belongs
  in Panel/Tab detail where sourceRefs, why-now, and the durable consequence can
  be shown clearly.

### 4.6 Relation Types (for LLM guidance)

The LLM should consider these relation types when generating "why now":

| Relation Type | Example "why now" phrasing |
| --- | --- |
| Same topic / shared concept | "Both notes discuss X" |
| Prior decision relevant to current context | "You decided Y 3 months ago; this note revisits the same trade-off" |
| Unresolved question that current note revisits | "You asked 'how to handle Z?' — this note may have an answer" |
| Contradiction or tension between current and old thinking | "Your old note argues for A, but this note leans toward B" |
| Repeated theme across time | "This is the third time you've written about X this quarter" |
| Possible link target (structural connection) | "These notes share context but aren't linked yet" |

The LLM chooses the most relevant type. The UI does **not** expose the type
label — it is internal guidance for the LLM, not a user-facing category.

---

## 5. Empty-State Copy Matrix

All copy follows these principles:

- Explain what the user can do next.
- Never say VSS, RAG, OPFS, embedding, queue, backend, vector.
- Never over-explain.
- Avoid "error" language when the system is quiet by design.
- Copy must work in both English and Chinese. Provide both versions.

### State: Needs Setup

**EN:**

```
PA needs to learn your notes before it can bring old ideas back.

[Prepare Memory]
[Review this note]
```

**ZH:**

```
PA 需要先了解你的笔记，才能帮你找回旧想法。

[准备记忆]
[先看看这篇笔记]
```

Notes:
- "Review this note" is a fallback for users who want immediate value before
  Memory is ready. It triggers foreground analysis of the current note.
- This state is shown only when Memory has never been prepared. After a failed
  preparation, a different message should indicate the failure.

### State: Preparing

**EN:**

```
PA is learning your notes. Findings will appear when ready.

(Optional: Reviewed 47 of 120 notes)
```

**ZH:**

```
PA 正在熟悉你的笔记，准备好后会有发现。

（可选：已看过 47/120 篇笔记）
```

Notes:
- Progress numbers are optional (see resolved decision OD-4 in §9).
- No action buttons in this state — the user should wait.
- If preparation is taking unusually long, do NOT show an error. Keep the same
  copy. Errors surface through Pet visual state (brief red flash).

### State: Ready, Nothing Found

**EN:**

```
No new findings yet.

[Find related old notes]
```

**ZH:**

```
暂时没有新发现。

[从这篇笔记查找关联]
```

Notes:
- This is the steady-state empty. It should feel calm, not broken.
- "Find related old notes" triggers user-initiated Discover.
- Do NOT show "Review current note" or "Generate summary" buttons here.

### State: Intentionally Quiet

**EN:**

```
PA is quiet unless you open it.

[Find related old notes]
```

**ZH:**

```
PA 只在你打开时才会查找。

[从这篇笔记查找关联]
```

Notes:
- Shown when default-off generic/Quiet Recall proactive hints are disabled and
  the user opens Bubble manually, unless a prepared Recap or other eligible
  delivery is available.
- If the user has already seen and acknowledged this state, do not re-explain.
  Show minimal empty (just the action button, no explanation text).
- "Find related old notes" triggers user-initiated Discover.

### State: Recap Needs Retry

This is the DEC-019 explanation fallback when an explicit Recap entrypoint uses
Bubble. The behavior is surface-neutral: a command that already opens the
detail surface may render the equivalent state there and does not need to route
through Bubble. It is not a DeliveryCandidate and cannot enter the proactive
hint pool.

**EN:**

```
PA couldn't produce a reliable recap this time.

Recently changed in this scope:
- Release plan
- Milestone notes

[Retry] [View sources]
```

**ZH:**

```
PA 这次没有生成可靠回顾。

这个范围最近有变化的来源：
- 发布计划
- 里程碑笔记

[重试] [查看来源]
```

Notes:
- Render synchronously from local scope/source metadata. Opening this state does
  not start a provider call or spinner.
- Show a bounded list of real source titles/links, scope/range, and relevant
  skipped/boundary status. Do not invent themes, tensions, actions, or generic
  tag/count summaries.
- If a still-valid source-backed artifact exists, show Recap Delivery instead.
  If local facts are too thin to orient the user, omit the list rather than pad
  it.
- Retry is the only action that starts foreground generation. If AI is not set
  up, replace Retry with a setup action. View sources never calls AI.
- User-facing copy stays product-level; detailed attempt category belongs in
  diagnostics.

### State: Context Limited

Two sub-variants:

**Note too short — EN:**

```
This note is still too light for meaningful recall.

[Capture a thought]
```

**Note too short — ZH:**

```
这篇笔记内容还太少，暂时无法进行有效的关联查找。

[随手记一笔]
```

**Data Boundary — EN:**

```
This note is outside PA's boundary, so PA will stay quiet.

[View boundary settings]
```

**Data Boundary — ZH:**

```
这篇笔记不在 PA 当前边界内，PA 会保持安静。

[查看边界设置]
```

Notes:
- "Capture a thought" triggers Quick Capture for the too-short variant.
- "View boundary settings" opens PA settings for the Data Boundary variant, but
  it should be styled as a weak/secondary action. Data Boundary is a trust
  signal, not a setup error.
- Do NOT combine both sub-variants into one message.

---

## 6. Allowed Bubble Actions Per State

### A-type States

| State | Primary Action | Secondary Actions |
| --- | --- | --- |
| Recall Delivery | Open source note | Link to current / Later |
| Recap Delivery | View recap | Later |
| Pattern Delivery | View pattern details | Dismiss / Later |
| Review Delivery | View details | Dismiss |
| Bridge Hint | (one-time action) | Dismiss |

### B-type States

| State | Primary Action | Secondary Action |
| --- | --- | --- |
| Needs Setup | Prepare Memory | Review this note (fallback) |
| Preparing | (none — informational) | (none) |
| Ready, Nothing Found | Find related old notes | (none) |
| Intentionally Quiet | Find related old notes | (none) |
| Context Limited | Capture a thought / weak View boundary settings | (none) |

### Action Constraints

- Every state has at most **one primary action** and at most **two secondary
  actions**.
- No state shows more than three total action buttons.
- Actions must be valid for the current state. Do not show "Prepare Memory" in
  Ready, Nothing Found. Do not show "Find related old notes" in Needs Setup.
- Dismiss/Later always closes the Bubble without creating any debt.

### DeliveryCandidate Persistence Rules

`DeliveryCandidate` is a shared display, ranking, route, and action contract. It
is not a single durable inbox of PA suggestions.

| Candidate kind | Persistence default | Product reason |
| --- | --- | --- |
| Recall | Reuse existing Quiet Recall state / in-memory delivery | Recall can be recomputed; storing it as a queue creates debt. |
| Recap | Local derived cache | Bubble can claim "prepared" only when a structured artifact already exists. |
| Pattern | Short-term dedupe only | Prevent repeated nudges without creating a long-term review queue. |
| Review | In-memory / existing preload cache | Generic review findings should not become a durable task list. |

Dismiss/Later may affect short-term display and ranking, but must not create an
unresolved item count or a user-visible backlog.

### Review Candidate Eligibility

Generic review findings do not belong in Bubble. A `review` candidate may enter
Bubble only when it is:

- source-backed
- high-confidence
- connected to a clear why-now
- specific enough to name the finding, not just "review this note"
- paired with a low-burden next action

Review candidates rank below Recall, Recap, and Pattern. `Review current note`
remains a Needs Setup fallback or intentional Panel/Tab/Command action, not the
default Bubble identity.

### Discover Trigger Flow

When the user clicks "Find related old notes":

1. Capture the active-note snapshot.
2. Start a lightweight async Discover/Recall search inside Bubble.
3. If fast independently AI-evaluated results are available, show the best one
   by default; expose a 2-to-3-card stack only when every candidate independently
   passes and remains distinct and source-backed.
4. If AI evaluation is unavailable or rejected but a source-backed local match
   exists, explicit Discover may show it only as a labeled local related clue,
   without AI why-now and without mixing it with Recall cards.
5. If results are slow or complex, route to Panel/Tab instead.
6. Drop or mark stale any result whose active-note snapshot no longer matches.

Bubble must not block indefinitely, show weak long lists, or deliver results to
the wrong current note.

---

## 7. What Moves to Panel/Tab/Command Palette

| Feature | Removed From | Moved To | Trigger |
| --- | --- | --- | --- |
| Review Current Note | Bubble primary action | Bubble fallback (Needs Setup only), Chat, Command Palette (`PA: Review current note`), Panel/Tab | User-initiated |
| Generate Summary | Bubble empty-state action | Retired in Phase 6 migration; terminal replacement is Recap time-range mode | Removed legacy entrypoint |
| Recap Delivery | Implemented as a prepared, source-backed B-108 artifact | Bubble only after a fresh prepared Scope Recap artifact exists | PA contextual delivery |

### Review Current Note

Review Current Note is not removed from the product — it is relocated. It
remains available as:

- Fallback action in the Needs Setup B-type state (for users who want immediate
  value before Memory is ready).
- Command palette action: `PA: Review current note`.
- Chat-initiated: user can ask PA to review the current note in Chat.
- Panel/Tab: available as a Panel action when the Panel is open.

It is no longer a primary action in the default Bubble empty state because it
makes Pagelet look like a generic AI note reviewer rather than a recall
doorway.

### Recap Delivery

Generate Summary is no longer the Bubble concept, and it is not the long-term
product concept. Phase 6 should migrate its value into Recap time-range mode
and directly remove old Periodic Summary / Generate Summary entrypoints rather
than keeping a legacy alias or redirect. Bubble should not show a
"Generate summary" or "PA can build a recap" CTA.

Intentional summary/recap remains available as:

- Panel/Tab action for intentional time-range Recap.

Bubble may show Recap Delivery only when PA has already prepared a fresh,
source-backed recap artifact. Phase 6 implements this as a local derived
prepared Recap artifact scoped to the active note snapshot; stale, modified, or
cross-note artifacts must not be delivered through Bubble. The product
consolidation contract is recorded in
[Pagelet Delivery Preparation Consolidation Product Note](./pagelet-delivery-preparation-consolidation-product-note.md).

**Prepared Recap Delivery:**

When a prepared recap exists, Bubble may deliver it as A-type content:

**EN:**

```
Two newer notes changed the release plan from weekly to milestone-based,
while three earlier notes still assume the weekly cadence.

[Review evidence] [Later]
```

**ZH:**

```
两篇较新的笔记已把发布计划从每周发布改为按里程碑发布，
但三篇较早的笔记仍沿用每周节奏。

[查看依据] [稍后]
```

If no prepared recap exists, normal Bubble selection must show no recap card.
An explicit Recap open may show the DEC-019 **Recap Needs Retry** B-type state,
but it must not silently fall back to foreground generation.

Prepared Recap artifacts are local derived cache objects with enough structured
detail for Panel/Tab. They must include sourceRefs, source coverage, stale
status, preparedAt, and scope/range metadata, but must not auto-write Markdown
or store full raw provider output. Saving/exporting a recap note remains an
explicit user action.

**Quality-gated proactive Recap signal (DEC-018):**

- A prepared artifact does not earn a nudge merely because generation finished.
- Nudge eligibility requires a fresh/current artifact with at least one concrete
  structured cross-note insight, a why-it-matters relationship, and sourceRefs
  to at least two distinct notes.
- Summary/coverage-only, stale, failed, empty, repeated, dismissed, Later,
  quiet-hours, Focus Mode, or cooldown-suppressed artifacts stay silent.
- One artifact/insight fingerprint can signal at most once. Pet uses only its
  restrained `nudge` state; no modal, sound, focus steal, or pending count.
- Click immediately shows the strongest concrete observation and routes to the
  full detail. Disabling the Recap hint keeps the artifact available on demand.
- This scoped default does not enable Quiet Recall, Pattern, or generic review
  proactive hints.

**Honest layered fallback (DEC-019):**

- Unavailable, thrown, timed-out, empty, malformed, or quality-rejected attempts
  create no Recap Delivery and no nudge.
- A failed attempt does not overwrite a still-current last valid artifact. That
  artifact remains A-type delivery until scope/source snapshot, Data Boundary,
  TTL, or freshness makes it invalid.
- Without a valid artifact, only an explicit Recap open may show local scope
  orientation as Recap Needs Retry. Local orientation is B-type explanation,
  never an insight candidate.
- Initial open is synchronous and call-free. Only explicit Retry enters a
  foreground progress state; retry failure preserves existing content and adds
  non-destructive feedback.

---

## 8. Non-Goals

This iteration does NOT include:

| Non-Goal | Reason |
| --- | --- |
| Real-time editing recall | Requires writing-time integration; separate product surface |
| Autonomous linking (without user action) | Trust not yet earned; durable actions require explicit confirmation |
| Full trust/autonomy upgrade | Too early; needs repeated evidence that PA suggestions are accurate |
| Broad summary generation redesign inside Bubble | Periodic Summary migration belongs to Phase 6 Recap time-range work, not Bubble Phase A |
| Chat text selection/replacement | Useful but separate from Bubble iteration |
| Memory cabinet redesign | Separate product surface |
| Graph visualization redesign | Separate product surface |
| Pet visual state redesign | Covered separately if needed; not blocking Bubble work |
| Panel/Tab layout changes beyond accepting relocated features | Panel redesign is a separate scope |

---

## 9. Resolved Decisions

| # | Decision | Options | Notes |
| --- | --- | --- | --- |
| OD-1 | Pet visual states for Presence | Resolved for this round: no Pet state expansion | Keep only necessary existing state mapping; Pet redesign is not blocking Bubble work. |
| OD-2 | Bubble card stack | Resolved: single-visible-card stack, max 3 cards | Default one; enable card switching only for multiple high-quality distinct candidates. |
| OD-3 | "Intentionally Quiet" acknowledgment | Resolved: show once, then minimal | Persist acknowledgment so repeated Bubble opens do not over-explain quiet mode. |
| OD-4 | Preparing state: show progress numbers? | Resolved: show numbers only for larger vaults | Use a threshold such as 20+ notes. Small vaults show simple preparing copy. |
| OD-5 | Bridge hint content for first Recall | Resolved: real delivery first; bridge as inline hint | Onboarding annotates value moments, not replaces them. |
| OD-6 | Discover trigger from empty state | Resolved: Bubble async first, Panel fallback | Fast high-quality results stay in Bubble. Slow, weak, or complex results route to Panel. Results must be active-note snapshot-bound. |
| OD-7 | Periodic Summary terminal migration | Resolved: migrate standalone Periodic Summary into Recap time-range mode | Phase 6 directly removes old Periodic Summary / Generate Summary entrypoints; no alias/redirect. |
| OD-8 | Recap Delivery runtime timing | Resolved product direction: implement prepared Recap as local derived cache | Phase 6 implements local prepared Recap Delivery scoped to the active note snapshot; future durable cache work requires a separate storage and staleness design. |

---

## 10. Validation / Smoke Scenarios

### First-time user scenarios

| # | Scenario | Expected Behavior |
| --- | --- | --- |
| 1 | Install + open Bubble | Should see **Needs Setup** state with "Prepare Memory" + "Review this note" fallback. NOT three feature buttons. |
| 2 | After Prepare Memory starts | Should see **Preparing** state with progress. |
| 3 | After Prepare Memory completes, open note | Should see **Ready, Nothing Found** with "Find related old notes". |
| 4 | Click "Find related old notes" | Should trigger Discover and show an L3 result card when AI evaluation passes; otherwise it may show a clearly labeled local related clue with no AI why-now, or stay in Ready, Nothing Found. |

### Returning user scenarios

| # | Scenario | Expected Behavior |
| --- | --- | --- |
| 5 | Open note with Quiet Recall enabled, high-confidence match exists | Should see **Recall Delivery** with why-now card. NOT empty state. |
| 6 | Open note, no match | Should see **Ready, Nothing Found**. NOT feature menu. |
| 7 | Generic proactive hints off, no prepared Recap, open Bubble | Should see **Intentionally Quiet**. NOT "No new findings yet" with three buttons. A fresh prepared Recap still takes delivery priority and opens immediately even when its proactive hint is disabled. |
| 8 | Note is 2 lines long | Should see **Context Limited** (note too short). NOT generic empty. |
| 9 | Note excluded by Data Boundary | Should see **Context Limited** (boundary variant). |

### Edge cases

| # | Scenario | Expected Behavior |
| --- | --- | --- |
| 10 | Memory preparing + Recall has partial results | Should show **Recall Delivery** (A beats B) with inline hint "PA is still learning your notes." |
| 11 | Bridge hint + Recall result both available | Should show **Recall Delivery** with a subtle inline bridge hint. |
| 12 | User dismisses Recall card | No debt created. Next Bubble open starts fresh. |
| 13 | Fresh prepared recap exists for current scope | Manual Pet/Bubble open shows **Recap Delivery** immediately, regardless of whether its proactive nudge is enabled. The stricter DEC-018 quality gate controls interruption, not click-to-view availability. No prepared recap means no recap CTA. |
| 14 | Background Recap attempt fails but prior artifact still matches the current source snapshot | Manual open shows the prior **Recap Delivery** immediately; failure is diagnostic state and does not erase valid value. |
| 15 | User explicitly opens Recap after failure/empty/quality rejection with no valid artifact | Shows **Recap Needs Retry** immediately with real local scope/source orientation and no provider call. |
| 16 | User clicks Retry and generation fails | Existing explanation/overview stays visible with non-destructive feedback; no generic summary becomes delivery. |

### Regression guards

| # | Guard | Assertion |
| --- | --- | --- |
| 17 | Generate Summary button must NOT appear in any B-type empty state | No B-type state includes "Generate summary" as an action. |
| 18 | Review Current Note must NOT appear as primary action in Ready, Nothing Found | "Review current note" only appears as fallback in Needs Setup. |
| 19 | No state should display VSS, RAG, OPFS, embedding, vector, backend, queue, schema, or provider error codes | All user-facing copy uses product language only. |
| 20 | Ignoring any Bubble content must create zero future debt | Dismissing, closing, or ignoring any Bubble state produces no pending items, queues, badges, or re-notifications about the same content. |
| 21 | Local scope overview must never become Recap Delivery or nudge | Explanation-only facts are excluded from DeliveryCandidate and proactive hint pools. |
| 22 | Discover-only local match must not look like proactive Recall | It is labeled `Local related clue` / `本地关联线索`, contains no AI why-now, never enters a Recall stack, and cannot nudge. |

---

## References

- [PA Product North Star](../pa-product-north-star.md)
- [Pagelet Product Design](../pagelet-product-design.md)
- [Historical PA Product Discussion 2026-07-02](../../archive/pa-product-discussion-2026-07-02.md)
- [Historical Pagelet Bubble Next Iteration Context](../../archive/pagelet-bubble-next-iteration-context-2026-07-05.md)
- [Historical Pagelet Bubble Product Discussion 2026-07-05](../../archive/pagelet-bubble-product-discussion-2026-07-05.md)
- [PA Product Information Architecture Spec](../pa-product-information-architecture-spec.md)
