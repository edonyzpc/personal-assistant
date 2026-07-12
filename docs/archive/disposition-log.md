# Documentation Disposition Log

Document status: Current
Updated: 2026-07-12
Authority: tracked Markdown 被吸收或删除时的信息连续性记录；它不替代 feature Closeout。

`deleted-after-absorption` 只有在独有结论已进入明确目标后才能使用。目录级规则用 `/**`，只覆盖表中说明的那一次清理，不是未来无限删除许可。

| Date | Original path | Disposition | Current authority / destination | Reason |
| --- | --- | --- | --- | --- |
| 2026-07-11 | `docs/optimization/**` | deleted-after-absorption | [Repo optimization final report](./repo-wide-optimization-2026-07-10-final-report.md) and [Backlog B-111](../backlog.md) | 39 份 task/review/verification/baseline 日志的结论、验证、回滚与遗留项已合并；最终报告单独保留 |
| 2026-07-11 | `docs/todo.md` | absorbed | [Project Backlog](../backlog.md) and [pre-2.8 historical TODO](./project-todo-pre-2.8.0.md) | 未完成项进入 Backlog，旧版本状态保留为历史证据 |
| 2026-07-11 | `docs/active-decisions.md` | absorbed | [Active Decision Register](../product/active-decisions.md) and the [section-by-section absorption map](#head-active-decisions-absorption-map) | 原文件是外部 Memory 的导出镜像，不再作为权威；稳定决定进入 repo-local Decision/Product/Architecture/Backlog，旧来源标签与流程约束保留在明确的历史/操作入口 |

## HEAD active-decisions absorption map

以下映射覆盖被删除的 `HEAD:docs/active-decisions.md`，证明旧文件各类独有信息的去向。原导出文件不再作为 current authority；当前结论以 repo-local Decision、Product Spec、Architecture 与 Backlog 为准，外部 Memory 文件名只保留为来源/provenance。

| Original section / constraint | Current authority or historical destination | Absorption proof |
| --- | --- | --- |
| Export header and `source:` labels | [Memory cleanup playbook](../../.agents/playbooks/pa-memory-cleanup-spec.md) | Playbook 保留旧 Memory 文件分类、来源名称、迁移规则与长期约束；外部 Memory 不再被描述为 source of truth |
| Product direction: North Star、quiet recall、Memory governance、双产品线、目标用户/市场 | [Active Decision Register](../product/active-decisions.md), [Product North Star](../product/pa-product-north-star.md), [Architecture overview](../architecture/architecture-overview.md) | 当前产品决定、目标用户与市场方向已有 repo-local authority；旧导出仅是这些结论的历史镜像 |
| Memory `inferred_behavior` 三次独立对话确认 | [AI Insight Foundation SDD](./sdd-ai-insight-foundation.md) | 历史 SDD 保留类型、置信度与 recurrence 阈值的原始设计/实现证据 |
| Context budget/projector/compaction、WASM、LangChain、Pagelet 与重构边界 | [Active Decision Register](../product/active-decisions.md), [PA Agent architecture](../architecture/pa-agent-architecture-plan.md), [VSS architecture](../architecture/vss-sqlite-wasm-architecture.md), [Pagelet product design](../product/pagelet-product-design.md), [architecture refactor plan](./architecture-refactor-plan.md) | 仍有效的约束进入 current contract；阶段数、拆分方案等完成期细节保留为 archive provenance |
| “Don't do” 与 deferred 项 | [Active Decision Register](../product/active-decisions.md) and [Project Backlog](../backlog.md) | 当前禁止项、延期原因与 restart condition 分别由 Decision 与 Backlog 管理，不再依赖外部 Memory 镜像 |
| `make deploy`、signed commit/no co-author、`@deprecated` 下线锚点、UI/UX 五阶段审计方法 | [AGENTS.md](../../AGENTS.md), [SDD lifecycle](../../.agents/skills/sdd-lifecycle/SKILL.md), [UI/UX audit skill](../../.agents/skills/ui-ux-design-audit/SKILL.md), [Memory cleanup playbook](../../.agents/playbooks/pa-memory-cleanup-spec.md) | 可执行规则进入 repo-local agent/workflow 文档；旧反馈来源名继续由 playbook 保存 |
| Completed-plan list | [CHANGELOG](../../CHANGELOG.md), [v2 post-release tracker](./v2-post-release-spec-driven-development.md), [Write Action handoff](./write-action-design-handoff.md), [v2.1 decisions](./v2.1.2-decisions.md) | 完成日期、发布线与实现/验证证据由 release history 和 archive records 承接 |

新删除记录必须写原路径、承接目标和为什么不会丢失信息；不能只写“已清理”。
