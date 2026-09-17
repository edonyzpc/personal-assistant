import {
    deriveSemanticProfileKey,
    deriveUserProfileRecordId,
} from "../ai-services/memory-extraction";
import {
    memoryActionFingerprint,
    memoryActionIdentity,
    type MemoryActionResult,
    type MemoryActionPort,
    type MemoryActionPortInput,
} from "../ai-services/memory-action-types";
import { stableHash } from "./helpers";
import type {
    MemoryAdmissionCoordinator,
    TypeAAdmissionBaseline,
} from "./memory-admission-coordinator";
import type {
    DeviceMemoryGovernanceStateV1,
    MemoryGovernanceRepository,
    PersistedMemoryProvenance,
} from "./memory-governance-persistence";
import type { MemoryProfileProjectionWorker } from "./memory-profile-projection-worker";

export interface MemoryActionGovernanceResult {
    status: "applied" | "pending" | "needs_confirmation" | "cancelled" | "failed";
    reason?: string;
    claimId?: string;
    revisionId?: string;
    eventId?: string;
    queueItemId?: string;
    undoExpiresAt?: string;
    retryScheduled?: boolean;
}

export interface MemoryActionPortDependencies {
    isRuntimeCurrent(): boolean;
    getSettings(): { memoryEnabled: boolean; learningEnabled: boolean };
    getAdmissionCoordinator(): MemoryAdmissionCoordinator | null;
    getRepository(): MemoryGovernanceRepository | null;
    getProfileProjectionWorker(): MemoryProfileProjectionWorker | null;
    captureTypeABaseline(): Promise<TypeAAdmissionBaseline>;
    getDataBoundaryFingerprint(): string;
    executeGovernedAction(input: MemoryActionPortInput): Promise<MemoryActionGovernanceResult>;
    refreshState(): Promise<void>;
    scheduleProfileProjectionRetry?(): void;
    log(message: string, metadata?: Record<string, unknown>): void;
    now?(): Date;
}

export function createMemoryActionPort(
    dependencies: MemoryActionPortDependencies,
): MemoryActionPort {
    const settings = () => dependencies.getSettings();
    const base = (action: MemoryActionPortInput["action"]): MemoryActionResult => ({
        kind: "memory-action",
        action,
        status: "failed",
        memoryEnabled: settings().memoryEnabled,
        learningEnabled: settings().learningEnabled,
    });

    return {
        execute: async input => {
            if (!dependencies.isRuntimeCurrent() || !input.binding.isCurrent()) {
                return { ...base(input.action), reason: "action_request_not_current" };
            }
            if (!input.binding.userPrompt.includes(input.userExpression)) {
                return { ...base(input.action), reason: "user_expression_not_from_current_prompt" };
            }
            if (input.action === "remember") return remember(input);
            const governed = await dependencies.executeGovernedAction(input);
            return {
                ...base(input.action),
                status: governed.status,
                ...(governed.reason ? { reason: governed.reason } : {}),
                ...(governed.claimId ? {
                    claimId: governed.claimId,
                    detailTarget: { kind: "memory-settings", targetId: governed.claimId },
                } : {}),
                ...(governed.revisionId ? { revisionId: governed.revisionId } : {}),
                ...(governed.eventId ? { eventId: governed.eventId } : {}),
                ...(governed.queueItemId ? { queueItemId: governed.queueItemId } : {}),
                ...(governed.undoExpiresAt ? { undoExpiresAt: governed.undoExpiresAt } : {}),
                ...(governed.retryScheduled ? { retryScheduled: true } : {}),
            };
        },
    };

    async function remember(input: MemoryActionPortInput): Promise<MemoryActionResult> {
        const coordinator = dependencies.getAdmissionCoordinator();
        const repository = dependencies.getRepository();
        if (!coordinator || !repository) {
            return { ...base(input.action), reason: "governance_unavailable" };
        }
        const content = input.content?.trim();
        const profileKey = content ? deriveSemanticProfileKey(content) : "";
        if (!content || !profileKey || !input.memoryType || !input.sensitivity) {
            return { ...base(input.action), reason: "content_invalid" };
        }

        const dataBoundaryFingerprint = dependencies.getDataBoundaryFingerprint();
        const requestIsCurrent = () => dependencies.isRuntimeCurrent()
            && input.binding.isCurrent()
            && dependencies.getDataBoundaryFingerprint() === dataBoundaryFingerprint;
        if (!requestIsCurrent()) {
            return { ...base(input.action), reason: "action_request_not_current" };
        }

        let baseline: TypeAAdmissionBaseline;
        try {
            baseline = await dependencies.captureTypeABaseline();
        } catch {
            return { ...base(input.action), reason: "target_baseline_unavailable" };
        }
        const identitySeed = input.binding.conversationId ?? input.binding.runId;
        const profileRecordId = baseline.profileRecordIdsByKey?.[profileKey]
            ?? deriveUserProfileRecordId(profileKey, [identitySeed]);
        const expectedTargetState = baseline.targets[profileRecordId] ?? {
            state: "absent" as const,
            profileRecordId,
        };
        let conflict: "absent" | "present" = "absent";
        if (expectedTargetState.state === "present") {
            const state = await repository.initialize();
            const claim = state.claims.find((candidate) => candidate.id === expectedTargetState.claimId);
            const revision = state.revisions.find((candidate) => (
                candidate.id === expectedTargetState.activeRevisionId
                && candidate.claimId === expectedTargetState.claimId
            ));
            if (!claim || !revision || revision.summary.trim() !== content
                || claim.memoryType !== input.memoryType
                || claim.sensitivity !== input.sensitivity) {
                conflict = "present";
            }
        }
        const occurredAt = (dependencies.now ?? (() => new Date()))().toISOString();
        const provenance: PersistedMemoryProvenance[] = [input.binding.conversationId
            ? {
                kind: "conversation",
                conversationIds: [input.binding.conversationId],
                observedAt: occurredAt,
            }
            : {
                kind: "host_user_request",
                runId: input.binding.runId,
                userMessageId: input.binding.userMessageId,
                observedAt: occurredAt,
                userPromptHash: input.binding.userPromptHash,
            }];
        const actionIdentity = memoryActionIdentity(input);
        const memoryEnabled = settings().memoryEnabled;
        const admission = await coordinator.admit({
            policy: {
                origin: "explicit_user_instruction",
                memoryType: input.memoryType,
                authority: "explicit_user",
                persistenceIntent: "durable",
                effect: memoryEnabled ? "future_answers" : "stored_not_in_use",
                provenanceValidity: "valid",
                sourceBacking: "source_backed",
                sensitivity: input.sensitivity,
                scope: "current_vault",
                conflict,
                durableTaskConstraint: input.memoryType === "task_constraint" ? "present" : "absent",
                dataBoundary: "allowed",
                writeAuthority: "none",
                networkAuthority: "none",
                externalActionAuthority: "none",
                policyCompliance: "allowed",
                ephemeralContextEligibility: "eligible",
            },
            summary: content,
            memoryType: input.memoryType,
            sensitivity: input.sensitivity,
            authority: "explicit_user",
            effect: memoryEnabled ? "future_answers" : "stored_not_in_use",
            applicability: { kind: "whole_vault" },
            provenance,
            sourceFingerprintId: `explicit-source-${stableHash(JSON.stringify([
                input.binding.runId,
                input.binding.userMessageId,
                input.binding.userPromptHash,
            ]))}`,
            ruleFingerprint: "explicit-user-instruction-v1",
            admissionKey: `explicit:${actionIdentity}`,
            actionIdentity,
            actionFingerprint: memoryActionFingerprint(input),
            profileRecordId,
            profileKey,
            expectedTargetState,
            queueInput: {
                type: "memory_candidate",
                title: "Explicit Memory request",
                claim: content,
                scope: { kind: "whole_vault" },
                sourceRefs: [],
                originSurface: "chat",
                admissionReason: "memory_confirmation_required",
                dataBoundarySnapshotId: dataBoundaryFingerprint,
                metadata: { memoryType: input.memoryType, sensitivity: input.sensitivity },
            },
        }, {
            isCurrent: requestIsCurrent,
        });
        if (!admission.ok) {
            dependencies.log("Explicit Memory action failed", {
                reason: admission.reason,
                action: input.action,
            });
            return { ...base(input.action), reason: admission.reason };
        }
        if (admission.value.decision === "require_prior_review") {
            await dependencies.refreshState();
            const queueItemId = admission.value.queueItem?.id;
            return {
                ...base(input.action),
                status: "needs_confirmation",
                ...(queueItemId ? {
                    queueItemId,
                    detailTarget: { kind: "memory-settings", targetId: queueItemId },
                } : {}),
            };
        }
        if (admission.value.decision !== "silent_durable" || !admission.value.claimId) {
            return { ...base(input.action), reason: "admission_rejected" };
        }

        const worker = dependencies.getProfileProjectionWorker();
        let recovery: Awaited<ReturnType<MemoryProfileProjectionWorker["resumePending"]>> | undefined;
        try {
            recovery = worker ? await worker.resumePending() : undefined;
        } catch {
            dependencies.log("Explicit Memory Profile projection remains pending", {
                action: input.action,
                claimId: admission.value.claimId,
            });
            dependencies.scheduleProfileProjectionRetry?.();
        }
        try {
            await dependencies.refreshState();
        } catch {
            dependencies.log("Explicit Memory action committed before UI state refresh", {
                action: input.action,
                claimId: admission.value.claimId,
            });
        }
        let state: DeviceMemoryGovernanceStateV1;
        try {
            state = await repository.initialize();
        } catch {
            return {
                ...base(input.action),
                status: "pending",
                reason: "canonical_state_unavailable",
                claimId: admission.value.claimId,
                detailTarget: { kind: "memory-settings", targetId: admission.value.claimId },
            };
        }
        const claim = state.claims.find(candidate => candidate.id === admission.value.claimId);
        const revision = claim?.activeRevisionId
            ? state.revisions.find(candidate => (
                candidate.id === claim.activeRevisionId && candidate.claimId === claim.id
            ))
            : undefined;
        const event = state.changeEvents.find(candidate => (
            candidate.claimId === claim?.id && candidate.actionIdentity === actionIdentity
        ));
        if (!claim || !revision || !event) {
            return { ...base(input.action), status: "pending", reason: "canonical_state_unavailable" };
        }
        const pending = recovery?.pending.includes(claim.id) === true
            || state.pendingOperations.some((operation) => (
                operation.claimId === claim.id
                && (operation.kind !== "profile_projection" || operation.state === "pending")
            ));
        if (pending) dependencies.scheduleProfileProjectionRetry?.();
        return {
            ...base(input.action),
            status: pending ? "pending" : "applied",
            ...(pending ? { reason: "profile_projection_pending" } : {}),
            claimId: claim.id,
            revisionId: revision.id,
            eventId: event.id,
            detailTarget: { kind: "memory-settings", targetId: claim.id },
            ...(event.undoSnapshotId ? {
                undoExpiresAt: state.undoSnapshots
                    .find(snapshot => snapshot.id === event.undoSnapshotId)
                    ?.expiresAt,
            } : {}),
            effect: claim.effect,
            effectiveUse: effectiveUse(claim.lifecycle, claim.effect, memoryEnabled),
        };
    }
}

function effectiveUse(
    lifecycle: DeviceMemoryGovernanceStateV1["claims"][number]["lifecycle"],
    effect: DeviceMemoryGovernanceStateV1["claims"][number]["effect"],
    memoryEnabled: boolean,
): MemoryActionResult["effectiveUse"] {
    if (!memoryEnabled) return "stored_not_in_use";
    if (lifecycle === "paused") return "paused";
    if (lifecycle !== "active") return "stored_not_in_use";
    return effect === "future_answers" || effect === "collaboration_default" ? "active" : "stored_not_in_use";
}
