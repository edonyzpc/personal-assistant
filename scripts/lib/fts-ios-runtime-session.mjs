import {
  createHash,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";

export const FTS_IOS_CHALLENGE_SCHEMA_VERSION = 1;
export const FTS_IOS_CHALLENGE_TYPE = "pa.fts-ios-runtime-challenge";
export const FTS_IOS_ATTESTATION_SCHEMA_VERSION = 1;
export const FTS_IOS_ATTESTATION_TYPE = "pa.fts-ios-runtime-session-attestation";
export const FTS_IOS_ATTESTATION_TRUST_BOUNDARY =
  "operator-confirmed-safari-web-inspector-session-not-hardware-attestation";
export const FTS_IOS_DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function canonicalizeFtsIosEvidence(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeFtsIosEvidence(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalizeFtsIosEvidence(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256Session(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex");
}

function challengePayload(challenge) {
  const payload = structuredClone(challenge);
  delete payload.challengePayloadSha256;
  return payload;
}

export function sealFtsIosChallenge(challenge) {
  const payload = challengePayload(challenge);
  return {
    ...payload,
    challengePayloadSha256: sha256Session(payload),
  };
}

export function createFtsIosChallenge(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const ttlMs = Number.isFinite(options.ttlMs)
    ? Number(options.ttlMs)
    : FTS_IOS_DEFAULT_CHALLENGE_TTL_MS;
  if (ttlMs < 60_000 || ttlMs > 30 * 60_000) {
    throw new Error("The iOS challenge TTL must be between 1 and 30 minutes.");
  }
  const publicKeyPem = typeof options.attestorPublicKeyPem === "string"
    ? options.attestorPublicKeyPem
    : "";
  if (!publicKeyPem.includes("BEGIN PUBLIC KEY")) {
    throw new Error("An externally managed attestor public key is required.");
  }
  const attestorPublicKeySha256 = sha256Session(publicKeyPem);
  return sealFtsIosChallenge({
    schemaVersion: FTS_IOS_CHALLENGE_SCHEMA_VERSION,
    challengeType: FTS_IOS_CHALLENGE_TYPE,
    challengeId: randomUUID(),
    nonce: randomBytes(32).toString("hex"),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    attestorPublicKeyPem: publicKeyPem,
    attestorPublicKeySha256,
    trustBoundary: FTS_IOS_ATTESTATION_TRUST_BOUNDARY,
  });
}

export function validateFtsIosChallenge(challenge, options = {}) {
  const blockers = [];
  if (challenge?.schemaVersion !== FTS_IOS_CHALLENGE_SCHEMA_VERSION
    || challenge?.challengeType !== FTS_IOS_CHALLENGE_TYPE) {
    blockers.push("session_challenge_schema_invalid");
  }
  if (typeof challenge?.challengeId !== "string" || challenge.challengeId.length < 16) {
    blockers.push("session_challenge_id_missing");
  }
  if (!/^[a-f0-9]{64}$/u.test(challenge?.nonce ?? "")) {
    blockers.push("session_challenge_nonce_missing");
  }
  if (!SHA256_PATTERN.test(challenge?.attestorPublicKeySha256 ?? "")
    || typeof challenge?.attestorPublicKeyPem !== "string"
    || sha256Session(challenge.attestorPublicKeyPem) !== challenge.attestorPublicKeySha256) {
    blockers.push("session_attestor_key_invalid");
  }
  if (challenge?.trustBoundary !== FTS_IOS_ATTESTATION_TRUST_BOUNDARY) {
    blockers.push("session_trust_boundary_missing");
  }
  if (!SHA256_PATTERN.test(challenge?.challengePayloadSha256 ?? "")
    || sha256Session(challengePayload(challenge)) !== challenge?.challengePayloadSha256) {
    blockers.push("session_challenge_integrity_invalid");
  }
  const issuedAt = Date.parse(challenge?.issuedAt ?? "");
  const expiresAt = Date.parse(challenge?.expiresAt ?? "");
  const nowMs = options.now instanceof Date ? options.now.getTime() : Date.now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    blockers.push("session_challenge_time_invalid");
  } else if (options.enforceTime !== false) {
    if (nowMs < issuedAt - 30_000) blockers.push("session_challenge_not_active");
    if (nowMs > expiresAt) blockers.push("session_challenge_expired");
  }
  if (options.trustedAttestorKeySha256
    && challenge?.attestorPublicKeySha256 !== options.trustedAttestorKeySha256) {
    blockers.push("trusted_attestor_key_mismatch");
  }
  return [...new Set(blockers)];
}

function attestationPayload(attestation) {
  const payload = structuredClone(attestation);
  delete payload.signatureBase64;
  return payload;
}

export function validateFtsIosSessionAttestation(attestation, receipt, challenge, options = {}) {
  const blockers = [
    ...validateFtsIosChallenge(challenge, {
      now: options.now,
      trustedAttestorKeySha256: options.trustedAttestorKeySha256,
    }),
  ];
  if (attestation?.schemaVersion !== FTS_IOS_ATTESTATION_SCHEMA_VERSION
    || attestation?.attestationType !== FTS_IOS_ATTESTATION_TYPE) {
    blockers.push("trusted_device_evidence_schema_invalid");
  }
  if (attestation?.trustBoundary !== FTS_IOS_ATTESTATION_TRUST_BOUNDARY
    || attestation?.evidenceOrigin !== "external-safari-web-inspector-operator-session"
    || attestation?.collector !== "macos-safari-web-inspector"
    || attestation?.transport !== "usb"
    || attestation?.inspectedApplicationId !== "md.obsidian"
    || attestation?.runtimeFamily !== "ios-wkwebview") {
    blockers.push("trusted_device_session_evidence_missing");
  }
  if (Object.prototype.hasOwnProperty.call(attestation ?? {}, "hardwareAttestationClaimed")
    && attestation.hardwareAttestationClaimed !== false) {
    blockers.push("hardware_attestation_claim_invalid");
  }
  if (!options.trustedAttestorKeySha256) blockers.push("trusted_attestor_key_missing");
  if (attestation?.challengeId !== challenge?.challengeId
    || attestation?.challengePayloadSha256 !== challenge?.challengePayloadSha256
    || receipt?.sessionChallenge?.challengePayloadSha256 !== challenge?.challengePayloadSha256) {
    blockers.push("session_challenge_binding_mismatch");
  }
  if (attestation?.receiptPayloadSha256 !== receipt?.receiptPayloadSha256) {
    blockers.push("trusted_device_receipt_binding_mismatch");
  }
  if (!SHA256_PATTERN.test(attestation?.deviceIdentitySha256 ?? "")
    || attestation?.deviceIdentitySha256 !== receipt?.deviceIdentitySha256
    || (options.deviceIdentitySha256
      && attestation?.deviceIdentitySha256 !== options.deviceIdentitySha256)) {
    blockers.push("trusted_device_identity_mismatch");
  }
  if (attestation?.pluginArtifactSha256 !== receipt?.artifacts?.plugin?.sha256
    || attestation?.loadedPluginArtifactSha256
      !== (receipt?.pluginIdentity?.loadedBuild?.loadedPluginArtifactSha256 ?? null)) {
    blockers.push("trusted_device_plugin_binding_mismatch");
  }
  const observedAt = Date.parse(attestation?.observedAt ?? "");
  const generatedAt = Date.parse(receipt?.generatedAt ?? "");
  const issuedAt = Date.parse(challenge?.issuedAt ?? "");
  const expiresAt = Date.parse(challenge?.expiresAt ?? "");
  if (!Number.isFinite(observedAt)
    || !Number.isFinite(generatedAt)
    || observedAt < issuedAt
    || observedAt > expiresAt
    || generatedAt < issuedAt
    || generatedAt > expiresAt
    || observedAt < generatedAt - 30_000) {
    blockers.push("trusted_device_session_time_invalid");
  }
  if (attestation?.attestorPublicKeySha256 !== challenge?.attestorPublicKeySha256) {
    blockers.push("trusted_attestor_key_mismatch");
  }
  try {
    const signature = Buffer.from(attestation?.signatureBase64 ?? "", "base64");
    if (signature.length === 0 || !verify(
      null,
      Buffer.from(canonicalizeFtsIosEvidence(attestationPayload(attestation))),
      challenge?.attestorPublicKeyPem,
      signature,
    )) {
      blockers.push("trusted_device_evidence_signature_invalid");
    }
  } catch {
    blockers.push("trusted_device_evidence_signature_invalid");
  }
  return [...new Set(blockers)];
}
