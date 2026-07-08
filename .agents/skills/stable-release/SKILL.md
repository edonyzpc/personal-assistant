---
name: stable-release
description: Execute the stable release workflow for the Personal Assistant Obsidian plugin. Use when the user asks to release, publish a stable version, cut a release, or says "release", "发版", "publish stable", "cut release", "stable release", "发布正式版", "正式发版". For BRAT beta prerelease builds, use `pa-brat-beta-release` instead.
---

# Stable Release

Use this skill for stable (non-prerelease) releases of the Personal Assistant
Obsidian plugin. The detailed repo SOP is `docs/release-process.md`; read it
before changing the workflow. Release automation lives in `scripts/release.mjs`,
`scripts/changelog.mjs`, and `scripts/publish-release.mjs`.

For BRAT beta prerelease builds, use `pa-brat-beta-release` instead.

## Safety Boundaries

- Never publish, push tags, or create GitHub Releases without explicit user
  confirmation in the current turn.
- Never skip the dry-run step. Always show the dry-run output and wait for user
  approval before creating the release commit and tag.
- If any gate fails, stop and report the failure. Do not auto-fix, retry, or
  work around failures.
- Do not delete, rewrite, or move release tags unless the user explicitly
  requests it.
- Stable releases must run from `master`. The publish script enforces this.

## Pre-flight Inspection

When the user asks to release or prepare a release:

1. Inspect current state:
   ```bash
   git status --short --branch
   git branch --show-current
   node -p "require('./package.json').version"
   git tag --sort=-v:refname | head -10
   ```
   If `git status --short` shows any uncommitted changes, stop. Ask the user to
   commit, stash, or clean before proceeding.

2. Confirm the current branch is `master`:
   - If not on `master`, stop and inform the user. Stable releases must be cut
     from `master`.

3. Confirm `master` is up to date with `origin/master`:
   ```bash
   git fetch origin master
   git rev-parse master
   git rev-parse origin/master
   ```
   If they diverge, stop and ask the user to reconcile.

4. Determine the target version. If the user did not specify one, suggest the
   next patch/minor/major based on the changelog subjects:
   ```bash
   node scripts/changelog.mjs --target-version <candidate>
   ```

## Step 1 — Full Validation Gate

Run `make deploy` to execute the full local validation chain (lint, build, test,
deploy to test vault):

```bash
make deploy
```

If `make deploy` fails, stop and report the error. Do not proceed.

## Step 2 — Dry Run (mandatory)

Show the user what the release will contain. Never skip this step:

```bash
make release-dry-run VERSION=<target-version>
```

Present the dry-run output to the user, including:
- Current version and target version
- Changelog range and commit subjects
- Generated changelog section

Then ask for explicit confirmation:

> The dry-run above shows the release plan for `<target-version>`. Shall I
> proceed with creating the release commit and tag?

**Do not proceed without user approval.**

## Step 3 — Create Release Commit and Tag

After explicit user approval:

```bash
make release VERSION=<target-version>
```

This will:
1. Verify clean worktree
2. Verify version validity and tag availability
3. Verify the current package.json version is already tagged
4. Generate the changelog section
5. Run `git diff --check`, third-party notice check, tests, lint, build, and
   bundle audit (unless `SKIP_CHECKS=1` and checks were already run in Step 1)
6. Update `package.json`, `package-lock.json`, `manifest.json`,
   `manifest-beta.json`, `versions.json`, `CHANGELOG.md`, and `NOTICE`
7. Create commit `[release] v<target-version>, check the CHANGELOG.md for details`
8. Create annotated tag `<target-version>`

If `make deploy` was run in Step 1 and no files changed between then and now,
pass `SKIP_CHECKS=1` to avoid re-running the full check suite:

```bash
make release VERSION=<target-version> SKIP_CHECKS=1
```

After the release commit is created, verify the result:

```bash
git log --oneline -1
git tag --list <target-version>
git status --short
```

## Step 4 — Publish Confirmation Gate

Before publishing, present the state to the user:

```bash
git status --short
git branch --show-current
node -p "require('./package.json').version"
git rev-parse <target-version>^{}
git rev-parse HEAD
```

Verify all of these before asking to publish:
- `git status --short` is empty (clean worktree)
- Current branch is `master`
- `package.json` version equals `<target-version>`
- `git rev-parse <target-version>^{}` equals `git rev-parse HEAD` (tag points
  to HEAD)

Then ask for explicit confirmation:

> Release commit and tag `<target-version>` are ready. Shall I publish to
> GitHub? This will push the branch and tag to origin and trigger the release
> workflow.

**Do not publish without user approval.**

## Step 5 — Publish

After explicit user approval:

```bash
make publish VERSION=<target-version>
```

This pushes both `master` and the tag to `origin`, then watches the GitHub
Actions release workflow via `gh run watch --exit-status`.

If the workflow fails, report the failure and the workflow URL. Do not retry
automatically.

## Step 6 — Post-Publish Verification

After successful publish, verify the GitHub Release:

```bash
gh release view <target-version> \
  --json tagName,name,isPrerelease,isDraft,assets \
  --jq '{tagName,name,isPrerelease,isDraft,assets:[.assets[].name]}'
```

Expected:
- `tagName` and `name` equal `<target-version>`
- `isPrerelease` is `false`
- `isDraft` is `false`
- Assets include `main.js`, `manifest.json`, `styles.css`, `LICENSE`,
  `NOTICE`, and `THIRD_PARTY_NOTICES.md`

Optionally verify the released `manifest.json` asset version:

```bash
gh release download <target-version> --pattern manifest.json --output - | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version"
```

## Post-Publish Checklist

Report the following to the user after a successful publish:

1. GitHub Release URL and asset verification status
2. Whether community plugin check should be run (use `obsidian-community-check`
   skill if needed)
3. Whether app smoke test should be run (use `obsidian-test-vault-smoke` skill
   if needed)
4. Remind the user to verify in Obsidian community plugin update flow when the
   release is indexed

## Recovery

- If `make release` fails before the release commit, inspect `git status
  --short`, fix the issue, and rerun the command.
- If the release commit exists but the tag was not pushed, rerun
  `make publish VERSION=<target-version>`.
- If a tag was created incorrectly, do not delete or retag without an explicit
  user decision.
- If the GitHub Actions workflow fails, inspect the workflow run before
  retrying. Report the URL and failure details to the user.

## Related Skills

- For BRAT beta prerelease builds, use `pa-brat-beta-release`.
- For app-level smoke validation, use `obsidian-test-vault-smoke`.
- For real-device iOS validation, use `obsidian-ios-real-device-smoke`.
- For community compliance scan, use `obsidian-community-check`.
- For code-level release-readiness review, use `personal-assistant-review`.
