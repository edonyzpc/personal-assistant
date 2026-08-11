import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import {
  FTS_RUNTIME_RECEIPT_SCHEMA_VERSION,
  FTS_RUNTIME_RECEIPT_TYPE,
  createEmbeddedArtifact,
  createProductionPluginArtifact,
  inspectPlatformReceipt,
  sha256,
} from "./lib/fts-runtime-receipt.mjs";
import { buildFtsRuntimeProfileCanarySource } from "./lib/fts-runtime-profile-bundle.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CANARY_PATH = resolve(SCRIPT_DIRECTORY, "fts-runtime-canary.cjs");
const PRODUCTION_PLUGIN_PATH = resolve(SCRIPT_DIRECTORY, "..", "dist", "main.js");
const DEFAULT_VSCODE_PATH = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const DEFAULT_OBSIDIAN_APP_PATH = "/Applications/Obsidian.app";

function parseArguments(argv) {
  const options = { format: "markdown", cdp: null };
  for (const argument of argv) {
    if (argument === "--json" || argument === "--format=json") options.format = "json";
    else if (argument === "--format=markdown") options.format = "markdown";
    else if (argument.startsWith("--cdp=")) options.cdp = argument.slice("--cdp=".length).replace(/\/$/u, "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findExecutableOnPath(names) {
  const searchDirectories = String(process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const name of names) {
    for (const directory of searchDirectories) {
      const candidate = join(directory, name);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

async function resolveOptionalExecutable(environmentKey, defaults, pathNames = []) {
  const configured = process.env[environmentKey]?.trim();
  const candidates = [configured, ...defaults].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return findExecutableOnPath(pathNames);
}

function fingerprint(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function runCommand(label, command, args, environment) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: environment,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return {
      label,
      available: false,
      error: String(result.error ?? result.stderr ?? `status ${result.status}`),
    };
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const parsed = JSON.parse(lines.at(-1));
  return { label, available: true, ...parsed };
}

function readPlistValue(path, key) {
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function readObsidianStaticIdentity(appPath) {
  if (process.platform !== "darwin") {
    return { available: false, appPath: null, reason: "macos_static_identity_not_applicable" };
  }
  const infoPath = join(appPath, "Contents", "Info.plist");
  const electronInfoPath = join(appPath, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Resources", "Info.plist");
  const icuPath = join(appPath, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Resources", "icudtl.dat");
  if (!(await exists(infoPath)) || !(await exists(icuPath))) {
    return { available: false, appPath, reason: "obsidian_not_found" };
  }
  const icu = await readFile(icuPath);
  const markers = ["icudt74l", "icudt75l", "icudt76l", "icudt77l", "icudt78l"]
    .filter((marker) => icu.includes(Buffer.from(marker, "ascii")));
  return {
    available: true,
    appPath,
    shellVersion: readPlistValue(infoPath, "CFBundleShortVersionString"),
    shellVersionSource: "CFBundleShortVersionString",
    electronVersion: readPlistValue(electronInfoPath, "CFBundleVersion"),
    icuDataBytes: icu.byteLength,
    icuDataSha256: createHash("sha256").update(icu).digest("hex"),
    icuDataMarkers: markers,
  };
}

function evaluateProfileCanaryInNode(source) {
  const context = { Intl };
  context.globalThis = context;
  runInNewContext(source, context, { timeout: 3000 });
  const artifact = context.__PA_FTS_PROFILE_CANARY__;
  if (!artifact) throw new Error("Reference profile canary returned no artifact.");
  return JSON.parse(JSON.stringify(artifact));
}

function connectWebSocket(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      rejectPromise(new Error(`CDP WebSocket timed out: ${url}`));
    }, 3000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolvePromise(socket);
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectPromise(new Error(`CDP WebSocket failed: ${url}`));
    }, { once: true });
  });
}

function isObsidianPageTarget(target) {
  return target.type === "page"
    && target.webSocketDebuggerUrl
    && (target.url?.startsWith("app://obsidian.md/") || target.url === "app://obsidian.md");
}

function isObsidianAppUrl(value) {
  return value === "app://obsidian.md" || value?.startsWith("app://obsidian.md/");
}

function icuMajorFromStatic(identity) {
  const marker = identity.icuDataMarkers?.find((item) => /^icudt\d+l$/u.test(item));
  return marker?.match(/^icudt(\d+)l$/u)?.[1] ?? null;
}

export function inspectCdpRuntimeIdentity(runtime, expectedIdentity) {
  const expectedIcuMajor = expectedIdentity?.available ? icuMajorFromStatic(expectedIdentity) : null;
  const exactRendererIdentity = runtime?.host === "electron-renderer"
    && runtime?.processType === "renderer"
    && runtime?.browser?.hasDocument === true
    && isObsidianAppUrl(runtime?.browser?.locationHref)
    && typeof runtime?.obsidianAppVersion === "string"
    && runtime.obsidianAppVersion.length > 0
    && runtime?.obsidianVersionSource === "obsidian.apiVersion"
    && typeof runtime?.obsidianShellVersion === "string"
    && runtime.obsidianShellVersion.length > 0
    && runtime?.obsidianShellVersionSource === "navigator.userAgent:obsidian/x"
    && typeof runtime?.versions?.electron === "string"
    && typeof runtime?.versions?.icu === "string"
    && typeof runtime?.processPlatform === "string"
    && typeof runtime?.processArch === "string";
  const staticIdentityMatches = !expectedIdentity?.available || (
    runtime?.obsidianShellVersion === expectedIdentity.shellVersion
    && runtime?.versions?.electron === expectedIdentity.electronVersion
    && (!expectedIcuMajor || runtime?.versions?.icu?.split(".")[0] === expectedIcuMajor)
  );
  return {
    exactRendererIdentity,
    staticIdentityMatches,
    identityVerified: exactRendererIdentity && staticIdentityMatches,
  };
}

async function evaluateCdp(endpoint, source, profileSource, expectedIdentity) {
  let targets;
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      targets = await fetch(`${endpoint}/json/list`, {
        signal: AbortSignal.timeout(1500),
      }).then((response) => {
        if (!response.ok) throw new Error(`CDP target list failed: HTTP ${response.status}`);
        return response.json();
      });
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  if (!targets) throw lastError ?? new Error("CDP target list unavailable.");
  const target = targets.find(isObsidianPageTarget);
  if (!target) throw new Error("CDP has no verified app://obsidian.md page target.");
  const socket = await connectWebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolveCall, reject: rejectCall } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectCall(new Error(JSON.stringify(message.error)));
    else resolveCall(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const id = nextId;
    nextId += 1;
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectCall(new Error(`CDP ${method} timed out.`));
    }, 3000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolveCall(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        rejectCall(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener("close", () => {
    for (const { reject } of pending.values()) reject(new Error("CDP socket closed."));
    pending.clear();
  }, { once: true });

  try {
    await call("Runtime.enable");
    const evaluation = await call("Runtime.evaluate", {
      expression: `(async () => {
delete globalThis.__PA_FTS_RUNTIME_CANARY__;
delete globalThis.__PA_FTS_PROFILE_CANARY__;
const paPlugin = globalThis.app?.plugins?.plugins?.["personal-assistant"] ?? null;
const paRuntimeIdentity = paPlugin?.getObsidianRuntimeIdentity?.() ?? null;
let paLoadedBuildIdentity = null;
try {
  paLoadedBuildIdentity = await paPlugin?.getLoadedPluginBuildIdentity?.() ?? null;
} catch {}
const paConfigDir = typeof globalThis.app?.vault?.configDir === "string"
  && globalThis.app.vault.configDir.trim()
  ? globalThis.app.vault.configDir.trim()
  : ".obsidian";
const paPluginArtifactPath = \`\${paConfigDir}/plugins/personal-assistant/main.js\`;
let paPluginArtifact = null;
try {
  const paPluginArtifactSource = await globalThis.app?.vault?.adapter?.read?.(paPluginArtifactPath);
  if (typeof paPluginArtifactSource === "string") {
    const paPluginArtifactBytes = new TextEncoder().encode(paPluginArtifactSource);
    const paPluginArtifactDigest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      paPluginArtifactBytes,
    );
    paPluginArtifact = {
      path: paPluginArtifactPath,
      sha256: [...new Uint8Array(paPluginArtifactDigest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      byteLength: paPluginArtifactBytes.byteLength,
    };
  }
} catch {}
${source}
${profileSource}
const runtimeCanary = globalThis.__PA_FTS_RUNTIME_CANARY__;
if (runtimeCanary?.runtime && paRuntimeIdentity?.loadedAppVersionSource === "obsidian.apiVersion") {
  runtimeCanary.runtime.obsidianAppVersion = paRuntimeIdentity.loadedAppVersion;
  runtimeCanary.runtime.obsidianVersionSource = paRuntimeIdentity.loadedAppVersionSource;
}
const shellVersion = globalThis.navigator?.userAgent
  ?.match(/(?:^|[\\s;(])obsidian\\/([0-9A-Za-z][0-9A-Za-z._+-]*)/iu)?.[1] ?? null;
if (runtimeCanary?.runtime) {
  runtimeCanary.runtime.obsidianShellVersion = shellVersion;
  runtimeCanary.runtime.obsidianShellVersionSource = shellVersion
    ? "navigator.userAgent:obsidian/x"
    : null;
}
return {
  canary: runtimeCanary,
  profile: globalThis.__PA_FTS_PROFILE_CANARY__,
  pluginIdentity: {
    id: paPlugin?.manifest?.id ?? null,
    version: paPlugin?.manifest?.version ?? null,
    artifact: paPluginArtifact,
    loadedBuild: paLoadedBuildIdentity,
  },
};
})()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluation.exceptionDetails) throw new Error(JSON.stringify(evaluation.exceptionDetails));
    const value = evaluation.result?.value;
    if (!value?.canary?.fingerprintPayload || !value?.profile) {
      throw new Error("CDP canary returned incomplete runtime/profile artifacts.");
    }
    const runtime = value.canary.runtime;
    const { staticIdentityMatches, identityVerified } = inspectCdpRuntimeIdentity(
      runtime,
      expectedIdentity,
    );
    if (!identityVerified) {
      throw new Error(`CDP target is not an exact Obsidian renderer: ${JSON.stringify(runtime)}`);
    }
    return {
      label: "obsidian-renderer",
      available: true,
      ...value.canary,
      profile: value.profile,
      fingerprint: fingerprint(value.canary.fingerprintPayload),
      graphemeFingerprint: fingerprint(value.canary.fingerprintPayload.graphemes),
      wordFingerprint: fingerprint(value.canary.fingerprintPayload.words),
      identityVerified,
      staticIdentityMatches: expectedIdentity?.available ? staticIdentityMatches : null,
      target: { title: target.title, url: target.url },
      pluginIdentity: value.pluginIdentity ?? null,
    };
  } finally {
    socket.close();
  }
}

function renderMarkdown(report) {
  const lines = [
    "# B-125 Desktop Segmentation Runtime Probe",
    "",
    `Status: **${report.status}**`,
    `Platform: ${report.platform ? `${report.platform.os}/${report.platform.arch}` : "not verified"}`,
    "",
    "| Runtime | Available | Fingerprint | Host details |",
    "| --- | --- | --- | --- |",
  ];
  for (const runtime of report.runtimes) {
    const versions = runtime.runtime?.versions;
    const details = versions
      ? `Node ${versions.node ?? "—"}; Electron ${versions.electron ?? "—"}; ICU ${versions.icu ?? "—"}; Unicode ${versions.unicode ?? "—"}`
      : runtime.runtime?.userAgent ?? runtime.error ?? "—";
    lines.push(`| ${runtime.label} | ${runtime.available ? "yes" : "no"} | ${runtime.fingerprint ?? "—"} | ${details.replaceAll("|", "\\|")} |`);
  }
  lines.push(
    "",
    `Token fingerprints equal across executed runtimes: ${report.comparison.allExecutedEqual ? "YES" : "NO"}`,
    `Exact Obsidian renderer captured: ${report.comparison.exactObsidianCaptured ? "YES" : "NO"}`,
    `Grapheme fingerprints equal: ${report.comparison.allGraphemeEqual ? "YES" : "NO"}`,
    `Word fingerprints equal: ${report.comparison.allWordEqual ? "YES" : "NO"}`,
    "",
    "## Installed Obsidian identity",
    "",
    `- Loaded app: ${report.exactRenderer?.runtime?.obsidianAppVersion ?? "unavailable"} (${report.exactRenderer?.runtime?.obsidianVersionSource ?? "source unavailable"})`,
    `- Shell/installer: ${report.obsidianStatic.shellVersion ?? report.exactRenderer?.runtime?.obsidianShellVersion ?? "unavailable"}`,
    `- Electron: ${report.obsidianStatic.electronVersion ?? "unavailable"}`,
    `- ICU data SHA-256: ${report.obsidianStatic.icuDataSha256 ?? "unavailable"}`,
    `- ICU data marker: ${report.obsidianStatic.icuDataMarkers?.join(", ") || "not detected"}`,
    `- Production plugin SHA-256: ${report.artifacts.productionPlugin?.sha256 ?? "unavailable"}`,
    "",
    `- Verified CDP target: ${report.comparison.obsidianTarget?.title ?? "not captured"} / ${report.comparison.obsidianTarget?.url ?? "not captured"}`,
    `- Blockers: ${report.evaluation.blockers.join(", ") || "none"}`,
    `- Failures: ${report.evaluation.failures.join(", ") || "none"}`,
    `- Diagnostics: ${report.evaluation.diagnostics.join(", ") || "none"}`,
    "",
    "Matching fingerprints are evidence only for the frozen canaries. The selected lexical profile version remains the migration key; grapheme or word canary drift is a rebuild signal only for a profile that depends on that segmentation class.",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const canarySource = await readFile(CANARY_PATH, "utf8");
  const profileCanarySource = await buildFtsRuntimeProfileCanarySource();
  const productionPluginArtifact = await readFile(PRODUCTION_PLUGIN_PATH)
    .then((source) => createProductionPluginArtifact(source))
    .catch(() => null);
  const referenceProfile = evaluateProfileCanaryInNode(profileCanarySource);
  const obsidianAppPath = resolve(process.env.PA_FTS_OBSIDIAN_APP_PATH?.trim() || DEFAULT_OBSIDIAN_APP_PATH);
  const obsidianStatic = await readObsidianStaticIdentity(obsidianAppPath);
  const node20Path = await resolveOptionalExecutable("PA_FTS_NODE20_PATH", [], ["node20", "node-20"]);
  const vscodePath = await resolveOptionalExecutable(
    "PA_FTS_VSCODE_PATH",
    [DEFAULT_VSCODE_PATH],
    [],
  );
  const runtimes = [
    runCommand("node-current", process.execPath, [CANARY_PATH], process.env),
  ];
  if (node20Path) {
    runtimes.push(runCommand("node-20", node20Path, [CANARY_PATH], process.env));
  } else {
    runtimes.push({
      label: "node-20",
      available: false,
      error: "not found; set PA_FTS_NODE20_PATH or provide node20/node-20 on PATH",
    });
  }
  if (vscodePath) {
    runtimes.push(runCommand(
      "vscode-electron",
      vscodePath,
      [CANARY_PATH],
      { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    ));
  } else {
    runtimes.push({
      label: "vscode-electron",
      available: false,
      error: "not found; set PA_FTS_VSCODE_PATH",
    });
  }
  if (options.cdp) {
    try {
      runtimes.push(await evaluateCdp(
        options.cdp,
        canarySource,
        profileCanarySource,
        obsidianStatic,
      ));
    } catch (error) {
      runtimes.push({
        label: "obsidian-renderer",
        available: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const executed = runtimes.filter((item) => item.available && item.fingerprint);
  const referenceRuntime = runtimes.find((item) => item.label === "node-current") ?? null;
  const exactRenderer = runtimes.find((item) => item.label === "obsidian-renderer" && item.identityVerified) ?? null;
  const report = {
    schemaVersion: FTS_RUNTIME_RECEIPT_SCHEMA_VERSION,
    receiptType: FTS_RUNTIME_RECEIPT_TYPE,
    status: null,
    generatedAt: new Date().toISOString(),
    canary: "scripts/fts-runtime-canary.cjs",
    platform: exactRenderer ? {
      os: exactRenderer.runtime.processPlatform,
      arch: exactRenderer.runtime.processArch,
    } : null,
    exactRenderer,
    referenceRuntime,
    artifacts: {
      productionPlugin: productionPluginArtifact,
      runtimeCanary: createEmbeddedArtifact(
        "runtime-canary",
        "scripts/fts-runtime-canary.cjs",
        {
          schemaVersion: 2,
          renderer: exactRenderer?.fingerprintPayload ?? null,
          reference: referenceRuntime?.fingerprintPayload ?? null,
        },
        sha256(canarySource),
      ),
      profileCanary: createEmbeddedArtifact(
        "profile-canary",
        "scripts/fts-runtime-profile-canary.ts",
        {
          schemaVersion: 1,
          renderer: exactRenderer?.profile ?? null,
          reference: referenceProfile,
        },
        sha256(profileCanarySource),
      ),
    },
    runtimes,
    obsidianStatic,
    comparison: {
      allExecutedEqual: new Set(executed.map((item) => item.fingerprint)).size <= 1,
      allGraphemeEqual: new Set(executed.map((item) => item.graphemeFingerprint)).size <= 1,
      allWordEqual: new Set(executed.map((item) => item.wordFingerprint)).size <= 1,
      exactObsidianCaptured: executed.some((item) => item.label === "obsidian-renderer" && item.identityVerified),
      obsidianTarget: executed.find((item) => item.label === "obsidian-renderer" && item.identityVerified)?.target ?? null,
      fingerprints: [...new Set(executed.map((item) => item.fingerprint))],
    },
  };
  const evaluation = inspectPlatformReceipt(report, {
    allowMissingStatus: true,
    expectedProductionPluginSha256: productionPluginArtifact?.sha256,
  });
  report.status = evaluation.status;
  report.evaluation = evaluation;
  process.stdout.write(options.format === "json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderMarkdown(report));
  if (report.status !== "PASS") process.exitCode = report.status === "FAIL" ? 1 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
