import { createToolFailureResult } from "../chat-tool-execution-helpers";
import { throwIfAborted } from "../chat-utils";
import type { ChatToolContext, ChatToolDefinition, ChatToolResult } from "../chat-tool-types";
import type { CodemodeError, CodemodeOutputItem, CodemodeStoreWrites } from "../../third_party/pi-codemode/types";
import { runIndependentCode } from "./browser-launcher";

export const EXECUTE_CODE_TOOL_NAME = "execute_code";
export const EXECUTE_CODE_TIMEOUT_MS = 120_000;
const EXECUTE_CODE_EXPIRED_MESSAGE = "Independent code execution deadline expired before Worker initialization.";

interface ExecuteCodeInput {
    code: string;
}

interface ExecuteCodeObservation {
    value: unknown;
    output: CodemodeOutputItem[];
    calls: [];
    storeWrites: CodemodeStoreWrites;
}

function validateExecuteCodeInput(input: unknown): ExecuteCodeInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("code:string is required.");
    }
    const code = (input as { code?: unknown }).code;
    if (typeof code !== "string" || !code.trim()) throw new Error("code:string is required.");
    return { code };
}

function describeCodemodeError(error: CodemodeError): string {
    const prefix = error.name ? `${error.name}: ${error.message}` : error.message;
    return error.stack ? `${prefix}\n${error.stack}` : prefix;
}

export function createExecuteCodeTool(): ChatToolDefinition<ExecuteCodeInput, ExecuteCodeObservation> {
    return {
        name: EXECUTE_CODE_TOOL_NAME,
        description: "Run one isolated async JavaScript body for deterministic calculation. It supports return values, text(), Date.now(), the device date offset, date arithmetic, numbers, arrays, and JSON; Intl is not installed.",
        inputSchema: {
            type: "object",
            properties: {
                code: {
                    type: "string",
                    description: "Async JavaScript function body. Use return for a JSON-serializable value and text(value) for text output.",
                },
            },
            required: ["code"],
            additionalProperties: false,
        },
        plannerGuidance: [
            "Use for deterministic local computation when JavaScript is more reliable or clearer than mental arithmetic.",
            "The environment has no PA tools, shell, network, filesystem, arbitrary imports, Intl, or state across calls.",
            "Combine it with other available tools in whichever order best answers the request.",
        ],
        permission: "read-only",
        cost: "free",
        outputBudgetChars: Number.MAX_SAFE_INTEGER,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Running isolated code",
        sourceBoundary: "read-only-tool",
        statusMessage: () => "Running isolated code",
        validateInput: validateExecuteCodeInput,
        execute: async (input, context: ChatToolContext): Promise<ChatToolResult<ExecuteCodeObservation>> => {
            throwIfAborted(context.signal);
            const inputSummary = `code:${input.code.length} chars`;
            const remainingMs = context.outerToolDeadlineAt === undefined
                ? EXECUTE_CODE_TIMEOUT_MS
                : context.outerToolDeadlineAt - Date.now();
            if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
                return {
                    ok: false,
                    tool: EXECUTE_CODE_TOOL_NAME,
                    inputSummary,
                    content: null,
                    sources: [],
                    sourceRecords: [],
                    error: EXECUTE_CODE_EXPIRED_MESSAGE,
                    executionState: "not_started",
                };
            }
            const result = await runIndependentCode({
                code: input.code,
                ...(context.signal ? { signal: context.signal } : {}),
                timeoutMs: Math.min(EXECUTE_CODE_TIMEOUT_MS, remainingMs),
            });
            throwIfAborted(context.signal);
            if (!result.ok) {
                return {
                    ...createToolFailureResult(
                        EXECUTE_CODE_TOOL_NAME,
                        inputSummary,
                        describeCodemodeError(result.error),
                        result.error.kind === "timeout" ? "timeout" : "adapter_error",
                    ),
                    executionState: "failed",
                };
            }
            if (result.output.some(item => item.type === "image")) {
                return {
                    ok: false,
                    tool: EXECUTE_CODE_TOOL_NAME,
                    inputSummary,
                    content: null,
                    sources: [],
                    sourceRecords: [],
                    error: "Independent code returned image output, which is unsupported; only structured return values and text() output are admitted.",
                    failureReason: "adapter_error",
                    executionState: "failed",
                };
            }
            return {
                ok: true,
                tool: EXECUTE_CODE_TOOL_NAME,
                inputSummary,
                content: {
                    value: result.value,
                    output: result.output,
                    calls: [],
                    storeWrites: result.storeWrites,
                },
                sources: [],
                sourceRecords: [],
            };
        },
    };
}
