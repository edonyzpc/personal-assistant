# Master-First Branch Management Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-07-19
Work item: B-117
Authority: 本 track 的唯一执行状态、finding lifecycle、验证证据与 closeout readiness。
Governance contract: [GOV-002](../../governance/gov-002-master-first-branch-and-beta-packaging.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: implementation, focused validation and independent P0-P2 review complete.
- Next action: await explicit closeout/archive authorization; Git push/tag/publish remain separately unauthorized.
- Blocker / decision needed: none.
- Last verified behavior: local `master` owns accepted B-108 work and GOV-002 tooling; future beta creation requires exact master source, and publish fails closed on topology, live remote, metadata or packaging drift.

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-117/REQ-01 + B-117/REQ-05 / B-117/AC-01 | Governance, Agent and operations contract | [x] | AGENTS, GOV-002, BRAT skill/runbooks and smoke boundary agree; docs check 232 Markdown / 1501 links |
| T-02 | B-117/REQ-02 / B-117/AC-02 | Release source gate | [x] | Matching beta from master passes; beta-only code/docs commit is rejected |
| T-03 | B-117/REQ-03 + B-117/REQ-04 / B-117/AC-03 + B-117/AC-04 | Publish and workflow source gates | [x] | Live remote, direct parent, exact 7-file package, version, beta ref and workflow guards covered |
| T-04 | B-117/AC-05 | Historical compatibility and sibling-beta changelog | [x] | Sibling beta regression passes; beta.1/beta.2 Archive evidence unchanged; independent review found no P0-P2 |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P2 | Branch-name checks allowed beta code not present on `master`. | Exact master source, direct parent, live remote, package allowlist/version and remote defense. | 3 focused suites / 21 tests; independent automation review. | Closed |
| F-02 | P2 | Current skill/runbooks encoded development-first beta packaging. | Replace with master-first authority and keep Archive untouched. | Docs check and independent authority review. | Closed |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-07-19 | Baseline | source audit of scripts/tests/current docs | Fail by design | Existing gates validate names/tags, not master source; old runbooks point to development branches. |
| 2026-07-19 | B-117/AC-02..AC-05 | release/publish/changelog focused Jest | Passed | 3 suites / 21 tests, including beta-only commit rejection, live remote drift, metadata/file-set gates, atomic beta+tag push, sibling beta and stable metadata classification. |
| 2026-07-19 | B-117/AC-01 + AC-05 | `DOCS_CHECK_BASE=origin/master npm run docs:check`; old-current-wording scan | Passed | 232 Markdown files / 1501 links; historical beta records remain unchanged. |
| 2026-07-19 | Engineering quality | TypeScript, ESLint, Node syntax, workflow YAML and `git diff --check` | Passed | No runtime/build/app smoke required; changes are governance/release tooling only. |
| 2026-07-19 | Independent review | authority and release-guard agent lanes | Passed | Final review found no P0/P1/P2; TOCTOU semantics use live preflight + ancestor verification rather than an ineffective no-op master lease. |

## Governance Log

| Date | Decision | Impact |
| --- | --- | --- |
| 2026-07-19 | [GOV-002 master-first](../../governance/gov-002-master-first-branch-and-beta-packaging.md) | All accepted work lands on `master`; beta branches become packaging-only children of an exact master commit. |

## Closeout Readiness

- [x] Governance Contract 与实际行为一致。
- [x] Release tooling 与 Agent/Operations docs 一致。
- [x] Required focused review evidence 已记录；Obsidian smoke 不适用。
- [x] 无未解决项需要新增 Backlog。
- [ ] `closeout.md` 已记录信息 disposition。
- [x] Active Registry 与 Archive destination 已明确；尚未获得 closeout/archive 授权。
