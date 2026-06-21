import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const packages = lock.packages ?? {};
const rootPackage = packages[""];

if (!rootPackage) {
  throw new Error("package-lock.json is missing the root package entry.");
}

function mitLicense(copyrightLine) {
  return `MIT License

${copyrightLine}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}

const externalRuntimeNoticeSources = new Map([
  [
    "node_modules/@cfworker/json-schema",
    {
      source: "https://github.com/cfworker/cfworker/blob/main/LICENSE.md",
      text: mitLicense("Copyright (c) 2020 Jeremy Danyow"),
    },
  ],
  [
    "node_modules/js-tiktoken",
    {
      source: "https://github.com/dqbd/tiktoken/blob/main/LICENSE",
      text: mitLicense("Copyright (c) 2022 OpenAI, Shantanu Jain"),
    },
  ],
  [
    "node_modules/langsmith",
    {
      source: "https://github.com/langchain-ai/langsmith-sdk/blob/main/LICENSE",
      text: mitLicense("Copyright (c) 2023 LangChain"),
    },
  ],
  [
    "node_modules/@sqlite.org/sqlite-wasm",
    {
      source: "https://www.apache.org/licenses/LICENSE-2.0.txt",
      preface: [
        "The npm package README states the package license as Apache 2.0 and",
        "acknowledges that it wraps SQLite Wasm as an ES module.",
        "The underlying SQLite deliverable code and documentation are public",
        "domain according to <https://sqlite.org/copyright.html>.",
      ].join("\n"),
      text: readFileSync("node_modules/openai/LICENSE", "utf8").trim(),
    },
  ],
]);

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

    const packageJson = JSON.parse(readFileSync(`${packagePath}/package.json`, "utf8"));
    const packageName = packageJson.name ?? packagePath.split("node_modules/").pop();
    inventory.push({
      name: packageName,
      version: packageEntry.version ?? packageJson.version ?? "",
      license: packageEntry.license ?? packageJson.license ?? "",
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

  if (missing.length > 0) {
    throw new Error(`Could not resolve runtime dependencies:\n${missing.join("\n")}`);
  }

  inventory.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return inventory;
}

function collectRuntimeNoticeFiles(packagePath) {
  return readdirSync(packagePath)
    .filter((fileName) => /^(license|licence|notice|copying|copyright)$/i.test(fileName)
      || /^(license|licence|notice|copying|copyright)\./i.test(fileName))
    .sort((a, b) => a.localeCompare(b));
}

function runtimeInventoryMarkdown(inventory) {
  return [
    "## Runtime Dependency Inventory",
    "",
    "| Package | Version | License | Lockfile path |",
    "| --- | --- | --- | --- |",
    ...inventory.map((entry) => `| \`${entry.name}\` | \`${entry.version}\` | \`${entry.license}\` | \`${entry.path}\` |`),
    "",
    "If a runtime dependency lacks a lockfile license field, the release is blocked",
    "until the license is confirmed and this notice is updated.",
    "",
  ].join("\n");
}

function runtimeLicenseNoticeMarkdown(inventory) {
  const sections = [
    "## Runtime License Notices",
    "",
    "This appendix preserves the license or notice text available from the",
    "runtime production dependencies distributed through the plugin bundle.",
    "For dependencies whose npm package does not include a local license file,",
    "an external source is recorded explicitly below.",
    "",
  ];

  for (const entry of inventory) {
    sections.push(`### ${entry.name}@${entry.version}`, "");
    sections.push(`- License: \`${entry.license}\``);
    sections.push(`- Lockfile path: \`${entry.path}\``);

    const noticeFiles = collectRuntimeNoticeFiles(entry.path);
    const externalNotice = externalRuntimeNoticeSources.get(entry.path);
    if (noticeFiles.length > 0) {
      for (const noticeFile of noticeFiles) {
        const sourcePath = `${entry.path}/${noticeFile}`;
        sections.push(`- Source file: \`${sourcePath}\``, "");
        sections.push("~~~text");
        sections.push(readFileSync(sourcePath, "utf8").trim());
        sections.push("~~~", "");
      }
    }
    if (externalNotice) {
      sections.push(`- External notice source: <${externalNotice.source}>`);
      if (externalNotice.preface) {
        sections.push("", externalNotice.preface);
      }
      sections.push("", "~~~text");
      sections.push(externalNotice.text);
      sections.push("~~~", "");
    }
    if (noticeFiles.length === 0 && !externalNotice) {
      sections.push("", "No local license or notice file was found in the npm package.", "");
    }
  }

  sections.push(
    "Third-party package names, trademarks, and service marks belong to their",
    "respective owners.",
    "",
  );
  return sections.join("\n");
}

const current = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
const inventoryStart = current.indexOf("## Runtime Dependency Inventory");
if (inventoryStart < 0) {
  throw new Error("THIRD_PARTY_NOTICES.md is missing the runtime inventory section.");
}

const inventory = collectRuntimePackages();
const prefix = current.slice(0, inventoryStart).trimEnd();
const next = [
  prefix,
  "",
  runtimeInventoryMarkdown(inventory),
  runtimeLicenseNoticeMarkdown(inventory),
].join("\n");

writeFileSync("THIRD_PARTY_NOTICES.md", next);
console.log(`Generated THIRD_PARTY_NOTICES.md for ${inventory.length} runtime packages.`);
