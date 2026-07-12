# Contributing

Thank you for contributing to Personal Assistant. This repository accepts
issues, documentation fixes, tests, and code changes through GitHub pull
requests.

## License And CLA

Starting with version 2.8.0, Personal Assistant is licensed under
AGPL-3.0-only. Contributions submitted after the 2.8.0 license migration are
accepted under the contributor license agreement in CLA.md.

By opening a pull request, you confirm that:

- you have read and accepted CLA.md for the contribution
- you have the right to submit the contribution
- the contribution may be published under AGPL-3.0-only
- the maintainer may also relicense or dual-license the contribution for
  commercial distribution, hosted services, support, or other future product
  packaging

The CLA is prospective. It does not retroactively change the license notices
on historical tags or releases.

Issue comments, issue attachments, chat snippets, and informal suggestions are
not accepted as mergeable contributions unless the maintainer asks for a pull
request or another explicit CLA-accepted submission channel.

## Third-Party Code

Do not submit code, assets, prompts, generated files, or snippets copied from
third-party projects unless their license is compatible and the attribution is
included. When adding or changing runtime dependencies, update
THIRD_PARTY_NOTICES.md and run:

```bash
npm run check:third-party-notices
```

## Development

Use the repository-local development commands documented in AGENTS.md and
docs/operations/release-process.md. Product requirements, discussions,
decisions, specs, active development, closeout, archive, and deletion follow
docs/development/documentation-workflow.md; external issues are mirrors, not the
only source of project truth. For broad runtime or packaging changes, run the
release gate checks before asking for review:

```bash
npm test -- --runInBand
npm run lint
npm run build
npm run docs:check
git diff --check
```

## Pull Request Checklist

The pull request template includes the required compliance checklist. A PR
cannot be merged for a release if the CLA, third-party code, or license impact
items are not answered.
