import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import console from "node:console";
import process from "node:process";

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
  assertCleanWorktree();
  assertTagExists(targetVersion);
  if (options.watch) {
    assertGhAvailable();
  }

  const branch = currentBranch();
  run("git", ["push", "origin", branch, targetVersion]);

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
