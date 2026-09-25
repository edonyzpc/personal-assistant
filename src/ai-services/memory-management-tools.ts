import type { ChatToolContext, ChatToolDefinition, ChatToolResult } from "./chat-tool-types";
import { assertTaskSourceMemoryReadCurrent, assertTaskSourceNoteDomainCurrent } from './task-source-read-guard';
import {
    buildMemoryManagementEvidence,
    MEMORY_MANAGEMENT_CONTRACT_VERSION,
    type MemoryManagementEvidence,
} from "./memory-management-evidence";
import type {
    MemoryManagementObservation,
    MemoryManagementOperation,
    MemoryManagementQueryInput,
    MemoryManagementQueryOutput,
    MemoryManagementStatusOutput,
    MemoryManagementUnavailableOutput,
    MemoryManagementUsageOutput,
} from "./memory-management-types";

const MEMORY_MANAGEMENT_TEXT_MAX_CHARS = 160;
const MEMORY_MANAGEMENT_DEFAULT_LIMIT = 10;
const MEMORY_MANAGEMENT_MAX_LIMIT = 20;
export const MEMORY_MANAGEMENT_TOOL_NAMES = [
    "get_memory_status",
    "query_memories",
    "get_memory_usage",
] as const;

type ManagementToolName = typeof MEMORY_MANAGEMENT_TOOL_NAMES[number];

export function createMemoryManagementTools(): Array<
    ChatToolDefinition<Record<string, never>, MemoryManagementStatusOutput>
    | ChatToolDefinition<MemoryManagementQueryInput, MemoryManagementQueryOutput | MemoryManagementUnavailableOutput<"query">>
    | ChatToolDefinition<{ conversationId?: string; turnId?: string }, MemoryManagementUsageOutput | MemoryManagementUnavailableOutput<"current_run" | "history">>
> {
    return [
        createStatusTool(),
        createQueryTool(),
        createUsageTool(),
    ];
}

function createStatusTool(): ChatToolDefinition<Record<string, never>, MemoryManagementStatusOutput> {
    return {
        name: "get_memory_status",
        description: "Explain whether Memory learning and prepared note Memory are available. This never changes Memory settings.",
        plannerGuidance: [
            "Use for Memory status, coverage, or setup questions.",
            "Do not infer note content when Memory is disabled or unavailable.",
        ],
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 3000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading Memory status",
        sourceBoundary: "memory",
        statusMessage: () => "Reading Memory status",
        validateInput: input => {
            if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 0) {
                throw new Error("get_memory_status input must be an empty object.");
            }
            return {};
        },
        execute: async (input, context) => executeManagementTool("get_memory_status", "status", input, context),
    };
}

function createQueryTool(): ChatToolDefinition<MemoryManagementQueryInput, MemoryManagementQueryOutput | MemoryManagementUnavailableOutput<"query">> {
    const lifecycle = [
        "derived", "active", "archived", "paused", "forget_pending", "stale", "exported", "forgotten_marker",
    ];
    return {
        name: "query_memories",
        description: "Query permitted long-term Memory records by bounded text, exact item ID, or bounded listing.",
        plannerGuidance: [
            "Use for explicit questions about existing long-term Memory records.",
            "Results are management records, not permission to personalize future answers.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", maxLength: MEMORY_MANAGEMENT_TEXT_MAX_CHARS, description: "Bounded case-insensitive text query." },
                itemId: { type: "string", maxLength: 256, description: "Exact item ID from a previous result." },
                lifecycle: { type: "array", items: { type: "string", enum: lifecycle } },
                limit: { type: "integer", minimum: 1, maximum: MEMORY_MANAGEMENT_MAX_LIMIT },
                cursor: { type: "string", maxLength: 4096 },
            },
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 6000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading long-term Memory records",
        sourceBoundary: "memory",
        statusMessage: input => `Reading long-term Memory records: ${input.itemId ?? input.text ?? "all"}`,
        prepareArguments: raw => {
            if (typeof raw === "string") return raw.trim() ? { text: raw.trim() } : raw;
            return raw;
        },
        validateInput: validateQueryInput,
        execute: async (input, context) => executeManagementTool("query_memories", "query", input, context),
    };
}

function createUsageTool(): ChatToolDefinition<{ conversationId?: string; turnId?: string }, MemoryManagementUsageOutput | MemoryManagementUnavailableOutput<"current_run" | "history">> {
    return {
        name: "get_memory_usage",
        description: "Explain which Memory records were selected or physically included in this run or an explicit prior turn.",
        plannerGuidance: [
            "Default to the current run; query history only with an explicit conversationId and turnId.",
            "Distinguish selection records from a physical writing generation snapshot; unknown is a valid answer.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                conversationId: { type: "string", maxLength: 256 },
                turnId: { type: "string", maxLength: 256 },
            },
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 5000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading Memory usage evidence",
        sourceBoundary: "memory",
        statusMessage: input => input.conversationId
            ? `Reading Memory usage for turn ${input.turnId ?? input.conversationId}`
            : "Reading current Memory usage evidence",
        validateInput: input => {
            if (!input || typeof input !== "object" || Array.isArray(input)) {
                throw new Error("get_memory_usage input must be an object.");
            }
            const record = input as Record<string, unknown>;
            rejectUnknownKeys(record, new Set(["conversationId", "turnId"]), "get_memory_usage");
            const conversationId = optionalBoundedString(record.conversationId, "conversationId", 256);
            const turnId = optionalBoundedString(record.turnId, "turnId", 256);
            if (!conversationId && turnId) throw new Error("turnId requires conversationId.");
            if (conversationId && !turnId) throw new Error("Historical usage requires conversationId and turnId.");
            return conversationId ? { conversationId, ...(turnId ? { turnId } : {}) } : {};
        },
        execute: async (input, context) => executeManagementTool("get_memory_usage", "usage", input, context),
    };
}

async function executeManagementTool<Input, Output>(
    tool: ManagementToolName,
    operation: MemoryManagementOperation,
    input: Input,
    context: ChatToolContext,
): Promise<ChatToolResult<Output>> {
    const assertDomain = () => operation === 'status'
        ? assertTaskSourceNoteDomainCurrent(context.taskSourceReadGuard)
        : assertTaskSourceMemoryReadCurrent(context.taskSourceReadGuard);
    assertDomain();
    const port = context.host.memoryManagement;
    if (!port) return unavailableResult(tool, input, "port_missing");
    let observation: MemoryManagementObservation;
    try {
        observation = await port.prepareObservation({ operation, request: requestFor(tool, input) });
        assertDomain();
    } catch {
        return unavailableResult(tool, input, "not_ready");
    }
    if (!observation.ready) return unavailableResult(tool, input, observation.reason ?? "not_ready");
    if (operation !== "status" && !observation.memoryEnabled) {
        const content = {
            kind: operation === "query" ? "memory-query" : "memory-usage",
            available: false,
            reason: "memory_disabled",
            target: operation === "query" ? "query" : "current_run",
            memoryEnabled: false,
            contentAvailable: false,
            ...(operation === "query" ? { items: [], matchCount: 0 } : { records: [], evidenceLevel: "unknown" }),
        } as Output;
        const stateFingerprint = observation.stateFingerprint;
        if (!stateFingerprint) return unavailableResult(tool, input, "not_ready");
        return {
            ok: true,
            tool,
            inputSummary: summarize(tool, input),
            content,
            sources: [],
            memoryManagementEvidence: buildMemoryManagementEvidence({
                tool, operation, stateFingerprint, request: requestFor(tool, input), content,
            }),
            memoryManagementContractVersion: MEMORY_MANAGEMENT_CONTRACT_VERSION,
        };
    }
    try {
        assertDomain();
        let content: Output;
        if (tool === "get_memory_status") content = await port.getStatus() as Output;
        else if (tool === "query_memories") content = await port.queryMemories(input as MemoryManagementQueryInput) as Output;
        else content = await port.getUsage(input as { conversationId?: string; turnId?: string }, context.currentMemoryUsage) as Output;
        const provisional = buildMemoryManagementEvidence({
            tool,
            operation,
            stateFingerprint: observation.stateFingerprint ?? "unavailable",
            request: requestFor(tool, input),
            content,
        });
        const current = await port.prepareObservation(provisional, context.currentMemoryUsage);
        assertDomain();
        if (!current.ready) return unavailableResult(tool, input, current.reason ?? "not_ready");
        if (!current.stateFingerprint) return unavailableResult(tool, input, "not_ready");
        const evidence: MemoryManagementEvidence = buildMemoryManagementEvidence({
            tool,
            operation,
            stateFingerprint: current.stateFingerprint,
            request: requestFor(tool, input),
            content,
        });
        return {
            ok: true,
            tool,
            inputSummary: summarize(tool, input),
            content,
            sources: [],
            memoryManagementEvidence: evidence,
            memoryManagementContractVersion: MEMORY_MANAGEMENT_CONTRACT_VERSION,
        };
    } catch {
        return unavailableResult(tool, input, "not_ready");
    }
}

function requestFor(tool: ManagementToolName, input: unknown): Record<string, string> {
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (tool === "query_memories") {
        return {
            ...(typeof record.text === "string" ? { text: record.text } : {}),
            ...(typeof record.itemId === "string" ? { itemId: record.itemId } : {}),
            ...(Array.isArray(record.lifecycle) ? { lifecycle: record.lifecycle.join(",") } : {}),
            ...(typeof record.limit === "number" ? { limit: String(record.limit) } : {}),
            ...(typeof record.cursor === "string" ? { cursor: record.cursor } : {}),
        };
    }
    if (tool === "get_memory_usage") {
        return {
            ...(typeof record.conversationId === "string" ? { conversationId: record.conversationId } : {}),
            ...(typeof record.turnId === "string" ? { turnId: record.turnId } : {}),
        };
    }
    return {};
}

function unavailableResult<Input, Output>(
    tool: ManagementToolName,
    input: Input,
    reason: MemoryManagementUnavailableOutput<"query">["reason"],
    content: Output | null = null,
): ChatToolResult<Output> {
    return {
        ok: false,
        tool,
        inputSummary: summarize(tool, input),
        content,
        sources: [],
        error: "Memory management is currently unavailable.",
    };
}

function summarize(tool: ManagementToolName, input: unknown): string {
    if (tool === "get_memory_status") return "status";
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (typeof record.text === "string") return record.text.slice(0, MEMORY_MANAGEMENT_TEXT_MAX_CHARS);
    if (typeof record.itemId === "string") return record.itemId;
    if (typeof record.conversationId === "string") return `${record.conversationId}:${typeof record.turnId === "string" ? record.turnId : ""}`;
    return tool === "query_memories" ? "all" : "current_run";
}

function validateQueryInput(input: unknown): MemoryManagementQueryInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("query_memories input must be an object.");
    }
    const record = input as Record<string, unknown>;
    rejectUnknownKeys(record, new Set(["text", "itemId", "lifecycle", "limit", "cursor"]), "query_memories");
    const text = record.text === undefined
        ? undefined
        : boundedString(record.text, "text", 1, MEMORY_MANAGEMENT_TEXT_MAX_CHARS);
    const itemId = record.itemId === undefined
        ? undefined
        : boundedString(record.itemId, "itemId", 1, 256);
    if (text !== undefined && itemId !== undefined) throw new Error("query_memories accepts either text or itemId, not both.");
    const lifecycleValues = readLifecycle(record.lifecycle);
    const limit = record.limit === undefined
        ? MEMORY_MANAGEMENT_DEFAULT_LIMIT
        : numberInRange(record.limit, "limit", 1, MEMORY_MANAGEMENT_MAX_LIMIT);
    const cursor = record.cursor === undefined
        ? undefined
        : boundedString(record.cursor, "cursor", 1, 4096);
    return {
        ...(text !== undefined ? { text } : {}),
        ...(itemId !== undefined ? { itemId } : {}),
        ...(lifecycleValues ? { lifecycle: lifecycleValues } : {}),
        limit,
        ...(cursor !== undefined ? { cursor } : {}),
    };
}

function readLifecycle(value: unknown): MemoryManagementQueryInput["lifecycle"] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new Error("query_memories lifecycle must be an array.");
    const allowed = new Set([
        "derived", "active", "archived", "paused", "forget_pending", "stale", "exported", "forgotten_marker",
    ]);
    const result: NonNullable<MemoryManagementQueryInput["lifecycle"]> = [];
    for (const item of value) {
        if (typeof item !== "string" || !allowed.has(item)) throw new Error("query_memories lifecycle contains an invalid value.");
        if (!result.includes(item as NonNullable<MemoryManagementQueryInput["lifecycle"]>[number])) {
            result.push(item as NonNullable<MemoryManagementQueryInput["lifecycle"]>[number]);
        }
    }
    return result;
}

function boundedString(value: unknown, field: string, min: number, max: number): string {
    if (typeof value !== "string") throw new Error(`${field} must be a string.`);
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max) throw new Error(`${field} length must be between ${min} and ${max}.`);
    return trimmed;
}

function optionalBoundedString(value: unknown, field: string, max: number): string | undefined {
    return value === undefined ? undefined : boundedString(value, field, 1, max);
}

function numberInRange(value: unknown, field: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${field} must be an integer between ${min} and ${max}.`);
    }
    return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, tool: string): void {
    const unknown = Object.keys(value).filter(key => !allowed.has(key));
    if (unknown.length > 0) throw new Error(`${tool} received unknown input: ${unknown.join(", ")}.`);
}
