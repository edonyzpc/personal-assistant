import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from "@langchain/core/prompts";

import { rewriteQueryForSearch, REWRITE_SYSTEM_PROMPT, REWRITE_TIMEOUT_MS, type QueryTemporalIntent, type RewrittenQuery } from "./query-rewriter";
import { clearPlatformTimeout, setPlatformTimeout } from "../platform-dom";
import type { AIUtils } from "./ai-utils";
import type { AiServiceHost } from "./AiServiceHost";
import { createAbortError, throwIfAborted } from "./chat-utils";
import type { MemoryCandidate, MemoryCandidateAnchor, MemorySearchDocument, MemorySearchResult } from "./chat-types";

export interface RawSearchResult {
    score?: unknown;
    doc?: {
        pageContent?: unknown;
        metadata?: Record<string, unknown>;
    };
}

const MAX_MEMORY_DOCUMENTS = 8;
const MAX_MEMORY_CHARS = 4000;
const MAX_MEMORY_RERANK_CANDIDATES = 12;
const MAX_MEMORY_CANDIDATE_CHUNKS = 3;
const MAX_MEMORY_CANDIDATE_EXCERPT_CHARS = 1000;
const MIN_MEMORY_SCORE = 0.01;

const RERANK_TIMEOUT_MS = 30_000;

const RERANK_SYSTEM_PROMPT = [
    "You are a strict relevance filter for a personal knowledge base.",
    "Task: Decide which candidates ACTUALLY help answer the query. Be conservative.",
    "Rules:",
    "- Include a candidate ONLY if its content directly addresses the query topic",
    "- Omit candidates that merely share superficial keywords or are topically unrelated",
    "- If NO candidates are relevant, return empty: {\"ranking\":[]}",
    "- Order included candidates by relevance (most relevant first)",
    'Return ONLY valid JSON: {"ranking":[...]} with 0-based candidate indices.',
].join("\n");

export class MemorySearchTool {
    private readonly host: AiServiceHost;
    private readonly aiUtils: AIUtils;

    constructor(host: AiServiceHost, aiUtils: AIUtils) {
        this.host = host;
        this.aiUtils = aiUtils;
    }

    async search(query: string, signal?: AbortSignal, onBeforeVssSearch?: () => void): Promise<MemorySearchResult> {
        throwIfAborted(signal);
        const decision = await this.host.memorySearch.ensureReadyForChat(query);
        throwIfAborted(signal);

        if (decision.decision === "cancel") {
            throw createAbortError();
        }

        if (decision.decision === "answer-now") {
            return {
                usedMemory: false,
                query,
                documents: [],
                sources: [],
                skipReason: decision.message ?? "Memory was not used for this answer.",
                hasAnswerableContent: false,
                needsSnippetFollowup: false,
            };
        }

        onBeforeVssSearch?.();
        return this.searchVss(query, signal);
    }

    private async searchVss(query: string, signal?: AbortSignal): Promise<MemorySearchResult> {
        throwIfAborted(signal);

        const policyModelName = this.host.settings.policyModelName.trim();

        // Truly parallel: rewrite (if enabled) runs concurrently with embed inside searchHybrid.
        // If rewrite fails or times out, the override resolves null and searchHybrid falls back
        // to building the FTS query from the raw prompt — preserving prior error-isolation.
        const rewriteResultPromise: Promise<RewrittenQuery> = policyModelName
            ? this.rewriteQueryWithTimeout(query, policyModelName, signal)
            : Promise.resolve({ keywords: null, temporal: "none" });
        const ftsQueryOverridePromise = rewriteResultPromise.then((result) => result.keywords);
        const temporalFilterPromise = rewriteResultPromise.then((result) => temporalIntentToFilter(result.temporal));

        const rawResults = await this.host.memorySearch.searchHybrid(query, {
            ftsQueryOverridePromise,
            temporalFilterPromise,
            signal,
        }) as RawSearchResult[];

        throwIfAborted(signal);
        const candidates = normalizeSearchCandidates(rawResults);
        const expanded = await expandByOneHop(
            candidates,
            this.host.getResolvedLinks(),
            async (paths: string[]) => {
                const results = await this.host.memorySearch.getChunksByPath(paths, {
                    limitPerPath: MAX_MEMORY_CANDIDATE_CHUNKS,
                    signal,
                }) as RawSearchResult[] | undefined;
                return results ?? [];
            },
        );

        // Serial: rerank after candidates are ready
        const rankedCandidates = policyModelName
            ? await this.rerankCandidates(query, expanded, policyModelName, signal)
            : expanded;

        const documents = flattenCandidateDocuments(rankedCandidates).slice(0, MAX_MEMORY_DOCUMENTS);
        const hasAnswerableContent = documents.length > 0;
        return {
            usedMemory: hasAnswerableContent,
            query,
            documents,
            sources: documents.map((entry) => entry.source),
            candidates: rankedCandidates,
            hasAnswerableContent,
            needsSnippetFollowup: !hasAnswerableContent && rankedCandidates.length > 0,
        };
    }

    private async rewriteQueryWithTimeout(
        query: string,
        policyModelName: string,
        signal?: AbortSignal,
    ): Promise<RewrittenQuery> {
        const controller = new AbortController();
        const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        const timeoutId = setPlatformTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS);

        try {
            const llm = await this.aiUtils.createChatModel(0, {
                transport: "native",
                modelName: policyModelName,
            });
            const invoker = async (q: string, s?: AbortSignal) => {
                const escapedSystemPrompt = REWRITE_SYSTEM_PROMPT.replace(/\{/g, "{{").replace(/\}/g, "}}");
                const prompt = ChatPromptTemplate.fromMessages([
                    SystemMessagePromptTemplate.fromTemplate(escapedSystemPrompt),
                    HumanMessagePromptTemplate.fromTemplate("{query}"),
                ]);
                const response = await prompt.pipe(llm).invoke({ query: q }, { signal: s });
                return typeof response.content === "string" ? response.content : "";
            };
            return await rewriteQueryForSearch(query, invoker, combinedSignal);
        } catch {
            return { keywords: null, temporal: "none" };
        } finally {
            clearPlatformTimeout(timeoutId);
        }
    }

    private async rerankCandidates(
        query: string,
        candidates: MemoryCandidate[],
        policyModelName: string,
        signal?: AbortSignal,
    ): Promise<MemoryCandidate[]> {
        if (candidates.length <= 1) return candidates;

        const controller = new AbortController();
        const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        const timeoutId = setPlatformTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

        try {
            const llm = await this.aiUtils.createChatModel(0, {
                transport: "native",
                modelName: policyModelName,
            });
            const candidateList = candidates
                .map((c, i) => {
                    const heading = c.anchor?.headingPath?.length ? ` (${c.anchor.headingPath.join(" > ")})` : "";
                    return `[${i}] ${c.path}${heading}: ${c.excerpt.slice(0, 1000)}`;
                })
                .join("\n");
            const escapedRerankPrompt = RERANK_SYSTEM_PROMPT.replace(/\{/g, "{{").replace(/\}/g, "}}");
            const prompt = ChatPromptTemplate.fromMessages([
                SystemMessagePromptTemplate.fromTemplate(escapedRerankPrompt),
                HumanMessagePromptTemplate.fromTemplate("Query: {query}\n\nCandidates:\n{candidates}"),
            ]);
            const response = await prompt.pipe(llm).invoke(
                { query, candidates: candidateList },
                { signal: combinedSignal },
            );
            const content = typeof response.content === "string" ? response.content : "";
            return parseRerankResponse(content, candidates);
        } catch {
            return candidates;
        } finally {
            clearPlatformTimeout(timeoutId);
        }
    }
}

function temporalIntentToFilter(intent: QueryTemporalIntent): { since?: number; until?: number } | null {
    const now = Date.now();
    if (intent === "recent_7d") return { since: now - 7 * 24 * 60 * 60 * 1000 };
    if (intent === "recent_30d") return { since: now - 30 * 24 * 60 * 60 * 1000 };
    if (typeof intent === "string" && intent.startsWith("range:")) {
        const match = intent.slice(6).match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
        if (match) {
            const since = Date.parse(match[1]);
            const until = Date.parse(match[2]) + 86400000;
            if (!isNaN(since) && !isNaN(until)) return { since, until };
        }
    }
    return null;
}

export function parseRerankResponse(content: string, candidates: MemoryCandidate[]): MemoryCandidate[] {
    const trimmed = content.trim();
    const jsonMatch = trimmed.match(/\{[^}]*"ranking"\s*:\s*\[([^\]]*)\][^}]*\}/);
    const arrayStr = jsonMatch?.[1];
    if (!arrayStr) return candidates;

    const indices = arrayStr.split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 0 && n < candidates.length);

    if (indices.length === 0) return candidates;

    const seen = new Set<number>();
    const result: MemoryCandidate[] = [];
    for (const idx of indices) {
        if (!seen.has(idx)) {
            seen.add(idx);
            result.push(candidates[idx]);
        }
    }
    return result;
}

export function normalizeSearchCandidates(results: RawSearchResult[]): MemoryCandidate[] {
    const documents = results.slice(0, 8).map((result): MemorySearchDocument | null => {
        const metadata = result.doc?.metadata ?? {};
        const path = typeof metadata.path === "string" ? metadata.path : "";
        if (!path) {
            return null;
        }
        const chunkIndex = typeof metadata.chunkIndex === "number"
            ? metadata.chunkIndex
            : Number.isFinite(Number(metadata.chunkIndex))
                ? Number(metadata.chunkIndex)
                : undefined;
        return {
            content: truncate(stringifyModelContent(result.doc?.pageContent), MAX_MEMORY_CHARS),
            score: typeof result.score === "number" ? result.score : Number(result.score ?? 0),
            source: {
                path,
                chunkIndex,
                score: typeof result.score === "number" ? result.score : Number(result.score ?? 0),
            },
            anchorMetadata: {
                contentHash: typeof metadata.contentHash === "string" ? metadata.contentHash : undefined,
                startLine: typeof metadata.startLine === "number" ? metadata.startLine : undefined,
                endLine: typeof metadata.endLine === "number" ? metadata.endLine : undefined,
                headingPath: Array.isArray(metadata.headingPath)
                    ? metadata.headingPath.filter((entry): entry is string => typeof entry === "string")
                    : undefined,
                indexVersion: typeof metadata.indexVersion === "string" ? metadata.indexVersion : undefined,
            },
        };
    }).filter((entry): entry is MemorySearchDocument => entry !== null)
      .filter(entry => entry.score >= MIN_MEMORY_SCORE);

    return createMemoryCandidatesFromDocuments(documents);
}

function createMemoryCandidatesFromDocuments(documents: MemorySearchDocument[]): MemoryCandidate[] {
    const groups = new Map<string, MemorySearchDocument[]>();
    for (const memoryDocument of dedupeDocuments(documents)) {
        const group = groups.get(memoryDocument.source.path) ?? [];
        if (group.length >= MAX_MEMORY_CANDIDATE_CHUNKS) continue;
        group.push(memoryDocument);
        groups.set(memoryDocument.source.path, group);
    }

    return [...groups.entries()]
        .map(([path, group], index) => {
            const score = Math.max(...group.map((memoryDocument) => memoryDocument.score));
            const candidateId = `memory-${index + 1}`;
            const excerpt = truncate(group.map((memoryDocument) => memoryDocument.content).join("\n---\n"), MAX_MEMORY_CANDIDATE_EXCERPT_CHARS);
            const first = group[0];
            const anchor = first ? createMemoryCandidateAnchor(candidateId, first, excerpt) : undefined;
            return {
                candidateId,
                path,
                score,
                documents: group,
                excerpt,
                anchor,
            };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_MEMORY_RERANK_CANDIDATES);
}

function createMemoryCandidateAnchor(
    candidateId: string,
    memoryDocument: MemorySearchDocument,
    indexedSnippet: string,
): MemoryCandidateAnchor {
    return {
        candidateId,
        path: memoryDocument.source.path,
        chunkIndex: memoryDocument.source.chunkIndex,
        score: memoryDocument.score,
        indexedSnippet,
        indexedContentHash: memoryDocument.anchorMetadata?.contentHash,
        startLine: memoryDocument.anchorMetadata?.startLine,
        endLine: memoryDocument.anchorMetadata?.endLine,
        headingPath: memoryDocument.anchorMetadata?.headingPath,
        indexVersion: memoryDocument.anchorMetadata?.indexVersion,
    };
}

function flattenCandidateDocuments(candidates: MemoryCandidate[]): MemorySearchDocument[] {
    return dedupeDocuments(candidates.flatMap((candidate) => candidate.documents));
}

function dedupeDocuments(documents: MemorySearchDocument[]): MemorySearchDocument[] {
    const seen = new Set<string>();
    const deduped: MemorySearchDocument[] = [];
    for (const memoryDocument of documents) {
        const key = `${memoryDocument.source.path}#${memoryDocument.source.chunkIndex ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(memoryDocument);
    }
    return deduped;
}

export async function expandByOneHop(
    candidates: MemoryCandidate[],
    resolvedLinks: Record<string, Record<string, number>> | undefined,
    fetchChunks?: (paths: string[]) => Promise<RawSearchResult[]>,
): Promise<MemoryCandidate[]> {
    if (!resolvedLinks || candidates.length === 0) return candidates;
    const existingPaths = new Set(candidates.map((c) => c.path));
    const expansionTargets: Array<{ parentId: string; parentScore: number; targetPath: string; index: number; kind: "link" | "backlink" }> = [];
    const topCandidates = candidates.slice(0, 3);

    for (const parent of topCandidates) {
        const outbound = resolvedLinks[parent.path];
        if (outbound) {
            let added = 0;
            for (const targetPath of Object.keys(outbound)) {
                if (added >= 2) break;
                if (!targetPath.endsWith(".md")) continue;
                if (existingPaths.has(targetPath)) continue;
                existingPaths.add(targetPath);
                expansionTargets.push({
                    parentId: parent.candidateId,
                    parentScore: parent.score,
                    targetPath,
                    index: added,
                    kind: "link",
                });
                added++;
            }
        }

        let inboundAdded = 0;
        for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
            if (inboundAdded >= 2) break;
            if (!targets || !(parent.path in targets)) continue;
            if (!sourcePath.endsWith(".md")) continue;
            if (existingPaths.has(sourcePath)) continue;
            existingPaths.add(sourcePath);
            expansionTargets.push({
                parentId: parent.candidateId,
                parentScore: parent.score,
                targetPath: sourcePath,
                index: inboundAdded,
                kind: "backlink",
            });
            inboundAdded++;
        }
    }
    if (expansionTargets.length === 0) return candidates;

    const rawByPath = new Map<string, RawSearchResult[]>();
    if (fetchChunks) {
        try {
            const targetPaths = expansionTargets.map((target) => target.targetPath);
            const targetPathSet = new Set(targetPaths);
            const raw = await fetchChunks(targetPaths);
            for (const result of raw ?? []) {
                const path = result.doc?.metadata?.path;
                if (typeof path !== "string" || !targetPathSet.has(path)) continue;
                const group = rawByPath.get(path) ?? [];
                group.push(result);
                rawByPath.set(path, group);
            }
        } catch { /* skip one-hop expansion when exact lookup is unavailable */ }
    }

    const expanded: MemoryCandidate[] = [];
    for (const target of expansionTargets) {
        const docs = normalizeSearchCandidates(rawByPath.get(target.targetPath) ?? []);
        if (docs.length === 0) continue;

        const decay = target.kind === "backlink" ? 0.4 : 0.5;
        expanded.push({
            candidateId: `${target.kind}-${target.parentId}-${target.index}`,
            path: target.targetPath,
            score: target.parentScore * decay,
            documents: docs[0].documents,
            excerpt: docs[0].excerpt,
        });
    }
    return [...candidates, ...expanded];
}
type ModelContentPart = string | Record<string, unknown>;

function stringifyModelContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map(stringifyModelContentPart).filter(Boolean).join("");
    }
    if (content == null) return "";
    return String(content);
}

function stringifyModelContentPart(part: ModelContentPart): string {
    if (typeof part === "string") return part;
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    if (typeof part.type === "string" && typeof part.value === "string") return part.value;
    return "";
}

function truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
