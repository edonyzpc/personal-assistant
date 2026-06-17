# SDD: Graph-Aware Retrieval — 1-hop Link Expansion

**Status:** `[A]` Approved
**SPEC:** SPEC-E2
**Phase:** v2.5

---

## 1. Context

PA Agent 搜索管线当前是点对点的：query → embed → brute-force → RRF → rerank → return top-8。命中笔记 A 后不会追踪 A 的 wikilinks 拉入关联笔记 B。Obsidian 的核心价值是 wikilink 网络，图感知检索是差异化能力。

## 2. 设计

### 2.1 展开方向

仅 **outbound links**。`app.metadataCache.resolvedLinks[path]` 直接返回 `Record<targetPath, count>`，O(1) 查找。不做 backlink expansion（需遍历全图，成本高且价值相对低）。

### 2.2 展开深度

**1-hop only**。多跳展开指数膨胀，且对 reranker 候选质量稀释。

### 2.3 候选膨胀控制

- 取 **top-3** scored candidates 做展开（按 `MemoryCandidate.score` 排序）
- 每个候选最多展开 **2 个** outbound links
- 最多新增 **6 个** expanded candidates
- 已在候选集中的路径不重复加入

### 2.4 Score 衰减

expanded candidate score = **parent.score × 0.5**（不直接命中查询，应排在直接命中之后）。

### 2.5 内容来源

expanded candidate 不做 VSS 查询获取 chunk 内容（避免 worker round-trip 延迟）。使用路径名作为 excerpt：`"[linked from ${parentPath}]"`。reranker 看到路径和 heading 信息后可以判断相关性。

### 2.6 搜索管线插入点

```
searchVss():
  rawResults = searchHybrid(...)
  candidates = normalizeSearchCandidates(rawResults)
  expanded = expandByOneHop(candidates, resolvedLinks)   ← 新增
  rankedCandidates = rerankCandidates(query, expanded, ...)
  documents = flattenCandidateDocuments(rankedCandidates).slice(0, MAX_MEMORY_DOCUMENTS)
```

### 2.7 Pagelet 影响

`findPageletRelatedNotes()` **不做**图展开。它已有独立的 VSS 语义搜索，图展开仅用于 PA Agent Chat 搜索管线。

### 2.8 性能预算

`resolvedLinks` 是 Obsidian 内存中的 metadata cache，O(1) 键查找。整个 expansion 操作 < 1ms。**无 VSS worker 调用**，无网络请求。

## 3. 实现

### 3.1 新增函数

`pa-agent-runtime.ts` 新增 `expandByOneHop()`：

```ts
function expandByOneHop(
    candidates: MemoryCandidate[],
    resolvedLinks: Record<string, Record<string, number>> | undefined,
): MemoryCandidate[]
```

### 3.2 plugin 接口

需从 plugin 暴露 `resolvedLinks`。通过 `PaAgentRuntime` 的 `plugin` 引用访问 `this.plugin.app.metadataCache.resolvedLinks`。

## 4. 影响范围

| 文件 | 改动 |
|------|------|
| `src/ai-services/pa-agent-runtime.ts` | 新增 `expandByOneHop()`，`searchVss()` 中调用 |
