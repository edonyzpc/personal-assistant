# BRAT Beta Testing Process

This runbook defines how Personal Assistant beta builds are published for BRAT
testing without exposing prerelease versions through the stable Obsidian
community-plugin path.

Sources:

- BRAT developer guide: <https://tfthacker.com/brat-developers>
- BRAT user guide: <https://tfthacker.com/BRAT>

## Policy

- Stable releases stay on `master` and use ordinary tags such as `2.9.0`.
- `master` is the sole integration and release-source branch. All accepted code,
  tests, research/design docs, governance and release-tooling changes must enter
  and be verified on `master`, through PR merge or authorized direct commit,
  before they can reach BRAT or stable release.
- Work branches are optional isolation/review transport only; they are never a
  formal beta or stable source.
- BRAT beta releases use a matching beta branch and prerelease tag, for example
  branch `beta/2.9.0-beta.1` and tag `2.9.0-beta.1`.
- A `beta/<version>` branch is created from the exact verified `master` HEAD and
  is temporary packaging state. It may contain only the generated prerelease
  release commit and tag. Do not add product/docs fixes there or merge/rebase
  beta release commits back to `master`.
- Do not commit a beta `manifest.json` version to `master`. The released
  `manifest.json` asset must still match the beta tag exactly.
- `manifest-beta.json` remains in this repo for local deploy and older-tool
  compatibility, but current BRAT installs read GitHub Release assets:
  `main.js`, `manifest.json`, and `styles.css`.
- GitHub Releases created from prerelease tags are marked as prerelease by the
  release workflow.
- Stable changelog generation ignores prerelease tags by default, so the stable
  release notes still cover the full change range from the previous stable tag.

## Version Pattern

Use this sequence for a feature train:

| Channel | Example | Notes |
| --- | --- | --- |
| Current stable | `2.8.4` | Must already be tagged before release scripts can run. |
| Integration authority | `master` | Owns every accepted code/test/research/docs/tooling commit before beta packaging. |
| Optional work branch | `feature/pagelet-recall` | Review/transport only; merge by PR or authorized direct commit before beta. |
| First BRAT beta | `2.9.0-beta.1` | Cut `beta/2.9.0-beta.1` from the exact verified `master` HEAD. |
| Current BRAT beta | `2.9.0-beta.2` | Published prerelease; desktop and iPhone BRAT smoke completed on 2026-07-19. |
| Next BRAT beta | `2.9.0-beta.3` | Use only when beta feedback needs another build. |
| Stable graduation | `2.9.0` | Cut directly from verified `master`; beta release commits remain excluded. |

BRAT users who installed `2.9.0-beta.N` should use BRAT to update to the latest
release when the stable `2.9.0` ships. Do not rely on Obsidian's ordinary update
mechanism to move a prerelease install to the same final stable version.

## Create a BRAT Beta Release

First put all accepted work on `master`. PR merge and authorized direct commit
are both valid integration paths; neither permits a work branch to bypass
`master`. Refresh and verify the integration baseline before creating beta:

```bash
git status --short
git fetch origin master
git switch master
git pull --ff-only
git status --short
git rev-parse master
git rev-parse origin/master
git tag --list 2.8.4
```

If `git status --short` is not empty, stop before switching or creating the
beta branch. Commit, stash, clean, or explicitly confirm the intended dirty
worktree scope first.

The local and remote `master` hashes must also match before beta publication.
If local `master` is ahead, stop until pushing `master` is explicitly authorized;
do not use the beta push as a substitute for integrating the source branch.

If a work branch is involved, prove no accepted commit remains outside
`master` before packaging. For example:

```bash
git log --oneline master..feature/pagelet-recall
```

Any output means the branch still has commits not integrated into `master`.
Review them, then use a PR merge or authorized direct commit/merge before
continuing. Do not create beta from that work branch.

After the appropriate validation passes on `master`, create a temporary beta
packaging branch from its exact HEAD. The branch name must match the target
version:

```bash
git switch master
git switch -c beta/2.9.0-beta.1
git rev-parse master
git rev-parse HEAD
```

The two hashes must match before `make release`. The release script enforces
this invariant and rejects any beta-only code/docs commit.

Run the local gate that matches the scope. For broad beta builds, use the full
release gate:

```bash
make release-dry-run VERSION=2.9.0-beta.1
make release VERSION=2.9.0-beta.1
```

Publish only after the beta scope and validation evidence are accepted:

```bash
git status --short
git branch --show-current
node -p "require('./package.json').version"
git rev-parse 2.9.0-beta.1^{}
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse master
make publish VERSION=2.9.0-beta.1
```

Expected before publish:

- `git status --short` is empty.
- The current branch is `beta/2.9.0-beta.1`.
- `package.json` version is `2.9.0-beta.1`.
- `git rev-parse 2.9.0-beta.1^{}` equals `git rev-parse HEAD`.
- `git rev-parse HEAD^` equals `git rev-parse master`, with exactly one commit
  present on beta but not on `master`.
- `git rev-parse master` equals `git rev-parse origin/master`.

The publish script enforces the clean worktree, expected branch, matching
package/manifest versions, tag-to-HEAD, direct master parent, generated release
subject/file set and a live `origin/master` lookup. It pushes the beta branch +
tag atomically. The tag triggers the GitHub release workflow,
which accepts a normal post-preflight master advance only when the verified
release parent remains an ancestor, and independently verifies the matching
beta ref, metadata versions and exact packaging-only commit before uploading:

- `main.js`
- `manifest.json`
- `styles.css`
- `LICENSE`
- `NOTICE`
- `THIRD_PARTY_NOTICES.md`

BRAT installs only the plugin runtime assets. The legal assets are included for
GitHub Release provenance and exact-tag review.

## Verify the GitHub Release

After `make publish`, confirm the release object and asset set:

```bash
gh release view 2.9.0-beta.1 \
  --json tagName,name,isPrerelease,assets \
  --jq '{tagName,name,isPrerelease,assets:[.assets[].name]}'
```

Expected:

- `tagName` is `2.9.0-beta.1`.
- `name` is `2.9.0-beta.1`.
- `isPrerelease` is `true`.
- Assets include at least `main.js`, `manifest.json`, and `styles.css`.

Download the released manifest asset and confirm the runtime version matches
the tag:

```bash
manifest_dir="$(mktemp -d)"
gh release download 2.9.0-beta.1 --pattern manifest.json --dir "$manifest_dir" --clobber
MANIFEST_DIR="$manifest_dir" node -p "require(process.env.MANIFEST_DIR + '/manifest.json').version"
```

Expected manifest version: `2.9.0-beta.1`.

If `isPrerelease` is false for a tag containing `-`, stop and fix the release
workflow before inviting testers.

## Install with BRAT

In a test vault:

1. Install `Obsidian42 - BRAT` from Community Plugins.
2. Open the command palette.
3. Run `BRAT: Add a beta plugin for testing`.
4. Paste `https://github.com/edonyzpc/personal-assistant`.
5. For a deterministic test pass, freeze/select the target release tag, for
   example `2.9.0-beta.1`. For rolling dogfood, track the latest release.
6. After BRAT finishes, open Settings -> Community plugins.
7. Refresh the plugin list if needed.
8. Enable `Personal Assistant`.

For private or high-frequency testing, configure a GitHub token in BRAT settings
to avoid GitHub API rate limits.

## Smoke Gate

For every BRAT beta build, record at least:

- GitHub Release verification output.
- Desktop Obsidian install or update through BRAT.
- Plugin enable, reload, and basic Settings open.
- One Chat path and one Memory/Pagelet path relevant to the beta scope.
- Mobile BRAT install or update when the beta touches mobile-visible UI,
  storage, or platform behavior.

Do not claim BRAT validation unless the plugin was installed or updated through
BRAT from the published GitHub Release.

## Update a Beta

For another beta build on the same train, put every accepted fix on `master`
first, validate `master`, then cut a fresh packaging branch from its exact HEAD:

```bash
git fetch origin master
git switch master
git pull --ff-only
git rev-parse master
git rev-parse origin/master
git switch -c beta/2.9.0-beta.3
make release-dry-run VERSION=2.9.0-beta.3
make release VERSION=2.9.0-beta.3
make publish VERSION=2.9.0-beta.3
```

Then ask testers who froze `2.9.0-beta.2` to switch BRAT to `2.9.0-beta.3`, or
ask rolling testers to run BRAT update.

## Graduate to Stable

When beta blockers are closed:

1. Confirm every accepted beta fix already entered `master` through PR merge or
   authorized direct commit.
2. Keep beta release commits, beta tags and prerelease-only metadata out of
   `master`; they are immutable packaging history only.
3. Refresh and verify `master`, then run the stable release from it:

```bash
git switch master
git pull --ff-only
git branch --show-current
git status --short
make release-dry-run VERSION=2.9.0
make release VERSION=2.9.0
make publish VERSION=2.9.0
```

Expected before stable release: the current branch is `master`, the worktree is
clean, and all accepted code/tests/research/docs/tooling are already verified on
that exact `master` commit.

The stable release changelog should compare from the previous stable tag, not
from `2.9.0-beta.N`.

## Recovery

- If a beta is bad, put the fix on `master`; never patch only the beta branch.
- If no beta tag was published, recreate packaging from updated `master` only
  after explicitly authorizing replacement of local release state.
- If a beta is published and testers may have installed it, create a new beta
  branch/tag such as `2.9.0-beta.3` from updated `master` instead of deleting or
  rewriting the published tag.
- Do not delete, rewrite, or move beta tags without an explicit maintainer
  decision.
- If BRAT cannot see the release, verify that the GitHub Release exists, the
  asset names are exactly `main.js`, `manifest.json`, and `styles.css`, and the
  `manifest.json` version matches the release tag.

## Transition From The Previous Model

`2.9.0-beta.1` and `2.9.0-beta.2` remain immutable evidence of the workflow used
when they were published. Do not rewrite their branches, tags, Releases or
Archive records. The master-first source rule applies prospectively beginning
with the next beta.
