---
name: ui-ux-design-audit
description: End-to-end UI/UX design audit workflow — research-grounded framework construction, multi-agent structured audit, adversarial verification, decision routing, and loop engineering. Use when the user asks for UI/UX design review, design audit, visual quality assessment, design retrospective (复盘/设计评审/界面审查/UI 检查), multi-surface design evaluation, design quality check, interface review, or wants to systematically improve UI quality. Also triggers on "帮我看看设计", "检查一下界面", "设计质量怎么样", "audit the UI". Covers the full lifecycle from "what should we measure" to "verified fix deployed."
---

# UI/UX Design Audit

End-to-end workflow for UI/UX design audit and implementation. Orchestrates
5 reusable engineering patterns that apply to any product with user-facing
surfaces (GUI, CLI, API portal).

## When to Use

- Design retrospective / 复盘 after a major feature or redesign
- Periodic UI quality assessment (quarterly or pre-release)
- User reports "something feels off" across multiple surfaces
- New product philosophy that needs to be validated against existing UI
- First design quality baseline for a new product

## Core Engineering Patterns

### Pattern 1: Research-Grounded Framework Construction

Build the evaluation instrument BEFORE auditing. Never audit without a
framework — ad-hoc findings are inconsistent and unmergeable.

**Method:**
1. Search for 2-3 authoritative UI evaluation frameworks:
   - Query examples: "Anthropic harness design evaluator", "Nielsen 10
     usability heuristics", "Apple HIG evaluation checklist"
   - For each source, extract the top-level evaluation dimensions
   - Deduplicate across sources; prefer dimensions with scoring rubrics
   - If no external art is found, fall back to the Recommended Layer A below
2. Read the product's vision / North Star / design philosophy — derive
   product-specific dimensions
3. Compose into a dual-layer framework:
   - **Layer A (Universal)**: dimensions that apply to any product
   - **Layer B (Product-specific)**: dimensions derived from THIS product's
     philosophy
4. Add scoring rubrics (1-5 with concrete descriptions per level)
5. Add anti-pattern checklist (derived from "what this product should avoid")
6. Output as a standalone reusable document

**If the product has no documented North Star:** substitute with (1) the
README's one-line description, (2) the product's tagline, or (3) ask the user
for a 1-sentence description of what the product should feel like. Note in the
framework that the vision was inferred.

**Why dual-layer:** Universal dimensions catch design fundamentals (alignment,
consistency). Product dimensions catch philosophical violations (too noisy, too
much burden, wrong disclosure level). Neither layer alone is sufficient.

**Recommended Layer A** (from Anthropic Harness Design Evaluator):
- A1. Design Coherence — does it feel like a unified whole?
- A2. Visual Polish — spacing, alignment, colors, typography
- A3. Interaction Quality — natural, discoverable, predictable
- A4. Content Clarity — copy, labels, empty states

These descriptions assume a graphical interface. For CLI, adapt "Visual Polish"
to "Output Formatting Consistency"; for API portals, adapt "Interaction Quality"
to "API Discoverability and Predictability."

**Layer B construction prompt:**
> Given this product's vision: "{vision_statement}" and design philosophy:
> "{philosophy}", generate 4-6 product-specific evaluation dimensions. Each
> dimension should be a question testable by reading source code or observing
> the interface. Include 5-point scoring rubrics. Cap at 6 dimensions.

**Layer B examples by product type:**
- Developer CLI: Command discoverability, Error recoverability, Script-friendliness, Progressive complexity
- E-commerce SaaS: Purchase friction, Trust signals, Information scent, Cart abandonment risk
- Note-taking app: Capture friction, Return accuracy, Quietness, Burden avoidance

**Quality gate:** review generated Layer B dimensions. Reject any dimension
that requires pure subjective taste judgment without observable evidence.

**Output:** save as `docs/<product>-ui-ux-review-framework.md`. Must contain
Layer A + B dimensions with rubrics, anti-pattern checklist, and the vision
statement it was derived from.

### Pattern 2: Fan-Out Structured Audit

Partition UI surfaces across parallel agents. Each agent receives the SAME
framework and a DIFFERENT surface partition.

**Critical rule: fixed output schema.** Without it, merging outputs from
parallel agents is unreliable. Each agent must output:

```
## Surface: [Name]
### Dimensional Scores: [table: dimension | score /5 | evidence | findings]
### Anti-Pattern Check: [violations found]
### Findings: [table: # | finding | severity P0-P3 | suggestion]
```

**Partitioning strategy:**
- Inventory all distinct UI surfaces (views, panels, modals, overlays,
  screens, commands)
- Group by interaction model similarity (e.g., read-only views together,
  input-heavy views together, overlay/popup views together)
- Each agent gets 2-3 surfaces (small enough to read all source files)
- Add a cross-surface consistency check to the last agent
- Agent count: 1 per 2-3 surfaces. For 6 surfaces, use 2-3 audit agents.

**After audit, synthesize:**
- Build N-surfaces × M-dimensions heatmap matrix (Markdown table in the
  audit report)
- Identify weakest surfaces (lowest row average) and weakest dimensions
  (lowest column average)
- Generate topology/flow visualization if the product has layered surfaces
  (use diagram tools like fireworks-tech-graph or drawio)

**Heatmap format:**

```
| Surface | A1 | A2 | A3 | A4 | B1 | B2 | ... | Avg |
|---------|----|----|----|----|----|----|-----|-----|
| View A  | 4  | 3  | 4  | 5  | 4  | 3  | ... | 3.8 |
| View B  | 3  | 2  | 3  | 2  | 3  | 4  | ... | 2.8 |
```

### Pattern 3: Adversarial Verification Loop

**THE most important pattern.** LLM auditors systematically over-report
findings. Expect ~30% false positive rate on initial audit.

**Method:**
1. Take every P0/P1/P2 finding from the audit
2. Launch verification agents (1 agent per 5-8 findings) with this prompt
   structure:

   > Verify these audit findings against actual source code. For each
   > finding, read the referenced file and check whether the described
   > behavior actually occurs. Report each as:
   > CONFIRMED — the issue exists as described
   > PARTIALLY CONFIRMED — issue exists but severity is overstated (provide
   > corrected severity)
   > FALSE POSITIVE — the issue does not exist (explain why)
   >
   > Common false positive patterns to watch for:
   > - CSS class has no direct rule but IS styled via a paired/parent class
   > - Behavior flagged as violation but the design document explicitly permits it
   > - Dangerous code path has a fallback/default branch not read by the auditor
   > - Platform-standard term flagged as "jargon leakage"
   >
   > Output a table: Finding # | Status | Evidence (file:line) | Corrected Severity

3. After verification, recalibrate severity and update the findings list
4. Phase exits when every P0-P2 finding has a verification status

**Why this matters:** Without verification, ~30% of fix effort goes to
non-existent problems. Worse, false positives erode trust in the audit.

### Pattern 4: Decision Routing

After verification, categorize findings before implementing:

```
Verified findings
  ├── Can fix directly (clear spec violation, obvious fix)
  │     → Execute in priority order
  ├── Needs user decision (product direction, tradeoff)
  │     → Ask focused questions with concrete options
  └── Structural (large refactoring needed)
        → Enter SDD track (project's refactor workflow)
```

**Question design for user decisions:**
- Present 2-3 concrete options with tradeoffs, not open-ended questions
- Use preview mockups (ASCII or visual) when options are spatial/visual
- Batch related decisions into one question set (max 4 questions)

### Pattern 5: Loop Engineering

Every implementation phase follows a verification loop:

```
implement → test (project build/test command) → review (agent team) → fix → verify
```

**Key loop properties:**
- Review ALWAYS follows implementation — never ship unreviewed fixes
- Reviews catch implementation-introduced bugs (not just audit bugs):
  data path disconnected, locale parameters mismatched, shared resources
  renamed incompletely
- Fixes from reviews get their own build verification
- The loop terminates when review returns no P0/P1/P2 findings

**For structural refactoring, add SDD (Software Design Document) loop
before implementation:**

```
plan → SDD → SDD review (agent team) → fix SDD → implement → ...
```

SDD review catches:
- Method names that don't match actual code
- Dependencies the plan doesn't account for
- Interface designs that can't support the required lifecycle
- Shared resources (locale keys, CSS classes) used by other features

If the project has an existing refactor workflow (e.g., `docs/refactor-workflow.md`),
delegate the SDD track to it rather than reinventing the process.

## Workflow Phases

### Phase 1: Framework

```
Trigger: User asks for UI/UX audit or design retrospective
Input:   Product vision/North Star + known design constraints (or infer from README)
Method:  Pattern 1 (research → compose dual-layer framework)
Output:  docs/<product>-ui-ux-review-framework.md
Gate:    Framework has Layer A + B dimensions, rubrics, anti-patterns
```

### Phase 2: Audit

```
Input:   Framework + surface inventory
Method:  Pattern 2 (fan-out N agents, fixed output schema)
Output:  Per-surface scorecards + aggregated heatmap report
Gate:    All surfaces scored with evidence
```

### Phase 3: Verify

```
Input:   P0/P1/P2 findings from audit
Method:  Pattern 3 (adversarial verification, 1 agent per 5-8 findings)
Output:  Verified findings with false-positive corrections
Gate:    Every P0-P2 finding has verification status
```

### Phase 4: Decide

```
Input:   Verified findings
Method:  Pattern 4 (triage → route)
Output:  Approved fix list + user decisions on open questions
Gate:    All "needs decision" items resolved
Branch:  Structural findings → Phase 5
         Small findings → Phase 4b
```

### Phase 4b: Quick Fixes

```
Input:   "Fix directly" list
Method:  Pattern 5 loop (implement → test → review → fix)
Output:  Clean build with all quick fixes applied
Gate:    Review returns no P0/P1/P2
```

### Phase 5: Structural Refactor

```
Input:   Structural finding + user design decision
Method:  Project's refactor/SDD workflow (Pattern 5 SDD loop)
Output:  Approved SDD → phased implementation → verified
Gate:    SDD review clean; all phases implemented; build passes;
         smoke test passes (if UI-visible changes)
```

## Anti-Patterns to Avoid

1. **Audit without framework**: ad-hoc findings are inconsistent across agents
   and unmergeable. Always build the instrument first.

2. **Trust audit at face value**: ~30% of LLM audit findings are false
   positives. Always verify before committing to fixes.

3. **Fix before deciding**: implementing fixes that need product decisions
   wastes effort when the user chooses a different direction.

4. **Mix refactoring with deletion**: extract (pure refactor) in one phase,
   delete (behavior change) in the next. Tests can verify behavioral
   equivalence only if the two are separated.

5. **SDD with wrong method names**: grep to confirm every method/type name
   in the SDD matches actual code. Implementers will search for the name
   you wrote.

6. **Skip SDD review**: SDD reviews are cheap (read-only). SDD bugs become
   implementation bugs that cost 10x more to fix.

7. **Dependency undercount**: dependency surfaces are always ≥ 2x what you
   expect. For feature removal, do an exhaustive multi-layer grep before
   writing the removal plan.

## Artifact Management

- **Framework document**: commit to `docs/`. Reuse across audits; update
  Layer B only when the product vision changes.
- **Audit report**: commit to `docs/`. Name with date for repeat audits
  (e.g., `<product>-ui-ux-audit-report-2026-Q3.md`).
- **Plan/SDD/Tracker**: follow the project's existing refactor workflow
  artifact conventions.
- **After all findings resolved**: archive the audit report (move to
  `docs/archive/` or add `[ARCHIVED]` header). Keep the framework active.

## Integration with Other Skills

This skill covers the upstream audit/verify/decide lifecycle. It delegates
downstream work to the project's existing skills:

- **Code review skill** (e.g., `personal-assistant-review`): used in Phase 4b
  and Phase 5 for reviewing implemented changes. This audit skill generates
  the findings; the review skill validates the fixes.
- **Review followup skill** (e.g., `personal-assistant-review-followup`):
  used to triage and implement fixes from review loops. If a Phase 4b fix
  triggers code review findings, those are handled by the followup skill,
  not by re-entering this skill's Phase 3.
- **Smoke test skill** (e.g., `obsidian-test-vault-smoke`): used in Phase 5
  for UI-visible structural changes.
- **Diagram/visualization skill** (e.g., `fireworks-tech-graph`): used in
  Phase 2 for generating topology diagrams and heatmap visualizations.

## Example: First Execution (PA-specific)

The first execution of this workflow on the PA Obsidian plugin produced:
- `docs/pa-ui-ux-review-framework.md` — dual-layer evaluation framework
- `docs/pa-ui-ux-audit-report.md` — 8×10 heatmap audit report
- `docs/pagelet-tab-restructure-plan.md` — structural finding plan
- `docs/pagelet-tab-restructure-sdd.md` — implementation SDD
- `docs/pagelet-tab-restructure-tracker.md` — development tracker

Key metrics: 8 surfaces audited, 33 initial findings, ~30% false positive rate
after verification, 7 quick fixes + 1 structural refactor (Tab restructure:
1637→889 lines, 4 phases, Weekly Review removed).
