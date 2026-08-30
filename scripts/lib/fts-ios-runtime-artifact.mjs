import { createHash, verify } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { FTS_IOS_REPOSITORY_ROOT } from "./fts-ios-runtime-bundle.mjs";
import { canonicalizeFtsIosEvidence } from "./fts-ios-runtime-session.mjs";

export const FTS_IOS_PLUGIN_RUNTIME_IDENTITY_MARKER = "getLoadedPluginBuildIdentity";
export const FTS_IOS_PLUGIN_LOAD_CAPTURE_MARKER = "plugin-onload-cached-main-js";
export const FTS_IOS_MIN_PLUGIN_ARTIFACT_BYTES = 256 * 1024;

export const FTS_IOS_PRODUCTION_BUILD_RECEIPT_TYPE = "pa.fts-ios-production-build";
export const FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH = "dist/main.js";
export const FTS_IOS_LOCAL_PRODUCTION_BUILD_PROVENANCE_TYPE =
  "pa.fts-ios-local-production-build-provenance";
export const FTS_IOS_LOCAL_PRODUCTION_BUILD_PROVENANCE_PATH =
  "dist/fts-ios-production-build-provenance.json";
export const FTS_IOS_CHECKOUT_PRODUCTION_BINDING_TYPE =
  "pa.fts-ios-checkout-production-binding";
const FTS_IOS_CHECKOUT_PRODUCTION_BINDING_MARKER =
  "pa-fts-ios-checkout-production-binding";
// Frozen repo-local roots of the production esbuild/copy graph. `src` contains
// the TS/TSX and binary imports; its external text imports resolve into `skills`
// and `licenses`. Dependency bytes are separately pinned by package-lock.json.
const PRODUCTION_REPOSITORY_INPUT_DIRECTORIES = Object.freeze([
  "src",
  "skills",
  "licenses",
]);
const PRODUCTION_REPOSITORY_INPUT_FILES = Object.freeze([
  "esbuild.config.mjs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "manifest.json",
  "manifest-beta.json",
  "scripts/lib/fts-ios-runtime-artifact.mjs",
  "scripts/lib/fts-ios-runtime-bundle.mjs",
  "scripts/lib/fts-ios-runtime-session.mjs",
  "styles.css",
  "tailwind.config.cjs",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function captureFtsIosProductionBuildInputSnapshot(
  repositoryRoot = FTS_IOS_REPOSITORY_ROOT,
) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const paths = [
    ...(await Promise.all(PRODUCTION_REPOSITORY_INPUT_DIRECTORIES.map(
      (directory) => collectFiles(resolve(resolvedRepositoryRoot, directory)),
    ))).flat(),
    ...PRODUCTION_REPOSITORY_INPUT_FILES.map(
      (path) => resolve(resolvedRepositoryRoot, path),
    ),
  ].sort();
  const records = await Promise.all(paths.map(async (path) => {
    const [contents, fileStat] = await Promise.all([readFile(path), stat(path)]);
    return {
      path: relative(resolvedRepositoryRoot, path).split("\\").join("/"),
      contents,
      byteLength: contents.byteLength,
      mtimeMs: fileStat.mtimeMs,
      sha256: sha256(contents),
    };
  }));
  return {
    repositoryRoot: resolvedRepositoryRoot,
    records,
    inputCount: records.length,
    inputPaths: records.map((record) => record.path),
    latestMtimeMs: Math.max(...records.map((record) => record.mtimeMs)),
    sha256: sha256(records.map((record) => (
      `${record.path}\u0000${record.byteLength}\u0000${record.sha256}`
    )).join("\n")),
  };
}

export async function readFtsIosProductionBuildInputEvidence(
  repositoryRoot = FTS_IOS_REPOSITORY_ROOT,
) {
  const snapshot = await captureFtsIosProductionBuildInputSnapshot(repositoryRoot);
  return {
    inputCount: snapshot.inputCount,
    inputPaths: snapshot.inputPaths,
    latestMtimeMs: snapshot.latestMtimeMs,
    sha256: snapshot.sha256,
  };
}

function productionBuildReceiptPayload(receipt) {
  const payload = structuredClone(receipt);
  delete payload.signatureBase64;
  return payload;
}

function localProductionBuildProvenancePayload(provenance) {
  const payload = structuredClone(provenance);
  delete payload.provenancePayloadSha256;
  return payload;
}

function inspectLocalProductionBuildProvenance(provenance, context) {
  const blockers = [];
  if (provenance?.schemaVersion !== 1
    || provenance?.provenanceType !== FTS_IOS_LOCAL_PRODUCTION_BUILD_PROVENANCE_TYPE
    || provenance?.buildMode !== "production"
    || provenance?.producer !== "esbuild.config.mjs:production") {
    blockers.push("local_production_build_provenance_schema_invalid");
  }
  if (provenance?.artifactPath !== FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH) {
    blockers.push("local_production_build_provenance_artifact_path_invalid");
  }
  if (provenance?.artifactSha256 !== context.artifact.sha256
    || provenance?.artifactByteLength !== context.artifact.byteLength) {
    blockers.push("local_production_build_provenance_artifact_mismatch");
  }
  if (provenance?.checkoutInputCount !== context.buildInputs.inputCount
    || provenance?.checkoutInputSha256 !== context.buildInputs.sha256) {
    blockers.push("local_production_build_provenance_checkout_mismatch");
    blockers.push("current_plugin_artifact_stale");
  }
  if (typeof provenance?.builtAt !== "string"
    || !Number.isFinite(Date.parse(provenance.builtAt))) {
    blockers.push("local_production_build_provenance_time_invalid");
  }
  const payload = localProductionBuildProvenancePayload(provenance);
  if (provenance?.provenancePayloadSha256 !== sha256(
    canonicalizeFtsIosEvidence(payload),
  )) {
    blockers.push("local_production_build_provenance_integrity_invalid");
  }
  return [...new Set(blockers)];
}

export async function writeFtsIosLocalProductionBuildProvenance(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? FTS_IOS_REPOSITORY_ROOT);
  const artifactPath = resolve(repositoryRoot, FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH);
  const provenancePath = resolve(
    repositoryRoot,
    FTS_IOS_LOCAL_PRODUCTION_BUILD_PROVENANCE_PATH,
  );
  const [artifactSource, buildInputs] = await Promise.all([
    readFile(artifactPath, "utf8"),
    readFtsIosProductionBuildInputEvidence(repositoryRoot),
  ]);
  const expectedBuildInputs = options.expectedBuildInputs;
  if (expectedBuildInputs
    && (expectedBuildInputs.inputCount !== buildInputs.inputCount
      || expectedBuildInputs.sha256 !== buildInputs.sha256)) {
    throw new Error(
      "Production inputs changed while dist/main.js was being built; provenance was not written.",
    );
  }
  const payload = {
    schemaVersion: 1,
    provenanceType: FTS_IOS_LOCAL_PRODUCTION_BUILD_PROVENANCE_TYPE,
    buildMode: "production",
    producer: "esbuild.config.mjs:production",
    artifactPath: FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH,
    artifactSha256: sha256(artifactSource),
    artifactByteLength: Buffer.byteLength(artifactSource),
    checkoutInputCount: buildInputs.inputCount,
    checkoutInputSha256: buildInputs.sha256,
    builtAt: (options.now instanceof Date ? options.now : new Date()).toISOString(),
  };
  const provenance = {
    ...payload,
    provenancePayloadSha256: sha256(canonicalizeFtsIosEvidence(payload)),
  };
  const temporaryPath = `${provenancePath}.${process.pid}.tmp`;
  await mkdir(dirname(provenancePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  await rename(temporaryPath, provenancePath);
  return {
    path: provenancePath,
    provenance,
    sha256: sha256(`${JSON.stringify(provenance, null, 2)}\n`),
  };
}

function createCheckoutProductionBinding(artifact, buildInputs) {
  return Object.freeze({
    schemaVersion: 1,
    bindingType: FTS_IOS_CHECKOUT_PRODUCTION_BINDING_TYPE,
    artifactPath: FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH,
    artifactSha256: artifact.sha256,
    artifactByteLength: artifact.byteLength,
    checkoutInputCount: buildInputs.inputCount,
    checkoutInputSha256: buildInputs.sha256,
  });
}

export function bindFtsIosRuntimeBundleToCheckoutProduction(bundle, pluginArtifact) {
  if (typeof bundle?.source !== "string") {
    throw new Error("The iOS runtime bundle source is missing.");
  }
  const binding = pluginArtifact?.productionBuildEvidence?.currentCheckoutProductionBinding;
  if (binding?.bindingType !== FTS_IOS_CHECKOUT_PRODUCTION_BINDING_TYPE) {
    throw new Error("The current checkout production binding is missing.");
  }
  const encodedBinding = Buffer.from(
    canonicalizeFtsIosEvidence(binding),
    "utf8",
  ).toString("base64url");
  const source = `${bundle.source}\n/* ${FTS_IOS_CHECKOUT_PRODUCTION_BINDING_MARKER}:${encodedBinding} */\n`;
  return {
    ...bundle,
    source,
    sha256: sha256(source),
    checkoutProductionBinding: binding,
    checkoutProductionBindingSha256: sha256(canonicalizeFtsIosEvidence(binding)),
  };
}

export function inspectFtsIosDeterministicProductionRebuild(
  pluginArtifact,
  rebuiltArtifact,
) {
  const currentArtifact = pluginArtifact?.productionBuildEvidence ?? {};
  if (rebuiltArtifact?.sha256 === currentArtifact.currentRepositoryArtifactSha256
    && rebuiltArtifact?.byteLength === currentArtifact.currentRepositoryArtifactByteLength) {
    return [];
  }
  return [
    "deterministic_production_rebuild_mismatch",
    "current_plugin_artifact_stale",
  ];
}

function inspectProductionBuildReceipt(receipt, context) {
  const blockers = [];
  if (receipt?.schemaVersion !== 1
    || receipt?.receiptType !== FTS_IOS_PRODUCTION_BUILD_RECEIPT_TYPE
    || receipt?.buildMode !== "production") {
    blockers.push("trusted_build_receipt_schema_invalid");
  }
  if (receipt?.artifactPath !== FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH) {
    blockers.push("trusted_build_receipt_artifact_path_invalid");
  }
  if (receipt?.artifactSha256 !== context.artifactSha256
    || receipt?.artifactByteLength !== context.artifactByteLength) {
    blockers.push("trusted_build_receipt_artifact_mismatch");
  }
  if (receipt?.checkoutInputCount !== context.buildInputs.inputCount
    || receipt?.checkoutInputSha256 !== context.buildInputs.sha256) {
    blockers.push("trusted_build_receipt_checkout_mismatch");
    blockers.push("current_plugin_artifact_stale");
  }
  if (typeof receipt?.builtAt !== "string"
    || !Number.isFinite(Date.parse(receipt.builtAt))) {
    blockers.push("trusted_build_receipt_time_invalid");
  }
  const publicKeyPem = typeof context.attestorPublicKeyPem === "string"
    ? context.attestorPublicKeyPem
    : "";
  if (!publicKeyPem.includes("BEGIN PUBLIC KEY")
    || receipt?.attestorPublicKeySha256 !== sha256(publicKeyPem)) {
    blockers.push("trusted_build_receipt_attestor_mismatch");
  }
  try {
    const signature = Buffer.from(receipt?.signatureBase64 ?? "", "base64");
    if (signature.length === 0 || !verify(
      null,
      Buffer.from(canonicalizeFtsIosEvidence(productionBuildReceiptPayload(receipt))),
      publicKeyPem,
      signature,
    )) {
      blockers.push("trusted_build_receipt_signature_invalid");
    }
  } catch {
    blockers.push("trusted_build_receipt_signature_invalid");
  }
  return [...new Set(blockers)];
}

export function inspectFtsIosPluginArtifactSource(source) {
  const blockers = [];
  if (typeof source !== "string" || Buffer.byteLength(source) < FTS_IOS_MIN_PLUGIN_ARTIFACT_BYTES) {
    blockers.push("current_plugin_artifact_not_production");
  }
  if (!source?.includes("THIS IS A GENERATED/BUNDLED FILE BY ESBUILD")
    || !source.includes(FTS_IOS_PLUGIN_RUNTIME_IDENTITY_MARKER)
    || !source.includes(FTS_IOS_PLUGIN_LOAD_CAPTURE_MARKER)) {
    blockers.push("current_plugin_artifact_build_identity_missing");
  }
  if (source?.includes("sourceMappingURL=data:application/json")) {
    blockers.push("current_plugin_artifact_not_production");
  }
  return [...new Set(blockers)];
}

export async function readFtsIosPluginArtifactEvidence(path, options = {}) {
  const resolvedPath = resolve(path);
  const repositoryRoot = resolve(options.repositoryRoot ?? FTS_IOS_REPOSITORY_ROOT);
  const providedBuildInputSnapshot = options.buildInputSnapshot ?? null;
  if (providedBuildInputSnapshot
    && resolve(providedBuildInputSnapshot.repositoryRoot ?? "") !== repositoryRoot) {
    throw new Error("The production input snapshot belongs to another repository root.");
  }
  const requireCurrentRepositoryArtifact = options.requireCurrentRepositoryArtifact === true;
  const requireLocalProductionBuildProvenance =
    options.requireLocalProductionBuildProvenance === true;
  const currentRepositoryArtifactPath = resolve(
    repositoryRoot,
    FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH,
  );
  const localProductionBuildProvenancePath = resolve(
    repositoryRoot,
    FTS_IOS_LOCAL_PRODUCTION_BUILD_PROVENANCE_PATH,
  );
  const [
    source,
    artifactStat,
    buildInputs,
    buildReceiptText,
    currentRepositoryArtifact,
    localProductionBuildProvenanceText,
  ] = await Promise.all([
    readFile(resolvedPath, "utf8"),
    stat(resolvedPath),
    providedBuildInputSnapshot
      ? Promise.resolve({
        inputCount: providedBuildInputSnapshot.inputCount,
        inputPaths: providedBuildInputSnapshot.inputPaths,
        latestMtimeMs: providedBuildInputSnapshot.latestMtimeMs,
        sha256: providedBuildInputSnapshot.sha256,
      })
      : readFtsIosProductionBuildInputEvidence(repositoryRoot),
    options.buildReceiptPath
      ? readFile(resolve(options.buildReceiptPath), "utf8").catch(() => null)
      : Promise.resolve(null),
    requireCurrentRepositoryArtifact
      ? Promise.all([
        readFile(currentRepositoryArtifactPath, "utf8"),
        stat(currentRepositoryArtifactPath),
      ]).then(([currentSource, currentStat]) => ({
        path: currentRepositoryArtifactPath,
        source: currentSource,
        sha256: sha256(currentSource),
        byteLength: Buffer.byteLength(currentSource),
        mtimeMs: currentStat.mtimeMs,
      }))
      : Promise.resolve(null),
    requireLocalProductionBuildProvenance
      ? readFile(localProductionBuildProvenancePath, "utf8").catch(() => null)
      : Promise.resolve(null),
  ]);
  const blockers = inspectFtsIosPluginArtifactSource(source);
  const artifact = {
    path: resolvedPath,
    source,
    sha256: sha256(source),
    byteLength: Buffer.byteLength(source),
    mtimeMs: artifactStat.mtimeMs,
  };
  const repositoryArtifact = currentRepositoryArtifact ?? artifact;
  if (requireCurrentRepositoryArtifact
    && (artifact.sha256 !== repositoryArtifact.sha256
      || artifact.byteLength !== repositoryArtifact.byteLength)) {
    blockers.push("current_plugin_artifact_not_repo_dist");
  }
  const checkoutProductionBinding = createCheckoutProductionBinding(
    repositoryArtifact,
    buildInputs,
  );
  const checkoutProductionBindingSha256 = sha256(
    canonicalizeFtsIosEvidence(checkoutProductionBinding),
  );
  let localProductionBuildProvenance = null;
  if (requireLocalProductionBuildProvenance) {
    if (localProductionBuildProvenanceText === null) {
      blockers.push("local_production_build_provenance_missing");
    } else {
      try {
        localProductionBuildProvenance = JSON.parse(localProductionBuildProvenanceText);
        blockers.push(...inspectLocalProductionBuildProvenance(
          localProductionBuildProvenance,
          { artifact: repositoryArtifact, buildInputs },
        ));
      } catch {
        blockers.push("local_production_build_provenance_invalid");
      }
    }
  }
  let buildReceipt = null;
  if (buildReceiptText === null) {
    if (options.requireExternalBuildReceipt === true) {
      blockers.push("trusted_build_receipt_missing");
    }
  } else {
    try {
      buildReceipt = JSON.parse(buildReceiptText);
      blockers.push(...inspectProductionBuildReceipt(buildReceipt, {
        artifactSha256: artifact.sha256,
        artifactByteLength: artifact.byteLength,
        buildInputs,
        attestorPublicKeyPem: options.attestorPublicKeyPem,
      }));
    } catch {
      blockers.push("trusted_build_receipt_invalid");
    }
  }
  return {
    ...artifact,
    latestRequiredSourceMtimeMs: buildInputs.latestMtimeMs,
    productionBuildEvidence: {
      artifactPath: FTS_IOS_PRODUCTION_PLUGIN_ARTIFACT_PATH,
      artifactKind: "production-main-js",
      currentRepositoryArtifactPath: repositoryArtifact.path,
      currentRepositoryArtifactSha256: repositoryArtifact.sha256,
      currentRepositoryArtifactByteLength: repositoryArtifact.byteLength,
      currentRepositoryArtifactMtimeMs: repositoryArtifact.mtimeMs,
      currentCheckoutInputCount: buildInputs.inputCount,
      currentCheckoutInputSha256: buildInputs.sha256,
      currentCheckoutProductionBinding: checkoutProductionBinding,
      currentCheckoutProductionBindingSha256: checkoutProductionBindingSha256,
      localProductionBuildProvenancePath,
      localProductionBuildProvenanceSha256: localProductionBuildProvenanceText === null
        ? null
        : sha256(localProductionBuildProvenanceText),
      localProductionBuildProvenancePayloadSha256:
        localProductionBuildProvenance?.provenancePayloadSha256 ?? null,
      localProductionBuildProvenanceType:
        localProductionBuildProvenance?.provenanceType ?? null,
      localProductionBuildProvenanceBuiltAt:
        localProductionBuildProvenance?.builtAt ?? null,
      trustedBuildReceiptSha256: buildReceiptText === null ? null : sha256(buildReceiptText),
      trustedBuildReceiptType: buildReceipt?.receiptType ?? null,
      attestorPublicKeySha256: buildReceipt?.attestorPublicKeySha256 ?? null,
    },
    blockers: [...new Set(blockers)],
  };
}
