# Proposal Registry

Document status: Current
Updated: 2026-07-31
Authority: Owner 保留的长期方向、边界或尚待最终验收的交付文档索引。

Proposal 不是普通 idea 的默认入口。普通需求先走 Discovery；只有需要长期保存完整约束、重启条件、安全边界，或 owner-directed experiment 尚待最终验收时才保留在这里。

| Proposal | Backlog | Current boundary | Restart condition |
| --- | --- | --- | --- |
| [Pagelet Agent direction](./pagelet-agent/pagelet-agent-proposal.md) / [Deep Discover SDD](./pagelet-agent/pagelet-agent-deep-discover-sdd.md) / [owner decision](./proposal-review-response-2026-07-28.md) / [implementation handoff](./implementation-handoff.md) | B-123 | Step 1 runtime、review 与本地部署门已完成；修复版真实对照与 app 内验证尚未闭环 | Daily quota 恢复且 Mac 解锁后，完成 20+ cases、同版本 baseline 盲评与可视验证 |
| [Operations capability](./operations-agent/agent-operations-capability.md) / [boundary plan](./operations-agent/operations-agent-plan.md) / [mode SDD](./operations-agent/operations-agent-mode-sdd.md) | B-101 | 实现存在但 runtime flag 关闭，未对用户开放 | Owner 明确启动 Step 2；随后完成安全 review 与真实 Obsidian smoke |
