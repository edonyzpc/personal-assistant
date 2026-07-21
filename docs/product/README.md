# Product 文档

本目录只保存长期有效的产品标准与当前 Product Spec。实现进度、验证日志和已经完成的开发计划不放在这里。

## 顶层标准

- [PA Product North Star](./pa-product-north-star.md) — 所有产品、UX、SDD 与 Pagelet/Memory 行为的最高标准。
- [Active Decision Register](./active-decisions.md) — repo-local 的当前产品/架构/延期决策摘要。
- [Decision Index](./decisions/README.md) — 需要完整 Context、Options、Consequences 与 Revisit trigger 的正式决策记录。
- [Low-Burden Review Principles](./pa-low-burden-review-product-principles.md) — 低管理负担与渐进信任原则。
- [Product Information Architecture](./pa-product-information-architecture-spec.md) — 当前信息架构与 surface 分工。
- [Pagelet Product Design](./pagelet-product-design.md) — Pagelet 当前产品模型。

## Capture、Recall 与 Context

- [Quick Capture and Micronote](./specs/pa-quick-capture-micronote-product-spec.md)
- [Quiet Recall and Insight Timing](./specs/pa-quiet-recall-insight-timing-product-spec.md)
- [Context Pager](./specs/pa-context-pager-product-spec.md)
- [Lightweight Graph Discovery](./specs/pa-lightweight-graph-discovery-product-spec.md)
- [Scope Recap and Theme Summary](./specs/pa-scope-recap-theme-summary-product-spec.md)
- [Retrieval Habit Profile](./specs/pa-retrieval-habit-profile-product-spec.md)

## Memory、Insight 与 Review

- [Memory Control Center](./specs/pa-memory-control-center-product-spec.md)
- [Memory Type Taxonomy](./specs/pa-memory-type-taxonomy-product-spec.md)
- [Saved Insight and Insight Ledger](./specs/pa-saved-insight-ledger-product-spec.md)
- [Insight Enhancement Layer](./specs/pa-insight-enhancement-layer-product-spec.md)

## Pagelet Delivery

- [Bubble Readiness and Recall](./specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- [Delivery Preparation Consolidation](./specs/pagelet-delivery-preparation-consolidation-product-note.md)
- [Pagelet UI/UX Hardening](./specs/pagelet-ui-ux-hardening-product-spec.md)

## Shared Product Infrastructure

- [Active Vault Indexer](./specs/pa-active-vault-indexer-product-spec.md)
- [Data Boundary](./specs/pa-data-boundary-product-spec.md)
- [Eval Harness](./specs/pa-eval-harness-product-spec.md)
- [PA Agent MCP Adapter Decision (DEC-001)](./decisions/pa-agent-mcp-adapter-decision.md)

新 Product Spec 使用 [Product Spec template](../development/templates/product-spec.md)，Accepted Decision 使用 [Decision template](../development/templates/decision.md)。外部工具只能镜像，不得成为当前产品决策的 source of truth。

Weekly Review 的独立产品形态已经被拆解并移除；历史 Spec 保存在 [archive](../archive/pa-weekly-review-product-spec.md)，不能作为当前入口。

更宽的 Pagelet Trust Layer 与 Maintenance Review 仍是未激活 proposal，已归档到 [Trust Layer](../archive/pagelet-trust-layer-product-spec.md) / [Maintenance Review](../archive/pagelet-maintenance-review-product-spec.md)，重新启动条件见 [Backlog B-112](../backlog.md#已延期的产品与工程工作)。
