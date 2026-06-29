import type { PersistedSourceRef } from "./source-ref";

export const REVIEW_QUEUE_ITEM_TYPES = [
    "evidence_insight",
    "memory_candidate",
    "memory_conflict",
    "maintenance_proposal",
    "capture_enrichment",
    "task_suggestion",
    "recall_suggestion",
    "related_note",
    "theme_chain",
    "conflict_pair",
    "index_note_candidate",
    "review_summary",
    "broad_scan_plan",
    "action_log",
] as const;

export type ReviewQueueItemType = typeof REVIEW_QUEUE_ITEM_TYPES[number];

export const RESERVED_NON_CANONICAL_REVIEW_QUEUE_TYPES = [
    "scope_state",
    "profile_fact",
    "insight_candidate",
    "saved_insight_candidate",
] as const;

export const ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES = [
    "evidence_insight",
    "capture_enrichment",
    "task_suggestion",
    "memory_candidate",
    "related_note",
    "theme_chain",
    "conflict_pair",
    "index_note_candidate",
    "maintenance_proposal",
] as const satisfies readonly ReviewQueueItemType[];

export const REVIEW_QUEUE_STATUSES = [
    "suggested",
    "accepted",
    "edited",
    "applied",
    "dismissed",
    "snoozed",
    "expired",
    "failed",
    "undone",
] as const;

export type ReviewQueueStatus = typeof REVIEW_QUEUE_STATUSES[number];

export const REVIEW_QUEUE_ADMISSION_REASONS = [
    "user_kept_for_later",
    "memory_confirmation_required",
    "task_confirmation_required",
    "maintenance_action_ready",
    "conflict_resolution_required",
    "user_initiated_action_recovery_required",
    "legacy_pre_refactor",
] as const;

export type ReviewQueueAdmissionReason = typeof REVIEW_QUEUE_ADMISSION_REASONS[number];

export const REVIEW_QUEUE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ReviewQueuePriority = typeof REVIEW_QUEUE_PRIORITIES[number];

export const REVIEW_QUEUE_ORIGIN_SURFACES = [
    "chat",
    "pagelet",
    "weekly_scan",
    "memory",
    "maintenance",
    "quick_capture",
    "system",
] as const;

export type ReviewQueueOriginSurface = typeof REVIEW_QUEUE_ORIGIN_SURFACES[number];

export const REVIEW_QUEUE_SCOPE_KINDS = [
    "current_note",
    "folder",
    "tag",
    "selected_notes",
    "whole_vault",
    "custom",
] as const;

export type ReviewQueueScopeKind = typeof REVIEW_QUEUE_SCOPE_KINDS[number];

export interface ReviewQueueScope {
    kind: ReviewQueueScopeKind;
    label?: string;
    paths?: string[];
    tags?: string[];
}

export interface ReviewQueueItemBase {
    id: string;
    type: ReviewQueueItemType;
    scope: ReviewQueueScope;
    sourceRefs: PersistedSourceRef[];
    originSurface: ReviewQueueOriginSurface;
    priority: ReviewQueuePriority;
    status: ReviewQueueStatus;
    createdAt: string;
    updatedAt: string;
    whyShown: string[];
    dataBoundarySnapshotId: string;
    admissionReason?: ReviewQueueAdmissionReason;
    replayRef?: string;
}

export type ContractValidationResult =
    | { ok: true }
    | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function includesString<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
    return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isReviewQueueItemType(value: unknown): value is ReviewQueueItemType {
    return includesString(REVIEW_QUEUE_ITEM_TYPES, value);
}

export function isActiveReviewQueueProducerType(value: unknown): value is ReviewQueueItemType {
    return includesString(ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES, value);
}

export function isReviewQueueAdmissionReason(value: unknown): value is ReviewQueueAdmissionReason {
    return includesString(REVIEW_QUEUE_ADMISSION_REASONS, value);
}

export function validateReviewQueueItemBase(value: unknown, options: {
    requireActiveProducer?: boolean;
} = {}): ContractValidationResult {
    if (!isRecord(value)) return { ok: false, reason: "item_not_object" };
    if (!isReviewQueueItemType(value.type)) return { ok: false, reason: "invalid_type" };
    if (options.requireActiveProducer && !isActiveReviewQueueProducerType(value.type)) {
        return { ok: false, reason: "type_not_active" };
    }
    if (!includesString(REVIEW_QUEUE_STATUSES, value.status)) return { ok: false, reason: "invalid_status" };
    if (!includesString(REVIEW_QUEUE_PRIORITIES, value.priority)) return { ok: false, reason: "invalid_priority" };
    if (!includesString(REVIEW_QUEUE_ORIGIN_SURFACES, value.originSurface)) {
        return { ok: false, reason: "invalid_origin_surface" };
    }
    if (!isRecord(value.scope) || !includesString(REVIEW_QUEUE_SCOPE_KINDS, value.scope.kind)) {
        return { ok: false, reason: "invalid_scope" };
    }
    const requiredStrings = ["id", "createdAt", "updatedAt", "dataBoundarySnapshotId"] as const;
    for (const key of requiredStrings) {
        if (typeof value[key] !== "string" || value[key].length === 0) {
            return { ok: false, reason: `missing_${key}` };
        }
    }
    if (!Array.isArray(value.sourceRefs)) return { ok: false, reason: "missing_source_refs" };
    if (!Array.isArray(value.whyShown)) return { ok: false, reason: "missing_why_shown" };
    if (value.admissionReason !== undefined && !isReviewQueueAdmissionReason(value.admissionReason)) {
        return { ok: false, reason: "invalid_admission_reason" };
    }
    return { ok: true };
}
