---
name: obsidian-ios-real-device-smoke
description: Validate personal-assistant Obsidian plugin changes on a USB-connected iPhone using the iCloud Obsidian test vault, iPhone Mirroring when available, and Safari Web Inspector for real WKWebView DOM/CSS/console evidence. Use when asked to test, verify, debug, inspect, or visually confirm mobile/iOS behavior, touch interactions, Pagelet/Chat/Memory mobile UI, Safari Inspector probes, iCloud deployment, or real-device smoke after local Obsidian test-vault validation.
---

# Obsidian iOS Real-Device Smoke

## Core Rules

- Do not claim iOS real-device validation for a plugin-asset change unless the current build was written to the iCloud Obsidian `test` vault, all copied assets matched `dist`, the loaded plugin identity matched that artifact, and the affected behavior was observed on the connected iPhone.
- If only a vault-resident smoke runner changed, sync and hash-check that runner, then re-evaluate it in the existing page. Do not redeploy or reload the plugin when `dist` and plugin runtime assets did not change.
- Treat Safari Web Inspector as DOM/CSS/console/network evidence, not touch automation. Use iPhone Mirroring or the user for real touch interaction.
- Discover and use the available native UI tools for Safari and iPhone Mirroring;
  do not require or install a legacy skill by name. If no tool can operate the
  real target, report the blocked evidence instead of substituting emulation. For
  Safari Console JavaScript, use a real paste/input event and verify the command
  entered Console history or produced its sentinel before counting execution.
  Accessibility `set_value` may change the displayed editor text without creating
  executable Web Inspector input, so it is never submission evidence by itself.
- Treat an explicit user request to run iOS real-device smoke as authorization for plugin-asset deployment through `make deploy-icloud` (or its current-build reuse target), or the existing scoped preparation/sync command for a runner-only change, targeting only the iCloud `test` vault. Do not ask again. If the user requested only planning, review, or inspection without a real-device run, do not deploy or sync.
- Choose the smallest lane that covers the latest runtime delta and stop once
  that lane has sufficient current-build evidence.
- Judge a targeted canary against its current Decision/Spec/SDD contract, not a
  stricter topology borrowed from a deterministic Desktop fixture. In
  particular, a live Recovery canary must accept an intended reranker fail-open
  followed by `recovery_relaxed / skipped / not_eligible` when the standard
  attempt already returned usable evidence; require an actual relaxed retry only
  when the canary explicitly owns a deterministic valid-none/partial fixture.
  Likewise, lexical `unavailable / feature_disabled / generation absent` to
  `ready / generation present` with an advanced maintenance epoch is a valid
  first-generation transition. Preserve a raw runner false-negative, classify
  its product observations independently, and do not spend another device
  attempt solely to satisfy the invalid assertion.
- Before spending a submitted Console execution on a cancellation-only runner,
  require its post-load Memory plan to be `ready / none`. A fresh plugin reload
  with persisted rollout flags off may expose the existing lexical generation as
  `feature_disabled`; temporarily turning flags on then correctly requires
  preparation and is not a runnable cancellation precondition. Do not convert
  that setup-only `BLOCKED` into a product failure or repeat the command.
- Give every submitted attempt a unique result filename and copy/hash its raw
  receipt before the next attempt. Never let a retry overwrite the only device
  evidence. If historical tooling already overwrote a receipt, disclose that
  limitation and distinguish any retained projection from the unavailable raw
  file; do not describe the projection as immutable full evidence.
- Apply slice-scoped invalidation after a diagnostic-only repair. When an immutable
  real-device receipt already proves cancel request/observation, late discard, zero
  accepted-after-cancel, stable index identity and queue release, a successor that
  changes only terminal classification may close through exact new-artifact load
  identity plus a regression using the real wrapped `AbortError` shape. Do not
  rebuild Memory or spend another Provider/device attempt solely to replay the
  unchanged Worker/queue behavior.

## Change Lanes

| Lane | Use when | Required iPhone evidence | Skip |
| --- | --- | --- | --- |
| `geometry-only` | CSS/layout/position/size changed; gesture and action routing did not | Asset match, one reload, one real gesture that exposes the UI, one Mirroring screenshot, one Inspector geometry/hit-test probe, fresh errors | Hold threshold, movement cancel, exactly-once action checks, provider flows, unrelated orientations |
| `interaction` | Touch, pointer, keyboard, focus, dismissal, or action routing changed | Geometry basics plus the affected real gestures, cancel path, and exactly-once behavior | Unrelated Pagelet/provider/cross-surface flows |
| `broad/release` | Shared mobile runtime, multiple surfaces, packaging, or release gate | The declared cross-surface and orientation matrix | Anything explicitly outside the release scope |

Do not promote a geometry-only delta into an interaction or release run merely
because more evidence is available. Record unrequested orientations or devices
as `NOT TESTED` residuals.

## Device Preflight And Retry Budget

Before deployment or GUI control, confirm:

- the user requested real-device smoke;
- the local prerequisite covers the same runtime source state;
- iPhone Mirroring is connected and the device/Mac are unlocked;
- Obsidian is on the iCloud `test` vault and intended note;
- Safari Develop exposes the current Obsidian target.

Allow one unlock/reconnect/reattach sequence, or about three minutes, when a
device or Inspector prerequisite is missing. Then report `BLOCKED`; do not keep
hunting through menus or coordinates. After a reload, allow at most one
Inspector reconnect. If `body.in-progress` persists, preserve the manual path
and stop.

Use one submitted Console probe that returns all required assertions. Allow at
most two execution attempts before reporting partial evidence or `BLOCKED`;
submitted-but-ambiguous commands count as attempts. Do not spend additional
attempts recovering focus, autocomplete, or stale element indices.
Re-read app state after state-changing UI actions or window/DOM changes, and
never reuse stale element indices; batch stable prompt entry, execution, and
result capture where possible.

## Workflow

Prerequisite: complete `obsidian-test-vault-smoke` at least at `app-runtime` tier.

1. Bound the changed surface:

```bash
git status --short --branch
git diff --stat
git diff --name-only
```

2. Reuse a fresh same-turn local prerequisite for the identical runtime source
   state. Otherwise run the complete **Local Validation Gate** from `AGENTS.md`,
   including the runtime `<style>` / `innerHTML` / `outerHTML` source scan.
   Treat `rg` exit code `1` with no output as PASS and inspect every match. For
   broad UI/runtime changes, close local validation with `make deploy` and
   local app smoke.

3. Sync only the changed artifact after the user requested real-device smoke:

- Runner-only change: use that runner's preparation/sync workflow, compare its
  destination hash with the source, and keep the current plugin instance and
  Inspector session. Skip plugin deployment and reload.
- Plugin runtime or CSS change: deploy the current plugin assets:

```bash
make deploy-icloud
```

If the required checks already passed for the current changes (for example,
during desktop smoke), use `make deploy-icloud-current` to verify and copy the
same current production build. It checks build identity, not test results; follow
`AGENTS.md` Local Deployment reuse conditions. If both destinations are authorized
together, `make deploy deploy-icloud` shares full validation once.

This writes only plugin assets under:

```text
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant
```

Request escalated permissions if the sandbox blocks this expected iCloud write.

4. For a plugin-asset change, verify all copied assets deterministically:

```bash
ICLOUD_PLUGIN_DIR="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant"
for file in main.js manifest.json manifest-beta.json styles.css; do
  if ! cmp -s "dist/$file" "$ICLOUD_PLUGIN_DIR/$file"; then
    printf 'MISMATCH %s\n' "$file"
    exit 1
  fi
  printf 'MATCH %s\n' "$file"
done
```

Stop with `FAIL` if any source or destination file is missing or differs.
For a runner-only change, verify only the runner source/destination identity and
confirm the already-loaded plugin identity is still current; do not manufacture
a plugin lifecycle transition as extra evidence.

5. Load the changed artifact on iPhone using the cheapest sufficient path:

- Runner-only: re-evaluate the synced runner in the existing page. Do not reload
  the plugin, vault, or App.
- Plugin assets: after byte comparison passes, reload only
  `personal-assistant` first, using Obsidian's plugin reload lifecycle. Capture
  the previous plugin object before reload.
- Before product assertions, require the new plugin object to exist and differ
  from the previous object, then call `getLoadedPluginBuildIdentity()` and
  require no blocker plus `loadedPluginArtifactSha256` equal to the matched
  iCloud `main.js` SHA-256. Also preserve its load timestamp/version in the
  evidence.
- If plugin reload is unavailable or identity proves it did not load the matched
  artifact, allow exactly one vault reload or normal App reopen as a fallback,
  not both. Recheck loaded identity before continuing.
- Force-quit Obsidian from the iPhone background only when the declared evidence
  target is process startup, OPFS persistence, or complete unload, or when the
  reload path above has been proven ineffective by identity evidence. Record
  that reason; stale-state suspicion alone is insufficient.
- Stop repeated attempts if Obsidian stalls at `body.in-progress`.
- Do not classify an unresponsive tap as a product bug until asset comparison passed and the iPhone loaded the new build.

6. Use the available native UI tools to inspect Safari Web Inspector attached to the iPhone target named like `-- Obsidian -- localhost` and to operate iPhone Mirroring when available.

- If the target, device trust, Develop menu, or Web Inspector connection is unavailable, report `BLOCKED`; do not guess from desktop/mobile emulation.
- Use paste for long Console probes and verify history/output; do not submit a
  value populated only through Accessibility `set_value`.

For a Pagelet Action Ring `geometry-only` change, expose the Ring with one real
long press and capture the Mirroring screenshot. If it auto-closes before
Inspector measurement, let this single probe reopen it through the production
keyboard/context-menu path solely for DOM geometry. Do not count that synthetic
reopen as touch evidence.

```javascript
(()=>{
  const trigger=document.querySelector(".pa-pagelet-pet-trigger");
  if(!trigger){
    console.log('PA_ACTION_RING_LAYOUT {"error":"pet-missing"}');
    return;
  }
  if(!document.querySelector(".pa-pagelet-action-ring")){
    trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"ContextMenu",bubbles:true,cancelable:true}));
  }
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const items=[...document.querySelectorAll(".pa-pagelet-action-ring-item")];
    const viewport=window.visualViewport;
    const box=viewport
      ? {left:viewport.offsetLeft,top:viewport.offsetTop,right:viewport.offsetLeft+viewport.width,bottom:viewport.offsetTop+viewport.height}
      : {left:0,top:0,right:innerWidth,bottom:innerHeight};
    const read=(el)=>{
      const r=el.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return {
        text:el.textContent?.trim(),
        rect:[r.left,r.top,r.width,r.height].map((n)=>+n.toFixed(1)),
        hitSelf:hit===el||el.contains(hit),
      };
    };
    const rows=items.map(read);
    console.log("PA_ACTION_RING_LAYOUT "+JSON.stringify({
      trigger:read(trigger),
      actions:rows,
      count:rows.length,
      sameTop:rows.length===3&&rows.every((x)=>Math.abs(x.rect[1]-rows[0].rect[1])<=1),
      increasingLeft:rows.every((x,i)=>i===0||x.rect[0]>rows[i-1].rect[0]),
      nonOverlapping:rows.every((x,i)=>i===0||x.rect[0]>=rows[i-1].rect[0]+rows[i-1].rect[2]),
      min44:rows.every((x)=>x.rect[2]>=44&&x.rect[3]>=44),
      insideViewport:rows.every((x)=>x.rect[0]>=box.left&&x.rect[1]>=box.top&&x.rect[0]+x.rect[2]<=box.right&&x.rect[1]+x.rect[3]<=box.bottom),
      allHitSelf:rows.every((x)=>x.hitSelf),
    }));
  }));
})()
```

Require `count=3`, all boolean assertions `true`, the intended label
order, and a matching visible screenshot. If gesture code did not change, stop
there after fresh error capture; do not repeat movement-cancel or exactly-once
checks.

Probe real Obsidian chrome before tuning plugin UI. Adjust thresholds for device and orientation:

```javascript
(()=>{const q=[...document.querySelectorAll('button,.clickable-icon,.pa-pagelet-pet')].filter(e=>{const r=e.getBoundingClientRect();return r.top<130&&r.left<430&&r.width>10&&r.height>10}).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),svg=e.querySelector('svg'),p=svg&&svg.querySelector('path,line,polyline,rect,circle');return{cls:String(e.className),title:e.title,aria:e.getAttribute('aria-label'),rect:[r.x,r.y,r.width,r.height].map(n=>+n.toFixed(1)),color:s.color,svg:svg&&{rect:[svg.getBoundingClientRect().x,svg.getBoundingClientRect().y,svg.getBoundingClientRect().width,svg.getBoundingClientRect().height].map(n=>+n.toFixed(1)),viewBox:svg.getAttribute('viewBox'),w:svg.getAttribute('width'),h:svg.getAttribute('height')},path:p&&{tag:p.tagName,stroke:p.getAttribute('stroke'),sw:p.getAttribute('stroke-width'),cssStroke:getComputedStyle(p).stroke,cssSw:getComputedStyle(p).strokeWidth}}});console.log('PA_ICON_PROBE '+JSON.stringify(q))})()
```

Use a null-safe focused pet/system-button comparison. `.sidebar-toggle-button.mod-left` is an Obsidian internal class and may be absent after an app update:

```javascript
(()=>{let l=document.querySelector('.sidebar-toggle-button.mod-left'),p=document.querySelector('.pa-pagelet-pet');let f=e=>{if(!e)return null;let r=e.getBoundingClientRect(),s=e.querySelector('svg'),a=s?[...s.querySelectorAll('path,rect,line,polyline,circle')]:[];return{r:[r.x,r.y,r.width,r.height].map(n=>+n.toFixed(1)),svg:s&&[s.getAttribute('viewBox'),+s.getBoundingClientRect().width.toFixed(1),+s.getBoundingClientRect().height.toFixed(1)],sw:[...new Set(a.map(x=>(x.getAttribute('stroke-width')||getComputedStyle(x).strokeWidth)))],csw:[...new Set(a.map(x=>getComputedStyle(x).strokeWidth))].slice(0,6)}};console.log('PA_MIN '+JSON.stringify({left:f(l),pet:f(p)}))})()
```

## Pitfalls and Stop Conditions

- Measure SVG geometry and stroke width; do not infer apparent weight from screenshots alone.
- Verify asset matches and reload before treating stale iCloud behavior as a regression.
- Treat Reduce Motion as a hypothesis until verified.
- Do not generalize phone placement to iPad without separate evidence.
- Stop automated reloads if `body.in-progress` persists and preserve the user's manual testing path.
- Do not escalate runner refresh into plugin reload, or plugin reload into
  vault/App restart, without the identity evidence required above.
- Stop after the selected lane's evidence is complete; do not expand scope to
  improve an already sufficient proof.
- Stop before writing outside the iCloud `test` plugin directory or the declared
  runner/fixture paths, and never delete vault data.

## Output

```markdown
iOS real-device smoke:
- Lane: `<geometry-only/interaction/broad-release>`
- Local prerequisite: PASS/FAIL
- Reused evidence: `<same-state evidence or none>`
- Device preflight: PASS/BLOCKED
- Artifact sync/deploy: PASS/FAIL/NOT_RUN
- Artifact evidence: `<runner-only: source/destination runner hash + unchanged current plugin identity | plugin-assets: four MATCH lines>`
- Load path: `<runner re-evaluation / plugin reload / single fallback / justified process restart>`
- Loaded identity: `<runner-only: unchanged loaded SHA/version | plugin-assets: instance transition + loaded SHA/version/load timestamp>`
- iPhone observation: PASS/FAIL/BLOCKED - `<Mirroring / Inspector / user>`
- Findings:
  - PASS: `<path>` - `<observed behavior>`
  - FAIL: `<path>` - `<issue and user impact>`
  - BLOCKED: `<path>` - `<external blocker>`
- Inspector evidence: `<rects, CSS, console, DOM state>`
- Explicit skips: `<unaffected gestures, surfaces, orientations, or devices>`
- Stop point: `<sufficient evidence or retry limit reached>`
- Residual risk: `<untested paths or stale-state concern>`
```

Separate “deployed and asset-matched” from “observed on iPhone.” Never promote the former into a real-device PASS.

## Related Skills

- Use `obsidian-test-vault-smoke` first at `app-runtime` tier or higher.
- Use available native UI tools for Safari and iPhone Mirroring UI control.
- Use `obsidian-community-check` only for an authorized hosted community scan.
- Use `personal-assistant-review` for code-level review gates.
