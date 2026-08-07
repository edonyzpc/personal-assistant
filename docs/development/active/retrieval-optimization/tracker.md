# Retrieval Pipeline Optimization — Development Tracker

Document status: Active
Updated: 2026-08-07
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Progress Summary

| Phase | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| Phase 1: Self-RAG 反思 | Pending | — | — | |
| Phase 2: PPR 图扩展 | Pending | — | — | |
| Phase 3: 单次重试 | Pending | — | — | |

## Phase 1: Self-RAG Retrieval Quality Gate

### Tasks

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 1.1 | 添加 `RerankVerdict` 类型到 `src/ai-services/chat-types.ts` | Pending | | |
| 1.2 | 扩展 `MemorySearchResult` 接口（rerankVerdict + filteredCandidatePaths） | Pending | | |
| 1.3 | 修改 `RERANK_SYSTEM_PROMPT` 添加 verdict 指令 | Pending | | |
| 1.4 | 重写 `parseRerankResponse` → 返回 `RerankResult`；修复空 ranking bug | Pending | | |
| 1.5 | 修改 `rerankCandidates` 返回类型为 `RerankResult` | Pending | | |
| 1.6 | 修改 `searchVss` 消费 verdict：none_relevant 时清空 documents + 填充 filteredCandidatePaths | Pending | | |
| 1.7 | 修改 `getToolResultControlMetadata` 传递 rerankVerdict | Pending | | |
| 1.8 | 添加 `memoryStrictRelevanceFilter` feature flag 到 settings | Pending | | |
| 1.9 | 新建 `__tests__/memory-search-rerank.test.ts` 覆盖所有 verdict 场景 | Pending | | |
| 1.10 | 运行 `make deploy` 确认全链路通过 | Pending | | |
| 1.11 | 回归测试：现有 memory 相关测试全部通过 | Pending | | |

### Exit Criteria

- [ ] `parseRerankResponse({"ranking":[], "verdict":"none_relevant"}, candidates)` 返回 `{ candidates: [], verdict: "none_relevant" }`
- [ ] `parseRerankResponse({"ranking":[0,1]}, candidates)` 返回 `{ candidates: [c0, c1], verdict: "relevant" }` （无 verdict 字段向后兼容）
- [ ] none_relevant 结果的 `filteredCandidatePaths` 包含被过滤候选的路径
- [ ] `make deploy` 通过
- [ ] 现有 `__tests__/` 无回归

---

## Phase 2: PPR Graph Expansion

### Tasks

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 2.1 | 新建 `src/graph/personalized-pagerank.ts`：`computePPRParams` + `personalizedPageRank` | Pending | | |
| 2.2 | 新建 `__tests__/personalized-pagerank.test.ts`：star/clique/chain/disconnected 图测试 | Pending | | |
| 2.3 | 新建 `src/graph/ppr-expansion.ts`：`expandByPPR` 完整流程 | Pending | | |
| 2.4 | 在 `vss-core.ts` 添加 `_lastQueryEmbedding` transient field + getter，searchHybrid 内部赋值 | Pending | | 前置：PPR 向量验证的必要条件 |
| 2.5 | 在 `vss-core.ts` 新增 `computeCosineSimilarityForPaths(paths, queryEmbedding)` 方法 | Pending | | |
| 2.6 | 扩展 `AiServiceHost` 接口：添加 `computeQueryCosineSimilarity(paths: string[], queryEmbedding: number[])` | Pending | | 注意类型是 number[] 不是 Float32Array |
| 2.7 | 在 `plugin.ts` 中实现 `computeQueryCosineSimilarity`（读取 lastQueryEmbedding） | Pending | | |
| 2.8 | 确保 `normalizeSearchCandidates` 和 `RawSearchResult` 从 `memory-search-tool.ts` 导出 | Pending | | ppr-expansion.ts 需要 import |
| 2.9 | 修改 `memory-search-tool.ts`：读取 lastQueryEmbedding + 条件调用 PPR / one-hop（totalEdges > 20） | Pending | | |
| 2.10 | 扩展 `MemorySearchPort.searchHybrid` options：添加可选 `k`/`fusionTopK` 参数 | Pending | | Phase 3 前置，但在 Phase 2 中实施更自然 |
| 2.11 | 添加 `memoryPPRExpansion` feature flag 到 settings | Pending | | |
| 2.12 | 新建 `__tests__/ppr-expansion.test.ts`：mock 全流程测试 | Pending | | |
| 2.13 | 性能测试：5000 节点合成图 PPR×3 < 50ms（CI 环境 < 100ms 亦可接受） | Pending | | |
| 2.14 | 运行 `make deploy` 确认全链路通过 | Pending | | |
| 2.15 | 回归测试：现有 memory 相关测试全部通过 | Pending | | |
| 2.16 | Obsidian smoke：在 vault 中对有 2-3 跳链接关系的笔记提问，验证 PPR 扩展命中 | Pending | | |

### Exit Criteria

- [ ] `personalizedPageRank(center, starGraph, params)` 对所有叶子节点返回 score 差异 < 1e-6（均匀度数→均匀分数）
- [ ] Degree-penalized PPR 中 hub 节点 (degree=20) score < 等距非 hub 节点 (degree=2) score
- [ ] `computePPRParams` 在 avgDegree=2 时返回 alpha === 0.84，avgDegree=10 时返回 alpha === 0.6
- [ ] `expandByPPR` 对 cosine < 0.3 的候选正确过滤
- [ ] totalEdges ≤ 20 时走 `expandByOneHop` 路径
- [ ] PPR×3 on 5000-node graph < 50ms (desktop benchmark)
- [ ] `make deploy` 通过
- [ ] 现有 `__tests__/` 无回归

---

## Phase 3: Agentic Single-Retry Recovery

### Tasks

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 3.1 | 修改 `searchVss` 添加 `isRetry` 参数 + 放宽参数（vector k=12, fusionTopK=18, PPR cosine=0.2） | Pending | | |
| 3.2 | 添加 `lastSearchState` 到 `MemorySearchTool`（含 query + result + verdict） | Pending | | |
| 3.3 | 修改 `search()` 方法：基于上次 verdict 判定 isRetry（非仅判断是否存在上次结果）+ query 去重 | Pending | | |
| 3.4 | 修改 `serializeToolObservation`：none_relevant/partially_relevant 时添加 retrievalGuidance | Pending | | |
| 3.5 | 修改 system prompt：添加 search_memory 使用指引 + retry 限制 | Pending | | |
| 3.6 | 修改 `pa-agent-required-capability-policy.ts`：扩展 follow-up 条件支持 none_relevant 重试 | Pending | | |
| 3.7 | 添加 `memoryRetryOnMiss` feature flag 到 settings | Pending | | |
| 3.8 | 新建 `__tests__/memory-search-retry.test.ts` | Pending | | |
| 3.9 | 测试：isRetry 仅在上次 verdict 为 none/partially 时触发（unrelated follow-up 不触发） | Pending | | |
| 3.10 | 测试：retrievalGuidance 文本不出现在 agent 最终回复中 | Pending | | |
| 3.11 | 运行 `make deploy` 确认全链路通过 | Pending | | |
| 3.12 | Obsidian smoke：首次 miss → 重试命中验证 | Pending | | |
| 3.13 | 回归测试：现有 memory 相关测试全部通过 | Pending | | |

### Exit Criteria

- [ ] `isRetry=true` 时 hybrid search 使用 k=12
- [ ] `isRetry=true` 时 PPR cosineThreshold=0.2
- [ ] 相同 query string 第二次调用返回缓存结果
- [ ] none_relevant 结果中包含 `retrievalGuidance` 字段
- [ ] partially_relevant 结果中包含 optional guidance 字段
- [ ] Agent 能在 none_relevant 后发起第二次 search_memory 调用（follow-up policy 允许）
- [ ] `make deploy` 通过
- [ ] 现有 `__tests__/` 无回归

---

## Observability Checklist

交付完成后应能通过 debug log 观察到：

| 指标 | 来源 | 预期范围 |
|------|------|---------|
| verdict 分布 | reranker 输出 | relevant ~60%, partially ~20%, none ~20% |
| PPR 耗时 | expandByPPR 计时 | <30ms desktop, <50ms mobile |
| PPR 扩展候选数 | expandByPPR 返回 | 0-6 个（cosine 验证后） |
| retry 触发率 | isRetry=true 的调用比例 | <15% of all search_memory calls |
| retry 成功率 | retry 后 hasAnswerableContent=true | >30% of retries |

---

## Blockers And Issues

| # | Issue | Severity | Status | Resolution |
|---|-------|----------|--------|------------|
| — | — | — | — | — |
