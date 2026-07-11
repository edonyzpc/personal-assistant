import type {
    GovernedMemoryClaim,
    MemoryGovernanceRepository,
    MemoryProfileProjectionOperation,
} from "./memory-governance-persistence";

export interface MemoryProfileProjectionApplyInput {
    operationId: string;
    claimId: string;
    profileRecordId: string;
    targetRevisionId: string;
    summary: string;
    occurredAt: string;
}

export interface MemoryProfileProjectionRemoveInput {
    operationId: string;
    claimId: string;
    profileRecordId: string;
    occurredAt: string;
}

export interface MemoryProfileProjectionWorkerOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    applyProjection: (input: MemoryProfileProjectionApplyInput) => Promise<void>;
    removeProjection?: (input: MemoryProfileProjectionRemoveInput) => Promise<void>;
    now?: () => Date;
}

export interface MemoryProfileProjectionWorkerResult {
    completed: string[];
    pending: string[];
}

/**
 * Resumes the durable governance-to-ProfileStore outbox. The governed claim is
 * prompt-authoritative; this worker updates only the exact compatibility/view
 * projection identified by immutable profileRecordId.
 */
export class MemoryProfileProjectionWorker {
    private readonly repository: MemoryGovernanceRepository;
    private readonly opaqueVaultKey: string;
    private readonly applyProjection: MemoryProfileProjectionWorkerOptions["applyProjection"];
    private readonly removeProjection: MemoryProfileProjectionWorkerOptions["removeProjection"];
    private readonly now: () => Date;
    private mutationTail: Promise<void> = Promise.resolve();

    constructor(options: MemoryProfileProjectionWorkerOptions) {
        this.repository = options.repository;
        this.opaqueVaultKey = options.opaqueVaultKey.trim();
        this.applyProjection = options.applyProjection;
        this.removeProjection = options.removeProjection;
        this.now = options.now ?? (() => new Date());
    }

    resumePending(): Promise<MemoryProfileProjectionWorkerResult> {
        return this.serialize(async () => {
            if (!this.opaqueVaultKey) return { completed: [], pending: [] };
            const snapshot = await this.repository.initialize();
            const operations = snapshot.pendingOperations
                .filter((operation): operation is MemoryProfileProjectionOperation => (
                    operation.kind === "profile_projection" && operation.state === "pending"
                ))
                .filter((operation) => snapshot.claims.some((claim) => (
                    claim.id === operation.claimId
                    && (claim.partition.kind === "device_collaboration"
                        || claim.partition.kind === "vault" && claim.partition.key === this.opaqueVaultKey)
                )))
                .filter((operation) => {
                    if (operation.action !== "remove") return true;
                    if (operation.ownerVaultKey) {
                        return operation.ownerVaultKey === this.opaqueVaultKey;
                    }
                    const claim = snapshot.claims.find((candidate) => candidate.id === operation.claimId);
                    return claim?.partition.kind !== "device_collaboration";
                })
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
                    || left.id.localeCompare(right.id));
            const completed: string[] = [];
            const pending: string[] = [];
            for (const operation of operations) {
                const result = await this.applyOne(operation.id);
                (result ? completed : pending).push(operation.claimId);
            }
            return { completed, pending };
        });
    }

    private async applyOne(operationId: string): Promise<boolean> {
        const snapshot = await this.repository.initialize();
        const operation = snapshot.pendingOperations.find((candidate): candidate is MemoryProfileProjectionOperation => (
            candidate.kind === "profile_projection"
            && candidate.id === operationId
            && candidate.state === "pending"
        ));
        if (!operation) return true;
        const claim = snapshot.claims.find((candidate) => candidate.id === operation.claimId);
        if (operation.action === "remove") {
            return this.removeOne(operation, claim);
        }
        const revision = snapshot.revisions.find((candidate) => (
            candidate.id === operation.targetRevisionId && candidate.claimId === operation.claimId
        ));
        const exactLink = snapshot.projectionLinks.find((link) => (
            link.claimId === operation.claimId
            && link.state === "active"
            && link.target.kind === "type_a_profile"
            && link.target.profileRecordId === operation.profileRecordId
        ));
        if (!claim || claim.lifecycle === "forget_pending" || claim.lifecycle === "forgotten_tombstone"
            || !revision || !exactLink || claim.activeRevisionId !== revision.id) {
            await this.recordFailure(operationId, "profile_projection_state_changed");
            return false;
        }

        try {
            await this.applyProjection({
                operationId,
                claimId: claim.id,
                profileRecordId: operation.profileRecordId,
                targetRevisionId: revision.id,
                summary: revision.summary,
                occurredAt: this.now().toISOString(),
            });
        } catch {
            await this.recordFailure(operationId, "profile_projection_apply_failed");
            return false;
        }

        await this.repository.transact((draft) => {
            const current = draft.pendingOperations.find((candidate): candidate is MemoryProfileProjectionOperation => (
                candidate.kind === "profile_projection" && candidate.id === operationId
            ));
            if (!current || current.state === "applied" || current.action === "remove") return;
            const currentClaim = draft.claims.find((candidate) => candidate.id === current.claimId);
            if (!currentClaim || currentClaim.activeRevisionId !== current.targetRevisionId
                || currentClaim.lifecycle === "forget_pending"
                || currentClaim.lifecycle === "forgotten_tombstone") {
                current.attemptCount += 1;
                current.updatedAt = this.now().toISOString();
                current.lastErrorCode = "profile_projection_state_changed";
                return;
            }
            current.state = "applied";
            current.attemptCount += 1;
            current.updatedAt = this.now().toISOString();
            delete current.lastErrorCode;
        });
        const readback = await this.repository.initialize();
        return readback.pendingOperations.some((candidate) => (
            candidate.kind === "profile_projection"
            && candidate.id === operationId
            && candidate.state === "applied"
        ));
    }

    private async removeOne(
        operation: Extract<MemoryProfileProjectionOperation, { action: "remove" }>,
        claim: GovernedMemoryClaim | undefined,
    ): Promise<boolean> {
        if (!claim || !this.removeProjection) {
            await this.recordFailure(operation.id, "profile_projection_remove_unavailable");
            return false;
        }
        const snapshot = await this.repository.initialize();
        const exactLink = snapshot.projectionLinks.find((link) => (
            link.id === operation.projectionLinkId
            && link.claimId === operation.claimId
            && link.target.kind === "type_a_profile"
            && link.target.profileRecordId === operation.profileRecordId
        ));
        if (!exactLink) {
            await this.recordFailure(operation.id, "profile_projection_remove_link_missing");
            return false;
        }
        try {
            await this.removeProjection({
                operationId: operation.id,
                claimId: operation.claimId,
                profileRecordId: operation.profileRecordId,
                occurredAt: this.now().toISOString(),
            });
        } catch {
            await this.recordFailure(operation.id, "profile_projection_remove_failed");
            return false;
        }
        await this.repository.transact((draft) => {
            const current = draft.pendingOperations.find((candidate): candidate is MemoryProfileProjectionOperation => (
                candidate.kind === "profile_projection" && candidate.id === operation.id
            ));
            if (!current || current.state === "applied" || current.action !== "remove") return;
            const currentLink = draft.projectionLinks.find((link) => (
                link.id === current.projectionLinkId
                && link.claimId === current.claimId
                && link.target.kind === "type_a_profile"
                && link.target.profileRecordId === current.profileRecordId
            ));
            if (!currentLink) {
                current.attemptCount += 1;
                current.updatedAt = this.now().toISOString();
                current.lastErrorCode = "profile_projection_remove_link_missing";
                return;
            }
            currentLink.state = "redacted";
            current.state = "applied";
            current.attemptCount += 1;
            current.updatedAt = this.now().toISOString();
            delete current.lastErrorCode;
        });
        const readback = await this.repository.initialize();
        return readback.pendingOperations.some((candidate) => (
            candidate.kind === "profile_projection"
            && candidate.id === operation.id
            && candidate.action === "remove"
            && candidate.state === "applied"
        ));
    }

    private async recordFailure(operationId: string, code: string): Promise<void> {
        await this.repository.transact((draft) => {
            const operation = draft.pendingOperations.find((candidate): candidate is MemoryProfileProjectionOperation => (
                candidate.kind === "profile_projection" && candidate.id === operationId
            ));
            if (!operation || operation.state === "applied") return;
            operation.attemptCount += 1;
            operation.updatedAt = this.now().toISOString();
            operation.lastErrorCode = code;
        });
    }

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutationTail.then(operation, operation);
        this.mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }
}
