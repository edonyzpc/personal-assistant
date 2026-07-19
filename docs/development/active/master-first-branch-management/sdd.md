# Master-First Branch Management Software Design Document

Document status: Approved
Updated: 2026-07-19
Work item: B-117
Authority: 本 track 的 source-verified implementation design、兼容性、风险与 test matrix。
Governance contract: [GOV-002](../../governance/gov-002-master-first-branch-and-beta-packaging.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

## Pre-Change Source Baseline

- `release.mjs` validated the `beta/<version>` name but not its source commit.
- `publish-release.mjs` validated branch/version/tag-to-HEAD but not the parent relationship with `master`.
- `release.yml` accepted any semantic tag without a master-source guard.
- BRAT skill/runbooks described development-branch-first beta packaging.

## Authority Flow

All accepted runtime, test, research/documentation and governance/tooling work enters `master` through a PR merge or authorized direct commit. Work branches are transport/review surfaces only. A beta branch starts at the exact verified `master` HEAD and becomes immutable packaging state after its release commit/tag is created.

## Release And Publish Gates

1. Before prerelease generation, require the matching `beta/<version>` branch and `HEAD == master`; operating guidance also requires local `master == origin/master` before publication.
2. Release tooling creates the only beta-only commit: the generated version/CHANGELOG/NOTICE metadata commit and annotated tag.
3. Before publish, require `tag == HEAD`, `HEAD^ == master`, one exact generated packaging commit, matching package/manifest versions and a live `origin/master == master`; push beta branch + tag atomically.
4. In GitHub Actions, require the prerelease first parent to remain an ancestor of freshly fetched `origin/master`, the remote beta ref to equal the tag commit, versions to equal the tag, and the commit to contain the complete packaging allowlist only.
5. Stable release behavior remains `master`-only.

## Interfaces And Ownership

- Local source checks: `scripts/release.mjs` and `scripts/publish-release.mjs`.
- Remote defense in depth: `.github/workflows/release.yml`.
- Human/Agent operating contract: GOV-002, `AGENTS.md`, BRAT skill and Operations runbooks.

## Lifecycle And Cleanup

Published beta branches/tags are immutable historical packaging records. Feedback creates ordinary commits on `master`; the next prerelease uses a new beta branch/version. No beta release commit is merged or rebased into `master`.

## Data, Privacy, Permission And Cost

No note data, provider call, runtime state or user-facing behavior changes. Git push/tag/publish remain separately authorized side effects.

## Compatibility, Migration And Rollback

- `2.9.0-beta.1` and `2.9.0-beta.2` keep their real historical topology and Archive evidence.
- The new gate applies prospectively beginning with the next beta.
- A branch that fails the source gate is not repaired by rebasing a published beta; changes first land in `master`, then a fresh beta branch is created.
- Rollback is limited to reverting this governance/tooling change on `master`; published tags remain untouched.

## Test Matrix

| Requirement / AC | Unit / integration | App smoke | Failure / fallback | Evidence target |
| --- | --- | --- | --- | --- |
| B-117/REQ-01 + B-117/REQ-05 / B-117/AC-01 | static docs/skill scans + docs check | N/A | old development-first phrase fails review | Tracker T-01 |
| B-117/REQ-02 / B-117/AC-02 | release script positive/negative fixture | N/A | beta with extra commit rejected | Tracker T-02 |
| B-117/REQ-03 + B-117/REQ-04 / B-117/AC-03 + B-117/AC-04 | publish fixture + workflow assertion | N/A | wrong parent/multiple commits rejected | Tracker T-03 |
| B-117/AC-05 | sibling-beta changelog regression + docs/diff checks | N/A | Archive left unchanged | Tracker T-04 |

## Open Design Findings

No open P0/P1/P2 findings. F-01/F-02 in the Tracker are closed by local preflight, live remote/package guards, atomic beta/tag push, remote workflow defense and aligned current contracts.

## Approval

- Design authority: user-selected master-first policy plus source audit on 2026-07-19.
- Approved on: 2026-07-19.
- Authorized implementation scope: release scripts/tests/workflow and current governance/operations/Agent documents; no runtime or release side effect.
