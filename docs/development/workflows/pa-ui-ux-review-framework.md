# PA UI/UX Review Framework

Updated: 2026-11-08

## Status

| Field | Value |
| --- | --- |
| Document type | Design review framework / reusable audit checklist |
| Scope | All PA user-facing surfaces |
| Role | Defines evaluation dimensions, scoring criteria, and review process for UI/UX design audits |
| Related north star | [PA Product North Star](../../product/pa-product-north-star.md) |
| Related doctrine | [Low-Burden Review Product Principles](../../product/pa-low-burden-review-product-principles.md) |
| Current amendment | Effect/risk-based Memory governance; low-risk reversible understanding may update quietly only when inspectable, correctable, and recoverable |
| Methodology source | [Anthropic Harness Design: Evaluator Architecture](https://www.anthropic.com/engineering/harness-design-long-running-apps) |

## Purpose

This framework provides a repeatable evaluation structure for PA UI/UX design
reviews. It combines Anthropic's Evaluator scoring dimensions (from their
planner-generator-evaluator multi-agent architecture) with PA-specific product
principles. Use the dimensions relevant to the requested audit or the current
task's required review to assess quality and identify improvement opportunities.

---

## 1. Evaluation Dimensions

### Layer A: Universal Design Quality

Derived from the Anthropic engineering team's frontend design evaluator, which
converts subjective "is this design good?" judgments into concrete, gradable
criteria.

#### A1. Design Coherence

> Does the design feel like a coherent whole rather than a collection of parts?

| Score | Description |
| --- | --- |
| 5 | All surfaces share a unified visual language; transitions between layers feel seamless |
| 4 | Strong consistency with minor exceptions in edge cases |
| 3 | Core surfaces are consistent; secondary surfaces diverge noticeably |
| 2 | Multiple competing visual languages across surfaces |
| 1 | Each surface feels independently designed with no shared identity |

#### A2. Visual Polish

> Are spacing, alignment, colors, and typography consistent and refined?

| Score | Description |
| --- | --- |
| 5 | Pixel-precise alignment; deliberate whitespace rhythm; harmonious palette; no orphaned elements |
| 4 | Clean and intentional with minor alignment or spacing irregularities |
| 3 | Functional but lacks fine-grained polish in secondary areas |
| 2 | Noticeable inconsistencies in spacing, font sizes, or color usage |
| 1 | Rough layout with visible misalignment, clashing colors, or cramped elements |

#### A3. Interaction Quality

> Are interaction patterns natural, discoverable, and predictable?

| Score | Description |
| --- | --- |
| 5 | All interactions are intuitive; gestures are consistent; state transitions are smooth and predictable |
| 4 | Core interactions are clear; a few edge-case interactions need discovery |
| 3 | Main flows work well; some secondary interactions feel hidden or inconsistent |
| 2 | Users must guess or learn non-obvious interaction patterns |
| 1 | Interactions are confusing, inconsistent, or conflict with platform conventions |

#### A4. Content Clarity

> Are copy, labels, information hierarchy, and empty states clear and unambiguous?

| Score | Description |
| --- | --- |
| 5 | Every label, message, and empty state tells the user exactly what happened and what to do next |
| 4 | Clear overall with minor ambiguities in edge-case messages |
| 3 | Core flows have good copy; secondary states have vague or generic messages |
| 2 | Multiple labels are unclear, jargon leaks through, or states are unexplained |
| 1 | User frequently cannot understand what the interface is communicating |

---

### Layer B: PA Product Alignment

Derived from the PA North Star ("随手记下，需要时自然浮现"), design philosophy
("安静且可信"), and Low-Burden Review principles.

#### B1. Quietness (安静度)

> Does the interface avoid unnecessary interruption? Can the user ignore any
> surface without future penalty?

| Score | Description |
| --- | --- |
| 5 | PA is felt only when useful; all surfaces are ignorable; no attention-grabbing animations or sounds outside user-initiated actions |
| 4 | Mostly quiet; occasional proactive surface feels slightly assertive |
| 3 | Some surfaces create mild urgency (counts, badges, unresolved states) |
| 2 | Multiple surfaces compete for attention or imply obligation |
| 1 | PA feels like a notification-heavy tool that demands constant management |

#### B2. Trustworthiness (可信度)

> Does AI output show source evidence? Does disclosure and user control match
> the effect, sensitivity, scope, provenance, reversibility, and authority of
> the change?

| Score | Description |
| --- | --- |
| 5 | Claims are source-backed; low-risk current-vault understanding is inspectable, correctable, and recoverable; conflicts, sensitive inference, scope widening, vault mutation, and external action receive proportionate prior disclosure or authorization |
| 4 | Control generally matches consequence, with minor gaps in evidence wording, recovery visibility, or boundary explanation |
| 3 | Evidence exists but effect/scope is sometimes vague, or controls are either too weak for risk or unnecessarily interruptive for low-risk reversible changes |
| 2 | Claims frequently lack usable provenance; consequential changes have inconsistent control, or routine low-risk changes create repeated confirmation chores |
| 1 | Black-box outputs or broad actions occur without adequate disclosure, correction, recovery, or authority boundaries |

#### B3. Capture Friction (捕获摩擦)

> How many steps and how much cognitive load does capturing a thought require?

| Score | Description |
| --- | --- |
| 5 | One gesture to capture; no mandatory fields; context auto-filled; immediate confirmation |
| 4 | Capture is fast with minimal required input |
| 3 | Capture works but requires navigating a modal or filling optional metadata |
| 2 | Capture flow has unnecessary steps or unclear completion state |
| 1 | Capturing is slow, buried, or discouraging |

#### B4. Return Accuracy (浮现准确性)

> Do old notes surface at the right time with the right relevance?

| Score | Description |
| --- | --- |
| 5 | Surfaced notes feel serendipitous and directly relevant to current context |
| 4 | Most recalls are relevant; occasional noise is easy to dismiss |
| 3 | Recall is useful but sometimes surfaces loosely related or stale content |
| 2 | Recall frequently misses relevant notes or surfaces irrelevant ones |
| 1 | Recall feels random or is absent |

#### B5. Burden (负担感)

> Does the interface create new queues, badges, unresolved states, or
> management work?

| Score | Description |
| --- | --- |
| 5 | No queues grow without user intent; no badges imply obligation; closing any surface is always clean |
| 4 | Minor queue or count indicators exist but clearly optional |
| 3 | Some surfaces show counts or unresolved items that create mild guilt |
| 2 | Review Queue or candidate lists grow automatically and feel like work |
| 1 | PA creates a second task manager the user must maintain |

#### B6. Progressive Disclosure (渐进披露)

> Does each layer contain appropriate information depth? Can the user stop at
> any layer?

| Score | Description |
| --- | --- |
| 5 | Each layer (Pet→Bubble→Panel→Tab) is self-contained; stopping at any layer feels complete |
| 4 | Layer boundaries are clear; minor content that should be deeper leaks to a shallower layer |
| 3 | Some layers feel either too empty (forcing deeper) or too dense (overwhelming at entry) |
| 2 | Layer boundaries are blurred; user must go deeper to get basic information |
| 1 | No meaningful progressive disclosure; all information at one level |

---

## 2. UI Surface Inventory

### 2.1 Surfaces to Evaluate

| # | Surface | Type | Layer | Key Files |
| --- | --- | --- | --- | --- |
| S1 | Pet | Pagelet L1 | Always visible | `pagelet/pet/PetView.ts`, `custom.pcss` |
| S2 | Bubble | Pagelet L2 | On-demand overlay | `pagelet/bubble/BubbleView.ts`, `BubbleContent.ts` |
| S3 | Panel | Pagelet L3 | Side panel | `pagelet/panel/PanelView.ts`, `PanelLayouts.ts` |
| S4 | Tab | Pagelet L4 | Workspace leaf | `pagelet/tab/TabView.ts` |
| S5 | Chat | Independent view | Workspace leaf | `chat/chat-view.ts` |
| S6 | Statistics | Independent view | Workspace leaf | `components/Statistics.tsx` |
| S7 | Settings + Memory control center | Plugin settings | Settings summary/detail/recovery | `settings.ts`, `pa/memory-control-center.ts`, `pa/memory-governance-view.ts` |
| S8 | Quick Capture + Modals | Modal dialogs | Overlay | `quick-capture.ts`, `modal.ts`, `confirm.ts` |

### 2.2 Cross-Surface Checks

Select the cross-surface checks relevant to the affected user journeys:

| Check | What to look for |
| --- | --- |
| Visual language consistency | Color palette, border-radius, shadow, font-size, icon style across all surfaces |
| Interaction pattern consistency | Close/dismiss, expand/collapse, confirm/cancel gestures and controls |
| Mobile experience parity | Touch targets (≥44px), bottom-sheet patterns, keyboard handling, viewport adaptation |
| Terminology consistency | No RAG/VSS/embedding/agent/memory jargon in user-facing copy; consistent use of PA product terms |
| Consequence/control consistency | Equivalent effects receive equivalent disclosure, correction, recovery, and authorization across Settings, Pagelet, Chat, and Recall |

---

## 3. Scoring Process

### 3.1 Per-Surface Evaluation

For each surface in scope, select the relevant dimensions from A1-A4 and B1-B6.
Mark an inapplicable dimension `N/A` and a relevant dimension without sufficient
evidence `UNSCORED`; neither is a low score. Follow the
[UI/UX audit evidence standard](../../../.agents/skills/ui-ux-design-audit/SKILL.md#evidence-standard)
for visible and interaction evidence, reusing valid observations.

| Field | Description |
| --- | --- |
| Score | 1-5 for an applicable dimension with sufficient evidence; otherwise N/A or UNSCORED |
| Evidence | Observed path and state, with relevant visible UI and source/test anchors |
| Findings | Confirmed issues with a concrete trigger, user impact, and violated requirement or invariant |
| Severity | Apply the project severity rules below to the confirmed impact |
| Suggestion | Concrete improvement direction |

Low scores can motivate discussion; they do not automatically create findings
or require fixes. Keep preferences and unresolved product choices distinct from
confirmed defects.

### 3.2 Severity Definitions

Use the existing [PA review severity rules](../../../.agents/skills/personal-assistant-review/SKILL.md#severity-rules).
Assign severity from the concrete user impact and release risk, not the numeric
score or a North Star question alone. Label unresolved product tradeoffs
`needs decision` and optional refinements `optional polish`; this framework
does not set a separate fix deadline or release gate.

### 3.3 Aggregation

For a broad audit, summarize recurring findings across the assessed surfaces.
Use a heatmap only when it helps compare the selected dimensions; preserve
`N/A` and `UNSCORED` rather than treating them as scores. Compare only compatible
evidence and scopes, without implying precision from averages. A narrow review
can report its findings directly without an aggregate score or heatmap.

---

## 4. North Star Quick Check

Use the applicable questions from the
[Product North Star](../../product/pa-product-north-star.md) to examine the
intended user benefit and its constraints. They support product judgment, not
a pass/fail gate for every individual surface:

1. Does this lower the friction of capturing or revisiting real thoughts?
2. Does this make the user's own notes more likely to return at the right time?
3. Does this protect the user's original thinking?
4. Does this connect ideas with evidence instead of producing black-box insight?
5. Does this maintain the vault gently, with preview, recovery, or undo?
6. Does this keep advanced AI capability behind a quiet product surface?
7. Does this earn trust gradually instead of assuming broad permission?
8. Can the user ignore this without future penalty?
9. Is confirmation tied to a durable consequence rather than an AI sentence?
10. Does this reduce more review burden than it creates?

Explain a relevant conflict in terms of the current requirement and observed
consequence. A surface need not directly serve every North Star question;
unresolved product tradeoffs remain decisions rather than automatic defects.

---

## 5. Anti-Pattern Checklist

Check surfaces in scope for relevant anti-patterns from the North Star and
Low-Burden Review doctrine. A resemblance alone does not establish a finding:

| # | Anti-Pattern | How to detect |
| --- | --- | --- |
| AP1 | ChatGPT-in-Obsidian feel | Chat dominates the product surface; AI responses lack source evidence |
| AP2 | Knowledge manager burden | User must classify, tag, or organize AI output |
| AP3 | AI content drowning | AI-generated text visually competes with or outweighs user's original notes |
| AP4 | Smart interruption | Proactive hints feel frequent, urgent, or attention-demanding |
| AP5 | Premature automation | Automation outruns earned trust, provenance, scope, reversibility, or the action-authority boundary |
| AP6 | Clickworker safety | Low-risk reversible understanding creates repetitive confirmation chores instead of quiet, inspectable recovery |
| AP7 | Queue/badge creep | Counts, badges, or "unresolved" states grow without user intent |
| AP8 | Jargon leakage | RAG, VSS, embedding, agent, memory, GraphRAG appear in user-facing copy |
| AP9 | Obligation language | "Needs review", "Pending", "Action required" in non-durable contexts |
| AP10 | Incomplete empty state | Surface shows blank or generic content when no data is available |

---

## 6. Evaluation Template

### Per-Surface Scorecard (use for assessed surfaces)

```
## Surface: [Name]

### North Star Quick Check
- Applicable questions and intended user benefit:
- Evidence, relevant conflicts, or unresolved product choices:

### Dimensional Scores

| Dimension | Score | Evidence | Findings |
| --- | --- | --- | --- |
| [Selected dimension] | /5, N/A, or UNSCORED | | |

### Findings Summary

| # | Finding, trigger, and impact | Severity / needs decision / optional polish | Suggestion |
| --- | --- | --- | --- |
| 1 | | | |

### Anti-Pattern Check
- Relevant anti-patterns with evidence, or none:
```

---

## 7. Review Cadence

Review timing follows the user's request and the current task's requirements.
This framework does not schedule recurring audits or add release checks.

| Trigger | Scope | Depth |
| --- | --- | --- |
| New surface or redesign under review | Affected surfaces and relevant transitions | Applicable dimensions and anti-patterns |
| Minor iteration | Changed surfaces only | Focused on changed dimensions |
| Explicit broad audit | Requested surfaces and user journeys | Evidence-backed comparison where useful |

Existing release gates remain governed by the
[release process](../../operations/release-process.md); this framework neither
adds a pre-release all-surface audit nor removes required release validation.
