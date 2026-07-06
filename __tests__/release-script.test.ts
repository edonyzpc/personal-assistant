import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        commit(repo, "feat(pagelet): prepare beta recall");

        const output = execFileSync("node", [
            script,
            "--dry-run",
            "2.9.0-beta.1",
        ], { cwd: repo, encoding: "utf8" });

        expect(output).toContain("Target version:  2.9.0-beta.1");
        expect(output).toContain("Changelog range: 2.8.4..HEAD");
    });
});

function createReleaseRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), "pa-release-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test User"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
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
