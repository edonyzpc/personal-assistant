import { execFileSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it } from "@jest/globals";

interface PreparationReport {
    fixtureVersion: string;
    mode: string;
    vaultRoot: string;
    totals: { create: number; update: number; unchanged: number };
    files: Array<{ kind: string; path: string; sha256: string }>;
    next: string[];
}

interface SmokeRecorder {
    readonly nextPerformanceWorkload: {
        id: string;
        stage: string;
        sampleClass: string;
        promptId: string;
        prompt: string;
        expectedShape: string;
        sequence: number;
        count: number;
    } | null;
    readonly rankingChecklist: Record<string, { prompt: string; record: string }>;
    readonly routingChecklist: Record<string, { prompt: string; expect: string }>;
    recordCase(id: string, status: "PASS" | "FAIL" | "BLOCKED", detail?: string): Promise<unknown>;
    recordRecoveryCase(): Promise<{
        status: string;
        finalSources: string[];
        standardSources: string[];
        standardEvidenceMode: "valid-none" | "strict-partial" | "invalid";
        targetPresent: boolean;
        invalidSourceCount: number;
        duplicateSourceCount: number;
        opaqueHitCount: number;
        unexpectedSourceCount: number;
        a2FailureReason: string | null;
        sourceBinding: {
            evidenceSource: string;
            exactPromptMatched: boolean;
            turnStatus: string;
            successfulSearchMemoryToolResultCount: number;
            selectedMemorySourceCount: number;
            memorySourceRecordPathCount: number;
            allowedMemorySourcePathCount: number;
            sourceSetsMatch: boolean;
            opaqueRunCorrelationSha256: string;
            diagnosticsRunMatched: boolean;
        };
        evidenceSha256: string;
        detail: string;
        topology: {
            droppedEventCount: number | null;
            episodeCount: number;
            memoryAttemptCount: number;
            standardMemoryDocumentCount: number | null;
            relaxedMemoryDocumentCount: number | null;
            standardEvidenceMode: "valid-none" | "strict-partial" | "invalid";
            standardDocumentCount: number | null;
            relaxedMemoryOutcome: string | null;
            relaxedRetryCount: number;
            relaxedOutcome: string | null;
            relaxedDocumentCount: number | null;
            retryConsumed: boolean;
            projectionCompletedCount: number;
            projectionDocumentCount: number | null;
        };
    }>;
    recordTemporalRetryCase(): Promise<{
        status: string;
        finalSources: string[];
        standardSources: string[];
        standardEvidenceMode: "valid-none" | "strict-partial" | "invalid";
        targetPresent: boolean;
        forbiddenHitCount: number;
        invalidSourceCount: number;
        duplicateSourceCount: number;
        unexpectedSourceCount: number;
        evidenceSha256: string;
        detail: string;
        sourceBinding: {
            evidenceSource: string;
            exactPromptMatched: boolean;
            turnStatus: string;
            successfulSearchMemoryToolResultCount: number;
            selectedMemorySourceCount: number;
            memorySourceRecordPathCount: number;
            allowedMemorySourcePathCount: number;
            sourceSetsMatch: boolean;
            opaqueRunCorrelationSha256: string;
            diagnosticsRunMatched: boolean;
        };
        topology: {
            droppedEventCount: number | null;
            episodeCount: number;
            memoryAttemptCount: number;
            standardMemoryDocumentCount: number | null;
            relaxedMemoryDocumentCount: number | null;
            standardEvidenceMode: "valid-none" | "strict-partial" | "invalid";
            standardTemporalFilterApplied: number | null;
            standardTemporalViolationCount: number | null;
            relaxedTemporalFilterApplied: number | null;
            relaxedTemporalViolationCount: number | null;
            relaxedRetryCount: number;
            retryConsumed: boolean;
            projectionCompletedCount: number;
            projectionTemporalFilterApplied: number | null;
            projectionTemporalViolationCount: number | null;
        };
    }>;
    recordPageletCase(id: "pagelet-0" | "pagelet-1" | "pagelet-2"): Promise<{
        status: string;
        entryPath: string;
        expectedInsightCount: number;
        observedInsightCount: number;
        verifiedInsightCount: number;
        insights: Array<{
            insightId: string;
            candidateId: string;
            sourcePaths: string[];
            deliveryReceiptSha256: string;
            verified: boolean;
        }>;
        duplicateInsightIdCount: number;
        duplicateSourceCount: number;
        opaqueHitCount: number;
        unexpectedSourceCount: number;
    }>;
    recordRankingCase(id: string): Promise<unknown>;
    freezeDeviceMeasurementPlan(overrides?: Record<string, unknown>): Promise<unknown>;
    recordPerformanceQualification(kind: "standard" | "retry", ...args: unknown[]): Promise<unknown>;
    recordPerformanceEpisode(...args: unknown[]): Promise<unknown>;
    recordDeviceMetric(id: string, evidence: {
        method: "measured" | "estimated" | "manual" | "unsupported";
        samples: number[];
    }): Promise<{
        status: string;
        rawSamples: number[];
        evaluatedSamples: number[];
        p50: number | null;
        p95: number | null;
    }>;
    sampleEventLoopGap(): Promise<{ status: string; method: string; rawSamples: number[] }>;
    startRuntimeEnvelope(...args: unknown[]): Promise<{ status: string; workloadCoverageStatus: string }>;
    beginRetryPerformance(...args: unknown[]): Promise<unknown>;
    continueRetryPerformance(...args: unknown[]): Promise<unknown>;
    stopRuntimeEnvelope(...args: unknown[]): Promise<{
        envelope: {
            status: string;
            workloadCoverageStatus: string;
            coveredStandardPerformanceEpisodeCount: number;
            coveredRetryPerformanceEpisodeCount: number;
            startedAt: string;
            finishedAt: string;
        };
        database: { status: string; rawSamples: number[]; maximum: number | null };
        processMemory: { status: string; rawSamples: number[]; maximum: number | null };
        eventLoopStall: { status: string; rawSamples: number[]; maximum: number | null };
    }>;
    recordExternalMemoryEnvelope(evidence: {
        artifactPath?: string;
    }): Promise<{
        envelope: { status: string; sourceCoverage: { processMemory: string } };
        processMemory: { status: string; rawSamples: number[]; maximum: number | null };
    }>;
    sampleLongTasks(windowMs?: number): Promise<{ status: string; method: string; rawSamples: number[] }>;
    recordVssStats(phase: "before" | "after", stats?: Record<string, unknown>): Promise<Record<string, number>>;
    recordDiagnosticsSnapshot(snapshot: Record<string, unknown>): Promise<Record<string, unknown>>;
    captureRetrievalDiagnostics(): Promise<Record<string, unknown> | null>;
    stopRetrievalDiagnostics(): Promise<Record<string, unknown> | null>;
    beginCancellationProbe(...args: unknown[]): Promise<unknown>;
    readonly result: {
        recoveryCase: {
            status: string;
            finalSources: string[];
            detail: string;
        };
        temporalRetryCase: {
            status: string;
            finalSources: string[];
            detail: string;
        };
        rerankerMetrics: {
            completed: number;
            required: number;
            recallAt8: number;
            mrr: number;
            forbiddenHitCount: number;
        };
        rankingCases: Record<string, {
            status: string;
        }>;
        pageletCases: Record<string, {
            status: string;
            verifiedInsightCount: number | null;
            insights: Array<{ insightId: string; sourcePaths: string[]; verified: boolean }>;
            detail: string;
        }>;
        deviceMeasurement: {
            planSha256: string | null;
            metrics: Record<string, {
                status: string;
                method: string | null;
                evidenceSource?: string | null;
                rawSamples: number[];
                maximum?: number | null;
            }>;
            diagnostics?: Record<string, unknown> | null;
            diagnosticsSummary?: Record<string, unknown> | null;
        };
    };
    finalize(): Promise<{
        overall: string;
        rerankerMetrics?: {
            completed: number;
            required: number;
            recallAt8: number;
            mrr: number;
            forbiddenHitCount: number;
        };
        rankingCases?: Record<string, { rankedSources: string[]; status: string }>;
        runtime?: { rerankerClass?: string; rerankerIdentitySha256?: string };
        deviceMeasurement?: {
            overall: string;
            planStatus: string;
            planSha256: string | null;
            metrics: Record<string, {
                status: string;
                method: string | null;
                rawSamples: number[];
                evaluatedSamples: number[];
                p50: number | null;
                p95: number | null;
            }>;
            rerankerGate: { status: string };
            vssStats: { before: Record<string, number> | null; after: Record<string, number> | null };
            diagnostics: Record<string, unknown> | null;
            diagnosticsSummary: Record<string, unknown> | null;
            diagnosticsGate: { status: string; reason: string; schemaVersion: number | null };
        };
    }>;
}

interface SmokeWriteControl {
    deferNextResultWrite(): void;
    deferResultWriteAfter(skippedWrites: number): void;
    waitUntilDeferred(): Promise<void>;
    releaseDeferred(): void;
    failDeferredResultWrite(): void;
}

interface SmokeDiagnosticsControl {
    readonly startCalls: number;
    readonly getCalls: number;
    readonly stopCalls: number;
    readonly armCalls: number;
    pushEvent(event: Record<string, unknown>): void;
    deferNextCapture(): void;
    waitUntilCaptureDeferred(): Promise<void>;
    releaseCapture(): void;
    waitForGetCalls(count: number): Promise<void>;
}

interface SmokeExternalMemoryArtifactControl {
    setArtifact(artifact: Record<string, unknown> | null): void;
    setArtifactBytes(bytes: Uint8Array | null): void;
    replaceArtifactAfterNextRead(artifact: Record<string, unknown> | null): void;
    setRawExport(rawExport: string | null): void;
    setRawExportBytes(bytes: Uint8Array | null): void;
    replaceRawExportAfterNextRead(rawExport: string | null): void;
}

interface SmokeVaultEventControl {
    readonly listenerCount: number;
    emitCreate(path: string): void;
    emitModify(path: string): void;
    emitDelete(path: string): void;
    emitRename(oldPath: string, newPath: string): void;
    emitAfterExternalBinaryReads(count: number, event: "create" | "modify" | "delete" | "rename", path: string, oldPath?: string): void;
}

interface SmokeRuntimeIdentityControl {
    readonly loadedBuildIdentityCalls: number;
    setAppVersion(version: string): void;
    setPluginVersion(version: string): void;
    setUserAgent(userAgent: string): void;
    setRunnerArtifact(source: string): void;
    setPluginArtifact(source: string): void;
    reloadPluginWithArtifact(source: string): void;
    restoreInitialPluginInstance(): void;
}

interface SmokeSettingsControl {
    readonly listenerCount: number;
    notifySettingsChanged(): Promise<void>;
}

interface RecoveryCanonicalTurnOptions {
    prompt?: string;
    canonicalPrompt?: string;
    selectedPaths?: readonly string[];
    sourceRecordPaths?: readonly string[];
    allowedPaths?: readonly string[];
    selectedPathValues?: readonly unknown[];
    sourceRecordPathValues?: readonly unknown[];
    allowedPathValues?: readonly unknown[];
    status?: string;
    runId?: string;
    streaming?: boolean;
    memoryToolResultCount?: number;
    successfulToolResult?: boolean;
    selectedMemoryItemCount?: number;
    visiblePaths?: readonly string[];
    omitToolCallAssistant?: boolean;
    omitFinalCanonicalAssistant?: boolean;
    metadata?: Record<string, unknown>;
}

interface SmokeChatControl {
    setRecoveryTurn(options?: RecoveryCanonicalTurnOptions): void;
    setRecoveryViews(options: RecoveryCanonicalTurnOptions[]): void;
    clearRecoveryViews(): void;
    setCanonicalTurn(options: RecoveryCanonicalTurnOptions): void;
}

interface SmokePageletControl {
    setCase(
        id: "pagelet-0" | "pagelet-1" | "pagelet-2",
        overrides?: Record<string, unknown>,
    ): Record<string, unknown>;
    setSnapshot(snapshot: Record<string, unknown> | null): void;
    clearSnapshot(): void;
}

const diagnosticsChatControls = new WeakMap<SmokeDiagnosticsControl, SmokeChatControl>();

const RECOVERY_PROMPT = "只从我的笔记中回答：RCV-271 猩红雨伞事故的根因是什么？";
const RECOVERY_TARGET_PATH = "retrieval-smoke/recovery/90-relaxed-target.md";
const TEMPORAL_RETRY_PROMPT = "只从我的笔记中，仅使用 2026-01-01 到 2026-12-31 的记录回答：TRT-826 紫晶日晷事故的根因是什么？";
const PERFORMANCE_STANDARD_PROMPT = "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因是什么？";
const PERFORMANCE_RETRY_PROMPT = "只从我的笔记中回答：PFR-842 琥珀罗盘事故的完整根因是什么？";
const PERFORMANCE_CANCEL_PROMPT = "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因与修复方向是什么？";
const PERFORMANCE_WAVE1_PATH = "retrieval-smoke/performance/200-wave1-direct-04.md";
const PERFORMANCE_WAVE2_TARGET_PATH = "retrieval-smoke/performance/220-wave2-target.md";
const DEFAULT_DIAGNOSTIC_RUN_ID = "run-live-recovery";

const smokeCases = [
    "lexical",
    "chat-recovery",
    "temporal-retry",
    "graph-depth",
    "opaque-boundary",
    "pagelet-0",
    "pagelet-1",
    "pagelet-2",
    "temporal",
];

const passingRankings: Record<string, string[]> = {
    "lexical-title": ["retrieval-smoke/lexical/量子灯塔检索.md"],
    "lexical-heading": ["retrieval-smoke/lexical/量子灯塔检索.md"],
    "lexical-error": ["retrieval-smoke/lexical/量子灯塔检索.md"],
    "graph-depth": ["retrieval-smoke/graph/30-deep-target.md"],
    convergence: ["retrieval-smoke/graph/42-convergence-target.md"],
    "temporal-2026": ["retrieval-smoke/temporal/61-recent-note.md"],
};

const rankingPrompts: Record<string, string> = {
    "lexical-title": "只从我的笔记中查找“量子灯塔检索”，并根据找到的记录回答。",
    "lexical-heading": "只从我的笔记中查找“延迟恢复矩阵”，并根据找到的记录回答。",
    "lexical-error": "只从我的笔记中查找错误码“ERR_RETRIEVAL_LANTERN_7401”，并根据找到的记录回答。",
    "graph-depth": "只从我的笔记中回答：青铜罗盘为什么出现资源峰值？",
    convergence: "只从我的笔记中回答：蓝色账本重复入账的共同原因是什么？",
    "temporal-2026": "只从我的笔记中，仅使用 2026 年的记录说明当前时间边界信号。",
};

const pageletFixtureDefinitions = {
    "pagelet-0": {
        entryPath: "retrieval-smoke/pagelet/52-no-insight.md",
        sourcePaths: [],
    },
    "pagelet-1": {
        entryPath: "retrieval-smoke/pagelet/51-one-insight.md",
        sourcePaths: ["retrieval-smoke/pagelet/53-single-source.md"],
    },
    "pagelet-2": {
        entryPath: "retrieval-smoke/pagelet/50-current-note.md",
        sourcePaths: [
            "retrieval-smoke/pagelet/54-double-source-a.md",
            "retrieval-smoke/pagelet/55-double-source-b.md",
        ],
    },
} as const;

function createPageletSmokeSnapshot(
    id: keyof typeof pageletFixtureDefinitions,
    sequence: number,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    const definition = pageletFixtureDefinitions[id];
    const insights = definition.sourcePaths.map((sourcePath, index) => {
        const suffix = `${sequence * 2 + index + 1}`.padStart(16, "0");
        const insightId = `pagelet-insight:${id}:${index + 1}`;
        return {
            insightId,
            candidateId: insightId,
            sourcePaths: [definition.entryPath, sourcePath],
            deliveryReceipt: {
                version: 1,
                kind: "review",
                fingerprint: `v1:review:${suffix}`,
            },
            deliveryReceiptSha256: `${sequence * 2 + index + 1}`.padStart(64, "0"),
        };
    });
    const positive = insights.length > 0;
    return {
        schemaVersion: 1,
        sequence,
        controllerSequence: sequence,
        runId: `pagelet-run:${sequence}`,
        resultId: `pagelet-run:${sequence}:result`,
        entryPath: definition.entryPath,
        triggerReason: "explicit",
        force: true,
        resultStatus: positive ? "verified" : "quiet",
        reason: positive ? null : "no-insight",
        collectionId: positive ? `pagelet-collection:${sequence}` : null,
        insights,
        candidateCount: insights.length,
        deliveryReceiptCount: insights.length,
        cacheMutationCount: positive ? 1 : 0,
        cacheEntryCountBefore: 0,
        cacheEntryCountAfter: positive ? 1 : 0,
        quietWriteInvariantSatisfied: !positive,
        ...overrides,
    };
}

const requiredDeviceMetrics = [
    "retrieval.totalDurationMs",
    "retrieval.lexicalDurationMs",
    "retrieval.graphDurationMs",
    "retrieval.retryTotalDurationMs",
    "retrieval.retryGraphDurationMs",
    "retrieval.retryGraphWorkerQueueWaitMs",
    "retrieval.retryGraphWorkerMaxBatchDurationMs",
    "retrieval.graphWorkerQueueWaitMs",
    "retrieval.graphWorkerMaxBatchDurationMs",
    "retrieval.finalizationReserveMs",
    "retrieval.retryFinalizationReserveMs",
    "ui.eventLoopGapMs",
    "ui.maxEventLoopStallMs",
    "lexical.rebuildDurationMs",
    "lexical.incrementalUpdateDurationMs",
    "storage.estimatedDbBytes",
    "storage.peakEstimatedDbBytes",
    "memory.peakProcessFootprintBytes",
    "retrieval.deadlineExceededCount",
    "retrieval.cancelRequestedCount",
    "retrieval.cancelObservedCount",
    "retrieval.acceptedAfterCancelCount",
    "retrieval.lateDiscardCount",
];

const temporaryVaults: string[] = [];
const activeRunnerContexts: Array<Record<string, unknown>> = [];

afterEach(async () => {
    // The recorder owns two runtime-envelope sampling loops. Several tests
    // intentionally exercise validation failures after starting that envelope
    // and do not otherwise need to finalize it. Stop those loops here so a
    // test-only abandoned session cannot keep the Jest process alive.
    await Promise.all(activeRunnerContexts.map(async (context) => {
        const recorder = context.paRetrievalSmoke as Partial<SmokeRecorder> | undefined;
        try {
            await recorder?.stopRuntimeEnvelope?.();
        } catch {
            // The test has already asserted the relevant failure state. Cleanup
            // must never obscure that assertion with a secondary teardown error.
        }
    }));
    activeRunnerContexts.length = 0;
    while (temporaryVaults.length > 0) {
        rmSync(temporaryVaults.pop()!, { recursive: true, force: true });
    }
});

describe("B-125 retrieval app-smoke fixture", () => {
    it("prepares the isolated fixture pack idempotently without deleting vault files", () => {
        const repositoryRoot = resolve(__dirname, "..");
        const vaultRoot = mkdtempSync(join(tmpdir(), "pa-retrieval-smoke-"));
        temporaryVaults.push(vaultRoot);
        writeFileSync(join(vaultRoot, "keep-me.md"), "unrelated vault content", "utf8");

        const first = prepare(repositoryRoot, vaultRoot);
        expect(first).toMatchObject({
            fixtureVersion: "b125-retrieval-smoke-v5",
            mode: "write",
            vaultRoot,
            totals: { create: 64, update: 0, unchanged: 0 },
        });
        expect(first.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
        expect(first.next).toEqual(expect.arrayContaining([
            expect.stringContaining("recordRecoveryCase"),
            expect.stringContaining("recordTemporalRetryCase"),
            expect.stringContaining("complete search_memory episode"),
            expect.stringContaining("recordPageletCase"),
        ]));
        expect(readFileSync(join(vaultRoot, "retrieval-smoke/lexical/量子灯塔检索.md"), "utf8"))
            .toContain("ERR_RETRIEVAL_LANTERN_7401");
        const twoInsightEntry = readFileSync(
            join(vaultRoot, "retrieval-smoke/pagelet/50-current-note.md"),
            "utf8",
        );
        expect(twoInsightEntry).toContain("PGL-CORAL-318");
        expect(twoInsightEntry).toContain("PGL-SILVER-624");
        expect(twoInsightEntry).not.toContain("retrieval-smoke/graph/");
        expect(twoInsightEntry).not.toContain("retrieval-smoke/recovery/");
        expect(twoInsightEntry).toContain(
            "[[retrieval-smoke/pagelet/54-double-source-a|珊瑚邮筒归档复盘]]",
        );
        expect(twoInsightEntry).toContain(
            "[[retrieval-smoke/pagelet/55-double-source-b|银色温室传感器复盘]]",
        );
        expect(twoInsightEntry).toContain("两条原因尚未整合");
        expect(twoInsightEntry).toContain("Deep Discover");
        expect(twoInsightEntry).not.toContain("单并发队列");
        expect(twoInsightEntry).not.toContain("预热完成前");
        const oneInsightEntry = readFileSync(
            join(vaultRoot, "retrieval-smoke/pagelet/51-one-insight.md"),
            "utf8",
        );
        expect(oneInsightEntry).toContain("PGL-KITE-507");
        expect(oneInsightEntry).not.toContain("retrieval-smoke/graph/");
        expect(oneInsightEntry).not.toContain("[[");
        expect(oneInsightEntry).not.toContain("skip-validation");
        expect(readFileSync(
            join(vaultRoot, "retrieval-smoke/pagelet/52-no-insight.md"),
            "utf8",
        )).not.toContain("[[");
        expect(readFileSync(
            join(vaultRoot, "retrieval-smoke/pagelet/53-single-source.md"),
            "utf8",
        )).toContain("skip-validation");
        expect(readFileSync(
            join(vaultRoot, "retrieval-smoke/pagelet/54-double-source-a.md"),
            "utf8",
        )).toContain("单并发队列");
        expect(readFileSync(
            join(vaultRoot, "retrieval-smoke/pagelet/55-double-source-b.md"),
            "utf8",
        )).toContain("预热完成前");
        expect(readFileSync(join(vaultRoot, "retrieval-optimization-smoke-runner.js"), "utf8"))
            .toContain("manual cases remain PENDING until explicitly recorded");
        expect(statSync(join(vaultRoot, "retrieval-smoke/temporal/60-old-note.md")).mtime.toISOString())
            .toBe("2020-01-15T08:00:00.000Z");
        expect(statSync(join(
            vaultRoot,
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        )).mtime.toISOString()).toBe("2026-06-15T08:00:00.000Z");
        expect(statSync(join(
            vaultRoot,
            "retrieval-smoke/temporal-retry/113-old-forbidden.md",
        )).mtime.toISOString()).toBe("2020-02-15T08:00:00.000Z");

        const second = prepare(repositoryRoot, vaultRoot);
        expect(second.totals).toEqual({ create: 0, update: 0, unchanged: 64 });
        expect(existsSync(join(vaultRoot, "keep-me.md"))).toBe(true);
        expect(readFileSync(join(vaultRoot, "keep-me.md"), "utf8")).toBe("unrelated vault content");
    });

    it("keeps provider-backed outcomes manual and sanitizes opaque bridge evidence", () => {
        const repositoryRoot = resolve(__dirname, "..");
        const runner = readFileSync(
            join(repositoryRoot, "scripts/retrieval-optimization-smoke-runner.js"),
            "utf8",
        );

        expect(runner).toContain("performs no provider call");
        expect(runner).toContain("status: \"PENDING\"");
        expect(runner).toContain("Case status must be PASS, FAIL, or BLOCKED");
        expect(runner).toContain("[opaque-redacted]");
        expect(runner).not.toContain("manualCases[id].status = \"PASS\"");
    });

    it("binds the frozen recovery target to one pre-freeze two-attempt topology", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl);
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "PASS",
            finalSources: ["retrieval-smoke/recovery/90-relaxed-target.md"],
            standardSources: [],
            standardEvidenceMode: "valid-none",
            targetPresent: true,
            invalidSourceCount: 0,
            duplicateSourceCount: 0,
            opaqueHitCount: 0,
            unexpectedSourceCount: 0,
            evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            sourceBinding: {
                opaqueRunCorrelationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                diagnosticsRunMatched: true,
            },
            topology: {
                droppedEventCount: 0,
                episodeCount: 1,
                memoryAttemptCount: 2,
                standardMemoryDocumentCount: 0,
                relaxedMemoryDocumentCount: 1,
                standardEvidenceMode: "valid-none",
                standardDocumentCount: 0,
                relaxedRetryCount: 1,
                relaxedDocumentCount: 1,
                retryConsumed: true,
                projectionCompletedCount: 1,
                projectionDocumentCount: 1,
            },
        });
        expect(diagnosticsControl).toMatchObject({ startCalls: 1, getCalls: 1, stopCalls: 0 });
        await expect(recorder.recordCase("chat-recovery", "PASS"))
            .rejects.toThrow("recordRecoveryCase");
        await expect(recorder.recordRecoveryCase()).rejects.toThrow("already recorded");
    });

    it("rejects a complete Pagelet recovery shape as pre-freeze Chat evidence", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(withDiagnosticSurface(diagnosticsControl, "pagelet"));

        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "BLOCKED",
            topology: {
                episodeCount: 0,
                surfaceMismatchEventCount: 12,
            },
        });
        expect(receipt.detail).toContain("outside the Chat surface");
    });

    it("blocks an old schema-v1 recovery snapshot whose events predate surface binding", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(withoutDiagnosticSurface(diagnosticsControl));

        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "BLOCKED",
            topology: {
                schemaVersion: null,
                episodeCount: 0,
            },
        });
        expect(receipt.detail).toContain("diagnostics unavailable or invalid");
    });

    it("accepts a strict-partial union of frozen first-attempt sources plus the relaxed target", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );
        const partialSources = [
            "retrieval-smoke/recovery/70-standard-insufficient-01.md",
            "retrieval-smoke/recovery/71-standard-insufficient-02.md",
            "retrieval-smoke/recovery/72-standard-insufficient-03.md",
            "retrieval-smoke/recovery/73-standard-insufficient-04.md",
            "retrieval-smoke/recovery/74-standard-insufficient-05.md",
            "retrieval-smoke/recovery/75-standard-insufficient-06.md",
            "retrieval-smoke/recovery/76-standard-insufficient-07.md",
        ];

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        chatControl.setRecoveryTurn({
            selectedPaths: [...partialSources, RECOVERY_TARGET_PATH],
            sourceRecordPaths: [RECOVERY_TARGET_PATH, ...[...partialSources].reverse()],
            allowedPaths: [...partialSources].reverse().concat(RECOVERY_TARGET_PATH),
            visiblePaths: [RECOVERY_TARGET_PATH],
        });
        (context.document as { body: { innerText: string; textContent: string } }).body = {
            innerText: `[[${RECOVERY_TARGET_PATH}]]`,
            textContent: `[[${RECOVERY_TARGET_PATH}]]`,
        };
        pushRecoveryCanaryEpisode(diagnosticsControl, {
            standardMemoryDocumentCount: 8,
            standardTerminalDocumentCount: 8,
            projectionDocumentCount: 8,
        });
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "PASS",
            standardEvidenceMode: "strict-partial",
            standardSources: partialSources,
            finalSources: [...partialSources, "retrieval-smoke/recovery/90-relaxed-target.md"],
            targetPresent: true,
            invalidSourceCount: 0,
            duplicateSourceCount: 0,
            opaqueHitCount: 0,
            unexpectedSourceCount: 0,
            topology: {
                standardEvidenceMode: "strict-partial",
                standardMemoryDocumentCount: 8,
                standardDocumentCount: 8,
                relaxedMemoryDocumentCount: 1,
                relaxedDocumentCount: 1,
                projectionDocumentCount: 8,
            },
            sourceBinding: {
                evidenceSource: "sidellm-view.chatHistory",
                selectedMemorySourceCount: 8,
                memorySourceRecordPathCount: 8,
                allowedMemorySourcePathCount: 8,
                sourceSetsMatch: true,
            },
        });
        expect((context.document as { body: { textContent: string } }).body.textContent)
            .not.toContain(partialSources[0]);
    });

    it.each([
        ["missing search_memory result", { memoryToolResultCount: 0 }, "exactly one successful"],
        ["multiple search_memory results", { memoryToolResultCount: 2 }, "exactly one successful"],
        ["missing Selected Memory projection", { selectedMemoryItemCount: 0 }, "exactly one canonical Selected Memory"],
        ["multiple Selected Memory projections", { selectedMemoryItemCount: 2 }, "exactly one canonical Selected Memory"],
        ["streaming turn", { streaming: true }, "still streaming"],
        ["non-completed turn", { status: "incomplete" }, "not a live completed"],
        ["empty canonical run id", { runId: "" }, "not a live completed"],
        ["rehydrated turn", { runId: "rehydrated:conversation:1" }, "not a live completed"],
        ["non-exact prompt", { prompt: "similar but not exact" }, "exact requested prompt"],
        ["canonical prompt drift", { canonicalPrompt: "old recovery prompt" }, "exact unique prompt"],
        ["missing canonical final assistant", { omitFinalCanonicalAssistant: true }, "no final assistant"],
        [
            "same malformed path in all canonical sets",
            {
                selectedPathValues: [123],
                sourceRecordPathValues: [123],
                allowedPathValues: [123],
            },
            "non-string path",
        ],
    ] as const)("rejects %s without consuming the Recovery receipt", async (_label, options, detail) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        chatControl.setRecoveryTurn(options);
        pushRecoveryCanaryEpisode(diagnosticsControl);

        await expect(recorder.recordRecoveryCase()).rejects.toThrow(detail);
        expect(recorder.result.recoveryCase.status).toBe("PENDING");
        expect(diagnosticsControl.getCalls).toBe(0);
    });

    it("rejects multiple current Chat views ending with the exact recovery prompt", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        chatControl.setRecoveryViews([{}, {}]);
        pushRecoveryCanaryEpisode(diagnosticsControl);

        await expect(recorder.recordRecoveryCase()).rejects.toThrow("exactly one current Chat view");
        expect(recorder.result.recoveryCase.status).toBe("PENDING");
        expect(diagnosticsControl.getCalls).toBe(0);
    });

    it("rejects a canonical Recovery turn spliced onto another diagnostics run", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(
            diagnosticsControl,
            {},
            { sequence: 0, elapsedMs: 0, runId: "run-diagnostics-new" },
        );

        await expect(recorder.recordRecoveryCase()).rejects.toThrow("opaque run identity");
        expect(recorder.result.recoveryCase.status).toBe("PENDING");
    });

    it("fails Recovery evidence closed when diagnostics omit the opaque run identity", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(withoutDiagnosticRunId(diagnosticsControl));

        const receipt = await recorder.recordRecoveryCase();
        expect(receipt.status).toBe("FAIL");
        expect(receipt.detail).toContain("diagnostics unavailable or invalid");
    });

    it.each([
        [
            "source records",
            {
                selectedPaths: [RECOVERY_TARGET_PATH],
                sourceRecordPaths: ["retrieval-smoke/recovery/70-standard-insufficient-01.md"],
            },
        ],
        [
            "assistant allowlist",
            {
                selectedPaths: [RECOVERY_TARGET_PATH],
                allowedPaths: ["retrieval-smoke/recovery/70-standard-insufficient-01.md"],
            },
        ],
    ] as const)("rejects a three-set mismatch in %s without persisting paths", async (_label, options) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        chatControl.setRecoveryTurn(options);
        pushRecoveryCanaryEpisode(diagnosticsControl);

        await expect(recorder.recordRecoveryCase()).rejects.toThrow("sets disagree");
        expect(recorder.result.recoveryCase.status).toBe("PENDING");
        expect(JSON.stringify(recorder.result.recoveryCase)).not.toContain("70-standard-insufficient");
        expect(diagnosticsControl.getCalls).toBe(0);
    });

    it.each([0, 2])(
        "rejects canonical source-count drift from a %i-document cumulative projection",
        async (projectionDocumentCount) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl } = createRunnerContext(
                repositoryRoot,
                { preflightReady: true },
            );

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            pushRecoveryCanaryEpisode(diagnosticsControl, { projectionDocumentCount });

            await expect(recorder.recordRecoveryCase()).rejects.toThrow("diagnostics projection");
            expect(recorder.result.recoveryCase.status).toBe("PENDING");
            expect(diagnosticsControl.getCalls).toBe(1);
        },
    );

    it.each([
        ["no retry", { retry: false }, ["retrieval-smoke/recovery/90-relaxed-target.md"]],
        ["double retry", { doubleRetry: true }, ["retrieval-smoke/recovery/90-relaxed-target.md"]],
        ["missing projection", { omitProjection: true }, ["retrieval-smoke/recovery/90-relaxed-target.md"]],
        [
            "non-empty standard Memory result",
            { standardMemoryDocumentCount: 1 },
            ["retrieval-smoke/recovery/90-relaxed-target.md"],
        ],
        [
            "non-empty standard terminal",
            { standardTerminalDocumentCount: 1 },
            ["retrieval-smoke/recovery/90-relaxed-target.md"],
        ],
        [
            "empty relaxed Memory result",
            { relaxedMemoryDocumentCount: 0 },
            ["retrieval-smoke/recovery/90-relaxed-target.md"],
        ],
        [
            "empty relaxed terminal",
            { relaxedTerminalDocumentCount: 0 },
            ["retrieval-smoke/recovery/90-relaxed-target.md"],
        ],
        [
            "valid-none retained first-generation source",
            { projectionDocumentCount: 2 },
            [
                "retrieval-smoke/recovery/90-relaxed-target.md",
                "retrieval-smoke/recovery/70-standard-insufficient-01.md",
            ],
        ],
        [
            "strict-partial omitted frozen representation",
            { standardMemoryDocumentCount: 8, standardTerminalDocumentCount: 8 },
            ["retrieval-smoke/recovery/90-relaxed-target.md"],
        ],
        [
            "strict-partial target absent",
            { standardMemoryDocumentCount: 8, standardTerminalDocumentCount: 8 },
            ["retrieval-smoke/recovery/70-standard-insufficient-01.md"],
        ],
        [
            "non-frozen final source",
            {
                standardMemoryDocumentCount: 8,
                standardTerminalDocumentCount: 8,
                projectionDocumentCount: 3,
            },
            [
                "retrieval-smoke/recovery/70-standard-insufficient-01.md",
                "retrieval-smoke/graph/30-deep-target.md",
                "retrieval-smoke/recovery/90-relaxed-target.md",
            ],
        ],
        [
            "duplicate final source",
            { projectionDocumentCount: 2 },
            [
                "retrieval-smoke/recovery/90-relaxed-target.md",
                "retrieval-smoke/recovery/90-relaxed-target.md",
            ],
        ],
        ["wrong target", {}, ["retrieval-smoke/graph/30-deep-target.md"]],
        [
            "opaque target",
            { projectionDocumentCount: 2 },
            [
                "retrieval-smoke/recovery/90-relaxed-target.md",
                "retrieval-smoke/excluded/20-opaque-bridge.md",
            ],
        ],
    ])("fails the recovery canary closed for %s", async (label, topology, finalPaths) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const canonicalPaths = finalPaths as string[];
        chatControl.setRecoveryTurn({
            selectedPaths: canonicalPaths,
            sourceRecordPaths: [...new Set(canonicalPaths)],
            allowedPaths: [...new Set(canonicalPaths)],
        });
        pushRecoveryCanaryEpisode(diagnosticsControl, topology as RecoveryCanaryTopology);
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt.status).toBe("FAIL");
        expect(recorder.result.recoveryCase.status).toBe("FAIL");
        expect(JSON.stringify(recorder.result.recoveryCase)).not.toContain("20-opaque-bridge.md");
        if (label === "duplicate final source") expect(receipt.duplicateSourceCount).toBe(1);
        if (label === "non-frozen final source") expect(receipt.unexpectedSourceCount).toBe(1);
        if (label === "strict-partial target absent") expect(receipt.targetPresent).toBe(false);
    });

    it.each([
        ["completed terminals marked unavailable", {
            standardMemoryReason: "source_unavailable",
            standardTerminalReason: "standard_unavailable",
        }],
        ["real legacy no-reason terminals", {
            standardMemoryReason: null,
            standardTerminalReason: null,
        }],
        ["failed terminals", {
            standardMemoryOutcome: "failed",
            standardMemoryReason: "source_unavailable",
            standardTerminalOutcome: "failed",
            standardTerminalReason: "standard_unavailable",
        }],
    ] as const)("does not infer valid-none from legacy unavailable %s carrying zero counts", async (
        _label,
        terminalOverrides,
    ) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl, {
            ...terminalOverrides,
            standardMemoryDocumentCount: 0,
            standardTerminalDocumentCount: 0,
        });
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "FAIL",
            standardEvidenceMode: "invalid",
            topology: {
                standardMemoryDocumentCount: null,
                standardDocumentCount: null,
            },
        });
        expect(receipt.detail).toContain(
            "standard recovery stage was neither coherent valid-none nor strict-partial",
        );
    });

    it("fails the recovery canary closed when diagnostics dropped events", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            diagnosticsDroppedEventCount: 1,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl);
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "FAIL",
            topology: { droppedEventCount: 1 },
        });
        expect(recorder.result.recoveryCase.detail).toContain("diagnostics events were dropped");
    });

    it("does not describe failed relaxed attempts with unknown counts as zero-document results", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl, {
            relaxedFailure: true,
            omitProjection: true,
            relaxedMemoryFailureReason: "source_unavailable",
        });
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt.status).toBe("FAIL");
        expect(receipt.detail).toContain("relaxed Memory attempt document count is unavailable");
        expect(receipt.detail).toContain("relaxed recovery stage document count is unavailable");
        expect(receipt.detail).toContain("cumulative projection document count is unavailable");
        expect(receipt).toMatchObject({
            a2FailureReason: "attempt_failed",
            topology: {
                relaxedMemoryOutcome: "failed",
                relaxedOutcome: "failed",
                relaxedMemoryDocumentCount: null,
                relaxedDocumentCount: null,
            },
        });
        expect(receipt.detail).toContain("A2 failure reason=attempt_failed");
        expect(receipt.detail).not.toContain("returned no documents");
        expect(receipt.detail).not.toContain("returned zero documents");
        expect(JSON.stringify(receipt)).not.toContain("source_unavailable");
    });

    it("rejects non-allowlisted A2 reasons without persisting their text", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl, {
            relaxedFailure: true,
            omitProjection: true,
            relaxedMemoryFailureReason: "provider returned secret body",
        });
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "FAIL",
            a2FailureReason: null,
            topology: { schemaVersion: null },
        });
        expect(JSON.stringify(receipt)).not.toContain("provider returned secret body");
    });

    it("does not promote an allowlisted reason when the A2 terminal tuple is inconsistent", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl, {
            relaxedFailure: true,
            omitProjection: true,
            relaxedMemoryFailureReason: "source_unavailable",
            relaxedStageFailureReason: "attempt_aborted",
        });
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "FAIL",
            a2FailureReason: null,
            topology: {
                relaxedOutcome: "failed",
            },
        });
        expect(receipt.detail).not.toContain("A2 failure reason=");
        expect(JSON.stringify(receipt)).not.toContain("attempt_aborted");
    });

    it.each([
        ["aborted", "attempt_aborted"],
        ["deadline", "attempt_deadline"],
    ] as const)("projects only the canonical %s A2 terminal tuple", async (outcome, reason) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl, {
            relaxedFailure: true,
            omitProjection: true,
            relaxedFailureOutcome: outcome,
        });
        const receipt = await recorder.recordRecoveryCase();

        expect(receipt).toMatchObject({
            status: "FAIL",
            a2FailureReason: reason,
            topology: {
                relaxedOutcome: outcome,
            },
        });
    });

    it("binds the explicit date-range retry to both attempt terminals and final sources", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await expect(recorder.recordTemporalRetryCase()).rejects.toThrow("Chat recovery canary");

        pushRecoveryCanaryEpisode(diagnosticsControl);
        await recorder.recordRecoveryCase();
        await expect(recorder.recordTemporalRetryCase())
            .rejects.toThrow("post-freeze qualitative diagnostics");

        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        const partialSources = [
            "retrieval-smoke/temporal-retry/100-standard-insufficient-01.md",
            "retrieval-smoke/temporal-retry/101-standard-insufficient-02.md",
            "retrieval-smoke/temporal-retry/102-standard-insufficient-03.md",
            "retrieval-smoke/temporal-retry/103-standard-insufficient-04.md",
            "retrieval-smoke/temporal-retry/104-standard-insufficient-05.md",
            "retrieval-smoke/temporal-retry/105-standard-insufficient-06.md",
            "retrieval-smoke/temporal-retry/106-standard-insufficient-07.md",
        ];
        pushTemporalRetryCanaryEpisode(
            diagnosticsControl,
            { sequence: 0, elapsedMs: 0 },
            {
                standardMemoryDocumentCount: 8,
                standardTerminalDocumentCount: 8,
                projectionDocumentCount: 8,
            },
        );
        setCanonicalTemporalRetryTurn(chatControl, [
            ...partialSources,
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]);
        const receipt = await recorder.recordTemporalRetryCase();

        expect(receipt).toMatchObject({
            status: "PASS",
            standardEvidenceMode: "strict-partial",
            standardSources: partialSources,
            targetPresent: true,
            forbiddenHitCount: 0,
            topology: {
                memoryAttemptCount: 2,
                standardTemporalFilterApplied: 1,
                standardTemporalViolationCount: 0,
                relaxedTemporalFilterApplied: 1,
                relaxedTemporalViolationCount: 0,
                relaxedRetryCount: 1,
                retryConsumed: true,
                projectionCompletedCount: 1,
                projectionTemporalFilterApplied: 1,
                projectionTemporalViolationCount: 0,
            },
        });
        expect(receipt.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(receipt).toMatchObject({
            sourceBinding: {
                exactPromptMatched: true,
                selectedMemorySourceCount: 8,
                sourceSetsMatch: true,
                opaqueRunCorrelationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                diagnosticsRunMatched: true,
            },
        });
    });

    it("keeps temporal retry PENDING when source paths are injected into the recorder", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const unsafeRecord = recorder.recordTemporalRetryCase as unknown as (
            ...args: unknown[]
        ) => Promise<unknown>;

        await expect(unsafeRecord(["retrieval-smoke/temporal-retry/112-relaxed-target.md"]))
            .rejects.toThrow("does not accept source paths");
        expect(recorder.result.temporalRetryCase.status).toBe("PENDING");
    });

    it.each([
        [
            "wrong Chat turn",
            { prompt: rankingPrompts["lexical-title"] },
            "exact requested prompt",
        ],
        [
            "source-record mismatch",
            {
                sourceRecordPaths: [
                    "retrieval-smoke/temporal-retry/100-standard-insufficient-01.md",
                ],
            },
            "sets disagree",
        ],
    ] as const)("keeps temporal retry PENDING for %s", async (_label, turnOverrides, detail) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl);
        await recorder.recordRecoveryCase();
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushTemporalRetryCanaryEpisode(diagnosticsControl, { sequence: 0, elapsedMs: 0 });
        setCanonicalTemporalRetryTurn(chatControl, undefined, turnOverrides);

        await expect(recorder.recordTemporalRetryCase()).rejects.toThrow(detail);
        expect(recorder.result.temporalRetryCase.status).toBe("PENDING");
    });

    it("rejects a canonical temporal turn spliced onto another diagnostics run", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl);
        await recorder.recordRecoveryCase();
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushTemporalRetryCanaryEpisode(
            diagnosticsControl,
            { sequence: 0, elapsedMs: 0, runId: "run-temporal-diagnostics-new" },
        );
        setCanonicalTemporalRetryTurn(chatControl, undefined, { runId: "run-temporal-old" });

        await expect(recorder.recordTemporalRetryCase()).rejects.toThrow("opaque run identity");
        expect(recorder.result.temporalRetryCase.status).toBe("PENDING");
    });

    it.each([
        ["standard filter missing", { standardTemporalFilterApplied: 0 }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["standard range violation", { standardTemporalViolationCount: 1 }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["relaxed filter missing", { relaxedTemporalFilterApplied: 0 }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["relaxed range violation", { relaxedTemporalViolationCount: 1 }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["projection filter missing", { projectionTemporalFilterApplied: 0 }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["projection range violation", { projectionTemporalViolationCount: 1 }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["legacy unavailable zero", {
            standardMemoryReason: "source_unavailable",
            standardTerminalReason: "standard_unavailable",
            standardMemoryDocumentCount: 0,
            standardTerminalDocumentCount: 0,
        }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["real legacy no-reason zero", {
            standardMemoryReason: null,
            standardTerminalReason: null,
            standardMemoryDocumentCount: 0,
            standardTerminalDocumentCount: 0,
        }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
        ]],
        ["2020 final source", { projectionDocumentCount: 2 }, [
            "retrieval-smoke/temporal-retry/112-relaxed-target.md",
            "retrieval-smoke/temporal-retry/113-old-forbidden.md",
        ]],
    ])("fails the structured temporal retry closed for %s", async (_label, overrides, paths) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl);
        await recorder.recordRecoveryCase();
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushTemporalRetryCanaryEpisode(
            diagnosticsControl,
            { sequence: 0, elapsedMs: 0 },
            overrides as RecoveryCanaryTopology,
        );

        setCanonicalTemporalRetryTurn(chatControl, paths as string[]);
        const receipt = await recorder.recordTemporalRetryCase();

        expect(receipt.status).toBe("FAIL");
        expect(recorder.result.temporalRetryCase.status).toBe("FAIL");
        if (_label === "legacy unavailable zero" || _label === "real legacy no-reason zero") {
            expect(receipt).toMatchObject({
                standardEvidenceMode: "invalid",
                topology: {
                    standardMemoryDocumentCount: null,
                    standardDocumentCount: null,
                },
            });
        }
        if (_label === "2020 final source") {
            expect(receipt.forbiddenHitCount).toBe(1);
            expect(receipt.finalSources).toContain("[temporal-forbidden-redacted]");
            expect(receipt.detail).toContain("2020 forbidden source");
        }
    });

    it("binds Pagelet 0/1/2 to exact verified insight ids and isolated sources", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pageletControl.setCase("pagelet-0");
        const zero = await recorder.recordPageletCase("pagelet-0");
        pageletControl.setCase("pagelet-1");
        const one = await recorder.recordPageletCase("pagelet-1");
        pageletControl.setCase("pagelet-2");
        const two = await recorder.recordPageletCase("pagelet-2");

        expect(zero).toMatchObject({
            status: "PASS",
            entryPath: "retrieval-smoke/pagelet/52-no-insight.md",
            expectedInsightCount: 0,
            observedInsightCount: 0,
            verifiedInsightCount: 0,
            insights: [],
        });
        expect(one).toMatchObject({
            status: "PASS",
            entryPath: "retrieval-smoke/pagelet/51-one-insight.md",
            expectedInsightCount: 1,
            observedInsightCount: 1,
            verifiedInsightCount: 1,
            insights: [{
                insightId: "pagelet-insight:pagelet-1:1",
                candidateId: "pagelet-insight:pagelet-1:1",
                sourcePaths: [
                    "retrieval-smoke/pagelet/51-one-insight.md",
                    "retrieval-smoke/pagelet/53-single-source.md",
                ],
                verified: true,
            }],
        });
        expect(two).toMatchObject({
            status: "PASS",
            entryPath: "retrieval-smoke/pagelet/50-current-note.md",
            expectedInsightCount: 2,
            observedInsightCount: 2,
            verifiedInsightCount: 2,
            duplicateInsightIdCount: 0,
            duplicateSourceCount: 0,
            opaqueHitCount: 0,
            unexpectedSourceCount: 0,
        });
        await expect(recorder.recordCase("pagelet-1", "PASS"))
            .rejects.toThrow("recordPageletCase");
    });

    it.each([
        ["wrong count", "pagelet-1", (snapshot: Record<string, unknown>) => ({
            ...snapshot,
            insights: [],
            candidateCount: 0,
            deliveryReceiptCount: 0,
        })],
        ["nonzero pagelet-0", "pagelet-0", (snapshot: Record<string, unknown>) => {
            const injected = (createPageletSmokeSnapshot("pagelet-1", 1).insights as unknown[])[0];
            return {
                ...snapshot,
                insights: [injected],
                candidateCount: 1,
                deliveryReceiptCount: 1,
                quietWriteInvariantSatisfied: false,
            };
        }],
        ["single pagelet-2", "pagelet-2", (snapshot: Record<string, unknown>) => ({
            ...snapshot,
            insights: (snapshot.insights as unknown[]).slice(0, 1),
            candidateCount: 1,
            deliveryReceiptCount: 1,
        })],
        ["duplicate insight id", "pagelet-2", (snapshot: Record<string, unknown>) => {
            const insights = structuredClone(snapshot.insights as Array<Record<string, unknown>>);
            insights[1]!.insightId = insights[0]!.insightId;
            insights[1]!.candidateId = insights[0]!.candidateId;
            return { ...snapshot, insights };
        }],
        ["opaque source", "pagelet-1", (snapshot: Record<string, unknown>) => {
            const insights = structuredClone(snapshot.insights as Array<Record<string, unknown>>);
            insights[0]!.sourcePaths = [
                pageletFixtureDefinitions["pagelet-1"].entryPath,
                "retrieval-smoke/excluded/20-opaque-bridge.md",
            ];
            return { ...snapshot, insights };
        }],
        ["unexpected source", "pagelet-1", (snapshot: Record<string, unknown>) => {
            const insights = structuredClone(snapshot.insights as Array<Record<string, unknown>>);
            insights[0]!.sourcePaths = [
                pageletFixtureDefinitions["pagelet-1"].entryPath,
                "retrieval-smoke/graph/30-deep-target.md",
            ];
            return { ...snapshot, insights };
        }],
        ["duplicate source", "pagelet-2", (snapshot: Record<string, unknown>) => {
            const insights = structuredClone(snapshot.insights as Array<Record<string, unknown>>);
            insights[1]!.sourcePaths = [
                pageletFixtureDefinitions["pagelet-2"].entryPath,
                pageletFixtureDefinitions["pagelet-2"].sourcePaths[0],
            ];
            return { ...snapshot, insights };
        }],
    ] as const)("fails the Pagelet receipt closed for %s", async (_label, id, mutate) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const snapshot = pageletControl.setCase(id);
        pageletControl.setSnapshot(mutate(snapshot));
        const receipt = await recorder.recordPageletCase(id);

        expect(receipt.status).toBe("FAIL");
        expect(recorder.result.pageletCases[id].status).toBe("FAIL");
        expect(JSON.stringify(receipt)).not.toContain("20-opaque-bridge.md");
    });

    it("rejects hand-entered, stale, wrong-fixture, and malformed Pagelet evidence without recording", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await expect((recorder.recordPageletCase as unknown as (
            id: string,
            evidence: unknown,
        ) => Promise<unknown>)("pagelet-0", []))
            .rejects.toThrow("does not accept insight ids or source paths");

        pageletControl.setCase("pagelet-1");
        await expect(recorder.recordPageletCase("pagelet-0"))
            .rejects.toThrow("different fixture");
        expect(recorder.result.pageletCases["pagelet-0"].status).toBe("PENDING");

        pageletControl.setSnapshot({ schemaVersion: 1, sequence: 2 });
        await expect(recorder.recordPageletCase("pagelet-0"))
            .rejects.toThrow("invalid content-free shape");
        expect(recorder.result.pageletCases["pagelet-0"].status).toBe("PENDING");

        pageletControl.setCase("pagelet-0");
        await recorder.recordPageletCase("pagelet-0");
        await expect(recorder.recordPageletCase("pagelet-0"))
            .rejects.toThrow("already recorded");
    });

    it("rejects Pagelet evidence that predates runner initialization", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );
        pageletControl.setCase("pagelet-0");

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await expect(recorder.recordPageletCase("pagelet-0"))
            .rejects.toThrow("stale or already consumed");
        expect(recorder.result.pageletCases["pagelet-0"].status).toBe("PENDING");

        pageletControl.setCase("pagelet-0");
        await expect(recorder.recordPageletCase("pagelet-0"))
            .resolves.toMatchObject({ status: "PASS" });
    });

    it("blocks Pagelet recording when the loaded plugin lacks the production evidence seam", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            pageletEvidenceSeam: "missing",
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await expect(recorder.recordPageletCase("pagelet-0"))
            .rejects.toThrow("does not expose real Pagelet smoke evidence");
        const result = recorder.result as unknown as {
            checks: Array<{ name: string; status: string }>;
        };
        expect(result.checks).toContainEqual(expect.objectContaining({
            name: "Pagelet smoke evidence is bound to a fresh real controller result",
            status: "BLOCKED",
        }));
    });

    it.each(["limit", "denied", "stale", "error"] as const)(
        "records a bound Pagelet controller %s outcome as FAIL instead of leaving it retryable",
        async (resultStatus) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, pageletControl } = createRunnerContext(
                repositoryRoot,
                { preflightReady: true },
            );

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            pageletControl.setCase("pagelet-0", {
                resultStatus,
                reason: resultStatus === "limit" ? "limit" : `${resultStatus}-fixture`,
                quietWriteInvariantSatisfied: false,
            });
            await expect(recorder.recordPageletCase("pagelet-0"))
                .resolves.toMatchObject({ status: "FAIL" });
            expect(recorder.result.pageletCases["pagelet-0"].status).toBe("FAIL");
        },
    );

    it("serializes an in-flight Pagelet snapshot before finalization", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const snapshot = pageletControl.setCase("pagelet-0");
        let releaseSnapshot: (() => void) | undefined;
        let markSnapshotStarted: (() => void) | undefined;
        const snapshotStarted = new Promise<void>((resolveStarted) => {
            markSnapshotStarted = resolveStarted;
        });
        const snapshotRelease = new Promise<void>((resolveRelease) => {
            releaseSnapshot = resolveRelease;
        });
        const plugin = (((context.app as {
            plugins: { plugins: Record<string, Record<string, unknown>> };
        }).plugins.plugins)["personal-assistant"]);
        plugin.getPageletDeepDiscoverSmokeSnapshot = async (): Promise<Record<string, unknown>> => {
            markSnapshotStarted?.();
            await snapshotRelease;
            return structuredClone(snapshot);
        };

        const pendingPagelet = recorder.recordPageletCase("pagelet-0");
        await snapshotStarted;
        const pendingFinal = recorder.finalize();
        const finalizedEarly = await Promise.race([
            pendingFinal.then(() => true),
            new Promise<boolean>((resolveRace) => setTimeout(() => resolveRace(false), 10)),
        ]);
        expect(finalizedEarly).toBe(false);
        releaseSnapshot?.();
        await expect(pendingPagelet).resolves.toMatchObject({ status: "PASS" });
        await expect(pendingFinal).resolves.toMatchObject({
            pageletCases: { "pagelet-0": { status: "PASS" } },
        });
    });

    it("binds the runner to the exact device-plan manifest identity", () => {
        const repositoryRoot = resolve(__dirname, "..");
        const runner = readFileSync(
            join(repositoryRoot, "scripts/retrieval-optimization-smoke-runner.js"),
            "utf8",
        );
        const manifest = readFileSync(
            join(repositoryRoot, "__fixtures__/retrieval-smoke/manifest.json"),
        );
        const expected = runner.match(/EXPECTED_MANIFEST_SHA256 = "([a-f0-9]{64})"/)?.[1];

        expect(expected).toBe(createHash("sha256").update(manifest).digest("hex"));
        expect(JSON.parse(manifest.toString("utf8"))).toMatchObject({
            fixtureVersion: "b125-retrieval-smoke-v5",
            rankingCases: {
                "lexical-title": {
                    prompt: "只从我的笔记中查找“量子灯塔检索”，并根据找到的记录回答。",
                    relevantPath: "retrieval-smoke/lexical/量子灯塔检索.md",
                    forbiddenPaths: [],
                },
                "lexical-heading": {
                    prompt: "只从我的笔记中查找“延迟恢复矩阵”，并根据找到的记录回答。",
                    relevantPath: "retrieval-smoke/lexical/量子灯塔检索.md",
                    forbiddenPaths: [],
                },
                "lexical-error": {
                    prompt: "只从我的笔记中查找错误码“ERR_RETRIEVAL_LANTERN_7401”，并根据找到的记录回答。",
                    relevantPath: "retrieval-smoke/lexical/量子灯塔检索.md",
                    forbiddenPaths: [],
                },
                "graph-depth": {
                    prompt: "只从我的笔记中回答：青铜罗盘为什么出现资源峰值？",
                    relevantPath: "retrieval-smoke/graph/30-deep-target.md",
                    forbiddenPaths: expect.arrayContaining([
                        "retrieval-smoke/graph/31-two-opaque-forbidden-target.md",
                        "retrieval-smoke/excluded/20-opaque-bridge.md",
                    ]),
                },
                convergence: {
                    prompt: "只从我的笔记中回答：蓝色账本重复入账的共同原因是什么？",
                    relevantPath: "retrieval-smoke/graph/42-convergence-target.md",
                    forbiddenPaths: expect.arrayContaining([
                        "retrieval-smoke/graph/43-weak-single-support.md",
                        "retrieval-smoke/excluded/20-opaque-bridge.md",
                    ]),
                },
                "temporal-2026": {
                    prompt: "只从我的笔记中，仅使用 2026 年的记录说明当前时间边界信号。",
                    relevantPath: "retrieval-smoke/temporal/61-recent-note.md",
                    forbiddenPaths: ["retrieval-smoke/temporal/60-old-note.md"],
                },
            },
            routingObservations: {
                "bare-error-code": "ERR_RETRIEVAL_LANTERN_7401",
                "bare-japanese": "日本語検索エンジン",
            },
            recoveryCase: {
                prompt: "只从我的笔记中回答：RCV-271 猩红雨伞事故的根因是什么？",
                targetPath: "retrieval-smoke/recovery/90-relaxed-target.md",
                standardInsufficientPaths: expect.arrayContaining([
                    "retrieval-smoke/recovery/70-standard-insufficient-01.md",
                    "retrieval-smoke/recovery/81-standard-insufficient-12.md",
                ]),
                finalSourceContract: {
                    maximumSourceCount: 8,
                    allowedStandardEvidenceModes: ["valid-none", "strict-partial"],
                    partialPreservesFrozenStandardSubset: true,
                    requiresRelaxedTarget: true,
                },
            },
            temporalRetryCase: {
                prompt: "只从我的笔记中，仅使用 2026-01-01 到 2026-12-31 的记录回答：TRT-826 紫晶日晷事故的根因是什么？",
                timeRange: {
                    from: "2026-01-01T00:00:00.000Z",
                    to: "2026-12-31T23:59:59.999Z",
                },
                targetPath: "retrieval-smoke/temporal-retry/112-relaxed-target.md",
                forbiddenPath: "retrieval-smoke/temporal-retry/113-old-forbidden.md",
                standardInsufficientPaths: expect.arrayContaining([
                    "retrieval-smoke/temporal-retry/100-standard-insufficient-01.md",
                    "retrieval-smoke/temporal-retry/111-standard-insufficient-12.md",
                ]),
                finalSourceContract: {
                    maximumSourceCount: 8,
                    allowedStandardEvidenceModes: ["valid-none", "strict-partial"],
                    partialPreservesFrozenStandardSubset: true,
                    requiresRelaxedTarget: true,
                    forbidsOutOfRangeSource: true,
                },
            },
            pageletCases: {
                "pagelet-0": {
                    expectedInsightCount: 0,
                    sourcePaths: [],
                },
                "pagelet-1": {
                    expectedInsightCount: 1,
                    sourcePaths: ["retrieval-smoke/pagelet/53-single-source.md"],
                },
                "pagelet-2": {
                    expectedInsightCount: 2,
                    sourcePaths: [
                        "retrieval-smoke/pagelet/54-double-source-a.md",
                        "retrieval-smoke/pagelet/55-double-source-b.md",
                    ],
                },
            },
            deviceMeasurementPlan: {
                version: "b125-device-measurement-v9",
                diagnosticsEvidence: {
                    schemaVersion: 1,
                    sessionIsolation: "standard-performance-then-two-retry-batches-then-cancellation-probe",
                    standardPerformanceEpisodeCount: 23,
                    retryPerformanceEpisodeCount: 23,
                    retryPerformanceBatchEpisodeCounts: [12, 11],
                    cancellationProbeEpisodeCount: 1,
                    maximumMemorySearchAttemptsPerEpisode: 2,
                    requiredSessionCapacity: 512,
                    performanceSurface: "chat",
                },
                externalMemoryEvidence: {
                    requiredPlatformClass: "ios-real-device",
                    requiredRuntimeFamily: "ios-wkwebview",
                    counter: "physical_footprint_bytes",
                    unit: "bytes",
                    processName: "Obsidian",
                    appBundleId: "md.obsidian",
                    deviceIdentitySha256: null,
                },
                requiredMetrics: expect.arrayContaining([
                    expect.objectContaining({
                        id: "retrieval.graphDurationMs",
                        collectionMethod: "diagnostics-full-graph-episode-wall-time",
                    }),
                    expect.objectContaining({ id: "retrieval.graphWorkerQueueWaitMs" }),
                    expect.objectContaining({ id: "retrieval.graphWorkerMaxBatchDurationMs" }),
                    expect.objectContaining({
                        id: "retrieval.retryTotalDurationMs",
                        sampleMode: "series",
                    }),
                    expect.objectContaining({
                        id: "retrieval.retryGraphDurationMs",
                        sampleMode: "series",
                    }),
                    expect.objectContaining({ id: "retrieval.retryGraphWorkerQueueWaitMs" }),
                    expect.objectContaining({ id: "retrieval.retryGraphWorkerMaxBatchDurationMs" }),
                    expect.objectContaining({
                        id: "retrieval.finalizationReserveMs",
                        threshold: { minMin: null },
                    }),
                    expect.objectContaining({
                        id: "retrieval.retryFinalizationReserveMs",
                        threshold: { minMin: null },
                    }),
                    expect.objectContaining({ id: "lexical.rebuildDurationMs" }),
                    expect.objectContaining({ id: "lexical.incrementalUpdateDurationMs" }),
                    expect.objectContaining({
                        id: "storage.peakEstimatedDbBytes",
                        sampleMode: "maximum-observed-series",
                        minimumSamples: 2,
                        threshold: { maxMax: null },
                    }),
                    expect.objectContaining({
                        id: "memory.peakProcessFootprintBytes",
                        sampleMode: "maximum-observed-series",
                        minimumSamples: 2,
                        collectionMethod: "workload-bound-runtime-process-memory-or-provenanced-system-profiler-envelope",
                        threshold: { maxMax: null },
                    }),
                    expect.objectContaining({
                        id: "ui.maxEventLoopStallMs",
                        sampleMode: "maximum-observed-series",
                        minimumSamples: 2,
                        threshold: { maxMax: null },
                    }),
                    expect.objectContaining({
                        id: "retrieval.cancelRequestedCount",
                        threshold: { p95Min: null },
                    }),
                    expect.objectContaining({
                        id: "retrieval.cancelObservedCount",
                        threshold: { p95Min: null },
                    }),
                    expect.objectContaining({
                        id: "retrieval.acceptedAfterCancelCount",
                        threshold: { p95Max: null },
                    }),
                    expect.objectContaining({
                        id: "retrieval.lateDiscardCount",
                        threshold: { p95Min: null },
                    }),
                ]),
                optionalMetrics: expect.arrayContaining([
                    expect.objectContaining({
                        id: "memory.heapUsedBytes",
                        collectionMethod: "runtime-js-heap-diagnostic-when-available",
                    }),
                ]),
            },
        });
    });

    it("freezes explicit notes-only ranking prompts and keeps bare routing probes non-gating", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        expect(Object.fromEntries(
            Object.entries(recorder.rankingChecklist).map(([id, entry]) => [id, entry.prompt]),
        )).toEqual({
            "lexical-title": "只从我的笔记中查找“量子灯塔检索”，并根据找到的记录回答。",
            "lexical-heading": "只从我的笔记中查找“延迟恢复矩阵”，并根据找到的记录回答。",
            "lexical-error": "只从我的笔记中查找错误码“ERR_RETRIEVAL_LANTERN_7401”，并根据找到的记录回答。",
            "graph-depth": "只从我的笔记中回答：青铜罗盘为什么出现资源峰值？",
            convergence: "只从我的笔记中回答：蓝色账本重复入账的共同原因是什么？",
            "temporal-2026": "只从我的笔记中，仅使用 2026 年的记录说明当前时间边界信号。",
        });
        expect(Object.values(recorder.rankingChecklist).every((entry) => (
            entry.record.includes("freezing the reviewed measurement plan")
            && entry.record.includes("search_memory")
            && entry.record.includes("PENDING/BLOCKED")
        ))).toBe(true);
        expect(recorder.routingChecklist).toEqual({
            "bare-error-code": {
                prompt: "ERR_RETRIEVAL_LANTERN_7401",
                expect: expect.stringContaining("does not enter Recall@8"),
            },
            "bare-japanese": {
                prompt: "日本語検索エンジン",
                expect: expect.stringContaining("does not enter Recall@8"),
            },
        });
        expect(recorder.result).not.toHaveProperty("routingCases");
    });

    it("keeps the overall result blocked when preflight is blocked even if all manual cases pass", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, writes, diagnosticsControl, pageletControl } = createRunnerContext(
            repositoryRoot,
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recordPassingManualCases(recorder, diagnosticsControl, pageletControl);

        const result = await recorder.finalize();
        expect(result.overall).toBe("BLOCKED");
        expect(writes.has("retrieval-optimization-smoke-result.json")).toBe(true);
    });

    it("freezes a passed receipt after finalization", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recordPassingManualCases(recorder, diagnosticsControl, pageletControl);
        await freezePassingDevicePlan(recorder);
        await recordPassingRankings(recorder, diagnosticsControl, chatControl);
        await recordPassingDeviceMetrics(recorder, diagnosticsControl);

        const publicReceipt = await recorder.finalize();
        expect(publicReceipt).toMatchObject({
            overall: "PASS",
            runtime: {
                rerankerClass: "chat",
                rerankerIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
            rerankerMetrics: {
                completed: 6,
                required: 6,
                recallAt8: 1,
                mrr: 1,
                forbiddenHitCount: 0,
            },
        });
        publicReceipt.overall = "FAIL";
        await expect(recorder.recordCase("lexical", "FAIL"))
            .rejects.toThrow("finalized and cannot be modified");
        await expect(recorder.recordRecoveryCase())
            .rejects.toThrow("finalized and cannot be modified");
        await expect(recorder.finalize()).resolves.toMatchObject({ overall: "PASS" });
    });

    it("keeps a ready run blocked until every selected-reranker ranking case is recorded", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recordPassingManualCases(recorder, diagnosticsControl, pageletControl);

        await expect(recorder.finalize()).resolves.toMatchObject({
            overall: "BLOCKED",
            rerankerMetrics: {
                completed: 0,
                required: 6,
                recallAt8: 0,
                mrr: 0,
            },
        });
    });

    it("fails and redacts a ranking receipt that contains an opaque source", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl, pageletControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recordPassingManualCases(recorder, diagnosticsControl, pageletControl);
        await freezePassingDevicePlan(recorder);
        pushTemporalRetryCanaryEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
        );
        setCanonicalTemporalRetryTurn(chatControl);
        await recorder.recordTemporalRetryCase();
        for (const id of Object.keys(passingRankings)) {
            if (id === "graph-depth") continue;
            pushSuccessfulPerformanceEpisode(
                diagnosticsControl,
                rankingDiagnosticCursor(diagnosticsControl),
            );
            setCanonicalRankingTurn(chatControl, id);
            await recorder.recordRankingCase(id);
        }
        pushSuccessfulPerformanceEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
        );
        setCanonicalRankingTurn(chatControl, "graph-depth", [
            "retrieval-smoke%2Fexcluded%2F20-opaque-bridge.md%23section",
            "retrieval-smoke/graph/30-deep-target.md",
        ]);
        await recorder.recordRankingCase("graph-depth");

        const receipt = await recorder.finalize();
        expect(receipt.overall).toBe("FAIL");
        expect(receipt.rerankerMetrics).toMatchObject({ forbiddenHitCount: 1 });
        expect(JSON.stringify(receipt)).not.toContain("20-opaque-bridge.md");
        expect(JSON.stringify(receipt)).not.toContain("NEVER_EXPOSE_OPAQUE_B_92F7");
        expect(receipt.rankingCases?.["graph-depth"]).toMatchObject({
            status: "FAIL",
            rankedSources: ["[opaque-redacted]", "retrieval-smoke/graph/30-deep-target.md"],
        });
    });

    it("invalidates selected-reranker evidence when provider or model settings change", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            rerankerGate: { minimumMrr: 0 },
        });
        const plugin = (((context.app as {
            plugins: { plugins: Record<string, { settings: Record<string, unknown> }> };
        }).plugins.plugins)["personal-assistant"]);
        plugin.settings.policyModelName = "changed-policy-model";

        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("selected reranker settings changed");
        await expect(recorder.finalize()).resolves.toMatchObject({ overall: "FAIL" });
    });

    it.each([
        ["excluded tags", (boundary: Record<string, unknown>) => {
            boundary.excludedTags = ["private"];
        }],
        ["generated-note policy", (boundary: Record<string, unknown>) => {
            boundary.generatedNotePolicy = "include-generated";
        }],
    ] as const)("invalidates evidence when the Data Boundary %s changes", async (_label, mutate) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        const plugin = (((context.app as {
            plugins: { plugins: Record<string, { settings: { dataBoundary: Record<string, unknown> } }> };
        }).plugins.plugins)["personal-assistant"]);
        mutate(plugin.settings.dataBoundary);

        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("Boundary");
        await expect(recorder.finalize()).resolves.toMatchObject({ overall: "FAIL" });
    });

    it.each([
        [
            "excluded tags",
            (boundary: Record<string, unknown>) => {
                boundary.excludedTags = ["private"];
            },
            (boundary: Record<string, unknown>) => {
                boundary.excludedTags = [];
            },
        ],
        [
            "generated-note policy",
            (boundary: Record<string, unknown>) => {
                boundary.generatedNotePolicy = "include-generated";
            },
            (boundary: Record<string, unknown>) => {
                boundary.generatedNotePolicy = "exclude-generated";
            },
        ],
    ] as const)(
        "blocks transient %s drift used by a retrieval episode even after baseline-only notification",
        async (_label, mutate, restore) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl, settingsControl } = createRunnerContext(
                repositoryRoot,
                { preflightReady: true },
            );

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            const plugin = (((context.app as {
                plugins: {
                    plugins: Record<string, {
                        settings: { dataBoundary: Record<string, unknown> };
                    }>;
                };
            }).plugins.plugins)["personal-assistant"]);
            mutate(plugin.settings.dataBoundary);
            pushRecoveryCanaryEpisode(diagnosticsControl);
            restore(plugin.settings.dataBoundary);
            await settingsControl.notifySettingsChanged();

            await expect(recorder.recordRecoveryCase()).rejects.toThrow("Boundary");
            expect(recorder.result.recoveryCase.status).toBe("PENDING");
            await expect(recorder.finalize()).resolves.toMatchObject({ overall: "FAIL" });
        },
    );

    it.each([
        ["provider", "aiProvider", "transient-provider"],
        ["provider URL", "baseURL", "https://transient.invalid"],
        ["selected model", "chatModelName", "transient-model"],
    ] as const)(
        "latches transient %s admission before the first diagnostics event",
        async (_label, key, transientValue) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl, settingsControl } = createRunnerContext(
                repositoryRoot,
                { preflightReady: true },
            );
            const plugin = (((context.app as {
                plugins: {
                    plugins: Record<string, { settings: Record<string, unknown> }>;
                };
            }).plugins.plugins)["personal-assistant"]);
            const originalSettings = plugin.settings;
            const originalDescriptor = Object.getOwnPropertyDescriptor(plugin, "settings");
            const hadOwnValue = Object.prototype.hasOwnProperty.call(originalSettings, key);
            const baseline = originalSettings[key];

            await runInNewContext(runner, context);
            plugin.settings[key] = transientValue;
            void plugin.settings[key];
            if (hadOwnValue) plugin.settings[key] = baseline;
            else delete plugin.settings[key];
            await settingsControl.notifySettingsChanged();
            pushRecoveryCanaryEpisode(diagnosticsControl);

            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await expect(recorder.recordRecoveryCase()).rejects.toThrow("settings changed");
            await expect(recorder.finalize()).resolves.toMatchObject({ overall: "FAIL" });
            expect(plugin.settings).toBe(originalSettings);
            expect(Object.getOwnPropertyDescriptor(plugin, "settings")).toEqual({
                ...originalDescriptor,
                value: originalSettings,
            });
        },
    );

    it.each([
        ["root replacement", (plugin: { settings: Record<string, unknown> }, original: Record<string, unknown>) => {
            plugin.settings = { ...original, aiProvider: "transient-provider" };
            plugin.settings = original;
        }],
        ["nested delete", (plugin: { settings: Record<string, unknown> }) => {
            const boundary = plugin.settings.dataBoundary as Record<string, unknown>;
            const baseline = boundary.generatedNotePolicy;
            delete boundary.generatedNotePolicy;
            boundary.generatedNotePolicy = baseline;
        }],
        ["array mutation", (plugin: { settings: Record<string, unknown> }) => {
            const boundary = plugin.settings.dataBoundary as { excludedTags: string[] };
            boundary.excludedTags.push("transient-private");
            boundary.excludedTags.pop();
        }],
    ] as const)("latches reversible settings %s without leaving proxy state behind", async (_label, mutate) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, settingsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });
        const plugin = (((context.app as {
            plugins: {
                plugins: Record<string, { settings: Record<string, unknown> }>;
            };
        }).plugins.plugins)["personal-assistant"]);
        const originalSettings = plugin.settings;
        const originalDescriptor = Object.getOwnPropertyDescriptor(plugin, "settings");

        await runInNewContext(runner, context);
        mutate(plugin, originalSettings);
        await settingsControl.notifySettingsChanged();

        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await expect(recorder.recordCase("lexical", "PASS")).rejects.toThrow("settings changed");
        await expect(recorder.finalize()).resolves.toMatchObject({ overall: "FAIL" });
        expect(plugin.settings).toBe(originalSettings);
        expect(Object.getOwnPropertyDescriptor(plugin, "settings")).toEqual({
            ...originalDescriptor,
            value: originalSettings,
        });
    });

    it("canonicalizes Data Boundary exclusion-set ordering in the settings fingerprint", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            excludedTags: ["alpha", "beta"],
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const plugin = (((context.app as {
            plugins: { plugins: Record<string, { settings: { dataBoundary: Record<string, unknown> } }> };
        }).plugins.plugins)["personal-assistant"]);
        plugin.settings.dataBoundary.excludedTags = ["beta", "alpha"];

        const receipt = await recorder.finalize() as unknown as {
            checks: Array<{ name: string; status: string }>;
        };
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Retrieval and Boundary settings are unchanged by the recorder",
            status: "PASS",
        }));
    });

    it("does not latch same-value settings or same-instance registry assignments", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, settingsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });
        const pluginManager = (context.app as {
            plugins: { plugins: Record<string, { settings: Record<string, unknown> }> };
        }).plugins;
        const plugin = pluginManager.plugins["personal-assistant"];
        const originalSettings = plugin.settings;
        const originalSettingsDescriptor = Object.getOwnPropertyDescriptor(plugin, "settings");
        const originalRegistryDescriptor = Object.getOwnPropertyDescriptor(pluginManager, "plugins");

        await runInNewContext(runner, context);
        const sameModelName = plugin.settings.chatModelName;
        plugin.settings.chatModelName = sameModelName;
        pluginManager.plugins["personal-assistant"] = plugin;
        await settingsControl.notifySettingsChanged();

        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const receipt = await recorder.finalize() as unknown as {
            checks: Array<{ name: string; status: string }>;
        };
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Retrieval and Boundary settings are unchanged by the recorder",
            status: "PASS",
        }));
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Plugin lifecycle, artifact, and settings bindings are stable at receipt commit",
            status: "PASS",
        }));
        expect(plugin.settings).toBe(originalSettings);
        expect(Object.getOwnPropertyDescriptor(plugin, "settings")).toEqual({
            ...originalSettingsDescriptor,
            value: originalSettings,
        });
        expect(Object.getOwnPropertyDescriptor(pluginManager, "plugins")).toEqual({
            ...originalRegistryDescriptor,
            value: originalRegistryDescriptor?.value,
        });
    });

    it("restores settings and registry descriptors after post-guard initialization failure", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            tamperedFixture: "retrieval-smoke/lexical/量子灯塔检索.md",
        });
        const pluginManager = (context.app as {
            plugins: { plugins: Record<string, { settings: Record<string, unknown> }> };
        }).plugins;
        const plugin = pluginManager.plugins["personal-assistant"];
        const originalSettings = plugin.settings;
        const originalSettingsDescriptor = Object.getOwnPropertyDescriptor(plugin, "settings");
        const originalRegistryDescriptor = Object.getOwnPropertyDescriptor(pluginManager, "plugins");

        await runInNewContext(runner, context);

        expect(context.paRetrievalSmoke).toBeUndefined();
        expect(plugin.settings).toBe(originalSettings);
        expect(Object.getOwnPropertyDescriptor(plugin, "settings")).toEqual({
            ...originalSettingsDescriptor,
            value: originalSettings,
        });
        expect(Object.getOwnPropertyDescriptor(pluginManager, "plugins")).toEqual({
            ...originalRegistryDescriptor,
            value: originalRegistryDescriptor?.value,
        });
    });

    it("serializes pending writes before persisting the final immutable receipt", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const {
            context,
            runner,
            writes,
            writeControl,
            diagnosticsControl,
            chatControl,
            pageletControl,
        } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        pushRecoveryCanaryEpisode(diagnosticsControl);
        await recorder.recordRecoveryCase();
        pageletControl.setCase("pagelet-0");
        await recorder.recordPageletCase("pagelet-0");
        pageletControl.setCase("pagelet-1");
        await recorder.recordPageletCase("pagelet-1");
        pageletControl.setCase("pagelet-2");
        await recorder.recordPageletCase("pagelet-2");
        await freezePassingDevicePlan(recorder);
        await recordPassingRankings(recorder, diagnosticsControl, chatControl);
        await recordPassingDeviceMetrics(recorder, diagnosticsControl);
        for (const id of smokeCases.slice(0, -1)) {
            if (!["chat-recovery", "temporal-retry"].includes(id) && !id.startsWith("pagelet-")) {
                await recorder.recordCase(id, "PASS");
            }
        }

        writeControl.deferNextResultWrite();
        const pendingRecord = recorder.recordCase(smokeCases.at(-1)!, "PASS");
        await writeControl.waitUntilDeferred();
        const pendingFinal = recorder.finalize();
        const finalizedEarly = await Promise.race([
            pendingFinal.then(() => true),
            new Promise<boolean>((resolveRace) => setTimeout(() => resolveRace(false), 10)),
        ]);
        expect(finalizedEarly).toBe(false);

        writeControl.releaseDeferred();
        await pendingRecord;
        await expect(pendingFinal).resolves.toMatchObject({ overall: "PASS" });
        expect(JSON.parse(writes.get("retrieval-optimization-smoke-result.json") ?? "{}"))
            .toMatchObject({ overall: "PASS" });
    });

    it("uses frozen nearest-rank percentiles after the fixed warmup", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.lexicalDurationMs": { p95Max: 19 } },
        });
        const metric = await recorder.recordDeviceMetric("retrieval.lexicalDurationMs", {
            method: "measured",
            samples: [999, 999, 999, ...Array.from({ length: 20 }, (_, index) => index + 1)],
        });

        expect(metric).toMatchObject({ status: "PASS", p50: 10, p95: 19 });
        expect(metric.rawSamples).toHaveLength(23);
        expect(metric.evaluatedSamples).toHaveLength(20);
    });

    it("rejects threshold drift after the plan is frozen and sampling has started", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.lexicalDurationMs": { p95Max: 100 } },
        });
        const frozenHash = recorder.result.deviceMeasurement.planSha256;
        await recorder.recordDeviceMetric("retrieval.lexicalDurationMs", {
            method: "measured",
            samples: Array.from({ length: 23 }, () => 1),
        });

        await expect(recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.lexicalDurationMs": { p95Max: 99 } },
        })).rejects.toThrow("already frozen");
        expect(recorder.result.deviceMeasurement.planSha256).toBe(frozenHash);
    });

    it("keeps null thresholds, unsupported metrics, and missing samples explicitly blocked", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const nullThreshold = await recorder.recordDeviceMetric("retrieval.lexicalDurationMs", {
            method: "measured",
            samples: Array.from({ length: 23 }, () => 0),
        });
        const unsupported = await recorder.recordDeviceMetric("ui.eventLoopGapMs", {
            method: "unsupported",
            samples: [],
        });
        const incomplete = await recorder.recordDeviceMetric("retrieval.lexicalDurationMs", {
            method: "manual",
            samples: [1],
        });

        expect(nullThreshold.status).toBe("BLOCKED");
        expect(unsupported).toMatchObject({ status: "BLOCKED", method: "unsupported", rawSamples: [] });
        expect(incomplete.status).toBe("BLOCKED");
        await expect(recorder.finalize()).resolves.toMatchObject({
            overall: "BLOCKED",
            deviceMeasurement: { overall: "BLOCKED", rerankerGate: { status: "BLOCKED" } },
        });
    });

    it("supports an explicitly frozen flag-off MRR non-regression gate", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            rerankerGate: { flagOffBaselineMrr: 1, maximumMrrRegression: 0 },
        });
        await recordPassingRankings(recorder, diagnosticsControl, chatControl, false);

        await expect(recorder.finalize()).resolves.toMatchObject({
            overall: "BLOCKED",
            deviceMeasurement: { rerankerGate: { status: "PASS" } },
        });
    });

    it("rejects ranking evidence recorded before the reviewed plan is frozen", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;

        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("Freeze the device measurement plan");
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
    });

    it("keeps ranking PENDING when source paths are injected into the recorder", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const unsafeRecord = recorder.recordRankingCase as unknown as (
            id: string,
            ...args: unknown[]
        ) => Promise<unknown>;

        await expect(unsafeRecord("lexical-title", passingRankings["lexical-title"]))
            .rejects.toThrow("does not accept source paths");
        expect(recorder.result.rankingCases["lexical-title"].status).toBe("PENDING");
    });

    it.each([
        [
            "wrong Chat turn",
            { prompt: rankingPrompts["lexical-heading"] },
            "exact requested prompt",
        ],
        [
            "assistant allowlist mismatch",
            { allowedPaths: ["retrieval-smoke/graph/30-deep-target.md"] },
            "sets disagree",
        ],
    ] as const)("keeps ranking PENDING for %s", async (_label, turnOverrides, detail) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushSuccessfulPerformanceEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
        );
        setCanonicalRankingTurn(chatControl, "lexical-title", undefined, turnOverrides);

        await expect(recorder.recordRankingCase("lexical-title")).rejects.toThrow(detail);
        expect(recorder.result.rankingCases["lexical-title"].status).toBe("PENDING");
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
    });

    it("rejects a canonical ranking turn spliced onto another diagnostics run", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushSuccessfulPerformanceEpisode(
            diagnosticsControl,
            { sequence: 0, elapsedMs: 0, runId: "run-ranking-diagnostics-new" },
        );
        setCanonicalRankingTurn(
            chatControl,
            "lexical-title",
            undefined,
            { runId: "run-ranking-old" },
        );

        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("opaque run identity");
        expect(recorder.result.rankingCases["lexical-title"].status).toBe("PENDING");
    });

    it("requires one complete post-freeze retrieval episode for every ranking receipt", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });

        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("one complete post-freeze search_memory episode");
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
    });

    it("rejects a complete Pagelet episode as post-freeze qualitative ranking evidence", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushSuccessfulPerformanceEpisode(
            withDiagnosticSurface(diagnosticsControl, "pagelet"),
            rankingDiagnosticCursor(diagnosticsControl),
        );
        setCanonicalRankingTurn(chatControl, "lexical-title");

        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("one complete post-freeze search_memory episode");
        expect(recorder.result.rankingCases["lexical-title"].status).toBe("PENDING");
    });

    it("rejects hidden relaxed recovery in qualitative ranking evidence", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushRecoveryCanaryEpisode(
            diagnosticsControl,
            {},
            rankingDiagnosticCursor(diagnosticsControl),
        );

        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("one complete post-freeze search_memory episode");
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
    });

    it.each(["failed", "aborted", "deadline"] as const)(
        "rejects one standard ranking call whose terminals are %s",
        async (outcome) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl } = createRunnerContext(
                repositoryRoot,
                { preflightReady: true },
            );

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
            pushSingleFailedStandardRankingEpisode(
                diagnosticsControl,
                rankingDiagnosticCursor(diagnosticsControl),
                outcome,
            );

            await expect(recorder.recordRankingCase("lexical-title"))
                .rejects.toThrow("one complete post-freeze search_memory episode");
            expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
        },
    );

    it.each(["failed", "aborted", "deadline"] as const)(
        "rejects two standard ranking calls when one set of terminals is %s",
        async (outcome) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl } = createRunnerContext(
                repositoryRoot,
                { preflightReady: true },
            );

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
            pushConcurrentStandardRankingEpisode(
                diagnosticsControl,
                rankingDiagnosticCursor(diagnosticsControl),
                { secondTerminalOutcome: outcome },
            );

            await expect(recorder.recordRankingCase("graph-depth"))
                .rejects.toThrow("one complete post-freeze search_memory episode");
            expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
        },
    );

    it("records one ranking receipt for two interleaved concurrent standard searches", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushConcurrentStandardRankingEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
        );

        setCanonicalRankingTurn(chatControl, "graph-depth");
        await expect(recorder.recordRankingCase("graph-depth")).resolves.toMatchObject({
            status: "PASS",
            evidence: { standardCallCount: 2, memoryAttemptCount: 2 },
        });
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 1 });
    });

    it("records one ranking receipt for two sequential standard searches in one run", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushSequentialStandardRankingEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
        );

        setCanonicalRankingTurn(chatControl, "temporal-2026");
        await expect(recorder.recordRankingCase("temporal-2026")).resolves.toMatchObject({
            status: "PASS",
            evidence: { standardCallCount: 2, memoryAttemptCount: 2 },
        });
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 1 });
    });

    it.each([
        ["more than two standard calls", { thirdStandard: true }],
        ["a finalization boundary between calls", { boundaryBetweenCalls: true }],
        ["a missing second Memory terminal", { omitSecondMemoryTerminal: true }],
        ["a missing first relaxed skip", { omitFirstRelaxedSkip: true }],
    ] as const)("rejects sequential ranking evidence with %s", async (_label, options) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushSequentialStandardRankingEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
            options,
        );

        await expect(recorder.recordRankingCase("temporal-2026"))
            .rejects.toThrow("one complete post-freeze search_memory episode");
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
    });

    it.each([
        ["standard terminal before its Memory terminal", { firstStandardTerminalBeforeMemory: true }],
        ["missing second Memory terminal", { omitSecondMemoryTerminal: true }],
    ] as const)("rejects concurrent ranking evidence with %s", async (_label, options) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushConcurrentStandardRankingEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
            options,
        );

        await expect(recorder.recordRankingCase("graph-depth"))
            .rejects.toThrow("one complete post-freeze search_memory episode");
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
    });

    it.each([
        ["zero relaxed skips", { skippedReasons: [] }],
        ["one relaxed skip", { skippedReasons: ["not_eligible"] }],
        ["three relaxed skips", {
            skippedReasons: ["not_eligible", "not_eligible", "not_eligible"],
        }],
        ["a hidden relaxed attempt", { startRelaxed: true }],
        ["a reserve-protected branch", {
            skippedReasons: ["not_eligible"],
            reserveProtected: true,
        }],
    ] as const)("fails closed for concurrent ranking evidence with %s", async (_label, options) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({ rerankerGate: { minimumMrr: 0 } });
        pushConcurrentStandardRankingEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
            options,
        );

        await expect(recorder.recordRankingCase("graph-depth"))
            .rejects.toThrow("one complete post-freeze search_memory episode");
        expect(recorder.result.rerankerMetrics).toMatchObject({ completed: 0, mrr: 0 });
    });

    it("keeps concurrent standard calls out of the single-attempt performance lane", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.totalDurationMs": { p95Max: 100 } },
        });
        pushConcurrentStandardRankingEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
        );
        await recorder.captureRetrievalDiagnostics();

        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                standardPerformance: { status: "INVALID", episodeCount: 1, normalEpisodeCount: 0 },
            },
        });
        expect(recorder.result.deviceMeasurement.metrics["retrieval.totalDurationMs"])
            .toMatchObject({ status: "BLOCKED", rawSamples: [] });
    });

    it("records frozen ranking before sampling and restarts an empty performance session", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            rerankerGate: { minimumMrr: 0 },
        });
        pushSuccessfulPerformanceEpisode(
            diagnosticsControl,
            rankingDiagnosticCursor(diagnosticsControl),
        );
        setCanonicalRankingTurn(chatControl, "lexical-title");
        await recorder.recordRankingCase("lexical-title");
        await expect(recorder.recordRankingCase("lexical-title"))
            .rejects.toThrow("already recorded");

        await qualifyPerformanceWorkload(recorder, diagnosticsControl);
        await recorder.startRuntimeEnvelope();
        const fresh = await recorder.captureRetrievalDiagnostics();

        expect(diagnosticsControl.startCalls).toBe(3);
        expect(diagnosticsControl.stopCalls).toBe(2);
        expect(fresh).toMatchObject({ droppedEventCount: 0, events: [] });
        await expect(recorder.recordRankingCase("lexical-heading"))
            .rejects.toThrow("before starting device performance diagnostics");
        await expect(recorder.finalize()).resolves.toMatchObject({ overall: "BLOCKED" });
    });

    it("does not expose mutable raw-sample references", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.lexicalDurationMs": { p95Max: 10 } },
        });
        const metric = await recorder.recordDeviceMetric("retrieval.lexicalDurationMs", {
            method: "measured",
            samples: Array.from({ length: 23 }, () => 1),
        });
        metric.rawSamples[0] = 999;
        const publicResult = recorder.result;
        publicResult.deviceMeasurement.metrics["retrieval.lexicalDurationMs"].rawSamples[0] = 888;

        expect(recorder.result.deviceMeasurement.metrics["retrieval.lexicalDurationMs"].rawSamples[0]).toBe(1);
    });

    it("captures only the current content-free VSS stats contract", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const snapshot = await recorder.recordVssStats("after", {
            initDurationMs: 1,
            lastRefreshDurationMs: 2,
            lastSearchDurationMs: 3,
            chunkCount: 4,
            fileCount: 5,
            estimatedDbBytes: 6,
            storageUsage: 7,
            storageQuota: 8,
            lexicalSearchDurationMs: 9,
            lexicalSearchMatchedRows: 10,
            databaseName: "must-not-leak.sqlite3",
            lastErrorCode: "must-not-leak",
            path: "private/hidden.md",
        });

        expect(snapshot).toEqual({
            initDurationMs: 1,
            lastRefreshDurationMs: 2,
            lastSearchDurationMs: 3,
            chunkCount: 4,
            fileCount: 5,
            estimatedDbBytes: 6,
            storageUsage: 7,
            storageQuota: 8,
            lexicalSearchDurationMs: 9,
            lexicalSearchMatchedRows: 10,
        });
    });

    it("keeps rAF gaps separate from maximum stall evidence and degrades Long Tasks honestly", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const supported = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            rafIntervalMs: 10,
        });
        await runInNewContext(supported.runner, supported.context);
        const supportedRecorder = supported.context.paRetrievalSmoke as SmokeRecorder;
        await supportedRecorder.freezeDeviceMeasurementPlan({
            thresholds: {
                "ui.eventLoopGapMs": { p95Max: 10 },
                "ui.maxEventLoopStallMs": { maxMax: 10 },
            },
        });
        await expect(supportedRecorder.sampleEventLoopGap()).resolves.toMatchObject({
            status: "PASS",
            method: "measured",
            rawSamples: expect.arrayContaining([10]),
        });
        expect(supportedRecorder.result.deviceMeasurement.metrics["ui.maxEventLoopStallMs"])
            .toMatchObject({ status: "PENDING", method: null, rawSamples: [] });
        await expect(supportedRecorder.recordDeviceMetric("ui.maxEventLoopStallMs", {
            method: "manual",
            samples: [0],
        })).rejects.toThrow("dedicated runtime sampler");

        const unsupported = createRunnerContext(repositoryRoot, { preflightReady: true });
        await runInNewContext(unsupported.runner, unsupported.context);
        const unsupportedRecorder = unsupported.context.paRetrievalSmoke as SmokeRecorder;
        await unsupportedRecorder.freezeDeviceMeasurementPlan();
        await expect(unsupportedRecorder.sampleEventLoopGap()).resolves.toMatchObject({
            status: "BLOCKED",
            method: "unsupported",
        });
        expect(unsupportedRecorder.result.deviceMeasurement.metrics["ui.maxEventLoopStallMs"])
            .toMatchObject({ status: "PENDING", method: null, rawSamples: [] });
        await expect(unsupportedRecorder.sampleLongTasks(0)).resolves.toMatchObject({
            status: "BLOCKED",
            method: "unsupported",
        });

        const longTaskSupported = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            longTaskDurations: [25, 75],
        });
        await runInNewContext(longTaskSupported.runner, longTaskSupported.context);
        const longTaskRecorder = longTaskSupported.context.paRetrievalSmoke as SmokeRecorder;
        await longTaskRecorder.freezeDeviceMeasurementPlan({
            thresholds: { "ui.longTaskDurationMs": { p95Max: 75 } },
        });
        await expect(longTaskRecorder.sampleLongTasks(0)).resolves.toMatchObject({
            status: "PASS",
            method: "measured",
            rawSamples: [25, 75],
            p50: 25,
            p95: 75,
        });
    });

    it("binds peak and maximum evidence to a start-stop window covering all performance episodes", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            runtimeDatabaseSamples: [10, 20, 15],
            runtimeProcessMemorySamplesKiB: [100, 200, 150],
            runtimeStallDelays: [2, 7],
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: {
                "storage.peakEstimatedDbBytes": { maxMax: 20 },
                "memory.peakProcessFootprintBytes": { maxMax: 204_800 },
                "ui.maxEventLoopStallMs": { maxMax: 7 },
            },
        });
        const evidence = await completeValidPerformanceEnvelope(recorder, diagnosticsControl);

        expect(evidence.envelope).toMatchObject({
            status: "PASS",
            coveredStandardPerformanceEpisodeCount: 23,
            coveredRetryPerformanceEpisodeCount: 23,
            externalMemoryCapturePrecondition: {
                status: "PASS",
                artifactAbsent: true,
                rawExportAbsent: true,
            },
        });
        expect(evidence.database).toMatchObject({
            status: "PASS",
            rawSamples: expect.arrayContaining([10, 20]),
            maximum: 20,
        });
        expect(evidence.processMemory).toMatchObject({
            status: "PASS",
            rawSamples: expect.arrayContaining([102_400, 204_800]),
            maximum: 204_800,
        });
        expect(evidence.eventLoopStall).toMatchObject({
            status: "PASS",
            rawSamples: expect.arrayContaining([2, 7]),
            maximum: 7,
        });
        for (const id of [
            "storage.peakEstimatedDbBytes",
            "memory.peakProcessFootprintBytes",
            "ui.maxEventLoopStallMs",
        ]) {
            expect(recorder.result.deviceMeasurement.metrics[id]).toMatchObject({
                evidenceSource: id === "ui.maxEventLoopStallMs"
                    ? "runtime-envelope-main-thread-gap-50ms"
                    : id === "memory.peakProcessFootprintBytes"
                        ? "runtime-envelope-process-resident_set_bytes-1000ms"
                        : "runtime-envelope-resource-1000ms",
            });
            await expect(recorder.recordDeviceMetric(id, { method: "manual", samples: [0] }))
                .rejects.toThrow("dedicated runtime sampler");
        }
        await expect(recorder.recordExternalMemoryEnvelope({}))
            .rejects.toThrow("process-memory evidence is available");
    });

    it.each(["json", "raw-export"] as const)(
        "blocks profiler capture when stale external memory %s evidence already exists",
        async (kind) => {
            const repositoryRoot = resolve(__dirname, "..");
            const {
                context,
                runner,
                diagnosticsControl,
                externalMemoryArtifactControl,
            } = createRunnerContext(repositoryRoot, { preflightReady: true });

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan();
            if (kind === "json") {
                externalMemoryArtifactControl.setArtifact({ stale: true });
            } else {
                externalMemoryArtifactControl.setRawExport("stale raw export");
            }

            await qualifyPerformanceWorkload(recorder, diagnosticsControl);
            await expect(recorder.startRuntimeEnvelope())
                .rejects.toThrow("must not exist before profiler capture starts");
            expect((recorder.result.deviceMeasurement as unknown as {
                runtimeEnvelope: {
                    externalMemoryCapturePrecondition: Record<string, unknown>;
                };
            }).runtimeEnvelope.externalMemoryCapturePrecondition).toMatchObject({
                status: "BLOCKED",
                artifactPath: "retrieval-smoke/evidence/system-memory-envelope.json",
                artifactAbsent: kind !== "json",
                rawExportPath: IOS_MEMORY_RAW_EXPORT_PATH,
                rawExportAbsent: kind !== "raw-export",
            });
        },
    );

    it("keeps schema-v1 profiler samples blocked until a raw-export converter is verified", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const {
            context,
            runner,
            writes,
            diagnosticsControl,
            externalMemoryArtifactControl,
            vaultEventControl,
            settingsControl,
        } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            runtimeProcessMemoryUnavailable: true,
            runtimeDatabaseSamples: [10, 20],
            runtimeStallDelays: [1, 2],
            runtimeUserAgent: IOS_RUNTIME_USER_AGENT,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            externalDeviceIdentitySha256: "d".repeat(64),
            thresholds: {
                "storage.peakEstimatedDbBytes": { maxMax: 20 },
                "memory.peakProcessFootprintBytes": { maxMax: 200 },
                "ui.maxEventLoopStallMs": { maxMax: 2 },
            },
        });
        const stopped = await completeValidPerformanceEnvelope(recorder, diagnosticsControl);
        expect(stopped.envelope).toMatchObject({
            status: "BLOCKED",
            workloadCoverageStatus: "PASS",
            coveredStandardPerformanceEpisodeCount: 23,
            coveredRetryPerformanceEpisodeCount: 23,
            iosEvidenceStatus: "BLOCKED",
        });
        expect(stopped.processMemory).toMatchObject({ status: "BLOCKED", method: "unsupported" });

        const validArtifact = {
            schemaVersion: 1,
            collectorKind: "system-memory-profiler",
            tool: "Xcode Instruments",
            toolVersion: "16.4",
            platform: "iOS 18.6",
            platformClass: "ios-real-device",
            runtimeFamily: "ios-wkwebview",
            counter: "physical_footprint_bytes",
            unit: "bytes",
            processName: "Obsidian",
            appBundleId: "md.obsidian",
            appVersion: "test",
            appBuildIdentitySha256: createHash("sha256").update(JSON.stringify({
                loadedAppVersion: "test",
                loadedAppVersionSource: "obsidian.apiVersion",
                shellVersion: "1.12.7",
                shellVersionSource: "navigator.userAgent:obsidian/x",
                pluginVersion: "test",
                userAgent: IOS_RUNTIME_USER_AGENT,
                browserPlatform: "iPhone",
                maxTouchPoints: 5,
                hasDocument: true,
                locationHref: "capacitor://localhost",
                runtimeFamily: "ios-wkwebview",
                runtimeVersions: { electron: null, chrome: null, node: null },
                runtimeProcess: { type: null, platform: null, arch: null },
            })).digest("hex"),
            pluginId: "personal-assistant",
            pluginVersion: "test",
            pluginArtifactSha256: createHash("sha256").update("test-plugin-artifact").digest("hex"),
            runnerSha256: createHash("sha256").update(runner).digest("hex"),
            deviceIdentitySha256: "d".repeat(64),
            windowStartedAt: stopped.envelope.startedAt,
            windowFinishedAt: stopped.envelope.finishedAt,
            sampleIntervalMs: 1_000,
            samples: [100, 200],
            rawExportPath: IOS_MEMORY_RAW_EXPORT_PATH,
            rawExportSha256: createHash("sha256").update(IOS_MEMORY_RAW_EXPORT).digest("hex"),
        };
        externalMemoryArtifactControl.setRawExport(IOS_MEMORY_RAW_EXPORT);
        const artifactPath = "retrieval-smoke/evidence/system-memory-envelope.json";
        for (const { evidence } of [
            { name: "missing fixed path", evidence: {} },
            { name: "wrong fixed path", evidence: { artifactPath: "retrieval-smoke/evidence/other.json" } },
            { name: "extra evidence key", evidence: { artifactPath, samples: [100, 200] } },
        ]) {
            await expect(recorder.recordExternalMemoryEnvelope(evidence))
                .rejects.toThrow("invalid shape");
        }

        const validArtifactBytes = new TextEncoder().encode(JSON.stringify(validArtifact));
        for (const invalidJsonBytes of [
            Uint8Array.of(0xff, 0xfe, 0x00, 0x7b),
            Uint8Array.from([0xef, 0xbb, 0xbf, ...validArtifactBytes]),
            Uint8Array.from(Buffer.from(JSON.stringify(validArtifact), "utf16le")),
        ]) {
            externalMemoryArtifactControl.setArtifactBytes(invalidJsonBytes);
            await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
                .rejects.toThrow("artifact or raw Instruments export is unavailable or invalid");
        }

        const missingExactKeyArtifact = Object.fromEntries(
            Object.entries(validArtifact).filter(([key]) => key !== "unit"),
        );
        const missingRawExportPathArtifact = Object.fromEntries(
            Object.entries(validArtifact).filter(([key]) => key !== "rawExportPath"),
        );
        const missingRawExportDigestArtifact = Object.fromEntries(
            Object.entries(validArtifact).filter(([key]) => key !== "rawExportSha256"),
        );
        const futureWindowFinishedAt = new Date(Date.now() + 60_000).toISOString();
        const futureWindowSampleCount = Math.ceil((
            Date.parse(futureWindowFinishedAt) - Date.parse(validArtifact.windowStartedAt)
        ) / 1_000) + 1;
        const invalidArtifacts: Array<{
            name: string;
            artifact: Record<string, unknown>;
        }> = [
            { name: "missing exact artifact key", artifact: missingExactKeyArtifact },
            { name: "missing raw export path", artifact: missingRawExportPathArtifact },
            { name: "missing raw export digest", artifact: missingRawExportDigestArtifact },
            { name: "extra artifact key", artifact: { ...validArtifact, traceAuthenticated: true } },
            { name: "collector tool", artifact: { ...validArtifact, tool: "xctrace-json" } },
            { name: "tool version", artifact: { ...validArtifact, toolVersion: "16.4 beta" } },
            { name: "platform", artifact: { ...validArtifact, platform: "macOS 15.6" } },
            { name: "counter", artifact: { ...validArtifact, counter: "resident_size_bytes" } },
            { name: "unit", artifact: { ...validArtifact, unit: "KiB" } },
            { name: "process", artifact: { ...validArtifact, processName: "Obsidian Helper" } },
            { name: "bundle", artifact: { ...validArtifact, appBundleId: "com.example.obsidian" } },
            { name: "plugin id", artifact: { ...validArtifact, pluginId: "other-plugin" } },
            { name: "runner hash", artifact: { ...validArtifact, runnerSha256: "f".repeat(64) } },
            { name: "raw export path", artifact: { ...validArtifact, rawExportPath: "retrieval-smoke/evidence/other.xml" } },
            {
                name: "non-canonical start time",
                artifact: {
                    ...validArtifact,
                    windowStartedAt: validArtifact.windowStartedAt.replace("Z", "+00:00"),
                },
            },
            {
                name: "invalid finish time",
                artifact: { ...validArtifact, windowFinishedAt: "not-a-timestamp" },
            },
            {
                name: "window starts after workload",
                artifact: {
                    ...validArtifact,
                    windowStartedAt: new Date(
                        Date.parse(stopped.envelope.startedAt) + 1,
                    ).toISOString(),
                },
            },
            {
                name: "window finishes before workload",
                artifact: {
                    ...validArtifact,
                    windowFinishedAt: new Date(
                        Date.parse(stopped.envelope.finishedAt) - 1,
                    ).toISOString(),
                },
            },
            {
                name: "window finishes in the future",
                artifact: {
                    ...validArtifact,
                    windowFinishedAt: futureWindowFinishedAt,
                    samples: Array.from({ length: futureWindowSampleCount }, () => 100),
                },
            },
            { name: "zero interval", artifact: { ...validArtifact, sampleIntervalMs: 0 } },
            { name: "interval above one second", artifact: { ...validArtifact, sampleIntervalMs: 1_001 } },
            { name: "fractional interval", artifact: { ...validArtifact, sampleIntervalMs: 500.5 } },
            { name: "negative sample", artifact: { ...validArtifact, samples: [100, -1] } },
            { name: "fractional sample", artifact: { ...validArtifact, samples: [100, 199.5] } },
            {
                name: "sample span shorter than declared window",
                artifact: {
                    ...validArtifact,
                    windowStartedAt: new Date(
                        Date.parse(stopped.envelope.startedAt) - 2_000,
                    ).toISOString(),
                    samples: [100, 200],
                },
            },
        ];
        for (const { artifact } of invalidArtifacts) {
            externalMemoryArtifactControl.setArtifact(artifact);
            await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
                .rejects.toThrow("provenance or workload-window coverage is invalid");
        }

        externalMemoryArtifactControl.setArtifact({
            ...validArtifact,
            pluginArtifactSha256: "b".repeat(64),
        });
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
            .rejects.toThrow("provenance or workload-window coverage is invalid");
        for (const invalidIdentity of [
            { platformClass: "desktop-or-other" },
            { runtimeFamily: "electron-renderer" },
            { appVersion: "other" },
            { appBuildIdentitySha256: "e".repeat(64) },
            { pluginVersion: "other" },
            { deviceIdentitySha256: "e".repeat(64) },
        ]) {
            externalMemoryArtifactControl.setArtifact({ ...validArtifact, ...invalidIdentity });
            await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
                .rejects.toThrow("provenance or workload-window coverage is invalid");
        }
        externalMemoryArtifactControl.setArtifact({
            ...validArtifact,
            windowStartedAt: new Date(Date.parse(stopped.envelope.finishedAt) + 1).toISOString(),
        });
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
            .rejects.toThrow("provenance or workload-window coverage is invalid");
        externalMemoryArtifactControl.setArtifact({
            ...validArtifact,
            samples: [100],
        });
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
            .rejects.toThrow("provenance or workload-window coverage is invalid");

        externalMemoryArtifactControl.setArtifact(validArtifact);
        externalMemoryArtifactControl.setRawExport(null);
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
            .rejects.toThrow("artifact or raw Instruments export is unavailable or invalid");
        externalMemoryArtifactControl.setRawExport("");
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
            .rejects.toThrow("artifact or raw Instruments export is unavailable or invalid");
        externalMemoryArtifactControl.setRawExport(IOS_MEMORY_RAW_EXPORT);
        externalMemoryArtifactControl.setArtifact({
            ...validArtifact,
            rawExportSha256: "f".repeat(64),
        });
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
            .rejects.toThrow("raw Instruments export digest is invalid");

        externalMemoryArtifactControl.setArtifact(validArtifact);
        const blockedExternalMemoryEnvelope = {
            schemaVersion: 1,
            status: "BLOCKED",
            reason: "external_memory_converter_unverified",
            artifactPath,
            artifactSha256: createHash("sha256")
                .update(JSON.stringify(validArtifact))
                .digest("hex"),
            rawExportPath: IOS_MEMORY_RAW_EXPORT_PATH,
            rawExportSha256: validArtifact.rawExportSha256,
            deviceIdentitySha256: validArtifact.deviceIdentitySha256,
        };
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath })).resolves
            .toMatchObject({
                envelope: {
                    status: "BLOCKED",
                    reason: "external_memory_converter_unverified",
                    iosEvidenceStatus: "BLOCKED",
                    sourceCoverage: { processMemory: "BLOCKED" },
                    externalMemoryEnvelope: blockedExternalMemoryEnvelope,
                },
                processMemory: {
                    status: "BLOCKED",
                    reason: "external_memory_converter_unverified",
                    rawSamples: [],
                },
            });
        await expect(recorder.recordExternalMemoryEnvelope({ artifactPath }))
            .rejects.toThrow("already recorded");
        expect(vaultEventControl.listenerCount).toBe(0);
        expect(JSON.parse(writes.get("retrieval-optimization-smoke-result.json") ?? "{}"))
            .toMatchObject({
                deviceMeasurement: {
                    runtimeEnvelope: {
                        status: "BLOCKED",
                        reason: "external_memory_converter_unverified",
                        externalMemoryEnvelope: blockedExternalMemoryEnvelope,
                    },
                    metrics: {
                        "memory.peakProcessFootprintBytes": {
                            status: "BLOCKED",
                            reason: "external_memory_converter_unverified",
                        },
                    },
                },
            });
        const finalized = await recorder.finalize();
        expect(finalized.deviceMeasurement).toMatchObject({
            runtimeEnvelope: {
                status: "BLOCKED",
                reason: "external_memory_converter_unverified",
                iosEvidenceStatus: "BLOCKED",
                sourceCoverage: { processMemory: "BLOCKED" },
                externalMemoryEnvelope: blockedExternalMemoryEnvelope,
            },
            metrics: {
                "memory.peakProcessFootprintBytes": {
                    status: "BLOCKED",
                    reason: "external_memory_converter_unverified",
                },
            },
        });
        expect(settingsControl.listenerCount).toBe(0);
    });

    it("keeps an idle runtime envelope blocked even when its numeric samples satisfy thresholds", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: {
                "storage.peakEstimatedDbBytes": { maxMax: 100 },
                "memory.peakProcessFootprintBytes": { maxMax: 100 },
                "ui.maxEventLoopStallMs": { maxMax: 100 },
            },
        });
        await qualifyPerformanceWorkload(recorder, diagnosticsControl);
        await recorder.startRuntimeEnvelope();
        await expect(recorder.stopRuntimeEnvelope())
            .rejects.toThrow("Retry-performance batch 2 must contain exactly its bound frozen workload");
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; violationCount: number };
        }).workloadBinding).toMatchObject({ status: "INVALID", violationCount: 1 });
        await expect(recorder.beginCancellationProbe()).rejects.toThrow("workload-bound runtime envelope");
    });

    it("projects schema-v1 content-free diagnostics with opaque run correlation", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const vss = await recorder.recordVssStats("before", {
            estimatedDbBytes: 123,
            fileCount: 16,
            query: "private query",
        });
        const diagnostics = await recorder.recordDiagnosticsSnapshot(diagnosticsSnapshot([
            {
                sequence: 1,
                elapsedMs: 2,
                runId: DEFAULT_DIAGNOSTIC_RUN_ID,
                surface: "chat",
                phase: "graph_worker",
                outcome: "aborted",
                reason: "cancel_requested",
                metrics: {
                    cancelRequested: 1,
                    acceptedCount: 0,
                    unknownMetric: 999,
                },
                query: "private query",
                path: "private/hidden.md",
                content: "private note",
                opaque: "NEVER_EXPOSE_OPAQUE_B_92F7",
            },
        ], {
            query: "private query",
            path: "private/hidden.md",
            content: "private note",
            unknown: { opaque: "NEVER_EXPOSE_OPAQUE_B_92F7" },
        }));

        expect(vss).toEqual({ fileCount: 16, estimatedDbBytes: 123 });
        expect(JSON.stringify(diagnostics)).not.toContain("private");
        expect(JSON.stringify(diagnostics)).not.toContain("NEVER_EXPOSE_OPAQUE_B_92F7");
        expect(JSON.stringify(diagnostics)).not.toContain("session-sensitive");
        expect(diagnostics).toEqual({
            schemaVersion: 1,
            capacity: 512,
            droppedEventCount: 0,
            events: [{
                sequence: 1,
                elapsedMs: 2,
                runId: DEFAULT_DIAGNOSTIC_RUN_ID,
                surface: "chat",
                phase: "graph_worker",
                outcome: "aborted",
                reason: "cancel_requested",
                metrics: { cancelRequested: 1, acceptedCount: 0 },
            }],
        });
    });

    it("rejects diagnostics events whose trusted surface binding is missing", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, { preflightReady: true });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const event = diagnosticEvent(1, "recovery_standard", "started");
        delete event.surface;

        await expect(recorder.recordDiagnosticsSnapshot(diagnosticsSnapshot([event])))
            .rejects.toThrow("Invalid retrieval diagnostics event");
    });

    it("blocks 23 complete Pagelet-shaped episodes from satisfying Chat performance", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await qualifyPerformanceWorkload(recorder, diagnosticsControl);
        await recorder.startRuntimeEnvelope();
        const cursor = { sequence: 0, elapsedMs: 0 };
        const pageletDiagnostics = withDiagnosticSurface(diagnosticsControl, "pagelet");
        for (let index = 0; index < 23; index += 1) {
            pushSuccessfulPerformanceEpisode(pageletDiagnostics, cursor);
        }

        await recorder.captureRetrievalDiagnostics();

        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                standardPerformance: {
                    status: "INVALID",
                    reason: "performance evidence contains events outside the frozen Chat surface",
                    episodeCount: 0,
                    expectedSurface: "chat",
                    surfaceMismatchEventCount: 23 * 17,
                },
            },
        });
    });

    it("blocks a mixed-surface episode inside an otherwise complete Chat performance set", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await qualifyPerformanceWorkload(recorder, diagnosticsControl);
        await recorder.startRuntimeEnvelope();
        const cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 22; index += 1) {
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        }
        const mixedDiagnostics = withDiagnosticSurface(
            diagnosticsControl,
            "pagelet",
            (event) => event.phase === "graph_worker" && event.outcome === "started",
        );
        pushSuccessfulPerformanceEpisode(mixedDiagnostics, cursor);

        await recorder.captureRetrievalDiagnostics();

        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                standardPerformance: {
                    status: "INVALID",
                    episodeCount: 23,
                    normalEpisodeCount: 22,
                    expectedSurface: "chat",
                    surfaceMismatchEventCount: 1,
                },
            },
        });
    });

    it("blocks 12 complete Pagelet-shaped retry episodes from satisfying Chat retry batch 1", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await qualifyPerformanceWorkload(recorder, diagnosticsControl);
        await recorder.startRuntimeEnvelope();
        let cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 23; index += 1) {
            await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor);
        }
        await recorder.beginRetryPerformance();
        cursor = { sequence: 0, elapsedMs: 0 };
        const pageletDiagnostics = withDiagnosticSurface(diagnosticsControl, "pagelet");
        for (let index = 0; index < 12; index += 1) {
            pushSuccessfulPerformanceEpisode(pageletDiagnostics, cursor, { retry: true });
        }

        await recorder.captureRetrievalDiagnostics();
        await expect(recorder.continueRetryPerformance())
            .rejects.toThrow("batch 1 must contain exactly its bound frozen workload");
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                retryPerformanceBatches: [{
                    status: "INVALID",
                    reason: "performance evidence contains events outside the frozen Chat surface",
                    episodeCount: 0,
                    expectedSurface: "chat",
                    surfaceMismatchEventCount: 12 * 34,
                }, null],
            },
        });
    });

    it("blocks a complete Pagelet-shaped cancellation probe from satisfying Chat cancellation", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(
            repositoryRoot,
            { preflightReady: true },
        );

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        pushCancellationProbe(
            withDiagnosticSurface(diagnosticsControl, "pagelet"),
            { sequence: 0, elapsedMs: 0 },
        );

        await recorder.stopRetrievalDiagnostics();

        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                cancellationProbe: {
                    status: "INVALID",
                    reason: "cancellation evidence contains events outside the frozen Chat surface",
                    episodeCount: 0,
                    expectedSurface: "chat",
                    surfaceMismatchEventCount: 9,
                },
            },
        });
    });

    it("keeps performance and cancellation evidence in separate content-free sessions", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        const cancellationCursor = { sequence: 0, elapsedMs: 0 };
        pushCancellationProbe(diagnosticsControl, cancellationCursor, { includeDeadline: true });
        const receipt = await recorder.finalize();

        expect(diagnosticsControl.startCalls).toBe(6);
        expect(diagnosticsControl.stopCalls).toBe(6);
        expect(receipt.deviceMeasurement).toMatchObject({
            diagnosticsGate: { status: "PASS", schemaVersion: 1 },
            diagnosticsSummary: {
                eventCount: (23 * 17) + (23 * 34) + 10,
                measurementEpisodes: {
                    standardPerformance: {
                        status: "VALID",
                        episodeCount: 23,
                        normalEpisodeCount: 23,
                        cancellationProbeEpisodeCount: 0,
                    },
                    retryPerformance: {
                        status: "VALID",
                        episodeCount: 23,
                        normalEpisodeCount: 23,
                    },
                    retryPerformanceBatches: [
                        expect.objectContaining({ status: "VALID", episodeCount: 12 }),
                        expect.objectContaining({ status: "VALID", episodeCount: 11 }),
                    ],
                    cancellationProbe: {
                        status: "VALID",
                        episodeCount: 1,
                        normalEpisodeCount: 0,
                        cancellationProbeEpisodeCount: 1,
                    },
                },
                cancelRequested: 1,
                cancelObserved: 1,
                lateDiscardCount: 1,
                deadlineCount: 1,
                acceptedAfterCancelCount: 0,
                series: {
                    memorySearchDurationMs: Array.from({ length: 23 }, () => 75),
                    graphWallDurationMs: Array.from({ length: 23 }, () => 74),
                    graphWorkerDurationMs: Array.from({ length: 23 }, () => 50),
                    finalizationRemainingMs: Array.from({ length: 23 }, () => 50),
                    workerCompleted: {
                        queueWaitMs: Array.from({ length: 23 }, () => 2),
                        maxBatchDurationMs: Array.from({ length: 23 }, () => 40),
                    },
                },
                retrySeries: {
                    memorySearchDurationMs: Array.from({ length: 23 }, () => 150),
                    episodeWallDurationMs: Array.from({ length: 23 }, () => 159),
                    graphWallDurationMs: Array.from({ length: 23 }, () => 148),
                    graphWorkerDurationMs: Array.from({ length: 23 }, () => 100),
                    finalizationRemainingMs: Array.from({ length: 23 }, () => 50),
                },
            },
        });
        expect(receipt.deviceMeasurement?.metrics["retrieval.graphWorkerQueueWaitMs"])
            .toMatchObject({ method: "measured", status: "BLOCKED", rawSamples: Array(23).fill(2) });
        expect(receipt.deviceMeasurement?.metrics["retrieval.graphWorkerMaxBatchDurationMs"])
            .toMatchObject({ method: "measured", status: "BLOCKED", rawSamples: Array(23).fill(40) });
        expect(receipt.deviceMeasurement?.metrics["retrieval.graphDurationMs"])
            .toMatchObject({ rawSamples: Array(23).fill(74) });
        expect(receipt.deviceMeasurement?.metrics["retrieval.retryTotalDurationMs"])
            .toMatchObject({ rawSamples: Array(23).fill(159) });
        expect(receipt.deviceMeasurement?.metrics["retrieval.retryGraphDurationMs"])
            .toMatchObject({ rawSamples: Array(23).fill(148) });
        expect(JSON.stringify(receipt.deviceMeasurement?.diagnostics)).not.toContain("session-sensitive");
    });

    it("discards every pre-freeze event and starts a fresh measurement session", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            diagnosticsEvents: [diagnosticEvent(
                1,
                "memory_search",
                "completed",
                undefined,
                { durationMs: 999 },
            )],
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const cursor = { sequence: 0, elapsedMs: 0 };
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 5 },
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_not_entered",
            { remainingMs: 50 },
        );
        const receipt = await recorder.finalize();

        expect(diagnosticsControl.startCalls).toBe(2);
        expect(diagnosticsControl.stopCalls).toBe(2);
        expect(receipt.deviceMeasurement?.diagnostics).toMatchObject({
            standardPerformance: {
                events: expect.arrayContaining([
                    expect.objectContaining({ phase: "recovery_standard", outcome: "started" }),
                    expect.objectContaining({ phase: "memory_search", metrics: { durationMs: 5 } }),
                ]),
            },
            retryPerformanceBatches: [null, null],
            cancellationProbe: null,
        });
        expect(receipt.deviceMeasurement?.diagnosticsSummary).toMatchObject({
            series: { memorySearchDurationMs: [5] },
        });
        expect(JSON.stringify(receipt.deviceMeasurement?.diagnostics)).not.toContain("999");
    });

    it("keeps exactly 23 performance samples while binding an isolated cancellation probe", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: {
                "retrieval.totalDurationMs": { p95Max: 100 },
                "retrieval.deadlineExceededCount": { p95Max: 0 },
                "retrieval.cancelRequestedCount": { p95Min: 1 },
                "retrieval.cancelObservedCount": { p95Min: 1 },
                "retrieval.acceptedAfterCancelCount": { p95Max: 0 },
                "retrieval.lateDiscardCount": { p95Min: 1 },
            },
        });
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        expect(diagnosticsControl.armCalls).toBe(1);
        pushCancellationProbe(diagnosticsControl, { sequence: 0, elapsedMs: 0 });

        await recorder.captureRetrievalDiagnostics();
        const metrics = recorder.result.deviceMeasurement.metrics;
        expect(metrics["retrieval.totalDurationMs"]).toMatchObject({
            method: "measured",
            status: "PASS",
            rawSamples: Array.from({ length: 23 }, () => 75),
        });
        expect(metrics["retrieval.deadlineExceededCount"]).toMatchObject({
            method: "measured",
            status: "PASS",
            rawSamples: [0],
        });
        expect(metrics["retrieval.cancelRequestedCount"]).toMatchObject({
            method: "measured",
            status: "PASS",
            rawSamples: [1],
        });
        expect(metrics["retrieval.cancelObservedCount"]).toMatchObject({
            method: "measured",
            status: "PASS",
            rawSamples: [1],
        });
        expect(metrics["retrieval.acceptedAfterCancelCount"]).toMatchObject({
            method: "measured",
            status: "PASS",
            rawSamples: [0],
        });
        expect(metrics["retrieval.lateDiscardCount"]).toMatchObject({
            method: "measured",
            status: "PASS",
            rawSamples: [1],
        });
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                standardPerformance: { status: "VALID", episodeCount: 23 },
                retryPerformance: { status: "VALID", episodeCount: 23 },
                cancellationProbe: { status: "VALID", episodeCount: 1 },
            },
        });
        await expect(recorder.recordDeviceMetric("retrieval.cancelRequestedCount", {
            method: "manual",
            samples: [999],
        })).rejects.toThrow("bound to the retrieval diagnostics session");
    });

    it("binds Worker acknowledgement that arrives after the Memory attempt terminal", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        expect(diagnosticsControl.armCalls).toBe(1);
        pushCancellationProbe(diagnosticsControl, { sequence: 0, elapsedMs: 0 }, {
            acknowledgementAfterAttemptTerminal: true,
        });

        await recorder.stopRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            cancelRequested: 1,
            cancelObserved: 1,
            lateDiscardCount: 1,
            acceptedAfterCancelCount: 0,
            measurementEpisodes: {
                cancellationProbe: {
                    status: "VALID",
                    episodeCount: 1,
                    cancellationProbeEpisodeCount: 1,
                },
            },
        });
    });

    it("binds same-run Worker acknowledgement that arrives after the finalization boundary", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        pushCancellationProbe(diagnosticsControl, { sequence: 0, elapsedMs: 0 }, {
            acknowledgementAfterFinalizationBoundary: true,
        });

        await recorder.stopRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            cancelRequested: 1,
            cancelObserved: 1,
            lateDiscardCount: 1,
            acceptedAfterCancelCount: 0,
            measurementEpisodes: {
                cancellationProbe: {
                    status: "VALID",
                    episodeCount: 1,
                    unscopedEventCount: 0,
                },
            },
        });
    });

    it("rejects post-boundary cancellation acknowledgement from another run", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        pushCancellationProbe(diagnosticsControl, { sequence: 0, elapsedMs: 0 }, {
            acknowledgementAfterFinalizationBoundary: true,
            trailingAcknowledgementRunId: "run-other-cancellation",
        });

        await recorder.stopRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                cancellationProbe: {
                    status: "INVALID",
                    unscopedEventCount: 2,
                },
            },
        });
    });

    it("rejects the duplicate generic abort terminal emitted by the old production path", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        pushCancellationProbe(diagnosticsControl, { sequence: 0, elapsedMs: 0 }, {
            includeDuplicateAbortTerminal: true,
        });

        await recorder.stopRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                cancellationProbe: {
                    status: "INVALID",
                    reason: "cancellation probe invariants are incomplete or violated",
                },
            },
        });
    });

    it.each(["arm-error", "arm-invalid"] as const)(
        "blocks an unavailable or invalid cancellation arm receipt: %s",
        async (diagnosticsSeam) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
                preflightReady: true,
                diagnosticsSeam,
            });

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan();
            await completeValidPerformanceEnvelope(recorder, diagnosticsControl);
            await expect(recorder.beginCancellationProbe())
                .rejects.toThrow("could not be armed");
            expect(diagnosticsControl.armCalls).toBe(1);
            const result = recorder.result as unknown as {
                deviceMeasurement: { diagnosticsGate: { status: string } };
            };
            expect(result.deviceMeasurement.diagnosticsGate).toMatchObject({
                status: "BLOCKED",
            });
        },
    );

    it("keeps diagnostics series blocked when more than the frozen sample count is captured", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.totalDurationMs": { p95Max: 10 } },
        });
        const cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 24; index += 1) {
            pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
            pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
            pushDiagnosticEvent(
                diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 5 },
            );
            pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "finalization_reserve",
                "skipped",
                "reserve_not_entered",
                { remainingMs: 50 },
            );
        }

        await recorder.captureRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.metrics["retrieval.totalDurationMs"])
            .toMatchObject({
                method: "measured",
                status: "BLOCKED",
                reason: "samples are incomplete",
                rawSamples: Array.from({ length: 24 }, () => 5),
            });
    });

    it("blocks graph wall-time evidence when any normal episode omits a Phase 2 stage", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.graphDurationMs": { p95Max: 100 } },
        });
        const cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 22; index += 1) {
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        }
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "graph_snapshot", "started");
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "graph_snapshot", "completed", undefined, { durationMs: 3 }, 3,
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "graph_preflight", "started");
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "graph_preflight", "completed", undefined, { durationMs: 4 }, 4,
        );
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "graph_workset", "completed", undefined, { unionCount: 1 }, 2,
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "graph_worker", "started");
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "completed",
            undefined,
            {
                durationMs: 50,
                queueWaitMs: 2,
                maxBatchDurationMs: 40,
                acceptedCount: 1,
            },
            50,
        );
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "graph_workset", "completed", undefined, { selectedCount: 1 }, 7,
        );
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 70 }, 1,
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "finalization_reserve", "started", undefined, { remainingMs: 100 }, 1,
        );
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "finalization_reserve", "completed", undefined, { remainingMs: 50 }, 1,
        );

        await recorder.captureRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                standardPerformance: { status: "INVALID", episodeCount: 23 },
            },
        });
        expect(recorder.result.deviceMeasurement.metrics["retrieval.graphDurationMs"])
            .toMatchObject({
                status: "BLOCKED",
                reason: "samples are incomplete",
                rawSamples: Array.from({ length: 22 }, () => 74),
            });
    });

    it.each([
        "reordered-stage",
        "extra-failed-terminal",
        "preflight-fallback",
        "seed-fallback",
        "seed-deadline",
        "seed-count-mismatch",
        "seed-count-four",
    ] as const)(
        "blocks graph evidence with an invalid per-attempt stage chain: %s",
        async (graphViolation) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
                preflightReady: true,
            });

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan({
                thresholds: { "retrieval.graphDurationMs": { p95Max: 100 } },
            });
            const cursor = { sequence: 0, elapsedMs: 0 };
            for (let index = 0; index < 22; index += 1) {
                pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
            }
            pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
            pushSuccessfulMemoryAttempt(diagnosticsControl, cursor, { graphViolation });
            pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "finalization_reserve",
                "started",
                undefined,
                { remainingMs: 100 },
            );
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "finalization_reserve",
                "completed",
                undefined,
                { remainingMs: 50 },
            );

            await recorder.captureRetrievalDiagnostics();
            expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
                measurementEpisodes: {
                    standardPerformance: { status: "INVALID", episodeCount: 23 },
                },
            });
            expect(recorder.result.deviceMeasurement.metrics["retrieval.graphDurationMs"])
                .toMatchObject({
                    status: "BLOCKED",
                    reason: "samples are incomplete",
                    rawSamples: Array.from({ length: 22 }, () => 74),
                });
        },
    );

    it("aggregates a relaxed retry as one performance episode with two validated graph attempts", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: {
                "retrieval.retryTotalDurationMs": { p95Max: 159 },
                "retrieval.retryGraphDurationMs": { p95Max: 148 },
                "retrieval.retryGraphWorkerQueueWaitMs": { p95Max: 4 },
                "retrieval.retryGraphWorkerMaxBatchDurationMs": { p95Max: 40 },
                "retrieval.retryFinalizationReserveMs": { minMin: 50 },
            },
        });
        await completeValidPerformanceEnvelope(recorder, diagnosticsControl);
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                standardPerformance: {
                    status: "VALID",
                    episodeCount: 23,
                    normalEpisodeCount: 23,
                    unscopedEventCount: 0,
                },
                retryPerformance: {
                    status: "VALID",
                    episodeCount: 23,
                    normalEpisodeCount: 23,
                },
            },
            retrySeries: {
                memorySearchDurationMs: Array(23).fill(150),
                episodeWallDurationMs: Array(23).fill(159),
                graphWallDurationMs: Array(23).fill(148),
                graphWorkerDurationMs: Array(23).fill(100),
                finalizationRemainingMs: Array(23).fill(50),
                workerCompleted: {
                    batchCount: Array(23).fill(2),
                    chunkCount: Array(23).fill(2),
                    queueWaitMs: Array(23).fill(4),
                    workerDurationMs: Array(23).fill(90),
                    maxBatchDurationMs: Array(23).fill(40),
                },
            },
        });
        for (const [id, expected] of [
            ["retrieval.retryTotalDurationMs", 159],
            ["retrieval.retryGraphDurationMs", 148],
            ["retrieval.retryGraphWorkerQueueWaitMs", 4],
            ["retrieval.retryGraphWorkerMaxBatchDurationMs", 40],
            ["retrieval.retryFinalizationReserveMs", 50],
        ] as const) {
            expect(recorder.result.deviceMeasurement.metrics[id]).toMatchObject({
                status: "PASS",
                rawSamples: Array(23).fill(expected),
                evaluatedSamples: Array(20).fill(expected),
                p95: expected,
            });
        }
        const diagnostics = recorder.result.deviceMeasurement.diagnostics as {
            standardPerformance: { events: unknown[] };
            retryPerformanceBatches: Array<{ events: unknown[] }>;
        };
        expect(diagnostics.standardPerformance.events).toHaveLength(23 * 17);
        expect(diagnostics.retryPerformanceBatches[0].events).toHaveLength(12 * 34);
        expect(diagnostics.retryPerformanceBatches[1].events).toHaveLength(11 * 34);
    });

    it.each([
        "missing-episode",
        "memory-skipped",
        "early-finalization-started",
        "multiple-runtime-boundaries",
    ] as const)(
        "blocks orphaned retrieval topology: %s",
        async (violation) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
                preflightReady: true,
            });

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan();
            const cursor = { sequence: 0, elapsedMs: 0 };
            if (violation === "missing-episode") {
                pushSuccessfulMemoryAttempt(diagnosticsControl, cursor);
                pushDiagnosticEvent(
                    diagnosticsControl,
                    cursor,
                    "finalization_reserve",
                    "skipped",
                    "reserve_not_entered",
                    { remainingMs: 50 },
                );
            } else if (violation === "multiple-runtime-boundaries") {
                pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
                pushDiagnosticEvent(
                    diagnosticsControl,
                    cursor,
                    "finalization_reserve",
                    "skipped",
                    "reserve_not_entered",
                    { remainingMs: 50 },
                );
            } else {
                pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
                if (violation === "memory-skipped") {
                    pushDiagnosticEvent(
                        diagnosticsControl,
                        cursor,
                        "memory_search",
                        "skipped",
                        "standard_sufficient",
                    );
                } else {
                    pushDiagnosticEvent(
                        diagnosticsControl,
                        cursor,
                        "finalization_reserve",
                        "started",
                        undefined,
                        { remainingMs: 100 },
                    );
                }
                pushSuccessfulMemoryAttempt(diagnosticsControl, cursor);
                pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
                pushDiagnosticEvent(
                    diagnosticsControl,
                    cursor,
                    "finalization_reserve",
                    violation === "early-finalization-started" ? "completed" : "skipped",
                    violation === "early-finalization-started" ? undefined : "reserve_not_entered",
                    { remainingMs: 50 },
                );
            }

            await recorder.stopRetrievalDiagnostics();
            expect(recorder.result.deviceMeasurement).toMatchObject({
                diagnosticsGate: {
                    status: "BLOCKED",
                    reason: "performance evidence contains unscoped, incomplete, wrong-shape, or cancellation episodes",
                },
                diagnosticsSummary: {
                    measurementEpisodes: {
                        standardPerformance: { status: "INVALID" },
                    },
                },
            });
        },
    );

    it("counts every accepted Worker completion after cancellation was requested", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        const cursor = { sequence: 0, elapsedMs: 0 };
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "started",
            undefined,
            { cancelRequested: 1, acceptedCount: 1 },
        );
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "aborted",
            "cancel_requested",
            { cancelRequested: 1, acceptedCount: 0 },
        );
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "completed",
            undefined,
            { cancelRequested: 0, acceptedCount: 1, durationMs: 2 },
        );
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "completed",
            undefined,
            { cancelRequested: 1, acceptedCount: 1, durationMs: 3 },
        );
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 5 },
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_not_entered",
            { remainingMs: 50 },
        );

        await recorder.captureRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            cancelRequested: 1,
            acceptedCount: 72,
            acceptedAfterCancelCount: 2,
        });
    });

    it.each([
        "missing-observed",
        "missing-late",
        "accepted-after-cancel",
        "accepted-after-cancel-without-request-flag",
        "misordered",
        "observed-without-request-flag",
        "late-without-request-flag",
        "duplicate-observed",
        "two-attempt-probe",
        "cross-attempt-signals",
        "requested-after-attempt-terminal",
    ] as const)("blocks a cancellation probe invariant violation even with permissive thresholds: %s", async (violation) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: {
                "retrieval.cancelRequestedCount": { p95Min: 0 },
                "retrieval.cancelObservedCount": { p95Min: 0 },
                "retrieval.acceptedAfterCancelCount": { p95Max: 999 },
                "retrieval.lateDiscardCount": { p95Min: 0 },
            },
        });
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        pushCancellationProbeViolation(
            diagnosticsControl,
            { sequence: 0, elapsedMs: 0 },
            violation,
        );
        await recorder.stopRetrievalDiagnostics();
        const receipt = await recorder.finalize();

        expect(receipt.deviceMeasurement).toMatchObject({
            diagnosticsGate: {
                status: "BLOCKED",
                reason: "cancellation probe invariants are incomplete or violated",
            },
            diagnosticsSummary: {
                measurementEpisodes: {
                    cancellationProbe: {
                        status: "INVALID",
                        reason: "cancellation probe invariants are incomplete or violated",
                    },
                },
            },
        });
        for (const id of [
            "retrieval.cancelRequestedCount",
            "retrieval.cancelObservedCount",
            "retrieval.acceptedAfterCancelCount",
            "retrieval.lateDiscardCount",
        ]) {
            expect(receipt.deviceMeasurement?.metrics[id]).toMatchObject({ status: "PASS" });
        }
    });

    it("does not treat non-Worker cancellation counters as observed or late-discard evidence", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        const cursor = { sequence: 0, elapsedMs: 0 };
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "graph_worker", "started");
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "aborted",
            "cancel_requested",
            { cancelRequested: 1, acceptedCount: 0 },
        );
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "memory_search",
            "completed",
            undefined,
            { durationMs: 5, cancelObserved: 1, lateDiscardCount: 1 },
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_not_entered",
            { remainingMs: 50 },
        );

        await recorder.stopRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            cancelRequested: 1,
            cancelObserved: 0,
            lateDiscardCount: 0,
            measurementEpisodes: {
                cancellationProbe: { status: "INVALID" },
            },
        });
    });

    it("rejects a zero finalization reserve structurally before percentile evaluation", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.finalizationReserveMs": { minMin: 0 } },
        });
        const cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 22; index += 1) {
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        }
        pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, { remainingMs: 0 });

        await recorder.captureRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement).toMatchObject({
            diagnosticsSummary: {
                measurementEpisodes: {
                    standardPerformance: {
                        status: "INVALID",
                        episodeCount: 23,
                        normalEpisodeCount: 22,
                    },
                },
            },
            metrics: {
                "retrieval.finalizationReserveMs": {
                    status: "BLOCKED",
                    rawSamples: Array(22).fill(50),
                },
            },
        });
    });

    it("gates finalization reserve on the measured minimum instead of p95", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan({
            thresholds: { "retrieval.finalizationReserveMs": { minMin: 10 } },
        });
        const cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 22; index += 1) {
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        }
        pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, { remainingMs: 1 });

        await recorder.captureRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement).toMatchObject({
            diagnosticsSummary: {
                measurementEpisodes: {
                    standardPerformance: { status: "VALID", normalEpisodeCount: 23 },
                },
            },
            metrics: {
                "retrieval.finalizationReserveMs": {
                    status: "FAIL",
                    minimum: 1,
                    p95: 50,
                    maximum: 50,
                },
            },
        });
    });

    it.each(["missing-projection", "zero-reserve", "graph-fallback"] as const)(
        "rejects an invalid two-attempt retry batch before rotation: %s",
        async (violation) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
                preflightReady: true,
            });

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan();
            await qualifyPerformanceWorkload(recorder, diagnosticsControl);
            await recorder.startRuntimeEnvelope();
            let cursor = { sequence: 0, elapsedMs: 0 };
            for (let index = 0; index < 23; index += 1) {
                await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor);
            }
            await recorder.beginRetryPerformance();
            cursor = { sequence: 0, elapsedMs: 0 };
            for (let index = 0; index < 11; index += 1) {
                pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, { retry: true });
            }
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, {
                retry: true,
                omitProjection: violation === "missing-projection",
                remainingMs: violation === "zero-reserve" ? 0 : 50,
                graphViolation: violation === "graph-fallback" ? "preflight-fallback" : undefined,
            });

            await recorder.captureRetrievalDiagnostics();
            await expect(recorder.continueRetryPerformance())
                .rejects.toThrow("Retry-performance batch 1 must contain exactly its bound frozen workload");
            expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
                measurementEpisodes: {
                    retryPerformanceBatches: [
                        expect.objectContaining({ status: "INVALID", episodeCount: 12 }),
                        null,
                    ],
                },
            });
            await recorder.finalize();
        },
    );

    it("uses the runtime reserve-not-entered boundary while ignoring coordinator reserve-protected", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const cursor = { sequence: 0, elapsedMs: 0 };
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
        pushSuccessfulMemoryAttempt(diagnosticsControl, cursor);
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_protected",
            { remainingMs: 50 },
        );
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_not_entered",
            { remainingMs: 999 },
        );

        await recorder.captureRetrievalDiagnostics();
        expect(recorder.result.deviceMeasurement.diagnosticsSummary).toMatchObject({
            measurementEpisodes: {
                standardPerformance: {
                    episodeCount: 1,
                    status: "INCOMPLETE",
                    unscopedEventCount: 0,
                },
            },
            series: { finalizationRemainingMs: [999] },
        });
        expect(recorder.result.deviceMeasurement.metrics["retrieval.finalizationReserveMs"])
            .toMatchObject({ method: "measured", status: "BLOCKED", rawSamples: [999] });
    });

    it.each(["missing", "start-error"] as const)(
        "keeps an unavailable diagnostics seam blocking instead of failing old builds: %s",
        async (diagnosticsSeam) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner } = createRunnerContext(repositoryRoot, {
                preflightReady: true,
                diagnosticsSeam,
            });

            await runInNewContext(runner, context);
            const recorder = context.paRetrievalSmoke as SmokeRecorder;
            await recorder.freezeDeviceMeasurementPlan();
            const receipt = await recorder.finalize();

            expect(receipt.overall).toBe("BLOCKED");
            expect(receipt.deviceMeasurement).toMatchObject({
                overall: "BLOCKED",
                diagnosticsGate: { status: "BLOCKED" },
            });
        },
    );

    it("keeps a non-canonical diagnostics capacity blocking", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            diagnosticsCapacity: 1_024,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const receipt = await recorder.finalize();

        expect(receipt.overall).toBe("BLOCKED");
        expect(receipt.deviceMeasurement).toMatchObject({
            diagnosticsGate: {
                status: "BLOCKED",
                reason: "plugin diagnostics session start failed",
            },
        });
    });

    it("keeps a diagnostics stop error blocking and never retries the failed stop", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            diagnosticsSeam: "stop-error",
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const receipt = await recorder.finalize();

        expect(diagnosticsControl.stopCalls).toBe(1);
        expect(receipt.deviceMeasurement).toMatchObject({
            overall: "BLOCKED",
            diagnosticsGate: { status: "BLOCKED", reason: "plugin diagnostics stop failed" },
        });
        await expect(recorder.finalize()).resolves.toMatchObject({
            deviceMeasurement: { diagnosticsGate: { status: "BLOCKED" } },
        });
        expect(diagnosticsControl.stopCalls).toBe(1);
    });

    it("blocks diagnostics evidence when the bounded recorder dropped events", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            diagnosticsDroppedEventCount: 1,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        const receipt = await recorder.finalize();

        expect(receipt.deviceMeasurement).toMatchObject({
            overall: "BLOCKED",
            diagnostics: {
                standardPerformance: { droppedEventCount: 1 },
                retryPerformanceBatches: [null, null],
                cancellationProbe: null,
            },
            diagnosticsGate: {
                status: "BLOCKED",
                reason: "diagnostics event capacity was exceeded",
            },
        });
    });

    it("serializes capture before final stop and freezes diagnostics after finalization", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        pushCancellationProbe(diagnosticsControl, { sequence: 0, elapsedMs: 0 });
        diagnosticsControl.deferNextCapture();
        const pendingCapture = recorder.captureRetrievalDiagnostics();
        await diagnosticsControl.waitUntilCaptureDeferred();
        const pendingFinal = recorder.finalize();
        const finalizedEarly = await Promise.race([
            pendingFinal.then(() => true),
            new Promise<boolean>((resolveRace) => setTimeout(() => resolveRace(false), 10)),
        ]);
        expect(finalizedEarly).toBe(false);

        diagnosticsControl.releaseCapture();
        await expect(pendingCapture).resolves.toMatchObject({ schemaVersion: 1 });
        await expect(pendingFinal).resolves.toMatchObject({
            deviceMeasurement: { diagnosticsGate: { status: "PASS" } },
        });
        expect(diagnosticsControl.getCalls).toBeGreaterThanOrEqual(3);
        expect(diagnosticsControl.stopCalls).toBe(6);
        await expect(recorder.captureRetrievalDiagnostics())
            .rejects.toThrow("finalized and cannot be modified");
        await expect(recorder.stopRetrievalDiagnostics())
            .rejects.toThrow("finalized and cannot be modified");
        await expect(recorder.finalize()).resolves.toMatchObject({
            deviceMeasurement: { diagnosticsGate: { status: "PASS" } },
        });
    });

    it("keeps an explicitly stopped snapshot idempotent and immune to later events", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recorder.freezeDeviceMeasurementPlan();
        await beginValidCancellationProbe(recorder, diagnosticsControl);
        pushCancellationProbe(diagnosticsControl, { sequence: 0, elapsedMs: 0 });
        const first = await recorder.stopRetrievalDiagnostics();
        diagnosticsControl.pushEvent(diagnosticEvent(7, "graph_worker", "completed", undefined, {
            acceptedCount: 1,
        }));
        const second = await recorder.stopRetrievalDiagnostics();
        const receipt = await recorder.finalize();

        expect(second).toEqual(first);
        expect(diagnosticsControl.stopCalls).toBe(6);
        expect(receipt.deviceMeasurement?.diagnosticsSummary).toMatchObject({
            eventCount: (23 * 17) + (23 * 34) + 9,
            cancelRequested: 1,
            cancelObserved: 1,
            acceptedCount: 69,
            acceptedAfterCancelCount: 0,
        });
    });

    it("does not start a duplicate diagnostics session when the active runner is evaluated again", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, diagnosticsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const firstRecorder = context.paRetrievalSmoke;
        await runInNewContext(runner, context);

        expect(context.paRetrievalSmoke).toBe(firstRecorder);
        expect(diagnosticsControl.startCalls).toBe(1);
        await (firstRecorder as SmokeRecorder).finalize();
    });

    it("records formal loaded-app and UA shell identities without requiring equal versions", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, runtimeIdentityControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            appVersion: "1.13.4",
            runtimeUserAgent: DESKTOP_RUNTIME_USER_AGENT,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const runtime = (recorder.result as unknown as { runtime: Record<string, unknown> }).runtime;

        expect(runtime).toMatchObject({
            appVersion: "1.13.4",
            appVersionSource: "obsidian.apiVersion",
            loadedAppVersion: "1.13.4",
            loadedAppVersionSource: "obsidian.apiVersion",
            shellVersion: "1.12.7",
            shellVersionSource: "navigator.userAgent:obsidian/x",
            runtimeFamily: "electron-renderer",
            pluginVersion: "test",
        });
        const identity = (recorder.result as unknown as { identity: Record<string, unknown> }).identity;
        expect(identity).toMatchObject({
            pluginArtifactSha256: createHash("sha256").update("test-plugin-artifact").digest("hex"),
            loadedPluginArtifactSha256: createHash("sha256")
                .update("test-plugin-artifact")
                .digest("hex"),
            loadedPluginBuildIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        expect(JSON.stringify(identity)).not.toContain(".obsidian/plugins");
        const receipt = await recorder.finalize() as unknown as {
            overall: string;
            checks: Array<{ name: string; status: string }>;
        };
        expect(runtimeIdentityControl.loadedBuildIdentityCalls).toBe(3);
        expect(receipt.overall).toBe("BLOCKED");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
            status: "PASS",
        }));
    });

    it("blocks finalization after bundle B reload even when disk is restored to bundle A", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, runtimeIdentityControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        runtimeIdentityControl.reloadPluginWithArtifact("test-plugin-artifact-b");
        runtimeIdentityControl.setPluginArtifact("test-plugin-artifact");

        const receipt = await recorder.finalize() as unknown as {
            overall: string;
            checks: Array<{ name: string; status: string }>;
        };
        expect(runtimeIdentityControl.loadedBuildIdentityCalls).toBe(3);
        expect(receipt.overall).toBe("BLOCKED");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
            status: "BLOCKED",
        }));
    });

    it("keeps plugin lifecycle drift latched after the initial instance is restored", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, runtimeIdentityControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        runtimeIdentityControl.reloadPluginWithArtifact("test-plugin-artifact-b");
        runtimeIdentityControl.restoreInitialPluginInstance();
        runtimeIdentityControl.setPluginArtifact("test-plugin-artifact");

        const receipt = await recorder.finalize() as unknown as {
            overall: string;
            checks: Array<{ name: string; status: string }>;
        };
        expect(receipt.overall).toBe("BLOCKED");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Plugin lifecycle, artifact, and settings bindings are stable at receipt commit",
            status: "BLOCKED",
        }));
        expect(runtimeIdentityControl.loadedBuildIdentityCalls).toBe(3);
    });

    it("releases identity guards and admits a fresh runner after blocked final identity", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const {
            context,
            runner,
            writes,
            runtimeIdentityControl,
            settingsControl,
        } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            appVersion: "1.13.4",
        });
        const pluginManager = (context.app as {
            plugins: {
                plugins: Record<string, { settings: Record<string, unknown> }>;
            };
        }).plugins;
        const plugin = pluginManager.plugins["personal-assistant"];
        const originalSettings = plugin.settings;
        const originalRecordFor = (plugin as unknown as {
            retrievalDiagnostics: { recordFor: unknown };
        }).retrievalDiagnostics.recordFor;
        const originalSettingsDescriptor = Object.getOwnPropertyDescriptor(plugin, "settings");
        const originalRegistryDescriptor = Object.getOwnPropertyDescriptor(pluginManager, "plugins");

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        runtimeIdentityControl.setAppVersion("1.13.5");
        await expect(recorder.finalize()).resolves.toMatchObject({ overall: "BLOCKED" });

        expect(JSON.parse(writes.get("retrieval-optimization-smoke-result.json") ?? "{}"))
            .toMatchObject({ overall: "BLOCKED" });
        expect(settingsControl.listenerCount).toBe(0);
        expect((plugin as unknown as { retrievalDiagnostics: { recordFor: unknown } })
            .retrievalDiagnostics.recordFor).toBe(originalRecordFor);
        expect(plugin.settings).toBe(originalSettings);
        expect(Object.getOwnPropertyDescriptor(plugin, "settings")).toEqual({
            ...originalSettingsDescriptor,
            value: originalSettings,
        });
        expect(Object.getOwnPropertyDescriptor(pluginManager, "plugins")).toEqual({
            ...originalRegistryDescriptor,
            value: originalRegistryDescriptor?.value,
        });

        runtimeIdentityControl.setAppVersion("1.13.4");
        await runInNewContext(runner, context);
        const restartedRecorder = context.paRetrievalSmoke as SmokeRecorder;
        expect(restartedRecorder).not.toBe(recorder);
        expect(settingsControl.listenerCount).toBe(1);
        await restartedRecorder.finalize();
        expect(settingsControl.listenerCount).toBe(0);
    });

    it("releases settings guards and admits a fresh runner after latched settings failure", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, writes, settingsControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
        });
        const pluginManager = (context.app as {
            plugins: {
                plugins: Record<string, { settings: Record<string, unknown> }>;
            };
        }).plugins;
        const plugin = pluginManager.plugins["personal-assistant"];
        const originalSettings = plugin.settings;
        const originalRecordFor = (plugin as unknown as {
            retrievalDiagnostics: { recordFor: unknown };
        }).retrievalDiagnostics.recordFor;
        const originalSettingsDescriptor = Object.getOwnPropertyDescriptor(plugin, "settings");
        const originalRegistryDescriptor = Object.getOwnPropertyDescriptor(pluginManager, "plugins");

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const baselineModel = plugin.settings.chatModelName;
        plugin.settings.chatModelName = "transient-finalize-model";
        plugin.settings.chatModelName = baselineModel;
        await settingsControl.notifySettingsChanged();
        await expect(recorder.finalize()).resolves.toMatchObject({ overall: "FAIL" });

        expect(JSON.parse(writes.get("retrieval-optimization-smoke-result.json") ?? "{}"))
            .toMatchObject({ overall: "FAIL" });
        expect(settingsControl.listenerCount).toBe(0);
        expect((plugin as unknown as { retrievalDiagnostics: { recordFor: unknown } })
            .retrievalDiagnostics.recordFor).toBe(originalRecordFor);
        expect(plugin.settings).toBe(originalSettings);
        expect(Object.getOwnPropertyDescriptor(plugin, "settings")).toEqual({
            ...originalSettingsDescriptor,
            value: originalSettings,
        });
        expect(Object.getOwnPropertyDescriptor(pluginManager, "plugins")).toEqual({
            ...originalRegistryDescriptor,
            value: originalRegistryDescriptor?.value,
        });

        await runInNewContext(runner, context);
        const restartedRecorder = context.paRetrievalSmoke as SmokeRecorder;
        expect(restartedRecorder).not.toBe(recorder);
        expect(settingsControl.listenerCount).toBe(1);
        await restartedRecorder.finalize();
        expect(settingsControl.listenerCount).toBe(0);
    });

    it("never persists PASS when a locked commit-window reload is attempted and final write fails", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const {
            context,
            runner,
            writes,
            writeControl,
            runtimeIdentityControl,
            diagnosticsControl,
            chatControl,
            pageletControl,
            settingsControl,
        } = createRunnerContext(repositoryRoot, { preflightReady: true });
        const pluginManager = (context.app as {
            plugins: {
                plugins: Record<string, { settings: Record<string, unknown> }>;
            };
        }).plugins;
        const loadedPlugin = pluginManager.plugins["personal-assistant"];
        const originalSettings = loadedPlugin.settings;
        const originalRecordFor = (loadedPlugin as unknown as {
            retrievalDiagnostics: { recordFor: unknown };
        }).retrievalDiagnostics.recordFor;
        const originalSettingsDescriptor = Object.getOwnPropertyDescriptor(
            loadedPlugin,
            "settings",
        );
        const originalRegistryDescriptor = Object.getOwnPropertyDescriptor(
            pluginManager,
            "plugins",
        );
        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        await recordPassingManualCases(recorder, diagnosticsControl, pageletControl);
        await freezePassingDevicePlan(recorder);
        await recordPassingRankings(recorder, diagnosticsControl, chatControl);
        await recordPassingDeviceMetrics(recorder, diagnosticsControl);
        writeControl.deferResultWriteAfter(1);
        const pendingFinal = recorder.finalize();
        await writeControl.waitUntilDeferred();
        expect(() => {
            loadedPlugin.settings.chatModelName = "commit-window-model";
        }).toThrow("Retrieval settings are locked during receipt commit");
        expect(() => runtimeIdentityControl.reloadPluginWithArtifact("test-plugin-artifact-b"))
            .toThrow("Plugin lifecycle is locked during receipt commit");
        runtimeIdentityControl.setPluginArtifact("test-plugin-artifact");
        writeControl.failDeferredResultWrite();

        await expect(pendingFinal).rejects.toThrow("forced final result write failure");
        const persisted = JSON.parse(
            writes.get("retrieval-optimization-smoke-result.json") ?? "{}",
        ) as { overall?: string; finishedAt?: string | null };
        expect(persisted.overall).not.toBe("PASS");
        expect(persisted.finishedAt).toBeNull();
        expect((recorder.result as unknown as { overall: string; finishedAt: string | null }))
            .toMatchObject({ overall: "BLOCKED", finishedAt: null });
        expect(settingsControl.listenerCount).toBe(0);
        expect((loadedPlugin as unknown as { retrievalDiagnostics: { recordFor: unknown } })
            .retrievalDiagnostics.recordFor).toBe(originalRecordFor);
        expect(loadedPlugin.settings).toBe(originalSettings);
        expect(Object.getOwnPropertyDescriptor(loadedPlugin, "settings")).toEqual({
            ...originalSettingsDescriptor,
            value: originalSettings,
        });
        expect(Object.getOwnPropertyDescriptor(pluginManager, "plugins")).toEqual({
            ...originalRegistryDescriptor,
            value: originalRegistryDescriptor?.value,
        });
        expect(context.paRetrievalSmoke).toBeUndefined();
        expect(context.__paRetrievalSmokeRunnerGuard).toMatchObject({ finished: true });
        expect(() => {
            loadedPlugin.settings.chatModelName = "after-failed-commit";
            loadedPlugin.settings.chatModelName = "test-chat";
        }).not.toThrow();
        expect(() => runtimeIdentityControl.reloadPluginWithArtifact("test-plugin-artifact-b"))
            .not.toThrow();
        runtimeIdentityControl.restoreInitialPluginInstance();
        runtimeIdentityControl.setPluginArtifact("test-plugin-artifact");
        expect(runtimeIdentityControl.loadedBuildIdentityCalls).toBe(3);

        await runInNewContext(runner, context);
        const restartedRecorder = context.paRetrievalSmoke as SmokeRecorder;
        expect(restartedRecorder).not.toBe(recorder);
        expect(settingsControl.listenerCount).toBe(1);
        await restartedRecorder.finalize();
        expect(settingsControl.listenerCount).toBe(0);
    });

    it.each([
        ["missing seam", { loadedBuildIdentitySeam: "missing" }],
        ["blocked identity", { loadedBuildIdentitySeam: "blocked" }],
        ["invalid identity", { loadedBuildIdentitySeam: "invalid" }],
        ["loaded/disk mismatch", { loadedPluginArtifactSha256: "f".repeat(64) }],
    ] as const)("blocks initialization when loaded plugin provenance has %s", async (_label, overrides) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, writes } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            ...overrides,
        });

        await runInNewContext(runner, context);

        expect(context.paRetrievalSmoke).toBeUndefined();
        const receipt = JSON.parse(
            writes.get("retrieval-optimization-smoke-result.json") ?? "{}",
        ) as { overall?: string; checks?: Array<{ name: string; status: string }> };
        expect(receipt.overall).toBe("BLOCKED");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Loaded plugin and current vault artifact identities match",
            status: "BLOCKED",
        }));
    });

    it("accepts the real iOS plain obsidian token only with a strong WKWebView identity", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            runtimeUserAgent: IOS_PLAIN_OBSIDIAN_RUNTIME_USER_AGENT,
            runtimePlatform: "iPhone",
            runtimeMaxTouchPoints: 5,
            runtimeLocationHref: "capacitor://localhost",
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        const runtime = (recorder.result as unknown as { runtime: Record<string, unknown> }).runtime;

        expect(runtime).toMatchObject({
            appVersion: "test",
            appVersionSource: "obsidian.apiVersion",
            shellVersion: null,
            shellVersionSource: null,
            runtimeFamily: "ios-wkwebview",
            pluginVersion: "test",
        });
        const receipt = await recorder.finalize() as unknown as {
            checks: Array<{ name: string; status: string }>;
        };
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
            status: "PASS",
        }));
    });

    it.each([
        {
            label: "missing independent obsidian token",
            options: {
                runtimeUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            },
        },
        {
            label: "touchless browser",
            options: { runtimeMaxTouchPoints: 0 },
        },
        {
            label: "desktop navigator platform",
            options: { runtimePlatform: "MacIntel" },
        },
        {
            label: "Electron wrapper",
            options: {
                runtimeUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 obsidian Electron/39.8.3",
            },
        },
        {
            label: "desktop Electron process with an iPadOS-shaped UA",
            options: {
                runtimeUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 obsidian",
                runtimePlatform: "MacIntel",
                runtimeElectronProcess: true,
            },
        },
        {
            label: "non-Capacitor origin",
            options: { runtimeLocationHref: "https://localhost/" },
        },
    ])("blocks a plain obsidian token without strong iOS evidence: $label", async ({ options }) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, writes } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            runtimeUserAgent: IOS_PLAIN_OBSIDIAN_RUNTIME_USER_AGENT,
            runtimePlatform: "iPhone",
            runtimeMaxTouchPoints: 5,
            runtimeLocationHref: "capacitor://localhost",
            ...options,
        });

        await runInNewContext(runner, context);

        expect(context.paRetrievalSmoke).toBeUndefined();
        const receipt = JSON.parse(
            writes.get("retrieval-optimization-smoke-result.json") ?? "{}",
        ) as { overall?: string; checks?: Array<{ name: string; status: string }> };
        expect(receipt.overall).toBe("BLOCKED");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Exact Obsidian app, shell, runtime, and plugin identity is captured",
            status: "BLOCKED",
        }));
    });

    it.each([
        "app-version",
        "shell-version",
        "runtime-version",
        "plugin-version",
        "runner-artifact",
        "plugin-artifact",
    ] as const)("blocks final evidence when an exact identity binding drifts: %s", async (drift) => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, runtimeIdentityControl } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            appVersion: "1.13.4",
        });

        await runInNewContext(runner, context);
        const recorder = context.paRetrievalSmoke as SmokeRecorder;
        if (drift === "app-version") runtimeIdentityControl.setAppVersion("1.13.5");
        if (drift === "shell-version") {
            runtimeIdentityControl.setUserAgent(DESKTOP_RUNTIME_USER_AGENT.replace("1.12.7", "1.12.8"));
        }
        if (drift === "runtime-version") {
            ((context.process as { versions: { electron: string } }).versions).electron = "39.8.4";
        }
        if (drift === "plugin-version") runtimeIdentityControl.setPluginVersion("drifted");
        if (drift === "runner-artifact") runtimeIdentityControl.setRunnerArtifact(`${runner}\n// drift`);
        if (drift === "plugin-artifact") runtimeIdentityControl.setPluginArtifact("drifted-plugin");

        const receipt = await recorder.finalize() as unknown as {
            checks: Array<{ name: string; status: string }>;
        };
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
            status: "BLOCKED",
        }));
    });

    it.each(["missing", "invalid-source"] as const)(
        "blocks initialization when formal loaded-app identity is %s",
        async (runtimeIdentitySeam) => {
            const repositoryRoot = resolve(__dirname, "..");
            const { context, runner, writes } = createRunnerContext(repositoryRoot, {
                preflightReady: true,
                runtimeIdentitySeam,
            });

            await runInNewContext(runner, context);

            expect(context.paRetrievalSmoke).toBeUndefined();
            const receipt = JSON.parse(
                writes.get("retrieval-optimization-smoke-result.json") ?? "{}",
            ) as { overall?: string; checks?: Array<{ name: string; status: string }> };
            expect(receipt.overall).toBe("BLOCKED");
            expect(receipt.checks).toContainEqual(expect.objectContaining({
                name: "Exact Obsidian app, shell, runtime, and plugin identity is captured",
                status: "BLOCKED",
            }));
        },
    );

    it("blocks initialization when the UA shell identity is missing", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, writes } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            runtimeUserAgent: "Mozilla/5.0 AppleWebKit/537.36 Electron/39.8.3",
        });

        await runInNewContext(runner, context);

        expect(context.paRetrievalSmoke).toBeUndefined();
        const receipt = JSON.parse(
            writes.get("retrieval-optimization-smoke-result.json") ?? "{}",
        ) as { overall?: string; checks?: Array<{ name: string; status: string }> };
        expect(receipt.overall).toBe("BLOCKED");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Exact Obsidian app, shell, runtime, and plugin identity is captured",
            status: "BLOCKED",
        }));
    });

    it("fails initialization when a fixture does not match the canonical manifest", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, writes } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            tamperedFixture: "retrieval-smoke/graph/30-deep-target.md",
        });

        await runInNewContext(runner, context);

        expect(context.paRetrievalSmoke).toBeUndefined();
        const receipt = JSON.parse(writes.get("retrieval-optimization-smoke-result.json") ?? "{}") as {
            overall?: string;
            checks?: Array<{ name: string; status: string }>;
        };
        expect(receipt.overall).toBe("FAIL");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Synthetic fixture pack matches the canonical manifest",
            status: "FAIL",
        }));
    });

    it("fails initialization when the temporal fixture mtime drifted", async () => {
        const repositoryRoot = resolve(__dirname, "..");
        const { context, runner, writes } = createRunnerContext(repositoryRoot, {
            preflightReady: true,
            tamperedMtime: true,
        });

        await runInNewContext(runner, context);

        expect(context.paRetrievalSmoke).toBeUndefined();
        const receipt = JSON.parse(writes.get("retrieval-optimization-smoke-result.json") ?? "{}") as {
            overall?: string;
            checks?: Array<{ name: string; status: string }>;
        };
        expect(receipt.overall).toBe("FAIL");
        expect(receipt.checks).toContainEqual(expect.objectContaining({
            name: "Temporal fixture mtimes match the canonical manifest",
            status: "FAIL",
        }));
    });

    it("expands one unique 23/12/11/1 workload and persists only content-free bindings", async () => {
        const { recorder, diagnosticsControl, chatControl } = await createFrozenPerformanceHarness();
        const manifest = JSON.parse(readFileSync(
            resolve(__dirname, "../__fixtures__/retrieval-smoke/manifest.json"),
            "utf8",
        )) as Record<string, any>;

        expect(recorder.nextPerformanceWorkload).toMatchObject({
            id: "perf-std-warmup-01",
            stage: "standardPerformance",
            sampleClass: "warmup",
            sequence: 1,
            count: 47,
        });
        await completeValidPerformanceEnvelope(recorder, diagnosticsControl);
        expect(recorder.nextPerformanceWorkload).toMatchObject({
            id: "perf-cancel-probe-01",
            stage: "cancellationProbe",
            sampleClass: "probe",
            sequence: 47,
        });
        await recorder.beginCancellationProbe();
        const cancellationCursor: DiagnosticCursor = {
            sequence: 0,
            elapsedMs: 0,
            runId: nextPerformanceRunId("sequence-cancel"),
        };
        pushCancellationProbe(diagnosticsControl, cancellationCursor);
        setPerformanceTurn(
            chatControl,
            PERFORMANCE_CANCEL_PROMPT,
            cancellationCursor.runId!,
        );
        await recorder.recordPerformanceEpisode();

        const binding = (recorder.result.deviceMeasurement as unknown as {
            workloadBinding: {
                status: string;
                expectedEpisodeCount: number;
                boundEpisodeCount: number;
                violationCount: number;
                contractSha256: string;
                sequenceSha256: string;
                bindingSha256: string;
                stages: Record<string, { expectedCount: number; boundCount: number; status: string }>;
                episodes: Array<{ id: string; stage: string; sampleClass: string }>;
            };
        }).workloadBinding;
        expect(binding).toMatchObject({
            status: "PASS",
            expectedEpisodeCount: 47,
            boundEpisodeCount: 47,
            violationCount: 0,
            contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            sequenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            stages: {
                standardPerformance: { expectedCount: 23, boundCount: 23, status: "PASS" },
                retryPerformanceBatch1: { expectedCount: 12, boundCount: 12, status: "PASS" },
                retryPerformanceBatch2: { expectedCount: 11, boundCount: 11, status: "PASS" },
                cancellationProbe: { expectedCount: 1, boundCount: 1, status: "PASS" },
            },
        });
        expect(new Set(binding.episodes.map((entry) => entry.id)).size).toBe(47);
        expect(recorder.nextPerformanceWorkload).toBeNull();
        const serialized = JSON.stringify(binding);
        expect(serialized).not.toMatch(/prompt|path|source|text|runId/iu);
        expect(serialized).not.toContain(PERFORMANCE_STANDARD_PROMPT);
        expect(serialized).not.toContain(PERFORMANCE_WAVE2_TARGET_PATH);
        const receiptSerialized = JSON.stringify(recorder.result);
        expect(receiptSerialized).not.toContain(PERFORMANCE_STANDARD_PROMPT);
        expect(receiptSerialized).not.toContain(PERFORMANCE_RETRY_PROMPT);
        expect(receiptSerialized).not.toContain(PERFORMANCE_CANCEL_PROMPT);
        expect(receiptSerialized).not.toContain(PERFORMANCE_WAVE1_PATH);
        expect(receiptSerialized).not.toContain(PERFORMANCE_WAVE2_TARGET_PATH);
        expect(binding.contractSha256).not.toBe(createHash("sha256").update(
            canonicalJsonForTest(manifest.deviceMeasurementPlan.performanceWorkload),
        ).digest("hex"));
        expect(recorder.result.deviceMeasurement.planSha256).not.toBe(
            createHash("sha256").update(canonicalJsonForTest(
                manifest.deviceMeasurementPlan,
            )).digest("hex"),
        );
        await recorder.finalize();
    });

    it.each([
        "startRuntimeEnvelope",
        "stopRuntimeEnvelope",
        "beginRetryPerformance",
        "continueRetryPerformance",
        "beginCancellationProbe",
    ] as const)("rejects extra arguments to %s and permanently invalidates the workload", async (
        method,
    ) => {
        const { recorder } = await createFrozenPerformanceHarness();

        await expect(recorder[method]("unexpected")).rejects.toThrow("does not accept arguments");
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; violationCount: number };
        }).workloadBinding).toMatchObject({ status: "INVALID", violationCount: 1 });
        await recorder.finalize();
    });

    it("serializes concurrent envelope starts and makes the duplicate permanently invalid", async () => {
        const { recorder, diagnosticsControl } = await createFrozenPerformanceHarness();
        await qualifyPerformanceWorkload(recorder, diagnosticsControl);

        const attempts = await Promise.allSettled([
            recorder.startRuntimeEnvelope(),
            recorder.startRuntimeEnvelope(),
        ]);

        expect(attempts.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
        expect((attempts[1] as PromiseRejectedResult).reason).toEqual(
            expect.objectContaining({ message: expect.stringContaining("already started") }),
        );
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; violationCount: number };
        }).workloadBinding).toMatchObject({ status: "INVALID", violationCount: 1 });
        await recorder.finalize();
    });

    it("serializes concurrent envelope stops and makes the duplicate permanently invalid", async () => {
        const { recorder, diagnosticsControl } = await createFrozenPerformanceHarness();
        await qualifyPerformanceWorkload(recorder, diagnosticsControl);
        await recorder.startRuntimeEnvelope();
        let cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 23; index += 1) {
            await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor);
        }
        await recorder.beginRetryPerformance();
        cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 12; index += 1) {
            await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor, true);
        }
        await recorder.continueRetryPerformance();
        cursor = { sequence: 0, elapsedMs: 0 };
        for (let index = 0; index < 11; index += 1) {
            await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor, true);
        }

        const attempts = await Promise.allSettled([
            recorder.stopRuntimeEnvelope(),
            recorder.stopRuntimeEnvelope(),
        ]);

        expect(attempts.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
        expect((attempts[1] as PromiseRejectedResult).reason).toEqual(
            expect.objectContaining({ message: expect.stringContaining("not active") }),
        );
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; violationCount: number };
        }).workloadBinding).toMatchObject({ status: "INVALID", violationCount: 1 });
        await recorder.finalize();
    });

    it("makes qualification order violations permanently invalid", async () => {
        const { recorder } = await createFrozenPerformanceHarness();

        await expect(recorder.recordPerformanceQualification("retry"))
            .rejects.toThrow("standard then retry order");
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; qualification: { status: string; violationCount: number } };
        }).workloadBinding).toMatchObject({
            status: "INVALID",
            qualification: { status: "INVALID", violationCount: 1 },
        });
        await recorder.finalize();
    });

    it("rejects extra qualification arguments and permanently invalidates the workload", async () => {
        const { recorder } = await createFrozenPerformanceHarness();

        await expect(recorder.recordPerformanceQualification("standard", "extra"))
            .rejects.toThrow("accepts exactly one");
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; qualification: { status: string; violationCount: number } };
        }).workloadBinding).toMatchObject({
            status: "INVALID",
            qualification: { status: "INVALID", violationCount: 1 },
        });
        await recorder.finalize();
    });

    it("requires recordPerformanceEpisode to be called without arguments", async () => {
        const { recorder, diagnosticsControl } = await createFrozenPerformanceHarness();
        await qualifyPerformanceWorkload(recorder, diagnosticsControl);
        await recorder.startRuntimeEnvelope();

        await expect(recorder.recordPerformanceEpisode("extra"))
            .rejects.toThrow("does not accept prompt, run, source, or workload arguments");
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; violationCount: number };
        }).workloadBinding).toMatchObject({ status: "INVALID", violationCount: 1 });
        await recorder.finalize();
    });

    it("permanently rejects an envelope started before both qualifications pass", async () => {
        const { recorder, diagnosticsControl, chatControl } =
            await createFrozenPerformanceHarness();
        const cursor = rankingDiagnosticCursor(diagnosticsControl);
        cursor.runId = nextPerformanceRunId("qualification-standard-only");
        pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        setPerformanceTurn(chatControl, PERFORMANCE_STANDARD_PROMPT, cursor.runId);
        await recorder.recordPerformanceQualification("standard");

        await expect(recorder.startRuntimeEnvelope())
            .rejects.toThrow("Both frozen performance qualifications must pass");
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: {
                status: string;
                qualification: { status: string; violationCount: number };
            };
        }).workloadBinding).toMatchObject({
            status: "INVALID",
            qualification: { status: "INVALID", violationCount: 1 },
        });
        await recorder.finalize();
    });

    it.each(["wrong-prompt", "wrong-run", "replay"] as const)(
        "permanently invalidates a performance qualification on %s",
        async (violation) => {
            const { recorder, diagnosticsControl, chatControl } = await createFrozenPerformanceHarness();
            const cursor = rankingDiagnosticCursor(diagnosticsControl);
            const standardRunId = nextPerformanceRunId(`qualification-${violation}`);
            cursor.runId = standardRunId;
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
            setPerformanceTurn(
                chatControl,
                violation === "wrong-prompt" ? `${PERFORMANCE_STANDARD_PROMPT}错误` : PERFORMANCE_STANDARD_PROMPT,
                violation === "wrong-run" ? `${standardRunId}-other` : standardRunId,
            );
            if (violation !== "replay") {
                await expect(recorder.recordPerformanceQualification("standard")).rejects.toThrow();
            } else {
                await recorder.recordPerformanceQualification("standard");
                cursor.runId = standardRunId;
                pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, { retry: true });
                setPerformanceTurn(chatControl, PERFORMANCE_RETRY_PROMPT, standardRunId, true);
                await expect(recorder.recordPerformanceQualification("retry"))
                    .rejects.toThrow("already consumed");
            }
            expect((recorder.result.deviceMeasurement as unknown as {
                workloadBinding: { status: string; violationCount: number };
            }).workloadBinding).toMatchObject({ status: "INVALID", violationCount: 1 });
            await recorder.finalize();
        },
    );

    it("rejects a fresh canonical turn without its search_memory tool-call assistant", async () => {
        const { recorder, diagnosticsControl, chatControl } = await createFrozenPerformanceHarness();
        const cursor = rankingDiagnosticCursor(diagnosticsControl);
        cursor.runId = nextPerformanceRunId("qualification-missing-tool-call-assistant");
        pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        chatControl.setCanonicalTurn({
            prompt: PERFORMANCE_STANDARD_PROMPT,
            runId: cursor.runId,
            selectedPaths: [PERFORMANCE_WAVE1_PATH],
            omitToolCallAssistant: true,
        });

        await expect(recorder.recordPerformanceQualification("standard"))
            .rejects.toThrow("tool-call/result pair");
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string };
        }).workloadBinding.status).toBe("INVALID");
        await recorder.finalize();
    });

    it.each(["22", "24", "unbound", "batch-swap"] as const)(
        "permanently invalidates workload count/order violation %s",
        async (violation) => {
            const { recorder, diagnosticsControl, chatControl } = await createFrozenPerformanceHarness();
            await qualifyPerformanceWorkload(recorder, diagnosticsControl);
            await recorder.startRuntimeEnvelope();
            const cursor: DiagnosticCursor = { sequence: 0, elapsedMs: 0 };
            const boundStandardCount = violation === "22" ? 22 : 23;
            for (let index = 0; index < boundStandardCount; index += 1) {
                await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor);
            }
            if (violation === "24" || violation === "unbound") {
                cursor.runId = nextPerformanceRunId(`extra-${violation}`);
                pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
                setPerformanceTurn(chatControl, PERFORMANCE_STANDARD_PROMPT, cursor.runId);
            }
            if (violation === "24") {
                await expect(recorder.recordPerformanceEpisode()).rejects.toThrow("does not match");
            } else if (violation === "batch-swap") {
                await recorder.beginRetryPerformance();
                await expect(recorder.continueRetryPerformance()).rejects.toThrow("exactly its bound");
            } else {
                await expect(recorder.beginRetryPerformance()).rejects.toThrow("exactly its bound");
            }
            expect((recorder.result.deviceMeasurement as unknown as {
                workloadBinding: { status: string; violationCount: number };
            }).workloadBinding).toMatchObject({ status: "INVALID", violationCount: 1 });
            await recorder.finalize();
        },
    );

    it.each([
        "missing-graph",
        "a1-none",
        "projection-drops-a1",
        "a2-final-partial",
        "unrelated-source",
    ] as const)(
        "rejects retry qualification with %s evidence",
        async (violation) => {
            const { recorder, diagnosticsControl, chatControl } = await createFrozenPerformanceHarness();
            const cursor = rankingDiagnosticCursor(diagnosticsControl);
            cursor.runId = nextPerformanceRunId(`retry-shape-standard-${violation}`);
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
            setPerformanceTurn(chatControl, PERFORMANCE_STANDARD_PROMPT, cursor.runId);
            await recorder.recordPerformanceQualification("standard");

            cursor.runId = nextPerformanceRunId(`retry-shape-${violation}`);
            pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, {
                retry: true,
                graphViolation: violation === "missing-graph" ? "preflight-fallback" : undefined,
                standardDocumentCount: violation === "a1-none" ? 0 : undefined,
                projectionDocumentCount: violation === "projection-drops-a1" ? 1 : undefined,
            });
            setPerformanceTurn(chatControl, PERFORMANCE_RETRY_PROMPT, cursor.runId, true);
            if (violation === "a2-final-partial") {
                chatControl.setCanonicalTurn({
                    prompt: PERFORMANCE_RETRY_PROMPT,
                    runId: cursor.runId,
                    selectedPaths: [PERFORMANCE_WAVE1_PATH, PERFORMANCE_WAVE2_TARGET_PATH],
                    metadata: {
                        memoryEvidenceState: "partial",
                        rerankVerdict: "partially_relevant",
                        needsMoreEvidence: true,
                    },
                });
            } else if (violation === "unrelated-source") {
                chatControl.setCanonicalTurn({
                    prompt: PERFORMANCE_RETRY_PROMPT,
                    runId: cursor.runId,
                    selectedPaths: [
                        PERFORMANCE_WAVE1_PATH,
                        PERFORMANCE_WAVE2_TARGET_PATH,
                        "retrieval-smoke/graph/30-deep-target.md",
                    ],
                });
            }
            await expect(recorder.recordPerformanceQualification("retry")).rejects.toThrow();
            expect((recorder.result.deviceMeasurement as unknown as {
                workloadBinding: { status: string; qualification: { status: string } };
            }).workloadBinding).toMatchObject({
                status: "INVALID",
                qualification: { status: "INVALID" },
            });
            await recorder.finalize();
        },
    );

    it("rejects standard qualification whose final sources leave the performance fixture", async () => {
        const { recorder, diagnosticsControl, chatControl } = await createFrozenPerformanceHarness();
        const cursor = rankingDiagnosticCursor(diagnosticsControl);
        cursor.runId = nextPerformanceRunId("standard-unrelated-source");
        pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        chatControl.setCanonicalTurn({
            prompt: PERFORMANCE_STANDARD_PROMPT,
            runId: cursor.runId,
            selectedPaths: [PERFORMANCE_WAVE1_PATH, "retrieval-smoke/graph/30-deep-target.md"],
        });

        await expect(recorder.recordPerformanceQualification("standard")).rejects.toThrow();
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string };
        }).workloadBinding.status).toBe("INVALID");
        await recorder.finalize();
    });

    it("binds cancellation only to the exact cancel-v1 fresh Chat prompt", async () => {
        const { recorder, diagnosticsControl, chatControl } = await createFrozenPerformanceHarness();
        await completeValidPerformanceEnvelope(recorder, diagnosticsControl);
        await recorder.beginCancellationProbe();
        const cursor: DiagnosticCursor = {
            sequence: 0,
            elapsedMs: 0,
            runId: nextPerformanceRunId("cancel-wrong-prompt"),
        };
        pushCancellationProbe(diagnosticsControl, cursor);
        setPerformanceTurn(chatControl, `${PERFORMANCE_CANCEL_PROMPT}错误`, cursor.runId!);

        await expect(recorder.recordPerformanceEpisode()).rejects.toThrow();
        expect((recorder.result.deviceMeasurement as unknown as {
            workloadBinding: { status: string; stages: { cancellationProbe: { status: string } } };
        }).workloadBinding).toMatchObject({
            status: "INVALID",
            stages: { cancellationProbe: { status: "INVALID" } },
        });
        await recorder.finalize();
    });
});

function createRecoveryChatView(
    options: RecoveryCanonicalTurnOptions = {},
): Record<string, unknown> {
    const selectedPaths = options.selectedPathValues
        ?? options.selectedPaths
        ?? [RECOVERY_TARGET_PATH];
    const sourceRecordPaths = options.sourceRecordPathValues
        ?? options.sourceRecordPaths
        ?? selectedPaths;
    const allowedPaths = options.allowedPathValues
        ?? options.allowedPaths
        ?? selectedPaths;
    const visiblePaths = options.visiblePaths ?? [RECOVERY_TARGET_PATH];
    const successful = options.successfulToolResult ?? true;
    const selectedMemoryItems = Array.from(
        { length: options.selectedMemoryItemCount ?? 1 },
        () => ({
            category: "memory",
            label: "Selected Memory",
            sources: selectedPaths.map((path, index) => ({ path, chunkIndex: index })),
            citationEligible: true,
        }),
    );
    const toolResults = Array.from(
        { length: options.memoryToolResultCount ?? 1 },
        (_, index) => ({
            role: "toolResult",
            id: `tool-result-${index}`,
            toolCallId: `memory-call-${index}`,
            toolName: "search_memory",
            content: {
                promptText: "canonical projected Memory evidence",
                includeInNextPrompt: true,
                sourceRecords: sourceRecordPaths.map((path, sourceIndex) => ({
                    kind: "memory-reference",
                    dedupKey: `memory:${path}:${sourceIndex}`,
                    sourceBoundary: "memory",
                    path,
                    chunkIndex: sourceIndex,
                    citationEligible: true,
                })),
                contextUsed: selectedMemoryItems,
                metadata: {
                    outcome: successful ? "success" : "recoverable_error",
                    memoryEvidenceState: "evidence",
                    rerankVerdict: "relevant",
                    needsMoreEvidence: false,
                    ...options.metadata,
                },
            },
            isError: !successful,
            timestamp: 3,
        }),
    );
    const userMessage = {
        role: "user",
        content: options.prompt ?? RECOVERY_PROMPT,
    };
    const canonicalFinalAssistant = {
        role: "assistant",
        id: "canonical-assistant",
        content: [{ type: "text", text: "Recovery answer" }],
        timestamp: 4,
    };
    const canonicalToolCallAssistant = {
        role: "assistant",
        id: "canonical-tool-call-assistant",
        content: toolResults.map((toolResult) => ({
            type: "toolCall",
            id: toolResult.toolCallId,
            name: "search_memory",
            input: {},
        })),
        stopReason: "tool_calls",
        timestamp: 2,
    };
    const assistantMessage = {
        role: "assistant",
        content: visiblePaths.map((path) => `[[${path}]]`).join("\n"),
        memoryMetadata: {
            hasMemoryContent: allowedPaths.length > 0,
            allowedMemorySourcePaths: [...allowedPaths],
        },
        canonicalTurn: {
            schemaVersion: 1,
            runId: options.runId ?? DEFAULT_DIAGNOSTIC_RUN_ID,
            turnId: "turn-live-recovery",
            status: options.status ?? "completed",
            messages: [
                {
                    role: "user",
                    id: "canonical-user",
                    content: options.canonicalPrompt ?? options.prompt ?? RECOVERY_PROMPT,
                    timestamp: 1,
                },
                ...(options.omitToolCallAssistant ? [] : [canonicalToolCallAssistant]),
                ...toolResults,
                ...(options.omitFinalCanonicalAssistant ? [] : [canonicalFinalAssistant]),
            ],
        },
    };
    return {
        getViewType: (): string => "sidellm-view",
        isStreaming: options.streaming ?? false,
        chatHistory: [userMessage, assistantMessage],
    };
}

function createRunnerContext(
    repositoryRoot: string,
    options: {
        preflightReady?: boolean;
        tamperedFixture?: string;
        tamperedMtime?: boolean;
        rafIntervalMs?: number;
        longTaskDurations?: number[];
        diagnosticsSeam?: "ready" | "missing" | "start-error" | "stop-error" | "arm-error" | "arm-invalid";
        diagnosticsEvents?: Array<Record<string, unknown>>;
        diagnosticsDroppedEventCount?: number;
        diagnosticsCapacity?: number;
        runtimeDatabaseSamples?: number[];
        runtimeProcessMemorySamplesKiB?: number[];
        runtimeProcessMemoryUnavailable?: boolean;
        runtimeStallDelays?: number[];
        runtimeUserAgent?: string;
        runtimePlatform?: string;
        runtimeMaxTouchPoints?: number;
        runtimeLocationHref?: string;
        runtimeElectronProcess?: boolean;
        appVersion?: string;
        pluginVersion?: string;
        runtimeIdentitySeam?: "ready" | "missing" | "invalid-source";
        loadedBuildIdentitySeam?: "ready" | "missing" | "blocked" | "invalid";
        loadedPluginArtifactSha256?: string | null;
        excludedTags?: string[];
        generatedNotePolicy?: string;
        pageletEvidenceSeam?: "ready" | "missing";
    } = {},
): {
    context: Record<string, unknown>;
    runner: string;
    writes: Map<string, string>;
    writeControl: SmokeWriteControl;
    diagnosticsControl: SmokeDiagnosticsControl;
    chatControl: SmokeChatControl;
    pageletControl: SmokePageletControl;
    externalMemoryArtifactControl: SmokeExternalMemoryArtifactControl;
    vaultEventControl: SmokeVaultEventControl;
    runtimeIdentityControl: SmokeRuntimeIdentityControl;
    settingsControl: SmokeSettingsControl;
} {
    const runner = readFileSync(
        join(repositoryRoot, "scripts/retrieval-optimization-smoke-runner.js"),
        "utf8",
    );
    const manifest = readFileSync(
        join(repositoryRoot, "__fixtures__/retrieval-smoke/manifest.json"),
        "utf8",
    );
    const manifestData = JSON.parse(manifest) as {
        temporalFixtureMtimes: Record<string, string>;
    };
    const fixtureRoot = join(repositoryRoot, "__fixtures__/retrieval-smoke/vault");
    const writes = new Map<string, string>();
    let deferredResultWriteCountdown: number | null = null;
    let deferredStarted = Promise.resolve();
    let resolveDeferredStarted: (() => void) | null = null;
    let deferredRelease = Promise.resolve();
    let resolveDeferredRelease: (() => void) | null = null;
    let failDeferredResultWrite = false;
    const scheduleDeferredResultWrite = (skippedWrites: number): void => {
        deferredResultWriteCountdown = skippedWrites;
        deferredStarted = new Promise<void>((resolveStarted) => {
            resolveDeferredStarted = resolveStarted;
        });
        deferredRelease = new Promise<void>((resolveRelease) => {
            resolveDeferredRelease = resolveRelease;
        });
    };
    const writeControl: SmokeWriteControl = {
        deferNextResultWrite: (): void => {
            scheduleDeferredResultWrite(0);
        },
        deferResultWriteAfter: (skippedWrites): void => scheduleDeferredResultWrite(skippedWrites),
        waitUntilDeferred: async (): Promise<void> => deferredStarted,
        releaseDeferred: (): void => {
            resolveDeferredRelease?.();
            resolveDeferredRelease = null;
        },
        failDeferredResultWrite: (): void => {
            failDeferredResultWrite = true;
            resolveDeferredRelease?.();
            resolveDeferredRelease = null;
        },
    };
    const flags = options.preflightReady
        ? { lexicalProfile: true, strictReranker: true, graphPpr: true, relaxedRecovery: true }
        : {};
    const excludedFolders = options.preflightReady ? ["retrieval-smoke/excluded"] : [];
    let rafTimestamp = 0;
    let runtimeSampleIndex = 0;
    let runtimeStallIndex = 0;
    let diagnosticsActive = false;
    let diagnosticsStartCalls = 0;
    let diagnosticsGetCalls = 0;
    let diagnosticsStopCalls = 0;
    let diagnosticsArmCalls = 0;
    let cancellationProbeArmed = false;
    let deferNextDiagnosticsCapture = false;
    let deferredDiagnosticsCaptureStarted = Promise.resolve();
    let resolveDeferredDiagnosticsCaptureStarted: (() => void) | null = null;
    let deferredDiagnosticsCaptureRelease = Promise.resolve();
    let resolveDeferredDiagnosticsCaptureRelease: (() => void) | null = null;
    const initialDiagnosticEvents = (options.diagnosticsEvents ?? []).map((event) => ({ ...event }));
    let externalMemoryArtifactBytes: Uint8Array | null = null;
    let externalMemoryRawExportBytes: Uint8Array | null = null;
    let pendingArtifactReplacement: Uint8Array | null | undefined;
    let pendingRawExportReplacement: Uint8Array | null | undefined;
    const vaultEventListeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const vaultEventRefs = new Set<{ event: string; callback: (...args: unknown[]) => void }>();
    let scheduledVaultEvent: {
        remainingReads: number;
        event: "create" | "modify" | "delete" | "rename";
        path: string;
        oldPath?: string;
    } | null = null;
    const emitVaultEvent = (event: string, ...args: unknown[]): void => {
        for (const callback of vaultEventListeners.get(event) ?? []) callback(...args);
    };
    const vaultEventControl: SmokeVaultEventControl = {
        get listenerCount(): number {
            return vaultEventRefs.size;
        },
        emitCreate: (path): void => emitVaultEvent("create", { path }),
        emitModify: (path): void => emitVaultEvent("modify", { path }),
        emitDelete: (path): void => emitVaultEvent("delete", { path }),
        emitRename: (oldPath, newPath): void => emitVaultEvent("rename", { path: newPath }, oldPath),
        emitAfterExternalBinaryReads: (count, event, path, oldPath): void => {
            scheduledVaultEvent = { remainingReads: count, event, path, oldPath };
        },
    };
    const completeExternalBinaryRead = (): void => {
        if (!scheduledVaultEvent) return;
        scheduledVaultEvent.remainingReads -= 1;
        if (scheduledVaultEvent.remainingReads > 0) return;
        const { event, path, oldPath } = scheduledVaultEvent;
        scheduledVaultEvent = null;
        queueMicrotask(() => {
            if (event === "rename") {
                emitVaultEvent(event, { path }, oldPath ?? "unrelated-old-path");
            } else {
                emitVaultEvent(event, { path });
            }
        });
    };
    let pageletSnapshot: Record<string, unknown> | null = null;
    let pageletSequence = 0;
    let currentRunnerArtifact = runner;
    let currentPluginArtifact = "test-plugin-artifact";
    const pluginArtifactAtLoad = currentPluginArtifact;
    const pluginVersionAtLoad = options.pluginVersion ?? "test";
    let loadedBuildIdentityCalls = 0;
    const currentLoadedPluginArtifactSha256 = options.loadedPluginArtifactSha256 === undefined
        ? createHash("sha256").update(pluginArtifactAtLoad).digest("hex")
        : options.loadedPluginArtifactSha256;
    let currentLoadedAppVersion = options.appVersion ?? "test";
    const externalMemoryArtifactControl: SmokeExternalMemoryArtifactControl = {
        setArtifact: (artifact): void => {
            pendingArtifactReplacement = undefined;
            externalMemoryArtifactBytes = artifact
                ? new TextEncoder().encode(JSON.stringify(artifact))
                : null;
        },
        setArtifactBytes: (bytes): void => {
            pendingArtifactReplacement = undefined;
            externalMemoryArtifactBytes = bytes ? Uint8Array.from(bytes) : null;
        },
        replaceArtifactAfterNextRead: (artifact): void => {
            pendingArtifactReplacement = artifact
                ? new TextEncoder().encode(JSON.stringify(artifact))
                : null;
        },
        setRawExport: (rawExport): void => {
            pendingRawExportReplacement = undefined;
            externalMemoryRawExportBytes = rawExport === null
                ? null
                : new TextEncoder().encode(rawExport);
        },
        setRawExportBytes: (bytes): void => {
            pendingRawExportReplacement = undefined;
            externalMemoryRawExportBytes = bytes ? Uint8Array.from(bytes) : null;
        },
        replaceRawExportAfterNextRead: (rawExport): void => {
            pendingRawExportReplacement = rawExport === null
                ? null
                : new TextEncoder().encode(rawExport);
        },
    };
    const pageletControl: SmokePageletControl = {
        setCase: (id, overrides = {}): Record<string, unknown> => {
            pageletSequence += 1;
            pageletSnapshot = createPageletSmokeSnapshot(id, pageletSequence, overrides);
            return pageletSnapshot;
        },
        setSnapshot: (snapshot): void => {
            pageletSnapshot = snapshot;
        },
        clearSnapshot: (): void => {
            pageletSnapshot = null;
        },
    };
    let activeDiagnosticEvents: Array<Record<string, unknown>> = [];
    let activeDiagnosticsSessionId = "";
    let activeDiagnosticsStartedAt = "";
    const retrievalDiagnosticsController = {
        recordFor: (
            _active: unknown,
            _surface: unknown,
            event: Record<string, unknown>,
        ): void => {
            activeDiagnosticEvents.push({ ...event });
        },
    };
    const diagnosticsControl: SmokeDiagnosticsControl = {
        get startCalls(): number {
            return diagnosticsStartCalls;
        },
        get getCalls(): number {
            return diagnosticsGetCalls;
        },
        get stopCalls(): number {
            return diagnosticsStopCalls;
        },
        get armCalls(): number {
            return diagnosticsArmCalls;
        },
        pushEvent: (event): void => {
            retrievalDiagnosticsController.recordFor(null, "chat", event);
        },
        deferNextCapture: (): void => {
            deferNextDiagnosticsCapture = true;
            deferredDiagnosticsCaptureStarted = new Promise<void>((resolveStarted) => {
                resolveDeferredDiagnosticsCaptureStarted = resolveStarted;
            });
            deferredDiagnosticsCaptureRelease = new Promise<void>((resolveRelease) => {
                resolveDeferredDiagnosticsCaptureRelease = resolveRelease;
            });
        },
        waitUntilCaptureDeferred: async (): Promise<void> => deferredDiagnosticsCaptureStarted,
        releaseCapture: (): void => {
            resolveDeferredDiagnosticsCaptureRelease?.();
            resolveDeferredDiagnosticsCaptureRelease = null;
        },
        waitForGetCalls: async (count): Promise<void> => {
            while (diagnosticsGetCalls < count) await Promise.resolve();
        },
    };
    const recoveryViews: Array<Record<string, unknown>> = [createRecoveryChatView()];
    const chatControl: SmokeChatControl = {
        setRecoveryTurn: (turnOptions = {}): void => {
            recoveryViews.splice(0, recoveryViews.length, createRecoveryChatView(turnOptions));
        },
        setRecoveryViews: (viewOptions): void => {
            recoveryViews.splice(
                0,
                recoveryViews.length,
                ...viewOptions.map((turnOptions) => createRecoveryChatView(turnOptions)),
            );
        },
        clearRecoveryViews: (): void => {
            recoveryViews.splice(0, recoveryViews.length);
        },
        setCanonicalTurn: (turnOptions): void => {
            recoveryViews.splice(0, recoveryViews.length, createRecoveryChatView(turnOptions));
        },
    };
    diagnosticsChatControls.set(diagnosticsControl, chatControl);
    const diagnosticsSnapshotForContext = (finishedAt: string | null): Record<string, unknown> => ({
        schemaVersion: 1,
        sessionId: activeDiagnosticsSessionId,
        startedAt: activeDiagnosticsStartedAt,
        finishedAt,
        capacity: options.diagnosticsCapacity ?? 512,
        droppedEventCount: options.diagnosticsDroppedEventCount ?? 0,
        events: activeDiagnosticEvents.map((event) => ({ ...event })),
    });
    const plugin: Record<string, unknown> = {
        manifest: { id: "personal-assistant", version: pluginVersionAtLoad },
        memoryManager: {},
        settings: {
            retrievalOptimizationFlags: flags,
            dataBoundary: {
                excludedFolders,
                excludedTags: [...(options.excludedTags ?? [])],
                generatedNotePolicy: options.generatedNotePolicy ?? "exclude-generated",
            },
            chatModelName: options.preflightReady ? "test-chat" : "",
            policyModelName: "",
        },
        vss: {
            getMemoryStatusSnapshot: (): Record<string, unknown> => ({
                status: "ready",
                indexedDocumentCount: 16,
                lexicalProfileState: "ready",
            }),
            getStats: (): Record<string, number> => ({
                estimatedDbBytes: (options.runtimeDatabaseSamples ?? [0]).at(
                    Math.min(runtimeSampleIndex, (options.runtimeDatabaseSamples ?? [0]).length - 1),
                ) ?? 0,
            }),
        },
        retrievalDiagnostics: retrievalDiagnosticsController,
    };
    if ((options.pageletEvidenceSeam ?? "ready") !== "missing") {
        plugin.getPageletDeepDiscoverSmokeSnapshot = async (): Promise<Record<string, unknown> | null> => (
            pageletSnapshot ? structuredClone(pageletSnapshot) : null
        );
    }
    const settingsListeners = new Set<() => void | Promise<void>>();
    plugin.onSettingsChanged = (listener: () => void | Promise<void>): (() => void) => {
        settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
    };
    const settingsControl: SmokeSettingsControl = {
        get listenerCount(): number {
            return settingsListeners.size;
        },
        notifySettingsChanged: async (): Promise<void> => {
            await Promise.allSettled(
                [...settingsListeners].map((listener) => Promise.resolve().then(listener)),
            );
        },
    };
    if ((options.runtimeIdentitySeam ?? "ready") !== "missing") {
        plugin.getObsidianRuntimeIdentity = (): Record<string, string> => ({
            loadedAppVersion: currentLoadedAppVersion,
            loadedAppVersionSource: options.runtimeIdentitySeam === "invalid-source"
                ? "app.version"
                : "obsidian.apiVersion",
        });
    }
    if ((options.loadedBuildIdentitySeam ?? "ready") !== "missing") {
        plugin.getLoadedPluginBuildIdentity = async (): Promise<Record<string, unknown>> => {
            loadedBuildIdentityCalls += 1;
            return {
                schemaVersion: options.loadedBuildIdentitySeam === "invalid" ? 2 : 1,
                pluginId: "personal-assistant",
                pluginVersion: pluginVersionAtLoad,
                pluginArtifactPath: ".obsidian/plugins/personal-assistant/main.js",
                loadedPluginArtifactSha256: currentLoadedPluginArtifactSha256,
                lexicalProfileRuntimeFingerprint: "char-phrase-v1:test-runtime",
                capturedAtPluginLoad: "2026-08-09T00:00:00.000Z",
                identitySource: "plugin-onload-cached-main-js",
                blocker: options.loadedBuildIdentitySeam === "blocked"
                    ? "loaded_plugin_artifact_unavailable"
                    : null,
            };
        };
    }
    if ((options.diagnosticsSeam ?? "ready") !== "missing") {
        plugin.startRetrievalDiagnostics = (): Record<string, unknown> => {
            diagnosticsStartCalls += 1;
            if (options.diagnosticsSeam === "start-error") throw new Error("start failed");
            if (diagnosticsActive) throw new Error("duplicate diagnostics session");
            diagnosticsActive = true;
            cancellationProbeArmed = false;
            activeDiagnosticsSessionId = `session-sensitive-${diagnosticsStartCalls}`;
            activeDiagnosticsStartedAt = `2026-08-09T00:00:0${diagnosticsStartCalls}.000Z`;
            activeDiagnosticEvents = diagnosticsStartCalls === 1
                ? initialDiagnosticEvents.map((event) => ({ ...event }))
                : [];
            return {
                schemaVersion: 1,
                sessionId: activeDiagnosticsSessionId,
                startedAt: activeDiagnosticsStartedAt,
                capacity: options.diagnosticsCapacity ?? 512,
            };
        };
        plugin.getRetrievalDiagnostics = async (): Promise<Record<string, unknown>> => {
            diagnosticsGetCalls += 1;
            if (!diagnosticsActive) throw new Error("diagnostics unavailable");
            if (deferNextDiagnosticsCapture) {
                deferNextDiagnosticsCapture = false;
                resolveDeferredDiagnosticsCaptureStarted?.();
                resolveDeferredDiagnosticsCaptureStarted = null;
                await deferredDiagnosticsCaptureRelease;
            }
            return diagnosticsSnapshotForContext(null);
        };
        plugin.stopRetrievalDiagnostics = (): Record<string, unknown> => {
            diagnosticsStopCalls += 1;
            if (options.diagnosticsSeam === "stop-error") throw new Error("stop failed");
            if (!diagnosticsActive) throw new Error("diagnostics unavailable");
            diagnosticsActive = false;
            cancellationProbeArmed = false;
            return diagnosticsSnapshotForContext("2026-08-09T00:01:00.000Z");
        };
        plugin.armRetrievalCancellationProbe = (sessionId: string): Record<string, unknown> => {
            diagnosticsArmCalls += 1;
            if (options.diagnosticsSeam === "arm-error") throw new Error("arm failed");
            if (!diagnosticsActive || sessionId !== activeDiagnosticsSessionId) {
                throw new Error("diagnostics unavailable");
            }
            if (cancellationProbeArmed) throw new Error("cancellation probe already armed");
            cancellationProbeArmed = true;
            return Object.freeze(options.diagnosticsSeam === "arm-invalid"
                ? { sessionId: "wrong-session", armed: true }
                : { sessionId, armed: true });
        };
    }
    const performanceForContext: Record<string, unknown> = {
        now: (): number => rafTimestamp,
    };
    const context: Record<string, unknown> = {
        app: {
            plugins: {
                plugins: {
                    "personal-assistant": plugin,
                },
            },
            vault: {
                configDir: ".obsidian",
                on: (event: string, callback: (...args: unknown[]) => void): Record<string, unknown> => {
                    const eventRef = { event, callback };
                    const listeners = vaultEventListeners.get(event) ?? new Set();
                    listeners.add(callback);
                    vaultEventListeners.set(event, listeners);
                    vaultEventRefs.add(eventRef);
                    return eventRef;
                },
                offref: (eventRef: { event: string; callback: (...args: unknown[]) => void }): void => {
                    vaultEventListeners.get(eventRef.event)?.delete(eventRef.callback);
                    vaultEventRefs.delete(eventRef);
                },
                getAbstractFileByPath: (path: string): { stat: { mtime: number } } => ({
                    stat: {
                        mtime: options.tamperedMtime
                            && path === "retrieval-smoke/temporal/60-old-note.md"
                            ? Date.parse("2026-08-09T00:00:00.000Z")
                            : Date.parse(manifestData.temporalFixtureMtimes[path]),
                    },
                }),
                adapter: {
                    read: async (path: string): Promise<string> => {
                        if (path === "retrieval-optimization-smoke-manifest.json") return manifest;
                        if (path === "retrieval-optimization-smoke-runner.js") return currentRunnerArtifact;
                        if (path === ".obsidian/plugins/personal-assistant/main.js") return currentPluginArtifact;
                        if (path === "retrieval-smoke/evidence/system-memory-envelope.json") {
                            if (!externalMemoryArtifactBytes) throw new Error("external artifact unavailable");
                            return new TextDecoder().decode(externalMemoryArtifactBytes);
                        }
                        if (path === IOS_MEMORY_RAW_EXPORT_PATH) {
                            if (!externalMemoryRawExportBytes) {
                                throw new Error("external raw export unavailable");
                            }
                            return new TextDecoder().decode(externalMemoryRawExportBytes);
                        }
                        if (path === options.tamperedFixture) return "tampered fixture";
                        return readFileSync(join(fixtureRoot, path), "utf8");
                    },
                    readBinary: async (path: string): Promise<ArrayBuffer> => {
                        if (path === "retrieval-smoke/evidence/system-memory-envelope.json") {
                            if (!externalMemoryArtifactBytes) throw new Error("external artifact unavailable");
                            const bytes = Uint8Array.from(externalMemoryArtifactBytes);
                            if (pendingArtifactReplacement !== undefined) {
                                externalMemoryArtifactBytes = pendingArtifactReplacement;
                                pendingArtifactReplacement = undefined;
                            }
                            completeExternalBinaryRead();
                            return bytes.buffer;
                        }
                        if (path === IOS_MEMORY_RAW_EXPORT_PATH) {
                            if (!externalMemoryRawExportBytes) {
                                throw new Error("external raw export unavailable");
                            }
                            const bytes = Uint8Array.from(externalMemoryRawExportBytes);
                            if (pendingRawExportReplacement !== undefined) {
                                externalMemoryRawExportBytes = pendingRawExportReplacement;
                                pendingRawExportReplacement = undefined;
                            }
                            completeExternalBinaryRead();
                            return bytes.buffer;
                        }
                        return Uint8Array.from(readFileSync(join(fixtureRoot, path))).buffer;
                    },
                    exists: async (path: string): Promise<boolean> => {
                        if (path === "retrieval-smoke/evidence/system-memory-envelope.json") {
                            return externalMemoryArtifactBytes !== null;
                        }
                        if (path === IOS_MEMORY_RAW_EXPORT_PATH) {
                            return externalMemoryRawExportBytes !== null;
                        }
                        return existsSync(join(fixtureRoot, path));
                    },
                    write: async (path: string, value: string): Promise<void> => {
                        if (path === "retrieval-optimization-smoke-result.json"
                            && deferredResultWriteCountdown !== null
                            && deferredResultWriteCountdown > 0) {
                            deferredResultWriteCountdown -= 1;
                        } else if (path === "retrieval-optimization-smoke-result.json"
                            && deferredResultWriteCountdown === 0) {
                            deferredResultWriteCountdown = null;
                            resolveDeferredStarted?.();
                            resolveDeferredStarted = null;
                            await deferredRelease;
                            if (failDeferredResultWrite) {
                                failDeferredResultWrite = false;
                                throw new Error("forced final result write failure");
                            }
                        }
                        writes.set(path, value);
                    },
                },
            },
            metadataCache: {
                resolvedLinks: {
                    "retrieval-smoke/graph/10-seed-a.md": {
                        "retrieval-smoke/excluded/20-opaque-bridge.md": 1,
                    },
                    "retrieval-smoke/excluded/20-opaque-bridge.md": {
                        "retrieval-smoke/graph/30-deep-target.md": 1,
                    },
                },
            },
            workspace: {
                getLeavesOfType: (viewType: string): Array<{ view: Record<string, unknown> }> => (
                    viewType === "sidellm-view"
                        ? recoveryViews.map((view) => ({ view }))
                        : []
                ),
            },
        },
        console: {
            log: (): void => undefined,
            table: (): void => undefined,
            warn: (): void => undefined,
        },
        crypto: webcrypto,
        document: { body: { innerText: "", textContent: "" } },
        navigator: {
            userAgent: options.runtimeUserAgent ?? DESKTOP_RUNTIME_USER_AGENT,
            platform: options.runtimePlatform ?? (
                /(?:iPhone|iPod)/u.test(options.runtimeUserAgent ?? DESKTOP_RUNTIME_USER_AGENT)
                    ? "iPhone"
                    : /iPad/u.test(options.runtimeUserAgent ?? DESKTOP_RUNTIME_USER_AGENT)
                        ? "iPad"
                        : "MacIntel"
            ),
            maxTouchPoints: options.runtimeMaxTouchPoints ?? (
                /(?:iPhone|iPad|iPod)|(?:Macintosh.*Mobile)/u.test(
                    options.runtimeUserAgent ?? DESKTOP_RUNTIME_USER_AGENT,
                ) ? 5 : 0
            ),
        },
        location: {
            href: options.runtimeLocationHref ?? (
                /(?:iPhone|iPad|iPod)|(?:Macintosh.*Mobile)/u.test(
                    options.runtimeUserAgent ?? DESKTOP_RUNTIME_USER_AGENT,
                ) ? "capacitor://localhost" : "app://obsidian.md/index.html"
            ),
        },
        performance: performanceForContext,
        setTimeout: (callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]): unknown => {
            if (delay === 1_000) {
                return setTimeout(() => {
                    runtimeSampleIndex += 1;
                    callback(...args);
                }, 0);
            }
            if (delay === 50) {
                return setTimeout(() => {
                    const delays = options.runtimeStallDelays ?? [0];
                    const stall = delays.at(Math.min(runtimeStallIndex, delays.length - 1)) ?? 0;
                    rafTimestamp += delay + stall;
                    runtimeStallIndex += 1;
                    callback(...args);
                }, 0);
            }
            return setTimeout(callback, delay, ...args);
        },
        TextDecoder,
        TextEncoder,
    };
    activeRunnerContexts.push(context);
    const isIosRuntime = /(?:iPhone|iPad|iPod)|(?:Macintosh.*Mobile)/u.test(
        String((context.navigator as { userAgent: string }).userAgent),
    );
    if (!isIosRuntime || options.runtimeElectronProcess) {
        const processIdentity: Record<string, unknown> = {
            type: "renderer",
            platform: "darwin",
            arch: "arm64",
            versions: {
                electron: "39.8.3",
                chrome: "142.0.7444.235",
                node: "22.21.1",
            },
        };
        if (!options.runtimeProcessMemoryUnavailable) {
            processIdentity.getProcessMemoryInfo = async (): Promise<Record<string, number>> => {
                const samples = options.runtimeProcessMemorySamplesKiB ?? [0];
                return {
                    residentSet: samples.at(Math.min(runtimeSampleIndex, samples.length - 1)) ?? 0,
                };
            };
        }
        context.process = processIdentity;
    }
    if (options.rafIntervalMs !== undefined) {
        context.requestAnimationFrame = (callback: (timestamp: number) => void): number => {
            rafTimestamp += options.rafIntervalMs!;
            queueMicrotask(() => callback(rafTimestamp));
            return rafTimestamp;
        };
    }
    if (options.longTaskDurations) {
        const durations = [...options.longTaskDurations];
        context.PerformanceObserver = class {
            static supportedEntryTypes = ["longtask"];
            private readonly callback: (list: { getEntries(): Array<{ duration: number }> }) => void;

            constructor(callback: (list: { getEntries(): Array<{ duration: number }> }) => void) {
                this.callback = callback;
            }

            observe(): void {
                this.callback({ getEntries: () => durations.map((duration) => ({ duration })) });
            }

            disconnect(): void {}
        };
    }
    const runtimeIdentityControl: SmokeRuntimeIdentityControl = {
        get loadedBuildIdentityCalls(): number {
            return loadedBuildIdentityCalls;
        },
        setAppVersion: (version): void => {
            currentLoadedAppVersion = version;
        },
        setPluginVersion: (version): void => {
            (plugin.manifest as Record<string, unknown>).version = version;
        },
        setUserAgent: (userAgent): void => {
            (context.navigator as Record<string, unknown>).userAgent = userAgent;
        },
        setRunnerArtifact: (source): void => {
            currentRunnerArtifact = source;
        },
        setPluginArtifact: (source): void => {
            currentPluginArtifact = source;
        },
        reloadPluginWithArtifact: (source): void => {
            currentPluginArtifact = source;
            const registry = ((context.app as {
                plugins: { plugins: Record<string, Record<string, unknown>> };
            }).plugins.plugins);
            const previous = registry["personal-assistant"];
            const reloadedPlugin: Record<string, unknown> = {
                ...previous,
                manifest: { ...(previous.manifest as Record<string, unknown>) },
            };
            const reloadedArtifactSha256 = createHash("sha256").update(source).digest("hex");
            reloadedPlugin.getLoadedPluginBuildIdentity = async (): Promise<Record<string, unknown>> => {
                loadedBuildIdentityCalls += 1;
                return {
                    schemaVersion: 1,
                    pluginId: "personal-assistant",
                    pluginVersion: (reloadedPlugin.manifest as Record<string, unknown>).version,
                    pluginArtifactPath: ".obsidian/plugins/personal-assistant/main.js",
                    loadedPluginArtifactSha256: reloadedArtifactSha256,
                    lexicalProfileRuntimeFingerprint: "char-phrase-v1:reloaded-runtime",
                    capturedAtPluginLoad: "2026-08-09T00:02:00.000Z",
                    identitySource: "plugin-onload-cached-main-js",
                    blocker: null,
                };
            };
            registry["personal-assistant"] = reloadedPlugin;
        },
        restoreInitialPluginInstance: (): void => {
            const registry = ((context.app as {
                plugins: { plugins: Record<string, Record<string, unknown>> };
            }).plugins.plugins);
            registry["personal-assistant"] = plugin;
        },
    };
    return {
        context,
        runner,
        writes,
        writeControl,
        diagnosticsControl,
        chatControl,
        pageletControl,
        externalMemoryArtifactControl,
        vaultEventControl,
        runtimeIdentityControl,
        settingsControl,
    };
}

async function recordPassingManualCases(
    recorder: SmokeRecorder,
    diagnosticsControl: SmokeDiagnosticsControl,
    pageletControl: SmokePageletControl,
): Promise<void> {
    pushRecoveryCanaryEpisode(diagnosticsControl);
    await recorder.recordRecoveryCase();
    pageletControl.setCase("pagelet-0");
    await recorder.recordPageletCase("pagelet-0");
    pageletControl.setCase("pagelet-1");
    await recorder.recordPageletCase("pagelet-1");
    pageletControl.setCase("pagelet-2");
    await recorder.recordPageletCase("pagelet-2");
    for (const id of smokeCases) {
        if (!["chat-recovery", "temporal-retry"].includes(id) && !id.startsWith("pagelet-")) {
            await recorder.recordCase(id, "PASS");
        }
    }
}

function setCanonicalTemporalRetryTurn(
    chatControl: SmokeChatControl,
    selectedPaths: readonly string[] = [
        "retrieval-smoke/temporal-retry/112-relaxed-target.md",
    ],
    overrides: RecoveryCanonicalTurnOptions = {},
): void {
    chatControl.setCanonicalTurn({
        prompt: TEMPORAL_RETRY_PROMPT,
        selectedPaths,
        ...overrides,
    });
}

function setCanonicalRankingTurn(
    chatControl: SmokeChatControl,
    id: string,
    selectedPaths: readonly string[] = passingRankings[id],
    overrides: RecoveryCanonicalTurnOptions = {},
): void {
    chatControl.setCanonicalTurn({
        prompt: rankingPrompts[id],
        selectedPaths,
        ...overrides,
    });
}

const rankingDiagnosticCursors = new WeakMap<SmokeDiagnosticsControl, DiagnosticCursor>();

function rankingDiagnosticCursor(
    diagnosticsControl: SmokeDiagnosticsControl,
): DiagnosticCursor {
    const existing = rankingDiagnosticCursors.get(diagnosticsControl);
    if (existing) return existing;
    const created = { sequence: 0, elapsedMs: 0 };
    rankingDiagnosticCursors.set(diagnosticsControl, created);
    return created;
}

async function recordPassingRankings(
    recorder: SmokeRecorder,
    diagnosticsControl: SmokeDiagnosticsControl,
    chatControl: SmokeChatControl,
    includeTemporalRetry = true,
): Promise<void> {
    const cursor = rankingDiagnosticCursor(diagnosticsControl);
    if (includeTemporalRetry) {
        pushTemporalRetryCanaryEpisode(diagnosticsControl, cursor);
        setCanonicalTemporalRetryTurn(chatControl);
        await recorder.recordTemporalRetryCase();
    }
    for (const id of Object.keys(passingRankings)) {
        pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
        setCanonicalRankingTurn(chatControl, id);
        await recorder.recordRankingCase(id);
    }
}

function passingDevicePlanOverrides(): Record<string, unknown> {
    const thresholds = Object.fromEntries(requiredDeviceMetrics.map((id) => [
        id,
        [
            "retrieval.cancelRequestedCount",
            "retrieval.cancelObservedCount",
            "retrieval.lateDiscardCount",
        ].includes(id)
            ? { p95Min: 1 }
            : [
                "storage.peakEstimatedDbBytes",
                "memory.peakProcessFootprintBytes",
                "ui.maxEventLoopStallMs",
            ].includes(id)
                ? { maxMax: 100 }
                : [
                    "retrieval.finalizationReserveMs",
                    "retrieval.retryFinalizationReserveMs",
                ].includes(id) ? { minMin: 1 } : { p95Max: 200 },
    ]));
    return {
        thresholds,
        rerankerGate: { minimumMrr: 0 },
    };
}

async function freezePassingDevicePlan(recorder: SmokeRecorder): Promise<void> {
    await recorder.freezeDeviceMeasurementPlan(passingDevicePlanOverrides());
}

async function createFrozenPerformanceHarness(): Promise<{
    recorder: SmokeRecorder;
    diagnosticsControl: SmokeDiagnosticsControl;
    chatControl: SmokeChatControl;
}> {
    const repositoryRoot = resolve(__dirname, "..");
    const { context, runner, diagnosticsControl, chatControl } = createRunnerContext(
        repositoryRoot,
        { preflightReady: true },
    );
    await runInNewContext(runner, context);
    const recorder = context.paRetrievalSmoke as SmokeRecorder;
    await recorder.freezeDeviceMeasurementPlan();
    return { recorder, diagnosticsControl, chatControl };
}

let performanceRunSequence = 0;

function canonicalJsonForTest(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${canonicalJsonForTest(record[key])}`
    )).join(",")}}`;
}

function nextPerformanceRunId(label: string): string {
    performanceRunSequence += 1;
    return `performance-${label}-${performanceRunSequence}`;
}

function setPerformanceTurn(
    chatControl: SmokeChatControl,
    prompt: string,
    runId: string,
    retry = false,
): void {
    chatControl.setCanonicalTurn({
        prompt,
        runId,
        selectedPaths: retry
            ? [PERFORMANCE_WAVE1_PATH, PERFORMANCE_WAVE2_TARGET_PATH]
            : [PERFORMANCE_WAVE1_PATH],
    });
}

async function qualifyPerformanceWorkload(
    recorder: SmokeRecorder,
    diagnosticsControl: SmokeDiagnosticsControl,
): Promise<void> {
    const chatControl = diagnosticsChatControls.get(diagnosticsControl);
    if (!chatControl) throw new Error("missing Chat control for performance qualification");
    const cursor = rankingDiagnosticCursor(diagnosticsControl);

    cursor.runId = nextPerformanceRunId("qualification-standard");
    pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor);
    setPerformanceTurn(chatControl, PERFORMANCE_STANDARD_PROMPT, cursor.runId);
    await recorder.recordPerformanceQualification("standard");

    cursor.runId = nextPerformanceRunId("qualification-retry");
    pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, { retry: true });
    setPerformanceTurn(chatControl, PERFORMANCE_RETRY_PROMPT, cursor.runId, true);
    await recorder.recordPerformanceQualification("retry");
}

async function pushAndBindPerformanceEpisode(
    recorder: SmokeRecorder,
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    retry = false,
): Promise<void> {
    const next = recorder.nextPerformanceWorkload;
    const chatControl = diagnosticsChatControls.get(diagnosticsControl);
    if (!next || !chatControl) throw new Error("next performance workload is unavailable");
    cursor.runId = nextPerformanceRunId(next.id);
    pushSuccessfulPerformanceEpisode(diagnosticsControl, cursor, { retry });
    setPerformanceTurn(chatControl, next.prompt, cursor.runId, retry);
    await recorder.recordPerformanceEpisode();
}

async function recordPassingDeviceMetrics(
    recorder: SmokeRecorder,
    diagnosticsControl: SmokeDiagnosticsControl,
): Promise<void> {
    await freezePassingDevicePlan(recorder);
    await completeValidPerformanceEnvelope(recorder, diagnosticsControl);
    await recorder.beginCancellationProbe();
    const cancellationCursor = {
        sequence: 0,
        elapsedMs: 0,
        runId: nextPerformanceRunId("cancellation"),
    };
    pushCancellationProbe(diagnosticsControl, cancellationCursor);
    const chatControl = diagnosticsChatControls.get(diagnosticsControl);
    if (!chatControl) throw new Error("missing Chat control for cancellation binding");
    setPerformanceTurn(chatControl, PERFORMANCE_CANCEL_PROMPT, cancellationCursor.runId);
    await recorder.recordPerformanceEpisode();
    const manuallyRecorded = requiredDeviceMetrics.filter((id) => ![
        "retrieval.totalDurationMs",
        "retrieval.graphDurationMs",
        "retrieval.retryTotalDurationMs",
        "retrieval.retryGraphDurationMs",
        "retrieval.retryGraphWorkerQueueWaitMs",
        "retrieval.retryGraphWorkerMaxBatchDurationMs",
        "retrieval.graphWorkerQueueWaitMs",
        "retrieval.graphWorkerMaxBatchDurationMs",
        "retrieval.finalizationReserveMs",
        "retrieval.retryFinalizationReserveMs",
        "retrieval.deadlineExceededCount",
        "retrieval.cancelRequestedCount",
        "retrieval.cancelObservedCount",
        "retrieval.acceptedAfterCancelCount",
        "retrieval.lateDiscardCount",
        "storage.peakEstimatedDbBytes",
        "memory.peakProcessFootprintBytes",
        "ui.maxEventLoopStallMs",
    ].includes(id));
    for (const id of manuallyRecorded) {
        const snapshot = id.startsWith("storage.") || id.startsWith("memory.")
            || id.endsWith("Count");
        await recorder.recordDeviceMetric(id, {
            method: id.startsWith("storage.") ? "estimated" : "measured",
            samples: snapshot ? [0] : Array.from({ length: 23 }, () => id === "ui.eventLoopGapMs" ? 1 : 0),
        });
    }
}

async function beginValidCancellationProbe(
    recorder: SmokeRecorder,
    diagnosticsControl: SmokeDiagnosticsControl,
): Promise<void> {
    await completeValidPerformanceEnvelope(recorder, diagnosticsControl);
    await recorder.beginCancellationProbe();
}

async function completeValidPerformanceEnvelope(
    recorder: SmokeRecorder,
    diagnosticsControl: SmokeDiagnosticsControl,
): Promise<Awaited<ReturnType<SmokeRecorder["stopRuntimeEnvelope"]>>> {
    await qualifyPerformanceWorkload(recorder, diagnosticsControl);
    await recorder.startRuntimeEnvelope();
    let cursor = { sequence: 0, elapsedMs: 0 };
    for (let index = 0; index < 23; index += 1) {
        await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor);
    }
    await recorder.beginRetryPerformance();
    cursor = { sequence: 0, elapsedMs: 0 };
    for (let index = 0; index < 12; index += 1) {
        await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor, true);
    }
    await recorder.continueRetryPerformance();
    cursor = { sequence: 0, elapsedMs: 0 };
    for (let index = 0; index < 11; index += 1) {
        await pushAndBindPerformanceEpisode(recorder, diagnosticsControl, cursor, true);
    }
    return recorder.stopRuntimeEnvelope();
}

function diagnosticEvent(
    sequence: number,
    phase: string,
    outcome: string,
    reason?: string,
    metrics: Record<string, number> = {},
    elapsedMs = sequence,
    surface: "chat" | "pagelet" = "chat",
    runId = DEFAULT_DIAGNOSTIC_RUN_ID,
): Record<string, unknown> {
    return {
        sequence,
        elapsedMs,
        runId,
        surface,
        phase,
        outcome,
        ...(reason ? { reason } : {}),
        metrics,
    };
}

interface DiagnosticCursor {
    sequence: number;
    elapsedMs: number;
    runId?: string;
}

interface RecoveryCanaryTopology {
    retry?: boolean;
    doubleRetry?: boolean;
    omitProjection?: boolean;
    standardMemoryDocumentCount?: number;
    standardTerminalDocumentCount?: number;
    relaxedMemoryDocumentCount?: number;
    relaxedTerminalDocumentCount?: number;
    projectionDocumentCount?: number;
    relaxedFailure?: boolean;
    standardTemporalFilterApplied?: number;
    standardTemporalViolationCount?: number;
    relaxedTemporalFilterApplied?: number;
    relaxedTemporalViolationCount?: number;
    projectionTemporalFilterApplied?: number;
    projectionTemporalViolationCount?: number;
    standardMemoryOutcome?: "completed" | "failed" | "aborted" | "deadline";
    standardMemoryReason?: string | null;
    standardTerminalOutcome?: "completed" | "failed" | "aborted" | "deadline";
    standardTerminalReason?: string | null;
    relaxedMemoryFailureReason?: string;
    relaxedStageFailureReason?: string;
    relaxedFailureOutcome?: "failed" | "aborted" | "deadline";
}

const DESKTOP_RUNTIME_USER_AGENT =
    "Mozilla/5.0 AppleWebKit/537.36 obsidian/1.12.7 Chrome/142.0.7444.235 Electron/39.8.3";
const IOS_RUNTIME_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 obsidian/1.12.7";
const IOS_PLAIN_OBSIDIAN_RUNTIME_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148  obsidian";
const IOS_MEMORY_RAW_EXPORT_PATH =
    "retrieval-smoke/evidence/system-memory-envelope.instruments.xml";
const IOS_MEMORY_RAW_EXPORT = "content-free test Instruments export";

function pushDiagnosticEvent(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    phase: string,
    outcome: string,
    reason?: string,
    metrics: Record<string, number> = {},
    elapsedAdvance = 1,
): void {
    cursor.sequence += 1;
    cursor.elapsedMs += elapsedAdvance;
    diagnosticsControl.pushEvent(diagnosticEvent(
        cursor.sequence,
        phase,
        outcome,
        reason,
        metrics,
        cursor.elapsedMs,
        "chat",
        cursor.runId ?? DEFAULT_DIAGNOSTIC_RUN_ID,
    ));
}

function completedDocumentCountReason(outcome: string, documentCount: number): string | undefined {
    return outcome === "completed" && documentCount === 0 ? "semantic_none" : undefined;
}

function withDiagnosticSurface(
    diagnosticsControl: SmokeDiagnosticsControl,
    surface: "chat" | "pagelet",
    select: (event: Record<string, unknown>) => boolean = () => true,
): SmokeDiagnosticsControl {
    return {
        pushEvent: (event): void => {
            diagnosticsControl.pushEvent(select(event) ? { ...event, surface } : event);
        },
    } as SmokeDiagnosticsControl;
}

function withoutDiagnosticSurface(
    diagnosticsControl: SmokeDiagnosticsControl,
): SmokeDiagnosticsControl {
    return {
        pushEvent: (event): void => {
            const legacyEvent = { ...event };
            delete legacyEvent.surface;
            diagnosticsControl.pushEvent(legacyEvent);
        },
    } as SmokeDiagnosticsControl;
}

function withoutDiagnosticRunId(
    diagnosticsControl: SmokeDiagnosticsControl,
): SmokeDiagnosticsControl {
    return {
        pushEvent: (event): void => {
            const legacyEvent = { ...event };
            delete legacyEvent.runId;
            diagnosticsControl.pushEvent(legacyEvent);
        },
    } as SmokeDiagnosticsControl;
}

function pushRecoveryCanaryEpisode(
    diagnosticsControl: SmokeDiagnosticsControl,
    options: RecoveryCanaryTopology = {},
    cursor: DiagnosticCursor = { sequence: 0, elapsedMs: 0 },
): DiagnosticCursor {
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    const standardMemoryOutcome = options.standardMemoryOutcome ?? "completed";
    const standardMemoryDocumentCount = options.standardMemoryDocumentCount ?? 0;
    const standardMemoryReason = options.standardMemoryReason === null
        ? undefined
        : options.standardMemoryReason
            ?? completedDocumentCountReason(standardMemoryOutcome, standardMemoryDocumentCount);
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "memory_search",
        standardMemoryOutcome,
        standardMemoryReason,
        {
            durationMs: 5,
            documentCount: standardMemoryDocumentCount,
            ...(options.standardTemporalFilterApplied === undefined
                ? {}
                : { temporalFilterApplied: options.standardTemporalFilterApplied }),
            ...(options.standardTemporalViolationCount === undefined
                ? {}
                : { temporalViolationCount: options.standardTemporalViolationCount }),
        },
    );
    const standardTerminalOutcome = options.standardTerminalOutcome ?? "completed";
    const standardTerminalDocumentCount = options.standardTerminalDocumentCount ?? 0;
    const standardTerminalReason = options.standardTerminalReason === null
        ? undefined
        : options.standardTerminalReason
            ?? completedDocumentCountReason(standardTerminalOutcome, standardTerminalDocumentCount);
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "recovery_standard",
        standardTerminalOutcome,
        standardTerminalReason,
        { durationMs: 6, documentCount: standardTerminalDocumentCount },
    );
    if (options.retry !== false) {
        const pushRelaxedAttempt = (): void => {
            const relaxedFailureOutcome = options.relaxedFailureOutcome ?? "failed";
            const defaultFailureReason = relaxedFailureOutcome === "aborted"
                ? "attempt_aborted"
                : relaxedFailureOutcome === "deadline" ? "attempt_deadline" : "attempt_failed";
            const relaxedMemoryDocumentCount = options.relaxedMemoryDocumentCount ?? 1;
            const relaxedTerminalDocumentCount = options.relaxedTerminalDocumentCount ?? 1;
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "recovery_relaxed",
                "started",
                undefined,
                { retryConsumed: 1 },
            );
            pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "memory_search",
                options.relaxedFailure ? relaxedFailureOutcome : "completed",
                options.relaxedFailure
                    ? options.relaxedMemoryFailureReason ?? defaultFailureReason
                    : completedDocumentCountReason("completed", relaxedMemoryDocumentCount),
                options.relaxedFailure
                    ? {
                        durationMs: 5,
                        ...(options.relaxedTemporalFilterApplied === undefined
                            ? {}
                            : { temporalFilterApplied: options.relaxedTemporalFilterApplied }),
                        ...(options.relaxedTemporalViolationCount === undefined
                            ? {}
                            : { temporalViolationCount: options.relaxedTemporalViolationCount }),
                    }
                    : {
                        durationMs: 5,
                        documentCount: relaxedMemoryDocumentCount,
                        ...(options.relaxedTemporalFilterApplied === undefined
                            ? {}
                            : { temporalFilterApplied: options.relaxedTemporalFilterApplied }),
                        ...(options.relaxedTemporalViolationCount === undefined
                            ? {}
                            : { temporalViolationCount: options.relaxedTemporalViolationCount }),
                    },
            );
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "recovery_relaxed",
                options.relaxedFailure ? relaxedFailureOutcome : "completed",
                options.relaxedFailure
                    ? options.relaxedStageFailureReason ?? defaultFailureReason
                    : completedDocumentCountReason("completed", relaxedTerminalDocumentCount),
                options.relaxedFailure
                    ? { durationMs: 6, retryConsumed: 1 }
                    : {
                        durationMs: 6,
                        retryConsumed: 1,
                        documentCount: relaxedTerminalDocumentCount,
                    },
            );
        };
        pushRelaxedAttempt();
        if (options.doubleRetry) pushRelaxedAttempt();
        if (!options.omitProjection) {
            const projectionDocumentCount = options.projectionDocumentCount ?? 1;
            pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_projection", "started");
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "recovery_projection",
                "completed",
                completedDocumentCountReason("completed", projectionDocumentCount),
                {
                    durationMs: 1,
                    documentCount: projectionDocumentCount,
                    ...(options.projectionTemporalFilterApplied === undefined
                        ? {}
                        : { temporalFilterApplied: options.projectionTemporalFilterApplied }),
                    ...(options.projectionTemporalViolationCount === undefined
                        ? {}
                        : { temporalViolationCount: options.projectionTemporalViolationCount }),
                },
            );
        }
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        "started",
        undefined,
        { remainingMs: 100 },
    );
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        "completed",
        undefined,
        { remainingMs: 50 },
    );
    return cursor;
}

function pushTemporalRetryCanaryEpisode(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    overrides: RecoveryCanaryTopology = {},
): DiagnosticCursor {
    return pushRecoveryCanaryEpisode(diagnosticsControl, {
        standardTemporalFilterApplied: 1,
        standardTemporalViolationCount: 0,
        relaxedTemporalFilterApplied: 1,
        relaxedTemporalViolationCount: 0,
        projectionTemporalFilterApplied: 1,
        projectionTemporalViolationCount: 0,
        ...overrides,
    }, cursor);
}

function pushSuccessfulPerformanceEpisode(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    options: {
        retry?: boolean;
        omitProjection?: boolean;
        graphViolation?: "preflight-fallback";
        boundary?: "completed" | "reserve_not_entered";
        includeReserveProtected?: boolean;
        remainingMs?: number;
        standardDocumentCount?: number;
        relaxedDocumentCount?: number;
        projectionDocumentCount?: number;
    } = {},
): void {
    const standardDocumentCount = options.standardDocumentCount ?? 1;
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushSuccessfulMemoryAttempt(diagnosticsControl, cursor, {
        graphViolation: options.graphViolation,
        documentCount: standardDocumentCount,
    });
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "recovery_standard",
        "completed",
        completedDocumentCountReason("completed", standardDocumentCount),
        { documentCount: standardDocumentCount },
    );
    if (options.retry) {
        const relaxedDocumentCount = options.relaxedDocumentCount ?? 1;
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_relaxed", "started");
        pushSuccessfulMemoryAttempt(diagnosticsControl, cursor, {
            graphViolation: options.graphViolation,
            documentCount: relaxedDocumentCount,
        });
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "recovery_relaxed",
            "completed",
            completedDocumentCountReason("completed", relaxedDocumentCount),
            { documentCount: relaxedDocumentCount },
        );
        if (!options.omitProjection) {
            const projectionDocumentCount = options.projectionDocumentCount ?? 2;
            pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_projection", "started");
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "recovery_projection",
                "completed",
                completedDocumentCountReason("completed", projectionDocumentCount),
                { documentCount: projectionDocumentCount },
            );
        }
    }
    if (options.includeReserveProtected) {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_protected",
            { remainingMs: 75 },
        );
    }
    if (options.boundary !== "reserve_not_entered") {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "started",
            undefined,
            { remainingMs: 100 },
        );
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        options.boundary === "reserve_not_entered" ? "skipped" : "completed",
        options.boundary === "reserve_not_entered" ? "reserve_not_entered" : undefined,
        { remainingMs: options.remainingMs ?? 50 },
    );
}

function pushDirectOnlyRankingGraphAttempt(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
): void {
    pushDiagnosticEvent(diagnosticsControl, cursor, "graph_snapshot", "started");
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "graph_snapshot", "completed", undefined, { durationMs: 1 },
    );
    pushDiagnosticEvent(diagnosticsControl, cursor, "graph_preflight", "started");
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "graph_preflight", "completed", undefined, { durationMs: 1 },
    );
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "ppr_solve", "skipped", "activation_not_met",
    );
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "graph_workset", "fallback", "workset_empty",
    );
    pushDiagnosticEvent(diagnosticsControl, cursor, "reranker", "started");
}

type FailedRankingTerminalOutcome = "failed" | "aborted" | "deadline";

function failedRankingTerminalReason(outcome: FailedRankingTerminalOutcome): string {
    if (outcome === "aborted") return "attempt_aborted";
    if (outcome === "deadline") return "attempt_deadline";
    return "attempt_failed";
}

function pushSingleFailedStandardRankingEpisode(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    outcome: FailedRankingTerminalOutcome,
): void {
    const reason = failedRankingTerminalReason(outcome);
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", outcome, reason);
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", outcome, reason);
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        "skipped",
        "reserve_not_entered",
        { remainingMs: 50 },
    );
}

function pushConcurrentStandardRankingEpisode(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    options: {
        firstStandardTerminalBeforeMemory?: boolean;
        omitSecondMemoryTerminal?: boolean;
        skippedReasons?: readonly string[];
        startRelaxed?: boolean;
        reserveProtected?: boolean;
        secondTerminalOutcome?: FailedRankingTerminalOutcome;
    } = {},
): void {
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    pushDirectOnlyRankingGraphAttempt(diagnosticsControl, cursor);
    pushDirectOnlyRankingGraphAttempt(diagnosticsControl, cursor);

    pushDiagnosticEvent(diagnosticsControl, cursor, "reranker", "completed");
    if (options.firstStandardTerminalBeforeMemory) {
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
    }
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "memory_search", "completed", undefined,
        { durationMs: 5, documentCount: 1 },
    );
    if (!options.firstStandardTerminalBeforeMemory) {
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "recovery_standard", "completed", undefined,
            { durationMs: 6, documentCount: 1 },
        );
    }
    const skippedReasons = options.skippedReasons ?? ["not_eligible", "not_eligible"];
    if (!options.startRelaxed && skippedReasons[0]) {
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "recovery_relaxed", "skipped", skippedReasons[0],
        );
    }

    pushDiagnosticEvent(diagnosticsControl, cursor, "reranker", "completed");
    const secondTerminalOutcome = options.secondTerminalOutcome ?? "completed";
    const secondTerminalReason = options.secondTerminalOutcome
        ? failedRankingTerminalReason(options.secondTerminalOutcome)
        : undefined;
    if (!options.omitSecondMemoryTerminal) {
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "memory_search", secondTerminalOutcome, secondTerminalReason,
            { durationMs: 5, documentCount: 1 },
        );
    }
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "recovery_standard", secondTerminalOutcome, secondTerminalReason,
        { durationMs: 6, documentCount: 1 },
    );

    if (options.startRelaxed) {
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "recovery_relaxed", "started", undefined,
            { retryConsumed: 1 },
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "memory_search", "completed", undefined,
            { durationMs: 5, documentCount: 1 },
        );
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "recovery_relaxed", "completed", undefined,
            { durationMs: 6, documentCount: 1, retryConsumed: 1 },
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_projection", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_projection", "completed");
    } else {
        for (const reason of skippedReasons.slice(1)) {
            pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_relaxed", "skipped", reason);
        }
    }
    if (options.reserveProtected) {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_protected",
            { remainingMs: 75 },
        );
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        "skipped",
        "reserve_not_entered",
        { remainingMs: 50 },
    );
}

function pushSequentialStandardRankingEpisode(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    options: {
        omitSecondMemoryTerminal?: boolean;
        omitFirstRelaxedSkip?: boolean;
        thirdStandard?: boolean;
        boundaryBetweenCalls?: boolean;
    } = {},
): void {
    const pushStandard = (index: number): void => {
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
        pushDirectOnlyRankingGraphAttempt(diagnosticsControl, cursor);
        pushDiagnosticEvent(diagnosticsControl, cursor, "reranker", "completed");
        if (!(index === 1 && options.omitSecondMemoryTerminal)) {
            pushDiagnosticEvent(
                diagnosticsControl,
                cursor,
                "memory_search",
                "completed",
                undefined,
                { durationMs: 5, documentCount: 1 },
            );
        }
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "recovery_standard",
            "completed",
            undefined,
            { durationMs: 6, documentCount: 1 },
        );
        if (!(index === 0 && options.omitFirstRelaxedSkip)) {
            pushDiagnosticEvent(
                diagnosticsControl, cursor, "recovery_relaxed", "skipped", "not_eligible",
            );
        }
    };
    const pushBoundary = (): void => pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        "skipped",
        "reserve_not_entered",
        { remainingMs: 50 },
    );

    pushStandard(0);
    if (options.boundaryBetweenCalls) pushBoundary();
    pushStandard(1);
    if (options.thirdStandard) pushStandard(2);
    pushBoundary();
}

function pushSuccessfulMemoryAttempt(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    options: {
        graphViolation?: "reordered-stage" | "extra-failed-terminal" | "preflight-fallback"
            | "seed-fallback" | "seed-deadline" | "seed-count-mismatch" | "seed-count-four";
        documentCount?: number;
    } = {},
): void {
    const documentCount = options.documentCount ?? 1;
    const aggregateSeedCount = options.graphViolation === "seed-count-mismatch" ? 2
        : options.graphViolation === "seed-count-four" ? 4 : 1;
    const emittedSeedCount = options.graphViolation === "seed-count-mismatch" ? 1 : aggregateSeedCount;
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    if (options.graphViolation === "reordered-stage") {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_preflight",
            "started",
            undefined,
            { seedCount: aggregateSeedCount },
        );
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "graph_preflight", "completed", undefined, { durationMs: 4 }, 4,
        );
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_snapshot",
        "started",
        undefined,
        { seedCount: aggregateSeedCount },
    );
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "graph_snapshot", "completed", undefined, { durationMs: 3 }, 3,
    );
    if (options.graphViolation === "extra-failed-terminal") {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_snapshot",
            "failed",
            "invalid_snapshot",
        );
    }
    if (options.graphViolation !== "reordered-stage") {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_preflight",
            "started",
            undefined,
            { seedCount: aggregateSeedCount },
        );
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_preflight",
            options.graphViolation === "preflight-fallback" ? "fallback" : "completed",
            options.graphViolation === "preflight-fallback" ? "local_budget" : undefined,
            { durationMs: 4 },
            4,
        );
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "ppr_solve",
        "started",
        undefined,
        { seedCount: aggregateSeedCount },
    );
    for (let seedIndex = 0; seedIndex < emittedSeedCount; seedIndex += 1) {
        const seedOutcome = seedIndex === 0 && options.graphViolation === "seed-fallback"
            ? "fallback"
            : seedIndex === 0 && options.graphViolation === "seed-deadline" ? "deadline" : "completed";
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "ppr_solve",
            seedOutcome,
            seedOutcome === "fallback" ? "iteration_cap"
                : seedOutcome === "deadline" ? "deadline" : undefined,
            seedOutcome === "completed"
                ? { seedCount: 1, iterationCount: 4, errorBound: 0.1 }
                : { seedCount: 1 },
            0,
        );
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "ppr_solve",
        "completed",
        undefined,
        { durationMs: 5, seedCount: aggregateSeedCount, convergenceCount: aggregateSeedCount },
        5,
    );
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "graph_workset", "completed", undefined, { unionCount: 1 }, 2,
    );
    pushDiagnosticEvent(diagnosticsControl, cursor, "graph_worker", "started");
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_worker",
        "completed",
        undefined,
        {
            durationMs: 50,
            batchCount: 1,
            chunkCount: 1,
            queueWaitMs: 2,
            workerDurationMs: 45,
            maxBatchDurationMs: 40,
            cancelRequested: 0,
            acceptedCount: 1,
        },
        50,
    );
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "graph_workset", "completed", undefined, { selectedCount: 1 }, 7,
    );
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "memory_search",
        "completed",
        completedDocumentCountReason("completed", documentCount),
        { durationMs: 75, documentCount },
        1,
    );
}

function pushCancellationProbe(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    options: {
        includeDeadline?: boolean;
        acknowledgementAfterAttemptTerminal?: boolean;
        acknowledgementAfterFinalizationBoundary?: boolean;
        trailingAcknowledgementRunId?: string;
        includeDuplicateAbortTerminal?: boolean;
    } = {},
): void {
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "graph_worker", "started");
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_worker",
        "aborted",
        "cancel_requested",
        { cancelRequested: 1, acceptedCount: 0 },
    );
    if (options.includeDuplicateAbortTerminal) {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "aborted",
            "graph-rank-aborted",
            { cancelRequested: 1, acceptedCount: 0 },
        );
    }
    const pushObserved = (): void => pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_worker",
        "aborted",
        "cancel_observed",
        { cancelRequested: 1, cancelObserved: 1, acceptedCount: 0 },
    );
    if (!options.acknowledgementAfterAttemptTerminal
        && !options.acknowledgementAfterFinalizationBoundary) pushObserved();
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 5 }, 1,
    );
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
    if (options.acknowledgementAfterAttemptTerminal
        && !options.acknowledgementAfterFinalizationBoundary) pushObserved();
    const pushLate = (): void => pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_worker",
        "late_discarded",
        "late_result",
        { cancelRequested: 1, lateDiscardCount: 1, acceptedCount: 0 },
    );
    if (!options.acknowledgementAfterFinalizationBoundary) pushLate();
    if (options.includeDeadline) {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "started",
            undefined,
            { remainingMs: 10 },
        );
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "deadline",
            "hard_deadline",
            { remainingMs: 0 },
        );
    } else {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "finalization_reserve",
            "skipped",
            "reserve_not_entered",
            { remainingMs: 50 },
        );
    }
    if (options.acknowledgementAfterFinalizationBoundary) {
        const previousRunId = cursor.runId;
        if (options.trailingAcknowledgementRunId) {
            cursor.runId = options.trailingAcknowledgementRunId;
        }
        pushObserved();
        pushLate();
        cursor.runId = previousRunId;
    }
}

function pushCancellationProbeViolation(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    violation: "missing-observed" | "missing-late" | "accepted-after-cancel"
        | "accepted-after-cancel-without-request-flag" | "misordered"
        | "observed-without-request-flag" | "late-without-request-flag" | "duplicate-observed"
        | "two-attempt-probe" | "cross-attempt-signals" | "requested-after-attempt-terminal",
): void {
    if ([
        "two-attempt-probe",
        "cross-attempt-signals",
        "requested-after-attempt-terminal",
    ].includes(violation)) {
        pushCancellationOwnershipViolation(
            diagnosticsControl,
            cursor,
            violation as "two-attempt-probe" | "cross-attempt-signals"
                | "requested-after-attempt-terminal",
        );
        return;
    }
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "graph_worker", "started");
    const pushRequested = (): void => {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "aborted",
            "cancel_requested",
            { cancelRequested: 1, acceptedCount: 0 },
        );
    };
    const pushObserved = (): void => {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "aborted",
            "cancel_observed",
            {
                cancelRequested: violation === "observed-without-request-flag" ? 0 : 1,
                cancelObserved: 1,
                acceptedCount: 0,
            },
        );
    };
    if (violation === "misordered") {
        pushObserved();
        pushRequested();
    } else {
        pushRequested();
        if (violation !== "missing-observed") pushObserved();
    }
    if (violation === "duplicate-observed") pushObserved();
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 5 }, 1,
    );
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
    if (["accepted-after-cancel", "accepted-after-cancel-without-request-flag"].includes(violation)) {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "completed",
            undefined,
            {
                cancelRequested: violation === "accepted-after-cancel" ? 1 : 0,
                acceptedCount: 1,
                durationMs: 1,
            },
        );
    }
    if (violation !== "missing-late") {
        pushDiagnosticEvent(
            diagnosticsControl,
            cursor,
            "graph_worker",
            "late_discarded",
            "late_result",
            {
                cancelRequested: violation === "late-without-request-flag" ? 0 : 1,
                lateDiscardCount: 1,
                acceptedCount: 0,
            },
        );
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        "skipped",
        "reserve_not_entered",
        { remainingMs: 50 },
    );
}

function pushCancellationOwnershipViolation(
    diagnosticsControl: SmokeDiagnosticsControl,
    cursor: DiagnosticCursor,
    violation: "two-attempt-probe" | "cross-attempt-signals" | "requested-after-attempt-terminal",
): void {
    const pushRequested = (): void => pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_worker",
        "aborted",
        "cancel_requested",
        { cancelRequested: 1, acceptedCount: 0 },
    );
    const pushObserved = (): void => pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_worker",
        "aborted",
        "cancel_observed",
        { cancelRequested: 1, cancelObserved: 1, acceptedCount: 0 },
    );
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
    pushDiagnosticEvent(diagnosticsControl, cursor, "graph_worker", "started");
    if (violation !== "requested-after-attempt-terminal") {
        pushRequested();
        if (violation === "two-attempt-probe") pushObserved();
    }
    pushDiagnosticEvent(
        diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 5 },
    );
    if (violation === "requested-after-attempt-terminal") {
        pushRequested();
        pushObserved();
    }
    pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_standard", "completed");
    if (violation !== "requested-after-attempt-terminal") {
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_relaxed", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "memory_search", "started");
        if (violation === "cross-attempt-signals") {
            pushDiagnosticEvent(diagnosticsControl, cursor, "graph_worker", "started");
            pushObserved();
        }
        pushDiagnosticEvent(
            diagnosticsControl, cursor, "memory_search", "completed", undefined, { durationMs: 5 },
        );
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_relaxed", "completed");
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_projection", "started");
        pushDiagnosticEvent(diagnosticsControl, cursor, "recovery_projection", "completed");
    }
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "graph_worker",
        "late_discarded",
        "late_result",
        { cancelRequested: 1, lateDiscardCount: 1, acceptedCount: 0 },
    );
    pushDiagnosticEvent(
        diagnosticsControl,
        cursor,
        "finalization_reserve",
        "skipped",
        "reserve_not_entered",
        { remainingMs: 50 },
    );
}

function diagnosticsSnapshot(
    events: Array<Record<string, unknown>>,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        sessionId: "session-sensitive",
        startedAt: "2026-08-09T00:00:00.000Z",
        finishedAt: null,
        capacity: 512,
        droppedEventCount: 0,
        events,
        ...extra,
    };
}

function prepare(repositoryRoot: string, vaultRoot: string): PreparationReport {
    const output = execFileSync(process.execPath, [
        "scripts/prepare-retrieval-optimization-smoke.mjs",
        `--vault=${vaultRoot}`,
        "--write",
        "--json",
    ], {
        cwd: repositoryRoot,
        encoding: "utf8",
    });
    return JSON.parse(output) as PreparationReport;
}
