# 2026 Structured Archive

Document status: Current
Updated: 2026-07-12
Authority: 2026 年按新 Documentation Workflow closeout 的完整 track 与 discovery/decision/governance 终态记录索引。

本页登记按新 Documentation Workflow 完成 closeout 的结构化 package。既有历史文档继续保留在 `docs/archive/` 根目录，不做无收益的机械迁移。

## Closed / Cancelled Tracks

| Feature | Work item | Final status | Closed | Feature Home | Current authority |
| --- | --- | --- | --- | --- | --- |
| Agent-Managed Docs Lifecycle | B-115 | Closed | 2026-07-12 | [Feature Home](./agent-managed-docs-lifecycle/README.md) | [GOV-001](../../development/governance/gov-001-agent-managed-project-lifecycle.md) |

## Rejected / Cancelled Discovery And Decisions

| Record | Work item | Final status | Date | Current successor / reason |
| --- | --- | --- | --- | --- |

## Cancelled / Superseded Governance Records

| Governance record | Work item | Final status | Date | Successor / reason | Archived package |
| --- | --- | --- | --- | --- | --- |

Governance track `Closed` 时，Current GOV 继续保留在 `docs/development/governance/`，package 从本页链接该 authority。Governance track `Cancelled` 时，未交付 GOV 使用 `Document status: Archived` + `Delivery status: Cancelled`；`Superseded` 时使用 `Document status: Archived` + `Delivery status: Superseded`，并必须链接一个新的 Current successor GOV；没有 successor 时使用 `Cancelled`。两者都作为本目录直属 `gov-xxx-<slug>.md` 登记。

未来完整 track 使用：

```text
docs/archive/2026/<feature>/
  README.md
  plan.md
  sdd.md       # only when the track entered SDD phase
  tracker.md
  closeout.md
```

新增 package 时在此登记 Feature Home、最终状态、完成日期与当前 Product/Architecture/Governance authority。完整 package 始终归档；年度直属 Decision/Product Spec/GOV terminal record 不能替代 package。

未进入 Active Package 的 Rejected/Cancelled Discovery 或 Decision 直接作为单文件放在本目录，例如 `<slug>-discovery.md` 或 `<decision-id>-<slug>.md`，必须标记 Archived/终态并在本索引登记；不要创建空 plan/SDD/tracker。

Governance terminal record 示例：`docs/archive/2026/gov-002-example-tooling.md`。它只保存 Cancelled/Superseded contract authority；如果该 governance track 曾进入 Active Development，仍必须同时存在 `docs/archive/2026/<feature>/` 完整 package。
