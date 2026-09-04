# DEC-031 — B-125 检索优化采用受平台约束的默认开启

Decision ID: DEC-031
Status: Accepted
Updated: 2026-09-04
Authority: 用户于 2026-09-04 明确确认按建议将 B-125 四项能力全部设为 default on 并推进；该确认承接当轮决策卡中的 macOS/Linux/iOS 支持范围、Win32/Android 暂时强制关闭、sparse rollback 与非 Beta 特判边界
Work item: B-125

## Context

[DEC-027](./dec-027-bounded-retrieval-recovery.md) 已确定 B-125 的
`CHAR-PHRASE`、strict valid-`none_relevant`、additive Local / Deep Breadth /
Convergence PPR 和一次 relaxed recovery 行为；2026-08-30 的 closeout
也已分别给出四项 approve-rollout disposition。但当时源码仍把
`lexicalProfile`、`strictReranker`、`graphPpr` 和 `relaxedRecovery`
解析为缺省关闭，因此普通安装不会进入已批准的完整路径。

本次 B-125 shipping-default amendment 只解决“已批准能力如何成为
shipping default”，不重新设计
B-125 算法、数据边界、预算、provider 调用语义或用户界面。
Android 实体设备仍缺少 SQLite/WASM、OPFS、lexical、graph 与
recovery parity 证据；Win32 继续受 DEC-027 临时 waiver 约束。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 四项在已支持平台一起 default-on，不支持平台 mask | Beta 默认行为与未来正式行为一致；能验证 graph/rerank/recovery 的真实组合；仍可逐项回滚 | 一次开启影响面较大，需要 focused default/on/off/lifecycle 与 App/OPFS smoke | **Selected**；四项均已有 owner rollout disposition，Beta 就是验证真实默认组合的风险隔离层 |
| 分阶段 default-on | 更容易孤立单项影响 | 至少增加一个 Beta 周期，无法及早验证完整组合 | Rejected；当前没有失败证据要求再拆分 rollout |
| 继续 default-off，由 tester 修改隐藏设置 | 生产默认零变化 | 普通 BRAT 用户测不到 B-125；配置状态不一致；不代表 shipping behavior | Rejected |
| 只在 prerelease version 开启 | 可限制到 Beta build | Beta 与 Stable 语义分叉，迁移与测试矩阵加倍，Beta 不再验证真实未来默认 | Rejected |

## Decision

1. 建立独立、版本化的 B-125 retrieval rollout identity；它是
   shipping-default authority，不是 calibration evidence，并明确指向
   `featureId=B-125`、`sourceDecisionId=DEC-027` 与 `decisionId=DEC-031`。
2. 只有当 runtime platform identity 明确匹配 macOS、Linux 或 iOS 时，
   `lexicalProfile`、`strictReranker`、
   `graphPpr` 和 `relaxedRecovery` 的 build default 全部为 `true`。
3. 在 Win32、Android，以及没有明确 macOS/Linux/iOS allowlist 信号的
   unknown/incomplete platform identity 上，四项 effective value 全部强制为
   `false`。Win32/Android mask 在同时出现 allowlist 信号时仍优先。平台 mask
   优先于 raw override，且不改写 raw settings；这些 runtime 继续使用
   既有 direct/vector fallback。不得用“不是 Windows/Android”代替对已
   支持平台的 positive allowlist。
4. `retrievalOptimizationFlags` 保持 sparse internal overrides。每个明确
   boolean raw value 优先于 build default，因此显式 `false` 是逐项回滚；
   缺失或非 boolean 字段使用当前 build default。加载、启动或保存
   无关设置时不得回填或持久化隐式默认值。
5. 不增加普通用户可见的 lexical/PPR/reranker/recovery 技术开关，
   不使用 Beta-version-only 特判。
6. 本决定不改变 B-125 的 reranker 调用时机、valid
   `none_relevant` 语义、最多一次 relaxed recovery、候选/文档预算、
   graph/lexical 参数、Data Boundary、provider 信任/成本边界或
   Markdown/OPFS 所有权。`strictReranker=false` 仍按 DEC-027 执行既有
   non-empty-candidate reranking，只回滚 valid `none_relevant` whole-set hide；
   all-flags-off 不表示零 reranker 调用。
7. `RETRIEVAL_CALIBRATION_PROFILE.defaultEnabled=false` 可继续作为当时
   calibration 产物的历史来源信息，不得再当作当前 rollout
   default。只有 calibration 参数或 evidence identity 真实变化时才提升
   calibration profile；shipping-default 使用自己的 rollout version。

本决定授权 B-125 shipping-default continuation 的实现、文档与验证，
不自动授权 commit、push、Beta branch、tag、publish 或 release。

## Consequences

- Product behavior: 已支持平台的普通新安装与无 raw override 的旧
  安装会默认进入完整 B-125 路径；不要求 tester 管理内部开关。
- Architecture / data / safety: rollout policy 与 calibration profile 分离；
  sparse override 保留可逆性；平台 mask 保持 fail-closed；没有新的
  provider、vault write 或 sync surface。
- Compatibility / migration: 不迁移、回填或重写 `data.json`。旧版本缺失
  flags 代表“使用当前 build default”；已明确保存的 `false` 仍保持关闭。
- Platform scope: Android 是 DEC-031 dated amendment 下的临时 support mask，不是 Android
  不兼容或永久移除的声明；Win32 继续使用 DEC-027 的临时 waiver。
  没有明确 allowlist 信号的 unknown/incomplete identity 只表示当前不能证明属于 allowlist，
  因此按 `unsupported` fail closed，不是新平台兼容声明。
- Work created or removed: 不创建新 Feature；一个范围受限的 B-125
  continuation Active Package 承接 shipping-default 实现、focused gate、
  current-artifact App/OPFS smoke 与 Beta readiness。B-127 继续独立承接长跑/
  p95/profiler/floor-grade 认证。

## Revisit Trigger

- 已支持平台出现可重复的 crash/hang、索引损坏/失控增长、超时、
  cancel/late-result 越界、实质延迟/UI 回归或明显召回质量回归。
- 需要扩大到 Android 或 Win32；该平台必须先有当前产物的
  Memory/OPFS/lexical/graph/recovery/fallback/cancel 证据和 owner 明确决定。
- 需要改变 B-125 算法、候选预算、provider 调用、Data Boundary 或
  添加用户可见技术开关。
- 实际用户需要一个可持久的非技术整体 opt-out；该需求不得从本次
  internal rollback controls 默认外推。

## Traceability

- Source behavior decision: [DEC-027](./dec-027-bounded-retrieval-recovery.md)
- Product Spec: [PA Active Vault Indexer — B-125 shipping-default amendment](../specs/pa-active-vault-indexer-product-spec.md#102-b-125-shipping-default-amendment)
- Architecture: [VSS SQLite/WASM architecture](../../architecture/vss-sqlite-wasm-architecture.md)
- Active execution: [B-125 Shipping-Default Continuation Tracker](../../development/active/retrieval-optimization-shipping-default/tracker.md)
- Historical evidence: [B-125 closeout evidence](../../archive/2026/b-125-retrieval-optimization-closeout.md)
- Deferred performance/floor evidence: [Backlog B-127](../../backlog.md#已延期的产品与工程工作)
- Source request: Owner confirmation, 2026-09-04
- Supersedes / superseded by: supersedes only the prior pending/default-off shipping disposition; it does not supersede DEC-027 retrieval behavior or B-125 historical evidence
