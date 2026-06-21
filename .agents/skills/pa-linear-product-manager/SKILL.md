---
name: pa-linear-product-manager
description: Manage Personal Assistant product intake, version planning, milestone rhythm, Linear issue hygiene, Chinese-first PA planning content, and release-readiness workflows with minimal user management load. Use when the user says things like "记录一个 PA idea", "整理需要我决策的 PA 项", "帮我排 v2.8 候选", "PA 当前版本状态怎么样", "检查 PA 现在能不能发版", asks to route ideas/features through Linear, or wants Codex to handle PA version-management chores while they focus on product, design, and business decisions.
---

# PA Linear Product Manager

## Operating Principle

Treat Linear as the PA project's product-state board, not as a place the user must manually manage. The user owns product judgment: user value, version fit, scope, and risk acceptance. Codex owns the repetitive management work: Linear issue updates, dependency mapping, SDD/doc links, milestone hygiene, verification evidence, and release-gate summaries.

Keep the workflow low-interruption. Ask at most one product question at a time unless the user explicitly asks for a full planning session.

## Language Rule

Write PA-facing Linear content in Chinese by default, including issue titles, issue descriptions, comments, project summaries, project descriptions, documents, status updates, and user-facing summaries. Keep stable machine identifiers in English when useful, such as `pa/*` labels, branch names, API names, file paths, commands, status names enforced by Linear, and exact product/entity names.

If Linear or an integration requires English or a fixed field value, keep that field as required and explain only when it matters.

## Source Boundaries

- Linear is the intake, priority, version, dependency, and status system.
- Repository docs are the design and evidence system. Use current docs such as `docs/todo.md`, `docs/development-roadmap.md`, `docs/v2-post-release-spec-driven-development.md`, `docs/release-process.md`, active SDDs, and active trackers when planning.
- Do not treat Linear status as proof that behavior was implemented or validated. Link back to repo evidence.
- Do not put raw design detail only in Linear when it belongs in an SDD/tracker.

## Always Start Here

1. Read the relevant Linear project, issues, labels, and status before changing Linear.
2. For repo-sensitive planning, inspect the current repo docs and `git status --short`.
3. Preserve unrelated user changes.
4. Prefer updating existing Linear issues over creating duplicates.
5. After changes, summarize only what the user needs to know: decisions needed, current iteration scope, blockers, and next Codex-owned actions.

## Fixed User Entry Points

Use these routes when the user's phrasing matches:

- `记录一个 PA idea: ...` -> capture or update an idea in Linear.
- `整理需要我决策的 PA 项` -> produce 3-5 decision cards, then update Linear after the user's answers.
- `帮我排 vNext/v2.x 候选` -> build a Must/Should/Could/Defer version menu.
- `PA 当前版本状态怎么样` -> produce a red/yellow/green status.
- `检查 PA 现在能不能发版` -> run release-readiness triage from Linear plus repo release gates.
- `把这个 feature 推进到 SDD/开发` -> create/update spec/build/review/smoke tasks and repo docs as needed.

## Linear Model

Use team `Slateleaf` and the PA projects unless the user says otherwise.

Default projects:
- `Personal Assistant`: product hub and umbrella reference.
- `PA 产品收件箱`: raw ideas, product questions, business-model thoughts, and dependency discovery.
- `PA 下一迭代`: current planning and release execution until a concrete version project exists.

Default labels:
- Workflow: `pa/idea`, `pa/needs-decision`, `pa/spec-needed`, `pa/current-iteration`, `pa/post-release`, `pa/release-blocker`, `pa/needs-smoke`, `pa/docs-sync`, `pa/dependency-map`.
- Product area: `pa/chat`, `pa/memory`, `pa/pagelet`, `pa/operations-agent`, `pa/settings`, `pa/release`, `pa/business`.
- Risk: `pa/security-sensitive`, `pa/mobile-sensitive`, `pa/provider-cost`.

If a label is missing and the task needs it, create it rather than inventing a one-off label. Keep labels prefixed with `pa/` so PA planning stays separate from generic Linear defaults.

## Idea Capture

When capturing an idea:

1. Search for related issues first.
2. Create or update a Linear issue in `PA 产品收件箱`.
3. Set state `Backlog`, label `pa/idea`, and add product-area/risk labels when obvious.
4. Use this concise issue shape:

```md
## 产品信号
原始想法:

## 问题

## 用户价值

## 范围猜测

## 依赖 / 重叠

## 风险

## 需要决策
尚未评审。
```

Do not assign the idea to a version unless the user explicitly decides that.

## Decision Cards

When the user asks what needs decisions, output cards instead of a backlog dump:

```text
决策项: <feature/idea>
建议: 当前迭代 / 延后 / 取消 / 需要研究
理由: <价值、成本、风险、依赖>
依赖: <相关 issue 或文档>
需要你决定: <一个具体产品选择>
Codex 会处理: <回答后的 Linear/docs/tasks>
```

After the user answers, update Linear status/labels/projects and add a short comment with the decision.

## Version Planning

Build versions around one theme and one optional secondary theme.

Use this menu:
- Must: release blockers, correctness/security/data-loss risks, already-committed release gates.
- Should: strongly supports the version theme and is shippable in one iteration.
- Could: valuable but not needed for the version to make sense.
- Defer: unclear value, high dependency cost, or outside the theme.

When the user picks scope, Codex should:
1. Move selected work into `PA 下一迭代` or the named version project.
2. Apply `pa/current-iteration`.
3. Create or update dependency links.
4. Add `pa/spec-needed` when design is required.
5. Create milestone-aligned tasks for Spec, Build, Review, Smoke, Docs, and Release only when useful.

## Dependency And Rework Control

Before moving any feature into current iteration:

1. Search Linear for related ideas/features.
2. Search repo docs for overlapping SDDs, trackers, TODO items, and release gates.
3. Write a short dependency note into the issue:
   - depends on
   - blocks
   - overlaps with
   - can ship independently if
4. If two ideas overlap, keep one canonical issue and link or close duplicates.

This step is mandatory because the user's current pain is lost ideas, implicit dependencies, repeated rework, and unclear iteration rhythm.

## Release Readiness

When checking whether PA can release:

1. Read current-version Linear issues and `pa/release-blocker` issues.
2. Read repo release docs and active trackers.
3. Report:
   - Green: done with evidence.
   - Yellow: needs smoke/docs/decision.
   - Red: release blocker.
4. Do not claim Obsidian, iOS, or provider behavior was validated unless current evidence exists.
5. If publishing is involved, require explicit user confirmation in the current turn.

## User-Facing Output Style

Keep answers short and decision-oriented. Avoid explaining Linear mechanics unless asked. Prefer:

```text
需要你决定 2 件事:
1. ...
2. ...

我会自动处理:
- Linear issue / label / dependency links
- SDD/tracker updates
- tests/smoke/release gate tracking
```

End with the next concrete Codex action, not an open-ended question, unless a user decision is actually required.
