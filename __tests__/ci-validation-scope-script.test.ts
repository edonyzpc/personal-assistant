import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const classifier = join(process.cwd(), "scripts/ci-validation-scope.mjs");
const temporaryRepos: string[] = [];
const tracker = join("docs", "development", "active", "example", "tracker.md");
const requiredSteps = ["Install dependencies", "Lint", "Build", "Test", "Audit bundle"];

afterEach(() => {
    for (const repo of temporaryRepos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

describe("CI generated packaging scope", () => {
    it("selects packaging only for a single stable master push with verified full parent CI", () => {
        const fixture = createReleasePushFixture();
        const result = fixture.classify(fixture.sourceCommit, "push", "refs/heads/master");

        expect(result.scope).toBe("packaging");
        expect(result.calls).toHaveLength(3);
        expect(result.calls[0][3]).toContain(`head_sha=${fixture.sourceCommit}&per_page=1`);
    });

    it.each([
        ["pull request", "pull_request", "refs/pull/123/merge"],
        ["non-master push", "push", "refs/heads/feature"],
    ])("keeps a release-shaped %s on full without consulting CI", (_name, event, ref) => {
        const fixture = createReleasePushFixture();
        const result = fixture.classify(fixture.sourceCommit, event, ref);

        expect(result.scope).toBe("full");
        expect(result.calls).toEqual([]);
    });

    it("keeps a multi-commit master push on full without consulting CI", () => {
        const fixture = createReleasePushFixture();
        write(fixture.repo, tracker, "additional documentation\n");
        commit(fixture.repo);
        const result = fixture.classify(fixture.sourceCommit, "push", "refs/heads/master");

        expect(result.scope).toBe("full");
        expect(result.calls).toEqual([]);
    });

    it("keeps dependency mutations of generated packaging on full", () => {
        const fixture = createReleasePushFixture({
            mutatePackage: value => { value.dependencies.semver = "8.0.0"; },
        });
        const result = fixture.classify(fixture.sourceCommit, "push", "refs/heads/master");

        expect(result.scope).toBe("full");
        expect(result.calls).toEqual([]);
    });

    it("keeps generated packaging on full when parent CI lookup is unavailable", () => {
        const fixture = createReleasePushFixture({ ghFails: true });
        const result = fixture.classify(fixture.sourceCommit, "push", "refs/heads/master");

        expect(result.scope).toBe("full");
        expect(result.calls).toHaveLength(1);
    });

    it("does not let a successful packaging-only parent CI replace full source evidence", () => {
        const fixture = createReleasePushFixture({ parentStepConclusions: "skipped" });
        const result = fixture.classify(fixture.sourceCommit, "push", "refs/heads/master");

        expect(result.scope).toBe("full");
        expect(result.calls).toHaveLength(2);
        expect(result.calls[1][3]).toContain("/attempts/1/jobs");
    });
});

describe("CI documentation scope", () => {
    it("routes ordinary Markdown edits, additions and deletions to docs", () => {
        const oldArchive = join("docs", "archive", "old.md");
        const { repo, base } = fixture({ [tracker]: "before", [oldArchive]: "old" });
        write(repo, tracker, "after");
        write(repo, join("docs", "product", "specs", "example.md"), "new spec");
        write(repo, join("docs", "architecture", "example.md"), "new architecture");
        write(repo, "docs/backlog.md", "new backlog");
        write(repo, "docs/index.md", "new index");
        write(repo, "docs/development-roadmap.md", "new roadmap");
        rmSync(join(repo, oldArchive));
        commit(repo);

        expect(classify(repo, base)).toBe("docs");
    });

    it.each([
        "README.md", "README-CN.md", "CHANGELOG.md", "LICENSE", "NOTICE",
        "THIRD_PARTY_NOTICES.md", "TRADEMARKS.md", "docs/operations/release-process.md",
        join("docs", "guides", "usage.md"), "skills/sample/SKILL.md", ".agents/skills/sample/SKILL.md",
        "src/main.ts", "scripts/task.mjs", ".github/workflows/ci.yml", "package.json",
        "docs/development/fixture.json", join("docs", "unknown", "example.md"),
    ])("keeps mixed changes containing %s on the full path", (file) => {
        const { repo, base } = fixture({ [tracker]: "before" });
        write(repo, tracker, "after");
        write(repo, file, "changed");
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it.each([
        ["skills/sample/SKILL.md", tracker],
        [tracker, "docs/operations/release-process.md"],
    ])("checks both sides of a rename from %s to %s", (source, destination) => {
        const { repo, base } = fixture({ [source]: "unchanged document" });
        mkdirSync(dirname(join(repo, destination)), { recursive: true });
        renameSync(join(repo, source), join(repo, destination));
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it("keeps deletions of protected documents on the full path", () => {
        const { repo, base } = fixture({ "NOTICE": "legal", [tracker]: "tracker" });
        rmSync(join(repo, "NOTICE"));
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it("compares every commit since the event base rather than only HEAD^", () => {
        const { repo, base } = fixture({ [tracker]: "before" });
        write(repo, "src/main.ts", "runtime change");
        commit(repo);
        write(repo, tracker, "after");
        commit(repo);

        expect(classify(repo, base)).toBe("full");
    });

    it("compares the checked-out PR merge result against the current PR base", () => {
        const { repo } = fixture({ [tracker]: "before" });
        git(repo, ["checkout", "-b", "feature"]);
        write(repo, tracker, "feature documentation");
        commit(repo);
        git(repo, ["checkout", "main"]);
        write(repo, "src/main.ts", "base branch runtime change");
        const base = commit(repo);
        git(repo, ["merge", "--no-ff", "--no-edit", "feature"]);

        expect(classify(repo, base)).toBe("docs");
    });

    it("keeps an ordinary master documentation push on docs even when package metadata is present", () => {
        const { repo, base } = fixture({
            [tracker]: "before",
            "package.json": JSON.stringify({ name: "personal-assistant", version: "2.10.2" }),
        });
        write(repo, tracker, "after");
        commit(repo);

        const result = classifyDetailed(repo, base, {
            CI_VALIDATION_EVENT: "push",
            CI_VALIDATION_REF: "refs/heads/master",
        });

        expect(result.scope).toBe("docs");
        expect(result.calls).toEqual([]);
    });

    it.each([undefined, "", "0".repeat(40), "f".repeat(40), "HEAD", "--help", "bad\nSHA"])(
        "falls back to full for an absent, invalid or unavailable base (%s)", (base) => {
            const { repo } = fixture({ [tracker]: "before" });
            write(repo, tracker, "after");
            commit(repo);

            expect(classify(repo, base)).toBe("full");
        },
    );

    it("does not interpret a shell expression supplied as the base", () => {
        const { repo } = fixture({ [tracker]: "before" });
        expect(classify(repo, "$(touch scope-injection)")).toBe("full");
        expect(existsSync(join(repo, "scope-injection"))).toBe(false);
    });

    it("falls back to full for an empty diff or a non-commit object", () => {
        const { repo, base } = fixture({ [tracker]: "before" });
        expect(classify(repo, base)).toBe("full");
        expect(classify(repo, git(repo, ["rev-parse", "HEAD^{tree}"]))).toBe("full");
    });
});

function fixture(files: Record<string, string>): { repo: string; base: string } {
    const repo = mkdtempSync(join(tmpdir(), "pa-ci-scope-"));
    temporaryRepos.push(repo);
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.name", "Test User"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.hooksPath", "/dev/null"]);
    for (const [file, content] of Object.entries(files)) write(repo, file, content);
    return { repo, base: commit(repo) };
}

function write(repo: string, file: string, content: string): void {
    const target = join(repo, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
}

function git(repo: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
}

function commit(repo: string, message = "fixture change"): string {
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", message]);
    return git(repo, ["rev-parse", "HEAD"]);
}

function classify(repo: string, base?: string): string {
    return classifyDetailed(repo, base).scope;
}

function classifyDetailed(repo: string, base?: string, environment: Record<string, string> = {}) {
    const output = join(repo, ".git", "scope-output");
    rmSync(output, { force: true });
    const result = execFileSync(process.execPath, [classifier], {
        cwd: repo,
        env: { ...process.env, CI_VALIDATION_BASE: base, GITHUB_OUTPUT: output, ...environment },
        stdio: "pipe",
    });
    return {
        scope: readFileSync(output, "utf8").trim().replace("scope=", ""),
        stdout: result,
        calls: readCalls(join(repo, ".git", "gh-calls")),
    };
}

function createReleasePushFixture(options: {
    parentStepConclusions?: "success" | "skipped";
    mutatePackage?: (value: any) => void;
    ghFails?: boolean;
} = {}) {
    const root = mkdtempSync(join(tmpdir(), "pa-ci-release-scope-"));
    temporaryRepos.push(root);
    const repo = join(root, "repo");
    const tools = join(root, "tools");
    mkdirSync(repo);
    mkdirSync(tools);
    git(repo, ["init", "-b", "master"]);
    git(repo, ["config", "user.name", "Release Test"]);
    git(repo, ["config", "user.email", "release-test@example.invalid"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.hooksPath", "/dev/null"]);
    git(repo, ["remote", "add", "origin", "git@github.com:scope-tests/personal-assistant.git"]);

    const version = "2.12.0";
    const sourcePackage = { name: "personal-assistant", version: "2.11.0",
        dependencies: { semver: "7.7.1" } };
    const sourceManifest = { id: "personal-assistant", version: "2.11.0",
        minAppVersion: "1.11.4", isDesktopOnly: false };
    writeJson(repo, "package.json", sourcePackage);
    writeJson(repo, "package-lock.json", { version: "2.11.0", lockfileVersion: 3,
        packages: { "": sourcePackage, "node_modules/semver": { version: "7.7.1", integrity: "unchanged" } } });
    writeJson(repo, "manifest.json", sourceManifest);
    writeJson(repo, "manifest-beta.json", sourceManifest);
    writeJson(repo, "versions.json", { "2.11.0": "1.11.4" });
    write(repo, "CHANGELOG.md", "## 2.11.0\n");
    write(repo, "NOTICE", "For version 2.11.0\n");
    commit(repo);
    const sourceCommit = git(repo, ["rev-parse", "HEAD"]);

    for (const file of ["package.json", "package-lock.json", "manifest.json", "manifest-beta.json"]) {
        const value = JSON.parse(readFileSync(join(repo, file), "utf8"));
        value.version = version;
        if (value.packages) value.packages[""].version = version;
        writeJson(repo, file, value);
    }
    writeJson(repo, "versions.json", { "2.11.0": "1.11.4", [version]: "1.11.4" });
    write(repo, "CHANGELOG.md", `## ${version}\n`);
    write(repo, "NOTICE", `For version ${version}\n`);
    if (options.mutatePackage) {
        const value = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
        options.mutatePackage(value);
        writeJson(repo, "package.json", value);
    }
    commit(repo, `[release] v${version}, check the CHANGELOG.md for details`);
    git(repo, ["update-ref", "refs/remotes/origin/master", "HEAD"]);

    const conclusion = options.parentStepConclusions ?? "success";
    const run = { id: 77, run_attempt: 1, path: ".github/workflows/ci.yml",
        head_sha: sourceCommit, head_branch: "master", event: "push",
        status: "completed", conclusion: "success", repository: { full_name: "scope-tests/personal-assistant" } };
    const job = { name: "validate", run_id: 77, run_attempt: 1, head_sha: sourceCommit,
        status: "completed", conclusion: "success", steps: requiredSteps.map(name => ({
            name, status: "completed",
            conclusion: conclusion === "skipped" && name !== "Install dependencies" ? "skipped" : "success",
        })) };
    const responses = join(tools, "responses.json");
    writeFileSync(responses, JSON.stringify({
        runs: { total_count: 1, workflow_runs: [run] },
        jobs: { total_count: 1, jobs: [job] },
        run,
    }));
    const calls = join(repo, ".git", "gh-calls");
    const gh = join(tools, "gh");
    writeFileSync(gh, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
if (process.env.RELEASE_SCOPE_GH_FAILS === "1") process.exit(1);
const responses = JSON.parse(fs.readFileSync(${JSON.stringify(responses)}, "utf8"));
const endpoint = args[args.length - 1];
if (endpoint.includes("/workflows/")) process.stdout.write(JSON.stringify(responses.runs));
else if (endpoint.includes("/jobs")) process.stdout.write(JSON.stringify(responses.jobs));
else if (endpoint.includes("/runs/")) process.stdout.write(JSON.stringify(responses.run));
else process.exit(1);
`);
    chmodSync(gh, 0o755);
    return { repo, sourceCommit, classify: (base: string, event: string, ref: string) => classifyDetailed(repo, base, {
        CI_VALIDATION_EVENT: event, CI_VALIDATION_REF: ref,
        RELEASE_SCOPE_GH_FAILS: options.ghFails ? "1" : "",
        PATH: `${tools}:${process.env.PATH ?? ""}`,
    }) };
}

function writeJson(repo: string, file: string, value: unknown): void {
    write(repo, file, `${JSON.stringify(value, null, 2)}\n`);
}

function readCalls(path: string): string[][] {
    return existsSync(path)
        ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string[])
        : [];
}
