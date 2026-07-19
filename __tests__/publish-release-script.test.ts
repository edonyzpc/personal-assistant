import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

    it("rejects publish when a manifest version does not match the target tag", () => {
        const repo = createPublishRepo("2.8.4");
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        writeReleaseFiles(repo, "2.9.0-beta.1", { manifestVersion: "2.8.4" });
        git(repo, ["commit", "-m", "[release] v2.9.0-beta.1, check the CHANGELOG.md for details"]);
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);

        const output = expectPublishFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain(
            "manifest.json version 2.8.4 does not match publish target 2.9.0-beta.1",
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

    it("allows prerelease publish when the tagged release commit is directly above master", () => {
        const repo = createPublishRepo("2.8.4");
        const remote = createBareRemote();
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["remote", "add", "origin", remote]);
        git(repo, ["push", "-u", "origin", "master"]);
        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        commitRelease(repo, "2.9.0-beta.1");
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);

        const output = execFileSync("node", [
            script,
            "--no-watch",
            "2.9.0-beta.1",
        ], { cwd: repo, encoding: "utf8" });

        expect(output).toContain("Pushed beta/2.9.0-beta.1 and tag 2.9.0-beta.1.");
        expect(git(remote, ["rev-parse", "refs/heads/beta/2.9.0-beta.1"])).toBe(git(repo, ["rev-parse", "HEAD"]));
        expect(git(remote, ["rev-parse", "refs/tags/2.9.0-beta.1^{}"])).toBe(git(repo, ["rev-parse", "HEAD"]));
    });

    it("rejects prerelease publish when beta has more than the release commit above master", () => {
        const repo = createPublishRepo("2.8.4");
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        commit(repo, "feat(pagelet): beta-only code");
        commitRelease(repo, "2.9.0-beta.1");
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);

        const output = expectPublishFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain(
            "Prerelease publish for 2.9.0-beta.1 requires HEAD^ to equal local master",
        );
        expect(output).toContain("No divergence or extra beta commits are allowed.");
    });

    it("rejects prerelease publish when local master is not integrated into origin/master", () => {
        const repo = createPublishRepo("2.8.4");
        const remote = createBareRemote();
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["remote", "add", "origin", remote]);
        git(repo, ["push", "-u", "origin", "master"]);
        commit(repo, "fix(pagelet): accepted fix not pushed to master");
        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        commitRelease(repo, "2.9.0-beta.1");
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);

        const output = expectPublishFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain(
            "Prerelease publish for 2.9.0-beta.1 requires local master to equal origin/master",
        );
        expect(output).toContain("Integrate and explicitly push master before publishing beta.");
        expect(() => git(remote, ["show-ref", "--verify", "--quiet", "refs/heads/beta/2.9.0-beta.1"])).toThrow();
        expect(() => git(remote, ["show-ref", "--verify", "--quiet", "refs/tags/2.9.0-beta.1"])).toThrow();
    });

    it("rejects a release-shaped commit that contains non-packaging files", () => {
        const repo = createPublishRepo("2.8.4");
        const remote = createBareRemote();
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["remote", "add", "origin", remote]);
        git(repo, ["push", "-u", "origin", "master"]);
        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        writeReleaseFiles(repo, "2.9.0-beta.1");
        writeFileSync(join(repo, "beta-only-runtime.js"), "throw new Error('beta only');\n", "utf8");
        git(repo, ["add", "beta-only-runtime.js"]);
        git(repo, ["commit", "-m", "[release] v2.9.0-beta.1, check the CHANGELOG.md for details"]);
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);

        const output = expectPublishFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain("contains non-packaging files: beta-only-runtime.js");
        expect(output).toContain("Put code, tests, research, and documentation changes on master");
    });

    it("checks the live remote when the cached origin/master ref is stale", () => {
        const repo = createPublishRepo("2.8.4");
        const remote = createBareRemote();
        const script = join(process.cwd(), "scripts/publish-release.mjs");

        git(repo, ["remote", "add", "origin", remote]);
        git(repo, ["push", "-u", "origin", "master"]);
        advanceRemoteMaster(remote);
        expect(git(repo, ["rev-parse", "master"])).toBe(git(repo, ["rev-parse", "origin/master"]));
        git(repo, ["switch", "-c", "beta/2.9.0-beta.1"]);
        commitRelease(repo, "2.9.0-beta.1");
        git(repo, ["tag", "-a", "2.9.0-beta.1", "-m", "2.9.0-beta.1"]);

        const output = expectPublishFailure(repo, script, "2.9.0-beta.1");

        expect(output).toContain("requires local master to equal origin/master");
        expect(() => git(remote, ["show-ref", "--verify", "--quiet", "refs/heads/beta/2.9.0-beta.1"])).toThrow();
        expect(() => git(remote, ["show-ref", "--verify", "--quiet", "refs/tags/2.9.0-beta.1"])).toThrow();
    });

    it("pushes the prerelease branch and tag atomically after live master preflight", () => {
        const script = readFileSync(join(process.cwd(), "scripts/publish-release.mjs"), "utf8");

        expect(script).toContain('"--atomic"');
        expect(script).not.toContain("--force-with-lease=refs/heads/master");
        expect(script).not.toContain('"master:master"');
    });
});

function createBareRemote(): string {
    const remote = mkdtempSync(join(tmpdir(), "pa-publish-remote-"));
    git(remote, ["init", "--bare"]);
    git(remote, ["symbolic-ref", "HEAD", "refs/heads/master"]);
    return remote;
}

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
    writeFileSync(join(repo, "manifest.json"), JSON.stringify({ version }, null, 2), "utf8");
    writeFileSync(join(repo, "manifest-beta.json"), JSON.stringify({ version }, null, 2), "utf8");
    git(repo, ["add", "package.json", "manifest.json", "manifest-beta.json"]);
    git(repo, ["commit", "-m", "chore(release): seed"]);
    return repo;
}

function advanceRemoteMaster(remote: string): void {
    const clone = mkdtempSync(join(tmpdir(), "pa-publish-remote-clone-"));
    git(clone, ["clone", remote, "."]);
    git(clone, ["config", "user.email", "test@example.com"]);
    git(clone, ["config", "user.name", "Test User"]);
    git(clone, ["config", "commit.gpgsign", "false"]);
    commit(clone, "fix(remote): advance master concurrently");
    git(clone, ["push", "origin", "master"]);
}

function commitRelease(repo: string, version: string): void {
    writeReleaseFiles(repo, version);
    git(repo, ["commit", "-m", `[release] v${version}, check the CHANGELOG.md for details`]);
}

function writeReleaseFiles(
    repo: string,
    version: string,
    options: { manifestVersion?: string } = {},
): void {
    const name = "personal-assistant-publish-test";
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name, version }, null, 2), "utf8");
    writeFileSync(join(repo, "package-lock.json"), JSON.stringify({
        name,
        version,
        lockfileVersion: 3,
        packages: { "": { name, version } },
    }, null, 2), "utf8");
    writeFileSync(join(repo, "manifest.json"), JSON.stringify({
        version: options.manifestVersion ?? version,
    }, null, 2), "utf8");
    writeFileSync(join(repo, "manifest-beta.json"), JSON.stringify({ version }, null, 2), "utf8");
    writeFileSync(join(repo, "versions.json"), JSON.stringify({ [version]: "1.0.0" }, null, 2), "utf8");
    writeFileSync(join(repo, "CHANGELOG.md"), `## ${version}\n`, "utf8");
    writeFileSync(join(repo, "NOTICE"), `For version ${version}\n`, "utf8");
    git(repo, [
        "add",
        "package.json",
        "package-lock.json",
        "manifest.json",
        "manifest-beta.json",
        "versions.json",
        "CHANGELOG.md",
        "NOTICE",
    ]);
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
