---
name: pa-linear-product-manager
description: Manage Personal Assistant raw-idea intake, promotion, version planning, milestone rhythm, Linear issue hygiene, Chinese-first planning content, and product/milestone-level release readiness with minimal user management load. Use when explicitly invoked or routed by pa-docs-lifecycle-manager for phrases such as "记录一个 PA idea", "整理需要我决策的 PA 项", "帮我排 vNext 候选", or "PA 当前版本状态怎么样". Keep raw ideas in the Linear inbox without B-xxx, promote only decision/version/cross-session research or execution work with bidirectional repo links, and report Linear write failures honestly. For code-level readiness, use personal-assistant-review instead.
---

# PA Linear Product Manager

## Operating Principle

Treat Linear as the PA project's low-burden intake and operational planning mirror, not as the repo-local product authority or a place the user must manually manage. The user owns product judgment: user value, version fit, scope, and risk acceptance. The agent owns the repetitive management work: Linear issue updates, dependency mapping, repo-doc synchronization, milestone hygiene, verification links, and release-gate summaries.

Keep the workflow low-interruption. Ask one product question at a time. Return
3-5 decision cards only when the user explicitly asks for a batch decision
queue or full planning session; do not write decisions before the user answers.

## Language Rule

Write PA-facing Linear content in Chinese by default, including issue titles, issue descriptions, comments, project summaries, project descriptions, documents, status updates, and user-facing summaries. Keep stable machine identifiers in English when useful, such as `pa/*` labels, branch names, API names, file paths, commands, status names enforced by Linear, and exact product/entity names.

If Linear or an integration requires English or a fixed field value, keep that field as required and explain only when it matters.

## Source Boundaries

- When `pa-docs-lifecycle-manager` also applies, it owns repo-doc routing,
  lifecycle state, and user decision questions. This skill owns only the Linear
  intake/issue/project side and must avoid duplicate questions.
- Linear is the fast intake, prioritization, version and dependency mirror.
- Repository docs are the current requirement, decision, design, execution and evidence system. Follow `docs/development/documentation-workflow.md`; use `docs/backlog.md`, repo-local Decision records, Product Specs, Active Registry/Trackers and current architecture when planning.
- A raw idea starts in the Linear inbox and does not receive a `B-xxx`. Linear
  persistence alone is not “cross-session research or execution”.
- Promote only when the item needs a product decision, becomes a roadmap/version
  or current-iteration candidate, or needs cross-session research or execution.
  On promotion, create/reuse one repo-local `B-xxx` and add bidirectional links.
- User decisions must be written to the repo Decision Register/Record and affected Product Spec before the Linear comment becomes the only record.
- Do not treat Linear status as proof that behavior was implemented or validated. Link back to repo evidence.
- Do not put raw design detail only in Linear when it belongs in an SDD/tracker.

An upstream explicit `review-only`, `analysis-only`, `read-only`,
`no-file-changes`, “只分析”, or “不要改文件” request means **zero writes** here
too. Do not create, update, label, move, or comment on a Linear issue.

## Always Start Here

1. Read the relevant Linear project, issues, labels, and status before changing Linear.
2. For repo-sensitive planning, read `docs/development/documentation-workflow.md`, inspect the current repo docs and `git status --short`.
3. Preserve unrelated user changes.
4. Prefer updating existing Linear issues over creating duplicates.
5. After changes, summarize only what the user needs to know: decisions needed, current iteration scope, blockers, and next agent-owned actions.

## Fixed User Entry Points

Use these routes when the user's phrasing matches:

- `记录一个 PA idea: ...` -> capture or update a raw Linear inbox issue; do not
  create `B-xxx` unless the same request contains a promotion gate.
- `整理需要我决策的 PA 项` -> this is an explicit batch request: produce 3-5
  read-only decision cards, then update Linear only after the user's answers.
- `帮我排 vNext 候选` -> build a Must/Should/Could/Defer version menu.
- `PA 当前版本状态怎么样` -> produce a red/yellow/green status.
- `检查 PA 现在能不能发版` -> run release-readiness triage from Linear plus repo release gates.
- `把这个 feature 推进到 SDD/开发` -> promote it to one linked `B-xxx`, then
  create/update spec/build/review/smoke tasks and repo docs as needed.

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

When capturing a raw idea:

1. Search for related issues first.
2. Create or update a Linear issue in `PA 产品收件箱`.
3. Set state `Backlog`, label `pa/idea`, and add product-area/risk labels when obvious.
4. Use this concise issue shape:

```markdown
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
Do not create `B-xxx`, Discovery, Product Spec, or an Active Package for raw
inbox material.

If Linear search, create, or update fails, report the exact failed operation and
the last confirmed state. Never claim the idea was recorded or captured when
the create/update did not succeed, and never create a fallback `B-xxx` for a
failed raw-idea capture.

## Promotion To Repo Work

Promote only when at least one gate is true:

- the item needs a product decision;
- the user selects it as a roadmap/version or current-iteration candidate;
- the user asks for cross-session research or execution.

Linear persistence by itself is not a promotion gate. On promotion:

1. Ensure the canonical Linear issue exists.
2. Ask `pa-docs-lifecycle-manager` to search for duplicates and create or reuse
   one `B-xxx` in the repo authority.
3. Add the Linear issue link to the repo item and the `B-xxx` plus repo link to
   the Linear issue.
4. Claim “promoted and synchronized” only after both directions are confirmed.

If a later Linear link/update fails after the repo item exists, preserve the
repo result, report the mirror as partial or failed, and give the next safe
retry. Never claim the item is linked or synchronized when that write failed.

## Decision Cards

For an ordinary decision request, output one card instead of a backlog dump. If
the user explicitly asks for a batch, queue, or full planning session, output
3-5 cards and keep the operation read-only until the user answers:

```text
决策项: <feature/idea>
建议: 当前迭代 / 延后 / 取消 / 需要研究
理由: <价值、成本、风险、依赖>
依赖: <相关 issue 或文档>
需要你决定: <一个具体产品选择>
Agent 会处理: <回答后的 Linear/docs/tasks>
```

After the user answers, first promote the item if needed and create/update the
repo-local Decision Register/Record and affected Product Spec/Backlog according
to Documentation Workflow. Then update Linear status/labels/projects and add a
short comment linking the repo decision. If that Linear update fails, report the
repo decision as saved and the Linear mirror as failed; do not claim full sync.

## Version Planning

Build versions around one theme and one optional secondary theme.

Use this menu:
- Must: release blockers, correctness/security/data-loss risks, already-committed release gates.
- Should: strongly supports the version theme and is shippable in one iteration.
- Could: valuable but not needed for the version to make sense.
- Defer: unclear value, high dependency cost, or outside the theme.

When the user picks scope, the agent should:
1. Promote every selected item to a linked `B-xxx` before changing its project.
2. Move selected work into `PA 下一迭代` or the named version project.
3. Apply `pa/current-iteration`.
4. Create or update dependency links.
5. Add `pa/spec-needed` when design is required.
6. Create milestone-aligned tasks for Spec, Build, Review, Smoke, Docs, and Release only when useful.

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
4. Do not claim Obsidian, iOS, or provider behavior was validated unless current evidence exists. For code-level gate verification, use `personal-assistant-review` and `obsidian-test-vault-smoke`. For community compliance, use `obsidian-community-check`.
5. Keep this skill at the product and milestone readiness layer. Do not run release
   commands here.
6. Route stable release preparation or execution to `stable-release`. Route BRAT
   beta prerelease preparation or execution to `pa-brat-beta-release`.
7. Preserve the user's current-turn intent when routing. An explicit target
   version plus publish request is publish authorization; an ordinary readiness
   check is not.

## Output

Keep answers short and decision-oriented. Avoid explaining Linear mechanics
unless asked. Use the multi-item shape below only for an explicit batch request;
otherwise return one decision card:

```text
需要你决定 2 件事:
1. ...
2. ...

我会自动处理:
- Linear issue / label / dependency links
- SDD/tracker updates
- tests/smoke/release gate tracking
```

End with the next concrete agent action, not an open-ended question, unless a user decision is actually required.
Always distinguish `captured`, `promoted and linked`, `partial`, and `failed`;
never upgrade a failed Linear write into a success label.
