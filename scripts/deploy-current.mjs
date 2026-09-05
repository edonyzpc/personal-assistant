import { Buffer } from "node:buffer";
import console from "node:console";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  captureFtsIosProductionBuildInputSnapshot,
  readFtsIosPluginArtifactEvidence,
} from "./lib/fts-ios-runtime-artifact.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUXILIARY_ASSETS = ["styles.css", "manifest.json", "manifest-beta.json"];
const OBSOLETE_ASSETS = ["vss-sqlite-worker.js", "sqlite3.wasm"];

async function physicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return resolve(await physicalPath(dirname(path)), relative(dirname(path), path));
  }
}

function isWithin(path, directory) {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

// This checks build identity, not whether lint, tests, or a smoke run passed.
export async function deployCurrent({ repositoryRoot = REPOSITORY_ROOT, destination } = {}) {
  if (typeof destination !== "string" || !destination.trim()) {
    throw new Error("A plugin destination directory is required.");
  }
  const root = await realpath(resolve(repositoryRoot));
  const target = await physicalPath(resolve(destination));
  if (target === root || ["dist", "src", "skills", "licenses"].some(
    (directory) => isWithin(target, resolve(root, directory)),
  )) {
    throw new Error("The deployment destination must not overwrite repository production inputs or dist.");
  }

  const [snapshot, auxiliaryContents] = await Promise.all([
    captureFtsIosProductionBuildInputSnapshot(root),
    Promise.all(AUXILIARY_ASSETS.map((name) => readFile(resolve(root, "dist", name)))),
  ]);
  const evidence = await readFtsIosPluginArtifactEvidence(resolve(root, "dist/main.js"), {
    repositoryRoot: root,
    requireCurrentRepositoryArtifact: true,
    requireLocalProductionBuildProvenance: true,
    buildInputSnapshot: snapshot,
  });
  if (evidence.blockers.length) {
    throw new Error(`Production build cannot be reused: ${evidence.blockers.join(", ")}. Run npm run build.`);
  }
  const assets = new Map([["main.js", Buffer.from(evidence.source, "utf8")]]);
  for (const [index, name] of AUXILIARY_ASSETS.entries()) {
    const source = snapshot.records.find((record) => record.path === name);
    if (!source || !source.contents.equals(auxiliaryContents[index])) {
      throw new Error(`dist/${name} does not match the production input. Run npm run build.`);
    }
    assets.set(name, auxiliaryContents[index]);
  }

  // Validate the full frozen asset set before creating, copying, or cleaning anything.
  for (const name of [...assets.keys(), ...OBSOLETE_ASSETS]) {
    const entry = await lstat(resolve(target, name)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (entry && (!entry.isFile() || entry.isSymbolicLink())) {
      throw new Error(`Deployment asset must be a regular file: ${resolve(target, name)}`);
    }
  }
  await mkdir(target, { recursive: true });
  for (const [name, contents] of assets) {
    await writeFile(resolve(target, name), contents);
  }
  for (const name of OBSOLETE_ASSETS) {
    await rm(resolve(target, name), { force: true });
  }
  return { destination: target, assets: [...assets.keys()], artifactSha256: evidence.sha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/deploy-current.mjs <plugin-directory>");
    const result = await deployCurrent({ destination: process.argv[2] });
    console.log(`Copied current production assets to ${result.destination}. Build identity verified; no tests were run.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
