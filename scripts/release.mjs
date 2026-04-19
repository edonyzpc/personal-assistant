import { execFileSync } from "node:child_process";
import console from "node:console";
import { readFile } from "node:fs/promises";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import semver from "semver";

const releaseFiles = [
  "package.json",
  "package-lock.json",
  "manifest.json",
  "manifest-beta.json",
  "versions.json",
  "CHANGELOG.md",
];

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

async function getTargetVersion() {
  const argVersion = process.argv[2];
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

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const currentVersion = packageJson.version;
const targetVersion = await getTargetVersion();

if (!targetVersion) {
  console.error("A new semantic version is required.");
  process.exit(1);
}

if (!semver.valid(targetVersion)) {
  console.error(`Invalid semantic version: ${targetVersion}`);
  process.exit(1);
}

if (!semver.gt(targetVersion, currentVersion)) {
  console.error(
    `New version must be greater than current version ${currentVersion}.`,
  );
  process.exit(1);
}

run("npm", ["version", targetVersion, "--no-git-tag-version"]);

run("git", ["add", ...releaseFiles]);

const releaseMessage = `[release] v${targetVersion}, check the CHANGELOG.md for details`;
run("git", ["commit", "-m", releaseMessage]);
run("git", ["tag", "-a", targetVersion, "-m", releaseMessage]);
