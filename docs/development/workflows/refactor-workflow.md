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

Each active phase follows this loop until P2/P1/P0 issues are closed or explicitly deferred:

```text
dev -> test -> review -> fix -> Obsidian smoke test -> fix
```

Do not mark a phase done just because code compiles. A phase is done only when the tracker, tests, review findings, smoke evidence, and risk table agree with the actual behavior.

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
5. Update tests with the implementation, not after the fact.
6. Run focused tests first.
7. Update Tracker and any affected Plan/SDD to match verified behavior；Feature Home only changes when routing or scope boundary changes.

For risky paths, keep fallback behavior working before enabling the new path by default.

## Review Loop

Use subagents for every phase review when available.

Recommended review split:

- Runtime/architecture reviewer: call path, lifecycle, fallback, source boundaries.
- Product/safety reviewer: user-visible behavior, privacy, permission, trust model.
- Testing/QA reviewer: coverage gaps, smoke coverage, tracker evidence.
- Docs/tracker reviewer: stale status, contradictory source-of-truth claims.

Only fix P2/P1/P0 findings immediately. Move low-risk polish into `docs/backlog.md` if it should not block the phase, and keep the source Work item/track link.

After fixes, re-review the changed area or at least re-check the specific finding against the live diff.

## Test Strategy

Use the smallest meaningful checks first:

```bash
npm test -- __tests__/chat-service.test.ts --runInBand
npm test -- __tests__/ai-utils.test.ts __tests__/chat-service.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
npm run lint
git diff --check
```

For broad behavior, shared runtime, release, packaging, or rollout changes, run:

```bash
npm test -- --runInBand
npm run build
```

For dependency or lockfile changes, add:

```bash
npm ci --dry-run
```

## Obsidian Smoke

Run Obsidian smoke when runtime/UI behavior changes.

Preferred path:

```bash
make deploy
obsidian "obsidian://open?vault=test&file=<encoded-path>"
```

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

For provider, backend, or high-risk runtime rollouts:

1. Add the implementation behind a gate.
2. Keep the old path as fallback.
3. Add diagnostics with redacted metadata only.
4. Add focused tests for unsupported/unvalidated combinations.
5. Add equivalence tests for source boundary and observations.
6. Run hidden canary/smoke first.
7. Promote only the validated tuple/configuration to default.
8. Keep unverified combinations on fallback.
9. Update plan/tracker status from historical decision to current reality.

Never let stale tracker wording say the old no-go/default state is still active after a follow-up rollout changes it.

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
- 每个 phase 按 dev -> test -> review -> fix -> Obsidian smoke test -> fix 循环推进。
- 使用 subagents 做 phase review。
- 只在 Tracker 更新执行状态；实现后同步受影响的 Product Spec/Architecture、按需 Plan/SDD、风险与验证记录。
- Runtime/UI 变化必须 make deploy 后在 test vault smoke。
- Closeout 把稳定结论吸收到 current authority/tests，未完成项进入 Backlog，过程文档默认删除；提交时拆分 docs、runtime/test、Backlog/future milestone、release commit。
```
