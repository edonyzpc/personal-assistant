#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const fixtureRoot = path.join(repositoryRoot, "__fixtures__/retrieval-smoke");
const fixtureVaultRoot = path.join(fixtureRoot, "vault");
const manifestSource = path.join(fixtureRoot, "manifest.json");
const manifestContent = await readFile(manifestSource);
const manifest = JSON.parse(manifestContent.toString("utf8"));

const args = process.argv.slice(2);
const write = args.includes("--write");
const json = args.includes("--json");
const vaultArgument = readOption(args, "--vault") ?? "test";
const vaultRoot = path.resolve(repositoryRoot, vaultArgument);

const sourceFiles = await listFiles(fixtureVaultRoot);
const operations = [];
for (const sourcePath of sourceFiles) {
  const relativePath = path.relative(fixtureVaultRoot, sourcePath);
  const targetPath = safeTarget(vaultRoot, relativePath);
  const content = await readFile(sourcePath);
  let existing = null;
  try {
    existing = await readFile(targetPath);
  } catch {
    // Missing is expected on first preparation.
  }
  operations.push({
    kind: existing?.equals(content) ? "unchanged" : existing ? "update" : "create",
    relativePath,
    targetPath,
    content,
    sha256: sha256(content),
  });
}

const expectedFixturePaths = Object.keys(manifest.files || {}).sort();
const actualFixturePaths = operations.map((entry) => entry.relativePath).sort();
if (JSON.stringify(expectedFixturePaths) !== JSON.stringify(actualFixturePaths)) {
  throw new Error("Retrieval smoke manifest paths do not match the source fixture pack.");
}
for (const operation of operations) {
  if (manifest.files[operation.relativePath] !== operation.sha256) {
    throw new Error(`Retrieval smoke fixture digest mismatch: ${operation.relativePath}`);
  }
}

const manifestTarget = safeTarget(vaultRoot, "retrieval-optimization-smoke-manifest.json");
let existingManifest = null;
try {
  existingManifest = await readFile(manifestTarget);
} catch {
  // Missing is expected on first preparation.
}
operations.push({
  kind: existingManifest?.equals(manifestContent) ? "unchanged" : existingManifest ? "update" : "create",
  relativePath: "retrieval-optimization-smoke-manifest.json",
  targetPath: manifestTarget,
  content: manifestContent,
  sha256: sha256(manifestContent),
});

const runnerSource = path.join(repositoryRoot, "scripts/retrieval-optimization-smoke-runner.js");
const runnerTarget = safeTarget(vaultRoot, "retrieval-optimization-smoke-runner.js");
const runnerContent = await readFile(runnerSource);
let existingRunner = null;
try {
  existingRunner = await readFile(runnerTarget);
} catch {
  // Missing is expected on first preparation.
}
operations.push({
  kind: existingRunner?.equals(runnerContent) ? "unchanged" : existingRunner ? "update" : "create",
  relativePath: "retrieval-optimization-smoke-runner.js",
  targetPath: runnerTarget,
  content: runnerContent,
  sha256: sha256(runnerContent),
});

if (write) {
  for (const operation of operations) {
    if (operation.kind === "unchanged") continue;
    await mkdir(path.dirname(operation.targetPath), { recursive: true });
    await writeFile(operation.targetPath, operation.content);
  }
  for (const [relativePath, timestamp] of Object.entries(manifest.temporalFixtureMtimes || {})) {
    const fixturePath = safeTarget(vaultRoot, relativePath);
    const fixtureTime = new Date(timestamp);
    if (!Number.isFinite(fixtureTime.getTime())) {
      throw new Error(`Invalid temporal fixture mtime: ${relativePath}`);
    }
    await utimes(fixturePath, fixtureTime, fixtureTime);
  }
}

const report = {
  fixtureVersion: manifest.fixtureVersion,
  mode: write ? "write" : "dry-run",
  vaultRoot,
  totals: {
    create: operations.filter((entry) => entry.kind === "create").length,
    update: operations.filter((entry) => entry.kind === "update").length,
    unchanged: operations.filter((entry) => entry.kind === "unchanged").length,
  },
  files: operations.map(({ kind, relativePath, sha256: digest }) => ({
    kind,
    path: relativePath,
    sha256: digest,
  })),
  next: write
    ? [
      "Prepare or update Memory through the normal confirmation flow.",
      "Enable the four retrieval optimization flags only in the isolated test vault, then reload Obsidian.",
      "Run: eval(await app.vault.adapter.read(\"retrieval-optimization-smoke-runner.js\"))",
      "Run the frozen local-notes Chat recovery prompt as the first retrieval; after the exact Chat turn fully completes, call recordRecoveryCase() with no arguments before freezing the device plan. Keep that live Chat view open: the runner binds canonical Selected Memory/source records/assistant allowlist, never DOM or visible reference chips.",
      "Run Pagelet 0/1/2 through the real current-route UI flow before freezing the device plan, then immediately call recordPageletCase(id) with no insight or source arguments; the runner binds the accepted controller/candidate/receipt snapshot. Keeping Pagelet pre-freeze prevents Pagelet diagnostics from entering post-freeze Chat staging.",
      "Freeze the reviewed device thresholds and reranker gate before any ranking or device evidence; do not start the performance envelope yet.",
      "Run the structured explicit 2026-01-01..2026-12-31 temporal retry prompt in the post-freeze qualitative staging session, keep that live completed Chat turn open, and call recordTemporalRetryCase() with no source-path arguments; both attempts and cumulative projection must report temporalFilterApplied=1 and temporalViolationCount=0.",
      "Run all six rankingChecklist prompts exactly after the plan freeze and before the performance envelope; keep each exact live completed Chat turn open and call recordRankingCase(id) with no source-path arguments immediately after its complete search_memory episode. Bare error-code/Japanese routingChecklist prompts are non-gating observations.",
      "Before startRuntimeEnvelope(), qualify the frozen performance workload in order. Open a fresh Chat for the exact standard-v1 prompt, wait for the live turn to complete, and call await paRetrievalSmoke.recordPerformanceQualification(\"standard\"); repeat in another fresh Chat for retry-v1 with \"retry\". Both runtime qualifications must pass; the static fixture shape does not establish live reranker order.",
      "Follow the frozen performance stages exactly: 23 standard episodes, retry batch 1 with 12 episodes, retry batch 2 with 11 episodes, then one cancellation probe. Use startRuntimeEnvelope(), beginRetryPerformance(), continueRetryPerformance(), stopRuntimeEnvelope(), and beginCancellationProbe() only at the prescribed boundaries.",
      "For every paRetrievalSmoke.nextPerformanceWorkload item, open a new empty Chat, submit its exact manifest prompt, perform the prescribed completion or cancellation interaction, then immediately call await paRetrievalSmoke.recordPerformanceEpisode() with no prompt, run ID, source, or workload arguments. Never reuse Chat history between episodes.",
    ]
    : ["Re-run with --write to copy only the isolated fixture files; no existing files are deleted."],
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[retrieval-smoke] ${report.mode}: ${manifest.fixtureVersion}`);
  console.log(`[retrieval-smoke] vault: ${vaultRoot}`);
  console.log(`[retrieval-smoke] create=${report.totals.create} update=${report.totals.update} unchanged=${report.totals.unchanged}`);
  for (const next of report.next) console.log(`[retrieval-smoke] ${next}`);
}

function readOption(argv, name) {
  const inline = argv.find((entry) => entry.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function safeTarget(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (target !== path.resolve(root) && !target.startsWith(rootPrefix)) {
    throw new Error(`Refusing fixture path outside target vault: ${relativePath}`);
  }
  return target;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
