import { describe, expect, it } from "@jest/globals";

import {
    PageletDeepDiscoverController,
    type PageletDeepDiscoverControllerRunCompletion,
    type PageletDeepDiscoverControllerRunIdentity,
} from "../src/pagelet/agent/pagelet-deep-discover-controller";
import {
    PageletDeepDiscoverSmokeEvidenceStore,
} from "../src/pagelet/agent/pagelet-deep-discover-smoke-evidence";
import { pageletAgentCollectionToDeliveryCandidates } from "../src/pagelet/agent/delivery-adapter";
import type {
    PageletAgentPolicyIdentity,
    PageletAgentRunResult,
    PageletAgentSourceMaterial,
    PageletAnchorSnapshot,
    PageletDeepDiscoverControllerResult,
} from "../src/pagelet/agent/types";

const anchor: PageletAnchorSnapshot = {
    path: "retrieval-smoke/pagelet/entry.md",
    content: [
        "# Current note",
        "发布前必须完成验证。",
        "验证结果还需要留下可回滚检查点。",
    ].join("\n"),
    mtime: 10,
    size: 42,
    contentHash: "a".repeat(64),
    capturedAt: 100,
};

const releaseSource: PageletAgentSourceMaterial = {
    path: "retrieval-smoke/pagelet/release-risk.md",
    content: "# Release risk\n跳过验证直接发布会放大风险。",
    mtime: 11,
    size: 31,
    contentHash: "b".repeat(64),
    capturedAt: 101,
};

const rollbackSource: PageletAgentSourceMaterial = {
    path: "retrieval-smoke/pagelet/rollback-gap.md",
    content: "# Rollback gap\n没有回滚检查点会让恢复路径失效。",
    mtime: 12,
    size: 34,
    contentHash: "c".repeat(64),
    capturedAt: 102,
};

const policyIdentity: PageletAgentPolicyIdentity = {
    dataBoundaryIdentity: "boundary-smoke",
    providerPolicyIdentity: "provider-smoke",
    modelIdentity: "provider:model-smoke",
    locale: "zh",
};

const firstInsight = [
    "## 发布验证存在冲突",
    "`retrieval-smoke/pagelet/entry.md` 要求发布前必须完成验证；",
    "`retrieval-smoke/pagelet/release-risk.md` 说明跳过验证直接发布会放大风险，因此发布流程存在冲突。",
].join("\n");

const secondInsight = [
    "## 回滚准备存在缺口",
    "`retrieval-smoke/pagelet/entry.md` 要求验证结果留下回滚检查点；",
    "`retrieval-smoke/pagelet/rollback-gap.md` 说明没有回滚检查点会让恢复路径失效，因此回滚准备不足。",
].join("\n");

function sourceMaterials(): Map<string, PageletAgentSourceMaterial> {
    return new Map([
        [anchor.path, { ...anchor }],
        [releaseSource.path, releaseSource],
        [rollbackSource.path, rollbackSource],
    ]);
}

function makeRun(
    finalText: string,
    drafts: PageletAgentRunResult["insightDrafts"] = undefined,
    status: PageletAgentRunResult["loopResult"]["status"] = "completed",
): PageletAgentRunResult {
    const sourceSnapshots = [...sourceMaterials().values()].map((source) => ({
        path: source.path,
        mtime: source.mtime,
        size: source.size,
        contentHash: source.contentHash,
    }));
    return {
        loopResult: {
            status,
            transcript: [],
            committedFinalText: finalText,
            turns: [],
        },
        finalText,
        anchor,
        sourceSnapshots,
        sourceTools: new Map(sourceSnapshots.map((source) => [
            source.path,
            new Set([source.path === anchor.path
                ? "get_current_note_context"
                : "inspect_obsidian_note"]),
        ])),
        toolProvenance: sourceSnapshots.map((source) => ({
            toolName: source.path === anchor.path
                ? "get_current_note_context"
                : "inspect_obsidian_note",
            sourceRecords: [{
                kind: "context-used" as const,
                dedupKey: source.path,
                path: source.path,
            }],
            isError: false,
            promptText: sourceMaterials().get(source.path)?.content ?? "",
        })),
        webObservations: [],
        metrics: { modelTurns: 2, toolCalls: 3, wallTimeMs: 100 },
        runtimeCompletion: {
            loopStatus: status,
            endReason: status === "incomplete" ? "finalization_exhausted" : "final_text_ready",
            diagnosticTypes: status === "incomplete" ? ["assistant_empty_response"] : [],
            lastTurnStatus: status === "incomplete" ? "incomplete" : "completed",
            providerStopReason: "stop",
            finalTextState: finalText.length === 0
                ? "empty"
                : finalText === "NO_INSIGHT" ? "no-insight" : "candidate",
            citationCoverage: finalText.length === 0 || finalText === "NO_INSIGHT"
                ? "not-applicable"
                : "complete",
            turnCount: 2,
            toolCallCount: 3,
            insightDraftCount: drafts?.length ?? (finalText && finalText !== "NO_INSIGHT" ? 1 : 0),
            emptyFinalAnswerRetryCount: status === "incomplete" ? 1 : 0,
        },
        ...(drafts ? { insightDrafts: drafts } : {}),
    };
}

async function runWithEvidence(
    store: PageletDeepDiscoverSmokeEvidenceStore,
    run: PageletAgentRunResult | (() => PageletAgentRunResult | Promise<PageletAgentRunResult>),
    runId: string,
    acknowledge = true,
): Promise<{
    result: PageletDeepDiscoverControllerResult;
    runtimeRunId: string | undefined;
}> {
    let runtimeRunId: string | undefined;
    const controller = new PageletDeepDiscoverController({
        runtime: {
            run: async (request) => {
                runtimeRunId = request.runId;
                return typeof run === "function" ? await run() : run;
            },
        },
        captureSnapshot: async () => anchor,
        captureSourceMaterial: async (path) => sourceMaterials().get(path) ?? null,
        getPolicyIdentity: () => policyIdentity,
        getEvidenceEpoch: () => "evidence-1",
        controllerEpoch: 1,
        isPathAllowed: () => true,
        createRunId: () => runId,
        onRunStart: (identity) => store.begin(identity),
        onRunComplete: (result, _request, completion) => (
            store.stageControllerResult(completion, result)
        ),
    });
    const result = await controller.run({
        path: anchor.path,
        triggerReason: "explicit",
        force: true,
    });
    if (acknowledge) {
        const candidates = result.status === "verified" || result.status === "cache-hit"
            ? pageletAgentCollectionToDeliveryCandidates(result.collection, "zh")
            : [];
        store.acknowledgeOrchestratorResult(result, candidates);
    }
    return {
        result,
        runtimeRunId,
    };
}

describe("Pagelet production smoke evidence", () => {
    it("proves a real zero result stayed quiet with no cache/candidate/receipt mutation", async () => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        const { result, runtimeRunId } = await runWithEvidence(
            store,
            makeRun("NO_INSIGHT", []),
            "pagelet-real-zero",
        );
        const snapshot = await store.snapshot();

        expect(result).toMatchObject({ status: "quiet", reason: "no-insight" });
        expect(runtimeRunId).toBe("pagelet-real-zero");
        expect(snapshot).toMatchObject({
            schemaVersion: 2,
            sequence: 1,
            controllerSequence: 1,
            runId: "pagelet-real-zero",
            resultId: "pagelet-real-zero:result",
            entryPath: anchor.path,
            triggerReason: "explicit",
            force: true,
            resultStatus: "quiet",
            reason: "no-insight",
            runtimeCompletion: expect.objectContaining({
                loopStatus: "completed",
                finalTextState: "no-insight",
                citationCoverage: "not-applicable",
            }),
            collectionId: null,
            candidateCount: 0,
            deliveryReceiptCount: 0,
            cacheMutationCount: 0,
            cacheEntryCountBefore: 0,
            cacheEntryCountAfter: 0,
            quietWriteInvariantSatisfied: true,
            insights: [],
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot?.insights)).toBe(true);
    });

    it("projects one committed result through the production delivery adapter without content", async () => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        await runWithEvidence(store, makeRun(firstInsight), "pagelet-real-one");
        const snapshot = await store.snapshot();

        expect(snapshot).toMatchObject({
            resultStatus: "verified",
            reason: null,
            candidateCount: 1,
            deliveryReceiptCount: 1,
            cacheMutationCount: 1,
            cacheEntryCountBefore: 0,
            cacheEntryCountAfter: 1,
            quietWriteInvariantSatisfied: false,
        });
        expect(snapshot?.insights).toHaveLength(1);
        expect(snapshot?.insights[0]).toMatchObject({
            sourcePaths: [anchor.path, releaseSource.path],
            deliveryReceipt: { version: 1, kind: "review" },
        });
        expect(snapshot?.insights[0]?.candidateId).toBe(snapshot?.insights[0]?.insightId);
        expect(snapshot?.insights[0]?.deliveryReceiptSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(JSON.stringify(snapshot)).not.toContain("发布前必须完成验证");
        expect(JSON.stringify(snapshot)).not.toContain("promptText");
    });

    it("keeps two shared-anchor insights, candidates, and receipts independent", async () => {
        const run = makeRun(secondInsight, [
            {
                body: firstInsight,
                origin: "staged",
                declaredSourceIds: [anchor.path, releaseSource.path],
            },
            {
                body: secondInsight,
                origin: "terminal",
                declaredSourceIds: [],
            },
        ]);
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        await runWithEvidence(store, run, "pagelet-real-two");
        const snapshot = await store.snapshot();

        expect(snapshot).toMatchObject({
            resultStatus: "verified",
            candidateCount: 2,
            deliveryReceiptCount: 2,
            cacheMutationCount: 1,
        });
        expect(snapshot?.insights.map((insight) => insight.sourcePaths)).toEqual([
            [anchor.path, releaseSource.path],
            [anchor.path, rollbackSource.path],
        ]);
        expect(new Set(snapshot?.insights.map((insight) => insight.insightId)).size).toBe(2);
        expect(new Set(snapshot?.insights.map((insight) => insight.candidateId)).size).toBe(2);
        expect(new Set(snapshot?.insights.map((insight) => (
            insight.deliveryReceipt.fingerprint
        ))).size).toBe(2);
        expect(new Set(snapshot?.insights.map((insight) => (
            insight.deliveryReceiptSha256
        ))).size).toBe(2);
    });

    it("fails closed for stale completions and clears lifecycle evidence", async () => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        const first = runIdentity(1, "first-run", "first.md");
        const second = runIdentity(1, "second-run", "second.md");
        const firstResult = { status: "quiet", reason: "no-insight" } as const;
        const secondResult = { status: "quiet", reason: "no-insight" } as const;
        store.begin(first);
        store.stageControllerResult(runCompletion(first), firstResult);
        store.begin(second);
        store.acknowledgeOrchestratorResult(firstResult, []);
        await expect(store.snapshot()).resolves.toBeNull();

        store.stageControllerResult(runCompletion(second), secondResult);
        store.acknowledgeOrchestratorResult(secondResult, []);
        await expect(store.snapshot()).resolves.toMatchObject({
            sequence: 2,
            runId: "second-run",
            entryPath: "second.md",
        });
        store.clear();
        await expect(store.snapshot()).resolves.toBeNull();
    });

    it("keeps an accepted explicit snapshot when later automatic work completes", async () => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        await runWithEvidence(store, makeRun(firstInsight), "explicit-before-background");
        const background = runIdentity(
            2,
            "later-leave-note",
            "retrieval-smoke/pagelet/background.md",
            "leave-note",
            false,
        );
        const backgroundResult = { status: "quiet", reason: "no-insight" } as const;

        store.begin(background);
        store.stageControllerResult(runCompletion(background), backgroundResult);
        store.acknowledgeOrchestratorResult(backgroundResult, []);

        await expect(store.snapshot()).resolves.toMatchObject({
            sequence: 1,
            runId: "explicit-before-background",
            entryPath: anchor.path,
            triggerReason: "explicit",
            force: true,
            resultStatus: "verified",
        });
    });

    it("binds an explicit run when earlier background work finishes first", async () => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        const background = runIdentity(
            7,
            "background-started-first",
            "retrieval-smoke/pagelet/background.md",
            "edit-idle",
            false,
        );
        const explicit = runIdentity(8, "foreground-finishes-later", anchor.path);
        const backgroundResult = { status: "quiet", reason: "aborted" } as const;
        const explicitResult = { status: "quiet", reason: "no-insight" } as const;

        store.begin(background);
        store.begin(explicit);
        store.stageControllerResult(runCompletion(background), backgroundResult);
        store.acknowledgeOrchestratorResult(backgroundResult, []);
        await expect(store.snapshot()).resolves.toBeNull();
        store.stageControllerResult(runCompletion(explicit), explicitResult);
        store.acknowledgeOrchestratorResult(explicitResult, []);

        await expect(store.snapshot()).resolves.toMatchObject({
            sequence: 1,
            controllerSequence: 8,
            runId: "foreground-finishes-later",
            resultStatus: "quiet",
            reason: "no-insight",
            quietWriteInvariantSatisfied: true,
        });
    });

    it("rejects an asynchronous receipt read superseded by a newer run", async () => {
        let finishDigest: ((digest: string | null) => void) | undefined;
        const store = new PageletDeepDiscoverSmokeEvidenceStore(() => new Promise((resolve) => {
            finishDigest = resolve;
        }));
        await runWithEvidence(store, makeRun(firstInsight), "hash-race-first");

        const staleRead = store.snapshot();
        store.begin(runIdentity(1, "hash-race-second", "second.md"));
        finishDigest?.("d".repeat(64));

        await expect(staleRead).resolves.toBeNull();
    });

    it("does not expose a controller completion before Orchestrator acknowledgement", async () => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        const { result } = await runWithEvidence(
            store,
            makeRun(firstInsight),
            "awaiting-orchestrator",
            false,
        );

        await expect(store.snapshot()).resolves.toBeNull();
        if (result.status !== "verified") throw new Error("expected verified result");
        const candidates = pageletAgentCollectionToDeliveryCandidates(result.collection, "zh");
        store.acknowledgeOrchestratorResult(result, candidates);
        await expect(store.snapshot()).resolves.toMatchObject({
            runId: "awaiting-orchestrator",
            candidateCount: 1,
        });
    });

    it("fails closed when a positive result is acknowledged without its accepted candidates", async () => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        const { result } = await runWithEvidence(
            store,
            makeRun(firstInsight),
            "missing-accepted-candidate",
            false,
        );

        store.acknowledgeOrchestratorResult(result, []);

        await expect(store.snapshot()).resolves.toBeNull();
    });

    it.each([
        [{ status: "stale", reason: "evidence-epoch-changed" } as const],
        [{ status: "denied", reason: "data-boundary" } as const],
        [{ status: "limit", reason: "limit" } as const],
        [{ status: "error", reason: "deep-discover-failed" } as const],
    ])("projects an acknowledged non-success controller outcome: %o", async (result) => {
        const store = new PageletDeepDiscoverSmokeEvidenceStore();
        const identity = runIdentity(1, `outcome-${result.status}`, anchor.path);
        store.begin(identity);
        store.stageControllerResult(runCompletion(identity), result);
        store.acknowledgeOrchestratorResult(result, []);

        await expect(store.snapshot()).resolves.toMatchObject({
            resultStatus: result.status,
            reason: result.reason,
            collectionId: null,
            insights: [],
            candidateCount: 0,
            deliveryReceiptCount: 0,
            quietWriteInvariantSatisfied: false,
        });
    });

    it("records error and incomplete outcomes without manufacturing a pass", async () => {
        const errorStore = new PageletDeepDiscoverSmokeEvidenceStore();
        const error = await runWithEvidence(errorStore, () => {
            throw new Error("provider failed");
        }, "pagelet-real-error");
        expect(error.result).toEqual({ status: "error", reason: "deep-discover-failed" });
        await expect(errorStore.snapshot()).resolves.toMatchObject({
            resultStatus: "error",
            reason: "deep-discover-failed",
            candidateCount: 0,
            deliveryReceiptCount: 0,
            quietWriteInvariantSatisfied: false,
        });

        const incompleteStore = new PageletDeepDiscoverSmokeEvidenceStore();
        await runWithEvidence(
            incompleteStore,
            makeRun("", [], "incomplete"),
            "pagelet-real-incomplete",
        );
        await expect(incompleteStore.snapshot()).resolves.toMatchObject({
            schemaVersion: 2,
            resultStatus: "quiet",
            reason: "runtime-incomplete",
            runtimeCompletion: expect.objectContaining({
                loopStatus: "incomplete",
                endReason: "finalization_exhausted",
                diagnosticTypes: ["assistant_empty_response"],
                finalTextState: "empty",
                emptyFinalAnswerRetryCount: 1,
            }),
            collectionId: null,
            candidateCount: 0,
        });
    });
});

function runIdentity(
    sequence: number,
    runId: string,
    anchorPath: string,
    triggerReason: PageletDeepDiscoverControllerRunIdentity["triggerReason"] = "explicit",
    force = true,
): PageletDeepDiscoverControllerRunIdentity {
    return Object.freeze({
        schemaVersion: 1,
        sequence,
        runId,
        anchorPath,
        triggerReason,
        force,
        cacheBefore: Object.freeze({ version: 0, entryCount: 0 }),
    });
}

function runCompletion(
    identity: PageletDeepDiscoverControllerRunIdentity,
): PageletDeepDiscoverControllerRunCompletion {
    return Object.freeze({
        ...identity,
        resultId: `${identity.runId}:result`,
        cacheAfter: Object.freeze({ version: 0, entryCount: 0 }),
    });
}
