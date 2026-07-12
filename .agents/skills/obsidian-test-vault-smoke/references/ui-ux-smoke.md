# UI/UX Interaction Smoke

## Contents

- [Interaction method](#interaction-method)
- [Required checks](#required-checks)
- [Surface paths](#surface-paths)
- [Evidence and severity](#evidence-and-severity)

## Interaction Method

Use the real Obsidian window. Use `computer-use:computer-use` for clicking, typing, scrolling, keyboard shortcuts, modal confirmation, and visual inspection. Use CLI only to prepare state, reload, capture screenshots, and query supporting DOM/runtime details.

Before interacting, deploy, reload, open the exact target, and capture a baseline screenshot using the commands in `references/cli-runtime.md`.

## Required Checks

Entry and discoverability:

- Start from the expected visible ribbon, command palette, sidebar, settings control, or in-panel action.
- Confirm labels use understandable product language without requiring documentation.
- Keep similar entries distinct, such as Pagelet panel open versus current-note review.

Real interaction:

- Exercise primary and secondary actions, not only command IDs.
- Type in real inputs and verify focus, cursor, selection, shortcuts, and submit behavior.
- Cover close/reopen, cancel, escape, stop, retry, remove, and back-out paths when affected.
- Scroll long panels and verify headers, toolbars, buttons, and modals remain reachable.
- Check keyboard navigation and visible focus for the changed workflow when practical.

Visual design:

- Check hierarchy, spacing, alignment, density, and primary-action clarity.
- Check clipping, overlap, truncation, and overflow at realistic sidebar widths.
- Check affected empty, loading, success, error, disabled, and long-content states.
- Check light/dark theme or narrow/mobile state when CSS/layout risk exists.

UX feedback and safety:

- Verify timely, calm, actionable feedback for slow, costly, provider-backed, or background actions.
- Verify destructive, write, provider-call, and cost-bearing actions show required preview or confirmation.
- Verify success does not unexpectedly overwrite drafts or navigation state.
- Follow the Memory/VSS product-language and confirmation rules in `AGENTS.md`.

Accessibility and lifecycle:

- Check visible focus, icon-only control labels, modal focus, and escape paths when affected.
- Close/reopen or reload when persistence is expected.
- Combine visible inspection, screenshots, and DOM checks if accessibility output is incomplete.

## Surface Paths

Chat:

- Open Chat from the visible entry and send only the minimal prompt needed.
- Observe streaming plus affected stop/retry/copy/menu behavior.
- Keep the composer reachable while streaming and after scrolling.
- For Memory, verify blocking/non-blocking behavior and provider/cost disclosure match `AGENTS.md`.

Memory:

- Trigger `Prepare memory` or `Update memory` only when user-facing readiness changed.
- Verify first-use, missing-index, stale-settings, and costly rebuild paths request confirmation.
- Do not claim background maintenance in fallback/non-durable states.

Records Preview and Vault Statistics:

- Open from the visible command path, resize when layout changed, then close/reopen.
- Check for stale renders, duplicate roots, and lost `previewLimits`, `targetPath`, or `statisticsType` settings.

Settings:

- Open Settings -> Personal Assistant in the actual Settings window.
- Exercise only affected controls and verify saved state, validation, disabled states, warnings, and copy.
- Distinguish persisted test-vault `data.json` from current code defaults.
- Treat the Settings window as separate UI evidence when Obsidian opens it independently.

For Pagelet, use `references/pagelet-smoke.md` instead of duplicating its workflow here.

## Evidence and Severity

Report visible actions and observations separately from CLI runtime results:

```markdown
UI/UX smoke:
- PASS: `<visible path>` - `<clicks/typing and observed result>`
- FAIL: `<visible path>` - `<issue and user impact>`
- BLOCKED: `<visible path>` - `<external blocker>`
- Screenshot: `<path>`
- Residual risk: `<untested state>`
```

Classify user impact:

- `UX-P0`: blocks the core workflow or risks unintended writes/provider calls.
- `UX-P1`: hides safety/cost information, confuses the workflow, or makes recovery difficult.
- `UX-P2`: non-blocking polish that weakens clarity or trust.
