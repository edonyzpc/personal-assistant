import { existsSync, readFileSync, readdirSync } from "node:fs";
import process from "node:process";

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
