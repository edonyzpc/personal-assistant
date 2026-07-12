---
name: ui-ux-design-audit
description: Audit multi-surface UI/UX in the personal-assistant Obsidian plugin with the current PA framework, real interface evidence, structured scoring, adversarial finding verification, and product-decision routing. Use for design retrospectives, visual quality baselines, cross-surface consistency audits, accessibility/mobile evaluations, or requests such as "帮我看看设计" and "audit the UI". Default to audit-only; implement findings only when explicitly requested, and require separate authorization for commit or archive actions. For review of a current code diff or PR, use `personal-assistant-review` instead.
---

# UI/UX Design Audit

## Core Boundaries

Default to `audit-only`:

- Inspect, observe, score, verify, and report findings.
- Do not edit runtime/product code unless the user explicitly asks to fix the
  verified findings.
- Create or update a durable audit artifact only when the user asks for one;
  otherwise report in chat.
- Do not commit or archive artifacts without separate explicit authorization.

Use this skill for cross-surface design quality. Route a current diff/PR review
to `personal-assistant-review`, even when the diff is UI-heavy.

Read:

1. `AGENTS.md`
2. `docs/product/pa-product-north-star.md`
3. `docs/product/pa-low-burden-review-product-principles.md`
4. `docs/development/workflows/pa-ui-ux-review-framework.md`
5. The source files and tests for the audited surfaces

Reuse the current PA framework before inventing a new instrument. Treat its
four Layer A dimensions—Design Coherence, Visual Polish, Interaction Quality,
and Content Clarity—as a **PA adaptation**, not a verbatim external framework.
Research external frameworks only when the current instrument needs revision;
use authoritative sources and preserve citations for adapted claims.

## Evidence Standard

Separate evidence into three lanes:

| Lane | Can prove | Cannot prove alone |
| --- | --- | --- |
| Source and tests | State, lifecycle, copy, accessibility markup, CSS intent, product contract | Rendered visual quality or interaction feel |
| Runtime/DOM | Mounting, state transitions, computed structure, fresh console behavior | Visual polish or real user interaction by itself |
| Visible UI | Layout, hierarchy, contrast, clipping, focus, keyboard/touch flow, perceived burden | Hidden code paths not exercised |

Require `obsidian-test-vault-smoke` at `full-ui` tier before assigning visual or
interaction scores. Capture the visible path, interaction, observed state, and
screenshot evidence. If the app cannot be observed, mark those dimensions
`UNSCORED` or `BLOCKED`; do not infer a score from source code.

Use `obsidian-ios-real-device-smoke` for claims about real iOS touch behavior.
Do not generalize desktop evidence to mobile.

## Workflow

### 1. Bound the Audit

1. Confirm the requested surfaces, platforms, themes, and key user journeys.
2. Inventory views, panels, modals, overlays, commands, settings, and navigation
   transitions in scope.
3. Select only the framework dimensions relevant to the request.
4. Define the evidence needed for every score before auditing.

### 2. Observe and Score

1. Deploy and observe the real test-vault UI through
   `obsidian-test-vault-smoke` when visual or interaction scoring is requested.
2. Trace each visible issue to source, CSS, state, or product-contract evidence.
3. Score with the current PA framework. Use short evidence-backed rationales;
   do not manufacture numerical precision.
4. Check the North Star explicitly:
   - capture friction
   - right-time return
   - quietness and ignorable states
   - source-backed trust
   - reversible maintenance and earned action
   - net review burden

For layered surfaces, use Mermaid for topology or flow diagrams. Use a Markdown
table for the score heatmap.

### 3. Fan Out Broad Audits

If multi-agent tools are available and the audit is broad or the user asks for
an agent team, partition surfaces across independent agents. Give every agent
the same framework and different surfaces. If subagents are unavailable, run
the same partitions locally.

Require this schema from each lane:

```markdown
## Surface: <name>

### Evidence
- visible path and screenshot
- source/test anchors

### Scores
| Dimension | Score or UNSCORED | Evidence |
| --- | --- | --- |

### Findings
| Finding | Severity | Trigger | Suggested direction |
| --- | --- | --- | --- |
```

Add one cross-surface pass for terminology, design tokens, navigation,
progressive disclosure, accessibility, and desktop/mobile consistency.

### 4. Verify Findings

Verify every P0/P1/P2 finding against the actual source and the relevant visible
flow before presenting it as confirmed.

Classify each finding:

- `CONFIRMED`: the trigger and impact match the evidence
- `PARTIALLY CONFIRMED`: the issue exists but scope or severity changes
- `FALSE POSITIVE`: current source or observed behavior contradicts it
- `BLOCKED`: required runtime/device evidence is unavailable

Recalibrate severity after verification. Do not force findings per surface or
dimension.

### 5. Route Decisions and Fixes

End an audit-only request after verified findings, decisions, and validation
gaps.

If the user explicitly asks to fix findings:

1. Use `personal-assistant-review-followup` to classify and confirm the fix set.
2. Ask before changing product semantics, visible capability, confirmation
   burden, information architecture, or review cadence.
3. Route structural changes to `sdd-lifecycle`; do not reproduce the refactor
   workflow here.
4. Implement only the approved fix set.
5. Use `personal-assistant-review` on the resulting diff.
6. Re-run the relevant `full-ui` flow and record before/after evidence.

Implementation authorization does not authorize commit, push, archive, or
release actions.

## Artifacts

- Reuse `docs/development/workflows/pa-ui-ux-review-framework.md`; do not create
  a duplicate framework.
- Follow `docs/development/documentation-workflow.md` when the user requests a
  durable audit report.
- Keep an active audit package under `docs/development/active/<audit>/` only
  while work is active.
- Add unresolved follow-up to `docs/backlog.md` only when requested and avoid
  copying the full audit into the backlog.
- Archive a completed report only when the user explicitly asks.

## Output

Lead with verified findings ordered by severity. Include:

- surface and user-visible trigger
- score or `UNSCORED`, with evidence
- source/test and visible-UI anchors
- confirmation status and suggested direction
- validation completed, blocked, and not run
- decisions required before any fix

If there are no actionable findings, say `✅ OK` and list only material evidence
gaps.

## Related Skills

- `personal-assistant-review`: current diff/PR review
- `personal-assistant-review-followup`: finding triage and approved fixes
- `sdd-lifecycle`: structural design and implementation lifecycle
- `obsidian-test-vault-smoke`: local full-UI evidence
- `obsidian-ios-real-device-smoke`: iOS real-device evidence
