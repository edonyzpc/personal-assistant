#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  FTS_IOS_BUNDLE_API_NAME,
  buildFtsIosRuntimeBundle,
} from "./lib/fts-ios-runtime-bundle.mjs";
import {
  bindFtsIosRuntimeBundleToCheckoutProduction,
  readFtsIosPluginArtifactEvidence,
} from "./lib/fts-ios-runtime-artifact.mjs";
import {
  FTS_IOS_ATTESTATION_TYPE,
  FTS_IOS_ATTESTATION_TRUST_BOUNDARY,
  createFtsIosChallenge,
} from "./lib/fts-ios-runtime-session.mjs";

function parseArguments(argv) {
  const options = {
    output: null,
    pluginArtifact: "dist/main.js",
    buildReceipt: null,
    challengeOutput: null,
    trustedAttestorPublicKey: null,
    bundleVaultPath: "fts-ios-runtime-bundle.js",
    ttlMinutes: 10,
    format: "markdown",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json" || argument === "--format=json") options.format = "json";
    else if (argument === "--format=markdown") options.format = "markdown";
    else if (argument.startsWith("--output=")) options.output = argument.slice("--output=".length);
    else if (argument === "--output") options.output = argv[++index] ?? null;
    else if (argument.startsWith("--plugin-artifact=")) {
      options.pluginArtifact = argument.slice("--plugin-artifact=".length);
    } else if (argument === "--plugin-artifact") {
      options.pluginArtifact = argv[++index] ?? null;
    } else if (argument.startsWith("--build-receipt=")) {
      options.buildReceipt = argument.slice("--build-receipt=".length);
    } else if (argument === "--build-receipt") {
      options.buildReceipt = argv[++index] ?? null;
    } else if (argument.startsWith("--challenge-output=")) {
      options.challengeOutput = argument.slice("--challenge-output=".length);
    } else if (argument === "--challenge-output") {
      options.challengeOutput = argv[++index] ?? null;
    } else if (argument.startsWith("--trusted-attestor-public-key=")) {
      options.trustedAttestorPublicKey = argument.slice("--trusted-attestor-public-key=".length);
    } else if (argument === "--trusted-attestor-public-key") {
      options.trustedAttestorPublicKey = argv[++index] ?? null;
    } else if (argument.startsWith("--ttl-minutes=")) {
      options.ttlMinutes = Number(argument.slice("--ttl-minutes=".length));
    } else if (argument === "--ttl-minutes") {
      options.ttlMinutes = Number(argv[++index] ?? Number.NaN);
    } else if (argument.startsWith("--vault-path=")) {
      options.bundleVaultPath = argument.slice("--vault-path=".length);
    } else if (argument === "--vault-path") {
      options.bundleVaultPath = argv[++index] ?? "";
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  const hasExternalBuildReceipt = Boolean(options.buildReceipt);
  const hasExternalAttestorKey = Boolean(options.trustedAttestorPublicKey);
  if (!options.help && (!options.output || !options.pluginArtifact)) {
    throw new Error(
      "Use --output and --plugin-artifact. External build receipt and attestor key are an optional paired assurance.",
    );
  }
  if (!options.help && hasExternalBuildReceipt !== hasExternalAttestorKey) {
    throw new Error(
      "Use --build-receipt and --trusted-attestor-public-key together, or omit both for the base iOS canary.",
    );
  }
  return options;
}

const USAGE = [
  "Usage:",
  "  node scripts/fts-ios-runtime-prepare.mjs --output <bundle.js> --plugin-artifact <current repo dist/main.js or byte-identical copy> [--build-receipt <externally-signed-build-receipt.json> --trusted-attestor-public-key <external-public-key.pem> --challenge-output <challenge.json> --ttl-minutes 10] [--vault-path <vault-relative-path>] [--json]",
  "",
].join("\n");

function renderMarkdown(report) {
  return [
    "# B-125 iOS WKWebView runtime receipt bundle",
    "",
    `Status: **${report.status}**`,
    `Bundle: ${report.output}`,
    `External assurance: ${report.externalAssurance.enabled ? "available" : "not requested"}`,
    `Current plugin artifact SHA-256: ${report.currentPluginArtifact.sha256}`,
    "",
    "Safari Web Inspector console:",
    "",
    "```js",
    "(async () => {",
    `  const paFtsIosBundleSource = await app.vault.adapter.read(${JSON.stringify(report.bundleVaultPath)});`,
    "  await (0, eval)(paFtsIosBundleSource);",
    `  const paFtsIosReceipt = await ${FTS_IOS_BUNDLE_API_NAME}.capture({`,
    "    deviceIdentitySha256: \"<iPhone identity SHA-256>\",",
    "    operatorObservation: { schemaVersion: 1, observationType: \"pa.fts-ios-runtime-operator-observation\", realDeviceObserved: true, iphoneMirroringObserved: true, safariWebInspectorObserved: true, inspectedApplicationId: \"md.obsidian\", runtimeFamily: \"ios-wkwebview\", observedAt: new Date().toISOString(), hardwareAttestationClaimed: false },",
    "  });",
    "  copy(JSON.stringify(paFtsIosReceipt, null, 2));",
    "})()",
    "```",
    "",
    "Base PASS requires this operator observation from the real iPhone Mirroring",
    "and Safari Web Inspector session, plus the current source/bundle/plugin identities.",
    "It never claims cryptographic proof of physical hardware.",
    "",
    report.externalAssurance.enabled
      ? "Optional external assurance is signed by a separately managed attestor key; this repository does not hold that private key."
      : "Optional external Ed25519 build/session assurance was not requested.",
    report.externalAssurance.enabled
      ? `Verify with supplementary assurance: ${report.verifyCommandTemplate}`
      : `Verify base canary: ${report.verifyCommandTemplate}`,
    "",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const output = resolve(options.output);
  const externalAssuranceEnabled = Boolean(options.buildReceipt && options.trustedAttestorPublicKey);
  const challengeOutput = externalAssuranceEnabled
    ? resolve(options.challengeOutput ?? `${output}.challenge.json`)
    : null;
  const trustedAttestorPublicKey = externalAssuranceEnabled
    ? await readFile(resolve(options.trustedAttestorPublicKey), "utf8")
    : null;
  const pluginArtifact = await readFtsIosPluginArtifactEvidence(options.pluginArtifact, {
    buildReceiptPath: options.buildReceipt,
    attestorPublicKeyPem: trustedAttestorPublicKey,
    requireExternalBuildReceipt: externalAssuranceEnabled,
    requireCurrentRepositoryArtifact: true,
    requireLocalProductionBuildProvenance: true,
  });
  if (pluginArtifact.blockers.includes("current_plugin_artifact_not_repo_dist")) {
    throw new Error(
      "The supplied plugin artifact does not match the current repository dist/main.js.",
    );
  }
  if (pluginArtifact.blockers.length > 0) {
    throw new Error(
      `The plugin artifact is not a fresh production build: ${pluginArtifact.blockers.join(", ")}`,
    );
  }
  const challenge = externalAssuranceEnabled
    ? createFtsIosChallenge({
      ttlMs: options.ttlMinutes * 60_000,
      attestorPublicKeyPem: trustedAttestorPublicKey,
    })
    : null;
  const bundle = bindFtsIosRuntimeBundleToCheckoutProduction(
    await buildFtsIosRuntimeBundle({
      bundleVaultPath: options.bundleVaultPath,
      sessionChallenge: challenge,
      pluginArtifactSha256: pluginArtifact.sha256,
    }),
    pluginArtifact,
  );
  await Promise.all([
    mkdir(dirname(output), { recursive: true }),
    ...(challengeOutput ? [mkdir(dirname(challengeOutput), { recursive: true })] : []),
  ]);
  await Promise.all([
    writeFile(output, bundle.source, "utf8"),
    ...(challengeOutput ? [writeFile(challengeOutput, `${JSON.stringify(challenge, null, 2)}\n`, "utf8")] : []),
  ]);
  const attestationOutput = externalAssuranceEnabled ? `${output}.attestation.json` : null;
  const replayStore = externalAssuranceEnabled ? `${output}.replay` : null;
  const report = {
    schemaVersion: 2,
    reportType: "pa.fts-ios-runtime-preparation",
    status: "PREPARED",
    output,
    challengeOutput,
    bundleVaultPath: bundle.bundleVaultPath,
    bundleSha256: bundle.sha256,
    sourceIdentity: bundle.sourceIdentity,
    challenge,
    currentPluginArtifact: {
      path: pluginArtifact.path,
      sha256: pluginArtifact.sha256,
      byteLength: pluginArtifact.byteLength,
      productionBuildEvidence: pluginArtifact.productionBuildEvidence,
    },
    checkoutProductionBinding: bundle.checkoutProductionBinding,
    checkoutProductionBindingSha256: bundle.checkoutProductionBindingSha256,
    realDeviceExecuted: false,
    hardwareAttestationClaimed: false,
    externalAttestationRequired: false,
    repositoryHoldsAttestorPrivateKey: false,
    externalAssurance: {
      enabled: externalAssuranceEnabled,
      trustBoundary: externalAssuranceEnabled ? FTS_IOS_ATTESTATION_TRUST_BOUNDARY : null,
      buildReceipt: externalAssuranceEnabled,
      sessionChallenge: externalAssuranceEnabled,
      replayProtection: externalAssuranceEnabled,
    },
    externalAttestationContract: externalAssuranceEnabled ? {
      schemaVersion: 1,
      attestationType: FTS_IOS_ATTESTATION_TYPE,
      signatureAlgorithm: "Ed25519",
      signatureEncoding: "base64",
      canonicalization: "utf8-json-recursive-lexicographic-object-keys",
      requiredCollector: "macos-safari-web-inspector",
      requiredTransport: "usb",
      requiredApplicationId: "md.obsidian",
      binds: [
        "challengePayloadSha256",
        "receiptPayloadSha256",
        "deviceIdentitySha256",
        "pluginArtifactSha256",
        "loadedPluginArtifactSha256",
      ],
    } : null,
    verifyCommandTemplate: externalAssuranceEnabled
      ? `node scripts/fts-ios-runtime-verify.mjs --receipt <receipt.json> --bundle ${output} --plugin-artifact ${pluginArtifact.path} --device-identity-sha256 <sha256> --build-receipt ${resolve(options.buildReceipt)} --challenge ${challengeOutput} --session-attestation ${attestationOutput} --trusted-attestor-key-sha256 ${challenge.attestorPublicKeySha256} --replay-store ${replayStore} --json`
      : `node scripts/fts-ios-runtime-verify.mjs --receipt <receipt.json> --bundle ${output} --plugin-artifact ${pluginArtifact.path} --device-identity-sha256 <sha256> --json`,
  };
  process.stdout.write(options.format === "json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderMarkdown(report));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
