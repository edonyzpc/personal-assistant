---
name: obsidian-test-vault-smoke
description: Validate the personal-assistant Obsidian plugin in the repo-local test vault using both fast CLI runtime smoke and full app UI/UX interaction smoke. Use when end-to-end verification is needed after UI/runtime changes, Pagelet work, Chat, Memory/VSS, Preview/Stats, settings, release-gate smoke, or visible layout/copy/interaction changes. For real-device iOS validation, use `obsidian-ios-real-device-smoke`. For community compliance scan, use `obsidian-community-check`.
---

# Obsidian Test Vault Smoke

## Core Rules

- Do not claim Obsidian validation without deploying the current build to `test/` and observing the affected behavior in the running app.
- Treat Jest, lint, type-check, build, and source scans as implementation validation, not app smoke.
- Require visible-window interaction for UI/UX PASS; CLI, DOM, and screenshots support the finding but do not replace real interaction.
- Use `obsidian vault=test <command>` for every Obsidian CLI call. `vault=test` must precede the command.
- Choose the lightest tier that covers the changed surface.

## Scope Freeze And Evidence Reuse

Before an expensive gate or app interaction:

1. Classify the latest runtime delta as `code-only`, `runtime`, `visual/layout`,
   `interaction/state`, or `release/broad`.
2. Freeze the observable target. For screenshot-led UI work, state direction,
   order, spacing, viewport, and interaction expectations in testable terms.
   Ask one product question before deployment if the target is ambiguous.
3. Map changed surfaces to the minimum evidence. Mark unaffected surfaces
   `SKIP`; do not run full Pagelet, provider, or cross-surface flows for a
   geometry-only change.
4. Reuse fresh same-turn evidence only while runtime source, generated assets,
   target vault, and deployed build remain unchanged. Docs/evidence-only edits
   do not invalidate runtime smoke; TypeScript, CSS, build, or fixture changes
   do.
5. Freeze runtime files before `make deploy`. If they change afterward, rerun
   only the affected validation gate and app proof.

Stop when every frozen acceptance check has current deployed evidence. Do not
add adjacent gestures, orientations, provider calls, or unrelated surfaces
solely to strengthen an already sufficient proof.

## Validation Gate

Run the complete **Local Validation Gate** from repo-root `AGENTS.md` once per
distinct code, DOM, or CSS state before app smoke. Run all commands currently
listed there, including the runtime `<style>` / `innerHTML` / `outerHTML`
source scan. Reuse a fresh same-turn PASS for an identical runtime state; do
not rerun it after docs/evidence-only edits.

Treat the source-scan `rg` exit code `1` with no output as PASS. Inspect every match manually. `make deploy` and the hosted community scan do not replace this local source scan.

## Smoke Tiers

| Tier | Use when | Required checks |
| --- | --- | --- |
| `quick` | Narrow code-only or test-only change | Complete Local Validation Gate with focused suites; stop before app smoke only when no runtime/user path changed |
| `app-runtime` | Runtime, command, packaging, Pagelet shell, Chat/Preview/Stats mount, Memory readiness | Local Validation Gate, `make deploy`, plugin reload, affected CLI/DOM probes, fresh console/error capture |
| `full-ui` | Visible UI, CSS/layout/copy, Pagelet workflow, settings, keyboard/focus, mobile emulation | `app-runtime` plus real Obsidian interaction, screenshots, UX notes, and provider/write-path checks when applicable |
| `release-gate` | Release, broad refactor, shared infrastructure | Local Validation Gate, `make deploy`, broad runtime matrix, required UI surfaces, and release evidence reconciliation |

`make deploy` already runs lint, a production build, full Jest, and asset
deployment. If those checks already passed for the current changes, use
`make deploy-current` to verify and copy the current build without repeating
them. Reuse conditions and test groups live in `AGENTS.md` Local Deployment;
build identity alone does not prove tests passed.

## Workflow

1. Inspect `git status --short`, relevant diffs, and affected surfaces.
2. Freeze the observable target and classify the runtime delta.
3. Run or reuse the complete Local Validation Gate from `AGENTS.md`.
4. Select the smoke tier.
5. For app smoke, deploy and reload:

```bash
make deploy
obsidian vault=test vault info=path
obsidian vault=test plugin:reload id=personal-assistant
obsidian vault=test plugin id=personal-assistant
```

6. For visible changes, perform the cheapest visual target check immediately
   after reload. Stop on a direction, order, clipping, or viewport mismatch
   before deeper interactions.
7. Read only the references required by the changed surface:
   - For any `app-runtime`, `full-ui`, or `release-gate` run, read [CLI runtime smoke](references/cli-runtime.md).
   - For visible UI/UX work, read [UI/UX interaction smoke](references/ui-ux-smoke.md).
   - For Pagelet work, read both CLI runtime smoke and [Pagelet smoke](references/pagelet-smoke.md).
8. For historical fixtures, regression expectations, and prior evidence, consult the current [Pagelet smoke checklist](../../../docs/development/validation/pagelet-smoke-checklist.md). Treat its verification log as provenance, not current-run evidence.
9. Record concrete `PASS`, `FAIL`, `BLOCKED`, or `SKIP` outcomes.
10. Always restore debug/mobile state, including after failure or interruption:

```bash
obsidian vault=test dev:debug off
obsidian vault=test dev:mobile off
```

## Safety Boundaries

- Limit provider-backed checks to repo-local test-vault fixtures unless the user approves broader data. Report provider/model, note paths, and prompts sent.
- If a provider, browser, CLI, or GUI tool blocks the action, do not bypass the block; report `BLOCKED` and residual risk.
- Stop before deleting or rewriting test-vault data that may be user-authored.
- Stop before publishing, pushing, creating releases, or mutating non-test external systems unless the user authorized that action.
- Keep hosted Obsidian Community scans distinct from the local source scan. A hosted scan submits a ref to an external service and is never an automatic part of this skill.
- During `release-gate`, invoke `obsidian-community-check` only when the user explicitly requested the hosted scan or the active `stable-release` workflow explicitly authorized it. Otherwise report it as not run.

## Output

```markdown
Validation:
- Runtime delta: `<code-only/runtime/visual-layout/interaction-state/release-broad>`
- Frozen target: `<observable acceptance checks>`
- Reused evidence: `<same-state evidence or none>`
- PASS: `<check>` - `<observed result>`
- FAIL: `<path>` - `<regression or product gap>`
- BLOCKED: `<path>` - `<external blocker and residual risk>`
- SKIP: `<path>` - `<why it was outside this tier>`
- Stop point: `<why the selected tier is complete>`

CLI runtime smoke:
- Vault: `test/`
- Tier: `<quick/app-runtime/full-ui/release-gate>`
- Deployment/reload: `<result>`
- Obsidian: `<version>`
- Target: `<note/view/command>`
- Provider/model/prompt: `<if used>`
- Artifact: `<DOM output, console excerpt, runtime file>`

UI/UX smoke:
- Visible path: `<entry and interaction>`
- Observed UX: `<layout, copy, feedback, accessibility>`
- Screenshot: `<path if captured>`
- UX findings: `<UX-P0/UX-P1/UX-P2 or none>`

Cleanup:
- Debug off: PASS/FAIL
- Mobile emulation off: PASS/FAIL

Hosted community scan:
- Authorized and run / not authorized and not run / BLOCKED
```

## Related Skills

- Use `personal-assistant-review` for code-level review.
- Use `obsidian-ios-real-device-smoke` after local app smoke for real-device iOS validation.
- Use `obsidian-community-check` only for an authorized hosted community scan.
