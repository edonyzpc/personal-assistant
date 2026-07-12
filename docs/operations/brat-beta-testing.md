# BRAT Beta Testing Process

This runbook defines how Personal Assistant beta builds are published for BRAT
testing without exposing prerelease versions through the stable Obsidian
community-plugin path.

Sources:

- BRAT developer guide: <https://tfthacker.com/brat-developers>
- BRAT user guide: <https://tfthacker.com/BRAT>

## Policy

- Stable releases stay on `master` and use ordinary tags such as `2.9.0`.
- Feature work stays on a development branch until it is ready for a PR.
- BRAT beta releases use a matching beta branch and prerelease tag, for example
  branch `beta/2.9.0-beta.1` and tag `2.9.0-beta.1`.
- A `beta/<version>` branch is a temporary packaging branch for BRAT release
  commits and tags. Do not merge beta release commits back to `master`.
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
| Development branch | `feature/pagelet-recall` | Owns feature commits and tests. |
| First BRAT beta | `2.9.0-beta.1` | Cut a temporary `beta/2.9.0-beta.1` packaging branch from the development branch. |
| Next BRAT beta | `2.9.0-beta.2` | Use when beta feedback needs another build. |
| Stable graduation | `2.9.0` | Cut from `master` after the approved development branch lands through PR. |

BRAT users who installed `2.9.0-beta.N` should use BRAT to update to the latest
release when the stable `2.9.0` ships. Do not rely on Obsidian's ordinary update
mechanism to move a prerelease install to the same final stable version.

## Create a BRAT Beta Release

Start from a development branch whose feature work and local tests are already
accepted for beta:

```bash
git status --short
git switch feature/pagelet-recall
git tag --list 2.8.4
```

If `git status --short` is not empty, stop before switching or creating the
beta branch. Commit, stash, clean, or explicitly confirm the intended dirty
worktree scope first.

If the named development branch is not present locally, use read-only discovery
before changing local branch state:

```bash
git branch --list feature/pagelet-recall
git branch -r --list origin/feature/pagelet-recall
```

Fetch or create a local tracking branch only after confirming that is the
intended source branch.

Create a temporary beta packaging branch from that development branch. The
branch name must match the target version:

```bash
git switch -c beta/2.9.0-beta.1
```

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
make publish VERSION=2.9.0-beta.1
```

Expected before publish:

- `git status --short` is empty.
- The current branch is `beta/2.9.0-beta.1`.
- `package.json` version is `2.9.0-beta.1`.
- `git rev-parse 2.9.0-beta.1^{}` equals `git rev-parse HEAD`.

The publish script enforces the clean worktree, expected branch, matching
package version, and tag-to-HEAD checks before it pushes the current beta branch
and tag. The tag triggers the GitHub release workflow, which uploads:

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

For another beta build on the same train, keep code fixes on the development
branch, then cut a fresh beta packaging branch from it:

```bash
git switch feature/pagelet-recall
git switch -c beta/2.9.0-beta.2
make release-dry-run VERSION=2.9.0-beta.2
make release VERSION=2.9.0-beta.2
make publish VERSION=2.9.0-beta.2
```

Then ask testers who froze `2.9.0-beta.1` to switch BRAT to `2.9.0-beta.2`, or
ask rolling testers to run BRAT update.

## Graduate to Stable

When beta blockers are closed:

1. Open a PR from the development branch to `master`.
2. Keep beta release commits, beta tags, and prerelease-only metadata out of the
   PR. The PR should carry the runtime/docs/test changes, not the
   `[release] v2.9.0-beta.N` commit.
3. After the PR is merged and `master` is verified, run the stable release from
   `master`:

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
clean, and the merged development branch has already been verified on `master`.

The stable release changelog should compare from the previous stable tag, not
from `2.9.0-beta.N`.

## Recovery

- If a beta is bad but not published, fix the branch and rerun the release.
- If a beta is published and testers may have installed it, publish a new beta
  tag such as `2.9.0-beta.2` instead of deleting or rewriting the tag.
- Do not delete, rewrite, or move beta tags without an explicit maintainer
  decision.
- If BRAT cannot see the release, verify that the GitHub Release exists, the
  asset names are exactly `main.js`, `manifest.json`, and `styles.css`, and the
  `manifest.json` version matches the release tag.
