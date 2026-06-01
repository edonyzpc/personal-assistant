import { describe, expect, it } from "@jest/globals";

import { formatPlannerToolDefinitions } from "../src/ai-services/pa-agent-runtime";

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
});
