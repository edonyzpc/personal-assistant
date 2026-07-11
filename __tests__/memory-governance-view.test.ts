import { buildGovernedMemoryViewSnapshot } from "../src/pa/memory-governance-view";
import {
    createEmptyDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
} from "../src/pa/memory-governance-persistence";

const NOW = new Date("2026-07-10T12:00:00.000Z");
const VAULT = "vault-a";

describe("buildGovernedMemoryViewSnapshot", () => {
    it("projects current-vault and explicit same-device claims without fabricating conversation paths", () => {
        const state = fixture();
        state.claims.push({
            id: "device-claim",
            partition: { kind: "device_collaboration", key: "device" },
            memoryType: "preference",
            sensitivity: "low",
            applicability: { kind: "whole_vault" },
            activeRevisionId: "device-revision",
            effect: "collaboration_default",
            lifecycle: "active",
            createdAt: "2026-07-09T10:00:00.000Z",
            updatedAt: "2026-07-09T10:00:00.000Z",
        });
        state.revisions.push({
            id: "device-revision",
            claimId: "device-claim",
            summary: "Use concise Chinese replies",
            authority: "explicit_user",
            provenance: [{
                kind: "conversation",
                conversationIds: ["conversation-1"],
                observedAt: "2026-07-09T10:00:00.000Z",
            }],
            createdAt: "2026-07-09T10:00:00.000Z",
        });

        const result = buildGovernedMemoryViewSnapshot(state, VAULT, { now: NOW });

        expect(result.records.map((entry) => entry.claimId)).toEqual(["claim-1", "device-claim"]);
        expect(result.records[1]).toMatchObject({
            authority: "explicit_user",
            effect: "collaboration_default",
            useStatus: "active",
            record: { sourceRefs: [] },
        });
        expect(result.records.some((entry) => entry.claimId === "other-vault")).toBe(false);
    });

    it("maps pause to a real use status while preserving the stored record", () => {
        const state = fixture();
        state.claims[0].lifecycle = "paused";

        const result = buildGovernedMemoryViewSnapshot(state, VAULT, { now: NOW });

        expect(result.records[0]).toMatchObject({
            useStatus: "paused",
            record: { lifecycle: "archived", summary: "Prefer evidence first" },
        });
    });

    it("renders seven-day events and makes Forget rows irreversibly content-free", () => {
        const state = fixture();
        state.changeEvents.push({
            id: "forget-event",
            claimId: "claim-1",
            kind: "forget",
            scopeKey: `vault:${VAULT}`,
            effect: "none",
            occurredAt: "2026-07-10T11:00:00.000Z",
        });
        state.changeEvents.push({
            id: "old-event",
            claimId: "claim-1",
            kind: "pause",
            scopeKey: `vault:${VAULT}`,
            effect: "future_answers",
            occurredAt: "2026-07-01T11:00:00.000Z",
        });

        const result = buildGovernedMemoryViewSnapshot(state, VAULT, { now: NOW });
        const forgotten = result.recentChanges[0];

        expect(result.recentChanges.map((event) => event.id)).toEqual(["forget-event", "event-1"]);
        expect(forgotten).toEqual({
            id: "forget-event",
            claimId: "claim-1",
            kind: "forget",
            occurredAt: "2026-07-10T11:00:00.000Z",
            status: "forgotten",
            undoAvailable: false,
            redacted: true,
        });
        expect(JSON.stringify(forgotten)).not.toContain("Prefer evidence first");
        expect(JSON.stringify(forgotten)).not.toContain("notes/source.md");
    });

    it("exposes Undo only while the exact snapshot is present and unexpired", () => {
        const state = fixture();

        expect(buildGovernedMemoryViewSnapshot(state, VAULT, { now: NOW })
            .recentChanges[0].undoAvailable).toBe(true);
        expect(buildGovernedMemoryViewSnapshot(state, VAULT, {
            now: new Date("2026-07-18T12:00:00.000Z"),
            recentWindowMs: 30 * 24 * 60 * 60_000,
        }).recentChanges[0].undoAvailable).toBe(false);
    });

    it("does not offer an origin-vault scope Undo from another vault", () => {
        const state = fixture();
        state.claims.push({
            id: "device-scope-claim",
            partition: { kind: "device_collaboration", key: "device" },
            memoryType: "preference",
            sensitivity: "low",
            applicability: { kind: "whole_vault" },
            activeRevisionId: "device-scope-revision",
            effect: "collaboration_default",
            lifecycle: "active",
            createdAt: "2026-07-10T10:30:00.000Z",
            updatedAt: "2026-07-10T11:00:00.000Z",
        });
        state.revisions.push({
            id: "device-scope-revision",
            claimId: "device-scope-claim",
            summary: "Use concise replies across this device",
            authority: "user_correction",
            provenance: [{
                kind: "conversation",
                conversationIds: ["conversation-device"],
                observedAt: "2026-07-10T10:30:00.000Z",
            }],
            createdAt: "2026-07-10T11:00:00.000Z",
        });
        state.changeEvents.push({
            id: "device-scope-event",
            claimId: "device-scope-claim",
            kind: "change_scope",
            scopeKey: "device",
            effect: "collaboration_default",
            occurredAt: "2026-07-10T11:00:00.000Z",
            undoSnapshotId: "device-scope-undo",
        });
        state.undoSnapshots.push({
            id: "device-scope-undo",
            claimId: "device-scope-claim",
            eventId: "device-scope-event",
            partition: { kind: "vault", key: VAULT },
            claim: {
                ...state.claims.at(-1)!,
                partition: { kind: "vault", key: VAULT },
                effect: "future_answers",
                activeRevisionId: "device-scope-revision-before",
            },
            revisions: [{
                ...state.revisions.at(-1)!,
                id: "device-scope-revision-before",
                authority: "explicit_user",
            }],
            projectionLinks: [],
            createdAt: "2026-07-10T11:00:00.000Z",
            expiresAt: "2026-07-17T11:00:00.000Z",
        });

        const originView = buildGovernedMemoryViewSnapshot(state, VAULT, { now: NOW });
        const otherView = buildGovernedMemoryViewSnapshot(state, "vault-b", { now: NOW });

        expect(originView.recentChanges.find((event) => event.id === "device-scope-event")
            ?.undoAvailable).toBe(true);
        expect(otherView.recentChanges.find((event) => event.id === "device-scope-event")
            ?.undoAvailable).toBe(false);
    });

    it("uses the protected Undo snapshot for an older event without borrowing current details", () => {
        const state = fixture();
        state.revisions[0].summary = "Current corrected wording";
        state.revisions[0].provenance = [{
            kind: "note",
            sourceRef: { path: "notes/current-source.md" },
        }];
        state.claims[0].applicability = {
            kind: "current_note",
            paths: ["notes/current-scope.md"],
            label: "Current scope",
        };
        state.changeEvents[0].occurredAt = "2026-07-09T09:00:00.000Z";
        state.changeEvents.push({
            id: "event-latest",
            claimId: "claim-1",
            kind: "pause",
            scopeKey: `vault:${VAULT}`,
            effect: "future_answers",
            occurredAt: "2026-07-10T10:00:00.000Z",
        });

        const result = buildGovernedMemoryViewSnapshot(state, VAULT, { now: NOW });
        const older = result.recentChanges.find((event) => event.id === "event-1");
        const latest = result.recentChanges.find((event) => event.id === "event-latest");

        expect(older).toEqual({
            id: "event-1",
            claimId: "claim-1",
            kind: "correct",
            occurredAt: "2026-07-09T09:00:00.000Z",
            sourcePath: "notes/source.md",
            scope: { kind: "whole_vault" },
            effect: "future_answers",
            status: "active",
            undoAvailable: false,
            redacted: false,
        });
        expect(JSON.stringify(older)).not.toContain("Current corrected wording");
        expect(JSON.stringify(older)).not.toContain("notes/current-source.md");
        expect(JSON.stringify(older)).not.toContain("Current scope");
        expect(latest).toMatchObject({
            id: "event-latest",
            summary: "Current corrected wording",
            sourcePath: "notes/current-source.md",
            scope: { label: "Current scope" },
        });
    });

    it("projects pending Forget as content-free recovery status outside the record view", () => {
        const state = fixture();
        state.claims[0].lifecycle = "forget_pending";
        state.pendingOperations.push({
            id: "forget-operation",
            kind: "forget",
            claimId: "claim-1",
            partition: { kind: "vault", key: VAULT },
            suppressionMarkerIds: ["marker-private"],
            targets: [{ projectionLinkId: "link-1", state: "pending" }],
            phase: "claim_redacted",
            attemptCount: 1,
            createdAt: "2026-07-10T10:30:00.000Z",
            updatedAt: "2026-07-10T11:30:00.000Z",
            lastErrorCode: "private/error/details",
        });

        const result = buildGovernedMemoryViewSnapshot(state, VAULT, { now: NOW });

        expect(result.records).toEqual([]);
        expect(result.pendingForgets).toEqual([{
            claimId: "claim-1",
            updatedAt: "2026-07-10T11:30:00.000Z",
        }]);
        expect(JSON.stringify(result.pendingForgets)).not.toContain("Prefer evidence first");
        expect(JSON.stringify(result.pendingForgets)).not.toContain("notes/source.md");
        expect(JSON.stringify(result.pendingForgets)).not.toContain("private/error/details");
    });
});

function fixture(): DeviceMemoryGovernanceStateV1 {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    state.claims.push({
        id: "claim-1",
        partition: { kind: "vault", key: VAULT },
        memoryType: "preference",
        sensitivity: "low",
        applicability: { kind: "whole_vault" },
        activeRevisionId: "revision-1",
        effect: "future_answers",
        lifecycle: "active",
        createdAt: "2026-07-08T10:00:00.000Z",
        updatedAt: "2026-07-10T10:00:00.000Z",
    }, {
        id: "other-vault",
        partition: { kind: "vault", key: "vault-b" },
        memoryType: "preference",
        sensitivity: "low",
        applicability: { kind: "whole_vault" },
        activeRevisionId: "other-revision",
        effect: "future_answers",
        lifecycle: "active",
        createdAt: "2026-07-10T10:00:00.000Z",
        updatedAt: "2026-07-10T10:00:00.000Z",
    });
    state.revisions.push({
        id: "revision-1",
        claimId: "claim-1",
        summary: "Prefer evidence first",
        authority: "user_correction",
        provenance: [{ kind: "note", sourceRef: { path: "notes/source.md" } }],
        createdAt: "2026-07-08T10:00:00.000Z",
    }, {
        id: "other-revision",
        claimId: "other-vault",
        summary: "Other vault",
        authority: "source_observation",
        provenance: [{ kind: "note", sourceRef: { path: "other.md" } }],
        createdAt: "2026-07-10T10:00:00.000Z",
    });
    state.projectionLinks.push({
        id: "link-1",
        claimId: "claim-1",
        target: { kind: "review_queue", itemId: "queue-1" },
        relation: "origin",
        state: "active",
        sourceFingerprintId: "source-fingerprint",
        ruleFingerprint: "rule-fingerprint",
        createdAt: "2026-07-08T10:00:00.000Z",
    });
    state.changeEvents.push({
        id: "event-1",
        claimId: "claim-1",
        kind: "correct",
        scopeKey: `vault:${VAULT}`,
        effect: "future_answers",
        occurredAt: "2026-07-10T10:00:00.000Z",
        undoSnapshotId: "undo-1",
    });
    state.undoSnapshots.push({
        id: "undo-1",
        claimId: "claim-1",
        eventId: "event-1",
        partition: { kind: "vault", key: VAULT },
        claim: { ...state.claims[0], partition: { kind: "vault", key: VAULT } },
        revisions: [{ ...state.revisions[0], provenance: [{ kind: "note", sourceRef: { path: "notes/source.md" } }] }],
        projectionLinks: [{ ...state.projectionLinks[0], target: { kind: "review_queue", itemId: "queue-1" } }],
        createdAt: "2026-07-10T10:00:00.000Z",
        expiresAt: "2026-07-17T10:00:00.000Z",
    });
    return state;
}
