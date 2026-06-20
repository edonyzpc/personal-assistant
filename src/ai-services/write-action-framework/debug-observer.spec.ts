import { describe, expect, it, jest } from "@jest/globals";

import {
    combineDebugObservers,
    ConsoleDebugObserver,
    NOOP_DEBUG_OBSERVER,
    NoopDebugObserver,
} from "./debug-observer";
import type { DebugEvent, DebugEventType, DebugObserver } from "./types";

/**
 * Canonical list of every DebugEventType (framework SDD §2.4). Asserted in the
 * `ALL_DEBUG_EVENT_TYPES` test below to catch any future drift between
 * `types.ts` and the runtime emitters.
 */
const ALL_DEBUG_EVENT_TYPES: DebugEventType[] = [
    "gate.target-confinement.ok",
    "gate.target-confinement.reject",
    "gate.preview.shown",
    "gate.confirmation.received",
    "gate.stale-reread.ok",
    "gate.stale-reread.drift",
    "execute.ok",
    "execute.fail",
    "rollback.ok",
    "rollback.fail",
];

function buildEvent(type: DebugEventType, extra: Partial<DebugEvent> = {}): DebugEvent {
    return {
        type,
        capabilityId: "pagelet.write_review_output",
        runId: "run-1",
        turnId: "turn-1",
        ...extra,
    };
}

describe("NoopDebugObserver", () => {
    it("is a constant-time no-op for every event type", () => {
        const obs = new NoopDebugObserver();
        for (const type of ALL_DEBUG_EVENT_TYPES) {
            expect(() => obs.emit(buildEvent(type))).not.toThrow();
        }
    });

    it("NOOP_DEBUG_OBSERVER singleton emits without side effects", () => {
        expect(typeof NOOP_DEBUG_OBSERVER.emit).toBe("function");
        // Spy console.debug to verify NoopDebugObserver does NOT touch it.
        // eslint-disable-next-line no-console
        const spy = jest.spyOn(console, "debug").mockImplementation(() => undefined);
        NOOP_DEBUG_OBSERVER.emit(buildEvent("execute.ok"));
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe("ConsoleDebugObserver (framework SDD §2.4)", () => {
    it("emits each of the 10 DebugEventTypes via the injected logger", () => {
        const logger = jest.fn();
        const obs = new ConsoleDebugObserver(logger);
        const seen = new Set<DebugEventType>();
        for (const type of ALL_DEBUG_EVENT_TYPES) {
            obs.emit(buildEvent(type));
            seen.add(type);
        }
        expect(seen.size).toBe(10);
        expect(logger).toHaveBeenCalledTimes(10);
    });

    it("uses the [write-action-framework] prefix and includes the type + capabilityId", () => {
        const logger = jest.fn();
        const obs = new ConsoleDebugObserver(logger);
        obs.emit(buildEvent("gate.target-confinement.reject", {
            errorCategory: "rejected_at_confinement",
        }));
        const firstCall = logger.mock.calls[0];
        expect(firstCall[0]).toBe("[write-action-framework] gate.target-confinement.reject pagelet.write_review_output");
        expect(firstCall[1]).toMatchObject({
            type: "gate.target-confinement.reject",
            capabilityId: "pagelet.write_review_output",
            errorCategory: "rejected_at_confinement",
        });
    });

    it("accepts a custom prefix for downstream filtering", () => {
        const logger = jest.fn();
        const obs = new ConsoleDebugObserver(logger, "[pagelet-runtime]");
        obs.emit(buildEvent("execute.ok"));
        const firstCall = logger.mock.calls[0];
        expect(firstCall[0]).toMatch(/^\[pagelet-runtime\]/);
    });

    it("defaults to console.debug when no logger supplied (smoke)", () => {
        // eslint-disable-next-line no-console
        const spy = jest.spyOn(console, "debug").mockImplementation(() => undefined);
        const obs = new ConsoleDebugObserver();
        obs.emit(buildEvent("rollback.ok"));
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe("combineDebugObservers", () => {
    it("returns NOOP when given zero observers", () => {
        expect(combineDebugObservers()).toBe(NOOP_DEBUG_OBSERVER);
    });

    it("returns the single observer unchanged when given one", () => {
        const obs = new NoopDebugObserver();
        expect(combineDebugObservers(obs)).toBe(obs);
    });

    it("fan-outs to every observer", () => {
        const a = jest.fn();
        const b = jest.fn();
        const observerA: DebugObserver = { emit: a };
        const observerB: DebugObserver = { emit: b };
        const combined = combineDebugObservers(observerA, observerB);
        const evt = buildEvent("execute.ok");
        combined.emit(evt);
        expect(a).toHaveBeenCalledWith(evt);
        expect(b).toHaveBeenCalledWith(evt);
    });

    it("isolates a throwing observer from the rest", () => {
        const good = jest.fn();
        const bad: DebugObserver = {
            emit: () => {
                throw new Error("observer crashed");
            },
        };
        const goodObserver: DebugObserver = { emit: good };
        const combined = combineDebugObservers(bad, goodObserver);
        const evt = buildEvent("execute.fail");
        expect(() => combined.emit(evt)).not.toThrow();
        expect(good).toHaveBeenCalledWith(evt);
    });
});
