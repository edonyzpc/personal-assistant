import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(__dirname, "../scripts/pa-agent-runtime-eval-runner.js");

describe("B-149 offline runtime eval CLI", () => {
    it("writes actual request/output evidence and keeps expected scope gaps explicit", () => {
        const directory = mkdtempSync(join(tmpdir(), "b149-eval-script-test-"));
        try {
            const output = join(directory, "report.json");
            const processResult = spawnSync(process.execPath, [script, "--mode", "offline", "--output", output], {
                cwd: join(__dirname, ".."), encoding: "utf8",
            });
            expect(processResult.status).toBe(0);
            const summary = JSON.parse(processResult.stdout.trim());
            const report = JSON.parse(readFileSync(output, "utf8"));
            expect(summary).toMatchObject({ status: "recorded", cases: 12,
                runtimeTerminals: { completed: 11, incomplete: 0, cancelled: 1, failed: 0 },
                expectedGaps: ["E-02", "E-03", "E-08"], fixedWebRequests: 3 });
            expect(summary.modelPhysicalRequests).toBeGreaterThan(0);
            expect(report.requests[0].body.messages.length).toBeGreaterThan(0);
            expect(report.requests[0]).toMatchObject({ association: "unknown", attemptId: null, purpose: null });
            expect(report.actual.find((item: { caseId: string }) => item.caseId === "E-01").runtimeRunId).toBeTruthy();
            expect(report.sourceIdentity.executionSourceSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(report.sourceIdentity).toMatchObject({ gitHead: expect.stringMatching(/^[a-f0-9]{40}$/),
                productionRuntimeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                aiUtilsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                budgetUsageSourceSha256: {
                    'src/ai-services/context/PaAgentContextSummarizer.ts': expect.stringMatching(/^[a-f0-9]{64}$/),
                    'src/ai-services/agent-usage-ledger.ts': expect.stringMatching(/^[a-f0-9]{64}$/),
                    'src/ai-services/pa-agent-prompts.ts': expect.stringMatching(/^[a-f0-9]{64}$/),
                },
                packageLockSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                dependencies: { "@langchain/core": expect.any(String), "@langchain/openai": expect.any(String) } });
            const identityPaths = [
                "src/pa/eval/index.ts",
                "src/pa/eval/runtime-cases.ts",
                "__tests__/pa-agent-runtime-eval-runner-script.test.ts",
            ];
            const gitStatus = spawnSync("git", [
                "status", "--porcelain=v1", "--untracked-files=all", "--", ...identityPaths,
            ], { cwd: join(__dirname, ".."), encoding: "utf8" });
            expect(gitStatus.status).toBe(0);
            const expectedDirtyInputs = gitStatus.stdout.split(/\r?\n/).filter(Boolean)
                .map((line) => ({ state: line.slice(0, 2), path: line.slice(3) }));
            expect(report.sourceIdentity.dirtyInputs.filter((input: { path: string }) =>
                identityPaths.includes(input.path))).toEqual(expectedDirtyInputs);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    });

    it("distinguishes an unavailable live provider without sending a request", () => {
        const result = spawnSync(process.execPath, [script, "--mode", "live"], { encoding: "utf8" });
        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({ status: "provider_unavailable" });
    });

    it("stops the shared physical request budget before another SDK fetch", () => {
        const directory = mkdtempSync(join(tmpdir(), "b149-eval-cap-test-"));
        try {
            const output = join(directory, "report.json");
            const result = spawnSync(process.execPath, [script, "--mode", "offline", "--max-requests", "1",
                "--output", output], { encoding: "utf8" });
            expect(result.status).toBe(1);
            expect(JSON.parse(result.stdout)).toMatchObject({ status: "failed" });
            const report = JSON.parse(readFileSync(output, "utf8"));
            expect(report.physicalRequestsAttempted).toBe(1);
            expect(report.actual.some((item: { status: string }) => item.status === "failed")).toBe(true);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    });
});
