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

- `docs/<topic>-plan.md` or an existing active plan document.
- `docs/<topic>-development-tracker.md`.
- Optional handoff docs for intentionally deferred product areas.
- `docs/todo.md` for follow-up items that should not reopen the active tracker.

Keep roles separate:

- Plan doc: source of truth for product goals, architecture, boundaries, phased roadmap, and validation strategy.
- Tracker doc: execution record for phase status, test evidence, review findings, smoke results, risks, and decisions.
- TODO doc: deferred cleanup or future milestones outside the active implementation track.
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
7. Update plan/tracker to match the implementation only after behavior is verified.

For risky paths, keep fallback behavior working before enabling the new path by default.

## Review Loop

Use subagents for every phase review when available.

Recommended review split:

- Runtime/architecture reviewer: call path, lifecycle, fallback, source boundaries.
- Product/safety reviewer: user-visible behavior, privacy, permission, trust model.
- Testing/QA reviewer: coverage gaps, smoke coverage, tracker evidence.
- Docs/tracker reviewer: stale status, contradictory source-of-truth claims.

Only fix P2/P1/P0 findings immediately. Move low-risk polish into `docs/todo.md` if it should not block the phase.

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
- Plan, tracker, and TODO do not contradict each other.
- Worktree is clean or remaining changes are clearly named.
- Release status is clear if a release was requested.

## Starter Prompt

Use this prompt to start the next refactor:

```text
按照 AGENTS.md 和 docs/refactor-workflow.md，基于 <plan-doc> / <tracker-doc> 开始下一轮重构。

要求：
- 每个 phase 按 dev -> test -> review -> fix -> Obsidian smoke test -> fix 循环推进。
- 使用 subagents 做 phase review。
- 先更新 tracker 状态，再做实现；实现后同步 PLAN/tracker/风险/验证记录。
- Runtime/UI 变化必须 make deploy 后在 test vault smoke。
- 提交时拆分 docs、runtime/test、TODO/future milestone、release commit。
```
