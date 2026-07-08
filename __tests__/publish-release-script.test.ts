import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scripts/publish-release.mjs", () => {
    it("requires prerelease publishes to run from the matching beta branch", () => {
        const repo = createPublishRepo("2.9.0-beta.1");
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["switch", "-c", "feature/release-candidate"]);
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);

        const output = expectPublishFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain(
            "Publish for 2.9.0-beta.1 must run from beta/2.9.0-beta.1; current branch is feature/release-candidate.",
        );
    });

    it("requires stable publishes to run from master", () => {
        const repo = createPublishRepo("2.9.0");
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["switch", "-c", "feature/release-candidate"]);
        git(repo, ["tag", "-a", "2.9.0", "-m", "2.9.0"]);

        const output = expectPublishFailure(repo, script, "2.9.0");

        expect(output).toContain(
            "Publish for 2.9.0 must run from master; current branch is feature/release-candidate.",
        );
    });

    it("rejects publish when package version does not match the target tag", () => {
        const repo = createPublishRepo("2.8.4");
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["tag", "-a", "2.9.0", "-m", "2.9.0"]);

        const output = expectPublishFailure(repo, script, "2.9.0");

        expect(output).toContain(
            "package.json version 2.8.4 does not match publish target 2.9.0. Run make release VERSION=2.9.0 first.",
        );
    });

    it("rejects publish when the target tag does not point at HEAD", () => {
        const repo = createPublishRepo("2.9.0-beta.1");
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);
        commit(repo, "fix(release): move past the beta tag");

        const output = expectPublishFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain("Tag 2.9.0-beta.1 points to ");
        expect(output).toContain("but HEAD is ");
        expect(output).toContain("Publish from the release commit that owns the tag.");
    });
});

function createPublishRepo(version: string): string {
    const repo = mkdtempSync(join(tmpdir(), "pa-publish-"));
    git(repo, ["init", "-b", "master"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test User"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.hooksPath", "/dev/null"]);
    writeFileSync(join(repo, "package.json"), JSON.stringify({
        name: "personal-assistant-publish-test",
        version,
    }, null, 2), "utf8");
    git(repo, ["add", "package.json"]);
    git(repo, ["commit", "-m", "chore(release): seed"]);
    return repo;
}

function commit(repo: string, message: string): void {
    const marker = join(repo, "marker.txt");
    writeFileSync(marker, `${message}\n${Date.now()}\n`, "utf8");
    git(repo, ["add", "marker.txt"]);
    git(repo, ["commit", "-m", message]);
}

function expectPublishFailure(repo: string, script: string, version: string): string {
    try {
        execFileSync("node", [
            script,
            "--no-watch",
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
    throw new Error(`Expected publish for ${version} to fail.`);
}

function git(repo: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
