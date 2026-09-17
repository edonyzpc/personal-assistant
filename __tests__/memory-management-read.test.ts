import { describe, expect, it, jest } from "@jest/globals";

import type { MemoryManagementReadPort } from "../src/ai-services/AiServiceHost";
import type {
    MemoryManagementQueryOutput,
    MemoryManagementUnavailableOutput,
    MemoryManagementUsageOutput,
} from "../src/ai-services/memory-management-types";
import type { MemoryControlCenterSnapshot } from "../src/pa/memory-control-center";
import type {
    DeviceMemoryGovernanceStateV1,
    MemoryClaimRevision,
} from "../src/pa/memory-governance-persistence";
import { createMemoryManagementReadPort } from "../src/pa/memory-management-read";
import {
    buildMemoryManagementEvidence,
    prepareMemoryManagementProjection,
} from "../src/ai-services/memory-management-evidence";
import { ChatHistoryManager } from "../src/chat/chat-history-manager";
import { MemoryChatHistoryStore } from "../src/chat/chat-history-store";
import { WritingVersionService } from "../src/chat/writing-versions";
import { hashWritingText } from "../src/chat/writing-types";
import type { GenerationInputSnapshot } from "../src/ai-services/generation-input-snapshot";
import type { PersistedTurn } from "../src/chat/chat-history-store";
import type { WritingVersion } from "../src/chat/writing-types";

const now = "2026-09-16T00:00:00.000Z";

function revision(
    claimId: string,
    id: string,
    summary: string,
    path?: string,
): MemoryClaimRevision {
    return {
        id,
        claimId,
        summary,
        provenance: path
            ? [{ kind: "note", sourceRef: { path, excerptHash: "hash", whyShown: ["test"], evidenceStrength: "strong" } }]
            : [{ kind: "conversation", conversationIds: ["conversation-source"], observedAt: now }],
        authority: "explicit_user",
        createdAt: now,
    };
}

function governanceState(): DeviceMemoryGovernanceStateV1 {
    return {
        schemaVersion: 3,
        commitSequence: 7,
        claims: [
            {
                id: "claim-allowed", partition: { kind: "vault", key: "vault-key" }, memoryType: "preference",
                sensitivity: "low", applicability: { kind: "whole_vault" }, activeRevisionId: "revision-allowed",
                effect: "future_answers", lifecycle: "active", createdAt: now, updatedAt: now,
            },
            {
                id: "claim-paused", partition: { kind: "vault", key: "vault-key" }, memoryType: "preference",
                sensitivity: "low", applicability: { kind: "whole_vault" }, activeRevisionId: "revision-paused",
                effect: "future_answers", lifecycle: "paused", createdAt: now, updatedAt: now,
            },
            {
                id: "claim-forgotten", partition: { kind: "vault", key: "vault-key" }, memoryType: "preference",
                sensitivity: "low", applicability: { kind: "whole_vault" }, activeRevisionId: "revision-forgotten",
                effect: "none", lifecycle: "forgotten_tombstone", createdAt: now, updatedAt: now,
            },
        ],
        revisions: [
            revision("claim-allowed", "revision-allowed", "ALLOWED_CITY_PREFERENCE", "notes/allowed.md"),
            revision("claim-paused", "revision-paused", "PAUSED_FORMAT_PREFERENCE", "notes/allowed.md"),
            revision("claim-forgotten", "revision-forgotten", "FORGOTTEN_OLD_TEXT", "notes/private.md"),
        ],
        memoryQueueItems: [],
        projectionLinks: [],
        changeEvents: [],
        undoSnapshots: [],
        suppressionMarkers: [],
        pendingOperations: [],
        policyStates: {},
        migrationStates: {},
        migrationDeltas: [],
        rollbackPayloadEntries: [],
    };
}

function controlSnapshot(): MemoryControlCenterSnapshot {
    return {
        generatedAt: now,
        noteMemory: { enabled: true, status: "ready", indexedDocumentCount: 3 },
        vaultInsights: { enabled: false, status: "not_loaded" },
        profile: { enabled: true, status: "ready", itemCount: 1 },
        durable: { activeCount: 1, pausedCount: 1, staleCount: 0 },
        boundary: { vaultScoped: true, deviceLocalProven: true, explanationKey: "test" },
        governanceMode: "effect_based",
        items: [
            {
                id: "claim-allowed", claimId: "claim-allowed", label: "ALLOWED_CITY_PREFERENCE",
                origin: "confirmed_memory", authority: "explicit_user", scopeLabel: "Current vault",
                effect: "future_answers", lifecycle: "active",
                provenance: [{ kind: "note", sourceRef: { path: "notes/allowed.md", excerptHash: "hash", whyShown: ["test"], evidenceStrength: "strong" } }],
                updatedAt: now, supportedActions: [],
            },
            {
                id: "claim-paused", claimId: "claim-paused", label: "PAUSED_FORMAT_PREFERENCE",
                origin: "confirmed_memory", authority: "explicit_user", scopeLabel: "Current vault",
                effect: "future_answers", lifecycle: "paused",
                provenance: [{ kind: "note", sourceRef: { path: "notes/allowed.md", excerptHash: "hash", whyShown: ["test"], evidenceStrength: "strong" } }],
                updatedAt: now, supportedActions: [],
            },
            {
                id: "claim-forgotten", claimId: "claim-forgotten", label: "FORBIDDEN_OLD_TEXT",
                origin: "confirmed_memory", authority: "explicit_user", scopeLabel: "Current vault",
                effect: "none", lifecycle: "forgotten_marker", provenance: [], updatedAt: now, supportedActions: [],
            },
        ],
        degradedSources: [],
    };
}

function createPort(options: {
    allowedPaths?: string[];
    snapshot?: MemoryControlCenterSnapshot;
    state?: DeviceMemoryGovernanceStateV1;
    cacheTarget?: number;
    history?: () => ChatHistoryManager | undefined;
    versions?: () => WritingVersionService | undefined;
    learningEnabled?: boolean;
    profileStatus?: MemoryControlCenterSnapshot["profile"]["status"];
}): MemoryManagementReadPort {
    const allowed = new Set(options.allowedPaths ?? ["notes/allowed.md"]);
    let state = options.state ?? governanceState();
    let snapshot = options.snapshot ?? controlSnapshot();
    const mutate = (next: {
        state?: DeviceMemoryGovernanceStateV1;
        snapshot?: MemoryControlCenterSnapshot;
        allowedPaths?: string[];
    }) => {
        if (next.state) state = next.state;
        if (next.snapshot) snapshot = next.snapshot;
        if (next.allowedPaths) {
            allowed.clear();
            next.allowedPaths.forEach(path => allowed.add(path));
        }
    };
    const port = createMemoryManagementReadPort({
        getSettings: () => ({
            memoryEnabled: true,
            learningEnabled: options.learningEnabled ?? true,
            learningStatus: (options.learningEnabled ?? true) ? "enabled" : "paused",
            existingUnderstandingAvailable: true,
        }),
        getControlCenterSnapshot: async () => {
            if (options.profileStatus && snapshot.profile.status !== options.profileStatus) {
                snapshot = {
                    ...snapshot,
                    profile: { ...snapshot.profile, status: options.profileStatus },
                };
            }
            return snapshot;
        },
        getGovernedState: () => state,
        getCacheTarget: () => options.cacheTarget ?? 7,
        getVaultKey: () => "vault-key",
        getDataBoundaryFingerprint: () => "boundary-1",
        isDataBoundaryAllowedPath: path => allowed.has(path),
        getHistoryManager: options.history ?? (() => undefined),
        getWritingVersions: options.versions ?? (() => undefined),
    });
    return Object.assign(port, { mutateForTest: mutate });
}

describe("B-140 T-08 Memory management read model", () => {
    it("filters provider and Data Boundary permissions before matching, counting, and paging", async () => {
        const port = createPort({});

        const first = await port.queryMemories({ text: "PREFERENCE", limit: 1 }) as MemoryManagementQueryOutput;
        expect(first).toMatchObject({
            kind: "memory-query",
            available: true,
            memoryEnabled: true,
            contentAvailable: true,
            matchCount: 2,
            matchCountKind: "exact",
        });
        expect(first.items).toHaveLength(1);
        expect(first.items[0]).toMatchObject({
            entityType: "governed_claim",
            id: "claim-allowed",
            claimId: "claim-allowed",
            revisionId: "revision-allowed",
            text: "ALLOWED_CITY_PREFERENCE",
            effectiveUse: "active",
            detailTarget: { kind: "memory-settings", targetId: "claim-allowed" },
        });
        expect(first.nextCursor).toEqual(expect.any(String));

        const second = await port.queryMemories({ text: "PREFERENCE", limit: 1, cursor: first.nextCursor! }) as MemoryManagementQueryOutput;
        expect(second.items).toHaveLength(1);
        expect(second.items[0]!).toMatchObject({
            id: "claim-paused",
            text: "PAUSED_FORMAT_PREFERENCE",
            lifecycle: "paused",
            effectiveUse: "paused",
            effect: "future_answers",
        });

        const forbidden = await port.queryMemories({ itemId: "claim-forgotten" }) as MemoryManagementQueryOutput;
        expect(forbidden.items).toHaveLength(1);
        expect(forbidden.items[0]).toMatchObject({ id: "claim-forgotten", lifecycle: "forgotten_marker" });
        expect(forbidden.items[0]).not.toHaveProperty("text");
        expect(JSON.stringify(forbidden)).not.toContain("FORGOTTEN_OLD_TEXT");
        expect(JSON.stringify(forbidden)).not.toContain("notes/private.md");
    });

    it("keeps a stable cursor while permission identity is unchanged and revokes it after boundary denial", async () => {
        const port = createPort({});
        const first = await port.queryMemories({ text: "PREFERENCE", limit: 1 }) as MemoryManagementQueryOutput;
        const stable = await port.queryMemories({ text: "PREFERENCE", limit: 1, cursor: first.nextCursor! }) as MemoryManagementQueryOutput;
        expect(stable.items[0]?.id).toBe("claim-paused");

        (port as unknown as { mutateForTest(next: unknown): void }).mutateForTest({ allowedPaths: [] });
        const expired = await port.queryMemories({ text: "PREFERENCE", limit: 1, cursor: first.nextCursor! }) as MemoryManagementUnavailableOutput<"query">;
        expect(expired).toMatchObject({
            available: false,
            reason: "cursor_expired",
            items: [],
            matchCount: 0,
        });
        expect(JSON.stringify(expired)).not.toContain("ALLOWED_CITY_PREFERENCE");
        expect(JSON.stringify(expired)).not.toContain("PAUSED_FORMAT_PREFERENCE");
    });

    it("distinguishes unprepared history, unknown usage, context records, and physical writing snapshots", async () => {
        const uninitialized = new ChatHistoryManager({ store: new MemoryChatHistoryStore() });
        const initializeSpy = jest.spyOn(uninitialized, "initialize");
        const unavailablePort = createPort({ history: () => uninitialized });
        await expect(unavailablePort.getUsage({ conversationId: "conversation-1", turnId: "0" }))
            .resolves.toMatchObject({ available: false, reason: "history_unavailable" });
        expect(initializeSpy).not.toHaveBeenCalled();

        const currentUnknown = createPort({});
        await expect(currentUnknown.getUsage({})).resolves.toMatchObject({
            kind: "memory-usage",
            available: true,
            target: "current_run",
            evidenceLevel: "unknown",
            records: [],
        });

        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        const versions = new WritingVersionService(store);
        const generationInput: GenerationInputSnapshot = {
            schemaVersion: 1, inputPurpose: "writing",
            task: { state: "none", sources: [] },
            personal: { state: "identified", mode: "governed", revisions: [{ claimId: "claim-allowed", revisionId: "revision-allowed" }] },
            insights: { state: "none" }, style: { state: "none" }, images: [],
            parent: { state: "none" }, pagelet: { state: "none" },
        };
        const writing: WritingVersion = {
            id: "writing-1", textHash: await hashWritingText("Generated text"), createdAt: 1,
            requestId: "request-1", messageId: "message-1", conversationId: "conversation-1", turnIndex: 0,
            text: "Generated text", explanation: "", origin: "ai_generated", associatedImages: [],
            backgroundSourceRefs: [], styleRevisionIds: [], generationInput,
            referenceScope: "request",
        };
        await store.putWritingVersion(writing);
        const turn: PersistedTurn = {
            conversationId: "conversation-1", turnIndex: 0,
            user: { role: "user", content: "Write" },
            assistant: { role: "assistant", content: "Draft", writingVersionId: writing.id },
            contextUsed: [{
                category: "memory", label: "Saved understanding", statusOnly: true,
                memoryClaimId: "claim-paused", memoryEffect: "future_answers",
            }],
        };
        await store.upsertConversation({
            id: "conversation-1", title: "Test", createdAt: now, updatedAt: now,
            turnCount: 1, preview: "Write",
        });
        await store.appendTurn(turn);

        const writingPort = createPort({ history: () => manager, versions: () => versions });
        const writingUsage = await writingPort.getUsage({ conversationId: "conversation-1", turnId: "rehydrated:conversation-1:0" }) as MemoryManagementUsageOutput;
        expect(writingUsage).toMatchObject({
            available: true,
            target: "history",
            evidenceLevel: "writing_generation_snapshot",
        });
        expect(writingUsage.records).toHaveLength(2);
        expect(writingUsage.records[0]).toMatchObject({
            conversationId: "conversation-1",
            turnIndex: 0,
            disclosure: "dispatch_snapshot",
            evidenceLevel: "writing_generation_snapshot",
            claims: [{ claimId: "claim-allowed", revisionId: "revision-allowed" }],
        });
        expect(writingUsage.records[1]).toMatchObject({
            evidenceLevel: "context_record",
            disclosure: "selection_record",
            contextClaims: [{ claimId: "claim-paused" }],
        });
        const usageEvidence = buildMemoryManagementEvidence({
            tool: "get_memory_usage",
            operation: "usage",
            stateFingerprint: "unused-before",
            request: { conversationId: "conversation-1", turnId: "rehydrated:conversation-1:0" },
            content: writingUsage,
        });
        const beforeRevisionChange = await writingPort.prepareObservation(usageEvidence);
        expect(beforeRevisionChange.ready).toBe(true);

        const contextPort = createPort({});
        await expect(contextPort.getUsage({}, () => ({
            governedMemoryTrace: [{
                claimId: "claim-paused", effect: "future_answers",
                source: "interactions", scope: "current_vault",
            }],
        }))).resolves.toMatchObject({
            evidenceLevel: "context_record",
            records: [{ disclosure: "selection_record", contextClaims: [{ claimId: "claim-paused" }] }],
        });

        const writingPortCurrent = createPort({});
        await expect(writingPortCurrent.getUsage({}, () => ({
            writingGenerationInput: generationInput,
        }))).resolves.toMatchObject({
            evidenceLevel: "writing_generation_snapshot",
            records: [{ disclosure: "dispatch_snapshot", claims: [{ claimId: "claim-allowed", revisionId: "revision-allowed" }] }],
        });

        const changedState = structuredClone(governanceState());
        changedState.claims[0]!.activeRevisionId = "revision-allowed-next";
        changedState.revisions.push({
            ...revision("claim-allowed", "revision-allowed-next", "CURRENT_REVISION_TEXT", "notes/allowed.md"),
        });
        (writingPort as unknown as { mutateForTest(next: unknown): void }).mutateForTest({ state: changedState });
        const retainedOldRevision = await writingPort.getUsage({
            conversationId: "conversation-1", turnId: "rehydrated:conversation-1:0",
        }) as MemoryManagementUsageOutput;
        expect(retainedOldRevision.records[0]?.claims)
            .toEqual([{ claimId: "claim-allowed", revisionId: "revision-allowed" }]);

        const afterRevisionChange = await writingPort.prepareObservation(usageEvidence);
        expect(afterRevisionChange).toMatchObject({ ready: true });
        expect(afterRevisionChange.stateFingerprint).toBe(beforeRevisionChange.stateFingerprint);

        const oldVersionDenied = structuredClone(changedState);
        const oldRevision = oldVersionDenied.revisions.find(item => item.id === "revision-allowed");
        if (oldRevision) {
            oldRevision.provenance = revision(
                "claim-allowed",
                "revision-allowed",
                "ALLOWED_CITY_PREFERENCE",
                "notes/old-private.md",
            ).provenance;
        }
        (writingPort as unknown as { mutateForTest(next: unknown): void }).mutateForTest({
            state: oldVersionDenied,
            allowedPaths: ["notes/allowed.md"],
        });
        const afterOldVersionDenied = await writingPort.prepareObservation(usageEvidence);
        expect(afterOldVersionDenied).toMatchObject({ ready: true, aggregateCurrent: false });
        expect(afterOldVersionDenied.stateFingerprint).not.toBe(beforeRevisionChange.stateFingerprint);
        const oldVersionWithdrawn = await writingPort.getUsage({
            conversationId: "conversation-1", turnId: "rehydrated:conversation-1:0",
        }) as MemoryManagementUsageOutput;
        expect(oldVersionWithdrawn.records[0]).toMatchObject({ claims: [] });

        (writingPort as unknown as { mutateForTest(next: unknown): void }).mutateForTest({ allowedPaths: [] });
        const withdrawn = await writingPort.getUsage({
            conversationId: "conversation-1", turnId: "rehydrated:conversation-1:0",
        }) as MemoryManagementUsageOutput;
        expect(withdrawn.records[0]).toMatchObject({
            evidenceLevel: "writing_generation_snapshot",
            disclosure: "dispatch_snapshot",
            claims: [],
        });

        await expect(writingPort.getUsage({ conversationId: "conversation-1", turnId: "0" }))
            .resolves.toMatchObject({ available: false, reason: "turn_not_found" });
    });

    it("filters status and usage aggregates through current disclosure permission", async () => {
        const statusPort = createPort({});
        const permittedStatus = await statusPort.getStatus();
        expect(permittedStatus.noteMemory).not.toHaveProperty("indexedDocumentCount");
        (statusPort as unknown as { mutateForTest(next: unknown): void }).mutateForTest({ allowedPaths: [] });
        const deniedStatus = await statusPort.getStatus();
        expect(deniedStatus.contentAvailable).toBe(false);
        expect(deniedStatus.noteMemory).not.toHaveProperty("indexedDocumentCount");
        expect(JSON.stringify(deniedStatus)).not.toContain("3");
        expect(JSON.stringify(deniedStatus)).not.toContain("ALLOWED_CITY_PREFERENCE");

        const currentPort = createPort({});
        const forgottenCurrent = await currentPort.getUsage({}, () => ({
            governedMemoryTrace: [{
                claimId: "claim-forgotten",
                effect: "future_answers",
                source: "interactions",
                scope: "current_vault",
            }],
        })) as MemoryManagementUsageOutput;
        expect(forgottenCurrent.records).toHaveLength(1);
        expect(forgottenCurrent.records[0]?.contextClaims).toEqual([]);
        expect(JSON.stringify(forgottenCurrent)).not.toContain("claim-forgotten");
        expect(JSON.stringify(forgottenCurrent)).not.toContain("FORGOTTEN_OLD_TEXT");

        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        await store.upsertConversation({
            id: "conversation-context", title: "Context", createdAt: now, updatedAt: now, turnCount: 1, preview: "Context",
        });
        await store.appendTurn({
            conversationId: "conversation-context", turnIndex: 0,
            user: { role: "user", content: "Use context" },
            assistant: { role: "assistant", content: "Answer" },
            contextUsed: [{
                category: "memory", label: "Selected", statusOnly: true,
                memoryClaimId: "claim-paused", memoryEffect: "future_answers",
            }],
        });
        const historyPort = createPort({ history: () => manager });
        const allowedHistory = await historyPort.getUsage({
            conversationId: "conversation-context", turnId: "rehydrated:conversation-context:0",
        }) as MemoryManagementUsageOutput;
        expect(allowedHistory.records[0]?.contextClaims).toEqual([{ claimId: "claim-paused" }]);
        (historyPort as unknown as { mutateForTest(next: unknown): void }).mutateForTest({ allowedPaths: [] });
        const deniedHistory = await historyPort.getUsage({
            conversationId: "conversation-context", turnId: "rehydrated:conversation-context:0",
        }) as MemoryManagementUsageOutput;
        expect(deniedHistory.records[0]?.contextClaims).toEqual([]);
        expect(JSON.stringify(deniedHistory)).not.toContain("claim-paused");
    });

    it("reports learning, existing-understanding use, coverage, and item actions separately", async () => {
        const stoppedLearning = await createPort({ learningEnabled: false }).getStatus();
        expect(stoppedLearning.learning).toMatchObject({
            enabled: false,
            status: "paused",
            profile: "ready",
            vaultInsights: "not_loaded",
        });
        expect(stoppedLearning.existingUnderstanding).toMatchObject({
            available: true,
            status: "active",
        });

        const unknownCoverage = await createPort({ profileStatus: "unknown" }).getStatus();
        expect(unknownCoverage.coverage).toBe("unknown");
        expect(unknownCoverage.recordCountKind).toBe("partial");

        const knownEmptySnapshot = controlSnapshot();
        knownEmptySnapshot.profile = { ...knownEmptySnapshot.profile, status: "empty", itemCount: 0 };
        knownEmptySnapshot.items = [];
        const knownEmptyPort = createPort({ snapshot: knownEmptySnapshot });
        await expect(knownEmptyPort.getStatus()).resolves.toMatchObject({
            coverage: "complete",
            recordCount: 0,
            recordCountKind: "exact",
        });
    });

    it("projects existing Control Center actions and the real item target", async () => {
        const snapshot = controlSnapshot();
        snapshot.items.push({
            id: "legacy-profile",
            profileRecordId: "profile-record-1",
            label: "LEGACY_PROFILE_TEXT",
            origin: "user_profile",
            authority: "pa_inference",
            scopeLabel: "Current vault",
            effect: "future_answers",
            lifecycle: "active",
            provenance: [{ kind: "conversation", conversationId: "conversation-source", observedAt: now }],
            updatedAt: now,
            supportedActions: ["correct", "forget"],
        });
        const port = createPort({ snapshot });
        const result = await port.queryMemories({ itemId: "legacy-profile", limit: 1 }) as MemoryManagementQueryOutput;
        expect(result.items[0]).toMatchObject({
            id: "legacy-profile",
            entityType: "legacy_user_profile",
            supportedActions: ["correct", "forget"],
            detailTarget: { kind: "memory-settings", targetId: "profile-record-1" },
        });
    });

    it("binds the captured legacy source through the final physical dispatch", async () => {
        const snapshot = controlSnapshot();
        snapshot.items = [{
            id: "legacy-source",
            profileRecordId: "profile-record-source",
            label: "LEGACY_SOURCE_SECRET",
            origin: "user_profile",
            authority: "pa_inference",
            scopeLabel: "Current vault",
            effect: "future_answers",
            lifecycle: "active",
            provenance: [{ kind: "conversation", conversationId: "conversation-source", observedAt: now }],
            updatedAt: now,
            supportedActions: ["forget"],
        }];
        let sourceCurrent = true;
        let resolveSnapshot!: (value: MemoryControlCenterSnapshot) => void;
        const pendingSnapshot = new Promise<MemoryControlCenterSnapshot>(resolve => {
            resolveSnapshot = resolve;
        });
        let firstRead = true;
        const port = createMemoryManagementReadPort({
            captureLegacySourceValidity: () => () => sourceCurrent,
            getSettings: () => ({
                memoryEnabled: true,
                learningEnabled: false,
                learningStatus: "paused",
                existingUnderstandingAvailable: true,
            }),
            getControlCenterSnapshot: async () => {
                if (!firstRead) return snapshot;
                firstRead = false;
                return await pendingSnapshot;
            },
            getGovernedState: () => null,
            getCacheTarget: () => 0,
            getVaultKey: () => "vault-key",
            getDataBoundaryFingerprint: () => "boundary-1",
            isDataBoundaryAllowedPath: () => true,
            getHistoryManager: () => undefined,
            getWritingVersions: () => undefined,
        });

        const pendingObservation = port.prepareObservation({ operation: "query", request: { limit: "1" } });
        sourceCurrent = false;
        resolveSnapshot(snapshot);
        await expect(pendingObservation).resolves.toMatchObject({
            ready: false,
            reason: "not_ready",
        });

        sourceCurrent = true;
        const content = await port.queryMemories({ itemId: "legacy-source", limit: 1 });
        const evidence = buildMemoryManagementEvidence({
            tool: "query_memories",
            operation: "query",
            stateFingerprint: "initial",
            request: { itemId: "legacy-source", limit: "1" },
            content,
        });
        const projection = await prepareMemoryManagementProjection({
            transcript: [{
                role: "toolResult",
                id: "legacy-query",
                toolCallId: "legacy-query",
                toolName: "query_memories",
                timestamp: 1,
                isError: false,
                content: {
                    promptText: JSON.stringify({ tool: "query_memories", status: "ok", observation: content }),
                    includeInNextPrompt: true,
                    metadata: {
                        memoryManagementContractVersion: 1,
                        memoryManagementEvidence: evidence,
                    },
                },
            }],
            prepareObservation: expected => port.prepareObservation(expected),
        });
        await projection.binding.prepare();
        expect(() => projection.binding.assertCurrent()).not.toThrow();

        sourceCurrent = false;
        expect(() => projection.binding.assertCurrent())
            .toThrow("Memory management state changed before dispatch.");
    });

    it("withdraws a writing usage result if its conversation is deleted while the version read is pending", async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        const versions = new WritingVersionService(store);
        const writing: WritingVersion = {
            id: "writing-delete", textHash: await hashWritingText("Generated text"), createdAt: 1,
            requestId: "request-delete", messageId: "message-delete", conversationId: "conversation-delete", turnIndex: 0,
            text: "Generated text", explanation: "", origin: "ai_generated", associatedImages: [],
            backgroundSourceRefs: [], styleRevisionIds: [],
            generationInput: {
                schemaVersion: 1, inputPurpose: "writing", task: { state: "none", sources: [] },
                personal: { state: "identified", mode: "governed", revisions: [{ claimId: "claim-allowed", revisionId: "revision-allowed" }] },
                insights: { state: "none" }, style: { state: "none" }, images: [], parent: { state: "none" }, pagelet: { state: "none" },
            },
            referenceScope: "request",
        };
        await store.putWritingVersion(writing);
        await store.upsertConversation({
            id: "conversation-delete", title: "Delete", createdAt: now, updatedAt: now, turnCount: 1, preview: "Write",
        });
        await store.appendTurn({
            conversationId: "conversation-delete", turnIndex: 0,
            user: { role: "user", content: "Write" },
            assistant: { role: "assistant", content: "Draft", writingVersionId: writing.id },
        });

        let release!: () => void;
        let markGetStarted!: () => void;
        const getStarted = new Promise<void>(resolve => { markGetStarted = resolve; });
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const originalGet = store.getWritingVersion.bind(store);
        const getSpy = jest.spyOn(store, "getWritingVersion").mockImplementation(async id => {
            markGetStarted();
            const value = await originalGet(id);
            await blocked;
            return value;
        });
        const port = createPort({ history: () => manager, versions: () => versions });
        const pending = port.getUsage({ conversationId: "conversation-delete", turnId: "rehydrated:conversation-delete:0" });
        await getStarted;
        await manager.deleteConversation("conversation-delete");
        release();
        getSpy.mockRestore();

        await expect(pending).resolves.toMatchObject({
            available: false,
            reason: "source_changed",
        });
        expect(JSON.stringify(await pending)).not.toContain("claim-allowed");
    });
});
