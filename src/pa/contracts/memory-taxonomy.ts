import type { PersistedSourceRef } from "./source-ref";

export const MEMORY_TYPES = [
    "preference",
    "decision",
    "project_context",
    "task_constraint",
    "open_question",
] as const;

export type MemoryType = typeof MEMORY_TYPES[number];

export const NON_V1_DEFAULT_MEMORY_TYPES = [
    "relationship",
    "identity",
    "goal",
    "habit",
    "value",
    "health",
    "finance",
] as const;

export const MEMORY_LIFECYCLE_STATES = [
    "candidate",
    "active",
    "archived",
    "stale",
    "forgotten_tombstone",
    "exported",
] as const;

export type MemoryLifecycleState = typeof MEMORY_LIFECYCLE_STATES[number];

export const MEMORY_SENSITIVITIES = ["low", "medium", "high"] as const;
export type MemorySensitivity = typeof MEMORY_SENSITIVITIES[number];

export interface MemoryCandidateContract {
    id: string;
    type: MemoryType;
    lifecycle: "candidate";
    sensitivity: MemorySensitivity;
    scope: string;
    sourceRefs: PersistedSourceRef[];
    createdAt: string;
    summary: string;
}

export interface MemoryLifecycleRecord {
    id: string;
    type: MemoryType;
    lifecycle: MemoryLifecycleState;
    sensitivity: MemorySensitivity;
    sourceRefs?: PersistedSourceRef[];
    summary?: string;
    tombstoneReason?: string;
    rawMemoryText?: string;
}

export type MemoryContractValidationResult =
    | { ok: true }
    | { ok: false; reason: string };

function includesString<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
    return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isMemoryType(value: unknown): value is MemoryType {
    return includesString(MEMORY_TYPES, value);
}

export function validateMemoryCandidate(candidate: MemoryCandidateContract, options: {
    allowHighSensitivity?: boolean;
} = {}): MemoryContractValidationResult {
    if (!isMemoryType(candidate.type)) return { ok: false, reason: "invalid_memory_type" };
    if (candidate.lifecycle !== "candidate") return { ok: false, reason: "invalid_lifecycle" };
    if (!includesString(MEMORY_SENSITIVITIES, candidate.sensitivity)) {
        return { ok: false, reason: "invalid_sensitivity" };
    }
    if (candidate.sensitivity === "high" && !options.allowHighSensitivity) {
        return { ok: false, reason: "high_sensitivity_candidate_blocked" };
    }
    if (!candidate.sourceRefs || candidate.sourceRefs.length === 0) {
        return { ok: false, reason: "missing_source_refs" };
    }
    if (candidate.summary.trim().length === 0) return { ok: false, reason: "missing_summary" };
    return { ok: true };
}

export function validateMemoryLifecycleRecord(record: MemoryLifecycleRecord): MemoryContractValidationResult {
    if (!isMemoryType(record.type)) return { ok: false, reason: "invalid_memory_type" };
    if (!includesString(MEMORY_LIFECYCLE_STATES, record.lifecycle)) {
        return { ok: false, reason: "invalid_lifecycle" };
    }
    if (typeof record.rawMemoryText === "string") {
        return { ok: false, reason: "raw_memory_text_not_allowed" };
    }
    return { ok: true };
}

export function canAutoConfirmMemoryCandidate(candidate: Pick<MemoryCandidateContract, "type">): boolean {
    if (candidate.type === "task_constraint") return false;
    return false;
}
