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

## Workflow

Prerequisite: complete `obsidian-test-vault-smoke` at least at `app-runtime` tier.

1. Bound the changed surface:

```bash
git status --short --branch
git diff --stat
git diff --name-only
```

2. Run the complete **Local Validation Gate** from `AGENTS.md`. Run every current command, including the runtime `<style>` / `innerHTML` / `outerHTML` source scan. Treat `rg` exit code `1` with no output as PASS and inspect every match. For broad UI/runtime changes, close local validation with `make deploy` and local app smoke.

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
- Re-read app state after each action and derive fresh element indices.
- Use `set_value` or paste for long Console probes.

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
- Stop before writing outside the iCloud `test` plugin directory or deleting vault data.

## Output

```markdown
iOS real-device smoke:
- Local prerequisite: PASS/FAIL
- iCloud deploy: PASS/FAIL
- Asset comparison: `<four MATCH lines or mismatch>`
- iPhone observation: PASS/FAIL/BLOCKED - `<Mirroring / Inspector / user>`
- Findings:
  - PASS: `<path>` - `<observed behavior>`
  - FAIL: `<path>` - `<issue and user impact>`
  - BLOCKED: `<path>` - `<external blocker>`
- Inspector evidence: `<rects, CSS, console, DOM state>`
- Residual risk: `<untested paths or stale-state concern>`
```

Separate “deployed and asset-matched” from “observed on iPhone.” Never promote the former into a real-device PASS.

## Related Skills

- Use `obsidian-test-vault-smoke` first at `app-runtime` tier or higher.
- Use `computer-use:computer-use` for Safari and iPhone Mirroring UI control.
- Use `obsidian-community-check` only for an authorized hosted community scan.
- Use `personal-assistant-review` for code-level review gates.
