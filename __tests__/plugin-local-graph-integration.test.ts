import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { LocalGraph } from "../src/local-graph";
import { LocalGraphIntegration } from "../src/plugin/local-graph-integration";
import type { PlatformTimeoutHandle } from "../src/platform-dom";

interface FakeGraph extends LocalGraph {
    startup: jest.Mock<() => Promise<void>>;
    updateGraphColors: jest.Mock<() => Promise<void>>;
    applyOptionsToOpenGraphs: jest.Mock<() => Promise<void>>;
    resize: jest.Mock<() => Promise<void>>;
}

interface FakeMutationObserver {
    callback: MutationCallback;
    observe: jest.Mock;
    disconnect: jest.Mock;
}

interface HoverNode {
    instanceOf: jest.Mock<(candidate: new () => unknown) => boolean>;
    matches: jest.Mock<(selector: string) => boolean>;
    querySelector: jest.Mock<(selector: string) => Element | null>;
}

function createGraph(): FakeGraph {
    return {
        startup: jest.fn(async () => undefined),
        updateGraphColors: jest.fn(async () => undefined),
        applyOptionsToOpenGraphs: jest.fn(async () => undefined),
        resize: jest.fn(async () => undefined),
    } as unknown as FakeGraph;
}

const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;

beforeAll(() => {
    Object.defineProperty(globalThis, "HTMLElement", {
        configurable: true,
        value: class MockHTMLElement {},
    });
});

afterAll(() => {
    Object.defineProperty(globalThis, "HTMLElement", {
        configurable: true,
        value: originalHTMLElement,
    });
});

function createHarness({ isDesktop = true } = {}) {
    const graph = createGraph();
    const createGraphFactory = jest.fn(() => graph);
    const observers: FakeMutationObserver[] = [];
    const body = {} as Element;
    const log = jest.fn<(message: string, ...args: unknown[]) => void>();
    const setTimer = jest.fn<(callback: () => void, ms: number) => PlatformTimeoutHandle>();
    const clearTimer = jest.fn<(handle: PlatformTimeoutHandle) => void>();
    const owner = new LocalGraphIntegration({
        createGraph: createGraphFactory,
        isDesktop: () => isDesktop,
        createMutationObserver: (callback) => {
            const observer: FakeMutationObserver = {
                callback,
                observe: jest.fn(),
                disconnect: jest.fn(),
            };
            observers.push(observer);
            return observer as unknown as MutationObserver;
        },
        getObservedBody: () => body,
        setTimer: (callback, ms) => setTimer(callback, ms),
        clearTimer,
        log,
    });

    return { owner, graph, createGraphFactory, observers, body, setTimer, clearTimer, log };
}

function createNode({
    isHTMLElement = true,
    matches = false,
    descendant = false,
}: {
    isHTMLElement?: boolean;
    matches?: boolean;
    descendant?: boolean;
} = {}): HoverNode {
    return {
        instanceOf: jest.fn(() => isHTMLElement),
        matches: jest.fn(() => matches),
        querySelector: jest.fn(() => (descendant ? ({} as Element) : null)),
    } as unknown as HoverNode;
}

function mutation(...nodes: HoverNode[]): MutationRecord {
    return { addedNodes: nodes as unknown as NodeList } as MutationRecord;
}

describe("LocalGraphIntegration", () => {
    it("lazily creates one graph and reuses it for every graph action", async () => {
        const harness = createHarness();

        expect(harness.createGraphFactory).not.toHaveBeenCalled();
        harness.owner.setupObserver();
        expect(harness.createGraphFactory).not.toHaveBeenCalled();

        await harness.owner.startup();
        await harness.owner.updateGraphColors();
        await harness.owner.applyOptionsToOpenGraphs();

        expect(harness.createGraphFactory).toHaveBeenCalledTimes(1);
        expect(harness.graph.startup).toHaveBeenCalledTimes(1);
        expect(harness.graph.updateGraphColors).toHaveBeenCalledTimes(1);
        expect(harness.graph.applyOptionsToOpenGraphs).toHaveBeenCalledTimes(1);
    });

    it("observes only desktop document bodies and keeps one observer", () => {
        const harness = createHarness();
        harness.owner.setupObserver();
        harness.owner.setupObserver();

        expect(harness.observers).toHaveLength(1);
        expect(harness.observers[0]?.observe).toHaveBeenCalledWith(harness.body, { childList: true });

        const mobile = createHarness({ isDesktop: false });
        mobile.owner.setupObserver();
        mobile.owner.setupObserver();
        expect(mobile.observers).toHaveLength(0);
    });

    it("matches direct and descendant hover editors and coalesces their resize debounce", () => {
        const harness = createHarness();
        harness.owner.setupObserver();
        const observer = harness.observers[0]!;
        harness.setTimer.mockImplementationOnce(() => 1 as PlatformTimeoutHandle);

        observer.callback([mutation(createNode({ matches: true }))], {} as MutationObserver);
        expect(harness.setTimer).toHaveBeenNthCalledWith(1, expect.any(Function), 150);

        observer.callback([
            mutation(createNode({ isHTMLElement: false, matches: true })),
            mutation(createNode({ descendant: true })),
        ], {} as MutationObserver);
        expect(harness.setTimer).toHaveBeenCalledTimes(2);
        expect(harness.setTimer).toHaveBeenNthCalledWith(2, expect.any(Function), 150);
        expect(harness.clearTimer).toHaveBeenCalledWith(1);

        const timerCallback = harness.setTimer.mock.calls[1]?.[0];
        timerCallback?.();
        expect(harness.graph.resize).toHaveBeenCalledTimes(1);

        harness.setTimer.mockImplementationOnce(() => 2 as PlatformTimeoutHandle);
        observer.callback([mutation(createNode({ matches: true }))], {} as MutationObserver);
        expect(harness.setTimer).toHaveBeenCalledTimes(3);
        expect(harness.clearTimer).toHaveBeenCalledTimes(1);
    });

    it("cleans up the timer and observer repeatedly without dropping the graph", async () => {
        const harness = createHarness();
        harness.owner.setupObserver();
        const observer = harness.observers[0]!;
        harness.setTimer.mockImplementationOnce(() => 11 as PlatformTimeoutHandle);
        observer.callback([mutation(createNode({ matches: true }))], {} as MutationObserver);

        harness.owner.disposeObserver();
        harness.owner.disposeObserver();
        expect(harness.clearTimer).toHaveBeenCalledTimes(1);
        expect(harness.clearTimer).toHaveBeenCalledWith(11);
        expect(observer.disconnect).toHaveBeenCalledTimes(1);

        const timerCallback = harness.setTimer.mock.calls[0]?.[0];
        timerCallback?.();
        expect(harness.graph.resize).not.toHaveBeenCalled();

        await harness.owner.applyOptionsToOpenGraphs();
        expect(harness.createGraphFactory).toHaveBeenCalledTimes(1);
        expect(harness.graph.applyOptionsToOpenGraphs).toHaveBeenCalledTimes(1);
    });

    it("logs a rejected hover graph resize without propagating it", async () => {
        const harness = createHarness();
        const failure = new Error("graph resize failed");
        harness.graph.resize.mockRejectedValueOnce(failure);
        harness.owner.setupObserver();
        const observer = harness.observers[0]!;
        harness.setTimer.mockImplementationOnce(() => 21 as PlatformTimeoutHandle);
        observer.callback([mutation(createNode({ matches: true }))], {} as MutationObserver);

        const timerCallback = harness.setTimer.mock.calls[0]?.[0];
        timerCallback?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(harness.log).toHaveBeenCalledWith("Failed to resize hover local graph", failure);
    });
});
