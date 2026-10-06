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
- Beta and stable release gates use `npm run docs:check:release` for public and
  release-critical documents only. Full lifecycle `docs:check` findings remain
  regular-CI/documentation work and do not block publication.
- Stable changelog generation ignores prerelease tags by default, so the stable
  release notes still cover the full change range from the previous stable tag.
- Beta publication follows completed functionality acceptance on `master`.
  Normal packaging reuses successful full master CI for the exact source parent;
  tag CI builds and checks artifacts, packaging, release docs and legal assets.
  Missing or invalid evidence falls back to the full gate. Stable releases use
  the same evidence rules in [Release Process](./release-process.md).
  This replaces the former full-test and app-smoke default for every beta.

## Version Pattern

The table below is the historical `2.8.4 → 2.9.0` feature-train example, not a
claim about the latest stable or Beta release. At this document's 2026-10-06
reconciliation, the local repository package/manifest baseline is `2.9.2`;
that alone does not establish remote publication, installed-build behavior, or
the latest available Beta. Choose a target greater than the current local
package version and substitute it consistently in the branch, commands, tag,
and expected results below.

| Channel | Example | Notes |
| --- | --- | --- |
| Historical stable baseline | `2.8.4` | The actual current package version must already be tagged before release scripts can run. |
| Integration authority | `master` | Owns every accepted code/test/research/docs/tooling commit before beta packaging. |
| Optional work branch | `feature/pagelet-recall` | Review/transport only; merge by PR or authorized direct commit before beta. |
| First BRAT beta | `2.9.0-beta.1` | Cut `beta/2.9.0-beta.1` from the exact verified `master` HEAD. |
| Historical BRAT beta | `2.9.0-beta.2` | The recorded desktop/iPhone BRAT smoke is dated 2026-07-19; it is not new validation. |
| Example next BRAT beta | `2.9.0-beta.3` | Illustrates another build on that historical train. |
| Stable graduation | `2.9.0` | Cut directly from verified `master`; beta release commits remain excluded. |

When graduating a prerelease install to the final stable version, BRAT users
should use BRAT to select the intended release. The historical example is
`2.9.0-beta.N → 2.9.0`; do not rely on Obsidian's ordinary update mechanism to
perform that transition.

## Create a BRAT Beta Release

First put all accepted work on `master`. PR merge and authorized direct commit
are both valid integration paths; neither permits a work branch to bypass
`master`. Refresh and verify the integration baseline before creating beta:

```bash
git status --short
git fetch origin master
git switch master
git pull --ff-only
git rev-list --left-right --count master...origin/master
```

If `git status --short` is not empty, stop before switching or creating the
beta branch. Commit, stash, clean, or explicitly confirm the intended dirty
worktree scope first.

Require both counts to be zero before creating the beta branch. If local
`master` is ahead, stop preparation until pushing it is explicitly authorized
and the refs match; any other mismatch also stops preparation. A successful
`git pull --ff-only` alone does not exclude local commits ahead of origin.

Keep this single preparation check: `make release` verifies local `HEAD == master`
but treats live master mismatch as unavailable CI evidence and runs full local
checks; `make publish` performs the live synchronization hard gate later. Trust
the scripts' remaining baseline-tag, source-parent, version and packaging
checks without manually repeating them. A beta push does not integrate master.

If a work branch is involved, prove no accepted commit remains outside
`master` before packaging. For example:

```bash
git log --oneline master..feature/pagelet-recall
```

Any output means the branch still has commits not integrated into `master`.
Review them, then use a PR merge or authorized direct commit/merge before
continuing. Do not create beta from that work branch.

Create a temporary beta packaging branch from the clean, synchronized master
HEAD. `make release` selects exact-master CI reuse or full local validation;
do not run an extra full gate first. The branch name must match the target version:

```bash
git switch master
git switch -c beta/2.9.0-beta.1
```

The release script enforces `HEAD == master` and rejects any beta-only
code/docs commit.

Run the release command once. It first looks for a successful full master CI
for the exact source SHA, then falls back to full local checks if evidence is
unavailable. Reuse keeps local diff/notice/release-doc checks and the independent
final-tag build/packaging/artifact checks. Tag CI independently verifies full
master CI for the exact source parent; missing or invalid evidence uses the
full gate. See [CI reuse conditions](./release-process.md#release-preparation-reuse-exact-master-ci).

```bash
make release-dry-run VERSION=2.9.0-beta.1
make release VERSION=2.9.0-beta.1
```

For a deliberately local full gate, use
`RELEASE_LOCAL_CHECKS=1 make release VERSION=2.9.0-beta.1`. Do not use
`SKIP_CHECKS` to simulate CI reuse. Dry-run does not query CI or run tests.

Publish only after the beta scope and validation evidence are accepted:

```bash
make publish VERSION=2.9.0-beta.1
```

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
  --json tagName,name,isDraft,isPrerelease,assets \
  --jq '{tagName,name,isDraft,isPrerelease,assets:[.assets[].name]}'
```

Expected:

- `tagName` is `2.9.0-beta.1`.
- `name` is `2.9.0-beta.1`.
- `isPrerelease` is `true`.
- `isDraft` is `false`, and the tag release workflow completed successfully.
- Assets include `main.js`, `manifest.json`, `styles.css`, `LICENSE`, `NOTICE`,
  and `THIRD_PARTY_NOTICES.md`.

Download the released manifest asset and confirm the runtime version matches
the tag:

```bash
manifest_dir="$(mktemp -d)"
gh release download 2.9.0-beta.1 --pattern manifest.json --dir "$manifest_dir" --clobber
MANIFEST_DIR="$manifest_dir" node -p "require(process.env.MANIFEST_DIR + '/manifest.json').version"
```

Expected manifest version: `2.9.0-beta.1`.

The default completion check downloads only `manifest.json`. Downloading all
assets for local hashes or `node --check` is optional for an explicit request
or a concrete download/package incident; the release workflow already builds,
audits and attests the published assets. Always wait for download completion
before reading or validating a file. Asset verification proves publication;
claim BRAT installation validation only when the triggered smoke below ran.

Reuse a normal successful push receipt. Recheck remote refs only when the
result is ambiguous, another change may have raced, or the next action needs
current remote state; the scripts and workflow retain their own live checks.

Report timing as local preparation, remote tag gate and post-publish checks.
Do not add polling/sleep durations to the tests they overlap. Report meaningful
step changes or blockers; avoid repeating an unchanged test status. If a host
requires periodic updates, keep unchanged updates brief and do not start extra
checks merely to fill the wait.

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

Normal packaging beta uses the completed master functionality acceptance and
GitHub Release verification. Do not repeat local deployment, Obsidian/BRAT
Chat or Memory/Pagelet interactions, or mobile smoke merely to publish it.

Run targeted install/app/device smoke only for installation or asset layout,
plugin ID or platform changes; a concrete download, load or upgrade failure;
or an explicit request. Select evidence for that trigger: BRAT install/update,
enable/reload and Settings for an installation change; the affected interaction
for a load/runtime issue; mobile only for the affected platform or request.
New runtime fixes complete their master functionality acceptance before release.

Do not claim BRAT validation unless the plugin was installed or updated through
BRAT from the published GitHub Release.

## Update a Beta

For another beta build on the same train, put every accepted fix on `master`
first, then cut a fresh packaging branch from its exact synchronized HEAD and
let `make release` validate or reuse that source:

```bash
git fetch origin master
git switch master
git pull --ff-only
git rev-list --left-right --count master...origin/master
```

Continue only when both counts are zero and the worktree is clean, as in the
preparation flow above. Run only the release stages already authorized:

```bash
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
