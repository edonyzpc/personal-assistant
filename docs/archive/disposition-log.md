# Documentation Disposition Log

Document status: Current
Updated: 2026-07-21
Authority: 当前 tracked Markdown 删除且非内容连续移动时的紧凑吸收记录。

| Date | Original path | Disposition | Current destination | Reason |
| --- | --- | --- | --- | --- |
| 2026-07-22 | `docs/featured-image-model-upgrade-plan.md` | deleted-after-absorption | [Backlog](../backlog.md) | Wan 2.7 已实现行为由源码与测试承担；唯一未完成的真实 provider smoke 保留为 B-005，历史计划可从 Git 恢复。 |
| 2026-07-22 | `docs/pa-agent-product-safety-review.md` | deleted-after-absorption | [PA Agent MCP adapter decision](../product/decisions/pa-agent-mcp-adapter-decision.md) | 已确认的 read/network-read 安全边界已吸收到当前 Product Decision 与运行时测试，逐轮 review 记录不再作为当前 authority。 |
| 2026-07-22 | `docs/pagelet-product-design.md` | absorbed | [Pagelet product design](../product/pagelet-product-design.md) | 产品设计迁入 Product lane；当前目标保留在新路径并继续演进。 |
| 2026-07-22 | `docs/todo.md` | absorbed | [Backlog](../backlog.md) | 旧短期状态板中的未完成事项已去重并吸收到当前 Backlog、Roadmap 或对应 contract。 |
| 2026-07-22 | `docs/v2.8.1-feedback-fix-plan.md` | deleted-after-absorption | [Development roadmap](../development-roadmap.md) | v2.8.1 修复结果已进入源码、测试与 Changelog；当前 patch-line 状态由 Roadmap 和 release metadata 承担。 |
| 2026-07-22 | `docs/vss-dirty-state-optimization-plan.md` | deleted-after-absorption | [VSS embedding refresh](../architecture/vss-embedding-refresh.md) | dirty-state、verify queue 与 rolling-hash 行为已吸收到当前 VSS architecture 和回归测试。 |
| 2026-07-21 | `docs/development/active/master-first-branch-management/**` | deleted-after-absorption | [GOV-002](../development/governance/gov-002-master-first-branch-and-beta-packaging.md) | B-117 的最终规则、traceability 与验证证据已吸收到 Current contract、release tooling、operations docs 与 focused tests。 |
| 2026-07-21 | `docs/archive/**` | deleted-after-absorption | [Archive retention policy](./README.md) | 删除无任何当前源码或文档入链的历史过程噪声；瘦身前内容可从 Git commit `22940c94` 恢复。 |
