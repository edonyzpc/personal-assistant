# Release Process

This project keeps release preparation inside the repository so a release can be repeated without relying on external notes or local agent skills.

## Commands

Preview a release without changing files:

```bash
make release-dry-run VERSION=1.6.6
```

Create the local release commit and annotated tag:

```bash
make release VERSION=1.6.6
```

Push the current branch and tag, then watch the GitHub Actions release workflow:

```bash
make publish VERSION=1.6.6
```

## What `make release` Does

`make release VERSION=x.y.z` runs `scripts/release.mjs`:

1. Verifies the working tree is clean.
2. Verifies the target version is valid, greater than `package.json`, and not already tagged. For prereleases, it also requires the matching `beta/<VERSION>` branch with pre-release `HEAD` exactly equal to local `master`.
3. Verifies the current `package.json` version already has a local release tag, so the new changelog starts from the previous release instead of duplicating older entries.
4. Generates the `CHANGELOG.md` section from the latest semantic tag through `HEAD`.
5. Runs `git diff --check`, `npm run check:third-party-notices`, `DOCS_CHECK_BASE=<current-version-tag> npm run docs:check`, `npm test -- --runInBand --coverage`, `npm run lint`, `npm run build`, and `npm run audit:bundle`.
6. Updates `package.json`, `package-lock.json`, `manifest.json`, `manifest-beta.json`, `versions.json`, `CHANGELOG.md`, and release-tag references in `NOTICE`.
7. Creates `[release] vx.y.z, check the CHANGELOG.md for details`.
8. Creates annotated tag `x.y.z`.

Set `SKIP_CHECKS=1` or pass `--skip-checks` only when checks have already been run in the same workspace and no files changed afterward.

## Release Gate Levels

Routine open-source client releases should stay lightweight. Every release
keeps the automated package/license, notice, documentation workflow, test,
lint, build, and bundle audit checks green. Dependency changes also require regenerating third-party notices
with `npm run generate:third-party-notices`.

The 2.8.0 AGPL migration has extra one-time checks for prospective licensing,
historical tag non-relicensing, contributor/template provenance, and the
explicit no-paid-behavior boundary. Those checks are migration-specific and are
not expected to repeat in full for every later open-source client release.

Future paid hosted services or commercial backends need their own service
launch gate for Terms, Privacy, billing, support/warranty, security, data
retention, entitlement systems, and commercial license terms. Do not mix that
future service gate into ordinary plugin release preparation.

## Changelog

The changelog generator is `scripts/changelog.mjs`. It excludes previous `[release] ...` commits and groups Conventional Commit subjects into:

- Features
- Fix
- Removed (Breaking)
- Improvements
- Docs
- Tests

To regenerate only the changelog section:

```bash
make changelog VERSION=1.6.6
```

## Publishing

`make publish VERSION=x.y.z` pushes both the current branch and the local release tag to `origin`, then uses `gh run watch --exit-status` to wait for `.github/workflows/release.yml`.

Before pushing, `scripts/publish-release.mjs` verifies:

- The working tree is clean.
- `VERSION` is a bare semantic version without a leading `v`.
- `package.json` version equals `VERSION`.
- Stable releases run from `master`.
- Prerelease versions run from the matching `beta/<VERSION>` branch.
- The local `VERSION` tag exists and points to `HEAD`.
- A prerelease `HEAD` is the only single-parent release commit above local
  `master`; additional or divergent beta commits are rejected.
- Prerelease package/manifest versions, generated release subject and exact
  packaging-file set match the tag; live `origin/master` matches local master.
- The prerelease beta branch and tag are pushed atomically after the live
  master preflight; normal later master advances remain valid only while the
  release parent is still in `origin/master` history.

For prereleases, the GitHub workflow independently refreshes `origin/master`,
requires the tagged release commit's parent to remain its ancestor and the
matching beta branch to agree, then repeats metadata-version plus exact
packaging-file checks before building the GitHub Release with these assets:

- `main.js`
- `manifest.json`
- `styles.css`
- `LICENSE`
- `NOTICE`
- `THIRD_PARTY_NOTICES.md`

The release workflow installs the Node version declared in `package.json`, checks runtime dependency and bundled resource notices, builds and audits the bundle before staging those six files in `release-assets/`, generates GitHub artifact attestations for the same staged files, then uploads that exact asset set. `manifest-beta.json` may still be copied by local or beta deployment flows, but it is not a supported asset in the formal GitHub Release.

`THIRD_PARTY_NOTICES.md` covers both npm runtime dependencies and bundled `skills/**` Markdown resources that are inlined into `main.js`. When runtime dependencies change, run `npm run generate:third-party-notices` and then `npm run check:third-party-notices`. When adding, removing, or adapting bundled skills, update that notice table and keep `npm run check:third-party-notices` green.

Obsidian's community plugin installer and updater install only the standard runtime files: `main.js`, `manifest.json`, and `styles.css`. Legal documents are therefore distributed as GitHub Release assets and exact-tag source files, and the plugin Settings Legal section links to the exact release tag for source, license, and notices. `TRADEMARKS.md` is available through the exact release tag and is linked from `NOTICE`, but it is not part of the formal release asset set.

Starting with version `2.8.0`, release notes for license and compliance releases must state that the client source is `AGPL-3.0-only` starting with that version, that historical releases are not relicensed retroactively, and that the release does not introduce an account system, license key, checkout flow, feature lock, hosted commercial service, or paid entitlement check unless a future release explicitly says otherwise. `scripts/release.mjs` includes this statement in the generated `2.8.0` changelog section and annotated tag body, and the GitHub workflow publishes the tag body through `--notes-from-tag`.

## BRAT Beta Testing

Use [BRAT beta testing](./brat-beta-testing.md) for prerelease builds intended
for Obsidian BRAT testers.

Key constraints:

- Cut BRAT beta releases from the matching branch name, for example
  `beta/2.9.0-beta.1` for version `2.9.0-beta.1`; do not commit a beta
  `manifest.json` version to `master`. The release and publish scripts enforce
  the matching beta branch for prerelease builds.
- Treat `master` as the sole integration and release-source branch. All accepted
  code, tests, research/docs and governance/tooling changes must enter and be
  verified on `master` through PR merge or authorized direct commit first.
- Treat `beta/<version>` as a temporary packaging branch cut from the exact
  verified `master` HEAD. It may contain only the generated prerelease release
  commit/tag. Do not merge beta release commits back to `master`; beta feedback
  fixes land on `master` before a new beta branch/version is created.
- Before prerelease publish, local `master` must equal `origin/master`; the
  GitHub workflow rejects a prerelease whose release parent is not the current
  remote `master` commit.
- Use prerelease tags such as `2.9.0-beta.1`. The tag, GitHub Release title,
  and released `manifest.json` version must match.
- The release workflow marks tags containing `-` as GitHub prereleases.
- Current BRAT installs use GitHub Release assets, not `manifest-beta.json`.
  Keep `manifest-beta.json` only for local deploy and older-tool
  compatibility.
- Stable changelog generation ignores prerelease tags by default, so `2.9.0`
  can still use the previous stable tag as its changelog baseline after
  `2.9.0-beta.N` testing.

## Recovery

- If `make release` fails before the release commit, inspect `git status --short`, fix the issue, and rerun the command.
- If the release commit exists but the tag was not pushed, rerun `make publish VERSION=x.y.z`.
- If a tag was created incorrectly, do not delete or retag without an explicit maintainer decision.
