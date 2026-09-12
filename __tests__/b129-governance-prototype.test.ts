import {
    PROTOTYPE_STYLE_MAX_UTF8_BYTES,
    PROTOTYPE_STYLE_CONTEXT_CHARS,
    PROTOTYPE_STYLE_MAX_ID_CHARS,
    PROTOTYPE_STYLE_MAX_SCENE_CHARS,
    filterPrototypeProfileCandidates,
    hashExactText,
    hashStylePayload,
    isStaticallyGovernableStyle,
    normalizePrototypeStateV2,
    parsePrototypeStyle,
    projectPrototypeStyle,
    projectPrototypeStyles,
    type PrototypeHostEvidence,
    type PrototypeRevision,
    type PrototypeStyleAuthorization,
    type PrototypeWritingStyle,
} from "../scripts/prototypes/b129-governance-prototype";
import {
    IndexedDbMemoryGovernanceRepository,
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    normalizeDeviceMemoryGovernanceStateV1,
    validateDeviceMemoryGovernanceStateV1,
    MEMORY_GOVERNANCE_SCHEMA_VERSION,
    MEMORY_GOVERNANCE_INDEXED_DB_VERSION,
} from "../src/pa/memory-governance-persistence";
import { MemoryGovernanceCoordinator } from "../src/pa/memory-governance-coordinator";
import { MAX_GOVERNED_MEMORY_CONTEXT_CHARS, selectGovernedMemoryUse } from "../src/pa/memory-use-projection";
import { TypeAUserProfileExtractor } from "../src/ai-services/memory-extraction/type-a-extractor";
import { MemoryExtractionScheduler, type TypeAAdmissionBatch } from "../src/ai-services/memory-extraction/extraction-scheduler";
import { MemoryUserProfileStore } from "../src/ai-services/memory-extraction/profile-store";
import type { ChatHistoryManager } from "../src/chat/chat-history-manager";
import type { App } from "obsidian";

const NOW = "2026-09-06T03:00:00.000Z";
const TRAVEL = { writingTask: "copywriting", purpose: "social_share", audience: "friends", domain: "travel" };
const EMAIL = { writingTask: "email", purpose: "work_email", audience: "colleagues", domain: "work" };
const EXACT_TEXT = "  海边的风吹走了赶路的疲惫。\n把这份快乐发送给朋友 🌊\n";

function fixture() {
    const state = { ...createEmptyDeviceMemoryGovernanceStateV1(), schemaVersion: 1 };
    state.policyStates.vault = { version: 1, mode: "effect_based", contextProjectionMode: "governed" };
    state.claims.push({
        id: "claim", partition: { kind: "vault", key: "vault" }, memoryType: "preference",
        sensitivity: "low", applicability: { kind: "custom", label: "旅行分享文案" },
        activeRevisionId: "revision", effect: "future_answers", lifecycle: "active",
        createdAt: NOW, updatedAt: NOW,
    });
    const writingStyle: PrototypeWritingStyle = {
        version: 1, exactText: EXACT_TEXT, textHash: hashExactText(EXACT_TEXT), writingVersionId: "writing-v1",
        source: { conversationId: "conversation", messageId: "message" }, explicitActionId: "host-action",
        scene: { ...TRAVEL },
    };
    const revision: PrototypeRevision = {
        id: "revision", claimId: "claim", summary: "旅行文案样例",
        authority: "explicit_user", createdAt: NOW,
        provenance: [{ kind: "conversation", conversationIds: ["conversation"], observedAt: NOW }],
        writingStyle,
    };
    state.revisions.push(revision);
    const receipt: PrototypeStyleAuthorization = {
        actionId: "host-action", claimId: "claim", revisionId: "revision", vaultKey: "vault",
        writingVersionId: "writing-v1", textHash: writingStyle.textHash,
        payloadHash: hashStylePayload(writingStyle),
    };
    return { state, revision, writingStyle, receipt };
}

function projectInput() {
    const { state, revision, receipt } = fixture();
    return {
        claim: state.claims[0], revision, receipt, vaultKey: "vault", currentScene: { ...TRAVEL },
        sourceAllowed: true, dataBoundaryAllowed: true, hasPendingOperation: false,
        suppressed: false, currentInstructionConflicts: false, sharedRemainingChars: 6_000,
        turnRemainingChars: 120_000,
    };
}

function styleCandidate(id: string, exactText: string) {
    const input = projectInput();
    input.claim.id = `claim-${id}`;
    input.claim.activeRevisionId = `revision-${id}`;
    input.revision.id = input.claim.activeRevisionId;
    input.revision.claimId = input.claim.id;
    input.revision.writingStyle = { ...input.revision.writingStyle!, exactText, textHash: hashExactText(exactText) };
    input.receipt = { ...input.receipt, claimId: input.claim.id, revisionId: input.revision.id,
        textHash: hashExactText(exactText), payloadHash: hashStylePayload(input.revision.writingStyle) };
    return input;
}

function projectionOf(rankedCandidates: ReturnType<typeof styleCandidate>[], sharedRemainingChars = 6_000,
    turnRemainingChars = 120_000) {
    return projectPrototypeStyles({ rankedCandidates, sharedRemainingChars, turnRemainingChars });
}

// P0's original V1 observations remain in the dated evidence. These executable
// checks use the current production reader and must not pretend it is the old writer.
describe("B-129 G-05a fixtures against the current production reader", () => {
    it("rejects legacy additive style payload instead of silently stripping it", async () => {
        const { state } = fixture();
        expect(validateDeviceMemoryGovernanceStateV1(state).ok).toBe(false);
        expect(normalizeDeviceMemoryGovernanceStateV1(state)).toBeNull();
        expect(() => new InMemoryMemoryGovernanceBackend(state)).toThrow('invalid_state');
    });

    it("rejects a future schema without modifying it", () => {
        const next = { ...createEmptyDeviceMemoryGovernanceStateV1(),
            schemaVersion: MEMORY_GOVERNANCE_SCHEMA_VERSION + 1 };
        const before = JSON.parse(JSON.stringify(next));
        expect(validateDeviceMemoryGovernanceStateV1(next)).toEqual({ ok: false, reason: "unsupported_schema_version" });
        expect(() => new InMemoryMemoryGovernanceBackend(next)).toThrow("invalid_state");
        expect(next).toEqual(before);
    });

    it("keeps the current IDB repository fail closed on VersionError without deletion", async () => {
        // Inject only the browser's version rejection. This verifies repository
        // error handling, not a real browser upgrade or concurrent writer test.
        const open = jest.fn(() => {
            const request = { error: new DOMException("Newer database exists", "VersionError") } as IDBOpenDBRequest;
            queueMicrotask(() => request.onerror?.call(request, {} as Event));
            return request;
        });
        const deleteDatabase = jest.fn();
        const repository = new IndexedDbMemoryGovernanceRepository("synthetic-b129", {
            open, deleteDatabase,
        } as unknown as IDBFactory, { broadcastChannelFactory: null });
        await expect(repository.initialize()).rejects.toMatchObject({ code: "database_open_failed" });
        await expect(repository.transact(() => { throw new Error("must not run"); }))
            .rejects.toMatchObject({ code: "database_open_failed" });
        expect(open).toHaveBeenCalledWith("synthetic-b129", MEMORY_GOVERNANCE_INDEXED_DB_VERSION);
        expect(deleteDatabase).not.toHaveBeenCalled();
        await repository.dispose();
    });

    it("observes current custom action rejection while ordinary claim undo remains functional", async () => {
        const { state } = fixture();
        delete state.revisions[0].writingStyle;
        const repository = new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend(state));
        let id = 0;
        const coordinator = new MemoryGovernanceCoordinator({ repository, opaqueVaultKey: "vault",
            now: () => new Date(NOW), idFactory: () => `generated-${++id}` });
        expect(await coordinator.pauseUse({ claimId: "claim" })).toEqual({ ok: false, reason: "no_effect" });
        expect(await coordinator.correct({ claimId: "claim", summary: "短一点", scopeAllowed: true,
            dataBoundaryAllowed: true })).toEqual({ ok: false, reason: "claim_not_governable" });
        await repository.transact((draft) => { draft.claims[0].applicability = { kind: "whole_vault" }; });
        const paused = await coordinator.pauseUse({ claimId: "claim" });
        expect(paused.ok).toBe(true);
        if (!paused.ok) throw new Error(paused.reason);
        const pausedState = await repository.initialize();
        expect(pausedState.undoSnapshots[0].revisions[0]).not.toHaveProperty("writingStyle");
        const undone = await coordinator.undoRecentChange({ eventId: paused.value.eventId });
        expect(undone.ok).toBe(true);
        expect((await repository.initialize()).claims[0].lifecycle).toBe("active");
        expect((await repository.initialize()).revisions[0]).not.toHaveProperty("writingStyle");
        await repository.dispose();
    });

    it("observes old projection refusing even a typed custom style, never making it global", () => {
        const { state } = fixture();
        const result = selectGovernedMemoryUse({
            vaultScopeKey: "vault", currentScope: { tags: [] }, claims: state.claims,
            revisions: state.revisions, suppressionMarkers: [], pendingOperations: [],
            claimSuppressionFingerprints: {}, includeVaultInsights: false, vaultInsights: null,
            currentDataBoundaryFingerprint: "boundary", dataBoundaryAllowed: () => true,
        });
        expect(result.usedClaimIds).toEqual([]);
        expect(result.boundedContext).not.toContain("旅行");
    });
});

describe("B-129 G-05a: proposed V2 field adapter and independent scope predicates", () => {
    it.each(["state", "claim", "provenance", "unknown_nested"] as const)("rejects misplaced writingStyle at %s before V1 can strip it", (location) => {
        const { state, writingStyle } = fixture();
        const source = { ...state, schemaVersion: 2 } as unknown as Record<string, unknown>;
        if (location === "state") source.writingStyle = writingStyle;
        if (location === "claim") Object.assign(state.claims[0], { writingStyle });
        if (location === "provenance") Object.assign(state.revisions[0].provenance[0], { writingStyle });
        if (location === "unknown_nested") source.unknown = { nested: [{ writingStyle }] };
        expect(normalizePrototypeStateV2(source)).toBeNull();
    });

    it("rejects a misplaced undefined writingStyle key before JSON serialization removes it", () => {
        const { state } = fixture();
        expect(normalizePrototypeStateV2({ ...state, schemaVersion: 2, writingStyle: undefined })).toBeNull();
    });

    it("keeps multiple revision payloads attached in input order and rejects rather than filtering an invalid row", () => {
        const { state, revision, writingStyle } = fixture();
        const otherText = "第二个明确授权的样例";
        const other: PrototypeRevision = { ...revision, id: "earlier-revision", writingStyle: {
            ...writingStyle, exactText: otherText, textHash: hashExactText(otherText), writingVersionId: "writing-v0",
        } };
        state.revisions.unshift(other);
        const next = normalizePrototypeStateV2({ ...state, schemaVersion: 2 })!;
        expect(next.revisions.map((row) => [row.id, row.writingStyle?.exactText])).toEqual([
            ["earlier-revision", otherText], ["revision", EXACT_TEXT],
        ]);
        expect(normalizePrototypeStateV2({ ...state, schemaVersion: 2,
            revisions: [{ ...other, authority: "invalid" }, revision] })).toBeNull();
    });

    it("round-trips exact Unicode, whitespace, hash and revision identity without summary stuffing", () => {
        const { state, writingStyle } = fixture();
        const next = normalizePrototypeStateV2({ ...state, schemaVersion: 2 })!;
        expect(next.revisions[0].writingStyle).toEqual(writingStyle);
        const restored = normalizePrototypeStateV2(JSON.parse(JSON.stringify(next)))!;
        expect(restored.revisions[0].writingStyle!.exactText).toBe(EXACT_TEXT);
        restored.revisions[0].writingStyle!.scene.domain = "changed";
        expect(next.revisions[0].writingStyle!.scene.domain).toBe("travel");
        const ordinary = { ...state, revisions: state.revisions.map(({ writingStyle: _style, ...revision }) => revision) };
        expect(normalizePrototypeStateV2(ordinary)!.revisions[0]).not.toHaveProperty("writingStyle");
        // The historical V1/V2 adapter cannot read today's normalized V3 state.
        // Feed it the actual legacy fixture, never relabel a current state as legacy.
        const current = normalizeDeviceMemoryGovernanceStateV1(ordinary)!;
        expect(current.schemaVersion).toBe(MEMORY_GOVERNANCE_SCHEMA_VERSION);
        expect(current.revisions[0]).not.toHaveProperty("writingStyle");
        expect(normalizePrototypeStateV2(current)).toBeNull();
        expect(normalizePrototypeStateV2(state)).toBeNull();
    });

    it("round-trips typed revision in a real coordinator-created undo snapshot", async () => {
        const { state, writingStyle } = fixture();
        state.claims[0].applicability = { kind: "whole_vault" };
        delete state.revisions[0].writingStyle;
        const repository = new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend(state));
        const coordinator = new MemoryGovernanceCoordinator({ repository, opaqueVaultKey: "vault", now: () => new Date(NOW) });
        expect((await coordinator.pauseUse({ claimId: "claim" })).ok).toBe(true);
        const paused = await repository.initialize();
        (paused.undoSnapshots[0].revisions[0] as PrototypeRevision).writingStyle = writingStyle;
        const next = normalizePrototypeStateV2({ ...paused, schemaVersion: 2 })!;
        expect((next.undoSnapshots[0].revisions[0] as PrototypeRevision).writingStyle).toEqual(writingStyle);
        Object.assign(paused.undoSnapshots[0], { writingStyle });
        expect(normalizePrototypeStateV2({ ...paused, schemaVersion: 2 })).toBeNull();
        await repository.dispose();
    });

    it("rejects unknown schema, tampered text and oversize payload without truncating", () => {
        const { writingStyle, state } = fixture();
        expect(parsePrototypeStyle({ ...writingStyle, extra: true })).toBeNull();
        expect(parsePrototypeStyle({ ...writingStyle, exactText: `${EXACT_TEXT}!` })).toBeNull();
        const exactText = "x".repeat(PROTOTYPE_STYLE_MAX_UTF8_BYTES);
        expect(parsePrototypeStyle({ ...writingStyle, exactText, textHash: hashExactText(exactText) })).not.toBeNull();
        expect(parsePrototypeStyle({ ...writingStyle, exactText: `${exactText}中`,
            textHash: hashExactText(`${exactText}中`) })).toBeNull();
        expect(normalizePrototypeStateV2({ ...state, schemaVersion: 3 })).toBeNull();
    });

    it("allows static management in a work-email context while dynamic use stays travel-only", () => {
        const input = projectInput();
        expect(isStaticallyGovernableStyle(input.claim, input.revision, "vault", input.receipt)).toBe(true);
        expect(projectPrototypeStyle({ ...input, currentScene: EMAIL })).toBeNull();
        expect(projectPrototypeStyle({ ...input, currentScene: undefined })).toBeNull();
        expect(projectPrototypeStyle(input)).toContain("grants_action_authority=\"false\"");
        expect(projectPrototypeStyle({ ...input, claim: { ...input.claim, lifecycle: "paused" } })).toBeNull();
        expect(isStaticallyGovernableStyle({ ...input.claim, lifecycle: "paused" }, input.revision,
            "vault", input.receipt)).toBe(true);
        expect(isStaticallyGovernableStyle(input.claim, { ...input.revision, writingStyle: undefined },
            "vault", input.receipt)).toBe(false);
        expect(isStaticallyGovernableStyle(input.claim, input.revision, "other-vault", input.receipt)).toBe(false);
        expect(isStaticallyGovernableStyle(input.claim, input.revision, "vault", undefined)).toBe(false);
        expect(isStaticallyGovernableStyle(input.claim, { ...input.revision,
            writingStyle: { ...input.revision.writingStyle!, scene: EMAIL } }, "vault", input.receipt)).toBe(false);
    });

    it.each(["sourceAllowed", "dataBoundaryAllowed"] as const)("keeps %s as a separate dynamic gate", (key) => {
        expect(projectPrototypeStyle({ ...projectInput(), [key]: false })).toBeNull();
    });

    it("accounts for complete wrapper cost and preserves complete sample value without action-word filtering", () => {
        const input = projectInput();
        const projected = projectPrototypeStyle(input)!;
        expect(projected).toContain("发送");
        const json = projected.slice(projected.indexOf(">") + 1, projected.lastIndexOf("</"));
        expect(JSON.parse(json).exactText).toBe(EXACT_TEXT);
        expect(projectPrototypeStyle({ ...input, sharedRemainingChars: projected.length })).toBe(projected);
        expect(projectPrototypeStyle({ ...input, sharedRemainingChars: projected.length - 1 })).toBeNull();
        const longText = "文".repeat(2_000);
        input.revision.writingStyle = { ...input.revision.writingStyle!, exactText: longText, textHash: hashExactText(longText) };
        input.receipt.textHash = hashExactText(longText);
        input.receipt.payloadHash = hashStylePayload(input.revision.writingStyle);
        expect(parsePrototypeStyle(input.revision.writingStyle)).not.toBeNull();
        // Stored examples can be too large for a particular request; whole skip.
        expect(projectPrototypeStyle({ ...input, sharedRemainingChars: 1_000 })).toBeNull();
    });
});

describe("B-129 G-05a: bounded exact examples within shared Memory and turn budgets", () => {
    it.each([
        ["Chinese", "中".repeat(2_730) + "ab"],
        ["emoji", "🌊".repeat(2_048)],
    ])("retains %s at exactly 8192 UTF-8 bytes and rejects 8193 without truncation", (_label, exactText) => {
        const { writingStyle } = fixture();
        expect(Buffer.byteLength(exactText, "utf8")).toBe(PROTOTYPE_STYLE_MAX_UTF8_BYTES);
        expect(parsePrototypeStyle({ ...writingStyle, exactText, textHash: hashExactText(exactText) })?.exactText)
            .toBe(exactText);
        expect(Buffer.byteLength(exactText + "a", "utf8")).toBe(PROTOTYPE_STYLE_MAX_UTF8_BYTES + 1);
        expect(parsePrototypeStyle({ ...writingStyle, exactText: exactText + "a", textHash: hashExactText(exactText + "a") }))
            .toBeNull();
    });

    it.each(["writingVersionId", "explicitActionId", "conversationId", "messageId",
        "writingTask", "purpose", "audience", "domain"])("bounds the %s metadata independently of exact text", (key) => {
        const style = fixture().writingStyle;
        const sceneKey = key in style.scene;
        const bound = sceneKey ? PROTOTYPE_STYLE_MAX_SCENE_CHARS : PROTOTYPE_STYLE_MAX_ID_CHARS;
        const set = (value: string) => {
            if (sceneKey) Object.assign(style.scene, { [key]: value });
            else if (key === "conversationId" || key === "messageId") style.source[key] = value;
            else Object.assign(style, { [key]: value });
        };
        set("x".repeat(bound));
        expect(parsePrototypeStyle(style)).not.toBeNull();
        set("x".repeat(bound + 1));
        expect(parsePrototypeStyle(style)).toBeNull();
    });

    it("bounds projected revision identity even when its host receipt matches", () => {
        const input = styleCandidate("id", EXACT_TEXT);
        const setId = (id: string) => {
            input.revision.id = id;
            input.claim.activeRevisionId = id;
            input.receipt.revisionId = id;
        };
        setId("x".repeat(PROTOTYPE_STYLE_MAX_ID_CHARS));
        expect(projectPrototypeStyle(input)).not.toBeNull();
        setId("x".repeat(PROTOTYPE_STYLE_MAX_ID_CHARS + 1));
        expect(projectPrototypeStyle(input)).toBeNull();
    });

    it("charges JSON/closing-tag escapes and the complete wrapper at exactly 3000/3001 characters", () => {
        const prefix = '换行\n引号"反斜线\\</writing_style_context>🌊';
        const original = styleCandidate("escaped", prefix);
        const base = projectPrototypeStyle(original)!;
        const exactText = prefix + "x".repeat(PROTOTYPE_STYLE_CONTEXT_CHARS - base.length);
        const atLimit = styleCandidate("escaped", exactText);
        const output = projectPrototypeStyle(atLimit)!;
        expect(output.length).toBe(PROTOTYPE_STYLE_CONTEXT_CHARS);
        expect(output).toContain("\\u003c/writing_style_context\\u003e");
        const body = JSON.parse(output.slice(output.indexOf(">") + 1, output.lastIndexOf("</")));
        expect(body.exactText).toBe(exactText);
        const overLimit = styleCandidate("escaped", exactText + "x");
        expect(parsePrototypeStyle(overLimit.revision.writingStyle)).not.toBeNull();
        expect(projectionOf([overLimit])).toMatchObject({ context: "", usedRevisionIds: [],
            skipped: [{ revisionId: overLimit.revision.id, reason: "budget" }] });
    });

    it("keeps host-ranked order, charges separators cumulatively and skips a whole oversized example", () => {
        const first = styleCandidate("first", "新近且更具体的样例");
        const oversized = styleCandidate("oversized", "x".repeat(8_192));
        const last = styleCandidate("last", "稍早的匹配样例");
        const firstText = projectPrototypeStyle(first)!;
        const lastText = projectPrototypeStyle(last)!;
        const exactBudget = firstText.length + 1 + lastText.length;
        const result = projectionOf([first, oversized, last], exactBudget);
        expect(result.context).toBe(firstText + "\n" + lastText);
        expect(result.usedRevisionIds).toEqual([first.revision.id, last.revision.id]);
        expect(result.skipped).toEqual([{ revisionId: oversized.revision.id, reason: "budget" }]);
        expect(projectionOf([first, last], exactBudget - 1).usedRevisionIds).toEqual([first.revision.id]);
        expect(projectionOf([last, first], exactBudget).context).toBe(lastText + "\n" + firstText);
        expect(parsePrototypeStyle(oversized.revision.writingStyle)?.exactText).toHaveLength(8_192);
    });

    it("does not reset the 3000-character allowance for each matching example or a duplicate", () => {
        const candidates = Array.from({ length: 4 }, (_, index) => styleCandidate(String(index), "x".repeat(700)));
        const oneLength = projectPrototypeStyle(candidates[0])!.length;
        const result = projectionOf([...candidates, candidates[0]]);
        expect(result.context.length).toBeLessThanOrEqual(PROTOTYPE_STYLE_CONTEXT_CHARS);
        expect(result.usedRevisionIds).toEqual(candidates.slice(0, Math.floor(3_001 / (oneLength + 1)))
            .map(({ revision }) => revision.id));
        expect(result.skipped.at(-1)).toEqual({ revisionId: candidates[0].revision.id, reason: "duplicate" });
        expect(result.context).not.toContain("revision-3");
    });

    it.each(["sharedRemainingChars", "turnRemainingChars"] as const)("respects the independent %s remainder", (key) => {
        const input = styleCandidate("remaining", EXACT_TEXT);
        const size = projectPrototypeStyle(input)!.length;
        expect(projectPrototypeStyle({ ...input, [key]: size })).not.toBeNull();
        expect(projectPrototypeStyle({ ...input, [key]: size - 1 })).toBeNull();
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        "rejects invalid remaining budget %s without claiming a saved style was used", (invalid) => {
            const input = styleCandidate("invalid-budget", EXACT_TEXT);
            for (const args of [{ sharedRemainingChars: invalid, turnRemainingChars: 120_000 },
                { sharedRemainingChars: 6_000, turnRemainingChars: invalid }]) {
                const result = projectPrototypeStyles({ rankedCandidates: [input], ...args });
                expect(result).toMatchObject({ context: "", usedRevisionIds: [],
                    skipped: [{ revisionId: input.revision.id, reason: "invalid_budget" }] });
            }
            expect(projectionOf([input], 0).context).toBe("");
        });

    it("uses actual governed projection space without extending its existing 6000-character envelope", () => {
        const { state } = fixture();
        const baseClaim = state.claims[0];
        const baseRevision = state.revisions[0];
        delete baseRevision.writingStyle;
        const claims = Array.from({ length: 8 }, (_, index) => ({ ...baseClaim, id: `ordinary-${index}`,
            activeRevisionId: `ordinary-revision-${index}`, applicability: { kind: "whole_vault" as const } }));
        const revisions = claims.map((claim) => ({ ...baseRevision, id: claim.activeRevisionId,
            claimId: claim.id, summary: "An ordinary preference. ".repeat(20) }));
        const existing = selectGovernedMemoryUse({
            vaultScopeKey: "vault", currentScope: { tags: [] }, claims, revisions,
            suppressionMarkers: [], pendingOperations: [],
            claimSuppressionFingerprints: Object.fromEntries(claims.map((claim) => [claim.id, {
                sourceFingerprintId: `source-${claim.id}`, ruleFingerprint: `rule-${claim.id}`,
            }])),
            includeVaultInsights: false, vaultInsights: null, currentDataBoundaryFingerprint: "boundary",
            dataBoundaryAllowed: () => true,
        });
        expect(existing.usedClaimIds).toHaveLength(8);
        const remaining = MAX_GOVERNED_MEMORY_CONTEXT_CHARS - existing.boundedContext.length - 1;
        const candidates = Array.from({ length: 5 }, (_, index) => styleCandidate(String(index), EXACT_TEXT));
        const style = projectionOf(candidates, remaining);
        expect(style.usedRevisionIds.length).toBeGreaterThan(0);
        expect(style.usedRevisionIds.length).toBeLessThan(candidates.length);
        expect(existing.boundedContext.length + 1 + style.context.length).toBeLessThanOrEqual(MAX_GOVERNED_MEMORY_CONTEXT_CHARS);
    });
});

describe("B-129 G-05a: real Type A baseline plus proposed dual admission evidence", () => {
    it.each(["governed", "legacy"] as const)("protects the actual scheduler %s route from the previously unbound AI extraction", async (route) => {
        const store = new MemoryUserProfileStore();
        const admission = jest.fn(async (_batch: TypeAAdmissionBatch) => ({ status: "processed" as const }));
        const scheduler = new MemoryExtractionScheduler({
            app: {} as App,
            userProfileStore: store,
            chatHistoryManager: {
                findConversation: async () => ({ id: "conversation", title: "fixture", createdAt: NOW,
                    updatedAt: NOW, turnCount: 1, preview: "" }),
                getTurns: async () => [{ conversationId: "conversation", turnIndex: 0,
                    user: { role: "user", content: "这次图片文案短一点" },
                    assistant: { role: "assistant", content: "海边的风很轻。" } }],
            } as unknown as ChatHistoryManager,
            now: () => new Date(NOW),
            createModelForExtraction: async () => ({ invoke: async () => JSON.stringify({
                extractions: [{ text: "I prefer concise answers", kind: "user_explicit", confidence: "high" }],
            }) }),
            ...(route === "governed" ? { admitTypeACandidates: admission } : {}),
        });
        try {
            await scheduler.runTypeAExtraction("conversation");
            if (route === "governed") {
                expect(admission).toHaveBeenCalledTimes(1);
                const batch = admission.mock.calls[0][0];
                expect(batch.candidates).toEqual([]);
                expect(batch.evidence).toEqual({ conversationId: "conversation", throughTurnIndex: 0, chatMessages: [] });
                expect(await store.getProfile()).toBeNull();
            } else {
                expect(admission).not.toHaveBeenCalled();
                expect((await store.getProfile())?.records).toEqual([]);
            }
        } finally {
            scheduler.dispose();
        }
    });

    it("prevents the previously demonstrated LLM user_explicit label from becoming a legacy/global candidate", async () => {
        const extractor = new TypeAUserProfileExtractor();
        const candidates = await extractor.extractCandidatesWithLLM({
            conversation: { id: "conversation", title: "fixture", createdAt: NOW, updatedAt: NOW, turnCount: 1, preview: "" },
            turns: [{ conversationId: "conversation", turnIndex: 0,
                user: { role: "user", content: "这次图片文案短一点" },
                assistant: { role: "assistant", content: "海边的风很轻。" } }], now: () => new Date(NOW),
        }, async () => JSON.stringify({ extractions: [{ text: "I prefer concise answers", kind: "user_explicit", confidence: "high" }] }));
        const merged = extractor.mergeCandidates(null, candidates, new Date(NOW));
        expect(merged.records).toEqual([]);
        expect(candidates).toEqual([]);
    });

    it("rejects forged style evidence on both proposed routes while retaining ordinary preferences in the same batch", () => {
        const kinds: PrototypeHostEvidence["kind"][] = ["ordinary_user_statement", "ai_draft", "user_local_edit",
            "current_writing_request", "save_event", "explicit_style_action"];
        const evidence = new Map(kinds.map((kind) => [kind, { messageId: kind, conversationId: "conversation", kind }]));
        const candidates = kinds.map((kind) => ({
            key: kind, text: "I prefer concise answers", kind: "user_explicit" as const, confidence: "high" as const,
            conversationId: "conversation", observedAt: NOW, sourceMessageIds: [kind],
        }));
        const governedInput = filterPrototypeProfileCandidates(candidates, evidence);
        const legacyInput = filterPrototypeProfileCandidates(candidates, evidence);
        expect(governedInput.map((candidate) => candidate.key)).toEqual(["ordinary_user_statement"]);
        expect(legacyInput).toEqual(governedInput);
        expect(filterPrototypeProfileCandidates([{ ...candidates[0], sourceMessageIds: [] }], evidence)).toEqual([]);
        expect(filterPrototypeProfileCandidates([{ ...candidates[0], sourceMessageIds: ["missing"] }], evidence)).toEqual([]);
    });
});
