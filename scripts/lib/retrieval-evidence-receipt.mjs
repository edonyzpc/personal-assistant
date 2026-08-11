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
const REQUIRED_APP_IDENTITY_CHECKS = Object.freeze([
  "Loaded plugin and current vault artifact identities match",
  "Smoke manifest matches the canonical repository identity",
  "Smoke manifest contract matches the runner",
  "Smoke runner artifact identity is captured",
  "Obsidian app, shell, runtime, plugin, and runner identity are unchanged at finalization",
  "Plugin lifecycle, artifact, and settings bindings are stable at receipt commit",
]);
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
    && processMemoryRuntimeValid;
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
  if (receipt.overall === "FAIL") failure(state, "app_receipt_overall_failed");
  else if (receipt.overall === "PENDING") blocker(state, "app_receipt_unfinished");
  else if (receipt.overall === "BLOCKED") blocker(state, "app_receipt_overall_blocked");
  else if (receipt.overall !== "PASS") {
    integrity(state, "app_receipt_overall_status_invalid");
  }

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
  const deviceMeasurementPlan = inspectDeviceMeasurementPassInvariant(
    receipt,
    manifest,
    state,
  );
  const workloadBinding = inspectWorkloadBinding(receipt, manifest, state);
  const externalMemoryBinding = await inspectExternalMemoryBinding(
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
