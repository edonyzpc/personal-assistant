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
    const rawSamples = Array.from({ length: rawSampleCount }, (_, index) => index + 1);
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
        schemaVersion: 1,
        sequence,
        controllerSequence: sequence,
        runId: `fixture-${id}-run`,
        resultId: `fixture-${id}-result`,
        triggerReason: "explicit",
        force: true,
        resultStatus: quiet ? "quiet" : "verified",
        reason: quiet ? "no-insight" : null,
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
