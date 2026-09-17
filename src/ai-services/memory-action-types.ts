import type { MemorySensitivity, MemoryType } from "../pa/contracts";

export const MEMORY_ACTION_TOOL_NAME = "manage_memory" as const;

export type MemoryActionName =
    | "remember"
    | "correct"
    | "pause_use"
    | "resume_use"
    | "apply_device_wide"
    | "limit_to_current_vault"
    | "forget"
    | "retry_forget"
    | "undo_recent_change";

export const MEMORY_ACTION_NAMES: readonly MemoryActionName[] = [
    "remember",
    "correct",
    "pause_use",
    "resume_use",
    "apply_device_wide",
    "limit_to_current_vault",
    "forget",
    "retry_forget",
    "undo_recent_change",
];

/** Host-only authority for the live PA Agent request. Never a provider schema field. */
export interface MemoryActionHostBinding {
    runId: string;
    userMessageId: string;
    userPrompt: string;
    userPromptHash: string;
    conversationId?: string;
    isCurrent(): boolean;
}

/** Bounded model input. It cannot assert confirmation, authority, or host identity. */
export interface MemoryActionToolInput {
    action: MemoryActionName;
    userExpression: string;
    content?: string;
    /** Main-agent semantic classification; never confirmation or host authority. */
    memoryType?: MemoryType;
    sensitivity?: MemorySensitivity;
    targetId?: string;
    expectedRevisionId?: string;
    eventId?: string;
}

export interface MemoryActionPortInput extends MemoryActionToolInput {
    binding: MemoryActionHostBinding;
}

export type MemoryActionStatus =
    | "applied"
    | "pending"
    | "needs_confirmation"
    | "cancelled"
    | "failed";

export interface MemoryActionResult {
    kind: "memory-action";
    action: MemoryActionName;
    status: MemoryActionStatus;
    reason?: string;
    claimId?: string;
    revisionId?: string;
    eventId?: string;
    queueItemId?: string;
    undoExpiresAt?: string;
    detailTarget?: { kind: "memory-settings"; targetId: string };
    memoryEnabled?: boolean;
    learningEnabled?: boolean;
    effect?: "none" | "stored_not_in_use" | "retrieval_only" | "future_answers" | "collaboration_default" | "superseded";
    effectiveUse?: "active" | "paused" | "stored_not_in_use";
    retryScheduled?: boolean;
}

export type MemoryActionPort = {
    execute(input: MemoryActionPortInput): Promise<MemoryActionResult>;
};

export function memoryActionIdentity(
    input: MemoryActionPortInput,
): string {
    return stableHash(JSON.stringify([
        "pa-memory-action-v1",
        input.binding.runId,
        input.binding.userMessageId,
        input.binding.conversationId ?? "",
        input.binding.userPromptHash,
        input.action,
        input.targetId ?? "",
        "current_vault",
    ]));
}

export function memoryActionFingerprint(input: MemoryActionPortInput): string {
    return stableHash(JSON.stringify([
        "pa-memory-action-fingerprint-v1",
        input.binding.userPromptHash,
        input.action,
        input.content ?? "",
        input.memoryType ?? "",
        input.sensitivity ?? "",
        "current_vault",
        input.targetId ?? "",
        input.expectedRevisionId ?? "",
        input.eventId ?? "",
        input.userExpression,
    ]));
}

function stableHash(value: string): string {
    return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
        .map((seed, lane) => {
            let hash = seed;
            const salted = `${lane}\0${value}`;
            for (let index = 0; index < salted.length; index += 1) {
                hash ^= salted.charCodeAt(index);
                hash = Math.imul(hash, 0x01000193);
            }
            return (hash >>> 0).toString(16).padStart(8, "0");
        })
        .join("");
}
