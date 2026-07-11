import type {
    UserProfileRecord,
    UserProfileSnapshot,
    VaultMetacognitionSnapshot,
} from "../ai-services/memory-extraction";
import type {
    PersistedSourceRef,
    ReviewQueueScope,
} from "./contracts";
import { validateSourceRefPathShape } from "./contracts";
import {
    validateConfirmedMemoryRecord,
    type ConfirmedMemoryRecord,
} from "./memory-governance-store";

export type MemoryControlCenterOrigin =
    | "note_memory"
    | "vault_insights"
    | "user_profile"
    | "confirmed_memory"
    | "collaboration_preference"
    | "recent_context";

export type MemoryControlCenterAuthority =
    | "source_observation"
    | "pa_inference"
    | "explicit_user"
    | "user_correction";

export type MemoryControlCenterEffect =
    | "none"
    | "stored_not_in_use"
    | "retrieval_only"
    | "future_answers"
    | "collaboration_default";

export type MemoryControlCenterLifecycle =
    | "derived"
    | "active"
    | "archived"
    | "paused"
    | "forget_pending"
    | "stale"
    | "exported"
    | "forgotten_marker";

export type MemoryControlCenterProvenance =
    | { kind: "note"; sourceRef: PersistedSourceRef }
    | { kind: "conversation"; conversationId: string; observedAt?: string }
    | { kind: "explicit_setting"; settingKey: string }
    | {
        kind: "vault_aggregate";
        generatedAt: string;
        dataBoundaryFingerprint: string;
        includedFileCount: number;
        coverage: "exact" | "representative" | "aggregate_only";
        representativeSourceRefs: PersistedSourceRef[];
    };

export type MemoryControlCenterAction =
    | "correct"
    | "undo_recent_change"
    | "pause_use"
    | "resume_use"
    | "apply_device_wide"
    | "limit_to_current_vault"
    | "forget"
    | "retry_forget";

export interface MemoryControlCenterItem {
    id: string;
    claimId?: string;
    profileRecordId?: string;
    label: string;
    origin: MemoryControlCenterOrigin;
    authority: MemoryControlCenterAuthority;
    scopeLabel: string;
    effect: MemoryControlCenterEffect;
    lifecycle: MemoryControlCenterLifecycle;
    provenance: MemoryControlCenterProvenance[];
    observedAt?: string;
    updatedAt?: string;
    supportedActions: MemoryControlCenterAction[];
}

export interface MemoryControlCenterRecentChange {
    id: string;
    claimId: string;
    kind: "add" | "replace" | "auto_remove" | "correct" | "pause" | "resume"
        | "forget" | "undo" | "change_scope";
    occurredAt: string;
    label?: string;
    sourcePath?: string;
    scopeLabel?: string;
    effect?: MemoryControlCenterEffect;
    status?: "active" | "paused" | "restored" | "forgotten";
    redacted: boolean;
    supportedActions: MemoryControlCenterAction[];
}

export interface MemoryControlCenterSnapshot {
    generatedAt: string;
    noteMemory: {
        enabled: boolean;
        status: "disabled" | "unknown" | "unprepared" | "preparing" | "ready" | "stale" | "error";
        indexedDocumentCount?: number;
    };
    vaultInsights: {
        enabled: boolean;
        status: "disabled" | "not_loaded" | "ready" | "stale_boundary" | "error";
        generatedAt?: string;
        fileCount?: number;
    };
    profile: {
        enabled: boolean;
        status: "disabled" | "loading" | "unknown" | "blocked"
            | "unavailable" | "empty" | "ready" | "error";
        updatedAt?: string;
        itemCount: number;
    };
    durable: {
        activeCount: number;
        pausedCount: number;
        staleCount: number;
    };
    boundary: {
        vaultScoped: true;
        deviceLocalProven: boolean;
        explanationKey: string;
    };
    governanceMode?: "effect_based" | "legacy_threshold" | "unavailable";
    compatibilityFinalization?: {
        phase: "compatibility" | "finalizing";
        eligible: boolean;
        confirmationToken?: string;
        legacyRecordCount: number;
        legacyMemoryQueueCount: number;
        warningCode: "other_devices_may_still_depend_on_legacy_data";
        requiresFreshRestoreProof?: boolean;
        blockedReason?: string;
    };
    compatibilityRollback?: {
        phase: "compatibility" | "rolling_back";
        eligible: boolean;
        legacyRecordCount: number;
        legacyMemoryQueueCount: number;
        rollbackExpiresAt?: string;
        blockedReason?: string;
    };
    items: MemoryControlCenterItem[];
    recentChanges?: MemoryControlCenterRecentChange[];
    degradedSources: MemoryControlCenterSourceError[];
}

export interface MemoryControlCenterInput {
    now: Date;
    noteMemory: Readonly<MemoryControlCenterNoteMemoryInput>;
    vaultInsights: Readonly<MemoryControlCenterVaultInsightsInput>;
    profile: Readonly<MemoryControlCenterProfileInput>;
    confirmedRecords: readonly ConfirmedMemoryRecord[];
    boundary: Readonly<MemoryControlCenterBoundaryInput>;
    capabilities: Readonly<MemoryControlCenterCapabilities>;
    sourceErrors?: readonly MemoryControlCenterSourceError[];
}

export interface MemoryControlCenterNoteMemoryInput {
    enabled: boolean;
    status: MemoryControlCenterSnapshot["noteMemory"]["status"];
    indexedDocumentCount?: number;
}

export interface MemoryControlCenterVaultInsightsInput {
    enabled: boolean;
    storageState: "not_loaded" | "ready" | "stale_boundary" | "error";
    currentDataBoundaryFingerprint: string;
    snapshot: VaultInsightsReadSnapshot | null;
}

export interface VaultInsightsReadSnapshot {
    snapshot: VaultMetacognitionSnapshot;
    dataBoundaryFingerprint: string;
    representativeSourceRefs: PersistedSourceRef[];
}

export interface MemoryControlCenterProfileInput {
    featureEnabled: boolean;
    storageState: "loading" | "unknown" | "blocked" | "unavailable"
        | "empty" | "ready" | "error";
    snapshot: UserProfileSnapshot | null;
}

export interface MemoryControlCenterBoundaryInput {
    vaultScopeLabel: string;
    deviceLocalProven: boolean;
    explanationKey: string;
}

export interface MemoryControlCenterCapabilities {
    correct: boolean;
    undoRecentChange: boolean;
    pauseUse: boolean;
    resumeUse: boolean;
    forget: boolean;
}

export interface MemoryControlCenterSourceError {
    source: MemoryControlCenterOrigin;
    code: string;
}

const NOTE_MEMORY_STATUSES = new Set<MemoryControlCenterSnapshot["noteMemory"]["status"]>([
    "disabled",
    "unknown",
    "unprepared",
    "preparing",
    "ready",
    "stale",
    "error",
]);

const PROFILE_KINDS = new Set<UserProfileRecord["kind"]>([
    "user_explicit",
    "user_correction",
    "inferred_behavior",
    "discussed",
]);

const PROFILE_CONFIDENCES = new Set<UserProfileRecord["confidence"]>([
    "high",
    "medium",
    "low",
]);

const ORIGIN_ORDER: Readonly<Record<MemoryControlCenterOrigin, number>> = {
    note_memory: 0,
    vault_insights: 1,
    user_profile: 2,
    confirmed_memory: 3,
    collaboration_preference: 4,
    recent_context: 5,
};

/**
 * Pure projection over already-loaded Memory sources.
 *
 * This function deliberately owns no adapters and performs no I/O. Callers
 * must supply cached/typed inputs; malformed siblings are omitted individually.
 */
export function buildMemoryControlCenterSnapshot(
    input: MemoryControlCenterInput,
): MemoryControlCenterSnapshot {
    const errors: MemoryControlCenterSourceError[] = [];
    for (const error of input.sourceErrors ?? []) {
        if (isMemoryControlCenterSourceError(error)) addSourceError(errors, error.source, error.code);
    }

    const scopeLabel = nonEmptyString(input.boundary?.vaultScopeLabel) ?? "Current vault";
    const noteMemory = projectNoteMemory(input.noteMemory, errors);
    const vaultInsights = projectVaultInsights(input.vaultInsights, scopeLabel, errors);
    const profile = projectProfile(input.profile, scopeLabel, input.capabilities, errors);
    const durable = projectConfirmedMemory(
        input.confirmedRecords,
        scopeLabel,
        input.capabilities,
        errors,
    );
    const items = [
        ...vaultInsights.items,
        ...profile.items,
        ...durable.items,
    ].sort(compareItems);

    return {
        generatedAt: safeIsoString(input.now),
        noteMemory,
        vaultInsights: vaultInsights.summary,
        profile: profile.summary,
        durable: durable.summary,
        boundary: {
            vaultScoped: true,
            deviceLocalProven: input.boundary?.deviceLocalProven === true,
            explanationKey: nonEmptyString(input.boundary?.explanationKey) ?? "memory.boundary.unknown",
        },
        items,
        degradedSources: errors.sort(compareSourceErrors),
    };
}

function projectNoteMemory(
    input: Readonly<MemoryControlCenterNoteMemoryInput>,
    errors: MemoryControlCenterSourceError[],
): MemoryControlCenterSnapshot["noteMemory"] {
    if (!input?.enabled) {
        return { enabled: false, status: "disabled" };
    }

    const status = NOTE_MEMORY_STATUSES.has(input.status) && input.status !== "disabled"
        ? input.status
        : "error";
    if (status === "error" && input.status !== "error") {
        addSourceError(errors, "note_memory", "invalid_note_memory_status");
    }

    const count = normalizeCount(input.indexedDocumentCount);
    if (input.indexedDocumentCount !== undefined && count === undefined) {
        addSourceError(errors, "note_memory", "invalid_indexed_document_count");
    }
    return {
        enabled: true,
        status,
        ...(count !== undefined ? { indexedDocumentCount: count } : {}),
    };
}

function projectVaultInsights(
    input: Readonly<MemoryControlCenterVaultInsightsInput>,
    scopeLabel: string,
    errors: MemoryControlCenterSourceError[],
): {
    summary: MemoryControlCenterSnapshot["vaultInsights"];
    items: MemoryControlCenterItem[];
} {
    if (!input?.enabled) {
        return {
            summary: { enabled: false, status: "disabled" },
            items: [],
        };
    }
    if (input.storageState === "error") {
        addSourceError(errors, "vault_insights", "vault_insights_error");
        return {
            summary: { enabled: true, status: "error" },
            items: [],
        };
    }
    if (input.storageState === "not_loaded") {
        return {
            summary: { enabled: true, status: "not_loaded" },
            items: [],
        };
    }

    const readSnapshot = normalizeVaultInsightsReadSnapshot(input.snapshot, errors);
    if (!readSnapshot) {
        addSourceError(errors, "vault_insights", "malformed_vault_insights_snapshot");
        return {
            summary: { enabled: true, status: "error" },
            items: [],
        };
    }
    const currentFingerprint = nonEmptyString(input.currentDataBoundaryFingerprint);
    const boundaryIsStale = input.storageState === "stale_boundary"
        || !currentFingerprint
        || currentFingerprint !== readSnapshot.dataBoundaryFingerprint;
    if (boundaryIsStale) {
        addSourceError(errors, "vault_insights", "data_boundary_changed");
        return {
            summary: { enabled: true, status: "stale_boundary" },
            items: [],
        };
    }

    const sourceRefs = readSnapshot.representativeSourceRefs.map(cloneSourceRef);
    const coverage = sourceRefs.length === 0
        ? "aggregate_only"
        : sourceRefs.length >= readSnapshot.snapshot.fileCount
            ? "exact"
            : "representative";
    const generatedAt = readSnapshot.snapshot.generatedAt;
    return {
        summary: {
            enabled: true,
            status: "ready",
            generatedAt,
            fileCount: readSnapshot.snapshot.fileCount,
        },
        items: [{
            id: "vault-insights",
            label: "Understanding from your notes",
            origin: "vault_insights",
            authority: "pa_inference",
            scopeLabel,
            effect: "future_answers",
            lifecycle: "derived",
            provenance: [{
                kind: "vault_aggregate",
                generatedAt,
                dataBoundaryFingerprint: readSnapshot.dataBoundaryFingerprint,
                includedFileCount: readSnapshot.snapshot.fileCount,
                coverage,
                representativeSourceRefs: sourceRefs,
            }],
            observedAt: generatedAt,
            updatedAt: generatedAt,
            supportedActions: [],
        }],
    };
}

function normalizeVaultInsightsReadSnapshot(
    value: VaultInsightsReadSnapshot | null,
    errors: MemoryControlCenterSourceError[],
): VaultInsightsReadSnapshot | null {
    if (!isRecord(value) || !isRecord(value.snapshot)) return null;
    const generatedAt = nonEmptyString(value.snapshot.generatedAt);
    const fileCount = normalizeCount(value.snapshot.fileCount);
    const fingerprint = nonEmptyString(value.dataBoundaryFingerprint);
    if (!generatedAt || fileCount === undefined || !fingerprint || !Array.isArray(value.representativeSourceRefs)) {
        return null;
    }
    const sourceRefs: PersistedSourceRef[] = [];
    for (const ref of value.representativeSourceRefs as unknown[]) {
        if (validateSourceRefPathShape(ref).ok) {
            sourceRefs.push(cloneSourceRef(ref as PersistedSourceRef));
        } else {
            addSourceError(errors, "vault_insights", "malformed_representative_source");
        }
    }
    return {
        snapshot: {
            ...(value.snapshot as unknown as VaultMetacognitionSnapshot),
            generatedAt,
            fileCount,
        },
        dataBoundaryFingerprint: fingerprint,
        representativeSourceRefs: sourceRefs,
    };
}

function projectProfile(
    input: Readonly<MemoryControlCenterProfileInput>,
    scopeLabel: string,
    capabilities: Readonly<MemoryControlCenterCapabilities>,
    errors: MemoryControlCenterSourceError[],
): {
    summary: MemoryControlCenterSnapshot["profile"];
    items: MemoryControlCenterItem[];
} {
    const normalized = normalizeProfileSnapshot(input?.snapshot, errors);
    const records = normalized?.records ?? [];
    const enabled = input?.featureEnabled === true;
    const status = enabled
        ? normalizeProfileStatus(input?.storageState, normalized)
        : "disabled";

    if (enabled && (status === "unknown" || status === "blocked" || status === "unavailable")) {
        addSourceError(errors, "user_profile", `profile_${status}`);
    } else if (enabled && status === "error") {
        addSourceError(errors, "user_profile", "profile_error");
    }

    const items = records.map((record): MemoryControlCenterItem => ({
        id: `user-profile:${record.profileRecordId ?? record.key}`,
        ...(record.profileRecordId ? { profileRecordId: record.profileRecordId } : {}),
        label: record.text,
        origin: "user_profile",
        authority: profileAuthority(record.kind),
        scopeLabel,
        effect: enabled ? "future_answers" : "stored_not_in_use",
        lifecycle: "derived",
        provenance: profileProvenance(record),
        observedAt: record.observedAt,
        updatedAt: normalized?.updatedAt,
        supportedActions: profileActions(capabilities),
    }));

    return {
        summary: {
            enabled,
            status,
            ...(normalized?.updatedAt ? { updatedAt: normalized.updatedAt } : {}),
            itemCount: records.length,
        },
        items,
    };
}

function normalizeProfileStatus(
    state: MemoryControlCenterProfileInput["storageState"] | undefined,
    snapshot: UserProfileSnapshot | null,
): MemoryControlCenterSnapshot["profile"]["status"] {
    if (state === "ready") return snapshot && snapshot.records.length > 0 ? "ready" : "empty";
    if (state === "empty") return snapshot && snapshot.records.length > 0 ? "ready" : "empty";
    if (state === "loading" || state === "unknown" || state === "blocked"
        || state === "unavailable" || state === "error") return state;
    return "error";
}

function normalizeProfileSnapshot(
    value: UserProfileSnapshot | null,
    errors: MemoryControlCenterSourceError[],
): UserProfileSnapshot | null {
    if (value === null) return null;
    if (!isRecord(value) || !Array.isArray(value.records) || !nonEmptyString(value.updatedAt)) {
        addSourceError(errors, "user_profile", "malformed_profile_snapshot");
        return null;
    }
    const records: UserProfileRecord[] = [];
    const keys = new Set<string>();
    for (const candidate of value.records as unknown[]) {
        const record = normalizeProfileRecord(candidate);
        if (!record || keys.has(record.key)) {
            addSourceError(errors, "user_profile", "malformed_profile_record");
            continue;
        }
        keys.add(record.key);
        records.push(record);
    }
    return {
        updatedAt: value.updatedAt,
        records,
        markdown: typeof value.markdown === "string" ? value.markdown : "",
    };
}

function normalizeProfileRecord(value: unknown): UserProfileRecord | null {
    if (!isRecord(value)) return null;
    const key = nonEmptyString(value.key);
    const text = nonEmptyString(value.text);
    const conversationId = nonEmptyString(value.conversationId);
    const observedAt = nonEmptyString(value.observedAt);
    const profileRecordId = nonEmptyString(value.profileRecordId);
    if (!key || !text || !conversationId || !observedAt) return null;
    if (!PROFILE_KINDS.has(value.kind as UserProfileRecord["kind"])) return null;
    if (!PROFILE_CONFIDENCES.has(value.confidence as UserProfileRecord["confidence"])) return null;
    if (!Number.isFinite(value.occurrences) || (value.occurrences as number) < 0) return null;
    if (!Array.isArray(value.conversationIds)
        || value.conversationIds.some((id) => !nonEmptyString(id))) return null;
    if (typeof value.confirmed !== "boolean") return null;
    return {
        key,
        ...(profileRecordId ? { profileRecordId } : {}),
        text,
        kind: value.kind as UserProfileRecord["kind"],
        confidence: value.confidence as UserProfileRecord["confidence"],
        conversationId,
        observedAt,
        occurrences: Math.floor(value.occurrences as number),
        conversationIds: (value.conversationIds as string[]).map((id) => id.trim()),
        confirmed: value.confirmed,
    };
}

function profileAuthority(kind: UserProfileRecord["kind"]): MemoryControlCenterAuthority {
    if (kind === "user_explicit") return "explicit_user";
    if (kind === "user_correction") return "user_correction";
    return "pa_inference";
}

function profileProvenance(record: UserProfileRecord): MemoryControlCenterProvenance[] {
    const conversationIds = new Set<string>();
    conversationIds.add(record.conversationId);
    for (const id of record.conversationIds) conversationIds.add(id);
    return Array.from(conversationIds, (conversationId) => ({
        kind: "conversation" as const,
        conversationId,
        observedAt: record.observedAt,
    }));
}

function profileActions(
    capabilities: Readonly<MemoryControlCenterCapabilities>,
): MemoryControlCenterAction[] {
    const actions: MemoryControlCenterAction[] = [];
    if (capabilities.correct) actions.push("correct");
    if (capabilities.undoRecentChange) actions.push("undo_recent_change");
    if (capabilities.pauseUse) actions.push("pause_use");
    if (capabilities.forget) actions.push("forget");
    return actions;
}

function projectConfirmedMemory(
    input: readonly ConfirmedMemoryRecord[],
    defaultScopeLabel: string,
    capabilities: Readonly<MemoryControlCenterCapabilities>,
    errors: MemoryControlCenterSourceError[],
): {
    summary: MemoryControlCenterSnapshot["durable"];
    items: MemoryControlCenterItem[];
} {
    const items: MemoryControlCenterItem[] = [];
    let activeCount = 0;
    let staleCount = 0;
    for (const candidate of Array.isArray(input) ? input as unknown[] : []) {
        const validation = validateConfirmedMemoryRecord(candidate as ConfirmedMemoryRecord);
        if (!validation.ok) {
            addSourceError(errors, "confirmed_memory", "malformed_confirmed_record");
            continue;
        }
        const record = validation.value;
        if (record.lifecycle === "candidate") continue;
        const lifecycle = projectConfirmedLifecycle(record.lifecycle);
        if (!lifecycle) {
            addSourceError(errors, "confirmed_memory", "unsupported_confirmed_lifecycle");
            continue;
        }
        if (lifecycle === "active") activeCount++;
        if (lifecycle === "stale") staleCount++;
        items.push({
            id: `confirmed:${record.id}`,
            claimId: record.id,
            label: lifecycle === "forgotten_marker" ? "Forgotten item" : record.summary,
            origin: "confirmed_memory",
            authority: confirmedAuthority(record),
            scopeLabel: lifecycle === "forgotten_marker"
                ? ""
                : confirmedScopeLabel(record.scope, defaultScopeLabel),
            effect: lifecycle === "forgotten_marker" ? "none" : "stored_not_in_use",
            lifecycle,
            provenance: lifecycle === "forgotten_marker"
                ? []
                : record.sourceRefs.map((sourceRef) => ({
                    kind: "note" as const,
                    sourceRef: cloneSourceRef(sourceRef),
                })),
            observedAt: record.confirmedAt ?? record.createdAt,
            updatedAt: record.updatedAt,
            supportedActions: confirmedActions(lifecycle, capabilities),
        });
    }
    return {
        summary: {
            activeCount,
            pausedCount: 0,
            staleCount,
        },
        items,
    };
}

function projectConfirmedLifecycle(
    lifecycle: ConfirmedMemoryRecord["lifecycle"],
): MemoryControlCenterLifecycle | null {
    switch (lifecycle) {
        case "active": return "active";
        case "archived": return "archived";
        case "stale": return "stale";
        case "exported": return "exported";
        case "forgotten_tombstone": return "forgotten_marker";
        case "candidate": return null;
    }
}

function confirmedAuthority(record: ConfirmedMemoryRecord): MemoryControlCenterAuthority {
    if (record.confirmationStrength === "auto") return "pa_inference";
    if (record.confirmationStrength === "light"
        || record.confirmationStrength === "explicit"
        || record.confirmationStrength === "special") return "explicit_user";
    return "source_observation";
}

function confirmedScopeLabel(scope: ReviewQueueScope, fallback: string): string {
    const label = nonEmptyString(scope.label);
    if (label) return label;
    const path = scope.paths?.map(nonEmptyString).find((value): value is string => Boolean(value));
    if (path) return path;
    const tag = scope.tags?.map(nonEmptyString).find((value): value is string => Boolean(value));
    if (tag) return tag.startsWith("#") ? tag : `#${tag}`;
    return fallback;
}

function confirmedActions(
    lifecycle: MemoryControlCenterLifecycle,
    capabilities: Readonly<MemoryControlCenterCapabilities>,
): MemoryControlCenterAction[] {
    if (lifecycle === "forgotten_marker" || lifecycle === "exported") return [];
    const actions: MemoryControlCenterAction[] = [];
    if (capabilities.correct) actions.push("correct");
    if (capabilities.undoRecentChange) actions.push("undo_recent_change");
    if (lifecycle === "active" && capabilities.pauseUse) actions.push("pause_use");
    if (lifecycle === "paused" && capabilities.resumeUse) actions.push("resume_use");
    if (capabilities.forget) actions.push("forget");
    return actions;
}

function compareItems(left: MemoryControlCenterItem, right: MemoryControlCenterItem): number {
    const originDifference = ORIGIN_ORDER[left.origin] - ORIGIN_ORDER[right.origin];
    if (originDifference !== 0) return originDifference;
    const leftTime = left.updatedAt ?? left.observedAt ?? "";
    const rightTime = right.updatedAt ?? right.observedAt ?? "";
    return rightTime.localeCompare(leftTime) || left.id.localeCompare(right.id);
}

function isMemoryControlCenterSourceError(value: unknown): value is MemoryControlCenterSourceError {
    if (!isRecord(value)) return false;
    const source = nonEmptyString(value.source);
    if (!source) return false;
    return Object.prototype.hasOwnProperty.call(ORIGIN_ORDER, source)
        && Boolean(nonEmptyString(value.code));
}

function addSourceError(
    errors: MemoryControlCenterSourceError[],
    source: MemoryControlCenterOrigin,
    code: string,
): void {
    const normalizedCode = nonEmptyString(code);
    if (!normalizedCode) return;
    if (errors.some((error) => error.source === source && error.code === normalizedCode)) return;
    errors.push({ source, code: normalizedCode });
}

function compareSourceErrors(
    left: MemoryControlCenterSourceError,
    right: MemoryControlCenterSourceError,
): number {
    return ORIGIN_ORDER[left.source] - ORIGIN_ORDER[right.source]
        || left.code.localeCompare(right.code);
}

function cloneSourceRef(sourceRef: PersistedSourceRef): PersistedSourceRef {
    return {
        ...sourceRef,
        ...(sourceRef.whyShown ? { whyShown: [...sourceRef.whyShown] } : {}),
    };
}

function normalizeCount(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    return Math.floor(value);
}

function safeIsoString(value: unknown): string {
    return value instanceof Date && Number.isFinite(value.getTime())
        ? value.toISOString()
        : new Date(0).toISOString();
}

function nonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
