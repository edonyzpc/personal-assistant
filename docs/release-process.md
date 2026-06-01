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
2. Verifies the target version is valid, greater than `package.json`, and not already tagged.
3. Verifies the current `package.json` version already has a local release tag, so the new changelog starts from the previous release instead of duplicating older entries.
4. Generates the `CHANGELOG.md` section from the latest semantic tag through `HEAD`.
5. Runs `git diff --check`, `npm test -- --runInBand --coverage`, `npm run lint`, `npm run build`, and `npm run audit:bundle`.
6. Updates `package.json`, `package-lock.json`, `manifest.json`, `manifest-beta.json`, `versions.json`, and `CHANGELOG.md`.
7. Creates `[release] vx.y.z, check the CHANGELOG.md for details`.
8. Creates annotated tag `x.y.z`.

Set `SKIP_CHECKS=1` or pass `--skip-checks` only when checks have already been run in the same workspace and no files changed afterward.

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

The GitHub workflow builds from the pushed tag and creates a GitHub Release with these assets:

- `main.js`
- `manifest.json`
- `styles.css`

The release workflow installs the Node version declared in `package.json`, builds and audits the bundle before staging those three files in `release-assets/`, generates GitHub artifact attestations for the same staged files, then uploads that exact asset set. `manifest-beta.json` may still be copied by local or beta deployment flows, but it is not a supported asset in the formal GitHub Release.

## Recovery

- If `make release` fails before the release commit, inspect `git status --short`, fix the issue, and rerun the command.
- If the release commit exists but the tag was not pushed, rerun `make publish VERSION=x.y.z`.
- If a tag was created incorrectly, do not delete or retag without an explicit maintainer decision.
