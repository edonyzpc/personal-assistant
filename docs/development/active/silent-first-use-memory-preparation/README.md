# First-Run AI Setup And Silent Memory Preparation Development Track

Document status: Current
Updated: 2026-08-23
Work item: B-126
Authority: 本 track 的简短入口与 DEC-028 owning contract、DEC-029 scoped decision 及 B-126 验证路由。
Decision: [DEC-028 — Silent Memory auto-prepare for first use](../../../product/decisions/dec-028-silent-memory-auto-prepare.md)
Product spec: [First-Run AI Setup And Silent Memory Preparation Product Spec](../../../product/specs/pa-silent-first-use-memory-preparation-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 常用 provider 用户可在 Chat 内完成可信的 preset/token 配置，首次 Settings 聚焦 AI Provider；首次 Chat 立即 answer-now 并在后台准备 whole eligible vault Memory，只在 durable usable success 后启用。
- Delivery class: L3
- Explicit non-goals: Fresh Custom/wizard/Test Connection/PA Cloud、新 provider/model、progressive/recent-first build、embedding performance 调整、Pagelet/Memory Extraction 权限、release timing。

## Artifacts

- Tracker: [Development Tracker](./tracker.md)
- SDD: [Software Design Document](./sdd.md)
- Current Product/Architecture contract: [B-126 Product Spec](../../../product/specs/pa-silent-first-use-memory-preparation-product-spec.md)、[DEC-029 scoped decision](../../../product/decisions/dec-029-inline-ai-setup-and-settings-focus.md)、[VSS SQLite/WASM Architecture](../../../architecture/vss-sqlite-wasm-architecture.md)、[VSS Local State](../../../architecture/vss-local-state-plan.md)、[VSS Embedding Refresh](../../../architecture/vss-embedding-refresh.md)、[PA Data Boundary](../../../product/specs/pa-data-boundary-product-spec.md)

执行状态、下一步、finding 与验证证据只写 Tracker，不在本页镜像。
