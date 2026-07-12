# DEC-011 — Preserve Capability And Policy Boundaries

Decision ID: DEC-011
Status: Accepted
Updated: 2026-07-12
Authority: PA Agent capability registration、permission 与 future action safety boundary。
Work item: Historical capability boundary

## Context

CapabilityRegistry、PolicyEngine 与 capability kinds 增加了结构成本，但它们隔离 read-only、network-read 与 action 权限，也是 Operations Agent 未来不弱化安全边界的基础。

## Options Considered

| Option | Benefit | Cost / risk |
| --- | --- | --- |
| 合并/删除 policy layers | 短期代码更少 | 权限边界退化，未来 action 容易绕过 gate |
| 保留并按窄接口演进 | 安全语义稳定、provider failure 可隔离 | 需要持续维护一致性 |

## Decision

不为短期简化删除 CapabilityRegistry、PolicyEngine 或 capability kinds。任何替代架构都必须保留等价的注册、平台、权限、source boundary、failure 与 confirmation contract，并经过单独批准。

## Consequences

- Read/network/action capability 不能通过 provider shortcut 静默互换。
- Operations Agent 不能以“已有 append implementation”为理由绕过 product/runtime gate。
- 行为保持型重构可以拆小类，但不能缩窄安全模型。

## Revisit Trigger

有 source-verified 替代设计能保留全部安全语义、减少真实维护成本并通过安全 review 时复议。

## Traceability

- [PA Agent Architecture](../../architecture/pa-agent-architecture-plan.md)
- [Operations Agent Proposal](../../development/proposals/operations-agent/operations-agent-plan.md)
- [Active Decision Register](../active-decisions.md)
