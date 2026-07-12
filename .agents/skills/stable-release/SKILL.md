---
name: stable-release
description: Execute the stable release workflow for the Personal Assistant Obsidian plugin. Use when the user asks to prepare, validate, cut, or publish a stable release; asks for a stable release dry run or follow-up verification; or says "release", "发版", "publish stable", "cut release", "stable release", "发布正式版", or "正式发版". For BRAT beta prerelease builds, use `pa-brat-beta-release` instead.
---

# Stable Release

Read `docs/operations/release-process.md` before every stable-release execution
or workflow change. Treat that runbook and the current release scripts as the
canonical command and asset contract. If this skill disagrees with them, stop
and report the drift instead of improvising.

Run commands from the repository root. For prerelease versions, use
`pa-brat-beta-release` instead.

## Resolve Intent

Classify the current request before changing state:

- `prepare`: inspect state and show the dry run. Do not create a release commit
  or tag, push anything, create a GitHub Release, or submit a hosted community
  scan unless the user explicitly requested that scan.
- `local-release`: prepare, pass the hosted community gate, then create the
  local release commit and annotated tag. Do not push.
- `publish`: complete the local release when needed, push `master` and the tag,
  wait for the workflow, and verify the GitHub Release.

Treat an explicit current-turn request that names the target version and asks to
publish as authorization for the complete `publish` flow. Do not ask again only
because the dry run finished. Ask before mutation only when:

- the target version, branch, or requested intent is ambiguous;
- the proposed version or scope differs from what the user authorized;
- the dry run reveals unexpected commits, release notes, or risk;
- a blocking gate requires a product or risk-acceptance decision; or
- recovery would delete, rewrite, or move a release tag.

## Safety Boundaries

- Cut stable releases only from `master` with a clean worktree.
- Never publish without explicit publish intent in the current turn.
- Never delete, rewrite, or move release tags without an explicit maintainer
  decision.
- Stop on failed validation, hosted community `Error`, or workflow failure.
  Report the evidence; do not bypass the gate.
- Preserve unrelated user changes. Do not stash, clean, switch branches, or
  reconcile divergence without authorization.

## Inspect State

Run:

```bash
git status --short --branch
git branch --show-current
node -p "require('./package.json').version"
git tag --sort=-v:refname | sed -n '1,20p'
git fetch origin master
git rev-parse HEAD
git rev-parse origin/master
```

Stop if the worktree is dirty or the branch is not `master`.

Resolve one of these states:

- Fresh source state: the target is greater than `package.json`, its tag does
  not exist, and `HEAD` equals `origin/master`. Use `HEAD` as `source_head`.
- Existing local-release state: `package.json` equals the target, the target tag
  points to `HEAD`, and `HEAD^` equals `origin/master`. Use `HEAD^` as
  `source_head`; do not recreate the release commit.

Stop on any other local/remote or version/tag relationship and ask the user how
to reconcile it. If no version was supplied, use the read-only changelog preview
to propose one, then obtain approval before changing release state:

```bash
node scripts/changelog.mjs --target-version <candidate>
```

## Preview Fresh Releases

For a fresh source state, always run:

```bash
make release-dry-run VERSION=<target-version>
```

Report the current and target versions, changelog range, commit subjects, and
generated section. Continue directly when they match an already-authorized
`local-release` or `publish` request. A previously created local-release state
cannot be dry-run again with the same version; validate its release commit and
tag instead.

## Hosted Community Gate

Before `local-release` or `publish`, use `obsidian-community-check` to trigger or
inspect the hosted scan for the exact `source_head` commit.

Verify all of the following:

- `source_head` equals `origin/master`.
- The hosted result reports the same commit SHA as `source_head`.
- The scan completed successfully and contains no `Error` findings.

Wait for a pending matching scan. Treat `Error` or `Failed` as a blocker. Do not
reuse a result for another commit. For `prepare`, only report this as a remaining
gate unless the user explicitly asked to submit the hosted scan.

## Create Local Release

For a fresh `local-release` or `publish` flow, run the complete release gate:

```bash
make release VERSION=<target-version>
```

Do not pass `SKIP_CHECKS=1` or `--skip-checks`. Do not use `make deploy` as a
substitute: `make release` must run its own whitespace, notices, coverage test,
lint, build, and bundle-audit checks.

Verify:

```bash
git log --oneline -1
git tag --list <target-version>
git rev-parse <target-version>^{}
git rev-parse HEAD
git rev-parse HEAD^
git status --short
```

Require the tag to point to `HEAD`, the worktree to be clean, and the release
commit parent to equal the scanned `source_head`.

Stop here for `local-release`.

## Publish And Verify

For `publish`, recheck the clean worktree, `master`, package version, and tag at
`HEAD`, then run:

```bash
make publish VERSION=<target-version>
```

Do not claim completion until the GitHub Actions release workflow succeeds and
the Release object is non-draft, non-prerelease, and contains the canonical
assets:

```bash
gh release view <target-version> \
  --json url,tagName,name,isPrerelease,isDraft,assets \
  --jq '{url,tagName,name,isPrerelease,isDraft,assets:[.assets[].name]}'
```

Use the canonical runbook for the exact asset set and recovery procedure. If the
workflow or Release verification is unavailable, report the push separately and
leave publication unverified.

## Related Skills

- Use `pa-brat-beta-release` for BRAT prereleases.
- Use `personal-assistant-review` for code-level release readiness.
- Use `obsidian-community-check` for the hosted pre-publication gate.
- Use `obsidian-test-vault-smoke` for app smoke evidence.
- Use `obsidian-ios-real-device-smoke` for real-device iOS evidence.
