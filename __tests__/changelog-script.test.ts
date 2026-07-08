import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scripts/changelog.mjs", () => {
    it("uses the previous stable tag when generating the first beta changelog", () => {
        const repo = createGitRepo();
        const script = join(process.cwd(), "scripts/changelog.mjs");

        commit(repo, "seed");
        git(repo, ["tag", "v2.8.4"]);
        commit(repo, "feat(pagelet): prepare beta recall");

        const output = execFileSync("node", [
            script,
            "--target-version",
            "2.9.0-beta.1",
        ], { cwd: repo, encoding: "utf8" });

        expect(output).toContain("compare/v2.8.4...2.9.0-beta.1");
        expect(output).toContain("pagelet: prepare beta recall");
    });

    it("ignores prerelease tags when generating a stable release changelog", () => {
        const repo = createGitRepo();
        const script = join(process.cwd(), "scripts/changelog.mjs");

        commit(repo, "seed");
        git(repo, ["tag", "2.8.4"]);
        commit(repo, "feat(pagelet): prepare beta recall");
        git(repo, ["tag", "2.9.0-beta.1"]);

        const output = execFileSync("node", [
            script,
            "--target-version",
            "2.9.0",
        ], { cwd: repo, encoding: "utf8" });

        expect(output).toContain("compare/2.8.4...2.9.0");
        expect(output).toContain("pagelet: prepare beta recall");
    });

    it("uses the previous prerelease tag when generating the next beta changelog", () => {
        const repo = createGitRepo();
        const script = join(process.cwd(), "scripts/changelog.mjs");

        commit(repo, "seed");
        git(repo, ["tag", "2.8.4"]);
        commit(repo, "feat(pagelet): prepare beta recall");
        git(repo, ["tag", "2.9.0-beta.1"]);
        commit(repo, "fix(chat): repair beta install smoke");

        const output = execFileSync("node", [
            script,
            "--target-version",
            "2.9.0-beta.2",
        ], { cwd: repo, encoding: "utf8" });

        expect(output).toContain("compare/2.9.0-beta.1...2.9.0-beta.2");
        expect(output).toContain("chat: repair beta install smoke");
        expect(output).not.toContain("pagelet: prepare beta recall");
    });
});

function createGitRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), "pa-changelog-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test User"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.hooksPath", "/dev/null"]);
    return repo;
}

function commit(repo: string, message: string): void {
    const marker = join(repo, "marker.txt");
    writeFileSync(marker, `${message}\n${Date.now()}\n`, "utf8");
    git(repo, ["add", "marker.txt"]);
    git(repo, ["commit", "-m", message]);
}

function git(repo: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
