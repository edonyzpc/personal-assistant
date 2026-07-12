# DEC-003 — Preserve The Dual Product Line

Decision ID: DEC-003
Status: Accepted
Updated: 2026-07-12
Authority: PA 产品边界与新增投资方向。
Work item: Historical product boundary

## Context

PA 同时包含成熟的 Obsidian 管理工具与增长中的 AI Chat/Memory。讨论中的取舍是拆成两个插件、弱化管理工具，或保持同一产品并把新增资源优先给 AI 侧。

## Options Considered

| Option | Benefit | Cost / risk |
| --- | --- | --- |
| 拆分插件 | 定位更单一 | 破坏既有用户工作流、发布与设置连续性 |
| 弱化管理工具 | 减少表面复杂度 | 丢失 PA 已有产品价值与差异化 |
| 保持双线，新增投资优先 AI | 兼容既有价值并推进 North Star | 需要清晰 IA，避免 surface 堆叠 |

## Decision

保持“管理工具 + AI Chat/Memory”双产品线，不拆分插件、不弱化管理能力；新增产品投资优先支持 Capture、Memory、Recall 与 source-backed AI 体验。

## Consequences

- Product IA 必须让两条线可理解，而不是把所有能力挤进 Chat/Pagelet。
- 设计 review 不能用“更像纯 AI 产品”作为删除管理工具的充分理由。
- 新 feature 仍需通过 North Star，不因统一插件而自动获得 surface 权限。

## Revisit Trigger

只有用户明确批准新的产品定位，或真实分发/维护证据证明统一插件不可持续时复议。

## Traceability

- [Product North Star](../pa-product-north-star.md)
- [Product Information Architecture](../pa-product-information-architecture-spec.md)
- [Active Decision Register](../active-decisions.md)
