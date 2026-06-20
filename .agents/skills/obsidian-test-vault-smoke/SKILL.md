---
name: obsidian-test-vault-smoke
description: Validate the personal-assistant Obsidian plugin in the repo-local test vault using both fast CLI runtime smoke and full app UI/UX interaction smoke. Use when Codex needs end-to-end verification after UI/runtime changes, Pagelet work, Chat, Memory/VSS, Preview/Stats, settings, release-prep, visible layout/copy/interaction changes, or when asked to manage, reload, open, inspect, click through, visually review, or query the Obsidian test vault with commands such as obsidian plugin:reload, command, dev:dom, eval, dev:console, dev:screenshot, or Computer Use.
---

# Obsidian Test Vault Smoke

## Core Rule

Do not claim real Obsidian app validation unless the plugin was deployed into the repo-local `test/` vault and behavior was observed in Obsidian through CLI evidence, DOM/runtime artifacts, screenshots, console output, or direct UI inspection.

Automated Jest/lint/build checks are implementation validation. They are not app smoke validation.

Do not claim UI/UX validation from CLI or DOM checks alone. UI/UX smoke requires the visible app window and real user-like interaction, usually with Computer Use, screenshots, or direct visual inspection.

## Smoke Tiers

Pick the lightest tier that covers the changed surface. Do not blindly run both full Jest and `make deploy` when `make deploy` will already run test, lint, and build; use focused checks first for fast failure localization, then close with the appropriate app tier.

| Tier | Use when | Required checks |
| --- | --- | --- |
| `quick` | Narrow code-only or test-only change | `git status --short`, relevant `git diff`, nearest Jest suites, `npx tsc -noEmit -skipLibCheck` when type-sensitive, `git diff --check` |
| `app-runtime` | Runtime, command, packaging, Pagelet shell, Chat/Preview/Stats mount, Memory readiness | `make deploy`, plugin reload, CLI/DOM runner checks, fresh console/error capture |
| `full-ui` | Visible UI, CSS/layout/copy, Pagelet workflow, settings, release/beta confidence | `app-runtime` plus real Obsidian window interaction, screenshots, UX notes, and provider/write-path checks when applicable |
| `release-gate` | Release, broad refactor, shared infrastructure | Focused checks if useful, then `make deploy`, full app runtime, required UI/UX surfaces, docs/tracker reconciliation if smoke evidence changes |

If `make deploy` passes, it has already run full Jest, lint, build, and asset deployment. Run standalone `npm test -- --runInBand` before `make deploy` only when you need serialized failure detail or a broad pre-deploy signal.

## Fast Path

Run from the `personal-assistant` repo root.

1. Inspect scope:
   - `git status --short`
   - Review relevant diffs and identify affected surfaces: Chat, Memory/VSS, Pagelet, Preview, Stats, settings, packaging, or release.

2. Run focused tests first:
   - Use nearest Jest tests for narrow changes.
   - For shared runtime or type-sensitive changes, include `npx tsc -noEmit -skipLibCheck`.
   - For broad or release-facing work, prefer `make deploy` as the final local gate because it runs tests, lint, build, and deploys assets.

3. Deploy and reload the real plugin:

```bash
make deploy
obsidian vault info=path vault=test
obsidian plugin:reload id=personal-assistant vault=test
obsidian plugin id=personal-assistant vault=test
```

Prefer `obsidian plugin:reload id=personal-assistant vault=test` after `make deploy`; do not restart or manually disable/enable the plugin unless reload fails or stale app state is suspected.

4. Run CLI runtime smoke for fast functional confidence:

```bash
obsidian open path=pagelet-smoke-golden.md vault=test
obsidian command id=personal-assistant:pa-pagelet:open-panel vault=test
obsidian dev:dom selector=.pa-pagelet-panel total vault=test
obsidian dev:dom selector=.pa-pagelet-panel text vault=test
```

5. Decide whether UI/UX smoke is required:
   - Required for visible UI, CSS, layout, copy, navigation, keyboard, focus, modal, mobile, or interaction changes.
   - Required for broad release/beta confidence even when CLI smoke passes.
   - Optional only for purely internal changes with no visible user path.

6. Record evidence with concrete `PASS`, `FAIL`, `BLOCKED`, or `SKIP` outcomes.

## Obsidian CLI Rules

First check `command -v obsidian`. If the CLI says it cannot find Obsidian, open the test vault once:

```bash
/Applications/Obsidian.app/Contents/MacOS/Obsidian "obsidian://open?vault=test&file=pagelet-smoke-golden.md"
```

If the CLI still cannot find Obsidian from Codex sandbox but the app is running, rerun the `obsidian ...` command with approval outside the sandbox. This CLI talks to the running app over local IPC, which can be blocked by sandboxing.

Always add `vault=test` when multiple vaults exist or when the active vault is not certain:

```bash
obsidian vaults verbose
obsidian vault info=path vault=test
obsidian version vault=test
```

Useful confirmed commands for this repo:

```bash
obsidian plugins:enabled filter=community versions format=tsv vault=test
obsidian plugin id=personal-assistant vault=test
obsidian commands filter=personal-assistant vault=test
obsidian command id=personal-assistant:open-chat vault=test
obsidian command id=personal-assistant:pa-pagelet:open-panel vault=test
obsidian command id=personal-assistant:pa-pagelet:review-current vault=test
obsidian tabs ids vault=test
obsidian workspace ids vault=test
```

Use file commands for setup and post-run evidence:

```bash
obsidian open path=pagelet-smoke-golden.md vault=test
obsidian files folder=.pagelet ext=md vault=test
obsidian read path=.pagelet/<review-file>.md vault=test
obsidian search query="pagelet: true" path=.pagelet limit=5 vault=test
```

Use `obsidian reload vault=test` for a vault reload and `obsidian restart` only when plugin reload and vault reload cannot clear stale state.

## Developer Inspection

Use CLI developer commands for setup, instrumentation, and debugging. Use Computer Use or direct visible-app inspection for the actual UI/UX interaction path when user experience is in scope.

DOM assertions:

```bash
obsidian dev:dom selector=.pa-pagelet-panel total vault=test
obsidian dev:dom selector=.pa-pagelet-panel text vault=test
obsidian dev:dom selector=.pa-pagelet-panel attr=aria-label vault=test
obsidian dev:dom selector=.pa-pagelet-panel css=display vault=test
```

Runtime eval:

```bash
obsidian eval code="app.vault.getName()" vault=test
obsidian eval code="Object.keys(app.plugins.plugins).filter(id => id.includes('personal'))" vault=test
obsidian eval code="app.plugins.plugins['personal-assistant']?.settings?.aiProvider" vault=test
```

`eval` does not support top-level `await`. Wrap async work in an async IIFE:

```bash
obsidian eval code="(async()=>await app.vault.adapter.read('pagelet-smoke-runner.js').catch(()=> 'missing'))()" vault=test
```

Console capture must be sequential. Use a fresh debug window so old buffered errors are not mistaken for this smoke run. Do not run `dev:console` and `dev:debug off` in parallel:

```bash
obsidian dev:debug off vault=test
obsidian dev:debug on vault=test
# run the action under test
obsidian dev:console limit=120 vault=test
obsidian dev:errors vault=test
obsidian dev:debug off vault=test
```

Treat `dev:errors` entries whose timestamps predate the fresh `dev:debug on` as historical noise unless they recur during the current action. Record low-risk Obsidian/app noise separately from plugin errors.

Screenshots and mobile emulation:

```bash
obsidian dev:screenshot path=/private/tmp/personal-assistant-smoke.png vault=test
obsidian dev:mobile on vault=test
obsidian dev:mobile off vault=test
```

Use CLI developer commands for instrumentation and setup. Do not use them as a substitute for UI/UX smoke when the user-facing experience is part of the change.

### UI Evidence Mismatch

When Computer Use, screenshot, accessibility tree, and DOM disagree, do not guess. Cross-check visibility and hit testing:

```bash
obsidian eval code="(()=>{const el=document.querySelector('.pa-pagelet-panel'); if(!el) return null; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return {x:r.x,y:r.y,width:r.width,height:r.height,display:s.display,visibility:s.visibility,opacity:s.opacity,zIndex:s.zIndex,text:el.textContent?.slice(0,160)}})()" vault=test
obsidian eval code="(()=>[[900,80],[1050,120],[1240,120]].map(([x,y])=>{const el=document.elementFromPoint(x,y); return {x,y,tag:el?.tagName,cls:el?.className,text:el?.textContent?.slice(0,80)}}))()" vault=test
```

Use this as supporting evidence only. A visible UI/UX PASS still needs real-window observation or screenshot evidence after the UI settles.

## UI/UX Interaction Smoke

Run UI/UX smoke when the change touches visible UI, copy, layout, CSS, commands, settings, modals, keyboard/focus behavior, mobile layout, or any workflow a real user clicks through. CLI runtime smoke proves the plugin can execute; UI/UX smoke proves the product experience is usable, understandable, and visually sound.

Use the real Obsidian window. Prefer Computer Use for clicking, typing, scrolling, dragging, keyboard shortcuts, modal confirmation, and visual inspection. Use CLI only to prepare state, open the target file/view, reload the plugin, capture screenshots, and query DOM details that support the visual finding.

Before interacting:

```bash
make deploy
obsidian plugin:reload id=personal-assistant vault=test
obsidian open path=<target-note>.md vault=test
obsidian dev:screenshot path=/private/tmp/before-smoke.png vault=test
```

Then use Computer Use or direct visible-app inspection to complete the user path.

### Required UI/UX Checks

Entry and discoverability:

- Verify the user can start the feature from the expected visible entry: ribbon icon, command palette, sidebar view, settings control, or in-panel button.
- Confirm labels match product language and are understandable without reading docs.
- Confirm similar entry points remain distinct, such as Pagelet panel open vs current-note review.

Real interaction:

- Click primary and secondary actions, not only command IDs.
- Type into real textareas/inputs and verify focus, cursor, selection, shortcuts, and submit behavior.
- Exercise close/reopen, cancel, escape, stop, retry, remove, and back-out paths when present.
- Scroll panels and long content; verify headers, toolbars, buttons, and modals remain reachable.
- Verify keyboard navigation and visible focus rings for the changed workflow when practical.

Visual design:

- Check hierarchy, spacing, alignment, density, and whether the most important action is visually obvious.
- Check that text does not overlap, clip, truncate awkwardly, or overflow at realistic sidebar widths.
- Check empty, loading, success, error, disabled, and long-content states when affected.
- Check light/dark theme or narrow/mobile emulation when CSS/layout risk is present.
- Treat screenshots as evidence, but still state what was visually observed.

UX feedback:

- Verify the user receives timely feedback for slow, costly, provider-backed, or background actions.
- Verify progress, status, notices, and error copy are calm, specific, and actionable.
- Verify destructive, write, provider-call, or cost-bearing actions have clear confirmation or preview when required.
- Verify successful actions land the user somewhere sensible and do not unexpectedly overwrite drafts or navigation state.

Product language:

- Ordinary user-facing copy should use product terms such as `Memory`, `Memory from your notes`, `Prepare memory`, `Update memory`, and Pagelet feature labels.
- Internal terms such as VSS, RAG, embeddings, SQLite, OPFS, chunks, backend, fallback, and vector are acceptable in diagnostics but not ordinary user prompts.
- Confirmation prompts must make data, AI provider, and cost implications clear.

Accessibility and robustness:

- Check visible focus, aria labels for icon-only controls, modal focus behavior, and keyboard escape paths when the area changed.
- Verify UI state survives close/reopen or reload when persistence is expected.
- If GUI automation cannot expose the live accessibility tree, combine visible inspection, screenshots, and DOM/locale checks instead of over-trusting one source.

### Surface UI/UX Paths

Pagelet:

- Click the Pagelet ribbon icon and command palette entry `Pagelet: Review current note`; verify immediate current-note review behavior.
- Run command palette `Pagelet: Open Pagelet`; verify the panel opens without provider call until the panel button is used.
- Click scope controls `Current`, `Yesterday`, `Last 3 days`, and `Last 7 days`; verify included/skipped rows are understandable and not noisy.
- Click `Review selected`, `Stop`, preview modal `Confirm`/`Cancel`, `Add to draft`, draft textarea edit, `Remove`, `Dismiss`, `Source`, `Related notes`, and `Research` when those affordances are present.
- Verify `.pagelet/` generated review notes are summarized rather than overwhelming scope rows.
- Verify the panel status, mascot/status treatment, draft area, suggestion cards, and modal hierarchy help the workflow rather than distracting from it.

Chat:

- Open Personal Assistant Chat from the visible command or sidebar path.
- Click/type in the composer, send a minimal prompt, observe streaming, stop/retry/copy/menu behavior when affected.
- Verify the composer remains reachable while results stream and after scrolling history.
- For Memory prompts, verify the blocking/non-blocking state feels intentional and the user understands what will happen before AI provider calls.
- For mobile or keyboard changes, verify real-device or mobile-emulation behavior and do not treat static CSS inspection as sufficient.

Memory/VSS:

- Trigger `Prepare memory` or `Update memory` prompts through the real chat path when the change affects user-facing Memory readiness.
- Click confirm/cancel and verify copy explains notes are not modified, note text may be sent to the configured AI provider, and credits/API calls may be used.
- Verify progress, success, error, retry/backoff, and dirty-state feedback are not intrusive or misleading.

Records Preview / Vault Statistics Preview:

- Open the view from the visible command path and inspect real layout.
- Resize or use narrow panes when layout changed.
- Close/reopen the view and verify no stale render, duplicate root, or lost user settings.

Settings:

- Open Settings -> Personal Assistant through the Obsidian UI when settings controls changed.
- Click toggles, dropdowns, text inputs, secret/key controls, and any reset/update actions touched by the change.
- Verify saved state, validation, disabled states, warnings, and copy in the actual settings pane.

### UI/UX Evidence

Report UI/UX smoke separately from CLI runtime smoke:

```markdown
UI/UX smoke:
- PASS: `<visible path>` - `<what was clicked/typed and what the user saw>`
- FAIL: `<visible path>` - `<user-facing issue and why it matters>`
- BLOCKED: `<path>` - `<external blocker>`

Screenshots:
- `/private/tmp/before-smoke.png`
- `/private/tmp/after-smoke.png`

UX notes:
- Discoverability:
- Visual hierarchy:
- Feedback/error states:
- Keyboard/focus:
- Residual risk:
```

Classify UX findings by user impact:

- `UX-P0`: blocks the core workflow or can cause unintended writes/provider calls.
- `UX-P1`: likely to confuse users, hide important safety/cost information, or make recovery hard.
- `UX-P2`: polish issue that does not block the task but weakens trust or clarity.

## Pagelet Runner

For Pagelet regressions, prefer the durable shell runner after deployment and plugin reload:

```bash
make deploy
cp scripts/pagelet-smoke-runner.js test/pagelet-smoke-runner.js
obsidian plugin:reload id=personal-assistant vault=test
obsidian open path=pagelet-smoke-golden.md vault=test
obsidian eval code="(async()=>eval(await app.vault.adapter.read('pagelet-smoke-runner.js')))()" vault=test
```

If CLI eval fails, use Obsidian DevTools Console:

```js
eval(await app.vault.adapter.read("pagelet-smoke-runner.js"))
```

After the runner completes:

```bash
node - <<'NODE'
const result = require("./test/pagelet-smoke-runtime-result.json");
const totals = result.checks.reduce((memo, check) => {
  memo[check.status] = (memo[check.status] || 0) + 1;
  return memo;
}, {});
console.log({ env: result.env, totals, bugs: result.bugs });
NODE
```

Interpretation:

- `PASS`: expected product behavior was observed in the live app.
- `FAIL`: likely regression or product gap; inspect `detail` before severity.
- `BLOCKED`: external dependency prevented a full assertion, usually provider quota or rate limits.
- `SKIP`: optional UI affordance or fixture was not present in that run.

If the runner sends prompts to the configured AI provider, treat that as allowed for smoke unless the user says otherwise, and report which smoke path ran plus the provider/model from the result artifact.

## Pagelet Full Flow Smoke

Use this when Pagelet UI, state, save flow, write actions, related notes, provider integration, or docs for the user workflow changed. Keep the target markdown note active before review.

Recommended sequence:

```bash
make deploy
cp scripts/pagelet-smoke-runner.js test/pagelet-smoke-runner.js
obsidian plugin:reload id=personal-assistant vault=test
obsidian open path=pagelet-smoke-golden.md vault=test
obsidian eval code="app.workspace.getActiveFile()?.path" vault=test
obsidian dev:debug off vault=test
obsidian dev:debug on vault=test
obsidian eval code="(async()=>eval(await app.vault.adapter.read('pagelet-smoke-runner.js')))()" vault=test
```

Then use the real Obsidian window for the UX path where practical:

- Open Pagelet from the visible pet/ribbon or command path.
- Toggle `Current`, `Yesterday`, `Last 3 days`, and `Last 7 days`; verify selected rows, skipped rows, and text-unit estimates.
- Run `Review selected` only on test-vault fixture notes; report provider/model and note paths.
- Verify loading/progress, result cards, related notes, source buttons, `Research`, `Add to draft`, `Dismiss`, `Remove`, draft textarea editing, and `Expand to tab`.
- For save flow, verify preview/confirmation appears before writing, then confirm and read the generated `.pagelet/` note.
- Verify Write Action Framework evidence in console when saving: `gate.target-confinement.ok`, `gate.preview.shown`, `gate.confirmation.received`, `gate.stale-reread.ok`, and `execute.ok`.

Useful post-save evidence:

```bash
obsidian files folder=.pagelet ext=md vault=test
obsidian read path=.pagelet/<new-review-note>.md vault=test
obsidian dev:console limit=200 vault=test
obsidian dev:errors vault=test
obsidian dev:debug off vault=test
```

Provider-backed review is allowed only for repo-local test-vault fixture content unless the user approves broader data. If CLI/Computer Use action is blocked because note text may be sent to an AI provider, do not work around the block; ask for explicit approval or mark that path `BLOCKED`.

## Cross-Surface Mount Matrix

Run this lightweight matrix after broad plugin, command registration, packaging, or shared UI changes. It is not a substitute for surface-specific UI/UX smoke.

```bash
obsidian command id=personal-assistant:open-chat vault=test
obsidian dev:dom selector=.llm-view total vault=test
obsidian dev:dom selector=.llm-chat-container total vault=test
obsidian dev:dom selector=.llm-input total vault=test

obsidian command id=personal-assistant:preview-records vault=test
obsidian dev:dom selector=#persoanl-assistant-record-list total vault=test
obsidian dev:dom selector=.pa-recordlist-preview-view total vault=test

obsidian command id=personal-assistant:show-statistics vault=test
obsidian dev:dom selector=.pa-statistics-view total vault=test
obsidian dev:dom selector=.pa-statistics-view text vault=test

obsidian eval code="(()=>{const s=app.plugins.plugins['personal-assistant']?.settings; return {aiProvider:s?.aiProvider ?? null, chatModelName:s?.chatModelName ?? null, pageletEnabled:s?.pagelet?.enabled ?? null, pageletPreloadEnabled:s?.pagelet?.preloadEnabled ?? null};})()" vault=test
```

Do not send a Chat prompt, trigger Memory rebuild, or change settings in this matrix unless the changed code requires it.

## Surface Checklist

Chat:

- Open with `obsidian command id=personal-assistant:open-chat vault=test`.
- Send only the minimal prompt needed for the changed path.
- For Memory-sensitive changes, verify whether `Prepare memory` or `Update memory` appears only when expected.
- Confirm chat is not blocked by background changed-note refresh when durable Memory is ready and auto policy allows background maintenance.
- For UI/UX smoke, also click/type in the visible composer and inspect spacing, scroll behavior, button discoverability, streaming feedback, and recovery actions.

Memory/VSS:

- Verify first-use, missing local index, settings-stale, and costly rebuild paths ask for explicit user confirmation.
- Confirm prompts explain that notes are not modified, note text may go to the configured AI provider, and credits/API calls may be used.
- In fallback or non-durable states, do not claim background updates are running unless maintenance can actually run.
- For UI/UX smoke, verify the confirmation, progress, success, and error states in the real app window, not only through logs.

Pagelet:

- Keep `personal-assistant:pa-pagelet:open-panel` distinct from `personal-assistant:pa-pagelet:review-current`.
- Verify scope controls: `Current`, `Yesterday`, `Last 3 days`, `Last 7 days`.
- Verify draft, save, source jump, related notes, and Chat research handoff when affected.
- Treat provider quota/rate limits as `BLOCKED`, not success.
- For UI/UX smoke, click through the visible ribbon/command/panel/modal/card path and evaluate clarity, visual hierarchy, feedback, and recoverability.

Records Preview / Vault Statistics Preview:

- Open the command for the changed view and inspect DOM or UI state.
- Verify lifecycle-sensitive changes do not render after close/reopen.
- Preserve settings such as `previewLimits`, `targetPath`, and `statisticsType`.
- For UI/UX smoke, inspect real pane sizing, table/chart readability, empty/loading/error states, and whether controls remain reachable.

Settings:

- Use real Obsidian settings UI when behavior depends on setting controls, persistence, or keychain/secret rows.
- Distinguish persisted `test/.obsidian/plugins/personal-assistant/data.json` from current code defaults.
- For UI/UX smoke, click controls in the actual settings pane and verify copy, validation, disabled states, and saved state.

## Evidence Format

Use a concise verification log:

```markdown
Validation:
- PASS: `<test command>` - `<observed result>`
- BLOCKED: `<path>` - `<external blocker and residual risk>`
- FAIL: `<path>` - `<regression or product gap>`

CLI runtime smoke:
- Vault: `test/`
- Deployment: `make deploy`
- Reload: `obsidian plugin:reload id=personal-assistant vault=test`
- Obsidian: `<obsidian version vault=test>`
- Target: `<note/view/command>`
- Provider/model: `<if used>`
- Prompt sent: `<if any>`
- Artifact: `<runtime file, DOM output, console excerpt>`

UI/UX smoke:
- Visible path: `<ribbon/menu/command/panel/modal path>`
- Interaction: `<clicks, typing, keyboard shortcuts, scroll, close/reopen>`
- Observed UX: `<visual clarity, feedback, layout, copy, accessibility>`
- Screenshot: `<path if captured>`
- UX findings: `<UX-P0/UX-P1/UX-P2 or none>`
```

## Stop Conditions

Stop and ask before continuing when:

- The smoke path would publish, push, create releases, or mutate non-test external systems.
- The test requires deleting or rewriting test vault data that may be user-authored.
- Provider configuration is missing and the requested validation specifically depends on a live provider response.
- A release path is ambiguous, especially around version/tag baseline.
