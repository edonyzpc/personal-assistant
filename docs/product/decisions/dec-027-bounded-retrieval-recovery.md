# DEC-027 — 采用有界、汇合感知的检索恢复

Decision ID: DEC-027
Status: Accepted
Updated: 2026-08-11
Authority: 用户于 2026-08-08 对 retrieval-optimization 逐项分析并依次确认模型选择、失败语义、Chat/Pagelet retry、Pagelet insight 上限、Data Boundary opaque bridge、multi-seed PPR、候选/文档预算与 query-embedding 生命周期；随后在 PPR 效果复审后确认 additive Local / Deep Breadth / Convergence 三 lane、membership-aware 单候选提名与分层失败降级，并确认有效 reranker 可自由混排、fail-open 采用 direct-first 且不做跨 origin score decay；同日继续确认保留 SQLite FTS5 + RRF、先修 CJK lexical correctness、再评测多字段 BM25、AND/OR 与 fusion 参数，暂不新增 semantic query rewrite 或重型 sparse/search engine；并确认 Phase 0A 以 deterministic bigram + indexed unigram fallback 为主候选、symmetric character phrase 为确定性对照、显式 locale/fingerprint 的 `Intl.Segmenter` 为挑战者、trigram 仅作限制对照；随后确认 OD-05A 复用首次有效查询与 lexical plan，并以 run-scoped exact-evidence replay suppression 保证 relaxed retry 探索新证据而不切断图传播；在补充上下文边界、大库规模与当前 macOS Obsidian renderer 对照证据后，明确确认 OD-06A 选择 `CHAR-PHRASE` 作为 shipping CJK profile family；并明确要求把全部已确认内容写入当前权威文档。用户于 2026-08-11 进一步指定 B-125 rollout 的硬件型号下限为 `iPhone 15`，同时明确暂缓 Xcode/Instruments 与性能工作；该决定不等于选择性能代表设备，也未定义最低 iOS/Obsidian 版本
Work item: B-125

> [!note] Owner decision 2026-08-08
> 本决定只记录用户逐项确认后的当前边界，不把未讨论的实现细节追溯写成 owner
> 选择。本轮授权是文档校准；实施、Git、发布仍看 B-125 Tracker 与后续明确授权。

> [!note] Owner rollout decision 2026-08-11
> `minimumIPhoneModel=iPhone 15`。Xcode/Instruments 与 performance 暂缓；这不是
> performance gate 的 PASS/waiver，也不把当前可用 iPhone 自动指定为
> `representativeDevice` 或 `representsFloor=true`。最低 iOS、最低 Obsidian 与性能
> 代表设备仍需后续明确决定。

## Context

现有 retrieval-optimization SDD 能修复 reranker 空 ranking bug、用 PPR 扩展链接召回，
并允许一次检索重试，但审查发现七类会影响召回、可信度或运行隔离的问题：

1. 未配置 policy model 时会绕过 rerank，而不是使用 Chat model。
2. malformed、contradictory 或超时输出可能被误当成有效过滤；完整候选对象还可能进入
   model observation，绕过最终文档预算。
3. Top-3 seed 先截断、再用 `max` 合并，无法奖励多个 seed 汇合到同一笔记的结构信号。
4. 全局密度自适应 alpha、固定迭代和绝对 `0.02` 门槛会随 vault 拓扑、seed 数量和
   分叉度漂移，并损害 2–3 hop 召回。
5. 严格删除全部 excluded 节点会切断 `allowed A → excluded B → allowed C` 的本地
   结构线索； unrestricted 过滤后遍历又会让 excluded 内容无界影响结果。
6. 把 retry 状态放进共享 `MemorySearchTool` 会让 Chat/Pagelet、不同 run 或并发调用
   相互污染，也无法表达 Pagelet “再找一个独立 insight” 的目标。
7. 当前 FTS5 以 `unicode61` 索引单一 `content` 列，但 CJK query builder 把多字词
   改写成逐字 phrase；真实 sqlite-wasm MATCH probe 证明两端 token 不同构，常见中文
   查询会失去 lexical leg。标题、路径和 heading 也没有独立可加权字段。

目标不是让图结构取代语义或来源证据，而是在固定成本、可解释边界和失败可降级的前提
下，让相关旧笔记更容易自然浮现，并让 Pagelet 有机会发现更深刻但仍有来源支持的洞察。

## Options Considered

| Decision area | Options | Selected / rejected |
| --- | --- | --- |
| Reranker model | policy-only；policy → Chat failure cascade；configured policy else Chat | 选择 configured policy else Chat；一次 rerank 只调用所选模型一次，避免隐形成本与失败级联。 |
| Invalid reranker output | fail closed；猜测修复；fail open | 选择 fail open。只有结构有效且显式 `none_relevant` 才能清空结果。 |
| Direct/graph ordering | 旧 `topDirectScore × 0.4 × cosine` 跨 origin 缩放；固定交错/保留 graph 席；有效 reranker 混排 + fail-open direct-first | 选择有效 reranker 自由混排；fail-open 保留 direct hybrid 顺序，再接 graph cosine 顺序。不比较不可同尺度分数，也不为异常路径强制 graph 席。 |
| Multi-seed graph score | `max`；等权 breadth；完整 CEPS | 选择三次 single-seed PPR，breadth 用等权平均，convergence 用第二大值；不实现完整 CEPS 子图提取。 |
| Graph candidate architecture | PPR 两 lane；固定 `2+2+2` distinct reservation；additive Local / Deep / Convergence | 选择 additive 三 lane。每条合格 lane 最多提名一个候选，重叠 path 只占一席且不产生补位债务，剩余容量按同尺度 cosine 竞争。 |
| Excluded graph topology | allowed-only；unrestricted traverse then filter；single opaque bridge | 选择最多一个 excluded Markdown opaque bridge；内容、身份和输出边界仍是 hard boundary。 |
| Retry ownership | model 自律；`MemorySearchTool` session state；Host Policy run ledger | 选择 Host Policy run ledger；Chat 与 Pagelet 各自拥有，tool 保持无状态。 |
| Pagelet output | 最多一个；固定两个；零到两个 | 选择每 run `0–2` 个；第二个必须独立有价值并独立验证，二不是配额。 |
| Lexical retrieval | 保持当前单列/不对称 CJK token；替换为 SPLADE/外部引擎；修复 FTS5 并保留 RRF | 选择保留 SQLite FTS5 + RRF，先使索引/query CJK normalization 同构，再以 fixtures 校准多字段 BM25、AND/OR、候选深度和 fusion；暂不新增 semantic rewrite 或重型引擎。 |
| Shipping CJK profile | `BIGRAM-U1`；`CHAR-PHRASE`；strict-run `INTL-WORD` | OD-06A 选择 `CHAR-PHRASE`：优先连续文字召回；相同冻结质量与边界召回下，相比 BIGRAM 索引更小、构建更快；相比 INTL 不因词典边界漏掉已验证的相关连续文字。语义碰撞继续由 Phase 0B fusion/reranker 评测约束。 |

## Decision

### 1. Reranker and evidence projection

1. 配置了 policy model 时用 policy model；未配置时使用 Chat model。被选择的模型失败
   后不再级联调用另一个模型。
2. 零候选直接产生 deterministic `none_relevant`，不调用模型。一个或更多候选才调用
   reranker。
3. timeout、provider failure、malformed 或 verdict/ranking 相互矛盾时 fail open，保留
   原有有界候选。只有结构完整、索引合法并显式返回 `none_relevant` 的结果可以过滤。
4. `MemorySearchResult.candidates` 保持 Host-internal。Chat/Pagelet model observation
   只包含最终 documents、由其派生的 sources 与必要 control signals；不得序列化完整
   候选、rejected-evidence ledger、候选 excerpt、anchor、path 或嵌套 documents。
5. 进入 reranker 的候选最多 18 个：最多 12 个 direct，加最多 6 个 unique graph
   expansion；同 path 只占一席。最终 model-visible documents 最多 8 个。
6. 有效 reranker ranking 可以自由混排 direct 与 graph。reranker unavailable、timeout、
   error 或 invalid 时，不使用旧 `topDirectScore × 0.4 × cosine` 或任何跨 origin score
   decay；fail-open 顺序是 direct 原 hybrid 顺序在前，再接 graph 自身 cosine 顺序。
   在 8-document cap 下 graph 可能不进入异常路径的最终 evidence；这是 precision-first
   降级，不改变正常有效 rerank 的 PPR 召回。

### 2. Additive Local、Deep Breadth and Convergence retrieval

1. 最多取三个不同 note/path 的 direct seed，分别运行 single-seed PPR；三路共享同一
   Data Boundary 状态图、`alpha=0.75` 和收敛规则，禁止 per-seed alpha。
2. breadth lane 使用实际 seed 数的等权平均；convergence lane 使用 per-seed score
   的第二大值。一个 seed 时关闭 convergence；两个 seed 时第二大值即两者较小值；
   三个 seed 时表达 2-of-3 汇合。旧 `max` 聚合不再使用。
3. Graph expansion 使用三条 additive candidate lane：
   - `Local`：任一 seed 经过一个合法 transition 可达、非 direct 的 allowed Markdown
     path；必须在完整合法一跳集合上先做 query cosine，再截断，禁止按 adjacency/object
     顺序预截断；
   - `Deep Breadth`：breadth 聚合后排除 direct 与 Local 的深层候选。Local 只从 breadth
     候选选择中排除，仍保留在 PPR 状态图和概率传播中；
   - `Convergence`：第二大 per-seed 支持形成的正交信号，可与 Local 或 Deep Breadth
     重叠。内部保留 membership，一个 canonical path 永远只占一个最终 graph 席位。
4. 不实现 CEPS 的完整 `EXTRACT`、downhill DAG、path DP、connector budget 或子图
   `H`。Pagelet 仍消费候选与内容证据；未来若解释关系，只能使用独立设计的有界 witness
   path。
5. PPR 使用 error-driven convergence：最终 L1 error bound 目标 `0.001`、最多 50 次
   iteration、迭代中不做 probability-loss pruning。达到上限仍不收敛或出现质量守恒/
   finite invariant 失败时，仅丢弃依赖 PPR 的 Deep Breadth/Convergence；共享 graph
   snapshot、Boundary classification、query embedding 与 Worker 均安全时，可保留已完成
   cosine/currentness 验证的 Local。
6. 不做 per-seed Top-K，也不使用绝对 `pprScoreThreshold=0.02`。完整收敛后先做候选
   eligibility，再聚合；solver error bound 只清除数值不确定性，不充当相关性阈值。
   每 lane 的具体 workset、总本地 work budget 与 high-degree 上限属于评测参数，不在本
   Decision 中固定为 `Top-12` 或 `union≤36`。
7. cosine 后 graph expansion 最多 6 个。每条存在合格候选的 lane 最多提名一个：
   Local 按 cosine；Deep Breadth 按 breadth score、再以 cosine/path 破同分；Convergence
   按 convergence score、再以 cosine/path 破同分。三个提名按 canonical path 去重；同
   path 的 overlap 不强制另找较弱候选。剩余与空缺容量从所有余下合格 path 按 cosine、
   再 canonical path 回填；永不强制填满。
8. 不使用 global/projected edge-count switch。仅当存在 eligible 的非 direct、非 Local
   seed-reachable path，或至少两个 seed 直接共享一个 eligible Local path 时运行 PPR。
   单 seed 纯一层 star 只运行 Local；没有 graph candidate 时保持 direct-only。
9. 失败按依赖面分层：PPR-only 失败丢弃 Deep/Convergence；Local 的确定性规模预检超预算
   时整条 Local lane 跳过且不得返回顺序偏置前缀，其他安全 lane 可继续；snapshot/
   classification、embedding 或 Worker 共享安全性失败时全部 graph direct-only。

### 3. Data Boundary opaque bridge

PPR 的本地图传播每次 restart excursion 最多穿越一个 excluded Markdown 节点作为
opaque bridge。该例外不等于读取、override 或来源授权：

- bridge 永不成为 seed、candidate、result、sourceRef、why-shown 或 provider input；
- bridge 的正文、excerpt、title、path、metadata 不进入 model、UI、返回 DTO、日志、
  telemetry 或 replay；
- attachment、generated note 不能成为 bridge；
- `excluded → excluded` 与一次 excursion 中第二个 excluded 节点均禁止；
- 最终 allowed candidate 仍需重新通过 Data Boundary、cosine、reranker 和来源验证。

因此 excluded scope 仍是内容、身份、候选、输出与 provider 的 hard boundary；仅允许一
个受限的、本地瞬时拓扑贡献。

### 4. Query embedding and document allocation

1. PPR path 的 chunk 选择复用同一次 search query embedding，通过 invocation-scoped
   output holder 传递；不使用共享 `_lastQueryEmbedding`，不重新 embedding query。
2. SQLite Worker 在已允许的 path 内按 chunk cosine 选择每 path 最多 3 块，稳定顺序为
   `score DESC, chunkIndex ASC`，返回真实 similarity。Data Boundary 在进入 Worker 前
   和结果返回后各检查一次。
3. query embedding 或安全的 Worker ranking 不可用时跳过全部 graph expansion；不得
   悄悄返回文件开头 chunks，也不得在检索阶段读取整篇笔记。Local high-degree work 必须
   exact/batched；若完整评分不可安全完成，整条 Local lane 失效，不能截取顺序前缀。
4. 最终 8 个 documents 先给每个 reranked candidate 分配前 2 块；第三块只用于剩余额度
   backfill。保持 reranker candidate 顺序并按 `path + chunkIndex` 去重；sources 只从最终
   documents 派生，Pagelet source capture 再按 path 去重。

### 5. Host-owned single retry and Pagelet depth

1. Chat 的有效 `none_relevant` 必须由 Host Policy 自动执行一次 relaxed retry；
   `partially_relevant` 只在证据不足时 retry，并保留第一轮有效 partial evidence。
2. 每个 Agent Run 最多一次 relaxed retry。Chat ledger 属于 Chat Host Policy；Pagelet
   ledger/token 属于 Pagelet Host Policy；`MemorySearchTool` 不保存或共享
   `lastSearchState`。
3. retry 不自动移除用户显式时间约束。Pagelet 在没有显式时间约束时可以跨时间探索。
4. 每个 Pagelet Run 最终允许 `0–2` 个 insights：零个时 retry 目标是尝试获得首个；
   已有一个且存在具体未解决 lead 时，retry 才可尝试第二个独立 insight。第二个必须是
   不同发现而非改写，并独立通过 source grounding、currentness、novelty 与价值门。
5. Chat 的 valid-none relaxed retry 复用首次通过验证的 `search_memory` query、首次派生的
   lexical plan 与不可变的显式时间意图；不再做关键词提取、模型 rewrite，也不把 path、
   title 或候选文本拼入 query。
6. 首轮仅在结构有效且显式 `none_relevant` 时建立 run-scoped rejected-evidence ledger。
   ledger 只覆盖实际进入首轮 reranker 的、Boundary-safe 的最多 18 个候选，以
   `canonical path + reranker-visible evidence fingerprint` 标识；deterministic zero-
   candidate miss 的 ledger 为空。它不持久化，也不进入 provider、answer-model
   observation、日志、telemetry 或 replay。
7. relaxed retry 将候选分为 novel path、同 path 的 changed evidence 与 exact repeat。
   direct 和 graph 候选均按 novel 优先、changed evidence 仅回填空位；exact repeat 不得
   进入候选、reranker 或最终 evidence。Direct 必须有界 overfetch，并在 12-candidate cap
   前过滤 exact repeat，不能让旧结果占满席位后再过滤。
8. suppression 只改变 candidate eligibility，不删除图节点或 transition。首次被拒绝的
   allowed path 仍可作为传播状态，保留 `allowed A → rejected B → allowed C` 的探索能力。
   PPR 优先使用 relaxed attempt 的 novel/changed direct seeds；只有 fresh direct seed 为零
   时，才可用首轮 direct seed 作为 topology-only fallback roots，且不得为填满三个 seed
   席位而混入旧 seed。
9. valid partial 属于独立恢复分支：首轮有效 evidence 必须保留并与 retry evidence 在一个
   全局最多 8-document projection 内合并，不能套用 valid-none 的空 evidence 语义。

OD-05A 的 query reuse 与 exact-evidence suppression 已确认。“Host 自动执行”是产品边界；
具体 coordinator/executor seam、并发 token arbitration、partial evidence 合并和
deadline/finalization reserve 由 SDD EC-03 收束为可验证的工程合同，不能把 prompt 自律
当成实现。实施、验证与 rollout 的当前状态只记录在
[B-125 Tracker](../../development/active/retrieval-optimization/tracker.md)，本 Decision 不镜像。

### 6. Lexical correctness before retrieval tuning

1. SQLite FTS5 继续作为本地 lexical retrieval engine，默认 BM25 rank 继续与 vector
   ranking 通过 RRF 融合。当前阶段不引入 SPLADE、外部 search service 或新的 learned
   sparse index。
2. CJK lexical text 必须在索引端和查询端使用同一个确定性 normalization。禁止只在
   query 端生成逐字 phrase、却继续索引未分隔的连续 CJK token。原始 Markdown、展示
   chunk 和 embedding input 保持不变；normalization 只生成本地 derived FTS surface。
3. Shipping CJK profile family 是 owner-confirmed `CHAR-PHRASE`：索引与查询使用同一
   CJK grapheme-character normalization，连续 CJK run 使用保持顺序与相邻关系的 phrase
   语义。目标 FTS surface 应能分别评测 `title`、`heading`、`body` 和低权重 path-derived
   signal。具体物理 token 编码/字段、BM25 列权重、strict phrase/AND 与 broad OR 候选
   策略、候选深度和 RRF 参数必须由真实 sqlite-wasm fixtures 与最慢支持设备数据决定，
   不能由本 Decision 固定经验常数。
4. Trigram 不作为默认 CJK 修复，因为 FTS5 trigram 对少于三个 Unicode 字符的全文
   query 不匹配；它仅可在评测证明三字以上 substring 是独立主要漏召回来源后，作为
   可回滚的辅助 surface。
5. 在 CJK correctness 修复和对照评测完成前，不用当前 FTS miss 证明需要 semantic
   query rewrite，也不为 retry 新增 rewrite model call。现有关键词压缩/时间意图处理
   在首次 standard attempt 后冻结并由 relaxed retry 原样复用；未来只有 fixtures 证明
   主要剩余失败是 vocabulary mismatch，才重开 semantic rewrite 决策。
6. FTS schema/profile 变化只触发本地 derived index rebuild。应优先从已有安全 chunk
   records 重建，不重新 embedding、不调用 provider、不修改或删除 Markdown；重建不
   可用时保持诚实的 vector-only/direct fallback，并暴露无内容的 reason/timing 信号。
7. Phase 0A 是 production-zero-change evidence gate：它先比较 deterministic
   overlapping bigram + indexed unigram fallback、symmetric character phrase 与显式
   locale/fingerprint 的 `Intl.Segmenter`，FTS5 trigram 只证明少于三字符的限制。
   fixtures 必须先于 strategy 冻结；通过门槛本身只产生 shortlist。完成上下文边界、
   2k/10k/25k 规模与当前 macOS renderer 补充证据后，owner 另行确认 OD-06A 选择
   `CHAR-PHRASE`，不是由 runner 自动宣布赢家。

## Consequences

- Product behavior: Chat miss 会有一次有界恢复机会；Pagelet 能在不追求数量的前提下
  返回最多两个更深入的洞察，仍允许安静地返回零个。
- Architecture / data / safety: Chat/Pagelet 共用 additive 三 lane retrieval substrate，
  surface-specific Host Policy 只负责 query、retry 与结果验证；retry 状态从 tool 移到
  run-scoped Host Policy。PPR 使用一个有界 opaque topology exception，但 excluded 内容
  和身份不进入模型或输出。
- Compatibility / migration: 不新增 vault source schema 或跨设备持久迁移；FTS profile
  升级会重建 device-local derived index，但不重新 embedding 或调用 provider。PPR-only
  失败可保留安全的 modernized Local；共享 graph 安全失败回到 direct-only。feature flag
  可分别关闭 strict rerank、PPR 或 retry；关闭 PPR 不得恢复按 adjacency 顺序截断的旧
  one-hop。
- Work created or removed: 建立 B-125 Active Package；B-123 的单结果 Deep Discover
  验证继续是历史实现证据，不能证明 B-125 已交付。

## Revisit Trigger

- 固定评测显示 convergence lane 没有提高有价值 multi-source insight 的召回，或明显降低
  precision。
- opaque bridge 出现 path/title/content 泄漏，或 excluded hub 造成不可接受的结果漂移。
- Pagelet 第二 insight 经常只是重复第一 insight，或明显增加延迟/成本而无新增价值。
- lane workset、6 个 graph candidates 或 8 个 documents 在真实 vault 中持续截断高价值
  证据，或单候选提名让弱结构候选持续挤掉明显更强的语义候选。
- `alpha=0.75`、误差目标或 cosine gate 在真实拓扑中产生可重复的远端漏召回。
- CJK、title/heading 或错误码 fixtures 在修复后仍不能进入 reranker 候选，或 derived
  FTS 的索引大小、重建/更新成本、iPhone p95 latency 超过可接受范围。

## Traceability

- Product Spec: [PA Active Vault Indexer — B-125 scoped amendment](../specs/pa-active-vault-indexer-product-spec.md#101-b-125-scoped-retrieval-optimization)
- Data contract: [PA Data Boundary](../specs/pa-data-boundary-product-spec.md)
- Pagelet contract: [Pagelet Product Design](../pagelet-product-design.md)
- Architecture / SDD: [B-125 Retrieval Optimization SDD](../../development/active/retrieval-optimization/sdd.md)
- Tracker: [B-125 Development Tracker](../../development/active/retrieval-optimization/tracker.md)
- Source request: Owner discussion and sequential confirmations, 2026-08-08
- Supersedes / superseded by: supersedes the conflicting algorithm, boundary, projection and retry-state choices in the 2026-08-07 retrieval-optimization draft; none otherwise
