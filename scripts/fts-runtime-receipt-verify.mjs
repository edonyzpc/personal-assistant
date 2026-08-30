import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFtsRuntimeProfileCanarySource } from "./lib/fts-runtime-profile-bundle.mjs";
import {
  ALL_DESKTOP_PLATFORM_POLICY,
  B125_DESKTOP_PLATFORM_POLICY,
  sha256,
  verifyMultiPlatformReceipts,
} from "./lib/fts-runtime-receipt.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RUNTIME_CANARY_PATH = resolve(SCRIPT_DIRECTORY, "fts-runtime-canary.cjs");
const PRODUCTION_PLUGIN_PATH = resolve(SCRIPT_DIRECTORY, "..", "dist", "main.js");

function parseArguments(argv) {
  const paths = [];
  let format = "markdown";
  let platformPolicy = B125_DESKTOP_PLATFORM_POLICY;
  for (const argument of argv) {
    if (argument === "--json" || argument === "--format=json") format = "json";
    else if (argument === "--format=markdown") format = "markdown";
    else if (argument === "--platform-policy=b125-waiver") {
      platformPolicy = B125_DESKTOP_PLATFORM_POLICY;
    } else if (argument === "--platform-policy=all-desktop") {
      platformPolicy = ALL_DESKTOP_PLATFORM_POLICY;
    } else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    else paths.push(argument);
  }
  return { paths, format, platformPolicy };
}

function renderMarkdown(result) {
  return [
    "# B-125 Multi-platform Runtime Receipt Verification",
    "",
    `Status: **${result.status}**`,
    `Required platforms: ${result.platformPolicy.requiredPlatforms.join(", ")}`,
    `Excluded platforms: ${result.platformPolicy.excludedPlatforms.join(", ") || "none"}`,
    `Platform policy: ${result.platformPolicy.id}`,
    `Production plugin SHA-256: ${result.productionPluginArtifactSha256 ?? "unavailable"}`,
    `Blockers: ${result.blockers.join(", ") || "none"}`,
    `Failures: ${result.failures.join(", ") || "none"}`,
    `Diagnostics: ${result.diagnostics.join(", ") || "none"}`,
    "",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const receipts = await Promise.all(options.paths.map(async (path) => {
    const source = await readFile(path, "utf8");
    return JSON.parse(source);
  }));
  const [runtimeCanarySource, profileCanarySource, productionPluginSource] = await Promise.all([
    readFile(RUNTIME_CANARY_PATH, "utf8"),
    buildFtsRuntimeProfileCanarySource(),
    readFile(PRODUCTION_PLUGIN_PATH),
  ]);
  const result = verifyMultiPlatformReceipts(receipts, {
    platformPolicy: options.platformPolicy,
    expectedProductionPluginSha256: sha256(productionPluginSource),
    expectedSourceSha256: {
      runtimeCanary: sha256(runtimeCanarySource),
      profileCanary: sha256(profileCanarySource),
    },
  });
  process.stdout.write(options.format === "json"
    ? `${JSON.stringify(result, null, 2)}\n`
    : renderMarkdown(result));
  if (result.status !== "PASS") process.exitCode = result.status === "FAIL" ? 1 : 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
