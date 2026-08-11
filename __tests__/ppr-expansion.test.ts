import { describe, expect, it, jest } from "@jest/globals";

import {
    allocateGraphCandidates,
    buildGraphLaneWorksets,
    collectCompleteLocalCandidatePaths,
    collectSuccessfulSeedEvidence,
    joinRankedGraphWorksets,
    selectDistinctPprSeeds,
    shouldActivatePpr,
    type RankedGraphPath,
} from "../src/graph/ppr-expansion";
import {
    buildBoundaryStateGraph,
    type GraphBoundarySnapshot,
    type GraphWorkLimits,
} from "../src/graph/personalized-pagerank";

const LIMITS: GraphWorkLimits = {
    maxSnapshotNodes: 100,
    maxSnapshotEdges: 200,
    maxSnapshotBytes: 100_000,
    maxCanonicalNodes: 100,
    maxCanonicalEdges: 200,
    maxLiftedStates: 200,
    maxLegalTransitions: 500,
    maxLocalCandidatePaths: 100,
    maxProjectedSolverOperations: 1_000_000,
    maxProjectedBytes: 1_000_000,
    absoluteDeadlineMs: 10_000,
};

async function graph(links: Record<string, string[]>, seeds: string[]) {
    const paths = new Set([...Object.keys(links), ...Object.values(links).flat(), ...seeds]);
    const snapshot: GraphBoundarySnapshot = {
        epoch: "e",
        topologyFingerprint: "f",
        resolvedLinks: new Map(Object.entries(links).map(([path, targets]) => [path, new Set(targets)])),
        pathClasses: new Map([...paths].map((path) => [path, "allowed_markdown" as const])),
        snapshotNodes: paths.size,
        snapshotEdges: Object.values(links).reduce((sum, targets) => sum + new Set(targets).size, 0),
        snapshotBytes: 100,
    };
    const built = await buildBoundaryStateGraph(snapshot, seeds, new Set(seeds), LIMITS, { now: () => 0 });
    if (!built.ok) throw new Error(built.reason);
    return built.graph;
}

describe("PPR lane aggregation and allocation", () => {
    it("selects at most three distinct note seeds", () => {
        expect(selectDistinctPprSeeds(["a.md", "a.md", "b.md", "c.md", "d.md"]))
            .toEqual(["a.md", "b.md", "c.md"]);
    });

    it("collects complete Local cooperatively and drops the whole lane on overflow", async () => {
        const localSnapshot: GraphBoundarySnapshot = {
            epoch: "e",
            topologyFingerprint: "f",
            pathClasses: new Map([
                ["seed.md", "allowed_markdown"],
                ["incoming.md", "allowed_markdown"],
                ["outgoing.md", "allowed_markdown"],
                ["direct.md", "allowed_markdown"],
                ["hidden.md", "opaque_excluded_markdown"],
            ]),
            resolvedLinks: new Map([
                ["seed.md", new Set(["outgoing.md", "direct.md", "hidden.md"])],
                ["incoming.md", new Set(["seed.md"])],
            ]),
            snapshotNodes: 5,
            snapshotEdges: 4,
            snapshotBytes: 100,
        };
        const complete = await collectCompleteLocalCandidatePaths(
            localSnapshot,
            ["seed.md"],
            new Set(["seed.md", "direct.md"]),
            { maxLocalCandidatePaths: 2, absoluteDeadlineMs: 10_000 },
            { now: () => 0 },
        );
        expect(complete.ok).toBe(true);
        if (complete.ok) expect([...complete.paths].sort()).toEqual(["incoming.md", "outgoing.md"]);

        const overflow = await collectCompleteLocalCandidatePaths(
            localSnapshot,
            ["seed.md"],
            new Set(["seed.md", "direct.md"]),
            { maxLocalCandidatePaths: 1, absoluteDeadlineMs: 10_000 },
            { now: () => 0 },
        );
        expect(overflow).toMatchObject({ ok: false, reason: "local_budget", localCandidatePaths: 2 });
        expect("paths" in overflow).toBe(false);
    });

    it("aborts both parallel preflight branches while their macrotasks are throttled", async () => {
        const preflightSnapshot: GraphBoundarySnapshot = {
            epoch: "e",
            topologyFingerprint: "f",
            pathClasses: new Map([
                ["seed.md", "allowed_markdown"],
                ["target.md", "allowed_markdown"],
            ]),
            resolvedLinks: new Map([["seed.md", new Set(["target.md"])]]),
            snapshotNodes: 2,
            snapshotEdges: 1,
            snapshotBytes: 100,
        };
        const controller = new AbortController();
        const addListener = jest.spyOn(controller.signal, "addEventListener");
        const removeListener = jest.spyOn(controller.signal, "removeEventListener");
        const lateRejectors: Array<(error: Error) => void> = [];
        let startedCount = 0;
        let markBothStarted!: () => void;
        const bothStarted = new Promise<void>((resolve) => {
            markBothStarted = resolve;
        });
        const stalledYield = () => {
            startedCount += 1;
            if (startedCount === 2) markBothStarted();
            return new Promise<void>((_resolve, reject) => lateRejectors.push(reject));
        };
        let nowCalls = 0;
        const now = () => {
            nowCalls += 1;
            return Date.now();
        };
        const absoluteDeadlineMs = Date.now() + 60_000;
        const resultsPromise = Promise.all([
            collectCompleteLocalCandidatePaths(
                preflightSnapshot,
                ["seed.md"],
                new Set(["seed.md"]),
                { maxLocalCandidatePaths: 10, absoluteDeadlineMs, checkpointEvery: 1 },
                { signal: controller.signal, now, yieldMacrotask: stalledYield },
            ),
            buildBoundaryStateGraph(
                preflightSnapshot,
                ["seed.md"],
                new Set(["seed.md"]),
                { ...LIMITS, absoluteDeadlineMs },
                { signal: controller.signal, now, checkpointEvery: 1, yieldMacrotask: stalledYield },
            ),
        ]);

        await bothStarted;
        controller.abort();
        const [localResult, graphResult] = await resultsPromise;
        expect(localResult).toMatchObject({ ok: false, reason: "aborted" });
        expect(graphResult).toMatchObject({ ok: false, reason: "aborted" });
        expect(addListener).toHaveBeenCalledTimes(2);
        expect(removeListener).toHaveBeenCalledTimes(2);
        const callsAtTerminal = nowCalls;

        for (const reject of lateRejectors) reject(new Error("late preflight yield"));
        await Promise.resolve();
        await Promise.resolve();
        expect(nowCalls).toBe(callsAtTerminal);
    });

    it("deadlines both parallel preflight branches while their macrotasks never settle", async () => {
        const preflightSnapshot: GraphBoundarySnapshot = {
            epoch: "e",
            topologyFingerprint: "f",
            pathClasses: new Map([
                ["seed.md", "allowed_markdown"],
                ["target.md", "allowed_markdown"],
            ]),
            resolvedLinks: new Map([["seed.md", new Set(["target.md"])]]),
            snapshotNodes: 2,
            snapshotEdges: 1,
            snapshotBytes: 100,
        };
        const controller = new AbortController();
        const addListener = jest.spyOn(controller.signal, "addEventListener");
        const removeListener = jest.spyOn(controller.signal, "removeEventListener");
        let startedCount = 0;
        let markBothStarted!: () => void;
        const bothStarted = new Promise<void>((resolve) => {
            markBothStarted = resolve;
        });
        const stalledYield = () => {
            startedCount += 1;
            if (startedCount === 2) markBothStarted();
            return new Promise<void>(() => undefined);
        };
        const absoluteDeadlineMs = Date.now() + 15;
        const [localResult, graphResult] = await Promise.all([
            collectCompleteLocalCandidatePaths(
                preflightSnapshot,
                ["seed.md"],
                new Set(["seed.md"]),
                { maxLocalCandidatePaths: 10, absoluteDeadlineMs, checkpointEvery: 1 },
                { signal: controller.signal, yieldMacrotask: stalledYield },
            ),
            buildBoundaryStateGraph(
                preflightSnapshot,
                ["seed.md"],
                new Set(["seed.md"]),
                { ...LIMITS, absoluteDeadlineMs },
                { signal: controller.signal, checkpointEvery: 1, yieldMacrotask: stalledYield },
            ),
            bothStarted,
        ]);

        expect(localResult).toMatchObject({ ok: false, reason: "deadline" });
        expect(graphResult).toMatchObject({ ok: false, reason: "deadline" });
        expect(addListener).toHaveBeenCalledTimes(2);
        expect(removeListener).toHaveBeenCalledTimes(2);
    });

    it("activates for a deeper candidate or a Local path shared by two seeds", async () => {
        const deep = await graph({ "a.md": ["b.md"], "b.md": ["c.md"] }, ["a.md"]);
        expect(shouldActivatePpr(deep, ["a.md"], new Set(["a.md"]))).toBe(true);

        const star = await graph({ "a.md": ["x.md"] }, ["a.md"]);
        expect(shouldActivatePpr(star, ["a.md"], new Set(["a.md"]))).toBe(false);

        const shared = await graph({ "a.md": ["x.md"], "b.md": ["x.md"] }, ["a.md", "b.md"]);
        expect(shouldActivatePpr(shared, ["a.md", "b.md"], new Set(["a.md", "b.md"]))).toBe(true);
    });

    it("uses mean breadth and the second-largest convergence score without per-seed truncation", () => {
        const worksets = buildGraphLaneWorksets([
            { seedPath: "s1.md", scores: new Map([["deep.md", 0.3], ["shared.md", 0.2], ["local.md", 0.4]]), errorBound: 0.01 },
            { seedPath: "s2.md", scores: new Map([["deep.md", 0.1], ["shared.md", 0.25], ["local.md", 0.2]]), errorBound: 0.02 },
            { seedPath: "s3.md", scores: new Map([["deep.md", 0], ["shared.md", 0.05], ["local.md", 0.1]]), errorBound: 0.015 },
        ], new Set(["s1.md", "s2.md", "s3.md"]), new Set(["local.md"]), {
            deepBreadthTopN: 12,
            convergenceTopN: 12,
        });

        const deep = worksets.deepBreadth.find((entry) => entry.path === "deep.md");
        expect(deep?.breadthScore).toBeCloseTo(0.4 / 3);
        const shared = worksets.convergence.find((entry) => entry.path === "shared.md");
        expect(shared?.convergenceScore).toBeCloseTo(0.2);
        expect(worksets.deepBreadth.some((entry) => entry.path === "local.md")).toBe(false);
        expect(worksets.convergence.some((entry) => entry.path === "local.md")).toBe(true);
    });

    it("drops an over-budget Local lane without relabeling it as Deep or suppressing Convergence", () => {
        const semanticLocalPaths = new Set(["shared.md", "single-support.md"]);
        const worksets = buildGraphLaneWorksets([
            {
                seedPath: "s1.md",
                scores: new Map([["shared.md", 0.3], ["single-support.md", 0.4]]),
                errorBound: 0.01,
            },
            {
                seedPath: "s2.md",
                scores: new Map([["shared.md", 0.25]]),
                errorBound: 0.01,
            },
        ], new Set(["s1.md", "s2.md"]), semanticLocalPaths, {
            deepBreadthTopN: 12,
            convergenceTopN: 12,
        }, new Set(), new Set());

        expect(worksets.localPaths).toEqual([]);
        expect(worksets.deepBreadth).toEqual([]);
        expect(worksets.convergence.map((entry) => entry.path)).toEqual(["shared.md"]);
        expect(worksets.union).toEqual([expect.objectContaining({
            path: "shared.md",
            memberships: new Set(["convergence"]),
        })]);
    });

    it("drops all PPR lanes when any seed did not converge", () => {
        expect(collectSuccessfulSeedEvidence(["a.md", "b.md"], [
            { converged: true, scores: new Map(), iteration: 1, errorBound: 0 },
            { converged: false, reason: "iteration_cap" },
        ])).toBeNull();
    });

    it("nominates one per non-empty lane, dedupes overlap without replacement debt, then fills by cosine", () => {
        const entries: RankedGraphPath[] = [
            { path: "overlap.md", memberships: new Set(["local", "convergence"]), cosine: 0.8, convergenceScore: 0.5 },
            { path: "deep.md", memberships: new Set(["deep_breadth"]), cosine: 0.5, breadthScore: 0.9 },
            { path: "local-2.md", memberships: new Set(["local"]), cosine: 0.7 },
            { path: "fill.md", memberships: new Set(["deep_breadth"]), cosine: 0.65, breadthScore: 0.1 },
            { path: "direct.md", memberships: new Set(["convergence"]), cosine: 0.99, convergenceScore: 1 },
        ];
        const selected = allocateGraphCandidates(entries, new Set(["direct.md"]), {
            cosineThreshold: 0.3,
            maxGraphCandidates: 3,
        });
        expect(selected.map((entry) => entry.path)).toEqual(["overlap.md", "local-2.md", "deep.md"]);
        expect(selected).toHaveLength(3);
    });

    it("applies provisional Local Top-12 only after every admitted Local path has a cosine", () => {
        const localPaths = Array.from({ length: 15 }, (_, index) => `local-${index.toString().padStart(2, "0")}.md`);
        const worksets = buildGraphLaneWorksets([], new Set(), new Set(localPaths), {
            deepBreadthTopN: 12,
            convergenceTopN: 12,
        });
        const cosine = new Map(localPaths.map((path, index) => [path, index / 100]));
        const ranked = joinRankedGraphWorksets(worksets, cosine);
        expect(ranked).toHaveLength(12);
        expect(ranked[0].path).toBe("local-14.md");
        expect(ranked.some((entry) => entry.path === "local-00.md")).toBe(false);
    });

    it("removes exact repeats before lane Top-12, nomination, and graph-6 fill", () => {
        const deepPaths = Array.from({ length: 13 }, (_, index) => `deep-${index.toString().padStart(2, "0")}.md`);
        const localPaths = Array.from({ length: 13 }, (_, index) => `local-${index.toString().padStart(2, "0")}.md`);
        const excluded = new Set(["deep-00.md", "local-12.md"]);
        const worksets = buildGraphLaneWorksets([
            {
                seedPath: "seed.md",
                scores: new Map(deepPaths.map((path, index) => [path, 1 - index / 100])),
                errorBound: 0,
            },
        ], new Set(["seed.md"]), new Set(localPaths), {
            deepBreadthTopN: 12,
            convergenceTopN: 12,
        }, excluded);
        expect(worksets.deepBreadth).toHaveLength(12);
        expect(worksets.deepBreadth.some((entry) => entry.path === "deep-00.md")).toBe(false);
        expect(worksets.deepBreadth.some((entry) => entry.path === "deep-12.md")).toBe(true);

        const cosine = new Map([
            ...deepPaths.map((path, index) => [path, 0.6 - index / 100] as const),
            ...localPaths.map((path, index) => [path, 0.7 + index / 100] as const),
        ]);
        const joined = joinRankedGraphWorksets(worksets, cosine, { localTopN: 12 }, excluded);
        expect(joined.some((entry) => excluded.has(entry.path))).toBe(false);
        expect(joined.filter((entry) => entry.memberships.has("local"))).toHaveLength(12);
        const allocated = allocateGraphCandidates(joined, new Set(), {
            cosineThreshold: 0,
            maxGraphCandidates: 6,
            excludedCandidatePaths: excluded,
        });
        expect(allocated).toHaveLength(6);
        expect(allocated.some((entry) => excluded.has(entry.path))).toBe(false);
    });
});
