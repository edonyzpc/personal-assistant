---
name: personal-assistant-review-followup
description: Triage, confirm, fix, and validate code review findings in the personal-assistant repository after an agent team or human review. Use when the user asks whether review findings are real, whether they must be fixed, which findings are over-optimization, what architecture/product/program decisions are needed, or asks to implement and test the confirmed fixes after a review.
---

# Personal Assistant Review Follow-up

## Core Rule

Use this skill after `personal-assistant-review` or any review that produced
findings for the current `personal-assistant` repository.

The goal is not to fix every review comment. The goal is to separate real
release risk from optional polish, get the needed decision, implement only the
confirmed fix set, and verify the result without over-claiming.

Hard boundary: do not make product decisions while fixing review findings.
If a finding can be fixed by removing, hiding, narrowing, or adding friction to
a user-facing capability, ask the user before coding unless the user already
made that exact product choice in the current turn.

## Workflow

1. Restate the findings in plain engineering terms.
2. Classify each finding:
   - **must-fix**: correctness, data safety, privacy, user-visible breakage,
     product-contract violation, release blocker, or a direct failure of the
     current patch's stated goal.
   - **should-fix-now**: small, local fix that prevents a likely regression or
     stabilizes the changed behavior, even if not release-blocking.
   - **defer**: polish, theoretical failure path, localized copy cleanup
     without product-contract or safety impact, refactor preference, or risk
     without a concrete trigger.
3. Calibrate severity again. Do not preserve the original P-level if the
   conversation shows it was too high or too low.
4. Identify decision points before coding.
5. If the user only asked for analysis, stop after the classification and
   decision options.
6. Ask for a concrete decision when implementation semantics, product behavior,
   or user effort differ. Do not infer these decisions from reviewer severity.
7. Implement the confirmed fix set only after the user explicitly asks to
   implement or fix it.
8. Add a regression test for the accepted trigger path.
9. Validate with focused checks, then app smoke only when the changed surface
   needs deployed Obsidian evidence.

Mandatory decision prompts:
- Removing or hiding a visible control, command, workflow, or shortcut.
- Increasing or decreasing confirmation burden for durable, provider-backed,
  cost-bearing, privacy-sensitive, or future-behavior-changing actions.
- Choosing between safety/trust and the product goal of reducing user burden.
- Changing product copy, information architecture, queue/batch behavior, or
  review cadence in a way that changes what users can do.
- Reinterpreting a current product doc, roadmap, tracker, or user-stated
  product principle.

When a mandatory decision appears, stop and present the smallest viable options
with a recommendation and tradeoff. Do not continue into code edits for that
decision until the user chooses.

## Decision Lens

Use three lenses when the user asks whether findings need decisions.

Architecture:
- Define ownership and invariants, not just symptoms.
- Prefer boundaries already used by the touched modules.
- If a fix only masks one UI symptom but leaves concurrent semantics undefined,
  ask for or propose the invariant.

Program:
- Decide whether the implementation should reject, serialize, dedupe, or reuse
  in-flight work.
- Prefer a minimal helper or state flag when the invariant is local.
- Avoid broad refactors unless the finding proves an existing abstraction is
  misleading or dangerous.

Product:
- Decide what the user should see and what should not happen twice.
- Protect provider-backed, cost-bearing, destructive, or persistent actions
  from accidental duplicate execution.
- Preserve the user's product intent and local product docs even when a reviewer
  suggests a safer but higher-burden alternative.
- For Memory, Review Queue, Pagelet, and other review surfaces, explicitly
  weigh the burden of extra confirmations against trust and source evidence.
- Keep ordinary copy in the product language for the touched surface. Internal
  terms are acceptable in diagnostics, logs, and developer-only output.

## Fix Discipline

- Do not fix deferred findings unless the user explicitly adds them to the
  confirmed fix set.
- Do not make opportunistic changes outside the confirmed fix set.
- Preserve user edits and existing uncommitted changes.
- Use `apply_patch` for manual edits.
- Per AGENTS.md Testing Instructions, do not claim Obsidian validation without
  deployed evidence.

## Validation

Start with the smallest checks that prove the accepted finding is fixed.
Run the **Local Validation Gate** from AGENTS.md, scoped to the affected
suites. For plugin command, worker, DOM/CSS, or shared runtime changes, also
include `npm run lint`.

For Obsidian runtime smoke, use `obsidian-test-vault-smoke` and prefer a
provider-free probe unless the accepted fix specifically requires live provider
work. If a smoke probe temporarily monkey-patches the loaded test-vault plugin
instance, patch only the smallest method needed, restore it in `try/finally`,
and check fresh `dev:errors` before reporting success.

## Output

```markdown
**Fixed**
- <finding>: <what was done>

**Deferred**
- <finding>: <reason>

**Decisions**
- <architecture/product invariant chosen>

**Validation**
- PASS: `<check>` - <result>
- checks not run / residual risk

**Residual risk**
- <provider paths, real Obsidian UI paths not run, etc.>
```
