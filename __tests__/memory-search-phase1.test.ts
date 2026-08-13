import { describe, expect, it, jest } from "@jest/globals";
import { RunnableLambda } from "@langchain/core/runnables";
import { Platform } from "obsidian";

jest.mock("obsidian");

import {
    createStandardMemorySearchInvocation,
    MemorySearchTool,
    materializeCandidateFromLatestSource,
    type MemorySearchTemporalFilterCapture,
} from "../src/ai-services/memory-search-tool";
import type {
    MemoryCandidate,
    MemorySearchDocument,
    MemoryTemporalProjectionAudit,
} from "../src/ai-services/chat-types";
import type { LatestMemorySourceMaterial } from "../src/ai-services/AiServiceHost";
import type { QueryTemporalIntent } from "../src/ai-services/query-rewriter";
import type { RetrievalDiagnosticEventInput } from "../src/ai-services/retrieval-diagnostics";
import { createHeadingAwareMarkdownChunks } from "../src/vss/markdown-chunker";

const materializer = {
    cleanMarkdown: (markdown: string) => markdown,
    hashContent: async (content: string) => `hash:${content}`,
};

async function makeAnchoredCandidate(
    path: string,
    markdown: string,
    origin: "direct" | "graph" = "direct",
): Promise<MemoryCandidate> {
    const contentHash = await materializer.hashContent(markdown);
    const chunks = createHeadingAwareMarkdownChunks({
        path,
        markdown,
        contentHash,
        created: 10,
        lastModified: 10,
    });
    const documents: MemorySearchDocument[] = chunks.slice(0, 3).map((chunk) => ({
        content: chunk.content,
        score: 0.9,
        source: { path, chunkIndex: chunk.chunkIndex, score: 0.9 },
        anchorMetadata: {
            contentHash,
            startLine: chunk.metadata.startLine as number,
            endLine: chunk.metadata.endLine as number,
            headingPath: chunk.metadata.headingPath as string[],
            indexVersion: "heading-aware-v2",
        },
    }));
    const excerpt = documents.map((document) => document.content).join("\n---\n");
    const first = documents[0];
    return {
        candidateId: `candidate:${path}`,
        path,
        score: 0.9,
        documents,
        excerpt,
        origin,
        anchor: {
            candidateId: `candidate:${path}`,
            path,
            chunkIndex: first.source.chunkIndex,
            score: first.score,
            indexedSnippet: excerpt,
            indexedContentHash: first.anchorMetadata?.contentHash,
            startLine: first.anchorMetadata?.startLine,
            endLine: first.anchorMetadata?.endLine,
            headingPath: first.anchorMetadata?.headingPath,
            indexVersion: first.anchorMetadata?.indexVersion,
        },
    };
}

function latestSource(path: string, markdown: string, mtime = 10): LatestMemorySourceMaterial {
    return { path, markdown, mtime, size: markdown.length };
}

describe("Phase 1 latest Memory source materialization", () => {
    it("rebuilds provider excerpts and records a current source snapshot", async () => {
        const markdown = "# Launch\n\nPhase two starts Monday.";
        const candidate = await makeAnchoredCandidate("notes/launch.md", markdown);

        const current = await materializeCandidateFromLatestSource(
            candidate,
            latestSource(candidate.path, markdown),
            materializer,
        );

        expect(current).toMatchObject({
            path: "notes/launch.md",
            excerpt: expect.stringContaining("Phase two starts Monday"),
            sourceSnapshot: {
                epoch: `10:${markdown.length}`,
                bodyHash: `hash:${markdown}`,
            },
        });
        expect(current?.documents[0]?.source.path).toBe("notes/launch.md");
    });

    it("fails closed on body/hash mutation or an incomplete anchor", async () => {
        const markdown = "# Launch\n\nPhase two starts Monday.";
        const candidate = await makeAnchoredCandidate("notes/launch.md", markdown);
        const changed = await materializeCandidateFromLatestSource(
            candidate,
            latestSource(candidate.path, "# Launch\n\nPhase two starts Tuesday."),
            materializer,
        );
        const missingAnchor = await materializeCandidateFromLatestSource(
            { ...candidate, anchor: undefined },
            latestSource(candidate.path, markdown),
            materializer,
        );

        expect(changed).toBeNull();
        expect(missingAnchor).toBeNull();
    });

    it("drops a candidate when its frozen source epoch changes before final projection", async () => {
        const markdown = "# Launch\n\nPhase two starts Monday.";
        const candidate = await makeAnchoredCandidate("notes/launch.md", markdown);
        const first = await materializeCandidateFromLatestSource(
            candidate,
            latestSource(candidate.path, markdown),
            materializer,
        );
        expect(first).not.toBeNull();

        const same = await materializeCandidateFromLatestSource(
            first!,
            latestSource(candidate.path, markdown),
            materializer,
            true,
        );
        const touched = await materializeCandidateFromLatestSource(
            first!,
            latestSource(candidate.path, markdown, 11),
            materializer,
            true,
        );

        expect(same).not.toBeNull();
        expect(touched).toBeNull();
    });
});

describe("Phase 1 reranker invocation", () => {
    it("rejects a non-empty ledger when its sealed generation is missing", async () => {
        const candidate = await makeAnchoredCandidate("notes/one.md", "# One\n\nUseful evidence.");
        const tool = new MemorySearchTool({} as never, {
            hashContent: materializer.hashContent,
        } as never);

        const result = await (tool as unknown as {
            buildRejectedEvidence(
                candidates: MemoryCandidate[],
                sealed: {
                    candidates: MemoryCandidate[];
                    sourceEpoch: string;
                    boundaryEpoch: string;
                    generations: ReadonlyMap<string, string>;
                },
            ): Promise<unknown>;
        }).buildRejectedEvidence([candidate], {
            candidates: [candidate],
            sourceEpoch: "source-epoch-1",
            boundaryEpoch: "boundary-epoch-1",
            generations: new Map(),
        });

        expect(result).toEqual({ ok: false });
    });

    it("reranks even one candidate with the selected Chat model", async () => {
        const candidate = await makeAnchoredCandidate("notes/one.md", "# One\n\nUseful evidence.");
        const invoke = jest.fn(async () => ({
            content: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
        }));
        const llm = RunnableLambda.from(invoke);
        const createChatModel = jest.fn(async (
            _temperature: number,
            _options: { modelName: string },
        ) => llm);
        const tool = new MemorySearchTool({} as never, { createChatModel } as never);

        const outcome = await (tool as unknown as {
            rerankCandidates(
                query: string,
                candidates: MemoryCandidate[],
                selectedModel: { kind: "chat"; modelName: string },
            ): Promise<unknown>;
        }).rerankCandidates("one", [candidate], { kind: "chat", modelName: "chat-model" });

        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(createChatModel).toHaveBeenCalledWith(0, expect.objectContaining({ modelName: "chat-model" }));
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(outcome).toMatchObject({ kind: "valid", verdict: "relevant", candidates: [candidate] });
    });

    it("fails open when the selected policy model is unavailable and never tries Chat", async () => {
        const candidate = await makeAnchoredCandidate("notes/one.md", "# One\n\nUseful evidence.");
        const createChatModel = jest.fn(async (
            _temperature: number,
            _options: { modelName: string },
        ) => {
            throw new Error("policy unavailable");
        });
        const tool = new MemorySearchTool({} as never, { createChatModel } as never);

        const outcome = await (tool as unknown as {
            rerankCandidates(
                query: string,
                candidates: MemoryCandidate[],
                selectedModel: { kind: "policy"; modelName: string },
            ): Promise<unknown>;
        }).rerankCandidates("one", [candidate], { kind: "policy", modelName: "policy-model" });

        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(createChatModel).toHaveBeenCalledWith(0, expect.objectContaining({ modelName: "policy-model" }));
        expect(outcome).toMatchObject({
            kind: "fail_open",
            reason: "model_unavailable",
            candidates: [candidate],
        });
    });

    it("propagates parent abort while selected-model construction ignores cancellation", async () => {
        const candidate = await makeAnchoredCandidate("notes/one.md", "# One\n\nUseful evidence.");
        let markConstructionStarted!: () => void;
        const constructionStarted = new Promise<void>((resolve) => {
            markConstructionStarted = resolve;
        });
        const createChatModel = jest.fn((
            _temperature: number,
            _options: { modelName: string },
        ) => {
            markConstructionStarted();
            return new Promise<never>(() => undefined);
        });
        const tool = new MemorySearchTool({} as never, { createChatModel } as never);
        const parent = new AbortController();

        const pending = (tool as unknown as {
            rerankCandidates(
                query: string,
                candidates: MemoryCandidate[],
                selectedModel: { kind: "policy"; modelName: string },
                signal: AbortSignal,
                absoluteDeadlineMs: number,
            ): Promise<unknown>;
        }).rerankCandidates(
            "one",
            [candidate],
            { kind: "policy", modelName: "policy-model" },
            parent.signal,
            Date.now() + 10_000,
        );

        await constructionStarted;
        parent.abort();

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(createChatModel).toHaveBeenCalledWith(0, expect.objectContaining({
            modelName: "policy-model",
        }));
    });

    it("propagates parent abort while the selected reranker invocation ignores its signal", async () => {
        const candidate = await makeAnchoredCandidate("notes/one.md", "# One\n\nUseful evidence.");
        let markInvocationStarted!: () => void;
        const invocationStarted = new Promise<void>((resolve) => {
            markInvocationStarted = resolve;
        });
        const invoke = jest.fn(async () => {
            markInvocationStarted();
            return new Promise<never>(() => undefined);
        });
        const createChatModel = jest.fn(async () => RunnableLambda.from(invoke));
        const tool = new MemorySearchTool({} as never, { createChatModel } as never);
        const parent = new AbortController();

        const pending = (tool as unknown as {
            rerankCandidates(
                query: string,
                candidates: MemoryCandidate[],
                selectedModel: { kind: "chat"; modelName: string },
                signal: AbortSignal,
                absoluteDeadlineMs: number,
            ): Promise<unknown>;
        }).rerankCandidates(
            "one",
            [candidate],
            { kind: "chat", modelName: "chat-model" },
            parent.signal,
            Date.now() + 10_000,
        );

        await invocationStarted;
        parent.abort();

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it("fails open before the invocation deadline when selected-model construction stalls", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(10_000);
        try {
            const candidate = await makeAnchoredCandidate("notes/one.md", "# One\n\nUseful evidence.");
            const createChatModel = jest.fn((
                _temperature: number,
                _options: { modelName: string },
            ) => new Promise<never>(() => undefined));
            const tool = new MemorySearchTool({} as never, { createChatModel } as never);

            const pending = (tool as unknown as {
                rerankCandidates(
                    query: string,
                    candidates: MemoryCandidate[],
                    selectedModel: { kind: "policy"; modelName: string },
                    signal: AbortSignal,
                    absoluteDeadlineMs: number,
                ): Promise<unknown>;
            }).rerankCandidates(
                "one",
                [candidate],
                { kind: "policy", modelName: "policy-model" },
                new AbortController().signal,
                11_000,
            );

            await jest.advanceTimersByTimeAsync(499);
            expect(createChatModel).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);

            await expect(pending).resolves.toMatchObject({
                kind: "fail_open",
                reason: "timeout",
                modelCalled: false,
                candidates: [candidate],
            });
            expect(createChatModel).toHaveBeenCalledTimes(1);
            expect(createChatModel).toHaveBeenCalledWith(0, expect.objectContaining({
                modelName: "policy-model",
            }));
        } finally {
            jest.useRealTimers();
        }
    });

    it("fails open on the bounded child timeout when the selected invocation stalls", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(20_000);
        try {
            const candidate = await makeAnchoredCandidate("notes/one.md", "# One\n\nUseful evidence.");
            let markInvocationStarted!: () => void;
            const invocationStarted = new Promise<void>((resolve) => {
                markInvocationStarted = resolve;
            });
            const invoke = jest.fn(async () => {
                markInvocationStarted();
                return new Promise<never>(() => undefined);
            });
            const createChatModel = jest.fn(async () => RunnableLambda.from(invoke));
            const tool = new MemorySearchTool({} as never, { createChatModel } as never);

            const pending = (tool as unknown as {
                rerankCandidates(
                    query: string,
                    candidates: MemoryCandidate[],
                    selectedModel: { kind: "chat"; modelName: string },
                    signal: AbortSignal,
                    absoluteDeadlineMs: number,
                ): Promise<unknown>;
            }).rerankCandidates(
                "one",
                [candidate],
                { kind: "chat", modelName: "chat-model" },
                new AbortController().signal,
                21_000,
            );

            await invocationStarted;
            await jest.advanceTimersByTimeAsync(500);

            await expect(pending).resolves.toMatchObject({
                kind: "fail_open",
                reason: "timeout",
                modelCalled: true,
                candidates: [candidate],
            });
            expect(createChatModel).toHaveBeenCalledTimes(1);
            expect(invoke).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe("Phase 1 search assembly", () => {
    async function runSearch(options: {
        strict: boolean;
        response: string;
        readLatest: (path: string) => Promise<LatestMemorySourceMaterial | null>;
        chatModelName?: string;
        omitLatestSourceSeam?: boolean;
        getEvidenceEpoch?: () => string;
        onRerankInvoke?: () => void;
        onModelCreate?: () => void;
        onGenerationRead?: (read: number) => void;
        onHashContent?: (content: string) => void;
        invokeResponse?: (signal?: AbortSignal) => Promise<string>;
        getRetrievalOptimizationFlags?: () => {
            strictReranker?: boolean;
            relaxedRecovery?: boolean;
        };
        getRetrievalOptimizationEpoch?: () => string;
        onSettingsChanged?: (listener: () => void | Promise<void>) => () => void;
        candidateMarkdownByPath?: Readonly<Record<string, string>>;
        captureRecoverySeed?: boolean;
        temporalIntent?: QueryTemporalIntent;
        temporalFilterCapture?: MemorySearchTemporalFilterCapture;
        absoluteDeadlineMs?: number;
        recordDiagnostic?: (event: RetrievalDiagnosticEventInput) => void;
    }) {
        const candidateMarkdownByPath = options.candidateMarkdownByPath ?? {
            "notes/one.md": "# One\n\nUseful current evidence.",
        };
        const candidates = await Promise.all(Object.entries(candidateMarkdownByPath).map(
            ([path, markdown]) => makeAnchoredCandidate(path, markdown),
        ));
        const rawResults = candidates.flatMap((candidate) => candidate.documents.map((document) => ({
            score: document.score,
            doc: {
                pageContent: document.content,
                metadata: {
                    path: document.source.path,
                    chunkIndex: document.source.chunkIndex,
                    contentHash: document.anchorMetadata?.contentHash,
                    startLine: document.anchorMetadata?.startLine,
                    endLine: document.anchorMetadata?.endLine,
                    headingPath: document.anchorMetadata?.headingPath,
                    indexVersion: document.anchorMetadata?.indexVersion,
                },
            },
        })));
        const invoke = jest.fn(async (_input: unknown, config?: { signal?: AbortSignal }) => {
            options.onRerankInvoke?.();
            return {
                content: options.invokeResponse
                    ? await options.invokeResponse(config?.signal)
                    : options.response,
            };
        });
        const llm = RunnableLambda.from(invoke);
        const createChatModel = jest.fn(async () => {
            options.onModelCreate?.();
            return llm;
        });
        const readLatestMemorySource = jest.fn(options.readLatest);
        let generationReads = 0;
        const host = {
            settings: {
                policyModelName: "",
                chatModelName: options.chatModelName ?? "chat-model",
                retrievalOptimizationFlags: { strictReranker: options.strict },
            },
            memorySearch: {
                searchHybrid: jest.fn(async () => rawResults),
                getChunksByPath: jest.fn(async () => []),
                getPathEvidenceGenerations: jest.fn(async (paths: string[]) => {
                    generationReads += 1;
                    options.onGenerationRead?.(generationReads);
                    return {
                        sourceEpoch: "source-epoch-1",
                        paths: paths.map((path) => ({
                            path,
                            current: true,
                            reason: "current",
                            generation: `generation:${path}`,
                        })),
                    };
                }),
            },
            getMemoryEvidenceEpoch: options.getEvidenceEpoch ?? (() => "boundary-epoch-1"),
            ...(options.getRetrievalOptimizationFlags
                ? { getRetrievalOptimizationFlags: options.getRetrievalOptimizationFlags }
                : {}),
            ...(options.getRetrievalOptimizationEpoch
                ? { getRetrievalOptimizationEpoch: options.getRetrievalOptimizationEpoch }
                : {}),
            ...(options.onSettingsChanged
                ? { onSettingsChanged: options.onSettingsChanged }
                : {}),
            isDataBoundaryAllowedPath: () => true,
            ...(options.recordDiagnostic
                ? { createRetrievalDiagnosticRecorder: () => options.recordDiagnostic }
                : {}),
            ...(options.omitLatestSourceSeam ? {} : { readLatestMemorySource }),
        };
        const aiUtils = {
            createChatModel,
            cleanMarkdownContent: materializer.cleanMarkdown,
            hashContent: async (content: string) => {
                options.onHashContent?.(content);
                return materializer.hashContent(content);
            },
        };
        const tool = new MemorySearchTool(host as never, aiUtils as never);
        const invocation = options.captureRecoverySeed
            || options.temporalIntent !== undefined
            || options.temporalFilterCapture !== undefined
            || Number.isFinite(options.absoluteDeadlineMs)
            ? createStandardMemorySearchInvocation({
                temporalIntent: options.temporalIntent ?? "none",
                captureRecoverySeed: options.captureRecoverySeed ?? false,
                temporalFilterCapture: options.temporalFilterCapture,
                absoluteDeadlineMs: options.absoluteDeadlineMs,
            })
            : undefined;
        const result = await (tool as unknown as {
            searchVss(
                query: string,
                signal?: AbortSignal,
                invocation?: ReturnType<typeof createStandardMemorySearchInvocation>,
            ): Promise<import("../src/ai-services/chat-types").MemorySearchResult>;
        }).searchVss(
            "one",
            undefined,
            invocation,
        );
        return { result, invoke, createChatModel, readLatestMemorySource, tool, invocation };
    }

    it("clears a valid-none result only when the strict flag is on", async () => {
        const response = '{"verdict":"none_relevant","ranking":[],"needsMoreEvidence":true}';
        const strict = await runSearch({
            strict: true,
            response,
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
        });
        const rollback = await runSearch({
            strict: false,
            response,
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
        });

        expect(strict.result).toMatchObject({
            documents: [],
            memoryEvidenceState: "none",
            rerankVerdict: "none_relevant",
            needsMoreEvidence: true,
        });
        expect(strict.invoke).toHaveBeenCalledTimes(1);
        expect(rollback.result).toMatchObject({
            usedMemory: true,
            memoryEvidenceState: "evidence",
            rerankVerdict: "relevant",
            needsMoreEvidence: false,
        });
        expect(rollback.result.documents).toHaveLength(1);
        expect(rollback.readLatestMemorySource).toHaveBeenCalledTimes(2);
    });

    it("keeps direct evidence and skips strict reranking on Windows", async () => {
        const originalIsWin = Platform.isWin;
        Platform.isWin = true;
        try {
            const search = await runSearch({
                strict: true,
                response: '{"verdict":"none_relevant","ranking":[],"needsMoreEvidence":true}',
                readLatest: async (path) => latestSource(
                    path,
                    "# One\n\nUseful current evidence.",
                ),
            });

            expect(search.createChatModel).toHaveBeenCalledTimes(1);
            expect(search.invoke).toHaveBeenCalledTimes(1);
            expect(search.result).toMatchObject({
                usedMemory: true,
                memoryEvidenceState: "evidence",
                rerankVerdict: "relevant",
                needsMoreEvidence: false,
            });
            expect(search.result.recoverySeed).toBeUndefined();
        } finally {
            Platform.isWin = originalIsWin;
        }
    });

    it("threads the invocation deadline into the selected reranker child timeout", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(30_000);
        try {
            let markInvocationStarted!: () => void;
            const invocationStarted = new Promise<void>((resolve) => {
                markInvocationStarted = resolve;
            });
            const pending = runSearch({
                strict: true,
                response: "unused",
                absoluteDeadlineMs: 31_000,
                onRerankInvoke: markInvocationStarted,
                invokeResponse: async () => new Promise<never>(() => undefined),
                readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
            });

            await invocationStarted;
            await jest.advanceTimersByTimeAsync(500);
            const search = await pending;

            expect(search.result).toMatchObject({
                usedMemory: true,
                memoryEvidenceState: "evidence",
                rerankOutcome: {
                    kind: "fail_open",
                    reason: "timeout",
                    modelCalled: true,
                },
            });
            expect(search.createChatModel).toHaveBeenCalledTimes(1);
            expect(search.invoke).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it("aborts and discards a late strict reranker result when the live flag turns off", async () => {
        let strictReranker = true;
        let policyEpoch = "retrieval-policy-1";
        let resolveLate!: (content: string) => void;
        let markProviderStarted!: () => void;
        const providerStarted = new Promise<void>((resolve) => {
            markProviderStarted = resolve;
        });
        const lateResponse = new Promise<string>((resolve) => {
            resolveLate = resolve;
        });
        const listeners = new Set<() => void | Promise<void>>();
        let providerSignal: AbortSignal | undefined;
        const pending = runSearch({
            strict: true,
            response: "unused",
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
            getRetrievalOptimizationFlags: () => ({ strictReranker }),
            getRetrievalOptimizationEpoch: () => policyEpoch,
            onSettingsChanged: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            invokeResponse: async (signal) => {
                providerSignal = signal;
                markProviderStarted();
                return lateResponse;
            },
        });

        await providerStarted;
        strictReranker = false;
        policyEpoch = "retrieval-policy-2";
        await Promise.all([...listeners].map((listener) => listener()));
        const search = await pending;

        expect(providerSignal?.aborted).toBe(true);
        expect(search.result).toMatchObject({
            usedMemory: true,
            memoryEvidenceState: "evidence",
            rerankOutcome: {
                kind: "fail_open",
                reason: "policy_disabled",
            },
        });
        expect(listeners.size).toBe(0);
        resolveLate('{"verdict":"none_relevant","ranking":[],"needsMoreEvidence":true}');
        await Promise.resolve();
        expect(search.result.documents).toHaveLength(1);
    });

    it("makes no reranker call when latest-source materialization drops every candidate", async () => {
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            readLatest: async () => null,
        });

        expect(search.createChatModel).not.toHaveBeenCalled();
        expect(search.invoke).not.toHaveBeenCalled();
        expect(search.result).toMatchObject({
            documents: [],
            sources: [],
            memoryEvidenceState: "unavailable",
            operationalReason: "current_source_unavailable",
            needsMoreEvidence: false,
        });
    });

    it("omits document count for operational unavailability but preserves observed semantic zero", async () => {
        const unavailableDiagnostics: RetrievalDiagnosticEventInput[] = [];
        await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            readLatest: async () => null,
            recordDiagnostic: (event) => unavailableDiagnostics.push(event),
        });
        const unavailableTerminal = unavailableDiagnostics.find((event) => (
            event.phase === "memory_search" && event.outcome !== "started"
        ));
        expect(unavailableTerminal).toMatchObject({
            outcome: "failed",
            reason: "source_unavailable",
        });
        expect(unavailableTerminal?.metrics).not.toHaveProperty("documentCount");

        const noneDiagnostics: RetrievalDiagnosticEventInput[] = [];
        await runSearch({
            strict: true,
            response: '{"verdict":"none_relevant","ranking":[],"needsMoreEvidence":true}',
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
            recordDiagnostic: (event) => noneDiagnostics.push(event),
        });
        expect(noneDiagnostics).toContainEqual(expect.objectContaining({
            phase: "memory_search",
            outcome: "completed",
            reason: "semantic_none",
            metrics: expect.objectContaining({ documentCount: 0 }),
        }));
    });

    it("re-materializes the complete bounded set immediately before reranking", async () => {
        let reads = 0;
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            readLatest: async (path) => {
                reads += 1;
                return reads === 1
                    ? latestSource(path, "# One\n\nUseful current evidence.")
                    : null;
            },
        });

        expect(reads).toBe(2);
        expect(search.invoke).not.toHaveBeenCalled();
        expect(search.result).toMatchObject({
            documents: [],
            sources: [],
            memoryEvidenceState: "unavailable",
            operationalReason: "current_source_unavailable",
        });
    });

    it("retries the whole bounded group when its evidence epoch drifts mid-read", async () => {
        const markdownByPath = {
            "notes/one.md": "# One\n\nFirst current evidence.",
            "notes/two.md": "# Two\n\nSecond current evidence.",
        };
        let boundaryEpoch = "boundary-epoch-1";
        let reads = 0;
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0,1],"needsMoreEvidence":false}',
            candidateMarkdownByPath: markdownByPath,
            getEvidenceEpoch: () => boundaryEpoch,
            readLatest: async (path) => {
                reads += 1;
                // Reads 1-2 are proposal materialization. Drift on the second
                // member of the first unified attempt (read 4), so both members
                // must be read again under the next stable epoch.
                if (reads === 4) boundaryEpoch = "boundary-epoch-2";
                return latestSource(path, markdownByPath[path as keyof typeof markdownByPath]);
            },
        });

        expect(reads).toBe(6);
        expect(search.invoke).toHaveBeenCalledTimes(1);
        expect(search.result.documents.map((document) => document.source.path)).toEqual([
            "notes/one.md",
            "notes/two.md",
        ]);
    });

    it("builds the reranker model before sealing the live candidate group", async () => {
        let boundaryEpoch = "boundary-epoch-1";
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            getEvidenceEpoch: () => boundaryEpoch,
            onModelCreate: () => { boundaryEpoch = "boundary-epoch-2"; },
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
        });

        expect(search.invoke).toHaveBeenCalledTimes(1);
        expect(search.result).toMatchObject({
            usedMemory: true,
            memoryEvidenceState: "evidence",
        });
    });

    it("checks the sealed epoch immediately before reranker invoke", async () => {
        let boundaryEpoch = "boundary-epoch-1";
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            getEvidenceEpoch: () => boundaryEpoch,
            onGenerationRead: (read) => {
                if (read === 3) boundaryEpoch = "boundary-epoch-2";
            },
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
        });

        expect(search.invoke).not.toHaveBeenCalled();
        expect(search.result).toMatchObject({
            memoryEvidenceState: "unavailable",
            operationalReason: "final_source_changed",
        });
    });

    it("checks the sealed group again after rejection-ledger hashing", async () => {
        let boundaryEpoch = "boundary-epoch-1";
        const search = await runSearch({
            strict: true,
            captureRecoverySeed: true,
            response: '{"verdict":"none_relevant","ranking":[],"needsMoreEvidence":true}',
            getEvidenceEpoch: () => boundaryEpoch,
            onHashContent: (content) => {
                if (content.includes('"representationVersion":1')) {
                    boundaryEpoch = "boundary-epoch-2";
                }
            },
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
        });

        expect(search.invoke).toHaveBeenCalledTimes(1);
        expect(search.result).toMatchObject({
            memoryEvidenceState: "unavailable",
            operationalReason: "final_source_changed",
        });
        expect(search.result.recoverySeed).toBeUndefined();
    });

    it("drops all final evidence when the source epoch changes after reranking", async () => {
        let boundaryEpoch = "boundary-epoch-1";
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
            getEvidenceEpoch: () => boundaryEpoch,
            onRerankInvoke: () => { boundaryEpoch = "boundary-epoch-2"; },
        });

        expect(search.invoke).toHaveBeenCalledTimes(1);
        expect(search.result).toMatchObject({
            documents: [],
            sources: [],
            memoryEvidenceState: "unavailable",
            operationalReason: "final_source_changed",
        });
    });

    it("still gates final evidence against the latest source when no rerank model is usable", async () => {
        const search = await runSearch({
            strict: true,
            chatModelName: "",
            response: "unused",
            readLatest: async (path) => latestSource(path, "# One\n\nChanged after indexing."),
        });

        expect(search.createChatModel).not.toHaveBeenCalled();
        expect(search.result).toMatchObject({
            documents: [],
            sources: [],
            memoryEvidenceState: "unavailable",
            operationalReason: "current_source_unavailable",
        });
    });

    it("revalidates opaque source snapshots before a later provider request", async () => {
        let currentMtime = 10;
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            readLatest: async (path) => latestSource(
                path,
                "# One\n\nUseful current evidence.",
                currentMtime,
            ),
        });
        expect(search.result.documents).toHaveLength(1);

        currentMtime = 11;
        const revalidated = await search.tool.revalidateForProvider(search.result);

        expect(revalidated).toMatchObject({
            documents: [],
            sources: [],
            memoryEvidenceState: "unavailable",
            operationalReason: "final_source_changed",
        });
    });

    it("applies the frozen temporal range during provider projection and reports the actual audit", async () => {
        const markdownByPath = {
            "notes/old.md": "# Old\n\nOut-of-range evidence.",
            "notes/current.md": "# Current\n\nIn-range evidence.",
        };
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0,1],"needsMoreEvidence":false}',
            candidateMarkdownByPath: markdownByPath,
            readLatest: async (path) => latestSource(
                path,
                markdownByPath[path as keyof typeof markdownByPath],
                path === "notes/old.md" ? 10 : 30,
            ),
        });
        const audit: MemoryTemporalProjectionAudit = {
            temporalFilterApplied: 0,
            temporalViolationCount: 1,
        };

        const revalidated = await search.tool.revalidateForProvider(
            search.result,
            undefined,
            { since: 20, until: 40 },
            audit,
        );

        expect(revalidated.sources.map((source) => source.path)).toEqual(["notes/current.md"]);
        expect(audit).toEqual({
            temporalFilterApplied: 1,
            temporalViolationCount: 0,
        });
    });

    it("captures the exact A1 temporal filter only through the Host invocation sink", async () => {
        const temporalFilterCapture: MemorySearchTemporalFilterCapture = {};
        const mtime = Date.parse("2026-06-15T12:00:00.000Z");
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            temporalIntent: "range:2026-01-01..2026-12-31",
            temporalFilterCapture,
            readLatest: async (path) => latestSource(
                path,
                "# One\n\nUseful current evidence.",
                mtime,
            ),
        });

        expect(temporalFilterCapture.temporalFilter).toEqual({
            since: Date.parse("2026-01-01T00:00:00.000Z"),
            until: Date.parse("2026-12-31T00:00:00.000Z") + 86_400_000 - 1,
        });
        expect(search.result.documents).toHaveLength(1);
        expect(JSON.stringify(search.result)).not.toContain("temporalFilter");
        expect(JSON.stringify(search.result)).not.toContain("temporalFilterCapture");
        expect(JSON.stringify(search.invocation)).not.toContain("temporalFilter");
        expect(JSON.stringify(search.invocation)).not.toContain(String(
            temporalFilterCapture.temporalFilter?.since,
        ));
    });

    it("fails closed when a result with documents has no Host-only source handles", async () => {
        const search = await runSearch({
            strict: true,
            response: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
        });

        const revalidated = await search.tool.revalidateForProvider({
            ...search.result,
            candidates: undefined,
        });

        expect(revalidated).toMatchObject({
            documents: [],
            sources: [],
            memoryEvidenceState: "unavailable",
            operationalReason: "final_source_changed",
        });
    });

    it("does not project indexed evidence when the latest-source Host seam is absent", async () => {
        const search = await runSearch({
            strict: true,
            chatModelName: "",
            response: "unused",
            omitLatestSourceSeam: true,
            readLatest: async (path) => latestSource(path, "# One\n\nUseful current evidence."),
        });

        expect(search.result).toMatchObject({
            documents: [],
            sources: [],
            memoryEvidenceState: "unavailable",
            operationalReason: "current_source_unavailable",
        });
    });
});
