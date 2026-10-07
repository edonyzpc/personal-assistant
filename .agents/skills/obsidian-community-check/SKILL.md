---
name: obsidian-community-check
description: Trigger and inspect Obsidian Community checks for personal-assistant. Use for pre-release branch/tag/commit preview scans, or post-publication stable release recognition with Check for new releases on community.obsidian.md.
---

# Obsidian Community Check

## Core Rules

- Use the real Obsidian Community account page with the user's existing authenticated browser session. Do not invent a public API or CLI for the hosted scan.
- Treat this hosted submission as distinct from the repo-local source scan in the `AGENTS.md` Local Validation Gate. Neither replaces the other.
- Submit only a ref whose intended local commit is proven reachable and identical on the remote. Stop on every SHA mismatch.
- If the user explicitly asked to trigger the hosted check, that authorizes this specific submission. Still obey any browser action-time confirmation.

## Choose The Check

- `preview`: scan the requested remote branch, tag or commit before publication.
  Follow the preview preflight and browser workflow below.
- `release`: discover and check an already-published stable version. Follow
  [Stable Release Recognition](#stable-release-recognition). A completed
  `Preview` is not official release recognition, even if its ref is a tag.

The project review form is:

```text
https://community.obsidian.md/account/plugins/personal-assistant/review-branch
```

## Preview Preflight

Run from the `personal-assistant` repo root.

1. Confirm repository state and choose the requested ref. Default to `master` only when the user supplied no branch, tag, or commit:

```bash
git status --short --branch
git rev-parse --show-toplevel
TARGET_REF=master
INTENDED_SHA="$(git rev-parse --verify "${TARGET_REF}^{commit}")"
printf 'target=%s\nintended=%s\n' "$TARGET_REF" "$INTENDED_SHA"
```

Stop if the ref cannot resolve locally. Report uncommitted changes because they are not part of any hosted scan.

2. Resolve the remote-scannable SHA by ref type.

For a local branch:

```bash
REMOTE_SCAN_SHA="$(git ls-remote --exit-code --heads origin "$TARGET_REF" | awk 'NR==1 {print $1}')"
```

For a tag, prefer the peeled target of an annotated tag and fall back to the lightweight tag target:

```bash
REMOTE_SCAN_SHA="$(git ls-remote --tags origin "refs/tags/$TARGET_REF^{}" | awk 'NR==1 {print $1}')"
if [ -z "$REMOTE_SCAN_SHA" ]; then
  REMOTE_SCAN_SHA="$(git ls-remote --exit-code --tags origin "refs/tags/$TARGET_REF" | awk 'NR==1 {print $1}')"
fi
```

For a raw commit SHA, refresh remote-tracking reachability and require at least one fetched remote branch to contain it:

```bash
git fetch --prune --tags origin
REMOTE_CONTAINERS="$(git branch -r --contains "$INTENDED_SHA" | sed 's/^[*[:space:]]*//')"
if [ -z "$REMOTE_CONTAINERS" ]; then
  printf 'STOP commit is not reachable from a fetched remote branch: %s\n' "$INTENDED_SHA"
  exit 1
fi
printf '%s\n' "$REMOTE_CONTAINERS"
REMOTE_SCAN_SHA="$INTENDED_SHA"
```

If network or sandbox policy blocks `ls-remote`/`fetch`, request the needed approval or report `BLOCKED`; do not submit from stale assumptions. For a raw SHA, stop unless the refreshed remote-branch output proves reachability. A local-only tag is not proof.

3. Require exact equality before opening the form:

```bash
if [ -z "$REMOTE_SCAN_SHA" ] || [ "$INTENDED_SHA" != "$REMOTE_SCAN_SHA" ]; then
  printf 'STOP intended=%s remote=%s\n' "$INTENDED_SHA" "${REMOTE_SCAN_SHA:-missing}"
  exit 1
fi
printf 'SCAN_READY ref=%s sha=%s\n' "$TARGET_REF" "$INTENDED_SHA"
```

Never push automatically. If a branch/tag is absent, ahead, divergent, or otherwise mismatched, stop and tell the user exactly what must be pushed or corrected.

4. Avoid duplicates. Before submitting, inspect the Reviews list for an existing `Pending` entry with the same ref and exact commit. Reuse it unless the user explicitly asks to resubmit.

## Preview Browser Workflow

Discover the browser tools available in this session and use one that can access
the user's existing `community.obsidian.md` login, respecting any browser the user
specified. Do not require or install a legacy skill by name. Tool availability
does not replace the visible page and commit evidence below.

1. Open the review form.
2. Verify the logged-in page shows:
   - Heading `Preview a branch scan`.
   - Textbox `Branch, tag, or commit SHA`.
   - Button `Run preview scan`.
3. Fill the verified `TARGET_REF` exactly.
4. Click `Run preview scan` only after `SCAN_READY` evidence exists.
5. Confirm navigation to:

```text
https://community.obsidian.md/account/plugins/personal-assistant
```

6. Find the newest matching Preview row and verify all three fields:
   - `Ref: <TARGET_REF>`.
   - `Commit: <INTENDED_SHA prefix>`.
   - Status `Pending`, `Completed`, or `Failed`.

Treat any page commit that is not an exact prefix of `INTENDED_SHA` as `FAIL: wrong commit scanned`. Stop and do not claim completion.

If no available browser tool can access the authenticated page, or the page is
logged out, blocked by browser security, or shows CAPTCHA/account prompts, stop
and report `BLOCKED`. Do not inspect cookies, passwords, profiles, local storage,
or session files. Keep the existing tab open for handoff when useful.

## Stable Release Recognition

Read [Release Process](../../../docs/operations/release-process.md#stable-release-official-recognition)
for the canonical publication and asset checks. Use this mode only after the
target's release workflow and non-draft, non-prerelease GitHub Release have
been verified, including the canonical assets and downloaded manifest version.
Reuse their successful evidence; resolve the published tag's commit, not its
annotated tag-object SHA or the source parent scanned before packaging.

1. Open the authenticated Personal Assistant account page:

   `https://community.obsidian.md/account/plugins/personal-assistant`

2. Inspect `Current release` and Reviews. Reuse a release row matching
   `Version: <target-version>` and the published tag commit. Do not reuse a
   `Preview` or another version. If a matching row is `Pending`, poll it instead
   of submitting again; if `Completed`, review its findings and completion
   conditions below before deciding whether any refresh is needed.
   Stop and diagnose a matching `Failed` review or `Error`; do not repeatedly
   submit the same release to bypass findings.
3. If no matching release check exists, verify the visible control
   `Check for new releases` and click it. This submission is included in an
   authorized stable publication or an explicit request to check/refresh
   release recognition. A read-only status request does not authorize it.
   Follow any visible intermediate confirmation only within that same scope.
4. Re-read the account page and inspect the matching release review. Require
   `Version: <target-version>`, a commit link resolving to the published tag
   commit (or a visible SHA prefix matching it), and status
   `Pending`, `Completed`, or `Failed`. Stop on version/commit mismatch.
5. Apply the polling and findings rules below to this release row. Complete
   only when it is `Completed` with no `Error`, `Current release` shows the
   target version, and `No release matches your manifest version` is absent.
   If master's manifest has advanced to a different version, report the
   mismatch; do not trigger or claim the other version as the requested one.

Use only the authenticated browser and observed page controls. The same
login/security/CAPTCHA `BLOCKED` rules apply; do not invent an API or CLI or
extract browser sessions for CI. Clicking the button, clearing the banner,
or source preview completion alone is insufficient. Report GitHub publication
separately when recognition is pending or blocked, retain the handoff page,
and resume this check without republishing or changing the tag. Hosted
recognition does not prove client installation or update delivery.

## Short-Batch Polling

- Reload and inspect in batches of at most six iterations or about 30 seconds.
- After each batch, re-read the current tab state and yield a progress update. Do not run one blocking 90-second loop.
- Stop immediately when the exact matching row changes to `Completed` or `Failed`.
- Stop after about 90 seconds total unless the user requested a longer wait. If still `Pending`, keep the tab open and report incomplete status.
- If browser security blocks later polling, preserve the already-verified submitted row and report the final state as unknown; do not reopen a long loop from scratch.
- Report partial categories visible during `Pending` as incomplete.
- In an authorized stable publication, continue observing a healthy pending
  release check beyond the default 90-second standalone-check limit. Poll at
  reasonable intervals and report meaningful changes; do not end the flow as
  complete while the target release is pending.

## Result Rules

- Treat visible `Error` findings as release blockers per `AGENTS.md`.
- Report warnings concretely without calling the scan failed unless the page says `Failed` or shows an `Error`.
- Do not claim PASS until the exact commit-matched row is `Completed` and all visible findings were reviewed.
- Do not use hosted completion as evidence that the local source scan ran.

## Output

```markdown
Community check:
- Mode: preview / release
- Target version: `<stable version or n/a>`
- Ref: `<branch/tag/sha>`
- Intended local SHA: `<full sha>`
- Remote-scannable SHA: `<full sha>`
- Page commit: `<visible sha>`
- SHA match: yes / no
- Status: Pending / Completed / Failed / BLOCKED
- Findings:
  - PASS: `<category>` - Pass
  - FAIL: `<category>` - Error (release blocker)
  - WARNING: `<category>` - Warning
- Complete: yes / no
- GitHub publication: verified / unverified / n/a
- Official recognition: verified / Pending / Failed / BLOCKED / n/a
- Current release: `<visible version or unavailable>`
- Local source scan: `<separate result or not run>`
- Browser tab: kept open / closed
```

## Related Skills

- Use `obsidian-test-vault-smoke` for local validation and app smoke.
- Use `obsidian-ios-real-device-smoke` for mobile validation.
- Use `personal-assistant-review` for code-level review gates.
- Use `stable-release` for the full authorized stable publication flow.
