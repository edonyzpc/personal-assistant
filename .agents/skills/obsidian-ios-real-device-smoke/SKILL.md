---
name: obsidian-ios-real-device-smoke
description: Validate personal-assistant Obsidian plugin changes on a USB-connected iPhone using the iCloud Obsidian test vault, iPhone Mirroring when available, and Safari Web Inspector for real WKWebView DOM/CSS/console evidence. Use when asked to test, verify, debug, inspect, or visually confirm mobile/iOS behavior, touch interactions, Pagelet/Chat/Memory mobile UI, Safari Inspector probes, iCloud deployment, or real-device smoke after local Obsidian test-vault validation.
---

# Obsidian iOS Real-Device Smoke

## Core Rule

Do not claim iOS real-device validation unless the current build was written to the iCloud Obsidian `test` vault and the behavior was observed on the connected iPhone, either visually through iPhone Mirroring or through Safari Web Inspector attached to the iPhone Obsidian WKWebView.

Safari Web Inspector is observation and debugging evidence. It can inspect DOM, computed CSS, console, network, and run JavaScript in the WKWebView. It is not reliable touch automation. Use iPhone Mirroring or the user for real touch interaction.

## Workflow

Prerequisite: complete `obsidian-test-vault-smoke` (at least `app-runtime` tier) before iOS real-device smoke.

1. Bound the changed surface first:

```bash
git status --short --branch
git diff --stat
git diff --name-only
```

2. Validate locally before touching the phone — run the **Local Validation Gate** from AGENTS.md. For broad UI/runtime changes, close the local gate with `make deploy`.

3. Write the build to the iCloud Obsidian test vault only after explicit user approval in the current thread, or when the user already confirmed this exact action:

```bash
make deploy-icloud
```

This writes to:

```text
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant
```

Request escalated permissions if the sandbox blocks the iCloud write.

4. Verify the copied artifacts match `dist`:

```bash
shasum -a 256 dist/main.js dist/styles.css \
  "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant/main.js" \
  "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant/styles.css"
```

5. Reload on iPhone:

- Prefer the user manually reload/reopen Obsidian iOS when stale build state is suspected.
- Safari Web Inspector's reload button can work, but Obsidian iOS can stall at `body.in-progress`; if it does not recover quickly, stop repeated reload attempts and report the state.
- Do not treat "tap did nothing" as a product bug until the iPhone has loaded the latest iCloud build.

6. Inspect with Safari Web Inspector when attached to the iPhone target showing `-- Obsidian -- localhost`:

- Use `set_value` or paste into the Console prompt for long JavaScript; direct typed punctuation can be corrupted.
- Probe real Obsidian chrome before tuning plugin UI. Example probes below assume iPhone portrait layout — adjust pixel thresholds for other devices/orientations:

```javascript
(()=>{const q=[...document.querySelectorAll('button,.clickable-icon,.pa-pagelet-pet')].filter(e=>{const r=e.getBoundingClientRect();return r.top<130&&r.left<430&&r.width>10&&r.height>10}).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),svg=e.querySelector('svg'),p=svg&&svg.querySelector('path,line,polyline,rect,circle');return{cls:String(e.className),title:e.title,aria:e.getAttribute('aria-label'),rect:[r.x,r.y,r.width,r.height].map(n=>+n.toFixed(1)),color:s.color,svg:svg&&{rect:[svg.getBoundingClientRect().x,svg.getBoundingClientRect().y,svg.getBoundingClientRect().width,svg.getBoundingClientRect().height].map(n=>+n.toFixed(1)),viewBox:svg.getAttribute('viewBox'),w:svg.getAttribute('width'),h:svg.getAttribute('height')},path:p&&{tag:p.tagName,stroke:p.getAttribute('stroke'),sw:p.getAttribute('stroke-width'),cssStroke:getComputedStyle(p).stroke,cssSw:getComputedStyle(p).strokeWidth}}});console.log('PA_ICON_PROBE '+JSON.stringify(q))})()
```

For a focused pet-vs-system-button check (`.sidebar-toggle-button.mod-left` is an Obsidian internal class — may change across Obsidian versions):

```javascript
(()=>{let l=document.querySelector('.sidebar-toggle-button.mod-left'),p=document.querySelector('.pa-pagelet-pet');let f=e=>{let r=e.getBoundingClientRect(),s=e.querySelector('svg'),a=s?[...s.querySelectorAll('path,rect,line,polyline,circle')]:[];return{r:[r.x,r.y,r.width,r.height].map(n=>+n.toFixed(1)),svg:s&&[s.getAttribute('viewBox'),+s.getBoundingClientRect().width.toFixed(1),+s.getBoundingClientRect().height.toFixed(1)],sw:[...new Set(a.map(x=>(x.getAttribute('stroke-width')||getComputedStyle(x).strokeWidth)))],csw:[...new Set(a.map(x=>getComputedStyle(x).strokeWidth))].slice(0,6)}};console.log('PA_MIN '+JSON.stringify({left:f(l),pet:f(p)}))})()
```

## iOS Smoke Pitfalls

- Matching apparent visual weight of SVG icons requires measuring both geometry and stroke width — do not guess from screenshots alone.
- Stale iCloud builds cause false negatives. Always verify hash match and reload before judging behavior.
- Treat `prefers-reduced-motion` / iOS Reduce Motion as a hypothesis to verify, not a conclusion.
- Do not assume phone-sized placement decisions apply to iPad without separate evidence.
- When Safari Inspector reload leaves Obsidian in `body.in-progress`, stop automated reload attempts and preserve the user's manual testing path.

## Output

Use a structured evidence log:

```markdown
iOS real-device smoke:
- iCloud deploy: PASS/FAIL - `shasum` match result
- iPhone observation: PASS/FAIL/BLOCKED - method (Mirroring / Inspector)
- Findings:
  - PASS: `<path>` - `<observed behavior>`
  - FAIL: `<path>` - `<issue and user impact>`
  - BLOCKED: `<path>` - `<external blocker>`

Inspector evidence:
- Element rects, SVG viewBox, computed stroke widths, z-index, or DOM state

Residual risk:
- <paths not tested, stale build concerns, etc.>
```

Report evidence honestly:

- Separate "deployed to iCloud and hash-matched" from "observed on iPhone".
- If iPhone reload stalls, say so and ask the user to manually reopen/reload before judging UI behavior.

## Related Skills

- `obsidian-test-vault-smoke` is a prerequisite (at least `app-runtime` tier).
- `obsidian-community-check` for community compliance scan after mobile validation.
- `personal-assistant-review` for code-level review gates.
