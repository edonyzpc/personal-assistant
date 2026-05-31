import { execFileSync } from "node:child_process";
import console from "node:console";
import { readFile } from "node:fs/promises";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import semver from "semver";
import {
  generateChangelog,
  upsertChangelogSection,
} from "./changelog.mjs";

const releaseFiles = [
  "package.json",
  "package-lock.json",
  "manifest.json",
  "manifest-beta.json",
  "versions.json",
  "CHANGELOG.md",
];

function run(command, args, options = {}) {
  const label = [command, ...args].join(" ");
  if (options.dryRun) {
    console.log(`[dry-run] ${label}`);
    return "";
  }
  return execFileSync(command, args, {
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  })?.toString().trim() ?? "";
}

function capture(command, args) {
  return run(command, args, { capture: true });
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    skipChecks: process.env.SKIP_CHECKS === "1",
  };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-checks") {
      options.skipChecks = true;
    } else if (arg === "--target-version") {
      options.targetVersion = argv[++index];
    } else if (arg.trim() !== "") {
      positional.push(arg);
    }
  }
  if (!options.targetVersion && positional.length > 0) {
    options.targetVersion = positional[0];
  }
  return options;
}

async function getTargetVersion(argVersion) {
  if (argVersion) return argVersion.trim();

  const rl = createInterface({ input, output });
  try {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const currentVersion = packageJson.version;
    const answer = await rl.question(
      `Current version is ${currentVersion}. New version: `,
    );
    return answer.trim();
  } finally {
    rl.close();
  }
}

function assertCleanWorktree(label = "before release") {
  const status = capture("git", ["status", "--porcelain"]);
  if (status) {
    throw new Error(`Working tree must be clean ${label}:\n${status}`);
  }
}

function assertTagAvailable(targetVersion) {
  const existing = existingTagForVersion(targetVersion);
  if (existing) {
    throw new Error(`Tag already exists: ${existing}`);
  }
}

function existingTagForVersion(version) {
  for (const candidate of [version, `v${version}`]) {
    const existing = capture("git", ["tag", "--list", candidate]);
    if (existing) return candidate;
  }
  return "";
}

function assertCurrentVersionTagged(currentVersion) {
  if (existingTagForVersion(currentVersion)) return;
  throw new Error(
    `Current package version ${currentVersion} is not tagged. Sync or create the ${currentVersion} tag before cutting the next release.`,
  );
}

function validateVersion(targetVersion, currentVersion) {
  if (!targetVersion) {
    throw new Error("A new semantic version is required.");
  }
  if (!semver.valid(targetVersion)) {
    throw new Error(`Invalid semantic version: ${targetVersion}`);
  }
  if (!semver.gt(targetVersion, currentVersion)) {
    throw new Error(`New version must be greater than current version ${currentVersion}.`);
  }
}

function runChecks() {
  run("git", ["diff", "--check"]);
  run("npm", ["test", "--", "--runInBand"]);
  run("npm", ["run", "lint"]);
  run("npm", ["run", "build"]);
  assertCleanWorktree("after validation checks");
}

function printDryRunPlan({ currentVersion, targetVersion, changelog }) {
  console.log("");
  console.log("Release dry run");
  console.log("----------------");
  console.log(`Current version: ${currentVersion}`);
  console.log(`Target version:  ${targetVersion}`);
  console.log(`Changelog range: ${changelog.previousTag}..HEAD`);
  console.log("");
  console.log("Commits:");
  for (const subject of changelog.subjects) {
    console.log(`- ${subject}`);
  }
  console.log("");
  console.log("Generated changelog section:");
  console.log(changelog.section.trimEnd());
  console.log("");
  console.log("No files were changed.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const currentVersion = packageJson.version;
  const targetVersion = await getTargetVersion(options.targetVersion);

  validateVersion(targetVersion, currentVersion);
  assertTagAvailable(targetVersion);
  assertCleanWorktree();
  assertCurrentVersionTagged(currentVersion);

  const changelog = generateChangelog({ targetVersion, targetRef: "HEAD" });

  if (options.dryRun) {
    printDryRunPlan({ currentVersion, targetVersion, changelog });
    return;
  }

  if (!options.skipChecks) {
    runChecks();
  }

  upsertChangelogSection("CHANGELOG.md", targetVersion, changelog.section);
  run("npm", ["version", targetVersion, "--no-git-tag-version"]);
  run("git", ["diff", "--check"]);
  run("git", ["add", ...releaseFiles]);

  const releaseMessage = `[release] v${targetVersion}, check the CHANGELOG.md for details`;
  run("git", ["commit", "-m", releaseMessage]);
  run("git", ["tag", "-a", targetVersion, "-m", releaseMessage]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
