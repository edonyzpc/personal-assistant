# DEC-035 — 有界代码清理与 Pagelet 旧范围控件退役

Decision ID: DEC-035
Status: Accepted
Updated: 2026-09-13
Authority: Owner 在本次代码清理讨论中明确确认的产品取舍；仅记录已确认边界，不授予实现或 Git/release 权限。
Work item: B-136

## Context

当前 Panel 仍展示时间范围、逐笔记勾选和 Review selected，但
`reviewSelectedScope()` 已直接调用以活动 Markdown 为 anchor 的 Deep Discover，
没有传递该选择。旧控件可达且具有误导性，不能归为纯死代码。

[Pagelet Product Design](../pagelet-product-design.md#foreground-scope) 原先承诺
Panel 可扩展时间范围和 included/skipped 调整；[B-123 迁移设计](../../development/proposals/pagelet-agent/pagelet-agent-deep-discover-sdd.md)
保留旧命令别名并更换 provider 管线，不足以单独推导全部范围能力已经退役。
本决定是 2026-09-13 的窄修订，不回填历史批准。

## Options Considered

| 选择 | 收益与代价 | 结论 |
| --- | --- | --- |
| 为旧选择器重新实现多范围分析 | 恢复旧交互承诺，但新增检索、权限、成本和结果语义设计 | 不纳入此次清理 |
| 删除旧选择器，保留当前 Deep Discover 与兼容命令 | 去掉无效控制，维持已在使用的探索路径 | Owner 已确认 |
| 清退整个 scope/recap/recall 体系及外围功能 | 会波及仍有效的来源、后台、保存和管理能力 | 超出本次决定 |

## Decision

1. 删除旧 Panel 的 current/yesterday/last3/last7 预设、逐笔记 include/exclude、
   Review selected 语义及其专用状态；同步撤回对应产品文档承诺，不新增替代选择器。
2. 保留当前以活动 Markdown 为起点的 Deep Discover，可探索 Data Boundary 允许的
   其他笔记。旧命令 ID、名称及当前 alias 路由保留；`open-panel` 保持打开面板的行为。
3. 保留全局来源排除、来源查看、上下文控制、Panel/Tab、正常 Review 保存，
   以及 Memory、Review Queue、Maintenance、Operations 的既有权限与恢复边界。
4. 插件/主题管理等外围能力、Statistics 展示、Share Card 导出及字体暂时保留。
   Records Preview 与旧录记入口继续分开；不由此推导 Statistics 采集或历史清理授权。
5. 其余清理以有效行为保持为原则。删除必须有生产可达性、构建入口和兼容性证据；
   不因名字含 legacy、bundle 未包含、仅被测试调用或编译通过就判定可删。

Owner 的“上面的判断是符合我的预期的”确认了上述窄边界。
Accepted 表示产品选择成立，不表示清理代码已完成或整份实施计划已获执行授权。

## Consequences

- 用户不再看到与实际运行范围不一致的旧控件；活动笔记是 anchor，不是唯一允许来源。
- 不改变 provider、检索算法、预算、数据发送准入、存储格式、旧 reader、迁移、确认或 Undo。
- 仅退役实现的专用依赖可随删；共享 ScopeResolver、前台 PreloadBudget 等继续保留。
- 不删除用户历史笔记、会话、Review Queue 内容，不恢复已迁移掉的 single-shot fallback。

## Revisit Trigger

真实使用提出日期范围 Recap 或手选多笔记需求时，单独设计其数据、成本和结果契约；
若清理发现仍有生产消费者、生命周期入口或必要恢复路径，则保留该项并记录证据。

## Traceability

- Product Spec: [Bounded Cleanup](../specs/pa-bounded-code-cleanup-product-spec.md)
- Delivery: [B-136 Feature Home](../../development/active/bounded-code-cleanup/README.md)
- Supersedes: 仅修订 Pagelet Product Design 的旧 Panel 范围调整承诺；不整体替代 B-123 或 Scope Recap/Quiet Recall 契约。
- Deferred architecture work: [B-105 / Backlog](../../backlog.md)
