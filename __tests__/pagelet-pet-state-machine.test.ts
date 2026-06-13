/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import { PetStateMachine } from "../src/pagelet/pet/PetStateMachine";
import type { PetEvent } from "../src/pagelet/pet/PetStateMachine";
import { getPetAriaLabel } from "../src/pagelet/pet/PetView";

describe("PetStateMachine", () => {
    describe("initial state", () => {
        it("defaults to idle", () => {
            const sm = new PetStateMachine();
            expect(sm.state).toBe("idle");
        });

        it("accepts custom initial state", () => {
            const sm = new PetStateMachine({ initialState: "resting" });
            expect(sm.state).toBe("resting");
        });
    });

    describe("transitions", () => {
        it("resting + note-activity -> idle", () => {
            const sm = new PetStateMachine({ initialState: "resting" });
            expect(sm.transition("note-activity")).toBe("idle");
            expect(sm.state).toBe("idle");
        });

        it("resting + analysis-start -> working (global override)", () => {
            const sm = new PetStateMachine({ initialState: "resting" });
            expect(sm.transition("analysis-start")).toBe("working");
            expect(sm.state).toBe("working");
        });

        it("resting + long-idle -> resting (no change)", () => {
            const sm = new PetStateMachine({ initialState: "resting" });
            expect(sm.transition("long-idle")).toBe("resting");
            expect(sm.state).toBe("resting");
        });

        it("idle + long-idle -> resting", () => {
            const sm = new PetStateMachine({ initialState: "idle" });
            expect(sm.transition("long-idle")).toBe("resting");
            expect(sm.state).toBe("resting");
        });

        it("idle + analysis-start -> working", () => {
            const sm = new PetStateMachine({ initialState: "idle" });
            expect(sm.transition("analysis-start")).toBe("working");
            expect(sm.state).toBe("working");
        });

        it("idle + note-activity -> idle (no change)", () => {
            const sm = new PetStateMachine({ initialState: "idle" });
            expect(sm.transition("note-activity")).toBe("idle");
            expect(sm.state).toBe("idle");
        });

        it("working + analysis-done -> idle", () => {
            const sm = new PetStateMachine({ initialState: "working" });
            expect(sm.transition("analysis-done")).toBe("idle");
            expect(sm.state).toBe("idle");
        });

        it("working + insights-ready -> nudge (when hints enabled)", () => {
            const sm = new PetStateMachine({
                initialState: "working",
                proactiveHintsEnabled: true,
            });
            expect(sm.transition("insights-ready")).toBe("nudge");
            expect(sm.state).toBe("nudge");
        });

        it("working + insights-ready -> idle (when hints disabled)", () => {
            const sm = new PetStateMachine({
                initialState: "working",
                proactiveHintsEnabled: false,
            });
            expect(sm.transition("insights-ready")).toBe("idle");
            expect(sm.state).toBe("idle");
        });

        it("working + user-interact -> working (no change)", () => {
            const sm = new PetStateMachine({ initialState: "working" });
            expect(sm.transition("user-interact")).toBe("working");
            expect(sm.state).toBe("working");
        });

        it("nudge + user-interact -> idle", () => {
            const sm = new PetStateMachine({ initialState: "nudge" });
            expect(sm.transition("user-interact")).toBe("idle");
            expect(sm.state).toBe("idle");
        });

        it("nudge + analysis-start -> working (global override)", () => {
            const sm = new PetStateMachine({ initialState: "nudge" });
            expect(sm.transition("analysis-start")).toBe("working");
            expect(sm.state).toBe("working");
        });

        it("nudge + long-idle -> nudge (no change)", () => {
            const sm = new PetStateMachine({ initialState: "nudge" });
            expect(sm.transition("long-idle")).toBe("nudge");
            expect(sm.state).toBe("nudge");
        });
    });

    describe("forceState", () => {
        it("changes state bypassing transition table", () => {
            const sm = new PetStateMachine({ initialState: "idle" });
            sm.forceState("nudge");
            expect(sm.state).toBe("nudge");
        });

        it("fires listener on change", () => {
            const transitions: Array<[string, string]> = [];
            const sm = new PetStateMachine({
                initialState: "idle",
                onTransition: (prev, next) => transitions.push([prev, next]),
            });
            sm.forceState("working");
            expect(transitions).toEqual([["idle", "working"]]);
        });

        it("does not fire listener when same state", () => {
            const transitions: Array<[string, string]> = [];
            const sm = new PetStateMachine({
                initialState: "idle",
                onTransition: (prev, next) => transitions.push([prev, next]),
            });
            sm.forceState("idle");
            expect(transitions).toEqual([]);
        });
    });

    describe("proactiveHintsEnabled", () => {
        it("getter returns current value", () => {
            const sm = new PetStateMachine({ proactiveHintsEnabled: true });
            expect(sm.proactiveHintsEnabled).toBe(true);
        });

        it("setter updates value", () => {
            const sm = new PetStateMachine({ proactiveHintsEnabled: false });
            sm.proactiveHintsEnabled = true;
            expect(sm.proactiveHintsEnabled).toBe(true);
        });

        it("affects insights-ready transition", () => {
            const sm = new PetStateMachine({
                initialState: "working",
                proactiveHintsEnabled: false,
            });
            // disabled: insights-ready -> idle
            expect(sm.transition("insights-ready")).toBe("idle");

            // re-enter working, then enable hints
            sm.forceState("working");
            sm.proactiveHintsEnabled = true;
            // enabled: insights-ready -> nudge
            expect(sm.transition("insights-ready")).toBe("nudge");
        });
    });

    describe("listener", () => {
        it("fires on transition with (prev, next) args", () => {
            const transitions: Array<[string, string]> = [];
            const sm = new PetStateMachine({
                initialState: "idle",
                onTransition: (prev, next) => transitions.push([prev, next]),
            });
            sm.transition("long-idle");
            expect(transitions).toEqual([["idle", "resting"]]);
        });

        it("does not fire when state unchanged", () => {
            const transitions: Array<[string, string]> = [];
            const sm = new PetStateMachine({
                initialState: "idle",
                onTransition: (prev, next) => transitions.push([prev, next]),
            });
            sm.transition("note-activity"); // idle + note-activity -> idle (no change)
            expect(transitions).toEqual([]);
        });
    });
});

describe("PetView locale labels", () => {
    it("resolves English aria-label when the Pagelet UI locale is en", () => {
        expect(getPetAriaLabel("en")).toBe("Pagelet assistant");
    });

    it("resolves Chinese aria-label when the Pagelet UI locale is zh", () => {
        expect(getPetAriaLabel("zh")).toBe("拾页助手");
    });
});
