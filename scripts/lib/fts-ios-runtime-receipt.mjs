import { createHash } from "node:crypto";

import {
  REQUIRED_GRAPHEME_CASE_IDS,
  REQUIRED_WORD_CASE_IDS,
} from "./fts-runtime-receipt.mjs";
import { iosRuntimeIdentityBlockers } from "./fts-ios-runtime-identity.mjs";
import {
  FTS_IOS_RECEIPT_SCHEMA_VERSION,
  FTS_IOS_RECEIPT_TYPE,
} from "./fts-ios-runtime-bundle.mjs";
import {
  FTS_IOS_ATTESTATION_TRUST_BOUNDARY,
  validateFtsIosChallenge,
  validateFtsIosSessionAttestation,
} from "./fts-ios-runtime-session.mjs";

export const FTS_IOS_VERIFICATION_TYPE = "pa.fts-ios-runtime-verification";
export const FTS_IOS_BASE_RECEIPT_MAX_AGE_MS = 10 * 60 * 1000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export class FtsIosRuntimeIntegrityError extends Error {
  constructor(message) {
    super(`FTS_IOS_INTEGRITY_ERROR: ${message}`);
    this.name = "FtsIosRuntimeIntegrityError";
    this.code = "FTS_IOS_INTEGRITY_ERROR";
  }
}

export function sha256(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex");
}

export function sealFtsIosRuntimeReceipt(receipt) {
  const sealed = structuredClone(receipt);
  delete sealed.receiptPayloadSha256;
  sealed.receiptPayloadSha256 = sha256(sealed);
  return sealed;
}

function integrity(condition, message) {
  if (!condition) throw new FtsIosRuntimeIntegrityError(message);
}

function hasExactCaseIds(items, expectedIds) {
  if (!Array.isArray(items)) return false;
  const ids = items.map((item) => item?.id);
  return ids.length === expectedIds.length
    && new Set(ids).size === ids.length
    && expectedIds.every((id) => ids.includes(id));
}

function validateReceiptEnvelope(receipt) {
  integrity(
    receipt?.schemaVersion === FTS_IOS_RECEIPT_SCHEMA_VERSION,
    `unsupported receipt schema ${receipt?.schemaVersion ?? "missing"}`,
  );
  integrity(
    receipt?.receiptType === FTS_IOS_RECEIPT_TYPE,
    `unsupported receipt type ${receipt?.receiptType ?? "missing"}`,
  );
  integrity(
    SHA256_PATTERN.test(receipt?.receiptPayloadSha256 ?? ""),
    "receipt payload hash is missing",
  );
  const payload = structuredClone(receipt);
  delete payload.receiptPayloadSha256;
  integrity(
    sha256(payload) === receipt.receiptPayloadSha256,
    "receipt payload hash mismatch",
  );
  integrity(
    receipt.externalTrustStatus === "UNATTESTED",
    "browser receipt must remain explicitly untrusted",
  );
}

function validateEmbeddedFingerprints(receipt) {
  const runtime = receipt.runtimeCanary;
  integrity(Boolean(runtime?.fingerprintPayload), "runtime canary payload is missing");
  integrity(
    runtime.fingerprint === sha256(runtime.fingerprintPayload),
    "runtime canary fingerprint mismatch",
  );
  integrity(
    runtime.graphemeFingerprint === sha256(runtime.fingerprintPayload.graphemes),
    "runtime grapheme fingerprint mismatch",
  );
  integrity(
    runtime.wordFingerprint === sha256(runtime.fingerprintPayload.words),
    "runtime word fingerprint mismatch",
  );
  const profile = receipt.profileCanary;
  integrity(Boolean(profile?.artifact), "profile canary artifact is missing");
  integrity(
    profile.fingerprint === sha256(profile.artifact),
    "profile canary fingerprint mismatch",
  );
}

function validateCheckoutIntegrity(receipt, expected) {
  const blockers = [];
  const compare = (actual, wanted, label, missingBlocker) => {
    if (wanted == null) return;
    if (!SHA256_PATTERN.test(actual ?? "")) {
      blockers.push(missingBlocker);
      return;
    }
    integrity(actual === wanted, `${label} does not match the current checkout`);
  };
  compare(
    receipt.sourceIdentity?.runtimeCanarySha256,
    expected?.sourceIdentity?.runtimeCanarySha256,
    "runtime canary source",
    "runtime_canary_source_identity_missing",
  );
  compare(
    receipt.sourceIdentity?.lexicalNormalizerSha256,
    expected?.sourceIdentity?.lexicalNormalizerSha256,
    "lexical normalizer source",
    "lexical_normalizer_source_identity_missing",
  );
  compare(
    receipt.sourceIdentity?.iosIdentityContractSha256,
    expected?.sourceIdentity?.iosIdentityContractSha256,
    "iOS identity contract source",
    "ios_identity_contract_source_identity_missing",
  );
  compare(
    receipt.sourceIdentity?.currentPluginArtifactSha256,
    expected?.pluginArtifactSha256,
    "bundle-bound current plugin artifact",
    "current_plugin_artifact_identity_missing",
  );
  compare(
    receipt.artifacts?.bundle?.sha256,
    expected?.bundleSha256,
    "iOS runtime bundle",
    "bundle_artifact_missing",
  );
  compare(
    receipt.artifacts?.plugin?.sha256,
    expected?.pluginArtifactSha256,
    "plugin artifact",
    "plugin_artifact_missing",
  );
  compare(
    receipt.deviceIdentitySha256,
    expected?.deviceIdentitySha256,
    "external device identity",
    "device_identity_missing",
  );
  if (expected?.pluginId) {
    if (!receipt.pluginIdentity?.id) blockers.push("plugin_identity_missing");
    else integrity(
      receipt.pluginIdentity.id === expected.pluginId,
      "plugin id does not match the current checkout",
    );
  }
  if (expected?.pluginVersion) {
    if (!receipt.pluginIdentity?.version) blockers.push("plugin_identity_missing");
    else integrity(
      receipt.pluginIdentity.version === expected.pluginVersion,
      "plugin version does not match the current checkout",
    );
  }
  return blockers;
}

export function inspectRepositoryNodeReference(nodeVersion = process.versions.node) {
  const normalized = typeof nodeVersion === "string" ? nodeVersion : "";
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10);
  return {
    nodeVersion: normalized || null,
    nodeMajor: Number.isInteger(major) ? major : null,
    requiredNodeMajor: 22,
    status: major === 22 ? "READY" : "BLOCKED",
    blockers: major === 22 ? [] : ["repository_node22_required"],
  };
}

function validateExternalSessionEvidence(receipt, expected) {
  if (expected.externalAssuranceRequired !== true) return [];
  const blockers = [];
  if (!expected.sessionChallenge) blockers.push("session_challenge_file_missing");
  if (!expected.sessionAttestation) blockers.push("trusted_device_session_evidence_missing");
  if (!expected.trustedAttestorKeySha256) blockers.push("trusted_attestor_key_missing");
  if (!expected.sessionChallenge || !expected.sessionAttestation) return blockers;
  const challengeBlockers = validateFtsIosChallenge(expected.sessionChallenge, {
    now: expected.verificationNow,
    trustedAttestorKeySha256: expected.trustedAttestorKeySha256,
  });
  const attestationBlockers = validateFtsIosSessionAttestation(
    expected.sessionAttestation,
    receipt,
    expected.sessionChallenge,
    {
      now: expected.verificationNow,
      trustedAttestorKeySha256: expected.trustedAttestorKeySha256,
      deviceIdentitySha256: expected.deviceIdentitySha256,
    },
  );
  const integrityBlockers = new Set([
    "session_challenge_integrity_invalid",
    "session_attestor_key_invalid",
    "trusted_attestor_key_mismatch",
    "session_challenge_binding_mismatch",
    "trusted_device_receipt_binding_mismatch",
    "trusted_device_identity_mismatch",
    "trusted_device_plugin_binding_mismatch",
    "trusted_device_evidence_signature_invalid",
  ]);
  const tamper = [...challengeBlockers, ...attestationBlockers]
    .find((blocker) => integrityBlockers.has(blocker));
  integrity(!tamper, `external session evidence failed integrity: ${tamper ?? "unknown"}`);
  blockers.push(...challengeBlockers, ...attestationBlockers);
  return [...new Set(blockers)];
}

function validateBaseReceiptFreshness(receipt, expected) {
  const blockers = [];
  const generatedAt = Date.parse(receipt?.generatedAt ?? "");
  const observedAt = Date.parse(receipt?.operatorObservation?.observedAt ?? "");
  const verificationNow = expected.verificationNow instanceof Date
    ? expected.verificationNow.getTime()
    : Date.now();
  if (!Number.isFinite(generatedAt) || !Number.isFinite(observedAt)) {
    blockers.push("ios_base_receipt_time_invalid");
    return blockers;
  }
  if (generatedAt > verificationNow + 30_000 || observedAt > verificationNow + 30_000) {
    blockers.push("ios_base_receipt_not_active");
  }
  if (verificationNow - generatedAt > FTS_IOS_BASE_RECEIPT_MAX_AGE_MS
    || verificationNow - observedAt > FTS_IOS_BASE_RECEIPT_MAX_AGE_MS) {
    blockers.push("ios_base_receipt_stale");
  }
  return blockers;
}

export function inspectFtsIosRuntimeReceipt(receipt, expected = {}) {
  validateReceiptEnvelope(receipt);
  validateEmbeddedFingerprints(receipt);
  const checkoutBlockers = validateCheckoutIntegrity(receipt, expected);
  const sessionBlockers = validateExternalSessionEvidence(receipt, expected);
  const freshnessBlockers = validateBaseReceiptFreshness(receipt, expected);
  const repositoryNode = inspectRepositoryNodeReference(expected.repositoryNodeVersion);

  const blockers = new Set([
    ...(Array.isArray(receipt.blockers) ? receipt.blockers : []),
    ...iosRuntimeIdentityBlockers(receipt),
    ...checkoutBlockers,
    ...sessionBlockers,
    ...freshnessBlockers,
    ...repositoryNode.blockers,
  ]);
  if (!expected.deviceIdentitySha256) blockers.add("expected_device_identity_missing");
  if (!expected.bundleSha256) blockers.add("current_bundle_missing");
  if (!expected.pluginArtifactSha256) blockers.add("current_plugin_artifact_missing");
  if (!expected.referenceRuntime?.fingerprintPayload) blockers.add("reference_runtime_missing");
  if (!expected.referenceProfile) blockers.add("reference_profile_missing");
  if (expected.currentPluginArtifactBlockers) {
    for (const blocker of expected.currentPluginArtifactBlockers) blockers.add(blocker);
  }
  if (!hasExactCaseIds(
    receipt.runtimeCanary?.fingerprintPayload?.graphemes,
    REQUIRED_GRAPHEME_CASE_IDS,
  )) {
    blockers.add("ios_grapheme_cases_missing");
  }
  if (!hasExactCaseIds(
    receipt.runtimeCanary?.fingerprintPayload?.words,
    REQUIRED_WORD_CASE_IDS,
  )) {
    blockers.add("ios_word_cases_missing");
  }

  const failures = [];
  const diagnostics = [];
  const referenceRuntime = expected.referenceRuntime;
  if (referenceRuntime?.fingerprintPayload) {
    if (JSON.stringify(receipt.runtimeCanary.fingerprintPayload.graphemes)
      !== JSON.stringify(referenceRuntime.fingerprintPayload.graphemes)
      || receipt.runtimeCanary.graphemeFingerprint !== referenceRuntime.graphemeFingerprint) {
      failures.push("grapheme_drift");
    }
    if (JSON.stringify(receipt.runtimeCanary.fingerprintPayload.words)
      !== JSON.stringify(referenceRuntime.fingerprintPayload.words)
      || receipt.runtimeCanary.wordFingerprint !== referenceRuntime.wordFingerprint) {
      diagnostics.push("word_drift");
    }
  }
  const profile = receipt.profileCanary?.artifact;
  const referenceProfile = expected.referenceProfile;
  if (profile && referenceProfile) {
    if (profile.schemaVersion !== referenceProfile.schemaVersion
      || profile.profileId !== referenceProfile.profileId
      || profile.tokenizer !== referenceProfile.tokenizer) {
      failures.push("selected_profile_identity_drift");
    }
    if (profile.runtimeFingerprint !== referenceProfile.runtimeFingerprint
      || JSON.stringify(profile.cases) !== JSON.stringify(referenceProfile.cases)) {
      failures.push("selected_profile_runtime_drift");
    }
  }

  const identityBlockers = iosRuntimeIdentityBlockers(receipt);
  const expectedCaptureStatus = identityBlockers.length === 0
    && (!Array.isArray(receipt.blockers) || receipt.blockers.length === 0)
    ? "CANDIDATE"
    : "BLOCKED";
  integrity(
    receipt.captureStatus === expectedCaptureStatus,
    `capture status mismatch: ${receipt.captureStatus ?? "missing"}`,
  );
  const uniqueFailures = [...new Set(failures)];
  const status = uniqueFailures.length > 0
    ? "FAIL"
    : blockers.size > 0 ? "BLOCKED" : "PASS";
  return {
    schemaVersion: FTS_IOS_RECEIPT_SCHEMA_VERSION,
    receiptType: FTS_IOS_VERIFICATION_TYPE,
    status,
    blockers: [...blockers],
    failures: uniqueFailures,
    diagnostics: [...new Set(diagnostics)],
    evidence: {
      runtimeFamily: receipt.runtimeFamily,
      appVersion: receipt.appIdentity?.loadedAppVersion ?? null,
      pluginVersion: receipt.pluginIdentity?.version ?? null,
      deviceIdentitySha256: receipt.deviceIdentitySha256 ?? null,
      runtimeCanarySha256: receipt.sourceIdentity?.runtimeCanarySha256 ?? null,
      lexicalNormalizerSha256: receipt.sourceIdentity?.lexicalNormalizerSha256 ?? null,
      bundleSha256: receipt.artifacts?.bundle?.sha256 ?? null,
      pluginArtifactSha256: receipt.artifacts?.plugin?.sha256 ?? null,
      loadedPluginArtifactSha256:
        receipt.pluginIdentity?.loadedBuild?.loadedPluginArtifactSha256 ?? null,
      graphemeFingerprint: receipt.runtimeCanary?.graphemeFingerprint ?? null,
      wordFingerprint: receipt.runtimeCanary?.wordFingerprint ?? null,
      profileFingerprint: receipt.profileCanary?.fingerprint ?? null,
      externalSessionTrustBoundary: FTS_IOS_ATTESTATION_TRUST_BOUNDARY,
      externalSessionAttested: expected.externalAssuranceRequired === true
        && sessionBlockers.length === 0,
      externalAssuranceRequired: expected.externalAssuranceRequired === true,
      hardwareAttestationClaimed: Object.prototype.hasOwnProperty.call(
        expected.sessionAttestation ?? {},
        "hardwareAttestationClaimed",
      )
        ? expected.sessionAttestation.hardwareAttestationClaimed
        : receipt.operatorObservation?.hardwareAttestationClaimed ?? false,
      operatorObservation: receipt.operatorObservation ?? null,
      repositoryNode,
    },
  };
}

export function createBlockedFtsIosVerification(blockers, evidence = null) {
  return {
    schemaVersion: FTS_IOS_RECEIPT_SCHEMA_VERSION,
    receiptType: FTS_IOS_VERIFICATION_TYPE,
    status: "BLOCKED",
    blockers: [...new Set(blockers)],
    failures: [],
    diagnostics: [],
    evidence,
  };
}
