import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type PersistedSourceRef,
    type ReviewQueueScope,
} from "./contracts";
import { isRecord, includesString, normalizeVaultPath, cloneSourceRef, cloneScope } from "./helpers";

export const SAVED_INSIGHT_TYPES = ["observation", "theme", "tension", "question", "decision", "opportunity"] as const;
export type SavedInsightType = typeof SAVED_INSIGHT_TYPES[number];

export const SAVED_INSIGHT_ORIGINS = ["user-authored", "pa-generated", "pa-recommended", "imported"] as const;
export type SavedInsightOrigin = typeof SAVED_INSIGHT_ORIGINS[number];

export const SAVED_INSIGHT_STATUSES = ["active", "archived", "promoted"] as const;
export type SavedInsightStatus = typeof SAVED_INSIGHT_STATUSES[number];

export interface SavedInsight {
    id: string;
    type: SavedInsightType;
    text: string;
    origin: SavedInsightOrigin;
    sourceRefs: PersistedSourceRef[];
    whyShown: string[];
    scope: ReviewQueueScope;
    status: SavedInsightStatus;
    influencePolicy: "weak-only";
    createdAt: string;
    updatedAt: string;
    dataBoundarySnapshotId?: string;
    replayRef?: string;
    promotedTo?: string;
}

export interface SavedInsightCreateInput {
    type: SavedInsightType;
    text: string;
    origin: SavedInsightOrigin;
    sourceRefs?: PersistedSourceRef[];
    whyShown?: string[];
    scope?: ReviewQueueScope;
    dataBoundarySnapshotId?: string;
    replayRef?: string;
}

export interface SavedInsightState {
    items: SavedInsight[];
}

export type SavedInsightResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string };

export interface SavedInsightListFilter {
    types?: readonly SavedInsightType[];
    statuses?: readonly SavedInsightStatus[];
    scopePaths?: readonly string[];
}

export interface SavedInsightStoreOptions {
    items?: readonly SavedInsight[];
    now?: () => Date;
    persist?: (state: SavedInsightState) => Promise<void> | void;
    idFactory?: () => string;
}

function cloneInsight(insight: SavedInsight): SavedInsight {
    return {
        ...insight,
        sourceRefs: insight.sourceRefs.map(cloneSourceRef),
        whyShown: [...insight.whyShown],
        scope: cloneScope(insight.scope),
    };
}

function matchesScopePaths(insight: SavedInsight, scopePaths: Set<string>): boolean {
    const paths = [
        ...(insight.scope.paths ?? []),
        ...insight.sourceRefs.map((ref) => ref.path),
    ].map(normalizeVaultPath);
    return paths.some((path) => scopePaths.has(path));
}

function validateSavedInsight(insight: SavedInsight): SavedInsightResult<SavedInsight> {
    if (!includesString(SAVED_INSIGHT_TYPES, insight.type)) return { ok: false, reason: "invalid_type" };
    if (!includesString(SAVED_INSIGHT_ORIGINS, insight.origin)) return { ok: false, reason: "invalid_origin" };
    if (!includesString(SAVED_INSIGHT_STATUSES, insight.status)) return { ok: false, reason: "invalid_status" };
    if (insight.text.trim().length === 0) return { ok: false, reason: "missing_text" };
    if (insight.influencePolicy !== "weak-only") return { ok: false, reason: "invalid_influence_policy" };
    if (insight.origin !== "user-authored" && insight.sourceRefs.length === 0) {
        return { ok: false, reason: "missing_source_refs" };
    }
    for (const sourceRef of insight.sourceRefs) {
        const sourceValidation = validateSourceRefPathShape(sourceRef);
        if (!sourceValidation.ok) return { ok: false, reason: `invalid_source_ref_${sourceValidation.reason}` };
    }
    if (hasForbiddenPersistedTextFields(insight.sourceRefs)) return { ok: false, reason: "forbidden_source_text" };
    return { ok: true, value: cloneInsight(insight) };
}

function normalizeSavedInsights(value: unknown): SavedInsight[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isRecord)
        .map((entry) => entry as unknown as SavedInsight)
        .filter((entry) => validateSavedInsight(entry).ok)
        .map(cloneInsight);
}

export function normalizeSavedInsightState(value: unknown): SavedInsightState {
    if (!isRecord(value)) return { items: [] };
    return { items: normalizeSavedInsights(value.items) };
}

export class SavedInsightStore {
    private items: SavedInsight[];
    private readonly now: () => Date;
    private readonly persist?: (state: SavedInsightState) => Promise<void> | void;
    private readonly idFactory: () => string;

    constructor(options: SavedInsightStoreOptions = {}) {
        this.items = normalizeSavedInsights(options.items ?? []);
        this.now = options.now ?? (() => new Date());
        this.persist = options.persist;
        this.idFactory = options.idFactory ?? (() => `ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    }

    snapshot(): SavedInsightState {
        return { items: this.items.map(cloneInsight) };
    }

    list(filter: SavedInsightListFilter = {}): SavedInsight[] {
        const types = filter.types ? new Set(filter.types) : null;
        const statuses = filter.statuses ? new Set(filter.statuses) : null;
        const scopePaths = filter.scopePaths ? new Set(filter.scopePaths.map(normalizeVaultPath)) : null;
        return this.items
            .filter((item) => !types || types.has(item.type))
            .filter((item) => !statuses || statuses.has(item.status))
            .filter((item) => !scopePaths || matchesScopePaths(item, scopePaths))
            .map(cloneInsight);
    }

    async create(input: SavedInsightCreateInput): Promise<SavedInsightResult<SavedInsight>> {
        const now = this.now().toISOString();
        const insight: SavedInsight = {
            id: this.idFactory(),
            type: input.type,
            text: input.text.trim(),
            origin: input.origin,
            sourceRefs: (input.sourceRefs ?? []).map(cloneSourceRef),
            whyShown: [...(input.whyShown ?? [])],
            scope: input.scope ? cloneScope(input.scope) : { kind: "custom", label: "Insight Ledger" },
            status: "active",
            influencePolicy: "weak-only",
            createdAt: now,
            updatedAt: now,
        };
        if (input.dataBoundarySnapshotId) insight.dataBoundarySnapshotId = input.dataBoundarySnapshotId;
        if (input.replayRef) insight.replayRef = input.replayRef;
        const validation = validateSavedInsight(insight);
        if (!validation.ok) return validation;
        this.items = [insight, ...this.items];
        await this.flush();
        return { ok: true, value: cloneInsight(insight) };
    }

    async archive(id: string): Promise<SavedInsightResult<SavedInsight>> {
        return this.updateStatus(id, "archived");
    }

    async restore(id: string): Promise<SavedInsightResult<SavedInsight>> {
        return this.updateStatus(id, "active");
    }

    async promote(id: string, promotedTo: string): Promise<SavedInsightResult<SavedInsight>> {
        const index = this.items.findIndex((item) => item.id === id);
        if (index < 0) return { ok: false, reason: "not_found" };
        const item = cloneInsight(this.items[index]);
        item.status = "promoted";
        item.promotedTo = promotedTo;
        item.updatedAt = this.now().toISOString();
        this.items[index] = item;
        await this.flush();
        return { ok: true, value: cloneInsight(item) };
    }

    private async updateStatus(id: string, status: SavedInsightStatus): Promise<SavedInsightResult<SavedInsight>> {
        const index = this.items.findIndex((item) => item.id === id);
        if (index < 0) return { ok: false, reason: "not_found" };
        const item = cloneInsight(this.items[index]);
        item.status = status;
        item.updatedAt = this.now().toISOString();
        this.items[index] = item;
        await this.flush();
        return { ok: true, value: cloneInsight(item) };
    }

    private async flush(): Promise<void> {
        await this.persist?.(this.snapshot());
    }
}
