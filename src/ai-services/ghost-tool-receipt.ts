import type { ChatToolResult } from "./chat-types";
import { ghostOperationFactsSchema, type GhostOperationFacts } from "../ghost-publishing/state-schema";

/** Closed, source-free text shared by the tool and its history admission readers. */
export const GHOST_PREPARATION_MESSAGES = {
    prepared: "A draft or update preview is saved. Preparation is complete. Open its publishing card to review, then publish a draft in Ghost or confirm a published article's update in PA. This does not confirm publication. Do not repeat preparation just to verify this result.",
    outcome_unknown: "The preparation result is unknown. Preserve the operation identity; if this receipt allows retry, the same authorized request may call prepare_ghost_post again sequentially so the Ghost owner can verify and continue. Do not claim it was published.",
    saved_attention: "The Ghost content was saved, but a follow-up step needs attention. Use the saved article shown in the card; do not create another draft.",
    failed_attention: "Preparation did not finish. Read the publishing card for the specific failure and advice; publication has not been confirmed.",
    site_upload_limit: "An image file exceeds the configured per-file upload limit. resource.role describes the image's placement, not article text. Reduce or replace that image.",
} as const;

export const GHOST_METADATA_FAILURE_MESSAGES = {
    "metadata-unavailable": "Article metadata preparation is unavailable. No Ghost post or image writes were started. Check the text AI settings or fill in the missing metadata. This result does not diagnose Ghost authentication or site configuration.",
    "metadata-invalid": "The article or required metadata is invalid for preparation. No Ghost post or image writes were started. Check the article and its required metadata. This result does not diagnose Ghost authentication or site configuration.",
    provider_failure: "The configured text AI request failed while preparing article metadata. No Ghost post or image writes were started. Check the text AI settings or fill in the missing metadata. This result does not diagnose Ghost authentication or site configuration.",
    input_too_large: "The article exceeds the text AI model input limit for metadata preparation. No Ghost post or image writes were started. Use a model with more input capacity or fill in the missing metadata. This result does not diagnose Ghost authentication or site configuration.",
    invalid_result: "Automatic article metadata generation ran, but the text AI returned output that failed validation. No Ghost post or image writes were started. Missing user metadata did not prevent automatic generation. Ask the user to explicitly retry preparation or optionally supply the missing metadata. This result does not diagnose Ghost authentication or site configuration.",
} as const;

export type GhostMetadataFailureReason = keyof typeof GHOST_METADATA_FAILURE_MESSAGES;

const LEGACY_PREPARED_MESSAGE = "A draft or update preview is saved. Open its publishing card to review and choose the human publishing action.";
const LEGACY_METADATA_FAILURE_MESSAGES: Partial<Record<GhostMetadataFailureReason, string>> = {
    "metadata-unavailable": "Article metadata preparation is unavailable. No Ghost post or image writes were started. Check the text AI settings or fill in the missing summary, SEO description, and slug. This result does not diagnose Ghost authentication or site configuration.",
    "metadata-invalid": "The article or required metadata is invalid for preparation. No Ghost post or image writes were started. Check the article and its summary, SEO description, and slug. This result does not diagnose Ghost authentication or site configuration.",
    invalid_result: "The text AI returned unusable article metadata. No Ghost post or image writes were started. Fill in the missing summary, SEO description, and slug. This result does not diagnose Ghost authentication or site configuration.",
};

export function ghostMetadataFailureReason(value: unknown): GhostMetadataFailureReason | undefined {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(GHOST_METADATA_FAILURE_MESSAGES, value)
        ? value as GhostMetadataFailureReason : undefined;
}

export function ghostPreparationMessage(status: unknown, executionState: unknown, failureReason?: unknown, facts?: unknown): string | undefined {
    if (failureReason !== undefined) {
        const reason = ghostMetadataFailureReason(failureReason);
        return reason && status === "needs_attention" && executionState === "not_started"
            ? GHOST_METADATA_FAILURE_MESSAGES[reason] : undefined;
    }
    if (status === "needs_attention" && (executionState === "not_started" || executionState === "failed")
        && isGhostOperationFacts(facts) && facts.reason === "site-upload-limit") {
        return GHOST_PREPARATION_MESSAGES.site_upload_limit;
    }
    if (status === "prepared" && executionState === "succeeded") return GHOST_PREPARATION_MESSAGES.prepared;
    if (status === "outcome_unknown" && executionState === "acceptance_unknown") return GHOST_PREPARATION_MESSAGES.outcome_unknown;
    if (status === "needs_attention") {
        if (executionState === "succeeded") return GHOST_PREPARATION_MESSAGES.saved_attention;
        if (executionState === "not_started" || executionState === "failed") return GHOST_PREPARATION_MESSAGES.failed_attention;
    }
    return undefined;
}

export function isGhostOperationFacts(value: unknown): value is GhostOperationFacts {
    return ghostOperationFactsSchema.safeParse(value).success;
}

function isTransientGhostSourceFailure(facts: GhostOperationFacts): boolean {
    if (facts.stage !== "source") return false;
    if (facts.reason === "network" || facts.reason === "timeout") return true;
    const httpStatus = facts.httpStatus;
    return facts.reason === "http"
        && httpStatus !== undefined
        && (httpStatus === 408 || httpStatus === 429
            || httpStatus >= 500 && httpStatus <= 599);
}

/** Owner facts decide whether the same authorized request may submit again. */
export function isGhostPreparationRetryAllowed(
    status: unknown,
    executionState: unknown,
    failureReason?: unknown,
    facts?: unknown,
): boolean {
    if (status === "outcome_unknown" || executionState === "failed") return true;
    if (status !== "needs_attention" || executionState !== "not_started") return false;
    if (failureReason !== undefined) return true;
    if (!isGhostOperationFacts(facts)) return false;
    return ["metadata", "resource", "image-upload", "post-save"].includes(facts.stage)
        || isTransientGhostSourceFailure(facts);
}

/** Current receipts expose retry; older transient source receipts may conservatively need only the user. */
export function hasGhostPreparationRecoveryActions(
    status: unknown,
    executionState: unknown,
    failureReason: unknown,
    facts: unknown,
    actions: unknown,
): boolean {
    const matches = (value: unknown, expected: string[]) => Array.isArray(value)
        && value.length === expected.length && value.every((action, index) => action === expected[index]);
    const retryAllowed = isGhostPreparationRetryAllowed(status, executionState, failureReason, facts);
    if (matches(actions, retryAllowed ? ["retry", "needs_user"] : ["needs_user"])) return true;
    return retryAllowed && isGhostOperationFacts(facts) && isTransientGhostSourceFailure(facts)
        && matches(actions, ["needs_user"]);
}

/** Previously persisted closed receipts remain readable after copy corrections. */
export function isGhostPreparationMessage(status: unknown, executionState: unknown, message: unknown, failureReason?: unknown, facts?: unknown): boolean {
    const current = ghostPreparationMessage(status, executionState, failureReason, facts);
    const reason = ghostMetadataFailureReason(failureReason);
    const legacy = reason ? LEGACY_METADATA_FAILURE_MESSAGES[reason] : undefined;
    return current !== undefined && (message === current
        || status === "prepared" && executionState === "succeeded" && failureReason === undefined && message === LEGACY_PREPARED_MESSAGE
        || failureReason === undefined && isGhostOperationFacts(facts)
            && status === "needs_attention" && (executionState === "not_started" || executionState === "failed")
            && message === GHOST_PREPARATION_MESSAGES.failed_attention
        || legacy !== undefined && message === legacy);
}

/** Only this closed owner receipt can outlive source observation freshness. */
export function isGhostPreparationResult(result: ChatToolResult<unknown>): boolean {
    const allowed = ["ok", "tool", "inputSummary", "content", "sources", "sourceRecords", "resultFact", "executionState", "recovery"];
    const record = result as unknown as Record<string, unknown>;
    if (Object.keys(result).some(key => record[key] !== undefined && !allowed.includes(key))
        || result.ok !== true || result.tool !== "prepare_ghost_post" || result.inputSummary !== "prepare"
        || result.executionState !== "succeeded" || !Array.isArray(result.sources) || result.sources.length !== 0
        || result.sourceRecords !== undefined && (!Array.isArray(result.sourceRecords) || result.sourceRecords.length !== 0)) return false;
    const content = result.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) return false;
    const value = content as Record<string, unknown>;
    if (Object.keys(value).some(key => !["status", "operationId", "message", "facts"].includes(key))
        || value.status !== "prepared" && value.status !== "needs_attention"
        || typeof value.operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId)
        || !isGhostPreparationMessage(value.status, result.executionState, value.message, undefined, value.facts)
        || value.facts !== undefined && !isGhostOperationFacts(value.facts)) return false;
    const recovery = result.recovery;
    if (value.status === "prepared") {
        if (recovery !== undefined) return false;
    } else if (!recovery || Object.keys(recovery).length !== 3
        || recovery.code !== "ghost_attention_required" || recovery.operationId !== value.operationId
        || !Array.isArray(recovery.allowedActions) || recovery.allowedActions.length !== 1
        || recovery.allowedActions[0] !== "needs_user") return false;
    const fact = result.resultFact;
    return fact?.kind === "approval_pending" && fact.intentId === value.operationId
        && Object.keys(fact).length === 2;
}
