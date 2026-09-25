import type { ChatToolContext, ChatToolDefinition, ChatToolResult } from "./chat-tool-types";
import type { SavedInsightQuery } from "../pa/insight-read-port";
import { buildMemoryManagementEvidence, MEMORY_MANAGEMENT_CONTRACT_VERSION } from "./memory-management-evidence";
import { assertTaskSourceNoteDomainCurrent } from './task-source-read-guard';

type InsightToolName = "get_vault_insights" | "query_saved_insights";

function objectInput(input: unknown, tool: InsightToolName): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${tool} input must be an object.`);
    return input as Record<string, unknown>;
}

function queryInput(input: unknown): SavedInsightQuery {
    const value = objectInput(input, "query_saved_insights");
    if (Object.keys(value).some(key => !["text", "itemId", "status", "limit"].includes(key))) {
        throw new Error("query_saved_insights contains unknown fields.");
    }
    for (const key of ["text", "itemId"] as const) {
        if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 160)) {
            throw new Error(`query_saved_insights ${key} is invalid.`);
        }
    }
    if (value.status !== undefined && !["active", "archived", "promoted"].includes(value.status as string)) {
        throw new Error("query_saved_insights status is invalid.");
    }
    if (value.limit !== undefined && (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 10)) {
        throw new Error("query_saved_insights limit is invalid.");
    }
    return {
        ...(value.text ? { text: value.text as string } : {}),
        ...(value.itemId ? { itemId: value.itemId as string } : {}),
        ...(value.status ? { status: value.status as SavedInsightQuery["status"] } : {}),
        limit: (value.limit as number | undefined) ?? 10,
    };
}

async function read(
    tool: InsightToolName,
    input: SavedInsightQuery | Record<string, never>,
    context: ChatToolContext,
): Promise<ChatToolResult<Record<string, unknown>>> {
    assertTaskSourceNoteDomainCurrent(context.taskSourceReadGuard);
    const port = context.host.insightRead;
    if (!port) return { ok: false, tool, inputSummary: tool, content: null, sources: [], error: "Insight records are unavailable." };
    const result = tool === "get_vault_insights" ? port.getVaultInsights()
        : port.querySavedInsights(input as SavedInsightQuery);
    assertTaskSourceNoteDomainCurrent(context.taskSourceReadGuard);
    const request = tool === "get_vault_insights" ? {} : Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]),
    );
    const evidence = buildMemoryManagementEvidence({
        tool,
        operation: tool === "get_vault_insights" ? "vault_insights" : "saved_insights",
        stateFingerprint: result.stateFingerprint,
        request,
        content: result.content,
    });
    const current = await port.prepareObservation(evidence);
    assertTaskSourceNoteDomainCurrent(context.taskSourceReadGuard);
    if (!current.ready) return { ok: false, tool, inputSummary: tool, content: null, sources: [], error: "Insight sources changed before the result was returned." };
    return {
        ok: true,
        tool,
        inputSummary: tool === "get_vault_insights" ? "existing vault insights" : JSON.stringify(input),
        content: result.content,
        sources: [],
        memoryManagementEvidence: evidence,
        memoryManagementContractVersion: MEMORY_MANAGEMENT_CONTRACT_VERSION,
    };
}

export function createInsightReadTools(): Array<ChatToolDefinition<Record<string, never> | SavedInsightQuery, Record<string, unknown>>> {
    return [{
        name: "get_vault_insights",
        description: "Read the existing saved vault observations and their coverage, without generating new insights.",
        plannerGuidance: [
            "Use for broad patterns already observed in this vault; generatedAt and coverage bound every claim.",
            "Treat themes and knowledge gaps as inferences. Use note tools to check original text before claiming a current fact.",
        ],
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        permission: "read-only", cost: "free", outputBudgetChars: 8000, requiresConfirmation: false,
        failureBehavior: "recoverable", statusMessageText: "Reading saved vault observations",
        sourceBoundary: "read-only-tool", statusMessage: () => "Reading saved vault observations",
        validateInput: input => {
            const value = objectInput(input, "get_vault_insights");
            if (Object.keys(value).length) throw new Error("get_vault_insights input must be empty.");
            return {};
        },
        execute: (input, context) => read("get_vault_insights", input as Record<string, never>, context),
    }, {
        name: "query_saved_insights",
        description: "Find existing Saved Insights by text, exact ID, or status. Reading does not save or change them.",
        plannerGuidance: [
            "Use for already saved insights, including archived entries. An ordinary discovery is not saved until the user explicitly chooses to save it.",
            "Source paths are references, not current note-text proof; use note tools when the current source matters.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", maxLength: 160 },
                itemId: { type: "string", maxLength: 160 },
                status: { type: "string", enum: ["active", "archived", "promoted"] },
                limit: { type: "integer", minimum: 1, maximum: 10 },
            },
            additionalProperties: false,
        },
        permission: "read-only", cost: "free", outputBudgetChars: 12000, requiresConfirmation: false,
        failureBehavior: "recoverable", statusMessageText: "Reading Saved Insights",
        sourceBoundary: "read-only-tool", statusMessage: () => "Reading Saved Insights",
        validateInput: queryInput,
        execute: (input, context) => read("query_saved_insights", input as SavedInsightQuery, context),
    }];
}
