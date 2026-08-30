import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

export const RETRIEVAL_EVIDENCE_VERIFIER_SCHEMA_VERSION = 1;
export const RETRIEVAL_EVIDENCE_VERIFIER_TYPE =
  "pa.retrieval-evidence-current-artifact-verification";
export const RETRIEVAL_EVIDENCE_INTEGRITY_ERROR =
  "RETRIEVAL_EVIDENCE_INTEGRITY_ERROR";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const APP_FIXTURE_VERSION = "b125-retrieval-smoke-v5";
const STALE_APP_FIXTURE_VERSION_PATTERN = /^b125-retrieval-smoke-v[1-4]$/u;
const COMPACT_PROXY_PROFILE = "compact-proxy";
const COMPACT_PROXY_PLAN_VERSION = "b125-compact-proxy-v1";
const COMPACT_PROXY_MACHINE_STATUS = "CANDIDATE";
const COMPACT_PROXY_COMPLETION_STATUS = "READY_FOR_OWNER_REVIEW";
const COMPACT_PROXY_STAGE_COUNTS = Object.freeze({
  controlStandard: 6,
  evaluatedStandard: 13,
  evaluatedRetry: 13,
  cancellationProbe: 1,
});
const COMPACT_PROXY_STAGE_SEGMENTS = Object.freeze({
  controlStandard: Object.freeze([
    Object.freeze({
      idPrefix: "compact-control-std-warmup-", from: 1, to: 1, pad: 2,
      sampleClass: "warmup", promptId: "standard-v1", settingsPhase: "control",
    }),
    Object.freeze({
      idPrefix: "compact-control-std-measured-", from: 1, to: 5, pad: 2,
      sampleClass: "measured", promptId: "standard-v1", settingsPhase: "control",
    }),
  ]),
  evaluatedStandard: Object.freeze([
    Object.freeze({
      idPrefix: "compact-evaluated-std-warmup-", from: 1, to: 3, pad: 2,
      sampleClass: "warmup", promptId: "standard-v1", settingsPhase: "evaluated",
    }),
    Object.freeze({
      idPrefix: "compact-evaluated-std-measured-", from: 1, to: 10, pad: 2,
      sampleClass: "measured", promptId: "standard-v1", settingsPhase: "evaluated",
    }),
  ]),
  evaluatedRetry: Object.freeze([
    Object.freeze({
      idPrefix: "compact-evaluated-retry-warmup-", from: 1, to: 3, pad: 2,
      sampleClass: "warmup", promptId: "retry-v1", settingsPhase: "evaluated",
    }),
    Object.freeze({
      idPrefix: "compact-evaluated-retry-measured-", from: 1, to: 10, pad: 2,
      sampleClass: "measured", promptId: "retry-v1", settingsPhase: "evaluated",
    }),
  ]),
  cancellationProbe: Object.freeze([
    Object.freeze({
      id: "compact-cancel-probe-01", sampleClass: "probe", promptId: "cancel-v1",
      settingsPhase: "evaluated",
    }),
  ]),
});
const COMPACT_PROXY_FLAG_PROFILE = Object.freeze({
  control: Object.freeze({
    lexicalProfile: false,
    strictReranker: false,
    graphPpr: false,
    relaxedRecovery: false,
  }),
  evaluated: Object.freeze({
    lexicalProfile: true,
    strictReranker: true,
    graphPpr: true,
    relaxedRecovery: true,
  }),
});
const COMPACT_PROXY_HARD_BUDGETS = Object.freeze({
  lexicalMs: 500,
  graphMs: 8_000,
  recoveryMs: 30_000,
  outerTurnMs: 180_000,
  finalizationReserveMinExclusiveMs: 0,
});
const PERFORMANCE_WORKLOAD_SCHEMA_VERSION = 1;
const PERFORMANCE_WORKLOAD_CONVERSATION_POLICY = "fresh-chat-per-episode";
const PERFORMANCE_WORKLOAD_STAGE_COUNTS = Object.freeze({
  standardPerformance: 23,
  retryPerformanceBatch1: 12,
  retryPerformanceBatch2: 11,
  cancellationProbe: 1,
});
const PERFORMANCE_WORKLOAD_QUALIFICATION_IDS = Object.freeze([
  "standard-v1",
  "retry-v1",
]);
const PERFORMANCE_WORKLOAD_PROMPT_SHAPES = Object.freeze({
  "standard-v1": "one-attempt-full-graph",
  "retry-v1": "two-attempt-full-graph-with-projection",
  "cancel-v1": "one-attempt-same-worker-cancel",
});
const PERFORMANCE_WORKLOAD_PROMPT_TEXTS = Object.freeze({
  "standard-v1": "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因是什么？",
  "retry-v1": "只从我的笔记中回答：PFR-842 琥珀罗盘事故的完整根因是什么？",
  "cancel-v1": "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因与修复方向是什么？",
});
const PERFORMANCE_WORKLOAD_STAGE_PROMPTS = Object.freeze({
  standardPerformance: "standard-v1",
  retryPerformanceBatch1: "retry-v1",
  retryPerformanceBatch2: "retry-v1",
  cancellationProbe: "cancel-v1",
});
const PERFORMANCE_WORKLOAD_STAGE_CLASSES = Object.freeze({
  standardPerformance: new Set(["warmup", "measured"]),
  retryPerformanceBatch1: new Set(["warmup", "measured"]),
  retryPerformanceBatch2: new Set(["measured"]),
  cancellationProbe: new Set(["probe"]),
});
const PERFORMANCE_WORKLOAD_STAGE_SEGMENTS = Object.freeze({
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
const EXTERNAL_MEMORY_ARTIFACT_PATH =
  "test/retrieval-smoke/evidence/system-memory-envelope.json";
const EXTERNAL_MEMORY_RAW_EXPORT_PATH =
  "test/retrieval-smoke/evidence/system-memory-envelope.instruments.xml";
const EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON =
  "external_memory_converter_unverified";
const EXTERNAL_SYSTEM_MEMORY_PROFILERS = new Set([
  "Xcode Instruments",
  "Instruments CLI",
]);
const EXTERNAL_MEMORY_ARTIFACT_KEYS = Object.freeze([
  "schemaVersion", "collectorKind", "tool", "toolVersion", "platform", "platformClass",
  "runtimeFamily", "counter", "unit", "processName", "appBundleId", "appVersion",
  "appBuildIdentitySha256", "pluginId", "pluginVersion", "pluginArtifactSha256",
  "runnerSha256", "deviceIdentitySha256", "windowStartedAt", "windowFinishedAt",
  "sampleIntervalMs", "samples", "rawExportPath", "rawExportSha256",
]);
const EXTERNAL_MEMORY_BINDING_KEYS = Object.freeze([
  "schemaVersion", "collectorKind", "tool", "toolVersion", "platform", "platformClass",
  "runtimeFamily", "counter", "unit", "processName", "appBundleId", "appVersion",
  "appBuildIdentitySha256", "pluginId", "pluginVersion", "pluginArtifactSha256",
  "runnerSha256", "deviceIdentitySha256", "windowStartedAt", "windowFinishedAt",
  "sampleIntervalMs", "artifactSha256", "rawExportPath", "rawExportSha256", "sampleCount",
  "evidenceSource", "finalizationVerificationStatus", "evidenceCutoffAt",
  "evidenceCutoffStatus", "lifecycleGuardStatus",
]);
const EXTERNAL_MEMORY_BLOCKED_STATE_KEYS = Object.freeze([
  "schemaVersion", "status", "reason", "artifactPath", "artifactSha256",
  "rawExportPath", "rawExportSha256", "deviceIdentitySha256",
]);
const EXTERNAL_MEMORY_CAPTURE_PRECONDITION_KEYS = Object.freeze([
  "status", "reason", "checkedAt", "artifactPath", "artifactAbsent",
  "rawExportPath", "rawExportAbsent",
]);
const DEVICE_METRIC_KEYS = Object.freeze([
  "id", "unit", "sampleMode", "collectionMethod", "required", "method",
  "evidenceSource", "status", "reason", "rawSamples", "evaluatedSamples",
  "p50", "p95", "minimum", "maximum", "threshold", "recordedAt",
]);
const DIAGNOSTICS_DERIVED_REQUIRED_METRIC_IDS = new Set([
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
const PROCESS_MEMORY_METRIC_ID = "memory.peakProcessFootprintBytes";
const PEAK_DATABASE_METRIC_ID = "storage.peakEstimatedDbBytes";
const MAX_EVENT_LOOP_STALL_METRIC_ID = "ui.maxEventLoopStallMs";
const OPFS_RECEIPT_SCHEMA_VERSION = 1;
const OPFS_RECEIPT_TYPE = "personal-assistant-retrieval-opfs-restart";
const PLUGIN_ID = "personal-assistant";
const OPFS_RUNNER_VAULT_PATH = "retrieval-opfs-restart-runner.js";
const OPFS_MAIN_PROCESS_IDENTITY_SOURCE = "electron-renderer:process.ppid";
const OPFS_SUPPORTED_DESKTOP_PLATFORMS = new Set(["darwin", "win32", "linux"]);
const SAFE_RUNTIME_TOKEN_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u;
const REQUIRED_APP_SLICE_IDS = Object.freeze([
  "chat-recovery",
  "pagelet-0",
  "pagelet-1",
  "pagelet-2",
]);
const PAGELET_SOURCE_BINDING_KEYS = Object.freeze([
  "schemaVersion",
  "sequence",
  "controllerSequence",
  "runId",
  "resultId",
  "triggerReason",
  "force",
  "resultStatus",
  "reason",
  "runtimeCompletion",
  "collectionId",
]);
const PAGELET_RUNTIME_COMPLETION_KEYS = Object.freeze([
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
]);
const PAGELET_LOOP_STATUSES = new Set([
  "completed",
  "completed_with_warning",
  "incomplete",
  "aborted",
  "error",
]);
const PAGELET_TURN_STATUSES = new Set([
  "completed",
  "tool_results_ready",
  "completed_with_warning",
  "incomplete",
  "aborted",
  "error",
]);
const PAGELET_RESULT_STATUSES = new Set([
  "quiet",
  "verified",
  "cache-hit",
  "limit",
  "denied",
  "stale",
  "error",
]);
const PAGELET_FINAL_TEXT_STATES = new Set(["empty", "no-insight", "candidate"]);
const PAGELET_CITATION_COVERAGE_STATES = new Set([
  "not-applicable",
  "complete",
  "ungrounded",
  "missing-anchor",
  "missing-non-anchor",
]);
const PAGELET_INSIGHT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const PAGELET_RUNTIME_CODE_PATTERN = /^[a-z0-9_-]{1,96}$/u;
const REQUIRED_APP_IDENTITY_CHECKS = Object.freeze([
  "Loaded plugin and current vault artifact identities match",
  "Smoke manifest matches the canonical repository identity",
  "Smoke manifest contract matches the runner",
  "Smoke runner artifact identity is captured",
  "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
  "Plugin lifecycle, artifact, and settings bindings are stable at receipt commit",
]);
const COMPACT_PROXY_RUNTIME_CHECK =
  "Compact proxy runs on the required real-iPhone WKWebView runtime";
const COMPACT_PROXY_DEVICE_CHECK =
  "Compact proxy binds one opaque real-iPhone device identity";
const COMPACT_PROXY_CLEANUP_CHECK =
  "Compact proxy restores the initial flag profile before receipt commit";
const COMPACT_PROXY_SOURCE_GUARD_CHECK =
  "Compact proxy observes every Vault Markdown mutation";
const COMPACT_PROXY_SOURCE_CLEAN_CHECK =
  "Compact proxy observes no Vault Markdown mutation";
const COMPACT_PROXY_COMPLETION_CHECK =
  "Compact proxy evidence is complete for owner review";
const OPFS_STABLE_FIELD_PATHS = Object.freeze([
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
]);

export const DEFAULT_RETRIEVAL_EVIDENCE_PATHS = Object.freeze({
  appReceipt: "test/retrieval-optimization-smoke-result.json",
  opfsReceipt: "test/retrieval-opfs-restart-receipt.json",
  opfsBaseline: "test/retrieval-opfs-restart-baseline.json",
  distPlugin: "dist/main.js",
  vaultPlugin: "test/.obsidian/plugins/personal-assistant/main.js",
  appRunnerSource: "scripts/retrieval-optimization-smoke-runner.js",
  appRunnerVault: "test/retrieval-optimization-smoke-runner.js",
  manifestSource: "__fixtures__/retrieval-smoke/manifest.json",
  manifestVault: "test/retrieval-optimization-smoke-manifest.json",
  opfsRunnerSource: "scripts/retrieval-opfs-restart-runner.js",
  opfsRunnerVault: "test/retrieval-opfs-restart-runner.js",
});

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isSafeRuntimeToken(value) {
  return typeof value === "string" && SAFE_RUNTIME_TOKEN_PATTERN.test(value);
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function addUnique(collection, code) {
  if (!collection.includes(code)) collection.push(code);
}

function blocker(state, code) {
  addUnique(state.blockers, code);
}

function failure(state, code) {
  addUnique(state.failures, code);
}

function integrity(state, code) {
  addUnique(state.integrityErrors, code);
}

function receiptSemanticIssue(state, receiptStatus, code) {
  if (receiptStatus === "PASS") integrity(state, code);
  else if (receiptStatus === "FAIL") failure(state, code);
  else blocker(state, code);
}

function inspectStatus(state, value, codes) {
  if (value === "PASS") return;
  if (value === "FAIL") {
    failure(state, codes.fail);
    return;
  }
  if (value === "BLOCKED" || value === "PENDING") {
    blocker(state, codes.blocked);
    return;
  }
  integrity(state, codes.invalid);
}

function runnerIssueStatus(issues) {
  if (!Array.isArray(issues) || issues.some((issue) => (
    !isObject(issue)
      || typeof issue.code !== "string"
      || issue.code.length === 0
      || (issue.status !== "BLOCKED" && issue.status !== "FAIL")
  ))) return null;
  if (issues.some((issue) => issue.status === "FAIL")) return "FAIL";
  if (issues.some((issue) => issue.status === "BLOCKED")) return "BLOCKED";
  return "PASS";
}

function validateRunnerIssueSummary(container, code, state) {
  const computedStatus = runnerIssueStatus(container?.issues);
  if (computedStatus === null || container?.status !== computedStatus) {
    integrity(state, code);
  }
  return computedStatus;
}

function validateRunnerOperatorAssertion(assertion, phase, code, state) {
  const expectedId = phase === "before"
    ? "full-app-restart-window-before-v1"
    : "full-app-restart-window-after-v1";
  const validPass = assertion?.status === "PASS"
    && assertion.confirmed === true
    && isCanonicalIsoTimestamp(assertion.confirmedAt);
  const validBlocked = assertion?.status === "BLOCKED"
    && assertion.confirmed === false
    && assertion.confirmedAt === null;
  if (!isObject(assertion)
    || assertion.id !== expectedId
    || assertion.basis !== "operator-attestation-not-independently-verified"
    || typeof assertion.statement !== "string"
    || assertion.statement.length === 0
    || (!validPass && !validBlocked)) {
    integrity(state, code);
  }
}

function resultStatus(state, checkpoint) {
  if (state.integrityErrors.length > checkpoint.integrityErrors
    || state.failures.length > checkpoint.failures) return "FAIL";
  if (state.blockers.length > checkpoint.blockers) return "BLOCKED";
  return "PASS";
}

function checkpoint(state) {
  return {
    blockers: state.blockers.length,
    failures: state.failures.length,
    integrityErrors: state.integrityErrors.length,
  };
}

async function readArtifact(rootDirectory, key, relativePath, state) {
  const absolutePath = resolve(rootDirectory, relativePath);
  try {
    const bytes = await readFile(absolutePath);
    return {
      key,
      path: relativePath,
      absolutePath,
      bytes,
      sha256: sha256(bytes),
    };
  } catch (error) {
    if (error?.code === "ENOENT") blocker(state, `artifact_missing:${key}`);
    else blocker(state, `artifact_unreadable:${key}`);
    return {
      key,
      path: relativePath,
      absolutePath,
      bytes: null,
      sha256: null,
    };
  }
}

function parseJsonArtifact(artifact, state, invalidCode) {
  if (!artifact.bytes) return null;
  try {
    const parsed = JSON.parse(artifact.bytes.toString("utf8"));
    if (!isObject(parsed)) {
      integrity(state, invalidCode.replace("_json_invalid", "_schema_invalid"));
      return null;
    }
    return parsed;
  } catch {
    integrity(state, invalidCode);
    return null;
  }
}

function compareArtifactPair(state, left, right, mismatchCode) {
  if (left.sha256 && right.sha256 && left.sha256 !== right.sha256) {
    blocker(state, mismatchCode);
  }
}

function compareReceiptHash(state, recorded, artifact, invalidCode, mismatchCode) {
  if (!isSha256(recorded)) {
    integrity(state, invalidCode);
    return;
  }
  if (artifact.sha256 && recorded !== artifact.sha256) blocker(state, mismatchCode);
}

function validateTimestampInWindow(state, value, startedAt, finishedAt, code) {
  if (!isCanonicalIsoTimestamp(value)) {
    integrity(state, `${code}_invalid`);
    return;
  }
  if (isCanonicalIsoTimestamp(startedAt) && isCanonicalIsoTimestamp(finishedAt)
    && (value < startedAt || value > finishedAt)) {
    integrity(state, `${code}_outside_receipt_window`);
  }
}

function sortedEntries(record) {
  return Object.entries(record).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
}

function isSafeFixturePath(value) {
  return typeof value === "string"
    && value.startsWith("retrieval-smoke/")
    && !value.startsWith("/")
    && !value.split("/").includes("..")
    && !value.includes("\\");
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isPageletInsightId(value) {
  return typeof value === "string" && PAGELET_INSIGHT_ID_PATTERN.test(value);
}

function isPageletRuntimeCode(value) {
  return value === null
    || (typeof value === "string" && PAGELET_RUNTIME_CODE_PATTERN.test(value));
}

function pageletRuntimeCompletionValid(value) {
  if (value === null) return true;
  if (!hasExactKeys(value, PAGELET_RUNTIME_COMPLETION_KEYS)) return false;
  const diagnosticTypes = value.diagnosticTypes;
  return PAGELET_LOOP_STATUSES.has(value.loopStatus)
    && isPageletRuntimeCode(value.endReason)
    && Array.isArray(diagnosticTypes)
    && diagnosticTypes.every((type) => type !== null && isPageletRuntimeCode(type))
    && new Set(diagnosticTypes).size === diagnosticTypes.length
    && diagnosticTypes.join("\u0000") === [...diagnosticTypes].sort().join("\u0000")
    && (value.lastTurnStatus === null || PAGELET_TURN_STATUSES.has(value.lastTurnStatus))
    && isPageletRuntimeCode(value.providerStopReason)
    && PAGELET_FINAL_TEXT_STATES.has(value.finalTextState)
    && PAGELET_CITATION_COVERAGE_STATES.has(value.citationCoverage)
    && Number.isSafeInteger(value.turnCount)
    && value.turnCount >= 0
    && Number.isSafeInteger(value.toolCallCount)
    && value.toolCallCount >= 0
    && Number.isSafeInteger(value.insightDraftCount)
    && value.insightDraftCount >= 0
    && (value.emptyFinalAnswerRetryCount === 0
      || value.emptyFinalAnswerRetryCount === 1);
}

function pageletSourceBindingValid(value) {
  return hasExactKeys(value, PAGELET_SOURCE_BINDING_KEYS)
    && value.schemaVersion === 2
    && Number.isSafeInteger(value.sequence)
    && value.sequence > 0
    && Number.isSafeInteger(value.controllerSequence)
    && value.controllerSequence > 0
    && isPageletInsightId(value.runId)
    && isPageletInsightId(value.resultId)
    && value.triggerReason === "explicit"
    && value.force === true
    && PAGELET_RESULT_STATUSES.has(value.resultStatus)
    && (value.reason === null || typeof value.reason === "string")
    && pageletRuntimeCompletionValid(value.runtimeCompletion)
    && (!["quiet", "verified"].includes(value.resultStatus)
      || value.runtimeCompletion !== null)
    && (value.collectionId === null || isPageletInsightId(value.collectionId));
}

function projectPerformanceWorkloadContractForReceipt(workload) {
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
    prompts: Object.keys(PERFORMANCE_WORKLOAD_PROMPT_SHAPES).sort().map((id) => ({
      id,
      expectedShape: workload.prompts[id].expectedShape,
    })),
    qualificationIds: [...workload.qualification.requiredBeforeEnvelope],
    stages: Object.fromEntries(Object.keys(PERFORMANCE_WORKLOAD_STAGE_COUNTS).map((stage) => [
      stage,
      {
        expectedCount: PERFORMANCE_WORKLOAD_STAGE_COUNTS[stage],
        promptId: PERFORMANCE_WORKLOAD_STAGE_PROMPTS[stage],
        sampleClasses: [...new Set(
          workload.stages[stage].map((segment) => segment.sampleClass),
        )],
      },
    ])),
  };
}

function projectDevicePlanForReceipt(plan) {
  return {
    ...plan,
    performanceWorkload: projectPerformanceWorkloadContractForReceipt(
      plan.performanceWorkload,
    ),
  };
}

function reconstructFrozenDevicePlanFromReceipt(plan, measurement) {
  if (!isObject(plan)
    || !isObject(measurement)
    || !isObject(measurement.metrics)
    || !isObject(measurement.rerankerGate)) return null;
  const rebuildMetrics = (definitions, required) => {
    if (!Array.isArray(definitions)) return null;
    const rebuilt = [];
    for (const definition of definitions) {
      const recorded = measurement.metrics[definition?.id];
      if (!isObject(definition)
        || !isObject(recorded)
        || !isObject(recorded.threshold)
        || recorded.id !== definition.id
        || recorded.unit !== definition.unit
        || recorded.sampleMode !== definition.sampleMode
        || recorded.collectionMethod !== (definition.collectionMethod ?? null)
        || recorded.required !== required) return null;
      rebuilt.push({ ...definition, threshold: recorded.threshold });
    }
    return rebuilt;
  };
  const requiredMetrics = rebuildMetrics(plan.requiredMetrics, true);
  const optionalMetrics = rebuildMetrics(plan.optionalMetrics, false);
  if (!requiredMetrics || !optionalMetrics) return null;
  const externalBinding = measurement.runtimeEnvelope?.externalMemoryEnvelope;
  const externalDeviceIdentitySha256 = isObject(externalBinding)
    ? externalBinding.deviceIdentitySha256
    : plan.externalMemoryEvidence?.deviceIdentitySha256 ?? null;
  return {
    version: plan.version,
    percentileMethod: plan.percentileMethod,
    warmupSamples: plan.warmupSamples,
    sampleCount: plan.sampleCount,
    diagnosticsEvidence: plan.diagnosticsEvidence,
    performanceWorkload: plan.performanceWorkload,
    externalMemoryEvidence: {
      ...plan.externalMemoryEvidence,
      deviceIdentitySha256: externalDeviceIdentitySha256,
    },
    requiredMetrics,
    optionalMetrics,
    rerankerGate: {
      minimumMrr: measurement.rerankerGate.minimumMrr,
      flagOffBaselineMrr: measurement.rerankerGate.flagOffBaselineMrr,
      maximumMrrRegression: measurement.rerankerGate.maximumMrrRegression,
    },
  };
}

function expandPerformanceWorkload(manifest, state) {
  const plan = manifest?.deviceMeasurementPlan;
  const diagnostics = plan?.diagnosticsEvidence;
  const workload = plan?.performanceWorkload;
  const invalid = () => integrity(state, "manifest_performance_workload_invalid");
  if (!isObject(plan)
    || plan.version !== "b125-device-measurement-v9"
    || plan.percentileMethod !== "nearest-rank"
    || plan.warmupSamples !== 3
    || plan.sampleCount !== 20
    || !isObject(diagnostics)
    || diagnostics.schemaVersion !== 1
    || diagnostics.sessionIsolation
      !== "standard-performance-then-two-retry-batches-then-cancellation-probe"
    || diagnostics.standardPerformanceEpisodeCount !== 23
    || diagnostics.retryPerformanceEpisodeCount !== 23
    || JSON.stringify(diagnostics.retryPerformanceBatchEpisodeCounts)
      !== JSON.stringify([12, 11])
    || diagnostics.cancellationProbeEpisodeCount !== 1
    || diagnostics.maximumMemorySearchAttemptsPerEpisode !== 2
    || diagnostics.requiredSessionCapacity !== 512
    || diagnostics.performanceSurface !== "chat") {
    integrity(state, "manifest_device_measurement_plan_invalid");
    return null;
  }
  if (!hasExactKeys(workload, [
    "schemaVersion", "conversationPolicy", "fixtureCase", "prompts", "qualification", "stages",
  ])
    || workload.schemaVersion !== PERFORMANCE_WORKLOAD_SCHEMA_VERSION
    || workload.conversationPolicy !== PERFORMANCE_WORKLOAD_CONVERSATION_POLICY) {
    invalid();
    return null;
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
    || fixtureCase.wave1GraphHubPath !== "retrieval-smoke/performance/212-wave1-graph-hub.md"
    || JSON.stringify(fixtureCase.wave2FreshDirectPaths) !== JSON.stringify([
      "retrieval-smoke/performance/220-wave2-target.md",
      "retrieval-smoke/performance/221-wave2-helper.md",
    ])
    || fixtureCase.wave2GraphHubPath !== "retrieval-smoke/performance/222-wave2-graph-hub.md"
    || fixtureCase.requiredDisconnectedWaves !== true) {
    invalid();
    return null;
  }

  if (!hasExactKeys(workload.prompts, Object.keys(PERFORMANCE_WORKLOAD_PROMPT_SHAPES))) {
    invalid();
    return null;
  }
  for (const [id, expectedShape] of Object.entries(PERFORMANCE_WORKLOAD_PROMPT_SHAPES)) {
    const prompt = workload.prompts[id];
    if (!hasExactKeys(prompt, ["text", "expectedShape"])
      || typeof prompt.text !== "string"
      || prompt.text !== PERFORMANCE_WORKLOAD_PROMPT_TEXTS[id]
      || prompt.expectedShape !== expectedShape) {
      invalid();
      return null;
    }
  }
  if (!hasExactKeys(workload.qualification, ["requiredBeforeEnvelope"])
    || JSON.stringify(workload.qualification.requiredBeforeEnvelope)
      !== JSON.stringify(PERFORMANCE_WORKLOAD_QUALIFICATION_IDS)) {
    invalid();
    return null;
  }
  if (!hasExactKeys(workload.stages, Object.keys(PERFORMANCE_WORKLOAD_STAGE_COUNTS))) {
    invalid();
    return null;
  }
  if (canonicalJson(workload.stages)
    !== canonicalJson(PERFORMANCE_WORKLOAD_STAGE_SEGMENTS)) {
    invalid();
    return null;
  }

  const sequence = [];
  const ids = new Set();
  for (const stage of Object.keys(PERFORMANCE_WORKLOAD_STAGE_COUNTS)) {
    const segments = workload.stages[stage];
    if (!Array.isArray(segments) || segments.length === 0) {
      invalid();
      return null;
    }
    for (const segment of segments) {
      const isSingle = Object.hasOwn(segment ?? {}, "id");
      const expectedKeys = isSingle
        ? ["id", "sampleClass", "promptId"]
        : ["idPrefix", "from", "to", "pad", "sampleClass", "promptId"];
      if (!hasExactKeys(segment, expectedKeys)
        || !PERFORMANCE_WORKLOAD_STAGE_CLASSES[stage].has(segment.sampleClass)
        || segment.promptId !== PERFORMANCE_WORKLOAD_STAGE_PROMPTS[stage]) {
        invalid();
        return null;
      }
      const segmentIds = isSingle
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
        invalid();
        return null;
      }
      for (const id of segmentIds) {
        ids.add(id);
        sequence.push({
          id,
          stage,
          sampleClass: segment.sampleClass,
          promptId: segment.promptId,
        });
      }
    }
    if (sequence.filter((entry) => entry.stage === stage).length
      !== PERFORMANCE_WORKLOAD_STAGE_COUNTS[stage]) {
      invalid();
      return null;
    }
  }
  if (sequence.length !== 47 || ids.size !== sequence.length) {
    invalid();
    return null;
  }
  return {
    workload,
    sequence,
    contractSha256: sha256(canonicalJson(
      projectPerformanceWorkloadContractForReceipt(workload),
    )),
    sequenceSha256: sha256(canonicalJson(sequence)),
  };
}

function expandCompactProxyWorkload(manifest, state) {
  const plan = manifest?.compactProxyPlan;
  const invalid = (code = "manifest_compact_proxy_plan_invalid") => {
    integrity(state, code);
    return null;
  };
  if (!hasExactKeys(plan, [
    "schemaVersion", "version", "profile", "machineStatus", "completionStatus",
    "conversationPolicy", "performanceSurface", "requiredPlatformClass",
    "requiredRuntimeFamily", "deviceIdentityPolicy", "settingsPhases", "hardBudgets", "workload",
    "requiredMaintenance", "maintenanceOperations", "requiredResourceMetrics", "optionalResourceMetrics",
    "independentCorrectnessSlices",
  ])
    || plan.schemaVersion !== 1
    || plan.version !== COMPACT_PROXY_PLAN_VERSION
    || plan.profile !== COMPACT_PROXY_PROFILE
    || plan.machineStatus !== COMPACT_PROXY_MACHINE_STATUS
    || plan.completionStatus !== COMPACT_PROXY_COMPLETION_STATUS
    || plan.conversationPolicy !== "fresh-chat-per-episode"
    || plan.performanceSurface !== "chat"
    || plan.requiredPlatformClass !== "ios-real-device"
    || plan.requiredRuntimeFamily !== "ios-wkwebview"
    || plan.deviceIdentityPolicy !== "operator-provided-sha256"
    || !hasExactKeys(plan.settingsPhases, ["control", "evaluated", "requiredTransitionCount"])
    || canonicalJson(plan.settingsPhases.control)
      !== canonicalJson(COMPACT_PROXY_FLAG_PROFILE.control)
    || canonicalJson(plan.settingsPhases.evaluated)
      !== canonicalJson(COMPACT_PROXY_FLAG_PROFILE.evaluated)
    || plan.settingsPhases.requiredTransitionCount !== 1
    || canonicalJson(plan.hardBudgets) !== canonicalJson(COMPACT_PROXY_HARD_BUDGETS)
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
    ])) return invalid();

  const workload = plan.workload;
  if (!hasExactKeys(workload, [
    "schemaVersion", "fixtureCaseId", "prompts", "stages",
  ])
    || workload.schemaVersion !== 1
    || workload.fixtureCaseId !== "perf-full-graph-two-wave-v1"
    || !hasExactKeys(workload.prompts, Object.keys(PERFORMANCE_WORKLOAD_PROMPT_TEXTS))
    || !hasExactKeys(workload.stages, Object.keys(COMPACT_PROXY_STAGE_COUNTS))
    || canonicalJson(workload.stages) !== canonicalJson(COMPACT_PROXY_STAGE_SEGMENTS)) {
    return invalid("manifest_compact_proxy_workload_invalid");
  }
  for (const [promptId, text] of Object.entries(PERFORMANCE_WORKLOAD_PROMPT_TEXTS)) {
    if (!hasExactKeys(workload.prompts[promptId], ["text"])
      || workload.prompts[promptId].text !== text) {
      return invalid("manifest_compact_proxy_workload_invalid");
    }
  }

  const sequence = [];
  const ids = new Set();
  for (const [stage, expectedCount] of Object.entries(COMPACT_PROXY_STAGE_COUNTS)) {
    for (const segment of workload.stages[stage]) {
      const isSingle = Object.hasOwn(segment, "id");
      const segmentIds = isSingle
        ? [segment.id]
        : Array.from({ length: segment.to - segment.from + 1 }, (_, offset) => (
          `${segment.idPrefix}${String(segment.from + offset).padStart(segment.pad, "0")}`
        ));
      for (const id of segmentIds) {
        if (typeof id !== "string"
          || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id)
          || ids.has(id)) return invalid("manifest_compact_proxy_workload_invalid");
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
    if (sequence.filter((entry) => entry.stage === stage).length !== expectedCount) {
      return invalid("manifest_compact_proxy_workload_invalid");
    }
  }
  if (sequence.length !== 33 || ids.size !== 33) {
    return invalid("manifest_compact_proxy_workload_invalid");
  }
  return {
    plan,
    sequence,
    planSha256: sha256(canonicalJson(plan)),
    contractSha256: sha256(canonicalJson(workload)),
    sequenceSha256: sha256(canonicalJson(sequence)),
  };
}

function inspectWorkloadBinding(receipt, manifest, state) {
  const start = checkpoint(state);
  const binding = receipt?.deviceMeasurement?.workloadBinding;
  const receiptStatus = receipt?.overall;
  const requiresPass = receiptStatus === "PASS"
    && receipt?.fixtureVersion === manifest?.fixtureVersion;
  const contract = expandPerformanceWorkload(manifest, state);
  const pending = (code) => {
    if (requiresPass) integrity(state, code);
    else blocker(state, code);
  };
  if (!contract || !isObject(binding)) {
    pending("app_performance_workload_binding_missing");
    return { status: resultStatus(state, start) };
  }
  if (!hasExactKeys(binding, [
    "schemaVersion", "status", "contractSha256", "sequenceSha256", "bindingSha256",
    "expectedEpisodeCount", "boundEpisodeCount", "violationCount", "qualification",
    "stages", "episodes",
  ])
    || binding.schemaVersion !== PERFORMANCE_WORKLOAD_SCHEMA_VERSION
    || !["PENDING", "PASS", "INVALID"].includes(binding.status)
    || binding.contractSha256 !== contract.contractSha256
    || binding.sequenceSha256 !== contract.sequenceSha256
    || binding.expectedEpisodeCount !== contract.sequence.length
    || !Number.isSafeInteger(binding.boundEpisodeCount)
    || binding.boundEpisodeCount < 0
    || binding.boundEpisodeCount > contract.sequence.length
    || !Number.isSafeInteger(binding.violationCount)
    || binding.violationCount < 0
    || !Array.isArray(binding.episodes)) {
    integrity(state, "app_performance_workload_binding_schema_invalid");
    return { status: resultStatus(state, start) };
  }

  const validateEntry = (entry, expected, sequence) => hasExactKeys(entry, [
    "id", "stage", "sampleClass", "sequence", "status", "opaqueCorrelationSha256",
    "evidenceBindingSha256",
  ])
    && entry.id === expected.id
    && entry.stage === expected.stage
    && entry.sampleClass === expected.sampleClass
    && entry.sequence === sequence
    && entry.status === "PASS"
    && isSha256(entry.opaqueCorrelationSha256)
    && isSha256(entry.evidenceBindingSha256);

  const qualification = binding.qualification;
  const qualificationExpected = PERFORMANCE_WORKLOAD_QUALIFICATION_IDS.map((promptId) => ({
    id: `qualification-${promptId}`,
    stage: "qualification",
    sampleClass: "qualification",
  }));
  if (!hasExactKeys(qualification, [
    "status", "requiredCount", "boundCount", "violationCount", "bindingSha256", "entries",
  ])
    || !["PENDING", "PASS", "INVALID"].includes(qualification.status)
    || qualification.requiredCount !== qualificationExpected.length
    || !Number.isSafeInteger(qualification.boundCount)
    || qualification.boundCount < 0
    || qualification.boundCount > qualificationExpected.length
    || !Number.isSafeInteger(qualification.violationCount)
    || qualification.violationCount < 0
    || !Array.isArray(qualification.entries)
    || qualification.entries.length !== qualification.boundCount
    || qualification.entries.some((entry, index) => (
      !validateEntry(entry, qualificationExpected[index], index + 1)
    ))
    || qualification.bindingSha256 !== sha256(canonicalJson(qualification.entries))) {
    integrity(state, "app_performance_qualification_binding_invalid");
  }

  const expectedVisibleSequence = contract.sequence.map(({ id, stage, sampleClass }) => ({
    id,
    stage,
    sampleClass,
  }));
  if (binding.episodes.length !== binding.boundEpisodeCount
    || binding.episodes.some((entry, index) => (
      !validateEntry(entry, expectedVisibleSequence[index], index + 1)
    ))) {
    integrity(state, "app_performance_episode_binding_invalid");
  }
  const opaqueCorrelations = [
    ...(Array.isArray(qualification?.entries) ? qualification.entries : []),
    ...binding.episodes,
  ].map((entry) => entry?.opaqueCorrelationSha256);
  if (new Set(opaqueCorrelations).size !== opaqueCorrelations.length) {
    integrity(state, "app_performance_opaque_correlation_reused");
  }

  if (!hasExactKeys(binding.stages, Object.keys(PERFORMANCE_WORKLOAD_STAGE_COUNTS))) {
    integrity(state, "app_performance_stage_binding_invalid");
  } else {
    for (const [stage, expectedCount] of Object.entries(PERFORMANCE_WORKLOAD_STAGE_COUNTS)) {
      const summary = binding.stages[stage];
      const boundCount = binding.episodes.filter((entry) => entry?.stage === stage).length;
      if (!hasExactKeys(summary, ["status", "expectedCount", "boundCount", "violationCount"])
        || !["PENDING", "PASS", "INVALID"].includes(summary.status)
        || summary.expectedCount !== expectedCount
        || summary.boundCount !== boundCount
        || !Number.isSafeInteger(summary.violationCount)
        || summary.violationCount < 0) {
        integrity(state, `app_performance_stage_binding_invalid:${stage}`);
      }
    }
  }

  const aggregate = {
    qualificationBindingSha256: qualification?.bindingSha256,
    episodeBindingSha256: sha256(canonicalJson(binding.episodes)),
  };
  if (binding.bindingSha256 !== sha256(canonicalJson(aggregate))) {
    integrity(state, "app_performance_workload_binding_hash_mismatch");
  }

  if (binding.status === "INVALID" || qualification?.status === "INVALID") {
    failure(state, "app_performance_workload_invalid");
  } else if (binding.status !== "PASS") {
    pending("app_performance_workload_not_pass");
  }
  const passInvariantValid = binding.boundEpisodeCount === binding.expectedEpisodeCount
    && binding.violationCount === 0
    && qualification?.status === "PASS"
    && qualification?.boundCount === qualification?.requiredCount
    && qualification?.violationCount === 0
    && Object.values(binding.stages ?? {}).every((summary) => (
      summary?.status === "PASS"
      && summary?.boundCount === summary?.expectedCount
      && summary?.violationCount === 0
    ));
  if (binding.status === "PASS" && !passInvariantValid) {
    integrity(state, "app_performance_workload_pass_invariant_invalid");
  }
  if (requiresPass && binding.status !== "PASS") {
    integrity(state, "app_performance_workload_pass_invariant_invalid");
  }
  return {
    status: resultStatus(state, start),
    bindingStatus: binding.status,
    expectedEpisodeCount: binding.expectedEpisodeCount,
    boundEpisodeCount: binding.boundEpisodeCount,
    qualificationStatus: qualification?.status ?? null,
    violationCount: binding.violationCount,
  };
}

function compactSourceBindingValid(sourceBinding, finalSources) {
  return hasExactKeys(sourceBinding, [
    "evidenceSource", "exactPromptMatched", "turnStatus",
    "successfulSearchMemoryToolResultCount", "selectedMemorySourceCount",
    "memorySourceRecordPathCount", "allowedMemorySourcePathCount", "sourceSetsMatch",
    "opaqueRunCorrelationSha256", "diagnosticsRunMatched",
  ])
    && sourceBinding.evidenceSource === "sidellm-view.chatHistory"
    && sourceBinding.exactPromptMatched === true
    && sourceBinding.turnStatus === "completed"
    && Number.isSafeInteger(sourceBinding.successfulSearchMemoryToolResultCount)
    && sourceBinding.successfulSearchMemoryToolResultCount > 0
    && sourceBinding.selectedMemorySourceCount === finalSources.length
    && sourceBinding.memorySourceRecordPathCount === finalSources.length
    && sourceBinding.allowedMemorySourcePathCount === finalSources.length
    && sourceBinding.sourceSetsMatch === true
    && isSha256(sourceBinding.opaqueRunCorrelationSha256)
    && sourceBinding.diagnosticsRunMatched === true;
}

function inspectCompactCorrectnessSlices(receipt, manifest, state) {
  const start = checkpoint(state);
  const compactTransition = receipt.compactProxy?.settingsTransition;
  const compactCorrectnessTimestampValid = (recordedAt) => (
    isCanonicalIsoTimestamp(compactTransition?.transitionedAt)
    && recordedAt >= compactTransition.transitionedAt
    && (compactTransition.cleanup?.status !== "PASS"
      || (isCanonicalIsoTimestamp(compactTransition.cleanup.restoredAt)
        && recordedAt <= compactTransition.cleanup.restoredAt))
  );
  const requiredRankingIds = manifest?.requiredRankingCases;
  const rankingCases = receipt?.rankingCases;
  const reranker = receipt?.rerankerMetrics;
  if (!Array.isArray(requiredRankingIds)
    || requiredRankingIds.length !== 6
    || new Set(requiredRankingIds).size !== 6) {
    integrity(state, "manifest_compact_proxy_ranking_contract_invalid");
  } else if (!hasExactKeys(rankingCases, requiredRankingIds)) {
    integrity(state, "app_compact_proxy_ranking_evidence_schema_invalid");
  } else {
    let rankingComplete = true;
    const rankingEntries = [];
    for (const id of requiredRankingIds) {
      const definition = manifest?.rankingCases?.[id];
      const entry = rankingCases[id];
      if (!hasExactKeys(entry, [
        "id", "status", "rankedSources", "relevantRank", "reciprocalRank",
        "invalidSourceCount", "forbiddenHitCount", "evidence", "recordedAt",
      ]) || entry.id !== id) {
        integrity(state, `app_compact_proxy_ranking_case_schema_invalid:${id}`);
        rankingComplete = false;
        continue;
      }
      rankingEntries.push(entry);
      if (entry.status === "PENDING") {
        if (!Array.isArray(entry.rankedSources)
          || entry.rankedSources.length !== 0
          || entry.relevantRank !== null
          || entry.reciprocalRank !== 0
          || entry.invalidSourceCount !== 0
          || entry.forbiddenHitCount !== 0
          || entry.evidence !== null
          || entry.recordedAt !== null) {
          integrity(state, `app_compact_proxy_ranking_case_pending_invariant_invalid:${id}`);
        }
        rankingComplete = false;
        continue;
      }
      if (entry.status === "FAIL") {
        failure(state, `app_compact_proxy_ranking_case_failed:${id}`);
        continue;
      }
      if (entry.status !== "PASS") {
        integrity(state, `app_compact_proxy_ranking_case_status_invalid:${id}`);
        rankingComplete = false;
        continue;
      }
      const rankedSources = entry.rankedSources;
      const evidence = entry.evidence;
      const topology = evidence?.topology;
      const standardMemoryOutcomes = Array.isArray(topology?.standardMemoryOutcomes)
        ? topology.standardMemoryOutcomes : [];
      const standardMemoryReasons = Array.isArray(topology?.standardMemoryReasons)
        ? topology.standardMemoryReasons : [];
      const standardMemoryDocumentCounts = Array.isArray(topology?.standardMemoryDocumentCounts)
        ? topology.standardMemoryDocumentCounts : [];
      const standardOutcomes = Array.isArray(topology?.standardOutcomes)
        ? topology.standardOutcomes : [];
      const standardReasons = Array.isArray(topology?.standardReasons)
        ? topology.standardReasons : [];
      const standardDocumentCounts = Array.isArray(topology?.standardDocumentCounts)
        ? topology.standardDocumentCounts : [];
      const visibleMemoryResultDocumentCounts = Array.isArray(
        topology?.visibleMemoryResultDocumentCounts,
      ) ? topology.visibleMemoryResultDocumentCounts : [];
      const validCompletedDocumentTuple = (outcome, reason, documentCount) => (
        outcome === "completed"
        && Number.isSafeInteger(documentCount)
        && documentCount >= 0
        && (documentCount === 0 ? reason === "semantic_none" : reason === null)
      );
      const standardTopologyValid = [
        standardMemoryOutcomes,
        standardMemoryReasons,
        standardMemoryDocumentCounts,
        standardOutcomes,
        standardReasons,
        standardDocumentCounts,
      ].every((values) => values.length === evidence?.standardCallCount)
        && standardMemoryDocumentCounts.every((count, index) => (
          validCompletedDocumentTuple(
            standardMemoryOutcomes[index],
            standardMemoryReasons[index],
            count,
          )
          && validCompletedDocumentTuple(
            standardOutcomes[index],
            standardReasons[index],
            standardDocumentCounts[index],
          )
          && count === standardDocumentCounts[index]
        ));
      const totalVisibleDocumentCount = visibleMemoryResultDocumentCounts.reduce((sum, count) => (
        sum + (Number.isSafeInteger(count) ? count : 0)
      ), 0);
      const visibleMemoryResultCountsValid = visibleMemoryResultDocumentCounts.length
        === evidence?.standardCallCount
        && visibleMemoryResultDocumentCounts.every((count) => (
          Number.isSafeInteger(count) && count >= 0
        ));
      const standardOnlyTopologyValid = evidence?.relaxedRetryCount === 0
        && topology?.relaxedMemoryOutcome === null
        && topology?.relaxedMemoryReason === null
        && topology?.relaxedMemoryDocumentCount === null
        && topology?.relaxedTerminalCount === 0
        && topology?.relaxedOutcome === null
        && topology?.relaxedReason === null
        && topology?.relaxedDocumentCount === null
        && topology?.retryConsumed === false
        && topology?.projectionStartedCount === 0
        && topology?.projectionCompletedCount === 0
        && topology?.projectionOutcome === null
        && topology?.projectionReason === null
        && topology?.projectionDocumentCount === null
        && topology?.relaxedAfterStandardCallIndex === null
        && visibleMemoryResultCountsValid
        && visibleMemoryResultDocumentCounts.every((count, index) => (
          count === standardMemoryDocumentCounts[index]
        ));
      const relaxedAfterStandardCallIndex = topology?.relaxedAfterStandardCallIndex;
      const relaxedTopologyValid = evidence?.relaxedRetryCount === 1
        && [1, 2].includes(evidence?.standardCallCount)
        && Number.isSafeInteger(relaxedAfterStandardCallIndex)
        && relaxedAfterStandardCallIndex >= 0
        && relaxedAfterStandardCallIndex < evidence.standardCallCount
        && validCompletedDocumentTuple(
          topology?.relaxedMemoryOutcome,
          topology?.relaxedMemoryReason,
          topology?.relaxedMemoryDocumentCount,
        )
        && topology?.relaxedTerminalCount === 1
        && validCompletedDocumentTuple(
          topology?.relaxedOutcome,
          topology?.relaxedReason,
          topology?.relaxedDocumentCount,
        )
        && topology?.relaxedMemoryDocumentCount === topology?.relaxedDocumentCount
        && topology?.retryConsumed === true
        && topology?.projectionStartedCount === 1
        && topology?.projectionCompletedCount === 1
        && validCompletedDocumentTuple(
          topology?.projectionOutcome,
          topology?.projectionReason,
          topology?.projectionDocumentCount,
        )
        && topology?.projectionDocumentCount > 0
        && topology?.projectionDocumentCount
          <= standardMemoryDocumentCounts[relaxedAfterStandardCallIndex]
            + topology?.relaxedMemoryDocumentCount
        && visibleMemoryResultCountsValid
        && visibleMemoryResultDocumentCounts.every((count, index) => (
          count === (index === relaxedAfterStandardCallIndex
            ? topology.projectionDocumentCount
            : standardMemoryDocumentCounts[index])
        ));
      const finalDocumentCountValid = Number.isSafeInteger(evidence?.finalDocumentCount)
        && evidence.finalDocumentCount > 0
        && evidence.finalDocumentCount <= 8
        && visibleMemoryResultCountsValid
        && evidence.finalDocumentCount <= totalVisibleDocumentCount
        && evidence.finalDocumentCount >= Math.max(...visibleMemoryResultDocumentCounts)
        && (evidence?.standardCallCount !== 1
          || evidence.finalDocumentCount === visibleMemoryResultDocumentCounts[0]);
      const rankingTopologyValid = hasExactKeys(topology, [
        "droppedEventCount", "episodeCount", "unscopedEventCount",
        "surfaceMismatchEventCount", "episodeComplete", "hasCancellationEvidence",
        "invocationOrdinalBindingValid", "standardInvocationOrdinals",
        "standardMemoryOutcomes", "standardMemoryReasons", "standardMemoryDocumentCounts",
        "standardOutcomes", "standardReasons", "standardDocumentCounts",
        "relaxedMemoryOutcome", "relaxedMemoryReason", "relaxedMemoryDocumentCount",
        "relaxedAfterStandardCallIndex",
        "relaxedTerminalCount", "relaxedOutcome", "relaxedReason", "relaxedDocumentCount",
        "retryConsumed", "projectionStartedCount", "projectionCompletedCount",
        "projectionOutcome", "projectionReason", "projectionDocumentCount",
        "visibleMemoryResultDocumentCounts",
      ])
        && topology.droppedEventCount === 0
        && topology.episodeCount === 1
        && topology.unscopedEventCount === 0
        && topology.surfaceMismatchEventCount === 0
        && topology.episodeComplete === true
        && topology.hasCancellationEvidence === false
        && topology.invocationOrdinalBindingValid === true
        && Array.isArray(topology.standardInvocationOrdinals)
        && topology.standardInvocationOrdinals.length === evidence?.standardCallCount
        && topology.standardInvocationOrdinals.every((ordinal, index) => ordinal === index)
        && standardTopologyValid
        && (standardOnlyTopologyValid || relaxedTopologyValid);
      const excludedFolders = Array.isArray(manifest?.excludedFolders)
        ? manifest.excludedFolders : [];
      const structurallyValid = Array.isArray(rankedSources)
        && rankedSources.length > 0
        && rankedSources.length <= 8
        && new Set(rankedSources).size === rankedSources.length
        && rankedSources[0] === definition?.relevantPath
        && rankedSources.every((path) => (
          typeof path === "string"
          && isSha256(manifest?.files?.[path])
          && !excludedFolders.some((folder) => path.startsWith(`${folder}/`))
        ))
        && !rankedSources.some((path) => (
          definition?.forbiddenPaths?.includes(path)
          || path === "[opaque-redacted]"
          || path === "[nonfixture-redacted]"
        ))
        && entry.relevantRank === 1
        && entry.reciprocalRank === 1
        && entry.invalidSourceCount === 0
        && entry.forbiddenHitCount === 0
        && hasExactKeys(evidence, [
          "compactProxyPlanSha256", "startSequence", "endSequence", "finalDocumentCount",
          "standardCallCount", "relaxedRetryCount", "memoryAttemptCount",
          "topology", "sourceBinding", "evidenceSha256",
        ])
        && evidence.compactProxyPlanSha256 === receipt.compactProxy?.planSha256
        && Number.isSafeInteger(evidence.startSequence)
        && evidence.startSequence > 0
        && Number.isSafeInteger(evidence.endSequence)
        && evidence.endSequence >= evidence.startSequence
        && finalDocumentCountValid
        && evidence.finalDocumentCount >= rankedSources.length
        && [1, 2].includes(evidence.standardCallCount)
        && [0, 1].includes(evidence.relaxedRetryCount)
        && evidence.memoryAttemptCount
          === evidence.standardCallCount + evidence.relaxedRetryCount
        && evidence.sourceBinding.successfulSearchMemoryToolResultCount
          === evidence.standardCallCount
        && rankingTopologyValid
        && compactSourceBindingValid(evidence.sourceBinding, rankedSources)
        && isSha256(evidence.evidenceSha256)
        && isCanonicalIsoTimestamp(entry.recordedAt);
      if (!structurallyValid) {
        integrity(state, `app_compact_proxy_ranking_case_pass_invariant_invalid:${id}`);
      } else {
        validateTimestampInWindow(
          state,
          entry.recordedAt,
          receipt.startedAt,
          receipt.finishedAt,
          `app_compact_proxy_ranking_case:${id}`,
        );
        if (!compactCorrectnessTimestampValid(entry.recordedAt)) {
          integrity(state, `app_compact_proxy_ranking_case_order_invalid:${id}`);
        }
      }
    }
    if (!rankingComplete) blocker(state, "app_compact_proxy_ranking_evidence_missing");
    const completedEntries = rankingEntries.filter((entry) => entry.status !== "PENDING");
    const recalled = completedEntries.filter((entry) => entry.relevantRank !== null).length;
    const expectedAggregate = {
      completed: completedEntries.length,
      required: 6,
      recallAt8: Number((recalled / 6).toFixed(6)),
      mrr: Number((completedEntries.reduce((sum, entry) => (
        sum + entry.reciprocalRank
      ), 0) / 6).toFixed(6)),
      forbiddenHitCount: completedEntries.reduce((sum, entry) => (
        sum + entry.forbiddenHitCount
      ), 0),
    };
    const aggregateValid = rankingEntries.length === 6 && hasExactKeys(reranker, [
      "completed", "required", "recallAt8", "mrr", "forbiddenHitCount",
    ])
      && canonicalJson(reranker) === canonicalJson(expectedAggregate);
    if (!aggregateValid) {
      integrity(state, "app_compact_proxy_ranking_aggregate_invalid");
    }
  }

  const temporal = receipt?.temporalRetryCase;
  const temporalContract = manifest?.temporalRetryCase;
  const temporalPendingKeys = [
    "id", "status", "prompt", "timeRange", "targetPath", "forbiddenPath",
    "finalSources", "standardSources", "standardEvidenceMode", "targetPresent",
    "forbiddenHitCount", "invalidSourceCount", "duplicateSourceCount",
    "unexpectedSourceCount", "topology", "evidenceSha256", "detail", "recordedAt",
  ];
  const temporalRecordedKeys = [
    ...temporalPendingKeys.slice(0, 14), "sourceBinding",
    ...temporalPendingKeys.slice(14, 15), "compactProxyPlanSha256",
    ...temporalPendingKeys.slice(15),
  ];
  const temporalRecordedEnvelopeValid = (entry) => hasExactKeys(entry, temporalRecordedKeys)
    && entry.id === "temporal-retry"
    && entry.prompt === temporalContract?.prompt
    && canonicalJson(entry.timeRange) === canonicalJson(temporalContract?.timeRange)
    && entry.targetPath === temporalContract?.targetPath
    && entry.forbiddenPath === temporalContract?.forbiddenPath
    && isObject(entry.sourceBinding)
    && entry.compactProxyPlanSha256 === receipt.compactProxy?.planSha256
    && isSha256(entry.evidenceSha256)
    && typeof entry.detail === "string"
    && entry.detail.length > 0
    && isCanonicalIsoTimestamp(entry.recordedAt);
  if (!isObject(temporal)) {
    integrity(state, "app_compact_proxy_temporal_evidence_schema_invalid");
  } else if (temporal.status === "PENDING") {
    if (!hasExactKeys(temporal, temporalPendingKeys)
      || temporal.id !== "temporal-retry"
      || temporal.prompt !== temporalContract?.prompt
      || canonicalJson(temporal.timeRange) !== canonicalJson(temporalContract?.timeRange)
      || temporal.targetPath !== temporalContract?.targetPath
      || temporal.forbiddenPath !== temporalContract?.forbiddenPath
      || !Array.isArray(temporal.finalSources)
      || temporal.finalSources.length !== 0
      || !Array.isArray(temporal.standardSources)
      || temporal.standardSources.length !== 0
      || temporal.standardEvidenceMode !== null
      || temporal.targetPresent !== false
      || temporal.forbiddenHitCount !== 0
      || temporal.invalidSourceCount !== 0
      || temporal.duplicateSourceCount !== 0
      || temporal.unexpectedSourceCount !== 0
      || temporal.topology !== null
      || temporal.evidenceSha256 !== null
      || temporal.detail !== ""
      || temporal.recordedAt !== null) {
      integrity(state, "app_compact_proxy_temporal_pending_invariant_invalid");
    }
    blocker(state, "app_compact_proxy_temporal_evidence_missing");
  } else if (temporal.status === "BLOCKED") {
    if (!temporalRecordedEnvelopeValid(temporal)) {
      integrity(state, "app_compact_proxy_temporal_evidence_schema_invalid");
    }
    blocker(state, "app_compact_proxy_temporal_evidence_missing");
  } else if (temporal.status === "FAIL") {
    if (!temporalRecordedEnvelopeValid(temporal)) {
      integrity(state, "app_compact_proxy_temporal_evidence_schema_invalid");
    }
    failure(state, "app_compact_proxy_temporal_evidence_failed");
  } else {
    const topology = temporal.topology;
    const allowedStandardPaths = temporalContract?.standardInsufficientPaths;
    const allowedFinalPaths = Array.isArray(allowedStandardPaths)
      ? new Set([...allowedStandardPaths, temporalContract?.targetPath])
      : new Set();
    const standardEvidenceValid = topology?.standardEvidenceMode === "valid-none"
      ? topology.standardMemoryDocumentCount === 0
        && topology.standardDocumentCount === 0
        && temporal.standardSources?.length === 0
      : topology?.standardEvidenceMode === "strict-partial"
        ? Number.isSafeInteger(topology.standardMemoryDocumentCount)
          && topology.standardMemoryDocumentCount > 0
          && topology.standardDocumentCount === topology.standardMemoryDocumentCount
          && Array.isArray(temporal.standardSources)
          && temporal.standardSources.length > 0
          && temporal.standardSources.length <= topology.standardDocumentCount
        : false;
    const maximumSourceCount = temporalContract?.finalSourceContract?.maximumSourceCount;
    const projectionDocumentCountValid = Number.isSafeInteger(
      topology?.projectionDocumentCount,
    )
      && topology.projectionDocumentCount > 0
      && Array.isArray(temporal.finalSources)
      && topology.projectionDocumentCount >= temporal.finalSources.length
      && Number.isSafeInteger(maximumSourceCount)
      && topology.projectionDocumentCount <= maximumSourceCount
      && Number.isSafeInteger(topology.standardMemoryDocumentCount)
      && Number.isSafeInteger(topology.relaxedMemoryDocumentCount)
      && topology.projectionDocumentCount
        <= topology.standardMemoryDocumentCount + topology.relaxedMemoryDocumentCount
      && (topology.standardEvidenceMode !== "valid-none"
        || topology.projectionDocumentCount === topology.relaxedMemoryDocumentCount);
    const valid = hasExactKeys(temporal, temporalRecordedKeys)
      && temporal.id === "temporal-retry"
      && temporal.status === "PASS"
      && temporal.prompt === temporalContract?.prompt
      && canonicalJson(temporal.timeRange) === canonicalJson(temporalContract?.timeRange)
      && temporal.targetPath === temporalContract?.targetPath
      && temporal.forbiddenPath === temporalContract?.forbiddenPath
      && temporal.targetPresent === true
      && temporal.forbiddenHitCount === 0
      && temporal.invalidSourceCount === 0
      && temporal.duplicateSourceCount === 0
      && temporal.unexpectedSourceCount === 0
      && Array.isArray(temporal.finalSources)
      && temporal.finalSources.length > 0
      && temporal.finalSources.length <= temporalContract?.finalSourceContract?.maximumSourceCount
      && temporal.finalSources.includes(temporalContract?.targetPath)
      && !temporal.finalSources.includes(temporalContract?.forbiddenPath)
      && new Set(temporal.finalSources).size === temporal.finalSources.length
      && temporal.finalSources.every((path) => allowedFinalPaths.has(path))
      && Array.isArray(temporal.standardSources)
      && canonicalJson(temporal.standardSources) === canonicalJson(
        temporal.finalSources.filter((path) => allowedStandardPaths?.includes(path)),
      )
      && temporal.standardEvidenceMode === topology?.standardEvidenceMode
      && temporal.compactProxyPlanSha256 === receipt.compactProxy?.planSha256
      && compactSourceBindingValid(temporal.sourceBinding, temporal.finalSources)
      && standardEvidenceValid
      && hasExactKeys(topology, [
        "schemaVersion", "capacity", "droppedEventCount", "eventCount", "episodeCount",
        "unscopedEventCount", "surfaceMismatchEventCount", "memoryAttemptCount",
        "memoryTerminalCount", "standardMemoryDocumentCount", "relaxedMemoryDocumentCount",
        "standardEvidenceMode", "standardOutcome", "standardDocumentCount",
        "standardTemporalFilterApplied", "standardTemporalViolationCount",
        "relaxedMemoryOutcome", "relaxedRetryCount", "relaxedTerminalCount",
        "relaxedOutcome", "relaxedDocumentCount", "relaxedTemporalFilterApplied",
        "relaxedTemporalViolationCount", "retryConsumed", "projectionStartedCount",
        "projectionCompletedCount", "projectionOutcome", "projectionDocumentCount",
        "projectionTemporalFilterApplied", "projectionTemporalViolationCount",
      ])
      && topology.schemaVersion === 1
      && topology.capacity === 512
      && topology.droppedEventCount === 0
      && Number.isSafeInteger(topology.eventCount)
      && topology.eventCount > 0
      && topology.episodeCount === 1
      && topology.unscopedEventCount === 0
      && topology.surfaceMismatchEventCount === 0
      && topology.memoryAttemptCount === 2
      && topology.memoryTerminalCount === 2
      && topology.standardOutcome === "completed"
      && topology.standardTemporalFilterApplied === 1
      && topology.standardTemporalViolationCount === 0
      && topology.relaxedMemoryOutcome === "completed"
      && Number.isSafeInteger(topology.relaxedMemoryDocumentCount)
      && topology.relaxedMemoryDocumentCount > 0
      && topology.relaxedRetryCount === 1
      && topology.relaxedTerminalCount === 1
      && topology.relaxedOutcome === "completed"
      && Number.isSafeInteger(topology.relaxedDocumentCount)
      && topology.relaxedDocumentCount > 0
      && topology.relaxedDocumentCount === topology.relaxedMemoryDocumentCount
      && topology.relaxedTemporalFilterApplied === 1
      && topology.relaxedTemporalViolationCount === 0
      && topology.retryConsumed === true
      && topology.projectionStartedCount === 1
      && topology.projectionCompletedCount === 1
      && topology.projectionOutcome === "completed"
      && projectionDocumentCountValid
      && topology.projectionTemporalFilterApplied === 1
      && topology.projectionTemporalViolationCount === 0
      && isSha256(temporal.evidenceSha256)
      && typeof temporal.detail === "string"
      && temporal.detail.length > 0
      && isCanonicalIsoTimestamp(temporal.recordedAt);
    if (!valid) integrity(state, "app_compact_proxy_temporal_pass_invariant_invalid");
    else validateTimestampInWindow(
      state,
      temporal.recordedAt,
      receipt.startedAt,
      receipt.finishedAt,
      "app_compact_proxy_temporal",
    );
    if (valid && !compactCorrectnessTimestampValid(temporal.recordedAt)) {
      integrity(state, "app_compact_proxy_temporal_order_invalid");
    }
  }
  return { status: resultStatus(state, start) };
}

const COMPACT_PROXY_EPISODE_OBSERVATION_KEYS = Object.freeze([
  "memorySearchDurationMs", "outerTurnDurationMs", "lexicalDurationMs",
  "graphDurationMs", "graphWorkerDurationMs", "graphWorkerQueueWaitMs",
  "graphMaxBatchDurationMs", "finalizationReserveMs", "finalizationRemainingMs",
  "deadlineExceededCount",
  "cancelRequestedCount", "cancelObservedCount", "acceptedAfterCancelCount",
  "lateDiscardCount", "fallbackCount", "cancelToWorkerObservedMs",
  "cancelToLateDiscardedMs", "cancelToProbeCompletedMs",
  "queueReleaseProbeResultCount",
]);
const COMPACT_PROXY_STAGE_OBSERVATION_KEYS = Object.freeze([
  "memorySearchDurationMs", "outerTurnDurationMs", "lexicalDurationMs",
  "graphDurationMs", "graphWorkerDurationMs", "graphWorkerQueueWaitMs",
  "graphMaxBatchDurationMs", "finalizationReserveMs", "finalizationRemainingMs",
  "deadlineExceededCount",
  "cancelRequestedCount", "cancelObservedCount", "acceptedAfterCancelCount",
  "lateDiscardCount", "fallbackCount", "cancelToWorkerObservedMs",
  "cancelToLateDiscardedMs", "cancelToProbeCompletedMs",
  "queueReleaseProbeResultCount", "eventLoopStallMs", "estimatedDbBytes",
]);
const COMPACT_PROXY_COMPARISON_KEYS = Object.freeze([
  "standardMemorySearchDurationMs", "outerTurnDurationMs", "eventLoopStallMs",
  "estimatedDbBytes", "lexicalDurationMs", "graphDurationMs", "retryDurationMs",
  "rebuildDurationMs", "incrementalUpdateDurationMs",
]);
const COMPACT_PROXY_SHARED_COMPARISON_KEYS = new Set([
  "standardMemorySearchDurationMs", "outerTurnDurationMs", "eventLoopStallMs",
  "estimatedDbBytes",
]);
const COMPACT_PROXY_EXECUTION_MODES = Object.freeze({
  controlStandard: "direct-vector-control",
  evaluatedStandard: "full-graph",
  evaluatedRetry: "full-graph-retry",
  cancellationProbe: "same-worker-cancel",
});
const COMPACT_PROXY_STAGE_SAMPLE_COUNTS = Object.freeze({
  controlStandard: Object.freeze({ sampleCount: 6, warmupCount: 1, measuredCount: 5 }),
  evaluatedStandard: Object.freeze({ sampleCount: 13, warmupCount: 3, measuredCount: 10 }),
  evaluatedRetry: Object.freeze({ sampleCount: 13, warmupCount: 3, measuredCount: 10 }),
  cancellationProbe: Object.freeze({ sampleCount: 1, warmupCount: 0, measuredCount: 0 }),
});
const COMPACT_PROXY_COUNT_OBSERVATION_KEYS = new Set([
  "deadlineExceededCount", "cancelRequestedCount", "cancelObservedCount",
  "acceptedAfterCancelCount", "lateDiscardCount", "fallbackCount",
]);
const COMPACT_CANCELLATION_METRIC_KEYS = new Set([
  "durationMs", "remainingMs", "candidateCount", "cancelRequested", "cancelObserved",
  "acceptedCount", "lateDiscardCount", "resultCount",
]);

function compactNumericArray(value) {
  return Array.isArray(value)
    && value.every((entry) => Number.isFinite(entry) && entry >= 0);
}

function compactStatsValid(value) {
  if (!hasExactKeys(value, ["sampleCount", "p50", "p95", "minimum", "maximum"])
    || !Number.isSafeInteger(value.sampleCount)
    || value.sampleCount < 1
    || ![value.p50, value.p95, value.minimum, value.maximum].every((entry) => (
      Number.isFinite(entry) && entry >= 0
    ))) return false;
  return value.minimum <= value.p50
    && value.p50 <= value.p95
    && value.p95 <= value.maximum;
}

function compactStatsFromSamples(samples) {
  if (!compactNumericArray(samples) || samples.length === 0) return null;
  return {
    sampleCount: samples.length,
    p50: nearestRankPercentile(samples, 0.5),
    p95: nearestRankPercentile(samples, 0.95),
    minimum: Math.min(...samples),
    maximum: Math.max(...samples),
  };
}

function inspectCompactCancellationEvidence(entry, state) {
  const evidence = entry?.cancellationEvidence;
  const invalid = () => {
    integrity(state, "app_compact_proxy_cancellation_evidence_invalid");
    return null;
  };
  if (!hasExactKeys(evidence, [
    "schemaVersion", "runId", "surface", "graphQueueReleaseAbsoluteEnvelopeMs",
    "events", "evidenceSha256",
  ])
    || evidence.schemaVersion !== 1
    || typeof evidence.runId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(evidence.runId)
    || evidence.surface !== "chat"
    || evidence.graphQueueReleaseAbsoluteEnvelopeMs !== 8_000
    || !Array.isArray(evidence.events)
    || evidence.events.length !== 6
    || !isSha256(evidence.evidenceSha256)) return invalid();
  const core = {
    schemaVersion: evidence.schemaVersion,
    runId: evidence.runId,
    surface: evidence.surface,
    graphQueueReleaseAbsoluteEnvelopeMs: evidence.graphQueueReleaseAbsoluteEnvelopeMs,
    events: evidence.events,
  };
  if (evidence.evidenceSha256 !== sha256(canonicalJson(core))
    || entry.opaqueCorrelationSha256
      !== sha256(`retrieval-compact-proxy-run\u0000${evidence.runId}`)) return invalid();

  let priorSequence = 0;
  let priorElapsedMs = 0;
  for (const event of evidence.events) {
    if (!hasExactKeys(event, [
      "sequence", "elapsedMs", "phase", "outcome", "reason", "metrics",
    ])
      || !Number.isSafeInteger(event.sequence)
      || event.sequence <= priorSequence
      || !Number.isFinite(event.elapsedMs)
      || event.elapsedMs < priorElapsedMs
      || !isObject(event.metrics)
      || Object.entries(event.metrics).some(([key, value]) => (
        !COMPACT_CANCELLATION_METRIC_KEYS.has(key)
        || !Number.isFinite(value)
        || value < 0
      ))) return invalid();
    priorSequence = event.sequence;
    priorElapsedMs = event.elapsedMs;
  }
  const [workerStart, requested, queueStart, observed, late, queueCompleted] = evidence.events;
  const exactTopology = workerStart.phase === "graph_worker"
    && workerStart.outcome === "started"
    && workerStart.reason === null
    && requested.phase === "graph_worker"
    && requested.outcome === "aborted"
    && requested.reason === "cancel_requested"
    && requested.metrics.cancelRequested > 0
    && (requested.metrics.acceptedCount || 0) === 0
    && queueStart.phase === "queue_release"
    && queueStart.outcome === "started"
    && queueStart.reason === null
    && observed.phase === "graph_worker"
    && observed.outcome === "aborted"
    && observed.reason === "cancel_observed"
    && observed.metrics.cancelRequested > 0
    && observed.metrics.cancelObserved > 0
    && (observed.metrics.acceptedCount || 0) === 0
    && late.phase === "graph_worker"
    && late.outcome === "late_discarded"
    && late.reason === "late_result"
    && late.metrics.cancelRequested > 0
    && late.metrics.lateDiscardCount > 0
    && (late.metrics.acceptedCount || 0) === 0
    && queueCompleted.phase === "queue_release"
    && queueCompleted.outcome === "completed"
    && queueCompleted.reason === null
    && Number.isFinite(queueCompleted.metrics.durationMs)
    && queueCompleted.metrics.resultCount === 1;
  if (!exactTopology) return invalid();

  const derived = {
    cancelToWorkerObservedMs: observed.elapsedMs - requested.elapsedMs,
    cancelToLateDiscardedMs: late.elapsedMs - requested.elapsedMs,
    cancelToProbeCompletedMs: queueCompleted.elapsedMs - requested.elapsedMs,
    queueReleaseProbeResultCount: queueCompleted.metrics.resultCount,
  };
  if (!Object.values(derived).every((value) => Number.isFinite(value) && value >= 0)
    || derived.cancelToWorkerObservedMs > derived.cancelToLateDiscardedMs
    || derived.cancelToLateDiscardedMs > derived.cancelToProbeCompletedMs
    || derived.cancelToProbeCompletedMs > evidence.graphQueueReleaseAbsoluteEnvelopeMs) {
    return invalid();
  }
  for (const [key, value] of Object.entries(derived)) {
    if (entry.observations?.[key] !== value) return invalid();
  }
  return derived;
}

function inspectCompactProxyReceipt(receipt, manifest, state) {
  const start = checkpoint(state);
  const machineStart = checkpoint(state);
  const contract = expandCompactProxyWorkload(manifest, state);
  // A compact receipt must not weaken or relabel the separately retained v9 profile.
  expandPerformanceWorkload(manifest, state);
  const compact = receipt?.compactProxy;
  if (!contract || !hasExactKeys(compact, [
    "schemaVersion", "planVersion", "planSha256", "machineStatus", "status",
    "ownerDisposition", "deviceBinding", "settingsTransition", "workloadBinding", "metrics",
    "hardBudgets", "maintenance", "optionalDiagnostics",
  ])) {
    integrity(state, "app_compact_proxy_schema_invalid");
    return { status: resultStatus(state, start) };
  }
  if (compact.schemaVersion !== 1
    || compact.planVersion !== COMPACT_PROXY_PLAN_VERSION
    || compact.planSha256 !== contract.planSha256
    || receipt.identity?.compactProxyPlanSha256 !== contract.planSha256
    || compact.machineStatus !== COMPACT_PROXY_MACHINE_STATUS
    || !["PENDING", "BLOCKED", "INVALID", COMPACT_PROXY_COMPLETION_STATUS]
      .includes(compact.status)) {
    integrity(state, "app_compact_proxy_identity_invalid");
  }
  const compactRuntimeValid = receipt.runtime?.platformClass === contract.plan.requiredPlatformClass
    && receipt.runtime?.runtimeFamily === contract.plan.requiredRuntimeFamily;
  if (!compactRuntimeValid) {
    if (compact.status === COMPACT_PROXY_COMPLETION_STATUS) {
      integrity(state, "app_compact_proxy_ready_runtime_invalid");
    } else {
      blocker(state, "app_compact_proxy_required_runtime_missing");
    }
  }
  const compactAppIdentityValid = isSafeRuntimeToken(receipt.runtime?.appVersion)
    && receipt.runtime.appVersionSource === "obsidian.apiVersion"
    && receipt.runtime.loadedAppVersion === receipt.runtime.appVersion
    && receipt.runtime.loadedAppVersionSource === "obsidian.apiVersion"
    && ((isSafeRuntimeToken(receipt.runtime.shellVersion)
      && receipt.runtime.shellVersionSource === "navigator.userAgent:obsidian/x")
      || (receipt.runtime.shellVersion === null
        && receipt.runtime.shellVersionSource === null))
    && isSha256(receipt.runtime.appBuildIdentitySha256);
  if (!compactAppIdentityValid) {
    if (compact.status === COMPACT_PROXY_COMPLETION_STATUS) {
      integrity(state, "app_compact_proxy_ready_app_identity_invalid");
    } else {
      blocker(state, "app_compact_proxy_app_identity_missing");
    }
  }
  const deviceBinding = compact.deviceBinding;
  const expectedRuntimeIdentitySha256 = sha256(canonicalJson({
    platformClass: receipt.runtime?.platformClass,
    runtimeFamily: receipt.runtime?.runtimeFamily,
    appBuildIdentitySha256: receipt.runtime?.appBuildIdentitySha256,
    appVersion: receipt.runtime?.appVersion,
    appVersionSource: receipt.runtime?.appVersionSource,
    shellVersion: receipt.runtime?.shellVersion,
    shellVersionSource: receipt.runtime?.shellVersionSource,
  }));
  const deviceBindingShapeValid = hasExactKeys(deviceBinding, [
    "status", "deviceIdentitySha256", "platformClass", "runtimeFamily",
    "runtimeIdentitySha256",
  ]) && ["PENDING", "BOUND", "BLOCKED"].includes(deviceBinding.status);
  const deviceBindingPendingValid = deviceBinding?.status === "PENDING"
    && deviceBinding.deviceIdentitySha256 === null
    && deviceBinding.platformClass === null
    && deviceBinding.runtimeFamily === null
    && deviceBinding.runtimeIdentitySha256 === null;
  const deviceBindingObservedValid = ["BOUND", "BLOCKED"].includes(deviceBinding?.status)
    && (deviceBinding.deviceIdentitySha256 === null
      || isSha256(deviceBinding.deviceIdentitySha256))
    && deviceBinding.platformClass === receipt.runtime?.platformClass
    && deviceBinding.runtimeFamily === receipt.runtime?.runtimeFamily
    && deviceBinding.runtimeIdentitySha256 === expectedRuntimeIdentitySha256;
  const expectedDeviceBindingStatus = compactRuntimeValid
    && isSha256(deviceBinding?.deviceIdentitySha256)
    && compactAppIdentityValid
    ? "BOUND" : "BLOCKED";
  if (!deviceBindingShapeValid
    || (!deviceBindingPendingValid && !deviceBindingObservedValid)) {
    integrity(state, "app_compact_proxy_device_binding_invalid");
  } else if (deviceBinding.status === "PENDING") {
    blocker(state, "app_compact_proxy_device_binding_incomplete");
  } else if (deviceBinding.status !== expectedDeviceBindingStatus) {
    integrity(state, "app_compact_proxy_device_binding_status_invalid");
  } else if (deviceBinding.status !== "BOUND") {
    blocker(state, "app_compact_proxy_device_binding_blocked");
  }
  if (Array.isArray(receipt.checks)) {
    for (const check of receipt.checks) {
      if (check?.status === "FAIL") {
        failure(state, `app_compact_proxy_check_failed:${check.name ?? "unknown"}`);
      } else if (check?.status === "BLOCKED" && check.blocking !== false) {
        blocker(state, `app_compact_proxy_check_blocked:${check.name ?? "unknown"}`);
      } else if (!["PASS", "BLOCKED"].includes(check?.status)) {
        integrity(state, `app_compact_proxy_check_status_invalid:${check?.name ?? "unknown"}`);
      }
    }
  }

  const transition = compact.settingsTransition;
  const transitionBaseValid = hasExactKeys(transition, [
    "status", "stableSettingsProfileSha256", "controlSettingsBindingSha256",
    "evaluatedSettingsBindingSha256", "fromFlags", "toFlags", "transitionCount",
    "transitionedAt", "cleanup",
  ])
    && ["PENDING", "PASS", "INVALID"].includes(transition.status)
    && isSha256(transition.stableSettingsProfileSha256)
    && transition.controlSettingsBindingSha256 === sha256(canonicalJson({
      schemaVersion: 1,
      stableSettingsProfileSha256: transition.stableSettingsProfileSha256,
      retrievalOptimizationFlags: contract.plan.settingsPhases.control,
    }))
    && transition.evaluatedSettingsBindingSha256 === sha256(canonicalJson({
      schemaVersion: 1,
      stableSettingsProfileSha256: transition.stableSettingsProfileSha256,
      retrievalOptimizationFlags: contract.plan.settingsPhases.evaluated,
    }))
    && canonicalJson(transition.fromFlags) === canonicalJson(COMPACT_PROXY_FLAG_PROFILE.control)
    && canonicalJson(transition.toFlags) === canonicalJson(COMPACT_PROXY_FLAG_PROFILE.evaluated);
  const transitionStateValid = transition?.status === "PASS"
    ? transition.transitionCount === 1 && isCanonicalIsoTimestamp(transition.transitionedAt)
    : ["PENDING", "INVALID"].includes(transition?.status)
      && transition.transitionCount === 0 && transition.transitionedAt === null;
  if (!transitionBaseValid || !transitionStateValid) {
    if (transition?.status === "PENDING") blocker(state, "app_compact_proxy_settings_transition_incomplete");
    else integrity(state, "app_compact_proxy_settings_transition_invalid");
  } else if (transition.status === "INVALID") {
    failure(state, "app_compact_proxy_settings_transition_failed");
  } else if (transition.status !== "PASS") {
    blocker(state, "app_compact_proxy_settings_transition_incomplete");
  } else {
    validateTimestampInWindow(
      state,
      transition.transitionedAt,
      receipt.startedAt,
      receipt.finishedAt,
      "app_compact_proxy_settings_transition",
    );
  }

  const cleanup = transition?.cleanup;
  const cleanupBaseValid = hasExactKeys(cleanup, [
    "status", "restoredFlags", "restoredAt", "reason",
  ])
    && ["PENDING", "PASS", "NOT_REQUIRED", "BLOCKED"].includes(cleanup.status)
    && canonicalJson(cleanup.restoredFlags) === canonicalJson(COMPACT_PROXY_FLAG_PROFILE.control);
  const cleanupStateValid = cleanup?.status === "PASS"
    ? isCanonicalIsoTimestamp(cleanup.restoredAt) && cleanup.reason === null
    : cleanup?.status === "BLOCKED"
      ? cleanup.restoredAt === null && cleanup.reason === "settings_restore_failed"
      : ["PENDING", "NOT_REQUIRED"].includes(cleanup?.status)
        && cleanup.restoredAt === null && cleanup.reason === null;
  if (!cleanupBaseValid || !cleanupStateValid) {
    integrity(state, "app_compact_proxy_settings_cleanup_invalid");
  } else if (cleanup.status === "BLOCKED") {
    blocker(state, "app_compact_proxy_settings_cleanup_blocked");
  } else if (transition?.status === "PASS" && cleanup.status !== "PASS") {
    blocker(state, "app_compact_proxy_settings_cleanup_incomplete");
  } else if (cleanup.status === "PASS") {
    validateTimestampInWindow(
      state,
      cleanup.restoredAt,
      receipt.startedAt,
      receipt.finishedAt,
      "app_compact_proxy_settings_cleanup",
    );
    if (isCanonicalIsoTimestamp(transition?.transitionedAt)
      && cleanup.restoredAt < transition.transitionedAt) {
      integrity(state, "app_compact_proxy_settings_cleanup_order_invalid");
    }
  }

  const requiredCompactChecks = [
    [COMPACT_PROXY_RUNTIME_CHECK, compactRuntimeValid ? "PASS" : "BLOCKED"],
    [COMPACT_PROXY_DEVICE_CHECK,
      deviceBindingShapeValid && deviceBindingObservedValid
        && deviceBinding.status === "BOUND" ? "PASS" : "BLOCKED"],
    [COMPACT_PROXY_CLEANUP_CHECK,
      cleanupBaseValid && cleanupStateValid && cleanup.status === "PASS"
        ? "PASS" : "BLOCKED"],
    [COMPACT_PROXY_SOURCE_GUARD_CHECK,
      compact.maintenance?.sourceMutationGuard?.status === "BLOCKED"
        ? "BLOCKED" : "PASS"],
    [COMPACT_PROXY_SOURCE_CLEAN_CHECK,
      compact.maintenance?.sourceMutationGuard?.status === "PASS"
        ? "PASS" : compact.maintenance?.sourceMutationGuard?.status === "FAIL"
          ? "FAIL" : "BLOCKED"],
    [COMPACT_PROXY_COMPLETION_CHECK,
      compact.status === COMPACT_PROXY_COMPLETION_STATUS
        ? "PASS" : compact.status === "INVALID" ? "FAIL" : "BLOCKED"],
  ];
  if (Array.isArray(receipt.checks)) {
    for (const [name, expectedStatus] of requiredCompactChecks) {
      const matches = receipt.checks.filter((entry) => entry?.name === name);
      if (matches.length === 0) {
        if (compact.status === COMPACT_PROXY_COMPLETION_STATUS) {
          integrity(state, `app_compact_proxy_required_check_missing:${name}`);
        } else {
          blocker(state, `app_compact_proxy_required_check_missing:${name}`);
        }
      } else if (matches.length > 1) {
        integrity(state, `app_compact_proxy_required_check_duplicate:${name}`);
      } else if (matches[0].status !== expectedStatus) {
        integrity(state, `app_compact_proxy_required_check_status_mismatch:${name}`);
      }
    }
  }

  const binding = compact.workloadBinding;
  const bindingShapeValid = hasExactKeys(binding, [
    "schemaVersion", "status", "expectedEpisodeCount", "boundEpisodeCount", "violationCount",
    "contractSha256", "sequenceSha256", "bindingSha256", "stages", "episodes",
  ])
    && binding.schemaVersion === 1
    && ["PENDING", "PASS", "INVALID"].includes(binding.status)
    && binding.expectedEpisodeCount === 33
    && Number.isSafeInteger(binding.boundEpisodeCount)
    && binding.boundEpisodeCount >= 0
    && binding.boundEpisodeCount <= 33
    && Number.isSafeInteger(binding.violationCount)
    && binding.violationCount >= 0
    && binding.contractSha256 === contract.contractSha256
    && binding.sequenceSha256 === contract.sequenceSha256
    && isSha256(binding.bindingSha256)
    && hasExactKeys(binding.stages, Object.keys(COMPACT_PROXY_STAGE_COUNTS))
    && Array.isArray(binding.episodes);
  if (!bindingShapeValid) {
    integrity(state, "app_compact_proxy_workload_binding_schema_invalid");
  } else {
    const correlations = [];
    const evidenceBindings = [];
    for (let index = 0; index < binding.episodes.length; index += 1) {
      const entry = binding.episodes[index];
      const expected = contract.sequence[index];
      const valid = expected
        && hasExactKeys(entry, [
          "id", "stage", "sampleClass", "promptId", "settingsPhase", "surface",
          "freshChat", "sequence", "status", "executionMode",
          "opaqueCorrelationSha256", "cancellationEvidence", "evidenceBindingSha256",
          "observations",
        ])
        && entry.id === expected.id
        && entry.stage === expected.stage
        && entry.sampleClass === expected.sampleClass
        && entry.promptId === expected.promptId
        && entry.settingsPhase === expected.settingsPhase
        && entry.surface === "chat"
        && entry.freshChat === true
        && entry.sequence === index + 1
        && entry.status === "BOUND"
        && entry.executionMode === COMPACT_PROXY_EXECUTION_MODES[expected.stage]
        && isSha256(entry.opaqueCorrelationSha256)
        && isSha256(entry.evidenceBindingSha256)
        && hasExactKeys(entry.observations, COMPACT_PROXY_EPISODE_OBSERVATION_KEYS)
        && Object.entries(entry.observations).every(([key, value]) => (
          value === null || (COMPACT_PROXY_COUNT_OBSERVATION_KEYS.has(key)
            ? Number.isSafeInteger(value) && value >= 0
            : Number.isFinite(value) && value >= 0)
        ))
        && entry.evidenceBindingSha256 === sha256(canonicalJson({
          id: entry.id,
          stage: entry.stage,
          sampleClass: entry.sampleClass,
          promptId: entry.promptId,
          settingsPhase: entry.settingsPhase,
          surface: entry.surface,
          freshChat: entry.freshChat,
          sequence: entry.sequence,
          status: entry.status,
          executionMode: entry.executionMode,
          opaqueCorrelationSha256: entry.opaqueCorrelationSha256,
          cancellationEvidence: entry.cancellationEvidence,
          observations: entry.observations,
        }));
      if (!valid) integrity(state, "app_compact_proxy_episode_binding_invalid");
      const requiresWorkerTiming = ["evaluatedStandard", "evaluatedRetry"]
        .includes(expected?.stage);
      const workerTiming = [
        entry?.observations?.graphWorkerDurationMs,
        entry?.observations?.graphWorkerQueueWaitMs,
        entry?.observations?.graphMaxBatchDurationMs,
      ];
      const isCancellation = expected?.stage === "cancellationProbe";
      const workerTimingValid = requiresWorkerTiming
        ? workerTiming.every((value) => Number.isFinite(value) && value >= 0)
        : isCancellation
          ? workerTiming.slice(0, 2).every((value) => value === null)
            && Number.isFinite(workerTiming[2]) && workerTiming[2] >= 0
          : workerTiming.every((value) => value === null);
      if (!workerTimingValid) {
        integrity(state, `app_compact_proxy_episode_worker_timing_invalid:${entry?.id ?? index}`);
      }
      if (![...COMPACT_PROXY_COUNT_OBSERVATION_KEYS].every((key) => (
        Number.isSafeInteger(entry?.observations?.[key])
        && entry.observations[key] >= 0
      ))) {
        integrity(state, `app_compact_proxy_episode_counter_invalid:${entry?.id ?? index}`);
      }
      const queueReleaseKeys = [
        "cancelToWorkerObservedMs", "cancelToLateDiscardedMs", "cancelToProbeCompletedMs",
        "queueReleaseProbeResultCount",
      ];
      if (isCancellation) {
        inspectCompactCancellationEvidence(entry, state);
      } else if (entry?.cancellationEvidence !== null
        || queueReleaseKeys.some((key) => entry?.observations?.[key] !== null)) {
        integrity(state, `app_compact_proxy_unexpected_cancellation_evidence:${entry?.id ?? index}`);
      }
      if (expected?.stage === "controlStandard" && [
        entry?.observations?.lexicalDurationMs,
        entry?.observations?.graphDurationMs,
      ].some((value) => value !== null)) {
        integrity(state, `app_compact_proxy_control_observation_invalid:${entry?.id ?? index}`);
      }
      correlations.push(entry?.opaqueCorrelationSha256);
      evidenceBindings.push(entry?.evidenceBindingSha256);
    }
    if (binding.episodes.length !== binding.boundEpisodeCount
      || new Set(correlations).size !== correlations.length
      || new Set(evidenceBindings).size !== evidenceBindings.length) {
      integrity(state, "app_compact_proxy_episode_freshness_invalid");
    }
    const cancellationEntries = binding.episodes.filter((entry) => (
      entry?.stage === "cancellationProbe"
    ));
    if (cancellationEntries.length > 0) {
      const observedBatchDurations = binding.episodes
        .filter((entry) => ["evaluatedStandard", "evaluatedRetry"].includes(entry?.stage))
        .map((entry) => entry?.observations?.graphMaxBatchDurationMs);
      const expectedObservedMaximum = observedBatchDurations.length === 26
        && observedBatchDurations.every((value) => Number.isFinite(value) && value >= 0)
        ? Math.max(...observedBatchDurations)
        : null;
      if (cancellationEntries.length !== 1
        || expectedObservedMaximum === null
        || cancellationEntries[0]?.observations?.graphMaxBatchDurationMs
          !== expectedObservedMaximum) {
        integrity(state, "app_compact_proxy_cancellation_batch_observation_invalid");
      }
    }
    for (const [stage, expectedCount] of Object.entries(COMPACT_PROXY_STAGE_COUNTS)) {
      const summary = binding.stages[stage];
      const boundCount = binding.episodes.filter((entry) => entry?.stage === stage).length;
      if (!hasExactKeys(summary, [
        "status", "expectedCount", "boundCount", "violationCount",
      ])
        || !["PENDING", "PASS", "INVALID"].includes(summary.status)
        || summary.expectedCount !== expectedCount
        || summary.boundCount !== boundCount
        || !Number.isSafeInteger(summary.violationCount)
        || summary.violationCount < 0) {
        integrity(state, `app_compact_proxy_stage_binding_invalid:${stage}`);
      } else {
        const expectedStatus = summary.violationCount > 0 || summary.boundCount > expectedCount
          ? "INVALID" : summary.boundCount === expectedCount ? "PASS" : "PENDING";
        if (summary.status !== expectedStatus) {
          integrity(state, summary.status === "PASS"
            ? `app_compact_proxy_stage_binding_pass_invariant_invalid:${stage}`
            : `app_compact_proxy_stage_binding_status_invalid:${stage}`);
        }
      }
    }
    if (binding.bindingSha256 !== sha256(canonicalJson(binding.episodes))) {
      integrity(state, "app_compact_proxy_workload_binding_hash_mismatch");
    }
    const bindingComplete = binding.status === "PASS"
      && binding.boundEpisodeCount === 33
      && binding.violationCount === 0
      && Object.values(binding.stages).every((summary) => (
        summary.status === "PASS"
        && summary.boundCount === summary.expectedCount
        && summary.violationCount === 0
      ));
    const expectedBindingStatus = binding.violationCount > 0
      || Object.values(binding.stages).some((summary) => summary?.status === "INVALID")
      ? "INVALID"
      : binding.boundEpisodeCount === binding.expectedEpisodeCount
        && Object.values(binding.stages).every((summary) => summary?.status === "PASS")
        ? "PASS" : "PENDING";
    if (binding.status === "PASS" && !bindingComplete) {
      integrity(state, "app_compact_proxy_workload_pass_invariant_invalid");
    } else if (binding.status !== expectedBindingStatus) {
      integrity(state, "app_compact_proxy_workload_status_invalid");
    }
    if (binding.status === "INVALID") failure(state, "app_compact_proxy_workload_invalid");
    else if (!bindingComplete) blocker(state, "app_compact_proxy_workload_incomplete");
  }

  const metrics = compact.metrics;
  const stageMetricRecords = {};
  if (!hasExactKeys(metrics, [
    ...Object.keys(COMPACT_PROXY_STAGE_COUNTS), "comparison", "requiredResourceEnvelope",
  ])) {
    integrity(state, "app_compact_proxy_metrics_schema_invalid");
  } else {
    for (const [stage, expectedCounts] of Object.entries(COMPACT_PROXY_STAGE_SAMPLE_COUNTS)) {
      const recorded = metrics[stage];
      const stageEpisodes = bindingShapeValid
        ? binding.episodes.filter((entry) => entry?.stage === stage)
        : [];
      const actualWarmupCount = stageEpisodes.filter((entry) => (
        entry?.sampleClass === "warmup"
      )).length;
      const actualMeasuredCount = stageEpisodes.filter((entry) => (
        entry?.sampleClass === "measured"
      )).length;
      const valid = hasExactKeys(recorded, [
        "status", "sampleCount", "warmupCount", "measuredCount", "expectedCount",
        "observations",
      ])
        && ["PENDING", "PASS", "INVALID"].includes(recorded.status)
        && recorded.sampleCount === stageEpisodes.length
        && recorded.warmupCount === actualWarmupCount
        && recorded.measuredCount === actualMeasuredCount
        && recorded.sampleCount <= expectedCounts.sampleCount
        && recorded.warmupCount <= expectedCounts.warmupCount
        && recorded.measuredCount <= expectedCounts.measuredCount
        && recorded.expectedCount === COMPACT_PROXY_STAGE_COUNTS[stage]
        && hasExactKeys(recorded.observations, COMPACT_PROXY_STAGE_OBSERVATION_KEYS)
        && Object.entries(recorded.observations).every(([key, samples]) => (
          compactNumericArray(samples)
          && (!COMPACT_PROXY_COUNT_OBSERVATION_KEYS.has(key)
            || samples.every(Number.isSafeInteger))
        ));
      if (!valid) {
        integrity(state, `app_compact_proxy_metric_stage_invalid:${stage}`);
        continue;
      }
      stageMetricRecords[stage] = recorded;
      if (recorded.status === "PASS"
        && (recorded.sampleCount !== expectedCounts.sampleCount
          || recorded.warmupCount !== expectedCounts.warmupCount
          || recorded.measuredCount !== expectedCounts.measuredCount)) {
        integrity(state, `app_compact_proxy_metric_stage_pass_invariant_invalid:${stage}`);
      }
      if (bindingShapeValid) {
        for (const key of COMPACT_PROXY_EPISODE_OBSERVATION_KEYS) {
          const expected = binding.episodes
            .filter((entry) => entry?.stage === stage)
            .map((entry) => entry?.observations?.[key])
            .filter((value) => value !== null && value !== undefined);
          if (canonicalJson(recorded.observations[key]) !== canonicalJson(expected)) {
            integrity(state, `app_compact_proxy_metric_episode_binding_invalid:${stage}:${key}`);
          }
        }
      }
      if (recorded.status === "INVALID") {
        failure(state, `app_compact_proxy_metric_stage_failed:${stage}`);
      } else if (recorded.status !== "PASS") {
        blocker(state, `app_compact_proxy_metric_stage_incomplete:${stage}`);
      }
    }
  }

  const measured = (stage, key) => {
    const recorded = stageMetricRecords[stage];
    if (!recorded) return [];
    const samples = recorded.observations[key];
    return ["eventLoopStallMs", "estimatedDbBytes"].includes(key)
      ? [...samples]
      : samples.slice(recorded.warmupCount);
  };
  const allSamples = (stage, key) => (
    stageMetricRecords[stage]?.observations?.[key] ?? []
  );
  const requiredMeasuredSeries = [
    ["controlStandard", "memorySearchDurationMs"],
    ["controlStandard", "outerTurnDurationMs"],
    ["controlStandard", "finalizationReserveMs"],
    ["controlStandard", "finalizationRemainingMs"],
    ["evaluatedStandard", "memorySearchDurationMs"],
    ["evaluatedStandard", "outerTurnDurationMs"],
    ["evaluatedStandard", "lexicalDurationMs"],
    ["evaluatedStandard", "graphDurationMs"],
    ["evaluatedStandard", "graphWorkerDurationMs"],
    ["evaluatedStandard", "graphWorkerQueueWaitMs"],
    ["evaluatedStandard", "graphMaxBatchDurationMs"],
    ["evaluatedStandard", "finalizationReserveMs"],
    ["evaluatedStandard", "finalizationRemainingMs"],
    ["evaluatedRetry", "memorySearchDurationMs"],
    ["evaluatedRetry", "outerTurnDurationMs"],
    ["evaluatedRetry", "lexicalDurationMs"],
    ["evaluatedRetry", "graphDurationMs"],
    ["evaluatedRetry", "graphWorkerDurationMs"],
    ["evaluatedRetry", "graphWorkerQueueWaitMs"],
    ["evaluatedRetry", "graphMaxBatchDurationMs"],
    ["evaluatedRetry", "finalizationReserveMs"],
    ["evaluatedRetry", "finalizationRemainingMs"],
  ];
  for (const [stage, key] of requiredMeasuredSeries) {
    const record = stageMetricRecords[stage];
    if (record && record.status === "PASS"
      && record.observations[key].length !== record.sampleCount) {
      integrity(state, `app_compact_proxy_required_observation_invalid:${stage}:${key}`);
    }
  }
  for (const stage of ["controlStandard", "evaluatedStandard", "evaluatedRetry"]) {
    const record = stageMetricRecords[stage];
    if (!record || record.status !== "PASS") continue;
    for (const key of ["eventLoopStallMs", "estimatedDbBytes"]) {
      if (record.observations[key].length < 3) {
        integrity(state, `app_compact_proxy_required_observation_invalid:${stage}:${key}`);
      }
    }
  }
  const notApplicableStageObservations = {
    controlStandard: [
      "lexicalDurationMs", "graphDurationMs", "graphWorkerDurationMs",
      "graphWorkerQueueWaitMs", "graphMaxBatchDurationMs",
      "cancelToWorkerObservedMs", "cancelToLateDiscardedMs",
      "cancelToProbeCompletedMs", "queueReleaseProbeResultCount",
    ],
    cancellationProbe: [
      "graphWorkerDurationMs", "graphWorkerQueueWaitMs",
    ],
  };
  for (const [stage, keys] of Object.entries(notApplicableStageObservations)) {
    const record = stageMetricRecords[stage];
    if (!record) continue;
    for (const key of keys) {
      if (record.observations[key].length !== 0) {
        integrity(state, `app_compact_proxy_observation_not_applicable_invalid:${stage}:${key}`);
      }
    }
  }

  const allNormalStages = ["controlStandard", "evaluatedStandard", "evaluatedRetry"];
  for (const stage of allNormalStages) {
    const observations = stageMetricRecords[stage]?.observations;
    if (!observations) continue;
    for (const key of [
      "deadlineExceededCount", "cancelRequestedCount", "cancelObservedCount",
      "acceptedAfterCancelCount", "lateDiscardCount",
    ]) {
      if (observations[key].length !== stageMetricRecords[stage].sampleCount
        || observations[key].some((value) => value !== 0)) {
        integrity(state, `app_compact_proxy_normal_counter_invalid:${stage}:${key}`);
      }
    }
    for (const key of [
      "cancelToWorkerObservedMs", "cancelToLateDiscardedMs",
      "cancelToProbeCompletedMs", "queueReleaseProbeResultCount",
    ]) {
      if (observations[key].length !== 0) {
        integrity(state, `app_compact_proxy_normal_queue_release_invalid:${stage}:${key}`);
      }
    }
  }
  const cancel = stageMetricRecords.cancellationProbe?.observations;
  if (stageMetricRecords.cancellationProbe?.status === "PASS"
    && cancel && (JSON.stringify(cancel.deadlineExceededCount) !== "[0]"
    || cancel.cancelRequestedCount.length !== 1 || cancel.cancelRequestedCount[0] < 1
    || cancel.cancelObservedCount.length !== 1 || cancel.cancelObservedCount[0] < 1
    || JSON.stringify(cancel.acceptedAfterCancelCount) !== "[0]"
    || cancel.lateDiscardCount.length !== 1 || cancel.lateDiscardCount[0] < 1
    || cancel.cancelToWorkerObservedMs.length !== 1
    || cancel.cancelToLateDiscardedMs.length !== 1
    || cancel.cancelToProbeCompletedMs.length !== 1
    || cancel.queueReleaseProbeResultCount.length !== 1
    || cancel.queueReleaseProbeResultCount[0] !== 1
    || cancel.cancelToWorkerObservedMs[0] > cancel.cancelToLateDiscardedMs[0]
    || cancel.cancelToLateDiscardedMs[0] > cancel.cancelToProbeCompletedMs[0]
    || cancel.cancelToProbeCompletedMs[0] > COMPACT_PROXY_HARD_BUDGETS.graphMs
    || cancel.graphMaxBatchDurationMs.length !== 1)) {
    integrity(state, "app_compact_proxy_cancellation_invariant_invalid");
  }

  const comparison = metrics?.comparison;
  if (!hasExactKeys(comparison, COMPACT_PROXY_COMPARISON_KEYS)) {
    integrity(state, "app_compact_proxy_comparison_schema_invalid");
  } else {
    const sampleSource = {
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
    const naEvaluatedSource = {
      lexicalDurationMs: measured("evaluatedStandard", "lexicalDurationMs"),
      graphDurationMs: measured("evaluatedStandard", "graphDurationMs"),
      retryDurationMs: measured("evaluatedRetry", "memorySearchDurationMs"),
      rebuildDurationMs: Number.isFinite(
        compact.maintenance?.rebuild?.runtimeEnvelope?.publicApiDurationMs,
      ) ? [compact.maintenance.rebuild.runtimeEnvelope.publicApiDurationMs] : [],
      incrementalUpdateDurationMs:
        Number.isFinite(
          compact.maintenance?.incrementalUpdate?.runtimeEnvelope?.publicApiDurationMs,
        ) ? [compact.maintenance.incrementalUpdate.runtimeEnvelope.publicApiDurationMs] : [],
    };
    for (const key of COMPACT_PROXY_COMPARISON_KEYS) {
      const entry = comparison[key];
      const shared = COMPACT_PROXY_SHARED_COMPARISON_KEYS.has(key);
      if (!hasExactKeys(entry, ["status", "reason", "control", "evaluated"])) {
        integrity(state, `app_compact_proxy_comparison_invalid:${key}`);
        continue;
      }
      if (shared) {
        const [controlSamples, evaluatedSamples] = sampleSource[key];
        const expectedControl = compactStatsFromSamples(controlSamples);
        const expectedEvaluated = compactStatsFromSamples(evaluatedSamples);
        const observedValid = entry.status === "OBSERVED"
          && entry.reason === null
          && compactStatsValid(entry.control)
          && compactStatsValid(entry.evaluated)
          && canonicalJson(entry.control) === canonicalJson(expectedControl)
          && canonicalJson(entry.evaluated) === canonicalJson(expectedEvaluated);
        const incompleteValid = compact.status !== COMPACT_PROXY_COMPLETION_STATUS
          && entry.status === "N/A"
          && typeof entry.reason === "string"
          && entry.reason.length > 0
          && canonicalJson(entry.control) === canonicalJson(expectedControl)
          && canonicalJson(entry.evaluated) === canonicalJson(expectedEvaluated)
          && (expectedControl === null || expectedEvaluated === null);
        if (!observedValid && !incompleteValid) {
          integrity(state, `app_compact_proxy_shared_comparison_invalid:${key}`);
        }
      } else {
        const expectedEvaluated = compactStatsFromSamples(naEvaluatedSource[key] ?? []);
        if (entry.status !== "N/A"
          || typeof entry.reason !== "string"
          || entry.reason.length === 0
          || entry.control !== null
          || canonicalJson(entry.evaluated) !== canonicalJson(expectedEvaluated)) {
          integrity(state, `app_compact_proxy_na_comparison_invalid:${key}`);
        }
      }
    }
  }

  const budgets = compact.hardBudgets;
  if (!hasExactKeys(budgets, [
    ...Object.keys(COMPACT_PROXY_HARD_BUDGETS), "status", "violations",
  ])
    || Object.entries(COMPACT_PROXY_HARD_BUDGETS).some(([key, value]) => (
      budgets?.[key] !== value
    ))
    || !["PENDING", "PASS", "FAIL"].includes(budgets?.status)
    || !Array.isArray(budgets?.violations)) {
    integrity(state, "app_compact_proxy_hard_budget_schema_invalid");
  } else if (budgets.status === "FAIL" || budgets.violations.length > 0) {
    failure(state, "app_compact_proxy_hard_budget_failed");
  } else if (budgets.status !== "PASS") {
    blocker(state, "app_compact_proxy_hard_budget_incomplete");
  }
  const overBudget = ["evaluatedStandard", "evaluatedRetry"].some((stage) => (
    allSamples(stage, "lexicalDurationMs").some((value) => value > budgets?.lexicalMs)
    || allSamples(stage, "graphDurationMs").some((value) => value > budgets?.graphMs)
    || allSamples(stage, "memorySearchDurationMs").some((value) => value > budgets?.recoveryMs)
    || allSamples(stage, "outerTurnDurationMs").some((value) => value > budgets?.outerTurnMs)
    || allSamples(stage, "finalizationReserveMs").some((value) => (
      value <= budgets?.finalizationReserveMinExclusiveMs
    ))
    || allSamples(stage, "finalizationRemainingMs").some((value) => value <= 0)
  )) || allSamples("controlStandard", "memorySearchDurationMs").some((value) => (
    value > budgets?.recoveryMs
  )) || allSamples("controlStandard", "outerTurnDurationMs").some((value) => (
    value > budgets?.outerTurnMs
  )) || allSamples("controlStandard", "finalizationReserveMs").some((value) => (
    value <= budgets?.finalizationReserveMinExclusiveMs
  )) || allSamples("controlStandard", "finalizationRemainingMs").some((value) => value <= 0);
  const compactConfiguredReserves = [
    ...allSamples("controlStandard", "finalizationReserveMs"),
    ...allSamples("evaluatedStandard", "finalizationReserveMs"),
    ...allSamples("evaluatedRetry", "finalizationReserveMs"),
    ...allSamples("cancellationProbe", "finalizationReserveMs"),
  ];
  const configuredReserveInvalid = compactConfiguredReserves.some((value) => (
    value <= budgets?.finalizationReserveMinExclusiveMs
  ));
  const configuredReserveDrift = compactConfiguredReserves.length > 0
    && new Set(compactConfiguredReserves).size !== 1;
  const unexpectedFallback = Object.keys(COMPACT_PROXY_STAGE_COUNTS).some((stage) => (
    allSamples(stage, "fallbackCount").some((value) => value !== 0)
  ));
  if (budgets?.status === "PASS" && overBudget) {
    integrity(state, "app_compact_proxy_hard_budget_pass_invariant_invalid");
  }
  if (budgets?.status === "PASS" && (configuredReserveInvalid || configuredReserveDrift)) {
    integrity(state, "app_compact_proxy_finalization_reserve_binding_invalid");
  }
  if (budgets?.status === "PASS" && unexpectedFallback) {
    integrity(state, "app_compact_proxy_fallback_pass_invariant_invalid");
  }

  const maintenance = compact.maintenance;
  const maintenanceSnapshotKeys = [
    "databaseInstanceIdSha256", "profileIdSha256", "generation",
    "sourceChunkEpoch", "chunkMutationEpoch", "indexMutationEpoch",
    "rebuildEpoch", "lexicalMaintenanceEpoch", "incrementalMaintenanceEpoch",
    "sourceChunkRows", "lexicalRows", "totalLexicalRows",
  ];
  const maintenanceEffectKeys = [
    "source", "pathCount", "sourceChunkReads", "sourceChunkWrites",
    "lexicalRowsDeleted", "lexicalRowsInserted", "markdownReads",
    "markdownWrites", "providerCalls", "embeddingCalls", "embeddingWrites",
  ];
  const maintenanceOperationKeys = [
    "schemaVersion", "sequence", "kind", "status", "operationId",
    "scopeBindingSha256", "startedAt", "finishedAt", "durationMs", "state",
    "inputSource", "before", "after", "effects", "resourceEnvelope",
  ];
  const maintenanceResourceEnvelopeValid = (envelope) => hasExactKeys(envelope, [
    "estimatedDbBytesBefore", "estimatedDbBytesPeak", "estimatedDbBytesAfter",
  ])
    && [
      envelope.estimatedDbBytesBefore,
      envelope.estimatedDbBytesPeak,
      envelope.estimatedDbBytesAfter,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
    && envelope.estimatedDbBytesPeak >= envelope.estimatedDbBytesBefore
    && envelope.estimatedDbBytesPeak >= envelope.estimatedDbBytesAfter;
  const maintenanceSnapshotValid = (snapshot) => hasExactKeys(
    snapshot,
    maintenanceSnapshotKeys,
  )
    && isSha256(snapshot.databaseInstanceIdSha256)
    && isSha256(snapshot.profileIdSha256)
    && typeof snapshot.sourceChunkEpoch === "string"
    && snapshot.sourceChunkEpoch === String(snapshot.chunkMutationEpoch)
    && maintenanceSnapshotKeys.filter((key) => ![
      "databaseInstanceIdSha256", "profileIdSha256", "sourceChunkEpoch",
    ].includes(key)).every((key) => (
      Number.isSafeInteger(snapshot[key]) && snapshot[key] >= 0
    ));
  const maintenanceEffectsValid = (effects) => hasExactKeys(
    effects,
    maintenanceEffectKeys,
  )
    && effects.source === "indexed-chunks"
    && maintenanceEffectKeys.filter((key) => key !== "source").every((key) => (
      Number.isSafeInteger(effects[key]) && effects[key] >= 0
    ))
    && effects.pathCount > 0
    && effects.sourceChunkReads > 0
    && effects.sourceChunkWrites === 0
    && effects.markdownReads === 0
    && effects.markdownWrites === 0
    && effects.providerCalls === 0
    && effects.embeddingCalls === 0
    && effects.embeddingWrites === 0;
  const maintenanceOperationBaseValid = (operation, definition, expectedKind) => {
    const expectedId = expectedKind === "rebuild"
      ? /^lexreb-[a-f0-9]{32}$/u : /^lexinc-[a-f0-9]{32}$/u;
    if (!hasExactKeys(operation, maintenanceOperationKeys)
      || operation.schemaVersion !== 1
      || operation.sequence !== definition.sequence
      || operation.kind !== expectedKind
      || operation.status !== "completed"
      || !expectedId.test(operation.operationId)
      || !isSha256(operation.scopeBindingSha256)
      || !isCanonicalIsoTimestamp(operation.startedAt)
      || !isCanonicalIsoTimestamp(operation.finishedAt)
      || operation.startedAt < receipt.startedAt
      || operation.finishedAt < operation.startedAt
      || operation.finishedAt > receipt.finishedAt
      || !Number.isFinite(operation.durationMs)
      || operation.durationMs < 0
      || operation.state !== "ready"
      || operation.inputSource !== definition.inputSource
      || !maintenanceSnapshotValid(operation.before)
      || !maintenanceSnapshotValid(operation.after)
      || !maintenanceEffectsValid(operation.effects)
      || !maintenanceResourceEnvelopeValid(operation.resourceEnvelope)) return false;
    const { before, after } = operation;
    return before.databaseInstanceIdSha256 === after.databaseInstanceIdSha256
      && before.profileIdSha256 === after.profileIdSha256
      && before.generation === after.generation
      && before.sourceChunkEpoch === after.sourceChunkEpoch
      && before.chunkMutationEpoch === after.chunkMutationEpoch
      && before.rebuildEpoch === after.rebuildEpoch;
  };
  const rebuildOperationValid = (operation) => {
    const definition = contract.plan.maintenanceOperations.rebuild;
    if (!maintenanceOperationBaseValid(operation, definition, "rebuild")) return false;
    const { before, after, effects } = operation;
    const indexDelta = after.indexMutationEpoch - before.indexMutationEpoch;
    const lexicalDelta = after.lexicalMaintenanceEpoch - before.lexicalMaintenanceEpoch;
    return before.incrementalMaintenanceEpoch === after.incrementalMaintenanceEpoch
      && before.sourceChunkRows === after.sourceChunkRows
      && before.lexicalRows === before.totalLexicalRows
      && after.sourceChunkRows > 0
      && after.sourceChunkRows === after.lexicalRows
      && after.lexicalRows === after.totalLexicalRows
      && indexDelta > 0
      && lexicalDelta === indexDelta
      && effects.pathCount <= after.sourceChunkRows
      && effects.sourceChunkReads === after.sourceChunkRows
      && effects.lexicalRowsDeleted === before.lexicalRows
      && effects.lexicalRowsInserted === after.lexicalRows;
  };
  const incrementalOperationValid = (operation) => {
    const definition = contract.plan.maintenanceOperations.incrementalUpdate;
    if (!maintenanceOperationBaseValid(
      operation,
      definition,
      "indexed-chunks-incremental",
    )) return false;
    const { before, after, effects } = operation;
    const expectedScopeBinding = sha256(
      `b125-lexical-maintenance-v1\u0000${operation.operationId}\u0000${definition.fixturePath}`,
    );
    return operation.scopeBindingSha256 === expectedScopeBinding
      && effects.pathCount === 1
      && before.sourceChunkRows > 0
      && before.sourceChunkRows === before.lexicalRows
      && before.sourceChunkRows === after.sourceChunkRows
      && before.lexicalRows === after.lexicalRows
      && before.totalLexicalRows === after.totalLexicalRows
      && before.totalLexicalRows >= before.lexicalRows
      && after.indexMutationEpoch === before.indexMutationEpoch + 1
      && after.lexicalMaintenanceEpoch === before.lexicalMaintenanceEpoch + 1
      && after.incrementalMaintenanceEpoch === before.incrementalMaintenanceEpoch + 1
      && effects.sourceChunkReads === before.sourceChunkRows
      && effects.lexicalRowsDeleted === before.lexicalRows
      && effects.lexicalRowsInserted === after.lexicalRows;
  };
  const maintenanceReadyMarkerValid = (marker, operation) => hasExactKeys(marker, [
    "status", "lexicalProfileState", "lexicalProfileIdSha256", "lexicalGeneration",
  ])
    && marker.status === "ready"
    && marker.lexicalProfileState === "ready"
    && marker.lexicalProfileIdSha256 === operation.after.profileIdSha256
    && marker.lexicalGeneration === operation.after.generation;
  const maintenanceRuntimeEnvelopeValid = (envelope, expectedStage, operation) => {
    const stall = envelope?.eventLoopStallMs;
    return hasExactKeys(envelope, [
      "status", "stage", "startedAt", "finishedAt", "publicApiDurationMs",
      "eventLoopStallMs",
    ])
      && envelope.status === "PASS"
      && envelope.stage === expectedStage
      && isCanonicalIsoTimestamp(envelope.startedAt)
      && isCanonicalIsoTimestamp(envelope.finishedAt)
      && envelope.startedAt >= receipt.startedAt
      && envelope.startedAt <= operation.startedAt
      && envelope.finishedAt >= operation.finishedAt
      && envelope.finishedAt <= receipt.finishedAt
      && Number.isFinite(envelope.publicApiDurationMs)
      && envelope.publicApiDurationMs >= operation.durationMs
      && hasExactKeys(stall, ["samples", "maximum"])
      && compactNumericArray(stall.samples)
      && stall.samples.length > 0
      && stall.maximum === Math.max(...stall.samples);
  };
  const maintenanceEntryValid = (entry, operationValid, expectedStage) => {
    if (!hasExactKeys(entry, [
      "status", "operation", "operationBindingSha256", "runtimeEnvelope",
      "estimatedDbBytesBefore", "estimatedDbBytesPeak", "estimatedDbBytesAfter",
      "readyMarker", "recordedAt", "reason",
    ]) || !["PENDING", "ACTIVE", "PASS", "BLOCKED", "INVALID"]
      .includes(entry.status)) return false;
    if (entry.status !== "PASS") {
      const expectedReason = entry.status === "BLOCKED"
        ? "maintenance_evidence_unavailable"
        : entry.status === "INVALID" ? "maintenance_invariant_failed" : null;
      return entry.operation === null
        && entry.operationBindingSha256 === null
        && entry.runtimeEnvelope === null
        && entry.estimatedDbBytesBefore === null
        && entry.estimatedDbBytesPeak === null
        && entry.estimatedDbBytesAfter === null
        && entry.readyMarker === null
        && entry.recordedAt === null
        && entry.reason === expectedReason;
    }
    return operationValid(entry.operation)
      && entry.operationBindingSha256 === sha256(canonicalJson(entry.operation))
      && maintenanceRuntimeEnvelopeValid(
        entry.runtimeEnvelope,
        expectedStage,
        entry.operation,
      )
      && Number.isSafeInteger(entry.estimatedDbBytesBefore)
      && entry.estimatedDbBytesBefore === entry.operation.resourceEnvelope.estimatedDbBytesBefore
      && Number.isSafeInteger(entry.estimatedDbBytesPeak)
      && entry.estimatedDbBytesPeak === entry.operation.resourceEnvelope.estimatedDbBytesPeak
      && Number.isSafeInteger(entry.estimatedDbBytesAfter)
      && entry.estimatedDbBytesAfter === entry.operation.resourceEnvelope.estimatedDbBytesAfter
      && maintenanceReadyMarkerValid(entry.readyMarker, entry.operation)
      && isCanonicalIsoTimestamp(entry.recordedAt)
      && entry.recordedAt >= entry.runtimeEnvelope.finishedAt
      && entry.recordedAt <= receipt.finishedAt
      && entry.reason === null;
  };
  const mutationGuard = maintenance?.sourceMutationGuard;
  const mutationGuardValid = hasExactKeys(mutationGuard, ["status", "eventCount"])
    && ["PENDING", "ACTIVE", "PASS", "BLOCKED", "FAIL"].includes(mutationGuard.status)
    && Number.isSafeInteger(mutationGuard.eventCount)
    && mutationGuard.eventCount >= 0
    && (mutationGuard.status === "FAIL"
      ? mutationGuard.eventCount > 0
      : mutationGuard.eventCount === 0);
  const maintenanceShapeValid = hasExactKeys(
    maintenance,
    ["status", "sourceMutationGuard", "rebuild", "incrementalUpdate"],
  )
    && ["PENDING", "PASS", "BLOCKED", "INVALID"].includes(maintenance?.status)
    && mutationGuardValid
    && maintenanceEntryValid(maintenance?.rebuild, rebuildOperationValid, "rebuild")
    && maintenanceEntryValid(
      maintenance?.incrementalUpdate,
      incrementalOperationValid,
      "incremental-update",
    );
  if (!maintenanceShapeValid) {
    integrity(state, "app_compact_proxy_maintenance_invalid");
  } else {
    const entryStatuses = [
      maintenance.rebuild.status,
      maintenance.incrementalUpdate.status,
    ];
    const expectedMaintenanceStatus = entryStatuses.includes("INVALID")
      ? "INVALID" : entryStatuses.includes("BLOCKED")
        ? "BLOCKED" : entryStatuses.every((status) => status === "PASS")
          ? "PASS" : "PENDING";
    if (maintenance.status !== expectedMaintenanceStatus) {
      integrity(state, "app_compact_proxy_maintenance_status_invalid");
    }
    if (expectedMaintenanceStatus === "INVALID") {
      failure(state, "app_compact_proxy_maintenance_failed");
    } else if (expectedMaintenanceStatus !== "PASS") {
      blocker(state, expectedMaintenanceStatus === "BLOCKED"
        ? "app_compact_proxy_maintenance_blocked"
        : "app_compact_proxy_maintenance_incomplete");
    } else {
      const rebuildOperation = maintenance.rebuild.operation;
      const incrementalOperation = maintenance.incrementalUpdate.operation;
      validateTimestampInWindow(
        state,
        maintenance.rebuild.recordedAt,
        receipt.startedAt,
        receipt.finishedAt,
        "app_compact_proxy_rebuild",
      );
      validateTimestampInWindow(
        state,
        maintenance.incrementalUpdate.recordedAt,
        receipt.startedAt,
        receipt.finishedAt,
        "app_compact_proxy_incremental_update",
      );
      if (transition?.status !== "PASS"
        || rebuildOperation.startedAt < transition.transitionedAt
        || incrementalOperation.startedAt < rebuildOperation.finishedAt
        || maintenance.incrementalUpdate.recordedAt < maintenance.rebuild.recordedAt
        || maintenance.rebuild.estimatedDbBytesAfter
          !== maintenance.incrementalUpdate.estimatedDbBytesBefore) {
        integrity(state, "app_compact_proxy_maintenance_order_invalid");
      }
      const continuityKeys = [
        "databaseInstanceIdSha256", "profileIdSha256", "generation",
        "sourceChunkEpoch", "chunkMutationEpoch", "indexMutationEpoch",
        "rebuildEpoch", "lexicalMaintenanceEpoch", "incrementalMaintenanceEpoch",
        "totalLexicalRows",
      ];
      if (rebuildOperation.operationId === incrementalOperation.operationId
        || continuityKeys.some((key) => (
          rebuildOperation.after[key] !== incrementalOperation.before[key]
        ))) {
        integrity(state, "app_compact_proxy_maintenance_continuity_invalid");
      }
      if (cleanup?.status === "PASS"
        && cleanup.restoredAt < maintenance.incrementalUpdate.recordedAt) {
        integrity(state, "app_compact_proxy_settings_cleanup_order_invalid");
      }
    }
    if (mutationGuard.status === "FAIL") {
      failure(state, "app_compact_proxy_source_mutation_detected");
    } else if (mutationGuard.status === "BLOCKED") {
      blocker(state, "app_compact_proxy_source_mutation_guard_blocked");
    } else if (mutationGuard.status !== "PASS") {
      blocker(state, "app_compact_proxy_source_mutation_guard_incomplete");
    }
  }

  const requiredResourceEnvelope = metrics?.requiredResourceEnvelope;
  const requiredResourceMetricValid = (metric, requireSafeIntegers, minimumCount) => (
    hasExactKeys(metric, ["samples", "maximum"])
      && compactNumericArray(metric.samples)
      && metric.samples.length >= minimumCount
      && (!requireSafeIntegers || metric.samples.every(Number.isSafeInteger))
      && metric.maximum === Math.max(...metric.samples)
  );
  const requiredResourceEmptyMetricValid = (metric) => hasExactKeys(
    metric,
    ["samples", "maximum"],
  ) && Array.isArray(metric.samples)
    && metric.samples.length === 0
    && metric.maximum === null;
  const requiredResourceIncludedStages = [
    "controlStandard", "rebuild", "incremental-update", "evaluatedStandard",
    "evaluatedRetry",
  ];
  const requiredResourceSourceInvalid = [
    "controlStandard", "evaluatedStandard", "evaluatedRetry",
  ].some((stage) => stageMetricRecords[stage]?.status === "INVALID")
    || binding?.status === "INVALID"
    || maintenance?.status === "INVALID"
    || maintenance?.rebuild?.status === "INVALID"
    || maintenance?.incrementalUpdate?.status === "INVALID";
  const requiredResourceSourcesComplete = [
    "controlStandard", "evaluatedStandard", "evaluatedRetry",
  ].every((stage) => stageMetricRecords[stage]?.status === "PASS")
    && maintenanceShapeValid
    && maintenance.rebuild.status === "PASS"
    && maintenance.incrementalUpdate.status === "PASS";
  const expectedEstimatedDbBytes = requiredResourceSourcesComplete ? [
    ...stageMetricRecords.controlStandard.observations.estimatedDbBytes,
    maintenance.rebuild.estimatedDbBytesBefore,
    maintenance.rebuild.estimatedDbBytesPeak,
    maintenance.rebuild.estimatedDbBytesAfter,
    maintenance.incrementalUpdate.estimatedDbBytesBefore,
    maintenance.incrementalUpdate.estimatedDbBytesPeak,
    maintenance.incrementalUpdate.estimatedDbBytesAfter,
    ...stageMetricRecords.evaluatedStandard.observations.estimatedDbBytes,
    ...stageMetricRecords.evaluatedRetry.observations.estimatedDbBytes,
  ] : [];
  const expectedEventLoopStallMs = requiredResourceSourcesComplete ? [
    ...stageMetricRecords.controlStandard.observations.eventLoopStallMs,
    ...maintenance.rebuild.runtimeEnvelope.eventLoopStallMs.samples,
    ...maintenance.incrementalUpdate.runtimeEnvelope.eventLoopStallMs.samples,
    ...stageMetricRecords.evaluatedStandard.observations.eventLoopStallMs,
    ...stageMetricRecords.evaluatedRetry.observations.eventLoopStallMs,
  ] : [];
  const requiredResourceAggregateValid = requiredResourceSourcesComplete
    && expectedEstimatedDbBytes.length >= 15
    && expectedEstimatedDbBytes.every((value) => (
      Number.isSafeInteger(value) && value >= 0
    ))
    && expectedEventLoopStallMs.length >= 11
    && compactNumericArray(expectedEventLoopStallMs);
  const expectedRequiredResourceStatus = requiredResourceSourceInvalid
    || (requiredResourceSourcesComplete && !requiredResourceAggregateValid)
    ? "INVALID" : requiredResourceAggregateValid ? "PASS" : "PENDING";
  if (!hasExactKeys(requiredResourceEnvelope, [
    "status", "includedStages", "estimatedDbBytes", "eventLoopStallMs",
  ]) || !["PENDING", "PASS", "INVALID"].includes(requiredResourceEnvelope.status)) {
    integrity(state, "app_compact_proxy_required_resource_envelope_invalid");
  } else if (requiredResourceEnvelope.status === "PASS") {
    if (expectedRequiredResourceStatus !== "PASS"
      || canonicalJson(requiredResourceEnvelope.includedStages)
        !== canonicalJson(requiredResourceIncludedStages)
      || !requiredResourceMetricValid(requiredResourceEnvelope.estimatedDbBytes, true, 15)
      || !requiredResourceMetricValid(requiredResourceEnvelope.eventLoopStallMs, false, 11)
      || canonicalJson(requiredResourceEnvelope.estimatedDbBytes.samples)
        !== canonicalJson(expectedEstimatedDbBytes)
      || canonicalJson(requiredResourceEnvelope.eventLoopStallMs.samples)
        !== canonicalJson(expectedEventLoopStallMs)) {
      integrity(state, "app_compact_proxy_required_resource_envelope_invalid");
    }
  } else {
    const emptyValid = Array.isArray(requiredResourceEnvelope.includedStages)
      && requiredResourceEnvelope.includedStages.length === 0
      && requiredResourceEmptyMetricValid(requiredResourceEnvelope.estimatedDbBytes)
      && requiredResourceEmptyMetricValid(requiredResourceEnvelope.eventLoopStallMs);
    if (!emptyValid
      || requiredResourceEnvelope.status !== expectedRequiredResourceStatus) {
      integrity(state, "app_compact_proxy_required_resource_envelope_invalid");
    } else if (requiredResourceEnvelope.status === "INVALID") {
      failure(state, "app_compact_proxy_required_resource_envelope_failed");
    } else {
      blocker(state, "app_compact_proxy_required_resource_envelope_incomplete");
    }
  }

  const optional = compact.optionalDiagnostics;
  const optionalEntryValid = (entry) => hasExactKeys(entry, [
    "status", "samples", "maximum",
  ]) && (entry.status === "UNSUPPORTED"
    ? compactNumericArray(entry.samples) && entry.samples.length === 0 && entry.maximum === null
    : entry.status === "OBSERVED"
      && compactNumericArray(entry.samples)
      && entry.samples.length > 0
      && entry.maximum === Math.max(...entry.samples)
    );
  if (!hasExactKeys(optional, ["processMemory", "heap"])
    || !optionalEntryValid(optional?.processMemory)
    || !optionalEntryValid(optional?.heap)) {
    integrity(state, "app_compact_proxy_optional_diagnostics_invalid");
  }

  const machineStatus = resultStatus(state, machineStart);
  if (compact.status === "INVALID") {
    failure(state, "app_compact_proxy_invalid");
  } else if (compact.status === COMPACT_PROXY_COMPLETION_STATUS) {
    if (machineStatus !== "PASS") {
      integrity(state, "app_compact_proxy_ready_pass_invariant_invalid");
    }
  } else if (machineStatus === "PASS") {
    integrity(state, "app_compact_proxy_completion_status_invalid");
  } else {
    blocker(state, "app_compact_proxy_not_ready");
  }

  const owner = compact.ownerDisposition;
  if (!hasExactKeys(owner, ["status", "reason", "trackerRecorded"])
    || owner.status !== "PENDING"
    || owner.reason !== null
    || owner.trackerRecorded !== false) {
    integrity(state, "app_compact_proxy_owner_disposition_invalid");
  } else if (compact.status === COMPACT_PROXY_COMPLETION_STATUS
    && machineStatus === "PASS") {
    blocker(state, "app_compact_proxy_owner_disposition_required");
  }
  return {
    status: resultStatus(state, start),
    profile: COMPACT_PROXY_PROFILE,
    planVersion: compact.planVersion,
    planSha256: compact.planSha256,
    machineStatus: compact.machineStatus,
    completionStatus: compact.status,
    expectedEpisodeCount: binding?.expectedEpisodeCount ?? null,
    boundEpisodeCount: binding?.boundEpisodeCount ?? null,
    ownerDispositionStatus: owner?.status ?? null,
  };
}

function nearestRankPercentile(samples, percentile) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function deviceMetricDefinitionMatches(recorded, definition, required) {
  return hasExactKeys(recorded, DEVICE_METRIC_KEYS)
    && recorded.id === definition?.id
    && recorded.unit === definition?.unit
    && recorded.sampleMode === definition?.sampleMode
    && recorded.collectionMethod === (definition?.collectionMethod ?? null)
    && recorded.required === required
    && hasExactKeys(recorded.threshold, Object.keys(definition?.threshold ?? {}))
    && Object.values(recorded.threshold).every((value) => (
      value === null || (Number.isFinite(value) && value >= 0)
    ));
}

function deviceMetricTimestampValid(recordedAt, receipt) {
  return isCanonicalIsoTimestamp(recordedAt)
    && (!isCanonicalIsoTimestamp(receipt?.startedAt) || recordedAt >= receipt.startedAt)
    && (!isCanonicalIsoTimestamp(receipt?.finishedAt) || recordedAt <= receipt.finishedAt);
}

function unsupportedDeviceMetricShapeValid(recorded, definition, receipt, expectedReason = null) {
  return deviceMetricDefinitionMatches(recorded, definition, true)
    && recorded.method === "unsupported"
    && typeof recorded.evidenceSource === "string"
    && recorded.evidenceSource.length > 0
    && recorded.status === "BLOCKED"
    && typeof recorded.reason === "string"
    && recorded.reason.length > 0
    && (expectedReason === null || recorded.reason === expectedReason)
    && Array.isArray(recorded.rawSamples)
    && recorded.rawSamples.length === 0
    && Array.isArray(recorded.evaluatedSamples)
    && recorded.evaluatedSamples.length === 0
    && recorded.p50 === null
    && recorded.p95 === null
    && recorded.minimum === null
    && recorded.maximum === null
    && deviceMetricTimestampValid(recorded.recordedAt, receipt);
}

function requiredPassDeviceMetricShapeValid(recorded, definition, measurement, receipt) {
  if (!deviceMetricDefinitionMatches(recorded, definition, true)
    || !["measured", "estimated", "manual"].includes(recorded.method)
    || typeof recorded.evidenceSource !== "string"
    || recorded.evidenceSource.length === 0
    || recorded.status !== "PASS"
    || recorded.reason !== "frozen threshold satisfied"
    || !deviceMetricTimestampValid(recorded.recordedAt, receipt)
    || !Array.isArray(recorded.rawSamples)
    || !Array.isArray(recorded.evaluatedSamples)
    || !recorded.rawSamples.every((sample) => Number.isFinite(sample) && sample >= 0)) {
    return false;
  }
  const expectedRawCount = definition.sampleMode === "series"
    ? measurement.warmupSamples + measurement.sampleCount
    : definition.sampleMode === "snapshot" ? 1 : null;
  const minimumSamples = ["observed-series", "maximum-observed-series"].includes(
    definition.sampleMode,
  ) ? definition.minimumSamples ?? 1 : 1;
  if (recorded.rawSamples.length < minimumSamples
    || (expectedRawCount !== null && recorded.rawSamples.length !== expectedRawCount)) {
    return false;
  }
  const expectedEvaluatedSamples = definition.sampleMode === "series"
    ? recorded.rawSamples.slice(measurement.warmupSamples)
    : [...recorded.rawSamples];
  if (JSON.stringify(recorded.evaluatedSamples) !== JSON.stringify(expectedEvaluatedSamples)
    || expectedEvaluatedSamples.length === 0) return false;
  const expectedStatistics = {
    p50: nearestRankPercentile(expectedEvaluatedSamples, 0.5),
    p95: nearestRankPercentile(expectedEvaluatedSamples, 0.95),
    minimum: Math.min(...expectedEvaluatedSamples),
    maximum: Math.max(...expectedEvaluatedSamples),
  };
  if (recorded.p50 !== expectedStatistics.p50
    || recorded.p95 !== expectedStatistics.p95
    || recorded.minimum !== expectedStatistics.minimum
    || recorded.maximum !== expectedStatistics.maximum) return false;
  const thresholdValues = {
    p50Max: recorded.p50,
    p95Max: recorded.p95,
    p50Min: recorded.p50,
    p95Min: recorded.p95,
    minMin: recorded.minimum,
    maxMax: recorded.maximum,
  };
  return Object.entries(recorded.threshold).length > 0
    && Object.entries(recorded.threshold).every(([key, threshold]) => (
      threshold !== null
      && (key.endsWith("Max")
        ? thresholdValues[key] <= threshold
        : thresholdValues[key] >= threshold)
    ));
}

function requiredPassDeviceMetricEvidencePathValid(recorded, definition, runtimeEnvelope) {
  if (DIAGNOSTICS_DERIVED_REQUIRED_METRIC_IDS.has(definition?.id)) {
    return recorded.method === "measured"
      && recorded.evidenceSource === "retrieval-diagnostics-staged";
  }
  if (definition?.id === PEAK_DATABASE_METRIC_ID) {
    return recorded.method === "estimated"
      && recorded.evidenceSource === "runtime-envelope-resource-1000ms"
      && runtimeEnvelope?.resourceIntervalMs === 1_000
      && Array.isArray(recorded.rawSamples)
      && runtimeEnvelope?.databaseSampleCount === recorded.rawSamples.length;
  }
  if (definition?.id === PROCESS_MEMORY_METRIC_ID) {
    const counter = runtimeEnvelope?.runtimeProcessMemoryCounter;
    return recorded.method === "measured"
      && ["resident_set_bytes", "private_bytes"].includes(counter)
      && recorded.evidenceSource === `runtime-envelope-process-${counter}-1000ms`
      && runtimeEnvelope?.resourceIntervalMs === 1_000
      && Array.isArray(recorded.rawSamples)
      && runtimeEnvelope?.runtimeProcessMemorySampleCount === recorded.rawSamples.length;
  }
  if (definition?.id === MAX_EVENT_LOOP_STALL_METRIC_ID) {
    return recorded.method === "measured"
      && recorded.evidenceSource === "runtime-envelope-main-thread-gap-50ms"
      && runtimeEnvelope?.stallIntervalMs === 50
      && Array.isArray(recorded.rawSamples)
      && runtimeEnvelope?.stallSampleCount === recorded.rawSamples.length;
  }
  return ["measured", "estimated", "manual"].includes(recorded.method)
    && recorded.evidenceSource === "operator";
}

const DEVICE_DIAGNOSTIC_EVENT_KEYS = Object.freeze([
  "sequence", "elapsedMs", "runId", "surface", "phase", "outcome", "metrics",
]);
const DEVICE_DIAGNOSTIC_PHASES = new Set([
  "memory_search", "graph_snapshot", "graph_preflight", "ppr_solve", "graph_workset",
  "graph_worker", "queue_release", "reranker", "recovery_standard", "recovery_relaxed",
  "recovery_projection", "finalization_reserve",
]);
const DEVICE_DIAGNOSTIC_OUTCOMES = new Set([
  "started", "completed", "skipped", "fallback", "aborted", "deadline", "failed",
  "late_discarded",
]);
const DEVICE_DIAGNOSTIC_REASONS = new Set([
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
  "queue_release_timeout", "ranked_path_invalid", "ranked_set_incomplete",
  "request_invalidated", "request_unavailable", "reserve_aborted", "reserve_exhausted",
  "reserve_failed", "reserve_not_entered", "reserve_overrun", "reserve_protected",
  "seed_unavailable", "semantic_none", "snapshot_budget", "solve_unavailable",
  "source_changed", "source_unavailable", "standard_unavailable", "standard_sufficient",
  "partial_requires_stage", "stage_control_reserved", "stage_unavailable",
  "stage_validation_deadline", "stage_validation_failed", "timeout", "token_consumed",
  "unknown_error", "workset_budget", "workset_empty",
]);
const DEVICE_DIAGNOSTIC_METRICS = new Set([
  "durationMs", "remainingMs", "configuredReserveMs", "seedCount", "nodeCount", "edgeCount", "snapshotBytes",
  "opaqueBridgeCount", "liftedStateCount", "transitionCount", "projectedOperations",
  "projectedBytes", "iterationCount", "errorBound", "localCount", "deepCount",
  "convergenceCount", "unionCount", "cosinePassCount", "selectedCount", "candidateCount",
  "documentCount", "batchCount", "chunkCount", "queueWaitMs", "workerDurationMs",
  "maxBatchDurationMs", "cancelRequested", "cancelObserved", "acceptedCount",
  "lateDiscardCount", "resultCount", "providerCallCount", "retryConsumed",
  "temporalFilterApplied", "temporalViolationCount",
]);

function inspectDeviceCancellationQueueReleaseEvidence(measurement, plan, state) {
  const invalid = () => {
    integrity(state, "app_device_cancellation_queue_release_pass_invariant_invalid");
    return false;
  };
  const diagnostics = measurement?.diagnostics;
  const episodes = measurement?.diagnosticsSummary?.measurementEpisodes;
  const diagnosticsPlan = plan?.diagnosticsEvidence;
  if (!hasExactKeys(diagnostics, [
    "standardPerformance", "retryPerformanceBatches", "cancellationProbe",
  ])
    || !isObject(diagnosticsPlan)
    || !Array.isArray(diagnostics.retryPerformanceBatches)
    || diagnostics.retryPerformanceBatches.length !== 2
    || !isObject(episodes)) return invalid();

  const validateProjection = (projection) => {
    if (!hasExactKeys(projection, [
      "schemaVersion", "capacity", "droppedEventCount", "events",
    ])
      || projection.schemaVersion !== diagnosticsPlan.schemaVersion
      || projection.capacity !== diagnosticsPlan.requiredSessionCapacity
      || projection.droppedEventCount !== 0
      || !Array.isArray(projection.events)
      || projection.events.length < 1
      || projection.events.length > projection.capacity) return false;
    let previousSequence = 0;
    let previousElapsedMs = 0;
    for (const event of projection.events) {
      const invocationScoped = event?.phase !== "finalization_reserve"
        || (event?.outcome === "skipped" && event?.reason === "reserve_protected");
      const baseExpectedKeys = event?.reason === undefined
        ? DEVICE_DIAGNOSTIC_EVENT_KEYS
        : [...DEVICE_DIAGNOSTIC_EVENT_KEYS, "reason"];
      const expectedKeys = invocationScoped
        ? [...baseExpectedKeys, "invocationOrdinal"]
        : baseExpectedKeys;
      if (!hasExactKeys(event, expectedKeys)
        || !Number.isSafeInteger(event.sequence)
        || event.sequence <= previousSequence
        || !Number.isFinite(event.elapsedMs)
        || event.elapsedMs < previousElapsedMs
        || typeof event.runId !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(event.runId)
        || event.surface !== diagnosticsPlan.performanceSurface
        || !DEVICE_DIAGNOSTIC_PHASES.has(event.phase)
        || !DEVICE_DIAGNOSTIC_OUTCOMES.has(event.outcome)
        || (event.reason !== undefined && !DEVICE_DIAGNOSTIC_REASONS.has(event.reason))
        || (invocationScoped
          && (!Number.isSafeInteger(event.invocationOrdinal)
            || event.invocationOrdinal !== 0))
        || !isObject(event.metrics)
        || Object.entries(event.metrics).some(([key, value]) => (
          !DEVICE_DIAGNOSTIC_METRICS.has(key)
          || !Number.isFinite(value)
          || value < 0
        ))
        || (event.phase === "finalization_reserve"
          && (!Number.isFinite(event.metrics.configuredReserveMs)
            || event.metrics.configuredReserveMs <= 0))) return false;
      previousSequence = event.sequence;
      previousElapsedMs = event.elapsedMs;
    }
    return true;
  };

  const standard = diagnostics.standardPerformance;
  const retryBatches = diagnostics.retryPerformanceBatches;
  const cancellation = diagnostics.cancellationProbe;
  if (![standard, ...retryBatches, cancellation].every(validateProjection)) return invalid();
  if ([standard, ...retryBatches].some((projection) => (
    projection.events.some((event) => event.phase === "queue_release")
  ))) return invalid();

  const validatePerformanceWorkers = (projection, expectedRunCount, expectedPerRun) => {
    const completed = projection.events.filter((event) => (
      event.phase === "graph_worker" && event.outcome === "completed"
    ));
    if (!Number.isSafeInteger(expectedRunCount)
      || !Number.isSafeInteger(expectedPerRun)
      || completed.length !== expectedRunCount * expectedPerRun
      || completed.some((event) => (
        event.reason !== undefined
        || !Number.isFinite(event.metrics.maxBatchDurationMs)
        || event.metrics.acceptedCount !== 1
        || (event.metrics.cancelRequested || 0) !== 0
      ))) return null;
    const countsByRun = new Map();
    for (const event of completed) {
      countsByRun.set(event.runId, (countsByRun.get(event.runId) || 0) + 1);
    }
    if (countsByRun.size !== expectedRunCount
      || [...countsByRun.values()].some((count) => count !== expectedPerRun)) return null;
    return {
      durations: completed.map((event) => event.metrics.maxBatchDurationMs),
      runIds: [...countsByRun.keys()],
    };
  };

  const standardWorkers = validatePerformanceWorkers(
    standard,
    diagnosticsPlan.standardPerformanceEpisodeCount,
    1,
  );
  const retryBatchWorkers = retryBatches.map((projection, index) => (
    validatePerformanceWorkers(
      projection,
      diagnosticsPlan.retryPerformanceBatchEpisodeCounts?.[index],
      diagnosticsPlan.maximumMemorySearchAttemptsPerEpisode,
    )
  ));
  if (!standardWorkers || retryBatchWorkers.some((workers) => !workers)) return invalid();
  const validatePerformanceFinalization = (projection, runIdList) => {
    const finalizationEvents = projection.events.filter((event) => (
      event.phase === "finalization_reserve"
    ));
    const eventsByRun = new Map(runIdList.map((runId) => [runId, []]));
    for (const event of finalizationEvents) {
      const runEvents = eventsByRun.get(event.runId);
      if (!runEvents) return null;
      runEvents.push(event);
    }
    const configuredReserves = [];
    const terminalRemaining = [];
    for (const runId of runIdList) {
      const runEvents = eventsByRun.get(runId) || [];
      const configured = runEvents.map((event) => event.metrics.configuredReserveMs);
      const boundaries = runEvents.filter((event) => (
        ["completed", "aborted", "deadline", "failed"].includes(event.outcome)
        || (event.outcome === "skipped" && event.reason === "reserve_not_entered")
      ));
      if (runEvents.length < 1
        || configured.some((value) => !Number.isFinite(value) || value <= 0)
        || new Set(configured).size !== 1
        || boundaries.length !== 1
        || !(
          boundaries[0].outcome === "completed"
          || (boundaries[0].outcome === "skipped"
            && boundaries[0].reason === "reserve_not_entered")
        )
        || !Number.isFinite(boundaries[0].metrics.remainingMs)
        || boundaries[0].metrics.remainingMs <= 0) return null;
      configuredReserves.push(configured[0]);
      terminalRemaining.push(boundaries[0].metrics.remainingMs);
    }
    return { configuredReserves, terminalRemaining };
  };
  const standardFinalization = validatePerformanceFinalization(
    standard,
    standardWorkers.runIds,
  );
  const retryFinalizations = retryBatches.map((projection, index) => (
    validatePerformanceFinalization(projection, retryBatchWorkers[index].runIds)
  ));
  if (!standardFinalization || retryFinalizations.some((entry) => !entry)) return invalid();
  const cancellationFinalizationEvents = cancellation.events.filter((event) => (
    event.phase === "finalization_reserve"
  ));
  const cancellationBoundaries = cancellationFinalizationEvents.filter((event) => (
    ["completed", "aborted", "deadline", "failed"].includes(event.outcome)
    || (event.outcome === "skipped" && event.reason === "reserve_not_entered")
  ));
  if (cancellationFinalizationEvents.length < 1
    || cancellationBoundaries.length !== 1
    || new Set(cancellationFinalizationEvents.map((event) => (
      event.metrics.configuredReserveMs
    ))).size !== 1) return invalid();
  const allConfiguredReserves = [
    ...standardFinalization.configuredReserves,
    ...retryFinalizations.flatMap((entry) => entry.configuredReserves),
    ...cancellationFinalizationEvents.map((event) => event.metrics.configuredReserveMs),
  ];
  if (new Set(allConfiguredReserves).size !== 1) return invalid();
  const observedMaxBatchDurationMs = Math.max(
    ...standardWorkers.durations,
    ...retryBatchWorkers.flatMap((workers) => workers.durations),
  );

  const cancellationGraphAndQueue = cancellation.events.filter((event) => (
    event.phase === "graph_worker" || event.phase === "queue_release"
  ));
  if (cancellationGraphAndQueue.length !== 6) return invalid();
  const [workerStart, requested, queueStart, observed, late, queueCompleted] =
    cancellationGraphAndQueue;
  const runIds = new Set(cancellationGraphAndQueue.map((event) => event.runId));
  const exactTopology = runIds.size === 1
    && workerStart.phase === "graph_worker"
    && workerStart.outcome === "started"
    && workerStart.reason === undefined
    && requested.phase === "graph_worker"
    && requested.outcome === "aborted"
    && requested.reason === "cancel_requested"
    && requested.metrics.cancelRequested > 0
    && (requested.metrics.acceptedCount || 0) === 0
    && queueStart.phase === "queue_release"
    && queueStart.outcome === "started"
    && queueStart.reason === undefined
    && observed.phase === "graph_worker"
    && observed.outcome === "aborted"
    && observed.reason === "cancel_observed"
    && observed.metrics.cancelRequested > 0
    && observed.metrics.cancelObserved > 0
    && (observed.metrics.acceptedCount || 0) === 0
    && late.phase === "graph_worker"
    && late.outcome === "late_discarded"
    && late.reason === "late_result"
    && late.metrics.cancelRequested > 0
    && late.metrics.lateDiscardCount > 0
    && (late.metrics.acceptedCount || 0) === 0
    && queueCompleted.phase === "queue_release"
    && queueCompleted.outcome === "completed"
    && queueCompleted.reason === undefined
    && Number.isFinite(queueCompleted.metrics.durationMs)
    && queueCompleted.metrics.resultCount === 1;
  if (!exactTopology) return invalid();

  const boundEpisodes = measurement?.workloadBinding?.episodes;
  const boundRunIdsMatch = (stage, runIdList) => {
    if (!Array.isArray(boundEpisodes)) return false;
    const entries = boundEpisodes.filter((entry) => entry?.stage === stage);
    return entries.length === runIdList.length
      && entries.every((entry, index) => (
        entry?.opaqueCorrelationSha256
          === sha256(`retrieval-performance-run\u0000${runIdList[index]}`)
      ));
  };
  const cancellationRunId = cancellationGraphAndQueue[0].runId;
  if (cancellationFinalizationEvents.some((event) => event.runId !== cancellationRunId)) {
    return invalid();
  }
  if (measurement?.workloadBinding?.status === "PASS"
    && (!boundRunIdsMatch("standardPerformance", standardWorkers.runIds)
      || !boundRunIdsMatch("retryPerformanceBatch1", retryBatchWorkers[0].runIds)
      || !boundRunIdsMatch("retryPerformanceBatch2", retryBatchWorkers[1].runIds)
      || !boundRunIdsMatch("cancellationProbe", [cancellationRunId]))) return invalid();

  const derived = {
    cancelToWorkerObservedMs: observed.elapsedMs - requested.elapsedMs,
    cancelToLateDiscardedMs: late.elapsedMs - requested.elapsedMs,
    cancelToProbeCompletedMs: queueCompleted.elapsedMs - requested.elapsedMs,
    queueReleaseProbeResultCount: queueCompleted.metrics.resultCount,
  };
  const cancellationSummary = episodes.cancellationProbe;
  const summaryShapeValid = episodes.standardPerformance?.status === "VALID"
    && episodes.standardPerformance?.episodeCount
      === diagnosticsPlan.standardPerformanceEpisodeCount
    && episodes.retryPerformance?.status === "VALID"
    && episodes.retryPerformance?.episodeCount === diagnosticsPlan.retryPerformanceEpisodeCount
    && Array.isArray(episodes.retryPerformanceBatches)
    && episodes.retryPerformanceBatches.length === 2
    && episodes.retryPerformanceBatches.every((batch, index) => (
      batch?.status === "VALID"
      && batch.episodeCount === diagnosticsPlan.retryPerformanceBatchEpisodeCounts[index]
    ))
    && cancellationSummary?.status === "VALID"
    && cancellationSummary.episodeCount === diagnosticsPlan.cancellationProbeEpisodeCount
    && cancellationSummary.cancellationProbeEpisodeCount
      === diagnosticsPlan.cancellationProbeEpisodeCount
    && cancellationSummary.graphQueueReleaseAbsoluteEnvelopeMs === 8_000
    && cancellationSummary.graphMaxBatchDurationMs === observedMaxBatchDurationMs
    && measurement.diagnosticsSummary?.cancelRequested > 0
    && measurement.diagnosticsSummary?.cancelObserved > 0
    && measurement.diagnosticsSummary?.lateDiscardCount > 0
    && measurement.diagnosticsSummary?.acceptedAfterCancelCount === 0
    && measurement.diagnosticsSummary?.finalizationReserveBinding?.status === "VALID"
    && measurement.diagnosticsSummary.finalizationReserveBinding.configuredReserveMs
      === allConfiguredReserves[0]
    && canonicalJson(measurement.diagnosticsSummary?.series?.finalizationConfiguredReserveMs)
      === canonicalJson(standardFinalization.configuredReserves)
    && canonicalJson(measurement.diagnosticsSummary?.series?.finalizationRemainingMs)
      === canonicalJson(standardFinalization.terminalRemaining)
    && canonicalJson(measurement.diagnosticsSummary?.retrySeries?.finalizationConfiguredReserveMs)
      === canonicalJson(retryFinalizations.flatMap((entry) => entry.configuredReserves))
    && canonicalJson(measurement.diagnosticsSummary?.retrySeries?.finalizationRemainingMs)
      === canonicalJson(retryFinalizations.flatMap((entry) => entry.terminalRemaining))
    && canonicalJson(measurement.metrics?.["retrieval.finalizationReserveMs"]?.rawSamples)
      === canonicalJson(standardFinalization.configuredReserves)
    && canonicalJson(measurement.metrics?.["retrieval.retryFinalizationReserveMs"]?.rawSamples)
      === canonicalJson(retryFinalizations.flatMap((entry) => entry.configuredReserves));
  const derivedShapeValid = Object.values(derived).every((value) => (
    Number.isFinite(value) && value >= 0
  ))
    && derived.cancelToWorkerObservedMs <= derived.cancelToLateDiscardedMs
    && derived.cancelToLateDiscardedMs <= derived.cancelToProbeCompletedMs
    && derived.cancelToProbeCompletedMs <= 8_000
    && Object.entries(derived).every(([key, value]) => cancellationSummary?.[key] === value);
  return summaryShapeValid && derivedShapeValid ? true : invalid();
}

function inspectDeviceMeasurementPassInvariant(receipt, manifest, state) {
  const start = checkpoint(state);
  const measurement = receipt?.deviceMeasurement;
  const identity = receipt?.identity;
  const plan = manifest?.deviceMeasurementPlan;
  const requiresPass = (receipt?.overall === "PASS" || measurement?.overall === "PASS")
    && receipt?.fixtureVersion === manifest?.fixtureVersion
    && isCanonicalIsoTimestamp(receipt?.startedAt)
    && isCanonicalIsoTimestamp(receipt?.finishedAt);
  if (!requiresPass) return { status: "NOT_EVALUATED" };

  const reconstructedPlan = reconstructFrozenDevicePlanFromReceipt(plan, measurement);
  const unredactedPlanSha256 = reconstructedPlan
    ? sha256(canonicalJson(reconstructedPlan))
    : null;
  let projectedPlanSha256 = null;
  try {
    projectedPlanSha256 = reconstructedPlan
      ? sha256(canonicalJson(projectDevicePlanForReceipt(reconstructedPlan)))
      : null;
  } catch {
    // The manifest workload inspector reports the precise structural error.
  }
  const runtimeEnvelope = measurement?.runtimeEnvelope;
  const planHashesMatch = isSha256(measurement?.planSha256)
    && measurement.planSha256 === identity?.deviceMeasurementPlanSha256
    && measurement.planSha256 === projectedPlanSha256
    && measurement.planSha256 !== unredactedPlanSha256;
  const invalidRequiredMetricIds = Array.isArray(plan?.requiredMetrics)
    ? plan.requiredMetrics.filter((definition) => !requiredPassDeviceMetricShapeValid(
      measurement?.metrics?.[definition?.id],
      definition,
      measurement,
      receipt,
    ) || !requiredPassDeviceMetricEvidencePathValid(
      measurement?.metrics?.[definition?.id],
      definition,
      runtimeEnvelope,
    )).map((definition) => definition?.id ?? "unknown")
    : ["manifest-required-metrics"];
  for (const id of invalidRequiredMetricIds) {
    integrity(state, `app_device_metric_pass_invariant_invalid:${id}`);
  }
  const processMemoryMetric = measurement?.metrics?.[PROCESS_MEMORY_METRIC_ID];
  const processMemoryCounter = runtimeEnvelope?.runtimeProcessMemoryCounter;
  const processMemoryRuntimeValid = processMemoryMetric?.method === "measured"
    && ["resident_set_bytes", "private_bytes"].includes(processMemoryCounter)
    && processMemoryMetric.evidenceSource
      === `runtime-envelope-process-${processMemoryCounter}-1000ms`
    && isObject(runtimeEnvelope)
    && runtimeEnvelope.status === "PASS"
    && runtimeEnvelope.workloadCoverageStatus === "PASS"
    && runtimeEnvelope.sourceCoverage?.database === "PASS"
    && runtimeEnvelope.sourceCoverage?.processMemory === "PASS"
    && runtimeEnvelope.sourceCoverage?.eventLoopStall === "PASS"
    && runtimeEnvelope.runtimeProcessMemorySourceAvailable === true
    && Array.isArray(processMemoryMetric.rawSamples)
    && runtimeEnvelope.runtimeProcessMemorySampleCount === processMemoryMetric.rawSamples.length
    && runtimeEnvelope.iosEvidenceStatus === "NOT_REQUIRED"
    && runtimeEnvelope.externalMemoryEnvelope === null
    && runtimeEnvelope.evidenceSource === "workload-bound-runtime-envelope"
    && isCanonicalIsoTimestamp(runtimeEnvelope.startedAt)
    && isCanonicalIsoTimestamp(runtimeEnvelope.finishedAt)
    && runtimeEnvelope.startedAt >= receipt.startedAt
    && runtimeEnvelope.finishedAt <= receipt.finishedAt
    && runtimeEnvelope.finishedAt >= runtimeEnvelope.startedAt;
  if (!processMemoryRuntimeValid) {
    integrity(state, "app_process_memory_pass_invariant_invalid");
  }
  const cancellationQueueReleaseValid = inspectDeviceCancellationQueueReleaseEvidence(
    measurement,
    plan,
    state,
  );
  const requiredMetricsPass = invalidRequiredMetricIds.length === 0;
  const valid = isObject(measurement)
    && isObject(identity)
    && isObject(plan)
    && measurement.overall === "PASS"
    && measurement.planVersion === plan.version
    && measurement.planStatus === "FROZEN"
    && planHashesMatch
    && measurement.percentileMethod === plan.percentileMethod
    && measurement.warmupSamples === plan.warmupSamples
    && measurement.sampleCount === plan.sampleCount
    && measurement.performanceSurface === plan.diagnosticsEvidence?.performanceSurface
    && measurement.diagnosticsGate?.status === "PASS"
    && measurement.diagnosticsGate?.schemaVersion === plan.diagnosticsEvidence?.schemaVersion
    && measurement.diagnosticsGate?.capacity === plan.diagnosticsEvidence?.requiredSessionCapacity
    && measurement.rerankerGate?.status === "PASS"
    && requiredMetricsPass
    && processMemoryRuntimeValid
    && cancellationQueueReleaseValid;
  if (!valid) integrity(state, "app_device_measurement_pass_invariant_invalid");
  return {
    status: resultStatus(state, start),
    planVersion: measurement?.planVersion ?? null,
    planStatus: measurement?.planStatus ?? null,
    planSha256: measurement?.planSha256 ?? null,
  };
}

async function inspectCurrentFixtureBundle(
  rootDirectory,
  manifest,
  appReceipt,
  state,
) {
  const start = checkpoint(state);
  const summary = {
    status: "BLOCKED",
    expectedFileCount: 0,
    verifiedFileCount: 0,
    missingOrUnreadableFileCount: 0,
    digestMismatchCount: 0,
    expectedBundleSha256: null,
    temporalExpectedCount: 0,
    temporalVerifiedCount: 0,
    temporalMismatchCount: 0,
  };
  if (!manifest) return summary;
  if (!isObject(manifest.files)) {
    integrity(state, "manifest_fixture_files_invalid");
    summary.status = resultStatus(state, start);
    return summary;
  }
  const entries = sortedEntries(manifest.files);
  summary.expectedFileCount = entries.length;
  if (entries.length === 0 || entries.some(([path, digest]) => (
    !isSafeFixturePath(path) || !isSha256(digest)
  ))) {
    integrity(state, "manifest_fixture_files_invalid");
    summary.status = resultStatus(state, start);
    return summary;
  }
  summary.expectedBundleSha256 = sha256(JSON.stringify(entries));
  const receiptBundleSha256 = appReceipt?.identity?.fixtureBundleSha256;
  if (isSha256(receiptBundleSha256)
    && receiptBundleSha256 !== summary.expectedBundleSha256) {
    blocker(state, "app_receipt_fixture_bundle_not_current");
  }

  const temporalMtimes = manifest.temporalFixtureMtimes;
  if (!isObject(temporalMtimes)) {
    integrity(state, "manifest_temporal_fixture_mtimes_invalid");
    summary.status = resultStatus(state, start);
    return summary;
  }
  const temporalEntries = sortedEntries(temporalMtimes);
  summary.temporalExpectedCount = temporalEntries.length;
  const filePaths = new Set(entries.map(([path]) => path));
  if (temporalEntries.length === 0 || temporalEntries.some(([path, timestamp]) => (
    !filePaths.has(path) || !isCanonicalIsoTimestamp(timestamp)
  ))) {
    integrity(state, "manifest_temporal_fixture_mtimes_invalid");
  }
  const receiptTemporalMtimes = appReceipt?.identity?.temporalFixtureMtimes;
  if (appReceipt && !isObject(receiptTemporalMtimes)) {
    integrity(state, "app_receipt_temporal_fixture_mtimes_invalid");
  }
  const manifestTemporalPaths = temporalEntries.map(([path]) => path);
  const receiptTemporalPaths = isObject(receiptTemporalMtimes)
    ? Object.keys(receiptTemporalMtimes).sort()
    : [];
  if (appReceipt
    && JSON.stringify(manifestTemporalPaths) !== JSON.stringify(receiptTemporalPaths)) {
    integrity(state, "app_receipt_temporal_fixture_mtime_paths_mismatch");
  }

  const temporalByPath = new Map(temporalEntries);
  await Promise.all(entries.map(async ([fixturePath, expectedDigest]) => {
    const absolutePath = resolve(rootDirectory, "test", fixturePath);
    let bytes;
    try {
      bytes = await readFile(absolutePath);
    } catch {
      summary.missingOrUnreadableFileCount += 1;
      if (temporalByPath.has(fixturePath)) summary.temporalMismatchCount += 1;
      return;
    }
    if (sha256(bytes) !== expectedDigest) {
      summary.digestMismatchCount += 1;
    } else {
      summary.verifiedFileCount += 1;
    }
    if (!temporalByPath.has(fixturePath)) return;
    const expectedMtime = Date.parse(temporalByPath.get(fixturePath));
    const recordedMtimeText = receiptTemporalMtimes?.[fixturePath];
    const recordedMtime = Date.parse(recordedMtimeText);
    if (appReceipt && (!isCanonicalIsoTimestamp(recordedMtimeText)
      || !Number.isFinite(expectedMtime)
      || Math.abs(recordedMtime - expectedMtime) >= 1_000)) {
      integrity(state, "app_receipt_temporal_fixture_mtimes_invalid");
    }
    let currentMtime;
    try {
      currentMtime = (await stat(absolutePath)).mtimeMs;
    } catch {
      summary.temporalMismatchCount += 1;
      return;
    }
    if (!Number.isFinite(currentMtime)
      || Math.abs(currentMtime - expectedMtime) >= 1_000
      || (appReceipt && (!Number.isFinite(recordedMtime)
        || Math.abs(currentMtime - recordedMtime) >= 1_000))) {
      summary.temporalMismatchCount += 1;
    } else {
      summary.temporalVerifiedCount += 1;
    }
  }));
  if (summary.missingOrUnreadableFileCount > 0) {
    blocker(state, "fixture_files_missing_or_unreadable");
  }
  if (summary.digestMismatchCount > 0) blocker(state, "fixture_files_not_current");
  if (summary.temporalMismatchCount > 0) {
    blocker(state, "temporal_fixture_mtime_not_current");
  }
  summary.status = resultStatus(state, start);
  return summary;
}

function appCase(receipt, id) {
  return id === "chat-recovery"
    ? receipt.recoveryCase
    : receipt.pageletCases?.[id];
}

function validateAppCaseBinding(receipt, manifest, id, state) {
  const evidence = appCase(receipt, id);
  const manual = receipt.manualCases?.[id];
  if (!isObject(evidence) || !isObject(manual)) {
    blocker(state, `app_required_slice_missing:${id}`);
    return;
  }
  if (evidence.id !== id || manual.id !== id) {
    integrity(state, `app_required_slice_id_invalid:${id}`);
  }
  if (evidence.status !== manual.status
    || evidence.detail !== manual.detail
    || evidence.recordedAt !== manual.recordedAt) {
    integrity(state, `app_required_slice_binding_mismatch:${id}`);
  }
  inspectStatus(state, evidence.status, {
    fail: `app_required_slice_failed:${id}`,
    blocked: `app_required_slice_not_pass:${id}`,
    invalid: `app_required_slice_status_invalid:${id}`,
  });
  inspectStatus(state, manual.status, {
    fail: `app_manual_slice_failed:${id}`,
    blocked: `app_manual_slice_not_pass:${id}`,
    invalid: `app_manual_slice_status_invalid:${id}`,
  });
  if (evidence.status !== "PASS") return;
  validateTimestampInWindow(
    state,
    evidence.recordedAt,
    receipt.startedAt,
    receipt.finishedAt,
    `app_required_slice_recorded_at:${id}`,
  );
  if (!isSha256(evidence.evidenceSha256)) {
    integrity(state, `app_required_slice_evidence_hash_invalid:${id}`);
  }

  if (id === "chat-recovery") {
    const contract = manifest?.recoveryCase;
    if (manifest && (!isObject(contract)
      || evidence.prompt !== contract.prompt
      || evidence.targetPath !== contract.targetPath)) {
      integrity(state, "app_recovery_manifest_binding_mismatch");
    }
    const finalSources = Array.isArray(evidence.finalSources) ? evidence.finalSources : [];
    if (evidence.targetPresent !== true
      || finalSources.length === 0
      || finalSources.length > 8
      || !finalSources.includes(evidence.targetPath)
      || evidence.invalidSourceCount !== 0
      || evidence.duplicateSourceCount !== 0
      || evidence.opaqueHitCount !== 0
      || evidence.unexpectedSourceCount !== 0
      || evidence.a2FailureReason !== null
      || evidence.sourceBinding?.exactPromptMatched !== true
      || evidence.sourceBinding?.turnStatus !== "completed"
      || evidence.sourceBinding?.sourceSetsMatch !== true
      || evidence.sourceBinding?.diagnosticsRunMatched !== true
      || evidence.topology?.memoryAttemptCount !== 2
      || evidence.topology?.relaxedRetryCount !== 1
      || evidence.topology?.projectionCompletedCount !== 1
      || evidence.topology?.projectionOutcome !== "completed") {
      integrity(state, "app_recovery_pass_invariant_invalid");
    }
    return;
  }

  const contract = manifest?.pageletCases?.[id];
  if (manifest && (!isObject(contract)
    || evidence.entryPath !== contract.entryPath
    || evidence.expectedInsightCount !== contract.expectedInsightCount)) {
    integrity(state, `app_pagelet_manifest_binding_mismatch:${id}`);
  }
  if (!pageletSourceBindingValid(evidence.sourceBinding)) {
    integrity(state, `app_pagelet_source_binding_invalid:${id}`);
  }
  const expectedCount = evidence.expectedInsightCount;
  const insights = Array.isArray(evidence.insights) ? evidence.insights : [];
  const invalidCountKeys = [
    "invalidInsightCount",
    "invalidSourceCount",
    "duplicateInsightIdCount",
    "duplicateCandidateCount",
    "duplicateReceiptCount",
    "duplicateSourceCount",
    "opaqueHitCount",
    "unexpectedSourceCount",
  ];
  const passCountsValid = Number.isInteger(expectedCount)
    && evidence.observedInsightCount === expectedCount
    && evidence.verifiedInsightCount === expectedCount
    && insights.length === expectedCount
    && invalidCountKeys.every((key) => evidence[key] === 0)
    && insights.every((insight) => insight?.verified === true);
  if (!passCountsValid) integrity(state, `app_pagelet_pass_invariant_invalid:${id}`);
  const pageletEvidencePayload = {
    id,
    entryPath: evidence.entryPath,
    sourceBinding: evidence.sourceBinding,
    candidateCount: evidence.candidateCount,
    deliveryReceiptCount: evidence.deliveryReceiptCount,
    cacheMutationCount: evidence.cacheMutationCount,
    cacheEntryCountBefore: evidence.cacheEntryCountBefore,
    cacheEntryCountAfter: evidence.cacheEntryCountAfter,
    quietWriteInvariantSatisfied: evidence.quietWriteInvariantSatisfied,
    insights,
  };
  if (sha256(JSON.stringify(pageletEvidencePayload)) !== evidence.evidenceSha256) {
    integrity(state, `app_pagelet_evidence_digest_mismatch:${id}`);
  }
}

async function readOptionalExternalMemoryFile(rootDirectory, relativePath) {
  try {
    return {
      availability: "PRESENT",
      bytes: await readFile(resolve(rootDirectory, relativePath)),
    };
  } catch (error) {
    return {
      availability: error?.code === "ENOENT" ? "ABSENT" : "UNREADABLE",
      bytes: null,
    };
  }
}

function externalMemoryArtifactShapeValid(artifact) {
  const samples = Array.isArray(artifact?.samples) ? artifact.samples : [];
  return hasExactKeys(artifact, EXTERNAL_MEMORY_ARTIFACT_KEYS)
    && artifact.schemaVersion === 1
    && artifact.collectorKind === "system-memory-profiler"
    && EXTERNAL_SYSTEM_MEMORY_PROFILERS.has(artifact.tool)
    && typeof artifact.toolVersion === "string"
    && /^[0-9]+(?:[._-][0-9A-Za-z]+)*$/u.test(artifact.toolVersion)
    && typeof artifact.platform === "string"
    && /^(?:iOS|iPadOS)(?: [0-9A-Za-z._()+-]+){0,3}$/u.test(artifact.platform)
    && artifact.platformClass === "ios-real-device"
    && artifact.runtimeFamily === "ios-wkwebview"
    && isSha256(artifact.appBuildIdentitySha256)
    && artifact.pluginId === PLUGIN_ID
    && isSha256(artifact.pluginArtifactSha256)
    && isSha256(artifact.runnerSha256)
    && isSha256(artifact.deviceIdentitySha256)
    && isCanonicalIsoTimestamp(artifact.windowStartedAt)
    && isCanonicalIsoTimestamp(artifact.windowFinishedAt)
    && Number.isSafeInteger(artifact.sampleIntervalMs)
    && artifact.sampleIntervalMs > 0
    && artifact.sampleIntervalMs <= 1_000
    && samples.length >= 2
    && samples.every((sample) => Number.isSafeInteger(sample) && sample >= 0);
}

async function inspectExternalMemoryBinding(rootDirectory, receipt, manifest, state) {
  const start = checkpoint(state);
  const runtimeEnvelope = receipt?.deviceMeasurement?.runtimeEnvelope;
  const binding = runtimeEnvelope?.externalMemoryEnvelope;
  const bindingPresent = binding !== null && binding !== undefined;
  const [artifactFile, rawExportFile] = await Promise.all([
    readOptionalExternalMemoryFile(rootDirectory, EXTERNAL_MEMORY_ARTIFACT_PATH),
    readOptionalExternalMemoryFile(rootDirectory, EXTERNAL_MEMORY_RAW_EXPORT_PATH),
  ]);
  const fixedArtifactPresent = artifactFile.availability !== "ABSENT";
  const fixedRawExportPresent = rawExportFile.availability !== "ABSENT";
  if (!bindingPresent && !fixedArtifactPresent && !fixedRawExportPresent) {
    return { status: "NOT_APPLICABLE", bindingPresent: false };
  }

  blocker(state, EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON);
  const summary = {
    bindingPresent,
    reason: EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON,
  };
  if (bindingPresent && !isObject(binding)) {
    integrity(state, "app_external_memory_binding_invalid");
    return { status: resultStatus(state, start), ...summary };
  }

  const captureStart = runtimeEnvelope?.externalMemoryCapturePrecondition;
  const blockedState = bindingPresent
    && hasExactKeys(binding, EXTERNAL_MEMORY_BLOCKED_STATE_KEYS);
  const legacyBinding = bindingPresent
    && hasExactKeys(binding, EXTERNAL_MEMORY_BINDING_KEYS);
  if (bindingPresent && !blockedState && !legacyBinding) {
    integrity(state, "app_external_memory_binding_invalid");
    return { status: resultStatus(state, start), ...summary };
  }

  if (blockedState) {
    const processMemory = receipt?.deviceMeasurement?.metrics?.[
      "memory.peakProcessFootprintBytes"
    ];
    const processMemoryDefinition = manifest?.deviceMeasurementPlan?.requiredMetrics
      ?.find((definition) => definition?.id === PROCESS_MEMORY_METRIC_ID);
    const processMemoryBlockedValid = unsupportedDeviceMetricShapeValid(
      processMemory,
      processMemoryDefinition,
      receipt,
      EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON,
    ) && processMemory.evidenceSource === "external-memory-converter-unverified";
    const blockedStateValid = binding.schemaVersion === 1
      && binding.status === "BLOCKED"
      && binding.reason === EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON
      && binding.artifactPath === EXTERNAL_MEMORY_ARTIFACT_PATH.slice("test/".length)
      && isSha256(binding.artifactSha256)
      && binding.rawExportPath === EXTERNAL_MEMORY_RAW_EXPORT_PATH.slice("test/".length)
      && isSha256(binding.rawExportSha256)
      && isSha256(binding.deviceIdentitySha256)
      && hasExactKeys(captureStart, EXTERNAL_MEMORY_CAPTURE_PRECONDITION_KEYS)
      && captureStart.status === "PASS"
      && typeof captureStart.reason === "string"
      && captureStart.reason.length > 0
      && isCanonicalIsoTimestamp(captureStart.checkedAt)
      && captureStart.artifactPath === binding.artifactPath
      && captureStart.artifactAbsent === true
      && captureStart.rawExportPath === binding.rawExportPath
      && captureStart.rawExportAbsent === true
      && runtimeEnvelope.status === "BLOCKED"
      && runtimeEnvelope.reason === EXTERNAL_MEMORY_CONVERTER_UNVERIFIED_REASON
      && runtimeEnvelope.workloadCoverageStatus === "PASS"
      && runtimeEnvelope.iosEvidenceStatus === "BLOCKED"
      && runtimeEnvelope.sourceCoverage?.processMemory === "BLOCKED"
      && processMemoryBlockedValid
      && receipt.deviceMeasurement?.overall !== "PASS"
      && receipt.overall !== "PASS";
    if (!blockedStateValid) {
      integrity(state, "app_external_memory_blocked_state_invalid");
    }
  }

  if (legacyBinding) {
    const receiptPass = receipt.overall === "PASS";
    if (!isSha256(binding.artifactSha256)
      || binding.rawExportPath !== EXTERNAL_MEMORY_RAW_EXPORT_PATH.slice("test/".length)
      || !isSha256(binding.rawExportSha256)
      || !isObject(captureStart)
      || captureStart.artifactPath !== EXTERNAL_MEMORY_ARTIFACT_PATH.slice("test/".length)
      || captureStart.rawExportPath !== EXTERNAL_MEMORY_RAW_EXPORT_PATH.slice("test/".length)) {
      integrity(state, "app_external_memory_binding_invalid");
      return { status: resultStatus(state, start), ...summary };
    }
    if (receiptPass && (captureStart.status !== "PASS"
      || captureStart.artifactAbsent !== true
      || captureStart.rawExportAbsent !== true
      || !isCanonicalIsoTimestamp(captureStart.checkedAt)
      || binding.finalizationVerificationStatus !== "PASS"
      || binding.lifecycleGuardStatus !== "PASS"
      || binding.evidenceCutoffStatus !== "PASS"
      || !isCanonicalIsoTimestamp(binding.evidenceCutoffAt)
      || runtimeEnvelope.status !== "PASS"
      || runtimeEnvelope.workloadCoverageStatus !== "PASS"
      || runtimeEnvelope.iosEvidenceStatus !== "PASS"
      || runtimeEnvelope.sourceCoverage?.processMemory !== "PASS")) {
      integrity(state, "app_external_memory_pass_invariant_invalid");
    }
    if (isCanonicalIsoTimestamp(binding.evidenceCutoffAt)) {
      validateTimestampInWindow(
        state,
        binding.evidenceCutoffAt,
        receipt.startedAt,
        receipt.finishedAt,
        "app_external_memory_evidence_cutoff",
      );
    }
  }

  if (isObject(captureStart)
    && isCanonicalIsoTimestamp(captureStart.checkedAt)
    && isCanonicalIsoTimestamp(runtimeEnvelope?.startedAt)
    && captureStart.checkedAt > runtimeEnvelope.startedAt) {
    integrity(state, "app_external_memory_capture_start_order_invalid");
  }

  const artifactBytes = artifactFile.bytes;
  const rawExportBytes = rawExportFile.bytes;
  if (!artifactBytes || !rawExportBytes
    || artifactBytes.length === 0 || rawExportBytes.length === 0) {
    blocker(state, "external_memory_artifact_missing_or_unreadable");
    return { status: resultStatus(state, start), ...summary };
  }
  const currentArtifactSha256 = sha256(artifactBytes);
  const currentRawExportSha256 = sha256(rawExportBytes);
  const artifactHashMatches = !bindingPresent
    || currentArtifactSha256 === binding.artifactSha256;
  const rawExportHashMatches = !bindingPresent
    || currentRawExportSha256 === binding.rawExportSha256;
  if (!artifactHashMatches) blocker(state, "external_memory_artifact_not_current");
  if (!rawExportHashMatches) blocker(state, "external_memory_raw_export_not_current");

  let artifact;
  let artifactParsed = false;
  try {
    if (artifactBytes[0] === 0xef
      && artifactBytes[1] === 0xbb
      && artifactBytes[2] === 0xbf) {
      throw new Error("external memory artifact must be UTF-8 without BOM");
    }
    const artifactText = new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes);
    artifact = JSON.parse(artifactText);
    artifactParsed = true;
  } catch {
    blocker(state, "external_memory_artifact_not_current");
  }
  if (artifactParsed && !isObject(artifact)) {
    integrity(state, "app_external_memory_artifact_schema_invalid");
  }
  if (!isObject(artifact)
    || artifact.rawExportPath !== EXTERNAL_MEMORY_RAW_EXPORT_PATH.slice("test/".length)
    || artifact.rawExportSha256 !== currentRawExportSha256) {
    blocker(state, "external_memory_artifact_raw_binding_not_current");
  }

  const artifactCurrent = artifactHashMatches && rawExportHashMatches && isObject(artifact);
  if (artifactCurrent) {
    const artifactShapeValid = externalMemoryArtifactShapeValid(artifact);
    if (!artifactShapeValid) {
      integrity(state, "app_external_memory_artifact_schema_invalid");
    } else if (bindingPresent) {
      const samples = artifact.samples;
      const copiedArtifactKeys = EXTERNAL_MEMORY_ARTIFACT_KEYS.filter((key) => (
        key !== "samples"
      ));
      const contract = manifest?.deviceMeasurementPlan?.externalMemoryEvidence;
      const frozenPlan = reconstructFrozenDevicePlanFromReceipt(
        manifest?.deviceMeasurementPlan,
        receipt?.deviceMeasurement,
      );
      const runtime = receipt?.runtime;
      const identity = receipt?.identity;
      const windowStartedMs = Date.parse(artifact.windowStartedAt);
      const windowFinishedMs = Date.parse(artifact.windowFinishedAt);
      const envelopeStartedMs = Date.parse(runtimeEnvelope?.startedAt);
      const envelopeFinishedMs = Date.parse(runtimeEnvelope?.finishedAt);
      const evidenceCutoffMs = Date.parse(
        legacyBinding ? binding.evidenceCutoffAt : receipt.finishedAt,
      );
      const sampledSpanMs = (samples.length - 1) * artifact.sampleIntervalMs;
      const bindingMetadataValid = blockedState
        ? artifact.deviceIdentitySha256 === binding.deviceIdentitySha256
        : copiedArtifactKeys.every((key) => artifact[key] === binding[key])
          && binding.sampleCount === samples.length
          && binding.evidenceSource === `external-system-memory-profiler:${artifact.tool}`;
      const provenanceValid = bindingMetadataValid
        && isObject(contract)
        && artifact.platformClass === contract.requiredPlatformClass
        && artifact.runtimeFamily === contract.requiredRuntimeFamily
        && artifact.counter === contract.counter
        && artifact.unit === contract.unit
        && artifact.processName === contract.processName
        && artifact.appBundleId === contract.appBundleId
        && artifact.deviceIdentitySha256
          === frozenPlan?.externalMemoryEvidence?.deviceIdentitySha256
        && isObject(runtime)
        && runtime.platformClass === artifact.platformClass
        && runtime.runtimeFamily === artifact.runtimeFamily
        && runtime.appVersion === artifact.appVersion
        && runtime.appBuildIdentitySha256 === artifact.appBuildIdentitySha256
        && runtime.pluginVersion === artifact.pluginVersion
        && isObject(identity)
        && identity.pluginArtifactSha256 === artifact.pluginArtifactSha256
        && identity.runnerSha256 === artifact.runnerSha256
        && Number.isFinite(windowStartedMs)
        && Number.isFinite(windowFinishedMs)
        && Number.isFinite(envelopeStartedMs)
        && Number.isFinite(envelopeFinishedMs)
        && Number.isFinite(evidenceCutoffMs)
        && windowFinishedMs >= windowStartedMs
        && windowStartedMs <= envelopeStartedMs
        && windowFinishedMs >= envelopeFinishedMs
        && windowFinishedMs <= evidenceCutoffMs
        && sampledSpanMs >= windowFinishedMs - windowStartedMs;
      if (!provenanceValid) {
        integrity(state, "app_external_memory_artifact_provenance_invalid");
      }
    }
  }
  return {
    status: resultStatus(state, start),
    ...summary,
    artifactPath: EXTERNAL_MEMORY_ARTIFACT_PATH,
    artifactSha256: currentArtifactSha256,
    rawExportPath: EXTERNAL_MEMORY_RAW_EXPORT_PATH,
    rawExportSha256: currentRawExportSha256,
  };
}

async function inspectAppReceipt(receipt, manifest, artifacts, rootDirectory, state) {
  const start = checkpoint(state);
  if (!isObject(receipt)) {
    integrity(state, "app_receipt_schema_invalid");
    return { status: resultStatus(state, start) };
  }
  const fixtureVersionCurrent = receipt.fixtureVersion === APP_FIXTURE_VERSION;
  const compactProfile = receipt.profile === COMPACT_PROXY_PROFILE;
  if (receipt.profile !== undefined
    && receipt.profile !== "strict-v9"
    && !compactProfile) {
    integrity(state, "app_receipt_profile_invalid");
  }
  if (!compactProfile && receipt.compactProxy !== undefined) {
    integrity(state, "app_compact_proxy_profile_binding_invalid");
  }
  const fixtureVersionStale = typeof receipt.fixtureVersion === "string"
    && STALE_APP_FIXTURE_VERSION_PATTERN.test(receipt.fixtureVersion);
  if (!fixtureVersionCurrent) {
    if (fixtureVersionStale) blocker(state, "app_receipt_fixture_version_not_current");
    else integrity(state, "app_receipt_schema_unsupported");
  }
  if (manifest && receipt.fixtureVersion !== manifest.fixtureVersion) {
    if (fixtureVersionStale) blocker(state, "app_receipt_manifest_schema_not_current");
    else integrity(state, "app_receipt_manifest_schema_mismatch");
  }
  if (!isCanonicalIsoTimestamp(receipt.startedAt)) {
    integrity(state, "app_receipt_started_at_invalid");
  }
  if (receipt.finishedAt === null || receipt.finishedAt === undefined) {
    blocker(state, "app_receipt_unfinished");
  } else if (!isCanonicalIsoTimestamp(receipt.finishedAt)) {
    integrity(state, "app_receipt_finished_at_invalid");
  } else if (isCanonicalIsoTimestamp(receipt.startedAt)
    && receipt.finishedAt < receipt.startedAt) {
    integrity(state, "app_receipt_time_order_invalid");
  }
  if (compactProfile) {
    if (receipt.overall === "FAIL") failure(state, "app_receipt_overall_failed");
    else if (receipt.overall === "PENDING") blocker(state, "app_receipt_unfinished");
    else if (receipt.overall !== "BLOCKED") {
      integrity(state, "app_compact_proxy_overall_status_invalid");
    }
  } else if (receipt.overall === "FAIL") failure(state, "app_receipt_overall_failed");
  else if (receipt.overall === "PENDING") blocker(state, "app_receipt_unfinished");
  else if (receipt.overall === "BLOCKED") blocker(state, "app_receipt_overall_blocked");
  else if (receipt.overall !== "PASS") integrity(state, "app_receipt_overall_status_invalid");

  const identity = receipt.identity;
  if (!isObject(identity)) {
    integrity(state, "app_receipt_identity_missing");
  } else {
    compareReceiptHash(
      state,
      identity.pluginArtifactSha256,
      artifacts.distPlugin,
      "app_receipt_plugin_disk_hash_invalid",
      "app_receipt_plugin_not_current",
    );
    compareReceiptHash(
      state,
      identity.pluginArtifactSha256,
      artifacts.vaultPlugin,
      "app_receipt_plugin_disk_hash_invalid",
      "app_receipt_vault_plugin_not_current",
    );
    if (!isSha256(identity.loadedPluginArtifactSha256)) {
      integrity(state, "app_receipt_loaded_plugin_hash_invalid");
    } else if (isSha256(identity.pluginArtifactSha256)
      && identity.loadedPluginArtifactSha256 !== identity.pluginArtifactSha256) {
      integrity(state, "app_receipt_loaded_disk_mismatch");
    }
    if (!isSha256(identity.loadedPluginBuildIdentitySha256)) {
      integrity(state, "app_receipt_loaded_build_identity_hash_invalid");
    }
    compareReceiptHash(
      state,
      identity.runnerSha256,
      artifacts.appRunnerSource,
      "app_receipt_runner_hash_invalid",
      "app_receipt_runner_not_current",
    );
    compareReceiptHash(
      state,
      identity.runnerSha256,
      artifacts.appRunnerVault,
      "app_receipt_runner_hash_invalid",
      "app_receipt_vault_runner_not_current",
    );
    compareReceiptHash(
      state,
      identity.manifestSha256,
      artifacts.manifestSource,
      "app_receipt_manifest_hash_invalid",
      "app_receipt_manifest_not_current",
    );
    compareReceiptHash(
      state,
      identity.manifestSha256,
      artifacts.manifestVault,
      "app_receipt_manifest_hash_invalid",
      "app_receipt_vault_manifest_not_current",
    );
    if (!isSha256(identity.fixtureBundleSha256)) {
      integrity(state, "app_receipt_fixture_bundle_hash_invalid");
    }
  }

  if (!Array.isArray(receipt.checks)) {
    integrity(state, "app_receipt_checks_invalid");
  } else {
    for (const name of REQUIRED_APP_IDENTITY_CHECKS) {
      const matches = receipt.checks.filter((entry) => entry?.name === name);
      if (matches.length === 0) {
        blocker(state, `app_identity_check_missing:${name}`);
      } else if (matches.length > 1) {
        integrity(state, `app_identity_check_duplicate:${name}`);
      } else {
        inspectStatus(state, matches[0].status, {
          fail: `app_identity_check_failed:${name}`,
          blocked: `app_identity_check_not_pass:${name}`,
          invalid: `app_identity_check_status_invalid:${name}`,
        });
      }
    }
  }
  for (const id of REQUIRED_APP_SLICE_IDS) {
    validateAppCaseBinding(receipt, manifest, id, state);
  }
  const compactProxy = compactProfile
    ? inspectCompactProxyReceipt(receipt, manifest, state)
    : { status: "NOT_APPLICABLE" };
  const correctnessSlices = compactProfile
    ? inspectCompactCorrectnessSlices(receipt, manifest, state)
    : { status: "NOT_APPLICABLE" };
  const deviceMeasurementPlan = compactProfile
    ? { status: "NOT_APPLICABLE" }
    : inspectDeviceMeasurementPassInvariant(receipt, manifest, state);
  const workloadBinding = compactProfile
    ? { status: "NOT_APPLICABLE" }
    : inspectWorkloadBinding(receipt, manifest, state);
  const externalMemoryBinding = compactProfile
    ? { status: "OPTIONAL_NOT_REQUIRED", bindingPresent: false }
    : await inspectExternalMemoryBinding(
      rootDirectory,
      receipt,
      manifest,
      state,
    );
  return {
    status: resultStatus(state, start),
    verificationScope: "artifact-binding-and-structural-consistency-only",
    authenticityVerified: false,
    fixtureVersion: receipt.fixtureVersion ?? null,
    receiptOverall: receipt.overall ?? null,
    startedAt: receipt.startedAt ?? null,
    finishedAt: receipt.finishedAt ?? null,
    verifiedSlice: "chat-recovery+pagelet-0/1/2",
    profile: compactProfile ? COMPACT_PROXY_PROFILE : "strict-v9",
    compactProxy,
    correctnessSlices,
    deviceMeasurementPlan,
    workloadBinding,
    externalMemoryBinding,
  };
}

function validateOpfsPluginIdentity(
  snapshot,
  label,
  currentPluginSha256,
  receiptStatus,
  state,
) {
  if (!isObject(snapshot) || snapshot.status !== "PASS") {
    receiptSemanticIssue(state, receiptStatus, `opfs_${label}_snapshot_invalid`);
    return null;
  }
  const plugin = snapshot.plugin;
  const loaded = plugin?.loadedBuild;
  if (!isObject(plugin)
    || plugin.id !== PLUGIN_ID
    || typeof plugin.version !== "string"
    || plugin.version.length === 0
    || !isObject(loaded)
    || loaded.schemaVersion !== 1
    || loaded.pluginId !== PLUGIN_ID
    || loaded.pluginVersion !== plugin.version
    || loaded.identitySource !== "plugin-onload-cached-main-js"
    || loaded.blocker !== null
    || !isCanonicalIsoTimestamp(loaded.capturedAtPluginLoad)
    || typeof loaded.lexicalProfileRuntimeFingerprint !== "string"
    || loaded.lexicalProfileRuntimeFingerprint.length === 0
    || !isSha256(loaded.pluginArtifactPathSha256)) {
    receiptSemanticIssue(state, receiptStatus, `opfs_${label}_plugin_identity_invalid`);
  }
  if (!isSha256(plugin?.artifactSha256)) {
    receiptSemanticIssue(state, receiptStatus, `opfs_${label}_plugin_disk_hash_invalid`);
  }
  if (!isSha256(loaded?.loadedPluginArtifactSha256)) {
    receiptSemanticIssue(state, receiptStatus, `opfs_${label}_loaded_plugin_hash_invalid`);
  } else if (isSha256(plugin?.artifactSha256)
    && loaded.loadedPluginArtifactSha256 !== plugin.artifactSha256) {
    receiptSemanticIssue(state, receiptStatus, `opfs_${label}_loaded_disk_mismatch`);
  }
  if (currentPluginSha256 && isSha256(plugin?.artifactSha256)
    && plugin.artifactSha256 !== currentPluginSha256) {
    blocker(state, `opfs_${label}_plugin_not_current`);
  }
  return plugin;
}

function validateOpfsRunnerIdentity(snapshot, label, artifact, receiptStatus, state) {
  const runner = snapshot?.runner;
  if (!isObject(runner)
    || runner.path !== OPFS_RUNNER_VAULT_PATH
    || !isSha256(runner.artifactSha256)) {
    receiptSemanticIssue(state, receiptStatus, `opfs_${label}_runner_identity_invalid`);
    return;
  }
  if (artifact.sha256 && runner.artifactSha256 !== artifact.sha256) {
    blocker(state, `opfs_${label}_runner_not_current`);
  }
}

function validateOpfsRuntimeIdentity(snapshot, label, receiptStatus, state) {
  const runtime = snapshot?.runtime;
  const semanticStatus = snapshot?.status ?? receiptStatus;
  if (!isObject(runtime)) {
    receiptSemanticIssue(state, semanticStatus, `opfs_${label}_runtime_identity_missing`);
    return;
  }
  const requiredValues = [
    runtime.appVersion,
    runtime.appVersionSource,
    runtime.shellVersion,
    runtime.shellVersionSource,
    runtime.electronVersion,
    runtime.electronVersionSource,
    runtime.platform,
    runtime.arch,
    runtime.processType,
    runtime.pid,
    runtime.mainProcessPid,
    runtime.mainProcessIdentitySource,
    runtime.timeOrigin,
  ];
  if (requiredValues.some((value) => value === undefined || value === null || value === "")) {
    receiptSemanticIssue(state, semanticStatus, `opfs_${label}_runtime_identity_missing`);
    return;
  }
  const valid = isSafeRuntimeToken(runtime.appVersion)
    && runtime.appVersionSource === "obsidian.apiVersion"
    && isSafeRuntimeToken(runtime.shellVersion)
    && runtime.shellVersionSource === "navigator.userAgent:obsidian/x"
    && isSafeRuntimeToken(runtime.electronVersion)
    && runtime.electronVersionSource === "process.versions.electron"
    && OPFS_SUPPORTED_DESKTOP_PLATFORMS.has(runtime.platform)
    && isSafeRuntimeToken(runtime.arch)
    && runtime.processType === "renderer"
    && Number.isInteger(runtime.pid)
    && runtime.pid > 0
    && Number.isInteger(runtime.mainProcessPid)
    && runtime.mainProcessPid > 0
    && runtime.mainProcessIdentitySource === OPFS_MAIN_PROCESS_IDENTITY_SOURCE
    && Number.isFinite(runtime.timeOrigin)
    && runtime.timeOrigin > 0;
  if (!valid) {
    if (semanticStatus === "PASS") {
      integrity(state, `opfs_${label}_runtime_identity_invalid`);
    } else {
      failure(state, `opfs_${label}_runtime_identity_invalid`);
    }
  }
}

function validateOpfsDurableStorage(snapshot, label, receiptStatus, state) {
  const storage = snapshot?.storage;
  const lexicalProfile = storage?.lexicalProfile;
  const continuity = storage?.continuity;
  const scopeIdentity = storage?.scopeIdentity;
  const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
  const valid = isObject(storage)
    && storage.status === "ready"
    && storage.backend === "sqlite-wasm-opfs-sahpool"
    && storage.fallbackMode === false
    && Number.isInteger(storage.fileCount)
    && storage.fileCount > 0
    && Number.isInteger(storage.chunkCount)
    && storage.chunkCount > 0
    && Number.isFinite(storage.estimatedDbBytes)
    && storage.estimatedDbBytes > 0
    && isObject(lexicalProfile)
    && typeof lexicalProfile.id === "string"
    && lexicalProfile.id.length > 0
    && lexicalProfile.state === "ready"
    && nonNegativeInteger(lexicalProfile.generation)
    && isObject(continuity)
    && isSha256(continuity.databaseInstanceIdSha256)
    && isSha256(continuity.indexIdSha256)
    && isCanonicalIsoTimestamp(continuity.indexBuiltAt)
    && nonNegativeInteger(continuity.chunkMutationEpoch)
    && nonNegativeInteger(continuity.indexMutationEpoch)
    && nonNegativeInteger(continuity.rebuildEpoch)
    && nonNegativeInteger(continuity.lexicalMaintenanceEpoch)
    && isObject(scopeIdentity)
    && isSha256(scopeIdentity.databaseNameSha256)
    && isSha256(scopeIdentity.opfsDirectorySha256)
    && isSha256(scopeIdentity.opfsVfsNameSha256)
    && isSha256(scopeIdentity.combinedSha256);
  if (!valid) {
    receiptSemanticIssue(state, receiptStatus, `opfs_${label}_durable_storage_invalid`);
  }
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, segment) => current?.[segment], value);
}

function inspectRawOpfsComparison(receipt, baseline, state) {
  const comparison = receipt.comparison;
  const stableFields = comparison?.stableFields;
  const before = receipt.before;
  const after = receipt.after;
  const summary = {
    stableFieldCount: OPFS_STABLE_FIELD_PATHS.length,
    stableFieldPassCount: 0,
    fullAppRestartStatus: "BLOCKED",
  };
  if (!isObject(comparison)) {
    receiptSemanticIssue(state, receipt.status, "opfs_raw_comparison_unavailable");
    return summary;
  }
  validateRunnerIssueSummary(comparison, "opfs_comparison_issue_summary_mismatch", state);
  if (comparison.status === "BLOCKED") {
    const reportedRestart = comparison.fullAppRestart;
    const validUnavailableShape = isObject(stableFields)
      && Object.keys(stableFields).length === 0
      && comparison.issues.some((issue) => (
        issue.code === "comparison_unavailable" && issue.status === "BLOCKED"
      ))
      && isObject(reportedRestart)
      && reportedRestart.status === "BLOCKED"
      && reportedRestart.pidChanged === null
      && reportedRestart.mainProcessPidChanged === null
      && reportedRestart.timeOriginChanged === null
      && reportedRestart.mainProcessIdentitySource === OPFS_MAIN_PROCESS_IDENTITY_SOURCE;
    const runnerWouldHaveCompared = baseline?.status === "PASS"
      && after?.status === "PASS";
    if (!validUnavailableShape || runnerWouldHaveCompared) {
      integrity(state, "opfs_comparison_unavailable_shape_invalid");
    }
    return summary;
  }
  if (comparison.status !== "PASS" && comparison.status !== "FAIL") return summary;
  summary.fullAppRestartStatus = "FAIL";
  if (!isObject(before) || !isObject(after) || !isObject(stableFields)) {
    receiptSemanticIssue(state, receipt.status, "opfs_raw_comparison_unavailable");
    return summary;
  }
  const reportedPaths = Object.keys(stableFields).sort();
  const expectedPaths = [...OPFS_STABLE_FIELD_PATHS].sort();
  if (JSON.stringify(reportedPaths) !== JSON.stringify(expectedPaths)) {
    integrity(state, "opfs_stable_field_paths_mismatch");
  }
  let allStable = true;
  for (const path of OPFS_STABLE_FIELD_PATHS) {
    const beforeValue = valueAtPath(before, path);
    const afterValue = valueAtPath(after, path);
    const present = beforeValue !== undefined && afterValue !== undefined;
    const stable = present
      && JSON.stringify(beforeValue) === JSON.stringify(afterValue);
    if (!present) integrity(state, "opfs_stable_field_raw_missing");
    const expectedStatus = stable ? "PASS" : "FAIL";
    if (stable) summary.stableFieldPassCount += 1;
    else allStable = false;
    if (stableFields[path] !== expectedStatus) {
      integrity(state, "opfs_stable_field_summary_mismatch");
    }
  }
  if (!allStable) failure(state, "opfs_stable_field_raw_drift");

  const rawRestartShapeValid = Number.isInteger(before.runtime?.pid)
    && Number.isInteger(after.runtime?.pid)
    && Number.isInteger(before.runtime?.mainProcessPid)
    && Number.isInteger(after.runtime?.mainProcessPid)
    && Number.isFinite(before.runtime?.timeOrigin)
    && Number.isFinite(after.runtime?.timeOrigin);
  if (!rawRestartShapeValid) integrity(state, "opfs_full_app_restart_raw_invalid");
  const pidChanged = rawRestartShapeValid && before.runtime.pid !== after.runtime.pid;
  const mainProcessPidChanged = rawRestartShapeValid
    && before.runtime.mainProcessPid !== after.runtime.mainProcessPid;
  const timeOriginChanged = rawRestartShapeValid
    && before.runtime.timeOrigin !== after.runtime.timeOrigin;
  const fullAppRestartPass = pidChanged && mainProcessPidChanged && timeOriginChanged;
  summary.fullAppRestartStatus = fullAppRestartPass ? "PASS" : "FAIL";
  const reportedRestart = comparison.fullAppRestart;
  if (!isObject(reportedRestart)
    || reportedRestart.status !== summary.fullAppRestartStatus
    || reportedRestart.pidChanged !== pidChanged
    || reportedRestart.mainProcessPidChanged !== mainProcessPidChanged
    || reportedRestart.timeOriginChanged !== timeOriginChanged
    || reportedRestart.mainProcessIdentitySource
      !== OPFS_MAIN_PROCESS_IDENTITY_SOURCE) {
    integrity(state, "opfs_full_app_restart_summary_mismatch");
  }
  if (!fullAppRestartPass) failure(state, "opfs_full_app_restart_raw_not_pass");
  const computedComparisonStatus = allStable && fullAppRestartPass ? "PASS" : "FAIL";
  if (comparison.status !== computedComparisonStatus) {
    integrity(state, "opfs_comparison_summary_mismatch");
  }
  return summary;
}

function inspectOpfsBaseline(baseline, artifact, receipt, state) {
  const start = checkpoint(state);
  if (!baseline) return { status: "BLOCKED" };
  if (baseline.schemaVersion !== OPFS_RECEIPT_SCHEMA_VERSION
    || baseline.receiptType !== OPFS_RECEIPT_TYPE
    || baseline.phase !== "before") {
    integrity(state, "opfs_baseline_schema_unsupported");
  }
  if (!isSha256(baseline.evidenceSha256)) {
    integrity(state, "opfs_baseline_evidence_digest_missing");
  } else {
    const payload = JSON.parse(JSON.stringify(baseline));
    delete payload.evidenceSha256;
    if (sha256(canonicalJson(payload)) !== baseline.evidenceSha256) {
      integrity(state, "opfs_baseline_evidence_digest_mismatch");
    }
  }
  inspectStatus(state, baseline.status, {
    fail: "opfs_baseline_failed",
    blocked: "opfs_baseline_not_pass",
    invalid: "opfs_baseline_status_invalid",
  });
  validateRunnerIssueSummary(baseline, "opfs_baseline_issue_summary_mismatch", state);
  if (!isSha256(baseline.runIdentitySha256)
    || !isCanonicalIsoTimestamp(baseline.capturedAt)
    || !isObject(baseline.snapshot)
    || !Array.isArray(baseline.issues)) {
    integrity(state, "opfs_baseline_shape_invalid");
  }
  if (isObject(baseline.snapshot)) {
    validateRunnerIssueSummary(
      baseline.snapshot,
      "opfs_baseline_snapshot_issue_summary_mismatch",
      state,
    );
  }
  validateRunnerOperatorAssertion(
    baseline.operatorAssertion,
    "before",
    "opfs_baseline_operator_assertion_invalid",
    state,
  );
  if (baseline.status === "PASS"
    && (baseline.snapshot?.status !== "PASS"
      || baseline.operatorAssertion?.status !== "PASS")) {
    integrity(state, "opfs_baseline_pass_components_mismatch");
  }
  const binding = receipt?.baselineBinding;
  if (receipt) {
    if (binding?.path !== "retrieval-opfs-restart-baseline.json") {
      integrity(state, "opfs_baseline_binding_path_invalid");
    }
    if (artifact.sha256 && isSha256(binding?.artifactSha256)
      && artifact.sha256 !== binding.artifactSha256) {
      blocker(state, "opfs_baseline_artifact_not_current");
    }
    const currentArtifactMatchesBinding = artifact.sha256
      && artifact.sha256 === binding?.artifactSha256;
    if (isSha256(baseline.evidenceSha256) && isSha256(binding?.evidenceSha256)
      && baseline.evidenceSha256 !== binding.evidenceSha256) {
      if (currentArtifactMatchesBinding) {
        integrity(state, "opfs_baseline_evidence_binding_mismatch");
      } else {
        blocker(state, "opfs_baseline_evidence_not_current");
      }
    }
    const receiptBindingMismatch = baseline.runIdentitySha256 !== receipt.runIdentitySha256
      || baseline.capturedAt !== receipt.evidenceWindow?.startedAt
      || JSON.stringify(baseline.snapshot) !== JSON.stringify(receipt.before)
      || JSON.stringify(baseline.operatorAssertion)
        !== JSON.stringify(receipt.operatorAssertions?.before);
    if (receiptBindingMismatch) {
      if (currentArtifactMatchesBinding) {
        integrity(state, "opfs_baseline_receipt_binding_mismatch");
      } else {
        blocker(state, "opfs_baseline_receipt_binding_mismatch");
      }
    }
  }
  return {
    status: resultStatus(state, start),
    schemaVersion: baseline.schemaVersion ?? null,
    receiptType: baseline.receiptType ?? null,
    receiptStatus: baseline.status ?? null,
    capturedAt: baseline.capturedAt ?? null,
    evidenceSha256: baseline.evidenceSha256 ?? null,
  };
}

function inspectOpfsReceipt(receipt, baseline, appReceipt, artifacts, state) {
  const start = checkpoint(state);
  if (!isObject(receipt)) {
    integrity(state, "opfs_receipt_schema_invalid");
    return { status: resultStatus(state, start) };
  }
  if (receipt.schemaVersion !== OPFS_RECEIPT_SCHEMA_VERSION
    || receipt.receiptType !== OPFS_RECEIPT_TYPE
    || receipt.phase !== "after") {
    integrity(state, "opfs_receipt_schema_unsupported");
  }
  if (!isSha256(receipt.evidenceSha256)) {
    integrity(state, "opfs_receipt_evidence_digest_missing");
  } else {
    const payload = JSON.parse(JSON.stringify(receipt));
    delete payload.evidenceSha256;
    if (sha256(canonicalJson(payload)) !== receipt.evidenceSha256) {
      integrity(state, "opfs_receipt_evidence_digest_mismatch");
    }
  }
  inspectStatus(state, receipt.status, {
    fail: "opfs_receipt_failed",
    blocked: "opfs_receipt_not_pass",
    invalid: "opfs_receipt_status_invalid",
  });
  validateRunnerIssueSummary(receipt, "opfs_receipt_issue_summary_mismatch", state);
  const window = receipt.evidenceWindow;
  if (!isObject(window)) {
    blocker(state, "opfs_receipt_unfinished");
  } else if (!isCanonicalIsoTimestamp(window.finishedAt)
    || !isCanonicalIsoTimestamp(receipt.capturedAt)) {
    blocker(state, "opfs_receipt_unfinished");
  } else {
    const maximumDurationValid = Number.isFinite(window.maximumDurationMs)
      && window.maximumDurationMs > 0;
    if (receipt.capturedAt !== window.finishedAt || !maximumDurationValid) {
      integrity(state, "opfs_receipt_evidence_window_invalid");
    } else if (window.startedAt === null) {
      if (window.durationMs !== null || window.withinMaximum !== false) {
        integrity(state, "opfs_receipt_evidence_window_invalid");
      }
      blocker(state, "opfs_receipt_unfinished");
    } else if (!isCanonicalIsoTimestamp(window.startedAt)) {
      integrity(state, "opfs_receipt_evidence_window_invalid");
    } else {
      const expectedDuration = Date.parse(window.finishedAt) - Date.parse(window.startedAt);
      const expectedWithinMaximum = expectedDuration >= 0
        && expectedDuration <= window.maximumDurationMs;
      if (expectedDuration < 0
        || window.durationMs !== expectedDuration
        || window.withinMaximum !== expectedWithinMaximum) {
        integrity(state, "opfs_receipt_evidence_window_invalid");
      } else if (!expectedWithinMaximum) {
        blocker(state, "opfs_receipt_evidence_window_expired");
      }
    }
  }
  if (!isSha256(receipt.runIdentitySha256)) {
    receiptSemanticIssue(state, receipt.status, "opfs_receipt_run_identity_invalid");
  }
  const operatorAssertions = receipt.operatorAssertions;
  if (!isObject(operatorAssertions)) {
    blocker(state, "opfs_operator_assertions_not_pass");
  } else {
    if (isObject(operatorAssertions.before)) {
      validateRunnerOperatorAssertion(
        operatorAssertions.before,
        "before",
        "opfs_operator_before_assertion_invalid",
        state,
      );
    } else {
      receiptSemanticIssue(state, receipt.status, "opfs_operator_before_assertion_missing");
    }
    if (isObject(operatorAssertions.after)) {
      validateRunnerOperatorAssertion(
        operatorAssertions.after,
        "after",
        "opfs_operator_after_assertion_invalid",
        state,
      );
    } else {
      receiptSemanticIssue(state, receipt.status, "opfs_operator_after_assertion_missing");
    }
    const expectedOperatorStatus = operatorAssertions.before?.status === "PASS"
      && operatorAssertions.after?.status === "PASS"
      ? "PASS"
      : "BLOCKED";
    if (operatorAssertions.status !== expectedOperatorStatus) {
      integrity(state, "opfs_operator_assertion_summary_mismatch");
    }
    if (operatorAssertions.status !== "PASS") {
      blocker(state, "opfs_operator_assertions_not_pass");
    }
  }
  const baselineBinding = receipt.baselineBinding;
  if (baselineBinding?.status === "PASS") {
    if (!isSha256(baselineBinding.artifactSha256)
      || !isSha256(baselineBinding.evidenceSha256)) {
      integrity(state, "opfs_baseline_binding_invalid");
    }
  } else if (baselineBinding?.status === "BLOCKED") {
    blocker(state, "opfs_baseline_binding_not_pass");
  } else {
    integrity(state, "opfs_baseline_binding_status_invalid");
  }
  const comparison = receipt.comparison;
  inspectStatus(state, comparison?.status, {
    fail: "opfs_comparison_failed",
    blocked: "opfs_comparison_not_pass",
    invalid: "opfs_comparison_status_invalid",
  });
  const rawComparison = inspectRawOpfsComparison(receipt, baseline, state);
  if (receipt.evidencePolicy?.contentFree !== true
    || receipt.evidencePolicy?.rawStorageScopeStored !== false
    || !Array.isArray(receipt.evidencePolicy?.forbiddenRunnerActionsInvoked)
    || receipt.evidencePolicy.forbiddenRunnerActionsInvoked.length !== 0) {
    integrity(state, "opfs_evidence_policy_invalid");
  }

  const currentPluginSha256 = artifacts.distPlugin.sha256
    && artifacts.vaultPlugin.sha256
    && artifacts.distPlugin.sha256 === artifacts.vaultPlugin.sha256
    ? artifacts.distPlugin.sha256
    : null;
  if (isObject(receipt.before)) {
    validateRunnerIssueSummary(
      receipt.before,
      "opfs_before_snapshot_issue_summary_mismatch",
      state,
    );
  }
  if (isObject(receipt.after)) {
    validateRunnerIssueSummary(
      receipt.after,
      "opfs_after_snapshot_issue_summary_mismatch",
      state,
    );
  }
  validateOpfsRuntimeIdentity(receipt.before, "before", receipt.status, state);
  validateOpfsRuntimeIdentity(receipt.after, "after", receipt.status, state);
  const beforePlugin = validateOpfsPluginIdentity(
    receipt.before,
    "before",
    currentPluginSha256,
    receipt.status,
    state,
  );
  const afterPlugin = validateOpfsPluginIdentity(
    receipt.after,
    "after",
    currentPluginSha256,
    receipt.status,
    state,
  );
  validateOpfsRunnerIdentity(
    receipt.before,
    "before",
    artifacts.opfsRunnerSource,
    receipt.status,
    state,
  );
  validateOpfsRunnerIdentity(
    receipt.after,
    "after",
    artifacts.opfsRunnerSource,
    receipt.status,
    state,
  );
  validateOpfsDurableStorage(receipt.before, "before", receipt.status, state);
  validateOpfsDurableStorage(receipt.after, "after", receipt.status, state);
  if (beforePlugin && afterPlugin
    && (beforePlugin.version !== afterPlugin.version
      || beforePlugin.artifactSha256 !== afterPlugin.artifactSha256
      || beforePlugin.loadedBuild?.loadedPluginArtifactSha256
        !== afterPlugin.loadedBuild?.loadedPluginArtifactSha256)) {
    receiptSemanticIssue(
      state,
      receipt.status,
      "opfs_before_after_plugin_identity_mismatch",
    );
  }
  const appVersion = appReceipt?.runtime?.pluginVersion;
  if (typeof appVersion === "string" && beforePlugin
    && beforePlugin.version !== appVersion) {
    receiptSemanticIssue(state, receipt.status, "app_opfs_plugin_version_mismatch");
  }
  return {
    status: resultStatus(state, start),
    schemaVersion: receipt.schemaVersion ?? null,
    receiptType: receipt.receiptType ?? null,
    receiptStatus: receipt.status ?? null,
    startedAt: receipt.evidenceWindow?.startedAt ?? null,
    finishedAt: receipt.evidenceWindow?.finishedAt ?? null,
    verifiedSlice: "desktop-opfs-full-app-restart",
    rawComparison,
  };
}

function publicArtifact(artifact) {
  return {
    path: artifact.path,
    sha256: artifact.sha256,
  };
}

export async function verifyCurrentRetrievalEvidence(options = {}) {
  const rootDirectory = resolve(options.rootDirectory ?? ".");
  const paths = {
    ...DEFAULT_RETRIEVAL_EVIDENCE_PATHS,
    ...(options.paths ?? {}),
  };
  const state = { blockers: [], failures: [], integrityErrors: [] };
  const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => (
    [key, await readArtifact(rootDirectory, key, path, state)]
  )));
  const artifacts = Object.fromEntries(entries);

  compareArtifactPair(
    state,
    artifacts.distPlugin,
    artifacts.vaultPlugin,
    "plugin_dist_vault_mismatch",
  );
  compareArtifactPair(
    state,
    artifacts.appRunnerSource,
    artifacts.appRunnerVault,
    "app_runner_source_vault_mismatch",
  );
  compareArtifactPair(
    state,
    artifacts.manifestSource,
    artifacts.manifestVault,
    "manifest_source_vault_mismatch",
  );
  compareArtifactPair(
    state,
    artifacts.opfsRunnerSource,
    artifacts.opfsRunnerVault,
    "opfs_runner_source_vault_mismatch",
  );

  const manifestSource = parseJsonArtifact(
    artifacts.manifestSource,
    state,
    "manifest_source_json_invalid",
  );
  const manifestVault = parseJsonArtifact(
    artifacts.manifestVault,
    state,
    "manifest_vault_json_invalid",
  );
  if (manifestSource && manifestVault
    && JSON.stringify(manifestSource) !== JSON.stringify(manifestVault)) {
    blocker(state, "manifest_source_vault_content_mismatch");
  }
  if (manifestSource && manifestSource.fixtureVersion !== APP_FIXTURE_VERSION) {
    integrity(state, "manifest_schema_unsupported");
  }

  const appReceipt = parseJsonArtifact(
    artifacts.appReceipt,
    state,
    "app_receipt_json_invalid",
  );
  const opfsReceipt = parseJsonArtifact(
    artifacts.opfsReceipt,
    state,
    "opfs_receipt_json_invalid",
  );
  const opfsBaseline = parseJsonArtifact(
    artifacts.opfsBaseline,
    state,
    "opfs_baseline_json_invalid",
  );
  const fixtureBundleSummary = await inspectCurrentFixtureBundle(
    rootDirectory,
    manifestSource,
    appReceipt,
    state,
  );
  const appSummary = appReceipt
    ? await inspectAppReceipt(appReceipt, manifestSource, artifacts, rootDirectory, state)
    : { status: "BLOCKED" };
  const opfsBaselineSummary = inspectOpfsBaseline(
    opfsBaseline,
    artifacts.opfsBaseline,
    opfsReceipt,
    state,
  );
  const opfsSummary = opfsReceipt
    ? inspectOpfsReceipt(opfsReceipt, opfsBaseline, appReceipt, artifacts, state)
    : { status: "BLOCKED" };

  const status = state.integrityErrors.length > 0 || state.failures.length > 0
    ? "FAIL"
    : state.blockers.length > 0
      ? "BLOCKED"
      : "PASS";
  const exitCode = status === "PASS" ? 0 : status === "FAIL" ? 1 : 2;
  return {
    schemaVersion: RETRIEVAL_EVIDENCE_VERIFIER_SCHEMA_VERSION,
    verificationType: RETRIEVAL_EVIDENCE_VERIFIER_TYPE,
    status,
    exitCode,
    errorCode: state.integrityErrors.length > 0
      ? RETRIEVAL_EVIDENCE_INTEGRITY_ERROR
      : null,
    claim: {
      receiptBoundArtifactsMatchCurrentDisk: status === "PASS",
      liveProcessCurrentnessClaimed: false,
      appReceiptCryptographicSealClaimed: false,
      appReceiptAuthenticityVerified: false,
      appRecoveryEvidenceDigestRecomputed: false,
      boundary:
        "Verifies critical App receipt bindings plus sealed OPFS evidence against checkout/test-vault disk artifacts. It neither proves a live Obsidian process nor externally authenticates the unsealed App receipt/recovery digest.",
    },
    receipts: {
      app: {
        path: artifacts.appReceipt.path,
        sha256: artifacts.appReceipt.sha256,
        ...appSummary,
      },
      opfs: {
        path: artifacts.opfsReceipt.path,
        sha256: artifacts.opfsReceipt.sha256,
        ...opfsSummary,
      },
      opfsBaseline: {
        path: artifacts.opfsBaseline.path,
        sha256: artifacts.opfsBaseline.sha256,
        ...opfsBaselineSummary,
      },
    },
    artifacts: {
      distPlugin: publicArtifact(artifacts.distPlugin),
      vaultPlugin: publicArtifact(artifacts.vaultPlugin),
      appRunnerSource: publicArtifact(artifacts.appRunnerSource),
      appRunnerVault: publicArtifact(artifacts.appRunnerVault),
      manifestSource: publicArtifact(artifacts.manifestSource),
      manifestVault: publicArtifact(artifacts.manifestVault),
      opfsRunnerSource: publicArtifact(artifacts.opfsRunnerSource),
      opfsRunnerVault: publicArtifact(artifacts.opfsRunnerVault),
      opfsBaseline: publicArtifact(artifacts.opfsBaseline),
      fixtureBundle: fixtureBundleSummary,
    },
    blockers: state.blockers,
    failures: state.failures,
    integrityErrors: state.integrityErrors,
  };
}
