# Note RAG 检索增强 — 中长期方案

## Context

短期优化已完成（代码块保留进索引 + 0.30 分数阈值过滤）。当前检索是纯语义单路，核心不足：

1. **无关键词精确匹配** — 函数名、错误码、专有名词等在 embedding 空间区分度低

技术前提已验证：FTS5 已编入 WASM binary（`ENABLE_FTS5`），`@sqliteai/sqlite-wasm` 3.50.4 支持 `contentless_delete=1`。

## Phase 总览

```
Phase 1 (Done)     Phase 2 (Done)               Phase 3 (In Progress)
代码块保留          FTS5 Hybrid Retrieval         Query Rewrite + LLM Reranker
分数阈值过滤        Intl.Segmenter + RRF 融合      并行延迟优化，仅 +200ms overhead
```

---

## Phase 2: FTS5 Hybrid Retrieval

### 架构

```
query
  |
  +---> embedQuery(query) ---------> vector_full_scan top-8
  |                                         |
  +---> buildFtsQuery(query) ------> FTS5 MATCH top-8
                                            |
                                    RRF 融合 (k=60) top-12
                                            |
                                    normalizeSearchCandidates
                                    (score filter + group) top-6
                                            |
                                    flattenCandidateDocuments top-4
                                            |
                                        LLM context
```

### Schema

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vss_chunks_fts USING fts5(
    content,
    content='',
    contentless_delete=1,
    tokenize='unicode61 remove_diacritics 2'
);
```

- `content=''` — contentless 模式，零存储重复（移动端关键）
- `contentless_delete=1` — SQLite 3.43.0+，当前 3.50.4 满足
- `unicode61` — CJK 每字符一个 token，bare term implicit AND 即可，v1 不需要 phrase query
- rowid 与 `vss_chunks.id` 一一映射
- 不做 schema version bump，用 `IF NOT EXISTS` + 空表检测回填

### FTS Query 构造

内联到 `vss.ts` 的简单函数（~20 行），不单独建文件：
- 转义 FTS5 特殊字符（`"`、`*`、`^`、`+`、`-`、`NEAR`、括号）
- 按空格/标点拆分为 token，过滤空 token
- 返回 `null` 表示无有效 token（空 query / 全 emoji），调用方跳过 FTS 腿
- v1 不使用 Intl.Segmenter phrase query，unicode61 的 CJK 单字 token + implicit AND 足够

### RRF 融合

```
RRF_score(doc) = Σ 1/(60 + rank_i)   // rank 1-indexed, k=60
```

直接使用 RRF 原始分数，不做 [0,1] 归一化。切换到 hybrid 后将 `MIN_MEMORY_SCORE` 重新标定为 RRF 量级（如 `0.008`，约等于单源 rank-5）。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/vss/sqlite-worker.ts` | FTS5 DDL 加入 `createSchema()`、upsert/delete/reset 同步、`searchHybrid()` handler、空表回填 |
| `src/vss/sqlite-worker-protocol.ts` | `"searchHybrid"` request/response 类型 |
| `src/vss/sqlite-vector-index.ts` | `searchHybrid()` proxy 方法（加在具体类上，不改 `VectorIndex` 接口） |
| `src/vss.ts` | `searchHybrid()` 方法 + 内联 `buildFtsQuery()` |
| `src/ai-services/pa-agent-runtime.ts` | `searchVss()` 改用 `searchHybrid()`，`MIN_MEMORY_SCORE` 重标定 |

共 5 个文件，0 个新建文件。

### 必须处理的风险

**HIGH — reset / rollback 安全：**
- `reset()` 必须加 `DROP TABLE IF EXISTS vss_chunks_fts`（含 shadow tables）
- 降级后老代码的 `deleteFile()` 不触碰 FTS5，重新升级后需要触发回填修复

**HIGH — FTS5 完整性：**
- `verify()` 中加 `INSERT INTO vss_chunks_fts(vss_chunks_fts) VALUES('integrity-check')`
- 完整性失败时支持 FTS5-only rebuild：`DELETE FROM vss_chunks_fts` + 重新从 `vss_chunks` 回填（不需要 re-embedding）

**MEDIUM — 空 query 保护：**
- `buildFtsQuery()` 返回 `null` 时，worker 跳过 FTS 腿，仅返回向量结果

**MEDIUM — 移动端冷启动延迟：**
- FTS5 MATCH 加 timeout（300ms），超时 fallback 到纯向量结果
- OPFS SAH pool `initialCapacity` 从 8 提升到 12，为 FTS5 shadow tables 留余量

**MEDIUM — FTS5 特殊字符：**
- 完整转义列表：`"` `*` `^` `+` `-` `(` `)` `NEAR` `AND` `OR` `NOT`
- Emoji 被 unicode61 丢弃，作为已知限制记录

### 测试

1. `buildFtsQuery` 测试加入 `vss.test.ts` — CJK/Latin/混合/代码关键词/空输入/全 emoji/特殊字符转义
2. RRF 融合单元测试 — 重叠/非重叠/单源/空结果/并列
3. `sqlite-vector-index.test.ts` — 扩展覆盖 `searchHybrid` proxy
4. `vss.test.ts` — FTS5 回填逻辑、reset 清理
5. 手动验证 — 中英混合笔记，关键词 query 召回率对比，移动端冷启动延迟实测

### 兼容性

- 无需 re-embedding，FTS5 回填读 `vss_chunks.content`
- `IF NOT EXISTS` 对新老版本都安全
- 降级后 FTS5 孤儿表无害，下次 reset 或升级回填时自动清理
- 移动端：OPFS 已是前提，FTS5 在 WASM 内
- 存储开销：contentless FTS5 ≈ chunk 文本大小的 15-25%

### 实施子步骤

1. **2a**: FTS5 DDL + reset/verify 安全 + 空表回填
2. **2b**: `buildFtsQuery()` 内联 + 空 query 保护
3. **2c**: `searchHybrid` worker 协议 + RRF 融合
4. **2d**: 接入 MemorySearchTool，MIN_MEMORY_SCORE 重标定

---

## Phase 3: Query Rewrite + LLM Reranker（并行延迟优化方案）

双做 Rewrite + Reranker，通过并行化将延迟 overhead 压到仅 +200ms（等于只做 Reranker）。

### 核心延迟优化

Rewrite 与 embedQuery 并行执行。embed ~250ms，Rewrite ~150ms，并行后 Rewrite 完全被 embed 遮蔽。

```
Phase 2: 330ms          Phase 3: 530ms (+200ms only)
embed(250) + worker(80)  embed‖rewrite(250) + worker(80) + reranker(200)
```

### 时序图

```
T=0:   ┬─→ embedQuery(originalQuery)      [~250ms network]
       └─→ rewriteQuery(originalQuery)     [~150ms network, parallel]

T=150: rewrite done → keywordQuery ready   (embed still in flight)
T=250: embed done → queryEmbedding ready
       → buildFtsQuery(keywordQuery)        [~0ms local]
       → searchHybrid(embedding, ftsQuery)  [~80ms worker]

T=330: 6 candidates ready
       → emit "memory-reranking" status
       → rerankCandidates(query, candidates) [~200ms network]

T=530: done ✓
```

设计取舍：embed 使用 originalQuery（不等 Rewrite 的 semanticQuery），换取并行性。Rewrite 只产出 `keywordQuery` 优化 FTS 腿。

### Query Rewrite（`src/ai-services/query-rewriter.ts`）

从原始 query 提取 2-6 个关键词用于 FTS 精确匹配：
- 复用 `policyModelName`（qwen-turbo）
- 返回 JSON `{"keywords":"..."}`
- 短 query (≤3 tokens) 跳过
- timeout 500ms，失败 fallback 到原始 query

### LLM Reranker（`pa-agent-runtime.ts` 内）

对 `normalizeSearchCandidates()` 返回的 6 candidates 做 relevance ranking：
- 复用 `policyModelName`
- 返回 JSON `{"ranking":[0,2,1,...]}`（按相关性排序的候选索引）
- timeout 500ms，失败 fallback 到 RRF 原序
- 发射 `{ type: "memory-reranking", candidateCount }` 状态

### 降级策略

| 条件 | 行为 |
|------|------|
| `policyModelName` 为空 | 跳过 rewrite 和 reranker，等价于 Phase 2 |
| query ≤3 tokens | rewrite 跳过，FTS 用原始 query |
| rewrite 超时/失败 | FTS 用原始 query |
| reranker 超时/失败 | 保持 RRF 原序 |
| candidates ≤1 | 跳过 reranker |

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/ai-services/pa-agent-runtime.ts` | `searchVss()` 集成并行 rewrite + 串行 rerank |
| `src/vss.ts` | `searchHybrid()` 增加可选 `ftsQueryOverride` 参数 |
| **新** `src/ai-services/query-rewriter.ts` | `rewriteQuery()` |
| **新** `__tests__/query-rewriter.test.ts` | rewrite 测试（mock LLM） |
