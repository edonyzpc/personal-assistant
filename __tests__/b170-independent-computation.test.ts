import { describe, expect, it, jest } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { AIMessageChunk } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";

import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import { formatPlannerToolDefinitions, PaAgentRuntime } from "../src/ai-services/pa-agent-runtime";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import {
    createExecuteCodeTool,
    EXECUTE_CODE_TIMEOUT_MS,
    EXECUTE_CODE_TOOL_NAME,
} from "../src/ai-services/independent-computation/capability";
import { browserLauncher } from "../src/ai-services/independent-computation/browser-launcher";
import { CodemodeSandboxBase } from "../src/third_party/pi-codemode/runtime/execution";
import { inlineLauncher } from "../src/third_party/pi-codemode/runtime/inline";
import type { VmStartData } from "../src/third_party/pi-codemode/runtime/protocol";

jest.mock("obsidian");

const quickJsWasm = (async () => WebAssembly.compile(
    await readFile("node_modules/quickjs-wasi/quickjs.wasm"),
))();

class MockWorker {
    static instances: MockWorker[] = [];
    static responder: ((worker: MockWorker, message: unknown) => void) | undefined;
    readonly listeners = new Map<string, Array<(event: unknown) => void>>();
    terminated = false;

    constructor(
        readonly url: string,
        readonly options: WorkerOptions | undefined,
    ) {
        MockWorker.instances.push(this);
        const respond = MockWorker.responder;
        if (respond) mockWorkerResponders.set(this, respond);
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: unknown) => void) {
        const listeners = this.listeners.get(type) ?? [];
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
    }

    postMessage(message: unknown) {
        const respond = mockWorkerResponders.get(this);
        if (!this.terminated && respond) queueMicrotask(() => respond(this, message));
    }

    terminate() {
        this.terminated = true;
    }

    dispatch(type: string, event: unknown) {
        for (const listener of [...this.listeners.get(type) ?? []]) listener(event);
    }
}

const mockWorkerResponders = new WeakMap<MockWorker, (worker: MockWorker, message: unknown) => void>();

function installMockWorker(respond: (worker: MockWorker, message: unknown) => void) {
    MockWorker.instances = [];
    MockWorker.responder = respond;
    const originalWorker = globalThis.Worker;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    return () => {
        MockWorker.responder = undefined;
        globalThis.Worker = originalWorker;
    };
}

function host(): AiServiceHost {
    return {
        settings: {
            debug: false,
            aiProvider: "qwen",
            baseURL: "https://example.invalid",
            chatModelName: "test-model",
            policyModelName: "",
            embeddingModelName: "",
            shareAnonymousCapabilityUsage: false,
            qwenThinkingEnabled: false,
            webSearchEnabled: false,
            memoryEnabled: false,
            licenseTier: "paid",
            operationsAgentEnabled: false,
        },
        app: {
            workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
            metadataCache: { getFileCache: () => null, getCache: () => null },
        },
        memorySearch: {
            ensureReadyForChat: async () => ({ decision: "answer-now" }),
            searchHybrid: async () => [],
        },
        getMemoryEvidenceEpoch: () => "b170-synthetic-epoch",
        getAPIToken: async () => "synthetic-token",
        log: () => undefined,
        isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: () => undefined,
    } as unknown as AiServiceHost;
}

describe("B-170 independent computation", () => {
    it("runs real QuickJS with Date, arithmetic, JSON, no PA tools, and no cross-call state", async () => {
        const sandbox = new CodemodeSandboxBase({
            timeoutMs: 5_000,
            memoryLimitBytes: 64 * 1024 * 1024,
        }, inlineLauncher(await quickJsWasm, 1_000_000));
        const first = await sandbox.execute("store('answer', 41); return load('answer') + 1;");
        expect(first).toMatchObject({
            ok: true,
            value: 42,
            storeWrites: { set: { answer: 41 }, delete: [] },
        });
        await sandbox.close();

        const secondSandbox = new CodemodeSandboxBase({
            timeoutMs: 5_000,
            memoryLimitBytes: 64 * 1024 * 1024,
        }, inlineLauncher(await quickJsWasm, 1_000_000));
        const result = await secondSandbox.execute(`
            if (load('answer') !== undefined) {
                return 'state-leaked';
            }
            const values = [3, 1, 2].sort((a, b) => a - b).map(n => n * 2);
            const parsed = JSON.parse('{"total":6}');
            const due = new Date(Date.UTC(2026, 9, 11) + 3 * 24 * 60 * 60 * 1000);
            text('computed');
            return {
                now: Date.now(),
                offset: new Date(0).getTimezoneOffset(),
                dueDay: due.getUTCDate(),
                values,
                total: parsed.total,
                toolNames: Object.keys(tools),
                allTools: ALL_TOOLS,
                fetchType: typeof fetch,
                intlType: typeof Intl
            };
        `);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        expect(result.value).toEqual({
            now: expect.any(Number),
            offset: new Date(0).getTimezoneOffset(),
            dueDay: 14,
            values: [2, 4, 6],
            total: 6,
            toolNames: [],
            allTools: [],
            fetchType: "undefined",
            intlType: "undefined",
        });
        expect(result.output).toEqual([{ type: "text", text: "computed" }]);
        expect(result.calls).toEqual([]);
        await secondSandbox.close();
    });

    it("reports an actual engine timeout and disposes the VM", async () => {
        const sandbox = new CodemodeSandboxBase({
            timeoutMs: 100,
            memoryLimitBytes: 64 * 1024 * 1024,
        }, inlineLauncher(await quickJsWasm, 100));
        const result = await sandbox.execute("while (true) {}", { timeoutMs: 100 });

        expect(result).toMatchObject({
            ok: false,
            error: { kind: "timeout" },
        });
        await sandbox.close();
    });

    it("terminates and detaches one Worker, then ignores late VM messages", async () => {
        const restoreWorker = installMockWorker(() => undefined);
        const originalRevokeObjectURL = URL.revokeObjectURL;
        const revoked: string[] = [];
        URL.revokeObjectURL = (url: string) => { revoked.push(url); };
        const messages: unknown[] = [];
        try {
            const startData: VmStartData = {
                code: "return 1",
                tools: [],
                globals: [],
                memoryLimitBytes: 64 * 1024 * 1024,
                store: {},
            };
            const channel = await browserLauncher()(startData, {
                message: message => messages.push(message),
                failure: error => messages.push(error),
            });
            expect(MockWorker.instances).toHaveLength(1);
            await channel.stop();
            const worker = MockWorker.instances[0];
            expect(worker.terminated).toBe(true);
            expect(revoked).toEqual([worker.url]);
            worker.dispatch("message", { data: { type: "done", ok: true, value: "late", writes: "[]" } });
            expect(messages).toEqual([]);
            await channel.stop();
            expect(revoked).toHaveLength(1);
        } finally {
            URL.revokeObjectURL = originalRevokeObjectURL;
            restoreWorker();
        }
    });

    it("registers the normal tool schema and executes a structured Worker result", async () => {
        const registry = new CapabilityRegistry();
        registry.register(createChatToolCapability(createExecuteCodeTool(), {
            providerId: "test-independent-computation",
            timeoutMs: EXECUTE_CODE_TIMEOUT_MS,
        }));
        const definition = registry.getDefinition(EXECUTE_CODE_TOOL_NAME);
        expect(definition?.inputSchema.required).toEqual(["code"]);
        expect(formatPlannerToolDefinitions(definition ? [definition] : []))
            .toContain(JSON.stringify({ name: EXECUTE_CODE_TOOL_NAME, planner_guidance: definition?.plannerGuidance }));
        expect(registry.get(EXECUTE_CODE_TOOL_NAME)?.timeoutMs).toBe(120_000);
        expect(() => createExecuteCodeTool().validateInput({ code: "" }))
            .toThrow("code:string is required.");

        MockWorker.instances = [];
        const expired = await createExecuteCodeTool().execute({ code: "return 1" }, {
            host: host(),
            outerToolDeadlineAt: Date.now() - 1,
        });
        expect(expired).toMatchObject({
            ok: false,
            executionState: "not_started",
            error: "Independent code execution deadline expired before Worker initialization.",
        });
        expect(MockWorker.instances).toHaveLength(0);

        const restoreWorker = installMockWorker((worker, message) => {
            if ((message as { type?: string }).type !== "start") return;
            worker.dispatch("message", {
                data: { type: "done", ok: true, value: JSON.stringify({ answer: 6 }), writes: "[]" },
            });
        });
        try {
            const result = await createExecuteCodeTool().execute({ code: "return {answer: 3*2}" }, {
                host: host(),
            });
            expect(result).toMatchObject({
                ok: true,
                tool: EXECUTE_CODE_TOOL_NAME,
                inputSummary: "code:20 chars",
                content: {
                    value: { answer: 6 },
                    output: [],
                    calls: [],
                },
                sources: [],
            });
        } finally {
            restoreWorker();
        }
    });

    it("rejects image output without shipping image data", async () => {
        const restoreWorker = installMockWorker((worker, message) => {
            if ((message as { type?: string }).type !== "start") return;
            worker.dispatch("message", {
                data: {
                    type: "output",
                    item: { type: "image", data: "aW1hZ2UtZGF0YQ==", mimeType: "image/png" },
                },
            });
            worker.dispatch("message", {
                data: { type: "done", ok: true, value: "null", writes: "[]" },
            });
        });
        try {
            const result = await createExecuteCodeTool().execute({ code: "image('data:image/png;base64,aW1hZ2UtZGF0YQ==')" }, {
                host: host(),
            });
            expect(result).toMatchObject({
                ok: false,
                failureReason: "adapter_error",
                executionState: "failed",
                content: null,
            });
            expect(result.error).toContain("image output");
            expect(JSON.stringify(result)).not.toContain("aW1hZ2UtZGF0YQ==");
            expect(JSON.stringify(result)).not.toContain("image/png");
        } finally {
            restoreWorker();
        }
    });

    it("bounds Worker initialization and computation by an inherited earlier deadline", async () => {
        jest.useFakeTimers();
        const restoreWorker = installMockWorker(() => undefined);
        try {
            const outerToolDeadlineAt = Date.now() + 5;
            const pending = createExecuteCodeTool().execute({ code: "while (true) {}" }, {
                host: host(),
                outerToolDeadlineAt,
            });
            await jest.advanceTimersByTimeAsync(5);
            const result = await pending;

            expect(result).toMatchObject({
                ok: false,
                failureReason: "timeout",
                executionState: "failed",
            });
            expect(result.error).toContain("timed out after 5 ms");
            expect(result.error).not.toContain("120000");
        } finally {
            jest.useRealTimers();
            restoreWorker();
        }
    });

    it("exposes execute_code in a Web-only run and preserves input lineage", async () => {
        const restoreWorker = installMockWorker((worker, message) => {
            if ((message as { type?: string }).type !== "start") return;
            worker.dispatch("message", {
                data: { type: "done", ok: true, value: "7", writes: "[]" },
            });
        });
        const inputLineage = completeInputLineage([{ kind: "user-text", messageId: "b170-user" }]);
        const boundTools: string[][] = [];
        let modelTurn = 0;
        const boundModel = RunnableLambda.from(async function* () {
            modelTurn += 1;
            if (modelTurn === 1) {
                yield new AIMessageChunk({
                    content: "",
                    tool_call_chunks: [{
                        id: "b170-execute-code",
                        index: 0,
                        name: EXECUTE_CODE_TOOL_NAME,
                        args: JSON.stringify({ code: "return 7" }),
                    }],
                });
            } else {
                yield new AIMessageChunk({ content: "Computed." });
            }
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: modelTurn === 1 ? "tool_calls" : "stop" } });
        });
        const model = {
            bindTools: jest.fn((schemas: Array<{ function: { name: string } }>) => {
                boundTools.push(schemas.map(schema => schema.function.name));
                return boundModel;
            }),
        };
        const runtime = new PaAgentRuntime(host(), { createChatModel: async () => model } as never, {
            skillContextProvider: null,
        });
        const lifecycle: Array<{ type: string; message?: { role: string; toolName?: string; inputLineage?: unknown } }> = [];
        try {
            await runtime.streamTurn({
                prompt: "Compute 7 without note sources.",
                userText: "Compute 7 without note sources.",
                memoryMode: "skip-memory",
                inputLineage,
                runSourceSelection: {
                    schemaVersion: 1,
                    scope: "web",
                    selectionId: "b170-web-only",
                    userMessageId: "b170-user",
                },
                onLifecycleEvent: event => lifecycle.push(event as never),
            });
        } finally {
            await runtime.dispose();
            restoreWorker();
        }

        expect(boundTools[0]).toContain(EXECUTE_CODE_TOOL_NAME);
        expect(boundTools[0]).not.toContain("query_notes");
        expect(boundTools[0]).not.toContain("read_note");
        const result = lifecycle.find(event => event.type === "message_end"
            && event.message?.role === "toolResult"
            && event.message.toolName === EXECUTE_CODE_TOOL_NAME)?.message;
        expect(result?.inputLineage).toEqual(inputLineage);
    });
});
