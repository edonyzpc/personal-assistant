# CLI Runtime Smoke

## Contents

- [Setup and targeting](#setup-and-targeting)
- [Fast runtime path](#fast-runtime-path)
- [Developer inspection](#developer-inspection)
- [Fresh debug capture](#fresh-debug-capture)
- [UI evidence mismatch](#ui-evidence-mismatch)
- [Cross-surface mount matrix](#cross-surface-mount-matrix)
- [Runtime evidence](#runtime-evidence)

## Setup and Targeting

Run from the `personal-assistant` repo root. Check `command -v obsidian` first.

Target the test vault by placing `vault=test` before the command:

```bash
obsidian vault=test vault info=path
obsidian vault=test version
```

If the CLI cannot find Obsidian, open the test vault once with the direct app URI:

```bash
/Applications/Obsidian.app/Contents/MacOS/Obsidian "obsidian://open?vault=test&file=pagelet-smoke-golden.md"
```

If the app is running but sandboxed CLI calls still fail, request approval to rerun the same CLI command outside the sandbox. Do not substitute the active vault.

Prefer plugin reload after deployment. Use a vault reload only when plugin reload cannot clear stale state; avoid app restart unless both fail.

Before any smoke reload or mode change, record the actual `dev:debug` and
mobile-emulation states using a supported status query or verified app state.
Check the installed CLI's help before treating a mode command as a read-only
query. PA's `settings.debug` is not proof of the CLI debug state. If a state
cannot be determined reliably, leave that mode unchanged and record the
dependent check as blocked; do not infer an initial `off` state. Record the
corresponding explicit `on` or `off` restoration commands with the baseline.

## Fast Runtime Path

```bash
make deploy
obsidian vault=test plugin:reload id=personal-assistant
obsidian vault=test plugin id=personal-assistant
obsidian vault=test open path=pagelet-smoke-golden.md
obsidian vault=test command id=personal-assistant:pa-pagelet:open-panel
obsidian vault=test dev:dom selector=.pa-pagelet-panel total
obsidian vault=test dev:dom selector=.pa-pagelet-panel text
```

Useful inventory and file evidence:

```bash
obsidian vault=test plugins:enabled filter=community versions format=tsv
obsidian vault=test commands filter=personal-assistant
obsidian vault=test tabs ids
obsidian vault=test workspace ids
obsidian vault=test files folder=.pagelet ext=md
obsidian vault=test read path=.pagelet/<review-file>.md
obsidian vault=test search query="pagelet: true" path=.pagelet limit=5
```

## Developer Inspection

Use CLI developer commands for instrumentation and debugging, not as a substitute for visible UI/UX interaction.

DOM assertions:

```bash
obsidian vault=test dev:dom selector=.pa-pagelet-panel total
obsidian vault=test dev:dom selector=.pa-pagelet-panel text
obsidian vault=test dev:dom selector=.pa-pagelet-panel attr=aria-label
obsidian vault=test dev:dom selector=.pa-pagelet-panel css=display
```

Runtime evaluation:

```bash
obsidian vault=test eval code="app.vault.getName()"
obsidian vault=test eval code="Object.keys(app.plugins.plugins).filter(id => id.includes('personal'))"
obsidian vault=test eval code="app.plugins.plugins['personal-assistant']?.settings?.aiProvider"
```

`eval` does not support top-level `await`. Wrap async work in an async IIFE:

```bash
obsidian vault=test eval code="(async()=>await app.vault.adapter.read('pagelet-smoke-runner.js').catch(()=> 'missing'))()"
```

Screenshots and mobile emulation:

```bash
obsidian vault=test dev:screenshot path=/private/tmp/personal-assistant-smoke.png
obsidian vault=test dev:mobile on
# observe the affected path
```

Restore mobile emulation to its recorded initial state, including after failure
or interruption. A mode change can reload the app; capture evidence before
restoring mobile, then restore debug after the reload and verify both states.

## Fresh Debug Capture

Clear both buffers before the action. Toggling `dev:debug` alone does not clear them.

```bash
obsidian vault=test dev:errors clear
obsidian vault=test dev:console clear
obsidian vault=test dev:debug on
# run the action under test
obsidian vault=test dev:console limit=120
obsidian vault=test dev:errors
```

Run this sequence serially, then execute the recorded restoration commands.
In a `FAIL`, `BLOCKED`, timeout, or interrupted path, still restore known
initial states as best effort and record the observed result. Unknown initial
states or failed restoration are not cleanup PASS. Record low-risk
Obsidian/app noise separately from plugin errors.

## UI Evidence Mismatch

When visible inspection, screenshots, accessibility state, and DOM disagree, measure the actual element before judging it:

```bash
obsidian vault=test eval code="(()=>{const el=document.querySelector('.pa-pagelet-panel'); if(!el) return null; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return {x:r.x,y:r.y,width:r.width,height:r.height,display:s.display,visibility:s.visibility,opacity:s.opacity,zIndex:s.zIndex,text:el.textContent?.slice(0,160)}})()"
```

For hit testing, derive coordinates from that rect rather than reusing fixed pixels:

```bash
obsidian vault=test eval code="(()=>{const el=document.querySelector('.pa-pagelet-panel');if(!el)return null;const r=el.getBoundingClientRect();const pts=[[r.left+r.width*.25,r.top+40],[r.left+r.width*.5,r.top+80],[r.right-20,r.top+80]];return pts.map(([x,y])=>{const hit=document.elementFromPoint(x,y);return{x,y,tag:hit?.tagName,cls:hit?.className,text:hit?.textContent?.slice(0,80)}})})()"
```

Use these probes as supporting evidence. A visible UI PASS still needs settled-window observation.

## Cross-Surface Mount Matrix

Run this after broad plugin, command-registration, packaging, or shared UI changes. Do not send Chat prompts, rebuild Memory, or change settings unless the changed code requires it.

```bash
obsidian vault=test command id=personal-assistant:open-chat
obsidian vault=test dev:dom selector=.llm-view total
obsidian vault=test dev:dom selector=.llm-chat-container total
obsidian vault=test dev:dom selector=.llm-input total

obsidian vault=test command id=personal-assistant:preview-records
obsidian vault=test dev:dom selector=#persoanl-assistant-record-list total
obsidian vault=test dev:dom selector=.pa-recordlist-preview-view total

obsidian vault=test command id=personal-assistant:show-statistics
obsidian vault=test dev:dom selector=.pa-statistics-view total
obsidian vault=test dev:dom selector=.pa-statistics-view text

obsidian vault=test eval code="(()=>{const s=app.plugins.plugins['personal-assistant']?.settings; return {aiProvider:s?.aiProvider ?? null, chatModelName:s?.chatModelName ?? null, pageletEnabled:s?.pagelet?.enabled ?? null, pageletPreloadEnabled:s?.pagelet?.preloadEnabled ?? null};})()"
```

The misspelled `#persoanl-assistant-record-list` selector intentionally matches the current source ID.

## Runtime Evidence

Record:

- `make deploy` result and plugin status.
- Obsidian version and target note/view/command.
- Fresh console/error output.
- DOM/runtime artifacts relevant to the changed surface.
- Provider/model/prompt only when provider-backed smoke ran.
- Initial and restored debug/mobile states, including restoration failures.
