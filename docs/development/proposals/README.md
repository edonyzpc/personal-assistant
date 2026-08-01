# Proposal Registry

Document status: Current
Updated: 2026-08-01
Authority: Owner 保留的长期方向、边界或尚待最终验收的交付文档索引。

Proposal 不是普通 idea 的默认入口。普通需求先走 Discovery；只有需要长期保存完整约束、重启条件、安全边界，或 owner-directed experiment 尚待最终验收时才保留在这里。

B-123 / B-101 下方已命名的固定文件是 owner 明确保留的永久 handoff/proposal lane；只有这些文件可承载实施或终态，且不会把一般 Proposal 提升为 Tracker 或 Backlog 关闭 authority。一般 Proposal 仍只使用 `Needs Decision` / `Blocked`。

| Proposal | Backlog | Current boundary | Restart condition |
| --- | --- | --- | --- |
| [Pagelet Agent direction](./pagelet-agent/pagelet-agent-proposal.md) / [Deep Discover SDD](./pagelet-agent/pagelet-agent-deep-discover-sdd.md) | B-123 | Closed 2026-08-01：20/20 修复版 dogfood、owner 盲评、配额、provider-free runner、Bubble → Panel / Settings 可见验证与真实 vault 恢复全部通过 | 永久保留为 Step 1 方向与设计证据；不再承担待办状态 |
| [Owner decision](./proposal-review-response-2026-07-28.md) / [implementation handoff](./implementation-handoff.md) / [Operations capability](./operations-agent/agent-operations-capability.md) / [Step 2 SDD](./operations-agent/operations-agent-step2-sdd.md) / [historical boundary plan](./operations-agent/operations-agent-plan.md) / [historical mode SDD](./operations-agent/operations-agent-mode-sdd.md) | B-101 | Step 2 Closed 2026-08-01：4 个 core tools、inline confirm / partial result / drift-safe undo、content-free audit、`make deploy`、test-vault 与真实 vault dogfood 全部通过 | 仅在 owner 明确授权 Step 3 Pagelet + Operations 联动后重启；额外写工具仍需独立需求证据 |
