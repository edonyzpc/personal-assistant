import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const loadYaml = createRequire(join(process.cwd(), "package.json"))("js-yaml").load;
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("scripts/release.mjs", () => {
    it("requires prerelease versions to be cut from beta version branches", () => {
        const repo = createReleaseRepo();
        const script = join(process.cwd(), "scripts/release.mjs");

        git(repo, ["switch", "-c", "feature/release-candidate"]);
        commit(repo, "feat(pagelet): prepare beta recall");

        const output = expectReleaseFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain(
            "Prerelease version 2.9.0-beta.1 must be cut from beta/2.9.0-beta.1; current branch is feature/release-candidate.",
        );
    });

    it("rejects prerelease dry-runs from detached HEAD before release state is created", () => {
        const repo = createReleaseRepo();
        const script = join(process.cwd(), "scripts/release.mjs");

        commit(repo, "feat(pagelet): prepare beta recall");
        git(repo, ["switch", "--detach"]);

        const output = expectReleaseFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain(
            "Prerelease version 2.9.0-beta.1 must be cut from beta/2.9.0-beta.1; current branch is detached HEAD.",
        );
    });

    it("allows prerelease dry-runs from the matching beta version branch", () => {
        const repo = createReleaseRepo();
        const script = join(process.cwd(), "scripts/release.mjs");

        commit(repo, "feat(pagelet): prepare beta recall");
        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);

        const output = execFileSync("node", [
            script,
            "--dry-run",
            "2.9.0-beta.1",
        ], { cwd: repo, encoding: "utf8" });

        expect(output).toContain("Target version:  2.9.0-beta.1");
        expect(output).toContain("Changelog range: 2.8.4..HEAD");
    });

    it("rejects prerelease dry-runs with commits added only to the beta branch", () => {
        const repo = createReleaseRepo();
        const script = join(process.cwd(), "scripts/release.mjs");

        commit(repo, "feat(pagelet): prepare beta recall");
        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        commit(repo, "docs(release): beta-only instructions");

        const output = expectReleaseFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain(
            "Prerelease version 2.9.0-beta.1 requires beta/2.9.0-beta.1 HEAD to exactly match local master before release or dry-run",
        );
        expect(output).toContain("Do not add code or documentation commits on the beta branch.");
    });

    it("uses the lightweight release gate and keeps lifecycle CI advisory", () => {
        const releaseScript = readFileSync(join(process.cwd(), "scripts/release.mjs"), "utf8");
        const releaseWorkflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
        const ciWorkflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

        expect(releaseScript).toContain('run("npm", ["run", "docs:check:release"]);');
        expect(releaseScript).not.toContain("DOCS_CHECK_BASE");
        expect(releaseWorkflow).toContain("fetch-depth: 0");
        expect(releaseWorkflow).toContain("run: npm run docs:check:release");
        expect(releaseWorkflow).not.toContain("DOCS_CHECK_BASE");
        const docsStepStart = ciWorkflow.indexOf("- name: Check documentation workflow (advisory)");
        const reportStepStart = ciWorkflow.indexOf("- name: Report documentation workflow findings");
        const docsStep = ciWorkflow.slice(docsStepStart, reportStepStart);

        expect(docsStepStart).toBeGreaterThanOrEqual(0);
        expect(reportStepStart).toBeGreaterThan(docsStepStart);
        expect(docsStep).toContain("id: docs_check");
        expect(docsStep).toContain("continue-on-error: true");
        expect(docsStep).toContain("run: npm run docs:check");
        expect(docsStep).toContain("DOCS_CHECK_BASE");
        expect(ciWorkflow).toContain("steps.docs_check.outcome == 'failure'");
        expect(ciWorkflow).toContain("::warning title=Documentation workflow findings::");
        for (const gate of ["Test", "Lint", "Build", "Audit bundle"]) {
            expect(ciWorkflow.indexOf(`- name: ${gate}`)).toBeGreaterThan(reportStepStart);
        }
    });

    it("builds the production artifact before receipt-dependent Jest gates", () => {
        const root = process.cwd();
        const makefile = readFileSync(join(root, "Makefile"), "utf8");
        const ciWorkflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
        const releaseWorkflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
        const releaseScript = readFileSync(join(root, "scripts/release.mjs"), "utf8");

        expect(readMakeTarget(makefile, "bin")).toEqual({
            prerequisites: [],
            recipe: [
                "bash scripts/check-platform-guards.sh",
                "npm run lint",
                "npm run build",
                "npm run test:all -- --runInBand",
            ],
        });
        expect(readMakeTarget(makefile, "deploy").prerequisites).toContain("bin");
        expect(readMakeTarget(makefile, "deploy-icloud").prerequisites).toContain("bin");
        // Read step structure so adding a safe CI condition does not require
        // mirroring whitespace or line placement in the test.
        for (const [workflow, job] of [[ciWorkflow, "validate"], [releaseWorkflow, "build"]]) {
            const steps = loadYaml(workflow).jobs[job].steps;
            const lintIndex = steps.findIndex((step: { name: string }) => step.name === "Lint");
            const buildIndex = steps.findIndex((step: { name: string }) => step.name === "Build");
            const testIndex = steps.findIndex((step: { name: string }) => step.name === "Test");
            expect(lintIndex).toBeGreaterThan(-1);
            expect(buildIndex).toBeGreaterThan(lintIndex);
            expect(testIndex).toBeGreaterThan(buildIndex);
            expect(steps[lintIndex].run).toBe("npm run lint");
            expect(steps[buildIndex].run).toMatch(/^npm run build(?: --if-present)?$/u);
            expect(steps[testIndex].run).toBe("npm run test:all -- --runInBand --coverage");
            expect(steps[testIndex].if).toBe(steps[buildIndex].if);
            expect(steps[lintIndex].if).toBe(steps[buildIndex].if);
        }
        expectSnippetsInOrder(releaseScript, [
            'run("npm", ["run", "lint"]);',
            'run("npm", ["run", "build"]);',
            'run("npm", ["run", "test:all", "--", "--runInBand", "--coverage"]);',
        ]);
    });

    it("shares full validation across desktop and iCloud and keeps reuse explicit", () => {
        const planned = execFileSync("make", ["-n", "deploy", "deploy-icloud"], {
            cwd: process.cwd(), encoding: "utf8",
        });
        expect(planned.match(/^npm run test:all -- --runInBand$/gmu)).toHaveLength(1);
        expect(planned.match(/^npm run build$/gmu)).toHaveLength(1);
        const copies = planned.split("\n").filter((line) => line.startsWith("node scripts/deploy-current.mjs"));
        expect(copies).toHaveLength(2);
        expect(planned.indexOf(copies[0])).toBeGreaterThan(planned.indexOf("npm run test:all"));
        expect(planned).not.toContain("rm -rf");

        const reused = execFileSync("make", ["-n", "deploy-current", "deploy-icloud-current"], {
            cwd: process.cwd(), encoding: "utf8",
        });
        expect(reused).not.toContain("npm ");
        expect(reused.split("\n").filter((line) => line.startsWith("node scripts/deploy-current.mjs")))
            .toHaveLength(2);
    });

    it("guards prerelease tags against the current origin/master parent", () => {
        const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");

        expect(workflow).toContain("Verify prerelease tag source");
        expect(workflow).toContain('refs/heads/master:refs/remotes/origin/master');
        expect(workflow).toContain('git rev-parse "${GITHUB_SHA}^{commit}"');
        expect(workflow).toContain('git rev-parse "${release_commit}^"');
        expect(workflow).toContain('git rev-parse "origin/master"');
        expect(workflow).toContain('git merge-base --is-ancestor "${release_parent}" "${master_head}"');
        expect(workflow).toContain('beta_ref="refs/heads/beta/${GITHUB_REF_NAME}"');
        expect(workflow).toContain('git diff-tree --no-commit-id --name-only -r "${release_commit}"');
        expect(workflow).toContain("Prerelease release commit contains non-packaging file");
        expect(workflow).toContain("Prerelease release commit is missing generated packaging file");
        expect(workflow).toContain("Verify release metadata version");
        expect(workflow).toContain('["package.json", "manifest.json", "manifest-beta.json"]');
        expect(workflow).toContain("Verify built manifest version");
        expect(workflow).toContain('require("./dist/manifest.json").version');
    });

    it("does not classify stable build metadata containing a hyphen as prerelease", () => {
        const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");

        expect(workflow.match(/version_core="\$\{GITHUB_REF_NAME%%\+\*\}"/g)).toHaveLength(2);
        expect(workflow).toContain('if [[ "${version_core}" != *-* ]]');
        expect(workflow).toContain('if [[ "${version_core}" == *-* ]]');
    });

    describe("beta validation evidence through the release CLI", () => {
        it("reuses successful exact-master CI and creates only the release commit and annotated tag", () => {
            const fixture = createReleaseCliFixture();
            const result = fixture.release();

            expect(result.status).toBe(0);
            expect(fixture.npmCalls()).toEqual([
                ["run", "check:third-party-notices"],
                ["run", "docs:check:release"],
                ["version", "2.9.0-beta.1", "--no-git-tag-version"],
            ]);
            expect(fixture.ghCalls().length).toBeGreaterThanOrEqual(2);
            expect(git(fixture.repo, ["rev-parse", "HEAD^"]).trim()).toBe(fixture.masterSha);
            expect(git(fixture.repo, ["rev-list", "--count", `${fixture.masterSha}..HEAD`]).trim()).toBe("1");
            expect(git(fixture.repo, ["cat-file", "-t", "2.9.0-beta.1"]).trim()).toBe("tag");
            expect(git(fixture.repo, ["rev-parse", "2.9.0-beta.1^{commit}"]).trim())
                .toBe(git(fixture.repo, ["rev-parse", "HEAD"]).trim());
            expect(git(fixture.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
                .trim().split("\n").sort()).toEqual([
                "CHANGELOG.md", "NOTICE", "manifest-beta.json", "manifest.json", "package-lock.json",
                "package.json", "versions.json",
            ].sort());
            expect(git(fixture.repo, ["status", "--porcelain"]).trim()).toBe("");
        });

        it.each(["missing", "failed", "skipped"] as const)(
            "falls back to the complete local chain when CI evidence is %s",
            (evidence) => {
                const fixture = createReleaseCliFixture({ evidence });
                const result = fixture.release();

                expect(result.status).toBe(0);
                expect(fixture.npmCalls()).toEqual(fullReleaseNpmCalls("2.9.0-beta.1"));
                expect(fixture.ghCalls().length).toBeGreaterThan(0);
            },
        );

        it.each(["flag", "environment"] as const)(
            "forces complete local checks via %s without querying GitHub",
            (selection) => {
                const fixture = createReleaseCliFixture();
                const result = fixture.release(
                    selection === "flag" ? ["--local-checks"] : [],
                    selection === "environment" ? { RELEASE_LOCAL_CHECKS: "1" } : {},
                );

                expect(result.status).toBe(0);
                expect(fixture.npmCalls()).toEqual(fullReleaseNpmCalls("2.9.0-beta.1"));
                expect(fixture.ghCalls()).toEqual([]);
            },
        );

        it("keeps stable releases on complete local checks without querying GitHub", () => {
            const fixture = createReleaseCliFixture({ version: "2.9.0" });
            expect(fixture.release().status).toBe(0);
            expect(fixture.npmCalls()).toEqual(fullReleaseNpmCalls("2.9.0"));
            expect(fixture.ghCalls()).toEqual([]);
        });

        it("keeps dry-run free of GitHub requests, validation and release writes", () => {
            const fixture = createReleaseCliFixture();
            expect(fixture.release(["--dry-run"]).status).toBe(0);
            expect(fixture.npmCalls()).toEqual([]);
            expect(fixture.ghCalls()).toEqual([]);
            expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(fixture.masterSha);
            expect(git(fixture.repo, ["tag", "--list", "2.9.0-beta.1"]).trim()).toBe("");
            expect(git(fixture.repo, ["status", "--porcelain"]).trim()).toBe("");
        });

        it("preserves explicit skip-checks and rejects combining it with forced local checks", () => {
            const fixture = createReleaseCliFixture();
            const conflict = fixture.release(["--local-checks"], { SKIP_CHECKS: "1" });
            expect(conflict.status).not.toBe(0);
            expect(fixture.npmCalls()).toEqual([]);
            expect(fixture.ghCalls()).toEqual([]);
            expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(fixture.masterSha);

            expect(fixture.release([], { SKIP_CHECKS: "1" }).status).toBe(0);
            expect(fixture.npmCalls()).toEqual([["version", "2.9.0-beta.1", "--no-git-tag-version"]]);
            expect(fixture.ghCalls()).toEqual([]);
        });

        it("rejects tracked input changes during CI lookup before generating release files", () => {
            const fixture = createReleaseCliFixture({ mutateDuringLookup: true });
            const result = fixture.release();
            expect(result.status).not.toBe(0);
            expect(`${result.stdout}\n${result.stderr}`).toMatch(/clean|changed|dirty/i);
            expect(fixture.npmCalls().some((args) => args[0] === "version")).toBe(false);
            expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(fixture.masterSha);
            expect(git(fixture.repo, ["tag", "--list", "2.9.0-beta.1"]).trim()).toBe("");
            expect(JSON.parse(readFileSync(join(fixture.repo, "package.json"), "utf8")).version).toBe("2.8.4");
            expect(readFileSync(join(fixture.repo, "CHANGELOG.md"), "utf8")).not.toContain("2.9.0-beta.1");
        });
    });
});

function expectSnippetsInOrder(source: string, snippets: string[]): void {
    let cursor = -1;
    for (const snippet of snippets) {
        const index = source.indexOf(snippet, cursor + 1);
        expect(index).toBeGreaterThan(cursor);
        cursor = index;
    }
}

function readMakeTarget(
    source: string,
    target: string,
): { prerequisites: string[]; recipe: string[] } {
    const lines = source.split(/\r?\n/u);
    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const headerPattern = new RegExp(`^${escapedTarget}:\\s*(.*)$`, "u");
    const headerIndex = lines.findIndex((line) => headerPattern.test(line));
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    const prerequisites = (lines[headerIndex].match(headerPattern)?.[1] ?? "")
        .trim()
        .split(/\s+/u)
        .filter(Boolean);
    const recipe: string[] = [];
    for (const line of lines.slice(headerIndex + 1)) {
        if (line.startsWith("\t")) {
            recipe.push(line.slice(1));
            continue;
        }
        if (line.trim().length === 0) continue;
        break;
    }
    return { prerequisites, recipe };
}

function createReleaseRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), "pa-release-"));
    temporaryDirectories.push(repo);
    git(repo, ["init", "-b", "master"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test User"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.hooksPath", "/dev/null"]);
    writeFileSync(join(repo, "package.json"), JSON.stringify({
        name: "personal-assistant-release-test",
        version: "2.8.4",
    }, null, 2), "utf8");
    git(repo, ["add", "package.json"]);
    git(repo, ["commit", "-m", "chore(release): seed"]);
    git(repo, ["tag", "2.8.4"]);
    return repo;
}

function commit(repo: string, message: string): void {
    const marker = join(repo, "marker.txt");
    writeFileSync(marker, `${message}\n${Date.now()}\n`, "utf8");
    git(repo, ["add", "marker.txt"]);
    git(repo, ["commit", "-m", message]);
}

function expectReleaseFailure(repo: string, script: string, version: string): string {
    try {
        execFileSync("node", [
            script,
            "--dry-run",
            version,
        ], { cwd: repo, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
        const commandError = error as { message: string; stdout?: string; stderr?: string };
        return [
            commandError.stdout ?? "",
            commandError.stderr ?? "",
            commandError.message,
        ].join("\n");
    }
    throw new Error(`Expected release dry-run for ${version} to fail.`);
}

function git(repo: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function fullReleaseNpmCalls(version: string): string[][] {
    return [
        ["run", "check:third-party-notices"],
        ["run", "docs:check:release"],
        ["run", "lint"],
        ["run", "build"],
        ["run", "test:all", "--", "--runInBand", "--coverage"],
        ["run", "audit:bundle"],
        ["version", version, "--no-git-tag-version"],
    ];
}

function createReleaseCliFixture(options: {
    version?: string;
    evidence?: "missing" | "failed" | "skipped";
    mutateDuringLookup?: boolean;
} = {}) {
    const repo = createReleaseRepo();
    const toolsDirectory = mkdtempSync(join(tmpdir(), "pa-release-tools-"));
    temporaryDirectories.push(toolsDirectory);
    const remote = join(toolsDirectory, "remote.git");
    git(repo, ["init", "--bare", remote]);
    git(repo, ["remote", "add", "origin", "git@github.com:release-tests/personal-assistant.git"]);
    git(repo, ["config", "tag.gpgSign", "false"]);
    for (const file of ["manifest.json", "manifest-beta.json"]) {
        writeFileSync(join(repo, file), JSON.stringify({ id: "personal-assistant", version: "2.8.4" }));
    }
    writeFileSync(join(repo, "package-lock.json"), JSON.stringify({ version: "2.8.4", packages: { "": { version: "2.8.4" } } }));
    writeFileSync(join(repo, "versions.json"), JSON.stringify({ "2.8.4": "1.11.4" }));
    writeFileSync(join(repo, "NOTICE"), "Personal Assistant\nFor version 2.8.4\n");
    writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## 2.8.4\n\nInitial release.\n");
    mkdirSync(join(repo, ".github/workflows"), { recursive: true });
    writeFileSync(join(repo, ".github/workflows/ci.yml"), readFileSync(join(process.cwd(), ".github/workflows/ci.yml")));
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "feat(memory): prepare release fixture"]);
    git(repo, ["push", remote, "master"]);
    const masterSha = git(repo, ["rev-parse", "HEAD"]).trim();
    const version = options.version ?? "2.9.0-beta.1";
    if (version.includes("-")) git(repo, ["switch", "-c", `beta/${version}`]);

    const run = {
        id: 42, run_number: 10, run_attempt: 1, workflow_id: 17,
        name: "CI", path: ".github/workflows/ci.yml", event: "push", head_branch: "master", head_sha: masterSha,
        status: "completed", conclusion: options.evidence === "failed" ? "failure" : "success",
        repository: { full_name: "release-tests/personal-assistant" },
        head_repository: { full_name: "release-tests/personal-assistant" },
        html_url: "https://github.com/release-tests/personal-assistant/actions/runs/42",
    };
    const job = {
        id: 51, name: "validate", run_id: 42, run_attempt: 1, head_sha: masterSha,
        status: "completed", conclusion: "success",
        steps: ["Install dependencies", "Check platform guards", "Self-test platform guards",
            "Check third-party notices", "Lint", "Build", "Test", "Audit bundle"].map((name, index) => ({
            name, number: index + 1, status: "completed",
            conclusion: options.evidence === "skipped" && name === "Test" ? "skipped" : "success",
        })),
    };
    writeFileSync(join(toolsDirectory, "responses.json"), JSON.stringify({
        runs: { total_count: options.evidence === "missing" ? 0 : 1, workflow_runs: options.evidence === "missing" ? [] : [run] },
        jobs: { total_count: 1, jobs: [job] }, run,
    }));
    const ghLog = join(toolsDirectory, "gh-calls.jsonl");
    const npmLog = join(toolsDirectory, "npm-calls.jsonl");
    // Keep the real GitHub origin identity while Git's SSH transport serves a
    // local bare repository. No network or simulated ls-remote output is used.
    const sshCommand = join(toolsDirectory, "local-git-ssh");
    writeExecutable(sshCommand, `
const { spawnSync } = require("node:child_process");
const result = spawnSync("git-upload-pack", [process.env.RELEASE_TEST_REMOTE], { stdio: "inherit" });
process.exit(result.status ?? 1);
`);
    writeExecutable(join(toolsDirectory, "gh"), `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RELEASE_TEST_GH_LOG, JSON.stringify(args) + "\\n");
const responses = JSON.parse(fs.readFileSync(process.env.RELEASE_TEST_RESPONSES, "utf8"));
if (process.env.RELEASE_TEST_MUTATE === "1") fs.appendFileSync("NOTICE", "Changed during lookup\\n");
const endpoint = args.find(arg => arg.includes("/actions/")) || "";
if (endpoint.includes("/jobs")) process.stdout.write(JSON.stringify(responses.jobs));
else if (endpoint.includes("/workflows/")) process.stdout.write(JSON.stringify(responses.runs));
else if (endpoint.includes("/runs/")) process.stdout.write(JSON.stringify(responses.run));
else { process.stderr.write("Unexpected GitHub request: " + JSON.stringify(args)); process.exit(1); }
`);
    writeExecutable(join(toolsDirectory, "npm"), `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RELEASE_TEST_NPM_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "version") {
    for (const file of ["package.json", "package-lock.json", "manifest.json", "manifest-beta.json"]) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        data.version = args[1];
        if (data.packages) data.packages[""].version = args[1];
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\\n");
    }
    const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
    versions[args[1]] = "1.11.4";
    fs.writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\\n");
}
`);
    const readCalls = (path: string): string[][] => existsSync(path)
        ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [];
    return {
        repo, masterSha,
        npmCalls: () => readCalls(npmLog),
        ghCalls: () => readCalls(ghLog),
        release: (args: string[] = [], environment: Record<string, string> = {}) => spawnSync(
            process.execPath,
            [join(process.cwd(), "scripts/release.mjs"), ...args, version],
            {
                cwd: repo, encoding: "utf8", timeout: 15000,
                env: {
                    ...process.env,
                    SKIP_CHECKS: "", RELEASE_LOCAL_CHECKS: "",
                    PATH: `${toolsDirectory}:${process.env.PATH ?? ""}`,
                    RELEASE_TEST_GH_LOG: ghLog, RELEASE_TEST_NPM_LOG: npmLog,
                    RELEASE_TEST_RESPONSES: join(toolsDirectory, "responses.json"),
                    RELEASE_TEST_MUTATE: options.mutateDuringLookup ? "1" : "0",
                    RELEASE_TEST_REMOTE: remote, GIT_SSH_COMMAND: sshCommand, GIT_SSH_VARIANT: "ssh",
                    ...environment,
                },
            },
        ),
    };
}

function writeExecutable(path: string, source: string): void {
    writeFileSync(path, `#!${process.execPath}\n${source}`);
    chmodSync(path, 0o755);
}
