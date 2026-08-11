import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export const FTS_RUNTIME_RECEIPT_SCHEMA_VERSION = 2;
export const FTS_RUNTIME_RECEIPT_TYPE = "pa.fts-runtime-platform";
export const REQUIRED_PLATFORMS = Object.freeze(["darwin", "win32", "linux"]);
export const REQUIRED_REFERENCE_NODE_MAJOR = 22;
export const PRODUCTION_PLUGIN_ARTIFACT_ID = "production-plugin";
export const PRODUCTION_PLUGIN_ARTIFACT_PATH = "dist/main.js";
export const REQUIRED_GRAPHEME_CASE_IDS = Object.freeze([
  "nfd-accent",
  "supplementary-han",
  "emoji-zwj",
  "kana-combining-mark",
  "han-variation-selector",
  "cjk-marks",
]);
export const REQUIRED_WORD_CASE_IDS = Object.freeze([
  "zh-basic",
  "zh-natural",
  "zh-relevant-drift-query",
  "zh-relevant-drift",
  "zh-collision-query",
  "zh-collision",
  "ja-proper-name-drift-query-via-production-routing",
  "ja-proper-name-drift",
  "ja-collision-query-via-production-routing",
  "ja-collision",
  "ja-basic",
  "mixed-ja-code",
  "mixed-zh-code",
  "traditional-zh",
]);
export const SELECTED_PROFILE_ID = "char-phrase-v1";
export const SELECTED_PROFILE_TOKENIZER = "unicode61 remove_diacritics 2";

export function sha256(value) {
  let input;
  if (typeof value === "string" || ArrayBuffer.isView(value)) input = value;
  else if (value instanceof ArrayBuffer) input = new Uint8Array(value);
  else input = JSON.stringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function createEmbeddedArtifact(id, path, payload, sourceSha256) {
  return {
    id,
    path,
    sourceSha256,
    payload,
    payloadSha256: sha256(payload),
  };
}

export function createProductionPluginArtifact(source) {
  return {
    id: PRODUCTION_PLUGIN_ARTIFACT_ID,
    path: PRODUCTION_PLUGIN_ARTIFACT_PATH,
    sha256: sha256(source),
    byteLength: Buffer.byteLength(source),
  };
}

function hasExactCaseIds(items, expectedIds) {
  if (!Array.isArray(items)) return false;
  const ids = items.map((item) => item?.id);
  return ids.length === expectedIds.length
    && new Set(ids).size === ids.length
    && expectedIds.every((id) => ids.includes(id));
}

function verifyEmbeddedArtifact(artifact, expectedId, blockers) {
  if (!artifact || artifact.id !== expectedId || !artifact.payload
    || typeof artifact.sourceSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(artifact.sourceSha256)
    || typeof artifact.payloadSha256 !== "string") {
    blockers.push(`artifact_missing:${expectedId}`);
    return;
  }
  if (sha256(artifact.payload) !== artifact.payloadSha256) {
    throw new Error(`Artifact payload hash mismatch: ${expectedId}.`);
  }
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function productionPluginArtifactIsValid(artifact) {
  return artifact?.id === PRODUCTION_PLUGIN_ARTIFACT_ID
    && artifact?.path === PRODUCTION_PLUGIN_ARTIFACT_PATH
    && isSha256(artifact?.sha256)
    && Number.isInteger(artifact?.byteLength)
    && artifact.byteLength > 0;
}

function inspectProductionPluginBinding(receipt, expectedSha256, blockers) {
  const productionArtifact = receipt.artifacts?.productionPlugin;
  if (!productionPluginArtifactIsValid(productionArtifact)) {
    blockers.push("production_plugin_artifact_missing");
  } else if (isSha256(expectedSha256) && productionArtifact.sha256 !== expectedSha256) {
    blockers.push("production_plugin_artifact_mismatch");
  }

  const identity = receipt.exactRenderer?.pluginIdentity;
  const loadedBuild = identity?.loadedBuild;
  const observedArtifact = identity?.artifact;
  if (!identity
    || identity.id !== "personal-assistant"
    || typeof identity.version !== "string"
    || identity.version.length === 0
    || typeof observedArtifact?.path !== "string"
    || observedArtifact.path.length === 0
    || !isSha256(observedArtifact?.sha256)
    || !Number.isInteger(observedArtifact?.byteLength)
    || observedArtifact.byteLength <= 0) {
    blockers.push("exact_renderer_plugin_identity_missing");
  }
  if (!loadedBuild
    || loadedBuild.schemaVersion !== 1
    || loadedBuild.identitySource !== "plugin-onload-cached-main-js"
    || loadedBuild.pluginId !== identity?.id
    || loadedBuild.pluginVersion !== identity?.version
    || loadedBuild.pluginArtifactPath !== observedArtifact?.path
    || !isSha256(loadedBuild.loadedPluginArtifactSha256)
    || typeof loadedBuild.lexicalProfileRuntimeFingerprint !== "string"
    || loadedBuild.lexicalProfileRuntimeFingerprint.length < 8) {
    blockers.push("loaded_plugin_build_identity_missing");
  }
  if (isSha256(loadedBuild?.loadedPluginArtifactSha256)
    && isSha256(observedArtifact?.sha256)
    && loadedBuild.loadedPluginArtifactSha256 !== observedArtifact.sha256) {
    blockers.push("loaded_plugin_artifact_mismatch");
  }
  if (productionPluginArtifactIsValid(productionArtifact)
    && isSha256(observedArtifact?.sha256)
    && productionArtifact.sha256 !== observedArtifact.sha256) {
    blockers.push("production_plugin_artifact_mismatch");
  }
  if (productionPluginArtifactIsValid(productionArtifact)
    && Number.isInteger(observedArtifact?.byteLength)
    && productionArtifact.byteLength !== observedArtifact.byteLength) {
    blockers.push("production_plugin_artifact_mismatch");
  }
}

function rendererIdentityIsExact(renderer) {
  const runtime = renderer?.runtime;
  const isObsidianUrl = (value) => value === "app://obsidian.md"
    || value?.startsWith("app://obsidian.md/");
  return renderer?.identityVerified === true
    && isObsidianUrl(renderer?.target?.url)
    && runtime?.host === "electron-renderer"
    && runtime?.processType === "renderer"
    && runtime?.browser?.hasDocument === true
    && isObsidianUrl(runtime?.browser?.locationHref)
    && typeof runtime?.versions?.electron === "string"
    && typeof runtime?.versions?.icu === "string"
    && typeof runtime?.obsidianAppVersion === "string"
    && runtime.obsidianAppVersion.length > 0
    && REQUIRED_PLATFORMS.includes(runtime?.processPlatform)
    && typeof runtime?.processArch === "string"
    && runtime.processArch.length > 0;
}

function referenceRuntimeUsesRequiredNode(runtime) {
  const version = runtime?.runtime?.versions?.node;
  return runtime?.available === true
    && runtime?.runtime?.host === "node"
    && typeof version === "string"
    && new RegExp(`^${REQUIRED_REFERENCE_NODE_MAJOR}\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$`, "u")
      .test(version);
}

export function inspectPlatformReceipt(receipt, options = {}) {
  if (receipt?.schemaVersion !== FTS_RUNTIME_RECEIPT_SCHEMA_VERSION) {
    throw new Error(`Unsupported FTS runtime receipt schema: ${receipt?.schemaVersion ?? "missing"}.`);
  }
  if (receipt?.receiptType !== FTS_RUNTIME_RECEIPT_TYPE) {
    throw new Error(`Unsupported FTS runtime receipt type: ${receipt?.receiptType ?? "missing"}.`);
  }

  const blockers = [];
  const failures = [];
  const diagnostics = [];
  verifyEmbeddedArtifact(receipt.artifacts?.runtimeCanary, "runtime-canary", blockers);
  verifyEmbeddedArtifact(receipt.artifacts?.profileCanary, "profile-canary", blockers);
  inspectProductionPluginBinding(
    receipt,
    options.expectedProductionPluginSha256,
    blockers,
  );

  const renderer = receipt.exactRenderer;
  const nodeRuntime = receipt.referenceRuntime;
  const embeddedRuntime = receipt.artifacts?.runtimeCanary?.payload;
  if (embeddedRuntime && (
    JSON.stringify(embeddedRuntime.renderer) !== JSON.stringify(renderer?.fingerprintPayload ?? null)
    || JSON.stringify(embeddedRuntime.reference) !== JSON.stringify(nodeRuntime?.fingerprintPayload ?? null)
  )) {
    throw new Error("Runtime artifact does not match the reported runtime payloads.");
  }
  for (const runtime of [renderer, nodeRuntime]) {
    if (!runtime?.fingerprintPayload) continue;
    if (runtime.fingerprint !== sha256(runtime.fingerprintPayload)
      || runtime.graphemeFingerprint !== sha256(runtime.fingerprintPayload.graphemes)
      || runtime.wordFingerprint !== sha256(runtime.fingerprintPayload.words)) {
      throw new Error(`Runtime fingerprint mismatch: ${runtime.label ?? "unknown"}.`);
    }
  }
  if (!rendererIdentityIsExact(renderer)) blockers.push("exact_obsidian_renderer_missing");
  if (!nodeRuntime?.available) blockers.push("reference_runtime_missing");
  else if (!referenceRuntimeUsesRequiredNode(nodeRuntime)) {
    blockers.push("reference_runtime_node22_required");
  }
  if (!hasExactCaseIds(renderer?.fingerprintPayload?.graphemes, REQUIRED_GRAPHEME_CASE_IDS)) {
    blockers.push("renderer_grapheme_cases_missing");
  }
  if (!hasExactCaseIds(renderer?.fingerprintPayload?.words, REQUIRED_WORD_CASE_IDS)) {
    blockers.push("renderer_word_cases_missing");
  }
  if (!hasExactCaseIds(nodeRuntime?.fingerprintPayload?.graphemes, REQUIRED_GRAPHEME_CASE_IDS)) {
    blockers.push("reference_grapheme_cases_missing");
  }
  if (!hasExactCaseIds(nodeRuntime?.fingerprintPayload?.words, REQUIRED_WORD_CASE_IDS)) {
    blockers.push("reference_word_cases_missing");
  }

  const claimedPlatform = receipt.platform;
  if (rendererIdentityIsExact(renderer)
    && (claimedPlatform?.os !== renderer.runtime.processPlatform
      || claimedPlatform?.arch !== renderer.runtime.processArch)) {
    throw new Error("Receipt platform does not match the exact renderer runtime.");
  }
  if (rendererIdentityIsExact(renderer) && nodeRuntime?.available
    && (nodeRuntime.runtime?.processPlatform !== renderer.runtime.processPlatform
      || nodeRuntime.runtime?.processArch !== renderer.runtime.processArch)) {
    throw new Error("Reference runtime platform does not match the exact renderer runtime.");
  }

  const rendererProfile = receipt.artifacts?.profileCanary?.payload?.renderer;
  const referenceProfile = receipt.artifacts?.profileCanary?.payload?.reference;
  if (!rendererProfile || !referenceProfile) {
    blockers.push("profile_artifact_case_missing");
  } else {
    for (const profile of [rendererProfile, referenceProfile]) {
      if (profile.profileId !== SELECTED_PROFILE_ID
        || profile.tokenizer !== SELECTED_PROFILE_TOKENIZER
        || !Array.isArray(profile.cases)
        || profile.cases.length === 0
        || typeof profile.runtimeFingerprint !== "string") {
        failures.push("selected_profile_identity_drift");
        break;
      }
    }
    if (rendererProfile.runtimeFingerprint !== referenceProfile.runtimeFingerprint
      || JSON.stringify(rendererProfile.cases) !== JSON.stringify(referenceProfile.cases)) {
      failures.push("selected_profile_runtime_drift");
    }
  }

  if (renderer?.graphemeFingerprint && nodeRuntime?.graphemeFingerprint
    && renderer.graphemeFingerprint !== nodeRuntime.graphemeFingerprint) {
    failures.push("grapheme_drift");
  }
  if (renderer?.wordFingerprint && nodeRuntime?.wordFingerprint
    && renderer.wordFingerprint !== nodeRuntime.wordFingerprint) {
    diagnostics.push("word_drift");
  }

  const status = failures.length > 0 ? "FAIL" : blockers.length > 0 ? "BLOCKED" : "PASS";
  if (receipt.status !== status && !(options.allowMissingStatus === true && receipt.status == null)) {
    const evidence = [...new Set([...blockers, ...failures])].join(", ") || "none";
    throw new Error(
      `Receipt status mismatch: claimed ${receipt.status ?? "missing"}, computed ${status}; evidence: ${evidence}.`,
    );
  }
  return { status, blockers: [...new Set(blockers)], failures: [...new Set(failures)], diagnostics };
}

export function verifyMultiPlatformReceipts(receipts, options = {}) {
  if (!Array.isArray(receipts)) throw new Error("Receipts must be an array.");
  const productionPluginHashes = new Set(receipts
    .map((receipt) => receipt.artifacts?.productionPlugin?.sha256)
    .filter(isSha256));
  if (productionPluginHashes.size > 1) {
    throw new Error("Production plugin artifacts differ across platform receipts.");
  }
  if (isSha256(options.expectedProductionPluginSha256)
    && productionPluginHashes.size > 0
    && !productionPluginHashes.has(options.expectedProductionPluginSha256)) {
    throw new Error("Production plugin artifact does not match this checkout: dist/main.js.");
  }
  const inspected = receipts.map((receipt) => ({
    receipt,
    result: inspectPlatformReceipt(receipt, {
      expectedProductionPluginSha256: options.expectedProductionPluginSha256,
    }),
  }));
  const byPlatform = new Map();
  for (const item of inspected) {
    const platform = item.receipt.platform?.os;
    if (!REQUIRED_PLATFORMS.includes(platform)) {
      throw new Error(`Unsupported receipt platform: ${platform ?? "missing"}.`);
    }
    if (byPlatform.has(platform)) throw new Error(`Duplicate platform receipt: ${platform}.`);
    byPlatform.set(platform, item);
  }
  const missingPlatforms = REQUIRED_PLATFORMS.filter((platform) => !byPlatform.has(platform));
  const blockers = [
    ...missingPlatforms.map((platform) => `missing_platform:${platform}`),
    ...inspected.flatMap(({ receipt, result }) => (
      result.blockers.map((blocker) => `${receipt.platform.os}:${blocker}`)
    )),
  ];

  const sourceIdentities = ["runtimeCanary", "profileCanary"].map((key) => (
    new Set(inspected
      .map(({ receipt }) => receipt.artifacts?.[key]?.sourceSha256)
      .filter((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)))
  ));
  if (sourceIdentities.some((hashes) => hashes.size > 1)) {
    throw new Error("Runtime evidence artifacts differ across platform receipts.");
  }
  for (const [key, expectedHash] of Object.entries(options.expectedSourceSha256 ?? {})) {
    const identities = sourceIdentities[["runtimeCanary", "profileCanary"].indexOf(key)];
    if (identities?.size > 0 && !identities.has(expectedHash)) {
      throw new Error(`Runtime evidence artifact does not match this checkout: ${key}.`);
    }
  }

  const graphemeFingerprints = inspected
    .map(({ receipt }) => receipt.exactRenderer?.graphemeFingerprint)
    .filter((value) => typeof value === "string");
  const profileFingerprints = inspected
    .map(({ receipt }) => receipt.artifacts?.profileCanary?.payload?.renderer?.runtimeFingerprint)
    .filter((value) => typeof value === "string");
  const failures = [];
  if (new Set(graphemeFingerprints).size > 1) failures.push("cross_platform_grapheme_drift");
  if (new Set(profileFingerprints).size > 1) failures.push("cross_platform_profile_drift");
  if (inspected.some(({ result }) => result.status === "FAIL")) failures.push("platform_receipt_failed");
  const wordFingerprints = inspected
    .map(({ receipt }) => receipt.exactRenderer?.wordFingerprint)
    .filter((value) => typeof value === "string");
  const diagnostics = new Set(wordFingerprints).size <= 1 ? [] : ["cross_platform_word_drift"];
  const status = failures.length > 0 ? "FAIL" : blockers.length > 0 ? "BLOCKED" : "PASS";
  return {
    schemaVersion: FTS_RUNTIME_RECEIPT_SCHEMA_VERSION,
    receiptType: "pa.fts-runtime-multi-platform-verification",
    status,
    platforms: [...REQUIRED_PLATFORMS],
    productionPluginArtifactSha256:
      productionPluginHashes.size === 1 ? [...productionPluginHashes][0] : null,
    blockers,
    failures,
    diagnostics,
  };
}
