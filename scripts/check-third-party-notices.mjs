import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { parseShareCardFontCodePoints } from "./share-card-font-coverage.mjs";
import { shareCardFontManifest } from "./share-card-font-manifest.mjs";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
const bundledSkillsSource = readFileSync("src/ai-services/bundled-skills.ts", "utf8");
const packages = lock.packages ?? {};
const rootPackage = packages[""];

const externalRuntimeNoticeSources = new Map([
  [
    "node_modules/@cfworker/json-schema",
    {
      source: "https://github.com/cfworker/cfworker/blob/main/LICENSE.md",
      requiredText: "Copyright (c) 2020 Jeremy Danyow",
    },
  ],
  [
    "node_modules/js-tiktoken",
    {
      source: "https://github.com/dqbd/tiktoken/blob/main/LICENSE",
      requiredText: "Copyright (c) 2022 OpenAI, Shantanu Jain",
    },
  ],
  [
    "node_modules/langsmith",
    {
      source: "https://github.com/langchain-ai/langsmith-sdk/blob/main/LICENSE",
      requiredText: "Copyright (c) 2023 LangChain",
    },
  ],
  [
    "node_modules/@sqlite.org/sqlite-wasm",
    {
      source: "https://www.apache.org/licenses/LICENSE-2.0.txt",
      requiredText: "Apache License\n                           Version 2.0, January 2004",
    },
  ],
]);

const bundledResourceNoticeByPath = new Map([
  [
    shareCardFontManifest.subset.outputPath,
    {
      license: "OFL-1.1",
      provenance: shareCardFontManifest.noticeProvenance,
    },
  ],
  [
    "skills/obsidian-markdown/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored read-only skill resource; kepano/obsidian-skills was reviewed as reference material, with no upstream text intentionally copied.",
    },
  ],
  [
    "skills/obsidian-bases/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored read-only skill resource; kepano/obsidian-skills was reviewed as reference material, with no upstream text intentionally copied.",
    },
  ],
  [
    "skills/json-canvas/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored read-only skill resource; kepano/obsidian-skills was reviewed as reference material, with no upstream text intentionally copied.",
    },
  ],
  [
    "skills/pa-frontmatter-audit/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored bundled skill resource.",
    },
  ],
  [
    "skills/pa-callout-cleanup/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored bundled skill resource.",
    },
  ],
  [
    "skills/pa-vault-link-health/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored bundled skill resource.",
    },
  ],
  [
    "skills/pa-plugin-config-review/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored bundled skill resource.",
    },
  ],
  [
    "skills/obsidian-dataview/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored compatibility guidance; no third-party text intentionally copied.",
    },
  ],
  [
    "skills/obsidian-dataview/references/dataviewjs-api.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored compatibility guidance; no third-party text intentionally copied.",
    },
  ],
  [
    "skills/obsidian-templater/SKILL.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored compatibility guidance; no third-party text intentionally copied.",
    },
  ],
  [
    "skills/obsidian-templater/references/templater-modules-api.md",
    {
      license: "AGPL-3.0-only",
      provenance: "Project-authored compatibility guidance; no third-party text intentionally copied.",
    },
  ],
]);

if (!rootPackage) {
  throw new Error("package-lock.json is missing the root package entry.");
}

function resolveDependencyPath(fromPackagePath, dependencyName) {
  let base = fromPackagePath;
  while (base) {
    const nested = `${base}/node_modules/${dependencyName}`;
    if (packages[nested]) return nested;
    const index = base.lastIndexOf("/node_modules/");
    if (index < 0) break;
    base = base.slice(0, index);
  }

  const root = `node_modules/${dependencyName}`;
  return packages[root] ? root : "";
}

function collectRuntimePackages() {
  const queue = Object.keys(rootPackage.dependencies ?? {})
    .map((dependencyName) => ({
      requestedBy: "root package",
      dependencyName,
      packagePath: resolveDependencyPath("", dependencyName),
    }));
  const seen = new Set();
  const inventory = [];
  const missing = [];

  for (let index = 0; index < queue.length; index++) {
    const { requestedBy, dependencyName, packagePath } = queue[index];
    if (!packagePath) {
      missing.push(`${dependencyName} required by ${requestedBy}`);
      continue;
    }
    if (seen.has(packagePath)) continue;
    seen.add(packagePath);

    const packageEntry = packages[packagePath];
    if (!packageEntry) {
      missing.push(packagePath);
      continue;
    }

    const packageName = packagePath.split("node_modules/").pop();
    inventory.push({
      name: packageName,
      version: packageEntry.version ?? "",
      license: packageEntry.license ?? "",
      path: packagePath,
    });

    for (const dependencyName of Object.keys(packageEntry.dependencies ?? {})) {
      const dependencyPath = resolveDependencyPath(packagePath, dependencyName);
      queue.push({
        requestedBy: packagePath,
        dependencyName,
        packagePath: dependencyPath,
      });
    }
  }

  inventory.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return { inventory, missing };
}

function collectBundledResourcePaths() {
  const resourcePaths = new Set();
  const importPattern = /from\s+"..\/..\/(skills\/[^"]+\.md)";/g;
  for (const match of bundledSkillsSource.matchAll(importPattern)) {
    resourcePaths.add(match[1]);
  }
  resourcePaths.add(shareCardFontManifest.subset.outputPath);
  return [...resourcePaths].sort();
}

function collectRuntimeNoticeFiles(packagePath) {
  let files = [];
  try {
    files = readdirSync(packagePath);
  } catch {
    return [];
  }
  return files
    .filter((fileName) => /^(license|licence|notice|copying|copyright)$/i.test(fileName)
      || /^(license|licence|notice|copying|copyright)\./i.test(fileName))
    .sort((a, b) => a.localeCompare(b));
}

function parseNoticeRows(markdown) {
  const rows = new Set();
  const duplicates = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \|$/);
    if (!match) continue;
    const [, name, version, license, path] = match;
    const key = `${name}|${version}|${license}|${path}`;
    if (rows.has(key)) {
      duplicates.push(key);
    }
    rows.add(key);
  }
  return { rows, duplicates };
}

function parseBundledResourceRows(markdown) {
  const rows = new Set();
  const duplicates = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\| `([^`]+)` \| `([^`]+)` \| ([^|]+) \|$/);
    if (!match) continue;
    const [, path, license, provenance] = match;
    const key = `${path}|${license}|${provenance.trim()}`;
    if (rows.has(key)) {
      duplicates.push(key);
    }
    rows.add(key);
  }
  return { rows, duplicates };
}

const { inventory, missing } = collectRuntimePackages();
const bundledResourcePaths = collectBundledResourcePaths();
const { rows: noticeRows, duplicates: duplicateNoticeRows } = parseNoticeRows(notices);
const { rows: bundledResourceRows, duplicates: duplicateBundledResourceRows } = parseBundledResourceRows(notices);
const errors = [];
const expectedRows = new Set();
const expectedBundledResourceRows = new Set();

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyShareCardFontResource() {
  const { upstream, subset, tools } = shareCardFontManifest;
  for (const path of [subset.outputPath, subset.coveragePath, upstream.licensePath]) {
    if (!existsSync(path)) {
      errors.push(`Share Card font provenance path is missing: ${path}`);
      return;
    }
  }
  const output = readFileSync(subset.outputPath);
  const coverage = readFileSync(subset.coveragePath);
  const license = readFileSync(upstream.licensePath);
  if (output.byteLength !== subset.outputBytes) {
    errors.push(`Share Card font byte size is stale: expected ${subset.outputBytes}, got ${output.byteLength}`);
  }
  if (sha256(output) !== subset.outputSha256) {
    errors.push("Share Card font SHA-256 does not match its manifest.");
  }
  if (sha256(coverage) !== subset.coverageSha256) {
    errors.push("Share Card font coverage SHA-256 does not match its manifest.");
  }
  if (sha256(license) !== upstream.licenseSha256) {
    errors.push("Source Han Serif license SHA-256 does not match its manifest.");
  }
  if (rootPackage.devDependencies?.["subset-font"] !== tools.subsetFont) {
    errors.push(`subset-font must be pinned exactly to ${tools.subsetFont}.`);
  }
  if (rootPackage.devDependencies?.fontkit !== tools.fontkit) {
    errors.push(`fontkit must be pinned exactly to ${tools.fontkit}.`);
  }
  for (const [packagePath, expectedVersion] of [
    ["node_modules/subset-font", tools.subsetFont],
    ["node_modules/fontverter", tools.fontverter],
    ["node_modules/fontkit", tools.fontkit],
  ]) {
    if (packages[packagePath]?.version !== expectedVersion) {
      errors.push(`${packagePath} must resolve exactly to ${expectedVersion}.`);
    }
  }
  try {
    const expectedCodePoints = parseShareCardFontCodePoints(coverage.toString("utf8"));
    if (expectedCodePoints.length !== subset.characterCount) {
      errors.push(`Share Card font coverage count is stale: expected ${subset.characterCount}, got ${expectedCodePoints.length}.`);
    }
    const font = fontkit.create(output);
    if (font.familyName !== subset.familyName) {
      errors.push(`Share Card font family is stale: expected ${subset.familyName}, got ${font.familyName}.`);
    }
    if (font.postscriptName !== subset.postscriptName) {
      errors.push(`Share Card font PostScript name is stale: expected ${subset.postscriptName}, got ${font.postscriptName}.`);
    }
    const actualCodePoints = new Set(font.characterSet);
    const allowedExtraCodePoints = subset.allowedExtraCodePoints ?? [];
    const exactExpectedCodePoints = new Set([...expectedCodePoints, ...allowedExtraCodePoints]);
    const missingCodePoints = [...exactExpectedCodePoints]
      .filter((codePoint) => !actualCodePoints.has(codePoint));
    if (missingCodePoints.length > 0) {
      const sample = missingCodePoints.slice(0, 8)
        .map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`)
        .join(", ");
      errors.push(`Share Card font is missing ${missingCodePoints.length} coverage code points: ${sample}.`);
    }
    const unexpectedCodePoints = [...actualCodePoints]
      .filter((codePoint) => !exactExpectedCodePoints.has(codePoint));
    if (unexpectedCodePoints.length > 0 || actualCodePoints.size !== subset.outputCharacterCount) {
      const sample = unexpectedCodePoints.slice(0, 8)
        .map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`)
        .join(", ");
      errors.push(`Share Card font has unexpected character coverage: ${sample || `${actualCodePoints.size} characters`}.`);
    }
    const fsType = font["OS/2"]?.fsType;
    if (!fsType || fsType.noEmbedding || fsType.noSubsetting || fsType.bitmapOnly) {
      errors.push("Share Card font metadata does not permit embedding and subsetting.");
    }
  } catch (error) {
    errors.push(`Share Card font could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const marker of [
    upstream.sourceSha256,
    subset.coverageSha256,
    subset.outputSha256,
    readFileSync(upstream.licensePath, "utf8").trim(),
  ]) {
    if (!notices.includes(marker)) {
      errors.push("THIRD_PARTY_NOTICES.md is missing Share Card font provenance or license text.");
      break;
    }
  }
}

verifyShareCardFontResource();

if (bundledResourcePaths.length === 0) {
  errors.push("Could not derive bundled skill resource paths from src/ai-services/bundled-skills.ts.");
}

for (const missingDependency of missing) {
  errors.push(`Could not resolve runtime dependency: ${missingDependency}`);
}

for (const duplicateNoticeRow of duplicateNoticeRows) {
  errors.push(`THIRD_PARTY_NOTICES.md has a duplicate runtime dependency row: ${duplicateNoticeRow}`);
}

for (const duplicateBundledResourceRow of duplicateBundledResourceRows) {
  errors.push(`THIRD_PARTY_NOTICES.md has a duplicate bundled resource row: ${duplicateBundledResourceRow}`);
}

for (const entry of inventory) {
  if (!entry.license) {
    errors.push(`Runtime dependency is missing lockfile license metadata: ${entry.path}`);
    continue;
  }
  const key = `${entry.name}|${entry.version}|${entry.license}|${entry.path}`;
  expectedRows.add(key);
  if (!noticeRows.has(key)) {
    errors.push(`THIRD_PARTY_NOTICES.md is missing or stale for: ${key}`);
  }

  const noticeHeading = `### ${entry.name}@${entry.version}`;
  if (!notices.includes(noticeHeading)) {
    errors.push(`THIRD_PARTY_NOTICES.md is missing runtime license notice appendix heading: ${noticeHeading}`);
  }

  const noticeFiles = collectRuntimeNoticeFiles(entry.path);
  const externalNotice = externalRuntimeNoticeSources.get(entry.path);
  if (noticeFiles.length === 0 && !externalNotice) {
    errors.push(`Runtime dependency has no local license/notice file and no external notice source override: ${entry.path}`);
  }
  for (const noticeFile of noticeFiles) {
    const sourceMarker = `Source file: \`${entry.path}/${noticeFile}\``;
    if (!notices.includes(sourceMarker)) {
      errors.push(`THIRD_PARTY_NOTICES.md is missing notice source marker: ${sourceMarker}`);
    }
    const noticeText = readFileSync(`${entry.path}/${noticeFile}`, "utf8").trim();
    if (noticeText && !notices.includes(noticeText)) {
      errors.push(`THIRD_PARTY_NOTICES.md is missing notice text from: ${entry.path}/${noticeFile}`);
    }
  }
  if (externalNotice) {
    const sourceMarker = `External notice source: <${externalNotice.source}>`;
    if (!notices.includes(sourceMarker)) {
      errors.push(`THIRD_PARTY_NOTICES.md is missing external notice source marker: ${sourceMarker}`);
    }
    if (!notices.includes(externalNotice.requiredText)) {
      errors.push(`THIRD_PARTY_NOTICES.md is missing required external notice text for: ${entry.path}`);
    }
  }
}

for (const path of bundledResourcePaths) {
  const entry = bundledResourceNoticeByPath.get(path);
  if (!entry) {
    errors.push(`Bundled resource is missing provenance metadata in check-third-party-notices.mjs: ${path}`);
    continue;
  }
  if (!existsSync(path)) {
    errors.push(`Bundled resource notice points to a missing file: ${path}`);
    continue;
  }
  const key = `${path}|${entry.license}|${entry.provenance}`;
  expectedBundledResourceRows.add(key);
  if (!bundledResourceRows.has(key)) {
    errors.push(`THIRD_PARTY_NOTICES.md is missing or stale for bundled resource: ${key}`);
  }
}

for (const path of bundledResourceNoticeByPath.keys()) {
  if (!bundledResourcePaths.includes(path)) {
    errors.push(`Bundled resource provenance metadata is stale: ${path}`);
  }
}

for (const noticeRow of noticeRows) {
  if (!expectedRows.has(noticeRow)) {
    errors.push(`THIRD_PARTY_NOTICES.md has a stale runtime dependency row: ${noticeRow}`);
  }
}

for (const bundledResourceRow of bundledResourceRows) {
  if (!expectedBundledResourceRows.has(bundledResourceRow)) {
    errors.push(`THIRD_PARTY_NOTICES.md has a stale bundled resource row: ${bundledResourceRow}`);
  }
}

if (!inventory.some((entry) => entry.name === "@sqlite.org/sqlite-wasm" && entry.license === "Apache-2.0")) {
  errors.push("Inlined SQLite/WASM dependency @sqlite.org/sqlite-wasm is not covered.");
}

if (errors.length > 0) {
  console.error("Third-party notices check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Third-party notices cover ${inventory.length} runtime packages and ${bundledResourcePaths.length} bundled resources.`);
