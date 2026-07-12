# 2.8.0 License Migration Sign-Off (Historical)

This document records the one-time release-blocking checks for the Personal
Assistant 2.8.0 migration to AGPL-3.0-only.

## Current Status

| Field | Value |
| --- | --- |
| Status | Historical one-time migration record |
| Migration release | `2.8.0`, published 2026-06-21 |
| Current repo baseline at last doc refresh | `2.8.4` |
| Current release gate | [Release process](../operations/release-process.md) |
| Future commercial gate | Separate Terms, privacy, billing, entitlement, hosted-service security, and counsel review before any paid hosted service or commercial relicensing |

This file is not the current release checklist. Use the release process for
normal releases. Use this document only for evidence and boundary decisions from
the 2.8.0 license migration.

## Scope

- 2.8.0 was the prospective license migration for the client source.
- Historical releases, tags, and distributed artifacts are not relicensed
  retroactively.
- Public docs must say "starting with version 2.8.0" and must not make global
  claims that old versions were under any specific license unless each tag is
  verified.
- 2.8.0 does not introduce an account system, license key, checkout flow,
  feature lock, hosted commercial service, or paid entitlement check.

## Historical Maintainer Sign-Off Outcome

The items below were one-time migration gates for publishing 2.8.0. Because
2.8.0 and later patch releases have shipped, `[x]` here means the gate was
accepted for the historical migration or explicitly carried into the future
commercial-service gate. This 2026-06-28 doc refresh did not re-run legal review
or regenerate release artifacts.

- [x] Root `LICENSE`, `package.json`, `package-lock.json`, README files,
      release docs, NOTICE, Settings links, and release notes consistently say
      AGPL-3.0-only starting with version 2.8.0.
- [x] `NOTICE`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`,
      and `CLA.md` have been reviewed.
- [x] Contributor provenance, CLA terms, trademark language, and future
      commercial Terms assumptions have maintainer sign-off. Formal counsel
      review remains required before launching paid hosted services,
      commercial support, or commercial relicensing.
- [x] Third-party runtime dependency notices have been regenerated with
      `npm run generate:third-party-notices` and pass
      `npm run check:third-party-notices`.
- [x] Bundled `skills/**` Markdown resources have provenance rows in
      `THIRD_PARTY_NOTICES.md`, including the reference note for skill
      resources whose topic areas were informed by `kepano/obsidian-skills`.
- [x] GitHub Release assets and attestations include `main.js`,
      `manifest.json`, `styles.css`, `LICENSE`, `NOTICE`, and
      `THIRD_PARTY_NOTICES.md`.
- [x] Release notes state that Obsidian installs only `main.js`,
      `manifest.json`, and `styles.css`; legal docs are available through the
      exact release tag and release assets.

## Gate Levels

The 2.8.0 migration separates routine release checks from one-time legal
migration checks and future commercial-service checks.

### Every Release

- Keep package metadata, root `LICENSE`, `NOTICE`, and
  `THIRD_PARTY_NOTICES.md` present and internally consistent.
- Run `npm run check:third-party-notices`; regenerate with
  `npm run generate:third-party-notices` only when runtime dependencies change.
- Run the normal release validation path: `git diff --check`, tests, lint,
  build, and bundle audit.
- Confirm release assets include `main.js`, `manifest.json`, `styles.css`,
  `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`.

### 2.8.0 Migration Only

- Confirm the AGPL-3.0-only migration is prospective and starts with version
  2.8.0.
- Confirm historical tags and artifacts are not relicensed retroactively.
- Confirm current contributor, template/sample, bundled skill, and project-local
  agent-skill provenance has been reviewed for the migration.
- Confirm 2.8.0 introduces no paid behavior, account system, checkout, license
  key, entitlement check, feature lock, or hosted commercial service.

### Future Commercial Services Only

- Draft and review Terms of Service, Privacy Policy, billing/refund/tax flows,
  hosted-service security posture, data retention, support/warranty terms, and
  entitlement systems.
- Review any closed-source backend, paid hosted service, commercial dual
  license, or enterprise/support contract with formal counsel before launch.

## Contribution Provenance Audit

The following author summary was generated from local git history with
`git shortlog -sne --all` during migration implementation. It is evidence for
review triage, not a legal conclusion:

| Commits | Author |
| ---: | --- |
| 1015 | edonyzpc <edonyzpc@yahoo.com> |
| 196 | renovate[bot] <29139614+renovate[bot]@users.noreply.github.com> |
| 44 | edony <edonyzpc@yahoo.com> |
| 26 | lishid <lishid@gmail.com> |
| 4 | Lishid <lishid@gmail.com> |
| 3 | dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com> |
| 2 | Federico Granata <3602209+Edo78@users.noreply.github.com> |
| 1 | Clemens Ertle <clemensertle@gmail.com> |
| 1 | GitMurf <64155612+GitMurf@users.noreply.github.com> |
| 1 | Henre Botha <henrebotha@gmail.com> |
| 1 | Konstantin <kostapc@gmail.com> |
| 1 | Maciej Beimcik <32768449+taurelas@users.noreply.github.com> |
| 1 | Phillip <bronzel.phillip@gmail.com> |
| 1 | TfTHacker <69121180+TfTHacker@users.noreply.github.com> |
| 1 | Tokuhiro Matsuno <tokuhirom@gmail.com> |
| 1 | Xiao Meng <novoreorx@gmail.com> |
| 1 | admin <admin@4t6lkzcje8xuc4c.CN-HANGZHOU-198-14-1.WUYING.LOCAL> |
| 1 | aidenlx <31102694+aidenlx@users.noreply.github.com> |
| 1 | fyears <1142836+fyears@users.noreply.github.com> |
| 1 | fyears <fyears@users.noreply.github.com> |
| 1 | google-labs-jules[bot] <161369871+google-labs-jules[bot]@users.noreply.github.com> |
| 1 | pengchen.zpc <pengchen.zpc@antfin.com> |
| 1 | pseudometa <73286100+chrisgrieser@users.noreply.github.com> |

Release blocker: non-owner human contributions must be reviewed before the
2.8.0 release is published. The review should decide whether each contribution
is owned by the maintainer, independently licensed with compatible terms,
trivial, removable, replaceable, or requires explicit permission.

## Template And Sample Provenance

The project history includes Obsidian community-plugin conventions and archive
references to the Obsidian sample plugin. Before publishing 2.8.0, the
maintainer must confirm that any retained template-derived material is
compatible with the prospective AGPL-3.0-only migration and is properly
attributed where required.

The runtime bundle also includes selected `skills/**` Markdown resources. The
2.8.0 notice gate treats those files as bundled resources, not only docs.
`THIRD_PARTY_NOTICES.md` must classify every bundled skill resource as
project-authored or externally adapted, and must preserve the runtime
dependency license/notice appendix generated from the production dependency
closure. The three read-only Obsidian-format skill resources were added in
`e1bb701 feat(pa-agent): add canonical runtime and capabilities`; their shipped
text is PA project-authored and tailored to the read-only PA Agent runtime. The
`kepano/obsidian-skills` repository remains recorded as reference material for
topic-area provenance, not as copied bundled text. Future bundled skill or
runtime dependency additions must update the notice table/appendix and pass
`npm run check:third-party-notices`.

Project-local agent skills under `.agents/skills/**`, including
`pa-linear-product-manager`, are source-side development and planning tools.
They are included in the repository source distribution under the project
license unless a file states otherwise, but they are not Obsidian runtime
assets and are not bundled into `main.js`.

## Commercialization Boundary

The planned commercial direction uses tiered packaging, but 2.8.0 only sets a
lightweight legal and compliance foundation for an open-source client release.
It must not ship paid behavior. This document intentionally avoids naming
external commercial products because they are only market references, not code,
license, or implementation sources for Personal Assistant.

The current product planning split is:

| Layer | Timing | Scope | 2.8.0 status |
| --- | --- | --- | --- |
| Free | Current and future baseline | Local client use, BYOK provider setup, basic chat, Memory search, and vault search. | Must remain usable without an account, checkout, license key, hosted service, or paid entitlement check. |
| Plus Lite / Premium Lite | First paid experiment after 2.8.0 | BYOK plus advanced local/client workflows such as Web Search, Write, Skills, Pagelet, and Memory Extraction. This keeps backend cost low while testing willingness to pay. | Future only. Do not add gates, pricing, license checks, or entitlement copy in 2.8.0. |
| Hosted Plus / Premium | Later, after demand validation | Managed model access, hosted compute, usage credits, account-bound convenience features, and higher-cost provider workflows. | Future only. Requires separate service Terms, privacy review, billing flow, entitlement backend, and service reliability plan. |
| Self-host / Supporter / Enterprise | Later packaging option | Self-hosted deployment, longer-term support, warranty, commercial dual-license terms, and enterprise support. | Future only. Requires formal counsel review before launch. |

Version 2.8.0 is not the paid-services release. It introduces no account
system, license key, checkout flow, feature lock, hosted commercial service, or
paid entitlement check. Public 2.8.0 copy may describe future paid services only
as future possibilities, not as available features or active entitlements.

The prospective CLA keeps future relicensing and dual-licensing options open.
Separate future Terms may govern hosted services, support, warranty, privacy,
trademarks, and marketplace identity. Those Terms must not add restrictions to
AGPL client rights to use, modify, or redistribute the 2.8.0 client source.

Future paid client-side feature gates need a separate design review. Because
the 2.8.0 client source is AGPL-licensed, the defensible commercial moat should
come from hosted services, support, brand/trademark control, release channel
trust, warranty, and commercial licensing rather than from assuming forks cannot
modify AGPL client code.

## Rejected License Alternative: BUSL-1.1

Business Source License 1.1, sometimes abbreviated as BSL or BUSL, was reviewed
as a stronger commercial-control alternative. It is not selected for the 2.8.0
migration.

BUSL-1.1 can restrict production or commercial use more directly than AGPL. That
could reduce the risk of a third party copying the client source and operating a
competing commercial distribution without permission.

The tradeoff is not acceptable for 2.8.0:

- BUSL-1.1 is source-available, not open source.
- It would require project-specific definitions for permitted use, production
  use, commercial use, the change date, and the eventual change license.
- It would increase legal review burden before release.
- It could create avoidable trust and distribution friction for an Obsidian
  community plugin.
- It would change the migration from an open-source copyleft move into a
  source-available commercial licensing move.

Decision: keep `AGPL-3.0-only` for 2.8.0. Revisit BUSL-1.1 only if Personal
Assistant intentionally changes from an open-source client project to a
source-available commercial software strategy.
