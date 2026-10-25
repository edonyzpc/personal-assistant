import { createToolFailureResult } from "../chat-tool-execution-helpers";
import { throwIfAborted } from "../chat-utils";
import type {
    ChatToolContext,
    ChatToolDefinition,
    ChatToolResult,
} from "../chat-tool-types";
import type { CodemodeOutputItem, CodemodeStoreWrites } from "../../third_party/pi-codemode/types";

export const EXECUTE_OBSIDIAN_CODE_TOOL_NAME = "execute_obsidian_code";
export const EXECUTE_OBSIDIAN_CODE_TIMEOUT_MS = 120_000;
export const EXECUTE_OBSIDIAN_CODE_MAX_CODE_CHARS = 1_000_000;

export interface ExecuteObsidianCodeInput {
    code: string;
    mode: "apply" | "preview";
}

export interface ExecuteObsidianCodeObservation {
    value: unknown;
    output: CodemodeOutputItem[];
    calls: unknown[];
    storeWrites: CodemodeStoreWrites;
    mode: ExecuteObsidianCodeInput["mode"];
}

export interface ExecuteObsidianCodeRuntime {
    execute(
        input: ExecuteObsidianCodeInput,
        context: ChatToolContext,
    ): Promise<ChatToolResult<ExecuteObsidianCodeObservation>>;
}

function validateInput(input: unknown): ExecuteObsidianCodeInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("code:string and mode:apply|preview are required.");
    }
    const value = input as { code?: unknown; mode?: unknown };
    if (typeof value.code !== "string" || !value.code.trim()) {
        throw new Error("code:string is required.");
    }
    if (value.code.length > EXECUTE_OBSIDIAN_CODE_MAX_CODE_CHARS) {
        throw new Error("code exceeds the composed-execution payload budget.");
    }
    if (value.mode !== "apply" && value.mode !== "preview") {
        throw new Error("mode must be apply or preview.");
    }
    return { code: value.code, mode: value.mode };
}

export function createExecuteObsidianCodeTool(): ChatToolDefinition<
    ExecuteObsidianCodeInput,
    ExecuteObsidianCodeObservation
> {
    return {
        name: EXECUTE_OBSIDIAN_CODE_TOOL_NAME,
        description: "Run an isolated async JavaScript body using the bound obsidian resource SDK, fixed Markdown/YAML libraries and existing tools. The Host admits each dynamic call.",
        inputSchema: {
            type: "object",
            properties: {
                code: {
                    type: "string",
                    description: "Async JavaScript body. await obsidian.<namespace>.<method>(args) returns SdkResult; tools.<name>(args) preserves its original tool result. Binary reads yield Uint8Array.",
                    maxLength: EXECUTE_OBSIDIAN_CODE_MAX_CODE_CHARS,
                },
                mode: {
                    type: "string",
                    enum: ["apply", "preview"],
                    description: "apply permits admitted child effects; preview forces every child effect to be zero-execution.",
                },
            },
            required: ["code", "mode"],
            additionalProperties: false,
        },
        plannerGuidance: [
            "Use for a concrete multi-step algorithm that benefits from JavaScript control flow and dynamic values.",
            "obsidian.* and tools.* are parallel top-level roots: await obsidian.<namespace>.<method>(args) for SdkResult, or await tools.<name>(args) for the existing tool's original result.",
            "The Host validates, admits, times, and records every dynamic obsidian.* and tools.* call independently; loading/disclosure does not grant or remove execution authority.",
            "The outer load_tools tool only changes which ordinary tools are disclosed in later provider requests; it is not bound as tools.load_tools and does not enable SDK methods.",
            "A script return value is program output, not proof that a domain effect completed or failed. Use returned operation identities and existing status tools for recovery.",
        ],
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 2_000_000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        retrySafety: "side_effect",
        canReuseSuccessfulResult: false,
        statusMessageText: "Working with your vault",
        sourceBoundary: "read-only-tool",
        statusMessage: input => `Working with your vault (${input.mode})`,
        validateInput,
        execute: async (input, context): Promise<ChatToolResult<ExecuteObsidianCodeObservation>> => {
            throwIfAborted(context.signal);
            const inputSummary = `code:${input.code.length} chars; mode:${input.mode}`;
            const runtime = context.executeObsidianRuntime;
            if (!runtime) {
                return {
                    ...createToolFailureResult(
                        EXECUTE_OBSIDIAN_CODE_TOOL_NAME,
                        inputSummary,
                        "The composed execution host binding is unavailable in this request.",
                    ),
                    executionState: "not_started",
                    recovery: { code: "composed_runtime_unavailable", allowedActions: ["needs_user"] },
                };
            }
            return await runtime.execute(input, context);
        },
    };
}
