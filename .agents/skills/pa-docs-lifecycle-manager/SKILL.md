---
name: pa-docs-lifecycle-manager
description: Automatically route Personal Assistant ideas, decisions, planning, implementation, continuation, status, closeout, and archive work from ordinary language with minimal management load. Use for phrases such as "记录一个 PA idea", "继续推进", "先规划并实现", "需要我决定什么", or "帮我收尾". Send raw ideas to the Linear inbox without a B-xxx, promote only decision/version/cross-session research or execution work into repo docs with bidirectional links, honor explicit review-only or no-file-changes requests as zero-write, route runtime delivery to sdd-lifecycle, and keep commit, push, tag, publish, and release authorization explicit.
---

# PA Docs Lifecycle Manager

## Operating Contract

Act as the PA project's low-burden documentation steward. Accept ordinary
product and development language; do not make the user remember lanes, IDs,
file paths, templates, status values, or archive rules.

The user owns:

- product value, scope, priority, tradeoffs, and acceptance criteria;
- data, privacy, provider-cost, compatibility, and risk acceptance;
- whether an explicitly read-only request may become a write request later;
- permission to implement, commit, push, publish, or release.

Own all mechanical work:

- classify the request and choose the lightest valid lifecycle lane;
- capture raw ideas in the Linear inbox and assign stable IDs only on promotion;
- create, update, index, reconcile, close, and archive repo docs;
- keep one authority for each state and remove stale mirrors;
- run the required validation and report only material decisions or blockers.

Ask at most one product or authorization question at a time. The only batching
exception is an explicit request for a decision queue; then return 3-5 compact
cards without writing decisions before the user answers. Never ask the user
which document to edit or which workflow phase to select.

## Read Current State

Before writing, read:

1. `docs/index.md`, `docs/backlog.md`, `docs/development-roadmap.md`, and
   `docs/development/active/README.md`;
2. `docs/development/documentation-workflow.md` and the relevant canonical
   templates;
3. the North Star, matching Decisions, Product Specs or Governance Contract,
   Architecture, Active Package, and nearby code/tests as required by the request;
4. `git status --short` and focused diffs so unrelated work remains untouched.

Search by stable ID, feature slug, and product concept before creating anything.
Read Archive only when current authority links to it or historical rationale is
needed. Before closeout, always inspect the annual Archive indexes and the exact
destination path even when no current document links there.

## Highest-Priority No-Write Guard

Explicit `review-only`, `analysis-only`, `read-only`, `no-file-changes`, “只分析”,
“不要改文件”, “不要写入”, or equivalent language means **zero writes**. Do not
create or update repo docs, Linear issues, runtime code, files, git state, or
external systems. This guard overrides implicit invocation, capture and
promotion rules, cross-session preservation, quoted keywords, and every route
below. Return analysis or a proposed change list only.

Do not infer intent from quoted, hypothetical, historical, or negated phrases.
For example, “分析为什么上次修复失败” is analysis, not implementation, and
“不要继续推进” is not continuation authority.

## Infer Intent Automatically

| User intent | Automatic route | Default stop point |
| --- | --- | --- |
| Shares or records a raw idea, feedback, requirement, or finding with no promotion gate | Deduplicate and capture/update it in the Linear inbox; do not create `B-xxx`, Discovery, Spec, or Active Package | Linear inbox captured, or an honest failure report |
| Says “先看看 / 分析 / 讨论 / 调研” | Use read-only analysis for one-turn work; only promote when the user asks to preserve cross-session research and the no-write guard is absent | Concise findings or promoted Discovery |
| The item needs a product decision, becomes a version/current-iteration candidate, or needs cross-session research or execution | Create/reuse one `B-xxx`, update the Linear issue, and add bidirectional links before further lifecycle work | Promoted and linked |
| Says “我决定 / 选择 / 拒绝 / 延后” | Promote if needed, then record the Decision and synchronize Backlog, Product Spec, register, and Linear | Decision synchronized |
| Says “先规划 / 设计一下 / 不要写代码” | Choose the authority lane, then create/update its contract and a plan-only Active Package when scope is approved | Stop before SDD/runtime edits |
| Says “实现 / 落地 / 修复” | Use L0 for a narrow contract-restoring fix; otherwise route to `sdd-lifecycle` with implementation authority | Validated implementation; no commit |
| Says “先规划并实现 / plan and implement / 把功能做完” without explicit closeout | Route to `sdd-lifecycle` `implement-approved-spec`; bootstrap missing Plan/SDD when product scope is approved | Validated implementation; no closeout or commit |
| Explicitly asks for “full lifecycle / 完整生命周期 / 端到端做到收尾” | Route to `sdd-lifecycle` `full-lifecycle`, pausing only for real product decisions | Closeout and archive |
| Says “继续 / 接着做” | Resolve target by explicit ID/slug, then current-conversation package, then the only Active Package; otherwise ask once and write nothing | Current authorized phase completed |
| Says “收尾 / 关闭 / 归档” | Verify evidence, reconcile contracts, move residual work to Backlog, create Closeout, and archive | Closed/Cancelled/Superseded |
| Asks status or “需要我决定什么” | Read current authorities; return one decision card unless the user explicitly asks for a 3-5 item batch | Read-only brief |

Treat explicit capture, decision, planning, implementation, continuation, or
closeout language as authorization for the corresponding repo-local updates.
The no-write guard always wins. Implementation never implies commit or closeout,
and planning plus implementation never implies `full-lifecycle`.

For “继续 / 接着做”, resolve the target in this exact order:

1. an explicit `B-xxx` or feature slug in the request;
2. the Active Package already bound to the current conversation;
3. the only registered Active Package.

If none or more than one candidate remains, ask one target-scope question and
perform zero writes until the user answers. Do not choose from Archive or infer
the target from whichever Tracker was edited most recently.

## Maintain the Lifecycle Silently

### Capture and discussion

- A raw idea starts in the Linear inbox and does not receive a `B-xxx`. Do not
  create a fallback Backlog row when Linear capture fails.
- Promote only when the item needs a product decision, becomes a version or
  current-iteration candidate, or requires cross-session research or execution.
- On promotion, create or reuse one `B-xxx` and add both the Linear issue link to
  the repo item and the `B-xxx`/repo link to Linear before claiming synchronization.
- Create Discovery only for promoted cross-session research, option comparison,
  or preserved evidence; do not create an empty package.
- Compress discussion into facts, options, decisions needed, and source links;
  do not preserve chat transcripts.
- If a Linear search, create, or update fails, state the failed operation and
  last confirmed state. Never say the idea was recorded, captured, linked, or
  synchronized when the corresponding Linear write did not succeed.

### Decisions and product contract

- After the user makes a product decision, write it immediately to the
  repo-local Decision record/register and affected Product Spec.
- Ask only about unresolved product semantics. Infer IDs, paths, metadata, and
  status transitions from the workflow.
- Keep requirements and acceptance criteria namespaced to the stable Backlog ID.

### Planning and delivery

- Choose exactly one durable authority lane before creating an Active Package:
  use Product Decision/Product Spec for work that changes PA runtime or user
  behavior; use a Governance Contract under `docs/development/governance/` for
  repo documentation, checker, CI/release tooling, or Agent-skill rules that do
  not change PA product behavior. Never put internal governance gates into a
  Product Spec merely to satisfy package metadata.
- Promote product work only after product scope is approved. Start explicitly
  authorized governance work from its user request or confirmed engineering
  finding; it does not need to pretend it passed through raw-idea Linear intake.
  Create the minimum Active Package required by the selected phase.
- Approve technical Plan/SDD artifacts after source and review gates pass when
  no unresolved user-owned product/risk decision remains; do not ask for a
  ceremonial document approval.
- Keep Tracker as the sole execution-status authority; update Feature Home and
  Active Registry only as derived mirrors.
- Route substantial implementation to `sdd-lifecycle`; let its plan, design,
  review, smoke, and validation gates govern runtime work.
- Route “先规划并实现 / plan and implement” to `implement-approved-spec`, which
  may bootstrap missing Plan/SDD but must stop after validated implementation.
- Convert new out-of-scope findings into Backlog entries instead of expanding
  the active feature silently.

### Closeout

- Close only against real validation evidence.
- Reconcile current Product, Architecture, SDD, Tracker, runtime, and release
  state before changing terminal status.
- Move every unresolved item to Backlog with a restart condition.
- Resolve the exact `docs/archive/<year>/<feature>/` destination before changing
  terminal status. If that path already exists, fail closed: do not merge,
  overwrite, auto-suffix, move, or partially archive anything.
- Record information disposition, update indexes and references, then move the
  complete package to the exact annual Archive path.
- For a Closed governance track, keep its delivered Governance Contract current.
  For Cancelled/Superseded governance, archive the unshipped/superseded GOV as a
  direct annual record. A Superseded record must link a new Current successor
  GOV; without a successor, use `Cancelled`. Never leave it current merely
  because the package reached a terminal state.
- Keep only delivered durable contracts outside Archive; never let archived
  status drive current implementation.

## Decision Protocol

When user judgment is genuinely required, return one compact card. If the user
explicitly asks for a batch decision queue, return 3-5 cards in the same shape
and keep the request read-only until the user answers:

```text
需要你决定：<one concrete product or authorization question>
建议：<agent recommendation>
影响：<value, scope, risk, or cost difference>
你回答后我会自动：<docs/runtime/status actions>
```

Do not ask about repository mechanics. If a safe recommended default exists and
the choice is reversible without changing product semantics, take it and report
the assumption instead of interrupting the user.

## Coordinate Existing Skills

- Use `sdd-lifecycle` for substantial plan, SDD, implementation, and closeout
  execution. This skill selects the route so the user does not have to name the
  SDD mode.
- Use `pa-linear-product-manager` only for the Linear/version-planning mirror.
  When both apply, this skill owns repo-doc routing and authority; the Linear
  skill owns raw-idea intake plus external issue/project hygiene. Raw ideas have
  no `B-xxx`; promoted work shares one `B-xxx` with bidirectional links and no
  duplicate questions.
- Use `personal-assistant-review` and
  `personal-assistant-review-followup` for implementation review and confirmed
  fixes.
- Use the appropriate Obsidian smoke/community/release skill only when the
  selected lifecycle phase requires it.
- Never infer commit, push, tag, publish, or release permission. Route an
  explicit commit request through `codex-commit` when available.

## Validation and Output

After lifecycle-document changes, run:

```bash
npm run docs:check
git diff --check
```

For docs-only work, do not run Build or Obsidian smoke. For runtime work, use the
validation chosen by `sdd-lifecycle` and the owning repo instructions.

Keep the final response short:

```text
已自动处理：<docs/status/runtime actions>
需要你决定：<none or one item>
当前边界：<next automatic action and ungranted git/release actions>
```

Do not explain the document hierarchy unless the user asks.
