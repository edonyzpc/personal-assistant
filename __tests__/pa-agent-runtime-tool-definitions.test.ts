import { describe, expect, it } from "@jest/globals";

import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import {
    createInspectObsidianNoteTool,
    createListVaultTagsTool,
    createReadCanvasSummaryTool,
    createSearchMemoryTool,
    createSearchVaultSnippetsTool,
} from "../src/ai-services/chat-tools";
import { buildObsidianOperationsPlannerGuidance } from "../src/ai-services/obsidian-operations-capability-catalog";
import {
    createPaAgentModelInputMetricsDiagnostic,
    formatPlannerToolDefinitions,
} from "../src/ai-services/pa-agent-runtime";

describe("formatPlannerToolDefinitions (#2.1)", () => {
    it("returns 'None' for empty input", () => {
        // The "None" sentinel is the contract the answer-stream prompt template depends on
        // when no tools are bound — keeping it pinned here prevents a refactor from silently
        // breaking the prompt's `{tool_definitions}` slot (which would render literal "[]" or
        // an empty string and confuse the model).
        expect(formatPlannerToolDefinitions([])).toBe("None");
    });

    it("includes only name and planner_guidance, omitting native-schema fields", () => {
        // SPEC-TCR-04: the LLM gets description / input_schema / permission / cost / etc.
        // through `bindTools(schemas)` already. Re-dumping them here costs ~1-2k tokens per
        // turn for no decision benefit. The test asserts:
        //   • name + plannerGuidance survive (planner-decision inputs)
        //   • description + permission + outputBudgetChars are stripped (covered by native
        //     tool schema or unused by the planner)
        const out = formatPlannerToolDefinitions([{
            name: "search_memory",
            description: "should be omitted",
            inputSchema: { type: "object" },
            plannerGuidance: ["Use for memory queries"],
            permission: "read-only",
            cost: 1,
            outputBudgetChars: 1000,
            requiresConfirmation: false,
            failureBehavior: "soft",
            statusMessage: "Searching memory",
            sourceBoundary: "memory",
        } as never]);
        expect(out).toContain("search_memory");
        expect(out).toContain("Use for memory queries");
        expect(out).not.toContain("should be omitted");
        expect(out).not.toContain("read-only");
        expect(out).not.toContain("output_budget_chars");
    });

    it("shares exact source guidance only across its bound tools, preserving definitions and schemas", () => {
        const registry = new CapabilityRegistry();
        const options = { providerId: "test-planner-guidance" };
        registry.register(createChatToolCapability(createInspectObsidianNoteTool(), options));
        registry.register(createChatToolCapability(createReadCanvasSummaryTool(), options));
        registry.register(createChatToolCapability(createSearchVaultSnippetsTool(), options));
        registry.register(createChatToolCapability(createListVaultTagsTool(), options));
        registry.register(createChatToolCapability(createSearchMemoryTool(async () => {
            throw new Error('This projection test must not execute retrieval');
        }), options));
        const definitions = registry.listDefinitions();
        const definitionsBefore = JSON.stringify(definitions);
        const schemasBefore = registry.exportProviderSchemas();

        const rows = formatPlannerToolDefinitions(definitions).split("\n").map((row) => JSON.parse(row));
        const shared = rows.filter((row) => row.shared_planner_guidance)
            .map((row) => row.shared_planner_guidance);
        expect(shared).toEqual([
            {
                tools: ["inspect_obsidian_note", "search_vault_snippets", "list_vault_tags"],
                planner_guidance: buildObsidianOperationsPlannerGuidance(["markdown"]),
            },
            {
                tools: ["inspect_obsidian_note", "read_canvas_summary", "search_vault_snippets", "list_vault_tags"],
                planner_guidance: buildObsidianOperationsPlannerGuidance(["safety"]),
            },
        ]);
        const toolRows = rows.filter((row) => row.name);
        for (const definition of definitions) {
            const ownGuidance = toolRows.find((row) => row.name === definition.name).planner_guidance;
            const applicableSharedGuidance = shared.filter((group) => group.tools.includes(definition.name))
                .flatMap((group) => group.planner_guidance);
            const reconstructed = [...ownGuidance, ...applicableSharedGuidance];
            expect(reconstructed.sort()).toEqual([...definition.plannerGuidance].sort());
            expect(new Set(reconstructed).size).toBe(reconstructed.length);
        }
        expect(JSON.stringify(definitions)).toBe(definitionsBefore);
        expect(registry.exportProviderSchemas()).toEqual(schemasBefore);
    });

    it("keeps single-tool and nonidentical guidance output unchanged", () => {
        const registry = new CapabilityRegistry();
        registry.register(createChatToolCapability(createInspectObsidianNoteTool(), { providerId: "test-planner-guidance" }));
        registry.register(createChatToolCapability(createSearchMemoryTool(async () => {
            throw new Error('This projection test must not execute retrieval');
        }), { providerId: "test-planner-guidance" }));
        const definitions = registry.listDefinitions();
        // Similar wording is not a shared rule; repeated text within one tool is
        // also not permission to attach that instruction to another tool.
        definitions[0].plannerGuidance = ["Read a snippet.", "Read a snippet."];
        definitions[1].plannerGuidance = ["Read a snippet. "];
        const originalFormat = (selected: typeof definitions) => selected.map((definition) => JSON.stringify({
            name: definition.name,
            planner_guidance: definition.plannerGuidance,
        })).join("\n");
        expect(formatPlannerToolDefinitions([definitions[0]])).toBe(originalFormat([definitions[0]]));
        expect(formatPlannerToolDefinitions(definitions)).toBe(originalFormat(definitions));
    });

    it("summarizes model input metrics without including prompt or schema content", () => {
        const diagnostic = createPaAgentModelInputMetricsDiagnostic({
            canonicalInput: {
                input: "User input:\nsecret prompt",
                available_skills: "secret skill catalog",
                tool_definitions: "planner definition text",
                tool_observations: "secret observation",
            },
            providerSchemaExportOk: true,
            exportedProviderSchemaCount: 2,
            boundProviderSchemas: [{
                type: "function",
                function: {
                    name: "search_memory",
                    description: "schema description should not be copied directly",
                    parameters: {
                        type: "object",
                        properties: { query: { type: "string", description: "secret schema text" } },
                        required: ["query"],
                        additionalProperties: false,
                    },
                },
            }],
            plannerToolDefinitions: [{
                name: "search_memory",
                description: "definition description should not be copied",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                    additionalProperties: false,
                },
                plannerGuidance: ["guidance should not be copied"],
                permission: "read-only",
                cost: 1,
                outputBudgetChars: 1000,
                requiresConfirmation: false,
                failureBehavior: "soft",
                statusMessage: "Searching",
                sourceBoundary: "memory",
            } as never],
        });

        expect(diagnostic).toMatchObject({
            type: "model_input_metrics",
            inputChars: "User input:\nsecret prompt".length,
            availableSkillsChars: "secret skill catalog".length,
            toolDefinitionsChars: "planner definition text".length,
            toolObservationsChars: "secret observation".length,
            providerSchemaExportOk: true,
            exportedProviderSchemaCount: 2,
            boundProviderSchemaCount: 1,
            boundProviderSchemaChars: expect.any(Number),
            boundProviderToolNames: ["search_memory"],
            plannerToolDefinitionCount: 1,
            plannerToolDefinitionNames: ["search_memory"],
        });
        expect(JSON.stringify(diagnostic)).not.toContain("secret prompt");
        expect(JSON.stringify(diagnostic)).not.toContain("secret schema text");
        expect(JSON.stringify(diagnostic)).not.toContain("guidance should not be copied");
    });
});
