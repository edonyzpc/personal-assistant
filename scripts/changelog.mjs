import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { EOL } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoUrl = "https://github.com/edonyzpc/personal-assistant";
const semanticVersionPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const releaseSubjectPattern = /^\[release\]\s+v?\d+\.\d+\.\d+/;
const conventionalSubjectPattern = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<message>.+)$/;
const categoryOrder = ["Features", "Fix", "Improvements", "Docs", "Tests"];
const categoryByType = new Map([
  ["feat", "Features"],
  ["fix", "Fix"],
  ["perf", "Improvements"],
  ["refactor", "Improvements"],
  ["chore", "Improvements"],
  ["build", "Improvements"],
  ["ci", "Improvements"],
  ["style", "Improvements"],
  ["docs", "Docs"],
  ["doc", "Docs"],
  ["test", "Tests"],
  ["tests", "Tests"],
]);
const scopeLabels = new Map([
  ["deps", "dependencies"],
  ["stats", "statistics"],
]);

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parseArgs(argv) {
  const options = {
    changelog: "CHANGELOG.md",
    to: "HEAD",
    write: false,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--target-version") {
      options.targetVersion = argv[++index];
    } else if (arg === "--previous-tag") {
      options.previousTag = argv[++index];
    } else if (arg === "--to") {
      options.to = argv[++index];
    } else if (arg === "--changelog") {
      options.changelog = argv[++index];
    } else if (arg === "--write") {
      options.write = true;
    } else {
      positional.push(arg);
    }
  }
  if (!options.targetVersion && positional.length > 0) {
    options.targetVersion = positional[0];
  }
  return options;
}

function semverKey(tag) {
  const match = semanticVersionPattern.exec(tag);
  if (!match) return null;
  return match.slice(1, 4).map((part) => Number.parseInt(part, 10));
}

function compareSemverKey(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function tagExists(tag) {
  return runGit(["tag", "--list", tag]).length > 0;
}

function semanticTags() {
  return runGit(["tag", "--list"])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((tag) => semverKey(tag))
    .sort((left, right) => compareSemverKey(semverKey(left), semverKey(right)));
}

export function resolvePreviousTag({ targetVersion, targetRef = "HEAD", previousTag }) {
  if (previousTag) return previousTag;
  const tags = semanticTags();
  if (tags.length === 0) {
    throw new Error("No semantic version tags found.");
  }
  if (!tagExists(targetRef)) {
    return tags[tags.length - 1];
  }
  const targetKey = semverKey(targetRef) ?? semverKey(targetVersion);
  const previous = tags.filter((tag) => {
    const key = semverKey(tag);
    return tag !== targetRef && key && compareSemverKey(key, targetKey) < 0;
  });
  if (previous.length === 0) {
    throw new Error(`No previous semantic version tag found before ${targetRef}.`);
  }
  return previous[previous.length - 1];
}

export function getCommitSubjects(previousTag, targetRef = "HEAD") {
  const output = runGit(["log", "--reverse", "--format=%s", `${previousTag}..${targetRef}`]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((subject) => !releaseSubjectPattern.test(subject));
}

function bulletFor(subject) {
  const match = conventionalSubjectPattern.exec(subject);
  if (!match?.groups) {
    return ["Improvements", subject];
  }
  const type = match.groups.type.toLowerCase();
  const category = categoryByType.get(type) ?? "Improvements";
  const scope = match.groups.scope;
  const message = match.groups.message.trim();
  if (!scope) return [category, message];
  const label = scopeLabels.get(scope) ?? scope;
  return [category, `${label}: ${message}`];
}

export function buildChangelogSection({ targetVersion, previousTag, subjects, date = new Date() }) {
  const groups = new Map(categoryOrder.map((category) => [category, []]));
  for (const subject of subjects) {
    const [category, bullet] = bulletFor(subject);
    const bullets = groups.get(category);
    if (!bullets.includes(bullet)) {
      bullets.push(bullet);
    }
  }

  const dateText = formatLocalDate(date);
  const lines = [
    `## [${targetVersion}](${repoUrl}/compare/${previousTag}...${targetVersion}) (${dateText})`,
  ];
  for (const category of categoryOrder) {
    const bullets = groups.get(category);
    if (bullets.length === 0) continue;
    lines.push("", `### ${category}`);
    lines.push(...bullets.map((bullet) => `- ${bullet}`));
  }
  return `${lines.join(EOL).trimEnd()}${EOL}`;
}

export function generateChangelog({ targetVersion, targetRef = "HEAD", previousTag }) {
  const resolvedPreviousTag = resolvePreviousTag({ targetVersion, targetRef, previousTag });
  const subjects = getCommitSubjects(resolvedPreviousTag, targetRef);
  if (subjects.length === 0) {
    throw new Error(`No non-release commits found in ${resolvedPreviousTag}..${targetRef}.`);
  }
  return {
    previousTag: resolvedPreviousTag,
    subjects,
    section: buildChangelogSection({
      targetVersion,
      previousTag: resolvedPreviousTag,
      subjects,
    }),
  };
}

export function upsertChangelogSection(changelogPath, targetVersion, section) {
  const content = readFileSync(changelogPath, "utf8");
  const headerPattern = new RegExp(`^## \\[${escapeRegExp(targetVersion)}\\].*$`, "m");
  const existing = headerPattern.exec(content);
  if (existing) {
    const rest = content.slice(existing.index + existing[0].length);
    const next = /^## \[/m.exec(rest);
    const end = next ? existing.index + existing[0].length + next.index : content.length;
    const updated = `${content.slice(0, existing.index)}${section}${EOL}${content.slice(end).replace(/^\n+/, "")}`;
    writeFileSync(changelogPath, updated);
    return;
  }

  const firstRelease = /^## \[/m.exec(content);
  if (firstRelease) {
    const updated = `${content.slice(0, firstRelease.index)}${section}${EOL}${content.slice(firstRelease.index)}`;
    writeFileSync(changelogPath, updated);
    return;
  }

  writeFileSync(changelogPath, `${content.trimEnd()}${EOL}${EOL}${section}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function printUsageAndExit() {
  console.error("Usage: node scripts/changelog.mjs --target-version <version> [--write] [--to <ref>] [--previous-tag <tag>]");
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.targetVersion) printUsageAndExit();
    const result = generateChangelog({
      targetVersion: options.targetVersion,
      targetRef: options.to,
      previousTag: options.previousTag,
    });
    if (options.write) {
      upsertChangelogSection(options.changelog, options.targetVersion, result.section);
      console.log(`Updated ${options.changelog} for ${options.targetVersion} using ${result.previousTag}..${options.to}.`);
    } else {
      console.log(result.section);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
