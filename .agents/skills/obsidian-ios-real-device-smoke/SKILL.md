---
name: obsidian-ios-real-device-smoke
description: Validate personal-assistant Obsidian plugin changes on a USB-connected iPhone using the iCloud Obsidian test vault, iPhone Mirroring when available, and Safari Web Inspector for real WKWebView DOM/CSS/console evidence. Use when asked to test, verify, debug, inspect, or visually confirm mobile/iOS behavior, touch interactions, Pagelet/Chat/Memory mobile UI, Safari Inspector probes, iCloud deployment, or real-device smoke after local Obsidian test-vault validation.
---

# Obsidian iOS Real-Device Smoke

## Core Rules

- Do not claim iOS real-device validation unless the current build was written to the iCloud Obsidian `test` vault, all copied assets matched `dist`, and the affected behavior was observed on the connected iPhone.
- Treat Safari Web Inspector as DOM/CSS/console/network evidence, not touch automation. Use iPhone Mirroring or the user for real touch interaction.
- Use `computer-use:computer-use` for Safari and iPhone Mirroring UI actions. Prefer its `set_value` action for long Console JavaScript because direct typed punctuation can be corrupted.
- Treat an explicit user request to run iOS real-device smoke as authorization for exactly `make deploy-icloud` to the iCloud `test` vault. Do not ask again. If the user requested only planning, review, or inspection without a real-device run, do not deploy.
- Choose the smallest lane that covers the latest runtime delta and stop once
  that lane has sufficient current-build evidence.

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
hunting through menus or coordinates. Allow one reload/reopen after assets
match. If `body.in-progress` persists, preserve the manual path and stop.

Use one `set_value` Console probe that returns all required assertions. Allow at
most two execution attempts before reporting partial evidence or `BLOCKED`.
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

3. Deploy to the iCloud test vault after the user requested real-device smoke:

```bash
make deploy-icloud
```

This writes only plugin assets under:

```text
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant
```

Request escalated permissions if the sandbox blocks this expected iCloud write.

4. Verify all copied assets deterministically:

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

5. Reload on iPhone:

- Prefer a manual reload/reopen when stale state is suspected.
- Safari Web Inspector reload can work, but stop repeated attempts if Obsidian stalls at `body.in-progress`.
- Do not classify an unresponsive tap as a product bug until asset comparison passed and the iPhone loaded the new build.

6. Use `computer-use:computer-use` to inspect Safari Web Inspector attached to the iPhone target named like `-- Obsidian -- localhost` and to operate iPhone Mirroring when available.

- If the target, device trust, Develop menu, or Web Inspector connection is unavailable, report `BLOCKED`; do not guess from desktop/mobile emulation.
- Use `set_value` or paste for long Console probes.

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
- Stop after the selected lane's evidence is complete; do not expand scope to
  improve an already sufficient proof.
- Stop before writing outside the iCloud `test` plugin directory or deleting vault data.

## Output

```markdown
iOS real-device smoke:
- Lane: `<geometry-only/interaction/broad-release>`
- Local prerequisite: PASS/FAIL
- Reused evidence: `<same-state evidence or none>`
- Device preflight: PASS/BLOCKED
- iCloud deploy: PASS/FAIL
- Asset comparison: `<four MATCH lines or mismatch>`
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
- Use `computer-use:computer-use` for Safari and iPhone Mirroring UI control.
- Use `obsidian-community-check` only for an authorized hosted community scan.
- Use `personal-assistant-review` for code-level review gates.
