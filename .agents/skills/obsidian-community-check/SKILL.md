---
name: obsidian-community-check
description: Trigger and inspect the Obsidian Community plugin review-branch scan for the personal-assistant plugin. Use when asked to run, trigger, poll, verify, or report the community.obsidian.md automated check for master, a branch, tag, or commit before Obsidian plugin release or publication.
---

# Obsidian Community Check

## Core Rule

Use the real Obsidian Community account page with the user's existing Chrome login state. Do not pretend there is a stable public API or CLI for this check.

The review page for this project is:

```text
https://community.obsidian.md/account/plugins/personal-assistant/review-branch
```

Submitting this form transmits the selected branch, tag, or commit SHA to Obsidian's community review service. If the user explicitly asked to trigger the community check, that is enough authorization for this specific submission.

## Preflight

Run from the `personal-assistant` repo root.

1. Confirm git state:

```bash
git status --short --branch
git rev-parse --short=7 HEAD
```

2. Choose the ref:
   - Use the user-provided branch, tag, or commit SHA when present.
   - Default to `master` for this repository.
   - Use `master` explicitly instead of leaving the field blank unless the user asks for the default-branch blank behavior.

3. Avoid stale or duplicate scans:
   - If `git status --short --branch` shows the target branch is ahead of its remote, tell the user it must be pushed before the community site can scan that commit. Push only when the user asks.
   - Before submitting, if practical, inspect the plugin Reviews page for an existing `Pending` scan with the same ref and commit. If one exists, report it instead of creating a duplicate unless the user explicitly asks to submit again.

## Chrome Workflow

Use `chrome:control-chrome` for this workflow because the page requires the user's existing `community.obsidian.md` login state.

1. Open the review form URL in Chrome.
2. Verify the page is logged in and shows:
   - Heading: `Preview a branch scan`
   - Textbox label: `Branch, tag, or commit SHA`
   - Button: `Run preview scan`
3. Fill the textbox with the target ref, usually `master`.
4. Click `Run preview scan`.
5. Confirm the browser navigates back to:

```text
https://community.obsidian.md/account/plugins/personal-assistant
```

6. Confirm the Reviews list contains a new or existing Preview entry with:
   - `Ref: <target-ref>`
   - `Commit: <short-sha>`
   - Status: `Pending`, `Completed`, or `Failed`

If Chrome is unavailable, the user is logged out, or the page shows a CAPTCHA or account prompt, stop and report the blocker. Do not inspect cookies, saved passwords, local storage, or session files.

## Polling

Poll the plugin page by reloading every 5 seconds for about 90 seconds unless the user requests a longer wait.

Stop when the newest matching entry changes from `Pending` to `Completed` or `Failed`. If it remains `Pending`, keep the Chrome tab open as a handoff and report that the scan is still running.

When partial results are visible while status is `Pending`, report them as incomplete. Use exact category/status wording from the page, such as:

```text
CSS LINT: Warning
DEPENDENCIES: Pass
```

## Output

```markdown
Community check:
- Ref: `<branch/tag/sha>`
- Commit: `<short-sha>`
- Status: Pending / Completed / Failed
- Findings:
  - PASS: `<category>` - Pass
  - FAIL: `<category>` - Error (release blocker)
  - WARNING: `<category>` - Warning
- Complete: yes / no (still pending)
- Chrome tab: kept open / closed
```

Per **Obsidian Community Review Rules** from AGENTS.md, `Error` findings are release blockers. Warnings should be reported concretely, but do not call the scan failed unless the page status says `Failed` or an `Error` finding is visible.

Do not claim the community check passed until the page shows a completed result and the visible findings have been reviewed.

## Related Skills

This skill is typically preceded by local and app-level validation:
- `obsidian-test-vault-smoke` for local + app smoke.
- `obsidian-ios-real-device-smoke` for mobile validation.
- `personal-assistant-review` for code-level review gates.
