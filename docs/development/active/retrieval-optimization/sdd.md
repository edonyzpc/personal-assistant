# Retrieval Pipeline Optimization — Software Design Document

Document status: Approved
Updated: 2026-08-07
Authority: Memory search pipeline quality, recall, and latency improvements.

## Overview

This document is the implementation specification for a 3-phase optimization of the PA Agent's retrieval pipeline (`src/ai-services/memory-search-tool.ts` and related modules). It is designed as a Codex handoff — all technical decisions are final and justified with reasoning. **Do not deviate from the specified algorithms, parameters, or architecture without explicit approval.**

### Problem Statement

The current retrieval pipeline sits at RAG evolution stage ② (Modular RAG) with these concrete defects:

1. **Reranker correctness bug**: `parseRerankResponse` (memory-search-tool.ts:228) returns ALL candidates when the LLM outputs `{"ranking":[]}`, instead of returning an empty set. This injects irrelevant content into the agent's prompt.

2. **Graph underutilization**: Obsidian's `[[wikilink]]` graph is only exploited via 1-hop expansion (top-3 candidates × 2 outbound + 2 backlinks). Notes 2-3 hops away that belong to the same topic cluster are never retrieved.

3. **No retrieval failure recovery**: When `search_memory` returns no useful results, the agent gives up. There is no mechanism to retry with refined keywords or relaxed parameters.

### Product North Star Alignment

> 随手记下，需要时自然浮现。安静且可信。

- Phase 1 (verdict): Makes retrieval "more quiet" — stops injecting irrelevant noise into answers.
- Phase 2 (PPR): Makes retrieval "more naturally surfacing" — discovers structurally related notes even when exact vocabulary doesn't match.
- Phase 3 (retry): Makes retrieval "more trustworthy" — doesn't silently give up when first search fails.

---

## Current Source Baseline

Verified with `rg` on 2026-08-07:

| Module | File | Key exports |
|--------|------|-------------|
| Memory search tool | `src/ai-services/memory-search-tool.ts` | `MemorySearchTool`, `parseRerankResponse`, `expandByOneHop`, `normalizeSearchCandidates` |
| Search types | `src/ai-services/chat-types.ts` | `MemorySearchResult`, `MemoryCandidate`, `MemorySearchDocument`, `MemoryCandidateAnchor` |
| Query rewriter | `src/ai-services/query-rewriter.ts` | `rewriteQueryForSearch`, `RewrittenQuery`, `QueryTemporalIntent` |
| Tool factories | `src/ai-services/chat-tool-factories.ts` | `createSearchMemoryTool` |
| Host tools | `src/ai-services/pa-agent-host-tools.ts` | `chatToolResultToPaAgentToolExecutionResult`, `getToolResultControlMetadata` |
| Agent prompts | `src/ai-services/pa-agent-prompts.ts` | system prompt, `formatToolObservations` |
| Required capability | `src/ai-services/pa-agent-required-capability-policy.ts` | `createRequiredCapabilityHostPolicy`, `RequiredCapabilityClassification` |
| RRF fusion | `src/vss/rrf.ts` | `fuseRRF`, `RRF_K=60` |
| VSS core | `src/vss/vss-core.ts` | `searchHybrid`, `getChunksByPath` |
| AI service host | `src/ai-services/AiServiceHost.ts` | `AiServiceHost` interface |
| Settings | `src/settings.ts` | `PersonalAssistantSettings` |

### Key constants (current):

```
MAX_MEMORY_DOCUMENTS = 8
MAX_MEMORY_RERANK_CANDIDATES = 12
MAX_MEMORY_CANDIDATE_CHUNKS = 3
MAX_MEMORY_CANDIDATE_EXCERPT_CHARS = 1000
MIN_MEMORY_SCORE = 0.01
RERANK_TIMEOUT_MS = 30_000
REWRITE_TIMEOUT_MS = 30_000
RRF_K = 60
REQUIRED_CAPABILITY_CLASSIFIER_TIMEOUT_MS = 800
```

---

## Phase 1: Self-RAG Retrieval Quality Gate

### Decision Record

#### Decision 1.1: Three-level verdict (not binary)

**Options considered:**
- A) Binary: `relevant` / `none_relevant`
- B) Ternary: `relevant` / `partially_relevant` / `none_relevant`
- C) Start binary, add third level later

**Decision: B (Ternary)**

**Reasoning:**
- `partially_relevant` is strictly additive — it still injects content (unlike `none_relevant` which hides), so the worst case of a false `partially_relevant` classification is an unnecessary retry (+2-4s), not a quality degradation.
- Ternary enables Phase 3's "warm retry" — when results are tangentially related but don't directly answer, the agent can retry with different keywords while still having the partial results available.
- The LLM reranker can reliably distinguish "completely unrelated" (none_relevant) from "related topic but doesn't directly answer" (partially_relevant) — the former is a topic-level judgment, the latter is a directness judgment. Both are feasible for a policy model.
- Three-level gives more optionality for future optimizations without requiring a prompt change.

#### Decision 1.2: Expose filtered paths, not content

**Options considered:**
- A) Completely hide filtered candidates
- B) Hide content, expose file paths only
- C) Expose everything (full excerpts)

**Decision: B**

**Reasoning:**
- When verdict is `none_relevant`, the content is by definition irrelevant — exposing it risks the agent citing it.
- But the file PATHS give the agent a directional clue for retry: "these files were found but weren't relevant, so I should search in a different direction."
- Token cost: ~100 tokens for paths vs ~2000 tokens for full excerpts.
- Aligns with Phase 3 where agent uses these paths to infer what NOT to search for.

#### Decision 1.3: Middle-ground strictness

**Options considered:**
- Conservative: rarely filter (only when COMPLETELY unrelated)
- Middle: `none_relevant` sensitive, `partially_relevant` conservative
- Aggressive: frequently filter

**Decision: Middle ground**

**Reasoning:**
- The "middle ground" means: garbage is filtered (none_relevant triggers reliably for off-topic content), but the `partially_relevant` judgment only fires when the reranker is genuinely uncertain about directness.
- This minimizes both failure modes:
  - "Confident wrong answer" (injecting garbage → agent cites irrelevant notes): reduced by `none_relevant` filtering
  - "Over-filtering good content" (hiding relevant notes): mitigated by keeping `none_relevant` threshold at "topic completely unrelated" level — hard to accidentally filter truly relevant content at this threshold.
- The `partially_relevant` category acts as a safety net: content IS injected (no quality loss) while also signaling retry opportunity.

### Design

#### Modified `RERANK_SYSTEM_PROMPT`

```typescript
const RERANK_SYSTEM_PROMPT = [
    "You are a strict relevance filter for a personal knowledge base.",
    "Task: Decide which candidates ACTUALLY help answer the query.",
    "Rules:",
    "- Include a candidate ONLY if its content directly addresses the query topic",
    "- Omit candidates that merely share superficial keywords or are topically unrelated",
    "Verdict rules:",
    "- \"none_relevant\": no candidate relates to the query topic at all",
    "- \"partially_relevant\": candidates touch the related topic but do not directly answer the specific question",
    "- \"relevant\": at least one candidate directly addresses or highly relates to the query",
    "- When in doubt between none_relevant and partially_relevant, prefer none_relevant",
    "- When in doubt between partially_relevant and relevant, prefer relevant",
    "- Order included candidates by relevance (most relevant first)",
    'Return ONLY valid JSON: {"verdict":"relevant|partially_relevant|none_relevant","ranking":[...]} with 0-based indices.',
].join("\n");
```

Note the asymmetric doubt rules:
- "doubt → none_relevant" for the lower boundary: ensures garbage is filtered
- "doubt → relevant" for the upper boundary: ensures useful content isn't unnecessarily marked partial

#### Modified types and parsing

The canonical `RerankVerdict` type is defined in `chat-types.ts` (alongside `MemorySearchResult` which consumes it):

```typescript
// In chat-types.ts (new export)
export type RerankVerdict = "relevant" | "partially_relevant" | "none_relevant";
```

The internal `RerankResult` interface stays in `memory-search-tool.ts` (only used internally by the reranker):

```typescript
// In memory-search-tool.ts (internal)
import type { RerankVerdict } from "./chat-types";

interface RerankResult {
    candidates: MemoryCandidate[];
    verdict: RerankVerdict;
}

// CRITICAL BUG FIX in parseRerankResponse:
// Current (buggy): if (indices.length === 0) return candidates;
// Fixed: if (indices.length === 0) return { candidates: [], verdict: parsedVerdict ?? "none_relevant" };
```

Parsing logic — must handle the new `verdict` field alongside the existing `ranking` regex:
```typescript
function parseRerankResponseInner(content: string): { indices: number[]; verdict: RerankVerdict } {
    const trimmed = content.trim();
    // Try full JSON parse first (handles both fields reliably)
    try {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const indices = Array.isArray(parsed.ranking)
                ? parsed.ranking.filter((n: unknown) => typeof n === "number" && n >= 0)
                : [];
            const verdict = parseVerdict(parsed.verdict);
            return { indices, verdict };
        }
    } catch { /* fall through to regex */ }

    // Fallback: regex extraction (backward compat with models that output partial JSON)
    const rankingMatch = trimmed.match(/"ranking"\s*:\s*\[([^\]]*)\]/);
    const indices = rankingMatch
        ? rankingMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0)
        : [];
    const verdictMatch = trimmed.match(/"verdict"\s*:\s*"([^"]+)"/);
    const verdict = parseVerdict(verdictMatch?.[1]);
    return { indices, verdict };
}

function parseVerdict(raw: unknown): RerankVerdict {
    if (raw === "none_relevant" || raw === "partially_relevant" || raw === "relevant") {
        return raw;
    }
    return "relevant"; // backward compat: if model doesn't output verdict, assume relevant
}
```

#### Modified `searchVss` flow

```typescript
private async searchVss(query: string, signal?: AbortSignal, options?: { isRetry?: boolean }): Promise<MemorySearchResult> {
    // ... existing hybrid search + expansion ...

    const { candidates: rankedCandidates, verdict } = policyModelName
        ? await this.rerankCandidates(query, boundedExpanded, policyModelName, signal)
        : { candidates: boundedExpanded, verdict: "relevant" as RerankVerdict };

    if (verdict === "none_relevant") {
        return {
            usedMemory: false,
            query,
            documents: [],
            sources: [],
            candidates: rankedCandidates,
            hasAnswerableContent: false,
            needsSnippetFollowup: false,
            rerankVerdict: "none_relevant",
            filteredCandidatePaths: rankedCandidates.map(c => c.path),
        };
    }

    const documents = flattenCandidateDocuments(rankedCandidates).slice(0, MAX_MEMORY_DOCUMENTS);
    return {
        usedMemory: documents.length > 0,
        query,
        documents,
        sources: documents.map(e => e.source),
        candidates: rankedCandidates,
        hasAnswerableContent: documents.length > 0,
        needsSnippetFollowup: false,
        rerankVerdict: verdict,
    };
}
```

#### Modified `MemorySearchResult` (chat-types.ts)

```typescript
export interface MemorySearchResult {
    usedMemory: boolean;
    query: string;
    documents: MemorySearchDocument[];
    sources: ChatAgentSource[];
    candidates?: MemoryCandidate[];
    skipReason?: string;
    hasAnswerableContent?: boolean;
    needsSnippetFollowup?: boolean;
    rerankVerdict?: "relevant" | "partially_relevant" | "none_relevant";  // NEW
    filteredCandidatePaths?: string[];  // NEW: exposed when none_relevant
}
```

#### Modified `getToolResultControlMetadata` (pa-agent-host-tools.ts)

```typescript
function getToolResultControlMetadata(result: ChatToolResult<unknown>): Record<string, unknown> {
    if (result.tool !== "search_memory" || !isSearchMemoryResult(result.content)) return {};
    const memory = result.content;
    // ... existing logic ...
    return {
        hitCount: documentCount,
        candidateCount,
        hasAnswerableContent,
        needsSnippetFollowup,
        rerankVerdict: memory.rerankVerdict,  // NEW
    };
}
```

#### Feature flag

```typescript
// In settings.ts (internal, not in UI)
memoryStrictRelevanceFilter: boolean;  // default: true
```

When `false`, revert to old behavior: `parseRerankResponse` returns original candidates on empty ranking (pre-fix behavior). This is a rollback mechanism only.

---

## Phase 2: Degree-Penalized PPR Graph Expansion

### Decision Record

#### Decision 2.1: PPR over global community detection

**Options considered:**
- A) Global offline community detection (Leiden / Louvain / Label Propagation) — pre-compute communities, store, maintain
- B) Query-time local expansion (Personalized PageRank) — compute on each query from the search hit

**Decision: B (PPR)**

**Reasoning (detailed, since this is the most impactful architectural choice):**

The goal is "accurately find structurally related notes from a search hit." Two approaches:

**Global community detection** assigns each note to ONE community at index-time. Problems:
1. **Query-agnostic**: A note about "React performance" might belong to either "React" or "Performance" community depending on the partition. The correct assignment depends on the QUERY, which isn't known at index-time.
2. **No overlap**: One note → one community. Real knowledge has overlapping clusters.
3. **Maintenance burden**: Community snapshots must be stored (IndexedDB), kept fresh (vault events → recompute), and validated (stale check). This is ~300 lines of infrastructure code with its own failure modes.
4. **Sparse graph behavior**: In a vault with 2-3 links per note, communities are either too large (entire connected component) or too small (individual notes). Neither is useful.

**Query-time PPR** starts from the actual search hit and radiates outward:
1. **Query-aware**: Different search hits → different expansion directions. A "React" hit expands into the React neighborhood; a "performance" hit expands into the performance neighborhood.
2. **Natural overlap**: Same note can be "discovered" from multiple seeds/queries.
3. **Zero maintenance**: No storage, no stale state, no vault event listeners. The graph is read from `app.metadataCache.resolvedLinks` which Obsidian already maintains.
4. **Self-adjusting**: In sparse graphs, PPR naturally produces fewer results (less to expand to). No special-case handling needed.
5. **Handles hubs**: The teleport mechanism (probability of jumping back to seed) + degree-penalized transitions prevent hub nodes from dominating results.

**Performance**: For a vault with 5000 notes and 15000 edges, 3 PPR runs × 12 iterations × 15000 edge traversals = ~540K operations. On modern hardware: <30ms desktop, <50ms mobile. Acceptable.

**Why degree-penalized**: Standard PPR gives each neighbor equal weight proportional to 1/degree(source). Degree-penalized ALSO penalizes high-degree TARGET nodes: `weight = 1 / (degree(source) * sqrt(degree(target)))`. This means "reaching a note through a low-degree connector" counts more than "reaching a note through a hub" — because low-degree connectors are more topically informative (the user deliberately linked only a few things).

#### Decision 2.2: Top-3 seeds with union

**Options considered:**
- A) Top-1 seed only
- B) Top-3 seeds, merge results
- C) First seed with degree ≥ 2

**Decision: B (Top-3)**

**Reasoning:**
- In a sparse graph (2-3 links/note), each seed can only radiate to 2-3 immediate neighbors. A single seed's coverage is narrow.
- Top-3 seeds provide three different expansion directions. If top-1 is an isolated note (degree=1), top-2 or top-3 may have better graph connectivity.
- Multi-source convergence signal: when multiple seeds' PPR results both point to the same note, that's strong evidence of structural relevance.
- Latency cost: 3× PPR on a 300-edge graph ≈ 10ms total. Negligible.

#### Decision 2.3: PPR replaces one-hop (with fallback)

**Decision:** PPR replaces `expandByOneHop` entirely when the vault has sufficient links. Fallback to one-hop when total edges ≤ 20.

**Reasoning:**
- PPR's first iteration IS one-hop expansion (spreading to direct neighbors). So PPR is a strict superset of one-hop.
- PPR adds 2-3 hop reach with proper decay, degree penalization, and multi-seed coverage — all superior to one-hop's hardcoded 0.5/0.4 decay.
- The fallback threshold of 20 total edges covers the case where the vault barely uses wikilinks (e.g., 5 notes with 4 links each). In such sparse graphs, PPR adds nothing over one-hop.
- `expandByOneHop` function is NOT deleted — it remains as the fallback path.

#### Decision 2.4: PPR gate + cosine sort + decay alignment

**Options considered for score combination:**
- A) Multiply PPR × cosine (strict intersection)
- B) Weighted sum (loose union)
- C) PPR as gate, cosine as sort, decay for alignment

**Decision: C**

**Reasoning:**
- **PPR as gate (score > 0.02)**: Determines "is this note structurally reachable from the search hit?" If PPR score is below threshold, the note is too far in the graph to be considered related. This is a structural filter.
- **Cosine as sort**: Among structurally reachable notes, rank by semantic relevance to the query. This ensures that even if a note is structurally close, it only surfaces if semantically related too.
- **Decay for alignment (0.4)**: Expansion candidates must not outrank direct search hits. `final_score = top_candidate_original_score × 0.4 × normalized_cosine` ensures they sort BELOW direct hits but ABOVE the noise floor.
- This layered approach is more interpretable than multiplication or addition: each layer has a clear role (structural filter → semantic rank → priority alignment).

#### Decision 2.5: Adaptive alpha based on average degree

**Reasoning:**
- Alpha controls how far PPR propagates. High alpha (0.85) → spreads far. Low alpha (0.55) → stays local.
- In a sparse graph (avg degree 2-3), high alpha is needed because each hop only reaches 2-3 neighbors — probability needs to travel further to find anything.
- In a dense graph (avg degree 10+), high alpha would spread to 100+ nodes in 2 hops, diluting the signal. Lower alpha keeps results focused.
- Formula: `alpha = max(0.55, min(0.85, 0.9 - avgDegree * 0.03))`
  - avgDegree=2 → alpha=0.84 (sparse, spread far)
  - avgDegree=5 → alpha=0.75 (medium)
  - avgDegree=10 → alpha=0.60 (dense, stay close)

### Design

#### New file: `src/graph/personalized-pagerank.ts`

```typescript
export interface PPROptions {
    alpha: number;
    iterations: number;
    topK: number;
}

export interface PPRResult {
    /** node path → PPR score (excludes seed) */
    scores: Map<string, number>;
}

/**
 * Compute adaptive PPR parameters based on graph density.
 */
export function computePPRParams(
    resolvedLinks: Record<string, Record<string, number>>,
): PPROptions {
    const nodeCount = Object.keys(resolvedLinks).length;
    const edgeCount = Object.values(resolvedLinks)
        .reduce((sum, targets) => sum + Object.keys(targets).length, 0);
    const avgDegree = nodeCount > 0 ? edgeCount / nodeCount : 0;

    const alpha = Math.max(0.55, Math.min(0.85, 0.9 - avgDegree * 0.03));
    // Sparse graphs (high alpha) need more iterations for convergence stability.
    // alpha=0.84 at 15 iterations → residual ~7.6% (vs 12.8% at 12 iterations).
    const iterations = avgDegree > 8 ? 18 : 15;
    const topK = 8;

    return { alpha, iterations, topK };
}

/**
 * Build bidirectional adjacency from resolvedLinks. Call ONCE and pass to all PPR runs.
 *
 * NOTE on mutual links: if A→B and B→A both exist in resolvedLinks, the undirected
 * projection adds B to A's neighbors twice (once as outbound, once as inbound) and vice versa.
 * This gives mutual links ~2× the weight of one-way links, which is intentional: mutual
 * linking indicates a stronger structural relationship. The degree of a node also increases
 * by 2 per mutual link, which naturally feeds into the degree penalty.
 *
 * NOTE on link counts: resolvedLinks values are counts (how many times A links to B in the file).
 * We treat these as binary (link exists or not) — the count is ignored. Multiple [[B]] references
 * in one file do NOT create multiple edges.
 */
export function buildBidirectionalAdjacency(
    resolvedLinks: Record<string, Record<string, number>>,
): { neighbors: Map<string, string[]>; degree: Map<string, number> } {
    const neighbors = new Map<string, string[]>();
    for (const [source, targets] of Object.entries(resolvedLinks)) {
        for (const target of Object.keys(targets)) {
            if (!neighbors.has(source)) neighbors.set(source, []);
            neighbors.get(source)!.push(target);
            if (!neighbors.has(target)) neighbors.set(target, []);
            neighbors.get(target)!.push(source);
        }
    }
    const degree = new Map<string, number>();
    for (const [node, adj] of neighbors) {
        degree.set(node, adj.length);
    }
    return { neighbors, degree };
}

/**
 * Degree-penalized Personalized PageRank.
 *
 * Transition weight from A to B: 1 / (degree(A) * sqrt(degree(B)))
 * After normalization across A's neighbors, the effective bias is purely 1/sqrt(degree(target)).
 * The sourceDegree factor cancels during normalization — the standard PageRank "spreading among
 * all neighbors" behavior is implicit. The degree penalty adds: high-degree TARGET nodes receive
 * proportionally less mass, encoding the Adamic-Adar intuition that "a path through a low-degree
 * connector is more informative than through a hub."
 */
export function personalizedPageRank(
    seed: string,
    adjacency: { neighbors: Map<string, string[]>; degree: Map<string, number> },
    options: PPROptions,
): PPRResult {
    const { alpha, iterations, topK } = options;
    const { neighbors, degree } = adjacency;

    // Power iteration
    let scores = new Map<string, number>([[seed, 1.0]]);

    for (let i = 0; i < iterations; i++) {
        const next = new Map<string, number>();

        for (const [node, score] of scores) {
            if (score < 1e-8) continue; // prune negligible scores

            // Teleport: (1 - alpha) goes back to seed
            next.set(seed, (next.get(seed) ?? 0) + score * (1 - alpha));

            // Propagate: alpha distributed to neighbors with degree penalty
            const adj = neighbors.get(node);
            if (!adj || adj.length === 0) {
                // Dead end: all probability teleports back to seed
                next.set(seed, (next.get(seed) ?? 0) + score * alpha);
                continue;
            }

            const sourceDegree = adj.length;
            let totalWeight = 0;
            const weights: number[] = [];

            for (const neighbor of adj) {
                const targetDegree = degree.get(neighbor) ?? 1;
                const w = 1 / (sourceDegree * Math.sqrt(targetDegree));
                weights.push(w);
                totalWeight += w;
            }

            // Normalize weights and distribute
            for (let j = 0; j < adj.length; j++) {
                const share = (score * alpha * weights[j]) / totalWeight;
                next.set(adj[j], (next.get(adj[j]) ?? 0) + share);
            }
        }

        scores = next;
    }

    // Remove seed, sort by score, take topK
    scores.delete(seed);
    const sorted = [...scores.entries()]
        .filter(([, s]) => s > 0.001) // prune noise floor
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK);

    return { scores: new Map(sorted) };
}
```

#### New file: `src/graph/ppr-expansion.ts`

```typescript
import { personalizedPageRank, computePPRParams, type PPROptions } from "./personalized-pagerank";
import { normalizeSearchCandidates, type RawSearchResult } from "../ai-services/memory-search-tool";
import type { MemoryCandidate } from "../ai-services/chat-types";

export interface PPRExpansionOptions {
    cosineThreshold?: number;   // default 0.3
    decay?: number;             // default 0.4
    pprScoreThreshold?: number; // default 0.02
    maxExpansions?: number;     // max candidates to return after all filtering
    isPathAllowed?: (path: string) => boolean;
}

/**
 * Expand search candidates using Personalized PageRank on the vault link graph.
 *
 * Flow:
 * 1. Take top-3 search candidates as PPR seeds
 * 2. Run degree-penalized PPR from each seed (topK=8 per seed)
 * 3. Merge results (take max PPR score per node across seeds)
 * 4. Filter: PPR score > threshold (structural gate)
 * 5. Compute cosine similarity with query for remaining nodes
 * 6. Filter: cosine ≥ cosineThreshold (semantic gate)
 * 7. Sort by cosine (semantic determines rank)
 * 8. Compute final score: top_candidate_score × decay × normalized_cosine
 * 9. Return as MemoryCandidate[]
 */
export async function expandByPPR(
    candidates: MemoryCandidate[],
    resolvedLinks: Record<string, Record<string, number>>,
    computeCosineSimilarity: (paths: string[]) => Promise<Map<string, number>>,
    fetchChunks: (paths: string[]) => Promise<RawSearchResult[]>,
    options?: PPRExpansionOptions,
): Promise<MemoryCandidate[]> {
    const cosineThreshold = options?.cosineThreshold ?? 0.3;
    const decay = options?.decay ?? 0.4;
    const pprThreshold = options?.pprScoreThreshold ?? 0.02;
    const maxExpansions = options?.maxExpansions ?? 6;
    const isPathAllowed = options?.isPathAllowed;

    if (candidates.length === 0) return candidates;

    // Step 1: Compute adaptive PPR params + build adjacency ONCE
    const pprParams = computePPRParams(resolvedLinks);
    const adjacency = buildBidirectionalAdjacency(resolvedLinks);

    // Step 2: Run PPR from top-3 seeds (all share the same adjacency)
    const seeds = candidates.slice(0, 3);
    const existingPaths = new Set(candidates.map(c => c.path));
    const mergedScores = new Map<string, number>();

    for (const seed of seeds) {
        const { scores } = personalizedPageRank(seed.path, adjacency, pprParams);
        for (const [path, score] of scores) {
            if (existingPaths.has(path)) continue;
            if (!path.endsWith(".md")) continue;
            if (isPathAllowed && !isPathAllowed(path)) continue;
            // Take max score across seeds
            const existing = mergedScores.get(path) ?? 0;
            if (score > existing) mergedScores.set(path, score);
        }
    }

    // Step 3: PPR score gate
    const pprPassed = [...mergedScores.entries()]
        .filter(([, score]) => score >= pprThreshold);

    if (pprPassed.length === 0) return candidates;

    // Step 4: Cosine similarity gate
    const pathsToCheck = pprPassed.map(([path]) => path);
    const cosineScores = await computeCosineSimilarity(pathsToCheck);

    const cosinePassed = pprPassed
        .filter(([path]) => (cosineScores.get(path) ?? 0) >= cosineThreshold)
        .sort((a, b) => (cosineScores.get(b[0]) ?? 0) - (cosineScores.get(a[0]) ?? 0))
        .slice(0, maxExpansions);

    if (cosinePassed.length === 0) return candidates;

    // Step 5: Fetch chunks and build candidates
    const expansionPaths = cosinePassed.map(([path]) => path);
    const rawByPath = new Map<string, RawSearchResult[]>();
    try {
        const raw = await fetchChunks(expansionPaths);
        for (const result of raw ?? []) {
            const path = result.doc?.metadata?.path;
            if (typeof path !== "string") continue;
            const group = rawByPath.get(path) ?? [];
            group.push(result);
            rawByPath.set(path, group);
        }
    } catch {
        return candidates; // graceful degradation
    }

    // Step 6: Build MemoryCandidate objects with aligned scores
    const topScore = candidates[0]?.score ?? 0;
    const expanded: MemoryCandidate[] = [];

    for (const [path] of cosinePassed) {
        const docs = normalizeSearchCandidates(rawByPath.get(path) ?? [], isPathAllowed);
        if (docs.length === 0) continue;
        const cosine = cosineScores.get(path) ?? 0;
        const normalizedCosine = Math.min(1.0, cosine); // already 0-1 range

        expanded.push({
            candidateId: `ppr-${path}`,
            path,
            score: topScore * decay * normalizedCosine,
            documents: docs[0].documents,
            excerpt: docs[0].excerpt,
        });
    }

    return [...candidates, ...expanded];
}
```

#### Modified: `src/ai-services/memory-search-tool.ts`

Replace `expandByOneHop` call with conditional PPR/one-hop:

```typescript
// After normalizeSearchCandidates, before rerankCandidates:

const resolvedLinks = this.host.getResolvedLinks();
const totalEdges = resolvedLinks
    ? Object.values(resolvedLinks).reduce((sum, targets) => sum + Object.keys(targets).length, 0)
    : 0;

let expanded: MemoryCandidate[];
if (totalEdges > 20 && this.host.settings.memoryPPRExpansion !== false) {
    expanded = await expandByPPR(
        candidates,
        resolvedLinks!,
        (paths) => this.host.computeQueryCosineSimilarity(paths, queryEmbedding),
        async (paths) => {
            const results = await this.host.memorySearch.getChunksByPath(paths, {
                limitPerPath: MAX_MEMORY_CANDIDATE_CHUNKS,
                signal,
            });
            return results ?? [];
        },
        { isPathAllowed: this.host.isDataBoundaryAllowedPath },
    );
} else {
    expanded = await expandByOneHop(
        candidates,
        resolvedLinks,
        async (paths) => { /* same fetchChunks as before */ },
        this.host.isDataBoundaryAllowedPath,
    );
}
```

#### New host interface method

In `src/ai-services/AiServiceHost.ts`:

```typescript
export interface AiServiceHost {
    // ... existing ...

    /**
     * Compute cosine similarity between the query embedding and indexed chunks
     * for the given paths. Returns a map of path → max cosine score across chunks.
     * Used by PPR expansion for semantic cross-validation.
     *
     * NOTE: queryEmbedding is number[] (not Float32Array) because that's what
     * the embedding provider returns and what searchHybrid uses internally.
     */
    computeQueryCosineSimilarity?(
        paths: string[],
        queryEmbedding: number[],
    ): Promise<Map<string, number>>;
}
```

#### Surfacing `queryEmbedding` from `searchHybrid`

The query embedding is computed inside `vss-core.ts:searchHybrid` (line 1677-1688) and currently discarded after use. To make it available for PPR expansion, add a transient field on the `VSS` instance:

```typescript
// In vss-core.ts, add a transient field:
private _lastQueryEmbedding: number[] | null = null;

// Inside searchHybrid, after the parallel await (line 1692-1696):
this._lastQueryEmbedding = queryEmbedding;

// Public getter:
get lastQueryEmbedding(): number[] | null {
    return this._lastQueryEmbedding;
}
```

In the `MemorySearchPort` interface (or its implementation in `plugin.ts`), expose this:

```typescript
// In the AiServiceHost implementation (plugin.ts):
computeQueryCosineSimilarity: async (paths, queryEmbedding) => {
    // Delegate to VSS index to fetch stored embeddings for paths
    // and compute cosine similarity against queryEmbedding
    return this.vss.computeCosineSimilarityForPaths(paths, queryEmbedding);
}
```

This requires a new method on `VSS`/`SqliteVectorIndex`:

```typescript
// In vss-core.ts:
async computeCosineSimilarityForPaths(
    paths: string[],
    queryEmbedding: number[],
): Promise<Map<string, number>> {
    // Send to worker: for each path, get its chunk embeddings,
    // compute cosine with queryEmbedding, return max per path.
}
```

**Why transient field over output reference:** The `searchHybrid` call happens inside `runExclusive` (an async mutex). Restructuring the lock to return a composite value would require changing all callers. A transient field is simpler — it's set inside the lock, read after `searchHybrid` returns, and overwritten on the next call. Thread safety is guaranteed by JS single-threaded execution.

In `memory-search-tool.ts`, the flow becomes:

```typescript
// In searchVss:
const rawResults = await this.host.memorySearch.searchHybrid(query, { ... });
const queryEmbedding = this.host.memorySearch.lastQueryEmbedding; // read after search

// Later, pass to expandByPPR:
(paths) => this.host.computeQueryCosineSimilarity!(paths, queryEmbedding!)
```

#### Feature flag

```typescript
memoryPPRExpansion: boolean;  // default: true
```

When `false`, always use `expandByOneHop` (original behavior).

---

## Phase 3: Agentic Single-Retry Recovery

### Decision Record

#### Decision 3.1: Agent self-decides retry query

**Options considered:**
- A) Agent decides what to retry (using filteredCandidatePaths as clue)
- B) System algorithmically generates retry query
- C) Hybrid (system suggests, agent decides)

**Decision: A**

**Reasoning:**
- The existing agent loop already supports multiple tool calls across turns (max 20 turns, 30 tool calls, 180s wall clock). No architecture change needed.
- The agent has full context: the user's question, conversation history, the filtered paths (showing what DIDN'T work), and governed claims. It can make a more informed query rewrite than any algorithm.
- System-generated rewrites require a separate query expansion module that would duplicate logic the LLM already has.
- Implementation cost: zero new code for query generation. Phase 1's verdict signal + tool result guidance is sufficient.

#### Decision 3.2: Relax parameters on retry

**Options considered:**
- B) Relax: remove temporal filter + lower cosine threshold (0.2) + expand k (12)
- C) Only remove temporal filter (rely on agent's new query to do the rest)

**Decision: B**

**Reasoning:**
- First search failure can have three causes: (1) bad query, (2) temporal filter too strict, (3) cosine/k parameters too tight.
- Agent rewriting the query fixes cause (1). Removing temporal filter fixes (2). But only B also fixes (3).
- The cost of B over C: 3 lines of code (`isRetry` flag → adjust 3 constants). Near-zero implementation cost for non-zero additional coverage.
- The fundamental insight: since this IS a retry path (first attempt already failed), being more lenient on the second attempt is rational. If strict parameters couldn't find anything, repeating strict parameters with only a different query may fail for the same structural reasons.

#### Decision 3.3: Fixed 1 retry maximum

**Options considered:**
- Fixed 1 retry
- Dynamic (retry again if partially_relevant)

**Decision: Fixed 1**

**Reasoning:**
- After 2 searches (original + 1 retry), the agent almost always has enough context: `partially_relevant` results from both searches are injected into the prompt.
- Each additional retry adds +2-4s latency with diminishing marginal returns.
- The 3rd search's added value (~5-10% of cases) doesn't justify the doubled latency and implementation complexity of a state machine tracking retry progression.
- Simplicity: "Do not retry more than once" is a clear instruction both for the LLM and for the code.

### Design

#### Modified tool result serialization (`pa-agent-host-tools.ts`)

When serializing `search_memory` result as observation:

```typescript
function serializeToolObservation(result: ChatToolResult<unknown>): string {
    const base = {
        tool: result.tool,
        status: result.ok ? "ok" : "unavailable",
        input: result.inputSummary,
        ...(result.ok ? { observation: result.content } : { error: result.error ?? "Tool unavailable." }),
    };

    // Phase 3: Add retrieval guidance when results are poor
    if (result.tool === "search_memory" && isSearchMemoryResult(result.content)) {
        const memory = result.content;
        if (memory.rerankVerdict === "none_relevant") {
            base.observation = {
                ...base.observation,
                retrievalGuidance:
                    "No relevant notes found for this query. " +
                    "You may call search_memory once more with rephrased keywords.",
            };
        } else if (memory.rerankVerdict === "partially_relevant") {
            base.observation = {
                ...base.observation,
                retrievalGuidance:
                    "Results are tangentially related but may not fully answer the question. " +
                    "You may optionally retry with more specific keywords.",
            };
        }
    }

    return safeStringify(base);
}
```

#### Retry parameter relaxation (`memory-search-tool.ts`)

**Clarification on what parameters are relaxed and where they apply:**

| Parameter | Normal | Retry | Where it applies |
|-----------|--------|-------|------------------|
| PPR `cosineThreshold` | 0.3 | 0.2 | Only in `expandByPPR` (Phase 2). When PPR is disabled (one-hop fallback), this has no effect. |
| `searchHybrid` vector k | 8 | 12 | Passed to `MemorySearchPort.searchHybrid`. Requires extending the interface (see below). |
| `searchHybrid` fusionTopK | 12 | 18 | Proportional to k (maintains 1.5× ratio). Same interface change. |
| Temporal filter | From query rewriter | None (agent's rewritten query typically drops time words) | Natural behavior, no code change needed. |

**Required interface extension for k/fusionTopK:**

Currently `k=8` and `fusionTopK=12` are hardcoded in `vss-core.ts:1716`. To enable Phase 3 retry relaxation:

```typescript
// Extend MemorySearchPort / VSS searchHybrid options:
interface SearchHybridOptions {
    ftsQueryOverride?: string | null;
    ftsQueryOverridePromise?: Promise<string | null>;
    temporalFilter?: { since?: number; until?: number };
    temporalFilterPromise?: Promise<{ since?: number; until?: number } | null>;
    signal?: AbortSignal;
    k?: number;          // NEW: vector top-k, default 8
    fusionTopK?: number; // NEW: RRF output count, default 12
}
```

In `vss-core.ts:1716`, change from hardcoded to:
```typescript
const k = options?.k ?? 8;
const fusionTopK = options?.fusionTopK ?? 12;
const results = await this.index.searchHybrid(queryEmbedding, ftsQuery, k, fusionTopK, temporalFilter ?? undefined);
```

**The searchVss retry logic:**

```typescript
private async searchVss(
    query: string,
    signal?: AbortSignal,
    options?: { isRetry?: boolean },
): Promise<MemorySearchResult> {
    const isRetry = options?.isRetry ?? false;

    // Pass k/fusionTopK to hybrid search
    const rawResults = await this.host.memorySearch.searchHybrid(query, {
        ftsQueryOverridePromise,
        temporalFilterPromise,
        signal,
        k: isRetry ? 12 : undefined,              // undefined = use default (8)
        fusionTopK: isRetry ? 18 : undefined,      // undefined = use default (12)
    });

    // PPR expansion uses relaxed cosine threshold on retry
    const pprCosineThreshold = isRetry ? 0.2 : 0.3;

    // ... expandByPPR(..., { cosineThreshold: pprCosineThreshold, ... }) ...
    // ... rerankCandidates ...
}
```

**Note:** When PPR is disabled (totalEdges ≤ 20, fallback to one-hop), the `cosineThreshold` relaxation has no effect. The retry's value in that case comes solely from the expanded `k`/`fusionTopK` and the agent's rewritten query.

#### Retry detection and query deduplication

**Design decision:** `isRetry` must NOT trigger simply because a previous search happened. It triggers only when the PREVIOUS search returned `none_relevant` or `partially_relevant`. This prevents unrelated follow-up queries in a multi-turn session from being treated as retries.

```typescript
// In MemorySearchTool class:
private lastSearchState?: {
    query: string;
    result: MemorySearchResult;
    verdict: RerankVerdict;
};

async search(query: string, signal?: AbortSignal, onBeforeVssSearch?: () => void): Promise<MemorySearchResult> {
    // Prevent identical retry (agent sends same query twice)
    if (this.lastSearchState?.query === query) {
        return this.lastSearchState.result;
    }

    // isRetry = previous search had poor results (none or partial)
    // This ensures unrelated follow-up queries use normal parameters.
    const isRetry = this.lastSearchState != null
        && (this.lastSearchState.verdict === "none_relevant"
            || this.lastSearchState.verdict === "partially_relevant");

    // ... existing logic (ensureReadyForChat, etc.) ...

    const result = await this.searchVss(query, signal, { isRetry });

    // Update state for next call
    this.lastSearchState = {
        query,
        result,
        verdict: result.rerankVerdict ?? "relevant",
    };
    return result;
}
```

**Lifecycle:** `lastSearchState` is scoped to the `MemorySearchTool` instance. A new instance is created per chat session (verified: `MemorySearchTool` is constructed in `pa-agent-runtime.ts` during `createPaAgentRuntime()`, which is called per chat session). When a new session starts, `lastSearchState` is `undefined` → first search is never a retry.

**Why verdict-based, not existence-based:** If the user asks "what is my project deadline" (search succeeds with `relevant`), then asks "translate this to English" (model probably won't call search_memory — but if it does), it should NOT use relaxed parameters. The first search succeeded, so there's no failure to recover from.

#### System prompt update (`pa-agent-prompts.ts`)

Add to the agent system prompt (replacing Phase 4's routing logic):

```
When using search_memory:
- Use it when the user references personal notes, past records, or vault content.
- Do NOT use it for general knowledge questions, translation, rewriting, or casual chat.
- If search_memory returns no relevant results, you may retry ONCE with rephrased keywords. Do not retry more than once.
- If results are partially relevant, you may optionally retry with more specific terms, or answer with available context.
```

#### Follow-up turn policy (`pa-agent-required-capability-policy.ts`)

Extend `shouldOpenSameSourceFollowUp` or equivalent logic:

When tool result metadata contains `rerankVerdict === "none_relevant"`, allow the next turn to include `search_memory` in available tools (so the agent can retry). This is necessary because the existing policy may otherwise transition to `terminal` after seeing tool results.

#### Feature flag

```typescript
memoryRetryOnMiss: boolean;  // default: true
```

When `false`, don't add `retrievalGuidance` to tool results, and don't detect `isRetry` (always use standard parameters).

---

## Interfaces And Ownership

| Interface | Owner | Consumers |
|-----------|-------|-----------|
| `RerankVerdict` type | memory-search-tool.ts | chat-types.ts, pa-agent-host-tools.ts |
| `PPROptions`, `PPRResult` | graph/personalized-pagerank.ts | graph/ppr-expansion.ts |
| `expandByPPR` | graph/ppr-expansion.ts | memory-search-tool.ts |
| `computeQueryCosineSimilarity` | AiServiceHost (interface) → plugin.ts (impl) | ppr-expansion.ts via memory-search-tool.ts |
| `filteredCandidatePaths` field | memory-search-tool.ts | serialized to agent prompt via pa-agent-host-tools.ts |
| `isRetry` detection | memory-search-tool.ts (internal) | not exposed |

---

## Lifecycle And Cleanup

- **PPR computation**: Stateless, per-query. No cleanup needed. Garbage collected after `searchVss` returns.
- **Query dedup cache** (`lastQueryResult`): Scoped to `MemorySearchTool` instance lifetime (one per chat session). Cleared when a new chat starts.
- **Feature flags**: Stored in plugin `data.json` alongside existing settings. No migration needed (new keys with defaults).

---

## Compatibility, Migration And Rollback

| Concern | Handling |
|---------|----------|
| Old reranker model that doesn't output `verdict` | `parseVerdict` defaults to `"relevant"` — pre-Phase-1 behavior preserved |
| Mobile compatibility | All phases run identically on mobile. PPR is pure computation (no platform APIs). |
| Obsidian reload/unload | `MemorySearchTool` is stateless except `lastQueryResult` cache which is session-scoped. Safe across reloads. |
| Rollback Phase 1 | Set `memoryStrictRelevanceFilter: false` in data.json |
| Rollback Phase 2 | Set `memoryPPRExpansion: false` in data.json → falls back to one-hop |
| Rollback Phase 3 | Set `memoryRetryOnMiss: false` in data.json → no guidance, no isRetry detection |

---

## Test Matrix

| Requirement | Unit test | Integration test | Failure case |
|-------------|-----------|------------------|--------------|
| Phase 1: empty ranking returns empty candidates (bug fix) | `parseRerankResponse({"ranking":[],"verdict":"none_relevant"})` → candidates=[] | Query with no matching notes → agent receives hasAnswerableContent=false | Model outputs malformed JSON → fallback to "relevant" |
| Phase 1: verdict parsing with backward compat | `parseRerankResponse({"ranking":[0,1]})` (no verdict field) → verdict="relevant" | — | — |
| Phase 1: filteredCandidatePaths populated | — | none_relevant result contains paths | Missing paths → empty array (never undefined) |
| Phase 2: PPR on star graph | seed=center → all leaves get equal score | — | — |
| Phase 2: PPR degree penalty suppresses hub | hub node score < leaf node score from same seed | — | — |
| Phase 2: PPR adaptive params | avgDegree=2 → alpha≈0.84; avgDegree=10 → alpha=0.6 | — | Empty graph → fallback to one-hop |
| Phase 2: expandByPPR full flow | Mock resolvedLinks + mock cosine → correct candidates returned | Vault with known link structure → expansion finds 2-hop notes | fetchChunks throws → returns original candidates |
| Phase 2: cosine gate filters irrelevant | PPR finds node with cosine=0.1 → filtered out | — | — |
| Phase 2: totalEdges ≤ 20 fallback | — | Sparse vault → uses expandByOneHop | — |
| Phase 3: isRetry detection | Second call to search() → isRetry=true | — | Same query string → returns cached result |
| Phase 3: relaxed parameters on retry | isRetry=true → k=12, cosineThreshold=0.2 | First miss → retry with broader terms → hit | — |
| Phase 3: retrievalGuidance in output | none_relevant → guidance present; relevant → no guidance | Agent calls search_memory twice after none_relevant | Agent tries to call 3rd time → deduplicated |

---

## Boundary Conditions And Integration Notes

This section documents runtime behaviors that are NOT obvious from interface signatures alone. These are verified against the current source and are critical for correct Phase 2 integration.

### queryEmbedding lifecycle in searchHybrid

In `vss-core.ts:1677-1696`, `searchHybrid` computes the query embedding internally:

```typescript
const queryEmbeddingPromise = (async () => {
    const embeddings = await this.aiUtils.createEmbeddings(profile.dimensions);
    return embeddings.embedQuery(prompt);
})();

const [ftsOverride, temporalFilter, queryEmbedding] = await Promise.all([
    safeOverridePromise,
    safeTemporalPromise,
    queryEmbeddingPromise,
]);
```

The `queryEmbedding` is a `number[]` (not `Float32Array`). It is consumed by `this.index.searchHybrid(queryEmbedding, ...)` and then discarded — it is NOT returned to the caller.

**Implication for Phase 2:** To enable `computeQueryCosineSimilarity`, the `queryEmbedding` must be captured and returned or exposed. Options:
1. **Recommended**: Modify `searchHybrid` to accept an optional output reference (`queryEmbeddingOut?: { value?: number[] }`) that receives the computed embedding as a side effect. This avoids changing the return type.
2. Alternative: Return `{ results, queryEmbedding }` from a new overload. This changes the interface more broadly.
3. Alternative: Re-embed the query in `expandByPPR`. **Do NOT do this** — it wastes an API call and adds latency.

### getChunksByPath edge cases

In `vss-core.ts:1724-1768`:
- Empty paths array → returns `[]` immediately (line 1728)
- Path that doesn't exist in the index → silently excluded from results (no error)
- `this.disposed` or status not "ready" → returns `[]`
- Results are `normalizeSearchResult`-wrapped — same shape as `searchHybrid` output

**Implication:** `expandByPPR`'s `fetchChunks` callback can safely pass any path set. Non-indexed paths are simply absent from the result map. No error handling needed beyond catching unexpected throws.

### resolvedLinks availability and structure

`app.metadataCache.resolvedLinks` (`Record<string, Record<string, number>>`) is:
- Available immediately after Obsidian layout-ready event (plugin `onLayoutReady`)
- Updated synchronously by Obsidian on file create/rename/delete/link-change
- May be `undefined` if accessed before vault is loaded (defensive check required)
- The number value is the link count (how many times the source links to the target in that file)
- Only includes `.md` files as sources; targets may include non-md (attachments) — filter to `.md` targets

**Implication:** The `totalEdges > 20` check and PPR computation should guard against `resolvedLinks` being undefined/empty (early return to one-hop fallback).

### SqliteVectorIndex.searchHybrid parameters

From `sqlite-vector-index.ts:106`:
```typescript
searchHybrid(
    queryEmbedding: number[],
    ftsQuery: string | null,
    k: number,          // vector top-k
    fusionTopK: number, // RRF fusion output count
    temporalFilter?: { since?: number; until?: number },
): Promise<VectorSearchResult[]>
```

The `k` parameter in `memory-search-tool.ts` (`MAX_MEMORY_DOCUMENTS = 8`) is passed as the vector-leg top-k AND determines `fusionTopK` (currently hardcoded as 12). For Phase 3 retry (`isRetry=true, k=12`), also update `fusionTopK` proportionally (e.g., 18) to maintain the same ratio.

---

## Golden Test Cases For Verdict Validation

These test cases should be used to validate that the reranker prompt produces stable, correct verdicts across different policy models. Each case specifies the expected verdict given a query and candidate set.

### none_relevant cases

| # | Query | Candidates (path + excerpt snippet) | Expected |
|---|-------|-------------------------------------|----------|
| G1 | "今天天气怎么样" | `daily/2026-01-05.md`: "今天完成了天气 API 的集成测试..." | none_relevant |
| G2 | "帮我翻译这段话成英文" | `projects/translation-tool.md`: "翻译工具架构设计..." | none_relevant |
| G3 | "HTTP 状态码 404 是什么意思" | `learning/http-basics.md`: "HTTP 协议的基本概念，包含常见方法 GET POST..." (no mention of status codes) | none_relevant |

### partially_relevant cases

| # | Query | Candidates (path + excerpt snippet) | Expected |
|---|-------|-------------------------------------|----------|
| G4 | "我之前写的分布式共识算法笔记" | `learning/microservices.md`: "微服务架构中的服务发现和负载均衡..." | partially_relevant |
| G5 | "React 状态管理的最佳实践" | `learning/vue-state.md`: "Vue 3 中的状态管理，Pinia vs Vuex..." | partially_relevant |
| G6 | "总结我关于创业的思考" | `projects/side-project.md`: "副项目收入记录：本月 ARR $200..." | partially_relevant |

### relevant cases

| # | Query | Candidates (path + excerpt snippet) | Expected |
|---|-------|-------------------------------------|----------|
| G7 | "我之前写的 React Hooks 笔记" | `learning/react-hooks.md`: "useState 和 useEffect 的深入理解..." | relevant |
| G8 | "那个项目的 deadline 是什么时候" | `projects/q3-plan.md`: "Q3 项目计划：deadline 2026-09-30..." | relevant |
| G9 | "我关于 Raft 算法的理解" | `learning/raft-impl.md`: "Raft 共识算法的 Go 实现笔记，Leader Election..." | relevant |

### Edge cases

| # | Query | Candidates (path + excerpt snippet) | Expected | Reason |
|---|-------|-------------------------------------|----------|--------|
| G10 | "数据库迁移方案" | `projects/db-performance.md`: "数据库性能调优：索引优化、查询计划分析..." | none_relevant | keyword overlap (数据库) but completely different topic |
| G11 | "数据库迁移方案" | `projects/db-migration.md`: "PostgreSQL 14 → 16 迁移步骤..." | relevant | direct match |
| G12 | "学习进度总结" | `daily/2026-07-01.md`: "今天看了 2 小时 Rust 教程" + `daily/2026-07-05.md`: "继续 Rust 练习" | partially_relevant | related to learning but these are fragments, not a summary — user likely has more notes |

---

## Challenge Questions For Reviewer

This section lists questions that the implementor (Codex) should evaluate during implementation. If any question reveals a flaw in the design, escalate to the design authority before proceeding.

### Phase 1 Challenges

**Q1: Verdict stability across policy models.**
The verdict prompt assumes the policy model (e.g., `gpt-4o-mini`, `qwen-turbo`, `claude-haiku`) can reliably output structured JSON with a `verdict` field. Test this with the actual configured `policyModelName` before shipping. If the model frequently omits the field or outputs invalid values, the fallback (`"relevant"`) means Phase 1 degrades gracefully — but if it happens >30% of the time, the feature is effectively disabled.

**Validation step:** Run the 12 golden test cases (G1-G12) through the actual policy model. If verdict accuracy is <80% (≥10/12 correct), reconsider the prompt or require a stronger model.

### Phase 2 Challenges

**Q2: Is degree-penalized PPR actually better than simple 2-hop BFS in sparse graphs?**
In a graph where every note has 2-3 links, PPR's power iteration over 12 rounds may produce nearly identical results to a simple 2-hop BFS with 1/degree decay. The degree penalty and iterative convergence add algorithmic complexity. The justification for PPR over BFS is:
- PPR handles cycles correctly (BFS would double-count)
- PPR scores decay smoothly with structural distance (BFS has discrete hop boundaries)
- PPR with teleport is theoretically optimal for "structural proximity" (proven in literature)

**Validation step:** After implementing PPR, also implement a naive 2-hop BFS for comparison. On 5 test graphs, compare the top-8 results. If they differ by <10%, the PPR complexity may not be justified — but this does NOT mean switching to BFS (the decision is final), only that the theoretical advantage is small in this regime.

**Q3: Can `computeQueryCosineSimilarity` be implemented without modifying `searchHybrid`'s signature?**
The SDD recommends an output reference pattern (`queryEmbeddingOut`). If this proves architecturally awkward (e.g., the embedding is consumed inside `runExclusive` and returning it would require restructuring the lock), an alternative is acceptable: store the last query embedding on the `VSS` instance as a transient field (cleared on next search). This is safe because searches are serialized through `runExclusive`.

**Validation step:** Attempt the recommended approach first. If it requires >50 lines of plumbing, fall back to the transient-field approach and document why.

**Q4: What if `resolvedLinks` changes mid-PPR computation?**
`resolvedLinks` is a live reference to Obsidian's metadata cache. In theory, a vault event could modify it during PPR iteration. In practice:
- PPR computation takes <50ms
- Obsidian's metadata updates are batched and run on the main thread
- The PPR iteration is synchronous (no awaits between iterations)

Therefore: **race condition is not possible** in practice (JS single-threaded execution model). No defensive copy needed.

### Phase 3 Challenges

**Q5: Does the `lastQueryResult` cache introduce stale results?**
The cache is session-scoped (cleared on new chat). Within a session, if the vault changes between the first and second search (e.g., user creates a new note), the cached result for the first query would be stale. However, the dedup cache only triggers on **identical query strings** — and the retry is specifically about using a DIFFERENT query. The only scenario where identical queries happen is when the agent ignores the "rephrase" instruction and retries verbatim — in which case returning the cached (stale) result is correct behavior (prevents wasting resources on a guaranteed duplicate).

**Validation step:** Verify that `lastQueryResult` is only checked for exact string match, and that a new chat session (new `MemorySearchTool` instance) starts with an empty cache.

**Q6: Could the `retrievalGuidance` text confuse the agent in non-English conversations?**
The guidance is in English while the user may be chatting in Chinese. The agent model should handle mixed-language system instructions, but verify that the guidance doesn't leak into the user-facing response.

**Validation step:** In the integration test, confirm that the agent's final response does NOT contain fragments of the guidance text.

---

## Open Design Findings

None. All decisions are finalized per discussion record above.

---

## Constraints For Implementation (Codex)

1. **Do NOT change the algorithm choice.** PPR is the decided approach. Do not substitute with Louvain, Leiden, community detection, or any global pre-computation approach.
2. **Do NOT add user-visible settings.** All feature flags are internal (not rendered in the settings UI).
3. **Do NOT add mobile-specific degradation.** All phases run identically on all platforms.
4. **Do NOT exceed 1 retry.** The retry mechanism is fixed at 1. Do not implement dynamic retry counts.
5. **Do NOT modify `expandByOneHop`** (except to make it conditional). It remains as fallback code.
6. **Preserve existing test contracts.** All tests in `__tests__/` that reference memory search must continue to pass.
7. **The PPR computation must be synchronous/blocking within the search flow** (not deferred to a worker). At <50ms it doesn't justify worker overhead.
8. **The `computeQueryCosineSimilarity` method must reuse the query embedding already computed by `searchHybrid`** — do not re-embed the query.

---

## Approval

- Design authority: edonyzpc
- Approved on: 2026-08-07
- Authorized implementation scope: Phase 1, Phase 2, Phase 3 as specified above
