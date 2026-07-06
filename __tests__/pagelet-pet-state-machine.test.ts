/* Copyright 2023 edonyzpc */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";

import { PetStateMachine } from "../src/pagelet/pet/PetStateMachine";
import type { PetEvent } from "../src/pagelet/pet/PetStateMachine";
import { getPetAriaLabel, PetView } from "../src/pagelet/pet/PetView";

afterEach(() => {
    jest.useRealTimers();
});

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCssRuleBlock(css: string, selector: string): string {
    const match = new RegExp(`${escapeRegex(selector)}\\s*\\{([\\s\\S]*?)\\}`, "m").exec(css);
    return match?.[1] ?? "";
}

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

    it("resolves task-specific aria-label while working", () => {
        expect(getPetAriaLabel("en", "working", "connection")).toBe("Pagelet assistant: discovering connections");
        expect(getPetAriaLabel("zh", "working", "summary")).toBe("拾页助手: 正在准备回顾");
    });
});

describe("PetView task kind", () => {
    it("defaults to review and can switch task kind before mounting", () => {
        const view = new PetView({
            callbacks: { onToggleBubble: () => undefined },
        });

        expect(view.taskKind).toBe("review");

        view.setTaskKind("summary");

        expect(view.taskKind).toBe("summary");
    });

    it("defines a hold gesture that opens the shared Quick Capture modal", () => {
        const source = readFileSync("src/pagelet/pet/PetView.ts", "utf8");

        expect(source).toContain("const QUICK_CAPTURE_HOLD_MS = 520;");
        expect(source).toContain("onQuickCaptureOpen");
        expect(source).toContain("this.openQuickCapture();");
        expect(source).toContain("_handleMouseDown");
        expect(source).toContain("_handleTouchstart");
        expect(source).toContain("this.startQuickCaptureHold();");
        expect(source).toContain("if (this.consumeQuickCaptureHold()) return;");
        expect(source).not.toContain("pa-pagelet-pet-capture-form");
        expect(source).not.toContain("pagelet.pet.quickCapturePlaceholder");
    });

    it("opens shared Quick Capture from the hold path without calling the bubble callback", () => {
        jest.useFakeTimers();
        type PetViewCaptureInternals = {
            startQuickCaptureHold: () => void;
        };
        const onToggleBubble = jest.fn();
        const onQuickCaptureOpen = jest.fn();
        const view = new PetView({
            callbacks: { onToggleBubble, onQuickCaptureOpen },
            getLocale: () => "en",
        });
        const internals = view as unknown as PetViewCaptureInternals;

        internals.startQuickCaptureHold();
        jest.advanceTimersByTime(520);

        expect(onQuickCaptureOpen).toHaveBeenCalledTimes(1);
        expect(onToggleBubble).not.toHaveBeenCalled();
    });
});

describe("Pet SVG visual weight", () => {
    it("uses lighter desktop strokes with mobile-specific stroke classes", () => {
        const svgSource = readFileSync("src/pagelet/pet/PetSvg.ts", "utf8");

        expect(svgSource).toContain("const DESKTOP_OUTLINE_STROKE_WIDTH = 1.6;");
        expect(svgSource).toContain("const DESKTOP_DETAIL_STROKE_WIDTH = 1.4;");
        expect(svgSource).toContain('const OUTLINE_STROKE_CLASS = "pa-pagelet-pet-stroke-outline";');
        expect(svgSource).toContain('const DETAIL_STROKE_CLASS = "pa-pagelet-pet-stroke-detail";');
        expect(svgSource).toContain('idle: "#1f2328"');
        expect(svgSource).toContain('resting: "#2f3437"');
    });
});

describe("PetView touch suppression", () => {
    type PetViewInternals = {
        _handleTouchend: (e: Pick<TouchEvent, "preventDefault">) => void;
        _handleClick: () => void;
    };

    function createView(onToggleBubble = jest.fn()): PetView {
        return new PetView({
            callbacks: { onToggleBubble },
        });
    }

    it("keeps click suppression active for 400ms after the most recent touchend", () => {
        jest.useFakeTimers();
        const onToggleBubble = jest.fn();
        const view = createView(onToggleBubble);
        const internals = view as unknown as PetViewInternals;
        const touch = { preventDefault: jest.fn() };

        internals._handleTouchend(touch);
        jest.advanceTimersByTime(300);
        internals._handleTouchend(touch);
        jest.advanceTimersByTime(399);

        internals._handleClick();
        expect(onToggleBubble).toHaveBeenCalledTimes(2);

        jest.advanceTimersByTime(1);
        internals._handleClick();
        expect(onToggleBubble).toHaveBeenCalledTimes(3);
    });

    it("clears pending touch suppression timers on destroy", () => {
        jest.useFakeTimers();
        const view = createView();
        const internals = view as unknown as PetViewInternals;

        internals._handleTouchend({ preventDefault: jest.fn() });
        expect(jest.getTimerCount()).toBe(1);

        view.destroy();

        expect(jest.getTimerCount()).toBe(0);
    });
});

describe("PetView mobile chrome layer mounting", () => {
    it("mounts phone-sized mobile pets into document.body instead of the markdown content container", () => {
        const source = readFileSync("src/pagelet/pet/PetView.ts", "utf8");

        expect(source).toContain("function shouldMountPetInMobileChromeLayer()");
        expect(source).toContain("doc.body.classList.contains(\"is-mobile\") && viewportWidth <= 600");
        expect(source).toContain("const mountEl = shouldMountPetInMobileChromeLayer() ? getPlatformDocument().body : containerEl;");
        expect(source).toContain("mountEl.appendChild(root);");
    });
});

describe("PetView mobile positioning styles", () => {
    it("keeps bottom-corner pets above the Obsidian mobile toolbar", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const mobileBottomCornerBlock = getCssRuleBlock(css, [
            "body.is-mobile .pa-pagelet-pet[data-corner=bottom-right],",
            "body.is-mobile .pa-pagelet-pet[data-corner=bottom-left]",
        ].join("\n"));

        expect(mobileBottomCornerBlock).toContain(
            "--pa-pagelet-mobile-pet-bottom-clearance: max(96px, calc(env(safe-area-inset-bottom, 0px) + 72px));",
        );
        expect(mobileBottomCornerBlock).toContain(
            "bottom: var(--pa-pagelet-mobile-pet-bottom-clearance);",
        );
    });

    it("pins the pet beside the top-left mobile chrome on phone-sized screens", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const phoneMediaStart = css.indexOf("@media (max-width:600px)");
        expect(phoneMediaStart).toBeGreaterThan(-1);

        const phoneCss = css.slice(phoneMediaStart);
        const mobileTopbarBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet");
        const mobileCornerOverrideBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet[data-corner]");
        const mobileWrapperBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet .pa-pagelet-pet-wrapper");
        const mobileSvgBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet .pa-pagelet-pet-svg-wrap svg");
        const mobileOutlineStrokeBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet .pa-pagelet-pet-stroke-outline");
        const mobileDetailStrokeBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet .pa-pagelet-pet-stroke-detail");
        const mobileRestingBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet[data-state=resting]");
        const mobileRestingSvgWrapBlock = getCssRuleBlock(phoneCss, "body.is-mobile .pa-pagelet-pet[data-state=resting] .pa-pagelet-pet-svg-wrap");

        expect(mobileTopbarBlock).toContain("--pa-pagelet-mobile-topbar-pet-top: 59px;");
        expect(mobileTopbarBlock).toContain("--pa-pagelet-mobile-topbar-pet-left: calc(env(safe-area-inset-left, 0px) + 60px);");
        expect(mobileTopbarBlock).toContain("position: fixed;");
        expect(mobileTopbarBlock).toContain("top: var(--pa-pagelet-mobile-topbar-pet-top);");
        expect(mobileTopbarBlock).toContain("left: var(--pa-pagelet-mobile-topbar-pet-left);");
        expect(mobileTopbarBlock).toContain("width: 44px;");
        expect(mobileTopbarBlock).toContain("height: 44px;");
        expect(mobileTopbarBlock).toContain("display: flex;");
        expect(mobileTopbarBlock).toContain("align-items: center;");
        expect(mobileTopbarBlock).toContain("justify-content: center;");
        expect(mobileTopbarBlock).toContain("right: auto;");
        expect(mobileTopbarBlock).toContain("bottom: auto;");
        expect(mobileTopbarBlock).toContain("z-index: 1002;");
        expect(mobileCornerOverrideBlock).toContain("right: auto;");
        expect(mobileCornerOverrideBlock).toContain("bottom: auto;");
        expect(mobileWrapperBlock).toContain("width: 44px;");
        expect(mobileWrapperBlock).toContain("height: 44px;");
        expect(mobileWrapperBlock).toContain("min-width: 44px;");
        expect(mobileWrapperBlock).toContain("min-height: 44px;");
        expect(mobileWrapperBlock).toContain("transform: none;");
        expect(mobileWrapperBlock).toContain("border-radius: 999px;");
        expect(mobileSvgBlock).toContain("width: 28px;");
        expect(mobileSvgBlock).toContain("height: 28px;");
        expect(mobileOutlineStrokeBlock).toContain("stroke-width: 2.8px;");
        expect(mobileDetailStrokeBlock).toContain("stroke-width: 2.35px;");
        expect(mobileRestingBlock).toContain("opacity: 1;");
        expect(mobileRestingBlock).toContain("filter: none;");
        expect(mobileRestingSvgWrapBlock).toContain("filter: none;");
    });

    it("does not change Pagelet motion behavior via prefers-reduced-motion", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const pageletMotionStart = css.indexOf("body.is-mobile .pa-pagelet-tab-body");
        const pageletMascotStart = css.indexOf("Pagelet (Review Assistant) — mascot", pageletMotionStart);
        expect(pageletMotionStart).toBeGreaterThan(-1);
        expect(pageletMascotStart).toBeGreaterThan(pageletMotionStart);

        const pageletMotionCss = css.slice(pageletMotionStart, pageletMascotStart);

        expect(pageletMotionCss).not.toContain("prefers-reduced-motion");
        expect(pageletMotionCss).not.toContain("transition-duration: .01s!important");
        expect(pageletMotionCss).not.toContain("animation: none!important");
    });
});
