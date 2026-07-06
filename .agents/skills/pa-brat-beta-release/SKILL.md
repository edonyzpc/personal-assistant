---
name: pa-brat-beta-release
description: Manage Personal Assistant BRAT beta prerelease workflow. Use when the user asks to prepare, explain, validate, publish, or follow up a BRAT beta/prerelease build; asks about beta branch management; wants to move tested development work into BRAT testing; or needs the feature branch to beta packaging branch to PR to master to stable release process.
---

# PA BRAT Beta Release

Use this skill for Personal Assistant prerelease builds intended for BRAT beta
testers. The detailed repo SOP is `docs/brat-beta-testing.md`; read it before
changing the workflow or executing a beta release.

## Branch Model

Keep three branch roles distinct:

- Development branch: owns feature commits, tests, and review fixes, for example
  `feature/pagelet-recall`.
- Beta packaging branch: temporary release branch named exactly
  `beta/<target-version>`, for example `beta/2.9.0-beta.1`.
- `master`: stable integration branch. Formal releases are cut from `master`
  after the development branch lands through PR and is verified.

Do not merge beta release commits back to `master`. A beta branch may contain
`[release] v2.9.0-beta.N` and prerelease metadata; the PR to `master` should
carry runtime/docs/test changes, not beta packaging commits.

## Safety Boundaries

- Treat `make release`, `make publish`, tag creation, branch pushes, GitHub
  Releases, and BRAT tester handoff as release-side effects.
- Do not publish, push branches, push tags, create GitHub Releases, or hand off
  BRAT tester instructions/URLs unless the user clearly asks for that action in
  the current turn.
- If the target version, source branch, or baseline tag is ambiguous, stop and
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
2. Confirm the source branch is the development branch that contains the tested
   feature changes.
   - If the named source branch is absent locally, only do read-only discovery
     first: `git branch --list <branch>` and
     `git branch -r --list origin/<branch>`.
   - Ask before fetching, checking out, or creating local tracking branches.
3. Choose the next prerelease version, usually `<next-stable>-beta.N`.
4. Explain that the beta branch is a packaging branch only:
   - `git switch <development-branch>`
   - `git switch -c beta/<target-version>`
5. Run or recommend:
   - `make release-dry-run VERSION=<target-version>`
   - `make release VERSION=<target-version>` only when the user asked to create
     local release state.
   - `make publish VERSION=<target-version>` only when the user asked to publish
     and the publish preflight below passes.

`scripts/release.mjs` enforces prerelease branch naming: the current branch must
be exactly `beta/<target-version>`.

## Publish Preflight

Before `make publish VERSION=<target-version>`, verify:

```bash
git status --short
git branch --show-current
node -p "require('./package.json').version"
git rev-parse <target-version>^{}
git rev-parse HEAD
```

Expected:

- `git status --short` is empty.
- For prereleases, the current branch is exactly `beta/<target-version>`.
- For stable releases, the current branch is exactly `master`.
- `package.json` version equals `<target-version>`.
- `git rev-parse <target-version>^{}` equals `git rev-parse HEAD`.

`scripts/publish-release.mjs` enforces these branch, package-version, and
tag-to-HEAD checks before pushing.

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

1. Put fixes on the development branch, not only on a beta branch.
2. Open PR from the development branch to `master`.
3. Keep beta release commits and prerelease metadata out of the PR.
4. After PR merge and `master` verification, cut stable release from `master`:
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

- If a beta is bad but unpublished, fix the source branch and recreate the beta
  packaging branch.
- If a beta is already published, publish the next beta tag such as
  `2.9.0-beta.2`; do not rewrite tags without explicit maintainer approval.
- If `make release-dry-run` reports the current package version is untagged,
  stop and resolve the baseline tag before proceeding.
