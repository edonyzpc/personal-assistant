import { describe, expect, it } from "@jest/globals";
import type { AgentCapabilityContext } from "../src/ai-services/capability-types";
import type { ChatToolRegistryDefinition } from "../src/ai-services/chat-tool-types";
import type { PaAgentMessage } from "../src/ai-services/chat-types";
import {
    createLoadToolsCapability,
    formatPaAgentToolDisclosureDirectory,
    PA_AGENT_LOAD_TOOLS_TOOL_NAME,
    projectLoadToolsProviderTranscript,
    projectPaAgentToolDisclosure,
} from "../src/ai-services/pa-agent-tool-disclosure";

function definition(name: string): ChatToolRegistryDefinition {
    return {
        name: name as ChatToolRegistryDefinition["name"],
        description: `${name} description`,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        plannerGuidance: [`${name} guidance`],
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 100,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessage: name,
        sourceBoundary: "read-only-tool",
    };
}

function projection(input: {
    names: string[];
    loadedToolNames?: Set<string>;
    finalAnswerOnly?: boolean;
}) {
    const definitions = input.names.map(definition);
    return projectPaAgentToolDisclosure({
        schemas: input.names.map(name => ({
            type: "function" as const,
            function: { name, description: `${name} description`, parameters: {
                type: "object" as const, properties: {}, additionalProperties: false,
            } },
        })),
        definitions,
        predisclosedToolNames: [],
        loadedToolNames: input.loadedToolNames ?? new Set<string>(),
        loaderToolName: PA_AGENT_LOAD_TOOLS_TOOL_NAME,
        finalAnswerOnly: input.finalAnswerOnly,
    });
}

describe("PA Agent tool disclosure", () => {
    it("adds the loader only while deferred capabilities remain", () => {
        const noDeferred = projection({ names: ["read_note", "execute_code", "load_tools"] });
        expect([...noDeferred.availableNames]).toContain("load_tools");
        expect([...noDeferred.visibleNames]).toEqual(["read_note", "execute_code"]);
        expect(noDeferred.deferredNames.size).toBe(0);
        expect(noDeferred.schemas.some(item => item.function.name === PA_AGENT_LOAD_TOOLS_TOOL_NAME)).toBe(false);
        expect(noDeferred.definitions.some(item => item.name === PA_AGENT_LOAD_TOOLS_TOOL_NAME)).toBe(false);
        expect(formatPaAgentToolDisclosureDirectory(noDeferred.directory)).toBe("");

        const initial = projection({ names: ["read_note", "execute_code", "list_recent_notes", "load_tools"] });
        expect([...initial.visibleNames]).toEqual(["read_note", "execute_code", "load_tools"]);
        expect([...initial.deferredNames]).toEqual(["list_recent_notes"]);
        expect(formatPaAgentToolDisclosureDirectory(initial.directory)).toContain("list_recent_notes description");

        const loaded = projection({
            names: ["read_note", "execute_code", "list_recent_notes", "load_tools"],
            loadedToolNames: new Set(["list_recent_notes"]),
        });
        expect([...loaded.visibleNames]).toEqual(["read_note", "execute_code", "list_recent_notes"]);
        expect(loaded.deferredNames.size).toBe(0);
        expect(loaded.definitions.some(item => item.name === PA_AGENT_LOAD_TOOLS_TOOL_NAME)).toBe(false);
        expect(loaded.schemas.some(item => item.function.name === PA_AGENT_LOAD_TOOLS_TOOL_NAME)).toBe(false);
        expect(formatPaAgentToolDisclosureDirectory(loaded.directory)).toBe("");

        const finalOnly = projection({
            names: ["read_note", "execute_code", "list_recent_notes", "load_tools"],
            loadedToolNames: new Set(["list_recent_notes"]),
            finalAnswerOnly: true,
        });
        expect(finalOnly.visibleNames.size).toBe(0);
        expect(finalOnly.deferredNames.size).toBe(0);
        expect(finalOnly.definitions).toEqual([]);
        expect(finalOnly.schemas).toEqual([]);
    });

    it("does not revive a loaded capability after it leaves the allowed export set", () => {
        const result = projection({
            names: ["read_note"],
            loadedToolNames: new Set(["list_recent_notes"]),
        });
        expect(result.visibleNames.has("list_recent_notes")).toBe(false);
        expect(result.deferredNames.has("list_recent_notes")).toBe(false);
        expect(result.loadedNames.size).toBe(0);
    });

    it("loads exact first occurrences independently and idempotently", async () => {
        const loadedToolNames = new Set<string>();
        const current = projection({ names: ["read_note", "list_recent_notes", "load_tools"] });
        const capability = createLoadToolsCapability({
            loadedToolNames,
            getDisclosure: () => current,
            assertCurrent: () => undefined,
        });
        const result = await capability.execute({
            names: ["list_recent_notes", "list_recent_notes", "not_registered", "load_tools"],
        }, { userInput: "" } as unknown as AgentCapabilityContext);
        expect(result.observation).toEqual({ results: [
            { name: "list_recent_notes", status: "loaded" },
            { name: "not_registered", status: "unavailable" },
            { name: "load_tools", status: "already_loaded" },
        ] });
        expect([...loadedToolNames]).toEqual(["list_recent_notes"]);
    });

    it.each([
        undefined,
        {},
        { names: [] },
        { names: [""] },
        { names: [42] },
        { names: ["read_note"], extra: true },
    ])("rejects malformed names input %# before changing disclosure", raw => {
        const loadedToolNames = new Set<string>();
        const capability = createLoadToolsCapability({
            loadedToolNames,
            getDisclosure: () => projection({ names: ["read_note"] }),
            assertCurrent: () => undefined,
        });
        expect(capability.prepareAndValidate?.(raw, { userInput: "" })?.ok).toBe(false);
        expect(loadedToolNames.size).toBe(0);
    });

    it.each(["schema", "parse"] as const)(
        "redacts only the matching rejected loader call in provider history: %s",
        mode => {
            const sentinel = "B172_FAILED_SENTINEL";
            const secondSentinel = "B172_FAILED_SENTINEL_2";
            const priorAssistant: PaAgentMessage = {
                role: "assistant", id: "prior-assistant", timestamp: 0,
                content: [{ type: "toolCall", id: "loader-call", name: "load_tools",
                    input: { names: ["read_note"] } }],
            };
            const priorResult: PaAgentMessage = {
                role: "toolResult", id: "prior-result", toolCallId: "loader-call",
                toolName: "load_tools", isError: false, timestamp: 0,
                content: { promptText: "prior observation", includeInNextPrompt: true,
                    metadata: { outcome: "success" } },
            };
            const assistant: PaAgentMessage = {
                role: "assistant", id: "assistant", timestamp: 0,
                content: [
                    { type: "toolCall", id: "loader-call", name: "load_tools", input: mode === "schema"
                        ? { names: ["", sentinel] } : `{"names":["${sentinel}"` },
                    { type: "toolCall", id: "other-call", name: "read_note", input: { path: "keep.md" } },
                    { type: "toolCall", id: "loader-call-2", name: "load_tools", input: mode === "schema"
                        ? { names: [secondSentinel, false] } : `{"names":["${secondSentinel}"` },
                ],
            };
            const result: PaAgentMessage = {
                role: "toolResult", id: "result", toolCallId: "loader-call", toolName: "load_tools",
                isError: true, timestamp: 0,
                content: {
                    promptText: "raw correction", previewText: "raw preview", includeInNextPrompt: true,
                    metadata: {
                        outcome: "schema_invalid",
                        reason: mode === "schema" ? "input_validation_failed" : "invalid_tool_input",
                        executionState: "not_started",
                        recovery: { code: mode === "schema" ? "input_validation_failed" : "tool_input_parse_failed",
                            allowedActions: ["correct_input"] },
                    },
                },
            };
            const secondResult: PaAgentMessage = {
                role: "toolResult", id: "result-2", toolCallId: "loader-call-2",
                toolName: "load_tools", isError: true, timestamp: 0,
                content: {
                    promptText: "raw second correction", previewText: "raw second preview", includeInNextPrompt: true,
                    metadata: result.content.metadata,
                },
            };
            const transcript: PaAgentMessage[] = [priorAssistant, priorResult, assistant, result, secondResult];
            const projected = projectLoadToolsProviderTranscript(transcript,
                message => message.toolName === "load_tools");
            expect(projected[0]).toBe(priorAssistant);
            expect(projected[1]).toBe(priorResult);
            const projectedAssistant = projected[2] as typeof assistant;
            const projectedResult = projected[3] as typeof result;
            const projectedSecondResult = projected[4] as typeof result;
            expect(JSON.stringify(projectedAssistant.content[0])).not.toContain(sentinel);
            expect(JSON.stringify(projectedAssistant.content[2])).not.toContain(secondSentinel);
            expect(projectedAssistant.content[1]).toEqual(assistant.content[1]);
            expect(projectedResult.content.promptText).toContain(mode === "schema" ? "names" : "JSON");
            expect(projectedSecondResult.content.promptText).toContain(mode === "schema" ? "names" : "JSON");
            expect(projectedResult.content.metadata?.statusOnly).toBe(true);
            expect(projectedSecondResult.content.metadata?.statusOnly).toBe(true);
            expect(projectedResult.content.metadata?.parseError).toBeUndefined();
            expect(projectedSecondResult.content.metadata?.parseError).toBeUndefined();
            expect(JSON.stringify(transcript)).toContain(sentinel);
            expect(JSON.stringify(transcript)).toContain(secondSentinel);
            expect(transcript[3]).toBe(result);
            expect(transcript[4]).toBe(secondResult);
        },
    );
});
