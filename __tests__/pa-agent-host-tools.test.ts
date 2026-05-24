import { describe, expect, it, jest } from "@jest/globals";

import {
    BUILTIN_WEB_SEARCH_TOOL_NAME,
    BuiltinWebSearchProvider,
} from "../src/ai-services/builtin-web-search-provider";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import type { AgentNetworkPolicy, CapabilityProvider } from "../src/ai-services/capability-types";
import { CoreToolProvider } from "../src/ai-services/core-tool-provider";
import {
    createPaAgentCapabilityToolExecutor,
} from "../src/ai-services/pa-agent-host-tools";
import {
    PaAgentLoop,
    type PaAgentModel,
    type PaAgentModelInput,
    type PaAgentModelStreamChunk,
    type PaAgentTurnSummary,
} from "../src/ai-services/pa-agent-loop";
import type { AgentEvent, MemorySearchResult } from "../src/ai-services/chat-types";

jest.mock("obsidian");

describe("PA Agent canonical host tool executor", () => {
    it("represents SkillContext as host pre-context instead of a fake toolResult", async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const events: AgentEvent[] = [];
        const hostContext = {
            skills: [{
                id: "pa-vault-link-health",
                content: "Use bounded read-only vault link checks.",
            }],
        };
        const loop = new PaAgentLoop({
            runId: "run-skill-context",
            userInput: "Find unresolved wikilinks.",
            hostContext,
            model: createModel([
                [{ type: "text_delta", text: "Use the link-health workflow." }],
            ], modelInputs),
            hostPolicy: continueAfterToolResults(),
            onEvent: (event) => events.push(event),
            now: deterministicNow(),
        });

        const result = await loop.run();

        expect(result.status).toBe("completed");
        expect(modelInputs[0]?.hostContext).toEqual(hostContext);
        expect(events.find((event) => event.type === "turn_start")).toMatchObject({
            type: "turn_start",
            metadata: {
                hostContext,
            },
        });
        expect(events.some((event) => event.type === "tool_execution_start")).toBe(false);
        expect(result.transcript.some((message) => message.role === "toolResult")).toBe(false);
    });

    it("represents user-explicit supplied context as user message content", async () => {
        const modelInputs: PaAgentModelInput[] = [];
        const explicitUserContent = [
            { type: "text", text: "Summarize this selection." },
            {
                type: "selected-text",
                text: "This pasted or selected passage belongs to the user message.",
                metadata: { source: "selection" },
            },
        ];
        const loop = new PaAgentLoop({
            runId: "run-explicit-user-content",
            userInput: "Summarize this selection.",
            userMessageContent: explicitUserContent,
            model: createModel([
                [{ type: "text_delta", text: "Summary." }],
            ], modelInputs),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();

        const userMessage = result.transcript.find((message) => message.role === "user");
        expect(result.status).toBe("completed");
        expect(userMessage).toMatchObject({
            role: "user",
            content: explicitUserContent,
        });
        expect(modelInputs[0]?.transcript).toEqual([expect.objectContaining({
            role: "user",
            content: explicitUserContent,
        })]);
        expect(modelInputs[0]?.hostContext).toBeUndefined();
        expect(result.transcript.some((message) => message.role === "toolResult")).toBe(false);
    });

    it("feeds search_memory toolResults into the follow-up assistant turn with Memory source records", async () => {
        const plugin = createPlugin();
        const registry = createCoreRegistry(async (input): Promise<MemorySearchResult> => ({
            usedMemory: true,
            query: input.query,
            documents: [{
                content: "Launch note says phase two starts Monday.",
                score: 0.95,
                source: { path: "memory/launch.md", chunkIndex: 0, score: 0.95 },
            }],
            sources: [{ path: "memory/launch.md", chunkIndex: 0, score: 0.95 }],
        }));
        const modelInputs: PaAgentModelInput[] = [];
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run-memory",
            userInput: "What do my launch notes say?",
            model: createModel([
                [toolCallChunk("call_memory_1", "search_memory", { query: "project launch notes" })],
                [{ type: "text_delta", text: "Phase two starts Monday." }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            onEvent: (event) => events.push(event),
            now: deterministicNow(),
        });

        const result = await loop.run();

        const toolResult = result.turns[0]?.toolResults[0];
        expect(result.status).toBe("completed");
        expect(modelInputs[0]?.transcript).toEqual([
            expect.objectContaining({
                role: "user",
                content: "What do my launch notes say?",
            }),
        ]);
        expect(modelInputs[0]?.transcript.some((message) => message.role === "toolResult")).toBe(false);
        expect(modelInputs[0]?.hostContext).toBeUndefined();
        expect(modelInputs[0]?.runtimeInstruction).toBeUndefined();
        expect(JSON.stringify(modelInputs[0])).not.toContain("Launch note says phase two starts Monday.");
        expect(modelInputs[1]?.transcript.filter((message) => message.role === "user")).toHaveLength(1);
        expect(modelInputs[1]?.transcript).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: "toolResult", toolName: "search_memory" }),
        ]));
        expect(toolResult?.content.promptText).toContain("Launch note says phase two starts Monday.");
        expect(toolResult?.content.sourceRecords).toEqual([expect.objectContaining({
            kind: "memory-reference",
            sourceBoundary: "memory",
            path: "memory/launch.md",
            turnId: result.turns[0]?.turnId,
            citationEligible: true,
        })]);
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "memory",
            label: "Selected Memory",
            citationEligible: true,
        })]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            type: "turn_end",
            toolResults: [expect.objectContaining({ toolName: "search_memory" })],
        });
        expectNoFullSourceMetadataDuplication(events);
    });

    it("normalizes search_memory query aliases before executing the Memory tool", async () => {
        const plugin = createPlugin();
        const executeMemorySearch = jest.fn<ConstructorParameters<typeof CoreToolProvider>[0]>(async (input): Promise<MemorySearchResult> => ({
            usedMemory: true,
            query: input.query,
            documents: [{
                content: "Launch note says phase two starts Monday.",
                score: 0.95,
                source: { path: "memory/launch.md", chunkIndex: 0, score: 0.95 },
            }],
            sources: [{ path: "memory/launch.md", chunkIndex: 0, score: 0.95 }],
        }));
        const registry = createCoreRegistry(executeMemorySearch);
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-memory-query-alias",
            userInput: "What do my launch notes say?",
            model: createModel([
                [toolCallChunk("call_memory_alias_1", "search_memory", { question: "project launch notes" })],
                [{ type: "text_delta", text: "Phase two starts Monday." }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();
        const toolResult = result.turns[0]?.toolResults[0];

        expect(result.status).toBe("completed");
        expect(executeMemorySearch).toHaveBeenCalledWith(
            expect.objectContaining({ query: "project launch notes" }),
            expect.any(Object),
        );
        expect(toolResult?.isError).toBe(false);
        expect(toolResult?.content.promptText).toContain("Launch note says phase two starts Monday.");
        expect(toolResult?.content.promptText).not.toContain("search_memory input.query must be a non-empty string");
    });

    it("uses the user request as a safe Memory query when the provider omits tool arguments", async () => {
        const plugin = createPlugin();
        const userInput = "According to my Memory, what do my launch notes say?";
        const executeMemorySearch = jest.fn<ConstructorParameters<typeof CoreToolProvider>[0]>(async (input): Promise<MemorySearchResult> => ({
            usedMemory: true,
            query: input.query,
            documents: [{
                content: "Launch note says phase two starts Monday.",
                score: 0.95,
                source: { path: "memory/launch.md", chunkIndex: 0, score: 0.95 },
            }],
            sources: [{ path: "memory/launch.md", chunkIndex: 0, score: 0.95 }],
        }));
        const registry = createCoreRegistry(executeMemorySearch);
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-memory-missing-query",
            userInput,
            model: createModel([
                [toolCallChunk("call_memory_missing_query_1", "search_memory", {})],
                [{ type: "text_delta", text: "Phase two starts Monday." }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();
        const toolResult = result.turns[0]?.toolResults[0];

        expect(result.status).toBe("completed");
        expect(executeMemorySearch).toHaveBeenCalledWith(
            expect.objectContaining({ query: userInput }),
            expect.any(Object),
        );
        expect(toolResult?.isError).toBe(false);
        expect(toolResult?.content.promptText).toContain("Launch note says phase two starts Monday.");
        expect(toolResult?.content.promptText).not.toContain("search_memory input.query must be a non-empty string");
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "memory",
            label: "Selected Memory",
        })]);
    });

    it("feeds get_current_note_context toolResults into the follow-up assistant turn as current-note context", async () => {
        const plugin = createPlugin({
            activeMarkdownView: createMarkdownView({
                path: "notes/current.md",
                value: "# Current\nSelected project context",
                selection: "Selected project context",
            }),
        });
        const registry = createCoreRegistry();
        const modelInputs: PaAgentModelInput[] = [];
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run-current-note",
            userInput: "Summarize the selected text.",
            model: createModel([
                [toolCallChunk("call_current_1", "get_current_note_context", { mode: "selection-or-nearby" })],
                [{ type: "text_delta", text: "The selected text is project context." }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            onEvent: (event) => events.push(event),
            now: deterministicNow(),
        });

        const result = await loop.run();

        const toolResult = result.turns[0]?.toolResults[0];
        expect(result.status).toBe("completed");
        expect(modelInputs[0]?.hostContext).toBeUndefined();
        expect(modelInputs[0]?.runtimeInstruction).toBeUndefined();
        expect(JSON.stringify(modelInputs[0])).not.toContain("Selected project context");
        expect(modelInputs[1]?.transcript).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: "toolResult", toolName: "get_current_note_context" }),
        ]));
        expect(toolResult?.content.promptText).toContain("Selected project context");
        expect(toolResult?.content.sourceRecords).toEqual([expect.objectContaining({
            kind: "context-used",
            sourceBoundary: "current-note",
            path: "notes/current.md",
            turnId: result.turns[0]?.turnId,
            citationEligible: false,
        })]);
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "current-note",
            label: "Current note",
            citationEligible: false,
        })]);
        expect(toolResult?.content.contextUsed).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ category: "memory" }),
        ]));
        expectNoFullSourceMetadataDuplication(events);
    });

    it("normalizes canonical current-note mode drift before executing the host tool", async () => {
        const plugin = createPlugin({
            activeMarkdownView: createMarkdownView({
                path: "notes/current.md",
                value: "# Current\nBody with pa-positive-snippet-token-1701.",
            }),
        });
        const registry = createCoreRegistry();
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-current-note-mode-drift",
            userInput: "Use the current note and return the token.",
            model: createModel([
                [toolCallChunk("call_current_1", "get_current_note_context", { mode: "nearby" })],
                [{ type: "text_delta", text: "pa-positive-snippet-token-1701" }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();
        const toolResult = result.turns[0]?.toolResults[0];

        expect(result.status).toBe("completed");
        expect(toolResult?.isError).toBe(false);
        expect(toolResult?.content.promptText).toContain("pa-positive-snippet-token-1701");
        expect(toolResult?.content.promptText).not.toContain("input.mode is invalid");
        expect(toolResult?.content.metadata).toMatchObject({
            ok: true,
            outcome: "success",
            tool: "get_current_note_context",
        });
        expect(modelInputs[1]?.transcript).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: "toolResult",
                toolName: "get_current_note_context",
            }),
        ]));
    });

    it("promotes exact current-note-only lookups to full current-note context", async () => {
        const plugin = createPlugin({
            activeMarkdownView: createMarkdownView({
                path: "notes/current.md",
                value: `# Current\n${"filler ".repeat(600)}\npa-positive-snippet-token-1701`,
            }),
        });
        const registry = createCoreRegistry();
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-current-note-full-lookup",
            userInput: "Use the current note only. Reply with the exact token whose prefix is pa-positive-snippet-token.",
            model: createModel([
                [toolCallChunk("call_current_1", "get_current_note_context", { mode: "selection-or-nearby" })],
                [{ type: "text_delta", text: "pa-positive-snippet-token-1701" }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();
        const toolResult = result.turns[0]?.toolResults[0];

        expect(result.status).toBe("completed");
        expect(toolResult?.isError).toBe(false);
        expect(toolResult?.content.promptText).toContain("\"mode\": \"full\"");
        expect(toolResult?.content.promptText).toContain("pa-positive-snippet-token-1701");
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "current-note",
            detail: "Read-only current note context (full)",
        })]);
    });

    it("repairs structured vault tool inputs from the user request when providers omit required arguments", async () => {
        const plugin = createPlugin();
        const execute = jest.fn(async (name: string, input: unknown, _context: unknown) => ({
            ok: true,
            tool: name,
            inputSummary: JSON.stringify(input),
            content: { normalized: input },
            sources: [],
        }));
        const registry = { execute } as unknown as CapabilityRegistry;
        const executor = createPaAgentCapabilityToolExecutor({ registry, plugin });
        const signal = new AbortController().signal;

        const executeTool = async (name: string, input: unknown, userInput: string) => {
            await executor.execute({
                runId: "run-vault-normalize",
                turnId: "turn-vault-normalize",
                turnIndex: 0,
                userInput,
                signal,
                toolCall: {
                    type: "toolCall",
                    id: `call-${execute.mock.calls.length}`,
                    name,
                    input,
                    index: 0,
                },
            });
        };

        await executeTool(
            "search_vault_snippets",
            {},
            "Search note snippets for pa-positive-snippet-token-1701 and reply with the exact token.",
        );
        await executeTool(
            "search_vault_metadata",
            {},
            "Use search_vault_metadata with query note-structure-smoke. Reply with the best matching vault path only.",
        );
        await executeTool(
            "read_note_outline",
            {},
            "Use read_note_outline for obsidian-operations/note-structure-smoke.md. Reply with the first two heading names only.",
        );
        await executeTool(
            "read_canvas_summary",
            {},
            "Use read_canvas_summary for obsidian-operations/canvas-smoke.canvas. Reply with node count and edge count only.",
        );
        await executeTool(
            "inspect_obsidian_note",
            { path: "" },
            "Inspect obsidian-operations/note-structure-smoke.md and reply with the note structure.",
        );
        await executeTool(
            "search_vault_snippets",
            { input: { token: "pa-positive-snippet-token-1701" } },
            "Find the token in note snippets.",
        );

        expect(execute).toHaveBeenNthCalledWith(
            1,
            "search_vault_snippets",
            { query: "pa-positive-snippet-token-1701" },
            expect.any(Object),
        );
        expect(execute).toHaveBeenNthCalledWith(
            2,
            "search_vault_metadata",
            { query: "note-structure-smoke" },
            expect.any(Object),
        );
        expect(execute).toHaveBeenNthCalledWith(
            3,
            "read_note_outline",
            { path: "obsidian-operations/note-structure-smoke.md", max_headings: 2 },
            expect.any(Object),
        );
        expect(execute).toHaveBeenNthCalledWith(
            4,
            "read_canvas_summary",
            { path: "obsidian-operations/canvas-smoke.canvas" },
            expect.any(Object),
        );
        expect(execute).toHaveBeenNthCalledWith(
            5,
            "inspect_obsidian_note",
            { path: "obsidian-operations/note-structure-smoke.md" },
            expect.any(Object),
        );
        expect(execute).toHaveBeenNthCalledWith(
            6,
            "search_vault_snippets",
            { query: "pa-positive-snippet-token-1701" },
            expect.any(Object),
        );
    });

    it("feeds builtin webSearch toolResults into the follow-up assistant turn with web source records", async () => {
        const plugin = createPlugin();
        const registry = new CapabilityRegistry();
        await registerProvider(registry, new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request: jest.fn(async () => ({
                status: 200,
                body: {
                    results: [{
                        title: "Official result",
                        url: "https://example.com/result?api_key=sk-SECRET_TOKEN_SENTINEL",
                        snippet: "External context",
                    }],
                },
            })),
        }));
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-web",
            userInput: "Search the web for latest docs.",
            model: createModel([
                [toolCallChunk("call_web_1", BUILTIN_WEB_SEARCH_TOOL_NAME, { query: "latest docs", limit: 1 })],
                [{ type: "text_delta", text: "External result found." }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();

        const toolResult = result.turns[0]?.toolResults[0];
        expect(result.status).toBe("completed");
        expect(modelInputs[1]?.transcript).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: "toolResult", toolName: BUILTIN_WEB_SEARCH_TOOL_NAME }),
        ]));
        expect(toolResult?.content.promptText).toContain("External context");
        expect(toolResult?.content.promptText).toContain("api_key=REDACTED");
        expect(toolResult?.content.sourceRecords).toEqual([expect.objectContaining({
            kind: "web-source",
            sourceBoundary: "web",
            capabilityName: BUILTIN_WEB_SEARCH_TOOL_NAME,
            url: "https://example.com/result?api_key=REDACTED",
            turnId: result.turns[0]?.turnId,
            citationEligible: true,
        })]);
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "read-only-tool",
            label: "WebSearch",
            detail: "1 normalized web source",
        })]);
    });

    it("normalizes canonical webSearch input drift before executing the builtin tool", async () => {
        const plugin = createPlugin();
        const registry = new CapabilityRegistry();
        const request = jest.fn(async (_request: unknown, _context: unknown) => ({
            status: 200,
            body: {
                results: [{
                    title: "Official Obsidian",
                    url: "https://obsidian.md/",
                    snippet: "Obsidian official homepage.",
                }],
            },
        }));
        await registerProvider(registry, new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        }));
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-web-input-drift",
            userInput: "Use web search for the official Obsidian homepage.",
            model: createModel([
                [toolCallChunk("call_web_drift_1", BUILTIN_WEB_SEARCH_TOOL_NAME, {
                    search_query: "official Obsidian homepage domain",
                    max_results: "1",
                })],
                [{ type: "text_delta", text: "obsidian.md" }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();
        const toolResult = result.turns[0]?.toolResults[0];

        expect(result.status).toBe("completed");
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: "official Obsidian homepage domain",
                limit: 1,
            },
        }), expect.any(Object));
        expect(toolResult?.isError).toBe(false);
        expect(toolResult?.content.promptText).toContain("Obsidian official homepage.");
        expect(toolResult?.content.promptText).not.toContain("Invalid WebSearch input");
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "read-only-tool",
            label: "WebSearch",
            detail: "1 normalized web source",
        })]);
    });

    it("uses the user request as a safe webSearch query when the provider omits tool arguments", async () => {
        const plugin = createPlugin();
        const registry = new CapabilityRegistry();
        const request = jest.fn(async (_request: unknown, _context: unknown) => ({
            status: 200,
            body: {
                results: [{
                    title: "Official Obsidian",
                    url: "https://obsidian.md/",
                    snippet: "Obsidian official homepage.",
                }],
            },
        }));
        await registerProvider(registry, new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        }));
        const userInput = "Use web search to verify the official Obsidian homepage domain.";
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-web-missing-query",
            userInput,
            model: createModel([
                [toolCallChunk("call_web_missing_query_1", BUILTIN_WEB_SEARCH_TOOL_NAME, {})],
                [{ type: "text_delta", text: "obsidian.md" }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();
        const toolResult = result.turns[0]?.toolResults[0];

        expect(result.status).toBe("completed");
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: userInput,
                limit: 5,
            },
        }), expect.any(Object));
        expect(toolResult?.isError).toBe(false);
        expect(toolResult?.content.promptText).toContain("Obsidian official homepage.");
        expect(toolResult?.content.promptText).not.toContain("Invalid WebSearch input");
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "read-only-tool",
            label: "WebSearch",
            detail: "1 normalized web source",
        })]);
    });

    it("does not create web source records when builtin webSearch returns no normalized web sources", async () => {
        const plugin = createPlugin();
        const registry = new CapabilityRegistry();
        await registerProvider(registry, new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request: jest.fn(async () => ({
                status: 200,
                body: {
                    results: [{
                        title: "Invalid URL result",
                        url: "obsidian://local-only",
                        snippet: "This source should not become a web source.",
                    }],
                },
            })),
        }));
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run-web-no-sources",
            userInput: "Search the web for latest docs.",
            model: createModel([
                [toolCallChunk("call_web_empty_1", BUILTIN_WEB_SEARCH_TOOL_NAME, { query: "latest docs", limit: 1 })],
                [{ type: "text_delta", text: "No normalized web sources were available." }],
            ], modelInputs),
            toolExecutor: createPaAgentCapabilityToolExecutor({ registry, plugin }),
            hostPolicy: continueAfterToolResults(),
            now: deterministicNow(),
        });

        const result = await loop.run();

        const toolResult = result.turns[0]?.toolResults[0];
        expect(result.status).toBe("completed");
        expect(modelInputs[1]?.transcript).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: "toolResult", toolName: BUILTIN_WEB_SEARCH_TOOL_NAME }),
        ]));
        expect(toolResult?.content.sourceRecords).toEqual([]);
        expect(toolResult?.content.sourceRecords).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "web-source" }),
        ]));
        expect(toolResult?.content.contextUsed).toEqual([expect.objectContaining({
            category: "read-only-tool",
            label: "WebSearch",
            detail: "0 normalized web sources",
            statusOnly: true,
        })]);
    });
});

function createCoreRegistry(
    executeMemorySearch: ConstructorParameters<typeof CoreToolProvider>[0] = async (input): Promise<MemorySearchResult> => ({
        usedMemory: false,
        query: input.query,
        documents: [],
        sources: [],
        skipReason: "No Memory results.",
    }),
): CapabilityRegistry {
    const registry = new CapabilityRegistry();
    registry.registerMany(new CoreToolProvider(executeMemorySearch).loadCapabilities());
    return registry;
}

async function registerProvider(registry: CapabilityRegistry, provider: CapabilityProvider): Promise<void> {
    const result = await registry.registerProvider(provider, {
        turnId: "provider-load",
        platform: "desktop",
        settings: {},
    });
    expect(result.status).toBe("available");
}

function continueAfterToolResults() {
    return {
        afterTurn: jest.fn((summary: PaAgentTurnSummary) => {
            if (summary.status === "tool_results_ready") {
                return { action: "continue" as const, reason: "tool_results_ready" as const };
            }
            return { action: "stop" as const, status: "completed" as const, reason: "done" };
        }),
    };
}

function createModel(
    turns: PaAgentModelStreamChunk[][],
    inputs: PaAgentModelInput[],
): PaAgentModel {
    return {
        stream: (input) => {
            inputs.push(input);
            const chunks = turns.shift() ?? [];
            return (async function* () {
                for (const chunk of chunks) {
                    yield chunk;
                }
            })();
        },
    };
}

function toolCallChunk(
    id: string,
    name: string,
    input: unknown,
): PaAgentModelStreamChunk {
    return {
        type: "toolcall_delta",
        id,
        name,
        argsText: JSON.stringify(input),
        index: 0,
    };
}

function deterministicNow(): () => number {
    let now = 1000;
    return () => now++;
}

function createPlugin(overrides: {
    activeMarkdownView?: unknown;
} = {}) {
    return {
        app: {
            workspace: {
                getActiveViewOfType: jest.fn(() => overrides.activeMarkdownView ?? null),
                getMostRecentLeaf: jest.fn(() => null),
                getLeavesOfType: jest.fn(() => []),
            },
            vault: {
                getAbstractFileByPath: jest.fn(() => null),
                cachedRead: jest.fn(async () => ""),
            },
            metadataCache: {
                getFileCache: jest.fn(() => null),
            },
        },
        log: jest.fn(),
    } as never;
}

function createMarkdownView(overrides: {
    path: string;
    value: string;
    selection?: string;
}) {
    const lines = overrides.value.split(/\r?\n/);
    return {
        file: {
            path: overrides.path,
            basename: overrides.path.replace(/\.md$/, ""),
        },
        editor: {
            getSelection: jest.fn(() => overrides.selection ?? ""),
            getValue: jest.fn(() => overrides.value),
            getCursor: jest.fn(() => ({ line: 0, ch: 0 })),
            lineCount: jest.fn(() => lines.length),
            getLine: jest.fn((line: number) => lines[line] ?? ""),
        },
        getViewType: jest.fn(() => "markdown"),
    };
}

function createWebSearchPolicy(): AgentNetworkPolicy {
    return {
        transport: "streamable-http",
        allowedEndpoints: ["https://example.com/mcp/web-search"],
        authKeyId: "bailian-web-search",
        redactHeaders: ["authorization"],
        redactQueryParams: ["api_key"],
        maxResponseBytes: 10_000,
        maxCallsPerTurn: 2,
    };
}

function expectNoFullSourceMetadataDuplication(events: AgentEvent[]): void {
    const turnEnd = events.find((event) => event.type === "turn_end");
    expect(turnEnd).toBeDefined();
    expect(turnEnd?.metadata ?? {}).not.toHaveProperty("sourceRecords");
    expect(turnEnd?.metadata ?? {}).not.toHaveProperty("contextUsed");

    const agentEnd = events.find((event) => event.type === "agent_end");
    expect(agentEnd).toBeDefined();
    expect(agentEnd?.metadata ?? {}).not.toHaveProperty("sourceRecords");
    expect(agentEnd?.metadata ?? {}).not.toHaveProperty("contextUsed");
}
