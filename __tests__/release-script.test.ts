import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

    it("checks tagged releases against the previous reachable tag with full history", () => {
        const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");

        expect(workflow).toContain("fetch-depth: 0");
        expect(workflow).toContain('git describe --tags --abbrev=0 "${GITHUB_SHA}^"');
        expect(workflow).toContain('git rev-list --max-parents=0 "${GITHUB_SHA}"');
        expect(workflow).toContain("DOCS_CHECK_BASE: ${{ steps.docs-base.outputs.base }}");
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
