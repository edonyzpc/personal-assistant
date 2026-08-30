/*
 * Historical retrieval-optimization aggregate/performance recorder.
 *
 * This script intentionally performs no provider call, source mutation, or
 * automatic PASS of a Chat/Pagelet case. Strict-v9 does not mutate settings;
 * compact-proxy permits only its declared control-to-evaluated flag transition
 * and terminal restoration. Both performance profiles are optional B-127 tools,
 * not B-125 gates. Do not run or repair them for normal B-125 validation; follow
 * the targeted independent-slice instructions emitted by
 * prepare-retrieval-optimization-smoke.mjs instead.
 *
 * Only after an explicit B-127 authorization, prepare the synthetic fixture pack,
 * apply the selected profile in the isolated test vault, load changed plugin assets
 * through plugin reload (runner-only changes require no plugin reload), then run:
 *
 *   eval(await app.vault.adapter.read("retrieval-optimization-smoke-runner.js"))
 *
 * Optional B-127 compact proxy profile (real iPhone WKWebView, all four flags off):
 *   globalThis.paRetrievalSmokeProfile = "compact-proxy"
 *   globalThis.paRetrievalSmokeDeviceIdentitySha256 = "<opaque SHA-256 for this iPhone>"
 *   eval(await app.vault.adapter.read("retrieval-optimization-smoke-runner.js"))
 *   await paRetrievalSmoke.startCompactProxy()
 *   // Bind the advertised six control prompts in fresh Chats.
 *   await paRetrievalSmoke.beginCompactEvaluated()
 *   // beginCompactEvaluated() automatically rebuilds and binds the evaluated
 *   // lexical generation before opening the empty correctness evidence window.
 *   // Choose exactly one ordering:
 *   // (A) early correctness: Recovery first, then the other correctness slices,
 *   //     then incremental maintenance and performance;
 *   // (B) deferred correctness: run no correctness retrieval in this empty
 *   //     window, bind incremental maintenance, finish performance + cancellation,
 *   //     call beginCompactCorrectness(), then run Recovery first and the rest.
 *   // Invoke and bind the diagnostics-only indexed-chunks incremental receipt.
 *   await paRetrievalSmoke.recordCompactMaintenance("incremental-update")
 *   await paRetrievalSmoke.beginCompactPerformance()
 *   // Bind 13 standard episodes, 13 retry episodes, then stop and bind one
 *   // cancellation probe.
 *   // Finalize restores the initial flag profile. A complete receipt is
 *   // READY_FOR_OWNER_REVIEW; the runner never emits PASS.
 *
 * Record an observed case:
 *   await paRetrievalSmoke.recordCase("lexical", "PASS", "observed result")
 * In strict-v9, run the frozen Chat recovery canary as the first retrieval after
 * runner setup and before freezing the device plan. In compact-proxy, run it as
 * the first retrieval in the fresh all-flags-on compactCorrectness session after
 * beginCompactEvaluated() or beginCompactCorrectness(). Then bind that isolated
 * diagnostics topology to the live completed Chat turn's canonical cumulative
 * Memory projection (never DOM/source-chip text):
 *   // Ask exactly: 只从我的笔记中回答：RCV-271 猩红雨伞事故的根因是什么？
 *   await paRetrievalSmoke.recordRecoveryCase()
 * Bind each Pagelet observation to its exact insight ids and source paths:
 *   await paRetrievalSmoke.recordPageletCase("pagelet-0")
 *   await paRetrievalSmoke.recordPageletCase("pagelet-1")
 *   await paRetrievalSmoke.recordPageletCase("pagelet-2")
 * Freeze explicit device thresholds and the reranker gate before collecting
 * strict performance evidence (correctness evidence may already be recorded):
 *   await paRetrievalSmoke.freezeDeviceMeasurementPlan({ thresholds })
 * Run the explicit-range temporal retry canary in the active correctness
 * diagnostics session before the performance envelope:
 *   // Ask exactly: 只从我的笔记中，仅使用 2026-01-01 到 2026-12-31 的记录回答：TRT-826 紫晶日晷事故的根因是什么？
 *   await paRetrievalSmoke.recordTemporalRetryCase()
 * The canonical plan intentionally leaves calibration thresholds pending/null;
 * it cannot pass until the operator supplies and freezes reviewed thresholds.
 * Record the exact final source-chip order for a ranking case in the active
 * correctness diagnostics session before starting the performance envelope:
 *   await paRetrievalSmoke.recordRankingCase("lexical-title")
 * After freezing the strict performance plan, qualify live fresh-Chat standard
 * and retry shapes immediately after each exact prompt completes:
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
  const STRICT_PROFILE = "strict-v9";
  const COMPACT_PROFILE = "compact-proxy";
  const ACTIVE_PROFILE = globalThis.paRetrievalSmokeProfile ?? STRICT_PROFILE;
  if (![STRICT_PROFILE, COMPACT_PROFILE].includes(ACTIVE_PROFILE)) {
    throw new Error(`Unsupported retrieval smoke profile: ${String(ACTIVE_PROFILE)}`);
  }
  const IS_COMPACT_PROXY = ACTIVE_PROFILE === COMPACT_PROFILE;
  const COMPACT_DEVICE_IDENTITY_SHA256 = IS_COMPACT_PROXY
    ? globalThis.paRetrievalSmokeDeviceIdentitySha256 ?? null
    : null;
  const RESULT_PATH = "retrieval-optimization-smoke-result.json";
  const MANIFEST_PATH = "retrieval-optimization-smoke-manifest.json";
  const RUNNER_PATH = "retrieval-optimization-smoke-runner.js";
  const EXTERNAL_MEMORY_ARTIFACT_PATH = "retrieval-smoke/evidence/system-memory-envelope.json";
  const EXTERNAL_MEMORY_RAW_EXPORT_PATH = "retrieval-smoke/evidence/system-memory-envelope.instruments.xml";
  const EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON = "external_memory_converter_unverified";
  const EXPECTED_MANIFEST_SHA256 = "00bc94cdd8b05051c9ff689f5377bc8f302e98c146fa7e414b4145d874c859db";
  const MIN_DIAGNOSTICS_SESSION_CAPACITY = 512;
  const RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION = 1;
  const GRAPH_QUEUE_RELEASE_ABSOLUTE_ENVELOPE_MS = 8_000;
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
  const COMPACT_PROXY_VERSION = "b125-compact-proxy-v1";
  const COMPACT_STAGE_COUNTS = Object.freeze({
    controlStandard: 6,
    evaluatedStandard: 13,
    evaluatedRetry: 13,
    cancellationProbe: 1,
  });
  const COMPACT_STAGE_PROMPTS = Object.freeze({
    controlStandard: "standard-v1",
    evaluatedStandard: "standard-v1",
    evaluatedRetry: "retry-v1",
    cancellationProbe: "cancel-v1",
  });
  const COMPACT_STAGE_SETTINGS_PHASES = Object.freeze({
    controlStandard: "control",
    evaluatedStandard: "evaluated",
    evaluatedRetry: "evaluated",
    cancellationProbe: "evaluated",
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
    invalidSourceCount: 0,
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
  let compactSettingsTransitionActive = false;
  let compactExpectedSettingsFingerprint = null;
  let compactStableSettingsProfileSha256 = null;
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
  let diagnosticsLastStartError = null;
  const ownedDiagnosticsSessions = new Map();
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
  let compactProxyPlanTemplate = null;
  let compactProxyWorkloadContract = null;
  let compactInitialRetrievalFlagsState = null;
  let compactProxyWorkloadSequence = [];
  let compactProxyCurrentStage = null;
  let compactProxyResourceState = null;
  let compactProxyEvidenceOperationQueue = Promise.resolve();
  let compactProxyTransitionOperationQueue = Promise.resolve();
  let compactProxyMaintenanceOperationQueue = Promise.resolve();
  let compactProxyPublicMutationQueue = Promise.resolve();
  const compactProxyPoison = {
    latched: false,
    epoch: 0,
    stage: null,
    reason: null,
    reported: false,
  };
  let scheduleCompactProxyPoisonCleanup = () => {};
  let poisonCompactProxyFromRuntime = () => {};
  let compactProxyPublicMutationActive = false;
  let compactProxyPoisonHandled = false;
  let compactProxyFinalizationFence = false;
  const compactAutomaticRebuildToken = Object.freeze({});
  let compactLexicalIdentityDriftDetected = false;
  let compactMarkdownMutationCount = 0;
  let compactMarkdownMutationGuardInstalled = false;
  const compactMarkdownMutationEventRefs = [];
  const compactProxyStageCursors = Object.fromEntries(
    Object.keys(COMPACT_STAGE_COUNTS).map((stage) => [stage, 0]),
  );
  const compactProxyEvidenceRunIds = new Set();
  const compactMaintenanceOperationIds = new Set();
  const compactProxyStageResources = Object.fromEntries(
    Object.keys(COMPACT_STAGE_COUNTS).map((stage) => [stage, null]),
  );

  const result = {
    fixtureVersion: FIXTURE_VERSION,
    ...(IS_COMPACT_PROXY ? { profile: COMPACT_PROFILE } : {}),
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
      ...(IS_COMPACT_PROXY ? { compactProxyPlanSha256: null } : {}),
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
    ...(IS_COMPACT_PROXY ? {
      compactProxy: {
        schemaVersion: 1,
        planVersion: COMPACT_PROXY_VERSION,
        planSha256: null,
        machineStatus: "CANDIDATE",
        status: "PENDING",
        ownerDisposition: {
          status: "PENDING",
          reason: null,
          trackerRecorded: false,
        },
        deviceBinding: {
          status: "PENDING",
          deviceIdentitySha256: null,
          platformClass: null,
          runtimeFamily: null,
          runtimeIdentitySha256: null,
        },
        settingsTransition: {
          status: "PENDING",
          stableSettingsProfileSha256: null,
          controlSettingsBindingSha256: null,
          evaluatedSettingsBindingSha256: null,
          fromFlags: Object.fromEntries(REQUIRED_FLAGS.map((key) => [key, false])),
          toFlags: Object.fromEntries(REQUIRED_FLAGS.map((key) => [key, true])),
          transitionCount: 0,
          transitionedAt: null,
          cleanup: {
            status: "PENDING",
            restoredFlags: Object.fromEntries(REQUIRED_FLAGS.map((key) => [key, false])),
            restoredAt: null,
            reason: null,
          },
        },
        workloadBinding: {
          schemaVersion: 1,
          status: "PENDING",
          contractSha256: null,
          sequenceSha256: null,
          bindingSha256: null,
          expectedEpisodeCount: Object.values(COMPACT_STAGE_COUNTS)
            .reduce((sum, count) => sum + count, 0),
          boundEpisodeCount: 0,
          violationCount: 0,
          stages: Object.fromEntries(Object.entries(COMPACT_STAGE_COUNTS).map(
            ([stage, expectedCount]) => [stage, {
              status: "PENDING",
              expectedCount,
              boundCount: 0,
              violationCount: 0,
            }],
          )),
          episodes: [],
        },
        metrics: {
          controlStandard: null,
          evaluatedStandard: null,
          evaluatedRetry: null,
          cancellationProbe: null,
          comparison: null,
          requiredResourceEnvelope: {
            status: "PENDING",
            includedStages: [],
            estimatedDbBytes: { samples: [], maximum: null },
            eventLoopStallMs: { samples: [], maximum: null },
          },
        },
        hardBudgets: {
          lexicalMs: 500,
          graphMs: 8_000,
          recoveryMs: 30_000,
          outerTurnMs: 180_000,
          finalizationReserveMinExclusiveMs: 0,
          status: "PENDING",
          violations: [],
        },
        maintenance: {
          status: "PENDING",
          sourceMutationGuard: {
            status: "PENDING",
            eventCount: 0,
          },
          rebuild: {
            status: "PENDING",
            operation: null,
            operationBindingSha256: null,
            runtimeEnvelope: null,
            estimatedDbBytesBefore: null,
            estimatedDbBytesPeak: null,
            estimatedDbBytesAfter: null,
            readyMarker: null,
            recordedAt: null,
            reason: null,
          },
          incrementalUpdate: {
            status: "PENDING",
            operation: null,
            operationBindingSha256: null,
            runtimeEnvelope: null,
            estimatedDbBytesBefore: null,
            estimatedDbBytesPeak: null,
            estimatedDbBytesAfter: null,
            readyMarker: null,
            recordedAt: null,
            reason: null,
          },
        },
        optionalDiagnostics: {
          processMemory: { status: "UNSUPPORTED", samples: [], maximum: null },
          heap: { status: "UNSUPPORTED", samples: [], maximum: null },
        },
      },
    } : {}),
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

  const canonicalSettingsValue = (value, seen = new WeakSet()) => {
    if (value === undefined) return { type: "undefined" };
    if (value === null) return { type: "null" };
    if (["string", "boolean", "number"].includes(typeof value)) {
      return { type: typeof value, value };
    }
    if (typeof value !== "object") return { type: typeof value, value: String(value) };
    if (seen.has(value)) return { type: "cycle" };
    seen.add(value);
    if (Array.isArray(value)) {
      const projected = {
        type: "array",
        values: value.map((entry) => canonicalSettingsValue(entry, seen)),
      };
      seen.delete(value);
      return projected;
    }
    const projected = {
      type: "object",
      values: Object.fromEntries(Object.keys(value).sort().map((key) => [
        key,
        canonicalSettingsValue(value[key], seen),
      ])),
    };
    seen.delete(value);
    return projected;
  };

  // Freeze only settings that can change the measured retrieval/Pagelet
  // execution. Persisted receipts, ledgers, onboarding markers, and other
  // runtime-owned state are intentionally outside this projection: those
  // values may advance as an expected consequence of the smoke itself. This
  // includes Pagelet first-use/onboarding/bridge markers, nudge suppressions,
  // and last-attempt/diagnostics receipts. retrievalHabitProfile.state is
  // runtime bookkeeping while the feature is disabled, but becomes measured
  // ranking input and is therefore frozen whenever enabled=true.
  const RETRIEVAL_EXECUTION_SETTING_KEYS = Object.freeze([
    "debug", "shareAnonymousCapabilityUsage",
    "aiProvider", "aiProviderPreset", "baseURL",
    "chatModelName", "policyModelName", "embeddingModelName",
    "statisticsVaultId",
    "memoryEnabled", "memoryAutoCheckBeforeChat", "memoryApprovalPolicy",
    "memoryExtractionEnabled",
    "qwenThinkingEnabled", "webSearchEnabled",
    "skillContextEnabled", "enabledSkillIds", "licenseTier",
    "focusMode", "quietRecall", "operationsAgentEnabled",
  ]);
  const PAGELET_EXECUTION_SETTING_KEYS = Object.freeze([
    "enabled", "reviewsFolder", "outputLanguage",
    "temperature", "maxInputTokens", "maxOutputTokens",
    "proactiveHints", "proactiveHintsCooldown", "proactiveHintsQuietHours",
    "deepDiscoverEnabled",
    "preloadEnabled", "preloadInterval", "preloadPerHourCap",
    "preloadPerDayCap", "preloadTokenBudget",
    "scopeRecapPreparationEnabled", "scopeRecapBackgroundAuthorization",
    "scopeRecapAuthorizationContextId", "scopeRecapHighValueHints",
    "excludedFolders", "excludedTags", "excludedPatterns",
    "foregroundPerHourCap", "foregroundPerDayCap",
  ]);
  const projectExecutionSettings = (source, keys, unorderedStringListKeys = []) => {
    const isObject = source && typeof source === "object" && !Array.isArray(source);
    const unorderedKeys = new Set(unorderedStringListKeys);
    return {
      shape: isObject ? "object" : source === null ? "null" : typeof source,
      values: isObject
        ? Object.fromEntries(keys.map((key) => [
          key,
          {
            present: Object.hasOwn(source, key),
            value: unorderedKeys.has(key)
              ? canonicalStringList(source[key])
              : canonicalSettingsValue(source[key]),
          },
        ]))
        : {},
    };
  };

  const stableRetrievalSettingsProjection = (currentPlugin) => {
    const settings = currentPlugin?.settings || {};
    const memoryExtractionEnabled = settings.memoryExtractionEnabled === true;
    const retrievalHabitProfile = settings.retrievalHabitProfile;
    const retrievalHabitEnabled = retrievalHabitProfile
      && typeof retrievalHabitProfile === "object"
      && !Array.isArray(retrievalHabitProfile)
      && retrievalHabitProfile.enabled === true;
    const dataBoundary = settings.dataBoundary;
    const projectedBoundary = dataBoundary && typeof dataBoundary === "object"
      && !Array.isArray(dataBoundary)
      ? {
        shape: "object",
        values: Object.fromEntries(Object.keys(dataBoundary).sort().map((key) => [
          key,
          ["excludedFolders", "excludedTags"].includes(key)
            ? canonicalStringList(dataBoundary[key])
            : canonicalSettingsValue(dataBoundary[key]),
        ])),
      }
      : { shape: dataBoundary === null ? "null" : typeof dataBoundary, values: {} };
    return {
      retrievalExecution: projectExecutionSettings(
        settings,
        RETRIEVAL_EXECUTION_SETTING_KEYS,
      ),
      vssCacheExcludePath: {
        present: Object.hasOwn(settings, "vssCacheExcludePath"),
        value: canonicalStringList(settings.vssCacheExcludePath),
      },
      dataBoundary: {
        present: Object.hasOwn(settings, "dataBoundary"),
        ...projectedBoundary,
      },
      retrievalHabitExecution: projectExecutionSettings(
        retrievalHabitProfile,
        retrievalHabitEnabled ? ["enabled", "state"] : ["enabled"],
      ),
      memoryExtractionExecution: memoryExtractionEnabled
        ? {
          consent: projectExecutionSettings(
            settings.memoryExtractionConsent,
            ["state", "version"],
          ),
          includeVaultInsights: {
            present: Object.hasOwn(settings, "memoryExtractionIncludeVaultInsights"),
            value: canonicalSettingsValue(settings.memoryExtractionIncludeVaultInsights),
          },
        }
        : { active: false },
      pageletExecution: projectExecutionSettings(
        settings.pagelet,
        PAGELET_EXECUTION_SETTING_KEYS,
        ["excludedFolders", "excludedTags", "excludedPatterns"],
      ),
    };
  };

  const retrievalOptimizationFlagsProjection = (currentPlugin) => Object.fromEntries(
    REQUIRED_FLAGS.map((key) => [
      key,
      currentPlugin?.settings?.retrievalOptimizationFlags?.[key] === true,
    ]),
  );

  const fingerprintSettings = (currentPlugin) => canonicalJson({
    stableSettingsProfile: stableRetrievalSettingsProjection(currentPlugin),
    retrievalOptimizationFlags: retrievalOptimizationFlagsProjection(currentPlugin),
  });

  const observePluginLifecycle = () => {
    if (app.plugins.plugins[PLUGIN_ID] !== initialLoadedPluginInstance) {
      pluginLifecycleDriftDetected = true;
      poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
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
            poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
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
            poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
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
            poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
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
      if (next !== currentRawRegistry) {
        pluginLifecycleDriftDetected = true;
        poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
      }
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
        const currentFingerprint = fingerprintSettings({ settings: currentRawSettings });
        const expectedCompactTransition = compactSettingsTransitionActive
          && compactExpectedSettingsFingerprint === currentFingerprint;
        if (settingsFingerprint !== currentFingerprint && !expectedCompactTransition) {
          settingsChangedDuringRun = true;
          poisonCompactProxyFromRuntime("measurement_settings_drift");
        }
      } catch {
        settingsChangedDuringRun = true;
        poisonCompactProxyFromRuntime("measurement_settings_drift");
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

  const teardownRuntimePoisonObservationSources = () => {
    try {
      unsubscribeSettings?.();
    } catch (error) {
      console.warn("[retrieval-smoke] settings listener teardown failed", error);
    }
    unsubscribeSettings = null;
    for (const eventRef of compactMarkdownMutationEventRefs.splice(0)) {
      try {
        app.vault.offref(eventRef);
      } catch (error) {
        console.warn("[retrieval-smoke] Markdown mutation listener teardown failed", error);
      }
    }
    compactMarkdownMutationGuardInstalled = false;
    try {
      uninstallDiagnosticsSettingsGuard?.();
    } catch (error) {
      console.warn("[retrieval-smoke] diagnostics settings guard teardown failed", error);
    }
    uninstallDiagnosticsSettingsGuard = null;
  };

  const teardownRunnerIntegrity = () => {
    teardownRuntimePoisonObservationSources();
    teardownIntegrityGuards();
  };

  const installCompactMarkdownMutationGuard = () => {
    if (!IS_COMPACT_PROXY
      || typeof app?.vault?.on !== "function"
      || typeof app?.vault?.offref !== "function") return false;
    const containsMarkdownPath = (values) => values.some((value) => {
      const path = typeof value === "string" ? value : value?.path;
      return typeof path === "string" && path.toLowerCase().endsWith(".md");
    });
    try {
      for (const event of ["create", "modify", "delete", "rename"]) {
        compactMarkdownMutationEventRefs.push(app.vault.on(event, (...args) => {
          if (!containsMarkdownPath(args)) return;
          compactMarkdownMutationCount += 1;
          if (result.compactProxy) {
            result.compactProxy.maintenance.sourceMutationGuard = {
              status: "FAIL",
              eventCount: compactMarkdownMutationCount,
            };
            poisonCompactProxyFromRuntime("vault_markdown_mutation");
          }
        }));
      }
      return compactMarkdownMutationEventRefs.length === 4;
    } catch {
      for (const eventRef of compactMarkdownMutationEventRefs.splice(0)) {
        try {
          app.vault.offref(eventRef);
        } catch {
          // The unavailable guard remains a blocking preflight condition.
        }
      }
      return false;
    }
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

  const currentStableSettingsProfileSha256 = (currentPlugin = plugin) => digest(
    canonicalJson(stableRetrievalSettingsProjection(currentPlugin)),
  );

  const compactSettingsBindingSha256 = (flags) => digest(canonicalJson({
    schemaVersion: 1,
    stableSettingsProfileSha256: compactStableSettingsProfileSha256,
    retrievalOptimizationFlags: flags,
  }));

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
      poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
    }
    const runnerSha256 = await readAndHash(RUNNER_PATH);
    const pluginArtifactSha256 = await readAndHash(pluginArtifactPath());
    if (typeof currentPlugin.getLoadedPluginBuildIdentity !== "function") {
      throw new Error("Loaded plugin build identity seam is unavailable.");
    }
    const loadedBuild = await currentPlugin.getLoadedPluginBuildIdentity();
    if (app.plugins.plugins[PLUGIN_ID] !== currentPlugin) {
      pluginLifecycleDriftDetected = true;
      poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
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
      poisonCompactProxyFromRuntime("runtime_or_artifact_identity_drift");
      throw new Error("Loaded plugin artifact does not match the current vault artifact.");
    }
    if (initialLoadedPluginInstance && currentPlugin !== initialLoadedPluginInstance) {
      pluginLifecycleDriftDetected = true;
      poisonCompactProxyFromRuntime("plugin_lifecycle_drift");
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
    if (!stable) {
      identityDriftDetected = true;
      poisonCompactProxyFromRuntime("runtime_or_artifact_identity_drift");
    }
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

  const snapshotPublishedResult = () => {
    const snapshot = snapshotResult();
    if (!finalizing || finalized) return snapshot;
    snapshot.finishedAt = null;
    if (snapshot.compactProxy?.status === "READY_FOR_OWNER_REVIEW") {
      snapshot.compactProxy.status = "BLOCKED";
      snapshot.compactProxy.ownerDisposition = {
        status: "PENDING",
        reason: "finalization_in_progress",
        trackerRecorded: false,
      };
    }
    return snapshot;
  };

  const writeResult = () => {
    const payload = JSON.stringify(result, null, 2);
    const operation = writeQueue.then(() => app.vault.adapter.write(RESULT_PATH, payload));
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  const writeResultAtCommit = (beforeWrite) => {
    beforeWrite();
    const payload = JSON.stringify(result, null, 2);
    let operation;
    try {
      operation = Promise.resolve(app.vault.adapter.write(RESULT_PATH, payload));
    } catch (error) {
      operation = Promise.reject(error);
    }
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
      expect: IS_COMPACT_PROXY
        ? `受控 OFF→ON transition 后，在全新 compactCorrectness session 中把它作为第一次检索；standard 可为 valid-none，或只保留冻结 insufficient 子集的 strict-partial；随后恰好一次隐藏 relaxed retry。最终来源必须含 ${RECOVERY_TARGET_FIXTURE}，且没有非冻结、opaque、重复来源或第二次恢复。完成且 Chat 已停止 streaming 后立即无参调用 recordRecoveryCase；runner 只绑定 live canonical Selected Memory/source records/assistant allowlist 与该 session diagnostics，不读取 DOM 或可见引用子集。`
        : `Runner 初始化后的第一次检索；standard 可为 valid-none，或只保留冻结 insufficient 子集的 strict-partial；随后恰好一次隐藏 relaxed retry。最终来源必须含 ${RECOVERY_TARGET_FIXTURE}，且没有非冻结、opaque、重复来源或第二次恢复。完成且 Chat 已停止 streaming 后立即无参调用 recordRecoveryCase；runner 只绑定 live canonical Selected Memory/source records/assistant allowlist 与 pre-freeze diagnostics，不读取 DOM 或可见引用子集。`,
    },
    "temporal-retry": {
      prompt: TEMPORAL_RETRY_PROMPT,
      expect: IS_COMPACT_PROXY
        ? `先在当前 compactCorrectness session 中记录 Chat recovery，再运行本 case。A1 必须是 valid-none/strict-partial，恰好一次 A2 与一次 cumulative projection。三个 terminal（A1/A2 Memory + projection）都必须报告 temporalFilterApplied=1、temporalViolationCount=0；最终来源必须含 ${TEMPORAL_RETRY_TARGET_FIXTURE} 且不含 ${TEMPORAL_RETRY_FORBIDDEN_FIXTURE}。保持该 live completed Chat turn 打开，然后无参调用 recordTemporalRetryCase()；runner 只绑定 canonical ordered Selected Memory/source records/assistant allowlist。`
        : `先记录 pre-freeze Chat recovery，再 freeze reviewed plan；随后在 performance envelope 前的 qualitative staging session 运行。A1 必须是 valid-none/strict-partial，恰好一次 A2 与一次 cumulative projection。三个 terminal（A1/A2 Memory + projection）都必须报告 temporalFilterApplied=1、temporalViolationCount=0；最终来源必须含 ${TEMPORAL_RETRY_TARGET_FIXTURE} 且不含 ${TEMPORAL_RETRY_FORBIDDEN_FIXTURE}。保持该 live completed Chat turn 打开，然后无参调用 recordTemporalRetryCase()；runner 只绑定 canonical ordered Selected Memory/source records/assistant allowlist。`,
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
      record: `After freezing the reviewed measurement plan and before starting its performance envelope, keep the exact completed Chat turn with its one or two diagnostics-matched successful search_memory results open, then await paRetrievalSmoke.recordRankingCase(${JSON.stringify(id)}); the runner binds canonical ordered Selected Memory sources and leaves any unmatched turn PENDING/BLOCKED`,
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

  const expandCompactProxyPlan = (plan) => {
    if (!hasExactKeys(plan, [
      "schemaVersion", "version", "profile", "machineStatus", "completionStatus",
      "conversationPolicy", "performanceSurface", "requiredPlatformClass",
      "requiredRuntimeFamily", "deviceIdentityPolicy", "settingsPhases", "hardBudgets",
      "workload", "requiredMaintenance", "maintenanceOperations", "requiredResourceMetrics",
      "optionalResourceMetrics", "independentCorrectnessSlices",
    ])
      || plan.schemaVersion !== 1
      || plan.version !== COMPACT_PROXY_VERSION
      || plan.profile !== COMPACT_PROFILE
      || plan.machineStatus !== "CANDIDATE"
      || plan.completionStatus !== "READY_FOR_OWNER_REVIEW"
      || plan.conversationPolicy !== "fresh-chat-per-episode"
      || plan.performanceSurface !== "chat"
      || plan.requiredPlatformClass !== "ios-real-device"
      || plan.requiredRuntimeFamily !== "ios-wkwebview"
      || plan.deviceIdentityPolicy !== "operator-provided-sha256") {
      throw new Error("Compact proxy plan contract is invalid.");
    }
    const expectedControlFlags = Object.fromEntries(REQUIRED_FLAGS.map((key) => [key, false]));
    const expectedEvaluatedFlags = Object.fromEntries(REQUIRED_FLAGS.map((key) => [key, true]));
    if (!hasExactKeys(plan.settingsPhases, ["control", "evaluated", "requiredTransitionCount"])
      || canonicalJson(plan.settingsPhases.control) !== canonicalJson(expectedControlFlags)
      || canonicalJson(plan.settingsPhases.evaluated) !== canonicalJson(expectedEvaluatedFlags)
      || plan.settingsPhases.requiredTransitionCount !== 1
      || !hasExactKeys(plan.hardBudgets, [
        "lexicalMs", "graphMs", "recoveryMs", "outerTurnMs",
        "finalizationReserveMinExclusiveMs",
      ])
      || plan.hardBudgets.lexicalMs !== 500
      || plan.hardBudgets.graphMs !== 8_000
      || plan.hardBudgets.recoveryMs !== 30_000
      || plan.hardBudgets.outerTurnMs !== 180_000
      || plan.hardBudgets.finalizationReserveMinExclusiveMs !== 0) {
      throw new Error("Compact proxy settings or hard-budget contract is invalid.");
    }
    const workload = plan.workload;
    if (!hasExactKeys(workload, ["schemaVersion", "fixtureCaseId", "prompts", "stages"])
      || workload.schemaVersion !== 1
      || workload.fixtureCaseId !== "perf-full-graph-two-wave-v1"
      || !hasExactKeys(workload.prompts, Object.keys(PERFORMANCE_PROMPT_TEXTS))
      || !hasExactKeys(workload.stages, Object.keys(COMPACT_STAGE_COUNTS))) {
      throw new Error("Compact proxy workload contract is invalid.");
    }
    for (const [id, text] of Object.entries(PERFORMANCE_PROMPT_TEXTS)) {
      if (!hasExactKeys(workload.prompts[id], ["text"])
        || workload.prompts[id].text !== text) {
        throw new Error("Compact proxy prompt contract is invalid.");
      }
    }
    const classByStage = {
      controlStandard: new Set(["warmup", "measured"]),
      evaluatedStandard: new Set(["warmup", "measured"]),
      evaluatedRetry: new Set(["warmup", "measured"]),
      cancellationProbe: new Set(["probe"]),
    };
    const sequence = [];
    const ids = new Set();
    for (const stage of Object.keys(COMPACT_STAGE_COUNTS)) {
      const segments = workload.stages[stage];
      if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error("Compact proxy stage segments are invalid.");
      }
      for (const segment of segments) {
        const single = Object.hasOwn(segment ?? {}, "id");
        if (!hasExactKeys(segment, single
          ? ["id", "sampleClass", "promptId", "settingsPhase"]
          : ["idPrefix", "from", "to", "pad", "sampleClass", "promptId", "settingsPhase"])
          || !classByStage[stage].has(segment.sampleClass)
          || segment.promptId !== COMPACT_STAGE_PROMPTS[stage]
          || segment.settingsPhase !== COMPACT_STAGE_SETTINGS_PHASES[stage]) {
          throw new Error("Compact proxy stage segment shape is invalid.");
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
          throw new Error("Compact proxy episode ids are invalid or duplicated.");
        }
        for (const id of segmentIds) {
          ids.add(id);
          sequence.push({
            id,
            stage,
            sampleClass: segment.sampleClass,
            promptId: segment.promptId,
            settingsPhase: segment.settingsPhase,
          });
        }
      }
      if (sequence.filter((entry) => entry.stage === stage).length
        !== COMPACT_STAGE_COUNTS[stage]) {
        throw new Error("Compact proxy workload stage count is invalid.");
      }
    }
    if (sequence.length !== 33 || ids.size !== 33
      || JSON.stringify(plan.requiredMaintenance) !== JSON.stringify([
        "rebuild", "incremental-update",
      ])
      || !hasExactKeys(plan.maintenanceOperations, ["rebuild", "incrementalUpdate"])
      || !hasExactKeys(plan.maintenanceOperations?.rebuild, [
        "sequence", "kind", "inputSource",
      ])
      || plan.maintenanceOperations.rebuild.sequence !== 1
      || plan.maintenanceOperations.rebuild.kind !== "rebuild"
      || plan.maintenanceOperations.rebuild.inputSource !== "indexed-chunks"
      || !hasExactKeys(plan.maintenanceOperations?.incrementalUpdate, [
        "sequence", "kind", "inputSource", "fixturePath",
      ])
      || plan.maintenanceOperations.incrementalUpdate.sequence !== 2
      || plan.maintenanceOperations.incrementalUpdate.kind !== "indexed-chunks-incremental"
      || plan.maintenanceOperations.incrementalUpdate.inputSource !== "indexed-chunks"
      || plan.maintenanceOperations.incrementalUpdate.fixturePath
        !== "retrieval-smoke/lexical/量子灯塔检索.md"
      || JSON.stringify(plan.requiredResourceMetrics) !== JSON.stringify([
        "ui.maxEventLoopStallMs", "storage.estimatedDbBytes",
      ])
      || JSON.stringify(plan.optionalResourceMetrics) !== JSON.stringify([
        "memory.peakProcessFootprintBytes", "memory.heapUsedBytes",
      ])
      || JSON.stringify(plan.independentCorrectnessSlices) !== JSON.stringify([
        "six-ranking-cases", "structured-temporal-retry",
      ])) {
      throw new Error("Compact proxy count or evidence-boundary contract is invalid.");
    }
    return { plan: clone(plan), workload: clone(workload), sequence };
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
      requireCompactProxyMutationAdmission();
      return operation();
    };
    const queued = performanceTransitionOperationQueue.then(run, run);
    performanceTransitionOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const nextPerformanceWorkloadValue = () => {
    if (finalizing
      || finalized
      || (IS_COMPACT_PROXY && compactProxyIsPermanentlyInvalid())
      || !performanceWorkloadContract
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

  const applyCompactProxyWorkloadBindingDerived = ({
    contractSha256,
    sequenceSha256,
    bindingSha256,
  }) => {
    const binding = result.compactProxy.workloadBinding;
    binding.contractSha256 = contractSha256;
    binding.sequenceSha256 = sequenceSha256;
    binding.expectedEpisodeCount = compactProxyWorkloadSequence.length;
    binding.boundEpisodeCount = binding.episodes.length;
    for (const [stage, expectedCount] of Object.entries(COMPACT_STAGE_COUNTS)) {
      const summary = binding.stages[stage];
      summary.expectedCount = expectedCount;
      summary.boundCount = binding.episodes.filter((entry) => entry.stage === stage).length;
      summary.status = summary.violationCount > 0 || summary.boundCount > expectedCount
        ? "INVALID"
        : summary.boundCount === expectedCount ? "PASS" : "PENDING";
    }
    binding.bindingSha256 = bindingSha256;
    binding.status = binding.violationCount > 0
      || Object.values(binding.stages).some((entry) => entry.status === "INVALID")
      ? "INVALID"
      : binding.boundEpisodeCount === binding.expectedEpisodeCount
        && Object.values(binding.stages).every((entry) => entry.status === "PASS")
        ? "PASS"
        : "PENDING";
    return binding;
  };

  const refreshCompactProxyWorkloadBinding = async () => {
    if (!IS_COMPACT_PROXY || !compactProxyWorkloadContract) return null;
    const [contractSha256, sequenceSha256, bindingSha256] = await Promise.all([
      digest(canonicalJson(compactProxyWorkloadContract)),
      digest(canonicalJson(compactProxyWorkloadSequence)),
      digest(canonicalJson(result.compactProxy.workloadBinding.episodes)),
    ]);
    return applyCompactProxyWorkloadBindingDerived({
      contractSha256,
      sequenceSha256,
      bindingSha256,
    });
  };

  const markCompactProxyPoisoned = (
    stage = compactProxyCurrentStage,
    reason = "compact_proxy_invariant_failed",
  ) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    if (compactProxyPoison.latched) return false;
    compactProxyPoison.latched = true;
    compactProxyPoison.epoch += 1;
    compactProxyPoison.stage = stage ?? null;
    compactProxyPoison.reason = reason;
    const binding = result.compactProxy.workloadBinding;
    binding.violationCount += 1;
    if (stage && binding.stages[stage]) binding.stages[stage].violationCount += 1;
    result.compactProxy.status = "INVALID";
    return true;
  };

  const latchCompactProxyInvalid = async (
    stage = compactProxyCurrentStage,
    reason = "compact_proxy_invariant_failed",
  ) => {
    if (!markCompactProxyPoisoned(stage, reason)) return false;
    await refreshCompactProxyWorkloadBinding();
    return true;
  };

  const compactProxyIsPermanentlyInvalid = () => IS_COMPACT_PROXY && (
    compactProxyPoison.latched
    || compactProxyPoison.epoch > 0
    || result.compactProxy.status === "INVALID"
    || result.compactProxy.workloadBinding.status === "INVALID"
  );

  const compactProxyTerminalViolationReason = () => {
    if (!IS_COMPACT_PROXY) return null;
    if (settingsChangedDuringRun) return "measurement_settings_drift";
    if (pluginLifecycleDriftDetected) return "plugin_lifecycle_drift";
    if (identityDriftDetected) return "runtime_or_artifact_identity_drift";
    if (compactLexicalIdentityDriftDetected) return "evaluated_lexical_identity_drift";
    if (compactMarkdownMutationCount > 0
      || result.compactProxy.maintenance.sourceMutationGuard.status === "FAIL") {
      return "vault_markdown_mutation";
    }
    if (result.compactProxy.settingsTransition.status === "INVALID") {
      return "settings_transition_invalid";
    }
    if (result.compactProxy.maintenance.status === "INVALID") {
      return "maintenance_invalid";
    }
    if (result.compactProxy.hardBudgets.status === "FAIL") return "hard_budget_failed";
    if (result.compactProxy.metrics.requiredResourceEnvelope?.status === "INVALID") {
      return "required_resource_envelope_invalid";
    }
    return null;
  };

  const requireCompactProxyMutationAdmission = () => {
    const terminalReason = compactProxyTerminalViolationReason();
    if (!compactProxyPoison.latched && terminalReason) {
      markCompactProxyPoisoned(compactProxyCurrentStage, terminalReason);
      scheduleCompactProxyPoisonCleanup();
    }
    if (compactProxyIsPermanentlyInvalid()) {
      if (!compactProxyPoison.reported) {
        compactProxyPoison.reported = true;
        const primaryMessage = compactProxyPoison.reason === "measurement_settings_drift"
          ? "Retrieval, Data Boundary, provider, selected reranker, or Pagelet execution settings changed during this smoke run."
          : compactProxyPoison.reason === "plugin_lifecycle_drift"
            ? "The loaded plugin lifecycle changed during this smoke run."
            : compactProxyPoison.reason === "runtime_or_artifact_identity_drift"
              ? "The runtime or loaded plugin artifact identity changed during this smoke run."
              : compactProxyPoison.reason === "evaluated_lexical_identity_drift"
                ? "The evaluated lexical database, profile, or generation drifted."
                : compactProxyPoison.reason === "vault_markdown_mutation"
                  ? "Vault Markdown changed during the compact smoke run."
                  : null;
        if (primaryMessage) throw new Error(primaryMessage);
      }
      throw new Error(
        "Compact proxy evidence is permanently invalid for this smoke run; only cleanup, finalization, and read operations remain available.",
      );
    }
  };

  const invalidateCompactProxy = async (message, stage = compactProxyCurrentStage) => {
    if (!compactProxyPoison.latched) {
      markCompactProxyPoisoned(stage, message);
    }
    try {
      await refreshCompactProxyWorkloadBinding();
    } catch {
      // Preserve the semantic violation even if its derived hash is blocked.
    }
    compactProxyPoison.reported = true;
    try {
      await cleanupInvalidCompactProxyState();
    } catch {
      // Cleanup cannot replace the first semantic violation.
    }
    try {
      await writeResult();
    } catch {
      // The first semantic violation remains the primary failure. A receipt
      // write failure cannot reopen the poisoned run or make replay admissible.
    }
    compactProxyPoisonHandled = true;
    throw new Error(message);
  };

  const commitEvidenceMutation = async ({ rollback, stage = compactProxyCurrentStage }) => {
    try {
      await writeResult();
    } catch (primaryError) {
      try {
        rollback();
      } catch (rollbackError) {
        if (primaryError && typeof primaryError === "object"
          && primaryError.cause === undefined) {
          primaryError.cause = rollbackError;
        }
      }
      if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
        try {
          await invalidateCompactProxy(
            primaryError?.message || "Compact evidence receipt commit failed.",
            stage,
          );
        } catch {
          // The receipt writer remains primary; invalidation only closes replay.
        }
      } else {
        try {
          await writeResult();
        } catch (cleanupError) {
          if (primaryError && typeof primaryError === "object"
            && primaryError.cause === undefined) {
            primaryError.cause = cleanupError;
          }
        }
      }
      throw primaryError;
    }
  };

  const nextCompactProxyWorkloadValue = () => {
    if (finalizing || finalized
      || !IS_COMPACT_PROXY || !compactProxyWorkloadContract
      || compactProxyIsPermanentlyInvalid()) return null;
    const index = result.compactProxy.workloadBinding.boundEpisodeCount;
    const next = compactProxyWorkloadSequence[index];
    if (!next) return null;
    const prompt = compactProxyWorkloadContract.prompts[next.promptId];
    return clone({
      ...next,
      prompt: prompt.text,
      surface: "chat",
      freshChat: true,
      sequence: index + 1,
      count: compactProxyWorkloadSequence.length,
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
    requireCompactProxyMutationAdmission();
    requireMeasurementSettingsStable();
    const candidate = normalizeDevicePlan(devicePlanTemplate, overrides);
    const canonical = JSON.stringify(candidate);
    return enqueueDiagnosticsOperation(async () => {
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
      if (frozenDevicePlan) {
        if (canonical !== frozenDevicePlanCanonical) {
          throw new Error("Device measurement plan is already frozen; threshold changes require a new run.");
        }
        return clone(result.deviceMeasurement);
      }
      const previousDeviceMeasurement = clone(result.deviceMeasurement);
      const previousPlanIdentity = result.identity.deviceMeasurementPlanSha256;
      try {
        const planSha256 = await digest(canonicalJson(
          projectDevicePlanForReceipt(candidate),
        ));
        requireCompactProxyMutationAdmission();
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
        const diagnosticsRestarted = await restartDiagnosticsForFrozenPlan();
        if (IS_COMPACT_PROXY && !diagnosticsRestarted) {
          throw diagnosticsLastStartError
            || new Error("Post-freeze diagnostics admission failed.");
        }
        requireCompactProxyMutationAdmission();
        await writeResult();
        return clone(result.deviceMeasurement);
      } catch (error) {
        await rollbackDiagnosticsAdmission();
        frozenDevicePlan = null;
        frozenDevicePlanCanonical = "";
        result.deviceMeasurement = previousDeviceMeasurement;
        result.identity.deviceMeasurementPlanSha256 = previousPlanIdentity;
        markDiagnosticsBlocked(
          "device measurement plan admission failed",
          "Device measurement plan and fresh diagnostics session commit atomically",
        );
        if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
          return invalidateCompactProxy(
            error?.message || "Device measurement plan admission failed.",
            diagnosticsSessionStage,
          );
        }
        throw error;
      }
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
    requireCompactProxyMutationAdmission();
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
    requireCompactProxyMutationAdmission();
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
    requireCompactProxyMutationAdmission();
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

  const collectCompactProxyResources = async (state) => {
    state.resourcePointCount += 1;
    try {
      const stats = await plugin.vss.getStats({ mode: "foreground" });
      const identityStable = state.stage === "controlStandard"
        || await compactEvaluatedLexicalGenerationIsReady(stats);
      if (!identityStable) {
        compactLexicalIdentityDriftDetected = true;
        poisonCompactProxyFromRuntime("evaluated_lexical_identity_drift", state.stage);
        state.stopRequested = true;
      }
      if (!identityStable
        || !Number.isFinite(stats?.estimatedDbBytes)
        || stats.estimatedDbBytes < 0) {
        state.requiredResourceComplete = false;
      } else {
        state.estimatedDbBytes.push(stats.estimatedDbBytes);
      }
    } catch {
      state.requiredResourceComplete = false;
    }
    if (typeof process !== "undefined" && typeof process.getProcessMemoryInfo === "function") {
      try {
        const info = await process.getProcessMemoryInfo();
        const valueKiB = Number.isFinite(info?.residentSet) ? info.residentSet
          : Number.isFinite(info?.private) ? info.private : null;
        if (Number.isFinite(valueKiB) && valueKiB >= 0) {
          state.processMemoryBytes.push(valueKiB * 1_024);
        }
      } catch {
        // Process memory is an optional compact diagnostic.
      }
    }
    const heapUsed = typeof performance !== "undefined"
      ? performance.memory?.usedJSHeapSize
      : null;
    if (Number.isFinite(heapUsed) && heapUsed >= 0) state.heapUsedBytes.push(heapUsed);
  };

  const startCompactProxyResourceEnvelope = async (stage) => {
    if (compactProxyResourceState) {
      throw new Error("A compact proxy resource envelope is already active.");
    }
    const hasStallSource = typeof performance !== "undefined"
      && typeof performance.now === "function"
      && typeof setTimeout === "function";
    const state = {
      stage,
      stopRequested: false,
      timedOut: false,
      requiredResourceComplete: typeof plugin?.vss?.getStats === "function" && hasStallSource,
      estimatedDbBytes: [],
      processMemoryBytes: [],
      heapUsedBytes: [],
      eventLoopStallMs: [],
      resourcePointCount: 0,
      stallTickCount: 0,
      deadlineAt: Date.now() + 2 * 60 * 60 * 1_000,
      resourceLoopPromise: null,
      stallLoopPromise: null,
    };
    compactProxyResourceState = state;
    await collectCompactProxyResources(state);
    state.resourceLoopPromise = (async () => {
      while ((!state.stopRequested || state.resourcePointCount < 3)
        && Date.now() < state.deadlineAt) {
        await new Promise((resolve) => setTimeout(resolve, RUNTIME_ENVELOPE_INTERVAL_MS));
        await collectCompactProxyResources(state);
      }
      if (!state.stopRequested) state.timedOut = true;
    })();
    state.stallLoopPromise = (async () => {
      while ((!state.stopRequested || state.stallTickCount < 3)
        && Date.now() < state.deadlineAt) {
        const expectedAt = hasStallSource
          ? performance.now() + RUNTIME_STALL_INTERVAL_MS
          : null;
        await new Promise((resolve) => setTimeout(resolve, RUNTIME_STALL_INTERVAL_MS));
        state.stallTickCount += 1;
        if (hasStallSource) {
          state.eventLoopStallMs.push(Math.max(0, performance.now() - expectedAt));
        }
      }
      if (!state.stopRequested) state.timedOut = true;
    })();
  };

  const stopCompactProxyResourceEnvelope = async () => {
    const state = compactProxyResourceState;
    if (!state) return null;
    state.stopRequested = true;
    await Promise.allSettled([state.resourceLoopPromise, state.stallLoopPromise]);
    if (compactProxyIsPermanentlyInvalid()) {
      compactProxyStageResources[state.stage] = null;
      compactProxyResourceState = null;
      return null;
    }
    const requiredComplete = !state.timedOut
      && state.requiredResourceComplete
      && state.estimatedDbBytes.length >= 3
      && state.eventLoopStallMs.length >= 3;
    const resource = {
      status: requiredComplete ? "PASS" : "BLOCKED",
      estimatedDbBytes: [...state.estimatedDbBytes],
      eventLoopStallMs: [...state.eventLoopStallMs],
      processMemoryBytes: [...state.processMemoryBytes],
      heapUsedBytes: [...state.heapUsedBytes],
    };
    compactProxyStageResources[state.stage] = resource;
    compactProxyResourceState = null;
    return resource;
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

  const discardRuntimeEnvelopeState = async (reason = null) => {
    const state = runtimeEnvelopeState;
    if (!state) return;
    state.stopRequested = true;
    await Promise.allSettled([state.resourceLoopPromise, state.stallLoopPromise]);
    if (runtimeEnvelopeState === state) runtimeEnvelopeState = null;
    if (reason) {
      result.deviceMeasurement.runtimeEnvelope = {
        ...result.deviceMeasurement.runtimeEnvelope,
        status: "BLOCKED",
        workloadCoverageStatus: "BLOCKED",
        reason,
        finishedAt: new Date().toISOString(),
      };
    }
  };

  const startRuntimeEnvelopeTransition = async (...unexpectedArguments) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireCompactProxyMutationAdmission();
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
    requireCompactProxyMutationAdmission();
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
      requireCompactProxyMutationAdmission();
      if (stagingProjection.events.some((event) => event.sequence > performanceQualificationCursor)) {
        throw new Error("unbound staging diagnostics");
      }
    } catch (error) {
      if (compactProxyIsPermanentlyInvalid()) throw error;
      await invalidatePerformanceWorkload({ qualification: true });
      throw new Error("Performance qualification staging contains an unbound or mismatched episode.");
    }
    const externalMemoryCapturePrecondition = await verifyExternalMemoryCaptureStartAbsence();
    let diagnosticsSessionCreatedForEnvelope = false;
    try {
    if (!diagnosticsSessionIdentity && !diagnosticsSessionStage) {
      const started = await startDiagnosticsSession(
        "standardPerformance",
        "Post-freeze standard-performance diagnostics session is active",
      );
      if (!started || !diagnosticsSessionIdentity) {
        throw diagnosticsLastStartError
          || new Error("Standard-performance diagnostics session could not be started.");
      }
      diagnosticsSessionCreatedForEnvelope = true;
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
      requireCompactProxyMutationAdmission();
    } catch (error) {
      if (compactProxyIsPermanentlyInvalid()) throw error;
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
      const stopOutcome = await stopOwnedDiagnosticsSession(stagedIdentity.sessionId);
      if (!stopOutcome.completed) throw stopOutcome.error;
      const discarded = stopOutcome.receipt;
      const identityConfirmed = stopOutcome.confirmed
        && discarded?.sessionId === stagedIdentity.sessionId
        && discarded?.startedAt === stagedIdentity.startedAt
        && discarded?.schemaVersion === stagedIdentity.schemaVersion
        && discarded?.capacity === stagedIdentity.capacity;
      requireCompactProxyMutationAdmission();
      if (!identityConfirmed
        || discarded?.droppedEventCount !== 0) {
        markDiagnosticsBlocked(
          "pre-envelope qualitative diagnostics could not be discarded safely",
          "Pre-envelope qualitative diagnostics can be discarded safely",
        );
        throw new Error("Pre-envelope diagnostics discard failed.");
      }
      const restarted = await startDiagnosticsSession(
        "standardPerformance",
        "Fresh standard-performance diagnostics session is active",
      );
      if (!restarted || !diagnosticsSessionIdentity) {
        throw diagnosticsLastStartError
          || new Error("Fresh standard-performance diagnostics session could not be started.");
      }
      diagnosticsSessionCreatedForEnvelope = true;
      envelopeIdentity = { ...diagnosticsSessionIdentity };
      baselineProjection = projectBoundRetrievalDiagnostics(
        await plugin.getRetrievalDiagnostics(envelopeIdentity.sessionId),
        envelopeIdentity,
      );
      requireCompactProxyMutationAdmission();
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
    requireCompactProxyMutationAdmission();
    const previousRuntimeEnvelope = clone(result.deviceMeasurement.runtimeEnvelope);
    const previousStandardPerformanceCursor = performanceStageCursors.standardPerformance;
    runtimeEnvelopeState = state;
    try {
      performanceStageCursors.standardPerformance = 0;
      await collectRuntimeEnvelopeResources(state);
      requireCompactProxyMutationAdmission();
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
    } catch (error) {
      await discardRuntimeEnvelopeState();
      performanceStageCursors.standardPerformance = previousStandardPerformanceCursor;
      result.deviceMeasurement.runtimeEnvelope = previousRuntimeEnvelope;
      if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
        return invalidateCompactProxy(
          error?.message || "Runtime envelope admission failed.",
          diagnosticsSessionStage,
        );
      }
      throw error;
    }
    } catch (error) {
      if (diagnosticsSessionCreatedForEnvelope) {
        await rollbackDiagnosticsAdmission();
      }
      throw error;
    }
  };

  const stopRuntimeEnvelopeImpl = async () => {
    const state = runtimeEnvelopeState;
    if (!state) return clone(result.deviceMeasurement.runtimeEnvelope);
    state.stopRequested = true;
    await Promise.all([state.resourceLoopPromise, state.stallLoopPromise]);
    if (compactProxyIsPermanentlyInvalid()) {
      runtimeEnvelopeState = null;
      if (finalizing) return null;
    }
    requireCompactProxyMutationAdmission();
    const resourceEvidenceSource = `runtime-envelope-resource-${RUNTIME_ENVELOPE_INTERVAL_MS}ms`;
    const stallEvidenceSource = `runtime-envelope-main-thread-gap-${RUNTIME_STALL_INTERVAL_MS}ms`;
    const metricSnapshots = Object.fromEntries([...RUNTIME_SAMPLED_METRIC_IDS].map((id) => [
      id,
      clone(result.deviceMeasurement.metrics[id]),
    ]));
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
      requireCompactProxyMutationAdmission();
      applyDiagnosticsProjection(diagnosticsSessionStage, finalProjection);
      blockDroppedDiagnosticEvents(finalProjection);
    } catch (error) {
      if (compactProxyIsPermanentlyInvalid()) {
        for (const [id, snapshot] of Object.entries(metricSnapshots)) {
          result.deviceMeasurement.metrics[id] = snapshot;
        }
        throw error;
      }
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
    try {
      await writeResult();
    } catch (primaryError) {
      result.deviceMeasurement.runtimeEnvelope = {
        ...result.deviceMeasurement.runtimeEnvelope,
        status: "BLOCKED",
        workloadCoverageStatus: "BLOCKED",
        reason: "runtime envelope stop receipt could not be committed",
      };
      for (const id of RUNTIME_SAMPLED_METRIC_IDS) {
        result.deviceMeasurement.metrics[id] = {
          ...metricSnapshots[id],
          status: "BLOCKED",
          reason: "runtime envelope stop receipt could not be committed",
        };
      }
      if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
        try {
          await invalidateCompactProxy(
            primaryError?.message || "Runtime envelope stop receipt commit failed.",
            diagnosticsSessionStage,
          );
        } catch {
          // The writer failure remains primary; invalidation is a terminal
          // state transition, not a replacement error.
        }
      } else {
        try {
          await writeResult();
        } catch (cleanupError) {
          if (primaryError && typeof primaryError === "object"
            && primaryError.cause === undefined) {
            primaryError.cause = cleanupError;
          }
        }
      }
      throw primaryError;
    }
    return {
      envelope: clone(result.deviceMeasurement.runtimeEnvelope),
      database: clone(result.deviceMeasurement.metrics[databaseMetric.id]),
      processMemory: clone(result.deviceMeasurement.metrics[processMemoryMetric.id]),
      eventLoopStall: clone(result.deviceMeasurement.metrics[stallMetric.id]),
    };
  };

  const stopRuntimeEnvelopeTransition = async (...unexpectedArguments) => {
    if (finalizing || finalized) throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    requireCompactProxyMutationAdmission();
    requireMeasurementSettingsStable();
    const fail = async (message, { stopActive = false } = {}) => {
      const primaryError = new Error(message);
      let cleanupError = null;
      try {
        await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch2" });
      } catch (error) {
        cleanupError = error;
      }
      if (stopActive) {
        try {
          await stopRuntimeEnvelopeImpl();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError) primaryError.cause = cleanupError;
      throw primaryError;
    };
    if (unexpectedArguments.length !== 0) {
      return fail("stopRuntimeEnvelope does not accept arguments.");
    }
    await performanceEvidenceOperationQueue;
    requireCompactProxyMutationAdmission();
    if (!runtimeEnvelopeState) {
      return fail("A performance runtime envelope is not active.");
    }
    const retryPerformanceBound = runtimeEnvelopeState
      ? await performanceStageIsFullyBound("retryPerformanceBatch2") : false;
    requireCompactProxyMutationAdmission();
    if (runtimeEnvelopeState && !retryPerformanceBound) {
      return fail(
        "Retry-performance batch 2 must contain exactly its bound frozen workload.",
        { stopActive: true },
      );
    }
    requireCompactProxyMutationAdmission();
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
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
      const fail = async (message) => {
        const primaryError = new Error(message);
        try {
          await invalidatePerformanceWorkload({ stage: "standardPerformance" });
        } catch {
          // The semantic transition failure remains primary if persistence fails.
        }
        throw primaryError;
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
      requireCompactProxyMutationAdmission();
      const standardPerformanceBound = await performanceStageIsFullyBound("standardPerformance");
      requireCompactProxyMutationAdmission();
      if (!standardPerformanceBound) {
        await invalidatePerformanceWorkload({ stage: "standardPerformance" });
        throw new Error("Standard performance must contain exactly its bound frozen workload.");
      }
      const previousIdentity = runtimeEnvelopeState.identities.retryPerformanceBatch1;
      const previousCursor = performanceStageCursors.retryPerformanceBatch1;
      const previousReason = result.deviceMeasurement.runtimeEnvelope.reason;
      try {
      await stopRetrievalDiagnosticsImpl({ throwOnFailure: true });
      requireCompactProxyMutationAdmission();
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
        if (diagnosticsLastStartError) {
          try {
            await invalidatePerformanceWorkload({ stage: "standardPerformance" });
          } catch {
            // Preserve the diagnostics start failure as the primary error.
          }
          throw diagnosticsLastStartError;
        }
        return fail("Retry-performance diagnostics session could not be started.");
      }
      requireCompactProxyMutationAdmission();
      runtimeEnvelopeState.identities.retryPerformanceBatch1 = { ...diagnosticsSessionIdentity };
      performanceStageCursors.retryPerformanceBatch1 = 0;
      result.deviceMeasurement.runtimeEnvelope.reason =
        "sampling is active around the frozen retry performance workload";
      await writeResult();
      return clone(result.deviceMeasurement);
      } catch (error) {
        if (runtimeEnvelopeState) {
        runtimeEnvelopeState.identities.retryPerformanceBatch1 = previousIdentity;
        }
        performanceStageCursors.retryPerformanceBatch1 = previousCursor;
        result.deviceMeasurement.runtimeEnvelope.reason = previousReason;
        await rollbackDiagnosticsAdmission();
        await discardRuntimeEnvelopeState(
          "retry-performance batch 1 admission failed; runtime samples were discarded",
        );
        if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
          return invalidateCompactProxy(
            error?.message || "Retry-performance batch 1 admission failed.",
            "retryPerformanceBatch1",
          );
        }
        throw error;
      }
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
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
      const fail = async (message) => {
        const primaryError = new Error(message);
        try {
          await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch1" });
        } catch {
          // The semantic transition failure remains primary if persistence fails.
        }
        throw primaryError;
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
      requireCompactProxyMutationAdmission();
      const retryBatch1Bound = await performanceStageIsFullyBound("retryPerformanceBatch1");
      requireCompactProxyMutationAdmission();
      if (!retryBatch1Bound) {
        await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch1" });
        throw new Error("Retry-performance batch 1 must contain exactly its bound frozen workload.");
      }
      const previousIdentity = runtimeEnvelopeState.identities.retryPerformanceBatch2;
      const previousCursor = performanceStageCursors.retryPerformanceBatch2;
      const previousReason = result.deviceMeasurement.runtimeEnvelope.reason;
      try {
      await stopRetrievalDiagnosticsImpl({ throwOnFailure: true });
      requireCompactProxyMutationAdmission();
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
        if (diagnosticsLastStartError) {
          try {
            await invalidatePerformanceWorkload({ stage: "retryPerformanceBatch1" });
          } catch {
            // Preserve the diagnostics start failure as the primary error.
          }
          throw diagnosticsLastStartError;
        }
        return fail("Retry-performance batch 2 diagnostics session could not be started.");
      }
      requireCompactProxyMutationAdmission();
      runtimeEnvelopeState.identities.retryPerformanceBatch2 = { ...diagnosticsSessionIdentity };
      performanceStageCursors.retryPerformanceBatch2 = 0;
      result.deviceMeasurement.runtimeEnvelope.reason =
        "sampling is active around the frozen retry performance workload";
      await writeResult();
      return clone(result.deviceMeasurement);
      } catch (error) {
        if (runtimeEnvelopeState) {
        runtimeEnvelopeState.identities.retryPerformanceBatch2 = previousIdentity;
        }
        performanceStageCursors.retryPerformanceBatch2 = previousCursor;
        result.deviceMeasurement.runtimeEnvelope.reason = previousReason;
        await rollbackDiagnosticsAdmission();
        await discardRuntimeEnvelopeState(
          "retry-performance batch 2 admission failed; runtime samples were discarded",
        );
        if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
          return invalidateCompactProxy(
            error?.message || "Retry-performance batch 2 admission failed.",
            "retryPerformanceBatch2",
          );
        }
        throw error;
      }
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
    } catch (error) {
      if (compactProxyIsPermanentlyInvalid()) throw error;
      throw new Error("External memory envelope artifact or raw Instruments export is unavailable or invalid.");
    }
    let currentRuntimeIdentity;
    let currentArtifactIdentity;
    try {
      currentRuntimeIdentity = await captureCurrentRuntimeIdentity();
      currentArtifactIdentity = await captureCurrentArtifactIdentity();
    } catch (error) {
      if (compactProxyIsPermanentlyInvalid()) throw error;
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
    requireCompactProxyMutationAdmission();
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
    try {
      requireCompactProxyMutationAdmission();
    } catch (error) {
      return Promise.reject(error);
    }
    const queued = externalMemoryEvidenceOperationQueue.then(() => {
      requireCompactProxyMutationAdmission();
      return recordExternalMemoryEnvelopeImpl(evidence);
    });
    externalMemoryEvidenceOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const sampleLongTasks = async (windowMs = 1_000) => {
    requireCompactProxyMutationAdmission();
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
    requireCompactProxyMutationAdmission();
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
    requireCompactProxyMutationAdmission();
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording diagnostics.");
    if (!["before", "after"].includes(phase)) throw new Error("VSS stats phase must be before or after.");
    const source = injectedStats || await plugin?.vss?.getStats?.({ mode: "foreground" }) || {};
    requireCompactProxyMutationAdmission();
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
    "graph_worker", "queue_release", "reranker", "recovery_standard", "recovery_relaxed",
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
    "queue_release_count_invalid", "queue_release_empty", "queue_release_error",
    "queue_release_timeout",
    "ranked_path_invalid", "ranked_set_incomplete", "request_invalidated",
    "request_unavailable", "reserve_aborted", "reserve_exhausted", "reserve_failed",
    "reserve_not_entered", "reserve_overrun", "reserve_protected", "seed_unavailable", "semantic_none", "snapshot_budget",
    "solve_unavailable", "source_changed", "source_unavailable", "standard_unavailable",
    "standard_sufficient", "partial_requires_stage", "stage_control_reserved", "stage_unavailable",
    "stage_validation_deadline", "stage_validation_failed", "timeout", "token_consumed",
    "unknown_error", "workset_budget", "workset_empty",
  ]);
  const RETRIEVAL_DIAGNOSTIC_METRICS = new Set([
    "durationMs", "remainingMs", "configuredReserveMs", "seedCount", "nodeCount", "edgeCount", "snapshotBytes",
    "opaqueBridgeCount", "liftedStateCount", "transitionCount", "projectedOperations",
    "projectedBytes", "iterationCount", "errorBound", "localCount", "deepCount",
    "convergenceCount", "unionCount", "cosinePassCount", "selectedCount", "candidateCount",
    "documentCount", "batchCount", "chunkCount", "queueWaitMs", "workerDurationMs",
    "maxBatchDurationMs", "cancelRequested", "cancelObserved", "acceptedCount",
    "lateDiscardCount", "resultCount", "providerCallCount", "retryConsumed",
    "temporalFilterApplied", "temporalViolationCount",
  ]);
  const DEADLINE_REASONS = new Set([
    "attempt_deadline", "deadline", "deadline_elapsed", "graph-rank-deadline", "hard_deadline",
    "reserve_exhausted", "reserve_overrun", "stage_validation_deadline", "timeout",
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
      const invocationOrdinal = event.invocationOrdinal;
      if (invocationOrdinal !== undefined
        && (!Number.isSafeInteger(invocationOrdinal) || invocationOrdinal < 0)) {
        throw new Error("Invalid retrieval diagnostics invocation ordinal.");
      }
      return {
        sequence: event.sequence,
        elapsedMs: event.elapsedMs,
        runId: event.runId,
        ...(invocationOrdinal === undefined ? {} : { invocationOrdinal }),
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
    "queue_release",
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
  const diagnosticInvocationOrdinal = (event) => {
    const value = event?.invocationOrdinal;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const isInvocationScopedDiagnosticEvent = (event) => (
    event.phase !== "finalization_reserve"
    || (event.outcome === "skipped" && event.reason === "reserve_protected")
  );
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
    const createEpisode = (event) => {
      const firstOrdinal = diagnosticInvocationOrdinal(event);
      const usesInvocationOrdinals = firstOrdinal !== null;
      return {
        runId: event.runId,
        events: [event],
        attempts: [],
        standardAttempts: [],
        relaxedAttempts: [],
        activeAttempts: [],
        internalAttempt: null,
        boundary: null,
        standardStartedCount: 1,
        standardStartOrdinals: [firstOrdinal],
        standardTerminals: [],
        relaxedStartedCount: 0,
        relaxedTerminals: [],
        relaxedSkipped: [],
        relaxedResolutionCallIndexes: [],
        relaxedAfterStandardCallIndex: null,
        projectionStartedCount: 0,
        projectionTerminals: [],
        finalizationStarted: false,
        reserveProtectedCount: 0,
        usesInvocationOrdinals,
        invocationOrdinalBindingValid: !usesInvocationOrdinals || firstOrdinal === 0,
        structurallyInvalid: usesInvocationOrdinals && firstOrdinal !== 0,
      };
    };
    const bindEventInvocationOrdinal = (episode, event) => {
      if (!isInvocationScopedDiagnosticEvent(event)) {
        if (event.invocationOrdinal !== undefined) {
          episode.invocationOrdinalBindingValid = false;
          episode.structurallyInvalid = true;
        }
        return null;
      }
      const ordinal = diagnosticInvocationOrdinal(event);
      if (episode.usesInvocationOrdinals) {
        if (ordinal === null || ordinal > 1) {
          episode.invocationOrdinalBindingValid = false;
          episode.structurallyInvalid = true;
        }
        return ordinal;
      }
      if (ordinal !== null) {
        episode.invocationOrdinalBindingValid = false;
        episode.structurallyInvalid = true;
      }
      return null;
    };
    const hasTerminalForPhase = (attempt, phase) => {
      const phaseEvents = attempt.events.filter((candidate) => candidate.phase === phase);
      return phaseEvents.some((candidate) => candidate.outcome !== "started");
    };
    const hasOpenPhase = (attempt, phase) => {
      const phaseEvents = attempt.events.filter((candidate) => candidate.phase === phase);
      return phaseEvents.some((candidate) => candidate.outcome === "started")
        && !phaseEvents.some((candidate) => candidate.outcome !== "started");
    };
    const hasValidBoundStageTopology = (attempt, phase) => {
      const phaseEvents = attempt.events.filter((event) => event.phase === phase);
      if (phaseEvents.length === 0) return true;
      const starts = phaseEvents.filter((event) => event.outcome === "started");
      const terminalMatches = (event, pairs) => pairs.some(([outcome, reasons]) => (
        event.outcome === outcome
        && (reasons === null ? event.reason === undefined : reasons.includes(event.reason))
      ));
      if (starts.length === 0) {
        if (phase === "reranker") {
          return phaseEvents.length === 2
            && phaseEvents[0].outcome === "skipped"
            && phaseEvents[0].reason === "model_unavailable"
            && phaseEvents[1].outcome === "fallback"
            && phaseEvents[1].reason === "model_unavailable";
        }
        if (phaseEvents.length !== 1) return false;
        return phase === "graph_snapshot"
          ? terminalMatches(phaseEvents[0], [
            ["skipped", ["flag_off", "no_seeds", "embedding_unavailable", "source_unavailable"]],
            ["deadline", ["deadline_elapsed"]],
          ])
          : terminalMatches(phaseEvents[0], [["skipped", ["filtered_no_seeds"]]]);
      }
      const terminals = phaseEvents.filter((event) => event.outcome !== "started");
      if (starts.length !== 1
        || terminals.length !== 1
        || phaseEvents.length !== 2
        || phaseEvents[0] !== starts[0]) return false;
      const terminal = terminals[0];
      if (phase === "graph_snapshot") {
        return terminalMatches(terminal, [
          ["completed", null],
          ["aborted", ["parent_aborted", "aborted"]],
          ["deadline", ["deadline"]],
          ["fallback", ["snapshot_budget", "epoch_changed", "invalid_snapshot"]],
        ]);
      }
      if (phase === "graph_preflight") {
        return terminalMatches(terminal, [
          ["completed", null],
          ["aborted", ["aborted", "parent_aborted"]],
          ["deadline", ["deadline"]],
          ["fallback", ["local_budget", "snapshot_budget", "graph_budget", "invalid_graph"]],
        ]);
      }
      return terminalMatches(terminal, [
        ["completed", null],
        ["fallback", [terminal.reason]],
        ["aborted", [terminal.reason]],
        ["deadline", [terminal.reason]],
        ["failed", [terminal.reason]],
      ]) && typeof terminal.reason === (terminal.outcome === "completed" ? "undefined" : "string");
    };
    const hasValidPprStageTopology = (attempt) => {
      const phaseEvents = attempt.events.filter((event) => event.phase === "ppr_solve");
      if (phaseEvents.length === 0) return true;
      const starts = phaseEvents.filter((event) => event.outcome === "started");
      if (starts.length === 0) {
        return phaseEvents.length === 1
          && phaseEvents[0].outcome === "skipped"
          && ["activation_not_met", "preflight_unavailable"].includes(phaseEvents[0].reason);
      }
      if (starts.length !== 1 || phaseEvents[0] !== starts[0]) return false;
      const terminals = phaseEvents.slice(1);
      if (terminals.length === 1) {
        const terminal = terminals[0];
        return terminal.outcome === "aborted"
          && terminal.reason === "parent_aborted"
          && Number.isFinite(terminal.metrics.durationMs);
      }
      const aggregate = terminals.at(-1);
      const seedTerminals = terminals.slice(0, -1);
      const seedCount = aggregate?.metrics.seedCount;
      const convergenceCount = aggregate?.metrics.convergenceCount;
      return Number.isSafeInteger(seedCount)
        && seedCount >= 1
        && seedCount <= 3
        && starts[0].metrics.seedCount === seedCount
        && seedTerminals.length === seedCount
        && Number.isSafeInteger(convergenceCount)
        && convergenceCount >= 0
        && convergenceCount <= seedCount
        && (aggregate.outcome === "completed"
          ? convergenceCount === seedCount && aggregate.reason === undefined
          : aggregate.outcome === "fallback"
            && convergenceCount < seedCount
            && aggregate.reason === "solve_unavailable")
        && Number.isFinite(aggregate.metrics.durationMs)
        && seedTerminals.every((event) => (
          ["completed", "deadline", "aborted", "fallback"].includes(event.outcome)
          && event.metrics.seedCount === 1
          && !Number.isFinite(event.metrics.durationMs)
        ))
        && seedTerminals.filter((event) => event.outcome === "completed").length
          === convergenceCount;
    };
    const hasValidGraphWorksetTopology = (attempt) => {
      const phaseEvents = attempt.events.filter((event) => event.phase === "graph_workset");
      if (phaseEvents.length === 0) return true;
      if (phaseEvents.some((event) => event.outcome === "started") || phaseEvents.length > 2) {
        return false;
      }
      const first = phaseEvents[0];
      const hasProbeShape = first.outcome === "completed"
        && Number.isSafeInteger(first.metrics.unionCount)
        && first.metrics.unionCount >= 0;
      if (phaseEvents.length === 1) {
        return hasProbeShape
          || (first.outcome === "fallback" && first.reason === "workset_empty")
          || (first.outcome === "aborted" && first.reason === "currentness_changed");
      }
      if (!hasProbeShape) return false;
      const terminal = phaseEvents[1];
      return (terminal.outcome === "completed"
          && terminal.reason === undefined
          && Number.isSafeInteger(terminal.metrics.selectedCount)
          && terminal.metrics.selectedCount >= 0)
        || (terminal.outcome === "fallback"
          && ["workset_empty", "workset_budget"].includes(terminal.reason))
        || (terminal.outcome === "aborted"
          && ["boundary_changed", "currentness_changed", "flag_changed", "epoch_changed"]
            .includes(terminal.reason))
        || (terminal.outcome === "deadline" && terminal.reason === "deadline_elapsed")
        || (terminal.outcome === "failed"
          && ["ranked_path_invalid", "ranked_candidate_invalid", "ranked_set_incomplete"]
            .includes(terminal.reason));
    };
    const hasValidGraphWorkerTopology = (attempt) => {
      const phaseEvents = attempt.events.filter((event) => event.phase === "graph_worker");
      if (phaseEvents.length === 0) return true;
      const starts = phaseEvents.filter((event) => event.outcome === "started");
      if (starts.length === 0) {
        return phaseEvents.length === 1
          && ((phaseEvents[0].outcome === "aborted" && phaseEvents[0].reason === "flag_changed")
            || (phaseEvents[0].outcome === "failed"
              && phaseEvents[0].reason === "request_unavailable"));
      }
      if (starts.length !== 1 || phaseEvents[0] !== starts[0]) return false;
      const terminals = phaseEvents.slice(1);
      const cancellationEvents = terminals.filter((event) => (
        event.reason === "cancel_requested"
        || event.reason === "cancel_observed"
        || event.reason === "late_result"
      ));
      if (cancellationEvents.length > 0) {
        const reasons = cancellationEvents.map((event) => event.reason);
        return terminals.length === cancellationEvents.length
          && new Set(reasons).size === reasons.length
          && reasons.every((reason) => (
            ["cancel_requested", "cancel_observed", "late_result"].includes(reason)
          ));
      }
      if (terminals.length !== 1) return false;
      const terminal = terminals[0];
      return (terminal.outcome === "completed" && terminal.reason === undefined)
        || (["aborted", "deadline", "failed"].includes(terminal.outcome)
          && typeof terminal.reason === "string")
        || (terminal.outcome === "late_discarded"
          && ["request_invalidated", "deadline_elapsed", "epoch_changed"]
            .includes(terminal.reason));
    };
    const hasValidGraphStageRelationships = (attempt) => {
      const phaseEvents = (phase) => attempt.events.filter((event) => event.phase === phase);
      const snapshotEvents = phaseEvents("graph_snapshot");
      const preflightEvents = phaseEvents("graph_preflight");
      const pprEvents = phaseEvents("ppr_solve");
      const worksetEvents = phaseEvents("graph_workset");
      const workerEvents = phaseEvents("graph_worker");
      const rerankerEvents = phaseEvents("reranker");
      const hasCancellationSignals = workerEvents.some((event) => (
        event.reason === "cancel_requested"
        || event.reason === "cancel_observed"
        || event.reason === "late_result"
      ));
      if (hasCancellationSignals) return true;
      const completedDocumentCount = observedDocumentCount(attempt.terminal);
      if (attempt.terminal?.outcome === "completed" && snapshotEvents.length === 0) return false;
      if (Number.isSafeInteger(completedDocumentCount)
        && completedDocumentCount > 0
        && rerankerEvents.length === 0) return false;
      const laterGraphEvents = [...pprEvents, ...worksetEvents, ...workerEvents];
      const snapshotTerminal = snapshotEvents.find((event) => event.outcome !== "started");
      if (snapshotEvents.length === 0 && laterGraphEvents.length > 0) return false;
      if (snapshotEvents.length > 0 && snapshotTerminal?.outcome !== "completed") {
        if (preflightEvents.length > 0 || laterGraphEvents.length > 0) return false;
      }
      if (snapshotTerminal?.outcome === "completed" && preflightEvents.length === 0) return false;
      const preflightTerminal = preflightEvents.find((event) => event.outcome !== "started");
      const preflightStopsGraph = preflightTerminal?.outcome === "skipped"
        || (preflightTerminal?.outcome === "fallback"
          && ["invalid_graph", "snapshot_budget"].includes(preflightTerminal.reason));
      if (preflightStopsGraph && laterGraphEvents.length > 0) return false;
      if (preflightTerminal && !preflightStopsGraph
        && attempt.terminal?.outcome === "completed"
        && pprEvents.length === 0) return false;
      if (worksetEvents.length > 0 && pprEvents.length === 0) return false;
      const pprTerminal = pprEvents.at(-1);
      const pprStopsGraph = pprTerminal?.outcome === "aborted"
        && pprTerminal.reason === "parent_aborted";
      if (pprEvents.length > 0
        && !pprStopsGraph
        && attempt.terminal?.outcome === "completed"
        && worksetEvents.length === 0) return false;
      const probe = worksetEvents[0];
      const hasProbe = probe?.outcome === "completed"
        && Number.isSafeInteger(probe.metrics.unionCount)
        && probe.metrics.unionCount >= 0;
      if (workerEvents.length > 0 && !hasProbe) return false;
      if (hasProbe && worksetEvents.length === 1 && workerEvents.length === 0) return false;
      const workerTerminal = workerEvents.find((event) => event.outcome !== "started");
      if (workerEvents.length === 0 && worksetEvents.length === 2) {
        const terminal = worksetEvents[1];
        const stoppedBeforeWorker = terminal.outcome === "fallback"
          || (terminal.outcome === "aborted"
            && ["boundary_changed", "currentness_changed"].includes(terminal.reason));
        if (!stoppedBeforeWorker) return false;
      }
      if (workerEvents.length > 0) {
        if (workerTerminal?.outcome === "completed") {
          if (worksetEvents.length !== 2
            || worksetEvents[1].outcome === "fallback"
            || worksetEvents[1].reason === "boundary_changed") return false;
        } else if (worksetEvents.length !== 1) return false;
      }
      const orderedStages = [snapshotEvents, preflightEvents, pprEvents, worksetEvents.slice(0, 1), workerEvents];
      for (let index = 1; index < orderedStages.length; index += 1) {
        const previous = orderedStages[index - 1];
        const next = orderedStages[index];
        if (previous.length > 0 && next.length > 0
          && attempt.events.indexOf(previous.at(-1)) >= attempt.events.indexOf(next[0])) return false;
      }
      if (workerEvents.length > 0 && worksetEvents.length === 2
        && attempt.events.indexOf(workerEvents.at(-1))
          >= attempt.events.indexOf(worksetEvents[1])) return false;
      const graphEvents = attempt.events.filter((event) => GRAPH_PHASES.has(event.phase));
      if (graphEvents.length > 0 && rerankerEvents.length > 0
        && attempt.events.indexOf(graphEvents.at(-1))
          >= attempt.events.indexOf(rerankerEvents[0])) return false;
      return true;
    };
    const routeAttemptEvent = (episode, event) => {
      if (episode.activeAttempts.length === 0) return null;
      if (episode.usesInvocationOrdinals) {
        const ordinal = diagnosticInvocationOrdinal(event);
        const matches = episode.activeAttempts.filter((attempt) => (
          attempt.callIndex === ordinal
        ));
        return matches.length === 1 ? matches[0] : null;
      }
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
    const selectMemoryTerminalAttempt = (episode, event) => {
      if (episode.usesInvocationOrdinals) {
        const ordinal = diagnosticInvocationOrdinal(event);
        const matches = episode.activeAttempts.filter((attempt) => (
          attempt.callIndex === ordinal
        ));
        return matches.length === 1 ? matches[0] : null;
      }
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
          const callOrdinal = bindEventInvocationOrdinal(current, event);
          current.events.push(event);
          // finalization_reserve is the run boundary. A second visible standard
          // call may overlap the first or begin after the first fully resolves.
          const concurrentStandard = current.standardStartedCount === 1
            && current.standardTerminals.length === 0
            && current.relaxedStartedCount === 0
            && current.relaxedSkipped.length === 0
            && !current.finalizationStarted;
          const firstStandardAttempt = current.standardAttempts[0];
          const firstCallResolvedWithoutRetry = current.relaxedSkipped.length === 1
            && current.relaxedResolutionCallIndexes[0] === 0
            && MULTI_STANDARD_SKIP_REASONS.has(current.relaxedSkipped[0].reason)
            && current.relaxedStartedCount === 0
            && current.projectionStartedCount === 0
            && current.projectionTerminals.length === 0;
          const firstCallResolvedWithRetry = current.relaxedStartedCount === 1
            && current.relaxedAfterStandardCallIndex === 0
            && current.relaxedResolutionCallIndexes[0] === 0
            && current.relaxedAttempts.length === 1
            && current.relaxedAttempts[0].terminal?.outcome === "completed"
            && current.relaxedTerminals.length === 1
            && current.relaxedTerminals[0].outcome === "completed"
            && current.projectionStartedCount === 1
            && current.projectionTerminals.length === 1
            && current.projectionTerminals[0].outcome === "completed"
            && current.relaxedSkipped.length === 0;
          const sequentialStandard = current.standardStartedCount === 1
            && current.activeAttempts.length === 0
            && current.standardAttempts.length === 1
            && firstStandardAttempt?.terminal?.outcome === "completed"
            && current.standardTerminals.length === 1
            && current.standardTerminals[0].outcome === "completed"
            && (firstCallResolvedWithoutRetry || firstCallResolvedWithRetry)
            && current.reserveProtectedCount === 0
            && !current.finalizationStarted;
          if (!concurrentStandard && !sequentialStandard) current.structurallyInvalid = true;
          if (current.usesInvocationOrdinals
            && callOrdinal !== current.standardStartedCount) {
            current.invocationOrdinalBindingValid = false;
            current.structurallyInvalid = true;
          }
          current.standardStartOrdinals.push(callOrdinal);
          current.standardStartedCount += 1;
          if (current.standardStartedCount > 2) current.structurallyInvalid = true;
        }
        continue;
      }
      if (!current) {
        unscopedEvents.push(event);
        continue;
      }

      const callOrdinal = bindEventInvocationOrdinal(current, event);
      current.events.push(event);
      if (event.phase === "memory_search") {
        if (event.outcome === "started") {
          const ordinalStandardMissing = current.usesInvocationOrdinals
            && Number.isSafeInteger(callOrdinal)
            && callOrdinal < current.standardStartedCount
            && current.standardStartOrdinals[callOrdinal] === callOrdinal
            && !current.standardAttempts[callOrdinal];
          const ordinalRelaxedPending = current.usesInvocationOrdinals
            && Number.isSafeInteger(callOrdinal)
            && current.relaxedAfterStandardCallIndex === callOrdinal
            && current.relaxedStartedCount === 1
            && current.relaxedAttempts.length === 0;
          const startsStandard = current.usesInvocationOrdinals
            ? ordinalStandardMissing
            : current.standardAttempts.length < current.standardStartedCount;
          const startsRelaxed = current.usesInvocationOrdinals
            ? !startsStandard && ordinalRelaxedPending
            : !startsStandard && current.relaxedAttempts.length < current.relaxedStartedCount;
          if (current.finalizationStarted || (!startsStandard && !startsRelaxed)) {
            current.structurallyInvalid = true;
          }
          const attempt = {
            kind: startsRelaxed ? "relaxed" : "standard",
            callIndex: current.usesInvocationOrdinals
              ? callOrdinal
              : startsRelaxed
                ? current.relaxedAfterStandardCallIndex
                : current.standardAttempts.length,
            events: [event],
            terminal: null,
            multipleTerminals: false,
          };
          current.attempts.push(attempt);
          if (startsRelaxed) current.relaxedAttempts.push(attempt);
          else if (current.usesInvocationOrdinals && Number.isSafeInteger(callOrdinal)) {
            current.standardAttempts[callOrdinal] = attempt;
          } else current.standardAttempts.push(attempt);
          current.activeAttempts.push(attempt);
          continue;
        }
        const terminalAttempt = selectMemoryTerminalAttempt(current, event);
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
        if (current.usesInvocationOrdinals) {
          const attempt = Number.isSafeInteger(callOrdinal)
            ? current.standardAttempts[callOrdinal]
            : null;
          if (!TERMINAL_OUTCOMES.has(event.outcome)
            || !attempt?.terminal
            || current.standardTerminals[callOrdinal]
            || current.finalizationStarted) {
            current.structurallyInvalid = true;
          } else {
            current.standardTerminals[callOrdinal] = event;
          }
        } else if (!TERMINAL_OUTCOMES.has(event.outcome)
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
          const callIndex = current.usesInvocationOrdinals
            ? callOrdinal
            : current.standardTerminals.length - 1;
          if (callIndex < 0
            || callIndex >= current.standardStartedCount
            || !current.standardTerminals[callIndex]
            || current.relaxedResolutionCallIndexes.includes(callIndex)
            || current.relaxedStartedCount >= 1
            || current.finalizationStarted) {
            current.structurallyInvalid = true;
          }
          current.relaxedResolutionCallIndexes.push(callIndex);
          current.relaxedAfterStandardCallIndex = callIndex;
          current.relaxedStartedCount += 1;
        } else if (event.outcome === "skipped") {
          const callIndex = current.usesInvocationOrdinals
            ? callOrdinal
            : current.standardTerminals.length - 1;
          if (callIndex < 0
            || callIndex >= current.standardStartedCount
            || !current.standardTerminals[callIndex]
            || current.relaxedResolutionCallIndexes.includes(callIndex)
            || current.finalizationStarted) {
            current.structurallyInvalid = true;
          }
          current.relaxedResolutionCallIndexes.push(callIndex);
          current.relaxedSkipped.push(event);
        } else if (TERMINAL_OUTCOMES.has(event.outcome)) {
          if (current.relaxedStartedCount !== 1
            || (current.usesInvocationOrdinals
              && callOrdinal !== current.relaxedAfterStandardCallIndex)
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
        const projectionAttemptIdle = current.usesInvocationOrdinals
          ? !current.activeAttempts.some((attempt) => attempt.callIndex === callOrdinal)
          : current.activeAttempts.length === 0;
        const projectionEligible = projectionAttemptIdle
          && current.relaxedAttempts.length === 1
          && current.relaxedTerminals[0]?.outcome === "completed"
          && (!current.usesInvocationOrdinals
            || callOrdinal === current.relaxedAfterStandardCallIndex)
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
        const boundStandardAttempts = current.standardAttempts.filter(Boolean);
        const boundStandardTerminals = current.standardTerminals.filter(Boolean);
        const resolvedCallIndexes = new Set(current.relaxedResolutionCallIndexes);
        const standardComplete = current.standardStartedCount >= 1
          && current.standardStartedCount <= 2
          && boundStandardAttempts.length === current.standardStartedCount
          && boundStandardTerminals.length === current.standardStartedCount;
        const multiStandardResolutionComplete = current.standardStartedCount !== 2
          || (boundStandardAttempts.every((attempt) => (
            attempt.terminal?.outcome === "completed"
          ))
            && boundStandardTerminals.every((terminal) => terminal.outcome === "completed")
            && current.relaxedStartedCount <= 1
            && current.relaxedResolutionCallIndexes.length === 2
            && resolvedCallIndexes.size === 2
            && resolvedCallIndexes.has(0)
            && resolvedCallIndexes.has(1)
            && current.relaxedSkipped.length + current.relaxedStartedCount === 2
            && current.relaxedSkipped.every((skipped) => (
              MULTI_STANDARD_SKIP_REASONS.has(skipped.reason)
            ))
            && (current.relaxedStartedCount === 1
              ? current.relaxedAttempts.length === 1
                && current.relaxedTerminals.length === 1
                && current.projectionStartedCount === 1
                && current.projectionTerminals.length === 1
              : current.projectionStartedCount === 0
                && current.projectionTerminals.length === 0)
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
      episode.standardInvocationOrdinals = [...episode.standardStartOrdinals];
      const invocationScopedEvents = episode.events.filter(isInvocationScopedDiagnosticEvent);
      episode.invocationOrdinalBindingValid = episode.invocationOrdinalBindingValid
        && episode.usesInvocationOrdinals
        && episode.standardInvocationOrdinals.length === episode.standardCallCount
        && episode.standardInvocationOrdinals.every((ordinal, index) => ordinal === index)
        && invocationScopedEvents.every((event) => {
          const ordinal = diagnosticInvocationOrdinal(event);
          return ordinal !== null && ordinal < episode.standardCallCount;
        });
      if (!episode.invocationOrdinalBindingValid) episode.structurallyInvalid = true;
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
      const finalizationEvents = episode.events.filter((event) => (
        event.phase === "finalization_reserve"
      ));
      const configuredReserveValues = finalizationEvents.map((event) => (
        event.metrics.configuredReserveMs
      ));
      episode.finalizationConfiguredReserveMs = configuredReserveValues[0] ?? null;
      episode.finalizationReserveBindingValid = finalizationEvents.length > 0
        && configuredReserveValues.every((value) => (
          Number.isFinite(value)
          && value > 0
          && value === episode.finalizationConfiguredReserveMs
        ));
      if (!episode.finalizationReserveBindingValid) episode.structurallyInvalid = true;
      for (const attempt of episode.attempts) {
        attempt.boundStageTopologyValid = [
          "graph_snapshot", "graph_preflight", "reranker",
        ].every((phase) => hasValidBoundStageTopology(attempt, phase))
          && hasValidPprStageTopology(attempt)
          && hasValidGraphWorksetTopology(attempt)
          && hasValidGraphWorkerTopology(attempt)
          && hasValidGraphStageRelationships(attempt);
        attempt.complete = Boolean(attempt.terminal)
          && !attempt.multipleTerminals
          && attempt.boundStageTopologyValid;
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
      const queueReleaseEvents = episode.events.filter((event) => (
        event.phase === "queue_release"
      ));
      const queueReleaseStarts = queueReleaseEvents.filter((event) => (
        event.outcome === "started"
      ));
      const queueReleaseCompletions = queueReleaseEvents.filter((event) => (
        event.outcome === "completed"
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
      const queueReleaseStart = queueReleaseStarts[0];
      const queueReleaseCompletion = queueReleaseCompletions[0];
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
      episode.cancelToWorkerObservedMs = requestedEvent && observedEvent
        ? observedEvent.elapsedMs - requestedEvent.elapsedMs : null;
      episode.cancelToLateDiscardedMs = requestedEvent && lateEvent
        ? lateEvent.elapsedMs - requestedEvent.elapsedMs : null;
      episode.cancelToProbeCompletedMs = requestedEvent && queueReleaseCompletion
        ? queueReleaseCompletion.elapsedMs - requestedEvent.elapsedMs : null;
      episode.queueReleaseProbeResultCount = queueReleaseCompletion?.metrics.resultCount ?? null;
      episode.cancellationTopologyValid = episode.hasCancellationEvidence
        && episode.standardCallCount === 1
        && episode.attempts.length === 1
        && cancellationSignalEvents.length === 3
        && requestedEvents.length === 1
        && observedEvents.length === 1
        && lateEvents.length === 1
        && queueReleaseEvents.length === 2
        && queueReleaseStarts.length === 1
        && queueReleaseCompletions.length === 1
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
        && episode.events.indexOf(requestedEvent) < episode.events.indexOf(queueReleaseStart)
        && episode.events.indexOf(lateEvent) < episode.events.indexOf(queueReleaseCompletion)
        && (requestedEvent.metrics.cancelRequested || 0) > 0
        && (requestedEvent.metrics.acceptedCount || 0) === 0
        && (observedEvent.metrics.cancelRequested || 0) > 0
        && (observedEvent.metrics.cancelObserved || 0) > 0
        && (observedEvent.metrics.acceptedCount || 0) === 0
        && (lateEvent.metrics.cancelRequested || 0) > 0
        && (lateEvent.metrics.lateDiscardCount || 0) > 0
        && (lateEvent.metrics.acceptedCount || 0) === 0
        && Number.isFinite(queueReleaseCompletion.metrics.durationMs)
        && queueReleaseCompletion.metrics.resultCount === 1
        && Number.isFinite(episode.cancelToWorkerObservedMs)
        && Number.isFinite(episode.cancelToLateDiscardedMs)
        && Number.isFinite(episode.cancelToProbeCompletedMs)
        && episode.cancelToWorkerObservedMs >= 0
        && episode.cancelToWorkerObservedMs <= episode.cancelToLateDiscardedMs
        && episode.cancelToLateDiscardedMs <= episode.cancelToProbeCompletedMs
        && episode.cancelToProbeCompletedMs <= GRAPH_QUEUE_RELEASE_ABSOLUTE_ENVELOPE_MS
        && episode.acceptedAfterCancelCount === 0;
      if (episode.hasCancellationEvidence && !episode.cancellationTopologyValid) {
        episode.structurallyInvalid = true;
      }
      episode.complete = Boolean(episode.boundary)
        && episode.activeAttempts.length === 0
        && !episode.structurallyInvalid
        && episode.invocationOrdinalBindingValid
        && episode.standardCallCount >= 1
        && episode.standardCallCount <= 2
        && episode.standardAttempts.filter(Boolean).length === episode.standardCallCount
        && episode.standardTerminals.filter(Boolean).length === episode.standardCallCount
        && episode.standardAttempts.filter(Boolean).every((attempt) => (
          attempt.terminal?.outcome === "completed"
        ))
        && episode.standardTerminals.filter(Boolean).every((terminal) => terminal.outcome === "completed")
        && episode.relaxedStartedCount <= 1
        && episode.relaxedAttempts.length === episode.relaxedStartedCount
        && episode.relaxedTerminals.length === episode.relaxedStartedCount
        && episode.relaxedSkipped.length + episode.relaxedStartedCount
          <= episode.standardCallCount
        && (episode.standardCallCount !== 2
          || (episode.standardAttempts.filter(Boolean).every((attempt) => (
            attempt.terminal?.outcome === "completed"
          ))
            && episode.standardTerminals.filter(Boolean).every((terminal) => terminal.outcome === "completed")
            && episode.relaxedStartedCount <= 1
            && episode.relaxedResolutionCallIndexes.length === 2
            && new Set(episode.relaxedResolutionCallIndexes).size === 2
            && episode.relaxedResolutionCallIndexes.includes(0)
            && episode.relaxedResolutionCallIndexes.includes(1)
            && episode.relaxedSkipped.length + episode.relaxedStartedCount === 2
            && episode.relaxedSkipped.every((skipped) => (
              MULTI_STANDARD_SKIP_REASONS.has(skipped.reason)
            ))
            && (episode.relaxedStartedCount === 1
              ? episode.relaxedAttempts.length === 1
                && episode.relaxedTerminals.length === 1
                && episode.projectionStartedCount === 1
                && episode.projectionTerminals.length === 1
              : episode.projectionStartedCount === 0
                && episode.projectionTerminals.length === 0)
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
        finalizationConfiguredReserveMs: [],
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
      && Number.isFinite(episode.finalizationConfiguredReserveMs)
      && episode.finalizationConfiguredReserveMs > 0
      && episode.finalizationReserveBindingValid
      && !episode.hasCancellationEvidence
    ));
    const configuredReserveStable = normalEpisodes.length === 0
      || new Set(normalEpisodes.map((episode) => episode.finalizationConfiguredReserveMs)).size === 1;
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
      } else if (!configuredReserveStable) {
        episodeStatus = "INVALID";
        episodeReason = "performance evidence contains inconsistent configured finalization reserves";
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
      ...(stage === "cancellationProbe" ? {
        cancelToWorkerObservedMs: episodes.length === 1
          ? episodes[0].cancelToWorkerObservedMs : null,
        cancelToLateDiscardedMs: episodes.length === 1
          ? episodes[0].cancelToLateDiscardedMs : null,
        cancelToProbeCompletedMs: episodes.length === 1
          ? episodes[0].cancelToProbeCompletedMs : null,
        queueReleaseProbeResultCount: episodes.length === 1
          ? episodes[0].queueReleaseProbeResultCount : null,
        graphMaxBatchDurationMs: null,
        graphQueueReleaseAbsoluteEnvelopeMs: GRAPH_QUEUE_RELEASE_ABSOLUTE_ENVELOPE_MS,
      } : {}),
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
        if (Number.isFinite(episode.finalizationConfiguredReserveMs)) {
          summary.series.finalizationConfiguredReserveMs.push(
            episode.finalizationConfiguredReserveMs,
          );
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
      finalizationConfiguredReserveMs: [],
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
      finalizationConfiguredReserveMs: [
        ...left.finalizationConfiguredReserveMs,
        ...right.finalizationConfiguredReserveMs,
      ],
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
    const configuredReserveBindingValues = [
      diagnosticsEvidenceProjections.standardPerformance,
      diagnosticsEvidenceProjections.retryPerformanceBatch1,
      diagnosticsEvidenceProjections.retryPerformanceBatch2,
      diagnosticsEvidenceProjections.cancellationProbe,
    ].filter(Boolean).flatMap((projection) => projection.events
      .filter((event) => event.phase === "finalization_reserve")
      .map((event) => event.metrics.configuredReserveMs));
    const finalizationReserveBindingStatus = configuredReserveBindingValues.length > 0
      && configuredReserveBindingValues.every((value) => Number.isFinite(value) && value > 0)
      && new Set(configuredReserveBindingValues).size === 1
      ? "VALID" : configuredReserveBindingValues.length > 0 ? "INVALID" : "INCOMPLETE";
    const observedGraphBatchDurations = [
      ...(standardSummary?.series?.workerCompleted?.maxBatchDurationMs || []),
      ...(retrySeries?.workerCompleted?.maxBatchDurationMs || []),
    ].filter(Number.isFinite);
    if (cancellationSummary?.measurementEpisodes) {
      cancellationSummary.measurementEpisodes.graphMaxBatchDurationMs =
        observedGraphBatchDurations.length > 0
          ? Math.max(...observedGraphBatchDurations)
          : null;
    }
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
      finalizationReserveBinding: {
        status: finalizationReserveBindingStatus,
        configuredReserveMs: finalizationReserveBindingStatus === "VALID"
          ? configuredReserveBindingValues[0] : null,
      },
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
    const finalizationReserveEvidenceValid = summary.finalizationReserveBinding?.status !== "INVALID";
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
      "retrieval.finalizationReserveMs": hasStandardEvidence && finalizationReserveEvidenceValid
        ? summary.series.finalizationConfiguredReserveMs : [],
      "retrieval.retryFinalizationReserveMs": hasRetryEvidence && finalizationReserveEvidenceValid
        ? summary.retrySeries.finalizationConfiguredReserveMs : [],
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

  const recoverDiagnosticsSessionId = (receipt) => (
    typeof receipt?.sessionId === "string" && receipt.sessionId.length > 0
      ? receipt.sessionId
      : null
  );

  const releaseConfirmedDiagnosticsOwnership = (sessionId) => {
    ownedDiagnosticsSessions.delete(sessionId);
    if (diagnosticsSessionIdentity?.sessionId === sessionId) {
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
      stoppedDiagnosticsProjection = null;
      diagnosticsStopAttempted = false;
    }
  };

  const stopOwnedDiagnosticsSession = async (sessionId) => {
    if (!sessionId || !ownedDiagnosticsSessions.has(sessionId)) {
      return {
        completed: true,
        confirmed: true,
        receipt: null,
        error: null,
      };
    }
    try {
      const receipt = await plugin.stopRetrievalDiagnostics(sessionId);
      const registeredIdentity = ownedDiagnosticsSessions.get(sessionId);
      const expectedIdentity = registeredIdentity
        || (diagnosticsSessionIdentity?.sessionId === sessionId
          ? diagnosticsSessionIdentity : null);
      const confirmed = receipt?.sessionId === sessionId
        && (!expectedIdentity
          || (receipt?.startedAt === expectedIdentity.startedAt
            && receipt?.schemaVersion === expectedIdentity.schemaVersion
            && receipt?.capacity === expectedIdentity.capacity));
      if (confirmed) releaseConfirmedDiagnosticsOwnership(sessionId);
      return {
        completed: true,
        confirmed,
        receipt,
        error: null,
      };
    } catch (error) {
      return {
        completed: false,
        confirmed: false,
        receipt: null,
        error,
      };
    }
  };

  const discardOwnedDiagnosticsSessions = async ({ attempts = 1 } = {}) => {
    const failures = [];
    const maximumAttempts = Math.max(1, Number.isInteger(attempts) ? attempts : 1);
    for (const sessionId of [...ownedDiagnosticsSessions.keys()]) {
      let outcome = null;
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        outcome = await stopOwnedDiagnosticsSession(sessionId);
        if (outcome.completed && outcome.confirmed) break;
      }
      if (!outcome?.completed || !outcome?.confirmed) {
        failures.push({ sessionId, error: outcome?.error });
      }
    }
    return failures;
  };

  const rollbackDiagnosticsAdmission = async ({ attempts = 2 } = {}) => {
    if (diagnosticsSessionIdentity?.sessionId) {
      ownedDiagnosticsSessions.set(
        diagnosticsSessionIdentity.sessionId,
        diagnosticsSessionIdentity,
      );
    }
    const failures = await discardOwnedDiagnosticsSessions({ attempts });
    if (ownedDiagnosticsSessions.size === 0) {
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
    }
    stoppedDiagnosticsProjection = null;
    diagnosticsStopAttempted = false;
    return failures;
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
      diagnosticsLastStartError = new Error(
        "The retrieval diagnostics session seam is unavailable.",
      );
      markDiagnosticsBlocked(
        "plugin build does not expose the retrieval diagnostics session seam",
        checkName,
      );
      return false;
    }
    let rawStartReceipt = null;
    let rawSessionId = null;
    let startedIdentity = null;
    const previousDiagnosticsGate = clone(result.deviceMeasurement.diagnosticsGate);
    const previousChecksLength = result.checks.length;
    diagnosticsLastStartError = null;
    try {
      rawStartReceipt = await plugin.startRetrievalDiagnostics();
      rawSessionId = recoverDiagnosticsSessionId(rawStartReceipt);
      // Register ownership before any local normalization/admission work. A
      // malformed raw receipt may expose only its session id, so null means
      // cleanup can confirm only that recoverable id and binds no evidence.
      if (rawSessionId) ownedDiagnosticsSessions.set(rawSessionId, null);
      startedIdentity = normalizeDiagnosticsIdentity(rawStartReceipt);
      ownedDiagnosticsSessions.set(startedIdentity.sessionId, startedIdentity);
      if (compactProxyIsPermanentlyInvalid()) {
        await stopOwnedDiagnosticsSession(startedIdentity.sessionId);
        requireCompactProxyMutationAdmission();
      }
      diagnosticsSessionIdentity = startedIdentity;
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
    } catch (error) {
      diagnosticsLastStartError = error;
      if (rawSessionId && ownedDiagnosticsSessions.has(rawSessionId)) {
        await discardOwnedDiagnosticsSessions({ attempts: 2 });
      }
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
      result.checks.splice(previousChecksLength);
      result.deviceMeasurement.diagnosticsGate = previousDiagnosticsGate;
      if (compactProxyIsPermanentlyInvalid()) throw error;
      markDiagnosticsBlocked("plugin diagnostics session start failed", checkName);
      return false;
    }
  };

  const restartDiagnosticsForFrozenPlan = async () => {
    const previousIdentity = diagnosticsSessionIdentity;
    let discardFailed = false;
    if (previousIdentity) {
      try {
        const stopOutcome = await stopOwnedDiagnosticsSession(previousIdentity.sessionId);
        if (!stopOutcome.completed) throw stopOutcome.error;
        const discarded = stopOutcome.receipt;
        if (!stopOutcome.confirmed
          || discarded?.sessionId !== previousIdentity.sessionId
          || discarded?.startedAt !== previousIdentity.startedAt
          || discarded?.schemaVersion !== previousIdentity.schemaVersion
          || discarded?.capacity !== previousIdentity.capacity) {
          throw new Error("Retrieval diagnostics session identity changed.");
        }
      } catch (error) {
        discardFailed = true;
        diagnosticsLastStartError = error;
      }
    }
    requireCompactProxyMutationAdmission();
    if (discardFailed) {
      markDiagnosticsBlocked(
        "pre-freeze diagnostics session could not be discarded",
        "Pre-freeze retrieval diagnostics session is discarded",
      );
      diagnosticsStopAttempted = false;
      return false;
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
    record("Pre-freeze retrieval diagnostics session is discarded", "PASS");
    result.deviceMeasurement.diagnosticsGate = {
      status: "BLOCKED",
      reason: "post-freeze standard-performance diagnostics session is active and must be measured",
      schemaVersion: null,
      capacity: null,
    };
    return startDiagnosticsSession(
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
      requireCompactProxyMutationAdmission();
      applyDiagnosticsProjection(diagnosticsSessionStage, projection);
      blockDroppedDiagnosticEvents(projection);
      await writeResult();
      return clone(projection);
    } catch (error) {
      if (compactProxyIsPermanentlyInvalid()) throw error;
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
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueDiagnosticsOperation(async () => {
      requireCompactProxyMutationAdmission();
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
    const finalizationReserveBindingStatus = result.deviceMeasurement.diagnosticsSummary
      ?.finalizationReserveBinding?.status;
    const complete = diagnosticsEvidenceProjections.standardPerformance
      && diagnosticsEvidenceProjections.retryPerformanceBatch1
      && diagnosticsEvidenceProjections.retryPerformanceBatch2
      && diagnosticsEvidenceProjections.cancellationProbe
      && standardStatus === "VALID"
      && retryStatus === "VALID"
      && cancellationStatus === "VALID"
      && finalizationReserveBindingStatus === "VALID";
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

  const stopRetrievalDiagnosticsImpl = async ({
    persist = true,
    throwOnFailure = false,
  } = {}) => {
    if (stoppedDiagnosticsProjection) return clone(stoppedDiagnosticsProjection);
    if (!diagnosticsSessionIdentity || diagnosticsStopAttempted) return null;
    diagnosticsStopAttempted = true;
    const stoppedStage = diagnosticsSessionStage;
    const measurementSession = Boolean(frozenDevicePlan)
      && [
        "standardPerformance", "retryPerformanceBatch1", "retryPerformanceBatch2",
        "cancellationProbe",
      ].includes(stoppedStage);
    const stoppedIdentity = diagnosticsSessionIdentity;
    let stopReceiptConfirmed = false;
    let stopProjectionConfirmed = false;
    try {
      const stopOutcome = await stopOwnedDiagnosticsSession(stoppedIdentity.sessionId);
      if (!stopOutcome.completed) throw stopOutcome.error;
      const snapshot = stopOutcome.receipt;
      stopReceiptConfirmed = stopOutcome.confirmed
        && snapshot?.sessionId === stoppedIdentity.sessionId
        && snapshot?.startedAt === stoppedIdentity.startedAt
        && snapshot?.schemaVersion === stoppedIdentity.schemaVersion
        && snapshot?.capacity === stoppedIdentity.capacity;
      if (compactProxyIsPermanentlyInvalid()) {
        stoppedDiagnosticsProjection = null;
        diagnosticsStopAttempted = false;
        return null;
      }
      const projection = projectBoundRetrievalDiagnostics(snapshot, stoppedIdentity);
      stopProjectionConfirmed = true;
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
        if (persist) await writeResult();
        return clone(projection);
      }
      applyDiagnosticsProjection(stoppedStage, projection, true);
      blockDroppedDiagnosticEvents(projection);
      stoppedDiagnosticsProjection = projection;
      record(`${stoppedStage} retrieval diagnostics session is stopped and captured`, "PASS");
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
      updateDiagnosticsGate();
      if (persist) await writeResult();
      return clone(projection);
    } catch (error) {
      if (stopReceiptConfirmed) {
        markDiagnosticsBlocked(
          stopProjectionConfirmed
            ? "diagnostics stop receipt could not be committed"
            : "diagnostics stop receipt projection failed",
          "Retrieval diagnostics session is stopped and captured",
        );
        if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
          return invalidateCompactProxy(
            error?.message || "Diagnostics stop receipt commit failed.",
            stoppedStage,
          );
        }
        throw error;
      }
      if (compactProxyIsPermanentlyInvalid()) {
        diagnosticsStopAttempted = false;
        return null;
      }
      markDiagnosticsBlocked(
        "plugin diagnostics stop failed",
        "Retrieval diagnostics session is stopped and captured",
      );
      if (!ownedDiagnosticsSessions.has(stoppedIdentity.sessionId)) {
        diagnosticsSessionIdentity = null;
        diagnosticsSessionStage = null;
      }
      diagnosticsStopAttempted = false;
      if (persist) {
        try {
          await writeResult();
        } catch {
          // The stop/identity failure remains primary and the owned handle is
          // retained for finalization cleanup.
        }
      }
      if (IS_COMPACT_PROXY) {
        return invalidateCompactProxy(
          error?.message || "Diagnostics stop failed.",
          stoppedStage,
        );
      }
      if (throwOnFailure) throw error;
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
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueDiagnosticsOperation(async () => {
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
      const fail = async (message) => {
        const primaryError = new Error(message);
        try {
          await invalidatePerformanceWorkload({ stage: "cancellationProbe" });
        } catch {
          // The semantic transition failure remains primary if persistence fails.
        }
        throw primaryError;
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
      requireCompactProxyMutationAdmission();
      const binding = result.deviceMeasurement.workloadBinding;
      const next = performanceWorkloadSequence[binding.boundEpisodeCount];
      const priorStagesPass = [
        "standardPerformance", "retryPerformanceBatch1", "retryPerformanceBatch2",
      ].every((stage) => binding.stages[stage].status === "PASS");
      const retryBatch2Bound = diagnosticsSessionStage === "retryPerformanceBatch2"
        ? await performanceStageIsFullyBound("retryPerformanceBatch2") : false;
      requireCompactProxyMutationAdmission();
      if (binding.status === "INVALID"
        || !next
        || next.stage !== "cancellationProbe"
        || !priorStagesPass
        || diagnosticsSessionStage !== "retryPerformanceBatch2"
        || !retryBatch2Bound) {
        await invalidatePerformanceWorkload({ stage: "cancellationProbe" });
        throw new Error("Cancellation probe must follow the exact bound standard and retry workload.");
      }
      if (diagnosticsSessionStage === "retryPerformanceBatch2") {
        await stopRetrievalDiagnosticsImpl();
        requireCompactProxyMutationAdmission();
      }
      const standardStatus = result.deviceMeasurement.diagnosticsSummary
        ?.measurementEpisodes?.standardPerformance?.status;
      const retryStatus = result.deviceMeasurement.diagnosticsSummary
        ?.measurementEpisodes?.retryPerformance?.status;
      if (standardStatus !== "VALID" || retryStatus !== "VALID") {
        return fail("Standard and retry diagnostics must contain their exact frozen episode counts.");
      }
      const admissionChecksLength = result.checks.length;
      const previousDiagnosticsGate = clone(result.deviceMeasurement.diagnosticsGate);
      const previousCancellationCursor = performanceStageCursors.cancellationProbe;
      await startDiagnosticsSession(
        "cancellationProbe",
        "Isolated cancellation-probe diagnostics session is active",
      );
      if (!diagnosticsSessionIdentity || diagnosticsSessionStage !== "cancellationProbe") {
        throw diagnosticsLastStartError
          || new Error("Cancellation-probe diagnostics session could not be started.");
      }
      performanceStageCursors.cancellationProbe = 0;
      try {
        const armed = await plugin.armRetrievalCancellationProbe(
          diagnosticsSessionIdentity.sessionId,
        );
        requireCompactProxyMutationAdmission();
        if (armed?.sessionId !== diagnosticsSessionIdentity.sessionId || armed?.armed !== true) {
          throw new Error("Invalid cancellation-probe arm receipt.");
        }
        record("The next dispatched Chat graph Worker cancellation probe is armed", "PASS");
      } catch (primaryError) {
        await rollbackDiagnosticsAdmission();
        result.checks.splice(admissionChecksLength);
        result.deviceMeasurement.diagnosticsGate = previousDiagnosticsGate;
        performanceStageCursors.cancellationProbe = previousCancellationCursor;
        if (compactProxyIsPermanentlyInvalid()) throw primaryError;
        markDiagnosticsBlocked(
          "plugin cancellation-probe arm failed",
          "The next dispatched Chat graph Worker cancellation probe is armed",
        );
        try {
          await writeResult();
        } catch {
          // The arm/receipt failure remains primary; its cleanup state is kept
          // in memory even when the non-PASS receipt cannot be persisted.
        }
        const error = new Error("The diagnostics-only cancellation probe could not be armed.");
        error.cause = primaryError;
        throw error;
      }
      requireCompactProxyMutationAdmission();
      try {
        await writeResult();
        return clone(result.deviceMeasurement);
      } catch (error) {
        await rollbackDiagnosticsAdmission();
        result.checks.splice(admissionChecksLength);
        result.deviceMeasurement.diagnosticsGate = previousDiagnosticsGate;
        performanceStageCursors.cancellationProbe = previousCancellationCursor;
        if (IS_COMPACT_PROXY && !compactProxyIsPermanentlyInvalid()) {
          return invalidateCompactProxy(
            error?.message || "Cancellation-probe admission failed.",
            "cancellationProbe",
          );
        }
        throw error;
      }
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
    requireCompactProxyMutationAdmission();
    requireMeasurementSettingsStable();
    if (!frozenDevicePlan) throw new Error("Freeze the device measurement plan before recording diagnostics.");
    const projection = projectRetrievalDiagnostics(snapshot);
    // Projection-only test seam: authoritative receipt evidence always comes
    // from the plugin-owned post-freeze diagnostics session.
    return clone(projection);
  };

  const observeMeasurementSettings = () => {
    const currentPlugin = app.plugins.plugins[PLUGIN_ID];
    const currentFingerprint = currentPlugin ? fingerprintSettings(currentPlugin) : null;
    const expectedCompactTransition = compactSettingsTransitionActive
      && compactExpectedSettingsFingerprint === currentFingerprint;
    if (!currentPlugin
      || (settingsFingerprint !== currentFingerprint && !expectedCompactTransition)) {
      settingsChangedDuringRun = true;
      poisonCompactProxyFromRuntime("measurement_settings_drift");
    }
    return !settingsChangedDuringRun;
  };

  const measurementSettingsAreStable = () => observeMeasurementSettings();

  const requireMeasurementSettingsStable = () => {
    if (!measurementSettingsAreStable()) {
      throw new Error(
        "Retrieval, Data Boundary, provider, selected reranker, or Pagelet execution settings changed during this smoke run.",
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

  const canonicalMemoryDocumentList = (values, evidenceName) => {
    if (!Array.isArray(values)) {
      throw new Error(`Canonical Chat retrieval ${evidenceName} is unavailable; leave the case PENDING.`);
    }
    return values.map((value) => {
      const rawPath = value?.path;
      if (typeof rawPath !== "string" || !rawPath.trim()) {
        throw new Error(`Canonical Chat retrieval ${evidenceName} contains a non-string path; leave the case PENDING.`);
      }
      const path = normalizeRankedPath(rawPath);
      if (!path) {
        throw new Error(`Canonical Chat retrieval ${evidenceName} contains an invalid path; leave the case PENDING.`);
      }
      const chunkIndex = value?.chunkIndex;
      if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
        throw new Error(`Canonical Chat retrieval ${evidenceName} contains an invalid chunk identity; leave the case PENDING.`);
      }
      return {
        path,
        chunkIndex,
        identity: `${path}\u0000${chunkIndex}`,
      };
    });
  };

  const orderedUniquePaths = (documents) => {
    const seen = new Set();
    const paths = [];
    for (const document of documents) {
      if (seen.has(document.path)) continue;
      seen.add(document.path);
      paths.push(document.path);
    }
    return paths;
  };

  const readLatestCanonicalMemoryProjection = (expectedPrompt, options = {}) => {
    const requireFreshChat = options.requireFreshChat === true;
    const expectedRunId = typeof options.expectedRunId === "string"
      ? options.expectedRunId
      : null;
    const expectedSuccessfulSearchMemoryToolResultCount =
      options.expectedSuccessfulSearchMemoryToolResultCount ?? 1;
    if (![1, 2].includes(expectedSuccessfulSearchMemoryToolResultCount)) {
      throw new Error("Canonical Chat retrieval expects one or two visible search_memory results.");
    }
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
    if (canonicalUsers.length !== 1
      || canonicalTurn.messages[0] !== canonicalUsers[0]
      || canonicalUsers[0].content !== expectedPrompt) {
      throw new Error("The canonical Chat retrieval transcript does not contain the exact unique prompt; leave the case PENDING.");
    }
    if (canonicalTurn.messages.at(-1)?.role !== "assistant") {
      throw new Error("The canonical Chat retrieval transcript has no final assistant message; leave the case PENDING.");
    }
    const canonicalMessageIds = new Set();
    for (const message of canonicalTurn.messages) {
      if (typeof message?.id !== "string"
        || !message.id.trim()
        || canonicalMessageIds.has(message.id)) {
        throw new Error("Canonical Chat retrieval message ids must be non-empty and unique; leave the case PENDING.");
      }
      canonicalMessageIds.add(message.id);
    }
    const finalAssistant = canonicalTurn.messages.at(-1);
    const finalAssistantToolCalls = Array.isArray(finalAssistant.content)
      ? finalAssistant.content.filter((part) => part?.type === "toolCall")
      : null;
    const finalAssistantHasText = Array.isArray(finalAssistant.content)
      && finalAssistant.content.some((part) => (
        part?.type === "text" && typeof part.text === "string" && part.text.trim()
      ));
    const finalAssistantText = Array.isArray(finalAssistant.content)
      ? finalAssistant.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
      : "";
    if (!Array.isArray(finalAssistant.content)
      || finalAssistantToolCalls.length !== 0
      || !finalAssistantHasText
      || finalAssistant.stopReason !== "stop"
      || canonicalTurn.committedFinalText !== finalAssistantText
      || assistant.content !== finalAssistantText
      || assistant.shareCardEligible === false) {
      throw new Error("The canonical Chat retrieval transcript has no completed final assistant; leave the case PENDING.");
    }

    const visiblePairs = [];
    const seenToolCallIds = new Set();
    const seenToolResultCallIds = new Set();
    let messageIndex = 1;
    while (messageIndex < canonicalTurn.messages.length - 1) {
      const toolCallAssistant = canonicalTurn.messages[messageIndex];
      const toolCalls = toolCallAssistant?.role === "assistant"
        && Array.isArray(toolCallAssistant.content)
        ? toolCallAssistant.content.filter((part) => part?.type === "toolCall")
        : [];
      if (toolCalls.length === 0 || toolCallAssistant.stopReason !== "tool_calls") {
        throw new Error(
          "The canonical Chat transcript must contain ordered search_memory tool-call/result pairs and one final assistant.",
        );
      }
      for (const toolCall of toolCalls) {
        if (toolCall?.name !== "search_memory"
          || typeof toolCall.id !== "string"
          || !toolCall.id.trim()
          || seenToolCallIds.has(toolCall.id)) {
          throw new Error(
            "Canonical Chat retrieval contains another tool or a duplicate search_memory call id; leave the case PENDING.",
          );
        }
        seenToolCallIds.add(toolCall.id);
      }
      messageIndex += 1;
      for (const toolCall of toolCalls) {
        const toolResult = canonicalTurn.messages[messageIndex];
        if (toolResult?.role !== "toolResult"
          || toolResult.toolName !== "search_memory"
          || toolResult.toolCallId !== toolCall.id
          || seenToolResultCallIds.has(toolResult.toolCallId)) {
          throw new Error(
            "The canonical Chat transcript must contain ordered unique search_memory tool-call/result pairs and no other tool results.",
          );
        }
        seenToolResultCallIds.add(toolResult.toolCallId);
        visiblePairs.push({ toolCall, toolResult });
        messageIndex += 1;
      }
    }
    const successfulMemoryToolResults = visiblePairs.map(({ toolResult }) => toolResult);
    const expectedCountLabel = expectedSuccessfulSearchMemoryToolResultCount === 1
      ? "one" : "two";
    if (successfulMemoryToolResults.length !== expectedSuccessfulSearchMemoryToolResultCount
      || successfulMemoryToolResults.some((message) => (
        message.isError !== false || message.content?.metadata?.outcome !== "success"
      ))) {
      throw new Error(
        `Expected exactly ${expectedCountLabel} successful canonical search_memory tool result${expectedSuccessfulSearchMemoryToolResultCount === 1 ? "" : "s"}; leave the case PENDING.`,
      );
    }
    if (successfulMemoryToolResults.some((message) => (
      message.content?.metadata?.toolCallId !== undefined
      && message.content.metadata.toolCallId !== message.toolCallId
    ))) {
      throw new Error(
        "Canonical search_memory result metadata disagrees with its tool-call id; leave the case PENDING.",
      );
    }
    const resultProjections = successfulMemoryToolResults.map((memoryToolResult, index) => {
      const selectedMemoryItems = (memoryToolResult.content?.contextUsed ?? []).filter((item) => (
        item?.category === "memory" && item.label === "Selected Memory"
      ));
      if (selectedMemoryItems.length !== 1) {
        throw new Error("Expected exactly one canonical Selected Memory projection per visible result; leave the case PENDING.");
      }
      const selectedDocuments = canonicalMemoryDocumentList(
        selectedMemoryItems[0].sources,
        `Selected Memory sources for visible result ${index + 1}`,
      );
      const sourceRecords = memoryToolResult.content?.sourceRecords;
      if (!Array.isArray(sourceRecords)) {
        throw new Error("Canonical Memory source records are unavailable; leave the case PENDING.");
      }
      const memoryRecordDocuments = canonicalMemoryDocumentList(
        sourceRecords.filter((record) => (
          record?.kind === "memory-reference" && record.sourceBoundary === "memory"
        )),
        `Memory source records for visible result ${index + 1}`,
      );
      const selectedDocumentIdentities = selectedDocuments.map((document) => document.identity);
      const memoryRecordDocumentIdentities = memoryRecordDocuments.map((document) => (
        document.identity
      ));
      if (selectedDocumentIdentities.length !== memoryRecordDocumentIdentities.length
        || selectedDocumentIdentities.some((identity, documentIndex) => (
          identity !== memoryRecordDocumentIdentities[documentIndex]
        ))) {
        throw new Error("Canonical Selected Memory document sets or path allowlist disagree; leave the case PENDING.");
      }
      return {
        selectedDocuments,
        duplicateDocumentCount: selectedDocumentIdentities.length
          - new Set(selectedDocumentIdentities).size,
        metadata: clone(memoryToolResult.content?.metadata || {}),
      };
    });
    const seenDocumentIdentities = new Set();
    const selectedDocuments = [];
    for (const projection of resultProjections) {
      for (const document of projection.selectedDocuments) {
        if (seenDocumentIdentities.has(document.identity)) continue;
        selectedDocuments.push(document);
      }
      for (const document of projection.selectedDocuments) {
        seenDocumentIdentities.add(document.identity);
      }
    }
    if (selectedDocuments.length === 0) {
      throw new Error("Canonical Selected Memory sources are empty; leave the case PENDING.");
    }
    const selectedDocumentIdentities = [...new Set(
      selectedDocuments.map((document) => document.identity),
    )];
    const selectedPaths = orderedUniquePaths(selectedDocuments);
    const selectedSet = new Set(selectedPaths);

    const readMergedContextDocuments = (metadata, evidenceName) => {
      const items = metadata?.contextUsed;
      if (!Array.isArray(items)) {
        throw new Error(`Canonical Chat retrieval ${evidenceName} is unavailable; leave the case PENDING.`);
      }
      const selectedItems = items.filter((item) => (
        item?.category === "memory" && item.label === "Selected Memory"
      ));
      if (selectedItems.length !== 1) {
        throw new Error(`Expected exactly one merged ${evidenceName}; leave the case PENDING.`);
      }
      return canonicalMemoryDocumentList(selectedItems[0].sources, evidenceName);
    };
    const readMergedRecordPaths = (metadata, evidenceName) => {
      if (!Array.isArray(metadata?.sourceRecords)) {
        throw new Error(`Canonical Chat retrieval ${evidenceName} is unavailable; leave the case PENDING.`);
      }
      return canonicalPathList(
        metadata.sourceRecords.filter((record) => (
          record?.kind === "memory-reference" && record.sourceBoundary === "memory"
        )),
        (record) => record?.path,
        evidenceName,
      );
    };
    const mergedContextDocuments = readMergedContextDocuments(
      assistant.memoryMetadata,
      "assistant merged Selected Memory projection",
    );
    const mergedRecordPaths = readMergedRecordPaths(
      assistant.memoryMetadata,
      "assistant merged Memory source records",
    );
    const mergedDocumentLists = [mergedContextDocuments];
    const mergedRecordPathLists = [mergedRecordPaths];
    if (Array.isArray(canonicalTurn.contextUsed) || Array.isArray(canonicalTurn.sourceRecords)) {
      mergedDocumentLists.push(readMergedContextDocuments(
        canonicalTurn,
        "canonical-turn merged Selected Memory projection",
      ));
      mergedRecordPathLists.push(
        readMergedRecordPaths(canonicalTurn, "canonical-turn merged Memory source records"),
      );
    }
    if (mergedDocumentLists.some((documents) => (
      documents.length !== selectedDocumentIdentities.length
      || documents.some((document, index) => (
        document.identity !== selectedDocumentIdentities[index]
      ))
    ))) {
      throw new Error("Canonical Selected Memory document sets or path allowlist disagree; leave the case PENDING.");
    }
    const allowedPaths = canonicalPathList(
      assistant.memoryMetadata?.allowedMemorySourcePaths,
      (path) => path,
      "assistant Memory allowlist",
    );
    const memoryRecordPaths = selectedDocuments.map((document) => document.path);
    const sourceRecordSet = new Set(mergedRecordPaths);
    const allowedSet = new Set(allowedPaths);
    if (mergedRecordPathLists.some((paths) => (
      !samePathSet(selectedSet, new Set(paths))
    ))
      || !samePathSet(selectedSet, sourceRecordSet)
      || !samePathSet(selectedSet, allowedSet)) {
      throw new Error("Canonical Selected Memory document sets or path allowlist disagree; leave the case PENDING.");
    }
    const duplicateDocumentCount = resultProjections.reduce((sum, projection) => (
      sum + projection.duplicateDocumentCount
    ), 0);
    const firstTimestamp = canonicalTurn.messages[0]?.timestamp;
    const finalTimestamp = canonicalTurn.messages.at(-1)?.timestamp;
    const outerTurnDurationMs = Number.isFinite(firstTimestamp)
      && Number.isFinite(finalTimestamp)
      && finalTimestamp >= firstTimestamp
      ? finalTimestamp - firstTimestamp
      : null;

    return {
      canonicalRunId: canonicalTurn.runId,
      outerTurnDurationMs,
      finalPaths: selectedPaths,
      finalDocumentCount: selectedDocuments.length,
      duplicateDocumentCount,
      orderedSourcePaths: memoryRecordPaths,
      visibleMemoryResultDocumentCounts: resultProjections.map((projection) => (
        projection.selectedDocuments.length
      )),
      finalMetadata: resultProjections.at(-1)?.metadata || {},
      sourceBinding: {
        evidenceSource: "sidellm-view.chatHistory",
        exactPromptMatched: true,
        turnStatus: canonicalTurn.status,
        successfulSearchMemoryToolResultCount: successfulMemoryToolResults.length,
        selectedMemorySourceCount: selectedSet.size,
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
    if (canonicalProjection.finalDocumentCount > 8
      || canonicalProjection.duplicateDocumentCount !== 0) {
      throw new Error("The fresh Chat final Memory documents violate the path + chunk identity contract.");
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
      requireCompactProxyMutationAdmission();
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
      let appendedEntry = null;
      let appendedRunId = null;
      const previousQualificationCursor = performanceQualificationCursor;
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
        requireCompactProxyMutationAdmission();
        performanceEvidenceRunIds.add(canonicalProjection.canonicalRunId);
        appendedRunId = canonicalProjection.canonicalRunId;
        performanceQualificationCursor = captured.cursor;
        qualification.entries.push(entry);
        appendedEntry = entry;
        await refreshPerformanceWorkloadBinding();
        requireCompactProxyMutationAdmission();
        await writeResult();
        appendedEntry = null;
        return clone(entry);
      } catch (error) {
        if (appendedEntry) {
          qualification.entries = qualification.entries.filter((entry) => entry !== appendedEntry);
          if (appendedRunId) performanceEvidenceRunIds.delete(appendedRunId);
          performanceQualificationCursor = previousQualificationCursor;
          try {
            await refreshPerformanceWorkloadBinding();
          } catch {
            // The uncommitted qualification remains discarded in-memory.
          }
        }
        if (compactProxyIsPermanentlyInvalid()) throw error;
        return fail(error?.message || "Performance qualification binding failed.");
      }
    })
  );

  const recordPerformanceEpisode = (...unexpectedArguments) => (
    enqueuePerformanceEvidenceOperation(async () => {
      requireCompactProxyMutationAdmission();
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
      let appendedEntry = null;
      let appendedRunId = null;
      const previousStageCursor = performanceStageCursors[next.stage];
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
        requireCompactProxyMutationAdmission();
        performanceEvidenceRunIds.add(canonicalProjection.canonicalRunId);
        appendedRunId = canonicalProjection.canonicalRunId;
        performanceStageCursors[next.stage] = captured.cursor;
        binding.episodes.push(entry);
        appendedEntry = entry;
        await refreshPerformanceWorkloadBinding();
        requireCompactProxyMutationAdmission();
        await writeResult();
        appendedEntry = null;
        return clone(entry);
      } catch (error) {
        if (appendedEntry) {
          binding.episodes = binding.episodes.filter((entry) => entry !== appendedEntry);
          if (appendedRunId) performanceEvidenceRunIds.delete(appendedRunId);
          performanceStageCursors[next.stage] = previousStageCursor;
          try {
            await refreshPerformanceWorkloadBinding();
          } catch {
            // The uncommitted episode remains discarded in-memory.
          }
        }
        if (compactProxyIsPermanentlyInvalid()) throw error;
        return fail(error?.message || "Performance episode binding failed.");
      }
    })
  );

  const compactStats = (samples) => {
    const values = samples.filter((value) => Number.isFinite(value) && value >= 0);
    return values.length === 0 ? null : {
      sampleCount: values.length,
      p50: nearestRankPercentile(values, 0.5),
      p95: nearestRankPercentile(values, 0.95),
      minimum: Math.min(...values),
      maximum: Math.max(...values),
    };
  };

  const buildCompactComparison = (key, controlSamples, evaluatedSamples, reason = null) => {
    const control = compactStats(controlSamples);
    const evaluated = compactStats(evaluatedSamples);
    return control && evaluated ? {
      status: "OBSERVED",
      reason: null,
      control,
      evaluated,
    } : {
      status: "N/A",
      reason: reason || "the metric is not present in both compact phases",
      control,
      evaluated,
    };
  };

  const refreshCompactProxyMetrics = () => {
    if (!IS_COMPACT_PROXY) return;
    const binding = result.compactProxy.workloadBinding;
    const observationKeys = [
      "memorySearchDurationMs", "outerTurnDurationMs", "lexicalDurationMs",
      "graphDurationMs", "graphWorkerDurationMs", "graphWorkerQueueWaitMs",
      "graphMaxBatchDurationMs", "finalizationReserveMs", "finalizationRemainingMs",
      "deadlineExceededCount",
      "cancelRequestedCount", "cancelObservedCount", "acceptedAfterCancelCount",
      "lateDiscardCount", "fallbackCount", "cancelToWorkerObservedMs",
      "cancelToLateDiscardedMs", "cancelToProbeCompletedMs",
      "queueReleaseProbeResultCount",
    ];
    for (const [stage, expectedCount] of Object.entries(COMPACT_STAGE_COUNTS)) {
      const episodes = binding.episodes.filter((entry) => entry.stage === stage);
      const resource = compactProxyStageResources[stage];
      const observations = Object.fromEntries(observationKeys.map((key) => [
        key,
        episodes.map((entry) => entry.observations[key]).filter(Number.isFinite),
      ]));
      observations.eventLoopStallMs = [...(resource?.eventLoopStallMs || [])];
      observations.estimatedDbBytes = [...(resource?.estimatedDbBytes || [])];
      const resourceRequired = stage !== "cancellationProbe";
      const status = binding.stages[stage].status === "PASS"
        && (!resourceRequired || resource?.status === "PASS")
        ? "PASS"
        : binding.stages[stage].status === "INVALID" ? "INVALID" : "PENDING";
      result.compactProxy.metrics[stage] = {
        status,
        sampleCount: episodes.length,
        warmupCount: episodes.filter((entry) => entry.sampleClass === "warmup").length,
        measuredCount: episodes.filter((entry) => entry.sampleClass === "measured").length,
        expectedCount,
        observations,
      };
    }
    const controlMeasured = binding.episodes.filter((entry) => (
      entry.stage === "controlStandard" && entry.sampleClass === "measured"
    ));
    const evaluatedMeasured = binding.episodes.filter((entry) => (
      entry.stage === "evaluatedStandard" && entry.sampleClass === "measured"
    ));
    const retryMeasured = binding.episodes.filter((entry) => (
      entry.stage === "evaluatedRetry" && entry.sampleClass === "measured"
    ));
    const samples = (entries, key) => entries
      .map((entry) => entry.observations[key])
      .filter(Number.isFinite);
    const controlResource = compactProxyStageResources.controlStandard;
    const evaluatedResource = compactProxyStageResources.evaluatedStandard;
    result.compactProxy.metrics.comparison = {
      standardMemorySearchDurationMs: buildCompactComparison(
        "standardMemorySearchDurationMs",
        samples(controlMeasured, "memorySearchDurationMs"),
        samples(evaluatedMeasured, "memorySearchDurationMs"),
      ),
      outerTurnDurationMs: buildCompactComparison(
        "outerTurnDurationMs",
        samples(controlMeasured, "outerTurnDurationMs"),
        samples(evaluatedMeasured, "outerTurnDurationMs"),
      ),
      eventLoopStallMs: buildCompactComparison(
        "eventLoopStallMs",
        controlResource?.eventLoopStallMs || [],
        evaluatedResource?.eventLoopStallMs || [],
      ),
      estimatedDbBytes: buildCompactComparison(
        "estimatedDbBytes",
        controlResource?.estimatedDbBytes || [],
        evaluatedResource?.estimatedDbBytes || [],
      ),
      lexicalDurationMs: buildCompactComparison(
        "lexicalDurationMs", [], samples(evaluatedMeasured, "lexicalDurationMs"),
        "the all-flags-off control has no lexical-profile counterpart",
      ),
      graphDurationMs: buildCompactComparison(
        "graphDurationMs", [], samples(evaluatedMeasured, "graphDurationMs"),
        "the all-flags-off control has no Graph counterpart",
      ),
      retryDurationMs: buildCompactComparison(
        "retryDurationMs", [],
        samples(retryMeasured, "memorySearchDurationMs"),
        "the all-flags-off control has no relaxed-retry counterpart",
      ),
      rebuildDurationMs: buildCompactComparison(
        "rebuildDurationMs", [],
        Number.isFinite(result.compactProxy.maintenance.rebuild.runtimeEnvelope?.publicApiDurationMs)
          ? [result.compactProxy.maintenance.rebuild.runtimeEnvelope.publicApiDurationMs] : [],
        "the all-flags-off control has no lexical rebuild counterpart",
      ),
      incrementalUpdateDurationMs: buildCompactComparison(
        "incrementalUpdateDurationMs", [],
        Number.isFinite(
          result.compactProxy.maintenance.incrementalUpdate.runtimeEnvelope?.publicApiDurationMs,
        )
          ? [result.compactProxy.maintenance.incrementalUpdate.runtimeEnvelope.publicApiDurationMs]
          : [],
        "the all-flags-off control has no lexical incremental-update counterpart",
      ),
    };
    const requiredStageOrder = [
      "controlStandard", "rebuild", "incremental-update",
      "evaluatedStandard", "evaluatedRetry",
    ];
    const maintenance = result.compactProxy.maintenance;
    const requiredReady = compactProxyStageResources.controlStandard?.status === "PASS"
      && maintenance.rebuild.status === "PASS"
      && maintenance.rebuild.runtimeEnvelope?.status === "PASS"
      && maintenance.incrementalUpdate.status === "PASS"
      && maintenance.incrementalUpdate.runtimeEnvelope?.status === "PASS"
      && compactProxyStageResources.evaluatedStandard?.status === "PASS"
      && compactProxyStageResources.evaluatedRetry?.status === "PASS";
    const requiredInvalid = binding.status === "INVALID"
      || maintenance.status === "INVALID"
      || ["controlStandard", "evaluatedStandard", "evaluatedRetry"].some((stage) => (
        result.compactProxy.metrics[stage]?.status === "INVALID"
      ));
    if (requiredReady) {
      const estimatedDbBytes = [
        ...compactProxyStageResources.controlStandard.estimatedDbBytes,
        maintenance.rebuild.estimatedDbBytesBefore,
        maintenance.rebuild.estimatedDbBytesPeak,
        maintenance.rebuild.estimatedDbBytesAfter,
        maintenance.incrementalUpdate.estimatedDbBytesBefore,
        maintenance.incrementalUpdate.estimatedDbBytesPeak,
        maintenance.incrementalUpdate.estimatedDbBytesAfter,
        ...compactProxyStageResources.evaluatedStandard.estimatedDbBytes,
        ...compactProxyStageResources.evaluatedRetry.estimatedDbBytes,
      ];
      const eventLoopStallMs = [
        ...compactProxyStageResources.controlStandard.eventLoopStallMs,
        ...maintenance.rebuild.runtimeEnvelope.eventLoopStallMs.samples,
        ...maintenance.incrementalUpdate.runtimeEnvelope.eventLoopStallMs.samples,
        ...compactProxyStageResources.evaluatedStandard.eventLoopStallMs,
        ...compactProxyStageResources.evaluatedRetry.eventLoopStallMs,
      ];
      const aggregateValid = estimatedDbBytes.length >= 15
        && eventLoopStallMs.length >= 11
        && estimatedDbBytes.every((value) => Number.isSafeInteger(value) && value >= 0)
        && eventLoopStallMs.every((value) => Number.isFinite(value) && value >= 0);
      result.compactProxy.metrics.requiredResourceEnvelope = aggregateValid ? {
        status: "PASS",
        includedStages: requiredStageOrder,
        estimatedDbBytes: {
          samples: estimatedDbBytes,
          maximum: Math.max(...estimatedDbBytes),
        },
        eventLoopStallMs: {
          samples: eventLoopStallMs,
          maximum: Math.max(...eventLoopStallMs),
        },
      } : {
        status: "INVALID",
        includedStages: [],
        estimatedDbBytes: { samples: [], maximum: null },
        eventLoopStallMs: { samples: [], maximum: null },
      };
    } else {
      result.compactProxy.metrics.requiredResourceEnvelope = {
        status: requiredInvalid ? "INVALID" : "PENDING",
        includedStages: [],
        estimatedDbBytes: { samples: [], maximum: null },
        eventLoopStallMs: { samples: [], maximum: null },
      };
    }
    const processSamples = Object.values(compactProxyStageResources)
      .flatMap((entry) => entry?.processMemoryBytes || []);
    const heapSamples = Object.values(compactProxyStageResources)
      .flatMap((entry) => entry?.heapUsedBytes || []);
    result.compactProxy.optionalDiagnostics.processMemory = processSamples.length > 0
      ? { status: "OBSERVED", samples: processSamples, maximum: Math.max(...processSamples) }
      : { status: "UNSUPPORTED", samples: [], maximum: null };
    result.compactProxy.optionalDiagnostics.heap = heapSamples.length > 0
      ? { status: "OBSERVED", samples: heapSamples, maximum: Math.max(...heapSamples) }
      : { status: "UNSUPPORTED", samples: [], maximum: null };
  };

  const compactHardBudgetViolations = (next, observations, graphAttempts) => {
    const budgets = compactProxyPlanTemplate.hardBudgets;
    const violations = [];
    const priorConfiguredReserves = result.compactProxy.workloadBinding.episodes
      .map((entry) => entry.observations.finalizationReserveMs)
      .filter(Number.isFinite);
    if (observations.fallbackCount !== 0) {
      violations.push(`${next.id}:unexpectedFallback`);
    }
    if (!Number.isFinite(observations.finalizationReserveMs)
      || observations.finalizationReserveMs <= budgets.finalizationReserveMinExclusiveMs) {
      violations.push(`${next.id}:finalizationReserve`);
    }
    if (priorConfiguredReserves.some((value) => value !== observations.finalizationReserveMs)) {
      violations.push(`${next.id}:finalizationReserveDrift`);
    }
    if (next.stage !== "cancellationProbe") {
      if (!Number.isFinite(observations.memorySearchDurationMs)
        || observations.memorySearchDurationMs > budgets.recoveryMs) {
        violations.push(`${next.id}:recoveryMs`);
      }
      if (!Number.isFinite(observations.outerTurnDurationMs)
        || observations.outerTurnDurationMs > budgets.outerTurnMs) {
        violations.push(`${next.id}:outerTurnMs`);
      }
      if (!Number.isFinite(observations.finalizationRemainingMs)
        || observations.finalizationRemainingMs <= 0) {
        violations.push(`${next.id}:finalizationRemaining`);
      }
      if (observations.deadlineExceededCount !== 0) {
        violations.push(`${next.id}:deadlineExceeded`);
      }
      if (observations.cancelRequestedCount !== 0
        || observations.cancelObservedCount !== 0
        || observations.acceptedAfterCancelCount !== 0
        || observations.lateDiscardCount !== 0) {
        violations.push(`${next.id}:unexpectedCancellation`);
      }
      if ([
        observations.cancelToWorkerObservedMs,
        observations.cancelToLateDiscardedMs,
        observations.cancelToProbeCompletedMs,
        observations.queueReleaseProbeResultCount,
      ].some((value) => value !== null)) {
        violations.push(`${next.id}:unexpectedQueueReleaseProbe`);
      }
    }
    if (next.settingsPhase === "evaluated" && next.stage !== "cancellationProbe") {
      if (!Number.isFinite(observations.lexicalDurationMs)
        || observations.lexicalDurationMs > budgets.lexicalMs) {
        violations.push(`${next.id}:lexicalMs`);
      }
      if (graphAttempts.some((duration) => (
        !Number.isFinite(duration) || duration > budgets.graphMs
      ))) {
        violations.push(`${next.id}:graphMs`);
      }
      if (!Number.isFinite(observations.graphWorkerDurationMs)
        || !Number.isFinite(observations.graphWorkerQueueWaitMs)
        || !Number.isFinite(observations.graphMaxBatchDurationMs)) {
        violations.push(`${next.id}:workerTiming`);
      }
    }
    if (next.stage === "cancellationProbe"
      && (observations.cancelRequestedCount < 1
        || observations.cancelObservedCount < 1
        || observations.acceptedAfterCancelCount !== 0
        || observations.lateDiscardCount < 1
        || observations.deadlineExceededCount !== 0
        || !Number.isFinite(observations.cancelToWorkerObservedMs)
        || !Number.isFinite(observations.cancelToLateDiscardedMs)
        || !Number.isFinite(observations.cancelToProbeCompletedMs)
        || observations.cancelToWorkerObservedMs < 0
        || observations.cancelToWorkerObservedMs > observations.cancelToLateDiscardedMs
        || observations.cancelToLateDiscardedMs > observations.cancelToProbeCompletedMs
        || observations.cancelToProbeCompletedMs > budgets.graphMs
        || observations.queueReleaseProbeResultCount !== 1
        || !Number.isFinite(observations.graphMaxBatchDurationMs))) {
      violations.push(`${next.id}:cancellationInvariant`);
    }
    return violations;
  };

  const compactStageIsFullyBound = async (stage) => {
    const summary = result.compactProxy.workloadBinding.stages[stage];
    if (!summary || summary.status !== "PASS"
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
        && (projection.events.at(-1)?.sequence ?? 0) === compactProxyStageCursors[stage];
    } catch {
      return false;
    }
  };

  const validateCompactControlEpisode = (episode, canonicalProjection) => {
    const finalPaths = canonicalProjection.finalPaths;
    const directVectorOnly = !episode.events.some((event) => (
      (event.phase === "ppr_solve" || event.phase === "graph_worker")
      && event.outcome === "started"
    ));
    if (episode.runId !== canonicalProjection.canonicalRunId
      || canonicalProjection.finalDocumentCount > 8
      || canonicalProjection.duplicateDocumentCount !== 0
      || episode.standardCallCount !== 1
      || episode.attempts.length !== 1
      || episode.attempts[0].terminal?.outcome !== "completed"
      || episode.standardTerminal?.outcome !== "completed"
      || episode.relaxedStartedCount !== 0
      || episode.projectionStartedCount !== 0
      || episode.hasCancellationEvidence
      || !directVectorOnly
      || !hasFinalEvidenceMetadata(canonicalProjection)
      || !finalPaths.some((path) => PERFORMANCE_WAVE1_DIRECT_PATHS.includes(path))
      || !finalPaths.every((path) => (
        PERFORMANCE_WAVE1_DIRECT_PATHS.includes(path)
        || path === PERFORMANCE_WAVE1_GRAPH_HUB_PATH
      ))) {
      throw new Error("The compact control episode is not one direct/vector fresh-Chat standard retrieval.");
    }
  };

  const buildCompactCancellationEvidence = async (episode) => {
    const events = episode.events.filter((event) => (
      event.phase === "queue_release"
      || (event.phase === "graph_worker" && (
        event.outcome === "started"
        || event.reason === "cancel_requested"
        || event.reason === "cancel_observed"
        || event.reason === "late_result"
      ))
    )).map((event) => ({
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      phase: event.phase,
      outcome: event.outcome,
      reason: event.reason ?? null,
      metrics: clone(event.metrics),
    }));
    const evidence = {
      schemaVersion: RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION,
      runId: episode.runId,
      surface: "chat",
      graphQueueReleaseAbsoluteEnvelopeMs: GRAPH_QUEUE_RELEASE_ABSOLUTE_ENVELOPE_MS,
      events,
    };
    return {
      ...evidence,
      evidenceSha256: await digest(canonicalJson(evidence)),
    };
  };

  const recordCompactProxyEpisode = (...unexpectedArguments) => {
    const operation = async () => {
      if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
      const binding = result.compactProxy.workloadBinding;
      const next = compactProxyWorkloadSequence[binding.boundEpisodeCount];
      if (unexpectedArguments.length !== 0) {
        return invalidateCompactProxy(
          "recordCompactProxyEpisode does not accept prompt, run, source, or workload arguments.",
          next?.stage,
        );
      }
      if (!next) return invalidateCompactProxy("The compact proxy already has exactly 33 episodes.");
      if (compactProxyCurrentStage !== next.stage || diagnosticsSessionStage !== next.stage) {
        return invalidateCompactProxy("The compact diagnostics stage does not match the next episode.", next.stage);
      }
      try {
        const captured = await captureSinglePerformanceEpisode(
          next.stage,
          compactProxyStageCursors[next.stage],
        );
        requireCompactProxyMutationAdmission();
        const prompt = compactProxyWorkloadContract.prompts[next.promptId].text;
        const canonicalProjection = readLatestCanonicalMemoryProjection(prompt, {
          requireFreshChat: true,
          expectedRunId: captured.episode.runId,
        });
        if (next.stage === "controlStandard") {
          validateCompactControlEpisode(captured.episode, canonicalProjection);
        } else {
          validatePerformanceEpisodeShape(next.promptId, captured.episode, canonicalProjection);
        }
        if (compactProxyEvidenceRunIds.has(canonicalProjection.canonicalRunId)) {
          throw new Error("The compact proxy run identity was already consumed.");
        }
        const attemptDurations = captured.episode.attempts
          .map((attempt) => attempt.terminal?.metrics?.durationMs);
        const graphEvidence = captured.episode.attempts
          .map(deriveSuccessfulGraphEvidence).filter(Boolean);
        const graphDurations = graphEvidence.map((entry) => entry.wallDurationMs);
        const maximumGraphMetric = (key) => {
          const values = graphEvidence.map((entry) => entry[key]);
          return values.length > 0 && values.every(Number.isFinite)
            ? Math.max(...values)
            : null;
        };
        const observedPerformanceGraphBatchDurations = binding.episodes
          .filter((entry) => ["evaluatedStandard", "evaluatedRetry"].includes(entry.stage))
          .map((entry) => entry.observations.graphMaxBatchDurationMs)
          .filter(Number.isFinite);
        const observedGraphMaxBatchDurationMs = observedPerformanceGraphBatchDurations.length > 0
          ? Math.max(...observedPerformanceGraphBatchDurations)
          : null;
        const stats = await plugin.vss.getStats({ mode: "foreground" });
        requireCompactProxyMutationAdmission();
        const evaluatedLexicalReady = next.settingsPhase === "evaluated"
          ? await compactEvaluatedLexicalGenerationIsReady(stats) : true;
        requireCompactProxyMutationAdmission();
        if (!evaluatedLexicalReady) {
          compactLexicalIdentityDriftDetected = true;
          throw new Error("The evaluated lexical database, profile, or generation drifted.");
        }
        const observations = {
          memorySearchDurationMs: attemptDurations.every(Number.isFinite)
            ? attemptDurations.reduce((sum, value) => sum + value, 0) : null,
          outerTurnDurationMs: canonicalProjection.outerTurnDurationMs,
          lexicalDurationMs: next.settingsPhase === "evaluated"
            && Number.isFinite(stats?.lexicalSearchDurationMs)
            ? stats.lexicalSearchDurationMs : null,
          graphDurationMs: graphDurations.length > 0 ? Math.max(...graphDurations) : null,
          graphWorkerDurationMs: maximumGraphMetric("rankedWorkerDurationMs"),
          graphWorkerQueueWaitMs: maximumGraphMetric("queueWaitMs"),
          graphMaxBatchDurationMs: next.stage === "cancellationProbe"
            ? observedGraphMaxBatchDurationMs
            : maximumGraphMetric("maxBatchDurationMs"),
          cancelToWorkerObservedMs: next.stage === "cancellationProbe"
            ? captured.episode.cancelToWorkerObservedMs : null,
          cancelToLateDiscardedMs: next.stage === "cancellationProbe"
            ? captured.episode.cancelToLateDiscardedMs : null,
          cancelToProbeCompletedMs: next.stage === "cancellationProbe"
            ? captured.episode.cancelToProbeCompletedMs : null,
          queueReleaseProbeResultCount: next.stage === "cancellationProbe"
            ? captured.episode.queueReleaseProbeResultCount : null,
          finalizationReserveMs: captured.episode.finalizationConfiguredReserveMs ?? null,
          finalizationRemainingMs: captured.episode.boundary?.metrics?.remainingMs ?? null,
          deadlineExceededCount: captured.episode.events.filter((event) => (
            event.outcome === "deadline" || (event.reason && DEADLINE_REASONS.has(event.reason))
          )).length,
          cancelRequestedCount: captured.episode.cancelRequested,
          cancelObservedCount: captured.episode.cancelObserved,
          acceptedAfterCancelCount: captured.episode.acceptedAfterCancelCount,
          lateDiscardCount: captured.episode.lateDiscardCount,
          fallbackCount: captured.episode.events.filter((event) => event.outcome === "fallback").length,
        };
        const violations = compactHardBudgetViolations(next, observations, graphDurations);
        if (violations.length > 0) {
          result.compactProxy.hardBudgets.status = "FAIL";
          result.compactProxy.hardBudgets.violations.push(...violations);
          throw new Error(`Compact hard-budget or cancellation invariant failed: ${violations.join(", ")}`);
        }
        const opaqueCorrelationSha256 = await digest(
          `retrieval-compact-proxy-run\u0000${canonicalProjection.canonicalRunId}`,
        );
        const cancellationEvidence = next.stage === "cancellationProbe"
          ? await buildCompactCancellationEvidence(captured.episode)
          : null;
        const executionMode = next.stage === "controlStandard" ? "direct-vector-control"
          : next.stage === "evaluatedStandard" ? "full-graph"
            : next.stage === "evaluatedRetry" ? "full-graph-retry" : "same-worker-cancel";
        const entryWithoutBinding = {
          id: next.id,
          stage: next.stage,
          sampleClass: next.sampleClass,
          promptId: next.promptId,
          settingsPhase: next.settingsPhase,
          surface: "chat",
          freshChat: true,
          sequence: binding.boundEpisodeCount + 1,
          status: "BOUND",
          executionMode,
          opaqueCorrelationSha256,
          cancellationEvidence,
          observations,
        };
        const entry = {
          ...entryWithoutBinding,
          evidenceBindingSha256: await digest(canonicalJson(entryWithoutBinding)),
        };
        const nextBindingSha256 = await digest(canonicalJson([
          ...binding.episodes,
          entry,
        ]));
        requireCompactProxyMutationAdmission();
        compactProxyEvidenceRunIds.add(canonicalProjection.canonicalRunId);
        compactProxyStageCursors[next.stage] = captured.cursor;
        binding.episodes.push(entry);
        applyCompactProxyWorkloadBindingDerived({
          contractSha256: binding.contractSha256,
          sequenceSha256: binding.sequenceSha256,
          bindingSha256: nextBindingSha256,
        });
        refreshCompactProxyMetrics();
        await writeResult();
        return clone(entry);
      } catch (error) {
        return invalidateCompactProxy(
          error?.message || "Compact proxy episode binding failed.",
          next.stage,
        );
      }
    };
    const queued = compactProxyEvidenceOperationQueue.then(operation, operation);
    compactProxyEvidenceOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const restoreCompactInitialSettings = async () => {
    if (!IS_COMPACT_PROXY || !compactInitialRetrievalFlagsState) return true;
    const cleanup = result.compactProxy.settingsTransition.cleanup;
    const initialFlags = compactInitialRetrievalFlagsState.value === undefined
      ? undefined
      : clone(compactInitialRetrievalFlagsState.value);
    const restoredSettings = { ...plugin.settings };
    if (compactInitialRetrievalFlagsState.present) {
      restoredSettings.retrievalOptimizationFlags = initialFlags;
    } else {
      delete restoredSettings.retrievalOptimizationFlags;
    }
    const expectedFingerprint = fingerprintSettings({ settings: restoredSettings });
    const currentFingerprint = fingerprintSettings(plugin);
    if ((cleanup.status === "PASS" || cleanup.status === "NOT_REQUIRED")
      && currentFingerprint === expectedFingerprint) return true;
    if (result.compactProxy.settingsTransition.transitionCount === 0
      && result.compactProxy.settingsTransition.status !== "PASS"
      && currentFingerprint === expectedFingerprint) {
      cleanup.status = "NOT_REQUIRED";
      cleanup.restoredAt = null;
      cleanup.reason = null;
      return true;
    }
    compactSettingsTransitionActive = true;
    compactExpectedSettingsFingerprint = expectedFingerprint;
    try {
      if (typeof plugin.saveSettings !== "function") {
        throw new Error("The plugin settings save seam is unavailable.");
      }
      if (compactInitialRetrievalFlagsState.present) {
        plugin.settings.retrievalOptimizationFlags = initialFlags;
      } else {
        delete plugin.settings.retrievalOptimizationFlags;
      }
      await plugin.saveSettings();
      const restoredFingerprint = fingerprintSettings(plugin);
      if (restoredFingerprint !== expectedFingerprint) {
        throw new Error("The compact initial flag profile was not restored exactly.");
      }
      settingsFingerprint = restoredFingerprint;
      cleanup.status = "PASS";
      cleanup.restoredAt = new Date().toISOString();
      cleanup.reason = null;
      return true;
    } catch {
      const currentFingerprint = fingerprintSettings(plugin);
      if (currentFingerprint === expectedFingerprint) settingsFingerprint = currentFingerprint;
      cleanup.status = "BLOCKED";
      cleanup.restoredAt = null;
      cleanup.reason = "settings_restore_failed";
      return false;
    } finally {
      compactSettingsTransitionActive = false;
      compactExpectedSettingsFingerprint = null;
    }
  };

  const cleanupInvalidCompactProxyState = async () => {
    // INVALID is a poison boundary, not another workflow stage. Stop every
    // live collector/session and restore the original flag profile without
    // admitting or binding any further evidence. Cleanup is best-effort so it
    // never replaces the semantic violation that poisoned the run.
    if (runtimeEnvelopeState) {
      const state = runtimeEnvelopeState;
      state.stopRequested = true;
      try {
        await Promise.allSettled([state.resourceLoopPromise, state.stallLoopPromise]);
      } finally {
        runtimeEnvelopeState = null;
      }
    }
    if (compactProxyResourceState) {
      const poisonedResourceStage = compactProxyResourceState.stage;
      try {
        await stopCompactProxyResourceEnvelope();
      } catch {
        compactProxyResourceState = null;
      }
      if (poisonedResourceStage) compactProxyStageResources[poisonedResourceStage] = null;
    }
    if (diagnosticsSessionIdentity?.sessionId) {
      ownedDiagnosticsSessions.set(
        diagnosticsSessionIdentity.sessionId,
        diagnosticsSessionIdentity,
      );
    }
    const diagnosticsCleanupFailures = await discardOwnedDiagnosticsSessions({ attempts: 2 });
    if (ownedDiagnosticsSessions.size === 0) {
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
    } else if (diagnosticsCleanupFailures.length > 0) {
      diagnosticsEvidenceBlocked = true;
      result.deviceMeasurement.diagnosticsGate = {
        status: "BLOCKED",
        reason: "orphan diagnostics session cleanup failed",
        schemaVersion: diagnosticsSessionIdentity?.schemaVersion ?? null,
        capacity: diagnosticsSessionIdentity?.capacity ?? null,
      };
    }
    stoppedDiagnosticsProjection = null;
    diagnosticsStopAttempted = false;
    compactProxyCurrentStage = null;
    try {
      await restoreCompactInitialSettings();
    } catch {
      // restoreCompactInitialSettings records its fail-closed cleanup state.
    }
    refreshCompactProxyMetrics();
  };

  scheduleCompactProxyPoisonCleanup = () => {
    if (!IS_COMPACT_PROXY
      || compactProxyPoisonHandled
      || compactProxyPublicMutationActive
      || finalizing
      || finalized
      || compactProxyFinalizationFence) return;
    compactProxyPoisonHandled = true;
    const cleanup = async () => {
      try {
        await refreshCompactProxyWorkloadBinding();
      } catch {
        // The poison latch remains authoritative if hashing is unavailable.
      }
      try {
        await cleanupInvalidCompactProxyState();
      } catch {
        // Cleanup is best-effort and must not reopen the poisoned run.
      }
      try {
        await writeResult();
      } catch {
        // The poison latch is authoritative even when its receipt cannot be
        // persisted; no later mutation becomes admissible.
      }
    };
    const queued = compactProxyPublicMutationQueue.then(cleanup, cleanup);
    compactProxyPublicMutationQueue = queued.catch(() => undefined);
  };

  const settleCompactProxyPoisonForFinalization = async () => {
    if (!IS_COMPACT_PROXY) return;
    const terminalReason = compactProxyTerminalViolationReason();
    if (!compactProxyPoison.latched && terminalReason) {
      markCompactProxyPoisoned(compactProxyCurrentStage, terminalReason);
    }
    if (!compactProxyIsPermanentlyInvalid()) return;
    try {
      await refreshCompactProxyWorkloadBinding();
    } catch {
      // The in-memory poison latch remains authoritative if hashing fails.
    }
    await cleanupInvalidCompactProxyState();
    try {
      await refreshCompactProxyWorkloadBinding();
    } catch {
      // Finalization still commits INVALID even if its derived hash is blocked.
    }
    compactProxyPoisonHandled = true;
  };

  poisonCompactProxyFromRuntime = (
    reason,
    stage = compactProxyCurrentStage,
  ) => {
    if (!IS_COMPACT_PROXY || !markCompactProxyPoisoned(stage, reason)) return;
    scheduleCompactProxyPoisonCleanup();
  };

  const rollbackCompactStageAdmission = async (
    stage,
    primaryError,
    { reason, restoreInitialFlags = true } = {},
  ) => {
    // A diagnostics stage is not admitted until setup and its receipt commit
    // both succeed. Latch INVALID before cleanup so every best-effort cleanup
    // write is already non-PASS, then discard all uncommitted runtime evidence.
    if (!compactProxyPoison.latched) {
      markCompactProxyPoisoned(stage, primaryError?.message || "stage_admission_failed");
    }
    try {
      await refreshCompactProxyWorkloadBinding();
    } catch {
      // Keep the admission failure primary when derived hashing is blocked.
    }
    compactProxyPoison.reported = true;
    const primaryReason = reason || "stage_admission_failed";
    const commitCheck = record(
      "Compact diagnostics stage receipt commit is atomic",
      "FAIL",
      `${stage}:${primaryReason}`,
    );
    const cleanupFailures = [];
    if (compactProxyResourceState) {
      try {
        await stopCompactProxyResourceEnvelope();
      } catch {
        cleanupFailures.push("resource_envelope_stop_failed");
      }
    }
    if (compactProxyStageResources[stage]) compactProxyStageResources[stage] = null;
    if (Object.hasOwn(compactProxyStageCursors, stage)) compactProxyStageCursors[stage] = 0;

    if (diagnosticsSessionIdentity?.sessionId) {
      ownedDiagnosticsSessions.set(
        diagnosticsSessionIdentity.sessionId,
        diagnosticsSessionIdentity,
      );
    }
    const diagnosticsCleanupFailures = await discardOwnedDiagnosticsSessions({ attempts: 2 });
    if (diagnosticsCleanupFailures.length > 0) {
      cleanupFailures.push("diagnostics_stop_failed");
    } else {
      diagnosticsSessionIdentity = null;
      diagnosticsSessionStage = null;
    }
    stoppedDiagnosticsProjection = null;
    diagnosticsStopAttempted = false;
    compactProxyCurrentStage = null;

    if (restoreInitialFlags) {
      let restored = false;
      try {
        restored = await restoreCompactInitialSettings();
      } catch {
        // restoreCompactInitialSettings currently resolves false on failure,
        // but retain the fail-closed boundary if that contract changes.
      }
      if (!restored) cleanupFailures.push("settings_restore_failed");
    }

    refreshCompactProxyMetrics();
    commitCheck.detail = sanitize([
      `${stage}:${primaryReason}`,
      ...cleanupFailures,
    ].join(";"));
    try {
      await writeResult();
    } catch {
      cleanupFailures.push("non_pass_result_write_failed");
      commitCheck.detail = sanitize([
        `${stage}:${primaryReason}`,
        ...cleanupFailures,
      ].join(";"));
    }
    compactProxyPoisonHandled = true;

    const primaryMessage = primaryError?.message || "stage admission failed";
    const cleanupMessage = cleanupFailures.length > 0
      ? `; cleanup=${cleanupFailures.join(",")}` : "";
    const error = new Error(
      `Compact ${stage} stage receipt commit failed: ${primaryMessage}${cleanupMessage}`,
    );
    error.cause = primaryError;
    throw error;
  };

  const admitCompactStageOrRollback = async (
    stage,
    setup,
    {
      restoreInitialFlags = true,
      setupFailureReason = "stage_setup_failed",
    } = {},
  ) => {
    let setupComplete = false;
    try {
      if (setup) await setup();
      setupComplete = true;
      requireCompactProxyMutationAdmission();
      await writeResult();
      requireCompactProxyMutationAdmission();
    } catch (error) {
      return rollbackCompactStageAdmission(stage, error, {
        reason: setupComplete ? "result_write_failed" : setupFailureReason,
        restoreInitialFlags,
      });
    }
  };

  const startCompactProxyTransition = async (...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      return invalidateCompactProxy("startCompactProxy does not accept arguments.", "controlStandard");
    }
    if (compactProxyCurrentStage || result.compactProxy.workloadBinding.boundEpisodeCount !== 0) {
      return invalidateCompactProxy("The compact proxy was already started.", "controlStandard");
    }
    const flags = plugin.settings?.retrievalOptimizationFlags || {};
    if (REQUIRED_FLAGS.some((key) => flags[key] === true)) {
      return invalidateCompactProxy("Compact control requires all four retrieval flags off.", "controlStandard");
    }
    await stopRetrievalDiagnosticsImpl();
    const started = await startDiagnosticsSession(
      "controlStandard",
      "Compact all-flags-off control diagnostics session is active",
    );
    if (!started || !diagnosticsSessionIdentity) {
      return rollbackCompactStageAdmission(
        "controlStandard",
        diagnosticsLastStartError
          || new Error("Compact control diagnostics could not be started."),
        { reason: "diagnostics_start_failed", restoreInitialFlags: true },
      );
    }
    requireCompactProxyMutationAdmission();
    await admitCompactStageOrRollback(
      "controlStandard",
      () => {
        compactProxyCurrentStage = "controlStandard";
        compactProxyStageCursors.controlStandard = 0;
        return startCompactProxyResourceEnvelope("controlStandard");
      },
      { restoreInitialFlags: true, setupFailureReason: "resource_envelope_setup_failed" },
    );
    return clone(result.compactProxy);
  };

  const startEmptyCompactCorrectnessSession = async () => {
    const started = await startDiagnosticsSession(
      "compactCorrectness",
      "Compact all-flags-on correctness diagnostics session is active",
    );
    if (!started || !diagnosticsSessionIdentity) return false;
    try {
      const projection = projectBoundRetrievalDiagnostics(
        await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId),
        diagnosticsSessionIdentity,
      );
      requireCompactProxyMutationAdmission();
      if (projection.droppedEventCount !== 0 || projection.events.length !== 0) {
        const primaryError = new Error(
          "Fresh compact correctness diagnostics did not start empty.",
        );
        diagnosticsLastStartError = primaryError;
        try {
          await stopRetrievalDiagnosticsImpl();
        } catch (cleanupError) {
          primaryError.cause = cleanupError;
        }
        if (compactProxyIsPermanentlyInvalid()) throw primaryError;
        return false;
      }
      rankingEvidenceCursor = 0;
      return true;
    } catch (error) {
      diagnosticsLastStartError = error;
      try {
        await stopRetrievalDiagnosticsImpl();
      } catch {
        // The capture/schema/admission failure remains primary.
      }
      if (compactProxyIsPermanentlyInvalid()) throw error;
      return false;
    }
  };

  const beginCompactEvaluatedTransition = async (...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      return invalidateCompactProxy("beginCompactEvaluated does not accept arguments.", "controlStandard");
    }
    await compactProxyEvidenceOperationQueue;
    requireCompactProxyMutationAdmission();
    const controlStageBound = compactProxyCurrentStage === "controlStandard"
      ? await compactStageIsFullyBound("controlStandard") : false;
    requireCompactProxyMutationAdmission();
    if (!controlStageBound) {
      return invalidateCompactProxy(
        "The exact six-episode compact control must finish before the evaluated transition.",
        "controlStandard",
      );
    }
    const stableProfileBeforeTransition = await currentStableSettingsProfileSha256(plugin);
    requireCompactProxyMutationAdmission();
    if (stableProfileBeforeTransition !== compactStableSettingsProfileSha256) {
      return invalidateCompactProxy(
        "The content-free compact stable-settings profile drifted before transition.",
        "controlStandard",
      );
    }
    await stopCompactProxyResourceEnvelope();
    await stopRetrievalDiagnosticsImpl();
    requireCompactProxyMutationAdmission();
    compactSettingsTransitionActive = true;
    const evaluatedFlags = clone(compactProxyPlanTemplate.settingsPhases.evaluated);
    compactExpectedSettingsFingerprint = fingerprintSettings({
      settings: { ...plugin.settings, retrievalOptimizationFlags: evaluatedFlags },
    });
    try {
      if (typeof plugin.saveSettings !== "function") {
        throw new Error("The plugin settings save seam is unavailable.");
      }
      plugin.settings.retrievalOptimizationFlags = evaluatedFlags;
      await plugin.saveSettings();
      requireCompactProxyMutationAdmission();
      const currentFingerprint = fingerprintSettings(plugin);
      if (currentFingerprint !== compactExpectedSettingsFingerprint) {
        throw new Error("The compact evaluated flag transition did not persist exactly.");
      }
      const stableProfileDuringTransition = await currentStableSettingsProfileSha256(plugin);
      requireCompactProxyMutationAdmission();
      if (stableProfileDuringTransition !== compactStableSettingsProfileSha256) {
        throw new Error("The content-free compact stable-settings profile drifted during transition.");
      }
      requireCompactProxyMutationAdmission();
      settingsFingerprint = currentFingerprint;
      compactSettingsTransitionActive = false;
      compactExpectedSettingsFingerprint = null;
      result.compactProxy.settingsTransition = {
        ...result.compactProxy.settingsTransition,
        status: "PASS",
        transitionCount: 1,
        transitionedAt: new Date().toISOString(),
      };
    } catch (error) {
      compactSettingsTransitionActive = false;
      compactExpectedSettingsFingerprint = null;
      if (compactProxyIsPermanentlyInvalid()) {
        await restoreCompactInitialSettings();
        throw error;
      }
      result.compactProxy.settingsTransition.status = "INVALID";
      await restoreCompactInitialSettings();
      return invalidateCompactProxy(error?.message || "Compact settings transition failed.");
    }
    compactProxyCurrentStage = "evaluatedPreparation";
    try {
      const rebuild = await enqueueCompactMaintenance(
        () => recordCompactMaintenanceImpl("rebuild", compactAutomaticRebuildToken),
      );
      requireCompactProxyMutationAdmission();
      if (rebuild.status !== "PASS") {
        throw new Error(
          "Compact evaluated lexical readiness could not be prepared before correctness.",
        );
      }
      const evaluatedLexicalReady = await compactEvaluatedLexicalGenerationIsReady();
      requireCompactProxyMutationAdmission();
      if (!evaluatedLexicalReady) {
        compactLexicalIdentityDriftDetected = true;
        await invalidateCompactProxy(
          "The rebuilt evaluated lexical generation was not ready before correctness.",
          null,
        );
      }
      const correctnessSessionStarted = await startEmptyCompactCorrectnessSession();
      requireCompactProxyMutationAdmission();
      if (!correctnessSessionStarted) {
        compactProxyCurrentStage = null;
        await restoreCompactInitialSettings();
        return invalidateCompactProxy(
          diagnosticsLastStartError?.message
            || "Compact correctness diagnostics could not be started after lexical readiness.",
          null,
        );
      }
      requireCompactProxyMutationAdmission();
    } catch (error) {
      compactProxyCurrentStage = null;
      if (error?.compactMaintenanceAdmissionWriteFailure
        && !compactProxyIsPermanentlyInvalid()) {
        return rollbackCompactStageAdmission(
          "compactCorrectness",
          error,
          { reason: "maintenance_admission_write_failed", restoreInitialFlags: true },
        );
      }
      await restoreCompactInitialSettings();
      if (compactProxyIsPermanentlyInvalid()) {
        await cleanupInvalidCompactProxyState();
        throw error;
      }
      try {
        await writeResult();
      } catch {
        // Preserve the rebuild/readiness failure that ended this transition.
      }
      throw error;
    }
    await admitCompactStageOrRollback(
      "compactCorrectness",
      () => {
        compactProxyCurrentStage = "compactCorrectness";
        refreshCompactProxyMetrics();
      },
      { restoreInitialFlags: true },
    );
    return clone(result.compactProxy);
  };

  const beginCompactCorrectnessTransition = async (...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      return invalidateCompactProxy("beginCompactCorrectness does not accept arguments.");
    }
    await compactProxyEvidenceOperationQueue;
    await diagnosticsOperationQueue;
    requireCompactProxyMutationAdmission();
    const cancellationStageBound = compactProxyCurrentStage === "cancellationProbe"
      ? await compactStageIsFullyBound("cancellationProbe") : false;
    requireCompactProxyMutationAdmission();
    if (!cancellationStageBound
      || result.compactProxy.workloadBinding.status !== "PASS"
      || result.compactProxy.settingsTransition.status !== "PASS"
      || result.compactProxy.maintenance.status !== "PASS") {
      return invalidateCompactProxy(
        "Post-performance compact correctness requires all 33 bound episodes and maintenance.",
      );
    }
    await stopRetrievalDiagnosticsImpl();
    requireCompactProxyMutationAdmission();
    const evaluatedLexicalReady = await compactEvaluatedLexicalGenerationIsReady();
    requireCompactProxyMutationAdmission();
    if (!evaluatedLexicalReady) {
      compactLexicalIdentityDriftDetected = true;
      compactProxyCurrentStage = null;
      await restoreCompactInitialSettings();
      return invalidateCompactProxy(
        "The bound evaluated lexical generation drifted before correctness.",
        null,
      );
    }
    const correctnessSessionStarted = await startEmptyCompactCorrectnessSession();
    requireCompactProxyMutationAdmission();
    if (!correctnessSessionStarted) {
      compactProxyCurrentStage = null;
      await restoreCompactInitialSettings();
      return invalidateCompactProxy(
        diagnosticsLastStartError?.message
          || "Compact correctness diagnostics could not be restarted.",
        null,
      );
    }
    requireCompactProxyMutationAdmission();
    await admitCompactStageOrRollback(
      "compactCorrectness",
      () => {
        compactProxyCurrentStage = "compactCorrectness";
        refreshCompactProxyMetrics();
      },
      { restoreInitialFlags: true },
    );
    return clone(result.compactProxy);
  };

  const beginCompactPerformanceTransition = async (...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      return invalidateCompactProxy("beginCompactPerformance does not accept arguments.");
    }
    await compactProxyEvidenceOperationQueue;
    await compactProxyMaintenanceOperationQueue;
    await diagnosticsOperationQueue;
    requireCompactProxyMutationAdmission();
    if (compactProxyCurrentStage !== "compactCorrectness"
      || diagnosticsSessionStage !== "compactCorrectness"
      || result.compactProxy.settingsTransition.status !== "PASS"
      || result.compactProxy.maintenance.status !== "PASS") {
      return invalidateCompactProxy(
        "Compact performance must follow the evaluated transition and both concrete maintenance receipts.",
      );
    }
    await requireCompactEvaluatedLexicalIdentity(
      "The evaluated lexical identity drifted before compact performance.",
      null,
    );
    await stopRetrievalDiagnosticsImpl();
    requireCompactProxyMutationAdmission();
    const started = await startDiagnosticsSession(
      "evaluatedStandard",
      "Compact all-flags-on standard diagnostics session is active",
    );
    if (!started || !diagnosticsSessionIdentity) {
      return rollbackCompactStageAdmission(
        "evaluatedStandard",
        diagnosticsLastStartError
          || new Error("Compact evaluated-standard diagnostics could not be started."),
        { reason: "diagnostics_start_failed", restoreInitialFlags: true },
      );
    }
    requireCompactProxyMutationAdmission();
    await admitCompactStageOrRollback(
      "evaluatedStandard",
      () => {
        compactProxyCurrentStage = "evaluatedStandard";
        compactProxyStageCursors.evaluatedStandard = 0;
        refreshCompactProxyMetrics();
        return startCompactProxyResourceEnvelope("evaluatedStandard");
      },
      {
        restoreInitialFlags: true,
        setupFailureReason: "resource_envelope_setup_failed",
      },
    );
    return clone(result.compactProxy);
  };

  const beginCompactRetryTransition = async (...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      return invalidateCompactProxy("beginCompactRetry does not accept arguments.", "evaluatedStandard");
    }
    await compactProxyEvidenceOperationQueue;
    requireCompactProxyMutationAdmission();
    const evaluatedStandardBound = compactProxyCurrentStage === "evaluatedStandard"
      ? await compactStageIsFullyBound("evaluatedStandard") : false;
    requireCompactProxyMutationAdmission();
    if (!evaluatedStandardBound) {
      return invalidateCompactProxy(
        "The exact thirteen-episode evaluated standard stage must finish before retry.",
        "evaluatedStandard",
      );
    }
    await requireCompactEvaluatedLexicalIdentity(
      "The evaluated lexical identity drifted before compact retry.",
      "evaluatedStandard",
    );
    await stopCompactProxyResourceEnvelope();
    await stopRetrievalDiagnosticsImpl();
    requireCompactProxyMutationAdmission();
    const started = await startDiagnosticsSession(
      "evaluatedRetry",
      "Compact all-flags-on retry diagnostics session is active",
    );
    if (!started || !diagnosticsSessionIdentity) {
      return rollbackCompactStageAdmission(
        "evaluatedRetry",
        diagnosticsLastStartError
          || new Error("Compact evaluated-retry diagnostics could not be started."),
        { reason: "diagnostics_start_failed", restoreInitialFlags: true },
      );
    }
    requireCompactProxyMutationAdmission();
    await admitCompactStageOrRollback(
      "evaluatedRetry",
      () => {
        compactProxyCurrentStage = "evaluatedRetry";
        compactProxyStageCursors.evaluatedRetry = 0;
        refreshCompactProxyMetrics();
        return startCompactProxyResourceEnvelope("evaluatedRetry");
      },
      {
        restoreInitialFlags: true,
        setupFailureReason: "resource_envelope_setup_failed",
      },
    );
    return clone(result.compactProxy);
  };

  const stopCompactProxyTransition = async (...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      return invalidateCompactProxy("stopCompactProxy does not accept arguments.", "evaluatedRetry");
    }
    await compactProxyEvidenceOperationQueue;
    requireCompactProxyMutationAdmission();
    const evaluatedRetryBound = compactProxyCurrentStage === "evaluatedRetry"
      ? await compactStageIsFullyBound("evaluatedRetry") : false;
    requireCompactProxyMutationAdmission();
    if (!evaluatedRetryBound) {
      return invalidateCompactProxy(
        "The exact thirteen-episode evaluated retry stage must finish before stop.",
        "evaluatedRetry",
      );
    }
    await requireCompactEvaluatedLexicalIdentity(
      "The evaluated lexical identity drifted before stopping compact retry.",
      "evaluatedRetry",
    );
    try {
      await stopCompactProxyResourceEnvelope();
      await stopRetrievalDiagnosticsImpl();
      requireCompactProxyMutationAdmission();
      compactProxyCurrentStage = null;
      refreshCompactProxyMetrics();
      await writeResult();
      requireCompactProxyMutationAdmission();
      return clone(result.compactProxy);
    } catch (error) {
      if (compactProxyIsPermanentlyInvalid()) throw error;
      return rollbackCompactStageAdmission(
        "evaluatedRetry",
        error,
        { reason: "stop_transition_failed", restoreInitialFlags: true },
      );
    }
  };

  const beginCompactCancellationProbeTransition = async (...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    requireMeasurementSettingsStable();
    if (unexpectedArguments.length !== 0) {
      return invalidateCompactProxy(
        "beginCompactCancellationProbe does not accept arguments.",
        "cancellationProbe",
      );
    }
    await compactProxyEvidenceOperationQueue;
    requireCompactProxyMutationAdmission();
    const next = compactProxyWorkloadSequence[result.compactProxy.workloadBinding.boundEpisodeCount];
    if (compactProxyCurrentStage !== null || next?.stage !== "cancellationProbe") {
      return invalidateCompactProxy(
        "Compact cancellation must follow the stopped evaluated retry stage.",
        "cancellationProbe",
      );
    }
    await requireCompactEvaluatedLexicalIdentity(
      "The evaluated lexical identity drifted before compact cancellation.",
      "cancellationProbe",
    );
    const started = await startDiagnosticsSession(
      "cancellationProbe",
      "Compact isolated cancellation diagnostics session is active",
    );
    if (!started || !diagnosticsSessionIdentity) {
      return rollbackCompactStageAdmission(
        "cancellationProbe",
        diagnosticsLastStartError
          || new Error("Compact cancellation diagnostics could not be started."),
        { reason: "diagnostics_start_failed", restoreInitialFlags: true },
      );
    }
    requireCompactProxyMutationAdmission();
    await admitCompactStageOrRollback(
      "cancellationProbe",
      async () => {
        compactProxyCurrentStage = "cancellationProbe";
        compactProxyStageCursors.cancellationProbe = 0;
        const armed = await plugin.armRetrievalCancellationProbe(
          diagnosticsSessionIdentity.sessionId,
        );
        if (armed?.sessionId !== diagnosticsSessionIdentity.sessionId || armed?.armed !== true) {
          throw new Error("Compact same-worker cancellation probe could not be armed.");
        }
      },
      {
        restoreInitialFlags: true,
        setupFailureReason: "cancellation_probe_arm_failed",
      },
    );
    return clone(result.compactProxy);
  };

  const compactMaintenanceEntry = (kind) => (
    kind === "rebuild"
      ? result.compactProxy.maintenance.rebuild
      : result.compactProxy.maintenance.incrementalUpdate
  );

  const compactMaintenanceExpectedKind = () => {
    const maintenance = result.compactProxy.maintenance;
    if (maintenance.rebuild.status !== "PASS") return "rebuild";
    if (maintenance.incrementalUpdate.status !== "PASS") return "incremental-update";
    return null;
  };

  const currentCompactFixtureBundleSha256 = async () => {
    const entries = [];
    for (const path of [...sourceHashes.keys()].sort()) {
      entries.push([path, await readAndHash(path)]);
    }
    return digest(JSON.stringify(entries));
  };

  const emptyCompactMaintenanceEntry = (status, reason) => ({
    status,
    operation: null,
    operationBindingSha256: null,
    runtimeEnvelope: null,
    estimatedDbBytesBefore: null,
    estimatedDbBytesPeak: null,
    estimatedDbBytesAfter: null,
    readyMarker: null,
    recordedAt: null,
    reason,
  });

  const compactMaintenanceSnapshotKeys = [
    "databaseInstanceId", "profileId", "generation", "sourceChunkEpoch",
    "chunkMutationEpoch", "indexMutationEpoch", "rebuildEpoch",
    "lexicalMaintenanceEpoch", "incrementalMaintenanceEpoch",
    "sourceChunkRows", "lexicalRows", "totalLexicalRows",
  ];
  const compactMaintenanceContinuityKeys = [
    "databaseInstanceIdSha256", "profileIdSha256", "generation",
    "sourceChunkEpoch", "chunkMutationEpoch", "indexMutationEpoch",
    "rebuildEpoch", "lexicalMaintenanceEpoch", "incrementalMaintenanceEpoch",
    "totalLexicalRows",
  ];
  const compactMaintenanceEffectKeys = [
    "source", "pathCount", "sourceChunkReads", "sourceChunkWrites",
    "lexicalRowsDeleted", "lexicalRowsInserted", "markdownReads",
    "markdownWrites", "providerCalls", "embeddingCalls", "embeddingWrites",
  ];
  const compactMaintenanceResourceKeys = [
    "estimatedDbBytesBefore", "estimatedDbBytesPeak", "estimatedDbBytesAfter",
  ];

  const validateCompactMaintenanceRawSnapshot = (snapshot) => {
    const nonnegativeIntegerKeys = compactMaintenanceSnapshotKeys.filter((key) => ![
      "databaseInstanceId", "profileId", "sourceChunkEpoch",
    ].includes(key));
    return hasExactKeys(snapshot, compactMaintenanceSnapshotKeys)
      && typeof snapshot.databaseInstanceId === "string"
      && snapshot.databaseInstanceId.length > 0
      && snapshot.databaseInstanceId.length <= 256
      && snapshot.profileId === "char-phrase-v1"
      && typeof snapshot.sourceChunkEpoch === "string"
      && /^\d+$/u.test(snapshot.sourceChunkEpoch)
      && nonnegativeIntegerKeys.every((key) => (
        Number.isSafeInteger(snapshot[key]) && snapshot[key] >= 0
      ));
  };

  const validateCompactMaintenanceRawReceipt = (raw, expectedKind) => {
    const expectedOperationKind = expectedKind === "rebuild"
      ? "rebuild" : "indexed-chunks-incremental";
    const expectedIdPattern = expectedKind === "rebuild"
      ? /^lexreb-[a-f0-9]{32}$/u : /^lexinc-[a-f0-9]{32}$/u;
    if (!hasExactKeys(raw, [
      "kind", "status", "operationId", "scopeBindingSha256", "startedAt",
      "finishedAt", "durationMs", "state", "before", "after", "effects",
      "resourceEnvelope",
    ])
      || raw.kind !== expectedOperationKind
      || raw.status !== "completed"
      || raw.state !== "ready"
      || !expectedIdPattern.test(raw.operationId)
      || !isSha256(raw.scopeBindingSha256)
      || !isCanonicalIsoTimestamp(raw.startedAt)
      || !isCanonicalIsoTimestamp(raw.finishedAt)
      || Date.parse(raw.finishedAt) < Date.parse(raw.startedAt)
      || !Number.isFinite(raw.durationMs)
      || raw.durationMs < 0
      || !validateCompactMaintenanceRawSnapshot(raw.before)
      || !validateCompactMaintenanceRawSnapshot(raw.after)
      || !hasExactKeys(raw.effects, compactMaintenanceEffectKeys)
      || !hasExactKeys(raw.resourceEnvelope, compactMaintenanceResourceKeys)
      || raw.effects.source !== "indexed-chunks") return false;
    const resourceEnvelope = raw.resourceEnvelope;
    if (!compactMaintenanceResourceKeys.every((key) => (
      Number.isSafeInteger(resourceEnvelope[key]) && resourceEnvelope[key] >= 0
    ))
      || resourceEnvelope.estimatedDbBytesPeak < resourceEnvelope.estimatedDbBytesBefore
      || resourceEnvelope.estimatedDbBytesPeak < resourceEnvelope.estimatedDbBytesAfter) {
      return false;
    }
    const effectIntegerKeys = compactMaintenanceEffectKeys.filter((key) => key !== "source");
    if (!effectIntegerKeys.every((key) => (
      Number.isSafeInteger(raw.effects[key]) && raw.effects[key] >= 0
    ))
      || raw.effects.pathCount < 1
      || raw.effects.sourceChunkReads < 1
      || raw.effects.sourceChunkWrites !== 0
      || raw.effects.markdownReads !== 0
      || raw.effects.markdownWrites !== 0
      || raw.effects.providerCalls !== 0
      || raw.effects.embeddingCalls !== 0
      || raw.effects.embeddingWrites !== 0) return false;
    const before = raw.before;
    const after = raw.after;
    if (before.databaseInstanceId !== after.databaseInstanceId
      || before.profileId !== after.profileId
      || before.generation !== after.generation
      || before.sourceChunkEpoch !== after.sourceChunkEpoch
      || before.chunkMutationEpoch !== after.chunkMutationEpoch
      || before.rebuildEpoch !== after.rebuildEpoch
      || before.sourceChunkEpoch !== String(before.chunkMutationEpoch)
      || after.sourceChunkEpoch !== String(after.chunkMutationEpoch)) return false;
    if (expectedKind === "rebuild") {
      const indexDelta = after.indexMutationEpoch - before.indexMutationEpoch;
      const lexicalDelta = after.lexicalMaintenanceEpoch - before.lexicalMaintenanceEpoch;
      return before.incrementalMaintenanceEpoch === after.incrementalMaintenanceEpoch
        && before.sourceChunkRows === after.sourceChunkRows
        && after.sourceChunkRows > 0
        && after.sourceChunkRows === after.lexicalRows
        && after.lexicalRows === after.totalLexicalRows
        && indexDelta > 0
        && lexicalDelta === indexDelta
        && raw.effects.sourceChunkReads === after.sourceChunkRows
        && raw.effects.lexicalRowsDeleted === before.lexicalRows
        && raw.effects.lexicalRowsInserted === after.lexicalRows;
    }
    return raw.effects.pathCount === 1
      && before.sourceChunkRows > 0
      && before.sourceChunkRows === before.lexicalRows
      && before.sourceChunkRows === after.sourceChunkRows
      && before.lexicalRows === after.lexicalRows
      && before.totalLexicalRows === after.totalLexicalRows
      && after.indexMutationEpoch === before.indexMutationEpoch + 1
      && after.lexicalMaintenanceEpoch === before.lexicalMaintenanceEpoch + 1
      && after.incrementalMaintenanceEpoch === before.incrementalMaintenanceEpoch + 1
      && raw.effects.sourceChunkReads === before.sourceChunkRows
      && raw.effects.lexicalRowsDeleted === before.lexicalRows
      && raw.effects.lexicalRowsInserted === after.lexicalRows;
  };

  const compactMaintenanceScopeBindingSha256 = (operationId, paths) => digest([
    "b125-lexical-maintenance-v1",
    operationId,
    [...paths].sort().join("\u0000"),
  ].join("\u0000"));

  const projectCompactMaintenanceSnapshot = async (snapshot) => ({
    databaseInstanceIdSha256: await digest(snapshot.databaseInstanceId),
    profileIdSha256: await digest(snapshot.profileId),
    generation: snapshot.generation,
    sourceChunkEpoch: snapshot.sourceChunkEpoch,
    chunkMutationEpoch: snapshot.chunkMutationEpoch,
    indexMutationEpoch: snapshot.indexMutationEpoch,
    rebuildEpoch: snapshot.rebuildEpoch,
    lexicalMaintenanceEpoch: snapshot.lexicalMaintenanceEpoch,
    incrementalMaintenanceEpoch: snapshot.incrementalMaintenanceEpoch,
    sourceChunkRows: snapshot.sourceChunkRows,
    lexicalRows: snapshot.lexicalRows,
    totalLexicalRows: snapshot.totalLexicalRows,
  });

  const compactMaintenanceReadyMarker = async (raw) => {
    if (raw?.state !== "ready") return null;
    return {
      status: "ready",
      lexicalProfileState: "ready",
      lexicalProfileIdSha256: await digest(raw.after.profileId),
      lexicalGeneration: raw.after.generation,
    };
  };

  const compactEvaluatedLexicalGenerationIsReady = async (observedStats = null) => {
    const rebuild = result.compactProxy.maintenance.rebuild;
    const marker = rebuild.readyMarker;
    const operation = rebuild.operation;
    if (rebuild.status !== "PASS"
      || marker?.status !== "ready"
      || marker.lexicalProfileState !== "ready"
      || operation?.state !== "ready"
      || marker.lexicalGeneration !== operation.after?.generation
      || marker.lexicalProfileIdSha256 !== operation.after?.profileIdSha256) return false;
    try {
      const stats = observedStats ?? await Promise.resolve(
        plugin?.vss?.getStats?.({ mode: "foreground" }),
      );
      const snapshot = await Promise.resolve(
        plugin?.vss?.getMemoryStatusSnapshot?.(),
      );
      return snapshot?.status === "ready"
        && snapshot.lexicalProfileState === "ready"
        && stats?.status === "ready"
        && stats.lexicalProfileState === "ready"
        && stats.lexicalGeneration === marker.lexicalGeneration
        && await digest(stats.lexicalProfileId) === marker.lexicalProfileIdSha256
        && await digest(stats.databaseInstanceId)
          === operation.after.databaseInstanceIdSha256;
    } catch {
      return false;
    }
  };

  const requireCompactEvaluatedLexicalIdentity = async (message, stage = null) => {
    const identityReady = await compactEvaluatedLexicalGenerationIsReady();
    requireCompactProxyMutationAdmission();
    if (identityReady) return true;
    compactLexicalIdentityDriftDetected = true;
    return invalidateCompactProxy(message, stage);
  };

  const startCompactMaintenanceRuntimeEnvelope = (stage) => {
    if (typeof performance === "undefined"
      || typeof performance.now !== "function"
      || typeof setTimeout !== "function") return null;
    const state = {
      stage,
      startedAt: new Date().toISOString(),
      startedMonotonicMs: performance.now(),
      finishedAt: null,
      publicApiDurationMs: null,
      stopRequested: false,
      eventLoopStallMs: [],
      stallLoopPromise: null,
    };
    state.stallLoopPromise = (async () => {
      do {
        const expectedAt = performance.now() + RUNTIME_STALL_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, RUNTIME_STALL_INTERVAL_MS));
        state.eventLoopStallMs.push(Math.max(0, performance.now() - expectedAt));
      } while (!state.stopRequested);
    })();
    return state;
  };

  const stopCompactMaintenanceRuntimeEnvelope = async (state) => {
    if (!state) return null;
    state.finishedAt = new Date().toISOString();
    state.publicApiDurationMs = Math.max(0, performance.now() - state.startedMonotonicMs);
    state.stopRequested = true;
    await state.stallLoopPromise;
    if (!isCanonicalIsoTimestamp(state.startedAt)
      || !isCanonicalIsoTimestamp(state.finishedAt)
      || Date.parse(state.finishedAt) < Date.parse(state.startedAt)
      || !Number.isFinite(state.publicApiDurationMs)
      || state.eventLoopStallMs.length < 1
      || state.eventLoopStallMs.some((value) => !Number.isFinite(value) || value < 0)) {
      return null;
    }
    return {
      status: "PASS",
      stage: state.stage,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      publicApiDurationMs: state.publicApiDurationMs,
      eventLoopStallMs: {
        samples: [...state.eventLoopStallMs],
        maximum: Math.max(...state.eventLoopStallMs),
      },
    };
  };

  const blockCompactMaintenance = async (entry) => {
    requireCompactProxyMutationAdmission();
    Object.assign(entry, emptyCompactMaintenanceEntry(
      "BLOCKED", "maintenance_evidence_unavailable",
    ));
    result.compactProxy.maintenance.status = "BLOCKED";
    refreshCompactProxyMetrics();
    await writeResult();
    return clone(entry);
  };

  const invalidateCompactMaintenance = async (entry, message, primaryError = null) => {
    Object.assign(entry, emptyCompactMaintenanceEntry(
      "INVALID", "maintenance_invariant_failed",
    ));
    result.compactProxy.maintenance.status = "INVALID";
    if (!compactProxyPoison.latched) {
      markCompactProxyPoisoned(compactProxyCurrentStage, message);
      try {
        await refreshCompactProxyWorkloadBinding();
      } catch {
        // Keep the maintenance invariant as the first terminal reason.
      }
    }
    compactProxyPoison.reported = true;
    try {
      await cleanupInvalidCompactProxyState();
    } catch {
      // Cleanup cannot replace the maintenance invariant.
    }
    refreshCompactProxyMetrics();
    try {
      await writeResult();
    } catch {
      // Preserve the maintenance invariant as the primary terminal error.
    }
    compactProxyPoisonHandled = true;
    throw primaryError || new Error(message);
  };

  const recordCompactMaintenanceImpl = async (kind, ...unexpectedArguments) => {
    if (!IS_COMPACT_PROXY) throw new Error("Compact proxy profile is not active.");
    if (finalizing || finalized) {
      throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    }
    requireCompactProxyMutationAdmission();
    requireMeasurementSettingsStable();
    const knownKind = ["rebuild", "incremental-update"].includes(kind);
    const entry = knownKind ? compactMaintenanceEntry(kind) : result.compactProxy.maintenance.rebuild;
    const automaticRebuild = kind === "rebuild"
      && unexpectedArguments.length === 1
      && unexpectedArguments[0] === compactAutomaticRebuildToken;
    const publicIncrementalUpdate = kind === "incremental-update"
      && unexpectedArguments.length === 0;
    if (!knownKind || (!automaticRebuild && !publicIncrementalUpdate)) {
      return invalidateCompactMaintenance(
        entry,
        kind === "rebuild" && unexpectedArguments.length === 0
          ? "The compact lexical rebuild is automatic and cannot be replayed."
          : "recordCompactMaintenance accepts only incremental-update without arguments.",
      );
    }
    const automaticRebuildAdmission = automaticRebuild
      && compactProxyCurrentStage === "evaluatedPreparation"
      && diagnosticsSessionStage === null
      && !diagnosticsSessionIdentity;
    const incrementalAdmission = publicIncrementalUpdate
      && compactProxyCurrentStage === "compactCorrectness"
      && diagnosticsSessionStage === "compactCorrectness"
      && Boolean(diagnosticsSessionIdentity);
    if (kind !== compactMaintenanceExpectedKind()
      || (!automaticRebuildAdmission && !incrementalAdmission)
      || result.compactProxy.settingsTransition.status !== "PASS") {
      return invalidateCompactMaintenance(
        entry,
        "Compact maintenance is replayed, out of order, or outside its admitted stage.",
      );
    }
    const operationDefinition = kind === "rebuild"
      ? compactProxyPlanTemplate.maintenanceOperations.rebuild
      : compactProxyPlanTemplate.maintenanceOperations.incrementalUpdate;
    const operationMethod = kind === "rebuild"
      ? plugin?.vss?.rebuildLexicalIndexWithReceipt
      : plugin?.vss?.refreshLexicalPathFromIndexedChunks;
    if (typeof operationMethod !== "function") return blockCompactMaintenance(entry);
    const incrementalLexicalReady = kind === "incremental-update"
      ? await compactEvaluatedLexicalGenerationIsReady() : true;
    requireCompactProxyMutationAdmission();
    if (!incrementalLexicalReady) {
      compactLexicalIdentityDriftDetected = true;
      return invalidateCompactMaintenance(
        entry,
        "The evaluated lexical identity drifted before incremental maintenance.",
      );
    }
    requireCompactProxyMutationAdmission();
    const entryBeforeAdmission = clone(entry);
    const maintenanceStatusBeforeAdmission = result.compactProxy.maintenance.status;
    Object.assign(entry, emptyCompactMaintenanceEntry("ACTIVE", null));
    result.compactProxy.maintenance.status = "PENDING";
    try {
      await writeResult();
    } catch (error) {
      Object.assign(entry, entryBeforeAdmission);
      result.compactProxy.maintenance.status = maintenanceStatusBeforeAdmission;
      refreshCompactProxyMetrics();
      if (error && typeof error === "object") {
        error.compactMaintenanceAdmissionWriteFailure = true;
      }
      throw error;
    }
    requireCompactProxyMutationAdmission();
    let statsBefore;
    let maintenanceRuntimeState = null;
    let operationInvoked = false;
    try {
      const sourceBundleSha256Before = await currentCompactFixtureBundleSha256();
      const markdownMutationCountBefore = compactMarkdownMutationCount;
      await diagnosticsOperationQueue;
      statsBefore = await plugin.vss.getStats({ mode: "foreground" });
      requireCompactProxyMutationAdmission();
      if (sourceBundleSha256Before !== result.identity.fixtureBundleSha256
        || !Number.isFinite(statsBefore?.estimatedDbBytes)
        || statsBefore.estimatedDbBytes < 0) {
        return invalidateCompactMaintenance(
          entry,
          "Compact maintenance invariant failed before operation: source or DB identity drifted.",
        );
      }
      maintenanceRuntimeState = startCompactMaintenanceRuntimeEnvelope(kind);
      if (!maintenanceRuntimeState) return blockCompactMaintenance(entry);
      operationInvoked = true;
      const raw = kind === "rebuild"
        ? await operationMethod.call(plugin.vss, { silent: true })
        : await operationMethod.call(plugin.vss, operationDefinition.fixturePath);
      const runtimeEnvelope = await stopCompactMaintenanceRuntimeEnvelope(
        maintenanceRuntimeState,
      );
      maintenanceRuntimeState = null;
      const statsAfter = await plugin.vss.getStats({ mode: "foreground" });
      const memoryStatusAfter = await Promise.resolve(
        plugin.vss.getMemoryStatusSnapshot?.(),
      );
      const sourceBundleSha256After = await currentCompactFixtureBundleSha256();
      const expectedIncrementalScopeBinding = kind === "incremental-update"
        ? await compactMaintenanceScopeBindingSha256(
          raw?.operationId,
          [operationDefinition.fixturePath],
        )
        : null;
      const projectedBefore = raw?.before
        ? await projectCompactMaintenanceSnapshot(raw.before) : null;
      const projectedAfter = raw?.after
        ? await projectCompactMaintenanceSnapshot(raw.after) : null;
      requireCompactProxyMutationAdmission();
      if (!validateCompactMaintenanceRawReceipt(raw, kind)
        || !runtimeEnvelope
        || runtimeEnvelope.stage !== kind
        || Date.parse(runtimeEnvelope.startedAt) > Date.parse(raw.startedAt)
        || Date.parse(runtimeEnvelope.finishedAt) < Date.parse(raw.finishedAt)
        || runtimeEnvelope.publicApiDurationMs < raw.durationMs
        || compactMaintenanceOperationIds.has(raw.operationId)
        || (kind === "incremental-update"
          && raw.scopeBindingSha256 !== expectedIncrementalScopeBinding)
        || (kind === "incremental-update" && compactMaintenanceContinuityKeys.some((key) => (
          projectedBefore?.[key]
            !== result.compactProxy.maintenance.rebuild.operation?.after?.[key]
        )))
        || sourceBundleSha256After !== sourceBundleSha256Before
        || sourceBundleSha256After !== result.identity.fixtureBundleSha256
        || compactMarkdownMutationCount !== markdownMutationCountBefore
        || !Number.isFinite(statsAfter?.estimatedDbBytes)
        || statsAfter.estimatedDbBytes < 0
        || statsBefore.estimatedDbBytes !== raw.resourceEnvelope.estimatedDbBytesBefore
        || statsAfter.estimatedDbBytes !== raw.resourceEnvelope.estimatedDbBytesAfter
        || statsBefore.databaseInstanceId !== raw.before.databaseInstanceId
        || statsBefore.chunkMutationEpoch !== raw.before.chunkMutationEpoch
        || statsBefore.indexMutationEpoch !== raw.before.indexMutationEpoch
        || statsBefore.rebuildEpoch !== raw.before.rebuildEpoch
        || statsBefore.lexicalMaintenanceEpoch !== raw.before.lexicalMaintenanceEpoch
        || statsBefore.lexicalIncrementalMaintenanceEpoch
          !== raw.before.incrementalMaintenanceEpoch
        || (kind === "incremental-update" && (
          statsBefore.lexicalProfileId !== raw.before.profileId
          || statsBefore.lexicalGeneration !== raw.before.generation
        ))
        || statsAfter.databaseInstanceId !== raw.after.databaseInstanceId
        || memoryStatusAfter?.status !== "ready"
        || memoryStatusAfter.lexicalProfileState !== "ready"
        || statsAfter.status !== "ready"
        || statsAfter.lexicalProfileState !== "ready"
        || statsAfter.lexicalProfileId !== raw.after.profileId
        || statsAfter.lexicalGeneration !== raw.after.generation
        || statsAfter.chunkMutationEpoch !== raw.after.chunkMutationEpoch
        || statsAfter.indexMutationEpoch !== raw.after.indexMutationEpoch
        || statsAfter.rebuildEpoch !== raw.after.rebuildEpoch
        || statsAfter.lexicalMaintenanceEpoch !== raw.after.lexicalMaintenanceEpoch
        || statsAfter.lexicalIncrementalMaintenanceEpoch
          !== raw.after.incrementalMaintenanceEpoch
        || statsAfter.lastLexicalMaintenanceKind !== raw.kind
        || statsAfter.lastLexicalMaintenanceOperationId !== raw.operationId) {
        return invalidateCompactMaintenance(
          entry,
          "Compact maintenance operation receipt is invalid, replayed, or not bound to current state.",
        );
      }
      const operation = {
        schemaVersion: 1,
        sequence: operationDefinition.sequence,
        kind: raw.kind,
        status: raw.status,
        operationId: raw.operationId,
        scopeBindingSha256: raw.scopeBindingSha256,
        startedAt: raw.startedAt,
        finishedAt: raw.finishedAt,
        durationMs: raw.durationMs,
        state: raw.state,
        inputSource: raw.effects.source,
        before: projectedBefore,
        after: projectedAfter,
        effects: clone(raw.effects),
        resourceEnvelope: clone(raw.resourceEnvelope),
      };
      const readyMarker = await compactMaintenanceReadyMarker(raw);
      const operationBindingSha256 = await digest(canonicalJson(operation));
      requireCompactProxyMutationAdmission();
      compactMaintenanceOperationIds.add(raw.operationId);
      Object.assign(entry, {
        status: "PASS",
        operation,
        operationBindingSha256,
        runtimeEnvelope,
        estimatedDbBytesBefore: raw.resourceEnvelope.estimatedDbBytesBefore,
        estimatedDbBytesPeak: raw.resourceEnvelope.estimatedDbBytesPeak,
        estimatedDbBytesAfter: raw.resourceEnvelope.estimatedDbBytesAfter,
        readyMarker,
        recordedAt: new Date().toISOString(),
        reason: null,
      });
      result.compactProxy.maintenance.status =
        result.compactProxy.maintenance.rebuild.status === "PASS"
        && result.compactProxy.maintenance.incrementalUpdate.status === "PASS"
          ? "PASS" : "PENDING";
      refreshCompactProxyMetrics();
      await writeResult();
      return clone(entry);
    } catch (error) {
      let cleanupError = null;
      if (maintenanceRuntimeState) {
        try {
          await stopCompactMaintenanceRuntimeEnvelope(maintenanceRuntimeState);
        } catch (envelopeError) {
          cleanupError = envelopeError;
        } finally {
          maintenanceRuntimeState.stopRequested = true;
          await Promise.allSettled([maintenanceRuntimeState.stallLoopPromise]);
          maintenanceRuntimeState = null;
        }
      }
      if (compactProxyIsPermanentlyInvalid()) throw error;
      if (entry.status === "INVALID") throw error;
      if (!operationInvoked) return blockCompactMaintenance(entry);
      if (cleanupError && error && typeof error === "object"
        && error.cause === undefined) {
        error.cause = cleanupError;
      }
      return invalidateCompactMaintenance(
        entry,
        error?.message || "Compact maintenance operation failed after invocation.",
        error,
      );
    }
  };

  const enqueueCompactMaintenance = (operation) => {
    const queued = compactProxyMaintenanceOperationQueue.then(operation, operation);
    compactProxyMaintenanceOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const recordCompactMaintenance = (kind, ...unexpectedArguments) => enqueueCompactMaintenance(
    () => recordCompactMaintenanceImpl(kind, ...unexpectedArguments),
  );

  const enqueueCompactProxyTransition = (operation) => {
    const run = async () => {
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      requireCompactProxyMutationAdmission();
      return operation();
    };
    const queued = compactProxyTransitionOperationQueue.then(run, run);
    compactProxyTransitionOperationQueue = queued.catch(() => undefined);
    return queued;
  };

  const startCompactProxy = (...args) => enqueueCompactProxyTransition(
    () => startCompactProxyTransition(...args),
  );
  const beginCompactEvaluated = (...args) => enqueueCompactProxyTransition(
    () => beginCompactEvaluatedTransition(...args),
  );
  const beginCompactCorrectness = (...args) => enqueueCompactProxyTransition(
    () => beginCompactCorrectnessTransition(...args),
  );
  const beginCompactPerformance = (...args) => enqueueCompactProxyTransition(
    () => beginCompactPerformanceTransition(...args),
  );
  const beginCompactRetry = (...args) => enqueueCompactProxyTransition(
    () => beginCompactRetryTransition(...args),
  );
  const stopCompactProxy = (...args) => enqueueCompactProxyTransition(
    () => stopCompactProxyTransition(...args),
  );
  const beginCompactCancellationProbe = (...args) => enqueueCompactProxyTransition(
    () => beginCompactCancellationProbeTransition(...args),
  );

  const recoveryDiagnosticsSessionIsActive = () => (IS_COMPACT_PROXY
    ? result.compactProxy.settingsTransition.status === "PASS"
      && result.compactProxy.maintenance.rebuild.status === "PASS"
      && compactProxyCurrentStage === "compactCorrectness"
      && diagnosticsSessionStage === "compactCorrectness"
      && Boolean(diagnosticsSessionIdentity)
      && !runtimeEnvelopeState
    : !frozenDevicePlan && diagnosticsSessionStage === "preFreeze");

  const recoveryDiagnosticsSessionInstruction = () => (IS_COMPACT_PROXY
    ? "Record the Chat recovery canary as the first retrieval in the fresh all-flags-on compact correctness diagnostics session."
    : "Record the Chat recovery canary from the isolated pre-freeze diagnostics session.");

  const recordRecoveryCase = () => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
    } catch (error) {
      return Promise.reject(error);
    }
    if (result.recoveryCase.status !== "PENDING") {
      return Promise.reject(new Error("Chat recovery canary is already recorded; repeat it in a new smoke run."));
    }
    if (!recoveryDiagnosticsSessionIsActive()) {
      return Promise.reject(new Error(recoveryDiagnosticsSessionInstruction()));
    }
    return enqueueDiagnosticsOperation(async () => {
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      if (result.recoveryCase.status !== "PENDING") {
        throw new Error("Chat recovery canary is already recorded; repeat it in a new smoke run.");
      }
      if (!recoveryDiagnosticsSessionIsActive()) {
        throw new Error(recoveryDiagnosticsSessionInstruction());
      }

      const canonicalProjection = readLatestCanonicalMemoryProjection(RECOVERY_PROMPT);
      const finalPaths = canonicalProjection.finalPaths;

      const canonicalPaths = [];
      let invalidSourceCount = canonicalProjection.finalDocumentCount
        > RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        ? canonicalProjection.finalDocumentCount - RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        : 0;
      const duplicateSourceCount = canonicalProjection.duplicateDocumentCount;
      for (const rawPath of finalPaths.slice(
        0,
        RECOVERY_FINAL_SOURCE_CONTRACT.maximumSourceCount,
      )) {
        const canonicalPath = normalizeRankedPath(rawPath);
        if (!canonicalPath) {
          invalidSourceCount += 1;
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
        && projectionDocumentCount !== canonicalProjection.finalDocumentCount) {
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
      if (!captureValid) failures.push(IS_COMPACT_PROXY
        ? "compact correctness diagnostics unavailable or invalid"
        : "pre-freeze diagnostics unavailable or invalid");
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
      requireCompactProxyMutationAdmission();
      const previousRankingEvidenceCursor = rankingEvidenceCursor;
      const previousRecoveryCase = clone(result.recoveryCase);
      const previousManualCase = manualCases["chat-recovery"]
        ? clone(manualCases["chat-recovery"]) : null;
      rankingEvidenceCursor = captureValid
        ? projection.events.at(-1)?.sequence ?? rankingEvidenceCursor
        : rankingEvidenceCursor;
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
      await commitEvidenceMutation({
        rollback: () => {
          rankingEvidenceCursor = previousRankingEvidenceCursor;
          result.recoveryCase = previousRecoveryCase;
          if (previousManualCase) manualCases["chat-recovery"] = previousManualCase;
          else delete manualCases["chat-recovery"];
          result.manualCases = manualCases;
        },
      });
      console.log(`[retrieval-smoke:${status}] Chat recovery canary recorded`);
      return clone(result.recoveryCase);
    });
  };

  const recordTemporalRetryCase = (...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireCompactProxyMutationAdmission();
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
    if ((!IS_COMPACT_PROXY && result.recoveryCase.status === "PENDING")
      || (IS_COMPACT_PROXY && result.recoveryCase.status !== "PASS")) {
      return Promise.reject(new Error(
        "Record the isolated Chat recovery canary before the temporal retry canary.",
      ));
    }
    const expectedCorrectnessStage = IS_COMPACT_PROXY
      ? "compactCorrectness"
      : frozenDevicePlan ? "standardPerformance" : "preFreeze";
    if ((IS_COMPACT_PROXY && result.compactProxy.settingsTransition.status !== "PASS")
      || runtimeEnvelopeState
      || diagnosticsSessionStage !== expectedCorrectnessStage
      || !diagnosticsSessionIdentity) {
      return Promise.reject(new Error(
        IS_COMPACT_PROXY
          ? "Record the temporal retry canary in the active compact qualitative diagnostics session."
          : "Record the temporal retry canary in the active correctness diagnostics session.",
      ));
    }

    return enqueueDiagnosticsOperation(async () => {
      requireCompactProxyMutationAdmission();
      requireMeasurementSettingsStable();
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      if (result.temporalRetryCase.status !== "PENDING") {
        throw new Error("Temporal retry canary is already recorded; repeat it in a new smoke run.");
      }
      if ((!IS_COMPACT_PROXY && result.recoveryCase.status === "PENDING")
        || (IS_COMPACT_PROXY && result.recoveryCase.status !== "PASS")) {
        throw new Error("Record the isolated Chat recovery canary before the temporal retry canary.");
      }
      if ((IS_COMPACT_PROXY && result.compactProxy.settingsTransition.status !== "PASS")
        || runtimeEnvelopeState
        || diagnosticsSessionStage !== expectedCorrectnessStage
        || !diagnosticsSessionIdentity) {
        throw new Error(IS_COMPACT_PROXY
          ? "Record the temporal retry canary in active compact qualitative diagnostics."
          : "Record the temporal retry canary in active correctness diagnostics.");
      }

      const canonicalProjection = readLatestCanonicalMemoryProjection(TEMPORAL_RETRY_PROMPT);
      const finalPaths = canonicalProjection.finalPaths;
      const canonicalPaths = [];
      let invalidSourceCount = canonicalProjection.finalDocumentCount
        > TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        ? canonicalProjection.finalDocumentCount
          - TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount
        : 0;
      const duplicateSourceCount = canonicalProjection.duplicateDocumentCount;
      for (const rawPath of finalPaths.slice(
        0,
        TEMPORAL_RETRY_FINAL_SOURCE_CONTRACT.maximumSourceCount,
      )) {
        const canonicalPath = normalizeRankedPath(rawPath);
        if (!canonicalPath) {
          invalidSourceCount += 1;
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
        && projectionDocumentCount !== canonicalProjection.finalDocumentCount) {
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
      if (!captureValid) failures.push("correctness diagnostics unavailable or invalid");
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
          failures.push("standard attempt did not prove the structured temporal filter was applied");
        }
        if (standardTemporalViolationCount !== 0) {
          failures.push("standard attempt contains an out-of-range temporal violation");
        }
        if (relaxedTemporalFilterApplied !== 1) {
          failures.push("relaxed attempt did not prove the structured temporal filter was applied");
        }
        if (relaxedTemporalViolationCount !== 0) {
          failures.push("relaxed attempt contains an out-of-range temporal violation");
        }
        if (projectionTemporalFilterApplied !== 1) {
          failures.push("cumulative projection did not prove the structured temporal filter was applied");
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
      requireCompactProxyMutationAdmission();
      const previousRankingEvidenceCursor = rankingEvidenceCursor;
      const previousTemporalRetryCase = clone(result.temporalRetryCase);
      const previousManualCase = manualCases["temporal-retry"]
        ? clone(manualCases["temporal-retry"]) : null;
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
        ...(IS_COMPACT_PROXY ? {
          compactProxyPlanSha256: result.compactProxy.planSha256,
        } : {
          correctnessProfile: STRICT_PROFILE,
        }),
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
      await commitEvidenceMutation({
        rollback: () => {
          rankingEvidenceCursor = previousRankingEvidenceCursor;
          result.temporalRetryCase = previousTemporalRetryCase;
          if (previousManualCase) manualCases["temporal-retry"] = previousManualCase;
          else delete manualCases["temporal-retry"];
          result.manualCases = manualCases;
        },
      });
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

  const validPageletRuntimeCompletion = (value) => {
    if (value === null) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const expectedKeys = [
      "citationCoverage",
      "diagnosticTypes",
      "emptyFinalAnswerRetryCount",
      "endReason",
      "finalTextState",
      "insightDraftCount",
      "lastTurnStatus",
      "loopStatus",
      "providerStopReason",
      "toolCallCount",
      "turnCount",
    ];
    const actualKeys = Object.keys(value).sort();
    const diagnosticTypes = value.diagnosticTypes;
    const safeCode = (candidate) => candidate === null
      || (typeof candidate === "string" && /^[a-z0-9_-]{1,96}$/u.test(candidate));
    return actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index])
      && ["completed", "completed_with_warning", "incomplete", "aborted", "error"]
        .includes(value.loopStatus)
      && safeCode(value.endReason)
      && Array.isArray(diagnosticTypes)
      && diagnosticTypes.every((type) => safeCode(type) && type !== null)
      && new Set(diagnosticTypes).size === diagnosticTypes.length
      && diagnosticTypes.join("\u0000")
        === [...diagnosticTypes].sort().join("\u0000")
      && (value.lastTurnStatus === null || [
        "completed",
        "tool_results_ready",
        "completed_with_warning",
        "incomplete",
        "aborted",
        "error",
      ].includes(value.lastTurnStatus))
      && safeCode(value.providerStopReason)
      && ["empty", "no-insight", "candidate"].includes(value.finalTextState)
      && [
        "not-applicable",
        "complete",
        "ungrounded",
        "missing-anchor",
        "missing-non-anchor",
      ].includes(value.citationCoverage)
      && Number.isSafeInteger(value.turnCount)
      && value.turnCount >= 0
      && Number.isSafeInteger(value.toolCallCount)
      && value.toolCallCount >= 0
      && Number.isSafeInteger(value.insightDraftCount)
      && value.insightDraftCount >= 0
      && (value.emptyFinalAnswerRetryCount === 0
        || value.emptyFinalAnswerRetryCount === 1);
  };

  const hasExactPageletSnapshotKeys = (value) => {
    const expectedKeys = [
      "cacheEntryCountAfter",
      "cacheEntryCountBefore",
      "cacheMutationCount",
      "candidateCount",
      "collectionId",
      "controllerSequence",
      "deliveryReceiptCount",
      "entryPath",
      "force",
      "insights",
      "quietWriteInvariantSatisfied",
      "reason",
      "resultId",
      "resultStatus",
      "runId",
      "runtimeCompletion",
      "schemaVersion",
      "sequence",
      "triggerReason",
    ];
    const actualKeys = Object.keys(value).sort();
    return actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index]);
  };

  const recordPageletCase = (id, ...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireCompactProxyMutationAdmission();
    } catch (error) {
      return Promise.reject(error);
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
      requireCompactProxyMutationAdmission();
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
      if (!hasExactPageletSnapshotKeys(snapshot)
        || snapshot.schemaVersion !== 2
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
        || !validPageletRuntimeCompletion(snapshot.runtimeCompletion)
        || (["quiet", "verified"].includes(snapshot.resultStatus)
          && snapshot.runtimeCompletion === null)
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
        runtimeCompletion: snapshot.runtimeCompletion,
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
      requireCompactProxyMutationAdmission();
      const previousPageletEvidenceCursor = pageletEvidenceCursor;
      const previousPageletCase = clone(pageletCases[id]);
      const previousManualCase = manualCases[id] ? clone(manualCases[id]) : null;
      const runIdPreviouslyBound = pageletEvidenceRunIds.has(runId);
      const resultIdPreviouslyBound = pageletEvidenceResultIds.has(resultId);
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
      await commitEvidenceMutation({
        rollback: () => {
          pageletEvidenceCursor = previousPageletEvidenceCursor;
          if (!runIdPreviouslyBound) pageletEvidenceRunIds.delete(runId);
          if (!resultIdPreviouslyBound) pageletEvidenceResultIds.delete(resultId);
          pageletCases[id] = previousPageletCase;
          result.pageletCases = pageletCases;
          if (previousManualCase) manualCases[id] = previousManualCase;
          else delete manualCases[id];
          result.manualCases = manualCases;
        },
      });
      console.log(`[retrieval-smoke:${status}] Pagelet case ${id} recorded`);
      return clone(pageletCases[id]);
    });
  };

  const recordCase = async (id, status, detail = "") => {
    if (finalizing || finalized) {
      throw new Error("Retrieval smoke result is finalized and cannot be modified.");
    }
    requireCompactProxyMutationAdmission();
    requireMeasurementSettingsStable();
    if (!REQUIRED_CASES.includes(id)) throw new Error(`Unknown retrieval smoke case: ${id}`);
    if (id === "chat-recovery") {
      throw new Error(IS_COMPACT_PROXY
        ? "Chat recovery must be recorded with recordRecoveryCase from active compact correctness diagnostics."
        : "Chat recovery must be recorded with recordRecoveryCase from pre-freeze diagnostics.");
    }
    if (id === "temporal-retry") {
      throw new Error(
        "Temporal retry must be recorded with recordTemporalRetryCase from active correctness diagnostics.",
      );
    }
    if (REQUIRED_PAGELET_CASES.includes(id)) {
      throw new Error("Pagelet 0/1/2 cases must be recorded with recordPageletCase.");
    }
    if (!["PASS", "FAIL", "BLOCKED"].includes(status)) {
      throw new Error("Case status must be PASS, FAIL, or BLOCKED.");
    }
    const previousManualCase = manualCases[id] ? clone(manualCases[id]) : null;
    manualCases[id] = {
      id,
      status,
      detail: sanitize(detail),
      recordedAt: new Date().toISOString(),
    };
    result.manualCases = manualCases;
    await commitEvidenceMutation({
      rollback: () => {
        if (previousManualCase) manualCases[id] = previousManualCase;
        else delete manualCases[id];
        result.manualCases = manualCases;
      },
    });
    console.log(`[retrieval-smoke:${status}] manual case ${id} recorded`);
    return { ...manualCases[id] };
  };

  const recordRankingCase = (id, ...unexpectedArguments) => {
    if (finalizing || finalized) {
      return Promise.reject(new Error("Retrieval smoke result is finalized and cannot be modified."));
    }
    try {
      requireCompactProxyMutationAdmission();
    } catch (error) {
      return Promise.reject(error);
    }
    const definition = RANKING_CASES[id];
    if (!definition) return Promise.reject(new Error(`Unknown retrieval ranking case: ${id}`));
    if (unexpectedArguments.length !== 0) {
      return Promise.reject(new Error(
        "recordRankingCase does not accept source paths; leave the case PENDING and bind the exact live Chat turn.",
      ));
    }
    if (IS_COMPACT_PROXY && result.recoveryCase.status !== "PASS") {
      return Promise.reject(new Error(
        "Record the isolated Chat recovery canary before compact ranking evidence.",
      ));
    }
    const expectedCorrectnessStage = IS_COMPACT_PROXY
      ? "compactCorrectness"
      : frozenDevicePlan ? "standardPerformance" : "preFreeze";
    if (runtimeEnvelopeState
      || (diagnosticsSessionStage && diagnosticsSessionStage !== expectedCorrectnessStage)) {
      return Promise.reject(new Error("Record ranking evidence before starting device performance diagnostics."));
    }
    if (diagnosticsSessionStage !== expectedCorrectnessStage || !diagnosticsSessionIdentity) {
      return Promise.reject(new Error(
        IS_COMPACT_PROXY
          ? "Record ranking evidence only in the active compact qualitative diagnostics session."
          : "Record ranking evidence only in the active correctness diagnostics session.",
      ));
    }
    if (rankingCases[id].status !== "PENDING") {
      return Promise.reject(new Error(
        "Retrieval ranking case is already recorded; repeat it in a new smoke run.",
      ));
    }
    if (!measurementSettingsAreStable()) {
      return Promise.reject(new Error(
        "Retrieval, Data Boundary, provider, selected reranker, or Pagelet execution settings changed during this smoke run.",
      ));
    }

    return enqueueDiagnosticsOperation(async () => {
      requireCompactProxyMutationAdmission();
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      if ((IS_COMPACT_PROXY && result.compactProxy.settingsTransition.status !== "PASS")
        || runtimeEnvelopeState
        || diagnosticsSessionStage !== expectedCorrectnessStage
        || !diagnosticsSessionIdentity) {
        throw new Error(IS_COMPACT_PROXY
          ? "The compact qualitative diagnostics session is no longer active."
          : "The correctness diagnostics session is no longer active.");
      }
      if (IS_COMPACT_PROXY && result.recoveryCase.status !== "PASS") {
        throw new Error("Record the isolated Chat recovery canary before compact ranking evidence.");
      }
      if (rankingCases[id].status !== "PENDING") {
        throw new Error("Retrieval ranking case is already recorded; repeat it in a new smoke run.");
      }
      if (!measurementSettingsAreStable()) {
        throw new Error("Retrieval, Data Boundary, provider, selected reranker, or Pagelet execution settings changed during this smoke run.");
      }

      let projection;
      try {
        projection = projectBoundRetrievalDiagnostics(
          await plugin.getRetrievalDiagnostics(diagnosticsSessionIdentity.sessionId),
          diagnosticsSessionIdentity,
        );
      } catch {
        throw new Error("Ranking correctness diagnostics could not be captured.");
      }
      if (projection.droppedEventCount !== 0) {
        throw new Error("Ranking correctness diagnostics are incomplete because events were dropped.");
      }
      const newEvents = projection.events.filter((event) => event.sequence > rankingEvidenceCursor);
      const partition = partitionMeasurementEpisodes(newEvents);
      const episode = partition.episodes.length === 1 ? partition.episodes[0] : null;
      const relaxedRetryCount = episode?.relaxedStartedCount ?? 0;
      const relaxedRetryStarted = episode?.events.find((event) => (
        event.phase === "recovery_relaxed" && event.outcome === "started"
      ));
      const relaxedRetryTerminal = episode?.relaxedTerminals[0] ?? null;
      const relaxedAttemptTerminal = episode?.relaxedAttempts[0]?.terminal ?? null;
      const projectionTerminal = episode?.projectionTerminals[0] ?? null;
      const standardMemoryDocumentCounts = (episode?.standardAttempts ?? []).map((attempt) => (
        observedDocumentCount(attempt.terminal)
      ));
      const standardDocumentCounts = (episode?.standardTerminals ?? []).map((terminal) => (
        observedDocumentCount(terminal)
      ));
      const standardCountPairsValid = standardMemoryDocumentCounts.length
        === episode?.standardCallCount
        && standardDocumentCounts.length === episode?.standardCallCount
        && standardMemoryDocumentCounts.every((count, index) => (
          Number.isSafeInteger(count) && count === standardDocumentCounts[index]
        ));
      const relaxedMemoryDocumentCount = observedDocumentCount(relaxedAttemptTerminal);
      const relaxedDocumentCount = observedDocumentCount(relaxedRetryTerminal);
      const projectionDocumentCount = observedDocumentCount(projectionTerminal);
      const relaxedAfterStandardCallIndex = relaxedRetryCount === 1
        ? episode?.relaxedAfterStandardCallIndex ?? null
        : null;
      const visibleMemoryResultDocumentCounts = standardMemoryDocumentCounts.map(
        (count, index) => (
          relaxedRetryCount === 1 && index === relaxedAfterStandardCallIndex
            ? projectionDocumentCount
            : count
        ),
      );
      const visibleMemoryResultCountsValid = visibleMemoryResultDocumentCounts.length
        === episode?.standardCallCount
        && visibleMemoryResultDocumentCounts.every(Number.isSafeInteger);
      const retryConsumed = relaxedRetryStarted?.metrics?.retryConsumed === 1
        && relaxedRetryTerminal?.metrics?.retryConsumed === 1;
      const relaxedRetryTopologyValid = relaxedRetryCount === 0
        ? episode?.relaxedAttempts.length === 0
          && episode?.relaxedTerminals.length === 0
          && episode?.projectionStartedCount === 0
          && episode?.projectionTerminals.length === 0
        : relaxedRetryCount === 1
          && [1, 2].includes(episode?.standardCallCount)
          && Number.isSafeInteger(relaxedAfterStandardCallIndex)
          && relaxedAfterStandardCallIndex >= 0
          && relaxedAfterStandardCallIndex < episode.standardCallCount
          && episode?.relaxedAttempts.length === 1
          && episode?.relaxedTerminals.length === 1
          && relaxedAttemptTerminal?.outcome === "completed"
          && relaxedRetryTerminal?.outcome === "completed"
          && Number.isSafeInteger(relaxedMemoryDocumentCount)
          && relaxedMemoryDocumentCount === relaxedDocumentCount
          && retryConsumed
          && episode?.projectionStartedCount === 1
          && episode?.projectionTerminals.length === 1
          && projectionTerminal?.outcome === "completed"
          && Number.isSafeInteger(projectionDocumentCount)
          && projectionDocumentCount > 0
          && projectionDocumentCount
            <= standardMemoryDocumentCounts[relaxedAfterStandardCallIndex]
              + relaxedMemoryDocumentCount;
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
        || !standardCountPairsValid
        || !visibleMemoryResultCountsValid
        || episode.hasCancellationEvidence
        || !relaxedRetryTopologyValid
        || episode.attempts.some((attempt) => attempt.terminal?.outcome !== "completed")) {
        throw new Error(
          "Record each ranking case immediately after one complete correctness search_memory episode with at most one valid hidden relaxed retry.",
        );
      }

      const canonicalProjection = readLatestCanonicalMemoryProjection(definition.prompt, {
        expectedSuccessfulSearchMemoryToolResultCount: episode.standardCallCount,
      });
      const canonicalVisibleCountsMatch = canonicalProjection.visibleMemoryResultDocumentCounts.length
        === visibleMemoryResultDocumentCounts.length
        && canonicalProjection.visibleMemoryResultDocumentCounts.every((count, index) => (
          count === visibleMemoryResultDocumentCounts[index]
        ));
      const totalVisibleDocumentCount = visibleMemoryResultDocumentCounts.reduce((sum, count) => (
        sum + count
      ), 0);
      const finalDocumentCountMatchesTopology = canonicalVisibleCountsMatch
        && canonicalProjection.finalDocumentCount <= totalVisibleDocumentCount
        && (episode.standardCallCount !== 1
          || canonicalProjection.finalDocumentCount === visibleMemoryResultDocumentCounts[0]);
      if (!finalDocumentCountMatchesTopology) {
        throw new Error(
          "The ranking retrieval document count disagrees with canonical final Memory documents; leave the case PENDING.",
        );
      }
      const sourceBinding = await bindCanonicalRunToEpisode(canonicalProjection, episode);
      if (sourceBinding.successfulSearchMemoryToolResultCount !== episode.standardCallCount) {
        throw new Error(
          "The canonical visible search_memory result count disagrees with diagnostics; leave the case PENDING.",
        );
      }
      const rankedPaths = canonicalProjection.finalPaths;
      const canonicalPaths = [];
      let invalidSourceCount = canonicalProjection.finalDocumentCount > 8
        ? canonicalProjection.finalDocumentCount - 8
        : 0;
      invalidSourceCount += canonicalProjection.duplicateDocumentCount;
      for (const rawPath of rankedPaths.slice(0, 8)) {
        const canonicalPath = normalizeRankedPath(rawPath);
        if (!canonicalPath) {
          invalidSourceCount += 1;
          continue;
        }
        canonicalPaths.push(canonicalPath);
      }
      const relevantIndex = canonicalPaths.indexOf(definition.relevantPath);
      const forbiddenHitCount = canonicalPaths.filter((path) => (
        definition.forbiddenPaths.includes(path)
        || isOpaqueOrExcludedPath(path)
      )).length;
      const relevantRank = relevantIndex >= 0 ? relevantIndex + 1 : null;
      const status = relevantRank !== null
        && invalidSourceCount === 0
        && forbiddenHitCount === 0 ? "PASS" : "FAIL";
      const evidenceEvents = episode.events;
      const rankingTopology = {
        droppedEventCount: projection.droppedEventCount,
        episodeCount: partition.episodes.length,
        unscopedEventCount: partition.unscopedEvents.length,
        surfaceMismatchEventCount: partition.surfaceMismatchEvents.length,
        episodeComplete: episode.complete,
        hasCancellationEvidence: episode.hasCancellationEvidence,
        invocationOrdinalBindingValid: episode.invocationOrdinalBindingValid,
        standardInvocationOrdinals: [...episode.standardInvocationOrdinals],
        standardMemoryOutcomes: episode.standardAttempts.map((attempt) => (
          attempt.terminal?.outcome ?? null
        )),
        standardMemoryReasons: episode.standardAttempts.map((attempt) => (
          attempt.terminal?.reason ?? null
        )),
        standardMemoryDocumentCounts,
        standardOutcomes: episode.standardTerminals.map((event) => event.outcome),
        standardReasons: episode.standardTerminals.map((event) => event.reason ?? null),
        standardDocumentCounts,
        relaxedMemoryOutcome: relaxedAttemptTerminal?.outcome ?? null,
        relaxedMemoryReason: relaxedAttemptTerminal?.reason ?? null,
        relaxedMemoryDocumentCount,
        relaxedAfterStandardCallIndex,
        relaxedTerminalCount: episode.relaxedTerminals.length,
        relaxedOutcome: relaxedRetryTerminal?.outcome ?? null,
        relaxedReason: relaxedRetryTerminal?.reason ?? null,
        relaxedDocumentCount,
        retryConsumed,
        projectionStartedCount: episode.projectionStartedCount,
        projectionCompletedCount: episode.projectionTerminals.filter((event) => (
          event.outcome === "completed"
        )).length,
        projectionOutcome: projectionTerminal?.outcome ?? null,
        projectionReason: projectionTerminal?.reason ?? null,
        projectionDocumentCount,
        visibleMemoryResultDocumentCounts,
      };
      const evidence = {
        ...(IS_COMPACT_PROXY
          ? { compactProxyPlanSha256: result.compactProxy.planSha256 }
          : { correctnessProfile: STRICT_PROFILE }),
        startSequence: evidenceEvents[0]?.sequence ?? null,
        endSequence: evidenceEvents.at(-1)?.sequence ?? null,
        finalDocumentCount: canonicalProjection.finalDocumentCount,
        standardCallCount: episode.standardCallCount,
        relaxedRetryCount,
        memoryAttemptCount: episode.attempts.length,
        topology: rankingTopology,
        sourceBinding,
        evidenceSha256: await digest(JSON.stringify({
          finalPaths: canonicalPaths,
          finalDocumentCount: canonicalProjection.finalDocumentCount,
          relaxedRetryCount,
          topology: rankingTopology,
          sourceBinding,
          diagnostics: evidenceEvents,
        })),
      };
      requireCompactProxyMutationAdmission();
      const previousRankingEvidenceCursor = rankingEvidenceCursor;
      const previousRankingCase = clone(rankingCases[id]);
      const previousRerankerMetrics = clone(result.rerankerMetrics);
      const previousRerankerGate = clone(result.deviceMeasurement.rerankerGate);
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
        invalidSourceCount,
        forbiddenHitCount,
        evidence,
        recordedAt: new Date().toISOString(),
      };
      result.rankingCases = rankingCases;
      updateRerankerMetrics();
      evaluateRerankerGate();
      await commitEvidenceMutation({
        rollback: () => {
          rankingEvidenceCursor = previousRankingEvidenceCursor;
          rankingCases[id] = previousRankingCase;
          result.rankingCases = rankingCases;
          result.rerankerMetrics = previousRerankerMetrics;
          result.deviceMeasurement.rerankerGate = previousRerankerGate;
        },
      });
      console.log(`[retrieval-smoke:${status}] ranking case ${id} recorded`);
      return clone(rankingCases[id]);
    });
  };

  const evaluateCompactProxyStatus = ({ fixturesStable, settingsStable }) => {
    const compact = result.compactProxy;
    refreshCompactProxyMetrics();
    compact.hardBudgets.status = compact.hardBudgets.violations.length > 0
      ? "FAIL"
      : compact.workloadBinding.status === "PASS" ? "PASS" : "PENDING";
    const metricsComplete = Object.keys(COMPACT_STAGE_COUNTS).every((stage) => (
      compact.metrics[stage]?.status === "PASS"
    )) && compact.metrics.requiredResourceEnvelope?.status === "PASS";
    const hasBlockingPreflight = checks.some((entry) => (
      entry.status === "BLOCKED" && entry.blocking !== false
    ));
    const invalid = compactProxyPoison.latched
      || compactProxyPoison.epoch > 0
      || compact.status === "INVALID"
      || compact.workloadBinding.violationCount > 0
      || compact.workloadBinding.status === "INVALID"
      || compact.settingsTransition.status === "INVALID"
      || compact.maintenance.status === "INVALID"
      || compact.maintenance.sourceMutationGuard.status === "FAIL"
      || compact.hardBudgets.status === "FAIL"
      || compact.metrics.requiredResourceEnvelope?.status === "INVALID"
      || compactLexicalIdentityDriftDetected
      || !fixturesStable
      || !settingsStable
      || settingsChangedDuringRun
      || identityDriftDetected
      || pluginLifecycleDriftDetected
      || checks.some((entry) => entry.status === "FAIL");
    const complete = compact.workloadBinding.status === "PASS"
      && compact.deviceBinding.status === "BOUND"
      && compact.settingsTransition.status === "PASS"
      && compact.settingsTransition.transitionCount === 1
      && compact.settingsTransition.cleanup.status === "PASS"
      && compact.maintenance.status === "PASS"
      && compact.maintenance.sourceMutationGuard.status === "PASS"
      && compact.hardBudgets.status === "PASS"
      && metricsComplete
      && compact.planSha256 === result.identity.compactProxyPlanSha256
      && !hasBlockingPreflight;
    compact.machineStatus = "CANDIDATE";
    compact.ownerDisposition = {
      status: "PENDING",
      reason: null,
      trackerRecorded: false,
    };
    compact.status = invalid ? "INVALID" : complete ? "READY_FOR_OWNER_REVIEW" : "BLOCKED";
    record(
      "Compact proxy evidence is complete for owner review",
      compact.status === "READY_FOR_OWNER_REVIEW"
        ? "PASS" : compact.status === "INVALID" ? "FAIL" : "BLOCKED",
      compact.status === "READY_FOR_OWNER_REVIEW"
        ? "machine evidence remains CANDIDATE until owner disposition"
        : `${compact.workloadBinding.boundEpisodeCount}/${compact.workloadBinding.expectedEpisodeCount} episode binding(s)`,
    );
  };

  const updateOverallStatus = () => {
    if (IS_COMPACT_PROXY) {
      const hasFailure = result.compactProxy.status === "INVALID"
        || checks.some((entry) => entry.status === "FAIL")
        || result.temporalRetryCase.status === "FAIL"
        || Object.values(rankingCases).some((entry) => entry.status === "FAIL");
      result.overall = hasFailure ? "FAIL" : "BLOCKED";
      return;
    }
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
      // Public compact mutations share one outer queue. Drain it before the
      // inner domain queues so an operation cannot commit between the domain
      // drains and the final evidence cutoff.
      await compactProxyPublicMutationQueue;
      // Drain an in-flight transition before inspecting/stopping its envelope.
      // Operations queued before finalization but not yet started reject at the
      // queue boundary, so none can mutate the receipt after the final cutoff.
      await performanceTransitionOperationQueue;
      await performanceEvidenceOperationQueue;
      await compactProxyTransitionOperationQueue;
      await compactProxyEvidenceOperationQueue;
      await compactProxyMaintenanceOperationQueue;
      let finalizationCleanupError = null;
      const preserveFinalizationCleanupError = (error) => {
        finalizationCleanupError ??= error;
      };
      try {
        if (runtimeEnvelopeState) await stopRuntimeEnvelopeImpl();
      } catch (error) {
        preserveFinalizationCleanupError(error);
      }
      try {
        if (compactProxyResourceState) await stopCompactProxyResourceEnvelope();
      } catch (error) {
        preserveFinalizationCleanupError(error);
      }
      try {
        await pageletEvidenceOperationQueue;
      } catch (error) {
        preserveFinalizationCleanupError(error);
      }
      try {
        await enqueueDiagnosticsOperation(stopRetrievalDiagnosticsImpl);
      } catch (error) {
        preserveFinalizationCleanupError(error);
      }
      try {
        if (ownedDiagnosticsSessions.size > 0) {
          const orphanFailures = await discardOwnedDiagnosticsSessions({ attempts: 2 });
          if (orphanFailures.length > 0) {
            markDiagnosticsBlocked(
              "orphan diagnostics session cleanup failed",
              "Every diagnostics session started by this runner is stopped",
            );
          } else {
            diagnosticsSessionIdentity = null;
            diagnosticsSessionStage = null;
            stoppedDiagnosticsProjection = null;
            diagnosticsStopAttempted = false;
          }
        }
      } catch (error) {
        preserveFinalizationCleanupError(error);
      }
      if (finalizationCleanupError) throw finalizationCleanupError;
      await externalMemoryEvidenceOperationQueue;
      await verifyRuntimeAndArtifactIdentityAtFinalize();

      let fixturesStable = true;
      for (const path of [...ALLOWED_FIXTURES, ...OPAQUE_FIXTURES]) {
        const currentHash = await readAndHash(path);
        if (sourceHashes.get(path) !== currentHash) fixturesStable = false;
      }
      assert("Fixture Markdown is unchanged by the smoke", fixturesStable);

      const settingsStable = measurementSettingsAreStable();
      assert(
        IS_COMPACT_PROXY
          ? "Retrieval and Boundary settings match the one controlled compact phase transition"
          : "Retrieval and Boundary settings are unchanged by the recorder",
        settingsStable,
      );

      if (IS_COMPACT_PROXY) {
        const lexicalIdentityRequired = result.compactProxy.maintenance.rebuild.status === "PASS";
        const lexicalIdentityStable = lexicalIdentityRequired
          && await compactEvaluatedLexicalGenerationIsReady();
        if (lexicalIdentityRequired && !lexicalIdentityStable) {
          compactLexicalIdentityDriftDetected = true;
        }
        record(
          "Compact evaluated lexical identity remains stable through finalization",
          lexicalIdentityStable ? "PASS" : lexicalIdentityRequired ? "FAIL" : "BLOCKED",
          lexicalIdentityStable
            ? "the rebuild-bound database, profile, and generation remain active"
            : lexicalIdentityRequired
              ? "the rebuild-bound database, profile, or generation drifted"
              : "no evaluated lexical generation was bound",
          lexicalIdentityRequired ? {} : { blocking: false },
        );
        result.compactProxy.maintenance.sourceMutationGuard = {
          status: compactMarkdownMutationCount > 0
            ? "FAIL" : compactMarkdownMutationGuardInstalled ? "PASS" : "BLOCKED",
          eventCount: compactMarkdownMutationCount,
        };
        record(
          "Compact proxy observes no Vault Markdown mutation",
          result.compactProxy.maintenance.sourceMutationGuard.status,
          compactMarkdownMutationCount === 0
            ? "the frozen source input had zero create/modify/delete/rename events"
            : `${compactMarkdownMutationCount} Markdown mutation event(s) were observed`,
        );
        await restoreCompactInitialSettings();
        const cleanup = result.compactProxy.settingsTransition.cleanup;
        record(
          "Compact proxy restores the initial flag profile before receipt commit",
          cleanup.status === "PASS" ? "PASS" : "BLOCKED",
          cleanup.status === "PASS"
            ? "the initial control profile is persisted"
            : cleanup.status === "NOT_REQUIRED"
              ? "the evaluated transition was never completed"
              : cleanup.reason || "the initial control profile was not persisted",
        );
      }

      const visibleText = document.body?.innerText || document.body?.textContent || "";
      assert("Opaque bridge content is absent from visible UI", !visibleText.includes(OPAQUE_SENTINEL));

      if (IS_COMPACT_PROXY) {
        try {
          await refreshCompactProxyWorkloadBinding();
        } catch (error) {
          if (!compactProxyIsPermanentlyInvalid()) throw error;
        }
        evaluateCompactProxyStatus({ fixturesStable, settingsStable });
      } else {
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
      }

      // All non-final receipt writes must settle before the evidence cutoff so
      // the cutoff is followed by exactly one serialization/write operation.
      await writeQueue;
      // Keep runtime observation sources installed through every asynchronous
      // pre-commit check. They are retired only after the last poison settle.
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
      if (IS_COMPACT_PROXY) {
        await settleCompactProxyPoisonForFinalization();
        // No call that begins after finalizing=true is admitted to this queue.
        // Fence poison cleanup scheduling, confirm the already-admitted queue
        // once more, then settle any poison latched during that final await.
        compactProxyFinalizationFence = true;
        await compactProxyPublicMutationQueue;
        await settleCompactProxyPoisonForFinalization();
        let finalFixturesStable = true;
        try {
          for (const path of [...ALLOWED_FIXTURES, ...OPAQUE_FIXTURES]) {
            const currentHash = await readAndHash(path);
            if (sourceHashes.get(path) !== currentHash) finalFixturesStable = false;
          }
        } catch {
          finalFixturesStable = false;
        }
        if (!finalFixturesStable && !compactProxyPoison.latched) {
          markCompactProxyPoisoned(compactProxyCurrentStage, "fixture_identity_drift");
        }
        const lexicalIdentityRequired =
          result.compactProxy.maintenance.rebuild.status === "PASS";
        const finalLexicalIdentityStable = !lexicalIdentityRequired
          || await compactEvaluatedLexicalGenerationIsReady();
        if (!finalLexicalIdentityStable) {
          compactLexicalIdentityDriftDetected = true;
          if (!compactProxyPoison.latched) {
            markCompactProxyPoisoned(
              compactProxyCurrentStage,
              "evaluated_lexical_identity_drift",
            );
          }
        }
        // Protocol boundary: all runner-owned maintenance/public queues are
        // drained and fenced above, so lexical identity cannot change through
        // an admitted smoke operation after this point. Capture runtime and
        // loaded/disk artifact identity as the final asynchronous observation;
        // only synchronous guards, teardown, and immutable serialization follow.
        const finalIdentityStable = await runtimeAndArtifactIdentityAreStable();
        const finalSettingsStable = measurementSettingsAreStable();
        const finalBindingDrifted = compactProxyPoison.latched
          || compactMarkdownMutationCount > 0
          || settingsChangedDuringRun
          || pluginLifecycleDriftDetected
          || identityDriftDetected
          || !finalFixturesStable
          || !finalIdentityStable
          || !finalLexicalIdentityStable
          || !finalSettingsStable;
        if (finalBindingDrifted) {
          commitBindingCheck.status = "BLOCKED";
          commitBindingCheck.detail = "one or more receipt bindings changed before the final write";
          await settleCompactProxyPoisonForFinalization();
        }
        result.compactProxy.maintenance.sourceMutationGuard = {
          status: compactMarkdownMutationCount > 0
            ? "FAIL" : compactMarkdownMutationGuardInstalled ? "PASS" : "BLOCKED",
          eventCount: compactMarkdownMutationCount,
        };
      }
      teardownRuntimePoisonObservationSources();
      receiptCommitCriticalSectionActive = true;
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
        commitBindingCheck.detail = "receipt_commit_failed";
        if (IS_COMPACT_PROXY && result.compactProxy.status !== "INVALID") {
          result.compactProxy.status = "BLOCKED";
          result.compactProxy.ownerDisposition = {
            status: "PENDING",
            reason: "receipt_commit_failed",
            trackerRecorded: false,
          };
        }
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
      if (IS_COMPACT_PROXY) {
        if (result.compactProxy.status === "READY_FOR_OWNER_REVIEW") {
          result.compactProxy.status = "BLOCKED";
          result.compactProxy.ownerDisposition = {
            status: "PENDING",
            reason: "finalization_failed",
            trackerRecorded: false,
          };
        }
        try {
          await restoreCompactInitialSettings();
        } catch (cleanupError) {
          console.warn("[retrieval-smoke] compact settings cleanup failed", cleanupError);
        }
      }
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

  const serializeCompactProxyPublicMutation = (operation) => (...args) => {
    if (!IS_COMPACT_PROXY) return operation(...args);
    if (finalizing || finalized || compactProxyFinalizationFence) {
      return Promise.reject(
        new Error("Retrieval smoke result is finalized and cannot be modified."),
      );
    }
    const run = async () => {
      if (finalizing || finalized) {
        throw new Error("Retrieval smoke result is finalized and cannot be modified.");
      }
      compactProxyPublicMutationActive = true;
      try {
        requireCompactProxyMutationAdmission();
        const admittedEpoch = compactProxyPoison.epoch;
        const value = await operation(...args);
        if (compactProxyPoison.epoch !== admittedEpoch) {
          requireCompactProxyMutationAdmission();
        }
        requireCompactProxyMutationAdmission();
        return value;
      } catch (error) {
        const terminalReason = compactProxyTerminalViolationReason();
        if (!compactProxyPoison.latched && terminalReason) {
          markCompactProxyPoisoned(compactProxyCurrentStage, terminalReason);
        }
        if (compactProxyPoison.latched && !compactProxyPoisonHandled) {
          try {
            await refreshCompactProxyWorkloadBinding();
          } catch {
            // Preserve the public mutation's primary failure.
          }
          try {
            await cleanupInvalidCompactProxyState();
          } catch {
            // Cleanup failure cannot reopen or replace the poison latch.
          }
          try {
            await writeResult();
          } catch {
            // Preserve the operation's primary error and the in-memory latch.
          }
          compactProxyPoisonHandled = true;
        }
        throw error;
      } finally {
        compactProxyPublicMutationActive = false;
      }
    };
    const queued = compactProxyPublicMutationQueue.then(run, run);
    compactProxyPublicMutationQueue = queued.catch(() => undefined);
    return queued;
  };

  const stopRetrievalDiagnosticsForPublic = (...args) => {
    if (finalizing || finalized || compactProxyFinalizationFence) {
      return Promise.reject(
        new Error("Retrieval smoke result is finalized and cannot be modified."),
      );
    }
    if (!IS_COMPACT_PROXY) {
      return stopRetrievalDiagnostics(...args);
    }
    if (!compactProxyIsPermanentlyInvalid()) {
      return serializeCompactProxyPublicMutation(stopRetrievalDiagnostics)(...args);
    }
    const cleanup = async () => {
      await cleanupInvalidCompactProxyState();
      return null;
    };
    const queued = compactProxyPublicMutationQueue.then(cleanup, cleanup);
    compactProxyPublicMutationQueue = queued.catch(() => undefined);
    return queued;
  };

  const runnerGuardKey = "__paRetrievalSmokeRunnerGuard";
  const existingRunnerGuard = globalThis[runnerGuardKey];
  const existingRecorder = globalThis.paRetrievalSmoke;
  const unfinishedRunnerGuard = existingRunnerGuard?.fixtureVersion === FIXTURE_VERSION
    && !existingRunnerGuard.finished;
  const unfinishedRecorder = existingRecorder?.fixtureVersion === FIXTURE_VERSION
    && !existingRecorder.result?.finishedAt;
  if (unfinishedRunnerGuard || unfinishedRecorder) {
    console.warn("[retrieval-smoke] an unfinished recorder is already active; reuse it instead of starting a second session");
    return;
  }
  const runnerGuard = { fixtureVersion: FIXTURE_VERSION, profile: ACTIVE_PROFILE, finished: false };
  globalThis[runnerGuardKey] = runnerGuard;
  let publishedRecorder = null;

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

    if (IS_COMPACT_PROXY) {
      const settings = plugin.settings || {};
      const flags = settings.retrievalOptimizationFlags;
      compactInitialRetrievalFlagsState = {
        present: Object.hasOwn(settings, "retrievalOptimizationFlags"),
        value: flags === undefined ? undefined : clone(flags),
      };
      compactStableSettingsProfileSha256 = await currentStableSettingsProfileSha256(plugin);
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
    if (IS_COMPACT_PROXY) {
      compactMarkdownMutationGuardInstalled = installCompactMarkdownMutationGuard();
      result.compactProxy.maintenance.sourceMutationGuard.status =
        compactMarkdownMutationGuardInstalled ? "ACTIVE" : "BLOCKED";
      record(
        "Compact proxy observes every Vault Markdown mutation",
        compactMarkdownMutationGuardInstalled ? "PASS" : "BLOCKED",
        compactMarkdownMutationGuardInstalled
          ? "create/modify/delete/rename events are latched for the complete run"
          : "the Vault Markdown mutation event seam is unavailable",
      );
    }

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
      IS_COMPACT_PROXY ? { blocking: false } : {},
    );
    await startDiagnosticsSession("preFreeze", "Retrieval diagnostics session seam is available");
    const flags = plugin?.settings?.retrievalOptimizationFlags || {};
    if (IS_COMPACT_PROXY) {
      const enabledControlFlags = REQUIRED_FLAGS.filter((key) => flags[key] === true);
      record(
        "Compact control starts with all retrieval rollout flags off",
        enabledControlFlags.length === 0 ? "PASS" : "BLOCKED",
        enabledControlFlags.length === 0
          ? ""
          : `${enabledControlFlags.length} control flag(s) are already on`,
      );
    } else {
      const disabledFlags = REQUIRED_FLAGS.filter((key) => flags[key] !== true);
      record(
        "All retrieval rollout flags are enabled for this isolated smoke",
        disabledFlags.length === 0 ? "PASS" : "BLOCKED",
        disabledFlags.length === 0 ? "" : `${disabledFlags.length} required flag(s) remain off`,
      );
    }

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
    const expandedCompactProxy = expandCompactProxyPlan(manifest.compactProxyPlan);
    compactProxyPlanTemplate = expandedCompactProxy.plan;
    compactProxyWorkloadContract = expandedCompactProxy.workload;
    compactProxyWorkloadSequence = expandedCompactProxy.sequence;
    if (IS_COMPACT_PROXY) {
      const compactProxyPlanSha256 = await digest(canonicalJson(compactProxyPlanTemplate));
      result.compactProxy.planSha256 = compactProxyPlanSha256;
      result.identity.compactProxyPlanSha256 = compactProxyPlanSha256;
      result.compactProxy.settingsTransition.stableSettingsProfileSha256 =
        compactStableSettingsProfileSha256;
      result.compactProxy.settingsTransition.controlSettingsBindingSha256 =
        await compactSettingsBindingSha256(compactProxyPlanTemplate.settingsPhases.control);
      result.compactProxy.settingsTransition.evaluatedSettingsBindingSha256 =
        await compactSettingsBindingSha256(compactProxyPlanTemplate.settingsPhases.evaluated);
      await refreshCompactProxyWorkloadBinding();
      refreshCompactProxyMetrics();
    }
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
      && manifest.compactProxyPlan?.version === COMPACT_PROXY_VERSION
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
    if (IS_COMPACT_PROXY) {
      const compactRuntimeMatches = result.runtime.platformClass
        === compactProxyPlanTemplate.requiredPlatformClass
        && result.runtime.runtimeFamily === compactProxyPlanTemplate.requiredRuntimeFamily;
      const deviceIdentitySha256 = isSha256(COMPACT_DEVICE_IDENTITY_SHA256)
        ? COMPACT_DEVICE_IDENTITY_SHA256
        : null;
      const runtimeIdentitySha256 = await digest(canonicalJson({
        platformClass: result.runtime.platformClass,
        runtimeFamily: result.runtime.runtimeFamily,
        appBuildIdentitySha256: result.runtime.appBuildIdentitySha256,
        appVersion: result.runtime.appVersion,
        appVersionSource: result.runtime.appVersionSource,
        shellVersion: result.runtime.shellVersion,
        shellVersionSource: result.runtime.shellVersionSource,
      }));
      result.compactProxy.deviceBinding = {
        status: compactRuntimeMatches && deviceIdentitySha256
          && isSha256(result.runtime.appBuildIdentitySha256)
          ? "BOUND" : "BLOCKED",
        deviceIdentitySha256,
        platformClass: result.runtime.platformClass,
        runtimeFamily: result.runtime.runtimeFamily,
        runtimeIdentitySha256,
      };
      record(
        "Compact proxy runs on the required real-iPhone WKWebView runtime",
        compactRuntimeMatches ? "PASS" : "BLOCKED",
        compactRuntimeMatches
          ? `${result.runtime.platformClass}/${result.runtime.runtimeFamily}`
          : `required ${compactProxyPlanTemplate.requiredPlatformClass}/${compactProxyPlanTemplate.requiredRuntimeFamily}`,
      );
      record(
        "Compact proxy binds one opaque real-iPhone device identity",
        result.compactProxy.deviceBinding.status === "BOUND" ? "PASS" : "BLOCKED",
        result.compactProxy.deviceBinding.status === "BOUND"
          ? "operator-provided opaque SHA-256 is frozen for this runner"
          : "set paRetrievalSmokeDeviceIdentitySha256 to the current iOS receipt device hash",
      );
    }
    record(
      "Memory index is ready for provider-backed smoke",
      snapshot?.status === "ready" ? "PASS" : "BLOCKED",
      snapshot?.status || "unavailable",
    );
    record(
      "CHAR-PHRASE lexical generation is active",
      snapshot?.lexicalProfileState === "ready" ? "PASS" : "BLOCKED",
      snapshot?.lexicalFallbackReason || snapshot?.lexicalProfileState || "unavailable",
      IS_COMPACT_PROXY ? { blocking: false } : {},
    );
    record(
      "Selected reranker model class is available",
      rerankerClass === "none" ? "BLOCKED" : "PASS",
      rerankerClass === "none" ? "configure a Chat model before testing" : rerankerClass,
    );

    publishedRecorder = Object.freeze({
      fixtureVersion: FIXTURE_VERSION,
      profile: ACTIVE_PROFILE,
      checklist,
      rankingChecklist,
      routingChecklist,
      get result() {
        return snapshotPublishedResult();
      },
      get nextPerformanceWorkload() {
        return nextPerformanceWorkloadValue();
      },
      get nextCompactProxyWorkload() {
        return nextCompactProxyWorkloadValue();
      },
      startCompactProxy: serializeCompactProxyPublicMutation(startCompactProxy),
      recordCompactProxyEpisode: serializeCompactProxyPublicMutation(recordCompactProxyEpisode),
      beginCompactEvaluated: serializeCompactProxyPublicMutation(beginCompactEvaluated),
      beginCompactCorrectness: serializeCompactProxyPublicMutation(beginCompactCorrectness),
      beginCompactPerformance: serializeCompactProxyPublicMutation(beginCompactPerformance),
      beginCompactRetry: serializeCompactProxyPublicMutation(beginCompactRetry),
      stopCompactProxy: serializeCompactProxyPublicMutation(stopCompactProxy),
      beginCompactCancellationProbe:
        serializeCompactProxyPublicMutation(beginCompactCancellationProbe),
      recordCompactMaintenance: serializeCompactProxyPublicMutation(recordCompactMaintenance),
      recordCase: serializeCompactProxyPublicMutation(recordCase),
      recordRecoveryCase: serializeCompactProxyPublicMutation(recordRecoveryCase),
      recordTemporalRetryCase: serializeCompactProxyPublicMutation(recordTemporalRetryCase),
      recordPageletCase: serializeCompactProxyPublicMutation(recordPageletCase),
      recordRankingCase: serializeCompactProxyPublicMutation(recordRankingCase),
      freezeDeviceMeasurementPlan: serializeCompactProxyPublicMutation(freezeDeviceMeasurementPlan),
      recordPerformanceQualification:
        serializeCompactProxyPublicMutation(recordPerformanceQualification),
      recordPerformanceEpisode: serializeCompactProxyPublicMutation(recordPerformanceEpisode),
      recordDeviceMetric: serializeCompactProxyPublicMutation(recordDeviceMetric),
      sampleEventLoopGap: serializeCompactProxyPublicMutation(sampleEventLoopGap),
      startRuntimeEnvelope: serializeCompactProxyPublicMutation(startRuntimeEnvelope),
      beginRetryPerformance: serializeCompactProxyPublicMutation(beginRetryPerformance),
      continueRetryPerformance: serializeCompactProxyPublicMutation(continueRetryPerformance),
      stopRuntimeEnvelope: serializeCompactProxyPublicMutation(stopRuntimeEnvelope),
      recordExternalMemoryEnvelope:
        serializeCompactProxyPublicMutation(recordExternalMemoryEnvelope),
      sampleLongTasks: serializeCompactProxyPublicMutation(sampleLongTasks),
      recordVssStats: serializeCompactProxyPublicMutation(recordVssStats),
      recordDiagnosticsSnapshot: serializeCompactProxyPublicMutation(recordDiagnosticsSnapshot),
      captureRetrievalDiagnostics:
        serializeCompactProxyPublicMutation(captureRetrievalDiagnostics),
      stopRetrievalDiagnostics: stopRetrievalDiagnosticsForPublic,
      beginCancellationProbe: serializeCompactProxyPublicMutation(beginCancellationProbe),
      finalize,
    });
    await writeResult();
    globalThis.paRetrievalSmoke = publishedRecorder;
    console.log("[retrieval-smoke] automated preflight complete; manual cases remain PENDING until explicitly recorded");
    console.table(Object.entries(checklist).map(([id, value]) => ({ id, ...value })));
    console.table(Object.entries(rankingChecklist).map(([id, value]) => ({ id, ...value })));
    console.table(Object.entries(routingChecklist).map(([id, value]) => ({ id, ...value })));
  } catch (error) {
    const initializationError = error;
    const cleanupErrors = [];
    compactProxyFinalizationFence = true;
    finalized = true;
    runnerGuard.finished = true;
    if (globalThis.paRetrievalSmoke === publishedRecorder) {
      try {
        delete globalThis.paRetrievalSmoke;
      } catch {
        // The finished runner guard still permits a clean replacement run.
      }
    }
    record("Runner initialization", "FAIL", initializationError?.stack || String(initializationError));
    result.overall = "FAIL";
    result.finishedAt = new Date().toISOString();
    try {
      await enqueueDiagnosticsOperation(stopRetrievalDiagnosticsImpl);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      const orphanFailures = await discardOwnedDiagnosticsSessions({ attempts: 2 });
      if (orphanFailures.length > 0) {
        markDiagnosticsBlocked(
          "orphan diagnostics session cleanup failed",
          "Every diagnostics session started by this runner is stopped",
        );
        cleanupErrors.push(new Error("orphan diagnostics session cleanup failed"));
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (IS_COMPACT_PROXY) {
      try {
        await restoreCompactInitialSettings();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    teardownRunnerIntegrity();
    try {
      await writeResult();
    } catch (writeError) {
      console.warn("[retrieval-smoke] failed to write result", writeError);
    }
    if (cleanupErrors.length > 0) {
      console.warn(
        "[retrieval-smoke] initialization cleanup failed after the primary error",
        cleanupErrors,
      );
    }
  }
})();
