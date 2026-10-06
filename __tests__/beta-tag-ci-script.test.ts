import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(process.cwd(), "scripts/check-beta-tag-ci.mjs");
const temporaryDirectories: string[] = [];
const betaVersion = "2.10.0-beta.19";
const requiredSteps = ["Install dependencies", "Lint", "Build", "Test", "Audit bundle"];
type Evidence = "valid" | "missing" | "failed" | "docs-only" | "skipped" | "race" | "network" | "malformed";

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(repo: string, args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
}

function createFixture(options: {
    tag?: string;
    evidence?: Evidence;
    advanceMaster?: boolean;
    mutate?: (repo: string) => void;
    wrongSubject?: boolean;
} = {}) {
    const root = mkdtempSync(join(tmpdir(), "pa-beta-tag-ci-"));
    temporaryDirectories.push(root);
    const repo = join(root, "repo");
    const tools = join(root, "tools");
    mkdirSync(repo);
    mkdirSync(tools);
    const writeJson = (file: string, data: unknown) => writeFileSync(join(repo, file), JSON.stringify(data, null, 2));
    git(repo, ["init", "--initial-branch=master"]);
    git(repo, ["config", "user.name", "Release Test"]);
    git(repo, ["config", "user.email", "release-test@example.invalid"]);
    git(repo, ["config", "commit.gpgSign", "false"]);
    git(repo, ["config", "tag.gpgSign", "false"]);
    git(repo, ["remote", "add", "origin", "git@github.com:release-tests/personal-assistant.git"]);
    const initialPackage = { name: "personal-assistant", version: "2.9.2",
        scripts: { build: "node build.mjs" }, engines: { node: ">=22 <23" }, dependencies: { semver: "7.7.1" } };
    const initialManifest = { id: "personal-assistant", version: "2.9.2", minAppVersion: "1.11.4", isDesktopOnly: false };
    writeJson("package.json", initialPackage);
    writeJson("package-lock.json", { version: "2.9.2", lockfileVersion: 3,
        packages: { "": initialPackage, "node_modules/semver": { version: "7.7.1", integrity: "unchanged" } } });
    writeJson("manifest.json", initialManifest);
    writeJson("manifest-beta.json", initialManifest);
    writeJson("versions.json", { "2.9.2": "1.11.4" });
    writeFileSync(join(repo, "CHANGELOG.md"), "Initial release\n");
    writeFileSync(join(repo, "NOTICE"), "For version 2.9.2\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "feat: verified master source"]);
    const sourceCommit = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["update-ref", "refs/remotes/origin/master", sourceCommit]);

    const tag = options.tag ?? betaVersion;
    if (tag.includes("-")) git(repo, ["switch", "-c", `beta/${tag}`]);
    for (const file of ["package.json", "package-lock.json", "manifest.json", "manifest-beta.json"]) {
        const data = JSON.parse(readFileSync(join(repo, file), "utf8"));
        data.version = tag;
        if (data.packages) data.packages[""].version = tag;
        writeJson(file, data);
    }
    writeJson("versions.json", { "2.9.2": "1.11.4", [tag]: "1.11.4" });
    writeFileSync(join(repo, "CHANGELOG.md"), `## ${tag}\nGenerated changelog\n`);
    writeFileSync(join(repo, "NOTICE"), `For version ${tag}\n`);
    options.mutate?.(repo);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", options.wrongSubject ? "custom packaging" : `[release] v${tag}, check the CHANGELOG.md for details`]);
    const releaseCommit = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["tag", "-a", tag, "-m", tag]);
    if (options.advanceMaster) {
        git(repo, ["switch", "master"]);
        writeFileSync(join(repo, "next-source.ts"), "// Later accepted source\n");
        git(repo, ["add", "."]);
        git(repo, ["commit", "-m", "feat: advance master"]);
        git(repo, ["update-ref", "refs/remotes/origin/master", "HEAD"]);
        if (tag.includes("-")) git(repo, ["switch", `beta/${tag}`]);
    }

    const evidence = options.evidence ?? "valid";
    const run = { id: 42, run_attempt: 1, path: ".github/workflows/ci.yml",
        head_sha: sourceCommit, head_branch: "master", event: "push", status: "completed",
        conclusion: evidence === "failed" ? "failure" : "success", repository: { full_name: "release-tests/personal-assistant" } };
    const job = { name: evidence === "docs-only" ? "docs" : "validate", run_id: 42, head_sha: sourceCommit,
        status: "completed", conclusion: "success", steps: requiredSteps.map(name => ({
            name, status: "completed", conclusion: evidence === "skipped" && name === "Test" ? "skipped" : "success",
        })) };
    writeFileSync(join(tools, "responses.json"), JSON.stringify({
        runs: { total_count: evidence === "missing" ? 0 : 1, workflow_runs: evidence === "missing" ? [] : [run] },
        jobs: { total_count: 1, jobs: [job] },
        run: { ...run, run_attempt: evidence === "race" ? 2 : 1 },
    }));
    const callsFile = join(tools, "calls.jsonl");
    const executable = join(tools, "gh");
    writeFileSync(executable, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BETA_CI_CALLS, JSON.stringify(args) + "\\n");
if (process.env.BETA_CI_EVIDENCE === "network") {
    process.stderr.write("Sensitive transport diagnostic must not be printed");
    process.exit(1);
}
if (process.env.BETA_CI_EVIDENCE === "malformed") { process.stdout.write("{broken JSON"); process.exit(0); }
const responses = JSON.parse(fs.readFileSync(process.env.BETA_CI_RESPONSES, "utf8"));
const endpoint = args[args.length - 1];
const expectedRoot = "repos/release-tests/personal-assistant/actions/";
if (args[0] !== "api" || args[1] !== "--hostname" || args[2] !== "github.com" || !endpoint.startsWith(expectedRoot)) process.exit(1);
if (endpoint.includes("/workflows/")) process.stdout.write(JSON.stringify(responses.runs));
else if (endpoint === expectedRoot + "runs/42/attempts/1/jobs?per_page=100") process.stdout.write(JSON.stringify(responses.jobs));
else if (endpoint === expectedRoot + "runs/42") process.stdout.write(JSON.stringify(responses.run));
else process.exit(1);
`);
    chmodSync(executable, 0o755);
    const outputsFile = join(root, "outputs");
    const check = (environment: Record<string, string> = {}) => {
        writeFileSync(outputsFile, "");
        const result = spawnSync(process.execPath, [script], {
            cwd: repo, encoding: "utf8", timeout: 15000,
            env: { ...process.env, PATH: `${tools}:${process.env.PATH ?? ""}`,
                GITHUB_REF_NAME: tag, GITHUB_SHA: releaseCommit, GITHUB_OUTPUT: outputsFile,
                BETA_CI_RESPONSES: join(tools, "responses.json"), BETA_CI_CALLS: callsFile,
                BETA_CI_EVIDENCE: evidence, ...environment },
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const outputs = JSON.parse(result.stdout) as { reuse_source_ci: string; reason: string; ci_url: string };
        expect(readFileSync(outputsFile, "utf8")).toBe(Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
        const calls = existsSync(callsFile)
            ? readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string[])
            : [];
        return { outputs, calls };
    };
    return { repo, tag, sourceCommit, releaseCommit, check };
}

function changeJson(repo: string, file: string, change: (value: any) => void): void {
    const value = JSON.parse(readFileSync(join(repo, file), "utf8"));
    change(value);
    writeFileSync(join(repo, file), JSON.stringify(value, null, 2));
}

describe("release tag source CI gate", () => {
    it.each(["2.10.0", betaVersion])("reuses exact parent CI for %s through real Git ancestry even after master advances", tag => {
        const fixture = createFixture({ tag, advanceMaster: true });
        const { outputs, calls } = fixture.check();
        expect(outputs).toMatchObject({ reuse_source_ci: "true", ci_url: "https://github.com/release-tests/personal-assistant/actions/runs/42" });
        expect(calls).toHaveLength(3);
        expect(calls[0][3]).toContain(`head_sha=${fixture.sourceCommit}&per_page=1`);
        expect(calls[1][3]).toContain("/attempts/1/jobs");
    });

    it.each(["2.10.0-rc.1", "2.10.0-alpha.2", "v2.10.0-beta.19"])("keeps unsupported channel %s on full validation without consulting CI", tag => {
        const { outputs, calls } = createFixture({ tag }).check();
        expect(outputs.reuse_source_ci).toBe("false");
        expect(calls).toEqual([]);
    });

    it("rejects hand-built packaging that downgrades the parent's version", () => {
        const { outputs, calls } = createFixture({ tag: "2.9.1-beta.1" }).check();
        expect(outputs.reuse_source_ci).toBe("false");
        expect(calls).toEqual([]);
    });

    it.each<Evidence>(["missing", "failed", "docs-only", "skipped", "race", "network", "malformed"])(
        "falls back on %s CI evidence", evidence => {
            const { outputs } = createFixture({ evidence }).check();
            expect(outputs).toMatchObject({ reuse_source_ci: "false", ci_url: "" });
            expect(outputs.reason).not.toContain("Sensitive");
        },
    );

    it.each([
        ["package script", "package.json", (value: any) => { value.scripts.build = "unsafe-build"; }],
        ["dependency", "package.json", (value: any) => { value.dependencies.semver = "8.0.0"; }],
        ["engine", "package.json", (value: any) => { value.engines.node = ">=23"; }],
        ["lock dependency", "package-lock.json", (value: any) => { value.packages["node_modules/semver"].version = "8.0.0"; }],
        ["manifest platform", "manifest.json", (value: any) => { value.isDesktopOnly = true; }],
        ["beta plugin identity", "manifest-beta.json", (value: any) => { value.id = "other"; }],
        ["old version entry", "versions.json", (value: any) => { value["2.9.2"] = "1.12.0"; }],
        ["extra version entry", "versions.json", (value: any) => { value["2.10.1"] = "1.11.4"; }],
        ["incorrect minimum app version", "versions.json", (value: any) => { value[betaVersion] = "1.12.0"; }],
        ["wrong generated version", "package-lock.json", (value: any) => { value.packages[""].version = "2.9.2"; }],
    ] as const)("rejects semantic metadata changes: %s", (_name, file, change) => {
        const fixture = createFixture({ mutate: repo => changeJson(repo, file, change) });
        const { outputs, calls } = fixture.check();
        expect(outputs.reuse_source_ci).toBe("false");
        expect(calls).toEqual([]);
    });

    it("requires the generated subject and all seven packaging files", () => {
        expect(createFixture({ wrongSubject: true }).check().outputs.reuse_source_ci).toBe("false");
        expect(createFixture({ mutate: repo => writeFileSync(join(repo, "NOTICE"), "For version 2.9.2\n") })
            .check().outputs.reuse_source_ci).toBe("false");
        expect(createFixture({ mutate: repo => writeFileSync(join(repo, "new-source.ts"), "// unexpected source") })
            .check().outputs.reuse_source_ci).toBe("false");
    });

    it("rejects malformed JSON, a different tag commit, and a parent absent from fetched master history", () => {
        expect(createFixture({ mutate: repo => writeFileSync(join(repo, "manifest.json"), "{invalid") })
            .check().outputs.reuse_source_ci).toBe("false");
        const wrongCommit = createFixture();
        expect(wrongCommit.check({ GITHUB_SHA: wrongCommit.sourceCommit }).outputs.reuse_source_ci).toBe("false");
        const noHistory = createFixture();
        git(noHistory.repo, ["update-ref", "-d", "refs/remotes/origin/master"]);
        expect(noHistory.check().outputs.reuse_source_ci).toBe("false");
    });

    it("rejects a tag on a merge rather than a single-parent packaging commit", () => {
        const fixture = createFixture();
        const tree = git(fixture.repo, ["rev-parse", `${fixture.releaseCommit}^{tree}`]);
        const merge = git(fixture.repo, ["commit-tree", tree, "-p", fixture.releaseCommit, "-p", fixture.sourceCommit,
            "-m", `[release] v${fixture.tag}, check the CHANGELOG.md for details`]);
        git(fixture.repo, ["tag", "-f", "-a", fixture.tag, merge, "-m", fixture.tag]);
        const { outputs, calls } = fixture.check({ GITHUB_SHA: merge });
        expect(outputs.reuse_source_ci).toBe("false");
        expect(calls).toEqual([]);
    });
});
