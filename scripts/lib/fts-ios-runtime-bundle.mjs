import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const LIB_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const FTS_IOS_REPOSITORY_ROOT = resolve(LIB_DIRECTORY, "../..");
export const FTS_IOS_RUNTIME_CANARY_PATH = resolve(
  FTS_IOS_REPOSITORY_ROOT,
  "scripts/fts-runtime-canary.cjs",
);
export const FTS_IOS_LEXICAL_NORMALIZER_PATH = resolve(
  FTS_IOS_REPOSITORY_ROOT,
  "src/vss/lexical-normalizer.ts",
);
export const FTS_IOS_IDENTITY_CONTRACT_PATH = resolve(
  FTS_IOS_REPOSITORY_ROOT,
  "scripts/lib/fts-ios-runtime-identity.mjs",
);

export const FTS_IOS_BUNDLE_API_NAME = "paFtsIosRuntimeReceipt";
export const FTS_IOS_RECEIPT_SCHEMA_VERSION = 2;
export const FTS_IOS_RECEIPT_TYPE = "pa.fts-ios-runtime";
export const FTS_IOS_PROFILE_CASES = Object.freeze([
  "召回。",
  "乒乓球拍",
  "東京大学生協",
  "日本語・検索",
  "々ー",
  "葛\u{E0100}",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function buildBrowserSource(contents, sourcefile) {
  const result = await build({
    stdin: {
      contents,
      resolveDir: FTS_IOS_REPOSITORY_ROOT,
      sourcefile,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["safari17"],
    charset: "utf8",
    legalComments: "none",
    external: ["node:crypto"],
    write: false,
    logLevel: "silent",
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error(`${sourcefile} produced no output.`);
  return source;
}

function profileCollectorSource(globalKey) {
  return `
import {
  CHAR_PHRASE_PROFILE_ID,
  CHAR_PHRASE_TOKENIZER,
  getCharPhraseRuntimeCanaryFingerprint,
  segmentGraphemes,
  transformCharPhraseDocument,
} from "./src/vss/lexical-normalizer.ts";

const PROFILE_CASES = ${JSON.stringify(FTS_IOS_PROFILE_CASES)};
function collectProfileCanary() {
  return {
    schemaVersion: 1,
    profileId: CHAR_PHRASE_PROFILE_ID,
    tokenizer: CHAR_PHRASE_TOKENIZER,
    runtimeFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
    cases: PROFILE_CASES.map((value, index) => ({
      id: \`profile-\${index + 1}\`,
      value,
      graphemes: segmentGraphemes(value),
      transformed: transformCharPhraseDocument(value),
    })),
  };
}
globalThis[${JSON.stringify(globalKey)}] = collectProfileCanary();
`;
}

export async function buildFtsIosProfileReferenceSource() {
  return buildBrowserSource(
    profileCollectorSource("__PA_FTS_IOS_PROFILE_REFERENCE__"),
    "fts-ios-runtime-profile-reference.ts",
  );
}

export async function buildFtsIosRuntimeBundle(options = {}) {
  const bundleVaultPath = String(
    options.bundleVaultPath ?? "fts-ios-runtime-bundle.js",
  ).trim();
  if (!bundleVaultPath || bundleVaultPath.startsWith("/") || bundleVaultPath.includes("..")) {
    throw new Error("The iOS runtime bundle vault path must be a relative safe path.");
  }
  const sessionChallenge = options.sessionChallenge == null
    ? null
    : structuredClone(options.sessionChallenge);
  const currentPluginArtifactSha256 = typeof options.pluginArtifactSha256 === "string"
    ? options.pluginArtifactSha256
    : null;
  const [runtimeCanarySource, lexicalNormalizerSource, identityContractSource] = await Promise.all([
    readFile(FTS_IOS_RUNTIME_CANARY_PATH, "utf8"),
    readFile(FTS_IOS_LEXICAL_NORMALIZER_PATH, "utf8"),
    readFile(FTS_IOS_IDENTITY_CONTRACT_PATH, "utf8"),
  ]);
  const sourceIdentity = Object.freeze({
    runtimeCanarySha256: sha256(runtimeCanarySource),
    lexicalNormalizerSha256: sha256(lexicalNormalizerSource),
    iosIdentityContractSha256: sha256(identityContractSource),
    currentPluginArtifactSha256,
  });
  const entry = `
import {
  CHAR_PHRASE_PROFILE_ID,
  CHAR_PHRASE_TOKENIZER,
  getCharPhraseRuntimeCanaryFingerprint,
  segmentGraphemes,
  transformCharPhraseDocument,
} from "./src/vss/lexical-normalizer.ts";
import {
  FTS_IOS_PLATFORM_CLASS,
  FTS_IOS_RUNTIME_FAMILY,
  iosRuntimeIdentityBlockers,
  shellVersionFromIosUserAgent,
} from "./scripts/lib/fts-ios-runtime-identity.mjs";

const RECEIPT_SCHEMA_VERSION = ${FTS_IOS_RECEIPT_SCHEMA_VERSION};
const RECEIPT_TYPE = ${JSON.stringify(FTS_IOS_RECEIPT_TYPE)};
const BUNDLE_API_NAME = ${JSON.stringify(FTS_IOS_BUNDLE_API_NAME)};
const DEFAULT_BUNDLE_VAULT_PATH = ${JSON.stringify(bundleVaultPath)};
const SOURCE_IDENTITY = Object.freeze(${JSON.stringify(sourceIdentity)});
const SESSION_CHALLENGE = Object.freeze(${JSON.stringify(sessionChallenge)});
const PROFILE_CASES = ${JSON.stringify(FTS_IOS_PROFILE_CASES)};
const PLUGIN_ID = "personal-assistant";

async function sha256Browser(value) {
  const bytes = new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function collectRuntimeCanary() {
  delete globalThis.__PA_FTS_RUNTIME_CANARY__;
${runtimeCanarySource}
  const artifact = globalThis.__PA_FTS_RUNTIME_CANARY__;
  if (!artifact?.fingerprintPayload) throw new Error("Runtime canary returned no payload.");
  return artifact;
}

function collectProfileCanary() {
  return {
    schemaVersion: 1,
    profileId: CHAR_PHRASE_PROFILE_ID,
    tokenizer: CHAR_PHRASE_TOKENIZER,
    runtimeFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
    cases: PROFILE_CASES.map((value, index) => ({
      id: \`profile-\${index + 1}\`,
      value,
      graphemes: segmentGraphemes(value),
      transformed: transformCharPhraseDocument(value),
    })),
  };
}

async function readVaultArtifact(path, blocker, blockers) {
  try {
    const adapter = globalThis.app?.vault?.adapter;
    if (typeof adapter?.read !== "function") throw new Error("vault adapter unavailable");
    return await adapter.read(path);
  } catch {
    blockers.push(blocker);
    return null;
  }
}

async function capture(options = {}) {
  const blockers = [];
  const userAgent = typeof globalThis.navigator?.userAgent === "string"
    ? globalThis.navigator.userAgent
    : "";
  const plugin = globalThis.app?.plugins?.plugins?.[PLUGIN_ID] ?? null;
  let formalIdentity = null;
  let loadedBuildIdentity = null;
  if (typeof plugin?.getObsidianRuntimeIdentity === "function") {
    try {
      formalIdentity = plugin.getObsidianRuntimeIdentity();
    } catch {
      formalIdentity = null;
    }
  }
  if (typeof plugin?.getLoadedPluginBuildIdentity === "function") {
    try {
      loadedBuildIdentity = await plugin.getLoadedPluginBuildIdentity();
    } catch {
      loadedBuildIdentity = null;
    }
  }
  const runtimeCanary = collectRuntimeCanary();
  if (formalIdentity?.loadedAppVersionSource === "obsidian.apiVersion") {
    runtimeCanary.runtime.obsidianAppVersion = formalIdentity.loadedAppVersion;
    runtimeCanary.runtime.obsidianVersionSource = formalIdentity.loadedAppVersionSource;
  }
  runtimeCanary.fingerprint = await sha256Browser(runtimeCanary.fingerprintPayload);
  runtimeCanary.graphemeFingerprint = await sha256Browser(
    runtimeCanary.fingerprintPayload.graphemes,
  );
  runtimeCanary.wordFingerprint = await sha256Browser(runtimeCanary.fingerprintPayload.words);
  const profileArtifact = collectProfileCanary();
  const profileCanary = {
    artifact: profileArtifact,
    fingerprint: await sha256Browser(profileArtifact),
  };
  const bundlePath = typeof options.bundleVaultPath === "string"
    && options.bundleVaultPath.trim()
    ? options.bundleVaultPath.trim()
    : DEFAULT_BUNDLE_VAULT_PATH;
  const configDir = typeof globalThis.app?.vault?.configDir === "string"
    && globalThis.app.vault.configDir.trim()
    ? globalThis.app.vault.configDir.trim()
    : ".obsidian";
  const pluginArtifactPath = \`\${configDir}/plugins/\${PLUGIN_ID}/main.js\`;
  const [bundleSource, pluginArtifactSource] = await Promise.all([
    readVaultArtifact(bundlePath, "bundle_artifact_missing", blockers),
    readVaultArtifact(pluginArtifactPath, "plugin_artifact_missing", blockers),
  ]);
  const appIdentity = {
    loadedAppVersion: formalIdentity?.loadedAppVersion ?? null,
    loadedAppVersionSource: formalIdentity?.loadedAppVersionSource ?? null,
    identitySource: formalIdentity ? "plugin.getObsidianRuntimeIdentity" : null,
    shellVersion: shellVersionFromIosUserAgent(userAgent),
    shellVersionSource: shellVersionFromIosUserAgent(userAgent)
      ? "navigator.userAgent:obsidian/x"
      : null,
  };
  const browserIdentity = {
    userAgent,
    platform: typeof globalThis.navigator?.platform === "string"
      ? globalThis.navigator.platform
      : null,
    maxTouchPoints: Number.isInteger(globalThis.navigator?.maxTouchPoints)
      ? globalThis.navigator.maxTouchPoints
      : null,
    language: typeof globalThis.navigator?.language === "string"
      ? globalThis.navigator.language
      : null,
    hasDocument: typeof globalThis.document !== "undefined",
    locationHref: typeof globalThis.location?.href === "string"
      ? globalThis.location.href
      : null,
  };
  const identityEvidence = {
    runtimeFamily: FTS_IOS_RUNTIME_FAMILY,
    platformClass: FTS_IOS_PLATFORM_CLASS,
    browserIdentity,
    runtimeCanary,
    appIdentity,
    pluginIdentity: {
      id: plugin?.manifest?.id ?? null,
      version: plugin?.manifest?.version ?? null,
      loadedBuild: loadedBuildIdentity,
    },
    deviceIdentitySha256: options.deviceIdentitySha256 ?? null,
    operatorObservation: options.operatorObservation ?? null,
    sessionChallenge: SESSION_CHALLENGE,
  };
  const generatedAt = new Date().toISOString();
  const artifacts = {
    bundle: {
      path: bundlePath,
      sha256: bundleSource === null ? null : await sha256Browser(bundleSource),
    },
    plugin: {
      path: pluginArtifactPath,
      sha256: pluginArtifactSource === null ? null : await sha256Browser(pluginArtifactSource),
    },
  };
  const completeIdentityEvidence = {
    ...identityEvidence,
    generatedAt,
    sourceIdentity: SOURCE_IDENTITY,
    artifacts,
    profileCanary,
  };
  blockers.push(...iosRuntimeIdentityBlockers(completeIdentityEvidence));
  const coreReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptType: RECEIPT_TYPE,
    generatedAt,
    captureStatus: blockers.length === 0 ? "CANDIDATE" : "BLOCKED",
    externalTrustStatus: "UNATTESTED",
    blockers: [...new Set(blockers)],
    ...identityEvidence,
    sourceIdentity: SOURCE_IDENTITY,
    artifacts,
    profileCanary,
  };
  const receipt = {
    ...coreReceipt,
    receiptPayloadSha256: await sha256Browser(coreReceipt),
  };
  globalThis.__PA_FTS_IOS_RUNTIME_RECEIPT__ = receipt;
  return receipt;
}

globalThis[BUNDLE_API_NAME] = Object.freeze({
  schemaVersion: RECEIPT_SCHEMA_VERSION,
  receiptType: RECEIPT_TYPE,
  bundleVaultPath: DEFAULT_BUNDLE_VAULT_PATH,
  sourceIdentity: SOURCE_IDENTITY,
  sessionChallenge: SESSION_CHALLENGE,
  externalAssurance: "optional-external-session-attestation",
  capture,
});
`;
  const source = await buildBrowserSource(entry, "fts-ios-runtime-bundle-entry.ts");
  return {
    source,
    sha256: sha256(source),
    bundleVaultPath,
    sourceIdentity,
  };
}
