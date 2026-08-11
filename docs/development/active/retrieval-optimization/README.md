# Retrieval Pipeline Optimization

Document status: Current
Updated: 2026-08-08
Work item: B-125
Authority: 本 track 的简短入口与 owning contract 路由。
Decision: [DEC-027 — 采用有界、汇合感知的检索恢复](../../../product/decisions/dec-027-bounded-retrieval-recovery.md)
Product spec: [PA Active Vault Indexer — B-125 scoped retrieval optimization](../../../product/specs/pa-active-vault-indexer-product-spec.md#101-b-125-scoped-retrieval-optimization)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 以 owner-confirmed `CHAR-PHRASE` 先修复本地 FTS5 中文 lexical correctness，
  再让 Chat 和 Pagelet 通过共享
  的 direct hybrid 与 additive Local / Deep Breadth / Convergence substrate，在严格
  候选、来源、Data Boundary 和 run budget 内获得更好的一跳与 2–3 hop 召回、多 seed
  汇合信号与一次失败恢复机会。
- Delivery class: L3 — 改变共享 retrieval runtime、provider 输入、Data Boundary 与
  Pagelet insight 行为。
- Explicit non-goals: 不做完整 CEPS 子图提取、全局社区检测、用户可见 RAG/Graph
  设置、额外模型级联、超过一次 relaxed retry、超过两个 Pagelet insights，或任何写入
  能力；B-125 不引入 SPLADE、外部搜索引擎或 semantic retry rewrite。未来 fixture
  只能触发新的 owner decision，不能自动扩展本 track。

## Artifacts

- Tracker: [Development Tracker](./tracker.md)
- Plan: [Delivery Plan](./plan.md)
- SDD: [Software Design Document](./sdd.md)
- Current product contracts:
  [DEC-027](../../../product/decisions/dec-027-bounded-retrieval-recovery.md)、
  [Active Vault Indexer](../../../product/specs/pa-active-vault-indexer-product-spec.md#101-b-125-scoped-retrieval-optimization)、
  [Data Boundary](../../../product/specs/pa-data-boundary-product-spec.md)、
  [Pagelet Product Design](../../../product/pagelet-product-design.md)

执行状态、下一步、finding 与验证证据只写 Tracker。
