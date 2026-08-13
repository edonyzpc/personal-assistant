# Retrieval Pipeline Optimization — Delivery Plan

Document status: Approved
Updated: 2026-08-13
Work item: B-125
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Decision: [DEC-027](../../../product/decisions/dec-027-bounded-retrieval-recovery.md)
Product spec: [PA Active Vault Indexer — B-125](../../../product/specs/pa-active-vault-indexer-product-spec.md#101-b-125-scoped-retrieval-optimization)
SDD: [Software Design Document](./sdd.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

### Goals

1. 以 owner-confirmed `CHAR-PHRASE` 修复 FTS5 CJK 索引/query token 不同构，建立可
   评测的 title/heading/body/path lexical surface，并保留 BM25 + RRF 的轻量本地架构。
2. 修复 reranker 空 ranking、模型选择、invalid-output 与候选泄漏问题。
3. 通过 additive Local / Deep Breadth / Convergence 三条候选 lane，提高一跳、
   2–3 hop 与多 seed 汇合候选召回，同时保持 semantic/source evidence gate。
4. 在不读取 excluded 内容的前提下，允许一个 excluded Markdown opaque bridge 保留
   有价值的本地链接拓扑。
5. 由 Chat/Pagelet Host Policy 各自管理一次 run-scoped relaxed retry；Pagelet 可返回
   0–2 个独立验证 insights。
6. reranker/model 异常 fail open 并保留有界 direct + graph 候选；PPR-only 异常仅
   丢弃 Deep/Convergence，共享 graph/Boundary/embedding/Worker 异常才 direct-only。

### Non-goals

- 不做 Louvain/Leiden/community snapshot 或全局 graph product。
- 不实现 CEPS `EXTRACT`、downhill DAG、path DP、connector budget 或 subgraph `H`。
- 不向模型暴露完整 candidate pool、PPR score、lane 或 opaque bridge identity。
- 不新增第二次 reranker model fallback call，不超过一次 relaxed retry。
- 不把两个 Pagelet insights 当作配额，不用模板补齐。
- 不读取 whole note 代替 query-aligned chunk selection，不重新 embedding query。
- B-125 不引入 SPLADE、外部搜索引擎、默认 trigram CJK surface 或新的 semantic retry
  rewrite；未来 fixture 只能触发新的 owner decision，不能自动扩展本 track。
- 不增加写入、Operations 或 Vault/source schema；不做跨设备或用户数据迁移。允许
  versioned device-local derived FTS index rebuild。
- 不以全局 VSS schema/profile bump、清空 chunks/vectors 或重新 embedding 代替独立的
  lexical profile migration；不把已知 index/query 不同构的旧 FTS 称为 hybrid fallback。

## Delivery Slices

| Phase | Outcome | Primary requirement | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| Phase 0A — lexical evidence baseline | real sqlite-wasm MATCH harness compares current baseline、`BIGRAM-U1` primary candidate、`CHAR-PHRASE` deterministic comparator、explicit-locale/fingerprinted `INTL-WORD` challenger and trigram limitation control；no production behavior change | B-125/REQ-08 evidence prerequisite | frozen CJK/English/mixed/title/heading/path/error-code/long-note labels；candidate Top-8/English-safety/error-free/metadata-reachability gates；quality/cost report | passing only produces an OD-06A shortlist；evidence不足时不选择 shipping profile；不得用已知失效的中文 FTS 选择 rewrite、RRF 或 graph 参数 |
| Phase 0B — corrected lexical profile | owner-confirmed `CHAR-PHRASE` exact shared index/query normalization；independent `lexicalProfileVersion`；explicitly confirmed lexical-only shadow rebuild and atomic switch；separately rankable title/heading/body/bounded path；BM25 + RRF | B-125/REQ-08 | real MATCH regression；confirm/cancel/progress、crash/abort、concurrent incremental-write、Recall/cost/supported-runtime and pragmatic iPhone performance gates | stale/rebuilding/failed lexical state uses honest vector/direct-only；never global reset、provider call、re-embedding or source mutation |
| Phase 1 — strict rerank and projection | deterministic zero-candidate result；policy-or-Chat model selection；strict parser including partial `needsMoreEvidence`；latest-Markdown candidate materialization and Boundary/currentness revalidation before provider and final projection；direct-first fail-open；Host-only pool；8-document allocator | B-125/REQ-01、02 | focused unit/integration tests + typecheck + provider leakage/currentness spies | unavailable/invalid rerank keeps bounded direct-hybrid-first → graph-cosine candidates；newly excluded/stale candidates are dropped, never sent or cited |
| Phase 2 — convergence-aware PPR | immutable three-class Boundary snapshot/epoch；complete Local cosine；fixed-alpha error-driven Deep Breadth/Convergence；whole-PPR graph/state/memory/deadline preflight；cancelable bounded Worker；membership nomination + cosine fill → graph≤6 | B-125/REQ-03、04、07 | algorithm/boundary/Worker cancellation + supported-runtime/current-iPhone pragmatic performance gate | unsafe/changed snapshot or shared embedding/Worker failure is direct-only；PPR preflight/solver failure drops all Deep/Convergence；safe complete Local may remain |
| Phase 3 — Host-owned recovery and Pagelet depth | per-Chat-stream one-token coordinator；single cumulative evidence projection；strict partial retry producer；stable-identity exact-repeat push-down；same-run Pagelet Host staging control while terminal output stays natural Markdown；atomic non-empty 0–2 insight collection；temporal preservation | B-125/REQ-05、06 | coordinator/finalization reserve、push-down、Pagelet natural-Markdown 0/1/2/cache/delivery、flag default/off/teardown tests + deployed Obsidian smoke | no retry when token、deadline/reserve、currentness、time scope、stable identity or independent lead cannot be proved；MemorySearchTool remains stateless |

Phase 0A evidence → OD-06A `CHAR-PHRASE` selection → Phase 0B → Phase 1 → Phase 2 → Phase 3。
Phase 0A 只建立 evidence，不改变 production runtime；Phase 0B 才实现 owner-confirmed
profile，避免形成“必须先实施才能批准实施”的循环。Phase 2 依赖 Phase 1 的 bounded reranker input；
Phase 3 依赖 Phase 1 的可信 verdict 和 Phase 2 的 relaxed graph path，但在 PPR 安全
降级时仍可通过 direct hybrid relaxed 参数执行一次恢复。OD-05A 已确认复用首次 query/
lexical plan，并以 exact-evidence replay suppression 在候选席位上推动新证据；B-125 不
新增 semantic rewrite。Host 自动执行、partial evidence 合并和 deadline 已由 SDD
EC-03 在已确认语义内收束为工程合同，无需新增 owner 选择。

## Engineering Closure Contracts

这些合同收束完整 SDD 审查发现的 source-derived 缺口；它们不改变已确认产品边界，也不
把 EC-02 的任何 tuning 数值批准为 shipping/default。为让同一候选可以做生产 parity、
OPFS、真机与真实 reranker 评测，离线 winner 可以作为 versioned、default-off、明确
`provisional` 的 dormant flag-on payload 接入；这只是验证载体，不是 rollout 决定。

### Phase 0B lexical profile and migration

1. `CHAR-PHRASE` 的 index/query 共享纯函数必须固定为：先 NFC；再用
   `Intl.Segmenter("und", { granularity: "grapheme" })` 切分；只把
   `Script_Extensions=Han|Hiragana|Katakana` 且包含 Unicode Letter/Mark 的 grapheme
   编码为 `c` + 各 code point 小写十六进制（多 code point 以 `x` 连接）的原子 token；
   连续 CJK query 使用相邻 phrase。CJK punctuation/separator 不得成为 lexical atom，
   非 CJK 继续走经 NFC 与安全转义的 `unicode61` 词法面。不得在 B-125 中静默扩展到
   Hangul 或换用 locale-dependent word segmentation。
2. 引入独立 `lexicalProfileVersion`，不得复用 embedding profile signature 或全局
   `VSS_SCHEMA_VERSION`。至少区分 `stale`、`awaiting_confirmation`、`rebuilding`、
   `ready`、`failed`、`unavailable`；非 `ready` 时禁止查询已知不同构的旧 FTS，继续
   vector/direct-only。
3. potentially costly profile rebuild 由 `MemoryManager` 呈现显式 confirm/cancel/progress：
   说明仅重建 device-local derived lexical index、笔记不变、不会调用 provider/重新
   embedding，并报告本地时间/空间成本。取消或失败不阻塞 vector retrieval。
4. 重建通过可释放 VSS exclusive write queue 的 bounded Worker batches，从当前 Boundary-
   allowed `vss_chunks` 构建 shadow generation；不得发一个占住现有三层串行队列的
   monolithic request。foreground vector/chunk read 在 batch 间优先 interleave，最长只等
   一个 calibrated batch。不得 reset/delete/replace chunks、vectors 或 files。
5. migration coordinator 跨 batch 持有 logical epoch；interleaved upsert/delete/rename 在
   primary transaction 同时记录 migration delta/dirty epoch，切换前 replay，或使 shadow
   失效。完整 row/vocab/profile 验证后，用一次短 transaction 同时切换 SQLite canonical
   `LexicalProfileMarker` 与 active generation；IndexedDB 仅镜像，不是 readiness authority。
   crash/abort 丢弃 incomplete generation；`ready` 后 chunk/lexical 继续同事务，永不 mixed。

### Provider currentness and Data Boundary

1. 在 reranker provider 调用前，Host 对最多 18 个候选读取 latest Markdown，按 Chat/
   Pagelet 当前组合 policy 重新判断 path、inline/frontmatter tag、generated policy 与
   content hash/anchor/stable chunk identity；只有 live-readable、allowed、current 的
   query-aligned excerpts 可进入 provider。MetadataCache 只是优化，不能作为允许证明。
   这次 live read 是 provider safety/currentness gate，不得被 Worker 用来以 whole-note
   similarity 代替 query-aligned indexed chunks。
2. Worker 返回后、reranker 返回后以及 final documents/sources/insights 投影前，复核
   immutable snapshot epoch 或重新 materialize；变化、缺失或 newly denied 的候选直接
   丢弃。Sources 只能从最终存活文档派生，opaque identity/content 永不进入 provider、
   observation、log、replay 或 why-shown。每个后续 Chat/Pagelet model request 组装
   context 时，还必须以 Host-only snapshot handle 对已投影 Memory 文档再次 live-read/
   revalidate 并重写 allowlist observation；不能把旧 transcript text 当成允许证明。
3. reranker strict envelope 为 `partially_relevant` 提供必填 boolean
   `needsMoreEvidence`。只有 schema-valid `true` 可作为 partial retry 的确定 producer；
   missing/type mismatch/contradiction 走既有 fail-open 且不授权 retry，partial 文档始终
   保留。该字段只决定是否需要更多相同-query 证据，不是 query rewrite。

### Boundary graph, PPR and Worker

1. 共享 classifier 返回 `allowed_markdown | opaque_excluded_markdown | blocked` 和
   immutable snapshot `epoch/fingerprint`：普通 excluded Markdown 仅 opaque；excluded
   generated、attachment、missing/non-vault/non-Markdown 均 blocked；仅既有 policy
   明确允许的 generated Markdown 才是 allowed。snapshot copy/canonicalization/
   classification/fingerprint 自身也在 node/edge/bytes/deadline/epoch preflight 内；只在
   start/end epoch 一致且全量通过后 seal。Worker/final seam 发现变化时丢弃所有 graph
   lanes，禁止 filter-after traversal。
2. PPR 构图/solver 前对 canonical reachable nodes、edges、projected lifted states/
   transitions、memory 与 remaining absolute deadline 做确定性全图 preflight。任何一项
   超出经 EC-02 有界 fixture 与 B-125 pragmatic iPhone gate 校准的上限，都跳过
   整个 PPR（Deep + Convergence），不得以
   adjacency/insertion prefix 截图；只有独立完成自身 preflight 与全量 cosine 的 Local
   才可保留。
3. Worker request 携带 request id、invocation/cancel epoch 与 absolute deadline；path/
   chunk fetch 使用经 EC-02 校准的 bounded batches，禁止 unbounded SQL `IN` 或无截止
   rank。cancel 走不进入 main/Worker data queues 的 immediate control registry；每个
   batch 后的 continuation 必须进入新 Worker macrotask，让 pending cancel handler 先运行，
   禁止同步 loop 或仅 microtask yield。Host 忽略 deadline/epoch 后的 late result，teardown
   后它不得占用下一次调用或改变 active lexical generation。
4. relaxed exact-repeat suppression 首先使用 coherent chunk 写入时生成且绑定 indexed
   source hash/revision 的 query-independent `pathEvidenceGeneration`；只有 index/current-
   source revision 与 run epoch 均一致时，才在 SQL/Worker candidate admission 与 graph
   workset 前 push down 确定未变化的 repeat。unknown/dirty/mismatched revision 和 generation
   变化的路径再经 bounded Worker probe 与 latest-
   source materialization 计算 reranker-visible fingerprint，visible repeat 继续跳过并按
   deterministic lane order refill。不得为判断重复先做无界 Worker rank；repeat 仍可保留
   为 Boundary-allowed topology state，但不能占 candidate-selecting workset、direct/
   graph/reranker seat。

### Chat and Pagelet run state

1. 每个 Chat stream run 新建 recovery coordinator，原子持有 one-token ledger、search
   episode、frozen query/lexical plan、absolute deadline 和非零 finalization reserve；
   success/error/abort/timeout/supersede/unload 后 teardown。只有 valid none，或 valid
   partial + `needsMoreEvidence=true`，可在 reserve 仍可满足时消费一次 token；hidden
   attempt 与首次证据合并为一个 currentness-revalidated ≤8-document observation。
2. Pagelet 保持同一个 canonical agent run/model loop，不启动第二个 agent、第二模型
   fallback，也不提高既有 max turns/provider budget。Terminal 继续使用 owner-approved
   natural Markdown / exact `NO_INSIGHT`；寻找第二个 insight 只能调用一次 Pagelet-only
   `stage_pagelet_insight` Host control，提交通过初步 gate 的自然 Markdown provisional
   insight 与可验证 unresolved lead。若请求 relaxed，Host 只绑定此前 latest current、
   与 lead source evidence 相交的 eligible partial episode，并复用其 query/lexical plan；
   episode ID 保持 Host-only。否则只允许 existing-budget standard tools，不授予 relaxed。
3. 每个 Pagelet insight 独立通过 natural-Markdown body/source/currentness/novelty/value/delivery gate；
   第二个还需 distinct claim/evidence mapping，不能只是改写。Identity 必须包含 normalized
   claim hash + body hash + canonical source identities，避免同源不同文本或同 claim 改写
   被错误复用。Cache/version、controller、quality gate 与 delivery adapter 只在 run 结束
   时原子提交非空 collection；第二项失败时只提交已验证第一项，0 insight 保持 quiet、
   不写 cache/seen/delivery，任何 partial write 不得暴露未验证结果。`collectionId` 只负责
   cache/run grouping；每条 insight 以自己的 `insightId` 生成独立 `DeliveryCandidate`，
   receipt/seen/dismiss/handoff/stack admission 互不连带。

## Source Surface

实施前以当前源码复核最终符号；下面记录 ownership，而不是承诺每个文件都必须修改。

| Ownership | Expected source surface |
| --- | --- |
| FTS profile、exact CJK normalization、BM25 fields/query and lexical-only shadow generation | `src/vss/fts-query-builder.ts`、`src/vss/sqlite-worker.ts`、VSS independent lexical profile/generation/operation-queue seams |
| Lexical rebuild confirmation/progress/cancel and honest fallback | `src/memory-manager.ts` + existing Memory prepare/update UI seam；no provider/re-embedding path |
| Lexical field source projection | `src/vss/markdown-chunker.ts` or a derived-index projection seam；original display/embedding chunks stay unchanged |
| Rank fusion | `src/vss/rrf.ts` + VSS hybrid orchestration；RRF remains the B-125 fusion contract |
| Search orchestration、candidate/document allocation、internal result | `src/ai-services/memory-search-tool.ts`、`src/ai-services/chat-types.ts` |
| Latest-Markdown candidate materialization and pre/post-provider revalidation | existing vault read + shared Data Boundary/currentness/content-hash seam；must precede provider input and final projection |
| Answer-model observation projection and Chat control metadata | `src/ai-services/pa-agent-host-tools.ts`、capability/source projection seam；must run before generic serialization |
| Chat recovery orchestration | per-stream-run Chat recovery coordinator、executor hidden-attempt seam and one cumulative observation；owns token/deadline/finalization reserve/teardown |
| Reranker model selection | current policy/chat model adapter and `AiServiceHost` seam |
| PPR algorithm and boundary state graph | `src/graph/personalized-pagerank.ts`、`src/graph/ppr-expansion.ts` or equivalent existing boundary |
| Invocation-scoped query embedding、stable chunk identity and cancelable local path/chunk scoring | `src/vss/vss-core.ts`、`src/vss/sqlite-worker.ts`、current vector-index interfaces |
| Pagelet retry ledger、natural-Markdown staging control、internal insight collection、cache/delivery projection | `src/pagelet/agent/*`、Pagelet Host/lead policy/controller/quality gate/cache/delivery adapter |
| Three-state Data Boundary snapshot/classification | existing shared Data Boundary path/generated/source policy seam；immutable invocation epoch/fingerprint |
| Settings rollback flags | existing internal settings/default merge only；no user-visible control |

## Confirmed Budgets And Parameters

| Contract | Value |
| --- | ---: |
| direct unique candidates | 12 |
| graph unique candidates | 6 |
| total unique reranker candidates | 18 |
| distinct PPR seeds | up to 3 |
| Local/Deep/Convergence post-aggregation worksets | bounded；exact limits pending EC-02 calibration |
| graph final allocation | each eligible lane nominates at most 1；overlap has no replacement debt；remaining capacity by cosine |
| chunks retained per candidate upstream | up to 3 |
| final answer-model documents | 8 |
| Pagelet insights per run | 0–2 |
| relaxed retries per Agent/Pagelet run | 1 |
| PPR follow probability `alpha` | 0.75 |
| PPR target final L1 error bound | 0.001 |
| PPR max iterations | 50 |

No per-seed truncation is allowed. Local/Deep/Convergence worksets and the total
pre-cosine work envelope are implementation safety limits that require fixture
and B-125 pragmatic iPhone calibration；they are not fixed by the confirmed
Decision. All final budgets are ceilings and never require filling.

以下是旧草案的 tuning 候选，不是已批准的 shipping 参数：normal/relaxed cosine
`0.3/0.2`、vector `k 8/12`、`fusionTopK 12/18`。它们可以进入 versioned、default-off、
`provisional` 的验证 plumbing，但只有在 SDD EC-02 的 fixture、真实 reranker、
real-iOS pragmatic performance gate 记录通过后，才可成为 rollout/default 候选。

## Dependencies And Sequencing

1. 先把 exact `CHAR-PHRASE` normalizer、independent lexical profile state machine、
   Memory confirmation UI 与 shadow-generation migration 做成一个可单独 rollback 的
   Phase 0B slice；以真实 sqlite-wasm fixtures 证明同构、atomic switch、crash recovery、
   concurrent incremental writes 与 honest vector-only fallback，再校准 fields/BM25/OR/
   RRF/deadline。
2. 再建立 strict rerank envelope（含 partial `needsMoreEvidence`）、latest-Markdown live
   materialization 与 answer observation projector，防止 stale/newly excluded 或 graph
   candidates 通过 provider/final serialization 绕过 Boundary/currentness/budget。
3. 再实现 invocation-scoped query embedding holder、stable chunk identity 和带 bounded
   batch/absolute deadline/cancel epoch 的 Worker path/chunk ranking；在取消、late result、
   teardown 与 concurrent query 安全可用前不得启用 PPR/retry。
4. 用三态 classifier 冻结 immutable Boundary snapshot，再完成 canonical graph/PPR
   full-work preflight 与 solver；三个 seeds 共用同图、alpha、convergence rule。任一全图
   node/edge/lifted-state/memory/deadline gate 失败，都 whole-PPR fallback。
5. 建立完整 Local、聚合 Deep Breadth/Convergence、应用 calibrated worksets、cosine gate、
   lane max-one nominations 与 cosine backfill，再接入 strict reranker 和 two-pass
   document allocator；全链路在 provider/final seam 复核 live Boundary/currentness。
6. 最后接入 per-Chat-stream recovery coordinator 与 Pagelet Host Policy。Chat 按 OD-05A
   复用 query/lexical plan，以首次已存 stable identity 在 cap/Worker rank 前 push down exact
   replay，并保留 rejected path 的图传播；实现自动 hidden attempt、非零 finalization
   reserve、累计 documents≤8 与 teardown。Pagelet 在同一 agent run 内用一次 Host
   staging control 固定自然 Markdown 第一条并尝试第二独立 lead；terminal contract 不变，
   Host 内部把 single-result shape 原子升级为非空 1–2 collection，0 继续 quiet。
7. 每个 Phase 的内部 rollback flag 在 default merge、explicit on/off、abort/unload teardown
   与 stale/late-result isolation tests 通过前保持开发态 default-off；只有对应 exit gate 和
   owner-approved implementation/release lane 完成后，才能单独决定 shipping default。

## Risks And Rollback

| Risk | Prevention / detection | Runtime fallback / rollback |
| --- | --- | --- |
| CJK FTS 继续零召回、normalization/runtime drift 或 profile 重建代价过高 | exact NFC/grapheme/atom golden vectors、real sqlite-wasm MATCH、independent profile version、supported-runtime fingerprint、Recall@K/index-size/rebuild/update/p95 gate | discard incomplete shadow generation；vector/direct-only；no provider call、re-embedding or Markdown mutation |
| lexical rebuild crash、阻塞前台 search 或增量写形成 mixed generation | short queued batches + foreground read priority、SQLite-canonical marker/switch、shadow row/vocab checks、delta replay、abort/rename/upsert/delete race fixtures | 保持前一有效 selected generation；否则 lexical unavailable + vector-only；never monolithic queue hold/global VSS reset |
| FTS 因 vector scan 超时被静默跳过 | explicit lexical state/reason/timing、EC-02 deadline calibration and current-iPhone proxy fixture | vector/direct fallback；不得把未运行 FTS 记录为 empty lexical result |
| stale/newly excluded excerpt 进入 reranker 或 final source | latest-Markdown materialization、pre/post-provider epoch/hash/anchor revalidation、MetadataCache-lag/provider spies | drop changed/denied candidate；不足时保留其他 current candidates 或诚实 none；never send/cite stale body |
| Reranker 误过滤、partial 无可靠 retry producer 或模型失败级联 | strict envelope、一模型一次调用、`needsMoreEvidence` required-boolean matrix、invalid/timeout/origin-order tests | fail open direct-first；invalid partial 不授权 retry；关闭 strict-none flag 不恢复旧 parser bug或跨-origin decay |
| 去掉 `0.02` 后远端弱节点增加 | calibrated lane worksets/high-degree envelope、cosine、reranker、graph≤6 | 关闭 PPR；未来可引入经评测的 lane-specific threshold，无数据迁移 |
| opaque bridge 泄漏、classifier 混淆或 Boundary 在运行中变化 | three-state classifier、immutable epoch/fingerprint、`(path, opaqueUsed)` state graph、provider/DTO/log/replay negative spies | 丢弃全部 graph lanes；不得把 blocked 降为 opaque 或做 unrestricted filter-after traversal |
| PPR 全图资源超限、不收敛或概率质量漂移 | node/edge/lifted-state/transition/memory/deadline preflight、certified error bound、max50、finite/nonnegative/mass invariants、no prefix/pruning fixtures | skip whole PPR（Deep + Convergence）；仅保留依赖安全且完整 cosine 的 Local |
| Local 高 degree 产生顺序偏置或超预算 | deterministic full-lane preflight、batched cosine、no prefix fixture | 整条 Local lane 跳过；安全 PPR lanes 可继续 |
| query embedding 并发串线 | invocation-scoped output holder、并发不同 query fixture | holder/Worker 不可用即 direct-only；禁止 shared last field |
| Worker 无界 batch、cancel 排在任务后、deadline 后仍占队列或返回 file-head/late result | bounded SQL batches、absolute deadline、immediate out-of-data-queue cancel registry、request epoch、deterministic abort checks、real cosine/order/late-result tests | discard whole unsafe Worker result；direct-only；不得 file-head/whole-note/late-generation fallback |
| retry 增加延迟、侵占 final answer 时间或串 stream run | per-stream Host one-token coordinator、non-zero finalization reserve、abort/wall-clock/teardown 优先、tool stateless | 不启动或中止 retry；保留 first evidence，standard retrieval 不受影响 |
| path-wide suppression 放大首轮 reranker false-negative 或切断 A–B–C 图路径 | episode-local path+evidence fingerprint、novel→changed admission、exact repeat candidate-only suppression、rejected path 保留传播 | 关闭 relaxed retry；不得删除 Boundary-allowed graph state |
| cap/Worker rank 后才识别 exact repeat，造成无界工作或 relaxed retry 空转 | first-attempt stored stable chunk identity、SQL/Worker/workset push-down、cap 前分类、only-zero-fresh topology-root fixtures | 该 attempt deterministic none；不得复活首轮 rejected evidence 或先全量 rank 再过滤 |
| Chat empty success 未触发 recovery、同 query 被去重或双 observation 超预算 | retrieval-specific outcome、atomic run coordinator、host execution seam、single cumulative ≤8-doc projection、finalization reserve | 关闭 Chat retry；保留 standard retrieval evidence |
| Pagelet staging control 变成 rigid terminal schema、错误绑定 search episode、两条共用 delivery identity、第二 run/超预算，或为凑两个而重复 | terminal natural-Markdown golden tests、Host-only latest-eligible binding、Pagelet-only one-shot control、existing budgets、per-item body/source/identity/candidate tests | 不 continuation 或只提交已验证第一项；0 insight 不写 cache/seen/delivery；一条 seen/dismiss 不影响另一条，never expose partial cache write |
| rollback flag 默认漂移、disable/unload 后仍接受异步结果 | explicit default/merge/on/off tests、teardown aborts、epoch invalidation、listener/timer/cache cleanup spies | keep phase default-off / disabled；drop late results without mutating later run or lexical generation |
| 显式时间范围在 rewrite 中丢失 | temporal-intent propagation tests | 拒绝该 relaxed retry，保留首轮 partial/direct evidence |
| source 与 final docs 不一致 | two-pass allocator、path+chunk dedupe、sources-from-final-only | omit invalid source/document；不得从 candidate pool补 source |

Performance rollback remains flag-scoped. A pragmatic-gate `FAIL` keeps the
affected B-125 flag off；lexical failure also retains/discards the shadow generation
and uses the previous valid generation or vector-only fallback. After rollout, an
app/renderer crash or hang、OS termination、repeated existing-budget deadline
exceed、unsafe cancel/late-result acceptance、derived-index corruption/runaway
growth or a reproducible material latency/UI regression disables the affected flag
and reopens B-125 validation. A plugin/profile/workload or hard-budget change also
invalidates the prior performance receipt. Missing optional physical-footprint
sampling alone does not trigger rollback；an observed memory-related termination or
sustained field regression does. B-126 extended certification may add evidence or
trigger one of these reopen conditions, but its mere incompleteness does not block
B-125.

## Validation Strategy

### Focused automated gates

- Phase 0A: frozen algorithm-independent fixtures + real sqlite-wasm Node 22
  runner；same body/BM25/Top-K/strict semantics；OR deferred to Phase 0B；equal-
  weight metadata reachability separately；vector/RRF/reranker/rewrite/deadline
  disabled；all core CJK Hit@8、English/code no-regression、zero MATCH errors and
  title/heading/path-only reachability。Report path Hit@1/3/8、MRR、Recall/
  Precision@8、unique-path/duplicate-chunk、vocab/query diagnostics、index bytes
  and Node warm p50/p95；do not claim real-device performance or a winner。
- Phase 0B: exact NFC/grapheme/script/Letter-Mark/hex-atom golden vectors run on
  every supported runtime；selected profile real MATCH regression；independent
  lexical version and state transitions；explicit confirm/cancel/progress；shadow
  generation short-batch queue yielding、foreground-search priority、row/vocab/
  profile validation + same-SQLite-transaction marker/switch；crash/abort/late
  epoch/delta replay/concurrent upsert/delete/rename fixtures；zero global reset/
  provider/re-embedding/source mutation；FTS Recall@K、hybrid Recall@12、final Recall@8/MRR、unique-path、
  index/rebuild/incremental-update and pragmatic iPhone evidence。
- Phase 1: model selection、0/1/N candidate、strict verdict + required
  `needsMoreEvidence` matrix、valid cross-origin mixing、timeout/error direct-
  hybrid-first + graph-cosine fail-open with no decay/reservation、18-candidate
  bound、observation projection、two-pass 8-document assembly；latest-body/hash/
  anchor and just-added inline/frontmatter/generated/path exclusion fixtures prove
  stale/denied excerpts never reach provider or final sources。
- Phase 2: immutable three-state Boundary snapshot/epoch、opaque bridge、complete
  Local cosine-before-truncation、fixed alpha、error-bound convergence、mass
  invariants、m=1/2/3 aggregation；snapshot acquisition + reachable node/edge/
  lifted-state/transition/memory/deadline preflight and whole-PPR fallback；calibrated work envelopes、one-per-lane
  nomination/overlap/no-debt/cosine fill；bounded Worker batches、absolute deadline/
  out-of-data-queue immediate cancel registry、macrotask continuation（microtask-only
  negative fixture）、epoch/late-result rejection、chunk ordering、parallel embedding isolation
  and dependency-aware failures。
- Phase 3: per-stream Chat valid-none automatic exactly once；partial retries only
  with strict `needsMoreEvidence=true`；atomic token arbitration、same query/frozen
  lexical plan、first-attempt stable chunk identity、SQL/Worker/workset push-down
  before cap/rank、novel-before-changed admission、rejected-path graph propagation、
  old direct seeds as topology-only roots only when fresh seeds are zero；one
  currentness-revalidated cumulative documents≤8 observation、non-zero finalization
  reserve、unrelated standard search、temporal preservation and full teardown。
  Pagelet covers natural-Markdown terminal 0/1/2、one same-run Host staging control
  for a verified second lead、latest-eligible Host binding、per-item gates、claim/
  body identity hashes、atomic non-empty cache/version/controller、two independent
  delivery candidates/receipts/seen states、zero-write quiet and no increase to
  existing max turns/provider budget。
- Cross-cutting: Data Boundary before/after Worker/provider/final projection；no
  bridge identity/content in provider/observation/log/replay；sources derive only
  from final documents；feature flags assert explicit development/shipping defaults、
  independent on/off behavior and abort/unload teardown with zero accepted late
  result。

### Local gate

先跑最接近的 focused Jest suites，再执行 Local Validation Gate。共享 Memory/VSS/
Pagelet runtime 全部完成后才运行 `make deploy`；docs-only 更新不运行 Build 或 smoke。

### Supported-runtime and pragmatic performance gate

The owner-confirmed mobile support floor is `minimumIPhoneModel=iPhone 15`,
`minimumIOSVersion=17.0` and `minimumObsidianVersion=1.11.4`. Direct evidence on
that exact tuple is preferred. For B-125, the owner explicitly accepts the
recorded 2026-08-11 within-freshness-window newer-version real-iOS verifier PASS
result as a software-version proxy validation baseline because the exact older
environment is unavailable, while retaining the declared floor and accepting the
untested backward-compatibility risk. This software-floor proxy does not itself
satisfy the current-artifact functional or pragmatic performance gate. For B-125
performance, the owner designates the currently available, newer iPhone as a
pragmatic proxy: bind its opaque identity、available runtime classification and
Obsidian API identity plus current plugin/runner artifacts. The owner-observed
newer iOS remains an unattested observation when the WKWebView cannot expose an
authoritative OS version；do not label the device `representsFloor=true` or claim
exact iPhone 15 performance. Reopen direct floor testing if a compatibility regression
is reported at iOS 17.0 or Obsidian 1.11.4. For
B-125 only, the owner temporarily excludes Win32 runtime support；the required
desktop rollout matrix is `darwin` + `linux`. This is not Win32 PASS、a
compatibility claim or a permanent change to PA Windows support or manifests.
On Windows the four B-125 effective flags must remain fail-closed `false`, with
raw settings unchanged and direct/vector fallback preserved.

1. Run deterministic normalization/profile fingerprints on repository Node 22,
   the current supported Obsidian desktop renderer and the supported iOS WKWebView;
   retain Node 20/other desktop comparison as a compatibility canary, not as a
   substitute for supported-runtime evidence. Any fingerprint drift requires a
   new lexical generation and blocks rollout.
   - Each B-125 required desktop platform produces one schema-v2 exact-renderer
     receipt with
     [`fts-runtime-probe.mjs`](../../../../scripts/fts-runtime-probe.mjs). The
     receipt must prove a real `app://obsidian.md` renderer and bind the actual
     platform/runtime fingerprint plus the bundled production
     `char-phrase-v1` artifact.
   - Rollout requires one `darwin` and one `linux` receipt from the same
     checkout/artifact, verified together by the B-125 platform policy in
     [`fts-runtime-receipt-verify.mjs`](../../../../scripts/fts-runtime-receipt-verify.mjs).
     `missing_platform:win32` does not block B-125 while the scoped waiver is
     active. Missing Darwin/Linux renderer、case or artifact evidence remains
     `BLOCKED`; selected-profile or grapheme drift is `FAIL`; word-boundary-only
     drift remains diagnostic.
     These receipts do not substitute for iOS、OPFS、quality or performance
     evidence.
   - Validate separately that Win32 resolves `lexicalProfile`、`strictReranker`、
     `graphPpr` and `relaxedRecovery` to effective `false` even if raw settings
     request `true`, without mutating persisted settings, and that direct/vector
     fallback plus cancellation/teardown remain safe. Re-enable B-125 on Windows
     only after a Windows environment、same-artifact Win32 receipt plus the full
     Darwin/Linux/Win32 aggregate、Win32 App/OPFS/flag lifecycle/fallback/cancel
     smoke and explicit owner approval are all available. The restoration
     aggregate must run
     `node scripts/fts-runtime-receipt-verify.mjs --platform-policy=all-desktop --json <darwin> <win32> <linux>`
     and return `status=PASS` with `receiptPlatforms` containing exactly
     `darwin`、`win32` and `linux`；the scoped B-125 waiver result cannot
     substitute for this restoration proof.
2. Run the B-125 pragmatic performance gate on the designated current iPhone.
   This gate protects users from deadline overruns、UI hangs、unbounded local-index
   growth and unsafe cancellation without turning B-125 into a hardware
   certification program.
   - Bind one current production plugin、runner、fixture manifest、opaque device
     identity、available runtime classification and Obsidian API identity. The
     receipt declares immutable `control` (all B-125 flags effective-off) and
     `evaluated` flag/settings profiles；the only permitted transition is the
     runner-recorded and verified `control → evaluated` switch. Every other
     setting、device and artifact remains unchanged, and final cleanup restores the
     initial profile. Record an owner-observed newer iOS version only as
     unattested context when the WKWebView cannot expose an authoritative OS
     version. A stale artifact、undeclared settings drift or another device cannot be mixed
     into the same receipt.
   - Use nearest-rank percentiles and two separate distributions: exactly 3 warmup
     plus 10 measured standard one-attempt episodes, then exactly 3 warmup plus 10
     measured two-attempt retry episodes. Run one additional isolated cancellation
     probe. Each episode uses the frozen synthetic workload in a fresh Chat and is
     bound to its own opaque diagnostics `runId`; warmups never enter percentiles
     and standard/retry samples are never merged.
   - Retain the key evidence only: standard/retry total p50/p95、lexical and Graph
     p50/p95、Worker queue/max-batch timing、maximum observed main-thread scheduling
     gap、derived DB/index bytes before/peak/after、one successful lexical rebuild
     and one successful incremental update with duration, deadline/finalization
     outcome and the cancellation state transition. Process physical footprint and
     JS heap are optional diagnostics when the environment exposes them.
   - Capture a separate same-device、same-artifact、same-synthetic-input control
     with all four B-125 flags effective-off before the enabled run. This control
     executes exactly 1 warmup + 5 measured standard direct/vector episodes and
     is a directional reference, not a p95 certification. Compare enabled standard
     total latency、maximum UI gap and any metric actually present in both runs;
     retry、Graph and the new lexical derived-index rebuild/update have no valid
     all-off counterpart, so record them absolutely under the hard budgets and
     owner review. Every unavailable comparison is explicit `N/A`, never `0` or
     an implicit `PASS`. B-125 defines no invented percentage cutoff, but a
     reproducible material regression or unexplained outlier keeps the implicated
     flag off and the gate `BLOCKED` pending investigation or a new explicit owner
     risk decision.
   - Reuse existing runtime budgets instead of inventing device-derived thresholds:
     the local lexical phase has its existing 500 ms absolute budget, Graph has its
     existing 8,000 ms envelope, one Memory recovery episode has its existing
     30,000 ms envelope, and the outer turn remains bounded by 180,000 ms with a
     non-zero finalization reserve. Every measured episode must complete inside the
     applicable hard budget. Worker queue/batch、UI-gap、DB/index、rebuild and update
     values are recorded as a current-device baseline; B-125 adds no unsupported
     numeric limit for them.
   - The cancellation probe must record at least one cancel request, at least one
     Worker-observed cancellation, at least one late-result discard and exactly
     zero accepted-after-cancel results. Any deadline exceed、app/renderer crash or
     hang、OS termination、incomplete rebuild/update、index
     corruption、provider/re-embedding call during lexical rebuild or Markdown
     mutation is `FAIL`.
   - Missing/mismatched current artifacts、fewer than the required episodes、an
     unavailable required timing/UI/storage/rebuild/update/cancel observation or an
     unbound episode、dropped diagnostic event or capacity overflow is `BLOCKED`.
     A complete run satisfying the hard budgets and structural invariants is only
     `CANDIDATE / READY_FOR_OWNER_REVIEW`; the aggregate remains `BLOCKED` until
     the Tracker records the owner's accepted/rejected disposition and reason.
     Acceptance with no material regression/unexplained outlier, or an explicit
     risk acceptance, produces performance `PASS`; rejection produces `FAIL` and
     keeps the implicated flag off；pending investigation remains `BLOCKED`.
     Missing process-footprint evidence alone is
     recorded as `ACCEPTED RISK`, not `PASS` for that metric and not an aggregate
     blocker. Xcode/Instruments and a converter are therefore not required for
     B-125.
   - The current `b125-device-measurement-v9` runner/verifier still enforces the
     older 23 + 23 + 1 workload、18 device-derived thresholds and required external
     process-memory contract. Until Tracker T-12 aligns the fixture、runner、receipt
     verifier and focused tests with this pragmatic contract, their expected
     result remains `BLOCKED`; the documentation decision does not manufacture a
     performance PASS.
   - Move representative-floor hardware、20 measured samples per lane、the full
     47-episode workload、18 independently frozen thresholds、Instruments-derived
     physical-footprint evidence and its converter/provenance audit to B-126
     extended performance certification. B-126 is follow-up assurance and does not
     block B-125 rollout unless a B-125 failure or reopen trigger below is observed.
3. Desktop success cannot close the iOS gate. Use the designated current iPhone for
   the final runtime smoke. For B-125 functional software-floor acceptance, the
   owner-approved recorded within-window result is the allowed software-version
   proxy for the unavailable exact iOS 17.0 / Obsidian 1.11.4 tuple. The new
   current-artifact functional/flag-lifecycle smoke and pragmatic performance
   receipt remain separate required evidence. If the device lacks the required
   Worker/cancellation/segmentation behavior or fails the pragmatic gate, keep the
   affected Phase flag off and preserve the preceding safe fallback.

### App smoke after implementation

Use the versioned synthetic pack in
[`__fixtures__/retrieval-smoke`](../../../../__fixtures__/retrieval-smoke) and
prepare it with
[`scripts/prepare-retrieval-optimization-smoke.mjs`](../../../../scripts/prepare-retrieval-optimization-smoke.mjs).
The in-app
[`retrieval-optimization-smoke-runner.js`](../../../../scripts/retrieval-optimization-smoke-runner.js)
may automate only provider-free preconditions and evidence recording；Chat、Pagelet
and device observations remain explicit `PASS`/`FAIL`/`BLOCKED` entries and must
never be inferred from fixture setup or unit tests. The runner must validate the
canonical per-file digest manifest and every frozen temporal fixture mtime before observation、
capture manifest/fixture/runner/loaded-plugin artifact identities in the receipt、treat any blocked
precondition as aggregate `BLOCKED`, and reject all case mutation after finalization.

Real selected-model quality uses the runner's six frozen ranking cases. Run them
with the actually selected `policy`-else-Chat reranker, then record the exact
final Memory source-chip path order（最多 8）instead of judging relevance from the
answer prose. The receipt computes final Recall@8、MRR and forbidden-source count
with all six cases as the fixed denominator；a missing case stays `BLOCKED`, while
a missing relevant source or any forbidden/opaque source is `FAIL`. This is
end-to-end selected-model evidence, not a raw model-score claim, and the runner
must not call the provider or infer a ranking result itself. The selected
provider/model descriptor is hash-bound while only its `policy|chat` class is
shown；any mid-run settings drift invalidates the measurement. Source paths are
canonicalized before forbidden checks, and result writes are serialized before
the immutable final receipt.

All six scored cases use frozen, explicit `只从我的笔记` prompts so this gate
measures Memory retrieval/reranking instead of Chat's optional semantic-first
tool routing. Record a scored case only after observing a `search_memory`
attempt；if Memory was never invoked, leave the case `PENDING/BLOCKED` and record
that separately as routing/protocol evidence rather than a lexical miss. Bare
error-code and Japanese probes remain non-scored routing observations and do not
enter Recall@8、MRR、required manual PASS/FAIL or the rollout aggregate.

Receipt counts are fail-closed. Only a `completed + semantic_none +
documentCount === 0` terminal is a zero-document result；a positive count requires
`completed + no reason + documentCount > 0`. A legacy `completed + no reason + 0`
tuple、failed attempt、missing field、`null` or otherwise unavailable count remains
`null`/`unavailable`；it must never satisfy a none/empty gate.

Selected-model ranking and structured explicit-temporal acceptance are quality/
correctness gates, not performance samples. They may be recorded independently
before or after the pragmatic performance run and do not require a device-threshold
freeze. They must still bind the same current plugin、runner、provider/model class
and stable settings. Ranking `PASS` remains all six frozen targets at rank 1
(`MRR=1.0`) with zero forbidden/opaque hits；the structured temporal canary must
prove the exact A1 → one A2 → cumulative projection topology with no temporal
violation. Missing evidence is `BLOCKED` and a wrong/forbidden result is `FAIL`.
Both remain required by the B-125 rollout aggregate, but neither can make the
performance gate pass and the performance gate cannot make either quality gate
pass.

Before performance sampling, stop and discard any earlier diagnostics session,
then start a verified-empty session. Execute the 3 + 10 standard episodes、the
separate 3 + 10 retry episodes and one cancellation probe defined above. Use
`captureRetrievalDiagnostics()` only for intermediate projection and seal each
stage explicitly. Diagnostics collect only allowlisted phase/outcome/reason/count/
timing fields and never call a provider or turn a manual/ranking case into `PASS`.
Each event carries only the runtime-generated opaque Agent run id needed to bind
that episode to the same live canonical Chat turn；it must never contain a query、
path、title or source identity. Missing diagnostics、capacity overflow、session or
run identity drift、mixed/out-of-order episodes or an incomplete required Graph
chain remains `BLOCKED`.

1. FTS：中文、标题/heading、英文错误码可进入 direct candidate pool；profile rebuild
   不触发 provider 或 Markdown 变更，lexical unavailable 时诚实降级。
2. Chat：首次 valid miss 自动 relaxed retry，最多一次；partial 证据保留。
3. PPR：已知 2–3 hop 与 two-seed convergence fixture 可召回，弱/无关内容被 cosine/
   reranker 拒绝。
4. Data Boundary：allowed–excluded–allowed 可只显示最终 allowed note；任何位置不出现
   bridge identity/content。
5. Pagelet：分别观察合法 0、1、2 insight 终态；第二 insight 不是第一的改写，sources
   可打开且 current。
6. 显式时间范围 retry 不越界；无显式范围的 Pagelet 可命中旧笔记。前者必须由独立、
   structured、显式 notes-only canary 证明：冻结 2026 时间范围，A1 必须是可触发恢复的
   strict partial/valid none，恰好消费一次 A2，完成 cumulative projection；2026 relaxed
   target 必须进入最终 source evidence，而强匹配的 2020 forbidden distractor 在 standard、
   relaxed 与 final evidence 中均不得出现。只验证普通 temporal ranking、自由文本判断或
   缺失 attempt/source topology 不能关闭该 gate；automated runner/fixture contract
   不能替代重新部署后的 current-app observation，取得对应 receipt 前保持
   `PENDING/BLOCKED`。

## Approval And Action Boundary

- Original plan authority: edonyzpc, 2026-08-07.
- DEC-027 amendments confirmed sequentially by the owner on 2026-08-08.
- Complete SDD and full delivery plan approved by edonyzpc on 2026-08-08.
  Document status is `Approved`；current execution status and validation evidence
  live only in the Tracker.
- This plan authorizes no production runtime implementation、commit、push、tag、
  publish or release.
