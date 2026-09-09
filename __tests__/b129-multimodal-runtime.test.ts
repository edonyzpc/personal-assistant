import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { AIUtils } from "../src/ai-services/ai-utils";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import type { MemorySearchPort } from "../src/memory/MemorySearchPort";
import { PaAgentRuntime, type PaAgentRuntimeOptions, type PaAgentStreamOptions } from "../src/ai-services/pa-agent-runtime";
import { ChatService } from "../src/ai-services/chat-service";
import type { AgentEvent, LegacyAgentEvent } from "../src/ai-services/chat-types";
import type { ImageAssetService } from "../src/chat/image-assets";
import type { MessageImage } from "../src/chat/image-types";
import { createPaAgentPersistedTurn } from "../src/ai-services/pa-agent-history";
import { decodeWritingOutput, isWritingContinuationPrompt, isWritingRequestPrompt, readProviderCompletion } from "../src/ai-services/writing-output";
import { formatInjectedContext, MEMORY_CONTEXT_MAX_CHARS } from "../src/ai-services/context/PaAgentContextProjector";

jest.mock("obsidian");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });

const image = (n: number): MessageImage => ({ ref: { assetId: `image-${n}`, contentHash: String(n).repeat(64) }, ordinal: n, label: `Image ${n}` });
const envelope = (body = '正文："海风"\n🌊') => JSON.stringify({ kind: "pa.writing", version: 1, requestId: "writing-1", body, explanation: "参考当前材料" });
type RequestBody = { stream?: boolean; messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>; tools?: Array<{ function: { name: string } }> };
type FixtureTool = { name: string; input: unknown };
type Reply = { text?: string; finish?: string | null; tool?: FixtureTool; tools?: FixtureTool[]; error?: unknown; httpError?: { status: number; code: string; retryAfter?: string }; onEnd?: () => void };
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
    if (!body.stream) { reply.onEnd?.(); return new Response(JSON.stringify({ ...common, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }] }), { headers: { "content-type": "application/json" } }); }
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
        getAPIToken: async () => "synthetic-fixture-token", log: jest.fn(), isOperationsAgentEnabled: false,
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
    return { host, requests, observed, sdkAttempts, events, lifecycle, service, release, run, invalidate: () => { sourceCurrent = false; },
        beforeSdkDispatch: (callback: () => void) => { beforeSdkDispatch = callback; },
        afterModelCreated: (callback: (isSummary: boolean) => void | Promise<void>) => { afterModelCreated = callback; } };
}
const pixels = (request: RequestBody) => request.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url") : []);
const requestText = (request: RequestBody) => request.messages.map((message) => typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("")).join("\n");

describe('B-135 production source declaration', () => {
    it('does not publish internal Memory path enumeration as a source directory', async () => {
        const prompt = 'Search my notes for a matching idea';
        const f = fixture([{ tools: [
            { name: 'declare_source_scope', input: { instructionQuote: prompt, notes: 'vault', webAllowed: false } },
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

    it.each(['admitted', 'separate', 'missing', 'conflicting'] as const)('preflights a real current-note/Memory batch: %s', async mode => {
        const prompt = '只用当前笔记的资料整理提纲，保持我的表达习惯';
        const declaration = { name: 'declare_source_scope', input: { instructionQuote: prompt, notes: 'current_note', webAllowed: false } };
        const reads = [{ name: 'get_current_note_context', input: { mode: 'full' } },
            { name: 'search_memory', input: { query: 'outline' } }];
        const f = fixture(mode === 'separate'
            ? [{ tool: declaration }, { tools: reads }, { text: 'Draft outline' }]
            : [{ tools: [...(mode === 'missing' ? [] : [declaration]), ...reads,
                ...(mode === 'conflicting' ? [{ name: 'webSearch', input: { query: 'outside source' } }] : [])] }, { text: 'Draft outline' }]);
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
        expect(f.requests[0].tools?.some(tool => tool.function.name === 'declare_source_scope')).toBe(true);
        expect(requestText(f.requests[0])).toContain('VALID_PERSONAL_BACKGROUND');
        expect(requestText(f.requests[0])).not.toContain('CURRENT_NOTE_BODY');
        if (mode === 'admitted' || mode === 'separate') {
            expect(editor.getValue).toHaveBeenCalledTimes(1);
            expect(search).toHaveBeenCalledWith('outline', expect.objectContaining({
                noteScope: { allowedPaths: [file.path], excludedPaths: [] },
            }));
            expect(ready).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.anything(), { existingOnly: true });
            expect(f.requests.slice(1).some(request => requestText(request).includes('CURRENT_NOTE_BODY'))).toBe(true);
            expect(f.lifecycle.some(event => event.type === 'message_end' && event.message.role === 'toolResult'
                && event.message.content.metadata?.outcome === 'control_applied')).toBe(true);
        } else {
            expect(editor.getValue).not.toHaveBeenCalled();
            expect(search).not.toHaveBeenCalled();
            expect(ready).not.toHaveBeenCalled();
        }
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

describe('B-135 T14 selected-image history summary', () => {
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

    it("keeps images and final JSON instructions in a reserved final turn with no bound tools", async () => {
        const f = fixture([{ text: envelope() }], { maxWallClockMs: 10_000, finalizationReserveMs: 10_000 });
        await f.run({ writingRequest: { requestId: "writing-1" } });
        expect(f.requests).toHaveLength(1); expect(f.requests[0].tools ?? []).toHaveLength(0); expect(pixels(f.requests[0])).toHaveLength(1);
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
            expect(f.events.find((event) => event.kind === 'writing-recovery')).toMatchObject({ rawText, reason: state });
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
        expect(f.events.find((event) => event.kind === "writing-artifact")).toMatchObject({ styleRevisionIds: ["style-1"] });
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
