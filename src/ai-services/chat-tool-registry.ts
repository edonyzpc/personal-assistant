/**
 * ToolRegistry class + V1A policy assertion + output-budget enforcement
 * + Phase 4 preflight metadata builder + tool-error sanitizers.
 *
 * Moved here from the original chat-tools.ts monolith as part of Phase 3.1
 * (sdd-chat-tools-split.md). Depends on Module A (types), Module B (constants),
 * Module E (createToolFailureResult, truncate), and Module F (isChatToolName).
 */

import type {
    ChatToolContext,
    ChatToolDefinition,
    ChatToolInputSchema,
    ChatToolName,
    ChatToolRegistryDefinition,
    ChatToolProviderSchema,
    ChatToolProviderSchemaExportResult,
    ChatToolResult,
    InspectObsidianNoteOutput,
    ObsidianOperationsV1AToolName,
    PrepareAndValidateRepair,
    PrepareAndValidateResult,
    PrepareToolArgumentsContext,
    ReadCanvasSummaryOutput,
    VaultSnippetSearchOutput,
    VaultTagsOutput,
} from "./chat-tool-types";
import {
    OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
    isObsidianOperationsV1AToolName,
} from "./chat-tool-types";
import { TOOL_VALIDATION_INPUT_SUMMARY_CHARS } from "./chat-tool-constants";
import { createToolFailureResult, truncate } from "./chat-tool-execution-helpers";
import { isChatToolName } from "./chat-tool-guards";
import {
    deepEqualJson,
    summarizeRawInput,
    toInputRecord,
} from "./chat-tool-prepare-helpers";
import { createAbortError, isAbortError, throwIfAborted } from "./chat-utils";
import { getErrorType } from "./agent-utils";

interface RegisteredChatTool {
    name: ChatToolName;
    definition: ChatToolRegistryDefinition;
    prepareArguments?: (raw: unknown, ctx: PrepareToolArgumentsContext) => unknown;
    validateInput(input: unknown): unknown;
    statusMessage(input: unknown): string;
    execute(input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>>;
}

export class ToolRegistry {
    private readonly tools = new Map<ChatToolName, RegisteredChatTool>();

    register<Input, Output>(definition: ChatToolDefinition<Input, Output>): void {
        assertObsidianOperationsV1AToolPolicy(definition);
        this.tools.set(definition.name, {
            name: definition.name,
            definition: toRegistryDefinition(definition),
            prepareArguments: definition.prepareArguments,
            validateInput: definition.validateInput,
            statusMessage: definition.statusMessage as (input: unknown) => string,
            execute: definition.execute as (input: unknown, context: ChatToolContext) => Promise<ChatToolResult<unknown>>,
        });
    }

    get(name: string): RegisteredChatTool | undefined {
        if (!isChatToolName(name)) return undefined;
        return this.tools.get(name);
    }

    /**
     * Pre-validation pipeline for PA executor.
     * Runs prepareArguments (if defined) → validateInput. Returns Ok with prepared
     * input on success, or Err on validation failure. PA executor converts Err to
     * schema_invalid outcome BEFORE registry.execute, bypassing ChatToolResult's
     * recoverable_error flattening at chatToolResultToPaAgentToolExecutionResult.
     *
     * Phase 4 preflight metadata: if prepareArguments mutated raw input, the result
     * carries `repaired` (originalKeys / originalInputSummary / reason) so PA executor
     * can write it into toolResult.metadata for audit + Phase B alias-usage analytics.
     */
    prepareAndValidate(name: string, raw: unknown, ctx: PrepareToolArgumentsContext): PrepareAndValidateResult {
        const tool = this.get(name);
        if (!tool) {
            return { ok: false, error: new Error(`Tool ${name} is not registered.`) };
        }
        try {
            const prepared = tool.prepareArguments ? tool.prepareArguments(raw, ctx) : raw;
            tool.validateInput(prepared);
            const repaired = buildPrepareRepairInfo(raw, prepared);
            return repaired ? { ok: true, input: prepared, repaired } : { ok: true, input: prepared };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    getDefinition(name: string): ChatToolRegistryDefinition | undefined {
        return this.get(name)?.definition;
    }

    listDefinitions(): ChatToolRegistryDefinition[] {
        return [...this.tools.values()].map((tool) => cloneRegistryDefinition(tool.definition));
    }

    exportProviderSchemas(): ChatToolProviderSchema[] {
        return this.listDefinitions().map((definition) => ({
            type: "function",
            function: {
                name: definition.name,
                description: definition.description,
                parameters: definition.inputSchema,
            },
        }));
    }

    exportProviderSchemasSafe(): ChatToolProviderSchemaExportResult {
        try {
            return { ok: true, schemas: this.exportProviderSchemas() };
        } catch (error) {
            return {
                ok: false,
                schemas: [],
                error: getErrorMessage(error),
            };
        }
    }

    has(name: string): boolean {
        return Boolean(this.get(name));
    }

    async execute(name: string, input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>> {
        throwIfAborted(context.signal);
        const tool = this.get(name);
        if (!tool) {
            context.plugin.log("Chat tool is not registered", { tool: name });
            return createToolFailureResult(name, "unregistered tool", "Skipped an unavailable read-only tool.");
        }

        let validatedInput: unknown;
        try {
            validatedInput = tool.validateInput(input);
        } catch (error) {
            context.plugin.log("Chat tool input validation failed", { tool: name, errorType: getErrorType(error) });
            return createToolFailureResult(
                name,
                summarizeInvalidToolInput(input),
                sanitizeToolErrorMessage(error, "Skipped a read-only tool because its input was invalid."),
            );
        }

        throwIfAborted(context.signal);
        context.onToolRunning?.(name, tool.statusMessage(validatedInput));
        try {
            const result = await tool.execute(validatedInput, context);
            throwIfAborted(context.signal);
            return enforceToolOutputBudget(tool.definition, result);
        } catch (error) {
            if (isAbortError(error, context.signal)) {
                throw context.signal?.aborted ? createAbortError() : error;
            }
            context.plugin.log("Chat tool execution failed", { tool: name, errorType: getErrorType(error) });
            return createToolFailureResult(name, "execution failed", "Read-only tool was unavailable.");
        }
    }
}

export function assertObsidianOperationsV1AToolPolicy<Input, Output>(
    definition: ChatToolDefinition<Input, Output>,
): void {
    if (!isObsidianOperationsV1AToolName(definition.name)) return;

    const errors: string[] = [];
    if (definition.permission !== "read-only") {
        errors.push("permission must be read-only");
    }
    if (definition.cost !== "free") {
        errors.push("cost must be free");
    }
    if (!Number.isFinite(definition.outputBudgetChars) || definition.outputBudgetChars <= 0) {
        errors.push("outputBudgetChars must be positive");
    } else if (definition.outputBudgetChars > OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS) {
        errors.push(`outputBudgetChars must be <= ${OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS}`);
    }
    if (definition.requiresConfirmation !== false) {
        errors.push("requiresConfirmation must be false");
    }
    if (definition.failureBehavior !== "recoverable") {
        errors.push("failureBehavior must be recoverable");
    }
    if (definition.sourceBoundary !== "read-only-tool") {
        errors.push("sourceBoundary must be read-only-tool");
    }

    if (errors.length > 0) {
        throw new Error(`Invalid Obsidian Operations v1A tool policy for ${definition.name}: ${errors.join("; ")}`);
    }
}

function toRegistryDefinition<Input, Output>(
    definition: ChatToolDefinition<Input, Output>,
): ChatToolRegistryDefinition {
    return {
        name: definition.name,
        description: definition.description,
        inputSchema: cloneInputSchema(definition.inputSchema),
        plannerGuidance: [...definition.plannerGuidance],
        permission: definition.permission,
        cost: definition.cost,
        outputBudgetChars: definition.outputBudgetChars,
        requiresConfirmation: definition.requiresConfirmation,
        failureBehavior: definition.failureBehavior,
        statusMessage: definition.statusMessageText,
        sourceBoundary: definition.sourceBoundary,
    };
}

function enforceToolOutputBudget(
    definition: ChatToolRegistryDefinition,
    result: ChatToolResult<unknown>,
): ChatToolResult<unknown> {
    if (!result.ok || !result.content || !isObsidianOperationsV1AToolName(definition.name)) {
        return result;
    }
    const serialized = JSON.stringify(result.content);
    if (serialized.length <= definition.outputBudgetChars) {
        return result;
    }
    return {
        ...result,
        content: fitV1AToolContentToBudget(definition.name, result.content, definition.outputBudgetChars),
    };
}

function fitV1AToolContentToBudget(
    tool: ObsidianOperationsV1AToolName,
    content: unknown,
    maxLength: number,
): unknown {
    const next = cloneJsonValue(content);
    if (!next || typeof next !== "object" || Array.isArray(next)) {
        return content;
    }

    markBudgetTruncated(next as Record<string, unknown>);
    let serialized = JSON.stringify(next);
    for (let attempt = 0; attempt < 200 && serialized.length > maxLength; attempt++) {
        const trimResult = trimLargestJsonPayload(next, serialized.length - maxLength);
        if (!trimResult.trimmed) break;
        if (trimResult.omitted > 0) {
            incrementOmittedCount(next as Record<string, unknown>, trimResult.omitted);
        }
        markBudgetTruncated(next as Record<string, unknown>);
        serialized = JSON.stringify(next);
    }

    if (serialized.length <= maxLength) {
        return next;
    }

    return createMinimalBudgetedV1AContent(tool, content);
}

function cloneJsonValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value)) as unknown;
}

function markBudgetTruncated(value: Record<string, unknown>): void {
    value.truncated = true;
}

function incrementOmittedCount(value: Record<string, unknown>, amount: number): void {
    const current = typeof value.omittedCount === "number" && Number.isFinite(value.omittedCount)
        ? value.omittedCount
        : 0;
    value.omittedCount = current + amount;
}

type JsonContainer = Record<string, unknown> | unknown[];

type JsonTrimTarget =
    | { kind: "string"; parent: JsonContainer; key: string | number; value: string; size: number }
    | { kind: "array"; value: unknown[]; size: number };

function trimLargestJsonPayload(value: unknown, overflow: number): { trimmed: boolean; omitted: number } {
    const target = findLargestJsonTrimTarget(value);
    if (!target) return { trimmed: false, omitted: 0 };
    if (target.kind === "array") {
        target.value.pop();
        return { trimmed: true, omitted: 1 };
    }

    const nextLength = Math.max(0, target.value.length - Math.max(16, overflow + 8));
    const nextValue = truncateToExactLength(target.value, nextLength);
    if (Array.isArray(target.parent)) {
        target.parent[target.key as number] = nextValue;
    } else {
        target.parent[target.key as string] = nextValue;
    }
    return { trimmed: true, omitted: 0 };
}

function findLargestJsonTrimTarget(value: unknown): JsonTrimTarget | null {
    let target: JsonTrimTarget | null = null;
    const visit = (current: unknown, parent?: JsonContainer, key?: string | number) => {
        if (typeof current === "string") {
            if (parent !== undefined && key !== undefined && current.length > 32) {
                const candidate: JsonTrimTarget = {
                    kind: "string",
                    parent,
                    key,
                    value: current,
                    size: current.length,
                };
                if (!target || candidate.size > target.size) target = candidate;
            }
            return;
        }
        if (Array.isArray(current)) {
            if (current.length > 0) {
                const candidate: JsonTrimTarget = {
                    kind: "array",
                    value: current,
                    size: JSON.stringify(current).length,
                };
                if (!target || candidate.size > target.size) target = candidate;
            }
            current.forEach((item, index) => visit(item, current, index));
            return;
        }
        if (!current || typeof current !== "object") return;
        for (const [childKey, childValue] of Object.entries(current as Record<string, unknown>)) {
            if (childKey === "kind") continue;
            visit(childValue, current as Record<string, unknown>, childKey);
        }
    };
    visit(value);
    return target;
}

function truncateToExactLength(value: string, maxLength: number): string {
    if (maxLength <= 0) return "";
    if (value.length <= maxLength) return value;
    if (maxLength <= 3) return value.slice(0, maxLength);
    return `${value.slice(0, maxLength - 3)}...`;
}

function createMinimalBudgetedV1AContent(tool: ObsidianOperationsV1AToolName, content: unknown): unknown {
    const record = content && typeof content === "object" ? content as Record<string, unknown> : {};
    const omittedCount = typeof record.omittedCount === "number" && Number.isFinite(record.omittedCount)
        ? record.omittedCount + 1
        : 1;
    if (tool === "inspect_obsidian_note") {
        return {
            kind: "note-structure",
            path: typeof record.path === "string" ? record.path : "",
            title: typeof record.title === "string" ? record.title : undefined,
            truncated: true,
            omittedCount,
        } satisfies InspectObsidianNoteOutput;
    }
    if (tool === "read_canvas_summary") {
        return {
            kind: "canvas-structure",
            path: typeof record.path === "string" ? record.path : "",
            nodeCount: typeof record.nodeCount === "number" ? record.nodeCount : 0,
            edgeCount: typeof record.edgeCount === "number" ? record.edgeCount : 0,
            truncated: true,
            omittedCount,
        } satisfies ReadCanvasSummaryOutput;
    }
    if (tool === "search_vault_snippets") {
        return {
            kind: "vault-snippets",
            query: typeof record.query === "string" ? record.query : "",
            scope: typeof record.scope === "string" ? record.scope : undefined,
            matches: [],
            unsupportedScope: record.unsupportedScope === true ? true : undefined,
            missingScope: record.missingScope === true ? true : undefined,
            scannedFiles: typeof record.scannedFiles === "number" ? record.scannedFiles : undefined,
            scannedBytes: typeof record.scannedBytes === "number" ? record.scannedBytes : undefined,
            truncated: true,
            omittedCount,
        } satisfies VaultSnippetSearchOutput;
    }
    return {
        kind: "vault-tags",
        tags: [],
        scannedFiles: typeof record.scannedFiles === "number" ? record.scannedFiles : undefined,
        truncated: true,
        omittedCount,
    } satisfies VaultTagsOutput;
}

function cloneRegistryDefinition(definition: ChatToolRegistryDefinition): ChatToolRegistryDefinition {
    return {
        ...definition,
        inputSchema: cloneInputSchema(definition.inputSchema),
        plannerGuidance: [...definition.plannerGuidance],
    };
}

/**
 * Phase 4 preflight metadata detector. Returns repair info if prepareArguments
 * mutated raw input (deepEqual compare), else undefined. The reason field is
 * intentionally generic in path B — Phase B analytics use originalKeys to identify
 * which alias keys triggered, not a per-tool reason string.
 */
function buildPrepareRepairInfo(raw: unknown, prepared: unknown): PrepareAndValidateRepair | undefined {
    if (deepEqualJson(raw, prepared)) return undefined;
    const rawRecord = toInputRecord(raw);
    const originalKeys = rawRecord ? Object.keys(rawRecord).join(",") : typeof raw;
    return {
        originalKeys,
        originalInputSummary: summarizeRawInput(raw),
        reason: "alias mapping or normalization applied",
    };
}

function cloneInputSchema(schema: ChatToolInputSchema): ChatToolInputSchema {
    return {
        ...schema,
        properties: Object.fromEntries(Object.entries(schema.properties).map(([name, property]) => [
            name,
            { ...property, enum: property.enum ? [...property.enum] : undefined },
        ])),
        required: schema.required ? [...schema.required] : undefined,
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sanitizeToolErrorMessage(error: unknown, fallback: string): string {
    const message = getErrorMessage(error).replace(/\s+/g, " ").trim();
    return message ? truncate(message, TOOL_VALIDATION_INPUT_SUMMARY_CHARS) : fallback;
}

function summarizeInvalidToolInput(input: unknown): string {
    try {
        const serialized = JSON.stringify(input);
        if (typeof serialized === "string") {
            return truncate(serialized, TOOL_VALIDATION_INPUT_SUMMARY_CHARS);
        }
    } catch {
        // Fall through to String(input).
    }
    return truncate(String(input), TOOL_VALIDATION_INPUT_SUMMARY_CHARS);
}
