# Engineering Governance

Document status: Current
Updated: 2026-07-19
Authority: PA 仓库的 engineering governance/tooling contract 索引；不定义 PA runtime 或用户产品行为。

本目录保存跨文档生命周期、Agent 路由、repo checker、CI/release tooling 与工程授权边界的长期契约。它与 Product Decision/Product Spec 分离：只有改变 PA runtime、Obsidian UI 或用户可感知行为时，才进入 Product Decision/Spec 链。

## Current Contracts

| Governance ID | Contract | Status | Work item | Delivery authority |
| --- | --- | --- | --- | --- |
| GOV-001 | [Agent-Managed Project Lifecycle](./gov-001-agent-managed-project-lifecycle.md) | Current | B-115 | [Archived Package](../../archive/2026/agent-managed-docs-lifecycle/README.md) / [Closeout](../../archive/2026/agent-managed-docs-lifecycle/closeout.md) |
| GOV-002 | [Master-First Branch And Beta Packaging](./gov-002-master-first-branch-and-beta-packaging.md) | Current | B-117 | [Active Package](../active/master-first-branch-management/README.md) / [Tracker](../active/master-first-branch-management/tracker.md) |

## Boundary

- Governance contract 可以约束 repo docs、Agent workflow、checker、CI 与 release tooling，但不自行批准产品能力。
- 若 governance/tooling 修改会改变 PA runtime、数据/隐私边界、Obsidian UI 或用户行为，必须另建 Accepted Product Decision 与 Approved Product Spec，再由对应 Active Package 交付。
- `GOV-xxx` 是稳定 contract ID；执行状态只在 Active Tracker，完成后 package 进入 Archive，Current governance contract 继续留在本目录。
- 新 contract 使用 [Governance Contract template](../templates/governance-contract.md)，并同步本索引、[Development index](../README.md) 与 [docs index](../../index.md)。
