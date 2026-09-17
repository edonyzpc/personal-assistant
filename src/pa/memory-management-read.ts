import type {
    MemoryManagementCurrentUsageInput,
    MemoryManagementObservation,
    MemoryManagementQueryInput,
    MemoryManagementQueryItem,
    MemoryManagementQueryOutput,
    MemoryManagementReadPort,
    MemoryManagementStatusOutput,
    MemoryManagementSettings,
    MemoryManagementUnavailableOutput,
    MemoryManagementUsageOutput,
    MemoryManagementUsageRecord,
} from "../ai-services/memory-management-types";
import {
    boundedMemoryFingerprint,
    memoryManagementAggregateFingerprint,
    memoryManagementItems,
    type MemoryManagementEvidence,
} from "../ai-services/memory-management-evidence";
import type { GenerationInputPersonalSource } from "../ai-services/generation-input-snapshot";
import type { ChatHistoryManager } from "../chat/chat-history-manager";
import type { WritingVersionService } from "../chat/writing-versions";
import type {
    DeviceMemoryGovernanceStateV1,
    MemoryClaimRevision,
    PersistedMemoryProvenance,
} from "./memory-governance-persistence";
import type {
    MemoryControlCenterItem,
    MemoryControlCenterProvenance,
    MemoryControlCenterSnapshot,
} from "./memory-control-center";

export interface MemoryManagementReadDependencies {
    isRuntimeCurrent?: () => boolean;
    captureLegacySourceValidity?: () => (() => boolean) | null | undefined;
    getSettings(): MemoryManagementSettings;
    getControlCenterSnapshot(): Promise<MemoryControlCenterSnapshot>;
    getGovernedState(): DeviceMemoryGovernanceStateV1 | null;
    getCacheTarget(): number;
    getVaultKey(): string | null;
    getDataBoundaryFingerprint(): string;
    isDataBoundaryAllowedPath(path: string): boolean;
    getHistoryManager(): ChatHistoryManager | undefined;
    getWritingVersions(): WritingVersionService | undefined;
}

interface PreparedManagementState {
    deps: MemoryManagementReadDependencies;
    legacySourceValidity: (() => boolean) | null;
    settings: MemoryManagementSettings;
    snapshot: MemoryControlCenterSnapshot;
    governed: DeviceMemoryGovernanceStateV1 | null;
    vaultKey: string | null;
    boundary: string;
    cacheTarget: number;
}

export function createMemoryManagementReadPort(
    dependencies: MemoryManagementReadDependencies,
): MemoryManagementReadPort {
    const stateIsCurrent = (state: PreparedManagementState): boolean => {
        try {
            if (dependencies.isRuntimeCurrent?.() === false) return false;
            if (state.legacySourceValidity && !state.legacySourceValidity()) return false;
            const settings = dependencies.getSettings();
            if (settings.memoryEnabled !== state.settings.memoryEnabled
                || settings.learningEnabled !== state.settings.learningEnabled
                || settings.learningStatus !== state.settings.learningStatus) return false;
            if (dependencies.getVaultKey() !== state.vaultKey) return false;
            if (dependencies.getDataBoundaryFingerprint() !== state.boundary) return false;
            const governed = dependencies.getGovernedState();
            if (state.governed) {
                if (!governed || governed.commitSequence !== state.governed.commitSequence) return false;
            }
            if ((governed?.commitSequence ?? 0) < state.cacheTarget
                || dependencies.getCacheTarget() !== state.cacheTarget) return false;
            return true;
        } catch {
            return false;
        }
    };

    const guardState = (
        state: PreparedManagementState,
        extraAssert?: () => void,
    ) => ({
        assertCurrent(): void {
            if (!stateIsCurrent(state)) throw new Error("Memory management state changed before dispatch.");
            extraAssert?.();
        },
    });

    const loadState = async (): Promise<PreparedManagementState | null> => {
        if (dependencies.isRuntimeCurrent?.() === false) return null;
        let legacySourceValidity: (() => boolean) | null | undefined = null;
        if (dependencies.captureLegacySourceValidity) {
            try {
                const captured = dependencies.captureLegacySourceValidity();
                legacySourceValidity = captured === null || typeof captured === "function"
                    ? captured
                    : undefined;
            } catch {
                legacySourceValidity = undefined;
            }
        }
        if (legacySourceValidity === undefined) return null;
        const settings = dependencies.getSettings();
        const vaultKey = dependencies.getVaultKey();
        const boundary = dependencies.getDataBoundaryFingerprint();
        const snapshot = await dependencies.getControlCenterSnapshot();
        if (dependencies.isRuntimeCurrent?.() === false) return null;
        if (legacySourceValidity && !legacySourceValidity()) return null;
        if (dependencies.getSettings().memoryEnabled !== settings.memoryEnabled
            || dependencies.getVaultKey() !== vaultKey
            || dependencies.getDataBoundaryFingerprint() !== boundary) return null;
        const governed = dependencies.getGovernedState();
        if (governed && governed.commitSequence < dependencies.getCacheTarget()) return null;
        const state = {
            deps: dependencies,
            legacySourceValidity: legacySourceValidity ?? null,
            settings,
            snapshot,
            governed,
            vaultKey,
            boundary,
            cacheTarget: dependencies.getCacheTarget(),
        };
        if (!stateIsCurrent(state)) return null;
        return state;
    };

    const readStateForObservation = async (): Promise<
        { ready: true; state: PreparedManagementState } | { ready: false; reason: "not_ready" | "cache_refresh_pending" }
    > => {
        const state = await loadState();
        if (state) return { ready: true, state };
        const governed = dependencies.getGovernedState();
        return governed && governed.commitSequence < dependencies.getCacheTarget()
            ? { ready: false, reason: "cache_refresh_pending" }
            : { ready: false, reason: "not_ready" };
    };

    const port: MemoryManagementReadPort = {
        async prepareObservation(expected, currentUsage) {
            const loaded = await readStateForObservation();
            if (!loaded.ready) {
                return {
                    purpose: "memory_management",
                    ready: false,
                    reason: loaded.reason,
                    memoryEnabled: dependencies.getSettings().memoryEnabled,
                };
            }
            const { settings, governed } = loaded.state;
            if (expected?.operation === "status" || expected?.operation === undefined) {
                const content = statusOutput(loaded.state);
                const stateFingerprint = statusFingerprint(loaded.state);
                const currentItems = memoryManagementItems(content);
                const contentCurrent = expected?.contentFingerprint === undefined
                    || boundedMemoryFingerprint(content) === expected.contentFingerprint;
                return {
                    ...completeObservation(
                        settings.memoryEnabled,
                        stateFingerprint,
                        governed,
                        loaded.state.cacheTarget,
                        contentCurrent,
                        {
                            validItemIndexes: validItemIndexesFor({ ...expected, items: expected?.items ?? [] }, currentItems),
                            aggregateCurrent: expected?.aggregateFingerprint === undefined
                                || memoryManagementAggregateFingerprint(content) === expected.aggregateFingerprint,
                            guard: guardState(loaded.state),
                        },
                    ),
                    ready: contentCurrent,
                    ...(contentCurrent ? {} : { reason: "source_changed" as const }),
                };
            }
            if (expected.operation === "query") {
                const request = queryRequestFromEvidence(expected.request);
                if (!queryRequestIsValid(request)) {
                    return {
                        purpose: "memory_management",
                        ready: false,
                        reason: "not_ready",
                        memoryEnabled: settings.memoryEnabled,
                    };
                }
                const content = await queryPrepared(loaded.state, request);
                const projectedContent = content.available
                    ? content
                    : queryRetainedContent(loaded.state, request, expected.items ?? []);
                const currentItems = memoryManagementItems(projectedContent);
                return completeObservation(
                    settings.memoryEnabled,
                    queryStateFingerprint(loaded.state, request),
                    governed,
                    loaded.state.cacheTarget,
                    observationContentCurrent(expected, projectedContent, currentItems),
                    {
                        validItemIndexes: validItemIndexesFor({ ...expected, items: expected.items ?? [] }, currentItems),
                        aggregateCurrent: content.available
                            && memoryManagementAggregateFingerprint(content) === expected.aggregateFingerprint,
                        projectedContent,
                        guard: guardState(loaded.state),
                    },
                );
            }
            if (expected.operation === "action") {
                const request = actionRequestFromEvidence(expected.request);
                if (!request) {
                    return {
                        purpose: "memory_management",
                        ready: false,
                        reason: "not_ready",
                        memoryEnabled: settings.memoryEnabled,
                    };
                }
                const stateFingerprint = actionStateFingerprint(loaded.state, request);
                const current = actionResultIsCurrent(loaded.state, request);
                const fingerprintCurrent = expected.stateFingerprint === undefined
                    || expected.stateFingerprint === stateFingerprint;
                const valid = current && fingerprintCurrent;
                return completeObservation(
                    settings.memoryEnabled,
                    stateFingerprint,
                    governed,
                    loaded.state.cacheTarget,
                    valid,
                    {
                        validItemIndexes: valid
                            ? (expected.items ?? []).map((item) => item.index)
                            : [],
                        aggregateCurrent: valid,
                        guard: guardState(loaded.state),
                    },
                );
            }
            let historyLifetime: (() => boolean) | undefined;
            const currentUsageBefore = currentUsage?.();
            const usageRequest = usageRequestFromEvidence(expected.request);
            if (!usageRequestIsValid(usageRequest)) {
                return {
                    purpose: "memory_management",
                    ready: false,
                    reason: "not_ready",
                    memoryEnabled: settings.memoryEnabled,
                };
            }
            const content = await usagePrepared(
                loaded.state,
                usageRequest,
                currentUsage,
                lifetime => { historyLifetime = lifetime; },
            );
            const currentItems = memoryManagementItems(content);
            return completeObservation(
                settings.memoryEnabled,
                usageStateFingerprint(loaded.state, usageRequestFromEvidence(expected.request), content.records ?? []),
                governed,
                loaded.state.cacheTarget,
                observationContentCurrent(expected, content, currentItems),
                    {
                        validItemIndexes: validItemIndexesFor(
                            { ...expected, items: expected.items ?? [] },
                            currentItems,
                            expected.operation === "usage",
                        ),
                        aggregateCurrent: memoryManagementAggregateFingerprint(content) === expected.aggregateFingerprint,
                        projectedContent: content,
                        guard: guardState(loaded.state, () => {
                        if (historyLifetime && !historyLifetime()) throw new Error("Memory history source changed before dispatch.");
                        const current = currentUsage?.();
                        if (current !== undefined
                            && boundedMemoryFingerprint(current) !== boundedMemoryFingerprint(currentUsageBefore)) {
                            throw new Error("Current Memory usage changed before dispatch.");
                        }
                    }),
                },
            );
        },

    async getStatus() {
            const loaded = await loadState();
            if (!loaded) throw new Error("Memory management status is unavailable.");
            return statusOutput(loaded);
        },

        async queryMemories(input) {
            const loaded = await loadState();
            if (!loaded) {
                return {
                    kind: "memory-query",
                    available: false,
                    reason: dependencies.getGovernedState()
                        && dependencies.getGovernedState()!.commitSequence < dependencies.getCacheTarget()
                        ? "cache_refresh_pending"
                        : "not_ready",
                    target: "query",
                    memoryEnabled: dependencies.getSettings().memoryEnabled,
                    contentAvailable: false,
                    items: [],
                    matchCount: 0,
                };
            }
            return queryPrepared(loaded, input);
        },

        async getUsage(input, currentUsage) {
            const loaded = await loadState();
            if (!loaded) {
                return {
                    kind: "memory-usage",
                    available: false,
                    reason: "not_ready",
                    target: input.conversationId ? "history" : "current_run",
                    memoryEnabled: dependencies.getSettings().memoryEnabled,
                    contentAvailable: false,
                    records: [],
                    evidenceLevel: "unknown",
                };
            }
            return await usagePrepared(loaded, input, currentUsage);
        },
    };
    return port;
}

function queryRequestIsValid(input: MemoryManagementQueryInput): boolean {
    if (input.text !== undefined && input.itemId !== undefined) return false;
    const lifecycle = new Set([
        "derived", "active", "archived", "paused", "forget_pending", "stale", "exported", "forgotten_marker",
    ]);
    return (!input.lifecycle || input.lifecycle.every(value => lifecycle.has(value)))
        && input.limit !== undefined;
}

function usageRequestIsValid(input: { conversationId?: string; turnId?: string }): boolean {
    return (input.conversationId === undefined && input.turnId === undefined)
        || (input.conversationId !== undefined && input.turnId !== undefined);
}

interface MemoryActionEvidenceRequest {
    action: string;
    status: "applied" | "pending" | "needs_confirmation" | "cancelled" | "failed";
    claimId?: string;
    revisionId?: string;
    eventId?: string;
    queueItemId?: string;
    reason?: string;
}

function actionRequestFromEvidence(
    value: Record<string, string> | undefined,
): MemoryActionEvidenceRequest | null {
    if (!value || typeof value.action !== "string"
        || !["applied", "pending", "needs_confirmation", "cancelled", "failed"].includes(value.status)) {
        return null;
    }
    return {
        action: value.action,
        status: value.status as MemoryActionEvidenceRequest["status"],
        ...(value.claimId ? { claimId: value.claimId } : {}),
        ...(value.revisionId ? { revisionId: value.revisionId } : {}),
        ...(value.eventId ? { eventId: value.eventId } : {}),
        ...(value.queueItemId ? { queueItemId: value.queueItemId } : {}),
        ...(value.reason ? { reason: value.reason } : {}),
    };
}

function completeObservation(
    memoryEnabled: boolean,
    stateFingerprint: string,
    governed: DeviceMemoryGovernanceStateV1 | null,
    cacheTarget: number,
    contentCurrent?: boolean,
    extras?: Partial<Pick<MemoryManagementObservation, "validItemIndexes" | "aggregateCurrent" | "guard" | "projectedContent">>,
): MemoryManagementObservation {
    return {
        purpose: "memory_management",
        ready: extras ? true : contentCurrent !== false,
        ...(contentCurrent === false && !extras ? { reason: "source_changed" as const } : {}),
        memoryEnabled,
        stateFingerprint,
        ...(governed ? {
            commitSequence: governed.commitSequence,
            deviceMemoryCacheRefreshTargetSequence: cacheTarget,
        } : {}),
        ...extras,
    };
}

function observationContentCurrent(
    expected: { contentFingerprint?: string; items?: MemoryManagementEvidence["items"] },
    content: unknown,
    currentItems: ReturnType<typeof memoryManagementItems>,
): boolean {
    return boundedMemoryFingerprint(content) === expected.contentFingerprint
        && (expected.items?.length === 0
            || validItemIndexesFor({ ...expected, items: expected.items ?? [] }, currentItems).length > 0);
}

function validItemIndexesFor(
    expected: Pick<MemoryManagementEvidence, "items">,
    currentItems: ReturnType<typeof memoryManagementItems>,
    identityOnly = false,
): number[] {
    const valid: number[] = [];
    for (const item of expected.items) {
        const current = currentItems.find(candidate => candidate.identity === item.identity);
        if (current
            && (identityOnly || current.outputDigest === item.outputDigest)) {
            valid.push(item.index);
        }
    }
    return valid;
}

function statusOutput(state: PreparedManagementState): MemoryManagementStatusOutput {
    const { snapshot, settings } = state;
    const memoryEnabled = settings.memoryEnabled;
    const permittedItemsForStatus = memoryEnabled ? permittedItems(state) : [];
    const permitted = permittedItemsForStatus.length;
    const learningEnabled = settings.learningEnabled ?? true;
    const learningStatus = settings.learningStatus ?? (learningEnabled ? "enabled" : "paused");
    const coverage = statusCoverage(state);
    return {
        kind: "memory-status",
        available: true,
        memoryEnabled,
        contentAvailable: permittedItemsForStatus.some(item => item.text !== undefined),
        noteMemory: {
            status: memoryEnabled ? snapshot.noteMemory.status : "disabled",
        },
        learning: {
            enabled: learningEnabled,
            status: learningStatus,
            governance: snapshot.governanceMode === "effect_based" ? "ready" : "unavailable",
            profile: memoryEnabled
                ? snapshot.profile.status
                : learningEnabled ? snapshot.profile.status : "disabled",
            vaultInsights: memoryEnabled
                ? snapshot.vaultInsights.status
                : learningEnabled ? snapshot.vaultInsights.status : "disabled",
        },
        coverage,
        recordCount: permitted,
        recordCountKind: coverage === "complete" ? "exact" : "partial",
        managementTargetId: "memory-personalization",
        existingUnderstanding: {
            available: memoryEnabled && permittedItemsForStatus.length > 0,
            status: !memoryEnabled ? "paused" : coverage === "unknown" ? "unknown" : "active",
        },
    };
}

function statusCoverage(state: PreparedManagementState): "complete" | "partial" | "unknown" {
    if (state.snapshot.degradedSources.length > 0) return "partial";
    const statuses = [
        state.snapshot.noteMemory.status,
        state.snapshot.profile.status,
        state.snapshot.vaultInsights.status,
    ];
    if (statuses.some(status => status === "unknown" || status === "blocked" || status === "unavailable")) return "unknown";
    if (statuses.some(status => status === "error" || status === "stale" || status === "stale_boundary"
        || status === "preparing" || status === "unprepared" || status === "loading")) return "partial";
    return "complete";
}

function queryPrepared(
    state: PreparedManagementState,
    input: MemoryManagementQueryInput,
): MemoryManagementQueryOutput | MemoryManagementUnavailableOutput<"query"> {
    if (!state.settings.memoryEnabled) {
        return {
            kind: "memory-query",
            available: false,
            reason: "memory_disabled",
            target: "query",
            memoryEnabled: false,
            contentAvailable: false,
            items: [],
            matchCount: 0,
        };
    }
    const identity = queryStateFingerprint(state, input);
    let offset = 0;
    if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        if (!cursor || cursor.stateFingerprint !== identity || cursor.query !== stableQueryKey(input)) {
            return {
                kind: "memory-query",
                available: false,
                reason: "cursor_expired",
                target: "query",
                memoryEnabled: true,
                contentAvailable: false,
                items: [],
                matchCount: 0,
            };
        }
        offset = cursor.offset;
    }
    const candidates = permittedItems(state).filter(item => matchesQuery(item, input));
    const limit = input.limit ?? 10;
    const page = candidates.slice(offset, offset + limit);
    const overallCoverage = statusCoverage(state);
    return {
        kind: "memory-query",
        available: true,
        memoryEnabled: true,
        contentAvailable: candidates.some(item => item.text !== undefined),
        query: {
            ...(input.text !== undefined ? { text: input.text } : {}),
            ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
            ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
        },
        items: page,
        matchCount: candidates.length,
        matchCountKind: overallCoverage === "complete" ? "exact" : "partial",
        coverage: overallCoverage === "complete"
            ? { state: "complete" }
            : {
                state: overallCoverage === "unknown" ? "unknown" : "partial",
                explanation: "Some Memory sources are not fully available.",
            },
        ...(offset + page.length < candidates.length ? { nextCursor: encodeCursor({ query: stableQueryKey(input), stateFingerprint: identity, offset: offset + page.length }) } : {}),
    };
}

function queryRetainedContent(
    state: PreparedManagementState,
    input: MemoryManagementQueryInput,
    expectedItems: MemoryManagementEvidence["items"],
): MemoryManagementQueryOutput {
    const filters: MemoryManagementQueryInput = { ...input, cursor: undefined };
    const items: MemoryManagementQueryItem[] = [];
    for (const expected of expectedItems.slice(0, 20)) {
        const itemId = evidenceIdentityDomainId(expected.identity);
        if (!itemId) continue;
        const result = queryPrepared(state, { ...filters, itemId, limit: 1 });
        if (!result.available) continue;
        const item = result.items[0];
        if (!item || !matchesQuery(item, filters)) continue;
        const identity = memoryManagementItems({ kind: "memory-query", items: [item] })[0]?.identity;
        if (identity !== expected.identity) continue;
        items.push(item);
    }
    return {
        kind: "memory-query",
        available: true,
        memoryEnabled: true,
        contentAvailable: items.some(item => item.text !== undefined),
        query: {
            ...(filters.text !== undefined ? { text: filters.text } : {}),
            ...(filters.itemId !== undefined ? { itemId: filters.itemId } : {}),
            ...(filters.lifecycle ? { lifecycle: filters.lifecycle } : {}),
        },
        items,
        matchCount: items.length,
        matchCountKind: "partial",
        coverage: {
            state: "partial",
            explanation: "The previous Memory query page expired; only still-valid records are retained.",
        },
    };
}

function evidenceIdentityDomainId(identity: string): string | undefined {
    try {
        const parsed = JSON.parse(identity) as Record<string, unknown>;
        if (typeof parsed.id === "string" && parsed.id) return parsed.id;
        if (typeof parsed.claimId === "string" && parsed.claimId) return parsed.claimId;
        return undefined;
    } catch {
        return undefined;
    }
}

function permittedItems(state: PreparedManagementState): MemoryManagementQueryItem[] {
    const boundary = currentBoundary(state);
    const governedState = state.governed;
    const revisionByClaim = new Map(governedState?.claims.map(claim => [
        claim.id,
        claim.activeRevisionId
            ? governedState.revisions.find(revision => revision.id === claim.activeRevisionId && revision.claimId === claim.id)
            : undefined,
    ]) ?? []);
    const items: MemoryManagementQueryItem[] = [];
    for (const item of state.snapshot.items) {
        const governedClaim = item.claimId
            ? governedState?.claims.find(claim => claim.id === item.claimId)
            : undefined;
        const revision = governedClaim ? revisionByClaim.get(governedClaim.id) : undefined;
        const forgotten = item.lifecycle === "forgotten_marker";
        const permitted = forgotten
            || (governedClaim && revision ? provenanceAllowed(revision.provenance, boundary, state)
                : legacyProvenanceAllowed(item.provenance, boundary, state));
        if (!permitted) continue;
        items.push(projectItem(item, governedClaim?.activeRevisionId, revision, forgotten));
    }
    return items;
}

function provenanceAllowed(
    provenance: readonly PersistedMemoryProvenance[],
    _boundary: string,
    state: PreparedManagementState,
): boolean {
    if (provenance.length === 0) return false;
    return provenance.every(entry => {
        if (entry.kind === "note") return isPathAllowedState(state, entry.sourceRef.path);
        if (entry.kind === "conversation" || entry.kind === "explicit_setting"
            || entry.kind === "host_user_request") return true;
        return entry.dataBoundaryFingerprint === currentBoundary(state)
            && entry.representativeSourceRefs.every(ref => isPathAllowedState(state, ref.path));
    });
}

function legacyProvenanceAllowed(
    provenance: readonly MemoryControlCenterProvenance[],
    _boundary: string,
    state: PreparedManagementState,
): boolean {
    if (provenance.length === 0) return false;
    return provenance.every(entry => {
        if (entry.kind === "note") return isPathAllowedState(state, entry.sourceRef.path);
        if (entry.kind === "conversation" || entry.kind === "explicit_setting"
            || entry.kind === "host_user_request") return true;
        return entry.dataBoundaryFingerprint === currentBoundary(state)
            && entry.representativeSourceRefs.every(ref => isPathAllowedState(state, ref.path));
    });
}

function currentBoundary(state: PreparedManagementState): string {
    return state.deps.getDataBoundaryFingerprint();
}

function isPathAllowedState(state: PreparedManagementState, path: string): boolean {
    return state.settings.memoryEnabled === true && state.deps.isDataBoundaryAllowedPath(path);
}

function projectItem(
    item: MemoryControlCenterItem,
    revisionId: string | undefined,
    revision: MemoryClaimRevision | undefined,
    forgotten: boolean,
): MemoryManagementQueryItem {
    const governed = Boolean(item.claimId && revisionId && revision);
    const text = forgotten ? undefined : revision?.summary ?? item.label;
    const lifecycle = item.lifecycle;
    return {
        id: item.id,
        entityType: governed
            ? "governed_claim"
            : lifecycle === "forget_pending"
                ? "pending_forget"
                : item.origin === "user_profile"
                    ? "legacy_user_profile"
                    : item.origin === "vault_insights"
                        ? "vault_insight"
                        : "legacy_confirmed_memory",
        ...(item.claimId ? { claimId: item.claimId } : {}),
        ...(revisionId ? { revisionId } : {}),
        ...(!governed && !forgotten ? { legacyFingerprint: boundedMemoryFingerprint({ id: item.id, label: item.label, provenance: item.provenance }) } : {}),
        ...(text ? { text } : {}),
        authority: revision?.authority ?? item.authority,
        ...(item.scopeLabel && !forgotten ? { scope: item.scopeLabel } : {}),
        effect: forgotten ? "none" : item.effect,
        lifecycle,
        effectiveUse: lifecycle === "paused" ? "paused"
            : lifecycle !== "active" ? "stored_not_in_use"
            : item.effect === "future_answers" || item.effect === "collaboration_default" ? "active" : "stored_not_in_use",
        ...(item.observedAt && !forgotten ? { observedAt: item.observedAt } : {}),
        ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
        sources: forgotten ? [] : projectSources(revision?.provenance ?? item.provenance),
        supportedActions: [...item.supportedActions],
        detailTarget: {
            kind: "memory-settings",
            targetId: item.claimId ?? item.profileRecordId ?? item.id,
        },
    };
}

function projectSources(
    provenance: readonly (PersistedMemoryProvenance | MemoryControlCenterProvenance)[],
): MemoryManagementQueryItem["sources"] {
    const sources: MemoryManagementQueryItem["sources"] = [];
    for (const entry of provenance) {
        if (entry.kind === "note") {
            sources.push({ kind: "note", path: entry.sourceRef.path });
            continue;
        }
        if (entry.kind === "conversation") {
            const conversationIds = "conversationIds" in entry
                ? entry.conversationIds
                : [entry.conversationId];
            for (const conversationId of conversationIds.slice(0, 3)) {
                sources.push({ kind: "conversation", conversationId });
            }
            continue;
        }
        if (entry.kind === "explicit_setting") {
            sources.push({ kind: "setting", settingKey: entry.settingKey });
            continue;
        }
        if (entry.kind === "host_user_request") continue;
        sources.push({ kind: "vault_aggregate", generatedAt: entry.generatedAt });
    }
    return sources;
}

function matchesQuery(item: MemoryManagementQueryItem, input: MemoryManagementQueryInput): boolean {
    if (input.itemId) return item.id === input.itemId || item.claimId === input.itemId;
    if (input.lifecycle && !input.lifecycle.includes(item.lifecycle)) return false;
    if (!input.text) return true;
    const needle = input.text.toLowerCase();
    return item.text?.toLowerCase().includes(needle) === true
        || item.scope?.toLowerCase().includes(needle) === true;
}

function statusFingerprint(state: PreparedManagementState): string {
    return boundedMemoryFingerprint(statusOutput(state));
}

function actionStateFingerprint(
    state: PreparedManagementState,
    request: MemoryActionEvidenceRequest,
): string {
    const governed = state.governed;
    const claim = governed?.claims.find((candidate) => candidate.id === request.claimId);
    const revision = governed?.revisions.find((candidate) => candidate.id === request.revisionId);
    const event = governed?.changeEvents.find((candidate) => candidate.id === request.eventId);
    const queue = governed?.memoryQueueItems.find((candidate) => candidate.id === request.queueItemId);
    const pending = governed?.pendingOperations.filter((operation) => (
        operation.claimId === request.claimId
    )).map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        state: operation.kind === "profile_projection" ? operation.state : operation.phase,
    }));
    return boundedMemoryFingerprint({
        boundary: currentBoundary(state),
        memoryEnabled: state.settings.memoryEnabled,
        action: request.action,
        status: request.status,
        reason: request.reason,
        claim: claim && {
            id: claim.id,
            activeRevisionId: claim.activeRevisionId,
            lifecycle: claim.lifecycle,
            effect: claim.effect,
            partition: claim.partition,
        },
        revision: revision && { id: revision.id, claimId: revision.claimId },
        event: event && {
            id: event.id,
            claimId: event.claimId,
            kind: event.kind,
            undoesEventId: event.undoesEventId,
        },
        queue: queue && { id: queue.id, status: queue.status },
        pending,
        commitSequence: governed?.commitSequence,
    });
}

function actionResultIsCurrent(
    state: PreparedManagementState,
    request: MemoryActionEvidenceRequest,
): boolean {
    const governed = state.governed;
    if (!governed) return request.status === "failed" || request.status === "cancelled";
    if (request.status === "needs_confirmation") {
        return Boolean(request.queueItemId && governed.memoryQueueItems.some((item) => (
            item.id === request.queueItemId && item.status === "suggested"
        )));
    }
    if (request.status === "pending") {
        return Boolean(request.claimId && governed.pendingOperations.some((operation) => (
            operation.claimId === request.claimId
        )));
    }
    if (request.status === "failed" || request.status === "cancelled") return true;
    if (!request.claimId) return false;
    const claim = governed.claims.find((candidate) => candidate.id === request.claimId);
    if (!claim) return false;
    if (request.revisionId && claim.activeRevisionId !== request.revisionId) return false;
    if (request.eventId && !governed.changeEvents.some((event) => (
        event.id === request.eventId && event.claimId === request.claimId
    ))) return false;
    if (request.action === "pause_use") return claim.lifecycle === "paused";
    if (request.action === "resume_use") return claim.lifecycle === "active";
    if (request.action === "forget") return claim.lifecycle === "forgotten_tombstone";
    if (request.action === "retry_forget") {
        return !governed.pendingOperations.some((operation) => (
            operation.kind === "forget" && operation.claimId === claim.id
        ));
    }
    if (request.action === "apply_device_wide") {
        return claim.partition.kind === "device_collaboration" && claim.effect === "collaboration_default";
    }
    if (request.action === "limit_to_current_vault") return claim.partition.kind === "vault";
    if (request.action === "undo_recent_change") {
        return Boolean(request.eventId && governed.changeEvents.some((event) => (
            event.id === request.eventId && event.claimId === claim.id && event.kind === "undo"
        )));
    }
    return Boolean(request.revisionId && claim.activeRevisionId === request.revisionId);
}

function queryStateFingerprint(state: PreparedManagementState, input: MemoryManagementQueryInput): string {
    return boundedMemoryFingerprint({
        boundary: currentBoundary(state),
        memoryEnabled: state.settings.memoryEnabled,
        query: stableQueryKey(input),
        items: permittedItems(state).filter(item => matchesQuery(item, input)).map(item => ({
            id: item.id, claimId: item.claimId, revisionId: item.revisionId,
            lifecycle: item.lifecycle, effect: item.effect, sources: item.sources,
            updatedAt: item.updatedAt, legacyFingerprint: item.legacyFingerprint,
        })),
    });
}

function usageStateFingerprint(
    state: PreparedManagementState,
    input: { conversationId?: string; turnId?: string },
    records: readonly MemoryManagementUsageRecord[],
): string {
    const referencedClaimIds = new Set(records.flatMap(record => [
        ...record.claims.map(claim => claim.claimId),
        ...(record.contextClaims ?? []).map(claim => claim.claimId),
    ]));
    const referencedExactRevisions = new Set(records.flatMap(record => record.claims.map(claim => `${claim.claimId}:${claim.revisionId}`)));
    const exactClaimIds = new Set(records.flatMap(record => record.claims.map(claim => claim.claimId)));
    const contextOnlyClaimIds = new Set(records.flatMap(record => (record.contextClaims ?? []).map(claim => claim.claimId)));
    return boundedMemoryFingerprint({
        memoryEnabled: state.settings.memoryEnabled,
        boundary: currentBoundary(state),
        conversationId: input.conversationId,
        turnId: input.turnId,
        claims: (state.governed?.claims ?? []).filter(claim => referencedClaimIds.has(claim.id)).map(claim => {
            const referencedRevisions = (state.governed?.revisions ?? [])
                .filter(revision => referencedExactRevisions.has(`${claim.id}:${revision.id}`));
            const contextOnly = contextOnlyClaimIds.has(claim.id) && !exactClaimIds.has(claim.id);
            const activeRevision = contextOnly && claim.activeRevisionId
                ? state.governed?.revisions.find(revision => revision.id === claim.activeRevisionId && revision.claimId === claim.id)
                : undefined;
            return {
            id: claim.id,
            lifecycle: claim.lifecycle,
                contextOnly,
            referencedRevisions: referencedRevisions.map(revision => ({
                id: revision.id,
                disclosable: provenanceAllowed(revision.provenance, "", state),
            })),
                ...(contextOnly ? {
                    contextDisclosable: activeRevision
                        ? provenanceAllowed(activeRevision.provenance, "", state)
                        : false,
                } : {}),
            };
        }) ?? [],
    });
}

function stableQueryKey(input: MemoryManagementQueryInput): string {
    return JSON.stringify([
        input.text ?? null,
        input.itemId ?? null,
        input.lifecycle ? [...input.lifecycle].sort() : null,
    ]);
}

function encodeCursor(value: { query: string; stateFingerprint: string; offset: number }): string {
    return encodeBase64Url(JSON.stringify(value));
}

function decodeCursor(value: string): { query: string; stateFingerprint: string; offset: number } | null {
    try {
        const parsed = JSON.parse(decodeBase64Url(value)) as Record<string, unknown>;
        if (typeof parsed.query !== "string" || typeof parsed.stateFingerprint !== "string") return null;
        if (typeof parsed.offset !== "number" || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) return null;
        return { query: parsed.query, stateFingerprint: parsed.stateFingerprint, offset: parsed.offset };
    } catch {
        return null;
    }
}

function encodeBase64Url(value: string): string {
    return btoa(encodeURIComponent(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(atob(normalized));
}

function queryRequestFromEvidence(request: Record<string, string> | undefined): MemoryManagementQueryInput {
    const lifecycle = request?.lifecycle?.split(",").filter(Boolean);
    const limit = Number.parseInt(request?.limit ?? "", 10);
    const cursor = request?.cursor;
    return {
        ...(request?.text ? { text: request.text } : {}),
        ...(request?.itemId ? { itemId: request.itemId } : {}),
        ...(lifecycle?.length ? { lifecycle: lifecycle as MemoryManagementQueryInput["lifecycle"] } : {}),
        limit: Number.isSafeInteger(limit) && limit >= 1 && limit <= 20 ? limit : 10,
        ...(cursor ? { cursor } : {}),
    };
}

function usageRequestFromEvidence(request: Record<string, string> | undefined): { conversationId?: string; turnId?: string } {
    return {
        ...(request?.conversationId ? { conversationId: request.conversationId } : {}),
        ...(request?.turnId ? { turnId: request.turnId } : {}),
    };
}

async function usagePrepared(
    state: PreparedManagementState,
    input: { conversationId?: string; turnId?: string },
    currentUsage?: () => MemoryManagementCurrentUsageInput | undefined,
    captureLifetime?: (lifetime: () => boolean) => void,
): Promise<MemoryManagementUsageOutput | MemoryManagementUnavailableOutput<"current_run" | "history">> {
    if (!state.settings.memoryEnabled) {
        return {
            kind: "memory-usage",
            available: false,
            reason: "memory_disabled",
            target: input.conversationId ? "history" : "current_run",
            memoryEnabled: false,
            contentAvailable: false,
            records: [],
            evidenceLevel: "unknown",
        };
    }
    if (!input.conversationId) return currentUsageOutput(state, currentUsage?.());
    return await historyUsageOutput(state, input as { conversationId: string; turnId?: string }, captureLifetime);
}

function currentUsageOutput(
    state: PreparedManagementState,
    current: MemoryManagementCurrentUsageInput | undefined,
): MemoryManagementUsageOutput {
    const records: MemoryManagementUsageRecord[] = [];
    if (current?.writingGenerationInput) {
        records.push({
            evidenceLevel: "writing_generation_snapshot",
            disclosure: "dispatch_snapshot",
            claims: permittedHistoricalClaims(state, identifiedClaims(current.writingGenerationInput.personal)),
        });
    }
    const contextClaims = [
        ...(current?.governedMemoryTrace ?? []).map(trace => ({ claimId: trace.claimId })),
        ...(current?.generationInputSources?.personal.state === "identified"
            ? current.generationInputSources.personal.revisions
            : []),
    ];
    if (!current?.writingGenerationInput && contextClaims.length > 0) {
        records.push({
            evidenceLevel: "context_record",
            disclosure: "selection_record",
            claims: [],
            contextClaims: permittedHistoricalContextClaims(state, contextClaims),
        });
    }
    return {
        kind: "memory-usage",
        available: true,
        target: "current_run",
        memoryEnabled: true,
        evidenceLevel: records.some(record => record.evidenceLevel === "writing_generation_snapshot")
            ? "writing_generation_snapshot"
            : records.some(record => record.evidenceLevel === "context_record") ? "context_record" : "unknown",
        records,
    };
}

async function historyUsageOutput(
    state: PreparedManagementState,
    input: { conversationId: string; turnId?: string },
    captureLifetime?: (lifetime: () => boolean) => void,
): Promise<MemoryManagementUsageOutput | MemoryManagementUnavailableOutput<"history">> {
    const unavailable = (reason: MemoryManagementUnavailableOutput<"history">["reason"]): MemoryManagementUnavailableOutput<"history"> => ({
        kind: "memory-usage",
        available: false,
        reason,
        target: "history",
        memoryEnabled: true,
        contentAvailable: false,
        records: [],
        evidenceLevel: "unknown",
    });
    const manager = state.deps.getHistoryManager();
    if (!manager || !manager.isAvailable()) return unavailable("history_unavailable");
    const lifetime = manager.captureSourceLifetime(input.conversationId);
    captureLifetime?.(lifetime);
    return await readHistoryPromise(state, manager, input, lifetime);
}

async function readHistoryPromise(
    state: PreparedManagementState,
    manager: ChatHistoryManager,
    input: { conversationId: string; turnId?: string },
    lifetime: () => boolean,
): Promise<MemoryManagementUsageOutput | MemoryManagementUnavailableOutput<"history">> {
    const unavailable = (reason: MemoryManagementUnavailableOutput<"history">["reason"]): MemoryManagementUnavailableOutput<"history"> => ({
        kind: "memory-usage" as const,
        available: false as const,
        reason,
        target: "history" as const,
        memoryEnabled: true,
        contentAvailable: false,
        records: [],
        evidenceLevel: "unknown" as const,
    });
    const versions = state.deps.getWritingVersions();
    try {
        const turns = await manager.getTurns(input.conversationId);
        const turn = turns.find(candidate => input.turnId === `rehydrated:${input.conversationId}:${candidate.turnIndex}`);
        if (!turn) return unavailable(input.turnId ? "turn_not_found" : "turn_not_found");
        if (!lifetime()) return unavailable("source_changed");
        const records: MemoryManagementUsageRecord[] = [];
        const writingVersionId = turn.assistant.writingVersionId;
        if (writingVersionId && versions) {
            const version = await versions.get(writingVersionId);
            if (!lifetime() || state.deps.getHistoryManager() !== manager || state.deps.getWritingVersions() !== versions) {
                return unavailable("source_changed");
            }
            if (version?.generationInput) {
                records.push({
                    conversationId: input.conversationId,
                    turnId: input.turnId,
                    turnIndex: turn.turnIndex,
                    evidenceLevel: "writing_generation_snapshot",
                    disclosure: "dispatch_snapshot",
                    claims: permittedHistoricalClaims(state, identifiedClaims(version.generationInput.personal)),
                    writingVersionId,
                });
            }
        }
        const contextClaims = (turn.contextUsed ?? [])
            .filter(item => item.category === "memory" && item.memoryClaimId)
            .map(item => ({ claimId: item.memoryClaimId!, revisionId: undefined }));
        if (contextClaims.length > 0) {
            records.push({
                conversationId: input.conversationId,
                turnId: input.turnId,
                turnIndex: turn.turnIndex,
                evidenceLevel: "context_record",
                disclosure: "selection_record",
                claims: [],
                contextClaims: permittedHistoricalContextClaims(state, contextClaims),
            });
        }
        return {
            kind: "memory-usage",
            available: true,
            target: "history",
            memoryEnabled: true,
            evidenceLevel: records.some(record => record.evidenceLevel === "writing_generation_snapshot")
                ? "writing_generation_snapshot"
                : records.some(record => record.evidenceLevel === "context_record") ? "context_record" : "unknown",
            records,
        };
    } catch {
        return unavailable("source_changed");
    }
}

function identifiedClaims(personal: GenerationInputPersonalSource): Array<{ claimId: string; revisionId: string }> {
    return personal.state === "identified" ? personal.revisions : [];
}

function permittedHistoricalClaims(
    state: PreparedManagementState,
    claims: Array<{ claimId: string; revisionId: string }>,
): Array<{ claimId: string; revisionId: string }> {
    return claims.filter(({ claimId, revisionId }) => {
        const claim = state.governed?.claims.find(candidate => candidate.id === claimId);
        const revision = state.governed?.revisions.find(candidate => candidate.id === revisionId && candidate.claimId === claimId);
        return claim && revision && claim.lifecycle !== "forgotten_tombstone" && claim.lifecycle !== "forget_pending"
            && provenanceAllowed(revision.provenance, "", state);
    });
}

function permittedHistoricalContextClaims(
    state: PreparedManagementState,
    claims: Array<{ claimId: string; revisionId?: string }>,
): Array<{ claimId: string; revisionId?: string }> {
    return claims.filter(({ claimId, revisionId }) => {
        const claim = state.governed?.claims.find(candidate => candidate.id === claimId);
        const activeRevisionId = claim?.activeRevisionId;
        const revision = state.governed?.revisions.find(candidate => (
            candidate.claimId === claimId
            && candidate.id === (revisionId ?? activeRevisionId)
        ));
        return Boolean(claim && revision
            && claim.lifecycle !== "forgotten_tombstone"
            && claim.lifecycle !== "forget_pending"
            && provenanceAllowed(revision.provenance, "", state));
    });
}
