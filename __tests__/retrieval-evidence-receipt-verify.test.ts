import { createHash } from "node:crypto";
import {
    copyFileSync,
    linkSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    unlinkSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "@jest/globals";

import { stableStringify } from "../src/ai-services/agent-utils";

const repositoryRoot = process.cwd();
const verifierPath = join(repositoryRoot, "scripts/retrieval-evidence-receipt-verify.mjs");
const currentFixtureManifest = JSON.parse(readFileSync(
    join(repositoryRoot, "__fixtures__/retrieval-smoke/manifest.json"),
    "utf8",
)) as {
    fixtureVersion: string;
    files: Record<string, string>;
    temporalFixtureMtimes: Record<string, string>;
    pageletCases: Record<string, {
        entryPath: string;
        expectedInsightCount: number;
        sourcePaths: string[];
    }>;
    recoveryCase: {
        prompt: string;
        targetPath: string;
    };
    deviceMeasurementPlan: Record<string, any> & {
        performanceWorkload: Record<string, any>;
    };
    compactProxyPlan: Record<string, any>;
    requiredRankingCases: string[];
    rankingCases: Record<string, {
        relevantPath: string;
        forbiddenPaths: string[];
    }>;
    temporalRetryCase: Record<string, any>;
};
const currentPluginVersion = (JSON.parse(readFileSync(
    join(repositoryRoot, "manifest.json"),
    "utf8",
)) as { version: string }).version;
const syntheticStartedAt = "2026-08-11T00:00:00.000Z";
const syntheticFinishedAt = "2026-08-11T00:02:00.000Z";
const requiredAppIdentityChecks = [
    "Loaded plugin and current vault artifact identities match",
    "Smoke manifest matches the canonical repository identity",
    "Smoke manifest contract matches the runner",
    "Smoke runner artifact identity is captured",
    "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
    "Plugin lifecycle, artifact, and settings bindings are stable at receipt commit",
];
const opfsStableFieldPaths = [
    "runtime.appVersion",
    "runtime.appVersionSource",
    "runtime.shellVersion",
    "runtime.shellVersionSource",
    "runtime.electronVersion",
    "runtime.electronVersionSource",
    "runtime.platform",
    "runtime.arch",
    "runtime.processType",
    "runtime.mainProcessIdentitySource",
    "plugin.id",
    "plugin.version",
    "plugin.artifactSha256",
    "plugin.loadedBuild.schemaVersion",
    "plugin.loadedBuild.pluginId",
    "plugin.loadedBuild.pluginVersion",
    "plugin.loadedBuild.pluginArtifactPathSha256",
    "plugin.loadedBuild.loadedPluginArtifactSha256",
    "plugin.loadedBuild.lexicalProfileRuntimeFingerprint",
    "plugin.loadedBuild.identitySource",
    "plugin.loadedBuild.blocker",
    "runner.path",
    "runner.artifactSha256",
    "storage.status",
    "storage.backend",
    "storage.fallbackMode",
    "storage.fileCount",
    "storage.chunkCount",
    "storage.estimatedDbBytes",
    "storage.lexicalProfile.id",
    "storage.lexicalProfile.state",
    "storage.lexicalProfile.generation",
    "storage.continuity.databaseInstanceIdSha256",
    "storage.continuity.indexIdSha256",
    "storage.continuity.indexBuiltAt",
    "storage.continuity.chunkMutationEpoch",
    "storage.continuity.indexMutationEpoch",
    "storage.continuity.rebuildEpoch",
    "storage.continuity.lexicalMaintenanceEpoch",
    "storage.scopeIdentity.databaseNameSha256",
    "storage.scopeIdentity.opfsDirectorySha256",
    "storage.scopeIdentity.opfsVfsNameSha256",
    "storage.scopeIdentity.combinedSha256",
];
const fixturePaths = [
    "scripts/retrieval-optimization-smoke-runner.js",
    "test/retrieval-optimization-smoke-runner.js",
    "__fixtures__/retrieval-smoke/manifest.json",
    "test/retrieval-optimization-smoke-manifest.json",
    "scripts/retrieval-opfs-restart-runner.js",
    "test/retrieval-opfs-restart-runner.js",
    ...Object.keys(currentFixtureManifest.files).map((path) => `test/${path}`),
];
const temporaryDirectories: string[] = [];

interface VerificationResult {
    status: "PASS" | "BLOCKED" | "FAIL";
    exitCode: number;
    errorCode: string | null;
    claim: {
        receiptBoundArtifactsMatchCurrentDisk: boolean;
        liveProcessCurrentnessClaimed: boolean;
        appReceiptCryptographicSealClaimed: boolean;
        appReceiptAuthenticityVerified: boolean;
        appRecoveryEvidenceDigestRecomputed: boolean;
    };
    receipts: {
        app: {
            status: string;
            receiptOverall: string;
            workloadBinding: {
                status: string;
                bindingStatus: string;
                expectedEpisodeCount: number;
                boundEpisodeCount: number;
                qualificationStatus: string;
                violationCount: number;
            };
            externalMemoryBinding: {
                status: string;
                bindingPresent: boolean;
                reason?: string;
            };
            compactProxy?: {
                status: string;
                profile: string;
                planVersion: string;
                machineStatus: string;
                completionStatus: string;
                expectedEpisodeCount: number;
                boundEpisodeCount: number;
                ownerDispositionStatus: string;
            };
            correctnessSlices?: { status: string };
        };
        opfs: {
            status: string;
            receiptStatus: string;
            rawComparison: {
                stableFieldCount: number;
                stableFieldPassCount: number;
                fullAppRestartStatus: string;
            };
        };
        opfsBaseline: { status: string; receiptStatus: string };
    };
    artifacts: {
        fixtureBundle: {
            status: string;
            expectedFileCount: number;
            verifiedFileCount: number;
            temporalExpectedCount: number;
            temporalVerifiedCount: number;
        };
    };
    blockers: string[];
    failures: string[];
    integrityErrors: string[];
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function createFixtureRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "pa-retrieval-receipt-"));
    temporaryDirectories.push(root);
    for (const relativePath of fixturePaths) {
        const source = relativePath === "test/retrieval-optimization-smoke-runner.js"
            ? join(repositoryRoot, "scripts/retrieval-optimization-smoke-runner.js")
            : relativePath === "test/retrieval-optimization-smoke-manifest.json"
            ? join(repositoryRoot, "__fixtures__/retrieval-smoke/manifest.json")
            : relativePath === "test/retrieval-opfs-restart-runner.js"
            ? join(repositoryRoot, "scripts/retrieval-opfs-restart-runner.js")
            : relativePath.startsWith("test/retrieval-smoke/")
            ? join(
                repositoryRoot,
                "__fixtures__/retrieval-smoke/vault",
                relativePath.slice("test/".length),
            )
            : join(repositoryRoot, relativePath);
        const destination = join(root, relativePath);
        mkdirSync(dirname(destination), { recursive: true });
        if (relativePath.startsWith("test/retrieval-smoke/")) {
            copyFileSync(source, destination);
            const sourceStat = statSync(source);
            utimesSync(destination, sourceStat.atime, sourceStat.mtime);
        } else {
            try {
                linkSync(source, destination);
            } catch {
                copyFileSync(source, destination);
                const sourceStat = statSync(source);
                utimesSync(destination, sourceStat.atime, sourceStat.mtime);
            }
        }
    }
    for (const [fixturePath, timestamp] of Object.entries(
        currentFixtureManifest.temporalFixtureMtimes,
    )) {
        const fixtureTime = new Date(timestamp);
        utimesSync(join(root, "test", fixturePath), fixtureTime, fixtureTime);
    }
    const syntheticPluginArtifact = "/* synthetic verifier plugin artifact */\n";
    for (const relativePath of [
        "dist/main.js",
        "test/.obsidian/plugins/personal-assistant/main.js",
    ]) {
        const destination = join(root, relativePath);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, syntheticPluginArtifact);
    }
    writeSyntheticEvidenceFiles(root);
    upgradeFixtureRootToCurrentContract(root);
    return root;
}

function expandPerformanceSequence(): Array<{
    id: string;
    stage: string;
    sampleClass: string;
    promptId: string;
}> {
    const workload = currentFixtureManifest.deviceMeasurementPlan.performanceWorkload;
    return Object.entries(workload.stages as Record<string, Array<Record<string, any>>>)
        .flatMap(([stage, segments]) => segments.flatMap((segment) => {
            const ids = typeof segment.id === "string"
                ? [segment.id]
                : Array.from(
                    { length: segment.to - segment.from + 1 },
                    (_, offset) => (
                        `${segment.idPrefix}${String(segment.from + offset).padStart(
                            segment.pad,
                            "0",
                        )}`
                    ),
                );
            return ids.map((id) => ({
                id,
                stage,
                sampleClass: segment.sampleClass,
                promptId: segment.promptId,
            }));
        }));
}

function expandCompactProxySequence(): Array<Record<string, any>> {
    return Object.entries(
        currentFixtureManifest.compactProxyPlan.workload.stages as Record<
            string,
            Array<Record<string, any>>
        >,
    ).flatMap(([stage, segments]) => segments.flatMap((segment) => {
        const ids = typeof segment.id === "string"
            ? [segment.id]
            : Array.from(
                { length: segment.to - segment.from + 1 },
                (_, offset) => (
                    `${segment.idPrefix}${String(segment.from + offset).padStart(
                        segment.pad,
                        "0",
                    )}`
                ),
            );
        return ids.map((id) => ({
            id,
            stage,
            sampleClass: segment.sampleClass,
            promptId: segment.promptId,
            settingsPhase: segment.settingsPhase,
        }));
    }));
}

function compactStats(samples: number[]): Record<string, number> {
    return {
        sampleCount: samples.length,
        p50: nearestRankPercentile(samples, 0.5),
        p95: nearestRankPercentile(samples, 0.95),
        minimum: Math.min(...samples),
        maximum: Math.max(...samples),
    };
}

function projectPerformanceWorkloadContractForReceipt(
    workload: Record<string, any>,
): Record<string, any> {
    const sequence = expandPerformanceSequence();
    return {
        schemaVersion: workload.schemaVersion,
        conversationPolicy: workload.conversationPolicy,
        fixtureCase: {
            id: workload.fixtureCase.id,
            wave1DirectCount: workload.fixtureCase.wave1Direct.to
                - workload.fixtureCase.wave1Direct.from + 1,
            wave1GraphHubCount: 1,
            wave2FreshDirectCount: workload.fixtureCase.wave2FreshDirectPaths.length,
            wave2GraphHubCount: 1,
            requiredDisconnectedWaves: workload.fixtureCase.requiredDisconnectedWaves,
        },
        prompts: Object.keys(workload.prompts).sort().map((id) => ({
            id,
            expectedShape: workload.prompts[id].expectedShape,
        })),
        qualificationIds: [...workload.qualification.requiredBeforeEnvelope],
        stages: Object.fromEntries(Object.keys(workload.stages).map((stage) => [
            stage,
            {
                expectedCount: sequence.filter((entry) => entry.stage === stage).length,
                promptId: workload.stages[stage][0].promptId,
                sampleClasses: [...new Set(workload.stages[stage].map(
                    (segment: Record<string, any>) => segment.sampleClass,
                ))],
            },
        ])),
    };
}

function projectDevicePlanForReceipt(plan: Record<string, any>): Record<string, any> {
    return {
        ...plan,
        performanceWorkload: projectPerformanceWorkloadContractForReceipt(
            plan.performanceWorkload,
        ),
    };
}

function passingThreshold(definition: Record<string, any>): Record<string, number> {
    const threshold = definition.threshold ?? {};
    if (Object.prototype.hasOwnProperty.call(threshold, "p95Min")) return { p95Min: 0 };
    if (Object.prototype.hasOwnProperty.call(threshold, "minMin")) return { minMin: 0 };
    if (Object.prototype.hasOwnProperty.call(threshold, "maxMax")) {
        return { maxMax: Number.MAX_SAFE_INTEGER };
    }
    return { p95Max: Number.MAX_SAFE_INTEGER };
}

function nearestRankPercentile(samples: number[], percentile: number): number {
    const sorted = [...samples].sort((left, right) => left - right);
    return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

const diagnosticsDerivedRequiredMetricIds = new Set([
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
]);

function createPassDeviceMetric(
    definition: Record<string, any>,
    recordedAt: string,
): Record<string, any> {
    const plan = currentFixtureManifest.deviceMeasurementPlan;
    const rawSampleCount = definition.sampleMode === "series"
        ? plan.warmupSamples + plan.sampleCount
        : definition.sampleMode === "snapshot"
        ? 1
        : definition.minimumSamples ?? 2;
    const rawSamples = [
        "retrieval.finalizationReserveMs",
        "retrieval.retryFinalizationReserveMs",
    ].includes(definition.id)
        ? Array.from({ length: rawSampleCount }, () => 100)
        : Array.from({ length: rawSampleCount }, (_, index) => index + 1);
    const evaluatedSamples = definition.sampleMode === "series"
        ? rawSamples.slice(plan.warmupSamples)
        : [...rawSamples];
    const method = definition.id === "storage.peakEstimatedDbBytes"
        ? "estimated"
        : "measured";
    const evidenceSource = diagnosticsDerivedRequiredMetricIds.has(definition.id)
        ? "retrieval-diagnostics-staged"
        : definition.id === "memory.peakProcessFootprintBytes"
        ? "runtime-envelope-process-resident_set_bytes-1000ms"
        : definition.id === "storage.peakEstimatedDbBytes"
        ? "runtime-envelope-resource-1000ms"
        : definition.id === "ui.maxEventLoopStallMs"
        ? "runtime-envelope-main-thread-gap-50ms"
        : "operator";
    return {
        id: definition.id,
        unit: definition.unit,
        sampleMode: definition.sampleMode,
        collectionMethod: definition.collectionMethod ?? null,
        required: true,
        method,
        evidenceSource,
        status: "PASS",
        reason: "frozen threshold satisfied",
        rawSamples,
        evaluatedSamples,
        p50: nearestRankPercentile(evaluatedSamples, 0.5),
        p95: nearestRankPercentile(evaluatedSamples, 0.95),
        minimum: Math.min(...evaluatedSamples),
        maximum: Math.max(...evaluatedSamples),
        threshold: passingThreshold(definition),
        recordedAt,
    };
}

function createPendingDeviceMetric(definition: Record<string, any>): Record<string, any> {
    return {
        id: definition.id,
        unit: definition.unit,
        sampleMode: definition.sampleMode,
        collectionMethod: definition.collectionMethod ?? null,
        required: false,
        method: null,
        evidenceSource: null,
        status: "PENDING",
        reason: "not recorded",
        rawSamples: [],
        evaluatedSamples: [],
        p50: null,
        p95: null,
        minimum: null,
        maximum: null,
        threshold: { ...definition.threshold },
        recordedAt: null,
    };
}

function createPassRuntimeEnvelope(receipt: Record<string, any>): Record<string, any> {
    const metrics = receipt.deviceMeasurement.metrics;
    const databaseSamples = metrics["storage.peakEstimatedDbBytes"].rawSamples;
    const processMemorySamples = metrics["memory.peakProcessFootprintBytes"].rawSamples;
    const stallSamples = metrics["ui.maxEventLoopStallMs"].rawSamples;
    return {
        status: "PASS",
        workloadCoverageStatus: "PASS",
        reason: "sampling window contains the exact frozen standard and retry performance workloads",
        resourceIntervalMs: 1_000,
        stallIntervalMs: 50,
        maxDurationMs: 600_000,
        resourceSampleCount: Math.max(databaseSamples.length, processMemorySamples.length),
        databaseSampleCount: databaseSamples.length,
        runtimeProcessMemorySampleCount: processMemorySamples.length,
        stallSampleCount: stallSamples.length,
        startSequence: 0,
        endSequence: 1,
        coveredStandardPerformanceEpisodeCount: 23,
        coveredRetryPerformanceEpisodeCount: 23,
        startedAt: receipt.startedAt,
        finishedAt: receipt.finishedAt,
        sourceCoverage: {
            database: "PASS",
            processMemory: "PASS",
            eventLoopStall: "PASS",
        },
        runtimeProcessMemorySourceAvailable: true,
        runtimeProcessMemoryCounter: "resident_set_bytes",
        iosEvidenceStatus: "NOT_REQUIRED",
        externalMemoryCapturePrecondition: {
            status: "PASS",
            reason: "external memory artifacts were absent before profiler capture started",
            checkedAt: receipt.startedAt,
            artifactPath: "retrieval-smoke/evidence/system-memory-envelope.json",
            artifactAbsent: true,
            rawExportPath: "retrieval-smoke/evidence/system-memory-envelope.instruments.xml",
            rawExportAbsent: true,
        },
        externalMemoryEnvelope: null,
        durationMs: Date.parse(receipt.finishedAt) - Date.parse(receipt.startedAt),
        evidenceSource: "workload-bound-runtime-envelope",
    };
}

function frozenPlanFromReceipt(
    receipt: Record<string, any>,
    externalDeviceIdentitySha256: string | null = null,
): Record<string, any> {
    const plan = currentFixtureManifest.deviceMeasurementPlan;
    const rebuild = (definitions: Array<Record<string, any>>): Array<Record<string, any>> => (
        definitions.map((definition) => ({
            ...definition,
            threshold: receipt.deviceMeasurement.metrics[definition.id].threshold,
        }))
    );
    return {
        ...plan,
        externalMemoryEvidence: {
            ...plan.externalMemoryEvidence,
            deviceIdentitySha256: externalDeviceIdentitySha256,
        },
        requiredMetrics: rebuild(plan.requiredMetrics),
        optionalMetrics: rebuild(plan.optionalMetrics),
        rerankerGate: {
            minimumMrr: receipt.deviceMeasurement.rerankerGate.minimumMrr,
            flagOffBaselineMrr: receipt.deviceMeasurement.rerankerGate.flagOffBaselineMrr,
            maximumMrrRegression: receipt.deviceMeasurement.rerankerGate.maximumMrrRegression,
        },
    };
}

function createPassWorkloadBinding(): Record<string, any> {
    const sequence = expandPerformanceSequence();
    const episodeEntries = sequence.map(({ promptId: _promptId, ...entry }, index) => ({
        ...entry,
        sequence: index + 1,
        status: "PASS",
        opaqueCorrelationSha256: sha256(`episode-correlation:${entry.id}`),
        evidenceBindingSha256: sha256(`episode-evidence:${entry.id}`),
    }));
    const qualificationEntries = ["standard-v1", "retry-v1"].map((promptId, index) => ({
        id: `qualification-${promptId}`,
        stage: "qualification",
        sampleClass: "qualification",
        sequence: index + 1,
        status: "PASS",
        opaqueCorrelationSha256: sha256(`qualification-correlation:${index}`),
        evidenceBindingSha256: sha256(`qualification-evidence:${index}`),
    }));
    const qualificationBindingSha256 = sha256(canonicalJson(qualificationEntries));
    const workload = currentFixtureManifest.deviceMeasurementPlan.performanceWorkload;
    const stageExpectedCounts = {
        standardPerformance: 23,
        retryPerformanceBatch1: 12,
        retryPerformanceBatch2: 11,
        cancellationProbe: 1,
    };
    return {
        schemaVersion: 1,
        status: "PASS",
        contractSha256: sha256(canonicalJson(
            projectPerformanceWorkloadContractForReceipt(workload),
        )),
        sequenceSha256: sha256(canonicalJson(sequence)),
        bindingSha256: sha256(canonicalJson({
            qualificationBindingSha256,
            episodeBindingSha256: sha256(canonicalJson(episodeEntries)),
        })),
        expectedEpisodeCount: sequence.length,
        boundEpisodeCount: episodeEntries.length,
        violationCount: 0,
        qualification: {
            status: "PASS",
            requiredCount: qualificationEntries.length,
            boundCount: qualificationEntries.length,
            violationCount: 0,
            bindingSha256: qualificationBindingSha256,
            entries: qualificationEntries,
        },
        stages: Object.fromEntries(Object.entries(stageExpectedCounts).map(([
            stage,
            expectedCount,
        ]) => [stage, {
            status: "PASS",
            expectedCount,
            boundCount: episodeEntries.filter((entry) => entry.stage === stage).length,
            violationCount: 0,
        }])),
        episodes: episodeEntries,
    };
}

function resealWorkloadBinding(binding: Record<string, any>): void {
    binding.boundEpisodeCount = binding.episodes.length;
    binding.qualification.boundCount = binding.qualification.entries.length;
    binding.qualification.bindingSha256 = sha256(canonicalJson(
        binding.qualification.entries,
    ));
    for (const [stage, summary] of Object.entries(
        binding.stages as Record<string, Record<string, any>>,
    )) {
        summary.boundCount = binding.episodes.filter(
            (entry: Record<string, any>) => entry.stage === stage,
        ).length;
    }
    binding.bindingSha256 = sha256(canonicalJson({
        qualificationBindingSha256: binding.qualification.bindingSha256,
        episodeBindingSha256: sha256(canonicalJson(binding.episodes)),
    }));
}

function resealCompactCancellationEvidence(evidence: Record<string, any>): void {
    const core = { ...evidence };
    delete core.evidenceSha256;
    evidence.evidenceSha256 = sha256(canonicalJson(core));
}

function resealCompactEpisodeBinding(
    receipt: Record<string, any>,
    episode: Record<string, any>,
): void {
    const core = { ...episode };
    delete core.evidenceBindingSha256;
    episode.evidenceBindingSha256 = sha256(canonicalJson(core));
    receipt.compactProxy.workloadBinding.bindingSha256 = sha256(canonicalJson(
        receipt.compactProxy.workloadBinding.episodes,
    ));
}

const compactEpisodeObservationKeys = [
    "memorySearchDurationMs",
    "outerTurnDurationMs",
    "lexicalDurationMs",
    "graphDurationMs",
    "graphWorkerDurationMs",
    "graphWorkerQueueWaitMs",
    "graphMaxBatchDurationMs",
    "finalizationReserveMs",
    "finalizationRemainingMs",
    "deadlineExceededCount",
    "cancelRequestedCount",
    "cancelObservedCount",
    "acceptedAfterCancelCount",
    "lateDiscardCount",
    "fallbackCount",
    "cancelToWorkerObservedMs",
    "cancelToLateDiscardedMs",
    "cancelToProbeCompletedMs",
    "queueReleaseProbeResultCount",
];
const compactStageObservationKeys = [
    ...compactEpisodeObservationKeys,
    "eventLoopStallMs",
    "estimatedDbBytes",
];

function createCompactEpisodeObservations(
    stage: string,
    sequence: number,
): Record<string, number | null> {
    const control = stage === "controlStandard";
    const cancel = stage === "cancellationProbe";
    const hasWorkerTiming = !control && !cancel;
    return {
        memorySearchDurationMs: 100 + sequence,
        outerTurnDurationMs: 200 + sequence,
        lexicalDurationMs: control ? null : 10 + sequence,
        graphDurationMs: control ? null : 20 + sequence,
        graphWorkerDurationMs: hasWorkerTiming ? 5 + sequence : null,
        graphWorkerQueueWaitMs: hasWorkerTiming ? 6 + sequence : null,
        graphMaxBatchDurationMs: hasWorkerTiming ? 7 + sequence : cancel ? 39 : null,
        finalizationReserveMs: 100,
        finalizationRemainingMs: 30 + sequence,
        deadlineExceededCount: 0,
        cancelRequestedCount: cancel ? 1 : 0,
        cancelObservedCount: cancel ? 1 : 0,
        acceptedAfterCancelCount: 0,
        lateDiscardCount: cancel ? 1 : 0,
        fallbackCount: 0,
        cancelToWorkerObservedMs: cancel ? 2 : null,
        cancelToLateDiscardedMs: cancel ? 3 : null,
        cancelToProbeCompletedMs: cancel ? 4 : null,
        queueReleaseProbeResultCount: cancel ? 1 : null,
    };
}

function createPassCompactProxy(): Record<string, any> {
    const plan = currentFixtureManifest.compactProxyPlan;
    const sequence = expandCompactProxySequence();
    const modes: Record<string, string> = {
        controlStandard: "direct-vector-control",
        evaluatedStandard: "full-graph",
        evaluatedRetry: "full-graph-retry",
        cancellationProbe: "same-worker-cancel",
    };
    const createCancellationEvidence = (runId: string): Record<string, any> => {
        const evidence = {
            schemaVersion: 1,
            runId,
            surface: "chat",
            graphQueueReleaseAbsoluteEnvelopeMs: 8000,
            events: [
                {
                    sequence: 1, elapsedMs: 1, phase: "graph_worker", outcome: "started",
                    reason: null, metrics: { candidateCount: 1 },
                },
                {
                    sequence: 2, elapsedMs: 2, phase: "graph_worker", outcome: "aborted",
                    reason: "cancel_requested", metrics: { cancelRequested: 1, acceptedCount: 0 },
                },
                {
                    sequence: 3, elapsedMs: 2.5, phase: "queue_release", outcome: "started",
                    reason: null, metrics: {},
                },
                {
                    sequence: 4, elapsedMs: 4, phase: "graph_worker", outcome: "aborted",
                    reason: "cancel_observed",
                    metrics: { cancelRequested: 1, cancelObserved: 1, acceptedCount: 0 },
                },
                {
                    sequence: 5, elapsedMs: 5, phase: "graph_worker", outcome: "late_discarded",
                    reason: "late_result",
                    metrics: { cancelRequested: 1, lateDiscardCount: 1, acceptedCount: 0 },
                },
                {
                    sequence: 6, elapsedMs: 6, phase: "queue_release", outcome: "completed",
                    reason: null, metrics: { durationMs: 4, resultCount: 1 },
                },
            ],
        };
        return { ...evidence, evidenceSha256: sha256(canonicalJson(evidence)) };
    };
    const episodes: Array<Record<string, any>> = sequence.map((entry, index) => {
        const runId = `compact-run-${entry.id}`;
        const entryWithoutBinding = {
            ...entry,
            surface: "chat",
            freshChat: true,
            sequence: index + 1,
            status: "BOUND",
            executionMode: modes[entry.stage],
            opaqueCorrelationSha256: sha256(`retrieval-compact-proxy-run\u0000${runId}`),
            cancellationEvidence: entry.stage === "cancellationProbe"
                ? createCancellationEvidence(runId) : null,
            observations: createCompactEpisodeObservations(entry.stage, index + 1),
        };
        return {
            ...entryWithoutBinding,
            evidenceBindingSha256: sha256(canonicalJson(entryWithoutBinding)),
        };
    });
    const stageCounts: Record<string, {
        sampleCount: number;
        warmupCount: number;
        measuredCount: number;
    }> = {
        controlStandard: { sampleCount: 6, warmupCount: 1, measuredCount: 5 },
        evaluatedStandard: { sampleCount: 13, warmupCount: 3, measuredCount: 10 },
        evaluatedRetry: { sampleCount: 13, warmupCount: 3, measuredCount: 10 },
        cancellationProbe: { sampleCount: 1, warmupCount: 0, measuredCount: 0 },
    };
    const stageMetrics = Object.fromEntries(Object.entries(stageCounts).map(([
        stage,
        counts,
    ]) => {
        const stageEpisodes = episodes.filter((entry) => entry.stage === stage);
        const observations = Object.fromEntries(compactStageObservationKeys.map((key) => {
            if (key === "eventLoopStallMs") {
                return [key, stage === "cancellationProbe" ? [] : [1, 2, 3]];
            }
            if (key === "estimatedDbBytes") {
                return [key, stage === "cancellationProbe" ? [] : [1000, 1100, 1200]];
            }
            return [key, stageEpisodes
                .map((entry) => entry.observations[key])
                .filter((value) => value !== null)];
        }));
        return [stage, {
            status: "PASS",
            ...counts,
            expectedCount: counts.sampleCount,
            observations,
        }];
    }));
    const measured = (stage: string, key: string): number[] => {
        const record = stageMetrics[stage];
        const values = record.observations[key] as number[];
        return ["eventLoopStallMs", "estimatedDbBytes"].includes(key)
            ? [...values]
            : values.slice(record.warmupCount);
    };
    const comparisonSources: Record<string, [number[], number[]]> = {
        standardMemorySearchDurationMs: [
            measured("controlStandard", "memorySearchDurationMs"),
            measured("evaluatedStandard", "memorySearchDurationMs"),
        ],
        outerTurnDurationMs: [
            measured("controlStandard", "outerTurnDurationMs"),
            measured("evaluatedStandard", "outerTurnDurationMs"),
        ],
        eventLoopStallMs: [
            measured("controlStandard", "eventLoopStallMs"),
            measured("evaluatedStandard", "eventLoopStallMs"),
        ],
        estimatedDbBytes: [
            measured("controlStandard", "estimatedDbBytes"),
            measured("evaluatedStandard", "estimatedDbBytes"),
        ],
    };
    const naEvaluatedSources: Record<string, number[]> = {
        lexicalDurationMs: measured("evaluatedStandard", "lexicalDurationMs"),
        graphDurationMs: measured("evaluatedStandard", "graphDurationMs"),
        retryDurationMs: measured("evaluatedRetry", "memorySearchDurationMs"),
        rebuildDurationMs: [110],
        incrementalUpdateDurationMs: [12],
    };
    const comparisonKeys = [
        "standardMemorySearchDurationMs",
        "outerTurnDurationMs",
        "eventLoopStallMs",
        "estimatedDbBytes",
        "lexicalDurationMs",
        "graphDurationMs",
        "retryDurationMs",
        "rebuildDurationMs",
        "incrementalUpdateDurationMs",
    ];
    const comparison = Object.fromEntries(comparisonKeys.map((key) => {
        const source = comparisonSources[key];
        return source
            ? [key, {
                status: "OBSERVED",
                reason: null,
                control: compactStats(source[0]),
                evaluated: compactStats(source[1]),
            }]
            : [key, {
                status: "N/A",
                reason: "no valid all-off counterpart",
                control: null,
                evaluated: compactStats(naEvaluatedSources[key]),
            }];
    }));
    const stages = Object.fromEntries(Object.entries(stageCounts).map(([
        stage,
        { sampleCount },
    ]) => [stage, {
        status: "PASS",
        expectedCount: sampleCount,
        boundCount: sampleCount,
        violationCount: 0,
    }]));
    const databaseInstanceIdSha256 = sha256("compact-maintenance-database");
    const profileIdSha256 = sha256("char-phrase-v1");
    const rebuildOperationId = "lexreb-11111111111111111111111111111111";
    const incrementalOperationId = "lexinc-22222222222222222222222222222222";
    const rebuildBefore = {
        databaseInstanceIdSha256,
        profileIdSha256,
        generation: 1,
        sourceChunkEpoch: "7",
        chunkMutationEpoch: 7,
        indexMutationEpoch: 10,
        rebuildEpoch: 3,
        lexicalMaintenanceEpoch: 20,
        incrementalMaintenanceEpoch: 5,
        sourceChunkRows: 60,
        lexicalRows: 0,
        totalLexicalRows: 0,
    };
    const rebuildAfter = {
        ...rebuildBefore,
        indexMutationEpoch: 14,
        lexicalMaintenanceEpoch: 24,
        sourceChunkRows: 60,
        lexicalRows: 60,
        totalLexicalRows: 60,
    };
    const incrementalBefore = {
        ...rebuildAfter,
        sourceChunkRows: 1,
        lexicalRows: 1,
    };
    const incrementalAfter = {
        ...incrementalBefore,
        indexMutationEpoch: 15,
        lexicalMaintenanceEpoch: 25,
        incrementalMaintenanceEpoch: 6,
    };
    const rebuildOperation = {
        schemaVersion: 1,
        sequence: 1,
        kind: "rebuild",
        status: "completed",
        operationId: rebuildOperationId,
        scopeBindingSha256: sha256("synthetic-rebuild-scope-binding"),
        startedAt: "2026-08-11T00:00:10.000Z",
        finishedAt: "2026-08-11T00:00:20.000Z",
        durationMs: 100,
        state: "ready",
        inputSource: "indexed-chunks",
        before: rebuildBefore,
        after: rebuildAfter,
        effects: {
            source: "indexed-chunks",
            pathCount: 60,
            sourceChunkReads: 60,
            sourceChunkWrites: 0,
            lexicalRowsDeleted: 0,
            lexicalRowsInserted: 60,
            markdownReads: 0,
            markdownWrites: 0,
            providerCalls: 0,
            embeddingCalls: 0,
            embeddingWrites: 0,
        },
        resourceEnvelope: {
            estimatedDbBytesBefore: 1400,
            estimatedDbBytesPeak: 1600,
            estimatedDbBytesAfter: 1500,
        },
    };
    const incrementalOperation = {
        schemaVersion: 1,
        sequence: 2,
        kind: "indexed-chunks-incremental",
        status: "completed",
        operationId: incrementalOperationId,
        scopeBindingSha256: sha256(
            `b125-lexical-maintenance-v1\u0000${incrementalOperationId}\u0000${plan.maintenanceOperations.incrementalUpdate.fixturePath}`,
        ),
        startedAt: "2026-08-11T00:00:30.000Z",
        finishedAt: "2026-08-11T00:00:31.000Z",
        durationMs: 10,
        state: "ready",
        inputSource: "indexed-chunks",
        before: incrementalBefore,
        after: incrementalAfter,
        effects: {
            source: "indexed-chunks",
            pathCount: 1,
            sourceChunkReads: 1,
            sourceChunkWrites: 0,
            lexicalRowsDeleted: 1,
            lexicalRowsInserted: 1,
            markdownReads: 0,
            markdownWrites: 0,
            providerCalls: 0,
            embeddingCalls: 0,
            embeddingWrites: 0,
        },
        resourceEnvelope: {
            estimatedDbBytesBefore: 1500,
            estimatedDbBytesPeak: 1520,
            estimatedDbBytesAfter: 1510,
        },
    };
    const rebuildRuntimeEnvelope = {
        status: "PASS",
        stage: "rebuild",
        startedAt: "2026-08-11T00:00:09.000Z",
        finishedAt: "2026-08-11T00:00:21.000Z",
        publicApiDurationMs: 110,
        eventLoopStallMs: {
            samples: [1, 2],
            maximum: 2,
        },
    };
    const incrementalRuntimeEnvelope = {
        status: "PASS",
        stage: "incremental-update",
        startedAt: "2026-08-11T00:00:29.000Z",
        finishedAt: "2026-08-11T00:00:32.000Z",
        publicApiDurationMs: 12,
        eventLoopStallMs: {
            samples: [3],
            maximum: 3,
        },
    };
    const requiredEstimatedDbBytes = [
        ...stageMetrics.controlStandard.observations.estimatedDbBytes,
        rebuildOperation.resourceEnvelope.estimatedDbBytesBefore,
        rebuildOperation.resourceEnvelope.estimatedDbBytesPeak,
        rebuildOperation.resourceEnvelope.estimatedDbBytesAfter,
        incrementalOperation.resourceEnvelope.estimatedDbBytesBefore,
        incrementalOperation.resourceEnvelope.estimatedDbBytesPeak,
        incrementalOperation.resourceEnvelope.estimatedDbBytesAfter,
        ...stageMetrics.evaluatedStandard.observations.estimatedDbBytes,
        ...stageMetrics.evaluatedRetry.observations.estimatedDbBytes,
    ];
    const requiredEventLoopStallMs = [
        ...stageMetrics.controlStandard.observations.eventLoopStallMs,
        ...rebuildRuntimeEnvelope.eventLoopStallMs.samples,
        ...incrementalRuntimeEnvelope.eventLoopStallMs.samples,
        ...stageMetrics.evaluatedStandard.observations.eventLoopStallMs,
        ...stageMetrics.evaluatedRetry.observations.eventLoopStallMs,
    ];
    const stableSettingsProfileSha256 = sha256("synthetic-stable-settings-profile");
    const settingsBinding = (retrievalOptimizationFlags: Record<string, boolean>) => (
        sha256(canonicalJson({
            schemaVersion: 1,
            stableSettingsProfileSha256,
            retrievalOptimizationFlags,
        }))
    );
    return {
        schemaVersion: 1,
        planVersion: plan.version,
        planSha256: sha256(canonicalJson(plan)),
        machineStatus: "CANDIDATE",
        status: "READY_FOR_OWNER_REVIEW",
        ownerDisposition: {
            status: "PENDING",
            reason: null,
            trackerRecorded: false,
        },
        deviceBinding: null,
        settingsTransition: {
            status: "PASS",
            stableSettingsProfileSha256,
            controlSettingsBindingSha256: settingsBinding(plan.settingsPhases.control),
            evaluatedSettingsBindingSha256: settingsBinding(plan.settingsPhases.evaluated),
            fromFlags: { ...plan.settingsPhases.control },
            toFlags: { ...plan.settingsPhases.evaluated },
            transitionCount: 1,
            transitionedAt: syntheticStartedAt,
            cleanup: {
                status: "PASS",
                restoredFlags: { ...plan.settingsPhases.control },
                restoredAt: syntheticFinishedAt,
                reason: null,
            },
        },
        workloadBinding: {
            schemaVersion: 1,
            status: "PASS",
            expectedEpisodeCount: 33,
            boundEpisodeCount: 33,
            violationCount: 0,
            contractSha256: sha256(canonicalJson(plan.workload)),
            sequenceSha256: sha256(canonicalJson(sequence)),
            bindingSha256: sha256(canonicalJson(episodes)),
            stages,
            episodes,
        },
        metrics: {
            ...stageMetrics,
            comparison,
            requiredResourceEnvelope: {
                status: "PASS",
                includedStages: [
                    "controlStandard",
                    "rebuild",
                    "incremental-update",
                    "evaluatedStandard",
                    "evaluatedRetry",
                ],
                estimatedDbBytes: {
                    samples: requiredEstimatedDbBytes,
                    maximum: Math.max(...requiredEstimatedDbBytes),
                },
                eventLoopStallMs: {
                    samples: requiredEventLoopStallMs,
                    maximum: Math.max(...requiredEventLoopStallMs),
                },
            },
        },
        hardBudgets: {
            ...plan.hardBudgets,
            status: "PASS",
            violations: [],
        },
        maintenance: {
            status: "PASS",
            sourceMutationGuard: {
                status: "PASS",
                eventCount: 0,
            },
            rebuild: {
                status: "PASS",
                operation: rebuildOperation,
                operationBindingSha256: sha256(canonicalJson(rebuildOperation)),
                runtimeEnvelope: rebuildRuntimeEnvelope,
                estimatedDbBytesBefore: 1400,
                estimatedDbBytesPeak: 1600,
                estimatedDbBytesAfter: 1500,
                readyMarker: {
                    status: "ready",
                    lexicalProfileState: "ready",
                    lexicalProfileIdSha256: profileIdSha256,
                    lexicalGeneration: 1,
                },
                recordedAt: "2026-08-11T00:00:21.000Z",
                reason: null,
            },
            incrementalUpdate: {
                status: "PASS",
                operation: incrementalOperation,
                operationBindingSha256: sha256(canonicalJson(incrementalOperation)),
                runtimeEnvelope: incrementalRuntimeEnvelope,
                estimatedDbBytesBefore: 1500,
                estimatedDbBytesPeak: 1520,
                estimatedDbBytesAfter: 1510,
                readyMarker: {
                    status: "ready",
                    lexicalProfileState: "ready",
                    lexicalProfileIdSha256: profileIdSha256,
                    lexicalGeneration: 1,
                },
                recordedAt: "2026-08-11T00:00:32.000Z",
                reason: null,
            },
        },
        optionalDiagnostics: {
            processMemory: { status: "UNSUPPORTED", samples: [], maximum: null },
            heap: { status: "UNSUPPORTED", samples: [], maximum: null },
        },
    };
}

function createCompactSourceBinding(paths: string[], seed: string): Record<string, any> {
    return {
        evidenceSource: "sidellm-view.chatHistory",
        exactPromptMatched: true,
        turnStatus: "completed",
        successfulSearchMemoryToolResultCount: 1,
        selectedMemorySourceCount: paths.length,
        memorySourceRecordPathCount: paths.length,
        allowedMemorySourcePathCount: paths.length,
        sourceSetsMatch: true,
        opaqueRunCorrelationSha256: sha256(`compact-source-binding:${seed}`),
        diagnosticsRunMatched: true,
    };
}

function applyPassCompactCorrectnessSlices(receipt: Record<string, any>): void {
    receipt.rankingCases = Object.fromEntries(
        currentFixtureManifest.requiredRankingCases.map((id, index) => [id, {
            id,
            status: "PASS",
            rankedSources: [currentFixtureManifest.rankingCases[id].relevantPath],
            relevantRank: 1,
            reciprocalRank: 1,
            invalidSourceCount: 0,
            forbiddenHitCount: 0,
            evidence: {
                compactProxyPlanSha256: receipt.compactProxy.planSha256,
                startSequence: index * 10 + 1,
                endSequence: index * 10 + 5,
                finalDocumentCount: id === "lexical-title" ? 2 : 1,
                standardCallCount: 1,
                relaxedRetryCount: id === "lexical-title" ? 1 : 0,
                memoryAttemptCount: id === "lexical-title" ? 2 : 1,
                topology: {
                    droppedEventCount: 0,
                    episodeCount: 1,
                    unscopedEventCount: 0,
                    surfaceMismatchEventCount: 0,
                    episodeComplete: true,
                    hasCancellationEvidence: false,
                    invocationOrdinalBindingValid: true,
                    standardInvocationOrdinals: [0],
                    standardMemoryOutcomes: ["completed"],
                    standardMemoryReasons: [null],
                    standardMemoryDocumentCounts: [id === "lexical-title" ? 2 : 1],
                    standardOutcomes: ["completed"],
                    standardReasons: [null],
                    standardDocumentCounts: [id === "lexical-title" ? 2 : 1],
                    relaxedMemoryOutcome: id === "lexical-title" ? "completed" : null,
                    relaxedMemoryReason: id === "lexical-title" ? "semantic_none" : null,
                    relaxedMemoryDocumentCount: id === "lexical-title" ? 0 : null,
                    relaxedAfterStandardCallIndex: id === "lexical-title" ? 0 : null,
                    relaxedTerminalCount: id === "lexical-title" ? 1 : 0,
                    relaxedOutcome: id === "lexical-title" ? "completed" : null,
                    relaxedReason: id === "lexical-title" ? "semantic_none" : null,
                    relaxedDocumentCount: id === "lexical-title" ? 0 : null,
                    retryConsumed: id === "lexical-title",
                    projectionStartedCount: id === "lexical-title" ? 1 : 0,
                    projectionCompletedCount: id === "lexical-title" ? 1 : 0,
                    projectionOutcome: id === "lexical-title" ? "completed" : null,
                    projectionReason: null,
                    projectionDocumentCount: id === "lexical-title" ? 2 : null,
                    visibleMemoryResultDocumentCounts: [
                        id === "lexical-title" ? 2 : 1,
                    ],
                },
                sourceBinding: createCompactSourceBinding(
                    [currentFixtureManifest.rankingCases[id].relevantPath],
                    id,
                ),
                evidenceSha256: sha256(`ranking-evidence:${id}`),
            },
            recordedAt: syntheticFinishedAt,
        }]),
    );
    receipt.rerankerMetrics = {
        completed: 6,
        required: 6,
        recallAt8: 1,
        mrr: 1,
        forbiddenHitCount: 0,
    };
    const temporal = currentFixtureManifest.temporalRetryCase;
    receipt.temporalRetryCase = {
        id: "temporal-retry",
        status: "PASS",
        prompt: temporal.prompt,
        timeRange: temporal.timeRange,
        targetPath: temporal.targetPath,
        forbiddenPath: temporal.forbiddenPath,
        finalSources: [temporal.targetPath],
        standardSources: [],
        standardEvidenceMode: "valid-none",
        targetPresent: true,
        forbiddenHitCount: 0,
        invalidSourceCount: 0,
        duplicateSourceCount: 0,
        unexpectedSourceCount: 0,
        sourceBinding: createCompactSourceBinding(
            [temporal.targetPath],
            "temporal-retry",
        ),
        compactProxyPlanSha256: receipt.compactProxy.planSha256,
        topology: {
            schemaVersion: 1,
            capacity: 512,
            droppedEventCount: 0,
            eventCount: 8,
            episodeCount: 1,
            unscopedEventCount: 0,
            surfaceMismatchEventCount: 0,
            memoryAttemptCount: 2,
            memoryTerminalCount: 2,
            standardMemoryDocumentCount: 0,
            relaxedMemoryDocumentCount: 1,
            standardEvidenceMode: "valid-none",
            standardOutcome: "completed",
            standardDocumentCount: 0,
            standardTemporalFilterApplied: 1,
            standardTemporalViolationCount: 0,
            relaxedMemoryOutcome: "completed",
            relaxedRetryCount: 1,
            relaxedTerminalCount: 1,
            relaxedOutcome: "completed",
            relaxedDocumentCount: 1,
            relaxedTemporalFilterApplied: 1,
            relaxedTemporalViolationCount: 0,
            retryConsumed: true,
            projectionStartedCount: 1,
            projectionCompletedCount: 1,
            projectionOutcome: "completed",
            projectionDocumentCount: 1,
            projectionTemporalFilterApplied: 1,
            projectionTemporalViolationCount: 0,
        },
        evidenceSha256: sha256("compact-temporal-evidence"),
        detail: "valid synthetic structured temporal retry",
        recordedAt: syntheticFinishedAt,
    };
}

function promoteRankingToTwoStandardCalls(
    receipt: Record<string, any>,
    id = "temporal-2026",
): void {
    const evidence = receipt.rankingCases[id].evidence;
    evidence.standardCallCount = 2;
    evidence.memoryAttemptCount = 2;
    evidence.sourceBinding.successfulSearchMemoryToolResultCount = 2;
    evidence.topology.standardMemoryOutcomes = ["completed", "completed"];
    evidence.topology.standardInvocationOrdinals = [0, 1];
    evidence.topology.standardMemoryReasons = [null, null];
    evidence.topology.standardMemoryDocumentCounts = [1, 1];
    evidence.topology.standardOutcomes = ["completed", "completed"];
    evidence.topology.standardReasons = [null, null];
    evidence.topology.standardDocumentCounts = [1, 1];
    evidence.topology.visibleMemoryResultDocumentCounts = [1, 1];
}

function promoteRankingToTwoStandardCallsWithOneRetry(
    receipt: Record<string, any>,
    retryIndex: 0 | 1,
    id = "lexical-title",
): void {
    const evidence = receipt.rankingCases[id].evidence;
    evidence.standardCallCount = 2;
    evidence.relaxedRetryCount = 1;
    evidence.memoryAttemptCount = 3;
    evidence.sourceBinding.successfulSearchMemoryToolResultCount = 2;
    evidence.topology.standardMemoryOutcomes = ["completed", "completed"];
    evidence.topology.standardInvocationOrdinals = [0, 1];
    evidence.topology.standardMemoryReasons = [null, null];
    evidence.topology.standardMemoryDocumentCounts = [2, 2];
    evidence.topology.standardOutcomes = ["completed", "completed"];
    evidence.topology.standardReasons = [null, null];
    evidence.topology.standardDocumentCounts = [2, 2];
    evidence.topology.relaxedAfterStandardCallIndex = retryIndex;
    evidence.topology.visibleMemoryResultDocumentCounts = [2, 2];
}

function promoteTemporalToStrictPartial(
    receipt: Record<string, any>,
    projectionDocumentCount: number,
): void {
    const temporal = receipt.temporalRetryCase;
    const standardPath = currentFixtureManifest.temporalRetryCase
        .standardInsufficientPaths[0];
    temporal.finalSources = [standardPath, temporal.targetPath];
    temporal.standardSources = [standardPath];
    temporal.standardEvidenceMode = "strict-partial";
    temporal.sourceBinding = createCompactSourceBinding(
        temporal.finalSources,
        `temporal-strict-partial-${projectionDocumentCount}`,
    );
    temporal.topology.standardMemoryDocumentCount = 1;
    temporal.topology.standardDocumentCount = 1;
    temporal.topology.standardEvidenceMode = "strict-partial";
    temporal.topology.relaxedMemoryDocumentCount = 1;
    temporal.topology.relaxedDocumentCount = 1;
    temporal.topology.projectionDocumentCount = projectionDocumentCount;
}

function resetCompactCorrectnessSlicesToPending(receipt: Record<string, any>): void {
    receipt.rankingCases = Object.fromEntries(
        currentFixtureManifest.requiredRankingCases.map((id) => [id, {
            id,
            status: "PENDING",
            rankedSources: [],
            relevantRank: null,
            reciprocalRank: 0,
            invalidSourceCount: 0,
            forbiddenHitCount: 0,
            evidence: null,
            recordedAt: null,
        }]),
    );
    receipt.rerankerMetrics = {
        completed: 0,
        required: 6,
        recallAt8: 0,
        mrr: 0,
        forbiddenHitCount: 0,
    };
    const temporal = currentFixtureManifest.temporalRetryCase;
    receipt.temporalRetryCase = {
        id: "temporal-retry",
        status: "PENDING",
        prompt: temporal.prompt,
        timeRange: temporal.timeRange,
        targetPath: temporal.targetPath,
        forbiddenPath: temporal.forbiddenPath,
        finalSources: [],
        standardSources: [],
        standardEvidenceMode: null,
        targetPresent: false,
        forbiddenHitCount: 0,
        invalidSourceCount: 0,
        duplicateSourceCount: 0,
        unexpectedSourceCount: 0,
        topology: null,
        evidenceSha256: null,
        detail: "",
        recordedAt: null,
    };
}

function upgradeFixtureRootToCompactProxy(root: string): void {
    mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
        receipt.profile = "compact-proxy";
        receipt.overall = "BLOCKED";
        receipt.runtime.platformClass = "ios-real-device";
        receipt.runtime.runtimeFamily = "ios-wkwebview";
        receipt.identity.compactProxyPlanSha256 = sha256(canonicalJson(
            currentFixtureManifest.compactProxyPlan,
        ));
        receipt.compactProxy = createPassCompactProxy();
        receipt.compactProxy.deviceBinding = {
            status: "BOUND",
            deviceIdentitySha256: sha256("synthetic-compact-device"),
            platformClass: receipt.runtime.platformClass,
            runtimeFamily: receipt.runtime.runtimeFamily,
            runtimeIdentitySha256: sha256(canonicalJson({
                platformClass: receipt.runtime.platformClass,
                runtimeFamily: receipt.runtime.runtimeFamily,
                appBuildIdentitySha256: receipt.runtime.appBuildIdentitySha256,
                appVersion: receipt.runtime.appVersion,
                appVersionSource: receipt.runtime.appVersionSource,
                shellVersion: receipt.runtime.shellVersion,
                shellVersionSource: receipt.runtime.shellVersionSource,
            })),
        };
        applyPassCompactCorrectnessSlices(receipt);
        receipt.checks.push(
            {
                name: "Compact proxy runs on the required real-iPhone WKWebView runtime",
                status: "PASS",
                detail: "ios-real-device/ios-wkwebview",
            },
            {
                name: "Compact proxy binds one opaque real-iPhone device identity",
                status: "PASS",
                detail: "operator-provided opaque SHA-256 is frozen for this runner",
            },
            {
                name: "Compact proxy restores the initial flag profile before receipt commit",
                status: "PASS",
                detail: "the initial control profile is persisted",
            },
            {
                name: "Compact proxy observes every Vault Markdown mutation",
                status: "PASS",
                detail: "create/modify/delete/rename events are latched for the complete run",
            },
            {
                name: "Compact proxy observes no Vault Markdown mutation",
                status: "PASS",
                detail: "the frozen source input had zero create/modify/delete/rename events",
            },
            {
                name: "Compact proxy evidence is complete for owner review",
                status: "PASS",
                detail: "machine evidence remains CANDIDATE until owner disposition",
            },
        );
    });
}

function createSyntheticRecoveryCase(recordedAt: string): Record<string, any> {
    const prompt = currentFixtureManifest.recoveryCase.prompt;
    const targetPath = currentFixtureManifest.recoveryCase.targetPath;
    const finalSources = [targetPath];
    const sourceBinding = {
        evidenceSource: "sidellm-view.chatHistory",
        exactPromptMatched: true,
        turnStatus: "completed",
        successfulSearchMemoryToolResultCount: 1,
        selectedMemorySourceCount: 1,
        memorySourceRecordPathCount: 1,
        allowedMemorySourcePathCount: 1,
        sourceSetsMatch: true,
        opaqueRunCorrelationSha256: sha256("synthetic-recovery-correlation"),
        diagnosticsRunMatched: true,
    };
    const topology = {
        schemaVersion: 1,
        capacity: 512,
        droppedEventCount: 0,
        eventCount: 8,
        episodeCount: 1,
        unscopedEventCount: 0,
        surfaceMismatchEventCount: 0,
        memoryAttemptCount: 2,
        memoryTerminalCount: 2,
        standardMemoryDocumentCount: 0,
        relaxedMemoryDocumentCount: 1,
        standardEvidenceMode: "valid-none",
        standardOutcome: "completed",
        standardDocumentCount: 0,
        relaxedMemoryOutcome: "completed",
        relaxedRetryCount: 1,
        relaxedTerminalCount: 1,
        relaxedOutcome: "completed",
        relaxedDocumentCount: 1,
        retryConsumed: true,
        projectionStartedCount: 1,
        projectionCompletedCount: 1,
        projectionOutcome: "completed",
        projectionDocumentCount: 1,
    };
    const detail = "valid-none evidence union bound to one relaxed retry, two Memory attempts, and one completed projection";
    return {
        id: "chat-recovery",
        status: "PASS",
        prompt,
        targetPath,
        finalSources,
        standardSources: [],
        standardEvidenceMode: "valid-none",
        targetPresent: true,
        invalidSourceCount: 0,
        duplicateSourceCount: 0,
        opaqueHitCount: 0,
        unexpectedSourceCount: 0,
        a2FailureReason: null,
        sourceBinding,
        topology,
        evidenceSha256: sha256(JSON.stringify({
            prompt,
            targetPath,
            finalPaths: finalSources,
            sourceBinding,
            diagnostics: topology,
        })),
        detail,
        recordedAt,
    };
}

function createPassStrictDiagnostics(): {
    diagnostics: Record<string, any>;
    diagnosticsSummary: Record<string, any>;
} {
    const diagnosticsPlan = currentFixtureManifest.deviceMeasurementPlan.diagnosticsEvidence;
    const performanceProjection = (
        prefix: string,
        runCount: number,
        attemptsPerRun: number,
        durationOffset: number,
    ): Record<string, any> => {
        let sequence = 0;
        const events = Array.from({ length: runCount }).flatMap((_, runIndex) => {
            const runId = `${prefix}-${runIndex + 1}`;
            const attemptEvents = Array.from({ length: attemptsPerRun }, (_, attemptIndex) => {
                sequence += 1;
                return {
                    sequence,
                    elapsedMs: sequence,
                    runId,
                    invocationOrdinal: 0,
                    surface: "chat",
                    phase: "graph_worker",
                    outcome: "completed",
                    metrics: {
                        durationMs: durationOffset + sequence,
                        maxBatchDurationMs: durationOffset + sequence,
                        cancelRequested: 0,
                        acceptedCount: 1,
                        batchCount: 1,
                        chunkCount: 1,
                        queueWaitMs: attemptIndex,
                        workerDurationMs: durationOffset + sequence,
                    },
                };
            });
            sequence += 1;
            const started = {
                sequence,
                elapsedMs: sequence,
                runId,
                surface: "chat",
                phase: "finalization_reserve",
                outcome: "started",
                metrics: { configuredReserveMs: 100, remainingMs: 90 },
            };
            sequence += 1;
            const completed = {
                sequence,
                elapsedMs: sequence,
                runId,
                surface: "chat",
                phase: "finalization_reserve",
                outcome: "completed",
                metrics: { configuredReserveMs: 100, remainingMs: 50 },
            };
            return [...attemptEvents, started, completed];
        });
        return {
            schemaVersion: diagnosticsPlan.schemaVersion,
            capacity: diagnosticsPlan.requiredSessionCapacity,
            droppedEventCount: 0,
            events,
        };
    };
    const standardPerformance = performanceProjection(
        "strict-standard",
        diagnosticsPlan.standardPerformanceEpisodeCount,
        1,
        10,
    );
    const retryPerformanceBatches = diagnosticsPlan.retryPerformanceBatchEpisodeCounts.map(
        (runCount: number, index: number) => performanceProjection(
            `strict-retry-${index + 1}`,
            runCount,
            diagnosticsPlan.maximumMemorySearchAttemptsPerEpisode,
            40 + (index * 40),
        ),
    );
    const cancellationRunId = "strict-cancellation-1";
    const cancellationProbe = {
        schemaVersion: diagnosticsPlan.schemaVersion,
        capacity: diagnosticsPlan.requiredSessionCapacity,
        droppedEventCount: 0,
        events: [
            {
                sequence: 1, elapsedMs: 1, runId: cancellationRunId, surface: "chat",
                invocationOrdinal: 0,
                phase: "graph_worker", outcome: "started", metrics: { candidateCount: 1 },
            },
            {
                sequence: 2, elapsedMs: 2, runId: cancellationRunId, surface: "chat",
                invocationOrdinal: 0,
                phase: "graph_worker", outcome: "aborted", reason: "cancel_requested",
                metrics: { cancelRequested: 1, acceptedCount: 0 },
            },
            {
                sequence: 3, elapsedMs: 2.5, runId: cancellationRunId, surface: "chat",
                invocationOrdinal: 0,
                phase: "queue_release", outcome: "started", metrics: {},
            },
            {
                sequence: 4, elapsedMs: 4, runId: cancellationRunId, surface: "chat",
                invocationOrdinal: 0,
                phase: "graph_worker", outcome: "aborted", reason: "cancel_observed",
                metrics: { cancelRequested: 1, cancelObserved: 1, acceptedCount: 0 },
            },
            {
                sequence: 5, elapsedMs: 5, runId: cancellationRunId, surface: "chat",
                invocationOrdinal: 0,
                phase: "graph_worker", outcome: "late_discarded", reason: "late_result",
                metrics: { cancelRequested: 1, lateDiscardCount: 1, acceptedCount: 0 },
            },
            {
                sequence: 6, elapsedMs: 6, runId: cancellationRunId, surface: "chat",
                invocationOrdinal: 0,
                phase: "queue_release", outcome: "completed",
                metrics: { durationMs: 3.5, resultCount: 1 },
            },
            {
                sequence: 7, elapsedMs: 7, runId: cancellationRunId, surface: "chat",
                phase: "finalization_reserve", outcome: "skipped", reason: "reserve_not_entered",
                metrics: { configuredReserveMs: 100, remainingMs: 50 },
            },
        ],
    };
    const observedMaxBatchDurationMs = Math.max(
        ...standardPerformance.events.filter((event: Record<string, any>) => (
            event.phase === "graph_worker"
        )).map((event: Record<string, any>) => (
            event.metrics.maxBatchDurationMs
        )),
        ...retryPerformanceBatches.flatMap((projection: Record<string, any>) => (
            projection.events.filter((event: Record<string, any>) => (
                event.phase === "graph_worker"
            )).map((event: Record<string, any>) => (
                event.metrics.maxBatchDurationMs
            ))
        )),
    );
    return {
        diagnostics: {
            standardPerformance,
            retryPerformanceBatches,
            cancellationProbe,
        },
        diagnosticsSummary: {
            cancelRequested: 1,
            cancelObserved: 1,
            lateDiscardCount: 1,
            acceptedAfterCancelCount: 0,
            finalizationReserveBinding: {
                status: "VALID",
                configuredReserveMs: 100,
            },
            series: {
                finalizationConfiguredReserveMs: Array.from({
                    length: diagnosticsPlan.standardPerformanceEpisodeCount,
                }, () => 100),
                finalizationRemainingMs: Array.from({
                    length: diagnosticsPlan.standardPerformanceEpisodeCount,
                }, () => 50),
            },
            retrySeries: {
                finalizationConfiguredReserveMs: Array.from({
                    length: diagnosticsPlan.retryPerformanceEpisodeCount,
                }, () => 100),
                finalizationRemainingMs: Array.from({
                    length: diagnosticsPlan.retryPerformanceEpisodeCount,
                }, () => 50),
            },
            measurementEpisodes: {
                standardPerformance: {
                    status: "VALID",
                    episodeCount: diagnosticsPlan.standardPerformanceEpisodeCount,
                },
                retryPerformance: {
                    status: "VALID",
                    episodeCount: diagnosticsPlan.retryPerformanceEpisodeCount,
                },
                retryPerformanceBatches: diagnosticsPlan.retryPerformanceBatchEpisodeCounts.map(
                    (episodeCount: number) => ({ status: "VALID", episodeCount }),
                ),
                cancellationProbe: {
                    status: "VALID",
                    episodeCount: diagnosticsPlan.cancellationProbeEpisodeCount,
                    cancellationProbeEpisodeCount:
                        diagnosticsPlan.cancellationProbeEpisodeCount,
                    cancelToWorkerObservedMs: 2,
                    cancelToLateDiscardedMs: 3,
                    cancelToProbeCompletedMs: 4,
                    queueReleaseProbeResultCount: 1,
                    graphMaxBatchDurationMs: observedMaxBatchDurationMs,
                    graphQueueReleaseAbsoluteEnvelopeMs: 8_000,
                },
            },
        },
    };
}

function createSyntheticAppReceipt(): Record<string, any> {
    const recoveryCase = createSyntheticRecoveryCase(syntheticFinishedAt);
    return {
        fixtureVersion: currentFixtureManifest.fixtureVersion,
        startedAt: syntheticStartedAt,
        finishedAt: syntheticFinishedAt,
        overall: "PASS",
        runtime: {
            appVersion: "1.13.6",
            appVersionSource: "obsidian.apiVersion",
            loadedAppVersion: "1.13.6",
            loadedAppVersionSource: "obsidian.apiVersion",
            shellVersion: "1.12.7",
            shellVersionSource: "navigator.userAgent:obsidian/x",
            pluginVersion: currentPluginVersion,
            platform: "synthetic-desktop-runtime",
            platformClass: "desktop-or-other",
            runtimeFamily: "electron-renderer",
            runtimeVersions: {
                electron: "39.8.3",
                chrome: "142.0.0.0",
                node: "22.0.0",
            },
            runtimeProcess: {
                type: "renderer",
                platform: "darwin",
                arch: "arm64",
            },
            appBuildIdentitySha256: sha256("synthetic-app-build"),
            rerankerClass: "policy",
            rerankerIdentitySha256: sha256("synthetic-reranker"),
            memoryStatus: {
                status: "ready",
                indexedDocumentCount: 62,
                lexicalProfileState: "ready",
            },
        },
        identity: {
            manifestSha256: sha256("pending-manifest"),
            fixtureBundleSha256: sha256("pending-fixture-bundle"),
            runnerSha256: sha256("pending-runner"),
            pluginArtifactSha256: sha256("pending-plugin"),
            loadedPluginArtifactSha256: sha256("pending-plugin"),
            loadedPluginBuildIdentitySha256: sha256("pending-loaded-build"),
            deviceMeasurementPlanSha256: null,
            temporalFixtureMtimes: {},
        },
        checks: requiredAppIdentityChecks.map((name) => ({
            name,
            status: "PASS",
            detail: "",
        })),
        manualCases: {
            "chat-recovery": {
                id: "chat-recovery",
                status: recoveryCase.status,
                detail: recoveryCase.detail,
                recordedAt: recoveryCase.recordedAt,
            },
        },
        recoveryCase,
        pageletCases: {},
        deviceMeasurement: {
            overall: "PASS",
            metrics: {},
            rerankerGate: {},
            workloadBinding: null,
            runtimeEnvelope: null,
        },
    };
}

function createSyntheticOpfsSnapshot(
    pluginArtifactSha256: string,
    runnerArtifactSha256: string,
    runtime: {
        pid: number;
        mainProcessPid: number;
        timeOrigin: number;
        capturedAtPluginLoad: string;
    },
): Record<string, any> {
    return {
        status: "PASS",
        issues: [],
        runtime: {
            appVersion: "1.13.6",
            appVersionSource: "obsidian.apiVersion",
            shellVersion: "1.12.7",
            shellVersionSource: "navigator.userAgent:obsidian/x",
            electronVersion: "39.8.3",
            electronVersionSource: "process.versions.electron",
            platform: "darwin",
            arch: "arm64",
            processType: "renderer",
            pid: runtime.pid,
            mainProcessPid: runtime.mainProcessPid,
            mainProcessIdentitySource: "electron-renderer:process.ppid",
            timeOrigin: runtime.timeOrigin,
        },
        storage: {
            status: "ready",
            backend: "sqlite-wasm-opfs-sahpool",
            fallbackMode: false,
            storagePersistenceGrant: {
                persisted: true,
                role: "diagnostic-only-not-a-durable-ready-gate",
            },
            fileCount: 62,
            chunkCount: 124,
            estimatedDbBytes: 524_288,
            lexicalProfile: {
                id: "char-phrase-v1",
                state: "ready",
                generation: 1,
            },
            continuity: {
                databaseInstanceIdSha256: sha256("synthetic-database-instance"),
                indexIdSha256: sha256("synthetic-index"),
                indexBuiltAt: "2026-08-10T23:55:00.000Z",
                chunkMutationEpoch: 10,
                indexMutationEpoch: 20,
                rebuildEpoch: 0,
                lexicalMaintenanceEpoch: 3,
            },
            scopeIdentity: {
                databaseNameSha256: sha256("synthetic-database-name"),
                opfsDirectorySha256: sha256("synthetic-opfs-directory"),
                opfsVfsNameSha256: sha256("synthetic-opfs-vfs"),
                combinedSha256: sha256("synthetic-storage-scope"),
            },
        },
        plugin: {
            id: "personal-assistant",
            version: currentPluginVersion,
            artifactSha256: pluginArtifactSha256,
            loadedBuild: {
                schemaVersion: 1,
                pluginId: "personal-assistant",
                pluginVersion: currentPluginVersion,
                pluginArtifactPathSha256: sha256(
                    "pluginArtifactPath\0.obsidian/plugins/personal-assistant/main.js",
                ),
                loadedPluginArtifactSha256: pluginArtifactSha256,
                lexicalProfileRuntimeFingerprint: "char-phrase-v1:synthetic-runtime",
                capturedAtPluginLoad: runtime.capturedAtPluginLoad,
                identitySource: "plugin-onload-cached-main-js",
                blocker: null,
            },
        },
        runner: {
            path: "retrieval-opfs-restart-runner.js",
            artifactSha256: runnerArtifactSha256,
        },
    };
}

function createSyntheticOpfsEvidence(root: string): {
    baseline: Record<string, any>;
    receipt: Record<string, any>;
} {
    const pluginArtifactSha256 = sha256(readFileSync(join(root, "dist/main.js"), "utf8"));
    const runnerArtifactSha256 = sha256(readFileSync(
        join(root, "scripts/retrieval-opfs-restart-runner.js"),
        "utf8",
    ));
    const before = createSyntheticOpfsSnapshot(pluginArtifactSha256, runnerArtifactSha256, {
        pid: 101,
        mainProcessPid: 100,
        timeOrigin: 1_000,
        capturedAtPluginLoad: "2026-08-10T23:59:00.000Z",
    });
    const after = createSyntheticOpfsSnapshot(pluginArtifactSha256, runnerArtifactSha256, {
        pid: 202,
        mainProcessPid: 200,
        timeOrigin: 2_000,
        capturedAtPluginLoad: "2026-08-11T00:01:00.000Z",
    });
    const beforeAssertion = {
        id: "full-app-restart-window-before-v1",
        statement: "Synthetic operator assertion for a full desktop app restart fixture.",
        basis: "operator-attestation-not-independently-verified",
        confirmed: true,
        confirmedAt: syntheticStartedAt,
        status: "PASS",
    };
    const afterAssertion = {
        id: "full-app-restart-window-after-v1",
        statement: "Synthetic operator confirmation for a completed desktop app restart fixture.",
        basis: "operator-attestation-not-independently-verified",
        confirmed: true,
        confirmedAt: syntheticFinishedAt,
        status: "PASS",
    };
    const runIdentitySha256 = sha256(canonicalJson({
        capturedAt: syntheticStartedAt,
        pid: before.runtime.pid,
        mainProcessPid: before.runtime.mainProcessPid,
        timeOrigin: before.runtime.timeOrigin,
        pluginArtifactSha256,
        loadedPluginArtifactSha256: pluginArtifactSha256,
        runnerArtifactSha256,
        storageScopeSha256: before.storage.scopeIdentity.combinedSha256,
    }));
    const evidencePolicy = {
        contentFree: true,
        rawStorageScopeStored: false,
        invokedRunnerActions: ["synthetic fixture construction"],
        forbiddenRunnerActionsInvoked: [],
    };
    const limitations = ["Synthetic verifier fixture; not live runtime evidence."];
    const baseline: Record<string, any> = {
        schemaVersion: 1,
        receiptType: "personal-assistant-retrieval-opfs-restart",
        phase: "before",
        status: "PASS",
        runIdentitySha256,
        capturedAt: syntheticStartedAt,
        evidenceWindow: {
            startedAt: syntheticStartedAt,
            finishedAt: null,
            maximumDurationMs: 900_000,
        },
        operatorAssertion: beforeAssertion,
        snapshot: before,
        issues: [],
        evidencePolicy,
        limitations,
    };
    baseline.evidenceSha256 = sha256(canonicalJson(baseline));
    const baselineText = `${JSON.stringify(baseline, null, 2)}\n`;
    const receipt: Record<string, any> = {
        schemaVersion: 1,
        receiptType: "personal-assistant-retrieval-opfs-restart",
        phase: "after",
        status: "PASS",
        runIdentitySha256,
        capturedAt: syntheticFinishedAt,
        evidenceWindow: {
            startedAt: syntheticStartedAt,
            finishedAt: syntheticFinishedAt,
            durationMs: 120_000,
            maximumDurationMs: 900_000,
            withinMaximum: true,
        },
        operatorAssertions: {
            before: beforeAssertion,
            after: afterAssertion,
            status: "PASS",
        },
        baselineBinding: {
            path: "retrieval-opfs-restart-baseline.json",
            artifactSha256: sha256(baselineText),
            evidenceSha256: baseline.evidenceSha256,
            status: "PASS",
        },
        before,
        after,
        comparison: {
            status: "PASS",
            issues: [],
            fullAppRestart: {
                status: "PASS",
                pidChanged: true,
                mainProcessPidChanged: true,
                mainProcessIdentitySource: "electron-renderer:process.ppid",
                timeOriginChanged: true,
            },
            stableFields: Object.fromEntries(opfsStableFieldPaths.map((path) => [path, "PASS"])),
        },
        issues: [],
        evidencePolicy,
        limitations,
    };
    receipt.evidenceSha256 = sha256(canonicalJson(receipt));
    return { baseline, receipt };
}

function writeSyntheticEvidenceFiles(root: string): void {
    const { baseline, receipt } = createSyntheticOpfsEvidence(root);
    const appReceipt = createSyntheticAppReceipt();
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(
        join(root, "test/retrieval-optimization-smoke-result.json"),
        `${JSON.stringify(appReceipt, null, 2)}\n`,
    );
    writeFileSync(
        join(root, "test/retrieval-opfs-restart-baseline.json"),
        `${JSON.stringify(baseline, null, 2)}\n`,
    );
    writeFileSync(
        join(root, "test/retrieval-opfs-restart-receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`,
    );
}

function createPassPageletCase(
    id: string,
    definition: {
        entryPath: string;
        expectedInsightCount: number;
        sourcePaths: string[];
    },
    sequence: number,
    recordedAt: string,
): Record<string, any> {
    if (!Number.isSafeInteger(definition.expectedInsightCount)
        || definition.expectedInsightCount < 0
        || definition.sourcePaths.length !== definition.expectedInsightCount) {
        throw new Error(`Invalid Pagelet fixture contract: ${id}`);
    }
    const quiet = definition.expectedInsightCount === 0;
    const sourceBinding = {
        schemaVersion: 2,
        sequence,
        controllerSequence: sequence,
        runId: `fixture-${id}-run`,
        resultId: `fixture-${id}-result`,
        triggerReason: "explicit",
        force: true,
        resultStatus: quiet ? "quiet" : "verified",
        reason: quiet ? "no-insight" : null,
        runtimeCompletion: {
            loopStatus: "completed",
            endReason: "final_text_ready",
            diagnosticTypes: [],
            lastTurnStatus: "completed",
            providerStopReason: "stop",
            finalTextState: quiet ? "no-insight" : "candidate",
            citationCoverage: quiet ? "not-applicable" : "complete",
            turnCount: 3,
            toolCallCount: quiet ? 1 : 3,
            insightDraftCount: definition.expectedInsightCount,
            emptyFinalAnswerRetryCount: 0,
        },
        collectionId: quiet ? null : `fixture-${id}-collection`,
    };
    const insights = definition.sourcePaths.map((sourcePath, index) => {
        const insightId = `fixture-${id}-insight-${index + 1}`;
        const deliveryReceipt = {
            version: 1,
            kind: "review",
            fingerprint: `v1:review:${sha256(`fixture-${id}-${index + 1}`).slice(0, 16)}`,
        };
        const receiptHash = sha256(stableStringify(deliveryReceipt));
        return {
            insightId,
            candidateId: insightId,
            sourcePaths: [definition.entryPath, sourcePath],
            deliveryReceipt,
            deliveryReceiptSha256: receiptHash,
            verified: true,
        };
    });
    const candidateCount = definition.expectedInsightCount;
    const deliveryReceiptCount = definition.expectedInsightCount;
    const cacheMutationCount = quiet ? 0 : 1;
    const cacheEntryCountBefore = 10;
    const cacheEntryCountAfter = quiet ? cacheEntryCountBefore : cacheEntryCountBefore + 1;
    const quietWriteInvariantSatisfied = quiet;
    const evidenceSha256 = sha256(JSON.stringify({
        id,
        entryPath: definition.entryPath,
        sourceBinding,
        candidateCount,
        deliveryReceiptCount,
        cacheMutationCount,
        cacheEntryCountBefore,
        cacheEntryCountAfter,
        quietWriteInvariantSatisfied,
        insights,
    }));
    const detail = `${definition.expectedInsightCount} production Pagelet insight receipt(s) bound to controller sequence ${sequence}`;
    return {
        id,
        status: "PASS",
        entryPath: definition.entryPath,
        expectedInsightCount: definition.expectedInsightCount,
        observedInsightCount: definition.expectedInsightCount,
        verifiedInsightCount: definition.expectedInsightCount,
        insights,
        invalidInsightCount: 0,
        invalidSourceCount: 0,
        duplicateInsightIdCount: 0,
        duplicateCandidateCount: 0,
        duplicateReceiptCount: 0,
        duplicateSourceCount: 0,
        opaqueHitCount: 0,
        unexpectedSourceCount: 0,
        candidateCount,
        deliveryReceiptCount,
        cacheMutationCount,
        cacheEntryCountBefore,
        cacheEntryCountAfter,
        quietWriteInvariantSatisfied,
        sourceBinding,
        evidenceSha256,
        detail,
        recordedAt,
    };
}

function resealPageletCase(pageletCase: Record<string, any>): void {
    pageletCase.evidenceSha256 = sha256(JSON.stringify({
        id: pageletCase.id,
        entryPath: pageletCase.entryPath,
        sourceBinding: pageletCase.sourceBinding,
        candidateCount: pageletCase.candidateCount,
        deliveryReceiptCount: pageletCase.deliveryReceiptCount,
        cacheMutationCount: pageletCase.cacheMutationCount,
        cacheEntryCountBefore: pageletCase.cacheEntryCountBefore,
        cacheEntryCountAfter: pageletCase.cacheEntryCountAfter,
        quietWriteInvariantSatisfied: pageletCase.quietWriteInvariantSatisfied,
        insights: pageletCase.insights,
    }));
}

function upgradeFixtureRootToCurrentContract(root: string): void {
    const runnerText = readFileSync(
        join(repositoryRoot, "scripts/retrieval-optimization-smoke-runner.js"),
        "utf8",
    );
    const manifestText = readFileSync(
        join(repositoryRoot, "__fixtures__/retrieval-smoke/manifest.json"),
        "utf8",
    );
    const pluginArtifactSha256 = createHash("sha256")
        .update(readFileSync(join(root, "dist/main.js")))
        .digest("hex");
    replaceFixture(root, "test/retrieval-optimization-smoke-runner.js", runnerText);
    replaceFixture(root, "test/retrieval-optimization-smoke-manifest.json", manifestText);
    mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
        const plan = currentFixtureManifest.deviceMeasurementPlan;
        receipt.fixtureVersion = currentFixtureManifest.fixtureVersion;
        receipt.overall = "PASS";
        receipt.identity.pluginArtifactSha256 = pluginArtifactSha256;
        receipt.identity.loadedPluginArtifactSha256 = pluginArtifactSha256;
        receipt.identity.loadedPluginBuildIdentitySha256 = sha256(canonicalJson({
            pluginArtifactSha256,
        }));
        receipt.identity.manifestSha256 = sha256(manifestText);
        receipt.identity.fixtureBundleSha256 = sha256(JSON.stringify(
            Object.entries(currentFixtureManifest.files).sort(([left], [right]) => (
                left < right ? -1 : left > right ? 1 : 0
            )),
        ));
        receipt.identity.runnerSha256 = sha256(runnerText);
        receipt.identity.temporalFixtureMtimes = {
            ...currentFixtureManifest.temporalFixtureMtimes,
        };
        receipt.deviceMeasurement.overall = "PASS";
        receipt.deviceMeasurement.planVersion = plan.version;
        receipt.deviceMeasurement.planStatus = "FROZEN";
        receipt.deviceMeasurement.percentileMethod = plan.percentileMethod;
        receipt.deviceMeasurement.warmupSamples = plan.warmupSamples;
        receipt.deviceMeasurement.sampleCount = plan.sampleCount;
        receipt.deviceMeasurement.performanceSurface = plan.diagnosticsEvidence.performanceSurface;
        receipt.deviceMeasurement.diagnosticsGate = {
            status: "PASS",
            reason: "fixture contract evidence is complete",
            schemaVersion: plan.diagnosticsEvidence.schemaVersion,
            capacity: plan.diagnosticsEvidence.requiredSessionCapacity,
        };
        receipt.deviceMeasurement.metrics = Object.fromEntries([
            ...plan.requiredMetrics.map((definition: Record<string, any>) => [
                definition.id,
                createPassDeviceMetric(definition, receipt.finishedAt),
            ]),
            ...plan.optionalMetrics.map((definition: Record<string, any>) => [
                definition.id,
                createPendingDeviceMetric(definition),
            ]),
        ]);
        receipt.deviceMeasurement.rerankerGate = {
            status: "PASS",
            reason: "fixture reranker gate is satisfied",
            minimumMrr: 0,
            flagOffBaselineMrr: null,
            maximumMrrRegression: null,
        };
        const planSha256 = sha256(canonicalJson(projectDevicePlanForReceipt(
            frozenPlanFromReceipt(receipt),
        )));
        receipt.deviceMeasurement.planSha256 = planSha256;
        receipt.identity.deviceMeasurementPlanSha256 = planSha256;
        receipt.deviceMeasurement.workloadBinding = createPassWorkloadBinding();
        receipt.deviceMeasurement.runtimeEnvelope = createPassRuntimeEnvelope(receipt);
        const strictDiagnostics = createPassStrictDiagnostics();
        receipt.deviceMeasurement.diagnostics = strictDiagnostics.diagnostics;
        receipt.deviceMeasurement.diagnosticsSummary = strictDiagnostics.diagnosticsSummary;
        const strictProjectionStages: Array<[string, Record<string, any>]> = [
            ["standardPerformance", strictDiagnostics.diagnostics.standardPerformance],
            ["retryPerformanceBatch1", strictDiagnostics.diagnostics.retryPerformanceBatches[0]],
            ["retryPerformanceBatch2", strictDiagnostics.diagnostics.retryPerformanceBatches[1]],
            ["cancellationProbe", strictDiagnostics.diagnostics.cancellationProbe],
        ];
        for (const [stage, projection] of strictProjectionStages) {
            const runIds = [...new Set(projection.events.map(
                (event: Record<string, any>) => event.runId,
            ))];
            const entries = receipt.deviceMeasurement.workloadBinding.episodes.filter(
                (entry: Record<string, any>) => entry.stage === stage,
            );
            entries.forEach((entry: Record<string, any>, index: number) => {
                entry.opaqueCorrelationSha256 = sha256(
                    `retrieval-performance-run\u0000${runIds[index]}`,
                );
            });
        }
        resealWorkloadBinding(receipt.deviceMeasurement.workloadBinding);
        receipt.pageletCases = receipt.pageletCases ?? {};
        receipt.manualCases = receipt.manualCases ?? {};
        Object.entries(currentFixtureManifest.pageletCases).forEach(([
            id,
            definition,
        ], index) => {
            const pageletCase = createPassPageletCase(
                id,
                definition,
                index + 1,
                receipt.finishedAt,
            );
            receipt.pageletCases[id] = pageletCase;
            receipt.manualCases[id] = {
                id,
                status: pageletCase.status,
                detail: pageletCase.detail,
                recordedAt: pageletCase.recordedAt,
            };
        });
    });
    mutateBoundOpfsEvidence(root, (baseline, receipt) => {
        const updatePlugin = (snapshot: Record<string, any>) => {
            snapshot.plugin.artifactSha256 = pluginArtifactSha256;
            snapshot.plugin.loadedBuild.loadedPluginArtifactSha256 = pluginArtifactSha256;
        };
        updatePlugin(baseline.snapshot);
        updatePlugin(receipt.after);
        baseline.runIdentitySha256 = sha256(canonicalJson({
            capturedAt: baseline.capturedAt,
            pid: baseline.snapshot.runtime.pid,
            mainProcessPid: baseline.snapshot.runtime.mainProcessPid,
            timeOrigin: baseline.snapshot.runtime.timeOrigin,
            pluginArtifactSha256,
            loadedPluginArtifactSha256: pluginArtifactSha256,
            runnerArtifactSha256: baseline.snapshot.runner.artifactSha256,
            storageScopeSha256: baseline.snapshot.storage.scopeIdentity.combinedSha256,
        }));
    });
}

function bindExternalMemoryEvidence(root: string): {
    artifactPath: string;
    rawExportPath: string;
} {
    const artifactPath = "test/retrieval-smoke/evidence/system-memory-envelope.json";
    const rawExportPath =
        "test/retrieval-smoke/evidence/system-memory-envelope.instruments.xml";
    const receiptRawExportPath = rawExportPath.slice("test/".length);
    const rawExportBytes = Buffer.from([
        0x00, 0xff, 0x49, 0x6e, 0x73, 0x74, 0x72, 0x75, 0x6d, 0x65, 0x6e, 0x74, 0x73,
    ]);
    const rawExportSha256 = createHash("sha256").update(rawExportBytes).digest("hex");
    const receipt = JSON.parse(readFileSync(
        join(root, "test/retrieval-optimization-smoke-result.json"),
        "utf8",
    )) as Record<string, any>;
    const contract = currentFixtureManifest.deviceMeasurementPlan.externalMemoryEvidence;
    const windowStartedAt = receipt.startedAt;
    const windowFinishedAt = new Date(Date.parse(windowStartedAt) + 1_000).toISOString();
    const samples = [32_000_000, 33_000_000];
    const artifact = {
        schemaVersion: 1,
        collectorKind: "system-memory-profiler",
        tool: "Xcode Instruments",
        toolVersion: "16.4",
        platform: "iOS 18.6",
        platformClass: contract.requiredPlatformClass,
        runtimeFamily: contract.requiredRuntimeFamily,
        counter: contract.counter,
        unit: contract.unit,
        processName: contract.processName,
        appBundleId: contract.appBundleId,
        appVersion: receipt.runtime.appVersion,
        appBuildIdentitySha256: receipt.runtime.appBuildIdentitySha256,
        pluginId: "personal-assistant",
        pluginVersion: receipt.runtime.pluginVersion,
        pluginArtifactSha256: receipt.identity.pluginArtifactSha256,
        runnerSha256: receipt.identity.runnerSha256,
        deviceIdentitySha256: sha256("ios-device-fixture"),
        windowStartedAt,
        windowFinishedAt,
        sampleIntervalMs: 1_000,
        samples,
        rawExportPath: receiptRawExportPath,
        rawExportSha256,
    };
    const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
    mkdirSync(dirname(join(root, artifactPath)), { recursive: true });
    writeFileSync(join(root, rawExportPath), rawExportBytes);
    writeFileSync(join(root, artifactPath), artifactText);
    mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
        receipt.runtime.platformClass = artifact.platformClass;
        receipt.runtime.runtimeFamily = artifact.runtimeFamily;
        receipt.deviceMeasurement.runtimeEnvelope = {
            status: "BLOCKED",
            workloadCoverageStatus: "PASS",
            reason: "external_memory_converter_unverified",
            startedAt: windowStartedAt,
            finishedAt: windowFinishedAt,
            sourceCoverage: {
                database: "PASS",
                processMemory: "BLOCKED",
                eventLoopStall: "PASS",
            },
            iosEvidenceStatus: "BLOCKED",
            externalMemoryCapturePrecondition: {
                status: "PASS",
                checkedAt: receipt.startedAt,
                artifactPath: artifactPath.slice("test/".length),
                artifactAbsent: true,
                rawExportPath: receiptRawExportPath,
                rawExportAbsent: true,
            },
            externalMemoryEnvelope: {
                schemaVersion: artifact.schemaVersion,
                collectorKind: artifact.collectorKind,
                tool: artifact.tool,
                toolVersion: artifact.toolVersion,
                platform: artifact.platform,
                platformClass: artifact.platformClass,
                runtimeFamily: artifact.runtimeFamily,
                counter: artifact.counter,
                unit: artifact.unit,
                processName: artifact.processName,
                appBundleId: artifact.appBundleId,
                appVersion: artifact.appVersion,
                appBuildIdentitySha256: artifact.appBuildIdentitySha256,
                pluginId: artifact.pluginId,
                pluginVersion: artifact.pluginVersion,
                pluginArtifactSha256: artifact.pluginArtifactSha256,
                runnerSha256: artifact.runnerSha256,
                deviceIdentitySha256: artifact.deviceIdentitySha256,
                windowStartedAt: artifact.windowStartedAt,
                windowFinishedAt: artifact.windowFinishedAt,
                sampleIntervalMs: artifact.sampleIntervalMs,
                artifactSha256: sha256(artifactText),
                rawExportPath: receiptRawExportPath,
                rawExportSha256,
                sampleCount: samples.length,
                evidenceSource: `external-system-memory-profiler:${artifact.tool}`,
                finalizationVerificationStatus: "PASS",
                lifecycleGuardStatus: "PASS",
                evidenceCutoffAt: receipt.finishedAt,
                evidenceCutoffStatus: "PASS",
            },
        };
        receipt.overall = "BLOCKED";
        receipt.deviceMeasurement.overall = "BLOCKED";
        receipt.deviceMeasurement.metrics["memory.peakProcessFootprintBytes"] = {
            ...receipt.deviceMeasurement.metrics["memory.peakProcessFootprintBytes"],
            method: "unsupported",
            evidenceSource: "external-memory-converter-unverified",
            status: "BLOCKED",
            reason: "external_memory_converter_unverified",
            rawSamples: [],
            evaluatedSamples: [],
            p50: null,
            p95: null,
            minimum: null,
            maximum: null,
        };
        const planSha256 = sha256(canonicalJson(projectDevicePlanForReceipt(
            frozenPlanFromReceipt(receipt, artifact.deviceIdentitySha256),
        )));
        receipt.deviceMeasurement.planSha256 = planSha256;
        receipt.identity.deviceMeasurementPlanSha256 = planSha256;
    });
    return { artifactPath, rawExportPath };
}

function bindBlockedExternalMemoryEvidence(root: string): {
    artifactPath: string;
    rawExportPath: string;
} {
    const paths = bindExternalMemoryEvidence(root);
    mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
        const runtimeEnvelope = receipt.deviceMeasurement.runtimeEnvelope;
        const legacyBinding = runtimeEnvelope.externalMemoryEnvelope;
        receipt.overall = "BLOCKED";
        receipt.deviceMeasurement.overall = "BLOCKED";
        runtimeEnvelope.status = "BLOCKED";
        runtimeEnvelope.reason = "external_memory_converter_unverified";
        runtimeEnvelope.iosEvidenceStatus = "BLOCKED";
        runtimeEnvelope.sourceCoverage.processMemory = "BLOCKED";
        runtimeEnvelope.externalMemoryCapturePrecondition.reason =
            "external memory artifacts were absent before profiler capture started";
        receipt.deviceMeasurement.metrics["memory.peakProcessFootprintBytes"] = {
            ...receipt.deviceMeasurement.metrics["memory.peakProcessFootprintBytes"],
            method: "unsupported",
            evidenceSource: "external-memory-converter-unverified",
            status: "BLOCKED",
            reason: "external_memory_converter_unverified",
            rawSamples: [],
            evaluatedSamples: [],
            p50: null,
            p95: null,
            minimum: null,
            maximum: null,
        };
        runtimeEnvelope.externalMemoryEnvelope = {
            schemaVersion: 1,
            status: "BLOCKED",
            reason: "external_memory_converter_unverified",
            artifactPath: paths.artifactPath.slice("test/".length),
            artifactSha256: legacyBinding.artifactSha256,
            rawExportPath: paths.rawExportPath.slice("test/".length),
            rawExportSha256: legacyBinding.rawExportSha256,
            deviceIdentitySha256: legacyBinding.deviceIdentitySha256,
        };
    });
    return paths;
}

function replaceFixture(root: string, relativePath: string, value: string): void {
    const target = join(root, relativePath);
    const replacement = `${target}.replacement`;
    writeFileSync(replacement, value);
    renameSync(replacement, target);
}

function mutateJson(
    root: string,
    relativePath: string,
    mutate: (document: Record<string, any>) => void,
    sealOpfs = false,
): void {
    const document = JSON.parse(
        readFileSync(join(root, relativePath), "utf8"),
    ) as Record<string, any>;
    mutate(document);
    if (sealOpfs) {
        delete document.evidenceSha256;
        document.evidenceSha256 = sha256(canonicalJson(document));
    }
    replaceFixture(root, relativePath, `${JSON.stringify(document, null, 2)}\n`);
}

function mutateBoundOpfsEvidence(
    root: string,
    mutate: (
        baseline: Record<string, any>,
        receipt: Record<string, any>,
    ) => void,
): void {
    const baselinePath = "test/retrieval-opfs-restart-baseline.json";
    const receiptPath = "test/retrieval-opfs-restart-receipt.json";
    const baseline = JSON.parse(readFileSync(join(root, baselinePath), "utf8"));
    const receipt = JSON.parse(readFileSync(join(root, receiptPath), "utf8"));
    mutate(baseline, receipt);

    delete baseline.evidenceSha256;
    baseline.evidenceSha256 = sha256(canonicalJson(baseline));
    const baselineText = `${JSON.stringify(baseline, null, 2)}\n`;
    replaceFixture(root, baselinePath, baselineText);

    receipt.before = JSON.parse(JSON.stringify(baseline.snapshot));
    receipt.runIdentitySha256 = baseline.runIdentitySha256;
    receipt.evidenceWindow.startedAt = baseline.capturedAt;
    receipt.operatorAssertions.before = JSON.parse(JSON.stringify(
        baseline.operatorAssertion,
    ));
    receipt.baselineBinding.artifactSha256 = sha256(baselineText);
    receipt.baselineBinding.evidenceSha256 = baseline.evidenceSha256;
    receipt.baselineBinding.status = "PASS";
    delete receipt.evidenceSha256;
    receipt.evidenceSha256 = sha256(canonicalJson(receipt));
    replaceFixture(root, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function blockedOpfsComparison(): Record<string, any> {
    return {
        status: "BLOCKED",
        issues: [{ code: "comparison_unavailable", status: "BLOCKED" }],
        fullAppRestart: {
            status: "BLOCKED",
            pidChanged: null,
            mainProcessPidChanged: null,
            mainProcessIdentitySource: "electron-renderer:process.ppid",
            timeOriginChanged: null,
        },
        stableFields: {},
    };
}

function runVerifier(root?: string): {
    processStatus: number | null;
    result: VerificationResult;
} {
    const args = [verifierPath, "--json"];
    if (root) args.push("--root", root);
    const run = spawnSync(process.execPath, args, {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
    });
    if (run.error) throw run.error;
    return {
        processStatus: run.status,
        result: JSON.parse(run.stdout) as VerificationResult,
    };
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(",")}}`;
}

describe("retrieval evidence receipt current-artifact verifier", () => {
    it("passes a self-contained current-contract fixture without claiming live process currentness", () => {
        const root = createFixtureRoot();
        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(0);
        expect(result).toMatchObject({
            status: "PASS",
            exitCode: 0,
            errorCode: null,
            claim: {
                receiptBoundArtifactsMatchCurrentDisk: true,
                liveProcessCurrentnessClaimed: false,
                appReceiptCryptographicSealClaimed: false,
                appReceiptAuthenticityVerified: false,
                appRecoveryEvidenceDigestRecomputed: false,
            },
            receipts: {
                app: {
                    status: "PASS",
                    workloadBinding: {
                        status: "PASS",
                        bindingStatus: "PASS",
                        expectedEpisodeCount: 47,
                        boundEpisodeCount: 47,
                        qualificationStatus: "PASS",
                        violationCount: 0,
                    },
                    externalMemoryBinding: {
                        status: "NOT_APPLICABLE",
                        bindingPresent: false,
                    },
                },
                opfs: {
                    status: "PASS",
                    receiptStatus: "PASS",
                    rawComparison: {
                        stableFieldCount: 43,
                        stableFieldPassCount: 43,
                        fullAppRestartStatus: "PASS",
                    },
                },
                opfsBaseline: { status: "PASS", receiptStatus: "PASS" },
            },
            artifacts: {
                fixtureBundle: {
                    status: "PASS",
                    expectedFileCount: Object.keys(currentFixtureManifest.files).length,
                    verifiedFileCount: Object.keys(currentFixtureManifest.files).length,
                    temporalExpectedCount:
                        Object.keys(currentFixtureManifest.temporalFixtureMtimes).length,
                    temporalVerifiedCount:
                        Object.keys(currentFixtureManifest.temporalFixtureMtimes).length,
                },
            },
            blockers: [],
            failures: [],
            integrityErrors: [],
        });
    });

    it("keeps a machine-complete compact proxy CANDIDATE blocked only on owner disposition", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result).toMatchObject({
            status: "BLOCKED",
            exitCode: 2,
            errorCode: null,
            receipts: {
                app: {
                    status: "BLOCKED",
                    receiptOverall: "BLOCKED",
                    profile: "compact-proxy",
                    compactProxy: {
                        status: "BLOCKED",
                        profile: "compact-proxy",
                        planVersion: "b125-compact-proxy-v1",
                        machineStatus: "CANDIDATE",
                        completionStatus: "READY_FOR_OWNER_REVIEW",
                        expectedEpisodeCount: 33,
                        boundEpisodeCount: 33,
                        ownerDispositionStatus: "PENDING",
                    },
                    correctnessSlices: { status: "PASS" },
                    deviceMeasurementPlan: { status: "NOT_APPLICABLE" },
                    workloadBinding: { status: "NOT_APPLICABLE" },
                    externalMemoryBinding: {
                        status: "OPTIONAL_NOT_REQUIRED",
                        bindingPresent: false,
                    },
                },
            },
            blockers: ["app_compact_proxy_owner_disposition_required"],
            failures: [],
            integrityErrors: [],
        });
    });

    it("keeps a runner-shaped incomplete compact proxy BLOCKED without an integrity error", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const compact = receipt.compactProxy;
            compact.status = "BLOCKED";
            compact.settingsTransition.status = "PENDING";
            compact.settingsTransition.transitionCount = 0;
            compact.settingsTransition.transitionedAt = null;
            compact.settingsTransition.cleanup = {
                status: "NOT_REQUIRED",
                restoredFlags: {
                    ...currentFixtureManifest.compactProxyPlan.settingsPhases.control,
                },
                restoredAt: null,
                reason: null,
            };
            compact.workloadBinding.status = "PENDING";
            compact.workloadBinding.boundEpisodeCount = 0;
            compact.workloadBinding.episodes = [];
            compact.workloadBinding.bindingSha256 = sha256(canonicalJson([]));
            for (const summary of Object.values(
                compact.workloadBinding.stages as Record<string, Record<string, any>>,
            )) {
                summary.status = "PENDING";
                summary.boundCount = 0;
            }
            for (const metric of Object.values(
                compact.metrics as Record<string, Record<string, any>>,
            ).filter((entry) => Object.prototype.hasOwnProperty.call(
                entry,
                "observations",
            ))) {
                metric.status = "PENDING";
                metric.sampleCount = 0;
                metric.warmupCount = 0;
                metric.measuredCount = 0;
                metric.observations = Object.fromEntries(
                    compactStageObservationKeys.map((key) => [key, []]),
                );
            }
            compact.metrics.comparison = Object.fromEntries(Object.keys(
                compact.metrics.comparison,
            ).map((key) => [key, {
                status: "N/A",
                reason: "the metric is not present in both compact phases",
                control: null,
                evaluated: null,
            }]));
            compact.metrics.requiredResourceEnvelope = {
                status: "PENDING",
                includedStages: [],
                estimatedDbBytes: { samples: [], maximum: null },
                eventLoopStallMs: { samples: [], maximum: null },
            };
            compact.hardBudgets.status = "PENDING";
            compact.maintenance.status = "PENDING";
            for (const entry of [
                compact.maintenance.rebuild,
                compact.maintenance.incrementalUpdate,
            ]) {
                entry.status = "PENDING";
                entry.operation = null;
                entry.operationBindingSha256 = null;
                entry.runtimeEnvelope = null;
                entry.estimatedDbBytesBefore = null;
                entry.estimatedDbBytesPeak = null;
                entry.estimatedDbBytesAfter = null;
                entry.readyMarker = null;
                entry.recordedAt = null;
                entry.reason = null;
            }
            for (const check of receipt.checks) {
                if ([
                    "Compact proxy restores the initial flag profile before receipt commit",
                    "Compact proxy evidence is complete for owner review",
                ].includes(check.name)) {
                    check.status = "BLOCKED";
                }
            }
            resetCompactCorrectnessSlicesToPending(receipt);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.integrityErrors).toEqual([]);
        expect(result.blockers).toEqual(expect.arrayContaining([
            "app_compact_proxy_settings_transition_incomplete",
            "app_compact_proxy_workload_incomplete",
            "app_compact_proxy_not_ready",
        ]));
    });

    it("does not reinterpret a strict v9 receipt merely because the manifest has a compact plan", () => {
        const root = createFixtureRoot();
        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(0);
        expect(result.receipts.app).toMatchObject({
            status: "PASS",
            profile: "strict-v9",
            compactProxy: { status: "NOT_APPLICABLE" },
            workloadBinding: {
                expectedEpisodeCount: 47,
                boundEpisodeCount: 47,
            },
        });
    });

    it("accepts a compact real-iOS runtime whose strong plain Obsidian token has no shell version", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.runtime.shellVersion = null;
            receipt.runtime.shellVersionSource = null;
            receipt.compactProxy.deviceBinding.runtimeIdentitySha256 = sha256(canonicalJson({
                platformClass: receipt.runtime.platformClass,
                runtimeFamily: receipt.runtime.runtimeFamily,
                appBuildIdentitySha256: receipt.runtime.appBuildIdentitySha256,
                appVersion: receipt.runtime.appVersion,
                appVersionSource: receipt.runtime.appVersionSource,
                shellVersion: null,
                shellVersionSource: null,
            }));
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.integrityErrors).toEqual([]);
        expect(result.blockers).toEqual([
            "app_compact_proxy_owner_disposition_required",
        ]);
    });

    it("keeps compact performance READY while independent correctness is missing", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            resetCompactCorrectnessSlicesToPending(receipt);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.integrityErrors).toEqual([]);
        expect(result.receipts.app.compactProxy?.completionStatus).toBe(
            "READY_FOR_OWNER_REVIEW",
        );
        expect(result.blockers).toEqual(expect.arrayContaining([
            "app_compact_proxy_owner_disposition_required",
            "app_compact_proxy_ranking_evidence_missing",
            "app_compact_proxy_temporal_evidence_missing",
        ]));
    });

    it("allows independent correctness evidence before compact performance", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            for (const entry of Object.values(
                receipt.rankingCases as Record<string, Record<string, any>>,
            )) {
                entry.recordedAt = "2026-08-11T00:00:05.000Z";
            }
            receipt.temporalRetryCase.recordedAt = "2026-08-11T00:00:05.000Z";
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.integrityErrors).toEqual([]);
        expect(result.blockers).toEqual([
            "app_compact_proxy_owner_disposition_required",
        ]);
    });

    it("accepts two projected temporal documents from one unique source path", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const topology = receipt.temporalRetryCase.topology;
            topology.relaxedMemoryDocumentCount = 2;
            topology.relaxedDocumentCount = 2;
            topology.projectionDocumentCount = 2;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.integrityErrors).toEqual([]);
        expect(result.blockers).toEqual([
            "app_compact_proxy_owner_disposition_required",
        ]);
    });

    it("accepts one standard-only ranking episode with two bound visible Memory calls", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            promoteRankingToTwoStandardCalls(receipt);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.integrityErrors).toEqual([]);
        expect(result.blockers).toEqual([
            "app_compact_proxy_owner_disposition_required",
        ]);
    });

    it.each([0, 1] as const)(
        "accepts two visible Memory calls with the only hidden retry attached to call %i",
        (retryIndex) => {
            const root = createFixtureRoot();
            upgradeFixtureRootToCompactProxy(root);
            mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
                promoteRankingToTwoStandardCallsWithOneRetry(receipt, retryIndex);
            });

            const { processStatus, result } = runVerifier(root);

            expect(processStatus).toBe(2);
            expect(result.integrityErrors).toEqual([]);
            expect(result.blockers).toEqual([
                "app_compact_proxy_owner_disposition_required",
            ]);
        },
    );

    it("keeps performance READY when an independent ranking fails the app aggregate", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.overall = "FAIL";
            receipt.rankingCases["lexical-title"].status = "FAIL";
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toEqual([]);
        expect(result.receipts.app.compactProxy?.completionStatus).toBe(
            "READY_FOR_OWNER_REVIEW",
        );
        expect(result.failures).toEqual(expect.arrayContaining([
            "app_compact_proxy_ranking_case_failed:lexical-title",
        ]));
    });

    it.each([
        ["plan identity", (receipt: Record<string, any>) => {
            receipt.compactProxy.planSha256 = "f".repeat(64);
        }, "app_compact_proxy_identity_invalid"],
        ["settings transition", (receipt: Record<string, any>) => {
            receipt.compactProxy.settingsTransition.fromFlags.graphPpr = true;
        }, "app_compact_proxy_settings_transition_invalid"],
        ["flags-only settings binding", (receipt: Record<string, any>) => {
            receipt.compactProxy.settingsTransition.controlSettingsBindingSha256 = sha256(
                canonicalJson(currentFixtureManifest.compactProxyPlan.settingsPhases.control),
            );
        }, "app_compact_proxy_settings_transition_invalid"],
        ["missing stable settings identity", (receipt: Record<string, any>) => {
            delete receipt.compactProxy.settingsTransition.stableSettingsProfileSha256;
        }, "app_compact_proxy_settings_transition_invalid"],
        ["mixed plaintext settings envelope", (receipt: Record<string, any>) => {
            receipt.compactProxy.settingsTransition.stableSettingsProjection = {
                aiProvider: "forged-provider",
            };
        }, "app_compact_proxy_settings_transition_invalid"],
        ["required iPhone runtime", (receipt: Record<string, any>) => {
            receipt.runtime.platformClass = "desktop-or-other";
            receipt.runtime.runtimeFamily = "electron-renderer";
        }, "app_compact_proxy_ready_runtime_invalid"],
        ["opaque device binding", (receipt: Record<string, any>) => {
            receipt.compactProxy.deviceBinding.deviceIdentitySha256 = null;
        }, "app_compact_proxy_device_binding_status_invalid"],
        ["settings cleanup", (receipt: Record<string, any>) => {
            receipt.compactProxy.settingsTransition.cleanup.restoredFlags.graphPpr = true;
        }, "app_compact_proxy_settings_cleanup_invalid"],
        ["required completion check", (receipt: Record<string, any>) => {
            receipt.checks = receipt.checks.filter((entry: Record<string, any>) => (
                entry.name !== "Compact proxy evidence is complete for owner review"
            ));
        }, "app_compact_proxy_required_check_missing:Compact proxy evidence is complete for owner review"],
        ["episode order", (receipt: Record<string, any>) => {
            const binding = receipt.compactProxy.workloadBinding;
            [binding.episodes[0], binding.episodes[1]] = [
                binding.episodes[1],
                binding.episodes[0],
            ];
            binding.bindingSha256 = sha256(canonicalJson(binding.episodes));
        }, "app_compact_proxy_episode_binding_invalid"],
        ["episode surface", (receipt: Record<string, any>) => {
            const binding = receipt.compactProxy.workloadBinding;
            binding.episodes[0].surface = "pagelet";
            binding.bindingSha256 = sha256(canonicalJson(binding.episodes));
        }, "app_compact_proxy_episode_binding_invalid"],
        ["fresh Chat marker", (receipt: Record<string, any>) => {
            const binding = receipt.compactProxy.workloadBinding;
            binding.episodes[0].freshChat = false;
            binding.bindingSha256 = sha256(canonicalJson(binding.episodes));
        }, "app_compact_proxy_episode_binding_invalid"],
        ["unique opaque run", (receipt: Record<string, any>) => {
            const binding = receipt.compactProxy.workloadBinding;
            binding.episodes[1].opaqueCorrelationSha256 =
                binding.episodes[0].opaqueCorrelationSha256;
            binding.bindingSha256 = sha256(canonicalJson(binding.episodes));
        }, "app_compact_proxy_episode_freshness_invalid"],
        ["N/A zero masquerade", (receipt: Record<string, any>) => {
            receipt.compactProxy.metrics.comparison.graphDurationMs.control = 0;
        }, "app_compact_proxy_na_comparison_invalid:graphDurationMs"],
        ["forged aggregate PASS", (receipt: Record<string, any>) => {
            receipt.overall = "PASS";
        }, "app_compact_proxy_overall_status_invalid"],
        ["ranking MRR", (receipt: Record<string, any>) => {
            receipt.rerankerMetrics.mrr = 0;
        }, "app_compact_proxy_ranking_aggregate_invalid"],
        ["ranking invalid source count", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].invalidSourceCount = 1;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking relaxed projection count", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].evidence.topology.projectionCompletedCount = 0;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking final document count", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].evidence.finalDocumentCount = 9;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking malformed relaxed zero", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].evidence.topology.relaxedMemoryReason = null;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking relaxed stage drift", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].evidence.topology.relaxedDocumentCount = 1;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking retry token drift", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].evidence.topology.retryConsumed = false;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking retry owner index drift", (receipt: Record<string, any>) => {
            promoteRankingToTwoStandardCallsWithOneRetry(receipt, 0);
            receipt.rankingCases["lexical-title"].evidence.topology
                .relaxedAfterStandardCallIndex = 2;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking visible result count drift", (receipt: Record<string, any>) => {
            promoteRankingToTwoStandardCallsWithOneRetry(receipt, 1);
            receipt.rankingCases["lexical-title"].evidence.topology
                .visibleMemoryResultDocumentCounts[1] = 1;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking hidden retry count above global budget", (receipt: Record<string, any>) => {
            promoteRankingToTwoStandardCallsWithOneRetry(receipt, 0);
            receipt.rankingCases["lexical-title"].evidence.relaxedRetryCount = 2;
            receipt.rankingCases["lexical-title"].evidence.memoryAttemptCount = 4;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking cancellation evidence", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].evidence.topology.hasCancellationEvidence = true;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking invocation ordinal binding", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-title"].evidence.topology
                .invocationOrdinalBindingValid = false;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-title"],
        ["ranking invocation ordinal order", (receipt: Record<string, any>) => {
            promoteRankingToTwoStandardCalls(receipt);
            receipt.rankingCases["temporal-2026"].evidence.topology
                .standardInvocationOrdinals = [1, 0];
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:temporal-2026"],
        ["ranking visible Memory count below diagnostics", (receipt: Record<string, any>) => {
            promoteRankingToTwoStandardCalls(receipt);
            receipt.rankingCases["temporal-2026"].evidence.sourceBinding
                .successfulSearchMemoryToolResultCount = 1;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:temporal-2026"],
        ["ranking visible Memory count above diagnostics", (receipt: Record<string, any>) => {
            receipt.rankingCases["lexical-heading"].evidence.sourceBinding
                .successfulSearchMemoryToolResultCount = 2;
        }, "app_compact_proxy_ranking_case_pass_invariant_invalid:lexical-heading"],
        ["structured temporal", (receipt: Record<string, any>) => {
            receipt.temporalRetryCase.topology.projectionTemporalFilterApplied = 0;
        }, "app_compact_proxy_temporal_pass_invariant_invalid"],
        ["temporal projection below unique source count", (receipt: Record<string, any>) => {
            promoteTemporalToStrictPartial(receipt, 1);
        }, "app_compact_proxy_temporal_pass_invariant_invalid"],
        ["temporal projection above manifest maximum", (receipt: Record<string, any>) => {
            const topology = receipt.temporalRetryCase.topology;
            const aboveMaximum = currentFixtureManifest.temporalRetryCase
                .finalSourceContract.maximumSourceCount + 1;
            topology.relaxedMemoryDocumentCount = aboveMaximum;
            topology.relaxedDocumentCount = aboveMaximum;
            topology.projectionDocumentCount = aboveMaximum;
        }, "app_compact_proxy_temporal_pass_invariant_invalid"],
        ["temporal projection above input document count", (receipt: Record<string, any>) => {
            promoteTemporalToStrictPartial(receipt, 3);
        }, "app_compact_proxy_temporal_pass_invariant_invalid"],
        ["temporal valid-none projection count drift", (receipt: Record<string, any>) => {
            const topology = receipt.temporalRetryCase.topology;
            topology.relaxedMemoryDocumentCount = 2;
            topology.relaxedDocumentCount = 2;
            topology.projectionDocumentCount = 1;
        }, "app_compact_proxy_temporal_pass_invariant_invalid"],
        ["temporal relaxed terminal count drift", (receipt: Record<string, any>) => {
            const topology = receipt.temporalRetryCase.topology;
            topology.relaxedMemoryDocumentCount = 2;
            topology.projectionDocumentCount = 2;
        }, "app_compact_proxy_temporal_pass_invariant_invalid"],
        ["maintenance order", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.startedAt = "2026-08-11T00:00:19.000Z";
            entry.runtimeEnvelope.startedAt = "2026-08-11T00:00:18.000Z";
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_order_invalid"],
        ["maintenance epoch tamper", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.after.incrementalMaintenanceEpoch =
                entry.operation.before.incrementalMaintenanceEpoch;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance operation binding", (receipt: Record<string, any>) => {
            receipt.compactProxy.maintenance.rebuild.operation.durationMs += 1;
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance operation missing DB peak", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.rebuild;
            delete entry.operation.resourceEnvelope.estimatedDbBytesPeak;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance operation forged DB peak", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.rebuild;
            entry.operation.resourceEnvelope.estimatedDbBytesPeak = 1300;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance projected DB mismatch", (receipt: Record<string, any>) => {
            receipt.compactProxy.maintenance.rebuild.estimatedDbBytesPeak += 1;
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance public API duration", (receipt: Record<string, any>) => {
            receipt.compactProxy.maintenance.rebuild.runtimeEnvelope.publicApiDurationMs = 99;
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance UI stall maximum", (receipt: Record<string, any>) => {
            receipt.compactProxy.maintenance.rebuild
                .runtimeEnvelope.eventLoopStallMs.maximum = 1;
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance outer envelope", (receipt: Record<string, any>) => {
            receipt.compactProxy.maintenance.rebuild.runtimeEnvelope.startedAt =
                "2026-08-11T00:00:11.000Z";
        }, "app_compact_proxy_maintenance_invalid"],
        ["required resource fake sample", (receipt: Record<string, any>) => {
            const metric = receipt.compactProxy.metrics.requiredResourceEnvelope
                .estimatedDbBytes;
            metric.samples.push(9999);
            metric.maximum = 9999;
        }, "app_compact_proxy_required_resource_envelope_invalid"],
        ["required resource maximum", (receipt: Record<string, any>) => {
            receipt.compactProxy.metrics.requiredResourceEnvelope
                .eventLoopStallMs.maximum += 1;
        }, "app_compact_proxy_required_resource_envelope_invalid"],
        ["maintenance wrong kind", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.kind = "rebuild";
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance wrong sequence", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.sequence = 1;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["stale maintenance receipt replay", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.rebuild;
            entry.operation.startedAt = "2026-08-10T00:00:10.000Z";
            entry.operation.finishedAt = "2026-08-10T00:00:20.000Z";
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["rebuild relabelled as incremental", (receipt: Record<string, any>) => {
            const maintenance = receipt.compactProxy.maintenance;
            const operation = structuredClone(maintenance.rebuild.operation);
            operation.sequence = 2;
            operation.kind = "indexed-chunks-incremental";
            operation.operationId = "lexinc-33333333333333333333333333333333";
            operation.scopeBindingSha256 = sha256(
                `b125-lexical-maintenance-v1\u0000${operation.operationId}\u0000${currentFixtureManifest.compactProxyPlan.maintenanceOperations.incrementalUpdate.fixturePath}`,
            );
            operation.startedAt = "2026-08-11T00:00:30.000Z";
            operation.finishedAt = "2026-08-11T00:00:31.000Z";
            maintenance.incrementalUpdate.operation = operation;
            maintenance.incrementalUpdate.operationBindingSha256 =
                sha256(canonicalJson(operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["incremental scope binding", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.scopeBindingSha256 = sha256("wrong-maintenance-scope");
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["incremental row integrity", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.effects.lexicalRowsInserted = 0;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance source write", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.effects.sourceChunkWrites = 1;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance provider call", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.rebuild;
            entry.operation.effects.providerCalls = 1;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance embedding write", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.rebuild;
            entry.operation.effects.embeddingWrites = 1;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_invalid"],
        ["maintenance cross-operation continuity", (receipt: Record<string, any>) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.operation.before.indexMutationEpoch += 1;
            entry.operation.after.indexMutationEpoch += 1;
            entry.operationBindingSha256 = sha256(canonicalJson(entry.operation));
        }, "app_compact_proxy_maintenance_continuity_invalid"],
        ["legacy stats bracket", (receipt: Record<string, any>) => {
            receipt.compactProxy.maintenance.rebuild = {
                status: "PASS",
                durationMs: 100,
                estimatedDbBytes: 1500,
                readyMarker: null,
                proof: {},
                recordedAt: "2026-08-11T00:00:20.000Z",
                reason: null,
            };
        }, "app_compact_proxy_maintenance_invalid"],
    ])("fails compact proxy structural tampering: %s", (
        _label,
        mutate,
        expectedIntegrityError,
    ) => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", mutate);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(expectedIntegrityError);
    });

    it.each([
        ["legacy missing evidence", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            delete episode.cancellationEvidence;
            resealCompactEpisodeBinding(receipt, episode);
        }],
        ["cross-run evidence", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            episode.cancellationEvidence.runId = "different-run";
            resealCompactCancellationEvidence(episode.cancellationEvidence);
            resealCompactEpisodeBinding(receipt, episode);
        }],
        ["misordered queue completion", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            const events = episode.cancellationEvidence.events;
            [events[4], events[5]] = [events[5], events[4]];
            resealCompactCancellationEvidence(episode.cancellationEvidence);
            resealCompactEpisodeBinding(receipt, episode);
        }],
        ["empty queue-release result", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            episode.cancellationEvidence.events[5].metrics.resultCount = 0;
            resealCompactCancellationEvidence(episode.cancellationEvidence);
            resealCompactEpisodeBinding(receipt, episode);
        }],
        ["unexpected diagnostic metric", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            episode.cancellationEvidence.events[5].metrics.untrustedCount = 1;
            resealCompactCancellationEvidence(episode.cancellationEvidence);
            resealCompactEpisodeBinding(receipt, episode);
        }],
        ["queue-release exceeds absolute envelope", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            episode.cancellationEvidence.events[5].elapsedMs = 8_003;
            resealCompactCancellationEvidence(episode.cancellationEvidence);
            resealCompactEpisodeBinding(receipt, episode);
        }],
        ["derived field tamper", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            episode.observations.cancelToProbeCompletedMs = 5;
            receipt.compactProxy.metrics.cancellationProbe
                .observations.cancelToProbeCompletedMs = [5];
            resealCompactEpisodeBinding(receipt, episode);
        }],
    ])("rejects compact raw cancellation evidence tampering: %s", (_label, mutate) => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", mutate);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toContain(
            "app_compact_proxy_cancellation_evidence_invalid",
        );
    });

    it("rejects queue-release fields on a non-cancellation compact episode", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "evaluatedStandard",
            );
            episode.observations.cancelToProbeCompletedMs = 1;
            receipt.compactProxy.metrics.evaluatedStandard
                .observations.cancelToProbeCompletedMs = [1];
            resealCompactEpisodeBinding(receipt, episode);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "app_compact_proxy_unexpected_cancellation_evidence:compact-evaluated-std-warmup-01",
            "app_compact_proxy_normal_queue_release_invalid:evaluatedStandard:cancelToProbeCompletedMs",
        ]));
    });

    it("recomputes the cancellation graph-batch observation from earlier evaluated episodes", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "cancellationProbe",
            );
            episode.observations.graphMaxBatchDurationMs += 1;
            receipt.compactProxy.metrics.cancellationProbe
                .observations.graphMaxBatchDurationMs = [
                    episode.observations.graphMaxBatchDurationMs,
                ];
            resealCompactEpisodeBinding(receipt, episode);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toContain(
            "app_compact_proxy_cancellation_batch_observation_invalid",
        );
    });

    it("binds compact maintenance comparison to the public API duration", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const entry = receipt.compactProxy.maintenance.incrementalUpdate;
            entry.runtimeEnvelope.publicApiDurationMs = 13;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toContain(
            "app_compact_proxy_na_comparison_invalid:incrementalUpdateDurationMs",
        );
    });

    it("excludes the three retry warmups from retry comparison percentiles", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const retry = receipt.compactProxy.metrics.evaluatedRetry;
            receipt.compactProxy.metrics.comparison.retryDurationMs.evaluated = compactStats(
                retry.observations.memorySearchDurationMs,
            );
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toContain(
            "app_compact_proxy_na_comparison_invalid:retryDurationMs",
        );
    });

    it("reports a latched Markdown mutation as a compact machine failure", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.overall = "FAIL";
            receipt.compactProxy.status = "INVALID";
            receipt.compactProxy.maintenance.sourceMutationGuard = {
                status: "FAIL",
                eventCount: 1,
            };
            const completion = receipt.checks.find((entry: Record<string, any>) => (
                entry.name === "Compact proxy evidence is complete for owner review"
            ));
            completion.status = "FAIL";
            const sourceClean = receipt.checks.find((entry: Record<string, any>) => (
                entry.name === "Compact proxy observes no Vault Markdown mutation"
            ));
            sourceClean.status = "FAIL";
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toEqual([]);
        expect(result.failures).toEqual(expect.arrayContaining([
            "app_compact_proxy_source_mutation_detected",
            "app_compact_proxy_invalid",
        ]));
    });

    it("rejects missing evaluated Worker timings after compact hashes are resealed", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const binding = receipt.compactProxy.workloadBinding;
            const episode = binding.episodes.find((entry: Record<string, any>) => (
                entry.id === "compact-evaluated-std-warmup-01"
            ));
            episode.observations.graphWorkerDurationMs = null;
            const entryWithoutBinding = { ...episode };
            delete entryWithoutBinding.evidenceBindingSha256;
            episode.evidenceBindingSha256 = sha256(canonicalJson(entryWithoutBinding));
            binding.bindingSha256 = sha256(canonicalJson(binding.episodes));
            receipt.compactProxy.metrics.evaluatedStandard
                .observations.graphWorkerDurationMs.shift();
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toContain(
            "app_compact_proxy_episode_worker_timing_invalid:compact-evaluated-std-warmup-01",
        );
    });

    it("rejects fractional compact counter observations after all hashes are resealed", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const binding = receipt.compactProxy.workloadBinding;
            const cancelEpisode = binding.episodes.find((entry: Record<string, any>) => (
                entry.stage === "cancellationProbe"
            ));
            cancelEpisode.observations.cancelRequestedCount = 1.5;
            const entryWithoutBinding = { ...cancelEpisode };
            delete entryWithoutBinding.evidenceBindingSha256;
            cancelEpisode.evidenceBindingSha256 = sha256(canonicalJson(entryWithoutBinding));
            binding.bindingSha256 = sha256(canonicalJson(binding.episodes));
            receipt.compactProxy.metrics.cancellationProbe
                .observations.cancelRequestedCount = [1.5];
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "app_compact_proxy_episode_binding_invalid",
            "app_compact_proxy_metric_stage_invalid:cancellationProbe",
        ]));
    });

    it("rejects a forged compact hard-budget PASS and cancellation structure", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const binding = receipt.compactProxy.workloadBinding;
            const lexicalEpisode = binding.episodes.find((entry: Record<string, any>) => (
                entry.stage === "evaluatedStandard" && entry.sampleClass === "measured"
            ));
            lexicalEpisode.observations.lexicalDurationMs = 501;
            lexicalEpisode.observations.fallbackCount = 1;
            const cancelEpisode = binding.episodes.find((entry: Record<string, any>) => (
                entry.stage === "cancellationProbe"
            ));
            cancelEpisode.observations.acceptedAfterCancelCount = 1;
            binding.bindingSha256 = sha256(canonicalJson(binding.episodes));
            const standard = receipt.compactProxy.metrics.evaluatedStandard.observations;
            const standardIndex = binding.episodes.filter((entry: Record<string, any>) => (
                entry.stage === "evaluatedStandard"
            )).indexOf(lexicalEpisode);
            standard.lexicalDurationMs[standardIndex] = 501;
            standard.fallbackCount[standardIndex] = 1;
            receipt.compactProxy.metrics.cancellationProbe
                .observations.acceptedAfterCancelCount = [1];
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "app_compact_proxy_hard_budget_pass_invariant_invalid",
            "app_compact_proxy_fallback_pass_invariant_invalid",
            "app_compact_proxy_cancellation_invariant_invalid",
        ]));
    });

    it.each([
        ["legacy missing terminal remainder", (receipt: Record<string, any>) => {
            const episode = receipt.compactProxy.workloadBinding.episodes.find(
                (entry: Record<string, any>) => entry.stage === "controlStandard",
            );
            delete episode.observations.finalizationRemainingMs;
            resealCompactEpisodeBinding(receipt, episode);
        }, "app_compact_proxy_episode_binding_invalid"],
        ["configured reserve drift", (receipt: Record<string, any>) => {
            const episodes = receipt.compactProxy.workloadBinding.episodes.filter(
                (entry: Record<string, any>) => entry.stage === "evaluatedStandard",
            );
            const episode = episodes[0];
            episode.observations.finalizationReserveMs = 50;
            receipt.compactProxy.metrics.evaluatedStandard
                .observations.finalizationReserveMs[0] = 50;
            resealCompactEpisodeBinding(receipt, episode);
        }, "app_compact_proxy_finalization_reserve_binding_invalid"],
        ["zero terminal remainder", (receipt: Record<string, any>) => {
            const episodes = receipt.compactProxy.workloadBinding.episodes.filter(
                (entry: Record<string, any>) => entry.stage === "evaluatedStandard",
            );
            const episode = episodes[0];
            episode.observations.finalizationRemainingMs = 0;
            receipt.compactProxy.metrics.evaluatedStandard
                .observations.finalizationRemainingMs[0] = 0;
            resealCompactEpisodeBinding(receipt, episode);
        }, "app_compact_proxy_hard_budget_pass_invariant_invalid"],
    ])("rejects compact finalization-reserve evidence tampering: %s", (
        _label,
        mutate,
        expectedIntegrityError,
    ) => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", mutate);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toContain(expectedIntegrityError);
    });

    it("does not require unavailable process-memory or heap diagnostics for compact readiness", () => {
        const root = createFixtureRoot();
        upgradeFixtureRootToCompactProxy(root);

        const { result } = runVerifier(root);

        expect(result.integrityErrors).toEqual([]);
        expect(result.failures).toEqual([]);
        expect(result.blockers).toEqual([
            "app_compact_proxy_owner_disposition_required",
        ]);
    });

    it.each([
        ["contract hash", (binding: Record<string, any>) => {
            binding.contractSha256 = "f".repeat(64);
        }, "app_performance_workload_binding_schema_invalid"],
        ["bound count", (binding: Record<string, any>) => {
            binding.boundEpisodeCount -= 1;
        }, "app_performance_episode_binding_invalid"],
        ["violation count", (binding: Record<string, any>) => {
            binding.violationCount = 1;
        }, "app_performance_workload_pass_invariant_invalid"],
        ["aggregate hash", (binding: Record<string, any>) => {
            binding.bindingSha256 = "f".repeat(64);
        }, "app_performance_workload_binding_hash_mismatch"],
    ])("fails a final PASS receipt with invalid performance workload %s", (
        _label,
        mutate,
        expectedIntegrityError,
    ) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            mutate(receipt.deviceMeasurement.workloadBinding);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(expectedIntegrityError);
    });

    it.each([
        ["unfrozen plan", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.planStatus = "UNFROZEN";
        }],
        ["device status", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.overall = "BLOCKED";
        }],
        ["diagnostics gate", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnosticsGate.status = "BLOCKED";
        }],
        ["reranker gate", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.rerankerGate.status = "BLOCKED";
        }],
        ["required metric", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.metrics["retrieval.totalDurationMs"].status = "BLOCKED";
        }],
        ["plan identity", (receipt: Record<string, any>) => {
            receipt.identity.deviceMeasurementPlanSha256 = "f".repeat(64);
        }],
        ["unredacted plan hash", (receipt: Record<string, any>) => {
            const unredacted = sha256(canonicalJson(
                frozenPlanFromReceipt(receipt),
            ));
            receipt.deviceMeasurement.planSha256 = unredacted;
            receipt.identity.deviceMeasurementPlanSha256 = unredacted;
        }],
    ])("rejects a final PASS receipt with invalid %s evidence", (_label, mutate) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", mutate);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.integrityErrors).toContain(
            "app_device_measurement_pass_invariant_invalid",
        );
    });

    it.each([
        ["legacy missing raw diagnostics", (receipt: Record<string, any>) => {
            delete receipt.deviceMeasurement.diagnostics;
        }],
        ["missing invocation ordinal", (receipt: Record<string, any>) => {
            delete receipt.deviceMeasurement.diagnostics.standardPerformance
                .events[0].invocationOrdinal;
        }],
        ["nonzero performance invocation ordinal", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnostics.standardPerformance
                .events[0].invocationOrdinal = 1;
        }],
        ["global finalization boundary carries an ordinal", (receipt: Record<string, any>) => {
            const boundary = receipt.deviceMeasurement.diagnostics.standardPerformance.events.find(
                (event: Record<string, any>) => event.phase === "finalization_reserve",
            );
            boundary.invocationOrdinal = 0;
        }],
        ["derived completion field tamper", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnosticsSummary.measurementEpisodes
                .cancellationProbe.cancelToProbeCompletedMs += 1;
        }],
        ["cross-run queue completion", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnostics.cancellationProbe
                .events[5].runId = "different-run";
        }],
        ["cancellation episode replayed under another run", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnostics.cancellationProbe.events.forEach(
                (event: Record<string, any>) => { event.runId = "replayed-run"; },
            );
        }],
        ["misordered queue completion", (receipt: Record<string, any>) => {
            const events = receipt.deviceMeasurement.diagnostics.cancellationProbe.events;
            [events[4], events[5]] = [events[5], events[4]];
        }],
        ["empty queue-release result", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnostics.cancellationProbe
                .events[5].metrics.resultCount = 0;
        }],
        ["failed queue-release result", (receipt: Record<string, any>) => {
            const terminal = receipt.deviceMeasurement.diagnostics.cancellationProbe.events[5];
            terminal.outcome = "failed";
            terminal.reason = "queue_release_error";
            delete terminal.metrics.resultCount;
        }],
        ["timed-out queue-release result", (receipt: Record<string, any>) => {
            const terminal = receipt.deviceMeasurement.diagnostics.cancellationProbe.events[5];
            terminal.outcome = "deadline";
            terminal.reason = "queue_release_timeout";
            delete terminal.metrics.resultCount;
        }],
        ["queue-release exceeds absolute envelope", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnostics.cancellationProbe
                .events[5].elapsedMs = 8_003;
        }],
        ["observed graph maximum tamper", (receipt: Record<string, any>) => {
            receipt.deviceMeasurement.diagnosticsSummary.measurementEpisodes
                .cancellationProbe.graphMaxBatchDurationMs += 1;
        }],
        ["queue-release event on standard episode", (receipt: Record<string, any>) => {
            const projection = receipt.deviceMeasurement.diagnostics.standardPerformance;
            const prior = projection.events.at(-1);
            projection.events.push({
                sequence: prior.sequence + 1,
                elapsedMs: prior.elapsedMs + 1,
                runId: prior.runId,
                surface: "chat",
                phase: "queue_release",
                outcome: "completed",
                metrics: { durationMs: 1, resultCount: 1 },
            });
        }],
    ])("rejects strict PASS queue-release evidence tampering: %s", (_label, mutate) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", mutate);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "app_device_cancellation_queue_release_pass_invariant_invalid",
            "app_device_measurement_pass_invariant_invalid",
        ]));
    });

    it.each([
        ["legacy missing configured reserve", (receipt: Record<string, any>) => {
            const event = receipt.deviceMeasurement.diagnostics.standardPerformance.events.find(
                (entry: Record<string, any>) => entry.phase === "finalization_reserve",
            );
            delete event.metrics.configuredReserveMs;
        }],
        ["zero configured reserve", (receipt: Record<string, any>) => {
            const event = receipt.deviceMeasurement.diagnostics.standardPerformance.events.find(
                (entry: Record<string, any>) => entry.phase === "finalization_reserve",
            );
            event.metrics.configuredReserveMs = 0;
        }],
        ["intra-run configured reserve drift", (receipt: Record<string, any>) => {
            const events = receipt.deviceMeasurement.diagnostics.standardPerformance.events.filter(
                (entry: Record<string, any>) => (
                    entry.phase === "finalization_reserve"
                    && entry.runId === "strict-standard-1"
                ),
            );
            events.at(-1).metrics.configuredReserveMs = 50;
        }],
        ["zero terminal hard-wall remainder", (receipt: Record<string, any>) => {
            const terminal = receipt.deviceMeasurement.diagnostics.standardPerformance.events.find(
                (entry: Record<string, any>) => (
                    entry.phase === "finalization_reserve"
                    && entry.outcome === "completed"
                ),
            );
            terminal.metrics.remainingMs = 0;
        }],
        ["reserve overrun terminal", (receipt: Record<string, any>) => {
            const terminal = receipt.deviceMeasurement.diagnostics.standardPerformance.events.find(
                (entry: Record<string, any>) => (
                    entry.phase === "finalization_reserve"
                    && entry.outcome === "completed"
                ),
            );
            terminal.outcome = "deadline";
            terminal.reason = "reserve_overrun";
        }],
        ["derived reserve forged from hard-wall remainder", (receipt: Record<string, any>) => {
            const metric = receipt.deviceMeasurement.metrics["retrieval.finalizationReserveMs"];
            metric.rawSamples = metric.rawSamples.map(() => 50);
            metric.evaluatedSamples = metric.evaluatedSamples.map(() => 50);
            metric.p50 = 50;
            metric.p95 = 50;
            metric.minimum = 50;
            metric.maximum = 50;
        }],
    ])("rejects strict PASS finalization-reserve evidence tampering: %s", (_label, mutate) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", mutate);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "app_device_cancellation_queue_release_pass_invariant_invalid",
            "app_device_measurement_pass_invariant_invalid",
        ]));
    });

    it.each([
        "retrieval.totalDurationMs",
        "memory.peakProcessFootprintBytes",
    ])("rejects unsupported+PASS evidence for required metric %s", (metricId) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const metric = receipt.deviceMeasurement.metrics[metricId];
            metric.method = "unsupported";
            metric.evidenceSource = "forged-unsupported-pass";
            metric.status = "PASS";
            metric.reason = "frozen threshold satisfied";
            metric.rawSamples = [];
            metric.evaluatedSamples = [];
            metric.p50 = null;
            metric.p95 = null;
            metric.minimum = null;
            metric.maximum = null;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.integrityErrors).toContain(
            `app_device_metric_pass_invariant_invalid:${metricId}`,
        );
        expect(result.receipts.app.externalMemoryBinding).toEqual({
            status: "NOT_APPLICABLE",
            bindingPresent: false,
        });
    });

    it("does not let an absent optional external slice mask a forged device PASS", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const metric = receipt.deviceMeasurement
                .metrics["memory.peakProcessFootprintBytes"];
            receipt.overall = "BLOCKED";
            receipt.deviceMeasurement.overall = "PASS";
            metric.method = "unsupported";
            metric.evidenceSource = "runtime-envelope-process-memory-1000ms";
            metric.status = "BLOCKED";
            metric.reason = "runtime envelope sampling source is incomplete";
            metric.rawSamples = [];
            metric.evaluatedSamples = [];
            metric.p50 = null;
            metric.p95 = null;
            metric.minimum = null;
            metric.maximum = null;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "app_device_metric_pass_invariant_invalid:memory.peakProcessFootprintBytes",
            "app_process_memory_pass_invariant_invalid",
        ]));
        expect(result.receipts.app.externalMemoryBinding).toEqual({
            status: "NOT_APPLICABLE",
            bindingPresent: false,
        });
    });

    it("rejects a current manifest whose outer device plan regresses from v9", () => {
        const root = createFixtureRoot();
        const manifest = JSON.parse(readFileSync(
            join(root, "__fixtures__/retrieval-smoke/manifest.json"),
            "utf8",
        )) as Record<string, any>;
        manifest.deviceMeasurementPlan.version = "b125-device-measurement-v8";
        const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
        replaceFixture(root, "__fixtures__/retrieval-smoke/manifest.json", manifestText);
        replaceFixture(root, "test/retrieval-optimization-smoke-manifest.json", manifestText);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.identity.manifestSha256 = sha256(manifestText);
            receipt.deviceMeasurement.planVersion = manifest.deviceMeasurementPlan.version;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.integrityErrors).toContain("manifest_device_measurement_plan_invalid");
    });

    it("rejects a replayed opaque correlation across qualification and episodes", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const binding = receipt.deviceMeasurement.workloadBinding;
            binding.episodes[0].opaqueCorrelationSha256 =
                binding.qualification.entries[0].opaqueCorrelationSha256;
            resealWorkloadBinding(binding);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.integrityErrors).toContain(
            "app_performance_opaque_correlation_reused",
        );
    });

    it.each(["PENDING", "BLOCKED"])(
        "keeps an incomplete %s App workload classified as BLOCKED",
        (receiptOverall) => {
            const root = createFixtureRoot();
            mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
                receipt.overall = receiptOverall;
                const binding = receipt.deviceMeasurement.workloadBinding;
                binding.status = "PENDING";
                binding.episodes.pop();
                binding.stages.cancellationProbe.status = "PENDING";
                resealWorkloadBinding(binding);
            });

            const { processStatus, result } = runVerifier(root);

            expect(processStatus).toBe(2);
            expect(result.status).toBe("BLOCKED");
            expect(result.blockers).toContain("app_performance_workload_not_pass");
            expect(result.integrityErrors).toEqual([]);
        },
    );

    it("keeps an otherwise complete BLOCKED App receipt classified as BLOCKED", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.overall = "BLOCKED";
        });

        const { processStatus, result } = runVerifier(root);
        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("app_receipt_overall_blocked");
        expect(result.integrityErrors).toEqual([]);
    });

    it("rejects a BLOCKED receipt whose workload binding falsely claims PASS", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.overall = "BLOCKED";
            receipt.deviceMeasurement.workloadBinding.violationCount = 1;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.integrityErrors).toContain(
            "app_performance_workload_pass_invariant_invalid",
        );
    });

    it("accepts a desktop receipt without an external memory binding", () => {
        const root = createFixtureRoot();

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(0);
        expect(result.receipts.app.externalMemoryBinding).toEqual({
            status: "NOT_APPLICABLE",
            bindingPresent: false,
        });
    });

    it("blocks an unbound fixed external memory pair instead of treating it as absent", () => {
        const root = createFixtureRoot();
        bindExternalMemoryEvidence(root);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const processMemoryDefinition = currentFixtureManifest.deviceMeasurementPlan
                .requiredMetrics.find((definition: Record<string, any>) => (
                    definition.id === "memory.peakProcessFootprintBytes"
                ));
            receipt.overall = "PASS";
            receipt.deviceMeasurement.overall = "PASS";
            receipt.deviceMeasurement.metrics[processMemoryDefinition.id] =
                createPassDeviceMetric(processMemoryDefinition, receipt.finishedAt);
            receipt.deviceMeasurement.runtimeEnvelope = createPassRuntimeEnvelope(receipt);
            const planSha256 = sha256(canonicalJson(projectDevicePlanForReceipt(
                frozenPlanFromReceipt(receipt),
            )));
            receipt.deviceMeasurement.planSha256 = planSha256;
            receipt.identity.deviceMeasurementPlanSha256 = planSha256;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("external_memory_converter_unverified");
        expect(result.integrityErrors).toEqual([]);
        expect(result.receipts.app.externalMemoryBinding).toMatchObject({
            status: "BLOCKED",
            bindingPresent: false,
            reason: "external_memory_converter_unverified",
        });
    });

    it("accepts the runner's content-free blocked external memory state", () => {
        const root = createFixtureRoot();
        bindBlockedExternalMemoryEvidence(root);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("external_memory_converter_unverified");
        expect(result.integrityErrors).toEqual([]);
        expect(result.receipts.app.externalMemoryBinding).toMatchObject({
            status: "BLOCKED",
            bindingPresent: true,
            reason: "external_memory_converter_unverified",
        });
    });

    it("blocks digest-current schema-v1 external memory without a verified converter", () => {
        const root = createFixtureRoot();
        bindExternalMemoryEvidence(root);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("external_memory_converter_unverified");
        expect(result.integrityErrors).toEqual([]);
        expect(result.receipts.app.externalMemoryBinding).toMatchObject({
            status: "BLOCKED",
            bindingPresent: true,
            reason: "external_memory_converter_unverified",
        });
    });

    it.each(["artifact", "raw export"])(
        "blocks when the current external memory %s bytes drift after evidence cutoff",
        (kind) => {
            const root = createFixtureRoot();
            const paths = bindExternalMemoryEvidence(root);
            const initial = runVerifier(root);
            expect(initial.processStatus).toBe(2);
            expect(initial.result.blockers).toContain("external_memory_converter_unverified");
            expect(initial.result.receipts.app.externalMemoryBinding).toMatchObject({
                status: "BLOCKED",
                bindingPresent: true,
                reason: "external_memory_converter_unverified",
            });

            if (kind === "artifact") {
                const current = readFileSync(join(root, paths.artifactPath), "utf8");
                writeFileSync(join(root, paths.artifactPath), `${current} `);
            } else {
                const current = readFileSync(join(root, paths.rawExportPath));
                writeFileSync(
                    join(root, paths.rawExportPath),
                    Buffer.concat([current, Buffer.from([0x01])]),
                );
            }

            const { processStatus, result } = runVerifier(root);

            expect(processStatus).toBe(2);
            expect(result.status).toBe("BLOCKED");
            expect(result.blockers).toEqual(expect.arrayContaining([
                "external_memory_converter_unverified",
                kind === "artifact"
                    ? "external_memory_artifact_not_current"
                    : "external_memory_raw_export_not_current",
            ]));
            expect(result.integrityErrors).toEqual([]);
        },
    );

    it.each(["invalid UTF-8", "UTF-8 BOM"])(
        "blocks a digest-current external memory artifact encoded with %s",
        (encoding) => {
            const root = createFixtureRoot();
            const paths = bindExternalMemoryEvidence(root);
            const currentArtifact = JSON.parse(readFileSync(
                join(root, paths.artifactPath),
                "utf8",
            )) as Record<string, string>;
            const artifactBytes = encoding === "UTF-8 BOM"
                ? Buffer.concat([
                    Buffer.from([0xef, 0xbb, 0xbf]),
                    readFileSync(join(root, paths.artifactPath)),
                ])
                : Buffer.concat([
                    Buffer.from(
                        `{"rawExportPath":${JSON.stringify(currentArtifact.rawExportPath)},`
                        + `"rawExportSha256":${JSON.stringify(currentArtifact.rawExportSha256)},`
                        + "\"note\":\"",
                    ),
                    Buffer.from([0xc3, 0x28]),
                    Buffer.from("\"}"),
                ]);
            writeFileSync(join(root, paths.artifactPath), artifactBytes);
            mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
                receipt.deviceMeasurement.runtimeEnvelope.externalMemoryEnvelope
                    .artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
            });

            const { processStatus, result } = runVerifier(root);

            expect(processStatus).toBe(2);
            expect(result.status).toBe("BLOCKED");
            expect(result.blockers).toEqual(expect.arrayContaining([
                "external_memory_artifact_not_current",
                "external_memory_artifact_raw_binding_not_current",
            ]));
            expect(result.integrityErrors).toEqual([]);
        },
    );

    it.each([
        ["array", "[]\n"],
        ["primitive", "42\n"],
        ["null", "null\n"],
    ])("rejects a digest-current external memory artifact with a %s top level", (
        _shape,
        artifactText,
    ) => {
        const root = createFixtureRoot();
        const paths = bindExternalMemoryEvidence(root);
        writeFileSync(join(root, paths.artifactPath), artifactText);
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.deviceMeasurement.runtimeEnvelope.externalMemoryEnvelope
                .artifactSha256 = sha256(artifactText);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(
            "app_external_memory_artifact_schema_invalid",
        );
    });

    it.each(["schema", "provenance", "future window"] as const)(
        "rejects a digest-current external memory artifact with invalid %s",
        (violation) => {
            const root = createFixtureRoot();
            const paths = bindExternalMemoryEvidence(root);
            const artifact = JSON.parse(readFileSync(
                join(root, paths.artifactPath),
                "utf8",
            )) as Record<string, any>;
            const receiptBeforeMutation = JSON.parse(readFileSync(
                join(root, "test/retrieval-optimization-smoke-result.json"),
                "utf8",
            )) as Record<string, any>;
            if (violation === "schema") {
                delete artifact.toolVersion;
            } else if (violation === "provenance") {
                artifact.counter = "resident_set_bytes";
            } else {
                artifact.windowFinishedAt = new Date(
                    Date.parse(receiptBeforeMutation.finishedAt) + 1_000,
                ).toISOString();
                const sampleCount = Math.ceil((
                    Date.parse(artifact.windowFinishedAt)
                    - Date.parse(artifact.windowStartedAt)
                ) / artifact.sampleIntervalMs) + 1;
                artifact.samples = Array.from({ length: sampleCount }, () => 32_000_000);
            }
            const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
            writeFileSync(join(root, paths.artifactPath), artifactText);
            mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
                const binding = receipt.deviceMeasurement.runtimeEnvelope.externalMemoryEnvelope;
                binding.artifactSha256 = sha256(artifactText);
                if (violation === "provenance") binding.counter = artifact.counter;
                if (violation === "future window") {
                    binding.windowFinishedAt = artifact.windowFinishedAt;
                    binding.sampleCount = artifact.samples.length;
                }
            });

            const { processStatus, result } = runVerifier(root);

            expect(processStatus).toBe(1);
            expect(result.status).toBe("FAIL");
            expect(result.integrityErrors).toContain(violation === "schema"
                ? "app_external_memory_artifact_schema_invalid"
                : "app_external_memory_artifact_provenance_invalid");
        },
    );

    it("classifies a valid v4 App receipt against v5 artifacts as stale", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.fixtureVersion = "b125-retrieval-smoke-v4";
            delete receipt.deviceMeasurement.workloadBinding;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toEqual(expect.arrayContaining([
            "app_receipt_fixture_version_not_current",
            "app_receipt_manifest_schema_not_current",
            "app_performance_workload_binding_missing",
        ]));
        expect(result.integrityErrors).toEqual([]);
    });

    it("constructs Pagelet delivery receipt hashes with production stable serialization", () => {
        const root = createFixtureRoot();
        const receipt = JSON.parse(readFileSync(
            join(root, "test/retrieval-optimization-smoke-result.json"),
            "utf8",
        )) as Record<string, any>;
        const insights = [
            ...receipt.pageletCases["pagelet-1"].insights,
            ...receipt.pageletCases["pagelet-2"].insights,
        ];

        expect(insights).toHaveLength(3);
        for (const insight of insights) {
            expect(insight.deliveryReceiptSha256).toBe(
                sha256(stableStringify(insight.deliveryReceipt)),
            );
        }
    });

    it.each([
        ["dist plugin", "dist/main.js", "plugin_dist_vault_mismatch"],
        [
            "test-vault plugin",
            "test/.obsidian/plugins/personal-assistant/main.js",
            "plugin_dist_vault_mismatch",
        ],
        [
            "source App runner",
            "scripts/retrieval-optimization-smoke-runner.js",
            "app_runner_source_vault_mismatch",
        ],
        [
            "test-vault App runner",
            "test/retrieval-optimization-smoke-runner.js",
            "app_runner_source_vault_mismatch",
        ],
        [
            "source manifest",
            "__fixtures__/retrieval-smoke/manifest.json",
            "manifest_source_vault_mismatch",
        ],
        [
            "test-vault manifest",
            "test/retrieval-optimization-smoke-manifest.json",
            "manifest_source_vault_mismatch",
        ],
        [
            "source OPFS runner",
            "scripts/retrieval-opfs-restart-runner.js",
            "opfs_runner_source_vault_mismatch",
        ],
        [
            "test-vault OPFS runner",
            "test/retrieval-opfs-restart-runner.js",
            "opfs_runner_source_vault_mismatch",
        ],
    ])("blocks %s drift", (_label, relativePath, expectedBlocker) => {
        const root = createFixtureRoot();
        const current = readFileSync(join(root, relativePath), "utf8");
        const drift = relativePath.endsWith(".json")
            ? `${current}\n `
            : `${current}\n// verifier drift fixture\n`;
        replaceFixture(root, relativePath, drift);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain(expectedBlocker);
        expect(result.claim.liveProcessCurrentnessClaimed).toBe(false);
    });

    it.each([
        ["App", "test/retrieval-optimization-smoke-result.json"],
        ["OPFS", "test/retrieval-opfs-restart-receipt.json"],
    ])("fails closed when the %s receipt records loaded/disk plugin mismatch", (kind, path) => {
        const root = createFixtureRoot();
        if (kind === "App") {
            mutateJson(root, path, (receipt) => {
                receipt.identity.loadedPluginArtifactSha256 = "f".repeat(64);
            });
        } else {
            mutateJson(root, path, (receipt) => {
                receipt.before.plugin.loadedBuild.loadedPluginArtifactSha256 = "f".repeat(64);
            }, true);
        }

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(kind === "App"
            ? "app_receipt_loaded_disk_mismatch"
            : "opfs_before_loaded_disk_mismatch");
    });

    it.each([
        ["App", "test/retrieval-optimization-smoke-result.json"],
        ["OPFS", "test/retrieval-opfs-restart-receipt.json"],
    ])("blocks an unfinished %s receipt", (kind, path) => {
        const root = createFixtureRoot();
        if (kind === "App") {
            mutateJson(root, path, (receipt) => {
                receipt.finishedAt = null;
            });
        } else {
            mutateJson(root, path, (receipt) => {
                receipt.evidenceWindow.finishedAt = null;
            }, true);
        }

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain(kind === "App"
            ? "app_receipt_unfinished"
            : "opfs_receipt_unfinished");
    });

    it.each(["App", "OPFS"])("returns FAIL when the required %s slice is non-PASS", (kind) => {
        const root = createFixtureRoot();
        if (kind === "App") {
            mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
                receipt.recoveryCase.status = "FAIL";
                receipt.manualCases["chat-recovery"].status = "FAIL";
            });
        } else {
            mutateJson(root, "test/retrieval-opfs-restart-receipt.json", (receipt) => {
                receipt.after.runtime.pid = receipt.before.runtime.pid;
                receipt.comparison.fullAppRestart.status = "FAIL";
                receipt.comparison.fullAppRestart.pidChanged = false;
                receipt.comparison.status = "FAIL";
                receipt.comparison.issues = [{
                    code: "full_app_restart_pid_unchanged",
                    status: "FAIL",
                }];
                receipt.status = "FAIL";
                receipt.issues = [{
                    code: "full_app_restart_pid_unchanged",
                    status: "FAIL",
                }];
            }, true);
        }

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBeNull();
        expect(result.failures).toContain(kind === "App"
            ? "app_required_slice_failed:chat-recovery"
            : "opfs_receipt_failed");
        expect(result.integrityErrors).toEqual([]);
    });

    it("keeps a pending App required slice BLOCKED when evidence fields are not recorded", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.recoveryCase.status = "PENDING";
            receipt.recoveryCase.detail = "";
            receipt.recoveryCase.recordedAt = null;
            receipt.recoveryCase.evidenceSha256 = null;
            receipt.manualCases["chat-recovery"].status = "PENDING";
            receipt.manualCases["chat-recovery"].detail = "";
            receipt.manualCases["chat-recovery"].recordedAt = null;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("app_required_slice_not_pass:chat-recovery");
        expect(result.integrityErrors).toEqual([]);
    });

    it("blocks when a required Pagelet slice is missing", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            delete receipt.pageletCases["pagelet-1"];
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("app_required_slice_missing:pagelet-1");
        expect(result.integrityErrors).toEqual([]);
    });

    it.each([
        ["legacy schema", (sourceBinding: Record<string, any>) => {
            sourceBinding.schemaVersion = 1;
        }],
        ["missing runtime completion", (sourceBinding: Record<string, any>) => {
            delete sourceBinding.runtimeCompletion;
        }],
        ["extra source-binding field", (sourceBinding: Record<string, any>) => {
            sourceBinding.promptText = "must-not-cross-the-content-free-seam";
        }],
        ["extra runtime-completion field", (sourceBinding: Record<string, any>) => {
            sourceBinding.runtimeCompletion.promptText = "must-not-cross-the-content-free-seam";
        }],
        ["invalid runtime code", (sourceBinding: Record<string, any>) => {
            sourceBinding.runtimeCompletion.endReason = "invalid runtime code";
        }],
    ])("fails closed for Pagelet schema v2 %s after the evidence digest is recomputed", (
        _label,
        mutateSourceBinding,
    ) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            const pageletCase = receipt.pageletCases["pagelet-1"];
            mutateSourceBinding(pageletCase.sourceBinding);
            resealPageletCase(pageletCase);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(
            "app_pagelet_source_binding_invalid:pagelet-1",
        );
        expect(result.integrityErrors).not.toContain(
            "app_pagelet_evidence_digest_mismatch:pagelet-1",
        );
    });

    it("fails closed when a Pagelet delivery receipt digest is tampered", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.pageletCases["pagelet-1"].insights[0].deliveryReceiptSha256 =
                "f".repeat(64);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(
            "app_pagelet_evidence_digest_mismatch:pagelet-1",
        );
    });

    it("keeps a sealed OPFS BLOCKED receipt classified as BLOCKED", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-opfs-restart-receipt.json", (receipt) => {
            receipt.status = "BLOCKED";
            receipt.issues = [{ code: "fixture_blocked", status: "BLOCKED" }];
        }, true);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("opfs_receipt_not_pass");
        expect(result.integrityErrors).toEqual([]);
    });

    it("accepts the runner's comparison-unavailable BLOCKED receipt shape", () => {
        const root = createFixtureRoot();
        mutateBoundOpfsEvidence(root, (baseline, receipt) => {
            baseline.status = "BLOCKED";
            baseline.operatorAssertion.confirmed = false;
            baseline.operatorAssertion.confirmedAt = null;
            baseline.operatorAssertion.status = "BLOCKED";
            baseline.issues = [{
                code: "operator_before_assertion_missing",
                status: "BLOCKED",
            }];
            receipt.status = "BLOCKED";
            receipt.operatorAssertions.status = "BLOCKED";
            receipt.comparison = blockedOpfsComparison();
            receipt.issues = [
                { code: "baseline_not_pass", status: "BLOCKED" },
                { code: "comparison_unavailable", status: "BLOCKED" },
            ];
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toEqual(expect.arrayContaining([
            "opfs_baseline_not_pass",
            "opfs_receipt_not_pass",
            "opfs_comparison_not_pass",
        ]));
        expect(result.failures).toEqual([]);
        expect(result.integrityErrors).toEqual([]);
    });

    it("accepts the runner's baseline-unavailable BLOCKED receipt shape", () => {
        const root = createFixtureRoot();
        unlinkSync(join(root, "test/retrieval-opfs-restart-baseline.json"));
        mutateJson(root, "test/retrieval-opfs-restart-receipt.json", (receipt) => {
            receipt.status = "BLOCKED";
            receipt.runIdentitySha256 = null;
            receipt.evidenceWindow.startedAt = null;
            receipt.evidenceWindow.durationMs = null;
            receipt.evidenceWindow.withinMaximum = false;
            receipt.operatorAssertions.before = null;
            receipt.operatorAssertions.status = "BLOCKED";
            receipt.baselineBinding.artifactSha256 = null;
            receipt.baselineBinding.evidenceSha256 = null;
            receipt.baselineBinding.status = "BLOCKED";
            receipt.before = null;
            receipt.comparison = blockedOpfsComparison();
            receipt.issues = [
                { code: "baseline_unavailable", status: "BLOCKED" },
                { code: "comparison_unavailable", status: "BLOCKED" },
                { code: "evidence_window_invalid", status: "BLOCKED" },
            ];
        }, true);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toEqual(expect.arrayContaining([
            "artifact_missing:opfsBaseline",
            "opfs_receipt_run_identity_invalid",
            "opfs_baseline_binding_not_pass",
            "opfs_comparison_not_pass",
        ]));
        expect(result.failures).toEqual([]);
        expect(result.integrityErrors).toEqual([]);
    });

    it("accepts the runner's invalid-runtime FAIL receipt shape as failure", () => {
        const root = createFixtureRoot();
        mutateBoundOpfsEvidence(root, (_baseline, receipt) => {
            receipt.after.runtime.processType = "browser";
            receipt.after.status = "FAIL";
            receipt.after.issues = [{
                code: "process_type_not_renderer",
                status: "FAIL",
            }];
            receipt.status = "FAIL";
            receipt.comparison = blockedOpfsComparison();
            receipt.issues = [
                { code: "process_type_not_renderer", status: "FAIL" },
                { code: "comparison_unavailable", status: "BLOCKED" },
            ];
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.failures).toEqual(expect.arrayContaining([
            "opfs_receipt_failed",
            "opfs_after_runtime_identity_invalid",
        ]));
        expect(result.integrityErrors).toEqual([]);
    });

    it("returns the integrity exit code for a tampered OPFS receipt digest", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-opfs-restart-receipt.json", (receipt) => {
            receipt.after.runtime.pid += 1;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain("opfs_receipt_evidence_digest_mismatch");
    });

    it("blocks when a required current artifact is missing", () => {
        const root = createFixtureRoot();
        unlinkSync(join(root, "scripts/retrieval-opfs-restart-runner.js"));

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("artifact_missing:opfsRunnerSource");
    });

    it("documents the shared PASS/FAIL/BLOCKED exit convention", () => {
        const run = spawnSync(process.execPath, [verifierPath, "--help"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        });

        expect(run.status).toBe(0);
        expect(run.stdout).toContain(
            "Exit codes: PASS=0, FAIL (including integrity errors)=1, BLOCKED=2.",
        );
        expect(run.stdout).toContain(
            "The unsealed App receipt is checked for binding/consistency, not authenticity.",
        );
    });

    it("returns structured integrity FAIL with exit 1 for invalid JSON-mode usage", () => {
        const run = spawnSync(process.execPath, [verifierPath, "--json", "--invalid"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        });
        const result = JSON.parse(run.stdout) as VerificationResult;

        expect(run.status).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.exitCode).toBe(1);
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.claim.appReceiptAuthenticityVerified).toBe(false);
    });

    it("blocks when a post-receipt test-vault fixture body drifts", () => {
        const root = createFixtureRoot();
        const fixturePath = Object.keys(currentFixtureManifest.files)[0];
        const relativePath = `test/${fixturePath}`;
        const current = readFileSync(join(root, relativePath), "utf8");
        replaceFixture(root, relativePath, `${current}\nfixture drift\n`);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("fixture_files_not_current");
        expect(result.artifacts.fixtureBundle.verifiedFileCount).toBe(
            Object.keys(currentFixtureManifest.files).length - 1,
        );
    });

    it("blocks when a temporal fixture mtime drifts by the runner boundary", () => {
        const root = createFixtureRoot();
        const [fixturePath, timestamp] = Object.entries(
            currentFixtureManifest.temporalFixtureMtimes,
        )[0];
        const relativePath = `test/${fixturePath}`;
        const current = readFileSync(join(root, relativePath), "utf8");
        replaceFixture(root, relativePath, current);
        const drifted = new Date(Date.parse(timestamp) + 1_000);
        utimesSync(join(root, relativePath), drifted, drifted);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("temporal_fixture_mtime_not_current");
        expect(result.artifacts.fixtureBundle.temporalVerifiedCount).toBe(
            Object.keys(currentFixtureManifest.temporalFixtureMtimes).length - 1,
        );
    });

    it("blocks when the current OPFS baseline bytes drift from the receipt binding", () => {
        const root = createFixtureRoot();
        const path = "test/retrieval-opfs-restart-baseline.json";
        const current = readFileSync(join(root, path), "utf8");
        replaceFixture(root, path, `${current}\n `);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("opfs_baseline_artifact_not_current");
        expect(result.receipts.opfsBaseline.status).toBe("BLOCKED");
    });

    it("blocks when the bound OPFS baseline is missing", () => {
        const root = createFixtureRoot();
        unlinkSync(join(root, "test/retrieval-opfs-restart-baseline.json"));

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("artifact_missing:opfsBaseline");
        expect(result.receipts.opfsBaseline.status).toBe("BLOCKED");
    });

    it("returns integrity FAIL when the OPFS baseline seal is tampered", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-opfs-restart-baseline.json", (baseline) => {
            baseline.snapshot.runtime.pid += 1;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain("opfs_baseline_evidence_digest_mismatch");
    });

    it("blocks a receipt whose fixture-bundle identity is stale", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.identity.fixtureBundleSha256 = "f".repeat(64);
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(2);
        expect(result.status).toBe("BLOCKED");
        expect(result.blockers).toContain("app_receipt_fixture_bundle_not_current");
    });

    it("returns integrity FAIL for a receipt temporal-mtime binding outside tolerance", () => {
        const root = createFixtureRoot();
        const [fixturePath, timestamp] = Object.entries(
            currentFixtureManifest.temporalFixtureMtimes,
        )[0];
        mutateJson(root, "test/retrieval-optimization-smoke-result.json", (receipt) => {
            receipt.identity.temporalFixtureMtimes[fixturePath] = new Date(
                Date.parse(timestamp) + 1_000,
            ).toISOString();
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(
            "app_receipt_temporal_fixture_mtimes_invalid",
        );
    });

    it.each([
        ["pid", (receipt: Record<string, any>) => {
            receipt.after.runtime.pid = receipt.before.runtime.pid;
        }, "opfs_full_app_restart_summary_mismatch"],
        ["stable field", (receipt: Record<string, any>) => {
            receipt.after.storage.fileCount += 1;
        }, "opfs_stable_field_summary_mismatch"],
    ])("rejects resealed OPFS raw/summary contradiction for %s", (
        _label,
        mutate,
        expectedIntegrityError,
    ) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-opfs-restart-receipt.json", mutate, true);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(expectedIntegrityError);
    });

    it("classifies resealed raw OPFS drift with a matching FAIL summary as failure", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-opfs-restart-receipt.json", (receipt) => {
            receipt.after.storage.fileCount += 1;
            receipt.comparison.stableFields["storage.fileCount"] = "FAIL";
            receipt.comparison.status = "FAIL";
            receipt.comparison.issues = [{
                code: "stable_field_drift:storage.fileCount",
                status: "FAIL",
            }];
            receipt.status = "FAIL";
            receipt.issues = [{
                code: "stable_field_drift:storage.fileCount",
                status: "FAIL",
            }];
        }, true);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBeNull();
        expect(result.failures).toEqual(expect.arrayContaining([
            "opfs_receipt_failed",
            "opfs_comparison_failed",
            "opfs_stable_field_raw_drift",
        ]));
        expect(result.integrityErrors).toEqual([]);
    });

    it.each([
        ["status", (receipt: Record<string, any>) => {
            receipt.after.storage.status = "stale";
        }],
        ["backend", (receipt: Record<string, any>) => {
            receipt.after.storage.backend = "memory-fallback";
        }],
        ["fallback", (receipt: Record<string, any>) => {
            receipt.after.storage.fallbackMode = true;
        }],
        ["positive counts", (receipt: Record<string, any>) => {
            receipt.after.storage.fileCount = 0;
        }],
        ["lexical readiness", (receipt: Record<string, any>) => {
            receipt.after.storage.lexicalProfile.state = "stale";
        }],
        ["continuity", (receipt: Record<string, any>) => {
            receipt.after.storage.continuity.indexIdSha256 = null;
        }],
        ["scope", (receipt: Record<string, any>) => {
            receipt.after.storage.scopeIdentity.combinedSha256 = null;
        }],
    ])("rejects a PASS receipt with invalid durable storage %s", (_label, mutate) => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-opfs-restart-receipt.json", mutate, true);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain("opfs_after_durable_storage_invalid");
    });

    it("rejects synchronized invalid durable storage even when stable summaries stay PASS", () => {
        const root = createFixtureRoot();
        mutateJson(root, "test/retrieval-opfs-restart-receipt.json", (receipt) => {
            receipt.before.storage.backend = "memory-fallback";
            receipt.after.storage.backend = "memory-fallback";
        }, true);

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "opfs_before_durable_storage_invalid",
            "opfs_after_durable_storage_invalid",
        ]));
    });

    it.each([
        ["app version source", "appVersionSource", "browser"],
        ["desktop platform", "platform", "haiku"],
        ["renderer process type", "processType", "forged"],
    ])("rejects synchronized and resealed invalid OPFS runtime %s", (
        _label,
        field,
        value,
    ) => {
        const root = createFixtureRoot();
        mutateBoundOpfsEvidence(root, (baseline, receipt) => {
            baseline.snapshot.runtime[field] = value;
            receipt.after.runtime[field] = value;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "opfs_before_runtime_identity_invalid",
            "opfs_after_runtime_identity_invalid",
        ]));
    });

    it.each([
        ["load timestamp", "capturedAtPluginLoad", null],
        ["lexical fingerprint", "lexicalProfileRuntimeFingerprint", ""],
    ])("rejects synchronized and resealed invalid loaded-build %s", (
        _label,
        field,
        value,
    ) => {
        const root = createFixtureRoot();
        mutateBoundOpfsEvidence(root, (baseline, receipt) => {
            baseline.snapshot.plugin.loadedBuild[field] = value;
            receipt.after.plugin.loadedBuild[field] = value;
        });

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toEqual(expect.arrayContaining([
            "opfs_before_plugin_identity_invalid",
            "opfs_after_plugin_identity_invalid",
        ]));
    });

    it.each([
        ["null App receipt", "test/retrieval-optimization-smoke-result.json", null,
            "app_receipt_schema_invalid"],
        ["false OPFS receipt", "test/retrieval-opfs-restart-receipt.json", false,
            "opfs_receipt_schema_invalid"],
        ["zero manifest", "__fixtures__/retrieval-smoke/manifest.json", 0,
            "manifest_source_schema_invalid"],
        ["empty-string baseline", "test/retrieval-opfs-restart-baseline.json", "",
            "opfs_baseline_schema_invalid"],
    ])("rejects non-object JSON: %s", (_label, path, primitive, expectedIntegrityError) => {
        const root = createFixtureRoot();
        replaceFixture(root, path, JSON.stringify(primitive));

        const { processStatus, result } = runVerifier(root);

        expect(processStatus).toBe(1);
        expect(result.status).toBe("FAIL");
        expect(result.errorCode).toBe("RETRIEVAL_EVIDENCE_INTEGRITY_ERROR");
        expect(result.integrityErrors).toContain(expectedIntegrityError);
    });
});
