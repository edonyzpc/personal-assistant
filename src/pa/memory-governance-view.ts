import type { PersistedSourceRef, ReviewQueueScope } from "./contracts";
import { cloneScope, cloneSourceRef } from "./helpers";
import type { ConfirmedMemoryRecord } from "./memory-governance-store";
import type {
    DeviceMemoryGovernanceStateV1,
    GovernedMemoryClaim,
    MemoryChangeEvent,
    MemoryClaimRevision,
    MemoryProjectionLink,
    PersistedMemoryProvenance,
} from "./memory-governance-persistence";
import type { MemoryControlCenterEffect } from "./memory-control-center";

const DEFAULT_RECENT_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type GovernedMemoryUseStatus = "active" | "paused" | "stored_not_in_use";

export interface GovernedMemoryRecordView {
    claimId: string;
    record: ConfirmedMemoryRecord;
    authority: MemoryClaimRevision["authority"];
    effect: GovernedMemoryClaim["effect"];
    useStatus: GovernedMemoryUseStatus;
    provenance: PersistedMemoryProvenance[];
    projectionLinks: MemoryProjectionLink[];
}

export interface GovernedMemoryRecentChangeView {
    id: string;
    claimId: string;
    kind: MemoryChangeEvent["kind"];
    occurredAt: string;
    summary?: string;
    sourcePath?: string;
    scope?: ReviewQueueScope;
    effect?: GovernedMemoryClaim["effect"];
    status?: "active" | "paused" | "restored" | "forgotten";
    undoAvailable: boolean;
    redacted: boolean;
}

/** Content-free recovery status for a permanent Forget that still has exact cleanup work. */
export interface GovernedMemoryPendingForgetView {
    claimId: string;
    updatedAt: string;
}

export interface GovernedMemoryViewSnapshot {
    records: GovernedMemoryRecordView[];
    recentChanges: GovernedMemoryRecentChangeView[];
    pendingForgets: GovernedMemoryPendingForgetView[];
}

/**
 * Pure UI projection over the authoritative device-local state. It never
 * fabricates note provenance for conversation/setting evidence and never
 * reconstructs forgotten content from recovery state.
 */
export function buildGovernedMemoryViewSnapshot(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    options: { now?: Date; recentWindowMs?: number } = {},
): GovernedMemoryViewSnapshot {
    const vaultKey = opaqueVaultKey.trim();
    if (!vaultKey) return { records: [], recentChanges: [], pendingForgets: [] };
    const now = options.now ?? new Date();
    const recentWindowMs = Math.max(0, options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS);
    const revisionById = new Map(state.revisions.map((revision) => [revision.id, revision]));
    const linksByClaim = groupLinksByClaim(state.projectionLinks);
    const claims = state.claims.filter((claim) => partitionVisibleInVault(claim, vaultKey));
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));

    const records = claims
        .filter((claim) => claim.lifecycle !== "forget_pending")
        .map((claim) => buildRecordView(claim, revisionById, linksByClaim.get(claim.id) ?? []))
        .filter((view): view is GovernedMemoryRecordView => view !== null)
        .sort((left, right) => right.record.updatedAt.localeCompare(left.record.updatedAt));
    const pendingForgets = state.pendingOperations
        .filter((operation) => (
            operation.kind === "forget"
            && partitionVisibleForVault(operation.partition, vaultKey)
            && claims.some((claim) => (
                claim.id === operation.claimId && claim.lifecycle === "forget_pending"
            ))
        ))
        .map((operation) => ({
            claimId: operation.claimId,
            updatedAt: operation.updatedAt,
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    const cutoff = now.getTime() - recentWindowMs;
    const undoById = new Map(state.undoSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const latestEventIdByClaim = new Map<string, string>();
    for (const event of state.changeEvents) latestEventIdByClaim.set(event.claimId, event.id);
    const recentChanges = state.changeEvents
        .filter((event) => {
            const occurredAt = Date.parse(event.occurredAt);
            return Number.isFinite(occurredAt) && occurredAt >= cutoff && occurredAt <= now.getTime();
        })
        .filter((event) => claimById.has(event.claimId)
            || event.kind === "forget" && event.scopeKey === `vault:${vaultKey}`)
        .map((event) => buildRecentChange(
            event,
            claimById,
            revisionById,
            undoById,
            now,
            latestEventIdByClaim.get(event.claimId) === event.id,
            vaultKey,
        ))
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

    return { records, recentChanges, pendingForgets };
}

function buildRecordView(
    claim: GovernedMemoryClaim,
    revisionById: ReadonlyMap<string, MemoryClaimRevision>,
    links: readonly MemoryProjectionLink[],
): GovernedMemoryRecordView | null {
    if (claim.lifecycle === "forgotten_tombstone") {
        const record: ConfirmedMemoryRecord = {
            id: claim.id,
            type: claim.memoryType,
            lifecycle: "forgotten_tombstone",
            sensitivity: claim.sensitivity,
            scope: cloneScope(claim.applicability),
            sourceRefs: [],
            summary: "",
            createdAt: claim.createdAt,
            updatedAt: claim.updatedAt,
            forgottenAt: claim.updatedAt,
            tombstoneReason: "user_forget",
        };
        return {
            claimId: claim.id,
            record,
            authority: "source_observation",
            effect: "none",
            useStatus: "stored_not_in_use",
            provenance: [],
            projectionLinks: links.map(cloneProjectionLink),
        };
    }
    if (!claim.activeRevisionId) return null;
    const revision = revisionById.get(claim.activeRevisionId);
    if (!revision || revision.claimId !== claim.id || !revision.summary.trim()) return null;
    const originQueueItemId = links
        .find((link) => link.state === "active" && link.target.kind === "review_queue")
        ?.target;
    const record: ConfirmedMemoryRecord = {
        id: claim.id,
        type: claim.memoryType,
        lifecycle: legacyLifecycleForClaim(claim),
        sensitivity: claim.sensitivity,
        scope: cloneScope(claim.applicability),
        sourceRefs: collectNoteSourceRefs(revision),
        summary: revision.summary,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
        confirmedAt: claim.createdAt,
        confirmationStrength: revision.authority === "pa_inference" ? "auto" : "explicit",
        confirmationSource: "memory_panel",
        updatePolicy: claim.memoryType === "task_constraint"
            ? "ask-before-cross-scope-use"
            : "manual-only",
        ...(originQueueItemId?.kind === "review_queue"
            ? { originReviewQueueItemId: originQueueItemId.itemId }
            : {}),
    };
    return {
        claimId: claim.id,
        record,
        authority: revision.authority,
        effect: claim.effect,
        useStatus: useStatusForClaim(claim),
        provenance: revision.provenance.map(clonePersistedProvenance),
        projectionLinks: links.map(cloneProjectionLink),
    };
}

function buildRecentChange(
    event: MemoryChangeEvent,
    claimById: ReadonlyMap<string, GovernedMemoryClaim>,
    revisionById: ReadonlyMap<string, MemoryClaimRevision>,
    undoById: ReadonlyMap<string, DeviceMemoryGovernanceStateV1["undoSnapshots"][number]>,
    now: Date,
    isLatest: boolean,
    vaultKey: string,
): GovernedMemoryRecentChangeView {
    if (event.kind === "forget") {
        return {
            id: event.id,
            claimId: event.claimId,
            kind: "forget",
            occurredAt: event.occurredAt,
            status: "forgotten",
            undoAvailable: false,
            redacted: true,
        };
    }
    const claim = claimById.get(event.claimId);
    const snapshot = event.undoSnapshotId ? undoById.get(event.undoSnapshotId) : undefined;
    const restoreSnapshot = snapshot?.restoreMode === "remove_added_claim"
        ? undefined
        : snapshot;
    const detailClaim = isLatest ? claim : restoreSnapshot?.claim;
    const detailRevision = isLatest
        ? claim?.activeRevisionId ? revisionById.get(claim.activeRevisionId) : undefined
        : restoreSnapshot?.claim.activeRevisionId
            ? restoreSnapshot.revisions.find((revision) => revision.id === restoreSnapshot.claim.activeRevisionId)
            : undefined;
    const sourcePath = detailRevision ? collectNoteSourceRefs(detailRevision)[0]?.path : undefined;
    const expiresAt = Date.parse(snapshot?.expiresAt ?? "");
    return {
        id: event.id,
        claimId: event.claimId,
        kind: event.kind,
        occurredAt: event.occurredAt,
        ...(isLatest && detailRevision?.summary ? { summary: detailRevision.summary } : {}),
        ...(sourcePath ? { sourcePath } : {}),
        ...(detailClaim ? { scope: cloneScope(detailClaim.applicability) } : {}),
        effect: event.effect,
        status: recentStatus(event),
        undoAvailable: Boolean(isLatest
            && snapshot
            && partitionVisibleForUndo(snapshot.partition, vaultKey)
            && Number.isFinite(expiresAt)
            && expiresAt >= now.getTime()),
        redacted: false,
    };
}

function partitionVisibleForUndo(
    partition: GovernedMemoryClaim["partition"],
    vaultKey: string,
): boolean {
    return partition.kind === "device_collaboration"
        || partition.key === vaultKey;
}

function collectNoteSourceRefs(revision: MemoryClaimRevision): PersistedSourceRef[] {
    const byPath = new Map<string, PersistedSourceRef>();
    for (const provenance of revision.provenance) {
        if (provenance.kind === "note") {
            byPath.set(provenance.sourceRef.path, cloneSourceRef(provenance.sourceRef));
        } else if (provenance.kind === "vault_aggregate") {
            for (const sourceRef of provenance.representativeSourceRefs) {
                byPath.set(sourceRef.path, cloneSourceRef(sourceRef));
            }
        }
    }
    return [...byPath.values()];
}

function legacyLifecycleForClaim(claim: GovernedMemoryClaim): ConfirmedMemoryRecord["lifecycle"] {
    if (claim.lifecycle === "paused" || claim.lifecycle === "archived") return "archived";
    if (claim.lifecycle === "stale") return "stale";
    return "active";
}

function useStatusForClaim(claim: GovernedMemoryClaim): GovernedMemoryUseStatus {
    if (claim.lifecycle === "paused") return "paused";
    if (claim.lifecycle !== "active") return "stored_not_in_use";
    return claim.effect === "future_answers" || claim.effect === "collaboration_default"
        ? "active"
        : "stored_not_in_use";
}

function recentStatus(
    event: MemoryChangeEvent,
): GovernedMemoryRecentChangeView["status"] {
    if (event.kind === "undo" || event.kind === "resume") return "restored";
    if (event.kind === "pause" || event.kind === "auto_remove") return "paused";
    return "active";
}

function partitionVisibleInVault(claim: GovernedMemoryClaim, vaultKey: string): boolean {
    return partitionVisibleForVault(claim.partition, vaultKey);
}

function partitionVisibleForVault(
    partition: GovernedMemoryClaim["partition"],
    vaultKey: string,
): boolean {
    return partition.kind === "vault"
        ? partition.key === vaultKey
        : partition.kind === "device_collaboration" && partition.key === "device";
}

function groupLinksByClaim(
    links: readonly MemoryProjectionLink[],
): Map<string, MemoryProjectionLink[]> {
    const grouped = new Map<string, MemoryProjectionLink[]>();
    for (const link of links) {
        const existing = grouped.get(link.claimId) ?? [];
        existing.push(link);
        grouped.set(link.claimId, existing);
    }
    return grouped;
}

function cloneProjectionLink(link: MemoryProjectionLink): MemoryProjectionLink {
    return {
        ...link,
        target: { ...link.target },
    };
}

function clonePersistedProvenance(provenance: PersistedMemoryProvenance): PersistedMemoryProvenance {
    if (provenance.kind === "note") {
        return { kind: "note", sourceRef: cloneSourceRef(provenance.sourceRef) };
    }
    if (provenance.kind === "conversation") {
        return {
            kind: "conversation",
            conversationIds: [...provenance.conversationIds],
            observedAt: provenance.observedAt,
        };
    }
    if (provenance.kind === "explicit_setting") return { ...provenance };
    return {
        ...provenance,
        representativeSourceRefs: provenance.representativeSourceRefs.map(cloneSourceRef),
    };
}

// Keep the imported effect type visible to API extractors that consume this
// module without walking through the persistence file.
export type GovernedMemoryEffect = MemoryControlCenterEffect;
