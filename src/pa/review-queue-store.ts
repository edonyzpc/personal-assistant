import {
    hasForbiddenPersistedTextFields,
    isActiveReviewQueueProducerType,
    isReviewQueueAdmissionReason,
    validateSourceRefPathShape,
    validateReviewQueueItemBase,
    type PersistedSourceRef,
    type ReviewQueueAdmissionReason,
    type ReviewQueueItemBase,
    type ReviewQueueItemType,
    type ReviewQueueOriginSurface,
    type ReviewQueuePriority,
    type ReviewQueueScope,
    type ReviewQueueStatus,
} from "./contracts";
import { normalizeVaultPath, isRecord, cloneSourceRef, cloneScope } from "./helpers";
import {
    reviewQueueAdmissionReasonForItem,
    reviewQueueItemHasUserIntentOrDurableConsequence,
} from "./review-artifact-lifecycle";

export interface ReviewQueueItem extends ReviewQueueItemBase {
    title: string;
    claim: string;
    metadata?: Record<string, string | number | boolean | null>;
    snoozedUntil?: string;
}

export interface ReviewQueueState {
    items: ReviewQueueItem[];
}

export interface ReviewQueueCreateInput {
    type: ReviewQueueItemType;
    title: string;
    claim: string;
    scope: ReviewQueueScope;
    sourceRefs: PersistedSourceRef[];
    originSurface: ReviewQueueOriginSurface;
    priority?: ReviewQueuePriority;
    whyShown?: string[];
    dataBoundarySnapshotId: string;
    admissionReason: Exclude<ReviewQueueAdmissionReason, "legacy_pre_refactor">;
    replayRef?: string;
    metadata?: Record<string, string | number | boolean | null>;
}

export interface ReviewQueueListFilter {
    types?: readonly ReviewQueueItemType[];
    statuses?: readonly ReviewQueueStatus[];
    admissionReasons?: readonly ReviewQueueAdmissionReason[];
    scopePaths?: readonly string[];
}

export const REVIEW_QUEUE_TAB_GROUPS = [
    "needs_decision",
    "ready_to_apply",
    "recently_applied",
    "snoozed",
    "stale",
] as const;

export type ReviewQueueTabGroup = typeof REVIEW_QUEUE_TAB_GROUPS[number];

export interface ReviewQueueGroupedItems {
    group: ReviewQueueTabGroup;
    items: ReviewQueueItem[];
}

export type ReviewQueueResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string };

export interface ReviewQueueStoreOptions {
    items?: readonly ReviewQueueItem[];
    now?: () => Date;
    persist?: (state: ReviewQueueState) => Promise<void> | void;
    idFactory?: () => string;
}

const VALID_STATUS_TRANSITIONS: Record<ReviewQueueStatus, readonly ReviewQueueStatus[]> = {
    suggested: ["accepted", "applied", "dismissed", "snoozed", "expired"],
    accepted: ["applied", "dismissed", "edited", "snoozed"],
    edited: ["applied", "dismissed", "snoozed"],
    applied: ["undone", "failed"],
    dismissed: ["suggested"],
    snoozed: ["suggested", "dismissed", "expired"],
    expired: ["suggested"],
    failed: ["suggested", "dismissed"],
    undone: ["suggested", "dismissed"],
};

const SOURCE_BACKED_TYPES = new Set<ReviewQueueItemType>([
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
]);

const ADMISSION_REASONS_BY_TYPE: Readonly<Record<ReviewQueueItemType, readonly ReviewQueueAdmissionReason[]>> = {
    evidence_insight: ["user_kept_for_later"],
    memory_candidate: ["memory_confirmation_required"],
    memory_conflict: ["memory_confirmation_required", "conflict_resolution_required"],
    maintenance_proposal: ["maintenance_action_ready", "user_kept_for_later", "user_initiated_action_recovery_required"],
    capture_enrichment: ["user_kept_for_later"],
    task_suggestion: ["task_confirmation_required"],
    recall_suggestion: ["user_kept_for_later"],
    related_note: ["user_kept_for_later"],
    theme_chain: ["user_kept_for_later"],
    conflict_pair: ["conflict_resolution_required", "user_kept_for_later"],
    index_note_candidate: ["user_kept_for_later"],
    review_summary: ["user_kept_for_later"],
    broad_scan_plan: ["user_initiated_action_recovery_required"],
    action_log: ["user_initiated_action_recovery_required"],
};

const MAX_QUEUE_SIZE = 200;
const EVICTABLE_STATUSES = new Set<ReviewQueueStatus>(["dismissed", "expired", "failed"]);

export class ReviewQueueStore {
    private items: ReviewQueueItem[];
    private readonly now: () => Date;
    private readonly persist?: (state: ReviewQueueState) => Promise<void> | void;
    private readonly idFactory: () => string;

    constructor(options: ReviewQueueStoreOptions = {}) {
        this.items = normalizeReviewQueueItems(options.items ?? []);
        this.now = options.now ?? (() => new Date());
        this.persist = options.persist;
        this.idFactory = options.idFactory ?? (() => `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        this.evictIfNeeded();
    }

    private evictIfNeeded(): void {
        if (this.items.length <= MAX_QUEUE_SIZE) return;
        const keep: ReviewQueueItem[] = [];
        const evictable: ReviewQueueItem[] = [];
        for (const item of this.items) {
            (EVICTABLE_STATUSES.has(item.status) ? evictable : keep).push(item);
        }
        evictable.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        const budget = MAX_QUEUE_SIZE - keep.length;
        this.items = [...keep, ...evictable.slice(Math.max(0, evictable.length - budget))];
    }

    snapshot(): ReviewQueueState {
        return { items: this.items.map(cloneItem) };
    }

    list(filter: ReviewQueueListFilter = {}): ReviewQueueItem[] {
        const types = filter.types ? new Set(filter.types) : null;
        const statuses = filter.statuses ? new Set(filter.statuses) : null;
        const admissionReasons = filter.admissionReasons ? new Set(filter.admissionReasons) : null;
        const scopePaths = filter.scopePaths
            ? new Set(filter.scopePaths.map(normalizeVaultPath))
            : null;
        return this.items
            .filter((item) => !types || types.has(item.type))
            .filter((item) => !statuses || statuses.has(item.status))
            .filter((item) => !admissionReasons || admissionReasons.has(reviewQueueAdmissionReasonForItem(item)))
            .filter((item) => !scopePaths || itemMatchesScopePaths(item, scopePaths))
            .map(cloneItem);
    }

    async create(input: ReviewQueueCreateInput): Promise<ReviewQueueResult<ReviewQueueItem>> {
        const validation = validateCreateInput(input);
        if (!validation.ok) return validation;

        const now = this.now().toISOString();
        const item: ReviewQueueItem = {
            id: this.idFactory(),
            type: input.type,
            title: input.title.trim(),
            claim: input.claim.trim(),
            scope: cloneScope(input.scope),
            sourceRefs: input.sourceRefs.map(cloneSourceRef),
            originSurface: input.originSurface,
            priority: input.priority ?? "normal",
            status: "suggested",
            createdAt: now,
            updatedAt: now,
            whyShown: [...(input.whyShown ?? [])],
            dataBoundarySnapshotId: input.dataBoundarySnapshotId,
            admissionReason: input.admissionReason,
        };
        if (input.replayRef) item.replayRef = input.replayRef;
        if (input.metadata) item.metadata = { ...input.metadata };

        const itemValidation = validateReviewQueueItem(item);
        if (!itemValidation.ok) return itemValidation;

        const duplicate = this.items.find((existing) => isDuplicateItem(existing, item));
        if (duplicate && shouldPreserveDuplicateStatus(duplicate.status)) {
            return { ok: true, value: cloneItem(duplicate) };
        }
        this.items = [item, ...this.items.filter((existing) => !isDuplicateItem(existing, item))];
        this.evictIfNeeded();
        await this.flush();
        return { ok: true, value: cloneItem(item) };
    }

    async updateStatus(
        id: string,
        status: ReviewQueueStatus,
        options: { snoozedUntil?: string } = {},
    ): Promise<ReviewQueueResult<ReviewQueueItem>> {
        const index = this.items.findIndex((item) => item.id === id);
        if (index < 0) return { ok: false, reason: "not_found" };
        const current = this.items[index];
        const allowed = VALID_STATUS_TRANSITIONS[current.status];
        if (!allowed || !allowed.includes(status)) {
            return { ok: false, reason: `invalid_transition_${current.status}_to_${status}` };
        }
        const item = cloneItem(current);
        item.status = status;
        item.updatedAt = this.now().toISOString();
        if (status === "snoozed" && options.snoozedUntil) {
            item.snoozedUntil = options.snoozedUntil;
        } else {
            delete item.snoozedUntil;
        }
        this.items[index] = item;
        await this.flush();
        return { ok: true, value: cloneItem(item) };
    }

    dismiss(id: string): Promise<ReviewQueueResult<ReviewQueueItem>> {
        return this.updateStatus(id, "dismissed");
    }

    snooze(id: string, until: string): Promise<ReviewQueueResult<ReviewQueueItem>> {
        return this.updateStatus(id, "snoozed", { snoozedUntil: until });
    }

    private async flush(): Promise<void> {
        await this.persist?.(this.snapshot());
    }
}

export function normalizeReviewQueueState(value: unknown): ReviewQueueState {
    if (!isRecord(value)) return { items: [] };
    return { items: normalizeReviewQueueItems(value.items) };
}

export function validateReviewQueueItem(item: ReviewQueueItem): ReviewQueueResult<ReviewQueueItem> {
    const base = validateReviewQueueItemBase(item);
    if (!base.ok) return { ok: false, reason: base.reason };
    if (typeof item.title !== "string" || item.title.trim().length === 0) {
        return { ok: false, reason: "missing_title" };
    }
    if (typeof item.claim !== "string" || item.claim.trim().length === 0) {
        return { ok: false, reason: "missing_claim" };
    }
    if (hasForbiddenPersistedTextFields(item)) {
        return { ok: false, reason: "forbidden_persisted_text" };
    }
    for (const sourceRef of item.sourceRefs) {
        const sourceValidation = validateSourceRefPathShape(sourceRef);
        if (!sourceValidation.ok) return { ok: false, reason: `invalid_source_ref_${sourceValidation.reason}` };
    }
    return { ok: true, value: cloneItem(item) };
}

function validateCreateInput(input: ReviewQueueCreateInput): ReviewQueueResult<ReviewQueueItem> {
    if (!isActiveReviewQueueProducerType(input.type)) {
        return { ok: false, reason: "type_not_active" };
    }
    if (!isReviewQueueAdmissionReason(input.admissionReason)) {
        return { ok: false, reason: "missing_admission_reason" };
    }
    if (!reviewQueueAdmissionReasonAllowedForType(input.type, input.admissionReason)) {
        return { ok: false, reason: "admission_reason_not_allowed" };
    }
    if (SOURCE_BACKED_TYPES.has(input.type) && input.sourceRefs.length === 0) {
        return { ok: false, reason: "missing_source_refs" };
    }
    if (!reviewQueueItemHasUserIntentOrDurableConsequence(input)) {
        return { ok: false, reason: "missing_durable_consequence" };
    }
    if (hasForbiddenPersistedTextFields(input)) {
        return { ok: false, reason: "forbidden_persisted_text" };
    }
    return { ok: true, value: undefined as never };
}

function reviewQueueAdmissionReasonAllowedForType(
    type: ReviewQueueItemType,
    admissionReason: ReviewQueueAdmissionReason,
): boolean {
    return ADMISSION_REASONS_BY_TYPE[type].includes(admissionReason);
}

export function reviewQueueTabGroupForStatus(status: ReviewQueueStatus): ReviewQueueTabGroup {
    switch (status) {
        case "suggested":
        case "failed":
            return "needs_decision";
        case "accepted":
        case "edited":
            return "ready_to_apply";
        case "applied":
        case "undone":
            return "recently_applied";
        case "snoozed":
            return "snoozed";
        case "dismissed":
        case "expired":
            return "stale";
    }
}

export function groupReviewQueueItemsForTab(items: readonly ReviewQueueItem[]): ReviewQueueGroupedItems[] {
    const groups = new Map<ReviewQueueTabGroup, ReviewQueueItem[]>();
    for (const item of items) {
        const group = reviewQueueTabGroupForStatus(item.status);
        const current = groups.get(group) ?? [];
        current.push(cloneItem(item));
        groups.set(group, current);
    }
    return REVIEW_QUEUE_TAB_GROUPS
        .filter((group) => groups.has(group))
        .map((group) => ({ group, items: groups.get(group) ?? [] }));
}

function normalizeReviewQueueItems(value: unknown): ReviewQueueItem[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isRecord)
        .map(normalizePersistedReviewQueueItem)
        .filter((item) => validateReviewQueueItem(item).ok)
        .map(cloneItem);
}

function normalizePersistedReviewQueueItem(entry: Record<string, unknown>): ReviewQueueItem {
    const item = { ...entry } as unknown as ReviewQueueItem;
    if (!isReviewQueueAdmissionReason(item.admissionReason)) {
        item.admissionReason = "legacy_pre_refactor";
        item.metadata = {
            ...(isRecord(item.metadata) ? item.metadata as Record<string, string | number | boolean | null> : {}),
            legacyPreRefactor: true,
        };
    }
    return item;
}

function itemMatchesScopePaths(item: ReviewQueueItem, scopePaths: Set<string>): boolean {
    const itemPaths = new Set<string>();
    for (const path of item.scope.paths ?? []) itemPaths.add(normalizeVaultPath(path));
    for (const ref of item.sourceRefs) itemPaths.add(normalizeVaultPath(ref.path));
    for (const path of itemPaths) {
        if (scopePaths.has(path)) return true;
    }
    return false;
}

function isDuplicateItem(a: ReviewQueueItem, b: ReviewQueueItem): boolean {
    return a.type === b.type
        && a.claim === b.claim
        && a.scope.kind === b.scope.kind
        && JSON.stringify(a.scope.paths ?? []) === JSON.stringify(b.scope.paths ?? [])
        && JSON.stringify(a.sourceRefs.map((ref) => ref.path).sort()) === JSON.stringify(b.sourceRefs.map((ref) => ref.path).sort());
}

function shouldPreserveDuplicateStatus(status: ReviewQueueStatus): boolean {
    return status !== "suggested" && status !== "failed";
}

function cloneItem(item: ReviewQueueItem): ReviewQueueItem {
    const clone: ReviewQueueItem = {
        ...item,
        scope: cloneScope(item.scope),
        sourceRefs: item.sourceRefs.map(cloneSourceRef),
        whyShown: [...item.whyShown],
    };
    if (item.metadata) clone.metadata = { ...item.metadata };
    return clone;
}

