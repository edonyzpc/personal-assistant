---
name: pa-brat-beta-release
description: Manage Personal Assistant BRAT beta prerelease workflow. Use when the user asks to prepare, explain, validate, publish, or follow up a BRAT beta/prerelease build; asks about beta branch management; wants to move master-integrated work into BRAT testing; or needs the work branch to master to beta packaging or stable release process.
---

# PA BRAT Beta Release

Use this skill for Personal Assistant prerelease builds intended for BRAT beta
testers. The detailed repo SOP is `docs/operations/brat-beta-testing.md`; read it before
changing the workflow or executing a beta release.

## Branch Model

Keep these roles distinct:

- `master`: the sole integration and release-source branch. All accepted runtime
  code, tests, research/design docs, governance and release-tooling changes land
  here through a PR merge or an explicitly authorized direct commit.
- Work branch: optional isolation/review transport. It has no beta or stable
  release authority; accepted commits must enter `master` first.
- Beta packaging branch: temporary branch named exactly `beta/<target-version>`,
  created from the exact verified `master` HEAD.

A beta branch may contain only the generated `[release] vX.Y.Z-beta.N` packaging
commit and tag above `master`. Do not add feature/fix/docs commits there, and do
not merge or rebase the beta release commit back to `master`.

## Safety Boundaries

- Treat `make release`, `make publish`, tag creation, branch pushes, GitHub
  Releases, and BRAT tester handoff as release-side effects.
- Do not publish, push branches, push tags, create GitHub Releases, or hand off
  BRAT tester instructions/URLs unless the user clearly asks for that action in
  the current turn.
- If the target version, `master` baseline, or baseline tag is ambiguous, stop and
  ask before creating release state.
- Prefer `make release-dry-run VERSION=x.y.z-beta.N` before any local release
  commit/tag.

## Preparation Workflow

When asked to prepare or explain a beta:

1. Inspect current state:
   - `git status --short --branch`
   - `git branch --show-current`
   - `node -p "require('./package.json').version"`
   - `git tag --sort=-v:refname | sed -n '1,20p'`
   If `git status --short --branch` shows any uncommitted changes, stop before
   switching or creating beta branches. Ask the user to commit, stash, clean, or
   explicitly confirm the intended dirty-worktree scope.
2. Confirm all accepted work is already in `master`. A work branch with commits
   not reachable from `master` must be merged by PR or authorized direct commit
   before beta preparation continues.
3. Refresh and verify the local integration baseline:
   - `git fetch origin master`
   - `git switch master`
   - `git pull --ff-only`
   - verify `git rev-parse master` equals `git rev-parse origin/master`
   - run the validation gate appropriate to the change
   If local `master` is ahead, publishing beta must stop until the user
   explicitly authorizes pushing `master` and the two refs match.
4. Choose the next prerelease version, usually `<next-stable>-beta.N`.
5. Create the packaging branch from the exact current `master` HEAD:
   - `git switch -c beta/<target-version>`
   - verify `git rev-parse HEAD` equals `git rev-parse master`
6. Run or recommend:
   - `make release-dry-run VERSION=<target-version>`
   - `make release VERSION=<target-version>` only when the user asked to create
     local release state.
   - `make publish VERSION=<target-version>` only when the user asked to publish
     and the publish preflight below passes.

`scripts/release.mjs` enforces both the matching `beta/<target-version>` name and
the pre-release `HEAD == master` source invariant.

## Publish Preflight

Before `make publish VERSION=<target-version>`, verify:

```bash
git status --short
git branch --show-current
node -p "require('./package.json').version"
git rev-parse <target-version>^{}
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse master
```

Expected:

- `git status --short` is empty.
- For prereleases, the current branch is exactly `beta/<target-version>`.
- For stable releases, the current branch is exactly `master`.
- `package.json` version equals `<target-version>`.
- `git rev-parse <target-version>^{}` equals `git rev-parse HEAD`.
- For prereleases, `HEAD^` equals `master` and the release commit is the only
  commit present on beta but not on `master`.
- `master` equals `origin/master`; otherwise the remote workflow will reject the
  prerelease source even if local checks pass.

`scripts/publish-release.mjs` also checks package/manifest versions, the exact
generated packaging-file set and commit subject, queries live `origin/master`,
then pushes the beta branch + tag atomically. If `master` advances normally
after the live preflight, the workflow accepts the verified source parent as an
ancestor; divergent/rewritten master history is rejected.

## Publish Verification

After publish, verify the GitHub prerelease before claiming BRAT readiness:

```bash
gh release view <target-version> \
  --json tagName,name,isPrerelease,assets \
  --jq '{tagName,name,isPrerelease,assets:[.assets[].name]}'
```

Expected:

- `tagName` and `name` equal `<target-version>`.
- `isPrerelease` is `true`.
- Assets include `main.js`, `manifest.json`, and `styles.css`.
- The released `manifest.json` asset has `version` equal to `<target-version>`.

For release workflow failures, inspect GitHub Actions before giving testers the
BRAT URL.

## BRAT Smoke

Do not claim BRAT validation unless the plugin was installed or updated through
BRAT from the published GitHub Release.

Minimum evidence:

- GitHub Release object and asset verification.
- Desktop Obsidian install/update through BRAT.
- Plugin enable/reload and Settings open.
- One Chat path and one Memory/Pagelet path relevant to the beta scope.
- Mobile BRAT install/update when the change touches mobile-visible UI,
  storage, or platform behavior.

For app smoke, use `obsidian-test-vault-smoke`; for iOS, use
`obsidian-ios-real-device-smoke`.

## Stable Graduation

When beta blockers are closed:

1. Confirm every accepted beta fix is already on `master`; fixes may enter by PR
   or authorized direct commit, never only on a beta branch.
2. Verify `master` again. Do not merge beta release commits or prerelease
   metadata into it.
3. Cut the stable release directly from `master`:
   - `git switch master`
   - `git pull --ff-only`
   - `git branch --show-current`
   - `git status --short`
   - `make release-dry-run VERSION=<stable-version>`
   - `make release VERSION=<stable-version>`
   - `make publish VERSION=<stable-version>` only after explicit publish intent.

Stable changelog generation ignores prerelease tags, so the stable release notes
should cover the full range from the previous stable tag.

## Recovery

- If a beta is bad, put the fix on `master` first. If no published tag exists,
  recreate the packaging branch from that updated `master` only with explicit
  authority to replace local release state.
- If a beta is already published, publish the next beta tag such as
  `2.9.0-beta.3` from updated `master`; do not rewrite tags without explicit
  maintainer approval.
- If `make release-dry-run` reports the current package version is untagged,
  stop and resolve the baseline tag before proceeding.
