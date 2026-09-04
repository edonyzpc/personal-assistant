import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { RunnableLambda } from "@langchain/core/runnables";
import { Platform } from "obsidian";

jest.mock("obsidian");
jest.mock("../src/ai-services/append-tool-provider", () => ({
    AppendToolProvider: class { },
}));

import { MemorySearchTool } from "../src/ai-services/pa-agent-runtime";
import {
    createRelaxedMemorySearchInvocation,
    createStandardMemorySearchInvocation,
    runWithMemorySearchInvocation,
} from "../src/ai-services/memory-search-tool";
import { projectMemorySearchObservation } from "../src/ai-services/pa-agent-host-tools";
import type { RewrittenQuery } from "../src/ai-services/query-rewriter";
import * as personalizedPageRank from "../src/graph/personalized-pagerank";
import { createHeadingAwareMarkdownChunks } from "../src/vss/markdown-chunker";
import { RETRIEVAL_CALIBRATION_PROFILE } from "../src/vss/retrieval-calibration";
import {
    RetrievalDiagnosticsController,
    type RetrievalDiagnosticEventInput,
    type RetrievalDiagnosticSurface,
} from "../src/ai-services/retrieval-diagnostics";
import { createProviderRequestScope } from "../src/ai-services/obsidian-fetch";
import { resolveB125RetrievalOptimizationFlags } from "../src/retrieval-optimization-platform-policy";

// Minimal host / AIUtils stubs for the searchVss contract tests. We do NOT
// boot a full PaAgentRuntime — searchVss only needs:
//   - host.settings.policyModelName    (controls rewrite branch)
//   - host.memorySearch.searchHybrid    (assertion target)
//   - host.memorySearch.ensureReadyForChat (only when calling search())
//   - aiUtils.createChatModel            (rewrite path; never reached when
//                                         policyModelName is empty)

interface SearchHybridArgs {
    prompt: string;
    options?: {
        ftsQueryOverride?: string | null;
        ftsQueryOverridePromise?: Promise<string | null>;
        temporalFilterPromise?: Promise<{ since?: number; until?: number } | null>;
        signal?: AbortSignal;
        absoluteDeadlineMs?: number;
        providerRequestScope?: ReturnType<typeof createProviderRequestScope>;
        queryEmbeddingOut?: { value?: number[]; profileSignature?: string; sourceEpoch?: string };
        queryEmbeddingOverride?: { value: readonly number[]; profileSignature: string };
        retrievalMode?: "standard" | "relaxed";
        excludeUnchangedPathGenerations?: Array<{ path: string; generation: string }>;
    };
}

interface GetChunksByPathArgs {
    paths: string[];
    options?: {
        limitPerPath?: number;
        signal?: AbortSignal;
    };
}

function makePlugin(opts: {
    policyModelName: string;
    chatModelName?: string;
    searchHybrid?: (args: SearchHybridArgs) => Promise<unknown>;
    getChunksByPath?: (args: GetChunksByPathArgs) => Promise<unknown>;
    isDataBoundaryAllowedPath?: (path: string) => boolean;
    retrievalOptimizationFlags?: {
        strictReranker?: boolean;
        graphPpr?: boolean;
        relaxedRecovery?: boolean;
    };
    graphBoundarySource?: {
        getEpoch(): string;
        resolvedLinks: ReadonlyMap<string, ReadonlySet<string>>;
        classifyPath(path: string): "allowed_markdown" | "opaque_excluded_markdown" | "blocked";
        canonicalizePath(path: string): string | null;
    };
    rankGraphCandidates?: (...args: any[]) => Promise<any>;
    getPathEvidenceGenerations?: (
        paths: string[],
        options?: { signal?: AbortSignal; absoluteDeadlineMs?: number },
    ) => Promise<any>;
    recordRetrievalDiagnostic?: (event: RetrievalDiagnosticEventInput) => void;
}) {
    const calls: SearchHybridArgs[] = [];
    const settingsChangeListeners = new Set<() => void | Promise<void>>();
    let latestSourceEpoch = "epoch-1";
    const searchHybrid = opts.searchHybrid
        ?? (async () => []);
    const getChunksByPath = opts.getChunksByPath
        ?? (async () => []);
    const settings = {
        policyModelName: opts.policyModelName,
        chatModelName: opts.chatModelName,
        retrievalOptimizationFlags: opts.retrievalOptimizationFlags,
    };
    const plugin = {
        settings,
        log: jest.fn(),
        isGraphPprEnabled: () => resolveB125RetrievalOptimizationFlags(
            settings.retrievalOptimizationFlags,
        ).graphPpr,
        onSettingsChanged: (listener: () => void | Promise<void>) => {
            settingsChangeListeners.add(listener);
            return () => settingsChangeListeners.delete(listener);
        },
        memorySearch: {
            ensureReadyForChat: jest.fn(async () => ({ decision: "use-memory" as const })),
            searchHybrid: jest.fn(async (prompt: string, options?: SearchHybridArgs["options"]) => {
                calls.push({ prompt, options });
                const result = await searchHybrid({ prompt, options });
                if (options?.queryEmbeddingOut?.sourceEpoch) {
                    latestSourceEpoch = options.queryEmbeddingOut.sourceEpoch;
                }
                return result;
            }),
            getChunksByPath: jest.fn(async (paths: string[], options?: GetChunksByPathArgs["options"]) => {
                return getChunksByPath({ paths, options });
            }),
            rankGraphCandidates: jest.fn(opts.rankGraphCandidates ?? (async () => ({
                requestId: "",
                runEpoch: "",
                sourceEpoch: "",
                paths: [],
            }))),
            cancelGraphCandidateRank: jest.fn(),
            getPathEvidenceGenerations: jest.fn(async (
                paths: string[],
                options?: { signal?: AbortSignal; absoluteDeadlineMs?: number },
            ) => (
                opts.getPathEvidenceGenerations?.(paths, options)
                ?? {
                    sourceEpoch: latestSourceEpoch,
                    paths: paths.map((path) => ({
                        path,
                        current: true,
                        reason: "current",
                        generation: `generation:${path}`,
                    })),
                }
            )),
        },
        getMemoryEvidenceEpoch: jest.fn(() => opts.graphBoundarySource?.getEpoch() ?? "boundary-epoch-1"),
        // Assembly-focused cases replace materialization with an identity stub;
        // keep the production Host seam present so the coherent-set gate runs.
        readLatestMemorySource: jest.fn(async () => null),
        getGraphBoundarySnapshotSource: jest.fn(() => opts.graphBoundarySource),
        isDataBoundaryAllowedPath: opts.isDataBoundaryAllowedPath,
        ...(opts.recordRetrievalDiagnostic
            ? { createRetrievalDiagnosticRecorder: () => opts.recordRetrievalDiagnostic }
            : {}),
    };
    return {
        plugin: { ...plugin, vss: plugin.memorySearch },
        calls,
        notifySettingsChanged: async () => {
            await Promise.all([...settingsChangeListeners].map((listener) => listener()));
        },
    };
}

function makeAIUtils(invokerOverride?: () => Promise<{ content: string }>) {
    return {
        createChatModel: jest.fn(async () => {
            // Return a minimal stub LLM. The rewrite invoker is constructed
            // inside MemorySearchTool via ChatPromptTemplate.pipe(llm); to
            // intercept it we'd have to rebuild the langchain pipeline, which
            // is unnecessary for these contract tests. Instead we lean on the
            // fact that with a non-empty policyModelName, rewriteQueryWithTimeout
            // will run rewriteQuery → which calls the invoker → which we don't
            // need to fully model: rewriteQuery returns null for short queries
            // so the override resolves null cleanly.
            //
            // For tests that need the rewrite to succeed, we override
            // rewriteQueryWithTimeout via Object.defineProperty below.
            return {
                invoke: invokerOverride ?? (async () => ({ content: '{"keywords":"rewritten"}' })),
            };
        }),
        hashContent: jest.fn(async (content: string) => content),
    };
}

function isolateCandidateAssembly(tool: MemorySearchTool): void {
    // These legacy contract cases exercise search/graph assembly only. Phase 1
    // latest-source identity is covered with real anchors in memory-search-phase1.test.ts.
    (tool as any).materializeLatestCandidates = jest.fn(async (candidates: unknown[]) => candidates);
    (tool as any).materializeLatestCandidate = jest.fn(async (candidate: unknown) => candidate);
}

describe("MemorySearchTool searchVss contract", () => {
    beforeEach(() => {
        jest.useRealTimers();
    });

    it("keeps Pagelet Memory search diagnostics on the explicit pagelet surface", async () => {
        const controller = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => "pagelet-memory-session",
        );
        const session = controller.start();
        const requestedSurfaces: RetrievalDiagnosticSurface[] = [];
        const { plugin } = makePlugin({ policyModelName: "" });
        Object.assign(plugin, {
            createRetrievalDiagnosticRecorder: (surface: RetrievalDiagnosticSurface) => {
                requestedSurfaces.push(surface);
                return controller.createRecorder(surface);
            },
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any, "pagelet");
        const signal = new AbortController().signal;
        const invocation = createStandardMemorySearchInvocation({
            temporalIntent: "none",
            captureRecoverySeed: false,
            runEpoch: "pagelet-memory-run",
        });

        await (tool as any).searchVss("private pagelet query sentinel", signal, invocation);

        const snapshot = controller.snapshot(session.sessionId);
        expect(requestedSurfaces).toEqual(["pagelet"]);
        expect(snapshot.events.filter((event) => event.phase === "memory_search"))
            .toHaveLength(2);
        expect(snapshot.events.every((event) => event.surface === "pagelet")).toBe(true);
        expect(snapshot.events.every((event) => event.runId === "pagelet-memory-run")).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain("private pagelet query sentinel");
    });

    it("freezes outer temporal intent and the caller-owned query embedding for recovery", async () => {
        const { plugin, calls } = makePlugin({
            policyModelName: "",
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [];
            },
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        const controller = new AbortController();
        const before = Date.now();
        const result = await runWithMemorySearchInvocation(
            createStandardMemorySearchInvocation({
                temporalIntent: "recent_7d",
                captureRecoverySeed: true,
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(result.recoverySeed).toMatchObject({
            query: "launch",
            lexicalPlan: { temporalIntent: "recent_7d" },
            queryEmbedding: {
                value: [0.1, 0.2],
                profileSignature: "profile-v1",
                sourceEpoch: "epoch-1",
            },
        });
        const since = result.recoverySeed?.lexicalPlan.temporalFilter?.since;
        expect(since).toBeGreaterThanOrEqual(before - 7 * 24 * 60 * 60 * 1000);
        expect(calls[0]?.options?.queryEmbeddingOut).toBeDefined();
        expect(plugin.memorySearch.ensureReadyForChat).toHaveBeenCalledTimes(1);
    });

    it("propagates one run scope to rewrite and the current query embedding only", async () => {
        const providerRequestScope = createProviderRequestScope();
        const { plugin, calls } = makePlugin({
            policyModelName: "policy-model",
            searchHybrid: async () => [],
        });
        const aiUtils = makeAIUtils();
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        const controller = new AbortController();

        await runWithMemorySearchInvocation(
            createStandardMemorySearchInvocation({
                temporalIntent: "none",
                captureRecoverySeed: false,
                providerRequestScope,
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(calls[0]?.options?.providerRequestScope).toBe(providerRequestScope);
        expect(aiUtils.createChatModel as jest.Mock).toHaveBeenCalledWith(0, expect.objectContaining({
            modelName: "policy-model",
            providerRequestScope,
        }));
        expect(aiUtils.createChatModel as jest.Mock).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ onProviderRequestStart: expect.anything() }),
        );
    });

    it("captures only Host-current canonical generations in the first-attempt rejection ledger", async () => {
        const { plugin } = makePlugin({
            policyModelName: "policy-model",
            retrievalOptimizationFlags: { strictReranker: true, relaxedRecovery: true },
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [{
                    score: 0.9,
                    doc: {
                        pageContent: "indexed evidence",
                        metadata: {
                            path: "notes/a.md",
                            chunkIndex: 0,
                            pathEvidenceGeneration: "raw-selected-chunks-generation",
                        },
                    },
                }];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: "canonical-complete-path-generation",
                    current: true,
                    reason: "current",
                })),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        (tool as any).rewriteQueryWithTimeout = jest.fn(async () => ({
            keywords: "launch",
            temporal: "none",
        } satisfies RewrittenQuery));
        (tool as any).prepareReranker = jest.fn(async () => ({
            invoke: jest.fn(async () => ({
                kind: "valid",
                verdict: "none_relevant",
                needsMoreEvidence: true,
                candidates: [],
                origin: "model",
                modelCalled: true,
            })),
            dispose: jest.fn(),
        }));
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createStandardMemorySearchInvocation({
                temporalIntent: "none",
                captureRecoverySeed: true,
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(plugin.memorySearch.getPathEvidenceGenerations).toHaveBeenCalledWith(
            ["notes/a.md"],
            { signal: controller.signal },
        );
        expect(result.recoverySeed?.rejectedEvidence).toEqual([{
            path: "notes/a.md",
            pathEvidenceGeneration: "canonical-complete-path-generation",
            evidenceFingerprints: [visibleFingerprint("notes/a.md", "indexed evidence")],
            origin: "direct",
        }]);
    });

    it("disables relaxed retry when a non-empty A1 ledger cannot be fingerprinted", async () => {
        const { plugin } = makePlugin({
            policyModelName: "policy-model",
            retrievalOptimizationFlags: { strictReranker: true, relaxedRecovery: true },
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [{
                    score: 0.9,
                    doc: {
                        pageContent: "indexed evidence",
                        metadata: { path: "notes/a.md", chunkIndex: 0 },
                    },
                }];
            },
        });
        const aiUtils = makeAIUtils();
        aiUtils.hashContent.mockRejectedValue(new Error("fingerprint unavailable"));
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        isolateCandidateAssembly(tool);
        (tool as any).rewriteQueryWithTimeout = jest.fn(async () => ({
            keywords: "launch",
            temporal: "none",
        } satisfies RewrittenQuery));
        (tool as any).prepareReranker = jest.fn(async () => ({
            invoke: jest.fn(async () => ({
                kind: "valid",
                verdict: "none_relevant",
                needsMoreEvidence: true,
                candidates: [],
                origin: "model",
                modelCalled: true,
            })),
            dispose: jest.fn(),
        }));
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createStandardMemorySearchInvocation({
                temporalIntent: "none",
                captureRecoverySeed: true,
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(result.rerankVerdict).toBe("none_relevant");
        expect(result.recoverySeed).toBeUndefined();
    });

    it("runs relaxed mode with the same frozen plan and embedding without readiness or rewrite", async () => {
        const { plugin, calls } = makePlugin({ policyModelName: "policy-model" });
        const aiUtils = makeAIUtils();
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        const controller = new AbortController();
        const result = await runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: {
                    ftsQueryOverride: "frozen launch",
                    temporalIntent: "range:2026-01-01..2026-01-31",
                    temporalFilter: { since: 10, until: 20 },
                },
                rejectedEvidence: [{
                    path: "notes/rejected.md",
                    pathEvidenceGeneration: "generation-1",
                    evidenceFingerprints: ["fingerprint-1"],
                    origin: "direct",
                }],
                queryEmbedding: {
                    value: [0.1, 0.2],
                    profileSignature: "profile-v1",
                },
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(result.memoryEvidenceState).toBe("none");
        expect(plugin.memorySearch.ensureReadyForChat).not.toHaveBeenCalled();
        expect(aiUtils.createChatModel).not.toHaveBeenCalled();
        expect(calls[0]?.options?.queryEmbeddingOverride).toEqual({
            value: [0.1, 0.2],
            profileSignature: "profile-v1",
        });
        expect(calls[0]?.options).toMatchObject({
            retrievalMode: "relaxed",
            excludeUnchangedPathGenerations: [{
                path: "notes/rejected.md",
                generation: "generation-1",
            }],
        });
        await expect(calls[0]?.options?.ftsQueryOverridePromise).resolves.toBe("frozen launch");
        await expect(calls[0]?.options?.temporalFilterPromise).resolves.toEqual({ since: 10, until: 20 });
    });

    it("keeps the frozen temporal range on graph recovery and reports zero admitted violations", async () => {
        const seedPath = "notes/seed-2026.md";
        const recentPath = "notes/recent-2026.md";
        const oldPath = "notes/old-2020.md";
        const since = Date.parse("2026-01-01T00:00:00.000Z");
        const until = Date.parse("2026-12-31T23:59:59.999Z");
        const recentMtime = Date.parse("2026-06-01T00:00:00.000Z");
        const oldMtime = Date.parse("2020-06-01T00:00:00.000Z");
        const diagnostics: RetrievalDiagnosticEventInput[] = [];
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set([recentPath, oldPath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true, relaxedRecovery: true },
            graphBoundarySource,
            recordRetrievalDiagnostic: (event) => diagnostics.push(event),
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: `generation:${path}`,
                    contentHash: `hash:${path}`,
                    mtime: path === oldPath ? oldMtime : recentMtime,
                    size: 1,
                    current: true,
                    reason: "current",
                })),
            }),
            rankGraphCandidates: async (_embedding, paths, control) => ({
                requestId: control.requestId,
                runEpoch: control.runEpoch,
                sourceEpoch: control.sourceEpoch,
                paths: paths.map((path: string) => rankedPath(path, 0.8)),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        (tool as any).materializeLatestCandidates = jest.fn(async (candidates: any[]) => candidates.map((candidate) => ({
            ...candidate,
            sourceSnapshot: {
                epoch: `${candidate.path === oldPath ? oldMtime : recentMtime}:1`,
                bodyHash: `hash:${candidate.path}`,
            },
        })));
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: {
                    ftsQueryOverride: "launch",
                    temporalIntent: "range:2026-01-01..2026-12-31",
                    temporalFilter: { since, until },
                },
                rejectedEvidence: [{
                    path: seedPath,
                    pathEvidenceGeneration: `generation:${seedPath}`,
                    evidenceFingerprints: ["seed-visible"],
                    origin: "direct",
                }],
                queryEmbedding: {
                    value: [0.1, 0.2],
                    profileSignature: "profile-v1",
                    sourceEpoch: "epoch-1",
                },
            }, { runEpoch: "temporal-run", absoluteDeadlineMs: Date.now() + 5_000 }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(1);
        expect(plugin.memorySearch.rankGraphCandidates.mock.calls[0]?.[1]).toEqual([recentPath]);
        expect(result.sources.map((source) => source.path)).toEqual([recentPath]);
        expect(diagnostics).toContainEqual(expect.objectContaining({
            phase: "memory_search",
            outcome: "completed",
            metrics: expect.objectContaining({
                temporalFilterApplied: 1,
                temporalViolationCount: 0,
            }),
        }));
    });

    it("refills direct retrieval past twelve unchanged repeats before applying the direct cap", async () => {
        const repeatedPaths = Array.from({ length: 12 }, (_, index) => `notes/repeat-${index}.md`);
        const freshPath = "notes/fresh-13.md";
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { relaxedRecovery: true },
            searchHybrid: async () => [
                ...repeatedPaths.map((path, index) => ({
                    score: 0.99 - index / 100,
                    doc: {
                        pageContent: `repeat:${path}`,
                        metadata: {
                            path,
                            chunkIndex: 0,
                            pathEvidenceGeneration: `generation:${path}`,
                        },
                    },
                })),
                {
                    score: 0.4,
                    doc: {
                        pageContent: "fresh evidence",
                        metadata: {
                            path: freshPath,
                            chunkIndex: 0,
                            pathEvidenceGeneration: "generation:fresh",
                        },
                    },
                },
            ],
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: {
                    ftsQueryOverride: "launch",
                    temporalIntent: "none",
                    temporalFilter: null,
                },
                rejectedEvidence: repeatedPaths.map((path) => ({
                    path,
                    pathEvidenceGeneration: `generation:${path}`,
                    evidenceFingerprints: [visibleFingerprint(path, `repeat:${path}`)],
                    origin: "direct" as const,
                })),
                queryEmbedding: {
                    value: [0.1, 0.2],
                    profileSignature: "profile-v1",
                    sourceEpoch: "epoch-1",
                },
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(result.candidates?.map((candidate) => candidate.path)).toEqual([freshPath]);
        expect(result.sources.map((source) => source.path)).toEqual([freshPath]);
    });

    it("passes Promise.resolve(null) when policyModelName is empty (no rewrite)", async () => {
        const { plugin, calls } = makePlugin({ policyModelName: "" });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tool as any).searchVss("hello world", undefined);

        expect(plugin.vss.searchHybrid).toHaveBeenCalledTimes(1);
        expect(calls).toHaveLength(1);
        expect(calls[0].prompt).toBe("hello world");
        // Must pass the *new* promise field, NOT the legacy string field.
        expect(calls[0].options?.ftsQueryOverridePromise).toBeInstanceOf(Promise);
        expect(calls[0].options?.temporalFilterPromise).toBeInstanceOf(Promise);
        expect(calls[0].options).not.toHaveProperty("ftsQueryOverride");
        // Promise must resolve to null (no rewrite was scheduled).
        await expect(calls[0].options!.ftsQueryOverridePromise!).resolves.toBeNull();
        await expect(calls[0].options!.temporalFilterPromise!).resolves.toBeNull();
        // No chat model was created — the empty policyModelName short-circuits.
        expect(aiUtils.createChatModel).not.toHaveBeenCalled();
        expect(result.usedMemory).toBe(false);
        expect(result.documents).toEqual([]);
    });

    it("passes the rewrite promise to searchHybrid without awaiting it (true parallel path)", async () => {
        // Use a deferred to assert that searchHybrid is invoked BEFORE the
        // rewrite promise resolves — that's the critical invariant from §3.2.
        let resolveRewrite: ((v: RewrittenQuery) => void) | null = null;
        const rewriteDeferred = new Promise<RewrittenQuery>((r) => { resolveRewrite = r; });

        // searchHybrid will be entered immediately; we observe whether the
        // override promise is still pending at that moment.
        let promiseStateAtCall: "pending" | "settled" = "pending";
        const probedHybrid = async (args: SearchHybridArgs) => {
            const probe = await Promise.race([
                args.options!.ftsQueryOverridePromise!.then(() => "settled" as const),
                Promise.resolve("pending" as const),
            ]);
            promiseStateAtCall = probe;
            return [];
        };
        const { plugin, calls } = makePlugin({
            policyModelName: "policy-model",
            searchHybrid: probedHybrid,
        });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);

        // Stub out rewriteQueryWithTimeout to use our deferred so we can
        // observe ordering deterministically.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any).rewriteQueryWithTimeout = jest.fn(() => rewriteDeferred);

        // Stub rerankCandidates to no-op (avoid touching createChatModel for rerank too).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any).rerankCandidates = jest.fn(async (_q: string, c: unknown[]) => c);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const searchPromise = (tool as any).searchVss("longer query phrase", undefined) as Promise<unknown>;
        // Microtask flush so searchVss reaches the searchHybrid call.
        await Promise.resolve();
        await Promise.resolve();
        // searchHybrid awaits both override+embed via Promise.all internally,
        // but at the TOP-LEVEL searchVss we passed an unresolved promise.
        // With our probedHybrid mock, the override is observed pending.
        // Now resolve rewrite and let searchVss complete.
        resolveRewrite!({ keywords: "rewritten", temporal: "none" });
        const result = await searchPromise;

        expect(plugin.vss.searchHybrid).toHaveBeenCalledTimes(1);
        expect(calls[0].options?.ftsQueryOverridePromise).toBeInstanceOf(Promise);
        // Critical invariant: the promise was unresolved at the moment
        // searchHybrid was called — pa-agent did NOT await it upstream.
        expect(promiseStateAtCall).toBe("pending");
        expect(result).toMatchObject({
            usedMemory: false,
            query: "longer query phrase",
            documents: [],
            sources: [],
            candidates: [],
            hasAnswerableContent: false,
            needsSnippetFollowup: false,
            memoryEvidenceState: "none",
            rerankVerdict: "none_relevant",
            needsMoreEvidence: true,
            rerankOutcome: {
                kind: "valid",
                origin: "deterministic_empty",
                modelCalled: false,
            },
        });
    });

    it("passes temporal rewrite intent to VSS as an independent filter promise", async () => {
        const now = new Date("2026-06-16T00:00:00.000Z").getTime();
        const dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
        const { plugin, calls } = makePlugin({ policyModelName: "policy-model" });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any).rewriteQueryWithTimeout = jest.fn(async () => ({
            keywords: "Memory refresh",
            temporal: "recent_7d",
        } satisfies RewrittenQuery));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any).rerankCandidates = jest.fn(async (_q: string, c: unknown[]) => c);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (tool as any).searchVss("what changed in Memory refresh last week", undefined);
            expect(calls[0].options?.ftsQueryOverridePromise).toBeInstanceOf(Promise);
            expect(calls[0].options?.temporalFilterPromise).toBeInstanceOf(Promise);
            await expect(calls[0].options!.ftsQueryOverridePromise!).resolves.toBe("Memory refresh");
            await expect(calls[0].options!.temporalFilterPromise!).resolves.toEqual({
                since: now - 7 * 24 * 60 * 60 * 1000,
            });
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    it("keeps an explicit date range inclusive without admitting midnight of the next day", async () => {
        const { plugin, calls } = makePlugin({ policyModelName: "policy-model" });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        (tool as any).rewriteQueryWithTimeout = jest.fn(async () => ({
            keywords: "year boundary",
            temporal: "range:2026-01-01..2026-12-31",
        } satisfies RewrittenQuery));

        await (tool as any).searchVss("from 2026-01-01 to 2026-12-31", undefined);

        await expect(calls[0].options!.temporalFilterPromise!).resolves.toEqual({
            since: Date.parse("2026-01-01T00:00:00.000Z"),
            until: Date.parse("2026-12-31T23:59:59.999Z"),
        });
    });

    it("rejects with AbortError when signal is already aborted (entry throwIfAborted)", async () => {
        const { plugin } = makePlugin({ policyModelName: "" });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);

        const controller = new AbortController();
        controller.abort();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect((tool as any).searchVss("hello world", controller.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
        // searchHybrid must NOT have been touched — abort fires before it.
        expect(plugin.vss.searchHybrid).not.toHaveBeenCalled();
    });

    it("passes the abort signal into searchHybrid for mid-flight cancellation", async () => {
        let receivedSignal: AbortSignal | undefined;
        const { plugin } = makePlugin({
            policyModelName: "",
            searchHybrid: async ({ options }) => {
                receivedSignal = options?.signal;
                return new Promise((_resolve, reject) => {
                    receivedSignal?.addEventListener("abort", () => {
                        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                    }, { once: true });
                });
            },
        });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        const controller = new AbortController();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = (tool as any).searchVss("hello world", controller.signal) as Promise<unknown>;
        await Promise.resolve();
        expect(receivedSignal).toBe(controller.signal);

        controller.abort();
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
    });

    it("propagates errors thrown by searchHybrid (preserves current behavior)", async () => {
        const { plugin } = makePlugin({
            policyModelName: "",
            searchHybrid: async () => { throw new Error("backend exploded"); },
        });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect((tool as any).searchVss("hello world", undefined)).rejects.toThrow("backend exploded");
        expect(plugin.vss.searchHybrid).toHaveBeenCalledTimes(1);
    });

    it("records only an allow-listed content-free reason for a relaxed source failure", async () => {
        const diagnostics: RetrievalDiagnosticEventInput[] = [];
        const { plugin } = makePlugin({
            policyModelName: "",
            recordRetrievalDiagnostic: (event) => diagnostics.push(event),
            searchHybrid: async () => {
                throw Object.assign(new Error("private backend detail"), {
                    code: "path-evidence-inventory-unavailable",
                });
            },
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);

        await expect((tool as any).searchVss("private query", undefined)).rejects.toThrow(
            "private backend detail",
        );
        expect(diagnostics).toContainEqual(expect.objectContaining({
            phase: "memory_search",
            outcome: "failed",
            reason: "source_unavailable",
        }));
        expect(JSON.stringify(diagnostics)).not.toContain("private backend detail");
        expect(JSON.stringify(diagnostics)).not.toContain("private query");
    });

    it("keeps graph flag-off retrieval direct-only and never enters the legacy one-hop path", async () => {
        const { plugin, calls } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: false },
            searchHybrid: async () => [{
                score: 0.9,
                doc: { pageContent: "root chunk", metadata: { path: "notes/a.md", chunkIndex: 0 } },
            }],
            getChunksByPath: async ({ paths }) => paths.map((path) => ({
                score: 1,
                doc: { pageContent: `linked chunk ${path}`, metadata: { path, chunkIndex: 0 } },
            })),
        });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        isolateCandidateAssembly(tool);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tool as any).searchVss("hello world", undefined);

        expect(plugin.vss.searchHybrid).toHaveBeenCalledTimes(1);
        expect(calls.map((call) => call.prompt)).toEqual(["hello world"]);
        expect(plugin.vss.getChunksByPath).not.toHaveBeenCalled();
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual(["notes/a.md"]);
    });

    it("keeps raw graph-on retrieval direct-only on Windows", async () => {
        const originalIsWin = Platform.isWin;
        Platform.isWin = true;
        try {
            const seedPath = "notes/a.md";
            const linkedPath = "notes/b.md";
            const { plugin } = makePlugin({
                policyModelName: "",
                retrievalOptimizationFlags: { graphPpr: true },
                graphBoundarySource: {
                    getEpoch: () => "graph-epoch-1",
                    resolvedLinks: new Map([[seedPath, new Set([linkedPath])]]),
                    classifyPath: () => "allowed_markdown",
                    canonicalizePath: (path) => path,
                },
                searchHybrid: async () => [directRawResult(seedPath)],
                rankGraphCandidates: async (_embedding, paths, control) => ({
                    requestId: control.requestId,
                    runEpoch: control.runEpoch,
                    sourceEpoch: control.sourceEpoch,
                    paths: paths.map((path: string) => rankedPath(path, 0.8)),
                }),
            });
            const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
            isolateCandidateAssembly(tool);

            const result = await (tool as any).searchVss("hello world", undefined);

            expect(plugin.memorySearch.rankGraphCandidates).not.toHaveBeenCalled();
            expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([
                seedPath,
            ]);
        } finally {
            Platform.isWin = originalIsWin;
        }
    });

    it("does not revive one-hop lookup as a graph fallback", async () => {
        const { plugin } = makePlugin({
            policyModelName: "",
            searchHybrid: async () => [{
                score: 0.9,
                doc: { pageContent: "root chunk", metadata: { path: "notes/a.md", chunkIndex: 0 } },
            }],
            getChunksByPath: async () => [],
        });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        isolateCandidateAssembly(tool);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tool as any).searchVss("hello world", undefined);

        expect(plugin.vss.searchHybrid).toHaveBeenCalledTimes(1);
        expect(plugin.vss.getChunksByPath).not.toHaveBeenCalled();
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual(["notes/a.md"]);
    });

    it("filters Data Boundary denied direct paths without traversing denied legacy links", async () => {
        const { plugin } = makePlugin({
            policyModelName: "",
            isDataBoundaryAllowedPath: (path) => !path.startsWith("private/"),
            searchHybrid: async () => [
                {
                    score: 0.9,
                    doc: { pageContent: "allowed root", metadata: { path: "notes/a.md", chunkIndex: 0 } },
                },
                {
                    score: 0.8,
                    doc: { pageContent: "private stale chunk", metadata: { path: "private/secret.md", chunkIndex: 0 } },
                },
            ],
            getChunksByPath: async ({ paths }) => paths.map((path) => ({
                score: 1,
                doc: { pageContent: `linked chunk ${path}`, metadata: { path, chunkIndex: 0 } },
            })),
        });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        isolateCandidateAssembly(tool);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tool as any).searchVss("hello world", undefined);

        expect(plugin.vss.getChunksByPath).not.toHaveBeenCalled();
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual(["notes/a.md"]);
        expect(result.sources.map((source: { path: string }) => source.path)).toEqual(["notes/a.md"]);
    });

    it("collects allowed Memory candidates beyond denied top results", async () => {
        const denied = Array.from({ length: 8 }, (_, index) => ({
            score: 0.95 - index * 0.01,
            doc: {
                pageContent: `private stale chunk ${index}`,
                metadata: { path: `private/secret-${index}.md`, chunkIndex: 0 },
            },
        }));
        const { plugin } = makePlugin({
            policyModelName: "",
            isDataBoundaryAllowedPath: (path) => !path.startsWith("private/"),
            searchHybrid: async () => [
                ...denied,
                {
                    score: 0.7,
                    doc: {
                        pageContent: "allowed evidence that answers the question",
                        metadata: { path: "notes/allowed.md", chunkIndex: 0 },
                    },
                },
            ],
        });
        const aiUtils = makeAIUtils();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        isolateCandidateAssembly(tool);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tool as any).searchVss("hello world", undefined);

        expect(result.usedMemory).toBe(true);
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([
            "notes/allowed.md",
        ]);
        expect(result.sources.map((source: { path: string }) => source.path)).toEqual([
            "notes/allowed.md",
        ]);
    });

    it("uses the default-on graph policy and removes an unrankable path before Worker dispatch", async () => {
        const seedPath = "notes/seed.md";
        const blankPath = "notes/blank.md";
        const indexedPath = "notes/indexed.md";
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set([blankPath, indexedPath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "source-epoch-1";
                }
                return [directRawResult(seedPath)];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "source-epoch-1",
                paths: paths.map((path) => path === blankPath
                    ? { path, current: false, reason: "generation_unavailable" }
                    : {
                        path,
                        generation: `generation:${path}`,
                        current: true,
                        reason: "current",
                    }),
            }),
            rankGraphCandidates: async (_embedding, paths, control) => ({
                requestId: control.requestId,
                runEpoch: control.runEpoch,
                sourceEpoch: control.sourceEpoch,
                paths: paths.map((path: string) => rankedPath(path, 0.8)),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);

        const result = await (tool as any).searchVss("graph currentness", undefined);

        expect(plugin.memorySearch.getPathEvidenceGenerations).toHaveBeenCalledWith(
            [blankPath, indexedPath],
            { signal: undefined, absoluteDeadlineMs: expect.any(Number) },
        );
        expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(1);
        expect(plugin.memorySearch.rankGraphCandidates.mock.calls[0]?.[1]).toEqual([indexedPath]);
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([
            seedPath,
            indexedPath,
        ]);
    });

    it("skips the Worker and keeps direct evidence when every graph path is unrankable", async () => {
        const seedPath = "notes/seed.md";
        const dirtyPath = "notes/dirty.md";
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set([dirtyPath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "source-epoch-1";
                }
                return [directRawResult(seedPath)];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "source-epoch-1",
                paths: paths.map((path) => path === dirtyPath
                    ? {
                        path,
                        generation: `stale:${path}`,
                        current: false,
                        reason: "dirty",
                    }
                    : {
                        path,
                        generation: `generation:${path}`,
                        current: true,
                        reason: "current",
                    }),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);

        const result = await (tool as any).searchVss("graph currentness", undefined);

        expect(plugin.memorySearch.getPathEvidenceGenerations).toHaveBeenCalledWith(
            [dirtyPath],
            { signal: undefined, absoluteDeadlineMs: expect.any(Number) },
        );
        expect(plugin.memorySearch.rankGraphCandidates).not.toHaveBeenCalled();
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([seedPath]);
    });

    it("fails the graph lane closed when path currentness observes another source epoch", async () => {
        const seedPath = "notes/seed.md";
        const graphPath = "notes/local.md";
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set([graphPath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "source-epoch-1";
                }
                return [directRawResult(seedPath)];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "source-epoch-2",
                paths: paths.map((path) => ({
                    path,
                    generation: `generation:${path}`,
                    current: true,
                    reason: "current",
                })),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);

        const result = await (tool as any).searchVss("graph currentness", undefined);

        expect(plugin.memorySearch.getPathEvidenceGenerations).toHaveBeenCalledWith(
            [graphPath],
            { signal: undefined, absoluteDeadlineMs: expect.any(Number) },
        );
        expect(plugin.memorySearch.rankGraphCandidates).not.toHaveBeenCalled();
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([seedPath]);
    });

    it("drops the whole graph lane when the sealed graph epoch changes during live fingerprinting", async () => {
        const seedPath = "notes/seed.md";
        const candidatePath = "notes/local.md";
        let graphEpoch = "graph-epoch-1";
        const graphBoundarySource = {
            getEpoch: () => graphEpoch,
            resolvedLinks: new Map([[seedPath, new Set([candidatePath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true, relaxedRecovery: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: `new-${path}`,
                    current: true,
                    reason: "current",
                })),
            }),
            rankGraphCandidates: async (_embedding, paths, control) => ({
                requestId: control.requestId,
                runEpoch: control.runEpoch,
                sourceEpoch: control.sourceEpoch,
                paths: paths.map((path: string) => ({
                    path,
                    pathEvidenceGeneration: `new-${path}`,
                    maxScore: 0.8,
                    chunks: [{
                        chunkIndex: 0,
                        score: 0.8,
                        doc: {
                            pageContent: `content:${path}`,
                            metadata: {
                                path,
                                chunkIndex: 0,
                                pathEvidenceGeneration: `new-${path}`,
                            },
                        },
                    }],
                })),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        (tool as any).materializeLatestCandidate = jest.fn(async (candidate: { path: string }) => {
            if (candidate.path === candidatePath) graphEpoch = "graph-epoch-2";
            return candidate;
        });
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: {
                    ftsQueryOverride: "launch",
                    temporalIntent: "none",
                    temporalFilter: null,
                },
                rejectedEvidence: [{
                    path: seedPath,
                    pathEvidenceGeneration: "old-seed",
                    evidenceFingerprints: ["old-seed-visible"],
                    origin: "direct",
                }, {
                    path: candidatePath,
                    pathEvidenceGeneration: "old-local",
                    evidenceFingerprints: ["different-visible-fingerprint"],
                    origin: "graph",
                }],
                queryEmbedding: {
                    value: [0.1, 0.2],
                    profileSignature: "profile-v1",
                    sourceEpoch: "epoch-1",
                },
            }, {
                runEpoch: "run-epoch",
                absoluteDeadlineMs: Date.now() + 5_000,
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(1);
        expect(result.candidates).toEqual([]);
        expect(result.sources).toEqual([]);
    });

    it("refills a Local lane past changed-generation visible repeats before graph allocation", async () => {
        const repeatedPaths = Array.from({ length: 12 }, (_, index) => `notes/repeat-${index.toString().padStart(2, "0")}.md`);
        const freshPath = "notes/fresh-13.md";
        const seedPath = "notes/seed.md";
        const allLocalPaths = [...repeatedPaths, freshPath];
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set(allLocalPaths)]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true, relaxedRecovery: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: `new-${path}`,
                    contentHash: `hash-${path}`,
                    mtime: 1,
                    size: 1,
                    current: true,
                    reason: "current",
                })),
            }),
            rankGraphCandidates: async (_embedding, paths, control) => ({
                requestId: control.requestId,
                runEpoch: control.runEpoch,
                sourceEpoch: control.sourceEpoch,
                paths: paths.map((path: string) => {
                    const content = `content:${path}`;
                    const repeatedIndex = repeatedPaths.indexOf(path);
                    const score = repeatedIndex >= 0 ? 0.9 - repeatedIndex / 100 : 0.4;
                    return {
                        path,
                        pathEvidenceGeneration: `new-${path}`,
                        maxScore: score,
                        chunks: [{
                            chunkIndex: 0,
                            score,
                            doc: {
                                pageContent: content,
                                metadata: {
                                    path,
                                    chunkIndex: 0,
                                    pathEvidenceGeneration: `new-${path}`,
                                },
                            },
                        }],
                    };
                }),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        const controller = new AbortController();
        const result = await runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: {
                    ftsQueryOverride: "launch",
                    temporalIntent: "none",
                    temporalFilter: null,
                },
                rejectedEvidence: [
                    {
                        path: seedPath,
                        pathEvidenceGeneration: "old-seed",
                        evidenceFingerprints: ["old-seed-visible"],
                        origin: "direct",
                    },
                    ...repeatedPaths.map((path) => ({
                        path,
                        pathEvidenceGeneration: `old-${path}`,
                        evidenceFingerprints: [visibleFingerprint(path, `content:${path}`)],
                        origin: "graph" as const,
                    })),
                ],
                queryEmbedding: {
                    value: [0.1, 0.2],
                    profileSignature: "profile-v1",
                    sourceEpoch: "epoch-1",
                },
            }, {
                runEpoch: "run-1",
                absoluteDeadlineMs: Date.now() + 5_000,
            }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(1);
        expect(plugin.memorySearch.rankGraphCandidates.mock.calls[0]?.[1]).toEqual([...allLocalPaths].sort());
        expect(result.candidates?.map((candidate: { path: string }) => candidate.path)).toEqual([freshPath]);
        expect(result.sources.map((source: { path: string }) => source.path)).toEqual([freshPath]);
    });

    it("keeps high-cosine graph evidence when a complete Worker response also contains a low path", async () => {
        const seedPath = "notes/seed.md";
        const highPath = "notes/high.md";
        const lowPath = "notes/low.md";
        const mixedScoreDeadlineMs = Date.now() + 5_000;
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set([highPath, lowPath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true, relaxedRecovery: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: `generation:${path}`,
                    current: true,
                    reason: "current",
                })),
            }),
            rankGraphCandidates: async (_embedding, paths, control) => ({
                requestId: control.requestId,
                runEpoch: control.runEpoch,
                sourceEpoch: control.sourceEpoch,
                paths: paths.map((path: string) => rankedPath(
                    path,
                    path === highPath ? 0.8 : 0.005,
                )),
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: { ftsQueryOverride: "launch", temporalIntent: "none", temporalFilter: null },
                rejectedEvidence: [{
                    path: seedPath,
                    pathEvidenceGeneration: `generation:${seedPath}`,
                    evidenceFingerprints: ["seed-visible"],
                    origin: "direct",
                }],
                queryEmbedding: { value: [0.1, 0.2], profileSignature: "profile-v1", sourceEpoch: "epoch-1" },
            }, { runEpoch: "mixed-score", absoluteDeadlineMs: mixedScoreDeadlineMs }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(1);
        expect(plugin.memorySearch.searchHybrid.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            absoluteDeadlineMs: mixedScoreDeadlineMs,
        }));
        expect(plugin.memorySearch.getPathEvidenceGenerations.mock.calls.length).toBeGreaterThan(0);
        for (const call of plugin.memorySearch.getPathEvidenceGenerations.mock.calls) {
            expect(call[1]).toEqual(expect.objectContaining({ absoluteDeadlineMs: mixedScoreDeadlineMs }));
        }
        expect(result.candidates?.map((candidate: { path: string }) => candidate.path)).toEqual([highPath]);
    });

    it("cancels and discards graph work when graphPpr is disabled during the Worker request", async () => {
        const seedPath = "notes/seed.md";
        const candidatePath = "notes/high.md";
        let resolveRank: (() => void) | undefined;
        let workerSignal: AbortSignal | undefined;
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set([candidatePath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin, notifySettingsChanged } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true, relaxedRecovery: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: `generation:${path}`,
                    current: true,
                    reason: "current",
                })),
            }),
            rankGraphCandidates: (_embedding, paths, control, options) => new Promise((resolve) => {
                workerSignal = options?.signal;
                resolveRank = () => resolve({
                    requestId: control.requestId,
                    runEpoch: control.runEpoch,
                    sourceEpoch: control.sourceEpoch,
                    paths: paths.map((path: string) => rankedPath(path, 0.8)),
                });
            }),
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        const controller = new AbortController();

        let settled = false;
        const resultPromise = runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: { ftsQueryOverride: "launch", temporalIntent: "none", temporalFilter: null },
                rejectedEvidence: [{
                    path: seedPath,
                    pathEvidenceGeneration: `generation:${seedPath}`,
                    evidenceFingerprints: ["seed-visible"],
                    origin: "direct",
                }],
                queryEmbedding: { value: [0.1, 0.2], profileSignature: "profile-v1", sourceEpoch: "epoch-1" },
            }, { runEpoch: "flag-off", absoluteDeadlineMs: Date.now() + 5_000 }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );
        void resultPromise.then(
            () => { settled = true; },
            () => { settled = true; },
        );
        await waitForMockCall(plugin.memorySearch.rankGraphCandidates);

        plugin.settings.retrievalOptimizationFlags!.graphPpr = false;
        await notifySettingsChanged();
        await Promise.resolve();

        expect(plugin.memorySearch.cancelGraphCandidateRank).toHaveBeenCalledTimes(1);
        expect(plugin.memorySearch.getChunksByPath).not.toHaveBeenCalled();
        expect(workerSignal?.aborted).toBe(true);
        expect(settled).toBe(false);

        resolveRank?.();
        const result = await resultPromise;

        expect(result.candidates).toEqual([]);
        expect((tool as any).activeGraphRankRequests.size).toBe(0);
    });

    it("cancels exactly one dispatched Chat graph Worker without duplicating its abort terminal", async () => {
        const querySentinel = "private cancellation probe query";
        const seedPath = "notes/private-seed.md";
        const candidatePath = "notes/private-candidate.md";
        let workerSignal: AbortSignal | undefined;
        let workerRequestPosted = false;
        let finishQueueReleaseProbe: (() => void) | undefined;
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-probe",
            resolvedLinks: new Map([[seedPath, new Set([candidatePath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const diagnostics = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => "cancellation-probe-session",
        );
        const diagnosticSession = diagnostics.start();
        const binding = diagnostics.bindSurface("chat");
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "source-epoch-probe";
                }
                return [directRawResult(seedPath)];
            },
            getChunksByPath: ({ paths, options }) => new Promise((resolve) => {
                expect(paths).toEqual([candidatePath]);
                expect(options?.limitPerPath).toBe(1);
                expect(options?.signal?.aborted).toBe(false);
                finishQueueReleaseProbe = () => resolve([directRawResult(candidatePath)]);
            }),
            rankGraphCandidates: (_embedding, _paths, _control, options) => new Promise((_resolve, reject) => {
                workerSignal = options.signal;
                options.onDiagnostic?.({ state: "dispatched", queueWaitMs: 0 });
                queueMicrotask(() => { workerRequestPosted = true; });
                const rejectAborted = () => {
                    expect(workerRequestPosted).toBe(true);
                    options.onDiagnostic?.({ state: "cancel_requested", accepted: 0 });
                    reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
                    queueMicrotask(() => {
                        options.onDiagnostic?.({ state: "cancel_observed", accepted: 0 });
                        options.onDiagnostic?.({ state: "late_discarded", accepted: 0 });
                        finishQueueReleaseProbe?.();
                    });
                };
                if (options.signal?.aborted) rejectAborted();
                else options.signal?.addEventListener("abort", rejectAborted, { once: true });
            }),
        });
        Object.assign(plugin, {
            createRetrievalDiagnosticRecorder: binding.createRecorder,
            scheduleArmedGraphWorkerCancellation: binding.scheduleArmedGraphWorkerCancellation,
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        diagnostics.armCancellationProbe(diagnosticSession.sessionId);

        const result = await (tool as any).searchVss(querySentinel, undefined);
        await Promise.resolve();

        expect(workerSignal?.aborted).toBe(true);
        expect(plugin.memorySearch.cancelGraphCandidateRank).toHaveBeenCalledTimes(1);
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([seedPath]);
        const snapshot = diagnostics.snapshot(diagnosticSession.sessionId);
        const workerEvents = snapshot.events.filter((event) => event.phase === "graph_worker");
        expect(workerEvents.map((event) => [event.outcome, event.reason])).toEqual([
            ["started", undefined],
            ["aborted", "cancel_requested"],
            ["aborted", "cancel_observed"],
            ["late_discarded", "late_result"],
        ]);
        expect(plugin.memorySearch.getChunksByPath).toHaveBeenCalledTimes(1);
        const queueReleaseEvents = snapshot.events.filter((event) => event.phase === "queue_release");
        expect(queueReleaseEvents.map((event) => [event.outcome, event.reason])).toEqual([
            ["started", undefined],
            ["completed", undefined],
        ]);
        expect(queueReleaseEvents[1]?.metrics).toMatchObject({
            resultCount: 1,
        });
        const requestedSequence = workerEvents.find((event) => event.reason === "cancel_requested")!.sequence;
        const observedSequence = workerEvents.find((event) => event.reason === "cancel_observed")!.sequence;
        const lateSequence = workerEvents.find((event) => event.reason === "late_result")!.sequence;
        expect(requestedSequence).toBeLessThan(queueReleaseEvents[0]!.sequence);
        expect(queueReleaseEvents[0]!.sequence).toBeLessThan(observedSequence);
        expect(observedSequence).toBeLessThan(lateSequence);
        expect(lateSequence).toBeLessThan(queueReleaseEvents[1]!.sequence);
        expect(snapshot.events).toContainEqual(expect.objectContaining({
            phase: "memory_search",
            outcome: "completed",
        }));
        expect(JSON.stringify(snapshot)).not.toContain(querySentinel);
        expect(JSON.stringify(snapshot)).not.toContain(seedPath);
        expect(JSON.stringify(snapshot)).not.toContain(candidatePath);
    });

    it.each([
        ["empty", async () => [] as unknown[], "queue_release_empty"],
        ["error", async () => { throw new Error("lookup failed"); }, "queue_release_error"],
    ] as const)("fails closed when the queue-release probe returns %s", async (
        _case,
        getChunksByPath,
        expectedReason,
    ) => {
        const diagnostics = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => `queue-release-${expectedReason}`,
        );
        const identity = diagnostics.start();
        const { plugin } = makePlugin({
            policyModelName: "",
            getChunksByPath: async () => getChunksByPath(),
            isDataBoundaryAllowedPath: () => true,
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);

        await (tool as any).runGraphQueueReleaseProbe(
            "notes/current-indexed.md",
            diagnostics.createRecorder("chat"),
        );

        const events = diagnostics.snapshot(identity.sessionId).events;
        expect(events.map((event) => [event.phase, event.outcome, event.reason])).toEqual([
            ["queue_release", "started", undefined],
            ["queue_release", "failed", expectedReason],
        ]);
        expect(events[1]?.metrics.resultCount).toBe(0);
        expect(JSON.stringify(events)).not.toContain("current-indexed.md");
    });

    it("fails closed when the queue-release probe exceeds the absolute Graph envelope", async () => {
        jest.useFakeTimers();
        try {
            const diagnostics = new RetrievalDiagnosticsController(
                () => 0,
                () => 0,
                () => "queue-release-timeout",
            );
            const identity = diagnostics.start();
            let probeSignal: AbortSignal | undefined;
            const { plugin } = makePlugin({
                policyModelName: "",
                getChunksByPath: ({ options }) => {
                    probeSignal = options?.signal;
                    return new Promise(() => undefined);
                },
                isDataBoundaryAllowedPath: () => true,
            });
            const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
            const pending = (tool as any).runGraphQueueReleaseProbe(
                "notes/current-indexed.md",
                diagnostics.createRecorder("chat"),
            );

            await jest.advanceTimersByTimeAsync(RETRIEVAL_CALIBRATION_PROFILE.graph.budgetMs);
            await pending;

            expect(probeSignal?.aborted).toBe(true);
            const events = diagnostics.snapshot(identity.sessionId).events;
            expect(events.map((event) => [event.outcome, event.reason])).toEqual([
                ["started", undefined],
                ["deadline", "queue_release_timeout"],
            ]);
            expect(events[1]?.metrics.resultCount).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it("drops the complete graph lane when an early exact-repeat path changes during Worker work", async () => {
        const seedPath = "notes/seed.md";
        const repeatPath = "notes/repeat.md";
        const freshPath = "notes/fresh.md";
        let repeatChanged = false;
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-1",
            resolvedLinks: new Map([[seedPath, new Set([repeatPath, freshPath])]]),
            classifyPath: () => "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true, relaxedRecovery: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "epoch-1";
                }
                return [];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: path === repeatPath && repeatChanged
                        ? "generation:repeat:changed"
                        : `generation:${path}`,
                    current: true,
                    reason: "current",
                })),
            }),
            rankGraphCandidates: async (_embedding, paths, control) => {
                repeatChanged = true;
                return {
                    requestId: control.requestId,
                    runEpoch: control.runEpoch,
                    sourceEpoch: control.sourceEpoch,
                    paths: paths.map((path: string) => rankedPath(path, 0.8)),
                };
            },
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createRelaxedMemorySearchInvocation({
                query: "launch",
                lexicalPlan: { ftsQueryOverride: "launch", temporalIntent: "none", temporalFilter: null },
                rejectedEvidence: [seedPath, repeatPath].map((path) => ({
                    path,
                    pathEvidenceGeneration: `generation:${path}`,
                    evidenceFingerprints: [`visible:${path}`],
                    origin: "direct" as const,
                })),
                queryEmbedding: { value: [0.1, 0.2], profileSignature: "profile-v1", sourceEpoch: "epoch-1" },
            }, { runEpoch: "repeat-drift", absoluteDeadlineMs: Date.now() + 5_000 }),
            controller.signal,
            () => tool.search("launch", controller.signal),
        );

        expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(1);
        expect(result.candidates).toEqual([]);
    });

    it("uses one opaque bridge only as topology while recalling the allowed path beyond it", async () => {
        const seedPath = "notes/a.md";
        const opaquePath = "excluded/b.md";
        const recalledPath = "notes/c.md";
        const opaqueMarker = "OPAQUE-BRIDGE-MUST-NEVER-ESCAPE";
        const graphBoundarySource = {
            getEpoch: () => "graph-epoch-bridge",
            resolvedLinks: new Map([
                [seedPath, new Set([opaquePath])],
                [opaquePath, new Set([recalledPath])],
            ]),
            classifyPath: (path: string) => path === opaquePath
                ? "opaque_excluded_markdown" as const
                : "allowed_markdown" as const,
            canonicalizePath: (path: string) => path,
        };
        const rerankerInputs: unknown[] = [];
        const aiUtils = {
            createChatModel: jest.fn(async () => RunnableLambda.from(async (input: unknown) => {
                rerankerInputs.push(input);
                return {
                    content: JSON.stringify({
                        verdict: "partially_relevant",
                        ranking: [0, 1],
                        needsMoreEvidence: true,
                    }),
                };
            })),
            cleanMarkdownContent: jest.fn((content: string) => content),
            hashContent: jest.fn(async (content: string) => `hash:${content}`),
        };
        const { plugin } = makePlugin({
            policyModelName: "",
            chatModelName: "chat-model",
            retrievalOptimizationFlags: {
                strictReranker: true,
                graphPpr: true,
                relaxedRecovery: true,
            },
            graphBoundarySource,
            isDataBoundaryAllowedPath: (path) => path !== opaquePath,
            searchHybrid: async ({ options }) => {
                if (options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "source-epoch-1";
                }
                return [anchoredRawResult(seedPath, "Allowed seed evidence", 0.95)];
            },
            getPathEvidenceGenerations: async (paths) => ({
                sourceEpoch: "source-epoch-1",
                paths: paths.map((path) => ({
                    path,
                    generation: `generation:${path}`,
                    current: true,
                    reason: "current",
                })),
            }),
            rankGraphCandidates: async (_embedding, paths, control) => ({
                requestId: control.requestId,
                runEpoch: control.runEpoch,
                sourceEpoch: control.sourceEpoch,
                paths: paths.map((path: string) => anchoredRankedPath(
                    path,
                    "Allowed recalled evidence",
                    0.82,
                )),
            }),
        });
        const readLatestMemorySource = jest.fn(async (path: string) => ({
            path,
            markdown: path === opaquePath
                ? opaqueMarker
                : path === seedPath ? "Allowed seed evidence" : "Allowed recalled evidence",
            mtime: 1,
            size: 100,
        }));
        (plugin as any).readLatestMemorySource = readLatestMemorySource;
        const tool = new MemorySearchTool(plugin as any, aiUtils as any);
        const controller = new AbortController();

        const result = await runWithMemorySearchInvocation(
            createStandardMemorySearchInvocation({
                temporalIntent: "none",
                captureRecoverySeed: true,
                runEpoch: "opaque-bridge-run",
                absoluteDeadlineMs: Date.now() + 5_000,
            }),
            controller.signal,
            () => tool.search("bridge evidence", controller.signal),
        );
        const observation = projectMemorySearchObservation(result);
        const workerPaths = plugin.memorySearch.rankGraphCandidates.mock.calls[0]?.[1] as string[];
        const providerPayload = JSON.stringify(rerankerInputs);
        const resultPayload = JSON.stringify(result);
        const observationPayload = JSON.stringify(observation);
        const logPayload = JSON.stringify(plugin.log.mock.calls);

        expect(workerPaths).toEqual([recalledPath]);
        expect(workerPaths).not.toContain(opaquePath);
        expect(readLatestMemorySource.mock.calls.map(([path]) => path)).not.toContain(opaquePath);
        expect(providerPayload).toContain(seedPath);
        expect(providerPayload).toContain(recalledPath);
        expect(providerPayload).not.toContain(opaquePath);
        expect(providerPayload).not.toContain(opaqueMarker);
        expect(result.candidates?.map((candidate: { path: string }) => candidate.path)).toEqual([
            seedPath,
            recalledPath,
        ]);
        expect(result.sources.map((source) => source.path)).toEqual([seedPath, recalledPath]);
        expect(result.recoverySeed?.rejectedEvidence.map((entry) => entry.path)).toEqual([
            seedPath,
            recalledPath,
        ]);
        expect(observation.sources.map((source) => source.path)).toEqual([seedPath, recalledPath]);
        for (const payload of [resultPayload, observationPayload, logPayload]) {
            expect(payload).not.toContain(opaquePath);
            expect(payload).not.toContain(opaqueMarker);
        }
        expect(observation).not.toHaveProperty("candidates");
        expect(observation).not.toHaveProperty("recoverySeed");
    });

    it("retains a complete Local lane when only the PPR solver fails", async () => {
        const seedPath = "notes/seed.md";
        const localPath = "notes/local.md";
        const deepPath = "notes/deep.md";
        const solve = jest.spyOn(personalizedPageRank, "solvePersonalizedPageRank")
            .mockResolvedValue({ converged: false, reason: "numeric_error" });
        try {
            const graphBoundarySource = {
                getEpoch: () => "graph-epoch-1",
                resolvedLinks: new Map([
                    [seedPath, new Set([localPath])],
                    [localPath, new Set([deepPath])],
                ]),
                classifyPath: () => "allowed_markdown" as const,
                canonicalizePath: (path: string) => path,
            };
            const { plugin } = makePlugin({
                policyModelName: "",
                retrievalOptimizationFlags: { graphPpr: true },
                graphBoundarySource,
                searchHybrid: async ({ options }) => {
                    if (options?.queryEmbeddingOut) {
                        options.queryEmbeddingOut.value = [0.1, 0.2];
                        options.queryEmbeddingOut.profileSignature = "profile-v1";
                        options.queryEmbeddingOut.sourceEpoch = "source-epoch-1";
                    }
                    return [directRawResult(seedPath)];
                },
                rankGraphCandidates: async (_embedding, paths, control) => ({
                    requestId: control.requestId,
                    runEpoch: control.runEpoch,
                    sourceEpoch: control.sourceEpoch,
                    paths: paths.map((path: string) => rankedPath(path, 0.8)),
                }),
            });
            const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
            isolateCandidateAssembly(tool);

            const result = await (tool as any).searchVss("local fallback", undefined);

            expect(solve).toHaveBeenCalledTimes(1);
            expect(plugin.memorySearch.rankGraphCandidates.mock.calls[0]?.[1]).toEqual([localPath]);
            expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([
                seedPath,
                localPath,
            ]);
            expect(result.candidates.map((candidate: { path: string }) => candidate.path)).not.toContain(deepPath);
        } finally {
            solve.mockRestore();
        }
    });

    it("keeps shared one-hop Convergence when the complete Local lane exceeds its budget", async () => {
        const seedOne = "notes/seed-one.md";
        const seedTwo = "notes/seed-two.md";
        const sharedPath = "notes/shared.md";
        const singleSupportPath = "notes/local-only.md";
        const overflowPaths = [
            sharedPath,
            singleSupportPath,
            ...Array.from(
                { length: RETRIEVAL_CALIBRATION_PROFILE.graph.maxLocalCandidatePaths - 1 },
                (_, index) => `notes/local-${index.toString().padStart(3, "0")}.md`,
            ),
        ];
        const diagnostics: RetrievalDiagnosticEventInput[] = [];
        const solve = jest.spyOn(personalizedPageRank, "solvePersonalizedPageRank")
            .mockImplementation(async (_graph, seedPath) => ({
                converged: true,
                scores: new Map(seedPath === seedOne
                    ? [[sharedPath, 0.4], [singleSupportPath, 0.5]]
                    : [[sharedPath, 0.35]]),
                iteration: 1,
                errorBound: 0.01,
            }));
        try {
            const graphBoundarySource = {
                getEpoch: () => "graph-epoch-1",
                resolvedLinks: new Map([
                    [seedOne, new Set(overflowPaths)],
                    [seedTwo, new Set([sharedPath])],
                ]),
                classifyPath: () => "allowed_markdown" as const,
                canonicalizePath: (path: string) => path,
            };
            const { plugin } = makePlugin({
                policyModelName: "",
                retrievalOptimizationFlags: { graphPpr: true },
                graphBoundarySource,
                recordRetrievalDiagnostic: (event) => diagnostics.push(event),
                searchHybrid: async ({ options }) => {
                    if (options?.queryEmbeddingOut) {
                        options.queryEmbeddingOut.value = [0.1, 0.2];
                        options.queryEmbeddingOut.profileSignature = "profile-v1";
                        options.queryEmbeddingOut.sourceEpoch = "source-epoch-1";
                    }
                    return [directRawResult(seedOne), directRawResult(seedTwo)];
                },
                rankGraphCandidates: async (_embedding, paths, control) => ({
                    requestId: control.requestId,
                    runEpoch: control.runEpoch,
                    sourceEpoch: control.sourceEpoch,
                    paths: paths.map((path: string) => rankedPath(path, 0.8)),
                }),
            });
            const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
            isolateCandidateAssembly(tool);

            const result = await (tool as any).searchVss("shared convergence", undefined);

            expect(diagnostics).toContainEqual(expect.objectContaining({
                phase: "graph_preflight",
                outcome: "fallback",
                reason: "local_budget",
            }));
            expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(1);
            expect(plugin.memorySearch.rankGraphCandidates.mock.calls[0]?.[1]).toEqual([sharedPath]);
            expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toContain(sharedPath);
            expect(result.candidates.map((candidate: { path: string }) => candidate.path))
                .not.toContain(singleSupportPath);
        } finally {
            solve.mockRestore();
        }
    });

    it.each([
        ["shared snapshot unavailable", "snapshot"],
        ["invocation embedding missing", "embedding"],
        ["Worker failure", "worker"],
    ] as const)("falls back to direct-only when %s", async (_label, failure) => {
        const seedPath = "notes/seed.md";
        const graphPath = "notes/local.md";
        const graphBoundarySource = failure === "snapshot"
            ? undefined
            : {
                getEpoch: () => "graph-epoch-1",
                resolvedLinks: new Map([[seedPath, new Set([graphPath])]]),
                classifyPath: () => "allowed_markdown" as const,
                canonicalizePath: (path: string) => path,
            };
        const { plugin } = makePlugin({
            policyModelName: "",
            retrievalOptimizationFlags: { graphPpr: true },
            graphBoundarySource,
            searchHybrid: async ({ options }) => {
                if (failure !== "embedding" && options?.queryEmbeddingOut) {
                    options.queryEmbeddingOut.value = [0.1, 0.2];
                    options.queryEmbeddingOut.profileSignature = "profile-v1";
                    options.queryEmbeddingOut.sourceEpoch = "source-epoch-1";
                }
                return [directRawResult(seedPath)];
            },
            rankGraphCandidates: failure === "worker"
                ? async () => { throw new Error("worker unavailable"); }
                : undefined,
        });
        const tool = new MemorySearchTool(plugin as any, makeAIUtils() as any);
        isolateCandidateAssembly(tool);

        const result = await (tool as any).searchVss("shared dependency failure", undefined);

        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).toEqual([seedPath]);
        expect(result.sources.map((source: { path: string }) => source.path)).toEqual([seedPath]);
        expect(result.candidates.map((candidate: { path: string }) => candidate.path)).not.toContain(graphPath);
        expect(plugin.memorySearch.rankGraphCandidates).toHaveBeenCalledTimes(failure === "worker" ? 1 : 0);
    });
});

function directRawResult(path: string) {
    return {
        score: 0.95,
        doc: {
            pageContent: `direct:${path}`,
            metadata: { path, chunkIndex: 0 },
        },
    };
}

function anchoredRawResult(path: string, markdown: string, score: number) {
    const contentHash = `hash:${markdown}`;
    const chunk = createHeadingAwareMarkdownChunks({
        path,
        markdown,
        contentHash,
        created: 1,
        lastModified: 1,
    })[0];
    if (!chunk) throw new Error(`Expected one anchored chunk for ${path}`);
    return {
        score,
        doc: {
            pageContent: chunk.content,
            metadata: {
                ...chunk.metadata,
                path,
                chunkIndex: chunk.chunkIndex,
                contentHash,
            },
        },
    };
}

function anchoredRankedPath(path: string, markdown: string, score: number) {
    const raw = anchoredRawResult(path, markdown, score);
    return {
        path,
        pathEvidenceGeneration: `generation:${path}`,
        maxScore: score,
        chunks: [{
            chunkIndex: raw.doc.metadata.chunkIndex,
            score,
            doc: {
                ...raw.doc,
                metadata: {
                    ...raw.doc.metadata,
                    pathEvidenceGeneration: `generation:${path}`,
                },
            },
        }],
    };
}

function rankedPath(path: string, score: number) {
    return {
        path,
        pathEvidenceGeneration: `generation:${path}`,
        maxScore: score,
        chunks: [{
            chunkIndex: 0,
            score,
            doc: {
                pageContent: `content:${path}`,
                metadata: {
                    path,
                    chunkIndex: 0,
                    pathEvidenceGeneration: `generation:${path}`,
                },
            },
        }],
    };
}

function visibleFingerprint(path: string, content: string): string {
    return JSON.stringify({
        path,
        excerpt: content,
        visible: [{
            path,
            chunkIndex: 0,
            content,
            contentHash: null,
            startLine: null,
            endLine: null,
            headingPath: [],
            indexVersion: null,
        }],
        representationVersion: 1,
    });
}

async function waitForMockCall(mock: jest.Mock): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (mock.mock.calls.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Expected mock call was not observed.");
}
