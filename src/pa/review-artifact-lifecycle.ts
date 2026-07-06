import {
    isReviewQueueAdmissionReason,
    type ReviewQueueAdmissionReason,
    type ReviewQueueItemBase,
    type ReviewQueueItemType,
    type ReviewQueueStatus,
} from "./contracts";

export type PaArtifactDisposition =
    | "discard"
    | "ephemeral_cue"
    | "digest_item"
    | "user_kept_queue_item"
    | "durable_confirmation"
    | "reversible_action";

export interface PaArtifactLifecycleInput {
    type: ReviewQueueItemType;
    sourceBacked: boolean;
    durableConsequence?: "none" | "saved_state" | "memory" | "vault_action" | "external_action";
    userKept?: boolean;
    confidence?: "low" | "medium" | "high";
    conflict?: boolean;
}

const READ_ONLY_TYPES = new Set<ReviewQueueItemType>([
    "evidence_insight",
    "recall_suggestion",
    "related_note",
    "theme_chain",
    "index_note_candidate",
    "review_summary",
    "capture_enrichment",
]);

const USER_KEPT_REASONS = new Set<ReviewQueueAdmissionReason>([
    "user_kept_for_later",
]);

const ACTION_BEARING_REASONS = new Set<ReviewQueueAdmissionReason>([
    "memory_confirmation_required",
    "task_confirmation_required",
    "maintenance_action_ready",
    "conflict_resolution_required",
    "user_initiated_action_recovery_required",
]);

export function classifyPaArtifactLifecycle(input: PaArtifactLifecycleInput): PaArtifactDisposition {
    if (!input.sourceBacked) return "discard";
    if (input.confidence === "low" && !input.userKept && input.durableConsequence === "none") {
        return "discard";
    }
    if (input.userKept) return "user_kept_queue_item";
    if (input.type === "memory_candidate" || input.type === "memory_conflict" || input.durableConsequence === "memory") {
        return "durable_confirmation";
    }
    if (input.type === "maintenance_proposal" || input.durableConsequence === "vault_action" || input.durableConsequence === "external_action") {
        return "reversible_action";
    }
    if (input.conflict || input.type === "conflict_pair") return "durable_confirmation";
    if (input.durableConsequence === "saved_state") return "durable_confirmation";
    if (READ_ONLY_TYPES.has(input.type)) return input.type === "review_summary" ? "digest_item" : "ephemeral_cue";
    return "digest_item";
}

export function reviewQueueAdmissionReasonForItem(item: Pick<ReviewQueueItemBase, "admissionReason">): ReviewQueueAdmissionReason {
    return isReviewQueueAdmissionReason(item.admissionReason)
        ? item.admissionReason
        : "legacy_pre_refactor";
}

export function reviewQueueItemHasUserIntentOrDurableConsequence(item: Pick<ReviewQueueItemBase, "admissionReason">): boolean {
    const reason = reviewQueueAdmissionReasonForItem(item);
    return USER_KEPT_REASONS.has(reason) || ACTION_BEARING_REASONS.has(reason);
}

export function reviewQueueItemIsLegacy(item: Pick<ReviewQueueItemBase, "admissionReason">): boolean {
    return reviewQueueAdmissionReasonForItem(item) === "legacy_pre_refactor";
}

export function isReviewQueueWeeklyCarryoverEligible(item: Pick<ReviewQueueItemBase, "admissionReason" | "status">): boolean {
    const status: ReviewQueueStatus = item.status;
    if (status === "dismissed" || status === "expired" || status === "undone" || status === "applied") return false;
    if (status === "failed") {
        return reviewQueueAdmissionReasonForItem(item) === "user_initiated_action_recovery_required";
    }
    if (status === "accepted" || status === "edited" || status === "snoozed") return true;
    return status === "suggested" && reviewQueueItemHasUserIntentOrDurableConsequence(item);
}
