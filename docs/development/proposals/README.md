# Proposal Registry

Document status: Current
Updated: 2026-08-01
Authority: Owner 保留的长期方向、边界或尚待最终验收的交付文档索引。

Proposal 不是普通 idea 的默认入口。普通需求先走 Discovery；只有需要长期保存完整约束、重启条件、安全边界，或 owner-directed experiment 尚待最终验收时才保留在这里。

| Proposal | Backlog | Current boundary | Restart condition |
| --- | --- | --- | --- |
| [Pagelet Agent direction](./pagelet-agent/pagelet-agent-proposal.md) / [Deep Discover SDD](./pagelet-agent/pagelet-agent-deep-discover-sdd.md) / [owner decision](./proposal-review-response-2026-07-28.md) / [implementation handoff](./implementation-handoff.md) | B-123 | Step 1 的 20/20 dogfood、owner 盲评、技术门、Bubble → Panel / Settings 可见验证与真实 vault 恢复均已完成；质量门通过 | Owner 决定关闭 B-123，或明确启动 B-101 / Step 2 |
| [Operations capability](./operations-agent/agent-operations-capability.md) / [boundary plan](./operations-agent/operations-agent-plan.md) / [mode SDD](./operations-agent/operations-agent-mode-sdd.md) | B-101 | 实现存在但 runtime flag 关闭，未对用户开放 | Owner 明确启动 Step 2；随后完成安全 review 与真实 Obsidian smoke |
