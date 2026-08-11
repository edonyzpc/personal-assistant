/*
 * B-125 retrieval-optimization app smoke recorder.
 *
 * This script intentionally performs no provider call, Memory rebuild, source
 * mutation, settings mutation, or automatic PASS of a Chat/Pagelet case.
 * Prepare the synthetic fixture pack first, enable the rollout flags only in
 * the isolated test vault, reload Obsidian, then run in DevTools:
 *
 *   eval(await app.vault.adapter.read("retrieval-optimization-smoke-runner.js"))
 *
 * Record an observed case:
 *   await paRetrievalSmoke.recordCase("lexical", "PASS", "observed result")
 * Run the frozen Chat recovery canary as the first retrieval after runner setup
 * and before freezing the device plan, then bind its isolated active pre-freeze
 * diagnostics topology to the live completed Chat turn's canonical cumulative
 * Memory projection (never DOM/source-chip text):
 *   // Ask exactly: 只从我的笔记中回答：RCV-271 猩红雨伞事故的根因是什么？
 *   await paRetrievalSmoke.recordRecoveryCase()
 * Bind each Pagelet observation to its exact insight ids and source paths:
 *   await paRetrievalSmoke.recordPageletCase("pagelet-0")
 *   await paRetrievalSmoke.recordPageletCase("pagelet-1")
 *   await paRetrievalSmoke.recordPageletCase("pagelet-2")
 * Freeze explicit device thresholds and the reranker gate before collecting
 * ranking or device evidence:
 *   await paRetrievalSmoke.freezeDeviceMeasurementPlan({ thresholds })
 * Run the explicit-range temporal retry canary in the post-freeze qualitative
 * staging session before rankings and before the performance envelope:
 *   // Ask exactly: 只从我的笔记中，仅使用 2026-01-01 到 2026-12-31 的记录回答：TRT-826 紫晶日晷事故的根因是什么？
 *   await paRetrievalSmoke.recordTemporalRetryCase()
 * The canonical plan intentionally leaves calibration thresholds pending/null;
 * it cannot pass until the operator supplies and freezes reviewed thresholds.
 * Record the exact final source-chip order for a frozen ranking case after the
 * plan is frozen and before starting the performance envelope:
 *   await paRetrievalSmoke.recordRankingCase("lexical-title")
 * Qualify the live fresh-Chat standard and retry shapes in that same staging
 * session, immediately after each exact prompt completes:
 *   await paRetrievalSmoke.recordPerformanceQualification("standard")
 *   await paRetrievalSmoke.recordPerformanceQualification("retry")
 * Bind peak/stall sampling to the complete standard + retry performance workload:
 *   // The fixed external-memory JSON and raw export must both be absent here.
 *   await paRetrievalSmoke.startRuntimeEnvelope()
 *   // For each advertised nextPerformanceWorkload prompt, use a fresh Chat and
 *   // immediately call recordPerformanceEpisode() after its completed turn.
 *   // Perform the 23 sequential single-attempt standard retrieval episodes.
 *   await paRetrievalSmoke.beginRetryPerformance()
 *   // Perform 12 sequential two-attempt retry episodes, each with projection.
 *   await paRetrievalSmoke.continueRetryPerformance()
 *   // Perform the remaining 11 retry episodes in the second bounded session.
 *   await paRetrievalSmoke.stopRuntimeEnvelope()
 * On runtimes without Electron process-memory sampling, bind a system-profiler series
 * to that exact runtime-envelope window with:
 *   await paRetrievalSmoke.recordExternalMemoryEnvelope({
 *     artifactPath: "retrieval-smoke/evidence/system-memory-envelope.json",
 *   })
 * The JSON must declare the fixed content-free raw-export path
 * `retrieval-smoke/evidence/system-memory-envelope.instruments.xml` and the
 * SHA-256 of that raw export. Until a reviewed converter derives the JSON
 * samples from those raw bytes, the runner records
 * `external_memory_converter_unverified` and keeps process memory BLOCKED.
 * Then isolate cancellation evidence in a fresh plugin diagnostics session:
 *   await paRetrievalSmoke.beginCancellationProbe()
 *   // The next dispatched Chat graph Worker is cancelled once by the
 *   // diagnostics-only child-request probe. Perform exactly one retrieval,
 *   // then bind it with recordPerformanceEpisode().
 * Capture a live content-free diagnostics snapshot without stopping the run:
 *   await paRetrievalSmoke.captureRetrievalDiagnostics()
 *
 * Finish, automatically stop/capture diagnostics, and verify stability:
 *   await paRetrievalSmoke.finalize()
 */
/* global app, console, crypto, document, navigator, PerformanceObserver, performance, process, requestAnimationFrame, setTimeout, TextDecoder, TextEncoder */
(async () => {
  const PLUGIN_ID = "personal-assistant";
  const RESULT_PATH = "retrieval-optimization-smoke-result.json";
  const MANIFEST_PATH = "retrieval-optimization-smoke-manifest.json";
  const RUNNER_PATH = "retrieval-optimization-smoke-runner.js";
  const EXTERNAL_MEMORY_ARTIFACT_PATH = "retrieval-smoke/evidence/system-memory-envelope.json";
  const EXTERNAL_MEMORY_RAW_EXPORT_PATH = "retrieval-smoke/evidence/system-memory-envelope.instruments.xml";
  const EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON = "external_memory_converter_unverified";
  const EXPECTED_MANIFEST_SHA256 = "4be0c391317e061084acda37f3896143b95892b06b7cf2ffa92a1677e3045a99";
  const MIN_DIAGNOSTICS_SESSION_CAPACITY = 512;
  const RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION = 1;
  const FIXTURE_VERSION = "b125-retrieval-smoke-v5";
  const PERFORMANCE_WORKLOAD_SCHEMA_VERSION = 1;
  const PERFORMANCE_WORKLOAD_CONVERSATION_POLICY = "fresh-chat-per-episode";
  const PERFORMANCE_STAGE_COUNTS = Object.freeze({
    standardPerformance: 23,
    retryPerformanceBatch1: 12,
    retryPerformanceBatch2: 11,
    cancellationProbe: 1,
  });
  const PERFORMANCE_QUALIFICATION_IDS = Object.freeze(["standard-v1", "retry-v1"]);
  const PERFORMANCE_PROMPT_SHAPES = Object.freeze({
    "standard-v1": "one-attempt-full-graph",
    "retry-v1": "two-attempt-full-graph-with-projection",
    "cancel-v1": "one-attempt-same-worker-cancel",
  });
  const PERFORMANCE_PROMPT_TEXTS = Object.freeze({
    "standard-v1": "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因是什么？",
    "retry-v1": "只从我的笔记中回答：PFR-842 琥珀罗盘事故的完整根因是什么？",
    "cancel-v1": "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因与修复方向是什么？",
  });
  const PERFORMANCE_STAGE_PROMPTS = Object.freeze({
    standardPerformance: "standard-v1",
    retryPerformanceBatch1: "retry-v1",
    retryPerformanceBatch2: "retry-v1",
    cancellationProbe: "cancel-v1",
  });
  const PERFORMANCE_STAGE_SEGMENTS = Object.freeze({
    standardPerformance: Object.freeze([
      Object.freeze({
        idPrefix: "perf-std-warmup-", from: 1, to: 3, pad: 2,
        sampleClass: "warmup", promptId: "standard-v1",
      }),
      Object.freeze({
        idPrefix: "perf-std-measured-", from: 1, to: 20, pad: 2,
        sampleClass: "measured", promptId: "standard-v1",
      }),
    ]),
    retryPerformanceBatch1: Object.freeze([
      Object.freeze({
        idPrefix: "perf-retry-warmup-", from: 1, to: 3, pad: 2,
        sampleClass: "warmup", promptId: "retry-v1",
      }),
      Object.freeze({
        idPrefix: "perf-retry-measured-", from: 1, to: 9, pad: 2,
        sampleClass: "measured", promptId: "retry-v1",
      }),
    ]),
    retryPerformanceBatch2: Object.freeze([
      Object.freeze({
        idPrefix: "perf-retry-measured-", from: 10, to: 20, pad: 2,
        sampleClass: "measured", promptId: "retry-v1",
      }),
    ]),
    cancellationProbe: Object.freeze([
      Object.freeze({
        id: "perf-cancel-probe-01", sampleClass: "probe", promptId: "cancel-v1",
      }),
    ]),
  });
  const OLD_TEMPORAL_FIXTURE = "retrieval-smoke/temporal/60-old-note.md";
  const REQUIRED_FLAGS = ["lexicalProfile", "strictReranker", "graphPpr", "relaxedRecovery"];
  const REQUIRED_CASES = [
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
  const LEXICAL_FIXTURE = "retrieval-smoke/lexical/量子灯塔检索.md";
  const DEEP_FIXTURE = "retrieval-smoke/graph/30-deep-target.md";
  const TWO_OPAQUE_FORBIDDEN_FIXTURE = "retrieval-smoke/graph/31-two-opaque-forbidden-target.md";
  const CONVERGENCE_FIXTURE = "retrieval-smoke/graph/42-convergence-target.md";
  const WEAK_SUPPORT_FIXTURE = "retrieval-smoke/graph/43-weak-single-support.md";
  const RECENT_TEMPORAL_FIXTURE = "retrieval-smoke/temporal/61-recent-note.md";
  const PAGELET_ZERO_ENTRY_FIXTURE = "retrieval-smoke/pagelet/52-no-insight.md";
  const PAGELET_SINGLE_ENTRY_FIXTURE = "retrieval-smoke/pagelet/51-one-insight.md";
  const PAGELET_DOUBLE_ENTRY_FIXTURE = "retrieval-smoke/pagelet/50-current-note.md";
  const PAGELET_SINGLE_SOURCE_FIXTURE = "retrieval-smoke/pagelet/53-single-source.md";
  const PAGELET_DOUBLE_SOURCE_A_FIXTURE = "retrieval-smoke/pagelet/54-double-source-a.md";
  const PAGELET_DOUBLE_SOURCE_B_FIXTURE = "retrieval-smoke/pagelet/55-double-source-b.md";
  const PAGELET_CASES = Object.freeze({
    "pagelet-0": Object.freeze({
      entryPath: PAGELET_ZERO_ENTRY_FIXTURE,
      expectedInsightCount: 0,
      sourcePaths: Object.freeze([]),
    }),
    "pagelet-1": Object.freeze({
      entryPath: PAGELET_SINGLE_ENTRY_FIXTURE,
      expectedInsightCount: 1,
      sourcePaths: Object.freeze([PAGELET_SINGLE_SOURCE_FIXTURE]),
    }),
    "pagelet-2": Object.freeze({
      entryPath: PAGELET_DOUBLE_ENTRY_FIXTURE,
      expectedInsightCount: 2,
      sourcePaths: Object.freeze([
        PAGELET_DOUBLE_SOURCE_A_FIXTURE,
        PAGELET_DOUBLE_SOURCE_B_FIXTURE,
      ]),
    }),
  });
  const REQUIRED_PAGELET_CASES = Object.keys(PAGELET_CASES);
  const RECOVERY_PROMPT = "只从我的笔记中回答：RCV-271 猩红雨伞事故的根因是什么？";
  const CHAT_VIEW_TYPE = "sidellm-view";
  const RECOVERY_STANDARD_FIXTURES = [
    "retrieval-smoke/recovery/70-standard-insufficient-01.md",
    "retrieval-smoke/recovery/71-standard-insufficient-02.md",
    "retrieval-smoke/recovery/72-standard-insufficient-03.md",
    "retrieval-smoke/recovery/73-standard-insufficient-04.md",
    "retrieval-smoke/recovery/74-standard-insufficient-05.md",
    "retrieval-smoke/recovery/75-standard-insufficient-06.md",
    "retrieval-smoke/recovery/76-standard-insufficient-07.md",
    "retrieval-smoke/recovery/77-standard-insufficient-08.md",
    "retrieval-smoke/recovery/78-standard-insufficient-09.md",
    "retrieval-smoke/recovery/79-standard-insufficient-10.md",
    "retrieval-smoke/recovery/80-standard-insufficient-11.md",
    "retrieval-smoke/recovery/81-standard-insufficient-12.md",
  ];
  const RECOVERY_TARGET_FIXTURE = "retrieval-smoke/recovery/90-relaxed-target.md";
  const RECOVERY_ALLOWED_FIXTURES = [
    ...RECOVERY_STANDARD_FIXTURES,
    RECOVERY_TARGET_FIXTURE,
  ];
  const RECOVERY_FINAL_SOURCE_CONTRACT = Object.freeze({
    maximumSourceCount: 8,
    allowedStandardEvidenceModes: Object.freeze(["valid-none", "strict-partial"]),
    partialPreservesFrozenStandardSubset: true,
    requiresRelaxedTarget: true,
  });
  const TEMPORAL_RETRY_PROMPT = "只从我的笔记中，仅使用 2026-01-01 到 2026-12-31 的记录回答：TRT-826 紫晶日晷事故的根因是什么？";
  const TEMPORAL_RETRY_TIME_RANGE = Object.freeze({
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-12-31T23:59:59.999Z",
  });
  const TEMPORAL_RETRY_STANDARD_FIXTURES = Object.freeze([
    "retrieval-smoke/temporal-retry/100-standard-insufficient-01.md",
    "retrieval-smoke/temporal-retry/101-standard-insufficient-02.md",
    "retrieval-smoke/temporal-retry/102-standard-insufficient-03.md",
    "retrieval-smoke/temporal-retry/103-standard-insufficient-04.md",
    "retrieval-smoke/temporal-retry/104-standard-insufficient-05.md",
    "retrieval-smoke/temporal-retry/105-standard-insufficient-06.md",
    "retrieval-smoke/temporal-retry/106-standard-insufficient-07.md",
    "retrieval-smoke/temporal-retry/107-standard-insufficient-08.md",
    "retrieval-smoke/temporal-retry/108-standard-insufficient-09.md",
    "retrieval-smoke/temporal-retry/109-standard-insufficient-10.md",
    "retrieval-smoke/temporal-retry/110-standard-insufficient-11.md",
    "retrieval-smoke/temporal-retry/111-standard-insufficient-12.md",
  ]);
  const TEMPORAL_RETRY_TARGET_FIXTURE = "retrieval-smoke/temporal-retry/112-relaxed-target.md";
  const TEMPORAL_RETRY_FORBIDDEN_FIXTURE = "retrieval-smoke/temporal-retry/113-old-forbidden.md";
  const TEMPORAL_RETRY_ALLOWED_FIXTURES = Object.freeze([
    ...TEMPORAL_RETRY_STANDARD_FIXTURES,
    TEMPORAL_RETRY_TARGET_FIXTURE,
  ]);
  const TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT = Object.freeze({
    ...RECOVERY_FINAL_SOURCE_CONTRACT,
    forbidsOutOfRangeSource: true,
  });
  const PERFORMANCE_WAVE1_DIRECT_PATHS = Object.freeze(Array.from(
    { length: 12 },
    (_, index) => `retrieval-smoke/performance/200-wave1-direct-${String(index + 1).padStart(2, "0")}.md`,
  ));
  const PERFORMANCE_WAVE1_GRAPH_HUB_PATH =
    "retrieval-smoke/performance/212-wave1-graph-hub.md";
  const PERFORMANCE_WAVE2_FRESH_DIRECT_PATHS = Object.freeze([
    "retrieval-smoke/performance/220-wave2-target.md",
    "retrieval-smoke/performance/221-wave2-helper.md",
  ]);
  const PERFORMANCE_WAVE2_GRAPH_HUB_PATH =
    "retrieval-smoke/performance/222-wave2-graph-hub.md";
  const PERFORMANCE_ALLOWED_FIXTURES = Object.freeze([
    ...PERFORMANCE_WAVE1_DIRECT_PATHS,
    PERFORMANCE_WAVE1_GRAPH_HUB_PATH,
    ...PERFORMANCE_WAVE2_FRESH_DIRECT_PATHS,
    PERFORMANCE_WAVE2_GRAPH_HUB_PATH,
  ]);
  const ALLOWED_FIXTURES = [
    "retrieval-smoke/README.md",
    LEXICAL_FIXTURE,
    "retrieval-smoke/graph/10-seed-a.md",
    DEEP_FIXTURE,
    TWO_OPAQUE_FORBIDDEN_FIXTURE,
    "retrieval-smoke/graph/40-convergence-seed-a.md",
    "retrieval-smoke/graph/41-convergence-seed-b.md",
    CONVERGENCE_FIXTURE,
    WEAK_SUPPORT_FIXTURE,
    PAGELET_DOUBLE_ENTRY_FIXTURE,
    PAGELET_SINGLE_ENTRY_FIXTURE,
    PAGELET_ZERO_ENTRY_FIXTURE,
    PAGELET_SINGLE_SOURCE_FIXTURE,
    PAGELET_DOUBLE_SOURCE_A_FIXTURE,
    PAGELET_DOUBLE_SOURCE_B_FIXTURE,
    ...RECOVERY_ALLOWED_FIXTURES,
    ...TEMPORAL_RETRY_ALLOWED_FIXTURES,
    TEMPORAL_RETRY_FORBIDDEN_FIXTURE,
    ...PERFORMANCE_ALLOWED_FIXTURES,
    OLD_TEMPORAL_FIXTURE,
    RECENT_TEMPORAL_FIXTURE,
  ];
  const OPAQUE_FIXTURES = [
    "retrieval-smoke/excluded/20-opaque-bridge.md",
    "retrieval-smoke/excluded/21-second-opaque.md",
  ];
  const OPAQUE_SENTINEL = "NEVER_EXPOSE_OPAQUE_B_92F7";
  const OPAQUE_REDACTIONS = [...OPAQUE_FIXTURES, OPAQUE_SENTINEL];
  const ROUTING_OBSERVATIONS = Object.freeze({
    "bare-error-code": "ERR_RETRIEVAL_LANTERN_7401",
    "bare-japanese": "日本語検索エンジン",
  });
  const RANKING_CASES = Object.freeze({
    "lexical-title": {
      prompt: "只从我的笔记中查找“量子灯塔检索”，并根据找到的记录回答。",
      relevantPath: LEXICAL_FIXTURE,
      forbiddenPaths: [],
    },
    "lexical-heading": {
      prompt: "只从我的笔记中查找“延迟恢复矩阵”，并根据找到的记录回答。",
      relevantPath: LEXICAL_FIXTURE,
      forbiddenPaths: [],
    },
    "lexical-error": {
      prompt: "只从我的笔记中查找错误码“ERR_RETRIEVAL_LANTERN_7401”，并根据找到的记录回答。",
      relevantPath: LEXICAL_FIXTURE,
      forbiddenPaths: [],
    },
    "graph-depth": {
      prompt: "只从我的笔记中回答：青铜罗盘为什么出现资源峰值？",
      relevantPath: DEEP_FIXTURE,
      forbiddenPaths: [TWO_OPAQUE_FORBIDDEN_FIXTURE, ...OPAQUE_FIXTURES],
    },
    convergence: {
      prompt: "只从我的笔记中回答：蓝色账本重复入账的共同原因是什么？",
      relevantPath: CONVERGENCE_FIXTURE,
      forbiddenPaths: [WEAK_SUPPORT_FIXTURE, ...OPAQUE_FIXTURES],
    },
    "temporal-2026": {
      prompt: "只从我的笔记中，仅使用 2026 年的记录说明当前时间边界信号。",
      relevantPath: RECENT_TEMPORAL_FIXTURE,
      forbiddenPaths: [OLD_TEMPORAL_FIXTURE],
    },
  });
  const REQUIRED_RANKING_CASES = Object.keys(RANKING_CASES);

  const startedAt = new Date().toISOString();
  const checks = [];
  const manualCases = Object.fromEntries(REQUIRED_CASES.map((id) => [id, {
    id,
    status: "PENDING",
    detail: "",
    recordedAt: null,
  }]));
  const rankingCases = Object.fromEntries(REQUIRED_RANKING_CASES.map((id) => [id, {
    id,
    status: "PENDING",
    rankedSources: [],
    relevantRank: null,
    reciprocalRank: 0,
    forbiddenHitCount: 0,
    evidence: null,
    recordedAt: null,
  }]));
  const pageletCases = Object.fromEntries(REQUIRED_PAGELET_CASES.map((id) => [id, {
    id,
    status: "PENDING",
    entryPath: PAGELET_CASES[id].entryPath,
    expectedInsightCount: PAGELET_CASES[id].expectedInsightCount,
    observedInsightCount: null,
    verifiedInsightCount: null,
    insights: [],
    invalidInsightCount: 0,
    invalidSourceCount: 0,
    duplicateInsightIdCount: 0,
    duplicateSourceCount: 0,
    opaqueHitCount: 0,
    unexpectedSourceCount: 0,
    candidateCount: null,
    deliveryReceiptCount: null,
    cacheMutationCount: null,
    sourceBinding: null,
    detail: "",
    recordedAt: null,
  }]));
  const sourceHashes = new Map();
  let settingsFingerprint = "";
  let settingsChangedDuringRun = false;
  let unsubscribeSettings = null;
  let uninstallSettingsAdmissionGuard = null;
  let settingsAdmissionGuardInstalled;
  let uninstallDiagnosticsSettingsGuard = null;
  let diagnosticsSettingsGuardInstalled;
  let pluginLifecycleDriftDetected = false;
  let identityDriftDetected = false;
  let uninstallPluginLifecycleGuard = null;
  let pluginLifecycleGuardInstalled;
  let receiptCommitCriticalSectionActive = false;
  let plugin = null;
  let initialLoadedPluginInstance = null;
  let initialRuntimeIdentity;
  let initialArtifactIdentity;
  let finalizing = false;
  let finalized = false;
  let writeQueue = Promise.resolve();
  let devicePlanTemplate = null;
  let frozenDevicePlan = null;
  let frozenDevicePlanCanonical = "";
  let diagnosticsSessionIdentity = null;
  let diagnosticsSessionStage = null;
  let diagnosticsSeamAvailable = false;
  let stoppedDiagnosticsProjection = null;
  const diagnosticsEvidenceProjections = {
    standardPerformance: null,
    retryPerformanceBatch1: null,
    retryPerformanceBatch2: null,
    cancellationProbe: null,
  };
  let diagnosticsOperationQueue = Promise.resolve();
  let diagnosticsEvidenceBlocked = false;
  let runtimeEnvelopeState = null;
  let externalMemoryEvidenceOperationQueue = Promise.resolve();
  let rankingEvidenceCursor = 0;
  let pageletEvidenceCursor = 0;
  let pageletEvidenceSeamAvailable = false;
  let pageletEvidenceOperationQueue = Promise.resolve();
  const pageletEvidenceRunIds = new Set();
  const pageletEvidenceResultIds = new Set();
  let performanceWorkloadContract = null;
  let performanceWorkloadSequence = [];
  let performanceQualificationCursor = 0;
  const performanceStageCursors = {
    standardPerformance: 0,
    retryPerformanceBatch1: 0,
    retryPerformanceBatch2: 0,
    cancellationProbe: 0,
  };
  const performanceEvidenceRunIds = new Set();
  let performanceEvidenceOperationQueue = Promise.resolve();
  let performanceTransitionOperationQueue = Promise.resolve();

  const result = {
    fixtureVersion: FIXTURE_VERSION,
    startedAt,
    finishedAt: null,
    overall: "PENDING",
    runtime: {},
    identity: {
      manifestSha256: null,
      fixtureBundleSha256: null,
      runnerSha256: null,
      pluginArtifactSha256: null,
      loadedPluginArtifactSha256: null,
      loadedPluginBuildIdentitySha256: null,
      deviceMeasurementPlanSha256: null,
      temporalFixtureMtimes: {},
    },
    checks,
    manualCases,
    recoveryCase: {
      id: "chat-recovery",
      status: "PENDING",
      prompt: RECOVERY_PROMPT,
      targetPath: RECOVERY_TARGET_FIXTURE,
      finalSources: [],
      standardSources: [],
      standardEvidenceMode: null,
      targetPresent: false,
      invalidSourceCount: 0,
      duplicateSourceCount: 0,
      opaqueHitCount: 0,
      unexpectedSourceCount: 0,
      a2FailureReason: null,
      topology: null,
      evidenceSha256: null,
      detail: "",
      recordedAt: null,
    },
    temporalRetryCase: {
      id: "temporal-retry",
      status: "PENDING",
      prompt: TEMPORAL_RETRY_PROMPT,
      timeRange: TEMPORAL_RETRY_TIME_RANGE,
      targetPath: TEMPORAL_RETRY_TARGET_FIXTURE,
      forbiddenPath: TEMPORAL_RETRY_FORBIDDEN_FIXTURE,
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
    },
    pageletCases,
    rankingCases,
    rerankerMetrics: {
      completed: 0,
      required: REQUIRED_RANKING_CASES.length,
      recallAt8: 0,
      mrr: 0,
      forbiddenHitCount: 0,
    },
    deviceMeasurement: {
      overall: "BLOCKED",
      planVersion: null,
      planSha256: null,
      planStatus: "UNFROZEN",
      percentileMethod: null,
      warmupSamples: null,
      sampleCount: null,
      metrics: {},
      rerankerGate: {
        status: "BLOCKED",
        reason: "device measurement plan is not frozen",
        minimumMrr: null,
        flagOffBaselineMrr: null,
        maximumMrrRegression: null,
      },
      vssStats: { before: null, after: null },
      runtimeEnvelope: {
        status: "BLOCKED",
        workloadCoverageStatus: "BLOCKED",
        reason: "runtime envelope has not been sampled around the frozen performance episodes",
        resourceIntervalMs: 1_000,
        stallIntervalMs: 50,
        resourceSampleCount: null,
        databaseSampleCount: null,
        runtimeProcessMemorySampleCount: null,
        stallSampleCount: null,
        startSequence: null,
        endSequence: null,
        coveredStandardPerformanceEpisodeCount: 0,
        coveredRetryPerformanceEpisodeCount: 0,
        startedAt: null,
        finishedAt: null,
        sourceCoverage: {
          database: "BLOCKED",
          processMemory: "BLOCKED",
          eventLoopStall: "BLOCKED",
        },
        iosEvidenceStatus: "NOT_EVALUATED",
        externalMemoryCapturePrecondition: {
          status: "BLOCKED",
          reason: "external memory capture-start absence has not been verified",
          checkedAt: null,
          artifactPath: EXTERNAL_MEMORY_ARTIFACT_PATH,
          artifactAbsent: null,
          rawExportPath: EXTERNAL_MEMORY_RAW_EXPORT_PATH,
          rawExportAbsent: null,
        },
        externalMemoryEnvelope: null,
      },
      workloadBinding: {
        schemaVersion: PERFORMANCE_WORKLOAD_SCHEMA_VERSION,
        status: "PENDING",
        contractSha256: null,
        sequenceSha256: null,
        bindingSha256: null,
        expectedEpisodeCount: Object.values(PERFORMANCE_STAGE_COUNTS)
          .reduce((sum, count) => sum + count, 0),
        boundEpisodeCount: 0,
        violationCount: 0,
        qualification: {
          status: "PENDING",
          requiredCount: PERFORMANCE_QUALIFICATION_IDS.length,
          boundCount: 0,
          violationCount: 0,
          bindingSha256: null,
          entries: [],
        },
        stages: Object.fromEntries(Object.entries(PERFORMANCE_STAGE_COUNTS).map(
          ([stage, expectedCount]) => [stage, {
            status: "PENDING",
            expectedCount,
            boundCount: 0,
            violationCount: 0,
          }],
        )),
        episodes: [],
      },
      diagnostics: null,
      diagnosticsSummary: null,
      diagnosticsGate: {
        status: "BLOCKED",
        reason: "retrieval diagnostics session is unavailable",
        schemaVersion: null,
        capacity: null,
      },
    },
  };

  const sanitize = (value) => {
    let text = String(value ?? "");
    for (const forbidden of OPAQUE_REDACTIONS) text = text.split(forbidden).join("[opaque-redacted]");
    return text;
  };

  const record = (name, status, detail = "", options = {}) => {
    const entry = {
      name,
      status,
      detail: sanitize(detail),
      ...(options.blocking === false ? { blocking: false } : {}),
    };
    checks.push(entry);
    console.log(`[retrieval-smoke:${status}] ${name}${entry.detail ? ` -- ${entry.detail}` : ""}`);
    return entry;
  };

  const assert = (name, condition, detail = "") => record(
    name,
    condition ? "PASS" : "FAIL",
    detail || (condition ? "" : "assertion failed"),
  );

  const selectedRerankerDescriptor = (currentPlugin) => {
    const settings = currentPlugin?.settings || {};
    const policyModelName = typeof settings.policyModelName === "string" ? settings.policyModelName.trim() : "";
    const chatModelName = typeof settings.chatModelName === "string" ? settings.chatModelName.trim() : "";
    return {
      class: policyModelName ? "policy" : chatModelName ? "chat" : "none",
      model: policyModelName || chatModelName,
      provider: typeof settings.aiProvider === "string" ? settings.aiProvider.trim() : "",
      baseURL: typeof settings.baseURL === "string" ? settings.baseURL.trim() : "",
    };
  };

  const canonicalStringList = (value) => ({
    shape: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
    valid: Array.isArray(value) && value.every((entry) => typeof entry === "string"),
    values: Array.isArray(value)
      ? value.map((entry) => (
        typeof entry === "string" ? entry.trim() : `[invalid:${typeof entry}:${String(entry)}]`
      )).sort()
      : [],
  });

  const fingerprintSettings = (currentPlugin) => JSON.stringify({
    flags: Object.fromEntries(REQUIRED_FLAGS.map((key) => [
      key,
      currentPlugin?.settings?.retrievalOptimizationFlags?.[key] === true,
    ])),
    excludedFolders: canonicalStringList(
      currentPlugin?.settings?.dataBoundary?.excludedFolders,
    ),
    excludedTags: canonicalStringList(currentPlugin?.settings?.dataBoundary?.excludedTags),
    generatedNotePolicy: typeof currentPlugin?.settings?.dataBoundary?.generatedNotePolicy === "string"
      ? currentPlugin.settings.dataBoundary.generatedNotePolicy
      : null,
    reranker: selectedRerankerDescriptor(currentPlugin),
  });

  const observePluginLifecycle = () => {
    if (app.plugins.plugins[PLUGIN_ID] !== initialLoadedPluginInstance) {
      pluginLifecycleDriftDetected = true;
    }
    return !pluginLifecycleDriftDetected;
  };

  const installPluginLifecycleGuard = () => {
    const pluginManager = app.plugins;
    const originalDescriptor = Object.getOwnPropertyDescriptor(pluginManager, "plugins");
    if (!originalDescriptor
      || !("value" in originalDescriptor)
      || !originalDescriptor.configurable
      || !originalDescriptor.value
      || typeof originalDescriptor.value !== "object") {
      return false;
    }

    let currentRawRegistry = originalDescriptor.value;
    const rawToProxy = new WeakMap();
    const proxyToRaw = new WeakMap();
    const unwrap = (value) => proxyToRaw.get(value) || value;
    const wrapRegistry = (rawRegistry) => {
      if (!rawRegistry || typeof rawRegistry !== "object") return rawRegistry;
      const existing = rawToProxy.get(rawRegistry);
      if (existing) return existing;
      const proxy = new Proxy(rawRegistry, {
        set(target, property, value) {
          const previous = Reflect.get(target, property, target);
          const next = unwrap(value);
          if (receiptCommitCriticalSectionActive
            && property === PLUGIN_ID
            && previous !== next) {
            throw new Error("Plugin lifecycle is locked during receipt commit.");
          }
          const changed = Reflect.set(target, property, next, target);
          if (changed && property === PLUGIN_ID && previous !== next) {
            pluginLifecycleDriftDetected = true;
          }
          return changed;
        },
        deleteProperty(target, property) {
          const existed = Reflect.has(target, property);
          if (receiptCommitCriticalSectionActive && existed && property === PLUGIN_ID) {
            throw new Error("Plugin lifecycle is locked during receipt commit.");
          }
          const changed = Reflect.deleteProperty(target, property);
          if (changed && existed && property === PLUGIN_ID) {
            pluginLifecycleDriftDetected = true;
          }
          return changed;
        },
        defineProperty(target, property, descriptor) {
          if (receiptCommitCriticalSectionActive && property === PLUGIN_ID) {
            throw new Error("Plugin lifecycle is locked during receipt commit.");
          }
          const previous = Reflect.getOwnPropertyDescriptor(target, property);
          const nextDescriptor = "value" in descriptor
            ? { ...descriptor, value: unwrap(descriptor.value) }
            : descriptor;
          const changed = Reflect.defineProperty(target, property, nextDescriptor);
          const current = Reflect.getOwnPropertyDescriptor(target, property);
          if (changed && property === PLUGIN_ID
            && (
              previous?.value !== current?.value
              || previous?.get !== current?.get
              || previous?.set !== current?.set
              || previous?.writable !== current?.writable
              || previous?.enumerable !== current?.enumerable
              || previous?.configurable !== current?.configurable
            )) {
            pluginLifecycleDriftDetected = true;
          }
          return changed;
        },
      });
      rawToProxy.set(rawRegistry, proxy);
      proxyToRaw.set(proxy, rawRegistry);
      return proxy;
    };

    const guardedGetter = () => wrapRegistry(currentRawRegistry);
    const guardedSetter = (value) => {
      const next = unwrap(value);
      if (receiptCommitCriticalSectionActive && next !== currentRawRegistry) {
        throw new Error("Plugin lifecycle is locked during receipt commit.");
      }
      if (next !== currentRawRegistry) pluginLifecycleDriftDetected = true;
      currentRawRegistry = next;
    };
    try {
      Object.defineProperty(pluginManager, "plugins", {
        configurable: true,
        enumerable: originalDescriptor.enumerable,
        get: guardedGetter,
        set: guardedSetter,
      });
    } catch {
      return false;
    }
    if (Object.getOwnPropertyDescriptor(pluginManager, "plugins")?.get !== guardedGetter) {
      return false;
    }
    uninstallPluginLifecycleGuard = () => {
      if (Object.getOwnPropertyDescriptor(pluginManager, "plugins")?.get !== guardedGetter) return;
      Object.defineProperty(pluginManager, "plugins", {
        ...originalDescriptor,
        value: currentRawRegistry,
      });
    };
    return true;
  };

  const installSettingsAdmissionGuard = (currentPlugin) => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(currentPlugin, "settings");
    if (!originalDescriptor
      || !("value" in originalDescriptor)
      || !originalDescriptor.configurable) {
      return false;
    }

    let currentRawSettings = originalDescriptor.value;
    const rawToProxy = new WeakMap();
    const proxyToRaw = new WeakMap();
    const unwrap = (value) => proxyToRaw.get(value) || value;
    const observeAttempt = () => {
      try {
        if (settingsFingerprint !== fingerprintSettings({ settings: currentRawSettings })) {
          settingsChangedDuringRun = true;
        }
      } catch {
        settingsChangedDuringRun = true;
      }
    };
    const isProxyable = (value) => {
      if (!value || typeof value !== "object") return false;
      const prototype = Object.getPrototypeOf(value);
      return Array.isArray(value)
        || prototype === null
        || Object.getPrototypeOf(prototype) === null;
    };
    const wrapSettings = (rawValue) => {
      if (!isProxyable(rawValue)) return rawValue;
      const existing = rawToProxy.get(rawValue);
      if (existing) return existing;
      const proxy = new Proxy(rawValue, {
        get(target, property, receiver) {
          return wrapSettings(Reflect.get(target, property, receiver));
        },
        set(target, property, value) {
          const next = unwrap(value);
          if (receiptCommitCriticalSectionActive
            && Reflect.get(target, property, target) !== next) {
            throw new Error("Retrieval settings are locked during receipt commit.");
          }
          const changed = Reflect.set(target, property, next, target);
          observeAttempt();
          return changed;
        },
        deleteProperty(target, property) {
          if (receiptCommitCriticalSectionActive && Reflect.has(target, property)) {
            throw new Error("Retrieval settings are locked during receipt commit.");
          }
          const changed = Reflect.deleteProperty(target, property);
          observeAttempt();
          return changed;
        },
        defineProperty(target, property, descriptor) {
          if (receiptCommitCriticalSectionActive) {
            throw new Error("Retrieval settings are locked during receipt commit.");
          }
          const nextDescriptor = "value" in descriptor
            ? { ...descriptor, value: unwrap(descriptor.value) }
            : descriptor;
          const changed = Reflect.defineProperty(target, property, nextDescriptor);
          observeAttempt();
          return changed;
        },
      });
      rawToProxy.set(rawValue, proxy);
      proxyToRaw.set(proxy, rawValue);
      return proxy;
    };

    const guardedGetter = () => wrapSettings(currentRawSettings);
    const guardedSetter = (value) => {
      const next = unwrap(value);
      if (receiptCommitCriticalSectionActive && next !== currentRawSettings) {
        throw new Error("Retrieval settings are locked during receipt commit.");
      }
      currentRawSettings = next;
      observeAttempt();
    };
    try {
      Object.defineProperty(currentPlugin, "settings", {
        configurable: true,
        enumerable: originalDescriptor.enumerable,
        get: guardedGetter,
        set: guardedSetter,
      });
    } catch {
      return false;
    }
    if (Object.getOwnPropertyDescriptor(currentPlugin, "settings")?.get !== guardedGetter) {
      return false;
    }
    uninstallSettingsAdmissionGuard = () => {
      if (Object.getOwnPropertyDescriptor(currentPlugin, "settings")?.get !== guardedGetter) return;
      Object.defineProperty(currentPlugin, "settings", {
        ...originalDescriptor,
        value: currentRawSettings,
      });
    };
    return true;
  };

  const teardownIntegrityGuards = () => {
    try {
      uninstallDiagnosticsSettingsGuard?.();
    } catch (error) {
      console.warn("[retrieval-smoke] diagnostics settings guard teardown failed", error);
    }
    uninstallDiagnosticsSettingsGuard = null;
    try {
      uninstallSettingsAdmissionGuard?.();
    } catch (error) {
      console.warn("[retrieval-smoke] settings admission guard teardown failed", error);
    }
    uninstallSettingsAdmissionGuard = null;
    try {
      uninstallPluginLifecycleGuard?.();
    } catch (error) {
      console.warn("[retrieval-smoke] plugin lifecycle guard teardown failed", error);
    }
    uninstallPluginLifecycleGuard = null;
  };

  const teardownRunnerIntegrity = () => {
    try {
      unsubscribeSettings?.();
    } catch (error) {
      console.warn("[retrieval-smoke] settings listener teardown failed", error);
    }
    unsubscribeSettings = null;
    teardownIntegrityGuards();
  };

  const asUint8Array = (value) => {
    if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new Error("Binary artifact must be an ArrayBuffer or typed-array view.");
  };

  const digestBytes = async (value) => {
    const bytes = asUint8Array(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  const digest = async (value) => digestBytes(new TextEncoder().encode(value));

  const readBinaryBytes = async (path) => {
    if (typeof app.vault.adapter.readBinary !== "function") {
      throw new Error("Binary artifact reads are unavailable.");
    }
    return asUint8Array(await app.vault.adapter.readBinary(path));
  };

  const parseStrictUtf8Json = (bytes) => {
    if (bytes.length === 0
      || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
      throw new Error("JSON artifact must be non-empty UTF-8 without a byte-order mark.");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  };

  const readAndHash = async (path) => digest(await app.vault.adapter.read(path));

  const safeIdentityVersion = (value) => (
    typeof value === "string"
    && /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u.test(value)
  );

  const shellVersionFromUserAgent = (userAgent) => (
    userAgent.match(/(?:^|[\s;(])obsidian\/([0-9A-Za-z][0-9A-Za-z._+-]*)/iu)?.[1] ?? null
  );

  const hasIndependentPlainObsidianToken = (userAgent) => (
    /(?:^|[\s;(])obsidian(?:$|[\s;)])/iu.test(userAgent)
  );

  const hasCapacitorLocalhostOrigin = (locationHref) => (
    typeof locationHref === "string"
    && /^capacitor:\/\/localhost(?:[/:?#]|$)/iu.test(locationHref)
  );

  const captureCurrentRuntimeIdentity = async () => {
    const currentPlugin = app.plugins.plugins[PLUGIN_ID];
    const userAgent = typeof navigator?.userAgent === "string" ? navigator.userAgent : "unknown";
    const isIosDevice = /(?:iPhone|iPad|iPod)|(?:Macintosh.*Mobile)/u.test(userAgent);
    const runtimeFamily = isIosDevice && /AppleWebKit/u.test(userAgent) && !/Electron/u.test(userAgent)
      ? "ios-wkwebview"
      : /Electron/u.test(userAgent) ? "electron-renderer" : "other-web-runtime";
    const formalIdentity = typeof currentPlugin?.getObsidianRuntimeIdentity === "function"
      ? currentPlugin.getObsidianRuntimeIdentity()
      : null;
    const loadedAppVersion = formalIdentity?.loadedAppVersion;
    const loadedAppVersionSource = formalIdentity?.loadedAppVersionSource;
    const shellVersion = shellVersionFromUserAgent(userAgent);
    const shellVersionSource = shellVersion
      ? "navigator.userAgent:obsidian/x"
      : null;
    const pluginVersion = currentPlugin?.manifest?.version;
    const browserPlatform = typeof navigator?.platform === "string"
      ? navigator.platform
      : null;
    const maxTouchPoints = Number.isInteger(navigator?.maxTouchPoints)
      ? navigator.maxTouchPoints
      : null;
    const hasDocument = typeof document !== "undefined";
    const locationHref = typeof globalThis.location?.href === "string"
      ? globalThis.location.href
      : null;
    const runtimeVersions = typeof process !== "undefined" && process?.versions
      ? {
        electron: process.versions.electron || null,
        chrome: process.versions.chrome || null,
        node: process.versions.node || null,
      }
      : { electron: null, chrome: null, node: null };
    const runtimeProcess = typeof process !== "undefined"
      ? {
        type: process.type || null,
        platform: process.platform || null,
        arch: process.arch || null,
      }
      : { type: null, platform: null, arch: null };
    const hasIphoneOrIpodUa = /(?:iPhone|iPod)/u.test(userAgent);
    const hasIpadUa = /iPad/u.test(userAgent);
    const hasMacintoshMobileUa = /Macintosh/u.test(userAgent) && /Mobile/u.test(userAgent);
    const platformMatches = hasIphoneOrIpodUa
      ? /^(?:iPhone|iPod)/u.test(browserPlatform ?? "")
      : hasIpadUa
        ? /^(?:iPad|MacIntel)$/u.test(browserPlatform ?? "")
        : hasMacintoshMobileUa && browserPlatform === "MacIntel";
    const strongIosBrowserIdentity = runtimeFamily === "ios-wkwebview"
      && /AppleWebKit\//u.test(userAgent)
      && !/Electron/iu.test(userAgent)
      && runtimeVersions.electron === null
      && runtimeVersions.chrome === null
      && runtimeVersions.node === null
      && runtimeProcess.type === null
      && runtimeProcess.platform === null
      && runtimeProcess.arch === null
      && platformMatches
      && Number.isInteger(maxTouchPoints)
      && maxTouchPoints >= 2
      && hasDocument
      && hasCapacitorLocalhostOrigin(locationHref);
    const shellIdentityComplete = safeIdentityVersion(shellVersion)
      || (
        shellVersion === null
        && hasIndependentPlainObsidianToken(userAgent)
        && strongIosBrowserIdentity
      );
    const runtimeIdentityComplete = safeIdentityVersion(loadedAppVersion)
      && loadedAppVersionSource === "obsidian.apiVersion"
      && shellIdentityComplete
      && safeIdentityVersion(pluginVersion)
      && ["electron-renderer", "ios-wkwebview"].includes(runtimeFamily)
      && (runtimeFamily !== "electron-renderer" || safeIdentityVersion(runtimeVersions.electron))
      && (runtimeFamily !== "ios-wkwebview" || strongIosBrowserIdentity);
    if (!runtimeIdentityComplete) {
      throw new Error("Exact Obsidian app, shell, runtime, or plugin identity is unavailable.");
    }
    const identityPayload = {
      loadedAppVersion,
      loadedAppVersionSource,
      shellVersion,
      shellVersionSource,
      pluginVersion,
      userAgent,
      browserPlatform,
      maxTouchPoints,
      hasDocument,
      locationHref,
      runtimeFamily,
      runtimeVersions,
      runtimeProcess,
    };
    return {
      appVersion: loadedAppVersion,
      appVersionSource: loadedAppVersionSource,
      loadedAppVersion,
      loadedAppVersionSource,
      shellVersion,
      shellVersionSource,
      pluginVersion,
      platform: userAgent,
      platformClass: isIosDevice ? "ios-real-device" : "desktop-or-other",
      runtimeFamily,
      runtimeVersions,
      runtimeProcess,
      appBuildIdentitySha256: await digest(JSON.stringify(identityPayload)),
    };
  };

  const pluginArtifactPath = () => (
    `${app.vault.configDir || ".obsidian"}/plugins/${PLUGIN_ID}/main.js`
  );

  const isSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const isCanonicalIsoTimestamp = (value) => (
    typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
  );

  const captureCurrentArtifactIdentity = async () => {
    const currentPlugin = app.plugins.plugins[PLUGIN_ID];
    if (!currentPlugin) {
      throw new Error("The currently loaded plugin instance is unavailable.");
    }
    if (initialLoadedPluginInstance && currentPlugin !== initialLoadedPluginInstance) {
      pluginLifecycleDriftDetected = true;
    }
    const runnerSha256 = await readAndHash(RUNNER_PATH);
    const pluginArtifactSha256 = await readAndHash(pluginArtifactPath());
    if (typeof currentPlugin.getLoadedPluginBuildIdentity !== "function") {
      throw new Error("Loaded plugin build identity seam is unavailable.");
    }
    const loadedBuild = await currentPlugin.getLoadedPluginBuildIdentity();
    if (app.plugins.plugins[PLUGIN_ID] !== currentPlugin) {
      pluginLifecycleDriftDetected = true;
      throw new Error("The loaded plugin instance changed while its identity was captured.");
    }
    const loadedBuildShapeValid = loadedBuild
      && typeof loadedBuild === "object"
      && !Array.isArray(loadedBuild)
      && loadedBuild.schemaVersion === 1
      && loadedBuild.pluginId === PLUGIN_ID
      && loadedBuild.pluginVersion === currentPlugin.manifest?.version
      && loadedBuild.pluginArtifactPath === pluginArtifactPath()
      && isSha256(loadedBuild.loadedPluginArtifactSha256)
      && typeof loadedBuild.lexicalProfileRuntimeFingerprint === "string"
      && loadedBuild.lexicalProfileRuntimeFingerprint.length > 0
      && isCanonicalIsoTimestamp(loadedBuild.capturedAtPluginLoad)
      && loadedBuild.identitySource === "plugin-onload-cached-main-js"
      && loadedBuild.blocker === null;
    if (!loadedBuildShapeValid) {
      throw new Error("Loaded plugin build identity is invalid or blocked.");
    }
    if (loadedBuild.loadedPluginArtifactSha256 !== pluginArtifactSha256) {
      identityDriftDetected = true;
      throw new Error("Loaded plugin artifact does not match the current vault artifact.");
    }
    if (initialLoadedPluginInstance && currentPlugin !== initialLoadedPluginInstance) {
      pluginLifecycleDriftDetected = true;
      throw new Error("The loaded plugin instance changed after smoke initialization.");
    }
    const loadedPluginBuildIdentitySha256 = await digest(JSON.stringify({
      schemaVersion: loadedBuild.schemaVersion,
      pluginId: loadedBuild.pluginId,
      pluginVersion: loadedBuild.pluginVersion,
      pluginArtifactPath: loadedBuild.pluginArtifactPath,
      loadedPluginArtifactSha256: loadedBuild.loadedPluginArtifactSha256,
      lexicalProfileRuntimeFingerprint: loadedBuild.lexicalProfileRuntimeFingerprint,
      capturedAtPluginLoad: loadedBuild.capturedAtPluginLoad,
      identitySource: loadedBuild.identitySource,
      blocker: loadedBuild.blocker,
    }));
    return {
      runnerSha256,
      pluginArtifactSha256,
      loadedPluginArtifactSha256: loadedBuild.loadedPluginArtifactSha256,
      loadedPluginBuildIdentitySha256,
    };
  };

  const runtimeAndArtifactIdentityAreStable = async () => {
    let stable = false;
    try {
      const currentRuntimeIdentity = await captureCurrentRuntimeIdentity();
      const currentArtifactIdentity = await captureCurrentArtifactIdentity();
      const runtimeStable = Object.entries(currentRuntimeIdentity).every(([key, value]) => (
        JSON.stringify(result.runtime[key]) === JSON.stringify(value)
      ));
      const artifactsStable = currentArtifactIdentity.runnerSha256 === result.identity.runnerSha256
        && currentArtifactIdentity.pluginArtifactSha256 === result.identity.pluginArtifactSha256
        && currentArtifactIdentity.loadedPluginArtifactSha256
          === result.identity.loadedPluginArtifactSha256
        && currentArtifactIdentity.loadedPluginBuildIdentitySha256
          === result.identity.loadedPluginBuildIdentitySha256;
      stable = pluginLifecycleGuardInstalled
        && observePluginLifecycle()
        && !identityDriftDetected
        && runtimeStable
        && artifactsStable;
    } catch {
      // Missing identity is evidence uncertainty and therefore remains blocked.
    }
    if (!stable) identityDriftDetected = true;
    return stable;
  };

  const verifyRuntimeAndArtifactIdentityAtFinalize = async () => {
    const stable = await runtimeAndArtifactIdentityAreStable();
    record(
      "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
      stable ? "PASS" : "BLOCKED",
      stable ? "" : "one or more exact runtime identity bindings are missing or changed",
    );
    return stable;
  };

  const snapshotResult = () => JSON.parse(JSON.stringify(result));

  const writeResult = () => {
    const payload = JSON.stringify(result, null, 2);
    const operation = writeQueue.then(() => app.vault.adapter.write(RESULT_PATH, payload));
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  const writeResultAtCommit = (beforeWrite) => {
    const operation = writeQueue.then(() => {
      beforeWrite();
      const payload = JSON.stringify(result, null, 2);
      return app.vault.adapter.write(RESULT_PATH, payload);
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  const checklist = Object.freeze({
    lexical: {
      prompt: "分别以“只从我的笔记中”检索：量子灯塔检索、延迟恢复矩阵、召回链路守护、ERR_RETRIEVAL_LANTERN_7401、日本語検索エンジン。",
      expect: "标题、heading、中文正文、英文错误码和混合日文均可从最终来源打开；裸错误码/日文短语仅属于不计分 Chat 路由观察；技术状态显示 lexical ready 或诚实的 vector-only reason。",
    },
    "chat-recovery": {
      prompt: RECOVERY_PROMPT,
      expect: `Runner 初始化后的第一次检索；standard 可为 valid-none，或只保留冻结 insufficient 子集的 strict-partial；随后恰好一次隐藏 relaxed retry。最终来源必须含 ${RECOVERY_TARGET_FIXTURE}，且没有非冻结、opaque、重复来源或第二次恢复。完成且 Chat 已停止 streaming 后立即无参调用 recordRecoveryCase；runner 只绑定 live canonical Selected Memory/source records/assistant allowlist 与 pre-freeze diagnostics，不读取 DOM 或可见引用子集。`,
    },
    "temporal-retry": {
      prompt: TEMPORAL_RETRY_PROMPT,
      expect: `先记录 pre-freeze Chat recovery，再 freeze reviewed plan；随后在 performance envelope 前的 qualitative staging session 运行。A1 必须是 valid-none/strict-partial，恰好一次 A2 与一次 cumulative projection。三个 terminal（A1/A2 Memory + projection）都必须报告 temporalFilterApplied=1、temporalViolationCount=0；最终来源必须含 ${TEMPORAL_RETRY_TARGET_FIXTURE} 且不含 ${TEMPORAL_RETRY_FORBIDDEN_FIXTURE}。保持该 live completed Chat turn 打开，然后无参调用 recordTemporalRetryCase()；runner 只绑定 canonical ordered Selected Memory/source records/assistant allowlist。`,
    },
    "graph-depth": {
      prompt: "只从我的笔记中询问青铜罗盘为什么出现资源峰值；随后以相同来源限定询问蓝色账本重复入账的共同原因。",
      expect: "可分别返回 2-hop 深层结论与 two-seed 汇合结论；单边弱线索不应替代有来源支持的结论。",
    },
    "opaque-boundary": {
      prompt: "只从我的笔记中回答：青铜罗盘为什么出现资源峰值？",
      expect: "最终只显示允许的深层来源；Chat、source chips、技术日志与保存结果均不得出现 opaque bridge 身份或正文。两个连续排除节点后的目标不得出现。",
    },
    "pagelet-0": {
      prompt: "打开 Pagelet 零洞察入口并运行 Deep Discover。",
      expect: "合法安静结束，无缓存、delivery candidate 或 receipt 写入；完成后立即无参调用 recordPageletCase，runner 只绑定真实 controller 快照。",
    },
    "pagelet-1": {
      prompt: "打开 Pagelet 单洞察入口并运行 Deep Discover。",
      expect: `只产生一个洞察，完整来源必须包含 anchor 与 ${PAGELET_SINGLE_SOURCE_FIXTURE}；完成后立即无参调用 recordPageletCase。`,
    },
    "pagelet-2": {
      prompt: "打开 Pagelet 双洞察入口并运行 Deep Discover。",
      expect: `恰好两个独立洞察，共享 anchor 并分别绑定 ${PAGELET_DOUBLE_SOURCE_A_FIXTURE} 与 ${PAGELET_DOUBLE_SOURCE_B_FIXTURE}；完成后立即无参调用 recordPageletCase。`,
    },
    temporal: {
      prompt: "Chat 显式限定 2026 年检索时间边界信号；再对 Pagelet 双洞察入口运行无显式时间范围的 Deep Discover。",
      expect: "Chat 恢复不越过 2026 范围；无显式范围的 Pagelet 可以使用旧笔记，但必须显示 current 来源。",
    },
  });

  const rankingChecklist = Object.freeze(Object.fromEntries(
    Object.entries(RANKING_CASES).map(([id, value]) => [id, Object.freeze({
      prompt: value.prompt,
      record: `After freezing the reviewed measurement plan and before starting its performance envelope, keep the exact completed Chat turn with one successful search_memory result open, then await paRetrievalSmoke.recordRankingCase(${JSON.stringify(id)}); the runner binds its canonical ordered Selected Memory sources and leaves any unmatched turn PENDING/BLOCKED`,
    })]),
  ));
  const routingChecklist = Object.freeze(Object.fromEntries(
    Object.entries(ROUTING_OBSERVATIONS).map(([id, prompt]) => [id, Object.freeze({
      prompt,
      expect: "Observe whether Chat autonomously selects Memory; this does not enter Recall@8, MRR, manual PASS/FAIL, or the rollout aggregate.",
    })]),
  ));

  const normalizeRankedPath = (value) => {
    let path = String(value ?? "").trim().replaceAll("\\", "/");
    try {
      path = decodeURIComponent(path);
    } catch {
      return null;
    }
    path = path.split(/[?#]/u, 1)[0]
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "")
      .replace(/\/{2,}/gu, "/");
    if (!path || /^[a-z][a-z0-9+.-]*:/iu.test(path)) return null;
    const segments = path.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
    return path;
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const canonicalJson = (value) => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  };

  const hasExactKeys = (value, expectedKeys) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...expectedKeys].sort());
  };

  const expandPerformanceWorkloadContract = (workload) => {
    if (!hasExactKeys(workload, [
      "schemaVersion", "conversationPolicy", "fixtureCase", "prompts", "qualification", "stages",
    ])
      || workload.schemaVersion !== PERFORMANCE_WORKLOAD_SCHEMA_VERSION
      || workload.conversationPolicy !== PERFORMANCE_WORKLOAD_CONVERSATION_POLICY) {
      throw new Error("Performance workload contract is invalid.");
    }
    const fixtureCase = workload.fixtureCase;
    const direct = fixtureCase?.wave1Direct;
    if (!hasExactKeys(fixtureCase, [
      "id", "wave1Direct", "wave1GraphHubPath", "wave2FreshDirectPaths",
      "wave2GraphHubPath", "requiredDisconnectedWaves",
    ])
      || fixtureCase.id !== "perf-full-graph-two-wave-v1"
      || !hasExactKeys(direct, ["pathPrefix", "from", "to", "pad"])
      || direct.pathPrefix !== "retrieval-smoke/performance/200-wave1-direct-"
      || direct.from !== 1
      || direct.to !== 12
      || direct.pad !== 2
      || fixtureCase.wave1GraphHubPath !== PERFORMANCE_WAVE1_GRAPH_HUB_PATH
      || JSON.stringify(fixtureCase.wave2FreshDirectPaths)
        !== JSON.stringify(PERFORMANCE_WAVE2_FRESH_DIRECT_PATHS)
      || fixtureCase.wave2GraphHubPath !== PERFORMANCE_WAVE2_GRAPH_HUB_PATH
      || fixtureCase.requiredDisconnectedWaves !== true) {
      throw new Error("Performance fixture contract is invalid.");
    }
    if (!hasExactKeys(workload.prompts, Object.keys(PERFORMANCE_PROMPT_SHAPES))) {
      throw new Error("Performance prompt contract is invalid.");
    }
    for (const [id, expectedShape] of Object.entries(PERFORMANCE_PROMPT_SHAPES)) {
      const prompt = workload.prompts[id];
      if (!hasExactKeys(prompt, ["text", "expectedShape"])
        || typeof prompt.text !== "string"
        || prompt.text !== PERFORMANCE_PROMPT_TEXTS[id]
        || prompt.expectedShape !== expectedShape) {
        throw new Error("Performance prompt contract is invalid.");
      }
    }
    if (!hasExactKeys(workload.qualification, ["requiredBeforeEnvelope"])
      || JSON.stringify(workload.qualification.requiredBeforeEnvelope)
        !== JSON.stringify(PERFORMANCE_QUALIFICATION_IDS)) {
      throw new Error("Performance qualification contract is invalid.");
    }
    if (!hasExactKeys(workload.stages, Object.keys(PERFORMANCE_STAGE_COUNTS))) {
      throw new Error("Performance stage contract is invalid.");
    }
    if (canonicalJson(workload.stages) !== canonicalJson(PERFORMANCE_STAGE_SEGMENTS)) {
      throw new Error("Performance stage sequence contract is invalid.");
    }
    const classByStage = {
      standardPerformance: new Set(["warmup", "measured"]),
      retryPerformanceBatch1: new Set(["warmup", "measured"]),
      retryPerformanceBatch2: new Set(["measured"]),
      cancellationProbe: new Set(["probe"]),
    };
    const sequence = [];
    const ids = new Set();
    for (const stage of Object.keys(PERFORMANCE_STAGE_COUNTS)) {
      const segments = workload.stages[stage];
      if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error("Performance stage segments are invalid.");
      }
      for (const segment of segments) {
        const single = Object.hasOwn(segment ?? {}, "id");
        if (!hasExactKeys(segment, single
          ? ["id", "sampleClass", "promptId"]
          : ["idPrefix", "from", "to", "pad", "sampleClass", "promptId"])
          || !classByStage[stage].has(segment.sampleClass)
          || segment.promptId !== PERFORMANCE_STAGE_PROMPTS[stage]) {
          throw new Error("Performance stage segment shape is invalid.");
        }
        const segmentIds = single
          ? [segment.id]
          : Number.isSafeInteger(segment.from)
            && Number.isSafeInteger(segment.to)
            && Number.isSafeInteger(segment.pad)
            && segment.from > 0
            && segment.to >= segment.from
            && segment.pad > 0
            && typeof segment.idPrefix === "string"
            && segment.idPrefix.length > 0
            ? Array.from({ length: segment.to - segment.from + 1 }, (_, offset) => (
              `${segment.idPrefix}${String(segment.from + offset).padStart(segment.pad, "0")}`
            ))
            : null;
        if (!segmentIds || segmentIds.some((id) => (
          typeof id !== "string"
          || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id)
          || ids.has(id)
        ))) {
          throw new Error("Performance workload episode ids are invalid or duplicated.");
        }
        for (const id of segmentIds) {
          ids.add(id);
          sequence.push({ id, stage, sampleClass: segment.sampleClass, promptId: segment.promptId });
        }
      }
      if (sequence.filter((entry) => entry.stage === stage).length
        !== PERFORMANCE_STAGE_COUNTS[stage]) {
        throw new Error("Performance workload stage count is invalid.");
      }
    }
    if (sequence.length !== 47 || ids.size !== sequence.length) {
      throw new Error("Performance workload sequence count is invalid.");
    }
    return { workload: clone(workload), sequence };
  };

  const projectPerformanceWorkloadContractForReceipt = (workload) => ({
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
    prompts: Object.keys(PERFORMANCE_PROMPT_SHAPES).sort().map((id) => ({
      id,
      expectedShape: workload.prompts[id].expectedShape,
    })),
    qualificationIds: [...workload.qualification.requiredBeforeEnvelope],
    stages: Object.fromEntries(Object.keys(PERFORMANCE_STAGE_COUNTS).map((stage) => [
      stage,
      {
        expectedCount: PERFORMANCE_STAGE_COUNTS[stage],
        promptId: PERFORMANCE_STAGE_PROMPTS[stage],
        sampleClasses: [...new Set(
          workload.stages[stage].map((segment) => segment.sampleClass),
        )],
      },
    ])),
  });

  const projectDevicePlanForReceipt = (plan) => ({
    ...clone(plan),
    performanceWorkload: projectPerformanceWorkloadContractForReceipt(
      plan.performanceWorkload,
    ),
  });

  const refreshPerformanceWorkloadBinding = async () => {
    const binding = result.deviceMeasurement.workloadBinding;
    if (!performanceWorkloadContract) return binding;
    binding.contractSha256 = await digest(canonicalJson(
      projectPerformanceWorkloadContractForReceipt(performanceWorkloadContract),
    ));
    binding.sequenceSha256 = await digest(canonicalJson(performanceWorkloadSequence));
    binding.expectedEpisodeCount = performanceWorkloadSequence.length;
    binding.boundEpisodeCount = binding.episodes.length;
    binding.qualification.boundCount = binding.qualification.entries.length;
    binding.qualification.bindingSha256 = await digest(canonicalJson(
      binding.qualification.entries,
    ));
    binding.qualification.status = binding.qualification.violationCount > 0
      ? "INVALID"
      : binding.qualification.boundCount === binding.qualification.requiredCount
        ? "PASS"
        : "PENDING";
    for (const [stage, expectedCount] of Object.entries(PERFORMANCE_STAGE_COUNTS)) {
      const summary = binding.stages[stage];
      summary.expectedCount = expectedCount;
      summary.boundCount = binding.episodes.filter((entry) => entry.stage === stage).length;
      summary.status = summary.violationCount > 0 || summary.boundCount > expectedCount
        ? "INVALID"
        : summary.boundCount === expectedCount ? "PASS" : "PENDING";
    }
    const episodeBindingSha256 = await digest(canonicalJson(binding.episodes));
    binding.bindingSha256 = await digest(canonicalJson({
      qualificationBindingSha256: binding.qualification.bindingSha256,
      episodeBindingSha256,
    }));
    const allStagesPass = Object.values(binding.stages).every((summary) => (
      summary.status === "PASS"
      && summary.boundCount === summary.expectedCount
      && summary.violationCount === 0
    ));
    binding.status = binding.violationCount > 0
      || binding.qualification.status === "INVALID"
      || Object.values(binding.stages).some((summary) => summary.status === "INVALID")
      ? "INVALID"
      : binding.qualification.status === "PASS"
        && allStagesPass
        && binding.boundEpisodeCount === binding.expectedEpisodeCount
        ? "PASS"
        : "PENDING";
    return binding;
  };

  const invalidatePerformanceWorkload = async ({ stage = null, qualification = false } = {}) => {
    const binding = result.deviceMeasurement.workloadBinding;
    binding.violationCount += 1;
    if (qualification) binding.qualification.violationCount += 1;
    if (stage && binding.stages[stage]) binding.stages[stage].violationCount += 1;
    await refreshPerformanceWorkloadBinding();
    await writeResult();
  };

  const enqueuePerformanceEvidenceOperation = (operation) => {
    const queued = performanceEvidenceOperationQueue.then(operation, operation);
    performanceEvidenceOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const enqueuePerformanceTransitionOperation = (operation) => {
    const run = async () => {
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      return operation();
    };
    const queued = performanceTransitionOperationQueue.then(run, run);
    performanceTransitionOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const nextPerformanceWorkloadValue = () => {
    if (!performanceWorkloadContract
      || result.deviceMeasurement.workloadBinding.status === "INVALID") return null;
    const index = result.deviceMeasurement.workloadBinding.boundEpisodeCount;
    const next = performanceWorkloadSequence[index];
    if (!next) return null;
    const prompt = performanceWorkloadContract.prompts[next.promptId];
    return clone({
      id: next.id,
      stage: next.stage,
      sampleClass: next.sampleClass,
      promptId: next.promptId,
      prompt: prompt.text,
      expectedShape: prompt.expectedShape,
      sequence: index + 1,
      count: performanceWorkloadSequence.length,
    });
  };

  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  };

  const nearestRankPercentile = (samples, percentile) => {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    const sorted = [...samples].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
    return sorted[index];
  };

  const normalizeDevicePlan = (template, overrides = {}) => {
    if (!template || typeof template !== "object") throw new Error("Device measurement plan is unavailable.");
    const unknownOverride = Object.keys(overrides).find((key) => ![
      "version", "thresholds", "rerankerGate", "externalDeviceIdentitySha256",
    ].includes(key));
    if (unknownOverride) throw new Error(`Unsupported device measurement plan override: ${unknownOverride}`);
    if (overrides.version !== undefined && overrides.version !== template.version) {
      throw new Error("Device measurement plan version cannot be changed.");
    }
    const thresholdOverrides = overrides.thresholds || {};
    const requiredMetrics = (template.requiredMetrics || []).map((metric) => ({
      ...metric,
      threshold: {
        ...metric.threshold,
        ...(thresholdOverrides[metric.id] || {}),
      },
    }));
    const optionalMetrics = (template.optionalMetrics || []).map((metric) => ({
      ...metric,
      threshold: {
        ...metric.threshold,
        ...(thresholdOverrides[metric.id] || {}),
      },
    }));
    const knownMetricIds = new Set([...requiredMetrics, ...optionalMetrics].map((metric) => metric.id));
    const unknownThreshold = Object.keys(thresholdOverrides).find((id) => !knownMetricIds.has(id));
    if (unknownThreshold) throw new Error(`Unknown device measurement threshold: ${unknownThreshold}`);
    const rerankerGateOverrides = overrides.rerankerGate || {};
    const unknownRerankerGate = Object.keys(rerankerGateOverrides).find((key) => (
      !["minimumMrr", "flagOffBaselineMrr", "maximumMrrRegression"].includes(key)
    ));
    if (unknownRerankerGate) throw new Error(`Unknown reranker measurement gate: ${unknownRerankerGate}`);
    const plan = {
      version: template.version,
      percentileMethod: template.percentileMethod,
      warmupSamples: template.warmupSamples,
      sampleCount: template.sampleCount,
      diagnosticsEvidence: clone(template.diagnosticsEvidence || {}),
      performanceWorkload: clone(template.performanceWorkload || {}),
      externalMemoryEvidence: {
        ...clone(template.externalMemoryEvidence || {}),
        deviceIdentitySha256: overrides.externalDeviceIdentitySha256
          ?? template.externalMemoryEvidence?.deviceIdentitySha256
          ?? null,
      },
      requiredMetrics,
      optionalMetrics,
      rerankerGate: {
        ...template.rerankerGate,
        ...rerankerGateOverrides,
      },
    };
    if (plan.percentileMethod !== "nearest-rank") throw new Error("Unsupported device percentile method.");
    if (!Number.isInteger(plan.warmupSamples) || plan.warmupSamples < 0
      || !Number.isInteger(plan.sampleCount) || plan.sampleCount < 1) {
      throw new Error("Device measurement sample counts are invalid.");
    }
    if (plan.diagnosticsEvidence.schemaVersion !== RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION
      || plan.diagnosticsEvidence.sessionIsolation
        !== "standard-performance-then-two-retry-batches-then-cancellation-probe"
      || plan.diagnosticsEvidence.standardPerformanceEpisodeCount
        !== plan.warmupSamples + plan.sampleCount
      || plan.diagnosticsEvidence.retryPerformanceEpisodeCount
        !== plan.warmupSamples + plan.sampleCount
      || JSON.stringify(plan.diagnosticsEvidence.retryPerformanceBatchEpisodeCounts)
        !== JSON.stringify([12, 11])
      || plan.diagnosticsEvidence.retryPerformanceBatchEpisodeCounts.reduce(
        (sum, count) => sum + count,
        0,
      ) !== plan.diagnosticsEvidence.retryPerformanceEpisodeCount
      || plan.diagnosticsEvidence.cancellationProbeEpisodeCount !== 1
      || plan.diagnosticsEvidence.maximumMemorySearchAttemptsPerEpisode !== 2
      || plan.diagnosticsEvidence.requiredSessionCapacity !== MIN_DIAGNOSTICS_SESSION_CAPACITY
      || plan.diagnosticsEvidence.performanceSurface !== "chat") {
      throw new Error("Device diagnostics evidence classification is invalid.");
    }
    expandPerformanceWorkloadContract(plan.performanceWorkload);
    if (plan.externalMemoryEvidence.requiredPlatformClass !== "ios-real-device"
      || plan.externalMemoryEvidence.requiredRuntimeFamily !== "ios-wkwebview"
      || plan.externalMemoryEvidence.counter !== "physical_footprint_bytes"
      || plan.externalMemoryEvidence.unit !== "bytes"
      || plan.externalMemoryEvidence.processName !== "Obsidian"
      || plan.externalMemoryEvidence.appBundleId !== "md.obsidian"
      || (plan.externalMemoryEvidence.deviceIdentitySha256 !== null
        && !/^[a-f0-9]{64}$/u.test(plan.externalMemoryEvidence.deviceIdentitySha256))) {
      throw new Error("External memory evidence contract is invalid.");
    }
    const ids = new Set();
    for (const metric of [...requiredMetrics, ...optionalMetrics]) {
      if (!metric?.id || ids.has(metric.id)) throw new Error("Device measurement metric ids are invalid.");
      ids.add(metric.id);
      if (!["series", "snapshot", "observed-series", "maximum-observed-series"].includes(metric.sampleMode)) {
        throw new Error(`Unsupported sample mode for ${metric.id}.`);
      }
      if (["observed-series", "maximum-observed-series"].includes(metric.sampleMode)
        && metric.minimumSamples !== undefined
        && (!Number.isInteger(metric.minimumSamples) || metric.minimumSamples < 2)) {
        throw new Error(`Observed-series minimum sample count is invalid for ${metric.id}.`);
      }
      for (const [key, value] of Object.entries(metric.threshold || {})) {
        if (!["p50Max", "p95Max", "p50Min", "p95Min", "minMin", "maxMax"].includes(key)
          || (value !== null && (!Number.isFinite(value) || value < 0))) {
          throw new Error(`Invalid threshold for ${metric.id}.`);
        }
      }
    }
    for (const value of Object.values(plan.rerankerGate)) {
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error("Invalid reranker measurement gate.");
      }
    }
    return plan;
  };

  const findDeviceMetric = (id) => {
    if (!frozenDevicePlan) return null;
    const required = frozenDevicePlan.requiredMetrics.find((metric) => metric.id === id);
    if (required) return { definition: required, required: true };
    const optional = frozenDevicePlan.optionalMetrics.find((metric) => metric.id === id);
    return optional ? { definition: optional, required: false } : null;
  };

  const DIAGNOSTICS_DERIVED_METRIC_IDS = new Set([
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
    "retrieval.acceptedCount",
  ]);
  const RUNTIME_SAMPLED_METRIC_IDS = new Set([
    "storage.peakEstimatedDbBytes",
    "memory.peakProcessFootprintBytes",
    "ui.maxEventLoopStallMs",
  ]);

  const evaluateThreshold = (definition, minimum, p50, p95, maximum) => {
    const thresholds = Object.entries(definition.threshold || {});
    if (thresholds.length === 0 || thresholds.some(([, value]) => value === null)) {
      return { status: "BLOCKED", reason: "threshold is pending" };
    }
    const values = {
      p50Max: p50,
      p95Max: p95,
      p50Min: p50,
      p95Min: p95,
      minMin: minimum,
      maxMax: maximum,
    };
    const failed = thresholds.some(([key, threshold]) => (
      key.endsWith("Max") ? values[key] > threshold : values[key] < threshold
    ));
    return failed
      ? { status: "FAIL", reason: "measured statistic is outside the frozen threshold" }
      : { status: "PASS", reason: "frozen threshold satisfied" };
  };

  const evaluateRerankerGate = () => {
    if (!frozenDevicePlan) return;
    const gate = frozenDevicePlan.rerankerGate;
    const minimumConfigured = gate.minimumMrr !== null;
    const baselineConfigured = gate.flagOffBaselineMrr !== null
      && gate.maximumMrrRegression !== null;
    let status = "BLOCKED";
    let reason = "reranker MRR threshold or flag-off baseline is pending";
    if (minimumConfigured || baselineConfigured) {
      const minimum = Math.max(
        minimumConfigured ? gate.minimumMrr : 0,
        baselineConfigured ? gate.flagOffBaselineMrr - gate.maximumMrrRegression : 0,
      );
      status = result.rerankerMetrics.completed < result.rerankerMetrics.required
        ? "BLOCKED"
        : result.rerankerMetrics.mrr >= minimum ? "PASS" : "FAIL";
      reason = status === "BLOCKED"
        ? "selected-reranker ranking cases are incomplete"
        : status === "PASS" ? "frozen reranker gate satisfied" : "reranker MRR regressed beyond the frozen gate";
    }
    result.deviceMeasurement.rerankerGate = {
      status,
      reason,
      minimumMrr: gate.minimumMrr,
      flagOffBaselineMrr: gate.flagOffBaselineMrr,
      maximumMrrRegression: gate.maximumMrrRegression,
    };
  };

  const freezeDeviceMeasurementPlan = async (overrides = {}) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireMeasurementSettingsStable();
    const candidate = normalizeDevicePlan(devicePlanTemplate, overrides);
    const canonical = JSON.stringify(candidate);
    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      if (frozenDevicePlan) {
        if (canonical !== frozenDevicePlanCanonical) {
          throw new Error("Device measurement plan is already frozen; threshold changes require a new run.");
        }
        return clone(result.deviceMeasurement);
      }
      const planSha256 = await digest(canonicalJson(
        projectDevicePlanForReceipt(candidate),
      ));
      frozenDevicePlan = deepFreeze(candidate);
      frozenDevicePlanCanonical = canonical;
      result.deviceMeasurement.planVersion = candidate.version;
      result.deviceMeasurement.planSha256 = planSha256;
      result.identity.deviceMeasurementPlanSha256 = planSha256;
      result.deviceMeasurement.planStatus = "FROZEN";
      result.deviceMeasurement.percentileMethod = candidate.percentileMethod;
      result.deviceMeasurement.warmupSamples = candidate.warmupSamples;
      result.deviceMeasurement.sampleCount = candidate.sampleCount;
      result.deviceMeasurement.performanceSurface = candidate.diagnosticsEvidence.performanceSurface;
      for (const metric of [...candidate.requiredMetrics, ...candidate.optionalMetrics]) {
        result.deviceMeasurement.metrics[metric.id] = {
          id: metric.id,
          unit: metric.unit,
          sampleMode: metric.sampleMode,
          collectionMethod: metric.collectionMethod || null,
          required: candidate.requiredMetrics.some((entry) => entry.id === metric.id),
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
          threshold: clone(metric.threshold),
          recordedAt: null,
        };
      }
      evaluateRerankerGate();
      await restartDiagnosticsForFrozenPlan();
      await writeResult();
      return clone(result.deviceMeasurement);
    });
  };

  const applyDeviceMetricEvidence = (id, evidence = {}, evidenceSource = "operator") => {
    const metric = findDeviceMetric(id);
    if (!metric) throw new Error(`Unknown device measurement metric: ${id}`);
    const method = evidence.method;
    if (!["measured", "estimated", "manual", "unsupported"].includes(method)) {
      throw new Error("Device metric method must be measured, estimated, manual, or unsupported.");
    }
    const rawSamples = Array.isArray(evidence.samples) ? [...evidence.samples] : [];
    const validSamples = rawSamples.every((sample) => Number.isFinite(sample) && sample >= 0);
    const expectedSamples = metric.definition.sampleMode === "series"
      ? frozenDevicePlan.warmupSamples + frozenDevicePlan.sampleCount
      : metric.definition.sampleMode === "snapshot" ? 1 : null;
    const minimumSamples = ["observed-series", "maximum-observed-series"].includes(
      metric.definition.sampleMode,
    )
      ? metric.definition.minimumSamples || 1
      : 1;
    let evaluatedSamples = metric.definition.sampleMode === "series"
      ? rawSamples.slice(frozenDevicePlan.warmupSamples)
      : [...rawSamples];
    if (!validSamples || method === "unsupported") evaluatedSamples = [];
    let status = "BLOCKED";
    let reason = method === "unsupported" ? "metric is unsupported on this runtime" : "samples are incomplete";
    if (method !== "unsupported" && validSamples && rawSamples.length > 0
      && rawSamples.length >= minimumSamples
      && (expectedSamples === null || rawSamples.length === expectedSamples)) {
      if (metric.definition.sampleMode === "observed-series" && evaluatedSamples.length === 0) {
        evaluatedSamples = [0];
      }
      const p50 = nearestRankPercentile(evaluatedSamples, 0.5);
      const p95 = nearestRankPercentile(evaluatedSamples, 0.95);
      const minimum = Math.min(...evaluatedSamples);
      const maximum = Math.max(...evaluatedSamples);
      ({ status, reason } = evaluateThreshold(metric.definition, minimum, p50, p95, maximum));
    }
    const p50 = evaluatedSamples.length > 0 ? nearestRankPercentile(evaluatedSamples, 0.5) : null;
    const p95 = evaluatedSamples.length > 0 ? nearestRankPercentile(evaluatedSamples, 0.95) : null;
    const minimum = evaluatedSamples.length > 0 ? Math.min(...evaluatedSamples) : null;
    const maximum = evaluatedSamples.length > 0 ? Math.max(...evaluatedSamples) : null;
    result.deviceMeasurement.metrics[id] = {
      ...result.deviceMeasurement.metrics[id],
      method,
      evidenceSource,
      status,
      reason,
      rawSamples: validSamples && method !== "unsupported" ? rawSamples : [],
      evaluatedSamples: validSamples && method !== "unsupported" ? evaluatedSamples : [],
      p50,
      p95,
      minimum,
      maximum,
      recordedAt: new Date().toISOString(),
    };
    return clone(result.deviceMeasurement.metrics[id]);
  };

  const recordDeviceMetric = async (id, evidence = {}) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording samples.");
    if (DIAGNOSTICS_DERIVED_METRIC_IDS.has(id)) {
      throw new Error(`Device metric ${id} is bound to the retrieval diagnostics session.`);
    }
    if (RUNTIME_SAMPLED_METRIC_IDS.has(id)) {
      throw new Error(`Device metric ${id} must be collected by its dedicated runtime sampler.`);
    }
    const recorded = applyDeviceMetricEvidence(id, evidence);
    await writeResult();
    return recorded;
  };

  const sampleEventLoopGap = async () => {
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording samples.");
    if (typeof requestAnimationFrame !== "function"
      || typeof performance === "undefined" || typeof performance.now !== "function") {
      const gapMetric = await recordDeviceMetric(
        "ui.eventLoopGapMs",
        { method: "unsupported", samples: [] },
      );
      return gapMetric;
    }
    const total = frozenDevicePlan.warmupSamples + frozenDevicePlan.sampleCount;
    const samples = [];
    let previous = await new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < total; index += 1) {
      const current = await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(Math.max(0, Number(current) - Number(previous)));
      previous = current;
    }
    return recordDeviceMetric("ui.eventLoopGapMs", { method: "measured", samples });
  };

  const RUNTIME_ENVELOPE_INTERVAL_MS = 1_000;
  const RUNTIME_STALL_INTERVAL_MS = 50;
  const RUNTIME_ENVELOPE_MAX_DURATION_MS = 10 * 60 * 1_000;
  const verifyExternalMemoryCaptureStartAbsence = async () => {
    let artifactAbsent = false;
    let rawExportAbsent = false;
    let reason = "external memory artifacts were present before profiler capture started";
    try {
      if (typeof app.vault.adapter.exists !== "function") {
        throw new Error("artifact existence checks are unavailable");
      }
      const [artifactExists, rawExportExists] = await Promise.all([
        app.vault.adapter.exists(EXTERNAL_MEMORY_ARTIFACT_PATH),
        app.vault.adapter.exists(EXTERNAL_MEMORY_RAW_EXPORT_PATH),
      ]);
      if (typeof artifactExists !== "boolean" || typeof rawExportExists !== "boolean") {
        throw new Error("artifact existence checks returned an invalid result");
      }
      artifactAbsent = !artifactExists;
      rawExportAbsent = !rawExportExists;
    } catch {
      reason = "external memory artifact absence could not be verified before profiler capture";
    }
    const status = artifactAbsent && rawExportAbsent ? "PASS" : "BLOCKED";
    const evidence = deepFreeze({
      status,
      reason: status === "PASS"
        ? "external memory artifacts were absent before profiler capture started"
        : reason,
      checkedAt: new Date().toISOString(),
      artifactPath: EXTERNAL_MEMORY_ARTIFACT_PATH,
      artifactAbsent,
      rawExportPath: EXTERNAL_MEMORY_RAW_EXPORT_PATH,
      rawExportAbsent,
    });
    result.deviceMeasurement.runtimeEnvelope = {
      ...result.deviceMeasurement.runtimeEnvelope,
      externalMemoryCapturePrecondition: evidence,
    };
    record(
      "External iOS memory JSON and raw export are absent at profiler capture start",
      status,
      status === "PASS" ? "" : evidence.reason,
    );
    await writeResult();
    if (status !== "PASS") {
      throw new Error("External memory evidence must not exist before profiler capture starts.");
    }
    return evidence;
  };

  const collectRuntimeEnvelopeResources = async (state) => {
    state.resourcePointCount += 1;
    if (state.hasDatabaseSource) {
      try {
        const stats = await plugin.vss.getStats({ mode: "foreground" });
        if (Number.isFinite(stats?.estimatedDbBytes) && stats.estimatedDbBytes >= 0) {
          state.databaseSamples.push(stats.estimatedDbBytes);
        } else {
          state.databaseComplete = false;
        }
      } catch {
        state.databaseComplete = false;
      }
    }
    if (state.hasProcessMemorySource) {
      try {
        const info = await process.getProcessMemoryInfo();
        const nextCounter = state.processMemoryCounter
          || (Number.isFinite(info?.residentSet) ? "resident_set_bytes"
            : Number.isFinite(info?.private) ? "private_bytes" : null);
        const valueKiB = nextCounter === "resident_set_bytes" ? info?.residentSet : info?.private;
        if (!nextCounter || !Number.isFinite(valueKiB) || valueKiB < 0) {
          state.processMemoryComplete = false;
        } else {
          state.processMemoryCounter = nextCounter;
          state.processMemorySamples.push(valueKiB * 1_024);
        }
      } catch {
        state.processMemoryComplete = false;
      }
    }
  };

  const performanceStageIsFullyBound = async (stage) => {
    const binding = result.deviceMeasurement.workloadBinding;
    const summary = binding.stages[stage];
    if (!summary
      || summary.status !== "PASS"
      || summary.boundCount !== summary.expectedCount
      || summary.violationCount !== 0
      || diagnosticsSessionStage !== stage
      || !diagnosticsSessionIdentity) return false;
    try {
      const projection = projectBoundRetrievalDiagnostics(
        await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId),
        diagnosticsSessionIdentity,
      );
      const partition = partitionMeasurementEpisodes(projection.events);
      return projection.droppedEventCount === 0
        && partition.unscopedEvents.length === 0
        && partition.surfaceMismatchEvents.length === 0
        && partition.episodes.length === summary.expectedCount
        && partition.episodes.every((episode) => episode.complete)
        && (projection.events.at(-1)?.sequence ?? 0) === performanceStageCursors[stage];
    } catch {
      return false;
    }
  };

  const startRuntimeEnvelopeTransition = async (...unexpectedArguments) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      await invalidatePerformanceWorkload({ stage: "standardPerformance" });
      throw new Error("startRuntimeEnvelope does not accept arguments.");
    }
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording samples.");
    if (runtimeEnvelopeState) {
      await invalidatePerformanceWorkload({ stage: diagnosticsSessionStage });
      throw new Error("The runtime envelope was already started for this frozen workload.");
    }
    await performanceEvidenceOperationQueue;
    if (finalizing || finalized) {
      throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    }
    const workloadBinding = result.deviceMeasurement.workloadBinding;
    const qualification = workloadBinding.qualification;
    if (workloadBinding.status === "INVALID"
      || qualification.status !== "PASS"
      || qualification.boundCount !== qualification.requiredCount
      || qualification.violationCount !== 0) {
      await invalidatePerformanceWorkload({ qualification: true });
      throw new Error("Both frozen performance qualifications must pass before the runtime envelope starts.");
    }
    try {
      const stagingProjection = projectBoundRetrievalDiagnostics(
        await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId),
        diagnosticsSessionIdentity,
      );
      if (stagingProjection.events.some((event) => event.sequence > performanceQualificationCursor)) {
        throw new Error("unbound staging diagnostics");
      }
    } catch {
      await invalidatePerformanceWorkload({ qualification: true });
      throw new Error("Performance qualification staging contains an unbound or mismatched episode.");
    }
    const externalMemoryCapturePrecondition = await verifyExternalMemoryCaptureStartAbsence();
    if (!diagnosticsSessionIdentity && !diagnosticsSessionStage) {
      const started = await startDiagnosticsSession(
        "standardPerformance",
        "Post-freeze standard-performance diagnostics session is active",
      );
      if (!started || !diagnosticsSessionIdentity) {
        throw new Error("Standard-performance diagnostics session could not be started.");
      }
    }
    if (diagnosticsSessionStage !== "standardPerformance" || !diagnosticsSessionIdentity) {
      throw new Error("Start the runtime envelope before the frozen standard-performance session is stopped.");
    }
    let envelopeIdentity = { ...diagnosticsSessionIdentity };
    let baselineProjection;
    try {
      baselineProjection = projectBoundRetrievalDiagnostics(
        await plugin.getRetrievalDiagnostics(envelopeIdentity.sessionId),
        envelopeIdentity,
      );
    } catch {
      markDiagnosticsBlocked(
        "runtime envelope could not capture its diagnostics baseline",
        "Runtime envelope is bound to the frozen performance workload",
      );
      throw new Error("Runtime envelope diagnostics baseline capture failed.");
    }
    if (baselineProjection.droppedEventCount > 0) {
      markDiagnosticsBlocked(
        "pre-envelope diagnostics event capacity was exceeded",
        "Pre-envelope qualitative diagnostics can be discarded safely",
      );
      throw new Error("Pre-envelope diagnostics are incomplete.");
    }
    if (baselineProjection.events.length > 0) {
      const stagedIdentity = { ...diagnosticsSessionIdentity };
      const discarded = await plugin.stopRetrievalDiagnostics(stagedIdentity.sessionId);
      if (discarded?.sessionId !== stagedIdentity.sessionId
        || discarded?.startedAt !== stagedIdentity.startedAt
        || discarded?.schemaVersion !== stagedIdentity.schemaVersion
        || discarded?.capacity !== stagedIdentity.capacity
        || discarded?.droppedEventCount !== 0) {
        markDiagnosticsBlocked(
          "pre-envelope qualitative diagnostics could not be discarded safely",
          "Pre-envelope qualitative diagnostics can be discarded safely",
        );
        throw new Error("Pre-envelope diagnostics discard failed.");
      }
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
      stoppedDiagnosticsProjection = null;
      diagnosticsStopAttempted = false;
      const restarted = await startDiagnosticsSession(
        "standardPerformance",
        "Fresh standard-performance diagnostics session is active",
      );
      if (!restarted || !diagnosticsSessionIdentity) {
        throw new Error("Fresh standard-performance diagnostics session could not be started.");
      }
      envelopeIdentity = { ...diagnosticsSessionIdentity };
      baselineProjection = projectBoundRetrievalDiagnostics(
        await plugin.getRetrievalDiagnostics(envelopeIdentity.sessionId),
        envelopeIdentity,
      );
      if (baselineProjection.droppedEventCount > 0 || baselineProjection.events.length > 0) {
        markDiagnosticsBlocked(
          "fresh standard-performance diagnostics did not start empty",
          "Runtime envelope starts from an empty performance session",
        );
        throw new Error("Fresh standard-performance diagnostics are not empty.");
      }
      record("Pre-envelope qualitative diagnostics are discarded", "PASS", "", {
        blocking: false,
      });
    }
    const hasDatabaseSource = typeof plugin?.vss?.getStats === "function";
    const hasPerformance = typeof performance !== "undefined";
    const hasProcessMemorySource = typeof process !== "undefined"
      && typeof process.getProcessMemoryInfo === "function";
    const hasStallSource = hasPerformance
      && typeof performance.now === "function"
      && typeof setTimeout === "function";
    const state = {
      identities: {
        standardPerformance: envelopeIdentity,
        retryPerformanceBatch1: null,
        retryPerformanceBatch2: null,
      },
      stopRequested: false,
      timedOut: false,
      hasDatabaseSource,
      hasProcessMemorySource,
      hasStallSource,
      databaseComplete: hasDatabaseSource,
      processMemoryComplete: hasProcessMemorySource,
      databaseSamples: [],
      processMemorySamples: [],
      processMemoryCounter: null,
      stallSamples: [],
      resourcePointCount: 0,
      stallTickCount: 0,
      wallClockStartedAt: new Date().toISOString(),
      monotonicStartedAt: hasStallSource ? performance.now() : null,
      deadlineAt: Date.now() + RUNTIME_ENVELOPE_MAX_DURATION_MS,
      externalMemoryCapturePrecondition,
      resourceLoopPromise: null,
      stallLoopPromise: null,
    };
    runtimeEnvelopeState = state;
    performanceStageCursors.standardPerformance = 0;
    await collectRuntimeEnvelopeResources(state);
    state.resourceLoopPromise = (async () => {
      while ((!state.stopRequested || state.resourcePointCount < 2)
        && Date.now() < state.deadlineAt) {
        await new Promise((resolve) => setTimeout(resolve, RUNTIME_ENVELOPE_INTERVAL_MS));
        await collectRuntimeEnvelopeResources(state);
      }
      if (!state.stopRequested) state.timedOut = true;
    })();
    state.stallLoopPromise = (async () => {
      while ((!state.stopRequested || state.stallTickCount < 2) && Date.now() < state.deadlineAt) {
        const expectedAt = state.hasStallSource
          ? performance.now() + RUNTIME_STALL_INTERVAL_MS
          : null;
        await new Promise((resolve) => setTimeout(resolve, RUNTIME_STALL_INTERVAL_MS));
        state.stallTickCount += 1;
        if (state.hasStallSource) {
          state.stallSamples.push(Math.max(0, performance.now() - expectedAt));
        }
      }
      if (!state.stopRequested) state.timedOut = true;
    })();
    result.deviceMeasurement.runtimeEnvelope = {
      status: "ACTIVE",
      workloadCoverageStatus: "ACTIVE",
      reason: "sampling is active around the frozen standard and retry performance workloads",
      resourceIntervalMs: RUNTIME_ENVELOPE_INTERVAL_MS,
      stallIntervalMs: RUNTIME_STALL_INTERVAL_MS,
      maxDurationMs: RUNTIME_ENVELOPE_MAX_DURATION_MS,
      resourceSampleCount: 0,
      databaseSampleCount: 0,
      runtimeProcessMemorySampleCount: 0,
      stallSampleCount: 0,
      startSequence: 0,
      endSequence: null,
      coveredStandardPerformanceEpisodeCount: 0,
      coveredRetryPerformanceEpisodeCount: 0,
      startedAt: state.wallClockStartedAt,
      finishedAt: null,
      sourceCoverage: {
        database: hasDatabaseSource ? "ACTIVE" : "BLOCKED",
        processMemory: hasProcessMemorySource ? "ACTIVE" : "BLOCKED",
        eventLoopStall: hasStallSource ? "ACTIVE" : "BLOCKED",
      },
      runtimeProcessMemorySourceAvailable: hasProcessMemorySource,
      iosEvidenceStatus: hasProcessMemorySource
        ? "NOT_REQUIRED"
        : result.runtime.platformClass === "ios-real-device" ? "REQUIRED" : "NOT_APPLICABLE",
      externalMemoryCapturePrecondition,
      externalMemoryEnvelope: null,
      evidenceSource: "workload-bound-runtime-envelope",
    };
    await writeResult();
    return clone(result.deviceMeasurement.runtimeEnvelope);
  };

  const stopRuntimeEnvelopeImpl = async () => {
    const state = runtimeEnvelopeState;
    if (!state) return clone(result.deviceMeasurement.runtimeEnvelope);
    state.stopRequested = true;
    await Promise.all([state.resourceLoopPromise, state.stallLoopPromise]);
    const resourceEvidenceSource = `runtime-envelope-resource-${RUNTIME_ENVELOPE_INTERVAL_MS}ms`;
    const stallEvidenceSource = `runtime-envelope-main-thread-gap-${RUNTIME_STALL_INTERVAL_MS}ms`;
    const databaseMetric = applyDeviceMetricEvidence(
      "storage.peakEstimatedDbBytes",
      state.hasDatabaseSource
        ? { method: "estimated", samples: state.databaseSamples }
        : { method: "unsupported", samples: [] },
      resourceEvidenceSource,
    );
    const processMemoryEvidenceSource = state.processMemoryCounter
      ? `runtime-envelope-process-${state.processMemoryCounter}-${RUNTIME_ENVELOPE_INTERVAL_MS}ms`
      : `runtime-envelope-process-memory-${RUNTIME_ENVELOPE_INTERVAL_MS}ms`;
    const processMemoryMetric = applyDeviceMetricEvidence(
      "memory.peakProcessFootprintBytes",
      state.hasProcessMemorySource
        ? { method: "measured", samples: state.processMemorySamples }
        : { method: "unsupported", samples: [] },
      processMemoryEvidenceSource,
    );
    const stallMetric = applyDeviceMetricEvidence(
      "ui.maxEventLoopStallMs",
      state.hasStallSource
        ? { method: "measured", samples: state.stallSamples }
        : { method: "unsupported", samples: [] },
      stallEvidenceSource,
    );
    let finalProjection = null;
    try {
      if (!["standardPerformance", "retryPerformanceBatch1", "retryPerformanceBatch2"]
        .includes(diagnosticsSessionStage)) {
        throw new Error("performance diagnostics session changed during runtime sampling");
      }
      const expectedIdentity = state.identities[diagnosticsSessionStage];
      if (!expectedIdentity
        || diagnosticsSessionIdentity?.sessionId !== expectedIdentity.sessionId) {
        throw new Error("performance diagnostics session identity changed during runtime sampling");
      }
      finalProjection = projectBoundRetrievalDiagnostics(
        await plugin.getRetrievalDiagnostics(expectedIdentity.sessionId),
        expectedIdentity,
      );
      applyDiagnosticsProjection(diagnosticsSessionStage, finalProjection);
      blockDroppedDiagnosticEvents(finalProjection);
    } catch {
      markDiagnosticsBlocked(
        "runtime envelope could not bind its samples to one performance diagnostics session",
        "Runtime envelope is bound to the frozen performance workload",
      );
    }
    const standardEpisodes = result.deviceMeasurement.diagnosticsSummary
      ?.measurementEpisodes?.standardPerformance;
    const retryEpisodes = result.deviceMeasurement.diagnosticsSummary
      ?.measurementEpisodes?.retryPerformance;
    const standardProjection = diagnosticsEvidenceProjections.standardPerformance;
    const retryProjectionBatch1 = diagnosticsEvidenceProjections.retryPerformanceBatch1;
    const retryProjectionBatch2 = diagnosticsEvidenceProjections.retryPerformanceBatch2;
    const workloadCovered = finalProjection
      && standardProjection?.droppedEventCount === 0
      && retryProjectionBatch1?.droppedEventCount === 0
      && retryProjectionBatch2?.droppedEventCount === 0
      && standardEpisodes?.status === "VALID"
      && retryEpisodes?.status === "VALID"
      && result.deviceMeasurement.workloadBinding.stages.standardPerformance.status === "PASS"
      && result.deviceMeasurement.workloadBinding.stages.retryPerformanceBatch1.status === "PASS"
      && result.deviceMeasurement.workloadBinding.stages.retryPerformanceBatch2.status === "PASS"
      && result.deviceMeasurement.workloadBinding.violationCount === 0
      && state.identities.retryPerformanceBatch1
      && state.identities.retryPerformanceBatch2
      && !state.timedOut;
    const databaseComplete = state.databaseComplete && state.databaseSamples.length >= 2;
    const processMemoryComplete = state.processMemoryComplete
      && state.processMemorySamples.length >= 2;
    const stallComplete = state.stallSamples.length >= 2;
    const sourcesComplete = databaseComplete && processMemoryComplete && stallComplete;
    result.deviceMeasurement.runtimeEnvelope = {
      status: workloadCovered && sourcesComplete ? "PASS" : "BLOCKED",
      workloadCoverageStatus: workloadCovered ? "PASS" : "BLOCKED",
      reason: !workloadCovered
        ? "sampling window did not contain the exact frozen standard and retry performance workloads"
        : sourcesComplete
          ? "sampling window contains the exact frozen standard and retry performance workloads"
          : "one or more runtime envelope sampling sources are incomplete",
      resourceIntervalMs: RUNTIME_ENVELOPE_INTERVAL_MS,
      stallIntervalMs: RUNTIME_STALL_INTERVAL_MS,
      maxDurationMs: RUNTIME_ENVELOPE_MAX_DURATION_MS,
      resourceSampleCount: state.resourcePointCount,
      databaseSampleCount: state.databaseSamples.length,
      runtimeProcessMemorySampleCount: state.processMemorySamples.length,
      stallSampleCount: state.stallSamples.length,
      startSequence: 0,
      endSequence: finalProjection?.events.at(-1)?.sequence ?? null,
      coveredStandardPerformanceEpisodeCount: standardEpisodes?.normalEpisodeCount || 0,
      coveredRetryPerformanceEpisodeCount: retryEpisodes?.normalEpisodeCount || 0,
      startedAt: state.wallClockStartedAt,
      finishedAt: new Date().toISOString(),
      sourceCoverage: {
        database: databaseComplete ? "PASS" : "BLOCKED",
        processMemory: processMemoryComplete ? "PASS" : "BLOCKED",
        eventLoopStall: stallComplete ? "PASS" : "BLOCKED",
      },
      runtimeProcessMemorySourceAvailable: state.hasProcessMemorySource,
      runtimeProcessMemoryCounter: state.processMemoryCounter,
      iosEvidenceStatus: state.hasProcessMemorySource
        ? "NOT_REQUIRED"
        : result.runtime.platformClass === "ios-real-device" ? "BLOCKED" : "NOT_APPLICABLE",
      externalMemoryCapturePrecondition: state.externalMemoryCapturePrecondition,
      externalMemoryEnvelope: null,
      durationMs: state.monotonicStartedAt === null
        ? null
        : Math.max(0, performance.now() - state.monotonicStartedAt),
      evidenceSource: "workload-bound-runtime-envelope",
    };
    if (!workloadCovered) {
      for (const id of RUNTIME_SAMPLED_METRIC_IDS) {
        result.deviceMeasurement.metrics[id] = {
          ...result.deviceMeasurement.metrics[id],
          status: "BLOCKED",
          reason: "runtime envelope is not bound to the exact frozen standard and retry performance workloads",
        };
      }
    } else {
      const completeness = {
        "storage.peakEstimatedDbBytes": databaseComplete,
        "memory.peakProcessFootprintBytes": processMemoryComplete,
        "ui.maxEventLoopStallMs": stallComplete,
      };
      for (const [id, complete] of Object.entries(completeness)) {
        if (complete) continue;
        result.deviceMeasurement.metrics[id] = {
          ...result.deviceMeasurement.metrics[id],
          status: "BLOCKED",
          reason: "runtime envelope sampling source is incomplete",
        };
      }
    }
    runtimeEnvelopeState = null;
    await writeResult();
    return {
      envelope: clone(result.deviceMeasurement.runtimeEnvelope),
      database: clone(result.deviceMeasurement.metrics[databaseMetric.id]),
      processMemory: clone(result.deviceMeasurement.metrics[processMemoryMetric.id]),
      eventLoopStall: clone(result.deviceMeasurement.metrics[stallMetric.id]),
    };
  };

  const stopRuntimeEnvelopeTransition = async (...unexpectedArguments) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch2" });
      throw new Error("stopRuntimeEnvelope does not accept arguments.");
    }
    await performanceEvidenceOperationQueue;
    if (!runtimeEnvelopeState) {
      await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch2" });
      throw new Error("A performance runtime envelope is not active.");
    }
    if (runtimeEnvelopeState
      && !await performanceStageIsFullyBound("retryPerformanceBatch2")) {
      await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch2" });
      await stopRuntimeEnvelopeImpl();
      throw new Error("Retry-performance batch 2 must contain exactly its bound frozen workload.");
    }
    return stopRuntimeEnvelopeImpl();
  };

  const beginRetryPerformanceTransition = (...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      const fail = async (message) => {
        await invalidatePerformanceWorkload({ stage: "standardPerformance" });
        throw new Error(message);
      };
      if (unexpectedArguments.length !== 0) {
        return fail("beginRetryPerformance does not accept arguments.");
      }
      if (!frozenDevicePlan) {
        return fail("Freeze the device measurement plan before retry performance.");
      }
      if (["retryPerformanceBatch1", "retryPerformanceBatch2"].includes(diagnosticsSessionStage)) {
        return fail("Retry performance batch 1 was already requested for this workload.");
      }
      if (!runtimeEnvelopeState) {
        return fail("Retry performance requires an active workload-bound runtime envelope.");
      }
      if (diagnosticsSessionStage !== "standardPerformance") {
        return fail("Retry performance must follow the standard-performance session.");
      }
      await performanceEvidenceOperationQueue;
      if (!await performanceStageIsFullyBound("standardPerformance")) {
        await invalidatePerformanceWorkload({ stage: "standardPerformance" });
        throw new Error("Standard performance must contain exactly its bound frozen workload.");
      }
      await stopRetrievalDiagnosticsImpl();
      const standardStatus = result.deviceMeasurement.diagnosticsSummary
        ?.measurementEpisodes?.standardPerformance?.status;
      if (standardStatus !== "VALID") {
        return fail("Standard performance diagnostics must contain the exact frozen episode count.");
      }
      const started = await startDiagnosticsSession(
        "retryPerformanceBatch1",
        "Post-freeze retry-performance batch 1 diagnostics session is active",
      );
      if (!started || !diagnosticsSessionIdentity) {
        return fail("Retry-performance diagnostics session could not be started.");
      }
      runtimeEnvelopeState.identities.retryPerformanceBatch1 = { ...diagnosticsSessionIdentity };
      performanceStageCursors.retryPerformanceBatch1 = 0;
      result.deviceMeasurement.runtimeEnvelope.reason =
        "sampling is active around the frozen retry performance workload";
      await writeResult();
      return clone(result.deviceMeasurement);
    });
  };

  const continueRetryPerformanceTransition = (...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      const fail = async (message) => {
        await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch1" });
        throw new Error(message);
      };
      if (unexpectedArguments.length !== 0) {
        return fail("continueRetryPerformance does not accept arguments.");
      }
      if (!frozenDevicePlan) {
        return fail("Freeze the device measurement plan before retry performance.");
      }
      if (diagnosticsSessionStage === "retryPerformanceBatch2") {
        return fail("Retry performance batch 2 was already requested for this workload.");
      }
      if (!runtimeEnvelopeState) {
        return fail("Retry performance requires an active workload-bound runtime envelope.");
      }
      if (diagnosticsSessionStage !== "retryPerformanceBatch1") {
        return fail("Retry-performance batch 2 must follow batch 1.");
      }
      await performanceEvidenceOperationQueue;
      if (!await performanceStageIsFullyBound("retryPerformanceBatch1")) {
        await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch1" });
        throw new Error("Retry-performance batch 1 must contain exactly its bound frozen workload.");
      }
      await stopRetrievalDiagnosticsImpl();
      const batch1Status = result.deviceMeasurement.diagnosticsSummary
        ?.measurementEpisodes?.retryPerformanceBatches?.[0]?.status;
      if (batch1Status !== "VALID") {
        return fail("Retry-performance batch 1 must contain its exact frozen episode count.");
      }
      const started = await startDiagnosticsSession(
        "retryPerformanceBatch2",
        "Post-freeze retry-performance batch 2 diagnostics session is active",
      );
      if (!started || !diagnosticsSessionIdentity) {
        return fail("Retry-performance batch 2 diagnostics session could not be started.");
      }
      runtimeEnvelopeState.identities.retryPerformanceBatch2 = { ...diagnosticsSessionIdentity };
      performanceStageCursors.retryPerformanceBatch2 = 0;
      result.deviceMeasurement.runtimeEnvelope.reason =
        "sampling is active around the frozen retry performance workload";
      await writeResult();
      return clone(result.deviceMeasurement);
    });
  };

  const EXTERNAL_SYSTEM_MEMORY_PROFILERS = new Set([
    "Xcode Instruments",
    "Instruments CLI",
  ]);

  const EXTERNAL_MEMORY_ARTIFACT_KEYS = new Set([
    "schemaVersion", "collectorKind", "tool", "toolVersion", "platform", "platformClass",
    "runtimeFamily", "counter", "unit", "processName", "appBundleId", "appVersion",
    "appBuildIdentitySha256", "pluginId", "pluginVersion", "pluginArtifactSha256",
    "runnerSha256", "deviceIdentitySha256", "windowStartedAt", "windowFinishedAt",
    "sampleIntervalMs", "samples", "rawExportPath", "rawExportSha256",
  ]);
  const externalMemoryArtifactMatchesBindings = (
    artifact,
    envelope,
    currentRuntimeIdentity,
    currentArtifactIdentity,
  ) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)
      || Object.keys(artifact).length !== EXTERNAL_MEMORY_ARTIFACT_KEYS.size
      || Object.keys(artifact).some((key) => !EXTERNAL_MEMORY_ARTIFACT_KEYS.has(key))) {
      return false;
    }
    const safeToolVersion = (value) => (
      typeof value === "string" && /^[0-9]+(?:[._-][0-9A-Za-z]+)*$/u.test(value)
    );
    const safePlatform = (value) => (
      typeof value === "string"
      && /^(?:iOS|iPadOS)(?: [0-9A-Za-z._()+-]+){0,3}$/u.test(value)
    );
    const canonicalTimestamp = (value) => (
      typeof value === "string"
      && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString() === value
    );
    const windowStartedMs = Date.parse(artifact.windowStartedAt);
    const windowFinishedMs = Date.parse(artifact.windowFinishedAt);
    const envelopeStartedMs = Date.parse(envelope.startedAt);
    const envelopeFinishedMs = Date.parse(envelope.finishedAt);
    const samples = Array.isArray(artifact.samples) ? artifact.samples : [];
    const sampleIntervalMs = artifact.sampleIntervalMs;
    const sampledSpanMs = (samples.length - 1) * sampleIntervalMs;
    const externalContract = frozenDevicePlan.externalMemoryEvidence;
    const runtimeMatchesInitialization = [
      "appVersion", "appVersionSource", "loadedAppVersion", "loadedAppVersionSource",
      "shellVersion", "shellVersionSource", "pluginVersion", "platform", "platformClass",
      "runtimeFamily",
      "appBuildIdentitySha256",
    ].every((key) => currentRuntimeIdentity[key] === result.runtime[key]);
    const artifactsMatchInitialization = currentArtifactIdentity.runnerSha256
        === result.identity.runnerSha256
      && currentArtifactIdentity.pluginArtifactSha256
        === result.identity.pluginArtifactSha256;
    return runtimeMatchesInitialization
      && artifactsMatchInitialization
      && artifact.schemaVersion === 1
      && artifact.collectorKind === "system-memory-profiler"
      && EXTERNAL_SYSTEM_MEMORY_PROFILERS.has(artifact.tool)
      && safeToolVersion(artifact.toolVersion)
      && safePlatform(artifact.platform)
      && artifact.platformClass === externalContract.requiredPlatformClass
      && currentRuntimeIdentity.platformClass === externalContract.requiredPlatformClass
      && artifact.runtimeFamily === externalContract.requiredRuntimeFamily
      && currentRuntimeIdentity.runtimeFamily === externalContract.requiredRuntimeFamily
      && artifact.counter === externalContract.counter
      && artifact.unit === externalContract.unit
      && artifact.processName === externalContract.processName
      && artifact.appBundleId === externalContract.appBundleId
      && artifact.appVersion === currentRuntimeIdentity.appVersion
      && /^[a-f0-9]{64}$/u.test(currentRuntimeIdentity.appBuildIdentitySha256 || "")
      && artifact.appBuildIdentitySha256 === currentRuntimeIdentity.appBuildIdentitySha256
      && artifact.pluginId === PLUGIN_ID
      && artifact.pluginVersion === currentRuntimeIdentity.pluginVersion
      && /^[a-f0-9]{64}$/u.test(currentArtifactIdentity.pluginArtifactSha256 || "")
      && artifact.pluginArtifactSha256 === currentArtifactIdentity.pluginArtifactSha256
      && /^[a-f0-9]{64}$/u.test(currentArtifactIdentity.runnerSha256 || "")
      && artifact.runnerSha256 === currentArtifactIdentity.runnerSha256
      && /^[a-f0-9]{64}$/u.test(externalContract.deviceIdentitySha256 || "")
      && artifact.deviceIdentitySha256 === externalContract.deviceIdentitySha256
      && artifact.rawExportPath === EXTERNAL_MEMORY_RAW_EXPORT_PATH
      && /^[a-f0-9]{64}$/u.test(artifact.rawExportSha256 || "")
      && canonicalTimestamp(artifact.windowStartedAt)
      && canonicalTimestamp(artifact.windowFinishedAt)
      && windowFinishedMs >= windowStartedMs
      && windowFinishedMs <= Date.now()
      && windowStartedMs <= envelopeStartedMs
      && windowFinishedMs >= envelopeFinishedMs
      && Number.isSafeInteger(sampleIntervalMs)
      && sampleIntervalMs > 0
      && sampleIntervalMs <= RUNTIME_ENVELOPE_INTERVAL_MS
      && samples.length >= 2
      && samples.every((sample) => Number.isSafeInteger(sample) && sample >= 0)
      && sampledSpanMs >= windowFinishedMs - windowStartedMs;
  };

  const recordExternalMemoryEnvelopeImpl = async (evidence = {}) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording samples.");
    if (runtimeEnvelopeState) throw new Error("Stop the runtime envelope before binding external memory evidence.");
    const envelope = result.deviceMeasurement.runtimeEnvelope;
    if (envelope.workloadCoverageStatus !== "PASS" || !envelope.startedAt || !envelope.finishedAt) {
      throw new Error("External memory evidence requires a completed workload-bound runtime envelope.");
    }
    if (envelope.externalMemoryCapturePrecondition?.status !== "PASS"
      || envelope.externalMemoryCapturePrecondition.artifactAbsent !== true
      || envelope.externalMemoryCapturePrecondition.rawExportAbsent !== true) {
      throw new Error("External memory capture-start absence evidence is unavailable.");
    }
    if (envelope.runtimeProcessMemorySourceAvailable) {
      throw new Error("Runtime process-memory evidence is available and takes precedence.");
    }
    if (envelope.externalMemoryEnvelope) {
      throw new Error("External memory envelope evidence is already recorded.");
    }
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)
      || Object.keys(evidence).length !== 1
      || evidence.artifactPath !== EXTERNAL_MEMORY_ARTIFACT_PATH) {
      throw new Error("External memory envelope evidence has an invalid shape.");
    }
    let artifactBytes;
    let artifact;
    let rawExportBytes;
    try {
      artifactBytes = await readBinaryBytes(EXTERNAL_MEMORY_ARTIFACT_PATH);
      artifact = parseStrictUtf8Json(artifactBytes);
      rawExportBytes = await readBinaryBytes(EXTERNAL_MEMORY_RAW_EXPORT_PATH);
      if (rawExportBytes.length === 0) throw new Error("raw export must be non-empty");
    } catch {
      throw new Error("External memory envelope artifact or raw Instruments export is unavailable or invalid.");
    }
    let currentRuntimeIdentity;
    let currentArtifactIdentity;
    try {
      currentRuntimeIdentity = await captureCurrentRuntimeIdentity();
      currentArtifactIdentity = await captureCurrentArtifactIdentity();
    } catch {
      throw new Error("External memory envelope runtime identity is unavailable.");
    }
    if (!externalMemoryArtifactMatchesBindings(
      artifact,
      envelope,
      currentRuntimeIdentity,
      currentArtifactIdentity,
    )) {
      throw new Error("External memory envelope provenance or workload-window coverage is invalid.");
    }
    const rawExportSha256 = await digestBytes(rawExportBytes);
    if (artifact.rawExportSha256 !== rawExportSha256) {
      throw new Error("External memory envelope raw Instruments export digest is invalid.");
    }
    const blockedExternalMemoryEnvelope = {
      schemaVersion: 1,
      status: "BLOCKED",
      reason: EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON,
      artifactPath: EXTERNAL_MEMORY_ARTIFACT_PATH,
      artifactSha256: await digestBytes(artifactBytes),
      rawExportPath: EXTERNAL_MEMORY_RAW_EXPORT_PATH,
      rawExportSha256,
      deviceIdentitySha256: artifact.deviceIdentitySha256,
    };
    const processMemory = applyDeviceMetricEvidence(
      "memory.peakProcessFootprintBytes",
      { method: "unsupported", samples: [] },
      "external-memory-converter-unverified",
    );
    processMemory.reason = EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON;
    result.deviceMeasurement.metrics["memory.peakProcessFootprintBytes"] = clone(processMemory);
    result.deviceMeasurement.runtimeEnvelope = {
      ...envelope,
      status: "BLOCKED",
      reason: EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON,
      iosEvidenceStatus: "BLOCKED",
      sourceCoverage: {
        ...envelope.sourceCoverage,
        processMemory: "BLOCKED",
      },
      externalMemoryEnvelope: blockedExternalMemoryEnvelope,
    };
    record(
      "External iOS memory samples come from a verified raw-export converter",
      "BLOCKED",
      EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON,
    );
    await writeResult();
    return {
      envelope: clone(result.deviceMeasurement.runtimeEnvelope),
      processMemory,
    };

  };

  const recordExternalMemoryEnvelope = (evidence = {}) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    const queued = externalMemoryEvidenceOperationQueue.then(() => (
      recordExternalMemoryEnvelopeImpl(evidence)
    ));
    externalMemoryEvidenceOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const sampleLongTasks = async (windowMs = 1_000) => {
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording samples.");
    const supportsLongTask = typeof PerformanceObserver === "function"
      && Array.isArray(PerformanceObserver.supportedEntryTypes)
      && PerformanceObserver.supportedEntryTypes.includes("longtask");
    if (!supportsLongTask) {
      record("Long Task API diagnostic is available", "BLOCKED", "longtask entries are unsupported", { blocking: false });
      return recordDeviceMetric("ui.longTaskDurationMs", { method: "unsupported", samples: [] });
    }
    const samples = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (Number.isFinite(entry.duration) && entry.duration >= 0) samples.push(entry.duration);
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(windowMs) || 0)));
    observer.disconnect();
    record("Long Task API diagnostic is available", "PASS", "", { blocking: false });
    return recordDeviceMetric("ui.longTaskDurationMs", {
      method: "measured",
      samples: samples.length > 0 ? samples : [0],
    });
  };

  const VSS_STAT_FIELDS = Object.freeze([
    "initDurationMs", "lastRefreshDurationMs", "lastSearchDurationMs", "chunkCount",
    "fileCount", "estimatedDbBytes", "storageUsage", "storageQuota",
    "lexicalSearchDurationMs", "lexicalSearchMatchedRows",
  ]);

  const recordVssStats = async (phase, injectedStats) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording diagnostics.");
    if (!["before", "after"].includes(phase)) throw new Error("VSS stats phase must be before or after.");
    const source = injectedStats || await plugin?.vss?.getStats?.({ mode: "foreground" }) || {};
    if (finalizing || finalized) {
      throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    }
    const snapshot = {};
    for (const key of VSS_STAT_FIELDS) {
      if (Number.isFinite(source[key]) && source[key] >= 0) snapshot[key] = source[key];
    }
    result.deviceMeasurement.vssStats[phase] = snapshot;
    await writeResult();
    return clone(snapshot);
  };

  const RETRIEVAL_DIAGNOSTIC_PHASES = new Set([
    "memory_search", "graph_snapshot", "graph_preflight", "ppr_solve", "graph_workset",
    "graph_worker", "reranker", "recovery_standard", "recovery_relaxed",
    "recovery_projection", "finalization_reserve",
  ]);
  const RETRIEVAL_DIAGNOSTIC_OUTCOMES = new Set([
    "started", "completed", "skipped", "fallback", "aborted", "deadline", "failed",
    "late_discarded",
  ]);
  const RETRIEVAL_DIAGNOSTIC_SURFACES = new Set(["chat", "pagelet"]);
  const RETRIEVAL_DIAGNOSTIC_REASONS = new Set([
    "aborted", "activation_not_met", "attempt_aborted", "attempt_deadline", "attempt_failed",
    "boundary_changed", "cancel_observed", "cancel_requested", "contradictory",
    "coordinator_closed", "currentness_changed", "deadline", "deadline_elapsed",
    "embedding_unavailable", "epoch_changed", "executor_unavailable", "filtered_no_seeds",
    "flag_changed", "flag_off",
    "graph-rank-aborted", "graph-rank-budget-exceeded", "graph-rank-deadline",
    "graph-rank-embedding-invalid", "graph-rank-epoch-mismatch",
    "graph-rank-path-evidence-unavailable", "graph-rank-path-mismatch",
    "graph-rank-result-invalid", "graph-rank-source-changed",
    "graph-rank-source-epoch-mismatch", "graph-rank-unavailable", "graph-rank-worker-error",
    "graph_budget", "hard_deadline", "invalid_graph", "invalid_index", "invalid_snapshot",
    "iteration_cap", "late_result", "lead_not_requested", "concrete_lead_unavailable",
    "local_budget", "malformed", "model_unavailable", "no_seeds",
    "not_eligible", "numeric_error", "parent_aborted", "policy_disabled",
    "preflight_unavailable", "projection_aborted", "projection_failed",
    "projection_unavailable", "provider_error", "ranked_candidate_invalid",
    "ranked_path_invalid", "ranked_set_incomplete", "request_invalidated",
    "request_unavailable", "reserve_aborted", "reserve_exhausted", "reserve_failed",
    "reserve_not_entered", "reserve_protected", "seed_unavailable", "semantic_none", "snapshot_budget",
    "solve_unavailable", "source_changed", "source_unavailable", "standard_unavailable",
    "standard_sufficient", "partial_requires_stage", "stage_control_reserved", "stage_unavailable",
    "stage_validation_deadline", "stage_validation_failed", "timeout", "token_consumed",
    "unknown_error", "workset_budget", "workset_empty",
  ]);
  const RETRIEVAL_DIAGNOSTIC_METRICS = new Set([
    "durationMs", "remainingMs", "seedCount", "nodeCount", "edgeCount", "snapshotBytes",
    "opaqueBridgeCount", "liftedStateCount", "transitionCount", "projectedOperations",
    "projectedBytes", "iterationCount", "errorBound", "localCount", "deepCount",
    "convergenceCount", "unionCount", "cosinePassCount", "selectedCount", "candidateCount",
    "documentCount", "batchCount", "chunkCount", "queueWaitMs", "workerDurationMs",
    "maxBatchDurationMs", "cancelRequested", "cancelObserved", "acceptedCount",
    "lateDiscardCount", "providerCallCount", "retryConsumed",
    "temporalFilterApplied", "temporalViolationCount",
  ]);
  const DEADLINE_REASONS = new Set([
    "attempt_deadline", "deadline", "deadline_elapsed", "graph-rank-deadline", "hard_deadline",
    "reserve_exhausted", "stage_validation_deadline", "timeout",
  ]);

  const A2_FAILURE_REASON_BY_OUTCOME = Object.freeze({
    failed: "attempt_failed",
    aborted: "attempt_aborted",
    deadline: "attempt_deadline",
  });
  const contentFreeA2FailureReason = (event) => {
    const expectedReason = event
      ? A2_FAILURE_REASON_BY_OUTCOME[event.outcome]
      : undefined;
    return expectedReason && event.reason === expectedReason ? expectedReason : null;
  };

  const projectRetrievalDiagnostics = (snapshot) => {
    if (!snapshot || typeof snapshot !== "object"
      || snapshot.schemaVersion !== RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION) {
      throw new Error("Unsupported retrieval diagnostics schema.");
    }
    if (!Number.isInteger(snapshot.capacity) || snapshot.capacity < 1
      || !Number.isInteger(snapshot.droppedEventCount) || snapshot.droppedEventCount < 0
      || !Array.isArray(snapshot.events) || snapshot.events.length > snapshot.capacity) {
      throw new Error("Invalid retrieval diagnostics snapshot envelope.");
    }
    let previousSequence = 0;
    let previousElapsedMs = 0;
    const events = snapshot.events.map((event) => {
      if (!event || typeof event !== "object"
        || !Number.isInteger(event.sequence) || event.sequence <= previousSequence
        || !Number.isFinite(event.elapsedMs) || event.elapsedMs < previousElapsedMs
        || typeof event.runId !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(event.runId)
        || !RETRIEVAL_DIAGNOSTIC_SURFACES.has(event.surface)
        || !RETRIEVAL_DIAGNOSTIC_PHASES.has(event.phase)
        || !RETRIEVAL_DIAGNOSTIC_OUTCOMES.has(event.outcome)
        || (event.reason !== undefined && !RETRIEVAL_DIAGNOSTIC_REASONS.has(event.reason))) {
        throw new Error("Invalid retrieval diagnostics event.");
      }
      previousSequence = event.sequence;
      previousElapsedMs = event.elapsedMs;
      const metrics = {};
      if (event.metrics !== undefined && (!event.metrics || typeof event.metrics !== "object")) {
        throw new Error("Invalid retrieval diagnostics metrics.");
      }
      for (const [key, value] of Object.entries(event.metrics || {})) {
        if (!RETRIEVAL_DIAGNOSTIC_METRICS.has(key)) continue;
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("Invalid retrieval diagnostics metric value.");
        }
        metrics[key] = value;
      }
      return {
        sequence: event.sequence,
        elapsedMs: event.elapsedMs,
        runId: event.runId,
        surface: event.surface,
        phase: event.phase,
        outcome: event.outcome,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        metrics,
      };
    });
    return {
      schemaVersion: RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION,
      capacity: snapshot.capacity,
      droppedEventCount: snapshot.droppedEventCount,
      events,
    };
  };

  const hasInvalidDiagnosticSurface = (snapshot) => (
    Array.isArray(snapshot?.events)
    && snapshot.events.some((event) => (
      !event || typeof event !== "object" || !RETRIEVAL_DIAGNOSTIC_SURFACES.has(event.surface)
    ))
  );

  const projectBoundRetrievalDiagnostics = (snapshot, identity) => {
    if (snapshot?.sessionId !== identity.sessionId
      || snapshot?.startedAt !== identity.startedAt
      || snapshot?.schemaVersion !== identity.schemaVersion
      || snapshot?.capacity !== identity.capacity) {
      throw new Error("Retrieval diagnostics session identity changed.");
    }
    return projectRetrievalDiagnostics(snapshot);
  };

  const GRAPH_PHASES = new Set([
    "graph_snapshot", "graph_preflight", "ppr_solve", "graph_workset", "graph_worker",
  ]);
  const MULTI_STANDARD_SKIP_REASONS = new Set([
    "coordinator_closed", "flag_off", "not_eligible", "seed_unavailable",
    "standard_unavailable", "token_consumed",
  ]);
  const TERMINAL_OUTCOMES = new Set(["completed", "aborted", "deadline", "failed"]);
  const observedDocumentCount = (event) => {
    const value = event?.metrics?.documentCount;
    if (event?.outcome !== "completed" || !Number.isSafeInteger(value) || value < 0) return null;
    if (value === 0) return event.reason === "semantic_none" ? 0 : null;
    return event.reason === undefined ? value : null;
  };
  const isFinalizationBoundary = (event) => (
    event.phase === "finalization_reserve"
    && (TERMINAL_OUTCOMES.has(event.outcome)
      || (event.outcome === "skipped" && event.reason === "reserve_not_entered"))
  );

  const partitionMeasurementEpisodes = (events) => {
    const episodes = [];
    const unscopedEvents = [];
    const surfaceMismatchEvents = [];
    let current = null;
    const expectedSurface = frozenDevicePlan?.diagnosticsEvidence.performanceSurface || "chat";
    const createEpisode = (event) => ({
      runId: event.runId,
      events: [event],
      attempts: [],
      standardAttempts: [],
      relaxedAttempts: [],
      activeAttempts: [],
      internalAttempt: null,
      boundary: null,
      standardStartedCount: 1,
      standardTerminals: [],
      relaxedStartedCount: 0,
      relaxedTerminals: [],
      relaxedSkipped: [],
      projectionStartedCount: 0,
      projectionTerminals: [],
      finalizationStarted: false,
      reserveProtectedCount: 0,
      structurallyInvalid: false,
    });
    const hasTerminalForPhase = (attempt, phase) => {
      const phaseEvents = attempt.events.filter((candidate) => candidate.phase === phase);
      return phaseEvents.some((candidate) => candidate.outcome !== "started");
    };
    const hasOpenPhase = (attempt, phase) => {
      const phaseEvents = attempt.events.filter((candidate) => candidate.phase === phase);
      return phaseEvents.some((candidate) => candidate.outcome === "started")
        && !phaseEvents.some((candidate) => candidate.outcome !== "started");
    };
    const routeAttemptEvent = (episode, event) => {
      if (episode.activeAttempts.length === 0) return null;
      if (episode.activeAttempts.length === 1) return episode.activeAttempts[0];

      // Diagnostics intentionally contain no query or invocation id. Concurrent
      // standard calls are therefore paired only by their observable stage
      // chains. A terminal is routed to the oldest still-open matching stage;
      // a new graph chain is routed to the oldest untouched attempt. Anything
      // that cannot be paired this way remains a structural failure below.
      if (event.outcome !== "started") {
        const matchingOpen = episode.activeAttempts.find((attempt) => (
          hasOpenPhase(attempt, event.phase)
        ));
        if (matchingOpen) return matchingOpen;
      }
      if (event.phase === "graph_snapshot" && event.outcome === "started") {
        const untouched = episode.activeAttempts.find((attempt) => (
          !attempt.events.some((candidate) => (
            GRAPH_PHASES.has(candidate.phase) || candidate.phase === "reranker"
          ))
        ));
        if (untouched) return untouched;
      }
      if (event.outcome === "started") {
        const withoutPhase = episode.activeAttempts.find((attempt) => (
          !attempt.events.some((candidate) => candidate.phase === event.phase)
        ));
        if (withoutPhase) return withoutPhase;
      }
      if (episode.internalAttempt && episode.activeAttempts.includes(episode.internalAttempt)) {
        return episode.internalAttempt;
      }
      return null;
    };
    const selectMemoryTerminalAttempt = (episode) => {
      if (episode.activeAttempts.length === 1) return episode.activeAttempts[0];
      const rerankerComplete = episode.activeAttempts.find((attempt) => (
        hasTerminalForPhase(attempt, "reranker")
      ));
      if (rerankerComplete) return rerankerComplete;
      // Some successful/failed searches never enter the reranker. With no
      // invocation id available, FIFO is the only content-free pairing that
      // preserves the one-start/one-terminal invariant.
      return episode.activeAttempts[0] || null;
    };
    const attachTrailingCancellationEvent = (event) => {
      const isObserved = event.phase === "graph_worker"
        && event.outcome === "aborted"
        && event.reason === "cancel_observed"
        && (event.metrics.cancelRequested || 0) > 0
        && (event.metrics.cancelObserved || 0) > 0;
      const isLate = event.phase === "graph_worker"
        && event.outcome === "late_discarded"
        && event.reason === "late_result"
        && (event.metrics.cancelRequested || 0) > 0
        && (event.metrics.lateDiscardCount || 0) > 0;
      if (!isObserved && !isLate) return false;
      const matchingEpisodes = episodes.filter((episode) => (
        episode.boundary
        && episode.runId === event.runId
        && episode.standardStartedCount === 1
        && episode.attempts.length === 1
        && episode.attempts[0].events.some((candidate) => (
          candidate.phase === "graph_worker"
          && candidate.outcome === "aborted"
          && candidate.reason === "cancel_requested"
          && (candidate.metrics.cancelRequested || 0) > 0
        ))
      ));
      if (matchingEpisodes.length !== 1) return false;
      const episode = matchingEpisodes[0];
      episode.events.push(event);
      episode.attempts[0].events.push(event);
      return true;
    };
    for (const event of events) {
      if (current && event.runId !== current.runId) {
        current.structurallyInvalid = true;
        unscopedEvents.push(event);
        continue;
      }
      if (event.surface !== expectedSurface) {
        surfaceMismatchEvents.push(event);
        unscopedEvents.push(event);
        if (current) current.structurallyInvalid = true;
        continue;
      }
      if (!current && attachTrailingCancellationEvent(event)) continue;
      if (event.phase === "recovery_standard" && event.outcome === "started") {
        if (!current) {
          current = createEpisode(event);
        } else {
          current.events.push(event);
          // finalization_reserve is the run boundary. A second visible standard
          // call may overlap the first or begin after the first fully resolves.
          const concurrentStandard = current.standardStartedCount === 1
            && current.standardTerminals.length === 0
            && current.relaxedStartedCount === 0
            && current.relaxedSkipped.length === 0
            && !current.finalizationStarted;
          const firstStandardAttempt = current.standardAttempts[0];
          const sequentialStandard = current.standardStartedCount === 1
            && current.activeAttempts.length === 0
            && current.standardAttempts.length === 1
            && firstStandardAttempt?.terminal?.outcome === "completed"
            && current.standardTerminals.length === 1
            && current.standardTerminals[0].outcome === "completed"
            && current.relaxedStartedCount === 0
            && current.relaxedTerminals.length === 0
            && current.relaxedSkipped.length === 1
            && MULTI_STANDARD_SKIP_REASONS.has(current.relaxedSkipped[0].reason)
            && current.projectionStartedCount === 0
            && current.projectionTerminals.length === 0
            && current.reserveProtectedCount === 0
            && !current.finalizationStarted;
          if (!concurrentStandard && !sequentialStandard) current.structurallyInvalid = true;
          current.standardStartedCount += 1;
          if (current.standardStartedCount > 2) current.structurallyInvalid = true;
        }
        continue;
      }
      if (!current) {
        unscopedEvents.push(event);
        continue;
      }

      current.events.push(event);
      if (event.phase === "memory_search") {
        if (event.outcome === "started") {
          const startsStandard = current.standardAttempts.length < current.standardStartedCount
            && current.relaxedStartedCount === 0;
          const startsRelaxed = !startsStandard
            && current.relaxedAttempts.length < current.relaxedStartedCount;
          if (current.finalizationStarted || (!startsStandard && !startsRelaxed)) {
            current.structurallyInvalid = true;
          }
          const attempt = {
            kind: startsRelaxed ? "relaxed" : "standard",
            events: [event],
            terminal: null,
            multipleTerminals: false,
          };
          current.attempts.push(attempt);
          if (startsRelaxed) current.relaxedAttempts.push(attempt);
          else current.standardAttempts.push(attempt);
          current.activeAttempts.push(attempt);
          continue;
        }
        const terminalAttempt = selectMemoryTerminalAttempt(current);
        if (!TERMINAL_OUTCOMES.has(event.outcome) || !terminalAttempt) {
          current.structurallyInvalid = true;
        } else {
          terminalAttempt.events.push(event);
          if (terminalAttempt.terminal) terminalAttempt.multipleTerminals = true;
          else terminalAttempt.terminal = event;
          current.activeAttempts = current.activeAttempts.filter((attempt) => (
            attempt !== terminalAttempt
          ));
          if (current.internalAttempt === terminalAttempt) current.internalAttempt = null;
        }
      } else if (GRAPH_PHASES.has(event.phase) || event.phase === "reranker") {
        const routedAttempt = routeAttemptEvent(current, event);
        if (routedAttempt) {
          routedAttempt.events.push(event);
          current.internalAttempt = routedAttempt;
          continue;
        }
        const followsCompletedAttempt = current.attempts.some((attempt) => attempt.terminal);
        const isPostAttemptCancellationEvent = event.phase === "graph_worker"
          && followsCompletedAttempt
          && (event.reason === "cancel_requested"
            || event.reason === "cancel_observed"
            || (event.metrics.cancelRequested || 0) > 0
            || (event.metrics.cancelObserved || 0) > 0
            || (event.metrics.lateDiscardCount || 0) > 0);
        if (!isPostAttemptCancellationEvent) {
          current.structurallyInvalid = true;
        } else {
          const completedAttempts = current.attempts.filter((attempt) => attempt.terminal);
          if (completedAttempts.length !== 1 || current.activeAttempts.length !== 0) {
            current.structurallyInvalid = true;
          } else {
            // Worker acknowledgement and late-discard callbacks may arrive
            // after the Memory attempt has already returned direct-only. Keep
            // those content-free events bound to that one completed attempt;
            // the cancellation topology below still requires the request to
            // have been made before the attempt terminal.
            completedAttempts[0].events.push(event);
          }
        }
      } else if (event.phase === "recovery_standard") {
        if (!TERMINAL_OUTCOMES.has(event.outcome)
          || current.standardTerminals.length >= current.standardStartedCount
          || current.standardAttempts.filter((attempt) => attempt.terminal).length
            <= current.standardTerminals.length
          || current.finalizationStarted) {
          current.structurallyInvalid = true;
        } else {
          current.standardTerminals.push(event);
        }
      } else if (event.phase === "recovery_relaxed") {
        if (event.outcome === "started") {
          if (current.standardTerminals.length
              <= current.relaxedSkipped.length + current.relaxedStartedCount
            || current.standardStartedCount !== 1
            || current.relaxedStartedCount >= 1
            || current.finalizationStarted) {
            current.structurallyInvalid = true;
          }
          current.relaxedStartedCount += 1;
        } else if (event.outcome === "skipped") {
          if (current.standardTerminals.length
              <= current.relaxedSkipped.length + current.relaxedTerminals.length
            || current.relaxedSkipped.length + current.relaxedStartedCount
              >= current.standardStartedCount
            || current.finalizationStarted) {
            current.structurallyInvalid = true;
          }
          current.relaxedSkipped.push(event);
        } else if (TERMINAL_OUTCOMES.has(event.outcome)) {
          if (current.relaxedStartedCount !== 1
            || current.relaxedAttempts.length !== 1
            || !current.relaxedAttempts[0].terminal
            || current.relaxedTerminals.length >= current.relaxedStartedCount
            || current.finalizationStarted) {
            current.structurallyInvalid = true;
          }
          current.relaxedTerminals.push(event);
        } else {
          current.structurallyInvalid = true;
        }
      } else if (event.phase === "recovery_projection") {
        const projectionEligible = current.activeAttempts.length === 0
          && current.relaxedAttempts.length === 1
          && current.relaxedTerminals[0]?.outcome === "completed"
          && !current.finalizationStarted;
        if (event.outcome === "started") {
          if (!projectionEligible
            || current.projectionStartedCount !== 0
            || current.projectionTerminals.length !== 0) {
            current.structurallyInvalid = true;
          }
          current.projectionStartedCount += 1;
        } else if ([...TERMINAL_OUTCOMES, "fallback"].includes(event.outcome)) {
          if (!projectionEligible
            || current.projectionStartedCount !== 1
            || current.projectionTerminals.length !== 0) {
            current.structurallyInvalid = true;
          }
          current.projectionTerminals.push(event);
        } else {
          current.structurallyInvalid = true;
        }
      } else if (event.phase === "finalization_reserve") {
        const attemptsComplete = current.attempts.length >= 1
          && current.attempts.every((attempt) => attempt.terminal);
        const standardComplete = current.standardStartedCount >= 1
          && current.standardStartedCount <= 2
          && current.standardAttempts.length === current.standardStartedCount
          && current.standardTerminals.length === current.standardStartedCount;
        const multiStandardResolutionComplete = current.standardStartedCount !== 2
          || (current.standardAttempts.every((attempt) => (
            attempt.terminal?.outcome === "completed"
          ))
            && current.standardTerminals.every((terminal) => terminal.outcome === "completed")
            && current.relaxedStartedCount === 0
            && current.relaxedSkipped.length === 2
            && current.relaxedSkipped.every((skipped) => (
              MULTI_STANDARD_SKIP_REASONS.has(skipped.reason)
            ))
            && current.projectionStartedCount === 0
            && current.projectionTerminals.length === 0
            && current.reserveProtectedCount === 0);
        const relaxedComplete = current.relaxedStartedCount === 0
          || (current.relaxedAttempts.length === 1
            && current.relaxedTerminals.length === 1
            && current.projectionStartedCount === 1
            && current.projectionTerminals.length === 1);
        const finalizationEligible = current.activeAttempts.length === 0
          && attemptsComplete
          && standardComplete
          && multiStandardResolutionComplete
          && relaxedComplete;
        if (event.outcome === "skipped" && event.reason === "reserve_protected") {
          current.reserveProtectedCount += 1;
          if (!finalizationEligible
            || current.relaxedStartedCount !== 0
            || current.finalizationStarted
            || current.standardStartedCount !== 1
            || current.reserveProtectedCount > current.standardStartedCount) {
            current.structurallyInvalid = true;
          }
        } else if (event.outcome === "started") {
          if (!finalizationEligible || current.finalizationStarted) {
            current.structurallyInvalid = true;
          }
          current.finalizationStarted = true;
        } else if (isFinalizationBoundary(event)) {
          const skippedWithoutEntry = event.outcome === "skipped"
            && event.reason === "reserve_not_entered";
          if (!finalizationEligible
            || (skippedWithoutEntry ? current.finalizationStarted : !current.finalizationStarted)) {
            current.structurallyInvalid = true;
          }
          current.boundary = event;
          episodes.push(current);
          current = null;
          continue;
        } else {
          current.structurallyInvalid = true;
        }
      } else {
        current.structurallyInvalid = true;
      }
    }
    if (current) episodes.push(current);
    for (const episode of episodes) {
      episode.standardCallCount = episode.standardStartedCount;
      episode.activeAttempt = episode.activeAttempts.length === 1
        ? episode.activeAttempts[0]
        : null;
      episode.standardTerminal = episode.standardTerminals.length === 1
        ? episode.standardTerminals[0]
        : episode.standardTerminals.at(-1) || null;
      episode.relaxedStarted = episode.relaxedStartedCount > 0;
      episode.relaxedTerminal = episode.relaxedTerminals[0]
        || (episode.relaxedSkipped.length === 1 ? episode.relaxedSkipped[0] : null);
      episode.projectionStarted = episode.projectionStartedCount > 0;
      episode.projectionTerminal = episode.projectionTerminals[0] || null;
      for (const attempt of episode.attempts) {
        attempt.complete = Boolean(attempt.terminal) && !attempt.multipleTerminals;
      }
      const cancellationSignalEvents = episode.events.filter((event) => (
        event.phase === "graph_worker"
        && (event.reason === "cancel_requested"
          || event.reason === "cancel_observed"
          || event.reason === "late_result"
          || (event.metrics.cancelRequested || 0) > 0
          || (event.metrics.cancelObserved || 0) > 0
          || (event.metrics.lateDiscardCount || 0) > 0)
      ));
      const requestedEvents = cancellationSignalEvents.filter((event) => (
        event.outcome === "aborted" && event.reason === "cancel_requested"
      ));
      const observedEvents = cancellationSignalEvents.filter((event) => (
        event.outcome === "aborted" && event.reason === "cancel_observed"
      ));
      const lateEvents = cancellationSignalEvents.filter((event) => (
        event.outcome === "late_discarded" && event.reason === "late_result"
      ));
      episode.cancelRequested = requestedEvents.reduce(
        (sum, event) => sum + (event.metrics.cancelRequested || 0),
        0,
      );
      episode.cancelObserved = observedEvents.reduce((sum, event) => (
        sum + ((event.metrics.cancelRequested || 0) > 0
          ? event.metrics.cancelObserved || 0
          : 0)
      ), 0);
      episode.lateDiscardCount = lateEvents.reduce((sum, event) => (
        sum + ((event.metrics.cancelRequested || 0) > 0
          ? event.metrics.lateDiscardCount || 0
          : 0)
      ), 0);
      episode.hasCancellationEvidence = cancellationSignalEvents.length > 0;
      const requestedEvent = requestedEvents[0];
      const observedEvent = observedEvents[0];
      const lateEvent = lateEvents[0];
      const requestedEventIndex = requestedEvent
        ? episode.events.indexOf(requestedEvent)
        : -1;
      episode.acceptedAfterCancelCount = requestedEventIndex < 0
        ? 0
        : episode.events.slice(requestedEventIndex + 1).reduce((sum, event) => (
          sum + (event.phase === "graph_worker"
            && (TERMINAL_OUTCOMES.has(event.outcome) || event.outcome === "late_discarded")
            && (event.metrics.acceptedCount || 0) > 0
            ? event.metrics.acceptedCount
            : 0)
        ), 0);
      const cancellationAttempt = episode.standardCallCount === 1
        && episode.attempts.length === 1 ? episode.attempts[0] : null;
      const cancellationWorkerStarts = cancellationAttempt?.events.filter((event) => (
        event.phase === "graph_worker" && event.outcome === "started"
      )) || [];
      const cancellationWorkerStart = cancellationWorkerStarts[0];
      episode.cancellationTopologyValid = episode.hasCancellationEvidence
        && episode.standardCallCount === 1
        && episode.attempts.length === 1
        && cancellationSignalEvents.length === 3
        && requestedEvents.length === 1
        && observedEvents.length === 1
        && lateEvents.length === 1
        && cancellationWorkerStarts.length === 1
        && cancellationAttempt.events.includes(requestedEvent)
        && cancellationAttempt.events.includes(observedEvent)
        && cancellationAttempt.events.includes(lateEvent)
        && cancellationAttempt.events.indexOf(cancellationWorkerStart)
          < cancellationAttempt.events.indexOf(requestedEvent)
        && cancellationAttempt.events.indexOf(requestedEvent)
          < cancellationAttempt.events.indexOf(cancellationAttempt.terminal)
        && cancellationAttempt.events.indexOf(requestedEvent)
          < cancellationAttempt.events.indexOf(observedEvent)
        && episode.events.indexOf(requestedEvent) < episode.events.indexOf(observedEvent)
        && episode.events.indexOf(observedEvent) < episode.events.indexOf(lateEvent)
        && (requestedEvent.metrics.cancelRequested || 0) > 0
        && (requestedEvent.metrics.acceptedCount || 0) === 0
        && (observedEvent.metrics.cancelRequested || 0) > 0
        && (observedEvent.metrics.cancelObserved || 0) > 0
        && (observedEvent.metrics.acceptedCount || 0) === 0
        && (lateEvent.metrics.cancelRequested || 0) > 0
        && (lateEvent.metrics.lateDiscardCount || 0) > 0
        && (lateEvent.metrics.acceptedCount || 0) === 0
        && episode.acceptedAfterCancelCount === 0;
      if (episode.hasCancellationEvidence && !episode.cancellationTopologyValid) {
        episode.structurallyInvalid = true;
      }
      episode.complete = Boolean(episode.boundary)
        && episode.activeAttempts.length === 0
        && !episode.structurallyInvalid
        && episode.standardCallCount >= 1
        && episode.standardCallCount <= 2
        && episode.standardAttempts.length === episode.standardCallCount
        && episode.standardTerminals.length === episode.standardCallCount
        && episode.standardAttempts.every((attempt) => (
          attempt.terminal?.outcome === "completed"
        ))
        && episode.standardTerminals.every((terminal) => terminal.outcome === "completed")
        && episode.relaxedStartedCount <= 1
        && episode.relaxedAttempts.length === episode.relaxedStartedCount
        && episode.relaxedTerminals.length === episode.relaxedStartedCount
        && episode.relaxedSkipped.length + episode.relaxedStartedCount
          <= episode.standardCallCount
        && (episode.standardCallCount !== 2
          || (episode.standardAttempts.every((attempt) => (
            attempt.terminal?.outcome === "completed"
          ))
            && episode.standardTerminals.every((terminal) => terminal.outcome === "completed")
            && episode.relaxedStartedCount === 0
            && episode.relaxedSkipped.length === 2
            && episode.relaxedSkipped.every((skipped) => (
              MULTI_STANDARD_SKIP_REASONS.has(skipped.reason)
            ))
            && episode.projectionStartedCount === 0
            && episode.projectionTerminals.length === 0
            && episode.reserveProtectedCount === 0))
        && episode.attempts.every((attempt) => attempt.complete)
        && (episode.relaxedStartedCount === 1
          ? episode.projectionStartedCount === 1
            && episode.projectionTerminals.length === 1
          : episode.projectionStartedCount === 0
            && episode.projectionTerminals.length === 0);
    }
    return { episodes, unscopedEvents, surfaceMismatchEvents, expectedSurface };
  };

  const deriveSuccessfulGraphEvidence = (attempt) => {
    const graphEvents = attempt.events.filter((event) => GRAPH_PHASES.has(event.phase));
    const phaseEvents = (phase) => graphEvents.filter((event) => event.phase === phase);
    const snapshots = phaseEvents("graph_snapshot");
    const preflights = phaseEvents("graph_preflight");
    const pprEvents = phaseEvents("ppr_solve");
    const worksets = phaseEvents("graph_workset");
    const workers = phaseEvents("graph_worker");
    const snapshotStart = snapshots.find((event) => event.outcome === "started");
    const snapshotComplete = snapshots.find((event) => (
      event.outcome === "completed" && Number.isFinite(event.metrics.durationMs)
    ));
    const preflightStart = preflights.find((event) => event.outcome === "started");
    const preflightTerminal = preflights.find((event) => (
      event.outcome === "completed"
      && Number.isFinite(event.metrics.durationMs)
    ));
    const pprStart = pprEvents.find((event) => event.outcome === "started");
    const pprAggregate = pprEvents.find((event) => (
      event.outcome === "completed" && Number.isFinite(event.metrics.durationMs)
    ));
    const pprSeedTerminals = pprEvents.filter((event) => (
      event !== pprStart && event !== pprAggregate
    ));
    const probeWorkset = worksets[0];
    const finalWorkset = worksets[1];
    const workerStart = workers.find((event) => event.outcome === "started");
    const workerComplete = workers.find((event) => (
      event.outcome === "completed"
      && (event.metrics.acceptedCount || 0) > 0
      && Number.isFinite(event.metrics.durationMs)
    ));
    const indexOf = (event) => event ? graphEvents.indexOf(event) : -1;
    const snapshotStartIndex = indexOf(snapshotStart);
    const snapshotCompleteIndex = indexOf(snapshotComplete);
    const preflightStartIndex = indexOf(preflightStart);
    const preflightTerminalIndex = indexOf(preflightTerminal);
    const pprStartIndex = indexOf(pprStart);
    const pprAggregateIndex = indexOf(pprAggregate);
    const probeWorksetIndex = indexOf(probeWorkset);
    const workerStartIndex = indexOf(workerStart);
    const workerCompleteIndex = indexOf(workerComplete);
    const finalWorksetIndex = indexOf(finalWorkset);
    const seedCount = pprAggregate?.metrics.seedCount;
    const validSeedCount = Number.isInteger(seedCount) && seedCount >= 1 && seedCount <= 3;
    const validPprSeeds = validSeedCount
      && pprSeedTerminals.length === seedCount
      && pprSeedTerminals.every((event) => (
        event.outcome === "completed"
        && event.metrics.seedCount === 1
        && Number.isFinite(event.metrics.iterationCount)
        && Number.isFinite(event.metrics.errorBound)
        && !Number.isFinite(event.metrics.durationMs)
        && indexOf(event) > pprStartIndex
        && indexOf(event) < pprAggregateIndex
      ));
    const complete = snapshots.length === 2
      && preflights.length === 2
      && worksets.length === 2
      && workers.length === 2
      && pprEvents.length === pprSeedTerminals.length + 2
      && preflightStart?.metrics.seedCount === seedCount
      && pprStart?.metrics.seedCount === seedCount
      && pprAggregate?.metrics.convergenceCount === seedCount
      && graphEvents[0] === snapshotStart
      && snapshotStartIndex < snapshotCompleteIndex
      && snapshotCompleteIndex < preflightStartIndex
      && preflightStartIndex < preflightTerminalIndex
      && preflightTerminalIndex < pprStartIndex
      && pprStartIndex < pprAggregateIndex
      && validPprSeeds
      && pprAggregateIndex < probeWorksetIndex
      && probeWorkset?.outcome === "completed"
      && Number.isFinite(probeWorkset.metrics.unionCount)
      && probeWorksetIndex < workerStartIndex
      && workerStartIndex < workerCompleteIndex
      && workerCompleteIndex < finalWorksetIndex
      && finalWorkset?.outcome === "completed"
      && Number.isFinite(finalWorkset.metrics.selectedCount)
      && graphEvents.at(-1) === finalWorkset
      && finalWorkset.elapsedMs >= snapshotStart.elapsedMs;
    if (!complete) return null;
    return {
      wallDurationMs: finalWorkset.elapsedMs - snapshotStart.elapsedMs,
      workerDurationMs: workerComplete.metrics.durationMs,
      batchCount: workerComplete.metrics.batchCount,
      chunkCount: workerComplete.metrics.chunkCount,
      queueWaitMs: workerComplete.metrics.queueWaitMs,
      rankedWorkerDurationMs: workerComplete.metrics.workerDurationMs,
      maxBatchDurationMs: workerComplete.metrics.maxBatchDurationMs,
    };
  };

  const summarizeRetrievalDiagnostics = (projection, stage) => {
    const phaseCounts = {};
    const outcomeCounts = {};
    const reasonCounts = {};
    const increment = (counts, key) => {
      counts[key] = (counts[key] || 0) + 1;
    };
    const summary = {
      eventCount: projection.events.length,
      phaseCounts,
      outcomeCounts,
      reasonCounts,
      cancelRequested: 0,
      cancelObserved: 0,
      lateDiscardCount: 0,
      deadlineCount: 0,
      acceptedCount: 0,
      acceptedAfterCancelCount: 0,
      measurementEpisodes: null,
      series: {
        memorySearchDurationMs: [],
        episodeWallDurationMs: [],
        graphWallDurationMs: [],
        graphWorkerDurationMs: [],
        finalizationRemainingMs: [],
        workerCompleted: {
          batchCount: [],
          chunkCount: [],
          queueWaitMs: [],
          workerDurationMs: [],
          maxBatchDurationMs: [],
        },
      },
    };
    for (const event of projection.events) {
      increment(phaseCounts, event.phase);
      increment(outcomeCounts, event.outcome);
      if (event.reason) increment(reasonCounts, event.reason);
      const cancelRequested = event.metrics.cancelRequested || 0;
      const cancelObserved = event.metrics.cancelObserved || 0;
      const lateDiscardCount = event.metrics.lateDiscardCount || 0;
      const acceptedCount = event.metrics.acceptedCount || 0;
      if (event.phase === "graph_worker"
        && event.outcome === "aborted"
        && event.reason === "cancel_requested") {
        summary.cancelRequested += cancelRequested;
      }
      if (event.phase === "graph_worker"
        && event.outcome === "aborted"
        && event.reason === "cancel_observed"
        && cancelRequested > 0) {
        summary.cancelObserved += cancelObserved;
      }
      if (event.phase === "graph_worker"
        && event.outcome === "late_discarded"
        && event.reason === "late_result"
        && cancelRequested > 0) {
        summary.lateDiscardCount += lateDiscardCount;
      }
      summary.acceptedCount += acceptedCount;
      if (event.outcome === "deadline" || (event.reason && DEADLINE_REASONS.has(event.reason))) {
        summary.deadlineCount += 1;
      }
    }
    const {
      episodes,
      unscopedEvents,
      surfaceMismatchEvents,
      expectedSurface,
    } = partitionMeasurementEpisodes(projection.events);
    summary.acceptedAfterCancelCount = episodes.reduce(
      (sum, episode) => sum + episode.acceptedAfterCancelCount,
      0,
    );
    const completeEpisodes = episodes.filter((episode) => episode.complete);
    const normalEpisodes = completeEpisodes.filter((episode) => (
      episode.standardCallCount === 1
      && episode.attempts.every((attempt) => attempt.terminal.outcome === "completed")
      && episode.standardTerminal.outcome === "completed"
      && (episode.relaxedStartedCount === 0
        || episode.relaxedTerminal.outcome === "completed")
      && (!episode.projectionTerminal
        || ["completed", "fallback"].includes(episode.projectionTerminal.outcome))
      && (episode.boundary.outcome === "completed"
        || (episode.boundary.outcome === "skipped"
          && episode.boundary.reason === "reserve_not_entered"))
      && Number.isFinite(episode.boundary.metrics.remainingMs)
      && episode.boundary.metrics.remainingMs > 0
      && !episode.hasCancellationEvidence
    ));
    const cancellationEpisodes = completeEpisodes.filter((episode) => episode.hasCancellationEvidence);
    const structurallyComplete = unscopedEvents.length === 0
      && episodes.every((episode) => episode.complete);
    const performanceStages = new Set([
      "standardPerformance", "retryPerformanceBatch1", "retryPerformanceBatch2",
    ]);
    let episodeStatus = "INCOMPLETE";
    let episodeReason = "measurement episode is still incomplete";
    if (performanceStages.has(stage)) {
      const retryBatchIndex = stage === "retryPerformanceBatch1" ? 0
        : stage === "retryPerformanceBatch2" ? 1 : null;
      const expectedPerformanceEpisodes = retryBatchIndex === null
        ? frozenDevicePlan?.diagnosticsEvidence.standardPerformanceEpisodeCount
        : frozenDevicePlan?.diagnosticsEvidence.retryPerformanceBatchEpisodeCounts[retryBatchIndex];
      const workloadShapeMatches = retryBatchIndex === null
        ? episodes.every((episode) => episode.standardCallCount === 1
          && episode.attempts.length === 1
          && !episode.projectionStarted
          && !episode.projectionTerminal
          && episode.attempts.every((attempt) => Boolean(deriveSuccessfulGraphEvidence(attempt))))
        : episodes.every((episode) => episode.standardCallCount === 1
          && episode.attempts.length === 2
          && episode.projectionStarted
          && episode.projectionTerminal?.outcome === "completed"
          && episode.attempts.every((attempt) => Boolean(deriveSuccessfulGraphEvidence(attempt))));
      if (surfaceMismatchEvents.length > 0) {
        episodeStatus = "INVALID";
        episodeReason = "performance evidence contains events outside the frozen Chat surface";
      } else if (!structurallyComplete || normalEpisodes.length !== episodes.length || !workloadShapeMatches) {
        episodeStatus = "INVALID";
        episodeReason = "performance evidence contains unscoped, incomplete, wrong-shape, or cancellation episodes";
      } else if (episodes.length > expectedPerformanceEpisodes) {
        episodeStatus = "INVALID";
        episodeReason = "performance evidence exceeds the frozen episode count";
      } else if (episodes.length === expectedPerformanceEpisodes) {
        episodeStatus = "VALID";
        episodeReason = "frozen performance episode count captured";
      }
    } else if (stage === "cancellationProbe") {
      const expectedCancellationEpisodes = frozenDevicePlan
        ? frozenDevicePlan.diagnosticsEvidence.cancellationProbeEpisodeCount
        : 1;
      if (surfaceMismatchEvents.length > 0) {
        episodeStatus = "INVALID";
        episodeReason = "cancellation evidence contains events outside the frozen Chat surface";
      } else if (unscopedEvents.length > 0 || episodes.length > expectedCancellationEpisodes
        || episodes.some((episode) => (
          !episode.complete
          || !episode.hasCancellationEvidence
          || !episode.cancellationTopologyValid
        ))) {
        episodeStatus = "INVALID";
        episodeReason = "cancellation probe invariants are incomplete or violated";
      } else if (episodes.length === expectedCancellationEpisodes && episodes[0].complete) {
        const probe = episodes[0];
        if (probe.cancellationTopologyValid
          && probe.cancelRequested > 0
          && probe.cancelObserved > 0
          && probe.lateDiscardCount > 0
          && probe.acceptedAfterCancelCount === 0) {
          episodeStatus = "VALID";
          episodeReason = "isolated cancellation probe episode captured";
        } else {
          episodeStatus = "INVALID";
          episodeReason = "cancellation probe invariants are incomplete or violated";
        }
      }
    }
    summary.measurementEpisodes = {
      stage,
      status: episodeStatus,
      reason: episodeReason,
      episodeCount: episodes.length,
      normalEpisodeCount: normalEpisodes.length,
      cancellationProbeEpisodeCount: cancellationEpisodes.length,
      unscopedEventCount: unscopedEvents.length,
      expectedSurface,
      surfaceMismatchEventCount: surfaceMismatchEvents.length,
    };
    if (performanceStages.has(stage)) {
      for (const episode of normalEpisodes) {
        const episodeStart = episode.events[0];
        const episodeTerminal = episode.relaxedStartedCount === 1
          ? episode.projectionTerminal
          : episode.standardTerminal;
        if (Number.isFinite(episodeStart?.elapsedMs)
          && Number.isFinite(episodeTerminal?.elapsedMs)
          && episodeTerminal.elapsedMs >= episodeStart.elapsedMs) {
          summary.series.episodeWallDurationMs.push(
            episodeTerminal.elapsedMs - episodeStart.elapsedMs,
          );
        }
        const attemptDurations = episode.attempts.map((attempt) => attempt.terminal.metrics.durationMs);
        if (attemptDurations.every(Number.isFinite)) {
          summary.series.memorySearchDurationMs.push(
            attemptDurations.reduce((sum, duration) => sum + duration, 0),
          );
        }
        const graphAttempts = episode.attempts.map(deriveSuccessfulGraphEvidence);
        if (graphAttempts.every(Boolean)) {
          summary.series.graphWallDurationMs.push(graphAttempts.reduce(
            (sum, graph) => sum + graph.wallDurationMs,
            0,
          ));
          summary.series.graphWorkerDurationMs.push(graphAttempts.reduce(
            (sum, graph) => sum + graph.workerDurationMs,
            0,
          ));
          const workerValues = {
            batchCount: graphAttempts.reduce((sum, graph) => sum + graph.batchCount, 0),
            chunkCount: graphAttempts.reduce((sum, graph) => sum + graph.chunkCount, 0),
            queueWaitMs: graphAttempts.reduce((sum, graph) => sum + graph.queueWaitMs, 0),
            workerDurationMs: graphAttempts.reduce(
              (sum, graph) => sum + graph.rankedWorkerDurationMs,
              0,
            ),
            maxBatchDurationMs: Math.max(...graphAttempts.map((graph) => graph.maxBatchDurationMs)),
          };
          for (const [key, value] of Object.entries(workerValues)) {
            if (Number.isFinite(value)) summary.series.workerCompleted[key].push(value);
          }
        }
        if (Number.isFinite(episode.boundary.metrics.remainingMs)) {
          summary.series.finalizationRemainingMs.push(episode.boundary.metrics.remainingMs);
        }
      }
    }
    return summary;
  };

  const mergeCounts = (left = {}, right = {}) => {
    const merged = { ...left };
    for (const [key, value] of Object.entries(right)) merged[key] = (merged[key] || 0) + value;
    return merged;
  };

  const buildCombinedDiagnosticsSummary = () => {
    const standardSummary = diagnosticsEvidenceProjections.standardPerformance
      ? summarizeRetrievalDiagnostics(
        diagnosticsEvidenceProjections.standardPerformance,
        "standardPerformance",
      )
      : null;
    const retryBatch1Summary = diagnosticsEvidenceProjections.retryPerformanceBatch1
      ? summarizeRetrievalDiagnostics(
        diagnosticsEvidenceProjections.retryPerformanceBatch1,
        "retryPerformanceBatch1",
      )
      : null;
    const retryBatch2Summary = diagnosticsEvidenceProjections.retryPerformanceBatch2
      ? summarizeRetrievalDiagnostics(
        diagnosticsEvidenceProjections.retryPerformanceBatch2,
        "retryPerformanceBatch2",
      )
      : null;
    const cancellationSummary = diagnosticsEvidenceProjections.cancellationProbe
      ? summarizeRetrievalDiagnostics(diagnosticsEvidenceProjections.cancellationProbe, "cancellationProbe")
      : null;
    const summaries = [standardSummary, retryBatch1Summary, retryBatch2Summary, cancellationSummary]
      .filter(Boolean);
    if (summaries.length === 0) return null;
    const emptySeries = {
      memorySearchDurationMs: [],
      episodeWallDurationMs: [],
      graphWallDurationMs: [],
      graphWorkerDurationMs: [],
      finalizationRemainingMs: [],
      workerCompleted: {
        batchCount: [], chunkCount: [], queueWaitMs: [], workerDurationMs: [], maxBatchDurationMs: [],
      },
    };
    const mergeSeries = (left = emptySeries, right = emptySeries) => ({
      memorySearchDurationMs: [...left.memorySearchDurationMs, ...right.memorySearchDurationMs],
      episodeWallDurationMs: [...left.episodeWallDurationMs, ...right.episodeWallDurationMs],
      graphWallDurationMs: [...left.graphWallDurationMs, ...right.graphWallDurationMs],
      graphWorkerDurationMs: [...left.graphWorkerDurationMs, ...right.graphWorkerDurationMs],
      finalizationRemainingMs: [
        ...left.finalizationRemainingMs,
        ...right.finalizationRemainingMs,
      ],
      workerCompleted: Object.fromEntries(Object.keys(emptySeries.workerCompleted).map((key) => [
        key,
        [...left.workerCompleted[key], ...right.workerCompleted[key]],
      ])),
    });
    const retrySeries = mergeSeries(retryBatch1Summary?.series, retryBatch2Summary?.series);
    const retryEpisodeCount = (retryBatch1Summary?.measurementEpisodes.episodeCount || 0)
      + (retryBatch2Summary?.measurementEpisodes.episodeCount || 0);
    const retryNormalEpisodeCount = (retryBatch1Summary?.measurementEpisodes.normalEpisodeCount || 0)
      + (retryBatch2Summary?.measurementEpisodes.normalEpisodeCount || 0);
    const retryStatuses = [
      retryBatch1Summary?.measurementEpisodes.status,
      retryBatch2Summary?.measurementEpisodes.status,
    ];
    const retryExpected = frozenDevicePlan?.diagnosticsEvidence.retryPerformanceEpisodeCount;
    const retryStatus = retryStatuses.every((status) => status === "VALID")
      && retryEpisodeCount === retryExpected
      ? "VALID"
      : retryStatuses.some((status) => status === "INVALID") || retryEpisodeCount > retryExpected
        ? "INVALID"
        : "INCOMPLETE";
    const mergeAllCounts = (field) => summaries.reduce(
      (counts, summary) => mergeCounts(counts, summary[field]),
      {},
    );
    return {
      eventCount: summaries.reduce((sum, summary) => sum + summary.eventCount, 0),
      phaseCounts: mergeAllCounts("phaseCounts"),
      outcomeCounts: mergeAllCounts("outcomeCounts"),
      reasonCounts: mergeAllCounts("reasonCounts"),
      cancelRequested: cancellationSummary?.cancelRequested || 0,
      cancelObserved: cancellationSummary?.cancelObserved || 0,
      lateDiscardCount: cancellationSummary?.lateDiscardCount || 0,
      deadlineCount: summaries.reduce((sum, summary) => sum + summary.deadlineCount, 0),
      acceptedCount: summaries.reduce((sum, summary) => sum + summary.acceptedCount, 0),
      acceptedAfterCancelCount: cancellationSummary?.acceptedAfterCancelCount || 0,
      measurementEpisodes: {
        standardPerformance: standardSummary?.measurementEpisodes || null,
        retryPerformance: {
          stage: "retryPerformance",
          status: retryStatus,
          reason: retryStatus === "VALID"
            ? "both frozen retry-performance batches captured"
            : retryStatus === "INVALID"
              ? "retry-performance batch evidence is invalid"
              : "both frozen retry-performance batches are required",
          episodeCount: retryEpisodeCount,
          normalEpisodeCount: retryNormalEpisodeCount,
        },
        retryPerformanceBatches: [
          retryBatch1Summary?.measurementEpisodes || null,
          retryBatch2Summary?.measurementEpisodes || null,
        ],
        cancellationProbe: cancellationSummary?.measurementEpisodes || null,
      },
      series: standardSummary?.series || emptySeries,
      retrySeries,
    };
  };

  const bindDiagnosticsDerivedMetrics = (summary) => {
    if (!frozenDevicePlan) return;
    const hasStandardEvidence = Boolean(diagnosticsEvidenceProjections.standardPerformance);
    const hasRetryEvidence = Boolean(diagnosticsEvidenceProjections.retryPerformanceBatch1)
      || Boolean(diagnosticsEvidenceProjections.retryPerformanceBatch2);
    const hasCompletePerformanceEvidence = hasStandardEvidence
      && Boolean(diagnosticsEvidenceProjections.retryPerformanceBatch1)
      && Boolean(diagnosticsEvidenceProjections.retryPerformanceBatch2);
    const hasCancellationEvidence = Boolean(diagnosticsEvidenceProjections.cancellationProbe);
    const hasCompleteEvidence = hasCompletePerformanceEvidence && hasCancellationEvidence;
    const evidenceByMetric = {
      "retrieval.totalDurationMs": hasStandardEvidence ? summary.series.memorySearchDurationMs : [],
      "retrieval.graphDurationMs": hasStandardEvidence ? summary.series.graphWallDurationMs : [],
      "retrieval.retryTotalDurationMs": hasRetryEvidence
        ? summary.retrySeries.episodeWallDurationMs : [],
      "retrieval.retryGraphDurationMs": hasRetryEvidence
        ? summary.retrySeries.graphWallDurationMs : [],
      "retrieval.retryGraphWorkerQueueWaitMs": hasRetryEvidence
        ? summary.retrySeries.workerCompleted.queueWaitMs : [],
      "retrieval.retryGraphWorkerMaxBatchDurationMs": hasRetryEvidence
        ? summary.retrySeries.workerCompleted.maxBatchDurationMs : [],
      "retrieval.graphWorkerQueueWaitMs": hasStandardEvidence
        ? summary.series.workerCompleted.queueWaitMs : [],
      "retrieval.graphWorkerMaxBatchDurationMs": hasStandardEvidence
        ? summary.series.workerCompleted.maxBatchDurationMs : [],
      "retrieval.finalizationReserveMs": hasStandardEvidence
        ? summary.series.finalizationRemainingMs : [],
      "retrieval.retryFinalizationReserveMs": hasRetryEvidence
        ? summary.retrySeries.finalizationRemainingMs : [],
      "retrieval.deadlineExceededCount": hasCompleteEvidence ? [summary.deadlineCount] : [],
      "retrieval.cancelRequestedCount": hasCancellationEvidence ? [summary.cancelRequested] : [],
      "retrieval.cancelObservedCount": hasCancellationEvidence ? [summary.cancelObserved] : [],
      "retrieval.acceptedAfterCancelCount": hasCancellationEvidence
        ? [summary.acceptedAfterCancelCount] : [],
      "retrieval.lateDiscardCount": hasCancellationEvidence ? [summary.lateDiscardCount] : [],
      "retrieval.acceptedCount": hasCompleteEvidence ? [summary.acceptedCount] : [],
    };
    for (const [id, samples] of Object.entries(evidenceByMetric)) {
      applyDeviceMetricEvidence(id, { method: "measured", samples }, "retrieval-diagnostics-staged");
    }
  };

  const applyDiagnosticsProjection = (stage, projection, terminal = false) => {
    diagnosticsEvidenceProjections[stage] = projection;
    result.deviceMeasurement.diagnostics = {
      standardPerformance: diagnosticsEvidenceProjections.standardPerformance,
      retryPerformanceBatches: [
        diagnosticsEvidenceProjections.retryPerformanceBatch1,
        diagnosticsEvidenceProjections.retryPerformanceBatch2,
      ],
      cancellationProbe: diagnosticsEvidenceProjections.cancellationProbe,
    };
    const summary = buildCombinedDiagnosticsSummary();
    result.deviceMeasurement.diagnosticsSummary = summary;
    bindDiagnosticsDerivedMetrics(summary);
    const stageSummary = stage === "retryPerformanceBatch1"
      ? summary.measurementEpisodes.retryPerformanceBatches[0]
      : stage === "retryPerformanceBatch2"
        ? summary.measurementEpisodes.retryPerformanceBatches[1]
        : summary.measurementEpisodes[stage];
    if (terminal && stageSummary?.status !== "VALID") {
      markDiagnosticsBlocked(
        stageSummary?.reason || "diagnostics measurement episode classification is invalid",
        "Retrieval diagnostics measurement episodes are isolated and complete",
      );
    }
  };

  const enqueueDiagnosticsOperation = (operation) => {
    const queued = diagnosticsOperationQueue.then(operation);
    diagnosticsOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const markDiagnosticsBlocked = (reason, checkName) => {
    diagnosticsEvidenceBlocked = true;
    result.deviceMeasurement.diagnosticsGate = {
      status: "BLOCKED",
      reason,
      schemaVersion: diagnosticsSessionIdentity?.schemaVersion ?? null,
      capacity: diagnosticsSessionIdentity?.capacity ?? null,
    };
    record(checkName, "BLOCKED", reason, { blocking: Boolean(frozenDevicePlan) });
  };

  let diagnosticsDropBlockRecorded = false;
  const blockDroppedDiagnosticEvents = (projection) => {
    if (projection.droppedEventCount < 1 || diagnosticsDropBlockRecorded) return;
    diagnosticsDropBlockRecorded = true;
    markDiagnosticsBlocked(
      "diagnostics event capacity was exceeded",
      "Retrieval diagnostics event history is complete",
    );
  };

  const normalizeDiagnosticsIdentity = (identity) => {
    const expectedSchemaVersion = frozenDevicePlan?.diagnosticsEvidence.schemaVersion
      ?? RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION;
    if (!identity || identity.schemaVersion !== expectedSchemaVersion
      || typeof identity.sessionId !== "string"
      || identity.sessionId.length === 0 || typeof identity.startedAt !== "string"
      || identity.startedAt.length === 0 || !Number.isInteger(identity.capacity)
      || identity.capacity !== MIN_DIAGNOSTICS_SESSION_CAPACITY) {
      throw new Error("Invalid diagnostics session identity.");
    }
    return {
      schemaVersion: identity.schemaVersion,
      sessionId: identity.sessionId,
      startedAt: identity.startedAt,
      capacity: identity.capacity,
    };
  };

  const startDiagnosticsSession = async (stage, checkName) => {
    if (!diagnosticsSeamAvailable) {
      markDiagnosticsBlocked(
        "plugin build does not expose the retrieval diagnostics session seam",
        checkName,
      );
      return false;
    }
    try {
      diagnosticsSessionIdentity = normalizeDiagnosticsIdentity(
        await plugin.startRetrievalDiagnostics(),
      );
      diagnosticsSessionStage = stage;
      diagnosticsStopAttempted = false;
      stoppedDiagnosticsProjection = null;
      if (!diagnosticsEvidenceBlocked) {
        result.deviceMeasurement.diagnosticsGate = {
          status: "BLOCKED",
          reason: stage === "preFreeze"
            ? "pre-freeze diagnostics session is active and will be discarded"
            : `${stage} diagnostics session is active and must be stopped`,
          schemaVersion: diagnosticsSessionIdentity.schemaVersion,
          capacity: diagnosticsSessionIdentity.capacity,
        };
      }
      record(checkName, "PASS");
      return true;
    } catch {
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
      markDiagnosticsBlocked("plugin diagnostics session start failed", checkName);
      return false;
    }
  };

  const restartDiagnosticsForFrozenPlan = async () => {
    const previousIdentity = diagnosticsSessionIdentity;
    let discardFailed = false;
    if (previousIdentity) {
      try {
        const discarded = await plugin.stopRetrievalDiagnostics(previousIdentity.sessionId);
        if (discarded?.sessionId !== previousIdentity.sessionId
          || discarded?.startedAt !== previousIdentity.startedAt
          || discarded?.schemaVersion !== previousIdentity.schemaVersion
          || discarded?.capacity !== previousIdentity.capacity) {
          throw new Error("Retrieval diagnostics session identity changed.");
        }
      } catch {
        discardFailed = true;
      }
    }
    diagnosticsSessionIdentity = null;
    diagnosticsSessionStage = null;
    stoppedDiagnosticsProjection = null;
    diagnosticsStopAttempted = false;
    diagnosticsDropBlockRecorded = false;
    diagnosticsEvidenceBlocked = false;
    rankingEvidenceCursor = 0;
    performanceQualificationCursor = 0;
    for (const stage of Object.keys(performanceStageCursors)) {
      performanceStageCursors[stage] = 0;
    }
    diagnosticsEvidenceProjections.standardPerformance = null;
    diagnosticsEvidenceProjections.retryPerformanceBatch1 = null;
    diagnosticsEvidenceProjections.retryPerformanceBatch2 = null;
    diagnosticsEvidenceProjections.cancellationProbe = null;
    result.deviceMeasurement.diagnostics = {
      standardPerformance: null,
      retryPerformanceBatches: [null, null],
      cancellationProbe: null,
    };
    result.deviceMeasurement.diagnosticsSummary = null;
    result.deviceMeasurement.diagnosticsGate = {
      status: "BLOCKED",
      reason: "post-freeze diagnostics session is unavailable",
      schemaVersion: null,
      capacity: null,
    };
    if (discardFailed) {
      markDiagnosticsBlocked(
        "pre-freeze diagnostics session could not be discarded",
        "Pre-freeze retrieval diagnostics session is discarded",
      );
    } else {
      record("Pre-freeze retrieval diagnostics session is discarded", "PASS");
    }
    result.deviceMeasurement.diagnosticsGate = {
      status: "BLOCKED",
      reason: "post-freeze standard-performance diagnostics session is active and must be measured",
      schemaVersion: null,
      capacity: null,
    };
    await startDiagnosticsSession(
      "standardPerformance",
      "Post-freeze standard-performance diagnostics session is active",
    );
  };

  const captureRetrievalDiagnosticsImpl = async () => {
    if (stoppedDiagnosticsProjection) return clone(stoppedDiagnosticsProjection);
    if (!diagnosticsSessionIdentity) return null;
    try {
      const snapshot = await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId);
      const projection = projectBoundRetrievalDiagnostics(snapshot, diagnosticsSessionIdentity);
      if (!frozenDevicePlan || diagnosticsSessionStage === "preFreeze") return clone(projection);
      applyDiagnosticsProjection(diagnosticsSessionStage, projection);
      blockDroppedDiagnosticEvents(projection);
      await writeResult();
      return clone(projection);
    } catch {
      markDiagnosticsBlocked(
        "plugin diagnostics capture failed",
        "Retrieval diagnostics snapshot can be captured",
      );
      await writeResult();
      return null;
    }
  };

  const captureRetrievalDiagnostics = () => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      return captureRetrievalDiagnosticsImpl();
    });
  };

  let diagnosticsStopAttempted = false;
  const updateDiagnosticsGate = () => {
    if (diagnosticsEvidenceBlocked) return;
    const standardStatus = result.deviceMeasurement.diagnosticsSummary
      ?.measurementEpisodes?.standardPerformance?.status;
    const retryStatus = result.deviceMeasurement.diagnosticsSummary
      ?.measurementEpisodes?.retryPerformance?.status;
    const cancellationStatus = result.deviceMeasurement.diagnosticsSummary
      ?.measurementEpisodes?.cancellationProbe?.status;
    const complete = diagnosticsEvidenceProjections.standardPerformance
      && diagnosticsEvidenceProjections.retryPerformanceBatch1
      && diagnosticsEvidenceProjections.retryPerformanceBatch2
      && diagnosticsEvidenceProjections.cancellationProbe
      && standardStatus === "VALID"
      && retryStatus === "VALID"
      && cancellationStatus === "VALID";
    const reference = diagnosticsEvidenceProjections.cancellationProbe
      || diagnosticsEvidenceProjections.retryPerformanceBatch2
      || diagnosticsEvidenceProjections.retryPerformanceBatch1
      || diagnosticsEvidenceProjections.standardPerformance;
    result.deviceMeasurement.diagnosticsGate = {
      status: complete ? "PASS" : "BLOCKED",
      reason: complete
        ? "standard, retry, and cancellation diagnostics sessions stopped and captured"
        : "standard, two-batch retry, and isolated cancellation diagnostics evidence are required",
      schemaVersion: reference?.schemaVersion ?? null,
      capacity: reference?.capacity ?? null,
    };
  };

  const stopRetrievalDiagnosticsImpl = async () => {
    if (stoppedDiagnosticsProjection) return clone(stoppedDiagnosticsProjection);
    if (!diagnosticsSessionIdentity || diagnosticsStopAttempted) return null;
    diagnosticsStopAttempted = true;
    const stoppedStage = diagnosticsSessionStage;
    const measurementSession = Boolean(frozenDevicePlan)
      && [
        "standardPerformance", "retryPerformanceBatch1", "retryPerformanceBatch2",
        "cancellationProbe",
      ].includes(stoppedStage);
    try {
      const snapshot = await plugin.stopRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId);
      const projection = projectBoundRetrievalDiagnostics(snapshot, diagnosticsSessionIdentity);
      if (!measurementSession) {
        stoppedDiagnosticsProjection = projection;
        diagnosticsSessionIdentity = null;
        diagnosticsSessionStage = null;
        result.deviceMeasurement.diagnosticsGate = {
          status: "BLOCKED",
          reason: "device measurement plan was not frozen; pre-freeze diagnostics were discarded",
          schemaVersion: projection.schemaVersion,
          capacity: projection.capacity,
        };
        record("Pre-freeze retrieval diagnostics session is discarded", "PASS", "", { blocking: false });
        await writeResult();
        return clone(projection);
      }
      applyDiagnosticsProjection(stoppedStage, projection, true);
      blockDroppedDiagnosticEvents(projection);
      stoppedDiagnosticsProjection = projection;
      record(`${stoppedStage} retrieval diagnostics session is stopped and captured`, "PASS");
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
      updateDiagnosticsGate();
      await writeResult();
      return clone(projection);
    } catch {
      markDiagnosticsBlocked(
        "plugin diagnostics stop failed",
        "Retrieval diagnostics session is stopped and captured",
      );
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
      await writeResult();
      return null;
    }
  };

  const stopRetrievalDiagnostics = () => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      return stopRetrievalDiagnosticsImpl();
    });
  };

  const beginCancellationProbeTransition = (...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      const fail = async (message) => {
        await invalidatePerformanceWorkload({ stage: "cancellationProbe" });
        throw new Error(message);
      };
      if (unexpectedArguments.length !== 0) {
        return fail("beginCancellationProbe does not accept arguments.");
      }
      if (!frozenDevicePlan) {
        return fail("Freeze the device measurement plan before the cancellation probe.");
      }
      if (diagnosticsSessionStage === "cancellationProbe"
        || diagnosticsEvidenceProjections.cancellationProbe) {
        return fail("The cancellation probe was already requested for this workload.");
      }
      if (result.deviceMeasurement.runtimeEnvelope.workloadCoverageStatus !== "PASS") {
        return fail("Stop a workload-bound runtime envelope before the cancellation probe.");
      }
      await performanceEvidenceOperationQueue;
      const binding = result.deviceMeasurement.workloadBinding;
      const next = performanceWorkloadSequence[binding.boundEpisodeCount];
      const priorStagesPass = [
        "standardPerformance", "retryPerformanceBatch1", "retryPerformanceBatch2",
      ].every((stage) => binding.stages[stage].status === "PASS");
      if (binding.status === "INVALID"
        || !next
        || next.stage !== "cancellationProbe"
        || !priorStagesPass
        || diagnosticsSessionStage !== "retryPerformanceBatch2"
        || !await performanceStageIsFullyBound("retryPerformanceBatch2")) {
        await invalidatePerformanceWorkload({ stage: "cancellationProbe" });
        throw new Error("Cancellation probe must follow the exact bound standard and retry workload.");
      }
      if (diagnosticsSessionStage === "retryPerformanceBatch2") {
        await stopRetrievalDiagnosticsImpl();
      }
      const standardStatus = result.deviceMeasurement.diagnosticsSummary
        ?.measurementEpisodes?.standardPerformance?.status;
      const retryStatus = result.deviceMeasurement.diagnosticsSummary
        ?.measurementEpisodes?.retryPerformance?.status;
      if (standardStatus !== "VALID" || retryStatus !== "VALID") {
        return fail("Standard and retry diagnostics must contain their exact frozen episode counts.");
      }
      await startDiagnosticsSession(
        "cancellationProbe",
        "Isolated cancellation-probe diagnostics session is active",
      );
      if (!diagnosticsSessionIdentity || diagnosticsSessionStage !== "cancellationProbe") {
        throw new Error("Cancellation-probe diagnostics session could not be started.");
      }
      performanceStageCursors.cancellationProbe = 0;
      try {
        const armed = await plugin.armRetrievalCancellationProbe(
          diagnosticsSessionIdentity.sessionId,
        );
        if (armed?.sessionId !== diagnosticsSessionIdentity.sessionId || armed?.armed !== true) {
          throw new Error("Invalid cancellation-probe arm receipt.");
        }
        record("The next dispatched Chat graph Worker cancellation probe is armed", "PASS");
      } catch {
        markDiagnosticsBlocked(
          "plugin cancellation-probe arm failed",
          "The next dispatched Chat graph Worker cancellation probe is armed",
        );
        await writeResult();
        throw new Error("The diagnostics-only cancellation probe could not be armed.");
      }
      await writeResult();
      return clone(result.deviceMeasurement);
    });
  };

  const startRuntimeEnvelope = (...unexpectedArguments) => (
    enqueuePerformanceTransitionOperation(
      () => startRuntimeEnvelopeTransition(...unexpectedArguments),
    )
  );
  const stopRuntimeEnvelope = (...unexpectedArguments) => (
    enqueuePerformanceTransitionOperation(
      () => stopRuntimeEnvelopeTransition(...unexpectedArguments),
    )
  );
  const beginRetryPerformance = (...unexpectedArguments) => (
    enqueuePerformanceTransitionOperation(
      () => beginRetryPerformanceTransition(...unexpectedArguments),
    )
  );
  const continueRetryPerformance = (...unexpectedArguments) => (
    enqueuePerformanceTransitionOperation(
      () => continueRetryPerformanceTransition(...unexpectedArguments),
    )
  );
  const beginCancellationProbe = (...unexpectedArguments) => (
    enqueuePerformanceTransitionOperation(
      () => beginCancellationProbeTransition(...unexpectedArguments),
    )
  );

  const recordDiagnosticsSnapshot = async (snapshot) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording diagnostics.");
    const projection = projectRetrievalDiagnostics(snapshot);
    // Projection-only test seam: authoritative receipt evidence always comes
    // from the plugin-owned post-freeze diagnostics session.
    return clone(projection);
  };

  const observeMeasurementSettings = () => {
    const currentPlugin = app.plugins.plugins[PLUGIN_ID];
    if (!currentPlugin
      || settingsFingerprint !== fingerprintSettings(currentPlugin)) {
      settingsChangedDuringRun = true;
    }
    return !settingsChangedDuringRun;
  };

  const measurementSettingsAreStable = () => observeMeasurementSettings();

  const requireMeasurementSettingsStable = () => {
    if (!measurementSettingsAreStable()) {
      throw new Error(
        "Retrieval, Boundary, provider, or selected reranker settings changed during this smoke run.",
      );
    }
  };

  const installDiagnosticsSettingsGuard = (currentPlugin) => {
    const controller = currentPlugin?.retrievalDiagnostics;
    if (!controller || typeof controller.recordFor !== "function") return false;
    const originalRecordFor = controller.recordFor;
    const originalOwnDescriptor = Object.getOwnPropertyDescriptor(controller, "recordFor");
    const guardedRecordFor = function (...args) {
      observeMeasurementSettings();
      return originalRecordFor.apply(this, args);
    };
    try {
      controller.recordFor = guardedRecordFor;
    } catch {
      return false;
    }
    if (controller.recordFor !== guardedRecordFor) return false;
    uninstallDiagnosticsSettingsGuard = () => {
      if (controller.recordFor !== guardedRecordFor) return;
      if (originalOwnDescriptor) {
        Object.defineProperty(controller, "recordFor", originalOwnDescriptor);
      } else {
        delete controller.recordFor;
      }
    };
    return true;
  };

  const isOpaqueOrExcludedPath = (path) => (
    OPAQUE_FIXTURES.includes(path)
    || path.startsWith("retrieval-smoke/excluded/")
    || path.includes(OPAQUE_SENTINEL)
  );

  const updateRerankerMetrics = () => {
    const entries = REQUIRED_RANKING_CASES.map((id) => rankingCases[id]);
    const completed = entries.filter((entry) => entry.status !== "PENDING");
    const recalled = completed.filter((entry) => entry.relevantRank !== null).length;
    const reciprocalRankTotal = completed.reduce((sum, entry) => sum + entry.reciprocalRank, 0);
    result.rerankerMetrics = {
      completed: completed.length,
      required: REQUIRED_RANKING_CASES.length,
      recallAt8: Number((recalled / REQUIRED_RANKING_CASES.length).toFixed(6)),
      mrr: Number((reciprocalRankTotal / REQUIRED_RANKING_CASES.length).toFixed(6)),
      forbiddenHitCount: completed.reduce((sum, entry) => sum + entry.forbiddenHitCount, 0),
    };
  };

  const samePathSet = (left, right) => (
    left.size === right.size && [...left].every((path) => right.has(path))
  );

  const canonicalPathList = (values, readPath, evidenceName) => {
    if (!Array.isArray(values)) {
      throw new Error(`Canonical Chat retrieval ${evidenceName} is unavailable; leave the case PENDING.`);
    }
    return values.map((value) => {
      const rawPath = readPath(value);
      if (typeof rawPath !== "string" || !rawPath.trim()) {
        throw new Error(`Canonical Chat retrieval ${evidenceName} contains a non-string path; leave the case PENDING.`);
      }
      const canonicalPath = normalizeRankedPath(rawPath);
      if (!canonicalPath) {
        throw new Error(`Canonical Chat retrieval ${evidenceName} contains an invalid path; leave the case PENDING.`);
      }
      return canonicalPath;
    });
  };

  const readLatestCanonicalMemoryProjection = (expectedPrompt, options = {}) => {
    const requireFreshChat = options.requireFreshChat === true;
    const expectedRunId = typeof options.expectedRunId === "string"
      ? options.expectedRunId
      : null;
    const workspace = app?.workspace;
    if (!workspace || typeof workspace.getLeavesOfType !== "function") {
      throw new Error("Canonical Chat retrieval view is unavailable; leave the case PENDING.");
    }
    const views = [...new Set(
      workspace.getLeavesOfType(CHAT_VIEW_TYPE)
        .map((leaf) => leaf?.view)
        .filter(Boolean),
    )];
    const matches = views.flatMap((view) => {
      const history = view?.chatHistory;
      if (!Array.isArray(history)
        || history.length < 2
        || (requireFreshChat && history.length !== 2)) return [];
      const user = history.at(-2);
      const assistant = history.at(-1);
      return user?.role === "user"
        && user.content === expectedPrompt
        && assistant?.role === "assistant"
        && (!expectedRunId || assistant?.canonicalTurn?.runId === expectedRunId)
        ? [{ view, assistant }]
        : [];
    });
    if (matches.length !== 1) {
      throw new Error("Expected exactly one current Chat view ending with the exact requested prompt; leave the case PENDING.");
    }

    const { view, assistant } = matches[0];
    if (view.isStreaming !== false) {
      throw new Error("The exact Chat retrieval turn is still streaming or its live state is unavailable; leave the case PENDING.");
    }
    const canonicalTurn = assistant.canonicalTurn;
    if (!canonicalTurn
      || canonicalTurn.status !== "completed"
      || typeof canonicalTurn.runId !== "string"
      || !canonicalTurn.runId.trim()
      || canonicalTurn.runId.startsWith("rehydrated:")
      || !Array.isArray(canonicalTurn.messages)) {
      throw new Error("The exact Chat retrieval turn is not a live completed canonical turn; leave the case PENDING.");
    }
    const canonicalUsers = canonicalTurn.messages.filter((message) => message?.role === "user");
    if (canonicalUsers.length !== 1 || canonicalUsers[0].content !== expectedPrompt) {
      throw new Error("The canonical Chat retrieval transcript does not contain the exact unique prompt; leave the case PENDING.");
    }
    if (canonicalTurn.messages.at(-1)?.role !== "assistant") {
      throw new Error("The canonical Chat retrieval transcript has no final assistant message; leave the case PENDING.");
    }
    const canonicalAssistants = canonicalTurn.messages.filter((message) => (
      message?.role === "assistant"
    ));

    const memoryToolResults = canonicalTurn.messages.filter((message) => (
      message?.role === "toolResult" && message.toolName === "search_memory"
    ));
    const successfulMemoryToolResults = memoryToolResults.filter((message) => (
      message.isError === false && message.content?.metadata?.outcome === "success"
    ));
    if (memoryToolResults.length !== 1 || successfulMemoryToolResults.length !== 1) {
      throw new Error("Expected exactly one successful canonical search_memory tool result; leave the case PENDING.");
    }

    const memoryToolResult = successfulMemoryToolResults[0];
    if (requireFreshChat) {
      const allToolResults = canonicalTurn.messages.filter((message) => (
        message?.role === "toolResult"
      ));
      const toolCallParts = canonicalAssistants.flatMap((message) => (
        Array.isArray(message.content)
          ? message.content.filter((part) => part?.type === "toolCall")
          : []
      ));
      const toolCallAssistant = canonicalAssistants[0];
      const finalAssistant = canonicalAssistants[1];
      const searchMemoryCall = toolCallParts[0];
      if (canonicalTurn.messages[0] !== canonicalUsers[0]
        || canonicalTurn.messages.length !== 4
        || canonicalAssistants.length !== 2
        || canonicalTurn.messages.at(-1) !== finalAssistant
        || allToolResults.length !== 1
        || toolCallParts.length !== 1
        || !Array.isArray(toolCallAssistant?.content)
        || !toolCallAssistant.content.includes(searchMemoryCall)
        || searchMemoryCall?.name !== "search_memory"
        || typeof searchMemoryCall.id !== "string"
        || searchMemoryCall.id !== memoryToolResult.toolCallId
        || canonicalTurn.messages.indexOf(toolCallAssistant)
          >= canonicalTurn.messages.indexOf(memoryToolResult)
        || canonicalTurn.messages.indexOf(memoryToolResult)
          >= canonicalTurn.messages.indexOf(finalAssistant)) {
        throw new Error(
          "The fresh Chat transcript must contain one user, one search_memory tool-call/result pair, and one final assistant.",
        );
      }
    }
    const selectedMemoryItems = (memoryToolResult.content?.contextUsed ?? []).filter((item) => (
      item?.category === "memory" && item.label === "Selected Memory"
    ));
    if (selectedMemoryItems.length !== 1) {
      throw new Error("Expected exactly one canonical Selected Memory projection; leave the case PENDING.");
    }
    const selectedPaths = canonicalPathList(
      selectedMemoryItems[0].sources,
      (source) => source?.path,
      "Selected Memory sources",
    );
    if (selectedPaths.length === 0) {
      throw new Error("Canonical Selected Memory sources are empty; leave the case PENDING.");
    }

    const sourceRecords = memoryToolResult.content?.sourceRecords;
    if (!Array.isArray(sourceRecords)) {
      throw new Error("Canonical Memory source records are unavailable; leave the case PENDING.");
    }
    const memoryRecordPaths = canonicalPathList(
      sourceRecords.filter((record) => (
        record?.kind === "memory-reference" && record.sourceBoundary === "memory"
      )),
      (record) => record?.path,
      "Memory source records",
    );
    const allowedPaths = canonicalPathList(
      assistant.memoryMetadata?.allowedMemorySourcePaths,
      (path) => path,
      "assistant Memory allowlist",
    );
    const selectedSet = new Set(selectedPaths);
    const sourceRecordSet = new Set(memoryRecordPaths);
    const allowedSet = new Set(allowedPaths);
    if (!samePathSet(selectedSet, sourceRecordSet) || !samePathSet(selectedSet, allowedSet)) {
      throw new Error("Canonical Selected Memory, source-record, and assistant allowlist sets disagree; leave the case PENDING.");
    }

    return {
      canonicalRunId: canonicalTurn.runId,
      finalPaths: selectedPaths,
      orderedSourcePaths: memoryRecordPaths,
      finalMetadata: clone(memoryToolResult.content?.metadata || {}),
      sourceBinding: {
        evidenceSource: "sidellm-view.chatHistory",
        exactPromptMatched: true,
        turnStatus: canonicalTurn.status,
        successfulSearchMemoryToolResultCount: successfulMemoryToolResults.length,
        selectedMemorySourceCount: selectedPaths.length,
        memorySourceRecordPathCount: sourceRecordSet.size,
        allowedMemorySourcePathCount: allowedSet.size,
        sourceSetsMatch: true,
      },
    };
  };

  const bindCanonicalRunToEpisode = async (canonicalProjection, episode) => {
    const opaqueRunCorrelationSha256 = await digest(
      `retrieval-diagnostics-run\u0000${canonicalProjection.canonicalRunId}`,
    );
    if (episode && episode.runId !== canonicalProjection.canonicalRunId) {
      throw new Error(
        "Canonical Chat turn and retrieval diagnostics episode do not share the same opaque run identity; leave the case PENDING.",
      );
    }
    return {
      ...canonicalProjection.sourceBinding,
      opaqueRunCorrelationSha256,
      diagnosticsRunMatched: Boolean(episode),
    };
  };

  const captureSinglePerformanceEpisode = async (stage, cursor) => {
    if (diagnosticsSessionStage !== stage || !diagnosticsSessionIdentity) {
      throw new Error("Performance diagnostics stage does not match the frozen workload order.");
    }
    const snapshot = await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId);
    const projection = projectBoundRetrievalDiagnostics(snapshot, diagnosticsSessionIdentity);
    if (projection.droppedEventCount !== 0) {
      throw new Error("Performance diagnostics history is incomplete.");
    }
    const newEvents = projection.events.filter((event) => event.sequence > cursor);
    const partition = partitionMeasurementEpisodes(newEvents);
    if (newEvents.length === 0
      || partition.unscopedEvents.length !== 0
      || partition.surfaceMismatchEvents.length !== 0
      || partition.episodes.length !== 1
      || !partition.episodes[0].complete) {
      throw new Error("Exactly one new complete Chat retrieval episode must follow the binding cursor.");
    }
    return {
      projection,
      episode: partition.episodes[0],
      cursor: newEvents.at(-1).sequence,
    };
  };

  const hasFullSuccessfulGraph = (episode) => (
    episode.attempts.length > 0
    && episode.attempts.every((attempt) => Boolean(deriveSuccessfulGraphEvidence(attempt)))
  );

  const hasFinalEvidenceMetadata = (canonicalProjection) => (
    canonicalProjection.finalMetadata?.memoryEvidenceState === "evidence"
    && canonicalProjection.finalMetadata?.rerankVerdict === "relevant"
    && canonicalProjection.finalMetadata?.needsMoreEvidence === false
  );

  const validatePerformanceEpisodeShape = (promptId, episode, canonicalProjection) => {
    if (episode.runId !== canonicalProjection.canonicalRunId) {
      throw new Error("The fresh Chat turn and diagnostics episode have different run identities.");
    }
    if (new Set(canonicalProjection.finalPaths).size !== canonicalProjection.finalPaths.length) {
      throw new Error("The fresh Chat final Memory source set contains a duplicate path.");
    }
    const finalPaths = new Set(canonicalProjection.finalPaths);
    const wave1DirectPresent = PERFORMANCE_WAVE1_DIRECT_PATHS.some((path) => (
      finalPaths.has(path)
    ));
    if (promptId === "standard-v1") {
      const wave1SourcesOnly = canonicalProjection.finalPaths.every((path) => (
        PERFORMANCE_WAVE1_DIRECT_PATHS.includes(path)
        || path === PERFORMANCE_WAVE1_GRAPH_HUB_PATH
      ));
      if (episode.standardCallCount !== 1
        || episode.attempts.length !== 1
        || episode.relaxedStartedCount !== 0
        || episode.projectionStartedCount !== 0
        || episode.projectionTerminals.length !== 0
        || episode.hasCancellationEvidence
        || !hasFullSuccessfulGraph(episode)
        || !hasFinalEvidenceMetadata(canonicalProjection)
        || !wave1DirectPresent
        || !wave1SourcesOnly) {
        throw new Error("The standard performance episode does not prove one full Graph attempt and final evidence metadata.");
      }
      return;
    }
    if (promptId === "retry-v1") {
      const performanceSourcesOnly = canonicalProjection.finalPaths.every((path) => (
        PERFORMANCE_ALLOWED_FIXTURES.includes(path)
      ));
      const standardDocumentCount = observedDocumentCount(episode.attempts[0]?.terminal);
      const relaxedDocumentCount = observedDocumentCount(episode.attempts[1]?.terminal);
      const projectionDocumentCount = observedDocumentCount(episode.projectionTerminal);
      const standardStageDocumentCount = observedDocumentCount(episode.standardTerminal);
      const relaxedStageDocumentCount = observedDocumentCount(episode.relaxedTerminal);
      const cumulativeDocumentCount = Number.isSafeInteger(standardDocumentCount)
        && Number.isSafeInteger(relaxedDocumentCount)
        ? standardDocumentCount + relaxedDocumentCount
        : null;
      const orderedSourcePaths = canonicalProjection.orderedSourcePaths;
      // The recovery coordinator emits current source records standard-first,
      // then relaxed, after filtering them to the cumulative projection. Exact
      // per-attempt/projection counts therefore let this runner prove that the
      // A1 prefix survived without persisting any source identity in the receipt.
      const standardSourcePaths = Array.isArray(orderedSourcePaths)
        && Number.isSafeInteger(standardDocumentCount)
        ? orderedSourcePaths.slice(0, standardDocumentCount)
        : [];
      const relaxedSourcePaths = Array.isArray(orderedSourcePaths)
        && Number.isSafeInteger(standardDocumentCount)
        ? orderedSourcePaths.slice(standardDocumentCount)
        : [];
      const retainedStandardPartial = Number.isSafeInteger(standardDocumentCount)
        && standardDocumentCount > 0
        && standardStageDocumentCount === standardDocumentCount
        && standardSourcePaths.length === standardDocumentCount
        && standardSourcePaths.some((path) => PERFORMANCE_WAVE1_DIRECT_PATHS.includes(path))
        && standardSourcePaths.every((path) => (
          PERFORMANCE_WAVE1_DIRECT_PATHS.includes(path)
          || path === PERFORMANCE_WAVE1_GRAPH_HUB_PATH
        ));
      const cumulativeProjectionRetained = Number.isSafeInteger(relaxedDocumentCount)
        && relaxedDocumentCount > 0
        && relaxedStageDocumentCount === relaxedDocumentCount
        && Number.isSafeInteger(projectionDocumentCount)
        && projectionDocumentCount === cumulativeDocumentCount
        && orderedSourcePaths.length === cumulativeDocumentCount
        && relaxedSourcePaths.length === relaxedDocumentCount
        && relaxedSourcePaths.includes(PERFORMANCE_WAVE2_FRESH_DIRECT_PATHS[0]);
      if (episode.standardCallCount !== 1
        || episode.attempts.length !== 2
        || episode.relaxedStartedCount !== 1
        || episode.relaxedTerminal?.outcome !== "completed"
        || episode.projectionStartedCount !== 1
        || episode.projectionTerminals.length !== 1
        || episode.projectionTerminal?.outcome !== "completed"
        || episode.hasCancellationEvidence
        || !hasFullSuccessfulGraph(episode)
        || !hasFinalEvidenceMetadata(canonicalProjection)
        || !wave1DirectPresent
        || !finalPaths.has(PERFORMANCE_WAVE2_FRESH_DIRECT_PATHS[0])
        || !performanceSourcesOnly
        || !retainedStandardPartial
        || !cumulativeProjectionRetained) {
        throw new Error("The retry performance episode does not prove retained A1 partial evidence, two full Graph attempts, and cumulative two-wave projection.");
      }
      return;
    }
    if (promptId === "cancel-v1") {
      if (episode.standardCallCount !== 1
        || episode.attempts.length !== 1
        || !episode.hasCancellationEvidence
        || !episode.cancellationTopologyValid
        || episode.cancelRequested < 1
        || episode.cancelObserved < 1
        || episode.lateDiscardCount < 1
        || episode.acceptedAfterCancelCount !== 0) {
        throw new Error("The cancellation performance episode does not prove the frozen same-worker cancellation topology.");
      }
      return;
    }
    throw new Error("Unknown performance prompt contract.");
  };

  const buildOpaquePerformanceBinding = async ({
    id,
    stage,
    sampleClass,
    sequence,
    canonicalProjection,
    episode,
  }) => {
    const opaqueCorrelationSha256 = await digest(
      `retrieval-performance-run\u0000${canonicalProjection.canonicalRunId}`,
    );
    const diagnosticsEpisodeSha256 = await digest(canonicalJson({
      standardCallCount: episode.standardCallCount,
      attemptCount: episode.attempts.length,
      relaxedStartedCount: episode.relaxedStartedCount,
      projectionStartedCount: episode.projectionStartedCount,
      projectionTerminalCount: episode.projectionTerminals.length,
      projectionOutcome: episode.projectionTerminal?.outcome ?? null,
      cancellationTopologyValid: episode.cancellationTopologyValid,
      cancelRequested: episode.cancelRequested,
      cancelObserved: episode.cancelObserved,
      lateDiscardCount: episode.lateDiscardCount,
      acceptedAfterCancelCount: episode.acceptedAfterCancelCount,
      events: episode.events.map((event) => ({
        phase: event.phase,
        outcome: event.outcome,
        metrics: event.metrics,
      })),
    }));
    const evidenceBindingSha256 = await digest(canonicalJson({
      id,
      stage,
      sampleClass,
      sequence,
      diagnosticsEpisodeSha256,
      opaqueCorrelationSha256,
      finalEvidenceMetadataQualified: hasFinalEvidenceMetadata(canonicalProjection),
    }));
    return {
      id,
      stage,
      sampleClass,
      sequence,
      status: "PASS",
      opaqueCorrelationSha256,
      evidenceBindingSha256,
    };
  };

  const recordPerformanceQualification = (kind, ...unexpectedArguments) => (
    enqueuePerformanceEvidenceOperation(async () => {
      const qualification = result.deviceMeasurement.workloadBinding.qualification;
      const expectedIndex = qualification.boundCount;
      const expectedPromptId = PERFORMANCE_QUALIFICATION_IDS[expectedIndex];
      const expectedKind = expectedPromptId === "standard-v1" ? "standard"
        : expectedPromptId === "retry-v1" ? "retry" : null;
      const fail = async (message) => {
        await invalidatePerformanceWorkload({ qualification: true });
        throw new Error(message);
      };
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      requireMeasurementSettingsStable();
      if (result.deviceMeasurement.workloadBinding.status === "INVALID") {
        throw new Error("Performance workload binding is permanently invalid for this smoke run.");
      }
      if (!frozenDevicePlan) return fail("Freeze the device measurement plan before qualification.");
      if (runtimeEnvelopeState) return fail("Performance qualification must finish before the runtime envelope starts.");
      if (unexpectedArguments.length !== 0 || !["standard", "retry"].includes(kind)) {
        return fail("recordPerformanceQualification accepts exactly one standard or retry argument.");
      }
      if (!expectedKind || kind !== expectedKind) {
        return fail("Performance qualifications must follow the frozen standard then retry order.");
      }
      if (diagnosticsSessionStage !== "standardPerformance") {
        return fail("Performance qualification must use the post-freeze staging diagnostics session.");
      }
      try {
        const prompt = performanceWorkloadContract.prompts[expectedPromptId].text;
        const captured = await captureSinglePerformanceEpisode(
          "standardPerformance",
          Math.max(performanceQualificationCursor, rankingEvidenceCursor),
        );
        const canonicalProjection = readLatestCanonicalMemoryProjection(prompt, {
          requireFreshChat: true,
          expectedRunId: captured.episode.runId,
        });
        validatePerformanceEpisodeShape(expectedPromptId, captured.episode, canonicalProjection);
        if (performanceEvidenceRunIds.has(canonicalProjection.canonicalRunId)) {
          throw new Error("The performance run identity was already consumed.");
        }
        const entry = await buildOpaquePerformanceBinding({
          id: `qualification-${expectedPromptId}`,
          stage: "qualification",
          sampleClass: "qualification",
          sequence: expectedIndex + 1,
          promptId: expectedPromptId,
          canonicalProjection,
          episode: captured.episode,
        });
        performanceEvidenceRunIds.add(canonicalProjection.canonicalRunId);
        performanceQualificationCursor = captured.cursor;
        qualification.entries.push(entry);
        await refreshPerformanceWorkloadBinding();
        await writeResult();
        return clone(entry);
      } catch (error) {
        return fail(error?.message || "Performance qualification binding failed.");
      }
    })
  );

  const recordPerformanceEpisode = (...unexpectedArguments) => (
    enqueuePerformanceEvidenceOperation(async () => {
      const binding = result.deviceMeasurement.workloadBinding;
      const next = performanceWorkloadSequence[binding.boundEpisodeCount];
      const fail = async (message, stage = next?.stage ?? diagnosticsSessionStage) => {
        await invalidatePerformanceWorkload({ stage });
        throw new Error(message);
      };
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      requireMeasurementSettingsStable();
      if (binding.status === "INVALID") {
        throw new Error("Performance workload binding is permanently invalid for this smoke run.");
      }
      if (!frozenDevicePlan) return fail("Freeze the device measurement plan before performance binding.");
      if (unexpectedArguments.length !== 0) {
        return fail("recordPerformanceEpisode does not accept prompt, run, source, or workload arguments.");
      }
      if (binding.qualification.status !== "PASS") {
        return fail("Both frozen performance qualifications must pass before episodes are recorded.");
      }
      if (!next) return fail("The frozen performance workload already has its exact episode count.");
      if (diagnosticsSessionStage !== next.stage) {
        return fail("The diagnostics stage does not match the next frozen workload episode.");
      }
      if (next.stage === "cancellationProbe") {
        if (runtimeEnvelopeState
          || result.deviceMeasurement.runtimeEnvelope.workloadCoverageStatus !== "PASS") {
          return fail("The cancellation episode must follow the completed performance envelope.");
        }
      } else if (!runtimeEnvelopeState) {
        return fail("Performance episodes require an active workload-bound runtime envelope.");
      }
      try {
        const prompt = performanceWorkloadContract.prompts[next.promptId].text;
        const captured = await captureSinglePerformanceEpisode(
          next.stage,
          performanceStageCursors[next.stage],
        );
        const canonicalProjection = readLatestCanonicalMemoryProjection(prompt, {
          requireFreshChat: true,
          expectedRunId: captured.episode.runId,
        });
        validatePerformanceEpisodeShape(next.promptId, captured.episode, canonicalProjection);
        if (performanceEvidenceRunIds.has(canonicalProjection.canonicalRunId)) {
          throw new Error("The performance run identity was already consumed.");
        }
        const entry = await buildOpaquePerformanceBinding({
          ...next,
          sequence: binding.boundEpisodeCount + 1,
          canonicalProjection,
          episode: captured.episode,
        });
        performanceEvidenceRunIds.add(canonicalProjection.canonicalRunId);
        performanceStageCursors[next.stage] = captured.cursor;
        binding.episodes.push(entry);
        await refreshPerformanceWorkloadBinding();
        await writeResult();
        return clone(entry);
      } catch (error) {
        return fail(error?.message || "Performance episode binding failed.");
      }
    })
  );

  const recordRecoveryCase = () => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    if (result.recoveryCase.status !== "PENDING") {
      return Promise.reject(new Error("Chat recovery canary is already recorded; repeat it in a new smoke run."));
    }
    if (frozenDevicePlan || diagnosticsSessionStage !== "preFreeze") {
      return Promise.reject(new Error(
        "Record the Chat recovery canary from the isolated pre-freeze diagnostics session.",
      ));
    }
    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      if (result.recoveryCase.status !== "PENDING") {
        throw new Error("Chat recovery canary is already recorded; repeat it in a new smoke run.");
      }
      if (frozenDevicePlan || diagnosticsSessionStage !== "preFreeze") {
        throw new Error("Record the Chat recovery canary from the isolated pre-freeze diagnostics session.");
      }

      const canonicalProjection = readLatestCanonicalMemoryProjection(RECOVERY_PROMPT);
      const finalPaths = canonicalProjection.finalPaths;

      const canonicalPaths = [];
      let invalidSourceCount = finalPaths.length > RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        ? finalPaths.length - RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        : 0;
      let duplicateSourceCount = 0;
      for (const rawPath of finalPaths.slice(
        0,
        RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount,
      )) {
        const canonicalPath = normalizeRankedPath(rawPath);
        if (!canonicalPath) {
          invalidSourceCount += 1;
          continue;
        }
        if (canonicalPaths.includes(canonicalPath)) {
          duplicateSourceCount += 1;
          continue;
        }
        canonicalPaths.push(canonicalPath);
      }
      const targetPresent = canonicalPaths.includes(RECOVERY_TARGET_FIXTURE);
      const standardSources = canonicalPaths.filter((path) => (
        RECOVERY_STANDARD_FIXTURES.includes(path)
      ));
      const opaqueHitCount = canonicalPaths.filter(isOpaqueOrExcludedPath).length;
      const unexpectedSourceCount = canonicalPaths.filter((path) => (
        !RECOVERY_ALLOWED_FIXTURES.includes(path)
      )).length;
      const finalSources = canonicalPaths.map((path) => {
        if (isOpaqueOrExcludedPath(path)) return "[opaque-redacted]";
        return RECOVERY_ALLOWED_FIXTURES.includes(path)
          ? path
          : "[unexpected-source-redacted]";
      });

      let projection = null;
      let captureValid = false;
      let surfaceProjectionBlocked = false;
      try {
        if (!diagnosticsSeamAvailable || !diagnosticsSessionIdentity) {
          throw new Error("diagnostics unavailable");
        }
        const snapshot = await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId);
        surfaceProjectionBlocked = hasInvalidDiagnosticSurface(snapshot);
        projection = projectBoundRetrievalDiagnostics(snapshot, diagnosticsSessionIdentity);
        captureValid = true;
      } catch {
        // Projection remains unavailable; surface validation state is retained.
      }

      const events = projection?.events || [];
      const partition = projection ? partitionMeasurementEpisodes(events) : {
        episodes: [],
        unscopedEvents: [],
      };
      const episode = partition.episodes.length === 1 ? partition.episodes[0] : null;
      const sourceBinding = await bindCanonicalRunToEpisode(canonicalProjection, episode);
      const memoryAttemptCount = events.filter((event) => (
        event.phase === "memory_search" && event.outcome === "started"
      )).length;
      const memoryTerminalCount = events.filter((event) => (
        event.phase === "memory_search" && TERMINAL_OUTCOMES.has(event.outcome)
      )).length;
      const relaxedStarts = events.filter((event) => (
        event.phase === "recovery_relaxed" && event.outcome === "started"
      ));
      const relaxedTerminals = events.filter((event) => (
        event.phase === "recovery_relaxed" && event.outcome !== "started"
      ));
      const projectionStarts = events.filter((event) => (
        event.phase === "recovery_projection" && event.outcome === "started"
      ));
      const projectionTerminals = events.filter((event) => (
        event.phase === "recovery_projection" && event.outcome !== "started"
      ));
      const standardMemoryDocumentCount = observedDocumentCount(
        episode?.attempts[0]?.terminal,
      );
      const relaxedMemoryTerminal = episode?.attempts[1]?.terminal ?? null;
      const relaxedMemoryDocumentCount = observedDocumentCount(relaxedMemoryTerminal);
      const standardDocumentCount = observedDocumentCount(episode?.standardTerminal);
      const relaxedDocumentCount = relaxedTerminals.length === 1
        ? observedDocumentCount(relaxedTerminals[0])
        : null;
      const projectionDocumentCount = projectionTerminals.length === 1
        ? observedDocumentCount(projectionTerminals[0])
        : null;
      if (Number.isFinite(projectionDocumentCount)
        && projectionDocumentCount !== finalPaths.length) {
        throw new Error(
          "Canonical cumulative Memory source count disagrees with the diagnostics projection; leave the case PENDING.",
        );
      }
      const relaxedTerminal = relaxedTerminals.length === 1 ? relaxedTerminals[0] : null;
      const a2FailureReason = contentFreeA2FailureReason(relaxedTerminal);
      const standardEvidenceMode = standardMemoryDocumentCount === 0
        && standardDocumentCount === 0
        ? "valid-none"
        : Number.isInteger(standardMemoryDocumentCount)
          && standardMemoryDocumentCount > 0
          && standardMemoryDocumentCount <= RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount
          && standardDocumentCount === standardMemoryDocumentCount
          ? "strict-partial"
          : "invalid";
      const standardSourceBindingValid = standardEvidenceMode === "valid-none"
        ? standardSources.length === 0
        : standardEvidenceMode === "strict-partial"
          && standardSources.length > 0
          && standardSources.length <= standardDocumentCount;
      const retryConsumed = relaxedStarts.length === 1
        && relaxedTerminals.length === 1
        && relaxedStarts[0].metrics.retryConsumed === 1
        && relaxedTerminals[0].metrics.retryConsumed === 1;
      const topology = {
        schemaVersion: projection?.schemaVersion ?? null,
        capacity: projection?.capacity ?? null,
        droppedEventCount: projection?.droppedEventCount ?? null,
        eventCount: events.length,
        episodeCount: partition.episodes.length,
        unscopedEventCount: partition.unscopedEvents.length,
        surfaceMismatchEventCount: partition.surfaceMismatchEvents?.length ?? 0,
        memoryAttemptCount,
        memoryTerminalCount,
        standardMemoryDocumentCount,
        relaxedMemoryDocumentCount,
        standardEvidenceMode,
        standardOutcome: episode?.standardTerminal?.outcome ?? null,
        standardDocumentCount,
        relaxedMemoryOutcome: relaxedMemoryTerminal?.outcome ?? null,
        relaxedRetryCount: relaxedStarts.length,
        relaxedTerminalCount: relaxedTerminals.length,
        relaxedOutcome: relaxedTerminal?.outcome ?? null,
        relaxedDocumentCount,
        retryConsumed,
        projectionStartedCount: projectionStarts.length,
        projectionCompletedCount: projectionTerminals.filter((event) => (
          event.outcome === "completed"
        )).length,
        projectionOutcome: projectionTerminals.length === 1 ? projectionTerminals[0].outcome : null,
        projectionDocumentCount,
      };
      const topologyValid = captureValid
        && projection.droppedEventCount === 0
        && partition.surfaceMismatchEvents.length === 0
        && partition.unscopedEvents.length === 0
        && partition.episodes.length === 1
        && episode?.complete === true
        && episode.structurallyInvalid === false
        && episode.attempts.length === 2
        && memoryAttemptCount === 2
        && memoryTerminalCount === 2
        && RECOVERY_FINAL_SOURCE_CONTRACT.allowedStandardEvidenceModes.includes(
          standardEvidenceMode,
        )
        && Number.isFinite(relaxedMemoryDocumentCount)
        && relaxedMemoryDocumentCount > 0
        && episode.standardTerminal?.outcome === "completed"
        && relaxedStarts.length === 1
        && relaxedTerminals.length === 1
        && relaxedTerminals[0].outcome === "completed"
        && Number.isFinite(relaxedDocumentCount)
        && relaxedDocumentCount > 0
        && retryConsumed
        && projectionStarts.length === 1
        && projectionTerminals.length === 1
        && projectionTerminals[0].outcome === "completed"
        && Number.isFinite(projectionDocumentCount)
        && projectionDocumentCount > 0;
      const pathValid = finalSources.length > 0
        && finalSources.length <= RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        && targetPresent
        && standardSourceBindingValid
        && invalidSourceCount === 0
        && duplicateSourceCount === 0
        && opaqueHitCount === 0
        && unexpectedSourceCount === 0;
      const failures = [];
      if (!captureValid) failures.push("pre-freeze diagnostics unavailable or invalid");
      else {
        if (projection.droppedEventCount !== 0) failures.push("diagnostics events were dropped");
        if (partition.surfaceMismatchEvents.length !== 0) {
          failures.push("recovery diagnostics contain events outside the Chat surface");
        }
        if (partition.episodes.length !== 1 || partition.unscopedEvents.length !== 0) {
          failures.push("expected one isolated recovery episode");
        }
        if (memoryAttemptCount !== 2 || memoryTerminalCount !== 2) {
          failures.push("expected exactly two complete Memory attempts");
        }
        if (!RECOVERY_FINAL_SOURCE_CONTRACT.allowedStandardEvidenceModes.includes(
          standardEvidenceMode,
        )) {
          failures.push("standard recovery stage was neither coherent valid-none nor strict-partial");
        }
        if (!Number.isFinite(relaxedMemoryDocumentCount)) {
          failures.push("relaxed Memory attempt document count is unavailable");
        } else if (relaxedMemoryDocumentCount <= 0) {
          failures.push("relaxed Memory attempt returned zero documents");
        }
        if (episode?.standardTerminal?.outcome !== "completed") {
          failures.push("standard recovery stage did not complete");
        }
        if (relaxedStarts.length !== 1 || relaxedTerminals.length !== 1 || !retryConsumed) {
          failures.push("expected exactly one consumed relaxed retry");
        }
        if (relaxedTerminals.length === 1 && relaxedTerminals[0].outcome !== "completed") {
          failures.push("relaxed recovery stage did not complete");
        }
        if (!Number.isFinite(relaxedDocumentCount)) {
          failures.push("relaxed recovery stage document count is unavailable");
        } else if (relaxedDocumentCount <= 0) {
          failures.push("relaxed recovery stage returned zero documents");
        }
        if (projectionStarts.length !== 1
          || projectionTerminals.length !== 1
          || projectionTerminals[0]?.outcome !== "completed") {
          failures.push("expected one completed cumulative projection");
        }
        if (!Number.isFinite(projectionDocumentCount)) {
          failures.push("cumulative projection document count is unavailable");
        } else if (projectionDocumentCount <= 0) {
          failures.push("cumulative projection returned zero documents");
        }
        if (!episode?.complete || episode.structurallyInvalid) {
          failures.push("recovery diagnostics topology is incomplete or invalid");
        }
      }
      if (!standardSourceBindingValid) {
        failures.push(standardEvidenceMode === "valid-none"
          ? "valid-none final sources retained first-attempt evidence"
          : "strict-partial final sources did not preserve a frozen first-attempt subset");
      }
      if (!targetPresent) failures.push("frozen relaxed target is absent");
      if (invalidSourceCount > 0) failures.push("final sources contain invalid paths or exceed the limit");
      if (duplicateSourceCount > 0) failures.push("final sources contain duplicates");
      if (opaqueHitCount > 0) failures.push("opaque source was present");
      if (unexpectedSourceCount > 0) failures.push("final sources contain invalid or unrelated paths");
      if (finalSources.length === 0) failures.push("canonical final Memory sources are empty");
      const surfaceEvidenceBlocked = surfaceProjectionBlocked
        || (partition.surfaceMismatchEvents?.length ?? 0) > 0;
      const status = surfaceEvidenceBlocked
        ? "BLOCKED"
        : topologyValid && pathValid ? "PASS" : "FAIL";
      const detail = status === "PASS"
        ? `${standardEvidenceMode} evidence union bound to one relaxed retry, two Memory attempts, and one completed projection`
        : [
          ...new Set(failures),
          ...(a2FailureReason ? [`A2 failure reason=${a2FailureReason}`] : []),
        ].join("; ");
      const evidenceSha256 = await digest(JSON.stringify({
        prompt: RECOVERY_PROMPT,
        targetPath: RECOVERY_TARGET_FIXTURE,
        finalPaths: canonicalPaths,
        sourceBinding,
        diagnostics: projection,
      }));
      result.recoveryCase = {
        id: "chat-recovery",
        status,
        prompt: RECOVERY_PROMPT,
        targetPath: RECOVERY_TARGET_FIXTURE,
        finalSources,
        standardSources,
        standardEvidenceMode,
        targetPresent,
        invalidSourceCount,
        duplicateSourceCount,
        opaqueHitCount,
        unexpectedSourceCount,
        a2FailureReason,
        sourceBinding,
        topology,
        evidenceSha256,
        detail,
        recordedAt: new Date().toISOString(),
      };
      manualCases["chat-recovery"] = {
        id: "chat-recovery",
        status,
        detail,
        recordedAt: result.recoveryCase.recordedAt,
      };
      result.manualCases = manualCases;
      await writeResult();
      console.log(`[retrieval-smoke:${status}] Chat recovery canary recorded`);
      return clone(result.recoveryCase);
    });
  };

  const recordTemporalRetryCase = (...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    if (unexpectedArguments.length !== 0) {
      return Promise.reject(new Error(
        "recordTemporalRetryCase does not accept source paths; leave the case PENDING and bind the exact live Chat turn.",
      ));
    }
    if (result.temporalRetryCase.status !== "PENDING") {
      return Promise.reject(new Error(
        "Temporal retry canary is already recorded; repeat it in a new smoke run.",
      ));
    }
    if (result.recoveryCase.status === "PENDING") {
      return Promise.reject(new Error(
        "Record the isolated Chat recovery canary before the temporal retry canary.",
      ));
    }
    if (!frozenDevicePlan
      || runtimeEnvelopeState
      || diagnosticsSessionStage !== "standardPerformance"
      || !diagnosticsSessionIdentity) {
      return Promise.reject(new Error(
        "Record the temporal retry canary in the post-freeze qualitative diagnostics session.",
      ));
    }

    return enqueueDiagnosticsOperation(async () => {
      requireMeasurementSettingsStable();
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      if (result.temporalRetryCase.status !== "PENDING") {
        throw new Error("Temporal retry canary is already recorded; repeat it in a new smoke run.");
      }
      if (result.recoveryCase.status === "PENDING") {
        throw new Error("Record the isolated Chat recovery canary before the temporal retry canary.");
      }
      if (!frozenDevicePlan
        || runtimeEnvelopeState
        || diagnosticsSessionStage !== "standardPerformance"
        || !diagnosticsSessionIdentity) {
        throw new Error("Record the temporal retry canary in post-freeze qualitative diagnostics.");
      }

      const canonicalProjection = readLatestCanonicalMemoryProjection(TEMPORAL_RETRY_PROMPT);
      const finalPaths = canonicalProjection.finalPaths;
      const canonicalPaths = [];
      let invalidSourceCount = finalPaths.length
        > TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        ? finalPaths.length - TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        : 0;
      let duplicateSourceCount = 0;
      for (const rawPath of finalPaths.slice(
        0,
        TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount,
      )) {
        const canonicalPath = normalizeRankedPath(rawPath);
        if (!canonicalPath) {
          invalidSourceCount += 1;
          continue;
        }
        if (canonicalPaths.includes(canonicalPath)) {
          duplicateSourceCount += 1;
          continue;
        }
        canonicalPaths.push(canonicalPath);
      }
      const targetPresent = canonicalPaths.includes(TEMPORAL_RETRY_TARGET_FIXTURE);
      const standardSources = canonicalPaths.filter((path) => (
        TEMPORAL_RETRY_STANDARD_FIXTURES.includes(path)
      ));
      const forbiddenHitCount = canonicalPaths.filter((path) => (
        path === TEMPORAL_RETRY_FORBIDDEN_FIXTURE
      )).length;
      const unexpectedSourceCount = canonicalPaths.filter((path) => (
        !TEMPORAL_RETRY_ALLOWED_FIXTURES.includes(path)
        && path !== TEMPORAL_RETRY_FORBIDDEN_FIXTURE
      )).length;
      const finalSources = canonicalPaths.map((path) => {
        if (path === TEMPORAL_RETRY_FORBIDDEN_FIXTURE) {
          return "[temporal-forbidden-redacted]";
        }
        return TEMPORAL_RETRY_ALLOWED_FIXTURES.includes(path)
          ? path
          : "[unexpected-source-redacted]";
      });

      let projection = null;
      let captureValid = false;
      let surfaceProjectionBlocked = false;
      try {
        if (!diagnosticsSeamAvailable || !diagnosticsSessionIdentity) {
          throw new Error("diagnostics unavailable");
        }
        const snapshot = await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId);
        surfaceProjectionBlocked = hasInvalidDiagnosticSurface(snapshot);
        projection = projectBoundRetrievalDiagnostics(snapshot, diagnosticsSessionIdentity);
        captureValid = true;
      } catch {
        // Projection remains unavailable; surface validation state is retained.
      }

      const events = (projection?.events || []).filter((event) => (
        event.sequence > rankingEvidenceCursor
      ));
      const partition = projection ? partitionMeasurementEpisodes(events) : {
        episodes: [],
        unscopedEvents: [],
      };
      const episode = partition.episodes.length === 1 ? partition.episodes[0] : null;
      const sourceBinding = await bindCanonicalRunToEpisode(canonicalProjection, episode);
      const memoryAttemptCount = events.filter((event) => (
        event.phase === "memory_search" && event.outcome === "started"
      )).length;
      const memoryTerminalCount = events.filter((event) => (
        event.phase === "memory_search" && TERMINAL_OUTCOMES.has(event.outcome)
      )).length;
      const relaxedStarts = events.filter((event) => (
        event.phase === "recovery_relaxed" && event.outcome === "started"
      ));
      const relaxedTerminals = events.filter((event) => (
        event.phase === "recovery_relaxed" && event.outcome !== "started"
      ));
      const projectionStarts = events.filter((event) => (
        event.phase === "recovery_projection" && event.outcome === "started"
      ));
      const projectionTerminals = events.filter((event) => (
        event.phase === "recovery_projection" && event.outcome !== "started"
      ));
      const standardMemoryTerminal = episode?.attempts[0]?.terminal ?? null;
      const relaxedMemoryTerminal = episode?.attempts[1]?.terminal ?? null;
      const standardMemoryDocumentCount = observedDocumentCount(standardMemoryTerminal);
      const relaxedMemoryDocumentCount = observedDocumentCount(relaxedMemoryTerminal);
      const standardDocumentCount = observedDocumentCount(episode?.standardTerminal);
      const relaxedTerminal = relaxedTerminals.length === 1 ? relaxedTerminals[0] : null;
      const relaxedDocumentCount = observedDocumentCount(relaxedTerminal);
      const projectionTerminal = projectionTerminals.length === 1 ? projectionTerminals[0] : null;
      const projectionDocumentCount = observedDocumentCount(projectionTerminal);
      if (Number.isFinite(projectionDocumentCount)
        && projectionDocumentCount !== finalPaths.length) {
        throw new Error(
          "Canonical cumulative temporal Memory source count disagrees with the diagnostics projection; leave the case PENDING.",
        );
      }
      const standardEvidenceMode = standardMemoryDocumentCount === 0
        && standardDocumentCount === 0
        ? "valid-none"
        : Number.isInteger(standardMemoryDocumentCount)
          && standardMemoryDocumentCount > 0
          && standardMemoryDocumentCount
            <= TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount
          && standardDocumentCount === standardMemoryDocumentCount
          ? "strict-partial"
          : "invalid";
      const standardSourceBindingValid = standardEvidenceMode === "valid-none"
        ? standardSources.length === 0
        : standardEvidenceMode === "strict-partial"
          && standardSources.length > 0
          && standardSources.length <= standardDocumentCount;
      const retryConsumed = relaxedStarts.length === 1
        && relaxedTerminals.length === 1
        && relaxedStarts[0].metrics.retryConsumed === 1
        && relaxedTerminals[0].metrics.retryConsumed === 1;
      const standardTemporalFilterApplied = standardMemoryTerminal
        ?.metrics.temporalFilterApplied ?? null;
      const standardTemporalViolationCount = standardMemoryTerminal
        ?.metrics.temporalViolationCount ?? null;
      const relaxedTemporalFilterApplied = relaxedMemoryTerminal
        ?.metrics.temporalFilterApplied ?? null;
      const relaxedTemporalViolationCount = relaxedMemoryTerminal
        ?.metrics.temporalViolationCount ?? null;
      const projectionTemporalFilterApplied = projectionTerminal
        ?.metrics.temporalFilterApplied ?? null;
      const projectionTemporalViolationCount = projectionTerminal
        ?.metrics.temporalViolationCount ?? null;
      const temporalBoundaryValid = standardTemporalFilterApplied === 1
        && standardTemporalViolationCount === 0
        && relaxedTemporalFilterApplied === 1
        && relaxedTemporalViolationCount === 0
        && projectionTemporalFilterApplied === 1
        && projectionTemporalViolationCount === 0;
      const topology = {
        schemaVersion: projection?.schemaVersion ?? null,
        capacity: projection?.capacity ?? null,
        droppedEventCount: projection?.droppedEventCount ?? null,
        eventCount: events.length,
        episodeCount: partition.episodes.length,
        unscopedEventCount: partition.unscopedEvents.length,
        surfaceMismatchEventCount: partition.surfaceMismatchEvents?.length ?? 0,
        memoryAttemptCount,
        memoryTerminalCount,
        standardMemoryDocumentCount,
        relaxedMemoryDocumentCount,
        standardEvidenceMode,
        standardOutcome: episode?.standardTerminal?.outcome ?? null,
        standardDocumentCount,
        standardTemporalFilterApplied,
        standardTemporalViolationCount,
        relaxedMemoryOutcome: relaxedMemoryTerminal?.outcome ?? null,
        relaxedRetryCount: relaxedStarts.length,
        relaxedTerminalCount: relaxedTerminals.length,
        relaxedOutcome: relaxedTerminal?.outcome ?? null,
        relaxedDocumentCount,
        relaxedTemporalFilterApplied,
        relaxedTemporalViolationCount,
        retryConsumed,
        projectionStartedCount: projectionStarts.length,
        projectionCompletedCount: projectionTerminals.filter((event) => (
          event.outcome === "completed"
        )).length,
        projectionOutcome: projectionTerminal?.outcome ?? null,
        projectionDocumentCount,
        projectionTemporalFilterApplied,
        projectionTemporalViolationCount,
      };
      const topologyValid = captureValid
        && projection.droppedEventCount === 0
        && partition.surfaceMismatchEvents.length === 0
        && partition.unscopedEvents.length === 0
        && partition.episodes.length === 1
        && episode?.complete === true
        && episode.structurallyInvalid === false
        && episode.attempts.length === 2
        && memoryAttemptCount === 2
        && memoryTerminalCount === 2
        && TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.allowedStandardEvidenceModes.includes(
          standardEvidenceMode,
        )
        && episode.standardTerminal?.outcome === "completed"
        && relaxedMemoryTerminal?.outcome === "completed"
        && Number.isFinite(relaxedMemoryDocumentCount)
        && relaxedMemoryDocumentCount > 0
        && relaxedStarts.length === 1
        && relaxedTerminals.length === 1
        && relaxedTerminal?.outcome === "completed"
        && Number.isFinite(relaxedDocumentCount)
        && relaxedDocumentCount > 0
        && retryConsumed
        && projectionStarts.length === 1
        && projectionTerminals.length === 1
        && projectionTerminal?.outcome === "completed"
        && Number.isFinite(projectionDocumentCount)
        && projectionDocumentCount > 0
        && temporalBoundaryValid;
      const pathValid = finalSources.length > 0
        && finalSources.length <= TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        && targetPresent
        && standardSourceBindingValid
        && forbiddenHitCount === 0
        && invalidSourceCount === 0
        && duplicateSourceCount === 0
        && unexpectedSourceCount === 0;
      const failures = [];
      if (!captureValid) failures.push("post-freeze qualitative diagnostics unavailable or invalid");
      else {
        if (projection.droppedEventCount !== 0) failures.push("diagnostics events were dropped");
        if (partition.surfaceMismatchEvents.length !== 0) {
          failures.push("temporal diagnostics contain events outside the Chat surface");
        }
        if (partition.episodes.length !== 1 || partition.unscopedEvents.length !== 0) {
          failures.push("expected one isolated temporal recovery episode after Chat recovery");
        }
        if (memoryAttemptCount !== 2 || memoryTerminalCount !== 2) {
          failures.push("expected exactly two complete Memory attempts");
        }
        if (!TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.allowedStandardEvidenceModes.includes(
          standardEvidenceMode,
        )) {
          failures.push("standard temporal stage was neither coherent valid-none nor strict-partial");
        }
        if (standardTemporalFilterApplied !== 1) {
          failures.push("standard attempt did not prove the frozen temporal filter was applied");
        }
        if (standardTemporalViolationCount !== 0) {
          failures.push("standard attempt contains an out-of-range temporal violation");
        }
        if (relaxedTemporalFilterApplied !== 1) {
          failures.push("relaxed attempt did not prove the frozen temporal filter was applied");
        }
        if (relaxedTemporalViolationCount !== 0) {
          failures.push("relaxed attempt contains an out-of-range temporal violation");
        }
        if (projectionTemporalFilterApplied !== 1) {
          failures.push("cumulative projection did not prove the frozen temporal filter was applied");
        }
        if (projectionTemporalViolationCount !== 0) {
          failures.push("cumulative projection contains an out-of-range temporal violation");
        }
        if (relaxedStarts.length !== 1 || relaxedTerminals.length !== 1 || !retryConsumed) {
          failures.push("expected exactly one consumed relaxed retry");
        }
        if (relaxedMemoryTerminal?.outcome !== "completed"
          || relaxedTerminal?.outcome !== "completed") {
          failures.push("relaxed temporal attempt did not complete");
        }
        if (!Number.isFinite(relaxedMemoryDocumentCount)) {
          failures.push("relaxed Memory attempt document count is unavailable");
        } else if (relaxedMemoryDocumentCount <= 0) {
          failures.push("relaxed Memory attempt returned zero documents");
        }
        if (projectionStarts.length !== 1
          || projectionTerminals.length !== 1
          || projectionTerminal?.outcome !== "completed") {
          failures.push("expected one completed cumulative projection");
        }
        if (!Number.isFinite(projectionDocumentCount)) {
          failures.push("cumulative projection document count is unavailable");
        } else if (projectionDocumentCount <= 0) {
          failures.push("cumulative projection returned zero documents");
        }
        if (!episode?.complete || episode.structurallyInvalid) {
          failures.push("temporal retry diagnostics topology is incomplete or invalid");
        }
      }
      if (!standardSourceBindingValid) {
        failures.push(standardEvidenceMode === "valid-none"
          ? "valid-none final sources retained first-attempt evidence"
          : "strict-partial final sources did not preserve a frozen first-attempt subset");
      }
      if (!targetPresent) failures.push("frozen 2026 relaxed target is absent");
      if (forbiddenHitCount > 0) failures.push("2020 forbidden source was present in final evidence");
      if (invalidSourceCount > 0) failures.push("final sources contain invalid paths or exceed the limit");
      if (duplicateSourceCount > 0) failures.push("final sources contain duplicates");
      if (unexpectedSourceCount > 0) failures.push("final sources contain invalid or unrelated paths");
      if (finalSources.length === 0) failures.push("final source-chip paths are empty");
      const surfaceEvidenceBlocked = surfaceProjectionBlocked
        || (partition.surfaceMismatchEvents?.length ?? 0) > 0;
      const status = surfaceEvidenceBlocked
        ? "BLOCKED"
        : topologyValid && pathValid ? "PASS" : "FAIL";
      const detail = status === "PASS"
        ? `${standardEvidenceMode} evidence bound to one temporally scoped relaxed retry and projection`
        : [...new Set(failures)].join("; ");
      const evidenceProjection = projection ? {
        schemaVersion: projection.schemaVersion,
        capacity: projection.capacity,
        droppedEventCount: projection.droppedEventCount,
        events,
      } : null;
      const evidenceSha256 = await digest(JSON.stringify({
        prompt: TEMPORAL_RETRY_PROMPT,
        timeRange: TEMPORAL_RETRY_TIME_RANGE,
        targetPath: TEMPORAL_RETRY_TARGET_FIXTURE,
        forbiddenPath: TEMPORAL_RETRY_FORBIDDEN_FIXTURE,
        finalPaths: canonicalPaths,
        sourceBinding,
        diagnostics: evidenceProjection,
      }));
      rankingEvidenceCursor = captureValid
        ? events.at(-1)?.sequence ?? rankingEvidenceCursor
        : rankingEvidenceCursor;
      result.temporalRetryCase = {
        id: "temporal-retry",
        status,
        prompt: TEMPORAL_RETRY_PROMPT,
        timeRange: TEMPORAL_RETRY_TIME_RANGE,
        targetPath: TEMPORAL_RETRY_TARGET_FIXTURE,
        forbiddenPath: TEMPORAL_RETRY_FORBIDDEN_FIXTURE,
        finalSources,
        standardSources,
        standardEvidenceMode,
        targetPresent,
        forbiddenHitCount,
        invalidSourceCount,
        duplicateSourceCount,
        unexpectedSourceCount,
        sourceBinding,
        topology,
        evidenceSha256,
        detail,
        recordedAt: new Date().toISOString(),
      };
      manualCases["temporal-retry"] = {
        id: "temporal-retry",
        status,
        detail,
        recordedAt: result.temporalRetryCase.recordedAt,
      };
      result.manualCases = manualCases;
      await writeResult();
      console.log(`[retrieval-smoke:${status}] temporal retry canary recorded`);
      return clone(result.temporalRetryCase);
    });
  };

  const normalizePageletInsightId = (value) => {
    if (typeof value !== "string") return null;
    const insightId = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(insightId)) return null;
    return OPAQUE_REDACTIONS.some((forbidden) => insightId.includes(forbidden)) ? null : insightId;
  };

  const enqueuePageletEvidenceOperation = (operation) => {
    const queued = pageletEvidenceOperationQueue.then(operation, operation);
    pageletEvidenceOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const recordPageletCase = (id, ...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    const definition = PAGELET_CASES[id];
    if (!definition) return Promise.reject(new Error(`Unknown Pagelet smoke case: ${id}`));
    if (unexpectedArguments.length !== 0) {
      return Promise.reject(new Error(
        "recordPageletCase does not accept insight ids or source paths; bind the latest real Pagelet controller result.",
      ));
    }
    if (pageletCases[id].status !== "PENDING") {
      return Promise.reject(new Error("Pagelet smoke case is already recorded; repeat it in a new smoke run."));
    }
    return enqueuePageletEvidenceOperation(async () => {
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      requireMeasurementSettingsStable();
      if (!pageletEvidenceSeamAvailable) {
        throw new Error("Current plugin does not expose real Pagelet smoke evidence.");
      }
      if (pageletCases[id].status !== "PENDING") {
        throw new Error("Pagelet smoke case is already recorded; repeat it in a new smoke run.");
      }
      const snapshot = await plugin.getPageletDeepDiscoverSmokeSnapshot();
      requireMeasurementSettingsStable();
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new Error("Latest Pagelet controller result is unavailable or was superseded.");
      }
      const sequence = snapshot.sequence;
      const controllerSequence = snapshot.controllerSequence;
      const runId = normalizePageletInsightId(snapshot.runId);
      const resultId = normalizePageletInsightId(snapshot.resultId);
      const entryPath = normalizeRankedPath(snapshot.entryPath);
      const counts = [
        snapshot.candidateCount,
        snapshot.deliveryReceiptCount,
        snapshot.cacheMutationCount,
        snapshot.cacheEntryCountBefore,
        snapshot.cacheEntryCountAfter,
      ];
      if (snapshot.schemaVersion !== 1
        || !Number.isSafeInteger(sequence)
        || sequence <= 0
        || !Number.isSafeInteger(controllerSequence)
        || controllerSequence <= 0
        || !runId
        || !resultId
        || !entryPath
        || entryPath !== snapshot.entryPath
        || snapshot.triggerReason !== "explicit"
        || snapshot.force !== true
        || !["quiet", "verified", "cache-hit", "limit", "denied", "stale", "error"]
          .includes(snapshot.resultStatus)
        || !(snapshot.reason === null || typeof snapshot.reason === "string")
        || !(snapshot.collectionId === null || normalizePageletInsightId(snapshot.collectionId))
        || !Array.isArray(snapshot.insights)
        || counts.some((value) => !Number.isSafeInteger(value) || value < 0)
        || typeof snapshot.quietWriteInvariantSatisfied !== "boolean") {
        throw new Error("Latest Pagelet controller evidence has an invalid content-free shape.");
      }
      if (sequence <= pageletEvidenceCursor
        || pageletEvidenceRunIds.has(runId)
        || pageletEvidenceResultIds.has(resultId)) {
        throw new Error("Latest Pagelet controller evidence is stale or already consumed.");
      }
      if (entryPath !== definition.entryPath) {
        throw new Error(`Latest Pagelet controller result is for a different fixture than ${id}.`);
      }

      const seenInsightIds = new Set();
      const seenCandidateIds = new Set();
      const seenNonAnchorPaths = new Set();
      const seenReceiptFingerprints = new Set();
      const seenReceiptHashes = new Set();
      const observedNonAnchorPaths = new Set();
      const receipts = [];
      let verifiedInsightCount = 0;
      let invalidInsightCount = 0;
      let invalidSourceCount = 0;
      let duplicateInsightIdCount = 0;
      let duplicateSourceCount = 0;
      let opaqueHitCount = 0;
      let unexpectedSourceCount = 0;
      let duplicateCandidateCount = 0;
      let duplicateReceiptCount = 0;
      for (const rawInsight of snapshot.insights) {
        if (!rawInsight || typeof rawInsight !== "object" || Array.isArray(rawInsight)) {
          throw new Error("Latest Pagelet insight evidence has an invalid content-free shape.");
        }
        let insightValid = true;
        const insightId = normalizePageletInsightId(rawInsight.insightId);
        const candidateId = normalizePageletInsightId(rawInsight.candidateId);
        const deliveryReceipt = rawInsight.deliveryReceipt;
        const deliveryReceiptSha256 = rawInsight.deliveryReceiptSha256;
        if (!insightId || !candidateId || candidateId !== insightId
          || !deliveryReceipt
          || typeof deliveryReceipt !== "object"
          || Array.isArray(deliveryReceipt)
          || deliveryReceipt.version !== 1
          || deliveryReceipt.kind !== "review"
          || typeof deliveryReceipt.fingerprint !== "string"
          || !/^v1:review:[a-f0-9]{16}$/u.test(deliveryReceipt.fingerprint)
          || typeof deliveryReceiptSha256 !== "string"
          || !/^[a-f0-9]{64}$/u.test(deliveryReceiptSha256)
          || !Array.isArray(rawInsight.sourcePaths)
          || rawInsight.sourcePaths.some((path) => typeof path !== "string")) {
          throw new Error("Latest Pagelet insight evidence has an invalid content-free shape.");
        }
        if (seenInsightIds.has(insightId)) {
          insightValid = false;
          duplicateInsightIdCount += 1;
        } else {
          seenInsightIds.add(insightId);
        }
        if (seenCandidateIds.has(candidateId)) {
          insightValid = false;
          duplicateCandidateCount += 1;
        } else {
          seenCandidateIds.add(candidateId);
        }
        if (seenReceiptFingerprints.has(deliveryReceipt.fingerprint)
          || seenReceiptHashes.has(deliveryReceiptSha256)) {
          insightValid = false;
          duplicateReceiptCount += 1;
        } else {
          seenReceiptFingerprints.add(deliveryReceipt.fingerprint);
          seenReceiptHashes.add(deliveryReceiptSha256);
        }

        const canonicalPaths = [];
        const localPaths = new Set();
        for (const rawPath of rawInsight.sourcePaths) {
          const canonicalPath = normalizeRankedPath(rawPath);
          if (!canonicalPath || canonicalPath !== rawPath || localPaths.has(canonicalPath)) {
            insightValid = false;
            invalidSourceCount += 1;
            continue;
          }
          localPaths.add(canonicalPath);
          canonicalPaths.push(canonicalPath);
          if (isOpaqueOrExcludedPath(canonicalPath)) {
            insightValid = false;
            opaqueHitCount += 1;
          }
          if (canonicalPath !== definition.entryPath
            && !definition.sourcePaths.includes(canonicalPath)) {
            insightValid = false;
            unexpectedSourceCount += 1;
          }
          if (canonicalPath !== definition.entryPath) {
            observedNonAnchorPaths.add(canonicalPath);
            if (seenNonAnchorPaths.has(canonicalPath)) {
              insightValid = false;
              duplicateSourceCount += 1;
            } else {
              seenNonAnchorPaths.add(canonicalPath);
            }
          }
        }
        const nonAnchorPaths = canonicalPaths.filter((path) => path !== definition.entryPath);
        if (canonicalPaths.length !== 2
          || !localPaths.has(definition.entryPath)
          || nonAnchorPaths.length !== 1) insightValid = false;
        if (insightValid) verifiedInsightCount += 1;
        receipts.push({
          insightId,
          candidateId,
          sourcePaths: canonicalPaths.map((path) => {
            if (isOpaqueOrExcludedPath(path)) return "[opaque-redacted]";
            return path === definition.entryPath || definition.sourcePaths.includes(path)
              ? path
              : "[nonfixture-redacted]";
          }),
          deliveryReceipt: {
            version: 1,
            kind: "review",
            fingerprint: deliveryReceipt.fingerprint,
          },
          deliveryReceiptSha256,
          verified: insightValid,
        });
      }

      const expectedSourcesPresent = definition.sourcePaths.length === observedNonAnchorPaths.size
        && definition.sourcePaths.every((path) => observedNonAnchorPaths.has(path));
      const observedInsightCount = snapshot.insights.length;
      const cacheEntryDelta = snapshot.cacheEntryCountAfter - snapshot.cacheEntryCountBefore;
      const zeroWriteValid = definition.expectedInsightCount !== 0 || (
        snapshot.resultStatus === "quiet"
        && snapshot.reason === "no-insight"
        && snapshot.collectionId === null
        && observedInsightCount === 0
        && snapshot.candidateCount === 0
        && snapshot.deliveryReceiptCount === 0
        && snapshot.cacheMutationCount === 0
        && cacheEntryDelta === 0
        && snapshot.quietWriteInvariantSatisfied === true
      );
      const positiveWriteValid = definition.expectedInsightCount === 0 || (
        snapshot.resultStatus === "verified"
        && normalizePageletInsightId(snapshot.collectionId)
        && observedInsightCount === definition.expectedInsightCount
        && snapshot.candidateCount === observedInsightCount
        && snapshot.deliveryReceiptCount === observedInsightCount
        && snapshot.cacheMutationCount === 1
        && (cacheEntryDelta === 0 || cacheEntryDelta === 1)
        && snapshot.quietWriteInvariantSatisfied === false
      );
      const status = observedInsightCount === definition.expectedInsightCount
        && verifiedInsightCount === definition.expectedInsightCount
        && expectedSourcesPresent
        && zeroWriteValid
        && positiveWriteValid
        && invalidInsightCount === 0
        && invalidSourceCount === 0
        && duplicateInsightIdCount === 0
        && duplicateCandidateCount === 0
        && duplicateReceiptCount === 0
        && duplicateSourceCount === 0
        && opaqueHitCount === 0
        && unexpectedSourceCount === 0
        ? "PASS"
        : "FAIL";
      const failures = [];
      if (observedInsightCount !== definition.expectedInsightCount) {
        failures.push(`expected exactly ${definition.expectedInsightCount} verified insight(s)`);
      }
      if (verifiedInsightCount !== definition.expectedInsightCount) {
        failures.push("one or more production insight receipts are invalid");
      }
      if (!expectedSourcesPresent) failures.push("expected Pagelet non-anchor source set is incomplete or different");
      if (!zeroWriteValid) failures.push("quiet Pagelet run wrote cache, candidate, collection, or receipt state");
      if (!positiveWriteValid) failures.push("verified Pagelet run did not commit one atomic collection");
      if (invalidInsightCount > 0) failures.push("invalid insight id");
      if (invalidSourceCount > 0) failures.push("invalid source path");
      if (duplicateInsightIdCount > 0) failures.push("duplicate insight id");
      if (duplicateCandidateCount > 0) failures.push("duplicate candidate id");
      if (duplicateReceiptCount > 0) failures.push("duplicate delivery receipt");
      if (duplicateSourceCount > 0) failures.push("duplicate non-anchor insight source");
      if (opaqueHitCount > 0) failures.push("opaque source was present");
      if (unexpectedSourceCount > 0) failures.push("unexpected Pagelet source was present");
      const detail = status === "PASS"
        ? `${verifiedInsightCount} production Pagelet insight receipt(s) bound to controller sequence ${controllerSequence}`
        : [...new Set(failures)].join("; ");
      const sourceBinding = {
        schemaVersion: snapshot.schemaVersion,
        sequence,
        controllerSequence,
        runId,
        resultId,
        triggerReason: snapshot.triggerReason,
        force: snapshot.force,
        resultStatus: snapshot.resultStatus,
        reason: snapshot.reason,
        collectionId: snapshot.collectionId,
      };
      const evidenceSha256 = await digest(JSON.stringify({
        id,
        entryPath: definition.entryPath,
        sourceBinding,
        candidateCount: snapshot.candidateCount,
        deliveryReceiptCount: snapshot.deliveryReceiptCount,
        cacheMutationCount: snapshot.cacheMutationCount,
        cacheEntryCountBefore: snapshot.cacheEntryCountBefore,
        cacheEntryCountAfter: snapshot.cacheEntryCountAfter,
        quietWriteInvariantSatisfied: snapshot.quietWriteInvariantSatisfied,
        insights: receipts,
      }));
      pageletEvidenceCursor = sequence;
      pageletEvidenceRunIds.add(runId);
      pageletEvidenceResultIds.add(resultId);
      pageletCases[id] = {
        id,
        status,
        entryPath: definition.entryPath,
        expectedInsightCount: definition.expectedInsightCount,
        observedInsightCount,
        verifiedInsightCount,
        insights: receipts,
        invalidInsightCount,
        invalidSourceCount,
        duplicateInsightIdCount,
        duplicateCandidateCount,
        duplicateReceiptCount,
        duplicateSourceCount,
        opaqueHitCount,
        unexpectedSourceCount,
        candidateCount: snapshot.candidateCount,
        deliveryReceiptCount: snapshot.deliveryReceiptCount,
        cacheMutationCount: snapshot.cacheMutationCount,
        cacheEntryCountBefore: snapshot.cacheEntryCountBefore,
        cacheEntryCountAfter: snapshot.cacheEntryCountAfter,
        quietWriteInvariantSatisfied: snapshot.quietWriteInvariantSatisfied,
        sourceBinding,
        evidenceSha256,
        detail,
        recordedAt: new Date().toISOString(),
      };
      result.pageletCases = pageletCases;
      manualCases[id] = {
        id,
        status,
        detail,
        recordedAt: pageletCases[id].recordedAt,
      };
      result.manualCases = manualCases;
      await writeResult();
      console.log(`[retrieval-smoke:${status}] Pagelet case ${id} recorded`);
      return clone(pageletCases[id]);
    });
  };

  const recordCase = async (id, status, detail = "") => {
    if (finalizing || finalized) {
      throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    }
    requireMeasurementSettingsStable();
    if (!REQUIRED_CASES.includes(id)) throw new Error(`Unknown retrieval smoke case: ${id}`);
    if (id === "chat-recovery") {
      throw new Error("Chat recovery must be recorded with recordRecoveryCase from pre-freeze diagnostics.");
    }
    if (id === "temporal-retry") {
      throw new Error(
        "Temporal retry must be recorded with recordTemporalRetryCase from post-freeze qualitative diagnostics.",
      );
    }
    if (REQUIRED_PAGELET_CASES.includes(id)) {
      throw new Error("Pagelet 0/1/2 cases must be recorded with recordPageletCase.");
    }
    if (!["PASS", "FAIL", "BLOCKED"].includes(status)) {
      throw new Error("Case status must be PASS, FAIL, or BLOCKED.");
    }
    manualCases[id] = {
      id,
      status,
      detail: sanitize(detail),
      recordedAt: new Date().toISOString(),
    };
    result.manualCases = manualCases;
    await writeResult();
    console.log(`[retrieval-smoke:${status}] manual case ${id} recorded`);
    return { ...manualCases[id] };
  };

  const recordRankingCase = (id, ...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    const definition = RANKING_CASES[id];
    if (!definition) return Promise.reject(new Error(`Unknown retrieval ranking case: ${id}`));
    if (unexpectedArguments.length !== 0) {
      return Promise.reject(new Error(
        "recordRankingCase does not accept source paths; leave the case PENDING and bind the exact live Chat turn.",
      ));
    }
    if (!frozenDevicePlan) {
      return Promise.reject(new Error("Freeze the device measurement plan before recording ranking evidence."));
    }
    if (runtimeEnvelopeState
      || (diagnosticsSessionStage && diagnosticsSessionStage !== "standardPerformance")) {
      return Promise.reject(new Error("Record ranking evidence before starting device performance diagnostics."));
    }
    if (diagnosticsSessionStage !== "standardPerformance" || !diagnosticsSessionIdentity) {
      return Promise.reject(new Error(
        "Record ranking evidence only in the active post-freeze qualitative diagnostics session.",
      ));
    }
    if (rankingCases[id].status !== "PENDING") {
      return Promise.reject(new Error(
        "Retrieval ranking case is already recorded; repeat it in a new smoke run.",
      ));
    }
    if (!measurementSettingsAreStable()) {
      return Promise.reject(new Error(
        "Retrieval, Boundary, provider, or selected reranker settings changed during this smoke run.",
      ));
    }

    return enqueueDiagnosticsOperation(async () => {
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      if (!frozenDevicePlan
        || runtimeEnvelopeState
        || diagnosticsSessionStage !== "standardPerformance"
        || !diagnosticsSessionIdentity) {
        throw new Error("The post-freeze qualitative diagnostics session is no longer active.");
      }
      if (rankingCases[id].status !== "PENDING") {
        throw new Error("Retrieval ranking case is already recorded; repeat it in a new smoke run.");
      }
      if (!measurementSettingsAreStable()) {
        throw new Error("Retrieval, Boundary, provider, or selected reranker settings changed during this smoke run.");
      }

      let projection;
      try {
        projection = projectBoundRetrievalDiagnostics(
          await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId),
          diagnosticsSessionIdentity,
        );
      } catch {
        throw new Error("Post-freeze ranking diagnostics could not be captured.");
      }
      if (projection.droppedEventCount !== 0) {
        throw new Error("Post-freeze ranking diagnostics are incomplete because events were dropped.");
      }
      const newEvents = projection.events.filter((event) => event.sequence > rankingEvidenceCursor);
      const partition = partitionMeasurementEpisodes(newEvents);
      const episode = partition.episodes.length === 1 ? partition.episodes[0] : null;
      if (partition.surfaceMismatchEvents.length !== 0
        || partition.unscopedEvents.length !== 0
        || partition.episodes.length !== 1
        || episode?.complete !== true
        || episode.structurallyInvalid
        || ![1, 2].includes(episode.standardCallCount)
        || episode.standardAttempts.length !== episode.standardCallCount
        || episode.standardTerminals.length !== episode.standardCallCount
        || episode.standardAttempts.some((attempt) => (
          attempt.terminal?.outcome !== "completed"
        ))
        || episode.standardTerminals.some((terminal) => terminal.outcome !== "completed")
        || episode.relaxedStartedCount !== 0
        || episode.relaxedAttempts.length !== 0
        || episode.relaxedTerminals.length !== 0
        || episode.projectionStartedCount !== 0
        || episode.projectionTerminals.length !== 0
        || episode.attempts.some((attempt) => !attempt.terminal)) {
        throw new Error(
          "Record each ranking case immediately after one complete post-freeze search_memory episode.",
        );
      }

      const canonicalProjection = readLatestCanonicalMemoryProjection(definition.prompt);
      const sourceBinding = await bindCanonicalRunToEpisode(canonicalProjection, episode);
      const rankedPaths = canonicalProjection.finalPaths;
      const canonicalPaths = [];
      let invalidSourceCount = rankedPaths.length > 8 ? rankedPaths.length - 8 : 0;
      for (const rawPath of rankedPaths.slice(0, 8)) {
        const canonicalPath = normalizeRankedPath(rawPath);
        if (!canonicalPath || canonicalPaths.includes(canonicalPath)) {
          invalidSourceCount += 1;
          continue;
        }
        canonicalPaths.push(canonicalPath);
      }
      const relevantIndex = canonicalPaths.indexOf(definition.relevantPath);
      const forbiddenHitCount = invalidSourceCount + canonicalPaths.filter((path) => (
        definition.forbiddenPaths.includes(path)
        || isOpaqueOrExcludedPath(path)
      )).length;
      const relevantRank = relevantIndex >= 0 ? relevantIndex + 1 : null;
      const status = relevantRank !== null && forbiddenHitCount === 0 ? "PASS" : "FAIL";
      const evidenceEvents = episode.events;
      const evidence = {
        deviceMeasurementPlanSha256: result.deviceMeasurement.planSha256,
        startSequence: evidenceEvents[0]?.sequence ?? null,
        endSequence: evidenceEvents.at(-1)?.sequence ?? null,
        standardCallCount: episode.standardCallCount,
        memoryAttemptCount: episode.attempts.length,
        sourceBinding,
        evidenceSha256: await digest(JSON.stringify({
          finalPaths: canonicalPaths,
          sourceBinding,
          diagnostics: evidenceEvents,
        })),
      };
      rankingEvidenceCursor = newEvents.at(-1)?.sequence ?? rankingEvidenceCursor;
      rankingCases[id] = {
        id,
        status,
        rankedSources: canonicalPaths.map((path) => {
          if (isOpaqueOrExcludedPath(path)) return "[opaque-redacted]";
          return ALLOWED_FIXTURES.includes(path) ? path : "[nonfixture-redacted]";
        }),
        relevantRank,
        reciprocalRank: relevantRank === null ? 0 : Number((1 / relevantRank).toFixed(6)),
        forbiddenHitCount,
        evidence,
        recordedAt: new Date().toISOString(),
      };
      result.rankingCases = rankingCases;
      updateRerankerMetrics();
      evaluateRerankerGate();
      await writeResult();
      console.log(`[retrieval-smoke:${status}] ranking case ${id} recorded`);
      return clone(rankingCases[id]);
    });
  };

  const updateOverallStatus = () => {
    const hasFailure = checks.some((entry) => entry.status === "FAIL")
      || Object.values(manualCases).some((entry) => entry.status === "FAIL")
      || result.recoveryCase.status === "FAIL"
      || Object.values(pageletCases).some((entry) => entry.status === "FAIL")
      || Object.values(rankingCases).some((entry) => entry.status === "FAIL")
      || result.deviceMeasurement.overall === "FAIL";
    const hasBlockedPreflight = checks.some((entry) => (
      entry.status === "BLOCKED" && entry.blocking !== false
    ));
    const allManualPass = REQUIRED_CASES.every((id) => manualCases[id].status === "PASS");
    const recoveryPass = result.recoveryCase.status === "PASS";
    const pageletPass = REQUIRED_PAGELET_CASES.every((id) => pageletCases[id].status === "PASS");
    const allRankingPass = REQUIRED_RANKING_CASES.every((id) => (
      rankingCases[id].status === "PASS"
    ));
    result.overall = hasFailure
      ? "FAIL"
      : allManualPass && recoveryPass && pageletPass && allRankingPass && !hasBlockedPreflight
        ? "PASS"
        : "BLOCKED";
  };

  const finalize = async () => {
    if (finalized) return snapshotResult();
    if (finalizing) throw new Error("Retrieval smoke finalization is already in progress.");
    finalizing = true;
    try {
      // Drain an in-flight transition before inspecting/stopping its envelope.
      // Operations queued before finalization but not yet started reject at the
      // queue boundary, so none can mutate the receipt after the final cutoff.
      await performanceTransitionOperationQueue;
      await performanceEvidenceOperationQueue;
      if (runtimeEnvelopeState) await stopRuntimeEnvelopeImpl();
      await pageletEvidenceOperationQueue;
      await enqueueDiagnosticsOperation(stopRetrievalDiagnosticsImpl);
      await externalMemoryEvidenceOperationQueue;
      await verifyRuntimeAndArtifactIdentityAtFinalize();

      let fixturesStable = true;
      for (const path of [...ALLOWED_FIXTURES, ...OPAQUE_FIXTURES]) {
        const currentHash = await readAndHash(path);
        if (sourceHashes.get(path) !== currentHash) fixturesStable = false;
      }
      assert("Fixture Markdown is unchanged by the smoke", fixturesStable);

      const settingsStable = measurementSettingsAreStable();
      assert("Retrieval and Boundary settings are unchanged by the recorder", settingsStable);

      const visibleText = document.body?.innerText || document.body?.textContent || "";
      assert("Opaque bridge content is absent from visible UI", !visibleText.includes(OPAQUE_SENTINEL));

      const planFrozen = Boolean(frozenDevicePlan);
      record(
        "Device measurement plan is frozen before evidence collection",
        planFrozen ? "PASS" : "BLOCKED",
        planFrozen ? result.deviceMeasurement.planSha256 : "freeze the versioned plan before sampling",
      );
      const devicePlanStable = planFrozen
        && frozenDevicePlanCanonical === JSON.stringify(frozenDevicePlan);
      if (planFrozen) assert("Frozen device measurement plan is unchanged", devicePlanStable);
      evaluateRerankerGate();
      const requiredDeviceMetrics = frozenDevicePlan?.requiredMetrics || [];
      const missingOrBlockedDeviceMetrics = requiredDeviceMetrics.filter((definition) => (
        result.deviceMeasurement.metrics[definition.id]?.status !== "PASS"
      ));
      const failedDeviceMetrics = requiredDeviceMetrics.filter((definition) => (
        result.deviceMeasurement.metrics[definition.id]?.status === "FAIL"
      ));
      const deviceFailed = failedDeviceMetrics.length > 0
        || result.deviceMeasurement.rerankerGate.status === "FAIL"
        || result.deviceMeasurement.workloadBinding.status === "INVALID";
      const deviceBlocked = !planFrozen
        || missingOrBlockedDeviceMetrics.length > 0
        || result.deviceMeasurement.rerankerGate.status === "BLOCKED"
        || result.deviceMeasurement.diagnosticsGate.status !== "PASS"
        || result.deviceMeasurement.workloadBinding.status !== "PASS";
      result.deviceMeasurement.overall = deviceFailed ? "FAIL" : deviceBlocked ? "BLOCKED" : "PASS";
      record(
        "Frozen performance workload is qualified and bound episode by episode",
        result.deviceMeasurement.workloadBinding.status === "PASS"
          ? "PASS"
          : result.deviceMeasurement.workloadBinding.status === "INVALID" ? "FAIL" : "BLOCKED",
        result.deviceMeasurement.workloadBinding.status === "PASS"
          ? ""
          : `${result.deviceMeasurement.workloadBinding.boundEpisodeCount}/${result.deviceMeasurement.workloadBinding.expectedEpisodeCount} episode binding(s)`,
      );
      record(
        "Required device metrics and reranker gate are complete",
        result.deviceMeasurement.overall,
        result.deviceMeasurement.overall === "PASS"
          ? ""
          : `${missingOrBlockedDeviceMetrics.length} required metric(s) are not passing; reranker=${result.deviceMeasurement.rerankerGate.status}; diagnostics=${result.deviceMeasurement.diagnosticsGate.status}`,
      );

      // All non-final receipt writes must settle before the evidence cutoff so
      // the cutoff is followed by exactly one serialization/write operation.
      await writeQueue;
      receiptCommitCriticalSectionActive = true;
      const preCommitIdentityStable = await runtimeAndArtifactIdentityAreStable();
      const preCommitSettingsStable = settingsAdmissionGuardInstalled
        && measurementSettingsAreStable();
      const commitBindingCheck = record(
        "Plugin lifecycle, artifact, and settings bindings are stable at receipt commit",
        preCommitIdentityStable && preCommitSettingsStable
          ? "PASS"
          : "BLOCKED",
        preCommitIdentityStable && preCommitSettingsStable
          ? ""
          : "one or more receipt bindings changed before the final write",
      );
      updateOverallStatus();
      result.finishedAt = new Date().toISOString();
      let committedSnapshot = null;
      try {
        await writeResultAtCommit(() => {
          updateOverallStatus();
          committedSnapshot = snapshotResult();
        });
      } catch (error) {
        commitBindingCheck.status = "BLOCKED";
        commitBindingCheck.detail = "the final receipt write did not commit";
        result.finishedAt = null;
        updateOverallStatus();
        throw error;
      }
      receiptCommitCriticalSectionActive = false;
      finalized = true;
      runnerGuard.finished = true;
      try {
        console.log("[retrieval-smoke:RESULT]", result);
      } catch {
        // Logging must not turn a committed receipt into a rejected finalization.
      }
      return committedSnapshot;
    } catch (error) {
      // A failed finalization is terminal for this recorder. Release every
      // reversible guard before the best-effort non-PASS receipt write so a
      // fresh runner can start even when that write also fails.
      receiptCommitCriticalSectionActive = false;
      result.finishedAt = null;
      if (result.overall !== "FAIL") result.overall = "BLOCKED";
      finalized = true;
      runnerGuard.finished = true;
      teardownRunnerIntegrity();
      if (globalThis.paRetrievalSmoke?.finalize === finalize) {
        try {
          delete globalThis.paRetrievalSmoke;
        } catch {
          // The finished runner guard still admits a fresh replacement below.
        }
      }
      try {
        await writeResult();
      } catch (writeError) {
        console.warn("[retrieval-smoke] failed to persist non-PASS finalization state", writeError);
      }
      throw error;
    } finally {
      receiptCommitCriticalSectionActive = false;
      finalizing = false;
      if (finalized) {
        runnerGuard.finished = true;
        teardownRunnerIntegrity();
      }
    }
  };

  const runnerGuardKey = "__paRetrievalSmokeRunnerGuard";
  const existingRunnerGuard = globalThis[runnerGuardKey];
  const existingRecorder = globalThis.paRetrievalSmoke;
  const hasMatchingRunnerGuard = existingRunnerGuard?.fixtureVersion === FIXTURE_VERSION;
  if ((hasMatchingRunnerGuard && !existingRunnerGuard.finished)
    || (!hasMatchingRunnerGuard
      && existingRecorder?.fixtureVersion === FIXTURE_VERSION
      && !existingRecorder.result?.finishedAt)) {
    console.warn("[retrieval-smoke] an unfinished recorder is already active; reuse it instead of starting a second session");
    return;
  }
  const runnerGuard = { fixtureVersion: FIXTURE_VERSION, finished: false };
  globalThis[runnerGuardKey] = runnerGuard;

  try {
    plugin = app.plugins.plugins[PLUGIN_ID];
    initialLoadedPluginInstance = plugin;
    assert("Personal Assistant plugin is loaded", Boolean(plugin));
    assert("Memory runtime is available", Boolean(plugin?.vss && plugin?.memoryManager));
    pluginLifecycleGuardInstalled = installPluginLifecycleGuard();
    record(
      "Loaded plugin lifecycle changes are observable for the full receipt window",
      pluginLifecycleGuardInstalled ? "PASS" : "BLOCKED",
      pluginLifecycleGuardInstalled
        ? ""
        : "the plugin registry cannot install a reversible lifecycle guard",
    );

    try {
      initialRuntimeIdentity = await captureCurrentRuntimeIdentity();
      record("Exact Obsidian app, shell, runtime, and plugin identity is captured", "PASS");
    } catch (error) {
      record(
        "Exact Obsidian app, shell, runtime, and plugin identity is captured",
        "BLOCKED",
        error?.message || String(error),
      );
      result.overall = "BLOCKED";
      result.finishedAt = new Date().toISOString();
      runnerGuard.finished = true;
      await writeResult();
      teardownRunnerIntegrity();
      return;
    }

    try {
      initialArtifactIdentity = await captureCurrentArtifactIdentity();
      result.identity.runnerSha256 = initialArtifactIdentity.runnerSha256;
      result.identity.pluginArtifactSha256 = initialArtifactIdentity.pluginArtifactSha256;
      result.identity.loadedPluginArtifactSha256 =
        initialArtifactIdentity.loadedPluginArtifactSha256;
      result.identity.loadedPluginBuildIdentitySha256 =
        initialArtifactIdentity.loadedPluginBuildIdentitySha256;
      record("Loaded plugin and current vault artifact identities match", "PASS");
    } catch (error) {
      record(
        "Loaded plugin and current vault artifact identities match",
        "BLOCKED",
        error?.message || String(error),
      );
      result.overall = "BLOCKED";
      result.finishedAt = new Date().toISOString();
      runnerGuard.finished = true;
      await writeResult();
      teardownRunnerIntegrity();
      return;
    }

    settingsFingerprint = fingerprintSettings(plugin);
    settingsAdmissionGuardInstalled = installSettingsAdmissionGuard(plugin);
    record(
      "Retrieval settings mutations are latched before provider and diagnostics admission",
      settingsAdmissionGuardInstalled ? "PASS" : "BLOCKED",
      settingsAdmissionGuardInstalled
        ? ""
        : "the loaded settings object cannot install a reversible admission guard",
    );
    diagnosticsSettingsGuardInstalled = installDiagnosticsSettingsGuard(plugin);
    record(
      "Retrieval diagnostics event admission is bound to the initial settings fingerprint",
      diagnosticsSettingsGuardInstalled ? "PASS" : "BLOCKED",
      diagnosticsSettingsGuardInstalled
        ? ""
        : "the loaded diagnostics recorder cannot observe settings at event admission",
    );
    unsubscribeSettings = typeof plugin?.onSettingsChanged === "function"
      ? plugin.onSettingsChanged(() => {
        observeMeasurementSettings();
      })
      : null;

    diagnosticsSeamAvailable = [
      "startRetrievalDiagnostics",
      "getRetrievalDiagnostics",
      "stopRetrievalDiagnostics",
      "armRetrievalCancellationProbe",
    ].every((method) => typeof plugin?.[method] === "function");
    pageletEvidenceSeamAvailable = typeof plugin?.getPageletDeepDiscoverSmokeSnapshot === "function";
    if (pageletEvidenceSeamAvailable) {
      try {
        const existingPageletEvidence = await plugin.getPageletDeepDiscoverSmokeSnapshot();
        if (existingPageletEvidence !== null) {
          if (!Number.isSafeInteger(existingPageletEvidence?.sequence)
            || existingPageletEvidence.sequence <= 0) {
            pageletEvidenceSeamAvailable = false;
          } else {
            pageletEvidenceCursor = existingPageletEvidence.sequence;
          }
        }
      } catch {
        pageletEvidenceSeamAvailable = false;
      }
    }
    record(
      "Pagelet smoke evidence is bound to a fresh real controller result",
      pageletEvidenceSeamAvailable ? "PASS" : "BLOCKED",
      pageletEvidenceSeamAvailable
        ? ""
        : "the loaded plugin cannot provide a content-free Pagelet controller snapshot",
    );
    await startDiagnosticsSession("preFreeze", "Retrieval diagnostics session seam is available");
    const flags = plugin?.settings?.retrievalOptimizationFlags || {};
    const disabledFlags = REQUIRED_FLAGS.filter((key) => flags[key] !== true);
    record(
      "All retrieval rollout flags are enabled for this isolated smoke",
      disabledFlags.length === 0 ? "PASS" : "BLOCKED",
      disabledFlags.length === 0 ? "" : `${disabledFlags.length} required flag(s) remain off`,
    );

    const excludedFolders = plugin?.settings?.dataBoundary?.excludedFolders || [];
    record(
      "Synthetic opaque folder is configured in Data Boundary",
      excludedFolders.includes("retrieval-smoke/excluded") ? "PASS" : "BLOCKED",
      excludedFolders.includes("retrieval-smoke/excluded") ? "" : "configure the isolated fixture folder before testing",
    );

    const manifestText = await app.vault.adapter.read(MANIFEST_PATH);
    const manifestSha256 = await digest(manifestText);
    assert(
      "Smoke manifest matches the canonical repository identity",
      manifestSha256 === EXPECTED_MANIFEST_SHA256,
    );
    if (manifestSha256 !== EXPECTED_MANIFEST_SHA256) {
      throw new Error("Retrieval smoke manifest identity mismatch.");
    }
    const manifest = JSON.parse(manifestText);
    const expandedPerformanceWorkload = expandPerformanceWorkloadContract(
      manifest.deviceMeasurementPlan?.performanceWorkload,
    );
    performanceWorkloadContract = expandedPerformanceWorkload.workload;
    performanceWorkloadSequence = expandedPerformanceWorkload.sequence;
    await refreshPerformanceWorkloadBinding();
    const expectedPaths = [...ALLOWED_FIXTURES, ...OPAQUE_FIXTURES].sort();
    const manifestPaths = Object.keys(manifest.files || {}).sort();
    const manifestShapeMatches = manifest.fixtureVersion === FIXTURE_VERSION
      && JSON.stringify(manifest.requiredCases) === JSON.stringify(REQUIRED_CASES)
      && JSON.stringify(manifest.requiredRankingCases) === JSON.stringify(REQUIRED_RANKING_CASES)
      && JSON.stringify(manifest.rankingCases) === JSON.stringify(RANKING_CASES)
      && JSON.stringify(manifest.routingObservations) === JSON.stringify(ROUTING_OBSERVATIONS)
      && manifest.recoveryCase?.prompt === RECOVERY_PROMPT
      && manifest.recoveryCase?.targetPath === RECOVERY_TARGET_FIXTURE
      && JSON.stringify(manifest.recoveryCase?.standardInsufficientPaths)
        === JSON.stringify(RECOVERY_STANDARD_FIXTURES)
      && JSON.stringify(manifest.recoveryCase?.finalSourceContract)
        === JSON.stringify(RECOVERY_FINAL_SOURCE_CONTRACT)
      && manifest.temporalRetryCase?.prompt === TEMPORAL_RETRY_PROMPT
      && JSON.stringify(manifest.temporalRetryCase?.timeRange)
        === JSON.stringify(TEMPORAL_RETRY_TIME_RANGE)
      && manifest.temporalRetryCase?.targetPath === TEMPORAL_RETRY_TARGET_FIXTURE
      && manifest.temporalRetryCase?.forbiddenPath === TEMPORAL_RETRY_FORBIDDEN_FIXTURE
      && JSON.stringify(manifest.temporalRetryCase?.standardInsufficientPaths)
        === JSON.stringify(TEMPORAL_RETRY_STANDARD_FIXTURES)
      && JSON.stringify(manifest.temporalRetryCase?.finalSourceContract)
        === JSON.stringify(TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT)
      && JSON.stringify(manifest.pageletCases) === JSON.stringify(PAGELET_CASES)
      && manifest.deviceMeasurementPlan?.version === "b125-device-measurement-v9"
      && manifest.deviceMeasurementPlan?.percentileMethod === "nearest-rank"
      && JSON.stringify(manifest.deviceMeasurementPlan?.performanceWorkload)
        === JSON.stringify(performanceWorkloadContract)
      && JSON.stringify(manifestPaths) === JSON.stringify(expectedPaths);
    assert("Smoke manifest contract matches the runner", manifestShapeMatches);
    if (!manifestShapeMatches) throw new Error("Retrieval smoke manifest contract mismatch.");
    devicePlanTemplate = normalizeDevicePlan(manifest.deviceMeasurementPlan);

    let fixtureDigestMismatches = 0;
    for (const path of expectedPaths) {
      const currentHash = await readAndHash(path);
      sourceHashes.set(path, currentHash);
      if (manifest.files[path] !== currentHash) fixtureDigestMismatches += 1;
    }
    assert(
      "Synthetic fixture pack matches the canonical manifest",
      fixtureDigestMismatches === 0,
      fixtureDigestMismatches === 0 ? `${sourceHashes.size} files` : `${fixtureDigestMismatches} digest mismatch(es)`,
    );
    if (fixtureDigestMismatches > 0) throw new Error("Retrieval smoke fixture identity mismatch.");

    const expectedTemporalMtimePaths = [
      OLD_TEMPORAL_FIXTURE,
      RECENT_TEMPORAL_FIXTURE,
      ...TEMPORAL_RETRY_ALLOWED_FIXTURES,
      TEMPORAL_RETRY_FORBIDDEN_FIXTURE,
    ].sort();
    const manifestTemporalMtimePaths = Object.keys(manifest.temporalFixtureMtimes || {}).sort();
    let temporalMtimeMismatchCount = JSON.stringify(expectedTemporalMtimePaths)
      === JSON.stringify(manifestTemporalMtimePaths) ? 0 : 1;
    const actualTemporalFixtureMtimes = {};
    for (const path of expectedTemporalMtimePaths) {
      const actualMtime = app.vault.getAbstractFileByPath?.(path)?.stat?.mtime;
      const expectedMtime = Date.parse(manifest.temporalFixtureMtimes?.[path]);
      if (!Number.isFinite(actualMtime)
        || !Number.isFinite(expectedMtime)
        || Math.abs(actualMtime - expectedMtime) >= 1_000) {
        temporalMtimeMismatchCount += 1;
        continue;
      }
      actualTemporalFixtureMtimes[path] = new Date(actualMtime).toISOString();
    }
    assert(
      "Temporal fixture mtimes match the canonical manifest",
      temporalMtimeMismatchCount === 0,
      temporalMtimeMismatchCount === 0
        ? `${expectedTemporalMtimePaths.length} temporal fixtures`
        : `${temporalMtimeMismatchCount} temporal mtime mismatch(es)`,
    );
    if (temporalMtimeMismatchCount > 0) {
      throw new Error("Retrieval smoke temporal mtimes mismatch.");
    }

    result.identity.manifestSha256 = manifestSha256;
    result.identity.fixtureBundleSha256 = await digest(JSON.stringify(
      Object.entries(manifest.files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    ));
    result.identity.temporalFixtureMtimes = actualTemporalFixtureMtimes;
    assert("Smoke runner artifact identity is captured", /^[a-f0-9]{64}$/.test(result.identity.runnerSha256));

    const resolvedLinks = app.metadataCache?.resolvedLinks || {};
    const seedLinks = resolvedLinks["retrieval-smoke/graph/10-seed-a.md"] || {};
    const bridgeLinks = resolvedLinks[OPAQUE_FIXTURES[0]] || {};
    assert("Allowed-to-opaque graph edge is resolved", Object.keys(seedLinks).some((path) => path.endsWith("20-opaque-bridge.md")));
    assert("Opaque-to-allowed graph edge is resolved", Object.keys(bridgeLinks).some((path) => path.endsWith("30-deep-target.md")));

    const snapshot = plugin?.vss?.getMemoryStatusSnapshot?.() || null;
    const rerankerDescriptor = selectedRerankerDescriptor(plugin);
    const rerankerClass = rerankerDescriptor.class;
    result.runtime = {
      ...initialRuntimeIdentity,
      rerankerClass,
      rerankerIdentitySha256: await digest(JSON.stringify(rerankerDescriptor)),
      memoryStatus: snapshot ? {
        status: snapshot.status,
        indexedDocumentCount: snapshot.indexedDocumentCount,
        lexicalProfileState: snapshot.lexicalProfileState,
        lexicalFallbackReason: snapshot.lexicalFallbackReason,
      } : null,
    };
    record(
      "Memory index is ready for provider-backed smoke",
      snapshot?.status === "ready" ? "PASS" : "BLOCKED",
      snapshot?.status || "unavailable",
    );
    record(
      "CHAR-PHRASE lexical generation is active",
      snapshot?.lexicalProfileState === "ready" ? "PASS" : "BLOCKED",
      snapshot?.lexicalFallbackReason || snapshot?.lexicalProfileState || "unavailable",
    );
    record(
      "Selected reranker model class is available",
      rerankerClass === "none" ? "BLOCKED" : "PASS",
      rerankerClass === "none" ? "configure a Chat model before testing" : rerankerClass,
    );

    globalThis.paRetrievalSmoke = Object.freeze({
      fixtureVersion: FIXTURE_VERSION,
      checklist,
      rankingChecklist,
      routingChecklist,
      get result() {
        return snapshotResult();
      },
      get nextPerformanceWorkload() {
        return nextPerformanceWorkloadValue();
      },
      recordCase,
      recordRecoveryCase,
      recordTemporalRetryCase,
      recordPageletCase,
      recordRankingCase,
      freezeDeviceMeasurementPlan,
      recordPerformanceQualification,
      recordPerformanceEpisode,
      recordDeviceMetric,
      sampleEventLoopGap,
      startRuntimeEnvelope,
      beginRetryPerformance,
      continueRetryPerformance,
      stopRuntimeEnvelope,
      recordExternalMemoryEnvelope,
      sampleLongTasks,
      recordVssStats,
      recordDiagnosticsSnapshot,
      captureRetrievalDiagnostics,
      stopRetrievalDiagnostics,
      beginCancellationProbe,
      finalize,
    });
    await writeResult();
    console.log("[retrieval-smoke] automated preflight complete; manual cases remain PENDING until explicitly recorded");
    console.table(Object.entries(checklist).map(([id, value]) => ({ id, ...value })));
    console.table(Object.entries(rankingChecklist).map(([id, value]) => ({ id, ...value })));
    console.table(Object.entries(routingChecklist).map(([id, value]) => ({ id, ...value })));
  } catch (error) {
    teardownRunnerIntegrity();
    await enqueueDiagnosticsOperation(stopRetrievalDiagnosticsImpl);
    record("Runner initialization", "FAIL", error?.stack || String(error));
    result.overall = "FAIL";
    result.finishedAt = new Date().toISOString();
    runnerGuard.finished = true;
    try {
      await writeResult();
    } catch (writeError) {
      console.warn("[retrieval-smoke] failed to write result", writeError);
    }
  }
})();
