# SDD: Graph-Aware Retrieval — 1-hop Link Expansion

**Status:** `[x]` Implemented
**SPEC:** SPEC-E2
**Phase:** v2.5

---

## 1. Context

PA Agent 搜索管线当前是点对点的：query → embed → brute-force → RRF → rerank → return top-8。命中笔记 A 后不会追踪 A 的 wikilinks 拉入关联笔记 B。Obsidian 的核心价值是 wikilink 网络，图感知检索是差异化能力。

## 2. 当前实现

### 2.1 展开方向

同时展开 **outbound links** 和 **inbound backlinks**：

- outbound：读取 `resolvedLinks[parent.path]`。
- inbound/backlink：遍历 `resolvedLinks`，查找指向 `parent.path` 的来源笔记。

实现位于 `src/ai-services/memory-search-tool.ts:335` 的 `expandByOneHop()`。

### 2.2 展开深度

**1-hop only**。多跳展开指数膨胀，且对 reranker 候选质量稀释。

### 2.3 候选膨胀控制

- 取 **top-3** scored candidates 做展开（沿用当前候选排序）
- 每个候选最多展开 **2 个 outbound links** + **2 个 inbound backlinks**
- 最多新增 **12 个** expanded candidates（实际会被已存在路径去重和 VSS chunk lookup 结果进一步收敛）
- 已在候选集中的路径不重复加入

### 2.4 Score 衰减

- outbound expanded candidate score = **parent.score × 0.5**
- inbound/backlink expanded candidate score = **parent.score × 0.4**

Backlink 衰减更强，因为它只说明其他笔记引用了当前命中，不一定直接回答查询。

### 2.5 内容来源

expanded candidate 通过 VSS exact chunk fetch 获取内容：`memorySearch.getChunksByPath(paths, { limitPerPath: MAX_MEMORY_CANDIDATE_CHUNKS })`。

如果 chunk lookup 不可用、抛错或返回空结果，该 expanded candidate 会被跳过；当前实现不再使用路径占位 excerpt 参与 rerank。

### 2.6 搜索管线插入点

```
searchVss():
  rawResults = searchHybrid(...)
  candidates = normalizeSearchCandidates(rawResults)
  expanded = await expandByOneHop(candidates, resolvedLinks, getChunksByPath)
  rankedCandidates = rerankCandidates(query, expanded, ...)
  documents = flattenCandidateDocuments(rankedCandidates).slice(0, MAX_MEMORY_DOCUMENTS)
```

### 2.7 Pagelet 影响

`findPageletRelatedNotes()` 不做图展开。它已有独立的 VSS 语义搜索，图展开仅用于 PA Agent Chat Memory 搜索管线。

### 2.8 性能预算

`resolvedLinks` 是 Obsidian 内存中的 metadata cache。Outbound 查找是 O(1)；inbound/backlink 查找会遍历 `resolvedLinks`，但只针对 top-3 candidates 且每个候选最多取 2 个 backlink。内容获取增加一次 VSS chunk fetch，不产生网络请求。

## 3. 实现

### 3.1 新增函数

`memory-search-tool.ts` 暴露 `expandByOneHop()`，并从 `pa-agent-runtime.ts` re-export 给测试：

```ts
async function expandByOneHop(
    candidates: MemoryCandidate[],
    resolvedLinks: Record<string, Record<string, number>> | undefined,
    fetchChunks?: (paths: string[]) => Promise<RawSearchResult[]>,
): Promise<MemoryCandidate[]>
```

### 3.2 plugin 接口

`AiServiceHost.getResolvedLinks()` 暴露 Obsidian `metadataCache.resolvedLinks`，`MemorySearchTool.searchVss()` 同时传入 `memorySearch.getChunksByPath()` 作为 expanded candidate 内容来源。

## 4. 影响范围

| 文件 | 改动 |
|------|------|
| `src/ai-services/memory-search-tool.ts` | `expandByOneHop()` + `searchVss()` 中调用 |
| `src/ai-services/pa-agent-runtime.ts` | re-export `expandByOneHop()` 供测试 |
