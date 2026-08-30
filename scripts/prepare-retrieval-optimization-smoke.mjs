#!/usr/bin/env node
/* global console, process */

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
      "B-125 uses independent targeted slices. Do not start compact-proxy (33 episodes) or strict-v9 (47 episodes) unless the owner explicitly reopens B-127 performance certification.",
      "Load the cheapest current artifact: runner-only changes sync and re-evaluate this file without plugin reload; plugin asset changes require asset byte-match, then personal-assistant plugin reload and loaded-identity verification. Use one vault/App fallback only if identity proves reload failed; full App restart is reserved for startup, OPFS, complete unload, or proven reload failure.",
      "Safari Web Inspector command rule: never paste a bare top-level await from the frozen runner comments or rankingChecklist.record. Invoke every async runner operation as (async () => await globalThis.paRetrievalSmoke.<operation>())() so completion and errors remain observable without changing the bound runner bytes.",
      "Desktop current-App owns Recovery, six ranking cases, structured temporal, Pagelet 0/1/2, graph/opaque-boundary, flag lifecycle, and one source-triggered lexical upsert. Finalize each as an independent product slice; do not require one monolithic aggregate.",
      "Current iPhone setup probes: verify loaded plugin artifact/runtime/settings identity and the iOS CHAR-PHRASE normalization fingerprint. These are not product cases.",
      "Current iPhone core case 1: complete one ordinary Provider turn on the current artifact.",
      "Current iPhone core case 2: reproduce lexical-stale -> Recovery -> readiness/approval -> completed with modal cleanup and no late work. Use one graph-enabled workload and record Local/Deep/Convergence worksets, Worker timing, deadline/skip reason, raw UI/index observations, and settings cleanup.",
      "Current iPhone core case 3: prove cancel requested/observed, accepted-after-cancel=0, late discard, and one fresh indexed lookup after queue release.",
      "Conditional current iPhone case 4: run Pagelet first-use only when no independently finalized same-artifact observation exists.",
      "Stop at the first exact product failure and preserve that slice. A runner/write failure blocks only the uncommitted slice; it cannot erase another finalized product observation. Ranking, temporal, and Pagelet 0/1/2 are not repeated on iPhone.",
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
