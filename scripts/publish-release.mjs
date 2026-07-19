import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import console from "node:console";
import process from "node:process";
import semver from "semver";

const prereleasePackagingFiles = new Set([
  "package.json",
  "package-lock.json",
  "manifest.json",
  "manifest-beta.json",
  "versions.json",
  "CHANGELOG.md",
  "NOTICE",
]);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  })?.toString().trim() ?? "";
}

function parseArgs(argv) {
  const options = {
    watch: true,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--no-watch") {
      options.watch = false;
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

function packageVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function validateTargetVersion(version) {
  if (!version) {
    throw new Error("A semantic version is required.");
  }
  if (version.startsWith("v")) {
    throw new Error(`Use a bare semantic version without a leading v, for example ${version.slice(1)}.`);
  }
  if (!semver.valid(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
}

function assertPackageVersionMatches(targetVersion) {
  const currentVersion = packageVersion();
  if (currentVersion !== targetVersion) {
    throw new Error(
      `package.json version ${currentVersion} does not match publish target ${targetVersion}. Run make release VERSION=${targetVersion} first.`,
    );
  }
}

function assertManifestVersionsMatch(targetVersion) {
  for (const file of ["manifest.json", "manifest-beta.json"]) {
    const version = JSON.parse(readFileSync(file, "utf8")).version;
    if (version !== targetVersion) {
      throw new Error(
        `${file} version ${version} does not match publish target ${targetVersion}. Run make release VERSION=${targetVersion} first.`,
      );
    }
  }
}

function assertCleanWorktree() {
  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status) {
    throw new Error(`Working tree must be clean before publish:\n${status}`);
  }
}

function assertTagExists(version) {
  const tag = run("git", ["tag", "--list", version], { capture: true });
  if (!tag) {
    throw new Error(`Local tag does not exist: ${version}. Run make release VERSION=${version} first.`);
  }
}

function currentBranch() {
  const branch = run("git", ["branch", "--show-current"], { capture: true });
  if (!branch) {
    throw new Error("Cannot publish from a detached HEAD.");
  }
  return branch;
}

function expectedBranchFor(version) {
  return semver.prerelease(version) === null ? "master" : `beta/${version}`;
}

function assertPublishBranch(targetVersion, branch) {
  const expectedBranch = expectedBranchFor(targetVersion);
  if (branch !== expectedBranch) {
    throw new Error(
      `Publish for ${targetVersion} must run from ${expectedBranch}; current branch is ${branch}.`,
    );
  }
}

function commitFor(ref) {
  return run("git", ["rev-parse", ref], { capture: true });
}

function assertTagPointsToHead(targetVersion) {
  const tagCommit = commitFor(`${targetVersion}^{}`);
  const headCommit = commitFor("HEAD");
  if (tagCommit !== headCommit) {
    throw new Error(
      `Tag ${targetVersion} points to ${tagCommit}, but HEAD is ${headCommit}. Publish from the release commit that owns the tag.`,
    );
  }
}

function assertPrereleaseCommitDirectlyAboveMaster(targetVersion) {
  if (semver.prerelease(targetVersion) === null) return;

  let masterCommit;
  try {
    masterCommit = commitFor("refs/heads/master^{commit}");
  } catch {
    throw new Error(
      `Prerelease publish for ${targetVersion} requires a local master branch, but refs/heads/master does not exist.`,
    );
  }

  const headCommit = commitFor("HEAD");
  const parentRecord = run("git", ["rev-list", "--parents", "-n", "1", "HEAD"], { capture: true });
  const parents = parentRecord.split(/\s+/).slice(1);
  if (parents.length !== 1) {
    throw new Error(
      `Prerelease publish for ${targetVersion} requires tagged HEAD to be exactly one single-parent release commit above local master; HEAD ${headCommit} has ${parents.length} parents.`,
    );
  }

  const headParent = commitFor("HEAD^");
  if (headParent !== masterCommit) {
    throw new Error(
      `Prerelease publish for ${targetVersion} requires HEAD^ to equal local master; HEAD^ is ${headParent}, local master is ${masterCommit}. No divergence or extra beta commits are allowed.`,
    );
  }
}

function assertPrereleasePackagingCommit(targetVersion) {
  if (semver.prerelease(targetVersion) === null) return;

  const expectedSubject = `[release] v${targetVersion}, check the CHANGELOG.md for details`;
  const subject = run("git", ["log", "-1", "--format=%s", "HEAD"], { capture: true });
  if (subject !== expectedSubject) {
    throw new Error(
      `Prerelease publish for ${targetVersion} requires release commit subject "${expectedSubject}"; found "${subject}".`,
    );
  }

  const changedFiles = run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  const unexpectedFiles = changedFiles.filter((file) => !prereleasePackagingFiles.has(file));
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Prerelease release commit for ${targetVersion} contains non-packaging files: ${unexpectedFiles.join(", ")}. Put code, tests, research, and documentation changes on master before creating beta.`,
    );
  }
  const missingFiles = [...prereleasePackagingFiles].filter((file) => !changedFiles.includes(file));
  if (missingFiles.length > 0) {
    throw new Error(
      `Prerelease release commit for ${targetVersion} is missing generated packaging files: ${missingFiles.join(", ")}. Run make release VERSION=${targetVersion} instead of constructing the release commit manually.`,
    );
  }
}

function assertPrereleaseMasterSyncedWithOrigin(targetVersion) {
  if (semver.prerelease(targetVersion) === null) return null;

  const masterCommit = commitFor("refs/heads/master^{commit}");
  let remoteOutput;
  try {
    remoteOutput = run("git", ["ls-remote", "--heads", "origin", "refs/heads/master"], { capture: true });
  } catch {
    throw new Error(
      `Prerelease publish for ${targetVersion} could not read origin/master. Verify the origin remote and network before publishing.`,
    );
  }

  const originMasterCommit = remoteOutput.split(/\s+/)[0] ?? "";
  if (!originMasterCommit) {
    throw new Error(
      `Prerelease publish for ${targetVersion} requires origin/master, but the remote branch was not found.`,
    );
  }

  if (masterCommit !== originMasterCommit) {
    throw new Error(
      `Prerelease publish for ${targetVersion} requires local master to equal origin/master; local master is ${masterCommit}, origin/master is ${originMasterCommit}. Integrate and explicitly push master before publishing beta.`,
    );
  }
  return originMasterCommit;
}

function assertGhAvailable() {
  try {
    run("gh", ["--version"], { capture: true });
  } catch (error) {
    throw new Error("GitHub CLI is required to watch the release workflow. Install gh or use --no-watch.");
  }
}

async function findWorkflowRun(version) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const output = run("gh", [
      "run",
      "list",
      "--workflow",
      "release.yml",
      "--limit",
      "10",
      "--json",
      "databaseId,headBranch,status,conclusion,url,displayTitle",
    ], { capture: true });
    const runs = JSON.parse(output);
    const match = runs.find((runItem) => runItem.headBranch === version);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetVersion = options.targetVersion || packageVersion();
  validateTargetVersion(targetVersion);
  assertCleanWorktree();
  assertTagExists(targetVersion);
  assertPackageVersionMatches(targetVersion);
  assertManifestVersionsMatch(targetVersion);
  const branch = currentBranch();
  assertPublishBranch(targetVersion, branch);
  assertTagPointsToHead(targetVersion);
  assertPrereleaseCommitDirectlyAboveMaster(targetVersion);
  assertPrereleasePackagingCommit(targetVersion);
  const verifiedOriginMaster = assertPrereleaseMasterSyncedWithOrigin(targetVersion);
  if (options.watch) {
    assertGhAvailable();
  }

  if (verifiedOriginMaster) {
    run("git", [
      "push",
      "--atomic",
      "origin",
      branch,
      targetVersion,
    ]);
  } else {
    run("git", ["push", "origin", branch, targetVersion]);
  }

  if (!options.watch) {
    console.log(`Pushed ${branch} and tag ${targetVersion}.`);
    return;
  }

  const workflowRun = await findWorkflowRun(targetVersion);
  if (!workflowRun) {
    console.log(`Pushed ${branch} and tag ${targetVersion}, but no release workflow run was found yet.`);
    console.log("Check GitHub Actions manually.");
    return;
  }
  console.log(`Watching release workflow: ${workflowRun.url}`);
  run("gh", ["run", "watch", String(workflowRun.databaseId), "--exit-status"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
