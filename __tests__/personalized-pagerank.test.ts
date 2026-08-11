import { describe, expect, it } from "@jest/globals";

import {
    buildBoundaryStateGraph,
    getPprStateKey,
    solvePersonalizedPageRank,
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

function snapshot(
    classes: Record<string, "allowed_markdown" | "opaque_excluded_markdown" | "blocked">,
    links: Record<string, string[]>,
): GraphBoundarySnapshot {
    return {
        epoch: "epoch-1",
        topologyFingerprint: "topology-1",
        pathClasses: new Map(Object.entries(classes)),
        resolvedLinks: new Map(Object.entries(links).map(([path, targets]) => [path, new Set(targets)])),
        snapshotNodes: Object.keys(classes).length,
        snapshotEdges: Object.values(links).reduce((sum, targets) => sum + new Set(targets).size, 0),
        snapshotBytes: 1024,
    };
}

describe("Boundary-state Personalized PageRank", () => {
    it("solves a complete fixed-alpha graph with a certified error bound", async () => {
        const built = await buildBoundaryStateGraph(snapshot(
            { "a.md": "allowed_markdown", "b.md": "allowed_markdown", "c.md": "allowed_markdown" },
            { "a.md": ["b.md"], "b.md": ["c.md"] },
        ), ["a.md"], new Set(["a.md"]), LIMITS, { now: () => 0 });
        expect(built.ok).toBe(true);
        if (!built.ok) return;

        const result = await solvePersonalizedPageRank(built.graph, "a.md", { now: () => 0 });
        expect(result.converged).toBe(true);
        if (!result.converged) return;
        expect(result.errorBound).toBeLessThanOrEqual(0.001);
        expect(result.iteration).toBeLessThanOrEqual(50);
        expect(result.scores.get("c.md")).toBeGreaterThan(0);
        const mass = [...result.scores.values()].reduce((sum, value) => sum + value, 0);
        expect(mass).toBeCloseTo(1, 8);
    });

    it("permits exactly one opaque bridge and never exposes opaque paths as candidates", async () => {
        const built = await buildBoundaryStateGraph(snapshot(
            {
                "a.md": "allowed_markdown",
                "hidden.md": "opaque_excluded_markdown",
                "hidden-2.md": "opaque_excluded_markdown",
                "c.md": "allowed_markdown",
            },
            {
                "a.md": ["hidden.md"],
                "hidden.md": ["c.md", "hidden-2.md"],
                "c.md": ["hidden-2.md"],
            },
        ), ["a.md"], new Set(["a.md"]), LIMITS, { now: () => 0 });
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        expect(built.graph.states.has(getPprStateKey("hidden.md", true))).toBe(true);
        expect(built.graph.states.has(getPprStateKey("hidden-2.md", true))).toBe(false);
        expect(built.graph.states.has(getPprStateKey("c.md", true))).toBe(true);
        expect(built.graph.allowedStateKeysByPath.has("hidden.md")).toBe(false);
        expect(built.graph.degrees.get("hidden.md")).toBe(3);
        expect(built.graph.estimate.canonicalEdges).toBe(4);
    });

    it("uses binary mutual multiplicity and counts a self-link as degree two", async () => {
        const built = await buildBoundaryStateGraph(snapshot(
            { "a.md": "allowed_markdown", "b.md": "allowed_markdown" },
            { "a.md": ["a.md", "b.md", "b.md"], "b.md": ["a.md"] },
        ), ["a.md"], new Set(["a.md"]), LIMITS, { now: () => 0 });
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        expect(built.graph.degrees.get("a.md")).toBe(4);
        expect(built.graph.degrees.get("b.md")).toBe(2);
    });

    it("routes dangling follow mass back to the seed", async () => {
        const built = await buildBoundaryStateGraph(snapshot(
            { "a.md": "allowed_markdown" },
            {},
        ), ["a.md"], new Set(["a.md"]), LIMITS, { now: () => 0 });
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const result = await solvePersonalizedPageRank(built.graph, "a.md", { now: () => 0 });
        expect(result).toMatchObject({ converged: true, iteration: 1, errorBound: 0 });
        if (result.converged) expect(result.scores.get("a.md")).toBeCloseTo(1);
    });

    it("rejects a complete over-budget graph without returning a prefix", async () => {
        const result = await buildBoundaryStateGraph(snapshot(
            { "a.md": "allowed_markdown", "b.md": "allowed_markdown" },
            { "a.md": ["b.md"] },
        ), ["a.md"], new Set(["a.md"]), { ...LIMITS, maxCanonicalNodes: 1 }, { now: () => 0 });
        expect(result).toMatchObject({ ok: false, reason: "graph_budget" });
    });

    it("preflights solver work across both lifted states and legal transitions", async () => {
        const result = await buildBoundaryStateGraph(snapshot(
            { "a.md": "allowed_markdown", "b.md": "allowed_markdown" },
            { "a.md": ["b.md"] },
        ), ["a.md"], new Set(["a.md"]), {
            ...LIMITS,
            // Two lifted states plus two symmetrized transitions cost
            // 1 seed * 50 iterations * 4 visits = 200 operations.
            maxProjectedSolverOperations: 199,
        }, { now: () => 0 });
        expect(result).toMatchObject({ ok: false, reason: "graph_budget" });
        if (!result.ok) expect(result.estimate.projectedSolverOperations).toBe(200);
    });

    it("keeps PPR independent when only the complete Local cosine envelope overflows", async () => {
        const result = await buildBoundaryStateGraph(snapshot(
            {
                "seed.md": "allowed_markdown",
                "local-a.md": "allowed_markdown",
                "local-b.md": "allowed_markdown",
            },
            { "seed.md": ["local-a.md", "local-b.md"] },
        ), ["seed.md"], new Set(["seed.md"]), {
            ...LIMITS,
            maxLocalCandidatePaths: 1,
        }, { now: () => 0 });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.graph.localCandidatePaths.size).toBe(2);
    });

    it("fails the whole seed solve on abort, deadline, or iteration cap", async () => {
        const built = await buildBoundaryStateGraph(snapshot(
            { "a.md": "allowed_markdown", "b.md": "allowed_markdown" },
            { "a.md": ["b.md"] },
        ), ["a.md"], new Set(["a.md"]), LIMITS, { now: () => 0 });
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const controller = new AbortController();
        controller.abort();
        await expect(solvePersonalizedPageRank(built.graph, "a.md", { signal: controller.signal }))
            .resolves.toEqual({ converged: false, reason: "aborted" });
        await expect(solvePersonalizedPageRank(built.graph, "a.md", { absoluteDeadlineMs: 1, now: () => 1 }))
            .resolves.toEqual({ converged: false, reason: "deadline" });
        await expect(solvePersonalizedPageRank(built.graph, "a.md", { absoluteDeadlineMs: Number.NaN }))
            .resolves.toEqual({ converged: false, reason: "invalid_graph" });
        await expect(solvePersonalizedPageRank(built.graph, "a.md", { absoluteDeadlineMs: Number.POSITIVE_INFINITY }))
            .resolves.toEqual({ converged: false, reason: "invalid_graph" });
        await expect(solvePersonalizedPageRank(built.graph, "a.md", { maxIterations: 1, targetL1Error: 1e-12, now: () => 0 }))
            .resolves.toEqual({ converged: false, reason: "iteration_cap" });
    });

    it("excludes every direct path from Local even when only three are seeds", async () => {
        const built = await buildBoundaryStateGraph(snapshot(
            {
                "d1.md": "allowed_markdown",
                "d2.md": "allowed_markdown",
                "d3.md": "allowed_markdown",
                "d4.md": "allowed_markdown",
                "local.md": "allowed_markdown",
            },
            { "d1.md": ["d4.md", "local.md"] },
        ), ["d1.md", "d2.md", "d3.md"], new Set(["d1.md", "d2.md", "d3.md", "d4.md"]), LIMITS, { now: () => 0 });
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        expect([...built.graph.localCandidatePaths]).toEqual(["local.md"]);
    });

    it("does not charge disconnected vault components to the seed-reachable canonical envelope", async () => {
        const classes: Record<string, "allowed_markdown"> = { "a.md": "allowed_markdown", "b.md": "allowed_markdown" };
        const links: Record<string, string[]> = { "a.md": ["b.md"] };
        for (let index = 0; index < 40; index += 1) {
            classes[`u${index}.md`] = "allowed_markdown";
            links[`u${index}.md`] = [`u${(index + 1) % 40}.md`];
        }
        const built = await buildBoundaryStateGraph(
            snapshot(classes, links),
            ["a.md"],
            new Set(["a.md"]),
            { ...LIMITS, maxSnapshotNodes: 100, maxCanonicalNodes: 3, maxCanonicalEdges: 3 },
            { now: () => 0 },
        );
        expect(built.ok).toBe(true);
        if (built.ok) {
            expect(built.graph.estimate.canonicalNodes).toBe(2);
            expect(built.graph.estimate.canonicalEdges).toBe(1);
        }
    });

    it("charges whole-snapshot temporary substrate memory even when canonical reachability is small", async () => {
        const classes: Record<string, "allowed_markdown"> = { "a.md": "allowed_markdown", "b.md": "allowed_markdown" };
        const links: Record<string, string[]> = { "a.md": ["b.md"] };
        for (let index = 0; index < 40; index += 1) {
            classes[`detached-${index}.md`] = "allowed_markdown";
            links[`detached-${index}.md`] = [`detached-${(index + 1) % 40}.md`];
        }
        const built = await buildBoundaryStateGraph(
            snapshot(classes, links),
            ["a.md"],
            new Set(["a.md"]),
            { ...LIMITS, maxProjectedBytes: 2_000 },
            { now: () => 0 },
        );
        expect(built).toMatchObject({ ok: false, reason: "graph_budget" });
        if (!built.ok) expect(built.estimate.projectedBytes).toBeGreaterThan(2_000);
    });

    it("observes abort during cooperative graph build and solver continuations", async () => {
        const classes: Record<string, "allowed_markdown"> = { "seed.md": "allowed_markdown" };
        const targets: string[] = [];
        for (let index = 0; index < 30; index += 1) {
            const path = `n${index}.md`;
            classes[path] = "allowed_markdown";
            targets.push(path);
        }
        const buildController = new AbortController();
        const abortedBuild = await buildBoundaryStateGraph(
            snapshot(classes, { "seed.md": targets }),
            ["seed.md"],
            new Set(["seed.md"]),
            { ...LIMITS, maxSnapshotNodes: 100, maxCanonicalNodes: 100 },
            {
                now: () => 0,
                signal: buildController.signal,
                checkpointEvery: 4,
                yieldMacrotask: async () => buildController.abort(),
            },
        );
        expect(abortedBuild).toMatchObject({ ok: false, reason: "aborted" });

        const built = await buildBoundaryStateGraph(
            snapshot(classes, { "seed.md": targets }),
            ["seed.md"],
            new Set(["seed.md"]),
            { ...LIMITS, maxSnapshotNodes: 100, maxCanonicalNodes: 100 },
            { now: () => 0 },
        );
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const solveController = new AbortController();
        let markSolveYieldStarted!: () => void;
        const solveYieldStarted = new Promise<void>((resolve) => {
            markSolveYieldStarted = resolve;
        });
        const solvedPromise = solvePersonalizedPageRank(built.graph, "seed.md", {
            now: () => 0,
            signal: solveController.signal,
            checkpointEvery: 4,
            yieldMacrotask: () => {
                markSolveYieldStarted();
                return new Promise<void>(() => undefined);
            },
        });
        await solveYieldStarted;
        solveController.abort();
        const solved = await solvedPromise;
        expect(solved).toEqual({ converged: false, reason: "aborted" });
    });
});
