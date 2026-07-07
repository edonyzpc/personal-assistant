import {
    MEMORY_SENSITIVITIES,
    MEMORY_TYPES,
    hasForbiddenPersistedTextFields,
    validateMemoryCandidate,
    validateMemoryLifecycleRecord,
    validateSourceRefPathShape,
    type MemoryCandidateContract,
    type MemoryLifecycleRecord,
    type MemoryType,
    type PersistedSourceRef,
    type ReviewQueueScope,
} from "./contracts";
import { decideContextFirewall } from "./context-firewall";
import { isRecord, includesString, cloneSourceRef, cloneScope } from "./helpers";
import type { ReviewQueueItem } from "./review-queue-store";

export interface ConfirmedMemoryRecord extends MemoryLifecycleRecord {
    scope: ReviewQueueScope;
    summary: string;
    sourceRefs: PersistedSourceRef[];
    createdAt: string;
    updatedAt: string;
    confirmedAt?: string;
    archivedAt?: string;
    forgottenAt?: string;
    validFrom?: string;
    validUntil?: string;
    lastVerified?: string;
    updatePolicy?: "manual-only" | "suggest-update-on-conflict" | "expire-after-date" | "refresh-on-scope-review" | "ask-before-cross-scope-use";
    confirmationStrength?: "light" | "explicit" | "special" | "auto";
    confirmationSource?: "pagelet" | "weekly_review" | "chat" | "memory_panel";
}

export interface MemoryGovernanceState {
    records: ConfirmedMemoryRecord[];
}

export interface MemoryGovernanceStoreOptions {
    records?: readonly ConfirmedMemoryRecord[];
    now?: () => Date;
    persist?: (state: MemoryGovernanceState) => Promise<void> | void;
    idFactory?: () => string;
}

export interface MemoryGovernanceListFilter {
    lifecycles?: readonly ConfirmedMemoryRecord["lifecycle"][];
    types?: readonly MemoryType[];
}

export type MemoryGovernanceResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string };

function cloneRecord(record: ConfirmedMemoryRecord): ConfirmedMemoryRecord {
    return {
        ...record,
        scope: cloneScope(record.scope),
        sourceRefs: record.sourceRefs.map(cloneSourceRef),
    };
}

function normalizeMemoryRecords(value: unknown): ConfirmedMemoryRecord[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isRecord)
        .map((entry) => entry as unknown as ConfirmedMemoryRecord)
        .filter((entry) => validateConfirmedMemoryRecord(entry).ok)
        .map(cloneRecord);
}

function metadataString(metadata: Record<string, string | number | boolean | null> | undefined, key: string): string | null {
    const value = metadata?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function memoryCandidateFromQueueItem(item: ReviewQueueItem): MemoryGovernanceResult<MemoryCandidateContract> {
    if (item.type !== "memory_candidate") return { ok: false, reason: "not_memory_candidate" };
    const memoryType = metadataString(item.metadata, "memoryType");
    const sensitivity = metadataString(item.metadata, "sensitivity");
    if (!includesString(MEMORY_TYPES, memoryType)) return { ok: false, reason: "missing_memory_type" };
    if (!includesString(MEMORY_SENSITIVITIES, sensitivity)) return { ok: false, reason: "missing_sensitivity" };
    const candidate: MemoryCandidateContract = {
        id: item.id,
        type: memoryType,
        lifecycle: "candidate",
        sensitivity,
        scope: item.scope.label ?? item.scope.paths?.[0] ?? item.scope.kind,
        sourceRefs: item.sourceRefs.map(cloneSourceRef),
        createdAt: item.createdAt,
        summary: item.claim,
    };
    const validation = validateMemoryCandidate(candidate);
    return validation.ok ? { ok: true, value: candidate } : { ok: false, reason: validation.reason };
}

export function validateConfirmedMemoryRecord(record: ConfirmedMemoryRecord): MemoryGovernanceResult<ConfirmedMemoryRecord> {
    const lifecycle = validateMemoryLifecycleRecord(record);
    if (!lifecycle.ok) return { ok: false, reason: lifecycle.reason };
    if (hasForbiddenPersistedTextFields(record)) return { ok: false, reason: "forbidden_persisted_text" };
    if (record.lifecycle === "forgotten_tombstone") {
        if (record.summary.trim().length > 0) return { ok: false, reason: "tombstone_has_summary" };
        if (record.sourceRefs.length > 0) return { ok: false, reason: "tombstone_has_source_refs" };
        return { ok: true, value: cloneRecord(record) };
    }
    if (record.summary.trim().length === 0) return { ok: false, reason: "missing_summary" };
    if (record.type === "decision" && record.sourceRefs.length === 0) {
        return { ok: false, reason: "decision_missing_source_refs" };
    }
    for (const sourceRef of record.sourceRefs) {
        const sourceValidation = validateSourceRefPathShape(sourceRef);
        if (!sourceValidation.ok) return { ok: false, reason: `invalid_source_ref_${sourceValidation.reason}` };
    }
    return { ok: true, value: cloneRecord(record) };
}

export function normalizeMemoryGovernanceState(value: unknown): MemoryGovernanceState {
    if (!isRecord(value)) return { records: [] };
    return { records: normalizeMemoryRecords(value.records) };
}

export class MemoryGovernanceStore {
    private records: ConfirmedMemoryRecord[];
    private readonly now: () => Date;
    private readonly persist?: (state: MemoryGovernanceState) => Promise<void> | void;
    private readonly idFactory: () => string;

    constructor(options: MemoryGovernanceStoreOptions = {}) {
        this.records = normalizeMemoryRecords(options.records ?? []);
        this.now = options.now ?? (() => new Date());
        this.persist = options.persist;
        this.idFactory = options.idFactory ?? (() => `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    }

    snapshot(): MemoryGovernanceState {
        return { records: this.records.map(cloneRecord) };
    }

    list(filter: MemoryGovernanceListFilter = {}): ConfirmedMemoryRecord[] {
        const lifecycles = filter.lifecycles ? new Set(filter.lifecycles) : null;
        const types = filter.types ? new Set(filter.types) : null;
        return this.records
            .filter((record) => !lifecycles || lifecycles.has(record.lifecycle))
            .filter((record) => !types || types.has(record.type))
            .map(cloneRecord);
    }

    listForContext(options: { scopePaths?: readonly string[] } = {}): ConfirmedMemoryRecord[] {
        return this.list().filter((record) => {
            const decision = decideContextFirewall(record, options);
            return decision.decision === "auto_include";
        });
    }

    listRecentlyConfirmed(options: { withinMs?: number } = {}): ConfirmedMemoryRecord[] {
        const windowMs = options.withinMs ?? 7 * 24 * 60 * 60 * 1000;
        const cutoff = this.now().getTime() - windowMs;
        return this.list({ lifecycles: ["active"] }).filter((record) => {
            const confirmedAt = Date.parse(record.confirmedAt ?? "");
            return Number.isFinite(confirmedAt) && confirmedAt >= cutoff;
        });
    }

    async confirmCandidate(
        candidate: MemoryCandidateContract,
        options: { scope: ReviewQueueScope; confirmationSource?: ConfirmedMemoryRecord["confirmationSource"] },
    ): Promise<MemoryGovernanceResult<ConfirmedMemoryRecord>> {
        const candidateValidation = validateMemoryCandidate(candidate);
        if (!candidateValidation.ok) return { ok: false, reason: candidateValidation.reason };
        const now = this.now().toISOString();
        const record: ConfirmedMemoryRecord = {
            id: this.idFactory(),
            type: candidate.type,
            lifecycle: "active",
            sensitivity: candidate.sensitivity,
            sourceRefs: candidate.sourceRefs.map(cloneSourceRef),
            summary: candidate.summary,
            scope: cloneScope(options.scope),
            createdAt: now,
            updatedAt: now,
            confirmedAt: now,
            confirmationSource: options.confirmationSource ?? "pagelet",
            confirmationStrength: candidate.type === "task_constraint" ? "explicit" : "light",
            updatePolicy: candidate.type === "task_constraint" ? "ask-before-cross-scope-use" : "manual-only",
        };
        const validation = validateConfirmedMemoryRecord(record);
        if (!validation.ok) return validation;
        this.records = [record, ...this.records];
        await this.flush();
        return { ok: true, value: cloneRecord(record) };
    }

    async archive(id: string): Promise<MemoryGovernanceResult<ConfirmedMemoryRecord>> {
        return this.updateLifecycle(id, "archived", { archivedAt: this.now().toISOString() });
    }

    async restore(id: string): Promise<MemoryGovernanceResult<ConfirmedMemoryRecord>> {
        return this.updateLifecycle(id, "active", { archivedAt: undefined });
    }

    async markStale(id: string): Promise<MemoryGovernanceResult<ConfirmedMemoryRecord>> {
        return this.updateLifecycle(id, "stale");
    }

    async forget(id: string, reason = "user_forget"): Promise<MemoryGovernanceResult<ConfirmedMemoryRecord>> {
        const index = this.records.findIndex((record) => record.id === id);
        if (index < 0) return { ok: false, reason: "not_found" };
        const existing = this.records[index];
        const now = this.now().toISOString();
        const tombstone: ConfirmedMemoryRecord = {
            id: existing.id,
            type: existing.type,
            lifecycle: "forgotten_tombstone",
            sensitivity: existing.sensitivity,
            sourceRefs: [],
            summary: "",
            scope: cloneScope(existing.scope),
            createdAt: existing.createdAt,
            updatedAt: now,
            forgottenAt: now,
            tombstoneReason: reason,
        };
        const validation = validateConfirmedMemoryRecord(tombstone);
        if (!validation.ok) return validation;
        this.records[index] = tombstone;
        await this.flush();
        return { ok: true, value: cloneRecord(tombstone) };
    }

    exportMarkdown(id: string, confirmed: boolean): MemoryGovernanceResult<string> {
        if (!confirmed) return { ok: false, reason: "confirmation_required" };
        const record = this.records.find((candidate) => candidate.id === id);
        if (!record) return { ok: false, reason: "not_found" };
        if (record.lifecycle === "forgotten_tombstone") return { ok: false, reason: "forgotten_memory_has_no_content" };
        const sourceLines = record.sourceRefs.map((ref) => `- [[${ref.path}]]`);
        const markdown = [
            `# Memory: ${record.type}`,
            "",
            record.summary,
            "",
            `- Type: ${record.type}`,
            `- Sensitivity: ${record.sensitivity}`,
            `- Scope: ${record.scope.label ?? record.scope.paths?.join(", ") ?? record.scope.kind}`,
            "",
            "## Sources",
            sourceLines.length > 0 ? sourceLines.join("\n") : "- No source refs",
            "",
        ].join("\n");
        return { ok: true, value: markdown };
    }

    private async updateLifecycle(
        id: string,
        lifecycle: ConfirmedMemoryRecord["lifecycle"],
        extra: Partial<ConfirmedMemoryRecord> = {},
    ): Promise<MemoryGovernanceResult<ConfirmedMemoryRecord>> {
        const index = this.records.findIndex((record) => record.id === id);
        if (index < 0) return { ok: false, reason: "not_found" };
        const record = {
            ...cloneRecord(this.records[index]),
            ...extra,
            lifecycle,
            updatedAt: this.now().toISOString(),
        };
        const validation = validateConfirmedMemoryRecord(record);
        if (!validation.ok) return validation;
        this.records[index] = record;
        await this.flush();
        return { ok: true, value: cloneRecord(record) };
    }

    private async flush(): Promise<void> {
        await this.persist?.(this.snapshot());
    }
}
