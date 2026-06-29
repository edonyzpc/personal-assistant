import { join } from "node:path";

import {
    createFixtureVaultOptions,
    loadEvalCasesFromDirectory,
    parseEvalCase,
    runEvalCase,
    runEvalCases,
    type EvalCase,
} from "../src/pa/eval";

const repoRoot = join(__dirname, "..");
const fixtureVaultRoot = join(repoRoot, "__fixtures__/pa-eval-vault");
const casesDir = join(repoRoot, "__fixtures__/pa-eval/cases");
const negativeCasesDir = join(repoRoot, "__fixtures__/pa-eval/negative-cases");
const runnerOptions = createFixtureVaultOptions(fixtureVaultRoot);

describe("PA eval harness", () => {
    it("parses a minimal retrieval case and rejects cases without assertions", () => {
        const evalCase = parseEvalCase({
            id: "minimal",
            title: "Minimal retrieval case",
            category: "retrieval",
            actual: {
                sourceRefs: [{ path: "projects/pa-agent/source.md" }],
            },
            expected: {
                assertions: [{ type: "must_include_source", path: "projects/pa-agent/source.md" }],
            },
        });

        expect(evalCase.id).toBe("minimal");
        expect(() => parseEvalCase({
            id: "missing-assertions",
            title: "Missing assertions",
            category: "retrieval",
            actual: {},
            expected: { assertions: [] },
        })).toThrow("expected.assertions");
    });

    it("runs all passing fixture cases without provider credentials", () => {
        const cases = loadEvalCasesFromDirectory(casesDir);
        const result = runEvalCases(cases, runnerOptions);

        expect(cases.map((evalCase) => evalCase.id)).toEqual([
            "context-pager-pass",
            "maintenance-apply-pass",
            "maintenance-review-pass",
            "memory-governance-pass",
            "quick-capture-pass",
            "retrieval-source-pass",
            "review-queue-pass",
        ]);
        expect(result.ok).toBe(true);
        expect(result.results).toHaveLength(7);
    });

    it("fails private source leakage fixtures with a readable assertion message", () => {
        const [evalCase] = loadEvalCasesFromDirectory(negativeCasesDir)
            .filter((candidate) => candidate.id === "private-source-leakage");
        const result = runEvalCase(evalCase as EvalCase, runnerOptions);

        expect(result.ok).toBe(false);
        expect(result.failures[0]?.message).toContain("Expected source \"private/secret.md\" to be absent");
    });

    it("fails replay refs that persist raw excerpts", () => {
        const [evalCase] = loadEvalCasesFromDirectory(negativeCasesDir)
            .filter((candidate) => candidate.id === "replay-excerpt-leak");
        const result = runEvalCase(evalCase as EvalCase, runnerOptions);

        expect(result.ok).toBe(false);
        expect(result.failures[0]?.message).toBe("Replay source ref persisted raw excerpt/provider/prompt text");
    });

    it("protects queue canonical type and required-field assertions", () => {
        const allowed = parseEvalCase({
            id: "queue-allowed",
            title: "Queue allowed type",
            category: "review_queue",
            actual: {},
            expected: {
                assertions: [{ type: "queue_type_allowed", itemType: "evidence_insight" }],
            },
        });
        const rejected = parseEvalCase({
            id: "queue-rejected",
            title: "Queue rejected type",
            category: "review_queue",
            actual: {},
            expected: {
                assertions: [{ type: "queue_type_rejected", itemType: "scope_state" }],
            },
        });
        const missingFields = parseEvalCase({
            id: "queue-missing-fields",
            title: "Queue missing fields",
            category: "review_queue",
            actual: {
                queueItems: [{ id: "rq-missing", type: "evidence_insight" }],
            },
            expected: {
                assertions: [{ type: "queue_required_fields_present", itemId: "rq-missing" }],
            },
        });

        expect(runEvalCase(allowed, runnerOptions).ok).toBe(true);
        expect(runEvalCase(rejected, runnerOptions).ok).toBe(true);
        const missingResult = runEvalCase(missingFields, runnerOptions);
        expect(missingResult.ok).toBe(false);
        expect(missingResult.failures[0]?.message).toContain("failed required fields");
    });

    it("fails Context Pager count mismatches", () => {
        const [evalCase] = loadEvalCasesFromDirectory(negativeCasesDir)
            .filter((candidate) => candidate.id === "context-pager-wrong-count");
        const result = runEvalCase(evalCase as EvalCase, runnerOptions);

        expect(result.ok).toBe(false);
        expect(result.failures[0]?.message).toContain("usedSourceCount expected 1, got 0");
    });

    it("fails Quick Capture queue items missing source capture provenance", () => {
        const [evalCase] = loadEvalCasesFromDirectory(negativeCasesDir)
            .filter((candidate) => candidate.id === "quick-capture-missing-capture-id");
        const result = runEvalCase(evalCase as EvalCase, runnerOptions);

        expect(result.ok).toBe(false);
        expect(result.failures[0]?.message).toContain("missing source capture id");
    });

    it("fails forgotten Memory fixtures that retain source refs or raw text", () => {
        const [evalCase] = loadEvalCasesFromDirectory(negativeCasesDir)
            .filter((candidate) => candidate.id === "memory-tombstone-leak");
        const result = runEvalCase(evalCase as EvalCase, runnerOptions);

        expect(result.ok).toBe(false);
        expect(result.failures[0]?.message).toContain("retained source refs or raw text");
    });

    it("fails Maintenance Review hard-delete fixtures", () => {
        const [evalCase] = loadEvalCasesFromDirectory(negativeCasesDir)
            .filter((candidate) => candidate.id === "maintenance-hard-delete");
        const result = runEvalCase(evalCase as EvalCase, runnerOptions);

        expect(result.ok).toBe(false);
        expect(result.failures[0]?.message).toContain("attempts permanent delete");
    });
});
