import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sourceCommit = "a".repeat(40);
const helperUrl = pathToFileURL(join(process.cwd(), "scripts/lib/release-ci-evidence.mjs")).href;
const requiredSteps = ["Install dependencies", "Lint", "Build", "Test", "Audit bundle"];

function fixture() {
    return {
        sourceCommit,
        origin: "git@github.com:example/personal-assistant.git",
        master: `${sourceCommit}\trefs/heads/master\n`,
        run: {
            id: 123, run_attempt: 2, path: ".github/workflows/ci.yml", head_sha: sourceCommit,
            head_branch: "master", event: "push", status: "completed", conclusion: "success",
            repository: { full_name: "example/personal-assistant" },
        },
        jobs: {
            total_count: 1,
            jobs: [{
                name: "validate", run_id: 123, run_attempt: 2, head_sha: sourceCommit,
                status: "completed", conclusion: "success",
                steps: requiredSteps.map(name => ({ name, status: "completed", conclusion: "success" })),
            }],
        },
        runCount: 1,
        finalRunOverrides: {} as Record<string, unknown>,
        failAt: -1,
        malformedAt: -1,
    };
}

type Scenario = ReturnType<typeof fixture>;

function check(input: Scenario) {
    // Only this Node process is real. All git/gh calls go through this strict fake,
    // which fails on any unrecognized command and has no network/process capability.
    const script = `
        import { findVerifiedMasterCi } from ${JSON.stringify(helperUrl)};
        const input = JSON.parse(process.env.RELEASE_CI_TEST_INPUT);
        const calls = [];
        const result = findVerifiedMasterCi({ sourceCommit: input.sourceCommit, capture(command, args) {
            const index = calls.length;
            calls.push([command, args]);
            if (index === input.failAt) throw new Error('timeout/network unavailable');
            if (index === input.malformedAt) return '{invalid JSON';
            const key = [command, ...args].join(' ');
            if (key === 'git remote get-url origin') return input.origin;
            if (key === 'git ls-remote --heads origin refs/heads/master') return input.master;
            if (key === 'gh api --hostname github.com repos/example/personal-assistant/actions/workflows/ci.yml/runs?branch=master&event=push&head_sha=' + input.sourceCommit + '&per_page=1') {
                return JSON.stringify({ total_count: input.runCount, workflow_runs: input.runCount ? [input.run] : [] });
            }
            if (key === 'gh api --hostname github.com repos/example/personal-assistant/actions/runs/123/attempts/2/jobs?per_page=100') return JSON.stringify(input.jobs);
            if (key === 'gh api --hostname github.com repos/example/personal-assistant/actions/runs/123') return JSON.stringify({ ...input.run, ...input.finalRunOverrides });
            throw new Error('Unexpected command: ' + key);
        }});
        process.stdout.write(JSON.stringify({result, calls}));
    `;
    return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
        encoding: "utf8", timeout: 5000,
        env: { ...process.env, GH_REPO: "unrelated/override", GH_HOST: "unrelated.example", RELEASE_CI_TEST_INPUT: JSON.stringify(input) },
    })) as { result: { verified: boolean; reason?: string; runId?: number; url?: string; sourceCommit?: string }; calls: [string, string[]][] };
}

describe("release master CI evidence", () => {
    it.each([
        "git@github.com:example/personal-assistant.git",
        "ssh://git@github.com/example/personal-assistant.git",
        "https://github.com/example/personal-assistant.git",
        "https://github.com/example/personal-assistant/",
    ])("reuses successful full CI for a supported origin (%s)", origin => {
        const input = fixture();
        input.origin = origin;
        const { result, calls } = check(input);
        expect(result).toEqual({ verified: true, runId: 123, url: "https://github.com/example/personal-assistant/actions/runs/123", sourceCommit });
        expect(calls).toHaveLength(5);
        expect(calls[2][1].join(" ")).not.toContain("status=success");
        expect(calls[3][1].join(" ")).toContain("/attempts/2/jobs?per_page=100");
    });

    it.each([
        ["head_sha", "b".repeat(40)], ["path", ".github/workflows/release.yml"],
        ["head_branch", "feature"], ["event", "pull_request"],
        ["status", "in_progress"], ["conclusion", "failure"],
    ])("rejects an incorrect or non-successful latest run: %s=%s", (field, value) => {
        const input = fixture();
        Object.assign(input.run, { [field]: value });
        input.runCount = 2; // An older green run exists, but must never be fetched.
        const { result, calls } = check(input);
        expect(result.verified).toBe(false);
        expect(calls).toHaveLength(3);
    });

    it("rejects a run belonging to another repository", () => {
        const input = fixture();
        input.run.repository.full_name = "other/personal-assistant";
        expect(check(input).result.verified).toBe(false);
    });

    it("accepts the documented job response without a run_attempt field because the endpoint fixes the attempt", () => {
        const input = fixture();
        Reflect.deleteProperty(input.jobs.jobs[0], "run_attempt");
        const { result, calls } = check(input);
        expect(result.verified).toBe(true);
        expect(calls[3][1].join(" ")).toContain("/attempts/2/jobs?per_page=100");
    });

    it.each(requiredSteps)("rejects skipped or missing required step %s", name => {
        const input = fixture();
        const step = input.jobs.jobs[0].steps.find(candidate => candidate.name === name)!;
        step.conclusion = "skipped";
        expect(check(input).result.verified).toBe(false);
        input.jobs.jobs[0].steps = input.jobs.jobs[0].steps.filter(candidate => candidate.name !== name);
        expect(check(input).result.verified).toBe(false);
    });

    it.each([
        ["run_attempt", 1], ["run_id", 122], ["head_sha", "b".repeat(40)],
        ["status", "in_progress"], ["conclusion", "failure"], ["name", "docs"],
    ])("rejects incompatible job evidence: %s=%s", (field, value) => {
        const input = fixture();
        Object.assign(input.jobs.jobs[0], { [field]: value });
        expect(check(input).result.verified).toBe(false);
    });

    it("rejects ambiguous jobs, duplicate steps, and truncated pagination", () => {
        const duplicate = fixture();
        duplicate.jobs.jobs.push(duplicate.jobs.jobs[0]);
        duplicate.jobs.total_count = 2;
        expect(check(duplicate).result.verified).toBe(false);
        const duplicateStep = fixture();
        duplicateStep.jobs.jobs[0].steps.push(duplicateStep.jobs.jobs[0].steps[0]);
        expect(check(duplicateStep).result.verified).toBe(false);
        const truncated = fixture();
        truncated.jobs.total_count = 101;
        expect(check(truncated).result.verified).toBe(false);
        truncated.jobs.total_count = 2;
        expect(check(truncated).result.verified).toBe(false);
    });

    it("falls back when there are no matching CI runs", () => {
        const input = fixture();
        input.runCount = 0;
        expect(check(input).result.verified).toBe(false);
    });

    it.each([0, 1, 2, 3, 4])("falls back on command failure/timeout at lookup %s", failAt => {
        const input = fixture();
        input.failAt = failAt;
        expect(check(input).result.verified).toBe(false);
    });

    it.each([2, 3, 4])("falls back on malformed API JSON at lookup %s", malformedAt => {
        const input = fixture();
        input.malformedAt = malformedAt;
        expect(check(input).result.verified).toBe(false);
    });

    it.each([
        ["run_attempt", 3], ["status", "in_progress"], ["conclusion", "failure"],
        ["head_sha", "b".repeat(40)], ["path", ".github/workflows/release.yml"],
        ["repository", { full_name: "other/repo" }],
    ])("rejects a run changing during evidence lookup: %s", (field, value) => {
        const input = fixture();
        input.finalRunOverrides[field as string] = value;
        expect(check(input).result.verified).toBe(false);
    });

    it.each(["", `${"b".repeat(40)}\trefs/heads/master`, `${sourceCommit}\trefs/heads/other`])("rejects unavailable or changed live master (%s)", master => {
        const input = fixture();
        input.master = master;
        const { result, calls } = check(input);
        expect(result.verified).toBe(false);
        expect(calls.every(([command]) => command === "git")).toBe(true);
    });

    it.each(["../local", "https://git.example/owner/repo.git", "https://github.com.evil/owner/repo", "https://token@github.com/example/personal-assistant"])("rejects unsupported origin %s without API access", origin => {
        const input = fixture();
        input.origin = origin;
        const { result, calls } = check(input);
        expect(result.verified).toBe(false);
        expect(calls).toHaveLength(1);
    });

    it("rejects invalid source input without executing a command", () => {
        const input = fixture();
        input.sourceCommit = "HEAD; echo invalid";
        const { result, calls } = check(input);
        expect(result.verified).toBe(false);
        expect(calls).toHaveLength(0);
    });
});
