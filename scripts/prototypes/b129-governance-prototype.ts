/**
 * B-129 G-05a offline feasibility only. Not imported by the plugin.
 * The adapter delegates ordinary legacy fields to the production normalizer.
 * Its historical V1 observations are preserved in the P0 evidence; this helper
 * remains a prototype and does not supply production authorization or migration.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
    normalizeDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
    type GovernedMemoryClaim,
    type MemoryClaimRevision,
} from "../../src/pa/memory-governance-persistence";
import type { UserProfileCandidate } from "../../src/ai-services/memory-extraction/type-a-extractor";

// P0 calibrated policy candidates for production wiring. These do not change
// ordinary note/body limits. The injection allowance is WITHIN the existing
// 6,000-character governed Memory budget, never an additional context allowance.
// UTF-8 storage bytes and complete rendered context characters are independent.
export const PROTOTYPE_STYLE_MAX_UTF8_BYTES = 8_192;
export const PROTOTYPE_STYLE_CONTEXT_CHARS = 3_000;
export const PROTOTYPE_STYLE_MAX_ID_CHARS = 128;
export const PROTOTYPE_STYLE_MAX_SCENE_CHARS = 64;
const nonempty = z.string().min(1);
const hostId = nonempty.max(PROTOTYPE_STYLE_MAX_ID_CHARS);
const sceneValue = nonempty.max(PROTOTYPE_STYLE_MAX_SCENE_CHARS);
const sceneSchema = z.object({
    writingTask: sceneValue,
    purpose: sceneValue,
    audience: sceneValue,
    domain: sceneValue,
}).strict();
const styleSchema = z.object({
    version: z.literal(1),
    exactText: nonempty,
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
    writingVersionId: hostId,
    source: z.object({ conversationId: hostId, messageId: hostId }).strict(),
    explicitActionId: hostId,
    scene: sceneSchema,
}).strict();

export type PrototypeWritingScene = z.infer<typeof sceneSchema>;
export type PrototypeWritingStyle = z.infer<typeof styleSchema>;
export type PrototypeRevision = MemoryClaimRevision & { writingStyle?: PrototypeWritingStyle };
export type PrototypeStateV2 = Omit<DeviceMemoryGovernanceStateV1, "schemaVersion" | "revisions"> & {
    schemaVersion: 2;
    revisions: PrototypeRevision[];
};

export function hashExactText(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

export function parsePrototypeStyle(value: unknown): PrototypeWritingStyle | null {
    const parsed = styleSchema.safeParse(value);
    if (!parsed.success) return null;
    if (Buffer.byteLength(parsed.data.exactText, "utf8") > PROTOTYPE_STYLE_MAX_UTF8_BYTES
        || hashExactText(parsed.data.exactText) !== parsed.data.textHash) return null;
    return parsed.data;
}

/** V1 upgrade is additive. Reject malformed/misplaced writingStyle fields. */
export function normalizePrototypeStateV2(value: unknown): PrototypeStateV2 | null {
    if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) return null;
    // Inspect before JSON cloning so a misplaced own key with undefined value
    // cannot disappear before the location check. Ordinary V1 fields keep the
    // existing parser semantics; this only reserves the new payload's location.
    if (hasMisplacedWritingStyle(value)) return null;
    const source = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const payloads = new Map<string, PrototypeWritingStyle>();
    const revisionRows: Array<{ row: Record<string, unknown>; key: string }> = [];
    if (!Array.isArray(source.revisions) || !Array.isArray(source.undoSnapshots)) return null;
    for (const [index, row] of source.revisions.entries()) {
        if (!isRecord(row)) return null;
        revisionRows.push({ row, key: `revision:${index}` });
    }
    for (const [index, snapshot] of source.undoSnapshots.entries()) {
        if (!isRecord(snapshot) || !Array.isArray(snapshot.revisions)) return null;
        for (const [revisionIndex, row] of snapshot.revisions.entries()) {
            if (!isRecord(row)) return null;
            revisionRows.push({ row, key: `undo:${index}:${revisionIndex}` });
        }
    }
    for (const { row, key } of revisionRows) {
        if (row.writingStyle === undefined) continue;
        // A V1 state cannot acquire a new typed payload under an old writer.
        if (value.schemaVersion !== 2) return null;
        const style = parsePrototypeStyle(row.writingStyle);
        if (!style) return null;
        payloads.set(key, style);
        delete row.writingStyle;
    }
    const baseline = normalizeDeviceMemoryGovernanceStateV1({ ...source, schemaVersion: 1 });
    if (!baseline) return null;
    // The production parseArray pushes every row in input order or rejects the entire
    // array. Neither integrity validation nor parseUndoSnapshot filters/sorts.
    // Thus these location keys retain their original revision association.
    baseline.revisions.forEach((row, index) => {
        const payload = payloads.get(`revision:${index}`);
        if (payload) (row as PrototypeRevision).writingStyle = payload;
    });
    baseline.undoSnapshots.forEach((snapshot, index) => {
        snapshot.revisions.forEach((row, revisionIndex) => {
            const payload = payloads.get(`undo:${index}:${revisionIndex}`);
            if (payload) (row as PrototypeRevision).writingStyle = payload;
        });
    });
    return { ...baseline, schemaVersion: 2 };
}

function hasMisplacedWritingStyle(value: unknown, path: Array<string | number> = []): boolean {
    if (Array.isArray(value)) {
        return value.some((entry, index) => hasMisplacedWritingStyle(entry, [...path, index]));
    }
    if (!isRecord(value)) return false;
    const revisionPath = path.length === 2 && path[0] === "revisions" && typeof path[1] === "number";
    const undoRevisionPath = path.length === 4 && path[0] === "undoSnapshots"
        && typeof path[1] === "number" && path[2] === "revisions" && typeof path[3] === "number";
    return Object.entries(value).some(([key, child]) => (
        (key === "writingStyle" && !revisionPath && !undoRevisionPath)
        || hasMisplacedWritingStyle(child, [...path, key])
    ));
}

export interface PrototypeStyleAuthorization {
    actionId: string;
    claimId: string;
    revisionId: string;
    vaultKey: string;
    writingVersionId: string;
    textHash: string;
    payloadHash: string;
}

export function hashStylePayload(style: PrototypeWritingStyle): string {
    return hashExactText(JSON.stringify(styleSchema.parse(style)));
}

/** A caller-owned host receipt, not model text, supplies the authority binding. */
export function isStaticallyGovernableStyle(
    claim: GovernedMemoryClaim,
    revision: PrototypeRevision,
    vaultKey: string,
    receipt: PrototypeStyleAuthorization | undefined,
): boolean {
    const style = parsePrototypeStyle(revision.writingStyle);
    return Boolean(style && receipt
        && [claim.id, revision.id, vaultKey].every((value) => hostId.safeParse(value).success)
        && claim.memoryType === "preference" && claim.sensitivity === "low"
        && claim.effect === "future_answers" && claim.applicability.kind === "custom"
        && claim.partition.kind === "vault" && claim.partition.key === vaultKey
        && claim.activeRevisionId === revision.id && revision.claimId === claim.id
        && (revision.authority === "explicit_user" || revision.authority === "user_correction")
        && revision.provenance.length > 0
        && receipt.actionId === style.explicitActionId
        && receipt.claimId === claim.id && receipt.revisionId === revision.id
        && receipt.vaultKey === vaultKey && receipt.writingVersionId === style.writingVersionId
        && receipt.textHash === style.textHash && receipt.payloadHash === hashStylePayload(style));
}

export interface PrototypeStyleCandidate {
    claim: GovernedMemoryClaim;
    revision: PrototypeRevision;
    vaultKey: string;
    receipt?: PrototypeStyleAuthorization;
    currentScene?: PrototypeWritingScene;
    sourceAllowed: boolean;
    dataBoundaryAllowed: boolean;
    hasPendingOperation: boolean;
    suppressed: boolean;
    currentInstructionConflicts: boolean;
}

function renderEligibleStyle(input: PrototypeStyleCandidate): string | null {
    if (!isStaticallyGovernableStyle(input.claim, input.revision, input.vaultKey, input.receipt)
        || input.claim.lifecycle !== "active" || !input.sourceAllowed || !input.dataBoundaryAllowed
        || input.hasPendingOperation || input.suppressed || input.currentInstructionConflicts) return null;
    const style = input.revision.writingStyle!;
    const current = sceneSchema.safeParse(input.currentScene);
    if (!current.success || !Object.keys(style.scene).every((key) => (
        style.scene[key as keyof PrototypeWritingScene] === current.data[key as keyof PrototypeWritingScene]
    ))) return null;
    // JSON escapes prevent closing-tag text inside a sample from becoming a
    // wrapper boundary. The exact value survives JSON decoding.
    const body = JSON.stringify({
        kind: "writing_style_example", revisionId: input.revision.id,
        writingVersionId: style.writingVersionId, textHash: style.textHash,
        scene: style.scene, exactText: style.exactText,
    }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    return `<writing_style_context context_only="true" grants_action_authority="false">${body}</writing_style_context>`;
}

export interface PrototypeStyleBudget {
    /** Remaining space after existing Memory wrappers, claims and separators. */
    sharedRemainingChars: number;
    /** Remaining space after every other actual request block and separator. */
    turnRemainingChars: number;
}

/**
 * The host supplies most-specific/newest-explicit-choice ordering. This selector
 * preserves that stable order, skips complete examples that do not fit, and
 * reports that outcome instead of truncating text or claiming every saved style
 * was used. Callers may not reset the allowance for each example.
 */
export function projectPrototypeStyles(input: PrototypeStyleBudget & {
    rankedCandidates: readonly PrototypeStyleCandidate[];
}): {
    context: string;
    usedRevisionIds: string[];
    skipped: Array<{ revisionId: string; reason: "ineligible" | "budget" | "invalid_budget" | "duplicate" }>;
} {
    const result: ReturnType<typeof projectPrototypeStyles> = { context: "", usedRevisionIds: [], skipped: [] };
    const validBudget = [input.sharedRemainingChars, input.turnRemainingChars]
        .every((value) => Number.isFinite(value) && value >= 0);
    if (!validBudget) {
        result.skipped = input.rankedCandidates.map(({ revision }) => ({ revisionId: revision.id, reason: "invalid_budget" }));
        return result;
    }
    const allowance = Math.floor(Math.min(PROTOTYPE_STYLE_CONTEXT_CHARS,
        input.sharedRemainingChars, input.turnRemainingChars));
    const seen = new Set<string>();
    for (const candidate of input.rankedCandidates) {
        const revisionId = candidate.revision.id;
        if (seen.has(revisionId)) {
            result.skipped.push({ revisionId, reason: "duplicate" });
            continue;
        }
        seen.add(revisionId);
        const rendered = renderEligibleStyle(candidate);
        if (rendered === null) {
            result.skipped.push({ revisionId, reason: "ineligible" });
            continue;
        }
        const separator = result.context.length > 0 ? "\n" : "";
        if (result.context.length + separator.length + rendered.length > allowance) {
            result.skipped.push({ revisionId, reason: "budget" });
            continue;
        }
        result.context += separator + rendered;
        result.usedRevisionIds.push(revisionId);
    }
    return result;
}

export function projectPrototypeStyle(input: PrototypeStyleCandidate & PrototypeStyleBudget): string | null {
    return projectPrototypeStyles({ ...input, rankedCandidates: [input] }).context || null;
}

export type PrototypeHostMessageKind = "ordinary_user_statement" | "ai_draft"
    | "user_local_edit" | "current_writing_request" | "save_event" | "explicit_style_action";
export interface PrototypeHostEvidence {
    messageId: string;
    conversationId: string;
    kind: PrototypeHostMessageKind;
}
// IDs are supplied by the host-owned extraction slice. Model-selected IDs
// alone cannot attest which messages actually support a lasting preference.
export type PrototypeBoundCandidate = UserProfileCandidate & { sourceMessageIds: string[] };

/** The same gate must be called before BOTH governed admission and legacy merge.
 * Explicit style actions use the typed host flow; they never enter global Type A.
 * This does not infer candidate provenance from candidate.kind or wording.
 */
export function filterPrototypeProfileCandidates(
    candidates: readonly PrototypeBoundCandidate[],
    hostEvidence: ReadonlyMap<string, PrototypeHostEvidence>,
): PrototypeBoundCandidate[] {
    return candidates.filter((candidate) => candidate.sourceMessageIds.length > 0
        && candidate.sourceMessageIds.every((id) => {
            const evidence = hostEvidence.get(id);
            return evidence?.kind === "ordinary_user_statement"
                && evidence.conversationId === candidate.conversationId;
        }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
