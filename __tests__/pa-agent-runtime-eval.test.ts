import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ChatOpenAI } from "@langchain/openai";
import { AIUtils } from "../src/ai-services/ai-utils";
import { ChatService } from "../src/ai-services/chat-service";
import { createPaAgentPersistedTurn } from "../src/ai-services/pa-agent-history";
import type { ChatMessage, PaAgentMessage } from "../src/ai-services/chat-types";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import { AgentRunCoordinator } from "../src/ai-services/agent-run-coordinator";
import { BuiltinWebSearchProvider, createBailianWebSearchNetworkPolicy } from "../src/ai-services/builtin-web-search-provider";
import * as vaultEvidence from "../src/ai-services/vault-observation-evidence";
import { createPaRuntimeEvalRequestBudget, PA_RUNTIME_EVAL_CASES, runPaRuntimeEvalCase,
    validatePaRuntimeEvalEvidence, type PaRuntimeEvalCase } from "../src/pa/eval";

jest.mock("obsidian");

type RequestBody = { model?: string; stream?: boolean; messages: Array<{ role: string; content: unknown;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string }>; tools?: unknown[] };
type PhysicalRequest = { caseId: string; arm: "main" | "no_progress"; body: RequestBody; httpStatus: number;
    attemptId: null; callId: null; purpose: null; association: "unknown" };
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });

function completion(body: RequestBody, reply: { text?: string; tools?: Array<{ name: string; input: unknown }> }): Response {
    const common = { id: "b149-fixed", created: 0, model: "b149-fixed-model" };
    const tools = reply.tools ?? [];
    const toolCalls = tools.map((tool, index) => ({ id: `call-${index + 1}`, type: "function", function: {
        name: tool.name, arguments: JSON.stringify(tool.input),
    } }));
    const frame = (delta: unknown, reason: string | null = null) => `data: ${JSON.stringify({
        ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: reason }],
    })}\n\n`;
    if (!body.stream) return new Response(JSON.stringify({ ...common, object: "chat.completion", choices: [{
        index: 0, message: tools.length ? { role: "assistant", content: "", tool_calls: toolCalls }
            : { role: "assistant", content: reply.text ?? "" }, finish_reason: tools.length ? "tool_calls" : "stop",
    }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), {
        headers: { "content-type": "application/json" },
    });
    const chunks = tools.length
        ? [frame({ role: "assistant", content: "", tool_calls: toolCalls.map((tool, index) => ({ ...tool, index })) })]
        : [frame({ role: "assistant", content: reply.text ?? "" })];
    chunks.push(frame({}, tools.length ? "tool_calls" : "stop"));
    chunks.push(`data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
    return new Response(chunks.join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

function hostFor(evalCase: PaRuntimeEvalCase, isForcedSearchFailure: () => boolean = () => false): AiServiceHost {
    const files = evalCase.notes.map((note, index) => ({ path: note.path, name: note.path.split("/").slice(-1)[0],
        basename: note.path.split("/").slice(-1)[0]?.replace(/\.md$/, ""), extension: "md",
        stat: { ctime: 1000 + index, mtime: 1000 + index, size: note.body.length },
    }));
    const byPath = new Map(files.map(file => [file.path, file]));
    return {
        settings: {
            debug: false, aiProvider: "openai", baseURL: "https://b149-offline.invalid/v1", chatModelName: "b149-fixed-model",
            policyModelName: "", embeddingModelName: "b149-fixed-embedding", shareAnonymousCapabilityUsage: false,
            qwenThinkingEnabled: false, webSearchEnabled: Boolean(evalCase.webEvidence), memoryEnabled: false, licenseTier: "paid",
            operationsAgentEnabled: false, operationsProactiveSaveSuggestionsEnabled: false,
            operationsAuditIncludeContent: false, operationsAuditRetentionDays: 30,
            statisticsVaultId: "b149-synthetic", retrievalOptimizationFlags: {},
        },
        app: {
            workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: {
                getMarkdownFiles: () => evalCase.offline === "search_failure" || isForcedSearchFailure()
                    ? (() => { throw new Error("B149_SEARCH_UNAVAILABLE"); })() : files,
                getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
                cachedRead: async (file: { path: string }) => evalCase.notes.find(note => note.path === file.path)?.body ?? "",
                read: async (file: { path: string }) => evalCase.notes.find(note => note.path === file.path)?.body ?? "",
            },
            metadataCache: {
                getFileCache: (file: { path: string }) => {
                    const note = evalCase.notes.find(candidate => candidate.path === file.path);
                    return note ? { headings: [{ level: 1, heading: note.heading, position: { start: { line: 0 }, end: { line: 0 } } }] } : null;
                },
                getCache: () => null,
            },
        } as unknown as AiServiceHost["app"],
        memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [],
            getChunksByPath: async () => [] } as unknown as AiServiceHost["memorySearch"],
        getMemoryEvidenceEpoch: () => 'b149-synthetic-source-epoch',
        getAPIToken: async () => "b149-synthetic-token", log: () => undefined,
        isOperationsAgentEnabled: false, getMemoryExtractionPromptContext: () => undefined,
    };
}

function replyFor(evalCase: PaRuntimeEvalCase, index: number, arm: "main" | "no_progress" = "main"):
    { text?: string; tools?: Array<{ name: string; input: unknown }> } {
    if (evalCase.offline === "web" || evalCase.offline === "web_followup") {
        if (index === 0) return { tools: [{ name: "webSearch", input: { query: evalCase.id, limit: 1 } }] };
    }
    if (evalCase.offline === "combined" && index === 0) return { tools: [
        { name: "read_note", input: { path: evalCase.notes[0].path } },
        { name: "webSearch", input: { query: evalCase.id, limit: 1 } },
    ] };
    if (evalCase.offline === "recovery") {
        if (arm === "no_progress") {
            if (index < 6) return { tools: [{ name: "search_vault_snippets", input: { query: "jay same", limit: 5 } }] };
        } else if (index < 7) {
            return index % 2 === 0
                ? { tools: [{ name: "search_vault_snippets", input: { query: `jay failure ${index}`, limit: 5 } }] }
                : { tools: [{ name: "read_note", input: { path: evalCase.notes[(index - 1) / 2].path } }] };
        }
    }
    if (index === 0 && evalCase.offline === "read_notes") {
        const paths = evalCase.id === "E-01" ? ["synthetic/lighthouse-final.md"] : evalCase.notes.map(note => note.path);
        return { tools: paths.map(path => ({ name: "read_note", input: { path } })) };
    }
    if (index === 0 && (evalCase.offline === "zero_match" || evalCase.offline === "search_failure")) {
        return { tools: [{ name: "search_vault_snippets", input: { query: "b149-no-match", limit: 5 } }] };
    }
    if (evalCase.offline === "writing") return { text: JSON.stringify({ kind: "pa.writing", version: 1,
        requestId: `b149-${evalCase.id}`, body: evalCase.answer, explanation: "合成草稿，不代表已保存" }) };
    return { text: evalCase.answer };
}

describe("B-149 runtime task baseline", () => {
    it('keeps an empty notes search out of a later Web SDK request and its answer ancestry', async () => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-05')!;
        const host = hostFor(evalCase);
        const service = new ChatService(host);
        const requests: RequestBody[] = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as RequestBody;
            requests.push(body);
            return completion(body, requests.length === 1
                ? { tools: [{ name: 'search_vault_metadata', input: { query: 'no-match-synthetic' } }] }
                : { text: requests.length === 2 ? 'NOTES_EMPTY_ANSWER_SENTINEL' : 'WEB_REPLY' });
        }) as typeof fetch;
        const firstSelection = { schemaVersion: 1 as const, scope: 'notes' as const,
            selectionId: 'first-notes', userMessageId: 'first-user' };
        const lifecycle: PaAgentMessage[] = [];
        await service.streamLLM('Find my note', jest.fn(), undefined, [], {
            userText: 'Find my note', runSourceSelection: firstSelection, memoryMode: 'skip-memory',
            onLifecycleEvent: event => {
                if (event.type === 'message_end') lifecycle.push(event.message);
            },
        });
        const turn = createPaAgentPersistedTurn({ runId: 'first-run', turnId: 'final-turn', messages: lifecycle });
        const history: ChatMessage[] = [
            { role: 'user', content: 'Find my note', runSourceSelection: firstSelection,
                inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'first-user' }]) },
            { role: 'assistant', content: 'NOTES_EMPTY_ANSWER_SENTINEL', canonicalTurn: turn,
                inputLineage: turn.inputLineage, runSourceSelection: firstSelection },
        ];
        await service.streamLLM('Search public Web', jest.fn(), undefined, history, {
            userText: 'Search public Web', memoryMode: 'skip-memory', runSourceSelection: {
                schemaVersion: 1, scope: 'web', selectionId: 'second-web', userMessageId: 'second-user',
            },
        });
        expect(requests).toHaveLength(3);
        expect(JSON.stringify(requests[2])).not.toContain('NOTES_EMPTY_ANSWER_SENTINEL');
        expect(JSON.stringify(requests[2])).not.toContain('no-match-synthetic');
        expect(turn.inputLineage?.dependencies).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'run-notes-observation', owner: 'vault' }),
        ]));
    });

    it('does not replay a cancelled notes tool observation in a later Web SDK request', async () => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-05')!;
        const host = hostFor(evalCase);
        const service = new ChatService(host);
        const requests: RequestBody[] = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as RequestBody;
            requests.push(body);
            return completion(body, requests.length === 1
                ? { tools: [{ name: 'search_vault_metadata', input: { query: 'cancelled-no-match' } }] }
                : { text: 'WEB_AFTER_CANCEL' });
        }) as typeof fetch;
        const firstSelection = { schemaVersion: 1 as const, scope: 'notes' as const,
            selectionId: 'cancel-notes', userMessageId: 'cancel-user' };
        const messages: PaAgentMessage[] = [];
        const controller = new AbortController();
        await service.streamLLM('Find my note', jest.fn(), controller.signal, [], {
            userText: 'Find my note', runSourceSelection: firstSelection, memoryMode: 'skip-memory',
            onLifecycleEvent: event => {
                if (event.type === 'message_end') {
                    messages.push(event.message);
                    if (event.message.role === 'toolResult') controller.abort();
                }
            },
        }).catch(() => undefined);
        expect(messages.some(message => message.role === 'toolResult'
            && message.content.promptText.includes('cancelled-no-match'))).toBe(true);
        const turn = createPaAgentPersistedTurn({ runId: 'cancel-run', turnId: 'cancel-turn', messages });
        expect(turn.inputLineage?.dependencies).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'run-notes-observation', owner: 'vault' }),
        ]));
        const history: ChatMessage[] = [
            { role: 'user', content: 'Find my note', inputLineage: completeInputLineage([
                { kind: 'user-text', messageId: 'cancel-user' }]), runSourceSelection: firstSelection },
            { role: 'assistant', content: '', inputLineage: turn.inputLineage,
                canonicalTurn: turn, runSourceSelection: firstSelection },
        ];
        await service.streamLLM('Search public Web', jest.fn(), undefined, history, {
            userText: 'Search public Web', memoryMode: 'skip-memory', runSourceSelection: {
                schemaVersion: 1, scope: 'web', selectionId: 'web-after-cancel', userMessageId: 'web-user',
            },
        });
        expect(requests).toHaveLength(2);
        expect(JSON.stringify(requests[1])).not.toContain('cancelled-no-match');
    });

    it.each([
        { tool: 'search_vault_metadata', change: 'epoch' },
        { tool: 'search_memory', change: 'memory' },
    ] as const)('withdraws $tool before the next SDK request after $change changes', async ({ tool, change }) => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-05')!;
        const host = hostFor(evalCase);
        host.settings.memoryEnabled = true;
        let epoch = 'epoch-1';
        host.getMemoryEvidenceEpoch = () => epoch;
        const service = new ChatService(host);
        const requests: RequestBody[] = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as RequestBody;
            requests.push(body);
            return completion(body, requests.length === 1
                ? { tools: [{ name: tool, input: { query: 'revoked-search' } }] }
                : { text: 'No current source observation.' });
        }) as typeof fetch;
        await service.streamLLM('Find my note', jest.fn(), undefined, [], {
            userText: 'Find my note', runSourceSelection: {
                schemaVersion: 1, scope: 'notes', selectionId: `revoke-${change}`, userMessageId: `user-${change}`,
            }, memoryMode: 'auto',
            onLifecycleEvent: event => {
                if (event.type === 'message_end' && event.message.role === 'toolResult') {
                    if (change === 'epoch') epoch = 'epoch-2';
                    else host.settings.memoryEnabled = false;
                }
            },
        });
        expect(requests).toHaveLength(2);
        const second = JSON.stringify(requests[1]);
        expect(second).toContain('result_unknown');
        expect(second).not.toContain('"matches":[]');
        expect(second).not.toContain('"status":"unavailable"');
    });

    it('sends Host-standard read-only Vault failures for E-06 as actual SDK tool results', async () => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-06')!;
        const host = hostFor(evalCase);
        (host.app.vault as unknown as { getMarkdownFiles: () => never }).getMarkdownFiles = () => {
            throw new Error('private/secret.md');
        };
        const service = new ChatService(host);
        const tools = [
            { name: 'search_vault_metadata', input: { query: 'moon' } },
            { name: 'search_vault_snippets', input: { query: 'moon', limit: 5 } },
            { name: 'query_notes', input: { folder: '', limit: 5 } },
            { name: 'list_vault_tags', input: {} },
            { name: 'list_recent_notes', input: { order: 'modified', limit: 5 } },
        ];
        const requests: RequestBody[] = [];
        const results: Extract<PaAgentMessage, { role: 'toolResult' }>[] = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as RequestBody;
            requests.push(body);
            return completion(body, requests.length === 1 ? { tools } : { text: 'The Vault search failed.' });
        }) as typeof fetch;
        await service.streamLLM('Find approval records', jest.fn(), undefined, [], {
            userText: 'Find approval records', memoryMode: 'skip-memory', runSourceSelection: {
                schemaVersion: 1, scope: 'notes', selectionId: 'e06-standard-failures', userMessageId: 'e06-user',
            },
            onLifecycleEvent: event => {
                if (event.type === 'message_end' && event.message.role === 'toolResult') results.push(event.message);
            },
        });
        expect(requests).toHaveLength(2);
        expect(results).toHaveLength(tools.length);
        for (const [index, tool] of tools.entries()) {
            expect(results[index]).toMatchObject({ toolName: tool.name, isError: true,
                content: { metadata: { outcome: 'recoverable_error' }, sourceRecords: [] } });
            expect(results[index].inputLineage?.dependencies).toEqual(expect.arrayContaining([
                expect.objectContaining({ kind: 'run-notes-observation', owner: 'vault' }),
            ]));
        }
        const toolMessages = requests[1].messages.filter(message => message.role === 'tool');
        expect(toolMessages).toHaveLength(tools.length);
        for (const [index, tool] of tools.entries()) {
            expect(JSON.parse(results[index].content.promptText)).toEqual({
                tool: tool.name, status: 'unavailable', input: 'execution failed',
                error: 'Read-only tool was unavailable.',
            });
            expect(String(toolMessages[index].content)).toContain(results[index].content.promptText);
            expect(String(toolMessages[index].content)).not.toContain('result_unknown');
            expect(String(toolMessages[index].content)).not.toContain('private/secret.md');
        }
    });

    it('keeps an owner-specific Vault error unknown in the next SDK request', async () => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-06')!;
        const host = hostFor(evalCase);
        (host.app.vault as unknown as { getMarkdownFiles?: () => unknown }).getMarkdownFiles = undefined;
        const service = new ChatService(host);
        const requests: RequestBody[] = [];
        const results: Extract<PaAgentMessage, { role: 'toolResult' }>[] = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as RequestBody;
            requests.push(body);
            return completion(body, requests.length === 1
                ? { tools: [{ name: 'query_notes', input: { folder: '', limit: 5 } }] }
                : { text: 'Search unavailable.' });
        }) as typeof fetch;
        await service.streamLLM('Find approval records', jest.fn(), undefined, [], {
            userText: 'Find approval records', memoryMode: 'skip-memory', runSourceSelection: {
                schemaVersion: 1, scope: 'notes', selectionId: 'e06-nonstandard-error', userMessageId: 'e06-user',
            },
            onLifecycleEvent: event => {
                if (event.type === 'message_end' && event.message.role === 'toolResult') results.push(event.message);
            },
        });
        expect(results[0].content.promptText).toContain('Vault getMarkdownFiles is unavailable.');
        expect(results[0].content.metadata?.outcome).toBe('recoverable_error');
        const toolMessage = requests[1].messages.find(message => message.role === 'tool');
        expect(toolMessage?.content).toContain('result_unknown');
        expect(toolMessage?.content).not.toContain('Vault getMarkdownFiles is unavailable.');
    });

    it('withdraws a standard Vault failure when its source epoch changes before SDK dispatch', async () => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-06')!;
        const host = hostFor(evalCase);
        let epoch = 'e06-epoch-1';
        host.getMemoryEvidenceEpoch = () => epoch;
        const service = new ChatService(host);
        const requests: RequestBody[] = [];
        const results: Extract<PaAgentMessage, { role: 'toolResult' }>[] = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as RequestBody;
            requests.push(body);
            return completion(body, requests.length === 1
                ? { tools: [{ name: 'search_vault_metadata', input: { query: 'moon' } }] }
                : { text: 'Search unavailable.' });
        }) as typeof fetch;
        await service.streamLLM('Find approval records', jest.fn(), undefined, [], {
            userText: 'Find approval records', memoryMode: 'skip-memory', runSourceSelection: {
                schemaVersion: 1, scope: 'notes', selectionId: 'e06-epoch-revoke', userMessageId: 'e06-user',
            },
            onLifecycleEvent: event => {
                if (event.type === 'message_end' && event.message.role === 'toolResult') {
                    results.push(event.message);
                    epoch = 'e06-epoch-2';
                }
            },
        });
        expect(results[0].content.promptText).toContain('Read-only tool was unavailable.');
        expect(requests).toHaveLength(2);
        const second = JSON.stringify(requests[1]);
        expect(second).toContain('result_unknown');
        expect(second).not.toContain('Read-only tool was unavailable.');
    });

    it('does not replay a standard Vault failure or its derived answer in a later Web run', async () => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-06')!;
        const host = hostFor(evalCase);
        const service = new ChatService(host);
        const requests: RequestBody[] = [];
        const lifecycle: PaAgentMessage[] = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as RequestBody;
            requests.push(body);
            return completion(body, requests.length === 1
                ? { tools: [{ name: 'search_vault_metadata', input: { query: 'moon' } }] }
                : { text: requests.length === 2 ? 'E06_FAILURE_ANSWER_SENTINEL' : 'WEB_REPLY' });
        }) as typeof fetch;
        const notesSelection = { schemaVersion: 1 as const, scope: 'notes' as const,
            selectionId: 'e06-notes-run', userMessageId: 'e06-notes-user' };
        await service.streamLLM('Find approval records', jest.fn(), undefined, [], {
            userText: 'Find approval records', memoryMode: 'skip-memory', runSourceSelection: notesSelection,
            onLifecycleEvent: event => {
                if (event.type === 'message_end') lifecycle.push(event.message);
            },
        });
        const turn = createPaAgentPersistedTurn({ runId: 'e06-run', turnId: 'e06-turn', messages: lifecycle });
        expect(turn.inputLineage?.dependencies).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'run-notes-observation', owner: 'vault' }),
        ]));
        const history: ChatMessage[] = [
            { role: 'user', content: 'Find approval records', runSourceSelection: notesSelection,
                inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'e06-notes-user' }]) },
            { role: 'assistant', content: 'E06_FAILURE_ANSWER_SENTINEL', canonicalTurn: turn,
                inputLineage: turn.inputLineage, runSourceSelection: notesSelection },
        ];
        await service.streamLLM('Search public Web', jest.fn(), undefined, history, {
            userText: 'Search public Web', memoryMode: 'skip-memory', runSourceSelection: {
                schemaVersion: 1, scope: 'web', selectionId: 'e06-web-run', userMessageId: 'e06-web-user',
            },
        });
        expect(requests).toHaveLength(3);
        const webRequest = JSON.stringify(requests[2]);
        expect(webRequest).not.toContain('E06_FAILURE_ANSWER_SENTINEL');
        expect(webRequest).not.toContain('Read-only tool was unavailable.');
        expect(webRequest).not.toContain('"name":"search_vault_metadata"');
    });
    it('rejects a changed constructor model before any real SDK HTTP dispatch, even if settings restore', async () => {
        const evalCase = PA_RUNTIME_EVAL_CASES.find(item => item.id === 'E-09')!;
        const host = hostFor(evalCase);
        const identity = { provider: host.settings.aiProvider, model: host.settings.chatModelName,
            baseURL: host.settings.baseURL };
        const originalCreate = AIUtils.prototype.createChatModel;
        const createSpy = jest.spyOn(AIUtils.prototype, 'createChatModel').mockImplementation(async function (this: AIUtils, ...args) {
            host.settings.chatModelName = 'b149-smaller-model';
            host.settings.baseURL = 'https://b149-smaller.invalid/v1';
            try { return await originalCreate.apply(this, args); }
            finally { host.settings.chatModelName = identity.model; host.settings.baseURL = identity.baseURL; }
        });
        const originalFetch = globalThis.fetch;
        const fetchSpy = jest.fn(async () => { throw new Error('Unexpected physical dispatch'); });
        globalThis.fetch = fetchSpy as typeof fetch;
        try {
            const result = await runPaRuntimeEvalCase(evalCase, host, new AIUtils(host));
            expect(createSpy).toHaveBeenCalled();
            expect(result.status).toBe('failed');
            expect(result.error ?? '').toContain('model configuration changed');
            expect(host.settings).toMatchObject({ aiProvider: identity.provider,
                chatModelName: identity.model, baseURL: identity.baseURL });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally { createSpy.mockRestore(); globalThis.fetch = originalFetch; }
    });

    it("freezes twelve synthetic goals, sources, forbidden outcomes and allowed differences", () => {
        expect(PA_RUNTIME_EVAL_CASES.map(item => item.id)).toEqual(Array.from({ length: 12 }, (_, index) =>
            `E-${String(index + 1).padStart(2, "0")}`));
        for (const item of PA_RUNTIME_EVAL_CASES) {
            expect(item.goal).toBeTruthy();
            expect(item.requiredEvidence.length).toBeGreaterThan(0);
            expect(item.forbidden.length).toBeGreaterThan(0);
            expect(item.allowedVariation).toBeTruthy();
            expect(item.notes.every(note => note.path.startsWith("synthetic/"))).toBe(true);
        }
        expect(PA_RUNTIME_EVAL_CASES.filter(item => item.baseline === "expected_gap").map(item => item.id))
            .toEqual(["E-02", "E-03", "E-08"]);
    });

    it("runs the actual PA runtime and ChatOpenAI SDK against fixed offline HTTP responses", async () => {
        const requests: PhysicalRequest[] = [];
        const webRequests: Array<{ caseId: string; endpoint: string; body: Record<string, unknown> }> = [];
        let active: PaRuntimeEvalCase | undefined;
        let activeArm: "main" | "no_progress" = "main";
        let activeToolName: string | null = null;
        let caseRequestIndex = 0;
        const originalCreate = AIUtils.prototype.createChatModel;
        jest.spyOn(AIUtils.prototype, "createChatModel").mockImplementation(async function (this: AIUtils, ...args) {
            const configured = await originalCreate.apply(this, args);
            return new ChatOpenAI({ model: configured.model, apiKey: "b149-synthetic-token",
                configuration: { ...configured.clientConfig, maxRetries: 0 }, temperature: configured.temperature,
                maxRetries: 0, ...(args[1]?.maxTokens ? { maxTokens: args[1].maxTokens } : {}),
            });
        });
        const fixedFetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (!active || String(url) !== "https://b149-offline.invalid/v1/chat/completions") {
                throw new Error("Unexpected offline provider URL");
            }
            const body = JSON.parse(String(init?.body)) as RequestBody;
            const reply = replyFor(active, caseRequestIndex++, activeArm);
            activeToolName = reply.tools?.[0]?.name ?? null;
            requests.push({ caseId: active.id, arm: activeArm, body, httpStatus: 200,
                attemptId: null, callId: null, purpose: null, association: "unknown" });
            return completion(body, reply);
        }) as typeof fetch;
        const maximum = Number(process.env.B149_RUNTIME_EVAL_MAX_REQUESTS ?? "50");
        const budget = createPaRuntimeEvalRequestBudget(fixedFetch, maximum);
        globalThis.fetch = budget.fetch;
        const actual = [];
        const evidenceFailures: Record<string, string[]> = {};
        const probes: Record<string, unknown> = {};
        for (const evalCase of PA_RUNTIME_EVAL_CASES) {
            active = evalCase; activeArm = "main"; activeToolName = null; caseRequestIndex = 0;
            const host = hostFor(evalCase, () => evalCase.offline === "recovery" && activeToolName === "search_vault_snippets");
            const webProvider = evalCase.webEvidence ? new BuiltinWebSearchProvider({
                policy: createBailianWebSearchNetworkPolicy(), apiKey: "b149-synthetic-token",
                request: async request => {
                    webRequests.push({ caseId: evalCase.id, endpoint: request.endpoint, body: request.body });
                    const separator = evalCase.webEvidence!.indexOf(": ");
                    return { status: 200, body: { results: [{ title: `Synthetic ${evalCase.id}`,
                        url: evalCase.webEvidence!.slice(0, separator),
                        snippet: evalCase.webEvidence!.slice(separator + 2) }] } };
                },
                isEnabled: () => host.settings.webSearchEnabled,
            }) : undefined;
            const runtimeOptions = webProvider ? { additionalCapabilityProviders: [webProvider] } : undefined;
            if (evalCase.id === "E-11") {
                let entered!: () => void;
                let release!: () => void;
                const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
                const heldPreparation = new Promise<void>(resolve => { release = resolve; });
                const originalPrepare = vaultEvidence.prepareVaultObservationProjection;
                const prepareSpy = jest.spyOn(vaultEvidence, "prepareVaultObservationProjection")
                    .mockImplementation(async input => {
                        if (active?.id === "E-11") { entered(); await heldPreparation; }
                        return originalPrepare(input);
                    });
                const controller = new AbortController();
                const coordinator = new AgentRunCoordinator();
                const running = runPaRuntimeEvalCase(evalCase, host, new AIUtils(host), {
                    signal: controller.signal, turnLeaseProvider: ({ signal }) => coordinator.acquireChatLease(signal),
                });
                try {
                    const enteredBeforeTimeout = await Promise.race([enteredPromise.then(() => true),
                        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 200))]);
                    controller.abort();
                    const cancelSettledBeforeRelease = await Promise.race([running.then(() => true),
                        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 40))]);
                    const queuedController = new AbortController();
                    const secondLease = coordinator.acquireChatLease(queuedController.signal).then(lease => {
                        lease.release(); return true;
                    }, () => false);
                    const secondLeaseAvailableBeforeRelease = await Promise.race([secondLease,
                        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 40))]);
                    queuedController.abort();
                    probes.e11 = { enteredBeforeTimeout, cancelSettledBeforeRelease, secondLeaseAvailableBeforeRelease };
                } finally { controller.abort(); release(); prepareSpy.mockRestore(); }
                actual.push(await running);
                probes.e11 = { ...(probes.e11 as Record<string, unknown>),
                    requestsAfterLateRelease: requests.filter(request => request.caseId === "E-11").length,
                    committedAfterLateRelease: Boolean(actual[actual.length - 1].answer),
                    terminalAfterLateRelease: actual[actual.length - 1].terminalStatus };
            } else {
                actual.push(await runPaRuntimeEvalCase(evalCase, host, new AIUtils(host), { runtimeOptions }));
            }
            const result = actual[actual.length - 1];
            evidenceFailures[evalCase.id] = validatePaRuntimeEvalEvidence(evalCase, result,
                requests.filter(request => request.caseId === evalCase.id && request.arm === "main").map(request => request.body));
            if (evalCase.id === "E-10") {
                activeArm = "no_progress"; caseRequestIndex = 0;
                const controlHost = hostFor(evalCase, () => activeToolName === "search_vault_snippets");
                probes.e10NoProgress = await runPaRuntimeEvalCase(evalCase, controlHost, new AIUtils(controlHost));
                const alternatingResults = result.toolResults.map(toolResult => ({
                    name: toolResult.name, isError: toolResult.isError,
                    sourcePaths: toolResult.sourcePaths,
                }));
                probes.e10Alternating = { terminalStatus: result.terminalStatus, toolResults: alternatingResults,
                    modelRequestCount: requests.filter(request => request.caseId === "E-10" && request.arm === "main").length };
            }
        }
        active = undefined;
        const e09Case = PA_RUNTIME_EVAL_CASES.find(item => item.id === "E-09")!;
        const actionPairs = (e09Case.history ?? []).flatMap(message => message.canonicalTurn?.messages ?? [])
            .filter(message => message.role === "assistant" && message.content.some(part => part.type === "toolCall"))
            .map(message => message.role === "assistant" ? message.content.find(part => part.type === "toolCall") : undefined);
        const resultPairs = (e09Case.history ?? []).flatMap(message => message.canonicalTurn?.messages ?? [])
            .filter(message => message.role === "toolResult");
        const e09Messages = requests.filter(request => request.caseId === "E-09").flatMap(request => request.body.messages);
        const frozenInputs = actionPairs.map(part => part && part.type === "toolCall" ? part.input : undefined);
        const sdkCalls = e09Messages.flatMap(message => message.role === "assistant" ? message.tool_calls ?? [] : []);
        const sdkHasBothCanonicalInputs = frozenInputs.every(input => sdkCalls.some(call => {
            try { return JSON.stringify(JSON.parse(call.function.arguments)) === JSON.stringify(input); }
            catch { return false; }
        }));
        const sdkHasPairedToolMessages = resultPairs.every(result => result.role === "toolResult"
            && e09Messages.some(message => message.role === "tool" && message.tool_call_id === result.toolCallId
                && String(message.content).includes(result.id)));
        probes.e09 = { frozenInputs, frozenResultTexts: resultPairs.map(message => message.role === "toolResult"
            ? message.content.promptText : ""), frozenCallIds: resultPairs.map(message => message.role === "toolResult"
            ? message.toolCallId : ""), sdkHasBothCanonicalInputs, sdkHasPairedToolMessages };
        if (!sdkHasBothCanonicalInputs || !sdkHasPairedToolMessages) {
            evidenceFailures["E-09"].push("Canonical action/result pairs were not preserved as paired SDK messages.");
        }
        const fixtureHash = createHash("sha256").update(JSON.stringify(PA_RUNTIME_EVAL_CASES)).digest("hex");
        const output = process.env.B149_RUNTIME_EVAL_OUTPUT;
        if (output) writeFileSync(output, JSON.stringify({ schemaVersion: 1, layer: "offline-real-runtime-fixed-http",
            fixtureHash, provider: "openai-compatible-synthetic", model: "b149-fixed-model",
            modelParameters: { answerTemperature: 0.8, sdkMaxRetries: 0, transport: "native-fetch-fixed-http" },
            capabilitySettings: { webSearchEnabled: "true for E-02/E-03/E-08 only", memoryEnabled: false, skillContextProvider: null },
            interpretation: "Runtime status is not a semantic pass. Scripted model replies prove runtime/SDK/transport and event propagation, not autonomous model quality. First useful result requires human rubric; first visible output is only a mechanical timestamp. E-12 produces an unsaved writing artifact; no save receipt exists.",
            physicalRequestLimit: maximum, physicalRequestsAttempted: budget.count(),
            requestAttemptPurposeAssociation: "HTTP body-to-attempt join remains unknown in this offline fixture; the run-local usage ledger records actual attempt IDs without order-based attribution",
            cases: PA_RUNTIME_EVAL_CASES, actual, evidenceFailures, probes, requests, webRequests }, null, 2));
        expect(actual).toHaveLength(12);
        expect(actual.filter(item => item.status === "cancelled").map(item => item.caseId)).toEqual(["E-11"]);
        expect(actual.filter(item => item.status === "failed")).toEqual([]);
        expect(actual.filter(item => item.status === "incomplete")).toEqual([]);
        expect(evidenceFailures["E-01"]).toEqual([]);
        expect(evidenceFailures["E-02"]).toEqual([]);
        expect(evidenceFailures["E-03"]).toEqual([]);
        expect(evidenceFailures["E-08"]).toEqual([]);
        const enabledTools = (caseId: string) => requests.find(request => request.caseId === caseId)?.body.tools
            ?.map((tool: any) => tool.function?.name) ?? [];
        expect(enabledTools("E-02")).toContain("webSearch");
        expect(enabledTools("E-02")).not.toContain("read_note");
        expect(enabledTools("E-03")).toEqual(expect.arrayContaining(["read_note", "webSearch"]));
        expect(enabledTools("E-08")).toContain("webSearch");
        expect(enabledTools("E-08")).not.toContain("read_note");
        const e08Requests = requests.filter(request => request.caseId === "E-08").map(request => request.body);
        expect(e08Requests.length).toBeGreaterThan(1);
        expect(e08Requests.every(body => !JSON.stringify(body).includes("OLD_PRIVATE_BUDGET_71"))).toBe(true);
        expect(JSON.stringify(e08Requests.slice(1))).toContain("WEB_B_UNKNOWN");
        expect(actual.find(item => item.caseId === "E-08")?.sourceUrls)
            .toContain("https://example.invalid/plan-b");
        expect(evidenceFailures["E-10"]).toEqual([]);
        expect(probes.e10Alternating).toMatchObject({ terminalStatus: "completed", modelRequestCount: 8, toolResults: [
            { name: "search_vault_snippets", isError: true }, { name: "read_note", isError: false },
            { name: "search_vault_snippets", isError: true }, { name: "read_note", isError: false },
            { name: "search_vault_snippets", isError: true }, { name: "read_note", isError: false },
            { name: "search_vault_snippets", isError: true },
        ] });
        expect(actual.find(item => item.caseId === "E-10")).toMatchObject({
            status: "completed",
            sourcePaths: ["synthetic/jay-approval.md", "synthetic/jay-revision.md", "synthetic/jay-confirmation.md"],
        });
        expect((probes.e10NoProgress as { terminalStatus: string; toolResults: Array<{ isError: boolean }> }))
            .toMatchObject({ terminalStatus: "incomplete", toolResults: [
                { isError: true }, { isError: true }, { isError: true }, { isError: true },
            ] });
        expect(probes.e09).toMatchObject({ sdkHasBothCanonicalInputs: true, sdkHasPairedToolMessages: true });
        expect(probes.e11).toMatchObject({ enteredBeforeTimeout: true, cancelSettledBeforeRelease: true,
            secondLeaseAvailableBeforeRelease: true, requestsAfterLateRelease: 0,
            committedAfterLateRelease: false, terminalAfterLateRelease: "aborted" });
        expect(webRequests.map(request => request.caseId)).toEqual(["E-02", "E-03", "E-08"]);
        expect(actual.filter(item => item.caseId !== "E-11").every(item => item.attempts.length > 0)).toBe(true);
        expect(actual.filter(item => item.caseId !== 'E-11').every(item =>
            item.usage.physicalAttribution === 'complete'
            && item.usage.physicalTotalTokens === item.usage.attempts.length * 20
            && item.usage.measuredPromptTokens === item.usage.attempts.length * 10
            && item.usage.estimatedPromptTokens !== null)).toBe(true);
        expect(actual.find(item => item.caseId === 'E-11')?.usage).toMatchObject({
            physicalAttribution: 'unknown', physicalTotalTokens: null,
            measuredPromptTokens: null, estimatedPromptTokens: null,
        });
        expect(budget.count()).toBe(requests.length);
        expect(requests.filter(item => item.caseId === "E-11")).toHaveLength(0);
        const e01Case = PA_RUNTIME_EVAL_CASES[0];
        const e01Actual = actual[0];
        const e01Requests = requests.filter(request => request.caseId === "E-01").map(request => request.body);
        expect(validatePaRuntimeEvalEvidence(e01Case, { ...e01Actual, sourcePaths: [] }, e01Requests))
            .toEqual(expect.arrayContaining([expect.stringContaining("Missing observed note source")]));
        expect(validatePaRuntimeEvalEvidence(e01Case, e01Actual, e01Requests.slice(0, 1)))
            .toEqual(expect.arrayContaining([expect.stringContaining("subsequent model request")]));
        const e06Case = PA_RUNTIME_EVAL_CASES[5];
        const e06Actual = actual[5];
        expect(validatePaRuntimeEvalEvidence(e06Case, { ...e06Actual,
            toolResults: e06Actual.toolResults.map(result => ({ ...result, isError: false })) }, []))
            .toEqual(expect.arrayContaining([expect.stringContaining("Missing recorded tool error")]));
    });
});
