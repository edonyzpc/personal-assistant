import { describe, expect, it, jest } from "@jest/globals";

import {
    buildGraphBoundarySnapshot,
    type GraphBoundarySnapshotLimits,
} from "../src/graph/graph-boundary-snapshot";
import {
    runInterruptibleParallelGroup,
    waitForInterruptibleMacrotask,
} from "../src/graph/interruptible-macrotask";

const LIMITS: GraphBoundarySnapshotLimits = {
    maxSnapshotNodes: 100,
    maxSnapshotEdges: 200,
    maxSnapshotBytes: 100_000,
    absoluteDeadlineMs: 10_000,
    checkpointEvery: 4,
};

function source(
    links: ReadonlyMap<string, ReadonlySet<string>>,
    getEpoch: () => string = () => "epoch-1",
) {
    return {
        getEpoch,
        resolvedLinks: links,
        canonicalizePath: (path: string) => path.trim() || null,
        classifyPath: (path: string) => path.startsWith("blocked/")
            ? "blocked" as const
            : path.startsWith("hidden/")
                ? "opaque_excluded_markdown" as const
                : "allowed_markdown" as const,
    };
}

describe("bounded graph boundary snapshot", () => {
    it("seals canonical topology independently of insertion order", async () => {
        const first = await buildGraphBoundarySnapshot(source(new Map([
            ["b.md", new Set(["c.md"])],
            ["a.md", new Set(["hidden/x.md", "b.md"])],
        ])), LIMITS, { now: () => 0 });
        const second = await buildGraphBoundarySnapshot(source(new Map([
            ["a.md", new Set(["b.md", "hidden/x.md"])],
            ["b.md", new Set(["c.md"])],
        ])), LIMITS, { now: () => 0 });

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        if (!first.ok || !second.ok) return;
        expect(first.snapshot.topologyFingerprint).toBe(second.snapshot.topologyFingerprint);
        expect([...first.snapshot.pathClasses.keys()]).toEqual(["a.md", "b.md", "c.md", "hidden/x.md"]);
        expect(first.snapshot.pathClasses.get("hidden/x.md")).toBe("opaque_excluded_markdown");
        expect((first.snapshot.pathClasses as unknown as { set?: unknown }).set).toBeUndefined();
        expect((first.snapshot.resolvedLinks as unknown as { set?: unknown }).set).toBeUndefined();
        expect((first.snapshot.resolvedLinks.get("a.md") as unknown as { add?: unknown }).add).toBeUndefined();
        expect(Reflect.ownKeys(first.snapshot.resolvedLinks)).not.toContain("source");
    });

    it("has insertion-order-independent byte and budget behavior", async () => {
        const left = source(new Map([
            ["very-long-source.md", new Set(["z.md", "a.md"])],
            ["b.md", new Set(["long-target-name.md"])],
        ]));
        const right = source(new Map([
            ["b.md", new Set(["long-target-name.md"])],
            ["very-long-source.md", new Set(["a.md", "z.md"])],
        ]));
        const baselineLeft = await buildGraphBoundarySnapshot(left, LIMITS, { now: () => 0 });
        const baselineRight = await buildGraphBoundarySnapshot(right, LIMITS, { now: () => 0 });
        expect(baselineLeft.ok).toBe(true);
        expect(baselineRight.ok).toBe(true);
        if (!baselineLeft.ok || !baselineRight.ok) return;
        expect(baselineLeft.estimate.snapshotBytes).toBe(baselineRight.estimate.snapshotBytes);

        const constrained = {
            ...LIMITS,
            maxSnapshotBytes: baselineLeft.estimate.snapshotBytes - 1,
        };
        await expect(buildGraphBoundarySnapshot(left, constrained, { now: () => 0 }))
            .resolves.toMatchObject({ ok: false, reason: "snapshot_budget" });
        await expect(buildGraphBoundarySnapshot(right, constrained, { now: () => 0 }))
            .resolves.toMatchObject({ ok: false, reason: "snapshot_budget" });
    });

    it("returns no partial snapshot when any copy budget is exceeded", async () => {
        const result = await buildGraphBoundarySnapshot(source(new Map([
            ["a.md", new Set(["b.md", "c.md"])],
        ])), { ...LIMITS, maxSnapshotEdges: 1 }, { now: () => 0 });
        expect(result).toMatchObject({ ok: false, reason: "snapshot_budget" });
        expect("snapshot" in result).toBe(false);
    });

    it("rejects an epoch drift before sealing", async () => {
        let reads = 0;
        const result = await buildGraphBoundarySnapshot(source(
            new Map([["a.md", new Set(["b.md"])]]),
            () => (++reads > 3 ? "epoch-2" : "epoch-1"),
        ), LIMITS, { now: () => 0 });
        expect(result).toMatchObject({ ok: false, reason: "epoch_changed" });
    });

    it("observes abort in the next bounded macrotask while streaming a high-degree row", async () => {
        const controller = new AbortController();
        const targets = new Set(Array.from({ length: 40 }, (_, index) => `n${index}.md`));
        let yields = 0;
        const result = await buildGraphBoundarySnapshot(
            source(new Map([["seed.md", targets]])),
            LIMITS,
            {
                signal: controller.signal,
                now: () => 0,
                yieldMacrotask: async () => {
                    yields += 1;
                    controller.abort();
                },
            },
        );
        expect(yields).toBe(1);
        expect(result).toMatchObject({ ok: false, reason: "aborted" });
        expect("snapshot" in result).toBe(false);
    });

    it("interrupts a throttled macrotask immediately on parent abort and detaches its listener", async () => {
        const controller = new AbortController();
        const addListener = jest.spyOn(controller.signal, "addEventListener");
        const removeListener = jest.spyOn(controller.signal, "removeEventListener");
        let rejectLateYield!: (error: Error) => void;
        let markYieldStarted!: () => void;
        const yieldStarted = new Promise<void>((resolve) => {
            markYieldStarted = resolve;
        });
        let epochReads = 0;
        const resultPromise = buildGraphBoundarySnapshot(
            source(
                new Map([["seed.md", new Set(["target.md"])]]),
                () => {
                    epochReads += 1;
                    return "epoch-1";
                },
            ),
            { ...LIMITS, absoluteDeadlineMs: Date.now() + 60_000, checkpointEvery: 1 },
            {
                signal: controller.signal,
                yieldMacrotask: () => {
                    markYieldStarted();
                    return new Promise<void>((_resolve, reject) => {
                        rejectLateYield = reject;
                    });
                },
            },
        );

        await yieldStarted;
        controller.abort();
        await expect(resultPromise).resolves.toMatchObject({ ok: false, reason: "aborted" });
        const readsAtTerminal = epochReads;
        expect(addListener).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledTimes(1);

        // A late terminal from the throttled task is observed but cannot resume
        // snapshot work or produce an unhandled rejection.
        rejectLateYield(new Error("late yield rejection"));
        await Promise.resolve();
        await Promise.resolve();
        expect(epochReads).toBe(readsAtTerminal);
    });

    it("interrupts a never-settling macrotask when the absolute deadline arrives", async () => {
        const controller = new AbortController();
        const addListener = jest.spyOn(controller.signal, "addEventListener");
        const removeListener = jest.spyOn(controller.signal, "removeEventListener");
        let markYieldStarted!: () => void;
        const yieldStarted = new Promise<void>((resolve) => {
            markYieldStarted = resolve;
        });
        let epochReads = 0;
        const resultPromise = buildGraphBoundarySnapshot(
            source(
                new Map([["seed.md", new Set(["target.md"])]]),
                () => {
                    epochReads += 1;
                    return "epoch-1";
                },
            ),
            { ...LIMITS, absoluteDeadlineMs: Date.now() + 10, checkpointEvery: 1 },
            {
                signal: controller.signal,
                yieldMacrotask: () => {
                    markYieldStarted();
                    return new Promise<void>(() => undefined);
                },
            },
        );

        await yieldStarted;
        await expect(resultPromise).resolves.toMatchObject({ ok: false, reason: "deadline" });
        const readsAtTerminal = epochReads;
        await Promise.resolve();
        expect(epochReads).toBe(readsAtTerminal);
        expect(addListener).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledTimes(1);
    });

    it("aborts and drains a stalled sibling before a parallel branch rejection escapes", async () => {
        const parentController = new AbortController();
        const addParentListener = jest.spyOn(parentController.signal, "addEventListener");
        const removeParentListener = jest.spyOn(parentController.signal, "removeEventListener");
        let addSiblingListener!: jest.SpiedFunction<AbortSignal["addEventListener"]>;
        let removeSiblingListener!: jest.SpiedFunction<AbortSignal["removeEventListener"]>;
        let rejectFirst!: (error: Error) => void;
        let rejectLateYield!: (error: Error) => void;
        let markYieldStarted!: () => void;
        const yieldStarted = new Promise<void>((resolve) => {
            markYieldStarted = resolve;
        });
        let nowCalls = 0;
        const expected = new Error("parallel branch failed");
        const grouped = runInterruptibleParallelGroup(
            parentController.signal,
            (groupSignal) => {
                addSiblingListener = jest.spyOn(groupSignal, "addEventListener");
                removeSiblingListener = jest.spyOn(groupSignal, "removeEventListener");
                return [
                    new Promise<void>((_resolve, reject) => {
                        rejectFirst = reject;
                    }),
                    waitForInterruptibleMacrotask({
                        signal: groupSignal,
                        absoluteDeadlineMs: Date.now() + 60_000,
                        now: () => {
                            nowCalls += 1;
                            return Date.now();
                        },
                        yieldMacrotask: () => {
                            markYieldStarted();
                            return new Promise<void>((_resolve, reject) => {
                                rejectLateYield = reject;
                            });
                        },
                    }),
                ] as const;
            },
        );

        await yieldStarted;
        rejectFirst(expected);
        await expect(grouped).rejects.toBe(expected);
        expect(addSiblingListener).toHaveBeenCalledTimes(1);
        expect(removeSiblingListener).toHaveBeenCalledTimes(1);
        expect(addParentListener).toHaveBeenCalledTimes(1);
        expect(removeParentListener).toHaveBeenCalledTimes(1);
        const callsAtTerminal = nowCalls;

        rejectLateYield(new Error("late sibling yield"));
        await Promise.resolve();
        await Promise.resolve();
        expect(nowCalls).toBe(callsAtTerminal);
    });

    it("seals a high-degree row without repeatedly copying its target set", async () => {
        const targets = new Set(Array.from({ length: 600 }, (_, index) => `target-${index}.md`));
        const result = await buildGraphBoundarySnapshot(
            source(new Map([["hub.md", targets]])),
            {
                ...LIMITS,
                maxSnapshotNodes: 700,
                maxSnapshotEdges: 700,
                maxSnapshotBytes: 500_000,
                checkpointEvery: 64,
            },
            { now: () => 0 },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.snapshot.resolvedLinks.get("hub.md")?.size).toBe(600);
        expect(result.snapshot.snapshotEdges).toBe(600);
    });
});
