# Pagelet Smoke

## Contents

- [Scope](#scope)
- [Regression runner](#regression-runner)
- [Full-flow interaction](#full-flow-interaction)
- [Write-path evidence](#write-path-evidence)
- [Provider and data boundaries](#provider-and-data-boundaries)
- [Interpretation](#interpretation)

## Scope

Use this reference when Pagelet UI, state, provider integration, save flow, write actions, related notes, or user-workflow documentation changed. Also read `references/cli-runtime.md` for deployment, fresh debug capture, and cleanup.

Use `docs/development/validation/pagelet-smoke-checklist.md` as the durable regression baseline and historical evidence log. Do not treat old entries as current-run validation.

Keep the target Markdown fixture active before review:

```bash
obsidian vault=test open path=pagelet-smoke-golden.md
obsidian vault=test eval code="app.workspace.getActiveFile()?.path"
```

## Regression Runner

Deploy and copy the durable runner into the test vault:

```bash
make deploy
cp scripts/pagelet-smoke-runner.js test/pagelet-smoke-runner.js
obsidian vault=test plugin:reload id=personal-assistant
obsidian vault=test open path=pagelet-smoke-golden.md
```

Start the fresh debug capture sequence from `references/cli-runtime.md`, then run:

```bash
obsidian vault=test eval code="(async()=>eval(await app.vault.adapter.read('pagelet-smoke-runner.js')))()"
```

If CLI eval fails and the visible Obsidian DevTools Console is already authorized, use:

```js
eval(await app.vault.adapter.read("pagelet-smoke-runner.js"))
```

Read the result without modifying it:

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

## Full-Flow Interaction

Use the real Obsidian window where practical:

- Open Pagelet from the visible pet/ribbon or command path.
- Verify `open-panel` remains distinct from `review-current`.
- Toggle `Current`, `Yesterday`, `Last 3 days`, and `Last 7 days`; inspect selected and skipped rows.
- Run `Review selected` only against test-vault fixture notes.
- Verify loading/progress, result cards, related notes, source actions, `Research`, `Add to draft`, `Dismiss`, and `Remove` when present.
- Edit the draft textarea and verify `Expand to tab`.
- Exercise `Stop`, retry, cancel, close/reopen, keyboard/focus, narrow layout, and affected error states.
- Treat provider quota/rate limits as `BLOCKED`, not PASS.

## Write-Path Evidence

For save flow:

1. Verify preview appears before writing.
2. Exercise both cancel and confirm when the change affects those paths.
3. Confirm only against test fixtures.
4. Read the generated `.pagelet/` note.
5. Verify Write Action Framework events appear in order:
   - `gate.target-confinement.ok`
   - `gate.preview.shown`
   - `gate.confirmation.received`
   - `gate.stale-reread.ok`
   - `execute.ok`

Capture post-save evidence before final cleanup:

```bash
obsidian vault=test files folder=.pagelet ext=md
obsidian vault=test read path=.pagelet/<new-review-note>.md
obsidian vault=test dev:console limit=200
obsidian vault=test dev:errors
obsidian vault=test dev:debug off
obsidian vault=test dev:mobile off
```

## Provider and Data Boundaries

- Treat provider-backed runner prompts as authorized only for repo-local test-vault fixtures unless the user says otherwise.
- Report provider/model, fixture note paths, and prompt path used.
- If the tool blocks note transmission, do not bypass it; request explicit approval or mark `BLOCKED`.
- Stop before deleting or rewriting test-vault data that may be user-authored.
- Verify save confirmation before any write and inspect the written note afterward.

## Interpretation

- `PASS`: expected product behavior was observed in the live app.
- `FAIL`: a regression or product gap was observed; inspect detail before assigning severity.
- `BLOCKED`: an external dependency prevented the assertion.
- `SKIP`: an optional affordance or fixture was not present and was outside the required path.

Report CLI/runtime and visible UI results separately. Include final debug/mobile cleanup status.
