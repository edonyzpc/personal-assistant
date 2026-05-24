import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { ChatAgentRuntime, type ChatAgentRuntimeOptions } from "../src/ai-services/chat-agent";
import {
    BUILTIN_WEB_SEARCH_TOOL_NAME,
    BuiltinWebSearchProvider,
} from "../src/ai-services/builtin-web-search-provider";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import type { AgentCapability, AgentNetworkPolicy, CapabilityProvider } from "../src/ai-services/capability-types";
import type { AgentEvent as CanonicalAgentEvent, LegacyAgentEvent as AgentEvent } from "../src/ai-services/chat-types";
import { SkillContextProvider } from "../src/ai-services/skill-context-provider";
import {
    multiToolCallPartialJsonFixture,
    replayAiMessageStream,
    singleToolCallFixture,
    type RecordedLlmStreamFixture,
} from "../src/tests/fixtures/llm-stream";

jest.mock("obsidian");

jest.mock("@langchain/core/prompts", () => ({
    ChatPromptTemplate: {
        fromMessages: jest.fn(() => ({
            pipe: (model: unknown) => model,
        })),
    },
    SystemMessagePromptTemplate: {
        fromTemplate: jest.fn((template: string) => ({ template })),
    },
    HumanMessagePromptTemplate: {
        fromTemplate: jest.fn((template: string) => ({ template })),
    },
}));

afterEach(() => {
    jest.restoreAllMocks();
});

describe("PA Agent answer-stream runtime path", () => {
    it("keeps baseline canonical model input free of runtime instructions", async () => {
        const fromMessages = ChatPromptTemplate.fromMessages as jest.Mock;
        fromMessages.mockClear();
        const plugin = createPlugin();
        const modelInputs: Record<string, string>[] = [];
        const directAnswer = createStreamModel([{ content: "Hello world" }], (input) => {
            modelInputs.push(input);
        });
        const runtime = createRuntime(plugin, [directAnswer]);

        await runtime.streamTurn({
            prompt: "hello",
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
        });

        expect(modelInputs).toHaveLength(1);
        expect(modelInputs[0]).toEqual({
            input: "User input:\nhello",
            tool_definitions: expect.any(String),
            tool_observations: "None",
        });
        expectToolDefinitionNames(modelInputs[0], CORE_TOOL_NAMES);
        expect(modelInputs[0]?.input).not.toContain("<runtime_instruction>");
        expect(modelInputs[0]?.tool_observations).toBe("None");
        expect(finalAnswerPromptTemplates(fromMessages)).toHaveLength(1);
        expect(finalAnswerPromptTemplates(fromMessages)[0]).not.toContain("runtime_instruction");
    });

    it("streams a direct answer without old automatic Memory presearch", async () => {
        const plugin = createPlugin();
        const directAnswer = createStreamModel([{ content: "Hello " }, { content: "world" }]);
        const runtime = createRuntime(plugin, [directAnswer]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "hello",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(plugin.memoryManager.ensureReadyForChat).not.toHaveBeenCalled();
        expect(plugin.vss.searchSimilarity).not.toHaveBeenCalled();
        expect(events.filter((event) => event.kind === "answer-snapshot").map((event) => event.snapshot)).toEqual([
            "Hello ",
            "Hello world",
        ]);
        expect(events.at(-1)).toMatchObject({ kind: "answer-complete" });
    });

    it("executes streamed tool calls through CapabilityRegistry and resumes the answer", async () => {
        const plugin = createPlugin({
            searchSimilarity: async () => [{
                score: 0.95,
                doc: {
                    pageContent: "Launch note says phase two starts Monday.",
                    metadata: { path: "memory/launch.md", chunkIndex: 0 },
                },
            }],
            fileContents: {
                "memory/launch.md": "Launch note says phase two starts Monday.",
            },
        });
        const toolStream = createStreamModel(singleToolCallFixture);
        const answerStream = createStreamModel([{ content: "Phase two starts Monday." }]);
        const executeSpy = jest.spyOn(CapabilityRegistry.prototype, "execute");
        const runtime = createRuntime(plugin, [toolStream, answerStream]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "What do my launch notes say?",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(executeSpy).toHaveBeenCalledWith(
            "search_memory",
            { query: "project launch notes" },
            expect.objectContaining({ plugin }),
        );
        expect(plugin.memoryManager.ensureReadyForChat).toHaveBeenCalledTimes(1);
        expect(plugin.vss.searchSimilarity).toHaveBeenCalledWith("project launch notes");
        expect(events.filter((event) => event.kind === "segment-boundary").map((event) => event.boundary.reason)).toEqual([
            "tool-call-started",
            "tool-call-finished",
        ]);
        expect(events.filter((event) => event.kind === "answer-snapshot").map((event) => event.snapshot)).toEqual([
            "Phase two starts Monday.",
        ]);
        expect(events.find((event) => event.kind === "turn-metadata")).toMatchObject({
            kind: "turn-metadata",
            metadata: {
                hasMemoryContent: true,
                allowedMemorySourcePaths: ["memory/launch.md"],
                sourceRecords: [expect.objectContaining({
                    kind: "memory-reference",
                    path: "memory/launch.md",
                })],
            },
        });
    });

    it("finalizes without tools after a read-only tool is called with missing required input", async () => {
        const plugin = createPlugin();
        const badToolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_outline_missing_path",
                index: 0,
                name: "read_note_outline",
                args: "{}",
            }],
        }]);
        const finalInputs: Record<string, string>[] = [];
        const answerStream = createStreamModel(
            [{ content: "I need a specific note path before I can inspect an outline." }],
            (input) => finalInputs.push(input),
        );
        const runtime = createRuntime(plugin, [badToolStream, answerStream]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Inspect a note outline, but I did not provide a note path.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(canonicalEvents.find((event) =>
            event.type === "tool_execution_end" && event.toolName === "read_note_outline",
        )).toMatchObject({
            outcome: "recoverable_error",
        });
        expect(canonicalEvents.find((event) =>
            event.type === "turn_start" && event.metadata?.turnIndex === 1,
        )).toMatchObject({
            metadata: {
                runtimeInstruction: expect.stringContaining("This is a finalization turn. Do not call tools."),
                toolMode: "final_answer_only",
            },
        });
        expect(finalInputs[0]?.tool_definitions).toBe("No tools are available in this finalization turn.");
        expect(finalInputs[0]?.tool_observations).toContain("read_note_outline input.path must be a non-empty string");
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed",
        });
    });

    it("uses the user prompt as Memory query when streamed search_memory arguments are empty", async () => {
        const plugin = createPlugin({
            searchSimilarity: async () => [{
                score: 0.95,
                doc: {
                    pageContent: "Launch note says phase two starts Monday.",
                    metadata: { path: "memory/launch.md", chunkIndex: 0 },
                },
            }],
            fileContents: {
                "memory/launch.md": "Launch note says phase two starts Monday.",
            },
        });
        const prompt = "According to my Memory, what do my launch notes say?";
        const toolStream = createStreamModel([{
            content: "",
            tool_calls: [{
                id: "call_memory_empty_1",
                name: "search_memory",
                args: {},
            }],
        }]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "Phase two starts Monday." }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt,
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
            onEvent: (event) => events.push(event),
        });

        expect(plugin.memoryManager.ensureReadyForChat).toHaveBeenCalledTimes(1);
        expect(plugin.vss.searchSimilarity).toHaveBeenCalledWith(prompt);
        expect(answerInput?.tool_observations).toContain("Launch note says phase two starts Monday.");
        expect(answerInput?.tool_observations).not.toContain("search_memory input.query must be a non-empty string");
        expect(events.filter((event) => event.kind === "answer-snapshot").map((event) => event.snapshot)).toEqual([
            "Phase two starts Monday.",
        ]);
        expect(events.find((event) => event.kind === "turn-metadata")).toMatchObject({
            kind: "turn-metadata",
            metadata: {
                hasMemoryContent: true,
                allowedMemorySourcePaths: ["memory/launch.md"],
            },
        });
    });

    it("emits canonical lifecycle events when the PA lifecycle callback is provided", async () => {
        const plugin = createPlugin({
            searchSimilarity: async () => [{
                score: 0.95,
                doc: {
                    pageContent: "Launch note says phase two starts Monday.",
                    metadata: { path: "memory/launch.md", chunkIndex: 0 },
                },
            }],
            fileContents: {
                "memory/launch.md": "Launch note says phase two starts Monday.",
            },
        });
        const toolStream = createStreamModel(singleToolCallFixture);
        const answerStream = createStreamModel([{ content: "Phase two starts Monday." }]);
        const runtime = createRuntime(plugin, [toolStream, answerStream]);
        const canonicalEvents: CanonicalAgentEvent[] = [];
        const legacyEvents: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "What do my launch notes say?",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
            onEvent: (event) => legacyEvents.push(event),
        });

        expect(canonicalEvents.map((event) => event.type)).toEqual(expect.arrayContaining([
            "agent_start",
            "turn_start",
            "message_start",
            "message_update",
            "message_end",
            "tool_execution_start",
            "tool_execution_end",
            "turn_end",
            "agent_end",
        ]));
        expect(canonicalEvents[0]).toMatchObject({
            type: "agent_start",
            scope: "run",
            turnId: "__run__",
        });
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            scope: "run",
            turnId: "__run__",
            status: "completed",
        });
        expect(new Set(canonicalEvents.map((event) => event.runId)).size).toBe(1);
        expect(canonicalEvents.every((event) => typeof event.turnId === "string" && event.turnId.length > 0)).toBe(true);
        expect(canonicalEvents.find((event) => event.type === "message_end" && event.message.role === "toolResult")).toMatchObject({
            type: "message_end",
            message: {
                role: "toolResult",
                content: {
                    sourceRecords: [expect.objectContaining({
                        kind: "memory-reference",
                        path: "memory/launch.md",
                    })],
                    contextUsed: [expect.objectContaining({
                        category: "memory",
                        label: "Selected Memory",
                    })],
                },
            },
        });
        expect(legacyEvents.filter((event) => event.kind === "answer-snapshot").map((event) => event.snapshot)).toEqual([
            "Phase two starts Monday.",
        ]);
        expect(legacyEvents.find((event) => event.kind === "turn-metadata")).toMatchObject({
            kind: "turn-metadata",
            metadata: {
                hasMemoryContent: true,
                allowedMemorySourcePaths: ["memory/launch.md"],
            },
        });
    });

    it("injects SkillContext as canonical host pre-context without fake toolResults", async () => {
        const plugin = createPlugin();
        const modelInputs: Record<string, string>[] = [];
        const answerStream = createStreamModel([{ content: "Use the link-health workflow." }], (input) => {
            modelInputs.push(input);
        });
        const runtime = createRuntime(plugin, [answerStream], [], {
            skillContextProvider: new SkillContextProvider([{
                path: "skills/pa-vault-link-health/SKILL.md",
                content: [
                    "---",
                    "name: pa-vault-link-health",
                    "description: Use when checking unresolved wikilinks, backlinks, embeds, and vault link health.",
                    "---",
                    "Use bounded read-only vault link checks.",
                ].join("\n"),
            }]),
        });
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Check unresolved wikilinks and backlinks in this vault.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(modelInputs[0]?.input).toContain("<host_context>");
        expect(modelInputs[0]?.input).toContain("Use bounded read-only vault link checks.");
        expect(modelInputs[0]?.tool_observations).toBe("None");
        expect(modelInputs[0]?.tool_observations).not.toContain("Use bounded read-only vault link checks.");
        expect(canonicalEvents.find((event) => event.type === "turn_start")).toMatchObject({
            type: "turn_start",
            metadata: {
                hostContext: {
                    skills: [expect.objectContaining({
                        id: "pa-vault-link-health",
                        content: expect.stringContaining("Use bounded read-only vault link checks."),
                    })],
                    contextUsed: [expect.objectContaining({
                        category: "skill-guide",
                        label: "pa-vault-link-health",
                    })],
                    sourceRecords: [expect.objectContaining({
                        kind: "skill-guide",
                        sourceBoundary: "skill-context",
                    })],
                },
            },
        });
        expect(canonicalEvents.some((event) => event.type === "tool_execution_start")).toBe(false);
        expect(canonicalEvents.some((event) => event.type === "message_end" && event.message.role === "toolResult")).toBe(false);
    });

    it("appends required capability runtime instructions and uses one corrective turn", async () => {
        const fromMessages = ChatPromptTemplate.fromMessages as jest.Mock;
        fromMessages.mockClear();
        const plugin = createPlugin();
        const modelInputs: Record<string, string>[] = [];
        const firstAnswer = createStreamModel([{ content: "Answer without Memory." }], (input) => {
            modelInputs.push(input);
        });
        const correctiveAnswer = createStreamModel([{ content: "Still without Memory." }], (input) => {
            modelInputs.push(input);
        });
        const runtime = createRuntime(plugin, [firstAnswer, correctiveAnswer]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "What do my notes say about launch?",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(modelInputs).toHaveLength(2);
        const requiredInstruction = "The user request appears to require Memory from notes (search_memory). Use the listed tool or tools if available before answering. If a listed tool is unavailable, answer from available context and do not claim unavailable evidence.";
        const correctiveInstruction = "The answer still appears to require Memory from notes (search_memory). Use the listed tool or tools if available before giving the final answer. If the tool is unavailable, answer from available context and do not claim unavailable evidence.";
        expect(modelInputs[0]).toEqual({
            input: `User input:\nWhat do my notes say about launch?\n\n<runtime_instruction>\n${requiredInstruction}\n</runtime_instruction>`,
            tool_definitions: expect.any(String),
            tool_observations: "None",
        });
        expect(modelInputs[1]).toEqual({
            input: `User input:\nWhat do my notes say about launch?\n\n<runtime_instruction>\n${correctiveInstruction}\n</runtime_instruction>`,
            tool_definitions: expect.any(String),
            tool_observations: "None",
        });
        expectToolDefinitionNames(modelInputs[0], CORE_TOOL_NAMES);
        expectToolDefinitionNames(modelInputs[1], CORE_TOOL_NAMES);
        expect(modelInputs[1]?.tool_definitions).toBe(modelInputs[0]?.tool_definitions);
        const templates = finalAnswerPromptTemplates(fromMessages);
        expect(templates).toHaveLength(2);
        expect(new Set(templates).size).toBe(1);
        expect(templates[0]).not.toContain("Memory from notes");
        expect(templates[0]).not.toContain("runtime_instruction");
        expect(canonicalEvents.filter((event) =>
            event.type === "message_end" && event.message.role === "user")).toHaveLength(1);
        expect(canonicalEvents.filter((event) => event.type === "turn_start")).toHaveLength(2);
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed_with_warning",
            metadata: {
                warnings: [expect.objectContaining({
                    type: "required_capability_missing",
                    capability: "search_memory",
                })],
            },
        });
    });

    it("emits incomplete diagnostics when corrective turns produce no answer", async () => {
        const plugin = createPlugin();
        const runtime = createRuntime(plugin, [
            createStreamModel([{ content: "" }]),
            createStreamModel([{ content: "" }]),
        ]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "What do my notes say about launch?",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(canonicalEvents.filter((event) => event.type === "turn_start")).toHaveLength(2);
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "incomplete",
            metadata: {
                reason: "required_capability_missing",
                diagnostics: [expect.objectContaining({
                    type: "required_capability_missing",
                    capabilities: ["search_memory"],
                })],
            },
        });
    });

    it("appends an unavailable capability note without corrective turns", async () => {
        const plugin = createPlugin();
        const modelInputs: Record<string, string>[] = [];
        const answerStream = createStreamModel([{ content: "Answering from available context." }], (input) => {
            modelInputs.push(input);
        });
        const runtime = createRuntime(plugin, [answerStream]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for latest docs.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(modelInputs).toHaveLength(1);
        const unavailableInstruction = "The user request appears to require WebSearch (webSearch), but that capability is unavailable in this runtime. Answer from available context and do not claim unavailable evidence.";
        expect(modelInputs[0]).toEqual({
            input: `User input:\nSearch the web for latest docs.\n\n<runtime_instruction>\n${unavailableInstruction}\n</runtime_instruction>`,
            tool_definitions: expect.any(String),
            tool_observations: "None",
        });
        expectToolDefinitionNames(modelInputs[0], CORE_TOOL_NAMES);
        expect(modelInputs[0]?.input).not.toContain("The answer still appears");
        expect(canonicalEvents.filter((event) => event.type === "turn_start")).toHaveLength(1);
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed_with_warning",
            metadata: {
                warnings: [expect.objectContaining({
                    type: "required_capability_missing",
                    capability: "webSearch",
                    metadata: expect.objectContaining({
                        available: false,
                        correctiveAttempted: false,
                    }),
                })],
            },
        });
    });

    it("does not count failed builtin WebSearch as satisfying a required capability", async () => {
        const plugin = createPlugin();
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request: jest.fn(async () => ({ status: 500, body: { error: "upstream failed" } })),
        });
        const toolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_web_1",
                index: 0,
                name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                args: "{\"query\":\"latest docs\",\"limit\":1}",
            }],
        }]);
        const firstAnswer = createStreamModel([{ content: "Answer after failed web." }]);
        const correctiveAnswer = createStreamModel([{ content: "Still no successful web." }]);
        const { runtime, createChatModel } = createRuntimeWithModels(
            plugin,
            [toolStream, firstAnswer, correctiveAnswer],
            [webSearchProvider],
        );
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for latest docs.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        const failedWebResult = canonicalEvents.find((event) =>
            event.type === "message_end"
            && event.message.role === "toolResult"
            && event.message.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME);
        expect(failedWebResult).toMatchObject({
            type: "message_end",
            message: {
                role: "toolResult",
                isError: true,
                content: {
                    metadata: expect.objectContaining({
                        outcome: "recoverable_error",
                    }),
                },
            },
        });
        expect(canonicalEvents.filter((event) => event.type === "turn_start")).toHaveLength(2);
        expect(canonicalEvents.filter((event) =>
            event.type === "message_end" && event.message.role === "user")).toHaveLength(1);
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed_with_warning",
            metadata: {
                warnings: [expect.objectContaining({
                    type: "required_capability_missing",
                    capability: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    metadata: expect.objectContaining({
                        available: true,
                        correctiveAttempted: false,
                        failedRequiredToolRetryAttempted: true,
                    }),
                })],
            },
        });
        expect(createChatModel.mock.calls.map((call) => call[1])).toEqual([
            { transport: "native", qwenRequestOptions: undefined },
            { transport: "native", qwenRequestOptions: undefined },
        ]);
    });

    it("snapshots suggested runtime hint request shape", async () => {
        const plugin = createPlugin();
        const modelInputs: Record<string, string>[] = [];
        const answerStream = createStreamModel([{ content: "Suggested Memory hint answer." }], (input) => {
            modelInputs.push(input);
        });
        const runtime = createRuntime(plugin, [answerStream]);

        await runtime.streamTurn({
            prompt: "Use my materials if helpful.",
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
        });

        const suggestedInstruction = "The user request may benefit from Memory from notes (search_memory). Use the listed tool or tools if helpful and available.";
        expect(modelInputs).toEqual([{
            input: `User input:\nUse my materials if helpful.\n\n<runtime_instruction>\n${suggestedInstruction}\n</runtime_instruction>`,
            tool_definitions: expect.any(String),
            tool_observations: "None",
        }]);
        expectToolDefinitionNames(modelInputs[0], CORE_TOOL_NAMES);
    });

    it("uses a dedicated policy model without sending hidden host context to classification", async () => {
        const plugin = createPlugin({
            settings: {
                policyModelName: "qwen-policy-lite",
            },
        });
        const policyInputs: unknown[] = [];
        const policyModel = {
            invoke: jest.fn(async (input: unknown) => {
                policyInputs.push(input);
                return {
                    content: JSON.stringify({
                        items: [{
                            capability: "search_memory",
                            confidence: 0.61,
                            reason: "notes may help",
                        }],
                    }),
                };
            }),
        };
        const answerInputs: Record<string, string>[] = [];
        const answerStream = createStreamModel([{ content: "Policy classified request." }], (input) => {
            answerInputs.push(input);
        });
        const { runtime, createChatModel } = createRuntimeWithModels(
            plugin,
            [policyModel, answerStream],
            [],
            {
                skillContextProvider: new SkillContextProvider([{
                    path: "skills/pa-vault-link-health/SKILL.md",
                    content: [
                        "---",
                        "name: pa-vault-link-health",
                        "description: Use when checking unresolved wikilinks, backlinks, embeds, and vault link health.",
                        "---",
                        "CLASSIFIER_SHOULD_NOT_READ hidden host guide body.",
                    ].join("\n"),
                }]),
            },
        );

        await runtime.streamTurn({
            prompt: "Check unresolved wikilinks and backlinks in this vault.",
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
        });

        expect(createChatModel.mock.calls[0]).toEqual([0, {
            transport: "obsidian",
            modelName: "qwen-policy-lite",
        }]);
        expect(createChatModel.mock.calls[1]?.[1]).toEqual({
            transport: "native",
            qwenRequestOptions: undefined,
        });
        expect(policyInputs).toEqual([{ input: "Check unresolved wikilinks and backlinks in this vault." }]);
        expect(JSON.stringify(policyInputs)).not.toContain("CLASSIFIER_SHOULD_NOT_READ");
        expect(answerInputs[0]?.input).toContain("CLASSIFIER_SHOULD_NOT_READ");
        expect(answerInputs[0]?.input).toContain("The user request may benefit from Memory from notes (search_memory).");
    });

    it("executes multiple streamed tool calls before resuming the answer", async () => {
        const currentView = createMarkdownView({
            path: "current.md",
            value: "# Current\nSelected project context",
        });
        const plugin = createPlugin({
            activeMarkdownView: currentView,
            searchSimilarity: async () => [{
                score: 0.93,
                doc: {
                    pageContent: "Roadmap memory context.",
                    metadata: { path: "memory/roadmap.md", chunkIndex: 0 },
                },
            }],
            fileContents: {
                "memory/roadmap.md": "Roadmap memory context.",
            },
        });
        const toolStream = createStreamModel(multiToolCallPartialJsonFixture);
        const answerStream = createStreamModel([{ content: "Roadmap and current-note context are available." }]);
        const executeSpy = jest.spyOn(CapabilityRegistry.prototype, "execute");
        const runtime = createRuntime(plugin, [toolStream, answerStream]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Use roadmap memory and current note.",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(executeSpy.mock.calls.map((call) => call[0])).toEqual([
            "search_memory",
            "get_current_note_context",
        ]);
        expect(events.filter((event) => event.kind === "segment-boundary").map((event) => event.boundary.reason)).toEqual([
            "tool-call-started",
            "tool-call-finished",
        ]);
        expect(events.filter((event) => event.kind === "answer-snapshot").map((event) => event.snapshot)).toEqual([
            "Roadmap and current-note context are available.",
        ]);
    });

    it("limits current-note-only prompts to the current-note tool definition", async () => {
        const buriedToken = `# Current\n${"filler ".repeat(600)}\npa-positive-snippet-token-1701`;
        const currentView = createMarkdownView({
            path: "current.md",
            value: buriedToken,
        });
        const plugin = createPlugin({ activeMarkdownView: currentView });
        const modelInputs: Record<string, string>[] = [];
        const answerInputs: Record<string, string>[] = [];
        const toolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_current",
                index: 0,
                name: "get_current_note_context",
                args: "{\"mode\":\"selection-or-nearby\"}",
            }],
        }], (input) => {
            modelInputs.push(input);
        });
        const answerStream = createStreamModel([{ content: "pa-positive-snippet-token-1701" }], (input) => {
            answerInputs.push(input);
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream]);

        await runtime.streamTurn({
            prompt: "Use the current note only. Find the token whose prefix is pa-positive-snippet-token. Do not use web search.",
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
        });

        expectToolDefinitionNames(modelInputs[0], ["get_current_note_context"]);
        expect((toolStream.bindTools as jest.Mock).mock.calls[0]?.[0]).toEqual([
            expect.objectContaining({
                function: expect.objectContaining({ name: "get_current_note_context" }),
            }),
        ]);
        const toolObservation = JSON.parse(answerInputs[0]?.tool_observations ?? "{}") as { observation?: string };
        const currentNoteObservation = JSON.parse(toolObservation.observation ?? "{}") as {
            observation?: { mode?: string; fullText?: string };
        };
        expect(currentNoteObservation.observation).toMatchObject({ mode: "full" });
        expect(currentNoteObservation.observation?.fullText).toContain("pa-positive-snippet-token-1701");
    });

    it("rejects rogue non-current-note tool calls in current-note-only turns", async () => {
        const currentView = createMarkdownView({
            path: "current.md",
            value: "# Current\npa-positive-snippet-token-1701",
        });
        const plugin = createPlugin({ activeMarkdownView: currentView });
        const toolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [
                {
                    id: "call_current",
                    index: 0,
                    name: "get_current_note_context",
                    args: "{\"mode\":\"selection-or-nearby\"}",
                },
                {
                    id: "call_rogue",
                    index: 1,
                    name: "inspect_obsidian_note",
                    args: "{}",
                },
            ],
        }]);
        const answerStream = createStreamModel([{ content: "pa-positive-snippet-token-1701" }]);
        const executeSpy = jest.spyOn(CapabilityRegistry.prototype, "execute");
        const runtime = createRuntime(plugin, [toolStream, answerStream]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Use the current note only. Find the token whose prefix is pa-positive-snippet-token. Do not use web search.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(executeSpy.mock.calls.map((call) => call[0])).toEqual(["get_current_note_context"]);
        expect(canonicalEvents).toContainEqual(expect.objectContaining({
            type: "tool_execution_end",
            toolName: "inspect_obsidian_note",
            outcome: "policy_rejected",
        }));
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed",
        });
    });

    it("nudges duplicate current-note tool calls into a final answer from gathered context", async () => {
        const currentView = createMarkdownView({
            path: "current.md",
            value: `# Current\n${"filler ".repeat(600)}\npa-positive-snippet-token-1701`,
        });
        const plugin = createPlugin({ activeMarkdownView: currentView });
        const firstToolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_current_1",
                index: 0,
                name: "get_current_note_context",
                args: "{\"mode\":\"selection-or-nearby\"}",
            }],
        }]);
        const duplicateToolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_current_2",
                index: 0,
                name: "get_current_note_context",
                args: "{\"mode\":\"selection-or-nearby\"}",
            }],
        }]);
        const finalInputs: Record<string, string>[] = [];
        const answerStream = createStreamModel([{ content: "pa-positive-snippet-token-1701" }], (input) => {
            finalInputs.push(input);
        });
        const runtime = createRuntime(plugin, [firstToolStream, duplicateToolStream, answerStream]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Use the current note only. Find the token whose prefix is pa-positive-snippet-token. Reply with the full token only. Do not use web search.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        const currentNoteToolOutcomes = canonicalEvents.flatMap((event) => {
            if (event.type !== "tool_execution_end" || event.toolName !== "get_current_note_context") return [];
            return [event.outcome];
        });
        expect(currentNoteToolOutcomes).toEqual(["success", "duplicate_skipped"]);
        expect(finalInputs[0]?.input).toContain("This is a finalization turn. Do not call tools.");
        expect(finalInputs[0]?.tool_definitions).toBe("No tools are available in this finalization turn.");
        expect(finalInputs[0]?.tool_observations).toContain("pa-positive-snippet-token-1701");
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed",
        });
    });

    it("falls back to non-streaming when the stream fails before visible output", async () => {
        const plugin = createPlugin();
        const failingStream = createFailingStreamModel(new Error("stream setup failed"));
        const fallbackModel = createInvokeModel("Fallback answer.");
        const runtime = createRuntime(plugin, [failingStream, fallbackModel]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "hello",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(fallbackModel.invoke).toHaveBeenCalledTimes(1);
        expect(events.filter((event) => event.kind === "answer-snapshot").map((event) => event.snapshot)).toEqual([
            "Fallback answer.",
        ]);
        expect(events.at(-1)).toMatchObject({ kind: "answer-complete" });
    });

    it("gracefully closes when the stream fails after visible output", async () => {
        const plugin = createPlugin();
        const partialThenFail = createFailingStreamModel(new Error("late stream failure"), [{ content: "Partial" }]);
        const runtime = createRuntime(plugin, [partialThenFail]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "hello",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(events.filter((event) => event.kind === "answer-snapshot").map((event) => event.snapshot)).toEqual([
            "Partial",
        ]);
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "partial-output-error", category: "Error" }),
            expect.objectContaining({ kind: "answer-complete" }),
        ]));
    });

    it("emits aborted when the model stream is cancelled", async () => {
        const controller = new AbortController();
        const plugin = createPlugin();
        const abortingStream = createAbortingStreamModel(controller);
        const runtime = createRuntime(plugin, [abortingStream]);
        const events: AgentEvent[] = [];

        await expect(runtime.streamTurn({
            prompt: "hello",
            memoryMode: "auto",
            signal: controller.signal,
            onEvent: (event) => events.push(event),
        })).rejects.toMatchObject({ name: "AbortError" });

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "aborted" }),
        ]));
    });

    it("emits aborted when tool execution is cancelled", async () => {
        const controller = new AbortController();
        const plugin = createPlugin({
            ensureReadyForChat: async () => {
                controller.abort();
                return { decision: "use-memory" };
            },
        });
        const runtime = createRuntime(plugin, [createStreamModel(singleToolCallFixture)]);
        const events: AgentEvent[] = [];

        await expect(runtime.streamTurn({
            prompt: "What do my launch notes say?",
            memoryMode: "auto",
            signal: controller.signal,
            onEvent: (event) => events.push(event),
        })).rejects.toMatchObject({ name: "AbortError" });

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "aborted" }),
        ]));
    });

    it("allows the answer-stream loop to call an injected WebSearch capability", async () => {
        const plugin = createPlugin();
        const webSearchProvider = new BuiltinWebSearchProvider({
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
        });
        const toolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_web_1",
                index: 0,
                name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                args: "{\"query\":\"latest docs\",\"limit\":1}",
            }],
        }]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "External result found." }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for latest docs.",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(webSearchProvider.inflightRequests.size).toBe(0);
        expect(events.find((event) => event.kind === "turn-metadata")).toMatchObject({
            kind: "turn-metadata",
            metadata: {
                sourceRecords: [expect.objectContaining({
                    kind: "web-source",
                    capabilityName: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    url: "https://example.com/result?api_key=REDACTED",
                })],
            },
        });
        expect(answerInput?.tool_observations).toContain("untrusted_web_results");
        expect(answerInput?.tool_observations).toContain("External context");
        expect(answerInput?.tool_observations).toContain("api_key=REDACTED");
    });

    it("reassembles unkeyed streaming WebSearch argument chunks before executing the builtin tool", async () => {
        const plugin = createPlugin();
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
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        });
        const toolStream = createStreamModel([
            {
                content: "",
                tool_call_chunks: [{
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: "",
                }],
            },
            {
                content: "",
                tool_call_chunks: [{
                    args: "{\"search_query\":\"official Obsidian homepage domain\",",
                }],
            },
            {
                content: "",
                tool_call_chunks: [{
                    args: "\"max_results\":1}",
                }],
            },
        ]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "obsidian.md" }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for the official Obsidian homepage domain.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: "official Obsidian homepage domain",
                limit: 1,
            },
        }), expect.any(Object));
        expect(canonicalEvents.find((event) =>
            event.type === "message_end"
            && event.message.role === "toolResult"
            && event.message.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME)).toMatchObject({
            type: "message_end",
            message: {
                isError: false,
                content: {
                    promptText: expect.stringContaining("Obsidian official homepage."),
                    contextUsed: [expect.objectContaining({
                        category: "read-only-tool",
                        label: "WebSearch",
                    })],
                },
            },
        });
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed",
        });
        expect(answerInput?.tool_observations).toContain("Obsidian official homepage.");
        expect(answerInput?.tool_observations).not.toContain("Invalid WebSearch input");
    });

    it("does not let empty accumulated tool_calls override later WebSearch argument chunks", async () => {
        const plugin = createPlugin();
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
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        });
        const toolStream = createStreamModel([
            {
                content: "",
                tool_calls: [{
                    index: 0,
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
                tool_call_chunks: [{
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: "",
                }],
            },
            {
                content: "",
                tool_calls: [{
                    index: 0,
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
                tool_call_chunks: [{
                    args: "{\"search_query\":\"official Obsidian homepage domain\",",
                }],
            },
            {
                content: "",
                tool_call_chunks: [{
                    args: "\"max_results\":1}",
                }],
            },
        ]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "obsidian.md" }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for the official Obsidian homepage domain.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: "official Obsidian homepage domain",
                limit: 1,
            },
        }), expect.any(Object));
        expect(canonicalEvents.find((event) =>
            event.type === "message_end"
            && event.message.role === "toolResult"
            && event.message.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME)).toMatchObject({
            type: "message_end",
            message: {
                isError: false,
                content: {
                    promptText: expect.stringContaining("Obsidian official homepage."),
                    contextUsed: [expect.objectContaining({
                        category: "read-only-tool",
                        label: "WebSearch",
                    })],
                },
            },
        });
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed",
        });
        expect(answerInput?.tool_observations).toContain("Obsidian official homepage.");
        expect(answerInput?.tool_observations).not.toContain("Invalid WebSearch input");
    });

    it("merges unkeyed WebSearch tool_calls and tool_call_chunks into one streamed tool call", async () => {
        const plugin = createPlugin();
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
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        });
        const toolStream = createStreamModel([
            {
                content: "",
                tool_calls: [{
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
                tool_call_chunks: [{
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: "",
                }],
            },
            {
                content: "",
                tool_calls: [{
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
                tool_call_chunks: [{
                    args: "{\"search_query\":\"official Obsidian homepage domain\",",
                }],
            },
            {
                content: "",
                tool_call_chunks: [{
                    args: "\"max_results\":1}",
                }],
            },
        ]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "obsidian.md" }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for the official Obsidian homepage domain.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: "official Obsidian homepage domain",
                limit: 1,
            },
        }), expect.any(Object));
        expect(canonicalEvents.filter((event) =>
            event.type === "message_end"
            && event.message.role === "toolResult"
            && event.message.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME)).toHaveLength(1);
        expect(canonicalEvents.find((event) =>
            event.type === "message_end"
            && event.message.role === "toolResult"
            && event.message.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME)).toMatchObject({
            type: "message_end",
            message: {
                isError: false,
                content: {
                    promptText: expect.stringContaining("Obsidian official homepage."),
                    contextUsed: [expect.objectContaining({
                        category: "read-only-tool",
                        label: "WebSearch",
                    })],
                },
            },
        });
        expect(canonicalEvents.at(-1)).toMatchObject({
            type: "agent_end",
            status: "completed",
        });
        expect(answerInput?.tool_observations).toContain("Obsidian official homepage.");
        expect(answerInput?.tool_observations).not.toContain("Invalid WebSearch input");
    });

    it("prefers complete WebSearch argument chunks over placeholder structured tool input", async () => {
        const plugin = createPlugin();
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
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        });
        const toolStream = createStreamModel([
            {
                content: "",
                tool_calls: [{
                    index: 0,
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: { query: "" },
                }],
                tool_call_chunks: [{
                    index: 0,
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: "",
                }],
            },
            {
                content: "",
                tool_calls: [{
                    index: 0,
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: { query: "" },
                }],
                tool_call_chunks: [{
                    index: 0,
                    args: "{\"search_query\":\"official Obsidian homepage domain\",",
                }],
            },
            {
                content: "",
                tool_call_chunks: [{
                    index: 0,
                    args: "\"max_results\":1}",
                }],
            },
        ]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "obsidian.md" }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);

        await runtime.streamTurn({
            prompt: "Search the web for the official Obsidian homepage domain.",
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: "official Obsidian homepage domain",
                limit: 1,
            },
        }), expect.any(Object));
        expect(answerInput?.tool_observations).toContain("Obsidian official homepage.");
        expect(answerInput?.tool_observations).not.toContain("Invalid WebSearch input");
    });

    it("merges same-name placeholder WebSearch entries when provider ids churn before argument chunks", async () => {
        const plugin = createPlugin();
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
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        });
        const toolStream = createStreamModel([
            {
                content: "",
                tool_calls: [{
                    id: "call_web_placeholder_a",
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
            },
            {
                content: "",
                tool_calls: [{
                    id: "call_web_placeholder_b",
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
                tool_call_chunks: [{
                    args: "{\"search_query\":\"official Obsidian homepage domain\",",
                }],
            },
            {
                content: "",
                tool_call_chunks: [{
                    args: "\"max_results\":1}",
                }],
            },
        ]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "obsidian.md" }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);

        await runtime.streamTurn({
            prompt: "Search the web for the official Obsidian homepage domain.",
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: "official Obsidian homepage domain",
                limit: 1,
            },
        }), expect.any(Object));
        expect(answerInput?.tool_observations).toContain("Obsidian official homepage.");
        expect(answerInput?.tool_observations).not.toContain("Invalid WebSearch input");
    });

    it("skips stale WebSearch placeholders when provider id churn creates a later complete call", async () => {
        const plugin = createPlugin();
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
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        });
        const toolStream = createStreamModel([
            {
                content: "",
                tool_calls: [{
                    id: "call_web_placeholder_a",
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
            },
            {
                content: "",
                tool_calls: [{
                    id: "call_web_placeholder_b",
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: { query: "" },
                }],
                tool_call_chunks: [{
                    id: "call_web_placeholder_b",
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: "{\"search_query\":\"official Obsidian homepage domain\",",
                }],
            },
            {
                content: "",
                tool_call_chunks: [{
                    id: "call_web_placeholder_b",
                    args: "\"max_results\":1}",
                }],
            },
        ]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "obsidian.md" }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for the official Obsidian homepage domain.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: "official Obsidian homepage domain",
                limit: 1,
            },
        }), expect.any(Object));
        const webToolResults = canonicalEvents.flatMap((event) => {
            if (
                event.type !== "message_end"
                || event.message.role !== "toolResult"
                || event.message.toolName !== BUILTIN_WEB_SEARCH_TOOL_NAME
            ) {
                return [];
            }
            return [event.message];
        });
        expect(webToolResults.map((message) => message.content.metadata?.outcome)).toEqual([
            "duplicate_skipped",
            "success",
        ]);
        expect(answerInput?.tool_observations).toContain("Obsidian official homepage.");
        expect(answerInput?.tool_observations).not.toContain("Invalid WebSearch input");
        expect(answerInput?.tool_observations).not.toContain("Skipped placeholder tool call");
    });

    it("uses the user prompt as builtin WebSearch query when streamed tool arguments stay empty", async () => {
        const plugin = createPlugin();
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
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request,
        });
        const toolStream = createStreamModel([
            {
                content: "",
                tool_calls: [{
                    id: "call_web_empty_a",
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: {},
                }],
            },
            {
                content: "",
                tool_calls: [{
                    id: "call_web_empty_b",
                    name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                    args: { query: "" },
                }],
            },
        ]);
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "obsidian.md" }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [toolStream, answerStream], [webSearchProvider]);
        const prompt = "Use web search to verify the official Obsidian homepage domain.";

        await runtime.streamTurn({
            prompt,
            memoryMode: "auto",
            onLifecycleEvent: jest.fn(),
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            body: {
                query: prompt,
                limit: 5,
            },
        }), expect.any(Object));
        expect(answerInput?.tool_observations).toContain("Obsidian official homepage.");
        expect(answerInput?.tool_observations).not.toContain("Invalid WebSearch input");
    });

    it("keeps builtin WebSearch available after a recoverable WebSearch tool failure", async () => {
        const plugin = createPlugin();
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request: jest.fn(async () => ({ status: 500, body: { error: "upstream failed" } })),
        });
        const toolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_web_1",
                index: 0,
                name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                args: "{\"query\":\"latest docs\",\"limit\":1}",
            }],
        }]);
        const answerStream = createStreamModel([{ content: "Answering from available context." }]);
        const { runtime, createChatModel } = createRuntimeWithModels(plugin, [toolStream, answerStream], [webSearchProvider]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for latest docs.",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(createChatModel.mock.calls[0]?.[1]).toEqual({
            transport: "native",
            qwenRequestOptions: undefined,
        });
        expect(createChatModel.mock.calls[1]?.[1]).toEqual({
            transport: "native",
            qwenRequestOptions: undefined,
        });
        const bindToolsCalls = answerStream.bindTools.mock.calls as unknown as Array<[Array<{ function: { name: string } }>]>;
        const lastBoundSchemas = bindToolsCalls.at(-1)?.[0] ?? [];
        expect(lastBoundSchemas.map((schema) => schema.function.name)).toContain(BUILTIN_WEB_SEARCH_TOOL_NAME);
        expect(events.find((event) => event.kind === "turn-metadata")).toMatchObject({
            kind: "turn-metadata",
            metadata: {
                sourceRecords: [],
            },
        });
    });

    it("does not burn turns retrying WebSearch after a required WebSearch failure", async () => {
        const plugin = createPlugin();
        const webSearchProvider = new BuiltinWebSearchProvider({
            policy: createWebSearchPolicy(),
            apiKey: "sk-SECRET_TOKEN_SENTINEL",
            request: jest.fn(async () => ({ status: 500, body: { error: "upstream failed" } })),
        });
        const toolStream = createStreamModel([{
            content: "",
            tool_call_chunks: [{
                id: "call_web_1",
                index: 0,
                name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                args: "{\"query\":\"latest docs\",\"limit\":1}",
            }],
        }]);
        const finalInputs: Record<string, string>[] = [];
        const answerStream = createStreamModel(
            [{ content: "I cannot verify the latest docs from available context." }],
            (input) => finalInputs.push(input),
        );
        const { runtime, createChatModel } = createRuntimeWithModels(plugin, [toolStream, answerStream], [webSearchProvider], {
            maxModelTurns: 4,
        });
        const canonicalEvents: CanonicalAgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Search the web for latest docs.",
            memoryMode: "auto",
            onLifecycleEvent: (event) => canonicalEvents.push(event),
        });

        expect(createChatModel).toHaveBeenCalledTimes(2);
        expect(canonicalEvents.filter((event) => event.type === "turn_start")).toHaveLength(2);
        expect(canonicalEvents.find((event) =>
            event.type === "turn_start" && event.metadata?.turnIndex === 1,
        )).toMatchObject({
            metadata: {
                runtimeInstruction: expect.stringContaining("This is a finalization turn. Do not call tools."),
                toolMode: "final_answer_only",
            },
        });
        expect(finalInputs[0]?.tool_definitions).toBe("No tools are available in this finalization turn.");
        expect(canonicalEvents.find((event) =>
            event.type === "message_end"
            && event.message.role === "toolResult"
            && event.message.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME,
        )).toMatchObject({
            message: {
                content: {
                    promptText: expect.stringContaining("WebSearch request failed (HTTP 500"),
                },
            },
        });
    });

    it("filters injected desktop-only capabilities with the runtime platform", async () => {
        const plugin = createPlugin();
        const final = createStreamModel([{ content: "Mobile answer without WebSearch." }]);
        const provider = createDesktopOnlyWebSearchProvider();
        const runtime = createRuntime(plugin, [final], [provider], { runtimePlatform: "mobile" });

        await runtime.streamTurn({
            prompt: "Search the web from mobile.",
            memoryMode: "auto",
        });

        expect(provider.load).toHaveBeenCalledWith(expect.objectContaining({ platform: "mobile" }));
        const bindToolsCalls = final.bindTools.mock.calls as unknown as Array<[Array<{ function: { name: string } }>]>;
        const boundToolNames = (bindToolsCalls.at(-1)?.[0] ?? []).map((schema) => schema.function.name);
        expect(boundToolNames).not.toContain(BUILTIN_WEB_SEARCH_TOOL_NAME);
    });

    it("injects bundled skill context into the PA answer-stream prompt and metadata", async () => {
        const plugin = createPlugin();
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "Link health context available." }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [answerStream]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Find unresolved wikilinks and orphan notes in this vault.",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(answerInput?.input).toContain('<skill_guide name="pa-vault-link-health">');
        expect(events.find((event) => event.kind === "turn-metadata")).toMatchObject({
            kind: "turn-metadata",
            metadata: {
                contextUsed: [expect.objectContaining({
                    category: "skill-guide",
                    label: "pa-vault-link-health",
                    citationEligible: false,
                })],
                sourceRecords: [expect.objectContaining({
                    kind: "skill-guide",
                    capabilityName: "skill-context",
                })],
            },
        });
    });

    it("does not select skill context when skill guides are disabled", async () => {
        const plugin = createPlugin({
            settings: {
                skillContextEnabled: false,
            },
        });
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "Plain answer." }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [answerStream]);
        const events: AgentEvent[] = [];

        await runtime.streamTurn({
            prompt: "Find unresolved wikilinks and orphan notes in this vault.",
            memoryMode: "auto",
            onEvent: (event) => events.push(event),
        });

        expect(answerInput?.input).not.toContain("<skill_guide");
        expect(events.find((event) => event.kind === "turn-metadata")).toMatchObject({
            kind: "turn-metadata",
            metadata: {
                sourceRecords: [],
            },
        });
    });

    it("does not select a disabled bundled skill", async () => {
        const plugin = createPlugin({
            settings: {
                enabledSkillIds: ["obsidian-markdown"],
            },
        });
        let answerInput: Record<string, string> | undefined;
        const answerStream = createStreamModel([{ content: "Plain answer." }], (input) => {
            answerInput = input;
        });
        const runtime = createRuntime(plugin, [answerStream]);

        await runtime.streamTurn({
            prompt: "Find unresolved wikilinks and orphan notes in this vault.",
            memoryMode: "auto",
        });

        expect(answerInput?.input).not.toContain('<skill_guide name="pa-vault-link-health">');
    });
});

function createRuntime(
    plugin: ReturnType<typeof createPlugin>,
    models: unknown[],
    additionalCapabilityProviders: CapabilityProvider[] = [],
    runtimeOptions: Partial<ChatAgentRuntimeOptions> = {},
): ChatAgentRuntime {
    return createRuntimeWithModels(plugin, models, additionalCapabilityProviders, runtimeOptions).runtime;
}

function createRuntimeWithModels(
    plugin: ReturnType<typeof createPlugin>,
    models: unknown[],
    additionalCapabilityProviders: CapabilityProvider[] = [],
    runtimeOptions: Partial<ChatAgentRuntimeOptions> = {},
): {
    runtime: ChatAgentRuntime;
    createChatModel: jest.Mock;
} {
    const createChatModel = jest.fn(async () => {
        const model = models.shift();
        if (!model) throw new Error("No test model queued.");
        return model;
    });
    return {
        runtime: new ChatAgentRuntime(
            plugin as unknown as ConstructorParameters<typeof ChatAgentRuntime>[0],
            {
                createChatModel,
                getNativeToolCallingCapability: jest.fn(),
            } as never,
            {
                paAgentAnswerStreamEnabled: true,
                maxModelTurns: 4,
                additionalCapabilityProviders,
                ...runtimeOptions,
            },
        ),
        createChatModel,
    };
}

function createDesktopOnlyWebSearchProvider(): CapabilityProvider {
    const inputSchema = {
        type: "object" as const,
        properties: {
            query: { type: "string" as const },
        },
        required: ["query"],
        additionalProperties: false,
    };
    const capability: AgentCapability = {
        name: BUILTIN_WEB_SEARCH_TOOL_NAME,
        description: "Desktop-only test WebSearch capability.",
        inputSchema,
        plannerGuidance: [],
        kind: "tool",
        origin: "builtin-mcp",
        providerId: "desktop-only-test-websearch",
        permission: "network-read",
        sourceBoundary: "web",
        cost: "network-calls",
        platform: "desktop",
        outputBudgetChars: 1024,
        timeoutMs: 1000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Searching the web",
        sourceRecordKind: "web-source",
        toProviderSchema: () => ({
            type: "function",
            function: {
                name: BUILTIN_WEB_SEARCH_TOOL_NAME,
                description: "Desktop-only test WebSearch capability.",
                parameters: inputSchema,
            },
        }),
        toRegistryDefinition: () => ({
            name: BUILTIN_WEB_SEARCH_TOOL_NAME,
            description: "Desktop-only test WebSearch capability.",
            inputSchema,
            plannerGuidance: [],
            permission: "network-read",
            cost: "network-calls",
            outputBudgetChars: 1024,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            statusMessage: "Searching the web",
            sourceBoundary: "web",
        }),
        execute: jest.fn(async () => ({
            status: "ok" as const,
            observation: { results: [] },
            sourceRecords: [],
            inputSummary: "query",
            sources: [],
        })),
    };
    return {
        id: "desktop-only-test-provider",
        displayName: "Desktop-only test provider",
        required: false,
        kind: "tool-provider",
        platform: "both",
        load: jest.fn(async () => ({
            status: "available" as const,
            capabilities: [capability],
        })),
    };
}

function createStreamModel(
    chunksOrFixture: Array<{ content: string; tool_calls?: unknown[]; tool_call_chunks?: unknown[] }> | RecordedLlmStreamFixture,
    onInput?: (input: Record<string, string>) => void,
) {
    const model = {
        bindTools: jest.fn(() => model),
        stream: jest.fn(async function* (input: Record<string, string>, options?: { signal?: AbortSignal }) {
            onInput?.(input);
            if (Array.isArray(chunksOrFixture)) {
                for (const chunk of chunksOrFixture) {
                    if (options?.signal?.aborted) throw createAbortError();
                    yield chunk;
                }
                return;
            }
            for await (const chunk of replayAiMessageStream(chunksOrFixture, { signal: options?.signal })) {
                yield chunk;
            }
        }),
        invoke: jest.fn(async () => ({ content: "fallback answer" })),
    };
    return model;
}

function createInvokeModel(content: string) {
    return {
        invoke: jest.fn(async () => ({ content })),
    };
}

const CORE_TOOL_NAMES = [
    "search_memory",
    "get_current_note_context",
    "search_vault_metadata",
    "list_recent_notes",
    "read_note_outline",
    "inspect_obsidian_note",
    "read_canvas_summary",
    "search_vault_snippets",
    "list_vault_tags",
];

function expectToolDefinitionNames(input: Record<string, string> | undefined, expectedNames: string[]) {
    expect(input).toBeDefined();
    const names = input?.tool_definitions
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { name: string })
        .map((definition) => definition.name);
    expect(names).toEqual(expectedNames);
}

function finalAnswerPromptTemplates(fromMessages: jest.Mock): string[] {
    return fromMessages.mock.calls
        .map((call) => {
            const messages = call[0] as Array<{ template?: string }> | undefined;
            return messages?.[0]?.template;
        })
        .filter((template): template is string =>
            typeof template === "string" && template.includes("PA Agent answer-stream loop"));
}

function createFailingStreamModel(error: Error, chunks: Array<{ content: string }> = []) {
    return {
        bindTools: jest.fn(function (this: unknown) {
            return this;
        }),
        stream: jest.fn(async function* () {
            for (const chunk of chunks) {
                yield chunk;
            }
            throw error;
        }),
    };
}

function createAbortingStreamModel(controller: AbortController) {
    return {
        bindTools: jest.fn(function (this: unknown) {
            return this;
        }),
        stream: jest.fn(async function* () {
            controller.abort();
            throw createAbortError();
        }),
    };
}

function createPlugin(overrides: {
    searchSimilarity?: (query: string) => Promise<unknown[]>;
    ensureReadyForChat?: () => Promise<{ decision: "use-memory" | "answer-now" | "cancel"; message?: string }>;
    fileContents?: Record<string, string>;
    activeMarkdownView?: unknown;
    settings?: Record<string, unknown>;
} = {}) {
    const fileContents = overrides.fileContents ?? {};
    return {
        settings: {
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: true,
            ...overrides.settings,
        },
        app: {
            workspace: {
                getActiveViewOfType: jest.fn(() => overrides.activeMarkdownView ?? null),
                getMostRecentLeaf: jest.fn(() => null),
                getLeavesOfType: jest.fn(() => []),
            },
            vault: {
                getAbstractFileByPath: jest.fn((path: string) => path in fileContents
                    ? { path, basename: path.split("/").pop()?.replace(/\.md$/, "") ?? path }
                    : null),
                cachedRead: jest.fn(async (file: { path: string }) => fileContents[file.path] ?? ""),
            },
            metadataCache: {
                getFileCache: jest.fn(() => null),
            },
        },
        vss: {
            searchSimilarity: jest.fn(overrides.searchSimilarity ?? (async () => [])),
        },
        memoryManager: {
            ensureReadyForChat: jest.fn(overrides.ensureReadyForChat ?? (async () => ({ decision: "use-memory" }))),
        },
        log: jest.fn(),
    };
}

function createMarkdownView(overrides: {
    path: string;
    value: string;
}) {
    const lines = overrides.value.split(/\r?\n/);
    return {
        file: {
            path: overrides.path,
            basename: overrides.path.replace(/\.md$/, ""),
        },
        editor: {
            getSelection: jest.fn(() => ""),
            getValue: jest.fn(() => overrides.value),
            getCursor: jest.fn(() => ({ line: 0, ch: 0 })),
            lineCount: jest.fn(() => lines.length),
            getLine: jest.fn((line: number) => lines[line] ?? ""),
        },
        getViewType: jest.fn(() => "markdown"),
    };
}

function createAbortError(): Error {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
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
