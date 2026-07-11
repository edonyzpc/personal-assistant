import { stableHash, isRecord } from "../helpers";

export const EVIDENCE_STRENGTHS = ["weak", "medium", "strong", "conflicting"] as const;
export type EvidenceStrength = typeof EVIDENCE_STRENGTHS[number];

export interface UISourceRef {
    path: string;
    heading?: string;
    blockId?: string;
    excerpt?: string;
    generatedAt?: string;
    contentHash?: string;
    whyShown?: string[];
    evidenceStrength?: EvidenceStrength;
}

export interface ReplaySourceRef {
    path: string;
    heading?: string;
    blockId?: string;
    generatedAt?: string;
    contentHash?: string;
    excerptHash?: string;
    whyShown?: string[];
    evidenceStrength?: EvidenceStrength;
}

export interface PersistedSourceRef extends ReplaySourceRef {
    sourceId?: string;
    retrievalOutcomeId?: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f]/;
const FORBIDDEN_PERSISTED_TEXT_KEYS = new Set([
    "excerpt",
    "rawText",
    "noteText",
    "fullProviderOutput",
    "providerOutput",
    "promptChunk",
    "promptChunks",
    "memoryText",
    "rawMemoryText",
    "privateTitle",
]);

export type SourceRefValidationResult =
    | { ok: true }
    | { ok: false; reason: string };

export function validateSourceRefPathShape(ref: unknown): SourceRefValidationResult {
    if (!isRecord(ref)) return { ok: false, reason: "source_ref_not_object" };
    if (typeof ref.path !== "string" || ref.path.trim().length === 0) {
        return { ok: false, reason: "empty_path" };
    }
    if (CONTROL_CHARS_RE.test(ref.path)) return { ok: false, reason: "control_char_path" };
    if (ref.path.startsWith("/") || ref.path.startsWith("\\") || /^[a-zA-Z]:/.test(ref.path)) {
        return { ok: false, reason: "absolute_path" };
    }
    if (ref.path.split(/[\\/]/).some((segment) => segment === "..")) {
        return { ok: false, reason: "parent_traversal" };
    }
    if (ref.heading !== undefined) {
        if (typeof ref.heading !== "string" || ref.heading.trim().length === 0 || CONTROL_CHARS_RE.test(ref.heading)) {
            return { ok: false, reason: "invalid_heading" };
        }
    }
    if (ref.blockId !== undefined) {
        if (typeof ref.blockId !== "string" || !/^\^?[A-Za-z0-9_-]+$/.test(ref.blockId)) {
            return { ok: false, reason: "invalid_block_id" };
        }
    }
    if (ref.whyShown !== undefined && (
        !Array.isArray(ref.whyShown)
        || ref.whyShown.some((reason) => typeof reason !== "string")
    )) {
        return { ok: false, reason: "invalid_why_shown" };
    }
    if (ref.evidenceStrength !== undefined && !EVIDENCE_STRENGTHS.includes(ref.evidenceStrength as EvidenceStrength)) {
        return { ok: false, reason: "invalid_evidence_strength" };
    }
    for (const key of [
        "excerpt",
        "generatedAt",
        "contentHash",
        "excerptHash",
        "sourceId",
        "retrievalOutcomeId",
    ] as const) {
        if (ref[key] !== undefined && typeof ref[key] !== "string") {
            return { ok: false, reason: `invalid_${key}` };
        }
    }
    return { ok: true };
}

export function toReplaySourceRef(uiRef: UISourceRef): ReplaySourceRef {
    const replayRef: ReplaySourceRef = {
        path: uiRef.path,
    };
    if (uiRef.heading !== undefined) replayRef.heading = uiRef.heading;
    if (uiRef.blockId !== undefined) replayRef.blockId = uiRef.blockId;
    if (uiRef.generatedAt !== undefined) replayRef.generatedAt = uiRef.generatedAt;
    if (uiRef.contentHash !== undefined) replayRef.contentHash = uiRef.contentHash;
    if (uiRef.excerpt !== undefined) replayRef.excerptHash = stableHash(uiRef.excerpt);
    if (uiRef.whyShown !== undefined) replayRef.whyShown = [...uiRef.whyShown];
    if (uiRef.evidenceStrength !== undefined) replayRef.evidenceStrength = uiRef.evidenceStrength;
    return replayRef;
}

export function hasForbiddenPersistedTextFields(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.some((entry) => hasForbiddenPersistedTextFields(entry));
    }
    if (!isRecord(value)) return false;
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_PERSISTED_TEXT_KEYS.has(key) && child !== undefined) return true;
        if (hasForbiddenPersistedTextFields(child)) return true;
    }
    return false;
}
