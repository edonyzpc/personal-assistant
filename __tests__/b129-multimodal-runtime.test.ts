import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { AIUtils } from "../src/ai-services/ai-utils";
import { createReadNoteTool } from "../src/ai-services/chat-tool-factories";
import { BuiltinWebSearchProvider, createBailianWebSearchNetworkPolicy,
    type BuiltinWebSearchRequest } from "../src/ai-services/builtin-web-search-provider";
import { revalidateVaultObservationFromApp } from "../src/ai-services/vault-observation-evidence";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import type { AgentDebugObservation, AgentDebugRunRecorder } from "../src/ai-services/agent-debug-port";
import type { MemorySearchPort } from "../src/memory/MemorySearchPort";
import { PaAgentRuntime, type PaAgentRuntimeOptions, type PaAgentStreamOptions } from "../src/ai-services/pa-agent-runtime";
import { ChatService } from "../src/ai-services/chat-service";
import type { AgentEvent, LegacyAgentEvent, ChatMessage } from "../src/ai-services/chat-types";
import type { ImageAssetService } from "../src/chat/image-assets";
import type { MessageImage } from "../src/chat/image-types";
import { WritingVersionService } from "../src/chat/writing-versions";
import type { WritingVersion } from "../src/chat/writing-types";
import { createPaAgentPersistedTurn } from "../src/ai-services/pa-agent-history";
import { generationInputSnapshotInputLineage } from "../src/ai-services/input-lineage";
import { decodeWritingOutput, isWritingContinuationPrompt, isWritingRequestPrompt, readProviderCompletion } from "../src/ai-services/writing-output";
import { formatInjectedContext, MEMORY_CONTEXT_MAX_CHARS } from "../src/ai-services/context/PaAgentContextProjector";
import type { PaAgentContextSummarizer, PaAgentSummaryRequest } from "../src/ai-services/context/PaAgentContextSummarizer";
import { traceProviderDispatch } from "../src/ai-services/obsidian-fetch";

jest.mock("obsidian");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });

const image = (n: number): MessageImage => ({ ref: { assetId: `image-${n}`, contentHash: String(n).repeat(64) }, ordinal: n, label: `Image ${n}` });
const envelope = (body = '正文："海风"\n🌊') => JSON.stringify({ kind: "pa.writing", version: 1, requestId: "writing-1", body, explanation: "参考当前材料" });
type RequestBody = { stream?: boolean; messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>; tools?: Array<{ function: { name: string } }> };
type FixtureTool = { name: string; input: unknown };
type Reply = { text?: string; finish?: string | null; tool?: FixtureTool; tools?: FixtureTool[]; error?: unknown; httpError?: { status: number; code: string; retryAfter?: string };
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; onEnd?: () => void };
const response = (body: RequestBody, reply: Reply): Response => {
    if (reply.error) throw reply.error;
    if (reply.httpError) return new Response(JSON.stringify({ error: { code: reply.httpError.code, message: "Request rejected; echoed data:image/jpeg;base64,SECRET" } }), {
        status: reply.httpError.status, headers: { "content-type": "application/json", ...(reply.httpError.retryAfter ? { "retry-after": reply.httpError.retryAfter } : {}) },
    });
    const common = { id: "fixture", created: 0, model: "fixture-model" };
    const tools = reply.tools ?? (reply.tool ? [reply.tool] : []);
    const message = tools.length ? { role: "assistant", content: "", tool_calls: tools.map((tool, index) => ({ id: `call-${index + 1}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.input) } })) }
        : { role: "assistant", content: reply.text ?? "ordinary answer" };
    const finish = reply.finish === undefined ? "stop" : reply.finish;
    if (!body.stream) { reply.onEnd?.(); return new Response(JSON.stringify({ ...common, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }],
        ...(reply.usage ? { usage: reply.usage } : {}) }), { headers: { "content-type": "application/json" } }); }
    const frame = (delta: unknown, reason: string | null = null) => `data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
    const frames = tools.length ? [frame({ ...message, tool_calls: message.tool_calls!.map((tool, index) => ({ ...tool, index })) })]
        : [(reply.text ?? "ordinary answer").slice(0, 9), (reply.text ?? "ordinary answer").slice(9, 37), (reply.text ?? "ordinary answer").slice(37)].map((content) => frame({ role: "assistant", content }));
    frames.push(frame({}, tools.length ? "tool_calls" : finish));
    frames.push(`data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
    reply.onEnd?.();
    return new Response(frames.join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
};

function fixture(replies: Reply[] | ((body: RequestBody, index: number) => Reply), runtimeOptions: PaAgentRuntimeOptions = {}, sdkRetries = 0) {
    const requests: RequestBody[] = [], observed: BaseMessage[][] = [], events: LegacyAgentEvent[] = [], lifecycle: AgentEvent[] = [];
    const sdkAttempts: Array<{ stream: boolean; retryCount: string | null }> = [];
    const modelSpecifications: Array<{ isSummary: boolean; options: { prepareProviderRequest?: unknown } }> = [];
    let beforeSdkDispatch: (() => void) | undefined;
    let afterModelCreated: ((isSummary: boolean) => void | Promise<void>) | undefined;
    const host = {
        settings: { aiProvider: "openai", baseURL: "https://b129-runtime.invalid/v1", chatModelName: "fixture-model", embeddingModelName: "fixture-embedding", policyModelName: "",
            skillContextEnabled: false, enabledSkillIds: [], webSearchEnabled: false, memoryEnabled: false, licenseTier: "free", statisticsVaultId: "fixture-vault",
            retrievalOptimizationFlags: { lexicalProfile: false, strictReranker: false, graphPpr: false, relaxedRecovery: false } },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => "" }, metadataCache: { getFileCache: () => null } },
        memorySearch: {
            ensureReadyForChat: async (..._args: Parameters<MemorySearchPort['ensureReadyForChat']>) => ({ decision: "answer-now" }),
            searchHybrid: async (..._args: Parameters<MemorySearchPort['searchHybrid']>) => [],
            getChunksByPath: async () => [],
        },
        getAPIToken: async () => "synthetic-fixture-token", log: jest.fn(), isOperationsAgentEnabled: Boolean(runtimeOptions.operationsIntentController),
        getMemoryExtractionPromptContext: jest.fn(() => undefined as Record<string, unknown> | undefined),
    };
    const originalCreate = AIUtils.prototype.createChatModel;
    jest.spyOn(AIUtils.prototype, "createChatModel").mockImplementation(async function (this: AIUtils, ...args) {
        const configured = await originalCreate.apply(this, args);
        // Keep AIUtils' actual admission wrapper and observe SDK attempts before
        // it. Only the dedicated regression enables OpenAI's internal retries;
        // ChatOpenAI's separate caller retry remains disabled in every fixture.
        const guardedFetch = configured.clientConfig.fetch!;
        const configuration = { ...configured.clientConfig, maxRetries: sdkRetries, fetch: ((input, init) => {
            sdkAttempts.push({ stream: JSON.parse(String(init?.body)).stream === true,
                retryCount: new Headers(init?.headers).get("x-stainless-retry-count") });
            return guardedFetch(input, init);
        }) as typeof fetch };
        const model = new ChatOpenAI({ model: configured.model, apiKey: "synthetic-fixture-token", configuration,
            temperature: configured.temperature, maxRetries: 0, ...(args[1]?.maxTokens ? { maxTokens: args[1].maxTokens } : {}) });
        modelSpecifications.push({
            isSummary: args[1]?.maxTokens !== undefined,
            options: (args[1] ?? {}) as { prepareProviderRequest?: unknown },
        });
        const callbacks = [{ name: "b129-real-bound-observer", handleChatModelStart: (_serialized: unknown, batches: BaseMessage[][]) => { observed.push(...batches); beforeSdkDispatch?.(); } }];
        model.callbacks = callbacks;
        const originalBind = model.bindTools.bind(model);
        model.bindTools = ((...bindArgs: Parameters<typeof model.bindTools>) => {
            const bound = originalBind(...bindArgs); (bound as unknown as { callbacks: typeof callbacks }).callbacks = callbacks; return bound;
        }) as typeof model.bindTools;
        await afterModelCreated?.(args[1]?.maxTokens !== undefined);
        return model;
    });
    globalThis.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url) !== "https://b129-runtime.invalid/v1/chat/completions") throw new Error("Unexpected offline URL");
        const body: RequestBody = JSON.parse(String(init?.body)); const index = requests.length; requests.push(body);
        const reply = typeof replies === "function" ? replies(body, index) : replies[index];
        if (!reply) throw new Error("Unexpected extra fixture request");
        return response(body, reply);
    }) as typeof fetch;
    let sourceCurrent = true;
    const release = jest.fn();
    const service = {
        resolveVariant: jest.fn(async () => ({ blob: new Blob([new Uint8Array([255, 216, 255])]), mime: "image/jpeg", width: 1, height: 1, persistent: true, release })),
        verify: jest.fn(async () => ({ asset: {}, isCurrent: () => sourceCurrent })),
    };
    const runtime = new PaAgentRuntime(host as unknown as AiServiceHost, new AIUtils(host), { skillContextProvider: null, ...runtimeOptions });
    const run = async (options: Partial<PaAgentStreamOptions> = {}) => {
        try { await runtime.streamTurn({ prompt: "请描述图片", memoryMode: "auto", images: [image(1)], imageAssetService: service as unknown as ImageAssetService,
            onEvent: (event) => events.push(event), onLifecycleEvent: (event) => lifecycle.push(event), ...options }); }
        finally { runtime.dispose(); }
    };
    return { host, requests, observed, sdkAttempts, modelSpecifications, events, lifecycle, service, release, run, invalidate: () => { sourceCurrent = false; },
        beforeSdkDispatch: (callback: () => void) => { beforeSdkDispatch = callback; },
        afterModelCreated: (callback: (isSummary: boolean) => void | Promise<void>) => { afterModelCreated = callback; } };
}
const pixels = (request: RequestBody) => request.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url") : []);
const requestText = (request: RequestBody) => request.messages.map((message) => typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("")).join("\n");

describe('B-135 production source handling', () => {
    it.each([
        { scope: 'notes' as const, hidden: ['webSearch'], visible: ['read_note'] },
        { scope: 'web' as const, hidden: ['read_note', 'search_memory', 'query_memories', 'get_vault_insights'], visible: [] },
    ])('keeps $scope source tools out of the physical provider schema', async ({ scope, hidden, visible }) => {
        const f = fixture([{ text: 'Scoped answer' }]);
        f.host.settings.webSearchEnabled = true;
        await f.run({ images: [], prompt: 'Answer within this scope',
            runSourceSelection: { schemaVersion: 1, scope, selectionId: `tool-${scope}`, userMessageId: `user-${scope}` } });
        const names = f.requests[0].tools?.map(tool => tool.function.name) ?? [];
        for (const name of hidden) expect(names).not.toContain(name);
        for (const name of visible) expect(names).toContain(name);
    });

    it('rejects a forged web-scope Memory query before its independent port reads anything', async () => {
        const f = fixture([{ tool: { name: 'query_memories', input: { text: 'private' } } },
            { text: 'No private Memory was read.' }]);
        const prepareObservation = jest.fn(async () => { throw new Error('Memory port must not be reached'); });
        Object.assign(f.host, { memoryManagement: { prepareObservation } });
        await f.run({ images: [], prompt: 'Web only',
            runSourceSelection: { schemaVersion: 1, scope: 'web', selectionId: 'web-memory', userMessageId: 'web-user' } });
        expect(prepareObservation).not.toHaveBeenCalled();
        expect(f.requests[0].tools?.map(tool => tool.function.name)).not.toContain('query_memories');
    });

    it('keeps a note-derived combined Web query from reaching MCP after the note is revoked', async () => {
        const path = 'private/DERIVED_WEB_QUERY.md';
        const file = { path, stat: { ctime: 1, mtime: 1, size: 32 } };
        let noteCurrent = true;
        const webRequest = jest.fn<BuiltinWebSearchRequest>(async () => {
            throw new Error('A revoked note query reached Web MCP');
        });
        const provider = new BuiltinWebSearchProvider({ policy: createBailianWebSearchNetworkPolicy(),
            apiKey: 'synthetic-web-token', request: webRequest, isEnabled: () => true });
        const f = fixture([
            { tool: { name: 'webSearch', input: { query: 'DERIVED_WEB_QUERY_SENTINEL' } },
                onEnd: () => { noteCurrent = false; } },
            { text: 'The source was revoked.' },
        ], { additionalCapabilityProviders: [provider], policyOptions: { licenseTier: 'paid' } });
        f.host.settings.webSearchEnabled = true;
        Object.assign(f.host.app.vault, { getAbstractFileByPath: (candidate: string) =>
            candidate === path && noteCurrent ? file : null });
        await f.run({ images: [], prompt: 'Find related web sources', chatHistory: [{ role: 'assistant',
            content: 'DERIVED_WEB_QUERY_SENTINEL', inputLineage: { schemaVersion: 1,
                completeness: 'complete', dependencies: [{ kind: 'vault', path, via: 'note' }] } }],
            runSourceSelection: { schemaVersion: 1, scope: 'combined', selectionId: 'combined-web-query',
                userMessageId: 'combined-user' } });
        expect(f.requests[0].tools?.map(tool => tool.function.name)).toContain('webSearch');
        expect(requestText(f.requests[0])).toContain('DERIVED_WEB_QUERY_SENTINEL');
        expect(webRequest).not.toHaveBeenCalled();
    });

    it('does not send a pixel-derived combined Web query after the image asset is revoked', async () => {
        let revokeImage: () => void = () => undefined;
        const webRequest = jest.fn<BuiltinWebSearchRequest>(async () => {
            throw new Error('A revoked image query reached Web MCP');
        });
        const provider = new BuiltinWebSearchProvider({ policy: createBailianWebSearchNetworkPolicy(),
            apiKey: 'synthetic-web-token', request: webRequest, isEnabled: () => true });
        const f = fixture([{ tool: { name: 'webSearch', input: { query: 'PIXEL_DERIVED_QUERY_SENTINEL' } },
            onEnd: () => revokeImage() }, { text: 'Image source unavailable.' }],
        { additionalCapabilityProviders: [provider], policyOptions: { licenseTier: 'paid' } });
        revokeImage = f.invalidate;
        f.host.settings.webSearchEnabled = true;
        await f.run({ prompt: 'Find related public images', runSourceSelection: { schemaVersion: 1,
            scope: 'combined', selectionId: 'combined-image-web', userMessageId: 'image-web-user' } }).catch(() => undefined);
        expect(pixels(f.requests[0])).toHaveLength(1);
        expect(webRequest).not.toHaveBeenCalled();
    });

    it.each([false, true])('guards a pixel-derived Memory query at its physical port (revoked=%s)', async revoked => {
        let revokeImage: () => void = () => undefined;
        const f = fixture([{ tool: { name: 'search_memory', input: { query: 'PIXEL_DERIVED_MEMORY_SENTINEL' } },
            onEnd: () => { if (revoked) revokeImage(); } }, { text: 'Memory search finished.' }]);
        revokeImage = f.invalidate;
        f.host.settings.memoryEnabled = true;
        const file = { path: 'notes/allowed.md', extension: 'md' };
        jest.spyOn(f.host.app.vault, 'getMarkdownFiles').mockReturnValue([file] as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockReturnValue(file as never);
        jest.spyOn(f.host.memorySearch, 'ensureReadyForChat').mockResolvedValue({ decision: 'use-memory' });
        const search = jest.spyOn(f.host.memorySearch, 'searchHybrid');
        await f.run({ prompt: 'Find related notes', runSourceSelection: { schemaVersion: 1,
            scope: 'combined', selectionId: `combined-image-memory-${revoked}`, userMessageId: 'image-memory-user' } })
            .catch(error => { if (!revoked) throw error; });
        expect(pixels(f.requests[0])).toHaveLength(1);
        expect(search).toHaveBeenCalledTimes(revoked ? 0 : 1);
    });

    it('rechecks a pixel-derived Memory query after preflight and before its physical search', async () => {
        const f = fixture([{ tool: { name: 'search_memory', input: { query: 'LATE_PIXEL_MEMORY_SENTINEL' } } },
            { text: 'Image source unavailable.' }]);
        f.host.settings.memoryEnabled = true;
        const file = { path: 'notes/allowed.md', extension: 'md' };
        jest.spyOn(f.host.app.vault, 'getMarkdownFiles').mockReturnValue([file] as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockReturnValue(file as never);
        jest.spyOn(f.host.memorySearch, 'ensureReadyForChat').mockImplementation(async () => {
            f.invalidate();
            return { decision: 'use-memory' };
        });
        const search = jest.spyOn(f.host.memorySearch, 'searchHybrid');
        await f.run({ prompt: 'Find related notes', runSourceSelection: { schemaVersion: 1,
            scope: 'combined', selectionId: 'combined-image-memory-late', userMessageId: 'image-memory-user' } })
            .catch(() => undefined);
        expect(pixels(f.requests[0])).toHaveLength(1);
        expect(search).not.toHaveBeenCalled();
    });

    it.each(['web', 'combined'] as const)('sends a current-user %s query to the admitted Web provider', async scope => {
        const webRequest = jest.fn<BuiltinWebSearchRequest>(async () => ({ status: 200, body: {
            results: [{ title: 'Public result', url: 'https://example.com/result', snippet: 'Public snippet' }],
        } }));
        const provider = new BuiltinWebSearchProvider({ policy: createBailianWebSearchNetworkPolicy(),
            apiKey: 'synthetic-web-token', request: webRequest, isEnabled: () => true });
        const f = fixture([{ tool: { name: 'webSearch', input: { query: 'PUBLIC_USER_WEB_QUERY_SENTINEL' } } },
            { text: 'Public result received.' }],
        { additionalCapabilityProviders: [provider], policyOptions: { licenseTier: 'paid' } });
        f.host.settings.webSearchEnabled = true;
        await f.run({ images: [], prompt: 'PUBLIC_USER_WEB_QUERY_SENTINEL',
            runSourceSelection: { schemaVersion: 1, scope, selectionId: `current-${scope}`,
                userMessageId: `current-user-${scope}` } });
        expect(webRequest).toHaveBeenCalledTimes(1);
        expect(webRequest.mock.calls[0]?.[0]?.body).toMatchObject({ query: 'PUBLIC_USER_WEB_QUERY_SENTINEL' });
    });

    it('saves a legitimate scoped Writing artifact after its stream closes and still rejects note revocation', async () => {
        const path = 'notes/WRITING_CONTEXT.md';
        const file = { path, extension: 'md', stat: { ctime: 1, mtime: 1, size: 1 } };
        let liveFile: typeof file | null = file;
        const f = fixture([{ text: envelope('Scoped writing body') }]);
        Object.assign(f.host.app.workspace, { getActiveViewOfType: () => ({ file }) });
        Object.assign(f.host.app.vault, { getAbstractFileByPath: (candidate: string) =>
            candidate === path ? liveFile : null });
        await f.run({ images: [], prompt: 'Write using the visible note', writingRequest: { requestId: 'writing-1' },
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'writing-scope',
                userMessageId: 'writing-user' } });
        const artifact = f.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> =>
            event.kind === 'writing-artifact');
        if (!artifact?.generationInput || !artifact.isSourceCurrent) throw new Error('Missing Writing source receipt');
        expect(generationInputSnapshotInputLineage(artifact.generationInput).completeness).toBe('complete');
        expect(artifact.isSourceCurrent()).toBe(true);
        let stored: WritingVersion | undefined;
        const versions = new WritingVersionService({
            getWritingVersion: async () => null,
            listWritingVersions: async () => stored ? [stored] : [],
            putWritingVersion: async (version, assertSourceCurrent) => {
                assertSourceCurrent?.(); stored = version;
            },
        });
        const version = await versions.create({ requestId: artifact.requestId, messageId: artifact.messageId,
            conversationId: 'scoped-writing', turnIndex: 0, text: artifact.body, images: [],
            generationInput: artifact.generationInput }, artifact.isSourceCurrent);
        expect(version.text).toBe('Scoped writing body');
        expect(stored?.id).toBe(version.id);
        liveFile = null;
        expect(artifact.isSourceCurrent()).toBe(false);
    });

    it('does not carry a published note-directory path into the next web request without any note read', async () => {
        const path = 'private/NOTE_DIRECTORY_SENTINEL.md';
        const file = { path, stat: { mtime: 1, size: 1 } };
        const notes = fixture([{ text: path }]);
        Object.assign(notes.host.app.workspace, { getActiveViewOfType: () => ({ file }) });
        Object.assign(notes.host.app.vault, { getAbstractFileByPath: (candidate: string) => candidate === path ? file : null });
        await notes.run({ images: undefined, prompt: 'Describe the visible note',
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'notes-choice',
                userMessageId: 'notes-user' } });
        const answer = notes.lifecycle.find(event => event.type === 'message_end'
            && event.message.role === 'assistant');
        if (answer?.type !== 'message_end' || answer.message.role !== 'assistant') {
            throw new Error('Missing canonical answer lineage');
        }
        jest.restoreAllMocks();
        const web = fixture([{ text: 'Web answer' }]);
        web.host.settings.webSearchEnabled = true;
        await web.run({ images: undefined, prompt: 'CURRENT_WEB_USER_KEEP',
            chatHistory: [
                { role: 'assistant', content: path, inputLineage: answer.message.inputLineage },
                { role: 'assistant', content: 'PUBLIC_WEB_KEEP', inputLineage: {
                    schemaVersion: 1, completeness: 'complete',
                    dependencies: [{ kind: 'web', providerId: 'web', resultKey: 'public-hit' }],
                } },
            ], runSourceSelection: { schemaVersion: 1, scope: 'web', selectionId: 'web-choice',
                userMessageId: 'web-user' } });

        expect(requestText(notes.requests[0])).toContain(path);
        expect(requestText(web.requests[0])).toContain('CURRENT_WEB_USER_KEEP');
        expect(requestText(web.requests[0])).toContain('PUBLIC_WEB_KEEP');
        expect(requestText(web.requests[0])).not.toContain(path);
        expect(answer.message.inputLineage?.dependencies).toContainEqual({ kind: 'vault', path, via: 'note' });
    });

    it('omits private history, automatic Memory context, and its image index from a web-scope physical request', async () => {
        const f = fixture([{ text: 'Web answer' }]);
        f.host.settings.webSearchEnabled = true;
        f.host.getMemoryExtractionPromptContext.mockReturnValue({
            userProfile: 'PRIVATE_PROFILE_SENTINEL',
        });
        const note: ChatMessage = { role: 'assistant', content: 'PRIVATE_NOTE_SENTINEL', images: [image(3)],
            inputLineage: { schemaVersion: 1, completeness: 'complete',
                dependencies: [{ kind: 'vault', path: 'private/note.md', via: 'note' }] } };
        const web: ChatMessage = { role: 'assistant', content: 'PUBLIC_WEB_SENTINEL',
            inputLineage: { schemaVersion: 1, completeness: 'complete',
                dependencies: [{ kind: 'web', providerId: 'web', resultKey: 'hit-1' }] } };
        await f.run({ prompt: 'Summarize the web result', chatHistory: [note, web],
            runSourceSelection: { schemaVersion: 1, scope: 'web', selectionId: 'choice-1',
                userMessageId: 'current-user' } });
        expect(f.requests).toHaveLength(1);
        expect(requestText(f.requests[0])).toContain('PUBLIC_WEB_SENTINEL');
        expect(requestText(f.requests[0])).not.toMatch(/PRIVATE_NOTE_SENTINEL|PRIVATE_PROFILE_SENTINEL|private\/note\.md|image-3/);
        expect(f.host.getMemoryExtractionPromptContext).not.toHaveBeenCalled();
        expect(pixels(f.requests[0])).toHaveLength(1);
        const answer = f.lifecycle.find(event => event.type === 'message_end'
            && event.message.role === 'assistant');
        expect(answer?.type === 'message_end' ? answer.message.inputLineage : undefined).toMatchObject({
            completeness: 'complete', dependencies: expect.arrayContaining([
                { kind: 'web', providerId: 'web', resultKey: 'hit-1' },
                { kind: 'user-text', messageId: 'current-user' },
            ]),
        });
    });

    it('keeps an unproven automatic Personal projection out of a notes-scoped physical body', async () => {
        const f = fixture([{ text: 'Current user answer' }]);
        f.host.getMemoryExtractionPromptContext.mockReturnValue({ userProfile: 'LEGACY_PROFILE_SCOPE_SENTINEL' });
        await f.run({ images: undefined, prompt: 'Answer from what I supplied',
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'notes-background',
                userMessageId: 'current-user' } });
        expect(f.requests).toHaveLength(1);
        expect(requestText(f.requests[0])).toContain('Answer from what I supplied');
        expect(requestText(f.requests[0])).not.toContain('LEGACY_PROFILE_SCOPE_SENTINEL');
    });

    it('does not send or budget an unproven legacy Writing parent in a scoped Chat request', async () => {
        const f = fixture([{ text: envelope('Fresh body') }]);
        await f.run({ images: undefined, prompt: 'Write a fresh paragraph',
            writingRequest: { requestId: 'writing-1' },
            writingContext: { parentVersionId: 'legacy-parent',
                text: 'LEGACY_PARENT_SENTINEL',
                textHash: 'a'.repeat(64), associatedImages: [] },
            runSourceSelection: { schemaVersion: 1, scope: 'notes',
                selectionId: 'scope-writing', userMessageId: 'writing-user' } });
        expect(f.requests).toHaveLength(1);
        expect(requestText(f.requests[0])).not.toContain('LEGACY_PARENT_SENTINEL');
    });

    it('does not reject a scoped turn because an excluded legacy parent exceeds the prompt budget', async () => {
        const f = fixture([{ text: envelope('Fresh body') }]);
        await f.run({ images: undefined, prompt: 'Write a fresh paragraph',
            writingRequest: { requestId: 'writing-1' },
            writingContext: { parentVersionId: 'legacy-parent',
                text: `EXCLUDED_PARENT${'x'.repeat(200_000)}`,
                textHash: 'a'.repeat(64), associatedImages: [] },
            runSourceSelection: { schemaVersion: 1, scope: 'notes',
                selectionId: 'scope-budget', userMessageId: 'writing-user' } });
        expect(f.requests).toHaveLength(1);
        expect(requestText(f.requests[0])).not.toContain('EXCLUDED_PARENT');
    });

    it('retains a complete explicit Writing parent when its full ancestry fits the selected scope', async () => {
        const f = fixture([{ text: envelope('Continued body') }]);
        const textHash = 'a'.repeat(64);
        await f.run({ images: undefined, prompt: 'Continue the parent',
            writingRequest: { requestId: 'writing-1' },
            writingContext: { parentVersionId: 'known-parent', text: 'KNOWN_PARENT_SENTINEL',
                textHash, associatedImages: [],
                inputLineage: { schemaVersion: 1, completeness: 'complete', dependencies: [
                    { kind: 'user-text', messageId: 'parent-user' },
                    { kind: 'writing-version', versionId: 'known-parent', textHash },
                ] } },
            runSourceSelection: { schemaVersion: 1, scope: 'notes',
                selectionId: 'scope-parent', userMessageId: 'writing-user' } });
        expect(requestText(f.requests[0])).toContain('KNOWN_PARENT_SENTINEL');
    });

    it('does not prepare automatic Writing style in web scope', async () => {
        const f = fixture([{ text: envelope('Web writing') }]);
        const prepareWritingStyle = jest.fn(async () => ({
            context: 'PRIVATE_STYLE_SENTINEL', revisionIds: ['private-style'],
            isCurrent: () => true,
        }));
        await f.run({ images: undefined, prompt: 'Write from web material',
            writingRequest: { requestId: 'writing-1' }, prepareWritingStyle,
            runSourceSelection: { schemaVersion: 1, scope: 'web',
                selectionId: 'scope-web-style', userMessageId: 'writing-user' } });
        expect(prepareWritingStyle).not.toHaveBeenCalled();
        expect(requestText(f.requests[0])).not.toContain('PRIVATE_STYLE_SENTINEL');
    });
    it('does not create a writing artifact when a supplied note disappears after the final request', async () => {
        const prompt = '根据当前笔记写一段文字';
        let live = true;
        const f = fixture([
            { tools: [
                { name: 'get_current_note_context', input: { mode: 'full' } },
            ] },
            { text: envelope('SOURCE_BASED_WRITING'), onEnd: () => { live = false; } },
        ]);
        const file = { path: 'source.md', extension: 'md' };
        jest.spyOn(f.host.app.workspace, 'getActiveViewOfType').mockReturnValue({ file,
            editor: { getValue: () => 'NOTE_USED_FOR_WRITING', getSelection: () => '', lineCount: () => 1,
                getLine: () => 'NOTE_USED_FOR_WRITING', getCursor: () => ({ line: 0, ch: 0 }) } } as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockImplementation(() => live ? file as never : null);
        await f.run({ images: undefined, prompt, writingRequest: { requestId: 'writing-1' } });
        expect(f.requests).toHaveLength(2);
        expect(requestText(f.requests[1])).toContain('NOTE_USED_FOR_WRITING');
        expect(f.events.some(event => event.kind === 'writing-artifact')).toBe(false);
        expect(f.events.find(event => event.kind === 'writing-recovery')).toMatchObject({ reason: 'source_changed', rawText: '', previewText: '' });
    });

    it.each(['answer', 'summary'] as const)('revalidates historical Memory revocation at the %s SDK retry', async stage => {
        const history: ChatMessage[] = [
            { role: 'assistant', content: 'REVOKED_HISTORY_MEMORY ' + (stage === 'summary' ? 'earlier '.repeat(900) : ''),
                memoryMetadata: { hasMemoryContent: true, allowedMemorySourcePaths: ['A.md'] } },
            { role: 'assistant', content: 'KEEP_INDEPENDENT_CHOICES' },
            { role: 'user', content: '保留第二个方案' },
        ];
        const original = JSON.stringify(history);
        const f = fixture((_body, index) => {
            if (index === 0) {
                f.host.settings.memoryEnabled = false;
                return { httpError: { status: 429, code: 'rate_limit_exceeded', retryAfter: '0.001' } };
            }
            return { text: '继续方案' };
        }, {}, 1);
        f.host.settings.memoryEnabled = true;
        const file = { path: 'A.md', extension: 'md' };
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockReturnValue(file as never);
        await f.run({ images: undefined, prompt: '继续', chatHistory: history,
            ...(stage === 'summary' ? { historyBudgetChars: 1200 } : {}) });
        expect(f.requests[0].stream).toBe(stage === 'answer');
        expect(requestText(f.requests[0])).toContain('REVOKED_HISTORY_MEMORY');
        expect(f.sdkAttempts.filter(attempt => attempt.retryCount === '1')).toEqual([
            { stream: stage === 'answer', retryCount: '1' },
        ]);
        expect(f.requests.length).toBeGreaterThan(1);
        for (const request of f.requests.slice(1)) {
            expect(requestText(request)).not.toContain('REVOKED_HISTORY_MEMORY');
            expect(requestText(request)).toContain('KEEP_INDEPENDENT_CHOICES');
        }
        expect(JSON.stringify(history)).toBe(original);
    });

    it.each(['tags', 'backlinks'] as const)('keeps %s aggregate evidence behind Data Boundary', async kind => {
        const prompt = '查阅 B 的结构';
        const f = fixture([{ tools: [
            kind === 'tags' ? { name: 'list_vault_tags', input: {} }
                : { name: 'inspect_obsidian_note', input: { path: 'B.md' } },
            { name: 'read_note_outline', input: { path: 'B.md' } },
        ] }, { text: '按B继续' }], { operationsIntentController: { stageIntent: async () => { throw new Error('Unexpected write'); } } as never });
        const files = ['HIDDEN_SOURCE_A', 'B'].map(name => ({ path: `${name}.md`, name: `${name}.md`, basename: name,
            extension: 'md', stat: { ctime: 1, mtime: 1, size: 0 } }));
        jest.spyOn(f.host.app.vault, 'getMarkdownFiles').mockReturnValue(files as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockImplementation((...args: unknown[]) => files.find(file => file.path === args[0]) as never);
        Object.assign(f.host, { isDataBoundaryAllowedPath: (path: string) => path !== 'HIDDEN_SOURCE_A.md' });
        jest.spyOn(f.host.app.metadataCache, 'getFileCache').mockImplementation((...args: unknown[]) => ({
            tags: [{ tag: (args[0] as typeof files[0]).basename === 'B' ? '#B' : '#PRIVATE_AGGREGATE_A' }],
            headings: [{ level: 1, heading: 'B_ALLOWED_OUTLINE' }],
        }) as never);
        Object.assign(f.host.app.metadataCache, { resolvedLinks: { 'HIDDEN_SOURCE_A.md': { 'B.md': 1 }, 'B.md': {} }, unresolvedLinks: {} });
        Object.assign(f.host, {
            revalidateVaultObservation: (evidence: never, options?: never) => revalidateVaultObservationFromApp(
                f.host as unknown as AiServiceHost,
                evidence,
                options,
            ),
            getMemoryEvidenceEpoch: () => 'vault-epoch-stable',
        });
        await f.run({ images: undefined, prompt });
        expect(f.requests).toHaveLength(2);
        expect(requestText(f.requests[1])).not.toContain('HIDDEN_SOURCE_A');
        expect(requestText(f.requests[1])).not.toContain('PRIVATE_AGGREGATE_A');
        expect(requestText(f.requests[1])).toContain('B_ALLOWED_OUTLINE');
    });

    it('does not promote a canonical status-only Memory reference into a revoked history dependency', async () => {
        const f = fixture([{ text: 'Continue' }]);
        await f.run({ images: undefined, prompt: '继续', chatHistory: [{ role: 'assistant', content: 'VALID_OLD_CHOICES',
            canonicalTurn: { schemaVersion: 1, runId: 'prior', turnId: 'prior-turn', messages: [], sourceRecords: [
                { kind: 'memory-reference', dedupKey: 'status', path: 'missing.md', statusOnly: true },
            ] },
        }] });
        expect(f.requests).toHaveLength(1);
        expect(requestText(f.requests[0])).toContain('VALID_OLD_CHOICES');
    });

    it.each(['answer', 'summary'] as const)('excludes only a revoked historical assistant reply from %s input', async stage => {
        const history: ChatMessage[] = [
            { role: 'user', content: '保留我的原始要求 ' + (stage === 'summary' ? 'context '.repeat(900) : '') },
            { role: 'assistant', content: 'REVOKED_MIXED_REPLY with facts and proposals', memoryMetadata: {
                hasMemoryContent: false, allowedMemorySourcePaths: [], sourceRecords: [
                    { kind: 'context-used', dedupKey: 'A', path: 'A.md', sourceBoundary: 'read-only-tool' },
                ],
            } },
            { role: 'assistant', content: 'KEPT_ALTERNATIVES 方案一；方案二' },
            { role: 'user', content: '采用第二个方案' },
        ];
        const original = JSON.stringify(history);
        const f = fixture(body => ({ text: body.stream ? '继续第二个方案' : JSON.stringify({
            goals: [{ text: '保留我的原始要求', sourceMessages: [1] }],
            constraints: [], decisions: [], completed: [], open_questions: [], facts: [],
        }) }));
        // A is absent. Legacy messages without source metadata retain continuity.
        await f.run({ images: undefined, prompt: '继续', chatHistory: history,
            ...(stage === 'summary' ? { historyBudgetChars: 1200 } : {}) });
        expect(f.requests.length).toBeGreaterThan(0);
        expect(f.requests.some(request => !request.stream)).toBe(stage === 'summary');
        for (const request of f.requests) expect(requestText(request)).not.toContain('REVOKED_MIXED_REPLY');
        const provided = f.requests.map(requestText).join('\n');
        expect(provided).toContain('保留我的原始要求');
        expect(provided).toContain('KEPT_ALTERNATIVES');
        expect(provided).toContain('采用第二个方案');
        expect(JSON.stringify(history)).toBe(original);
    });

    it.each(['answer', 'summary'] as const)('does not resend replaced history on a %s SDK retry', async stage => {
        const history: ChatMessage[] = [
            { role: 'user', content: 'OLD_HISTORY_TEXT ' + (stage === 'summary' ? 'earlier '.repeat(900) : '') },
            { role: 'assistant', content: '方案一；方案二' },
        ];
        const f = fixture((_body, index) => {
            if (index === 0) {
                history[0].content = 'CORRECTED_HISTORY_TEXT';
                return { httpError: { status: 429, code: 'rate_limit_exceeded', retryAfter: '0.001' } };
            }
            return { text: '采用第二个方案' };
        }, {}, 1);
        await f.run({ images: undefined, prompt: '采用第二个', chatHistory: history,
            ...(stage === 'summary' ? { historyBudgetChars: 1200 } : {}) });
        expect(requestText(f.requests[0])).toContain('OLD_HISTORY_TEXT');
        expect(f.requests[0].stream).toBe(stage === 'answer');
        expect(f.sdkAttempts.filter(attempt => attempt.retryCount === '1')).toEqual([
            { stream: stage === 'answer', retryCount: '1' },
        ]);
        expect(f.requests.length).toBeGreaterThan(1);
        for (const request of f.requests.slice(1)) {
            expect(requestText(request)).not.toContain('OLD_HISTORY_TEXT');
            expect(requestText(request)).toContain('CORRECTED_HISTORY_TEXT');
            expect(requestText(request)).toContain('方案一；方案二');
        }
    });

    it.each(['answer', 'summary'] as const)('rejects a %s SDK retry containing a Vault result after same-path replacement', async stage => {
        const prompt = '读取当前笔记';
        let liveFile = { path: 'A.md', extension: 'md' };
        let revokedAt = -1;
        const f = fixture((body, index) => {
            if (index === 0) return { tools: [
                { name: 'get_current_note_context', input: { mode: 'full' } },
            ] };
            if (revokedAt === -1 && requestText(body).includes('SERIALIZED_VAULT_SECRET')
                && Boolean(body.stream) === (stage === 'answer')) {
                revokedAt = index;
                liveFile = { ...liveFile };
                return { httpError: { status: 429, code: 'rate_limit_exceeded', retryAfter: '0.001' } };
            }
            return { text: body.stream ? 'Source unavailable' : JSON.stringify({
                goals: [], constraints: [], decisions: [], completed: [], open_questions: [], facts: [],
            }) };
        }, stage === 'summary' ? { answerStreamMaxObservationChars: 1200 } : {}, 1);
        const captured = liveFile;
        jest.spyOn(f.host.app.workspace, 'getActiveViewOfType').mockReturnValue({ file: captured,
            editor: { getValue: () => 'SERIALIZED_VAULT_SECRET ' + 'material '.repeat(900), getSelection: () => '', lineCount: () => 1,
                getLine: () => 'SERIALIZED_VAULT_SECRET', getCursor: () => ({ line: 0, ch: 0 }) } } as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockImplementation(() => liveFile as never);
        await f.run({ images: undefined, prompt });
        expect(revokedAt).toBeGreaterThan(0);
        expect(requestText(f.requests[revokedAt])).toContain('SERIALIZED_VAULT_SECRET');
        expect(f.requests[revokedAt].stream).toBe(stage === 'answer');
        // The SDK retry is blocked; the runtime may prepare a fresh invoke
        // fallback. That request must contain no material from the old file.
        expect(f.sdkAttempts.filter(attempt => attempt.retryCount === '1')).toEqual([
            { stream: stage === 'answer', retryCount: '1' },
        ]);
        expect(f.requests.length).toBeGreaterThan(revokedAt + 1);
        for (const request of f.requests.slice(revokedAt + 1)) {
            expect(requestText(request)).not.toContain('SERIALIZED_VAULT_SECRET');
        }
    });

    it('does not deliver writing after a used Vault source is revoked', async () => {
        const prompt = '先读取两篇笔记，再只用B整理';
        const f = fixture((body, index) => {
            if (index === 0) return { tools: [
                { name: 'read_note_outline', input: { path: 'A.md' } },
                { name: 'read_note_outline', input: { path: 'B.md' } },
            ] };
            if (index === 1) {
                Object.assign(f.host, { isDataBoundaryAllowedPath: (path: string) => path !== 'A.md' });
            }
            return { text: envelope('按B整理') };
        }, { operationsIntentController: { stageIntent: async () => { throw new Error('Unexpected write in read-only fixture'); } } as never });
        const files = ['A', 'B'].map(name => ({ path: `${name}.md`, name: `${name}.md`, basename: name,
            extension: 'md', stat: { ctime: 1, mtime: name === 'A' ? 11 : 22, size: name === 'A' ? 31 : 42 } }));
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockImplementation((...args: unknown[]) => files.find(file => file.path === args[0]) as never);
        jest.spyOn(f.host.app.metadataCache, 'getFileCache').mockImplementation((...args: unknown[]) => ({
            headings: [{ level: 1, heading: (args[0] as typeof files[0]).basename === 'A' ? 'A_PRIVATE_MATERIAL' : 'B_ALLOWED_MATERIAL' }],
        }) as never);
        f.host.settings.memoryEnabled = true;
        f.host.getMemoryExtractionPromptContext.mockReturnValue({ memoryContextMode: 'governed', governedMemoryContext: 'VALID_PERSONAL_BACKGROUND' });
        await f.run({ images: undefined, prompt, writingRequest: { requestId: 'writing-1' } });
        expect(f.lifecycle.filter(event => event.type === 'message_end' && event.message.role === 'toolResult').map(event => event.type === 'message_end' ? event.message : null)).not.toEqual(expect.arrayContaining([expect.objectContaining({ isError: true })]));
        expect(f.requests).toHaveLength(2);
        expect(requestText(f.requests[1])).toContain('A_PRIVATE_MATERIAL');
        expect(requestText(f.requests[1])).toContain('B_ALLOWED_MATERIAL');
        expect(requestText(f.requests[1])).toContain('VALID_PERSONAL_BACKGROUND');
        expect(f.events.some(event => event.kind === 'writing-artifact')).toBe(false);
        expect(f.events.some(event => event.kind === 'writing-recovery')).toBe(true);
    });

    it('does not publish internal Memory path enumeration as a source directory', async () => {
        const prompt = 'Search my notes for a matching idea';
        const f = fixture([{ tools: [
            { name: 'search_memory', input: { query: 'matching idea' } },
        ] }, { text: 'No matching notes found' }]);
        const file = { path: 'INTERNAL_ENUMERATION_ONLY.md', extension: 'md' };
        jest.spyOn(f.host.app.vault, 'getMarkdownFiles').mockReturnValue([file] as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockReturnValue(file as never);
        f.host.settings.memoryEnabled = true;
        jest.spyOn(f.host.memorySearch, 'ensureReadyForChat').mockResolvedValue({ decision: 'use-memory' });
        const search = jest.spyOn(f.host.memorySearch, 'searchHybrid');
        await f.run({ images: undefined, prompt });
        expect(search).toHaveBeenCalledWith('matching idea', expect.objectContaining({
            noteScope: { allowedPaths: [file.path], excludedPaths: [] },
        }));
        expect(f.requests).toHaveLength(2);
        for (const request of f.requests) expect(requestText(request)).not.toContain(file.path);
    });

    it('does not advertise an excluded current note through host handles', async () => {
        const f = fixture([{}]);
        const file = { path: 'PRIVATE_FILE_NAME.md', extension: 'md' };
        jest.spyOn(f.host.app.workspace, 'getActiveViewOfType').mockReturnValue({ file, editor: {} } as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockReturnValue(file as never);
        Object.assign(f.host, { isDataBoundaryAllowedPath: () => false });
        await f.run({ images: undefined, prompt: 'Continue' });
        expect(f.requests).toHaveLength(1);
        expect(requestText(f.requests[0])).not.toContain(file.path);
        expect(requestText(f.requests[0])).toContain('"currentNoteHandle":null');
    });

    it('preflights a real current-note/Memory batch without source declaration', async () => {
        const prompt = '只用当前笔记的资料整理提纲，保持我的表达习惯';
        const reads = [{ name: 'get_current_note_context', input: { mode: 'full' } },
            { name: 'search_memory', input: { query: 'outline' } }];
        const f = fixture([{ tools: reads }, { text: 'Draft outline' }]);
        const file = { path: 'notes/current.md', name: 'current.md', basename: 'current', extension: 'md', stat: { ctime: 1, mtime: 1, size: 20 } };
        const editor = { getValue: jest.fn(() => 'CURRENT_NOTE_BODY'), getSelection: () => '',
            lineCount: () => 1, getLine: () => 'CURRENT_NOTE_BODY', getCursor: () => ({ line: 0, ch: 0 }) };
        jest.spyOn(f.host.app.workspace, 'getActiveViewOfType').mockReturnValue({ file, editor } as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockImplementation((...args: unknown[]) => args[0] === file.path ? file as never : null);
        jest.spyOn(f.host.app.vault, 'getMarkdownFiles').mockReturnValue([file] as never);
        f.host.settings.memoryEnabled = true;
        f.host.getMemoryExtractionPromptContext.mockReturnValue({ memoryContextMode: 'governed', governedMemoryContext: 'VALID_PERSONAL_BACKGROUND' });
        const ready = jest.spyOn(f.host.memorySearch, 'ensureReadyForChat').mockResolvedValue({ decision: 'use-memory' });
        const search = jest.spyOn(f.host.memorySearch, 'searchHybrid');
        await f.run({ images: undefined, prompt });
        expect(f.requests[0].tools?.some(tool => tool.function.name === 'declare_source_scope')).toBe(false);
        expect(requestText(f.requests[0])).toContain('VALID_PERSONAL_BACKGROUND');
        expect(requestText(f.requests[0])).not.toContain('CURRENT_NOTE_BODY');
        expect(editor.getValue).toHaveBeenCalledTimes(1);
        expect(search).toHaveBeenCalledWith('outline', expect.objectContaining({
            noteScope: { allowedPaths: [file.path], excludedPaths: [] },
        }));
        expect(ready).toHaveBeenCalledWith('outline', expect.anything(), expect.anything(), undefined);
        expect(f.requests.slice(1).some(request => requestText(request).includes('CURRENT_NOTE_BODY'))).toBe(true);
    });

    it('keeps current-note task material, Personal, existing Memory and authorized style in one physical writing input', async () => {
        const prompt = '只用当前笔记整理一段邀请，保持我的表达习惯';
        const f = fixture([
            { tools: [
                { name: 'get_current_note_context', input: { mode: 'full' } },
            ] },
            { text: envelope('COMBINED_SOURCE_WRITING') },
        ]);
        const current = { path: 'notes/current.md', name: 'current.md', basename: 'current', extension: 'md',
            stat: { ctime: 1, mtime: 23, size: 41 } };
        const other = { path: 'notes/other.md', name: 'other.md', basename: 'other', extension: 'md',
            stat: { ctime: 1, mtime: 29, size: 53 } };
        const editor = { getValue: jest.fn(() => 'CURRENT_NOTE_TASK_MATERIAL'), getSelection: () => '',
            lineCount: () => 1, getLine: () => 'CURRENT_NOTE_TASK_MATERIAL', getCursor: () => ({ line: 0, ch: 0 }) };
        jest.spyOn(f.host.app.workspace, 'getActiveViewOfType').mockReturnValue({ file: current, editor } as never);
        jest.spyOn(f.host.app.vault, 'getAbstractFileByPath').mockImplementation((...args: unknown[]) => {
            const found = [current, other].find(file => file.path === args[0]);
            return (found ?? null) as never;
        });
        jest.spyOn(f.host.app.vault, 'getMarkdownFiles').mockReturnValue([current, other] as never);
        const memoryContext = {
            memoryContextMode: 'governed' as const,
            governedMemoryContext: 'PERSONAL_PROFILE_SENTINEL\nEXISTING_MEMORY_SENTINEL',
        };
        Object.defineProperties(memoryContext, {
            isSourceCurrent: { value: () => true },
            generationInputSources: { value: {
                personal: { state: 'identified', mode: 'governed',
                    revisions: [{ claimId: 'personal-claim', revisionId: 'personal-revision' }] },
                insights: { state: 'unknown', mode: 'governed' },
            } },
        });
        f.host.settings.memoryEnabled = true;
        f.host.getMemoryExtractionPromptContext.mockReturnValue(memoryContext);
        const styleText = '<writing_style context_only="true">AUTHORIZED_STYLE_SAMPLE_SENTINEL</writing_style>';
        const prepareWritingStyle = jest.fn(async () => ({
            context: styleText,
            revisionIds: ['authorized-style-revision'],
            isCurrent: () => true,
            isSourceCurrent: () => true,
        }));

        await f.run({ images: undefined, prompt, writingRequest: { requestId: 'writing-1' }, prepareWritingStyle });

        expect(f.requests).toHaveLength(2);
        const finalInput = requestText(f.requests[1]);
        expect(finalInput).toContain('CURRENT_NOTE_TASK_MATERIAL');
        expect(finalInput).toContain('PERSONAL_PROFILE_SENTINEL');
        expect(finalInput).toContain('EXISTING_MEMORY_SENTINEL');
        expect(finalInput).toContain('AUTHORIZED_STYLE_SAMPLE_SENTINEL');
        expect(finalInput).not.toContain(other.path);
        const artifact = f.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> =>
            event.kind === 'writing-artifact');
        expect(artifact?.generationInput).toMatchObject({
            schemaVersion: 2,
            task: { state: 'identified', sources: [expect.objectContaining({
                purpose: 'task_material',
                path: current.path,
                revision: { state: 'identified', basis: 'editor_snapshot',
                    digest: { algorithm: 'sha1', scope: 'editor_projection', value: expect.stringMatching(/^[a-f0-9]{40}$/) } },
            })] },
            lineage: { state: 'unknown' },
            personal: { state: 'identified', mode: 'governed',
                revisions: [{ claimId: 'personal-claim', revisionId: 'personal-revision' }] },
            insights: { state: 'unknown', mode: 'governed' },
            style: { state: 'identified', revisionIds: ['authorized-style-revision'] },
        });
        expect(artifact?.generationInput?.task.sources[0].revision).not.toHaveProperty('stat');
        expect(JSON.stringify(artifact?.generationInput)).not.toContain(other.path);
    });
});

describe.each([
    { label: 'Personal', tag: '<user_profile context_only="true"',
        context: (text: string): Record<string, unknown> => ({ memoryContextMode: 'legacy', userProfile: `# User Profile\n- ${text}` }) },
    { label: 'governed Memory', tag: '<governed_memory_projection context_only="true"',
        context: (text: string): Record<string, unknown> => ({ memoryContextMode: 'governed', governedMemoryContext: text }) },
])('B-135 T14 background refresh: $label', background => {
    const oldText = 'T14_OLD_BACKGROUND_SENTINEL';
    const newText = 'T14_CURRENT_BACKGROUND_SENTINEL';
    const changes = ['removed', 'replaced'] as const;

    function configureBackground(f: ReturnType<typeof fixture>, change: typeof changes[number]) {
        let context: Record<string, unknown> | undefined = background.context(oldText);
        f.host.settings.memoryEnabled = true;
        f.host.getMemoryExtractionPromptContext.mockImplementation(() => context);
        return () => { context = change === 'removed' ? undefined : background.context(newText); };
    }

    function expectCurrentRequest(request: RequestBody, change: typeof changes[number]) {
        const text = requestText(request);
        expect(text).not.toContain(oldText);
        if (change === 'replaced') {
            expect(text).toContain(newText);
            expect(text).toContain(background.tag);
        } else {
            expect(text).not.toContain(background.tag);
        }
    }

    it('keeps a valid non-empty background in the actual provider body', async () => {
        const f = fixture([{}]);
        configureBackground(f, 'replaced');
        await f.run({ images: undefined, prompt: 'Continue our discussion' });
        expect(f.requests).toHaveLength(1);
        expect(requestText(f.requests[0])).toContain(oldText);
        expect(requestText(f.requests[0])).toContain(background.tag);
    });

    it.each(changes)('refreshes %s background after model construction without a style callback', async change => {
        const f = fixture([{}]);
        const changeBackground = configureBackground(f, change);
        let modelWaits = 0;
        f.afterModelCreated(async isSummary => {
            if (isSummary) return;
            modelWaits++;
            await Promise.resolve();
            changeBackground();
        });
        await f.run({ images: undefined, prompt: 'Continue our discussion' });
        expect(modelWaits).toBe(1);
        expect(f.requests).toHaveLength(1);
        expectCurrentRequest(f.requests[0], change);
    });

    it.each(changes)('refreshes %s background after asynchronous style preparation', async change => {
        const f = fixture([{ text: envelope() }]);
        const changeBackground = configureBackground(f, change);
        const styleText = '<writing_style context_only="true">T14_VALID_STYLE_SENTINEL</writing_style>';
        const prepareWritingStyle = jest.fn(async () => {
            await Promise.resolve();
            changeBackground();
            return { context: styleText, revisionIds: ['t14-style'], isCurrent: () => true, isSourceCurrent: () => true };
        });
        await f.run({ images: undefined, prompt: 'Write a short paragraph', writingRequest: { requestId: 'writing-1' }, prepareWritingStyle });
        expect(prepareWritingStyle).toHaveBeenCalled();
        expect(f.requests).toHaveLength(1);
        expectCurrentRequest(f.requests[0], change);
        expect(requestText(f.requests[0])).toContain(styleText);
        expect(f.events.find(event => event.kind === 'writing-artifact')).toMatchObject({ styleRevisionIds: ['t14-style'] });
    });

    it.each(changes)('blocks already formatted messages when background is %s before physical SDK dispatch', async change => {
        const f = fixture(() => ({}));
        const changeBackground = configureBackground(f, change);
        let changed = false;
        f.beforeSdkDispatch(() => {
            if (changed) return;
            changed = true;
            changeBackground();
        });
        const signal = new AbortController().signal;
        const outcome = await f.run({ images: undefined, prompt: 'Continue our discussion', signal })
            .then(() => ({ ok: true }), () => ({ ok: false }));
        expect(changed).toBe(true);
        expect(signal.aborted).toBe(false);
        // This observer runs after real ChatOpenAI formatting. The old body
        // existed at the SDK boundary, so an always-empty prompt cannot pass.
        expect(JSON.stringify(f.observed[0].map(message => message.content))).toContain(oldText);
        expect(f.sdkAttempts.length).toBeGreaterThan(0);
        for (const request of f.requests) expectCurrentRequest(request, change);
        if (outcome.ok) expect(f.requests.length).toBeGreaterThan(0);
        else expect(f.requests).toHaveLength(0);
    });

    it.each(changes)('blocks the real SDK 429 retry after background is %s', async change => {
        let changeBackground = () => {};
        let changed = false;
        const f = fixture((_body, index) => {
            if (index > 0) return {};
            queueMicrotask(() => { changed = true; changeBackground(); });
            return { httpError: { status: 429, code: 'rate_limit_exceeded', retryAfter: '0.001' } };
        }, {}, 1);
        changeBackground = configureBackground(f, change);
        const signal = new AbortController().signal;
        const outcome = await f.run({ images: undefined, prompt: 'Continue our discussion', signal })
            .then(() => ({ ok: true }), () => ({ ok: false }));
        expect(changed).toBe(true);
        expect(signal.aborted).toBe(false);
        expect(requestText(f.requests[0])).toContain(oldText);
        expect(f.sdkAttempts.slice(0, 2)).toEqual([{ stream: true, retryCount: '0' }, { stream: true, retryCount: '1' }]);
        // The first request preceded revocation. Every later actual fetch must
        // use a newly prepared projection; an SDK retry may never resend it.
        for (const request of f.requests.slice(1)) expectCurrentRequest(request, change);
        if (outcome.ok) expect(f.requests.length).toBeGreaterThan(1);
        else expect(f.requests).toHaveLength(1);
    });
});

function repeatedSummaryPreparation(calls: number, preserveCoveredSource: boolean): PaAgentContextSummarizer {
    return {
        prepareHistory: async (input: { history: readonly ChatMessage[];
            invoke: (payload: PaAgentSummaryRequest, signal: AbortSignal) => Promise<unknown>;
            signal?: AbortSignal }) => {
            const source = input.history[0];
            const payload: PaAgentSummaryRequest = {
                messages: [{ role: 'system', content: 'Summarize the bound source as JSON.' },
                    { role: 'user', content: JSON.stringify({ sourceMessages: [1] }) }],
                maxOutputTokens: 256,
                bindingSources: [{ index: 1, role: source.role, content: source.content }],
                bindingSourceMessages: [source],
            };
            for (let index = 0; index < calls; index++) {
                await input.invoke(payload, input.signal ?? new AbortController().signal);
            }
            return preserveCoveredSource ? { sourceMessages: input.history, text: JSON.stringify({
                goals: [], constraints: [{ text: 'Export must remain offline.', sourceMessages: [1] }],
                decisions: [], completed: [], open_questions: [], facts: [],
            }) } : undefined;
        },
        prepareTool: async () => undefined,
    } as unknown as PaAgentContextSummarizer;
}

describe('B-135 T14 selected-image history summary', () => {
    it.each(['cancelled', 'source_changed'] as const)(
    'keeps late summary usage but never records %s response text or reasoning in Debug', async state => {
        const controller = new AbortController();
        let current = true;
        const debugEvents: AgentDebugObservation[] = [];
        const debugRecorder: AgentDebugRunRecorder = {
            captureId: 'late-summary-debug', enabled: () => true,
            bindRun: () => undefined, finish: () => undefined,
            observe: event => { debugEvents.push(event); },
        };
        const f = fixture(() => { throw new Error('The fake model must not use HTTP'); },
            { contextSummarizer: repeatedSummaryPreparation(1, false) });
        const createModel = AIUtils.prototype.createChatModel as jest.MockedFunction<AIUtils['createChatModel']>;
        const normalCreateModel = createModel.getMockImplementation()!;
        createModel.mockImplementation(async function (this: AIUtils, temperature, modelOptions) {
            if (modelOptions?.maxTokens !== 256) return normalCreateModel.call(this, temperature, modelOptions);
            return ({
            invoke: async () => {
                await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
                    '{"messages":[]}', () => false, { call: modelOptions.agentDebugCall });
                if (state === 'cancelled') controller.abort(); // The model ignores its signal and resolves late.
                else current = false;
                return { content: 'LATE_CANCELLED_SUMMARY',
                    additional_kwargs: { reasoning_content: 'LATE_CANCELLED_REASON' },
                    usage_metadata: { input_tokens: 5, output_tokens: 2 } };
            },
            }) as never;
        });
        let accounting: { knownPhysicalTokens: number; attempts: Array<{ purpose: string; totalTokens?: number }> } | undefined;
        await f.run({ images: undefined, prompt: 'Continue with prior requirements',
            chatHistory: [{ role: 'user', content: 'Export must remain offline. ' + 'context '.repeat(1_000) },
                { role: 'assistant', content: 'Keep this requirement. ' + 'detail '.repeat(1_000) }],
            historyBudgetChars: 1200, signal: controller.signal, isCurrent: () => current, debugRecorder,
            onUsageAccounting: snapshot => { accounting = snapshot; } }).catch(() => undefined);
        expect(createModel.mock.calls.some(([, options]) => options?.maxTokens === 256)).toBe(true);
        expect(accounting?.knownPhysicalTokens).toBe(7);
        expect(accounting?.attempts).toEqual(expect.arrayContaining([expect.objectContaining({
            purpose: 'context_summary', totalTokens: 7,
        })]));
        expect(debugEvents.some(event => event.text?.includes('LATE_CANCELLED_SUMMARY')
            || event.reasoning?.includes('LATE_CANCELLED_REASON'))).toBe(false);
        expect(f.events.some(event => event.kind === 'answer-snapshot')).toBe(false);
    });

    it('bounds actual auxiliary SDK retries at 30 physical requests and leaves required context in local overflow', async () => {
        const history: ChatMessage[] = [
            { role: 'user', content: 'Export must remain offline. ' + 'context '.repeat(1_000) },
            { role: 'assistant', content: 'Keep this requirement. ' + 'detail '.repeat(1_000) },
        ];
        const f = fixture((_body, index) => index === 29
            ? { httpError: { status: 429, code: 'rate_limit', retryAfter: '0' } }
            : { text: '{}' }, { contextSummarizer: repeatedSummaryPreparation(30, false) }, 1);
        let accounting: { attempts: Array<{ purpose: string; estimatedPromptTokens?: number }> } | undefined;
        await expect(f.run({ images: undefined, prompt: 'Compare all prior requirements',
            chatHistory: history, historyBudgetChars: 1200,
            onUsageAccounting: snapshot => { accounting = snapshot; } }))
            .rejects.toThrow('context_local_overflow');
        expect(f.requests).toHaveLength(30);
        expect(f.requests.every(request => request.stream === false)).toBe(true);
        expect(f.requests.every(request => Number((request as RequestBody & { max_tokens?: number }).max_tokens) === 256)).toBe(true);
        expect(f.sdkAttempts).toHaveLength(31); // The SDK tried one more retry; local admission blocked its fetch.
        expect(f.sdkAttempts.at(-1)?.retryCount).toBe('1');
        const summaryAttempts = accounting?.attempts.filter(attempt => attempt.purpose === 'context_summary') ?? [];
        expect(summaryAttempts).toHaveLength(30);
        expect(summaryAttempts.every(attempt => (attempt.estimatedPromptTokens ?? 0) > 0)).toBe(true);
        expect(summaryAttempts.reduce((total, attempt) => total + attempt.estimatedPromptTokens! + 256, 0))
            .toBeLessThanOrEqual(90_000);
        expect(f.events.some(event => event.kind === 'answer-snapshot')).toBe(false);
    });

    it('uses SDK reported prompt usage to stop later optional summaries before the request cap', async () => {
        const history: ChatMessage[] = [
            { role: 'user', content: 'Export must remain offline. ' + 'context '.repeat(1_000) },
            { role: 'assistant', content: 'Keep this requirement. ' + 'detail '.repeat(1_000) },
        ];
        const f = fixture(() => ({ text: '{}', usage: {
            prompt_tokens: 10_000, completion_tokens: 20, total_tokens: 10_020,
        } }), { contextSummarizer: repeatedSummaryPreparation(10, false) });
        let accounting: { attempts: Array<{ purpose: string; measuredPromptTokens?: number;
            estimatedPromptTokens?: number }> } | undefined;
        await expect(f.run({ images: undefined, prompt: 'Compare all prior requirements',
            chatHistory: history, historyBudgetChars: 1200,
            onUsageAccounting: snapshot => { accounting = snapshot; } }))
            .rejects.toThrow('context_local_overflow');
        expect(f.requests).toHaveLength(9); // The tenth optional request exceeds 90k known-or-reserved tokens.
        const summaries = accounting?.attempts.filter(attempt => attempt.purpose === 'context_summary') ?? [];
        expect(summaries).toHaveLength(9);
        expect(summaries.every(attempt => attempt.measuredPromptTokens === 10_000
            && (attempt.estimatedPromptTokens ?? Infinity) < 10_000)).toBe(true);
        expect(f.events.some(event => event.kind === 'answer-snapshot')).toBe(false);
    });

    it('lets the main answer continue when the final admitted summary already preserves required context', async () => {
        const history: ChatMessage[] = [
            { role: 'user', content: 'Export must remain offline. ' + 'context '.repeat(1_000) },
            { role: 'assistant', content: 'Keep this requirement. ' + 'detail '.repeat(1_000) },
        ];
        const f = fixture((body, index) => index < 30 ? { text: '{}' } : { text: 'Final answer from preserved context.' },
            { contextSummarizer: repeatedSummaryPreparation(30, true) });
        let accounting: { attempts: Array<{ purpose: string }> } | undefined;
        await f.run({ images: undefined, prompt: 'Compare all prior requirements',
            chatHistory: history, historyBudgetChars: 1200,
            onUsageAccounting: snapshot => { accounting = snapshot; } });
        expect(f.requests.filter(request => request.stream === false)).toHaveLength(30);
        expect(f.requests.filter(request => request.stream === true)).toHaveLength(1);
        expect(accounting?.attempts.filter(attempt => attempt.purpose === 'context_summary')).toHaveLength(30);
        expect(f.events.some(event => event.kind === 'answer-snapshot')).toBe(true);
    });

    it('retains measured summary usage when the image source changes after HTTP response', async () => {
        let invalidate: () => void = () => undefined;
        const debugEvents: AgentDebugObservation[] = [];
        const debugRecorder: AgentDebugRunRecorder = {
            captureId: 'stale-summary-debug', enabled: () => true,
            bindRun: () => undefined, finish: () => undefined,
            observe: event => { debugEvents.push(event); },
        };
        const f = fixture((body) => body.stream ? { text: 'Stale summary must not reach an answer.' } : {
            text: JSON.stringify({ goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
                facts: [{ text: 'STALE SUMMARY RESPONSE', sourceMessages: [1] }] }),
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
            onEnd: () => invalidate(),
        });
        invalidate = f.invalidate;
        let accounting: { attempts: Array<{ purpose: string; totalTokens?: number; complete: boolean }>; knownPhysicalTokens: number } | undefined;
        await f.run({ prompt: 'Continue our discussion', historyBudgetChars: 1200,
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'summary-stale-image', userMessageId: 'summary-user' },
            chatHistory: [{ role: 'user', content: 'Historical source fact. ' + 'context '.repeat(800), images: [image(1)],
                inputLineage: { schemaVersion: 1, completeness: 'complete', dependencies: [
                    { kind: 'user-text', messageId: 'history-user' },
                    { kind: 'attachment', ownerMessageId: 'history-user', ref: image(1).ref },
                ] } },
            { role: 'assistant', content: 'Prior alternatives. ' + 'detail '.repeat(800),
                inputLineage: { schemaVersion: 1, completeness: 'complete', dependencies: [
                    { kind: 'user-text', messageId: 'history-user' },
                    { kind: 'attachment', ownerMessageId: 'history-user', ref: image(1).ref },
                ] } }],
            debugRecorder,
            onUsageAccounting: snapshot => { accounting = snapshot; } }).catch(() => undefined);
        expect(f.requests.some(request => request.stream === false)).toBe(true);
        expect(accounting?.attempts).toEqual(expect.arrayContaining([expect.objectContaining({
            purpose: 'context_summary', totalTokens: 7, complete: false,
        })]));
        expect(accounting?.knownPhysicalTokens).toBeGreaterThanOrEqual(7);
        expect(f.events.some(event => event.kind === 'answer-snapshot'
            && JSON.stringify(event).includes('STALE SUMMARY RESPONSE'))).toBe(false);
        expect(debugEvents.some(event => event.text?.includes('STALE SUMMARY RESPONSE')
            || event.reasoning?.includes('STALE SUMMARY RESPONSE'))).toBe(false);
    });

    it.each(['valid', 'revoked'] as const)('preserves selected-image summary preparation for %s sources', async state => {
        const f = fixture(body => ({ text: body.stream ? 'Current answer' : JSON.stringify({
            goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
            facts: [{ text: 'Historical source fact', sourceMessages: [1] }],
        }) }));
        if (state === 'revoked') f.beforeSdkDispatch(() => f.invalidate());
        const running = f.run({ prompt: 'Continue our discussion', historyBudgetChars: 1200,
            chatHistory: [{ role: 'user', content: 'Historical source fact. ' + 'context '.repeat(800) },
                { role: 'assistant', content: 'Prior alternatives. ' + 'detail '.repeat(800) }] });
        if (state === 'revoked') {
            await expect(running).rejects.toThrow('PA Agent canonical runtime failed');
            expect(f.requests).toHaveLength(0);
        } else {
            await running;
            const summaries = f.requests.filter(request => !request.stream);
            expect(summaries.length).toBeGreaterThan(0);
            for (const request of summaries) expect(pixels(request)).toEqual([]);
            const answer = f.requests.find(request => request.stream);
            expect(answer).toBeDefined();
            expect(pixels(answer!)).toEqual([{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } }]);
        }
        expect(f.service.resolveVariant).toHaveBeenCalledTimes(1);
        expect(f.release).toHaveBeenCalledTimes(1);
    });
});

it('B-135 T14 keeps grown Memory and drops style that no longer fits after preparation', async () => {
    const f = fixture([{ text: envelope() }]);
    const oldText = 'T14_SMALL_MEMORY_SENTINEL';
    const grownText = 'T14_GROWN_MEMORY_SENTINEL';
    const styleText = `<writing_style context_only="true">T14_OVER_BUDGET_STYLE_SENTINEL ${'s'.repeat(200)}</writing_style>`;
    const wrapperChars = formatInjectedContext({ memoryContextMode: 'governed', governedMemoryContext: 'x' }).length - 1;
    const grownContext = { memoryContextMode: 'governed' as const,
        governedMemoryContext: grownText + 'x'.repeat(MEMORY_CONTEXT_MAX_CHARS - wrapperChars - grownText.length - 100) };
    expect(formatInjectedContext(grownContext).length).toBe(MEMORY_CONTEXT_MAX_CHARS - 100);
    expect(styleText.length).toBeGreaterThan(100);
    f.host.settings.memoryEnabled = true;
    f.host.getMemoryExtractionPromptContext.mockReturnValue({ memoryContextMode: 'governed', governedMemoryContext: oldText });
    const prepareWritingStyle = jest.fn(async (input: { remainingTextChars: number; remainingMemoryChars: number }) => {
        // The style really fits the initial budget. Only the intervening source
        // change makes it ineligible; final projection must preserve new Memory.
        expect(styleText.length).toBeLessThan(input.remainingMemoryChars);
        expect(styleText.length).toBeLessThan(input.remainingTextChars);
        await Promise.resolve();
        f.host.getMemoryExtractionPromptContext.mockReturnValue(grownContext);
        return { context: styleText, revisionIds: ['t14-over-budget-style'], isCurrent: () => true, isSourceCurrent: () => true };
    });
    await f.run({ images: undefined, prompt: 'Write a short paragraph', writingRequest: { requestId: 'writing-1' }, prepareWritingStyle });
    expect(prepareWritingStyle).toHaveBeenCalledTimes(1);
    expect(f.requests).toHaveLength(1);
    expect(requestText(f.requests[0])).toContain(grownContext.governedMemoryContext);
    expect(requestText(f.requests[0])).not.toContain(oldText);
    expect(requestText(f.requests[0])).not.toContain('T14_OVER_BUDGET_STYLE_SENTINEL');
    expect(f.events.find(event => event.kind === 'writing-artifact')).toMatchObject({ styleRevisionIds: [] });
});

describe("B-129 production runtime with real ChatOpenAI/bindTools and offline transport", () => {
    it('B-135 blocks a summary SDK retry after the request epoch changes', async () => {
        let current = true;
        const f = fixture((_body, index) => {
            if (index !== 0) throw new Error('Revoked summary reached the provider');
            queueMicrotask(() => { current = false; });
            return { httpError: { status: 429, code: 'rate_limit_exceeded', retryAfter: '0.001' } };
        }, {}, 1);
        await expect(f.run({ images: undefined, prompt: 'Continue', isCurrent: () => current,
            historyBudgetChars: 1200, chatHistory: [
                { role: 'user', content: 'Prior request. ' + 'context '.repeat(800) },
                { role: 'assistant', content: 'Prior alternatives. ' + 'detail '.repeat(800) },
            ] })).rejects.toThrow('PA Agent canonical runtime failed');
        expect(f.requests).toHaveLength(1);
        expect(f.requests[0].stream).toBe(false);
        expect(f.sdkAttempts).toEqual([{ stream: false, retryCount: '0' }, { stream: false, retryCount: '1' }]);
    });

    it.each(['model_wait', 'physical_dispatch', 'valid'] as const)(
        'B-135 revalidates summary requests at %s without requiring signal cancellation', async phase => {
            let current = true;
            let summariesPrepared = 0;
            const f = fixture(body => ({ text: body.stream ? 'Current answer' : JSON.stringify({
                goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
                facts: [{ text: 'Historical source fact', sourceMessages: [1] }],
            }) }));
            f.afterModelCreated(async isSummary => {
                if (!isSummary) return;
                summariesPrepared++;
                await Promise.resolve();
                if (phase === 'model_wait') current = false;
            });
            f.beforeSdkDispatch(() => { if (phase === 'physical_dispatch') current = false; });
            const signal = new AbortController().signal;
            const running = f.run({ images: undefined, prompt: 'Continue the discussion', signal,
                isCurrent: () => current, historyBudgetChars: 1200,
                chatHistory: [{ role: 'user', content: 'Historical source fact. ' + 'context '.repeat(800) },
                    { role: 'assistant', content: 'Two proposed alternatives. ' + 'detail '.repeat(800) }] });
            if (phase === 'valid') await running;
            else await expect(running).rejects.toThrow('PA Agent canonical runtime failed');
            expect(signal.aborted).toBe(false);
            expect(summariesPrepared).toBeGreaterThan(0);
            if (phase === 'valid') {
                expect(f.requests.some(request => !request.stream)).toBe(true);
                expect(f.requests.some(request => request.stream)).toBe(true);
            } else {
                expect(f.requests).toHaveLength(0);
            }
        });

    it("sends image-only current input as real image blocks, with no image bytes in canonical events or diagnostics", async () => {
        const f = fixture([{}]); await f.run({ prompt: "" });
        expect(f.requests).toHaveLength(1); expect(pixels(f.requests[0])).toEqual([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } }]);
        expect(f.observed[0][1]._getType()).toBe("human"); expect(f.observed[0][1].content).toHaveLength(2);
        expect(JSON.stringify([f.events, f.lifecycle, f.host.log.mock.calls])).not.toMatch(/data:image|base64|synthetic-fixture-token/);
        expect(f.lifecycle.some((event) => event.type === "message_end" && event.message.role === "user" && event.message.images?.[0].ref.assetId === "image-1")).toBe(true);
        expect(f.release).toHaveBeenCalledTimes(1);
    });

    it("registers old image refs through the real tool executor and carries ordered pixels into the next turn", async () => {
        const f = fixture([{ tool: { name: "resolve_chat_images", input: { refs: [image(2).ref] } } }, {}]);
        await f.run({ chatHistory: [{ role: "user", content: "old material", images: [image(2)] }, { role: "assistant", content: "prior answer" }] });
        expect(f.requests).toHaveLength(2); expect(pixels(f.requests[0])).toHaveLength(1); expect(pixels(f.requests[1])).toHaveLength(2);
        expect(requestText(f.requests[0])).toContain(image(2).ref.contentHash); expect(requestText(f.requests[1])).toContain("registered_for_request");
        expect(f.service.resolveVariant).toHaveBeenCalledTimes(2); expect(f.release).toHaveBeenCalledTimes(2);
    });

    it.each(["artifact", "recovery"])("retains a tool-resolved historical image in the host writing %s receipt", async (kind) => {
        const body = envelope();
        const f = fixture([{ tool: { name: "resolve_chat_images", input: { refs: [image(3).ref] } } },
            { text: kind === "artifact" ? body : `\u0060\u0060\u0060json\n${body}\n\u0060\u0060\u0060\nAdditional explanation` }]);
        await f.run({ images: [], prompt: "继续刚才的文案任务：请重新查看第3张图片", writingRequest: { requestId: "writing-1" },
            chatHistory: [{ role: "user", content: "unrelated image question", images: [image(1)] },
                { role: "assistant", content: "answer" }, { role: "user", content: "write about this", images: [image(3)] }] });
        expect(pixels(f.requests[0])).toHaveLength(0); expect(pixels(f.requests[1])).toHaveLength(1);
        expect(f.events.find((event) => event.kind === `writing-${kind}`)).toMatchObject({ associatedImages: [image(3)] });
        expect(f.events.some((event) => event.kind === (kind === "artifact" ? "writing-recovery" : "writing-artifact"))).toBe(false);
    });

    it("retries streaming as invoke with the same pixels and requestId, then emits only the validated body", async () => {
        const f = fixture([{ error: new Error("setup failed with data:image/jpeg;base64,SECRET") }, { text: envelope() }]);
        await f.run({ writingRequest: { requestId: "writing-1" } });
        expect(f.requests.map((request) => request.stream === true)).toEqual([true, false]); expect(pixels(f.requests[0])).toEqual(pixels(f.requests[1]));
        expect(f.service.resolveVariant).toHaveBeenCalledTimes(1); expect(f.service.verify.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(f.events.find((event) => event.kind === "writing-artifact")).toMatchObject({ body: '正文："海风"\n🌊', requestId: "writing-1" });
        expect(f.events.filter((event) => event.kind === "answer-snapshot")).toEqual([expect.objectContaining({ snapshot: '正文："海风"\n🌊' })]);
        expect(JSON.stringify([f.events, f.lifecycle, f.host.log.mock.calls])).not.toContain("SECRET");
    });

    it("keeps images and final JSON instructions in a reserved final turn with only the incomplete output tool", async () => {
        const f = fixture([{ text: envelope() }], { maxWallClockMs: 10_000, finalizationReserveMs: 10_000 });
        await f.run({ writingRequest: { requestId: "writing-1" } });
        expect(f.requests).toHaveLength(1);
        expect(f.requests[0].tools?.map(tool => tool.function.name)).toEqual(['report_task_incomplete']);
        expect(pixels(f.requests[0])).toHaveLength(1);
        expect(requestText(f.requests[0])).toContain('"requestId":"writing-1"');
        expect(f.events.some((event) => event.kind === "writing-artifact")).toBe(true);
    });

    it.each(["length", "content_filter", null, "other-reason"])("does not promote legal JSON with provider completion %s", async (finish) => {
        const f = fixture([{ text: envelope(), finish }]); await f.run({ writingRequest: { requestId: "writing-1" } });
        expect(f.events.some((event) => event.kind === "writing-artifact" || event.kind === "answer-snapshot")).toBe(false);
        expect(f.events.find((event) => event.kind === "writing-recovery")).toMatchObject({ rawText: envelope(), reason: "provider_incomplete" });
    });

    it.each(['completed', 'provider_incomplete', 'source_changed'] as const)('keeps the host completion and source guards for a single JSON fence: %s', async (state) => {
        const exactBody = '  正文："海风"\r\n🌊\n```\n';
        const rawText = ` \r\n\u0060\u0060\u0060JSON\r\n${envelope(exactBody)}\r\n\u0060\u0060\u0060\n `;
        const f = fixture([{ text: rawText, finish: state === 'provider_incomplete' ? 'length' : 'stop',
            onEnd: () => { if (state === 'source_changed') f.invalidate(); } }]);
        await f.run({ writingRequest: { requestId: 'writing-1' } });
        expect(f.requests).toHaveLength(1);
        if (state === 'completed') {
            expect(f.events.find((event) => event.kind === 'writing-artifact')).toMatchObject({
                requestId: 'writing-1', body: exactBody, associatedImages: [image(1)],
            });
            expect(f.events.filter((event) => event.kind === 'answer-snapshot')).toEqual([
                expect.objectContaining({ snapshot: exactBody }),
            ]);
            expect(f.events.some((event) => event.kind === 'writing-recovery')).toBe(false);
        } else {
            expect(f.events.some((event) => event.kind === 'writing-artifact' || event.kind === 'answer-snapshot')).toBe(false);
            expect(f.events.find((event) => event.kind === 'writing-recovery')).toMatchObject({ rawText: state === 'source_changed' ? '' : rawText, reason: state });
        }
    });

    it("ordinary text that happens to be an envelope never becomes a writing version", async () => {
        const f = fixture([{ text: envelope() }]); await f.run({ images: [] });
        expect(f.events.some((event) => event.kind.startsWith("writing-"))).toBe(false);
        expect(f.events.find((event) => event.kind === "answer-snapshot")).toMatchObject({ snapshot: envelope() });
        expect(f.service.verify).not.toHaveBeenCalled(); expect(f.service.resolveVariant).not.toHaveBeenCalled();
    });

    it("rejects a source changed during SDK formatting before real native fetch", async () => {
        const f = fixture([{}]);
        // The real post-bind model observer runs AFTER prompt formatting and
        // the runtime's chain guard, but BEFORE native HTTP dispatch.
        f.beforeSdkDispatch(() => f.invalidate());
        await expect(f.run({ writingRequest: { requestId: "writing-1" } })).rejects.toThrow();
        expect(f.requests).toHaveLength(0); expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.events.some((event) => event.kind === "writing-artifact")).toBe(false);
    });

    it("rechecks source changes before invoke fallback and does not silently retry as text", async () => {
        const f = fixture((_request, index) => { if (index === 0) f.invalidate(); return { error: new Error("transport failed") }; });
        await expect(f.run()).rejects.toThrow(); expect(f.requests).toHaveLength(1); expect(pixels(f.requests[0])).toHaveLength(1); expect(f.release).toHaveBeenCalledTimes(1);
    });

    it.each(["image", "style"] as const)("blocks a real SDK internal 429 retry after %s currentness is revoked", async (source) => {
        let styleCurrent = true;
        const f = fixture((_request, index) => {
            if (index !== 0) throw new Error("Revoked input reached a second physical fetch");
            queueMicrotask(() => { if (source === "image") f.invalidate(); else styleCurrent = false; });
            return { httpError: { status: 429, code: "rate_limit_exceeded", retryAfter: "0.001" } };
        }, {}, 1);
        await expect(f.run({ writingRequest: { requestId: "writing-1" }, prepareWritingStyle: async () => ({
            context: "<writing_style>sample</writing_style>", revisionIds: ["style-1"], isCurrent: () => styleCurrent,
        }) })).rejects.toThrow();
        // Both attempts belong to the same stream. The SDK's own retry header
        // distinguishes the second attempt from the runtime's invoke fallback.
        expect(f.sdkAttempts).toEqual([{ stream: true, retryCount: "0" }, { stream: true, retryCount: "1" }]);
        expect(f.requests).toHaveLength(1); expect(pixels(f.requests[0])).toHaveLength(1);
        expect(f.service.resolveVariant).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.events.some((event) => event.kind === "writing-artifact" || event.kind === "answer-snapshot")).toBe(false);
        expect(JSON.stringify([f.events, f.lifecycle, f.host.log.mock.calls])).not.toMatch(/SECRET|data:image|base64/);
    });

    it("uses host parent text and bounded style preparation, invalidating cancellation before submission", async () => {
        const f = fixture([{ text: envelope() }]); let current = true;
        f.host.getMemoryExtractionPromptContext.mockReturnValue({ memoryContextMode: "governed", governedMemoryContext: "ordinary preference" });
        const prepareWritingStyle = jest.fn(async (_input: { remainingTextChars: number; remainingMemoryChars: number }) => ({ context: '<writing_style context_only="true">sample</writing_style>', revisionIds: ["style-1"], isCurrent: () => current }));
        await f.run({ writingRequest: { requestId: "writing-1" }, writingContext: { parentVersionId: "v2", text: "本地修改的 V2，不能退回 V1", textHash: "a".repeat(64), associatedImages: [image(1)] }, prepareWritingStyle });
        expect(requestText(f.requests[0])).toContain("本地修改的 V2"); expect(requestText(f.requests[0])).toContain("<writing_style");
        expect(prepareWritingStyle.mock.calls[0][0].remainingMemoryChars).toBeLessThan(6000);
        expect(f.events.find((event) => event.kind === "writing-artifact")).toMatchObject({
            styleRevisionIds: ["style-1"],
            generationInput: { parent: { state: 'identified', versionId: 'v2',
                textHash: { algorithm: 'sha256', value: 'a'.repeat(64) } } },
        });
        current = false;
        const canonical = f.lifecycle.filter((event) => event.type === "message_end").map((event) => (event as Extract<AgentEvent, { type: "message_end" }>).message);
        const persisted = createPaAgentPersistedTurn({ runId: "r", turnId: "t", messages: canonical, committedFinalText: '正文："海风"\n🌊' });
        expect(JSON.stringify(persisted.messages)).not.toContain("pa.writing");
        expect(persisted.messages.find((message) => message.role === "assistant")).toMatchObject({ content: [{ type: "text", text: '正文："海风"\n🌊' }], providerCompletion: "stop", writingRequestId: "writing-1" });
    });

    it("does not submit if a style is cancelled while the provider responds", async () => {
        let current = true;
        const f = fixture([{ text: envelope(), onEnd: () => { current = false; } }]);
        await f.run({ writingRequest: { requestId: "writing-1" }, prepareWritingStyle: async () => ({ context: "<writing_style>sample</writing_style>", revisionIds: ["style-1"], isCurrent: () => current }) });
        expect(f.events.find((event) => event.kind === "writing-recovery")).toMatchObject({ reason: "source_changed" });
        expect(f.events.some((event) => event.kind === "writing-artifact")).toBe(false);
    });

    it("ChatService exposes capability evidence and a configuration switch clears it", async () => {
        const f = fixture([{}]); const service = new ChatService(f.host as unknown as AiServiceHost);
        expect(service.getImageCapability()).toBe("unknown");
        try { await service.streamLLM("", () => undefined, undefined, [], { images: [image(1)], imageAssetService: f.service as unknown as ImageAssetService }); }
        finally { service.dispose(); }
        expect(service.getImageCapability()).toBe("supported"); f.host.settings.chatModelName = "different";
        expect(service.getImageCapability()).toBe("unknown");
    });

    it("ChatService preserves failed-task material while dispatching only the requested subset", async () => {
        const f = fixture([{ text: envelope() }]); const service = new ChatService(f.host as unknown as AiServiceHost);
        const events: LegacyAgentEvent[] = [];
        try { await service.streamLLM('只用第二张，改短一点', () => undefined, undefined, [], {
            writingRequest: { requestId: 'writing-1' }, writingMaterialContext: { requestId: 'failed-task', associatedImages: [image(1), image(2)] },
            imageAssetService: f.service as unknown as ImageAssetService, onEvent: (event) => events.push(event),
        }); } finally { service.dispose(); }
        expect(pixels(f.requests[0])).toHaveLength(1);
        expect(events.find((event) => event.kind === 'writing-artifact')).toMatchObject({ associatedImages: [image(1), image(2)] });
    });

    it("learns only structured image incompatibility and blocks a repeat before derivative IO", async () => {
        const f = fixture([{ httpError: { status: 400, code: "image_input_not_supported" } }]);
        const service = new ChatService(f.host as unknown as AiServiceHost); const events: LegacyAgentEvent[] = [];
        const send = () => service.streamLLM("describe", () => undefined, undefined, [], { images: [image(1)], imageAssetService: f.service as unknown as ImageAssetService, onEvent: (event) => events.push(event) });
        try {
            await expect(send()).rejects.toThrow(); expect(service.getImageCapability()).toBe("unsupported");
            const processed = f.service.resolveVariant.mock.calls.length;
            await expect(send()).rejects.toThrow(); expect(f.service.resolveVariant).toHaveBeenCalledTimes(processed);
            expect(f.requests).toHaveLength(1); expect(JSON.stringify([events, f.host.log.mock.calls])).not.toContain("SECRET");
        } finally { service.dispose(); }
    });
});

describe("B-129 strict writing protocol and intent", () => {
    it.each(["```json\n" + envelope() + "\n```\nExplanation", envelope() + " tail", envelope().replace('"version":1', '"version":2'), envelope().replace('"writing-1"', '"wrong"'), envelope().replace('{"kind"', '{"sourceMessageIds":[],"kind"')])("rejects an invalid whole response", (text) => {
        expect(decodeWritingOutput(text, { requestId: "writing-1" }, 10_000)).toBeUndefined();
    });
    it("counts full text, preserves exact body and never overwrites completion with a usage-only tail", () => {
        expect(decodeWritingOutput(envelope(), { requestId: "writing-1" }, envelope().length)?.body).toBe('正文："海风"\n🌊');
        expect(decodeWritingOutput(envelope(), { requestId: "writing-1" }, envelope().length - 1)).toBeUndefined();
        expect(readProviderCompletion({ response_metadata: { finish_reason: "stop" } })).toBe("stop");
        expect(readProviderCompletion({ response_metadata: {}, usage_metadata: {} })).toBeUndefined();
    });
    it.each(["短一点", "改写这版", "继续上段", "继续刚才的文案任务：请重新查看第3张图片", "重试上一轮配文", "make it shorter", "rewrite this", "continue the previous writing task"])("recognizes an explicit continuation: %s", (text) => {
        expect(isWritingContinuationPrompt(text)).toBe(true); expect(isWritingRequestPrompt(text, true)).toBe(true);
    });
    it.each(["换个话题，写一封工作邮件", "new topic: write a caption", "这张图是什么", "继续"])("does not inherit material for %s", (text) => {
        expect(isWritingContinuationPrompt(text)).toBe(false);
    });
    it.each(["换个话题，写一封工作邮件", "new topic: write a caption", "帮我写一篇文章", "draft an email"])("recognizes a new writing task without inheriting old material: %s", (text) => {
        expect(isWritingRequestPrompt(text)).toBe(true); expect(isWritingContinuationPrompt(text)).toBe(false);
    });
});

describe("B-140 T-07 vault observation physical integration", () => {
    const installReadHistory = async (
        f: ReturnType<typeof fixture>,
        firstBody: string,
        secondBody: string,
    ): Promise<{ history: ChatMessage[]; contents: Map<string, string> }> => {
        const contents = new Map([
            ["notes/a.md", `A_SOURCE_BODY ${firstBody}`],
            ["notes/b.md", `B_SOURCE_BODY ${secondBody}`],
        ]);
        const files = ["notes/a.md", "notes/b.md"].map(path => ({
            path,
            name: path.split("/").pop(),
            basename: path.split("/").pop()?.replace(/\.md$/, ""),
            extension: "md",
            stat: { ctime: 1, mtime: 2, size: contents.get(path)?.length ?? 0 },
        }));
        const vault = f.host.app.vault as unknown as {
            getAbstractFileByPath: (path: string) => unknown;
            cachedRead: (file: unknown) => Promise<string>;
        };
        vault.getAbstractFileByPath = (path: string) => files.find(file => file.path === path) ?? null;
        vault.cachedRead = (file: unknown) => Promise.resolve(contents.get((file as { path: string }).path) ?? "");
        Object.assign(f.host, {
            getMemoryEvidenceEpoch: () => "vault-epoch-stable",
            revalidateVaultObservation: (evidence: never, options?: never) =>
                revalidateVaultObservationFromApp(f.host as unknown as AiServiceHost, evidence, options),
        });
        const evidence = await Promise.all(files.map(async file => {
            const tool = createReadNoteTool();
            const result = await tool.execute(
                tool.validateInput({ path: file.path, part: "body" }),
                {
                    host: f.host as unknown as AiServiceHost,
                    taskSourceReadGuard: {
                        isCurrent: () => true,
                        isPathAllowed: path => path === file.path,
                        getNoteSearchScope: () => ({ allowedPaths: [file.path], excludedPaths: [] }),
                    },
                },
            );
            if (!result.ok || !result.vaultObservationEvidence) throw new Error("read_note evidence fixture failed");
            return result.vaultObservationEvidence;
        }));
        return {
            contents,
            history: [
                { role: "user", content: "Earlier request" },
                {
                    role: "assistant",
                    content: firstBody,
                    memoryMetadata: {
                        hasMemoryContent: false,
                        allowedMemorySourcePaths: [],
                        vaultObservationEvidence: [evidence[0]],
                        vaultObservationContractVersion: 1,
                    } as never,
                },
                {
                    role: "assistant",
                    content: secondBody,
                    memoryMetadata: {
                        hasMemoryContent: false,
                        allowedMemorySourcePaths: [],
                        vaultObservationEvidence: [evidence[1]],
                        vaultObservationContractVersion: 1,
                    } as never,
                },
                { role: "user", content: "Continue from current material" },
            ],
        };
    };

    it("forwards asynchronous vault preparation independently to answer and summary models", async () => {
        const summaryText = JSON.stringify({
            goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
            facts: [{ text: "Keep the independent current choice.", sourceMessages: [1] }],
        });
        let contents: Map<string, string> | undefined;
        const f = fixture((body, index) => {
            if (!body.stream && index === 0) {
                contents?.set("notes/a.md", "A_SOURCE_BODY CHANGED_BEFORE_SUMMARY_RETRY");
                return { httpError: { status: 429, code: "rate_limit_exceeded", retryAfter: "0.001" } };
            }
            return body.stream ? { text: "Current answer" } : { text: summaryText };
        }, {}, 1);
        const installed = await installReadHistory(
            f,
            "A_LONG_HISTORY_SUMMARY_SOURCE " + "detail ".repeat(400),
            "B_INDEPENDENT_HISTORY_CHOICE " + "detail ".repeat(400),
        );
        contents = installed.contents;

        await f.run({ images: undefined, prompt: "Continue", historyBudgetChars: 1200, chatHistory: installed.history });
        const summary = f.modelSpecifications.find(specification => specification.isSummary);
        const answer = f.modelSpecifications.find(specification => !specification.isSummary);
        expect(summary).toBeDefined();
        expect(answer).toBeDefined();
        expect(typeof summary!.options.prepareProviderRequest).toBe("function");
        expect(typeof answer!.options.prepareProviderRequest).toBe("function");
        expect(summary!.options.prepareProviderRequest).not.toBe(answer!.options.prepareProviderRequest);
        expect(f.requests[0].stream).toBe(false);
        expect(requestText(f.requests[0])).toContain("A_LONG_HISTORY_SUMMARY_SOURCE");
        expect(f.sdkAttempts.filter(attempt => attempt.retryCount === "1")).toEqual([
            { stream: false, retryCount: "1" },
        ]);
        expect(f.requests.slice(1).some(request => requestText(request).includes("A_LONG_HISTORY_SUMMARY_SOURCE"))).toBe(true);
        expect(f.requests.slice(1).every(request => !requestText(request).includes("CHANGED_BEFORE_SUMMARY_RETRY"))).toBe(true);
        expect(f.requests.at(-1)?.stream).toBe(true);
        expect(requestText(f.requests.at(-1)!)).toContain("Keep the independent current choice.");
    });

    it("does not reread a budget-hidden source in the final answer binding while B still dispatches", async () => {
        const summaryText = JSON.stringify({
            goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
            facts: [{ text: "Keep only the first summary dependency.", sourceMessages: [2] }],
        });
        const f = fixture((body, index) => {
            if (!body.stream && index === 0) {
                sourceChanged = true;
                installed.contents.set("notes/a.md", "A_HIDDEN_AFTER_CHANGE CHANGED");
                return { httpError: { status: 429, code: "rate_limit_exceeded", retryAfter: "0.001" } };
            }
            return body.stream ? { text: "Current answer" } : { text: summaryText };
        }, {}, 1);
        const installed = await installReadHistory(
            f,
            "A_HIDDEN_AFTER_CHANGE " + "detail ".repeat(400),
            "B_INDEPENDENT_HISTORY_CHOICE " + "detail ".repeat(400),
        );
        const reads = { a: 0, b: 0 };
        let sourceChanged = false;
        const vault = f.host.app.vault as { cachedRead: (file: unknown) => Promise<string> };
        const originalCachedRead = vault.cachedRead.bind(vault);
        vault.cachedRead = async file => {
            const path = (file as { path: string }).path;
            if (path === "notes/a.md" && sourceChanged) reads.a += 1;
            if (path === "notes/b.md") reads.b += 1;
            return await originalCachedRead(file);
        };

        await f.run({ images: undefined, prompt: "Continue", historyBudgetChars: 1200, chatHistory: installed.history });

        expect(f.requests[0]?.stream).toBe(false);
        expect(requestText(f.requests[0]!)).toContain("A_HIDDEN_AFTER_CHANGE");
        expect(f.requests.slice(1).some(request => requestText(request).includes("A_HIDDEN_AFTER_CHANGE"))).toBe(true);
        expect(f.requests.slice(1).every(request => !requestText(request).includes("A_HIDDEN_AFTER_CHANGE CHANGED"))).toBe(true);
        const answer = f.requests.at(-1);
        expect(answer?.stream).toBe(true);
        expect(requestText(answer!)).toContain("Keep only the first summary dependency.");
        const summary = f.modelSpecifications.find(specification => specification.isSummary);
        const answerModel = f.modelSpecifications.find(specification => !specification.isSummary);
        await expect((summary!.options.prepareProviderRequest as () => Promise<void>)())
            .resolves.toBeUndefined();
        const readsBeforeAnswerHook = reads.a;
        await expect((answerModel!.options.prepareProviderRequest as () => Promise<void>)())
            .resolves.toBeUndefined();
        expect(reads.a).toBe(readsBeforeAnswerHook);
    });

    it("keeps the captured answer snapshot when its source is edited before physical preparation", async () => {
        const summaryText = JSON.stringify({
            goals: [], constraints: [], decisions: [], completed: [], open_questions: [],
            facts: [{ text: "Keep the earlier dependency.", sourceMessages: [2] }],
        });
        let answerPrepareWrapped = false;
        const f = fixture(body => (body.stream
            ? { text: "must not dispatch" }
            : { text: summaryText }));
        const installed = await installReadHistory(f, "A_STABLE_HISTORY", "B_CHANGED_BEFORE_ANSWER");
        f.afterModelCreated(isSummary => {
            if (isSummary) return;
            const options = f.modelSpecifications[f.modelSpecifications.length - 1]?.options as {
                prepareProviderRequest?: (signal?: AbortSignal | null) => Promise<void>;
            };
            const originalPrepare = options.prepareProviderRequest;
            if (!originalPrepare) throw new Error("answer model did not expose physical preparation");
            answerPrepareWrapped = true;
            options.prepareProviderRequest = async signal => {
                installed.contents.set("notes/b.md", "B_CHANGED_BEFORE_ANSWER CHANGED");
                await originalPrepare(signal);
            };
        });

        await f.run({
            images: undefined,
            prompt: "Continue",
            historyBudgetChars: 1200,
            chatHistory: installed.history,
        });
        expect(answerPrepareWrapped).toBe(true);
        expect(f.requests.some(request => (
            request.stream
            && requestText(request).includes("B_CHANGED_BEFORE_ANSWER")
        ))).toBe(true);
        expect(f.requests.every(request => !requestText(request).includes("B_CHANGED_BEFORE_ANSWER CHANGED"))).toBe(true);
    });

    it("keeps a derived free-text history snapshot while retaining independent evidence", async () => {
        const f = fixture([{ text: "Current answer" }]);
        const installed = await installReadHistory(f, "A_DERIVED_ANSWER_SENTINEL", "B_INDEPENDENT_HISTORY_SENTINEL");
        f.afterModelCreated(() => {
            installed.contents.set("notes/a.md", "A_SOURCE_BODY CHANGED");
        });

        await f.run({ images: undefined, prompt: "Continue", chatHistory: installed.history });
        const answer = f.requests.find(request => request.stream);
        expect(answer).toBeDefined();
        expect(requestText(answer!)).toContain("A_DERIVED_ANSWER_SENTINEL");
        expect(requestText(answer!)).toContain("B_INDEPENDENT_HISTORY_SENTINEL");
    });

    it("keeps the structured query read snapshot when live metadata changes before dispatch", async () => {
        let aStillActive = true;
        const f = fixture((_body, index) => {
            if (index === 0) {
                return { tools: [
                    {
                        name: "query_notes",
                        input: {
                            properties: [{ key: "status", operator: "equals", value: "active" }],
                            sort: { field: "path", direction: "asc" },
                            limit: 2,
                        },
                    },
                ] };
            }
            return { text: "Current answer" };
        });
        let answerModelCreations = 0;
        f.afterModelCreated(() => {
            answerModelCreations += 1;
            if (answerModelCreations > 1) aStillActive = false;
        });
        (f.host as { getMemoryEvidenceEpoch?: unknown }).getMemoryEvidenceEpoch = () => "vault-epoch-stable";
        const files = ["notes/a.md", "notes/b.md", "notes/c.md"].map((path, index) => ({
            path,
            basename: path.split("/").pop()?.replace(/\.md$/, ""),
            extension: "md",
            stat: { ctime: 1, mtime: index + 1, size: 20 },
        }));
        const vault = f.host.app.vault as unknown as {
            getMarkdownFiles: () => typeof files;
            getAbstractFileByPath: (path: string) => unknown;
        };
        const metadataCache = f.host.app.metadataCache as unknown as {
            getFileCache: (file: { path: string }) => unknown;
        };
        vault.getMarkdownFiles = () => files;
        vault.getAbstractFileByPath = (path: string) => (
            files.find(file => file.path === path) ?? null
        );
        metadataCache.getFileCache = (file: { path: string }) => (
            { frontmatter: { status: file.path === "notes/a.md" && !aStillActive ? "inactive" : "active" } }
        );
        Object.assign(f.host, {
            revalidateVaultObservation: (evidence: never, options?: never) => revalidateVaultObservationFromApp(
                f.host as unknown as AiServiceHost,
                evidence,
                options,
            ),
        });

        await f.run({ images: undefined, prompt: "Query my active notes" });
        const answer = f.requests[f.requests.length - 1];
        expect(answer).toBeDefined();
        expect(requestText(answer!)).toContain("notes/a.md");
        const queryObservation = JSON.parse(requestText(answer!).match(
            /<untrusted source="tool:query_notes"[^>]*>\s*([\s\S]*?)\s*<\/untrusted>/,
        )![1]).observation;
        expect(queryObservation.nextCursor).toBeDefined();
        expect(queryObservation.sort).toEqual({ field: "path", direction: "asc" });
        expect(queryObservation.matchCountKind).toBe("exact");
        expect(queryObservation.coverage).toEqual(expect.objectContaining({ state: "complete" }));
        expect(queryObservation.matches).toEqual([
            expect.objectContaining({ path: "notes/a.md" }),
            expect.objectContaining({ path: "notes/b.md" }),
        ]);
    });

    it("fails closed when the vault evidence epoch changes in the final synchronous admission window", async () => {
        let epoch = "vault-epoch-1";
        let epochChanged = false;
        const f = fixture(() => {
            if (!epochChanged) return { error: new Error("old serialized payload dispatched") };
            return { text: "safe reprepared answer" };
        });
        const installed = await installReadHistory(f, "A_CURRENT_HISTORY", "B_INDEPENDENT_HISTORY");
        (f.host as { getMemoryEvidenceEpoch?: unknown }).getMemoryEvidenceEpoch = () => epoch;
        let wrapperReached = false;
        f.afterModelCreated(() => {
            const options = f.modelSpecifications[f.modelSpecifications.length - 1]?.options as {
                prepareProviderRequest?: (signal?: AbortSignal | null) => Promise<void>;
            };
            const originalPrepare = options.prepareProviderRequest;
            if (!originalPrepare) throw new Error("answer model did not expose physical preparation");
            let preparedOnce = false;
            options.prepareProviderRequest = async signal => {
                wrapperReached = true;
                await originalPrepare(signal);
                if (!preparedOnce) {
                    preparedOnce = true;
                    epoch = "vault-epoch-2";
                    epochChanged = true;
                }
            };
        });

        const outcome = await f.run({
            images: undefined,
            prompt: "Continue",
            chatHistory: installed.history,
        }).then(() => ({ ok: true }), () => ({ ok: false }));
        expect(wrapperReached).toBe(true);
        expect(outcome.ok).toBe(true);
        expect(f.requests.length).toBeGreaterThan(0);
    });

    it("does not resend stale serialized history on an SDK 429 physical retry", async () => {
        let contents: Map<string, string> | undefined;
        const f = fixture((_body, index) => {
            if (index === 0) {
                contents?.set("notes/a.md", "A_SOURCE_BODY CHANGED_ON_FIRST_DISPATCH");
                return {
                    httpError: { status: 429, code: "rate_limit_exceeded", retryAfter: "0.001" },
                };
            }
            return { text: "safe independent history answer" };
        }, {}, 1);
        const installed = await installReadHistory(f, "A_STALE_RETRY_SENTINEL", "B_INDEPENDENT_HISTORY");
        contents = installed.contents;

        const outcome = await f.run({
            images: undefined,
            prompt: "Continue",
            chatHistory: installed.history,
        }).then(() => ({ ok: true }), () => ({ ok: false }));
        expect(f.requests.length).toBeGreaterThan(1);
        expect(requestText(f.requests[0])).toContain("A_STALE_RETRY_SENTINEL");
        expect(f.sdkAttempts.filter(attempt => attempt.retryCount === "1")).toEqual([
            { stream: true, retryCount: "1" },
        ]);
        for (const request of f.requests.slice(1)) {
            expect(requestText(request)).toContain("A_STALE_RETRY_SENTINEL");
            expect(requestText(request)).not.toContain("A_SOURCE_BODY CHANGED_ON_FIRST_DISPATCH");
            expect(requestText(request)).toContain("B_INDEPENDENT_HISTORY");
        }
        expect(outcome.ok).toBe(true);
    });
});
