import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const loadYaml = createRequire(join(process.cwd(), "package.json"))("js-yaml").load;

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
