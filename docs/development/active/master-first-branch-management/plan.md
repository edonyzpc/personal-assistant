# Master-First Branch Management Delivery Plan

Document status: Approved
Updated: 2026-07-19
Work item: B-117
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Governance contract: [GOV-002](../../governance/gov-002-master-first-branch-and-beta-packaging.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

把用户选择的 `work branch → master → beta/stable` 路径固化为当前治理、Agent 操作契约和 fail-closed release gates。只改变 repo governance/tooling，不改变插件运行时或发布任何版本。

## Dependencies And Source Surface

- Authority: `AGENTS.md`, `docs/development/governance/`, `.agents/skills/pa-brat-beta-release/`.
- Operations: `docs/operations/brat-beta-testing.md`, `docs/operations/release-process.md`.
- Enforcement: `scripts/release.mjs`, `scripts/publish-release.mjs`, `.github/workflows/release.yml`.
- Tests: release/publish/changelog script Jest suites and docs checker.

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| 1. Authority | GOV-002 and active package establish master-first ownership | governance/indexes | docs reachability | contract current |
| 2. Operating contract | Agent and human runbooks use one branch flow | AGENTS/skill/operations/smoke wording | no old non-archive source path | docs aligned |
| 3. Enforcement | local release, publish and tag workflow fail closed | scripts/tests/workflow | focused Jest | guards pass |
| 4. Validation | validate docs, code quality and history boundary | focused gates/review | no P0-P2 | Validated; no closeout implied |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| Local `master` is stale | require explicit fetch/pull in runbook | source hash mismatch or workflow guard | refresh master before creating a new beta |
| Beta contains non-release work | exact `HEAD == master` release preflight | release focused negative test | move fix to master and recreate beta branch |
| Manual tag bypasses scripts | workflow verifies prerelease parent against `origin/master` | tag workflow failure | create a new correct beta; never rewrite published tag without approval |
| Historical beta evidence is rewritten | exclude Archive from policy rewrites | focused reference audit | revert current-doc overreach, keep archive provenance |

## Validation Strategy

- Focused tests: release, publish and changelog script suites.
- Type/lint/build gate: TypeScript check for shared repo confidence; no bundle build unless code gate reveals need.
- Obsidian smoke: N/A, no runtime/UI change.
- Real-device / community / release gate: N/A; no tag or publish authorized.

## Approval

- Plan authority: user direct engineering authorization.
- Approved on: 2026-07-19.
- Authorized implementation scope: master-first branch governance, release automation/tests, and current docs/skills; no push/tag/publish.
