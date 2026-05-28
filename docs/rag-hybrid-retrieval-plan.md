# Note RAG 检索增强 — 中长期方案

## Context

短期优化已完成（代码块保留进索引 + 0.30 分数阈值过滤）。当前检索是纯语义单路，核心不足：

1. **无关键词精确匹配** — 函数名、错误码、专有名词等在 embedding 空间区分度低

技术前提已验证：FTS5 已编入 WASM binary（`ENABLE_FTS5`），`@sqliteai/sqlite-wasm` 3.50.4 支持 `contentless_delete=1`。

## Phase 总览

```
Phase 1 (Done)     Phase 2 (Mid-term)           Phase 3 (数据驱动，按需启动)
代码块保留          FTS5 Hybrid Retrieval         Query Rewrite 或 Reranker
分数阈值过滤        unicode61 + RRF 融合           根据 Phase 2 miss case 决定做哪个
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

## Phase 3: 数据驱动的检索增强（按需启动）

Phase 2 稳定运行后，收集实际搜索 miss case，分析是**召回问题**还是**排序问题**，按需启动以下之一：

### 选项 A：改善 plannerGuidance（零成本优先）

agent 本身是 LLM，已经在构造 search_memory query。优化 `search_memory` tool 的 `plannerGuidance` prompt 指令（如明确要求保留专有名词、拆分中英文关键词），零延迟、零 token 成本。

**在考虑 LLM query rewrite 之前先穷尽这条路。**

### 选项 B：LLM Reranker（排序问题时启动）

如果 miss case 显示 RRF 排序导致好结果被挤出 top-4：
- 在 `normalizeSearchCandidates()` 返回 6 candidates 后，用 LLM 做 relevance scoring
- 使用独立的 model 配置（不复用 `policyModelName`），避免与 capability classifier 耦合
- 必须加 timeout（500ms）和 fallback
- `memory-reranking` 状态基础设施已预埋

### 选项 C：Query Rewrite（召回问题时启动）

如果 miss case 显示 agent query 质量是瓶颈（plannerGuidance 调优后仍不足）：
- 专门的 query rewrite LLM 调用，独立 model 配置
- 可拆分为 semanticQuery + keywordQuery 分别喂两条检索腿
- 必须加 timeout（500ms）和 fallback

### 决策原则

- 不预先承诺同时做 B 和 C — 根据数据单独决策
- 每个功能独立开关、独立 model 配置
- 延迟预算：现有 classifier 用 qwen-turbo 给了 800ms timeout，任何新增 LLM 调用都要按 300-500ms 实际延迟估算
