# Reusable Refactor Workflow

This workflow captures the repeatable process used for the vault-native Chat Agent refactor. Use it for future repo-scale refactors that need design control, phased implementation, subagent review, Obsidian smoke validation, commits, and release.

## When To Use

Use this workflow when a change:

- Touches runtime architecture, product behavior, data/privacy boundaries, provider rollout, release packaging, or Obsidian UI behavior.
- Needs multiple phases instead of a single narrow fix.
- Requires real behavior validation in the test vault.
- Has risks that should be tracked across dev, test, review, fix, and smoke loops.

For a one-file bug fix, use the normal focused review/fix/test/commit path instead.

## Core Rule

Each active phase follows this loop until confirmed P2/P1/P0 issues are closed or explicitly deferred:

```text
dev -> test -> review -> fix -> Obsidian smoke test -> fix
```

Do not mark a phase done just because code compiles. A phase is done only when the tracker, tests, review findings, smoke evidence, and risk table agree with the actual behavior.

Apply [Proportionate Design And Delivery](../../../AGENTS.md#proportionate-design-and-delivery).
The loop describes responsibilities, not a requirement to rerun every step after
every edit. Reuse valid evidence; repeat affected steps for changed inputs or a
concrete unresolved risk. Required integration, device, CI and release gates remain
binding. Deliver when the scoped exit conditions are met rather than opening
another round for speculative improvements.

## Artifacts

Create or update these artifacts at the start:

- `docs/development/active/<feature>/README.md` as the one-page track home.
- `docs/development/active/<feature>/tracker.md`.
- `docs/backlog.md` for follow-up items that should not reopen the active tracker.

Repo-scale refactors normally justify `plan.md` because delivery is phased/risky and `sdd.md` because module/lifecycle/compatibility design is non-trivial；若实际范围不满足这些条件，不为形式完整补造文件。存在 SDD 时，实现前必须 Approved。

Use the canonical [documentation templates](../templates/README.md) and register the package in [Active Development Registry](../active/README.md). Do not create new plan/tracker files in the `docs/` root.

Keep roles separate:

- Product Spec: source of truth for user behavior, product scope and acceptance criteria.
- Feature Home: owning contract 与 Tracker 的简短路由入口，不复制状态。
- Plan doc: source of truth for boundaries, phased delivery and validation strategy.
- SDD: source of truth for this implementation design, compatibility, rollback and test matrix.
- Tracker doc: the only delivery/execution status authority, plus test evidence, review findings, smoke results, risks, and decisions. Feature Home and Active Registry are link-only.
- Backlog: deferred cleanup or future milestones outside the active implementation track.
- Archive docs: historical evidence only, never the current source of truth.

## Phase Setup

PA Agent/runtime/command refactors follow the [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract).
Establish the responsibility/interaction contract and workflow obligations before
shared-framework changes, then migrate domain commands. Record phase-specific
owners and factual admission bases in the existing SDD or task record; do not mix domain behavior changes
into a framework-only phase or treat passing tests as responsibility acceptance.

Each phase should define:

- Goal.
- Owner files/modules.
- Deliverables.
- Explicit out-of-scope items.
- Exit gate.
- Required focused tests.
- Required broad checks.
- Obsidian smoke matrix if runtime/UI behavior changes.
- Risks and rollback/fallback behavior.

Use status markers consistently:

```text
[ ] Todo
[~] In progress
[x] Done
```

Avoid leaving `[~]` in historical evidence rows after the overall track is complete unless it truly means work remains active.

## Development Loop

1. Read `AGENTS.md`, the active plan, tracker, nearby code, and relevant tests.
2. Record the phase as `[~] In progress`.
3. Implement one behavior slice at a time.
4. Prefer existing module boundaries and helper APIs.
5. Update affected behavior tests with the implementation; do not add tests solely for mechanical edits or wording.
6. Run the relevant focused checks first, reusing unchanged valid evidence.
7. Update Tracker and any affected Plan/SDD to match verified behavior；Feature Home only changes when routing or scope boundary changes.

For risky paths, keep fallback behavior working before enabling the new path by default.

When a phase has a concrete uncertainty across modules, a platform adapter, or
a business flow, use the smallest probe through the real factory or call chain
to answer it before expanding implementation or running the expensive gate.
Local mocks cannot settle that integration question. Repeated counterexamples
from the same mechanism call for revisiting that mechanism before another
patch; record the finding in the existing Tracker. This checkpoint does not
replace the phase's required tests or deployed Obsidian smoke.

## Review Loop

Scope review and subagent participation to the phase's concrete risks, reusing
findings for unchanged areas. Preserve the independent review requirements in
[GPT-6 And GLM Delivery](../../../AGENTS.md#gpt-6-and-glm-delivery).

Choose review responsibilities for the phase's actual risks; the following
split is a reference, not four mandatory roles for each small slice:

- Runtime/architecture reviewer: call path, lifecycle, fallback, source boundaries.
- Product/safety reviewer: user-visible behavior, privacy, permission, trust model.
- Testing/QA reviewer: coverage gaps, smoke coverage, tracker evidence.
- Docs/tracker reviewer: stale status, contradictory source-of-truth claims.

Only confirmed P2/P1/P0 findings require immediate resolution or explicit deferral.
Check their trigger, consequence and violated requirement before changing code;
reviewer preferences and unconfirmed concerns are not blockers. For model behavior,
apply [Agent Behavior Acceptance](../../../AGENTS.md#agent-behavior-acceptance).
Keep requested follow-up work in the existing Backlog with its source link; do not
automatically turn every polish suggestion into a new task.

After fixes, re-review the changed area or at least re-check the specific finding against the live diff.

Use the current [review skill](../../../.agents/skills/personal-assistant-review/SKILL.md) for independent maintainability and probe checks. Follow [Multi-Agent Validation Coordination](../../../AGENTS.md#multi-agent-validation-coordination): assign disjoint edit ownership, return focused evidence, and let the main agent schedule expensive gates against frozen inputs. Review lanes do not each repeat full validation or edit the candidate while its final gate runs.

## Test Strategy

Select focused suites from the phase's requirements, changed behavior, and concrete risks before running them. These are alternative entry points, not a sequence of required commands:

| Changed surface | Focused entry point |
| --- | --- |
| Source behavior | `npm test -- --runInBand <suites>`; no `dist/` prerequisite |
| Tooling or fixtures | `npm run test:tooling -- --runInBand <suites>` |
| Build-bound receipts or probes | `npm run test:artifacts -- --runInBand <suites>`; build first if the production assets are absent or stale |
| Docs or skill instructions only | `npm run docs:check`, affected existing contract suites, and `git diff --check`; no plugin build or smoke unless executable or runtime assets change |

Follow [AGENTS.md — Validation Planning And Reuse](../../../AGENTS.md#validation-planning-and-reuse) for scope, evidence, and rerun decisions, the [Local Validation Gate](../../../AGENTS.md#local-validation-gate) for code/DOM checks, and [Test Failure Diagnosis](../../../AGENTS.md#test-failure-diagnosis) when a check fails. Do not add tests for low-impact wording or mechanically mirror the implementation.

For broad behavior, shared runtime, release, packaging, or rollout changes, the standalone gate is:

```bash
npm run lint
npm run build
npm run test:all -- --runInBand
git diff --check
```

If `make deploy` will run this gate for the same inputs, use its lint/build/full-Jest results instead of running them separately again; still record the diff check and required behavior-specific evidence. A production build already includes TypeScript checking. Source, test, or configuration changes invalidate the evidence they affect; resolve that impact before reusing results. Required phase acceptance, device smoke, CI, and release gates remain in force under [GOV-002](../governance/gov-002-master-first-branch-and-beta-packaging.md#proportional-validation-and-deployment).

For dependency or lockfile changes, add:

```bash
npm ci --dry-run
```

## Obsidian Smoke

Run Obsidian smoke when runtime/UI behavior changes.

Default setup runs platform guards, lint, a production build, and full Jest once before copying assets:

```bash
make deploy
obsidian "obsidian://open?vault=test&file=<encoded-path>"
```

When the required checks already passed for the current changes and the production build is current, use `make deploy-current` for the copy step instead. It verifies build identity and asset content, not test success; apply the [Local Deployment](../../../AGENTS.md#local-deployment) reuse conditions. This does not replace the actual app interaction or any required device smoke.

Then reload the test vault or plugin and verify the exact behavior in Obsidian.

Record:

- Prompt or user action.
- Visible Thinking/status sequence.
- Final answer or UI state.
- Whether fallback appeared.
- Any cleanup performed.
- Why smoke was skipped, if docs-only.

Do not claim Obsidian validation unless it was actually deployed and observed in the app.

## Rollout Pattern

For provider, backend, or high-risk runtime rollouts, select safeguards for the
actual compatibility, privacy, or recovery risks. The following are reference
strategies, not a mandatory sequence:

- Use an activation gate when controlled enablement or rollback is needed.
- Retain the old path as fallback when the approved compatibility or recovery
  requirements need it and that path remains safe to use.
- Add diagnostics only when existing observations cannot answer a concrete
  rollout question; keep diagnostic metadata redacted.
- Select focused tests for affected unsupported combinations, source boundaries,
  or observation equivalence. Reuse valid evidence rather than adding every test type.
- Use a canary or staged rollout when the specific rollout risk requires it;
  do not add a hidden execution path merely to follow this pattern.

Existing acceptance, app smoke and release gates still apply. Promote only a
validated tuple/configuration to default; where the approved design includes a
fallback, keep unverified combinations on it. Update existing Plan/Tracker records
to reflect the actual rollout state, without creating extra rollout artifacts.

## Commit Strategy

Commit after coherent milestones, not after every tiny edit.

Use small Conventional Commits:

```text
docs(<scope>): ...
feat(<scope>): ...
fix(<scope>): ...
test(<scope>): ...
```

Split unrelated changes:

- Runtime implementation and tests.
- Docs/tracker calibration.
- TODO/future milestone records.
- Release commit generated by `make release`.

Before each commit:

```bash
git status --short
git diff --stat
git diff -- <paths>
git diff --cached --check
```

Stage only intended files. If git index writes fail with `index.lock: Operation not permitted`, retry the same git operation with elevated permission and then re-check the staged scope.

## Release Flow

After the refactor is merged to `master`:

1. Confirm target version explicitly.
2. Run preview:

```bash
make release-dry-run VERSION=x.y.z
```

3. Create local release commit/tag:

```bash
make release VERSION=x.y.z
```

4. Publish only after explicit publish intent:

```bash
make publish VERSION=x.y.z
```

5. Wait for GitHub Actions to finish.
6. Report release URL, tag, branch, workflow status, and any non-blocking warnings.

## Closeout Checklist

Before declaring a refactor done:

- Active phase rows are `[x]`.
- No unresolved P2/P1/P0 findings remain unless explicitly deferred.
- Focused and broad checks are recorded.
- Obsidian smoke is recorded or explicitly skipped with reason.
- Risk table matches the final behavior.
- Open decisions are updated.
- Product Spec, Architecture, Tracker, any existing Plan/SDD and Backlog do not contradict each other.
- Stable outcomes are absorbed into current contracts/tests；unresolved work is in Backlog.
- Feature Home、Tracker、Plan/SDD、handoff 与过程日志默认 delete-after-absorption；只有当前 authority 仍引用的独有证据进入 Archive。
- No Closed/Cancelled process package remains under `active/`.
- Worktree is clean or remaining changes are clearly named.
- Release status is clear if a release was requested.

## Starter Prompt

Use this prompt to start the next refactor:

```text
按照 AGENTS.md 和 docs/development/documentation-workflow.md、docs/development/workflows/refactor-workflow.md，基于 docs/development/active/<feature>/README.md 开始下一轮重构。

要求：
- 每个 phase 按 dev -> test -> review -> fix -> Obsidian smoke test -> fix 的职责推进；按实际变化复用有效证据，达到退出条件即交付。
- 按具体风险安排 phase review 和 subagents，保留明确要求的独立审查；不重复审查未变范围。
- 新增设计必须对应当前需求或已证实问题；追加验证说明尚未解决的问题和会影响的决定。模型行为按 AGENTS.md 的 Agent Behavior Acceptance 验收。
- 只在 Tracker 更新执行状态；实现后同步受影响的 Product Spec/Architecture、按需 Plan/SDD、风险与验证记录。
- Runtime/UI 变化必须部署后在 test vault smoke；默认 make deploy，当前改动所需检查已通过且 production build 有效时按 AGENTS.md 复用 make deploy-current。
- Closeout 把稳定结论吸收到 current authority/tests，未完成项进入 Backlog，过程文档默认删除；提交时拆分 docs、runtime/test、Backlog/future milestone、release commit。
```
