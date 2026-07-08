---
name: sdd-lifecycle
description: Orchestrate the full SDD (Software Design Document) lifecycle for non-trivial features — planning, SDD drafting, phased implementation with loop engineering, testing, review, smoke, and closeout. Use when the user asks to start SDD for X, plan feature X, implement spec X, track SDD progress, run a feature through the full dev cycle, or says "开始做 X 的设计", "按 SDD 流程做", "走一遍完整开发流程", "plan and implement X". For one-file bug fixes, use the normal review/fix/test/commit path instead.
---

# SDD Lifecycle

Orchestrate the repeatable development lifecycle used by this project for every
non-trivial feature:

```
plan → SDD → implement → test → review → smoke → close
```

Every phase embeds loop engineering. Review is not ceremonial — it catches
real bugs that implementation introduces (~30% first-pass error rate observed
in this project). The dependency surface is always bigger than expected (2x
rule).

## When to Use

Use this skill when a change:

- Needs a product spec, SDD, or development tracker before code
- Touches runtime architecture, product behavior, data/privacy boundaries, or
  Obsidian UI behavior
- Requires multiple phases instead of a single narrow fix
- Has risks that should be tracked across dev, test, review, fix, and smoke
  loops

For a one-file bug fix or small patch, use the normal focused
review/fix/test/commit path instead.

## Before Starting

Read these project sources:

1. `AGENTS.md` — project conventions, architecture rules, commit rules
2. `docs/pa-product-north-star.md` — product standard
3. `docs/refactor-workflow.md` — reusable refactor workflow (this skill
   orchestrates on top of it, not in place of it)
4. Related memories and existing product specs in `docs/`

## Phase 0: Planning

**Goal:** Establish product context, scope, and a development plan.

**Loop:** `draft plan -> review plan -> revise -> approve`

Steps:

1. Read North Star (`docs/pa-product-north-star.md`) and related memories for
   context.
2. Read or create the product spec (`docs/<feature>-product-spec.md`). If the
   spec already exists, verify it is current.
3. Draft the development plan (`docs/<feature>-plan.md` or
   `docs/<feature>-development-plan.md`) with:
   - Goal and non-goals
   - Phased roadmap with dependencies
   - Out-of-scope items
   - Risk assessment
4. Create the development tracker (`docs/<feature>-tracker.md` or
   `docs/<feature>-development-tracker.md`) using the tracker template below.
5. Review the plan against product spec, North Star, and existing architecture.
   Check:
   - Does the plan align with product instincts from North Star?
   - Are dependencies identified (grep the codebase for touched modules)?
   - Are out-of-scope items explicit?
6. Revise until the plan is internally consistent and the user approves.

**Exit gate:** Plan and tracker committed (`docs(<scope>): ...`). User
approved scope and phasing.

## Phase 1: SDD (Structural/Refactoring Work)

**Goal:** Write an implementation SDD that is grep-verified and
dependency-audited before any runtime code is written.

**Loop:** `draft SDD -> SDD review -> fix SDD -> approve SDD`

**When to use Phase 1:** Structural refactors, new module boundaries, shared
infrastructure changes, or multi-file feature additions. Skip for small
additive features that do not change existing structure.

Steps:

1. Write the SDD (`docs/<feature>-sdd.md`) with:
   - Implementation steps per phase
   - Method/type/file names (MUST be grep-verified against actual code)
   - Interface contracts and lifecycle
   - Migration path from current state
   - Shared resources affected (locale keys, CSS classes, settings keys,
     command IDs, exports)
2. SDD review — verify before implementing:
   - **Method names match actual code:** `rg -n "methodName" src/` for every
     method/type referenced in the SDD. If the name does not exist yet, say so
     explicitly.
   - **Dependency surface audit:** grep all modules the SDD touches. The
     actual dependency count is >= 2x what you initially expect. For feature
     removal or rename, do an exhaustive multi-layer grep before writing the
     removal plan.
   - **Interface lifecycle:** can the proposed interface support the required
     mount/unmount/reload lifecycle in Obsidian?
   - **Shared resources:** locale keys, CSS classes, settings keys, command
     IDs used by other features?
   - **Migration path:** does the SDD account for existing user data, settings,
     and persisted state?
3. Fix SDD based on review findings.
4. Repeat until SDD review is clean.

**Anti-patterns:**
- SDD with wrong method names — implementers will search for the name you
  wrote. Grep to confirm every method/type name.
- Skipping SDD review — SDD reviews are cheap (read-only). SDD bugs become
  implementation bugs that cost 10x more to fix.
- Dependency undercount — dependency surfaces are always >= 2x what you expect.

**Exit gate:** SDD committed (`docs(<scope>): ...`). All method names
grep-verified. Dependency surface documented.

## Phase 2: Implementation

**Goal:** Implement per SDD/plan with continuous verification loops.

**Inner loop (per implementation batch):**

```
implement -> make deploy -> review batch -> fix findings -> verify fixes
```

Steps:

1. Read `AGENTS.md`, the active plan, tracker, SDD (if exists), nearby code,
   and relevant tests.
2. Record the phase as `[~] In progress` in the tracker.
3. Implement one behavior slice at a time. Prefer existing module boundaries
   and helper APIs.
4. After each coherent slice, run the Local Validation Gate from AGENTS.md:
   ```bash
   npm test -- --runInBand <focused suites>
   npx tsc -noEmit -skipLibCheck
   git diff --check
   ```
5. When the slice needs app-runtime confidence, run `make deploy` (full gate:
   Jest + lint + build + deploy to `test/`).
6. Review the implementation batch. Common implementation-introduced bugs:
   - Data path breakage (e.g., entryReason disconnected — entire feature
     becomes dead code)
   - Locale param mismatch (UI displays literal `{count}` instead of number)
   - Shared resource rename incomplete (half the callers still use old name)
   - Lifecycle cleanup missing (observer/timer/listener not cleared on
     unmount/unload)
   - CSS scope leak into Obsidian core UI
7. Fix review findings. Each fix gets its own build verification.
8. The inner loop terminates when review returns no P0/P1/P2 findings.

**"First refactor, then delete" rule:** When restructuring, extract (pure
refactor) in one phase, delete (behavior change) in the next. Tests can verify
behavioral equivalence only if the two are separated.

**Commit after coherent milestones** using Conventional Commits with
`git commit -s`:
- `feat(<scope>): ...` for new behavior
- `fix(<scope>): ...` for corrections
- `refactor(<scope>): ...` for structural changes
- `test(<scope>): ...` for test additions

**Exit gate:** All implementation slices pass the inner loop. Tracker updated.

## Phase 3: Testing

**Goal:** Add test coverage for new/changed code and verify the full gate.

**Loop:** `add tests -> run focused suites -> fix failures -> run full gate`

Steps:

1. Add regression tests for the implemented behavior. Cover:
   - Success path
   - Failure/error paths
   - Edge cases (empty data, stale async, concurrent runs, large vault)
   - Compatibility paths (old settings, persisted data, command IDs)
   - Product contract (privacy, write guards, cost disclosure)
2. Run focused test suites:
   ```bash
   npm test -- --runInBand <affected suites>
   ```
3. Fix any test failures. If failures reveal implementation bugs, return to
   Phase 2 inner loop.
4. Run the full validation gate:
   ```bash
   make deploy
   ```
   `make deploy` runs full Jest, lint, build, and deploys assets to `test/`.
5. Verify test coverage is meaningful — tests that only prove the easiest
   success path and do not pin product, privacy, compatibility, or lifecycle
   behavior are insufficient.

**Exit gate:** Full `make deploy` passes. Test coverage includes failure,
edge, and contract paths.

## Phase 4: Final Review + Smoke

**Goal:** Multi-lane code review and end-to-end Obsidian smoke validation.

**Loop:** `review -> fix -> verify -> re-review` until clean

Steps:

1. Invoke `personal-assistant-review` skill for multi-lane code review:
   - Functional state and concurrency
   - Spec, docs, tests, i18n, product contract
   - Obsidian/community compatibility and lifecycle
   - UI/UX/accessibility/mobile
   - Performance, safety, and maintainability

   Do NOT duplicate the review skill's logic here — delegate to it.

2. Triage review findings using `personal-assistant-review-followup` skill:
   - Classify: must-fix / should-fix-now / defer
   - Identify product decisions needed
   - Implement confirmed fixes

3. Each fix goes through its own verification:
   ```bash
   npm test -- --runInBand <affected suites>
   npx tsc -noEmit -skipLibCheck
   ```

4. Invoke `obsidian-test-vault-smoke` skill for end-to-end validation:
   - Pick the appropriate tier: `quick`, `app-runtime`, `full-ui`, or
     `release-gate`
   - Runtime/UI changes require `make deploy` and real Obsidian test-vault
     smoke
   - Do not claim Obsidian validation without deployed evidence

   Do NOT duplicate the smoke skill's logic here — delegate to it.

5. Any P0/P1/P2 findings from review or smoke → return to Phase 2 inner loop.

6. Re-review after fixes until clean.

**Exit gate:** Review returns no P0/P1/P2 findings. Smoke passes at the
appropriate tier. Tracker updated with evidence.

## Phase 5: Close

**Goal:** Update all artifacts to reflect completion.

Steps:

1. Update the development tracker:
   - All phase rows marked `[x]`
   - Verification log recorded
   - Risk table matches final behavior
   - Open decisions resolved or explicitly deferred
2. Update `docs/todo.md` with any follow-up items that should not reopen the
   tracker.
3. Update related docs if behavior, commands, release process, packaging, or
   architecture changed.
4. Commit docs/tracker updates:
   ```bash
   git commit -s
   ```
   Use `docs(<scope>): ...` for documentation changes.
5. Verify plan, tracker, and todo do not contradict each other.

**Exit gate:** Tracker is fully closed. No unresolved P0/P1/P2 findings.
Docs are consistent.

## Loop Engineering Principles

These principles apply across all phases. They are extracted from the
UI/UX review methodology (`.agents/skills/ui-ux-design-audit/SKILL.md`)
and proven across 4+ feature cycles in this project.

1. **Every phase has an explicit loop.** Linear "do X then Y" steps miss
   implementation-introduced bugs. The loop catches them.

2. **Review catches real bugs, not just style issues.** Observed in this
   project: entryReason data path completely disconnected (entire feature was
   dead code), locale `{count}` displayed as literal string, shared resource
   renames leaving half the callers broken.

3. **The dependency surface is always >= 2x expected.** When planning a
   change that touches N files, grep will reveal 2N+ dependents. Budget for
   this.

4. **SDD method names must be grep-verified.** Implementers search for the
   exact name written in the SDD. If the name is wrong, implementation
   silently diverges from the design.

5. **First refactor, then delete.** Extract (pure structural change) in one
   commit, delete (behavior change) in the next. Tests can verify behavioral
   equivalence only when the two are separated.

6. **~30% of LLM-generated review findings are false positives.** Always
   verify audit findings against actual source code before committing to
   fixes. This is handled by `personal-assistant-review-followup`.

7. **`make deploy` is the verification gate, not `npm test`.** `make deploy`
   runs full Jest + lint + build + deploy. Use it for app-runtime confidence.

## Tracker Template

Create `docs/<feature>-development-tracker.md` with this structure:

```markdown
# [Feature Name] Development Tracker

Updated: YYYY-MM-DD
Plan: [<feature>-plan.md](./<feature>-plan.md)
SDD: [<feature>-sdd.md](./<feature>-sdd.md) (if applicable)

## Status Legend

| Mark | Meaning |
|------|---------|
| `[ ]` | Todo |
| `[~]` | In progress |
| `[x]` | Done |
| `[!]` | Blocked |

## Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| P0 Planning | [ ] | |
| P1 SDD | [ ] | Skip if no structural change |
| P2 Implementation | [ ] | |
| P3 Testing | [ ] | |
| P4 Review + Smoke | [ ] | |
| P5 Close | [ ] | |

## Verification Log

| Check | Result | Notes |
|-------|--------|-------|
| `make deploy` | | |
| Focused tests | | |
| Type check | | |
| Review findings | | |
| Smoke tier | | |

## Risk Table

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| | | | |

## Open Decisions

| Decision | Options | Chosen | Rationale |
|----------|---------|--------|-----------|
| | | | |
```

## Commit Conventions

Per AGENTS.md and project memory:

- Use Conventional Commits: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Always sign commits: `git commit -s`
- Do NOT add `Co-Authored-By` trailer
- Split commits by intent: runtime/tests, docs/tracker, TODO/future milestones
- Stage only intended files; do not include unrelated user edits
- Before committing, inspect: `git status --short`, `git diff --stat`,
  targeted `git diff -- <path>`

## Integration with Other Skills

This skill orchestrates the full lifecycle. It delegates specialized work:

- **`personal-assistant-review`**: used in Phase 4 for multi-lane code review.
  This skill triggers the review; the review skill owns the methodology.
- **`personal-assistant-review-followup`**: used in Phase 4 to triage and
  implement fixes from review findings.
- **`obsidian-test-vault-smoke`**: used in Phase 4 for end-to-end Obsidian
  validation. This skill specifies the appropriate tier; the smoke skill owns
  the procedure.
- **`obsidian-community-check`**: used in Phase 4 for release-gate tier smoke
  to verify community compliance.

This skill does NOT duplicate logic from any of those skills. It references
them by name and delegates execution.

## Anti-Patterns

1. **Implement before planning.** SDD bugs become implementation bugs at 10x
   cost. Always plan structural work before coding.

2. **Skip the inner loop.** "Code compiles" is not "phase done." A phase is
   done only when tracker, tests, review findings, smoke evidence, and risk
   table agree with actual behavior.

3. **Review as ceremony.** If review is not finding bugs, either the
   implementation is unusually clean or the review is too shallow. In this
   project, review consistently catches ~30% of implementation-introduced
   issues.

4. **Mix refactoring with deletion.** Tests cannot verify behavioral
   equivalence when structural change and behavior change are in the same
   commit.

5. **Trust LLM audit at face value.** ~30% false positive rate. Always verify
   against actual source code.

6. **Use `npm test` as the final gate.** Use `make deploy` — it runs the full
   chain (Jest + lint + build + deploy).

## Related Docs

- `AGENTS.md` — project conventions and architecture rules
- `docs/refactor-workflow.md` — reusable refactor workflow (this skill builds
  on top of it)
- `docs/pagelet-sdd-guide.md` — Pagelet-specific SDD reference
- `docs/pa-product-north-star.md` — product standard
- `docs/todo.md` — deferred items
- `docs/development-roadmap.md` — release roadmap
