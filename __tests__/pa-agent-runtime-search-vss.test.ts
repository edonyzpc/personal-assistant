import { describe, expect, it, jest, beforeEach } from "@jest/globals";

import { MemorySearchTool } from "../src/ai-services/pa-agent-runtime";
import type { RewrittenQuery } from "../src/ai-services/query-rewriter";

// Minimal plugin / AIUtils stubs for the searchVss contract tests. We do NOT
// boot a full PaAgentRuntime — searchVss only needs:
//   - plugin.settings.policyModelName    (controls rewrite branch)
//   - plugin.vss.searchHybrid            (assertion target)
//   - plugin.memoryManager.ensureReadyForChat (only when calling search())
//   - aiUtils.createChatModel            (rewrite path; never reached when
//                                         policyModelName is empty)

interface SearchHybridArgs {
    prompt: string;
    options?: {
        ftsQueryOverride?: string | null;
        ftsQueryOverridePromise?: Promise<string | null>;
        temporalFilterPromise?: Promise<{ since?: number; until?: number } | null>;
        signal?: AbortSignal;
    };
}

function makePlugin(opts: {
    policyModelName: string;
    searchHybrid?: (args: SearchHybridArgs) => Promise<unknown>;
}) {
    const calls: SearchHybridArgs[] = [];
    const searchHybrid = opts.searchHybrid
        ?? (async () => []);
    const plugin = {
        settings: {
            policyModelName: opts.policyModelName,
        },
        vss: {
            searchHybrid: jest.fn(async (prompt: string, options?: SearchHybridArgs["options"]) => {
                calls.push({ prompt, options });
                return searchHybrid({ prompt, options });
            }),
        },
        memoryManager: {
            ensureReadyForChat: jest.fn(async () => ({ decision: "use-memory" as const })),
        },
    };
    return { plugin, calls };
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
    };
}

describe("MemorySearchTool searchVss contract", () => {
    beforeEach(() => {
        jest.useRealTimers();
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
        expect(result).toEqual({
            usedMemory: false,
            query: "longer query phrase",
            documents: [],
            sources: [],
            candidates: [],
            hasAnswerableContent: false,
            needsSnippetFollowup: false,
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
});
