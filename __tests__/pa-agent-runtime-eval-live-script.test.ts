import { createHash, webcrypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { ChatService } from "../src/ai-services/chat-service";
import { resolvePaAgentModelBudgetFacts } from '../src/ai-services/ai-utils';
import { PA_RUNTIME_EVAL_CASES } from "../src/pa/eval/runtime-cases";

jest.mock("obsidian");

const source = readFileSync(resolve(__dirname, "../scripts/pa-agent-runtime-eval-live.js"), "utf8");
const casesJson = JSON.stringify(PA_RUNTIME_EVAL_CASES);
const bundle = "B149 synthetic deployed bundle identity";
const bundleHash = createHash("sha256").update(bundle).digest("hex");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });

function completion(body: { stream?: boolean }, toolName?: "read_note" | "webSearch", webQuery = "E-02",
    notePath = "synthetic/lighthouse-final.md"): Response {
    const common = { id: "b149-live-fixed", created: 0, model: "deepseek-v4-pro" };
    const toolCall = { id: "b149-fixed-tool", type: "function", function: {
        name: toolName, arguments: JSON.stringify(toolName === "read_note"
            ? { path: notePath } : { query: webQuery, limit: 1 }),
    } };
    const frame = (delta: unknown, finishReason: string | null = null) => `data: ${JSON.stringify({
        ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
    if (body.stream) {
        const delta = toolName ? { role: "assistant", content: "", tool_calls: [{ ...toolCall, index: 0 }] }
            : { role: "assistant", content: "合成模型回答" };
        return new Response(frame(delta) + frame({}, toolName ? "tool_calls" : "stop") + "data: [DONE]\n\n", {
            headers: { "content-type": "text/event-stream" },
        });
    }
    return new Response(JSON.stringify({ ...common, object: "chat.completion", choices: [{ index: 0,
        message: toolName ? { role: "assistant", content: "", tool_calls: [toolCall] }
            : { role: "assistant", content: "合成模型回答" }, finish_reason: toolName ? "tool_calls" : "stop",
    }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }),
    { headers: { "content-type": "application/json" } });
}

function emptySearchBatchCompletion(body: { stream?: boolean }, includeQueryNotes: boolean): Response {
    const common = { id: "b149-empty-search", created: 0, model: "deepseek-v4-pro" };
    const calls = [
        { name: "search_memory", input: { query: "月桂项目" } },
        { name: "search_vault_snippets", input: { query: "月桂项目" } },
        { name: "search_vault_metadata", input: { query: "月桂项目" } },
        ...(includeQueryNotes ? [{ name: "query_notes", input: { folder: "", limit: 5 } }] : []),
    ].map((call, index) => ({ id: `b149-empty-${index}`, type: "function", function: {
        name: call.name, arguments: JSON.stringify(call.input),
    } }));
    if (!body.stream) return new Response(JSON.stringify({ ...common, object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: calls },
            finish_reason: "tool_calls" }] }),
    { headers: { "content-type": "application/json" } });
    const frame = (delta: unknown, finishReason: string | null = null) => `data: ${JSON.stringify({
        ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
    return new Response(frame({ role: "assistant", content: "", tool_calls: calls.map((call, index) => ({
        ...call, index,
    })) }) + frame({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
    });
}

function harness(vaultName = "test", stagedCases = casesJson, fixtureGate?: Promise<void>) {
    const fixtureReads: string[] = [];
    const realVaultAccess: string[] = [];
    const realVault = new Proxy({}, { get(_target, key) {
        realVaultAccess.push(String(key));
        throw new Error(`Real vault access: ${String(key)}`);
    } });
    const settings = { debug: false, aiProvider: "qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        chatModelName: "deepseek-v4-pro", policyModelName: "", embeddingModelName: "b149-synthetic",
        shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false, webSearchEnabled: true,
        memoryEnabled: true, licenseTier: "paid", operationsAgentEnabled: false,
        operationsProactiveSaveSuggestionsEnabled: false, operationsAuditIncludeContent: false,
        operationsAuditRetentionDays: 30, statisticsVaultId: "b149-test", retrievalOptimizationFlags: {},
        privateInstruction: "PRIVATE_SETTINGS_SENTINEL_93" };
    const host = { settings, app: { vault: realVault, fileManager: { trashFile: () => { throw new Error("real write"); } } },
        getAPIToken: async () => "b149-synthetic-token", memorySearch: {},
        isOperationsAgentEnabled: false, log: () => undefined };
    let created = 0;
    const plugin = { settings, manifest: { version: "2.9.2-test" },
        createChatService: () => { created++; return new ChatService(host as never); } };
    const sandbox: any = { app: { vault: { getName: () => vaultName,
        adapter: { read: async (path: string) => {
            fixtureReads.push(path);
            if (path === "B149-runtime-eval/cases.json") { await fixtureGate; return stagedCases; }
            if (path === ".obsidian/plugins/personal-assistant/main.js") return bundle;
            throw new Error(`Unexpected staged read: ${path}`);
        } } }, plugins: { plugins: { "personal-assistant": plugin } } },
    crypto: webcrypto, TextEncoder, AbortController };
    sandbox.__b149EvalPreReloadPlugin = { manifest: { id: "personal-assistant" } };
    return { sandbox, plugin, fixtureReads, realVaultAccess, get created() { return created; } };
}

describe("B-149 live eval script safety seam", () => {
    it("loads with zero requests and rejects the wrong vault or frozen identity before service construction", async () => {
        const wrongVault = harness("private");
        expect(() => runInNewContext(source, wrongVault.sandbox)).toThrow("B149_TEST_VAULT_REQUIRED");
        const testVault = harness();
        const fetchSpy = jest.fn(async () => { throw new Error("Unexpected physical request"); });
        globalThis.fetch = fetchSpy as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        expect(testVault.sandbox.__b149AgentEval.state.status).toBe("ready");
        expect(createHash("sha256").update(casesJson).digest("hex"))
            .toBe(testVault.sandbox.__b149AgentEval.fixtureHash);
        const stagedCases = JSON.parse(casesJson);
        expect([stagedCases[1].webEvidence, stagedCases[2].webEvidence, stagedCases[7].webEvidence]
            .every((value: string) => value.startsWith("https://example.invalid/"))).toBe(true);
        const prior = stagedCases[8].history.flatMap((message: any) => message.canonicalTurn?.messages ?? []);
        const actions = prior.filter((message: any) => message.role === "assistant")
            .flatMap((message: any) => message.content?.filter?.((part: any) => part.type === "toolCall") ?? []);
        const results = prior.filter((message: any) => message.role === "toolResult");
        expect(actions.map((action: any) => action.input.properties[0].value)).toEqual(["draft", "final"]);
        expect(results.map((result: any) => result.content.promptText)).toEqual([
            "相同结果：海棠笔记 1 篇", "相同结果：海棠笔记 1 篇",
        ]);
        expect(actions.map((action: any) => action.id))
            .toEqual(results.map((result: any) => result.toolCallId));
        expect(testVault.fixtureReads).toEqual([]);
        expect(testVault.created).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();
        const stalePlugin = harness();
        stalePlugin.sandbox.__b149EvalPreReloadPlugin = stalePlugin.plugin;
        runInNewContext(source, stalePlugin.sandbox);
        await expect(stalePlugin.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: bundleHash })).rejects.toThrow("B149_PLUGIN_RELOAD_NOT_VERIFIED");
        expect(stalePlugin.created).toBe(0);
        await expect(testVault.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: "0".repeat(64) })).rejects.toThrow("B149_DEPLOYED_BUNDLE_MISMATCH");
        expect(testVault.created).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();
        const changedFixture = harness("test", casesJson.replace("WEB_STAR_19", "WEB_STAR_CHANGED"));
        runInNewContext(source, changedFixture.sandbox);
        await expect(changedFixture.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: bundleHash })).rejects.toThrow("B149_FROZEN_FIXTURE_MISMATCH");
        expect(changedFixture.created).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("uses actual ChatService and Web tool with only synthetic source material", async () => {
        const testVault = harness();
        const streamSpy = jest.spyOn(ChatService.prototype, "streamLLM");
        let dispatches = 0;
        globalThis.fetch = jest.fn(async (_url, init) => {
            const tool = dispatches === 0 ? "read_note" : dispatches === 2 ? "webSearch" : undefined;
            dispatches++;
            return completion(JSON.parse(String(init?.body)), tool);
        }) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const report = await testVault.sandbox.__b149AgentEval.start({ maxRequests: 5,
            expectedBundleSha256: bundleHash, caseIds: ["E-01", "E-02", "E-09"] });
        if (process.env.B149_T11_BODY_OUTPUT) writeFileSync(process.env.B149_T11_BODY_OUTPUT,
            JSON.stringify(report.results.flatMap((result: any) => result.requestBodies.map((request: any) => ({
                caseId: result.caseId, attemptId: request.attemptId, prompt: request.prompt,
                estimatedPromptTokens: request.estimatedPromptTokens,
                measuredPromptTokens: request.measuredPromptTokens,
            }))), null, 2));
        expect(report.status).toBe("recorded_for_review");
        expect(report.reloadVerified).toBe(true);
        expect(report.physicalDispatchAdmissions).toBe(5);
        expect(dispatches).toBe(5);
        expect(report.fixedWebRequests).toBe(1);
        expect(report.results[0].sourcePaths).toContain("synthetic/lighthouse-final.md");
        expect(report.results[0].runSourceSelection).toMatchObject({ scope: "notes",
            selectionId: "b149-E-01-selection", userMessageId: "b149-E-01-user" });
        const e01Followup = report.results[0].requestBodies[1].prompt.messages;
        expect(e01Followup.map((message: any) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
        const e01Call = e01Followup.find((message: any) => message.role === "assistant" && message.tool_calls?.length);
        expect(e01Call.tool_calls[0]).toMatchObject({ id: "b149-fixed-tool", function: { name: "read_note" } });
        expect(e01Call.tool_calls[0].function.arguments).toContain("synthetic/lighthouse-final.md");
        expect(e01Followup.find((message: any) => message.role === "tool"))
            .toMatchObject({ tool_call_id: "b149-fixed-tool" });
        expect(report.results[1].sourceUrls).toContain("https://example.invalid/starbay");
        expect(report.results[1].runSourceSelection).toMatchObject({ scope: "web",
            selectionId: "b149-E-02-selection", userMessageId: "b149-E-02-user" });
        expect(report.results[1].requestBodies.length).toBe(2);
        expect(report.results.every((result: any) => result.requestEvidenceComplete)).toBe(true);
        const facts = resolvePaAgentModelBudgetFacts({ provider: testVault.plugin.settings.aiProvider,
            model: testVault.plugin.settings.chatModelName, baseURL: testVault.plugin.settings.baseURL });
        for (const result of report.results) for (const request of result.requestBodies) {
            expect(request.prompt.max_tokens ?? request.prompt.max_completion_tokens)
                .toBe(facts.outputReserveTokens);
            expect(request.estimatedPromptTokens).toBeGreaterThan(0);
            expect(request.estimateMethod).toBeTruthy();
        }
        expect(report.results[0].usage).toMatchObject({ estimatedPromptTokens: expect.any(Number),
            measuredPromptTokens: null, physicalTotalTokens: null, physicalAttribution: 'incomplete',
            price: { amount: null, currency: null } });
        expect(JSON.stringify(report.results[1].requestBodies)).not.toContain("PRIVATE_STAR_BUDGET_29");
        const e09History = streamSpy.mock.calls.find(call => call[0].includes("前两次筛选"))?.[3];
        expect(e09History).toHaveLength(4);
        expect(e09History?.filter(message => message.canonicalTurn).length).toBe(2);
        expect(report.results[2].requestBodies).toHaveLength(1);
        const e09Request = JSON.stringify(report.results[2].requestBodies[0]);
        expect(e09Request).toContain('draft');
        expect(e09Request).toContain('final');
        expect(e09Request).toContain('canonical-status-1');
        expect(e09Request).toContain('canonical-status-2');
        expect(JSON.stringify(report)).not.toContain("b149-synthetic-token");
        expect(JSON.stringify(report)).not.toContain("PRIVATE_SETTINGS_SENTINEL_93");
        expect(testVault.fixtureReads).toEqual(["B149-runtime-eval/cases.json",
            ".obsidian/plugins/personal-assistant/main.js"]);
        expect(testVault.realVaultAccess).toEqual([]);
        expect(testVault.sandbox.__b149EvalPreReloadPlugin).toBeUndefined();
        await expect(testVault.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: bundleHash, caseIds: ["E-09"] }))
            .rejects.toThrow("B149_PLUGIN_RELOAD_NOT_VERIFIED");
        expect(dispatches).toBe(5);
    });

    it("keeps both note and Web evidence in E-03 combined SDK requests", async () => {
        const testVault = harness();
        const bodies: Array<{ messages: unknown[]; tools?: Array<{ function: { name: string } }> }> = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            if (bodies.length === 1) return completion(body, "read_note", "E-03", "synthetic/starbay-budget.md");
            if (bodies.length === 2) return completion(body, "webSearch", "E-03");
            return completion(body);
        }) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const report = await testVault.sandbox.__b149AgentEval.start({ maxRequests: 3,
            expectedBundleSha256: bundleHash, caseIds: ["E-03"] });
        expect(report.status).toBe("recorded_for_review");
        expect(report.physicalDispatchAdmissions).toBe(3);
        expect(report.fixedWebRequests).toBe(1);
        expect(report.results[0].runSourceSelection).toMatchObject({ scope: "combined",
            selectionId: "b149-E-03-selection", userMessageId: "b149-E-03-user" });
        expect(report.results[0].sourcePaths).toContain("synthetic/starbay-budget.md");
        expect(report.results[0].sourceUrls).toContain("https://example.invalid/starbay-plan");
        expect(bodies[0].tools?.map(tool => tool.function.name)).toEqual(expect.arrayContaining(["read_note", "webSearch"]));
        expect(JSON.stringify(bodies[2])).toContain("BUDGET_37");
        expect(JSON.stringify(bodies[2])).toContain("WEB_TWO_PHASES");
        expect(testVault.realVaultAccess).toEqual([]);
    });

    it("sends admitted empty-search and unavailable results in the next SDK request", async () => {
        const testVault = harness();
        let dispatches = 0;
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            return dispatches++ % 2 === 0
                ? emptySearchBatchCompletion(body, dispatches > 2)
                : completion(body);
        }) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const report = await testVault.sandbox.__b149AgentEval.start({ maxRequests: 4,
            expectedBundleSha256: bundleHash, caseIds: ["E-04", "E-05"] });
        expect(report.physicalDispatchAdmissions).toBe(4);
        for (const result of report.results) {
            expect(result.requestBodies).toHaveLength(2);
            const toolMessages = result.requestBodies[1].prompt.messages.filter((message: any) =>
                message.role === "tool");
            expect(toolMessages).toHaveLength(result.caseId === "E-05" ? 4 : 3);
            expect(toolMessages.map((message: any) => message.tool_call_id)).toEqual([
                "b149-empty-0", "b149-empty-1", "b149-empty-2",
                ...(result.caseId === "E-05" ? ["b149-empty-3"] : []),
            ]);
            expect(toolMessages[0].content).toContain("unavailable");
            expect(toolMessages[0].content).toContain("empty results do not establish that no matching notes exist");
            expect(toolMessages[1].content).toMatch(/"matches"\s*:\s*\[\]/);
            expect(toolMessages[2].content).toMatch(/"matches"\s*:\s*\[\]/);
            if (result.caseId === "E-05") {
                expect(toolMessages[3].content).toMatch(/"matches"\s*:\s*\[\]/);
                expect(toolMessages[3].content).toContain('"matchCount": 0');
            }
            expect(toolMessages.every((message: any) => !message.content.includes("result_unknown"))).toBe(true);
        }
        expect(testVault.realVaultAccess).toEqual([]);
    });

    it("offers the native Writing context tool for E-12 without opening real sources", async () => {
        const testVault = harness();
        globalThis.fetch = jest.fn(async (_url, init) => completion(JSON.parse(String(init?.body)))) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const report = await testVault.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: bundleHash, caseIds: ["E-12"] });
        expect(report.physicalDispatchAdmissions).toBe(1);
        const toolNames = report.results[0].requestBodies[0].prompt.tools
            .map((tool: any) => tool.function.name);
        expect(toolNames).toContain("get_writing_context");
        expect(testVault.realVaultAccess).toEqual([]);
    });

    it("excludes unknown old assistant material from every E-08 SDK request while retaining Web evidence", async () => {
        const testVault = harness();
        const bodies: Array<{ messages: unknown[] }> = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            return completion(body, bodies.length === 1 ? "webSearch" : undefined, "E-08");
        }) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const report = await testVault.sandbox.__b149AgentEval.start({ maxRequests: 2,
            expectedBundleSha256: bundleHash, caseIds: ["E-08"] });
        expect(report.status).toBe("recorded_for_review");
        expect(report.physicalDispatchAdmissions).toBe(2);
        expect(report.fixedWebRequests).toBe(1);
        expect(report.results[0].sourceUrls).toContain("https://example.invalid/plan-b");
        expect(report.results[0].runSourceSelection).toMatchObject({ scope: "web",
            selectionId: "b149-E-08-selection", userMessageId: "b149-E-08-user" });
        expect(bodies).toHaveLength(2);
        expect(bodies.every(body => !JSON.stringify(body).includes("OLD_PRIVATE_BUDGET_71"))).toBe(true);
        expect(JSON.stringify(bodies[1])).toContain("WEB_B_UNKNOWN");
        expect(testVault.realVaultAccess).toEqual([]);
    });

    it("stops an SDK physical retry after the explicit cap", async () => {
        const testVault = harness();
        let dispatches = 0;
        globalThis.fetch = jest.fn(async () => {
            dispatches++;
            return new Response(JSON.stringify({ error: { message: "synthetic retryable failure", type: "server_error" } }), {
                status: 500, headers: { "content-type": "application/json", "retry-after": "0" },
            });
        }) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const report = await testVault.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: bundleHash, caseIds: ["E-09"] });
        expect(report.status).toBe("cap_reached");
        expect(report.physicalDispatchAdmissions).toBe(1);
        expect(dispatches).toBe(1);
        expect(testVault.realVaultAccess).toEqual([]);
    });

    it("rebuilds the same paired action messages for stream-to-invoke fallback", async () => {
        const testVault = harness();
        const bodies: Array<{ stream?: boolean; messages: unknown[];
            max_tokens?: number; max_completion_tokens?: number }> = [];
        globalThis.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            if (bodies.length === 1) return completion(body, "read_note");
            if (body.stream) return new Response(JSON.stringify({ error: { message: "synthetic stream unavailable" } }), {
                status: 400, headers: { "content-type": "application/json" },
            });
            return completion(body);
        }) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const report = await testVault.sandbox.__b149AgentEval.start({ maxRequests: 3,
            expectedBundleSha256: bundleHash, caseIds: ["E-01"] });
        if (process.env.B149_T11_FALLBACK_BODY_OUTPUT) writeFileSync(process.env.B149_T11_FALLBACK_BODY_OUTPUT,
            JSON.stringify(bodies, null, 2));
        expect(report.physicalDispatchAdmissions).toBe(3);
        expect(bodies.map(body => body.stream)).toEqual([true, true, false]);
        expect(bodies.map(body => body.max_tokens ?? body.max_completion_tokens))
            .toEqual([393_216, 393_216, 393_216]);
        expect(bodies[1].messages).toEqual(bodies[2].messages);
        expect(JSON.stringify(bodies[2].messages)).toContain("b149-fixed-tool");
        expect(report.results[0].terminalStatus).toBe("completed");
        expect(report.results[0].requestBodies[2]).toMatchObject({ measuredPromptTokens: 10,
            measuredTotalTokens: 12, usageStatus: 'completed' });
        expect(report.results[0].usage).toMatchObject({ knownPhysicalTokens: 12,
            physicalTotalTokens: null, physicalAttribution: 'incomplete' });
    });

    it("rejects a concurrent start while fixture preflight is still waiting", async () => {
        let releaseFixture!: () => void;
        const fixtureGate = new Promise<void>(resolve => { releaseFixture = resolve; });
        const testVault = harness("test", casesJson, fixtureGate);
        let dispatches = 0;
        globalThis.fetch = jest.fn(async (_url, init) => {
            dispatches++;
            return completion(JSON.parse(String(init?.body)));
        }) as typeof fetch;
        runInNewContext(source, testVault.sandbox);
        const first = testVault.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: bundleHash, caseIds: ["E-09"] });
        await expect(testVault.sandbox.__b149AgentEval.start({ maxRequests: 1,
            expectedBundleSha256: bundleHash, caseIds: ["E-09"] })).rejects.toThrow("B149_ALREADY_RUNNING");
        expect(testVault.created).toBe(0);
        expect(dispatches).toBe(0);
        releaseFixture();
        const report = await first;
        expect(report.status).toBe("recorded_for_review");
        expect(report.physicalDispatchAdmissions).toBe(1);
        expect(dispatches).toBe(1);
        expect(testVault.realVaultAccess).toEqual([]);
    });
});
