import { describe, expect, it } from "@jest/globals";

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
            plannerGuidance: "Use for memory queries",
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
