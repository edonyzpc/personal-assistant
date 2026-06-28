---
name: personal-assistant-review-followup
description: Triage, confirm, fix, and validate code review findings in the personal-assistant repository after an agent team or human review. Use when the user asks whether review findings are real, whether they must be fixed, which findings are over-optimization, what architecture/product/program decisions are needed, or asks Codex to implement and test the confirmed fixes after a review.
---

# Personal Assistant Review Follow-up

Use this skill after `personal-assistant-review` or any review that produced
findings for the current `personal-assistant` repository.

The goal is not to fix every review comment. The goal is to separate real
release risk from optional polish, get the needed decision, implement only the
confirmed fix set, and verify the result without over-claiming.

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
6. Ask or infer a concrete decision only when implementation semantics differ.
7. Implement the confirmed fix set only after the user explicitly asks to
   implement or fix it.
8. Add a regression test for the accepted trigger path.
9. Validate with focused checks, then app smoke only when the changed surface
   needs deployed Obsidian evidence.

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
- Keep ordinary copy in the product language for the touched surface. Internal
  terms are acceptable in diagnostics, logs, and developer-only output.

## Fix Discipline

- Do not fix deferred findings unless the user asks or the fix is essentially
  free and touches the same lines safely.
- If fixing a non-must issue opportunistically, say so and keep it tiny.
- Preserve user edits and existing uncommitted changes.
- Use `apply_patch` for manual edits.
- Do not claim Obsidian behavior was validated unless the plugin was deployed
  and observed in the app or through repo-approved Obsidian CLI evidence.

## Validation

Start with the smallest checks that prove the accepted finding is fixed:

```bash
npm test -- --runInBand <focused tests>
npx tsc -noEmit -skipLibCheck
git diff --check
```

For plugin command, worker, DOM/CSS, or shared runtime changes, usually include:

```bash
npm test -- --runInBand <affected suites>
npm run lint
rg -n "createElement\\([\"']style[\"']\\)|\\.innerHTML\\s*=|\\.outerHTML\\s*=" src
```

For the `rg` community-scan command, exit code 1 with no output means no
matches were found and should be treated as a pass.

Use `make deploy` when app-runtime confidence is needed. It runs full Jest,
lint, build, and deploys assets to `test/`.

For Obsidian runtime smoke, use `obsidian-test-vault-smoke` and prefer a
provider-free probe unless the accepted fix specifically requires live provider
work. If a smoke probe temporarily monkey-patches the loaded test-vault plugin
instance, patch only the smallest method needed, restore it in `try/finally`,
and check fresh `dev:errors` before reporting success.

## Final Report

Report outcomes in this order:

1. Which findings were fixed.
2. Which findings were intentionally deferred and why.
3. Decisions made, especially architecture/product invariants.
4. Validation run and any smoke evidence.
5. Residual risk, including provider paths or real Obsidian UI paths not run.
