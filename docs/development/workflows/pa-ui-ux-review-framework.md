# PA UI/UX Review Framework

Updated: 2026-07-03

## Status

| Field | Value |
| --- | --- |
| Document type | Design review framework / reusable audit checklist |
| Scope | All PA user-facing surfaces |
| Role | Defines evaluation dimensions, scoring criteria, and review process for UI/UX design audits |
| Related north star | [PA Product North Star](../../product/pa-product-north-star.md) |
| Related doctrine | [Low-Burden Review Product Principles](../../product/pa-low-burden-review-product-principles.md) |
| Methodology source | [Anthropic Harness Design: Evaluator Architecture](https://www.anthropic.com/engineering/harness-design-long-running-apps) |

## Purpose

This framework provides a repeatable evaluation structure for PA UI/UX design
reviews. It combines Anthropic's Evaluator scoring dimensions (from their
planner-generator-evaluator multi-agent architecture) with PA-specific product
principles. Use it after each major design iteration to assess quality and
identify improvement opportunities.

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

> Does AI output show source evidence? Are durable actions gated by preview,
> confirmation, and undo?

| Score | Description |
| --- | --- |
| 5 | Every AI claim links to source notes; durable actions have preview + confirm + undo; user always knows what will change |
| 4 | Most claims are source-backed; durable actions are gated; minor gaps in undo paths |
| 3 | Evidence is present but sometimes vague; some actions lack clear preview |
| 2 | AI output frequently lacks source links; confirmation gates are inconsistent |
| 1 | Black-box outputs with no evidence; actions happen without adequate warning |

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
| S1 | Pet | Pagelet L1 | Always visible | `pagelet/pet/PetView.ts`, `PetAnimations.css` |
| S2 | Bubble | Pagelet L2 | On-demand overlay | `pagelet/bubble/BubbleView.ts`, `BubbleContent.ts` |
| S3 | Panel | Pagelet L3 | Side panel | `pagelet/panel/PanelView.ts`, `PanelLayouts.ts` |
| S4 | Tab | Pagelet L4 | Workspace leaf | `pagelet/tab/TabView.ts` |
| S5 | Chat | Independent view | Workspace leaf | `chat/chat-view.ts` |
| S6 | Statistics | Independent view | Workspace leaf | `components/Statistics.tsx` |
| S7 | Settings | Plugin settings | Settings tab | `settings.ts` |
| S8 | Quick Capture + Modals | Modal dialogs | Overlay | `quick-capture.ts`, `modal.ts`, `confirm.ts` |

### 2.2 Cross-Surface Checks

In addition to per-surface scoring, evaluate these four cross-cutting
dimensions:

| Check | What to look for |
| --- | --- |
| Visual language consistency | Color palette, border-radius, shadow, font-size, icon style across all surfaces |
| Interaction pattern consistency | Close/dismiss, expand/collapse, confirm/cancel gestures and controls |
| Mobile experience parity | Touch targets (≥44px), bottom-sheet patterns, keyboard handling, viewport adaptation |
| Terminology consistency | No RAG/VSS/embedding/agent/memory jargon in user-facing copy; consistent use of PA product terms |

---

## 3. Scoring Process

### 3.1 Per-Surface Evaluation

For each surface (S1-S8), evaluate all 10 dimensions (A1-A4, B1-B6) and
record:

| Field | Description |
| --- | --- |
| Score | 1-5 rating per the rubric above |
| Evidence | Specific code path, CSS rule, or UI element that supports the score |
| Findings | Issues identified (if score < 4) |
| Severity | P0 (principle violation) / P1 (experience impact) / P2 (polish gap) / P3 (refinement) |
| Suggestion | Concrete improvement direction |

### 3.2 Severity Definitions

| Level | Criteria | Response |
| --- | --- | --- |
| P0 Critical | Violates North Star core principle or causes user confusion/data risk | Must fix before next release |
| P1 Important | Degrades experience on a core flow but does not block functionality | Fix in current version |
| P2 Improvement | Visual inconsistency, suboptimal pattern, or polish gap | Fix in next 1-2 versions |
| P3 Refinement | Micro-interaction, animation, or copy polish opportunity | Backlog; address when touching the surface |

### 3.3 Aggregation

After scoring all surfaces, aggregate into:

1. **Heatmap**: 8 surfaces × 10 dimensions matrix showing relative strengths
   and weaknesses
2. **Dimension summary**: Average score per dimension across all surfaces,
   identifying systemic issues
3. **Surface summary**: Average score per surface across all dimensions,
   identifying surfaces needing most attention

---

## 4. North Star Quick Check

Before diving into dimensional scoring, run these 10 questions from the
[Product North Star](../../product/pa-product-north-star.md) as a rapid pass/fail gate:

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

Any surface failing questions 1, 2, 6, 7, or 8 is a candidate for P0 severity.

---

## 5. Anti-Pattern Checklist

Check all surfaces against these known anti-patterns from the North Star and
Low-Burden Review doctrine:

| # | Anti-Pattern | How to detect |
| --- | --- | --- |
| AP1 | ChatGPT-in-Obsidian feel | Chat dominates the product surface; AI responses lack source evidence |
| AP2 | Knowledge manager burden | User must classify, tag, or organize AI output |
| AP3 | AI content drowning | AI-generated text visually competes with or outweighs user's original notes |
| AP4 | Smart interruption | Proactive hints feel frequent, urgent, or attention-demanding |
| AP5 | Premature automation | Actions happen without adequate trust scaffolding |
| AP6 | Clickworker safety | Human-in-the-loop controls create repetitive confirmation chores |
| AP7 | Queue/badge creep | Counts, badges, or "unresolved" states grow without user intent |
| AP8 | Jargon leakage | RAG, VSS, embedding, agent, memory, GraphRAG appear in user-facing copy |
| AP9 | Obligation language | "Needs review", "Pending", "Action required" in non-durable contexts |
| AP10 | Incomplete empty state | Surface shows blank or generic content when no data is available |

---

## 6. Evaluation Template

### Per-Surface Scorecard (copy for each surface)

```
## Surface: [Name]

### North Star Quick Check
- [ ] Q1 Capture friction  - [ ] Q6 Quiet AI surface
- [ ] Q2 Right-time return  - [ ] Q7 Gradual trust
- [ ] Q3 Protect thinking   - [ ] Q8 Ignorable
- [ ] Q4 Evidence-backed    - [ ] Q9 Durable confirmation
- [ ] Q5 Gentle maintenance - [ ] Q10 Net burden reduction

### Dimensional Scores

| Dimension | Score | Evidence | Findings |
| --- | --- | --- | --- |
| A1 Design Coherence | /5 | | |
| A2 Visual Polish | /5 | | |
| A3 Interaction Quality | /5 | | |
| A4 Content Clarity | /5 | | |
| B1 Quietness | /5 | | |
| B2 Trustworthiness | /5 | | |
| B3 Capture Friction | /5 | | |
| B4 Return Accuracy | /5 | | |
| B5 Burden | /5 | | |
| B6 Progressive Disclosure | /5 | | |

### Findings Summary

| # | Finding | Severity | Suggestion |
| --- | --- | --- | --- |
| 1 | | P? | |

### Anti-Pattern Check
- [ ] AP1-AP10 (list any violations)
```

---

## 7. Review Cadence

| Trigger | Scope | Depth |
| --- | --- | --- |
| Major feature release (new surface or redesign) | Affected surfaces + cross-surface | Full 10-dimension + anti-pattern |
| Minor iteration | Changed surfaces only | Focused on changed dimensions |
| Pre-release gate | All surfaces | North Star Quick Check + anti-pattern scan only |
| Quarterly review | All surfaces | Full audit with heatmap comparison to previous quarter |
