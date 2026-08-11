#!/usr/bin/env node

import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

import {
  FTS_IOS_RUNTIME_CANARY_PATH,
  buildFtsIosProfileReferenceSource,
  buildFtsIosRuntimeBundle,
} from "./lib/fts-ios-runtime-bundle.mjs";
import {
  bindFtsIosRuntimeBundleToCheckoutProduction,
  captureFtsIosProductionBuildInputSnapshot,
  inspectFtsIosDeterministicProductionRebuild,
  readFtsIosPluginArtifactEvidence,
} from "./lib/fts-ios-runtime-artifact.mjs";
import {
  FtsIosRuntimeIntegrityError,
  createBlockedFtsIosVerification,
  inspectFtsIosRuntimeReceipt,
  inspectRepositoryNodeReference,
  sha256,
} from "./lib/fts-ios-runtime-receipt.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ARTIFACT = resolve(SCRIPT_DIRECTORY, "../dist/main.js");
const CURRENT_PLUGIN_MANIFEST = resolve(SCRIPT_DIRECTORY, "../manifest.json");
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function parseArguments(argv) {
  const options = {
    receipt: null,
    bundle: null,
    pluginArtifact: DEFAULT_PLUGIN_ARTIFACT,
    buildReceipt: null,
    challenge: null,
    sessionAttestation: null,
    trustedAttestorKeySha256: null,
    replayStore: null,
    deviceIdentitySha256: null,
    format: "markdown",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json" || argument === "--format=json") options.format = "json";
    else if (argument === "--format=markdown") options.format = "markdown";
    else if (argument.startsWith("--receipt=")) options.receipt = argument.slice("--receipt=".length);
    else if (argument === "--receipt") options.receipt = argv[++index] ?? null;
    else if (argument.startsWith("--bundle=")) options.bundle = argument.slice("--bundle=".length);
    else if (argument === "--bundle") options.bundle = argv[++index] ?? null;
    else if (argument.startsWith("--plugin-artifact=")) {
      options.pluginArtifact = argument.slice("--plugin-artifact=".length);
    } else if (argument === "--plugin-artifact") {
      options.pluginArtifact = argv[++index] ?? null;
    } else if (argument.startsWith("--build-receipt=")) {
      options.buildReceipt = argument.slice("--build-receipt=".length);
    } else if (argument === "--build-receipt") {
      options.buildReceipt = argv[++index] ?? null;
    } else if (argument.startsWith("--challenge=")) {
      options.challenge = argument.slice("--challenge=".length);
    } else if (argument === "--challenge") {
      options.challenge = argv[++index] ?? null;
    } else if (argument.startsWith("--session-attestation=")) {
      options.sessionAttestation = argument.slice("--session-attestation=".length);
    } else if (argument === "--session-attestation") {
      options.sessionAttestation = argv[++index] ?? null;
    } else if (argument.startsWith("--trusted-attestor-key-sha256=")) {
      options.trustedAttestorKeySha256 = argument.slice("--trusted-attestor-key-sha256=".length);
    } else if (argument === "--trusted-attestor-key-sha256") {
      options.trustedAttestorKeySha256 = argv[++index] ?? null;
    } else if (argument.startsWith("--replay-store=")) {
      options.replayStore = argument.slice("--replay-store=".length);
    } else if (argument === "--replay-store") {
      options.replayStore = argv[++index] ?? null;
    } else if (argument.startsWith("--device-identity-sha256=")) {
      options.deviceIdentitySha256 = argument.slice("--device-identity-sha256=".length);
    } else if (argument === "--device-identity-sha256") {
      options.deviceIdentitySha256 = argv[++index] ?? null;
    } else if (!argument.startsWith("--") && !options.receipt) options.receipt = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

const USAGE = [
  "Usage:",
  "  node scripts/fts-ios-runtime-verify.mjs --receipt <receipt.json> --bundle <bundle.js> --plugin-artifact <current repo dist/main.js or byte-identical copy> --device-identity-sha256 <sha256> [--build-receipt <externally-signed-build-receipt.json> --challenge <challenge.json> --session-attestation <attestation.json> --trusted-attestor-key-sha256 <sha256> --replay-store <directory>] [--json]",
  "",
  "External Ed25519 build/session assurance is optional; when supplied, its full one-time challenge set is required and verified.",
  "Base PASS requires a real-device operator observation plus current source, bundle, dist, iCloud-loaded plugin, app and runtime identities.",
  "Missing base receipt/device/artifact evidence returns structured BLOCKED (exit 2).",
  "Repository reference evaluation requires Node 22; Node 20/24 return BLOCKED.",
  "",
].join("\n");

async function exists(path) {
  if (!path) return false;
  try {
    await access(resolve(path));
    return true;
  } catch {
    return false;
  }
}

export async function rebuildProductionArtifactFromSnapshot(buildInputSnapshot) {
  const snapshotRoot = await mkdtemp(join(tmpdir(), "pa-ios-production-verify-"));
  try {
    await Promise.all(buildInputSnapshot.records.map(async (record) => {
      const destination = resolve(snapshotRoot, record.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, record.contents);
    }));
    await symlink(
      resolve(SCRIPT_DIRECTORY, "../node_modules"),
      resolve(snapshotRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const snapshotBuildConfig = await import(
      `${pathToFileURL(resolve(snapshotRoot, "esbuild.config.mjs")).href}?snapshot=${Date.now()}`
    );
    if (typeof snapshotBuildConfig.buildProductionMainArtifactInMemory !== "function") {
      throw new Error("The snapshot production build function is missing.");
    }
    const rebuilt = await snapshotBuildConfig.buildProductionMainArtifactInMemory({
      absWorkingDir: snapshotRoot,
    });
    return {
      sha256: sha256(rebuilt.source),
      byteLength: rebuilt.byteLength,
    };
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
}

function renderMarkdown(result) {
  return [
    "# B-125 iOS WKWebView runtime receipt verification",
    "",
    `Status: **${result.status}**`,
    `Blockers: ${result.blockers.join(", ") || "none"}`,
    `Failures: ${result.failures.join(", ") || "none"}`,
    `Diagnostics: ${result.diagnostics.join(", ") || "none"}`,
    "",
  ].join("\n");
}

function evaluateRuntimeReference(source) {
  const context = { Intl, document: {} };
  context.globalThis = context;
  runInNewContext(source, context, { timeout: 3000 });
  const artifact = context.__PA_FTS_RUNTIME_CANARY__;
  if (!artifact?.fingerprintPayload) throw new Error("Runtime reference canary returned no payload.");
  return {
    ...JSON.parse(JSON.stringify(artifact)),
    fingerprint: sha256(artifact.fingerprintPayload),
    graphemeFingerprint: sha256(artifact.fingerprintPayload.graphemes),
    wordFingerprint: sha256(artifact.fingerprintPayload.words),
  };
}

async function evaluateProfileReference() {
  const source = await buildFtsIosProfileReferenceSource();
  const context = { Intl };
  context.globalThis = context;
  runInNewContext(source, context, { timeout: 3000 });
  const artifact = context.__PA_FTS_IOS_PROFILE_REFERENCE__;
  if (!artifact) throw new Error("Profile reference canary returned no artifact.");
  return JSON.parse(JSON.stringify(artifact));
}

function writeResult(result, format) {
  process.stdout.write(format === "json"
    ? `${JSON.stringify(result, null, 2)}\n`
    : renderMarkdown(result));
  if (result.status !== "PASS") process.exitCode = result.status === "FAIL" ? 1 : 2;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new FtsIosRuntimeIntegrityError(`${label} is not valid JSON`);
  }
}

async function claimOneTimeChallenge(replayStore, challenge, receipt) {
  const directory = resolve(replayStore);
  await mkdir(directory, { recursive: true });
  const claimPath = resolve(directory, `${sha256(challenge.challengeId)}.json`);
  try {
    await writeFile(claimPath, `${JSON.stringify({
      schemaVersion: 1,
      claimType: "pa.fts-ios-runtime-challenge-claim",
      challengeId: challenge.challengeId,
      challengePayloadSha256: challenge.challengePayloadSha256,
      receiptPayloadSha256: receipt.receiptPayloadSha256,
      consumedAt: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") return false;
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const repositoryNode = inspectRepositoryNodeReference(process.versions.node);
  const blockers = [...repositoryNode.blockers];
  const externalOptionValues = [
    options.buildReceipt,
    options.challenge,
    options.sessionAttestation,
    options.trustedAttestorKeySha256,
    options.replayStore,
  ];
  const externalAssuranceRequested = externalOptionValues.some(Boolean);
  if (!(await exists(options.receipt))) blockers.push("receipt_missing");
  if (!(await exists(options.bundle))) blockers.push("current_bundle_missing");
  if (!(await exists(options.pluginArtifact))) blockers.push("current_plugin_artifact_missing");
  if (!(await exists(DEFAULT_PLUGIN_ARTIFACT))) blockers.push("repository_dist_plugin_artifact_missing");
  if (!(await exists(CURRENT_PLUGIN_MANIFEST))) blockers.push("current_plugin_manifest_missing");
  if (!SHA256_PATTERN.test(options.deviceIdentitySha256 ?? "")) {
    blockers.push("expected_device_identity_missing");
  }
  if (externalAssuranceRequested) {
    if (!(await exists(options.buildReceipt))) blockers.push("trusted_build_receipt_missing");
    if (!(await exists(options.challenge))) blockers.push("session_challenge_file_missing");
    if (!(await exists(options.sessionAttestation))) {
      blockers.push("trusted_device_session_evidence_missing");
    }
    if (!SHA256_PATTERN.test(options.trustedAttestorKeySha256 ?? "")) {
      blockers.push("trusted_attestor_key_missing");
    }
    if (!options.replayStore) blockers.push("replay_store_missing");
  }
  if (blockers.length > 0) {
    writeResult(createBlockedFtsIosVerification(blockers, { repositoryNode }), options.format);
    return;
  }

  const [
    receiptText,
    bundleSource,
    challengeText,
    sessionAttestationText,
    runtimeCanarySource,
    pluginManifestText,
  ] = await Promise.all([
    readFile(resolve(options.receipt), "utf8"),
    readFile(resolve(options.bundle), "utf8"),
    externalAssuranceRequested
      ? readFile(resolve(options.challenge), "utf8")
      : Promise.resolve(null),
    externalAssuranceRequested
      ? readFile(resolve(options.sessionAttestation), "utf8")
      : Promise.resolve(null),
    readFile(FTS_IOS_RUNTIME_CANARY_PATH, "utf8"),
    readFile(CURRENT_PLUGIN_MANIFEST, "utf8"),
  ]);
  const receipt = parseJson(receiptText, "receipt");
  const challenge = challengeText === null ? null : parseJson(challengeText, "session challenge");
  const sessionAttestation = sessionAttestationText === null
    ? null
    : parseJson(sessionAttestationText, "session attestation");
  const pluginManifest = parseJson(pluginManifestText, "current plugin manifest");
  const buildInputSnapshot = await captureFtsIosProductionBuildInputSnapshot();
  const pluginArtifact = await readFtsIosPluginArtifactEvidence(options.pluginArtifact, {
    buildReceiptPath: options.buildReceipt,
    attestorPublicKeyPem: challenge?.attestorPublicKeyPem,
    requireExternalBuildReceipt: externalAssuranceRequested,
    requireCurrentRepositoryArtifact: true,
    requireLocalProductionBuildProvenance: true,
    buildInputSnapshot,
  });
  const deterministicRebuild = await rebuildProductionArtifactFromSnapshot(
    buildInputSnapshot,
  );
  const buildInputsAfterRebuild = await captureFtsIosProductionBuildInputSnapshot();
  if (buildInputSnapshot.inputCount !== buildInputsAfterRebuild.inputCount
    || buildInputSnapshot.sha256 !== buildInputsAfterRebuild.sha256) {
    pluginArtifact.blockers.push("current_checkout_changed_during_verification");
  }
  pluginArtifact.blockers.push(...inspectFtsIosDeterministicProductionRebuild(
    pluginArtifact,
    deterministicRebuild,
  ));
  pluginArtifact.blockers = [...new Set(pluginArtifact.blockers)];
  let expectedBundle;
  try {
    expectedBundle = bindFtsIosRuntimeBundleToCheckoutProduction(
      await buildFtsIosRuntimeBundle({
        bundleVaultPath: receipt?.artifacts?.bundle?.path,
        sessionChallenge: challenge,
        pluginArtifactSha256: pluginArtifact.sha256,
      }),
      pluginArtifact,
    );
  } catch (error) {
    throw new FtsIosRuntimeIntegrityError(
      `receipt bundle identity is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (sha256(bundleSource) !== expectedBundle.sha256) {
    throw new FtsIosRuntimeIntegrityError("provided bundle differs from the current checkout build");
  }
  const referenceProfile = await evaluateProfileReference();
  const result = inspectFtsIosRuntimeReceipt(receipt, {
    sourceIdentity: expectedBundle.sourceIdentity,
    bundleSha256: expectedBundle.sha256,
    pluginArtifactSha256: pluginArtifact.sha256,
    currentPluginArtifactBlockers: pluginArtifact.blockers,
    pluginId: pluginManifest.id,
    pluginVersion: pluginManifest.version,
    deviceIdentitySha256: options.deviceIdentitySha256,
    referenceRuntime: evaluateRuntimeReference(runtimeCanarySource),
    referenceProfile,
    repositoryNodeVersion: process.versions.node,
    verificationNow: new Date(),
    sessionChallenge: challenge,
    sessionAttestation,
    trustedAttestorKeySha256: options.trustedAttestorKeySha256,
    externalAssuranceRequired: externalAssuranceRequested,
  });
  result.evidence.currentPluginArtifact = {
    path: pluginArtifact.path,
    sha256: pluginArtifact.sha256,
    productionBuildEvidence: pluginArtifact.productionBuildEvidence,
  };
  result.evidence.checkoutProductionBinding = expectedBundle.checkoutProductionBinding;
  result.evidence.checkoutProductionBindingSha256 =
    expectedBundle.checkoutProductionBindingSha256;
  result.evidence.deterministicProductionRebuild = {
    checkoutInputCount: buildInputSnapshot.inputCount,
    checkoutInputSha256: buildInputSnapshot.sha256,
    artifactSha256: deterministicRebuild.sha256,
    artifactByteLength: deterministicRebuild.byteLength,
    currentCheckoutStableDuringRebuild:
      buildInputSnapshot.inputCount === buildInputsAfterRebuild.inputCount
      && buildInputSnapshot.sha256 === buildInputsAfterRebuild.sha256,
    isolatedSnapshot: true,
    wroteRepositoryDist: false,
  };
  if (result.status === "PASS" && externalAssuranceRequested) {
    const claimed = await claimOneTimeChallenge(options.replayStore, challenge, receipt);
    if (!claimed) {
      result.status = "BLOCKED";
      result.blockers.push("session_challenge_replayed");
      result.evidence.externalSessionAttested = false;
    }
  }
  writeResult(result, options.format);
}

const isExecutedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isExecutedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
