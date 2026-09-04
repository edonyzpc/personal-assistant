# B-125 Retrieval Shipping-Default Continuation

Document status: Current
Updated: 2026-09-04
Work item: B-125
Authority: 本 track 的简短入口与 owning contract 路由。
Decision: [DEC-031 — B-125 检索优化采用受平台约束的默认开启](../../../product/decisions/dec-031-b125-retrieval-shipping-default.md)
Product spec: [PA Active Vault Indexer — B-125 shipping-default amendment](../../../product/specs/pa-active-vault-indexer-product-spec.md#102-b-125-shipping-default-amendment)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 只在明确 macOS、Linux 和 iOS identity 上让 B-125 四项检索能力使用版本化
  build default 自然开启，同时保留 sparse 显式逐项回滚，并让
  Win32/Android 与没有 allowlist signal 的 unknown/partial identity 继续 fail closed。
- Delivery class: L3（共享 retrieval runtime、平台兼容、OPFS/lexical
  lifecycle 与 Beta release-sensitive validation）。
- Explicit non-goals: 不改 B-125 算法/provider/Data Boundary/预算，不增
  普通 Settings 技术开关，不做 Beta-only 特判，不扩展 B-127 性能认证。

## Artifacts

- Tracker: [Development Tracker](./tracker.md)
- SDD: [Software Design Document](./sdd.md)
- Current Product/Architecture contract: [DEC-031](../../../product/decisions/dec-031-b125-retrieval-shipping-default.md), [B-125 Active Vault Indexer Product Spec](../../../product/specs/pa-active-vault-indexer-product-spec.md#102-b-125-shipping-default-amendment), [VSS SQLite/WASM architecture](../../../architecture/vss-sqlite-wasm-architecture.md)

执行状态、下一步、finding 与验证证据只写 Tracker，不在本页镜像。
