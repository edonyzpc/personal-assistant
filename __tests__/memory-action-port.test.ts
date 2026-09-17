import { describe, expect, it, jest } from "@jest/globals";

import type {
    MemoryActionHostBinding,
    MemoryActionPortInput,
} from "../src/ai-services/memory-action-types";
import {
    createMemoryActionPort,
    type MemoryActionPortDependencies,
} from "../src/pa/memory-action-port";
import {
    MemoryAdmissionCoordinator,
    readTypeATargetGeneration,
    type TypeAAdmissionBaseline,
} from "../src/pa/memory-admission-coordinator";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    type MemoryGovernanceRepository,
} from "../src/pa/memory-governance-persistence";
import { MemoryProfileProjectionWorker } from "../src/pa/memory-profile-projection-worker";

const NOW = new Date("2026-07-11T08:00:00.000Z");
const PARTITION = { kind: "vault" as const, key: "vault-a" };

function createRepository() {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    state.policyStates["vault-a"] = {
        version: 1,
        mode: "effect_based",
        contextProjectionMode: "governed",
    };
    return new InMemoryMemoryGovernanceRepository(
        new InMemoryMemoryGovernanceBackend(state),
    );
}

function createBinding(): MemoryActionHostBinding {
    return {
        runId: "run-action",
        userMessageId: "run-action:source-user",
        userPrompt: "Please remember that I prefer concise release notes.",
        userPromptHash: "prompt-action-hash",
        conversationId: "conversation-action",
        isCurrent: () => true,
    };
}

async function createBaseline(
    repository: MemoryGovernanceRepository,
): Promise<TypeAAdmissionBaseline> {
    const state = await repository.initialize();
    const targets = Object.fromEntries([...new Set(state.projectionLinks.flatMap((link) => (
        link.target.kind === "type_a_profile" ? [link.target.profileRecordId] : []
    )))].map((profileRecordId) => [
        profileRecordId,
        readTypeATargetGeneration(state, profileRecordId, PARTITION),
    ]));
    return {
        version: 1,
        capturedCommitSequence: state.commitSequence,
        targets,
        profileRecordIdsByKey: {},
    };
}

function createPort(
    repository: MemoryGovernanceRepository,
    binding = createBinding(),
    overrides: Partial<MemoryActionPortDependencies> = {},
) {
    const coordinator = new MemoryAdmissionCoordinator({
        repository,
        opaqueVaultKey: "vault-a",
        now: () => NOW,
        idFactory: (() => {
            let id = 0;
            return () => `action-id-${++id}`;
        })(),
    });
    const worker = new MemoryProfileProjectionWorker({
        repository,
        opaqueVaultKey: "vault-a",
        now: () => NOW,
        applyProjection: jest.fn(async () => undefined),
    });
    return createMemoryActionPort({
        isRuntimeCurrent: () => true,
        getSettings: () => ({ memoryEnabled: true, learningEnabled: false }),
        getAdmissionCoordinator: () => coordinator,
        getRepository: () => repository,
        getProfileProjectionWorker: () => worker,
        captureTypeABaseline: () => createBaseline(repository),
        getDataBoundaryFingerprint: () => "boundary-action",
        executeGovernedAction: jest.fn<MemoryActionPortDependencies["executeGovernedAction"]>(),
        refreshState: jest.fn(async () => undefined),
        log: jest.fn(),
        now: () => NOW,
        ...overrides,
    });
}

describe("B-140 T-09 Memory action port", () => {
    it("persists one explicit low-risk action through the real coordinator even with learning off", async () => {
        const repository = createRepository();
        const port = createPort(repository);
        const binding = createBinding();
        const input: MemoryActionPortInput = {
            action: "remember" as const,
            userExpression: "remember that I prefer concise release notes",
            content: "I prefer concise release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding,
        };

        const first = await port.execute(input);
        const state = await repository.initialize();
        expect(first).toMatchObject({
            status: "applied",
            claimId: state.claims[0].id,
            revisionId: state.revisions[0].id,
            eventId: state.changeEvents[0].id,
            learningEnabled: false,
            effectiveUse: "active",
        });
        expect(state.revisions[0]).toMatchObject({
            authority: "explicit_user",
            summary: "I prefer concise release notes.",
        });
        expect(state.pendingOperations.filter((operation) => (
            operation.kind === "profile_projection" && operation.state === "pending"
        ))).toHaveLength(0);

        const replay = await port.execute(input);
        const after = await repository.initialize();
        expect(replay).toMatchObject({
            status: "applied",
            claimId: state.claims[0].id,
            revisionId: state.revisions[0].id,
            eventId: state.changeEvents[0].id,
        });
        expect(after.revisions).toHaveLength(1);
        expect(after.changeEvents).toHaveLength(1);
    });

    it("rejects same identity with changed content and a cancelled request before commit", async () => {
        const repository = createRepository();
        const port = createPort(repository);
        const binding = createBinding();
        await port.execute({
            action: "remember",
            userExpression: "remember that I prefer concise release notes",
            content: "I prefer concise release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding,
        });
        const before = await repository.initialize();

        const conflict = await port.execute({
            action: "remember",
            userExpression: "remember that I prefer concise release notes",
            content: "I prefer very detailed release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding,
        });
        expect(conflict).toMatchObject({
            status: "failed",
            reason: "explicit_action_conflict",
        });

        let current = true;
        const cancelledBinding = { ...binding, isCurrent: () => current };
        current = false;
        const cancelled = await createPort(repository, cancelledBinding).execute({
            action: "remember",
            userExpression: "remember that I prefer detailed release notes",
            content: "I prefer detailed release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding: cancelledBinding,
        });
        expect(cancelled).toMatchObject({
            status: "failed",
            reason: "action_request_not_current",
        });
        expect(await repository.initialize()).toMatchObject({
            claims: before.claims,
            revisions: before.revisions,
            changeEvents: before.changeEvents,
        });
    });

    it("does not create another claim when one request is retried with a different valid quote", async () => {
        const repository = createRepository();
        const port = createPort(repository);
        const binding = createBinding();
        await expect(port.execute({
            action: "remember",
            userExpression: "remember that I prefer concise release notes",
            content: "I prefer concise release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding,
        })).resolves.toMatchObject({ status: "applied" });

        await expect(port.execute({
            action: "remember",
            userExpression: "Please remember",
            content: "I prefer short release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding,
        })).resolves.toMatchObject({ status: "failed", reason: "explicit_action_conflict" });
        const state = await repository.initialize();
        expect(state.claims).toHaveLength(1);
        expect(state.revisions).toHaveLength(1);
    });

    it("routes an explicit sensitive Memory to existing prior review without creating a claim", async () => {
        const repository = createRepository();
        const result = await createPort(repository).execute({
            action: "remember",
            userExpression: "remember that my health details are private",
            content: "My health details are private.",
            memoryType: "preference",
            sensitivity: "high",
            binding: {
                ...createBinding(),
                userPrompt: "Please remember that my health details are private.",
            },
        });

        expect(result).toMatchObject({
            status: "needs_confirmation",
            queueItemId: expect.any(String),
        });
        const state = await repository.initialize();
        expect(state.claims).toHaveLength(0);
        expect(state.memoryQueueItems).toEqual([
            expect.objectContaining({ status: "suggested" }),
        ]);
    });

    it("rejects changed parameters for the same explicit action while prior review is pending", async () => {
        const repository = createRepository();
        const port = createPort(repository);
        const binding = {
            ...createBinding(),
            userPrompt: "Please remember that my health details are private.",
        };
        const first = await port.execute({
            action: "remember",
            userExpression: "remember that my health details are private",
            content: "My health details are private.",
            memoryType: "preference",
            sensitivity: "high",
            binding,
        });
        const before = await repository.initialize();

        const changed = await port.execute({
            action: "remember",
            userExpression: "remember that my health details are private",
            content: "My medical history is private.",
            memoryType: "preference",
            sensitivity: "high",
            binding,
        });

        expect(first).toMatchObject({ status: "needs_confirmation" });
        expect(changed).toMatchObject({
            status: "failed",
            reason: "explicit_action_conflict",
        });
        expect((await repository.initialize()).memoryQueueItems).toEqual(before.memoryQueueItems);
    });

    it("reports canonical success as pending when Profile projection has no active worker", async () => {
        const repository = createRepository();
        const port = createPort(repository, createBinding(), {
            getProfileProjectionWorker: () => null,
        });
        const result = await port.execute({
            action: "remember",
            userExpression: "remember that I prefer concise release notes",
            content: "I prefer concise release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding: createBinding(),
        });

        expect(result).toMatchObject({
            status: "pending",
            reason: "profile_projection_pending",
            claimId: expect.any(String),
        });
        expect((await repository.initialize()).pendingOperations).toEqual([
            expect.objectContaining({ kind: "profile_projection", state: "pending" }),
        ]);
    });

    it("keeps the committed receipt when projection and UI refresh fail after admission", async () => {
        const repository = createRepository();
        const scheduleRetry = jest.fn();
        const port = createPort(repository, createBinding(), {
            getProfileProjectionWorker: () => ({
                resumePending: jest.fn(async () => { throw new Error("projection unavailable"); }),
            }) as unknown as MemoryProfileProjectionWorker,
            refreshState: jest.fn(async () => { throw new Error("refresh unavailable"); }),
            scheduleProfileProjectionRetry: scheduleRetry,
        });

        const result = await port.execute({
            action: "remember",
            userExpression: "remember that I prefer concise release notes",
            content: "I prefer concise release notes.",
            memoryType: "preference",
            sensitivity: "low",
            binding: createBinding(),
        });

        expect(result).toMatchObject({
            status: "pending",
            reason: "profile_projection_pending",
            claimId: expect.any(String),
            revisionId: expect.any(String),
            eventId: expect.any(String),
        });
        expect(scheduleRetry).toHaveBeenCalled();
        expect((await repository.initialize()).claims).toHaveLength(1);
    });
});
